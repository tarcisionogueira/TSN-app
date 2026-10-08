/**
 * DESCRIÇÃO DO LOTE lida do painel oficial da página (08/10, pedido do dono: "descrição completa").
 *
 * Medido no HTML real (pg_net, 08/10): ZUK 692 de 761 e MEGA 339 de 436 imóveis ativos tinham a
 * descrição igual ao título do card ("Apartamento em leilão - Rua X - Cidade/UF"), embora a página
 * do lote traga o texto inteiro do leiloeiro — matrícula, áreas, ocupação, observações. Os dois
 * sites põem esse texto num painel com marcação FIXA, então a leitura ancora nele (não no
 * extrator genérico por pontuação, que serve para quem não tem âncora):
 *   MEGA  <div id="tab-description" …><div class="content"> TEXTO </div>
 *   ZUK   <h3 class="property-info-title">Descrição do imóvel</h3> <div class="property-info-text">
 *         <p class="property-hide-show"> TEXTO <span id="descricao-detalhes"> RESTO </span></p>
 * Sem o painel → null (o chamador mantém o que tinha). Nunca devolve menu/rodapé.
 */
import { decodificarEntidades } from '../../api/_texto-imovel.js';

const limpar = (h) => decodificarEntidades(String(h || '')
  .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|li|div)>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();

const PAINEL = {
  MEGA: /<div[^>]+id="tab-description"[^>]*>\s*<div[^>]*class="content"[^>]*>([\s\S]*?)<\/div>/i,
  ZUK: /<h3[^>]*class="property-info-title"[^>]*>\s*Descri[çc][ãa]o do im[óo]vel\s*<\/h3>\s*<div[^>]*class="property-info-text"[^>]*>([\s\S]*?)<\/p>/i,
};

export const FONTES_DESCRICAO_PAINEL = new Set(Object.keys(PAINEL));

export function descricaoDoPainel(fonte, html) {
  const re = PAINEL[fonte];
  if (!re) return null;
  const m = String(html || '').match(re);
  if (!m) return null;
  const txt = limpar(m[1]);
  return txt.length >= 60 ? txt.slice(0, 8000) : null;
}
