import React, { useState, useEffect, useRef } from 'react';

const EXPIRA_EM = '2026-06-26'; // mesmo valor da API
const MP_PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY || '';

function encerrado() {
  const hoje = new Date();
  const limite = new Date(EXPIRA_EM + 'T23:59:59-03:00');
  return hoje > limite;
}

function formatBRL(v) {
  const num = parseFloat(String(v).replace(/\D/g, '')) / 100;
  if (isNaN(num)) return '';
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function rawValor(str) {
  const digits = str.replace(/\D/g, '');
  return digits ? parseFloat(digits) / 100 : 0;
}

// ── Tela de encerramento ──────────────────────────────────────────────────────
function Encerrado() {
  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>🎉</div>
        <h2 style={{ margin: 0, color: '#111', fontWeight: 900 }}>Festa encerrada!</h2>
        <p style={{ color: '#64748b', marginTop: 8 }}>Esta página de pagamento não está mais disponível.</p>
      </div>
    </div>
  );
}

// ── QR Code PIX ──────────────────────────────────────────────────────────────
function PagamentoPix({ valor, onVoltar }) {
  const [estado, setEstado] = useState('idle'); // idle | carregando | ok | erro
  const [qrBase64, setQrBase64] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [payerEmail, setPayerEmail] = useState('');

  async function gerarPix() {
    if (!payerEmail.includes('@')) { alert('Informe um e-mail válido para o comprovante.'); return; }
    setEstado('carregando');
    try {
      const res = await fetch('/api/festa-pagamento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ valor, metodo: 'pix', payerEmail }),
      });
      const data = await res.json();
      if (!res.ok || !data.qrCode) throw new Error(data.error || 'Erro ao gerar PIX');
      setQrBase64(data.qrCodeBase64);
      setQrCode(data.qrCode);
      setEstado('ok');
    } catch (e) {
      alert(e.message);
      setEstado('idle');
    }
  }

  function copiar() {
    navigator.clipboard.writeText(qrCode).then(() => {
      setCopiado(true);
      setTimeout(() => setCopiado(false), 3000);
    });
  }

  if (estado === 'ok') {
    return (
      <div style={styles.card}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Valor</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: '#111' }}>{formatBRL(String(Math.round(valor * 100)))}</div>
        </div>
        {qrBase64 && (
          <img src={`data:image/png;base64,${qrBase64}`} alt="QR PIX"
            style={{ width: 220, height: 220, display: 'block', margin: '0 auto 16px', borderRadius: 12, border: '1px solid #e2e8f0' }} />
        )}
        <button onClick={copiar} style={{ ...styles.btn, background: copiado ? '#16a34a' : '#0D63DB', marginBottom: 8 }}>
          {copiado ? '✓ Código copiado!' : 'Copiar código PIX'}
        </button>
        {qrCode && (
          <div style={{ fontSize: 9, color: '#94a3b8', wordBreak: 'break-all', background: '#f8fafc', borderRadius: 6, padding: '6px 8px', marginBottom: 12, maxHeight: 60, overflow: 'hidden' }}>
            {qrCode.slice(0, 120)}…
          </div>
        )}
        <button onClick={onVoltar} style={{ ...styles.btn, background: '#f1f5f9', color: '#475569' }}>← Novo pagamento</button>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <button onClick={onVoltar} style={styles.btnVoltar}>← Voltar</button>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <div style={{ fontSize: 40 }}>🏦</div>
        <h3 style={{ margin: '8px 0 4px', fontWeight: 900 }}>Pagamento via PIX</h3>
        <div style={{ fontSize: 24, fontWeight: 900, color: '#0D63DB' }}>{formatBRL(String(Math.round(valor * 100)))}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>Taxa do Mercado Pago deduzida do recebido</div>
      </div>
      <label style={styles.label}>E-mail para comprovante</label>
      <input
        type="email"
        placeholder="email@exemplo.com"
        value={payerEmail}
        onChange={e => setPayerEmail(e.target.value)}
        style={styles.input}
      />
      <button onClick={gerarPix} disabled={estado === 'carregando'} style={{ ...styles.btn, background: '#0D63DB', marginTop: 8 }}>
        {estado === 'carregando' ? 'Gerando QR Code…' : 'Gerar QR Code PIX'}
      </button>
    </div>
  );
}

