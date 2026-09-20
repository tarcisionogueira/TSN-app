// TEMPORÁRIO — diagnóstico do porquê `resultado_leilao='sem_lance'` está em 0 (21/09).
// Roda no servidor (Vercel) pra ter o mesmo caminho de rede do cron real (fetchLote com
// fallback Bright Data) — de dentro do sandbox as páginas dão 403 direto. Remove depois.
export const config = { runtime: 'nodejs', maxDuration: 60 };
import { isCronAuthorized } from './_auth.js';
import { fetchLote } from './enriquecer-lote.js';
import { apurarResultadoDoTexto } from './_resultado-leilao.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  const ids = String(req.query?.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  const r = ids.length
    ? await sb(`imoveis_leilao?id=in.(${ids.join(',')})&select=id,fonte,url_lote,link_edital`)
    : await sb(`imoveis_leilao?resultado_leilao=eq.indeterminado&select=id,fonte,url_lote,link_edital&order=resultado_apurado_em.desc&limit=6`);
  const rows = await r.json(); // padrao-ok: script descartável de diagnóstico, sem checagem — se r falhar, rows vem vazio e o loop abaixo não roda
  const out = [];
  for (const im of rows) {
    const alvo = im.url_lote || im.link_edital;
    let html = '';
    try { ({ html } = await fetchLote(alvo, { proposito: 'geral' })); } catch { html = ''; } // padrao-ok: diagnóstico best-effort, item aparece com html_len:0
    const achado = apurarResultadoDoTexto(html);
    const txt = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
    const trechos = {};
    for (const kw of ['vendid', 'arrematad', 'sem lance', 'sem licitante', 'deserto', 'não vendid', 'nao vendid', 'encerrad', 'insucesso']) {
      const i = txt.toLowerCase().indexOf(kw);
      if (i >= 0) trechos[kw] = txt.slice(Math.max(0, i - 70), i + 100);
    }
    out.push({ id: im.id, fonte: im.fonte, alvo, html_len: html.length, achado, trechos });
  }
  res.status(200).json({ ok: true, out });
}
