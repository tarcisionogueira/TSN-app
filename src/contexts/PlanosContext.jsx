import React, { createContext, useContext, useState, useEffect } from 'react';
import { fetchPlanosComConfig } from '../utils/planosConfig';

const PlanosContext = createContext(null);

export function PlanosProvider({ children }) {
  const [planos, setPlanos] = useState(null);

  useEffect(() => {
    fetchPlanosComConfig().then(setPlanos);
  }, []);

  return (
    <PlanosContext.Provider value={planos}>
      {children}
    </PlanosContext.Provider>
  );
}

/** Retorna o objeto PLANOS ao vivo. null enquanto carrega. */
export function usePlanos() {
  return useContext(PlanosContext);
}

/** Retorna nome do plano pela key (fallback para key se ainda carregando). */
export function usePlanoNome(key) {
  const planos = usePlanos();
  if (!planos || !key) return key || '';
  return planos[key]?.nome || key;
}

/** Retorna label formatado "Nome — R$ X,XX/mês" para uso em selects. */
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
