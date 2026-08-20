/**
 * Probe de SSR — escolhe a PRÓXIMA família de leiloeiro fácil (pivô do Nordeste, que é SPA
 * App Router sem API/catálogo scrapeável). Para cada domínio candidato, baixa o HTML CRU (Bright
 * Data) de rotas prováveis de imóveis e mede: R$ no HTML (SSR traz lote → alto), links de lote,
 * fingerprint de plataforma. Alto R$ no HTML cru = SSR = fácil de raspar. NÃO grava nada.
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

const CANDIDATOS = (process.env.PROBE_DOMS ||
  'jussiaraleiloes.com.br,alfaleiloes.com.br,hastaleilao.com.br,lancecertoleiloes.com.br,sumareleiloes.com.br')
  .split(',').map(s => s.trim()).filter(Boolean);
const ROTAS = ['/', '/imoveis', '/leiloes', '/leiloes/imoveis', '/busca?tipo=imovel', '/categoria/imoveis', '/lotes'];

async function bdFetch(url, timeoutMs = 45000) {
  try {
    const r = await fetch('https://api.brightdata.com/request', {
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}

function fingerprint(html) {
  const f = [];
  if (/__NEXT_DATA__|\/_next\//.test(html)) f.push('Next.js');
  if (/wp-content|wp-json|wpcasa/.test(html)) f.push('WordPress');
  if (/__NUXT__|_nuxt\//.test(html)) f.push('Nuxt');
  if (/laravel|livewire|csrf-token/.test(html)) f.push('Laravel');
  if (/vue|v-app|data-v-/.test(html)) f.push('Vue');
  if (/ng-version|angular/.test(html)) f.push('Angular');
  if (/__vite|type="module"/.test(html)) f.push('Vite');
  if (/aspnet|__VIEWSTATE|asp\.net/i.test(html)) f.push('ASP.NET');
  return f.join(',') || 'genérico/SSR';
}
function sinais(html) {
  return {
    reais: (html.match(/R\$\s?[\d.]+,\d{2}/g) || []).length,
    hrefLote: [...new Set([...html.matchAll(/href=["']([^"']*(?:lote|imovel|leilao\/[^"']*\/)[^"']*)["']/gi)].map(m => m[1]))].slice(0, 4),
    len: html.length,
  };
}

(async () => {
  for (const dom of CANDIDATOS) {
    console.log(`\n╔══════ ${dom} ══════╗`);
    let melhor = null;
    for (const rota of ROTAS) {
      const url = `https://www.${dom}${rota}`;
      const r = await bdFetch(url);
      if (r.status !== 200 || !r.body) { console.log(`  ${rota} → HTTP ${r.status}${r.err ? ' ' + r.err : ''}`); continue; }
      const s = sinais(r.body);
      const fp = fingerprint(r.body);
      console.log(`  ${rota} → 200 · ${s.len}b · R$=${s.reais} · [${fp}]${s.hrefLote.length ? ' · ' + JSON.stringify(s.hrefLote) : ''}`);
      if (!melhor || s.reais > melhor.reais) melhor = { rota, ...s, fp };
    }
    if (melhor) {
      const veredito = melhor.reais >= 10 ? '✅ SSR FÁCIL (lotes no HTML cru)' : melhor.reais > 0 ? '🟡 parcial' : '❌ SPA/sem lotes no HTML';
      console.log(`  → melhor: ${melhor.rota} (R$=${melhor.reais}) [${melhor.fp}] ${veredito}`);
    }
  }
  console.log('\nEscolher o de MAIOR R$ no HTML cru — é o próximo scraper (SSR = mais barato/estável).');
})();
