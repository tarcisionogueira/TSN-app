import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Minus, Plus, Sun, Moon, ChevronLeft, ChevronRight, Menu } from 'lucide-react';

/**
 * LEITOR DE eBOOK EM FORMATO ESTRUTURADO (docx → capítulos) — irmão do LeitorPaginado
 * (PDF), mesmo "chrome" (overlay fullscreen, 3 temas, mesma chave de localStorage do
 * tema, barra de progresso), mas paginação de TEXTO REAL via CSS multi-coluna: o texto
 * flui e quebra em "páginas" do tamanho exato da tela — sem JS medindo palavra por
 * palavra, sem zoom de imagem. O NÚMERO de páginas por capítulo é sempre recalculado
 * (flutuante) porque depende do tamanho da tela/fonte, nunca fixo (pedido do dono).
 *
 * A técnica (a mesma usada por leitores de EPUB): a caixa de leitura tem largura/altura
 * FIXAS e `overflow:hidden`; o texto por dentro vira uma coluna CSS (`column-width` =
 * a mesma largura da caixa) — o navegador quebra o fluxo em quantas colunas forem
 * necessárias, cada uma do tamanho exato de uma "página". Virar página é só deslizar
 * (`translateX`) por essa fita de colunas; total de páginas = largura total ÷ largura
 * de uma página.
 */

const TEMAS = {
  sepia:  { fundo: '#100e0a', papel: '#fbf3e4', texto: '#2d2416', ui: 'rgba(255,255,255,0.86)', barra: 'rgba(20,18,14,0.92)' },
  claro:  { fundo: '#0f1115', papel: '#ffffff', texto: '#111111', ui: 'rgba(255,255,255,0.86)', barra: 'rgba(15,17,21,0.92)' },
  escuro: { fundo: '#000000', papel: '#1c1c1e', texto: '#e8e0d0', ui: 'rgba(255,255,255,0.78)', barra: 'rgba(0,0,0,0.92)' },
};
const ORDEM_TEMA = ['sepia', 'claro', 'escuro'];
const LARGURA_MAX = 720;      // linha mais longa que isso cansa a leitura
const PAD_H = 36;             // margem lateral da "página" (mesma em toda página, não só na 1ª)
const PAD_V = 44;             // margem superior/inferior da "página"

// Literata (Google Fonts): serifada desenhada especificamente para leitura longa em
// tela (o mesmo propósito da Bookerly do Kindle) — cobre acentuação PT-BR
// integralmente. Injetada sob demanda (só quem abre o leitor baixa a fonte), mesmo
// padrão já usado em outras telas do app (index.html carrega Inter do mesmo jeito).
const FONTE_LEITURA = "'Literata', Georgia, 'Times New Roman', serif";
let fonteInjetada = false;
function garantirFonteLeitura() {
  if (fonteInjetada || typeof document === 'undefined') return;
  fonteInjetada = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;1,7..72,400&display=swap';
  document.head.appendChild(link);
}

