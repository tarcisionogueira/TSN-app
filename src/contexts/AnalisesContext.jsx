import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useAuth } from './AuthContext';
import { apiCall } from '../utils/apiCall';
import { supabase } from '../utils/supabase';

// Acompanhamento GLOBAL das análises (mercadológica E documental).
// A GERAÇÃO RODA NO SERVIDOR (/api/gerar-analise e /api/gerar-documental): o
// cliente dispara e pode FECHAR a aba — a função continua e grava em
// `analises_mercado` / `analises_documental`. Este contexto lê do banco (fonte da
// verdade, vale entre dispositivos) e usa localStorage só como cache para pintar
// o menu na hora. Exibido no menu "Análises" do topo.
const AnalisesContext = createContext(null);
const LS_KEY = 'bidpro_analises_v1';
const LS_KEY_DOC = 'bidpro_analises_doc_v1';
const MAX = 12;

function loadCache(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }
const rowToEntry = (r) => ({
  imovelId: r.imovel_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
  imovel: r.imovel || null, status: r.status, result: r.result || null, erro: r.erro || null,
  startedAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
  updatedAt: r.updated_at ? Date.parse(r.updated_at) : Date.now(),
});

export function AnalisesProvider({ children }) {
  const { user } = useAuth();
  const [analises, setAnalises] = useState(() => loadCache(LS_KEY));
  const [documentais, setDocumentais] = useState(() => loadCache(LS_KEY_DOC));

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(analises.slice(0, MAX))); } catch {} }, [analises]);
  useEffect(() => { try { localStorage.setItem(LS_KEY_DOC, JSON.stringify(documentais.slice(0, MAX))); } catch {} }, [documentais]);

  const mergeInto = useCallback((setter) => (rows) => {
    setter(prev => {
      const byId = {};
      for (const a of prev) byId[a.imovelId] = a;
      for (const r of rows) { const e = rowToEntry(r); byId[e.imovelId] = { ...byId[e.imovelId], ...e }; }
      return Object.values(byId).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, MAX);
    });
  }, []);
  const mergeRows = useCallback((rows) => mergeInto(setAnalises)(rows), [mergeInto]);
  const mergeDocRows = useCallback((rows) => mergeInto(setDocumentais)(rows), [mergeInto]);

  const recarregar = useCallback(async () => {
    if (!user?.id) return;
    const [{ data: m }, { data: d }] = await Promise.all([
      supabase.from('analises_mercado').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(MAX),
      supabase.from('analises_documental').select('*').eq('user_id', user.id).order('updated_at', { ascending: false }).limit(MAX),
    ]);
    if (Array.isArray(m)) mergeRows(m);
    if (Array.isArray(d)) mergeDocRows(d);
  }, [user?.id, mergeRows, mergeDocRows]);

  // Ao logar, carrega do banco (pega o que concluiu com a aba fechada / em outro device).
  useEffect(() => { if (user?.id) recarregar(); }, [user?.id, recarregar]);

  // Enquanto houver geração em andamento (de qualquer tipo), faz polling.
  const temGerando = analises.some(a => a.status === 'gerando') || documentais.some(a => a.status === 'gerando');
  useEffect(() => {
    if (!user?.id || !temGerando) return;
    const t = setInterval(recarregar, 12000);
    return () => clearInterval(t);
  }, [user?.id, temGerando, recarregar]);

  const upsertInto = useCallback((setter) => (entry) => {
    setter(prev => {
      const old = prev.find(a => a.imovelId === entry.imovelId) || {};
      const rest = prev.filter(a => a.imovelId !== entry.imovelId);
      return [{ ...old, ...entry, updatedAt: Date.now() }, ...rest].slice(0, MAX);
    });
  }, []);
  const upsert = useCallback((e) => upsertInto(setAnalises)(e), [upsertInto]);
  const upsertDoc = useCallback((e) => upsertInto(setDocumentais)(e), [upsertInto]);

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
    }).catch(() => { recarregar(); });
  }, [upsert, recarregar]);

  // Documental: dispara /api/gerar-documental (server-side, persistente).
  // payload pode trazer textoEdital/textoMatricula/processoNumero/processoNome/urlEdital.
  const iniciarDocumental = useCallback((meta, payload = {}) => {
    const imovelId = meta?.imovelId;
    if (!imovelId) return;
    upsertDoc({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    apiCall('/api/gerar-documental', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId, titulo: meta.titulo, cidade: meta.cidade, estado: meta.estado, imovel: meta.imovel || null, ...payload }),
    }).then(r => r.json()).then(d => {
      if (d?.result) upsertDoc({ imovelId, status: 'concluida', result: d.result, erro: null });
      else if (d?.error) upsertDoc({ imovelId, status: 'erro', erro: d.error });
      recarregar();
    }).catch(() => { recarregar(); });
  }, [upsertDoc, recarregar]);

  const getAnalise = useCallback((imovelId) => analises.find(a => a.imovelId === imovelId) || null, [analises]);
  const getDocumental = useCallback((imovelId) => documentais.find(a => a.imovelId === imovelId) || null, [documentais]);

  const remover = useCallback(async (imovelId) => {
    setAnalises(prev => prev.filter(a => a.imovelId !== imovelId));
    setDocumentais(prev => prev.filter(a => a.imovelId !== imovelId));
    if (user?.id) {
      try { await supabase.from('analises_mercado').delete().eq('user_id', user.id).eq('imovel_id', imovelId); } catch {}
      try { await supabase.from('analises_documental').delete().eq('user_id', user.id).eq('imovel_id', imovelId); } catch {}
    }
  }, [user?.id]);

  const emAndamento = analises.filter(a => a.status === 'gerando').length + documentais.filter(a => a.status === 'gerando').length;

  return (
    <AnalisesContext.Provider value={{ analises, documentais, iniciar, iniciarDocumental, getAnalise, getDocumental, remover, emAndamento, recarregar }}>
      {children}
    </AnalisesContext.Provider>
  );
}

export function useAnalises() {
  return useContext(AnalisesContext) || { analises: [], documentais: [], iniciar: () => {}, iniciarDocumental: () => {}, getAnalise: () => null, getDocumental: () => null, remover: () => {}, emAndamento: 0, recarregar: () => {} };
}
