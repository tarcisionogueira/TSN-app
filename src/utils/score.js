/**
 * Score BidPro — nota 0–10 de potencial de oportunidade do imóvel de leilão.
 *
 * MODELO EM CAMADAS (validável). Em vez de "margem 65% + risco 35% que só entra
 * depois" (que travava a nota longe do 10 antes da análise), a nota é a média
 * PONDERADA das camadas PRESENTES, re-normalizada. Assim já na busca a nota pode
 * chegar a 10 com o dado disponível, e REFINA (não pula) quando a análise chega.
 *
 * Camadas e pesos-base (soma 100; re-normalizados sobre as presentes):
 *  - Margem (40): desconto do lance vs. avaliação. Sempre disponível.
 *  - Localização (25): score_localizacao (proximidades OSM). Só p/ imóvel com
 *    coordenada precisa (geocod_nivel=endereco). Ausente → camada não conta.
 *  - Perfil (15): modalidade + tipo (liquidez/simplicidade da operação). Busca.
 *  - Jurídico (10): score jurídico da análise documental. Só após análise.
 *  - Financeiro (10): score financeiro da análise. Só após análise.
 *
 * Retorna null quando não há NENHUMA camada pontuável. `camadas` traz a quebra
 * (para exibir os sub-scores de forma transparente).
 *
 * Os pesos e as tabelas de perfil ficam no topo, propositalmente fáceis de calibrar
 * após a validação-piloto.
 */
export const PESOS = { margem: 40, localizacao: 25, perfil: 15, juridico: 10, financeiro: 10 };

// Perfil por MODALIDADE: quanto mais simples/líquida a operação, maior. (0–10)
const PERFIL_MODALIDADE = [
  [/venda[\s_-]?direta|venda[\s_-]?online/, 8], // compra direta, sem disputa
  [/licita/, 7],                                 // licitação aberta
  [/extrajud|sfi|edital[\s_-]?[úu]nico/, 6],      // leilão extrajudicial
  [/leil/, 6],                                    // leilão (genérico)
  [/judicial/, 4],                                // judicial: mais risco/ocupação
];
// Perfil por TIPO de imóvel: liquidez de revenda/locação. (0–10)
const PERFIL_TIPO = {
  apartamento: 8, casa: 8, sobrado: 8, comercial: 6, sala: 6, loja: 6,
  terreno: 5, lote: 5, galpao: 5, 'galpão': 5, rural: 4, sitio: 4,
  chacara: 4, fazenda: 4, vaga: 4,
};

const round1 = (n) => Math.round(n * 10) / 10;

function norm10(v) {
  const n = Number(v);
  if (isNaN(n)) return null;
  return n > 10 ? n / 10 : n; // aceita escala 0–100 ou 0–10
}

function perfilScore(modalidade, tipo) {
  const m = String(modalidade || '').toLowerCase();
  const t = String(tipo || '').toLowerCase();
  let sm = null, st = null;
  if (m) { for (const [re, v] of PERFIL_MODALIDADE) if (re.test(m)) { sm = v; break; } if (sm == null) sm = 5; }
  if (t) st = PERFIL_TIPO[t] ?? 6;
  const vals = [sm, st].filter((v) => v != null);
  if (!vals.length) return null;
  return round1(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function scoreBidPro({ desconto, modalidade, tipo, scoreLocalizacao, scoreJuridico, scoreFinanceiro } = {}) {
  const camadas = [];

  const d = Number(desconto);
  if (!isNaN(d)) {
    const c = Math.max(0, Math.min(60, d));
    camadas.push({ key: 'margem', label: 'Margem', nota: round1(2 + (c / 60) * 8), peso: PESOS.margem });
  }

  const loc = norm10(scoreLocalizacao);
  if (loc != null) camadas.push({ key: 'localizacao', label: 'Localização', nota: round1(Math.max(0, Math.min(10, loc))), peso: PESOS.localizacao });

  const perfil = perfilScore(modalidade, tipo);
  if (perfil != null) camadas.push({ key: 'perfil', label: 'Perfil', nota: perfil, peso: PESOS.perfil });

  const sj = norm10(scoreJuridico);
  if (sj != null) camadas.push({ key: 'juridico', label: 'Jurídico', nota: round1(Math.max(0, Math.min(10, sj))), peso: PESOS.juridico });

  const sf = norm10(scoreFinanceiro);
  if (sf != null) camadas.push({ key: 'financeiro', label: 'Financeiro', nota: round1(Math.max(0, Math.min(10, sf))), peso: PESOS.financeiro });

  if (!camadas.length) return null;

  const somaPeso = camadas.reduce((a, c) => a + c.peso, 0);
  const nota = Math.max(0, Math.min(10, round1(camadas.reduce((a, c) => a + c.nota * c.peso, 0) / somaPeso)));
  const temAnalise = camadas.some((c) => c.key === 'juridico' || c.key === 'financeiro');
  const base = temAnalise ? 'completo' : 'busca';
  const cor = nota >= 7 ? '#16a34a' : nota >= 4 ? '#d97706' : '#dc2626';
  return { nota, cor, base, camadas };
}

// Rótulo curto do que a nota representa (para tooltip/legenda).
export function scoreLabel(base) {
  if (base === 'completo') return 'Margem + localização + perfil + análise';
  return 'Margem + localização + perfil (refina após análise)';
}
