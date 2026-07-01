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
  // Honorários jurídicos: padrão 10% (regra de negócio BidPro), sobrescrevível por
  // inputs.honorariosPercentual (ex.: 0 quando o cliente não quiser incluí-los).
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
      yieldMensal: capitalMobilizado > 0 ? (vLocacao / capitalMobilizado) * 100 : 0, yieldAnual
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
      yieldMensal: capitalMobilizado > 0 ? (vLocacao / capitalMobilizado) * 100 : 0, yieldAnual
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

export const fmt = (v, dec = 2) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export const fmtPct = (v, dec = 2) => `${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}%`;
