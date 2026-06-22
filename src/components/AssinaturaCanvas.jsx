import React, { useRef, useState, useEffect } from 'react';
import { Eraser, Check } from 'lucide-react';

// Captura a assinatura do cliente diretamente na tela (mouse ou toque),
// sem nenhuma dependência externa. Exporta a imagem em PNG (base64).
export default function AssinaturaCanvas({ onChange, altura = 180 }) {
  const canvasRef = useRef(null);
  const desenhando = useRef(false);
  const ultimo = useRef({ x: 0, y: 0 });
  const [temConteudo, setTemConteudo] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Ajusta a resolução ao tamanho real (nitidez em telas retina/mobile)
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111111';
  }, []);

  const pos = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const inicio = (e) => {
    e.preventDefault();
    desenhando.current = true;
    ultimo.current = pos(e);
  };

  const mover = (e) => {
    if (!desenhando.current) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
    if (!temConteudo) setTemConteudo(true);
  };

  const fim = () => {
    if (!desenhando.current) return;
    desenhando.current = false;
    if (onChange) onChange(canvasRef.current.toDataURL('image/png'));
  };

  const limpar = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setTemConteudo(false);
    if (onChange) onChange('');
  };

  return (
    <div>
      <div style={{
        border: '2px dashed #cbd5e1', borderRadius: 12, background: '#f8fafc',
        position: 'relative', overflow: 'hidden',
      }}>
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height: altura, display: 'block', touchAction: 'none', cursor: 'crosshair' }}
          onMouseDown={inicio} onMouseMove={mover} onMouseUp={fim} onMouseLeave={fim}
          onTouchStart={inicio} onTouchMove={mover} onTouchEnd={fim}
        />
        {!temConteudo && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
            justifyContent: 'center', color: '#94a3b8', fontSize: 13, pointerEvents: 'none',
          }}>
            ✍️ Assine aqui com o dedo ou o mouse
          </div>
        )}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontSize: 11, color: temConteudo ? '#10b981' : '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
          {temConteudo ? <><Check size={12} /> Assinatura capturada</> : 'Aguardando assinatura'}
        </span>
        <button type="button" onClick={limpar}
          style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>
          <Eraser size={12} /> Limpar
        </button>
      </div>
    </div>
  );
}
