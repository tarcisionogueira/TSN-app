import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { CheckCircle2, ArrowRight, Loader2, AlertCircle, Eye, EyeOff, Camera, Upload, RefreshCw } from 'lucide-react';

const ROLE_CONFIG = {
  analista: {
    emoji: '🔍',
    label: 'Analista de Imóveis',
    cor: '#2563eb',
    descricao: 'Você foi selecionado para integrar nossa equipe como Analista — responsável pela avaliação de viabilidade e elaboração de laudos técnicos.',
    passos_extras: [
      { key: 'especialidade', label: 'Qual é sua área de especialidade?', tipo: 'select', opts: ['Análise financeira','Análise jurídica','Ambas'] },
      { key: 'experiencia', label: 'Há quanto tempo atua com leilões?', tipo: 'select', opts: ['Menos de 1 ano','1 a 3 anos','3 a 5 anos','Mais de 5 anos'] },
    ],
  },
  advogado: {
    emoji: '⚖️',
    label: 'Advogado Parceiro',
    cor: '#7c3aed',
    descricao: 'Você foi selecionado como Advogado Parceiro — responsável pela análise jurídica de editais, matrículas e processos.',
    passos_extras: [
      { key: 'oab', label: 'Qual é o seu número de OAB?', tipo: 'text', placeholder: 'Ex: 123456/SP' },
      { key: 'areas_atuacao', label: 'Qual é sua área de atuação principal?', tipo: 'select', opts: ['Direito Imobiliário','Direito Civil','Execuções e Leilões','Outro'] },
    ],
  },
  consultor: {
    emoji: '🤝',
    label: 'Consultor / Afiliado',
    cor: '#059669',
    descricao: 'Você foi selecionado como Consultor Parceiro — responsável pela captação e relacionamento com clientes investidores.',
    passos_extras: [
      { key: 'como_conheceu', label: 'Como conheceu a TSN Ativos?', tipo: 'select', opts: ['Indicação de parceiro','Redes sociais','Evento','Outro'] },
      { key: 'carteira', label: 'Possui carteira de clientes investidores?', tipo: 'select', opts: ['Sim, ativa','Em construção','Não ainda'] },
    ],
  },
  admin: {
    emoji: '🛡️',
    label: 'Administrador',
    cor: '#0f172a',
    descricao: 'Você foi convidado como Administrador da plataforma TSN Ativos.',
    passos_extras: [],
  },
};

const PASSOS_BASE = [
  { key: 'nome',     label: 'Qual é o seu nome completo?',       tipo: 'text',  placeholder: 'Nome e sobrenome' },
  { key: 'email',    label: 'Qual é o seu melhor e-mail?',        tipo: 'email', placeholder: 'seuemail@exemplo.com' },
  { key: 'cpf',      label: 'Qual é o seu CPF?',                  tipo: 'text',  placeholder: '000.000.000-00', mask: 'cpf' },
  { key: 'telefone', label: 'Qual é o seu WhatsApp / telefone?',  tipo: 'text',  placeholder: '(00) 00000-0000', mask: 'tel' },
];
const PASSO_SELFIE   = { key: 'selfie',         label: 'Tire uma selfie segurando seu documento', tipo: 'selfie' };
const PASSO_SENHA    = { key: 'senha',           label: 'Crie uma senha de acesso',               tipo: 'password', placeholder: 'Mínimo 8 caracteres' };
const PASSO_CONFIRMA = { key: 'confirma_senha',  label: 'Confirme sua senha',                     tipo: 'password', placeholder: 'Repita a senha' };

function maskCPF(v) {
  return v.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
}
function maskTel(v) {
  return v.replace(/\D/g,'').slice(0,11).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d{4})$/,'$1-$2');
}

