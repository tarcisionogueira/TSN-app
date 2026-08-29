/**
 * RECON — existe um caminho que lista SÓ o acervo do leiloeiro? (29/08)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE: o dry-run multi-tenant provou que `/busca/segmento/imoveis` num white-label
 * Superbid devolve o CATÁLOGO GLOBAL da plataforma. Quatro sites distintos enumeraram os
 * MESMOS 75 lotes, com os MESMOS ids:
 *
 *   emiliomatos_125319 · bhleiloaria_125319 · franciscodavid_125319 · denis_125319
 *     → todos "Casa A.T. 150 m² - Vila Mariana, Morungaba/SP"
 *
 * Isso derrubou 3 candidatos E revelou que a fonte EMILIOMATOS, em produção, gravava lote de
 * outro leiloeiro sob o nome dela. O cron está suspenso até este recon achar o caminho certo.
 *
 * ─── O INSTRUMENTO: COMPARAÇÃO DIFERENCIAL, NÃO INSPEÇÃO ────────────────────────────────
 * Um recon que só olha um site não consegue distinguir "catálogo do leiloeiro" de "catálogo
 * global" — foi exatamente assim que o defeito sobreviveu: sozinho, o EMILIOMATOS enumerava
 * 75 lotes e nada parecia errado. Um número plausível medindo outra coisa é a forma nº 10.
 *
 * A pergunta só tem resposta com DOIS sites: um caminho serve se, e somente se, devolver
 * conjuntos DIFERENTES em white-labels diferentes. Igualdade prova que é global; diferença
 * prova que filtra por leiloeiro. Nenhuma leitura de HTML substitui essa comparação.
 *
 * ⚠️ Por isso o veredito é sobre o PAR de sites, nunca sobre um só. Um caminho que devolve
 * 0 em ambos não é "filtra bem": é "não existe" — e sai marcado como tal, não como sucesso.
 *
 * ─── CUSTO ZERO, POR DECISÃO ────────────────────────────────────────────────────────────
 * Roda pelo Chromium RESIDENCIAL (o mesmo `fetch-residencial.mjs` de GESTAO/RJ/triagem), não
 * pelo Bright Data. Os recons anteriores deste leiloeiro usavam BD "fora da cota", e o teto
 * semanal fechou 29/08 saturado em 550/550. Descobrir continua custando R$ 0.
 *
 * USO (da máquina residencial, com ~/.bidpro-runner.env carregado):
 *   node scripts/recon-emiliomatos-por-leiloeiro.mjs
 * Env opcionais: RECON_MAX_CAMINHOS (12) · RECON_SITES (csv de bases)
 */
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';
import { extrairUrlsDeLote } from './lib/emiliomatos-parse.mjs';

// Dois white-labels da MESMA plataforma. O par é o instrumento: o que for igual nos dois é
// global. `bhleiloaria` foi escolhido por ser um dos três que enumeraram os 75 idênticos.
const SITES = (process.env.RECON_SITES
  ? process.env.RECON_SITES.split(',').map(s => s.trim()).filter(Boolean)
  : ['https://emiliomatosleiloes.com.br', 'https://bhleiloaria.com.br']);

const MAX_CAMINHOS = Number(process.env.RECON_MAX_CAMINHOS || 12);

// Palpites conhecidos da família Superbid/MBV. Entram DEPOIS dos caminhos que o próprio site
// publica — o menu do site é evidência, o palpite é só rede de segurança.
const PALPITES = [
  '/busca/segmento/imoveis',          // o atual — esperado: IGUAL nos dois (é o defeito)
  '/leiloes',
  '/leiloes/abertos',
  '/nossos-leiloes',
  '/busca/leiloeiro',
  '/comitente',
];

const norm = (b) => b.replace(/\/+$/, '');

/** Caminhos internos que o próprio site publica no HTML (menu/nav). Evidência > palpite. */
function caminhosDoHtml(html, base) {
  const host = new URL(base).host.replace(/^www\./, '');
  const out = new Set();
  for (const m of String(html).matchAll(/href=["']([^"'#?]+)["']/gi)) {
    let h = m[1];
    if (/^https?:\/\//i.test(h)) {
      try { const u = new URL(h); if (u.host.replace(/^www\./, '') !== host) continue; h = u.pathname; }
      catch { continue; }
    }
    if (!h.startsWith('/') || h.length < 2) continue;
    if (/\.(pdf|jpe?g|png|svg|css|js|ico|webp)$/i.test(h)) continue;
    // Só o que cheira a listagem — o menu tem dezenas de links institucionais.
    if (!/leil|lote|imov|imóv|busca|segmento|catalog|venda/i.test(h)) continue;
    out.add(h.replace(/\/+$/, '') || '/');
  }
  return [...out];
}

