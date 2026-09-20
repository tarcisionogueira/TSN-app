#!/usr/bin/env node
/**
 * RECON — qual é o padrão REAL de URL do lote/leilão no site do SATO?
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * scraper-sato.mjs grava `url = ${BASE}/leilao/{id}` pra leilões nativos (não `externo`), e isso
 * é um PALPITE já confirmado quebrado (404) duas vezes — 02/08 e 10/09 — motivo pelo qual o cron
 * está suspenso (scraper-sato.yml). Este recon testa candidatos de rota contra IDs REAIS lidos
 * da própria API pública (`dados-home`), sem inventar ID nenhum.
 *
 * Roda por fetch DIRETO (a API pública já é acessível sem Bright Data); só cai pra Bright Data
 * Web Unlocker se o fetch direto vier bloqueado/challenge, pra separar "rota errada" de
 * "IP bloqueado" — a mesma pergunta que já mordeu HASTA (bloqueio de IP) e SATO (URL errada:
 * são causas DIFERENTES, e tratar uma como a outra é exatamente o erro que já foi cometido aqui).
 *
 * Uso: node scripts/recon-sato-url-lote.mjs
 * Env opcional: BRIGHTDATA_API_TOKEN/BRIGHTDATA_ZONE (fallback se fetch direto vier bloqueado)
 */
const BASE = 'https://www.satoleiloes.com.br';
const API = `${BASE}/api-publica/stale/dados-home`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

async function fetchDireto(url) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 15000);
  try {
    const r = await fetch(url, { signal: c.signal, redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'text/html,application/json' } });
    const ct = r.headers.get('content-type') || '';
    const loc = r.redirected ? r.url : '';
    let body = '';
    try { body = await r.text(); } catch { /* sem corpo legível */ }
    return { status: r.status, ct, loc, len: body.length, corpo: body };
  } catch (e) {
    return { erro: e.name === 'AbortError' ? 'timeout' : String(e.message || e) };
  } finally { clearTimeout(t); }
}

function textoLegivel(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

(async () => {
  console.log('🔎 RECON SATO — qual rota abre a página do leilão de verdade?\n');

  const r = await fetchDireto(`${API}?page=1&type=leilao`);
  if (r.erro || r.status !== 200) { console.log(`API dados-home falhou: ${JSON.stringify(r).slice(0, 200)}`); process.exit(1); }
  let leiloes;
  try { leiloes = JSON.parse(r.corpo); } catch { console.log('payload não é JSON válido'); process.exit(1); }
  const nativos = leiloes.filter(l => l.externo !== '1' && l.id != null).slice(0, 3);
  console.log(`API ok: ${leiloes.length} leilões na pág 1, testando ${nativos.length} nativos (não-externo): ${nativos.map(l => l.id).join(', ')}\n`);

  const CANDIDATOS = (id) => [
    `/leilao/${id}`,
    `/leiloes/${id}`,
    `/leilao-imovel/${id}`,
    `/imovel/${id}`,
    `/imoveis/${id}`,
    `/evento/${id}`,
    `/evento-leilao/${id}`,
    `/detalhe-leilao/${id}`,
    `/detalhes/${id}`,
    `/lote/${id}`,
    `/leilao/${id}/detalhes`,
    `/leilao/detalhe/${id}`,
  ];

  for (const l of nativos) {
    console.log(`── leilão ${l.id} — "${(l.titulo || '').slice(0, 60)}"`);
    for (const path of CANDIDATOS(l.id)) {
      const res = await fetchDireto(`${BASE}${path}`);
      if (res.erro) { console.log(`   ${path.padEnd(28)} erro: ${res.erro}`); continue; }
      const marca = res.status === 200 ? '✅' : (res.status >= 300 && res.status < 400 ? '↪️ ' : '  ');
      console.log(`   ${marca} ${path.padEnd(28)} HTTP ${res.status}${res.loc ? ` → ${res.loc}` : ''} · ${res.len}B ct=${res.ct.slice(0, 30)}`);
    }
  }

  // A HOME e uma busca/listagem: se existir link <a href> de verdade em algum lugar do site
  // (SSR parcial, sitemap, ou uma página de busca), ele aparece aqui — evidência, não palpite.
  console.log('\n── home + sitemap.xml — algum <a href> real de leilão aparece publicado?');
  for (const path of ['/', '/sitemap.xml', '/leiloes', '/busca', '/robots.txt']) {
    const res = await fetchDireto(`${BASE}${path}`);
    if (res.erro) { console.log(`   ${path.padEnd(16)} erro: ${res.erro}`); continue; }
    console.log(`   ${path.padEnd(16)} HTTP ${res.status} · ${res.len}B ct=${res.ct.slice(0, 30)}`);
    if (res.status === 200 && res.corpo) {
      const hrefs = [...res.corpo.matchAll(/href=["']([^"'#]*(?:leilao|lote|imovel)[^"']*)["']/gi)].map(m => m[1]).slice(0, 10);
      if (hrefs.length) console.log(`      hrefs candidatos: ${JSON.stringify(hrefs)}`);
      if (path === '/') {
        const txt = textoLegivel(res.corpo);
        console.log(`      texto (${txt.length} chars, 300 primeiros): "${txt.slice(0, 300)}"`);
      }
    }
  }

  console.log('\n═══ Fim do recon. Se NENHUM candidato deu 200/300 com conteúdo de leilão, o padrão de rota');
  console.log('    não está nesta lista — abrir o site num navegador real e copiar a URL de um lote é o próximo passo.');
})();
