import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, Zap, ShieldCheck, Users, TrendingUp, Clock, ArrowRight, AlertCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { PLANOS } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';

// Ícones decorativos por plano
const ICONE_PLANO = { top1: '📊', top2: '⚖️', assessorado: '🤝', clube: '👑' };

function fmtPreco(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Promo() {
  const { codigo } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!codigo) return;
    supabase
      .from('links_promo')
      .select('*')
      .eq('codigo', codigo.toUpperCase())
      .eq('ativo', true)
      .single()
      .then(({ data, error }) => {
        if (error || !data) setErro('Link promocional não encontrado ou expirado.');
        else setLink(data);
        setLoading(false);
      });
  }, [codigo]);

  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
      Carregando oferta…
    </div>
  );

  if (erro || !link) return (
    <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
      <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px' }} />
      <h2 style={{ color: '#111111', marginBottom: 8 }}>Oferta não encontrada</h2>
      <p style={{ color: '#64748b', marginBottom: 24 }}>{erro || 'Este link pode ter sido desativado ou expirado.'}</p>
      <button onClick={() => nav('/planos')} style={{ padding: '10px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
        Ver todos os planos
      </button>
    </div>
  );

  const plano = PLANOS[link.produto];
  if (!plano) return null;

  // Cálculo do preço promocional
  const precoOriginal = plano.preco;
  let precoPromo = precoOriginal;
  if (link.desconto_pct > 0)   precoPromo = precoOriginal * (1 - link.desconto_pct / 100);
  if (link.desconto_valor > 0) precoPromo = Math.max(0, precoOriginal - link.desconto_valor);
  const temDesconto = precoPromo < precoOriginal;
  const pctDesconto = precoOriginal > 0 ? Math.round((1 - precoPromo / precoOriginal) * 100) : 0;

  const irParaCheckout = () => {
    const dest = user
      ? `/checkout?plano=${link.produto}&promo=${link.codigo}`
      : `/login?plano=${link.produto}&promo=${link.codigo}`;
    nav(dest);
  };

  return (
    <div style={{ background: 'linear-gradient(160deg, #111111 0%, #111111 40%, #111111 100%)', minHeight: '100vh', padding: '0 0 80px' }}>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '60px 20px 0', maxWidth: 720, margin: '0 auto' }}>
        {temDesconto && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#dc2626', color: 'white', fontSize: 13, fontWeight: 800, padding: '6px 16px', borderRadius: 20, marginBottom: 20, textTransform: 'uppercase', letterSpacing: 1 }}>
            <Zap size={14} /> Oferta especial — {pctDesconto}% de desconto
          </div>
        )}
        <div style={{ fontSize: 52, marginBottom: 12 }}>{ICONE_PLANO[link.produto] || '🎯'}</div>
        <h1 style={{ fontSize: 42, fontWeight: 900, color: 'white', margin: '0 0 12px', lineHeight: 1.15 }}>
          Plano <span style={{ color: plano.cor }}>{plano.nome}</span>
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 18, margin: '0 0 32px', lineHeight: 1.6 }}>
          {plano.descricao}
        </p>

        {/* Card de preço */}
        <div style={{ background: 'white', borderRadius: 20, padding: '32px 36px', display: 'inline-block', minWidth: 320, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
          {temDesconto ? (
            <>
              <div style={{ fontSize: 13, color: '#94a3b8', textDecoration: 'line-through', fontWeight: 600, marginBottom: 4 }}>
                De R$ {fmtPreco(precoOriginal)}{plano.periodicidade}
              </div>
              <div style={{ fontSize: 48, fontWeight: 900, color: '#059669', lineHeight: 1 }}>
                R$ {fmtPreco(precoPromo)}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{plano.periodicidade}</div>
              {link.descricao_condicoes && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#fef9c3', borderRadius: 10, fontSize: 13, color: '#a16207', fontWeight: 600, textAlign: 'left' }}>
                  📋 {link.descricao_condicoes}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 48, fontWeight: 900, color: '#111111', lineHeight: 1 }}>
                {plano.precoLabel}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{plano.periodicidade}</div>
              {link.descricao_condicoes && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#fef9c3', borderRadius: 10, fontSize: 13, color: '#a16207', fontWeight: 600, textAlign: 'left' }}>
                  📋 {link.descricao_condicoes}
                </div>
              )}
            </>
          )}
          <button onClick={irParaCheckout}
            style={{ marginTop: 22, width: '100%', padding: '14px', background: plano.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            Quero assinar agora <ArrowRight size={18} />
          </button>
          <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
            <ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Pagamento seguro · Cancele quando quiser
          </div>
        </div>
      </div>

      {/* Recursos do plano */}
      <div style={{ maxWidth: 680, margin: '52px auto 0', padding: '0 20px' }}>
        <h2 style={{ color: 'white', fontSize: 22, fontWeight: 800, textAlign: 'center', marginBottom: 24 }}>
          O que está incluído no {plano.nome}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="promo-recursos">
          {plano.recursos.map((r, i) => {
            const ativo = r.startsWith('✅');
            const texto = r.replace(/^[✅❌]\s*/, '');
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: ativo ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${ativo ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)'}` }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{ativo ? '✅' : '❌'}</span>
                <span style={{ fontSize: 13, color: ativo ? '#e2e8f0' : '#475569', lineHeight: 1.45 }}>{texto}</span>
              </div>
            );
          })}
        </div>

        {plano.honorarios && (
          <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 10, fontSize: 13, color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}>
            ℹ️ {plano.honorarios}
          </div>
        )}
      </div>

      {/* Selos de confiança */}
      <div style={{ maxWidth: 680, margin: '40px auto 0', padding: '0 20px', display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
        {[
          { icon: <ShieldCheck size={20} color="#10b981" />, texto: 'Pagamento 100% seguro' },
          { icon: <Users size={20} color="#60a5fa" />,       texto: 'Suporte via WhatsApp' },
          { icon: <TrendingUp size={20} color="#a78bfa" />,  texto: 'Resultados comprovados' },
          { icon: <Clock size={20} color="#fbbf24" />,       texto: 'Acesso imediato' },
        ].map(({ icon, texto }) => (
          <div key={texto} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#94a3b8' }}>
            {icon} {texto}
          </div>
        ))}
      </div>

      {/* CTA final */}
      <div style={{ textAlign: 'center', marginTop: 52, padding: '0 20px' }}>
        <button onClick={irParaCheckout}
          style={{ padding: '16px 40px', background: plano.cor, color: 'white', border: 'none', borderRadius: 14, fontWeight: 900, fontSize: 18, cursor: 'pointer', boxShadow: `0 8px 30px ${plano.cor}66`, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          Assinar {plano.nome} agora <ArrowRight size={20} />
        </button>
        <div style={{ marginTop: 14, fontSize: 13, color: '#475569' }}>
          Já tem conta? <button onClick={() => nav(`/login?plano=${link.produto}&promo=${link.codigo}`)} style={{ background: 'none', border: 'none', color: '#60a5fa', fontWeight: 700, cursor: 'pointer' }}>Entrar e assinar</button>
        </div>
      </div>

      <style>{`@media(max-width:600px){ .promo-recursos{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
