/**
 * AUDITORIA DE COERÊNCIA — a última etapa antes de liberar um relatório (pedido do dono,
 * 15/08: "uma inspeção de cada campo, quadro, texto e indicador, cruzando as informações,
 * para evitar liberar um relatório com informação errada ou faltando").
 *
 * POR QUE ELA PRECISA EXISTIR. Todo defeito que chegou ao cliente neste projeto tinha a
 * mesma assinatura: cada peça, isolada, parecia certa. O que denunciava era o CRUZAMENTO —
 * e ninguém cruzava. Três casos reais, todos de agosto:
 *   • "Aluguel médio R$ 0,00/mês" no resumo e "R$ 37,25/m²/mês, 20 amostras" no Índice, no
 *     mesmo relatório, duas seções abaixo;
 *   • área de 396 m² no cálculo do mercado e 234,6 m² na matrícula do mesmo lote;
 *   • rentabilidade gravada como razão (0,09) onde o certo era 9,32% a.a.
 * Nenhum aparece olhando um campo por vez. Todos aparecem comparando dois.
 *
 * O QUE ELA NÃO FAZ: bloquear a entrega. Um relatório retido é um cliente sem nada, tendo
 * gasto cota — troca um erro visível por um prejuízo invisível. O que ela faz é **declarar**:
 * o achado vai para `result.auditoria`, a tela mostra a ressalva no topo, e o que é
 * contraditório é SUPRIMIDO em vez de exibido errado. A regra do projeto aplicada a si
 * mesma: quando não dá para afirmar, não se afirma.
 *
 * Função PURA de propósito — nenhuma I/O. É o que permite rodá-la sobre os relatórios já
 * gravados (a revisão do acervo) sem tocar em nada.
 */

const n = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const perto = (a, b, tol) => (a === 0 && b === 0) || (Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-9) <= tol);

/**
 * @param {object} result  o `result` do relatório de mercado
 * @param {object} ctx     { temMatricula:boolean, areaAcervo:number, tipo:string }
 * @returns {{ok:boolean, criticos:Array, avisos:Array, faltando:Array, suprimir:string[]}}
 */
