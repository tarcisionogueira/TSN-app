import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, CheckCircle2, ExternalLink, Briefcase } from 'lucide-react';
import { PLANOS } from '../data/cursos';

export default function Checkout() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { user } = useAuth();
  const planoKey = params.get('plano');
  const plano = PLANOS[planoKey];

  const [loading, setLoading] = useState(false);
  const [linkPagamento, setLinkPagamento] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!user) nav(`/login?plano=${planoKey}`);
  }, [user]);

  if (!plano || planoKey === 'gratuito') {
    nav('/');
    return null;
  }

  const nomeUsuario = user?.user_metadata?.nome || user?.email?.split('@')[0] || '';
  const cpfUsuario = user?.user_metadata?.cpf || '';

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

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 460, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ background: '#2563eb', borderRadius: 10, padding: '8px 10px' }}>
            <Briefcase size={20} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16, color: '#0f172a' }}>TSN ATIVOS</div>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Checkout</div>
          </div>
        </div>

        <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#0f172a' }}>
          Plano {plano.nome}
        </h2>
        <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 15 }}>
          <strong style={{ color: '#0f172a', fontSize: 28 }}>R$ {plano.preco}</strong>/mês
        </p>

        <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px', marginBottom: 24 }}>
          {(plano.recursos || plano.features || []).map(f => (
            <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
              <CheckCircle2 size={14} color={plano.cor} style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ fontSize: 13, color: '#334155' }}>{f}</span>
            </div>
          ))}
        </div>

        <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13, color: '#475569' }}>
          <strong>Conta:</strong> {user?.email}
        </div>

        {!linkPagamento ? (
          <>
            {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 16 }}>{erro}</div>}
            <button onClick={gerarLink} disabled={loading}
              style={{ width: '100%', padding: '14px', background: plano.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
              {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Gerando cobrança...</> : 'Ir para Pagamento →'}
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
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px', background: '#10b981', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', textDecoration: 'none' }}>
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

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
