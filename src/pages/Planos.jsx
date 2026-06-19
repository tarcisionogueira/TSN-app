import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { PLANOS } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

const PLANOS_PAGOS = ['top1', 'top2', 'clube', 'assessorado'];

export default function Planos() {
  const nav = useNavigate();
  const { user, role } = useAuth();
  const planoAtualPreco = PLANOS[role]?.preco ?? -1;
  const [promosPublicas, setPromosPublicas] = useState({});

  useEffect(() => {
    supabase
      .from('links_promo')
      .select('produto, desconto_pct, desconto_valor, descricao_condicoes, validade_ate')
      .eq('ativo', true)
      .eq('publico', true)
      .then(({ data }) => {
        if (!data) return;
        const map = {};
        const hoje = new Date();
        data.forEach(p => {
          const expirou = p.validade_ate && new Date(p.validade_ate) < hoje;
          if (!expirou) map[p.produto] = p;
        });
        setPromosPublicas(map);
      });
  }, []);

  const irParaCheckout = (key, plano) => {
    if (key === role && user) return; // já é o plano atual
    if (plano.preco === 0) { nav(user ? '/membros' : '/login'); return; }
    nav(user ? `/checkout?plano=${key}` : `/login?plano=${key}`);
  };

  // Texto do botão considerando o plano atual do usuário (upgrade/downgrade)
  const labelBotao = (key, plano) => {
    if (user && key === role) return 'Seu plano atual';
    if (plano.preco === 0) return 'Começar Grátis';
    if (user && PLANOS_PAGOS.includes(role) && key !== 'assessorado' && role !== 'assessorado') {
      return plano.preco > planoAtualPreco ? 'Fazer upgrade →' : 'Fazer downgrade →';
    }
    return 'Assinar Agora';
  };
  const ehPlanoAtual = (key) => user && key === role;

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
              {key === 'top2' && (
                <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: '#7c3aed', color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap' }}>
                  Mais Completo
                </div>
              )}
              <div style={{ fontSize: 14, fontWeight: 700, color: plano.cor, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{plano.nome}</div>
              {promosPublicas[key] ? (
                <div style={{ marginBottom: 4 }}>
                  {promosPublicas[key].desconto_pct > 0 ? (
                    <>
                      <div style={{ display: 'inline-block', background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 20, marginBottom: 6 }}>
                        {promosPublicas[key].desconto_pct}% OFF
                      </div>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <div style={{ fontSize: 36, fontWeight: 900, color: '#0f172a' }}>{plano.precoLabel}</div>
                        <div style={{ fontSize: 15, color: '#94a3b8', textDecoration: 'line-through' }}>{plano.precoOriginalLabel || plano.precoLabel}</div>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 36, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>{plano.precoLabel}</div>
                  )}
                  {promosPublicas[key].descricao_condicoes && (
                    <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, marginBottom: 4 }}>🎁 {promosPublicas[key].descricao_condicoes}</div>
                  )}
                </div>
              ) : plano.precoOriginal ? (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ display: 'inline-block', background: '#dcfce7', color: '#166534', fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 20, marginBottom: 6 }}>
                    OFERTA DE LANÇAMENTO
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    <div style={{ fontSize: 36, fontWeight: 900, color: '#0f172a' }}>{plano.precoLabel}</div>
                    <div style={{ fontSize: 15, color: '#94a3b8', textDecoration: 'line-through' }}>{plano.precoOriginalLabel}</div>
                  </div>
                </div>
              ) : (
                <div style={{ fontSize: 36, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>{plano.precoLabel}</div>
              )}
              {plano.preco > 0 && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 16 }}>{plano.periodicidade}</div>}
              <p style={{ fontSize: 13, color: '#64748b', minHeight: 38, marginBottom: 8 }}>{plano.descricao}</p>
              <div style={{ height: 1, background: '#e2e8f0', margin: '16px 0' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
                {plano.recursos.map(f => (
                  <span key={f} style={{ fontSize: 13, color: '#334155', lineHeight: 1.4 }}>{f}</span>
                ))}
              </div>
              <button onClick={() => irParaCheckout(key, plano)} disabled={ehPlanoAtual(key)}
                style={{ width: '100%', padding: '11px', border: ehPlanoAtual(key) ? '2px solid #cbd5e1' : plano.destaque ? 'none' : `2px solid ${plano.cor}`, borderRadius: 10, background: ehPlanoAtual(key) ? '#f1f5f9' : plano.destaque ? plano.cor : 'transparent', color: ehPlanoAtual(key) ? '#64748b' : plano.destaque ? 'white' : plano.cor, fontWeight: 700, fontSize: 14, cursor: ehPlanoAtual(key) ? 'default' : 'pointer' }}>
                {labelBotao(key, plano)}
              </button>
            </div>
          ))}
        </div>

        {/* Planos premium / assessoria (2) — só para logados */}
        <div style={{ textAlign: 'center', margin: '48px 0 28px' }}>
          <h2 style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: '0 0 8px' }}>Assessoria & Mentoria</h2>
          <p style={{ color: '#64748b', fontSize: 15 }}>Quer que a equipe TSN conduza a arrematação com você?</p>
        </div>

        {!user ? (
          <div style={{ background: 'white', borderRadius: 16, border: '2px dashed #cbd5e1', padding: '48px 32px', textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Faça login para ver os planos de assessoria</h3>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
              Os planos Assessorado e Leilão Club são personalizados e exclusivos para membros cadastrados.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              <button onClick={() => nav('/login')}
                style={{ padding: '12px 28px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Entrar na minha conta
              </button>
              <button onClick={() => nav('/login')}
                style={{ padding: '12px 28px', background: 'transparent', color: '#0f172a', border: '2px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Criar conta grátis
              </button>
            </div>
          </div>
        ) : (
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
                <button onClick={() => irParaCheckout(key, plano)} disabled={ehPlanoAtual(key)}
                  style={{ width: '100%', padding: '13px', border: ehPlanoAtual(key) ? '2px solid #cbd5e1' : 'none', borderRadius: 10, background: ehPlanoAtual(key) ? '#f1f5f9' : plano.cor, color: ehPlanoAtual(key) ? '#64748b' : 'white', fontWeight: 700, fontSize: 14, cursor: ehPlanoAtual(key) ? 'default' : 'pointer' }}>
                  {ehPlanoAtual(key) ? 'Seu plano atual' : 'Quero esse plano'}
                </button>
              </div>
            ))}
          </div>
        )}

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
