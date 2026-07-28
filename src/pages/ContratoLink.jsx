import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle, Loader2, ShieldCheck, Camera, Upload, FileText, ExternalLink, Download, Clock } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';
import { formatCpf, formatCnpj } from '../utils/cnpjCep';
import EnderecoAutocomplete from '../components/EnderecoAutocomplete';
import { gerarContratoPDF } from '../components/ContratoPDF';

// Localização aproximada (best-effort, com consentimento) — ponto de autenticação no padrão ZapSign.
// Nunca bloqueia a assinatura: se negar/expirar, segue sem geo.
function capturarGeo() {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 7000, maximumAge: 60000 }
    );
  });
}

const DOCS_LABELS = {
  foto_doc: 'Foto do documento de identidade (RG ou CNH)',
  selfie: 'Selfie (foto do rosto)',
  selfie_doc: 'Selfie ao lado do documento de identidade',
  comprovante_residencia: 'Comprovante de residência',
  estado_civil: 'Certidão de estado civil',
  procuracao: 'Procuração ou documento de representação legal',
};

// Componente de captura/upload de imagem
function CapturaImagem({ id, label, onChange, valor }) {
  const fileRef = useRef();
  const videoRef = useRef();
  const [modo, setModo] = useState('idle'); // idle | camera | uploaded
  const [stream, setStream] = useState(null);

  const abrirCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      setStream(s);
      setModo('camera');
      setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = s; }, 100);
    } catch { setModo('idle'); fileRef.current?.click(); }
  };

  const capturar = () => {
    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    onChange(id, dataUrl);
    stream?.getTracks().forEach(t => t.stop());
    setStream(null); setModo('uploaded');
  };

  const handleFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { onChange(id, ev.target.result); setModo('uploaded'); };
    reader.readAsDataURL(file);
  };

  const remover = () => { onChange(id, null); setModo('idle'); };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>{label} *</div>
      {modo === 'idle' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={abrirCamera} style={{ flex: 1, padding: '12px', border: '1.5px dashed #cbd5e1', borderRadius: 9, background: '#f8fafc', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, color: '#475569', fontWeight: 600 }}>
            <Camera size={16} /> Câmera
          </button>
          <button type="button" onClick={() => fileRef.current?.click()} style={{ flex: 1, padding: '12px', border: '1.5px dashed #cbd5e1', borderRadius: 9, background: '#f8fafc', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12.5, color: '#475569', fontWeight: 600 }}>
            <Upload size={16} /> Arquivo
          </button>
          <input ref={fileRef} type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={handleFile} />
        </div>
      )}
      {modo === 'camera' && (
        <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: '#000' }}>
          <video ref={videoRef} autoPlay playsInline style={{ width: '100%', display: 'block', maxHeight: 240, objectFit: 'cover' }} />
          <button type="button" onClick={capturar} style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', padding: '10px 24px', background: 'white', border: 'none', borderRadius: 24, fontWeight: 800, cursor: 'pointer', fontSize: 13 }}>
            Capturar
          </button>
        </div>
      )}
      {modo === 'uploaded' && valor && (
        <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', border: '2px solid #86efac' }}>
          {valor.startsWith('data:image') || valor.startsWith('http') ? (
            <img src={valor} alt={label} style={{ width: '100%', maxHeight: 200, objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ padding: '14px 16px', background: '#f0fdf4', display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={16} color="#059669" /><span style={{ fontSize: 13, color: '#059669', fontWeight: 600 }}>Arquivo carregado ✓</span>
            </div>
          )}
          <button type="button" onClick={remover} style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.5)', color: 'white', border: 'none', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
            Trocar
          </button>
        </div>
      )}
    </div>
  );
}

const inp = { width:'100%', padding:'10px 13px', border:'1px solid #e2e8f0', borderRadius:9, fontSize:14, background:'white', color:'#111111', boxSizing:'border-box' };
const lbl = { fontSize:12, fontWeight:700, color:'#94a3b8', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 };

