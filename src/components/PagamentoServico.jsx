/**
 * PagamentoServico — Fluxo de pagamento para assessoria, Leilão Club e honorários.
 *
 * Props:
 *   servico: { id, nome, valor, descricao }
 *   onPago: (paymentId) => void
 *   onCancelar: () => void
 *
 * Fluxos:
 *   1. PIX direto (sem taxa) → QR code + chave → polling de confirmação
 *   2. Cartão de crédito → parcelado em até 12x (cliente absorve taxas)
 */

import React, { useState, useEffect, useRef } from 'react';
import { QrCode, CreditCard, CheckCircle2, Loader2, Copy, AlertCircle, ChevronLeft, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';

const MP_PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY || '';

const fmtBRL = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Taxa de parcelamento MP (aproximação — MP cobra ~2.99% + juros do emissor)
const calcParcelaMaisJuros = (valor, n) => {
  if (n === 1) return valor;
  const taxa = n <= 3 ? 0.0199 : n <= 6 ? 0.0249 : n <= 9 ? 0.0299 : 0.0349;
  const totalComTaxa = valor * Math.pow(1 + taxa, n / 12);
  return totalComTaxa / n;
};

const PARCELAS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const btn = (cor, texto, onClick, disabled, icon) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      width: '100%', padding: '14px 20px', background: disabled ? '#94a3b8' : cor,
      color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15,
      cursor: disabled ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center',
      justifyContent: 'center', gap: 8, transition: 'opacity .15s',
    }}
  >
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

      {/* PIX */}
      <button onClick={() => onEscolha('pix')} style={{
        width: '100%', padding: '18px 20px', background: 'white', border: '2px solid #e2e8f0',
        borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'border-color .15s',
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
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Sem taxas · Confirmação imediata</div>
          </div>
          <div style={{ background: '#dcfce7', color: '#059669', fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 6 }}>SEM TAXA</div>
        </div>
      </button>

      {/* Cartão */}
      <button onClick={() => onEscolha('cartao')} style={{
        width: '100%', padding: '18px 20px', background: 'white', border: '2px solid #e2e8f0',
        borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'border-color .15s',
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
  const [copiado, setCopiado] = useState(false);
  const [paymentId, setPaymentId] = useState(null);
  const [msgErro, setMsgErro] = useState('');
  const pollingRef = useRef(null);
  const tentativasRef = useRef(0);

  const PIX_KEY = import.meta.env.VITE_MP_PIX_KEY || process.env.MP_PIX_KEY || '';
  const PIX_TITULAR = import.meta.env.VITE_MP_PIX_TITULAR || 'TSN Ativos';

  // Cria payment PIX no MP para polling preciso
  useEffect(() => {
    (async () => {
      try {
        const data = await apiCall('/api/mp-checkout', {
          method: 'POST',
          body: JSON.stringify({
            valor: servico.valor,
            descricao: servico.nome,
            email: user?.email,
            metodoPagamento: 'pix',
          }),
        });
        if (data?.paymentId) setPaymentId(data.paymentId);
      } catch (e) {
        // silencioso — polling por valor como fallback
      }
    })();
  }, []);

  const verificar = async () => {
    if (etapa === 'confirmado') return;
    tentativasRef.current++;
    if (tentativasRef.current > 90) { // 12 min máximo
      clearInterval(pollingRef.current);
      setEtapa('erro');
      setMsgErro('Tempo limite atingido. Se já pagou, entre em contato com o suporte.');
      return;
    }
    try {
      const data = await apiCall('/api/mp-verificar-pix', {
        method: 'POST',
        body: JSON.stringify({
          paymentId: paymentId || undefined,
          valor: servico.valor,
          referencia: `tsn-${user?.id}-${servico.id}`,
        }),
      });
      if (data?.confirmado) {
        clearInterval(pollingRef.current);
        setEtapa('confirmado');
        setTimeout(() => onConfirmado(data.paymentId || paymentId), 1500);
      }
    } catch {/* ignora */ }
  };

  // Polling a cada 8s após cliente clicar "Já paguei"
  const iniciarPolling = () => {
    setEtapa('verificando');
    tentativasRef.current = 0;
    verificar();
    pollingRef.current = setInterval(verificar, 8000);
  };

  useEffect(() => () => clearInterval(pollingRef.current), []);

  const copiar = (texto) => {
    navigator.clipboard?.writeText(texto).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <button onClick={onVoltar} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, padding: 0 }}>
        <ChevronLeft size={16} /> Voltar
      </button>

      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 14, padding: '20px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 13, color: '#15803d', fontWeight: 600, marginBottom: 4 }}>Chave PIX</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', letterSpacing: 0.5, wordBreak: 'break-all' }}>
          {PIX_KEY || 'Configure VITE_MP_PIX_KEY'}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Titular: <strong>{PIX_TITULAR}</strong></div>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#059669', margin: '12px 0 4px' }}>{fmtBRL(servico.valor)}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>{servico.nome}</div>

        <button onClick={() => copiar(PIX_KEY)} style={{
          marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '8px 18px', background: 'white', border: '1px solid #bbf7d0',
          borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#059669',
        }}>
          <Copy size={14} />{copiado ? 'Copiado!' : 'Copiar chave'}
        </button>
      </div>

      <div style={{ fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 1.6 }}>
        Abra o app do seu banco, faça o PIX com o valor exato acima<br />e clique no botão abaixo quando concluir.
      </div>

      {etapa === 'erro' && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#dc2626' }}>{msgErro}</div>
        </div>
      )}

      {etapa === 'verificando'
        ? btn('#059669', 'Verificando pagamento...', null, true, <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />)
        : btn('#059669', 'Já realizei o pagamento →', iniciarPolling, false, <CheckCircle2 size={16} />)
      }

      {etapa === 'verificando' && (
        <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
          Consultando automaticamente a cada 8 segundos...
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}

/* ── Tela: Cartão ── */
function PagamentoCartao({ servico, onConfirmado, onVoltar }) {
  const { user } = useAuth();
  const [parcelas, setParcelas] = useState(1);
  const [form, setForm] = useState({ numero: '', nome: '', validade: '', cvv: '' });
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const [paymentId, setPaymentId] = useState(null);
  const pollingRef = useRef(null);

  const parcelaValor = calcParcelaMaisJuros(servico.valor, parcelas);
  const totalFinal = parcelaValor * parcelas;

  const upd = e => setForm(p => ({ ...p, [e.target.name]: e.target.value }));

  const formatarNumero = v => v.replace(/\D/g, '').replace(/(.{4})/g, '$1 ').trim().slice(0, 19);
  const formatarValidade = v => v.replace(/\D/g, '').replace(/^(\d{2})/, '$1/').slice(0, 5);

  const pagar = async () => {
    setErro('');
    if (!form.numero || !form.nome || !form.validade || !form.cvv) {
      setErro('Preencha todos os campos do cartão.');
      return;
    }

    // Tokenização via SDK MP
    if (!MP_PUBLIC_KEY) {
      setErro('Chave pública MP não configurada (VITE_MP_PUBLIC_KEY).');
      return;
    }

    setProcessando(true);
    try {
      // Carrega SDK MP dinamicamente se não estiver carregado
      if (!window.MercadoPago) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://sdk.mercadopago.com/js/v2';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }

      const mp = new window.MercadoPago(MP_PUBLIC_KEY);
      const [mesStr, anoStr] = form.validade.split('/');

      const token = await mp.createCardToken({
        cardNumber: form.numero.replace(/\s/g, ''),
        cardholderName: form.nome,
        cardExpirationMonth: mesStr,
        cardExpirationYear: `20${anoStr}`,
        securityCode: form.cvv,
      });

      if (!token?.id) throw new Error('Não foi possível tokenizar o cartão.');

      // Detecta bandeira
      const bin = form.numero.replace(/\s/g, '').slice(0, 6);
      const paymentMethodRes = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?bin=${bin}&public_key=${MP_PUBLIC_KEY}`);
      const pmData = await paymentMethodRes.json();
      const metodoPagamentoId = pmData.results?.[0]?.id || 'visa';

      const data = await apiCall('/api/mp-checkout', {
        method: 'POST',
        body: JSON.stringify({
          valor: totalFinal,
          descricao: `${servico.nome} (${parcelas}x)`,
          email: user?.email,
          metodoPagamento: 'credit_card',
          dadosCartao: { token: token.id, parcelas, metodoPagamentoId },
        }),
      });

      if (data?.status === 'approved' || data?.status === 'authorized') {
        onConfirmado(data.paymentId);
        return;
      }

      if (data?.status === 'in_process' && data?.paymentId) {
        setPaymentId(data.paymentId);
        // Polling para pagamento em análise
        pollingRef.current = setInterval(async () => {
          const check = await apiCall('/api/mp-verificar-pix', {
            method: 'POST',
            body: JSON.stringify({ paymentId: data.paymentId }),
          });
          if (check?.confirmado) {
            clearInterval(pollingRef.current);
            onConfirmado(data.paymentId);
          }
        }, 8000);
        setErro('Pagamento em análise. Aguarde...');
        return;
      }

      setErro('Pagamento não aprovado. Verifique os dados do cartão ou tente outro.');
    } catch (e) {
      console.error('[PagamentoCartao]', e.message);
      setErro(e.message || 'Erro ao processar pagamento.');
    } finally {
      setProcessando(false);
    }
  };

  useEffect(() => () => clearInterval(pollingRef.current), []);

  const inp = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' };
  const lbl = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <button onClick={onVoltar} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, padding: 0 }}>
        <ChevronLeft size={16} /> Voltar
      </button>

      {/* Seletor de parcelas */}
      <div>
        <label style={lbl}>Número de parcelas</label>
        <select value={parcelas} onChange={e => setParcelas(Number(e.target.value))} style={inp}>
          {PARCELAS.map(n => {
            const pv = calcParcelaMaisJuros(servico.valor, n);
            const total = pv * n;
            const taxa = n === 1 ? '' : ` (total ${fmtBRL(total)})`;
            return (
              <option key={n} value={n}>
                {n}× de {fmtBRL(pv)}{taxa}{n === 1 ? ' — sem juros' : ''}
              </option>
            );
          })}
        </select>
        {parcelas > 1 && (
          <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
            ⚠️ As taxas de parcelamento ({((calcParcelaMaisJuros(servico.valor, parcelas) * parcelas / servico.valor - 1) * 100).toFixed(1)}%) são assumidas pelo cliente.
          </div>
        )}
      </div>

      {/* Dados do cartão */}
      <div>
        <label style={lbl}>Número do cartão</label>
        <input style={inp} placeholder="0000 0000 0000 0000" name="numero"
          value={form.numero} onChange={e => setForm(p => ({ ...p, numero: formatarNumero(e.target.value) }))} />
      </div>

      <div>
        <label style={lbl}>Nome no cartão</label>
        <input style={inp} placeholder="COMO ESTÁ NO CARTÃO" name="nome"
          value={form.nome} onChange={upd} onInput={e => e.target.value = e.target.value.toUpperCase()} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={lbl}>Validade</label>
          <input style={inp} placeholder="MM/AA" name="validade"
            value={form.validade} onChange={e => setForm(p => ({ ...p, validade: formatarValidade(e.target.value) }))} />
        </div>
        <div>
          <label style={lbl}>CVV</label>
          <input style={inp} placeholder="000" name="cvv" maxLength={4}
            value={form.cvv} onChange={upd} />
        </div>
      </div>

      {erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#dc2626' }}>{erro}</div>
        </div>
      )}

      {btn('#0D63DB', processando ? 'Processando...' : `Pagar ${fmtBRL(totalFinal)}`, pagar, processando,
        processando ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CreditCard size={16} />
      )}

      <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
        Seus dados são criptografados pelo Mercado Pago · Não armazenamos dados do cartão
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}

/* ── Componente principal ── */
export default function PagamentoServico({ servico, onPago, onCancelar }) {
  const [metodo, setMetodo] = useState(null); // null | 'pix' | 'cartao'

  const handleConfirmado = (paymentId) => {
    onPago?.(paymentId);
  };

  return (
    <div style={{
      background: 'white', borderRadius: 16, padding: '28px 24px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.10)', maxWidth: 460, margin: '0 auto',
    }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Finalizar pagamento</div>
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
        <PagamentoPIX servico={servico} onConfirmado={handleConfirmado} onVoltar={() => setMetodo(null)} />
      )}

      {metodo === 'cartao' && (
        <PagamentoCartao servico={servico} onConfirmado={handleConfirmado} onVoltar={() => setMetodo(null)} />
      )}
    </div>
  );
}