// ─── Componente de Selfie ────────────────────────────────────────────────────
function PastoSelfie({ cor, onCapturada }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const [camAtiva, setCamAtiva] = useState(false);
  const [foto, setFoto] = useState(null);
  const [validando, setValidando] = useState(false);
  const [validacaoOk, setValidacaoOk] = useState(null);
  const [msgValidacao, setMsgValidacao] = useState('');
  const [erroCam, setErroCam] = useState('');

  const iniciarCam = useCallback(async () => {
    setErroCam('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCamAtiva(true);
    } catch {
      setErroCam('Não foi possível acessar a câmera. Use o botão de upload abaixo.');
    }
  }, []);

  const pararCam = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setCamAtiva(false);
  }, []);

  useEffect(() => { iniciarCam(); return () => pararCam(); }, []);

  const capturar = () => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    setFoto(dataUrl);
    pararCam();
    validarFoto(dataUrl);
  };

  const uploadFoto = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target.result;
      setFoto(dataUrl);
      pararCam();
      validarFoto(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const validarFoto = async (dataUrl) => {
    setValidando(true);
    setValidacaoOk(null);
    setMsgValidacao('');
    try {
      // Envia para API que usa Claude Vision para verificar rosto + documento
      const res = await fetch('/api/validar-selfie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagem: dataUrl }),
      });
      const data = await res.json();
      if (data.ok) {
        setValidacaoOk(true);
        setMsgValidacao(data.mensagem || 'Identidade verificada com sucesso.');
        onCapturada(dataUrl);
      } else {
        setValidacaoOk(false);
        setMsgValidacao(data.mensagem || 'Não foi possível verificar. Tente novamente.');
      }
    } catch {
      // Se API falhar, aceita a foto mesmo assim (não bloqueia o cadastro)
      setValidacaoOk(true);
      setMsgValidacao('Foto recebida. Verificação manual será realizada pela equipe.');
      onCapturada(dataUrl);
    }
    setValidando(false);
  };

  const refazer = () => {
    setFoto(null);
    setValidacaoOk(null);
    setMsgValidacao('');
    iniciarCam();
  };

  return (
    <div>
      {/* Preview / câmera */}
      <div style={{ position: 'relative', background: '#0f172a', borderRadius: 16, overflow: 'hidden', aspectRatio: '4/3', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {foto ? (
          <img src={foto} alt="selfie" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : camAtiva ? (
          <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
        ) : (
          <div style={{ textAlign: 'center', color: '#475569', padding: 24 }}>
            <Camera size={48} color="#334155" style={{ marginBottom: 12 }} />
            <div style={{ fontSize: 13 }}>{erroCam || 'Carregando câmera…'}</div>
          </div>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />

        {/* Overlay de validação */}
        {validando && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Loader2 size={32} color="white" style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>Verificando identidade…</span>
          </div>
        )}
      </div>

      {/* Instrução */}
      {!foto && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#15803d', marginBottom: 14, lineHeight: 1.6 }}>
          📋 <strong>Instrução:</strong> Segure seu RG ou CNH ao lado do rosto e tire a foto com boa iluminação. Ambos devem estar visíveis e legíveis.
        </div>
      )}

      {/* Resultado da validação */}
      {msgValidacao && (
        <div style={{ padding: '10px 14px', borderRadius: 10, marginBottom: 14, fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
          background: validacaoOk ? '#f0fdf4' : '#fef2f2',
          color: validacaoOk ? '#15803d' : '#dc2626',
          border: `1px solid ${validacaoOk ? '#bbf7d0' : '#fecaca'}` }}>
          {validacaoOk ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
          {msgValidacao}
        </div>
      )}

      {/* Botões */}
      <div style={{ display: 'flex', gap: 8 }}>
        {!foto && camAtiva && (
          <button onClick={capturar}
            style={{ flex: 1, padding: '12px', background: cor, color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Camera size={16} /> Capturar foto
          </button>
        )}
        {foto && (
          <button onClick={refazer}
            style={{ flex: 1, padding: '12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <RefreshCw size={15} /> Refazer foto
          </button>
        )}
        <label style={{ flex: foto ? 1 : 0, padding: '12px 16px', background: '#f1f5f9', color: '#475569', border: '1px dashed #cbd5e1', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, whiteSpace: 'nowrap' }}>
          <Upload size={14} /> {foto ? 'Trocar' : 'Upload'}
          <input type="file" accept="image/*" style={{ display: 'none' }} onChange={uploadFoto} />
        </label>
      </div>
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function ConviteEquipe() {
  const { token } = useParams();
  const nav = useNavigate();

  const [convite, setConvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [passoAtual, setPasso] = useState(0);
  const [form, setForm] = useState({});
  const [showSenha, setShowSenha] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [concluido, setConcluido] = useState(false);
  const [erroPasso, setErroPasso] = useState('');

  useEffect(() => {
    if (!token) return;
    supabase.from('convites_equipe')
      .select('id, token, roles, descricao, criado_em, expira_em')
      .eq('token', token.toUpperCase())
      .eq('ativo', true)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) setErro('Convite não encontrado, já utilizado ou expirado.');
        else if (data.expira_em && new Date(data.expira_em) < new Date()) setErro('Este convite expirou.');
        else setConvite(data);
        setLoading(false);
      });
  }, [token]);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={32} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (erro || !convite) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px' }} />
        <h2 style={{ color: 'white', marginBottom: 8 }}>Convite inválido</h2>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>{erro}</p>
        <button onClick={() => nav('/login')} style={{ padding: '10px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
          Ir para Login
        </button>
      </div>
    </div>
  );

  const roleKey = convite.roles?.[0] || 'analista';
  const cfg = ROLE_CONFIG[roleKey] || ROLE_CONFIG.analista;

  const passos = [
    ...PASSOS_BASE,
    ...cfg.passos_extras,
    PASSO_SELFIE,
    PASSO_SENHA,
    PASSO_CONFIRMA,
  ];

  const totalPassos = passos.length;
  const passo = passos[passoAtual];
  const progresso = Math.round((passoAtual / totalPassos) * 100);

  const setVal = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const aplicarMascara = (k, v) => {
    if (k === 'cpf') return maskCPF(v);
    if (k === 'telefone') return maskTel(v);
    return v;
  };

  const validarPasso = () => {
    if (passo.tipo === 'selfie') {
      return form.selfie ? '' : 'Capture ou envie uma foto com seu documento para continuar.';
    }
    const v = (form[passo.key] || '').trim();
    if (!v) return 'Preencha este campo para continuar.';
    if (passo.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Email inválido.';
    if (passo.key === 'cpf' && v.replace(/\D/g, '').length < 11) return 'CPF deve ter 11 dígitos.';
    if (passo.key === 'senha' && v.length < 8) return 'A senha deve ter pelo menos 8 caracteres.';
    if (passo.key === 'confirma_senha' && v !== form['senha']) return 'As senhas não coincidem.';
    return '';
  };

  const avancar = async () => {
    const err = validarPasso();
    if (err) { setErroPasso(err); return; }
    setErroPasso('');
    if (passoAtual < totalPassos - 1) {
      setPasso(p => p + 1);
    } else {
      await finalizarCadastro();
    }
  };

  const voltar = () => { if (passoAtual > 0) { setPasso(p => p - 1); setErroPasso(''); } };

  const finalizarCadastro = async () => {
    setEnviando(true);
    try {
      // Upload da selfie para Supabase Storage
      let selfieUrl = null;
      if (form.selfie) {
        const blob = await (await fetch(form.selfie)).blob();
        const path = `equipe/${Date.now()}_${form.cpf?.replace(/\D/g,'') || 'selfie'}.jpg`;
        const { data: up } = await supabase.storage.from('imoveis-fotos').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
        if (up?.path) {
          const { data: { publicUrl } } = supabase.storage.from('imoveis-fotos').getPublicUrl(up.path);
          selfieUrl = publicUrl;
        }
      }

      const extraData = Object.fromEntries(cfg.passos_extras.map(p => [p.key, form[p.key] || '']));

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.senha,
        options: {
          data: {
            nome: form.nome.trim(),
            cpf: form.cpf,
            telefone: form.telefone,
            role: roleKey,
            selfie_url: selfieUrl,
            lgpd_aceito: true,
            lgpd_data: new Date().toISOString(),
            ...extraData,
          },
        },
      });
      if (signUpError) throw signUpError;

      if (signUpData?.user?.id) {
        await supabase.rpc('usar_convite_equipe', {
          p_token: token.toUpperCase(),
          p_user_id: signUpData.user.id,
        });
      }

      setConcluido(true);
    } catch (err) {
      setErroPasso(err.message || 'Erro ao criar conta. Tente novamente.');
    }
    setEnviando(false);
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && passo.tipo !== 'selfie') avancar(); };

  if (concluido) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <CheckCircle2 size={64} color="#10b981" style={{ margin: '0 auto 20px' }} />
        <h1 style={{ fontSize: 28, fontWeight: 900, color: 'white', margin: '0 0 12px' }}>Cadastro concluído!</h1>
        <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.7, marginBottom: 32 }}>
          Bem-vindo à equipe TSN Ativos como <strong style={{ color: 'white' }}>{cfg.label}</strong>.<br />
          Verifique seu email para confirmar o cadastro e faça login para acessar a plataforma.
        </p>
        <button onClick={() => nav('/login')}
          style={{ padding: '14px 32px', background: cfg.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Ir para Login <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );

  const isSelfie = passo.tipo === 'selfie';
  const selfieOk = isSelfie && !!form.selfie;

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: cfg.cor + '22', border: `1px solid ${cfg.cor}44`, color: cfg.cor === '#0f172a' ? '#e2e8f0' : cfg.cor, fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 20, marginBottom: 24 }}>
        {cfg.emoji} {cfg.label}
      </div>

      <div style={{ maxWidth: isSelfie ? 520 : 480, width: '100%' }}>

        {/* Barra de progresso */}
        <div style={{ background: '#1e293b', borderRadius: 4, height: 4, marginBottom: 32, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progresso}%`, background: cfg.cor, borderRadius: 4, transition: 'width 0.4s ease' }} />
        </div>

        {/* Card do passo */}
        <div key={passoAtual} style={{ background: 'white', borderRadius: 20, padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)', animation: 'fadeIn 0.3s ease' }}>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {passoAtual + 1} de {totalPassos}
          </div>

          <h2 style={{ fontSize: isSelfie ? 18 : 22, fontWeight: 900, color: '#0f172a', margin: '0 0 20px', lineHeight: 1.3 }}>
            {passo.label}
          </h2>

          {/* Selfie */}
          {isSelfie && (
            <PastoSelfie cor={cfg.cor} onCapturada={(url) => setVal('selfie', url)} />
          )}

          {/* Select */}
          {passo.tipo === 'select' && (
            <select value={form[passo.key] || ''} onChange={e => setVal(passo.key, e.target.value)}
              style={{ width: '100%', padding: '14px 16px', border: `2px solid ${erroPasso ? '#ef4444' : '#e2e8f0'}`, borderRadius: 12, fontSize: 15, color: '#0f172a', background: 'white', boxSizing: 'border-box', outline: 'none', cursor: 'pointer' }}>
              <option value="">Selecione...</option>
              {passo.opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}

          {/* Password */}
          {passo.tipo === 'password' && (
            <div style={{ position: 'relative' }}>
              <input type={showSenha ? 'text' : 'password'} value={form[passo.key] || ''} onChange={e => setVal(passo.key, e.target.value)} onKeyDown={handleKeyDown} placeholder={passo.placeholder} autoFocus
                style={{ width: '100%', padding: '14px 48px 14px 16px', border: `2px solid ${erroPasso ? '#ef4444' : '#e2e8f0'}`, borderRadius: 12, fontSize: 15, color: '#0f172a', background: 'white', boxSizing: 'border-box', outline: 'none' }} />
              <button type="button" onClick={() => setShowSenha(s => !s)}
                style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          )}

          {/* Text / email */}
          {(passo.tipo === 'text' || passo.tipo === 'email') && (
            <input type={passo.tipo} value={form[passo.key] || ''} onChange={e => setVal(passo.key, aplicarMascara(passo.key, e.target.value))} onKeyDown={handleKeyDown} placeholder={passo.placeholder} autoFocus
              style={{ width: '100%', padding: '14px 16px', border: `2px solid ${erroPasso ? '#ef4444' : '#e2e8f0'}`, borderRadius: 12, fontSize: 15, color: '#0f172a', background: 'white', boxSizing: 'border-box', outline: 'none' }} />
          )}

          {/* Erro */}
          {erroPasso && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
              <AlertCircle size={14} /> {erroPasso}
            </div>
          )}

          {/* Navegação */}
          <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
            {passoAtual > 0 && (
              <button onClick={voltar}
                style={{ flex: 1, padding: '13px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
                ← Voltar
              </button>
            )}
            {(!isSelfie || selfieOk) && (
              <button onClick={avancar} disabled={enviando}
                style={{ flex: 2, padding: '13px', background: enviando ? '#94a3b8' : cfg.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: enviando ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                {enviando ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Criando conta…</>
                  : passoAtual === totalPassos - 1 ? <>Concluir <CheckCircle2 size={16} /></>
                  : <>Continuar <ArrowRight size={16} /></>}
              </button>
            )}
          </div>
        </div>

        {passoAtual === 0 && (
          <div style={{ marginTop: 20, padding: '14px 18px', background: cfg.cor + '18', border: `1px solid ${cfg.cor}33`, borderRadius: 12, fontSize: 13, color: '#e2e8f0', lineHeight: 1.6 }}>
            {cfg.descricao}
          </div>
        )}

        <p style={{ textAlign: 'center', marginTop: 20, fontSize: 12, color: '#475569' }}>
          Já tem conta?{' '}
          <span onClick={() => nav('/login')} style={{ color: '#60a5fa', cursor: 'pointer', fontWeight: 700 }}>Fazer login</span>
        </p>
      </div>
    </div>
  );
}
