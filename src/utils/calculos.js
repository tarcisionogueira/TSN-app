// Tabela SAC
export const calcularSAC = (principal, taxaAnual, prazoMeses) => {
  if (prazoMeses <= 0 || principal <= 0) return [];
  const taxaMensal = Math.pow(1 + taxaAnual / 100, 1 / 12) - 1;
  const amortizacao = principal / prazoMeses;
  const tabela = [];
  let saldo = principal;
  for (let i = 1; i <= prazoMeses; i++) {
    const juros = saldo * taxaMensal;
    const parcela = amortizacao + juros;
    saldo = Math.max(0, saldo - amortizacao);
    tabela.push({ mes: i, parcela, amortizacao, juros, saldo });
  }
  return tabela;
};

// Tabela PRICE
export const calcularPrice = (principal, taxaAnual, prazoMeses) => {
  if (prazoMeses <= 0 || principal <= 0) return [];
  const taxaMensal = Math.pow(1 + taxaAnual / 100, 1 / 12) - 1;
  if (taxaMensal === 0) {
    const parcela = principal / prazoMeses;
    return Array.from({ length: prazoMeses }, (_, i) => ({
      mes: i + 1, parcela, amortizacao: parcela, juros: 0, saldo: Math.max(0, principal - parcela * (i + 1))
    }));
  }
  const parcela = (principal * taxaMensal * Math.pow(1 + taxaMensal, prazoMeses)) / (Math.pow(1 + taxaMensal, prazoMeses) - 1);
  const tabela = [];
  let saldo = principal;
  for (let i = 1; i <= prazoMeses; i++) {
    const juros = saldo * taxaMensal;
    const amortizacao = parcela - juros;
    saldo = Math.max(0, saldo - amortizacao);
    tabela.push({ mes: i, parcela, amortizacao, juros, saldo });
  }
  return tabela;
};