export function auditarMercadologico(result, ctx = {}) {
  const m = result?.mercado || {};
  const cons = m.consolidado || {};
  const idx = m.indiceBidPro || {};
  const fipe = m.referenciaFipeZap || {};
  const met = m.metodologia || {};
  const criticos = [], avisos = [], faltando = [];
  const suprimir = []; // campos que a tela NÃO deve exibir por estarem incoerentes

  const aluguel = n(m.aluguelMedio);
  const yieldB = n(m.yieldBruto);
  const precoM2 = n(m.precoMedioM2);
  // O DENOMINADOR DO YIELD É `consolidado.valorEstimadoImovel` — é ele que o servidor usa
  // em `aluguel×12÷valor`. `result.valorMercado` pode ter sido ANCORADO na avaliação (quando
  // a área é suspeita), então usá-lo aqui compararia a conta com um número que não a
  // originou. A primeira versão desta auditoria fez isso e acusou 13 relatórios de
  // "rentabilidade que não fecha" — o defeito era da regra, não deles.
  const vYield = n(cons.valorEstimadoImovel) || n(result?.valorMercado);
  const vMercado = n(result?.valorMercado) || n(cons.valorEstimadoImovel);
  const areaMet = n(met?.area?.valor);
  const areaCons = n(cons.areaConsiderada);
  const naoAluga = !!m.locacaoNaoSeAplica;

  // ── C1. Rentabilidade sem aluguel que a sustente ────────────────────────────────────
  // "Rentabilidade 6,5% a.a." com "Aluguel R$ 0,00" é o par mais enganoso possível: o
  // cliente lê o yield e decide. Um dos dois está errado; nenhum pode ser exibido sozinho.
  if (!naoAluga && yieldB > 0 && aluguel <= 0) {
    criticos.push({ chave: 'yield_sem_aluguel', msg: `Rentabilidade ${yieldB}% a.a. sem aluguel apurado — um dos dois está errado.` });
    suprimir.push('yieldBruto', 'yieldLiquido');
  }

  // ── C2. Rentabilidade que não fecha com o próprio aluguel ───────────────────────────
  if (!naoAluga && aluguel > 0 && vYield > 0 && yieldB > 0) {
    const esperado = (aluguel * 12 / vYield) * 100;
    if (!perto(yieldB, esperado, 0.20)) {
      criticos.push({ chave: 'yield_nao_fecha', msg: `Rentabilidade ${yieldB.toFixed(2)}% não fecha com aluguel×12÷valor (${esperado.toFixed(2)}%).` });
      suprimir.push('yieldBruto', 'yieldLiquido');
    }
  }

  // ── C3. Rentabilidade gravada como RAZÃO (falta ×100) ───────────────────────────────
  // Metade dos relatórios de 14/08 saiu assim. Aluguel real nunca rende 0,1% ao ano.
  if (!naoAluga && aluguel >= 300 && yieldB > 0.0001 && yieldB < 0.5) {
    criticos.push({ chave: 'yield_sem_x100', msg: `Rentabilidade ${yieldB} parece razão, não percentual (faltou ×100).` });
    suprimir.push('yieldBruto', 'yieldLiquido');
  }

  // ── C4. DUAS ÁREAS no mesmo relatório ───────────────────────────────────────────────
  // A área que a metodologia declara e a que o cálculo usou têm de ser a mesma. Divergir
  // aqui significa que o texto explica uma conta e o número mostra outra.
  if (areaMet > 0 && areaCons > 0 && !perto(areaMet, areaCons, 0.01)) {
    criticos.push({ chave: 'area_divergente_interna', msg: `Metodologia declara ${areaMet} m² e o cálculo usou ${areaCons} m².` });
  }

  // ── C5. O valor de mercado não fecha com preço/m² × área ────────────────────────────
  // Tolerância larga (30%): há margem conservadora de revenda e ancoragem na avaliação.
  // Só acusa quando a conta não se explica de jeito nenhum.
  if (precoM2 > 0 && areaCons > 0 && vMercado > 0 && cons.unidadeValor !== 'imovel' && !m.areaAlerta) {
    const bruto = precoM2 * areaCons;
    if (!perto(vMercado, bruto, 0.30) && !perto(vMercado, bruto * 0.9, 0.30)) {
      avisos.push({ chave: 'valor_nao_fecha_com_m2', msg: `Valor de mercado R$ ${Math.round(vMercado)} não se explica por R$ ${Math.round(precoM2)}/m² × ${areaCons} m².` });
    }
  }

  // ── A1. Aluguel ausente COM locação na base própria ─────────────────────────────────
  // A contradição que o dono viu: um quadro diz "não há" e o outro mostra o número.
  if (!naoAluga && aluguel <= 0 && n(idx.aluguel_m2) > 0) {
    avisos.push({ chave: 'aluguel_ausente_com_indice', msg: `Sem locação nos anúncios, mas o Índice BidPro tem R$ ${idx.aluguel_m2}/m²/mês (${n(idx.n_amostras)} amostras) — precisa estar declarado, não zerado.` });
  }

  // ── A2. Área não confirmada na matrícula, havendo matrícula ─────────────────────────
  if (met?.area?.fonte && met.area.fonte !== 'matricula' && ctx.temMatricula) {
    avisos.push({ chave: 'area_nao_confirmada', msg: `Área veio de "${met.area.fonte}" e há matrícula disponível não lida — todo o valor de mercado pendura nela.` });
  }

  // ── A3. Comparáveis incompatíveis com a área ────────────────────────────────────────
  if (m.areaAlerta) {
    avisos.push({ chave: 'area_incoerente_com_comparaveis', msg: `Comparáveis a R$ ${n(m.areaAlerta.compM2)}/m² contra R$ ${n(m.areaAlerta.avalM2)}/m² da avaliação — a área usada (${n(m.areaAlerta.areaUsada)} m²) provavelmente é a total/terreno.` });
  }

  // ── A4. Preço/m² brigando com AS DUAS referências ao mesmo tempo ────────────────────
  // Divergir de uma é normal (fontes diferentes). Das duas, na mesma direção, é sintoma.
  if (precoM2 > 0 && n(fipe.precoMedioM2) > 0 && n(idx.venda_m2) > 0) {
    const dF = (precoM2 - n(fipe.precoMedioM2)) / n(fipe.precoMedioM2);
    const dI = (precoM2 - n(idx.venda_m2)) / n(idx.venda_m2);
    if (Math.abs(dF) > 0.4 && Math.abs(dI) > 0.4 && Math.sign(dF) === Math.sign(dI)) {
      avisos.push({ chave: 'preco_m2_fora_das_referencias', msg: `R$ ${Math.round(precoM2)}/m² diverge ${Math.round(dF * 100)}% do FipeZAP e ${Math.round(dI * 100)}% do Índice BidPro.` });
    }
  }

  // ── A5. Base fina / sem amostras ────────────────────────────────────────────────────
  const nVendas = n(m.totalAmostrasVenda) || (Array.isArray(m.vendas) ? m.vendas.length : 0);
  if (nVendas === 0 && m.fonteEstimativa !== 'indice_bidpro') {
    avisos.push({ chave: 'sem_comparaveis', msg: 'Nenhum comparável de venda na amostra — o valor de mercado não tem base de anúncios.' });
  } else if (m.baseFina) {
    avisos.push({ chave: 'base_fina', msg: `Base fina (${nVendas} comparáveis) — margem de erro maior.` });
  }

  // ── FALTANDO: o que o relatório promete e não entregou ──────────────────────────────
  if (!String(result?.parecer || '').trim()) faltando.push({ chave: 'sem_parecer', msg: 'Relatório sem parecer escrito.' });
  if (vMercado <= 0) faltando.push({ chave: 'sem_valor_mercado', msg: 'Relatório sem valor de mercado estimado.' });
  if (precoM2 <= 0 && m.fonteEstimativa !== 'indice_bidpro') faltando.push({ chave: 'sem_preco_m2', msg: 'Relatório sem preço médio por m².' });

  return {
    ok: criticos.length === 0 && faltando.length === 0,
    criticos, avisos, faltando,
    suprimir: [...new Set(suprimir)],
    em: null, // carimbado pelo chamador (função pura não lê o relógio)
  };
}