function Campo({ label, name, value, onChange, onBlur, type='text', required=false, placeholder='' }) {
  return (
    <div>
      <label style={lbl}>{label}{required && ' *'}</label>
      <input type={type} name={name} value={value} onChange={onChange} onBlur={onBlur} required={required} placeholder={placeholder} style={inp} />
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
  const [docId, setDocId] = useState(''); // CPF/CNPJ digitado na identificação (auto-detecta PF/PJ)
  const [dados, setDados] = useState({});
  const [assinatura, setAssinatura] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [aceite, setAceite] = useState(false);
  const [lgpdAceite, setLgpdAceite] = useState(false);
  const [imagensIdentidade, setImagensIdentidade] = useState({}); // { foto_doc: dataUrl, selfie: dataUrl, ... }
  const [testemunha, setTestemunha] = useState({ nome: '', cpf: '' });
  const [assinaturaTest, setAssinaturaTest] = useState(null); // dataURL da assinatura da testemunha
  const [copiadoT, setCopiadoT] = useState(false); // feedback ao copiar o link da testemunha
  const [jaAssinado, setJaAssinado] = useState(false); // link reaberto/concluído → modo LEITURA (não dead-end)
  const [roster, setRoster] = useState([]); // partes do contrato + status de assinatura (via token)
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const testemunhaUrl = contrato?.requer_testemunha && contrato?.testemunha_token ? `${origin}/#/t/${contrato.testemunha_token}` : null;
  const conteudoRef = useRef(null);

  const setImagem = useCallback((id, val) => {
    setImagensIdentidade(p => val ? { ...p, [id]: val } : Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)));
  }, []);

  useEffect(() => {
    if (!token) return;
    // Acesso público ao contrato SÓ pelo token exato, via RPC SECURITY DEFINER
    // (a policy anônima antiga permitia enumerar TODOS os contratos pendentes,
    // vazando kyc_fotos + assinante_email). A RPC devolve a linha só p/ o token.
    supabase.rpc('get_contrato_por_token', { p_token: token })
      .then(({ data, error }) => {
        const c = Array.isArray(data) ? data[0] : data;
        if (error || !c) setErro('Contrato não encontrado ou link inválido.');
        // Já assinado NÃO é mais dead-end: carrega em modo LEITURA (ver o contrato + quem
        // assinou/falta + baixar). Antes caía num "Link indisponível" sem saída. Precede a
        // checagem de expiração (contrato assinado é válido mesmo após a janela de assinatura).
        else if (c.status === 'assinado') { setContrato(c); setJaAssinado(true); }
        else if (c.status === 'expirado' || new Date(c.expira_em) < new Date()) setErro('Este link expirou.');
        else setContrato(c);
        setLoading(false);
      });
  }, [token]);

  // Situação das partes (quem já assinou / quem falta) — via TOKEN (funciona logado ou anônimo).
  // Refaz após assinar (etapa muda) para refletir a nova assinatura na tela de leitura.
  useEffect(() => {
    if (!token || !contrato) return;
    supabase.rpc('get_partes_por_token', { p_token: token })
      .then(({ data }) => setRoster(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [token, contrato, etapa]);

  const up = (k, v) => setDados(p => ({ ...p, [k]: v }));
  const onChange = e => up(e.target.name, e.target.value);

  // Endereço em UM campo só (pedido do dono, como no Índice): a pessoa digita o endereço completo
  // COM número/bairro/cidade-UF num único campo, em vez de 3 (endereço + cidade/estado + CEP).
  const PLACEHOLDER_END = 'Rua, número, complemento, bairro, cidade/UF';
  const camposPF = [
    { label:'Nome completo', name:'nome', required:true },
    { label:'CPF', name:'cpf', required:true, placeholder:'000.000.000-00' },
    { label:'RG', name:'rg', required:true },
    { label:'E-mail', name:'email', type:'email', required:true },
    { label:'Telefone / WhatsApp', name:'telefone', required:true },
    { label:'Endereço completo (com número)', name:'endereco', required:true, placeholder: PLACEHOLDER_END, autocomplete:true },
  ];
  const camposPJ = [
    { label:'Razão social', name:'razao_social', required:true },
    { label:'CNPJ', name:'cnpj', required:true, placeholder:'00.000.000/0000-00' },
    { label:'Nome do representante legal', name:'representante', required:true },
    { label:'CPF do representante', name:'cpf_representante', required:true },
    { label:'Cargo do representante', name:'cargo', required:true },
    { label:'E-mail corporativo', name:'email', type:'email', required:true },
    { label:'Telefone', name:'telefone', required:true },
    { label:'Endereço completo da sede (com número)', name:'endereco', required:true, placeholder: PLACEHOLDER_END, autocomplete:true },
  ];
  const campos = tipoPessoa === 'pf' ? camposPF : camposPJ;

  const podeProsseguir = () => campos.filter(c => c.required).every(c => (dados[c.name] || '').trim().length > 0);

  const assinar = async () => {
    if (!assinatura) { alert('Por favor, assine no campo de assinatura.'); return; }
    if (!aceite) { alert('É necessário aceitar os termos para prosseguir.'); return; }

    // Valida documentos de identidade obrigatórios
    const verif = contrato?.verificacao_identidade;
    if (verif && verif !== 'nenhuma') {
      const tiposObrigatorios = verif === 'selfie_doc' ? ['selfie_doc'] : verif === 'selfie' ? ['selfie'] : verif === 'foto_doc' ? ['foto_doc'] : [];
      for (const tipo of tiposObrigatorios) {
        if (!imagensIdentidade[tipo]) { alert(`Envie a ${DOCS_LABELS[tipo]} para continuar.`); return; }
      }
    }
    const extrasObrig = contrato?.docs_extras_exigidos || [];
    for (const doc of extrasObrig) {
      if (!imagensIdentidade[doc]) { alert(`Envie: ${DOCS_LABELS[doc]}`); return; }
    }
    // Testemunha: NÃO é coletada aqui. Quando o contrato exige, a parte assina sozinha e, ao
    // concluir, recebe um LINK para encaminhar à sua testemunha (assina remotamente).

    setEnviando(true);
    // Ponto de autenticação (ZapSign): localização aproximada, best-effort. O dispositivo (user-agent)
    // e o IP são capturados no servidor. Nada disso bloqueia a assinatura.
    const geo = await capturarGeo();
    // Finaliza no servidor: IP, carimbo de tempo e hash (incluindo o conteúdo do
    // contrato) são gerados de forma autoritativa — não confiáveis se vindos do cliente.
    try {
      const resp = await fetch('/api/assinar-contrato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, tipo_pessoa: tipoPessoa, dados, assinatura, docs_identidade: imagensIdentidade, testemunha: null, geo }),
      });
      const out = await resp.json().catch(() => ({}));
      if (!resp.ok || !out.ok) { alert('Erro ao assinar: ' + (out.error || 'tente novamente')); setEnviando(false); return; }
    } catch (e) {
      alert('Erro ao assinar: ' + (e.message || 'falha de conexão')); setEnviando(false); return;
    }
    setEtapa('ok');
  };

  // Baixa o DOCUMENTO assinado (contrato + manifesto de assinaturas com os elementos de validade
  // jurídica NO PRÓPRIO documento) via impressão → "Salvar como PDF". Substitui o antigo .txt.
  const baixarDocumento = () => gerarContratoPDF({ contrato, roster });

  // COMPLETAR pontos de autenticação (dispositivo/localização) de uma assinatura já feita ANTES de
  // o sistema capturá-los. Não re-assina, não altera assinatura/hash/carimbo originais.
  const [completando, setCompletando] = useState(false);
  const [completado, setCompletado] = useState(false);
  const completarDados = async () => {
    setCompletando(true);
    try {
      const geo = await capturarGeo(); // best-effort: no desktop costuma ser negado/indisponível
      const resp = await fetch('/api/complementar-assinatura', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, geo }),
      });
      const out = await resp.json().catch(() => ({}));
      if (resp.ok && (out.ok || out.jaCompleto)) {
        setCompletado(true); // feedback imediato — o dispositivo já foi registrado (geo é opcional)
        const { data } = await supabase.rpc('get_contrato_por_token', { p_token: token });
        const c = Array.isArray(data) ? data[0] : data; if (c) setContrato(c);
      } else { alert(out.error || 'Não foi possível completar os dados.'); }
    } catch { alert('Não foi possível completar os dados. Verifique a conexão e tente novamente.'); }
    setCompletando(false);
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

  // MODO LEITURA: link já assinado (reaberto) OU clique em "Ver contrato e assinaturas" na tela de
  // sucesso. Mostra o layout do documento + quais partes já assinaram / faltam + baixar. Funciona
  // para signatário anônimo (dados vêm por token via get_partes_por_token).
  if (jaAssinado && contrato) {
    const totAssin = roster.filter(p => p.assinou).length;
    const completo = roster.length > 0 && totAssin === roster.length;
    return (
      <div style={{ minHeight:'100vh', background:'#111111', fontFamily:"'Inter',sans-serif", paddingTop:'env(safe-area-inset-top,0px)' }}>
        <div style={{ padding:isMobile?'16px':'22px 28px', display:'flex', alignItems:'center', gap:12, borderBottom:'1px solid #1e293b' }}>
          <div style={{ width:32, height:32, background:'#0D63DB', borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
            <ShieldCheck size={18} color="white" />
          </div>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:11, color:'#60a5fa', fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>BidPro Brasil, Contrato Digital</div>
            <div style={{ fontSize:15, fontWeight:800, color:'white', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{contrato.titulo}</div>
          </div>
        </div>

        <div style={{ maxWidth:820, width:'100%', margin:'0 auto', padding:isMobile?'16px':'26px 24px', display:'flex', flexDirection:'column', gap:18, boxSizing:'border-box' }}>
          {/* Situação geral */}
          <div style={{ padding:'14px 18px', borderRadius:12, background: completo ? 'rgba(52,211,153,0.1)' : 'rgba(234,179,8,0.1)', border:`1px solid ${completo ? 'rgba(52,211,153,0.35)' : 'rgba(234,179,8,0.35)'}`, display:'flex', alignItems:'center', gap:10 }}>
            {completo ? <CheckCircle2 size={20} color="#34d399" /> : <Clock size={20} color="#eab308" />}
            <div style={{ color: completo ? '#34d399' : '#eab308', fontWeight:800, fontSize:14 }}>
              {completo ? 'Contrato totalmente assinado' : `Aguardando assinaturas${roster.length ? ` — ${totAssin} de ${roster.length} assinaram` : ''}`}
            </div>
          </div>

          {/* Documento (o layout da página) */}
          <div>
            <div style={{ fontSize:11, color:'#475569', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>
              {contrato.arquivo_url ? 'Documento' : 'Conteúdo do contrato'}
            </div>
            {contrato.arquivo_url ? (
              contrato.arquivo_url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                ? <img src={contrato.arquivo_url} alt="Documento" style={{ width:'100%', borderRadius:10, maxHeight:560, objectFit:'contain', background:'#0f172a' }} />
                : <a href={contrato.arquivo_url} target="_blank" rel="noreferrer" style={{ display:'flex', alignItems:'center', gap:8, padding:'14px 18px', background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.3)', borderRadius:10, color:'#60a5fa', fontWeight:700, fontSize:14, textDecoration:'none' }}><ExternalLink size={16} /> Abrir documento</a>
            ) : (
              <div style={{ whiteSpace:'pre-wrap', fontSize:13.5, lineHeight:1.9, color:'#cbd5e1', background:'#0f172a', borderRadius:12, padding:'20px 22px', border:'1px solid #1e293b' }}>
                {contrato.conteudo}
              </div>
            )}
          </div>

          {/* AO FINAL DO DOCUMENTO: assinaturas + validade jurídica (o que a MP 2.200-2/2001 e a Lei
              14.063/2020 pedem: identificação dos signatários, data/hora, IP e código de integridade). */}
          <div style={{ background:'#0f172a', border:'1px solid #1e293b', borderRadius:12, padding:'18px 20px' }}>
            <div style={{ fontSize:12, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:1, marginBottom:6 }}>Assinaturas e validade jurídica</div>
            <div style={{ fontSize:12, color:'#64748b', lineHeight:1.7, marginBottom:14 }}>
              Documento assinado eletronicamente nos termos da MP 2.200-2/2001 (ICP-Brasil) e da Lei 14.063/2020. A integridade é garantida pelo código de verificação (hash SHA-256) abaixo; qualquer alteração no texto invalida a assinatura.
            </div>
            {roster.length === 0 ? (
              <div style={{ color:'#64748b', fontSize:13 }}>Carregando…</div>
            ) : roster.map((p, i) => (
              <div key={i} style={{ padding:'11px 0', borderTop: i ? '1px solid #1e293b' : 'none' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                  <div style={{ fontSize:14, fontWeight:700, color:'white', minWidth:0, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.nome}{p.eu ? ' (você)' : ''}</div>
                  <span style={{ flexShrink:0, fontSize:11.5, fontWeight:700, padding:'4px 11px', borderRadius:20, background: p.assinou ? 'rgba(52,211,153,0.15)' : 'rgba(234,179,8,0.15)', color: p.assinou ? '#34d399' : '#eab308', display:'flex', alignItems:'center', gap:5 }}>
                    {p.assinou ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                    {p.assinou ? 'Assinou' : 'Pendente'}
                  </span>
                </div>
                <div style={{ fontSize:11.5, color:'#64748b', lineHeight:1.7, marginTop:4 }}>
                  {p.assinou && p.assinado_em && <div>Assinado em {new Date(p.assinado_em).toLocaleString('pt-BR')}</div>}
                  {p.requer_testemunha && <div>Testemunha: {p.testemunha_assinou ? 'assinou' : 'pendente'}</div>}
                  {p.eu && contrato.status === 'assinado' && (<>
                    {contrato.dados_signatario?.cpf && <div>CPF: {contrato.dados_signatario.cpf}</div>}
                    {contrato.dados_signatario?.cnpj && <div>CNPJ: {contrato.dados_signatario.cnpj}</div>}
                    {contrato.assinante_ip && <div>IP de origem: {contrato.assinante_ip}</div>}
                  </>)}
                </div>
              </div>
            ))}
            {contrato.assinatura_hash && (
              <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid #1e293b', fontSize:11, color:'#64748b', wordBreak:'break-all' }}>
                <strong style={{ color:'#94a3b8' }}>Código de verificação (SHA-256):</strong> {contrato.assinatura_hash}
              </div>
            )}
            {/* Assinaturas antigas, sem dispositivo/localização: o próprio signatário completa agora,
                sem re-assinar (não altera assinatura/hash/carimbo originais). A LOCALIZAÇÃO é
                best-effort (no desktop costuma ser negada) — o DISPOSITIVO já basta para completar. */}
            {contrato.status === 'assinado' && (() => {
              const jaComplementou = completado || !!contrato.dados_complementados_em;
              const falta = !contrato.assinante_user_agent || !contrato.assinante_geo;
              if (jaComplementou) return (
                <div style={{ marginTop:14, padding:'10px 14px', background:'rgba(52,211,153,0.08)', border:'1px solid rgba(52,211,153,0.3)', borderRadius:10, fontSize:12.5, color:'#34d399', fontWeight:600 }}>
                  ✓ Dados de autenticação registrados{!contrato.assinante_geo ? ' — localização não disponível neste dispositivo (dispositivo e IP registrados).' : '.'}
                </div>
              );
              if (!falta) return null;
              return (
                <div style={{ marginTop:14, padding:'12px 14px', background:'rgba(234,179,8,0.08)', border:'1px solid rgba(234,179,8,0.3)', borderRadius:10 }}>
                  <div style={{ fontSize:12.5, color:'#eab308', fontWeight:700, marginBottom:8 }}>Complete os dados de autenticação deste documento (dispositivo e localização).</div>
                  <button onClick={completarDados} disabled={completando}
                    style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 15px', background: completando ? '#334155' : '#eab308', color: completando ? '#94a3b8' : '#111', border:'none', borderRadius:9, fontWeight:800, fontSize:13, cursor: completando ? 'default' : 'pointer' }}>
                    {completando ? 'Registrando…' : 'Completar dados de autenticação'}
                  </button>
                </div>
              );
            })()}
            <button onClick={baixarDocumento} style={{ marginTop:16, display:'flex', alignItems:'center', gap:7, padding:'10px 16px', background:'#0D63DB', color:'white', border:'none', borderRadius:9, fontWeight:700, fontSize:13, cursor:'pointer' }}>
              <Download size={15} /> Baixar documento assinado
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        {testemunhaUrl && (
          <div style={{ marginTop:16, padding:'16px 18px', background:'rgba(13,99,219,0.12)', border:'1px solid rgba(96,165,250,0.4)', borderRadius:10, textAlign:'left' }}>
            <div style={{ fontSize:13.5, fontWeight:800, color:'#bfdbfe', marginBottom:6 }}>Falta a sua testemunha assinar</div>
            <div style={{ fontSize:12.5, color:'#94a3b8', lineHeight:1.6, marginBottom:10 }}>Encaminhe o link abaixo à sua testemunha (WhatsApp, e-mail…). Ela vai preencher nome, CPF e assinar na tela.</div>
            <div style={{ display:'flex', gap:8, alignItems:'center' }}>
              <input readOnly value={testemunhaUrl} onFocus={e => e.target.select()}
                style={{ flex:1, minWidth:0, padding:'9px 11px', borderRadius:8, border:'1px solid #334155', background:'#1e293b', color:'#e2e8f0', fontSize:12 }} />
              <button onClick={() => { navigator.clipboard?.writeText(testemunhaUrl); setCopiadoT(true); setTimeout(() => setCopiadoT(false), 1800); }}
                style={{ flexShrink:0, padding:'9px 14px', background: copiadoT ? '#065f46' : '#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12.5, cursor:'pointer' }}>
                {copiadoT ? '✓ Copiado!' : 'Copiar link'}
              </button>
            </div>
          </div>
        )}
        <button onClick={() => setJaAssinado(true)}
          style={{ marginTop:20, width:'100%', padding:'12px', background:'#0D63DB', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
          <FileText size={16} /> Ver contrato e quem já assinou
        </button>
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
          <div style={{ fontSize:11, color:'#60a5fa', fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>BidPro Brasil, Contrato Digital</div>
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
            {contrato.arquivo_url ? 'Documento para assinatura' : 'Conteúdo do contrato'}
          </div>

          {/* Documento em arquivo (PDF/Word/imagem) */}
          {contrato.arquivo_url ? (
            <div style={{ background:'#111827', borderRadius:12, padding:'20px 22px', border:'1px solid #111111' }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
                <FileText size={20} color="#60a5fa" />
                <span style={{ fontSize:14, color:'#e2e8f0', fontWeight:700 }}>{contrato.arquivo_nome || 'Documento'}</span>
              </div>
              {contrato.arquivo_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                <img src={contrato.arquivo_url} alt="Documento" style={{ width:'100%', borderRadius:8, maxHeight:400, objectFit:'contain' }} />
              ) : (
                <a href={contrato.arquivo_url} target="_blank" rel="noreferrer"
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'14px 18px', background:'rgba(96,165,250,0.1)', border:'1px solid rgba(96,165,250,0.3)', borderRadius:10, color:'#60a5fa', fontWeight:700, fontSize:14, textDecoration:'none' }}>
                  <ExternalLink size={16} /> Abrir documento para leitura
                </a>
              )}
              <p style={{ margin:'12px 0 0', fontSize:12, color:'#64748b', lineHeight:1.6 }}>
                Leia o documento antes de prosseguir para a assinatura.
              </p>
            </div>
          ) : (
            <div style={{
              whiteSpace:'pre-wrap', fontSize:13.5, lineHeight:1.9, color:'#cbd5e1',
              background:'#111827', borderRadius:12, padding:'20px 22px',
              border:'1px solid #111111', minHeight:200,
            }}>
              {contrato.conteudo}
            </div>
          )}
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
                  { key: 'selfie_rosto', label: 'Selfie, Identidade Visual', desc: 'Foto do signatário para identificação' },
                  { key: 'doc_frente', label: 'Documento de Identidade — Frente', desc: 'RG ou CNH, frente' },
                  { key: 'doc_verso', label: 'Documento de Identidade — Verso', desc: 'RG ou CNH, verso' },
                  { key: 'doc_digital', label: 'Documento Digital', desc: 'CNH-e / RG digital' },
                  { key: 'selfie_doc', label: 'Selfie com Documento', desc: 'Confirmação de posse do documento' },
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

              {/* Sem escolher PF/PJ: a pessoa digita o DOCUMENTO e o sistema detecta sozinho —
                  11 dígitos = CPF (pede RG e dados pessoais); 14 = CNPJ (pede razão social, sócio…). */}
              {(() => {
                const digs = docId.replace(/\D/g, '');
                const tipoDet = digs.length === 14 ? 'pj' : (digs.length === 11 ? 'pf' : null);
                const mascara = digs.length > 11 ? formatCnpj(docId) : formatCpf(docId);
                const continuar = () => {
                  if (!lgpdAceite || !tipoDet) return;
                  setTipoPessoa(tipoDet);
                  up(tipoDet === 'pj' ? 'cnpj' : 'cpf', mascara); // já leva o documento p/ a próxima etapa
                  setEtapa('dados');
                };
                return (
                  <div>
                    <label style={lbl}>CPF ou CNPJ *</label>
                    <input value={mascara} onChange={e => setDocId(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') continuar(); }}
                      placeholder="Digite seu CPF (pessoa física) ou o CNPJ (empresa)"
                      inputMode="numeric" autoFocus disabled={!lgpdAceite}
                      style={{ ...inp, opacity: lgpdAceite ? 1 : 0.5 }} />
                    {tipoDet ? (
                      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: '#34d399', display: 'flex', alignItems: 'center', gap: 6 }}>
                        ✓ {tipoDet === 'pf' ? 'Pessoa Física — a seguir pediremos RG e seus dados' : 'Pessoa Jurídica — a seguir pediremos razão social e dados do sócio'}
                      </div>
                    ) : digs.length > 0 ? (
                      <div style={{ marginTop: 8, fontSize: 11.5, color: '#94a3b8' }}>Continue digitando: CPF tem 11 dígitos; CNPJ tem 14.</div>
                    ) : null}
                    <button onClick={continuar} disabled={!lgpdAceite || !tipoDet}
                      style={{ marginTop: 18, width: '100%', padding: '13px', background: (lgpdAceite && tipoDet) ? '#0D63DB' : '#334155', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: (lgpdAceite && tipoDet) ? 'pointer' : 'not-allowed', opacity: (lgpdAceite && tipoDet) ? 1 : 0.6 }}>
                      Continuar →
                    </button>
                  </div>
                );
              })()}
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
                {campos.map(c => c.autocomplete ? (
                  // Mesmo autocomplete de endereço do Índice (Google Places via proxy). onType mantém
                  // o texto digitado à mão valendo (endereço obrigatório mesmo sem escolher sugestão);
                  // onSelect grava o endereço completo estruturado quando a pessoa escolhe da lista.
                  <div key={c.name}>
                    <label style={lbl}>{c.label}{c.required && ' *'}</label>
                    <EnderecoAutocomplete
                      placeholder={c.placeholder}
                      defaultValue={dados[c.name] || ''}
                      inputStyle={{ background:'#ffffff', color:'#111111', border:'1px solid #e2e8f0', borderRadius:9 }}
                      onType={(t) => up(c.name, t)}
                      onSelect={(end) => {
                        const built = [
                          [end.logradouro, end.numero].filter(Boolean).join(', '),
                          [end.bairro, [end.cidade, end.uf].filter(Boolean).join('/'), end.cep].filter(Boolean).join(', '),
                        ].filter(Boolean).join(' - ');
                        up(c.name, end.formatado || built);
                      }}
                    />
                  </div>
                ) : (
                  <Campo key={c.name} {...c} value={dados[c.name]||''} onChange={onChange} />
                ))}
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

              {/* Verificação de identidade */}
              {contrato?.verificacao_identidade && contrato.verificacao_identidade !== 'nenhuma' && (
                <div style={{ marginBottom:20, padding:'14px 16px', background:'rgba(96,165,250,0.08)', border:'1px solid rgba(96,165,250,0.2)', borderRadius:10 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#60a5fa', marginBottom:12, textTransform:'uppercase', letterSpacing:0.5 }}>
                    Verificação de Identidade Obrigatória
                  </div>
                  <CapturaImagem
                    id={contrato.verificacao_identidade}
                    label={DOCS_LABELS[contrato.verificacao_identidade]}
                    onChange={setImagem}
                    valor={imagensIdentidade[contrato.verificacao_identidade]}
                  />
                </div>
              )}

              {/* Documentos extras exigidos */}
              {(contrato?.docs_extras_exigidos || []).length > 0 && (
                <div style={{ marginBottom:20, padding:'14px 16px', background:'rgba(250,204,21,0.07)', border:'1px solid rgba(250,204,21,0.2)', borderRadius:10 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#fbbf24', marginBottom:12, textTransform:'uppercase', letterSpacing:0.5 }}>
                    Documentos Adicionais Solicitados
                  </div>
                  {(contrato.docs_extras_exigidos || []).map(id => (
                    <CapturaImagem key={id} id={id} label={DOCS_LABELS[id] || id} onChange={setImagem} valor={imagensIdentidade[id]} />
                  ))}
                </div>
              )}

              <div style={{ marginBottom:18 }}>
                <AssinaturaCanvas onChange={setAssinatura} />
              </div>

              {/* Testemunha por LINK: a parte NÃO coleta a testemunha aqui. Ao concluir a sua
                  assinatura, aparece um link para encaminhar à sua testemunha (ver tela final). */}
              {contrato?.requer_testemunha && (
                <div style={{ marginBottom:18, padding:'12px 16px', border:'1px solid #334155', borderRadius:12, background:'#0f172a', fontSize:12.5, color:'#94a3b8', lineHeight:1.6 }}>
                  <strong style={{ color:'#cbd5e1' }}>Este contrato exige uma testemunha.</strong> Assine agora normalmente; ao concluir, você receberá um link para encaminhar à SUA testemunha (ela preenche nome, CPF e assina). O contrato fica completo quando os dois assinarem.
                </div>
              )}

              <label style={{ display:'flex', gap:10, alignItems:'flex-start', cursor:'pointer', fontSize:12.5, color:'#94a3b8', lineHeight:1.6, marginBottom:20 }}>
                <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop:2, flexShrink:0 }} />
                <span>
                  Li o documento, concordo com seus termos e declaro que os documentos enviados são verídicos. Reconheço esta assinatura eletrônica como juridicamente válida nos termos da <strong style={{ color:'#cbd5e1' }}>Lei 14.063/2020</strong> e <strong style={{ color:'#cbd5e1' }}>MP 2.200-2/2001</strong>.
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
