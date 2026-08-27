/**
 * POST /api/live-criar-sala — gera a sala do Google Meet da aula ao vivo.
 *
 * O Google não tem API para "criar um Meet avulso": o link nasce junto com um evento na
 * agenda. Então criamos o evento recorrente da aula e guardamos o link que ele devolve.
 *
 * PARA AULA SEMANAL, isso é uma vantagem e não um contorno: num evento recorrente o Google
 * mantém o MESMO link em todas as ocorrências. Um link por semana obrigaria a trocar bio,
 * anúncio e fluxos do ManyChat toda quarta — e um deles ficaria para trás.
 *
 * Só admin. A sala é o ativo da aula: quem tem o link entra sem se inscrever, e a inscrição
 * é justamente o que a campanha existe para capturar.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { criarEventoAgenda, gcalConfigurado } from './_gcal.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const DIA_RRULE = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'nao_autenticado' });
  const perfRes = await sb(`perfis?id=eq.${user.id}&select=role`);
  const perf = perfRes.ok ? (await perfRes.json().catch(() => []))[0] : null;
  if (perf?.role !== 'admin') return res.status(403).json({ error: 'apenas_admin' });

  if (!gcalConfigurado()) {
    return res.status(400).json({
      error: 'O Google Calendar não está conectado. Configure GOOGLE_OAUTH_* no painel da Vercel ou cole o link do Meet à mão.',
    });
  }

  const slug = String(req.body?.slug || '').trim().slice(0, 80);
  if (!slug) return res.status(400).json({ error: 'Evento não informado.' });

  // Lê o evento pela RPC de recorrência: precisamos da data da PRÓXIMA aula, não da data
  // solta gravada na coluna — que num evento semanal pode já ter passado.
  const proxRes = await sb('rpc/live_proxima', { method: 'POST', body: JSON.stringify({ p_slug: slug }) });
  if (!proxRes.ok) return res.status(500).json({ error: 'Não foi possível ler o evento.' });
  const ev = await proxRes.json().catch(() => null);
  if (!ev?.id) return res.status(404).json({ error: 'Aula não encontrada ou inativa.' });

  // Já tem sala? Não criar outra: cada chamada geraria um Meet novo, e o link antigo — que
  // já pode estar na bio e nos e-mails enviados — apontaria para uma sala onde ninguém está.
  const atualRes = await sb(`eventos_live?slug=eq.${encodeURIComponent(slug)}&select=link_sala,recorrencia,recorrencia_dia`);
  const atual = atualRes.ok ? (await atualRes.json().catch(() => []))[0] : null;
  if (atual?.link_sala && !req.body?.forcar) {
    return res.status(200).json({ ok: true, ja_existia: true, link_sala: atual.link_sala });
  }

  const recorrencia = atual?.recorrencia === 'semanal' && atual.recorrencia_dia != null
    ? `RRULE:FREQ=WEEKLY;BYDAY=${DIA_RRULE[atual.recorrencia_dia]}`
    : null;

  let sala = null, eventoId = null;
  try {
    const r = await criarEventoAgenda({
      titulo: ev.titulo,
      descricao: `${ev.subtitulo || ''}\n\nInscrições: https://www.bidprobrasil.com.br/#/live/${slug}`.trim(),
      inicioISO: ev.data_hora,
      duracaoMin: ev.duracao_min || 90,
      timeZone: 'America/Bahia',
      comMeet: true,
      recorrencia,
    });
    sala = r?.meetLink || null;
    eventoId = r?.eventId || null;
  } catch (e) {
    return res.status(502).json({ error: `Google Calendar recusou: ${e?.message || e}` });
  }

  // Evento criado mas sem sala é falha DE VERDADE aqui: o propósito da rota é a sala.
  // Responder "ok" com link nulo faria o admin publicar uma aula sem endereço.
  if (!sala) {
    return res.status(502).json({
      error: 'O evento foi criado na agenda, mas o Google não devolveu a sala do Meet. Verifique se a conta tem o Meet habilitado e tente de novo, ou cole o link à mão.',
      evento_agenda: eventoId,
    });
  }

  const upd = await sb(`eventos_live?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ link_sala: sala }),
  });
  // `.select()` de volta é a prova de que gravou: um PATCH que não alcança nada devolve
  // 200 com lista vazia, e a sala existiria só na agenda, nunca na página.
  const linhas = upd.ok ? await upd.json().catch(() => []) : [];
  if (!linhas.length) {
    return res.status(500).json({
      error: 'A sala foi criada mas não conseguimos salvá-la no evento. Copie e cole manualmente.',
      link_sala: sala,
    });
  }

  return res.status(200).json({ ok: true, link_sala: sala, evento_agenda: eventoId, recorrente: !!recorrencia });
}
