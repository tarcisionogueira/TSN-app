import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { apiCall } from '../utils/apiCall';
import { supabase } from '../utils/supabase';

// Acompanhamento GLOBAL das análises mercadológicas.
// A GERAÇÃO RODA NO SERVIDOR (/api/gerar-analise): o cliente dispara e pode FECHAR
// a aba — a função continua e grava em `analises_mercado`. Este contexto lê do
// banco (fonte da verdade, vale entre dispositivos) e usa localStorage só como
// cache para pintar o menu na hora. Exibido no menu "Análises" do topo.
const AnalisesContext = createContext(null);
const LS_KEY = 'bidpro_analises_v1';
const MAX = 12;

function loadCache() { try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; } }
const rowToEntry = (r) => ({
  imovelId: r.imovel_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
  imovel: r.imovel || null, status: r.status, result: r.result || null, erro: r.erro || null,
  startedAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
  updatedAt: r.updated_at ? Date.parse(r.updated_at) : Date.now(),
});

export function AnalisesProvider({ children }) {
  const { user } = useAuth();
  const [analises, setAnalises] = useState(loadCache);

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(analises.slice(0, MAX))); } catch {} }, [analises]);

  const mergeRows = useCallback((rows) => {
    setAnalises(prev => {
      const byId = {};
      for (const a of prev) byId[a.imovelId] = a;
      for (const r of rows) { const e = rowToEntry(r); byId[e.imovelId] = { ...byId[e.imovelId], ...e }; }
      return Object.values(byId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, MAX);
    });
  }, []);

  const recarregar = useCallback(async () => {
    if (!user?.id) return;
    const { data } = await supabase.from('analises_mercado').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(MAX);
    if (Array.isArray(data)) mergeRows(data);
  }, [user?.id, mergeRows]);

  // Ao logar, carrega do banco (pega o que concluiu com a aba fechada / em outro device).
  useEffect(() => { if (user?.id) recarregar(); }, [user?.id, recarregar]);

  // Enquanto houver geração em andamento, faz polling para sincronizar a conclusão server-side.
  const temGerando = analises.some(a => a.status === 'gerando');
  useEffect(() => {
    if (!user?.id || !temGerando) return;
    const t = setInterval(recarregar, 12000);
    return () => clearInterval(t);
  }, [user?.id, temGerando, recarregar]);

  const upsert = useCallback((entry) => {
    setAnalises(prev => {
      const old = prev.find(a => a.imovelId === entry.imovelId) || {};
      const rest = prev.filter(a => a.imovelId !== entry.imovelId);
      return [{ ...old, ...entry, updatedAt: Date.now() }, ...rest].slice(0, MAX);
    });
  }, []);

  // meta: { imovelId, titulo, cidade, estado, imovel } ; payload: { mercadoInputs, parecerInputs }
  const iniciar = useCallback((meta, payload) => {
    const imovelId = meta?.imovelId;
    if (!imovelId) return;
    upsert({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    apiCall('/api/gerar-analise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId, titulo: meta.titulo, cidade: meta.cidade, estado: meta.estado, imovel: meta.imovel || null, ...payload }),
    }).then(r => r.json()).then(d => {
      if (d?.result) upsert({ imovelId, status: 'concluida', result: d.result, erro: null });
      else if (d?.error) upsert({ imovelId, status: 'erro', erro: d.error });
      recarregar();
    }).catch(() => {
      // Rede caiu ou a aba foi fechada: o servidor CONTINUA e grava no banco;
      // o load ao reabrir (ou o poll) pega o resultado.
      recarregar();
    });
  }, [upsert, recarregar]);

  const getAnalise = useCallback((imovelId) => analises.find(a => a.imovelId === imovelId) || null, [analises]);

  const remover = useCallback(async (imovelId) => {
    setAnalises(prev => prev.filter(a => a.imovelId !== imovelId));
    if (user?.id) { try { await supabase.from('analises_mercado').delete().eq('user_id', user.id).eq('imovel_id', imovelId); } catch {} }
  }, [user?.id]);

  const emAndamento = analises.filter(a => a.status === 'gerando').length;

  return (
    <AnalisesContext.Provider value={{ analises, iniciar, getAnalise, remover, emAndamento, recarregar }}>
      {children}
    </AnalisesContext.Provider>
  );
}

export function useAnalises() {
  return useContext(AnalisesContext) || { analises: [], iniciar: () => {}, getAnalise: () => null, remover: () => {}, emAndamento: 0, recarregar: () => {} };
}
