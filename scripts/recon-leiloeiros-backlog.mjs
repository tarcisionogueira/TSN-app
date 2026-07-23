/**
 * Recon em LOTE dos leiloeiros do backlog TRT-15 que estão em 0-acervo — classifica a
 * PLATAFORMA/tenant de cada site (white-label? API JSON? CDN conhecido? challenge?) para
 * decidir QUAL scraper escrever (recon-first). Só DIAGNOSTICA: não grava nada no banco.
 *
 * Roda no GitHub Actions (egress liberado) via Bright Data Web Unlocker — os sites batem
 * 403 no IP de datacenter (Vercel/CI). 1 request por domínio (só a home).
 *
 * ⚠️ TETO DE CUSTO no próprio script (RECON_MAX, default 30): esta via chama a API do
 * Bright Data DIRETO, então NÃO passa pela cota semanal (450) do api/_brightdata.js — a
 * trava tem que ser aqui. O script para sozinho ao atingir o teto.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, [RECON_MAX], [RECON_DOMINIOS csv].
 */

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE  = process.env.BRIGHTDATA_ZONE;
const RECON_MAX = parseInt(process.env.RECON_MAX || '30', 10);

// 0-acervo do docs/LEILOEIROS_TRT15_BACKLOG.md (precisam de scraper dedicado) + alguns
// parciais de alto valor p/ ver a estrutura do site próprio.
const DOMINIOS_PADRAO = [
  'alfaleiloes.com', 'gustavoreisleiloes.com.br', '3torresleiloes.com.br', 'destakleiloes.com.br',
  'zaccarino.com.br', 'verdeamareloleiloes.com.br', 'calilleiloes.com.br', 'extrajustleiloes.com.br',
  'lancetotal.com.br', 'lancenoleilao.com.br', 'granadoleiloes.com.br', 'valeroleiloes.com.br',
  'hisaleiloes.com.br', 'satoleiloes.com.br', 'osvaldoleiloes.com.br', 'elizabethseoanes.com.br',
  'crepaldileiloes.com.br', 'e-confianca.com.br', 'sudesteleiloes.com.br', 'delanoleiloes.com.br',
  'vegasleiloes.com.br', 'picellileiloes.com.br', 'shiokawaleiloes.com.br', 'capitalvalorleiloes.com.br',
  'sanchesleiloes.com.br', 'eduardosorgileiloeiro.com.br', 'sumareleiloes.com.br',
];
const DOMINIOS = (process.env.RECON_DOMINIOS || '').trim()
  ? process.env.RECON_DOMINIOS.split(',').map(s => s.trim()).filter(Boolean)
  : DOMINIOS_PADRAO;

// Marcadores de plataforma conhecida (white-label / rede) → 1 scraper onboarda vários.
const PLATAFORMAS = [
  { nome: 'SUPORTE (white-label — JÁ RASPAMOS)', re: /suporteleiloes|static\.suporteleiloes/i },
  { nome: 'LEILOTECH (white-label)', re: /leilotech/i },
  { nome: 'SUPERBID/SODRÉ (rede)', re: /superbid|sodresantoro/i },
  { nome: 'Vlance', re: /vlance/i },
  { nome: 'NYX / plataformadeleiloes', re: /plataformadeleiloes|\bnyx\b/i },
  { nome: 'LJUD', re: /leiloesjudiciais|\bljud\b/i },
  { nome: 'MEGA', re: /megaleiloes/i },
  { nome: 'WordPress', re: /wp-content|wp-json/i },
];

let usados = 0;
async function bdFetch(url, timeoutMs = 60000) {
  const r = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  usados++;
  return { status: r.status, html: await r.text().catch(() => '') };
}

