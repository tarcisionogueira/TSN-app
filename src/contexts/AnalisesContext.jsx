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
const LS_KEY_LAUDO = 'bidpro_analises_laudo_v1';
const MAX = 12;

function loadCache(key) { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } }

// A função serverless de geração tem maxDuration de 5 min. Se ela morrer (timeout
// da Vercel, OOM, deploy no meio) sem gravar 'concluida'/'erro', a linha fica em
// 'gerando' PARA SEMPRE e o app gira o loader eternamente. Após esta folga,
// tratamos como falha: o card volta a permitir "Gerar" (o cron limpa a linha no
// banco). Assim um relatório NUNCA trava a tela.
const STALE_GERANDO_MS = 9 * 60 * 1000;
const rowToEntry = (r) => {
  const updatedAt = r.updated_at ? Date.parse(r.updated_at) : Date.now();
  let status = r.status, erro = r.erro || null;
  if (status === 'gerando' && (Date.now() - updatedAt) > STALE_GERANDO_MS) {
    status = 'erro';
    erro = erro || 'A geração excedeu o tempo limite. Gere novamente.';
  }
  return {
    imovelId: r.imovel_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
    imovel: r.imovel || null, status, result: r.result || null, erro,
    startedAt: r.created_at ? Date.parse(r.created_at) : Date.now(),
    updatedAt,
    progresso: r.progresso || null, // barra de evolução das etapas (só mercadológico)
    dataLeilao: r.data_leilao || null, // p/ calcular a expiração do relatório na tela
  };
};

