// Termo de ciência de compra — versionado para rastreabilidade (chargeback).
// Ao mudar o texto, incremente a versão: o aceite grava a versão vigente.
export const TERMOS_VERSAO = '2.0';

/**
 * Monta o texto do termo de ciência adaptado ao produto.
 * @param {object} p
 * @param {string} p.nome        Nome do produto (ex.: "Investidor Pro")
 * @param {string} p.valorLabel  Valor formatado (ex.: "R$ 49,90")
 * @param {'recorrente'|'unico'|'parcelado'} p.modelo  Modelo de cobrança
 * @param {string} [p.inclui]    Resumo do que está incluso
 * @param {boolean} [p.honorarios] Se incide 10% de honorários em caso de êxito
 */
export function montarTermo({ nome, valorLabel, modelo = 'unico', inclui = '', honorarios = false }) {
  const cobranca = modelo === 'recorrente' ? 'assinatura mensal recorrente'
    : modelo === 'parcelado' ? 'pagamento parcelado em até 12×'
    : 'pagamento único';

  const linhas = [
    `Declaro, para os devidos fins, que estou contratando de forma livre e consciente o produto ${nome}, no valor de ${valorLabel} (${cobranca}).`,
    `Estou ciente de que se trata de um serviço/produto digital de acesso à plataforma BidPro Brasil, com ativação imediata após a confirmação do pagamento${inclui ? `, incluindo: ${inclui}` : ''}.`,
  ];
  if (modelo === 'recorrente') {
    linhas.push('Autorizo a cobrança recorrente e estou ciente de que posso cancelar a qualquer momento pela plataforma, sem multa.');
  }
  if (honorarios) {
    linhas.push('Estou ciente de que, em caso de arrematação bem-sucedida, incidirão 10% de honorários sobre o valor arrematado.');
  }
  linhas.push('Reconheço esta cobrança como legítima e de minha responsabilidade. Confirmo a leitura dos Termos de Uso e da Política de Privacidade.');
  return linhas.join(' ');
}