// Métricas principais de um cenário
export const calcularMetricasCenario = (inputs, vArremate, isAVista) => {
  const isUsoProprio = inputs.objetivoCompra === 'uso_proprio';
  const vMercado = Number(inputs.valorMercado) || 0;
  const vLocacao = Number(inputs.valorLocacao) || 0;
  const manutencao = Number(inputs.manutencaoEstimada) || 0;
  const debitos = Number(inputs.debitosAssumidos) || 0;
  const iptu = Number(inputs.iptuMensal) || 0;
  const cond = Number(inputs.condominioMensal) || 0;
  const itbiPct = Number(inputs.itbiPercentual) || 0;
  const sinalPct = Number(inputs.sinalPercentual) || 0;
  const taxaLeiloeiroPct = Number(inputs.taxaLeiloeiroPercentual) || 0;
  const laudemio = Number(inputs.laudemio) || 0;
  const foreiro = Number(inputs.foreiro) || 0;
  const pVenda = Number(inputs.prazoVendaMeses) || 1;
  const pMeses = Number(inputs.prazoMeses) || 0;
  const cet = Number(inputs.cetAnual) || 0;
  const tabelaAmort = inputs.tabelaAmortizacao || 'sac';

  const taxaLeiloeiro = vArremate * (taxaLeiloeiroPct / 100);
  // Honorários BidPro (taxa de ÊXITO do escritório): padrão 10% em TODO arremate
  // (judicial E extrajudicial), sobrescrevível por inputs.honorariosPercentual.
  const honorariosPct = inputs.honorariosPercentual != null
    ? Number(inputs.honorariosPercentual)
    : 10;
  const honorarios = vArremate * (honorariosPct / 100);
  const itbiRegistro = vArremate * (itbiPct / 100);
  // Taxa administrativa do leilão (% sobre a arrematação, ALÉM do leiloeiro — comum
  // na Superbid) + despesas administrativas (valor fixo, raras). Ambas vêm do EDITAL
  // e impactam a projeção — por isso entram nos aportes.
  const taxaAdmPct = Number(inputs.taxaAdministrativaPercentual) || 0;
  const taxaAdministrativa = vArremate * (taxaAdmPct / 100);
  const despesasAdm = Number(inputs.despesasAdministrativas) || 0;
  const custosExtra = taxaLeiloeiro + honorarios + itbiRegistro + taxaAdministrativa + despesasAdm + debitos + manutencao + laudemio + foreiro;
  const custoCarrrego = (iptu + cond) * pVenda;

  if (isAVista) {
    const capitalMobilizado = vArremate + custosExtra + custoCarrrego;
    const valorRef = isUsoProprio ? vMercado : vMercado * 0.90;
    const comissao = isUsoProprio ? 0 : valorRef * 0.05;
    const baseGC = valorRef - (vArremate + custosExtra) - comissao;
    const ir = (!isUsoProprio && baseGC > 0) ? baseGC * 0.15 : 0;
    const receitaLiquida = valorRef - comissao - ir;
    const lucro = receitaLiquida - capitalMobilizado;
    const roi = capitalMobilizado > 0 ? (lucro / capitalMobilizado) * 100 : 0;
    const yieldAnual = capitalMobilizado > 0 ? (vLocacao * 12 / capitalMobilizado) * 100 : 0;
    return {
      vArremate, taxaLeiloeiro, honorarios, itbiRegistro, taxaAdministrativa, despesasAdm, laudemio, foreiro, debitos, manutencao,
      custoCarrrego, capitalMobilizado, valorRef, comissao, ir, receitaLiquida, lucro, roi,
      valorSinal: vArremate, parcelasPagas: 0, saldoDevedor: 0, parcelaMedia: 0,
      yieldMensal: capitalMobilizado > 0 ? (vLocacao / capitalMobilizado) * 100 : 0, yieldAnual,
      // Blocos de caixa (à vista): tudo é desembolsado na arrematação; sem parcela mensal.
      custosExtra, desembolsoInicial: vArremate + custosExtra, carregoMensal: iptu + cond,
      mesesCarregados: pVenda, custoVenda: comissao + ir + 0, aluguelMensal: vLocacao,
    };
  } else {
    const valorSinal = vArremate * (sinalPct / 100);
    const valorFinanciado = vArremate - valorSinal;
    const desembolsoInicial = valorSinal + custosExtra;
    const tabelaFn = tabelaAmort === 'price' ? calcularPrice : calcularSAC;
    const tabela = pMeses > 0 ? tabelaFn(valorFinanciado, cet, pMeses) : [];
    const mesesCarregados = Math.min(pVenda, pMeses);
    const parcelasPagas = tabela.slice(0, mesesCarregados).reduce((s, r) => s + r.parcela, 0);
    const saldoDevedor = tabela[mesesCarregados - 1]?.saldo ?? valorFinanciado;
    const parcelaMedia = mesesCarregados > 0 ? parcelasPagas / mesesCarregados : tabela[0]?.parcela ?? 0;
    const capitalMobilizado = desembolsoInicial + parcelasPagas + custoCarrrego;
    const valorRef = isUsoProprio ? vMercado : vMercado * 0.90;
    const comissao = isUsoProprio ? 0 : valorRef * 0.05;
    const baseGC = valorRef - (vArremate + custosExtra) - comissao;
    const ir = (!isUsoProprio && baseGC > 0) ? baseGC * 0.15 : 0;
    const receitaLiquida = valorRef - comissao - ir - saldoDevedor;
    const lucro = receitaLiquida - capitalMobilizado;
    const roe = capitalMobilizado > 0 ? (lucro / capitalMobilizado) * 100 : 0;
    const yieldAnual = capitalMobilizado > 0 ? (vLocacao * 12 / capitalMobilizado) * 100 : 0;
    return {
      vArremate, taxaLeiloeiro, honorarios, itbiRegistro, taxaAdministrativa, despesasAdm, laudemio, foreiro, debitos, manutencao,
      custoCarrrego, capitalMobilizado, valorRef, comissao, ir, receitaLiquida, lucro, roi: roe,
      valorSinal, parcelasPagas, saldoDevedor, parcelaMedia, tabela,
      yieldMensal: capitalMobilizado > 0 ? (vLocacao / capitalMobilizado) * 100 : 0, yieldAnual,
      // Blocos de caixa (financiado): o que sai NA arrematação (sinal + custos) vs. o
      // que se paga por MÊS (parcela do banco + carrego) vs. o que sai NA VENDA.
      custosExtra, desembolsoInicial, carregoMensal: iptu + cond,
      mesesCarregados, custoVenda: comissao + ir + saldoDevedor, aluguelMensal: vLocacao,
    };
  }
};

// Busca teto máximo de lance para manter meta de retorno
export const calcularTetoLance = (inputs, isAVista, metaRetorno, vMercado) => {
  let low = 0, high = vMercado, teto = 0;
  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2;
    const m = calcularMetricasCenario(inputs, mid, isAVista);
    if (m.roi >= metaRetorno) { teto = mid; low = mid; } else { high = mid; }
  }
  return teto;
};

