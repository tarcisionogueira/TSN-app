/**
 * FONTE (config) — Emílio Matos (Superbid/MBV SSR). Fonte única (1 tenant). Reusa o parser puro
 * lib/emiliomatos-parse.mjs. montarRow(url, det) ignora o 3º arg (tenant) que o runner passa.
 */
import {
  FONTE, LEILOEIRO, BASE, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../emiliomatos-parse.mjs';

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
  tenants: [{ fonte: FONTE, leiloeiro: LEILOEIRO, base: BASE }],

  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Superbid/MBV (white-label SSR)', acesso: 'gratis+brightdata', custo: 'misto',
    anti_bot: 'cloudflare', enumeracao: '/busca/segmento/imoveis?page=N',
    url_lote: '/imoveis/<tipo>/<slug>-<ID>', scraper: 'scraper-emiliomatos.mjs',
  },
};
