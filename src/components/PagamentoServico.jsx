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

import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { useCartaoSeguroMP } from '../utils/cartaoSeguroMP';
import { QrCode, CreditCard, CheckCircle2, Loader2, Copy, AlertCircle, ChevronLeft, ArrowRight } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';

const MP_PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY || '';

const fmtBRL = v => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Fingerprint do dispositivo pro motor antifraude do MP (21/09, achado na auditoria de
// qualidade de integração): o próprio SDK (já carregado aqui pra tokenizar cartão) publica
// o valor em window.MP_DEVICE_SESSION_ID, mas o preenchimento não é síncrono — sonda por
// até 1,5s antes de desistir. Ausência não bloqueia o pagamento, só aprova sem o dado extra.
export function obterDeviceId() {
  return new Promise(resolve => {
    const tentativas = 15;
    let i = 0;
    const check = () => {
      if (window.MP_DEVICE_SESSION_ID) return resolve(window.MP_DEVICE_SESSION_ID);
      if (++i >= tentativas) return resolve(null);
      setTimeout(check, 100);
    };
    check();
  });
}

// `semJurosAte` é 3 por padrão (assessoria, Leilão Club, etc. — decisão do dono de 16/09);
// os honorários de êxito passam 1 (18/09): só PIX ou 1x sem juros, 2x em diante já assume.
const calcParcelaMaisJuros = (valor, n, semJurosAte = 3) => {
  if (n <= semJurosAte) return valor / n;
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
// ocultarResumo: quando o chamador já mostra valor/nome do serviço em destaque logo acima
// (ex.: PagarHonorario.jsx), repetir aqui é redundante — pula direto pras opções.
// permitirSplit (18/09): mostra a 3ª opção "Pix + Cartão" — só faz sentido em cobranças que
// suportam saldo em partes (honorário de êxito, cobrança avulsa); assessoria/planos não.
function EscolhaMetodo({ servico, onEscolha, ocultarResumo = false, permitirSplit = false }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {!ocultarResumo && (
        <div style={{ textAlign: 'center', padding: '8px 0 20px' }}>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Valor a pagar</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#0f172a' }}>{fmtBRL(servico.valor)}</div>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{servico.nome}</div>
        </div>
      )}

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

      {permitirSplit && (
        <button onClick={() => onEscolha('split')} style={{
          width: '100%', padding: '18px 20px', background: 'white', border: '2px solid #e2e8f0',
          borderRadius: 14, cursor: 'pointer', textAlign: 'left',
        }}
          onMouseEnter={e => e.currentTarget.style.borderColor = '#7c3aed'}
          onMouseLeave={e => e.currentTarget.style.borderColor = '#e2e8f0'}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, background: '#faf5ff', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <QrCode size={18} color="#7c3aed" style={{ marginRight: -4 }} /><CreditCard size={18} color="#7c3aed" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Pix + Cartão</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Paga parte agora no Pix, o resto no cartão</div>
            </div>
            <ArrowRight size={16} color="#94a3b8" />
          </div>
        </button>
      )}
    </div>
  );
}

/* ── Tela: PIX ── */
// tituloConfirmado/subtituloConfirmado: usados no fluxo Pix+Cartão (18/09) — este Pix pode
// ser só uma PARTE do total, então "Pagamento confirmado! Redirecionando..." (que soa como
// "acabou tudo") fica errado; o chamador passa um texto de transição pro cartão.
function PagamentoPIX({ servico, onConfirmado, onVoltar, extra = {}, email: emailProp, ocultarResumo = false, tituloConfirmado = 'Pagamento confirmado!', subtituloConfirmado = 'Redirecionando...' }) {
  const { user } = useAuth();
  const email = emailProp || user?.email;
  const [etapa, setEtapa] = useState('gerando'); // gerando | pronto | confirmado | erro | expirado
  const [copiado, setCop] = useState('');
  const [msgErro, setMsgErro] = useState('');
  const [pix, setPix] = useState(null); // { paymentId, qrCode, qrCodeBase64 }
  const pollingRef = useRef(null);
  const tentRef = useRef(0);
  const criouRef = useRef(false);

  // PIX DINÂMICO do Mercado Pago (pagamento REAL com metadata.user_id) — assim o
  // mp-verificar-pix confirma AUTOMÁTICO por paymentId. Substitui o QR estático da chave,
  // que não dava para atribuir com segurança (dois pagamentos de mesmo valor se confundiam)
  // e por isso virava confirmação MANUAL. O cliente paga o valor cheio, sem taxa a mais;
  // a taxa do PIX (recebimento) fica com a plataforma.
  const criarPix = async () => {
    if (criouRef.current) return;
    criouRef.current = true;
    setEtapa('gerando'); setMsgErro('');
    try {
      const res = await apiCall('/api/mp-checkout', {
        method: 'POST',
        body: JSON.stringify({
          valor: servico.valor,
          descricao: servico.nome || servico.descricao || 'Pagamento BidPro Brasil',
          email,
          metodoPagamento: 'pix',
          proposito: servico.proposito || 'servico',
          ...extra,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.qrCode) {
        setEtapa('erro');
        setMsgErro(data?.error || 'Não foi possível gerar o PIX agora. Tente de novo ou use o cartão.');
        criouRef.current = false; // libera nova tentativa
        return;
      }
      setPix({ paymentId: data.paymentId, qrCode: data.qrCode, qrCodeBase64: data.qrCodeBase64 });
      setEtapa('pronto');
      iniciarPolling(data.paymentId); // já começa a checar — confirma sozinho ao pagar
    } catch {
      setEtapa('erro');
      setMsgErro('Falha de conexão ao gerar o PIX. Tente novamente.');
      criouRef.current = false;
    }
  };

  const verificar = async (pid) => {
    tentRef.current++;
    if (tentRef.current > 115) { // ~15 min (a validade do QR PIX do MP é ~30min)
      clearInterval(pollingRef.current);
      setEtapa('expirado');
      setMsgErro('O código PIX expirou. Gere um novo para pagar.');
      return;
    }
    try {
      const res = await apiCall('/api/mp-verificar-pix', {
        method: 'POST',
        body: JSON.stringify({ paymentId: pid }),
      });
      if (!res.ok) return; // falha transitória → tenta de novo no próximo ciclo
      const data = await res.json().catch(() => null);
      if (data?.confirmado) {
        clearInterval(pollingRef.current);
        setEtapa('confirmado');
        setTimeout(() => onConfirmado(pid), 1500);
      }
    } catch { /* ignora, tenta de novo */ }
  };

  const iniciarPolling = (pid) => {
    tentRef.current = 0;
    clearInterval(pollingRef.current);
    pollingRef.current = setInterval(() => verificar(pid), 8000);
  };

  useEffect(() => { criarPix(); return () => clearInterval(pollingRef.current); }, []);

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
        <div style={{ fontSize: 20, fontWeight: 800, color: '#059669' }}>{tituloConfirmado}</div>
        <div style={{ fontSize: 14, color: '#64748b', marginTop: 8 }}>{subtituloConfirmado}</div>
      </div>
    );
  }

  const qrImg = pix?.qrCodeBase64 ? `data:image/png;base64,${pix.qrCodeBase64}` : null;
  const novoBtn = (
    <button onClick={() => { criouRef.current = false; criarPix(); }} style={{ width: '100%', padding: '14px', background: '#059669', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <QrCode size={16} /> Gerar novo PIX
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <button onClick={onVoltar} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, padding: 0 }}>
        <ChevronLeft size={16} /> Voltar
      </button>

      {/* Valor destaque (pulado quando o chamador já mostra valor/nome acima) */}
      {!ocultarResumo && (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#059669' }}>{fmtBRL(servico.valor)}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>{servico.nome}</div>
        </div>
      )}

      {etapa === 'gerando' && (
        <div style={{ textAlign: 'center', padding: '28px 0', color: '#64748b', fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <Loader2 size={28} color="#059669" style={{ animation: 'spin 1s linear infinite' }} />
          Gerando seu PIX…
        </div>
      )}

      {(etapa === 'erro' || etapa === 'expirado') && (
        <>
          {msgErro && (
            <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13, color: '#dc2626' }}>{msgErro}</div>
            </div>
          )}
          {novoBtn}
        </>
      )}

      {etapa === 'pronto' && pix && (
        <>
          {qrImg && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              <img src={qrImg} alt="QR Code PIX" width={210} height={210} style={{ borderRadius: 12, border: '1px solid #e2e8f0' }} />
              <div style={{ fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                Aponte a câmera do app do seu banco para o QR code
              </div>
            </div>
          )}

          {/* PIX Copia e Cola (código do MP, não a chave) */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>PIX Copia e Cola</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0, fontSize: 11, color: '#64748b', wordBreak: 'break-all', fontFamily: 'monospace' }}>{pix.qrCode.slice(0, 42)}…</div>
              <button onClick={() => copiar(pix.qrCode, 'brcode')} style={{
                flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 14px', background: copiado === 'brcode' ? '#dcfce7' : 'white',
                border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer',
                fontSize: 13, fontWeight: 600, color: copiado === 'brcode' ? '#059669' : '#374151',
              }}>
                <Copy size={13} />{copiado === 'brcode' ? 'Copiado!' : 'Copiar'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#059669', fontSize: 13, fontWeight: 600 }}>
            <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
            Aguardando pagamento — confirma automático
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
            Assim que você pagar, a confirmação aparece aqui sozinha. Não feche esta tela.
          </div>
        </>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}

/* ── Tela: Cartão ── */
// assinatura=true → cria uma assinatura recorrente TRANSPARENTE (preapproval do MP)
// via /api/mp; sem parcelas (cobrança mensal do valor cheio). Caso contrário, é o
// pagamento único via /api/mp-checkout (parcelável).
function PagamentoCartao({ servico, onConfirmado, onVoltar, assinatura = false, onGatewayBloqueado = null, parcelasMax = 12, parcelasSemJuros = 3, extra = {}, email: emailProp }) {
  const { user } = useAuth();
  const email = emailProp || user?.email;
  const [parcelas, setParcelas] = useState(1);
  // Número/validade/CVV são Secure Fields do MP (24/09) — só o nome no cartão fica em estado nosso.
  const [form, setForm] = useState({ nome: '' });
  const cartao = useCartaoSeguroMP(true, `svc${useId().replace(/:/g, '')}`);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState('');
  const pollingRef = useRef(null);

  const parcelaValor = assinatura ? servico.valor : calcParcelaMaisJuros(servico.valor, parcelas, parcelasSemJuros);
  const totalFinal = assinatura ? servico.valor : parcelaValor * parcelas;

  // Fallback Asaas (18/09, pedido do dono) — MESMO padrão que Checkout.jsx já usa pra
  // assinatura de plano ("Continuar pelo Asaas" com 1 clique), estendido aqui pros dois
  // fluxos sem login que api/asaas.js sabe cobrar (ver ação 'criar_cobranca_fallback'):
  // honorário de êxito e cobrança avulsa. Sem isso, uma recusa REAL do MP (não só bloqueio
  // de SDK) virava beco sem saída — precisava alguém gerar um link à parte manualmente
  // (achado real, 17/09: cliente recusado 4x, escalado até o dono).
  const propositoFallback = extra.arrematacao_id ? 'honorario_exito' : extra.cobranca_id ? 'cobranca_avulsa' : null;
  const [mostrarAsaas, setMostrarAsaas] = useState(false);
  const [cpfAsaas, setCpfAsaas] = useState('');
  // Endereço completo — exigido pelo Asaas pra emissão de NF (18/09, pedido do dono). Mesmos
  // campos/formato de src/pages/Checkout.jsx (salvarDadosFaturamento), pra cair no mesmo
  // padrão de perfis.endereco_* quando o backend atualiza o cadastro.
  const [endAsaas, setEndAsaas] = useState({ cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' });
  const [cepLoadingAsaas, setCepLoadingAsaas] = useState(false);
  const [enviandoAsaas, setEnviandoAsaas] = useState(false);
  const [linkAsaasGerado, setLinkAsaasGerado] = useState(false);

  const buscarCepAsaas = async (cepRaw) => {
    const cep = (cepRaw || '').replace(/\D/g, '');
    if (cep.length !== 8) return;
    setCepLoadingAsaas(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json(); // padrao-ok: ViaCEP sempre responde 200 (mesmo p/ CEP inexistente, com {erro:true}) — só preenchimento automático, campos seguem editáveis manualmente
      if (!j.erro) setEndAsaas(p => ({ ...p, cep, logradouro: j.logradouro || p.logradouro, bairro: j.bairro || p.bairro, cidade: j.localidade || p.cidade, uf: j.uf || p.uf }));
    } catch (e) { console.error('[PagamentoServico] busca CEP:', e?.message || e); } // padrao-ok: CEP offline, cliente preenche manualmente — não bloqueia o fluxo
    setCepLoadingAsaas(false);
  };
  const enderecoAsaasOk = !!(endAsaas.cep && endAsaas.logradouro && endAsaas.numero && endAsaas.bairro && endAsaas.cidade && endAsaas.uf);

  const pagarViaAsaas = async () => {
    const cpfLimpo = cpfAsaas.replace(/\D/g, '');
    if (cpfLimpo.length !== 11) { setErro('Informe um CPF válido para continuar pelo Asaas.'); return; }
    if (!enderecoAsaasOk) { setErro('Informe o endereço completo (CEP, logradouro, número, bairro, cidade e UF) — necessário para emissão de nota fiscal.'); return; }
    setEnviandoAsaas(true);
    setErro('');
    try {
      const res = await apiCall('/api/asaas', {
        method: 'POST',
        body: JSON.stringify({
          action: 'criar_cobranca_fallback',
          proposito: propositoFallback,
          arrematacao_id: extra.arrematacao_id,
          cobranca_id: extra.cobranca_id,
          nome: form.nome || email,
          email,
          cpf: cpfLimpo,
          endereco: endAsaas,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.linkPagamento) throw new Error(data?.mensagem || data?.error || 'Não foi possível gerar a cobrança pelo Asaas.');
      window.open(data.linkPagamento, '_blank', 'noopener');
      setLinkAsaasGerado(true);
    } catch (e) {
      setErro(e.message || 'Erro ao gerar cobrança pelo Asaas.');
    } finally {
      setEnviandoAsaas(false);
    }
  };


  const pagar = async () => {
    setErro('');
    if (!form.nome.trim()) {
      setErro('Informe o nome impresso no cartão.');
      return;
    }
    if (!MP_PUBLIC_KEY) {
      setErro('Chave pública MP não configurada (VITE_MP_PUBLIC_KEY).');
      return;
    }
    setProcessando(true);
    try {
      // Secure Fields (24/09): o token sai dos campos do MP montados no formulário — o número do
      // cartão não passa pelo nosso código. Bloqueio do SDK chega aqui com `sdkBloqueado`,
      // exatamente como antes (cai no Asaas quando o fluxo permite).
      const token = await cartao.tokenizar({ cardholderName: form.nome.trim() });
      const deviceId = await obterDeviceId();

      // ── Assinatura recorrente transparente (preapproval) ──────────────────
      if (assinatura) {
        const planoKey = servico.plano || servico.id;
        const res = await apiCall('/api/mp', {
          method: 'POST',
          body: JSON.stringify({
            action: 'criar_assinatura_transparente',
            plano: planoKey,
            email,
            cardTokenId: token.id,
            deviceId,
          }),
        });
        const data = await res.json();
        // `assinaturaRecusada` (18/09): recusa REAL do mandato (não criou/não autorizou) —
        // diferente de `sdkBloqueado` (SDK/fetch barrado por extensão), mas mesmo destino:
        // nenhum mandato ficou ativo no MP (só `authorized` é mandato de verdade, tratado
        // abaixo), então trocar de gateway aqui é SEGURO, sem risco de duplo-mandato. Sem
        // esta marca, `assinatura recorrente com cartão embutido` (top2 mensal) era o único
        // caminho de assinatura sem plano B numa recusa real (HANDOFF 18/09, pendência #1).
        if (!res.ok) throw Object.assign(new Error(data.error || 'Falha ao criar a assinatura.'), { assinaturaRecusada: true });
        // `authorized` É MANDATO, NÃO PAGAMENTO (16/08). O MP valida o cartão com uma
        // transação de R$ 0,00 e devolve `authorized` na hora; a primeira cobrança é
        // assíncrona e pode ser recusada minutos depois — no 1º assinante Pro veio 22
        // minutos depois e foi recusada por antifraude, com zero real recebido.
        // Chamar `onConfirmado` aqui fazia a tela dizer "Pagamento aprovado" E disparava
        // o evento Purchase para Meta Pixel e Google Ads, ou seja, ensinava as campanhas
        // a otimizar por venda que não aconteceu. Os dois estados agora convergem na
        // mesma mensagem honesta: quem libera o plano é o webhook, com dinheiro na conta.
        if (data.status === 'authorized' || data.status === 'pending') {
          setErro('Assinatura em processamento. Assim que o pagamento for confirmado, seu plano é liberado automaticamente — você recebe um e-mail no mesmo instante.');
          return;
        }
        throw Object.assign(new Error('Não foi possível autorizar a assinatura. Verifique os dados do cartão ou tente outro.'), { assinaturaRecusada: true });
      }

      // A bandeira vem do lookup do próprio BIN no MP — nunca chutar. Achado 17/09: um
      // fallback fixo em 'visa' aqui mandava o ID errado pro MP sempre que o lookup não
      // achava a bandeira real (cartão não-Visa cujo BIN o MP não reconheceu), e o MP
      // recusa com HTTP 400 "Invalid payment_method_id" — indistinguível, pro cliente, de
      // "seu cartão foi recusado", mas o problema era nosso chute, não o cartão dele
      // (4 tentativas seguidas, mesmo erro exato, dados conferidos como corretos).
      // BIN do evento binChange dos Secure Fields; se não veio, o próprio token traz os 6 primeiros
      // dígitos (`first_six_digits`). Nunca lemos o número do cartão.
      const bin = cartao.bin || token?.first_six_digits || '';
      let metodoPagamentoId;
      try {
        const pmRes = await fetch(`https://api.mercadopago.com/v1/payment_methods/search?bin=${bin}&public_key=${MP_PUBLIC_KEY}`);
        const pmData = await pmRes.json();
        metodoPagamentoId = pmData.results?.[0]?.id;
      } catch { /* padrao-ok: segue para o erro explícito abaixo — nunca chuta bandeira */ }
      if (!metodoPagamentoId) {
        throw new Error('Não conseguimos reconhecer a bandeira deste cartão. Confira o número digitado ou tente outro cartão.');
      }

      // apiCall devolve o Response CRU: checar res.ok e ler o JSON. Antes o código lia
      // Response.status (o código HTTP) como se fosse o status do pagamento → nunca batia
      // 'approved' e caía em "não aprovado" mesmo com o cartão já cobrado (cobrança dupla).
      const res = await apiCall('/api/mp-checkout', {
        method: 'POST',
        body: JSON.stringify({
          valor: totalFinal,
          descricao: `${servico.nome} (${parcelas}x)`,
          email,
          metodoPagamento: 'credit_card',
          dadosCartao: { token: token.id, parcelas, metodoPagamentoId },
          deviceId,
          // Marca a INTENÇÃO (recarga vs. serviço) para o confirmador correto aceitar.
          proposito: servico.proposito || 'servico',
          // produto_bonus (12/09): identifica QUAL produto — /api/mp-checkout usa isso pra
          // chamar comprar_produto_iniciar e cobrar o preço que o servidor calcular, nunca
          // o `valor` daqui. Ausente em qualquer outro propósito (undefined não vai no JSON).
          ...(servico.produto_tipo && servico.produto_id
            ? { produto_tipo: servico.produto_tipo, produto_id: servico.produto_id, ref: servico.ref, manterAssinatura: servico.manterAssinatura }
            : {}),
          ...extra,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível processar o pagamento. Tente novamente.');

      // O MESMO ERRO NO PAGAMENTO AVULSO — assessoria, Clube, produtos e recarga (16/08).
      // Em pagamento simples, `authorized` significa valor AUTORIZADO E NÃO CAPTURADO:
      // `captured: false`, `status_detail: 'pending_capture'`, `net_received_amount: 0`.
      // É dinheiro reservado no cartão, não dinheiro recebido — e a captura pode não vir.
      // Só `approved` é caixa. `authorized` entra no MESMO polling do `in_process`, que
      // já existia e só confirma quando o servidor diz `confirmado`.
      if (data?.status === 'approved') {
        onConfirmado(data.paymentId);
        return;
      }
      if ((data?.status === 'in_process' || data?.status === 'authorized') && data?.paymentId) {
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
      // 18/09 (HANDOFF pendência #1): recusa real no pagamento AVULSO com cartão embutido
      // (ex.: assessoria à vista/parcelado — `assinatura=false`) tinha o mesmo beco sem saída
      // do preapproval: sem `arrematacao_id`/`cobranca_id` (que só honorário/cobrança avulsa
      // têm), `propositoFallback` nunca fica truthy e `mostrarAsaas` nunca aparece. Quando o
      // chamador passa `onGatewayBloqueado` (Checkout.jsx faz isso pra assessoria, mesma
      // função `pagarAsaas` já usada pra assinatura), usa o MESMO caminho — troca de gateway
      // com os dados que o Checkout já tem, sem pedir CPF/endereço de novo aqui.
      if (propositoFallback) setMostrarAsaas(true);
      else if (onGatewayBloqueado) onGatewayBloqueado();
    } catch (e) {
      // Achado 04/09: mesma classe de falha do assinarComCadastro (Checkout.jsx) - SDK barrado
      // ou createCardToken bloqueado (adblock/privacidade) -, so que aqui a assinatura nao tem
      // Pix como alternativa (so cartao) nem fallback automatico. Um usuario real (user_id
      // 60aaf3fc...) tentou de 06/08 a 03/09 e sempre recebeu "Failed to fetch" cru, sem saber
      // o motivo nem ter saida. Detecta o mesmo padrao e, havendo onGatewayBloqueado (so passado
      // no fluxo de assinatura por Checkout.jsx), troca para Asaas - seguro porque nada foi
      // cobrado ainda neste ponto (sem risco de duplo-mandato).
      const m = String(e?.message || '');
      const bloqueado = e?.sdkBloqueado || /failed to fetch|load failed|networkerror|net::err|fetch/i.test(m);
      // 18/09 (HANDOFF pendência #1): recusa REAL do mandato (`assinaturaRecusada`, marcada
      // acima) tem o MESMO destino do SDK bloqueado — nenhum mandato ficou ativo no MP, então
      // cair pro Asaas aqui é seguro. Antes só `bloqueado` disparava isto; uma recusa de
      // verdade (cartão sem saldo/limite, antifraude) virava beco sem saída no cartão
      // embutido de assinatura (Investidor Pro mensal) — o único caminho sem plano B.
      if ((bloqueado || e?.assinaturaRecusada) && assinatura && onGatewayBloqueado) { onGatewayBloqueado(); return; }
      setErro(bloqueado
        ? 'Não conseguimos processar o cartão (ele costuma ser barrado por bloqueador de anúncios ou extensão de privacidade). Desative para este site e tente de novo.'
        : (m || 'Erro ao processar pagamento.'));
      // Recusa real (não bloqueio de SDK) num fluxo com fallback Asaas disponível — oferece
      // na hora, sem precisar de alguém gerar um link à parte manualmente.
      if (!bloqueado && propositoFallback) setMostrarAsaas(true);
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
      ) : parcelasMax <= 1 ? (
        // Pagamento único (ex.: bônus a preço promocional) — parcelar não faz sentido e o
        // servidor cobra sempre em 1x, então nem mostra o seletor.
        null
      ) : (
        <div>
          <label style={lbl}>Parcelas</label>
          <select value={parcelas} onChange={e => setParcelas(Number(e.target.value))} style={inp}>
            {PARCELAS.filter(n => n <= parcelasMax).map(n => {
              const pv = calcParcelaMaisJuros(servico.valor, n, parcelasSemJuros);
              const total = pv * n;
              return (
                <option key={n} value={n}>
                  {n}× de {fmtBRL(pv)}{n <= parcelasSemJuros ? ', sem juros' : ` (total ${fmtBRL(total)})`}
                </option>
              );
            })}
          </select>
          {parcelas > parcelasSemJuros && (
            <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
              ⚠️ Taxas de {((parcelaValor * parcelas / servico.valor - 1) * 100).toFixed(2)}% assumidas pelo cliente.
            </div>
          )}
        </div>
      )}

      <div>
        <label style={lbl}>Número do cartão</label>
        <div id={cartao.ids.numero} style={{ ...inp, height: 42, padding: '0 12px' }} />
      </div>
      <div>
        <label style={lbl}>Nome no cartão</label>
        <input style={inp} placeholder="COMO ESTÁ NO CARTÃO" name="nome"
          value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value.toUpperCase() }))} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <label style={lbl}>Validade</label>
          <div id={cartao.ids.validade} style={{ ...inp, height: 42, padding: '0 12px' }} />
        </div>
        <div>
          <label style={lbl}>CVV</label>
          <div id={cartao.ids.cvv} style={{ ...inp, height: 42, padding: '0 12px' }} />
        </div>
      </div>
      {!cartao.pronto && !cartao.erroSdk && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -8 }}>Carregando campos seguros do cartão…</div>}
      {cartao.erroSdk && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: -8 }}>{cartao.erroSdk}</div>}
      <div style={{ fontSize: 11, color: '#64748b', marginTop: -8 }}>🔒 Número, validade e CVV são digitados em campos protegidos do Mercado Pago — não passam pelos nossos servidores.</div>

      {erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
          <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 13, color: '#dc2626' }}>{erro}</div>
        </div>
      )}

      {/* Fallback Asaas — cartão recusado no MP, mesma tela oferece continuar pelo backup
          (18/09, pedido do dono: transparente, sem precisar gerar um segundo link). */}
      {mostrarAsaas && !linkAsaasGerado && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12.5, color: '#1e40af' }}>
            O Mercado Pago não aprovou. Você pode tentar pelo <strong>Asaas</strong> (backup seguro) — precisamos do CPF e do endereço completo (exigidos para gerar a cobrança e a nota fiscal). Fica salvo no seu cadastro, não precisa preencher de novo da próxima vez.
          </div>
          <input style={inp} placeholder="CPF (000.000.000-00)" value={cpfAsaas}
            onChange={e => setCpfAsaas(e.target.value.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="CEP" value={endAsaas.cep}
              onChange={e => { const cep = e.target.value.replace(/\D/g, '').slice(0, 8); setEndAsaas(p => ({ ...p, cep })); if (cep.length === 8) buscarCepAsaas(cep); }} />
            {cepLoadingAsaas && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite', alignSelf: 'center' }} />}
          </div>
          <input style={inp} placeholder="Logradouro (rua/av.)" value={endAsaas.logradouro}
            onChange={e => setEndAsaas(p => ({ ...p, logradouro: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Número" value={endAsaas.numero}
              onChange={e => setEndAsaas(p => ({ ...p, numero: e.target.value }))} />
            <input style={{ ...inp, flex: 2 }} placeholder="Complemento (opcional)" value={endAsaas.complemento}
              onChange={e => setEndAsaas(p => ({ ...p, complemento: e.target.value }))} />
          </div>
          <input style={inp} placeholder="Bairro" value={endAsaas.bairro}
            onChange={e => setEndAsaas(p => ({ ...p, bairro: e.target.value }))} />
          <div style={{ display: 'flex', gap: 8 }}>
            <input style={{ ...inp, flex: 2 }} placeholder="Cidade" value={endAsaas.cidade}
              onChange={e => setEndAsaas(p => ({ ...p, cidade: e.target.value }))} />
            <input style={{ ...inp, flex: 1 }} placeholder="UF" maxLength={2} value={endAsaas.uf}
              onChange={e => setEndAsaas(p => ({ ...p, uf: e.target.value.toUpperCase() }))} />
          </div>
          {btn('#0D63DB', enviandoAsaas ? 'Gerando...' : 'Continuar pelo Asaas →', pagarViaAsaas, enviandoAsaas,
            enviandoAsaas ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={15} />)}
        </div>
      )}
      {linkAsaasGerado && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', fontSize: 12.5, color: '#166534' }}>
          Abrimos o pagamento pelo Asaas em outra aba. Assim que for confirmado, esta cobrança
          é atualizada automaticamente — pode fechar esta tela.
        </div>
      )}

      {!linkAsaasGerado && btn('#0D63DB',
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

/* ── Tela: Pix + Cartão combinado (18/09) ── */
// Fase 1 (valor): quanto pagar de Pix agora (mín. R$5, máx. o saldo). Fase 2 (pix): gera o
// Pix DESSE valor (parcial) e aguarda compensar — mesmo PagamentoPIX, só que com um valor
// menor que o total. Fase 3 (cartao): ao compensar, busca o saldo ATUALIZADO no servidor
// (recarregarSaldo — nunca calcula na mão: o servidor é quem sabe o saldo real, e evita
// arredondamento/corrida) e mostra o cartão pra esse valor. onPago só é chamado no fim da
// fase 3 — a fase 1/2 sozinha não fecha a cobrança.
function PagamentoSplit({ servico, onPago, onVoltar, extra = {}, email, parcelasMax = 12, parcelasSemJuros = 3, recarregarSaldo, ocultarResumo = false }) {
  const [fase, setFase] = useState('valor'); // valor | pix | cartao | erro_saldo
  const [valorPix, setValorPix] = useState('');
  const [erroValor, setErroValor] = useState('');
  const [saldoCartao, setSaldoCartao] = useState(null);
  const [carregandoSaldo, setCarregandoSaldo] = useState(false);

  const saldoTotal = Number(servico.valor) || 0;
  const valorPixNum = useMemo(() => parseFloat(String(valorPix).replace(/\./g, '').replace(',', '.')) || 0, [valorPix]);
  const inp = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 16, boxSizing: 'border-box' };

  const confirmarValor = () => {
    setErroValor('');
    if (valorPixNum < 5) { setErroValor('Valor mínimo para o Pix: R$ 5,00.'); return; }
    if (valorPixNum >= saldoTotal) { setErroValor(`O Pix precisa ser MENOR que o total (${fmtBRL(saldoTotal)}) — se quiser pagar tudo no Pix, use a opção "Pagar com PIX".`); return; }
    setFase('pix');
  };

  const aoConfirmarPix = async () => {
    setFase('cartao');
    setCarregandoSaldo(true);
    try {
      const novoSaldo = await recarregarSaldo();
      if (!(novoSaldo > 0.99)) { onPago(); return; } // saldo residual < R$1 — MP não cobra abaixo disso; considera concluído
      setSaldoCartao(novoSaldo);
    } catch (e) {
      console.error('[PagamentoSplit] recarregarSaldo falhou:', e?.message || e);
      setFase('erro_saldo');
    } finally {
      setCarregandoSaldo(false);
    }
  };

  if (fase === 'valor') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <button onClick={onVoltar} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 13, padding: 0 }}>
          <ChevronLeft size={16} /> Voltar
        </button>
        {!ocultarResumo && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#0f172a' }}>{fmtBRL(saldoTotal)}</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>{servico.nome}</div>
          </div>
        )}
        <div>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Quanto você quer pagar agora via Pix?
          </label>
          <input style={inp} placeholder="0,00" inputMode="decimal" value={valorPix} onChange={e => setValorPix(e.target.value)} />
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 6 }}>
            O restante ({valorPixNum > 0 && valorPixNum < saldoTotal ? fmtBRL(saldoTotal - valorPixNum) : fmtBRL(saldoTotal)}) fica para o cartão, liberado assim que o Pix compensar.
          </div>
        </div>
        {erroValor && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 10 }}>
            <AlertCircle size={16} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13, color: '#dc2626' }}>{erroValor}</div>
          </div>
        )}
        {btn('#7c3aed', 'Gerar Pix deste valor', confirmarValor, false, <QrCode size={16} />)}
      </div>
    );
  }

  if (fase === 'pix') {
    return (
      <PagamentoPIX
        servico={{ ...servico, valor: valorPixNum }}
        onConfirmado={aoConfirmarPix}
        onVoltar={() => setFase('valor')}
        extra={{ ...extra, valor_pix_parcial: valorPixNum }}
        email={email}
        ocultarResumo={ocultarResumo}
        tituloConfirmado="Pix confirmado!"
        subtituloConfirmado="Agora é só completar com o cartão..."
      />
    );
  }

  if (fase === 'erro_saldo') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, textAlign: 'center', padding: '12px 0' }}>
        <CheckCircle2 size={40} color="#059669" style={{ margin: '0 auto' }} />
        <div style={{ fontSize: 15, fontWeight: 700, color: '#059669' }}>Seu Pix foi confirmado!</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          Não conseguimos calcular o saldo do cartão automaticamente agora. Atualize a página —
          o valor que falta já vai aparecer certo, descontado do Pix que você acabou de pagar.
        </div>
        {btn('#0D63DB', 'Atualizar página', () => window.location.reload(), false)}
      </div>
    );
  }

  // fase === 'cartao'
  if (carregandoSaldo || saldoCartao == null) {
    return (
      <div style={{ textAlign: 'center', padding: '28px 0', color: '#64748b', fontSize: 14, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        <Loader2 size={28} color="#7c3aed" style={{ animation: 'spin 1s linear infinite' }} />
        Calculando o saldo do cartão…
        <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#166534', textAlign: 'center' }}>
        Pix de {fmtBRL(valorPixNum)} confirmado. Complete o pagamento com o cartão:
      </div>
      <PagamentoCartao
        servico={{ ...servico, valor: saldoCartao }}
        onConfirmado={onPago}
        onVoltar={() => setFase('valor')}
        parcelasMax={parcelasMax}
        parcelasSemJuros={parcelasSemJuros}
        extra={extra}
        email={email}
      />
    </div>
  );
}

/* ── Componente principal ── */
// assinatura=true → somente cartão (Investidor Pro, Leilão Club recorrente)
// assinatura=false (padrão) → escolha entre PIX (sem taxa) e cartão
export default function PagamentoServico({ servico, onPago, onCancelar, assinatura = false, soCartao = false, soPix = false, onGatewayBloqueado = null, parcelasMax = 12, parcelasSemJuros = 3, extra = {}, email, embutido = false, permitirSplit = false, recarregarSaldo = null }) {
  // soCartao: fluxos cujo pagamento PRECISA carregar metadata (ex.: recarga de crédito,
  // confirmada por metadata.proposito) — só cartão.
  // soPix: fluxo que é PIX por definição (ex.: Investidor Pro ANUIDADE à vista — cartão é a
  // mensalidade recorrente, que segue outro caminho). Vai direto ao PIX, sem escolha de método.
  const [metodo, setMetodo] = useState(assinatura || soCartao ? 'cartao' : soPix ? 'pix' : null);

  // embutido (18/09): o chamador já tem seu próprio card com título e valor em destaque
  // (ex.: PagarHonorario.jsx) — sem isto, a tela repetia "Valor a pagar" e o nome do
  // serviço 2-3x seguidas. Sem card/título próprios aqui, e sem repetir valor/nome.
  const conteudo = (
    <>
      {!embutido && (
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Finalizar pagamento</div>
          {assinatura && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              Assinatura recorrente · Somente cartão de crédito
            </div>
          )}
        </div>
      )}

      {!metodo && (
        <>
          <EscolhaMetodo servico={servico} onEscolha={setMetodo} ocultarResumo={embutido} permitirSplit={permitirSplit && !!recarregarSaldo} />
          {onCancelar && (
            <button onClick={onCancelar} style={{ width: '100%', marginTop: 12, padding: '10px', background: 'none', border: 'none', color: '#94a3b8', fontSize: 13, cursor: 'pointer' }}>
              Cancelar
            </button>
          )}
        </>
      )}

      {metodo === 'pix' && (
        <PagamentoPIX servico={servico} onConfirmado={onPago} onVoltar={soPix ? onCancelar : () => setMetodo(null)} extra={extra} email={email} ocultarResumo={embutido} />
      )}
      {metodo === 'cartao' && (
        <PagamentoCartao
          servico={servico}
          assinatura={assinatura}
          onConfirmado={onPago}
          onVoltar={(assinatura || soCartao) ? onCancelar : () => setMetodo(null)}
          onGatewayBloqueado={onGatewayBloqueado}
          parcelasMax={parcelasMax}
          parcelasSemJuros={parcelasSemJuros}
          extra={extra}
          email={email}
        />
      )}
      {metodo === 'split' && (
        <PagamentoSplit
          servico={servico}
          onPago={onPago}
          onVoltar={() => setMetodo(null)}
          extra={extra}
          email={email}
          parcelasMax={parcelasMax}
          parcelasSemJuros={parcelasSemJuros}
          recarregarSaldo={recarregarSaldo}
          ocultarResumo={embutido}
        />
      )}
    </>
  );

  if (embutido) return conteudo;

  return (
    <div style={{
      background: 'white', borderRadius: 16, padding: '28px 24px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.10)', maxWidth: 460, margin: '0 auto',
    }}>
      {conteudo}
    </div>
  );
}
