// ALERTA "AVALIAÇÃO × MERCADO" (30/09, dono: alerta visível no relatório de Embu-Guaçu). Mesma régua
// do agente de aprendizado (api/gerar-analise.js, `mercado_incoerente_avaliacao`: mercado > 4× ou
// < 0,25× a avaliação), que até hoje só marcava o caso INTERNAMENTE — o cliente lia um lucro enorme
// sem saber que a própria avaliação judicial contradiz o mercado. Calculado na TELA a partir dos
// números já gravados: vale para relatório antigo sem regerar (custo zero).
export function alertaAvaliacaoMercado(valorMercado, valorAvaliacao) {
  const m = Number(valorMercado) || 0, a = Number(valorAvaliacao) || 0;
  if (!(m > 0 && a > 0)) return null;
  const r = m / a;
  if (r <= 4 && r >= 0.25) return null;
  const vezes = r > 1 ? `${r.toFixed(1).replace('.', ',')}× acima` : `${(1 / r).toFixed(1).replace('.', ',')}× abaixo`;
  return {
    razao: r,
    titulo: r > 1 ? 'Avaliação muito abaixo do mercado' : 'Avaliação muito acima do mercado',
    texto: `O valor de mercado estimado está ${vezes} da avaliação judicial. Antes do lance, confira a DATA da avaliação (pode estar desatualizada) e a matrícula/edital: fração ideal, servidão, área não edificável, restrição ambiental ou ocupação podem explicar a diferença — e mudam o resultado da operação.`,
  };
}
