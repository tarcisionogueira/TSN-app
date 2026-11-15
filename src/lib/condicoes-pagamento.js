// CONDIÇÕES DE PAGAMENTO DO EDITAL NA PROJEÇÃO — uma regra só para o servidor e para a tela (03/11).
//
// Caso Peruíbe (análise 57573ba9): o edital foi lido ("sinal de 25% e saldo em até 10 parcelas mensais,
// mínimo de R$ 5.000,00 por parcela") e `regrasPagamento` gravou parcelas=10 e sinalPct=25. Mesmo assim a
// projeção saiu com 30 parcelas de R$ 2.400 e o rodapé dizia "NÃO confirmadas no edital". Dois caminhos
// perdiam o edital pela mesma razão: só aceitavam o número dele quando o campo ainda estava no default
// BANCÁRIO (5% / 360 meses) — e o lote judicial já nasce com o piso do art. 895 (25% / 30 meses), que
// eles confundiam com "o cliente editou". No servidor, o recálculo de ROE e teto nem consultava o edital.
//
// Regra: edital legível tem prioridade sobre o padrão legal e sobre o default do sistema. Só o que o
// CLIENTE digitou (origem 'cliente') fica. Edital que permite parcelar mas não diz em quantas vezes, ou
// cuja parcela mínima não fecha com o saldo, vira 'edital_incompleto' — o rodapé diz o que faltou e a
// projeção não é apresentada como confirmada.

// Defaults que NÃO são escolha de ninguém: o financiamento bancário do formulário vazio e o piso do
// art. 895 que a tela semeia em lote judicial.
const DEFAULTS = [
  { sinalPercentual: 5, prazoMeses: 360 },
  { sinalPercentual: 25, prazoMeses: 30 },
];

const numBr = (s) => {
  const t = String(s || '').replace(/\s/g, '');
  if (!t) return 0;
  const n = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/\./g, '');
  return Number(n) || 0;
};

// "mínimo de R$ 5.000,00 por parcela", "parcela mínima de R$ 5.000", "parcelas mínimas de R$ 5 mil"
export function parcelaMinimaDoTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  const m = t.match(/m[íi]nim[oa]\s+de\s+R\$\s*([\d.]+(?:,\d{1,2})?)\s*(mil)?\s*(?:por|cada|para\s+cada)\s+parcela/i)
    || t.match(/parcelas?\s+m[íi]nimas?\s+(?:de\s+)?R\$\s*([\d.]+(?:,\d{1,2})?)\s*(mil)?/i);
  if (!m) return null;
  const v = numBr(m[1]) * (m[2] ? 1000 : 1);
  return v >= 100 && v <= 10000000 ? v : null;
}

/**
 * O que o edital AFIRMA sobre o parcelamento, normalizado. `null` quando não há nada legível.
 * `rp` = `condicoesEdital.regrasPagamento`; `texto` = `condicoesEdital.formaPagamento` (cláusula crua).
 */
export function condicoesDoEdital(rp, texto) {
  if (!rp && !texto) return null;
  const parcelas = Number(rp?.parcelas) > 0 ? Number(rp.parcelas) : null;
  const sinalPct = Number(rp?.sinalPct) > 0 ? Number(rp.sinalPct) : null;
  const parcelaMinima = Number(rp?.parcelaMinima) > 0 ? Number(rp.parcelaMinima) : parcelaMinimaDoTexto(texto);
  const permite = rp?.parcelamentoPermitido === true || parcelas != null;
  const veda = rp?.parcelamentoPermitido === false;
  if (!permite && !veda && !sinalPct) return null;
  return { parcelas, sinalPct, parcelaMinima, permite, veda };
}

/**
 * Patch a aplicar sobre os inputs da viabilidade (`d` da tela / `pInp` do servidor), ou `null`.
 * `faltando` explica, em palavras, o que o edital não disse — vai para o rodapé.
 */
