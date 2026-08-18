import React, { useState, useEffect, useRef, useCallback } from 'react';
import { validarNome, normalizarNome } from '../lib/nome.js';
import { senhaForte, MSG_SENHA_FRACA } from '../lib/senha.js';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { CheckCircle2, ArrowRight, Loader2, AlertCircle, Eye, EyeOff, Camera, Upload, RefreshCw } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { salvarConvite, lerConvite, limparConvite, CHAVE_EQUIPE, CHAVE_CLIENTE } from '../utils/convitePendente';

const ROLE_CONFIG = {
  analista: {
    emoji: '🔍',
    label: 'Analista de Imóveis',
    cor: '#0D63DB',
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
      { key: 'como_conheceu', label: 'Como conheceu a BidPro Brasil?', tipo: 'select', opts: ['Indicação de parceiro','Redes sociais','Evento','Outro'] },
      { key: 'carteira', label: 'Possui carteira de clientes investidores?', tipo: 'select', opts: ['Sim, ativa','Em construção','Não ainda'] },
    ],
  },
  afiliado: {
    emoji: '📣',
    label: 'Afiliado',
    cor: '#db2777',
    descricao: 'Você foi convidado como Afiliado da BidPro Brasil. Divulgue seus links de venda e ganhe comissão sobre cada venda que vier por eles.',
    passos_extras: [
      { key: 'canal', label: 'Como você vai divulgar?', tipo: 'select', opts: ['Instagram','YouTube','TikTok','WhatsApp/Grupos','Site/Blog','Outro'] },
      { key: 'audiencia', label: 'Tamanho aproximado da sua audiência?', tipo: 'select', opts: ['Até 5 mil','5 a 20 mil','20 a 100 mil','Mais de 100 mil'] },
    ],
  },
  leiloeiro: {
    emoji: '🔨',
    label: 'Leiloeiro Oficial',
    cor: '#ea580c',
    descricao: 'Você foi convidado como Leiloeiro Parceiro da plataforma BidPro Brasil. Conecte seus imóveis e amplie o alcance dos seus leilões para toda a nossa base de investidores.',
    passos_extras: [
      { key: 'junta', label: 'Qual é a sua Junta Comercial de credenciamento?', tipo: 'select', opts: ['JUCESP (SP)','JUCERJ (RJ)','JUCEMG (MG)','JUCESE (SE)','JUCEMA (MA)','JUCEPA (PA)','JUCEBA (BA)','JUCEPE (PE)','JUCEAM (AM)','JUCEGO (GO)','Outra'] },
      { key: 'matricula', label: 'Número da matrícula de leiloeiro oficial', tipo: 'text', placeholder: 'Ex: 0123-SP' },
      { key: 'site', label: 'URL do seu site ou plataforma de leilões', tipo: 'text', placeholder: 'https://seuleilao.com.br' },
    ],
  },
  admin: {
    emoji: '🛡️',
    label: 'Administrador',
    cor: '#111111',
    descricao: 'Você foi convidado como Administrador da plataforma BidPro Brasil.',
    passos_extras: [],
  },
};

const PASSOS_BASE = [
  { key: 'nome',     label: 'Qual é o seu nome completo?',       tipo: 'text',  placeholder: 'Nome e sobrenome' },
  { key: 'email',    label: 'Qual é o seu melhor e-mail?',        tipo: 'email', placeholder: 'seuemail@exemplo.com' },
  { key: 'cpf',      label: 'Qual é o seu CPF?',                  tipo: 'text',  placeholder: '000.000.000-00', mask: 'cpf' },
  { key: 'telefone', label: 'Qual é o seu WhatsApp / telefone?',  tipo: 'text',  placeholder: '(00) 00000-0000', mask: 'tel' },
];

const PASSO_SELFIE_ROSTO = {
  key: 'selfie_rosto',
  label: 'Tire uma selfie — só o rosto, frente para a câmera',
  tipo: 'foto',
  instrucao: 'Olhe diretamente para a câmera. Boa iluminação, sem óculos escuros ou bonés.',
  validacao_tipo: 'rosto',
};

