import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { fetchPlanosComConfig } from '../utils/planosConfig';

const PlanosContext = createContext(null);

// Cache local com TTL de 60s para evitar múltiplas requests na mesma navegação
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 60_000;

async function fetchComCache() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
  const data = await fetchPlanosComConfig();
  _cache = data;
  _cacheTs = Date.now();
  return data;
}

export function PlanosProvider({ children }) {
  const [planos, setPlanos] = useState(null);
  const location = useLocation();

  const refresh = useCallback(() => {
    fetchComCache().then(setPlanos);
  }, []);

  // Re-busca a cada navegação de rota
  useEffect(() => {
    refresh();
  }, [location.pathname, refresh]);

  // Re-busca quando o usuário volta para a aba (ex: voltou do admin)
  useEffect(() => {
    const onFocus = () => { _cache = null; refresh(); };
    window.addEventListener('visibilitychange', onFocus);
    return () => window.removeEventListener('visibilitychange', onFocus);
  }, [refresh]);

  // Permite invalidar o cache globalmente (chamado após salvar no admin)
  PlanosProvider.invalidate = () => { _cache = null; };

  return (
    <PlanosContext.Provider value={planos}>
      {children}
    </PlanosContext.Provider>
  );
}

export function usePlanos() {
  return useContext(PlanosContext);
}

export function usePlanoNome(key) {
  const planos = usePlanos();
  if (!planos || !key) return key || '';
  return planos[key]?.nome || key;
}

export function usePlanosVenda() {
  const planos = usePlanos();
  if (!planos) return [];
  const fmt = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const result = [];
  ['top2', 'assessorado', 'clube'].forEach(key => {
    const p = planos[key];
    if (!p || !p.ativo) return;
    const precoLabel = p.assinatura
      ? `R$ ${fmt(p.preco)}/mês`
      : p.precoVista
        ? `R$ ${fmt(p.preco)} em 12× ou R$ ${fmt(p.precoVista)} à vista`
        : `R$ ${fmt(p.preco)}`;
    result.push({ key, nome: p.nome, precoLabel });
    if (!p.assinatura && p.precoVista) {
      result.push({ key: `${key}_vista`, nome: `${p.nome} (À Vista)`, precoLabel: `R$ ${fmt(p.precoVista)} (${p.desconto_vista_pct || 20}% off)` });
    }
  });
  return result;
}
