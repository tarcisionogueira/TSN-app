import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

// ─── helpers ─────────────────────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveLS(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ─── styles (inline, same palette as the app) ────────────────────────────────
const S = {
  page: {
    minHeight: '100vh',
    background: '#f1f5f9',
    fontFamily: "'Inter', sans-serif",
  },
  header: {
    background: '#0f172a',
    color: '#fff',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 56,
  },
  headerTitle: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' },
  body: { padding: '24px 20px', maxWidth: 1100, margin: '0 auto' },
  tabs: { display: 'flex', gap: 4, marginBottom: 24 },
  tab: (active) => ({
    padding: '8px 20px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
    background: active ? '#0f172a' : '#fff',
    color: active ? '#fff' : '#475569',
    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
  }),
  card: {
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  btn: (variant = 'primary') => ({
    padding: '8px 16px',
    borderRadius: 8,
    border: 'none',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
    background:
      variant === 'primary' ? '#0f172a'
      : variant === 'danger'  ? '#ef4444'
      : variant === 'outline' ? '#fff'
      : '#64748b',
    color: variant === 'outline' ? '#0f172a' : '#fff',
    border: variant === 'outline' ? '1px solid #cbd5e1' : 'none',
  }),
  input: {
    width: '100%',
    padding: '8px 12px',
    border: '1px solid #cbd5e1',
    borderRadius: 8,
    fontSize: 14,
    boxSizing: 'border-box',
    outline: 'none',
  },
  label: { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', color: '#1e293b' },
  badge: (ok) => ({
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    background: ok ? '#dcfce7' : '#fee2e2',
    color: ok ? '#166534' : '#991b1b',
  }),
  overlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.45)',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    overflowY: 'auto',
    padding: '40px 16px',
  },
  modal: {
    background: '#fff',
    borderRadius: 14,
    padding: 28,
    width: '100%',
    maxWidth: 680,
    boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
  },
  row: { display: 'flex', gap: 12, marginBottom: 14 },
  col: { flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 12 },
  subTitle: { fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 },
  accessDenied: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '60vh',
    gap: 16,
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CURSOS TAB
// ═══════════════════════════════════════════════════════════════════════════════
const CURSOS_KEY = 'tsn_admin_cursos';

function defaultCurso() {
  return {
    id: uid(),
    titulo: '',
    descricao: '',
    emoji: '📚',
    cor: '#6366f1',
    preco: '',
    nivel: 'Iniciante',
    gratuito: false,
    ativo: true,
    modulos: [],
  };
}

function defaultModulo() {
  return { id: uid(), titulo: '', aulas: [] };
}

function defaultAula() {
  return { id: uid(), titulo: '', duracao: '', url: '', descricao: '', gratis: false };
}

function CursosTab() {
  const [cursos, setCursos] = useState(() => loadLS(CURSOS_KEY, []));
  const [modal, setModal] = useState(null); // null | 'new' | 'edit'
  const [form, setForm] = useState(defaultCurso());

  function persist(next) {
    setCursos(next);
    saveLS(CURSOS_KEY, next);
  }

  function openNew() {
    setForm(defaultCurso());
    setModal('new');
  }

  function openEdit(c) {
    setForm(JSON.parse(JSON.stringify(c)));
    setModal('edit');
  }

  function deleteCurso(id) {
    if (!window.confirm('Deletar este curso?')) return;
    persist(cursos.filter((c) => c.id !== id));
  }

  function toggleAtivo(id) {
    persist(cursos.map((c) => (c.id === id ? { ...c, ativo: !c.ativo } : c)));
  }

  function saveForm() {
    if (!form.titulo.trim()) return alert('Informe o título do curso.');
    if (modal === 'new') {
      persist([...cursos, form]);
    } else {
      persist(cursos.map((c) => (c.id === form.id ? form : c)));
    }
    setModal(null);
  }

  // modulo helpers
  function addModulo() {
    setForm((f) => ({ ...f, modulos: [...f.modulos, defaultModulo()] }));
  }

  function updateModulo(mid, field, value) {
    setForm((f) => ({
      ...f,
      modulos: f.modulos.map((m) => (m.id === mid ? { ...m, [field]: value } : m)),
    }));
  }

  function removeModulo(mid) {
    setForm((f) => ({ ...f, modulos: f.modulos.filter((m) => m.id !== mid) }));
  }

  // aula helpers
  function addAula(mid) {
    setForm((f) => ({
      ...f,
      modulos: f.modulos.map((m) =>
        m.id === mid ? { ...m, aulas: [...m.aulas, defaultAula()] } : m
      ),
    }));
  }

  function updateAula(mid, aid, field, value) {
    setForm((f) => ({
      ...f,
      modulos: f.modulos.map((m) =>
        m.id !== mid
          ? m
          : { ...m, aulas: m.aulas.map((a) => (a.id === aid ? { ...a, [field]: value } : a)) }
      ),
    }));
  }

  function removeAula(mid, aid) {
    setForm((f) => ({
      ...f,
      modulos: f.modulos.map((m) =>
        m.id !== mid ? m : { ...m, aulas: m.aulas.filter((a) => a.id !== aid) }
      ),
    }));
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Cursos</h2>
        <button style={S.btn('primary')} onClick={openNew}>+ Novo Curso</button>
      </div>

      <div style={S.card}>
        {cursos.length === 0 ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Nenhum curso cadastrado ainda.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Curso</th>
                  <th style={S.th}>Preço</th>
                  <th style={S.th}>Módulos</th>
                  <th style={S.th}>Nível</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {cursos.map((c) => (
                  <tr key={c.id}>
                    <td style={S.td}>
                      <span style={{ marginRight: 6 }}>{c.emoji}</span>
                      <strong>{c.titulo}</strong>
                    </td>
                    <td style={S.td}>{c.gratuito ? 'Grátis' : `R$ ${c.preco}`}</td>
                    <td style={S.td}>{c.modulos.length}</td>
                    <td style={S.td}>{c.nivel}</td>
                    <td style={S.td}>
                      <span style={S.badge(c.ativo)}>{c.ativo ? 'Ativo' : 'Inativo'}</span>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={S.btn('outline')} onClick={() => openEdit(c)}>Editar</button>
                        <button style={S.btn('outline')} onClick={() => toggleAtivo(c.id)}>
                          {c.ativo ? 'Desativar' : 'Ativar'}
                        </button>
                        <button style={S.btn('danger')} onClick={() => deleteCurso(c.id)}>Deletar</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* MODAL */}
      {modal && (
        <div style={S.overlay} onClick={(e) => e.target === e.currentTarget && setModal(null)}>
          <div style={S.modal}>
            <h3 style={{ ...S.sectionTitle, marginBottom: 20 }}>
              {modal === 'new' ? 'Novo Curso' : 'Editar Curso'}
            </h3>

            {/* linha 1 */}
            <div style={S.row}>
              <div style={{ ...S.col, flex: 3 }}>
                <label style={S.label}>Título *</label>
                <input style={S.input} value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
              </div>
              <div style={{ ...S.col, flex: 1 }}>
                <label style={S.label}>Emoji</label>
                <input style={S.input} value={form.emoji} onChange={(e) => setForm({ ...form, emoji: e.target.value })} />
              </div>
              <div style={{ ...S.col, flex: 1 }}>
                <label style={S.label}>Cor</label>
                <input type="color" style={{ ...S.input, padding: 4, height: 38 }} value={form.cor} onChange={(e) => setForm({ ...form, cor: e.target.value })} />
              </div>
            </div>

            {/* descrição */}
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Descrição</label>
              <textarea style={{ ...S.input, height: 72, resize: 'vertical' }} value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
            </div>

            {/* linha 3 */}
            <div style={S.row}>
              <div style={S.col}>
                <label style={S.label}>Nível</label>
                <select style={S.input} value={form.nivel} onChange={(e) => setForm({ ...form, nivel: e.target.value })}>
                  <option>Iniciante</option>
                  <option>Intermediário</option>
                  <option>Avançado</option>
                </select>
              </div>
              <div style={S.col}>
                <label style={S.label}>Preço (R$)</label>
                <input style={S.input} value={form.preco} disabled={form.gratuito} onChange={(e) => setForm({ ...form, preco: e.target.value })} placeholder="0,00" />
              </div>
              <div style={{ ...S.col, display: 'flex', alignItems: 'center', gap: 8, paddingTop: 20 }}>
                <input type="checkbox" id="gratuito" checked={form.gratuito} onChange={(e) => setForm({ ...form, gratuito: e.target.checked })} />
                <label htmlFor="gratuito" style={{ fontSize: 14, fontWeight: 600, color: '#374151' }}>Gratuito</label>
              </div>
            </div>

            {/* MÓDULOS */}
            <div style={{ marginTop: 20, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={S.subTitle}>Módulos</p>
                <button style={S.btn('outline')} onClick={addModulo}>+ Módulo</button>
              </div>

              {form.modulos.map((m, mi) => (
                <div key={m.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input
                      style={{ ...S.input, flex: 1 }}
                      placeholder={`Módulo ${mi + 1} — título`}
                      value={m.titulo}
                      onChange={(e) => updateModulo(m.id, 'titulo', e.target.value)}
                    />
                    <button style={S.btn('danger')} onClick={() => removeModulo(m.id)}>✕</button>
                  </div>

                  {/* AULAS */}
                  {m.aulas.map((a, ai) => (
                    <div key={a.id} style={{ background: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input
                          style={{ ...S.input, flex: 2 }}
                          placeholder="Título da aula"
                          value={a.titulo}
                          onChange={(e) => updateAula(m.id, a.id, 'titulo', e.target.value)}
                        />
                        <input
                          style={{ ...S.input, flex: 1 }}
                          placeholder="Duração (ex: 8:30)"
                          value={a.duracao}
                          onChange={(e) => updateAula(m.id, a.id, 'duracao', e.target.value)}
                        />
                        <button style={{ ...S.btn('danger'), padding: '6px 10px' }} onClick={() => removeAula(m.id, a.id)}>✕</button>
                      </div>
                      <input
                        style={{ ...S.input, marginBottom: 6 }}
                        placeholder="URL do YouTube"
                        value={a.url}
                        onChange={(e) => updateAula(m.id, a.id, 'url', e.target.value)}
                      />
                      <input
                        style={{ ...S.input, marginBottom: 6 }}
                        placeholder="Descrição da aula"
                        value={a.descricao}
                        onChange={(e) => updateAula(m.id, a.id, 'descricao', e.target.value)}
                      />
                      <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: '#475569' }}>
                        <input type="checkbox" checked={a.gratis} onChange={(e) => updateAula(m.id, a.id, 'gratis', e.target.checked)} />
                        Aula gratuita (preview)
                      </label>
                    </div>
                  ))}

                  <button style={{ ...S.btn('outline'), marginTop: 4, fontSize: 12 }} onClick={() => addAula(m.id)}>
                    + Aula
                  </button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button style={S.btn('outline')} onClick={() => setModal(null)}>Cancelar</button>
              <button style={S.btn('primary')} onClick={saveForm}>Salvar Curso</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// AFILIADOS TAB
// ═══════════════════════════════════════════════════════════════════════════════
const AFIL_KEY = 'tsn_admin_afiliados';
const BASE_URL = 'https://tsn-app-two.vercel.app/#/';

function gerarCodigo(nome) {
  const base = nome.trim().toLowerCase().replace(/\s+/g, '').slice(0, 6);
  return base + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function AfiliadosTab() {
  const [afiliados, setAfiliados] = useState(() => loadLS(AFIL_KEY, []));
  const [form, setForm] = useState({ nome: '', email: '', comissao: 20 });
  const [copied, setCopied] = useState(null);

  function persist(next) {
    setAfiliados(next);
    saveLS(AFIL_KEY, next);
  }

  function addAfiliado() {
    if (!form.nome.trim() || !form.email.trim()) return alert('Preencha nome e email.');
    const codigo = gerarCodigo(form.nome);
    persist([
      ...afiliados,
      { id: uid(), nome: form.nome, email: form.email, comissao: Number(form.comissao), codigo },
    ]);
    setForm({ nome: '', email: '', comissao: 20 });
  }

  function removeAfiliado(id) {
    if (!window.confirm('Remover afiliado?')) return;
    persist(afiliados.filter((a) => a.id !== id));
  }

  function copyLink(codigo) {
    const link = `${BASE_URL}?ref=${codigo}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(codigo);
      setTimeout(() => setCopied(null), 2000);
    });
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Afiliados</h2>

      {/* Form novo afiliado */}
      <div style={S.card}>
        <p style={S.subTitle}>Cadastrar novo afiliado</p>
        <div style={S.row}>
          <div style={S.col}>
            <label style={S.label}>Nome</label>
            <input style={S.input} value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome completo" />
          </div>
          <div style={S.col}>
            <label style={S.label}>Email</label>
            <input style={S.input} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@exemplo.com" />
          </div>
          <div style={{ ...S.col, maxWidth: 140 }}>
            <label style={S.label}>Comissão (%)</label>
            <input
              style={S.input}
              type="number"
              min={0}
              max={100}
              value={form.comissao}
              onChange={(e) => setForm({ ...form, comissao: e.target.value })}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button style={S.btn('primary')} onClick={addAfiliado}>Cadastrar</button>
          </div>
        </div>
      </div>

      {/* Lista */}
      <div style={S.card}>
        {afiliados.length === 0 ? (
          <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Nenhum afiliado cadastrado ainda.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Nome</th>
                  <th style={S.th}>Email</th>
                  <th style={S.th}>Código</th>
                  <th style={S.th}>Comissão</th>
                  <th style={S.th}>Link</th>
                  <th style={S.th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {afiliados.map((a) => (
                  <tr key={a.id}>
                    <td style={S.td}><strong>{a.nome}</strong></td>
                    <td style={S.td}>{a.email}</td>
                    <td style={S.td}>
                      <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{a.codigo}</code>
                    </td>
                    <td style={S.td}>{a.comissao}%</td>
                    <td style={S.td}>
                      <span style={{ fontSize: 12, color: '#64748b', wordBreak: 'break-all' }}>
                        {BASE_URL}?ref={a.codigo}
                      </span>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={S.btn('outline')} onClick={() => copyLink(a.codigo)}>
                          {copied === a.codigo ? 'Copiado!' : 'Copiar link'}
                        </button>
                        <button style={S.btn('danger')} onClick={() => removeAfiliado(a.id)}>Remover</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USUÁRIOS TAB
// ═══════════════════════════════════════════════════════════════════════════════
const MOCK_USERS = [
  { id: '1', nome: 'Ana Souza', email: 'ana@email.com', plano: 'analista', cadastro: '2025-03-10' },
  { id: '2', nome: 'Bruno Mendes', email: 'bruno@email.com', plano: 'gestor', cadastro: '2025-04-22' },
  { id: '3', nome: 'Carla Lima', email: 'carla@email.com', plano: 'gratuito', cadastro: '2025-05-01' },
  { id: '4', nome: 'Diego Costa', email: 'diego@email.com', plano: 'analista', cadastro: '2025-06-05' },
];

const PLANO_LABELS = {
  gratuito: 'Gratuito',
  analista: 'Analista',
  gestor: 'Gestor',
};

function UsuariosTab() {
  const [users, setUsers] = useState(MOCK_USERS);
  const [editingId, setEditingId] = useState(null);
  const [newPlano, setNewPlano] = useState('');

  function startEdit(u) {
    setEditingId(u.id);
    setNewPlano(u.plano);
  }

  function savePlano(id) {
    setUsers(users.map((u) => (u.id === id ? { ...u, plano: newPlano } : u)));
    setEditingId(null);
  }

  const badgeColor = (plano) =>
    plano === 'gestor'   ? { background: '#dbeafe', color: '#1e40af' }
    : plano === 'analista' ? { background: '#fef9c3', color: '#854d0e' }
    : { background: '#f1f5f9', color: '#475569' };

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Usuários</h2>

      <div style={S.card}>
        <div style={{ overflowX: 'auto' }}>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Nome</th>
                <th style={S.th}>Email</th>
                <th style={S.th}>Plano</th>
                <th style={S.th}>Cadastro</th>
                <th style={S.th}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td style={S.td}><strong>{u.nome}</strong></td>
                  <td style={S.td}>{u.email}</td>
                  <td style={S.td}>
                    <span style={{ ...badgeColor(u.plano), display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600 }}>
                      {PLANO_LABELS[u.plano] || u.plano}
                    </span>
                  </td>
                  <td style={S.td}>{u.cadastro}</td>
                  <td style={S.td}>
                    {editingId === u.id ? (
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select style={{ ...S.input, width: 'auto' }} value={newPlano} onChange={(e) => setNewPlano(e.target.value)}>
                          <option value="gratuito">Gratuito</option>
                          <option value="analista">Analista</option>
                          <option value="gestor">Gestor</option>
                        </select>
                        <button style={S.btn('primary')} onClick={() => savePlano(u.id)}>Salvar</button>
                        <button style={S.btn('outline')} onClick={() => setEditingId(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <button style={S.btn('outline')} onClick={() => startEdit(u)}>Atualizar Plano</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
const TABS = ['Cursos', 'Afiliados', 'Usuários'];

export default function Admin() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('Cursos');

  if (loading) {
    return (
      <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#64748b' }}>Carregando...</p>
      </div>
    );
  }

  if (role !== 'admin') {
    return (
      <div style={S.page}>
        <div style={S.accessDenied}>
          <p style={{ fontSize: 48 }}>🔒</p>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a' }}>Acesso restrito</h2>
          <p style={{ color: '#64748b' }}>Você não tem permissão para acessar esta área.</p>
          <button style={S.btn('primary')} onClick={() => navigate('/')}>Voltar ao início</button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      {/* header */}
      <div style={S.header}>
        <span style={S.headerTitle}>TSN — Painel Administrativo</span>
        <button style={{ ...S.btn('outline'), background: 'transparent', color: '#94a3b8', border: '1px solid #334155', fontSize: 13 }} onClick={() => navigate('/')}>
          ← Voltar ao app
        </button>
      </div>

      {/* body */}
      <div style={S.body}>
        {/* tabs */}
        <div style={S.tabs}>
          {TABS.map((t) => (
            <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {tab === 'Cursos'    && <CursosTab />}
        {tab === 'Afiliados' && <AfiliadosTab />}
        {tab === 'Usuários'  && <UsuariosTab />}
      </div>
    </div>
  );
}
