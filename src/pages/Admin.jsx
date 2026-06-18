import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';

export const DEFAULT_FEEDBACK_EMAIL = 'tarcisioaraujo@reimob.com.br';
const FEEDBACK_KEY = 'tsn_feedback_email';

const ROLES_DISPONIVEIS = [
  'admin','explorador','top1','top2','assessorado','clube','consultor','analista','advogado',
];

// ─── styles ──────────────────────────────────────────────────────────────────
const S = {
  page: { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif" },
  header: { background: '#0f172a', color: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 },
  headerTitle: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' },
  body: { padding: '24px 20px', maxWidth: 1100, margin: '0 auto' },
  tabs: { display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' },
  tab: (active) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: active ? '#0f172a' : '#fff', color: active ? '#fff' : '#475569', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }),
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16 },
  btn: (variant = 'primary') => ({
    padding: '8px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: variant === 'primary' ? '#0f172a' : variant === 'danger' ? '#ef4444' : variant === 'outline' ? '#fff' : '#64748b',
    color: variant === 'outline' ? '#0f172a' : '#fff',
    border: variant === 'outline' ? '1px solid #cbd5e1' : 'none',
  }),
  input: { width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  label: { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', color: '#1e293b' },
  badge: (ok) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#166534' : '#991b1b' }),
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px' },
  modal: { background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 680, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  row: { display: 'flex', gap: 12, marginBottom: 14 },
  col: { flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#0f172a', marginBottom: 12 },
  subTitle: { fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 },
  accessDenied: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CURSOS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function defaultCurso() {
  return { titulo: '', subtitulo: '', descricao: '', emoji: '📚', cor: '#2563eb', nivel: 'Iniciante', categoria: 'Fundamentos', preco: '', gratuito: false, destaque: false, comissao_pct: 30, modulos: [] };
}
function defaultModulo(idx) { return { _key: String(Date.now() + idx), titulo: '', aulas: [] }; }
function defaultAula() { return { _key: String(Date.now() + Math.random()), titulo: '', duracao: '', video_url: '', descricao: '', gratis: false }; }

function CursosTab() {
  const [cursos, setCursos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(defaultCurso());
  const [saving, setSaving] = useState(false);

  const loadCursos = useCallback(async () => {
    setLoading(true);
    const { data: cs } = await supabase.from('cursos_admin').select('*').order('ordem');
    const { data: as } = await supabase.from('aulas_admin').select('curso_id');
    const counts = {};
    (as || []).forEach(a => { counts[a.curso_id] = (counts[a.curso_id] || 0) + 1; });
    setCursos((cs || []).map(c => ({ ...c, _aulaCount: counts[c.id] || 0 })));
    setLoading(false);
  }, []);

  useEffect(() => { loadCursos(); }, [loadCursos]);

  function openNew() { setForm(defaultCurso()); setModal('new'); }

  async function openEdit(c) {
    const { data: aulas } = await supabase.from('aulas_admin').select('*').eq('curso_id', c.id).order('ordem');
    const modulosMap = {};
    (aulas || []).forEach((a, i) => {
      const mod = a.modulo || 'Módulo 1';
      if (!modulosMap[mod]) modulosMap[mod] = { _key: mod + i, titulo: mod, aulas: [] };
      modulosMap[mod].aulas.push({ _key: a.id, titulo: a.titulo || '', duracao: a.duracao || '', video_url: a.video_url || '', descricao: a.descricao || '', gratis: a.gratis || false });
    });
    setForm({ ...c, modulos: Object.values(modulosMap) });
    setModal('edit');
  }

  async function deleteCurso(id) {
    if (!window.confirm('Deletar este curso e todas as aulas?')) return;
    await supabase.from('aulas_admin').delete().eq('curso_id', id);
    await supabase.from('cursos_admin').delete().eq('id', id);
    loadCursos();
  }

  async function toggleAtivo(id, ativo) {
    await supabase.from('cursos_admin').update({ ativo: !ativo }).eq('id', id);
    loadCursos();
  }

  async function saveForm() {
    if (!form.titulo.trim()) return alert('Informe o título do curso.');
    setSaving(true);
    try {
      const { modulos, _aulaCount, ...rest } = form;
      const cursoPayload = { titulo: rest.titulo, subtitulo: rest.subtitulo || '', descricao: rest.descricao || '', emoji: rest.emoji || '📚', cor: rest.cor || '#2563eb', nivel: rest.nivel || 'Iniciante', categoria: rest.categoria || 'Fundamentos', preco: Number(rest.preco) || 0, gratuito: rest.gratuito || false, destaque: rest.destaque || false, comissao_pct: Number(rest.comissao_pct) || 30, ativo: rest.ativo !== false };

      let cursoId;
      if (modal === 'new') {
        const { data, error } = await supabase.from('cursos_admin').insert({ ...cursoPayload, ordem: 0 }).select('id').single();
        if (error) throw error;
        cursoId = data.id;
      } else {
        const { error } = await supabase.from('cursos_admin').update(cursoPayload).eq('id', rest.id);
        if (error) throw error;
        cursoId = rest.id;
      }

      await supabase.from('aulas_admin').delete().eq('curso_id', cursoId);
      const rows = [];
      (modulos || []).forEach((m, mi) => {
        (m.aulas || []).forEach((a, ai) => {
          rows.push({ curso_id: cursoId, modulo: m.titulo || `Módulo ${mi + 1}`, titulo: a.titulo || '', descricao: a.descricao || '', video_url: a.video_url || '', duracao: a.duracao || '', gratis: a.gratis || false, ordem: mi * 100 + ai });
        });
      });
      if (rows.length) {
        const { error } = await supabase.from('aulas_admin').insert(rows);
        if (error) throw error;
      }

      await loadCursos();
      setModal(null);
    } catch (e) {
      alert('Erro ao salvar: ' + e.message);
    }
    setSaving(false);
  }

  function addModulo() { setForm(f => ({ ...f, modulos: [...f.modulos, defaultModulo(f.modulos.length)] })); }
  function updateModulo(key, field, val) { setForm(f => ({ ...f, modulos: f.modulos.map(m => m._key === key ? { ...m, [field]: val } : m) })); }
  function removeModulo(key) { setForm(f => ({ ...f, modulos: f.modulos.filter(m => m._key !== key) })); }
  function addAula(mkey) { setForm(f => ({ ...f, modulos: f.modulos.map(m => m._key === mkey ? { ...m, aulas: [...m.aulas, defaultAula()] } : m) })); }
  function updateAula(mkey, akey, field, val) { setForm(f => ({ ...f, modulos: f.modulos.map(m => m._key !== mkey ? m : { ...m, aulas: m.aulas.map(a => a._key === akey ? { ...a, [field]: val } : a) }) })); }
  function removeAula(mkey, akey) { setForm(f => ({ ...f, modulos: f.modulos.map(m => m._key !== mkey ? m : { ...m, aulas: m.aulas.filter(a => a._key !== akey) }) })); }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Cursos</h2>
        <button style={S.btn('primary')} onClick={openNew}>+ Novo Curso</button>
      </div>

      <div style={S.card}>
        {loading ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Carregando...</p>
          : cursos.length === 0 ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Nenhum curso cadastrado ainda.</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Curso</th>
                  <th style={S.th}>Preço</th>
                  <th style={S.th}>Aulas</th>
                  <th style={S.th}>Nível</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Ações</th>
                </tr></thead>
                <tbody>
                  {cursos.map(c => (
                    <tr key={c.id}>
                      <td style={S.td}><span style={{ marginRight: 6 }}>{c.emoji}</span><strong>{c.titulo}</strong></td>
                      <td style={S.td}>{c.gratuito ? 'Grátis' : `R$ ${c.preco}`}</td>
                      <td style={S.td}>{c._aulaCount}</td>
                      <td style={S.td}>{c.nivel}</td>
                      <td style={S.td}><span style={S.badge(c.ativo)}>{c.ativo ? 'Ativo' : 'Inativo'}</span></td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={S.btn('outline')} onClick={() => openEdit(c)}>Editar</button>
                          <button style={S.btn('outline')} onClick={() => toggleAtivo(c.id, c.ativo)}>{c.ativo ? 'Desativar' : 'Ativar'}</button>
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

      {modal && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={S.modal}>
            <h3 style={{ ...S.sectionTitle, marginBottom: 20 }}>{modal === 'new' ? 'Novo Curso' : 'Editar Curso'}</h3>

            <div style={S.row}>
              <div style={{ ...S.col, flex: 3 }}>
                <label style={S.label}>Título *</label>
                <input style={S.input} value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} />
              </div>
              <div style={{ ...S.col, flex: 1 }}>
                <label style={S.label}>Emoji</label>
                <input style={S.input} value={form.emoji} onChange={e => setForm({ ...form, emoji: e.target.value })} />
              </div>
              <div style={{ ...S.col, flex: 1 }}>
                <label style={S.label}>Cor</label>
                <input type="color" style={{ ...S.input, padding: 4, height: 38 }} value={form.cor} onChange={e => setForm({ ...form, cor: e.target.value })} />
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Subtítulo</label>
              <input style={S.input} value={form.subtitulo || ''} onChange={e => setForm({ ...form, subtitulo: e.target.value })} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Descrição</label>
              <textarea style={{ ...S.input, height: 72, resize: 'vertical' }} value={form.descricao || ''} onChange={e => setForm({ ...form, descricao: e.target.value })} />
            </div>

            <div style={S.row}>
              <div style={S.col}>
                <label style={S.label}>Nível</label>
                <select style={S.input} value={form.nivel} onChange={e => setForm({ ...form, nivel: e.target.value })}>
                  <option>Iniciante</option><option>Intermediário</option><option>Avançado</option>
                </select>
              </div>
              <div style={S.col}>
                <label style={S.label}>Categoria</label>
                <select style={S.input} value={form.categoria || 'Fundamentos'} onChange={e => setForm({ ...form, categoria: e.target.value })}>
                  {['Fundamentos','Mercado','Jurídico','Estratégia','Gestão'].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div style={S.col}>
                <label style={S.label}>Preço (R$)</label>
                <input style={S.input} value={form.preco} disabled={form.gratuito} onChange={e => setForm({ ...form, preco: e.target.value })} placeholder="0,00" />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
              <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: '#374151' }}>
                <input type="checkbox" checked={form.gratuito} onChange={e => setForm({ ...form, gratuito: e.target.checked })} /> Gratuito
              </label>
              <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: '#374151' }}>
                <input type="checkbox" checked={form.destaque || false} onChange={e => setForm({ ...form, destaque: e.target.checked })} /> Destaque
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 14, color: '#374151' }}>Comissão %</label>
                <input style={{ ...S.input, width: 70 }} type="number" value={form.comissao_pct || 30} onChange={e => setForm({ ...form, comissao_pct: e.target.value })} />
              </div>
            </div>

            <div style={{ marginTop: 20, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <p style={S.subTitle}>Módulos e Aulas</p>
                <button style={S.btn('outline')} onClick={addModulo}>+ Módulo</button>
              </div>

              {form.modulos.map((m, mi) => (
                <div key={m._key} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                    <input style={{ ...S.input, flex: 1 }} placeholder={`Módulo ${mi + 1} — título`} value={m.titulo} onChange={e => updateModulo(m._key, 'titulo', e.target.value)} />
                    <button style={S.btn('danger')} onClick={() => removeModulo(m._key)}>✕</button>
                  </div>

                  {m.aulas.map((a, ai) => (
                    <div key={a._key} style={{ background: '#f8fafc', borderRadius: 8, padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                        <input style={{ ...S.input, flex: 2 }} placeholder="Título da aula" value={a.titulo} onChange={e => updateAula(m._key, a._key, 'titulo', e.target.value)} />
                        <input style={{ ...S.input, flex: 1 }} placeholder="Duração (ex: 8:30)" value={a.duracao} onChange={e => updateAula(m._key, a._key, 'duracao', e.target.value)} />
                        <button style={{ ...S.btn('danger'), padding: '6px 10px' }} onClick={() => removeAula(m._key, a._key)}>✕</button>
                      </div>
                      <input style={{ ...S.input, marginBottom: 6 }} placeholder="URL do vídeo (YouTube, Vimeo, Panda Video, MP4...)" value={a.video_url} onChange={e => updateAula(m._key, a._key, 'video_url', e.target.value)} />
                      <input style={{ ...S.input, marginBottom: 6 }} placeholder="Descrição da aula" value={a.descricao} onChange={e => updateAula(m._key, a._key, 'descricao', e.target.value)} />
                      <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: '#475569' }}>
                        <input type="checkbox" checked={a.gratis} onChange={e => updateAula(m._key, a._key, 'gratis', e.target.checked)} /> Aula gratuita (preview)
                      </label>
                    </div>
                  ))}

                  <button style={{ ...S.btn('outline'), marginTop: 4, fontSize: 12 }} onClick={() => addAula(m._key)}>+ Aula</button>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button style={S.btn('outline')} onClick={() => setModal(null)}>Cancelar</button>
              <button style={S.btn('primary')} onClick={saveForm} disabled={saving}>
                {saving ? 'Salvando...' : 'Salvar Curso'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EBOOKS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function defaultEbook() { return { titulo: '', descricao: '', capa_url: '', arquivo_url: '', preco: '' }; }

function EbooksTab() {
  const [ebooks, setEbooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [form, setForm] = useState(defaultEbook());
  const [saving, setSaving] = useState(false);

  const loadEbooks = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('ebooks_admin').select('*').order('criado_em', { ascending: false });
    setEbooks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadEbooks(); }, [loadEbooks]);

  function openNew() { setForm(defaultEbook()); setModal('new'); }
  function openEdit(e) { setForm({ ...e }); setModal('edit'); }

  async function deleteEbook(id) {
    if (!window.confirm('Deletar este eBook?')) return;
    await supabase.from('ebooks_admin').delete().eq('id', id);
    loadEbooks();
  }

  async function toggleAtivo(id, ativo) {
    await supabase.from('ebooks_admin').update({ ativo: !ativo }).eq('id', id);
    loadEbooks();
  }

  async function saveForm() {
    if (!form.titulo.trim()) return alert('Informe o título.');
    setSaving(true);
    try {
      const payload = { titulo: form.titulo, descricao: form.descricao || '', capa_url: form.capa_url || '', arquivo_url: form.arquivo_url || '', preco: Number(form.preco) || 0, ativo: form.ativo !== false };
      if (modal === 'new') {
        const { error } = await supabase.from('ebooks_admin').insert(payload);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ebooks_admin').update(payload).eq('id', form.id);
        if (error) throw error;
      }
      await loadEbooks();
      setModal(null);
    } catch (e) {
      alert('Erro: ' + e.message);
    }
    setSaving(false);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>eBooks / Materiais</h2>
        <button style={S.btn('primary')} onClick={openNew}>+ Novo eBook</button>
      </div>

      <div style={S.card}>
        {loading ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Carregando...</p>
          : ebooks.length === 0 ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Nenhum eBook cadastrado ainda.</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Título</th>
                  <th style={S.th}>Tipo</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Ações</th>
                </tr></thead>
                <tbody>
                  {ebooks.map(e => (
                    <tr key={e.id}>
                      <td style={S.td}><strong>{e.titulo}</strong><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{e.descricao?.slice(0, 60)}</span></td>
                      <td style={S.td}>{!e.preco || Number(e.preco) === 0 ? <span style={{ ...S.badge(true), background: '#dcfce7', color: '#166534' }}>Gratuito</span> : `R$ ${e.preco}`}</td>
                      <td style={S.td}><span style={S.badge(e.ativo)}>{e.ativo ? 'Ativo' : 'Inativo'}</span></td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={S.btn('outline')} onClick={() => openEdit(e)}>Editar</button>
                          <button style={S.btn('outline')} onClick={() => toggleAtivo(e.id, e.ativo)}>{e.ativo ? 'Desativar' : 'Ativar'}</button>
                          <button style={S.btn('danger')} onClick={() => deleteEbook(e.id)}>Deletar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {modal && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={S.modal}>
            <h3 style={{ ...S.sectionTitle, marginBottom: 20 }}>{modal === 'new' ? 'Novo eBook' : 'Editar eBook'}</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Título *</label>
              <input style={S.input} value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Descrição</label>
              <textarea style={{ ...S.input, height: 72, resize: 'vertical' }} value={form.descricao || ''} onChange={e => setForm({ ...form, descricao: e.target.value })} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>URL da capa (imagem) — aparece como miniatura na Área de Membros</label>
              <input style={S.input} value={form.capa_url || ''} onChange={e => setForm({ ...form, capa_url: e.target.value })} placeholder="https://... (link da imagem da capa)" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>URL do arquivo (PDF) — abre no leitor estilo Kindle</label>
              <input style={S.input} value={form.arquivo_url || ''} onChange={e => setForm({ ...form, arquivo_url: e.target.value })} placeholder="https://... (link do PDF no Drive)" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>Preço (R$) — deixe 0 ou em branco para gratuito</label>
              <input style={S.input} type="number" min="0" step="0.01" value={form.preco ?? ''} onChange={e => setForm({ ...form, preco: e.target.value })} placeholder="0,00" />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button style={S.btn('outline')} onClick={() => setModal(null)}>Cancelar</button>
              <button style={S.btn('primary')} onClick={saveForm} disabled={saving}>{saving ? 'Salvando...' : 'Salvar eBook'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// USUÁRIOS TAB
// ═══════════════════════════════════════════════════════════════════════════════
function UsuariosTab() {
  const { iniciarSuporte } = useAuth();
  const navSup = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [newRole, setNewRole] = useState('');
  const [busca, setBusca] = useState('');

  const verComo = (u) => {
    iniciarSuporte({ id: u.id, nome: u.nome || u.email, role: u.role || 'explorador', email: u.email });
    navSup('/painel');
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('perfis').select('id, nome, email, role, plano, criado_em').order('criado_em', { ascending: false });
    setUsers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function saveRole(id) {
    await supabase.from('perfis').update({ role: newRole }).eq('id', id);
    setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
    setEditingId(null);
  }

  const filtered = users.filter(u => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (u.nome || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q) || (u.role || '').toLowerCase().includes(q);
  });

  const ROLE_COLORS = { admin: '#7c3aed', explorador: '#64748b', top1: '#2563eb', top2: '#7c3aed', assessorado: '#d97706', clube: '#059669', consultor: '#0891b2', analista: '#f59e0b', advogado: '#dc2626' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Usuários ({users.length})</h2>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome, email ou role..." style={{ ...S.input, maxWidth: 280 }} />
        <button style={S.btn('outline')} onClick={loadUsers}>↻ Atualizar</button>
      </div>

      <div style={S.card}>
        {loading ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Carregando...</p>
          : filtered.length === 0 ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Nenhum usuário encontrado.</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Nome</th>
                  <th style={S.th}>Email</th>
                  <th style={S.th}>Role</th>
                  <th style={S.th}>Plano</th>
                  <th style={S.th}>Cadastro</th>
                  <th style={S.th}>Ações</th>
                </tr></thead>
                <tbody>
                  {filtered.map(u => (
                    <tr key={u.id}>
                      <td style={S.td}><strong>{u.nome || '—'}</strong></td>
                      <td style={S.td}>{u.email}</td>
                      <td style={S.td}>
                        <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: (ROLE_COLORS[u.role] || '#64748b') + '20', color: ROLE_COLORS[u.role] || '#64748b' }}>
                          {u.role || 'explorador'}
                        </span>
                      </td>
                      <td style={S.td}>{u.plano || '—'}</td>
                      <td style={S.td}>{u.criado_em ? new Date(u.criado_em).toLocaleDateString('pt-BR') : '—'}</td>
                      <td style={S.td}>
                        {editingId === u.id ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <select style={{ ...S.input, width: 'auto', padding: '6px 8px' }} value={newRole} onChange={e => setNewRole(e.target.value)}>
                              {ROLES_DISPONIVEIS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button style={S.btn('primary')} onClick={() => saveRole(u.id)}>Salvar</button>
                            <button style={S.btn('outline')} onClick={() => setEditingId(null)}>✕</button>
                          </div>
                        ) : (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={S.btn('outline')} onClick={() => { setEditingId(u.id); setNewRole(u.role || 'explorador'); }}>Alterar role</button>
                            <button style={S.btn('outline')} onClick={() => verComo(u)} title="Entrar na conta do usuário (modo suporte)">👁 Ver como</button>
                          </div>
                        )}
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
// CONFIGURAÇÕES TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ConfigTab() {
  const [email, setEmail] = useState(() => localStorage.getItem(FEEDBACK_KEY) || DEFAULT_FEEDBACK_EMAIL);
  const [saved, setSaved] = useState(false);

  function salvar() {
    localStorage.setItem(FEEDBACK_KEY, email.trim() || DEFAULT_FEEDBACK_EMAIL);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Configurações</h2>
      <div style={S.card}>
        <p style={S.subTitle}>Email para receber feedbacks dos membros</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
          Quando um membro clica em "Feedback" no menu, um email é aberto para este endereço.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', maxWidth: 480 }}>
          <div style={{ flex: 1 }}>
            <label style={S.label}>Email de feedback</label>
            <input style={S.input} type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="email@exemplo.com" />
          </div>
          <button style={S.btn('primary')} onClick={salvar}>{saved ? '✓ Salvo!' : 'Salvar'}</button>
        </div>
        <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
          Configuração salva localmente neste navegador. Valor atual: <strong>{localStorage.getItem(FEEDBACK_KEY) || DEFAULT_FEEDBACK_EMAIL}</strong>
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN ADMIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// CONTRATOS TAB — admin gera, aprova e libera contratos para assinatura
// ═══════════════════════════════════════════════════════════════════════════════
function defaultContrato() {
  return { titulo: '', produto: 'assessoria', conteudo: '', valor: '', requer_assinatura: true, cliente_id: '' };
}

function ContratosTab() {
  const [contratos, setContratos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);   // 'new' | contrato
  const [form, setForm] = useState(defaultContrato());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: cts }, { data: cls }] = await Promise.all([
      supabase.from('contratos').select('*').order('criado_em', { ascending: false }),
      supabase.from('perfis').select('id, nome, email').order('nome'),
    ]);
    setContratos(cts || []);
    setClientes(cls || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function openNew() { setForm(defaultContrato()); setModal('new'); }
  function openEdit(c) { setForm({ ...c, valor: c.valor || '' }); setModal(c); }

  async function salvar(status) {
    if (!form.titulo || !form.cliente_id) { alert('Preencha o título e selecione o cliente.'); return; }
    setSaving(true);
    const payload = {
      titulo: form.titulo, produto: form.produto, conteudo: form.conteudo || '',
      valor: Number(form.valor) || 0, requer_assinatura: form.requer_assinatura,
      cliente_id: form.cliente_id, status,
    };
    if (modal === 'new') await supabase.from('contratos').insert(payload);
    else await supabase.from('contratos').update(payload).eq('id', form.id);
    setSaving(false);
    setModal(null);
    await load();
  }

  async function cancelar(id) {
    if (!window.confirm('Cancelar este contrato?')) return;
    await supabase.from('contratos').update({ status: 'cancelado' }).eq('id', id);
    load();
  }

  const nomeCliente = (id) => clientes.find(c => c.id === id)?.nome || clientes.find(c => c.id === id)?.email || '—';
  const ST = { rascunho: ['Rascunho', '#64748b'], aguardando_assinatura: ['Aguardando assinatura', '#d97706'], assinado: ['Assinado', '#059669'], cancelado: ['Cancelado', '#dc2626'] };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Contratos ({contratos.length})</h2>
        <button style={S.btn('primary')} onClick={openNew}>+ Novo Contrato</button>
      </div>

      <div style={S.card}>
        {loading ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Carregando...</p>
          : contratos.length === 0 ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Nenhum contrato criado ainda.</p>
          : (
            <div style={{ overflowX: 'auto' }}>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Título</th><th style={S.th}>Cliente</th><th style={S.th}>Produto</th>
                  <th style={S.th}>Valor</th><th style={S.th}>Status</th><th style={S.th}>Ações</th>
                </tr></thead>
                <tbody>
                  {contratos.map(c => {
                    const [lbl, cor] = ST[c.status] || ST.rascunho;
                    return (
                      <tr key={c.id}>
                        <td style={S.td}><strong>{c.titulo}</strong></td>
                        <td style={S.td}>{nomeCliente(c.cliente_id)}</td>
                        <td style={{ ...S.td, textTransform: 'capitalize' }}>{c.produto}</td>
                        <td style={S.td}>{c.valor > 0 ? `R$ ${Number(c.valor).toFixed(2)}` : '—'}</td>
                        <td style={S.td}><span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: cor + '20', color: cor }}>{lbl}</span></td>
                        <td style={S.td}>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button style={S.btn('outline')} onClick={() => openEdit(c)}>{c.status === 'assinado' ? 'Ver' : 'Editar'}</button>
                            {c.status !== 'assinado' && c.status !== 'cancelado' && <button style={S.btn('danger')} onClick={() => cancelar(c.id)}>Cancelar</button>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
      </div>

      {modal && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div style={{ ...S.modal, maxWidth: 560 }}>
            <h3 style={{ ...S.sectionTitle, marginBottom: 16 }}>{modal === 'new' ? 'Novo Contrato' : 'Contrato'}</h3>

            {modal !== 'new' && modal.status === 'assinado' ? (
              <div>
                <p style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>{modal.titulo}</p>
                <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, color: '#334155', background: '#f8fafc', borderRadius: 8, padding: 14, maxHeight: 260, overflowY: 'auto', marginBottom: 14 }}>{modal.conteudo}</div>
                <div style={{ padding: 14, background: '#dcfce7', borderRadius: 10 }}>
                  <strong style={{ color: '#166534', fontSize: 13 }}>✔ Assinado por {modal.assinante_nome}</strong>
                  {modal.assinatura_data && <div><img src={modal.assinatura_data} alt="assinatura" style={{ maxHeight: 80, background: 'white', borderRadius: 6, marginTop: 8, padding: 4 }} /></div>}
                  <div style={{ fontSize: 11, color: '#15803d', marginTop: 6 }}>{modal.assinado_em && new Date(modal.assinado_em).toLocaleString('pt-BR')}</div>
                  <div style={{ fontSize: 10, color: '#15803d', wordBreak: 'break-all', marginTop: 4 }}>Hash: {modal.assinatura_hash}</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                  <button style={S.btn('outline')} onClick={() => setModal(null)}>Fechar</button>
                </div>
              </div>
            ) : (
              <>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Cliente *</label>
                  <select style={S.input} value={form.cliente_id} onChange={e => setForm({ ...form, cliente_id: e.target.value })}>
                    <option value="">Selecione o cliente…</option>
                    {clientes.map(c => <option key={c.id} value={c.id}>{c.nome || c.email}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  <div style={{ flex: 2 }}>
                    <label style={S.label}>Título *</label>
                    <input style={S.input} value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} placeholder="Contrato de Assessoria…" />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={S.label}>Produto</label>
                    <select style={S.input} value={form.produto} onChange={e => setForm({ ...form, produto: e.target.value })}>
                      {['assessoria', 'clube', 'curso', 'outro'].map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={S.label}>Conteúdo do contrato</label>
                  <textarea style={{ ...S.input, height: 180, resize: 'vertical', fontFamily: 'inherit' }} value={form.conteudo} onChange={e => setForm({ ...form, conteudo: e.target.value })} placeholder="Cole ou escreva as cláusulas do contrato…" />
                </div>
                <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 18 }}>
                  <div style={{ flex: 1 }}>
                    <label style={S.label}>Valor (R$)</label>
                    <input type="number" min="0" step="0.01" style={S.input} value={form.valor} onChange={e => setForm({ ...form, valor: e.target.value })} placeholder="0,00" />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151', marginTop: 18 }}>
                    <input type="checkbox" checked={form.requer_assinatura} onChange={e => setForm({ ...form, requer_assinatura: e.target.checked })} /> Exige assinatura
                  </label>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button style={S.btn('outline')} onClick={() => setModal(null)}>Cancelar</button>
                  <button style={S.btn('outline')} onClick={() => salvar('rascunho')} disabled={saving}>Salvar rascunho</button>
                  <button style={S.btn('primary')} onClick={() => salvar('aguardando_assinatura')} disabled={saving}>
                    {saving ? 'Salvando…' : 'Liberar para assinatura'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const TABS = ['Cursos', 'eBooks', 'Contratos', 'Usuários', 'Configurações'];

export default function Admin() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('Cursos');

  if (loading) {
    return <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#64748b' }}>Carregando...</p></div>;
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
      <div style={S.header}>
        <span style={S.headerTitle}>TSN — Painel Administrativo</span>
        <button style={{ ...S.btn('outline'), background: 'transparent', color: '#94a3b8', border: '1px solid #334155', fontSize: 13 }} onClick={() => navigate('/')}>
          ← Voltar ao app
        </button>
      </div>

      <div style={S.body}>
        <div style={S.tabs}>
          {TABS.map(t => (
            <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>{t}</button>
          ))}
        </div>

        {tab === 'Cursos'         && <CursosTab />}
        {tab === 'eBooks'         && <EbooksTab />}
        {tab === 'Contratos'      && <ContratosTab />}
        {tab === 'Usuários'       && <UsuariosTab />}
        {tab === 'Configurações'  && <ConfigTab />}
      </div>
    </div>
  );
}
