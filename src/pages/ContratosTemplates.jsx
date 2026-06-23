import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Send, Eye, ChevronLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';

const ROLES = [
  { key: 'consultor', label: 'Consultor / Afiliado', emoji: '🤝', cor: '#059669' },
  { key: 'analista',  label: 'Analista de Imóveis',  emoji: '🔍', cor: '#0D63DB' },
  { key: 'advogado',  label: 'Advogado Parceiro',    emoji: '⚖️', cor: '#7c3aed' },
];

export default function ContratosTemplates() {
  const nav = useNavigate();
  const { role } = useAuth();

  const [selecionado, setSelecionado] = useState(null);
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState('');
  const [erro, setErro] = useState('');

  if (role !== 'admin') {
    return (
      <div style={{ padding: 32, textAlign: 'center', color: '#dc2626', fontWeight: 700 }}>
        Acesso restrito a administradores.
      </div>
    );
  }

  const enviar = async () => {
    if (!selecionado) return;
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErro('Informe um e-mail válido.');
      return;
    }
    setErro('');
    setEnviando(true);
    try {
      const res = await apiCall('/api/contratos-operacional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleDestino: selecionado.key, emailDestinatario: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao enviar');
      setSucesso(`Contrato gerado! Token: ${data.token}`);
      setEmail('');
      setSelecionado(null);
    } catch (e) {
      setErro(e.message);
    }
    setEnviando(false);
  };

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '24px 16px' }}>
      <button onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', marginBottom: 20 }}>
        <ChevronLeft size={16} /> Voltar
      </button>

      <h2 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: '0 0 6px' }}>Templates de Contratos Operacionais</h2>
      <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 28px' }}>
        Envie o contrato padrão para um novo membro da equipe. O contrato inclui cláusulas de SCP, LGPD, anticorrupção e autorização Bacen.
      </p>

      {sucesso && (
        <div style={{ background: '#dcfce7', border: '1px solid #86efac', borderRadius: 10, padding: '12px 16px', color: '#15803d', fontWeight: 600, fontSize: 13, marginBottom: 20 }}>
          ✓ {sucesso}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 14, marginBottom: 28 }}>
        {ROLES.map(r => (
          <button key={r.key} onClick={() => { setSelecionado(r); setSucesso(''); setErro(''); }}
            style={{
              padding: '18px 16px', borderRadius: 14, border: `2px solid ${selecionado?.key === r.key ? r.cor : '#e2e8f0'}`,
              background: selecionado?.key === r.key ? r.cor + '10' : 'white',
              cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s'
            }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>{r.emoji}</div>
            <div style={{ fontWeight: 800, color: '#111111', fontSize: 14 }}>{r.label}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Ver template e enviar</div>
          </button>
        ))}
      </div>

      {selecionado && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 4 }}>
            {selecionado.emoji} Contrato — {selecionado.label}
          </div>
          <p style={{ fontSize: 13, color: '#475569', margin: '0 0 16px', lineHeight: 1.6 }}>
            Contrato pré-configurado com cláusulas de SCP (Arts. 991–996 CC), retenção em Mercado Pago, rendimento de CDI para a CONTRATANTE, emissão de RPA/NFS-e por saque (Arts. 158 §1° e 299 RIR/2018), autorização Bacen (Resolução BCB 80/2021), LGPD (Lei 13.709/2018) e anticorrupção (Lei 12.846/2013).
          </p>

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>
              E-mail do destinatário
            </label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="email@exemplo.com"
              style={{ width: '100%', padding: '10px 12px', border: `1.5px solid ${erro ? '#ef4444' : '#e2e8f0'}`, borderRadius: 8, fontSize: 14, color: '#111111', boxSizing: 'border-box', outline: 'none' }}
            />
            {erro && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 4, fontWeight: 600 }}>{erro}</div>}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={enviar} disabled={enviando}
              style={{ flex: 1, padding: '11px', background: enviando ? '#94a3b8' : selecionado.cor, color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: enviando ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Send size={15} /> {enviando ? 'Enviando…' : 'Gerar e Enviar Contrato'}
            </button>
          </div>

          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 12, lineHeight: 1.5 }}>
            O contrato será criado com status "Aguardando assinatura". O signatário preenche seus dados (nome, CPF, endereço) e assina digitalmente ao acessar o link.
          </p>
        </div>
      )}
    </div>
  );
}
