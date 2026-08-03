/**
 * /api/enriquecer-datas-cron — preenche a DATA do próximo leilão de imóveis de
 * leiloeiro que não trazem a data na coleta (ex.: ZUK/Portal Zuk), buscando na
 * PÁGINA DO LOTE. Só processa quem tem um link de lote REAL (com caminho, não a
 * home do leiloeiro) — assim inclui ZUK e ignora agregadores cujo link é só o
 * domínio (LJUD), evitando gastar Bright Data à toa.
 *
 * Conservador e barato: lote pequeno por execução, respeita o TETO semanal do
 * Bright Data (fetchViaBrightData corta sozinho no teto) e grava enriquecido_em
 * para revezar os imóveis a cada rodada. Roda algumas vezes ao dia (vercel.json).
 * CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { fetchLote, extrairDatasLeilao } from './enriquecer-lote.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LOTE_MAX = parseInt(process.env.ENRIQUECER_DATAS_LOTE || '40', 10); // teto de páginas por execução

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // Candidatos: leiloeiro (não-CEF), sem data, não venda direta, com link de lote
  // REAL (link_edital com caminho após o domínio). Menos recentes primeiro.
  // PostgREST: usa order com nullsfirst p/ pegar os nunca tentados antes.
  // Falta data = sem INÍCIO **ou** sem ENCERRAMENTO. Antes o filtro era só
  // `data_leilao=is.null`, então um lote com data de início parecia resolvido e nunca era
  // revisitado — o prazo real (o que decide o lance) nunca era capturado. Foi assim que o
  // `gl_28450` ficou mostrando 03/08 num leilão aberto até 03/11.
  const filtro = [
    'or=(data_leilao.is.null,data_leilao_2.is.null)',
    'fonte=not.in.(CEF,caixa)',
    'modalidade=not.ilike.*venda*direta*',
    'link_edital=ilike.*//*/*', // tem barra após o domínio → página de lote, não home
    'select=id,link_edital,url_lote,modalidade,data_leilao,data_leilao_2',
    'order=enriquecido_em.asc.nullsfirst',
    `limit=${LOTE_MAX}`,
  ].join('&');

  const candidatos = await (await sb(`imoveis_leilao?${filtro}`)).json().catch(() => []);
  if (!Array.isArray(candidatos) || !candidatos.length) {
    res.status(200).json({ ok: true, processados: 0, com_data: 0, motivo: 'sem_candidatos' }); return;
  }

  let comData = 0, comFim = 0, semConteudo = 0;
  const agora = new Date().toISOString();
  for (const im of candidatos) {
    const alvo = im.url_lote || im.link_edital;
    if (!alvo || !/^https?:\/\//.test(alvo)) continue;
    const { html } = await fetchLote(alvo);
    const patch = { enriquecido_em: agora };
    if (html) {
      const { inicio, fim } = extrairDatasLeilao(html);
      if (inicio && !im.data_leilao) { patch.data_leilao = inicio; comData++; }
      if (fim && !im.data_leilao_2) { patch.data_leilao_2 = fim; comFim++; }
    } else {
      semConteudo++;
      // Sem conteúdo costuma ser teto do Bright Data atingido → para de martelar.
      if (semConteudo >= 5) { await marcar(im.id, patch); break; }
    }
    await marcar(im.id, patch);
  }

  res.status(200).json({ ok: true, processados: candidatos.length, com_data: comData, com_encerramento: comFim, sem_conteudo: semConteudo });
}

async function marcar(id, patch) {
  await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  }).catch(() => {});
}
