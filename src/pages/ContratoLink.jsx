import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';

const inp = { width:'100%', padding:'10px 13px', border:'1px solid #e2e8f0', borderRadius:9, fontSize:14, background:'white', color:'#111111', boxSizing:'border-box' };
const lbl = { fontSize:12, fontWeight:700, color:'#94a3b8', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 };

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
    ctx.lineTo(pos.x, pos.y); ctx.strokeStyle = '#111111'; ctx.lineWidth = 2.5;
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
      <canvas ref={canvasRef} width={800} height={120}
        style={{ width:'100%', height:120, border:'2px dashed #cbd5e1', borderRadius:9, background:'#f8fafc', touchAction:'none', cursor:'crosshair' }}
        onMouseDown={iniciar} onMouseMove={desenhar} onMouseUp={terminar} onMouseLeave={terminar}
        onTouchStart={iniciar} onTouchMove={desenhar} onTouchEnd={terminar} />
      <div style={{ display:'flex', justifyContent:'space-between', marginTop:4, fontSize:11, color:'#94a3b8' }}>
        <span>Assine com o mouse ou toque</span>
        {tem && <button type="button" onClick={limpar} style={{ background:'none', border:'none', color:'#dc2626', cursor:'pointer', fontSize:12, padding:0 }}>Limpar</button>}
      </div>
    </div>
  );
}

