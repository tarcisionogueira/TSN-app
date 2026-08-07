import React, { useCallback, useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Smartphone, X, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

/**
 * CONTINUAR NO CELULAR — o passo de FOTO sai do computador e vai para o telefone via QR code.
 *
 * Pedido do dono (07/08): "na tela de adesão do parceiro, se abrir pelo computador, gerar um QR
 * code para continuar as fotos pelo celular — também nas outras que pedem fotos". O motivo é
 * prático: webcam de desktop fotografa documento mal (ou não existe), e era aí que o cliente
 * parava. Este componente é o mecanismo ÚNICO desse desvio — qualquer tela que peça foto usa
 * ele, em vez de cada uma inventar o seu.
 *
 * O QR é desenhado AQUI, no navegador (qrcode-generator). Não usa API externa de QR de
 * propósito: a URL carrega um código de acesso, e mandá-la para um site de terceiros para virar
 * imagem seria entregar esse código a quem não precisa dele. (O QR do PIX pode usar API externa
 * porque o payload é público; este não é o caso.)
 *
 * Só aparece em tela grande/sem toque — no próprio celular o botão de câmera já resolve.
 */

export function ehDesktop() {
  if (typeof window === 'undefined') return false;
  const semToque = !('ontouchstart' in window) && !(navigator.maxTouchPoints > 0);
  const larga = window.innerWidth >= 900;
  return semToque || larga;
}

function QrSvg({ texto, tamanho = 190 }) {
  const svg = React.useMemo(() => {
    try {
      const qr = qrcode(0, 'M');            // tipo 0 = escolhe a menor versão que couber
      qr.addData(texto);
      qr.make();
      const n = qr.getModuleCount();
      const quiet = 2;                       // margem obrigatória para o leitor enxergar
      const total = n + quiet * 2;
      let d = '';
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
        }
      }
      return { d, total };
    } catch { return null; }
  }, [texto]);
  if (!svg) return null;
  return (
    <svg width={tamanho} height={tamanho} viewBox={`0 0 ${svg.total} ${svg.total}`} shapeRendering="crispEdges"
      style={{ background: '#fff', borderRadius: 10, display: 'block' }} role="img" aria-label="QR code para continuar no celular">
      <path d={svg.d} fill="#0f172a" />
    </svg>
  );
}

/**
 * @param {'kyc'|'documento'|'selfie'} fluxo  o que o celular vai enviar
 * @param {Function} onConcluido  chamado UMA vez quando o celular termina os passos do fluxo
 * @param {string} rotulo  texto do botão
 */
