/**
 * QUEM VÊ O LEILOEIRO DE UM IMÓVEL — lado do SERVIDOR (#264, bug bounty 21/10).
 * Espelha src/utils/leiloeiroAcesso.js e a função do banco pode_ver_leiloeiro().
 * Por que existe: endpoint que lê com a SERVICE KEY passa por cima da view imoveis_leilao_mascarado
 * (para o service_role a máscara não vale). Quem lê com a chave de serviço e devolve ao navegador
 * tem que mascarar aqui, pelo papel de QUEM CHAMOU. Fail-closed: sem sessão ou papel ilegível = não vê.
 */
import { getUser, getUserRoleById } from './_auth.js';

export const ROLES_PAGOS_IMOVEIS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
export const ROLES_EQUIPE = ['admin', 'analista', 'consultor', 'advogado', 'suporte'];
export const podeVerLeiloeiro = (role) => ROLES_PAGOS_IMOVEIS.includes(role) || ROLES_EQUIPE.includes(role);

// As mesmas 8 colunas que a view zera.
export const CAMPOS_LEILOEIRO = ['leiloeiro', 'url_lote', 'link_edital', 'link_matricula', 'link_regras_venda', 'anexos', 'anunciado_em', 'raw'];

/** { user, role, pode } para a requisição (Edge ou Node). */
export async function acessoLeiloeiro(req) {
  const user = await getUser(req).catch(() => null);
  if (!user?.id) return { user: null, role: null, pode: false };
  const role = await getUserRoleById(user.id).catch(() => null);
  return { user, role, pode: podeVerLeiloeiro(role) };
}

/** Cópia do lote com as colunas do leiloeiro nulas (só as que existem no objeto). */
export function mascararLote(lote) {
  if (!lote || typeof lote !== 'object') return lote;
  const c = { ...lote };
  for (const k of CAMPOS_LEILOEIRO) if (k in c) c[k] = null;
  return c;
}
