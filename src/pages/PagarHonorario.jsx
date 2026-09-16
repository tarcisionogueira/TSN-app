import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';
import { termoDoProduto, versaoTermoProduto } from '../utils/termos';
import PagamentoServico from '../components/PagamentoServico';
import { AZUL, VERDE } from '../utils/marca';

const fmtBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Checkout dos honorários de êxito de uma arrematação — nossa própria página (Transparente),
// não um link hospedado do Mercado Pago. NÃO exige login (18/09, pedido do dono): o
// arrematante pode repassar o link a outra pessoa pagar em seu nome (raro, mas acontece) —
// mesmo modelo de acesso do antigo link hospedado do MP. O uuid da arrematação (imprevisível,
// conhecido só por quem recebeu o link) é a credencial deste fluxo; os dados vêm de
// /api/honorario-info (público, service key, só os 3 campos que a tela precisa — ver o
// comentário daquele arquivo) em vez do supabase-js client (que dependeria de sessão pra
// passar pela RLS). Quando HÁ sessão logada, o e-mail vem pré-preenchido; sem sessão, quem
// está pagando digita o próprio.
export default function PagarHonorario() {
  const { arrematacaoId } = useParams();
  const { user } = useAuth();
  const [arr, setArr] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [aceite, setAceite] = useState(false);
  const [pago, setPago] = useState(false);
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (user?.email) setEmail(e => e || user.email);
  }, [user]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/honorario-info?id=${encodeURIComponent(arrematacaoId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancel) return;
        if (!res.ok || !data?.id) { setErro('Esta cobrança não foi encontrada.'); setCarregando(false); return; }
        setArr(data);
        setCarregando(false);
      } catch (e) {
        console.error('[PagarHonorario] carregar cobrança falhou:', e?.message || e);
        if (!cancel) { setErro('Não foi possível carregar esta cobrança agora. Tente novamente em instantes.'); setCarregando(false); }
      }
    })();
    return () => { cancel = true; };
  }, [arrematacaoId]);

  const registrarAceite = async () => {
    try {
      await apiCall('/api/registrar-aceite', {
        method: 'POST',
        body: JSON.stringify({
          plano_key: 'assessorado', valor: arr.honorarios_valor, arrematacao_id: arr.id,
          termos_versao: versaoTermoProduto('assessorado'), gateway: 'mercadopago',
        }),
      });
    } catch { /* padrao-ok: registro de aceite é best-effort — nunca bloqueia o pagamento já feito */ }
  };

  const handlePago = async () => {
    await registrarAceite();
    setPago(true);
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

  const jaPago = pago || ['pago', 'distribuido'].includes(arr.honorarios_status);
  if (jaPago) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <CheckCircle2 size={48} color={VERDE} style={{ margin: '0 auto 16px' }} />
          <div style={{ fontSize: 19, fontWeight: 800, color: VERDE }}>Honorários pagos!</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 8 }}>
            Obrigado. A equipe já foi avisada e o próximo passo (procuração) segue automaticamente.
          </div>
        </div>
      </div>
    );
  }

  const termo = termoDoProduto('assessorado', { valorLabel: fmtBRL(arr.honorarios_valor), modelo: 'parcelado' });

  return (
    <div style={wrap}>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Honorários de êxito</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>BidPro Brasil</div>
        </div>

        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '14px 16px', fontSize: 12.5, color: '#1e3a8a', lineHeight: 1.55 }}>
          Você agora é <strong>assessorado(a)</strong> da BidPro Brasil. O valor abaixo são os
          <strong> honorários de êxito (10%)</strong> referentes à sua arrematação de{' '}
          <strong>{fmtBRL(arr.valor_arrematado)}</strong>.
        </div>

        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Valor a pagar</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a' }}>{fmtBRL(arr.honorarios_valor)}</div>
        </div>

        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            E-mail de quem está pagando
          </label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seuemail@exemplo.com"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
        </div>

        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '12px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}>
            Li e aceito os <strong>termos de adesão como Assessorado</strong>.
            <details style={{ marginTop: 4 }}>
              <summary style={{ color: AZUL, cursor: 'pointer', fontWeight: 600 }}>Ver termo (versão {termo.versao})</summary>
              <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#64748b', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                {termo.texto}
              </p>
            </details>
          </span>
        </label>

        {!aceite || !/\S+@\S+\.\S+/.test(email) ? (
          <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', padding: '8px 0' }}>
            {!aceite ? 'Aceite os termos acima' : 'Informe um e-mail válido'} para continuar com o pagamento.
          </div>
        ) : (
          <PagamentoServico
            servico={{ nome: 'Honorários de êxito', valor: arr.honorarios_valor, proposito: 'honorario_exito' }}
            extra={{ arrematacao_id: arr.id }}
            email={email}
            parcelasSemJuros={1}
            onPago={handlePago}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 10.5, color: '#94a3b8' }}>
          <ShieldCheck size={12} /> Pagamento processado pelo Mercado Pago
        </div>
      </div>
    </div>
  );
}
