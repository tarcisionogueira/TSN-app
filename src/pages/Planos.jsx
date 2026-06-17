import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { PLANOS } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';

export default function Planos() {
  const nav = useNavigate();
  const { user } = useAuth();

  const irParaCheckout = (key, plano) => {
    if (plano.preco === 0) { nav(user ? '/membros' : '/login'); return; }
    nav(user ? `/checkout?plano=${key}` : `/login?plano=${key}`);
  };

  const planosHome = Object.entries(PLANOS).filter(([, p]) => p.homepage);
  const planosPremium = Object.entries(PLANOS).filter(([, p]) => !p.homepage);

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: '48px 20px 80px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>

        {/* Cabeçalho */}
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <h1 style={{ fontSize: 38, fontWeight: 900, color: '#0f172a', margin: '0 0 12px' }}>Escolha seu plano</h1>
          <p style={{ color: '#64748b', fontSize: 17, maxWidth: 600, margin: '0 auto' }}>
            Da exploração gratuita à assessoria completa de arrematação. Evolua conforme seu objetivo no mercado de leilões.
          </p>
        </div>

        {/* Planos de assinatura (3) */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 28 }} className="planos-grid">
          {planosHome.map(([key, plano]) => (
            <div key={key} style={{ background: 'white', borderRadius: 16, border: plano.destaque ? `2px solid ${plano.cor}` : '1px solid #e2e8f0', padding: '28px 24px', position: 'relative', boxShadow: plano.destaque ? '0 8px 24px rgba(37,99,235,0.15)' : '0 2px 8px rgba(0,0,0,0.05)' }}>
              {plano.destaque && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: plano.cor, color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>Mais Popular</div>}
              <div style={{ fontSize: 14, fontWeight: 700, color: plano.cor, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{plano.nome}</div>
              <div style={{ fontSize: 36, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>{plano.precoLabel}</div>
              {plano.preco > 0 && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>{plano.periodicidade}</div>}
              <p style={{ fontSize: 13, color: '#64748b', minHeight: 38, marginBottom: 8 }}>{plano.descricao}</p>
              <div style={{ height: 1, background: '#e2e8f0', margin: '16px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {plano.recursos.map(f => (
                  <span key={f} style={{ fontSize: 13, color: '#334155', lineHeight: 1.4 }}>{f}</span>
                ))}
              </div>
              <button onClick={() => irParaCheckout(key, plano)}
                style={{ width: '100%', padding: '11px', border: plano.destaque ? 'none' : `2px solid ${plano.cor}`, borderRadius: 10, background: plano.destaque ? plano.cor : 'transparent', color: plano.destaque ? 'white' : plano.cor, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {plano.preco === 0 ? 'Começar Grátis' : 'Assinar Agora'}
              </button>
            </div>
          ))}
        </div>

        {/* Planos premium / assessoria (2) */}
        <div style={{ textAlign: 'center', margin: '48px 0 28px' }}>
          <h2 style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>Assessoria & Mentoria</h2>
          <p style={{ color: '#64748b', fontSize: 15 }}>Quer que a equipe TSN conduza a arrematação com você?</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20 }} className="planos-grid">
          {planosPremium.map(([key, plano]) => (
            <div key={key} style={{ background: 'white', borderRadius: 16, border: `2px solid ${plano.cor}`, padding: '32px 28px', position: 'relative', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}>
              {plano.destaque && <div style={{ position: 'absolute', top: -12, left: 28, background: plano.cor, color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>Nível Máximo</div>}
              <div style={{ fontSize: 16, fontWeight: 800, color: plano.cor, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{plano.nome}</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 34, fontWeight: 900, color: '#0f172a' }}>{plano.precoLabel}</div>
                <div style={{ fontSize: 13, color: '#94a3b8' }}>{plano.periodicidade}</div>
              </div>
              {plano.honorarios && (
                <div style={{ display: 'inline-block', background: plano.bg, color: plano.cor, fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 8, marginBottom: 12 }}>
                  {plano.honorarios}
                </div>
              )}
              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 16 }}>{plano.descricao}</p>
              <div style={{ height: 1, background: '#e2e8f0', margin: '16px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {plano.recursos.map(f => (
                  <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <Check size={16} color={plano.cor} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.4 }}>{f.replace(/^✅\s*/, '')}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => irParaCheckout(key, plano)}
                style={{ width: '100%', padding: '13px', border: 'none', borderRadius: 10, background: plano.cor, color: 'white', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Quero esse plano
              </button>
            </div>
          ))}
        </div>

        <p style={{ textAlign: 'center', marginTop: 32, fontSize: 13, color: '#94a3b8' }}>
          Todos os planos podem solicitar assessoria para arrematação · Pagamento via boleto, Pix ou cartão
        </p>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .planos-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
