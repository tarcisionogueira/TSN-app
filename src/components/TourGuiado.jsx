import React, { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

const TOUR_KEY = 'tsn_tour_feito';

const STEPS = [
  {
    id: 'leiloes',
    icone: '🔍',
    titulo: 'Busca de Leilões',
    descricao: 'Explore imóveis em leilão de todo o Brasil. Filtre por estado, tipo (casa, apto, terreno), valor e modalidade judicial ou extrajudicial.',
  },
  {
    id: 'calculadora',
    icone: '🧮',
    titulo: 'Calculadora de Viabilidade',
    descricao: 'Simule o retorno antes de dar um lance. Calcule custos de arrematação, ITBI, comissões e margem de lucro esperada.',
  },
  {
    id: 'membros',
    icone: '🎓',
    titulo: 'Área de Membros',
    descricao: 'Acesse cursos exclusivos, videoaulas e materiais de estudo para dominar o mercado de leilões e maximizar seus retornos.',
  },
  {
    id: 'analise',
    icone: '📊',
    titulo: 'Fazer Análise',
    descricao: 'Envie um imóvel específico para análise completa: riscos jurídicos, situação documental e potencial de valorização com IA.',
  },
  {
    id: 'suporte',
    icone: '💬',
    titulo: 'Suporte e Chat',
    descricao: 'Fale com nossa equipe pelo chat integrado ou abra um chamado. Estamos aqui para tirar suas dúvidas e ajudar em cada passo.',
  },
  {
    id: 'planos',
    icone: '💎',
    titulo: 'Planos e Upgrade',
    descricao: 'Conheça os planos disponíveis e faça upgrade para desbloquear análises ilimitadas, relatórios exclusivos e suporte prioritário.',
  },
];

function useElementRect(tourId) {
  const [rect, setRect] = useState(null);

  const atualizar = useCallback(() => {
    const el = document.querySelector(`[data-tour="${tourId}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    } else {
      setRect(null);
    }
  }, [tourId]);

  useEffect(() => {
    atualizar();
    window.addEventListener('resize', atualizar);
    window.addEventListener('scroll', atualizar, true);
    return () => {
      window.removeEventListener('resize', atualizar);
      window.removeEventListener('scroll', atualizar, true);
    };
  }, [atualizar]);

  return rect;
}

function Spotlight({ rect, step }) {
  const PAD = 8;
  const tooltipAbaixo = rect ? (rect.top + rect.height + 200 < window.innerHeight) : true;

  if (!rect) {
    // Sem elemento encontrado: mostra card centralizado
    return (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9990,
      }}>
        <TooltipCard step={step} centered />
      </div>
    );
  }

  const spotLeft = rect.left - PAD;
  const spotTop = rect.top - PAD;
  const spotW = rect.width + PAD * 2;
  const spotH = rect.height + PAD * 2;

  return (
    <>
      {/* Overlay escuro com buraco no elemento */}
      <div style={{
        position: 'fixed',
        left: spotLeft,
        top: spotTop,
        width: spotW,
        height: spotH,
        borderRadius: 10,
        boxShadow: '0 0 0 9999px rgba(15,23,42,0.82)',
        border: '2px solid #3b82f6',
        zIndex: 9990,
        pointerEvents: 'none',
        transition: 'all 0.35s cubic-bezier(0.4,0,0.2,1)',
      }} />

      {/* Pulso */}
      <div style={{
        position: 'fixed',
        left: spotLeft - 4,
        top: spotTop - 4,
        width: spotW + 8,
        height: spotH + 8,
        borderRadius: 14,
        border: '2px solid rgba(59,130,246,0.4)',
        zIndex: 9989,
        pointerEvents: 'none',
        animation: 'tourPulse 1.8s ease-in-out infinite',
      }} />

      {/* Tooltip */}
      <div style={{
        position: 'fixed',
        left: Math.max(12, Math.min(spotLeft + spotW / 2 - 160, window.innerWidth - 336)),
        top: tooltipAbaixo
          ? spotTop + spotH + 14
          : spotTop - 14 - 180,
        width: 320,
        zIndex: 9995,
      }}>
        <TooltipCard step={step} />
        {/* Seta */}
        <div style={{
          position: 'absolute',
          left: Math.min(Math.max(20, spotLeft + spotW / 2 - (Math.max(12, Math.min(spotLeft + spotW / 2 - 160, window.innerWidth - 336)))),  280),
          [tooltipAbaixo ? 'top' : 'bottom']: tooltipAbaixo ? -8 : -8,
          width: 0, height: 0,
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          [tooltipAbaixo ? 'borderBottom' : 'borderTop']: '8px solid #1e293b',
        }} />
      </div>
    </>
  );
}

function TooltipCard({ step, centered }) {
  return (
    <div style={{
      background: '#1e293b',
      border: '1px solid #334155',
      borderRadius: 14,
      padding: '18px 20px',
      boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
      ...(centered ? { maxWidth: 340, margin: '0 auto', textAlign: 'center' } : {}),
    }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{step.icone}</div>
      <div style={{ fontSize: 15, fontWeight: 800, color: 'white', marginBottom: 6 }}>{step.titulo}</div>
      <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>{step.descricao}</div>
    </div>
  );
}

export default function TourGuiado({ onClose }) {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];
  const rect = useElementRect(step.id);

  const avancar = () => {
    if (idx < STEPS.length - 1) setIdx(i => i + 1);
    else fechar();
  };
  const voltar = () => { if (idx > 0) setIdx(i => i - 1); };
  const fechar = () => {
    localStorage.setItem(TOUR_KEY, '1');
    onClose();
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9988 }}>
      <Spotlight rect={rect} step={step} />

      {/* Barra de controle (sempre visível, abaixo do spotlight) */}
      <div style={{
        position: 'fixed',
        bottom: 28,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        background: '#0f172a',
        border: '1px solid #334155',
        borderRadius: 40,
        padding: '10px 20px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
      }}>
        {/* Pontos de progresso */}
        <div style={{ display: 'flex', gap: 5, marginRight: 4 }}>
          {STEPS.map((_, i) => (
            <button key={i} onClick={() => setIdx(i)}
              style={{ width: i === idx ? 20 : 7, height: 7, borderRadius: 4, border: 'none', cursor: 'pointer', transition: 'all 0.2s', background: i === idx ? '#3b82f6' : '#334155', padding: 0 }} />
          ))}
        </div>

        <button onClick={voltar} disabled={idx === 0}
          style={{ background: 'none', border: 'none', color: idx === 0 ? '#334155' : '#94a3b8', cursor: idx === 0 ? 'default' : 'pointer', display: 'flex', alignItems: 'center', padding: 4 }}>
          <ChevronLeft size={18} />
        </button>

        <span style={{ fontSize: 12, color: '#64748b', minWidth: 36, textAlign: 'center' }}>
          {idx + 1}/{STEPS.length}
        </span>

        <button onClick={avancar}
          style={{ background: '#3b82f6', border: 'none', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 700 }}>
          {idx === STEPS.length - 1 ? 'Concluir' : 'Próximo'} {idx < STEPS.length - 1 && <ChevronRight size={14} />}
        </button>

        <button onClick={fechar}
          style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', padding: 4, marginLeft: 4 }}
          title="Pular tour">
          <X size={16} />
        </button>
      </div>

      <style>{`
        @keyframes tourPulse {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 0.2; transform: scale(1.04); }
        }
      `}</style>
    </div>
  );
}

export const TOUR_KEY_EXPORT = TOUR_KEY;