/** Ids de lote que um caminho devolve NAQUELE site. `null` = não consegui ler (≠ vazio). */
async function idsDoCaminho(base, caminho) {
  const html = await fetchHeadless(`${norm(base)}${caminho}`, { timeoutMs: 45000, esperaMs: 3500 });
  // `null` do headless é "não consegui", não "está vazio". Fundir os dois faria um caminho
  // inacessível parecer um filtro perfeito (0 lotes) — a forma nº 1, aqui capaz de mandar
  // alguém integrar um caminho que nunca respondeu.
  if (html == null) return null;
  try { return new Set([...extrairUrlsDeLote(html, norm(base)).keys()].map(String)); }
  catch { return new Set(); }
}

const jaccard = (a, b) => {
  if (!a.size && !b.size) return 1;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
};

(async () => {
  console.log(`🔎 RECON por leiloeiro · sites: ${SITES.join(' × ')}\n`);

  // 1) O que cada site PUBLICA como caminho de listagem.
  const publicados = new Set();
  for (const base of SITES) {
    const home = await fetchHeadless(norm(base), { timeoutMs: 45000, esperaMs: 3500 });
    if (home == null) { console.log(`  ⚠️ ${base} — home não carregou (nada a concluir sobre ele)`); continue; }
    const cs = caminhosDoHtml(home, base);
    console.log(`  ${base} → ${cs.length} caminho(s) candidato(s) no HTML: ${JSON.stringify(cs.slice(0, 10))}`);
    for (const c of cs) publicados.add(c);
  }

  const candidatos = [...new Set([...publicados, ...PALPITES])].slice(0, MAX_CAMINHOS);
  console.log(`\n📋 testando ${candidatos.length} caminho(s) nos ${SITES.length} sites…\n`);

  // 2) O TESTE: mesmo caminho, sites diferentes. Igual = global. Diferente = filtra.
  const linhas = [];
  for (const c of candidatos) {
    const conjuntos = [];
    for (const base of SITES) conjuntos.push({ base, ids: await idsDoCaminho(base, c) });
    const ilegivel = conjuntos.filter(x => x.ids === null).map(x => new URL(x.base).host);
    if (ilegivel.length) { linhas.push({ caminho: c, veredito: 'NAO_LIDO', detalhe: `sem leitura em: ${ilegivel.join(', ')}` }); continue; }
    const tamanhos = conjuntos.map(x => x.ids.size);
    if (tamanhos.every(n => n === 0)) { linhas.push({ caminho: c, veredito: 'VAZIO', detalhe: '0 lotes nos dois — o caminho não lista nada' }); continue; }
    const sim = jaccard(conjuntos[0].ids, conjuntos[1].ids);
    linhas.push({
      caminho: c,
      veredito: sim >= 0.9 ? 'GLOBAL' : (sim <= 0.1 ? 'POR_LEILOEIRO' : 'PARCIAL'),
      detalhe: `${tamanhos.join(' vs ')} lotes · sobreposição ${(sim * 100).toFixed(0)}%`,
    });
  }

  console.log('RESULTADO\n');
  for (const l of linhas) console.log(`  ${l.veredito.padEnd(14)} ${l.caminho.padEnd(34)} ${l.detalhe}`);

  const bons = linhas.filter(l => l.veredito === 'POR_LEILOEIRO' || l.veredito === 'PARCIAL');
  console.log(bons.length
    ? `\n✅ CANDIDATO(S) A CATÁLOGO DO LEILOEIRO: ${bons.map(b => b.caminho).join(', ')}`
      + '\n   Próximo passo: apontar `catalogo` da fonte para ele e rodar DRY-RUN nos dois sites —'
      + '\n   sobreposição baixa é indício, lote conferido na página do leiloeiro é a prova.'
    : '\n❌ NENHUM caminho separou os acervos. Todos os testados devolvem o catálogo global'
      + '\n   (ou não listam nada). O EMILIOMATOS deve seguir com o cron SUSPENSO: sem um caminho'
      + '\n   que filtre, qualquer coleta grava lote de outro leiloeiro sob o nome dele.');

  await fecharHeadless();
})().catch(async (e) => { console.error(e); await fecharHeadless(); process.exit(1); });
