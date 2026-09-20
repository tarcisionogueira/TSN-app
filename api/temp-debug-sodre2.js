// TEMPORÁRIO — investiga se dá pra ler o resultado da SODRE sem headless browser: (a) o bloco
// __NUXT_DATA__ INTEIRO tem o preço/status em algum lugar mais adiante? (b) a API por trás
// (prd-api.sodresantoro.com.br) responde direto com o lote, sem sessão? Remove depois.
export const config = { runtime: 'nodejs', maxDuration: 60 };
import { isCronAuthorized } from './_auth.js';
import { fetchLote } from './enriquecer-lote.js';
import { fetchExternoSeguro } from './_allowed-hosts.js';

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  const url = 'https://leilao.sodresantoro.com.br/leilao/29005/lote/2804970/';
  let html = '';
  try { ({ html } = await fetchLote(url, { proposito: 'geral' })); } catch { html = ''; } // padrao-ok: diagnóstico best-effort

  // Isola o conteúdo do script __NUXT_DATA__ inteiro (do id até o </script> de fechamento).
  const ini = html.indexOf('id="__NUXT_DATA__"');
  let nuxtJson = null, nuxtLen = 0, achadosNoBloco = {};
  if (ini >= 0) {
    const abreTag = html.indexOf('>', ini) + 1;
    const fecha = html.indexOf('</script>', abreTag);
    nuxtJson = fecha > abreTag ? html.slice(abreTag, fecha) : null;
    nuxtLen = nuxtJson ? nuxtJson.length : 0;
    if (nuxtJson) {
      for (const kw of ['9000', '9.000', '"amount"', '"value"', '"price"', '"bid"', '"lance"', 'valor', 'preco', 'preço', 'status', 'situacao', 'situação', 'vendido', 'VENDIDO', 'sold', 'closed', 'winner', 'vencedor']) {
        const idxs = [];
        let pos = -1;
        while ((pos = nuxtJson.indexOf(kw, pos + 1)) >= 0 && idxs.length < 3) idxs.push(pos);
        if (idxs.length) achadosNoBloco[kw] = idxs.map(i => nuxtJson.slice(Math.max(0, i - 40), i + 80));
      }
    }
  }

  // Tenta a API direta com alguns padrões plausíveis (REST comum).
  const apiBase = 'https://prd-api.sodresantoro.com.br';
  const candidatos = [
    `${apiBase}/lots/2804970`,
    `${apiBase}/lotes/2804970`,
    `${apiBase}/api/lots/2804970`,
    `${apiBase}/auctions/29005/lots/2804970`,
    `${apiBase}/leiloes/29005/lotes/2804970`,
    `${apiBase}/v1/lots/2804970`,
  ];
  const apiTentativas = [];
  for (const u of candidatos) {
    try {
      const r = await fetchExternoSeguro(u, { headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(6000) });
      const txt = await r.text().catch(() => '');
      apiTentativas.push({ url: u, status: r.status, len: txt.length, amostra: txt.slice(0, 300) });
    } catch (e) {
      apiTentativas.push({ url: u, erro: String(e.message || e).slice(0, 150) });
    }
  }

  res.status(200).json({ ok: true, html_len: html.length, nuxtLen, achadosNoBloco, apiTentativas });
}
