import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import PagamentoServico from '../components/PagamentoServico';
import { AZUL, VERDE } from '../utils/marca';

const fmtBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Checkout de uma cobrança avulsa (17/09) — mesmo modelo do honorário de êxito
// (src/pages/PagarHonorario.jsx): página própria (Transparente), sem exigir login (o link
// pode ir a alguém sem conta no sistema). Dados vêm de /api/cobranca-avulsa-info (público,
// service key, só os campos que a tela precisa) em vez do supabase-js client.
export default function CobrarAvulso() {
  const { cobrancaId } = useParams();
  const { user } = useAuth();
  const [cob, setCob] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [pago, setPago] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (user?.email) setEmail(e => e || user.email);
  }, [user]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/cobranca-avulsa-info?id=${encodeURIComponent(cobrancaId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancel) return;
        if (!res.ok || !data?.id) { setErro('Esta cobrança não foi encontrada.'); setCarregando(false); return; }
        setCob(data);
        // Pré-preenche com o e-mail do destinatário informado pelo admin ao criar a
        // cobrança, se houver — continua editável (repasse a outra pessoa pagar).
        if (data.email_sugerido) setEmail(e => e || data.email_sugerido);
        setCarregando(false);
      } catch (e) {
        console.error('[CobrarAvulso] carregar cobrança falhou:', e?.message || e);
        if (!cancel) { setErro('Não foi possível carregar esta cobrança agora. Tente novamente em instantes.'); setCarregando(false); }
      }
    })();
    return () => { cancel = true; };
  }, [cobrancaId]);

  // Pix + Cartão combinado (18/09): depois que a parte em Pix compensa, o cartão precisa
  // cobrar o saldo ATUALIZADO — sempre lido do servidor (nunca calculado no front, mesmo
  // motivo do honorário de êxito em PagarHonorario.jsx).
  const recarregarSaldo = async () => {
    const res = await fetch(`/api/cobranca-avulsa-info?id=${encodeURIComponent(cobrancaId)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.id) throw new Error('não foi possível atualizar o saldo');
    setCob(data);
    return Number(data.saldo_restante) || 0;
  };

  const wrap = { minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' };
  const card = { background: 'white', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', maxWidth: 460, width: '100%' };

  if (carregando) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center', color: '#64748b' }}>
          <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', color: AZUL }} />
          <div style={{ marginTop: 12 }}>Carregando...</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
        </div>
      </div>
    );
  }

  if (erro) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <AlertCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px' }} />
          <div style={{ color: '#dc2626', fontWeight: 700 }}>{erro}</div>
        </div>
      </div>
    );
  }

  const jaPaga = pago || cob.status === 'paga';
  if (jaPaga) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <CheckCircle2 size={48} color={VERDE} style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: 19, fontWeight: 800, color: VERDE }}>Pagamento confirmado!</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>Obrigado. A equipe já foi avisada.</div>
        </div>
      </div>
    );
  }

  if (cob.status === 'cancelada') {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <AlertCircle size={32} color="#94a3b8" style={{ margin: '0 auto 12px' }} />
          <div style={{ color: '#64748b', fontWeight: 700 }}>Esta cobrança foi cancelada.</div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>{cob.descricao}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>BidPro Brasil</div>
        </div>

        {cob.valor_pago_pix > 0 && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#166534', textAlign: 'center' }}>
            Já recebemos <strong>{fmtBRL(cob.valor_pago_pix)}</strong> via Pix do total de {fmtBRL(cob.valor)}.
            O valor abaixo é o <strong>saldo restante</strong>.
          </div>
        )}

        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Valor a pagar</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a' }}>{fmtBRL(cob.saldo_restante ?? cob.valor)}</div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            E-mail de quem está pagando
          </label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seuemail@exemplo.com"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>

        {!/\S+@\S+\.\S+/.test(email) ? (
          <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>
            Informe um e-mail válido para continuar com o pagamento.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 12 }}>Como você quer pagar?</div>
            <PagamentoServico
              servico={{ nome: cob.descricao, valor: cob.saldo_restante ?? cob.valor, proposito: 'cobranca_avulsa' }}
              extra={{ cobranca_id: cob.id }}
              email={email}
              parcelasSemJuros={1}
              embutido
              onPago={() => setPago(true)}
              permitirSplit
              recarregarSaldo={recarregarSaldo}
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 10.5, color: '#94a3b8' }}>
          <ShieldCheck size={12} /> Pagamento processado pelo Mercado Pago
        </div>
      </div>
    </div>
  );
}
