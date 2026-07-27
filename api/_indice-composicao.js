/**
 * Composição TEMPORAL do valor a partir da base própria (indice_amostra).
 *
 * Pedido do dono: em vez de tratar "amostra recente" como um corte binário, o valor deve
 * (1) separar os anúncios por PERÍODO (janelas de 4 meses), (2) mostrar o QUANTITATIVO total
 * encontrado, (3) usar o valor REAL quando há amostra recente e, quando NÃO há, PROJETAR os
 * anúncios antigos para "hoje" pela curva de valorização da PRÓPRIA região (Índice BidPro),
 * avisando que é projeção. Vale para o Índice e para o mercadológico — por isso a matemática
 * mora aqui (módulo puro, sem fetch: roda igual no Edge e no Node). Quem chama faz a leitura
 * das amostras e passa os arrays prontos.
 */

export const JANELA_DIAS = 120;         // "amostra recente" = últimos ~4 meses (o "de 120 dias" do dono)
export const BUCKET_MESES = 4;          // separação por período (a cada 4 meses)
export const MIN_RECENTES = 4;          // mínimo de amostras recentes p/ valor "cheio" sem projeção
const TAXA_MIN = -0.10, TAXA_MAX = 0.30; // sanidade da taxa a.a. (evita curva absurda projetar demais)
const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

