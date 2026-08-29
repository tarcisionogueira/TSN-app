import { fetchUnlockerContado } from './lib/bd-ledger.mjs';
/**
 * MAPA DE FONTES (recon consolidado, Bright Data AUTORIZADO pelo dono 20/08) — mapeia o FLUXO
 * de cada família pendente para redesenharmos a arquitetura de captura depois. Para CADA família:
 *   • fingerprint de plataforma (Next/Nuxt/Vite/Laravel/ASP.NET/SUPORTE…)
 *   • ONDE moram os dados: HTML cru (SSR) · blob JSON embutido · RSC flight · API separada · só DOM
 *   • bloqueio: Cloudflare/BD-gated? · teto?
 *   • padrão de URL de lote + contagem de R$ no HTML cru
 *   • VEREDITO: pronto-p/-scrape-SSR · precisa-DOM(Puppeteer) · precisa-API-recon · precisa-residencial
 * NÃO grava nada. Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

const FAMILIAS = [
  { nome: 'hasta (Flávio Costa)', base: 'https://www.hastaleilao.com.br', listas: ['/'] },
  { nome: 'jussiara', base: 'https://www.jussiaraleiloes.com.br', listas: ['/', '/imoveis'] },
  { nome: 'alfaleiloes', base: 'https://www.alfaleiloes.com.br', listas: ['/', '/imoveis'] },
  { nome: 'lancecerto', base: 'https://www.lancecertoleiloes.com.br', listas: ['/', '/imoveis'] },
  { nome: 'sumare', base: 'https://www.sumareleiloes.com.br', listas: ['/', '/leiloes/imoveis'] },
  { nome: 'leilaobrasil (SUPORTE?)', base: 'https://www.leilaobrasil.com.br', listas: ['/', '/buscador?categoria=2'] },
];

async function bd(url, timeoutMs = 30000) {
  try {
    const r = await fetchUnlockerContado({
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}

function plataforma(h) {
  const t = [];
  if (/__NEXT_DATA__|\/_next\//.test(h)) t.push('Next(Pages)');
  if (/self\.__next_f|__next_f\.push/.test(h)) t.push('Next(App/RSC)');
  if (/__NUXT__|_nuxt\//.test(h)) t.push('Nuxt');
  if (/\/assets\/index-[\w]+\.js|type=["']module["']/.test(h) && !/_next|_nuxt/.test(h)) t.push('Vite');
  if (/laravel|livewire|csrf-token/i.test(h)) t.push('Laravel');
  if (/__VIEWSTATE|asp\.net|aspnet/i.test(h)) t.push('ASP.NET');
  if (/suporteleiloes|buscador\?categoria/i.test(h)) t.push('SUPORTE');
  if (/cloudflare|cf-ray|challenge-platform|Just a moment/i.test(h)) t.push('Cloudflare');
  return t.length ? t.join(',') : 'genérico';
}
function ondeDados(h) {
  const s = [];
  if (/<script[^>]+type=["']application\/(ld\+)?json["'][^>]*>[\s\S]{80,}?<\/script>/i.test(h)) s.push('JSON-script');
  if (/window\.__(INITIAL_STATE|PRELOADED_STATE|DATA|APP)__|__INITIAL_STATE__/.test(h)) s.push('blob-window');
  if (/self\.__next_f/.test(h)) s.push('RSC-flight');
  if (/__NEXT_DATA__/.test(h)) s.push('NEXT_DATA');
  if (/__NUXT__/.test(h)) s.push('NUXT-state');
  return s.length ? s.join(',') : '(nenhum blob óbvio)';
}
const urlLote = (h) => {
  const pats = [/\/lote\/\d+/, /\/imovel\/[\w-]+/, /\/imoveis\/[\w-]+/, /lote_id\/\d+/, /\/leilao\/[\w-]+\/\d+/, /\/detalhe\/\d+/, /\/bem\/\d+/];
  for (const p of pats) { const m = h.match(new RegExp(`href=["']([^"']*${p.source}[^"']*)`, 'i')); if (m) return m[1]; }
  return null;
};

(async () => {
  for (const f of FAMILIAS) {
    console.log(`\n╔══════ ${f.nome} · ${f.base} ══════╗`);
    let melhor = null;
    for (const rota of f.listas) {
      const r = await bd(f.base + rota);
      const reais = (r.body.match(/R\$\s?[\d.]+,\d{2}/g) || []).length;
      const plat = plataforma(r.body);
      const lote = urlLote(r.body);
      console.log(`  ${rota} → ${r.status} · ${r.body.length}b · R$=${reais} · [${plat}] · dados=${ondeDados(r.body)} · lote=${lote || '—'}`);
      if (!melhor || reais > melhor.reais) melhor = { rota, reais, plat, lote, body: r.body };
    }
    // Veredito pela evidência.
    let veredito;
    if (/Cloudflare/.test(melhor.plat) || melhor.reais === 0 && melhor.body.length < 3000) veredito = '⛔ BD-gated/Cloudflare (ou shell) — precisa BD sempre';
    else if (melhor.reais >= 10 && melhor.lote) veredito = '✅ SSR — lotes no HTML cru → parser direto (barato)';
    else if (/RSC-flight|NEXT_DATA|NUXT-state|blob-window|JSON-script/.test(ondeDados(melhor.body))) veredito = '🟡 SPA c/ BLOB embutido → parsear o JSON do HTML (médio)';
    else if (melhor.reais > 0) veredito = '🟡 SSR parcial — lotes no HTML mas sem padrão de URL claro → recon fino';
    else veredito = '🔴 SPA sem blob → precisa Puppeteer (DOM) ou achar API/XHR';
    console.log(`  → melhor: ${melhor.rota} (R$=${melhor.reais}) · VEREDITO: ${veredito}`);
  }
  console.log('\n══ FIM DO MAPA ══');
})();