export function AnalisesProvider({ children }) {
  // No modo suporte (admin visualizando a conta de um cliente), lê/gera pelo
  // usuário efetivo (o cliente), não pelo admin logado — senão a lista vem vazia.
  const { user, effectiveUserId } = useAuth();
  const uid = effectiveUserId || user?.id || null;
  const [analises, setAnalises] = useState(() => loadCache(LS_KEY));
  const [documentais, setDocumentais] = useState(() => loadCache(LS_KEY_DOC));
  const [laudos, setLaudos] = useState(() => loadCache(LS_KEY_LAUDO));

  useEffect(() => { try { localStorage.setItem(LS_KEY, JSON.stringify(analises.slice(0, MAX))); } catch {} }, [analises]);
  useEffect(() => { try { localStorage.setItem(LS_KEY_DOC, JSON.stringify(documentais.slice(0, MAX))); } catch {} }, [documentais]);
  useEffect(() => { try { localStorage.setItem(LS_KEY_LAUDO, JSON.stringify(laudos.slice(0, MAX))); } catch {} }, [laudos]);

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
  const mergeLaudoRows = useCallback((rows) => mergeInto(setLaudos)(rows), [mergeInto]);

  const recarregar = useCallback(async () => {
    if (!uid) return;
    const [{ data: m }, { data: d }, { data: l }] = await Promise.all([
      supabase.from('analises_mercado').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(MAX),
      supabase.from('analises_documental').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(MAX),
      supabase.from('analises_laudo').select('*').eq('user_id', uid).order('updated_at', { ascending: false }).limit(MAX),
    ]);
    if (Array.isArray(m)) mergeRows(m);
    if (Array.isArray(d)) mergeDocRows(d);
    if (Array.isArray(l)) mergeLaudoRows(l);
  }, [uid, mergeRows, mergeDocRows, mergeLaudoRows]);

  // Ao logar (ou trocar o usuário efetivo no suporte), carrega do banco.
  useEffect(() => { setAnalises([]); setDocumentais([]); setLaudos([]); if (uid) recarregar(); }, [uid, recarregar]);

  // VARREDURA anti-fantasma: um 'gerando' pode existir SÓ no cache local (sem linha no banco
  // p/ o merge corrigir) quando a aba fecha no meio, o servidor bloqueia no gate (cota/crédito)
  // antes de criar a linha, ou a sequência automática dispara e é interrompida. Aí o card gira
  // "Gerando…" para sempre e o polling nunca para. Aqui rebaixamos qualquer 'gerando' mais velho
  // que STALE_GERANDO_MS para 'erro' (mesmo sem linha no banco) — some o spinner e para o polling.
  useEffect(() => {
    const demote = (list) => {
      let mudou = false;
      const out = list.map(a => {
        if (a.status === 'gerando' && Date.now() - (a.startedAt || a.updatedAt || 0) > STALE_GERANDO_MS) {
          mudou = true;
          return { ...a, status: 'erro', erro: a.erro || 'A geração excedeu o tempo limite. Gere novamente.' };
        }
        return a;
      });
      return mudou ? out : list; // mesma referência quando nada muda → React não re-renderiza à toa
    };
    const varrer = () => { setAnalises(demote); setDocumentais(demote); setLaudos(demote); };
    varrer();
    const t = setInterval(varrer, 30000);
    return () => clearInterval(t);
  }, []);

  // Enquanto houver geração em andamento (de qualquer tipo), faz polling.
  const temGerando = analises.some(a => a.status === 'gerando') || documentais.some(a => a.status === 'gerando') || laudos.some(a => a.status === 'gerando');
  useEffect(() => {
    if (!uid || !temGerando) return;
    const t = setInterval(recarregar, 12000);
    return () => clearInterval(t);
  }, [uid, temGerando, recarregar]);

  const upsertInto = useCallback((setter) => (entry) => {
    setter(prev => {
      const old = prev.find(a => a.imovelId === entry.imovelId) || {};
      const rest = prev.filter(a => a.imovelId !== entry.imovelId);
      return [{ ...old, ...entry, updatedAt: Date.now() }, ...rest].slice(0, MAX);
    });
  }, []);
  const upsert = useCallback((e) => upsertInto(setAnalises)(e), [upsertInto]);
  const upsertDoc = useCallback((e) => upsertInto(setDocumentais)(e), [upsertInto]);
  const upsertLaudo = useCallback((e) => upsertInto(setLaudos)(e), [upsertInto]);

  // meta: { imovelId, titulo, cidade, estado, imovel } ; payload: { mercadoInputs, parecerInputs }
  const iniciar = useCallback((meta, payload) => {
    const imovelId = meta?.imovelId;
    if (!imovelId) return;
    upsert({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    apiCall('/api/gerar-analise', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId, titulo: meta.titulo, cidade: meta.cidade, estado: meta.estado, imovel: meta.imovel || null, paraUserId: meta.paraUserId || undefined, ...payload }),
    }).then(r => r.json()).then(d => {
      if (d?.result) upsert({ imovelId, status: 'concluida', result: d.result, erro: null });
      else if (d?.error) upsert({ imovelId, status: 'erro', erro: d.error });
      // Resposta sem result nem error → NUNCA deixa preso em 'gerando' (o recarregar
      // reconcilia com o banco caso o servidor ainda esteja processando de verdade).
      else upsert({ imovelId, status: 'erro', erro: 'Não foi possível gerar agora. Tente novamente.' });
      recarregar();
    }).catch(() => { upsert({ imovelId, status: 'erro', erro: 'Falha de conexão ao gerar. Tente novamente.' }); recarregar(); });
  }, [upsert, recarregar]);

  // Documental: dispara /api/gerar-documental (server-side, persistente).
  // payload pode trazer textoEdital/textoMatricula/processoNumero/processoNome/urlEdital.
  const iniciarDocumental = useCallback((meta, payload = {}) => {
    const imovelId = meta?.imovelId;
    if (!imovelId) return;
    upsertDoc({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    apiCall('/api/gerar-documental', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId, titulo: meta.titulo, cidade: meta.cidade, estado: meta.estado, imovel: meta.imovel || null, paraUserId: meta.paraUserId || undefined, ...payload }),
    }).then(r => r.json()).then(d => {
      if (d?.result) upsertDoc({ imovelId, status: 'concluida', result: d.result, erro: null });
      else if (d?.error) upsertDoc({ imovelId, status: 'erro', erro: d.error });
      else upsertDoc({ imovelId, status: 'erro', erro: 'Não foi possível gerar agora. Tente novamente.' });
      recarregar();
    }).catch(() => { upsertDoc({ imovelId, status: 'erro', erro: 'Falha de conexão ao gerar. Tente novamente.' }); recarregar(); });
  }, [upsertDoc, recarregar]);

  // Laudo de viabilidade (3º documento): consolida mercadológico + documental no
  // servidor (/api/gerar-laudo-viabilidade). Não reprocessa fontes pagas.
  const iniciarLaudo = useCallback((meta) => {
    const imovelId = meta?.imovelId;
    if (!imovelId) return;
    upsertLaudo({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    apiCall('/api/gerar-laudo-viabilidade', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imovelId, titulo: meta.titulo, cidade: meta.cidade, estado: meta.estado, imovel: meta.imovel || null, paraUserId: meta.paraUserId || undefined }),
    }).then(r => r.json()).then(d => {
      if (d?.result) upsertLaudo({ imovelId, status: 'concluida', result: d.result, erro: null });
      else if (d?.error) upsertLaudo({ imovelId, status: 'erro', erro: d.error });
      else upsertLaudo({ imovelId, status: 'erro', erro: 'Não foi possível gerar agora. Tente novamente.' });
      recarregar();
    }).catch(() => { upsertLaudo({ imovelId, status: 'erro', erro: 'Falha de conexão ao gerar. Tente novamente.' }); recarregar(); });
  }, [upsertLaudo, recarregar]);

  const getAnalise = useCallback((imovelId) => analises.find(a => a.imovelId === imovelId) || null, [analises]);
  const getDocumental = useCallback((imovelId) => documentais.find(a => a.imovelId === imovelId) || null, [documentais]);
  const getLaudo = useCallback((imovelId) => laudos.find(a => a.imovelId === imovelId) || null, [laudos]);

  const remover = useCallback(async (imovelId) => {
    setAnalises(prev => prev.filter(a => a.imovelId !== imovelId));
    setDocumentais(prev => prev.filter(a => a.imovelId !== imovelId));
    setLaudos(prev => prev.filter(a => a.imovelId !== imovelId));
    if (uid) {
      try { await supabase.from('analises_mercado').delete().eq('user_id', uid).eq('imovel_id', imovelId); } catch {}
      try { await supabase.from('analises_documental').delete().eq('user_id', uid).eq('imovel_id', imovelId); } catch {}
      try { await supabase.from('analises_laudo').delete().eq('user_id', uid).eq('imovel_id', imovelId); } catch {}
    }
  }, [uid]);

  const emAndamento = analises.filter(a => a.status === 'gerando').length + documentais.filter(a => a.status === 'gerando').length + laudos.filter(a => a.status === 'gerando').length;

  return (
    <AnalisesContext.Provider value={{ analises, documentais, laudos, iniciar, iniciarDocumental, iniciarLaudo, getAnalise, getDocumental, getLaudo, remover, emAndamento, recarregar }}>
      {children}
    </AnalisesContext.Provider>
  );
}

export function useAnalises() {
  return useContext(AnalisesContext) || { analises: [], documentais: [], laudos: [], iniciar: () => {}, iniciarDocumental: () => {}, iniciarLaudo: () => {}, getAnalise: () => null, getDocumental: () => null, getLaudo: () => null, remover: () => {}, emAndamento: 0, recarregar: () => {} };
}
