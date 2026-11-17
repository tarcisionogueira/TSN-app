/**
 * FONTE (config) — SUPORTE "lei-" multi-site (17/11, auditoria de captura). Saraiva e Ananda Leilões (mesma leiloeira,
 * Angela Saraiva Portes Souza) migraram do template antigo da Suporte (`/buscador` agora dá 404) para o MESMO front
 * Next.js do Portal dos Leilões — parser PORTAL em lib/suporte-next-parse.mjs, sem código novo de leitura.
 *
 * Uma fonte POR SITE (o motor varre sumidos por `fonte`: duas vitrines numa fonte só fariam a lista de uma desligar
 * o acervo da outra). Cada site tem os próprios leilões (588 só na Ananda, 586 só na Saraiva) e compartilha alguns;
 * o lote repetido nas duas é o mesmo bem e cai na reconciliação de gêmeos entre leiloeiros (cidade + preço).
 *
 * Catálogo = os leilões que o site DECLARA abertos (`/leiloes?situacao=andamento` e `?situacao=proximos`): o
 * `/lotes?categoria=Imóveis` destes sites mistura o histórico inteiro (479 páginas na Saraiva). Dentro do leilão, só
 * card aberto e de imóvel (`imovelAbertoNoCard`); praça vencida cai no detalhe (`encerrado`).
 */
import { PORTAL, tituloVeiculo } from '../../suporte-next-parse.mjs';
import { complementoGenerico } from '../../veiculo-do-lote.mjs';

const { idDaUrl, parseDetalhe, montarRow, checarQualidade, eventosAbertos, extrairUrlsDeLoteVeiculo, abertoNoCard, imovelAbertoNoCard, cobertura } = PORTAL;

const EXTRAS = ['/leiloes?situacao=proximos'];
export const TENANTS = {
  saraiva: { fonte: 'SARAIVALEILOES', leiloeiro: 'Saraiva Leilões (Angela Saraiva Portes Souza)', base: 'https://saraivaleiloes.com.br', catalogosExtras: EXTRAS },
  ananda: { fonte: 'ANANDALEILOES', leiloeiro: 'Ananda Leilões (Angela Saraiva Portes Souza)', base: 'https://anandaleiloes.com.br', catalogosExtras: EXTRAS },
};

export default {
  chave: 'suportelei',
  fetch: 'fetch',
  catalogo: '/leiloes?situacao=andamento',
  paginaParam: 'page',
  maxPages: 2,
  eventosEmTodasPaginas: true,
  maxEventos: 20,
  maxPagesEvento: 8,
  maxRefresh: 60,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento: eventosAbertos, extrairUrlsDeLote: extrairUrlsDeLoteVeiculo, urlCandidata: imovelAbertoNoCard, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  veiculos: {
    catalogos: ['/leiloes?situacao=andamento', '/leiloes?situacao=proximos'],
    maxPages: 1, maxPagesEvento: 8,
    extrairUrlsDeEvento: eventosAbertos, extrairUrlsDeLote: extrairUrlsDeLoteVeiculo, urlCandidata: abertoNoCard, cobertura,
    complemento: (html) => ({ ...complementoGenerico(html), titulo: tituloVeiculo(html) }),
  },
  conhecimento: {
    plataforma: 'Suporte Leilões — front Next.js "lei-" (mesmo do Portal dos Leilões), SSR, multi-site',
    acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leiloes?situacao=andamento|proximos → /leilao/<id>-<slug> (cards lei-lote com categoria e status)',
    url_lote: '/lote/<slug> (props RSC do painel + specs lei-lote-spec; leiloeiro em lei-lote-com__leiloeiro)',
    scraper: 'scraper-suportenext.mjs',
  },
};
