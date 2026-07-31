/**
 * PagamentoServico — Fluxo de pagamento para assessoria, Leilão Club e honorários.
 *
 * Props:
 *   servico: { id, nome, valor, descricao }
 *   onPago: (paymentId) => void
 *   onCancelar: () => void
 *
 * Fluxos:
 *   1. PIX direto (zero taxa) → QR code BR Code gerado localmente + copiar chave → polling MP
 *   2. Cartão de crédito → parcelado em até 12x (cliente absorve taxas MP)
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { QrCode, CreditCard, CheckCircle2, Loader2, Copy, AlertCircle, ChevronLeft, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';

const MP_PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY || '';

const fmtBRL = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const calcParcelaMaisJuros = (valor, n) => {
  // Até 3x sem juros; a partir de 4x o cliente assume os juros
  if (n <= 3) return valor / n;
  const taxa = n <= 6 ? 0.0249 : n <= 9 ? 0.0299 : 0.0349;
  return (valor * Math.pow(1 + taxa, n / 12)) / n;
};

const PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

// ── Gera payload PIX BR Code (EMV) localmente — zero taxa ──────────────────
function gerarPixBRCode({ chave, nome, cidade, valor, txid = 'BIDPRO' }) {
  const fmt = (id, val) => {
    const v = String(val);
    return `${id}${String(v.length).padStart(2, '0')}${v}`;
  };
  const merchantAccount = fmt('00', 'BR.GOV.BCB.PIX') + fmt('01', chave);
  const valorStr = Number(valor).toFixed(2);
  const addData = fmt('05', txid.replace(/[^A-Z0-9]/gi, '').slice(0, 25).toUpperCase() || 'BIDPRO');

  let payload =
    fmt('00', '01') +
    fmt('26', merchantAccount) +
    fmt('52', '0000') +
    fmt('53', '986') +
    fmt('54', valorStr) +
    fmt('58', 'BR') +
    fmt('59', nome.slice(0, 25)) +
    fmt('60', cidade.slice(0, 15)) +
    fmt('62', addData) +
    '6304';

  // CRC16-CCITT
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return payload + (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

// QR Code via API pública (sem autenticação, apenas encode)
function QRCodeImg({ value, size = 200 }) {
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(value)}&format=svg&ecc=M`;
  return (
    <img src={url} alt="QR Code PIX" width={size} height={size}
      style={{ borderRadius: 8, border: '1px solid #e2e8f0' }} />
  );
}

const btn = (cor, texto, onClick, disabled, icon) => (
  <button onClick={onClick} disabled={disabled} style={{
    width: '100%', padding: '14px 20px', background: disabled ? '#94a3b8' : cor,
    color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15,
    cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
    justifyContent: 'center', gap: 8,
  }}>
    {icon}{texto}
  </button>
);

/* ── Tela: escolha do método ── */
function EscolhaMetodo({ servico, onEscolha }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Valor a pagar</div>
        <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a' }}>{fmtBRL(servico.valor)}</div>
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{servico.nome}</div>
      </div>

      <button onClick={() => onEscolha('pix')} style={{
        width: '100%', padding: '18px 20px', background: 'white', border: '2px solid #e2e8f0',
        borderRadius: 14, cursor: 'pointer', textAlign: 'left',
      }}
        onMouseEnter={e => e.currentTarget.style.borderColor = '#059669'}
        onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, background: '#f0fdf4', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <QrCode size={22} color="#059669" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Pagar com PIX</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Sem taxas · QR code + chave para copiar</div>
          </div>
          <div style={{ background: '#dcfce7', color: '#059669', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>SEM TAXA</div>
        </div>
      </button>

      <button onClick={() => onEscolha('cartao')} style={{
        width: '100%', padding: '18px 20px', background: 'white', border: '2px solid #e2e8f0',
        borderRadius: 14, cursor: 'pointer', textAlign: 'left',
      }}
        onMouseEnter={e => e.currentTarget.style.borderColor = '#0D63DB'}
        onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 44, height: 44, background: '#eff6ff', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CreditCard size={22} color="#0D63DB" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Cartão de crédito</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Em até 12× · Taxas assumidas pelo cliente</div>
          </div>
          <ArrowRight size={16} color="#94a3b8" />
        </div>
      </button>
    </div>
  );
}

/* ── Tela: PIX ── */
function PagamentoPIX({ servico, onConfirmado, onVoltar }) {
  const { user } = useAuth();
  const [etapa, setEtapa] = useState('aguardando'); // aguardando | verificando | confirmado | erro
  const [copiado, setCop] = useState('');
  const [msgErro, setMsgErro] = useState('');
  const [showQR, setShowQR] = useState(false);
  const [paymentId, setPaymentId] = useState(null);
  const pollingRef = useRef(null);
  const tentRef = useRef(0);

  const PIX_KEY     = import.meta.env.VITE_MP_PIX_KEY     || '';
  const PIX_TITULAR = import.meta.env.VITE_MP_PIX_TITULAR || 'BidPro Brasil';
  const PIX_CIDADE  = import.meta.env.VITE_MP_PIX_CIDADE  || 'SAO PAULO';

  // Gera BR Code localmente — zero taxa, zero API
  const brCode = useMemo(() => {
    if (!PIX_KEY) return '';
    return gerarPixBRCode({
      chave: PIX_KEY,
      nome: PIX_TITULAR,
      cidade: PIX_CIDADE,
      valor: servico.valor,
      txid: `BIDPRO${servico.id || 'PAG'}`.replace(/[^A-Z0-9]/gi, '').slice(0, 25),
    });
  }, [PIX_KEY, PIX_TITULAR, PIX_CIDADE, servico.valor, servico.id]);

  // PIX estático: não cria payment no MP (o cliente paga direto na chave PIX da conta).
  // Polling usa apenas valor + referência para localizar o recebimento na conta MP.

  const verificar = async () => {
    if (etapa === 'confirmado') return;
    tentRef.current++;
    if (tentRef.current > 90) {
      clearInterval(pollingRef.current);
      setEtapa('erro');
      setMsgErro('Tempo limite atingido. Se já pagou, entre em contato com o suporte.');
      return;
    }
    try {
      // apiCall devolve o Response CRU — é preciso checar res.ok e ler o JSON.
      const res = await apiCall('/api/mp-verificar-pix', {
        method: 'POST',
        body: JSON.stringify({
          paymentId: paymentId || undefined,
          valor: servico.valor,
          referencia: `tsn-${user?.id}-${servico.id}`,
        }),
      });
      if (!res.ok) return; // falha transitória → tenta de novo no próximo ciclo do polling
      const data = await res.json().catch(() => null);
      if (data?.confirmado) {
        clearInterval(pollingRef.current);
        setEtapa('confirmado');
        setTimeout(() => onConfirmado(data.paymentId || paymentId), 1500);
      }
    } catch { /* ignora */ }
  };

  const iniciarPolling = () => {
    setEtapa('verificando');
    tentRef.current = 0;
    verificar();
    pollingRef.current = setInterval(verificar, 8000);
  };

  useEffect(() => () => clearInterval(pollingRef.current), []);

  const copiar = (texto, label) => {
    navigator.clipboard?.writeText(texto).then(() => {
      setCop(label);
      setTimeout(() => setCop(''), 2000);
    });
  };

  if (etapa === 'confirmado') {
    return (
      <div style={{ textAlign: 'center', padding: '32px 0' }}>
        <CheckCircle2 size={56} color="#059669" style={{ margin: '0 auto 16px' }} />
        <div style={{ fontSize: 20, fontWeight: 800, color: '#059669' }}>Pagamento confirmado!</div>
        <div style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>Redirecionando...</div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button onClick={onVoltar} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, padding: 0 }}>
        <ChevronLeft size={16} /> Voltar
      </button>

      {/* Valor destaque */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#059669' }}>{fmtBRL(servico.valor)}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>{servico.nome}</div>
      </div>

      {/* Botões de ação: QR ou Copiar */}
      {brCode && !showQR && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <button onClick={() => setShowQR(true)} style={{
            padding: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0',
            borderRadius: 10, cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#059669',
          }}>
            <QrCode size={22} color="#059669" />
            Gerar QR Code
          </button>
          <button onClick={() => copiar(PIX_KEY, 'chave')} style={{
            padding: '12px', background: copiado === 'chave' ? '#f0fdf4' : '#f8fafc',
            border: `1px solid ${copiado === 'chave' ? '#bbf7d0' : '#e2e8f0'}`,
            borderRadius: 10, cursor: 'pointer', display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13,
            color: copiado === 'chave' ? '#059669' : '#374151',
          }}>
            <Copy size={22} color={copiado === 'chave' ? '#059669' : '#374151'} />
            {copiado === 'chave' ? 'Copiado!' : 'Copiar chave'}
          </button>
        </div>
      )}

      {/* QR Code, só aparece após clique */}
      {showQR && brCode && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <QRCodeImg value={brCode} size={200} />
          <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
            Aponte a câmera do seu banco para o QR code
          </div>
          <button onClick={() => setShowQR(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            Ocultar QR code
          </button>
        </div>
      )}

      {/* Separador */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>CHAVE PIX</span>
        <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
      </div>

      {/* Chave PIX + titular */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Chave PIX</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', wordBreak: 'break-all' }}>{PIX_KEY || '—'}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>Titular: <strong>{PIX_TITULAR}</strong></div>
          </div>
          <button onClick={() => copiar(PIX_KEY, 'chave')} style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', background: copiado === 'chave' ? '#dcfce7' : 'white',
            border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer',
            fontSize: 13, fontWeight: 600, color: copiado === 'chave' ? '#059669' : '#374151',
          }}>
            <Copy size={13} />{copiado === 'chave' ? 'Copiado!' : 'Copiar'}
          </button>
        </div>

        {brCode && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>PIX Copia e Cola</div>
              <div style={{ fontSize: 11, color: '#64748b', wordBreak: 'break-all', fontFamily: 'monospace' }}>{brCode.slice(0, 40)}...</div>
            </div>
            <button onClick={() => copiar(brCode, 'brcode')} style={{
              flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', background: copiado === 'brcode' ? '#dcfce7' : 'white',
              border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer',
              fontSize: 13, fontWeight: 600, color: copiado === 'brcode' ? '#059669' : '#374151',
            }}>
              <Copy size={13} />{copiado === 'brcode' ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        )}
      </div>

      {msgErro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#dc2626' }}>{msgErro}</div>
        </div>
      )}

      {etapa === 'verificando'
        ? btn('#059669', 'Verificando...', null, true, <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />)
        : btn('#059669', 'Já realizei o pagamento →', iniciarPolling, false, <CheckCircle2 size={16} />)
      }

      {etapa === 'verificando' && (
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>Consultando a cada 8 segundos...</div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}

/* ── Tela: Cartão ── */
// assinatura=true → cria uma assinatura recorrente TRANSPARENTE (preapproval do MP)
// via /api/mp; sem parcelas (cobrança mensal do valor cheio). Caso contrário, é o
// pagamento único via /api/mp-checkout (parcelável).
function PagamentoCartao({ servico, onConfirmado, onVoltar, assinatura = false }) {
  const { user } = useAuth();
  const [parcelas, setParcelas] = useState(1);
  const [form, setForm] = useState({ numero: '', nome: '', validade: '', cvv: '' });
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const pollingRef = useRef(null);

  const parcelaValor = assinatura ? servico.valor : calcParcelaMaisJuros(servico.valor, parcelas);
  const totalFinal = assinatura ? servico.valor : parcelaValor * parcelas;

  const upd = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));
  const fmtNum = v => v.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 19);
  const fmtVal = v => v.replace(/\D/g, '').replace(/^(\d{2})/, '$1/').slice(0, 5);

  const pagar = async () => {
    setErro('');
    if (!form.numero || !form.nome || !form.validade || !form.cvv) {
      setErro('Preencha todos os campos do cartão.');
      return;
    }
    if (!MP_PUBLIC_KEY) {
      setErro('Chave pública MP não configurada (VITE_MP_PUBLIC_KEY).');
      return;
    }
    setProcessando(true);
    try {
      if (!window.MercadoPago) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://sdk.mercadopago.com/js/v2';
          s.onload = resolve; s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      const mp = new window.MercadoPago(MP_PUBLIC_KEY);
      const [mes, ano] = form.validade.split('/');
      const token = await mp.createCardToken({
        cardNumber: form.numero.replace(/\s/g, ''),
        cardholderName: form.nome,
        cardExpirationMonth: mes,
        cardExpirationYear: `20${ano}`,
        securityCode: form.cvv,
      });
      if (!token?.id) throw new Error('Não foi possível tokenizar o cartão.');

      // ── Assinatura recorrente transparente (preapproval) ──────────────────
      if (assinatura) {
        const planoKey = servico.plano || servico.id;
        const res = await apiCall('/api/mp', {
          method: 'POST',
          body: JSON.stringify({
            action: 'criar_assinatura_transparente',
            plano: planoKey,
            email: user?.email,
            cardTokenId: token.id,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Falha ao criar a assinatura.');
        if (data.status === 'authorized') { onConfirmado(data.assinaturaId); return; }
        if (data.status === 'pending') {
          setErro('Assinatura em processamento. Assim que o banco confirmar, seu plano é liberado automaticamente.');
          return;
        }
        throw new Error('Não foi possível autorizar a assinatura. Verifique os dados do cartão ou tente outro.');
      }

      const bin = form.numero.replace(/\s/g, '').slice(0, 6);
      const pmRes = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?bin=${bin}&public_key=${MP_PUBLIC_KEY}`);
      const pmData = await pmRes.json();
      const metodoPagamentoId = pmData.results?.[0]?.id || 'visa';

      // apiCall devolve o Response CRU: checar res.ok e ler o JSON. Antes o código lia
      // Response.status (o código HTTP) como se fosse o status do pagamento → nunca batia
      // 'approved' e caía em "não aprovado" mesmo com o cartão já cobrado (cobrança dupla).
      const res = await apiCall('/api/mp-checkout', {
        method: 'POST',
        body: JSON.stringify({
          valor: totalFinal,
          descricao: `${servico.nome} (${parcelas}x)`,
          email: user?.email,
          metodoPagamento: 'credit_card',
          dadosCartao: { token: token.id, parcelas, metodoPagamentoId },
          // Marca a INTENÇÃO (recarga vs. serviço) para o confirmador correto aceitar.
          proposito: servico.proposito || 'servico',
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível processar o pagamento. Tente novamente.');

      if (data?.status === 'approved' || data?.status === 'authorized') {
        onConfirmado(data.paymentId);
        return;
      }
      if (data?.status === 'in_process' && data?.paymentId) {
        pollingRef.current = setInterval(async () => {
          const checkRes = await apiCall('/api/mp-verificar-pix', {
            method: 'POST',
            body: JSON.stringify({ paymentId: data.paymentId }),
          });
          if (!checkRes.ok) return;
          const check = await checkRes.json().catch(() => null);
          if (check?.confirmado) { clearInterval(pollingRef.current); onConfirmado(data.paymentId); }
        }, 8000);
        setErro('Pagamento em análise. Aguarde...');
        return;
      }
      setErro('Pagamento não aprovado. Verifique os dados ou tente outro cartão.');
    } catch (e) {
      setErro(e.message || 'Erro ao processar pagamento.');
    } finally {
      setProcessando(false);
    }
  };

  useEffect(() => () => clearInterval(pollingRef.current), []);

  const inp = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onVoltar} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, padding: 0 }}>
        <ChevronLeft size={16} /> Voltar
      </button>

      {assinatura ? (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', fontSize: 12, color: '#1e40af' }}>
          Assinatura mensal de <strong>{fmtBRL(servico.valor)}</strong>, cobrança recorrente
          automática no cartão. Cancele quando quiser pela plataforma.
        </div>
      ) : (
        <div>
          <label style={lbl}>Parcelas</label>
          <select value={parcelas} onChange={e => setParcelas(Number(e.target.value))} style={inp}>
            {PARCELAS.map(n => {
              const pv = calcParcelaMaisJuros(servico.valor, n);
              const total = pv * n;
              return (
                <option key={n} value={n}>
                  {n}× de {fmtBRL(pv)}{n <= 3 ? ', sem juros' : ` (total ${fmtBRL(total)})`}
                </option>
              );
            })}
          </select>
          {parcelas > 3 && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
              ⚠️ Taxas de {((parcelaValor * parcelas / servico.valor - 1) * 100).toFixed(2)}% assumidas pelo cliente.
            </div>
          )}
        </div>
      )}

      <div>
        <label style={lbl}>Número do cartão</label>
        <input style={inp} placeholder="0000 0000 0000 0000"
          value={form.numero} onChange={e => setForm(p => ({ ...p, numero: fmtNum(e.target.value) }))} />
      </div>
      <div>
        <label style={lbl}>Nome no cartão</label>
        <input style={inp} placeholder="COMO ESTÁ NO CARTÃO" name="nome"
          value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value.toUpperCase() }))} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={lbl}>Validade</label>
          <input style={inp} placeholder="MM/AA"
            value={form.validade} onChange={e => setForm(p => ({ ...p, validade: fmtVal(e.target.value) }))} />
        </div>
        <div>
          <label style={lbl}>CVV</label>
          <input style={inp} placeholder="000" maxLength={4} name="cvv" value={form.cvv} onChange={upd} />
        </div>
      </div>

      {erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
          <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#dc2626' }}>{erro}</div>
        </div>
      )}

      {btn('#0D63DB',
        processando ? 'Processando...' : `Pagar ${fmtBRL(totalFinal)}`,
        pagar, processando,
        processando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CreditCard size={16} />
      )}

      <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
        Dados criptografados pelo Mercado Pago · Não armazenamos dados do cartão
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}

/* ── Componente principal ── */
// assinatura=true → somente cartão (Investidor Pro, Leilão Club recorrente)
// assinatura=false (padrão) → escolha entre PIX (sem taxa) e cartão
export default function PagamentoServico({ servico, onPago, onCancelar, assinatura = false, soCartao = false }) {
  // soCartao: fluxos cujo pagamento PRECISA carregar metadata (ex.: recarga de crédito,
  // confirmada por metadata.proposito) — o PIX estático não carrega, então só cartão.
  const [metodo, setMetodo] = useState(assinatura || soCartao ? 'cartao' : null);

  return (
    <div style={{
      background: 'white', borderRadius: 16, padding: '28px 24px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.10)', maxWidth: 460, margin: '0 auto',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Finalizar pagamento</div>
        {assinatura && (
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Assinatura recorrente · Somente cartão de crédito
          </div>
        )}
      </div>

      {!metodo && (
        <>
          <EscolhaMetodo servico={servico} onEscolha={setMetodo} />
          {onCancelar && (
            <button onClick={onCancelar} style={{ width: '100%', marginTop: 12, padding: '10px', background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
          )}
        </>
      )}

      {metodo === 'pix' && (
        <PagamentoPIX servico={servico} onConfirmado={onPago} onVoltar={() => setMetodo(null)} />
      )}
      {metodo === 'cartao' && (
        <PagamentoCartao
          servico={servico}
          assinatura={assinatura}
          onConfirmado={onPago}
          onVoltar={(assinatura || soCartao) ? onCancelar : () => setMetodo(null)}
        />
      )}
    </div>
  );
}
