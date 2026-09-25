// ORIGEM DA VENDA do veículo (25/09, pedido do dono) — quem vende muda o risco e o preço mais do
// que "judicial × extrajudicial". Classificado no BANCO (public.classificar_origem_veiculo, gatilho
// em veiculos_leilao — ver supabase/migrations/veiculo_origem_venda.sql), nunca chutado na tela:
// sem sinal no dado, fica 'nao_identificado'.
export const ORIGEM_VENDA = {
  judicial:      { rotulo: 'Judicial',       cor: '#6d28d9', fundo: '#ede9fe', dica: 'Há processo judicial envolvido (vara, tribunal, execução).' },
  financeira:    { rotulo: 'Financeira',     cor: '#075985', fundo: '#e0f2fe', dica: 'Retomada de financiamento, consórcio ou leasing (banco/financeira).' },
  seguradora:    { rotulo: 'Seguradora',     cor: '#9a3412', fundo: '#ffedd5', dica: 'Veículo de seguradora — sinistro ou recuperado de roubo. Confira a monta.' },
  patio:         { rotulo: 'Detran / pátio', cor: '#854d0e', fundo: '#fef9c3', dica: 'Removido ou apreendido por órgão de trânsito (Detran, PRF, prefeitura). Pode ter débitos e restrições.' },
  orgao_publico: { rotulo: 'Órgão público',  cor: '#155e75', fundo: '#cffafe', dica: 'Bem próprio do poder público (prefeitura, estado, autarquia) — frota usada.' },
  corporativo:   { rotulo: 'Corporativo',    cor: '#166534', fundo: '#dcfce7', dica: 'Empresa vendendo a própria frota ou ativo (renovação de frota, desmobilização).' },
  nao_identificado: { rotulo: 'Não identificado', cor: '#475569', fundo: '#f1f5f9', dica: 'O leiloeiro não informa quem vende.' },
};
// Todas as origens em que NÃO há processo — o "extrajudicial" de antes, agora aberto por tipo.
export const ORIGENS_EXTRAJUDICIAIS = ['financeira', 'seguradora', 'patio', 'orgao_publico', 'corporativo'];
