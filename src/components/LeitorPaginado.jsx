import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Download, ChevronLeft, ChevronRight, Minus, Plus, Sun, Moon, Loader, ArrowDown } from 'lucide-react';
import { getPdfjs } from '../utils/pdfjs';

/**
 * LEITOR DE eBOOK PAGINADO — o comportamento de leitor dedicado que o dono pediu:
 * "escurece o entorno, aparece UMA página por vez redimensionada para conseguir ler; se a tela
 *  for pequena e a página grande, recorta a página permitindo deslizar para baixo para terminar
 *  a página, e permite virar a página com um toque contabilizando a evolução da leitura."
 *
 * Cada uma dessas frases virou uma decisão explícita aqui:
 *
 * • ESCURECE O ENTORNO → overlay `fixed inset:0` por cima de TUDO (menu, header, breadcrumb).
 *   Antes o PDF era uma coluna rolável dentro do app, com a navegação toda em volta puxando a
 *   atenção. Leitura é modo, não é uma seção da tela.
 *
 * • UMA PÁGINA POR VEZ, REDIMENSIONADA → renderiza SÓ a página atual, escalada para caber na
 *   LARGURA disponível. Isso é o que faz o texto ficar legível sem zoom no celular.
 *
 * • TELA PEQUENA + PÁGINA GRANDE → quando a altura renderizada passa da tela, o container da
 *   página rola na VERTICAL (a página não é espremida — texto espremido é ilegível) e uma seta
 *   discreta avisa que ainda falta conteúdo abaixo. Ao virar, volta ao topo, como no Kindle.
 *
 * • VIRAR COM UM TOQUE → zonas de toque (terço esquerdo/direito), arrasto horizontal, setas do
 *   teclado e os botões. O toque só conta como toque se o dedo não ARRASTOU (< 10px) e foi
 *   rápido (< 400ms) — senão, rolar a página para ler viraria virada de página acidental, que é
 *   o jeito mais rápido de irritar quem está lendo.
 *
 * • CONTABILIZANDO A EVOLUÇÃO → barra de progresso + "pág. X de Y (N%)", salvo na CONTA
 *   (`leitura_progresso`) e espelhado no localStorage. Reabrir retoma de onde parou, inclusive
 *   em outro aparelho.
 *
 * Não bloqueia leitura por causa de progresso: se o banco falhar, o localStorage segura e a
 * leitura continua. Observabilidade nunca atrapalha a coisa observada.
 */

const TEMAS = {
  sepia:  { fundo: '#100e0a', papel: '#fbf3e4', ui: 'rgba(255,255,255,0.86)', barra: 'rgba(20,18,14,0.92)' },
  claro:  { fundo: '#0f1115', papel: '#ffffff', ui: 'rgba(255,255,255,0.86)', barra: 'rgba(15,17,21,0.92)' },
  escuro: { fundo: '#000000', papel: '#1c1c1e', ui: 'rgba(255,255,255,0.78)', barra: 'rgba(0,0,0,0.92)' },
};
const ORDEM_TEMA = ['sepia', 'claro', 'escuro'];
const LARGURA_MAX = 900;   // além disso a linha fica longa demais para leitura confortável

const chaveLocal = (itemId) => `tsn_leitura_${itemId}`;

