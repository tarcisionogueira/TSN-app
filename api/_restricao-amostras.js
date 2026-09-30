// COMPARÁVEIS DENTRO DA RESTRIÇÃO TERRITORIAL — decisão do dono (30/09, "opção 3"), caso Embu-Guaçu:
// terreno de 2.503 m² na APRM Guarapiranga, avaliação R$ 66 mil, e o mercadológico saiu R$ 582 mil —
// o prompt já PEDIA comparáveis de dentro do manancial e o modelo trouxe os de fora. Pedido em texto
// não é regra; aqui vira código:
//  · cada venda vem marcada pela IA com `dentroRestricao` (true/false; ausente = não sabe);
//  · com 3+ vendas DENTRO, só elas ficam nos níveis e o valor é refeito pela mediana delas;
//  · com menos de 3, o valor fica (opção 1) com ALERTA explícito — nunca "sem restrição" em silêncio.
// Função pura: não lê banco nem rede (teste: scripts/testes/comparaveis-dentro-da-restricao.mjs).

const NIVEIS = ['nivel1', 'nivel2', 'nivel3'];
export const MIN_DENTRO = 3;

const m2De = (v) => {
  const vm2 = Number(v?.valorM2) || 0;
  if (vm2 > 0) return vm2;
  const valor = Number(v?.valor) || 0, m2 = Number(v?.m2) || 0;
  return valor > 0 && m2 > 0 ? valor / m2 : 0;
};
const mediana = (xs) => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
};
const brl = (v) => 'R$ ' + Math.round(v).toLocaleString('pt-BR');

// Muta e devolve `mercado`. `restricoes` = texto do mapa (ex.: "APRM Guarapiranga (manancial), SUC");
// `areaM2` = área que o valor multiplica quando a IA não informou `areaConsiderada`.
export function aplicarRestricaoNasAmostras(mercado, { restricoes, areaM2 = 0 } = {}) {
  if (!mercado || !restricoes) return mercado;
  const todas = NIVEIS.flatMap((k) => (mercado[k]?.vendas || []).map((v) => ({ k, v })));
  const dentro = todas.filter(({ v }) => v?.dentroRestricao === true && m2De(v) > 0);
  const fora = todas.filter(({ v }) => v?.dentroRestricao === false).length;
  const semInfo = todas.length - dentro.length - fora;

  if (dentro.length >= MIN_DENTRO) {
    for (const k of NIVEIS) {
      if (!mercado[k]) continue;
      const vs = (mercado[k].vendas || []).filter((v) => v?.dentroRestricao === true && m2De(v) > 0);
      const m2s = vs.map(m2De);
      mercado[k] = { ...mercado[k], vendas: vs, totalAmostras: vs.length,
        precoMedioM2: Math.round(mediana(m2s)), precoMinM2: Math.round(m2s.length ? Math.min(...m2s) : 0), precoMaxM2: Math.round(m2s.length ? Math.max(...m2s) : 0) };
    }
    const precoM2 = mediana(dentro.map(({ v }) => m2De(v)));
    const area = Number(mercado.consolidado?.areaConsiderada) || Number(areaM2) || 0;
    const valor = area > 0 ? Math.round(precoM2 * area) : 0;
    mercado.consolidado = {
      ...(mercado.consolidado || {}),
      precoMedioM2: Math.round(precoM2),
      ...(valor > 0 ? { valorEstimadoImovel: valor, areaConsiderada: area,
        baseCalculo: `Mediana de ${dentro.length} anúncio(s) DENTRO da mesma restrição (${restricoes}): ${brl(precoM2)}/m² × ${area.toLocaleString('pt-BR')} m² = ${brl(valor)}. ${fora + semInfo} anúncio(s) de fora ou sem confirmação descartado(s).` } : {}),
    };
    mercado.restricaoAmostras = { aplicada: true, dentro: dentro.length, fora, semInfo, restricoes };
    return mercado;
  }

  const alerta = `ATENÇÃO — restrição territorial (${restricoes}): só ${dentro.length} anúncio(s) confirmadamente DENTRO da mesma área foram encontrados (mínimo ${MIN_DENTRO}). O valor de mercado abaixo usa anúncios de fora dela e tende a SUPERESTIMAR o preço — a restrição limita lote mínimo e ocupação. Trate como teto, não como referência.`;
  mercado.restricaoAmostras = { aplicada: false, dentro: dentro.length, fora, semInfo, restricoes, alerta };
  mercado.comentario = [alerta, mercado.comentario].filter(Boolean).join(' ');
  return mercado;
}
