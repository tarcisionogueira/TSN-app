import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2, ShieldCheck, FileText, ExternalLink } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';

// Campo de assinatura (mouse/toque) — cópia enxuta do usado no contrato da parte.
const lbl = { display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 };
function AssinaturaCanvas({ onChange }) {
  const canvasRef = useRef(null);
  const [desenhando, setDesenhando] = useState(false);
  const [tem, setTem] = useState(false);
  const last = useRef(null);
  const getPos = (e, c) => { const r = c.getBoundingClientRect(); const s = e.touches?.[0] || e; return { x: s.clientX - r.left, y: s.clientY - r.top }; };
  const iniciar = (e) => { e.preventDefault(); setDesenhando(true); last.current = getPos(e, canvasRef.current); };
  const terminar = () => { if (!desenhando) return; setDesenhando(false); setTem(true); onChange(canvasRef.current.toDataURL()); };
  const desenhar = (e) => {
    if (!desenhando) return; e.preventDefault();
    const ctx = canvasRef.current.getContext('2d'); const pos = getPos(e, canvasRef.current);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#111111'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.stroke(); last.current = pos;
  };
  const limpar = () => { const ctx = canvasRef.current.getContext('2d'); ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); setTem(false); onChange(''); };
  return (
    <div>
      <label style={lbl}>Assinatura da testemunha *</label>
      <canvas ref={canvasRef} width={800} height={120}
        style={{ width: '100%', height: 120, border: '2px dashed #cbd5e1', borderRadius: 9, background: '#f8fafc', touchAction: 'none', cursor: 'crosshair' }}
        onMouseDown={iniciar} onMouseMove={desenhar} onMouseUp={terminar} onMouseLeave={terminar}
        onTouchStart={iniciar} onTouchMove={desenhar} onTouchEnd={terminar} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: '#94a3b8' }}>
        <span>Assine com o mouse ou toque</span>
        {tem && <button type="button" onClick={limpar} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, padding: 0 }}>Limpar</button>}
      </div>
    </div>
  );
}

const maskCpf = (v) => v.replace(/\D/g, '').slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');

