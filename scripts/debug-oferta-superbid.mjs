#!/usr/bin/env node
/**
 * DEBUG pontual — despeja os campos de DATA de uma oferta da Superbid (23/08/2026).
 *
 * Caso Ville de Lyon: leilão judicial com suspeita de 1ª/2ª praça — nós gravamos só
 * o `endDate` da API de listagem. Este script abre a página pública da oferta, lê o
 * JSON embutido (__NEXT_DATA__/estado da app) e imprime TODO caminho cujo nome ou
 * valor pareça data — para enxergar onde a 1ª praça mora antes de mexer no scraper.
 * Roda no runner do GitHub (a sessão remota tem proxy que bloqueia o domínio).
 *
 * Env: OFERTA_ID (default 4854341).
 */
const ID = process.env.OFERTA_ID || '4854341';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function acharJsons(html) {
  const blocos = [];
  const re = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const t = m[1].trim();
    if (t.startsWith('{') && t.length > 500) {
      try { blocos.push(JSON.parse(t)); } catch { /* não é JSON puro */ }
    }
  }
  return blocos;
}

const PARECE_DATA = /^\d{4}-\d{2}-\d{2}[T ]|\d{2}\/\d{2}\/\d{4}/;
const NOME_DATA = /date|data|pra[cç]a|leilao|auction|end|start|close|open/i;

function varrer(obj, caminho, saida) {
  if (saida.length > 400) return;
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) varrer(v, caminho ? `${caminho}.${k}` : k, saida);
  } else if (typeof obj === 'string' || typeof obj === 'number') {
    const s = String(obj);
    const chave = caminho.split('.').slice(-2).join('.');
    if (PARECE_DATA.test(s) && (NOME_DATA.test(chave) || PARECE_DATA.test(s))) {
      if (PARECE_DATA.test(s)) saida.push(`${caminho} = ${s.slice(0, 40)}`);
    }
  }
}

async function main() {
  const url = `https://www.superbid.net/oferta/${ID}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow' });
  console.log(`[debug-sbid] GET ${url} -> ${r.status}`);
  if (!r.ok) { console.error('página não veio; nada a inspecionar'); process.exit(1); }
  const html = await r.text();
  console.log(`[debug-sbid] html=${html.length} bytes`);

  // 1) Datas imprimíveis no HTML cru (o que um leitor/robô vê).
  const impressas = [...new Set((html.match(/\d{2}\/\d{2}\/\d{4}(?:\s+[àa]s?\s+\d{1,2}[:h]\d{2})?/g) || []))].slice(0, 20);
  console.log('IMPRESSAS ' + JSON.stringify(impressas));

  // 2) Campos de data nos JSONs embutidos, com o caminho completo.
  const blocos = acharJsons(html);
  console.log(`[debug-sbid] blocos_json=${blocos.length}`);
  const saida = [];
  blocos.forEach((b, i) => varrer(b, `json${i}`, saida));
  // Só caminhos com cara de leilão/praça/fim — o resto é ruído de build/SEO.
  const relevantes = saida.filter(l => NOME_DATA.test(l.split(' = ')[0].split('.').slice(-3).join('.')));
  for (const l of relevantes.slice(0, 120)) console.log('CAMPO ' + l);
  if (!relevantes.length) for (const l of saida.slice(0, 60)) console.log('CAMPO? ' + l);
}

main().catch(e => { console.error('[debug-sbid] FALHOU:', e?.message || e); process.exit(1); });
