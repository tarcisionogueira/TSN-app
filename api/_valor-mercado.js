/**
 * PREÇO DO M² PONDERADO POR PROXIMIDADE — cálculo DETERMINÍSTICO.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE (13/08, pedido do dono) ──────────────────────────────────
 * O relatório mercadológico não CALCULAVA o preço do m²: ele PEDIA o número à IA.
 * `consolidado.valorEstimadoImovel` era um campo do JSON que o modelo preenchia seguindo uma
 * instrução em texto, e a única menção a peso no prompt inteiro era um "dê peso menor" para
 * amostras além de 1 km. A regra que o dono descreve — quanto mais perto, maior a influência
 * sobre o preço — não existia em lugar nenhum.
 *
 * O que isso produziu, medido no acervo de Guarulhos em 13/08: a MESMA microrregião precificada
 * entre R$ 4.209 e R$ 7.248/m² dependendo de qual análise se abrisse (72% de amplitude), com o
 * nível 1 (mais perto) saindo MAIS BARATO que o nível 2 em 4 de 8 análises — assinatura de
 * ruído, não de sinal.
 *
 * Agora a IA faz o que ela faz bem (achar e descrever os anúncios) e a CONTA é código: mesma
 * entrada, mesmo número, com a fórmula impressa no `baseCalculo` para o cliente auditar.
 *
 * ─── OS TRÊS DEFEITOS QUE ESTE MÓDULO FECHA ──────────────────────────────────────────────
 * 1. O PRÓPRIO LOTE ENTRAVA COMO COMPARÁVEL DE MERCADO. Caso `bc8a88cf` (Av. José Brumatti,
 *    2856, Guarulhos): a amostra nº 1 do nível 1 era `fonte: "Imóveis de Leilão Caixa"`,
 *    endereço idêntico ao do lote, `valor: 94.815,14` — exatamente o `valor_minimo` do leilão —
 *    a R$ 2.280/m², metade dos anúncios reais em volta. O lance mínimo ancorava para baixo a
 *    avaliação que existe justamente para julgar se esse lance é bom. 6 das 54 análises do
 *    acervo (11%) tinham essa contaminação.
 * 2. AMOSTRA SEM PREÇO CONTAVA COMO AMOSTRA. Um anúncio com `valor: null` e `valorM2: null`
 *    entrava no `totalAmostras`: o cliente lia "nível 1: 2 amostras" quando havia UMA com
 *    preço, e a "média" era um anúncio só.
 * 3. O TETO DE DISTÂNCIA NÃO ERA VERIFICADO. 16% das amostras de nível 1 com distância
 *    preenchida estavam além dos 250 m declarados, e 52 amostras de nível 2 passavam de 1 km,
 *    apesar de o prompt chamar isso de "REGRA DURA — não negocie". Prompt não é trava.
 *
 * ─── A DISTÂNCIA FALTA NA MAIORIA DAS AMOSTRAS ───────────────────────────────────────────
 * 74% das amostras de nível 1 e 68% das de nível 2 vêm SEM `distanciaKm` (a IA não estima
 * sempre). Descartá-las jogaria fora quase todo o acervo; tratá-las como distância 0 daria a
 * elas o peso MÁXIMO, que é o erro oposto e o mais perigoso. A saída é o teto do próprio
 * nível: sem distância, a amostra recebe a distância NOMINAL da sua faixa (nível 1 → 250 m,
 * nível 2 → 1 km). É o pior caso admissível dentro da faixa em que ela foi classificada, então
 * a estimativa erra para o conservador, nunca para o otimista.
 */

// Peso por proximidade: 1/(1 + d/250m). Contínuo, sem degrau — um anúncio a 249 m não pode
// valer 3× um a 251 m só porque caiu do outro lado de uma linha.
//   0 m → 1,00 · 250 m → 0,50 · 500 m → 0,33 · 1 km → 0,20 · 2 km → 0,11
export const ESCALA_KM = 0.25;
export function pesoProximidade(distKm) {
  const d = Number(distKm);
  if (!Number.isFinite(d) || d < 0) return null;
  return 1 / (1 + d / ESCALA_KM);
}

// Peso por recência, no MESMO formato que o Índice já usa (`indice_regiao_ponderado`):
// 1/(1 + idade_em_anos). Hoje ≈ 1,00 · 1 ano ≈ 0,50 · 2 anos ≈ 0,33. Nunca zero: uma amostra
// antiga pesa pouco, mas não é descartada — descartar reduziria a base já escassa.
// "recente" e data ausente valem 6 meses (0,67), não zero anos: presumir que um anúncio sem
// data é de hoje seria dar a ele o peso de um dado que não temos.
export function pesoRecencia(data) {
  const s = String(data || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})$/);
  if (!m) return 1 / (1 + 0.5);
  const anos = (Date.now() - Date.UTC(Number(m[1]), Number(m[2]) - 1, 15)) / (365.25 * 86400000);
  return 1 / (1 + Math.max(0, anos));
}

