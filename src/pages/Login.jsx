import React, { useState, useEffect } from 'react';
import { usePlanos } from '../contexts/PlanosContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { trackCadastro } from '../utils/gtag';
import { registrarEvento } from '../utils/tracker';
import { Briefcase, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { buscarTodasCidades } from '../data/cidades';
import { salvarRef, lerRef } from '../utils/ref';
import { salvarConvite, lerConvite, limparConvite, CHAVE_EQUIPE, CHAVE_CLIENTE, CHAVE_PLANO } from '../utils/convitePendente';

const inp = {
  width: '100%', padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: 10,
  fontSize: 14, background: 'white', color: '#111111', boxSizing: 'border-box',
};
const lbl = { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 };

export default function Login() {
  const planosCtx = usePlanos();
  const pNome = (key) => planosCtx?.[key]?.nome || { top2: 'Investidor Pro', assessorado: 'Assessoria', clube: 'Leilão Club', explorador: 'Explorador' }[key] || key;
  const nav = useNavigate();
  const loc = useLocation();
  // HashRouter coloca query params dentro do hash, ex: /#/login?ref=ABC
  // useLocation().search parseia corretamente dentro do hash
  const params = new URLSearchParams(loc.search);
  const planoEscolhido = params.get('plano');
  const promoParam = params.get('promo')?.toUpperCase() || '';
  const refParam = params.get('ref')?.toUpperCase() || '';
  const conviteParam = params.get('convite')?.toUpperCase() || '';
  const modoParam = params.get('modo');
  const nextParam = params.get('next') || '';
  const [refCodigo] = useState(() => refParam || lerRef());

  const conviteEquipeParam = params.get('convite_equipe') || '';

  // Persiste o ref e convite em sessionStorage
  useEffect(() => {
    if (refParam) salvarRef(refParam); // persiste com janela de 30 dias
    if (conviteParam) salvarConvite(CHAVE_CLIENTE, conviteParam);
    if (conviteEquipeParam) salvarConvite(CHAVE_EQUIPE, conviteEquipeParam);
  }, [refParam, conviteParam, conviteEquipeParam]);

  // Processa convite de equipe após autenticação
  async function processarConviteEquipe(userId) {
    const token = lerConvite(CHAVE_EQUIPE);
    if (!token) return;
    try {
      // RPC SECURITY DEFINER: valida (ativo/expira_em/usado_em), atribui o role
      // e marca o convite como usado. Atualizar perfis/convites direto do cliente
      // é barrado pela RLS (usuário comum não altera o próprio role).
      const { data, error } = await supabase.rpc('usar_convite_equipe', { p_token: token, p_user_id: userId });
      if (error) throw error;
      if (data?.ok) limparConvite(CHAVE_EQUIPE);
    } catch (e) {
      console.error('Erro ao processar convite de equipe:', e);
    }
  }

  const produtoParam = params.get('produto') || ''; // tipo:id ex: curso:abc123
  // Destino da página do produto (ebook/curso) a partir de ?produto=tipo:id.
  const destinoProduto = (pp) => {
    const i = String(pp || '').indexOf(':');
    if (i <= 0) return '';
    const t = pp.slice(0, i), id = pp.slice(i + 1);
    return (id && (t === 'ebook' || t === 'curso')) ? `/p/${t}/${id}` : '';
  };
  const [modo, setModo] = useState(modoParam === 'cadastro' || planoEscolhido ? 'cadastro' : 'login'); // 'login' | 'cadastro' | 'sucesso' | 'recuperar' | 'recuperar_sucesso'
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // Ambientes onde o login com Google costuma FALHAR no 2FA: o Google BLOQUEIA navegadores
  // embutidos (Instagram/Facebook/etc.) e, em PWA instalado (standalone) / iOS, o OAuth abre num
  // navegador sobreposto e o retorno "perde" a sessão (armazenamento isolado). Nesses casos
  // orientamos o e-mail/senha (funciona 100% ali) ou abrir no Safari/Chrome. Detecção client-only.
  const [ambienteFragilGoogle] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      const ua = navigator.userAgent || '';
      const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
      const inApp = /(FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|LinkedInApp|Snapchat|Pinterest|MicroMessenger|WhatsApp|GSA\/)/i.test(ua);
      return !!(standalone || inApp);
    } catch { return false; }
  });
  const [erro, setErro] = useState('');
  const [emailNaoConfirmado, setEmailNaoConfirmado] = useState(false);
  const [reenviando, setReenviando] = useState(false);
  const [reenviado, setReenviado] = useState(false);
  const [showSenha, setShowSenha] = useState(false);
  const [cpfCheck, setCpfCheck] = useState(null); // null | { temConta, temAcesso, role }
  const [cpfChecking, setCpfChecking] = useState(false);
  const [emailDuplicado, setEmailDuplicado] = useState(false);

  const [aceite, setAceite] = useState(false);

  const [form, setForm] = useState({
    email: '', senha: '', nome: '', cpf: '', telefone: '', endereco: '',
  });

  async function checarEmail(email) {
    if (!email || !email.includes('@')) return;
    try {
      const res = await apiCall('/api/verificar-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      // Erro/rate-limit (429/5xx): NÃO rebaixar para "não duplicado" — isso destravaria
      // o botão de cadastro e deixaria passar um e-mail já existente. Mantém o estado atual.
      if (!res.ok) return;
      const data = await res.json();
      setEmailDuplicado(!!data.temConta);
    } catch (_) {}
  }

  async function checarCPF(cpf) {
    const cpfLimpo = cpf.replace(/\D/g, '');
    if (cpfLimpo.length < 11) { setCpfCheck(null); return; }
    setCpfChecking(true);
    try {
      const produto = planoEscolhido
        ? { tipo: 'plano', planoKey: planoEscolhido }
        : produtoParam
        ? { tipo: produtoParam.split(':')[0], id: produtoParam.split(':')[1] }
        : null;
      const res = await apiCall('/api/verificar-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpfLimpo, produto }),
      });
      // Só confia no resultado se a chamada OK; um 429/5xx tem corpo { error } que
      // viraria cpfCheck.temConta = undefined e abriria os gates de "CPF já tem conta".
      if (res.ok) {
        const data = await res.json();
        setCpfCheck(data);
      }
    } catch (_) { setCpfCheck(null); }
    setCpfChecking(false);
  }

  const [emailRecuperar, setEmailRecuperar] = useState('');

  const handleRecuperarSenha = async (e) => {
    e.preventDefault();
    setErro(''); setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailRecuperar, {
        redirectTo: `${window.location.origin}/#/redefinir-senha`,
      });
      if (error) throw error;
      setModo('recuperar_sucesso');
    } catch (err) {
      registrarEvento('api_erro', { alvo: 'recuperacao_senha_falha', detalhe: String(err?.message || '').slice(0, 150) });
      setErro(traduzErroAuth(err.message) || 'Erro ao enviar email de recuperação.');
    }
    setLoading(false);
  };

  const up = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Máscaras de digitação
  const maskCPF = (v) => v.replace(/\D/g, '').slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2');
  const maskTel = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 11);
    if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2');
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2');
  };

  // Login com Google: se o usuário ABRE a tela do Google e CANCELA (botão X / voltar),
  // a página volta do bfcache do Safari com googleLoading=true — o botão fica travado em
  // "Conectando…" e desabilitado, sem nenhum erro (o redirect tinha dado certo). Reseta o
  // estado quando a página reaparece (pageshow do bfcache ou aba voltando a ficar visível).
  // No caso de SUCESSO o retorno é um load novo (googleLoading já nasce false), então é seguro.
  useEffect(() => {
    const reset = () => setGoogleLoading(false);
    const onPageShow = (e) => { if (e.persisted) reset(); };
    const onVisible = () => { if (document.visibilityState === 'visible') reset(); };
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Autocomplete de cidade (IBGE nacional, carregado uma vez)
  const [cidadesBR, setCidadesBR] = useState([]);
  useEffect(() => { buscarTodasCidades().then(setCidadesBR).catch(() => {}); }, []);
  const sugestoesCidade = (() => {
    const q = (form.endereco || '').toLowerCase().trim();
    if (q.length < 2 || !cidadesBR.length) return [];
    return cidadesBR.filter(c => c.toLowerCase().includes(q)).slice(0, 8);
  })();

  const handleGoogle = async () => {
    setErro(''); setGoogleLoading(true);
    try {
      if (planoEscolhido) salvarConvite(CHAVE_PLANO, planoEscolhido);
      // Salva ref antes do redirect OAuth (sessionStorage pode ser limpo em alguns browsers)
      if (refCodigo) salvarRef(refCodigo); // persiste antes do redirect OAuth (janela de 30 dias)
      // O fluxo OAuth NÃO passa pelo handleLogin, então calculamos aqui o destino
      // pós-login (plano/checkout, next ou produto) e o AuthContext o consome.
      const produtoRedirect = sessionStorage.getItem('tsn_redirect_produto');
      const planoPendente = planoEscolhido || lerConvite(CHAVE_PLANO);
      const promoPendente = promoParam || sessionStorage.getItem('tsn_promo_pendente') || '';
      let dest = '';
      if (produtoRedirect) dest = produtoRedirect;
      else if (planoPendente) dest = `/checkout?plano=${planoPendente}${promoPendente ? `&promo=${promoPendente}` : ''}`;
      else if (nextParam) dest = nextParam;
      if (dest) sessionStorage.setItem('tsn_oauth_redirect', dest);
      // redirectTo = origem atual, mas força www no domínio de produção: o apex
      // bidprobrasil.com.br responde 308 e o redirect do OAuth pode perder o token
      // na volta (mesmo motivo dos webhooks). Em www/preview fica inalterado.
      const redirectTo = window.location.origin.replace('://bidprobrasil.com.br', '://www.bidprobrasil.com.br');
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        // O destino final precisa estar na allowlist do Supabase (Authentication >
        // URL Configuration > Redirect URLs) e o callback do Supabase, nas URIs
        // autorizadas do OAuth client no Google Cloud.
        options: { redirectTo },
      });
      if (error) throw error;
      // Em sucesso, o browser redireciona para o Google (não volta aqui).
    } catch (err) {
      registrarEvento('api_erro', { alvo: 'oauth_google_falha', detalhe: String(err?.message || '').slice(0, 150) });
      setErro(traduzErroAuth(err.message) || 'Não foi possível conectar com o Google. Tente novamente.');
      setGoogleLoading(false);
    }
  };

  // Traduz mensagens de erro do Supabase Auth para português
  const traduzErroAuth = (msg = '') => {
    const m = String(msg);
    if (/invalid login credentials/i.test(m)) return 'Email ou senha incorretos.';
    if (/email not confirmed/i.test(m)) return 'Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada e o spam, ou reenvie a confirmação abaixo.';
    if (/already registered|already been registered/i.test(m)) return 'Este e-mail já está cadastrado. Faça login ou recupere a senha.';
    if (/password should be at least/i.test(m)) return 'A senha é muito curta. Use ao menos 8 caracteres.';
    if (/email rate limit|over_email_send_rate/i.test(m)) return 'Muitas tentativas de envio de e-mail. Aguarde alguns minutos e tente novamente.';
    if (/for security purposes|rate limit|too many requests/i.test(m)) return 'Muitas tentativas em pouco tempo. Aguarde um instante e tente de novo.';
    if (/invalid email|unable to validate email|email address.*invalid/i.test(m)) return 'E-mail inválido. Confira o endereço digitado.';
    if (/new password should be different/i.test(m)) return 'A nova senha deve ser diferente da anterior.';
    return m || 'Ocorreu um erro. Tente novamente.';
  };

  const reenviarConfirmacao = async () => {
    if (!form.email) { setErro('Informe seu e-mail no campo acima para reenviar a confirmação.'); return; }
    setReenviando(true);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: form.email,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (error) throw error;
      setReenviado(true); setErro('');
    } catch (err) {
      registrarEvento('api_erro', { alvo: 'reenvio_confirmacao_falha', detalhe: String(err?.message || '').slice(0, 150) });
      setErro(traduzErroAuth(err.message));
    }
    setReenviando(false);
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErro(''); setEmailNaoConfirmado(false); setReenviado(false); setLoading(true);
    try {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.senha });
      if (error) throw error;
      // Processa convite de equipe se existir
      if (signInData?.user) await processarConviteEquipe(signInData.user.id);
      // Verifica plano no sessionStorage (definido durante cadastro) ou na URL
      const produtoRedirect = sessionStorage.getItem('tsn_redirect_produto');
      sessionStorage.removeItem('tsn_redirect_produto');
      const planoPendente = planoEscolhido || lerConvite(CHAVE_PLANO);
      limparConvite(CHAVE_PLANO);
      const promoPendente = promoParam || sessionStorage.getItem('tsn_promo_pendente') || '';
      sessionStorage.removeItem('tsn_promo_pendente');
      // Funil de produto pago: quem veio de /p/ebook|curso/:id ("Já tenho conta, Entrar" ou
      // "Comprar agora") chega com ?produto=tipo:id. Antes esse param era ignorado no redirect
      // e o visitante caía na Home, perdendo a intenção de compra. Volta para a página do produto.
      const destProduto = destinoProduto(produtoParam);
      if (produtoRedirect) {
        nav(produtoRedirect);
      } else if (destProduto) {
        nav(destProduto);
      } else if (planoPendente) {
        nav(`/checkout?plano=${planoPendente}${promoPendente ? `&promo=${promoPendente}` : ''}`);
      } else if (nextParam) {
        // nextParam já vem decodificado de URLSearchParams — não decodificar de novo
        nav(nextParam);
      } else {
        nav('/');
      }
    } catch (err) {
      // Falha de LOGIN agora deixa rastro (antes: zero registro — gap da auditoria E1.6).
      registrarEvento('api_erro', { alvo: 'login_falha', detalhe: String(err?.message || '').slice(0, 150) });
      if (/email not confirmed/i.test(err.message || '')) setEmailNaoConfirmado(true);
      setErro(traduzErroAuth(err.message));
    }
    setLoading(false);
  };

  const handleCadastro = async (e) => {
    e.preventDefault();
    setErro(''); setLoading(true);
    try {
      if (!form.nome || !form.email || !form.senha) throw new Error('Preencha nome, email e senha.');
      // Cidade é obrigatória (mesmo no explorador grátis): filtra os imóveis da região do
      // usuário e é a base dos alertas por e-mail. CPF NÃO é exigido aqui — só na hora de pagar.
      if (!form.endereco || !form.endereco.trim()) throw new Error('Informe sua cidade — ela filtra os imóveis da sua região e é a base dos seus alertas por e-mail.');
      // Senha forte: 8+ com maiúscula, minúscula, número e caractere especial
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(form.senha)) {
        throw new Error('A senha deve ter ao menos 8 caracteres, com letra maiúscula, minúscula, número e caractere especial.');
      }
      if (!aceite) throw new Error('É necessário aceitar os Termos de Uso e a Política de Privacidade.');
      const { data: signUpData, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.senha,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            nome: form.nome, telefone: form.telefone.replace(/\D/g, ''), endereco: form.endereco, role: 'explorador',
            lgpd_aceito: true, lgpd_data: new Date().toISOString(),
            ref_codigo: refCodigo || undefined,
          },
        },
      });
      if (error) throw error;
      // Com "Confirm email" ligado, o Supabase NÃO retorna erro para um e-mail JÁ cadastrado
      // (proteção anti-enumeração): devolve user com identities: [] e não envia e-mail. Sem este
      // guard, o usuário via "Cadastro realizado! Verifique seu email" e esperava um e-mail que
      // nunca chega. Detecta e trata como duplicata (mesma intenção do onBlur checarEmail).
      if (signUpData?.user && Array.isArray(signUpData.user.identities) && signUpData.user.identities.length === 0) {
        setEmailDuplicado(true);
        throw new Error('Este e-mail já está cadastrado. Faça login ou recupere a senha.');
      }
      trackCadastro(form.email, form.nome);
      // Preserva o plano na URL de confirmação de email (HashRouter usa /#/)
      if (planoEscolhido) {
        salvarConvite(CHAVE_PLANO, planoEscolhido);
      }
      // Preserva a intenção de PRODUTO (ebook/curso) → após confirmar o e-mail e entrar,
      // o usuário volta à página do produto para comprar, em vez de cair na Home.
      const destProdCad = destinoProduto(produtoParam);
      if (destProdCad) sessionStorage.setItem('tsn_redirect_produto', destProdCad);
      setModo('sucesso');
    } catch (err) {
      // Falha de CADASTRO (validação local, e-mail duplicado ou erro do Auth) deixa rastro no
      // funil público — é exatamente o que se perde quando "mandei links e ninguém cadastrou".
      registrarEvento('api_erro', { alvo: 'cadastro_falha', detalhe: String(err?.message || '').slice(0, 150) });
      setErro(traduzErroAuth(err.message));
    }
    setLoading(false);
  };

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #111111 0%, #1e3a5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>

        {/* Banner plano escolhido */}
        {planoEscolhido && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#084BA6', fontWeight: 600 }}>
            ✅ Plano <strong>{planoEscolhido === 'explorador' ? 'Explorador (Gratuito)' : pNome(planoEscolhido)}</strong> selecionado — crie sua conta para continuar
          </div>
        )}
        {/* Banner convite cliente */}
        {conviteParam && !planoEscolhido && !conviteEquipeParam && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#15803d', fontWeight: 600 }}>
            🎯 Você foi convidado, crie sua conta ou entre para continuar
          </div>
        )}
        {/* Banner convite equipe */}
        {conviteEquipeParam && !planoEscolhido && (
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#5b21b6', fontWeight: 600 }}>
            🏢 Convite de equipe BidPro Brasil, entre ou crie sua conta para aceitar
          </div>
        )}

        {/* Marca BidPro Brasil (wordmark, legível no fundo claro) */}
        <button onClick={() => nav('/')}
          style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 11, width: '100%', marginBottom: 30, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <div style={{ background: '#0D63DB', borderRadius: 12, width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(13,99,219,0.30)', flexShrink: 0 }}>
            <span style={{ color: 'white', fontWeight: 900, fontSize: 24, letterSpacing: '-1px' }}>B</span>
          </div>
          <div style={{ textAlign: 'left', lineHeight: 1 }}>
            <div style={{ fontSize: 21, fontWeight: 900, letterSpacing: '-0.5px' }}>
              <span style={{ color: '#111111' }}>Bid</span><span style={{ color: '#0D63DB' }}>Pro</span><span style={{ color: '#111111' }}> Brasil</span>
            </div>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 2.5, textTransform: 'uppercase', marginTop: 4 }}>Leilão &amp; Investimentos</div>
          </div>
        </button>

        {/* Sucesso cadastro */}
        {modo === 'sucesso' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 16px' }} />
            <h2 style={{ margin: '0 0 8px', fontWeight: 900, color: '#111111' }}>Cadastro realizado!</h2>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Verifique seu email para confirmar o cadastro e depois faça login.
              {planoEscolhido && <><br /><strong style={{ color: '#084BA6' }}>Após o login você será direcionado para o pagamento do Plano {pNome(planoEscolhido)}.</strong></>}
            </p>
            <button onClick={() => setModo('login')}
              style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Ir para Login
            </button>
          </div>
        )}

        {/* Login */}
        {modo === 'login' && (
          <>
            <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#111111' }}>Entrar</h2>
            <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14 }}>Acesse sua conta BidPro Brasil</p>
            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={lbl}>Email</label>
                <input type="email" value={form.email} onChange={e => up('email', e.target.value)}
                  placeholder="seu@email.com" required style={inp} />
              </div>
              <div>
                <label style={lbl}>Senha</label>
                <div style={{ position: 'relative' }}>
                  <input type={showSenha ? 'text' : 'password'} value={form.senha} onChange={e => up('senha', e.target.value)}
                    placeholder="••••••••" required style={{ ...inp, paddingRight: 44 }} />
                  <button type="button" onClick={() => setShowSenha(p => !p)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>
                    {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div style={{ textAlign: 'right', marginTop: -8 }}>
                <button type="button" onClick={() => { setModo('recuperar'); setErro(''); }}
                  style={{ background: 'none', border: 'none', color: '#0D63DB', fontSize: 12, fontWeight: 600, cursor: 'pointer', padding: 0 }}>
                  Esqueci minha senha
                </button>
              </div>
              {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{erro}</div>}
              {emailNaoConfirmado && !reenviado && (
                <button type="button" onClick={reenviarConfirmacao} disabled={reenviando}
                  style={{ width: '100%', padding: '10px', background: '#fff7ed', color: '#9a3412', border: '1px solid #fed7aa', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {reenviando ? 'Reenviando…' : 'Reenviar e-mail de confirmação'}
                </button>
              )}
              {reenviado && (
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#15803d' }}>
                  ✅ Confirmação reenviada. Verifique sua caixa de entrada e o spam.
                </div>
              )}
              <button type="submit" disabled={loading}
                style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
                {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Entrando...</> : 'Entrar'}
              </button>
            </form>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 4px' }}>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}/>
              <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>ou continue com</span>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}/>
            </div>
            {ambienteFragilGoogle && (
              <div style={{ margin: '4px 0 10px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '9px 12px', fontSize: 11.5, color: '#9a3412', lineHeight: 1.5 }}>
                ⚠️ Neste app instalado (ou navegador de outro app) o Google pode falhar na <b>verificação em duas etapas</b>. Prefira <b>e-mail e senha</b> acima — ou abra <b>www.bidprobrasil.com.br</b> no Safari/Chrome.
              </div>
            )}
            <button type="button" onClick={handleGoogle} disabled={googleLoading}
              style={{ width: '100%', padding: '11px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', color: '#374151', fontWeight: 600, fontSize: 14, cursor: googleLoading ? 'not-allowed' : 'pointer', opacity: googleLoading ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.7 2.4 30.2 0 24 0 14.7 0 6.8 5.5 3 13.5l7.9 6.1C12.8 13.6 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/><path fill="#FBBC05" d="M10.9 28.4A14.4 14.4 0 0 1 9.5 24c0-1.5.3-3 .8-4.4L2.4 13.5A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.4 10.5l8.5-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.1 0-11.2-4.1-13.1-9.6l-7.9 6.1C6.8 42.5 14.7 48 24 48z"/></svg>
              {googleLoading ? 'Conectando…' : 'Entrar com Google'}
            </button>

            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>Não tem conta? </span>
              <button onClick={() => { setModo('cadastro'); setErro(''); }}
                style={{ background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Criar conta grátis
              </button>
            </div>
            <button onClick={() => nav('/')}
              style={{ marginTop: 12, width: '100%', background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
              Continuar sem login →
            </button>
          </>
        )}

        {/* Cadastro */}
        {modo === 'cadastro' && (
          <>
            <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#111111' }}>Criar conta</h2>
            <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14 }}>Grátis, sem cartão de crédito</p>
            <form onSubmit={handleCadastro} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Nome completo *</label>
                <input value={form.nome} onChange={e => up('nome', e.target.value)} placeholder="Seu nome" required style={inp} />
              </div>
              <div>
                <label style={lbl}>Email *</label>
                <input type="email" value={form.email}
                  onChange={e => { up('email', e.target.value); setEmailDuplicado(false); }}
                  onBlur={e => checarEmail(e.target.value)}
                  placeholder="seu@email.com" required
                  style={{ ...inp, borderColor: emailDuplicado ? '#dc2626' : undefined }} />
                {emailDuplicado && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
                    ⚠️ Este email já está cadastrado.{' '}
                    <button type="button" onClick={() => { setModo('login'); setErro(''); }}
                      style={{ background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 12, cursor: 'pointer', padding: 0 }}>
                      Fazer login →
                    </button>
                  </div>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lbl}>CPF</label>
                  <input value={form.cpf} inputMode="numeric"
                    onChange={e => { up('cpf', maskCPF(e.target.value)); setCpfCheck(null); }}
                    onBlur={e => checarCPF(e.target.value)}
                    placeholder="000.000.000-00"
                    style={{ ...inp, borderColor: cpfCheck?.temConta ? (cpfCheck.temAcesso ? '#dc2626' : '#d97706') : undefined }} />
                </div>
                <div>
                  <label style={lbl}>Telefone</label>
                  <input value={form.telefone} inputMode="numeric" onChange={e => up('telefone', maskTel(e.target.value))} placeholder="(00) 90000-0000" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Cidade * (filtra imóveis da sua região e é a base dos seus alertas)</label>
                <input value={form.endereco} onChange={e => up('endereco', e.target.value)}
                  placeholder="Comece a digitar a cidade…" style={inp} required
                  list="cidades-datalist" autoComplete="off" />
                <datalist id="cidades-datalist">
                  {sugestoesCidade.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div>
                <label style={lbl}>Senha * (mín. 8: maiúscula, minúscula, número e especial)</label>
                <div style={{ position: 'relative' }}>
                  <input type={showSenha ? 'text' : 'password'} value={form.senha} onChange={e => up('senha', e.target.value)}
                    placeholder="••••••••" required style={{ ...inp, paddingRight: 44 }} />
                  <button type="button" onClick={() => setShowSenha(p => !p)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>
                    {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12, color: '#475569', lineHeight: 1.5, cursor: 'pointer' }}>
                <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)}
                  style={{ marginTop: 2, width: 16, height: 16, flexShrink: 0, cursor: 'pointer', accentColor: '#0D63DB' }} />
                <span>
                  Li e aceito os <a href="#/termos" target="_blank" style={{ color: '#0D63DB', fontWeight: 700 }}>Termos de Uso</a> e a <a href="#/privacidade" target="_blank" style={{ color: '#0D63DB', fontWeight: 700 }}>Política de Privacidade</a>, e autorizo o tratamento dos meus dados conforme a LGPD.
                </span>
              </label>
              {/* Aviso CPF já cadastrado */}
              {cpfChecking && <div style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>Verificando CPF…</div>}

              {/* CPF com conta + produto é benefício da assinatura + já tem acesso → bloqueia */}
              {cpfCheck?.temConta && cpfCheck.temAcesso && cpfCheck.ehBeneficio && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>
                    🚫 Este conteúdo já está incluído na sua assinatura.
                  </div>
                  <div style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 12, lineHeight: 1.5 }}>
                    Você não precisa comprar novamente. Entre na sua conta para acessar.
                  </div>
                  <button type="button"
                    onClick={() => {
                      if (produtoParam) {
                        const [t, pid] = produtoParam.split(':');
                        sessionStorage.setItem('tsn_redirect_produto', `/${t === 'curso' ? 'membros/curso' : t === 'ebook' ? 'membros/ebook' : 'checkout?plano'}/${pid}`);
                      }
                      setModo('login'); setErro('');
                    }}
                    style={{ width: '100%', padding: '10px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    Entrar e acessar o conteúdo →
                  </button>
                </div>
              )}

              {/* CPF com conta + produto pago avulso + já comprou → bloqueia */}
              {cpfCheck?.temConta && cpfCheck.temAcesso && !cpfCheck.ehBeneficio && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '14px 16px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#dc2626', marginBottom: 6 }}>
                    🚫 Você já adquiriu este produto.
                  </div>
                  <div style={{ fontSize: 12, color: '#7f1d1d', marginBottom: 12, lineHeight: 1.5 }}>
                    Entre na sua conta para acessar o conteúdo.
                  </div>
                  <button type="button"
                    onClick={() => {
                      if (produtoParam) {
                        const [t, pid] = produtoParam.split(':');
                        sessionStorage.setItem('tsn_redirect_produto', `/${t === 'curso' ? 'membros/curso' : t === 'ebook' ? 'membros/ebook' : 'checkout?plano'}/${pid}`);
                      }
                      setModo('login'); setErro('');
                    }}
                    style={{ width: '100%', padding: '10px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    Entrar e acessar →
                  </button>
                </div>
              )}

              {/* CPF com conta + sem acesso ainda → pode comprar, mas sugere login */}
              {cpfCheck?.temConta && !cpfCheck.temAcesso && (
                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#92400e', marginBottom: 6 }}>
                    ⚠️ Este CPF já tem uma conta BidPro Brasil.
                  </div>
                  <div style={{ fontSize: 12, color: '#78350f', marginBottom: 10 }}>
                    {cpfCheck.ehBeneficio
                      ? 'Entre na sua conta e faça upgrade do plano para acessar este conteúdo.'
                      : (produtoParam || planoEscolhido)
                        ? 'Entre na sua conta para concluir a compra e vincular o produto ao seu acesso.'
                        : 'Se essa conta é sua, entre por ela. Para criar uma conta nova, o CPF é opcional — deixe o campo em branco para continuar.'}
                  </div>
                  <button type="button"
                    onClick={() => {
                      if (produtoParam) {
                        const [t, pid] = produtoParam.split(':');
                        sessionStorage.setItem('tsn_redirect_produto', `/${t === 'curso' ? 'membros/curso' : t === 'ebook' ? 'membros/ebook' : 'checkout?plano'}/${pid}`);
                      }
                      setModo('login'); setErro('');
                    }}
                    style={{ width: '100%', padding: '9px', background: '#d97706', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    Fazer login para continuar →
                  </button>
                </div>
              )}
              {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{erro}</div>}
              <button type="submit" disabled={loading || !aceite || emailDuplicado || ((produtoParam || planoEscolhido) && cpfCheck?.temConta)}
                style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: (loading || !aceite) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (loading || !aceite) ? 0.6 : 1 }}>
                {loading
                  ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Criando conta...</>
                  : planoEscolhido ? 'Criar conta e ir para pagamento →' : 'Criar conta grátis'
                }
              </button>
            </form>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '16px 0 4px' }}>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}/>
              <span style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'nowrap' }}>ou cadastre-se com</span>
              <div style={{ flex: 1, height: 1, background: '#e2e8f0' }}/>
            </div>
            {ambienteFragilGoogle && (
              <div style={{ margin: '4px 0 10px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: '9px 12px', fontSize: 11.5, color: '#9a3412', lineHeight: 1.5 }}>
                ⚠️ Neste app instalado (ou navegador de outro app) o Google pode falhar na <b>verificação em duas etapas</b>. Prefira o cadastro por <b>e-mail e senha</b> acima — ou abra <b>www.bidprobrasil.com.br</b> no Safari/Chrome.
              </div>
            )}
            <button type="button" onClick={handleGoogle} disabled={googleLoading}
              style={{ width: '100%', padding: '11px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', color: '#374151', fontWeight: 600, fontSize: 14, cursor: googleLoading ? 'not-allowed' : 'pointer', opacity: googleLoading ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.7 2.4 30.2 0 24 0 14.7 0 6.8 5.5 3 13.5l7.9 6.1C12.8 13.6 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/><path fill="#FBBC05" d="M10.9 28.4A14.4 14.4 0 0 1 9.5 24c0-1.5.3-3 .8-4.4L2.4 13.5A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.4 10.5l8.5-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.1 0-11.2-4.1-13.1-9.6l-7.9 6.1C6.8 42.5 14.7 48 24 48z"/></svg>
              {googleLoading ? 'Conectando…' : 'Cadastrar com Google'}
            </button>
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>Já tem conta? </span>
              <button onClick={() => { setModo('login'); setErro(''); }}
                style={{ background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Fazer login
              </button>
            </div>
          </>
        )}
        {/* Recuperar senha */}
        {modo === 'recuperar' && (
          <>
            <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#111111' }}>Recuperar senha</h2>
            <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14, lineHeight: 1.6 }}>
              Informe seu email e enviaremos um link para você criar uma nova senha.
            </p>
            <form onSubmit={handleRecuperarSenha} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={lbl}>Email cadastrado</label>
                <input
                  type="email"
                  value={emailRecuperar}
                  onChange={e => setEmailRecuperar(e.target.value)}
                  placeholder="seu@email.com"
                  required
                  style={inp}
                  autoFocus
                />
              </div>
              {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{erro}</div>}
              <button type="submit" disabled={loading}
                style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
                {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Enviando...</> : 'Enviar link de recuperação'}
              </button>
            </form>
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <button onClick={() => { setModo('login'); setErro(''); }}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer' }}>
                ← Voltar para o login
              </button>
            </div>
          </>
        )}

        {/* Recuperar senha, sucesso */}
        {modo === 'recuperar_sucesso' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 16px' }} />
            <h2 style={{ margin: '0 0 8px', fontWeight: 900, color: '#111111' }}>Email enviado!</h2>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 8 }}>
              Se o email <strong>{emailRecuperar}</strong> estiver cadastrado, você receberá um link para redefinir sua senha em instantes.
            </p>
            <p style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.6, marginBottom: 24 }}>
              Verifique também a caixa de spam. O link expira em 1 hora.
            </p>
            <button onClick={() => { setModo('login'); setErro(''); setEmailRecuperar(''); }}
              style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Voltar para o login
            </button>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