// ── Cartão de Crédito via MP Bricks ──────────────────────────────────────────
function PagamentoCartao({ valor, onVoltar }) {
  const brickRef = useRef(null);
  const [estado, setEstado] = useState('carregando'); // carregando | pronto | processando | ok | erro
  const [msgErro, setMsgErro] = useState('');
  const [resultado, setResultado] = useState(null);

  useEffect(() => {
    let mp;
    let controller = new AbortController();

    async function init() {
      // Carrega SDK MP se ainda não carregado
      if (!window.MercadoPago) {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://sdk.mercadopago.com/js/v2';
          s.onload = resolve;
          s.onerror = reject;
          document.head.appendChild(s);
        });
      }
      if (controller.signal.aborted) return;

      const publicKey = MP_PUBLIC_KEY || window.__MP_PUBLIC_KEY__;
      if (!publicKey) {
        setMsgErro('Chave pública MP não configurada.');
        setEstado('erro');
        return;
      }

      mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      const bricks = mp.bricks();

      await bricks.create('cardPayment', 'mp-card-brick', {
        initialization: {
          amount: valor,
          payer: { email: '' },
        },
        customization: {
          visual: { style: { theme: 'default' } },
          paymentMethods: {
            maxInstallments: 12,
          },
        },
        callbacks: {
          onReady: () => setEstado('pronto'),
          onError: (e) => {
            console.error('[festa-cartao]', e);
            setMsgErro('Erro no formulário do cartão.');
            setEstado('erro');
          },
          onSubmit: async (formData) => {
            setEstado('processando');
            try {
              const res = await fetch('/api/festa-pagamento', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  valor,
                  metodo: 'credit_card',
                  token: formData.token,
                  parcelas: formData.installments,
                  metodoPagamentoId: formData.payment_method_id,
                  payerEmail: formData.payer?.email || 'comprador@festadacolheita.com',
                }),
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || 'Pagamento recusado');
              setResultado(data);
              setEstado('ok');
            } catch (e) {
              setMsgErro(e.message);
              setEstado('erro');
            }
          },
        },
      });
    }

    init().catch(e => {
      setMsgErro('Erro ao carregar formulário: ' + e.message);
      setEstado('erro');
    });

    return () => { controller.abort(); };
  }, [valor]);

  if (estado === 'ok' && resultado) {
    const aprovado = resultado.status === 'approved';
    return (
      <div style={styles.card}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 52, marginBottom: 8 }}>{aprovado ? '✅' : '⏳'}</div>
          <h3 style={{ margin: '0 0 8px', fontWeight: 900, color: aprovado ? '#16a34a' : '#92400e' }}>
            {aprovado ? 'Pagamento aprovado!' : 'Pagamento em processamento'}
          </h3>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0D63DB', marginBottom: 4 }}>{formatBRL(String(Math.round(valor * 100)))}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>ID: {resultado.paymentId}</div>
        </div>
        <button onClick={onVoltar} style={{ ...styles.btn, background: '#f1f5f9', color: '#475569', marginTop: 20 }}>← Novo pagamento</button>
      </div>
    );
  }

  if (estado === 'erro') {
    return (
      <div style={styles.card}>
        <div style={{ textAlign: 'center', color: '#dc2626', marginBottom: 16 }}>
          <div style={{ fontSize: 36 }}>❌</div>
          <p style={{ fontWeight: 700 }}>{msgErro || 'Erro no pagamento'}</p>
        </div>
        <button onClick={() => { setEstado('carregando'); setMsgErro(''); }} style={{ ...styles.btn, background: '#0D63DB', marginBottom: 8 }}>Tentar novamente</button>
        <button onClick={onVoltar} style={{ ...styles.btn, background: '#f1f5f9', color: '#475569' }}>← Voltar</button>
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <button onClick={onVoltar} style={styles.btnVoltar}>← Voltar</button>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <div style={{ fontSize: 40 }}>💳</div>
        <h3 style={{ margin: '8px 0 4px', fontWeight: 900 }}>Cartão de Crédito</h3>
        <div style={{ fontSize: 24, fontWeight: 900, color: '#0D63DB' }}>{formatBRL(String(Math.round(valor * 100)))}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>À vista: taxa deduzida · 2x ou mais: juros assumidos pelo pagador</div>
      </div>
      {estado === 'carregando' && (
        <div style={{ textAlign: 'center', color: '#64748b', padding: 20 }}>Carregando formulário…</div>
      )}
      {estado === 'processando' && (
        <div style={{ textAlign: 'center', color: '#0D63DB', padding: 20, fontWeight: 700 }}>Processando pagamento…</div>
      )}
      <div id="mp-card-brick" ref={brickRef} />
    </div>
  );
}

