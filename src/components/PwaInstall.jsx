import { useEffect, useState } from 'react';

// Banner de instalação do PWA (Etapa 1). Aparece só quando faz sentido:
//  • Android/Chrome/Edge: captura o evento `beforeinstallprompt` e mostra "Instalar app"
//    (o clique dispara o prompt nativo de instalação).
//  • iOS/Safari: não há prompt programático → mostra a instrução manual "Compartilhar →
//    Adicionar à Tela de Início" (é o que destrava, inclusive, o push no iPhone).
//  • Se já está instalado (display-mode: standalone) ou o usuário dispensou, não aparece.
const DISPENSADO = 'bidpro_pwa_dispensado';

function ehStandalone() {
  return window.matchMedia?.('(display-mode: standalone)')?.matches
    || window.navigator.standalone === true;
}
function ehIOS() {
  const ua = window.navigator.userAgent || '';
  const iOS = /iphone|ipad|ipod/i.test(ua)
    || (/Macintosh/.test(ua) && 'ontouchend' in document); // iPad iPadOS se passa por Mac
  const safari = /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  return iOS && safari;
}

export default function PwaInstall() {
  const [prompt, setPrompt] = useState(null); // evento beforeinstallprompt (Android/desktop)
  const [iosAberto, setIosAberto] = useState(false);
  const [visivel, setVisivel] = useState(false);

  useEffect(() => {
    if (ehStandalone()) return;
    if (localStorage.getItem(DISPENSADO) === '1') return;

    const onPrompt = (e) => { e.preventDefault(); setPrompt(e); setVisivel(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const onInstalled = () => { setVisivel(false); setPrompt(null);
      try { localStorage.setItem(DISPENSADO, '1'); } catch { /* ok */ } };
    window.addEventListener('appinstalled', onInstalled);

    // iOS Safari não dispara beforeinstallprompt — oferece a instrução manual.
    if (ehIOS()) setVisivel(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (!visivel) return null;

  const dispensar = () => {
    setVisivel(false);
    try { localStorage.setItem(DISPENSADO, '1'); } catch { /* ok */ }
  };

  const instalar = async () => {
    if (prompt) {
      prompt.prompt();
      try { await prompt.userChoice; } catch { /* ok */ }
      setPrompt(null); setVisivel(false);
    } else {
      setIosAberto(true); // sem prompt nativo (iOS) → mostra o passo a passo
    }
  };

  return (
    <div style={{ position: 'fixed', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom))',
      zIndex: 9999, maxWidth: 440, margin: '0 auto', background: '#111111', color: '#fff',
      borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,0.28)', padding: '14px 16px',
      fontFamily: "'Inter', sans-serif" }}>
      {!iosAberto ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/favicon-192.png" alt="BidPro" width={40} height={40} style={{ borderRadius: 9, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, lineHeight: 1.2 }}>Instalar o app BidPro</div>
            <div style={{ fontSize: 12.5, opacity: 0.8, lineHeight: 1.35 }}>Acesso rápido na tela inicial e notificações de novos imóveis.</div>
          </div>
          <button onClick={instalar} style={{ background: '#0D63DB', color: '#fff', border: 'none',
            borderRadius: 9, padding: '9px 14px', fontWeight: 700, fontSize: 14, cursor: 'pointer', flexShrink: 0 }}>
            Instalar
          </button>
          <button onClick={dispensar} aria-label="Dispensar" style={{ background: 'transparent', color: '#fff',
            border: 'none', fontSize: 20, lineHeight: 1, cursor: 'pointer', opacity: 0.6, padding: 4, flexShrink: 0 }}>
            ×
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6 }}>Adicionar à Tela de Início</div>
          <div style={{ opacity: 0.9 }}>
            1. Toque no botão <b>Compartilhar</b> (o quadrado com a seta para cima), na barra do Safari.<br />
            2. Escolha <b>Adicionar à Tela de Início</b>.<br />
            3. Confirme em <b>Adicionar</b>. Pronto — o BidPro abre como app e libera as notificações.
          </div>
          <div style={{ textAlign: 'right', marginTop: 10 }}>
            <button onClick={dispensar} style={{ background: '#0D63DB', color: '#fff', border: 'none',
              borderRadius: 9, padding: '8px 16px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Entendi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
