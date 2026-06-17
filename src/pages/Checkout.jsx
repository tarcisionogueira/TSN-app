import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, CheckCircle2, ExternalLink, Briefcase, ShieldCheck, TrendingUp, Headphones, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { PLANOS } from '../data/cursos';

const PLANOS_PAGOS = ['top1', 'top2', 'clube', 'assessorado'];

export default function Checkout() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { user, role } = useAuth();
  const planoKey = params.get('plano');
  const plano = PLANOS[planoKey];

  const [loading, setLoading] = useState(false);
  const [linkPagamento, setLinkPagamento] = useState(null);
  const [resultadoMudanca, setResultadoMudanca] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!user) nav(`/login?plano=${planoKey}`);
  }, [user]);

  if (!plano || planoKey === 'explorador' || plano.preco === 0) {
    nav('/');
    return null;
  }

  const nomeUsuario = user?.user_metadata?.nome || user?.email?.split('@')[0] || '';
  const cpfUsuario = user?.user_metadata?.cpf || '';

  // Mudança de plano: já assina um plano pago e escolheu outro plano recorrente
  const planoAtual = PLANOS[role];
  const ehMudanca = PLANOS_PAGOS.includes(role) && role !== planoKey && planoKey !== 'assessorado' && role !== 'assessorado';
  const ehUpgrade = ehMudanca && plano.preco > (planoAtual?.preco || 0);

  const gerarLink = async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await fetch('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'criar_assinatura',
          nome: nomeUsuario,
          email: user.email,
          cpf: cpfUsuario,
          plano: planoKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar cobrança');
      setLinkPagamento(data.linkPagamento);
    } catch (err) {
      setErro(err.message);
    }
    setLoading(false);
  };

  const mudarPlano = async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await fetch('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gerenciar_assinatura', email: user.email, plano: planoKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao alterar plano');
      setResultadoMudanca(data);
      if (data.linkPagamento) setLinkPagamento(data.linkPagamento);
    } catch (err) {
      setErro(err.message);
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) minmax(280px, 460px)', gap: 24, maxWidth: 880, width: '100%', alignItems: 'stretch' }} className="checkout-grid">

        {/* Coluna esquerda — conteúdo TSN sobre o produto */}
        <div style={{ color: 'white', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <div style={{ background: '#2563eb', borderRadius: 10, padding: '8px 10px' }}>
              <Briefcase size={20} color="white" />
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>TSN ATIVOS</div>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
            </div>
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.25, margin: '0 0 14px' }}>
            Arremate imóveis com segurança e inteligência de dados.
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
            A TSN une análise mercadológica, viabilidade financeira e leitura jurídica para você investir em leilões com confiança — do primeiro lance à arrematação.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              [TrendingUp, 'Viabilidade real', 'Relatórios de mercado e fluxo de caixa antes de dar o lance.'],
              [ShieldCheck, 'Risco jurídico mapeado', 'Análise de edital, matrícula e processo para evitar surpresas.'],
              [Headphones, 'Suporte da equipe', 'Assessoria humana quando você precisar avançar na arrematação.'],
            ].map(([Icon, t, d]) => (
              <div key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ background: 'rgba(37,99,235,0.2)', borderRadius: 9, padding: 8, flexShrink: 0 }}><Icon size={16} color="#60a5fa" /></div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t}</div>
                  <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coluna direita — card de checkout */}
        <div style={{ background: 'white', borderRadius: 20, padding: '36px 34px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>

          {ehMudanca && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: ehUpgrade ? '#eff6ff' : '#fef3c7', color: ehUpgrade ? '#1d4ed8' : '#92400e', fontSize: 12, fontWeight: 800, padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>
              {ehUpgrade ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {ehUpgrade ? 'Upgrade de plano' : 'Downgrade de plano'}
            </div>
          )}

          <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#0f172a' }}>
            Plano {plano.nome}
          </h2>
          <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 15 }}>
            <strong style={{ color: '#0f172a', fontSize: 28 }}>{plano.precoLabel}</strong> {plano.periodicidade}
          </p>
          {plano.honorarios && (
            <div style={{ background: plano.bg, color: plano.cor, fontSize: 13, fontWeight: 700, padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>
              {plano.honorarios}
            </div>
          )}

          <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px', marginBottom: 20 }}>
            {(plano.recursos || plano.features || []).map(f => (
              <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                <CheckCircle2 size={14} color={plano.cor} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13, color: '#334155' }}>{f.replace(/^[✅❌]\s*/, '')}</span>
              </div>
            ))}
          </div>

          <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13, color: '#475569' }}>
            <strong>Conta:</strong> {user?.email}
            {ehMudanca && planoAtual && <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>Plano atual: <strong>{planoAtual.nome}</strong> ({planoAtual.precoLabel})</div>}
          </div>

          {/* Resultado de mudança de plano */}
          {resultadoMudanca ? (
            <div>
              <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 10, padding: '14px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#065f46', marginBottom: 6 }}>
                  <CheckCircle2 size={16} /> Plano alterado com sucesso!
                </div>
                {resultadoMudanca.tipo === 'upgrade' ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                    Geramos a cobrança da diferença de <strong>R$ {Number(resultadoMudanca.cobrancaDiferenca).toFixed(2)}</strong>. O vencimento da recorrência permanece em <strong>{resultadoMudanca.proximoVencimento}</strong>.
                  </p>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                    Você mantém os benefícios do plano atual até a próxima cobrança (<strong>{resultadoMudanca.proximoVencimento}</strong>), quando passará a pagar <strong>{plano.precoLabel}</strong>.
                  </p>
                )}
              </div>
              {linkPagamento && (
                <a href={linkPagamento} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px', background: '#10b981', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: 'none', boxSizing: 'border-box' }}>
                  <ExternalLink size={16} /> Pagar diferença agora
                </a>
              )}
            </div>
          ) : !linkPagamento ? (
            <>
              {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 16 }}>{erro}</div>}
              <button onClick={ehMudanca ? mudarPlano : gerarLink} disabled={loading}
                style={{ width: '100%', padding: '14px', background: plano.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
                {loading
                  ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processando...</>
                  : ehMudanca ? `Confirmar ${ehUpgrade ? 'upgrade' : 'downgrade'} →` : 'Ir para Pagamento →'}
              </button>
              <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 12 }}>
                Pague via PIX, boleto ou cartão de crédito · Cancele quando quiser
              </p>
            </>
          ) : (
            <div style={{ textAlign: 'center' }}>
              <CheckCircle2 size={40} color="#10b981" style={{ margin: '0 auto 12px' }} />
              <p style={{ fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Cobrança gerada com sucesso!</p>
              <a href={linkPagamento} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px', background: '#10b981', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', textDecoration: 'none', boxSizing: 'border-box' }}>
                <ExternalLink size={16} /> Abrir página de pagamento
              </a>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 12, lineHeight: 1.5 }}>
                Após o pagamento ser confirmado, seu plano será ativado automaticamente. Pode levar alguns minutos.
              </p>
            </div>
          )}

          <button onClick={() => nav('/')} style={{ marginTop: 16, width: '100%', background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            Voltar para o início
          </button>
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @media (max-width: 760px) { .checkout-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </div>
    </div>
  );
}
