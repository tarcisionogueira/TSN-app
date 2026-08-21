import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function CancelarAlertas() {
  const loc = useLocation();
  const nav = useNavigate();
  const { user } = useAuth();
  const [status, setStatus] = useState(null); // null=loading, true=ativo, false=inativo
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('alertas_email').select('ativo').eq('user_id', user.id).single() // padrao-ok: rota acessada pelo LINK DO E-MAIL do próprio usuário; não há caminho de suporte
      .then(({ data }) => setStatus(data?.ativo !== false));
  }, [user?.id]);

  async function toggleAlerta() {
    if (!user?.id) return;
    setSalvando(true);
    const novoStatus = !status;
    await supabase.from('alertas_email').upsert({ user_id: user.id, ativo: novoStatus, filtros: {} }, { onConflict: 'user_id' }); // padrao-ok: rota do link do e-mail do próprio usuário; não há caminho de suporte
    setStatus(novoStatus);
    setSalvando(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: '48px 40px', maxWidth: 440, width: '100%', textAlign: 'center', boxShadow: '0 8px 40px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>📧</div>
        <h2 style={{ color: '#111111', fontWeight: 900, fontSize: 22, margin: '0 0 8px' }}>Alertas de oportunidades</h2>
        <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, margin: '0 0 32px' }}>
          Receba semanalmente imóveis em leilão que combinam com o seu perfil de investimento.
        </p>

        {!user ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>Faça login para gerenciar suas preferências.</p>
        ) : status === null ? (
          <p style={{ color: '#94a3b8' }}>Carregando...</p>
        ) : (
          <>
            <div style={{ padding: '16px 20px', borderRadius: 12, background: status ? '#f0fdf4' : '#fef2f2', border: `1px solid ${status ? '#86efac' : '#fca5a5'}`, marginBottom: 24, fontSize: 14, fontWeight: 600, color: status ? '#166534' : '#991b1b' }}>
              {status ? '✅ Alertas ativados' : '⏸ Alertas pausados'}
            </div>
            <button onClick={toggleAlerta} disabled={salvando}
              style={{ width: '100%', padding: '13px', background: status ? '#fef2f2' : '#0D63DB', color: status ? '#dc2626' : 'white', border: status ? '1px solid #fca5a5' : 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer', marginBottom: 16 }}>
              {salvando ? 'Salvando...' : status ? 'Pausar alertas' : 'Reativar alertas'}
            </button>
            <button onClick={() => nav('/buscar')} style={{ background: 'none', border: 'none', color: '#0D63DB', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Alterar preferências de busca →
            </button>
          </>
        )}

        <div style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid #f1f5f9' }}>
          <button onClick={() => nav('/')} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>Voltar à plataforma</button>
        </div>
      </div>
    </div>
  );
}
