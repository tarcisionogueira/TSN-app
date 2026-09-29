// CENÁRIO REALISTA E TETO DE LANCE DO VEÍCULO (29/09, pedido do dono).
//
// Regra do dono: a soma arrematação + comissão do leiloeiro + despesas assumidas (SEM honorários)
// tem teto de 65% da FIPE. Daí sai o TETO DE LANCE. E a revenda não é pela FIPE cheia: veículo de
// leilão, com km alta, de frota ou sinistrado vende abaixo dela — o deságio abaixo é uma régua FIXA
// e explicável (cada item aparece no relatório), não um número da IA.
// Usado pela tela (src/pages/AnaliseVeiculo.jsx) e pelo PDF do relatório.

export const TETO_FIPE = 0.65;
export const COMISSAO_PADRAO_PCT = 5; // praxe de leilão (edital costuma fixar 5%); o relatório diz quando é presumida

export function desagioFipe(v, anoAtual = new Date().getFullYear()) {
  const fatores = [{ motivo: 'Liquidez de veículo de leilão (histórico de leilão reduz o preço de revenda)', pct: 10 }];
  const ano = Number(v?.ano_modelo || v?.ano_fabricacao) || null;
  const km = Number(v?.km) || 0;
  if (ano && km > 0) {
    const esperado = 15000 * Math.max(0.5, anoAtual - ano + 0.5);
    const r = km / esperado;
    if (r > 4) fatores.push({ motivo: `Quilometragem muito acima do esperado (${km.toLocaleString('pt-BR')} km; ~${Math.round(esperado).toLocaleString('pt-BR')} km para a idade)`, pct: 15 });
    else if (r > 2.5) fatores.push({ motivo: `Quilometragem bem acima do esperado (${km.toLocaleString('pt-BR')} km; ~${Math.round(esperado).toLocaleString('pt-BR')} km para a idade)`, pct: 12 });
    else if (r > 1.5) fatores.push({ motivo: `Quilometragem acima do esperado (${km.toLocaleString('pt-BR')} km)`, pct: 7 });
  }
  if (['orgao_publico', 'corporativo'].includes(v?.origem_venda)) fatores.push({ motivo: 'Uso de frota (órgão público/empresa) — desgaste acima da média', pct: 5 });
  if (v?.origem_venda === 'patio') fatores.push({ motivo: 'Veículo de pátio (apreendido/removido)', pct: 5 });
  const sin = String(v?.sinistro || '').toLowerCase();
  if (/grande/.test(sin)) fatores.push({ motivo: 'Sinistro de grande monta', pct: 35 });
  else if (/m[eé]dia/.test(sin)) fatores.push({ motivo: 'Sinistro de média monta', pct: 20 });
  else if (/pequena/.test(sin)) fatores.push({ motivo: 'Sinistro de pequena monta', pct: 10 });
  if (['nao_funciona', 'avariado'].includes(v?.motor_status) || v?.motor_alerta) fatores.push({ motivo: 'Motor com dano declarado', pct: 20 });
  if (v?.is_sucata) fatores.push({ motivo: 'Sucata — só certificado de baixa, não volta a circular', pct: 60 });
  const pct = Math.min(60, fatores.reduce((s, f) => s + f.pct, 0));
  return { pct, fatores };
}

export function calcularViabilidade({ fipe, lanceMinimo, comissaoPct, despesas = [], desagioPct = 0, revendaMercado = null }) {
  const F = Number(fipe) || 0;
  const L = Number(lanceMinimo) || 0;
  if (!(F > 0) || !(L > 0)) return null;
  const c = (Number(comissaoPct) > 0 ? Number(comissaoPct) : COMISSAO_PADRAO_PCT) / 100;
  const itens = (despesas || []).filter((d) => Number(d?.valor) > 0);
  const despesasTotal = itens.reduce((s, d) => s + Number(d.valor), 0);
  const r2 = (x) => Math.round(x * 100) / 100;
  const tetoAquisicao = r2(F * TETO_FIPE);
  const tetoLance = r2(Math.max(0, (tetoAquisicao - despesasTotal) / (1 + c)));
  const investimentoNoMinimo = r2(L * (1 + c) + despesasTotal);
  // Revenda: anúncios reais (média dos 5 mais baratos − 10%) quando houver; senão a régua sobre a FIPE.
  const fipeRealista = Number(revendaMercado) > 0 ? r2(Number(revendaMercado)) : r2(F * (1 - desagioPct / 100));
  return {
    comissaoPct: c * 100, comissaoPresumida: !(Number(comissaoPct) > 0),
    despesas: itens, despesasTotal: r2(despesasTotal),
    tetoAquisicao, tetoLance, investimentoNoMinimo,
    investimentoNoTeto: tetoAquisicao,
    fipeRealista, desagioPct, revendaPorMercado: Number(revendaMercado) > 0,
    lucroNoMinimo: r2(fipeRealista - investimentoNoMinimo),
    lucroNoTeto: r2(fipeRealista - tetoAquisicao),
    fechaNaRegra: L <= tetoLance,
    pctInvestimentoFipe: (investimentoNoMinimo / F) * 100,
  };
}

