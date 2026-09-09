// UMA regra para "este relatório está ENTREGUE?" — e ela vive AQUI, não em cada tela.
//
// Por que existe (09/09, achado do dono): o toast "Pronto! Relatório mercadológico pronto"
// apareceu com a barra de progresso ainda no 1º passo. Não foi corrida nem cache: o servidor
// grava `status:'concluida'` DE PROPÓSITO quando o mercado veio mas o PARECER saiu vazio
// (api/gerar-analise.js, "ENTREGA INCOMPLETA HONESTA"), marcando `result.parecerPendente`. A
// tela SABIA disso (`relMercadoIncompleto`) e até disparava a regeração automática — que reseta
// a barra para o passo 1. O toast, olhando a MESMA linha, dizia "Pronto!", porque o gate dele
// era por tipo com saída permissiva: tinha ramo para 'documental' e 'laudo' e terminava em
// `return true`. O terceiro tipo caía no default e virava "pronto" por omissão.
//
// No rastro do banco daquele dia, o mesmo imóvel passou por esse estado DUAS vezes (13:23 e
// 14:02) — dois toasts falsos, cada um seguido de uma nova geração.
//
// Duas decisões que fazem este arquivo ser o conserto DEFINITIVO, e não o terceiro remendo
// (o anterior foi 07/08, caso Cotia, que fechou só 'documental' e 'laudo'):
//   1. REGRA ÚNICA: a tela e o toast passam a ler daqui. Regra duplicada é regra que diverge —
//      foi exatamente a divergência que produziu "a tela diz incompleto / o toast diz pronto".
//   2. DEFAULT NEGATIVO: tipo que este arquivo não conhece devolve 'tipo-desconhecido', não
//      "entregue". Um tipo novo de relatório nunca mais estreia anunciando-se pronto por
//      esquecimento — que é literalmente como o 'mercado' chegou aqui.
//
// Devolve o MOTIVO do que falta (string) ou null quando está entregue. O motivo é útil na tela
// (banner e auto-heal olham 'parecer') e mantém "não entregue" distinguível de "não sei".
export function faltaNoRelatorio(tipo, analise) {
  if (analise?.status !== 'concluida') return 'gerando';
  const r = analise.result;
  if (tipo === 'mercado') {
    if (!r) return 'sem-resultado';
    // mercadoVazio é entrega LEGÍTIMA: a busca ao vivo não achou comparável e o valor vem do
    // Índice BidPro (regra do dono). Sem esta linha, o fallback viraria "incompleto" para sempre.
    if (r.mercadoVazio) return null;
    return (r.parecerPendente === true || !String(r.parecer || '').trim()) ? 'parecer' : null;
  }
  if (tipo === 'documental') return r?.precisaDocumentos ? 'documentos' : null;
  if (tipo === 'laudo') return r?.precisaRelatorios ? 'relatorios' : null;
  return 'tipo-desconhecido';
}

export const relatorioEntregue = (tipo, analise) => faltaNoRelatorio(tipo, analise) === null;