// ── Tela principal ────────────────────────────────────────────────────────────
export default function Festa() {
  const [valorRaw, setValorRaw] = useState(''); // string de dígitos
  const [tela, setTela] = useState('home'); // home | pix | cartao

  if (encerrado()) return <Encerrado />;

  const valorNum = rawValor(valorRaw);
  const valorValido = valorNum >= 1;

  function handleValorChange(e) {
    const digits = e.target.value.replace(/\D/g, '');
    setValorRaw(digits);
  }

  function voltar() { setTela('home'); }

  if (tela === 'pix') return (
    <div style={styles.wrap}>
      <PagamentoPix valor={valorNum} onVoltar={voltar} />
    </div>
  );

  if (tela === 'cartao') return (
    <div style={styles.wrap}>
      <PagamentoCartao valor={valorNum} onVoltar={voltar} />
    </div>
  );

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        {/* Cabeçalho */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 52, marginBottom: 6 }}>🌾</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: '#111' }}>Festa da Colheita</h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: '#64748b' }}>Escola dos meus filhos · 2026</p>
        </div>

        {/* Campo de valor */}
        <label style={styles.label}>Valor a cobrar</label>
        <input
          type="tel"
          inputMode="numeric"
          placeholder="R$ 0,00"
          value={valorRaw ? formatBRL(valorRaw) : ''}
          onChange={handleValorChange}
          style={{ ...styles.input, fontSize: 28, fontWeight: 900, textAlign: 'center', color: '#0D63DB', letterSpacing: 1 }}
        />

        {/* Botões de pagamento */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 20 }}>
          <button
            onClick={() => setTela('pix')}
            disabled={!valorValido}
            style={{
              ...styles.btn,
              background: valorValido ? '#00b4d8' : '#e2e8f0',
              color: valorValido ? 'white' : '#94a3b8',
              fontSize: 17,
              padding: '16px',
            }}
          >
            🏦 Pagar com PIX
          </button>
          <button
            onClick={() => setTela('cartao')}
            disabled={!valorValido}
            style={{
              ...styles.btn,
              background: valorValido ? '#0D63DB' : '#e2e8f0',
              color: valorValido ? 'white' : '#94a3b8',
              fontSize: 17,
              padding: '16px',
            }}
          >
            💳 Pagar com Cartão
          </button>
        </div>

        {!valorValido && valorRaw !== '' && (
          <p style={{ textAlign: 'center', color: '#dc2626', fontSize: 12, marginTop: 8 }}>Valor mínimo R$ 1,00</p>
        )}

        <div style={{ marginTop: 24, padding: '12px', background: '#f8fafc', borderRadius: 10, fontSize: 11, color: '#94a3b8', lineHeight: 1.6 }}>
          <strong style={{ color: '#475569' }}>Taxas:</strong><br />
          PIX e crédito à vista → taxa descontada do recebido<br />
          Crédito 2x ou mais → juros assumidos pelo pagador
        </div>
      </div>
    </div>
  );
}

// ── Estilos ───────────────────────────────────────────────────────────────────
const styles = {
  wrap: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #fef9c3 0%, #fde68a 50%, #fbbf24 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  card: {
    background: 'white',
    borderRadius: 20,
    padding: '28px 24px',
    width: '100%',
    maxWidth: 380,
    boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
  },
  btn: {
    width: '100%',
    padding: '13px',
    border: 'none',
    borderRadius: 12,
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
  },
  btnVoltar: {
    background: 'none',
    border: 'none',
    color: '#64748b',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    padding: '0 0 12px',
    display: 'block',
  },
  label: {
    display: 'block',
    fontSize: 11,
    fontWeight: 700,
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  input: {
    width: '100%',
    padding: '12px 14px',
    border: '1.5px solid #e2e8f0',
    borderRadius: 10,
    fontSize: 16,
    outline: 'none',
    boxSizing: 'border-box',
  },
};
