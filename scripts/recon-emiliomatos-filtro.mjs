/**
 * Recon do FILTRO DE ABERTOS — emiliomatos (Superbid/MBV).
 * A listagem /busca/segmento/imoveis mostra também leilões ENCERRADOS (os 6 primeiros no
 * dry-run estavam todos fechados). Este recon: (1) dumpa a UI de filtro (situação/praça/
 * aberto/encerrado) da listagem, (2) testa URLs candidatas de "abertos" e, para cada uma
 * que responder, amostra 2 lotes reais e diz se estão ABERTOS (via estaEncerrado da lib).
 * Bright Data DIRETO (fora da cota). Não grava nada.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
import { BASE, extrairUrlsDeLote, parseDetalhe } from './lib/emiliomatos-parse.mjs';
import { fetchUnlockerContado } from './lib/bd-ledger.mjs';

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bd(url, timeoutMs = 60000) {
  const r = await fetchUnlockerContado({
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, html: await r.text().catch(() => '') };
}
const KW = /(situa|status|praca|praça|aberto|abertos|agendad|andamento|recebendo|encerrad|finaliz|filtro|leiloes-abertos|ativos?)/i;

async function amostra(url, n = 2) {
  const l = await bd(url);
  const lotes = [...extrairUrlsDeLote(l.html).values()];
  let abertos = 0, enc = 0;
  for (const u of lotes.slice(0, n)) {
    const d = await bd(u);
    const det = parseDetalhe(d.html, u);
    if (det.encerrado) enc++; else abertos++;
  }
  return { status: l.status, lotes: lotes.length, abertos, enc, testados: Math.min(n, lotes.length) };
}

(async () => {
  console.log('Recon filtro de abertos — emiliomatos\n');
  const base = await bd(`${BASE}/busca/segmento/imoveis`);
  console.log(`listagem HTTP ${base.status}  len=${base.html.length}\n`);

  // (1) hrefs de filtro
  const hrefs = [...new Set([...base.html.matchAll(/href=["']([^"']*\/busca[^"']*)["']/gi)].map(m => m[1]))]
    .filter(h => KW.test(h));
  console.log(`HREFS de filtro (${hrefs.length}):`);
  hrefs.slice(0, 30).forEach(h => console.log('   ' + h));

  // (2) options / inputs de filtro
  const opts = [...new Set([...base.html.matchAll(/<(?:option|input|a)[^>]*(?:value|data-[\w-]+|href)=["']([^"']+)["'][^>]*>([^<]{0,40})/gi)]
    .filter(m => KW.test(m[1] + ' ' + m[2])).map(m => `${m[1]} → ${m[2].trim()}`))];
  console.log(`\nOPTIONS/INPUTS de filtro (${opts.length}):`);
  opts.slice(0, 30).forEach(o => console.log('   ' + o));

  // (3) contexto cru em torno das palavras-chave (nomes de parâmetro / atributos)
  const ctx = [...new Set([...base.html.matchAll(/.{0,30}(?:situacao|situaç|tipoPraca|tipo_praca|status|leiloes-abertos|em-andamento|agendad|encerrad)[^"'<>]{0,30}/gi)].map(m => m[0].replace(/\s+/g, ' ').trim()))];
  console.log(`\nCONTEXTO de parâmetros (${ctx.length}):`);
  ctx.slice(0, 20).forEach(c => console.log('   ' + c));

  // (4) testa candidatas (hrefs achados + convenções Superbid/MBV comuns)
  const candidatas = [...new Set([
    ...hrefs.map(h => (h.startsWith('http') ? h : BASE + h)),
    `${BASE}/busca/segmento/imoveis?situacao=abertos`,
    `${BASE}/busca/segmento/imoveis?situacao=em_andamento`,
    `${BASE}/busca/segmento/imoveis?status=aberto`,
    `${BASE}/busca/leiloes-abertos/segmento/imoveis`,
    `${BASE}/busca/segmento/imoveis/situacao/abertos`,
  ])].slice(0, 8);
  console.log(`\n═══ TESTE de ${candidatas.length} candidata(s) (2 lotes cada) ═══`);
  for (const c of candidatas) {
    try {
      const r = await amostra(c, 2);
      console.log(`   ${c}\n      HTTP ${r.status} · lotes ${r.lotes} · testados ${r.testados} → abertos ${r.abertos}, encerrados ${r.enc}`);
    } catch (e) { console.log(`   ${c}\n      ERRO ${e.message}`); }
  }
  console.log('\nAlvo do scraper = a candidata com lotes > 0 e abertos > 0. Se nenhuma abrir, o acervo de imóveis do emiliomatos pode estar sem praça ativa agora.');
})();
