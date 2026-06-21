import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';
import { BarChart2, FileText, Clock, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

const fmtBRL = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
const fmtData = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

const STATUS_LABEL = {
  analise: 'Em Análise', aprovado: 'Aprovado', arrematado: 'Arrematado',
  em_reforma: 'Em Reforma', venda: 'À Venda', alugado: 'Alugado',
  concluido: 'Concluído', reprovado: 'Reprovado',
};
const STATUS_COLOR = {
  analise: '#2563eb', aprovado: '#16a34a', arrematado: '#7c3aed',
  em_reforma: '#d97706', venda: '#0891b2', alugado: '#0891b2',
  concluido: '#15803d', reprovado: '#dc2626',
};
const STATUS_BG = {
  analise: '#eff6ff', aprovado: '#f0fdf4', arrematado: '#f5f3ff',
  em_reforma: '#fefce8', venda: '#ecfeff', alugado: '#ecfeff',
  concluido: '#f0fdf4', reprovado: '#fef2f2',
};

const ROLES_COM_COMISSAO = ['admin', 'consultor', 'analista', 'advogado'];

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
  const [mensagem, setMensagem] = useState(null);
  const [relatorios, setRelatorios] = useState([]);
  const [loadRelatorios, setLoadRelatorios] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    setLoadRelatorios(true);
    supabase.from('relatorios')
      .select('id, imovel_nome, imovel_cidade, imovel_estado, valor_minimo, desconto_percentual, status, arrematado, created_at, expira_em')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
      .then(({ data }) => { setRelatorios(data || []); setLoadRelatorios(false); })
      .catch(() => setLoadRelatorios(false));
  }, [user?.id]);

  // Comissões (apenas para papéis elegíveis)
  const temComissao = ROLES_COM_COMISSAO.includes(role);
  const [resumoComissao, setResumoComissao] = useState(null);

  useEffect(() => {
    if (!temComissao) return;
    supabase
      .from('comissoes')
      .select('valor_comissao, status')
      .eq('beneficiario_id', user.id)
      .then(({ data }) => {
        if (!data) return;
        const pendente = data.filter(c => c.status === 'pendente').reduce((a, c) => a + Number(c.valor_comissao), 0);
        const pago = data.filter(c => c.status === 'pago').reduce((a, c) => a + Number(c.valor_comissao), 0);
        setResumoComissao({ pendente, pago, total: data.length });
      });
  }, [temComissao, user.id]);

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

        {/* Minhas Análises */}
        {['top1','top2','assessorado','clube','analista','advogado','admin'].includes(role) && (
          <div style={{ background: 'white', borderRadius: 14, padding: isMobile ? '16px' : '24px', border: '1px solid #e2e8f0', marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <BarChart2 size={18} color="#2563eb" />
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>Minhas Análises</span>
              </div>
              <button onClick={() => nav('/analise')}
                style={{ padding: '6px 14px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                + Nova análise
              </button>
            </div>

            {loadRelatorios ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '20px 0' }}>Carregando…</div>
            ) : relatorios.length === 0 ? (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '28px 0' }}>
                <FileText size={32} color="#e2e8f0" style={{ marginBottom: 8 }} />
                <div>Nenhuma análise salva ainda.</div>
                <div style={{ fontSize: 12, marginTop: 4 }}>Encontre um imóvel e clique em "Solicitar Análise".</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {relatorios.map(r => {
                  const desc = r.desconto_percentual || 0;
                  const diasRestantes = r.expira_em ? Math.ceil((new Date(r.expira_em) - new Date()) / (1000*60*60*24)) : null;
                  return (
                    <div key={r.id}
                      onClick={() => nav('/analise')}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, border: '1px solid #e2e8f0', cursor: 'pointer', background: '#f8fafc', transition: 'background 0.15s' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                      onMouseLeave={e => e.currentTarget.style.background = '#f8fafc'}
                    >
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: STATUS_BG[r.status] || '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <FileText size={16} color={STATUS_COLOR[r.status] || '#64748b'} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.imovel_nome || 'Imóvel sem nome'}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          {[r.imovel_cidade, r.imovel_estado].filter(Boolean).join('/')}
                          {r.valor_minimo ? ` · ${fmtBRL(r.valor_minimo)}` : ''}
                          {desc > 0 ? ` · -${desc}%` : ''}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: STATUS_BG[r.status] || '#f1f5f9', color: STATUS_COLOR[r.status] || '#64748b' }}>
                          {STATUS_LABEL[r.status] || r.status}
                        </span>
                        {diasRestantes !== null && (
                          <span style={{ fontSize: 10, color: diasRestantes <= 7 ? '#dc2626' : '#94a3b8' }}>
                            {diasRestantes > 0 ? `Expira em ${diasRestantes}d` : 'Expirado'}
                          </span>
                        )}
                        {r.arrematado && (
                          <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700 }}>Permanente</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        )}

        {/* Card Comissões (apenas para papéis com repasse) */}
        {temComissao && (
          <div style={{ background: 'white', borderRadius: 14, padding: '16px 20px', marginBottom: 20, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, marginBottom: 12 }}>MINHAS COMISSÕES</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10, marginBottom: 14 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#d97706', fontWeight: 700 }}>A RECEBER</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
                  {resumoComissao ? Number(resumoComissao.pendente).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center', borderLeft: '1px solid #f1f5f9', borderRight: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700 }}>JÁ PAGO</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>
                  {resumoComissao ? Number(resumoComissao.pago).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—'}
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>VENDAS</div>
                <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{resumoComissao?.total ?? '—'}</div>
              </div>
            </div>
            <button onClick={() => nav('/comissoes')}
              style={{ width: '100%', padding: '9px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Ver extrato completo e solicitar saque →
            </button>
          </div>
        )}

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
