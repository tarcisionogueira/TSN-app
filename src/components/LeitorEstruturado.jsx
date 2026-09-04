import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Minus, Plus, Sun, Moon, ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * LEITOR DE eBOOK EM FORMATO ESTRUTURADO (docx → capítulos) — irmão do LeitorPaginado
 * (PDF), mesmo "chrome" (overlay fullscreen, 3 temas, barra de progresso, mesma chave de
 * localStorage do tema), mas o conteúdo é TEXTO REAL, não canvas — fonte ajustável de
 * verdade (reflow), não zoom de imagem. Unidade de navegação é o CAPÍTULO, não a página.
 *
 * Diferença deliberada do LeitorPaginado: SEM toque nas laterais para virar capítulo — lá
 * funciona porque uma página de PDF ocasionalmente estoura a tela; aqui um capítulo estoura
 * a tela quase sempre (é texto corrido), então esse gesto brigaria com "estou só rolando pra
 * ler". Navegação só por botão explícito. Toque no meio ainda esconde/mostra a interface.
 */

const TEMAS = {
  sepia:  { fundo: '#100e0a', papel: '#fbf3e4', texto: '#2d2416', ui: 'rgba(255,255,255,0.86)', barra: 'rgba(20,18,14,0.92)' },
  claro:  { fundo: '#0f1115', papel: '#ffffff', texto: '#111111', ui: 'rgba(255,255,255,0.86)', barra: 'rgba(15,17,21,0.92)' },
  escuro: { fundo: '#000000', papel: '#1c1c1e', texto: '#e8e0d0', ui: 'rgba(255,255,255,0.78)', barra: 'rgba(0,0,0,0.92)' },
};
const ORDEM_TEMA = ['sepia', 'claro', 'escuro'];
const LARGURA_MAX = 720;

