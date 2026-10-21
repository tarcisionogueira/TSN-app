/**
 * QUEM VÊ O LEILOEIRO DE UM IMÓVEL (21/10, dono: "da mesma forma que nos veículos, retire do plano explorador a
 * permissão de ir ao site do leiloeiro e o selo informando quem é o leiloeiro — somente planos pagos").
 * Regra única para todas as telas de imóvel: nome do leiloeiro, selo da fonte na foto, link do lote, documentos
 * hospedados no site do leiloeiro e "também anunciado em". Combo = role top2 (já entra). Só Veículos não libera
 * o leiloeiro de IMÓVEL (é outra trilha).
 * No BANCO desde 21/10 (#264, 20261021_imoveis_leiloeiro_plano_pago.sql): o navegador lê o acervo pela view
 * imoveis_leilao_mascarado (as colunas do leiloeiro vazias para quem não pode) e não lê mais essas colunas na tabela.
 */
export const ROLES_PAGOS_IMOVEIS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
export const ROLES_EQUIPE = ['admin', 'analista', 'consultor', 'advogado', 'suporte'];
export const podeVerLeiloeiro = (role) => ROLES_PAGOS_IMOVEIS.includes(role) || ROLES_EQUIPE.includes(role);
export const CHECKOUT_LEILOEIRO = '/checkout?plano=top2';
