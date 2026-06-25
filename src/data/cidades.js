export const RAIOS_KM = [
  { label: 'Cidade exata', value: 0 },
  { label: '+ 10 km', value: 10 },
  { label: '+ 25 km', value: 25 },
  { label: '+ 50 km', value: 50 },
  { label: '+ 100 km', value: 100 },
  { label: '+ 200 km', value: 200 },
];

const IBGE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 dias

export async function buscarCidadesEstado(uf) {
  if (!uf) return [];
  const cacheKey = `ibge_cidades_${uf}`;
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { ts, data } = JSON.parse(cached);
      if (Date.now() - ts < IBGE_CACHE_TTL) return data;
    }
  } catch {}

  try {
    const res = await fetch(
      `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios?orderBy=nome`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return [];
    const json = await res.json();
    const nomes = json.map(m => m.nome);
    try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: nomes })); } catch {}
    return nomes;
  } catch {
    return [];
  }
}