// Fonte que é LEILÃO não é comparável de mercado — é o mesmo mercado que estamos avaliando.
const FONTE_LEILAO = /leil[aã]o|leiloeir|hasta p[uú]blica|pra[cç]a p[uú]blica|preg[aã]o/i;

/**
 * A amostra é o PRÓPRIO imóvel (ou o leilão dele) disfarçado de anúncio de mercado?
 * Duas assinaturas, qualquer uma basta:
 *   (a) a FONTE é um leilão — leilão nunca é comparável de mercado aberto, seja de qual
 *       imóvel for: é o mesmo mercado com desconto que estamos tentando medir;
 *   (b) o VALOR bate, ao centavo, com o lance mínimo ou a avaliação do próprio lote.
 *
 * O ENDEREÇO deliberadamente NÃO entra como critério de descarte. Um anúncio real no mesmo
 * prédio é o comparável mais valioso que existe — descartá-lo por coincidência de endereço
 * jogaria fora justamente o melhor dado. Quem denuncia a auto-referência é o valor idêntico
 * ao centavo, que não acontece por acaso.
 */
export function ehAutoReferencia(amostra, lote) {
  if (!amostra) return false;
  if (FONTE_LEILAO.test(String(amostra.fonte || ''))) return true;
  const v = Number(amostra.valor);
  if (!Number.isFinite(v) || v <= 0) return false;
  const vmin = Number(lote?.valorMinimo), vaval = Number(lote?.valorAvaliacao);
  return (Number.isFinite(vmin) && vmin > 0 && Math.abs(v - vmin) < 1)
      || (Number.isFinite(vaval) && vaval > 0 && Math.abs(v - vaval) < 1);
}

export const TETO_KM = { 1: 0.25, 2: 1.0, ampliado: 2.0 };

/**
 * Prepara as amostras de um nível: descarta o que não é comparável e resolve a distância.
 * Devolve `{ usadas, descartadas }` — `descartadas` traz o MOTIVO, porque um descarte
 * silencioso é a mesma família de defeito que este módulo veio corrigir.
 */
// Piso absoluto de R$/m² para VENDA. Nenhuma venda no Brasil sai a R$ 300/m²; um número
// abaixo disso é quase sempre um ALUGUEL classificado como venda. Achado real (13/08, análise
// `ea0f6aa9`): `valor: 3.200` em 40 m² = R$ 80/m² — o aluguel mensal entrou na lista de vendas
// e puxou a média. Teto de R$ 60.000/m² fecha o outro lado (nenhum m² residencial brasileiro
// chega lá; acima disso é erro de leitura, não imóvel de luxo).
const M2_PISO = 300, M2_TETO = 60000;

export function prepararAmostras(vendas, { nivel, lote, tetoKm } = {}) {
  const teto = Number(tetoKm) || TETO_KM[nivel] || TETO_KM[2];
  const nominal = TETO_KM[nivel] || TETO_KM[2];
  const usadas = [], descartadas = [];
  for (const a of (Array.isArray(vendas) ? vendas : [])) {
    if (!a || typeof a !== 'object') continue;
    const valor = Number(a.valor), m2 = Number(a.m2);
    let valorM2 = Number(a.valorM2);
    if (!Number.isFinite(valorM2) || valorM2 <= 0) {
      valorM2 = (Number.isFinite(valor) && valor > 0 && Number.isFinite(m2) && m2 > 0) ? valor / m2 : NaN;
    }
    // (2) Sem preço não é amostra. Sai da conta E da contagem exibida.
    if (!Number.isFinite(valorM2) || valorM2 <= 0) { descartadas.push({ ...a, _motivo: 'sem_preco' }); continue; }
    // (4) Fora de qualquer faixa plausível de VENDA → é aluguel ou erro de leitura.
    if (valorM2 < M2_PISO || valorM2 > M2_TETO) { descartadas.push({ ...a, _motivo: 'nao_e_venda', _valorM2: valorM2 }); continue; }
    // (1) O próprio lote / o próprio leilão.
    if (ehAutoReferencia(a, lote)) { descartadas.push({ ...a, _motivo: 'auto_referencia' }); continue; }
    // Distância: a declarada, ou o teto NOMINAL do nível (ver cabeçalho).
    const dDecl = Number(a.distanciaKm);
    const temDist = Number.isFinite(dDecl) && dDecl >= 0;
    const dist = temDist ? dDecl : nominal;
    // (3) Teto de distância — agora verificado, não só pedido no prompt.
    if (dist > teto + 1e-9) { descartadas.push({ ...a, _motivo: 'fora_do_raio', _distUsada: dist }); continue; }
    usadas.push({ ...a, _valorM2: valorM2, _dist: dist, _distEstimada: !temDist });
  }
  return { usadas, descartadas };
}

