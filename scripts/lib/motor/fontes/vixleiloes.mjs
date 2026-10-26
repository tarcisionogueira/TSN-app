/**
 * FONTE (config) — VIX LEILÕES (vixleiloes.com.br; front Next.js novo da Suporte, SSR — 26/10). Parser puro em
 * lib/suporte-next-parse.mjs (VIX). A agenda `/leiloes` lista EVENTOS; só os abertos ("Aberto para lances", "Em breve",
 * "Ao vivo") entram no nível 2; cada evento pagina 24 lotes em `?page=N` ("80 lotes encontrados" no CBMES). O catálogo
 * devolve TODOS os lotes do evento e `urlCandidata` separa imóvel de veículo pelo rótulo do card — filtrar dentro do
 * catálogo pararia a paginação na 1ª página sem imóvel.
 */
import { VIX, tituloVeiculo } from '../../suporte-next-parse.mjs';
import { complementoGenerico } from '../../veiculo-do-lote.mjs';

const { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, urlCandidata, urlVeiculo, totalDoEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } = VIX;

export default {
  chave: 'vixleiloes',
  fetch: 'fetch',
  catalogo: '/leiloes',
  paginaParam: 'page',
  // A agenda vem do mais novo para o mais velho (373 eventos, 32 páginas): os abertos estão na página 1; a 2ª já não
  // traz evento aberto e o laço para nela (página sem evento novo).
  maxPages: 3,
  eventosEmTodasPaginas: true,
  maxEventos: 15,
  maxPagesEvento: 10,
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, urlCandidata, totalDoEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  veiculos: { catalogo: '/leiloes', maxPages: 3, urlCandidata: urlVeiculo, complemento: (html) => ({ ...complementoGenerico(html), titulo: tituloVeiculo(html) }) },
  conhecimento: {
    plataforma: 'Suporte Leilões — front Next.js "vix" (Tailwind), SSR',
    acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum (Cloudflare sem challenge)',
    enumeracao: '/leiloes (eventos abertos) → /leiloes/<id>-<slug>?page=N (24/pág., "N lotes encontrados")',
    url_lote: '/lote/<id>-<slug> (JSON-LD Product + dl de especificações)', scraper: 'scraper-suportenext.mjs',
  },
};
