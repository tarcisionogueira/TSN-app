/**
 * Saúde dos coletores de veículo — o que é vazio legítimo (scraper-veiculos-motor.mjs).
 */
// "RESPONDI E NÃO TENHO VEÍCULO PARA VOCÊ" NÃO É FALHA (23/10). Sem `vazio`, `registrarSaude` grava 'falhou' para
// toda rodada sem linha: SHIOKAWA e ZACCARINO (API lida inteira, 0 veículos — 3 imóveis e 1 imóvel) e SAVOY
// (2.961 de 3.155 lotes só para empresa credenciada) acusavam quebra todo dia. Só recusa OBJETIVA conta como vazio
// legítimo; "não é veículo inteiro" e "sem valor" dependem da leitura e podem ser parser quebrado — esses seguem
// 'falhou'. Mesmo princípio do 'vazio' de imóveis (runner.mjs) e do 'sem_cota'.
export const RECUSA_POR_REGRA = /^(só para empresa credenciada|encerrado|bem com o executado)/;
export function classificarVazio(r) {
  if (!r.fetchOk || r.rows.length) return null;
  if (r.enumerados === 0) return 'site sem veículo em aberto (catálogo lido inteiro)';
  // Catálogo MISTO lido e nenhum lote com cara de veículo pela URL (`urlCandidata`) — ATLANTICOLEILOES 26/10: 2 lotes, os
  // 2 imóveis. Gravava 'falhou' com "2 enumerados e nenhum gravado (sem motivo registrado)": não houve leitura a explicar.
  if (r.candidatos === 0) return `site sem veículo em aberto (${r.enumerados} lote(s) no catálogo, nenhum de veículo pela URL)`;
  if (r.lidos && r.porRegra / r.lidos >= 0.9) return `${r.enumerados} enumerados, nenhum arrematável por pessoa física ou vigente (${r.porque || '—'})`.slice(0, 300);
  return null;
}
