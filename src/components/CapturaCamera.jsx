import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, X, RefreshCw } from 'lucide-react';

/**
 * CAPTURA PELA CÂMERA — de verdade, no computador também.
 *
 * POR QUE EXISTE (08/08): o botão "Tirar agora (câmera)" era um `<input type="file"
 * capture="user">`. No CELULAR isso abre a câmera; no COMPUTADOR o atributo `capture` é
 * simplesmente IGNORADO pelo navegador e abre o seletor de arquivos. O dono clicou em
 * "tirar foto", tinha webcam, e caiu no explorador de arquivos — com razão achou que era bug.
 *
 * A única forma de abrir a câmera no desktop é `getUserMedia`. É o que este componente faz:
 * mostra o vídeo ao vivo, a pessoa enquadra o rosto e captura; o quadro vira um File igual ao
 * que o `<input>` entregaria, então o resto do fluxo (upload + face match) não muda em nada.
 *
 * Degrada com honestidade: se não houver câmera, se a permissão for negada ou se o navegador
 * não suportar, o componente DIZ o motivo e oferece o caminho de arquivo — em vez de abrir um
 * seletor de arquivos fingindo que é a câmera, que foi o problema original.
 */
export default function CapturaCamera({ aberto, onFechar, onCapturar, titulo = 'Tirar selfie' }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState(false);

  const encerrar = useCallback(() => {
    try { streamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch { /* já parado */ }
    streamRef.current = null;
    setPronto(false);
  }, []);

  useEffect(() => {
    if (!aberto) { encerrar(); return undefined; }
    let vivo = true;
    setErro(''); setPronto(false);

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErro('Este navegador não permite abrir a câmera. Use "Escolher uma foto".');
        return;
      }
      try {
        // `facingMode: user` é a câmera frontal no celular e a webcam no computador.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (!vivo) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPronto(true);
      } catch (e) {
        // Motivo NA TELA: "não abriu" sem explicação faz a pessoa clicar de novo à toa.
        const nome = e?.name || '';
        setErro(
          nome === 'NotAllowedError' ? 'Permissão de câmera negada. Libere no cadeado da barra de endereço e tente de novo — ou use "Escolher uma foto".'
          : nome === 'NotFoundError' ? 'Não encontrei nenhuma câmera neste dispositivo. Use "Escolher uma foto" ou o QR code do celular.'
          : nome === 'NotReadableError' ? 'A câmera está em uso por outro programa. Feche o outro aplicativo e tente de novo.'
          : `Não consegui abrir a câmera (${nome || 'erro desconhecido'}). Use "Escolher uma foto".`
        );
      }
    })();

    return () => { vivo = false; encerrar(); };
  }, [aberto, encerrar]);

  function capturar() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) { setErro('Não consegui gerar a foto. Tente novamente.'); return; }
      const file = new File([blob], `selfie-${Date.now()}.jpg`, { type: 'image/jpeg' });
      encerrar();
      onCapturar?.(file);
    }, 'image/jpeg', 0.92);
  }

  if (!aberto) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(15,23,42,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 18, width: '100%', maxWidth: 520, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <strong style={{ fontSize: 15, color: '#111' }}>{titulo}</strong>
          <button onClick={() => { encerrar(); onFechar?.(); }} aria-label="Fechar"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {erro ? (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#b91c1c', lineHeight: 1.6 }}>
            {erro}
          </div>
        ) : (
          <>
            <div style={{ background: '#0f172a', borderRadius: 12, overflow: 'hidden', aspectRatio: '4 / 3', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* espelhado: a pessoa se enquadra como num espelho, que é o esperado */}
              <video ref={videoRef} playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
            </div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '10px 0 0', lineHeight: 1.6 }}>
              Enquadre o <strong>rosto inteiro</strong>, com boa luz e sem óculos escuros ou boné. A comparação com a foto do documento é automática.
            </p>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
          <button onClick={() => { encerrar(); onFechar?.(); }}
            style={{ padding: '10px 16px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10, fontWeight: 700, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
            Cancelar
          </button>
          {!erro && (
            <button onClick={capturar} disabled={!pronto}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 20px', background: pronto ? '#0D63DB' : '#94a3b8', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: pronto ? 'pointer' : 'default' }}>
              {pronto ? <><Camera size={16} /> Capturar</> : <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> Abrindo…</>}
            </button>
          )}
        </div>
        <style>{'@keyframes spin { to { transform: rotate(360deg); } }'}</style>
      </div>
    </div>
  );
}