/**
 * Calcula cronograma de depósito judicial para arrematação.
 * Tipos: 'execucao_civil' | 'execucao_fiscal' | 'falencia' | 'extrajudicial'
 * Retorna { sinal, saldo, parcelas[], totalDesembolso, custoCaptacao }
 */
export const calcularDepositoJudicial = ({
  valorArrematacao = 0,
  tipo = 'execucao_civil',
  sinalPercentual = 30,       // % a pagar na assinatura
  prazoMeses = 0,             // meses para quitação (0 = à vista)
  indiceAnual = 10.5,         // SELIC anual % ou índice acordado
  depositoJaRealizado = 0,    // eventual depósito prévio do devedor
}) => {
  const v = Number(valorArrematacao) || 0;
  const dep = Math.min(Number(depositoJaRealizado) || 0, v);
  const base = v - dep; // valor líquido a pagar

  // Tipos com quitação integral (sem parcelamento)
  const avista = tipo === 'falencia' || tipo === 'execucao_civil' || prazoMeses <= 1;
  const pct = Math.min(Math.max(Number(sinalPercentual) || 30, 0), 100) / 100;
  const sinal = avista ? base : base * pct;
  const saldo = avista ? 0 : base - sinal;

  let parcelas = [];
  let custoCaptacao = 0;

  if (!avista && saldo > 0 && prazoMeses > 0) {
    const taxaMensal = Math.pow(1 + (Number(indiceAnual) || 0) / 100, 1 / 12) - 1;
    if (taxaMensal === 0) {
      const parc = saldo / prazoMeses;
      parcelas = Array.from({ length: prazoMeses }, (_, i) => ({
        mes: i + 1, parcela: parc, saldo: Math.max(0, saldo - parc * (i + 1)),
      }));
    } else {
      const parc = (saldo * taxaMensal * Math.pow(1 + taxaMensal, prazoMeses)) /
        (Math.pow(1 + taxaMensal, prazoMeses) - 1);
      let sal = saldo;
      parcelas = Array.from({ length: prazoMeses }, (_, i) => {
        const juros = sal * taxaMensal;
        const amort = parc - juros;
        sal = Math.max(0, sal - amort);
        return { mes: i + 1, parcela: parc, juros, amortizacao: amort, saldo: sal };
      });
    }
    custoCaptacao = parcelas.reduce((s, p) => s + p.parcela, 0) - saldo;
  }

  const totalDesembolso = sinal + parcelas.reduce((s, p) => s + p.parcela, 0) + dep;
  return { sinal, saldo, parcelas, totalDesembolso, custoCaptacao, depositoJaRealizado: dep };
};

// ─── Indicadores financeiros (VPL, TIR, payback, múltiplo) ────────────────────
// TMA = Taxa Mínima de Atratividade: a "régua" de quanto o dinheiro renderia
// parado. Simples e configurável; padrão 12% ao ano.
export const TMA_PADRAO = 12;

const mensalDeAnual = (anual) => Math.pow(1 + (Number(anual) || 0) / 100, 1 / 12) - 1;

// VPL de uma série de fluxos mensais (fluxos[0] = mês 0). tmaAnual em % a.a.
export const calcularVPL = (fluxos, tmaAnual = TMA_PADRAO) => {
  const i = mensalDeAnual(tmaAnual);
  return (fluxos || []).reduce((acc, f, t) => acc + (Number(f) || 0) / Math.pow(1 + i, t), 0);
};

// TIR mensal por bisseção → anualizada (%). Retorna null quando não há inversão
// de sinal ou não converge (evita exibir um número enganoso).
export const calcularTIR = (fluxos) => {
  const f = (fluxos || []).map(x => Number(x) || 0);
  if (f.length < 2 || !f.some(x => x > 0) || !f.some(x => x < 0)) return null;
  const vpl = (i) => f.reduce((acc, x, t) => acc + x / Math.pow(1 + i, t), 0);
  let lo = -0.9, hi = 1.0, flo = vpl(lo);
  if (flo * vpl(hi) > 0) return null;
  let mid = 0;
  for (let k = 0; k < 200; k++) {
    mid = (lo + hi) / 2;
    const fm = vpl(mid);
    if (Math.abs(fm) < 1e-7) break;
    if (flo * fm < 0) hi = mid; else { lo = mid; flo = fm; }
  }
  const anual = (Math.pow(1 + mid, 12) - 1) * 100;
  return isFinite(anual) ? anual : null;
};

