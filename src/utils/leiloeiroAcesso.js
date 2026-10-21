/**
 * QUEM VÊ O LEILOEIRO DE UM IMÓVEL (21/10, dono: "da mesma forma que nos veículos, retire do plano explorador a
 * permissão de ir ao site do leiloeiro e o selo informando quem é o leiloeiro — somente planos pagos").
 * Regra única para todas as telas de imóvel: nome do leiloeiro, selo da fonte na foto, link do lote, documentos
 * hospedados no site do leiloeiro e "também anunciado em". Combo = role top2 (já entra). Só Veículos não libera
 * o leiloeiro de IMÓVEL (é outra trilha).
 * ⚠️ Camada de TELA: a tabela imoveis_leilao ainda é legível por qualquer um (política `OR true`). Fechar no banco,
 * como em veiculos_vitrine, é a pendência registrada em pendencias_projeto.
 */
export const ROLES_PAGOS_IMOVEIS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
export const ROLES_EQUIPE = ['admin', 'analista', 'consultor', 'advogado', 'suporte'];
export const podeVerLeiloeiro = (role) => ROLES_PAGOS_IMOVEIS.includes(role) || ROLES_EQUIPE.includes(role);
export const CHECKOUT_LEILOEIRO = '/checkout?plano=top2';
