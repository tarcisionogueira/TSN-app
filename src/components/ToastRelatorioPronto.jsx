import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, X, BarChart3, FileText, ClipboardCheck } from 'lucide-react';
import { useAnalises } from '../contexts/AnalisesContext';

// Toast (canto superior direito) de "relatório pronto" — pedido do dono: como a geração roda em
// background (você pode fechar a aba), quando ela CONCLUI aparece este aviso com "Ver" e "Fechar".
// Observa o AnalisesContext (que já faz polling do banco) e dispara SÓ na transição gerando→concluída
// (não no que já estava pronto ao abrir o app, para não floodar).
const TIPOS = {
  mercado:    { label: 'Relatório mercadológico', Icon: BarChart3,      cor: '#0D63DB' },
  documental: { label: 'Análise documental e jurídica', Icon: FileText, cor: '#1e3a8a' },
  laudo:      { label: 'Laudo de viabilidade', Icon: ClipboardCheck,    cor: '#059669' },
};

export default function ToastRelatorioPronto() {
  const nav = useNavigate();
  const { analises, documentais, laudos } = useAnalises();
  const [toasts, setToasts] = useState([]);
  const prev = useRef(null); // Map(key -> status); null = ainda não inicializado

  useEffect(() => {
    const listas = { mercado: analises, documental: documentais, laudo: laudos };
    const atual = new Map();
    for (const [tipo, lista] of Object.entries(listas)) {
      for (const a of (lista || [])) atual.set(`${tipo}:${a.imovelId}`, a.status);
    }
    if (prev.current === null) { prev.current = atual; return; } // 1ª passada: só registra
    const novos = [];
    for (const [tipo, lista] of Object.entries(listas)) {
      for (const a of (lista || [])) {
        const key = `${tipo}:${a.imovelId}`;
        if (a.status === 'concluida' && prev.current.get(key) === 'gerando') {
          novos.push({ id: `${key}:${a.updatedAt || ''}`, tipo, imovelId: a.imovelId, titulo: a.titulo, cidade: a.cidade, estado: a.estado, imovel: a.imovel });
        }
      }
    }
    prev.current = atual;
    if (novos.length) setToasts(t => { const ex = new Set(t.map(x => x.id)); return [...t, ...novos.filter(n => !ex.has(n.id))]; });
  }, [analises, documentais, laudos]);

  const fechar = (id) => setToasts(t => t.filter(x => x.id !== id));

  // Auto-some após 45s (ainda com Ver/Fechar enquanto estiver visível).
  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map(t => setTimeout(() => fechar(t.id), 45000));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const ver = (t) => {
    fechar(t.id);
    nav('/analise', { state: { imovel: t.imovel || { id: t.imovelId, titulo: t.titulo, cidade: t.cidade, estado: t.estado } } });
  };

  if (!toasts.length) return null;
  return (
    <div style={{ position: 'fixed', top: 'calc(16px + env(safe-area-inset-top,0px))', right: 16, zIndex: 5000, display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 'calc(100vw - 32px)' }}>
      {toasts.map(t => {
        const meta = TIPOS[t.tipo] || TIPOS.mercado;
        return (
          <div key={t.id} style={{ width: 330, maxWidth: '100%', background: 'white', borderRadius: 14, boxShadow: '0 14px 44px rgba(0,0,0,0.24)', border: '1px solid #e2e8f0', overflow: 'hidden', animation: 'toast-in .25s ease' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 14px 12px' }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: meta.cor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <meta.Icon size={18} color={meta.cor} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 800, color: '#111' }}>
                  <CheckCircle2 size={14} color="#16a34a" /> Pronto!
                </div>
                <div style={{ fontSize: 12.5, color: '#334155', marginTop: 2, lineHeight: 1.45 }}>
                  {meta.label} <strong>pronto</strong>{t.cidade ? ` — ${t.cidade}${t.estado ? '/' + t.estado : ''}` : ''}.
                </div>
              </div>
              <button onClick={() => fechar(t.id)} aria-label="Fechar" style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2, flexShrink: 0 }}><X size={16} /></button>
            </div>
            <div style={{ display: 'flex', gap: 8, padding: '0 14px 14px' }}>
              <button onClick={() => ver(t)} style={{ flex: 1, padding: '9px', background: meta.cor, color: 'white', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Ver relatório</button>
              <button onClick={() => fechar(t.id)} style={{ padding: '9px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Fechar</button>
            </div>
          </div>
        );
      })}
      <style>{'@keyframes toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}'}</style>
    </div>
  );
}