const PASSO_DOC = {
  key: 'doc_frente',
  label: 'Fotografe seu documento — RG ou CNH (frente)',
  tipo: 'foto',
  instrucao: 'Coloque o documento em superfície plana com boa iluminação. Deve estar completamente visível e legível.',
  validacao_tipo: 'documento',
};

const PASSO_SELFIE_DOC = {
  key: 'selfie_doc',
  label: 'Selfie segurando o documento ao lado do rosto',
  tipo: 'foto',
  instrucao: 'Segure o documento aberto ao lado do rosto. Ambos devem estar nítidos e visíveis.',
  validacao_tipo: 'ambos',
};

const PASSO_SENHA    = { key: 'senha',           label: 'Crie uma senha de acesso',               tipo: 'password', placeholder: 'Mínimo 8 caracteres' };
const PASSO_CONFIRMA = { key: 'confirma_senha',  label: 'Confirme sua senha',                     tipo: 'password', placeholder: 'Repita a senha' };

function maskCPF(v) {
  return v.replace(/\D/g,'').slice(0,11).replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
}
function maskTel(v) {
  return v.replace(/\D/g,'').slice(0,11).replace(/^(\d{2})(\d)/,'($1) $2').replace(/(\d{5})(\d{4})$/,'$1-$2');
}

