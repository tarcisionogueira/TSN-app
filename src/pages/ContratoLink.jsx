import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { supabase } from '../utils/supabase';

const inp = { width:'100%', padding:'10px 13px', border:'1px solid #e2e8f0', borderRadius:9, fontSize:14, background:'white', color:'#0f172a', boxSizing:'border-box' };
const lbl = { fontSize:12, fontWeight:700, color:'#475569', display:'block', marginBottom:5 };

function Campo({ label, name, value, onChange, type='text', required=false, placeholder='' }) {
  return (
    <div>
      <label style={lbl}>{label}{required && ' *'}</label>
      <input type={type} name={name} value={value} onChange={onChange} required={required} placeholder={placeholder} style={inp} />
    </div>
  );
}

function AssinaturaCanvas({ onChange }) {
  const canvasRef = useRef(null);
  const [desenhando, setDesenhando] = useState(false);
  const [tem, setTem] = useState(false);
  const last = useRef(null);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
  };

  const iniciar = (e) => { e.preventDefault(); setDesenhando(true); last.current = getPos(e, canvasRef.current); };
  const terminar = () => {
    if (!desenhando) return;
    setDesenhando(false);
    setTem(true);
    onChange(canvasRef.current.toDataURL());
  };
  const desenhar = (e) => {
    if (!desenhando) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext('2d');
    const pos = getPos(e, canvasRef.current);
    ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(pos.x, pos.y); ctx.strokeStyle = '#0f172a'; ctx.lineWidth = 2;
    ctx.lineCap = 'round'; ctx.stroke();
    last.current = pos;
  };
  const limpar = () => {
    const ctx = canvasRef.current.getContext('2d');
    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    setTem(false); onChange('');
  };

  return (
    <div>
      <label style={lbl}>Assinatura *</label>
      <canvas ref={canvasRef} width={460} height={140}
        style={{ width:'100%', height:140, border:'2px dashed #cbd5e1', borderRadius:9, background:'#f8fafc', touchAction:'none', cursor:'crosshair' }}
        onMouseDown={iniciar} onMouseMove={desenhar} onMouseUp={terminar} onMouseLeave={terminar}
        onTouchStart={iniciar} onTouchMove={desenhar} onTouchEnd={terminar} />
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:6, fontSize:12, color:'#94a3b8' }}>
        <span>Assine com o mouse ou toque</span>
        {tem && <button type="button" onClick={limpar} style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontSize:12 }}>Limpar</button>}
      </div>
    </div>
  );
}

