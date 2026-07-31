/**
 * Referência PONDERADA por PROXIMIDADE + PADRÃO, com encolhimento por CREDIBILIDADE.
 *
 * Pedido do dono: "quando tiver POUCAS amostras na localidade, atribuir um PESO por tipo/
 * proximidade — quanto mais PRÓXIMO e do MESMO PADRÃO, maior a influência; MAS mesmo assim
 * fazer o TICKET MÉDIO com os demais para trazer uma referência mais real."
 *
 * Modelo (simétrico — ajusta o valor p/ CIMA ou p/ BAIXO; é o mais seguro para informar):
 *     valor = cred · V_local + (1 − cred) · V_amplo
 *   • V_local = mediana das amostras PONDERADA por proximidade × padrão (perto e do mesmo
 *               padrão pesam mais).
 *   • V_amplo = ticket médio (mediana simples) de TODAS as amostras da região = "os demais".
 *   • cred    = n_eff / (n_eff + K), onde n_eff = MASSA de proximidade (Σ peso_dist). Muita
 *               evidência perto → cred→1 (manda o local); pouca → cred→0 (puxa p/ o ticket médio).
 *
 * Puro (sem fetch): roda igual no Edge e no Node. Quem chama lê as amostras e — se quiser refletir
 * a valorização — já pode PROJETAR valor_m2 p/ hoje antes de passar (une temporal + espacial).
 */

// Distância equirretangular (m) — mesma da consulta do índice (barata, boa em escala de cidade).
const distanciaM = (aLat, aLng, lat, lng) => {
  if (![aLat, aLng, lat, lng].every(n => Number.isFinite(Number(n)))) return null;
  const dLat = (+aLat - +lat), dLng = (+aLng - +lng) * Math.cos(+lat * Math.PI / 180);
  return 111320 * Math.sqrt(dLat * dLat + dLng * dLng);
};

// Peso de PROXIMIDADE (decaimento gaussiano): 1 no alvo, ~0,60 a 250 m, ~0,13 a 500 m, ~0 além de
// ~1 km. Concentra a "evidência local" no entorno real. Amostra SEM coordenada conta pouco (0,05):
// entra fraco no valor e quase não infla a credibilidade local.
const pesoProximidade = (d, escala = 350) => (d == null ? 0.05 : Math.exp(-((d / escala) ** 2)));

// Peso de PADRÃO (gaussiana no log-preço em torno do centro): o "mesmo padrão" pesa mais e um
// outlier (mansão no meio de apês / lote errado) é atenuado. sigma≈0,5 em log ≈ tolerância ~±65%
// — larga o bastante p/ preservar o nível REAL da localidade, estreita p/ conter o disparate.
const pesoPadrao = (v, centro, sigma = 0.5) => {
  if (!(v > 0) || !(centro > 0)) return 1;
  const z = Math.log(v / centro) / sigma;
  return Math.exp(-0.5 * z * z);
};

const medianaSimples = (vals) => {
  const a = (vals || []).map(Number).filter(v => v > 0).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2);
};

const medianaPonderada = (pares) => {
  const a = pares.filter(p => p.v > 0 && p.w > 0).sort((x, y) => x.v - y.v);
  if (!a.length) return null;
  const tot = a.reduce((s, p) => s + p.w, 0);
  let acc = 0;
  for (const p of a) { acc += p.w; if (acc >= tot / 2) return p.v; }
  return a[a.length - 1].v;
};

export const K_CREDIBILIDADE = 6; // ~6 amostras-equivalentes perto → 50% de peso local (espelha o MIN_GEO da consulta).

/**
 * @param {Array<{valor_m2:number, lat?:number, lng?:number}>} amostras  TODAS as amostras de VENDA
 *        (plausíveis, sem leilão) da região — o "local" e os "demais" saem daqui pelo peso de distância.
 * @param {{lat:number, lng:number, valor?:number}} alvo  coordenada de referência; `valor` opcional
 *        fixa o CENTRO do padrão (ex.: no relatório, o R$/m² esperado do imóvel-alvo).
 * @param {{k?:number}} [opts]
 * @returns {{valor:number, valor_local:number, ticket_medio:number, n_efetivo:number,
 *            credibilidade:number, misturado:boolean} | null}  null quando não há base/coordenada.
 */
export function referenciaPonderada(amostras, alvo, opts = {}) {
  const k = opts.k ?? K_CREDIBILIDADE;
  const lista = (amostras || []).filter(a => Number(a.valor_m2) > 0);
  if (lista.length < 3) return null; // base curta demais p/ ponderar com sentido — chamador segue no caminho atual
  const temAlvoGeo = alvo && Number.isFinite(Number(alvo.lat)) && Number.isFinite(Number(alvo.lng));
  if (!temAlvoGeo) return null;      // sem coordenada do alvo não existe "proximidade" — não força mistura
  const ticket = medianaSimples(lista.map(a => a.valor_m2));
  if (!(ticket > 0)) return null;
  const centro = Number(alvo.valor) > 0 ? Number(alvo.valor) : ticket;
  let massa = 0;
  const pares = lista.map(a => {
    const v = Number(a.valor_m2);
    const d = distanciaM(a.lat, a.lng, alvo.lat, alvo.lng);
    const wProx = pesoProximidade(d);
    // CREDIBILIDADE só conta evidência COM localização: amostra sem coordenada entra fraca no
    // valor (peso-piso), mas NÃO infla a confiança "local" (senão muitas amostras sem geo dariam
    // credibilidade alta sem nada realmente perto). Sem geo → cred→0 → puxa p/ o ticket médio.
    if (d != null) massa += wProx;
    return { v, w: wProx * pesoPadrao(v, centro) };
  });
  const vLocal = medianaPonderada(pares) ?? ticket;
  const cred = massa / (massa + k);
  const valor = Math.round(cred * vLocal + (1 - cred) * ticket);
  return {
    valor,
    valor_local: Math.round(vLocal),
    ticket_medio: Math.round(ticket),
    n_efetivo: Math.round(massa * 10) / 10,
    credibilidade: Math.round(cred * 100) / 100,
    misturado: cred < 0.9, // houve encolhimento relevante ao ticket médio (poucas amostras locais)
  };
}
