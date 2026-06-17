import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { Briefcase, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';

const inp = {
  width: '100%', padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: 10,
  fontSize: 14, background: 'white', color: '#0f172a', boxSizing: 'border-box',
};
const lbl = { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 };

export default function Login() {
  const nav = useNavigate();
  const loc = useLocation();
  const planoEscolhido = new URLSearchParams(loc.search).get('plano');
  const [modo, setModo] = useState(planoEscolhido ? 'cadastro' : 'login'); // 'login' | 'cadastro' | 'sucesso'
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [showSenha, setShowSenha] = useState(false);

  const [form, setForm] = useState({
    email: '', senha: '', nome: '', cpf: '', telefone: '', endereco: '',
  });

  const up = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const handleGoogle = async () => {
    if (planoEscolhido) sessionStorage.setItem('tsn_plano_pendente', planoEscolhido);
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/` },
    });
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setErro(''); setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.senha });
      if (error) throw error;
      // Verifica plano no sessionStorage (definido durante cadastro) ou na URL
      const planoPendente = planoEscolhido || sessionStorage.getItem('tsn_plano_pendente');
      sessionStorage.removeItem('tsn_plano_pendente');
      nav(planoPendente ? `/checkout?plano=${planoPendente}` : '/');
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
      if (form.senha.length < 6) throw new Error('Senha deve ter ao menos 6 caracteres.');
      const { error } = await supabase.auth.signUp({
        email: form.email,
        password: form.senha,
        options: {
          emailRedirectTo: `${window.location.origin}/`,
          data: { nome: form.nome, cpf: form.cpf, telefone: form.telefone, endereco: form.endereco, role: 'aluno' },
        },
      });
      if (error) throw error;
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
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>

        {/* Banner plano escolhido */}
        {planoEscolhido && (
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 14px', marginBottom: 20, fontSize: 13, color: '#1d4ed8', fontWeight: 600 }}>
            ✅ Plano <strong style={{ textTransform: 'capitalize' }}>{planoEscolhido}</strong> selecionado — crie sua conta para continuar
          </div>
        )}

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <div style={{ background: '#2563eb', borderRadius: 10, padding: '8px 10px' }}>
            <Briefcase size={20} color="white" />
          </div>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16, color: '#0f172a', letterSpacing: '-0.5px' }}>TSN ATIVOS</div>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
          </div>
        </div>

        {/* Sucesso cadastro */}
        {modo === 'sucesso' && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 16px' }} />
            <h2 style={{ margin: '0 0 8px', fontWeight: 900, color: '#0f172a' }}>Cadastro realizado!</h2>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Verifique seu email para confirmar o cadastro e depois faça login.
              {planoEscolhido && <><br /><strong style={{ color: '#1d4ed8' }}>Após o login você será direcionado para o pagamento do Plano {planoEscolhido.toUpperCase()}.</strong></>}
            </p>
            <button onClick={() => setModo('login')}
              style={{ width: '100%', padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Ir para Login
            </button>
          </div>
        )}

        {/* Login */}
        {modo === 'login' && (
          <>
            <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#0f172a' }}>Entrar</h2>
            <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14 }}>Acesse sua conta TSN Ativos</p>
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
              {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{erro}</div>}
              <button type="submit" disabled={loading}
                style={{ width: '100%', padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
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
                style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
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
            <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#0f172a' }}>Criar conta</h2>
            <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14 }}>Grátis — sem cartão de crédito</p>
            <form onSubmit={handleCadastro} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={lbl}>Nome completo *</label>
                <input value={form.nome} onChange={e => up('nome', e.target.value)} placeholder="Seu nome" required style={inp} />
              </div>
              <div>
                <label style={lbl}>Email *</label>
                <input type="email" value={form.email} onChange={e => up('email', e.target.value)} placeholder="seu@email.com" required style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label style={lbl}>CPF</label>
                  <input value={form.cpf} onChange={e => up('cpf', e.target.value)} placeholder="000.000.000-00" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Telefone</label>
                  <input value={form.telefone} onChange={e => up('telefone', e.target.value)} placeholder="(00) 90000-0000" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Endereço</label>
                <input value={form.endereco} onChange={e => up('endereco', e.target.value)} placeholder="Cidade, Estado" style={inp} />
              </div>
              <div>
                <label style={lbl}>Senha * (mínimo 6 caracteres)</label>
                <div style={{ position: 'relative' }}>
                  <input type={showSenha ? 'text' : 'password'} value={form.senha} onChange={e => up('senha', e.target.value)}
                    placeholder="••••••••" required style={{ ...inp, paddingRight: 44 }} />
                  <button type="button" onClick={() => setShowSenha(p => !p)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>
                    {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{erro}</div>}
              <button type="submit" disabled={loading}
                style={{ width: '100%', padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.7 : 1 }}>
                {loading
                  ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Criando conta...</>
                  : planoEscolhido ? 'Criar conta e ir para pagamento →' : 'Criar conta grátis'
                }
              </button>
              <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: 0, lineHeight: 1.5 }}>
                Ao criar conta você concorda com os termos de uso. Seus dados são utilizados apenas para acesso à plataforma e emissão fiscal.
              </p>
            </form>
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>Já tem conta? </span>
              <button onClick={() => { setModo('login'); setErro(''); }}
                style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                Fazer login
              </button>
            </div>
          </>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