/**
 * OUTLIER RELATIVO — descarta o que está fora de [mediana/2,5 ; mediana×2,5].
 *
 * O teto de distância já barra a maior parte da contaminação de outra praça, mas não toda:
 * um bairro nobre pode estar a 900 m e ainda ser outro mercado. Na análise `ea0f6aa9` o nível
 * 2 trazia R$ 13.816/m² e R$ 13.750/m² (Picanço e Jd. Flor da Montanha) ao lado de anúncios a
 * R$ 4.500/m² — e a média saiu em R$ 7.248/m², acima de QUALQUER amostra representativa.
 *
 * A mediana é a âncora certa aqui justamente porque ela não se move com o outlier que estamos
 * tentando achar (a média, sim — seria circular). Só roda com 4+ amostras: com 3 ou menos, a
 * mediana não é confiável e o filtro poderia jogar fora o dado bom.
 */
export function descartarOutliers(usadas, { fator = 2.5, minParaFiltrar = 4 } = {}) {
  const xs = (usadas || []).filter(a => Number.isFinite(a?._valorM2));
  if (xs.length < minParaFiltrar) return { usadas: xs, descartadas: [] };
  const vals = xs.map(a => a._valorM2).sort((x, y) => x - y);
  const mid = Math.floor(vals.length / 2);
  const mediana = vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
  if (!(mediana > 0)) return { usadas: xs, descartadas: [] };
  const piso = mediana / fator, tetoV = mediana * fator;
  const ok = [], fora = [];
  for (const a of xs) {
    if (a._valorM2 >= piso && a._valorM2 <= tetoV) ok.push(a);
    else fora.push({ ...a, _motivo: 'outlier', _mediana: Math.round(mediana) });
  }
  return { usadas: ok, descartadas: fora };
}

/**
 * Média PONDERADA do R$/m² sobre amostras já preparadas.
 * Peso final = proximidade × recência. Devolve também min/max e a soma dos pesos, que é o que
 * permite fundir os dois níveis depois sem recontar nada.
 */
export function precoM2Ponderado(usadas) {
  const xs = (usadas || []).filter(a => Number.isFinite(a?._valorM2) && a._valorM2 > 0);
  if (!xs.length) return { precoMedioM2: 0, precoMinM2: 0, precoMaxM2: 0, n: 0, somaPesos: 0 };
  let sp = 0, svp = 0;
  for (const a of xs) {
    const p = (pesoProximidade(a._dist) ?? 0) * pesoRecencia(a.data);
    sp += p; svp += p * a._valorM2;
  }
  const vals = xs.map(a => a._valorM2).sort((x, y) => x - y);
  return {
    precoMedioM2: sp > 0 ? Math.round((svp / sp) * 100) / 100 : 0,
    precoMinM2: Math.round(vals[0] * 100) / 100,
    precoMaxM2: Math.round(vals[vals.length - 1] * 100) / 100,
    n: xs.length, somaPesos: sp,
  };
}

/**
 * O número da capa: R$/m² da REGIÃO, fundindo os dois níveis pelos pesos já calculados.
 * Não é a média das duas médias — é a média ponderada de TODAS as amostras, que é o que faz
 * um nível 1 com 2 amostras não empatar com um nível 2 com 20.
 *
 * `minAmostras` (padrão 10, decisão do dono em 13/08 — era 5) é o gatilho de ampliação para
 * 2 km: abaixo disso a base é fina demais e o chamador deve alargar o raio. Devolvemos
 * `precisaAmpliar` em vez de decidir aqui, porque quem tem como buscar mais é o chamador.
 */