export default function TestemunhaLink() {
  const { token } = useParams();
  const isMobile = useIsMobile();
  const [contrato, setContrato] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [assinatura, setAssinatura] = useState('');
  const [aceite, setAceite] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    if (!token) return;
    supabase.rpc('get_contrato_testemunha', { p_token: token }).then(({ data, error }) => {
      const c = Array.isArray(data) ? data[0] : data;
      if (error || !c) setErro('Link de testemunha inválido ou não encontrado.');
      else if (c.testemunha_assinou) setErro('A testemunha deste contrato já assinou.');
      else if (c.expira_em && new Date(c.expira_em) < new Date()) setErro('Este link expirou.');
      else setContrato(c);
      setLoading(false);
    });
  }, [token]);

  const assinar = async () => {
    if (!nome.trim()) { alert('Informe o nome da testemunha.'); return; }
    if (cpf.replace(/\D/g, '').length !== 11) { alert('Informe um CPF válido.'); return; }
    if (!assinatura) { alert('Assine no campo indicado.'); return; }
    if (!aceite) { alert('É necessário aceitar para prosseguir.'); return; }
    setEnviando(true);
    try {
      const resp = await fetch('/api/assinar-testemunha', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testemunha_token: token, nome: nome.trim(), cpf: cpf.replace(/\D/g, ''), assinatura }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || !out.ok) { alert('Erro ao assinar: ' + (out.error || 'tente novamente')); setEnviando(false); return; }
    } catch (e) { alert('Erro ao assinar: ' + (e.message || 'falha de conexão')); setEnviando(false); return; }
    setOk(true);
  };

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111111' }}>
      <Loader2 size={32} color="#60a5fa" style={{ animation: 'spin 1s linear infinite' }} />
    </div>
  );
  if (erro) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111111', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <AlertCircle size={52} color="#f87171" style={{ margin: '0 auto 20px' }} />
        <h2 style={{ color: 'white', marginBottom: 8 }}>Link indisponível</h2>
        <p style={{ color: '#94a3b8' }}>{erro}</p>
      </div>
    </div>
  );
  if (ok) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111111', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 480, borderRadius: 20, padding: '48px 32px', border: '1px solid #334155' }}>
        <CheckCircle2 size={72} color="#34d399" style={{ margin: '0 auto 24px' }} />
        <h2 style={{ color: 'white', marginBottom: 8, fontWeight: 900, fontSize: 26 }}>Testemunho registrado!</h2>
        <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.7 }}>Sua assinatura como testemunha foi registrada com validade jurídica (Lei 14.063/2020).</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#111111', fontFamily: "'Inter',sans-serif" }}>
      <div style={{ borderBottom: '1px solid #1f2937', padding: isMobile ? '14px 16px' : '16px 28px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 32, height: 32, background: '#0D63DB', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ShieldCheck size={18} color="white" />
        </div>
        <div>
          <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>BidPro Brasil, Assinatura de Testemunha</div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'white' }}>{contrato.titulo}</div>
        </div>
      </div>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: isMobile ? '16px' : '28px 20px' }}>
        <div style={{ padding: '12px 16px', background: 'rgba(13,99,219,0.12)', border: '1px solid rgba(96,165,250,0.4)', borderRadius: 10, color: '#bfdbfe', fontSize: 13, lineHeight: 1.6, marginBottom: 18 }}>
          Você foi indicado(a) como <strong>testemunha</strong> da assinatura de <strong>{contrato.parte_nome || 'uma das partes'}</strong>. Leia o documento abaixo, preencha seu nome e CPF e assine.
          {contrato.parte_assinou === false && <div style={{ marginTop: 6, color: '#fbbf24' }}>Obs.: a parte ainda não concluiu a assinatura dela.</div>}
        </div>

        {/* Documento */}
        <div style={{ background: '#0f172a', border: '1px solid #1f2937', borderRadius: 12, padding: '18px 20px', marginBottom: 18, maxHeight: 420, overflowY: 'auto' }}>
          {contrato.arquivo_url ? (
            contrato.arquivo_url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
              ? <img src={contrato.arquivo_url} alt="Documento" style={{ width: '100%', borderRadius: 8 }} />
              : <a href={contrato.arquivo_url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#60a5fa', fontWeight: 700, textDecoration: 'none' }}><FileText size={16} /> Abrir documento <ExternalLink size={13} /></a>
          ) : (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', color: '#cbd5e1', fontSize: 13, lineHeight: 1.7, margin: 0 }}>{contrato.conteudo}</pre>
          )}
        </div>

        {/* Dados da testemunha */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
          <div style={{ flex: 2, minWidth: 200 }}>
            <label style={lbl}>Nome completo *</label>
            <input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome da testemunha"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={lbl}>CPF *</label>
            <input value={cpf} onChange={e => setCpf(maskCpf(e.target.value))} placeholder="000.000.000-00" inputMode="numeric"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 9, border: '1px solid #334155', background: '#1e293b', color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box' }} />
          </div>
        </div>

        <div style={{ marginBottom: 18 }}><AssinaturaCanvas onChange={setAssinatura} /></div>

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6, marginBottom: 20 }}>
          <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 2, flexShrink: 0 }} />
          <span>Declaro que testemunhei esta assinatura e reconheço este testemunho eletrônico como juridicamente válido nos termos da <strong style={{ color: '#cbd5e1' }}>Lei 14.063/2020</strong>.</span>
        </label>

        <button onClick={assinar} disabled={enviando || !aceite || !assinatura}
          style={{ width: '100%', padding: '14px', background: '#059669', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 15, cursor: 'pointer', opacity: (enviando || !aceite || !assinatura) ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          {enviando ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Registrando…</> : <><ShieldCheck size={16} /> Assinar como testemunha</>}
        </button>
      </div>
      <style>{'@keyframes spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