export function medianaNum(arr) {
  const a = (arr || []).map(Number).filter(v => v > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
}

// 'YYYY-MM-...' → { idx (bucket de 4 meses), label 'mai–ago/2025', ano }.
function bucketDe(dref) {
  const m = String(dref || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2] - 1;
  if (mo < 0 || mo > 11) return null;
  const idx = Math.floor((y * 12 + mo) / BUCKET_MESES);
  const startAbs = idx * BUCKET_MESES;
  const sy = Math.floor(startAbs / 12), sm = startAbs % 12;
  const em = (sm + BUCKET_MESES - 1) % 12;
  return { idx, label: `${MES[sm]}–${MES[em]}/${sy}`, ano: sy };
}

// Meio do mês de referência em ms (dia 15) — para medir a idade da amostra.
function drefMs(dref) {
  const m = String(dref || '').match(/^(\d{4})-(\d{2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, 15) : 0;
}

// Taxa ANUAL composta (CAGR) a partir da mediana R$/m² por ano da própria região.
// Só com >= 2 anos com dado; clampada para sanidade. null = sem base p/ projetar.
export function taxaAnualDaCurva(amostrasAno) {
  const s = (amostrasAno || []).filter(p => Number(p.m2) > 0 && Number.isFinite(Number(p.ano))).sort((a, b) => a.ano - b.ano);
  if (s.length < 2) return null;
  const a0 = s[0], a1 = s[s.length - 1];
  const anos = a1.ano - a0.ano;
  if (anos <= 0 || !(a0.m2 > 0)) return null;
  let t = Math.pow(a1.m2 / a0.m2, 1 / anos) - 1;
  if (!Number.isFinite(t)) return null;
  return Math.max(TAXA_MIN, Math.min(TAXA_MAX, t));
}

/**
 * @param {Array<{valor_m2:number,data_ref:string}>} vendaSamples  amostras de VENDA (sem leilão) da região
 * @param {Array<{ano:number,m2:number}>} amostrasAno               mediana R$/m² por ano (curva) — p/ a taxa
 * @param {number} nowMs                                            Date.now() do chamador
 * @returns objeto de composição (valor recente OU projetado + períodos + quantitativo + avisos)
 */
export function composicaoTemporal(vendaSamples, amostrasAno, nowMs, banda) {
  const rows = (vendaSamples || [])
    .map(s => ({ m2: Number(s.valor_m2) || 0, dref: s.data_ref }))
    .filter(r => r.m2 > 0);
  const total = rows.length;
  if (!total) {
    return { total_anuncios: 0, n_recentes: 0, periodos: [], valor_m2: null, projetado: false, sem_amostras_recentes: true, taxa_aa: null, base_periodos: null };
  }

  // BANDA CENTRAL (p25–p75 de R$/m² da região). A cidade mistura PADRÕES (popular × alto) e a
  // mediana de um balde de 4 meses "virava" conforme o período pegou anúncios baratos ou de luxo
  // (ex.: Barueri set–dez/2025 despencava por pegar 9 populares × 5 altos). Com a banda, a mediana
  // de cada período (e o valor) olha só o PADRÃO CENTRAL → série comparável no tempo. O QUANTITATIVO
  // (n) segue mostrando TODOS os anúncios do período. Sem banda (chamador antigo) → comportamento igual.
  const inBand = (banda && banda.lo > 0 && banda.hi >= banda.lo) ? (v => v >= banda.lo && v <= banda.hi) : null;

  // Valor de referência do PADRÃO CENTRAL da região (mediana dos R$/m² na banda p25–p75). Serve
  // de FALLBACK COMPARÁVEL para um período sem amostra suficiente no padrão central — senão a
  // mediana CRUA daquele balde (ex.: só populares) fazia a série "cair pela metade e recuperar",
  // como o dono viu em Barueri set–dez/2025 (R$3.990 entre vizinhos de ~R$8.000).
  const centralVals = inBand ? rows.map(r => r.m2).filter(inBand) : rows.map(r => r.m2);
  const centralM2 = medianaNum(centralVals.length ? centralVals : rows.map(r => r.m2));

  // Períodos (buckets de 4 meses) — n = TODOS os anúncios do período (quantitativo honesto);
  // mediana = só os da banda central. Se o período NÃO tem ≥2 no padrão central, usa o valor
  // central da REGIÃO (comparável) e marca fora_padrao — nunca mostra a mediana crua de outliers.
  const byB = {};
  for (const r of rows) {
    const b = bucketDe(r.dref);
    if (!b) continue;
    (byB[b.idx] ||= { ...b, vals: [] }).vals.push(r.m2);
  }
  const periodos = Object.values(byB).sort((a, b) => a.idx - b.idx).map(b => {
    const inb = inBand ? b.vals.filter(inBand) : b.vals;
    const usaBucket = inb.length >= 2;
    return {
      label: b.label, ano: b.ano, n: b.vals.length,
      m2: usaBucket ? medianaNum(inb) : (centralM2 != null ? centralM2 : medianaNum(b.vals)),
      fora_padrao: !usaBucket && b.vals.length > 0,
    };
  });

  // Valor: também na banda central (fallback: todas as linhas se a banda esvaziar a região).
  const rowsVal = (() => { if (!inBand) return rows; const f = rows.filter(r => inBand(r.m2)); return f.length ? f : rows; })();
  // Amostras recentes (dentro da janela de 4 meses) — já na banda central.
  const corte = nowMs - JANELA_DIAS * 24 * 3600 * 1000;
  const recentes = rowsVal.filter(r => drefMs(r.dref) >= corte);
  const taxa = taxaAnualDaCurva(amostrasAno);

  let valor_m2, projetado = false, sem_recentes = false, base_periodos = null;
  if (recentes.length >= MIN_RECENTES) {
    // Tem amostra recente suficiente → valor REAL do momento.
    valor_m2 = medianaNum(recentes.map(r => r.m2));
  } else {
    sem_recentes = true;
    if (taxa != null) {
      // Sem recentes → PROJETA cada anúncio p/ hoje pela taxa a.a. da região e tira a mediana.
      const proj = rowsVal.map(r => {
        const anos = Math.max(0, Math.min(6, (nowMs - drefMs(r.dref)) / (365 * 24 * 3600 * 1000)));
        return r.m2 * Math.pow(1 + taxa, anos);
      });
      valor_m2 = medianaNum(proj);
      projetado = true;
      const anos = periodos.map(p => p.ano);
      base_periodos = anos.length ? (Math.min(...anos) === Math.max(...anos) ? `${anos[0]}` : `${Math.min(...anos)}–${Math.max(...anos)}`) : null;
    } else {
      // Sem curva confiável p/ projetar → mediana geral, SEM projeção (fica sinalizado como sem recentes).
      valor_m2 = medianaNum(rowsVal.map(r => r.m2));
    }
  }

  return {
    total_anuncios: total,
    n_recentes: recentes.length,
    periodos,
    valor_m2: valor_m2 != null ? Math.round(valor_m2) : null,
    projetado,
    sem_amostras_recentes: sem_recentes,
    taxa_aa: taxa != null ? Math.round(taxa * 1000) / 10 : null, // % a.a. (1 casa)
    base_periodos,
  };
}

// Mensagem curta e honesta p/ o usuário que gerou o relatório (Índice e mercadológico).
export function avisoFrescor(comp) {
  if (!comp || !comp.sem_amostras_recentes) return null;
  const base = `Não encontramos anúncios recentes (últimos ${BUCKET_MESES} meses) suficientes para compor o valor.`;
  if (comp.projetado && comp.taxa_aa != null) {
    return `${base} O valor exibido é uma PROJEÇÃO para hoje dos anúncios de ${comp.base_periodos || 'períodos anteriores'}, corrigidos pela valorização da região (Índice BidPro, ~${comp.taxa_aa}% a.a.).`;
  }
  return `${base} O valor exibido usa os anúncios disponíveis dos períodos anteriores, sem projeção (base insuficiente para estimar a correção). Recomenda-se atualizar com uma nova pesquisa.`;
}