export default function LeitorPaginado({
  url, titulo, baixarUrl, onClose,
  itemId, itemTipo = 'ebook', supabase, userId,
}) {
  const [status, setStatus] = useState('loading');   // loading | ready | error
  const [numPages, setNumPages] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [tema, setTema] = useState(() => localStorage.getItem('tsn_leitura_tema') || 'sepia');
  const [chrome, setChrome] = useState(true);        // barras visíveis
  const [temMais, setTemMais] = useState(false);     // ainda há página abaixo da dobra
  const [retomado, setRetomado] = useState(0);       // página retomada (para o aviso)

  const pdfRef = useRef(null);
  const areaRef = useRef(null);      // container que rola na vertical
  const canvasRef = useRef(null);
  const renderRef = useRef(null);
  const gesto = useRef(null);
  const salvarRef = useRef(null);
  const cor = TEMAS[tema] || TEMAS.sepia;

  // ── Abre o documento ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!url) return;
    let cancel = false;
    setStatus('loading');
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const pdf = await pdfjs.getDocument({ url }).promise;
        if (cancel) { try { pdf.destroy(); } catch { /* noop */ } return; }
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setStatus('ready');
      } catch { if (!cancel) setStatus('error'); }
    })();
    return () => {
      cancel = true;
      if (pdfRef.current) { try { pdfRef.current.destroy(); } catch { /* noop */ } pdfRef.current = null; }
    };
  }, [url]);

  // ── Retoma de onde parou (banco primeiro, localStorage como rede) ──────────
  useEffect(() => {
    if (!itemId || !numPages) return;
    let cancel = false;
    (async () => {
      let salva = 0;
      try { salva = Number(localStorage.getItem(chaveLocal(itemId))) || 0; } catch { /* noop */ }
      if (supabase && userId) {
        try {
          const { data } = await supabase.from('leitura_progresso')
            .select('pagina').eq('user_id', userId).eq('item_tipo', itemTipo).eq('item_id', String(itemId)).maybeSingle();
          if (Number(data?.pagina) > 0) salva = Number(data.pagina);   // a conta manda no aparelho
        } catch { /* segue com o local */ }
      }
      if (cancel) return;
      const alvo = Math.min(Math.max(1, salva), numPages);
      if (alvo > 1) { setPagina(alvo); setRetomado(alvo); setTimeout(() => setRetomado(0), 4000); }
    })();
    return () => { cancel = true; };
  }, [itemId, itemTipo, numPages, supabase, userId]);

  // ── Renderiza a PÁGINA ATUAL, ajustada à largura ──────────────────────────
  const desenhar = useCallback(async () => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    const area = areaRef.current;
    if (!pdf || !canvas || !area || !numPages) return;
    try { renderRef.current?.cancel(); } catch { /* render anterior */ }
    try {
      const page = await pdf.getPage(Math.min(Math.max(1, pagina), numPages));
      const larguraUtil = Math.min(area.clientWidth - 24, LARGURA_MAX);
      const base = page.getViewport({ scale: 1 });
      const escala = (larguraUtil / base.width) * zoom;
      const viewport = page.getViewport({ scale: escala });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);   // teto no dpr: 3x em canvas grande come memória no celular
      const ctx = canvas.getContext('2d');
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      renderRef.current = page.render({
        canvasContext: ctx, viewport,
        transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
      });
      await renderRef.current.promise;
      // Página nova SEMPRE começa do topo — é o que o olho espera ao virar.
      area.scrollTop = 0;
      setTemMais(area.scrollHeight - area.clientHeight > 8);
      // Aquece a próxima: virar a página fica instantâneo em vez de piscar em branco.
      if (pagina < numPages) { try { pdf.getPage(pagina + 1); } catch { /* noop */ } }
    } catch { /* cancelamento de render — normal ao virar rápido */ }
  }, [pagina, zoom, numPages]);

  useEffect(() => { desenhar(); }, [desenhar]);

  // Redimensionar/girar o aparelho re-renderiza na nova largura (debounce curto).
  useEffect(() => {
    let t = null;
    const onResize = () => { clearTimeout(t); t = setTimeout(desenhar, 150); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); window.removeEventListener('orientationchange', onResize); };
  }, [desenhar]);

  // ── Salva o progresso (debounce: virar 10 páginas seguidas não vira 10 writes) ──
  useEffect(() => {
    if (!itemId || !numPages || status !== 'ready') return;
    try { localStorage.setItem(chaveLocal(itemId), String(pagina)); } catch { /* cota cheia */ }
    if (!supabase || !userId) return;
    clearTimeout(salvarRef.current);
    salvarRef.current = setTimeout(async () => {
      const pct = Math.round((pagina / numPages) * 100);
      try {
        await supabase.from('leitura_progresso').upsert({
          user_id: userId, item_tipo: itemTipo, item_id: String(itemId),
          pagina, total_paginas: numPages, pct,
          concluido_em: pagina >= numPages ? new Date().toISOString() : null,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'user_id,item_tipo,item_id' });
      } catch { /* nunca atrapalha a leitura */ }
    }, 1200);
    return () => clearTimeout(salvarRef.current);
  }, [pagina, numPages, itemId, itemTipo, supabase, userId, status]);

  // ── Navegação ─────────────────────────────────────────────────────────────
  const irPara = useCallback((n) => setPagina((p) => {
    const alvo = Math.min(Math.max(1, n), numPages || 1);
    return alvo === p ? p : alvo;
  }), [numPages]);
  const proxima = useCallback(() => irPara(pagina + 1), [irPara, pagina]);
  const anterior = useCallback(() => irPara(pagina - 1), [irPara, pagina]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); proxima(); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); anterior(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [proxima, anterior, onClose]);

  // Trava a rolagem da página de trás enquanto o leitor está aberto (senão o body
  // rola por baixo do overlay no celular e a leitura "escorrega").
  useEffect(() => {
    const antes = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = antes; };
  }, []);

  // TOQUE vs ARRASTO: só vira a página quem tocou (pouco movimento, pouco tempo). Quem
  // arrastou estava rolando a página para terminar de ler — virar ali seria roubar a leitura.
  const onPointerDown = (e) => {
    gesto.current = { x: e.clientX, y: e.clientY, t: Date.now(), alvo: e.currentTarget };
  };
  const onPointerUp = (e) => {
    const g = gesto.current; gesto.current = null;
    if (!g) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y, dt = Date.now() - g.t;
    // Arrasto horizontal decidido = virada (gesto natural de quem já leu em app de leitura).
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { dx < 0 ? proxima() : anterior(); return; }
    if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || dt > 400) return;   // foi rolagem, não toque
    const largura = g.alvo?.clientWidth || window.innerWidth;
    const x = e.clientX - (g.alvo?.getBoundingClientRect().left || 0);
    if (x < largura * 0.3) anterior();
    else if (x > largura * 0.7) proxima();
    else setChrome((c) => !c);     // toque no meio: some/volta a interface, como no Kindle
  };

  const trocarTema = () => setTema((t) => {
    const prox = ORDEM_TEMA[(ORDEM_TEMA.indexOf(t) + 1) % ORDEM_TEMA.length];
    try { localStorage.setItem('tsn_leitura_tema', prox); } catch { /* noop */ }
    return prox;
  });

  const pct = numPages ? Math.round((pagina / numPages) * 100) : 0;
  const btn = { background: 'none', border: 'none', color: cor.ui, cursor: 'pointer', display: 'flex', alignItems: 'center', padding: 6 };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 4000, background: cor.fundo,
      display: 'flex', flexDirection: 'column', overscrollBehavior: 'contain',
      transition: 'background .25s',
    }}>
      {/* ── Barra de cima (some ao tocar no meio) ── */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3,
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px', paddingTop: 'calc(10px + env(safe-area-inset-top, 0px))',
        background: cor.barra, backdropFilter: 'blur(8px)',
        transform: chrome ? 'translateY(0)' : 'translateY(-110%)', transition: 'transform .22s',
      }}>
        <button onClick={onClose} style={btn} aria-label="Fechar leitor"><X size={20} /></button>
        <div style={{ flex: 1, minWidth: 0, color: cor.ui, fontSize: 13.5, fontWeight: 700,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</div>
        <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.15).toFixed(2)))} style={btn} aria-label="Diminuir"><Minus size={17} /></button>
        <span style={{ color: cor.ui, fontSize: 11.5, minWidth: 34, textAlign: 'center', fontWeight: 700 }}>{Math.round(zoom * 100)}%</span>
        <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))} style={btn} aria-label="Aumentar"><Plus size={17} /></button>
        <button onClick={trocarTema} style={btn} aria-label="Tema de leitura">{tema === 'escuro' ? <Sun size={17} /> : <Moon size={17} />}</button>
        {baixarUrl && (
          <a href={baixarUrl} download target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none' }} aria-label="Baixar PDF">
            <Download size={17} />
          </a>
        )}
      </div>

      {/* ── Área da página: rola na VERTICAL quando a página não cabe na tela ── */}
      <div
        ref={areaRef}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onScroll={(e) => setTemMais(e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight > 24)}
        style={{
          flex: 1, overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch',
          display: 'flex', justifyContent: 'center', alignItems: 'flex-start',
          // As barras são ABSOLUTAS por cima da área e crescem com o notch/indicador do
          // iPhone (env(safe-area-inset-*)); o espaço reservado aqui precisa crescer JUNTO.
          // Com 58px fixos, a barra de cima (58 + ~59 de notch) cobria o TOPO da página —
          // e scrollTop 0 não alcança o que está atrás de um overlay (achado do dono 03/08:
          // "o leitor deixou a página do livro cortada").
          padding: 'calc(58px + env(safe-area-inset-top, 0px)) 12px calc(74px + env(safe-area-inset-bottom, 0px))',
          touchAction: 'pan-y', cursor: 'pointer', userSelect: 'none',
        }}>

        {status === 'loading' && (
          <div style={{ margin: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, color: cor.ui }}>
            <Loader size={26} style={{ animation: 'girar 1s linear infinite' }} />
            <span style={{ fontSize: 13.5 }}>Abrindo o livro…</span>
            <style>{`@keyframes girar{to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {status === 'error' && (
          <div style={{ margin: 'auto', textAlign: 'center', color: cor.ui, maxWidth: 360, padding: 20 }}>
            <div style={{ fontSize: 38, marginBottom: 12 }}>📄</div>
            <p style={{ fontSize: 14.5, lineHeight: 1.6, margin: '0 0 18px' }}>
              Não foi possível abrir este arquivo aqui. Você pode baixá-lo e ler no seu leitor de PDF.
            </p>
            {baixarUrl && (
              <a href={baixarUrl} download target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 22px', background: '#0D63DB', color: 'white', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
                <Download size={16} /> Baixar PDF
              </a>
            )}
          </div>
        )}

        <canvas ref={canvasRef} style={{
          display: status === 'ready' ? 'block' : 'none', maxWidth: '100%',
          borderRadius: 3, background: cor.papel,
          boxShadow: '0 10px 40px rgba(0,0,0,0.55)',
        }} />
      </div>

      {/* Setas laterais (desktop) — no celular o toque/arrasto já resolve */}
      {status === 'ready' && chrome && (
        <>
          <button onClick={anterior} disabled={pagina <= 1} aria-label="Página anterior"
            style={{ position: 'absolute', left: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
              background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: 999, width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor.ui,
              cursor: pagina <= 1 ? 'default' : 'pointer', opacity: pagina <= 1 ? 0.25 : 1 }}>
            <ChevronLeft size={22} />
          </button>
          <button onClick={proxima} disabled={pagina >= numPages} aria-label="Próxima página"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', zIndex: 2,
              background: 'rgba(0,0,0,0.35)', border: 'none', borderRadius: 999, width: 40, height: 40,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: cor.ui,
              cursor: pagina >= numPages ? 'default' : 'pointer', opacity: pagina >= numPages ? 0.25 : 1 }}>
            <ChevronRight size={22} />
          </button>
        </>
      )}

      {/* "Ainda tem página abaixo" — o aviso que evita a pessoa virar sem ter lido o fim */}
      {status === 'ready' && temMais && (
        <div style={{ position: 'absolute', bottom: 'calc(78px + env(safe-area-inset-bottom, 0px))', left: '50%', transform: 'translateX(-50%)', zIndex: 2,
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
          background: 'rgba(0,0,0,0.45)', color: cor.ui, fontSize: 11.5, fontWeight: 600, pointerEvents: 'none' }}>
          <ArrowDown size={13} /> deslize para ver o resto da página
        </div>
      )}

      {/* Aviso de retomada */}
      {retomado > 0 && (
        <div style={{ position: 'absolute', top: 'calc(58px + env(safe-area-inset-top, 0px))', left: '50%', transform: 'translateX(-50%)', zIndex: 3,
          padding: '7px 14px', borderRadius: 999, background: 'rgba(13,99,219,0.92)', color: 'white',
          fontSize: 12, fontWeight: 700, pointerEvents: 'none' }}>
          Retomando na página {retomado}
        </div>
      )}

      {/* ── Barra de baixo: a evolução da leitura ── */}
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
          <span style={{ fontWeight: 700 }}>{numPages ? `Pág. ${pagina} de ${numPages}` : '—'}</span>
          <span style={{ opacity: 0.65 }}>{pct}% lido</span>
        </div>
      </div>
    </div>
  );
}
