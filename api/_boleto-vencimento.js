// PRAZO DO BOLETO — 7 dias corridos (07/10, decisão do dono).
//
// Sem `date_of_expiration` no payload o Mercado Pago aplica o padrão dele (3 dias). Curto demais
// para a parcela "para dar entrada no registro" do serviço de cartório, onde a regra é o cliente
// pagar ANTES de darmos entrada: boleto vencido vira reemissão manual pela equipe, porque a trava
// de 2 min por cobrança impede o próprio cliente de gerar outro na hora.
//
// Módulo à parte para que o teste (`npm run testar:boleto-vencimento`) exercite a MESMA função que
// o handler usa — teste que copia a função passa a medir a cópia no dia em que uma das duas muda.
export const DIAS_BOLETO = 7;

export function vencimentoBoleto(dias = DIAS_BOLETO, agora = Date.now()) {
  const d = new Date(agora + dias * 86400000);
  // Data do dia EM BRASÍLIA (UTC-3): às 00h30 UTC ainda é o dia anterior aqui, e usar a data UTC
  // daria um dia a mais ao cliente — pequeno, mas é o tipo de erro que só aparece de madrugada.
  const brt = new Date(d.getTime() - 3 * 3600000);
  const ymd = `${brt.getUTCFullYear()}-${String(brt.getUTCMonth() + 1).padStart(2, '0')}-${String(brt.getUTCDate()).padStart(2, '0')}`;
  // O MP exige offset explícito; fim do dia em Brasília para o último dia valer inteiro.
  return `${ymd}T23:59:59.000-03:00`;
}
