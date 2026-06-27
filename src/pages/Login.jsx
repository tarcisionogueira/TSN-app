import React, { useState, useEffect } from 'react';
import { usePlanos } from '../contexts/PlanosContext';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { trackCadastro } from '../utils/gtag';
import { Briefcase, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { buscarTodasCidades } from '../data/cidades';

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
  const [refCodigo] = useState(() => {
    const stored = sessionStorage.getItem('tsn_ref_codigo') || '';
    return refParam || stored;
  });

  const conviteEquipeParam = params.get('convite_equipe') || '';

  // Persiste o ref e convite em sessionStorage
  useEffect(() => {
    if (refParam) sessionStorage.setItem('tsn_ref_codigo', refParam);
    if (conviteParam) sessionStorage.setItem('tsn_convite_codigo', conviteParam);
    if (conviteEquipeParam) sessionStorage.setItem('tsn_convite_equipe', conviteEquipeParam);
  }, [refParam, conviteParam, conviteEquipeParam]);

  // Processa convite de equipe após autenticação
  async function processarConviteEquipe(userId) {
    const token = sessionStorage.getItem('tsn_convite_equipe');
    if (!token) return;
    try {
      const { data: convite } = await supabase
        .from('convites_equipe')
        .select('*')
        .eq('token', token)
        .eq('ativo', true)
        .single();
      if (!convite) return;
      if (convite.expira_em && new Date(convite.expira_em) < new Date()) return;
      const primaryRole = convite.roles?.[0];
      if (primaryRole) {
        await supabase.from('perfis').update({ role: primaryRole }).eq('id', userId);
      }
      await supabase.from('convites_equipe').update({ usado_em: new Date().toISOString(), usado_por: userId, ativo: false }).eq('token', token);
      sessionStorage.removeItem('tsn_convite_equipe');
    } catch (e) {
      console.error('Erro ao processar convite de equipe:', e);
    }
  }

  const produtoParam = params.get('produto') || ''; // tipo:id ex: curso:abc123
  const [modo, setModo] = useState(modoParam === 'cadastro' || planoEscolhido ? 'cadastro' : 'login'); // 'login' | 'cadastro' | 'sucesso' | 'recuperar' | 'recuperar_sucesso'
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
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
      const data = await res.json();
      setEmailDuplicado(data.temConta);
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
      const data = await res.json();
      setCpfCheck(data);
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
      setErro(err.message || 'Erro ao enviar email de recuperação.');
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

  // Autocomplete de cidade (IBGE nacional, carregado uma vez)
  const [cidadesBR, setCidadesBR] = useState([]);
  useEffect(() => { buscarTodasCidades().then(setCidadesBR).catch(() => {}); }, []);
  const sugestoesCidade = (() => {
    const q = (form.endereco || '').toLowerCase().trim();
    if (q.length < 2 || !cidadesBR.length) return [];
    return cidadesBR.filter(c => c.toLowerCase().includes(q)).slice(0, 8);
  })();

  const handleGoogle = async () => {
    if (planoEscolhido) sessionStorage.setItem('tsn_plano_pendente', planoEscolhido);
    // Salva ref antes do redirect OAuth (sessionStorage pode ser limpo em alguns browsers)
    if (refCodigo) sessionStorage.setItem('tsn_ref_codigo', refCodigo);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      // Usa apenas a origem — o Supabase redireciona para a URL configurada em
      // Authentication > URL Configuration > Site URL no painel do Supabase.
      options: { redirectTo: window.location.origin },
    });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErro(''); setLoading(true);
    try {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.senha });
      if (error) throw error;
      // Processa convite de equipe se existir
      if (signInData?.user) await processarConviteEquipe(signInData.user.id);
      // Verifica plano no sessionStorage (definido durante cadastro) ou na URL
      const produtoRedirect = sessionStorage.getItem('tsn_redirect_produto');
      sessionStorage.removeItem('tsn_redirect_produto');
      const planoPendente = planoEscolhido || sessionStorage.getItem('tsn_plano_pendente');
      sessionStorage.removeItem('tsn_plano_pendente');
      const promoPendente = promoParam || sessionStorage.getItem('tsn_promo_pendente') || '';
      sessionStorage.removeItem('tsn_promo_pendente');
      if (produtoRedirect) {
        nav(produtoRedirect);
      } else if (planoPendente) {
        nav(`/checkout?plano=${planoPendente}${promoPendente ? `&promo=${promoPendente}` : ''}`);
      } else if (nextParam) {
        // nextParam já vem decodificado de URLSearchParams — não decodificar de novo
        nav(nextParam);
      } else {
        nav('/');
      }
    } catch (err) {
      setErro(err.message === 'Invalid login credentials' ? 'Email ou senha incorretos.' : err.message);
    }
    setLoading(false);
  };

  const handleCadastro = async (e) => {
    e.preventDefault();
    setErro(''); setLoading(true);
    try {
      if (!form.nome || !form.email || !form.senha) throw new Error('Preencha nome, email e senha.');
      // Senha forte: 8+ com maiúscula, minúscula, número e caractere especial
      if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(form.senha)) {
        throw new Error('A senha deve ter ao menos 8 caracteres, com letra maiúscula, minúscula, número e caractere especial.');
      }
      if (!aceite) throw new Error('É necessário aceitar os Termos de Uso e a Política de Privacidade.');
      const { error } = await supabase.auth.signUp({
        email: form.email,
        password: form.senha,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: {
            nome: form.nome, cpf: form.cpf.replace(/\D/g, ''), telefone: form.telefone.replace(/\D/g, ''), endereco: form.endereco, role: 'explorador',
            lgpd_aceito: true, lgpd_data: new Date().toISOString(),
            ref_codigo: refCodigo || undefined,
          },
        },
      });
      if (error) throw error;
      trackCadastro(form.email);
      // Preserva o plano na URL de confirmação de email (HashRouter usa /#/)
      if (planoEscolhido) {
        sessionStorage.setItem('tsn_plano_pendente', planoEscolhido);
      }
      setModo('sucesso');
    } catch (err) {
      setErro(err.message);
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
            🎯 Você foi convidado — crie sua conta ou entre para continuar
          </div>
        )}
        {/* Banner convite equipe */}
        {conviteEquipeParam && !planoEscolhido && (
          <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#5b21b6', fontWeight: 600 }}>
            🏢 Convite de equipe BidPro Brasil — entre ou crie sua conta para aceitar
          </div>
        )}

        {/* Logo clicável */}
        <button onClick={() => nav(-1)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <div style={{ background: '#0D63DB', borderRadius: 10, padding: '8px 10px' }}>
            <Briefcase size={20} color="white" />
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: '#111111', letterSpacing: '-0.5px' }}>BidPro Brasil</div>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
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
            <button type="button" onClick={handleGoogle}
              style={{ width: '100%', padding: '11px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', color: '#374151', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.7 2.4 30.2 0 24 0 14.7 0 6.8 5.5 3 13.5l7.9 6.1C12.8 13.6 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/><path fill="#FBBC05" d="M10.9 28.4A14.4 14.4 0 0 1 9.5 24c0-1.5.3-3 .8-4.4L2.4 13.5A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.4 10.5l8.5-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.1 0-11.2-4.1-13.1-9.6l-7.9 6.1C6.8 42.5 14.7 48 24 48z"/></svg>
              Entrar com Google
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
            <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14 }}>Grátis — sem cartão de crédito</p>
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
                <label style={lbl}>Cidade / Endereço</label>
                <input value={form.endereco} onChange={e => up('endereco', e.target.value)}
                  placeholder="Comece a digitar a cidade…" style={inp}
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
                      : 'Entre na sua conta para concluir a compra e vincular o produto ao seu acesso.'}
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
              <button type="submit" disabled={loading || !aceite || cpfCheck?.temConta || emailDuplicado}
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
            <button type="button" onClick={handleGoogle}
              style={{ width: '100%', padding: '11px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', color: '#374151', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.2l6.8-6.8C35.7 2.4 30.2 0 24 0 14.7 0 6.8 5.5 3 13.5l7.9 6.1C12.8 13.6 17.9 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17z"/><path fill="#FBBC05" d="M10.9 28.4A14.4 14.4 0 0 1 9.5 24c0-1.5.3-3 .8-4.4L2.4 13.5A23.9 23.9 0 0 0 0 24c0 3.8.9 7.4 2.4 10.5l8.5-6.1z"/><path fill="#34A853" d="M24 48c6.2 0 11.4-2 15.2-5.5l-7.5-5.8c-2 1.4-4.6 2.2-7.7 2.2-6.1 0-11.2-4.1-13.1-9.6l-7.9 6.1C6.8 42.5 14.7 48 24 48z"/></svg>
              Cadastrar com Google
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

        {/* Recuperar senha — sucesso */}
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