// ─── Componente de Foto KYC ───────────────────────────────────────────────────
function PastoFoto({ cor, instrucao, validacaoTipo, onCapturada }) {
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
      const res = await apiCall('/api/validar-selfie', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imagem: dataUrl, tipo: validacaoTipo }),
      });
      // `.ok` CHECADO antes de ler o corpo: um 4xx/5xx traz JSON sem `ok` e caía no ramo
      // genérico, escondendo o motivo real da recusa.
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setValidacaoOk(true);
        setMsgValidacao(data.mensagem || 'Imagem verificada com sucesso.');
        onCapturada(dataUrl);
      } else {
        setValidacaoOk(false);
        setMsgValidacao(data.mensagem || data.error || 'Não foi possível verificar. Tente novamente.');
      }
    } catch {
      // FALHA NÃO É APROVAÇÃO (08/08). Este catch fazia `setValidacaoOk(true)` e chamava
      // `onCapturada` — ou seja, queda de rede ou erro 500 do servidor viravam "identidade
      // verificada", e a pessoa seguia no convite de equipe com a mensagem de que a equipe
      // faria conferência manual. Nenhuma conferência era registrada em lugar nenhum: o
      // erro virava aprovação silenciosa, no fluxo que dá ACESSO à operação.
      setValidacaoOk(false);
      setMsgValidacao('Não consegui verificar agora (falha de conexão). Tente novamente em instantes.');
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
      {/* Instrução */}
      {instrucao && !foto && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#15803d', marginBottom: 14, lineHeight: 1.6 }}>
          📋 {instrucao}
        </div>
      )}

      {/* Preview / câmera */}
      <div style={{ position: 'relative', background: '#111111', borderRadius: 16, overflow: 'hidden', aspectRatio: '4/3', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {foto ? (
          <img src={foto} alt="foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
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
            <span style={{ color: 'white', fontSize: 14, fontWeight: 600 }}>Verificando…</span>
          </div>
        )}
      </div>

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

// Comprime imagem para 800px max width a 80% quality
async function comprimirImagem(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 800;
      let w = img.width;
      let h = img.height;
      if (w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.src = dataUrl;
  });
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
  const [precisaConfirmarEmail, setPrecisaConfirmarEmail] = useState(false);
  const [erroPasso, setErroPasso] = useState('');

  useEffect(() => {
    if (!token) return;
    // SEGURANÇA: valida o token por RPC de correspondência EXATA (get_convite_equipe_info).
    // A tabela convites_equipe não é mais legível por token (evita enumerar todos os
    // convites ativos e roubar um token de staff antes do convidado real).
    supabase.rpc('get_convite_equipe_info', { p_token: token })
      .then(({ data, error }) => {
        if (error || !data?.valido) setErro('Convite não encontrado, já utilizado ou expirado.');
        else setConvite(data);
        setLoading(false);
      });
  }, [token]);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Loader2 size={32} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (erro || !convite) return (
    <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 440 }}>
        <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px' }} />
        <h2 style={{ color: 'white', marginBottom: 8 }}>Convite inválido</h2>
        <p style={{ color: '#94a3b8', marginBottom: 24 }}>{erro}</p>
        <button onClick={() => nav('/login')} style={{ padding: '10px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
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
    PASSO_SELFIE_ROSTO,
    PASSO_DOC,
    PASSO_SELFIE_DOC,
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

  const isFoto = passo.tipo === 'foto';

  const validarPasso = () => {
    if (isFoto) {
      return form[passo.key] ? '' : 'Capture ou envie uma foto para continuar.';
    }
    const v = (form[passo.key] || '').trim();
    if (!v) return 'Preencha este campo para continuar.';
    if (passo.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return 'Email inválido.';
    if (passo.key === 'cpf' && v.replace(/\D/g, '').length < 11) return 'CPF deve ter 11 dígitos.';
    // A tela PEDE "nome completo" desde sempre e aceitava um nome só — pedido sem regra é
    // sugestão. Mesma régua do cadastro comum (src/lib/nome.js).
    if (passo.key === 'nome') { const vn = validarNome(v); if (!vn.ok) return vn.erro; }
    // 18/08: aqui a senha exigia só 8 CARACTERES, enquanto Login e Checkout exigem maiúscula,
    // minúscula, número e especial desde 15/08. Era a cópia que não recebeu o conserto — e no
    // fluxo de EQUIPE, que entra com mais permissão que cliente. Passa a usar a regra única.
    if (passo.key === 'senha' && !senhaForte(v)) return MSG_SENHA_FRACA;
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
      // Comprimir as 3 fotos KYC. Elas são gravadas de forma privada em
      // convites_equipe.kyc_fotos (RLS: só equipe/admin lê) via salvar_kyc_equipe.
      // NÃO subimos a selfie para o bucket público de fotos de imóvel — é dado
      // biométrico sensível (LGPD) e o bucket permite listagem.
      const selfie_rosto_compressed = form.selfie_rosto ? await comprimirImagem(form.selfie_rosto) : null;
      const doc_frente_compressed   = form.doc_frente   ? await comprimirImagem(form.doc_frente)   : null;
      const selfie_doc_compressed   = form.selfie_doc   ? await comprimirImagem(form.selfie_doc)   : null;

      // Persiste o token para resgate do convite APÓS a autenticação (o RPC
      // usar_convite_equipe agora exige sessão e só eleva o próprio perfil; se o
      // cadastro exigir confirmação de e-mail, o AuthContext resgata no 1º login).
      if (token) salvarConvite(CHAVE_EQUIPE, token);

      const extraData = Object.fromEntries(cfg.passos_extras.map(p => [p.key, form[p.key] || '']));

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.senha,
        options: {
          data: {
            nome: normalizarNome(form.nome),
            telefone: form.telefone,
            role: roleKey,
            lgpd_aceito: true,
            lgpd_data: new Date().toISOString(),
            ...extraData,
          },
        },
      });
      if (signUpError) throw signUpError;
      // E-MAIL JÁ CADASTRADO NÃO DEVOLVE ERRO (10/08). Com "Confirm email" ligado, o Supabase
      // protege contra enumeração: responde 200 com um usuário FANTASMA, `identities: []` e
      // `confirmation_sent_at` preenchido — e não envia e-mail nenhum. Checando só o
      // `signUpError`, esta tela levava a pessoa pelos 9 passos e as 3 fotos de KYC e terminava
      // em "Cadastro concluído! Verifique também seu e-mail" com uma senha que não abre nada:
      // a conta antiga, com a senha antiga, é a única que existe.
      // Os outros dois fluxos de cadastro da base já tinham este guard (`Login.jsx:333` e
      // `Checkout.jsx:645`) — aqui foi omissão, não decisão. O convite NÃO se perde: o
      // AuthContext resgata `CHAVE_EQUIPE` no primeiro login (por isso a orientação é logar).
      if (signUpData?.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
        throw new Error('Este e-mail já tem conta na BidPro Brasil. Faça login (ou recupere a senha) com ele — seu convite de equipe é aplicado automaticamente no primeiro acesso.');
      }
      if (signUpData?.user?.confirmation_sent_at) setPrecisaConfirmarEmail(true);

      // KYC ANTES DO RESGATE — a ORDEM é o bug (10/08). `usar_convite_equipe` faz
      // `set ativo = false` no convite, e `salvar_kyc_equipe` filtra por
      // `ativo = true and kyc_fotos is null` (ver seguranca_convites_kyc_enumeracao.sql).
      // Rodando o resgate primeiro, as 3 fotos que a pessoa acabou de tirar eram descartadas
      // EM SILÊNCIO — e o retorno do RPC nem era checado. Salvando antes, o convite ainda está
      // ativo e as fotos entram; e agora o resultado é conferido, porque KYC perdido só
      // reaparece pedindo tudo de novo ao usuário.
      if (selfie_rosto_compressed || doc_frente_compressed || selfie_doc_compressed) {
        const { data: rKyc, error: eKyc } = await supabase.rpc('salvar_kyc_equipe', {
          p_token: token,
          p_fotos: {
            selfie_rosto: selfie_rosto_compressed,
            doc_frente: doc_frente_compressed,
            selfie_doc: selfie_doc_compressed,
            validado_em: new Date().toISOString(),
          },
        });
        if (eKyc || rKyc?.ok === false) console.warn('[convite-equipe] KYC não salvo:', eKyc?.message || rKyc?.erro);
      }

      if (signUpData?.user?.id) {
        // O RPC exige SESSÃO (`auth.uid()`): com confirmação de e-mail ligada, o signUp NÃO
        // devolve sessão e a chamada aqui volta {ok:false,'não autorizado'} — sempre. O
        // resgate real acontece no AuthContext, no primeiro login já autenticado. Só
        // chamamos quando há sessão (conta auto-confirmada); sem ela, guardamos o token
        // para o AuthContext resgatar. Antes a resposta era ignorada e a tela dava sucesso
        // como se o papel tivesse sido aplicado — a pessoa entrava como explorador (05/08).
        if (signUpData?.session) {
          const { data: rEq } = await supabase.rpc('usar_convite_equipe', {
            p_token: token,
            p_user_id: signUpData.user.id,
          });
          if (rEq?.ok === false) console.warn('[convite-equipe] resgate:', rEq?.erro);
        } else {
          salvarConvite(CHAVE_EQUIPE, token);
        }
        // CPF gravado só como hash + cifra (nunca em texto claro). Se já houver
        // sessão (conta auto-confirmada), persiste agora; senão, no 1º acesso.
        if (signUpData?.session && form.cpf) {
          try { await apiCall('/api/cpf-set', { method: 'POST', body: JSON.stringify({ cpf: form.cpf.replace(/\D/g, '') }) }); } catch { /* melhor esforço */ }
        }
      }

      // Gerar e enviar contrato operacional automaticamente (exceto admin)
      if (roleKey !== 'admin' && signUpData?.user?.id) {
        try {
          await apiCall('/api/contratos-operacional', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              roleDestino: roleKey,
              emailDestinatario: form.email.trim(),
              nomeDestinatario: normalizarNome(form.nome),
            }),
          });
        } catch (_) {
          // Falha no envio do contrato não bloqueia o cadastro
        }
      }

      setConcluido(true);
    } catch (err) {
      setErroPasso(err.message || 'Erro ao criar conta. Tente novamente.');
    }
    setEnviando(false);
  };

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !isFoto) avancar(); };

  if (concluido) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #111111 0%, #111111 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <CheckCircle2 size={64} color="#10b981" style={{ margin: '0 auto 20px' }} />
        <h1 style={{ fontSize: 28, fontWeight: 900, color: 'white', margin: '0 0 12px' }}>Cadastro concluído!</h1>
        <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.7, marginBottom: 32 }}>
          Bem-vindo à equipe BidPro Brasil como <strong style={{ color: 'white' }}>{cfg.label}</strong>.<br />
          Seu cadastro foi concluído. Faça login para acessar a plataforma.
          {precisaConfirmarEmail && (
            <><br /><span style={{ fontSize: 13, color: '#94a3b8' }}>Verifique também seu e-mail para confirmar o acesso.</span></>
          )}
        </p>
        <button onClick={() => nav('/login')}
          style={{ padding: '14px 32px', background: cfg.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          Ir para Login <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );

  const fotoOk = isFoto && !!form[passo.key];

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #111111 0%, #111111 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: cfg.cor + '22', border: `1px solid ${cfg.cor}44`, color: cfg.cor === '#111111' ? '#e2e8f0' : cfg.cor, fontSize: 13, fontWeight: 700, padding: '6px 16px', borderRadius: 20, marginBottom: 24 }}>
        {cfg.emoji} {cfg.label}
      </div>

      <div style={{ maxWidth: isFoto ? 520 : 480, width: '100%' }}>

        {/* Barra de progresso */}
        <div style={{ background: '#111111', borderRadius: 4, height: 4, marginBottom: 32, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${progresso}%`, background: cfg.cor, borderRadius: 4, transition: 'width 0.4s ease' }} />
        </div>

        {/* Card do passo */}
        <div key={passoAtual} style={{ background: 'white', borderRadius: 20, padding: '32px 28px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)', animation: 'fadeIn 0.3s ease' }}>

          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
            {passoAtual + 1} de {totalPassos}
          </div>

          <h2 style={{ fontSize: isFoto ? 18 : 22, fontWeight: 900, color: '#111111', margin: '0 0 20px', lineHeight: 1.3 }}>
            {passo.label}
          </h2>

          {/* Foto KYC */}
          {isFoto && (
            <PastoFoto
              cor={cfg.cor}
              instrucao={passo.instrucao}
              validacaoTipo={passo.validacao_tipo}
              onCapturada={(url) => setVal(passo.key, url)}
            />
          )}

          {/* Select */}
          {passo.tipo === 'select' && (
            <select value={form[passo.key] || ''} onChange={e => setVal(passo.key, e.target.value)}
              style={{ width: '100%', padding: '14px 16px', border: `2px solid ${erroPasso ? '#ef4444' : '#e2e8f0'}`, borderRadius: 12, fontSize: 15, color: '#111111', background: 'white', boxSizing: 'border-box', outline: 'none', cursor: 'pointer' }}>
              <option value="">Selecione...</option>
              {passo.opts.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}

          {/* Password */}
          {passo.tipo === 'password' && (
            <div style={{ position: 'relative' }}>
              <input type={showSenha ? 'text' : 'password'} value={form[passo.key] || ''} onChange={e => setVal(passo.key, e.target.value)} onKeyDown={handleKeyDown} placeholder={passo.placeholder} autoFocus
                style={{ width: '100%', padding: '14px 48px 14px 16px', border: `2px solid ${erroPasso ? '#ef4444' : '#e2e8f0'}`, borderRadius: 12, fontSize: 15, color: '#111111', background: 'white', boxSizing: 'border-box', outline: 'none' }} />
              <button type="button" onClick={() => setShowSenha(s => !s)}
                style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          )}

          {/* Text / email */}
          {(passo.tipo === 'text' || passo.tipo === 'email') && (
            <input type={passo.tipo} value={form[passo.key] || ''} onChange={e => setVal(passo.key, aplicarMascara(passo.key, e.target.value))} onKeyDown={handleKeyDown} placeholder={passo.placeholder} autoFocus
              style={{ width: '100%', padding: '14px 16px', border: `2px solid ${erroPasso ? '#ef4444' : '#e2e8f0'}`, borderRadius: 12, fontSize: 15, color: '#111111', background: 'white', boxSizing: 'border-box', outline: 'none' }} />
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
            {(!isFoto || fotoOk) && (
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
