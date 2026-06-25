#!/usr/bin/env node
/**
 * Diagnóstico de scrapers — roda via GitHub Actions para testar cada site ao vivo.
 * node scripts/diagnostico-scrapers.mjs
 */
import https from 'https';
import http from 'http';

function get(url, headers = {}) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/json,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        ...headers,
      },
      timeout: 15000,
    }, res => {
      // Segue redirect manualmente (1 nível)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(res.headers.location, headers).then(resolve);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => { if (data.length < 8000) data += c; });
      res.on('end', () => resolve({ status: res.statusCode, size: data.length, body: data }));
    });
    req.on('error', e => resolve({ status: 0, error: e.message, body: '' }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, error: 'timeout', body: '' }); });
  });
}

// Testa cada URL e imprime status + preview HTML + links/valores encontrados
async function diagnosticar(nome, url, extraHeaders = {}) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`SITE: ${nome}`);
  console.log(`URL:  ${url}`);
  const r = await get(url, extraHeaders);
  console.log(`HTTP: ${r.status} | Tamanho: ${r.body.length} bytes`);
  if (r.error) { console.log(`ERRO: ${r.error}`); return; }

  // Preview dos primeiros 400 chars
  const preview = r.body.slice(0, 400).replace(/\s+/g, ' ');
  console.log(`PREVIEW: ${preview}`);

  // Busca valores R$ no HTML
  const valores = [...r.body.matchAll(/R\$\s*([\d.,]+)/g)].slice(0, 5).map(m => m[0]);
  if (valores.length) console.log(`VALORES encontrados: ${valores.join(' | ')}`);

  // Busca tags article, div class=card, etc.
  const articles = (r.body.match(/<article/gi) || []).length;
  const cards = (r.body.match(/class="[^"]*(?:card|lote|produto|item|lot)[^"]*"/gi) || []).length;
  const links = [...r.body.matchAll(/href="([^"]*(?:lote|imovel|produto)[^"]*)"/gi)].slice(0, 5).map(m => m[1]);
  console.log(`ARTICLES: ${articles} | CARDS: ${cards}`);
  if (links.length) console.log(`LINKS lote/imovel: ${links.join(' | ')}`);

  // Para APIs JSON — tenta parsear
  if (r.body.trim().startsWith('{') || r.body.trim().startsWith('[')) {
    try {
      const json = JSON.parse(r.body.slice(0, 4000));
      const keys = Array.isArray(json) ? `array[${json.length}]` : Object.keys(json).join(', ');
      console.log(`JSON keys/length: ${keys}`);
      if (Array.isArray(json) && json.length > 0) console.log(`Primeiro item keys: ${Object.keys(json[0]).join(', ')}`);
    } catch { console.log(`JSON parse falhou`); }
  }
}

console.log('🔍 Diagnóstico de Scrapers — TSN App');
console.log(new Date().toISOString());

// CEF (referência — deve funcionar sempre)
await diagnosticar('CEF CSV SP', 'https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_SP.csv');

// Superbid
await diagnosticar('Superbid SEO API', 'https://offer-query.superbid.net/seo/offers/?locale=pt_BR&portalId=[2,15]&pageNumber=1&pageSize=5&searchType=opened&categoryId=imoveis', { Origin: 'https://www.superbid.net', Referer: 'https://www.superbid.net/', Accept: 'application/json' });
await diagnosticar('Superbid v1 API', 'https://offer-query.superbid.net/v1/offer/search?locale=pt_BR&categorySlug=imoveis&pageNumber=1&pageSize=5&status=OPENED', { Origin: 'https://www.superbid.net', Accept: 'application/json' });
await diagnosticar('Superbid HTML', 'https://www.superbid.net/imoveis', { Referer: 'https://www.superbid.net/' });

// Sold
await diagnosticar('Sold API v1', 'https://www.sold.com.br/api/v1/lots?category_ids=1&status=open&page=1&per_page=5', { Referer: 'https://www.sold.com.br/', Accept: 'application/json', 'x-requested-with': 'XMLHttpRequest' });
await diagnosticar('Sold HTML', 'https://www.sold.com.br/leiloes-de-imoveis', { Referer: 'https://www.sold.com.br/' });

// Zukerman
await diagnosticar('Zukerman', 'https://www.zukerman.com.br/imoveis', { Referer: 'https://www.zukerman.com.br/' });

// Biassi
await diagnosticar('Biassi', 'https://www.biassi.com.br/leilao/imoveis', { Referer: 'https://www.biassi.com.br/' });
await diagnosticar('Biassi Alt', 'https://www.biassi.com.br/imoveis', { Referer: 'https://www.biassi.com.br/' });

// HastaPública
await diagnosticar('HastaPública', 'https://www.hastapublica.com.br/busca?categoria=imoveis&pagina=1', { Referer: 'https://www.hastapublica.com.br/' });

// eLeilões
await diagnosticar('eLeilões', 'https://www.eleiloes.com.br/imoveis', { Referer: 'https://www.eleiloes.com.br/' });

// Mega Leilões
await diagnosticar('Mega Leilões SP', 'https://www.megaleiloes.com.br/imoveis?estado=SP', { Referer: 'https://www.megaleiloes.com.br/' });
await diagnosticar('Mega Leilões Alt', 'https://www.megaleiloes.com.br/busca?tipo=imovel', { Referer: 'https://www.megaleiloes.com.br/' });

// Banco do Brasil
await diagnosticar('BB seu imovel', 'https://www47.bb.com.br/portalbb/imoveisVenda/imoveis/listarImoveis.bbx', {});
await diagnosticar('BB seucredito', 'https://www.bb.com.br/site/para-voce/emprestimos-e-financiamentos/imoveis/', {});

// Frazão (novo — validar se funciona)
await diagnosticar('Frazão', 'https://www.frazaoleiloes.com.br/imoveis', { Referer: 'https://www.frazaoleiloes.com.br/' });

console.log('\n\n✅ Diagnóstico concluído');
