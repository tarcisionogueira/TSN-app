import React, { useEffect, useRef, useState } from 'react';
import qrcode from 'qrcode-generator';
import { Loader2, Copy, FileText, CheckCircle2 } from 'lucide-react';
import { AZUL, VERDE } from '../utils/marca';

const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mascaraDoc = (v) => {
  const d = String(v || '').replace(/\D/g, '').slice(0, 14);
  if (d.length <= 11) return d.replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  return d.replace(/(\d{2})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1/$2').replace(/(\d{4})(\d{1,2})$/, '$1-$2');
};

// QR desenhado aqui (mesma biblioteca de ContinuarNoCelular) — o Pix copia e cola não sai para serviço externo.
function QrPix({ texto }) {
  const [svg, setSvg] = useState('');
  useEffect(() => {
    try {
      const qr = qrcode(0, 'M'); qr.addData(texto); qr.make();
      setSvg(qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true }));
    } catch (e) { console.error('[PixBoletoInter] QR', e?.message); setSvg(''); }
  }, [texto]);
  if (!svg) return null;
  return <div style={{ width: 200, height: 200, margin: '0 auto' }} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * PIX E BOLETO PELO BANCO INTER (07/11, dono) — uma cobrança só, que o pagador quita pelo QR Code Pix (cai na hora)
 * ou pela linha digitável do boleto. Valor e cobrança vêm do servidor (api/inter-cobranca.js). A tela consulta o
 * banco a cada 8 s; quem dá a baixa é o servidor, com a confirmação do próprio Inter.
 * `onFalha` leva à reserva (Pix/boleto do Mercado Pago) quando o Inter não emite.
 */
