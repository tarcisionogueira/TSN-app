/**
 * FONTE (config) — SUED PETER LEILÕES (suedpeterleiloes.com.br, ES; 17/11, auditoria de captura). Saiu do template
 * antigo da Suporte (`/buscador` dá 404 desde ~08/11; "tenant parado" com 14 ativos) para um front Next.js próprio
 * ("lote__"/"gcard"). Parser puro em lib/suporte-next-parse.mjs (FICHA): catálogo de imóveis com a pílula de situação
 * no card; no lote, ficha técnica, processo, documentos e as praças das props RSC do painel de lance.
 */
import { FICHA } from '../../suporte-next-parse.mjs';
import { complementoGenerico } from '../../veiculo-do-lote.mjs';

const { TENANTS, extrairUrlsDeLote, urlCandidata, idDaUrl, parseDetalhe, montarRow, checarQualidade } = FICHA;
const tituloLote = (html) => (String(html).match(/<h1 class="lote__titulo"[^>]*>([\s\S]*?)<\/h1>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || null;

export default {
  chave: 'suedpeter',
  fetch: 'fetch',
  catalogo: '/lotes?categoria=Im%C3%B3veis',
  paginaParam: 'page',
  maxPages: 6,
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, urlCandidata, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  veiculos: { catalogo: '/lotes?categoria=Ve%C3%ADculos', maxPages: 4, urlCandidata, complemento: (html) => ({ ...complementoGenerico(html), titulo: tituloLote(html) }) },
  conhecimento: {
    plataforma: 'Suporte Leilões — front Next.js "lote__/gcard" (Sued Peter), SSR + props RSC',
    acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/lotes?categoria=Imóveis&page=N (cards a.gcard com pílula de situação)',
    url_lote: '/lote/<id>-<slug> (ficha span.rotulo/strong; praças em "pracas":[…] do payload RSC)',
    scraper: 'scraper-suportenext.mjs',
  },
};
