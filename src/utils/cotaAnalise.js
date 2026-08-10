/**
 * COTA DE RELATÓRIO MERCADOLÓGICO — espelho ÚNICO do banco no frontend.
 *
 * POR QUE EXISTE (09/08): esta regra estava copiada em TRÊS telas e as cópias já tinham
 * divergido. `Busca.jsx` anunciava 15 relatórios/mês para o Investidor Pro; `Analise.jsx` e a
 * função `limite_ia` do banco dizem 10 (15 é só o grandfather de `plano_legado`). Ou seja: a
 * busca prometia cinco relatórios que o servidor não entregaria. É a mesma classe de problema
 * dos "dois cérebros" do saque — planejamento em cima de uma regra que o código não aplica.
 * Daqui para frente, quem precisar da cota importa deste arquivo; mexeu no banco, mexe AQUI, e
 * as telas acompanham juntas.
 *
 * FONTE DA VERDADE continua sendo o servidor: `limite_ia(role, tipo)` +
 * `limite_ia_efetivo(user, tipo)` (grandfather) e o consumo em `consumir_analise_por()`.
 * Este arquivo só evita que a UI bloqueie (ou prometa) antes da hora.
 */

// Planos de CLIENTE pagante que carregam o grandfather de 15 quando `plano_legado`.
export const ROLES_PAGOS_CLIENTE = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];

// Espelha o ramo `else` de limite_ia(role,'mercado'). Equipe (analista/advogado) não gera
// relatório próprio — recebe demanda — por isso fica de fora e cai no 0.
const LIMITE_MERCADO = {
  explorador: 3, consultor: 5,
  top2: 10, top2_anual: 10,
  assessorado: 10, assessorado_anual: 10,
  clube: 10, clube_anual: 10,
};

/** null = ilimitado (admin). 0 = não gera. */
export function limiteMercado(role, planoLegado) {
  if (role === 'admin') return null;
  if (planoLegado && ROLES_PAGOS_CLIENTE.includes(role)) return 15;
  return LIMITE_MERCADO[role] || 0;
}

/**
 * O EXPLORADOR consome AMOSTRA VITALÍCIA (`amostra_mercado_usadas`), que não reseta no mês;
 * os demais consomem cota MENSAL (`analises_count` + `analises_mes`). Escritor e leitor
 * precisam concordar sobre onde o dado mora — ler a coluna errada foi o bug que deixava o
 * contador do explorador eternamente em "3 de 3".
 */
export const vitalicia = (role) => role === 'explorador';

/** Colunas a pedir no select do perfil. */
export const COTA_SELECT = 'analises_mes, analises_count, amostra_mercado_usadas, bonus_mercado';

export function usadasMercado(perfil, role) {
  if (!perfil) return 0;
  if (vitalicia(role)) return perfil.amostra_mercado_usadas || 0;
  const mes = new Date().toISOString().slice(0, 7);
  return perfil.analises_mes === mes ? (perfil.analises_count || 0) : 0;
}

/**
 * Lê o estado da cota do usuário. Devolve sempre um objeto — nunca lança —, porque quem chama
 * usa isso para PINTAR botão: uma falha de rede não pode virar "você não tem análise".
 * `restantes` já soma o bônus, espelhando consumir_analise_por (gasta o principal e usa o
 * bônus como excedente).
 */
export async function lerCotaMercado(supabase, userId, role, planoLegado) {
  const limite = limiteMercado(role, planoLegado);
  const vazio = { limite, usadas: 0, bonus: 0, restantes: null, ilimitado: limite === null, vitalicia: vitalicia(role), carregou: false };
  if (!userId || limite === null) return vazio;

  const { data, error } = await supabase.from('perfis').select(COTA_SELECT).eq('id', userId).single();
  if (error || !data) return vazio;

  const usadas = usadasMercado(data, role);
  const bonus = data.bonus_mercado || 0;
  return {
    limite, usadas, bonus,
    restantes: Math.max(0, limite - usadas) + bonus,
    ilimitado: false,
    vitalicia: vitalicia(role),
    carregou: true,
  };
}
