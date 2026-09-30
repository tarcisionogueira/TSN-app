// Quem pode propor compra direta de veículo — espelho de ROLES_PROPOSTA_VEICULO em
// api/propor-veiculo-leiloeiro.js (a autorização de verdade é do servidor; a tela só não mostra
// um botão que daria 403). Proposta só SEM LANCE CONFIRMADO (dono, 24/09): venda condicional
// (lance abaixo da reserva) não aceita proposta, e o indeterminado pode ser uma.
export const ROLES_PROPOSTA_VEICULO = ['admin', 'analista', 'suporte'];
export const podeProporVeiculo = (v, role) => ROLES_PROPOSTA_VEICULO.includes(role) && v?.resultado_leilao === 'sem_lance' && !v?.teve_lance;
