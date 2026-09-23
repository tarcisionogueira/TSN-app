import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';
import { Users, ChevronRight, Settings } from 'lucide-react';

// Menu "Assessorados" (22/09, pedido do dono). Três versões:
// v1: lista com nome + telefone + casos expandidos inline.
// v2: "deve aparecer somente o nome... ao clicar, ir para meus arrematados e ver relatórios"
//     — lista simples, clique entrava em MODO SUPORTE (iniciarSuporte) e navegava pra
//     /arrematados.
// v3 (pedido do dono, ainda na mesma sessão, ao testar a v2 ao vivo): "indo pelo botão
//     assessorados não deve entrar em modo suporte mas sim ir diretamente aos imoveis
//     arrematados... sem ser pelo modo suporte pois ha funções como incluir os documentos
//     pessoais que so um admin ou equipe conseguem anexar." Modo suporte troca o
//     `effectiveRole` inteiro pro do CLIENTE — e com ele o menu/navegação do app viravam os
//     do assessorado, o que na prática levava a equipe pra Home em vez de ficar em
//     /arrematados (e por trocar de "identidade", ficava incoerente com anexar documento
//     como equipe). Agora navega com `?cliente_id=&nome=` — Arrematados.jsx lê os dois e
//     troca só QUAL user_id é consultado, mantendo a equipe com seu próprio papel/menu (RLS
//     já autoriza; nunca foi o impersonate que dava a permissão de leitura, ver o comentário
//     de iniciarSuporte em AuthContext). Reaproveita a tela REAL do cliente — que já tem um
// botão "Minhas análises" pros relatórios. Reaproveitada, não duplicada.
// Visível só pra admin (vê todos) e equipe (analista/advogado/consultor — só quem foi
// DESIGNADO a acompanhar); a designação em si fica atrás do ⚙, pra não poluir a lista.

// Fases da arrematação assessorada (22/09 → 23/09, pedido do dono): CONTRATADA (caso aberto,
// ainda sem arremate) · EM ANDAMENTO (arrematou, sem imissão de posse — mesma régua de
// _assessoria.js) · CONCLUÍDA (posse registrada). Mais de uma EM ANDAMENTO ao mesmo tempo
// ganha destaque laranja: pede atenção redobrada da equipe.
const FASES = [
  { k: 'contratadas', um: 'contratada', varios: 'contratadas', titulo: 'Contratadas', sub: 'aguardando arremate', cor: '#7c3aed', bg: '#f3e8ff' },
  { k: 'em_andamento', um: 'em andamento', varios: 'em andamento', titulo: 'Em andamento', sub: 'arrematado, sem imissão de posse', cor: '#0D63DB', bg: '#eff6ff' },
  { k: 'concluidas', um: 'concluída', varios: 'concluídas', titulo: 'Concluídas', sub: 'imissão de posse feita', cor: '#15803d', bg: '#f0fdf4' },
];
function BadgesFases({ c }) {
  const presentes = FASES.filter((f) => (c[f.k] || 0) > 0);
  if (!presentes.length) return <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Nenhuma arrematação registrada</span>;
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
      {presentes.map((f) => {
        const n = c[f.k];
        const alerta = f.k === 'em_andamento' && n > 1;
        return (
          <span key={f.k} style={{
            fontSize: 11.5, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            background: alerta ? '#fff7ed' : f.bg, color: alerta ? '#c2410c' : f.cor,
          }}>
            {alerta && '⚠ '}{n} {n > 1 ? f.varios : f.um}
          </span>
        );
      })}
    </span>
  );
}
function ResumoFases({ clientes }) {
  const tot = (k) => clientes.reduce((a, c) => a + (c[k] || 0), 0);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
      {FASES.map((f) => (
        <div key={f.k} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 14px' }}>
          <div style={{ fontSize: 22, fontWeight: 900, color: f.cor }}>{tot(f.k)}</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4 }}>{f.titulo}</div>
          <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{f.sub}</div>
        </div>
      ))}
    </div>
  );
}

function DesignarEquipe({ cliente, equipe, onDesignar, onRemover, onFechar }) {
  const [sel, setSel] = useState('');
  const jaIds = new Set((cliente.equipe_designada || []).map((e) => e.membro_id));
  const disponiveis = (equipe || []).filter((m) => !jaIds.has(m.id));
  return (
    <div onClick={(e) => e.stopPropagation()} style={{ padding: '12px 16px 16px', borderTop: '1px solid #f1f5f9', background: '#f8fafc' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Equipe designada a {cliente.nome}</div>
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
      <button onClick={onFechar} style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Fechar</button>
    </div>
  );
}

export default function Assessorados() {
  const nav = useNavigate();
  const { role } = useAuth();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [busca, setBusca] = useState('');
  const [designarAberto, setDesignarAberto] = useState(null);

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

  function abrirArrematados(c) {
    nav(`/arrematados?cliente_id=${c.id}&nome=${encodeURIComponent(c.nome || '')}`);
  }

  if (erro) return <div style={{ maxWidth: 700, margin: '40px auto', padding: 20 }}>
    <div style={{ background: '#fee2e2', color: '#b91c1c', padding: 16, borderRadius: 10, fontSize: 14 }}>Erro: {erro}</div>
  </div>;
  if (!dados) return <div style={{ maxWidth: 700, margin: '60px auto', textAlign: 'center', color: '#94a3b8' }}>Carregando...</div>;

  const clientes = dados.clientes.filter((c) => !busca.trim() || (c.nome || '').toLowerCase().includes(busca.trim().toLowerCase()));

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 16px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <Users size={22} color="#0D63DB" />
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#111', margin: 0 }}>Assessorados</h1>
      </div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        {role === 'admin' ? 'Todos os clientes do plano Assessoria. Clique num nome para ver os arrematados e relatórios dele.' : 'Clientes designados a você.'}
      </div>

      {dados.clientes.length > 0 && <ResumoFases clientes={dados.clientes} />}

      <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome..."
        style={{ width: '100%', padding: '10px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0', fontSize: 14, marginBottom: 18, boxSizing: 'border-box' }} />

      {clientes.length === 0 && (
        <div style={{ textAlign: 'center', color: '#94a3b8', padding: '60px 20px', fontSize: 14 }}>
          {dados.clientes.length === 0
            ? (role === 'admin' ? 'Nenhum cliente assessorado no sistema.' : 'Nenhum assessorado foi designado a você ainda — peça ao admin.')
            : 'Nenhum resultado para essa busca.'}
        </div>
      )}

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, overflow: 'hidden' }}>
        {clientes.map((c, i) => (
          <div key={c.id}>
            <div onClick={() => abrirArrematados(c)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', cursor: 'pointer',
              borderTop: i ? '1px solid #f1f5f9' : 'none',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.nome}
                </div>
                <div style={{ marginTop: 2 }}><BadgesFases c={c} /></div>
              </div>
              {dados.pode_designar && (
                <button onClick={(e) => { e.stopPropagation(); setDesignarAberto(designarAberto === c.id ? null : c.id); }}
                  title="Designar equipe" style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 4, color: '#94a3b8', display: 'flex' }}>
                  <Settings size={15} />
                </button>
              )}
              <ChevronRight size={16} color="#cbd5e1" />
            </div>
            {designarAberto === c.id && (
              <DesignarEquipe cliente={c} equipe={dados.equipe} onDesignar={designar} onRemover={remover} onFechar={() => setDesignarAberto(null)} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
