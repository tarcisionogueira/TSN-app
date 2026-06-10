const STORAGE_KEY = 'tsn_ativos_imoveis';
const SETTINGS_KEY = 'tsn_ativos_settings';

export const loadImoveis = () => {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch { return []; }
};

export const saveImoveis = (imoveis) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(imoveis));
};

export const loadSettings = () => {
  try {
    const data = localStorage.getItem(SETTINGS_KEY);
    return data ? JSON.parse(data) : {};
  } catch { return {}; }
};

export const saveSettings = (settings) => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

export const generateId = () => `tsn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