export default function ContratoLink() {
  const { token } = useParams();
  const isMobile = useIsMobile();
  const [contrato, setContrato] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [etapa, setEtapa] = useState('tipo'); // tipo → dados → revisar → ok
  const [tipoPessoa, setTipoPessoa] = useState('');
  const [dados, setDados] = useState({});
  const [assinatura, setAssinatura] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aceite, setAceite] = useState(false);
  const [lgpdAceite, setLgpdAceite] = useState(false);
  const conteudoRef = useRef(null);

  useEffect(() => {
    if (!token) return;
    supabase.from('contratos_link').select('id, titulo, conteudo, tipo_contrato, status, expira_em, kyc_incluido, kyc_fotos')
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
    const enc = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', enc.encode(JSON.stringify(dados) + assinatura + token));
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
    const { error } = await supabase.from('contratos_link').update({
      status: 'assinado',
      tipo_pessoa: tipoPessoa,
      dados_signatario: dados,
      assinatura,
      assinado_em: new Date().toISOString(),
      assinatura_hash: hash,
    }).eq('token', token);
    if (error) { alert('Erro ao assinar: ' + error.message); setEnviando(false); return; }
    setEtapa('ok');
  };

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#111111' }}>
      <Loader2 size={32} color="#60a5fa" style={{ animation:'spin 1s linear infinite' }} />
    </div>
  );

  if (erro) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#111111', padding:20 }}>
      <div style={{ textAlign:'center', maxWidth:420 }}>
        <AlertCircle size={52} color="#f87171" style={{ margin:'0 auto 20px' }} />
        <h2 style={{ color:'white', marginBottom:8 }}>Link indisponível</h2>
        <p style={{ color:'#94a3b8' }}>{erro}</p>
      </div>
    </div>
  );

  if (etapa === 'ok') return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#111111', padding:20 }}>
      <div style={{ textAlign:'center', maxWidth:480, background:'#111111', borderRadius:20, padding:'48px 32px', border:'1px solid #334155' }}>
        <CheckCircle2 size={72} color="#34d399" style={{ margin:'0 auto 24px' }} />
        <h2 style={{ color:'white', marginBottom:8, fontWeight:900, fontSize:26 }}>Contrato assinado!</h2>
        <p style={{ color:'#94a3b8', fontSize:15, lineHeight:1.7 }}>
          Sua assinatura foi registrada com sucesso e tem validade jurídica conforme a Lei 14.063/2020.
        </p>
        <div style={{ marginTop:24, padding:'14px 18px', background:'rgba(52,211,153,0.1)', border:'1px solid rgba(52,211,153,0.3)', borderRadius:10, fontSize:13, color:'#34d399', textAlign:'left', lineHeight:1.8 }}>
          <strong>Registrado em:</strong> {new Date().toLocaleString('pt-BR')}
        </div>
      </div>
    </div>
  );

  // Layout principal: coluna esquerda = contrato, coluna direita = formulário
  // Em mobile: empilhado
  return (
    <div style={{ minHeight:'100vh', background:'#111111', fontFamily:"'Inter',sans-serif", display:'flex', flexDirection:'column' }}>
      {/* Barra de título */}
      <div style={{ background:'#111111', borderBottom:'1px solid #111111', padding:isMobile ? '14px 16px' : '16px 28px', display:'flex', alignItems:'center', gap:12, flexShrink:0 }}>
        <div style={{ width:32, height:32, background:'#0D63DB', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center' }}>
          <ShieldCheck size={18} color="white" />
        </div>
        <div>
          <div style={{ fontSize:11, color:'#60a5fa', fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>TSN Ativos — Contrato Digital</div>
          <div style={{ fontSize:15, fontWeight:800, color:'white' }}>{contrato.titulo}</div>
        </div>
      </div>

      {/* Corpo */}
      <div style={{ flex:1, display:'flex', flexDirection: isMobile ? 'column' : 'row', overflow:'hidden', minHeight:0 }}>

        {/* Painel esquerdo: texto do contrato */}
        <div ref={conteudoRef} style={{
          flex: isMobile ? 'none' : 1,
          overflowY:'auto',
          padding: isMobile ? '16px 16px 0' : '28px 32px',
          borderRight: isMobile ? 'none' : '1px solid #111111',
          maxHeight: isMobile ? '45vh' : 'none',
        }}>
          <div style={{ fontSize:11, color:'#475569', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:16 }}>
            Conteúdo do contrato
          </div>
          <div style={{
            whiteSpace:'pre-wrap', fontSize:13.5, lineHeight:1.9, color:'#cbd5e1',
            background:'#111827', borderRadius:12, padding:'20px 22px',
            border:'1px solid #111111', minHeight:200,
          }}>
            {contrato.conteudo}
          </div>
          {/* KYC section */}
          {contrato.kyc_incluido && contrato.kyc_fotos && (
            <div style={{ marginTop: 32 }}>
              <div style={{ borderTop: '2px solid #111111', paddingTop: 24, marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                  Documentação KYC
                </div>
                <div style={{ fontSize: 13, color: '#64748b' }}>
                  Identidade verificada e documentação fotográfica anexada a este instrumento contratual.
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
                {[
                  { key: 'selfie_rosto', label: '1. Selfie — Identidade Visual', desc: 'Foto do signatário para identificação' },
                  { key: 'doc_frente', label: '2. Documento de Identidade', desc: 'RG ou CNH — frente' },
                  { key: 'selfie_doc', label: '3. Selfie com Documento', desc: 'Confirmação de posse do documento' },
                ].filter(({ key }) => contrato.kyc_fotos[key]).map(({ key, label, desc }) => (
                  <div key={key} style={{ background: '#1a2744', border: '1px solid #111111', borderRadius: 12, overflow: 'hidden' }}>
                    <img
                      src={contrato.kyc_fotos[key]}
                      alt={label}
                      style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }}
                    />
                    <div style={{ padding: '10px 14px' }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#cbd5e1' }}>{label}</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 8, fontSize: 11, color: '#475569', lineHeight: 1.6 }}>
                As imagens acima foram coletadas durante o processo de assinatura eletrônica e fazem parte integrante deste instrumento contratual para fins de identificação e verificação de autoria, conforme Lei 14.063/2020.
              </div>
            </div>
          )}

          <div style={{ height:24 }} />
        </div>

        {/* Painel direito: formulário de assinatura */}
        <div style={{
          width: isMobile ? '100%' : 420,
          flexShrink:0,
          overflowY:'auto',
          background:'#111827',
          padding: isMobile ? '16px 16px 24px' : '28px 24px',
          borderTop: isMobile ? '1px solid #111111' : 'none',
        }}>

          {/* ETAPA: tipo de pessoa */}
          {etapa === 'tipo' && (
            <div>
              <div style={{ fontSize:14, fontWeight:800, color:'white', marginBottom:16 }}>Identificação</div>

              <div style={{ background:'rgba(37,99,235,0.1)', border:'1px solid rgba(37,99,235,0.3)', borderRadius:10, padding:'12px 14px', marginBottom:16, fontSize:12.5, color:'#93c5fd', lineHeight:1.6 }}>
                <strong>Aviso LGPD:</strong> Seus dados pessoais serão usados exclusivamente para a assinatura deste contrato, conforme a Lei nº 13.709/2018.
              </div>

              <label style={{ display:'flex', alignItems:'flex-start', gap:10, fontSize:12.5, color:'#94a3b8', lineHeight:1.5, marginBottom:24, cursor:'pointer' }}>
                <input type="checkbox" checked={lgpdAceite} onChange={e => setLgpdAceite(e.target.checked)} style={{ marginTop:2, flexShrink:0 }} />
                <span>Autorizo o uso dos meus dados para a assinatura eletrônica deste contrato (LGPD art. 7º, I e V).</span>
              </label>

              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  { key:'pf', emoji:'👤', titulo:'Pessoa Física', sub:'CPF, RG e dados pessoais' },
                  { key:'pj', emoji:'🏢', titulo:'Pessoa Jurídica', sub:'CNPJ e dados da empresa' },
                ].map(({ key, emoji, titulo, sub }) => (
                  <button key={key} onClick={() => { if (!lgpdAceite) return; setTipoPessoa(key); setEtapa('dados'); }}
                    disabled={!lgpdAceite}
                    style={{ padding:'16px', border:'1px solid #334155', borderRadius:12, background:'#111111', cursor:lgpdAceite?'pointer':'not-allowed', textAlign:'left', display:'flex', alignItems:'center', gap:14, opacity:lgpdAceite?1:0.4, transition:'all 0.15s' }}
                    onMouseEnter={e => { if (!lgpdAceite) return; e.currentTarget.style.borderColor='#3b82f6'; e.currentTarget.style.background='rgba(59,130,246,0.1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor='#334155'; e.currentTarget.style.background='#111111'; }}>
                    <span style={{ fontSize:28 }}>{emoji}</span>
                    <div>
                      <div style={{ fontWeight:800, color:'white', fontSize:14 }}>{titulo}</div>
                      <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{sub}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* ETAPA: dados do signatário */}
          {etapa === 'dados' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <div style={{ fontSize:14, fontWeight:800, color:'white' }}>Seus dados</div>
                <button onClick={() => setEtapa('tipo')} style={{ background:'none', border:'none', color:'#60a5fa', cursor:'pointer', fontSize:12, padding:0 }}>
                  ← Voltar
                </button>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:20 }}>
                {campos.map(c => <Campo key={c.name} {...c} value={dados[c.name]||''} onChange={onChange} />)}
              </div>
              <button onClick={() => setEtapa('revisar')} disabled={!podeProsseguir()}
                style={{ width:'100%', padding:'13px', background:'#0D63DB', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:14, cursor:'pointer', opacity:podeProsseguir()?1:0.5 }}>
                Próximo: Revisar e assinar →
              </button>
            </div>
          )}

          {/* ETAPA: assinar */}
          {etapa === 'revisar' && (
            <div>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <div style={{ fontSize:14, fontWeight:800, color:'white' }}>Assinatura eletrônica</div>
                <button onClick={() => setEtapa('dados')} style={{ background:'none', border:'none', color:'#60a5fa', cursor:'pointer', fontSize:12, padding:0 }}>
                  ← Voltar
                </button>
              </div>

              <div style={{ marginBottom:18 }}>
                <AssinaturaCanvas onChange={setAssinatura} />
              </div>

              <label style={{ display:'flex', gap:10, alignItems:'flex-start', cursor:'pointer', fontSize:12.5, color:'#94a3b8', lineHeight:1.6, marginBottom:20 }}>
                <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop:2, flexShrink:0 }} />
                <span>
                  Li o contrato e concordo com seus termos. Reconheço esta assinatura eletrônica como juridicamente válida nos termos da <strong style={{ color:'#cbd5e1' }}>Lei 14.063/2020</strong> e <strong style={{ color:'#cbd5e1' }}>MP 2.200-2/2001</strong>.
                </span>
              </label>

              <button onClick={assinar} disabled={enviando || !aceite || !assinatura}
                style={{ width:'100%', padding:'14px', background:'#059669', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:15, cursor:'pointer', opacity:(enviando||!aceite||!assinatura)?0.5:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                {enviando
                  ? <><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }} /> Registrando…</>
                  : <><ShieldCheck size={16} /> Assinar contrato</>
                }
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
