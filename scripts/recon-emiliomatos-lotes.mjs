/**
 * Validação de listagem — emiliomatosleiloes.com.br (plataforma Superbid/MBV, SSR)
 * ================================================================================
 * Confirma que /busca/segmento/imoveis lista os imóveis e detecta a paginação, ANTES de
 * montar o scraper de produção. NÃO grava nada — só conta os IDs únicos de lote.
 *
 * Lote no HTML: links terminando em "-<ID>" (ex.: /imoveis/apartamento/...-127018 ou
 * /imoveis-brb-em-brasilia-36487). Coletamos o ID (número final) e deduplicamos.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE. [PAGINAS] (default 10).
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const BASE = 'https://emiliomatosleiloes.com.br';
const SEG = '/busca/segmento/imoveis';
const MAX_PAG = parseInt(process.env.PAGINAS || '10', 10);

if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bdFetch(url, timeoutMs = 60000) {
  const r = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, html: await r.text().catch(() => '') };
}

// Extrai IDs de lote de imóvel do HTML. Aceita /imoveis/<tipo>/<slug>-<ID> e /<slug>-<ID>
// (lotes-carteira tipo /imoveis-brb-...-36487). Filtra só o que está sob contexto de imóvel.
function idsDeImovel(html) {
  const ids = new Set();
  // links href de lote
  const reHref = /href=["']([^"']*?-(\d{4,}))["']/gi;
  let m;
  while ((m = reHref.exec(html))) {
    const path = m[1];
    if (/\/imoveis[\/-]/i.test(path)) ids.add(m[2]);
  }
  return ids;
}

// Tenta descobrir o total anunciado ("N lotes", "N resultados", "N imóveis")
function totalAnunciado(html) {
  const m = html.match(/([\d.]{1,7})\s*(?:lotes?|resultados?|im[oó]veis)\b/i);
  return m ? m[1] : null;
}

(async () => {
  console.log(`Validação emiliomatos — ${BASE}${SEG}  (até ${MAX_PAG} páginas)\n`);
  const todos = new Set();
  let esquema = null;              // qual param de paginação funcionou
  let anunciado = null;

  // página 1 (sem param)
  const p1 = await bdFetch(BASE + SEG);
  const ids1 = idsDeImovel(p1.html);
  anunciado = totalAnunciado(p1.html);
  ids1.forEach(x => todos.add(x));
  console.log(`pág 1 → HTTP ${p1.status}  len=${p1.html.length}  ids_imovel=${ids1.size}  total_anunciado=${anunciado || '?'}`);
  if (/just a moment|cf-challenge/i.test(p1.html)) console.log('⚠️ possível desafio Cloudflare no corpo.');

  // detecta esquema de paginação testando ?pagina=2 e ?page=2
  for (const param of ['pagina', 'page', 'p']) {
    const t = await bdFetch(`${BASE}${SEG}?${param}=2`);
    const ids = idsDeImovel(t.html);
    const novos = [...ids].filter(x => !todos.has(x)).length;
    console.log(`  teste ?${param}=2 → ids=${ids.size} novos=${novos}`);
    if (novos > 0) { esquema = param; ids.forEach(x => todos.add(x)); break; }
  }

  if (!esquema) {
    console.log('\nSem paginação por querystring detectada (ou tudo cabe em 1 página / é scroll infinito).');
  } else {
    console.log(`\nPaginação: ?${esquema}=N. Varrendo páginas 3..${MAX_PAG}:`);
    let seco = 0;
    for (let n = 3; n <= MAX_PAG; n++) {
      const t = await bdFetch(`${BASE}${SEG}?${esquema}=${n}`);
      const ids = idsDeImovel(t.html);
      const antes = todos.size;
      ids.forEach(x => todos.add(x));
      const novos = todos.size - antes;
      console.log(`  pág ${n} → ids=${ids.size} novos=${novos} (acum ${todos.size})`);
      if (novos === 0) { if (++seco >= 2) { console.log('  (2 páginas sem novidade — fim)'); break; } }
      else seco = 0;
    }
  }

  console.log(`\n═══════════ RESULTADO ═══════════`);
  console.log(`  IDs de imóvel únicos coletados: ${todos.size}`);
  console.log(`  total anunciado na página: ${anunciado || '(não achado)'}`);
  console.log(`  paginação: ${esquema ? '?' + esquema + '=N' : 'não detectada'}`);
  console.log(`  amostra: ${[...todos].slice(0, 15).join(', ')}`);

  // Valida os SINAIS que o parseDetalhe do scraper de produção lê, numa página de lote real
  // (via Bright Data DIRETO — fora do ledger de cota, para não depender do teto semanal).
  const umLote = [...p1.html.matchAll(/href=["'](\/imoveis\/[^"']+?-\d{4,})["']/gi)][0]?.[1];
  if (umLote) {
    const url = umLote.startsWith('http') ? umLote : BASE + umLote;
    console.log(`\n── DETALHE (validação do parser): ${url}`);
    const d = await bdFetch(url);
    const ogT = (d.html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) || [])[1];
    const ogImg = (d.html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) || [])[1];
    const txt = d.html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const reais = [...txt.matchAll(/.{0,40}R\$\s*[\d.]+,\d{2}/g)].map(m => m[0].trim()).slice(0, 24);
    const m2 = (txt.match(/[\d.]+,\d{2}\s*m[²2]|\d+\s*m[²2]/i) || [])[0];
    const cid = (txt.match(/\b[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,2}\s*\/\s*[A-Z]{2}\b/) || [])[0];
    // contexto dos RÓTULOS de preço da Superbid/MBV (mapear certo avaliação × oferta × parcela)
    const rotulos = [...txt.matchAll(/[^.]{0,45}(avalia[çc][ãa]o|oferta\s*inicial|lance|1[ºo]?\s*leil|2[ºo]?\s*leil|valor\s+de\s+refer|entrada|parcela)[^.]{0,45}/gi)]
      .map(m => m[0].trim().replace(/\s+/g, ' ')).slice(0, 14);
    console.log(`  HTTP ${d.status}  len=${d.html.length}`);
    console.log(`  og:title = ${ogT || '(faltou)'}`);
    console.log(`  og:image = ${ogImg ? 'ok' : '(faltou)'}`);
    console.log(`  m²       = ${m2 || '(faltou)'}`);
    console.log(`  cidade/UF= ${cid || '(faltou)'}`);
    console.log(`  R$ (24)  = ${JSON.stringify(reais)}`);
    console.log(`  RÓTULOS  = ${JSON.stringify(rotulos)}`);
  }
  console.log(`\nSe os IDs > 0 e a paginação anda, o alvo do scraper de produção é ${SEG}?${esquema || 'page'}=N, parseando href '-<ID>' sob /imoveis.`);
})();
