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
// Máscara R$ — usa centavos internamente, exibe formatado
function maskBRL(raw) {
  const digits = String(raw).replace(/\D/g, '').replace(/^0+/, '') || '0';
  const cents = digits.padStart(3, '0');
  const reais = cents.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${reais},${cents.slice(-2)}`;
}
function parseBRL(masked) {
  return parseFloat(String(masked).replace(/[R$\s.]/g, '').replace(',', '.')) || 0;
}
function InputBRL({ value, onChange, disabled, placeholder, style }) {
  const display = value === '' || value == null ? '' : maskBRL(Math.round(Number(value) * 100));
  return (
    <input
      type="text"
      inputMode="numeric"
      disabled={disabled}
      placeholder={placeholder || 'R$ 0,00'}
      style={style}
      value={display}
      onChange={e => {
        const digits = e.target.value.replace(/\D/g, '');
        const num = digits ? parseFloat((parseInt(digits, 10) / 100).toFixed(2)) : '';
        onChange(num);
      }}
    />
  );
}

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
                <InputBRL style={S.input} value={form.preco} disabled={form.gratuito} onChange={v => setForm({ ...form, preco: v })} />
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
              <InputBRL style={S.input} value={form.preco ?? ''} onChange={v => setForm({ ...form, preco: v })} />
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
                  <InputBRL value={p.preco} onChange={v => updatePlano(p.plano_key, 'preco', v)}
                    style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: '100%' }} />
                </div>
                <div>
                  <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3 }}>R$ (opcional)</div>
                  <InputBRL value={p.preco_vista ?? ''} onChange={v => updatePlano(p.plano_key, 'preco_vista', v || null)}
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

  const [kycIncluido, setKycIncluido] = useState(false);
  const [kycFotos, setKycFotos] = useState({ selfie_rosto: null, doc_frente: null, selfie_doc: null });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('contratos_link').select('*, kyc_incluido, kyc_fotos').order('criado_em', { ascending: false });
    setContratosLink((data || []).filter(c => c.status !== 'cancelado'));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  function abrirModal() {
    setTitulo(''); setTipo('servico'); setDescricao('');
    setArquivos([]); setConteudo(''); setPerguntas([]); setRespostas({});
    setLinkGerado(''); setTemplateSelecionado(null);
    setKycIncluido(false); setKycFotos({ selfie_rosto: null, doc_frente: null, selfie_doc: null });
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
      kyc_incluido: kycIncluido,
      kyc_fotos: kycIncluido && (kycFotos.selfie_rosto || kycFotos.doc_frente || kycFotos.selfie_doc) ? kycFotos : null,
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

            {/* KYC fotos */}
            {detalhe.kyc_incluido && detalhe.kyc_fotos && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Documentação KYC</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['selfie_rosto','doc_frente','selfie_doc'].filter(k => detalhe.kyc_fotos[k]).map(k => (
                    <a key={k} href={detalhe.kyc_fotos[k]} target="_blank" rel="noopener noreferrer"
                      style={{ flex: 1, display: 'block' }}>
                      <img src={detalhe.kyc_fotos[k]} alt={k} style={{ width: '100%', height: 80, objectFit: 'cover', borderRadius: 8, border: '1px solid #e2e8f0' }} />
                    </a>
                  ))}
                </div>
              </div>
            )}

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

                {/* KYC — opcional */}
                <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: kycIncluido ? 14 : 0 }}>
                    <input type="checkbox" checked={kycIncluido} onChange={e => setKycIncluido(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#2563eb' }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Incluir documentação KYC ao final do contrato</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Selfie, documento e selfie com documento serão exibidos na última página</div>
                    </div>
                  </label>

                  {kycIncluido && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 12 }}>
                      {[
                        { key: 'selfie_rosto', label: '1. Selfie (rosto)', emoji: '🤳' },
                        { key: 'doc_frente', label: '2. Documento (frente)', emoji: '🪪' },
                        { key: 'selfie_doc', label: '3. Selfie + documento', emoji: '📋' },
                      ].map(({ key, label, emoji }) => (
                        <label key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', border: `2px dashed ${kycFotos[key] ? '#22c55e' : '#e2e8f0'}`, borderRadius: 10, cursor: 'pointer', background: kycFotos[key] ? '#f0fdf4' : '#f8fafc', transition: 'all 0.15s' }}>
                          {kycFotos[key] ? (
                            <img src={kycFotos[key]} alt={label} style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 6 }} />
                          ) : (
                            <>
                              <span style={{ fontSize: 24 }}>{emoji}</span>
                              <span style={{ fontSize: 11, color: '#64748b', textAlign: 'center', fontWeight: 600 }}>{label}</span>
                            </>
                          )}
                          <input type="file" accept="image/*" style={{ display: 'none' }}
                            onChange={e => {
                              const file = e.target.files[0];
                              if (!file) return;
                              const reader = new FileReader();
                              reader.onload = ev => setKycFotos(p => ({ ...p, [key]: ev.target.result }));
                              reader.readAsDataURL(file);
                            }} />
                        </label>
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
              <InputBRL value={form.desconto_valor} onChange={v => up('desconto_valor', v)} style={S.input} />
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

  useEffect(() => {
    supabase
      .from('scrapers_log')
      .select('*')
      .order('iniciado_em', { ascending: false })
      .limit(30)
      .then(({ data }) => { setLogs(data || []); setLoading(false); });
  }, []);

  // Último log por fonte
  const ultimoPorFonte = {};
  FONTES_SCRAPER.forEach(f => {
    ultimoPorFonte[f.key] = logs.find(l => l.fonte === f.key);
  });

  const erros = FONTES_SCRAPER.filter(f => ultimoPorFonte[f.key]?.status === 'erro');
  const semDados = FONTES_SCRAPER.filter(f => ultimoPorFonte[f.key]?.status === 'sem_dados');

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Monitor de Scrapers</div>
        {erros.length > 0 && (
          <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
            ⚠️ {erros.length} com erro
          </span>
        )}
      </div>
      {loading ? <p style={{ fontSize: 13, color: '#94a3b8' }}>Carregando...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FONTES_SCRAPER.map(f => {
            const log = ultimoPorFonte[f.key];
            const ok = log?.status === 'ok';
            const erro = log?.status === 'erro';
            const semDado = log?.status === 'sem_dados';
            const nunca = !log;
            const cor = ok ? '#10b981' : erro ? '#dc2626' : semDado ? '#d97706' : '#94a3b8';
            const bg = ok ? '#f0fdf4' : erro ? '#fef2f2' : semDado ? '#fefce8' : '#f8fafc';
            const icone = ok ? '✅' : erro ? '❌' : semDado ? '⚠️' : '⏸';
            return (
              <div key={f.key} style={{ padding: '10px 12px', background: bg, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: f.cor, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{f.label}</div>
                    {log && <div style={{ fontSize: 11, color: '#64748b' }}>
                      {log.imoveis_encontrados} imóveis · {new Date(log.iniciado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      {log.duracao_ms && ` · ${(log.duracao_ms / 1000).toFixed(1)}s`}
                    </div>}
                    {erro && log.erro_msg && <div style={{ fontSize: 11, color: '#dc2626', fontWeight: 600 }}>{log.erro_msg}</div>}
                    {nunca && <div style={{ fontSize: 11, color: '#94a3b8' }}>Nunca executado</div>}
                  </div>
                </div>
                <span style={{ fontSize: 16 }}>{icone}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DashboardTab() {
  const [dados, setDados] = useState(null);
  const [asaasDados, setAsaasDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [asaasLoading, setAsaasLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const [{ data: perfis }, { count: inadimCount }, { count: novosCount }, { data: dbSizeData }] = await Promise.all([
        supabase.from('perfis').select('role, plano, inadimplente_desde'),
        supabase.from('perfis').select('id', { count: 'exact', head: true }).not('inadimplente_desde', 'is', null),
        supabase.from('perfis').select('id', { count: 'exact', head: true })
          .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()),
        supabase.rpc('get_db_size_mb'),
      ]);

      const contagem = { admin: 0, explorador: 0, top1: 0, top2: 0, assessorado: 0, clube: 0, consultor: 0, analista: 0, advogado: 0 };
      (perfis || []).forEach(p => { if (p.role in contagem) contagem[p.role]++; });

      const mrr = (contagem.top1 * 49.90) + (contagem.top2 * 99.90) + (contagem.assessorado * 500) + (contagem.clube * 5000);
      const taxaPix = mrr * 0.01;
      const liquido = mrr - taxaPix;

      setDados({
        contagem,
        total: Object.values(contagem).reduce((s, v) => s + v, 0),
        mrr,
        taxaPix,
        liquido,
        inadimplentes: inadimCount || 0,
        novosMes: novosCount || 0,
        dbSizeMB: dbSizeData ?? null,
      });
      setLoading(false);
    }

    async function loadAsaas() {
      try {
        const res = await fetch('/api/asaas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'financas' }) });
        if (res.ok) setAsaasDados(await res.json());
      } catch (_) {}
      setAsaasLoading(false);
    }

    load();
    loadAsaas();
  }, []);

  function marcoAsaas(mrr) {
    if (mrr >= 100000) return { cor: '#7c3aed', label: 'Tier Enterprise', desc: 'Exigir conta dedicada e taxa máxima de 0,3% no PIX' };
    if (mrr >= 30000) return { cor: '#dc2626', label: 'Alto Volume', desc: 'Negociar taxa diferenciada — meta abaixo de 0,5%' };
    if (mrr >= 10000) return { cor: '#d97706', label: 'Volume Médio', desc: 'Contatar comercial Asaas — redução de 1% para ~0,7% no PIX é possível' };
    return { cor: '#10b981', label: 'Crescimento', desc: `Falta R$ ${Number(10000 - mrr).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MRR para negociar desconto de taxa com o Asaas` };
  }

  const fmt = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtN = (v) => Number(v).toLocaleString('pt-BR');

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Carregando dashboard…</div>;

  const marco = marcoAsaas(dados.mrr);
  const proximo = dados.mrr < 10000 ? 10000 : dados.mrr < 30000 ? 30000 : dados.mrr < 100000 ? 100000 : null;
  const progresso = proximo ? Math.min(100, (dados.mrr / proximo) * 100) : 100;

  const statCard = (label, value, sub, cor = '#2563eb') => (
    <div style={{ background: '#0f172a', borderRadius: 12, padding: '20px 22px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: cor, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#0f172a', margin: 0 }}>Dashboard</h2>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>Atualizado agora · {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {statCard('Total usuários', fmtN(dados.total), `+${dados.novosMes} este mês`, '#60a5fa')}
        {statCard('MRR estimado', `R$ ${fmt(dados.mrr)}`, 'Receita mensal recorrente', '#10b981')}
        {statCard('Taxas Asaas (est.)', `R$ ${fmt(dados.taxaPix)}`, '~1% PIX sobre MRR', '#f59e0b')}
        {statCard('Líquido estimado', `R$ ${fmt(dados.liquido)}`, 'MRR − taxas estimadas', '#a78bfa')}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Coluna esquerda: Usuários por plano */}
        <div>
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 16 }}>Usuários por plano</div>
            {[
              { key: 'explorador', label: 'Explorador (Grátis)', cor: '#64748b', preco: 0 },
              { key: 'top1',       label: 'Investidor (R$49,90)',     cor: '#2563eb', preco: 49.90 },
              { key: 'top2',       label: 'Investidor Pro (R$99,90)', cor: '#7c3aed', preco: 99.90 },
              { key: 'assessorado',label: 'Assessorado (R$500×12)', cor: '#d97706', preco: 500 },
              { key: 'clube',      label: 'Clube de Negócios (R$5k/mês)', cor: '#059669', preco: 5000 },
            ].map(({ key, label, cor, preco }) => {
              const qtd = dados.contagem[key] || 0;
              const receita = qtd * preco;
              return (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: cor }} />
                    <span style={{ fontSize: 13, color: '#374151' }}>{label}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>{qtd}</div>
                    {preco > 0 && <div style={{ fontSize: 11, color: '#64748b' }}>R$ {fmt(receita)}/mês</div>}
                  </div>
                </div>
              );
            })}
            {dados.inadimplentes > 0 && (
              <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', borderRadius: 8, fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                ⚠️ {dados.inadimplentes} usuário{dados.inadimplentes > 1 ? 's' : ''} inadimplente{dados.inadimplentes > 1 ? 's' : ''}
              </div>
            )}
          </div>

          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 12 }}>Equipe interna</div>
            {[
              { key: 'consultor', label: 'Consultores', cor: '#0891b2' },
              { key: 'analista',  label: 'Analistas',   cor: '#f59e0b' },
              { key: 'advogado',  label: 'Advogados',   cor: '#dc2626' },
              { key: 'admin',     label: 'Admins',      cor: '#7c3aed' },
            ].map(({ key, label, cor }) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cor }} />
                  <span style={{ fontSize: 13, color: '#374151' }}>{label}</span>
                </div>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{dados.contagem[key] || 0}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Coluna direita: Taxas Asaas + Marco + Infraestrutura */}
        <div>
          {/* Taxas Asaas reais */}
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 12 }}>Financeiro Asaas — mês atual</div>
            {asaasLoading ? (
              <p style={{ color: '#94a3b8', fontSize: 13 }}>Carregando dados do Asaas…</p>
            ) : asaasDados ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  {[
                    { label: 'Saldo disponível', value: `R$ ${fmt(asaasDados.balance?.balance || 0)}`, cor: '#10b981' },
                    { label: 'A receber', value: `R$ ${fmt(asaasDados.balance?.totalReceivable || 0)}`, cor: '#2563eb' },
                    { label: 'Recebido no mês', value: `R$ ${fmt(asaasDados.statsMes?.revenue || 0)}`, cor: '#7c3aed' },
                    { label: 'Taxas cobradas', value: `R$ ${fmt(asaasDados.statsMes?.fees || 0)}`, cor: '#f59e0b' },
                  ].map(({ label, value, cor }) => (
                    <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: cor }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right' }}>
                  Dados direto da API Asaas · atualizado agora
                </div>
              </>
            ) : (
              <p style={{ fontSize: 13, color: '#dc2626' }}>Não foi possível carregar dados do Asaas. Verifique a chave ASAAS_API_KEY.</p>
            )}
          </div>

          {/* Marco comercial */}
          <div style={{ ...S.card, border: `2px solid ${marco.cor}20` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a' }}>Marco Comercial Asaas</div>
              <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: marco.cor + '20', color: marco.cor }}>{marco.label}</span>
            </div>
            {proximo && (
              <>
                <div style={{ background: '#f1f5f9', borderRadius: 8, height: 10, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${progresso}%`, background: marco.cor, borderRadius: 8, transition: 'width 0.5s' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 12 }}>
                  <span>MRR atual: R$ {fmt(dados.mrr)}</span>
                  <span>Próximo marco: R$ {fmtN(proximo)}</span>
                </div>
              </>
            )}
            <div style={{ padding: '10px 12px', background: marco.cor + '10', borderRadius: 8, fontSize: 13, color: marco.cor, fontWeight: 600, lineHeight: 1.5 }}>
              📞 {marco.desc}
            </div>
          </div>

          {/* Monitor de Scrapers */}
          <ScrapersMonitor />

          {/* Infraestrutura */}
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 14 }}>Infraestrutura & Custos</div>

            {/* Supabase — DB size + usuários */}
            {(() => {
              const dbMB = dados.dbSizeMB ?? 0;
              const limiteFreeMB = 500;
              const limiteProMB = 8192;
              const pctFree = Math.min(100, (dbMB / limiteFreeMB) * 100);
              const planoAtivo = dados.total > 40000 || dbMB > 400 ? 'Pro' : 'Free';
              const alertaDB = dbMB > 400 || dados.total > 40000;
              const alertaUsuarios = dados.total > 40000;
              const corDB = dbMB > 400 ? '#dc2626' : dbMB > 300 ? '#d97706' : '#10b981';
              return (
                <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>Supabase (Banco de Dados)</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Plano {planoAtivo} · {fmtN(dados.total)} usuários de 50.000</div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: planoAtivo === 'Pro' ? '#d97706' : '#10b981' }}>
                      {planoAtivo === 'Pro' ? '~R$ 150/mês' : 'R$ 0/mês'}
                    </div>
                  </div>
                  {/* Barra de uso do banco */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginBottom: 3 }}>
                      <span>Armazenamento: {dados.dbSizeMB !== null ? `${dbMB.toFixed(1)} MB de 500 MB gratuitos` : 'Carregando…'}</span>
                      <span style={{ fontWeight: 700, color: corDB }}>{pctFree.toFixed(0)}%</span>
                    </div>
                    <div style={{ background: '#f1f5f9', borderRadius: 6, height: 7, overflow: 'hidden' }}>
                      <div style={{ width: `${pctFree}%`, height: '100%', background: corDB, borderRadius: 6, transition: 'width 0.6s' }} />
                    </div>
                  </div>
                  {/* Barra de usuários */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginBottom: 3 }}>
                      <span>Usuários ativos: {fmtN(dados.total)} de 50.000</span>
                      <span style={{ fontWeight: 700, color: alertaUsuarios ? '#dc2626' : '#10b981' }}>{((dados.total / 50000) * 100).toFixed(1)}%</span>
                    </div>
                    <div style={{ background: '#f1f5f9', borderRadius: 6, height: 7, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, (dados.total / 50000) * 100)}%`, height: '100%', background: alertaUsuarios ? '#dc2626' : '#10b981', borderRadius: 6, transition: 'width 0.6s' }} />
                    </div>
                  </div>
                  {alertaDB && (
                    <div style={{ marginTop: 8, padding: '7px 10px', background: '#fef3c7', borderRadius: 7, fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                      ⚠️ Banco próximo de 500 MB. Upgrade para Pro ($25/mês ≈ R$ 150) — 8 GB de espaço, backups diários automáticos.
                    </div>
                  )}
                  {alertaUsuarios && (
                    <div style={{ marginTop: 6, padding: '7px 10px', background: '#fef2f2', borderRadius: 7, fontSize: 11, color: '#991b1b', fontWeight: 600 }}>
                      🚨 Limite de usuários próximo. Faça upgrade antes de atingir 50.000.
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Egress (saída de dados) */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>Supabase — Banda de Saída (Egress)</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Limite gratuito: 5 GB/mês · Monitore no painel Supabase</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>Ver painel</div>
              </div>
              <div style={{ marginTop: 6, padding: '7px 10px', background: '#eff6ff', borderRadius: 7, fontSize: 11, color: '#1e40af', lineHeight: 1.5 }}>
                💡 Mantenha no Supabase apenas textos e lógica. Imagens, PDFs e vídeos devem ir para a Bunny.net — isso reduz drasticamente o egress e adia o upgrade.
              </div>
            </div>

            {/* Bunny.net */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>Bunny.net (Vídeos & Arquivos)</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>CDN + Storage · $0,01/GB armazenado · $0,005/GB transferido</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#10b981' }}>~R$ 1–5/mês</div>
              </div>
              <div style={{ marginTop: 5, fontSize: 11, color: '#64748b' }}>
                Com o volume atual o custo de IOF+spread do cartão é menor que R$ 2. Confirme no painel Bunny a fatura do mês.
              </div>
            </div>

            {/* Vercel */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>Vercel (Hosting + Edge Functions)</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Plano Free · 100 GB egress · Serverless ilimitado</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#10b981' }}>R$ 0/mês</div>
              </div>
            </div>

            {/* Anthropic */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>Anthropic — Laudos & KYC</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Pay-as-you-go · Haiku Vision por análise</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#10b981' }}>~R$ 0,08/doc</div>
              </div>
            </div>

            {/* Asaas */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#0f172a' }}>Asaas Gateway (PIX)</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>~1% por transação PIX</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: dados.mrr > 8000 ? '#d97706' : '#10b981' }}>R$ {fmt(dados.taxaPix)}/mês</div>
              </div>
              {dados.mrr > 8000 && <div style={{ marginTop: 6, fontSize: 11, color: '#d97706', fontWeight: 600 }}>⚠️ MRR acima de R$ 10k: contatar comercial Asaas para reduzir taxa para ~0,7%</div>}
            </div>

            {/* Total mensal */}
            {(() => {
              const totalMensal = (dados.dbSizeMB > 400 || dados.total > 40000 ? 150 : 0) + 3 + dados.taxaPix;
              const cor = totalMensal > 200 ? '#d97706' : '#10b981';
              return (
                <div style={{ marginTop: 14, padding: '12px 14px', background: '#0f172a', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Custo mensal estimado de infra</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: cor }}>R$ {fmt(totalMensal)}</div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Guia de Decisão de Plataforma */}
      {(() => {
        const dbMB = dados.dbSizeMB ?? 0;
        const plataformas = [
          {
            nome: 'Supabase', categoria: 'Banco de Dados & Auth',
            veredicto: 'MANTER',
            cor: '#10b981',
            icone: '🗄️',
            justificativa: 'É a escolha certa para o estágio atual. Oferece Postgres + Auth + RLS + Realtime + RPC em uma única plataforma. Migrar custaria semanas de desenvolvimento e quebraria a arquitetura atual sem ganho proporcional.',
            gatilhoTroca: 'DB > 8 GB no plano Pro OU MRR > R$ 80.000',
            atingiuGatilho: dbMB > 8192 || dados.mrr > 80000,
            alternativa: {
              nome: 'Neon (Serverless Postgres)',
              motivo: 'Postgres puro (mesma sintaxe, sem refatorar SQL), escala a zero, cobra só o que usa. A partir de $19/mês com performance superior ao Supabase Pro para cargas variáveis. Auth pode migrar para Clerk ($25/mês) ou continuar no Supabase Auth separado.',
              custo: '~$19–40/mês',
              url: 'neon.tech',
            },
          },
          {
            nome: 'Bunny.net', categoria: 'Vídeos & CDN',
            veredicto: 'MANTER',
            cor: '#10b981',
            icone: '🎥',
            justificativa: 'Melhor custo-benefício do mercado para vídeo + CDN com PoPs no Brasil. $0,005/GB entregue e armazenamento barato. O custo em dólar no cartão é centavos — o IOF é irrelevante frente à performance.',
            gatilhoTroca: 'Fatura Bunny > $50/mês OU necessidade de conformidade LGPD com dados em solo brasileiro',
            atingiuGatilho: false,
            alternativa: {
              nome: 'Cloudflare Stream + R2',
              motivo: 'Stream cobra $5/1.000 minutos armazenados + $1/1.000 minutos entregues. R2 (arquivos estáticos) tem egress zero. Ideal se já usa Cloudflare para DNS. Infraestrutura em solo BR via PoPs globais com latência excelente.',
              custo: '~$10–30/mês',
              url: 'cloudflare.com/developer-platform',
            },
          },
          {
            nome: 'Vercel', categoria: 'Hosting & Edge Functions',
            veredicto: 'MANTER',
            cor: '#10b981',
            icone: '⚡',
            justificativa: 'Plano gratuito cobre o estágio atual com folga. Deploy automático do Git, Edge Functions globais e preview por PR sem configuração adicional. Não há alternativa com melhor custo zero.',
            gatilhoTroca: 'Edge Functions > 500k invocações/mês OU necessidade de servidor persistente (WebSockets)',
            atingiuGatilho: false,
            alternativa: {
              nome: 'Railway',
              motivo: 'Suporte a servidores Node.js persistentes (útil para WebSockets e filas). Cobra por uso de CPU/RAM. Plano Starter: $5/mês. Ideal se precisar de processos background (fila de laudos, WebSockets em tempo real).',
              custo: '$5–20/mês',
              url: 'railway.app',
            },
          },
          {
            nome: 'Asaas', categoria: 'Gateway de Pagamento',
            veredicto: dados.mrr >= 5000 ? 'PLANEJAR MIGRAÇÃO' : 'MANTER (temporário)',
            cor: dados.mrr >= 5000 ? '#dc2626' : '#d97706',
            icone: '💳',
            justificativa: 'O modelo de consultores vendendo planos, cursos, ebooks e assessorias exige split automático por venda com múltiplos recebedores (subconta por consultor). O Asaas tem split básico, mas não foi projetado para marketplace com recorrência + avulso simultâneos. A migração deve ser planejada antes de ativar a rede de consultores em escala.',
            gatilhoTroca: 'Antes de ativar consultores vendendo em escala (independente do MRR)',
            atingiuGatilho: dados.mrr >= 5000,
            alternativa: {
              nome: 'Pagar.me (Stone Group) — Marketplace nativo',
              motivo: 'Líder BR para modelo marketplace com split. Cada consultor ganha uma subconta automática; o split por venda (% TSN + % consultor) é configurado por transação. Suporta recorrência (planos) e avulso (cursos, ebooks, assessoria) no mesmo contrato. PIX ~0,99%, cartão ~2,99%, BRL nativo, sem dólar. API REST moderna com webhooks e relatório de repasses por recebedor. — Cielo: válida para grandes varejistas com POS físico e faturamento >R$500k/mês (taxas negociadas), mas foco enterprise com API mais antiga e complexidade extra sem ganho para SaaS online. — EFÍ: menor taxa PIX (0,3%) mas split menos maduro para marketplace multi-produto. — Stripe: descartado (PIX a 2,9% + USD).',
              custo: '0,99% PIX · 2,99% cartão · BRL',
              url: 'pagar.me',
            },
          },
          {
            nome: 'Anthropic (Claude)', categoria: 'Laudos & Visão IA',
            veredicto: 'MANTER',
            cor: '#10b981',
            icone: '🤖',
            justificativa: 'Melhor modelo de visão do mercado para extração de documentos e laudos em português. O custo de ~R$ 0,08/doc é competitivo e o resultado é superior ao dos concorrentes para este caso de uso.',
            gatilhoTroca: 'Volume > 10.000 laudos/mês (custo > R$ 800/mês)',
            atingiuGatilho: false,
            alternativa: {
              nome: 'Google Gemini Flash 2.0',
              motivo: 'Alternativa de menor custo para volume alto. Flash 2.0 tem visão excelente, processa PDFs nativamente e custa ~60% menos que o Haiku para prompts longos. Mantém a mesma API REST. Troca seria pontual no código.',
              custo: '~R$ 0,03/doc',
              url: 'ai.google.dev',
            },
          },
        ];
        return (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
              🧭 Guia de Decisão de Plataforma
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Análise atual de cada serviço: manter ou substituir, e qual seria a melhor alternativa se precisar trocar.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {plataformas.map((p) => (
                <div key={p.nome} style={{ background: 'white', borderRadius: 12, border: `1.5px solid ${p.atingiuGatilho ? '#f59e0b' : p.cor}30`, overflow: 'hidden' }}>
                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: p.atingiuGatilho ? '#fefce8' : p.cor === '#10b981' ? '#f0fdf4' : '#fff7ed', borderBottom: '1px solid #f1f5f9' }}>
                    <span style={{ fontSize: 22 }}>{p.icone}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>{p.nome}</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>{p.categoria}</div>
                    </div>
                    <span style={{ padding: '4px 12px', borderRadius: 20, fontSize: 11, fontWeight: 800, background: p.cor, color: 'white', letterSpacing: 0.5 }}>
                      {p.veredicto}
                    </span>
                  </div>
                  {/* Body */}
                  <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.6 }}>{p.justificativa}</div>
                    {/* Gatilho de troca */}
                    <div style={{ padding: '8px 10px', background: p.atingiuGatilho ? '#fef3c7' : '#f8fafc', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 13 }}>{p.atingiuGatilho ? '🔔' : '⏳'}</span>
                      <div>
                        <div style={{ fontSize: 10, fontWeight: 800, color: p.atingiuGatilho ? '#92400e' : '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 }}>
                          {p.atingiuGatilho ? 'GATILHO ATINGIDO' : 'Gatilho para reavaliar'}
                        </div>
                        <div style={{ fontSize: 12, color: p.atingiuGatilho ? '#92400e' : '#64748b' }}>{p.gatilhoTroca}</div>
                      </div>
                    </div>
                    {/* Alternativa */}
                    <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0' }}>
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                        Melhor substituta se precisar trocar
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 5 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#0f172a' }}>{p.alternativa.nome}</div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', background: '#eff6ff', padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{p.alternativa.custo}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>{p.alternativa.motivo}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Marcos de melhoria e sugestões de eficiência */}
      <div style={{ marginTop: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          🗺️ Marcos de Melhoria & Eficiência
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>— ações a executar quando os gatilhos forem atingidos</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            {
              gatilho: 'Antes de escalar rede de consultores',
              atingido: dados.mrr >= 5000,
              titulo: 'Migrar gateway para Pagar.me (marketplace)',
              desc: 'O modelo de consultores vendendo planos, cursos e assessorias exige split automático por venda com subconta por consultor. Pagar.me é o líder BR para isso: split % por transação, recorrência + avulso, relatório de repasse por recebedor. PIX 0,99%, cartão 2,99%, BRL. Planeje a migração antes de ativar vendas em escala — a integração leva ~2 semanas de desenvolvimento.',
              cor: '#d97706', icone: '💳',
            },
            {
              gatilho: `DB > 400 MB ou > 40k usuários`,
              atingido: (dados.dbSizeMB ?? 0) > 400 || dados.total > 40000,
              titulo: 'Upgrade Supabase para o plano Pro',
              desc: `Custo: $25/mês (~R$ 150). Você ganha 8 GB de banco (16× mais), backups diários automáticos e 100 GB egress. O tempo economizado em DevOps vale muito mais que R$ 150/mês.`,
              cor: '#7c3aed', icone: '🗄️',
            },
            {
              gatilho: `MRR ≥ R$ 30.000`,
              atingido: dados.mrr >= 30000,
              titulo: 'Avaliar RDS AWS São Paulo (sa-east-1)',
              desc: 'Com volume alto, avaliar migração para AWS São Paulo para melhor latência e SLA 99,99%. Custo estimado: ~$50–80/mês com suporte nativo em BRL via parceiro AWS.',
              cor: '#6366f1', icone: '🏗️',
            },
            {
              gatilho: `MRR ≥ R$ 50.000`,
              atingido: dados.mrr >= 50000,
              titulo: 'Ativar CDN e cache de relatórios',
              desc: 'Implementar cache de PDFs e imagens via Cloudflare R2 (S3 compatível) para reduzir latência dos laudos e custo de storage.',
              cor: '#0891b2', icone: '⚡',
            },
            {
              gatilho: `MRR ≥ R$ 100.000`,
              atingido: dados.mrr >= 100000,
              titulo: 'Infraestrutura dedicada + SLA',
              desc: 'Contratar plano Enterprise Asaas (<0,3% PIX), mover para ECS Fargate ou EC2 dedicado, implementar monitoramento com Datadog/New Relic.',
              cor: '#dc2626', icone: '🏢',
            },
            {
              gatilho: '> 500 análises/mês',
              atingido: false,
              titulo: 'Fila assíncrona para relatórios',
              desc: 'Implementar processamento de laudos em background (SQS ou Supabase Edge Functions) para evitar timeout nas funções serverless do Vercel.',
              cor: '#059669', icone: '🔄',
            },
            {
              gatilho: '> 50 contratos/mês',
              atingido: false,
              titulo: 'Assinatura digital via ICP-Brasil',
              desc: 'Integrar com DocuSign ou ClickSign para validade jurídica reforçada com certificado digital. Custo: ~R$ 2-5/assinatura.',
              cor: '#6366f1', icone: '📝',
            },
          ].map((m, i) => (
            <div key={i} style={{ display: 'flex', gap: 14, padding: '14px 16px', borderRadius: 12, border: `1px solid ${m.cor}30`, background: m.atingido ? m.cor + '08' : 'white', alignItems: 'flex-start' }}>
              <div style={{ fontSize: 24, flexShrink: 0 }}>{m.icone}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 800, fontSize: 14, color: '#0f172a' }}>{m.titulo}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: m.atingido ? m.cor : '#f1f5f9', color: m.atingido ? 'white' : '#64748b' }}>
                    {m.atingido ? '✅ Gatilho atingido!' : `Gatilho: ${m.gatilho}`}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>{m.desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* ── Quadro de Configurações & Pendências ─────────────────────────────── */}
      <SystemStatusCard />
    </div>
  );
}

function SystemStatusCard() {
  const [status, setStatus] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    fetch('/api/system-status').then(r => r.json()).then(d => { setStatus(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  const GRUPOS = {
    geral:  { label: 'Geral', items: ['baseUrl', 'cron'] },
    email:  { label: 'Alertas por Email', items: ['email', 'from'] },
    banco:  { label: 'Banco de Dados', items: ['svcKey'] },
    ads:    { label: 'Anúncios', items: ['googleAds', 'meta'] },
  };
  const DOMINIO_PENDENTE = [
    { label: 'Definir nome e domínio da plataforma', desc: 'Necessário para email remetente e URL pública.' },
    { label: 'Verificar domínio no Resend', desc: 'Adicionar registros DNS após definir o domínio.' },
    { label: 'APP_FROM_EMAIL no Vercel', desc: 'Ex: "TSN Ativos <alertas@seudominio.com.br>"' },
    { label: 'APP_BASE_URL no Vercel', desc: 'Ex: "https://seudominio.com.br"' },
  ];
  const totalOk = status ? Object.values(status).filter(v => v.ok).length : 0;
  const total = status ? Object.values(status).length : 0;
  const saude = total > 0 ? Math.round(totalOk / total * 100) : 0;
  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 24, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>Configurações & Saúde do Sistema</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Variáveis de ambiente e integrações pendentes</div>
        </div>
        {!loading && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 900, color: saude >= 80 ? '#059669' : saude >= 50 ? '#f59e0b' : '#dc2626' }}>{saude}%</div><div style={{ fontSize: 11, color: '#94a3b8' }}>configurado</div></div>}
      </div>
      {loading ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Verificando…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 20 }}>
          {Object.entries(GRUPOS).map(([key, grupo]) => (
            <div key={key} style={{ border: '1px solid #f1f5f9', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>{grupo.label}</div>
              {grupo.items.map(itemKey => { const item = status?.[itemKey]; if (!item) return null; return (
                <div key={itemKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: item.ok ? '#dcfce7' : '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0, fontWeight: 700, color: item.ok ? '#166534' : '#dc2626' }}>{item.ok ? '✓' : '✗'}</div>
                  <span style={{ fontSize: 13, color: item.ok ? '#0f172a' : '#94a3b8', flex: 1 }}>{item.label}</span>
                  {!item.ok && <span style={{ fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 6, padding: '1px 6px', fontWeight: 700 }}>Pendente</span>}
                </div>
              ); })}
            </div>
          ))}
        </div>
      )}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>⏳ Aguardando definição do domínio</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
          {DOMINIO_PENDENTE.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#fffbeb', borderRadius: 10, border: '1px solid #fde68a' }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>📋</span>
              <div><div style={{ fontSize: 13, fontWeight: 600, color: '#92400e' }}>{item.label}</div><div style={{ fontSize: 11, color: '#b45309', marginTop: 2, lineHeight: 1.4 }}>{item.desc}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>🔮 Integrações futuras</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['Google Ads','GOOGLE_ADS_*'],['Meta Ads','META_ACCESS_TOKEN'],['RI Digital','RI_DIGITAL_KEY']].map(([nome, env]) => (
            <div key={nome} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#e2e8f0' }} />
              <div><div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{nome}</div><div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>{env}</div></div>
            </div>
          ))}
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
// ═══════════════════════════════════════════════════════════════════════════════
// SDR TAB
// ═══════════════════════════════════════════════════════════════════════════════
const STATUS_COLORS = { novo: '#f59e0b', contatado: '#3b82f6', qualificado: '#8b5cf6', convertido: '#10b981', perdido: '#94a3b8' };
const STATUS_LIST = ['novo', 'contatado', 'qualificado', 'convertido', 'perdido'];
function defaultProdutoSDR() { return { nome: '', descricao: '', tipo: 'ebook', conteudo_url: '', imagem_url: '' }; }

function SdrTab() {
  const [produtos, setProdutos] = useState([]);
  const [leads, setLeads] = useState([]);
  const [loadingP, setLoadingP] = useState(true);
  const [loadingL, setLoadingL] = useState(true);
  const [modalProduto, setModalProduto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filterProduto, setFilterProduto] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [copiado, setCopiado] = useState('');

  async function loadProdutos() { setLoadingP(true); const { data } = await supabase.from('sdr_produtos').select('*').order('criado_em', { ascending: false }); setProdutos(data || []); setLoadingP(false); }
  async function loadLeads() { setLoadingL(true); const { data } = await supabase.from('sdr_leads').select('*, sdr_produtos(nome)').order('criado_em', { ascending: false }); setLeads(data || []); setLoadingL(false); }
  useEffect(() => { loadProdutos(); loadLeads(); }, []);

  async function saveProduto() {
    setSaving(true);
    const { id, ...fields } = modalProduto;
    if (id) { await supabase.from('sdr_produtos').update(fields).eq('id', id); } else { await supabase.from('sdr_produtos').insert(fields); }
    setSaving(false); setModalProduto(null); loadProdutos();
  }
  async function toggleAtivo(prod) { await supabase.from('sdr_produtos').update({ ativo: !prod.ativo }).eq('id', prod.id); loadProdutos(); }
  async function deleteProduto(id) { if (!window.confirm('Excluir produto?')) return; await supabase.from('sdr_produtos').delete().eq('id', id); loadProdutos(); }
  async function updateLeadStatus(leadId, status) { await supabase.from('sdr_leads').update({ status }).eq('id', leadId); setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status } : l)); }
  function copyLink(prodId) { navigator.clipboard.writeText(`${window.location.origin}/#/p/captura/${prodId}`); setCopiado(prodId); setTimeout(() => setCopiado(''), 1800); }
  function exportCSV() {
    const filtered = leads.filter(l => (!filterProduto || l.produto_id === filterProduto) && (!filterStatus || l.status === filterStatus));
    const rows = [['Nome','WhatsApp','Email','Produto','Status','Data'], ...filtered.map(l => [l.nome, l.whatsapp, l.email||'', l.sdr_produtos?.nome||'', l.status, new Date(l.criado_em).toLocaleDateString('pt-BR')])];
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'leads_sdr.csv'; a.click();
  }
  const statusCounts = STATUS_LIST.reduce((acc, s) => ({ ...acc, [s]: leads.filter(l => l.status === s).length }), {});
  const filteredLeads = leads.filter(l => (!filterProduto || l.produto_id === filterProduto) && (!filterStatus || l.status === filterStatus));

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 24 }}>
        {STATUS_LIST.map(s => (
          <div key={s} style={{ background: '#fff', border: `2px solid ${STATUS_COLORS[s]}`, borderRadius: 10, padding: '8px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90 }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: STATUS_COLORS[s] }}>{statusCounts[s]}</span>
            <span style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize', marginTop: 2 }}>{s}</span>
          </div>
        ))}
      </div>
      <div style={{ ...S.card, borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={S.sectionTitle}>Produtos de Captura</div>
          <button style={S.btn('primary')} onClick={() => setModalProduto(defaultProdutoSDR())}>+ Novo Produto</button>
        </div>
        {loadingP ? <p style={{ color: '#94a3b8' }}>Carregando…</p> : (
          <table style={S.table}><thead><tr><th style={S.th}>Nome</th><th style={S.th}>Tipo</th><th style={S.th}>Ativo</th><th style={S.th}>Link</th><th style={S.th}>Ações</th></tr></thead>
            <tbody>{produtos.map(p => (
              <tr key={p.id}>
                <td style={S.td}>{p.nome}</td>
                <td style={S.td}><span style={{ background: '#f1f5f9', borderRadius: 6, padding: '2px 8px', fontSize: 12 }}>{p.tipo}</span></td>
                <td style={S.td}><button onClick={() => toggleAtivo(p)} style={{ ...S.badge(p.ativo), cursor: 'pointer', border: 'none' }}>{p.ativo ? 'Ativo' : 'Inativo'}</button></td>
                <td style={S.td}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{window.location.origin}/#/p/captura/{p.id}</span><button onClick={() => copyLink(p.id)} style={{ ...S.btn('outline'), fontSize: 11, padding: '3px 8px' }}>{copiado === p.id ? 'Copiado!' : 'Copiar'}</button></div></td>
                <td style={S.td}><div style={{ display: 'flex', gap: 6 }}><button style={{ ...S.btn('outline'), fontSize: 12 }} onClick={() => setModalProduto({ ...p })}>Editar</button><button style={{ ...S.btn('danger'), fontSize: 12 }} onClick={() => deleteProduto(p.id)}>Excluir</button></div></td>
              </tr>
            ))}{produtos.length === 0 && <tr><td colSpan={5} style={{ ...S.td, color: '#94a3b8', textAlign: 'center', padding: 24 }}>Nenhum produto cadastrado.</td></tr>}</tbody>
          </table>
        )}
      </div>
      <div style={{ ...S.card, borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
          <div style={S.sectionTitle}>Leads Capturados</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={filterProduto} onChange={e => setFilterProduto(e.target.value)} style={{ ...S.input, width: 'auto', fontSize: 13 }}><option value="">Todos os produtos</option>{produtos.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}</select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...S.input, width: 'auto', fontSize: 13 }}><option value="">Todos os status</option>{STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <button style={S.btn('outline')} onClick={exportCSV}>⬇ CSV</button>
          </div>
        </div>
        {loadingL ? <p style={{ color: '#94a3b8' }}>Carregando…</p> : (
          <table style={S.table}><thead><tr><th style={S.th}>Nome</th><th style={S.th}>WhatsApp</th><th style={S.th}>Email</th><th style={S.th}>Produto</th><th style={S.th}>Status</th><th style={S.th}>Data</th></tr></thead>
            <tbody>{filteredLeads.map(l => (
              <tr key={l.id}>
                <td style={S.td}>{l.nome}</td>
                <td style={S.td}><div style={{ display: 'flex', gap: 6 }}>{l.whatsapp}<a href={`https://wa.me/55${l.whatsapp.replace(/\D/g,'')}`} target="_blank" rel="noreferrer" style={{ fontSize: 11, background: '#dcfce7', color: '#166534', borderRadius: 6, padding: '2px 6px', textDecoration: 'none', fontWeight: 600 }}>WA</a></div></td>
                <td style={S.td}>{l.email || '—'}</td>
                <td style={S.td}>{l.sdr_produtos?.nome || '—'}</td>
                <td style={S.td}><select value={l.status} onChange={e => updateLeadStatus(l.id, e.target.value)} style={{ background: STATUS_COLORS[l.status]+'22', color: STATUS_COLORS[l.status], border: `1px solid ${STATUS_COLORS[l.status]}`, borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700, cursor: 'pointer', outline: 'none' }}>{STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}</select></td>
                <td style={S.td}>{new Date(l.criado_em).toLocaleDateString('pt-BR')}</td>
              </tr>
            ))}{filteredLeads.length === 0 && <tr><td colSpan={6} style={{ ...S.td, color: '#94a3b8', textAlign: 'center', padding: 24 }}>Nenhum lead encontrado.</td></tr>}</tbody>
          </table>
        )}
      </div>
      {modalProduto && (
        <div style={S.overlay} onClick={() => setModalProduto(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 20 }}>{modalProduto.id ? 'Editar Produto' : 'Novo Produto'}</div>
            <div style={S.row}><div style={S.col}><label style={S.label}>Nome *</label><input style={S.input} value={modalProduto.nome} onChange={e => setModalProduto(m => ({ ...m, nome: e.target.value }))} /></div><div style={{ width: 140 }}><label style={S.label}>Tipo</label><select style={S.input} value={modalProduto.tipo} onChange={e => setModalProduto(m => ({ ...m, tipo: e.target.value }))}><option value="ebook">eBook</option><option value="minicurso">Mini-curso</option><option value="webinar">Webinar</option><option value="outro">Outro</option></select></div></div>
            <div style={{ marginBottom: 14 }}><label style={S.label}>Descrição</label><textarea style={{ ...S.input, height: 72, resize: 'vertical' }} value={modalProduto.descricao || ''} onChange={e => setModalProduto(m => ({ ...m, descricao: e.target.value }))} /></div>
            <div style={{ marginBottom: 14 }}><label style={S.label}>Link do Conteúdo</label><input style={S.input} value={modalProduto.conteudo_url || ''} onChange={e => setModalProduto(m => ({ ...m, conteudo_url: e.target.value }))} placeholder="https://..." /></div>
            <div style={{ marginBottom: 20 }}><label style={S.label}>URL da Imagem (opcional)</label><input style={S.input} value={modalProduto.imagem_url || ''} onChange={e => setModalProduto(m => ({ ...m, imagem_url: e.target.value }))} placeholder="https://..." /></div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button style={S.btn('outline')} onClick={() => setModalProduto(null)}>Cancelar</button><button style={S.btn('primary')} onClick={saveProduto} disabled={saving || !modalProduto.nome?.trim()}>{saving ? 'Salvando…' : 'Salvar'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPE TAB
// ═══════════════════════════════════════════════════════════════════════════════
const ROLE_BADGE_COLORS = { admin: { bg: '#fef3c7', color: '#92400e' }, analista: { bg: '#dbeafe', color: '#1e40af' }, consultor: { bg: '#d1fae5', color: '#065f46' }, advogado: { bg: '#ede9fe', color: '#5b21b6' } };

const CHECKLIST_ITEMS = [
  { key: 'leiloeiro_habilitado',  label: 'Leiloeiro habilitado verificado (JUCESP/CRA)' },
  { key: 'matricula_analisada',   label: 'Matrícula do imóvel analisada' },
  { key: 'edital_analisado',      label: 'Edital analisado' },
  { key: 'processo_cnj',          label: 'Processo judicial consultado (CNJ)' },
  { key: 'debitos_verificados',   label: 'Débitos verificados (IPTU, condomínio, taxas)' },
  { key: 'ocupacao_verificada',   label: 'Ocupação/posse verificada' },
  { key: 'avaliacao_mercado',     label: 'Avaliação de mercado realizada' },
  { key: 'viabilidade_financeira',label: 'Viabilidade financeira calculada' },
  { key: 'laudo_emitido',         label: 'Laudo técnico emitido' },
];

const STATUS_SOL_COLORS = {
  solicitado:   { bg: '#fef9c3', color: '#854d0e', label: 'Solicitado' },
  em_andamento: { bg: '#dbeafe', color: '#1e40af', label: 'Em Andamento' },
  concluido:    { bg: '#d1fae5', color: '#065f46', label: 'Concluído' },
};

function RoleBadge({ role }) {
  const rc = ROLE_BADGE_COLORS[role] || { bg: '#f1f5f9', color: '#475569' };
  return <span style={{ background: rc.bg, color: rc.color, borderRadius: 8, padding: '2px 10px', fontSize: 12, fontWeight: 700, display: 'inline-block', marginRight: 4 }}>{role}</span>;
}

function SolicitacaoModal({ sol, membros, onClose, onSaved }) {
  const [checklist, setChecklist] = useState(sol.checklist || {});
  const [notas, setNotas] = useState(sol.notas_analista || '');
  const [meetLink, setMeetLink] = useState(sol.google_meet_link || '');
  const [status, setStatus] = useState(sol.status || 'solicitado');
  const [saving, setSaving] = useState(false);
  const [notificando, setNotificando] = useState(false);
  const [clienteEmail, setClienteEmail] = useState('');
  const [clienteNome, setClienteNome] = useState('');
  const [reuniaoEm, setReuniaoEm] = useState(
    sol.reuniao_em ? new Date(sol.reuniao_em).toISOString().slice(0, 16) : ''
  );
  const [reuniaoDuracao, setReuniaoDuracao] = useState(sol.reuniao_duracao_min || 30);

  useEffect(() => {
    if (sol.user_id) {
      supabase.from('perfis').select('email, nome').eq('id', sol.user_id).single()
        .then(({ data }) => {
          if (data?.email) setClienteEmail(data.email);
          if (data?.nome) setClienteNome(data.nome);
        });
    }
  }, [sol.user_id]);

  const analista = membros.find(m => m.id === sol.analista_id);

  function buildMeetCreateUrl() {
    let url = `https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent('Reunião TSN Ativos — ' + (sol.imovel_nome || 'Imóvel'))}`;
    url += `&details=${encodeURIComponent('Análise de imóvel em leilão — TSN Ativos')}`;
    if (clienteEmail) url += `&add=${encodeURIComponent(clienteEmail)}`;
    if (reuniaoEm) {
      const start = new Date(reuniaoEm);
      const end = new Date(start.getTime() + reuniaoDuracao * 60000);
      const fmt = d => d.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
      url += `&dates=${fmt(start)}/${fmt(end)}`;
    }
    if (meetLink) url += `&location=${encodeURIComponent(meetLink)}`;
    return url;
  }

  async function salvar() {
    setSaving(true);
    await supabase.from('solicitacoes').update({
      checklist,
      notas_analista: notas,
      google_meet_link: meetLink,
      status,
      reuniao_em: reuniaoEm ? new Date(reuniaoEm).toISOString() : null,
      reuniao_duracao_min: reuniaoDuracao,
    }).eq('id', sol.id);
    setSaving(false);
    onSaved();
  }

  async function salvarENotificar() {
    if (!reuniaoEm) {
      alert('Preencha a data/hora antes de agendar.');
      return;
    }
    if (!clienteEmail) {
      alert('E-mail do cliente não encontrado.');
      return;
    }
    setNotificando(true);

    // Cria sala Daily.co com transcrição forçada
    let linkFinal = meetLink;
    try {
      const r = await fetch('/api/criar-sala-reuniao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solicitacaoId: sol.id, reuniaoEm, duracaoMin: reuniaoDuracao }),
      });
      if (r.ok) {
        const { meetLink: novoLink } = await r.json();
        linkFinal = novoLink;
        setMeetLink(novoLink);
      }
    } catch (e) {
      console.error('Erro ao criar sala Daily:', e);
    }

    await supabase.from('solicitacoes').update({
      checklist,
      notas_analista: notas,
      google_meet_link: linkFinal,
      status,
      reuniao_em: new Date(reuniaoEm).toISOString(),
      reuniao_duracao_min: reuniaoDuracao,
    }).eq('id', sol.id);

    try {
      await fetch('/api/notificar-reuniao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clienteEmail,
          clienteNome,
          imovelNome: sol.imovel_nome || '',
          imovelCidade: sol.imovel_cidade || '',
          reuniaoEm,
          reuniaoDuracao,
          meetLink: linkFinal,
          calendarUrl: buildMeetCreateUrl(),
        }),
      });
      alert('Sala criada, reunião salva e cliente notificado!');
    } catch {
      alert('Sala criada e reunião salva, mas houve erro ao enviar e-mail.');
    }
    setNotificando(false);
    onSaved();
  }

  async function prorrogarReuniao() {
    if (!meetLink) { alert('Nenhuma sala ativa para prorrogar.'); return; }
    const novasDuracao = reuniaoDuracao + 30;
    setReuniaoDuracao(novasDuracao);
    await supabase.from('solicitacoes').update({ reuniao_duracao_min: novasDuracao }).eq('id', sol.id);
    alert(`Reunião estendida para ${novasDuracao} minutos.`);
  }

  const meetCreateUrl = buildMeetCreateUrl();

  const statusSol = STATUS_SOL_COLORS[sol.status] || STATUS_SOL_COLORS.solicitado;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 920, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }}>✕</button>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {sol.tipo && <span style={{ background: '#eff6ff', color: '#1e40af', borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>{{ processual:'Processual', edital:'Edital', mercadologica:'Mercadológica', consulta:'Consulta com Especialista' }[sol.tipo] || sol.tipo}</span>}
          <span style={{ background: statusSol.bg, color: statusSol.color, borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>{statusSol.label}</span>
          {sol.tipo === 'processual' && <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>⏰ Prazo judicial</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {/* LEFT — Info */}
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#0f172a', marginBottom: 16 }}>Informações do Imóvel</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {[['Imóvel', sol.imovel_nome || '—'], ['Cidade', sol.imovel_cidade || '—'], ['Referência', sol.imovel_ref || '—'], ['Analista', analista?.nome || 'Não atribuído']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 13, color: '#64748b', minWidth: 80 }}>{k}:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Agendamento da Reunião</div>

            <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 2 }}>
                <label style={S.label}>Data e hora</label>
                <input type="datetime-local" style={S.input} value={reuniaoEm} onChange={e => setReuniaoEm(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label style={S.label}>Duração</label>
                <select style={{ ...S.input, fontWeight: 600 }} value={reuniaoDuracao} onChange={e => setReuniaoDuracao(Number(e.target.value))}>
                  <option value={30}>30 min</option>
                  <option value={60}>60 min</option>
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>URL do Google Meet</label>
              <input style={S.input} value={meetLink} onChange={e => setMeetLink(e.target.value)} placeholder="https://meet.google.com/..." />
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {clienteEmail && (
                <a href={`mailto:${clienteEmail}?subject=Reunião TSN Ativos — ${sol.imovel_nome || 'Imóvel'}`}
                  style={{ padding: '8px 14px', background: '#eff6ff', color: '#1e40af', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  ✉️ E-mail direto
                </a>
              )}
              <a href={meetCreateUrl} target="_blank" rel="noreferrer"
                style={{ padding: '8px 14px', background: '#f0fdf4', color: '#065f46', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                📅 Criar evento no Google Calendar
              </a>
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={S.label}>Status</label>
              <select style={{ ...S.input, fontWeight: 700 }} value={status} onChange={e => setStatus(e.target.value)}>
                <option value="solicitado">Solicitado</option>
                <option value="em_andamento">Em Andamento</option>
                <option value="concluido">Concluído</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button style={{ ...S.btn('outline'), flex: 1 }} onClick={salvar} disabled={saving || notificando}>
                {saving ? 'Salvando…' : 'Salvar'}
              </button>
              <button style={{ ...S.btn('primary'), flex: 2, background: '#059669' }} onClick={salvarENotificar} disabled={saving || notificando}>
                {notificando ? 'Criando sala…' : '📹 Agendar e Notificar Cliente'}
              </button>
            </div>
            {meetLink && (
              <button style={{ ...S.btn('outline'), width: '100%', marginTop: 8, color: '#7c3aed', borderColor: '#c4b5fd' }} onClick={prorrogarReuniao}>
                ⏱ +30 min na reunião atual
              </button>
            )}
          </div>

          {/* RIGHT — Checklist + Transcrições */}
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#0f172a', marginBottom: 16 }}>Checklist de Análise</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {CHECKLIST_ITEMS.map(item => (
                <label key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '8px 12px', background: checklist[item.key] ? '#f0fdf4' : '#f8fafc', borderRadius: 8, border: `1px solid ${checklist[item.key] ? '#bbf7d0' : '#e2e8f0'}` }}>
                  <input type="checkbox" checked={!!checklist[item.key]}
                    onChange={e => setChecklist(p => ({ ...p, [item.key]: e.target.checked }))}
                    style={{ marginTop: 2, accentColor: '#059669', width: 16, height: 16, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: checklist[item.key] ? '#065f46' : '#374151', fontWeight: checklist[item.key] ? 700 : 400 }}>
                    {item.label}
                  </span>
                </label>
              ))}
            </div>

            <div>
              <label style={S.label}>Notas do analista</label>
              <textarea style={{ ...S.input, height: 100, resize: 'vertical', fontFamily: 'inherit' }}
                value={notas} onChange={e => setNotas(e.target.value)}
                placeholder="Observações, conclusões, pontos de atenção..." />
            </div>

            {/* Performance do analista */}
            {analista && (
              <div style={{ marginTop: 16, padding: 12, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 8 }}>Performance — {analista.nome}</div>
                <AnalistaPerf analistaId={analista.id} />
              </div>
            )}

            {/* Transcrições da reunião */}
            <TranscricoesReuniao solicitacaoId={sol.id} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TranscricoesReuniao({ solicitacaoId }) {
  const [lista, setLista] = useState([]);
  const [expandido, setExpandido] = useState(null);

  useEffect(() => {
    if (!solicitacaoId) return;
    supabase.from('transcricoes_reuniao')
      .select('id, transcricao, duracao_seg, created_at')
      .eq('solicitacao_id', solicitacaoId)
      .order('created_at', { ascending: false })
      .then(({ data }) => setLista(data || []));
  }, [solicitacaoId]);

  if (lista.length === 0) return null;

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        📝 Transcrições ({lista.length})
      </div>
      {lista.map(t => (
        <div key={t.id} style={{ background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', marginBottom: 8, overflow: 'hidden' }}>
          <button onClick={() => setExpandido(expandido === t.id ? null : t.id)}
            style={{ width: '100%', textAlign: 'left', padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
              {new Date(t.created_at).toLocaleString('pt-BR')}
              {t.duracao_seg && <span style={{ marginLeft: 8, fontSize: 11, color: '#94a3b8' }}>{Math.round(t.duracao_seg / 60)} min</span>}
            </span>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{expandido === t.id ? '▲ fechar' : '▼ ver'}</span>
          </button>
          {expandido === t.id && (
            <div style={{ padding: '0 14px 14px', fontSize: 13, color: '#374151', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 220, overflowY: 'auto' }}>
              {t.transcricao || <em style={{ color: '#94a3b8' }}>Transcrição não disponível.</em>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function AnalistaPerf({ analistaId }) {
  const [perf, setPerf] = useState(null);
  useEffect(() => {
    const mesInicio = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    Promise.all([
      supabase.from('solicitacoes').select('id', { count: 'exact', head: true }).eq('analista_id', analistaId).eq('status', 'em_andamento'),
      supabase.from('solicitacoes').select('id', { count: 'exact', head: true }).eq('analista_id', analistaId).eq('status', 'concluido').gte('updated_at', mesInicio),
    ]).then(([{ count: andamento }, { count: concluido }]) => {
      setPerf({ andamento: andamento || 0, concluido: concluido || 0 });
    });
  }, [analistaId]);
  if (!perf) return <span style={{ fontSize: 12, color: '#94a3b8' }}>Carregando...</span>;
  return (
    <div style={{ display: 'flex', gap: 16 }}>
      <div><div style={{ fontSize: 20, fontWeight: 900, color: '#2563eb' }}>{perf.andamento}</div><div style={{ fontSize: 11, color: '#64748b' }}>Em andamento</div></div>
      <div><div style={{ fontSize: 20, fontWeight: 900, color: '#059669' }}>{perf.concluido}</div><div style={{ fontSize: 11, color: '#64748b' }}>Concluídos (mês)</div></div>
    </div>
  );
}

function EquipeTab() {
  const { user } = useAuth();

  // Section A state
  const [membros, setMembros] = useState([]);
  const [chamadosMap, setChamadosMap] = useState({});
  const [finalizadosHoje, setFinalizadosHoje] = useState(0);
  const [convitesEquipe, setConvitesEquipe] = useState([]);
  const [copiado, setCopiado] = useState('');
  const [modalMulti, setModalMulti] = useState(false);
  const [multiRoles, setMultiRoles] = useState([]);
  const [gerandoConvite, setGerandoConvite] = useState(false);
  const [linkGerado, setLinkGerado] = useState(null);

  // Section B state
  const [solicitacoes, setSolicitacoes] = useState([]);
  const [filtroStatus, setFiltroStatus] = useState('todas');
  const [solModal, setSolModal] = useState(null);
  const [distribuindo, setDistribuindo] = useState(false);

  const [loading, setLoading] = useState(true);

  const carregarTudo = useCallback(async () => {
    setLoading(true);
    // Members
    const { data: perfisData } = await supabase.from('perfis').select('*').in('role', ['admin','analista','consultor','advogado']);
    const membrosData = perfisData || [];
    setMembros(membrosData);
    if (membrosData.length > 0) {
      const ids = membrosData.map(m => m.id);
      const { data: chamados } = await supabase.from('chamados').select('atendente_id, status').in('atendente_id', ids);
      const map = {};
      ids.forEach(id => { map[id] = { total: 0, finalizados: 0 }; });
      (chamados || []).forEach(c => { if (map[c.atendente_id]) { map[c.atendente_id].total++; if (c.status === 'finalizado') map[c.atendente_id].finalizados++; } });
      setChamadosMap(map);
      const hoje = new Date().toISOString().slice(0, 10);
      const { count } = await supabase.from('chamados').select('id', { count: 'exact', head: true }).eq('status', 'finalizado').gte('atualizado_em', hoje);
      setFinalizadosHoje(count || 0);
    }
    // Team invites
    const { data: convitesData } = await supabase.from('convites_equipe').select('*').order('criado_em', { ascending: false }).limit(20);
    setConvitesEquipe(convitesData || []);
    // Solicitacoes
    const { data: solData } = await supabase.from('solicitacoes').select('*').order('criado_em', { ascending: false });
    setSolicitacoes(solData || []);
    setLoading(false);
  }, []);

  useEffect(() => { carregarTudo(); }, [carregarTudo]);

  async function gerarConvite(roles) {
    setGerandoConvite(true);
    const token = crypto.randomUUID();
    const { data: novo } = await supabase.from('convites_equipe').insert({
      token, roles, criado_por: user.id,
    }).select().single();
    const link = `${window.location.origin}/#/convite/${token}`;
    setLinkGerado({ token, link, roles });
    navigator.clipboard.writeText(link).catch(() => {});
    await carregarTudo();
    setGerandoConvite(false);
  }

  function copiarLink(token) {
    const link = `${window.location.origin}/#/convite/${token}`;
    navigator.clipboard.writeText(link);
    setCopiado(token);
    setTimeout(() => setCopiado(''), 2000);
  }

  function statusConvite(c) {
    if (c.usado_em) return { label: 'Usado', bg: '#f3f4f6', color: '#6b7280' };
    if (c.expira_em && new Date(c.expira_em) < new Date()) return { label: 'Expirado', bg: '#fee2e2', color: '#dc2626' };
    if (c.ativo) return { label: 'Ativo', bg: '#d1fae5', color: '#065f46' };
    return { label: 'Inativo', bg: '#fee2e2', color: '#dc2626' };
  }

  async function distribuirAutomaticamente() {
    setDistribuindo(true);
    const analistas = membros.filter(m => m.role === 'analista');
    if (analistas.length === 0) { alert('Nenhum analista disponível.'); setDistribuindo(false); return; }
    const pendentes = solicitacoes.filter(s => s.status === 'solicitado' && !s.analista_id);
    if (pendentes.length === 0) { alert('Nenhuma solicitação aguardando distribuição.'); setDistribuindo(false); return; }
    // Count em_andamento per analyst
    const counts = {};
    analistas.forEach(a => { counts[a.id] = solicitacoes.filter(s => s.analista_id === a.id && s.status === 'em_andamento').length; });
    for (const sol of pendentes) {
      const analistaId = analistas.reduce((min, a) => (counts[a.id] < counts[min.id] ? a : min)).id;
      await supabase.from('solicitacoes').update({ analista_id: analistaId, status: 'em_andamento' }).eq('id', sol.id);
      counts[analistaId]++;
    }
    await carregarTudo();
    setDistribuindo(false);
  }

  const solFiltradas = filtroStatus === 'todas' ? solicitacoes
    : filtroStatus === 'aguardando' ? solicitacoes.filter(s => s.status === 'solicitado')
    : filtroStatus === 'andamento' ? solicitacoes.filter(s => s.status === 'em_andamento')
    : solicitacoes.filter(s => s.status === 'concluido');

  if (loading) return <p style={{ color: '#94a3b8' }}>Carregando…</p>;

  const INVITE_BTNS = [
    { label: '🔍 Convidar Analista',   roles: ['analista'],  bg: '#2563eb' },
    { label: '⚖️ Convidar Advogado',   roles: ['advogado'],  bg: '#7c3aed' },
    { label: '🤝 Convidar Consultor',  roles: ['consultor'], bg: '#059669' },
  ];

  return (
    <div>
      {/* ── SECTION A ─────────────────────────────────────────────────────────── */}
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14, marginBottom: 24 }}>
        {[
          ['Total Equipe', membros.length, '#0f172a'],
          ['Analistas', membros.filter(m=>m.role==='analista').length, '#2563eb'],
          ['Advogados', membros.filter(m=>m.role==='advogado').length, '#7c3aed'],
          ['Consultores', membros.filter(m=>m.role==='consultor').length, '#059669'],
          ['Finalizados Hoje', finalizadosHoje, '#f59e0b'],
        ].map(([l,v,c]) => (
          <div key={l} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: c }}>{v}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Invite buttons */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {INVITE_BTNS.map(b => (
          <button key={b.roles[0]} disabled={gerandoConvite}
            style={{ padding: '9px 18px', background: b.bg, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: gerandoConvite ? 0.7 : 1 }}
            onClick={() => gerarConvite(b.roles)}>
            {b.label}
          </button>
        ))}
        <button disabled={gerandoConvite}
          style={{ padding: '9px 18px', background: '#6b7280', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: gerandoConvite ? 0.7 : 1 }}
          onClick={() => setModalMulti(true)}>
          👤 Multi-função
        </button>
      </div>

      {/* Generated link banner */}
      {linkGerado && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 18px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: '#065f46', marginBottom: 4 }}>
              ✅ Link gerado — {linkGerado.roles.join(', ')}
            </div>
            <div style={{ fontSize: 12, color: '#374151', wordBreak: 'break-all' }}>{linkGerado.link}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { navigator.clipboard.writeText(linkGerado.link); }}
              style={{ padding: '6px 12px', background: '#059669', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
              Copiar link
            </button>
            <button onClick={() => setLinkGerado(null)}
              style={{ padding: '6px 12px', background: '#f1f5f9', color: '#374151', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' }}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Recent convites_equipe list */}
      <div style={{ ...S.card, borderRadius: 14, marginBottom: 24 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#0f172a', marginBottom: 14 }}>Convites de Equipe Recentes</div>
        {convitesEquipe.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 16 }}>Nenhum convite gerado ainda.</p>
        ) : convitesEquipe.map(c => {
          const st = statusConvite(c);
          return (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <div style={{ fontSize: 12, fontFamily: 'monospace', color: '#475569', marginBottom: 4 }}>{c.token.slice(0, 18)}…</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {(c.roles || []).map(r => { const rc = ROLE_BADGE_COLORS[r] || { bg: '#f1f5f9', color: '#475569' }; return <span key={r} style={{ background: rc.bg, color: rc.color, borderRadius: 6, padding: '1px 8px', fontSize: 11, fontWeight: 700 }}>{r}</span>; })}
                </div>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(c.criado_em).toLocaleDateString('pt-BR')}</div>
              <span style={{ background: st.bg, color: st.color, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{st.label}</span>
              {!c.usado_em && c.ativo && (
                <button onClick={() => copiarLink(c.token)}
                  style={{ padding: '4px 10px', background: copiado === c.token ? '#d1fae5' : '#f1f5f9', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', color: copiado === c.token ? '#065f46' : '#374151' }}>
                  {copiado === c.token ? '✓ Copiado' : 'Copiar link'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Members table */}
      <div style={{ ...S.card, borderRadius: 14, marginBottom: 32 }}>
        <div style={S.sectionTitle}>Membros da Equipe</div>
        <table style={S.table}>
          <thead><tr><th style={S.th}>Membro</th><th style={S.th}>Role</th><th style={S.th}>Chamados</th><th style={S.th}>Finalizados</th><th style={S.th}>Último Acesso</th></tr></thead>
          <tbody>
            {membros.map(m => { const stats = chamadosMap[m.id] || { total:0, finalizados:0 }; return (
              <tr key={m.id}>
                <td style={S.td}><div style={{ fontWeight:600 }}>{m.nome||'—'}</div><div style={{ fontSize:12, color:'#94a3b8' }}>{m.email||''}</div></td>
                <td style={S.td}><RoleBadge role={m.role} /></td>
                <td style={S.td}>{stats.total}</td>
                <td style={S.td}>{stats.finalizados}</td>
                <td style={{ ...S.td, color:'#64748b', fontSize:13 }}>{m.ultimo_acesso ? new Date(m.ultimo_acesso).toLocaleDateString('pt-BR') : 'N/D'}</td>
              </tr>
            ); })}
            {membros.length===0&&<tr><td colSpan={5} style={{ ...S.td, color:'#94a3b8', textAlign:'center', padding:24 }}>Nenhum membro encontrado.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* ── SECTION B ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', margin: 0 }}>Solicitações de Análise</h2>
        <button disabled={distribuindo} onClick={distribuirAutomaticamente}
          style={{ padding: '9px 18px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: distribuindo ? 0.7 : 1 }}>
          {distribuindo ? 'Distribuindo…' : '⚡ Distribuir automaticamente'}
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['todas','Todas'], ['aguardando','Aguardando'], ['andamento','Em Andamento'], ['concluidas','Concluídas']].map(([k,l]) => (
          <button key={k} onClick={() => setFiltroStatus(k)}
            style={{ padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: filtroStatus === k ? '#0f172a' : '#f1f5f9', color: filtroStatus === k ? '#fff' : '#475569' }}>
            {l}
          </button>
        ))}
      </div>

      <div style={{ ...S.card, borderRadius: 14, overflowX: 'auto' }}>
        <table style={S.table}>
          <thead><tr>
            <th style={S.th}>Imóvel</th>
            <th style={S.th}>Tipo</th>
            <th style={S.th}>Cidade</th>
            <th style={S.th}>Data</th>
            <th style={S.th}>Analista</th>
            <th style={S.th}>Status</th>
            <th style={S.th}></th>
          </tr></thead>
          <tbody>
            {solFiltradas.map(s => {
              const st = STATUS_SOL_COLORS[s.status] || STATUS_SOL_COLORS.solicitado;
              const analista = membros.find(m => m.id === s.analista_id);
              return (
                <tr key={s.id}>
                  <td style={S.td}><div style={{ fontWeight:600, maxWidth:180 }}>{s.imovel_nome||'—'}</div></td>
                  <td style={S.td}><span style={{ fontSize:12, background:'#eff6ff', color:'#1e40af', borderRadius:6, padding:'2px 8px', fontWeight:700 }}>{s.tipo||'—'}</span></td>
                  <td style={{ ...S.td, fontSize:13, color:'#475569' }}>{s.imovel_cidade||'—'}</td>
                  <td style={{ ...S.td, fontSize:12, color:'#94a3b8' }}>{s.criado_em ? new Date(s.criado_em).toLocaleDateString('pt-BR') : '—'}</td>
                  <td style={{ ...S.td, fontSize:13 }}>{analista?.nome || <span style={{ color:'#94a3b8' }}>Não atribuído</span>}</td>
                  <td style={S.td}><span style={{ background:st.bg, color:st.color, borderRadius:6, padding:'2px 10px', fontSize:12, fontWeight:700 }}>{st.label}</span></td>
                  <td style={S.td}><button onClick={() => setSolModal(s)} style={{ padding:'4px 10px', background:'#0f172a', color:'white', border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>Ver</button></td>
                </tr>
              );
            })}
            {solFiltradas.length===0&&<tr><td colSpan={7} style={{ ...S.td, color:'#94a3b8', textAlign:'center', padding:32 }}>Nenhuma solicitação encontrada.</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Multi-role modal */}
      {modalMulti && (
        <div style={S.overlay} onClick={() => setModalMulti(false)}>
          <div style={{ ...S.modal, maxWidth: 380 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight:700, fontSize:16, marginBottom:16 }}>Selecionar funções do convite</div>
            {['analista','advogado','consultor','admin'].map(r => {
              const rc = ROLE_BADGE_COLORS[r] || { bg:'#f1f5f9', color:'#475569' };
              return (
                <label key={r} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background: multiRoles.includes(r) ? rc.bg : '#f8fafc', borderRadius:8, marginBottom:8, cursor:'pointer', border:`1px solid ${multiRoles.includes(r) ? '#cbd5e1' : '#e2e8f0'}` }}>
                  <input type="checkbox" checked={multiRoles.includes(r)} onChange={e => setMultiRoles(p => e.target.checked ? [...p,r] : p.filter(x=>x!==r))} style={{ accentColor:'#0f172a' }} />
                  <span style={{ fontWeight:700, color:rc.color }}>{r}</span>
                </label>
              );
            })}
            <div style={{ display:'flex', gap:10, marginTop:16, justifyContent:'flex-end' }}>
              <button style={S.btn('outline')} onClick={() => { setModalMulti(false); setMultiRoles([]); }}>Cancelar</button>
              <button style={S.btn('primary')} disabled={multiRoles.length===0||gerandoConvite} onClick={async () => { await gerarConvite(multiRoles); setModalMulti(false); setMultiRoles([]); }}>
                {gerandoConvite ? 'Gerando…' : 'Gerar convite'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Solicitacao detail modal */}
      {solModal && (
        <SolicitacaoModal
          sol={solModal}
          membros={membros}
          onClose={() => setSolModal(null)}
          onSaved={() => { setSolModal(null); carregarTudo(); }}
        />
      )}
    </div>
  );
}

// MARKETING TAB — inteligência de buscas, demográficos, SDR e oportunidades
// (visível APENAS para role === 'admin')
// ═══════════════════════════════════════════════════════════════════════════════
function MarketingTab() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [loading, setLoading] = useState(true);
  const [buscas, setBuscas] = useState({ total: 0, unicos: 0, cidades: [], estados: [], tipos: [], pagamentos: [] });
  const [perfisData, setPerfisData] = useState({ porRole: [], porEstado: [], semanas: [], ativos: 0, inativos: 0, total: 0 });
  const [sdrData, setSdrData] = useState({ leadsStatus: {}, leadsPorProduto: [], semanas: [], total: 0, convertidos: 0 });
  const [oportunidades, setOportunidades] = useState([]);
  const [alertas, setAlertas] = useState([]);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      // ── Seção 1: Buscas ──
      const [
        { data: cidadesRaw },
        { data: tiposRaw },
        { data: estadosRaw },
        { data: pagamentosRaw },
        { data: totaisRaw },
      ] = await Promise.all([
        supabase.from('busca_historico').select('cidade').not('cidade', 'is', null).gte('criado_em', thirtyDaysAgo),
        supabase.from('busca_historico').select('tipo_imovel').not('tipo_imovel', 'is', null).gte('criado_em', thirtyDaysAgo),
        supabase.from('busca_historico').select('estado').not('estado', 'is', null).gte('criado_em', thirtyDaysAgo),
        supabase.from('busca_historico').select('pagamento_tipos').not('pagamento_tipos', 'is', null).gte('criado_em', thirtyDaysAgo),
        supabase.from('busca_historico').select('user_id, id').gte('criado_em', thirtyDaysAgo),
      ]);

      const countBy = (arr, key) => {
        const map = {};
        (arr || []).forEach(r => { const v = r[key]; if (v) map[v] = (map[v] || 0) + 1; });
        return Object.entries(map).sort((a, b) => b[1] - a[1]);
      };

      const cidadesCount = countBy(cidadesRaw, 'cidade').slice(0, 10);
      const estadosCount = countBy(estadosRaw, 'estado').slice(0, 10);
      const tiposCount = countBy(tiposRaw, 'tipo_imovel');

      const pagMap = {};
      (pagamentosRaw || []).forEach(r => {
        const v = r.pagamento_tipos;
        if (Array.isArray(v)) v.forEach(p => { pagMap[p] = (pagMap[p] || 0) + 1; });
        else if (v) pagMap[v] = (pagMap[v] || 0) + 1;
      });
      const pagamentosCount = Object.entries(pagMap).sort((a, b) => b[1] - a[1]);

      const totalBuscas = (totaisRaw || []).length;
      const unicosSet = new Set((totaisRaw || []).filter(r => r.user_id).map(r => r.user_id));

      setBuscas({ total: totalBuscas, unicos: unicosSet.size, cidades: cidadesCount, estados: estadosCount, tipos: tiposCount, pagamentos: pagamentosCount });

      // ── Seção 2: Perfis demográficos ──
      const { data: perfisRaw } = await supabase.from('perfis').select('role, created_at, cidade, estado, ativo');
      const roleMap = {};
      const estadoPerfisMap = {};
      let ativos = 0; let inativos = 0;
      const semanaMap = {};
      (perfisRaw || []).forEach(p => {
        roleMap[p.role || 'explorador'] = (roleMap[p.role || 'explorador'] || 0) + 1;
        if (p.estado) estadoPerfisMap[p.estado] = (estadoPerfisMap[p.estado] || 0) + 1;
        if (p.ativo !== false) ativos++; else inativos++;
        if (p.created_at) {
          const diff = Math.floor((Date.now() - new Date(p.created_at)) / (7 * 24 * 60 * 60 * 1000));
          if (diff < 12) { const semana = `S-${diff}`; semanaMap[semana] = (semanaMap[semana] || 0) + 1; }
        }
      });
      const porRole = Object.entries(roleMap).sort((a, b) => b[1] - a[1]);
      const porEstado = Object.entries(estadoPerfisMap).sort((a, b) => b[1] - a[1]).slice(0, 10);
      const semanas = Array.from({ length: 12 }, (_, i) => ({ label: `S${12 - i}`, count: semanaMap[`S-${11 - i}`] || 0 }));
      setPerfisData({ porRole, porEstado, semanas, ativos, inativos, total: (perfisRaw || []).length });

      // ── Seção 3: SDR ──
      const [{ data: leadsRaw }, { data: produtosRaw }] = await Promise.all([
        supabase.from('sdr_leads').select('status, criado_em, origem, produto_id'),
        supabase.from('sdr_produtos').select('id, nome, tipo'),
      ]);
      const statusMap = {};
      const prodLeadMap = {};
      const sdrSemanaMap = {};
      (leadsRaw || []).forEach(l => {
        statusMap[l.status || 'novo'] = (statusMap[l.status || 'novo'] || 0) + 1;
        if (l.produto_id) prodLeadMap[l.produto_id] = (prodLeadMap[l.produto_id] || 0) + 1;
        if (l.criado_em) {
          const diff = Math.floor((Date.now() - new Date(l.criado_em)) / (7 * 24 * 60 * 60 * 1000));
          if (diff < 8) { const s = `S-${diff}`; sdrSemanaMap[s] = (sdrSemanaMap[s] || 0) + 1; }
        }
      });
      const prodNomeMap = {};
      (produtosRaw || []).forEach(p => { prodNomeMap[p.id] = p.nome || p.tipo || p.id; });
      const leadsPorProduto = Object.entries(prodLeadMap).map(([id, count]) => ({ nome: prodNomeMap[id] || id, count })).sort((a, b) => b.count - a.count);
      const sdrSemanas = Array.from({ length: 8 }, (_, i) => ({ label: `S${8 - i}`, count: sdrSemanaMap[`S-${7 - i}`] || 0 }));
      const totalLeads = (leadsRaw || []).length;
      const convertidos = statusMap['convertido'] || 0;
      setSdrData({ leadsStatus: statusMap, leadsPorProduto, semanas: sdrSemanas, total: totalLeads, convertidos });

      // ── Seção 4: Mapa de Oportunidades ──
      const { data: imoveisRaw } = await supabase.from('imoveis_leilao').select('cidade, estado').eq('ativo', true);
      const imovCidadeMap = {};
      (imoveisRaw || []).forEach(im => { if (im.cidade) imovCidadeMap[im.cidade] = (imovCidadeMap[im.cidade] || 0) + 1; });
      const oportsArr = cidadesCount.map(([cidade, buscasCount]) => ({
        cidade, buscas: buscasCount, imoveis: imovCidadeMap[cidade] || 0,
        ratio: imovCidadeMap[cidade] ? (buscasCount / imovCidadeMap[cidade]).toFixed(1) : buscasCount * 10,
      })).sort((a, b) => b.ratio - a.ratio);
      setOportunidades(oportsArr);

      // ── Seção 5: Alertas ──
      const { data: alertasRaw } = await supabase.from('alertas_email').select('*, perfis(email)').order('total_enviados', { ascending: false });
      setAlertas(alertasRaw || []);

    } catch (e) {
      console.error('MarketingTab error:', e);
    }
    setLoading(false);
  }, [thirtyDaysAgo]);

  useEffect(() => { carregar(); }, [carregar]);

  function exportarCSV() {
    const d = new Date().toLocaleDateString('pt-BR');
    const linhas = [
      `Relatório de Marketing TSN Ativos - ${d}`, '',
      '=== BUSCAS ===', 'Cidade,Total Buscas',
      ...buscas.cidades.map(([c, n]) => `${c},${n}`), '',
      'Estado,Total Buscas',
      ...buscas.estados.map(([e, n]) => `${e},${n}`), '',
      '=== PERFIL USUÁRIOS ===', 'Plano,Total',
      ...perfisData.porRole.map(([r, n]) => `${r},${n}`), '',
      '=== SDR LEADS ===', 'Produto,Total Leads',
      ...sdrData.leadsPorProduto.map(l => `${l.nome},${l.count}`), '',
      'Status,Total',
      ...Object.entries(sdrData.leadsStatus).map(([s, c]) => `${s},${c}`), '',
      '=== MAPA DE OPORTUNIDADES ===', 'Cidade,Buscas 30d,Imóveis Disponíveis,Ratio Demanda/Oferta',
      ...oportunidades.map(o => `${o.cidade},${o.buscas},${o.imoveis},${o.ratio}`),
    ];
    const blob = new Blob([linhas.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `marketing-tsn-${d.replace(/\//g, '-')}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const maxBar = (arr) => Math.max(...arr.map(([, c]) => c), 1);
  const maxBarN = (arr, key) => Math.max(...arr.map(r => r[key] || 0), 1);
  const kpiStyle = (color) => ({ fontSize: 28, fontWeight: 900, color });
  const kpiLabel = { fontSize: 12, color: '#64748b', marginTop: 2 };
  const sectionHeader = (title, sub) => (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontWeight: 800, fontSize: 16, color: '#0f172a' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Carregando dados de marketing...</div>;

  const FUNNEL_STEPS = ['novo', 'contatado', 'qualificado', 'convertido'];
  const FUNNEL_COLORS = ['#2563eb', '#7c3aed', '#d97706', '#059669'];

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', margin: 0 }}>Inteligência de Marketing</h2>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Painel privado — somente admin</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={S.btn('outline')} onClick={carregar}>↻ Atualizar dados</button>
          <button style={S.btn('primary')} onClick={exportarCSV}>⬇ Exportar Relatório</button>
        </div>
      </div>

      {/* Seção 1: Buscas */}
      <div style={{ ...S.card, borderRadius: 16, marginBottom: 20 }}>
        {sectionHeader('Painel de Buscas', 'Dados dos últimos 30 dias')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Total de buscas', value: buscas.total, color: '#2563eb' },
            { label: 'Usuários únicos buscadores', value: buscas.unicos, color: '#7c3aed' },
            { label: 'Tipos de imóvel buscados', value: buscas.tipos.length, color: '#059669' },
            { label: 'Buscas por usuário', value: buscas.unicos > 0 ? (buscas.total / buscas.unicos).toFixed(1) + 'x' : '—', color: '#d97706' },
          ].map(k => (
            <div key={k.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' }}>
              <div style={kpiStyle(k.color)}>{k.value}</div>
              <div style={kpiLabel}>{k.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Cidades mais buscadas</div>
            {buscas.cidades.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Sem dados</div> : buscas.cidades.map(([cidade, count]) => (
              <div key={cidade} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                  <span>{cidade}</span><span style={{ fontWeight: 700, color: '#2563eb' }}>{count}</span>
                </div>
                <div style={{ background: '#e2e8f0', borderRadius: 4, height: 8 }}>
                  <div style={{ background: 'linear-gradient(90deg,#2563eb,#60a5fa)', borderRadius: 4, height: 8, width: `${(count / maxBar(buscas.cidades)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Estados mais buscados</div>
            {buscas.estados.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Sem dados</div> : buscas.estados.map(([estado, count]) => (
              <div key={estado} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                  <span>{estado}</span><span style={{ fontWeight: 700, color: '#059669' }}>{count}</span>
                </div>
                <div style={{ background: '#e2e8f0', borderRadius: 4, height: 8 }}>
                  <div style={{ background: 'linear-gradient(90deg,#059669,#34d399)', borderRadius: 4, height: 8, width: `${(count / maxBar(buscas.estados)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Tipos de imóvel buscados</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {buscas.tipos.length === 0 ? <span style={{ color: '#94a3b8', fontSize: 13 }}>Sem dados</span>
              : buscas.tipos.map(([tipo, count]) => (
                <span key={tipo} style={{ padding: '4px 14px', background: '#eff6ff', color: '#1e40af', borderRadius: 999, fontWeight: 700, fontSize: 13 }}>
                  {tipo} <span style={{ color: '#2563eb' }}>({count})</span>
                </span>
              ))}
          </div>
        </div>
        {buscas.pagamentos.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Filtros de pagamento</div>
            {(() => {
              const total = buscas.pagamentos.reduce((s, [, c]) => s + c, 0);
              return buscas.pagamentos.map(([tipo, count]) => (
                <div key={tipo} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span>{tipo}</span><span style={{ fontWeight: 700 }}>{count} ({total > 0 ? ((count / total) * 100).toFixed(0) : 0}%)</span>
                  </div>
                  <div style={{ background: '#e2e8f0', borderRadius: 4, height: 8 }}>
                    <div style={{ background: 'linear-gradient(90deg,#d97706,#fbbf24)', borderRadius: 4, height: 8, width: `${total > 0 ? (count / total) * 100 : 0}%` }} />
                  </div>
                </div>
              ));
            })()}
          </div>
        )}
      </div>

      {/* Seção 2: Perfil Demográfico */}
      <div style={{ ...S.card, borderRadius: 16, marginBottom: 20 }}>
        {sectionHeader('Perfil Demográfico dos Usuários', 'Dados dos últimos 30 dias')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Total de usuários', value: perfisData.total, color: '#0f172a' },
            { label: 'Usuários ativos', value: perfisData.ativos, color: '#059669' },
            { label: 'Usuários inativos', value: perfisData.inativos, color: '#dc2626' },
            { label: 'Taxa de atividade', value: perfisData.total > 0 ? ((perfisData.ativos / perfisData.total) * 100).toFixed(0) + '%' : '—', color: '#2563eb' },
          ].map(k => (
            <div key={k.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' }}>
              <div style={kpiStyle(k.color)}>{k.value}</div>
              <div style={kpiLabel}>{k.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Usuários por plano</div>
            {perfisData.porRole.map(([role, count]) => {
              const maxV = Math.max(...perfisData.porRole.map(([, c]) => c), 1);
              return (
                <div key={role} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span>{role}</span><span style={{ fontWeight: 700, color: '#7c3aed' }}>{count}</span>
                  </div>
                  <div style={{ background: '#e2e8f0', borderRadius: 4, height: 8 }}>
                    <div style={{ background: 'linear-gradient(90deg,#7c3aed,#a78bfa)', borderRadius: 4, height: 8, width: `${(count / maxV) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Usuários por estado</div>
            {perfisData.porEstado.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>N/D — coluna estado não preenchida</div>
            ) : perfisData.porEstado.map(([estado, count]) => {
              const maxV = Math.max(...perfisData.porEstado.map(([, c]) => c), 1);
              return (
                <div key={estado} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span>{estado}</span><span style={{ fontWeight: 700, color: '#0891b2' }}>{count}</span>
                  </div>
                  <div style={{ background: '#e2e8f0', borderRadius: 4, height: 8 }}>
                    <div style={{ background: 'linear-gradient(90deg,#0891b2,#38bdf8)', borderRadius: 4, height: 8, width: `${(count / maxV) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Novos usuários por semana (últimas 12 semanas)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
            {(() => {
              const maxV = Math.max(...perfisData.semanas.map(s => s.count), 1);
              return perfisData.semanas.map(s => (
                <div key={s.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700 }}>{s.count > 0 ? s.count : ''}</div>
                  <div style={{ width: '100%', background: s.count > 0 ? 'linear-gradient(180deg,#2563eb,#60a5fa)' : '#e2e8f0', borderRadius: 4, height: `${Math.max((s.count / maxV) * 56, s.count > 0 ? 8 : 4)}px` }} />
                  <div style={{ fontSize: 9, color: '#94a3b8' }}>{s.label}</div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      {/* Seção 3: SDR Intelligence */}
      <div style={{ ...S.card, borderRadius: 16, marginBottom: 20 }}>
        {sectionHeader('SDR Intelligence', 'Dados dos últimos 30 dias')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Total de leads', value: sdrData.total, color: '#0f172a' },
            { label: 'Convertidos', value: sdrData.convertidos, color: '#059669' },
            { label: 'Taxa de conversão', value: sdrData.total > 0 ? ((sdrData.convertidos / sdrData.total) * 100).toFixed(1) + '%' : '—', color: '#2563eb' },
            { label: 'Leads novos', value: sdrData.leadsStatus['novo'] || 0, color: '#d97706' },
          ].map(k => (
            <div key={k.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' }}>
              <div style={kpiStyle(k.color)}>{k.value}</div>
              <div style={kpiLabel}>{k.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Funil de leads</div>
            {FUNNEL_STEPS.map((step, i) => {
              const count = sdrData.leadsStatus[step] || 0;
              const pct = sdrData.total > 0 ? ((count / sdrData.total) * 100).toFixed(0) : 0;
              return (
                <div key={step} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span style={{ textTransform: 'capitalize' }}>{step}</span>
                    <span style={{ fontWeight: 700, color: FUNNEL_COLORS[i] }}>{count} ({pct}%)</span>
                  </div>
                  <div style={{ background: '#e2e8f0', borderRadius: 4, height: 10 }}>
                    <div style={{ background: FUNNEL_COLORS[i], borderRadius: 4, height: 10, width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Leads por produto</div>
            {sdrData.leadsPorProduto.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Sem dados</div>
              : sdrData.leadsPorProduto.map(l => (
                <div key={l.nome} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span>{l.nome}</span><span style={{ fontWeight: 700, color: '#059669' }}>{l.count}</span>
                  </div>
                  <div style={{ background: '#e2e8f0', borderRadius: 4, height: 8 }}>
                    <div style={{ background: 'linear-gradient(90deg,#059669,#34d399)', borderRadius: 4, height: 8, width: `${(l.count / maxBarN(sdrData.leadsPorProduto, 'count')) * 100}%` }} />
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 10 }}>Leads por semana (últimas 8 semanas)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
            {(() => {
              const maxV = Math.max(...sdrData.semanas.map(s => s.count), 1);
              return sdrData.semanas.map(s => (
                <div key={s.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700 }}>{s.count > 0 ? s.count : ''}</div>
                  <div style={{ width: '100%', background: s.count > 0 ? 'linear-gradient(180deg,#059669,#34d399)' : '#e2e8f0', borderRadius: 4, height: `${Math.max((s.count / maxV) * 56, s.count > 0 ? 8 : 4)}px` }} />
                  <div style={{ fontSize: 9, color: '#94a3b8' }}>{s.label}</div>
                </div>
              ));
            })()}
          </div>
        </div>
      </div>

      {/* Seção 4: Mapa de Oportunidades */}
      <div style={{ ...S.card, borderRadius: 16, marginBottom: 20 }}>
        {sectionHeader('Mapa de Oportunidades por Cidade', 'Mercados mais subatendidos primeiro — dados dos últimos 30 dias')}
        {oportunidades.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Sem dados suficientes para análise.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Cidade</th>
                  <th style={S.th}>Buscas (30d)</th>
                  <th style={S.th}>Imóveis disponíveis</th>
                  <th style={S.th}>Ratio Demanda/Oferta</th>
                  <th style={S.th}>Oportunidade</th>
                </tr>
              </thead>
              <tbody>
                {oportunidades.map(o => {
                  const ratio = Number(o.ratio);
                  const opp = ratio >= 10 ? 'Alta' : ratio >= 3 ? 'Média' : 'Baixa';
                  const oppColor = ratio >= 10 ? '#dc2626' : ratio >= 3 ? '#d97706' : '#059669';
                  return (
                    <tr key={o.cidade}>
                      <td style={S.td}><strong>{o.cidade}</strong></td>
                      <td style={{ ...S.td, fontWeight: 700, color: '#2563eb' }}>{o.buscas}</td>
                      <td style={{ ...S.td, color: o.imoveis === 0 ? '#dc2626' : '#0f172a' }}>{o.imoveis === 0 ? '0 ⚠' : o.imoveis}</td>
                      <td style={{ ...S.td, fontWeight: 700 }}>{o.ratio}</td>
                      <td style={S.td}><span style={{ padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: oppColor + '20', color: oppColor }}>{opp}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Seção 5: Alertas Configurados */}
      <div style={{ ...S.card, borderRadius: 16 }}>
        {sectionHeader('Alertas de E-mail Configurados', 'Usuários com buscas salvas ativas')}
        {alertas.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhum alerta configurado.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>Usuário</th>
                  <th style={S.th}>Filtro</th>
                  <th style={S.th}>Último envio</th>
                  <th style={S.th}>Total enviados</th>
                  <th style={S.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {alertas.map(a => (
                  <tr key={a.id}>
                    <td style={{ ...S.td, fontSize: 13 }}>{a.perfis?.email || a.user_id || '—'}</td>
                    <td style={{ ...S.td, fontSize: 12, color: '#475569', maxWidth: 200 }}>{JSON.stringify(a.filtros || a.filtro || {})}</td>
                    <td style={{ ...S.td, fontSize: 12 }}>{a.ultimo_envio ? new Date(a.ultimo_envio).toLocaleDateString('pt-BR') : '—'}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: '#2563eb' }}>{a.total_enviados || 0}</td>
                    <td style={S.td}><span style={S.badge(a.ativo !== false)}>{a.ativo !== false ? 'Ativo' : 'Inativo'}</span></td>
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

const TABS = ['Dashboard', 'Cursos', 'eBooks', 'Contratos', 'Promoções', 'Convites', 'Usuários', 'SDR / Leads', 'Equipe', 'Scrapers', 'Registros', 'CNJ', 'Configurações'];

function RegistrosTab() {
  const [transcricoes, setTranscricoes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [expandido, setExpandido] = useState(null);
  const [filtroMes, setFiltroMes] = useState('');

  useEffect(() => {
    setLoading(true);
    supabase
      .from('transcricoes_reuniao')
      .select(`
        id, transcricao, duracao_seg, daily_room_name, created_at,
        solicitacoes ( imovel_nome, imovel_cidade, tipo, user_id,
          perfis:user_id ( nome, email )
        )
      `)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setTranscricoes(data || []); setLoading(false); });
  }, []);

  const meses = [...new Set(transcricoes.map(t => t.created_at?.slice(0, 7)))];

  const filtradas = transcricoes.filter(t => {
    const sol = t.solicitacoes;
    const texto = `${sol?.imovel_nome || ''} ${sol?.imovel_cidade || ''} ${sol?.perfis?.nome || ''} ${sol?.perfis?.email || ''} ${t.daily_room_name || ''}`.toLowerCase();
    const matchBusca = !busca || texto.includes(busca.toLowerCase());
    const matchMes = !filtroMes || t.created_at?.startsWith(filtroMes);
    return matchBusca && matchMes;
  });

  return (
    <div>
      <div style={{ ...S.card, marginBottom: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={S.sectionTitle}>📁 Diretório de Registros</div>
            <div style={{ fontSize: 13, color: '#64748b' }}>Transcrições de reuniões armazenadas para auditoria</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              style={{ ...S.input, width: 220 }}
              placeholder="Buscar por cliente, imóvel..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
            <select style={{ ...S.input, width: 150 }} value={filtroMes} onChange={e => setFiltroMes(e.target.value)}>
              <option value="">Todos os meses</option>
              {meses.map(m => (
                <option key={m} value={m}>{new Date(m + '-01').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Carregando registros...</div>
        ) : filtradas.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
            <div style={{ color: '#64748b', fontSize: 14 }}>Nenhum registro encontrado.</div>
            <div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>As transcrições aparecem aqui automaticamente após cada reunião.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filtradas.map(t => {
              const sol = t.solicitacoes;
              const cliente = sol?.perfis;
              const dataHora = new Date(t.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
              const durMin = t.duracao_seg ? Math.round(t.duracao_seg / 60) : null;
              const aberto = expandido === t.id;
              const tipoLabel = { processual: 'Processual', edital: 'Edital', mercadologica: 'Mercadológica', consulta: 'Consulta' }[sol?.tipo] || sol?.tipo || '—';

              return (
                <div key={t.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
                  <div
                    onClick={() => setExpandido(aberto ? null : t.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', cursor: 'pointer', background: aberto ? '#f8fafc' : '#fff', flexWrap: 'wrap' }}
                  >
                    <div style={{ fontSize: 28 }}>📝</div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>
                        {sol?.imovel_nome || 'Imóvel sem nome'}{sol?.imovel_cidade ? ` — ${sol.imovel_cidade}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        {cliente?.nome || '—'} · {cliente?.email || '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: '#eff6ff', color: '#1e40af' }}>{tipoLabel}</span>
                      {durMin && <span style={{ fontSize: 11, color: '#64748b' }}>⏱ {durMin} min</span>}
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{dataHora}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>{aberto ? '▲' : '▼'}</span>
                    </div>
                  </div>
                  {aberto && (
                    <div style={{ padding: '0 18px 18px', borderTop: '1px solid #f1f5f9' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '14px 0 8px' }}>Transcrição</div>
                      <div style={{ background: '#f8fafc', borderRadius: 8, padding: '14px 16px', fontSize: 13, color: '#374151', lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto', fontFamily: 'monospace' }}>
                        {t.transcricao || <em style={{ color: '#94a3b8', fontFamily: 'inherit' }}>Transcrição não disponível para esta reunião.</em>}
                      </div>
                      {t.daily_room_name && (
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>Sala: {t.daily_room_name}</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8', textAlign: 'right' }}>
          {filtradas.length} registro{filtradas.length !== 1 ? 's' : ''} encontrado{filtradas.length !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}

function CnjTab() {
  const [form, setForm] = React.useState({ numero: '', nome: '', uf: '' });
  const [buscando, setBuscando] = React.useState(false);
  const [resultado, setResultado] = React.useState(null);
  const [erro, setErro] = React.useState('');
  const [chat, setChat] = React.useState([]);
  const [pergunta, setPergunta] = React.useState('');
  const [perguntando, setPerguntando] = React.useState(false);
  const chatRef = React.useRef(null);

  async function buscar() {
    if (!form.numero && !form.nome) { setErro('Informe o número do processo ou nome da parte.'); return; }
    if (!form.uf) { setErro('UF é obrigatória.'); return; }
    setBuscando(true); setErro(''); setResultado(null); setChat([]);
    try {
      const r = await fetch('/api/cnj-datajud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero_processo: form.numero, nome_parte: form.nome, uf: form.uf }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro na consulta');
      setResultado(data);
    } catch (e) {
      setErro(e.message);
    } finally {
      setBuscando(false);
    }
  }

  async function enviarPergunta() {
    if (!pergunta.trim() || !resultado) return;
    const novaMensagem = { role: 'user', content: pergunta };
    const novoChat = [...chat, novaMensagem];
    setChat(novoChat); setPergunta(''); setPerguntando(true);
    try {
      const r = await fetch('/api/cnj-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagem: pergunta, contexto: resultado, historico: chat }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      setChat(prev => [...prev, { role: 'assistant', content: data.resposta }]);
    } catch (e) {
      setChat(prev => [...prev, { role: 'assistant', content: `Erro: ${e.message}` }]);
    } finally {
      setPerguntando(false);
      setTimeout(() => chatRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }), 100);
    }
  }

  function imprimir() {
    const w = window.open('', '_blank');
    w.document.write(`<html><head><title>Relatório CNJ</title><style>body{font-family:sans-serif;padding:32px;color:#0f172a}h1{font-size:20px}pre{white-space:pre-wrap;font-size:13px;background:#f8fafc;padding:16px;border-radius:8px}</style></head><body>`);
    w.document.write(`<h1>Relatório CNJ — ${new Date().toLocaleDateString('pt-BR')}</h1>`);
    if (form.numero) w.document.write(`<p><strong>Número:</strong> ${form.numero}</p>`);
    if (form.nome) w.document.write(`<p><strong>Parte:</strong> ${form.nome}</p>`);
    if (form.uf) w.document.write(`<p><strong>UF:</strong> ${form.uf}</p>`);
    w.document.write(`<pre>${JSON.stringify(resultado, null, 2)}</pre>`);
    if (chat.length > 0) {
      w.document.write('<h2>Análise</h2>');
      chat.forEach(m => w.document.write(`<p><strong>${m.role === 'user' ? 'Pergunta' : 'Resposta'}:</strong> ${m.content}</p>`));
    }
    w.document.write('</body></html>'); w.document.close(); w.print();
  }

  const processos = resultado?.processos || [];
  const parecer = resultado?.parecer;
  const NIVEL_COR = { verde: '#16a34a', amarelo: '#d97706', vermelho: '#dc2626' };
  const NIVEL_BG = { verde: '#f0fdf4', amarelo: '#fffbeb', vermelho: '#fef2f2' };
  const SEV_COR = { bloqueante: '#dc2626', alerta: '#d97706' };

  return (
    <div style={{ padding: '24px 0' }}>
      <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: '#0f172a', marginBottom: 20 }}>Consulta CNJ — DataJud</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end' }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Número do processo</div>
            <input value={form.numero} onChange={e => setForm(p => ({ ...p, numero: e.target.value }))}
              placeholder="0000000-00.0000.0.00.0000"
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>Nome da parte</div>
            <input value={form.nome} onChange={e => setForm(p => ({ ...p, nome: e.target.value }))}
              placeholder="Nome completo ou razão social"
              style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 4 }}>UF *</div>
            <select value={form.uf} onChange={e => setForm(p => ({ ...p, uf: e.target.value }))}
              style={{ padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14 }}>
              <option value="">Selecione</option>
              {['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map(u => <option key={u}>{u}</option>)}
            </select>
          </div>
        </div>
        {erro && <div style={{ marginTop: 12, color: '#dc2626', fontSize: 13 }}>{erro}</div>}
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <button onClick={buscar} disabled={buscando}
            style={{ padding: '10px 24px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: buscando ? 0.7 : 1 }}>
            {buscando ? 'Consultando...' : 'Consultar'}
          </button>
          {resultado && (
            <button onClick={imprimir}
              style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
              Imprimir / Exportar
            </button>
          )}
        </div>
      </div>

      {parecer && (
        <div style={{ background: NIVEL_BG[parecer.nivel] || '#f8fafc', border: `2px solid ${NIVEL_COR[parecer.nivel] || '#94a3b8'}`, borderRadius: 16, padding: 20, marginBottom: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: NIVEL_COR[parecer.nivel] || '#334155', marginBottom: 6 }}>
            {parecer.nivel === 'verde' ? '✅' : parecer.nivel === 'amarelo' ? '⚠️' : '🚫'} Parecer de risco
          </div>
          <div style={{ fontSize: 14, color: '#334155', lineHeight: 1.6, marginBottom: parecer.recomendacao ? 8 : 0 }}>{parecer.texto}</div>
          {parecer.recomendacao && <div style={{ fontSize: 13, color: '#64748b', fontStyle: 'italic' }}>{parecer.recomendacao}</div>}
        </div>
      )}

      {processos.length > 0 && (
        <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>
            {processos.length} processo{processos.length !== 1 ? 's' : ''} encontrado{processos.length !== 1 ? 's' : ''}
          </div>
          {processos.map((p, i) => (
            <div key={i} style={{ border: `1.5px solid ${p.tem_bloqueante ? '#fca5a5' : '#e2e8f0'}`, borderRadius: 12, padding: 20, marginBottom: 12, background: p.tem_bloqueante ? '#fff5f5' : 'white' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a' }}>{p.numero || '—'}</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 99 }}>{p.tribunal}</span>
                  {p.score_risco > 0 && <span style={{ fontSize: 11, background: p.score_risco >= 35 ? '#fee2e2' : '#fef3c7', color: p.score_risco >= 35 ? '#dc2626' : '#d97706', padding: '2px 8px', borderRadius: 99, fontWeight: 700 }}>Risco {p.score_risco}/100</span>}
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>{p.data_ajuizamento}</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 12 }}>
                {p.classe && <div><span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Classe</span><span style={{ fontSize: 13, color: '#334155' }}>{p.classe}</span></div>}
                {p.fase && <div><span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Fase</span><span style={{ fontSize: 13, color: '#334155' }}>{p.fase}</span></div>}
                {p.orgao && <div><span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Órgão</span><span style={{ fontSize: 13, color: '#334155' }}>{p.orgao}</span></div>}
                {p.assuntos && <div><span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Assunto</span><span style={{ fontSize: 13, color: '#334155' }}>{p.assuntos}</span></div>}
              </div>
              {p.riscos?.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  {p.riscos.map((r, j) => (
                    <span key={j} style={{ fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99, background: r.severidade === 'bloqueante' ? '#fee2e2' : '#fef3c7', color: SEV_COR[r.severidade] || '#64748b' }}>
                      {r.severidade === 'bloqueante' ? '🚫' : '⚠️'} {r.categoria}
                    </span>
                  ))}
                </div>
              )}
              {p.partes?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Partes</div>
                  {p.partes.map((parte, j) => (
                    <div key={j} style={{ fontSize: 13, color: '#334155', marginBottom: 2 }}>
                      <span style={{ fontWeight: 600 }}>{parte.tipo?.toUpperCase()}:</span> {parte.nome}
                      {parte.advogados?.length > 0 && <span style={{ color: '#64748b' }}> — Adv: {parte.advogados.map(a => a.nome).join(', ')}</span>}
                    </div>
                  ))}
                </div>
              )}
              {p.movimentos?.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Últimos movimentos</div>
                  {p.movimentos.slice(0, 5).map((m, j) => (
                    <div key={j} style={{ fontSize: 12, color: m.risco ? SEV_COR[m.risco] : '#334155', marginBottom: 2 }}>
                      <span style={{ color: '#94a3b8' }}>{m.data}</span> — {m.descricao}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {resultado && processos.length === 0 && (
        <div style={{ background: 'white', borderRadius: 16, padding: 28, marginBottom: 20, textAlign: 'center', color: '#94a3b8', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          Nenhum processo encontrado para os filtros informados.
        </div>
      )}

      {resultado && (
        <div style={{ background: 'white', borderRadius: 16, padding: 28, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 16 }}>Análise dos resultados</div>
          <div ref={chatRef} style={{ maxHeight: 340, overflowY: 'auto', marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {chat.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 20 }}>
                Faça uma pergunta sobre os processos encontrados para obter uma análise detalhada.
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: 12, background: m.role === 'user' ? '#2563eb' : '#f1f5f9', color: m.role === 'user' ? 'white' : '#1e293b', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {m.content}
                </div>
              </div>
            ))}
            {perguntando && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{ padding: '10px 14px', borderRadius: 12, background: '#f1f5f9', color: '#94a3b8', fontSize: 14 }}>Analisando...</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={pergunta} onChange={e => setPergunta(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && enviarPergunta()}
              placeholder="Ex: Qual é a situação atual? Há risco de penhora?"
              style={{ flex: 1, padding: '10px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14 }} />
            <button onClick={enviarPergunta} disabled={perguntando || !pergunta.trim()}
              style={{ padding: '10px 20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', opacity: (perguntando || !pergunta.trim()) ? 0.5 : 1 }}>
              Enviar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

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
        <button style={{ ...S.btn('outline'), background: 'transparent', color: '#94a3b8', border: '1px solid #334155', fontSize: 13 }} onClick={() => navigate('/buscar')}>
          ← Voltar ao app
        </button>
      </div>

      <div style={S.body}>
        <div style={S.tabs}>
          {TABS.map(t => (
            <button key={t} style={S.tab(tab === t)} onClick={() => setTab(t)}>{t}</button>
          ))}
          {role === 'admin' && (
            <button style={S.tab(tab === 'Marketing')} onClick={() => setTab('Marketing')}>Marketing</button>
          )}
        </div>

        {tab === 'Dashboard'      && <DashboardTab />}
        {tab === 'Cursos'         && <CursosTab />}
        {tab === 'eBooks'         && <EbooksTab />}
        {tab === 'Contratos'      && <ContratosTab />}
        {tab === 'Promoções'      && <PromoTab />}
        {tab === 'Convites'       && <ConvitesTab />}
        {tab === 'Usuários'       && <UsuariosTab />}
        {tab === 'Tour'           && <TourTab />}
        {tab === 'SDR / Leads'    && <SdrTab />}
        {tab === 'Equipe'         && <EquipeTab />}
        {tab === 'Scrapers'       && <ScrapersTab />}
        {tab === 'Registros'      && <RegistrosTab />}
        {tab === 'CNJ'            && <CnjTab />}
        {tab === 'Configurações'  && <ConfigTab />}
        {tab === 'Marketing'      && role === 'admin' && <MarketingTab />}
      </div>
    </div>
  );
}
