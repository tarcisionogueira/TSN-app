/**
 * FONTE (config) — HASTA (hastaleiloes.com.br, o site REAL — plural; ver a história do
 * domínio errado no cabeçalho de lib/hasta-parse.mjs). Fonte `dom` do Passo 2, plataforma
 * SOLEON (mesma base white-label de scraper-soleon.mjs — confirmado 19/09 pela meta tag
 * `author="SOLEON Soluções para Leilões Online"`).
 *
 * `usarProxyIsp: true` (19/09) — até aqui o site só respondia a IP RESIDENCIAL (bloqueio de
 * reputação de IP de datacenter), e a coleta dependia inteiramente da máquina do dono
 * (runner-residencial.sh). Confirmado em 3 rodadas de recon do dia (proxy ISP do Bright
 * Data, já validado 18/09 contra este mesmo site): o proxy passa igual ao IP residencial —
 * então a fonte roda de qualquer runner GitHub Actions agora, sem depender de máquina única.
 * Estrutura mapeada pelo DONO via console do navegador (21/08): listagem /lotes/imovel
 * (30/pág) → lote /item/<ID>/detalhes. Comitente observado: CAIXA (vigiar duplicidade
 * com a fonte CEF). Parser puro em lib/hasta-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../hasta-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'hasta',
  fetch: 'dom',
  dom: { esperaMs: 3500, usarProxyIsp: true },
  // 29/08 — O CATÁLOGO PASSOU A SER POR LEILÃO, e `/lotes/imovel` virou vitrine vazia.
  // `/leiloes` lista os EVENTOS; o nível 2 do motor entra em cada `/leilao/<id>/lotes`. O
  // porquê (com as medições do recon) está no cabeçalho de `extrairUrlsDeEvento`.
  // Apontar direto para `/leilao/557/lotes` seria mais curto e estaria errado: leilão acaba, e
  // a coleta pararia sozinha em 03/09 sem ninguém saber.
  catalogo: '/leiloes',
  paginaParam: 'page',
  // Acervo real ≈ 579 lotes (CSV do dono, 21/08) a 30/pág → ~20 páginas. O motor para
  // sozinho quando uma página não traz URL nova, então o teto alto não custa nas menores.
  maxPages: 20,
  // Um leilão da CAIXA tem ~579 lotes a 30/pág → 20 páginas DENTRO do evento.
  maxPagesEvento: 25,
  maxEventos: 12,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Hasta Leilões (SOLEON; render exige Chromium — proxy ISP resolve bloqueio de IP de datacenter)', acesso: 'dom-puppeteer-proxy-isp',
    custo: 'fixo (proxy ISP, nao por requisicao)', anti_bot: 'bloqueio de reputacao de IP (resolvido via proxy ISP)', enumeracao: '/leiloes -> /leilao/<id>/lotes (nivel 2, renderizado)',
    url_lote: '/item/<ID>/detalhes', scraper: 'scraper-hasta.mjs (runner GitHub Actions ou residencial)',
  },
};