// Payback em meses, nominal e descontado. null se não recupera no horizonte.
export const calcularPayback = (fluxos, tmaAnual = TMA_PADRAO) => {
  const i = mensalDeAnual(tmaAnual);
  let accNom = 0, accDesc = 0, nom = null, desc = null;
  (fluxos || []).forEach((f, t) => {
    const v = Number(f) || 0;
    accNom += v; accDesc += v / Math.pow(1 + i, t);
    if (nom === null && t > 0 && accNom >= 0) nom = t;
    if (desc === null && t > 0 && accDesc >= 0) desc = t;
  });
  return { meses: nom, mesesDescontado: desc };
};

// Múltiplo sobre o capital (MOIC) = total que volta ÷ capital investido.
export const calcularMultiplo = (capital, retornoTotal) => {
  const c = Number(capital) || 0;
  return c > 0 ? (Number(retornoTotal) || 0) / c : null;
};

// Fluxo mensal do cenário de LOCAÇÃO (hold), em base à vista, para VPL/TIR:
//   mês 0 = -(capital de aquisição: arremate + custos, sem o carrego do flip)
//   mês t = + aluguel líquido (aluguel − IPTU − condomínio)
//   mês H = + venda ao final (valor de referência líquido de comissão/IR)
// Premissas explícitas (mostradas no relatório): horizonte de saída e venda ao
// valor de mercado atual; sem financiamento (hold mais limpo de interpretar).
export const fluxoLocacao = (inputs, horizonteMeses = 60) => {
  const mAV = calcularMetricasCenario(inputs, Number(inputs.valorArrematacao) || 0, true);
  const aluguel = Number(inputs.valorLocacao) || 0;
  const carrego = (Number(inputs.iptuMensal) || 0) + (Number(inputs.condominioMensal) || 0);
  const aluguelLiquido = aluguel - carrego;
  const capital = mAV.capitalMobilizado - mAV.custoCarrrego;   // só aquisição
  const vendaFim = mAV.receitaLiquida;                          // venda líquida ao fim
  const H = Math.max(1, Math.round(horizonteMeses));
  const fluxos = [-capital];
  for (let t = 1; t <= H; t++) fluxos.push(aluguelLiquido + (t === H ? vendaFim : 0));
  return { fluxos, capital, aluguelLiquido, vendaFim, horizonte: H };
};

export const fmt = (v, dec = 2) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export const fmtPct = (v, dec = 2) => `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;

/**
 * MEDIDA AUSENTE NÃO É MEDIDA ZERO (15/08, achado do dono no relatório de Morada dos
 * Pinheiros). A tela mostrava **"Aluguel médio R$ 0,00/mês"** e **"Rentabilidade 0,00% a.a."**
 * e, duas seções abaixo, o Índice BidPro da mesma cidade exibia **R$ 37,25/m²/mês com 20
 * amostras**. Os dois quadros vinham do mesmo relatório e diziam coisas opostas.
 *
 * A origem é sempre a mesma construção: `fmt(x || 0)`. Quando a busca não encontra locações,
 * `aluguelMedio` chega `0`/`null` — que significa "não medi" — e o `|| 0` o converte num
 * NÚMERO, que a tela imprime como se fosse resultado. "R$ 0,00/mês" não é um dado ausente:
 * é a afirmação de que o imóvel não rende aluguel nenhum, e em rentabilidade vira conclusão
 * de investimento — a pior classe de erro que este relatório pode cometer.
 *
 * `moedaOuTraco` e `pctOuTraco` devolvem `—` quando não há medida. Use-os em todo número que
 * possa simplesmente não ter sido apurado; `fmt`/`fmtPct` continuam para o que é sempre
 * calculável (um total, uma diferença, um valor de entrada do próprio usuário).
 */
export const SEM_MEDIDA = '—';
export const moedaOuTraco = (v, { prefixo = 'R$ ', sufixo = '', dec = 2 } = {}) =>
  (Number(v) > 0 ? `${prefixo}${fmt(v, dec)}${sufixo}` : SEM_MEDIDA);
export const pctOuTraco = (v, { sufixo = '', dec = 2 } = {}) =>
  (Number(v) > 0 ? `${fmtPct(v, dec)}${sufixo}` : SEM_MEDIDA);
