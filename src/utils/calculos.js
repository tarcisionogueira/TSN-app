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
  const honorarios = vArremate * 0.10;
  const itbiRegistro = vArremate * (itbiPct / 100);
  const custosExtra = taxaLeiloeiro + honorarios + itbiRegistro + debitos + manutencao + laudemio + foreiro;
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
      vArremate, taxaLeiloeiro, honorarios, itbiRegistro, laudemio, foreiro, debitos, manutencao,
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
      vArremate, taxaLeiloeiro, honorarios, itbiRegistro, laudemio, foreiro, debitos, manutencao,
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

export const fmt = (v, dec = 2) =>
  Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export const fmtPct = (v, dec = 1) => `${Number(v || 0).toFixed(dec)}%`;
