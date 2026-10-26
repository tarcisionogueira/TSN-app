/**
 * FONTE (config) — PORTAL DOS LEILÕES (portaldosleiloes.com.br, AL; front Next.js novo da Suporte, SSR — 26/10). Parser
 * puro em lib/suporte-next-parse.mjs (PORTAL). Catálogo = o filtro de imóveis do PRÓPRIO site; em 26/10 ele responde
 * "Nenhum lote encontrado" (o acervo é de usinas: máquinas, equipamentos e veículos) — ligado assim mesmo, para o
 * imóvel que for publicado entrar sozinho. O zero declarado vira linha em fonte_saude com o motivo "site declara…".
 */
import { PORTAL, tituloVeiculo } from '../../suporte-next-parse.mjs';
import { complementoGenerico } from '../../veiculo-do-lote.mjs';

const { TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, eventosAbertos, extrairUrlsDeLoteVeiculo, abertoNoCard, cobertura } = PORTAL;

export default {
  chave: 'portaldosleiloes',
  fetch: 'fetch',
  catalogo: '/lotes?categoria=Im%C3%B3veis',
  paginaParam: 'page',
  maxPages: 6,
  maxRefresh: 30,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  // VEÍCULOS (26/10): só lote ABERTO. `/lotes?categoria=Veículos` mistura 4.133 lotes de usina já vendidos e põe o
  // caminhão em "Diversos" — o catálogo aqui são os LEILÕES que o site declara abertos (`?situacao=andamento` e
  // `?situacao=proximos`); em cada um, só o card sem "Vendido"/"Sem Licitantes" vira URL, e a praça vencida cai no
  // detalhe (`encerrado`). Trator, rolo e gerador ficam fora em veiculoDoLote (só veículo inteiro).
  // Gate de completude (`cobertura`): cards lidos × "X de Y lotes" que cada evento declara ≥ 90%, senão não grava.
  veiculos: {
    catalogos: ['/leiloes?situacao=andamento', '/leiloes?situacao=proximos'],
    maxPages: 1, maxPagesEvento: 8,
    extrairUrlsDeEvento: eventosAbertos, extrairUrlsDeLote: extrairUrlsDeLoteVeiculo, urlCandidata: abertoNoCard, cobertura,
    complemento: (html) => ({ ...complementoGenerico(html), titulo: tituloVeiculo(html) }),
  },
  conhecimento: {
    plataforma: 'Suporte Leilões — front Next.js "lei-" (Portal dos Leilões), SSR',
    acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum (Cloudflare sem challenge)',
    enumeracao: '/lotes?categoria=Imóveis&page=N', url_lote: '/lote/<slug> (props RSC do painel: loteId, valorInicial, dataEncerra)',
    scraper: 'scraper-suportenext.mjs',
  },
};