export default function PixBoletoInter({ cobrancaId, email, nomeSugerido = '', valor, onPago, onFalha, dadosProntos = false }) {
  const [doc, setDoc] = useState('');
  const [nome, setNome] = useState(nomeSugerido || '');
  const [end, setEnd] = useState({ cep: '', logradouro: '', numero: '', complemento: '', bairro: '', cidade: '', uf: '' });
  const [buscandoCep, setBuscandoCep] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [falhaInter, setFalhaInter] = useState(false);
  const [cob, setCob] = useState(null);
  const [copiado, setCopiado] = useState('');
  const timer = useRef(null);

  const buscarCep = async (raw) => {
    const cep = (raw || '').replace(/\D/g, '');
    if (cep.length !== 8) return;
    setBuscandoCep(true);
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const j = await r.json(); // padrao-ok: ViaCEP devolve 200 com {erro:true} para CEP inexistente; só autopreenche
      if (!j.erro) setEnd((p) => ({ ...p, cep, logradouro: j.logradouro || p.logradouro, bairro: j.bairro || p.bairro, cidade: j.localidade || p.cidade, uf: j.uf || p.uf }));
    } catch (e) { console.error('[PixBoletoInter] CEP', e?.message || e); } // padrao-ok: CEP offline, preenche à mão
    setBuscandoCep(false);
  };

  const chamar = async (corpo) => {
    const r = await fetch('/api/inter-cobranca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `Erro ${r.status}`), { falhaInter: !!(j.falhaInter || j.semInter) || r.status >= 500 });
    return j.cobranca;
  };

  // Enquanto a cobrança está aberta: consulta o banco (rápido enquanto o Pix ainda não saiu, depois a cada 8 s).
  useEffect(() => {
    if (!cob || cob.pago) return undefined;
    const intervalo = cob.pix || cob.linha ? 8000 : 2500;
    timer.current = setTimeout(async () => {
      try {
        const atual = await chamar({ acao: 'consultar', cobranca_id: cobrancaId });
        setCob(atual);
        if (atual?.pago) onPago?.();
      } catch (e) { console.warn('[PixBoletoInter] consulta', e?.message); setCob((c) => ({ ...c })); }
    }, intervalo);
    return () => clearTimeout(timer.current);
  }, [cob, cobrancaId]); // eslint-disable-line react-hooks/exhaustive-deps

  const docLimpo = doc.replace(/\D/g, '');
  const pronto = [11, 14].includes(docLimpo.length) && nome.trim().length >= 3
    && end.cep && end.logradouro && end.numero && end.bairro && end.cidade && /^[A-Za-z]{2}$/.test(end.uf);

  const gerar = async () => {
    if (!pronto && !dadosProntos) { setErro('Preencha CPF/CNPJ, nome e o endereço completo de quem paga (o banco exige para emitir).'); return; }
    setEnviando(true); setErro(''); setFalhaInter(false);
    try {
      // Com os dados da nota já completos na cobrança, o servidor usa eles (pagador vazio daqui).
      setCob(await chamar({ acao: 'emitir', cobranca_id: cobrancaId, email, pagador: dadosProntos ? {} : { doc: docLimpo, nome: nome.trim(), endereco: end } }));
    } catch (e) {
      setErro(e.message || 'Não foi possível gerar agora.');
      setFalhaInter(!!e.falhaInter);
    } finally { setEnviando(false); }
  };

  const copiar = (txt, qual) => { navigator.clipboard?.writeText(txt); setCopiado(qual); setTimeout(() => setCopiado(''), 2000); };
  const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' };
  const lbl = { fontSize: 11, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 3 };
  const btnCopiar = { padding: '0 12px', border: `1px solid ${AZUL}`, background: 'white', color: AZUL, borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 };

  if (cob?.pago) {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: VERDE, fontWeight: 800 }}><CheckCircle2 size={20} /> Pagamento confirmado pelo banco</div>;
  }

  if (cob) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 13, color: '#334155' }}>
          Valor: <strong>{fmtBRL(cob.valor)}</strong>
          {cob.vencimento && <> · vence em <strong>{new Date(cob.vencimento + 'T12:00:00').toLocaleDateString('pt-BR')}</strong></>}
        </div>
        {!cob.pix && !cob.linha ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13 }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> O banco está gerando o Pix e o boleto…
          </div>
        ) : (<>
          {cob.pix && (
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a', marginBottom: 6 }}>Pix — cai na hora</div>
              <QrPix texto={cob.pix} />
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input readOnly value={cob.pix} style={{ ...inp, fontFamily: 'monospace', fontSize: 11, minWidth: 0 }} />
                <button onClick={() => copiar(cob.pix, 'pix')} style={btnCopiar}><Copy size={13} /> {copiado === 'pix' ? 'Copiado' : 'Copiar'}</button>
              </div>
            </div>
          )}
          {cob.linha && (
            <div>
              <div style={lbl}>Ou pague o boleto (compensa em até 1 dia útil)</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input readOnly value={cob.linha} style={{ ...inp, fontFamily: 'monospace', fontSize: 11.5, minWidth: 0 }} />
                <button onClick={() => copiar(cob.linha, 'linha')} style={btnCopiar}><Copy size={13} /> {copiado === 'linha' ? 'Copiado' : 'Copiar'}</button>
              </div>
              <a href={`/api/inter-cobranca?cobranca_id=${encodeURIComponent(cobrancaId)}&pdf=1`} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12.5, color: AZUL, fontWeight: 700, textDecoration: 'none' }}>
                <FileText size={13} /> Abrir o boleto em PDF
              </a>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
            <Loader2 size={12} style={{ animation: 'spin 1.5s linear infinite' }} /> Esperando a confirmação do banco. Pode deixar esta tela aberta.
          </div>
        </>)}
        <style>{'@keyframes spin{to{transform:rotate(360deg);}}'}</style>
      </div>
    );
  }

  if (dadosProntos) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
          Geramos um <strong>Pix</strong> (cai na hora) e um <strong>boleto</strong> do Banco Inter para <strong>{fmtBRL(valor)}</strong>, em nome de quem está na nota fiscal acima.
        </div>
        {erro && <div role="alert" style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{erro}</div>}
        <button onClick={gerar} disabled={enviando}
          style={{ padding: 13, background: AZUL, color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14.5, cursor: enviando ? 'default' : 'pointer', opacity: enviando ? 0.7 : 1 }}>
          {enviando ? 'Gerando…' : 'Gerar Pix e boleto'}
        </button>
        {falhaInter && onFalha && (
          <button onClick={onFalha} style={{ padding: 11, background: 'white', color: AZUL, border: `1px solid ${AZUL}`, borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
            Pagar o Pix pelo Mercado Pago
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
        Geramos um <strong>Pix</strong> (cai na hora) e um <strong>boleto</strong> do Banco Inter para <strong>{fmtBRL(valor)}</strong>. O banco exige os dados de quem paga.
      </div>
      <div><label style={lbl}>CPF ou CNPJ</label><input style={inp} value={doc} inputMode="numeric" onChange={(e) => setDoc(mascaraDoc(e.target.value))} placeholder="000.000.000-00" /></div>
      <div><label style={lbl}>Nome de quem paga</label><input style={inp} value={nome} onChange={(e) => setNome(e.target.value)} /></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}><label style={lbl}>CEP</label>
          <input style={inp} value={end.cep} inputMode="numeric" onChange={(e) => { const cep = e.target.value.replace(/\D/g, '').slice(0, 8); setEnd((p) => ({ ...p, cep })); if (cep.length === 8) buscarCep(cep); }} /></div>
        {buscandoCep && <Loader2 size={15} style={{ animation: 'spin 1s linear infinite', marginBottom: 10 }} />}
      </div>
      <div><label style={lbl}>Rua</label><input style={inp} value={end.logradouro} onChange={(e) => setEnd((p) => ({ ...p, logradouro: e.target.value }))} /></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 1 }}><label style={lbl}>Número</label><input style={inp} value={end.numero} onChange={(e) => setEnd((p) => ({ ...p, numero: e.target.value }))} /></div>
        <div style={{ flex: 2 }}><label style={lbl}>Complemento</label><input style={inp} value={end.complemento} onChange={(e) => setEnd((p) => ({ ...p, complemento: e.target.value }))} /></div>
      </div>
      <div><label style={lbl}>Bairro</label><input style={inp} value={end.bairro} onChange={(e) => setEnd((p) => ({ ...p, bairro: e.target.value }))} /></div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div style={{ flex: 3 }}><label style={lbl}>Cidade</label><input style={inp} value={end.cidade} onChange={(e) => setEnd((p) => ({ ...p, cidade: e.target.value }))} /></div>
        <div style={{ flex: 1 }}><label style={lbl}>UF</label><input style={inp} value={end.uf} maxLength={2} onChange={(e) => setEnd((p) => ({ ...p, uf: e.target.value.toUpperCase() }))} /></div>
      </div>
      {erro && <div role="alert" style={{ fontSize: 12.5, color: '#b91c1c', fontWeight: 600 }}>{erro}</div>}
      <button onClick={gerar} disabled={enviando}
        style={{ padding: 13, background: AZUL, color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14.5, cursor: enviando ? 'default' : 'pointer', opacity: enviando ? 0.7 : 1 }}>
        {enviando ? 'Gerando…' : 'Gerar Pix e boleto'}
      </button>
      {falhaInter && onFalha && (
        <button onClick={onFalha} style={{ padding: 11, background: 'white', color: AZUL, border: `1px solid ${AZUL}`, borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: 'pointer' }}>
          Pagar o Pix pelo Mercado Pago
        </button>
      )}
      <style>{'@keyframes spin{to{transform:rotate(360deg);}}'}</style>
    </div>
  );
}
