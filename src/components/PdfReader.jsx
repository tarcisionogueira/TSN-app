import React, { useEffect, useRef, useState } from 'react';
import { Plus, Minus, ExternalLink, Download, Loader } from 'lucide-react';
// pdf.worker como ASSET (URL) — não puxa a lib principal para o bundle inicial.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Leitor de PDF ROBUSTO (pdf.js). Por que não <iframe>: o Chrome/Safari MOBILE
// (e o PWA) NÃO renderizam PDF embutido em iframe — e uma URL assinada com
// disposição "attachment" (scope=download) dentro de um iframe com sandbox é
// BLOQUEADA ("Este conteúdo está bloqueado"). Aqui BUSCAMOS os bytes (fetch/CORS,
// disposição é irrelevante para fetch) e desenhamos em <canvas> → funciona em
// desktop e mobile/PWA igualmente, sem re-assinar a URL.
let _pdfjs = null;
async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  const pdfjs = await import('pdfjs-dist');          // lazy: só carrega ao ler
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  _pdfjs = pdfjs;
  return pdfjs;
}

// Desenha UMA página em canvas, ajustada à largura do container × zoom.
function PdfPage({ pdf, pageNum, zoom, containerRef }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    let cancelled = false;
    let task = null;
    (async () => {
      try {
        const page = await pdf.getPage(pageNum);
        if (cancelled) return;
        const containerW = Math.min((containerRef.current?.clientWidth || 800) - 24, 900);
        const base = page.getViewport({ scale: 1 });
        const fit = containerW / base.width;                 // caber na largura
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: fit * zoom });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        task = page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        await task.promise;
      } catch { /* cancelamento/render — ignora */ }
    })();
    return () => { cancelled = true; try { task?.cancel(); } catch { /* noop */ } };
  }, [pdf, pageNum, zoom, containerRef]);

  return (
    <canvas ref={canvasRef}
      style={{ display: 'block', margin: '0 auto 16px', maxWidth: '100%',
        boxShadow: '0 2px 14px rgba(0,0,0,0.18)', borderRadius: 4, background: '#fff' }} />
  );
}

export default function PdfReader({ url, baixarUrl, paper }) {
  const [status, setStatus] = useState('loading');   // loading | ready | error
  const [pages, setPages] = useState([]);
  const [zoom, setZoom] = useState(1);
  const pdfRef = useRef(null);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!url) return;
    let cancel = false;
    setStatus('loading'); setPages([]);
    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const pdf = await pdfjs.getDocument({ url }).promise;
        if (cancel) { try { pdf.destroy(); } catch { /* noop */ } return; }
        pdfRef.current = pdf;
        setPages(Array.from({ length: pdf.numPages }, (_, i) => i + 1));
        setStatus('ready');
      } catch {
        if (!cancel) setStatus('error');
      }
    })();
    return () => {
      cancel = true;
      if (pdfRef.current) { try { pdfRef.current.destroy(); } catch { /* noop */ } pdfRef.current = null; }
    };
  }, [url]);

  return (
    <div ref={wrapRef}
      style={{ position: 'relative', width: '100%', minHeight: '70vh', height: 'calc(100vh - 130px)',
        overflow: 'auto', background: paper || '#f5f0e8', padding: '16px 12px 60px' }}>

      {status === 'loading' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, minHeight: '50vh', color: '#94a3b8' }}>
          <Loader size={28} style={{ animation: 'spin 1s linear infinite' }} />
          <span style={{ fontSize: 14 }}>Carregando PDF…</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {status === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, minHeight: '50vh', textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 40 }}>📄</div>
          <p style={{ color: '#475569', fontSize: 15, maxWidth: 380, lineHeight: 1.6, margin: 0 }}>
            Não foi possível exibir o PDF aqui. Abra em uma nova aba ou baixe o arquivo.
          </p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <a href={url} target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 22px', background: '#0D63DB', color: 'white', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
              <ExternalLink size={16} /> Abrir em nova aba
            </a>
            <a href={baixarUrl || url} download target="_blank" rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '11px 22px', background: 'white', color: '#111', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none' }}>
              <Download size={16} /> Baixar
            </a>
          </div>
        </div>
      )}

      {status === 'ready' && pages.map((n) => (
        <PdfPage key={n} pdf={pdfRef.current} pageNum={n} zoom={zoom} containerRef={wrapRef} />
      ))}

      {status === 'ready' && (
        <div style={{ position: 'sticky', bottom: 12, display: 'flex', justifyContent: 'center', gap: 8, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(17,17,17,0.85)', borderRadius: 999, padding: '6px 8px', pointerEvents: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
            <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.15).toFixed(2)))}
              style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', padding: 6 }}>
              <Minus size={16} />
            </button>
            <span style={{ color: 'white', fontSize: 12, minWidth: 40, textAlign: 'center', fontWeight: 700 }}>{Math.round(zoom * 100)}%</span>
            <button onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))}
              style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', padding: 6 }}>
              <Plus size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
