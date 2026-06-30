import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

// Acompanhamento GLOBAL das análises (geração mercadológica + viabilidade).
// A geração roda AQUI, no provider — assim continua mesmo se o usuário sair da
// tela de análise e navegar pelo sistema. O estado é persistido em localStorage
// (sobrevive a F5) e exibido no menu "Análises" do topo.
const AnalisesContext = createContext(null);
const LS_KEY = 'bidpro_analises_v1';
const MAX = 12;

function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch { return []; }
}

export function AnalisesProvider({ children }) {
  const [analises, setAnalises] = useState(load);
  const runsRef = useRef({});           // imovelId -> Promise em andamento (evita rodar 2x)
  const inicioSessao = useRef(Date.now());

  // Destrava entradas presas em 'gerando' de sessões anteriores: se o app foi
  // recarregado no meio da geração, ela não está mais rodando neste processo.
  useEffect(() => {
    setAnalises(prev => {
      let mudou = false;
      const novo = prev.map(a => {
        if (a.status === 'gerando' && (a.startedAt || 0) < inicioSessao.current) {
          mudou = true; return { ...a, status: 'erro', erro: 'Geração interrompida (recarregue para refazer).' };
        }
        return a;
      });
      return mudou ? novo : prev;
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(analises.slice(0, MAX))); } catch {}
  }, [analises]);

  const upsert = useCallback((entry) => {
    setAnalises(prev => {
      const i = prev.findIndex(a => a.imovelId === entry.imovelId);
      const merged = i >= 0 ? { ...prev[i], ...entry, updatedAt: Date.now() } : { ...entry, updatedAt: Date.now() };
      const rest = prev.filter(a => a.imovelId !== entry.imovelId);
      return [merged, ...rest].slice(0, MAX);
    });
  }, []);

  // meta: { imovelId, titulo, cidade, estado, imovel } ; runFn: async () => result
  const iniciar = useCallback((meta, runFn) => {
    const imovelId = meta?.imovelId;
    if (!imovelId || runsRef.current[imovelId]) return;
    upsert({ ...meta, status: 'gerando', startedAt: Date.now(), erro: null, result: null });
    const p = (async () => {
      try {
        const result = await runFn();
        upsert({ imovelId, status: 'concluida', result, erro: null });
      } catch (e) {
        upsert({ imovelId, status: 'erro', erro: String(e?.message || e) });
      } finally {
        delete runsRef.current[imovelId];
      }
    })();
    runsRef.current[imovelId] = p;
  }, [upsert]);

  const getAnalise = useCallback((imovelId) => analises.find(a => a.imovelId === imovelId) || null, [analises]);
  const remover = useCallback((imovelId) => setAnalises(prev => prev.filter(a => a.imovelId !== imovelId)), []);

  const emAndamento = analises.filter(a => a.status === 'gerando').length;

  return (
    <AnalisesContext.Provider value={{ analises, iniciar, getAnalise, remover, emAndamento }}>
      {children}
    </AnalisesContext.Provider>
  );
}

export function useAnalises() {
  return useContext(AnalisesContext) || { analises: [], iniciar: () => {}, getAnalise: () => null, remover: () => {}, emAndamento: 0 };
}
