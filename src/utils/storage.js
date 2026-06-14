const KEYS = {
  imoveis: 'tsn_imoveis_v2',
  favoritos: 'tsn_favoritos',
  buscas: 'tsn_buscas_recentes',
  user: 'tsn_user',
};

const get = (key) => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const set = (key, val) => localStorage.setItem(key, JSON.stringify(val));

export const loadImoveis = () => get(KEYS.imoveis) || [];
export const saveImoveis = (d) => set(KEYS.imoveis, d);

export const loadFavoritos = () => get(KEYS.favoritos) || [];
export const toggleFavorito = (imovel) => {
  const favs = loadFavoritos();
  const idx = favs.findIndex(f => f.id === imovel.id);
  const updated = idx >= 0 ? favs.filter(f => f.id !== imovel.id) : [...favs, imovel];
  set(KEYS.favoritos, updated);
  return updated;
};
export const isFavorito = (id) => loadFavoritos().some(f => f.id === id);

export const loadBuscasRecentes = () => get(KEYS.buscas) || [];
export const saveBuscaRecente = (filtros) => {
  const b = loadBuscasRecentes();
  const updated = [filtros, ...b.filter(x => JSON.stringify(x) !== JSON.stringify(filtros))].slice(0, 5);
  set(KEYS.buscas, updated);
};

export const generateId = () => `tsn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const getUser = () => get(KEYS.user);
export const setUser = (u) => set(KEYS.user, u);