export default function LeitorEstruturado({
  capitulos, titulo, onClose,
  itemId, itemTipo = 'ebook', supabase, userId,
}) {
  const [capituloIdx, setCapituloIdx] = useState(0);
  const [fontSize, setFontSize] = useState(17);
  const [tema, setTema] = useState(() => { try { return localStorage.getItem('tsn_leitura_tema') || 'sepia'; } catch { return 'sepia'; } });
  const [chrome, setChrome] = useState(true);
  const [retomado, setRetomado] = useState(0);
  const cor = TEMAS[tema] || TEMAS.sepia;
  const total = capitulos.length;

  const areaRef = useRef(null);
  const salvarRef = useRef(null);
  const fracaoScrollRef = useRef(0);

  // ── Retoma de onde parou ────────────────────────────────────────────────────
  useEffect(() => {
    if (!itemId || !total) return;
    let cancel = false;
    (async () => {
      let salva = 0;
      if (supabase && userId) {
        try {
          // padrao-ok: retomada é best-effort — falha aqui só abre no capítulo 1, mesmo padrão de LeitorPaginado.jsx
          const { data } = await supabase.from('leitura_progresso')
            .select('pagina').eq('user_id', userId).eq('item_tipo', itemTipo).eq('item_id', String(itemId)).maybeSingle();
          if (Number(data?.pagina) > 0) salva = Number(data.pagina);
        } catch { /* segue do início */ }
      }
      if (cancel) return;
      const alvo = Math.min(Math.max(1, salva), total) - 1;
      if (alvo > 0) { setCapituloIdx(alvo); setRetomado(alvo + 1); setTimeout(() => setRetomado(0), 4000); }
    })();
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, itemTipo, total]);

  // Capítulo novo sempre começa do topo (mesma filosofia do LeitorPaginado).
  useEffect(() => { if (areaRef.current) areaRef.current.scrollTop = 0; fracaoScrollRef.current = 0; }, [capituloIdx]);

  // ── Salva progresso (debounce) ──────────────────────────────────────────────
  const salvarProgresso = useCallback(() => {
    if (!itemId || !total || !supabase || !userId) return;
    clearTimeout(salvarRef.current);
    salvarRef.current = setTimeout(async () => {
      const fracao = fracaoScrollRef.current;
      const pct = Math.max(0, Math.min(100, Math.round(((capituloIdx + fracao) / total) * 100)));
      const concluido = capituloIdx === total - 1 && fracao > 0.95;
      try {
        // padrao-ok: salvar progresso é best-effort — falha não pode derrubar a leitura, mesmo padrão de LeitorPaginado.jsx
        await supabase.from('leitura_progresso').upsert({
          user_id: userId, item_tipo: itemTipo, item_id: String(itemId),
          pagina: capituloIdx + 1, total_paginas: total, pct,
          concluido_em: concluido ? new Date().toISOString() : null,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'user_id,item_tipo,item_id' });
      } catch { /* nunca atrapalha a leitura */ }
    }, 1200);
  }, [capituloIdx, total, itemId, itemTipo, supabase, userId]);

  useEffect(() => { salvarProgresso(); return () => clearTimeout(salvarRef.current); }, [salvarProgresso]);

  function onScrollArea(e) {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    const max = scrollHeight - clientHeight;
    fracaoScrollRef.current = max > 0 ? Math.max(0, Math.min(1, scrollTop / max)) : 1;
    salvarProgresso();
  }

  const irPara = useCallback((n) => setCapituloIdx(Math.min(Math.max(0, n), total - 1)), [total]);
  const proximo = useCallback(() => irPara(capituloIdx + 1), [irPara, capituloIdx]);
  const anterior = useCallback(() => irPara(capituloIdx - 1), [irPara, capituloIdx]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown') proximo();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') anterior();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proximo, anterior, onClose]);

  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = antes; };
  }, []);

  const trocarTema = () => setTema((t) => {
    const prox = ORDEM_TEMA[(ORDEM_TEMA.indexOf(t) + 1) % ORDEM_TEMA.length];
    try { localStorage.setItem('tsn_leitura_tema', prox); } catch { /* noop */ }
    return prox;
  });

  const pct = total ? Math.round(((capituloIdx + 1) / total) * 100) : 0;
  const btn = { background: 'none', border: 'none', color: cor.ui, cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 6 };
  const cap = capitulos[capituloIdx];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 4000, background: cor.fundo, display: 'flex', flexDirection: 'column', overscrollBehavior: 'contain', transition: 'background .25s' }}>

      {/* Barra de cima */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
        background: cor.barra, backdropFilter: 'blur(8px)',
        transform: chrome ? 'translateY(0)' : 'translateY(-110%)', transition: 'transform .22s',
      }}>
        <button onClick={onClose} style={btn} aria-label="Fechar leitor"><X size={20} /></button>
        <div style={{ flex: 1, minWidth: 0, color: cor.ui, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</div>
        <button onClick={() => setFontSize((f) => Math.max(13, f - 1))} style={btn} aria-label="Diminuir fonte"><Minus size={17} /></button>
        <span style={{ color: cor.ui, fontSize: 11.5, minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{fontSize}</span>
        <button onClick={() => setFontSize((f) => Math.min(26, f + 1))} style={btn} aria-label="Aumentar fonte"><Plus size={17} /></button>
        <button onClick={trocarTema} style={btn} aria-label="Tema de leitura">{tema === 'escuro' ? <Sun size={17} /> : <Moon size={17} />}</button>
      </div>

      {/* Área de leitura */}
      <div
        ref={areaRef}
        onScroll={onScrollArea}
        onClick={(e) => { if (e.target === e.currentTarget) setChrome((c) => !c); }}
        style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch',
          display: 'flex', justifyContent: 'center',
          padding: 'calc(58px + env(safe-area-inset-top, 0px)) 16px calc(74px + env(safe-area-inset-bottom, 0px))',
        }}>
        <div style={{ width: '100%', maxWidth: LARGURA_MAX, background: cor.papel, borderRadius: 8, padding: '40px 32px', boxShadow: '0 10px 40px rgba(0,0,0,0.35)', cursor: 'pointer' }}
          onClick={() => setChrome((c) => !c)}>
          {cap ? (
            <>
              <h2 style={{ fontSize: fontSize + 6, fontWeight: 800, color: cor.texto, margin: '0 0 20px', fontFamily: "'Georgia', serif" }}>{cap.titulo}</h2>
              <div style={{ fontSize, color: cor.texto, lineHeight: 1.75, whiteSpace: 'pre-wrap', fontFamily: "'Georgia', 'Times New Roman', serif" }}>
                {cap.conteudo_texto}
              </div>
            </>
          ) : (
            <p style={{ color: cor.texto }}>Capítulo não encontrado.</p>
          )}
        </div>
      </div>

      {/* Setas laterais (desktop) */}
      {chrome && (
        <>
          <button onClick={anterior} disabled={capituloIdx <= 0} aria-label="Capítulo anterior"
            style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
              background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: 999, width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor.ui,
              cursor: capituloIdx <= 0 ? 'default' : 'pointer', opacity: capituloIdx <= 0 ? 0.25 : 1 }}>
            <ChevronLeft size={22} />
          </button>
          <button onClick={proximo} disabled={capituloIdx >= total - 1} aria-label="Próximo capítulo"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
              background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: 999, width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor.ui,
              cursor: capituloIdx >= total - 1 ? 'default' : 'pointer', opacity: capituloIdx >= total - 1 ? 0.25 : 1 }}>
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* Aviso de retomada */}
      {retomado > 0 && (
        <div style={{ position: 'absolute', top: 'calc(58px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)', zIndex: 3,
          padding: '7px 14px', borderRadius: 999, background: 'rgba(13,99,219,0.92)', color: 'white',
          fontSize: 12, fontWeight: 700, pointerEvents: 'none' }}>
          Retomando no capítulo {retomado}
        </div>
      )}

      {/* Barra de baixo: evolução da leitura + navegação explícita de capítulo */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3,
        padding: '10px 16px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        background: cor.barra, backdropFilter: 'blur(8px)',
        transform: chrome ? 'translateY(0)' : 'translateY(110%)', transition: 'transform .22s',
      }}>
        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.16)', overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: '#0D63DB', transition: 'width .25s' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: cor.ui, fontSize: 12 }}>
          <button onClick={anterior} disabled={capituloIdx <= 0} style={{ ...btn, padding: '2px 8px', opacity: capituloIdx <= 0 ? 0.3 : 1 }}>← Anterior</button>
          <span style={{ fontWeight: 700 }}>{total ? `Cap. ${capituloIdx + 1} de ${total} (${pct}%)` : '—'}</span>
          <button onClick={proximo} disabled={capituloIdx >= total - 1} style={{ ...btn, padding: '2px 8px', opacity: capituloIdx >= total - 1 ? 0.3 : 1 }}>Próximo →</button>
        </div>
      </div>
    </div>
  );
}
