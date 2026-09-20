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
  res.status(200).json({ ok: true, via, html_len: html.length, achado, amostra: html ? html.slice(0, 300) : null });
}
