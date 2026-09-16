import { fetchUnlockerContado } from './lib/bd-ledger.mjs';
/**
 * Recon RUNTIME — francoleiloes.com.br (Fernanda de Mello Franco, leiloeira registrada na
 * JUCEMG — confirmado em jucemg-dominios.json). NÃO integrado hoje: sem scraper, sem parser,
 * sem cron, zero imóvel em imoveis_leilao. Este recon existe só para AVALIAR viabilidade —
 * mesmo método do recon-hasta.mjs: (1) HOME crua, R$ no HTML? SPA ou servidor?, (2) tenta
 * vários padrões de link de lote (não sabemos o padrão de antemão, diferente do Hasta que já
 * tinha sido probado); (3) disseca 1-2 detalhes achados, mapeando avaliação×lance, área,
 * cidade/UF, praças, docs. NÃO grava. Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const BASE = process.env.FRANCO_BASE || 'https://www.francoleiloes.com.br';
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bd(url, timeoutMs = 40000) {
  try {
    const r = await fetchUnlockerContado({
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}
const og = (html, p) => (html.match(new RegExp(`<meta[^>]+property=["']og:${p}["'][^>]+content=["']([^"']+)["']`, 'i')) || [])[1] || '';

// Padrões candidatos de link de lote — não sabemos qual vale aqui, testa vários de uma vez.
const PADROES = [
  { nome: '/lote/', re: /\/lote[s]?\/[\w-]+/gi },
  { nome: '/leilao/', re: /\/leil(?:a|ã)o(?:-de-imoveis)?\/[\w-]+/gi },
  { nome: '/imovel/', re: /\/imov(?:e|é)is?\/[\w-]+/gi },
  { nome: '/bem/', re: /\/bem[s]?\/[\w-]+/gi },
  { nome: 'id numérico (?id=)', re: /[?&]id=\d+/gi },
];

(async () => {
  const home = await bd(BASE + '/');
  console.log(`HOME ${home.status} len=${home.body.length}`);
  if (home.err) console.log('erro:', home.err);

  // SPA ou servidor? Conta R$ crus no HTML (sinal já usado no recon do Hasta) e checa se
  // o corpo é essencialmente um shell JS (poucas tags de conteúdo, muito <script>).
  const qtdReais = (home.body.match(/R\$\s?[\d.,]+/g) || []).length;
  const qtdScriptKb = (home.body.match(/<script[\s\S]*?<\/script>/gi) || []).reduce((s, t) => s + t.length, 0) / 1024;
  console.log(`sinais R$ no HTML crú: ${qtdReais} | total de <script>: ${qtdScriptKb.toFixed(0)}kb de ${(home.body.length / 1024).toFixed(0)}kb`);
  console.log(qtdReais > 0 ? '→ parece SERVIDOR (conteúdo já vem no HTML)' : '→ pode ser SPA (conteúdo só via JS) — precisaria de headless, não só fetch cru');

  let melhor = null;
  for (const p of PADROES) {
    const achados = [...new Set([...home.body.matchAll(p.re)].map(m => m[0]))];
    console.log(`padrão ${p.nome}: ${achados.length} únicos`, achados.length ? JSON.stringify(achados.slice(0, 5)) : '');
    if (achados.length && !melhor) melhor = { padrao: p.nome, achados };
  }

  // Paginação?
  const pag = [...new Set([...home.body.matchAll(/href=["']([^"']*(?:page=|pagina|p=)\d+[^"']*)["']/gi)].map(m => m[1]))].slice(0, 6);
  console.log(`\nsinais de paginação:`, JSON.stringify(pag));

  if (!melhor) {
    console.log('\n⚠️ Nenhum padrão de link de lote reconhecido na home. Pode ser SPA (precisa headless) ou usar outra rota (ex.: menu "Leilões" separado da home). Recon precisa de 2ª rodada manual olhando a home renderizada.');
    return;
  }

  console.log(`\nUsando padrão "${melhor.padrao}" — dissecando até 2 detalhes:`);
  const base = new URL(BASE);
  for (const rel of melhor.achados.slice(0, 2)) {
    const url = rel.startsWith('http') ? rel : `${base.origin}${rel.startsWith('/') ? '' : '/'}${rel}`;
    const d = await bd(url);
    console.log(`\n════ DETALHE ${rel} → ${d.status} len=${d.body.length} ════`);
    console.log('  og:title:', og(d.body, 'title'));
    console.log('  og:description:', og(d.body, 'description').slice(0, 200));
    console.log('  og:image:', og(d.body, 'image'));
    const txt = d.body.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    console.log('  — R$ com contexto —');
    let n = 0;
    for (const m of txt.matchAll(/(.{0,45})R\$\s?([\d.]+,\d{2})/g)) {
      console.log(`     …${m[1].trim()} → R$ ${m[2]}`);
      if (++n >= 8) break;
    }
    const grab = (re) => (txt.match(re) || [])[0] || '';
    console.log('  área:', grab(/[\d.]+,?\d*\s*m[²2]/i));
    console.log('  cidade/UF trecho:', grab(/(?:comarca|cidade|munic[íi]pio|em)\s+[A-ZÀ-Ú][^.,;]{2,40}\/?\s*[A-Z]{2}?/i));
    console.log('  praça/data:', grab(/(?:1[ªa]|2[ªa]|primeira|segunda)\s*(?:pra[çc]a|leil[ãa]o)[^.]{0,40}\d{1,2}\/\d{1,2}\/\d{4}/i) || grab(/\d{1,2}\/\d{1,2}\/20\d{2}/));
    console.log('  modalidade:', grab(/judicial|extrajudicial|venda\s*direta/i));
    console.log('  matrícula:', grab(/matr[íi]cula[^\d]{0,15}[\d.]{3,}/i));
    const pdfs = [...new Set([...d.body.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map(m => m[1]))].slice(0, 5);
    console.log('  PDFs:', JSON.stringify(pdfs));
  }
})();