export function aplicarCondicoesEdital(d, rp, texto, { regrasOrigem = '' } = {}) {
  const ce = condicoesDoEdital(rp, texto);
  // 15/11 (arena — classe Brooklin): regra que veio do ANÚNCIO, do DOCUMENTAL (IA) ou do PADRÃO DO LEILOEIRO saía com
  // origem 'edital' e o rodapé dizia "LIDAS NO EDITAL". Agora carrega o nome de onde veio — e, não sendo 'edital' nem
  // 'cliente', `pagamentoNaoConfirmado` acende o aviso no cartão.
  const origemExterna = regrasOrigem && regrasOrigem !== 'edital' ? `premissa_${String(regrasOrigem).replace(/[^a-z_+]/gi, '')}` : '';
  if (!ce) return null;
  const origem = String(d?.origemCondicoesPagamento || '');
  if (origem === 'cliente') return null;
  if (ce.veda) return d?.somenteAVista && origem === 'edital_veda' ? null : { somenteAVista: true, origemCondicoesPagamento: origemExterna || 'edital_veda', faltando: [] };

  const sinalAtual = Number(d?.sinalPercentual) || 0, prazoAtual = Number(d?.prazoMeses) || 0;
  if (origem === 'edital' || (origemExterna && origem === origemExterna)) return null; // já aplicado
  // Sem marcador de origem e com números fora dos defaults = alguém digitou: respeita.
  const ehDefault = origem === 'padrao_legal' || origem === 'edital_incompleto' || origem.startsWith('premissa_')
    || DEFAULTS.some(x => x.sinalPercentual === sinalAtual && x.prazoMeses === prazoAtual);
  if (!ehDefault) return null;

  const sinal = ce.sinalPct ?? sinalAtual;
  let prazo = ce.parcelas ?? prazoAtual;
  const faltando = [];
  if (!ce.sinalPct) faltando.push('o percentual de entrada');
  if (!ce.parcelas) faltando.push('o número de parcelas');
  // FINANCIAMENTO ≠ PARCELAMENTO DO LEILÃO (achado na varredura de 03/11: Carapicuíba, "240×"). Saldo de leilão é
  // corrigido por índice e curto; 240 vezes é crédito bancário, com juros que o edital não informa. Juros zero ali
  // daria uma parcela irreal — mantém a taxa do sistema e marca a condição como não confirmada.
  const financiamento = (ce.parcelas || 0) > 60 || rp?.financiavel === true;
  if (financiamento) faltando.push('a taxa de juros do financiamento');
  // Parcela mínima: o saldo dividido não pode ficar abaixo dela — menos parcelas, não parcela menor.
  const lance = Number(d?.valorArrematacao) || 0;
  let parcelaMinimaAplicada = false;
  if (ce.parcelaMinima && lance > 0 && prazo > 0) {
    const saldo = lance * (1 - sinal / 100);
    const maxParcelas = Math.max(1, Math.floor(saldo / ce.parcelaMinima));
    if (prazo > maxParcelas) { prazo = maxParcelas; parcelaMinimaAplicada = true; }
  }
  return {
    somenteAVista: false,
    sinalPercentual: sinal,
    prazoMeses: prazo,
    // O parcelamento de leilão é saldo corrigido (IPCA etc.), não financiamento com juros: 0% real.
    cetAnual: financiamento ? (Number(d?.cetAnual) > 0 ? Number(d.cetAnual) : 12) : 0,
    origemCondicoesPagamento: origemExterna || (faltando.length ? 'edital_incompleto' : 'edital'),
    parcelaMinimaEdital: ce.parcelaMinima || 0,
    parcelaMinimaAplicada,
    faltando,
  };
}

// AVISO NO CARTÃO, NÃO SÓ NO RODAPÉ (15/11, dono: "esse tipo de erro não pode ocorrer"). O apto do Brooklin (MEGA
// X131536) exigia o preço TODO em 24 h e o relatório mostrou "Sinal (5%)" e "Parcela do banco ~R$ 9.051" nos cartões
// principais; o "NÃO confirmadas" existia só na nota metodológica, no fim. Parcelado cuja condição não veio do EDITAL
// nem do CLIENTE é premissa do sistema — e o cartão precisa dizer isso onde o número aparece.
export const AVISO_PAGAMENTO_NAO_CONFIRMADO = 'Entrada e parcelas NÃO confirmadas no edital (premissa do sistema). O edital pode exigir pagamento à vista — confirme antes do lance.';
export function pagamentoNaoConfirmado(d, isAVista) {
  if (isAVista || d?.somenteAVista) return false;
  return !['edital', 'cliente'].includes(String(d?.origemCondicoesPagamento || ''));
}
