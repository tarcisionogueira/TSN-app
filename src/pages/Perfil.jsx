import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';

const ROLE_LABELS = {
  admin: 'Administrador',
  analista: 'Analista',
  consultor: 'Consultor',
  advogado: 'Advogado',
  explorador: 'Explorador',
  top1: 'Top 1',
  top2: 'Top 2',
  assessorado: 'Assessorado',
  clube: 'Clube',
};

const ROLE_COLORS = {
  admin: '#7c3aed',
  analista: '#0284c7',
  consultor: '#0891b2',
  advogado: '#7c3aed',
  explorador: '#64748b',
  top1: '#d97706',
  top2: '#d97706',
  assessorado: '#16a34a',
  clube: '#dc2626',
};

export default function Perfil() {
  const { user, role } = useAuth();
  const isMobile = useIsMobile();
  const nav = useNavigate();

  const [nome, setNome] = useState(user?.user_metadata?.nome || '');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState(null); // { tipo: 'sucesso'|'erro', texto }

  async function salvar(e) {
    e.preventDefault();
    setMensagem(null);

    if (novaSenha && novaSenha !== confirmarSenha) {
      setMensagem({ tipo: 'erro', texto: 'As senhas não coincidem.' });
      return;
    }
    if (novaSenha && novaSenha.length < 6) {
      setMensagem({ tipo: 'erro', texto: 'A senha deve ter pelo menos 6 caracteres.' });
      return;
    }

    setSalvando(true);
    try {
      const updates = { data: { nome } };
      if (novaSenha) updates.password = novaSenha;

      const { error } = await supabase.auth.updateUser(updates);
      if (error) throw error;

      setNovaSenha('');
      setConfirmarSenha('');
      setMensagem({ tipo: 'sucesso', texto: 'Perfil atualizado com sucesso!' });
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: err.message || 'Erro ao salvar alterações.' });
    } finally {
      setSalvando(false);
    }
  }

  const roleLabel = ROLE_LABELS[role] || role || 'Explorador';
  const roleColor = ROLE_COLORS[role] || '#64748b';

  const inputStyle = {
    width: '100%',
    padding: '10px 14px',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    fontSize: 14,
    color: '#0f172a',
    background: 'white',
    outline: 'none',
    boxSizing: 'border-box',
  };

  const labelStyle = {
    display: 'block',
    fontSize: 13,
    fontWeight: 600,
    color: '#475569',
    marginBottom: 6,
  };

  const fieldStyle = {
    marginBottom: 20,
  };

  return (
    <div style={{ minHeight: '80vh', background: '#f1f5f9', padding: isMobile ? '24px 16px' : '40px 20px', fontFamily: "'Inter', sans-serif" }}>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ marginBottom: 28 }}>
          <h1 style={{ fontSize: isMobile ? 22 : 26, fontWeight: 900, color: '#0f172a', margin: 0 }}>Meu Perfil</h1>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 6 }}>Gerencie seus dados e segurança da conta</p>
        </div>

        {/* Card Plano */}
        <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>PLANO ATUAL</div>
            <span style={{
              display: 'inline-block',
              padding: '4px 12px',
              background: roleColor,
              color: 'white',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 700,
            }}>{roleLabel}</span>
          </div>
          <button
            onClick={() => nav('/planos')}
            style={{ padding: '8px 16px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Fazer upgrade
          </button>
        </div>

        {/* Formulário */}
        <div style={{ background: 'white', borderRadius: 14, padding: isMobile ? '20px 16px' : '28px 28px', border: '1px solid #e2e8f0' }}>
          <form onSubmit={salvar}>
            {/* Nome */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Nome</label>
              <input
                type="text"
                value={nome}
                onChange={e => setNome(e.target.value)}
                placeholder="Seu nome"
                style={inputStyle}
              />
            </div>

            {/* Email (somente leitura) */}
            <div style={fieldStyle}>
              <label style={labelStyle}>E-mail</label>
              <input
                type="email"
                value={user?.email || ''}
                readOnly
                style={{ ...inputStyle, background: '#f8fafc', color: '#94a3b8', cursor: 'not-allowed' }}
              />
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>O e-mail não pode ser alterado</div>
            </div>

            {/* Separador senha */}
            <div style={{ height: 1, background: '#f1f5f9', margin: '8px 0 20px' }} />
            <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 16 }}>Alterar senha (opcional)</div>

            {/* Nova senha */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Nova senha</label>
              <input
                type="password"
                value={novaSenha}
                onChange={e => setNovaSenha(e.target.value)}
                placeholder="Mínimo 6 caracteres"
                style={inputStyle}
              />
            </div>

            {/* Confirmar senha */}
            <div style={fieldStyle}>
              <label style={labelStyle}>Confirmar nova senha</label>
              <input
                type="password"
                value={confirmarSenha}
                onChange={e => setConfirmarSenha(e.target.value)}
                placeholder="Repita a nova senha"
                style={inputStyle}
              />
            </div>

            {/* Feedback */}
            {mensagem && (
              <div style={{
                padding: '10px 14px',
                borderRadius: 8,
                marginBottom: 16,
                fontSize: 13,
                fontWeight: 600,
                background: mensagem.tipo === 'sucesso' ? '#f0fdf4' : '#fef2f2',
                color: mensagem.tipo === 'sucesso' ? '#16a34a' : '#dc2626',
                border: `1px solid ${mensagem.tipo === 'sucesso' ? '#bbf7d0' : '#fecaca'}`,
              }}>
                {mensagem.tipo === 'sucesso' ? '✓ ' : '✕ '}{mensagem.texto}
              </div>
            )}

            {/* Botão salvar */}
            <button
              type="submit"
              disabled={salvando}
              style={{
                width: '100%',
                padding: '12px',
                background: salvando ? '#94a3b8' : '#0f172a',
                color: 'white',
                border: 'none',
                borderRadius: 10,
                fontSize: 15,
                fontWeight: 700,
                cursor: salvando ? 'not-allowed' : 'pointer',
              }}>
              {salvando ? 'Salvando...' : 'Salvar alterações'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
