import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { AZUL } from '../utils/marca';

const fmtBRL = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const maskCPF = (v) => v.replace(/\D/g, '').slice(0, 11)
  .replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');

// TESTE (17/09) — pagamento de honorário via ASAAS em vez do Mercado Pago, pra isolar se uma
// recusa de cartão é do MP especificamente. Página própria (não reaproveita PagarHonorario.jsx)
// porque o Asaas exige CPF pra gerar a cobrança e o fluxo do MP não pede isso nesse ponto —
// campo extra só existe aqui. Reconciliação AINDA manual: só gera o link hospedado do Asaas.
export default function PagarHonorarioAsaas() {
  const { arrematacaoId } = useParams();
  const [arr, setArr] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [cpf, setCpf] = useState('');

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const res = await fetch(`/api/honorario-info?id=${encodeURIComponent(arrematacaoId)}`);
        const data = await res.json().catch(() => ({}));
        if (cancel) return;
        if (!res.ok || !data?.id) { setErro('Esta cobrança não foi encontrada.'); setCarregando(false); return; }
        setArr(data);
        if (data.email_sugerido) setEmail(e => e || data.email_sugerido);
        setCarregando(false);
      } catch (e) {
        console.error('[PagarHonorarioAsaas] carregar cobrança falhou:', e?.message || e);
        if (!cancel) { setErro('Não foi possível carregar esta cobrança agora. Tente novamente em instantes.'); setCarregando(false); }
      }
    })();
    return () => { cancel = true; };
  }, [arrematacaoId]);

  const gerarCobranca = async () => {
    setErro('');
    if (!nome.trim()) { setErro('Informe seu nome completo.'); return; }
    if (!/\S+@\S+\.\S+/.test(email)) { setErro('Informe um e-mail válido.'); return; }
    if (cpf.replace(/\D/g, '').length !== 11) { setErro('Informe um CPF válido (11 dígitos).'); return; }
    setEnviando(true);
    try {
      const res = await fetch('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'criar_cobranca_honorario_teste',
          arrematacao_id: arrematacaoId,
          nome: nome.trim(),
          email,
          cpf: cpf.replace(/\D/g, ''),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.linkPagamento) throw new Error(data?.error || 'Não foi possível gerar a cobrança.');
      window.location.href = data.linkPagamento;
    } catch (e) {
      setErro(e.message || 'Erro ao gerar a cobrança.');
      setEnviando(false);
    }
  };

  const wrap = { minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 16px' };
  const card = { background: 'white', borderRadius: 16, padding: '28px 24px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', maxWidth: 460, width: '100%' };
  const inp = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 };

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

  if (erro && !arr) {
    return (
      <div style={wrap}>
        <div style={{ ...card, textAlign: 'center' }}>
          <AlertCircle size={32} color="#dc2626" style={{ margin: '0 auto 12px' }} />
          <div style={{ color: '#dc2626', fontWeight: 700 }}>{erro}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap}>
      <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Honorários de êxito</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>BidPro Brasil</div>
        </div>

        <div style={{ textAlign: 'center', padding: '4px 0' }}>
          <div style={{ fontSize: 12, color: '#64748b' }}>Valor a pagar</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a' }}>{fmtBRL(arr.honorarios_saldo_restante ?? arr.honorarios_valor)}</div>
        </div>

        <div>
          <label style={lbl}>Nome completo</label>
          <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Seu nome" style={inp} />
        </div>
        <div>
          <label style={lbl}>E-mail</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="seuemail@exemplo.com" style={inp} />
        </div>
        <div>
          <label style={lbl}>CPF</label>
          <input value={cpf} onChange={e => setCpf(maskCPF(e.target.value))} placeholder="000.000.000-00" style={inp} />
        </div>

        {erro && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, textAlign: 'center' }}>{erro}</div>}

        <button onClick={gerarCobranca} disabled={enviando}
          style={{ padding: '13px', background: AZUL, color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: enviando ? 'default' : 'pointer', opacity: enviando ? 0.7 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {enviando ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : null}
          {enviando ? 'Gerando cobrança...' : 'Continuar para pagamento'}
        </button>
        <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center', fontSize: 10.5, color: '#94a3b8' }}>
          <ShieldCheck size={12} /> Pagamento processado pelo Asaas
        </div>
      </div>
    </div>
  );
}
