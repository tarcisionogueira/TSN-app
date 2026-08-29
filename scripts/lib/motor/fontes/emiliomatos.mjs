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
  FONTE, LEILOEIRO, BASE, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
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
const CANDIDATOS_JUCEMG = [
  { fonte: 'ADRIANOLEIL',    leiloeiro: 'Adriano Apolinário L. de Oliveira', base: 'https://www.adrianoleiloeiro.com.br' },
  { fonte: 'ANGELABECHARA',  leiloeiro: 'Ângela Assis Oliveira Bechara',     base: 'https://www.angelabecharaleiloes.com.br' },
  { fonte: 'APABRF',         leiloeiro: 'APA & BRF Leilões',                 base: 'https://www.apabrfleiloes.com.br' },
  { fonte: 'BHLEILOARIA',    leiloeiro: 'Sérgio Sousa Rodrigues',            base: 'https://bhleiloaria.com.br' },
  { fonte: 'FRANCISCODAVID', leiloeiro: 'Francisco David Batista de Souza',  base: 'https://franciscodavidleiloeiro.com.br' },
  { fonte: 'DENIS',          leiloeiro: 'Dênis de Oliveira Fernandes',       base: 'https://leiloeirodenis.com.br' },
];

export default {
  chave: 'emiliomatos',
  catalogo: '/busca/segmento/imoveis',
  paginaParam: 'page',                // ⚠️ Superbid usa ?page= (não ?pagina=)
  maxPages: 15,
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

  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Superbid/MBV (white-label SSR)', acesso: 'gratis+brightdata', custo: 'misto',
    anti_bot: 'cloudflare', enumeracao: '/busca/segmento/imoveis?page=N',
    url_lote: '/imoveis/<tipo>/<slug>-<ID>', scraper: 'scraper-emiliomatos.mjs',
  },
};