function classificar(html) {
  const plats = PLATAFORMAS.filter(p => p.re.test(html)).map(p => p.nome);
  const next = /id=["']__NEXT_DATA__["']/.test(html);
  const nuxt = /window\.__NUXT__/.test(html);
  const apis = [...new Set((html.match(/["'`](\/(?:api|v\d|graphql)\/[^"'`\s]{2,60})["'`]/gi) || []).map(s => s.replace(/["'`]/g, '')))].slice(0, 10);
  const jsonEnd = [...new Set((html.match(/\/[a-z0-9\-/]*(?:busca|search|lotes?|catalog|imove\w*|produtos?)[a-z0-9\-/]*\.json/gi) || []))].slice(0, 6);
  const cdns = [...new Set((html.match(/https?:\/\/([a-z0-9.\-]+\.(?:s3[.\-][a-z0-9.\-]*amazonaws\.com|cloudfront\.net|[a-z0-9\-]*cdn[a-z0-9\-.]*))/gi) || []).map(s => s.replace(/^https?:\/\//, '')))].slice(0, 8);
  const scripts = [...new Set((html.match(/<script[^>]+src=["']([^"']+)["']/gi) || []).map(s => (s.match(/src=["']([^"']+)/i) || [])[1]).filter(u => u && /leilo|lote|catalog|plataforma|cdn|static/i.test(u)))].slice(0, 10);
  const loteLinks = [...new Set((html.match(/\/(?:oferta|lote|imovel|leilao|bem)[^"'\s)]{0,40}/gi) || []))].slice(0, 10);
  const cloudflare = /just a moment|challenge-platform|cf-chl|cf-mitigated/i.test(html);
  const titulo = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  const generator = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i) || [])[1] || '';
  return { plats, next, nuxt, apis, jsonEnd, cdns, scripts, loteLinks, cloudflare, titulo, generator };
}

(async () => {
  if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes — abortando (nada gasto).'); process.exit(1); }
  console.log(`Recon backlog — ${DOMINIOS.length} domínios · teto ${RECON_MAX} requests Bright Data.\n`);
  const resumo = [];
  for (let i = 0; i < DOMINIOS.length; i++) {
    const dom = DOMINIOS[i];
    if (usados >= RECON_MAX) {
      console.log(`\n⛔ Teto de ${RECON_MAX} requests atingido — parando. Não reconhecidos: ${DOMINIOS.slice(i).join(', ')}`);
      break;
    }
    const url = `https://www.${dom.replace(/^www\./, '')}/`;
    try {
      const { status, html } = await bdFetch(url);
      const c = classificar(html);
      console.log(`\n════ ${dom}  → HTTP ${status}  len=${html.length}${c.cloudflare ? '  (challenge)' : ''}`);
      console.log(`   título: ${c.titulo}`);
      if (c.generator) console.log(`   generator: ${c.generator}`);
      console.log(`   PLATAFORMA(s): ${c.plats.length ? c.plats.join(' | ') : '— (independente?)'}  next=${c.next} nuxt=${c.nuxt}`);
      if (c.apis.length) console.log(`   APIs: ${JSON.stringify(c.apis)}`);
      if (c.jsonEnd.length) console.log(`   JSON: ${JSON.stringify(c.jsonEnd)}`);
      if (c.cdns.length) console.log(`   CDNs: ${JSON.stringify(c.cdns)}`);
      if (c.scripts.length) console.log(`   scripts: ${JSON.stringify(c.scripts)}`);
      if (c.loteLinks.length) console.log(`   links lote: ${JSON.stringify(c.loteLinks)}`);
      resumo.push({ dom, status, plats: c.plats, next: c.next, nuxt: c.nuxt, hasApi: c.apis.length > 0 || c.jsonEnd.length > 0, cloudflare: c.cloudflare });
    } catch (e) {
      console.log(`\n════ ${dom}  → ERRO: ${String(e.message).slice(0, 120)}`);
      resumo.push({ dom, status: 'ERRO', erro: String(e.message).slice(0, 80) });
    }
  }
  // Agrupa por plataforma p/ planejar os scrapers (alavancas primeiro).
  console.log(`\n\n═══════════ RESUMO (${usados} requests Bright Data usados) ═══════════`);
  const porPlat = {};
  for (const r of resumo) {
    const k = (r.plats && r.plats.length) ? r.plats.join('+') : (r.status === 'ERRO' ? 'ERRO' : 'INDEPENDENTE');
    (porPlat[k] ??= []).push(r.dom);
  }
  for (const [k, doms] of Object.entries(porPlat).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${k} (${doms.length}): ${doms.join(', ')}`);
  }
  console.log(`\nJSON:\n${JSON.stringify(resumo)}`);
})();
