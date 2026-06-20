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
    iniciarSuporte({ id: u.id, nome: u.nome || u.cpf, role: u.role || 'explorador' });
    navSup('/painel');
  };

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('perfis').select('id, nome, cpf, role, role_anterior, plano, created_at, ativo').order('created_at', { ascending: false });
    setUsers(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function saveRole(id) {
    await supabase.from('perfis').update({ role: newRole }).eq('id', id);
    setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
    setEditingId(null);
  }

  async function toggleAtivo(u) {
    const estaAtivo = u.ativo !== false;
    if (estaAtivo) {
      // Inativar: salva role atual para restaurar depois
      await supabase.from('perfis').update({ ativo: false, role_anterior: u.role }).eq('id', u.id);
      setUsers(users.map(x => x.id === u.id ? { ...x, ativo: false, role_anterior: u.role } : x));
    } else {
      // Reativar: restaura role anterior (se existir)
      const roleRestaurado = u.role_anterior || u.role;
      await supabase.from('perfis').update({ ativo: true, role: roleRestaurado, role_anterior: null }).eq('id', u.id);
      setUsers(users.map(x => x.id === u.id ? { ...x, ativo: true, role: roleRestaurado, role_anterior: null } : x));
    }
  }

  const filtered = users.filter(u => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (u.nome || '').toLowerCase().includes(q) || (u.cpf || '').toLowerCase().includes(q) || (u.role || '').toLowerCase().includes(q);
  });

  const ROLE_COLORS = { admin: '#7c3aed', explorador: '#64748b', top1: '#2563eb', top2: '#7c3aed', assessorado: '#d97706', clube: '#059669', consultor: '#0891b2', analista: '#f59e0b', advogado: '#dc2626' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Usuários ({users.length})</h2>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome, CPF ou role..." style={{ ...S.input, maxWidth: 280 }} />
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
                  <th style={S.th}>CPF</th>
                  <th style={S.th}>Role</th>
                  <th style={S.th}>Plano</th>
                  <th style={S.th}>Cadastro</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Ações</th>
                </tr></thead>
                <tbody>
                  {filtered.map(u => {
                    const ativo = u.ativo !== false;
                    return (
                      <tr key={u.id} style={{ opacity: ativo ? 1 : 0.6 }}>
                        <td style={S.td}><strong>{u.nome || '—'}</strong></td>
                        <td style={S.td}>{u.cpf || '—'}</td>
                        <td style={S.td}>
                          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: (ROLE_COLORS[u.role] || '#64748b') + '20', color: ROLE_COLORS[u.role] || '#64748b' }}>
                            {u.role || 'explorador'}
                          </span>
                        </td>
                        <td style={S.td}>{u.plano || '—'}</td>
                        <td style={S.td}>{u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}</td>
                        <td style={S.td}>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: ativo ? '#d1fae5' : '#fee2e2', color: ativo ? '#059669' : '#dc2626' }}>
                            {ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </td>
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
                              <button
                                style={{ padding: '5px 10px', background: ativo ? '#fee2e2' : '#dcfce7', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: ativo ? '#dc2626' : '#166534', cursor: 'pointer' }}
                                onClick={() => toggleAtivo(u)}>
                                {ativo ? 'Inativar' : 'Reativar'}
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
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
  const [planos, setPlanos] = useState([]);
  const [planosLoading, setPlanosLoading] = useState(true);
  const [planosSaved, setPlanosSaved] = useState({});
  const [planosErr, setPlanosErr] = useState('');

  useEffect(() => {
    supabase.from('planos_config').select('*').order('preco', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setPlanos(data);
        else setPlanosErr('Erro ao carregar planos. Rode o SQL schema_planos_config.sql no Supabase.');
        setPlanosLoading(false);
      });
  }, []);

  function salvar() {
    localStorage.setItem(FEEDBACK_KEY, email.trim() || DEFAULT_FEEDBACK_EMAIL);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function salvarPlano(p) {
    const { error } = await supabase.from('planos_config').update({
      preco: Number(p.preco) || 0,
      preco_vista: p.preco_vista ? Number(p.preco_vista) : null,
      cobrar: p.cobrar,
      ativo: p.ativo,
      atualizado_em: new Date().toISOString(),
    }).eq('plano_key', p.plano_key);
    if (!error) {
      setPlanosSaved(prev => ({ ...prev, [p.plano_key]: true }));
      setTimeout(() => setPlanosSaved(prev => ({ ...prev, [p.plano_key]: false })), 2000);
    }
  }

  function updatePlano(key, field, value) {
    setPlanos(prev => prev.map(p => p.plano_key === key ? { ...p, [field]: value } : p));
  }

  const fmtPreco = (v) => v != null ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Configurações</h2>

      {/* Preços dos Planos */}
      <div style={S.card}>
        <p style={S.subTitle}>Preços dos Planos</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Altere os valores aqui. O sistema usa esses preços na cobrança e exibição para o cliente.
          Campos à vista: apenas para Assessorado e Clube. Coluna "Cobrar": desative para planos operacionais gratuitos.
        </p>
        {planosErr && <div style={{ background: '#fee2e2', color: '#dc2626', padding: '10px 14px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{planosErr}</div>}
        {planosLoading ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Carregando...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: '160px 130px 130px 80px 70px 90px', gap: 10, padding: '6px 0', borderBottom: '2px solid #e2e8f0' }}>
              {['Plano', 'Preço mensal / único', 'Preço à vista', 'Cobrar?', 'Ativo?', ''].map(h => (
                <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</div>
              ))}
            </div>
            {planos.map(p => (
              <div key={p.plano_key} style={{ display: 'grid', gridTemplateColumns: '160px 130px 130px 80px 70px 90px', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{p.nome}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8' }}>{p.plano_key}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>R$</div>
                  <input type="number" step="0.01" value={p.preco} onChange={e => updatePlano(p.plano_key, 'preco', e.target.value)}
                    style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: '100%' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>R$ (opcional)</div>
                  <input type="number" step="0.01" value={p.preco_vista ?? ''} onChange={e => updatePlano(p.plano_key, 'preco_vista', e.target.value || null)}
                    placeholder="—" style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: '100%' }} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={p.cobrar} onChange={e => updatePlano(p.plano_key, 'cobrar', e.target.checked)}
                    style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#2563eb' }} />
                </div>
                <div style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={p.ativo} onChange={e => updatePlano(p.plano_key, 'ativo', e.target.checked)}
                    style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#10b981' }} />
                </div>
                <button onClick={() => salvarPlano(p)}
                  style={{ padding: '7px 14px', background: planosSaved[p.plano_key] ? '#10b981' : '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  {planosSaved[p.plano_key] ? '✓ Salvo' : 'Salvar'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Email de feedback */}
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
// CONTRATOS TAB — admin gera, aprova e libera contratos para assinatura
// ═══════════════════════════════════════════════════════════════════════════════

function ContratosTab() {
  const [contratosLink, setContratosLink] = useState([]);
  const [loading, setLoading] = useState(true);

  // Modal em 3 etapas: null (fechado) | 1 (descrever) | 2 (revisar) | 3 (link gerado)
  const [step, setStep] = useState(null);
  const [detalhe, setDetalhe] = useState(null); // contrato aberto para ver

  // Etapa 1
  const [templateSelecionado, setTemplateSelecionado] = useState(null);
  const [titulo, setTitulo] = useState('');
  const [tipo, setTipo] = useState('servico');
  const [descricao, setDescricao] = useState('');
  const [arquivos, setArquivos] = useState([]); // [{ nome, conteudo }]

  // Etapa 2
  const [conteudo, setConteudo] = useState('');
  const [perguntas, setPerguntas] = useState([]);
  const [respostas, setRespostas] = useState({});
  const [gerandoContrato, setGerandoContrato] = useState(false);

  // Etapa 3
  const [linkGerado, setLinkGerado] = useState('');
  const [savingLink, setSavingLink] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('contratos_link').select('*').order('criado_em', { ascending: false });
    setContratosLink((data || []).filter(c => c.status !== 'cancelado'));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function abrirModal() {
    setTitulo(''); setTipo('servico'); setDescricao('');
    setArquivos([]); setConteudo(''); setPerguntas([]); setRespostas({});
    setLinkGerado(''); setTemplateSelecionado(null);
    setStep(1);
  }

  function aplicarTemplate(key) {
    setTemplateSelecionado(key);
    if (key === 'assessorado') {
      setTitulo('Contrato de Assessoria para Aquisição de Imóvel em Leilão');
      setTipo('servico');
      setDescricao('Assessoria completa para identificação, análise de viabilidade, análise jurídica do edital e matrícula, acompanhamento do leilão e suporte pós-arrematação. Prazo: até 12 meses para conclusão da arrematação. Não inclui mentoria. Valor: R$500 em 12x (total R$6.000) ou R$5.000 à vista + 10% honorários de êxito sobre o valor arrematado. Rescisão: aviso prévio de 30 dias + multa de 10%.');
    } else if (key === 'clube') {
      setTitulo('Contrato de Adesão ao Clube de Negócios TSN Ativos');
      setTipo('servico');
      setDescricao('Adesão ao Clube de Negócios TSN Ativos: mentoria, assessoria e arrematações ilimitadas por 12 meses. Valor: R$5.000/mês (total R$60.000) ou R$48.000 à vista, vencimento dia 10. Fidelidade mínima de 12 meses. Rescisão antes do prazo: pagamento integral das parcelas restantes.');
    } else if (key === 'analista') {
      setTitulo('Contrato de Prestação de Serviços de Análise de Imóveis em Leilão');
      setTipo('servico');
      setDescricao('Contratação de analista para elaboração de relatórios de viabilidade econômico-financeira e análise de editais de imóveis em leilão judicial e extrajudicial. Remuneração por laudo emitido, a combinar. Sigilo sobre todos os dados dos clientes e imóveis analisados. Prazo indeterminado, rescisão com aviso de 30 dias.');
    } else if (key === 'advogado') {
      setTitulo('Contrato de Parceria Jurídica para Análise de Imóveis em Leilão');
      setTipo('servico');
      setDescricao('Parceria com advogado para análise jurídica de matrícula, edital, processo e certidões de imóveis em leilão, emissão de parecer jurídico por operação. Remuneração por parecer emitido, a combinar. Total sigilo sobre dados dos clientes. Prazo indeterminado, rescisão com aviso de 30 dias. Escritório parceiro independente.');
    } else if (key === 'consultor') {
      setTitulo('Contrato de Consultoria e Afiliação TSN Ativos');
      setTipo('servico');
      setDescricao('Contratação de consultor/afiliado para divulgação dos serviços TSN Ativos e captação de novos clientes. Remuneração por comissão sobre cada cliente ativo indicado, a combinar. Vedada qualquer promessa de rentabilidade a terceiros. Prazo indeterminado, rescisão com aviso de 30 dias.');
    } else if (key === 'nda') {
      setTitulo('Acordo de Confidencialidade e Não Divulgação');
      setTipo('nda');
      setDescricao('');
    } else if (key === 'personalizado') {
      setTitulo(''); setTipo('servico'); setDescricao('');
    }
  }

  async function lerArquivos(files) {
    const lidos = [];
    for (const file of files) {
      if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        const texto = await file.text();
        lidos.push({ nome: file.name, conteudo: texto.slice(0, 3000) });
      } else {
        lidos.push({ nome: file.name, conteudo: null }); // PDF/docx: só nome como referência
      }
    }
    setArquivos(prev => [...prev, ...lidos]);
  }

  async function gerarContrato() {
    if (!descricao.trim()) { alert('Descreva o que o contrato deve conter.'); return; }
    setGerandoContrato(true);
    try {
      const r = await fetch('/api/gerar-contrato', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          titulo,
          tipo,
          descricao,
          arquivos: arquivos.map(a => ({ nome: a.nome, conteudo: a.conteudo })),
          respostas: Object.keys(respostas).length > 0 ? respostas : undefined,
        }),
      });
      const d = await r.json();
      if (d.conteudo) {
        setConteudo(d.conteudo);
        setPerguntas(d.perguntas || []);
        setRespostas({});
        setStep(2);
      } else {
        alert(d.error || 'Não foi possível gerar o contrato. Tente novamente.');
      }
    } catch { alert('Erro de conexão ao gerar o contrato.'); }
    setGerandoContrato(false);
  }

  async function gerarLinkContrato() {
    if (!conteudo.trim()) { alert('O conteúdo do contrato está vazio.'); return; }
    setSavingLink(true);
    const { data, error } = await supabase.from('contratos_link').insert({
      titulo: titulo || 'Contrato',
      conteudo,
      tipo_contrato: tipo,
    }).select().single();
    setSavingLink(false);
    if (error || !data) { alert('Erro ao gerar link: ' + (error?.message || 'tente novamente')); return; }
    const base = window.location.href.split('#')[0];
    setLinkGerado(`${base}#/c/${data.token}`);
    setStep(3);
    await load();
  }

  async function excluirLink(id) {
    if (!window.confirm('Excluir este contrato permanentemente?')) return;
    await supabase.from('contratos_link').delete().eq('id', id);
    load();
  }

  async function cancelarLink(id) {
    if (!window.confirm('Cancelar este contrato?')) return;
    await supabase.from('contratos_link').update({ status: 'cancelado' }).eq('id', id);
    load();
  }

  const ST_LINK = {
    aguardando: ['Aguardando assinatura', '#d97706'],
    assinado:   ['Assinado', '#059669'],
    expirado:   ['Expirado', '#94a3b8'],
    cancelado:  ['Cancelado', '#dc2626'],
  };

  const TIPO_LABEL = { servico:'Serviço', prestacao:'Prestação', locacao:'Locação', compra:'Compra e Venda', outro:'Outro', nda:'NDA / Sigilo' };

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:18, fontWeight:700, color:'#0f172a', margin:0 }}>Contratos ({contratosLink.length})</h2>
        <button style={S.btn('primary')} onClick={abrirModal}>🔗 Novo contrato com link</button>
      </div>

      {/* Tabela */}
      <div style={S.card}>
        {loading ? <p style={{ color:'#94a3b8', textAlign:'center', padding:32 }}>Carregando...</p>
          : contratosLink.length === 0
          ? <p style={{ color:'#94a3b8', textAlign:'center', padding:32, fontSize:13 }}>Nenhum contrato gerado ainda. Clique em "Novo contrato com link" para começar.</p>
          : (
            <div style={{ overflowX:'auto' }}>
              <table style={S.table}>
                <thead><tr>
                  <th style={S.th}>Título</th>
                  <th style={S.th}>Tipo</th>
                  <th style={S.th}>Contratante</th>
                  <th style={S.th}>Contratado</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Criado</th>
                  <th style={S.th}>Expira</th>
                  <th style={S.th}>Ações</th>
                </tr></thead>
                <tbody>
                  {contratosLink.map(cl => {
                    const [lbl, cor] = ST_LINK[cl.status] || ST_LINK.aguardando;
                    const linkUrl = `${window.location.href.split('#')[0]}#/c/${cl.token}`;
                    const sig = cl.dados_signatario;
                    const nomeContratado = sig ? (sig.nome || sig.razao_social || '—') : (cl.status === 'aguardando' ? 'Aguardando preenchimento' : '—');
                    return (
                      <tr key={cl.id}>
                        <td style={S.td}><strong>{cl.titulo}</strong></td>
                        <td style={S.td}>{TIPO_LABEL[cl.tipo_contrato] || cl.tipo_contrato}</td>
                        <td style={{ ...S.td, fontSize:11 }}>Nogueira Empreendimentos</td>
                        <td style={{ ...S.td, fontSize:11 }}>{nomeContratado}</td>
                        <td style={S.td}><span style={{ padding:'2px 10px', borderRadius:999, fontSize:12, fontWeight:700, background:cor+'20', color:cor }}>{lbl}</span></td>
                        <td style={{ ...S.td, fontSize:11 }}>{new Date(cl.criado_em).toLocaleDateString('pt-BR')}</td>
                        <td style={{ ...S.td, fontSize:11 }}>{new Date(cl.expira_em).toLocaleDateString('pt-BR')}</td>
                        <td style={S.td}>
                          <div style={{ display:'flex', gap:5, flexWrap:'wrap' }}>
                            <button style={{ ...S.btn('outline'), fontSize:11, padding:'4px 10px' }} onClick={() => setDetalhe(cl)}>Ver</button>
                            {cl.status === 'aguardando' && (
                              <button style={{ ...S.btn('outline'), fontSize:11, padding:'4px 10px' }} onClick={() => { navigator.clipboard.writeText(linkUrl); alert('Link copiado!'); }}>Copiar link</button>
                            )}
                            {cl.status === 'aguardando' && (
                              <button style={{ ...S.btn('danger'), fontSize:11, padding:'4px 10px' }} onClick={() => cancelarLink(cl.id)}>Cancelar</button>
                            )}
                            {(cl.status === 'cancelado' || cl.status === 'expirado') && (
                              <button style={{ ...S.btn('danger'), fontSize:11, padding:'4px 10px' }} onClick={() => excluirLink(cl.id)}>Excluir</button>
                            )}
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

      {/* Modal de detalhe do contrato */}
      {detalhe && (
        <div style={S.overlay} onClick={e => e.target === e.currentTarget && setDetalhe(null)}>
          <div style={{ ...S.modal, maxWidth:640 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:16 }}>
              <div>
                <h3 style={{ margin:'0 0 4px', fontSize:17, fontWeight:700 }}>{detalhe.titulo}</h3>
                <span style={{ fontSize:12, color:'#64748b' }}>{TIPO_LABEL[detalhe.tipo_contrato] || detalhe.tipo_contrato}</span>
              </div>
              <button onClick={() => setDetalhe(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#94a3b8' }}>×</button>
            </div>

            {/* Partes */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:16 }}>
              <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'#16a34a', textTransform:'uppercase', marginBottom:4 }}>Contratante</div>
                <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>Nogueira Empreendimentos</div>
              </div>
              <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'#2563eb', textTransform:'uppercase', marginBottom:4 }}>Contratado</div>
                {detalhe.dados_signatario ? (
                  <>
                    <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>{detalhe.dados_signatario.nome || detalhe.dados_signatario.razao_social}</div>
                    <div style={{ fontSize:11, color:'#475569' }}>{detalhe.dados_signatario.cpf || detalhe.dados_signatario.cnpj}</div>
                    <div style={{ fontSize:11, color:'#475569' }}>{detalhe.dados_signatario.email}</div>
                  </>
                ) : (
                  <div style={{ fontSize:12, color:'#94a3b8', fontStyle:'italic' }}>Aguardando preenchimento pelo signatário</div>
                )}
              </div>
            </div>

            {/* Conteúdo */}
            <div style={{ background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0', padding:'14px 16px', maxHeight:300, overflowY:'auto', marginBottom:16 }}>
              <div style={{ fontSize:13, color:'#0f172a', lineHeight:1.8, whiteSpace:'pre-wrap' }}>{detalhe.conteudo}</div>
            </div>

            {/* Assinatura (se assinado) */}
            {detalhe.status === 'assinado' && (
              <div style={{ background:'#dcfce7', borderRadius:10, padding:'12px 14px', marginBottom:14 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#166534' }}>✔ Assinado em {detalhe.assinado_em ? new Date(detalhe.assinado_em).toLocaleString('pt-BR') : '—'}</div>
                {detalhe.assinatura && <img src={detalhe.assinatura} alt="assinatura" style={{ maxHeight:60, background:'white', borderRadius:6, marginTop:8, padding:4 }}/>}
                {detalhe.assinatura_hash && <div style={{ fontSize:10, color:'#15803d', wordBreak:'break-all', marginTop:4 }}>Hash: {detalhe.assinatura_hash}</div>}
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end' }}>
              <button style={S.btn('outline')} onClick={() => setDetalhe(null)}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Novo contrato — 3 etapas */}
      {step && (
        <div style={{ ...S.overlay, alignItems: step === 2 ? 'stretch' : 'center', padding: step === 2 ? 0 : '20px' }}
          onClick={e => e.target === e.currentTarget && setStep(null)}>
          <div style={step === 2
            ? { background:'white', display:'flex', flexDirection:'column', width:'100%', height:'100%', maxWidth:'100%', overflow:'hidden' }
            : { ...S.modal, maxWidth:700 }}>

            {/* Indicador de etapas — em etapa 2 fica no topo fixo */}
            <div style={{ display:'flex', alignItems:'center', gap:8, padding: step===2 ? '14px 24px' : '0 0 20px',
              borderBottom: step===2 ? '1px solid #e2e8f0' : 'none', flexShrink:0,
              background: step===2 ? 'white' : 'transparent' }}>
              {['Descrever','Revisar','Link gerado'].map((s, i) => (
                <React.Fragment key={s}>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <div style={{ width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800,
                      background: step > i+1 ? '#059669' : step === i+1 ? '#2563eb' : '#e2e8f0',
                      color: step >= i+1 ? 'white' : '#94a3b8' }}>{step > i+1 ? '✓' : i+1}</div>
                    <span style={{ fontSize:12, fontWeight:step===i+1?700:400, color:step===i+1?'#0f172a':'#94a3b8' }}>{s}</span>
                  </div>
                  {i < 2 && <div style={{ flex:1, height:1, background:'#e2e8f0' }}/>}
                </React.Fragment>
              ))}
              {step === 2 && (
                <button onClick={() => setStep(null)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#94a3b8', lineHeight:1 }}>×</button>
              )}
            </div>

            {/* ── Etapa 1: Descrever ── */}
            {step === 1 && (
              <>
                {/* Seleção rápida de template */}
                <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:16 }}>
                  {[
                    { key:'assessorado',  label:'📋 Assessorado' },
                    { key:'clube',        label:'🏛️ Clube de Negócios' },
                    { key:'analista',     label:'🔍 Analista' },
                    { key:'advogado',     label:'⚖️ Advogado Parceiro' },
                    { key:'consultor',    label:'🤝 Consultor/Afiliado' },
                    { key:'nda',          label:'📄 NDA/Sigilo' },
                    { key:'personalizado', label:'✏️ Personalizado' },
                  ].map(t => (
                    <button key={t.key} onClick={() => aplicarTemplate(t.key)}
                      style={{ padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight:700, cursor:'pointer', border:'1px solid',
                        background: templateSelecionado === t.key ? '#0f172a' : '#fff',
                        color: templateSelecionado === t.key ? '#fff' : '#475569',
                        borderColor: templateSelecionado === t.key ? '#0f172a' : '#cbd5e1' }}>
                      {t.label}
                    </button>
                  ))}
                </div>

                <h3 style={{ ...S.sectionTitle, marginBottom:4 }}>Descreva o contrato</h3>
                <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>O contrato será emitido pela <strong>Nogueira Empreendimentos</strong>. A outra parte preenche os dados e assina digitalmente.</p>

                <div style={{ display:'flex', gap:10, marginBottom:12 }}>
                  <div style={{ flex:2 }}>
                    <label style={S.label}>Título do contrato</label>
                    <input style={S.input} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título do contrato" />
                  </div>
                  <div style={{ flex:1 }}>
                    <label style={S.label}>Tipo</label>
                    <select style={S.input} value={tipo} onChange={e => setTipo(e.target.value)}>
                      <option value="servico">Serviço</option>
                      <option value="prestacao">Prestação</option>
                      <option value="locacao">Locação</option>
                      <option value="compra">Compra e Venda</option>
                      <option value="nda">NDA / Sigilo</option>
                      <option value="outro">Outro</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom:14 }}>
                  <label style={S.label}>O que o contrato deve conter? *</label>
                  <textarea style={{ ...S.input, height:110, resize:'vertical', fontFamily:'inherit', fontSize:13 }}
                    value={descricao}
                    onChange={e => setDescricao(e.target.value)}
                    placeholder="Descreva livremente o que o contrato deve conter."/>
                </div>

                <div style={{ marginBottom:16 }}>
                  <label style={S.label}>Anexar arquivos de referência (opcional)</label>
                  <div style={{ fontSize:11, color:'#94a3b8', marginBottom:6 }}>Documentos que embasam o contrato. Textos (.txt, .md) são lidos; PDFs ficam referenciados pelo nome.</div>
                  <input type="file" multiple accept=".txt,.md,.pdf,.doc,.docx"
                    style={{ fontSize:12, color:'#334155' }}
                    onChange={e => lerArquivos(Array.from(e.target.files))} />
                  {arquivos.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:8 }}>
                      {arquivos.map((a, i) => (
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:4, background: a.conteudo ? '#dbeafe' : '#fef3c7', color: a.conteudo ? '#1e40af' : '#92400e', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:20 }}>
                          {a.conteudo ? '📄' : '📎'} {a.nome}
                          <button onClick={() => setArquivos(prev => prev.filter((_, j) => j !== i))}
                            style={{ background:'none', border:'none', cursor:'pointer', color:'inherit', padding:0, marginLeft:2 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display:'flex', justifyContent:'flex-end', gap:8 }}>
                  <button style={S.btn('outline')} onClick={() => setStep(null)}>Cancelar</button>
                  <button style={S.btn('primary')} onClick={gerarContrato} disabled={gerandoContrato || !descricao.trim()}>
                    {gerandoContrato ? '⏳ Gerando contrato…' : 'Gerar contrato →'}
                  </button>
                </div>
              </>
            )}

            {/* ── Etapa 2: Revisar — layout fullscreen ── */}
            {step === 2 && (
              <div style={{ display:'flex', flex:1, overflow:'hidden' }}>

                {/* Sidebar esquerda — partes + perguntas */}
                <div style={{ width:300, flexShrink:0, borderRight:'1px solid #e2e8f0', display:'flex', flexDirection:'column', overflowY:'auto', background:'#f8fafc' }}>
                  <div style={{ padding:'20px 18px', flex:1 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:0.5, marginBottom:12 }}>Partes do contrato</div>

                    <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'12px 14px', marginBottom:10 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#16a34a', textTransform:'uppercase', marginBottom:4 }}>Contratante</div>
                      <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>Nogueira Empreendimentos</div>
                    </div>
                    <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, padding:'12px 14px', marginBottom:20 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#2563eb', textTransform:'uppercase', marginBottom:4 }}>Contratado</div>
                      <div style={{ fontSize:12, color:'#94a3b8', fontStyle:'italic' }}>Preenchido pelo signatário ao assinar</div>
                    </div>

                    {perguntas.length > 0 && (
                      <>
                        <div style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:0.5, marginBottom:10 }}>Pontos a confirmar</div>
                        <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:10, padding:'14px 14px', marginBottom:14 }}>
                          {perguntas.map((p, i) => (
                            <div key={i} style={{ marginBottom:12 }}>
                              <label style={{ fontSize:11, color:'#c2410c', fontWeight:700, display:'block', marginBottom:5, lineHeight:1.4 }}>{p}</label>
                              <input style={{ ...S.input, fontSize:12 }}
                                value={respostas[i] || ''}
                                onChange={e => setRespostas(r => ({ ...r, [i]: e.target.value }))}
                                placeholder="Sua resposta…" />
                            </div>
                          ))}
                          <button style={{ ...S.btn('outline'), fontSize:12, width:'100%' }} onClick={gerarContrato} disabled={gerandoContrato}>
                            {gerandoContrato ? '⏳ Regerando…' : '↻ Regerar com respostas'}
                          </button>
                        </div>
                      </>
                    )}

                    <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.6, marginTop: perguntas.length > 0 ? 0 : 8 }}>
                      Revise o texto ao lado. Clique em qualquer trecho para editar diretamente antes de aprovar.
                    </div>
                  </div>
                </div>

                {/* Área principal — texto do contrato */}
                <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
                  <div style={{ padding:'16px 24px 8px', borderBottom:'1px solid #f1f5f9', flexShrink:0 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:'#0f172a' }}>{titulo || 'Contrato'}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>Edite diretamente se necessário antes de aprovar.</div>
                  </div>
                  <textarea
                    style={{ flex:1, border:'none', outline:'none', resize:'none', fontFamily:'Georgia, serif', fontSize:14, lineHeight:1.9, padding:'24px 32px', color:'#1e293b', background:'white' }}
                    value={conteudo}
                    onChange={e => setConteudo(e.target.value)} />
                </div>
              </div>
            )}

            {/* ── Etapa 2: barra inferior ── */}
            {step === 2 && (
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 24px', borderTop:'1px solid #e2e8f0', background:'white', flexShrink:0 }}>
                <button style={S.btn('outline')} onClick={() => setStep(1)}>← Voltar e editar</button>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <span style={{ fontSize:12, color:'#94a3b8' }}>{conteudo.split(/\s+/).filter(Boolean).length} palavras</span>
                  <button style={{ ...S.btn('primary'), padding:'10px 28px' }} onClick={gerarLinkContrato} disabled={savingLink || !conteudo.trim()}>
                    {savingLink ? 'Gerando link…' : '✓ Aprovar e gerar link'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Etapa 3: Link gerado ── */}
            {step === 3 && (
              <>
                <div style={{ textAlign:'center', padding:'20px 0 12px' }}>
                  <div style={{ fontSize:48, marginBottom:10 }}>🔗</div>
                  <h3 style={{ fontSize:18, fontWeight:800, color:'#0f172a', margin:'0 0 6px' }}>Link gerado com sucesso!</h3>
                  <p style={{ fontSize:13, color:'#64748b', margin:0 }}>Válido por 30 dias. Ao ser assinado, os dados ficam registrados.</p>
                </div>
                <div style={{ background:'#f1f5f9', borderRadius:8, padding:'14px 16px', margin:'16px 0', display:'flex', gap:10, alignItems:'center' }}>
                  <span style={{ fontSize:12, color:'#334155', wordBreak:'break-all', flex:1 }}>{linkGerado}</span>
                  <button style={S.btn('primary')} onClick={() => navigator.clipboard.writeText(linkGerado).then(() => alert('Link copiado!'))}>Copiar</button>
                </div>
                <div style={{ display:'flex', justifyContent:'flex-end' }}>
                  <button style={S.btn('outline')} onClick={() => setStep(null)}>Fechar</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Aba Promoções ────────────────────────────────────────────────────────────
const PRODUTOS_PROMO = [
  { key: 'top1', label: 'Investidor — R$ 49,90/mês' },
  { key: 'top2', label: 'Investidor Pro — R$ 99,90/mês' },
  { key: 'assessorado', label: 'Assessorado — R$ 500×12 ou R$ 5.000 à vista' },
  { key: 'clube', label: 'Clube de Negócios — R$ 5.000/mês (12 meses)' },
];

const defaultPromo = () => ({ codigo: '', produto: 'top1', descricao_condicoes: '', desconto_pct: '', desconto_valor: '', ativo: true });

function PromoTab() {
  const { user } = useAuth();
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(defaultPromo());
  const [editId, setEditId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('links_promo').select('*, perfis(nome)').order('criado_em', { ascending: false });
    setLinks(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const up = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const gerarCodigo = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const cod = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    up('codigo', cod);
  };

  const salvar = async () => {
    if (!form.codigo.trim()) { setMsg('Informe o código.'); return; }
    setSalvando(true); setMsg('');
    const payload = {
      codigo: form.codigo.trim().toUpperCase(),
      produto: form.produto,
      descricao_condicoes: form.descricao_condicoes,
      desconto_pct: Number(form.desconto_pct) || 0,
      desconto_valor: Number(form.desconto_valor) || 0,
      ativo: form.ativo,
      criado_por: user.id,
    };
    const { error } = editId
      ? await supabase.from('links_promo').update(payload).eq('id', editId)
      : await supabase.from('links_promo').insert(payload);
    if (error) { setMsg('Erro: ' + error.message); }
    else { setMsg(editId ? 'Atualizado!' : 'Link criado!'); setForm(defaultPromo()); setEditId(null); await carregar(); }
    setSalvando(false);
  };

  const editar = (l) => { setForm({ codigo: l.codigo, produto: l.produto, descricao_condicoes: l.descricao_condicoes || '', desconto_pct: l.desconto_pct || '', desconto_valor: l.desconto_valor || '', ativo: l.ativo }); setEditId(l.id); };
  const toggleAtivo = async (l) => { await supabase.from('links_promo').update({ ativo: !l.ativo }).eq('id', l.id); await carregar(); };
  const copiarLink = (cod) => navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/promo/${cod}`);

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: '0 0 20px' }}>Links Promocionais</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: 20, alignItems: 'start' }}>
        {/* Formulário */}
        <div style={S.card}>
          <div style={{ fontWeight: 800, color: '#0f172a', marginBottom: 16 }}>{editId ? 'Editar link' : 'Novo link promocional'}</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input value={form.codigo} onChange={e => up('codigo', e.target.value.toUpperCase())} placeholder="CÓDIGO (ex: TSN30)" style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontWeight: 700 }} maxLength={12} />
            <button onClick={gerarCodigo} style={{ padding: '0 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer', whiteSpace: 'nowrap' }}>Gerar</button>
          </div>
          <select value={form.produto} onChange={e => up('produto', e.target.value)} style={{ ...S.input, marginBottom: 14 }}>
            {PRODUTOS_PROMO.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>DESCONTO %</label>
              <input type="number" value={form.desconto_pct} onChange={e => up('desconto_pct', e.target.value)} placeholder="ex: 30" style={S.input} min="0" max="100" />
            </div>
            <div>
              <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>DESCONTO R$</label>
              <input type="number" value={form.desconto_valor} onChange={e => up('desconto_valor', e.target.value)} placeholder="ex: 20" style={S.input} min="0" />
            </div>
          </div>
          <textarea value={form.descricao_condicoes} onChange={e => up('descricao_condicoes', e.target.value)}
            placeholder="Condições promocionais (ex: '30% de desconto no primeiro mês para novos alunos')"
            rows={3} style={{ ...S.input, resize: 'vertical', marginBottom: 14 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.ativo} onChange={e => up('ativo', e.target.checked)} /> Link ativo
          </label>
          {msg && <div style={{ padding: '8px 12px', background: msg.startsWith('Erro') ? '#fee2e2' : '#dcfce7', color: msg.startsWith('Erro') ? '#dc2626' : '#166534', borderRadius: 8, fontSize: 12, fontWeight: 700, marginBottom: 12 }}>{msg}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={salvar} disabled={salvando} style={S.btn('primary')}>{salvando ? 'Salvando…' : editId ? 'Atualizar' : 'Criar link'}</button>
            {editId && <button onClick={() => { setForm(defaultPromo()); setEditId(null); }} style={S.btn('outline')}>Cancelar</button>}
          </div>
        </div>

        {/* Lista */}
        <div style={S.card}>
          {loading ? <p style={{ color: '#94a3b8' }}>Carregando…</p>
            : links.length === 0 ? <p style={{ color: '#94a3b8' }}>Nenhum link criado ainda.</p>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {links.map(l => {
                  const linkUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/promo/${l.codigo}`;
                  const desconto = l.desconto_pct > 0 ? `${l.desconto_pct}% off` : l.desconto_valor > 0 ? `R$ ${l.desconto_valor} off` : 'sem desconto';
                  return (
                    <div key={l.id} style={{ padding: '14px 16px', border: `1px solid ${l.ativo ? '#e2e8f0' : '#fee2e2'}`, borderRadius: 12, background: l.ativo ? 'white' : '#fff5f5' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                        <div>
                          <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 15, color: '#0f172a', marginRight: 10 }}>{l.codigo}</span>
                          <span style={{ fontSize: 12, fontWeight: 700, color: '#2563eb' }}>{PRODUTOS_PROMO.find(p => p.key === l.produto)?.label || l.produto}</span>
                          <span style={{ fontSize: 12, color: '#059669', fontWeight: 700, marginLeft: 8 }}>{desconto}</span>
                          {!l.ativo && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, marginLeft: 8 }}>INATIVO</span>}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button onClick={() => copiarLink(l.codigo)} style={{ padding: '5px 10px', background: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>Copiar link</button>
                          <button onClick={() => editar(l)} style={{ padding: '5px 10px', background: '#eff6ff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#2563eb', cursor: 'pointer' }}>Editar</button>
                          <button onClick={() => toggleAtivo(l)} style={{ padding: '5px 10px', background: l.ativo ? '#fee2e2' : '#dcfce7', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: l.ativo ? '#dc2626' : '#166534', cursor: 'pointer' }}>{l.ativo ? 'Desativar' : 'Ativar'}</button>
                        </div>
                      </div>
                      {l.descricao_condicoes && <div style={{ marginTop: 8, fontSize: 12, color: '#64748b' }}>📋 {l.descricao_condicoes}</div>}
                      <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', wordBreak: 'break-all' }}>{linkUrl}</div>
                      {l.perfis?.nome && <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>Criado por: {l.perfis.nome}</div>}
                    </div>
                  );
                })}
              </div>
            )
          }
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVITES TAB
// ═══════════════════════════════════════════════════════════════════════════════
function ConvitesTab() {
  const { user } = useAuth();
  const [convites, setConvites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [copiado, setCopiado] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('links_convite').select('*, perfis:criado_por(nome)').order('criado_em', { ascending: false });
    setConvites(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  const gerarLink = async () => {
    const codigo = Math.random().toString(36).substring(2, 10).toUpperCase();
    await supabase.from('links_convite').insert({ codigo, criado_por: user.id });
    await carregar();
  };

  const toggleAtivo = async (c) => {
    await supabase.from('links_convite').update({ ativo: !c.ativo }).eq('id', c.id);
    await carregar();
  };

  const copiar = (codigo) => {
    navigator.clipboard.writeText(`${window.location.origin}/#/convite/${codigo}`);
    setCopiado(codigo);
    setTimeout(() => setCopiado(''), 2000);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Links de Convite</h2>
        <button style={S.btn('primary')} onClick={gerarLink}>+ Gerar novo convite</button>
      </div>
      <p style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Links de convite vinculam o novo usuário à equipe que o convidou, sem prazo de expiração.
      </p>
      <div style={S.card}>
        {loading ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Carregando...</p>
          : convites.length === 0 ? <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Nenhum convite gerado ainda.</p>
          : convites.map(c => (
            <div key={c.id} style={{ padding: '14px 16px', border: `1px solid ${c.ativo ? '#e2e8f0' : '#fee2e2'}`, borderRadius: 12, marginBottom: 10, background: c.ativo ? 'white' : '#fff5f5', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{c.codigo}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                  Por: {c.perfis?.nome || '—'} · {c.usos} uso{c.usos !== 1 ? 's' : ''} · {new Date(c.criado_em).toLocaleDateString('pt-BR')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: c.ativo ? '#d1fae5' : '#fee2e2', color: c.ativo ? '#059669' : '#dc2626' }}>
                  {c.ativo ? 'Ativo' : 'Inativo'}
                </span>
                <button onClick={() => copiar(c.codigo)} style={{ padding: '5px 10px', background: copiado === c.codigo ? '#dcfce7' : '#f1f5f9', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', color: copiado === c.codigo ? '#166534' : '#374151' }}>
                  {copiado === c.codigo ? '✓ Copiado' : 'Copiar link'}
                </button>
                <button onClick={() => toggleAtivo(c)} style={{ padding: '5px 10px', background: c.ativo ? '#fee2e2' : '#dcfce7', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: c.ativo ? '#dc2626' : '#166534', cursor: 'pointer' }}>
                  {c.ativo ? 'Desativar' : 'Ativar'}
                </button>
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

const FONTES_SCRAPER = [
  { key: 'santander',  label: 'Santander',        cor: '#dc2626' },
  { key: 'rodobens',   label: 'Rodobens',          cor: '#d97706' },
  { key: 'sold',       label: 'Sold (BV/Bradesco/Itaú)', cor: '#2563eb' },
  { key: 'zuk',        label: 'Zuk (Sicredi)',     cor: '#059669' },
  { key: 'megaleiloes',label: 'MegaLeilões',       cor: '#7c3aed' },
  { key: 'sicoob',     label: 'Sicoob',            cor: '#0891b2' },
];

function ScrapersMonitor() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedErrors, setExpandedErrors] = useState({});

  const carregar = () => {
    supabase
      .from('scrapers_log')
      .select('*')
      .order('iniciado_em', { ascending: false })
      .limit(30)
      .then(({ data }) => { setLogs(data || []); setLoading(false); });
  };

  useEffect(() => { carregar(); }, []);

  const ultimoPorFonte = {};
  FONTES_SCRAPER.forEach(f => {
    ultimoPorFonte[f.key] = logs.find(l => l.fonte === f.key);
  });

  const erros = FONTES_SCRAPER.filter(f => ultimoPorFonte[f.key]?.status === 'erro');

  const toggleError = (key) => setExpandedErrors(prev => ({ ...prev, [key]: !prev[key] }));

  const fmtDate = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Monitor de Scrapers</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {erros.length > 0 && (
            <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
              {erros.length} com erro
            </span>
          )}
          <button onClick={carregar} style={{ padding: '5px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 12, fontWeight: 600, cursor: 'pointer', color: '#475569' }}>
            Atualizar
          </button>
        </div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#94a3b8', fontSize: 13 }}>Carregando...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
          {FONTES_SCRAPER.map(f => {
            const log = ultimoPorFonte[f.key];
            const ok = log?.status === 'ok';
            const erro = log?.status === 'erro';
            const semDado = log?.status === 'sem_dados';
            const nunca = !log;
            const dotColor = ok ? '#10b981' : erro ? '#dc2626' : nunca ? '#94a3b8' : '#d97706';
            const cardBorder = ok ? '#bbf7d0' : erro ? '#fecaca' : '#e2e8f0';
            return (
              <div key={f.key} style={{ background: 'white', border: `1px solid ${cardBorder}`, borderRadius: 12, padding: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{f.label}</div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: ok ? '#dcfce7' : erro ? '#fee2e2' : semDado ? '#fefce8' : '#f1f5f9', color: ok ? '#166534' : erro ? '#dc2626' : semDado ? '#92400e' : '#64748b' }}>
                    {ok ? 'OK' : erro ? 'Erro' : semDado ? 'Sem dados' : 'Nunca executado'}
                  </span>
                </div>
                {log ? (
                  <div style={{ fontSize: 12, color: '#64748b', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    <div>Ultima exec.: <strong style={{ color: '#475569' }}>{fmtDate(log.iniciado_em)}</strong></div>
                    {log.imoveis_encontrados != null && (
                      <div>Registros: <strong style={{ color: '#0f172a' }}>{log.imoveis_encontrados.toLocaleString('pt-BR')}</strong></div>
                    )}
                    {log.duracao_ms && <div>Duração: {(log.duracao_ms / 1000).toFixed(1)}s</div>}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>Nenhuma execução registrada</div>
                )}
                {erro && log?.erro_msg && (
                  <div style={{ marginTop: 8 }}>
                    <button onClick={() => toggleError(f.key)} style={{ fontSize: 11, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}>
                      {expandedErrors[f.key] ? '▲ Ocultar erro' : '▼ Ver erro'}
                    </button>
                    {expandedErrors[f.key] && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#dc2626', background: '#fef2f2', borderRadius: 6, padding: '6px 8px', wordBreak: 'break-word' }}>{log.erro_msg}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const STATUS_CFG = {
  aberto:         { bg: '#dbeafe', color: '#1e40af', label: 'Aberto' },
  em_atendimento: { bg: '#fef9c3', color: '#854d0e', label: 'Em atendimento' },
  resolvido:      { bg: '#dcfce7', color: '#166534', label: 'Resolvido' },
  fechado:        { bg: '#f1f5f9', color: '#475569', label: 'Fechado' },
};

const ROLE_CFG = {
  admin:       { bg: '#ede9fe', color: '#5b21b6', label: 'Admin' },
  analista:    { bg: '#fef9c3', color: '#854d0e', label: 'Analista' },
  consultor:   { bg: '#e0f2fe', color: '#0369a1', label: 'Consultor' },
  advogado:    { bg: '#fee2e2', color: '#991b1b', label: 'Advogado' },
  explorador:  { bg: '#f1f5f9', color: '#475569', label: 'Explorador' },
  top1:        { bg: '#dbeafe', color: '#1e40af', label: 'Top1' },
  top2:        { bg: '#2563eb', color: 'white',   label: 'Investidor' },
  assessorado: { bg: '#fff7ed', color: '#c2410c', label: 'Assessorado' },
  clube:       { bg: '#dcfce7', color: '#166534', label: 'Clube' },
};

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || { bg: '#f1f5f9', color: '#475569', label: status };
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>;
}

function RoleBadge({ role }) {
  const cfg = ROLE_CFG[role] || { bg: '#f1f5f9', color: '#475569', label: role };
  return <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, color: cfg.color }}>{cfg.label}</span>;
}

function DashboardTab() {
  const [kpis, setKpis] = useState({ total: null, ativas: null, chamados: null, novos: null });
  const [contagem, setContagem] = useState({});
  const [chamadosRecentes, setChamadosRecentes] = useState([]);
  const [ultimosCadastros, setUltimosCadastros] = useState([]);
  const [equipe, setEquipe] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(new Date());
  const [asaasDados, setAsaasDados] = useState(null);
  const [asaasLoading, setAsaasLoading] = useState(true);
  const [inadimplentes, setInadimplentes] = useState(0);
  const [mrr, setMrr] = useState(0);

  const fmt = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtN = (v) => Number(v).toLocaleString('pt-BR');
  const fmtDate = (d) => d ? new Date(d).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';

  const carregar = useCallback(async () => {
    const seteAtrasado = new Date();
    seteAtrasado.setDate(seteAtrasado.getDate() - 7);

    const [
      { count: total },
      { count: ativas },
      { count: chamadosAbertos },
      { count: novos },
      { data: perfisData },
      { data: chamadosData },
      { data: cadastrosData },
      { data: equipeData },
      { count: inadimCount },
    ] = await Promise.all([
      supabase.from('perfis').select('id', { count: 'exact', head: true }),
      supabase.from('perfis').select('id', { count: 'exact', head: true }).in('role', ['top1','top2','assessorado','clube']),
      supabase.from('chamados').select('id', { count: 'exact', head: true }).in('status', ['aberto','em_atendimento']),
      supabase.from('perfis').select('id', { count: 'exact', head: true }).gte('created_at', seteAtrasado.toISOString()),
      supabase.from('perfis').select('role'),
      supabase.from('chamados').select('id, titulo, status, criado_em, user_nome').order('criado_em', { ascending: false }).limit(8),
      supabase.from('perfis').select('email, role, created_at, nome').order('created_at', { ascending: false }).limit(8),
      supabase.from('perfis').select('email, role, nome, created_at').in('role', ['admin','analista','consultor','advogado']).order('created_at', { ascending: false }),
      supabase.from('perfis').select('id', { count: 'exact', head: true }).not('inadimplente_desde', 'is', null),
    ]);

    const cnt = { admin: 0, explorador: 0, top1: 0, top2: 0, assessorado: 0, clube: 0, consultor: 0, analista: 0, advogado: 0 };
    (perfisData || []).forEach(p => { if (p.role in cnt) cnt[p.role]++; });
    const mrrCalc = (cnt.top1 * 49.90) + (cnt.top2 * 99.90) + (cnt.assessorado * 500) + (cnt.clube * 5000);

    setKpis({ total, ativas, chamados: chamadosAbertos, novos });
    setContagem(cnt);
    setChamadosRecentes(chamadosData || []);
    setUltimosCadastros(cadastrosData || []);
    setEquipe(equipeData || []);
    setInadimplentes(inadimCount || 0);
    setMrr(mrrCalc);
    setLastUpdate(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    carregar();

    const interval = setInterval(() => { carregar(); }, 30000);

    const channel = supabase
      .channel('dashboard_chamados')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chamados' }, () => { carregar(); })
      .subscribe();

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [carregar]);

  useEffect(() => {
    fetch('/api/asaas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'financas' }) })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setAsaasDados(d); setAsaasLoading(false); })
      .catch(() => setAsaasLoading(false));
  }, []);

  const cardStyle = { background: 'white', borderRadius: 16, padding: 20, border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' };

  function marcoAsaas(m) {
    if (m >= 100000) return { cor: '#7c3aed', label: 'Tier Enterprise', desc: 'Exigir conta dedicada e taxa máxima de 0,3% no PIX' };
    if (m >= 30000)  return { cor: '#dc2626', label: 'Alto Volume', desc: 'Negociar taxa diferenciada — meta abaixo de 0,5%' };
    if (m >= 10000)  return { cor: '#d97706', label: 'Volume Médio', desc: 'Contatar comercial Asaas — redução para ~0,7% no PIX possível' };
    return { cor: '#10b981', label: 'Crescimento', desc: `Falta R$ ${fmt(10000 - m)} MRR para negociar desconto de taxa com o Asaas` };
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 14 }}>Carregando dashboard…</div>;

  const marco = marcoAsaas(mrr);
  const proximo = mrr < 10000 ? 10000 : mrr < 30000 ? 30000 : mrr < 100000 ? 100000 : null;
  const progresso = proximo ? Math.min(100, (mrr / proximo) * 100) : 100;
  const taxaPix = mrr * 0.01;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>Centro de Operações</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: '#94a3b8' }}>
            Atualizado às {lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <button onClick={carregar} style={{ padding: '7px 16px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Atualizar
          </button>
        </div>
      </div>

      {/* Row 1: KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        {[
          { label: 'Usuários Totais', value: fmtN(kpis.total ?? 0), color: '#2563eb', border: '#2563eb' },
          { label: 'Assinaturas Ativas', value: fmtN(kpis.ativas ?? 0), color: '#10b981', border: '#10b981' },
          { label: 'Chamados Abertos', value: fmtN(kpis.chamados ?? 0), color: '#f59e0b', border: '#f59e0b' },
          { label: 'Novos esta semana', value: fmtN(kpis.novos ?? 0), color: '#8b5cf6', border: '#8b5cf6' },
        ].map(({ label, value, color, border }) => (
          <div key={label} style={{ ...cardStyle, borderLeft: `4px solid ${border}` }}>
            <div style={{ fontSize: 36, fontWeight: 900, color, lineHeight: 1, marginBottom: 6 }}>{value}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>{label}</div>
          </div>
        ))}
      </div>

      {/* Row 2: Usuários por plano */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 16 }}>Usuários por plano</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {[
            { key: 'explorador', label: 'Explorador', cor: '#64748b' },
            { key: 'top1',       label: 'Investidor (legado)', cor: '#93c5fd' },
            { key: 'top2',       label: 'Investidor', cor: '#2563eb' },
            { key: 'assessorado',label: 'Assessorado', cor: '#d97706' },
            { key: 'clube',      label: 'Clube', cor: '#059669' },
          ].map(({ key, label, cor }) => {
            const qtd = contagem[key] || 0;
            const total = kpis.total || 1;
            const pct = Math.round((qtd / total) * 100);
            return (
              <div key={key} style={{ flex: '1 1 180px', background: '#f8fafc', borderRadius: 12, padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: cor, flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <div style={{ flex: 1, background: '#e2e8f0', borderRadius: 4, height: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: cor, borderRadius: 4 }} />
                    </div>
                    <span style={{ fontSize: 11, color: '#64748b', minWidth: 28, textAlign: 'right' }}>{pct}%</span>
                  </div>
                </div>
                <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', minWidth: 32, textAlign: 'right' }}>{qtd}</div>
              </div>
            );
          })}
        </div>
        {inadimplentes > 0 && (
          <div style={{ marginTop: 12, padding: '8px 14px', background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
            {inadimplentes} usuário{inadimplentes > 1 ? 's' : ''} inadimplente{inadimplentes > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Row 3: Chamados recentes + Últimos cadastros */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 16 }}>Chamados recentes</div>
          {chamadosRecentes.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>Nenhum chamado</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {chamadosRecentes.map(c => (
                <div key={c.id} style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.titulo || '(sem título)'}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{c.user_nome || 'Usuário'} · {fmtDate(c.criado_em)}</div>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 16 }}>Últimos cadastros</div>
          {ultimosCadastros.length === 0 ? (
            <div style={{ fontSize: 13, color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>Nenhum cadastro</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ultimosCadastros.map((u, i) => (
                <div key={i} style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{u.nome || u.email || '-'}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{fmtDate(u.created_at)}</div>
                  </div>
                  <RoleBadge role={u.role} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Row 4: Atividade da equipe */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 16 }}>Atividade da equipe</div>
        {equipe.length === 0 ? (
          <div style={{ fontSize: 13, color: '#94a3b8' }}>Nenhum membro de equipe encontrado.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {['Membro', 'Função', 'Cadastro', 'Último acesso'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 700, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {equipe.map((m, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '10px 12px', color: '#0f172a', fontWeight: 600 }}>{m.nome || m.email || '-'}</td>
                    <td style={{ padding: '10px 12px' }}><RoleBadge role={m.role} /></td>
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>{fmtDate(m.created_at)}</td>
                    <td style={{ padding: '10px 12px', color: '#94a3b8', fontSize: 12 }}>N/D</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Row 5: Financeiro Asaas + Marco Comercial */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 12 }}>Financeiro Asaas — mês atual</div>
          {asaasLoading ? (
            <p style={{ color: '#94a3b8', fontSize: 13 }}>Carregando dados do Asaas…</p>
          ) : asaasDados ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                {[
                  { label: 'Saldo disponível', value: `R$ ${fmt(asaasDados.balance?.balance || 0)}`, cor: '#10b981' },
                  { label: 'A receber', value: `R$ ${fmt(asaasDados.balance?.totalReceivable || 0)}`, cor: '#2563eb' },
                  { label: 'Recebido no mês', value: `R$ ${fmt(asaasDados.statsMes?.revenue || 0)}`, cor: '#7c3aed' },
                  { label: 'Taxas cobradas', value: `R$ ${fmt(asaasDados.statsMes?.fees || 0)}`, cor: '#f59e0b' },
                ].map(({ label, value, cor }) => (
                  <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px' }}>
                    <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 3 }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: cor }}>{value}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>Dados direto da API Asaas</div>
            </>
          ) : (
            <p style={{ fontSize: 13, color: '#dc2626' }}>Não foi possível carregar dados do Asaas.</p>
          )}
        </div>

        <div style={{ ...cardStyle, border: `2px solid ${marco.cor}20` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Marco Comercial</div>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: marco.cor + '20', color: marco.cor }}>{marco.label}</span>
          </div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>R$ {fmt(mrr)}</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>MRR estimado — taxa est.: R$ {fmt(taxaPix)}</div>
          {proximo && (
            <>
              <div style={{ background: '#f1f5f9', borderRadius: 6, height: 8, overflow: 'hidden', marginBottom: 6 }}>
                <div style={{ height: '100%', width: `${progresso}%`, background: marco.cor, borderRadius: 6, transition: 'width 0.5s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 12 }}>
                <span>Atual: R$ {fmt(mrr)}</span>
                <span>Próximo: R$ {fmtN(proximo)}</span>
              </div>
            </>
          )}
          <div style={{ padding: '10px 12px', background: marco.cor + '10', borderRadius: 8, fontSize: 12, color: marco.cor, fontWeight: 600, lineHeight: 1.5 }}>
            {marco.desc}
          </div>
        </div>
      </div>

      {/* Row 6: Monitor de Scrapers */}
      <div style={{ ...cardStyle, marginBottom: 20 }}>
        <ScrapersMonitor />
      </div>

      {/* Row 7: Infraestrutura & Marcos */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 14 }}>Infraestrutura & Custos</div>
          {[
            { nome: 'Supabase', plano: `Free (${fmtN(kpis.total || 0)} usuários)`, custo: 'R$ 0/mês', alerta: (kpis.total || 0) > 40000, alertaMsg: 'Próximo do limite gratuito' },
            { nome: 'Vercel', plano: 'Free (Serverless)', custo: 'R$ 0/mês', alerta: false },
            { nome: 'Anthropic (Claude)', plano: 'Pay-as-you-go', custo: '~R$ 0,08/doc', alerta: false },
            { nome: 'Asaas Gateway', plano: '~1% por PIX', custo: `R$ ${fmt(taxaPix)}/mês`, alerta: mrr > 8000, alertaMsg: 'Contatar comercial Asaas para reduzir taxa' },
          ].map(({ nome, plano, custo, alerta, alertaMsg }) => (
            <div key={nome} style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>{nome}</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{plano}</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: alerta ? '#d97706' : '#10b981' }}>{custo}</div>
              </div>
              {alerta && <div style={{ marginTop: 4, fontSize: 11, color: '#d97706', fontWeight: 600 }}>⚠️ {alertaMsg}</div>}
            </div>
          ))}
        </div>

        <div style={cardStyle}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 14 }}>Marcos de Melhoria</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {[
              { gatilho: 'MRR ≥ R$ 10.000', atingido: mrr >= 10000, titulo: 'Negociar taxa Asaas', cor: '#d97706' },
              { gatilho: 'MRR ≥ R$ 30.000', atingido: mrr >= 30000, titulo: 'Migrar Supabase Pro', cor: '#7c3aed' },
              { gatilho: 'MRR ≥ R$ 50.000', atingido: mrr >= 50000, titulo: 'Ativar CDN e cache', cor: '#0891b2' },
              { gatilho: 'MRR ≥ R$ 100.000', atingido: mrr >= 100000, titulo: 'Infra dedicada + SLA', cor: '#dc2626' },
              { gatilho: '> 500 análises/mês', atingido: false, titulo: 'Fila assíncrona', cor: '#059669' },
              { gatilho: '> 50 contratos/mês', atingido: false, titulo: 'Assinatura ICP-Brasil', cor: '#6366f1' },
            ].map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, background: m.atingido ? m.cor + '10' : '#f8fafc', border: `1px solid ${m.atingido ? m.cor + '30' : '#f1f5f9'}` }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: m.atingido ? m.cor : '#cbd5e1', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>{m.titulo}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>{m.gatilho}</div>
                </div>
                {m.atingido && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: m.cor, color: 'white' }}>Atingido</span>}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Aba Tour ─────────────────────────────────────────────────────────────────
function TourTab() {
  const [passos, setPassos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editando, setEditando] = useState(null); // id do passo em edição inline
  const [novoTitulo, setNovoTitulo] = useState('');
  const [novoDesc, setNovoDesc] = useState('');

  const carregar = async () => {
    setLoading(true);
    const { data } = await supabase.from('tour_steps').select('*').order('ordem', { ascending: true });
    setPassos(data || []);
    setLoading(false);
  };
  useEffect(() => { carregar(); }, []);

  const salvarEdicao = async (p) => {
    await supabase.from('tour_steps').update({ titulo: p.titulo, descricao: p.descricao }).eq('id', p.id);
    setEditando(null);
    carregar();
  };

  const toggleAtivo = async (p) => {
    await supabase.from('tour_steps').update({ ativo: !p.ativo }).eq('id', p.id);
    carregar();
  };

  const mover = async (p, dir) => {
    const idx = passos.findIndex(x => x.id === p.id);
    const alvo = passos[idx + dir];
    if (!alvo) return;
    await Promise.all([
      supabase.from('tour_steps').update({ ordem: alvo.ordem }).eq('id', p.id),
      supabase.from('tour_steps').update({ ordem: p.ordem }).eq('id', alvo.id),
    ]);
    carregar();
  };

  const excluir = async (id) => {
    if (!confirm('Excluir este passo do tour?')) return;
    await supabase.from('tour_steps').delete().eq('id', id);
    carregar();
  };

  const adicionar = async () => {
    if (!novoTitulo.trim()) return;
    const maxOrdem = passos.length > 0 ? Math.max(...passos.map(p => p.ordem)) + 1 : 1;
    await supabase.from('tour_steps').insert({ titulo: novoTitulo, descricao: novoDesc, ordem: maxOrdem, ativo: true });
    setNovoTitulo(''); setNovoDesc('');
    carregar();
  };

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>Carregando…</div>;

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontWeight: 800, color: '#0f172a' }}>Passos do Tour Guiado</h3>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{passos.filter(p => p.ativo).length} ativos</span>
      </div>

      {/* Novo passo */}
      <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 12, padding: '16px 18px', marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: '#475569', marginBottom: 4 }}>Novo passo</div>
        <input value={novoTitulo} onChange={e => setNovoTitulo(e.target.value)} placeholder="Título do passo"
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
        <textarea value={novoDesc} onChange={e => setNovoDesc(e.target.value)} placeholder="Descrição (opcional)" rows={2}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
        <button onClick={adicionar} disabled={!novoTitulo.trim()}
          style={{ alignSelf: 'flex-end', padding: '8px 20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: novoTitulo.trim() ? 1 : 0.5 }}>
          + Adicionar
        </button>
      </div>

      {passos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#94a3b8' }}>Nenhum passo cadastrado.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {passos.map((p, idx) => (
            <div key={p.id} style={{ background: 'white', border: `1px solid ${p.ativo ? '#e2e8f0' : '#fecaca'}`, borderRadius: 12, padding: '14px 16px', opacity: p.ativo ? 1 : 0.6 }}>
              {editando === p.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <input defaultValue={p.titulo} id={`t-${p.id}`}
                    style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', fontSize: 13, width: '100%', boxSizing: 'border-box' }} />
                  <textarea defaultValue={p.descricao} id={`d-${p.id}`} rows={2}
                    style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid #e2e8f0', fontSize: 13, resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => salvarEdicao({ ...p, titulo: document.getElementById(`t-${p.id}`).value, descricao: document.getElementById(`d-${p.id}`).value })}
                      style={{ padding: '6px 16px', background: '#10b981', color: 'white', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Salvar</button>
                    <button onClick={() => setEditando(null)}
                      style={{ padding: '6px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 7, fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#0f172a', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flexShrink: 0 }}>{idx + 1}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{p.titulo}</div>
                    {p.descricao && <div style={{ fontSize: 12, color: '#64748b', marginTop: 3 }}>{p.descricao}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    <button onClick={() => mover(p, -1)} disabled={idx === 0} style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 11, opacity: idx === 0 ? 0.3 : 1 }}>▲</button>
                    <button onClick={() => mover(p, 1)} disabled={idx === passos.length - 1} style={{ padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, background: 'white', cursor: 'pointer', fontSize: 11, opacity: idx === passos.length - 1 ? 0.3 : 1 }}>▼</button>
                    <button onClick={() => toggleAtivo(p)} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, background: p.ativo ? '#dcfce7' : '#fee2e2', color: p.ativo ? '#059669' : '#dc2626', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>{p.ativo ? 'Ativo' : 'Inativo'}</button>
                    <button onClick={() => setEditando(p.id)} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, background: '#f1f5f9', color: '#475569', fontWeight: 600, fontSize: 11, cursor: 'pointer' }}>Editar</button>
                    <button onClick={() => excluir(p.id)} style={{ padding: '4px 10px', border: 'none', borderRadius: 6, background: '#fee2e2', color: '#dc2626', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Aba Scrapers ─────────────────────────────────────────────────────────────
function ScrapersTab() {
  const [status, setStatus] = useState(null);
  const [running, setRunning] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [erroMsg, setErroMsg] = useState('');

  useEffect(() => {
    fetch('/api/scraper-status').then(r => r.json()).then(setStatus).catch(() => {});
  }, []);

  async function executarScraper() {
    setRunning(true); setResultado(null); setErroMsg('');
    try {
      const r = await fetch('/api/scraper-caixa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (!r.ok) { setErroMsg(d.error || 'Erro ao executar o scraper.'); }
      else { setResultado(d); fetch('/api/scraper-status').then(r2 => r2.json()).then(setStatus).catch(() => {}); }
    } catch (e) { setErroMsg(e.message); }
    setRunning(false);
  }

  return (
    <div style={{ maxWidth: 640 }}>
      <h3 style={{ margin: '0 0 20px', fontWeight: 800, color: '#0f172a' }}>Importar Imóveis de Leilão</h3>

      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '24px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 20 }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 22 }}>🏦</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a', marginBottom: 4 }}>Caixa Econômica Federal</div>
            <p style={{ margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>
              Importa imóveis disponíveis para venda diretamente do portal da Caixa para todos os estados do Brasil.
              Os dados são atualizados na tabela <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, fontSize: 12 }}>imoveis_leilao</code>.
            </p>
          </div>
        </div>
        {status && (
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#475569', display: 'flex', gap: 20 }}>
            <span>📦 <strong>{status.total?.toLocaleString('pt-BR') || 0}</strong> imóveis no banco</span>
            {status.ultima_atualizacao && (
              <span>🕐 Atualizado em {new Date(status.ultima_atualizacao).toLocaleString('pt-BR')}</span>
            )}
          </div>
        )}
        {resultado && (
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#166534' }}>
            ✅ <strong>{resultado.processados?.toLocaleString('pt-BR')}</strong> imóveis importados —
            {resultado.estados_ok?.length} estados OK{resultado.estados_erro?.length > 0 ? `, ${resultado.estados_erro.length} com erro` : ''}
          </div>
        )}
        {erroMsg && (
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#dc2626' }}>
            ⚠️ {erroMsg}
          </div>
        )}
        <button onClick={executarScraper} disabled={running}
          style={{ padding: '11px 24px', background: running ? '#94a3b8' : '#c2410c', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: running ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          {running ? '⏳ Buscando imóveis...' : '🔄 Buscar imóveis Caixa'}
        </button>
        <p style={{ margin: '10px 0 0', fontSize: 11, color: '#94a3b8' }}>
          Pode levar até 60 segundos. Cobre todos os 27 estados.
        </p>
      </div>

      <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 12, padding: '16px 18px', fontSize: 13, color: '#64748b' }}>
        <strong style={{ color: '#475569' }}>Próximos scrapers previstos:</strong> Santander · Biassi · Zuk · MGL · HastaPública · TopLeilões · eLeilões
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SDR TAB
// ═══════════════════════════════════════════════════════════════════════════════
const STATUS_COLORS = {
  novo: '#f59e0b',
  contatado: '#3b82f6',
  qualificado: '#8b5cf6',
  convertido: '#10b981',
  perdido: '#94a3b8',
};
const STATUS_LIST = ['novo', 'contatado', 'qualificado', 'convertido', 'perdido'];

function defaultProdutoSDR() {
  return { nome: '', descricao: '', tipo: 'ebook', conteudo_url: '', imagem_url: '' };
}

function SdrTab() {
  const [produtos, setProdutos] = useState([]);
  const [leads, setLeads] = useState([]);
  const [loadingP, setLoadingP] = useState(true);
  const [loadingL, setLoadingL] = useState(true);
  const [modalProduto, setModalProduto] = useState(null); // null=closed, {}=new/edit
  const [saving, setSaving] = useState(false);
  const [filterProduto, setFilterProduto] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [copiado, setCopiado] = useState('');

  async function loadProdutos() {
    setLoadingP(true);
    const { data } = await supabase.from('sdr_produtos').select('*').order('criado_em', { ascending: false });
    setProdutos(data || []);
    setLoadingP(false);
  }

  async function loadLeads() {
    setLoadingL(true);
    const { data } = await supabase.from('sdr_leads').select('*, sdr_produtos(nome)').order('criado_em', { ascending: false });
    setLeads(data || []);
    setLoadingL(false);
  }

  useEffect(() => { loadProdutos(); loadLeads(); }, []);

  async function saveProduto() {
    setSaving(true);
    const { id, ...fields } = modalProduto;
    if (id) {
      await supabase.from('sdr_produtos').update(fields).eq('id', id);
    } else {
      await supabase.from('sdr_produtos').insert(fields);
    }
    setSaving(false);
    setModalProduto(null);
    loadProdutos();
  }

  async function toggleAtivo(prod) {
    await supabase.from('sdr_produtos').update({ ativo: !prod.ativo }).eq('id', prod.id);
    loadProdutos();
  }

  async function deleteProduto(id) {
    if (!window.confirm('Excluir produto? Os leads associados serão mantidos.')) return;
    await supabase.from('sdr_produtos').delete().eq('id', id);
    loadProdutos();
  }

  async function updateLeadStatus(leadId, status) {
    await supabase.from('sdr_leads').update({ status }).eq('id', leadId);
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l));
  }

  function copyLink(prodId) {
    const link = `${window.location.origin}/#/p/captura/${prodId}`;
    navigator.clipboard.writeText(link);
    setCopiado(prodId);
    setTimeout(() => setCopiado(''), 1800);
  }

  function exportCSV() {
    const filtered = leads.filter(l =>
      (!filterProduto || l.produto_id === filterProduto) &&
      (!filterStatus || l.status === filterStatus)
    );
    const header = ['Nome', 'WhatsApp', 'Email', 'Produto', 'Status', 'Data'];
    const rows = filtered.map(l => [
      l.nome, l.whatsapp, l.email || '', l.sdr_produtos?.nome || '', l.status,
      new Date(l.criado_em).toLocaleDateString('pt-BR'),
    ]);
    const csv = [header, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'leads_sdr.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  const statusCounts = STATUS_LIST.reduce((acc, s) => ({ ...acc, [s]: leads.filter(l => l.status === s).length }), {});
  const filteredLeads = leads.filter(l =>
    (!filterProduto || l.produto_id === filterProduto) &&
    (!filterStatus || l.status === filterStatus)
  );

  return (
    <div>
      {/* Status badges */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        {STATUS_LIST.map(s => (
          <div key={s} style={{ background: '#fff', border: `2px solid ${STATUS_COLORS[s]}`, borderRadius: 10, padding: '8px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: STATUS_COLORS[s] }}>{statusCounts[s]}</span>
            <span style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize', marginTop: 2 }}>{s}</span>
          </div>
        ))}
      </div>

      {/* Produtos section */}
      <div style={{ ...S.card, borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={S.sectionTitle}>Produtos de Captura</div>
          <button style={S.btn('primary')} onClick={() => setModalProduto(defaultProdutoSDR())}>+ Novo Produto</button>
        </div>
        {loadingP ? <p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</p> : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Nome</th>
                <th style={S.th}>Tipo</th>
                <th style={S.th}>Ativo</th>
                <th style={S.th}>Link de Compartilhamento</th>
                <th style={S.th}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map(p => (
                <tr key={p.id}>
                  <td style={S.td}>{p.nome}</td>
                  <td style={S.td}><span style={{ background: '#f1f5f9', borderRadius: 6, padding: '2px 8px', fontSize: 12 }}>{p.tipo}</span></td>
                  <td style={S.td}>
                    <button onClick={() => toggleAtivo(p)} style={{ ...S.badge(p.ativo), cursor: 'pointer', border: 'none' }}>
                      {p.ativo ? 'Ativo' : 'Inativo'}
                    </button>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: '#64748b', fontFamily: 'monospace', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {window.location.origin}/#/p/captura/{p.id}
                      </span>
                      <button onClick={() => copyLink(p.id)} style={{ ...S.btn('outline'), fontSize: 12, padding: '4px 10px' }}>
                        {copiado === p.id ? 'Copiado!' : 'Copiar'}
                      </button>
                    </div>
                  </td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button style={{ ...S.btn('outline'), fontSize: 12 }} onClick={() => setModalProduto({ ...p })}>Editar</button>
                      <button style={{ ...S.btn('danger'), fontSize: 12 }} onClick={() => deleteProduto(p.id)}>Excluir</button>
                    </div>
                  </td>
                </tr>
              ))}
              {produtos.length === 0 && (
                <tr><td colSpan={5} style={{ ...S.td, color: '#94a3b8', textAlign: 'center', padding: 24 }}>Nenhum produto cadastrado.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Leads section */}
      <div style={{ ...S.card, borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={S.sectionTitle}>Leads Capturados</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={filterProduto} onChange={e => setFilterProduto(e.target.value)}
              style={{ ...S.input, width: 'auto', fontSize: 13 }}>
              <option value="">Todos os produtos</option>
              {produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ ...S.input, width: 'auto', fontSize: 13 }}>
              <option value="">Todos os status</option>
              {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button style={S.btn('outline')} onClick={exportCSV}>⬇ Exportar CSV</button>
          </div>
        </div>
        {loadingL ? <p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</p> : (
          <table style={S.table}>
            <thead>
              <tr>
                <th style={S.th}>Nome</th>
                <th style={S.th}>WhatsApp</th>
                <th style={S.th}>Email</th>
                <th style={S.th}>Produto</th>
                <th style={S.th}>Status</th>
                <th style={S.th}>Data</th>
              </tr>
            </thead>
            <tbody>
              {filteredLeads.map(l => (
                <tr key={l.id}>
                  <td style={S.td}>{l.nome}</td>
                  <td style={S.td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>{l.whatsapp}</span>
                      <a href={`https://wa.me/55${l.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, background: '#dcfce7', color: '#166534', borderRadius: 6, padding: '2px 6px', textDecoration: 'none', fontWeight: 600 }}>WA</a>
                    </div>
                  </td>
                  <td style={S.td}>{l.email || '—'}</td>
                  <td style={S.td}>{l.sdr_produtos?.nome || '—'}</td>
                  <td style={S.td}>
                    <select value={l.status} onChange={e => updateLeadStatus(l.id, e.target.value)}
                      style={{ background: STATUS_COLORS[l.status] + '22', color: STATUS_COLORS[l.status], border: `1px solid ${STATUS_COLORS[l.status]}`, borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none' }}>
                      {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td style={S.td}>{new Date(l.criado_em).toLocaleDateString('pt-BR')}</td>
                </tr>
              ))}
              {filteredLeads.length === 0 && (
                <tr><td colSpan={6} style={{ ...S.td, color: '#94a3b8', textAlign: 'center', padding: 24 }}>Nenhum lead encontrado.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal de produto */}
      {modalProduto && (
        <div style={S.overlay} onClick={() => setModalProduto(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>{modalProduto.id ? 'Editar Produto' : 'Novo Produto'}</div>
            <div style={S.row}>
              <div style={S.col}>
                <label style={S.label}>Nome *</label>
                <input style={S.input} value={modalProduto.nome} onChange={e => setModalProduto(m => ({ ...m, nome: e.target.value }))} placeholder="Nome do produto" />
              </div>
              <div style={{ width: 140 }}>
                <label style={S.label}>Tipo</label>
                <select style={S.input} value={modalProduto.tipo} onChange={e => setModalProduto(m => ({ ...m, tipo: e.target.value }))}>
                  <option value="ebook">eBook</option>
                  <option value="minicurso">Mini-curso</option>
                  <option value="webinar">Webinar</option>
                  <option value="outro">Outro</option>
                </select>
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Descrição</label>
              <textarea style={{ ...S.input, height: 72, resize: 'vertical' }} value={modalProduto.descricao || ''} onChange={e => setModalProduto(m => ({ ...m, descricao: e.target.value }))} placeholder="Descrição breve do produto" />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>Link do Conteúdo (URL do ebook, vídeo etc)</label>
              <input style={S.input} value={modalProduto.conteudo_url || ''} onChange={e => setModalProduto(m => ({ ...m, conteudo_url: e.target.value }))} placeholder="https://..." />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={S.label}>URL da Imagem (opcional)</label>
              <input style={S.input} value={modalProduto.imagem_url || ''} onChange={e => setModalProduto(m => ({ ...m, imagem_url: e.target.value }))} placeholder="https://..." />
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button style={S.btn('outline')} onClick={() => setModalProduto(null)}>Cancelar</button>
              <button style={S.btn('primary')} onClick={saveProduto} disabled={saving || !modalProduto.nome.trim()}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPE TAB
// ═══════════════════════════════════════════════════════════════════════════════
const ROLE_BADGE_COLORS = {
  admin: { bg: '#fef3c7', color: '#92400e' },
  analista: { bg: '#dbeafe', color: '#1e40af' },
  consultor: { bg: '#d1fae5', color: '#065f46' },
  advogado: { bg: '#ede9fe', color: '#5b21b6' },
};

function EquipeTab() {
  const [membros, setMembros] = useState([]);
  const [chamadosMap, setChamadosMap] = useState({});
  const [finalizadosHoje, setFinalizadosHoje] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data: perfisData } = await supabase
        .from('perfis')
        .select('*')
        .in('role', ['admin', 'analista', 'consultor', 'advogado']);
      const membrosData = perfisData || [];
      setMembros(membrosData);

      // chamados por membro
      if (membrosData.length > 0) {
        const ids = membrosData.map(m => m.id);
        const { data: chamados } = await supabase
          .from('chamados')
          .select('atendente_id, status')
          .in('atendente_id', ids);
        const map = {};
        ids.forEach(id => { map[id] = { total: 0, finalizados: 0 }; });
        (chamados || []).forEach(c => {
          if (map[c.atendente_id]) {
            map[c.atendente_id].total++;
            if (c.status === 'finalizado') map[c.atendente_id].finalizados++;
          }
        });
        setChamadosMap(map);

        // finalizados hoje
        const hoje = new Date().toISOString().slice(0, 10);
        const { count } = await supabase
          .from('chamados')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'finalizado')
          .gte('updated_at', hoje);
        setFinalizadosHoje(count || 0);
      }
      setLoading(false);
    }
    load();
  }, []);

  const totalEquipe = membros.length;
  const analistas = membros.filter(m => m.role === 'analista').length;
  const consultores = membros.filter(m => m.role === 'consultor').length;

  if (loading) return <p style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</p>;

  return (
    <div>
      {/* Cards overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        {[
          { label: 'Total Equipe', value: totalEquipe, color: '#0f172a' },
          { label: 'Analistas Ativos', value: analistas, color: '#3b82f6' },
          { label: 'Consultores Ativos', value: consultores, color: '#059669' },
          { label: 'Finalizados Hoje', value: finalizadosHoje, color: '#f59e0b' },
        ].map(c => (
          <div key={c.label} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: '20px 24px' }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: c.color }}>{c.value}</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* Staff table */}
      <div style={{ ...S.card, borderRadius: 16 }}>
        <div style={S.sectionTitle}>Membros da Equipe</div>
        <table style={S.table}>
          <thead>
            <tr>
              <th style={S.th}>Membro</th>
              <th style={S.th}>Role</th>
              <th style={S.th}>Chamados Assumidos</th>
              <th style={S.th}>Chamados Finalizados</th>
              <th style={S.th}>Último Acesso</th>
            </tr>
          </thead>
          <tbody>
            {membros.map(m => {
              const stats = chamadosMap[m.id] || { total: 0, finalizados: 0 };
              const roleStyle = ROLE_BADGE_COLORS[m.role] || { bg: '#f1f5f9', color: '#475569' };
              return (
                <tr key={m.id}>
                  <td style={S.td}>
                    <div style={{ fontWeight: 600 }}>{m.nome || m.name || '—'}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{m.email || ''}</div>
                  </td>
                  <td style={S.td}>
                    <span style={{ background: roleStyle.bg, color: roleStyle.color, borderRadius: 8, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>
                      {m.role}
                    </span>
                  </td>
                  <td style={S.td}>{stats.total}</td>
                  <td style={S.td}>{stats.finalizados}</td>
                  <td style={{ ...S.td, color: '#64748b', fontSize: 13 }}>
                    {m.ultimo_acesso ? new Date(m.ultimo_acesso).toLocaleDateString('pt-BR') : 'N/D'}
                  </td>
                </tr>
              );
            })}
            {membros.length === 0 && (
              <tr><td colSpan={5} style={{ ...S.td, color: '#94a3b8', textAlign: 'center', padding: 24 }}>Nenhum membro encontrado.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const TABS = ['Dashboard', 'Cursos', 'eBooks', 'Contratos', 'Promoções', 'Convites', 'Usuários', 'SDR / Leads', 'Equipe', 'Scrapers', 'Configurações'];

export default function Admin() {
  const { role, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState('Dashboard');

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

        {tab === 'Dashboard'      && <DashboardTab />}
        {tab === 'Cursos'         && <CursosTab />}
        {tab === 'eBooks'         && <EbooksTab />}
        {tab === 'Contratos'      && <ContratosTab />}
        {tab === 'Promoções'      && <PromoTab />}
        {tab === 'Convites'       && <ConvitesTab />}
        {tab === 'Usuários'       && <UsuariosTab />}
        {tab === 'SDR / Leads'    && <SdrTab />}
        {tab === 'Equipe'         && <EquipeTab />}
        {tab === 'Tour'           && <TourTab />}
        {tab === 'Scrapers'       && <ScrapersTab />}
        {tab === 'Configurações'  && <ConfigTab />}
      </div>
    </div>
  );
}