export default function ContinuarNoCelular({ fluxo = 'kyc', onConcluido, rotulo = 'Continuar no celular', compacto = false }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState(null);      // { codigo, url, expira_em }
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [recebidos, setRecebidos] = useState([]);
  const [concluido, setConcluido] = useState(false);
  const [restante, setRestante] = useState(0);
  const avisado = useRef(false);

  const gerar = useCallback(async () => {
    setCarregando(true); setErro(''); setRecebidos([]); setConcluido(false); avisado.current = false;
    try {
      const r = await apiCall('/api/captura-handoff', { method: 'POST', body: JSON.stringify({ fluxo }) });
      const d = await r.json().catch(() => ({}));
      // Checa o .ok ANTES de usar o corpo: um 429/500 traz JSON sem `url` e a tela ficaria
      // "gerando" para sempre, sem dizer o que houve.
      if (!r.ok || !d?.url) { setErro(d?.error || 'Não consegui gerar o QR code agora.'); setDados(null); }
      else setDados(d);
    } catch { setErro('Falha de conexão ao gerar o QR code.'); setDados(null); }
    setCarregando(false);
  }, [fluxo]);

  const abrir = () => { setAberto(true); gerar(); };

  const fechar = useCallback(() => {
    setAberto(false);
    // Cancela o código ao fechar: um QR que ficou na tela e some da vista não pode continuar
    // valendo. (Best-effort — o TTL de 15 min é a rede de segurança.)
    if (dados?.codigo) apiCall(`/api/captura-handoff?codigo=${dados.codigo}`, { method: 'DELETE' }).catch(() => {});
    setDados(null);
  }, [dados?.codigo]);

  // Acompanha o celular. Enquanto o QR está na tela, pergunta a cada 3s o que já chegou.
  useEffect(() => {
    if (!aberto || !dados?.codigo || concluido) return;
    let vivo = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/captura-handoff?codigo=${dados.codigo}`);
        if (!r.ok) return;
        const d = await r.json();
        if (!vivo) return;
        setRecebidos(Array.isArray(d.itens) ? d.itens : []);
        if (d.concluido && !avisado.current) {
          avisado.current = true;
          setConcluido(true);
          onConcluido?.(d);
        }
      } catch { /* rede instável no meio do fluxo não precisa virar erro na tela */ }
    };
    const id = setInterval(tick, 3000);
    tick();
    return () => { vivo = false; clearInterval(id); };
  }, [aberto, dados?.codigo, concluido, onConcluido]);

  // Contagem regressiva do código (o cliente precisa saber que o QR tem prazo).
  useEffect(() => {
    if (!dados?.expira_em) return;
    const calc = () => setRestante(Math.max(0, Math.floor((new Date(dados.expira_em).getTime() - Date.now()) / 1000)));
    calc();
    const id = setInterval(calc, 1000);
    return () => clearInterval(id);
  }, [dados?.expira_em]);

  if (!ehDesktop()) return null;

  const mmss = `${String(Math.floor(restante / 60)).padStart(2, '0')}:${String(restante % 60).padStart(2, '0')}`;
  const expirou = !!dados && restante <= 0;
  const rotuloItem = { documento: 'Documento', documento_verso: 'Verso do documento', selfie: 'Selfie' };

  return (
    <>
      <button type="button" onClick={abrir}
        style={{ width: compacto ? 'auto' : '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: compacto ? '8px 12px' : '11px 16px', border: '1px dashed #94a3b8', background: '#f8fafc',
          borderRadius: 12, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: '#334155' }}>
        <Smartphone size={16} color="#0D63DB" /> {rotulo}
      </button>

      {aberto && (
        <div onClick={fechar} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 18, padding: '24px 24px 20px', width: '100%', maxWidth: 380, boxShadow: '0 24px 60px rgba(0,0,0,0.35)', textAlign: 'center', position: 'relative' }}>
            <button onClick={fechar} aria-label="Fechar" style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>

            <div style={{ fontWeight: 900, fontSize: 15.5, color: '#111', marginBottom: 6 }}>Continuar no celular</div>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#64748b', lineHeight: 1.55 }}>
              Aponte a câmera do celular para o código. A página abre no telefone e você tira as fotos por lá — sem precisar entrar de novo.
            </p>

            {carregando && <div style={{ padding: 30, color: '#64748b', fontSize: 13 }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /><div style={{ marginTop: 8 }}>Gerando o código…</div></div>}

            {!carregando && erro && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#dc2626', marginBottom: 12 }}>{erro}</div>
            )}

            {!carregando && dados && !concluido && (
              <>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12, opacity: expirou ? 0.25 : 1 }}>
                  <QrSvg texto={dados.url} />
                </div>
                {expirou ? (
                  <div style={{ fontSize: 12.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 12px' }}>
                    O código expirou por segurança. Gere outro para continuar.
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    Válido por <strong style={{ color: '#334155' }}>{mmss}</strong> · aguardando o celular…
                  </div>
                )}
                {!!recebidos.length && !expirou && (
                  <div style={{ marginTop: 12, textAlign: 'left', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '9px 12px' }}>
                    {recebidos.map((t, i) => (
                      <div key={`${t}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: '#166534', fontWeight: 600 }}>
                        <CheckCircle2 size={14} /> {rotuloItem[t] || t} recebido
                      </div>
                    ))}
                  </div>
                )}
                <button onClick={gerar} style={{ marginTop: 14, background: 'none', border: 'none', color: '#0D63DB', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <RefreshCw size={13} /> Gerar outro código
                </button>
              </>
            )}

            {concluido && (
              <div style={{ padding: '18px 0 6px' }}>
                <CheckCircle2 size={34} color="#16a34a" />
                <div style={{ fontWeight: 800, fontSize: 14.5, color: '#166534', marginTop: 8 }}>Fotos recebidas do celular</div>
                <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 6 }}>Pode continuar por aqui — já estamos com tudo.</div>
                <button onClick={fechar} style={{ marginTop: 14, padding: '10px 20px', border: 'none', background: '#0D63DB', color: '#fff', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>Continuar</button>
              </div>
            )}
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        </div>
      )}
    </>
  );
}
