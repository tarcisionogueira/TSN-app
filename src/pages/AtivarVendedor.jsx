import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

// Página que ATIVA a capacidade de vender na conta que a pessoa já tem (mantém o
// plano/função). O admin envia /#/ativar-vendedor/:token para cliente ou equipe.
export default function AtivarVendedor() {
  const { token } = useParams();
  const nav = useNavigate();
  const { user, loading } = useAuth();
  const [estado, setEstado] = useState('idle'); // idle | ativando | ok | erro
  const [msg, setMsg] = useState('');
  const [tipo, setTipo] = useState('');

  const ativar = async () => {
    setEstado('ativando'); setMsg('');
    try {
      const sess = (await supabase.auth.getSession()).data.session;
      const r = await fetch('/api/ativar-vendedor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess?.access_token}` },
        body: JSON.stringify({ token }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Não foi possível ativar.');
      setTipo(data.tipo); setEstado('ok');
    } catch (e) { setMsg(e.message); setEstado('erro'); }
  };

  const box = (children) => (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 18, maxWidth: 460, padding: '34px 28px', textAlign: 'center', border: '1px solid #e2e8f0', boxShadow: '0 8px 30px rgba(0,0,0,0.06)' }}>{children}</div>
    </div>
  );

  if (loading) return box(<div style={{ color: '#94a3b8' }}>Carregando…</div>);

  if (!user) return box(<>
    <AlertCircle size={44} color="#d97706" style={{ margin: '0 auto 12px' }} />
    <h2 style={{ color: '#111', margin: '0 0 8px' }}>Entre na sua conta</h2>
    <p style={{ color: '#64748b', marginBottom: 20 }}>Faça login (ou crie sua conta) e abra este link de novo para ativar a opção de vender.</p>
    <button onClick={() => nav(`/login?next=${encodeURIComponent('/ativar-vendedor/' + token)}`)} style={{ padding: '12px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, cursor: 'pointer' }}>Entrar</button>
  </>);

  if (estado === 'ok') return box(<>
    <CheckCircle2 size={48} color="#10b981" style={{ margin: '0 auto 12px' }} />
    <h2 style={{ color: '#111', margin: '0 0 8px' }}>Venda ativada! 🎉</h2>
    <p style={{ color: '#64748b', marginBottom: 20 }}>Você agora é {tipo === 'consultor' ? 'consultor' : 'afiliado'} e mantém tudo o que já tinha. Pegue seus links no painel e comece a divulgar.</p>
    <button onClick={() => nav(tipo === 'consultor' ? '/consultor' : '/afiliado')} style={{ padding: '12px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, cursor: 'pointer' }}>Abrir meu painel</button>
  </>);

  if (estado === 'erro') return box(<>
    <AlertCircle size={44} color="#dc2626" style={{ margin: '0 auto 12px' }} />
    <h2 style={{ color: '#111', margin: '0 0 8px' }}>Não deu para ativar</h2>
    <p style={{ color: '#64748b', marginBottom: 20 }}>{msg}</p>
    <button onClick={() => setEstado('idle')} style={{ padding: '12px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 12, fontWeight: 700, cursor: 'pointer' }}>Tentar de novo</button>
  </>);

  return box(<>
    <div style={{ fontSize: 46, marginBottom: 8 }}>📣</div>
    <h2 style={{ color: '#111', margin: '0 0 8px' }}>Ativar a opção de vender</h2>
    <p style={{ color: '#64748b', marginBottom: 22 }}>Você vai passar a divulgar os links da BidPro e ganhar comissão sobre as vendas que vierem por eles. Mantém tudo o que já tem na sua conta.</p>
    <button onClick={ativar} disabled={estado === 'ativando'} style={{ padding: '13px 26px', background: '#db2777', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      {estado === 'ativando' ? <><Loader2 size={16} className="spin" /> Ativando…</> : 'Ativar agora'}
    </button>
  </>);
}
