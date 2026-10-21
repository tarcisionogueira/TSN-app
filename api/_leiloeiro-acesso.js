/**
 * QUEM VÊ O LEILOEIRO DE UM IMÓVEL — lado do SERVIDOR (#264, bug bounty 21/10).
 * Espelha src/utils/leiloeiroAcesso.js e a função do banco pode_ver_leiloeiro().
 * Por que existe: endpoint que lê com a SERVICE KEY passa por cima da view imoveis_leilao_mascarado
 * (para o service_role a máscara não vale). Quem lê com a chave de serviço e devolve ao navegador
 * tem que respeitar o papel de QUEM CHAMOU — de preferência lendo a view com a chave pública (anon) para quem
 * não pode, como api/busca-raio.js: a máscara mora no banco, num lugar só. Fail-closed: sem sessão = não vê.
 */
import { getUser, getUserRoleById } from './_auth.js';

export const ROLES_PAGOS_IMOVEIS = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
export const ROLES_EQUIPE = ['admin', 'analista', 'consultor', 'advogado', 'suporte'];
export const podeVerLeiloeiro = (role) => ROLES_PAGOS_IMOVEIS.includes(role) || ROLES_EQUIPE.includes(role);

/** { user, role, pode } para a requisição (Edge ou Node). */
export async function acessoLeiloeiro(req) {
  const user = await getUser(req).catch(() => null);
  if (!user?.id) return { user: null, role: null, pode: false };
  const role = await getUserRoleById(user.id).catch(() => null);
  return { user, role, pode: podeVerLeiloeiro(role) };
}

// Título de reserva do scraper ("Imóvel Hasta Leilões 12107") traz o nome do leiloeiro: para quem não pode vê-lo,
// vira "Casa em Campinas/SP". MESMA regra de public.titulo_sem_leiloeiro() no banco (#265) — mudar nos dois.
export const tituloSemLeiloeiro = (im) => (/leil(õ|o)es|leiloeir/i.test(im?.titulo || '')
  ? `${im.tipo ? im.tipo.charAt(0).toUpperCase() + im.tipo.slice(1) : 'Imóvel'}${im.cidade ? ` em ${im.cidade}${im.estado ? `/${im.estado}` : ''}` : ''}`
  : im?.titulo);
