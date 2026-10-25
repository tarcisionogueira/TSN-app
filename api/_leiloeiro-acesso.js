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
  ? `${im.tipo && !/^(outros?|im[oó]vel)$/i.test(im.tipo) ? im.tipo.charAt(0).toUpperCase() + im.tipo.slice(1) : 'Imóvel'}${im.cidade ? ` em ${im.cidade}${im.estado ? `/${im.estado}` : ''}` : ''}`
  : im?.titulo);

// RELATÓRIO MERCADOLÓGICO SEM O LINK DO DOCUMENTO DO LEILOEIRO (25/10, cofre do leiloeiro).
// api/gerar-analise.js lê o edital/matrícula com a SERVICE KEY e gravava a URL do PDF (servidor do leiloeiro:
// documentacao.portalzuk..., static.suporteleiloes..., S3 do leiloeiro) em quatro pontos do `result`, que o DONO do
// relatório lê em analises_mercado — inclusive o Explorador. Os pontos foram medidos no banco (25/10): fora deles,
// nenhum host de leiloeiro aparece no result de quem não paga. Os BOOLEANOS ficam (editalLido, custosLidos): dizem
// que o documento foi lido sem dizer onde ele está. Muta e devolve o mesmo objeto; `null`/não-objeto passa direto.
// MESMA lista de caminhos de public.analise_mercado_sem_leiloeiro() no banco (backfill) — mudar nos dois.
export function limparLeiloeiroDoRelatorio(result) {
  if (!result || typeof result !== 'object') return result;
  const m = result.mercado && typeof result.mercado === 'object' ? result.mercado : null;
  if (m?.condicoesEdital && typeof m.condicoesEdital === 'object') delete m.condicoesEdital.fonte;
  if (m?.metodologia?.documento && typeof m.metodologia.documento === 'object') delete m.metodologia.documento.editalFonte;
  if (m?.metodologia?.area?.divergencia && typeof m.metodologia.area.divergencia === 'object') delete m.metodologia.area.divergencia.fonte;
  if (result.divergenciaArea && typeof result.divergenciaArea === 'object') delete result.divergenciaArea.fonte;
  return result;
}
