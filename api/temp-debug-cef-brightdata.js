// TEMPORÁRIO — testa se, com a sub-cota 'geral' do Bright Data subida (21/09), o Web
// Unlocker consegue passar pelo bloqueio de IP da Caixa (CEF). Remove depois do teste.
export const config = { runtime: 'nodejs', maxDuration: 60 };
import { isCronAuthorized } from './_auth.js';
import { fetchLote } from './enriquecer-lote.js';
import { apurarResultadoDoTexto } from './_resultado-leilao.js';

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  const url = String(req.query?.url || '');
  if (!url) { res.status(400).json({ error: 'url obrigatória' }); return; }
  let html = '', via = null;
  try { ({ html, via } = await fetchLote(url, { proposito: 'geral' })); } catch (e) { res.status(200).json({ ok: false, erro: String(e?.message || e).slice(0, 200) }); return; }
  const achado = html ? apurarResultadoDoTexto(html) : null;
  let achadosKw = {};
  if (html) {
    const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
    const txtLower = txt.toLowerCase();
    for (const kw of ['chassi', 'renavam', 'placa', 'marca', 'modelo', 'mmc', 'combust', 'câmbio', 'cor']) {
      const idxs = [];
      let pos = -1;
      while ((pos = txtLower.indexOf(kw, pos + 1)) >= 0 && idxs.length < 3) idxs.push(pos);
      if (idxs.length) achadosKw[kw] = idxs.map(i => txt.slice(Math.max(0, i - 60), i + 100));
    }
  }
  res.status(200).json({ ok: true, via, html_len: html.length, achado, achadosKw, amostra: html ? html.slice(0, 300) : null });
}
