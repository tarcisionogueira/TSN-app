/**
 * FONTE (config) — LANCE VIP (lancevip.com.br; front Next.js novo da Suporte, SSR — 26/10). Parser puro em
 * lib/suporte-next-parse.mjs (LANCEVIP). Catálogo = os dois atalhos de imóvel da própria home (urbanos 15–18 e rurais
 * 20), 12 por página em `&page=N`, "Exibindo 1–12 de 26" (26 de 26 enumerados em 26/10). Uma fonte, um tenant: o
 * sweep de sumidos do motor é por `fonte`, então a falha de outro site da Suporte nunca aposenta lote daqui.
 */
import { LANCEVIP, tituloVeiculo } from '../../suporte-next-parse.mjs';
import { complementoGenerico } from '../../veiculo-do-lote.mjs';

const { TENANTS, extrairUrlsDeLote, idDaUrl, totalDoCatalogo, parseDetalhe, montarRow, checarQualidade } = LANCEVIP;

export default {
  chave: 'lancevip',
  fetch: 'fetch',
  catalogo: '/lotes?subcategoria=15,16,17,18,20',
  paginaParam: 'page',
  // 12 por página: 8 páginas = 96 imóveis (26 em 26/10). Bater no teto com link para a próxima vira "lista cortada"
  // (o motor não varre sumidos sobre lista incompleta).
  maxPages: 8,
  maxRefresh: 60,
  tenants: Object.values(TENANTS),
  // `totalDoCatalogo`: o motor compara o enumerado com o "de N" do site e marca a lista como cortada se faltar.
  parse: { extrairUrlsDeLote, idDaUrl, totalDoCatalogo, parseDetalhe, montarRow, checarQualidade },
  // VEÍCULOS: carros (8), motos (9) e caminhões (10) — os atalhos da home ("5", "3" e "5 lotes disponíveis").
  // O título ganha o tipo da categoria da página ("Moto HONDA/NXR150…") — o classificador decide o tipo pelo título.
  veiculos: { catalogo: '/lotes?subcategoria=8,9,10', maxPages: 6, complemento: (html) => ({ ...complementoGenerico(html), titulo: tituloVeiculo(html) }) },
  conhecimento: {
    plataforma: 'Suporte Leilões — front Next.js "lv-" (LanceVIP), SSR',
    acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum (Cloudflare sem challenge)',
    enumeracao: '/lotes?subcategoria=15,16,17,18,20&page=N (contador "Exibindo a–b de N")',
    url_lote: '/leilao/<leilão>/lote/<n> (HTML: li.lv-praca, dl.lv-specs, ul.lv-lote-docs)', scraper: 'scraper-suportenext.mjs',
  },
};
