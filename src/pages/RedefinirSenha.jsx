import React, { useState, useEffect } from 'react';
import { senhaForte } from '../lib/senha.js';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { Briefcase, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import LogoB from '../components/LogoB';

const inp = {
  width: '100%', padding: '11px 14px', border: '1px solid #e2e8f0', borderRadius: 10,
  fontSize: 14, background: 'white', color: '#111111', boxSizing: 'border-box',
};
const lbl = { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 };

export default function RedefinirSenha() {
  const nav = useNavigate();
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState(false);
  const [sessaoValida, setSessaoValida] = useState(null); // null=verificando, true, false

  useEffect(() => {
    // Supabase injeta a sessão automaticamente via hash fragment quando o usuário clica no link
    supabase.auth.getSession().then(({ data }) => {
      setSessaoValida(!!data?.session);
    });

    // Ouve o evento PASSWORD_RECOVERY para quando o Supabase processa o hash
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setSessaoValida(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleRedefinir = async (e) => {
    e.preventDefault();
    setErro('');
    if (!senhaForte(senha)) {
      setErro('A senha deve ter ao menos 8 caracteres, com maiúscula, minúscula, número e caractere especial.');
      return;
    }
    if (senha !== confirmar) { setErro('As senhas não coincidem.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: senha });
      if (error) throw error;
      setSucesso(true);
      await supabase.auth.signOut();
      // Redireciona para o login automaticamente após redefinir a senha
      setTimeout(() => nav('/login'), 2500);
    } catch (err) {
      const m = err.message || '';
      setErro(/new password should be different/i.test(m)
        ? 'A nova senha deve ser diferente da anterior.'
        : (m || 'Erro ao redefinir senha.'));
    }
    setLoading(false);
  };

  const senhaOk = senhaForte(senha);

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #111111 0%, #1e3a5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 420, boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>

        {/* Logo clicável */}
        <button onClick={() => nav('/login')}
          style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <div style={{ background: '#0D63DB', borderRadius: 10, padding: '8px 10px' }}>
            <LogoB size={20} />
          </div>
          <div style={{ textAlign: 'left' }}>
            <div style={{ fontWeight: 900, fontSize: 16, color: '#111111', letterSpacing: '-0.5px' }}>BidPro Brasil</div>
            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
          </div>
        </button>

        {/* Verificando sessão */}
        {sessaoValida === null && (
          <div style={{ textAlign: 'center', padding: '20px 0', color: '#64748b' }}>
            <Loader2 size={32} style={{ animation: 'spin 1s linear infinite', margin: '0 auto 12px', display: 'block' }} />
            Verificando link...
          </div>
        )}

        {/* Link inválido ou expirado */}
        {sessaoValida === false && (
          <div style={{ textAlign: 'center', padding: '10px 0' }}>
            <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px', display: 'block' }} />
            <h2 style={{ margin: '0 0 8px', fontWeight: 900, color: '#111111' }}>Link inválido ou expirado</h2>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              O link de recuperação expirou ou já foi utilizado. Solicite um novo link.
            </p>
            <button onClick={() => nav('/login')}
              style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Voltar para o login
            </button>
          </div>
        )}

        {/* Formulário de nova senha */}
        {sessaoValida === true && !sucesso && (
          <>
            <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#111111' }}>Nova senha</h2>
            <p style={{ margin: '0 0 24px', color: '#64748b', fontSize: 14 }}>Escolha uma senha segura para sua conta.</p>
            <form onSubmit={handleRedefinir} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <label style={lbl}>Nova senha</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showSenha ? 'text' : 'password'}
                    value={senha}
                    onChange={e => setSenha(e.target.value)}
                    placeholder="Mínimo 8 caracteres"
                    required
                    autoFocus
                    style={{ ...inp, paddingRight: 44 }}
                  />
                  <button type="button" onClick={() => setShowSenha(p => !p)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>
                    {showSenha ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>
              <div>
                <label style={lbl}>Confirmar nova senha</label>
                <input
                  type={showSenha ? 'text' : 'password'}
                  value={confirmar}
                  onChange={e => setConfirmar(e.target.value)}
                  placeholder="Repita a senha"
                  required
                  style={{ ...inp, borderColor: confirmar && confirmar !== senha ? '#dc2626' : undefined }}
                />
                {confirmar && confirmar !== senha && (
                  <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4 }}>As senhas não coincidem.</div>
                )}
              </div>
              {/* Indicador de força de senha */}
              {senha && (
                <div>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    {[1,2,3,4].map(n => (
                      <div key={n} style={{
                        flex: 1, height: 4, borderRadius: 2,
                        background: senha.length >= n * 3
                          ? (senha.length >= 12 ? '#10b981' : senha.length >= 9 ? '#f59e0b' : '#ef4444')
                          : '#e2e8f0',
                      }} />
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {senha.length < 8 ? 'Muito curta' : !senhaOk ? 'Falta maiúscula, número ou símbolo' : 'Forte'}
                  </div>
                </div>
              )}
              {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#dc2626' }}>{erro}</div>}
              <button type="submit" disabled={loading || senha !== confirmar || !senhaOk}
                style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (loading || senha !== confirmar || !senhaOk) ? 0.6 : 1 }}>
                {loading ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Salvando...</> : 'Salvar nova senha'}
              </button>
            </form>
          </>
        )}

        {/* Sucesso */}
        {sucesso && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 16px', display: 'block' }} />
            <h2 style={{ margin: '0 0 8px', fontWeight: 900, color: '#111111' }}>Senha redefinida!</h2>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>
              Sua senha foi alterada com sucesso. Redirecionando para o login…
            </p>
            <button onClick={() => nav('/login')}
              style={{ width: '100%', padding: '12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Ir para o login
            </button>
          </div>
        )}

        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