export default function ContratoLink() {
  const { token } = useParams();
  const [contrato, setContrato] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [etapa, setEtapa] = useState('tipo'); // tipo → dados → revisar → ok
  const [tipoPessoa, setTipoPessoa] = useState('');
  const [dados, setDados] = useState({});
  const [assinatura, setAssinatura] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aceite, setAceite] = useState(false);

  useEffect(() => {
    if (!token) return;
    supabase.from('contratos_link').select('id, titulo, conteudo, tipo_contrato, status, expira_em')
      .eq('token', token).single()
      .then(({ data, error }) => {
        if (error || !data) setErro('Contrato não encontrado ou link inválido.');
        else if (data.status === 'assinado') setErro('Este contrato já foi assinado.');
        else if (data.status === 'expirado' || new Date(data.expira_em) < new Date()) setErro('Este link expirou.');
        else setContrato(data);
        setLoading(false);
      });
  }, [token]);

  const up = (k, v) => setDados(p => ({ ...p, [k]: v }));
  const onChange = e => up(e.target.name, e.target.value);

  const camposPF = [
    { label:'Nome completo', name:'nome', required:true },
    { label:'CPF', name:'cpf', required:true, placeholder:'000.000.000-00' },
    { label:'RG', name:'rg', required:true },
    { label:'E-mail', name:'email', type:'email', required:true },
    { label:'Telefone / WhatsApp', name:'telefone', required:true },
    { label:'Endereço completo', name:'endereco', required:true },
    { label:'Cidade / Estado', name:'cidade_estado', required:true },
    { label:'CEP', name:'cep', required:false },
  ];
  const camposPJ = [
    { label:'Razão social', name:'razao_social', required:true },
    { label:'CNPJ', name:'cnpj', required:true, placeholder:'00.000.000/0000-00' },
    { label:'Nome do representante legal', name:'representante', required:true },
    { label:'CPF do representante', name:'cpf_representante', required:true },
    { label:'Cargo do representante', name:'cargo', required:true },
    { label:'E-mail corporativo', name:'email', type:'email', required:true },
    { label:'Telefone', name:'telefone', required:true },
    { label:'Endereço da sede', name:'endereco', required:true },
    { label:'Cidade / Estado', name:'cidade_estado', required:true },
    { label:'CEP', name:'cep', required:false },
  ];
  const campos = tipoPessoa === 'pf' ? camposPF : camposPJ;

  const podeProsseguir = () => campos.filter(c => c.required).every(c => (dados[c.name] || '').trim().length > 0);

  const assinar = async () => {
    if (!assinatura) { alert('Por favor, assine no campo de assinatura.'); return; }
    if (!aceite) { alert('É necessário aceitar os termos para prosseguir.'); return; }
    setEnviando(true);

    // Hash da assinatura
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(dados) + assinatura + token));
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');

    const { error } = await supabase.from('contratos_link').update({
      status: 'assinado',
      tipo_pessoa: tipoPessoa,
      dados_signatario: dados,
      assinatura,
      assinado_em: new Date().toISOString(),
      assinante_ip: null,
    }).eq('token', token);

    if (error) { alert('Erro ao assinar: ' + error.message); setEnviando(false); return; }
    setEtapa('ok');
  };

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f1f5f9', color:'#94a3b8' }}>
      <Loader2 size={28} style={{ animation:'spin 1s linear infinite' }} />
    </div>
  );

  if (erro) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#f1f5f9', padding:20 }}>
      <div style={{ textAlign:'center', maxWidth:420 }}>
        <AlertCircle size={48} color="#dc2626" style={{ margin:'0 auto 16px' }} />
        <h2 style={{ color:'#0f172a', marginBottom:8 }}>Link indisponível</h2>
        <p style={{ color:'#64748b' }}>{erro}</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:'100vh', background:'linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)', padding:'40px 20px', fontFamily:"'Inter',sans-serif" }}>
      <div style={{ maxWidth:600, margin:'0 auto', background:'white', borderRadius:20, overflow:'hidden', boxShadow:'0 24px 60px rgba(0,0,0,0.35)' }}>

        {/* Header */}
        <div style={{ background:'#0f172a', padding:'24px 28px', color:'white' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#60a5fa', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>TSN Ativos — Assinatura de Contrato</div>
          <h1 style={{ margin:0, fontSize:20, fontWeight:800 }}>{contrato.titulo}</h1>
        </div>

        <div style={{ padding:'28px 28px 36px' }}>

          {/* ETAPA: tipo de pessoa */}
          {etapa === 'tipo' && (
            <div>
              <p style={{ color:'#475569', fontSize:15, lineHeight:1.6, marginBottom:28 }}>
                Você foi convidado a assinar um documento digital. Para prosseguir, informe se você é pessoa física ou jurídica.
              </p>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:28 }}>
                {[
                  { key:'pf', emoji:'👤', titulo:'Pessoa Física', sub:'CPF, RG e dados pessoais' },
                  { key:'pj', emoji:'🏢', titulo:'Pessoa Jurídica', sub:'CNPJ e dados da empresa' },
                ].map(({ key, emoji, titulo, sub }) => (
                  <button key={key} onClick={() => { setTipoPessoa(key); setEtapa('dados'); }}
                    style={{ padding:'22px 16px', border:'2px solid #e2e8f0', borderRadius:14, background:'white', cursor:'pointer', textAlign:'center', transition:'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor='#2563eb'; e.currentTarget.style.background='#eff6ff'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='#e2e8f0'; e.currentTarget.style.background='white'; }}>
                    <div style={{ fontSize:36, marginBottom:10 }}>{emoji}</div>
                    <div style={{ fontWeight:800, color:'#0f172a', marginBottom:4 }}>{titulo}</div>
                    <div style={{ fontSize:12, color:'#64748b' }}>{sub}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ETAPA: dados do signatário */}
          {etapa === 'dados' && (
            <div>
              <div style={{ fontSize:13, color:'#64748b', marginBottom:20 }}>
                {tipoPessoa === 'pf' ? '👤 Pessoa Física' : '🏢 Pessoa Jurídica'} —{' '}
                <button onClick={() => setEtapa('tipo')} style={{ background:'none', border:'none', color:'#2563eb', cursor:'pointer', fontSize:13, padding:0 }}>trocar</button>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:24 }}>
                {campos.map(c => <Campo key={c.name} {...c} value={dados[c.name]||''} onChange={onChange} />)}
              </div>
              <button onClick={() => setEtapa('revisar')} disabled={!podeProsseguir()}
                style={{ width:'100%', padding:'13px', background:'#2563eb', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:15, cursor:'pointer', opacity:podeProsseguir()?1:0.5 }}>
                Revisar contrato →
              </button>
            </div>
          )}

          {/* ETAPA: revisar + assinar */}
          {etapa === 'revisar' && (
            <div>
              <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'20px', marginBottom:24, maxHeight:300, overflowY:'auto' }}>
                <div style={{ fontSize:13, color:'#374151', lineHeight:1.8, whiteSpace:'pre-wrap' }}>{contrato.conteudo}</div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:14, marginBottom:24 }}>
                <AssinaturaCanvas onChange={setAssinatura} />

                <label style={{ display:'flex', gap:10, alignItems:'flex-start', cursor:'pointer', fontSize:13, color:'#374151', lineHeight:1.5 }}>
                  <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop:2, flexShrink:0 }} />
                  <span>
                    Declaro que li e concordo com os termos do contrato acima, que as informações fornecidas são verdadeiras e que esta assinatura digital tem validade jurídica conforme a <strong>Lei 14.063/2020</strong> e o <strong>MP 2.200-2/2001</strong>.
                  </span>
                </label>
              </div>

              <button onClick={assinar} disabled={enviando || !aceite || !assinatura}
                style={{ width:'100%', padding:'14px', background:'#059669', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:15, cursor:'pointer', opacity:(enviando||!aceite||!assinatura)?0.5:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {enviando ? <><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} /> Assinando…</> : '✅ Assinar contrato'}
              </button>
              <button onClick={() => setEtapa('dados')} style={{ width:'100%', marginTop:10, padding:'11px', background:'none', border:'1px solid #e2e8f0', borderRadius:10, color:'#64748b', fontWeight:600, fontSize:14, cursor:'pointer' }}>
                ← Editar dados
              </button>
            </div>
          )}

          {/* ETAPA: concluído */}
          {etapa === 'ok' && (
            <div style={{ textAlign:'center', padding:'32px 0' }}>
              <CheckCircle2 size={64} color="#059669" style={{ margin:'0 auto 20px' }} />
              <h2 style={{ color:'#0f172a', marginBottom:8, fontWeight:900 }}>Contrato assinado!</h2>
              <p style={{ color:'#64748b', fontSize:14, lineHeight:1.7, maxWidth:380, margin:'0 auto' }}>
                Sua assinatura foi registrada com sucesso. O contrato assinado ficará disponível com as partes envolvidas.
              </p>
              <div style={{ marginTop:24, padding:'14px 18px', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, fontSize:13, color:'#166534', textAlign:'left' }}>
                <strong>Informações legais:</strong><br />
                Assinatura registrada em {new Date().toLocaleString('pt-BR')} com validade jurídica conforme Lei 14.063/2020.
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