export default function LeitorEstruturado({
  capitulos, titulo, onClose,
  itemId, itemTipo = 'ebook', supabase, userId,
}) {
  const [capituloIdx, setCapituloIdx] = useState(0);
  const [paginaAtual, setPaginaAtual] = useState(0);       // página DENTRO do capítulo atual
  const [totalPaginas, setTotalPaginas] = useState(1);     // recalculado a cada render relevante
  const [fontSize, setFontSize] = useState(19);
  const [tema, setTema] = useState(() => { try { return localStorage.getItem('tsn_leitura_tema') || 'sepia'; } catch { return 'sepia'; } });
  const [chrome, setChrome] = useState(true);
  const [menuAberto, setMenuAberto] = useState(false);
  const [retomado, setRetomado] = useState(0);
  const [tamanho, setTamanho] = useState({ w: 800, h: 600 });
  const cor = TEMAS[tema] || TEMAS.sepia;
  const total = capitulos.length;

  const viewportRef = useRef(null);
  const colunaRef = useRef(null);
  const salvarRef = useRef(null);
  const irParaUltimaPaginaRef = useRef(false); // "voltei um capítulo — pousar na ÚLTIMA página dele"

  useEffect(() => { garantirFonteLeitura(); }, []);

  // ── Retoma de onde parou (capítulo — página exata não é portável entre telas) ──
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

  // ── Mede a área de leitura disponível ───────────────────────────────────────
  // clientWidth/clientHeight incluem o padding do próprio viewport (reserva a barra de
  // cima/baixo, que são `position:absolute` — não empurram layout, senão esconder/
  // mostrar a interface repaginaria o livro a cada toque). getComputedStyle resolve o
  // calc()+env(safe-area) pro pixel real, então descontar aqui dá o tamanho de
  // conteúdo exato — sem isso, a "página" ficaria alta/larga demais e entraria por
  // baixo das barras.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const medir = () => {
      const cs = getComputedStyle(el);
      const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const padH = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
      setTamanho({ w: el.clientWidth - padH, h: el.clientHeight - padV });
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const larguraPagina = Math.min(LARGURA_MAX, tamanho.w) - PAD_H * 2;
  const alturaPagina = tamanho.h - PAD_V * 2;

  // ── Repagina sempre que o capítulo, a fonte ou o espaço disponível mudam ──
  useLayoutEffect(() => {
    const el = colunaRef.current;
    if (!el || larguraPagina <= 0 || alturaPagina <= 0) return;
    const n = Math.max(1, Math.round(el.scrollWidth / larguraPagina));
    setTotalPaginas(n);
    if (irParaUltimaPaginaRef.current) {
      setPaginaAtual(n - 1);
      irParaUltimaPaginaRef.current = false;
    } else {
      setPaginaAtual((p) => Math.min(p, n - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capituloIdx, fontSize, larguraPagina, alturaPagina, capitulos[capituloIdx]?.conteudo_texto]);

  // Trocar de capítulo (que não seja via "voltar/avançar página") sempre começa na página 1.
  useEffect(() => { setPaginaAtual(0); }, [capituloIdx]);

  // ── Salva progresso (por capítulo — debounce) ──────────────────────────────
  const salvarProgresso = useCallback(() => {
    if (!itemId || !total || !supabase || !userId) return;
    clearTimeout(salvarRef.current);
    salvarRef.current = setTimeout(async () => {
      const pct = Math.max(0, Math.min(100, Math.round(((capituloIdx + (paginaAtual + 1) / totalPaginas) / total) * 100)));
      try {
        // padrao-ok: salvar progresso é best-effort — falha não pode derrubar a leitura, mesmo padrão de LeitorPaginado.jsx
        await supabase.from('leitura_progresso').upsert({
          user_id: userId, item_tipo: itemTipo, item_id: String(itemId),
          pagina: capituloIdx + 1, total_paginas: total, pct,
          concluido_em: (capituloIdx === total - 1 && paginaAtual === totalPaginas - 1) ? new Date().toISOString() : null,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'user_id,item_tipo,item_id' });
      } catch { /* nunca atrapalha a leitura */ }
    }, 1200);
  }, [capituloIdx, paginaAtual, totalPaginas, total, itemId, itemTipo, supabase, userId]);

  useEffect(() => { salvarProgresso(); return () => clearTimeout(salvarRef.current); }, [salvarProgresso]);

  const proxima = useCallback(() => {
    if (paginaAtual < totalPaginas - 1) { setPaginaAtual((p) => p + 1); return; }
    if (capituloIdx < total - 1) setCapituloIdx((c) => c + 1); // página 1 do próximo — natural, sem precisar medi-lo antes
  }, [paginaAtual, totalPaginas, capituloIdx, total]);

  const anterior = useCallback(() => {
    if (paginaAtual > 0) { setPaginaAtual((p) => p - 1); return; }
    if (capituloIdx > 0) { irParaUltimaPaginaRef.current = true; setCapituloIdx((c) => c - 1); }
  }, [paginaAtual, capituloIdx]);

  function irParaCapitulo(idx) {
    setCapituloIdx(idx);
    setMenuAberto(false);
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { menuAberto ? setMenuAberto(false) : onClose?.(); return; }
      if (menuAberto) return; // menu de capítulos aberto: não vira página escondido atrás dele
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); proxima(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); anterior(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proxima, anterior, onClose, menuAberto]);

  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = antes; };
  }, []);

  // Toque: terço esquerdo/direito vira página (é o gesto padrão de e-reader); meio esconde/mostra a interface.
  const onTapArea = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < r.width * 0.3) anterior();
    else if (x > r.width * 0.7) proxima();
    else setChrome((c) => !c);
  };

  const trocarTema = () => setTema((t) => {
    const prox = ORDEM_TEMA[(ORDEM_TEMA.indexOf(t) + 1) % ORDEM_TEMA.length];
    try { localStorage.setItem('tsn_leitura_tema', prox); } catch { /* noop */ }
    return prox;
  });

  const pctCapitulo = total ? Math.round(((capituloIdx + 1) / total) * 100) : 0;
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
        <button onClick={() => setMenuAberto((m) => !m)} style={btn} aria-label="Capítulos"><Menu size={19} /></button>
        <div style={{ flex: 1, minWidth: 0, color: cor.ui, fontSize: 13.5, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</div>
        <button onClick={() => setFontSize((f) => Math.max(14, f - 1))} style={btn} aria-label="Diminuir fonte"><Minus size={17} /></button>
        <span style={{ color: cor.ui, fontSize: 11.5, minWidth: 20, textAlign: 'center', fontWeight: 700 }}>{fontSize}</span>
        <button onClick={() => setFontSize((f) => Math.min(28, f + 1))} style={btn} aria-label="Aumentar fonte"><Plus size={17} /></button>
        <button onClick={trocarTema} style={btn} aria-label="Tema de leitura">{tema === 'escuro' ? <Sun size={17} /> : <Moon size={17} />}</button>
      </div>

      {/* Menu de capítulos (sobrepõe, some ao escolher um) */}
      {menuAberto && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(0,0,0,0.55)', display: 'flex', justifyContent: 'flex-start' }}
          onClick={(e) => { if (e.target === e.currentTarget) setMenuAberto(false); }}>
          <div style={{ width: 'min(320px, 84vw)', height: '100%', background: cor.papel, overflowY: 'auto', padding: '24px 16px', paddingTop: 'calc(24px + env(safe-area-inset-top, 0px))' }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15, fontWeight: 800, color: cor.texto }}>Capítulos</h3>
            {capitulos.map((c, i) => (
              <button key={i} onClick={() => irParaCapitulo(i)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 10px', borderRadius: 8, border: 'none', cursor: 'pointer', marginBottom: 2, background: i === capituloIdx ? 'rgba(13,99,219,0.12)' : 'transparent', color: i === capituloIdx ? '#0D63DB' : cor.texto, fontSize: 13.5, fontWeight: i === capituloIdx ? 700 : 400 }}>
                {i + 1}. {c.titulo || '(sem título)'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Área da página — tamanho FIXO, sem rolagem; o texto vira colunas do tamanho da página */}
      <div ref={viewportRef} onClick={onTapArea} style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'calc(58px + env(safe-area-inset-top, 0px)) 0 calc(58px + env(safe-area-inset-bottom, 0px))',
        cursor: 'pointer', userSelect: 'none',
      }}>
        {cap && larguraPagina > 0 && (
          <div style={{ width: larguraPagina + PAD_H * 2, height: alturaPagina + PAD_V * 2, overflow: 'hidden', position: 'relative', background: cor.papel, borderRadius: 6, boxShadow: '0 10px 40px rgba(0,0,0,0.35)' }}>
            <div ref={colunaRef} style={{
              position: 'absolute', top: PAD_V, left: PAD_H,
              width: larguraPagina, height: alturaPagina,
              columnWidth: larguraPagina, columnGap: 0, columnFill: 'auto',
              transform: `translateX(-${paginaAtual * larguraPagina}px)`, transition: 'transform .3s ease',
              fontSize, color: cor.texto, lineHeight: 1.7, fontFamily: FONTE_LEITURA, whiteSpace: 'pre-wrap',
            }}>
              <h2 style={{ fontSize: fontSize + 6, fontWeight: 700, margin: '0 0 18px', breakAfter: 'avoid' }}>{cap.titulo}</h2>
              {cap.conteudo_texto}
            </div>
          </div>
        )}
      </div>

      {/* Setas laterais (desktop) */}
      {chrome && (
        <>
          <button onClick={anterior} disabled={paginaAtual === 0 && capituloIdx === 0} aria-label="Página anterior"
            style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
              background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: 999, width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor.ui,
              cursor: (paginaAtual === 0 && capituloIdx === 0) ? 'default' : 'pointer', opacity: (paginaAtual === 0 && capituloIdx === 0) ? 0.25 : 1 }}>
            <ChevronLeft size={22} />
          </button>
          <button onClick={proxima} disabled={paginaAtual === totalPaginas - 1 && capituloIdx === total - 1} aria-label="Próxima página"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
              background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: 999, width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor.ui,
              cursor: (paginaAtual === totalPaginas - 1 && capituloIdx === total - 1) ? 'default' : 'pointer', opacity: (paginaAtual === totalPaginas - 1 && capituloIdx === total - 1) ? 0.25 : 1 }}>
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

      {/* Barra de baixo: capítulo + página dentro do capítulo (o total de páginas é flutuante, recalculado a cada tela/fonte) */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 3,
        padding: '10px 16px', paddingBottom: 'calc(10px + env(safe-area-inset-bottom, 0px))',
        background: cor.barra, backdropFilter: 'blur(8px)',
        transform: chrome ? 'translateY(0)' : 'translateY(110%)', transition: 'transform .22s',
      }}>
        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.16)', overflow: 'hidden', marginBottom: 8 }}>
          <div style={{ height: '100%', width: `${pctCapitulo}%`, background: '#0D63DB', transition: 'width .25s' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: cor.ui, fontSize: 12 }}>
          <span style={{ fontWeight: 700 }}>Capítulo {capituloIdx + 1} de {total}</span>
          <span style={{ opacity: 0.75 }}>Página {paginaAtual + 1} de {totalPaginas}</span>
        </div>
      </div>
    </div>
  );
}
