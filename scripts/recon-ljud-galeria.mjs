/**
 * RECON LJUD GALERIA — a API tem MAIS DE UMA foto por lote, ou o parser está certo e a fonte
 * só manda uma?
 *
 * POR QUE ESTE SCRIPT EXISTE (18/09, pedido do dono: "prioriza o LJUD, é a maior fonte").
 * `mapLoteLJUD_pp` (scripts/scraper-puppeteer.mjs) lê `it.fotos[].nm_path_completo` e grava
 * em `fotos` (coluna array, a galeria da ficha) desde 17/09 — mas os 872 lotes ATIVOS do LJUD
 * hoje têm essa coluna 100% NULA. `link_foto` (a capa) está preenchido em 77% deles, só que via
 * um backfill SEPARADO (og:image da página do leiloeiro), não a partir de `it.fotos`. Ou seja:
 * o código que devia ler a galeria nunca encontrou nada para ler.
 *
 * MESMA LIÇÃO do recon-ljud-foto.mjs (27/08): a API só responde ao fingerprint TLS de um
 * Chrome real (`fetch` do Node leva "Metodo não permitido!" dentro de HTTP 200) — por isso
 * Puppeteer, chamando de DENTRO da página do portal, e não `fetch` direto.
 *
 * ⚠️ VEREDITO NOS DOIS SENTIDOS:
 *   • `it.fotos` vem com >1 item e `nm_path_completo` presente → é bug nosso? NÃO — já é o
 *     campo que o parser lê; se aparecer aqui e não no banco, o defeito está em OUTRO lugar
 *     (query salvarEFinalizar, ou o run de produção usa outro endpoint/mapeador).
 *   • `it.fotos` vem SEMPRE vazio/1-item, ou o campo mudou de nome → a galeria não existe na
 *     fonte hoje (ou o campo mudou), e a "galeria completa" de 17/09 não tem o que mostrar —
 *     não é dívida técnica, é ausência de dado na origem.
 *
 * Só leitura, não grava nada. Roda no GitHub Actions. Secrets: VITE_SUPABASE_URL,
 * SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const API = 'https://api.leiloesjudiciais.com.br/core/api/get-bens-por-estados';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const PAGINAS = Number(process.env.RECON_PAGINAS || 10);

function acharLista(j, prof = 0) {
  if (prof > 4 || !j || typeof j !== 'object') return null;
  if (Array.isArray(j)) return j.length && typeof j[0] === 'object' ? j : null;
  let melhor = null;
  for (const v of Object.values(j)) {
    const c = acharLista(v, prof + 1);
    if (c && (!melhor || c.length > melhor.length)) melhor = c;
  }
  return melhor;
}

async function paginaApi(page, pg) {
  const r = await page.evaluate(async (url) => {
    try {
      const resp = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
      return { status: resp.status, txt: (await resp.text()).slice(0, 200000) };
    } catch (e) { return { status: 0, txt: '', erro: String(e).slice(0, 200) }; }
  }, `${API}?tipo=3&pg=${pg}&qtd_por_pagina=48`);

  if (r.erro) throw new Error(`fetch na página falhou: ${r.erro}`);
  if (r.status < 200 || r.status >= 300) throw new Error(`API HTTP ${r.status} · corpo: ${r.txt.slice(0, 200)}`);

  let j;
  try { j = JSON.parse(r.txt); }
  catch { throw new Error(`resposta NÃO É JSON (${r.txt.length}B): ${r.txt.slice(0, 200)}`); }

  const items = acharLista(j);
  if (!items) throw new Error(`não achei lista de lotes na página ${pg}`);
  return items;
}

(async () => {
  console.log('=== RECON LJUD GALERIA — quantas fotos a API realmente devolve por lote? ===\n');

  const { data: amostraBanco, error } = await supabase
    .from('imoveis_leilao')
    .select('fonte_id, titulo, link_foto, fotos')
    .eq('fonte', 'LJUD').eq('ativo', true)
    .limit(2000);
  if (error) { console.error('Supabase falhou:', error.message); process.exit(1); }
  const porId = new Map((amostraBanco || []).map((l) => [String(l.fonte_id).replace(/^ljud_/, ''), l]));
  console.log(`Nosso banco: ${porId.size} lotes ATIVOS LJUD. Com fotos[] preenchido: ${
    (amostraBanco || []).filter((l) => Array.isArray(l.fotos) && l.fotos.length > 0).length
  }. Com link_foto preenchido: ${(amostraBanco || []).filter((l) => l.link_foto).length}.\n`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.goto('https://www.leiloesjudiciais.com.br/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2000));

  const vistos = new Map();
  let falhaApi = null;
  for (let pg = 1; pg <= PAGINAS; pg++) {
    let items;
    try { items = await paginaApi(page, pg); }
    catch (e) { falhaApi = e.message; console.log(`  pg ${pg}: FALHOU → ${e.message}`); break; }
    if (!items.length) { console.log(`  pg ${pg}: 0 itens — fim da paginação`); break; }
    for (const it of items) {
      const id = String(it.lote_id ?? it.bem_id ?? it.id ?? it.loteId ?? '');
      if (id) vistos.set(id, it);
    }
    console.log(`  pg ${pg}: ${items.length} itens (acumulado ${vistos.size})`);
    if (pg === 1) {
      const amostra = items[0];
      console.log(`     chaves do 1º item: ${Object.keys(amostra || {}).join(', ')}`);
      console.log(`     it.fotos do 1º item (bruto): ${JSON.stringify(amostra?.fotos ?? amostra?.foto ?? amostra?.imagens ?? '(nenhum campo óbvio)').slice(0, 500)}`);
    }
  }
  await browser.close();

  if (!vistos.size) {
    console.log('\n══════════════════ INCONCLUSIVO ══════════════════');
    console.log(falhaApi ? `  A API não pôde ser lida: ${falhaApi}` : '  A API respondeu, mas nenhum lote teve id reconhecível.');
    console.log('══════════════════════════════════════════════════');
    process.exit(2);
  }

  // Cruza com o banco e mede: quantas fotos a API traz vs quantas gravamos.
  let comMaisDeUma = 0, comUma = 0, comZero = 0, campoDiferente = 0;
  const exemplos = [];
  for (const [id, it] of vistos) {
    const arr = Array.isArray(it.fotos) ? it.fotos : null;
    if (!arr) {
      // campo pode ter mudado de nome — procura qualquer array cujos itens pareçam foto
      const candidatos = Object.entries(it).filter(([, v]) => Array.isArray(v) && v.length &&
        (typeof v[0] === 'string' ? /\.(jpe?g|png|webp)/i.test(v[0]) : v[0] && typeof v[0] === 'object'));
      if (candidatos.length) { campoDiferente++; if (exemplos.length < 5) exemplos.push({ id, achado: candidatos.map(([k]) => k) }); }
      else comZero++;
      continue;
    }
    const comPath = arr.filter((f) => f?.nm_path_completo).length;
    if (comPath > 1) comMaisDeUma++;
    else if (comPath === 1) comUma++;
    else { comZero++; if (exemplos.length < 5) exemplos.push({ id, achado: 'fotos[] existe mas sem nm_path_completo', bruto: JSON.stringify(arr).slice(0, 200) }); }
  }

  console.log('\n══════════════════ VEREDITO ══════════════════');
  console.log(`  lotes conferidos na API          : ${vistos.size}`);
  console.log(`  com >1 foto (nm_path_completo)   : ${comMaisDeUma}`);
  console.log(`  com exatamente 1 foto            : ${comUma}`);
  console.log(`  sem foto nenhuma (campo esperado): ${comZero}`);
  console.log(`  fotos[] ausente mas outro campo parece imagem: ${campoDiferente}`);
  if (exemplos.length) {
    console.log('\n  exemplos:');
    exemplos.forEach((e) => console.log(`    lote ${e.id}: ${JSON.stringify(e)}`));
  }
  if (comMaisDeUma > 0) {
    console.log('\n  🔴 A FONTE TEM GALERIA — mas não está chegando no banco.');
    console.log('     Bug está em OUTRO lugar do pipeline (não no campo lido), investigar salvarEFinalizar/upsert.');
  } else if (comUma > 0 && comMaisDeUma === 0) {
    console.log('\n  ✅ A fonte manda no máximo 1 foto por lote nesta amostra — "galeria completa"');
    console.log('     não tem o que mostrar para o LJUD hoje. Não é bug do parser.');
  } else {
    console.log('\n  ⚠️ Nem 1 nem >1 — praticamente nenhum lote tem nm_path_completo. Conferir se o');
    console.log('     campo mudou de nome (ver "campoDiferente" acima e a amostra bruta da pg 1).');
  }
  console.log('══════════════════════════════════════════════');
})();
