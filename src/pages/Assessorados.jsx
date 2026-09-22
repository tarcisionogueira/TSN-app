import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';
import { Users, ArrowRight, Phone } from 'lucide-react';

// Menu "Assessorados" (22/09, pedido do dono): lista os clientes do plano assessorado e liga
// direto pros arremates/casos deles (cada caso abre /caso/:id, que já tem upload de anexo e
// monitoramento). Visível só pra admin (vê todos) e equipe (analista/advogado/consultor —
// só quem foi DESIGNADO a acompanhar, gerido aqui mesmo pelo admin).

const STATUS_LABEL = {
  arrematado: { txt: 'Arrematado', bg: '#dcfce7', fg: '#15803d' },
  em_andamento: { txt: 'Em andamento', bg: '#e0e7ff', fg: '#3730a3' },
  concluido: { txt: 'Concluído', bg: '#dcfce7', fg: '#15803d' },
  cancelado: { txt: 'Cancelado', bg: '#fee2e2', fg: '#b91c1c' },
};
const dataBR = (s) => { try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return '—'; } };

function CasoChip({ caso, onClick }) {
  const st = STATUS_LABEL[caso.status_etapa] || { txt: caso.status_etapa || '—', bg: '#f1f5f9', fg: '#475569' };
  return (
    <button onClick={onClick} style={{
      display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left',
      padding: '10px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', marginTop: 6,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {caso.imovel_endereco || 'Sem endereço registrado'}
        </div>
        {caso.arrematado_em && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Arrematado em {dataBR(caso.arrematado_em)}</div>}
      </div>
      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, background: st.bg, color: st.fg, whiteSpace: 'nowrap' }}>{st.txt}</span>
      <ArrowRight size={14} color="#94a3b8" />
    </button>
  );
}

function DesignarEquipe({ cliente, equipe, onDesignar, onRemover }) {
  const [sel, setSel] = useState('');
  const jaIds = new Set((cliente.equipe_designada || []).map((e) => e.membro_id));
  const disponiveis = (equipe || []).filter((m) => !jaIds.has(m.id));
  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f1f5f9' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Equipe designada</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {(cliente.equipe_designada || []).length === 0 && <span style={{ fontSize: 12, color: '#cbd5e1' }}>Ninguém designado ainda.</span>}
        {(cliente.equipe_designada || []).map((m) => (
          <span key={m.membro_id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, background: '#eff6ff', color: '#0D63DB', padding: '4px 10px', borderRadius: 20, fontWeight: 600 }}>
            {m.nome}
            <button onClick={() => onRemover(cliente.id, m.membro_id)} style={{ border: 'none', background: 'none', color: '#0D63DB', cursor: 'pointer', fontWeight: 900, padding: 0 }}>×</button>
          </span>
        ))}
      </div>
      {disponiveis.length > 0 && (
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ fontSize: 12, padding: '6px 8px', borderRadius: 7, border: '1px solid #e2e8f0', flex: 1 }}>
            <option value="">Designar alguém...</option>
            {disponiveis.map((m) => <option key={m.id} value={m.id}>{m.nome} ({m.role})</option>)}
          </select>
          <button disabled={!sel} onClick={() => { onDesignar(cliente.id, sel); setSel(''); }}
            style={{ fontSize: 12, padding: '6px 12px', borderRadius: 7, border: 'none', background: sel ? '#0D63DB' : '#e2e8f0', color: sel ? 'white' : '#94a3b8', fontWeight: 700, cursor: sel ? 'pointer' : 'default' }}>
            Designar
          </button>
        </div>
      )}
    </div>
  );
}

export default function Assessorados() {
  const nav = useNavigate();
  const { role } = useAuth();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');

  async function carregar() {
    setErro(null);
    try {
      const r = await apiCall('/api/admin-assessorados');
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro ao carregar');
      setDados(data);
    } catch (e) {
      setErro(e.message);
    }
  }
  useEffect(() => { carregar(); }, []);

  async function designar(cliente_id, membro_id) {
    const r = await apiCall('/api/admin-assessorados', { method: 'POST', body: JSON.stringify({ cliente_id, membro_id, acao: 'designar' }) });
    if (r.ok) carregar();
  }
  async function remover(cliente_id, membro_id) {
    const r = await apiCall('/api/admin-assessorados', { method: 'POST', body: JSON.stringify({ cliente_id, membro_id, acao: 'remover' }) });
    if (r.ok) carregar();
  }

  if (erro) return <div style={{ maxWidth: 900, margin: '40px auto', padding: 20 }}>
    <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 16, borderRadius: 10, fontSize: 14 }}>Erro: {erro}</div>
  </div>;
  if (!dados) return <div style={{ maxWidth: 900, margin: '60px auto', textAlign: 'center', color: '#94a3b8' }}>Carregando...</div>;

  const clientes = dados.clientes.filter((c) => !busca.trim() || (c.nome || '').toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Users size={22} color="#0D63DB" />
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', margin: 0 }}>Assessorados</h1>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        {role === 'admin' ? 'Todos os clientes do plano Assessoria.' : 'Clientes designados a você.'}
      </div>

      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome..."
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 14, marginBottom: 18, boxSizing: 'border-box' }} />

      {clientes.length === 0 && (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '60px 20px', fontSize: 14 }}>
          {dados.clientes.length === 0
            ? (role === 'admin' ? 'Nenhum cliente assessorado no sistema.' : 'Nenhum assessorado foi designado a você ainda — peça ao admin.')
            : 'Nenhum resultado para essa busca.'}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {clientes.map((c) => (
          <div key={c.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.nome}</div>
                {c.telefone && <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}><Phone size={11} /> {c.telefone}</div>}
              </div>
              <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>{c.casos.length} caso{c.casos.length !== 1 ? 's' : ''}</span>
            </div>

            {c.casos.length === 0
              ? <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 10 }}>Nenhum caso/arremate ainda.</div>
              : c.casos.map((caso) => <CasoChip key={caso.id} caso={caso} onClick={() => nav(`/caso/${caso.id}`)} />)}

            {dados.pode_designar && <DesignarEquipe cliente={c} equipe={dados.equipe} onDesignar={designar} onRemover={remover} />}
          </div>
        ))}
      </div>
    </div>
  );
}
