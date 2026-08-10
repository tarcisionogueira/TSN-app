/**
 * COTA — a tela pergunta ao BANCO quanto a pessoa tem. Não existe tabela de limites no
 * frontend, de propósito.
 *
 * POR QUE (09/08): a tabela de limites estava copiada em QUATRO telas e todas as cópias já
 * tinham divergido do servidor, cada uma para um lado:
 *   • `Busca.jsx` prometia 15 relatórios/mês ao Investidor Pro — o banco entrega 10;
 *   • `HomeCliente.jsx` dava `limite: null` ao CONSULTOR, e null vira "Análises ilimitadas"
 *     na tela — o consultor tem 5;
 *   • `Analise.jsx` dava 0 à equipe, o banco dá 100;
 *   • o popup de bônus em `App.jsx` anunciava "5 análises por mês" fixo, sem ler nada.
 * Todas eram anúncio falso de quantidade. A causa é sempre a mesma: cópia que envelhece
 * sozinha. A cura não é sincronizar as cópias — é não ter cópia.
 *
 * `minhas_cotas(user_id)` já existia no banco, é STABLE SECURITY DEFINER, exige `auth.uid()`
 * (admin/analista podem ler de terceiros, o que faz o modo suporte funcionar) e — o ponto que
 * importa — ESPELHA O RAMO DA ESCRITA: devolve `amostra: true` para o explorador, cujo
 * contador é VITALÍCIO (`amostra_mercado_usadas`) e não reseta no mês. É a única fonte que
 * não pode divergir de `consumir_analise_por`, porque as duas leem as mesmas colunas.
 *
 * Formato devolvido:
 *   { plano, role, mes, amostra, credito_saldo,
 *     mercado:    { usado, limite, bonus, ilimitado, amostra },
 *     documental: { usado, limite, bonus, ilimitado },
 *     indice:     { usado, limite, bonus, ilimitado } }
 */

/**
 * Nunca lança e nunca inventa: devolve `null` se a leitura falhar. Quem chama usa isso para
 * PINTAR botão e selo — uma falha de rede não pode virar "você não tem análise" nem, pior,
 * um número errado na tela.
 */
export async function lerCotas(supabase, userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase.rpc('minhas_cotas', { p_user_id: userId });
    if (error || !data || data.erro) return null;
    return data;
  } catch {
    return null;
  }
}

/** Atalho para quem só precisa do relatório mercadológico. */
export async function lerCotaMercado(supabase, userId) {
  const c = await lerCotas(supabase, userId);
  return c?.mercado ? { ...c.mercado, restantes: restantesDe(c.mercado) } : null;
}

/**
 * Quanto ainda dá para gerar. Espelha `consumir_analise_por`: gasta o limite principal
 * primeiro e usa o bônus como excedente — por isso o bônus SOMA ao que sobrou, e não
 * ao limite.
 */
export function restantesDe(bloco) {
  if (!bloco || bloco.ilimitado) return null;
  const limite = Number(bloco.limite || 0);
  const usado = Number(bloco.usado || 0);
  return Math.max(0, limite - usado) + Number(bloco.bonus || 0);
}

/**
 * "este mês" ou "no total". Dizer "este mês" ao explorador é a falha mais cara desta família:
 * ele lê que renova, não renova nunca, e some — em vez de comprar crédito ou assinar.
 */
export function janelaLabel(bloco) {
  return bloco?.amostra ? 'no total' : 'este mês';
}
