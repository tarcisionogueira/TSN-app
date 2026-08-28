/**
 * GET/POST /api/live-lead-retro?slug=<slug>[&executar=1]  (SOMENTE admin)
 *
 * Dispara o evento `Lead` no Meta para inscrições da aula que NUNCA o receberam.
 *
 * POR QUE EXISTE (28/08): o evento `Lead` entrou no ar às ~11:46 UTC. Alexandre Carmo se
 * inscreveu às 10:50 — uma hora antes. É um inscrito REAL que a otimização do Meta nunca
 * viu, e não há como recuperá-lo pela tela: a inscrição não acontece duas vezes. O mesmo
 * caminho serve para qualquer envio que falhe no futuro (o CAPI pode devolver erro de rede,
 * e a inscrição segue válida — por desenho).
 *
 * DRY-RUN POR PADRÃO. Sem `executar=1` ele LISTA o que mandaria e não manda nada. Isto aqui
 * escreve numa plataforma de anúncios: um disparo errado não se apaga, e ensina o Meta a
 * comprar o público errado com dinheiro real. Quem confirma é uma pessoa, não o default.
 *
 * IDEMPOTÊNCIA EM DOIS NÍVEIS, e os dois importam:
 *   1. Aqui: pula quem já tem rastro `meta_lead` com o MESMO event_id em eventos_atividade.
 *   2. No Meta: o `event_id` é o determinístico `leadEventId(slug, email)` — o mesmo que o
 *      Pixel e o CAPI usam na inscrição. Se por acaso um disparo escapar da checagem acima,
 *      o Meta une os dois num só em vez de contar duas conversões.
 * Um id novo a cada chamada (como faz o diagnóstico) seria mais simples e ERRADO: contaria
 * o mesmo inscrito de novo a cada execução.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { getUser, getUserRoleById } from './_auth.js';
import { enviarLeadCapi, leadEventId, capiAtivo } from './_meta-capi.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_URL      = process.env.APP_BASE_URL || 'https://www.bidprobrasil.com.br';
const TETO = 200;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  const user = await getUser(req).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  const role = await getUserRoleById(user.id).catch(() => null);
  if (role !== 'admin') return res.status(403).json({ error: 'Somente admin' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });
  if (!capiAtivo()) return res.status(200).json({ capi: 'inativo', dica: 'META_CAPI_TOKEN e/ou pixel id ausentes — ver docs/ENVS_VERCEL.md.' });

  const slug = String(req.query?.slug || '').trim().slice(0, 80);
  if (!slug) return res.status(400).json({ error: 'Informe ?slug=<slug-da-aula>' });
  const executar = String(req.query?.executar || '') === '1';

  // Evento + inscritos. `error` de leitura ABORTA: uma lista vazia por falha viraria
  // "ninguém precisa de Lead", e o buraco seguiria aberto sem ninguém saber.
  const evRes = await sb(`eventos_live?slug=eq.${encodeURIComponent(slug)}&select=id,titulo&limit=1`);
  if (!evRes.ok) return res.status(502).json({ error: 'evento_ilegivel', http: evRes.status });
  const ev = (await evRes.json().catch(() => []))[0];
  if (!ev) return res.status(404).json({ error: 'Aula não encontrada.' });

  const insRes = await sb(`live_inscricoes?evento_id=eq.${ev.id}&select=id,nome,email,whatsapp,cidade,uf,user_id,utm&order=criado_em.asc&limit=${TETO}`);
  if (!insRes.ok) return res.status(502).json({ error: 'inscritos_ilegiveis', http: insRes.status });
  const inscritos = await insRes.json().catch(() => []);

  // Rastros já existentes. Mesma cautela: falha de leitura aborta em vez de virar "nenhum
  // rastro", que produziria disparo duplicado para todo mundo.
  const trRes = await sb(`eventos_atividade?tipo=eq.meta_lead&alvo=eq.${encodeURIComponent(`live:${slug}`)}&select=detalhe&limit=1000`);
  if (!trRes.ok) return res.status(502).json({ error: 'rastros_ilegiveis', http: trRes.status });
  const jaEnviados = new Set(
    (await trRes.json().catch(() => []))
      .map(r => (String(r.detalhe || '').match(/lead_[A-Za-z0-9_-]+/) || [])[0])
      .filter(Boolean),
  );

  const fila = inscritos
    .map(i => ({ ...i, evId: leadEventId(slug, i.email) }))
    .filter(i => i.email && !jaEnviados.has(i.evId));

  if (!executar) {
    return res.status(200).json({
      modo: 'dry-run', aula: ev.titulo, inscritos: inscritos.length,
      ja_com_lead: jaEnviados.size, mandaria: fila.length,
      quem: fila.map(i => ({ nome: i.nome, email: i.email, event_id: i.evId })),
      dica: 'Repita com &executar=1 para disparar de verdade.',
    });
  }

  let enviados = 0; const falhas = [];
  for (const i of fila) {
    const utm = (i.utm && typeof i.utm === 'object') ? i.utm : {};
    const fbclid = String(utm.fbclid || '').trim();
    const r = await enviarLeadCapi({
      eventoSlug: slug, email: i.email, telefone: i.whatsapp, nome: i.nome,
      cidade: i.cidade, uf: i.uf, userId: i.user_id, eventId: i.evId,
      fbc: fbclid ? `fb.1.${Date.now()}.${fbclid}` : null,
      sourceUrl: `${APP_URL}/live/${slug}`,
    }).catch(e => ({ ok: false, erro: String(e?.message || e) }));

    if (r?.ok) {
      enviados++;
      try {
        await sb('eventos_atividade', {
          method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: i.user_id || null, tipo: 'meta_lead', alvo: `live:${slug}`,
            // "retroativo" no rastro para que o 360 não leia isto como um inscrito novo de hoje.
            detalhe: `enviado RETROATIVO (${i.evId}) para ${i.email}`,
          }),
        });
      } catch { /* rastro best-effort; o evento já saiu */ }
    } else {
      falhas.push({ email: i.email, motivo: r?.http || r?.erro || r?.skipped || 'desconhecido' });
    }
  }

  return res.status(200).json({ modo: 'executado', aula: ev.titulo, enviados, falhas: falhas.length, detalhe_falhas: falhas.slice(0, 5) });
}