export function consolidarM2({ nivel1 = [], nivel2 = [], lote = null, ampliado = false, minAmostras = 10 } = {}) {
  const teto1 = ampliado ? TETO_KM.ampliado : TETO_KM[1];
  const teto2 = ampliado ? TETO_KM.ampliado : TETO_KM[2];
  const p1 = prepararAmostras(nivel1, { nivel: 1, lote, tetoKm: teto1 });
  const p2 = prepararAmostras(nivel2, { nivel: 2, lote, tetoKm: teto2 });
  // O outlier é avaliado sobre o CONJUNTO, não por nível: um nível com 2 amostras não tem
  // mediana confiável, e é justamente o nível pequeno que mais sofre com um comparável de
  // outra praça. Depois de filtrado, cada amostra volta para o seu nível de origem.
  const marcados = [...p1.usadas.map(a => ({ ...a, _nivel: 1 })), ...p2.usadas.map(a => ({ ...a, _nivel: 2 }))];
  const semOutlier = descartarOutliers(marcados);
  const u1 = semOutlier.usadas.filter(a => a._nivel === 1);
  const u2 = semOutlier.usadas.filter(a => a._nivel === 2);
  const a1 = precoM2Ponderado(u1);
  const a2 = precoM2Ponderado(u2);
  const geral = precoM2Ponderado(semOutlier.usadas);
  const descartadas = [...p1.descartadas, ...p2.descartadas, ...semOutlier.descartadas];
  return {
    nivel1: { ...a1, usadas: u1, descartadas: p1.descartadas },
    nivel2: { ...a2, usadas: u2, descartadas: p2.descartadas },
    consolidado: geral,
    precisaAmpliar: geral.n < minAmostras && !ampliado,
    descartadas,
  };
}

/**
 * PONTO DE ENTRADA — duas passadas, exatamente a regra do dono (13/08):
 *   1ª: níveis estritos (nível 1 ≤ 250 m, nível 2 ≤ 1 km).
 *   2ª: se sobrarem MENOS de 10 amostras válidas, amplia o teto para 2 km e reaproveita as
 *       que tinham sido descartadas por distância — SEM nova busca (custo zero de IA: os
 *       anúncios já vieram na mesma resposta, só estavam fora do corte).
 *
 * Acima de 2 km nada volta, em nenhuma hipótese: é outra praça, e foi assim que uma análise
 * de Guarulhos acabou com comparáveis de bairros a 6 e 7 km, a R$ 13.800/m², inflando a média
 * para R$ 7.248/m² — acima de QUALQUER amostra representativa da vizinhança real.
 *
 * `ampliado` volta no retorno para o relatório poder DIZER que ampliou, que é o que a regra
 * escrita já exigia ("escreva no comentário, com todas as letras").
 */
export function avaliarMercado({ nivel1 = [], nivel2 = [], lote = null, minAmostras = 10 } = {}) {
  const estrito = consolidarM2({ nivel1, nivel2, lote, ampliado: false, minAmostras });
  if (!estrito.precisaAmpliar) return { ...estrito, ampliado: false, minAmostras };
  const amplo = consolidarM2({ nivel1, nivel2, lote, ampliado: true, minAmostras });
  // Só aceita a ampliação se ela REALMENTE trouxe amostra; senão devolve o estrito, para não
  // rotular como "raio ampliado" uma análise que continuou com a mesma base.
  if (amplo.consolidado.n > estrito.consolidado.n) {
    return { ...amplo, ampliado: true, minAmostras, baseFina: amplo.consolidado.n < minAmostras };
  }
  return { ...estrito, ampliado: false, minAmostras, baseFina: true };
}

/** Texto da conta, para o `baseCalculo` — o cliente tem que conseguir refazer no papel. */
export function explicarCalculo({ precoM2, area, unidade = 'm² privativo', n, descartadas = [] }) {
  const brl = (x) => Number(x || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const porMotivo = descartadas.reduce((acc, d) => { acc[d._motivo] = (acc[d._motivo] || 0) + 1; return acc; }, {});
  const notas = [];
  if (porMotivo.auto_referencia) notas.push(`${porMotivo.auto_referencia} por ser o próprio lote/leilão`);
  if (porMotivo.sem_preco) notas.push(`${porMotivo.sem_preco} sem preço publicado`);
  if (porMotivo.fora_do_raio) notas.push(`${porMotivo.fora_do_raio} fora do raio`);
  if (porMotivo.nao_e_venda) notas.push(`${porMotivo.nao_e_venda} fora da faixa de venda (provável aluguel)`);
  if (porMotivo.outlier) notas.push(`${porMotivo.outlier} discrepante da mediana da região`);
  return `R$ ${brl(precoM2)}/${unidade} × ${brl(area)} ${unidade.startsWith('m²') ? 'm²' : ''}`
    + ` = R$ ${brl(precoM2 * area)}. Média de ${n} anúncio(s), ponderada por proximidade`
    + ` (peso 1/(1+d/250m): 0m=1,00 · 250m=0,50 · 1km=0,20) e por recência.`
    + (notas.length ? ` Excluídas: ${notas.join('; ')}.` : '');
}
