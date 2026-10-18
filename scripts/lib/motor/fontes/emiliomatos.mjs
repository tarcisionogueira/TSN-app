/**
 * FONTE (config) — Superbid/MBV SSR (white-label). Reusa o parser puro lib/emiliomatos-parse.mjs.
 *
 * MULTI-TENANT DE VERDADE: `montarRow(url, det, tenant)` HONRA o tenant
 * (`tenant?.fonte || FONTE`) — o cabeçalho antigo dizia que ele ignorava o 3º argumento, e isso
 * deixou de ser verdade no suporte multi-tenant de 29/08. Corrigido aqui porque comentário
 * desatualizado sobre multi-tenant é o tipo de coisa que faz alguém subir seis leiloeiros
 * gravando todos sob a mesma `fonte`, sem erro nenhum.
 */
import {
  FONTE, LEILOEIRO, BASE, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../emiliomatos-parse.mjs';

// ── CANDIDATOS DA JUCEMG (29/08) — FORA DA PRODUÇÃO ATÉ O DRY-RUN PROVAR ────────────────────
// A triagem residencial classificou 7 domínios como Superbid pela assinatura `/busca/segmento/`
// no HTML — **a MESMA assinatura fraca que reprovou os 11 acima**. Um leiloeiro que apenas LINKA
// para o Superbid carrega esse caminho sem rodar a plataforma, então a expectativa aqui é de
// ceticismo, não de otimismo: estes 6 entram para SEREM MEDIDOS, e o resultado provável é que
// vários repitam o zero.
//
// São 6 tenants para 7 domínios: `apaleiloes.com.br` e `brfleiloes.com.br` resolvem para o MESMO
// site (`apabrfleiloes.com.br`) — dois leiloeiros, uma plataforma. Subir os dois duplicaria o
// acervo inteiro deles, com dois `fonte_id` distintos para o mesmo lote e nenhum erro à vista.
//
// `base` vem da url_final MEDIDA pela triagem (com/sem `www`, como o site respondeu), não do
// domínio da lista da junta.
//
// Só entram com `EMILIOMATOS_CANDIDATOS=1`; o cron de produção não os enxerga. Promover exige
// mover a linha para `tenants`, à mão, depois da prova.
// ⛔ RESULTADO DO DRY-RUN (29/08): 6 de 6 REPROVADOS, e o pior caso não foi o zero.
//   ADRIANOLEIL, ANGELABECHARA  → 0 enumerados (via grátis): linkam para o Superbid, não rodam.
//   APABRF                      → 0 enumerados SEM "(via grátis)": nem chegou a acessar.
//   BHLEILOARIA, FRANCISCODAVID, DENIS → 75 lotes cada, com os MESMOS ids do EMILIOMATOS
//     (bhleiloaria_125319 = franciscodavid_125319 = denis_125319 = emiliomatos_125319,
//     "Casa A.T. 150 m² - Vila Mariana, Morungaba/SP"). O catálogo `/busca/segmento/imoveis`
//     de um white-label devolve o acervo GLOBAL do Superbid, não o do leiloeiro dono do site.
//     Promovê-los teria duplicado 75 lotes × 3 fontes, com fonte_id distinto para o MESMO
//     imóvel — e sem um único erro à vista.
//
// E o achado que veio de brinde: o EMILIOMATOS EM PRODUÇÃO tem o mesmo problema. Cron
// suspenso em .github/workflows/scraper-emiliomatos.yml até um recon achar o caminho que
// lista só o acervo do leiloeiro.
const CANDIDATOS_JUCEMG = [
  { fonte: 'ADRIANOLEIL',    leiloeiro: 'Adriano Apolinário L. de Oliveira', base: 'https://www.adrianoleiloeiro.com.br' },
  { fonte: 'ANGELABECHARA',  leiloeiro: 'Ângela Assis Oliveira Bechara',     base: 'https://www.angelabecharaleiloes.com.br' },
  { fonte: 'APABRF',         leiloeiro: 'APA & BRF Leilões',                 base: 'https://www.apabrfleiloes.com.br' },
  { fonte: 'BHLEILOARIA',    leiloeiro: 'Sérgio Sousa Rodrigues',            base: 'https://bhleiloaria.com.br' },
  { fonte: 'FRANCISCODAVID', leiloeiro: 'Francisco David Batista de Souza',  base: 'https://franciscodavidleiloeiro.com.br' },
  { fonte: 'DENIS',          leiloeiro: 'Dênis de Oliveira Fernandes',       base: 'https://leiloeirodenis.com.br' },
];

// ── SÓ O ACERVO DO LEILOEIRO (18/10, conserto do cron suspenso em 29/08) ─────────────────────
// Recon em 18/10 (Firecrawl, página viva): a HOME do white-label lista só os EVENTOS do próprio
// leiloeiro (`/imoveis-stars-bank-em-sao-paulo-38451`, `/imoveis-cnp-no-ce-mg-ms-pi-e-sp-38395`), e
// dentro do evento cada lote dele mora em `/emilio-matos-rocha/imoveis/<tipo>/<slug>-<ID>` (29 + 13
// lotes). O catálogo `/busca/segmento/imoveis` é o GLOBAL do Superbid e usa `/imoveis/...` sem o
// prefixo — por isso o lote só é aceito COM o prefixo do leiloeiro: um "destaque" global que apareça
// na home ou no evento não entra mais como se fosse dele.
const PREFIXO_LEILOEIRO = '/emilio-matos-rocha/imoveis/';
function extrairUrlsDoLeiloeiro(html, base = BASE) {
  const urls = new Map();
  for (const m of String(html).matchAll(/href=["']((?:https?:\/\/[^/"']+)?\/emilio-matos-rocha\/imoveis\/[^"'?#]+?-(\d{4,}))["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* href malformado: ignora */ }
  }
  return urls;
}
// Evento de IMÓVEIS na home: slug com "imoveis" terminando em -<id do leilão>. Os de veículos/máquinas ficam fora.
function extrairEventosDeImoveis(html, base = BASE) {
  const eventos = new Map();
  for (const m of String(html).matchAll(/href=["']((?:https?:\/\/[^/"']+)?\/(?:[a-z0-9-]+\/)?([a-z0-9-]*imoveis[a-z0-9-]*)-(\d{5,}))["']/gi)) {
    if (m[1].includes(PREFIXO_LEILOEIRO)) continue; // é lote, não evento
    try { eventos.set(m[3], new URL(m[1], base).href); } catch { /* href malformado: ignora */ }
  }
  return eventos;
}

export default {
  chave: 'emiliomatos',
  // Firecrawl (18/10): o preço ("Próxima Oferta") só foi medido na página MONTADA; o site fica atrás de Cloudflare.
  // ~45 créditos/semana (home + 2 eventos + ~42 lotes) no scraper-firecrawl-semanal.yml.
  fetch: 'firecrawl',
  catalogo: '/',                      // a HOME (eventos do leiloeiro), não o catálogo global
  paginaParam: 'page',                // ⚠️ Superbid usa ?page= (não ?pagina=)
  maxPages: 1,
  maxPagesEvento: 2,                  // evento de 29 lotes coube numa página; a 2ª só confirma o fim
  // ⚠️ OS 11 TENANTS DA JUCEMG FORAM REMOVIDOS PELO DRY-RUN (29/08), e a lição fica.
  //
  // A triagem os classificou como Superbid/MBV porque o HTML deles continha `/busca/segmento/`.
  // O dry-run mediu: **os 11 enumeraram ZERO lotes**, todos "via gratis" — ou seja, a página
  // respondeu e o catálogo simplesmente não está ali. A assinatura era fraca: um leiloeiro que
  // LINKA para o Superbid ("veja também no Superbid") carrega esse caminho no HTML sem rodar a
  // plataforma. Confundir "menciona" com "roda" é a forma nº 10 outra vez, agora no meu
  // classificador.
  //
  // Subir os 11 assim mesmo custaria pior que nada: onze tenants varridos toda semana sem
  // trazer lote, poluindo o log e a saúde da fonte com vazio permanente. Voltam quando um recon
  // olhar a estrutura VIVA de um deles e disser qual é o catálogo de verdade — o mesmo método
  // que resolveu VIP e SUPORTE hoje.
  //
  // O que FICA da mudança: o suporte a multi-tenant (`chaveTenant` no runner e no parser). Ele
  // está certo, testado, e é o que vai permitir plugar a família correta assim que ela aparecer.
  tenants: [
    { fonte: FONTE, leiloeiro: LEILOEIRO, base: BASE },
    ...(process.env.EMILIOMATOS_CANDIDATOS === '1' ? CANDIDATOS_JUCEMG : []),
  ],

  // Os candidatos da JUCEMG (só com EMILIOMATOS_CANDIDATOS=1) continuariam no catálogo global: eles nem rodam a
  // plataforma (dry-run de 29/08). `extrairUrlsDeLote` do parser fica para eles e para os testes.
  parse: { extrairUrlsDeLote: extrairUrlsDoLeiloeiro, extrairUrlsDeEvento: extrairEventosDeImoveis, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Superbid/MBV (white-label SSR)', acesso: 'firecrawl', custo: 'firecrawl ~45 créditos/semana',
    anti_bot: 'cloudflare', enumeracao: 'home → eventos de imóveis → /emilio-matos-rocha/imoveis/...',
    url_lote: '/emilio-matos-rocha/imoveis/<tipo>/<slug>-<ID>', scraper: 'scraper-emiliomatos.mjs',
  },
};