// AQUISIÇÃO PARCELADA (29/09, pedido do dono): "considerar o sinal e informar quantas parcelas e o
// valor a suportar". Sinal = entrada sobre o lance + comissão do leiloeiro + débitos assumidos (é o
// que sai do bolso no ato — a comissão e os débitos não se parcelam no leilão). O saldo do lance
// divide-se nas parcelas SEM correção: o índice (quando o edital informa) vai escrito ao lado.
// O teto de 65% da FIPE não muda por ser parcelado — é sobre o custo total da aquisição.
export function planoParcelado({ lance, comissaoPct, despesasTotal = 0, entradaPct, parcelas }) {
  const L = Number(lance) || 0, e = Number(entradaPct) / 100, n = Math.round(Number(parcelas));
  if (!(L > 0) || !(e > 0 && e < 1) || !(n >= 2)) return null;
  const c = (Number(comissaoPct) > 0 ? Number(comissaoPct) : COMISSAO_PADRAO_PCT) / 100;
  const r2 = (x) => Math.round(x * 100) / 100;
  const entradaLance = r2(L * e);
  return {
    entradaLance, comissao: r2(L * c), despesas: r2(despesasTotal),
    sinal: r2(entradaLance + L * c + (Number(despesasTotal) || 0)),
    saldo: r2(L - entradaLance), parcelas: n, valorParcela: r2((L - entradaLance) / n),
  };
}

// REVENDA PELO MERCADO (29/09, pedido do dono): "média dos 5 anúncios mais em conta da Webmotors,
// 10% abaixo, como valor sugerido". Substitui a régua de deságio sobre a FIPE quando há anúncios
// suficientes; a régua continua como reserva (e o relatório diz qual das duas valeu).
// Sanidade: preço fora de 30%–200% da FIPE é outro veículo (peça, sucata, versão de outra faixa) e
// sai da conta ANTES de escolher os 5 — senão o "mais barato" seria sempre o anúncio errado.
export const REVENDA_DESCONTO_PCT = 10;
export const REVENDA_MIN_ANUNCIOS = 3;
export function revendaPorAnuncios(anuncios, fipe) {
  const F = Number(fipe) || 0;
  const validos = (Array.isArray(anuncios) ? anuncios : [])
    // Link vem da resposta da IA e vira href: só http(s) (um "javascript:" ali seria XSS).
    .map((a) => ({
      preco: Math.round(Number(a?.preco) || 0),
      titulo: String(a?.titulo || '').slice(0, 120), ano: Number(a?.ano) || null, km: Number(a?.km) || null,
      local: String(a?.local || '').slice(0, 60), portal: String(a?.portal || '').slice(0, 20).toLowerCase(),
      url: /^https?:\/\//i.test(String(a?.url || '')) ? String(a.url).slice(0, 500) : null,
    }))
    .filter((a) => a.preco > 0 && (!(F > 0) || (a.preco >= F * 0.3 && a.preco <= F * 2)));
  const unicos = [...new Map(validos.map((a) => [a.url || `${a.preco}|${a.titulo}`, a])).values()];
  if (unicos.length < REVENDA_MIN_ANUNCIOS) return null;
  const cinco = unicos.sort((a, b) => a.preco - b.preco).slice(0, 5);
  const media = cinco.reduce((s, a) => s + a.preco, 0) / cinco.length;
  const r2 = (x) => Math.round(x * 100) / 100;
  return {
    media: r2(media), valor: r2(media * (1 - REVENDA_DESCONTO_PCT / 100)), descontoPct: REVENDA_DESCONTO_PCT,
    anuncios: cinco, descartados: (Array.isArray(anuncios) ? anuncios.length : 0) - validos.length,
  };
}
