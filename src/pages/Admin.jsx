import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePlanos, PlanosProvider } from '../contexts/PlanosContext';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { extrairDadosDocumento, consolidarDocsImovel } from '../utils/claude';

export const DEFAULT_FEEDBACK_EMAIL = 'tarcisioaraujo@reimob.com.br';
const FEEDBACK_KEY = 'tsn_feedback_email';

// Papéis REAIS do sistema (planos_config + papéis de equipe/leiloeiro).
// 'top1' foi removido (Investidor Pro é 'top2'); 'leiloeiro' incluído (portal do parceiro).
const ROLES_DISPONIVEIS = [
  'admin','explorador','top2','assessorado','clube','consultor','afiliado','analista','advogado','leiloeiro',
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
  header: { background: '#111111', color: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56 },
  headerTitle: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.5px' },
  body: { padding: '24px 20px', maxWidth: 1100, margin: '0 auto' },
  tabs: { display: 'flex', gap: 4, marginBottom: 24, flexWrap: 'wrap' },
  tab: (active) => ({ padding: '8px 20px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14, background: active ? '#111111' : '#fff', color: active ? '#fff' : '#475569', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }),
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16 },
  btn: (variant = 'primary') => ({
    padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: variant === 'primary' ? '#111111' : variant === 'danger' ? '#ef4444' : variant === 'outline' ? '#fff' : '#64748b',
    color: variant === 'outline' ? '#111111' : '#fff',
    border: variant === 'outline' ? '1px solid #cbd5e1' : 'none',
  }),
  input: { width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  label: { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 14 },
  th: { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontWeight: 600, fontSize: 12 },
  td: { padding: '10px 12px', borderBottom: '1px solid #f1f5f9', color: '#111111' },
  badge: (ok) => ({ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: ok ? '#dcfce7' : '#fee2e2', color: ok ? '#166534' : '#991b1b' }),
  overlay: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflowY: 'auto', padding: '40px 16px' },
  modal: { background: '#fff', borderRadius: 14, padding: 28, width: '100%', maxWidth: 680, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' },
  row: { display: 'flex', gap: 12, marginBottom: 14 },
  col: { flex: 1 },
  sectionTitle: { fontSize: 16, fontWeight: 700, color: '#111111', marginBottom: 12 },
  subTitle: { fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8 },
  accessDenied: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 16 },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CURSOS TAB
// ═══════════════════════════════════════════════════════════════════════════════
// Planos que podem receber ACESSO GRÁTIS a um curso/ebook (quem não estiver
// marcado paga o preço). Chaves batem com o role/plano do perfil.
const PLANOS_ACESSO = [
  { key: 'explorador',  label: 'Explorador (grátis)' },
  { key: 'top2',        label: 'Investidor Pro (mensal)' },
  { key: 'top2_anual',  label: 'Investidor Pro (anual)' },
  { key: 'assessorado', label: 'Assessoria' },
  { key: 'clube',       label: 'Leilão Club' },
];

function defaultCurso() {
  return { titulo: '', subtitulo: '', descricao: '', emoji: '📚', cor: '#0D63DB', nivel: 'Iniciante', categoria: 'Fundamentos', preco: '', gratuito: false, destaque: false, comissao_pct: 30, planos_gratis: [], modulos: [] };
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
      const cursoPayload = { titulo: rest.titulo, subtitulo: rest.subtitulo || '', descricao: rest.descricao || '', emoji: rest.emoji || '📚', cor: rest.cor || '#0D63DB', nivel: rest.nivel || 'Iniciante', categoria: rest.categoria || 'Fundamentos', preco: Number(rest.preco) || 0, gratuito: rest.gratuito || false, destaque: rest.destaque || false, comissao_pct: Number(rest.comissao_pct) || 30, planos_gratis: Array.isArray(rest.planos_gratis) ? rest.planos_gratis : [], ativo: rest.ativo !== false };

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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111111', margin: 0 }}>Cursos</h2>
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
                  <th style={S.th}>Aulas</th>
                  <th style={S.th}>Nível</th>
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Ações</th>
                </tr></thead>
                <tbody>
                  {cursos.map(c => (
                    <tr key={c.id}>
                      <td style={S.td}><span style={{ marginRight: 6 }}>{c.emoji}</span><strong>{c.titulo}</strong></td>
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
            </div>

            <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
              <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: '#374151' }}>
                <input type="checkbox" checked={form.gratuito} onChange={e => setForm({ ...form, gratuito: e.target.checked })} /> Gratuito
              </label>
              <label style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, color: '#374151' }}>
                <input type="checkbox" checked={form.destaque || false} onChange={e => setForm({ ...form, destaque: e.target.checked })} /> Destaque
              </label>
            </div>
            {!form.gratuito && (
              <div style={{ marginBottom: 14 }}>
                <PlanosGratisSelector valor={form.planos_gratis} onChange={v => setForm({ ...form, planos_gratis: v })} />
              </div>
            )}
            <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'9px 12px', fontSize:12, color:'#084BA6', marginBottom:14 }}>
              💡 Preço e comissão são configurados na aba <strong>Configurações</strong>.
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
function defaultEbook() { return { titulo: '', descricao: '', capa_url: '', arquivo_url: '', preco: '', planos_gratis: [] }; }

// Seletor reutilizável de "planos com acesso grátis" (chips clicáveis).
function PlanosGratisSelector({ valor, onChange }) {
  const sel = Array.isArray(valor) ? valor : [];
  const toggle = (k) => onChange(sel.includes(k) ? sel.filter(x => x !== k) : [...sel, k]);
  return (
    <div>
      <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
        Planos com acesso grátis <span style={{ color: '#94a3b8', fontWeight: 400 }}>— quem não estiver marcado paga o preço</span>
      </label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {PLANOS_ACESSO.map(p => {
          const on = sel.includes(p.key);
          return (
            <button key={p.key} type="button" onClick={() => toggle(p.key)}
              style={{ padding: '6px 12px', borderRadius: 20, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                border: `1px solid ${on ? '#10b981' : '#e2e8f0'}`, background: on ? '#ecfdf5' : '#fff', color: on ? '#047857' : '#64748b' }}>
              {on ? '✓ ' : ''}{p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
      const payload = { titulo: form.titulo, descricao: form.descricao || '', capa_url: form.capa_url || '', arquivo_url: form.arquivo_url || '', preco: Number(form.preco) || 0, planos_gratis: Array.isArray(form.planos_gratis) ? form.planos_gratis : [], ativo: form.ativo !== false };
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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111111', margin: 0 }}>eBooks / Materiais</h2>
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
                  <th style={S.th}>Status</th>
                  <th style={S.th}>Ações</th>
                </tr></thead>
                <tbody>
                  {ebooks.map(e => (
                    <tr key={e.id}>
                      <td style={S.td}><strong>{e.titulo}</strong><br /><span style={{ fontSize: 12, color: '#94a3b8' }}>{e.descricao?.slice(0, 60)}</span></td>
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
            <div style={{ marginBottom: 16 }}>
              <PlanosGratisSelector valor={form.planos_gratis} onChange={v => setForm({ ...form, planos_gratis: v })} />
            </div>
            <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:8, padding:'9px 12px', fontSize:12, color:'#084BA6', marginBottom:20 }}>
              💡 Preço é configurado na aba <strong>Configurações</strong>.
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
  const [auditoriaUser, setAuditoriaUser] = useState(null);
  const [auditoriaData, setAuditoriaData] = useState(null);
  const [auditoriaLoading, setAuditoriaLoading] = useState(false);
  const [atribUser, setAtribUser] = useState(null);   // usuário recebendo a atribuição de arremate
  const [atribForm, setAtribForm] = useState({ endereco: '', valor: '', tipo: 'extrajudicial', cidade: '', estado: '', numero_processo: '' });
  const [atribExtraindo, setAtribExtraindo] = useState('');   // '' | 'lendo' | 'ok' | 'erro'
  const [atribDocs, setAtribDocs] = useState([]);             // [{ nome, status }] dos anexos lidos
  const atribFilesRef = useRef([]);                           // File[] p/ persistir no imóvel-âncora

  // tipo do anexo a partir do nome do arquivo (o ciclo do arremate alimenta a IA).
  const inferirTipoAnexo = (nome) => {
    const s = String(nome || '').toLowerCase();
    if ((s.includes('matric') || s.includes('matríc')) && s.includes('registr')) return 'matricula_registrada';
    if (s.includes('carta') && s.includes('arremat')) return 'carta_arrematacao';
    if (s.includes('auto') && s.includes('arremat')) return 'auto_arrematacao';
    if (s.includes('contrato') && (s.includes('banc') || s.includes('financ') || s.includes('caixa') || s.includes('cef'))) return 'contrato_banco';
    if (s.includes('escritura') || s.includes('lavratura')) return 'escritura';
    if (s.includes('boleto') && s.includes('sinal')) return 'boleto_sinal';
    if (s.includes('boleto') || s.includes('aquisic') || s.includes('aquisiç')) return 'boleto_aquisicao';
    if (s.includes('matric') || s.includes('matríc')) return 'matricula';
    if (s.includes('edital')) return 'edital';
    if (s.includes('regras')) return 'regras_venda';
    return 'outro';
  };

  // Inclusão por ANEXO(S): o admin sobe o edital + a matrícula (vários PDFs) do
  // arremate e a IA extrai endereço, valor e tipo de TODOS, mesclando o resultado
  // (endereço da matrícula, valor do edital…). Revisável. Mesma extração da análise.
  const removerAtribDoc = (i) => {
    setAtribDocs(prev => prev.filter((_, idx) => idx !== i));
    atribFilesRef.current = atribFilesRef.current.filter((_, idx) => idx !== i);
  };

  const extrairArremateDocs = async (files) => {
    // Aceita por MIME OU por extensão — alguns sistemas não marcam o type do PDF.
    const lista = Array.from(files || []).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name || ''));
    if (!lista.length) { if ((files?.length || 0) > 0) alert('Envie os documentos em PDF.'); return; }
    setAtribExtraindo('lendo');
    atribFilesRef.current = [...atribFilesRef.current, ...lista]; // guarda p/ persistir depois
    setAtribDocs(prev => [...prev, ...lista.map(f => ({ nome: f.name, status: 'lendo' }))]);
    const marcar = (nome, status) => setAtribDocs(prev => { let feito = false; return prev.map(d => (!feito && d.nome === nome && d.status === 'lendo') ? (feito = true, { ...d, status }) : d); });
    // 1) LÊ e CLASSIFICA TODOS os documentos ANTES de preencher (nada de preencher no 1º match).
    const exts = [];
    let algum = false;
    for (const file of lista) {
      try {
        const buf = await file.arrayBuffer();
        let bin = ''; const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const b64 = btoa(bin);
        const ext = await extrairDadosDocumento('', b64);
        if (!ext) throw new Error('sem dados');
        exts.push(ext);
        algum = true;
        marcar(file.name, 'ok');
      } catch { marcar(file.name, 'erro'); }
    }
    // 2) CONSOLIDA por prioridade de tipo: matrícula manda no endereço/área; laudo/edital na
    //    avaliação; edital no lance/processo. NUNCA usa endereço/área de comprovante/boleto.
    const m = consolidarDocsImovel(exts);
    const local = [m.cidade, m.estado].filter(Boolean).join('/');
    const enderecoFull = [m.endereco, local].filter(Boolean).join(', ');
    const valorArr = Number(m.valorArrematacao || m.valorAvaliacao || 0) || 0;
    const tipoLeilao = /judicial/i.test(m.modalidade || '') && !/extra/i.test(m.modalidade || '') ? 'judicial' : (/extra/i.test(m.modalidade || '') ? 'extrajudicial' : '');
    setAtribForm(p => ({
      ...p,
      endereco: enderecoFull || p.endereco,
      valor: valorArr ? valorArr.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : p.valor,
      tipo: tipoLeilao || p.tipo,
      cidade: m.cidade || p.cidade,
      estado: m.estado || p.estado,
      numero_processo: m.numeroProcesso || p.numero_processo,
      valor_avaliacao: m.valorAvaliacao || p.valor_avaliacao,
    }));
    setAtribExtraindo(algum ? 'ok' : 'erro');
  };
  const [atribLoad, setAtribLoad] = useState(false);
  const [exito, setExito] = useState(null); // editor do % de êxito INDIVIDUAL do membro da equipe
  const [comAfiliado, setComAfiliado] = useState(null); // editor do % de comissão do afiliado/consultor (modal)

  // Abre o editor do % de êxito individual deste membro (advogado/analista/consultor).
  // O admin sempre recebe o saldo (total − soma dos envolvidos), então não tem editor aqui.
  const abrirExito = async (u) => {
    setExito({ user: u, loading: true });
    try {
      const res = await apiCall('/api/honorarios-split?equipe=1');
      const d = await res.json();
      if (!res.ok) { setExito({ user: u, loading: false, msg: d.error || 'Erro ao carregar.' }); return; }
      const membro = (d.membros || []).find(m => m.id === u.id);
      const padrao = d.padrao?.[u.role] ?? 0;
      setExito({
        user: u, loading: false, total_pct: d.total_pct, padrao,
        usarPadrao: membro ? membro.pct_individual == null : true,
        valor: membro && membro.pct_individual != null ? String(membro.pct_individual) : String(padrao),
      });
    } catch { setExito({ user: u, loading: false, msg: 'Erro ao carregar.' }); }
  };
  const salvarExito = async () => {
    if (!exito?.user) return;
    setExito(e => ({ ...e, saving: true, msg: '' }));
    try {
      const pct = exito.usarPadrao ? null : Number(exito.valor);
      const res = await apiCall('/api/honorarios-split', { method: 'POST', body: JSON.stringify({ user_id: exito.user.id, pct }) });
      const d = await res.json();
      setExito(e => ({ ...e, saving: false, msg: res.ok ? 'salvo' : (d.error || 'Erro ao salvar.') }));
    } catch { setExito(e => ({ ...e, saving: false, msg: 'Erro ao salvar.' })); }
  };

  // Editor (modal) do % de comissão do afiliado/consultor sobre as vendas do link dele.
  const abrirComissaoAfiliado = async (u) => {
    setComAfiliado({ user: u, loading: true });
    try {
      const { data } = await supabase.from('perfis').select('comissao_afiliado_pct, vendedor_tipo').eq('id', u.id).single();
      setComAfiliado({ user: u, loading: false, valor: String(data?.comissao_afiliado_pct ?? 0), tipo: data?.vendedor_tipo || u.role });
    } catch { setComAfiliado({ user: u, loading: false, valor: '0', msg: 'Erro ao carregar.' }); }
  };
  const salvarComissaoAfiliado = async () => {
    if (!comAfiliado?.user) return;
    const pct = Math.max(0, Math.min(100, Number(String(comAfiliado.valor).replace(',', '.')) || 0));
    setComAfiliado(c => ({ ...c, saving: true, msg: '' }));
    const { error } = await supabase.from('perfis').update({ comissao_afiliado_pct: pct }).eq('id', comAfiliado.user.id);
    setComAfiliado(c => ({ ...c, saving: false, valor: String(pct), msg: error ? (error.message || 'Erro ao salvar.') : 'salvo' }));
  };

  const verComo = (u) => {
    iniciarSuporte({ id: u.id, nome: u.nome || u.cpf, role: u.role || 'explorador' });
    navSup('/'); // entra na Home por plano do cliente (não mais no Portfólio antigo)
  };

  const [planosCfg, setPlanosCfg] = useState([]);
  const [cpfMasc, setCpfMasc] = useState({}); // { userId: '•••.•••.XXX-••' } — vindo do backend
  const loadUsers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('perfis').select('id, nome, role, role_anterior, plano, created_at, ativo').order('created_at', { ascending: false });
    setUsers(data || []);
    setLoading(false);
    // CPF mascarado vem do backend (o texto claro não trafega mais para o navegador).
    const ids = (data || []).map(u => u.id);
    if (ids.length) {
      try {
        const r = await apiCall('/api/cpf-revelar', { method: 'POST', body: JSON.stringify({ ids }) });
        const d = await r.json();
        setCpfMasc(d?.cpfs || {});
      } catch { /* mostra '—' */ }
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  useEffect(() => { supabase.from('planos_config').select('plano_key, nome, preco').then(({ data }) => setPlanosCfg(data || [])); }, []);

  // Rótulos de equipe/parceiro que não são "plano de cliente".
  const ROLE_EXTRA = { admin: 'Administrador', leiloeiro: 'Leiloeiro' };
  const STAFF = ['admin', 'consultor', 'analista', 'advogado', 'leiloeiro'];
  // Nome amigável do role (nunca mostra a chave interna crua tipo "top2").
  const labelRole = (role) => (planosCfg.find(p => p.plano_key === role)?.nome) || ROLE_EXTRA[role] || role || 'Explorador';
  // Plano do cliente DERIVADO do role (a coluna perfis.plano está obsoleta —
  // vale sempre 'gratuito'). Assim um plano pago nunca aparece como gratuito.
  const planoInfo = (role) => {
    if (STAFF.includes(role)) return { txt: 'Equipe', pago: false, neutro: true };
    const cfg = planosCfg.find(p => p.plano_key === role);
    const pago = Number(cfg?.preco || 0) > 0;
    if (role === 'explorador' || !role) return { txt: 'Gratuito', pago: false };
    return { txt: cfg?.nome || role, pago };
  };

  async function saveRole(id) {
    await supabase.from('perfis').update({ role: newRole }).eq('id', id);
    setUsers(users.map(u => u.id === id ? { ...u, role: newRole } : u));
    setEditingId(null);
  }

  async function toggleAtivo(u) {
    const estaAtivo = u.ativo !== false;
    if (estaAtivo) {
      // Desativar um vendedor faz perder o comissionamento DE VEZ (não volta ao reativar).
      await supabase.from('perfis').update({ ativo: false, role_anterior: u.role, comissionamento_bloqueado: true }).eq('id', u.id);
      setUsers(users.map(x => x.id === u.id ? { ...x, ativo: false, role_anterior: u.role } : x));
    } else {
      const roleRestaurado = u.role_anterior || u.role;
      await supabase.from('perfis').update({ ativo: true, role: roleRestaurado, role_anterior: null }).eq('id', u.id);
      setUsers(users.map(x => x.id === u.id ? { ...x, ativo: true, role: roleRestaurado, role_anterior: null } : x));
    }
  }

  async function loadAuditoria(userId) {
    setAuditoriaLoading(true);
    try {
      const [aceiteRes, contratoRes, compraRes] = await Promise.all([
        supabase.from('aceites_plano').select('*').eq('user_id', userId).order('aceito_em', { ascending: false }),
        supabase.from('contratos_pendentes').select('*').eq('user_id', userId).order('criado_em', { ascending: false }),
        supabase.from('compras_produtos').select('*').eq('user_id', userId).order('criado_em', { ascending: false }),
      ]);
      setAuditoriaData({
        aceites: aceiteRes.data || [],
        contratos: contratoRes.data || [],
        compras: compraRes.data || [],
      });
    } catch (e) {
      setAuditoriaData({ aceites: [], contratos: [], compras: [] });
    } finally {
      setAuditoriaLoading(false);
    }
  }

  function abrirAuditoria(u) {
    setAuditoriaUser(u);
    setAuditoriaData(null);
    loadAuditoria(u.id);
  }

  // Atribui um arremate ao usuário: cria o caso (arrematado) e o promove a Assessorado.
  async function atribuirArremate() {
    if (!atribUser) return;
    setAtribLoad(true);
    try {
      const res = await apiCall('/api/atribuir-arremate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: atribUser.id, imovel_endereco: atribForm.endereco, imovel_valor: atribForm.valor, tipo_leilao: atribForm.tipo, cidade: atribForm.cidade || null, estado: atribForm.estado || null, numero_processo: atribForm.numero_processo || null, valor_avaliacao: atribForm.valor_avaliacao || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao atribuir');
      setUsers(users.map(u => u.id === atribUser.id ? { ...u, role: 'assessorado' } : u));
      const casoId = data.caso_id;
      const imovelId = data.imovel_id;   // imóvel-âncora: chave dos anexos e dos 3 relatórios
      const alvoId = atribUser.id;
      const alvoNome = atribUser.nome || atribUser.cpf;
      const end = atribForm.endereco; const tipo = atribForm.tipo;
      const cid = atribForm.cidade; const est = atribForm.estado;
      const valorNum = Number(String(atribForm.valor || '').replace(/\./g, '').replace(',', '.')) || 0;

      // Persiste os PDFs anexados (auto de arrematação + edital/matrícula) no imóvel-
      // âncora — é o material real que os relatórios leem e que alimenta a IA. Tipo
      // inferido do nome do arquivo. Best-effort: não bloqueia a promoção.
      const arquivos = atribFilesRef.current || [];
      if (imovelId && arquivos.length) {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          const auth = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
          for (const file of arquivos) {
            try {
              const fd = new FormData();
              fd.append('file', file);
              fd.append('imovel_id', imovelId);
              fd.append('tipo', inferirTipoAnexo(file.name));
              fd.append('arrematado', 'true'); // arremate real → permanente (nunca apagado)
              await fetch('/api/upload-anexo', { method: 'POST', headers: auth, body: fd });
            } catch { /* segue com os demais */ }
          }
        } catch { /* sem sessão: os docs podem ser anexados na análise */ }
      }
      atribFilesRef.current = [];
      setAtribUser(null);
      // A atribuição NÃO exige contrato (só planos/produtos/serviços com contrato
      // atribuído exigem). Roteamento: abrir a análise deste arremate (chave = IMÓVEL-
      // ÂNCORA) para gerar os 3 relatórios EM NOME DO cliente — o material real
      // alimenta o aprendizado da IA.
      if ((imovelId || casoId) && window.confirm('Arremate atribuído e usuário promovido a Assessorado.\n\nAbrir a análise e GERAR OS 3 RELATÓRIOS automaticamente (mercadológico → documental → laudo), lendo os anexos?')) {
        iniciarSuporte({ id: alvoId, nome: alvoNome, role: 'assessorado' });
        navSup('/analise', { state: { manual: true, autoGerar: true, paraUserId: alvoId, imovel: { id: imovelId || casoId, endereco: end, cidade: cid, estado: est, valorMinimo: valorNum, modalidade: /judicial/i.test(tipo) ? 'judicial' : 'extrajudicial' } } });
      }
    } catch (e) {
      alert('Erro ao atribuir arremate: ' + (e.message || e));
    } finally { setAtribLoad(false); }
  }

  const filtered = users.filter(u => {
    if (!busca) return true;
    const q = busca.toLowerCase();
    return (u.nome || '').toLowerCase().includes(q) || (cpfMasc[u.id] || '').includes(q) || (u.role || '').toLowerCase().includes(q) || labelRole(u.role).toLowerCase().includes(q);
  });

  const ROLE_COLORS = { admin: '#7c3aed', explorador: '#64748b', top2: '#7c3aed', assessorado: '#d97706', clube: '#059669', consultor: '#0891b2', afiliado: '#db2777', analista: '#f59e0b', advogado: '#dc2626', leiloeiro: '#ea580c' };
  const fmtData = v => v ? new Date(v).toLocaleDateString('pt-BR') : '—';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111111', margin: 0 }}>Usuários ({users.length})</h2>
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
                        <td style={S.td}>{cpfMasc[u.id] || '—'}</td>
                        <td style={S.td}>
                          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, background: (ROLE_COLORS[u.role] || '#64748b') + '20', color: ROLE_COLORS[u.role] || '#64748b' }}>
                            {labelRole(u.role)}
                          </span>
                        </td>
                        <td style={S.td}>
                          {(() => { const pi = planoInfo(u.role); return (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ color: pi.neutro ? '#94a3b8' : '#111111', fontWeight: pi.pago ? 700 : 400 }}>{pi.txt}</span>
                              {pi.pago && <span style={{ fontSize: 10, fontWeight: 800, color: '#059669', background: '#d1fae5', borderRadius: 6, padding: '1px 6px' }}>PAGO</span>}
                            </span>
                          ); })()}
                        </td>
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
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button style={S.btn('outline')} onClick={() => { setEditingId(u.id); setNewRole(u.role || 'explorador'); }}>Alterar role</button>
                              <button style={S.btn('outline')} onClick={() => verComo(u)} title="Entrar na conta do usuário (modo suporte)">👁 Ver como</button>
                              <button
                                style={{ padding: '5px 10px', background: ativo ? '#fee2e2' : '#dcfce7', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: ativo ? '#dc2626' : '#166534', cursor: 'pointer' }}
                                onClick={() => toggleAtivo(u)}>
                                {ativo ? 'Inativar' : 'Reativar'}
                              </button>
                              <button
                                style={{ padding: '5px 10px', background: '#eff6ff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#0D63DB', cursor: 'pointer' }}
                                onClick={() => abrirAuditoria(u)}>
                                🔍 Auditoria
                              </button>
                              {u.role !== 'assessorado' && (
                                <button
                                  style={{ padding: '5px 10px', background: '#fef9c3', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#a16207', cursor: 'pointer' }}
                                  onClick={() => { setAtribUser(u); setAtribForm({ endereco: '', valor: '', tipo: 'extrajudicial', cidade: '', estado: '', numero_processo: '' }); setAtribExtraindo(''); setAtribDocs([]); atribFilesRef.current = []; }}
                                  title="Atribuir uma arrematação a este usuário e torná-lo Assessorado (habilita o acompanhamento e os lançamentos)">
                                  🏷 Atribuir arremate
                                </button>
                              )}
                              {['advogado','analista','consultor'].includes(u.role) && (
                                <button
                                  style={{ padding: '5px 10px', background: '#f0fdf4', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#059669', cursor: 'pointer' }}
                                  onClick={() => abrirExito(u)} title="% de êxito individual deste membro (o admin recebe o saldo)">
                                  💰 Êxito
                                </button>
                              )}
                              {['consultor','afiliado'].includes(u.role) && (
                                <button
                                  style={{ padding: '5px 10px', background: '#fce7f3', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#db2777', cursor: 'pointer' }}
                                  title="% de comissão sobre as vendas que vierem pelo link deste consultor/afiliado"
                                  onClick={() => abrirComissaoAfiliado(u)}>
                                  🔗 Comissão
                                </button>
                              )}
                              {u.role !== 'admin' && (
                                <button
                                  style={{ padding: '5px 10px', background: '#fdf2f8', border: '1px solid #fbcfe8', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#db2777', cursor: 'pointer' }}
                                  title="Habilita a capacidade de vender nesta conta (mantém o plano/função). Cliente pagante continua cliente e também ganha comissão."
                                  onClick={async () => {
                                    const tipo = window.prompt('Habilitar venda como? Digite "afiliado" (só comissão) ou "consultor" (com carteira):', 'afiliado');
                                    if (tipo === null) return;
                                    const t = tipo.trim().toLowerCase() === 'consultor' ? 'consultor' : 'afiliado';
                                    const v = window.prompt(`Comissão de ${u.nome || 'membro'} sobre as vendas pelo link dele (%):`, '10');
                                    if (v === null) return;
                                    const pct = Math.max(0, Math.min(100, Number(String(v).replace(',', '.')) || 0));
                                    let codigo = null;
                                    try { const { data } = await supabase.rpc('gerar_codigo_indicacao', { p_id: u.id }); codigo = data; } catch { /* segue */ }
                                    const { error } = await supabase.from('perfis').update({ vendedor_tipo: t, comissao_afiliado_pct: pct, comissionamento_bloqueado: false }).eq('id', u.id);
                                    window.alert(error ? ('Erro: ' + error.message) : `Venda habilitada como ${t} (${pct}%)${codigo ? `, código ${codigo}` : ''}. A pessoa mantém o plano/função atual.`);
                                  }}>
                                  📣 Habilitar venda
                                </button>
                              )}
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

      {/* Modal — Atribuir arremate (torna Assessorado) */}
      {atribUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setAtribUser(null); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#111', marginBottom: 4 }}>🏷 Atribuir arremate</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 16, lineHeight: 1.5 }}>
              Promove <b>{atribUser?.nome || atribUser?.cpf || 'o usuário'}</b> a <b>Assessorado</b> — sem cobrança.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Anexos (matrícula, edital, outros). A IA lê e preenche o resto sozinha. */}
              <div style={{ background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 6 }}>📎 Anexos do arremate</div>
                <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.5, marginBottom: 10 }}>Anexe a matrícula, o edital e outros documentos, se houver (vários PDFs).</div>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', background: atribExtraindo === 'lendo' ? '#e2e8f0' : '#0D63DB', color: atribExtraindo === 'lendo' ? '#94a3b8' : 'white', borderRadius: 8, fontWeight: 700, fontSize: 12.5, cursor: atribExtraindo === 'lendo' ? 'default' : 'pointer' }}>
                  {atribExtraindo === 'lendo' ? '⏳ Lendo…' : (atribDocs.length ? '📎 Anexar mais' : '📎 Anexar documentos (PDF)')}
                  {/* Captura os arquivos ANTES de limpar o input (senão a FileList
                      esvazia e a lista some). */}
                  <input type="file" accept="application/pdf,.pdf" multiple disabled={atribExtraindo === 'lendo'} onChange={e => { const fs = Array.from(e.target.files || []); e.target.value = ''; extrairArremateDocs(fs); }} style={{ display: 'none' }} />
                </label>
                {atribDocs.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.4 }}>Anexos ({atribDocs.length})</div>
                    {atribDocs.map((d, i) => (
                      <div key={i} style={{ fontSize: 11.5, color: '#334155', display: 'flex', alignItems: 'center', gap: 6, background: 'white', border: '1px solid #e2e8f0', borderRadius: 7, padding: '5px 8px' }}>
                        <span>{d.status === 'ok' ? '✅' : d.status === 'erro' ? '⚠️' : '⏳'}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.nome}</span>
                        {d.status === 'erro' && <span style={{ color: '#b45309', fontSize: 10 }}>não lido (guardado)</span>}
                        <button type="button" onClick={() => removerAtribDoc(i)} title="Remover" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', padding: 0, lineHeight: 1, fontSize: 15 }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
                {atribExtraindo === 'ok' && <div style={{ fontSize: 11, color: '#15803d', fontWeight: 700, marginTop: 8 }}>✓ Documentos lidos.</div>}
                {atribExtraindo === 'erro' && atribDocs.every(d => d.status === 'erro') && <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700, marginTop: 8 }}>Não consegui ler os documentos (o anexo mesmo assim fica guardado).</div>}
              </div>
              {/* Único campo a informar — o resto vem dos documentos. */}
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Valor arrematado (R$)</label>
                <input value={atribForm.valor} onChange={e => setAtribForm(p => ({ ...p, valor: e.target.value }))} placeholder="0,00" style={S.input} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button onClick={() => setAtribUser(null)} style={{ flex: 1, padding: '10px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', color: '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={atribuirArremate} disabled={atribLoad} style={{ flex: 2, padding: '10px', background: atribLoad ? '#cbd5e1' : '#a16207', color: 'white', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: atribLoad ? 'default' : 'pointer' }}>
                {atribLoad ? 'Atribuindo…' : 'Atribuir e tornar Assessorado'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Auditoria */}
      {auditoriaUser && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => { if (e.target === e.currentTarget) setAuditoriaUser(null); }}>
          <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: '100%', maxWidth: 700, maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ fontSize: 17, fontWeight: 800, color: '#111111', margin: 0 }}>
                Auditoria — {auditoriaUser?.nome || auditoriaUser?.cpf || auditoriaUser?.id || 'Usuário'}
              </h3>
              <button onClick={() => setAuditoriaUser(null)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            </div>

            {auditoriaLoading ? (
              <p style={{ color: '#94a3b8', textAlign: 'center', padding: 32 }}>Carregando auditoria...</p>
            ) : auditoriaData && (
              <>
                {/* Aceites de Termos */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Aceites de Termos</div>
                  {auditoriaData.aceites.length === 0 ? (
                    <p style={{ fontSize: 13, color: '#94a3b8' }}>Nenhum registro.</p>
                  ) : (
                    <table style={{ ...S.table, fontSize: 12 }}>
                      <thead><tr>
                        <th style={S.th}>Data</th>
                        <th style={S.th}>Plano</th>
                        <th style={S.th}>Valor</th>
                        <th style={S.th}>Versão Termos</th>
                        <th style={S.th}>ID Asaas</th>
                        <th style={S.th}>IP</th>
                        <th style={S.th}>Dispositivo</th>
                      </tr></thead>
                      <tbody>
                        {auditoriaData.aceites.map((a, i) => (
                          <tr key={i}>
                            <td style={S.td}>{fmtData(a.aceito_em)}</td>
                            <td style={S.td}>{a.plano_key || a.plano || '—'}</td>
                            <td style={S.td}>{a.valor != null ? `R$ ${Number(a.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                            <td style={S.td}>{a.versao_termos || a.termos_versao || '—'}</td>
                            <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{a.asaas_customer_id || a.asaas_id || a.asaas_payment_id || '—'}</td>
                            <td style={{ ...S.td, fontFamily: 'monospace', fontSize: 11 }}>{a.ip || '—'}</td>
                            <td style={{ ...S.td, fontSize: 11, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={a.user_agent || ''}>{a.user_agent || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Contratos */}
                <div style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Contratos</div>
                  {auditoriaData.contratos.length === 0 ? (
                    <p style={{ fontSize: 13, color: '#94a3b8' }}>Nenhum registro.</p>
                  ) : (
                    <table style={{ ...S.table, fontSize: 12 }}>
                      <thead><tr>
                        <th style={S.th}>Data</th>
                        <th style={S.th}>Produto</th>
                        <th style={S.th}>Status</th>
                        <th style={S.th}>Expira em</th>
                      </tr></thead>
                      <tbody>
                        {auditoriaData.contratos.map((c, i) => {
                          const stBg = c.status === 'assinado' ? '#dcfce7' : c.status === 'expirado' ? '#fee2e2' : '#fef9c3';
                          const stColor = c.status === 'assinado' ? '#166534' : c.status === 'expirado' ? '#991b1b' : '#92400e';
                          return (
                            <tr key={i}>
                              <td style={S.td}>{fmtData(c.criado_em)}</td>
                              <td style={S.td}>{c.produto_tipo} / {c.produto_id}</td>
                              <td style={S.td}>
                                <span style={{ background: stBg, color: stColor, padding: '2px 8px', borderRadius: 999, fontWeight: 700, fontSize: 11 }}>{c.status}</span>
                              </td>
                              <td style={S.td}>{fmtData(c.expira_em)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Compras de Produtos */}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#374151', marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>Compras de Produtos</div>
                  {auditoriaData.compras.length === 0 ? (
                    <p style={{ fontSize: 13, color: '#94a3b8' }}>Nenhum registro.</p>
                  ) : (
                    <table style={{ ...S.table, fontSize: 12 }}>
                      <thead><tr>
                        <th style={S.th}>Data</th>
                        <th style={S.th}>Produto</th>
                        <th style={S.th}>Valor</th>
                        <th style={S.th}>Status</th>
                      </tr></thead>
                      <tbody>
                        {auditoriaData.compras.map((cp, i) => (
                          <tr key={i}>
                            <td style={S.td}>{fmtData(cp.criado_em)}</td>
                            <td style={S.td}>{cp.produto_tipo || '—'} / {cp.produto_id || '—'}</td>
                            <td style={S.td}>{cp.valor != null ? `R$ ${Number(cp.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}</td>
                            <td style={S.td}>{cp.status || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal — % de êxito INDIVIDUAL do membro (o admin recebe o saldo) */}
      {exito && (
        <div onClick={() => !exito.saving && setExito(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 22, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 2 }}>% de êxito — {exito.user?.nome || exito.user?.cpf || 'Membro'}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.5 }}>
              Percentual individual deste <strong>{exito.user?.role}</strong> sobre o êxito das arrematações que ele atender.
              O admin sempre recebe o <strong>saldo</strong> (total − soma dos envolvidos). Vale só para vendas finalizadas
              <strong> depois</strong> desta configuração — não altera arremates já distribuídos.
            </div>
            {exito.loading ? (
              <div style={{ color: '#94a3b8', fontSize: 14, padding: 20, textAlign: 'center' }}>Carregando…</div>
            ) : exito.padrao == null && exito.msg && exito.msg !== 'salvo' ? (
              <div style={{ color: '#dc2626', fontSize: 13, padding: 14, background: '#fef2f2', borderRadius: 10 }}>{exito.msg}</div>
            ) : (
              <>
                <div style={{ fontSize: 12.5, color: '#334155', marginBottom: 12 }}>
                  Padrão do papel <strong>{exito.user?.role}</strong>: <strong>{Number(exito.padrao).toFixed(2)}%</strong> · êxito total {Number(exito.total_pct).toFixed(2)}%
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#334155', marginBottom: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={exito.usarPadrao} onChange={e => setExito(x => ({ ...x, usarPadrao: e.target.checked, valor: e.target.checked ? String(x.padrao) : x.valor, msg: '' }))} />
                  Usar o padrão do papel ({Number(exito.padrao).toFixed(2)}%)
                </label>
                {!exito.usarPadrao && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>% individual</div>
                    <input type="number" step="0.1" min="0" max={exito.total_pct} value={exito.valor}
                      onChange={e => setExito(x => ({ ...x, valor: e.target.value, msg: '' }))}
                      style={{ width: 80, padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 700, textAlign: 'right' }} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>%</span>
                  </div>
                )}
                {exito.msg && exito.msg !== 'salvo' && <div style={{ fontSize: 12.5, color: '#dc2626', marginBottom: 10 }}>{exito.msg}</div>}
                {exito.msg === 'salvo' && <div style={{ fontSize: 12.5, color: '#16a34a', marginBottom: 10 }}>% de êxito salvo. Vale para as próximas arrematações.</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setExito(null)} disabled={exito.saving} style={{ padding: '8px 16px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Fechar</button>
                  <button onClick={salvarExito} disabled={exito.saving} style={{ padding: '8px 16px', background: '#059669', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: exito.saving ? 'default' : 'pointer' }}>{exito.saving ? 'Salvando…' : 'Salvar'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal — % de comissão do afiliado/consultor (padroniza o antigo prompt) */}
      {comAfiliado && (
        <div onClick={() => !comAfiliado.saving && setComAfiliado(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 22, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 2 }}>Comissão de afiliado — {comAfiliado.user?.nome || comAfiliado.user?.cpf || 'Membro'}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.5 }}>
              Percentual que <strong>{comAfiliado.user?.nome || 'este vendedor'}</strong> recebe sobre as <strong>vendas de assinatura</strong> que vierem pelo link dele. Vale para as próximas vendas — não altera comissões já lançadas.
            </div>
            {comAfiliado.loading ? (
              <div style={{ color: '#94a3b8', fontSize: 14, padding: 20, textAlign: 'center' }}>Carregando…</div>
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569' }}>Comissão</div>
                  <input type="number" step="0.1" min="0" max="100" value={comAfiliado.valor}
                    onChange={e => setComAfiliado(x => ({ ...x, valor: e.target.value, msg: '' }))}
                    style={{ width: 90, padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 700, textAlign: 'right' }} />
                  <span style={{ fontSize: 12, color: '#64748b' }}>% sobre a venda</span>
                </div>
                {comAfiliado.msg && comAfiliado.msg !== 'salvo' && <div style={{ fontSize: 12.5, color: '#dc2626', marginBottom: 10 }}>{comAfiliado.msg}</div>}
                {comAfiliado.msg === 'salvo' && <div style={{ fontSize: 12.5, color: '#16a34a', marginBottom: 10 }}>Comissão salva. Vale para as próximas vendas.</div>}
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button onClick={() => setComAfiliado(null)} disabled={comAfiliado.saving} style={{ padding: '8px 16px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Fechar</button>
                  <button onClick={salvarComissaoAfiliado} disabled={comAfiliado.saving} style={{ padding: '8px 16px', background: '#db2777', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: comAfiliado.saving ? 'default' : 'pointer' }}>{comAfiliado.saving ? 'Salvando…' : 'Salvar'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURAÇÕES TAB
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// CONTRATO MODAL — elaborar, visualizar, aprovar e editar com IA
// ═══════════════════════════════════════════════════════════════════════════════
const DESCRICOES_PADRAO = {
  assessorado: 'Assessoria completa para identificação, análise de viabilidade, análise jurídica do edital e matrícula, acompanhamento do leilão e suporte pós-arrematação. Prazo: até 12 meses. Valor: R$500 em 12x (total R$6.000) ou R$4.800 à vista (20% de desconto) + 10% honorários de êxito sobre o valor arrematado. Rescisão: aviso prévio de 30 dias + multa de 10%.',
  clube: 'Adesão ao Clube de Negócios BidPro Brasil: mentoria, assessoria e arrematações ilimitadas por 12 meses. Valor: R$5.000/mês (total R$60.000) ou R$48.000 à vista, vencimento dia 10. Fidelidade mínima de 12 meses. Rescisão antes do prazo: pagamento integral das parcelas restantes.',
  consultor: 'Contratação de consultor/afiliado para divulgação dos serviços BidPro Brasil e captação de novos clientes. Remuneração por comissão conforme acordo. Vedada qualquer promessa de rentabilidade a terceiros. Prazo indeterminado, rescisão com aviso de 30 dias.',
  analista: 'Contratação de analista para elaboração de relatórios de viabilidade econômico-financeira e análise de editais. Remuneração por laudo emitido, a combinar. Sigilo total. Prazo indeterminado, rescisão com aviso de 30 dias.',
  advogado: 'Parceria jurídica para análise de matrícula, edital, processo e certidões. Remuneração por parecer emitido, a combinar. Total sigilo. Prazo indeterminado, rescisão com aviso de 30 dias.',
  top2: 'Assinatura Investidor Pro — acesso à plataforma BidPro Brasil, cursos e ebooks incluídos. Valor: R$49,90/mês, cobrança recorrente. Cancelamento a qualquer momento.',
};

function ContratoModal({ chave, planos, onClose }) {
  // chave: 'assessorado' | 'curso:uuid:titulo' | 'ebook:uuid:titulo'
  const partes = chave.split(':');
  const isProduto = partes[0] === 'curso' || partes[0] === 'ebook';
  const produtoTitulo = isProduto ? partes.slice(2).join(':') : null;
  const planoObj = isProduto ? null : planos.find(p => p.plano_key === chave);
  const nomeContrato = isProduto
    ? `${partes[0] === 'curso' ? 'Curso' : 'eBook'} — ${produtoTitulo}`
    : planoObj?.nome || chave;
  const descPadrao = isProduto
    ? `Contrato de aquisição: ${nomeContrato}. Produto digital disponível na plataforma BidPro Brasil. Acesso individual e intransferível. Valor conforme acordado.`
    : (DESCRICOES_PADRAO[chave] || '');

  // Etapas: 'dados' | 'gerando' | 'revisar' | 'aprovado'
  const [etapa, setEtapa] = useState('dados');
  const [contratoExistente, setContratoExistente] = useState(null); // contrato já salvo
  const [loadingExistente, setLoadingExistente] = useState(true);

  const [desc, setDesc] = useState(descPadrao);

  // Conteúdo gerado / editável
  const [conteudo, setConteudo] = useState('');
  const [editando, setEditando] = useState(false);
  const [instrucaoIA, setInstrucaoIA] = useState('');
  const [reescrevendo, setReescrevendo] = useState(false);

  // Link final
  const [linkGerado, setLinkGerado] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // Carrega contrato existente para este produto/plano (se houver)
  useEffect(() => {
    const tituloBase = `Contrato — ${nomeContrato}`;
    supabase.from('contratos_link')
      .select('*').ilike('titulo', `${tituloBase}%`)
      .neq('status', 'cancelado').order('criado_em', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.length) {
          setContratoExistente(data[0]);
          setConteudo(data[0].conteudo || '');
          setEtapa('aprovado');
        }
        setLoadingExistente(false);
      });
  }, [chave]);

  async function gerarComIA() {
    setEtapa('gerando');
    try {
      const descFull = desc;
      const r = await apiCall('/api/gerar-contrato', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ titulo: `Contrato — ${nomeContrato}`, tipo: 'servico', descricao: descFull, arquivos: [] }),
      });
      const d = await r.json();
      if (d.conteudo) { setConteudo(d.conteudo); setEtapa('revisar'); }
      else { alert(d.error || 'Erro ao gerar.'); setEtapa('dados'); }
    } catch { alert('Erro de conexão.'); setEtapa('dados'); }
  }

  async function reescreverComIA() {
    if (!instrucaoIA.trim()) return;
    setReescrevendo(true);
    try {
      const r = await apiCall('/api/gerar-contrato', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          titulo: `Contrato — ${nomeContrato}`,
          tipo: 'servico',
          descricao: `Revise o contrato abaixo conforme a instrução: "${instrucaoIA}"\n\nCONTRATO ATUAL:\n${conteudo}`,
          arquivos: [],
        }),
      });
      const d = await r.json();
      if (d.conteudo) { setConteudo(d.conteudo); setInstrucaoIA(''); }
      else alert(d.error || 'Erro ao reescrever.');
    } catch { alert('Erro de conexão.'); }
    setReescrevendo(false);
  }

  async function aprovar() {
    if (!conteudo.trim()) return;
    setSalvando(true);
    try {
      const tituloFinal = `Contrato — ${nomeContrato}`;
      let saved;
      if (contratoExistente) {
        const { data } = await supabase.from('contratos_link')
          .update({ conteudo, titulo: tituloFinal, status: 'pendente' })
          .eq('id', contratoExistente.id).select().single();
        saved = data;
      } else {
        const { data } = await supabase.from('contratos_link')
          .insert({ titulo: tituloFinal, tipo_contrato: 'servico', conteudo, status: 'pendente',
            criado_por: (await supabase.auth.getUser()).data?.user?.id })
          .select().single();
        saved = data;
      }
      if (saved) {
        setContratoExistente(saved);
        const base = window.location.href.split('#')[0];
        setLinkGerado(`${base}#/c/${saved.token}`);
        setEtapa('aprovado');
      }
    } catch { alert('Erro ao salvar contrato.'); }
    setSalvando(false);
  }

  const inp = { border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, padding:'9px 12px', width:'100%', boxSizing:'border-box', fontFamily:'inherit', color:'#111111' };

  if (loadingExistente) return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div style={{ background:'white', borderRadius:16, padding:32, fontSize:14, color:'#64748b' }}>Carregando…</div>
    </div>
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background:'white', borderRadius:18, width:'100%', maxWidth:660, maxHeight:'92vh', overflowY:'auto', display:'flex', flexDirection:'column' }}>

        {/* Cabeçalho */}
        <div style={{ padding:'24px 28px 16px', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontWeight:900, fontSize:16, color:'#111111' }}>📄 {nomeContrato}</div>
            <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
              {etapa === 'dados' && 'Preencha os dados para gerar o contrato com IA'}
              {etapa === 'gerando' && 'Gerando contrato com inteligência artificial…'}
              {etapa === 'revisar' && 'Revise, edite e aprove antes de enviar ao cliente'}
              {etapa === 'aprovado' && (contratoExistente?.status === 'assinado' ? '✅ Assinado pelo cliente' : '✅ Contrato aprovado — link disponível para envio')}
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', fontSize:22, cursor:'pointer', color:'#94a3b8', lineHeight:1 }}>✕</button>
        </div>

        <div style={{ padding:'24px 28px', flex:1 }}>

          {/* ETAPA: dados */}
          {etapa === 'dados' && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:11, fontWeight:700, color:'#374151', display:'block', marginBottom:4 }}>ESCOPO / CONDIÇÕES DO CONTRATO</label>
                <textarea value={desc} onChange={e=>setDesc(e.target.value)} rows={5} style={{ ...inp, resize:'vertical' }} />
                <div style={{ fontSize:11, color:'#94a3b8', marginTop:3 }}>Pré-preenchido conforme o produto. Ajuste se necessário antes de gerar.</div>
              </div>
              <div style={{ display:'flex', gap:10, marginTop:6 }}>
                <button onClick={onClose} style={{ flex:1, padding:'11px', background:'#f1f5f9', color:'#374151', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer' }}>Cancelar</button>
                <button onClick={gerarComIA} style={{ flex:2, padding:'11px', background:'#0D63DB', color:'white', border:'none', borderRadius:10, fontWeight:800, cursor:'pointer' }}>
                  🤖 Gerar contrato com IA →
                </button>
              </div>
            </div>
          )}

          {/* ETAPA: gerando */}
          {etapa === 'gerando' && (
            <div style={{ textAlign:'center', padding:'40px 0' }}>
              <div style={{ fontSize:40, marginBottom:16 }}>⏳</div>
              <div style={{ fontWeight:700, fontSize:15, color:'#111111', marginBottom:8 }}>Elaborando o contrato…</div>
              <div style={{ fontSize:13, color:'#64748b' }}>A IA está redigindo as cláusulas. Aguarde alguns segundos.</div>
            </div>
          )}

          {/* ETAPA: revisar */}
          {etapa === 'revisar' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {/* Toolbar edição */}
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <span style={{ fontSize:12, fontWeight:700, color:'#475569' }}>CONTRATO GERADO</span>
                <button onClick={() => setEditando(e=>!e)}
                  style={{ marginLeft:'auto', padding:'5px 12px', background:editando?'#fef3c7':'#f1f5f9', color:editando?'#92400e':'#374151', border:`1px solid ${editando?'#fcd34d':'#e2e8f0'}`, borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  {editando ? '✏️ Editando' : '✏️ Editar'}
                </button>
              </div>

              {editando ? (
                <textarea value={conteudo} onChange={e=>setConteudo(e.target.value)} rows={16}
                  style={{ ...inp, resize:'vertical', fontSize:12, lineHeight:1.7 }} />
              ) : (
                <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'16px 18px', fontSize:13, lineHeight:1.8, color:'#111111', whiteSpace:'pre-wrap', maxHeight:340, overflowY:'auto' }}>
                  {conteudo}
                </div>
              )}

              {/* Instrução para IA reescrever */}
              <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, padding:'14px 16px' }}>
                <div style={{ fontSize:11, fontWeight:800, color:'#084BA6', marginBottom:8 }}>🤖 Pedir alteração à IA</div>
                <div style={{ display:'flex', gap:8 }}>
                  <input value={instrucaoIA} onChange={e=>setInstrucaoIA(e.target.value)}
                    placeholder="Ex: Adicione cláusula de confidencialidade · Ajuste o prazo para 6 meses"
                    style={{ ...inp, flex:1 }} onKeyDown={e=>e.key==='Enter'&&reescreverComIA()} />
                  <button onClick={reescreverComIA} disabled={reescrevendo || !instrucaoIA.trim()}
                    style={{ padding:'9px 16px', background:'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap', opacity:reescrevendo?0.7:1 }}>
                    {reescrevendo ? '…' : 'Aplicar'}
                  </button>
                </div>
              </div>

              <div style={{ display:'flex', gap:10 }}>
                <button onClick={() => setEtapa('dados')} style={{ flex:1, padding:'11px', background:'#f1f5f9', color:'#374151', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer' }}>← Voltar</button>
                <button onClick={aprovar} disabled={salvando}
                  style={{ flex:2, padding:'11px', background:'#10b981', color:'white', border:'none', borderRadius:10, fontWeight:800, cursor:'pointer', opacity:salvando?0.7:1 }}>
                  {salvando ? 'Salvando…' : '✅ Aprovar e gerar link →'}
                </button>
              </div>
            </div>
          )}

          {/* ETAPA: aprovado */}
          {etapa === 'aprovado' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {/* Status badge */}
              <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                {contratoExistente?.status === 'assinado' ? (
                  <span style={{ background:'#dcfce7', color:'#166534', padding:'4px 12px', borderRadius:20, fontWeight:700, fontSize:12 }}>✅ Assinado em {contratoExistente.assinado_em ? new Date(contratoExistente.assinado_em).toLocaleDateString('pt-BR') : '—'}</span>
                ) : (
                  <span style={{ background:'#fef9c3', color:'#92400e', padding:'4px 12px', borderRadius:20, fontWeight:700, fontSize:12 }}>⏳ Aguardando assinatura</span>
                )}
                <button onClick={() => { setEditando(false); setEtapa('revisar'); }}
                  style={{ marginLeft:'auto', padding:'5px 12px', background:'#f1f5f9', color:'#374151', border:'1px solid #e2e8f0', borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  ✏️ Editar contrato
                </button>
              </div>

              {/* Preview do conteúdo */}
              <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'16px 18px', fontSize:13, lineHeight:1.8, color:'#111111', whiteSpace:'pre-wrap', maxHeight:260, overflowY:'auto' }}>
                {conteudo || contratoExistente?.conteudo || '—'}
              </div>

              {/* Link */}
              {(linkGerado || contratoExistente?.token) && (
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#374151', marginBottom:6 }}>LINK PARA O CLIENTE ASSINAR</div>
                  <div style={{ display:'flex', gap:8 }}>
                    <div style={{ flex:1, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:8, padding:'9px 12px', fontSize:12, color:'#0D63DB', wordBreak:'break-all' }}>
                      {linkGerado || `${window.location.href.split('#')[0]}#/c/${contratoExistente?.token}`}
                    </div>
                    <button onClick={() => { const l = linkGerado || `${window.location.href.split('#')[0]}#/c/${contratoExistente?.token}`; navigator.clipboard.writeText(l); setCopiado(true); setTimeout(()=>setCopiado(false),2000); }}
                      style={{ padding:'9px 14px', background:copiado?'#10b981':'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                      {copiado ? '✓ Copiado' : '📋 Copiar'}
                    </button>
                  </div>
                </div>
              )}

              {/* Novo contrato para outro cliente */}
              <button onClick={() => { setContratoExistente(null); setConteudo(''); setLinkGerado(''); setEtapa('dados'); }}
                style={{ padding:'10px', background:'#f8fafc', color:'#374151', border:'1px solid #e2e8f0', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer' }}>
                + Gerar para outro cliente
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}

function ConfigTab() {
  const [email, setEmail] = useState(() => localStorage.getItem(FEEDBACK_KEY) || DEFAULT_FEEDBACK_EMAIL);
  const [saved, setSaved] = useState(false);
  const [rows, setRows] = useState([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [dirtyIds, setDirtyIds] = useState(new Set());
  const [salvandoTudo, setSalvandoTudo] = useState(false);
  const [tudoSalvo, setTudoSalvo] = useState(false);
  const [contratoAberto, setContratoAberto] = useState(null);
  // Contratos ATRIBUÍDOS por produto (só exibir/visualizar aqui; a criação é na
  // tela de Contratos). Mapa: 'plano:<key>' | '<tipo>:<id>' → { token, status, titulo }.
  const [contratosAtrib, setContratosAtrib] = useState({});
  useEffect(() => {
    supabase.from('contratos_link')
      .select('plano_key, produto_tipo, produto_id, token, status, titulo, criado_em')
      .not('status', 'eq', 'cancelado')
      .order('criado_em', { ascending: false })
      .then(({ data }) => {
        const m = {};
        for (const c of (data || [])) {
          const chave = c.plano_key ? `plano:${c.plano_key}` : (c.produto_tipo && c.produto_id ? `${c.produto_tipo}:${c.produto_id}` : null);
          if (chave && !m[chave]) m[chave] = { token: c.token, status: c.status, titulo: c.titulo };
        }
        setContratosAtrib(m);
      });
  }, []);
  // planos kept for ContratoModal compatibility
  const [planos, setPlanos] = useState([]);
  const [planosLoading, setPlanosLoading] = useState(true);
  const [planosSaved, setPlanosSaved] = useState({});
  const [planosErr, setPlanosErr] = useState('');
  const [comissoesExpanded, setComissoesExpanded] = useState({});
  const [cfin, setCfin] = useState({});   // config_financeira por gateway
  const [cfinSaved, setCfinSaved] = useState({});
  const [honorarios, setHonorarios] = useState({ total_pct: 10, admin_pct: 4.5, advogado_pct: 5.0, analista_pct: 0.5, consultor_pct: 0 });
  const [honorariosSaved, setHonorariosSaved] = useState(false);
  const [honorariosErr, setHonorariosErr] = useState('');
  // Fidelidade e cancelamento
  const [fidConfig, setFidConfig] = useState({ assessorado: {}, clube: {} });
  const [fidSaved, setFidSaved] = useState({});
  const [fidErr, setFidErr] = useState('');
  // Assessorados ativos
  const [assessorados, setAssessorados] = useState([]);
  const [loadingAssessorados, setLoadingAssessorados] = useState(false);
  const [extendTarget, setExtendTarget] = useState(null); // { id, acesso_fim, user_email }
  const [extendMeses, setExtendMeses] = useState(3);
  const [extendSaving, setExtendSaving] = useState(false);

  useEffect(() => {
    supabase.from('planos_config').select('*').order('preco', { ascending: true })
      .then(({ data, error }) => {
        if (!error && data) setPlanos(data.map(p => ({
          ...p,
          desconto_vista_pct: (p.preco && p.preco_vista)
            ? Math.round((1 - p.preco_vista / p.preco) * 10000) / 100
            : '',
        })));
        else setPlanosErr('Erro ao carregar planos. Rode o SQL schema_planos_config.sql no Supabase.');
        setPlanosLoading(false);
      });
    supabase.from('config_financeira').select('*')
      .then(({ data }) => {
        if (data) {
          const m = {};
          data.forEach(r => { m[r.gateway] = r; });
          setCfin(m);
        }
      });
    supabase.from('config_honorarios').select('*').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setHonorarios(data); });
    // Carrega config de fidelidade para assessorado e clube
    supabase.from('planos_config')
      .select('plano_key, fidelidade_meses, multa_cancelamento_pct, pagamento_tipo, acesso_meses, vinculado_arrematacao, honorarios_exito_pct')
      .in('plano_key', ['assessorado', 'clube'])
      .then(({ data }) => {
        if (data) {
          const m = {};
          data.forEach(r => { m[r.plano_key] = r; });
          setFidConfig(m);
        }
      });
    // Carrega assinaturas assessorado ativas
    setLoadingAssessorados(true);
    supabase.from('plano_assinaturas')
      .select('*, perfis:user_id(nome, email)')
      .eq('plano_key', 'assessorado')
      .eq('status', 'ativo')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setAssessorados(data || []); setLoadingAssessorados(false); });
  }, []);

  function updateCfin(gateway, field, value) {
    setCfin(prev => ({ ...prev, [gateway]: { ...(prev[gateway] || { gateway }), [field]: value } }));
  }

  async function salvarCfin(gateway) {
    const r = cfin[gateway] || { gateway };
    const { error } = await supabase.from('config_financeira').upsert({
      gateway,
      taxa_credito_pct:      Number(r.taxa_credito_pct) || 0,
      taxa_debito_pct:       Number(r.taxa_debito_pct) || 0,
      antecipacao_ativa:     r.antecipacao_ativa || false,
      antecipacao_pct_mes:   Number(r.antecipacao_pct_mes) || 0,
      prazo_recebimento_dias: Number(r.prazo_recebimento_dias) || 30,
      atualizado_em: new Date().toISOString(),
    });
    if (!error) {
      setCfinSaved(prev => ({ ...prev, [gateway]: true }));
      setTimeout(() => setCfinSaved(prev => ({ ...prev, [gateway]: false })), 2000);
    }
  }

  async function salvarHonorarios() {
    setHonorariosErr('');
    const total = Number(honorarios.total_pct) || 0;
    const soma = (Number(honorarios.admin_pct) || 0) + (Number(honorarios.advogado_pct) || 0) + (Number(honorarios.analista_pct) || 0) + (Number(honorarios.consultor_pct) || 0);
    if (Math.abs(soma - total) > 0.01) {
      setHonorariosErr(`A soma dos percentuais (${soma.toFixed(2)}%) deve ser igual ao total (${total.toFixed(2)}%).`);
      return;
    }
    const { error } = await supabase.from('config_honorarios').upsert({
      id: 1,
      total_pct:    total,
      admin_pct:     Number(honorarios.admin_pct) || 0,
      advogado_pct:  Number(honorarios.advogado_pct) || 0,
      analista_pct:  Number(honorarios.analista_pct) || 0,
      consultor_pct: Number(honorarios.consultor_pct) || 0,
      atualizado_em: new Date().toISOString(),
    });
    if (!error) { setHonorariosSaved(true); setTimeout(() => setHonorariosSaved(false), 2500); }
    else setHonorariosErr('Erro ao salvar: ' + error.message);
  }

  async function salvarFidelidade(planoKey) {
    setFidErr('');
    const cfg = fidConfig[planoKey] || {};
    const { error } = await supabase.from('planos_config').update({
      fidelidade_meses:       Number(cfg.fidelidade_meses) || null,
      multa_cancelamento_pct: Number(cfg.multa_cancelamento_pct) || 0,
      pagamento_tipo:         cfg.pagamento_tipo || 'recorrente',
      acesso_meses:           Number(cfg.acesso_meses) || null,
      vinculado_arrematacao:  !!cfg.vinculado_arrematacao,
      honorarios_exito_pct:   Number(cfg.honorarios_exito_pct) || 0,
      atualizado_em:          new Date().toISOString(),
    }).eq('plano_key', planoKey);
    if (!error) {
      setFidSaved(p => ({ ...p, [planoKey]: true }));
      setTimeout(() => setFidSaved(p => ({ ...p, [planoKey]: false })), 2000);
    } else {
      setFidErr('Erro ao salvar: ' + error.message);
    }
  }

  function updateFid(planoKey, field, value) {
    setFidConfig(p => ({ ...p, [planoKey]: { ...(p[planoKey] || {}), [field]: value } }));
  }

  async function cancelarSemMulta(assinaturaId) {
    if (!window.confirm('Cancelar esta assinatura SEM aplicar multa? Esta ação não pode ser desfeita.')) return;
    const adminId = (await supabase.auth.getUser()).data?.user?.id;
    const { error } = await supabase.from('plano_assinaturas').update({
      status:          'cancelado',
      cancelado_em:    new Date().toISOString(),
      cancelado_por:   adminId,
      multa_calculada: 0,
      multa_aplicada:  0,
      notas_admin:     'Cancelado sem multa pelo admin',
    }).eq('id', assinaturaId);
    if (!error) setAssessorados(prev => prev.filter(a => a.id !== assinaturaId));
  }

  async function estenderAssessorado() {
    if (!extendTarget) return;
    setExtendSaving(true);
    const atual = extendTarget.acesso_fim ? new Date(extendTarget.acesso_fim) : new Date();
    if (atual < new Date()) atual.setTime(new Date().getTime());
    atual.setMonth(atual.getMonth() + Number(extendMeses));
    const { error } = await supabase.from('plano_assinaturas').update({
      acesso_fim:   atual.toISOString(),
      extended_by:  (await supabase.auth.getUser()).data?.user?.id,
      extended_at:  new Date().toISOString(),
    }).eq('id', extendTarget.id);
    if (!error) {
      setAssessorados(prev => prev.map(a => a.id === extendTarget.id ? { ...a, acesso_fim: atual.toISOString() } : a));
      setExtendTarget(null);
    }
    setExtendSaving(false);
  }

  const isDirty = dirtyIds.size > 0;

  useEffect(() => {
    async function loadAll() {
      try {
        const [planosRes, cursosRes, ebooksRes] = await Promise.all([
          supabase.from('planos_config').select('*').order('preco', { ascending: true }),
          supabase.from('cursos_admin').select('*').order('titulo'),
          supabase.from('ebooks_admin').select('*').order('titulo'),
        ]);
        const planosData = planosRes.data || [];
        const cursosData = cursosRes.data || [];
        const ebooksData = ebooksRes.data || [];
        setPlanos(planosData);
        const normalized = [
          ...planosData.map(p => ({
            _tipo: 'plano', _id: p.plano_key,
            nome: p.nome || p.plano_key,
            preco: p.preco ?? 0,
            desconto_vista_pct: p.desconto_vista_pct ?? 0,
            preco_vista: p.preco_vista ?? null,
            assinatura: p.assinatura ?? p.cobrar ?? false,
            ativo: p.ativo ?? true,
            comissao_pct: p.comissao_pct ?? 0,
            requer_contrato: p.requer_contrato ?? false,
            _raw: p,
          })),
          ...cursosData.map(c => ({
            _tipo: 'curso', _id: c.id,
            nome: c.titulo,
            preco: c.preco ?? 0,
            desconto_vista_pct: c.desconto_vista_pct ?? 0,
            assinatura: c.assinatura ?? false,
            ativo: c.ativo ?? true,
            comissao_pct: c.comissao_pct ?? 0,
            requer_contrato: c.requer_contrato ?? false,
            _raw: c,
          })),
          ...ebooksData.map(e => ({
            _tipo: 'ebook', _id: e.id,
            nome: e.titulo,
            preco: e.preco ?? 0,
            desconto_vista_pct: e.desconto_vista_pct ?? 0,
            assinatura: e.assinatura ?? false,
            ativo: e.ativo ?? true,
            comissao_pct: e.comissao_pct ?? 0,
            requer_contrato: false,
            _raw: e,
          })),
        ];
        setRows(normalized);
      } catch (err) {
        console.error('Erro ao carregar config:', err);
      } finally {
        setLoadingRows(false);
      }
    }
    loadAll();
  }, []);

  function updateRow(id, tipo, field, value) {
    setRows(prev => prev.map(r => (r._id === id && r._tipo === tipo) ? { ...r, [field]: value } : r));
    setDirtyIds(prev => new Set([...prev, `${tipo}:${id}`]));
  }

  async function salvarTudo() {
    setSalvandoTudo(true);
    try {
      const dirtyRows = rows.filter(r => dirtyIds.has(`${r._tipo}:${r._id}`));
      await Promise.all(dirtyRows.map(async p => {
        if (p._tipo === 'plano') {
          const vistaCalc = Number(p.desconto_vista_pct) > 0
            ? Number(p.preco) * (1 - Number(p.desconto_vista_pct) / 100)
            : (p.preco_vista ?? null);
          await supabase.from('planos_config').update({
            preco: Number(p.preco) || 0,
            desconto_vista_pct: Number(p.desconto_vista_pct) || 0,
            preco_vista: vistaCalc,
            cobrar: p.assinatura,
            assinatura: p.assinatura,
            ativo: p.ativo,
            comissao_pct: Number(p.comissao_pct) || 0,
            requer_contrato: p.requer_contrato,
            atualizado_em: new Date().toISOString(),
          }).eq('plano_key', p._id);
        } else if (p._tipo === 'curso') {
          await supabase.from('cursos_admin').update({
            preco: Number(p.preco) || 0,
            desconto_vista_pct: Number(p.desconto_vista_pct) || 0,
            assinatura: p.assinatura,
            ativo: p.ativo,
            comissao_pct: Number(p.comissao_pct) || 0,
            requer_contrato: p.requer_contrato,
          }).eq('id', p._id);
        } else if (p._tipo === 'ebook') {
          await supabase.from('ebooks_admin').update({
            preco: Number(p.preco) || 0,
            desconto_vista_pct: Number(p.desconto_vista_pct) || 0,
            assinatura: p.assinatura,
            ativo: p.ativo,
            comissao_pct: Number(p.comissao_pct) || 0,
          }).eq('id', p._id);
        }
      }));
      setDirtyIds(new Set());
      PlanosProvider.invalidate(); // força re-fetch em todas as telas
      setTudoSalvo(true);
      setTimeout(() => setTudoSalvo(false), 2500);
    } catch (err) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSalvandoTudo(false);
    }
  }

  function salvarEmail() {
    localStorage.setItem(FEEDBACK_KEY, email.trim() || DEFAULT_FEEDBACK_EMAIL);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function salvarPlano(p) {
    // Valida: soma das comissões por papel ≤ total
    const somaRoles = ['admin', 'analista', 'advogado', 'consultor'].reduce(
      (s, r) => s + (Number(p[`comissao_${r}_pct`]) || 0), 0
    );
    const total = Number(p.comissao_total_pct) || 0;
    if (somaRoles > total + 0.01) {
      alert(`A soma das comissões por papel (${somaRoles.toFixed(2)}%) não pode exceder o total configurado (${total.toFixed(2)}%).`);
      return;
    }

    const { error } = await supabase.from('planos_config').update({
      preco:                   Number(p.preco) || 0,
      preco_vista:             (() => {
                                 const pct = Number(p.desconto_vista_pct);
                                 return pct > 0
                                   ? Math.round(Number(p.preco) * (1 - pct / 100) * 100) / 100
                                   : null;
                               })(),
      cobrar:                  p.cobrar,
      ativo:                   p.ativo,
      comissao_total_pct:      Number(p.comissao_total_pct) || 0,
      comissao_admin_pct:      Number(p.comissao_admin_pct) || 0,
      comissao_analista_pct:   Number(p.comissao_analista_pct) || 0,
      comissao_advogado_pct:   Number(p.comissao_advogado_pct) || 0,
      comissao_consultor_pct:  Number(p.comissao_consultor_pct) || 0,
      atualizado_em:           new Date().toISOString(),
    }).eq('plano_key', p.plano_key);
    if (!error) {
      setPlanosSaved(prev => ({ ...prev, [p.plano_key]: true }));
      setTimeout(() => setPlanosSaved(prev => ({ ...prev, [p.plano_key]: false })), 2000);
    }
  }

  function updatePlano(key, field, value) {
    setPlanos(prev => prev.map(p => p.plano_key === key ? { ...p, [field]: value } : p));
  }

  const fmtPreco = (v) => v != null ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const fmtBRL = v => v != null ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const COLS = '2fr 110px 140px 90px 70px 80px 90px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111111', margin: 0 }}>Configurações</h2>

      {/* Tabela unificada */}
      <div style={S.card}>
        <p style={S.subTitle}>Produtos — Preços, Assinatura e Contratos</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Planos, cursos e eBooks unificados. "Assinatura" = cobrança recorrente; desmarcado = venda única parcelável em 12×. Preço à vista calculado automaticamente pelo desconto %.
        </p>

        {loadingRows ? (
          <div style={{ color: '#94a3b8', fontSize: 13, padding: 20 }}>Carregando...</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            {/* Header */}
            <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 8, padding: '6px 8px', borderBottom: '2px solid #e2e8f0', minWidth: 700 }}>
              {['Produto', 'Valor R$', 'Desc. à vista %', 'Assinatura', 'Ativo', 'Comissão %', 'Contrato'].map(h => (
                <div key={h} style={{ fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: 0.5 }}>{h}</div>
              ))}
            </div>

            {rows.map(r => {
              const pct = Number(r.desconto_vista_pct || 0);
              const vistaCalc = pct > 0 ? Number(r.preco) * (1 - pct / 100) : null;
              const temVista = !r.assinatura && Number(r.preco) > 0;
              const isDirtyRow = dirtyIds.has(`${r._tipo}:${r._id}`);
              const tipoBadge = r._tipo === 'plano'
                ? { text: '📋 plano', bg: '#eff6ff', color: '#084BA6' }
                : r._tipo === 'curso'
                  ? { text: '🎓 curso', bg: '#f5f3ff', color: '#7c3aed' }
                  : { text: '📖 ebook', bg: '#f0fdf4', color: '#166534' };

              return (
                <div key={`${r._tipo}:${r._id}`} style={{
                  display: 'grid', gridTemplateColumns: COLS, gap: 8,
                  alignItems: 'start', padding: '10px 8px',
                  borderBottom: '1px solid #f1f5f9',
                  background: isDirtyRow ? '#fffbeb' : 'transparent',
                  minWidth: 700,
                }}>
                  {/* Col 1: Produto */}
                  <div>
                    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 10, fontWeight: 700, background: tipoBadge.bg, color: tipoBadge.color, marginBottom: 4 }}>
                      {tipoBadge.text}
                    </span>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#111111' }}>{r.nome}</div>
                  </div>

                  {/* Col 2: Valor R$ (clube/assessorado: este campo é o TOTAL de 12 meses) */}
                  <div>
                    <InputBRL value={r.preco} onChange={v => updateRow(r._id, r._tipo, 'preco', v)}
                      style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: '100%' }} />
                    {(r._id === 'clube' || r._id === 'assessorado') && Number(r.preco) > 0 && (
                      <div style={{ fontSize: 10, color: '#64748b', marginTop: 3, fontWeight: 600 }}>
                        total 12 meses · = {fmtBRL(Number(r.preco) / 12)}/mês
                      </div>
                    )}
                  </div>

                  {/* Col 3: Desc. à vista % */}
                  <div>
                    {temVista ? (
                      <>
                        <input type="number" min="0" max="100" step="0.5"
                          value={pct}
                          onChange={e => updateRow(r._id, r._tipo, 'desconto_vista_pct', e.target.value)}
                          style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: '100%' }} />
                        {pct > 0 && (
                          <div style={{ fontSize: 10, color: '#059669', marginTop: 3, fontWeight: 600 }}>
                            {fmtBRL(vistaCalc)} à vista
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{ fontSize: 11, color: '#cbd5e1', paddingTop: 8 }}>—</div>
                    )}
                  </div>

                  {/* Col 4: Assinatura */}
                  <div style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={!!r.assinatura}
                      onChange={e => updateRow(r._id, r._tipo, 'assinatura', e.target.checked)}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#0D63DB' }} />
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 3 }}>
                      {r.assinatura ? 'Recorrente' : 'em até 12×'}
                    </div>
                  </div>

                  {/* Col 5: Ativo */}
                  <div style={{ textAlign: 'center' }}>
                    <input type="checkbox" checked={!!r.ativo}
                      onChange={e => updateRow(r._id, r._tipo, 'ativo', e.target.checked)}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#10b981' }} />
                  </div>

                  {/* Col 6: Comissão % */}
                  <div>
                    <input type="number" min="0" max="100" step="0.5"
                      value={r.comissao_pct ?? 0}
                      onChange={e => updateRow(r._id, r._tipo, 'comissao_pct', e.target.value)}
                      style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: '100%' }} />
                  </div>

                  {/* Col 7: Contrato — só EXIBE/VISUALIZA o contrato atribuído pela
                      tela de Contratos (a criação não acontece mais aqui). */}
                  <div>
                    {(() => {
                      const chave = r._tipo === 'plano' ? `plano:${r._id}` : `${r._tipo}:${r._id}`;
                      const ct = contratosAtrib[chave];
                      if (ct) {
                        return (
                          <a href={`/#/c/${ct.token}`} target="_blank" rel="noreferrer"
                            title={ct.titulo || 'Ver contrato atribuído'}
                            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 5, padding: '6px 10px', background: '#f0fdf4', color: '#15803d', border: '1px solid #86efac', borderRadius: 8, fontWeight: 700, fontSize: 11, cursor: 'pointer', width: '100%', textDecoration: 'none' }}>
                            ✓ Ver contrato
                          </a>
                        );
                      }
                      return <span style={{ display: 'inline-block', padding: '6px 10px', fontSize: 11, color: '#94a3b8', fontWeight: 600, textAlign: 'center', width: '100%' }}>Sem contrato</span>;
                    })()}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contratoAberto && (
        <ContratoModal
          chave={contratoAberto}
          planos={planos}
          onClose={() => setContratoAberto(null)}
        />
      )}

      {/* Botão flutuante de salvar */}
      {(isDirty || tudoSalvo) && (
        <div style={{ position: 'fixed', bottom: 32, right: 32, zIndex: 9999 }}>
          <button onClick={salvarTudo} disabled={salvandoTudo || tudoSalvo}
            style={{ padding: '14px 28px', background: tudoSalvo ? '#10b981' : '#0D63DB', color: 'white', border: 'none', borderRadius: 14, fontWeight: 800, fontSize: 15, cursor: salvandoTudo || tudoSalvo ? 'default' : 'pointer', boxShadow: '0 8px 30px rgba(37,99,235,0.4)', transition: 'background 0.2s', display: 'flex', alignItems: 'center', gap: 8 }}>
            {salvandoTudo ? '⏳ Salvando…' : tudoSalvo ? '✅ Salvo!' : '💾 Salvar alterações'}
          </button>
        </div>
      )}
      {/* Honorários de Êxito na Arrematação */}
      <div style={S.card}>
        <p style={S.subTitle}>Honorários de Êxito — Arrematação</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Percentual cobrado sobre o valor arrematado quando o cliente finaliza uma compra com apoio da equipe.
          O total deve ser distribuído integralmente entre Admin, Advogado e Analista.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'flex-start' }}>
          {/* Total */}
          <div style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 18px', minWidth: 150 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 6 }}>TOTAL HONORÁRIO %</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" step="0.1" min="0" max="100"
                value={honorarios.total_pct}
                onChange={e => setHonorarios(h => ({ ...h, total_pct: e.target.value }))}
                style={{ ...S.input, padding: '7px 10px', fontSize: 15, width: 70, fontWeight: 900, color: '#111111' }} />
              <span style={{ fontSize: 14, color: '#64748b', fontWeight: 700 }}>%</span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>padrão 10%</div>
          </div>

          {/* Seta divisória */}
          <div style={{ display: 'flex', alignItems: 'center', paddingTop: 28, color: '#94a3b8', fontSize: 18 }}>→</div>

          {/* Distribuição por papel */}
          {[
            { key: 'admin_pct',    label: 'Admin',    cor: '#7c3aed', desc: 'coordenação (4,5%)' },
            { key: 'advogado_pct', label: 'Advogado', cor: '#0D63DB', desc: 'análise jurídica (5%)' },
            { key: 'analista_pct', label: 'Analista', cor: '#0891b2', desc: 'análise técnica' },
            { key: 'consultor_pct', label: 'Consultor', cor: '#059669', desc: 'captação do cliente' },
          ].map(({ key, label, cor, desc }) => (
            <div key={key} style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 18px', minWidth: 140, border: `1px solid ${cor}22` }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: cor, marginBottom: 6, textTransform: 'uppercase' }}>{label}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" step="0.1" min="0" max="100"
                  value={honorarios[key]}
                  onChange={e => setHonorarios(h => ({ ...h, [key]: e.target.value }))}
                  style={{ ...S.input, padding: '7px 10px', fontSize: 15, width: 70, fontWeight: 700, color: '#111111' }} />
                <span style={{ fontSize: 14, color: '#64748b', fontWeight: 700 }}>%</span>
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{desc}</div>
            </div>
          ))}

          {/* Totalizador visual */}
          <div style={{ display: 'flex', alignItems: 'center', paddingTop: 28 }}>
            {(() => {
              const soma = (Number(honorarios.admin_pct) || 0) + (Number(honorarios.advogado_pct) || 0) + (Number(honorarios.analista_pct) || 0) + (Number(honorarios.consultor_pct) || 0);
              const total = Number(honorarios.total_pct) || 0;
              const ok = Math.abs(soma - total) <= 0.01;
              return (
                <div style={{ padding: '6px 14px', borderRadius: 20, background: ok ? '#f0fdf4' : '#fef2f2', color: ok ? '#16a34a' : '#ef4444', fontWeight: 700, fontSize: 13 }}>
                  {soma.toFixed(2)}% / {total.toFixed(2)}%
                  <span style={{ marginLeft: 6 }}>{ok ? '✓' : '✗'}</span>
                </div>
              );
            })()}
          </div>
        </div>

        {honorariosErr && (
          <div style={{ marginTop: 12, padding: '8px 12px', background: '#fef2f2', color: '#ef4444', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>
            {honorariosErr}
          </div>
        )}

        <button onClick={salvarHonorarios}
          style={{ marginTop: 16, padding: '9px 22px', background: honorariosSaved ? '#10b981' : '#111111', color: 'white', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          {honorariosSaved ? '✓ Salvo' : 'Salvar Honorários'}
        </button>

        <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8' }}>
          Esses valores são usados para calcular o repasse de cada papel no êxito de uma arrematação.<br/>
          A soma Admin + Advogado + Analista deve ser igual ao total configurado.
        </div>
      </div>

      {/* Fidelidade e Cancelamento */}
      <div style={S.card}>
        <p style={S.subTitle}>Planos Premium — Fidelidade, Cancelamento e Honorários</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Configure fidelidade, multa de cancelamento antecipado e honorários de êxito para Assessorado e Leilão Club.
          A multa de cancelamento do Leilão Club incide sobre o saldo restante da fidelidade
          (ex: 30% × meses restantes × valor mensal). Consulte seu advogado antes de alterar o percentual de multa.
        </p>

        {[
          { key: 'assessorado', nome: 'Assessorado', cor: '#d97706', bg: '#fef3c7' },
          { key: 'clube',       nome: 'Leilão Club', cor: '#059669', bg: '#d1fae5' },
        ].map(({ key, nome, cor, bg }) => {
          const cfg = fidConfig[key] || {};
          return (
            <div key={key} style={{ background: bg + '88', border: `1px solid ${cor}44`, borderRadius: 12, padding: '16px 18px', marginBottom: 14 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: cor, marginBottom: 12 }}>{nome}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>FIDELIDADE (MESES)</div>
                  <input type="number" min="1" max="60" value={cfg.fidelidade_meses ?? ''}
                    onChange={e => updateFid(key, 'fidelidade_meses', e.target.value)}
                    style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: 80 }} />
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>padrão: 12</div>
                </div>

                {key === 'clube' && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>MULTA CANCELAMENTO %</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="number" min="0" max="100" step="1" value={cfg.multa_cancelamento_pct ?? 30}
                        onChange={e => updateFid(key, 'multa_cancelamento_pct', e.target.value)}
                        style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: 70 }} />
                      <span style={{ fontSize: 12, color: '#64748b' }}>%</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>do saldo restante · padrão 30%</div>
                  </div>
                )}

                {key === 'assessorado' && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>ACESSO (MESES)</div>
                    <input type="number" min="1" max="60" value={cfg.acesso_meses ?? ''}
                      onChange={e => updateFid(key, 'acesso_meses', e.target.value)}
                      style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: 80 }} />
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>prazo base (extensível)</div>
                  </div>
                )}

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>HONORÁRIOS ÊXITO %</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min="0" max="100" step="0.5" value={cfg.honorarios_exito_pct ?? 10}
                      onChange={e => updateFid(key, 'honorarios_exito_pct', e.target.value)}
                      style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: 70 }} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>%</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>sobre valor arrematado</div>
                </div>

                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>TIPO PAGAMENTO</div>
                  <select value={cfg.pagamento_tipo || 'recorrente'}
                    onChange={e => updateFid(key, 'pagamento_tipo', e.target.value)}
                    style={{ ...S.input, padding: '6px 8px', fontSize: 12 }}>
                    <option value="recorrente">Recorrente (mensal)</option>
                    <option value="parcelado_fixo">Parcelado fixo (12×)</option>
                    <option value="unico">Pagamento único</option>
                  </select>
                </div>

                {key === 'assessorado' && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>VINCULADO A 1 ARREMATAÇÃO</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                      <input type="checkbox" checked={!!cfg.vinculado_arrematacao}
                        onChange={e => updateFid(key, 'vinculado_arrematacao', e.target.checked)}
                        style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#d97706' }} />
                      <span style={{ fontSize: 12, color: '#334155' }}>Sim</span>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                <button onClick={() => salvarFidelidade(key)}
                  style={{ padding: '8px 20px', background: fidSaved[key] ? '#10b981' : cor, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  {fidSaved[key] ? '✓ Salvo' : 'Salvar'}
                </button>
                {key === 'clube' && cfg.multa_cancelamento_pct > 0 && (
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    Ex: cancelar no 4° mês → {Number(cfg.fidelidade_meses || 12) - 4} meses restantes →
                    multa ≈ {Number(cfg.multa_cancelamento_pct).toFixed(2)}% × {Number(cfg.fidelidade_meses || 12) - 4} × (valor mensal)
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {fidErr && <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600, marginTop: 8 }}>{fidErr}</div>}
      </div>

      {/* Gestão de Assessorados Ativos */}
      <div style={S.card}>
        <p style={S.subTitle}>Assessorados Ativos</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Clientes com plano Assessorado em andamento. Você pode estender o prazo de acesso quando necessário (ex: aguardando imissão de posse).
        </p>
        {loadingAssessorados ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Carregando...</div>
        ) : assessorados.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Nenhum assessorado ativo no momento.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {assessorados.map(a => {
              const nomeCliente = a.perfis?.nome || a.user_id;
              const emailCliente = a.perfis?.email || '';
              const fimAcesso = a.acesso_fim ? new Date(a.acesso_fim) : null;
              const diasRestantes = fimAcesso ? Math.ceil((fimAcesso - new Date()) / (1000 * 60 * 60 * 24)) : null;
              const vencendo = diasRestantes !== null && diasRestantes <= 30;
              return (
                <div key={a.id} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', border: vencendo ? '1px solid #fbbf24' : '1px solid #e2e8f0' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#111111' }}>{nomeCliente}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{emailCliente}</div>
                    <div style={{ fontSize: 11, marginTop: 4 }}>
                      Início: {a.inicio ? new Date(a.inicio).toLocaleDateString('pt-BR') : '—'} ·
                      Acesso até: {fimAcesso ? fimAcesso.toLocaleDateString('pt-BR') : '—'}
                      {diasRestantes !== null && (
                        <span style={{ marginLeft: 6, fontWeight: 700, color: diasRestantes <= 0 ? '#dc2626' : vencendo ? '#d97706' : '#059669' }}>
                          ({diasRestantes <= 0 ? 'Expirado' : `${diasRestantes} dias`})
                        </span>
                      )}
                    </div>
                    {a.imovel_id && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>Imóvel: {a.imovel_id}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setExtendTarget(a); setExtendMeses(3); }}
                      style={{ padding: '7px 14px', background: '#d97706', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      + Estender prazo
                    </button>
                    <button onClick={() => cancelarSemMulta(a.id)}
                      style={{ padding: '7px 14px', background: '#f1f5f9', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      Cancelar s/ multa
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Modal de extensão */}
        {extendTarget && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div style={{ background: 'white', borderRadius: 16, padding: 28, maxWidth: 380, width: '100%' }}>
              <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 8 }}>Estender prazo</div>
              <div style={{ fontSize: 13, color: '#475569', marginBottom: 18 }}>
                {extendTarget.perfis?.nome || extendTarget.user_id}<br/>
                Acesso atual até: {extendTarget.acesso_fim ? new Date(extendTarget.acesso_fim).toLocaleDateString('pt-BR') : '—'}
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6 }}>Adicionar (meses)</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[1, 3, 6, 12].map(m => (
                    <button key={m} onClick={() => setExtendMeses(m)}
                      style={{ flex: 1, padding: '8px 4px', border: `2px solid ${extendMeses === m ? '#d97706' : '#e2e8f0'}`, background: extendMeses === m ? '#fef3c7' : 'white', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', color: extendMeses === m ? '#92400e' : '#334155' }}>
                      +{m}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 18 }}>
                Nova data de acesso:{' '}
                <strong>
                  {(() => {
                    const d = extendTarget.acesso_fim ? new Date(extendTarget.acesso_fim) : new Date();
                    if (d < new Date()) d.setTime(new Date().getTime());
                    d.setMonth(d.getMonth() + extendMeses);
                    return d.toLocaleDateString('pt-BR');
                  })()}
                </strong>
              </div>
              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setExtendTarget(null)}
                  style={{ flex: 1, padding: '10px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                  Cancelar
                </button>
                <button onClick={estenderAssessorado} disabled={extendSaving}
                  style={{ flex: 2, padding: '10px', background: '#d97706', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer' }}>
                  {extendSaving ? 'Salvando…' : 'Confirmar extensão'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Taxas Financeiras por Gateway */}
      <div style={S.card}>
        <p style={S.subTitle}>Taxas Financeiras por Gateway</p>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Configure as taxas cobradas por cada gateway. Usadas para exibir o breakdown financeiro no analítico de comissões.
          <br/>As taxas reais do seu contrato devem ser verificadas diretamente nos painéis Asaas e Mercado Pago.
        </p>
        {['asaas', 'mercadopago'].map(gw => {
          const r = cfin[gw] || {};
          const gwLabel = gw === 'mercadopago' ? 'Mercado Pago' : 'Asaas';
          const prazoPadrao = gw === 'mercadopago' ? 0 : 32;
          return (
            <div key={gw} style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#111111', marginBottom: 12 }}>{gwLabel}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>TAXA CRÉDITO (MDR) %</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" step="0.001" min="0" max="10" value={r.taxa_credito_pct ?? 2.49}
                      onChange={e => updateCfin(gw, 'taxa_credito_pct', e.target.value)}
                      style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: 80 }} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>%</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>ex: 2,49%</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>TAXA DÉBITO (MDR) %</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" step="0.001" min="0" max="10" value={r.taxa_debito_pct ?? 0}
                      onChange={e => updateCfin(gw, 'taxa_debito_pct', e.target.value)}
                      style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: 80 }} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>%</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>PRAZO PADRÃO (D+X)</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 12, color: '#64748b' }}>D+</span>
                    <input type="number" step="1" min="1" max="60" value={r.prazo_recebimento_dias ?? prazoPadrao}
                      onChange={e => updateCfin(gw, 'prazo_recebimento_dias', e.target.value)}
                      style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: 60 }} />
                    <span style={{ fontSize: 12, color: '#64748b' }}>dias</span>
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{gw === 'mercadopago' ? 'crédito D+0 a D+14' : 'padrão D+32'}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>ANTECIPAÇÃO HABILITADA</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                    <input type="checkbox" checked={r.antecipacao_ativa || false}
                      onChange={e => updateCfin(gw, 'antecipacao_ativa', e.target.checked)}
                      style={{ width: 18, height: 18, cursor: 'pointer', accentColor: '#0D63DB' }} />
                    <span style={{ fontSize: 12, color: '#334155' }}>Ativa</span>
                  </div>
                </div>
                {r.antecipacao_ativa && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>TAXA ANTECIPAÇÃO % / MÊS</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="number" step="0.01" min="0" max="5" value={r.antecipacao_pct_mes ?? 1.25}
                        onChange={e => updateCfin(gw, 'antecipacao_pct_mes', e.target.value)}
                        style={{ ...S.input, padding: '6px 8px', fontSize: 13, width: 80 }} />
                      <span style={{ fontSize: 12, color: '#64748b' }}>% a.m.</span>
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
                      {gw === 'asaas' ? 'Asaas: a partir 1,25% a.m.' : 'Varia por contrato Stone'}
                    </div>
                  </div>
                )}
              </div>
              <button onClick={() => salvarCfin(gw)}
                style={{ marginTop: 14, padding: '7px 18px', background: cfinSaved[gw] ? '#10b981' : '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {cfinSaved[gw] ? '✓ Salvo' : `Salvar ${gwLabel}`}
              </button>
            </div>
          );
        })}
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
          Asaas: crédito D+32 · antecipação a partir de 1,25% ao mês · recebe em até 2 dias úteis · sem IOF<br/>
          Mercado Pago: crédito D+0 a D+14 conforme configuração da conta · rendimento CDI no saldo da conta
        </div>
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
  const [kycFotos, setKycFotos] = useState({ selfie_rosto: null, doc_frente: null, doc_verso: null, doc_digital: null, selfie_doc: null });
  // Documento: 'fisico' (frente + verso) | 'digital' (CNH-e / RG digital)
  const [kycModalidade, setKycModalidade] = useState('fisico');
  // Extra opcional: selfie segurando o documento
  const [kycSelfieSegurando, setKycSelfieSegurando] = useState(false);
  // Verificação de identidade por IA em andamento (bloqueia o botão)
  const [verificandoKyc, setVerificandoKyc] = useState(false);

  // Modo de criação: 'ia' (IA gera o texto) | 'assinar' (documento pronto que o admin carrega)
  const [modo, setModo] = useState(null);
  // Modo 'assinar': documento pronto enviado ao Storage
  const [arquivoUrl, setArquivoUrl] = useState('');
  const [arquivoNome, setArquivoNome] = useState('');
  const [arquivoUploading, setArquivoUploading] = useState(false);

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
    setKycIncluido(false); setKycFotos({ selfie_rosto: null, doc_frente: null, doc_verso: null, doc_digital: null, selfie_doc: null });
    setKycModalidade('fisico'); setKycSelfieSegurando(false); setVerificandoKyc(false);
    setModo(null); setArquivoUrl(''); setArquivoNome(''); setArquivoUploading(false);
    setStep(0); // etapa 0 = escolher o modo (IA ou documento pronto)
  }

  // Modo 'assinar': envia o documento pronto ao Storage privado e guarda a signed URL.
  async function enviarDocumentoPronto(file) {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { alert('Arquivo muito grande. Limite: 20 MB.'); return; }
    setArquivoUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
      const path = `contratos-docs/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { data, error } = await supabase.storage.from('documentos').upload(path, file, { upsert: false });
      if (error) throw error;
      const { data: signed } = await supabase.storage.from('documentos').createSignedUrl(data.path, 60 * 60 * 24 * 365);
      setArquivoUrl(signed?.signedUrl || '');
      setArquivoNome(file.name);
      if (!titulo.trim()) setTitulo(file.name.replace(/\.[^.]+$/, ''));
    } catch (e) {
      alert('Erro ao enviar o documento: ' + (e.message || 'tente novamente'));
      setArquivoUrl(''); setArquivoNome('');
    }
    setArquivoUploading(false);
  }

  function aplicarTemplate(key) {
    setTemplateSelecionado(key);
    if (key === 'assessorado') {
      setTitulo('Contrato de Assessoria para Aquisição de Imóvel em Leilão');
      setTipo('servico');
      setDescricao('Assessoria completa para identificação, análise de viabilidade, análise jurídica do edital e matrícula, acompanhamento do leilão e suporte pós-arrematação. Prazo: até 12 meses para conclusão da arrematação. Não inclui mentoria. Valor: R$500 em 12x (total R$6.000) ou R$4.800 à vista (20% de desconto) + 10% honorários de êxito sobre o valor arrematado. Rescisão: aviso prévio de 30 dias + multa de 10%.');
    } else if (key === 'clube') {
      setTitulo('Contrato de Adesão ao Clube de Negócios BidPro Brasil');
      setTipo('servico');
      setDescricao('Adesão ao Clube de Negócios BidPro Brasil: mentoria, assessoria e arrematações ilimitadas por 12 meses. Valor: R$5.000/mês (total R$60.000) ou R$48.000 à vista, vencimento dia 10. Fidelidade mínima de 12 meses. Rescisão antes do prazo: pagamento integral das parcelas restantes.');
    } else if (key === 'analista') {
      setTitulo('Contrato de Prestação de Serviços de Análise de Imóveis em Leilão');
      setTipo('servico');
      setDescricao('Contratação de analista para elaboração de relatórios de viabilidade econômico-financeira e análise de editais de imóveis em leilão judicial e extrajudicial. Remuneração por laudo emitido, a combinar. Sigilo sobre todos os dados dos clientes e imóveis analisados. Prazo indeterminado, rescisão com aviso de 30 dias.');
    } else if (key === 'advogado') {
      setTitulo('Contrato de Parceria Jurídica para Análise de Imóveis em Leilão');
      setTipo('servico');
      setDescricao('Parceria com advogado para análise jurídica de matrícula, edital, processo e certidões de imóveis em leilão, emissão de parecer jurídico por operação. Remuneração por parecer emitido, a combinar. Total sigilo sobre dados dos clientes. Prazo indeterminado, rescisão com aviso de 30 dias. Escritório parceiro independente.');
    } else if (key === 'consultor') {
      setTitulo('Contrato de Consultoria e Afiliação BidPro Brasil');
      setTipo('servico');
      setDescricao('Contratação de consultor/afiliado para divulgação dos serviços BidPro Brasil e captação de novos clientes. Remuneração por comissão sobre cada cliente ativo indicado, a combinar. Vedada qualquer promessa de rentabilidade a terceiros. Prazo indeterminado, rescisão com aviso de 30 dias.');
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
      const r = await apiCall('/api/gerar-contrato', {
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
    const ehAssinar = modo === 'assinar';
    if (ehAssinar) {
      if (!arquivoUrl) { alert('Envie o documento pronto antes de gerar o link.'); return; }
    } else if (!conteudo.trim()) {
      alert('O conteúdo do contrato está vazio.'); return;
    }

    // Monta o conjunto de fotos KYC conforme a modalidade escolhida.
    let kycFotosFinal = null;
    let verificacaoKyc = null;
    if (kycIncluido) {
      kycFotosFinal = { selfie_rosto: kycFotos.selfie_rosto };
      if (kycModalidade === 'digital') kycFotosFinal.doc_digital = kycFotos.doc_digital;
      else { kycFotosFinal.doc_frente = kycFotos.doc_frente; kycFotosFinal.doc_verso = kycFotos.doc_verso; }
      if (kycSelfieSegurando) kycFotosFinal.selfie_doc = kycFotos.selfie_doc;

      // Fotos mínimas: selfie + documento (frente+verso no físico / digital).
      const faltando = kycKeys.filter(k => !kycFotos[k]);
      if (faltando.length) { alert('Envie todas as fotos do KYC: ' + faltando.map(k => KYC_LABELS[k].label).join(', ')); return; }

      // Verificação por IA (documento válido + rosto bate). Veredito híbrido.
      setVerificandoKyc(true);
      try {
        const rv = await apiCall('/api/verificar-identidade-kyc', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            selfie: kycFotos.selfie_rosto,
            doc_tipo: kycModalidade,
            doc_frente: kycFotos.doc_frente,
            doc_verso: kycFotos.doc_verso,
            doc_digital: kycFotos.doc_digital,
          }),
        });
        const v = await rv.json().catch(() => ({}));
        verificacaoKyc = { resultado: v.resultado || 'revisar', detalhes: v.detalhes || null, em: new Date().toISOString() };
        setVerificandoKyc(false);
        if (v.resultado === 'bloqueado') {
          alert('⚠️ Verificação de identidade reprovada: ' + (v.mensagem || 'documento/rosto não conferem') + '\n\nCorrija as fotos e tente novamente.');
          return;
        }
        if (v.resultado === 'revisar') {
          if (!window.confirm('A IA não confirmou a identidade com segurança (' + (v.detalhes?.motivo || 'imagem pouco nítida') + ').\n\nGerar o contrato mesmo assim e marcar para revisão manual?')) return;
        }
      } catch {
        setVerificandoKyc(false);
        verificacaoKyc = { resultado: 'revisar', detalhes: { motivo: 'falha técnica na verificação' }, em: new Date().toISOString() };
        if (!window.confirm('Não foi possível verificar a identidade automaticamente. Gerar o contrato e marcar para revisão manual?')) return;
      }
    }

    setSavingLink(true);
    const { data, error } = await supabase.from('contratos_link').insert({
      titulo: titulo || 'Contrato',
      conteudo: ehAssinar ? `Documento anexo: ${arquivoNome || 'contrato'}` : conteudo,
      arquivo_url: ehAssinar ? arquivoUrl : null,
      arquivo_nome: ehAssinar ? arquivoNome : null,
      tipo_contrato: tipo,
      kyc_incluido: kycIncluido,
      kyc_fotos: kycFotosFinal,
      verificacao_kyc: verificacaoKyc,
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

  // Seção KYC compartilhada (modo IA e documento pronto): selfie + documento
  // (FÍSICO frente/verso ou DIGITAL) + opcional "selfie segurando o documento".
  // Ao gerar, a IA confere se o documento é válido e se a selfie é a mesma pessoa.
  const KYC_LABELS = {
    selfie_rosto: { label: 'Selfie (rosto)', emoji: '🤳' },
    doc_frente:   { label: 'Documento — frente', emoji: '🪪' },
    doc_verso:    { label: 'Documento — verso', emoji: '🪪' },
    doc_digital:  { label: 'Documento digital (CNH-e / RG digital)', emoji: '📱' },
    selfie_doc:   { label: 'Selfie segurando o documento', emoji: '📋' },
  };
  const kycKeys = [
    'selfie_rosto',
    ...(kycModalidade === 'digital' ? ['doc_digital'] : ['doc_frente', 'doc_verso']),
    ...(kycSelfieSegurando ? ['selfie_doc'] : []),
  ];
  const slotKyc = (key) => (
    <label key={key} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '12px 8px', border: `2px dashed ${kycFotos[key] ? '#22c55e' : '#e2e8f0'}`, borderRadius: 10, cursor: 'pointer', background: kycFotos[key] ? '#f0fdf4' : '#f8fafc' }}>
      {kycFotos[key] ? (
        <img src={kycFotos[key]} alt={KYC_LABELS[key].label} style={{ width: '100%', height: 70, objectFit: 'cover', borderRadius: 6 }} />
      ) : (
        <>
          <span style={{ fontSize: 24 }}>{KYC_LABELS[key].emoji}</span>
          <span style={{ fontSize: 11, color: '#64748b', textAlign: 'center', fontWeight: 600 }}>{KYC_LABELS[key].label}</span>
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
  );
  const renderKyc = () => (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px', marginBottom: 16 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: kycIncluido ? 14 : 0 }}>
        <input type="checkbox" checked={kycIncluido} onChange={e => setKycIncluido(e.target.checked)} style={{ width: 16, height: 16, accentColor: '#0D63DB' }} />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111111' }}>Incluir e verificar identidade (KYC) ao final do contrato</div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>Ao gerar, a IA confere se o documento é válido e se a selfie é a mesma pessoa do documento. As fotos ficam na última página do contrato.</div>
        </div>
      </label>
      {kycIncluido && (
        <>
          {/* Modalidade do documento */}
          <div style={{ fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:0.4, marginTop:14, marginBottom:6 }}>Tipo de documento</div>
          <div style={{ display:'flex', gap:8, marginBottom:8, flexWrap:'wrap' }}>
            {[
              { v:'fisico', label:'Físico (frente e verso)' },
              { v:'digital', label:'Digital (CNH-e / RG digital)' },
            ].map(op => (
              <button key={op.v} type="button" onClick={() => setKycModalidade(op.v)}
                style={{ padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', border:'1px solid',
                  background: kycModalidade === op.v ? '#0D63DB' : '#fff',
                  color: kycModalidade === op.v ? '#fff' : '#475569',
                  borderColor: kycModalidade === op.v ? '#0D63DB' : '#cbd5e1' }}>
                {op.label}
              </button>
            ))}
          </div>
          <label style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer', fontSize:12, color:'#475569', marginBottom:10 }}>
            <input type="checkbox" checked={kycSelfieSegurando} onChange={e => setKycSelfieSegurando(e.target.checked)} style={{ width:15, height:15, accentColor:'#0D63DB' }} />
            Incluir também “selfie segurando o documento”
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(kycKeys.length, 3)}, 1fr)`, gap: 10 }}>
            {kycKeys.map(slotKyc)}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <h2 style={{ fontSize:18, fontWeight:700, color:'#111111', margin:0 }}>Contratos ({contratosLink.length})</h2>
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
                <div style={{ fontSize:13, fontWeight:700, color:'#111111' }}>Nogueira Empreendimentos</div>
              </div>
              <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, fontWeight:700, color:'#0D63DB', textTransform:'uppercase', marginBottom:4 }}>Contratado</div>
                {detalhe.dados_signatario ? (
                  <>
                    <div style={{ fontSize:13, fontWeight:700, color:'#111111' }}>{detalhe.dados_signatario.nome || detalhe.dados_signatario.razao_social}</div>
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
              <div style={{ fontSize:13, color:'#111111', lineHeight:1.8, whiteSpace:'pre-wrap' }}>{detalhe.conteudo}</div>
            </div>

            {/* KYC fotos + resultado da verificação por IA */}
            {detalhe.kyc_incluido && detalhe.kyc_fotos && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                  Documentação KYC
                  {detalhe.verificacao_kyc?.resultado && (() => {
                    const r = detalhe.verificacao_kyc.resultado;
                    const cor = r === 'aprovado' ? '#059669' : r === 'bloqueado' ? '#dc2626' : '#d97706';
                    const txt = r === 'aprovado' ? '✓ Identidade verificada (IA)' : r === 'bloqueado' ? '✗ Reprovada (IA)' : '⚠ Revisão manual (IA)';
                    return <span style={{ padding:'2px 8px', borderRadius:999, fontSize:10, fontWeight:800, background:cor+'20', color:cor, textTransform:'none', letterSpacing:0 }}>{txt}</span>;
                  })()}
                </div>
                {detalhe.verificacao_kyc?.detalhes?.motivo && (
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:8 }}>IA: {detalhe.verificacao_kyc.detalhes.motivo}</div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap:'wrap' }}>
                  {['selfie_rosto','doc_frente','doc_verso','doc_digital','selfie_doc'].filter(k => detalhe.kyc_fotos[k]).map(k => (
                    <a key={k} href={detalhe.kyc_fotos[k]} target="_blank" rel="noopener noreferrer"
                      style={{ flex: '1 1 30%', minWidth: 90, display: 'block' }}>
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

      {/* Modal: Novo contrato — etapa 0 (modo) → 1/2/3. step===0 é válido (não usar truthiness). */}
      {step !== null && (
        <div style={{ ...S.overlay, alignItems: step === 2 ? 'stretch' : 'center', padding: step === 2 ? 0 : '20px' }}
          onClick={e => e.target === e.currentTarget && setStep(null)}>
          <div style={step === 2
            ? { background:'white', display:'flex', flexDirection:'column', width:'100%', height:'100%', maxWidth:'100%', overflow:'hidden' }
            : { ...S.modal, maxWidth:700 }}>

            {/* Indicador de etapas — só a partir da etapa 1 (a 0 é a escolha do modo).
                Em modo 'assinar' não há revisão de texto gerado pela IA. */}
            {step >= 1 && (() => {
              const passos = modo === 'assinar'
                ? [{ label:'Documento', n:1 }, { label:'Link gerado', n:3 }]
                : [{ label:'Descrever', n:1 }, { label:'Revisar', n:2 }, { label:'Link gerado', n:3 }];
              return (
                <div style={{ display:'flex', alignItems:'center', gap:8, padding: step===2 ? '14px 24px' : '0 0 20px',
                  borderBottom: step===2 ? '1px solid #e2e8f0' : 'none', flexShrink:0,
                  background: step===2 ? 'white' : 'transparent' }}>
                  {passos.map((p, i) => (
                    <React.Fragment key={p.n}>
                      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                        <div style={{ width:22, height:22, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800,
                          background: step > p.n ? '#059669' : step === p.n ? '#0D63DB' : '#e2e8f0',
                          color: step >= p.n ? 'white' : '#94a3b8' }}>{step > p.n ? '✓' : i+1}</div>
                        <span style={{ fontSize:12, fontWeight:step===p.n?700:400, color:step===p.n?'#111111':'#94a3b8' }}>{p.label}</span>
                      </div>
                      {i < passos.length-1 && <div style={{ flex:1, height:1, background:'#e2e8f0' }}/>}
                    </React.Fragment>
                  ))}
                  {step === 2 && (
                    <button onClick={() => setStep(null)} style={{ marginLeft:'auto', background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#94a3b8', lineHeight:1 }}>×</button>
                  )}
                </div>
              );
            })()}

            {/* ── Etapa 0: Escolher o modo ── */}
            {step === 0 && (
              <>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:6 }}>
                  <h3 style={{ ...S.sectionTitle, margin:0 }}>Novo contrato</h3>
                  <button onClick={() => setStep(null)} style={{ background:'none', border:'none', cursor:'pointer', fontSize:20, color:'#94a3b8', lineHeight:1 }}>×</button>
                </div>
                <p style={{ fontSize:13, color:'#64748b', marginBottom:18 }}>Como você quer criar este contrato? Emitido pela <strong>Nogueira Empreendimentos</strong>, com foro de Feira de Santana/BA e cláusulas de LGPD e anticorrupção.</p>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                  {[
                    { id:'ia', emoji:'✨', cor:'#6366f1', titulo:'Criar com IA', desc:'Você escreve em texto livre o que o contrato deve conter (e pode anexar documentos para a IA extrair as informações). A IA redige com máximo resguardo jurídico.' },
                    { id:'assinar', emoji:'📄', cor:'#0D63DB', titulo:'Assinar documento pronto', desc:'Você já tem o documento. Carregue o arquivo (PDF/Word/imagem) e gere o link de assinatura, sem editar o conteúdo.' },
                  ].map(op => (
                    <button key={op.id} onClick={() => { setModo(op.id); if (op.id === 'assinar') setTipo('outro'); setStep(1); }}
                      style={{ padding:'22px 18px', background:'white', border:`2px solid ${op.cor}33`, borderRadius:14, cursor:'pointer', textAlign:'left' }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = op.cor; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = `${op.cor}33`; }}>
                      <div style={{ fontSize:28, marginBottom:10 }}>{op.emoji}</div>
                      <div style={{ fontWeight:800, fontSize:15, color:'#111111', marginBottom:6 }}>{op.titulo}</div>
                      <div style={{ fontSize:12.5, color:'#64748b', lineHeight:1.6 }}>{op.desc}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ── Etapa 1 (modo assinar): documento pronto ── */}
            {step === 1 && modo === 'assinar' && (
              <>
                <h3 style={{ ...S.sectionTitle, marginBottom:4 }}>Documento pronto para assinatura</h3>
                <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>Carregue o arquivo final. Ele será enviado para assinatura <strong>sem edição</strong>. A outra parte preenche os dados e assina digitalmente.</p>

                <div style={{ marginBottom:14 }}>
                  <label style={S.label}>Título do contrato</label>
                  <input style={S.input} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título do contrato" />
                </div>

                <div style={{ marginBottom:16 }}>
                  <label style={S.label}>Arquivo do contrato (PDF, Word ou imagem) *</label>
                  <input type="file" accept=".pdf,.doc,.docx,image/*"
                    style={{ fontSize:12, color:'#334155' }}
                    onChange={e => enviarDocumentoPronto(e.target.files?.[0])} />
                  {arquivoUploading && <div style={{ fontSize:12, color:'#0D63DB', marginTop:8 }}>⏳ Enviando documento…</div>}
                  {arquivoUrl && !arquivoUploading && (
                    <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'#dcfce7', color:'#166534', fontSize:12, fontWeight:700, padding:'5px 12px', borderRadius:20, marginTop:8 }}>
                      ✓ {arquivoNome}
                      <button onClick={() => { setArquivoUrl(''); setArquivoNome(''); }} style={{ background:'none', border:'none', cursor:'pointer', color:'inherit', padding:0 }}>×</button>
                    </div>
                  )}
                </div>

                {renderKyc()}

                <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                  <button style={S.btn('outline')} onClick={() => setStep(0)}>← Voltar</button>
                  <button style={S.btn('primary')} onClick={gerarLinkContrato} disabled={savingLink || verificandoKyc || arquivoUploading || !arquivoUrl}>
                    {verificandoKyc ? '🔎 Verificando identidade…' : savingLink ? 'Gerando link…' : 'Gerar link de assinatura →'}
                  </button>
                </div>
              </>
            )}

            {/* ── Etapa 1 (modo IA): Descrever ── */}
            {step === 1 && modo !== 'assinar' && (
              <>
                <h3 style={{ ...S.sectionTitle, marginBottom:4 }}>Descreva o contrato</h3>
                <p style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>Escreva livremente o que o contrato deve conter — a IA redige com máximo resguardo jurídico (leis aplicáveis, LGPD, anticorrupção e foro de Feira de Santana/BA). O contrato será emitido pela <strong>Nogueira Empreendimentos</strong>. A outra parte preenche os dados e assina digitalmente.</p>

                <div style={{ marginBottom:12 }}>
                  <label style={S.label}>Título do contrato</label>
                  <input style={S.input} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Título do contrato" />
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
                        <div key={i} style={{ display:'flex', alignItems:'center', gap:4, background: a.conteudo ? '#dbeafe' : '#fef3c7', color: a.conteudo ? '#084BA6' : '#92400e', fontSize:11, fontWeight:600, padding:'3px 10px', borderRadius:20 }}>
                          {a.conteudo ? '📄' : '📎'} {a.nome}
                          <button onClick={() => setArquivos(prev => prev.filter((_, j) => j !== i))}
                            style={{ background:'none', border:'none', cursor:'pointer', color:'inherit', padding:0, marginLeft:2 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {renderKyc()}

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
                      <div style={{ fontSize:13, fontWeight:700, color:'#111111' }}>Nogueira Empreendimentos</div>
                    </div>
                    <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:10, padding:'12px 14px', marginBottom:20 }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#0D63DB', textTransform:'uppercase', marginBottom:4 }}>Contratado</div>
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
                    <div style={{ fontSize:13, fontWeight:700, color:'#111111' }}>{titulo || 'Contrato'}</div>
                    <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>Edite diretamente se necessário antes de aprovar.</div>
                  </div>
                  <textarea
                    style={{ flex:1, border:'none', outline:'none', resize:'none', fontFamily:'Georgia, serif', fontSize:14, lineHeight:1.9, padding:'24px 32px', color:'#111111', background:'white' }}
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
                  <button style={{ ...S.btn('primary'), padding:'10px 28px' }} onClick={gerarLinkContrato} disabled={savingLink || verificandoKyc || !conteudo.trim()}>
                    {verificandoKyc ? '🔎 Verificando identidade…' : savingLink ? 'Gerando link…' : '✓ Aprovar e gerar link'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Etapa 3: Link gerado ── */}
            {step === 3 && (
              <>
                <div style={{ textAlign:'center', padding:'20px 0 12px' }}>
                  <div style={{ fontSize:48, marginBottom:10 }}>🔗</div>
                  <h3 style={{ fontSize:18, fontWeight:800, color:'#111111', margin:'0 0 6px' }}>Link gerado com sucesso!</h3>
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
// Produtos (planos pagos) que um link de promoção pode ofertar. Deriva o nome do
// PlanosContext quando já carregou; cai num rótulo estático se ainda for null.
// (A ausência desta função causava "buildProdutosPromo is not defined" ao abrir a aba.)
function buildProdutosPromo(planosCtx) {
  const LABELS = { top2: 'Investidor Pro', assessorado: 'Assessoria', clube: 'Leilão Club' };
  return ['top2', 'assessorado', 'clube'].map((key) => ({
    key,
    label: planosCtx?.[key]?.nome || LABELS[key] || key,
  }));
}

const defaultPromo = () => ({ codigo: '', produto_tipo: 'plano', produto: 'top2', produto_ref_id: '', desconto_pct: '', validade_ate: '', desconto_validade_ate: '', exige_perguntas: false, perguntas: [], ativo: true });

const PROMO_STEPS = ['Produto', 'Validade do link', 'Desconto', 'Perguntas (SDR)', 'Revisar e criar'];
const novoCodigo = () => { const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return Array.from({ length: 8 }, () => c[Math.floor(Math.random() * c.length)]).join(''); };

function PromoTab() {
  const { user } = useAuth();
  const planosCtx = usePlanos();
  const PRODUTOS_PROMO = buildProdutosPromo(planosCtx);
  const [links, setLinks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cursos, setCursos] = useState([]);
  const [ebooks, setEbooks] = useState([]);
  const [form, setForm] = useState(defaultPromo());
  const [editId, setEditId] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState(0);

  const carregar = useCallback(async () => {
    setLoading(true);
    const [{ data: lk }, { data: cs }, { data: eb }] = await Promise.all([
      supabase.from('links_promo').select('*, perfis(nome)').order('criado_em', { ascending: false }),
      supabase.from('cursos_admin').select('id, titulo').eq('ativo', true).order('titulo'),
      supabase.from('ebooks_admin').select('id, titulo').eq('ativo', true).order('titulo'),
    ]);
    setLinks(lk || []); setCursos(cs || []); setEbooks(eb || []);
    setLoading(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const up = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const abrirCriar = () => { setForm({ ...defaultPromo(), codigo: novoCodigo() }); setEditId(null); setStep(0); setMsg(''); setWizard(true); };
  const fechar = () => { setWizard(false); setEditId(null); setForm(defaultPromo()); setStep(0); };

  const itemLabel = () => {
    if (form.produto_tipo === 'plano') return PRODUTOS_PROMO.find(p => p.key === form.produto)?.label || form.produto;
    if (form.produto_tipo === 'curso') return cursos.find(c => String(c.id) === String(form.produto_ref_id))?.titulo || '(selecione)';
    return ebooks.find(e => String(e.id) === String(form.produto_ref_id))?.titulo || '(selecione)';
  };
  const produtoOk = form.produto_tipo === 'plano' ? !!form.produto : !!form.produto_ref_id;
  const perguntasValidas = (form.perguntas || []).filter(p => p && String(p.texto || '').trim());

  const podeAvancar = () => {
    if (step === 0) return produtoOk;
    if (step === 3 && form.exige_perguntas) return perguntasValidas.length > 0;
    return true;
  };

  const salvar = async () => {
    if (!form.codigo.trim()) { setMsg('Informe o código.'); return; }
    if (!produtoOk) { setMsg('Selecione o produto.'); setStep(0); return; }
    if (form.exige_perguntas && perguntasValidas.length === 0) { setMsg('Adicione ao menos uma pergunta ou desmarque o SDR.'); setStep(3); return; }
    setSalvando(true); setMsg('');
    const payload = {
      codigo: form.codigo.trim().toUpperCase(),
      produto_tipo: form.produto_tipo,
      produto: form.produto_tipo === 'plano' ? form.produto : form.produto_tipo,
      produto_ref_id: form.produto_tipo === 'plano' ? null : (form.produto_ref_id || null),
      desconto_pct: Math.max(0, Math.min(100, Number(form.desconto_pct) || 0)),
      desconto_valor: 0,
      validade_ate: form.validade_ate ? new Date(form.validade_ate).toISOString() : null,
      desconto_validade_ate: form.desconto_validade_ate ? new Date(form.desconto_validade_ate).toISOString() : null,
      exige_perguntas: !!form.exige_perguntas,
      perguntas: form.exige_perguntas ? perguntasValidas : [],
      ativo: form.ativo,
      compartilhado: true, // promoções do admin ficam disponíveis p/ consultores e afiliados
      criado_por: user.id,
    };
    const { error } = editId
      ? await supabase.from('links_promo').update(payload).eq('id', editId)
      : await supabase.from('links_promo').insert(payload);
    if (error) { setMsg('Erro: ' + error.message); setSalvando(false); return; }
    setSalvando(false); fechar(); await carregar();
  };

  const editar = (l) => {
    setForm({
      codigo: l.codigo,
      produto_tipo: l.produto_tipo || 'plano',
      produto: (!l.produto_tipo || l.produto_tipo === 'plano') ? (l.produto || 'top2') : 'top2',
      produto_ref_id: l.produto_ref_id || '',
      desconto_pct: l.desconto_pct || '',
      validade_ate: l.validade_ate ? String(l.validade_ate).slice(0, 10) : '',
      desconto_validade_ate: l.desconto_validade_ate ? String(l.desconto_validade_ate).slice(0, 10) : '',
      exige_perguntas: !!l.exige_perguntas,
      perguntas: Array.isArray(l.perguntas) ? l.perguntas : [],
      ativo: l.ativo,
    });
    setEditId(l.id); setStep(0); setMsg(''); setWizard(true);
  };
  const toggleAtivo = async (l) => { await supabase.from('links_promo').update({ ativo: !l.ativo }).eq('id', l.id); await carregar(); };
  const copiarLink = (cod) => navigator.clipboard.writeText(`${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/promo/${cod}`);

  const tipoLabel = (t) => t === 'curso' ? 'Curso' : t === 'ebook' ? 'E-book' : 'Plano';
  const nomeDoLink = (l) => {
    if (!l.produto_tipo || l.produto_tipo === 'plano') return PRODUTOS_PROMO.find(p => p.key === l.produto)?.label || l.produto;
    if (l.produto_tipo === 'curso') return cursos.find(c => String(c.id) === String(l.produto_ref_id))?.titulo || 'Curso';
    return ebooks.find(e => String(e.id) === String(l.produto_ref_id))?.titulo || 'E-book';
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111111', margin: 0 }}>Promoções &amp; SDR</h2>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Um link só: escolha o produto/curso/e-book, o desconto e (opcional) as perguntas de qualificação. Os leads caem na carteira do consultor.</div>
        </div>
        <button onClick={abrirCriar} style={S.btn('primary')}>+ Criar link</button>
      </div>

      {/* Lista */}
      <div style={S.card}>
        {loading ? <p style={{ color: '#94a3b8' }}>Carregando…</p>
          : links.length === 0 ? <p style={{ color: '#94a3b8' }}>Nenhum link criado ainda. Clique em “Criar link”.</p>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {links.map(l => {
                const linkUrl = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/promo/${l.codigo}`;
                const desc = l.desconto_pct > 0 ? `${Number(l.desconto_pct).toFixed(0)}% off` : 'sem desconto';
                return (
                  <div key={l.id} style={{ padding: '14px 16px', border: `1px solid ${l.ativo ? '#e2e8f0' : '#fee2e2'}`, borderRadius: 12, background: l.ativo ? 'white' : '#fff5f5' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                      <div>
                        <span style={{ fontFamily: 'monospace', fontWeight: 900, fontSize: 15, color: '#111111', marginRight: 10 }}>{l.codigo}</span>
                        <span style={{ fontSize: 10, fontWeight: 800, background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: 20, marginRight: 6 }}>{tipoLabel(l.produto_tipo)}</span>
                        <span style={{ fontSize: 12, fontWeight: 700, color: '#0D63DB' }}>{nomeDoLink(l)}</span>
                        <span style={{ fontSize: 12, color: '#059669', fontWeight: 700, marginLeft: 8 }}>{desc}</span>
                        {!l.ativo && <span style={{ fontSize: 11, color: '#dc2626', fontWeight: 700, marginLeft: 8 }}>INATIVO</span>}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button onClick={() => copiarLink(l.codigo)} style={{ padding: '5px 10px', background: '#f1f5f9', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>Copiar link</button>
                        <button onClick={() => editar(l)} style={{ padding: '5px 10px', background: '#eff6ff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#0D63DB', cursor: 'pointer' }}>Editar</button>
                        <button onClick={() => toggleAtivo(l)} style={{ padding: '5px 10px', background: l.ativo ? '#fee2e2' : '#dcfce7', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: l.ativo ? '#dc2626' : '#166534', cursor: 'pointer' }}>{l.ativo ? 'Desativar' : 'Ativar'}</button>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                      {l.validade_ate && <span style={{ fontSize: 10, fontWeight: 700, background: '#fef9c3', color: '#a16207', padding: '2px 8px', borderRadius: 20 }}>Link até {new Date(l.validade_ate).toLocaleDateString('pt-BR')}</span>}
                      {l.desconto_validade_ate && <span style={{ fontSize: 10, fontWeight: 700, background: '#f0fdf4', color: '#15803d', padding: '2px 8px', borderRadius: 20 }}>Desconto até {new Date(l.desconto_validade_ate).toLocaleDateString('pt-BR')}</span>}
                      {l.exige_perguntas && Array.isArray(l.perguntas) && l.perguntas.length > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: '#f5f3ff', color: '#6d28d9', padding: '2px 8px', borderRadius: 20 }}>SDR obrigatório · {l.perguntas.length} pergunta(s)</span>}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: '#94a3b8', fontFamily: 'monospace', wordBreak: 'break-all' }}>{linkUrl}</div>
                    {l.perfis?.nome && <div style={{ marginTop: 4, fontSize: 11, color: '#94a3b8' }}>Criado por: {l.perfis.nome}</div>}
                  </div>
                );
              })}
            </div>
          )
        }
      </div>

      {/* WIZARD */}
      {wizard && (
        <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget && !salvando) fechar(); }}>
          <div style={{ ...S.modal, maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontSize: 17, fontWeight: 800, color: '#111' }}>{editId ? 'Editar link' : 'Novo link'}</div>
              <button onClick={fechar} style={{ background: 'none', border: 'none', fontSize: 18, color: '#94a3b8', cursor: 'pointer' }}>✕</button>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0D63DB', marginBottom: 10 }}>Passo {step + 1} de {PROMO_STEPS.length}: {PROMO_STEPS[step]}</div>
            <div style={{ display: 'flex', gap: 5, marginBottom: 18 }}>
              {PROMO_STEPS.map((_, i) => <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i <= step ? '#0D63DB' : '#e2e8f0' }} />)}
            </div>

            {/* STEP 0 — Produto */}
            {step === 0 && (
              <div>
                <label style={S.label}>1. O que este link entrega?</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  {[['plano', 'Plano'], ['curso', 'Curso'], ['ebook', 'E-book']].map(([t, lbl]) => (
                    <button key={t} onClick={() => up('produto_tipo', t)}
                      style={{ flex: 1, padding: '10px', borderRadius: 10, border: `2px solid ${form.produto_tipo === t ? '#0D63DB' : '#e2e8f0'}`, background: form.produto_tipo === t ? '#eff6ff' : 'white', color: '#111', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{lbl}</button>
                  ))}
                </div>
                {form.produto_tipo === 'plano' ? (
                  <select value={form.produto} onChange={e => up('produto', e.target.value)} style={S.input}>
                    {PRODUTOS_PROMO.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
                  </select>
                ) : form.produto_tipo === 'curso' ? (
                  <select value={form.produto_ref_id} onChange={e => up('produto_ref_id', e.target.value)} style={S.input}>
                    <option value="">Selecione o curso…</option>
                    {cursos.map(c => <option key={c.id} value={c.id}>{c.titulo}</option>)}
                  </select>
                ) : (
                  <select value={form.produto_ref_id} onChange={e => up('produto_ref_id', e.target.value)} style={S.input}>
                    <option value="">Selecione o e-book…</option>
                    {ebooks.map(e2 => <option key={e2.id} value={e2.id}>{e2.titulo}</option>)}
                  </select>
                )}
              </div>
            )}

            {/* STEP 1 — Validade do link */}
            {step === 1 && (
              <div>
                <label style={S.label}>2. Até quando este link fica ativo?</label>
                <input type="date" value={form.validade_ate} onChange={e => up('validade_ate', e.target.value)} style={S.input} />
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Depois desta data o link para de funcionar. Deixe em branco para não expirar.</div>
              </div>
            )}

            {/* STEP 2 — Desconto */}
            {step === 2 && (
              <div>
                <label style={S.label}>3. Desconto do benefício (0 a 100%)</label>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 6 }}>
                  <input type="range" min="0" max="100" step="1" value={Number(form.desconto_pct) || 0} onChange={e => up('desconto_pct', e.target.value)} style={{ flex: 1 }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" min="0" max="100" value={form.desconto_pct} onChange={e => up('desconto_pct', e.target.value)} style={{ ...S.input, width: 70, textAlign: 'right' }} />
                    <span style={{ fontWeight: 800, color: '#111' }}>%</span>
                  </div>
                </div>
                <div style={{ borderTop: '1px solid #f1f5f9', margin: '14px 0 12px' }} />
                <label style={S.label}>Validade do desconto (pode ser diferente da validade do link)</label>
                <input type="date" value={form.desconto_validade_ate} onChange={e => up('desconto_validade_ate', e.target.value)} style={S.input} />
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 8 }}>Depois desta data o link ainda abre, mas sem o desconto. Deixe em branco para o desconto valer enquanto o link estiver ativo.</div>
              </div>
            )}

            {/* STEP 3 — Perguntas SDR */}
            {step === 3 && (
              <div>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 4 }}>
                  <input type="checkbox" checked={form.exige_perguntas} onChange={e => up('exige_perguntas', e.target.checked)} style={{ marginTop: 3 }} />
                  <span>
                    <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>Exigir perguntas de qualificação (SDR)</span>
                    <span style={{ display: 'block', fontSize: 12, color: '#64748b', marginTop: 2 }}>Se marcado, ao abrir o link a pessoa <strong>responde as perguntas (uma por vez)</strong> para ter acesso ao {form.produto_tipo === 'plano' ? 'plano' : form.produto_tipo === 'curso' ? 'curso' : 'e-book'} nas condições definidas. As respostas viram um lead para o consultor.</span>
                  </span>
                </label>

                {form.exige_perguntas && (
                  <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14, marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: '#111' }}>Perguntas</div>
                      <button type="button" onClick={() => up('perguntas', [...(form.perguntas || []), { id: Date.now(), texto: '', tipo: 'texto', opcoes: '' }])}
                        style={{ padding: '5px 10px', background: '#eff6ff', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 700, color: '#0D63DB', cursor: 'pointer' }}>+ Adicionar pergunta</button>
                    </div>
                    {(form.perguntas || []).length === 0 && <div style={{ color: '#94a3b8', fontSize: 12, padding: '4px 0' }}>Adicione ao menos uma pergunta.</div>}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {(form.perguntas || []).map((p, i) => (
                        <div key={p.id} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: 10 }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <div style={{ flex: 1 }}>
                              <input style={{ ...S.input, marginBottom: 6 }} value={p.texto} placeholder={`Pergunta ${i + 1}`}
                                onChange={e => up('perguntas', form.perguntas.map((q, j) => j === i ? { ...q, texto: e.target.value } : q))} />
                              <div style={{ display: 'flex', gap: 8 }}>
                                <select style={{ ...S.input, width: 130, fontSize: 12 }} value={p.tipo}
                                  onChange={e => up('perguntas', form.perguntas.map((q, j) => j === i ? { ...q, tipo: e.target.value } : q))}>
                                  <option value="texto">Texto livre</option>
                                  <option value="multipla">Múltipla escolha</option>
                                  <option value="sim_nao">Sim / Não</option>
                                </select>
                                {p.tipo === 'multipla' && (
                                  <input style={{ ...S.input, flex: 1, fontSize: 12 }} value={p.opcoes || ''} placeholder="Opções separadas por vírgula"
                                    onChange={e => up('perguntas', form.perguntas.map((q, j) => j === i ? { ...q, opcoes: e.target.value } : q))} />
                                )}
                              </div>
                            </div>
                            <button type="button" onClick={() => up('perguntas', form.perguntas.filter((_, j) => j !== i))}
                              style={{ padding: '3px 8px', background: '#fee2e2', border: 'none', borderRadius: 6, fontSize: 11, color: '#dc2626', cursor: 'pointer' }}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* STEP 4 — Revisar e criar */}
            {step === 4 && (
              <div>
                <label style={S.label}>Código do link</label>
                <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                  <input value={form.codigo} onChange={e => up('codigo', e.target.value.toUpperCase())} placeholder="CÓDIGO" style={{ ...S.input, flex: 1, fontFamily: 'monospace', fontWeight: 700 }} maxLength={12} />
                  <button onClick={() => up('codigo', novoCodigo())} style={{ padding: '0 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 700, color: '#475569', cursor: 'pointer' }}>Gerar</button>
                </div>
                <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', fontSize: 13, color: '#334155', lineHeight: 1.8 }}>
                  <div><strong>Entrega:</strong> {tipoLabelFn(form.produto_tipo)} — {itemLabel()}</div>
                  <div><strong>Validade do link:</strong> {form.validade_ate ? new Date(form.validade_ate).toLocaleDateString('pt-BR') : 'sem expiração'}</div>
                  <div><strong>Desconto:</strong> {Number(form.desconto_pct) > 0 ? `${Number(form.desconto_pct)}%` : 'nenhum'}{form.desconto_validade_ate ? ` (até ${new Date(form.desconto_validade_ate).toLocaleDateString('pt-BR')})` : ''}</div>
                  <div><strong>Perguntas SDR:</strong> {form.exige_perguntas ? `obrigatórias — ${perguntasValidas.length} pergunta(s)` : 'não'}</div>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', marginTop: 14, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.ativo} onChange={e => up('ativo', e.target.checked)} /> Ativar o link ao criar
                </label>
              </div>
            )}

            {msg && <div style={{ marginTop: 14, padding: '8px 12px', background: msg.startsWith('Erro') ? '#fee2e2' : '#fef9c3', color: msg.startsWith('Erro') ? '#dc2626' : '#a16207', borderRadius: 8, fontSize: 12, fontWeight: 700 }}>{msg}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
              <button onClick={() => step === 0 ? fechar() : setStep(s => s - 1)} disabled={salvando}
                style={{ padding: '11px 18px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {step === 0 ? 'Cancelar' : 'Voltar'}
              </button>
              {step < PROMO_STEPS.length - 1 ? (
                <button onClick={() => setStep(s => s + 1)} disabled={!podeAvancar()}
                  style={{ flex: 1, padding: '11px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: podeAvancar() ? 1 : 0.5 }}>
                  Próximo
                </button>
              ) : (
                <button onClick={salvar} disabled={salvando}
                  style={{ flex: 1, padding: '11px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: salvando ? 0.6 : 1 }}>
                  {salvando ? 'Salvando…' : editId ? 'Salvar alterações' : 'Criar link'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function tipoLabelFn(t) { return t === 'curso' ? 'Curso' : t === 'ebook' ? 'E-book' : 'Plano'; }

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
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111111', margin: 0 }}>Links de Convite</h2>
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
                <div style={{ fontWeight: 700, fontSize: 14, color: '#111111' }}>{c.codigo}</div>
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
  { key: 'sold',       label: 'Sold (BV/Bradesco/Itaú)', cor: '#0D63DB' },
  { key: 'zuk',        label: 'Zuk (Sicredi)',     cor: '#059669' },
  { key: 'megaleiloes',label: 'MegaLeilões',       cor: '#7c3aed' },
  { key: 'sicoob',     label: 'Sicoob',            cor: '#0891b2' },
];

// Fonte ÚNICA de verdade dos leiloeiros (o `fonte` casa com imoveis_leilao e
// fonte_saude, em MAIÚSCULAS). Alimenta a contagem E os cards do painel — assim
// a lista nunca mais fica desatualizada ao adicionar um leiloeiro novo.
const FONTES_LEILAO = [
  { fonte: 'CEF',      nome: 'Caixa (CEF)',       cor: '#0055a4', desc: 'Maior acervo · venda direta e leilão' },
  { fonte: 'MEGA',     nome: 'Mega Leilões',      cor: '#0D63DB', desc: 'Residenciais e comerciais' },
  { fonte: 'SUPERBID', nome: 'Superbid',          cor: '#059669', desc: 'Maior marketplace do Brasil' },
  { fonte: 'ZUK',      nome: 'Portal Zuk',        cor: '#0ea5e9', desc: 'Zukerman · bancos e judicial' },
  { fonte: 'SOLD',     nome: 'Sold Leilões',      cor: '#7c3aed', desc: 'BV, Bradesco, Itaú e outros' },
  { fonte: 'FRAZAO',   nome: 'Frazão Leilões',    cor: '#db2777', desc: 'Judicial e extrajudicial · SP' },
  { fonte: 'SODRE',    nome: 'Sodré Santoro',     cor: '#ca8a04', desc: 'Judicial e bancário' },
  // LJUD (coleta sob demanda via Bright Data) e BB (não coletado) saíram do
  // monitor diário para não gerar falso-alarme — não são fontes de cron diário.
];

// Diagnóstico DETERMINÍSTICO da captação (SEM IA): cruza os indicadores da última
// coleta (fonte_saude) com a coleta anterior e aponta a CAUSA provável + a PRÓXIMA
// AÇÃO de scraping. É a parte "aprende / busca soluções de scraping" do monitor,
// resolvida por regra (o dono decidiu que captação NÃO é função de IA). Retorna
// null quando está tudo bem. Cada problema: { causa, acao }.
function diagnosticoCaptacao(atual, anterior) {
  if (!atual) return null;
  const pct = (v) => Math.round((Number(v) || 0) * 100);
  const totalAtual = Number(atual.total) || 0;
  const totalAnt = anterior ? (Number(anterior.total) || 0) : null;
  const problemas = [];

  // 1) Coleta zerada / falha total → bloqueio provável (prioridade máxima).
  if (atual.status === 'falhou' || totalAtual === 0) {
    problemas.push({
      causa: 'Coleta zerada. Provável bloqueio, mudança de fingerprint/user-agent ou site fora do ar.',
      acao: 'Rodar o diagnóstico da fonte; se persistir, coletar via Bright Data (IP residencial) ou revisar o seletor da lista.',
    });
    return { nivel: 'falhou', problemas };
  }

  // 2) Queda de volume relevante frente à coleta anterior → seletor de listagem/paginação mudou.
  if (totalAnt != null && totalAnt >= 20 && totalAtual < totalAnt * 0.5) {
    const queda = Math.round((1 - totalAtual / totalAnt) * 100);
    problemas.push({
      causa: `Volume caiu ${queda}% frente à coleta anterior (${totalAnt.toLocaleString('pt-BR')} → ${totalAtual.toLocaleString('pt-BR')}).`,
      acao: 'Conferir o seletor da lista de lotes e a paginação; o layout da fonte pode ter mudado.',
    });
  }

  // 3) Campo faltando em massa → o parsing daquele campo específico quebrou.
  const campos = [
    { k: 'valor_pct', lim: 40, nome: 'valor',          dica: 'parsing de preço' },
    { k: 'uf_pct',    lim: 60, nome: 'UF/endereço',    dica: 'parsing de endereço/UF' },
    { k: 'link_pct',  lim: 30, nome: 'link do edital', dica: 'seletor do edital' },
    { k: 'foto_pct',  lim: 30, nome: 'foto',           dica: 'seletor de imagem/CDN' },
  ];
  for (const c of campos) {
    const p = pct(atual[c.k]);
    if (p >= c.lim) continue;
    const antP = anterior ? pct(anterior[c.k]) : null;
    const caiu = antP != null && (antP - p) >= 25;
    problemas.push({
      causa: `${c.nome} presente em só ${p}% dos lotes${caiu ? ` (era ${antP}%)` : ''}.`,
      acao: `Revisar o ${c.dica} do scraper desta fonte.`,
    });
  }

  // Fallback: fonte marcada com atenção pelo próprio scraper, mas sem um padrão de
  // campo reconhecido acima. Mostra o motivo que a coleta registrou (nunca deixa um
  // badge ⚠️/✕ sem explicação).
  if (!problemas.length && (atual.status === 'degradado' || atual.status === 'falhou')) {
    problemas.push({
      causa: atual.motivo ? String(atual.motivo) : 'A fonte foi marcada como degradada na última coleta (a validação de qualidade reprovou).',
      acao: 'Rodar o diagnóstico da fonte na aba Fontes e conferir o scraper desta origem.',
    });
  }

  if (!problemas.length) return null;
  return { nivel: atual.status === 'degradado' ? 'degradado' : 'alerta', problemas };
}

// Monitor de coleta — usa a MESMA fonte de verdade da aba Scrapers (tabela
// fonte_saude, keyed em MAIÚSCULAS por FONTES_LEILAO). Antes lia scrapers_log com
// uma lista antiga (Santander/Rodobens/Sicoob) que não batia com as fontes reais.
function ScrapersMonitor() {
  const [saude, setSaude] = useState({});
  const [prev, setPrev] = useState({}); // coleta anterior por fonte (tendência do diagnóstico)
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Puxa os indicadores de qualidade e as 2 últimas coletas por fonte (a 2ª serve
    // de base para o diagnóstico determinístico apontar regressão/tendência).
    supabase.from('fonte_saude')
      .select('fonte,total,status,valor_pct,uf_pct,link_pct,foto_pct,estrategia,motivo,executado_em')
      .order('executado_em', { ascending: false }).limit(120)
      .then(({ data }) => {
        const ult = {}, ant = {};
        (data || []).forEach(l => {
          if (!ult[l.fonte]) ult[l.fonte] = l;
          else if (!ant[l.fonte]) ant[l.fonte] = l;
        });
        setSaude(ult); setPrev(ant); setLoading(false);
      });
  }, []);

  const estilo = (st) => st === 'ok' ? { cor: '#10b981', bg: '#f0fdf4', icone: '✅' }
    : st === 'degradado' ? { cor: '#d97706', bg: '#fefce8', icone: '⚠️' }
    : st === 'falhou' ? { cor: '#dc2626', bg: '#fef2f2', icone: '❌' }
    : { cor: '#94a3b8', bg: '#f8fafc', icone: '⏸' };
  const problemas = FONTES_LEILAO.filter(f => ['degradado', 'falhou'].includes(saude[f.fonte]?.status));

  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111' }}>Monitor de coleta</div>
        {problemas.length > 0 && (
          <span style={{ background: '#fef2f2', color: '#dc2626', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20 }}>
            ⚠️ {problemas.length} com atenção
          </span>
        )}
      </div>
      {loading ? <p style={{ fontSize: 13, color: '#94a3b8' }}>Carregando...</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {FONTES_LEILAO.map(f => {
            const s = saude[f.fonte];
            const e = estilo(s?.status);
            const diag = diagnosticoCaptacao(s, prev[f.fonte]);
            const dc = diag ? (diag.nivel === 'falhou' ? { bg: '#fef2f2', bd: '#fecaca', cor: '#b91c1c' } : { bg: '#fffbeb', bd: '#fde68a', cor: '#92400e' }) : null;
            return (
              <div key={f.fonte} style={{ padding: '10px 12px', background: e.bg, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: f.cor, flexShrink: 0 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#111111' }}>{f.nome}</div>
                      {s ? <div style={{ fontSize: 11, color: '#64748b' }}>
                        {Number(s.total || 0).toLocaleString('pt-BR')} imóveis · {new Date(s.executado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div> : <div style={{ fontSize: 11, color: '#94a3b8' }}>Sem coleta registrada</div>}
                    </div>
                  </div>
                  <span style={{ fontSize: 16 }}>{e.icone}</span>
                </div>
                {/* Diagnóstico determinístico (SEM IA): causa provável + próxima ação. */}
                {diag && (
                  <div style={{ background: dc.bg, border: `1px solid ${dc.bd}`, borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: dc.cor, marginBottom: 4 }}>🔧 Diagnóstico automático (sem IA)</div>
                    {diag.problemas.slice(0, 3).map((p, i) => (
                      <div key={i} style={{ fontSize: 10.5, color: dc.cor, lineHeight: 1.5, marginBottom: i < Math.min(diag.problemas.length, 3) - 1 ? 5 : 0 }}>
                        <div><strong>Causa:</strong> {p.causa}</div>
                        <div><strong>Ação:</strong> {p.acao}</div>
                      </div>
                    ))}
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

// Receita MENSAL-equivalente de um plano, a partir do planos_config. ÚNICA regra de
// MRR do dashboard — antes o marcador do topo e o detalhe por plano divergiam: o
// detalhe rotulava a Assessoria (pacote de R$6.000/12m) e o Leilão Club (R$60.000)
// como "/mês" e somava o valor CHEIO, fazendo o MRR de UM plano (R$6.000) superar o
// MRR TOTAL do topo (R$599,80). Aqui: pacote de prazo fixo (acesso_meses>1) =
// preço/meses; recorrente barato (≤R$200) = o próprio preço; preço alto sem meses
// (clube) = preço/12. Fallback no valor atual se o config ainda não carregou.
function mrrMensalPlano(plano, fallback = 0) {
  const preco = Number(plano?.preco);
  if (!(preco > 0)) return fallback;
  const meses = Number(plano?.acesso_meses) || 0;
  if (meses > 1) return preco / meses;
  if (preco <= 200) return preco;
  return preco / 12;
}

function UsuariosPlanoDetalhe({ planoKey }) {
  const [usuarios, setUsuarios] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  const planosCtx = usePlanos();
  const pNome = (key) => planosCtx?.[key]?.nome || key;
  const fmt = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Mensal-equivalente por plano — mesma conta do marcador do topo (mrrMensalPlano).
  const PRECO = {
    explorador: 0,
    top2: mrrMensalPlano(planosCtx?.top2, 49.90),
    assessorado: mrrMensalPlano(planosCtx?.assessorado, 500),
    clube: mrrMensalPlano(planosCtx?.clube, 5000),
  };
  // "eq." nos pacotes de prazo fixo (Assessoria/Club) deixa claro que é mensal-equivalente,
  // não uma cobrança recorrente de fato — some a divergência com o valor cheio do pacote.
  const LABEL = {
    explorador: 'Explorador (Grátis)',
    top2: `${pNome('top2')} (R$ ${fmt(PRECO.top2)}/mês)`,
    assessorado: `${pNome('assessorado')} (R$ ${fmt(PRECO.assessorado)}/mês eq.)`,
    clube: `${pNome('clube')} (R$ ${fmt(PRECO.clube)}/mês eq.)`,
  };

  React.useEffect(() => {
    supabase.from('perfis')
      .select('id, nome, email, created_at, inadimplente_desde, plano_ciclo, plano_vencimento')
      .eq('role', planoKey)
      .order('created_at', { ascending: false })
      .then(({ data }) => { setUsuarios(data || []); setLoading(false); });
  }, [planoKey]);

  if (loading) return <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 20 }}>Carregando...</div>;

  const preco = PRECO[planoKey] || 0;
  const mrr = usuarios.filter(u => !u.inadimplente_desde).length * preco;
  const inadimplentes = usuarios.filter(u => u.inadimplente_desde).length;

  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700, color: '#111111', marginBottom: 12 }}>{LABEL[planoKey]}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          { label: 'Total', value: usuarios.length, cor: '#0D63DB' },
          { label: 'Ativos', value: usuarios.length - inadimplentes, cor: '#10b981' },
          { label: preco > 0 ? 'MRR estimado' : '—', value: preco > 0 ? `R$ ${fmt(mrr)}` : '—', cor: '#7c3aed' },
        ].map(({ label, value, cor }) => (
          <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: cor }}>{value}</div>
          </div>
        ))}
      </div>
      {inadimplentes > 0 && (
        <div style={{ background: '#fef2f2', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#dc2626', fontWeight: 600, marginBottom: 12 }}>
          ⚠️ {inadimplentes} inadimplente{inadimplentes > 1 ? 's' : ''}
        </div>
      )}
      <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {usuarios.map(u => (
          <div key={u.id} style={{ padding: '8px 10px', background: u.inadimplente_desde ? '#fef2f2' : '#f8fafc', borderRadius: 8, border: `1px solid ${u.inadimplente_desde ? '#fca5a5' : '#e2e8f0'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#111111' }}>{u.nome || '—'}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{u.email}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Desde {new Date(u.created_at).toLocaleDateString('pt-BR')}</div>
                {u.inadimplente_desde && <div style={{ fontSize: 10, color: '#dc2626', fontWeight: 700 }}>Inadimplente</div>}
                {u.plano_ciclo === 'anual' && <div style={{ fontSize: 10, color: '#7c3aed', fontWeight: 700 }}>Anual</div>}
              </div>
            </div>
          </div>
        ))}
        {usuarios.length === 0 && <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: 20 }}>Nenhum usuário neste plano.</div>}
      </div>
    </div>
  );
}

// Painel "Custos & Uso das Integrações" — marcadores de teto (grátis/orçamento)
// por provedor pago (Gemini, Claude, geocoders, Resend, Daily, Bright Data), para
// não haver surpresa ao estourar cota/custo. Fonte: /api/uso-integracoes.
function PainelCustosUso() {
  const [uso, setUso] = React.useState(null);
  const [erro, setErro] = React.useState(false);
  React.useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await apiCall('/api/uso-integracoes');
        const data = await res.json();
        if (!vivo) return;
        if (res.ok) setUso(data); else setErro(true);
      } catch { if (vivo) setErro(true); }
    })();
    return () => { vivo = false; };
  }, []);

  const COR = { verde: '#10b981', amarelo: '#f59e0b', vermelho: '#dc2626' };
  const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const int = (v) => Number(v || 0).toLocaleString('pt-BR');

  // Indisponível: mostra um aviso discreto (não some — assim o admin sabe que a FONTE caiu,
  // e não confunde "sem custo" com "custo não carregou"). Nunca trava o dashboard.
  if (erro) return (
    <div style={{ ...S.card, color: '#94a3b8', fontSize: 12.5, marginBottom: 16 }}>
      💸 Custos &amp; Uso — indisponível no momento (falha ao consultar <code>/api/uso-integracoes</code>).
    </div>
  );
  if (!uso) return <div style={{ ...S.card, color: '#94a3b8', fontSize: 13, marginBottom: 16 }}>Carregando custos…</div>;

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111' }}>💸 Custos &amp; Uso das Integrações</div>
        <div style={{ fontSize: 13, color: '#64748b', textAlign: 'right' }}>
          <div>No mês até agora: <b style={{ color: '#111111' }}>{brl(uso.total_mes?.custo_brl)}</b> <span style={{ color: '#94a3b8' }}>(~US$ {Number(uso.total_mes?.custo_usd || 0).toFixed(2)})</span></div>
          {uso.total_mes?.projecao_custo_brl != null && <div style={{ fontSize: 11, color: '#94a3b8' }}>📈 projeção fim de mês (ritmo atual): <b>{brl(uso.total_mes.projecao_custo_brl)}</b></div>}
        </div>
      </div>

      {/* Marcador de sustentabilidade: 1 Investidor Pro banca N consultas grátis */}
      {uso.sustentabilidade && (() => {
        const s = uso.sustentabilidade;
        const cor = COR[s.status] || '#94a3b8';
        const pct = Math.min(100, s.pct || 0);
        return (
          <div style={{ border: `1px solid ${cor}40`, background: cor + '0c', borderRadius: 10, padding: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111111' }}>♻️ Sustentabilidade da IA grátis (Explorador)</div>
              <div style={{ fontSize: 12, color: '#475569' }}>{int(s.analises_explorador_mes)} / {int(s.teto_sustentavel)} análises grátis · <span style={{ color: cor, fontWeight: 700 }}>{s.pct >= 999 ? '∞' : s.pct + '%'}</span></div>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ width: pct + '%', height: '100%', background: cor, transition: 'width .3s' }} />
            </div>
            <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 12, color: '#334155', marginBottom: 4 }}>
              <span><b>{int(s.n_investidor_pro)}</b> Investidor Pro</span>
              <span><b>{int(s.n_explorador)}</b> Explorador</span>
              <span>1 Pro banca <b>~{int(s.analises_por_pro)}</b> análises grátis/mês</span>
              <span>Custo/análise ~<b>{brl(s.custo_analise_brl)}</b> <span style={{ color: s.custo_aprendido ? '#10b981' : '#94a3b8', fontWeight: 700 }}>{s.custo_aprendido ? `📈 real (${int(s.custo_base_amostras)})` : '· piloto'}</span></span>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.35 }}>{s.nota}</div>
          </div>
        );
      })()}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 12 }}>
        {(uso.provedores || []).map((p) => {
          const t = p.teto || {};
          const temBarra = typeof t.limite === 'number' && t.limite > 0;
          const cor = COR[t.status] || '#94a3b8';
          const pct = Math.min(100, t.pct || 0);
          return (
            <div key={p.chave} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, background: '#ffffff' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#111111', marginBottom: 6 }}>{p.label}</div>
              {temBarra && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#475569', marginBottom: 4 }}>
                    <span>{int(t.usado)} / {int(t.limite)}</span>
                    <span style={{ color: cor, fontWeight: 700 }}>{t.pct || 0}%</span>
                  </div>
                  <div style={{ height: 7, borderRadius: 4, background: '#f1f5f9', overflow: 'hidden', marginBottom: 8 }}>
                    <div style={{ width: pct + '%', height: '100%', background: cor, transition: 'width .3s' }} />
                  </div>
                </>
              )}
              {p.mes?.custo_brl != null && (
                <div style={{ fontSize: 12, color: '#334155', marginBottom: 4 }}>Mês: <b>{brl(p.mes.custo_brl)}</b>{p.mes.buscas_web ? ` · ${int(p.mes.buscas_web)} buscas web` : ''}</div>
              )}
              {p.mes?.unidades != null && !temBarra && (
                <div style={{ fontSize: 12, color: '#334155', marginBottom: 4 }}>Mês: {int(p.mes.unidades)}</div>
              )}
              {p.hoje && p.hoje.requests != null && (
                <div style={{ fontSize: 11, color: '#94a3b8' }}>Hoje: {int(p.hoje.requests)} req · {int(p.hoje.tokens)} tokens</div>
              )}
              {t.nota && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, lineHeight: 1.35 }}>{t.nota}</div>}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 10 }}>Estimativa a partir do uso medido (tokens/requisições). O valor oficial é o do painel de billing de cada provedor.</div>
    </div>
  );
}

// Diagnóstico por IA (Gemini, cacheado ~1×/dia) sobre os indicadores reais —
// leitura + sugestões que mesclam assertividade (qualidade) e economia (custo).
function PainelDiagnosticoIA() {
  const [diag, setDiag] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [erro, setErro] = React.useState(false);
  const carregar = React.useCallback(async (forcar) => {
    setLoading(true); setErro(false);
    try {
      const res = await apiCall(`/api/diagnostico-ia${forcar ? '?forcar=1' : ''}`);
      const data = await res.json();
      if (res.ok) setDiag(data); else setErro(true);
    } catch { setErro(true); }
    setLoading(false);
  }, []);
  React.useEffect(() => { carregar(false); }, [carregar]);

  const COR = { verde: '#10b981', amarelo: '#f59e0b', vermelho: '#dc2626' };
  const PRIOR = { alta: '#dc2626', media: '#f59e0b', baixa: '#64748b' };
  const IMP = { economia: '💰', qualidade: '⭐', crescimento: '📈', risco: '⚠️' };

  if (erro) return null;
  const cor = COR[diag?.saude] || '#64748b';

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', display: 'flex', alignItems: 'center', gap: 8 }}>
          🧠 Diagnóstico &amp; Sugestões (IA)
          {diag?.saude && <span style={{ width: 10, height: 10, borderRadius: '50%', background: cor, display: 'inline-block' }} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {diag?.gerado_em && <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(diag.gerado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}{diag.modelo ? ` · ${diag.modelo}` : ''}</span>}
          <button onClick={() => carregar(true)} disabled={loading}
            style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: '#0D63DB', cursor: loading ? 'default' : 'pointer' }}>
            {loading ? 'Analisando…' : '↻ Atualizar'}
          </button>
        </div>
      </div>
      {loading && !diag ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Gerando diagnóstico…</div> : diag ? (
        <>
          {diag.resumo && <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, marginBottom: 12, padding: '10px 14px', background: '#f8fafc', borderRadius: 10, borderLeft: `3px solid ${cor}` }}>{diag.resumo}</div>}
          {diag.economia_potencial_brl > 0 && <div style={{ fontSize: 12, color: '#059669', fontWeight: 700, marginBottom: 10 }}>💰 Economia potencial estimada: R$ {Number(diag.economia_potencial_brl).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/mês</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {(diag.pontos || []).map((p, i) => (
              <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13 }}>{IMP[p.impacto] || '•'}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111111' }}>{p.area}</span>
                  {p.prioridade && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: (PRIOR[p.prioridade] || '#64748b') + '18', color: PRIOR[p.prioridade] || '#64748b', textTransform: 'uppercase' }}>{p.prioridade}</span>}
                </div>
                {p.diagnostico && <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 4 }}>{p.diagnostico}</div>}
                {p.sugestao && <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}><b>→ </b>{p.sugestao}</div>}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 10 }}>Gerado por IA (Gemini) a partir dos indicadores reais · atualiza ~1×/dia ou sob demanda. Sugestões consultivas.</div>
        </>
      ) : <div style={{ color: '#94a3b8', fontSize: 13 }}>Sem diagnóstico disponível.</div>}
    </div>
  );
}

// Auditoria técnica do sistema pelo Claude (só leitura). A auditoria roda numa
// GitHub Action; aqui mostramos o último relatório. Correções viram PR revisável.
function PainelAuditoriaSistema() {
  const [a, setA] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [erro, setErro] = React.useState(false);
  const [abertos, setAbertos] = React.useState({});
  React.useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await apiCall('/api/auditoria-sistema');
        const data = await res.json();
        if (!vivo) return;
        if (res.ok) setA(data); else setErro(true);
      } catch { if (vivo) setErro(true); }
      if (vivo) setLoading(false);
    })();
    return () => { vivo = false; };
  }, []);

  const COR = { verde: '#10b981', amarelo: '#f59e0b', vermelho: '#dc2626' };
  const SEV = { critica: '#dc2626', alta: '#ea580c', media: '#f59e0b', baixa: '#64748b' };
  const CAT = { seguranca: '🔒', api: '🔌', funcionalidade: '⚙️', dados: '🗄️' };
  const TIPO = { auto: { t: 'vira PR', c: '#10b981' }, manual: { t: 'ação sua', c: '#f59e0b' }, externo: { t: 'externo', c: '#0D63DB' } };

  if (erro || loading) return null;
  if (!a || a.vazio) {
    return (
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 6 }}>🔍 Auditoria do Sistema (Claude)</div>
        <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6 }}>Auditoria ainda não executada. Roda automaticamente toda segunda-feira, ou dispare a Action <b>“Auditoria do Sistema (Claude)”</b> no GitHub. Ela audita funcionalidades, fluxos de API e segurança dos dados — e as correções viram PR para sua revisão.</div>
      </div>
    );
  }
  const cor = COR[a.saude] || '#64748b';
  const achados = Array.isArray(a.achados) ? a.achados : [];
  // Staleness: a auditoria é um retrato do dia em que rodou. Correções aplicadas
  // DEPOIS não se refletem até rodar de novo — então mostramos a idade e avisamos
  // quando ela pode estar desatualizada (evita alarme falso de achados já corrigidos).
  const diasAtras = a.gerado_em ? Math.floor((Date.now() - new Date(a.gerado_em).getTime()) / 86400000) : null;
  const desatualizada = diasAtras != null && diasAtras >= 2;

  return (
    <div style={{ ...S.card, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', display: 'flex', alignItems: 'center', gap: 8 }}>
          🔍 Auditoria do Sistema (Claude)
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: cor, display: 'inline-block' }} />
        </div>
        <div style={{ fontSize: 11, color: '#94a3b8' }}>
          {a.gerado_em && new Date(a.gerado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
          {diasAtras != null && diasAtras > 0 ? ` · há ${diasAtras}d` : ''}
          {a.commit_sha ? ` · ${String(a.commit_sha).slice(0, 7)}` : ''}{a.modelo ? ` · ${a.modelo}` : ''}
        </div>
      </div>
      {desatualizada && (
        <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '9px 13px', marginBottom: 10, lineHeight: 1.5 }}>
          ⚠ Este relatório é de <b>{diasAtras} dias atrás</b> e pode não refletir correções já aplicadas desde então — vários achados podem já estar resolvidos no código atual. Rode a Action <b>“Auditoria do Sistema (Claude)”</b> no GitHub para atualizar o retrato antes de agir sobre os itens abaixo.
        </div>
      )}
      {a.resumo && <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.6, marginBottom: 10, padding: '10px 14px', background: '#f8fafc', borderRadius: 10, borderLeft: `3px solid ${cor}` }}>{a.resumo}</div>}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, marginBottom: 12 }}>
        <span style={{ color: SEV.critica, fontWeight: 700 }}>{a.n_criticos || 0} críticos</span>
        <span style={{ color: SEV.alta, fontWeight: 700 }}>{a.n_altos || 0} altos</span>
        <span style={{ color: '#64748b' }}>{a.n_total || achados.length} achados no total</span>
        {a.pr_url && <a href={a.pr_url} target="_blank" rel="noopener noreferrer" style={{ color: '#0D63DB', fontWeight: 700 }}>Ver PR →</a>}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {achados.slice(0, 25).map((f, i) => {
          const sc = SEV[f.severidade] || '#64748b';
          const tp = TIPO[f.tipo] || null;
          const aberto = !!abertos[i];
          return (
            <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
              <div onClick={() => setAbertos((o) => ({ ...o, [i]: !o[i] }))} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', cursor: 'pointer' }}>
                <span style={{ fontSize: 13 }}>{CAT[f.categoria] || '•'}</span>
                <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: sc + '18', color: sc, textTransform: 'uppercase' }}>{f.severidade}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#111111' }}>{f.area}</span>
                {tp && <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: tp.c + '18', color: tp.c }}>{tp.t}</span>}
                {f.arquivo && <span style={{ fontSize: 11, color: '#94a3b8', marginLeft: 'auto' }}>{f.arquivo}{f.linha ? `:${f.linha}` : ''}</span>}
              </div>
              {aberto && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #f1f5f9' }}>
                  {f.descricao && <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.5, marginBottom: 6 }}>{f.descricao}</div>}
                  {f.correcao && <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.5 }}><b>Correção: </b>{f.correcao}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: '#cbd5e1', marginTop: 10 }}>Auditoria por IA (Claude) · semanal ou sob demanda. Correções “vira PR” são aplicadas via Pull Request para sua revisão — nada entra em produção sozinho.</div>
    </div>
  );
}

// Painel de COBERTURA de relatórios & inteligência — quantos imóveis/cidades/estados já tiveram
// relatório, quantas amostras de mercado serviram de base, buscas e cobertura do Índice BidPro.
// Dado real via RPC admin_metricas_negocio (admin-gated). É o "o que ocorre no sistema".
function PainelCoberturaRelatorios() {
  const [m, setM] = React.useState(null);
  const [erro, setErro] = React.useState(false);
  React.useEffect(() => {
    let vivo = true;
    supabase.rpc('admin_metricas_negocio').then(({ data, error }) => {
      if (!vivo) return;
      if (error || !data) setErro(true); else setM(data);
    });
    return () => { vivo = false; };
  }, []);
  if (erro) return null;
  const fmtN = (v) => Number(v || 0).toLocaleString('pt-BR');
  if (!m) return <div style={{ ...S.card, color: '#94a3b8', fontSize: 13 }}>Carregando cobertura de relatórios…</div>;
  const cob = m.cobertura || {}, rel = m.relatorios || {}, bus = m.buscas || {}, idx = m.indice || {}, mat = m.indice_maturidade || {};
  const totalRel = (rel.mercado || 0) + (rel.documental || 0) + (rel.laudo || 0);
  const zeroPct = bus.total ? Math.round((bus.zero_resultado / bus.total) * 100) : 0;
  const cards = [
    ['Imóveis analisados', fmtN(cob.imoveis), 'com relatório gerado', '#0D63DB'],
    ['Cidades · Estados', `${fmtN(cob.cidades)} · ${fmtN(cob.estados)}`, 'cobertura geográfica', '#0891b2'],
    ['Relatórios gerados', fmtN(totalRel), `${fmtN(rel.mercado)} merc · ${fmtN(rel.documental)} doc · ${fmtN(rel.laudo)} laudo`, '#10b981'],
    ['Amostras de mercado', fmtN(m.amostras), 'anúncios usados como base', '#7c3aed'],
    ['Buscas realizadas', fmtN(bus.total), `${zeroPct}% sem resultado · ${fmtN(bus.ult_7d)} em 7d`, zeroPct > 40 ? '#f59e0b' : '#64748b'],
    ['Índice BidPro', `${fmtN(idx.cidades)} cidades`, `${fmtN(idx.com_aluguel)} microrreg. c/ locação`, '#4f46e5'],
    ['Cidades maduras (Índice)', fmtN(mat.maduras), `${fmtN(mat.em_progresso)} em progresso · libera desconto×índice`, (mat.maduras || 0) > 0 ? '#059669' : '#94a3b8'],
  ];
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111' }}>📊 Cobertura de relatórios & inteligência</div>
        {rel.mercado_erro > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#dc2626', background: '#fef2f2', padding: '3px 10px', borderRadius: 20 }}>{fmtN(rel.mercado_erro)} em erro</span>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        {cards.map(([label, val, sub, cor]) => (
          <div key={label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: cor, lineHeight: 1 }}>{val}</div>
            <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 5 }}>{sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Cobertura DOCUMENTAL por leiloeiro (RPC admin_docs_por_leiloeiro): imóveis, fotos,
// matrículas, editais, regras, anexos + sinalizadores de CONFUSÃO de documento (edital=
// matrícula, edital=página do lote, matrícula=página). Nasceu do caso "botão Edital abria
// a Matrícula" — aqui o admin vê, por leiloeiro, onde os documentos podem estar trocados.
function PainelDocsLeiloeiro() {
  const [d, setD] = React.useState(null);
  const [erro, setErro] = React.useState(false);
  React.useEffect(() => {
    let vivo = true;
    supabase.rpc('admin_docs_por_leiloeiro').then(({ data, error }) => {
      if (!vivo) return;
      if (error || !data) setErro(true); else setD(data);
    });
    return () => { vivo = false; };
  }, []);
  if (erro) return null;
  const fmtN = (v) => Number(v || 0).toLocaleString('pt-BR');
  if (!d) return <div style={{ ...S.card, color: '#94a3b8', fontSize: 13 }}>Carregando cobertura documental…</div>;
  const fontes = Array.isArray(d.fontes) ? d.fontes : [];
  const totalConfusao = fontes.reduce((s, f) => s + (f.edital_eq_matricula || 0) + (f.matricula_eq_lote || 0), 0);
  // % de cobertura para colorir a célula (verde alto, âmbar médio, vermelho baixo).
  const pctCor = (n, tot) => { const p = tot ? n / tot : 0; return p >= 0.8 ? '#059669' : p >= 0.4 ? '#d97706' : '#dc2626'; };
  const cel = { padding: '7px 10px', fontSize: 12, textAlign: 'right', whiteSpace: 'nowrap', borderBottom: '1px solid #f1f5f9' };
  const th = { ...cel, color: '#64748b', fontWeight: 700, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.3, borderBottom: '2px solid #e2e8f0' };
  const alerta = (n) => (n > 0 ? { color: '#b91c1c', fontWeight: 800, background: '#fef2f2' } : { color: '#cbd5e1' });
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111' }}>🗂️ Cobertura documental por leiloeiro</div>
        {totalConfusao > 0
          ? <span style={{ fontSize: 11, fontWeight: 700, color: '#b91c1c', background: '#fef2f2', padding: '3px 10px', borderRadius: 20 }}>⚠ {fmtN(totalConfusao)} possíveis confusões edital↔matrícula</span>
          : <span style={{ fontSize: 11, fontWeight: 700, color: '#059669', background: '#f0fdf4', padding: '3px 10px', borderRadius: 20 }}>✓ sem edital↔matrícula/lote</span>}
      </div>
      <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 12 }}>
        {fmtN(d.total_imoveis)} imóveis ativos. <b>Ed=Matríc.</b> e <b>Matríc=Lote</b> são confusões (documento trocado); <b>Ed=Lote</b> é normal (o edital-PDF real vem dos anexos) e <b>Matríc. página</b> = matrícula que aponta para página, não arquivo.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left' }}>Leiloeiro</th>
              <th style={th}>Imóveis</th>
              <th style={th}>Fotos</th>
              <th style={th}>Matrículas</th>
              <th style={th}>Editais</th>
              <th style={th}>Regras</th>
              <th style={th}>Anexos</th>
              <th style={th}>Ed=Matríc.</th>
              <th style={th}>Matríc=Lote</th>
              <th style={th}>Matríc. página</th>
              <th style={th}>Ed=Lote</th>
            </tr>
          </thead>
          <tbody>
            {fontes.map((f) => (
              <tr key={f.fonte}>
                <td style={{ ...cel, textAlign: 'left', fontWeight: 700, color: '#111' }}>{f.fonte}</td>
                <td style={{ ...cel, fontWeight: 700, color: '#111' }}>{fmtN(f.imoveis)}</td>
                <td style={{ ...cel, color: pctCor(f.com_foto, f.imoveis) }}>{fmtN(f.com_foto)}</td>
                <td style={{ ...cel, color: pctCor(f.com_matricula, f.imoveis) }}>{fmtN(f.com_matricula)}</td>
                <td style={{ ...cel, color: pctCor(f.com_edital, f.imoveis) }}>{fmtN(f.com_edital)}</td>
                <td style={cel}>{fmtN(f.com_regras)}</td>
                <td style={{ ...cel, color: pctCor(f.com_anexos, f.imoveis) }}>{fmtN(f.com_anexos)}</td>
                <td style={{ ...cel, ...alerta(f.edital_eq_matricula) }}>{fmtN(f.edital_eq_matricula)}</td>
                <td style={{ ...cel, ...alerta(f.matricula_eq_lote) }}>{fmtN(f.matricula_eq_lote)}</td>
                <td style={{ ...cel, color: (f.matricula_nao_arquivo > 0 ? '#d97706' : '#cbd5e1'), fontWeight: f.matricula_nao_arquivo > 0 ? 700 : 400 }}>{fmtN(f.matricula_nao_arquivo)}</td>
                <td style={{ ...cel, color: '#94a3b8' }}>{fmtN(f.edital_eq_lote)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DashboardTab() {
  const planosCtx = usePlanos();
  const pNome = (key) => planosCtx?.[key]?.nome || key;
  const [dados, setDados] = useState(null);
  const [asaasDados, setAsaasDados] = useState(null);
  const [mpSaldo, setMpSaldo] = useState(null); // saldo Mercado Pago (gateway principal)
  const [loading, setLoading] = useState(true);
  const [asaasLoading, setAsaasLoading] = useState(true);
  const [fotoStats, setFotoStats] = useState({ total: 0, noStorage: 0 });
  const [usuariosDetalhe, setUsuariosDetalhe] = useState(false);
  const [healthLogs, setHealthLogs] = useState([]);
  const [healthOpen, setHealthOpen] = useState(false);
  const [consultivoAberto, setConsultivoAberto] = useState(false); // seções consultivas (colapsadas)
  const [equipeDetalhe, setEquipeDetalhe] = useState(null); // key clicked
  const [equipeMembros, setEquipeMembros] = useState([]);
  const [equipeMetrics, setEquipeMetrics] = useState({});
  const [periodo, setPeriodo] = useState('mes');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [hcItemAberto, setHcItemAberto] = React.useState(null);
  const [acaoStatus, setAcaoStatus] = React.useState({});

  function getRange(p, ini, fim) {
    const now = new Date();
    if (p === 'hoje') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      return { inicio: start, fim: now.toISOString() };
    }
    if (p === '7d') {
      return { inicio: new Date(now - 7 * 24 * 3600 * 1000).toISOString(), fim: now.toISOString() };
    }
    if (p === 'custom' && ini && fim) {
      return { inicio: new Date(ini).toISOString(), fim: new Date(fim + 'T23:59:59').toISOString() };
    }
    // mes (default)
    return { inicio: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), fim: now.toISOString() };
  }

  async function loadHealth() {
    const { data } = await supabase.from('health_check_logs').select('*').order('executado_em', { ascending: false }).limit(30);
    setHealthLogs(data || []);
  }

  async function loadEquipeDetalhe(roleKey, p, ini, fim) {
    setEquipeDetalhe(roleKey);
    const { data: membros } = await supabase.from('perfis').select('id, nome, email, created_at').eq('role', roleKey);
    setEquipeMembros(membros || []);
    if (!membros?.length) { setEquipeMetrics({}); return; }
    const ids = membros.map(m => m.id);
    const range = getRange(p || periodo, ini ?? dataInicio, fim ?? dataFim);
    const [{ data: chamados }, { data: comissoes }, { data: leadsSDR }, { data: reunioes }] = await Promise.all([
      supabase.from('chamados').select('atendente_id, status').in('atendente_id', ids).gte('criado_em', range.inicio).lte('criado_em', range.fim),
      supabase.from('comissoes').select('beneficiario_id, valor_comissao, status').in('beneficiario_id', ids).gte('criado_em', range.inicio).lte('criado_em', range.fim),
      supabase.from('sdr_leads').select('consultor_id, status').in('consultor_id', ids).gte('criado_em', range.inicio).lte('criado_em', range.fim),
      supabase.from('solicitacoes').select('analista_id, status').in('analista_id', ids).gte('criado_em', range.inicio).lte('criado_em', range.fim),
    ]);
    const m = {};
    ids.forEach(id => {
      m[id] = {
        chamados: (chamados || []).filter(c => c.atendente_id === id).length,
        chamadosFin: (chamados || []).filter(c => c.atendente_id === id && c.status === 'finalizado').length,
        comissao: (comissoes || []).filter(c => c.beneficiario_id === id && c.status !== 'cancelado').reduce((s, c) => s + Number(c.valor_comissao), 0),
        leadsSDR: (leadsSDR || []).filter(l => l.consultor_id === id).length,
        leadsConv: (leadsSDR || []).filter(l => l.consultor_id === id && l.status === 'convertido').length,
        analises: (reunioes || []).filter(r => r.analista_id === id).length,
        analisesOk: (reunioes || []).filter(r => r.analista_id === id && r.status === 'concluido').length,
      };
    });
    setEquipeMetrics(m);
  }

  async function rodarHealthCheck() {
    await apiCall('/api/health-check', { method: 'POST' });
    loadHealth();
  }

  useEffect(() => {
    if (periodo === 'custom' && (!dataInicio || !dataFim)) return;
    const range = getRange(periodo, dataInicio, dataFim);
    async function load() {
      // Contagens/MRR/acervo AGREGADOS no SERVIDOR (RPC admin_dashboard_contadores): 1 chamada,
      // sem puxar a tabela `perfis` inteira pro cliente (escala p/ 10k+ usuários). E o
      // `imoveis_ativos` sai da MESMA fonte do /api/scraper-status (acervo_stats) → o KPI
      // "imóveis ativos" não diverge mais entre o Dashboard e a Operação de Coleta.
      const { data: m } = await supabase.rpc('admin_dashboard_contadores', { p_inicio: range.inicio, p_fim: range.fim });

      // Contagem já normalizada no servidor (anuais somados ao plano-base; resto em "outros").
      const contagem = { admin: 0, explorador: 0, top2: 0, assessorado: 0, clube: 0, consultor: 0, analista: 0, advogado: 0, outros: 0, ...(m?.contagem || {}) };

      // MRR pelo preço REAL do planos_config (mrrMensalPlano — a MESMA conta do detalhe por
      // plano), agora sobre as CONTAGENS agregadas no servidor. Normaliza p/ mensal-equivalente.
      const mrr = (contagem.top2 * mrrMensalPlano(planosCtx?.top2, 49.90))
        + (contagem.assessorado * mrrMensalPlano(planosCtx?.assessorado, 500))
        + (contagem.clube * mrrMensalPlano(planosCtx?.clube, 5000));
      const taxaPix = mrr * 0.01;

      setDados({
        contagem,
        total: m?.total || 0, // total REAL de perfis (inclui anuais/leiloeiro/pacote/outros)
        mrr,
        taxaPix,
        liquido: mrr - taxaPix,
        inadimplentes: m?.inadimplentes || 0,
        reembolsosPendentes: m?.reembolsos_pendentes || 0,
        novosMes: m?.novos || 0,
        dbSizeMB: m?.db_size_mb ?? null,
      });
      // Acervo (imóveis ativos + fotos no Storage) vem na MESMA RPC — sem os 2 counts client-side.
      setFotoStats({ total: m?.imoveis_ativos || 0, noStorage: m?.fotos_storage || 0 });
      setLoading(false);
    }

    async function loadAsaas() {
      try {
        const res = await apiCall('/api/asaas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'financas' }) });
        const data = await res.json();
        if (res.ok) setAsaasDados(data);
        else setAsaasDados({ error: data?.error || 'Erro desconhecido' });
      } catch (_) {
        setAsaasDados({ error: 'Falha de conexão com Asaas' });
      }
      setAsaasLoading(false);
    }

    async function loadMp() {
      try {
        const res = await apiCall('/api/mp-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'saldo' }) });
        const data = await res.json();
        setMpSaldo(res.ok ? data : { error: data?.error || 'indisponível' });
      } catch { setMpSaldo({ error: 'Falha de conexão com Mercado Pago' }); }
    }

    load();
    loadAsaas();
    loadMp();
    loadHealth();
    if (equipeDetalhe) loadEquipeDetalhe(equipeDetalhe, periodo, dataInicio, dataFim);
  }, [periodo, dataInicio, dataFim]);

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

  const statCard = (label, value, sub, cor = '#0D63DB') => (
    <div style={{ background: '#111111', borderRadius: 12, padding: '20px 22px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 900, color: cor, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{sub}</div>}
    </div>
  );

  const hcLast = healthLogs[0];
  const hcCor = { ok: '#059669', aviso: '#d97706', erro: '#dc2626' };
  const hcBg  = { ok: '#f0fdf4', aviso: '#fffbeb', erro: '#fef2f2' };
  const hcBorder = { ok: '#bbf7d0', aviso: '#fde68a', erro: '#fecaca' };
  const hcIcon = { ok: '✅', aviso: '⚠️', erro: '🔴' };

  const diagnosticos = {
    'Supabase — conexão': { causa: 'Banco de dados inacessível ou credenciais inválidas.', acoes: ['Verificar SUPABASE_SERVICE_KEY no Vercel', 'Checar status em status.supabase.com', 'Verificar se o projeto Supabase está ativo'] },
    'Supabase — chamados presos': { causa: 'Existem chamados de suporte abertos há mais de 7 dias sem resolução.', acoes: ['Acessar aba Suporte no Admin', 'Filtrar chamados por status "aberto" mais antigos', 'Atribuir ou finalizar manualmente'] },
    'Comercial — clientes sem consultor': { causa: 'Clientes novos aguardam atribuição de consultor há mais de 3 dias.', acoes: ['Acessar aba Comercial no Admin', 'Filtrar por “Sem consultor”', 'Atribuir manualmente a um consultor disponível'] },
    'Daily.co — API': { causa: 'API de videochamadas não está respondendo.', acoes: ['Verificar DAILY_API_KEY no Vercel', 'Checar status em status.daily.co', 'Confirmar que a chave não expirou'] },
    'Claude — API': { causa: 'API da Anthropic não está respondendo.', acoes: ['Verificar CLAUDE_KEY no Vercel', 'Checar status em status.anthropic.com', 'Confirmar que há créditos na conta Anthropic'] },
    'API interna — /api/system-status': { causa: 'O próprio servidor da aplicação não está respondendo.', acoes: ['Verificar deployments no Vercel', 'Checar logs de erro no Vercel → Logs', 'Fazer redeploy se necessário'] },
  };

  async function executarAcao(acao, label) {
    setAcaoStatus(s => ({ ...s, [label]: 'executando' }));
    try {
      if (acao === 'liberar_chamados_presos') {
        // O certo NÃO é fechar em lote (esconde reclamação real): o admin deve VER e
        // RESPONDER. Abre a aba Suporte, onde vê todas as mensagens e responde.
        window.location.hash = '#/atendimento';
        setAcaoStatus(s => ({ ...s, [label]: 'abrindo Suporte…' }));
      } else if (acao === 'rodar_health') {
        await rodarHealthCheck();
        setAcaoStatus(s => ({ ...s, [label]: 'ok — executado' }));
      } else if (acao === 'ver_leads_sem_consultor') {
        window.location.hash = '/admin';
        setAcaoStatus(s => ({ ...s, [label]: 'ok — navegando para Comercial' }));
      }
    } catch(e) {
      setAcaoStatus(s => ({ ...s, [label]: `erro — ${e.message}` }));
    }
  }

  const temProblemas = hcLast && hcLast.status !== 'ok';

  return (
    <div>
      {/* ── Health Check Banner ── */}
      {hcLast && (
        <div onClick={() => setHealthOpen(o => !o)}
          style={{ cursor: 'pointer', background: hcBg[hcLast.status], border: `1px solid ${hcBorder[hcLast.status]}`, borderRadius: 10, padding: '10px 16px', marginBottom: temProblemas ? 0 : 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, borderBottomLeftRadius: temProblemas ? 0 : 10, borderBottomRightRadius: temProblemas ? 0 : 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 16 }}>{hcIcon[hcLast.status]}</span>
            <div>
              <span style={{ fontSize: 13, fontWeight: 700, color: hcCor[hcLast.status] }}>Automação de saúde — última execução: </span>
              <span style={{ fontSize: 13, color: '#374151' }}>{hcLast.resumo}</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{new Date(hcLast.executado_em).toLocaleString('pt-BR')}</span>
            <button onClick={e => { e.stopPropagation(); rodarHealthCheck(); }}
              style={{ fontSize: 11, padding: '3px 10px', background: '#111111', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>▶ Rodar agora</button>
            <span style={{ fontSize: 12, color: '#94a3b8' }}>{healthOpen ? '▲' : '▼'}</span>
          </div>
        </div>
      )}

      {/* ── Painel de Ações (só aparece quando há problemas) ── */}
      {temProblemas && (
        <div style={{ background: '#1e293b', border: `1px solid ${hcBorder[hcLast.status]}`, borderTop: 'none', borderBottomLeftRadius: 10, borderBottomRightRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>Ações disponíveis</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(hcLast.itens || []).filter(i => i.status !== 'ok').map((item, j) => {
              const diag = diagnosticos[item.nome] || { causa: item.detalhe, acoes: [] };
              const labelAcao = item.nome === 'Supabase — chamados presos' ? 'liberar_chamados_presos' : item.nome === 'Comercial — clientes sem consultor' ? 'ver_leads_sem_consultor' : null;
              return (
                <div key={j} style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', minWidth: 220, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ color: item.status === 'erro' ? '#f87171' : '#fbbf24', fontSize: 12 }}>{item.status === 'erro' ? '✗' : '⚠'}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{item.nome}</span>
                    <button onClick={() => setHcItemAberto(hcItemAberto === item.nome ? null : item.nome)}
                      style={{ marginLeft: 'auto', fontSize: 10, padding: '2px 8px', background: '#334155', color: '#94a3b8', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                      {hcItemAberto === item.nome ? 'fechar' : 'diagnóstico'}
                    </button>
                  </div>
                  {hcItemAberto === item.nome && (
                    <div style={{ background: '#1e293b', borderRadius: 6, padding: '8px 10px', marginBottom: 8 }}>
                      <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700, marginBottom: 4 }}>Causa provável:</div>
                      <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 8 }}>{diag.causa}</div>
                      <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, marginBottom: 4 }}>O que fazer:</div>
                      {diag.acoes.map((a, k) => <div key={k} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>• {a}</div>)}
                    </div>
                  )}
                  {labelAcao && (
                    <button onClick={() => executarAcao(labelAcao, item.nome)}
                      disabled={acaoStatus[item.nome] === 'executando'}
                      style={{ fontSize: 11, padding: '4px 12px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 700, width: '100%' }}>
                      {acaoStatus[item.nome] === 'executando' ? 'Executando…' : acaoStatus[item.nome] ? acaoStatus[item.nome] : item.nome === 'Supabase — chamados presos' ? '▶ Ver na aba Suporte' : '▶ Ver leads sem consultor'}
                    </button>
                  )}
                </div>
              );
            })}
            <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center' }}>
              <button onClick={() => executarAcao('rodar_health', 'recheck')}
                style={{ fontSize: 11, padding: '6px 14px', background: '#059669', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', fontWeight: 700 }}>
                {acaoStatus['recheck'] === 'executando' ? 'Verificando…' : '🔄 Re-verificar tudo'}
              </button>
            </div>
          </div>
        </div>
      )}

      {!hcLast && (
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, color: '#64748b' }}>🔧 Automação de saúde — nenhuma execução ainda</span>
          <button onClick={rodarHealthCheck} style={{ fontSize: 12, padding: '4px 12px', background: '#111111', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>▶ Rodar agora</button>
        </div>
      )}
      {/* Histórico de health check */}
      {healthOpen && (
        <div style={{ background: '#111111', borderRadius: 12, padding: '16px 20px', marginBottom: 16, maxHeight: 420, overflowY: 'auto' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#60a5fa', marginBottom: 12 }}>Histórico de execuções ({healthLogs.length})</div>
          {healthLogs.map((log, i) => (
            <div key={log.id} style={{ borderBottom: i < healthLogs.length - 1 ? '1px solid #1e293b' : 'none', paddingBottom: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12 }}>{hcIcon[log.status]}</span>
                <span style={{ fontSize: 12, color: hcCor[log.status], fontWeight: 700 }}>{new Date(log.executado_em).toLocaleString('pt-BR')}</span>
                <span style={{ fontSize: 11, color: '#64748b' }}>· {log.duracao_ms}ms</span>
              </div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 6 }}>{log.resumo}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {(log.itens || []).map((item, j) => {
                  const diagKey = `${log.id}-${j}`;
                  return (
                    <div key={j}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, cursor: item.status !== 'ok' ? 'pointer' : 'default' }}
                        onClick={() => item.status !== 'ok' && setHcItemAberto(hcItemAberto === diagKey ? null : diagKey)}>
                        <span style={{ color: item.status === 'ok' ? '#34d399' : item.status === 'aviso' ? '#fbbf24' : '#f87171' }}>
                          {item.status === 'ok' ? '✓' : item.status === 'aviso' ? '⚠' : '✗'}
                        </span>
                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>{item.nome}</span>
                        <span style={{ color: '#64748b' }}>— {item.detalhe}</span>
                        {item.corrigido && <span style={{ color: '#34d399', fontWeight: 700 }}>AUTO-CORRIGIDO</span>}
                        {item.status !== 'ok' && <span style={{ color: '#475569', fontSize: 10, textDecoration: 'underline' }}>{hcItemAberto === diagKey ? '▲ fechar' : '▼ diagnóstico'}</span>}
                        <span style={{ color: '#475569', marginLeft: 'auto' }}>{item.ms}ms</span>
                      </div>
                      {hcItemAberto === diagKey && (() => {
                        const diag = diagnosticos[item.nome] || { causa: item.detalhe, acoes: [] };
                        return (
                          <div style={{ background: '#1e293b', borderRadius: 6, padding: '8px 10px', margin: '4px 0 4px 20px' }}>
                            <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 700, marginBottom: 4 }}>Causa provável:</div>
                            <div style={{ fontSize: 11, color: '#cbd5e1', marginBottom: 6 }}>{diag.causa}</div>
                            {diag.acoes.length > 0 && <>
                              <div style={{ fontSize: 11, color: '#60a5fa', fontWeight: 700, marginBottom: 4 }}>O que fazer:</div>
                              {diag.acoes.map((a, k) => <div key={k} style={{ fontSize: 11, color: '#94a3b8', marginBottom: 2 }}>• {a}</div>)}
                            </>}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Filtro de período ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Período:</span>
        {[
          { key: 'hoje', label: 'Hoje' },
          { key: '7d',   label: 'Últimos 7 dias' },
          { key: 'mes',  label: 'Este mês' },
          { key: 'custom', label: 'Personalizado' },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setPeriodo(key)}
            style={{ fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 20, border: '2px solid', cursor: 'pointer',
              borderColor: periodo === key ? '#0D63DB' : '#e2e8f0',
              background: periodo === key ? '#eff6ff' : 'white',
              color: periodo === key ? '#0D63DB' : '#64748b' }}>
            {label}
          </button>
        ))}
        {periodo === 'custom' && (
          <>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              style={{ fontSize: 12, padding: '4px 10px', border: '2px solid #e2e8f0', borderRadius: 8, color: '#111111', outline: 'none' }} />
            <span style={{ fontSize: 12, color: '#94a3b8' }}>até</span>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              style={{ fontSize: 12, padding: '4px 10px', border: '2px solid #e2e8f0', borderRadius: 8, color: '#111111', outline: 'none' }} />
          </>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111111', margin: 0 }}>Dashboard</h2>
        <div style={{ fontSize: 12, color: '#94a3b8' }}>Atualizado agora · {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
      </div>

      {/* Stat cards */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        {statCard('Total usuários', fmtN(dados.total), `+${dados.novosMes} ${periodo === 'hoje' ? 'hoje' : periodo === '7d' ? 'nos últimos 7 dias' : periodo === 'custom' ? 'no período' : 'este mês'}`, '#60a5fa')}
        {statCard('MRR estimado', `R$ ${fmt(dados.mrr)}`, 'Estimado por plano (receita real: Financeiro)', '#10b981')}
        {statCard('Inadimplentes', fmtN(dados.inadimplentes || 0), dados.inadimplentes ? 'assinaturas com pagamento em falha' : 'nenhum em atraso', dados.inadimplentes ? '#f59e0b' : '#94a3b8')}
        {statCard('Reembolsos pendentes', fmtN(dados.reembolsosPendentes || 0), dados.reembolsosPendentes ? 'garantia 7 dias — ação em Prestação de contas' : 'nenhum pendente', dados.reembolsosPendentes ? '#dc2626' : '#94a3b8')}
      </div>

      {/* Cobertura de relatórios & inteligência (o que ocorre no sistema — dado real) */}
      <PainelCoberturaRelatorios />

      {/* Cobertura documental por leiloeiro + sinalizadores de confusão de documento */}
      <PainelDocsLeiloeiro />

      {/* Custos & Uso das integrações pagas (marcadores de teto/orçamento) */}
      <PainelCustosUso />

      {/* Diagnóstico por IA sobre os indicadores (assertividade + economia) */}
      <PainelDiagnosticoIA />

      {/* Auditoria técnica do sistema pelo Claude (só leitura; correções via PR) */}
      <PainelAuditoriaSistema />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>

        {/* Coluna esquerda: Usuários por plano */}
        <div>
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Usuários por plano
              {usuariosDetalhe && <button onClick={() => setUsuariosDetalhe(false)} style={{ fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>← Voltar</button>}
            </div>

            {!usuariosDetalhe ? (
              // Vista resumida — só quantidade, clicável
              [
                { key: 'explorador', label: 'Explorador (Grátis)',        cor: '#64748b' },
                { key: 'top2',       label: pNome('top2'),                cor: '#7c3aed' },
                { key: 'assessorado',label: pNome('assessorado'),         cor: '#d97706' },
                { key: 'clube',      label: pNome('clube'),               cor: '#059669' },
              ].map(({ key, label, cor }) => {
                const qtd = dados.contagem[key] || 0;
                return (
                  <div key={key} onClick={() => setUsuariosDetalhe(key)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: 8, marginBottom: 4, cursor: 'pointer', transition: 'background 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: cor }} />
                      <span style={{ fontSize: 13, color: '#374151' }}>{label}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: '#111111' }}>{qtd}</span>
                      <span style={{ fontSize: 12, color: '#94a3b8' }}>→</span>
                    </div>
                  </div>
                );
              })
            ) : (
              // Vista analítica — lista completa de usuários do plano selecionado
              <UsuariosPlanoDetalhe planoKey={usuariosDetalhe} />
            )}
          </div>

          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              Equipe interna
              {equipeDetalhe && <button onClick={() => setEquipeDetalhe(null)} style={{ fontSize: 11, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>← Voltar</button>}
            </div>
            {[
              { key: 'consultor', label: 'Consultores', cor: '#0891b2' },
              { key: 'analista',  label: 'Analistas',   cor: '#f59e0b' },
              { key: 'advogado',  label: 'Advogados',   cor: '#dc2626' },
              { key: 'admin',     label: 'Admins',      cor: '#7c3aed' },
            ].map(({ key, label, cor }) => (
              <div key={key}
                onClick={() => loadEquipeDetalhe(key, periodo, dataInicio, dataFim)}
                style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 10px', borderRadius: 8, marginBottom: 2, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: cor }} />
                  <span style={{ fontSize: 13, color: '#374151' }}>{label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{dados.contagem[key] || 0}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>→</span>
                </div>
              </div>
            ))}
            {/* Detalhe por membro */}
            {equipeDetalhe && equipeMembros.length > 0 && (
              <div style={{ marginTop: 12, borderTop: '2px solid #f1f5f9', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase' }}>Indicadores por membro</span>
                  <span style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>
                    {periodo === 'hoje' ? 'hoje' : periodo === '7d' ? 'últimos 7 dias' : periodo === 'custom' ? `${dataInicio} – ${dataFim}` : 'este mês'}
                  </span>
                </div>
                {equipeMembros.map(m => {
                  const met = equipeMetrics[m.id] || {};
                  const isConsultor = equipeDetalhe === 'consultor';
                  const isAnalista  = equipeDetalhe === 'analista';
                  return (
                    <div key={m.id} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 8 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#111111', marginBottom: 6 }}>{m.nome || m.email}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {isConsultor && <>
                          <span style={{ fontSize: 11, background: '#eff6ff', color: '#084BA6', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>👥 {met.leadsSDR || 0} leads</span>
                          <span style={{ fontSize: 11, background: '#f0fdf4', color: '#15803d', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>🎯 {met.leadsConv || 0} convertidos</span>
                          <span style={{ fontSize: 11, background: '#fef9c3', color: '#92400e', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>💰 R$ {Number(met.comissao || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          <span style={{ fontSize: 11, background: '#f1f5f9', color: '#475569', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>💬 {met.chamados || 0} atend.</span>
                        </>}
                        {isAnalista && <>
                          <span style={{ fontSize: 11, background: '#eff6ff', color: '#084BA6', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>📋 {met.analises || 0} análises</span>
                          <span style={{ fontSize: 11, background: '#f0fdf4', color: '#15803d', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>✅ {met.analisesOk || 0} concluídas</span>
                          <span style={{ fontSize: 11, background: '#f1f5f9', color: '#475569', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>💬 {met.chamadosFin || 0} tickets</span>
                        </>}
                        {!isConsultor && !isAnalista && <>
                          <span style={{ fontSize: 11, background: '#f1f5f9', color: '#475569', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>💬 {met.chamados || 0} atend.</span>
                          <span style={{ fontSize: 11, background: '#f0fdf4', color: '#15803d', borderRadius: 6, padding: '2px 8px', fontWeight: 700 }}>✅ {met.chamadosFin || 0} finalizados</span>
                        </>}
                        <span style={{ fontSize: 10, color: '#94a3b8', marginLeft: 'auto', alignSelf: 'center' }}>desde {new Date(m.created_at).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Coluna direita: Taxas Asaas + Marco + Infraestrutura */}
        <div>
          {/* Taxas Asaas reais */}
          <div style={S.card}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 12 }}>Financeiro — saldo consolidado</div>
            {/* Saldo unificado (Asaas + Mercado Pago) — clique para destrinchar */}
            {(() => {
              const asaasDisp = Number(asaasDados?.balance?.balance) || 0;
              const mpDisp = Number(mpSaldo?.available_balance) || 0;
              const mpIndispon = !!mpSaldo?.error;
              const total = asaasDisp + (mpIndispon ? 0 : mpDisp);
              return (
                <a href="/#/admin/financeiro" style={{ textDecoration: 'none' }}>
                  <div style={{ background: 'linear-gradient(135deg,#065f46,#059669)', borderRadius: 12, padding: '16px 18px', marginBottom: 12, color: 'white', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.9, textTransform: 'uppercase', letterSpacing: 0.5 }}>Saldo disponível (Asaas + Mercado Pago)</span>
                      <span style={{ fontSize: 11, opacity: 0.85 }}>destrinchar →</span>
                    </div>
                    <div style={{ fontSize: 26, fontWeight: 900, margin: '6px 0 4px' }}>R$ {fmt(total)}</div>
                    <div style={{ fontSize: 11, opacity: 0.9 }}>
                      Asaas R$ {fmt(asaasDisp)} · Mercado Pago {mpIndispon ? '(consultar no painel MP)' : `R$ ${fmt(mpDisp)}`}
                    </div>
                  </div>
                </a>
              );
            })()}
            {asaasLoading ? (
              <p style={{ color: '#94a3b8', fontSize: 13 }}>Carregando dados do Asaas…</p>
            ) : asaasDados?.error ? (
              <p style={{ fontSize: 13, color: '#f59e0b', background: '#fefce8', padding: '10px 14px', borderRadius: 8, margin: 0 }}>
                ⚠️ {asaasDados.error}
              </p>
            ) : asaasDados ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  {[
                    { label: 'Saldo disponível', value: `R$ ${fmt(asaasDados.balance?.balance || 0)}`, cor: '#10b981' },
                    { label: 'A receber', value: `R$ ${fmt(asaasDados.balance?.totalReceivable || 0)}`, cor: '#0D63DB' },
                    { label: 'Recebido no mês', value: `R$ ${fmt(asaasDados.statsMes?.revenue || 0)}`, cor: '#7c3aed' },
                    { label: 'Taxas cobradas', value: `R$ ${fmt(asaasDados.statsMes?.fees || 0)}`, cor: '#f59e0b' },
                  ].map(({ label, value, cor }) => (
                    <div key={label} style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{label}</div>
                      <div style={{ fontSize: 18, fontWeight: 800, color: cor }}>{value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>Dados direto da API Asaas · atualizado agora</div>
                  <a href="/#/admin/financeiro" style={{ fontSize: 12, fontWeight: 700, color: '#0D63DB', textDecoration: 'none' }}>Ver detalhes →</a>
                </div>
              </>
            ) : null}
          </div>

          {/* Marco comercial */}
          <div style={{ ...S.card, border: `2px solid ${marco.cor}20` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#111111' }}>Marco Comercial Asaas</div>
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
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 14 }}>Infraestrutura & Custos</div>

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
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#111111' }}>Supabase (Banco de Dados)</div>
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
                      <span style={{ fontWeight: 700, color: corDB }}>{pctFree.toFixed(2)}%</span>
                    </div>
                    <div style={{ background: '#f1f5f9', borderRadius: 6, height: 7, overflow: 'hidden' }}>
                      <div style={{ width: `${pctFree}%`, height: '100%', background: corDB, borderRadius: 6, transition: 'width 0.6s' }} />
                    </div>
                  </div>
                  {/* Barra de usuários */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748b', marginBottom: 3 }}>
                      <span>Usuários ativos: {fmtN(dados.total)} de 50.000</span>
                      <span style={{ fontWeight: 700, color: alertaUsuarios ? '#dc2626' : '#10b981' }}>{((dados.total / 50000) * 100).toFixed(2)}%</span>
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
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#111111' }}>Supabase — Banda de Saída (Egress)</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Limite gratuito: 5 GB/mês · Monitore no painel Supabase</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#64748b' }}>Ver painel</div>
              </div>
              <div style={{ marginTop: 6, padding: '7px 10px', background: '#eff6ff', borderRadius: 7, fontSize: 11, color: '#084BA6', lineHeight: 1.5 }}>
                💡 Mantenha no Supabase apenas textos e lógica. Imagens, PDFs e vídeos devem ir para a Bunny.net — isso reduz drasticamente o egress e adia o upgrade.
              </div>
            </div>

            {/* Bunny.net */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#111111' }}>Bunny.net (Vídeos & Arquivos)</div>
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
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#111111' }}>Vercel (Hosting + Edge Functions)</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Plano Free · 100 GB egress · Serverless ilimitado</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#10b981' }}>R$ 0/mês</div>
              </div>
            </div>

            {/* Anthropic */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#111111' }}>Anthropic — Laudos & KYC</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Pay-as-you-go · Haiku Vision por análise</div>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#10b981' }}>~R$ 0,08/doc</div>
              </div>
            </div>

            {/* Scrapers & Storage operacional */}
            {(() => {
              const fotosGB = (fotoStats.noStorage * 0.00015); // ~150 KB média por foto
              const storageCustoBRL = fotosGB * 0.021 * 6.0; // $0.021/GB × câmbio ~6.0
              const semFoto = fotoStats.total - fotoStats.noStorage;
              const pctFotos = fotoStats.total > 0 ? Math.round((fotoStats.noStorage / fotoStats.total) * 100) : 0;
              return (
                <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13, color: '#111111' }}>Scrapers & Storage Fotos</div>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Supabase Storage · ~150 KB/foto · $0,021/GB/mês</div>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: storageCustoBRL < 1 ? '#10b981' : '#d97706' }}>
                      {storageCustoBRL < 0.01 ? 'R$ 0' : `~R$ ${storageCustoBRL.toFixed(2)}`}/mês
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
                    {[
                      { label: 'Imóveis ativos', val: fmtN(fotoStats.total), cor: '#0D63DB' },
                      { label: 'Fotos no Storage', val: `${fmtN(fotoStats.noStorage)} (${pctFotos}%)`, cor: pctFotos > 80 ? '#10b981' : pctFotos > 30 ? '#d97706' : '#dc2626' },
                      { label: 'Sem foto', val: fmtN(semFoto), cor: semFoto > 1000 ? '#d97706' : '#64748b' },
                    ].map(c => (
                      <div key={c.label} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px', textAlign: 'center' }}>
                        <div style={{ fontSize: 14, fontWeight: 800, color: c.cor }}>{c.val}</div>
                        <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>{c.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {[
                      { nome: 'GitHub Actions (scrapers)', custo: 'Grátis', desc: 'Repo público — ilimitado', cor: '#10b981' },
                      { nome: 'Nominatim / OSM (geocod)', custo: 'Grátis', desc: '1 req/s · uso moderado', cor: '#10b981' },
                      { nome: 'Scraper Caixa', custo: 'Grátis', desc: 'API pública Caixa via GH Actions', cor: '#10b981' },
                      { nome: 'ScraperAPI (opcional)', custo: 'US$ 49/mês', desc: 'Leiloeiros privados — não ativado', cor: '#94a3b8' },
                    ].map(s => (
                      <div key={s.nome} style={{ background: '#f8fafc', borderRadius: 7, padding: '7px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div>
                          <div style={{ fontSize: 11, fontWeight: 600, color: '#111' }}>{s.nome}</div>
                          <div style={{ fontSize: 10, color: '#64748b' }}>{s.desc}</div>
                        </div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: s.cor, whiteSpace: 'nowrap' }}>{s.custo}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Asaas */}
            <div style={{ padding: '10px 0', borderBottom: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, color: '#111111' }}>Asaas Gateway (PIX)</div>
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
                <div style={{ marginTop: 14, padding: '12px 14px', background: '#111111', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Custo mensal estimado de infra</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: cor }}>R$ {fmt(totalMensal)}</div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Estratégia de plataforma & marcos — conteúdo consultivo (recolhido por padrão
          para não competir com as métricas de negócio/operação do dia a dia). */}
      <button onClick={() => setConsultivoAberto(o => !o)}
        style={{ marginTop: 24, width: '100%', textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 16px', fontSize: 13, fontWeight: 700, color: '#334155', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>🧭 Estratégia de plataforma & marcos de eficiência (consultivo)</span>
        <span style={{ color: '#94a3b8' }}>{consultivoAberto ? '▲ recolher' : '▼ expandir'}</span>
      </button>
      {consultivoAberto && (<>

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
            nome: 'Mercado Pago + Asaas', categoria: 'Gateway de Pagamento',
            veredicto: 'ATIVO (MP principal · Asaas backup)',
            cor: '#059669',
            icone: '💳',
            justificativa: 'Cobrança com Mercado Pago como gateway PRINCIPAL e Asaas como BACKUP (redundância: se um recusar/falhar, o outro assume). Cobre recorrência (planos) e avulso (cursos, assessoria). Pagar.me foi descartado.',
            gatilhoTroca: 'Ativar o split de marketplace do MP antes de escalar a rede de consultores',
            atingiuGatilho: dados.mrr >= 5000,
            alternativa: {
              nome: 'Split nativo do Mercado Pago (marketplace)',
              motivo: 'Para a rede de consultores vendendo planos/cursos/assessorias em escala, o split automático por venda (parte BidPro + parte do consultor, com repasse por recebedor) é feito pelo PRÓPRIO Mercado Pago, via marketplace/split por transação. É a evolução do gateway atual, sem trocar de provedor. Planeje a ativação do split antes de abrir vendas de consultores em volume.',
              custo: 'Taxas padrão do Mercado Pago · BRL',
              url: 'mercadopago.com.br',
            },
          },
          {
            nome: 'IA híbrida — Claude + Gemini', categoria: 'Laudos, Visão & Chat IA',
            veredicto: 'HÍBRIDO ATIVO',
            cor: '#10b981',
            icone: '🤖',
            justificativa: 'Arquitetura em camadas já em produção: o NÚCLEO (jurídico, documental, contratos e visão/KYC) fica no Claude pela qualidade em português; as funções não-críticas (chat de dúvidas, resumo de tickets e CNJ-chat) foram para o Gemini 2.5 Flash pelo custo, com fallback automático ao Claude se o Gemini falhar. O consumo dos dois é acompanhado no painel "Custos & Uso" acima.',
            gatilhoTroca: 'Piloto A/B da pesquisa mercadológica (Claude vs Gemini) em andamento — migrar essa função ao vencedor ao concluir',
            atingiuGatilho: false,
            alternativa: {
              nome: 'Gemini 2.5 Flash (já em uso)',
              motivo: 'Menor custo para prompts longos e alto volume; grounding com Google Search para pesquisa. Já atende chat/dúvidas/tickets em produção. O teto gratuito e o custo estão visíveis nos marcadores do painel Custos & Uso, evitando surpresa ao exceder a cota.',
              custo: 'grátis até a cota diária · depois pré-pago',
              url: 'ai.google.dev',
            },
          },
        ];
        return (
          <div style={{ marginTop: 24 }}>
            <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
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
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#111111' }}>{p.nome}</div>
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
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#111111' }}>{p.alternativa.nome}</div>
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#0D63DB', background: '#eff6ff', padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{p.alternativa.custo}</span>
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
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          🗺️ Marcos de Melhoria & Eficiência
          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}>— ações a executar quando os gatilhos forem atingidos</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            {
              gatilho: 'Antes de escalar rede de consultores',
              atingido: dados.mrr >= 5000,
              titulo: 'Ativar split de marketplace no Mercado Pago',
              desc: 'O modelo de consultores vendendo planos, cursos e assessorias exige split automático por venda (parte BidPro + parte do consultor). O próprio Mercado Pago (gateway principal) faz isso via marketplace/split por transação, com repasse por recebedor — sem trocar de provedor. Planeje a ativação do split antes de abrir vendas de consultores em volume.',
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
                  <span style={{ fontWeight: 800, fontSize: 14, color: '#111111' }}>{m.titulo}</span>
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
      </>)}
      {/* ── Quadro de Configurações & Pendências ─────────────────────────────── */}
      <SystemStatusCard />
    </div>
  );
}

function SystemStatusCard() {
  const [status, setStatus] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [gcalTest, setGcalTest] = React.useState(null);
  const [gcalTesting, setGcalTesting] = React.useState(false);
  const [cpfMig, setCpfMig] = React.useState(null);
  const [cpfMigrando, setCpfMigrando] = React.useState(false);
  React.useEffect(() => {
    apiCall('/api/system-status').then(r => r.json()).then(d => { setStatus(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  const testarGcal = async () => {
    setGcalTesting(true); setGcalTest(null);
    try {
      const r = await apiCall('/api/sistema-debug?modulo=gcal');
      const d = await r.json();
      setGcalTest(d.gcal || { ok: false, erro: 'Sem resposta' });
    } catch (e) {
      setGcalTest({ ok: false, erro: e.message });
    }
    setGcalTesting(false);
  };
  // Backfill da criptografia de CPF: cifra os CPFs antigos (que só têm texto
  // claro) em lotes. Roda quantas vezes precisar até 'restantes' zerar.
  const migrarCPF = async () => {
    setCpfMigrando(true);
    let migrados = 0, erros = 0, voltas = 0;
    try {
      while (voltas < 40) {
        voltas++;
        const r = await apiCall('/api/cpf-migrar', { method: 'POST' });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setCpfMig({ ok: false, erro: d.error || `Erro ${r.status}` }); setCpfMigrando(false); return; }
        migrados += d.migrados || 0; erros += d.erros || 0;
        if ((d.restantes_neste_lote || 0) <= 0) break;
      }
      setCpfMig({ ok: true, migrados, erros });
    } catch (e) {
      setCpfMig({ ok: false, erro: e.message });
    }
    setCpfMigrando(false);
  };
  // Grupos por FUNÇÃO DE NEGÓCIO + IMPACTO — dá para varrer o painel pelo que
  // importa (o que derruba o sistema, o que afeta receita, o que traz cliente).
  const GRUPOS = {
    nucleo:      { label: '🧩 Núcleo (crítico)',            cor: '#dc2626', items: ['svcKey', 'baseUrl', 'cron'] },
    receita:     { label: '💰 Receita & Pagamentos',       cor: '#059669', items: ['asaas', 'mp', 'mpHook'] },
    aquisicao:   { label: '📈 Aquisição (trazer clientes)', cor: '#7c3aed', items: ['rastreio', 'metaPixel', 'googleAds', 'meta'] },
    comunicacao: { label: '✉️ Comunicação',                 cor: '#0D63DB', items: ['email', 'from'] },
    ia:          { label: '🤖 Inteligência (IA)',           cor: '#0891b2', items: ['claude', 'gemini'] },
    operacao:    { label: '⚙️ Operação',                    cor: '#64748b', items: ['video', 'coleta', 'onr'] },
    agenda:      { label: '📅 Agenda Google',               cor: '#f59e0b', items: ['gcalClient', 'gcalConectada'] },
  };
  const DOMINIO_PENDENTE = [
    { label: 'Definir nome e domínio da plataforma', desc: 'Necessário para email remetente e URL pública.' },
    { label: 'Verificar domínio no Resend', desc: 'Adicionar registros DNS após definir o domínio.' },
    { label: 'APP_FROM_EMAIL no Vercel', desc: 'Ex: "BidPro Brasil <alertas@seudominio.com.br>"' },
    { label: 'APP_BASE_URL no Vercel', desc: 'Ex: "https://seudominio.com.br"' },
  ];
  // % configurado conta só o OBRIGATÓRIO (itens opcionais — ex.: API avançada de
  // anúncios, cartório — não penalizam a saúde do sistema).
  const envItems = status ? Object.values(status).filter(v => v && typeof v.ok === 'boolean' && v.label) : [];
  const obrigatorios = envItems.filter(v => !v.opcional);
  const totalOk = obrigatorios.filter(v => v.ok).length;
  const total = obrigatorios.length;
  const saude = total > 0 ? Math.round(totalOk / total * 100) : 0;
  const bd = status?.brightdata;
  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 24, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 16, color: '#111111' }}>Configurações & Saúde do Sistema</div>
          <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>Por função e impacto: núcleo, receita, aquisição, comunicação, IA e operação</div>
        </div>
        {!loading && <div style={{ textAlign: 'center' }}><div style={{ fontSize: 28, fontWeight: 900, color: saude >= 80 ? '#059669' : saude >= 50 ? '#f59e0b' : '#dc2626' }}>{saude}%</div><div style={{ fontSize: 11, color: '#94a3b8' }}>configurado</div></div>}
      </div>
      {!loading && bd && (() => {
        const pct = bd.teto > 0 ? Math.min(100, Math.round(bd.usados / bd.teto * 100)) : 0;
        const cor = pct >= 90 ? '#dc2626' : pct >= 70 ? '#f59e0b' : '#059669';
        return (
          <div style={{ marginBottom: 20, padding: '14px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8, gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: '#334155' }}>Bright Data — consumo da semana</span>
              <span style={{ fontSize: 13, fontWeight: 900, color: cor }}>{bd.usados} / {bd.teto} <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>({pct}%)</span></span>
            </div>
            <div style={{ height: 8, background: '#e2e8f0', borderRadius: 6, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: cor, borderRadius: 6, transition: 'width .3s' }} />
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 6 }}>Teto semanal de requisições ao desbloqueador (fontes que barram o servidor).{bd.semana ? ` Semana de ${bd.semana}.` : ''}</div>
          </div>
        );
      })()}
      {loading ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Verificando…</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12, marginBottom: 20 }}>
          {Object.entries(GRUPOS).map(([key, grupo]) => {
            const itens = grupo.items.map(k => status?.[k]).filter(Boolean);
            const obrig = itens.filter(i => !i.opcional);
            const okCount = obrig.filter(i => i.ok).length;
            const grupoOk = obrig.length === 0 || okCount === obrig.length;
            return (
            <div key={key} style={{ border: '1px solid #f1f5f9', borderLeft: `3px solid ${grupo.cor}`, borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: grupo.cor, textTransform: 'uppercase', letterSpacing: 0.4 }}>{grupo.label}</div>
                {obrig.length > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: grupoOk ? '#166534' : '#b45309', background: grupoOk ? '#dcfce7' : '#fef3c7', borderRadius: 6, padding: '1px 7px', flexShrink: 0 }}>{okCount}/{obrig.length}</span>}
              </div>
              {grupo.items.map(itemKey => { const item = status?.[itemKey]; if (!item) return null; return (
                <div key={itemKey} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ width: 20, height: 20, borderRadius: '50%', background: item.ok ? '#dcfce7' : item.opcional ? '#f1f5f9' : '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, flexShrink: 0, fontWeight: 700, color: item.ok ? '#166534' : item.opcional ? '#94a3b8' : '#dc2626' }}>{item.ok ? '✓' : item.opcional ? '–' : '✗'}</div>
                  <span style={{ fontSize: 13, color: item.ok ? '#111111' : '#94a3b8', flex: 1 }}>{item.label}</span>
                  {!item.ok && (item.opcional
                    ? <span style={{ fontSize: 10, background: '#f1f5f9', color: '#64748b', borderRadius: 6, padding: '1px 6px', fontWeight: 700 }}>Opcional</span>
                    : <span style={{ fontSize: 10, background: '#fee2e2', color: '#dc2626', borderRadius: 6, padding: '1px 6px', fontWeight: 700 }}>Pendente</span>)}
                </div>
              ); })}
            </div>
            );
          })}
        </div>
      )}
      {!loading && (
        <div style={{ display: 'flex', gap: 10, padding: '10px 12px', background: '#eff6ff', borderRadius: 10, border: '1px solid #bfdbfe', marginBottom: 16, fontSize: 12, color: '#1e40af' }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>🔐</span>
          <div style={{ lineHeight: 1.5 }}>
            <strong>Criptografia de CPF:</strong> cifra os CPFs já cadastrados (que ainda estão em texto claro). Rode uma vez, após ter salvo a variável <code>CPF_ENC_KEY</code> na Vercel e redeployado. Novos cadastros já entram cifrados automaticamente.
            <div style={{ marginTop: 8 }}>
              <button onClick={migrarCPF} disabled={cpfMigrando}
                style={{ padding: '5px 12px', borderRadius: 8, background: 'white', color: '#1e40af', border: '1px solid #bfdbfe', cursor: cpfMigrando ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 700 }}>
                {cpfMigrando ? '⏳ Migrando…' : '🔐 Migrar CPFs antigos'}
              </button>
              {cpfMig && (
                <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: cpfMig.ok ? '#059669' : '#dc2626' }}>
                  {cpfMig.ok
                    ? `✅ Concluído: ${cpfMig.migrados} cifrado(s)${cpfMig.erros ? `, ${cpfMig.erros} erro(s)` : ''}.`
                    : `❌ Falhou: ${cpfMig.erro || 'erro desconhecido'}`}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      {!loading && (
        <div style={{ display: 'flex', gap: 10, padding: '10px 12px', background: status?.gcalConectada?.ok ? '#ecfdf5' : '#f5f3ff', borderRadius: 10, border: `1px solid ${status?.gcalConectada?.ok ? '#a7f3d0' : '#ddd6fe'}`, marginBottom: 16, fontSize: 12, color: status?.gcalConectada?.ok ? '#065f46' : '#5b21b6' }}>
          <span style={{ fontSize: 14, flexShrink: 0 }}>📅</span>
          <div style={{ lineHeight: 1.5 }}>
            <strong>Agenda Google (OAuth):</strong> {status?.gcalConectada?.ok
              ? 'conectada — convites e lembretes nativos ativos no agendamento.'
              : 'ainda não conectada — defina GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REFRESH_TOKEN na Vercel.'}{' '}
            Hoje via conta @gmail (OAuth). <strong>Ao escalar, migrar para Google Workspace</strong> no domínio próprio dá convites nativos por service account, sem depender de refresh token pessoal.
            <div style={{ marginTop: 8 }}>
              <button onClick={testarGcal} disabled={gcalTesting}
                style={{ padding: '5px 12px', borderRadius: 8, background: 'white', color: '#5b21b6', border: '1px solid #ddd6fe', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>
                {gcalTesting ? '⏳ Testando…' : '🔌 Testar conexão'}
              </button>
              {gcalTest && (
                <span style={{ marginLeft: 10, fontSize: 12, fontWeight: 700, color: gcalTest.ok ? '#059669' : '#dc2626' }}>
                  {gcalTest.ok
                    ? '✅ Conectado — evento de teste criado e removido.'
                    : `❌ Falhou: ${gcalTest.erro || 'erro desconhecido'}`}
                </span>
              )}
            </div>
          </div>
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
    </div>
  );
}

// ─── Aba Scrapers ─────────────────────────────────────────────────────────────
const TODOS_ESTADOS_SCRAPER = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA',
  'MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN',
  'RO','RR','RS','SC','SE','SP','TO',
];

const REGIOES_ESTADOS = {
  'Norte':        ['AC','AM','AP','PA','RO','RR','TO'],
  'Nordeste':     ['AL','BA','CE','MA','PB','PE','PI','RN','SE'],
  'Centro-Oeste': ['DF','GO','MS','MT'],
  'Sudeste':      ['ES','MG','RJ','SP'],
  'Sul':          ['PR','RS','SC'],
};

// ── Barra de progresso reutilizável ──────────────────────────────────────
function BarraProgresso({ atual, total, label, sublabel, cor = '#0D63DB', visivel = true }) {
  if (!visivel) return null;
  const pct = total > 0 ? Math.round((atual / total) * 100) : 0;
  return (
    <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', marginBottom: 14, border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
        <span>{label}</span>
        <span style={{ color: cor }}>{pct}% · {atual}/{total}</span>
      </div>
      <div style={{ background: '#e2e8f0', borderRadius: 6, height: 8, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: cor, borderRadius: 6, transition: 'width 0.4s ease' }} />
      </div>
      {sublabel && <div style={{ fontSize: 11, color: '#64748b', marginTop: 5 }}>{sublabel}</div>}
    </div>
  );
}

function ParceirosLeiloeiroTab({ parceiros, setParceiros }) {
  const [loading, setLoading] = useState(false);
  const [modalNovo, setModalNovo] = useState(false);
  const [novoNome, setNovoNome] = useState('');
  const [novoEmail, setNovoEmail] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState('');
  const [contagens, setContagens] = useState({});

  const carregar = async () => {
    setLoading(true);
    const { data } = await supabase.from('leiloeiros_parceiros').select('*').order('criado_em', { ascending: false });
    setParceiros(data || []);
    // Contar imóveis por parceiro
    if (data?.length) {
      const res = await Promise.all(
        data.map(p =>
          supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).eq('fonte', `parceiro_${p.id}`)
        )
      );
      const mapa = {};
      data.forEach((p, i) => { mapa[p.id] = res[i].count || 0; });
      setContagens(mapa);
    }
    setLoading(false);
  };

  useEffect(() => { carregar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const criarParceiro = async () => {
    if (!novoNome.trim() || !novoEmail.trim()) return;
    setSalvando(true);
    await supabase.from('leiloeiros_parceiros').insert({ nome: novoNome.trim(), email: novoEmail.trim() });
    setSalvando(false);
    setModalNovo(false);
    setNovoNome('');
    setNovoEmail('');
    carregar();
  };

  const alterarStatus = async (id, status) => {
    await supabase.from('leiloeiros_parceiros').update({ status }).eq('id', id);
    carregar();
  };

  const copiarLink = (token, key) => {
    const url = `${window.location.origin}/#/leiloeiro/${token}`;
    navigator.clipboard.writeText(url);
    setCopiado(key);
    setTimeout(() => setCopiado(''), 1800);
  };

  const copiarToken = (token, key) => {
    navigator.clipboard.writeText(token);
    setCopiado(key + '_token');
    setTimeout(() => setCopiado(''), 1800);
  };

  const STATUS_COR = { ativo: '#10b981', pendente: '#f59e0b', inativo: '#94a3b8', suspenso: '#dc2626' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#111111' }}>Leiloeiros Parceiros</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Cada parceiro recebe um token único para enviar lotes via API</div>
        </div>
        <button onClick={() => setModalNovo(true)}
          style={{ padding: '8px 16px', background: '#ea580c', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
          + Novo Parceiro
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8' }}>Carregando…</div>
      ) : parceiros.length === 0 ? (
        <div style={{ background: 'white', borderRadius: 14, border: '1px dashed #e2e8f0', padding: 40, textAlign: 'center', color: '#94a3b8' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔨</div>
          <div style={{ fontWeight: 700, color: '#475569', marginBottom: 6 }}>Nenhum parceiro cadastrado</div>
          <div style={{ fontSize: 13 }}>Crie um parceiro e envie o link de cadastro para o leiloeiro.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {parceiros.map(p => (
            <div key={p.id} style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontWeight: 800, fontSize: 14, color: '#111111' }}>{p.nome}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: STATUS_COR[p.status] + '22', color: STATUS_COR[p.status] }}>
                      {p.status}
                    </span>
                    {contagens[p.id] > 0 && (
                      <span style={{ fontSize: 10, color: '#64748b' }}>{contagens[p.id].toLocaleString('pt-BR')} imóveis</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>{p.email} {p.cnpj && `· CNPJ ${p.cnpj}`} {p.municipio && `· ${p.municipio}/${p.uf}`}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>
                    Criado em {new Date(p.criado_em).toLocaleDateString('pt-BR')}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button onClick={() => copiarLink(p.token, p.id)}
                    style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, border: '1px solid #e2e8f0', borderRadius: 8, background: copiado === p.id ? '#f0fdf4' : '#f8fafc', color: copiado === p.id ? '#16a34a' : '#475569', cursor: 'pointer' }}>
                    {copiado === p.id ? '✓ Link copiado' : '🔗 Link cadastro'}
                  </button>
                  <button onClick={() => copiarToken(p.token, p.id)}
                    style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, border: '1px solid #e2e8f0', borderRadius: 8, background: copiado === p.id + '_token' ? '#f0fdf4' : '#f8fafc', color: copiado === p.id + '_token' ? '#16a34a' : '#475569', cursor: 'pointer' }}>
                    {copiado === p.id + '_token' ? '✓ Token copiado' : '🔑 Token API'}
                  </button>
                  {p.status === 'ativo' ? (
                    <button onClick={() => alterarStatus(p.id, 'suspenso')}
                      style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, border: '1px solid #fecaca', borderRadius: 8, background: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}>
                      Suspender
                    </button>
                  ) : (
                    <button onClick={() => alterarStatus(p.id, 'ativo')}
                      style={{ padding: '5px 10px', fontSize: 11, fontWeight: 700, border: '1px solid #bbf7d0', borderRadius: 8, background: '#f0fdf4', color: '#16a34a', cursor: 'pointer' }}>
                      Ativar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modalNovo && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={() => setModalNovo(false)}>
          <div style={{ background: 'white', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Novo Parceiro Leiloeiro</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>Um link de cadastro será gerado para o leiloeiro completar os dados.</div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Nome *</label>
              <input value={novoNome} onChange={e => setNovoNome(e.target.value)} placeholder="Nome da empresa ou pessoa"
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>E-mail *</label>
              <input type="email" value={novoEmail} onChange={e => setNovoEmail(e.target.value)} placeholder="contato@leiloeiro.com.br"
                style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setModalNovo(false)}
                style={{ flex: 1, padding: 10, background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: '#475569' }}>
                Cancelar
              </button>
              <button onClick={criarParceiro} disabled={salvando || !novoNome.trim() || !novoEmail.trim()}
                style={{ flex: 2, padding: 10, background: salvando ? '#94a3b8' : '#ea580c', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>
                {salvando ? 'Criando…' : 'Criar parceiro'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScrapersTab() {
  const [status, setStatus] = useState(null);
  const [geoStats, setGeoStats] = useState({ com: 0, sem: 0, total: 0 });
  const [scraperRegiao, setScraperRegiao] = useState({});
  const [geocRegiao, setGeocRegiao] = useState({});
  const [ultimoDebug, setUltimoDebug] = useState(null);
  const [puppeteerStatus, setPuppeteerStatus] = useState(null);
  const [abaAtiva, setAbaAtiva] = useState(() => { const a = sessionStorage.getItem('scraper_aba'); return (a === 'caixa' || a === 'leiloeiros') ? 'fontes' : (a || 'fontes'); });
  const mudarAba = (a) => { setAbaAtiva(a); sessionStorage.setItem('scraper_aba', a); };
  const [estadosExpandidos, setEstadosExpandidos] = useState({ caixa: false, geocod: false });
  const toggleExpandir = (aba) => setEstadosExpandidos(e => ({ ...e, [aba]: !e[aba] }));
  const [leiloeiroContagem, setLeiloeiroContagem] = useState({}); // fonte → total imóveis no banco
  const [fonteSaude, setFonteSaude] = useState({}); // fonte → última linha de fonte_saude (qualidade)
  const [fonteSaudePrev, setFonteSaudePrev] = useState({}); // fonte → PENÚLTIMA coleta (para tendência/regressão)
  const [geocTodos, setGeocTodos] = useState({ rodando: false, atual: 0, total: 0, ufAtual: '', processadosTotal: 0 });
  const [geocPendentes, setGeocPendentes] = useState({});
  const [geocUltimoRefresh, setGeocUltimoRefresh] = useState(null);
  const [parceiros, setParceiros] = useState([]);
  const [gerandoConviteLeiloeiro, setGerandoConviteLeiloeiro] = useState(false);
  const [linkLeiloeiro, setLinkLeiloeiro] = useState(null);
  // Progresso "executar todos" do Caixa (estado a estado)
  const [caixaTodos, setCaixaTodos] = useState({ rodando: false, atual: 0, total: 0, ufAtual: '' });
  const [leil, setLeil] = useState({ rodando: false, msg: '', erro: '' });
  const [reconLj, setReconLj] = useState({ rodando: false, msg: '', erro: '' });
  const [geocDebug, setGeocDebug] = useState(null);
  const [geocDebugRodando, setGeocDebugRodando] = useState(false);
  const [sysDebug, setSysDebug] = useState({});
  const [sysDebugRodando, setSysDebugRodando] = useState({});

  useEffect(() => {
    if (abaAtiva === 'geocod') {
      carregarPendentes();
    }
  }, [abaAtiva]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh pendentes a cada 2 min quando na aba geocod e não processando manualmente
  useEffect(() => {
    if (abaAtiva !== 'geocod') return;
    const interval = setInterval(() => {
      if (!geocTodos.rodando) carregarPendentes();
    }, 120_000);
    return () => clearInterval(interval);
  }, [abaAtiva, geocTodos.rodando]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // Contagem por fonte (ativos REAIS) agora vem do /api/scraper-status (por_fonte,
    // servidor) — antes eram ~14 counts no cliente que somavam INATIVOS e estouravam sob
    // RLS/throttle. Aqui carregamos só a SAÚDE/qualidade por fonte.
    // Saúde/qualidade: última execução por fonte (monitor de regressão)
    supabase.from('fonte_saude')
      .select('fonte,total,status,valor_pct,uf_pct,link_pct,foto_pct,estrategia,motivo,executado_em')
      .order('executado_em', { ascending: false }).limit(120)
      .then(({ data }) => {
        const ult = {}, prev = {};
        // Dados vêm do mais recente ao mais antigo: 1ª ocorrência = última coleta,
        // 2ª = coleta anterior (base da tendência do diagnóstico determinístico).
        (data || []).forEach(l => {
          if (!ult[l.fonte]) ult[l.fonte] = l;
          else if (!prev[l.fonte]) prev[l.fonte] = l;
        });
        setFonteSaude(ult); setFonteSaudePrev(prev);
      });
  }, []);

  useEffect(() => {
    // Números do SERVIDOR (acervo_stats + fonte_cobertura via /api/scraper-status): ativos,
    // geocode REAL e contagem/cobertura por fonte. Substitui os ~17 counts que a tela fazia
    // no cliente e estouravam sob RLS/throttle (mostrando 0% de geocode).
    apiCall('/api/scraper-status').then(r => r.json()).then(d => {
      setStatus(d);
      if (typeof d?.geocod === 'number') {
        setGeoStats({ com: d.geocod, sem: d.sem_geo || 0, total: (d.geocod || 0) + (d.sem_geo || 0) });
      }
      if (d?.por_fonte && typeof d.por_fonte === 'object') {
        const c = {};
        for (const [f, r] of Object.entries(d.por_fonte)) c[f] = r?.ativos || 0;
        if (d.por_fonte.CEF) c.caixa = d.por_fonte.CEF.ativos || 0; // chave legada da Caixa
        setLeiloeiroContagem(c);
      }
    }).catch(() => {});
  }, []);

  // Trigger manual via GitHub Actions — estado por estado com barra de progresso
  async function triggerScraper(regiao, estados) {
    if (regiao === 'todos' && estados.length > 1) {
      // Modo "todos": dispara estado a estado mostrando progresso
      const total = estados.length;
      setCaixaTodos({ rodando: true, atual: 0, total, ufAtual: estados[0] });
      for (let i = 0; i < estados.length; i++) {
        const uf = estados[i];
        setCaixaTodos(p => ({ ...p, atual: i + 1, ufAtual: uf }));
        setScraperRegiao(g => ({ ...g, [uf]: { rodando: true } }));
        try {
          const r = await apiCall('/api/trigger-scraper', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ estados: [uf] }),
          });
          const d = await r.json();
          if (!d.ok) throw new Error(d.error || 'Erro');
          setScraperRegiao(g => ({ ...g, [uf]: { rodando: false, agendado: true, msg: d.msg } }));
        } catch (e) {
          setScraperRegiao(g => ({ ...g, [uf]: { rodando: false, erro: e.message } }));
        }
        if (i < estados.length - 1) await new Promise(res => setTimeout(res, 800));
      }
      setCaixaTodos(p => ({ ...p, rodando: false }));
      setTimeout(() => apiCall('/api/scraper-status').then(r2 => r2.json()).then(setStatus).catch(() => {}), 5000);
    } else {
      // Modo estado único
      setScraperRegiao(g => ({ ...g, [regiao]: { rodando: true } }));
      try {
        const r = await apiCall('/api/trigger-scraper', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estados }),
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.error || 'Erro ao disparar workflow');
        setScraperRegiao(g => ({ ...g, [regiao]: { rodando: false, msg: d.msg, agendado: true } }));
        setTimeout(() => apiCall('/api/scraper-status').then(r2 => r2.json()).then(setStatus).catch(() => {}), 5000);
      } catch (e) {
        setScraperRegiao(g => ({ ...g, [regiao]: { rodando: false, erro: e.message } }));
      }
    }
  }

  // Trigger manual dos leiloeiros (Sold/Mega/Superbid) via Bright Data — endpoint Vercel,
  // autenticado pela sessão do admin (sem precisar de CRON_SECRET na URL).
  async function triggerLeiloeiros() {
    setLeil({ rodando: true, msg: '', erro: '' });
    try {
      const r = await apiCall('/api/scraper-leiloeiros?fontes=sold,mega,superbid', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const resumo = (d.fontes || []).map(f => `${f.fonte} ${f.coletados ?? 0}`).join(' · ');
      setLeil({ rodando: false, msg: `${d.total_upsert} salvos — ${resumo}`, erro: '' });
      setTimeout(() => apiCall('/api/scraper-status').then(r2 => r2.json()).then(setStatus).catch(() => {}), 3000);
    } catch (e) {
      setLeil({ rodando: false, msg: '', erro: e.message });
    }
  }

  // Recon de datas da LJUD: sonda os endpoints de detalhe e loga em debug_fetch.
  async function triggerReconLjud() {
    setReconLj({ rodando: true, msg: '', erro: '' });
    try {
      const r = await apiCall('/api/scraper-leiloeiros?fontes=ljud&ljud_recon=1', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      const probes = d.recon?.probes || [];
      const bons = probes.filter(p => !p.erro && (p.camposData || []).length);
      const resumo = bons.length
        ? `✔ Campos de data no get-lotes: ${[...new Set(bons.flatMap(p => (p.camposData || []).map(c => c.split('=')[0])))].join(', ')}`
        : `${probes.length} sondas — get-lotes sem data legível (ver debug_fetch=LJUD-RECON)`;
      setReconLj({ rodando: false, msg: resumo, erro: '' });
    } catch (e) {
      setReconLj({ rodando: false, msg: '', erro: e.message });
    }
  }

  // Trigger manual de geocodificação por estado (1 lote, retorna imediatamente)
  async function triggerGeoc(uf) {
    setGeocRegiao(g => ({ ...g, [uf]: { rodando: true, processados: 0, falhas: 0 } }));
    let totalProc = 0, totalFalhas = 0, loops = 0, timeoutsConsecutivos = 0;
    const MAX_LOOPS = 2000; // sem limite prático — para só quando não há mais pendentes
    const MAX_TIMEOUTS = 5; // aborta após 5 timeouts seguidos sem progresso
    try {
      while (loops < MAX_LOOPS) {
        const r = await apiCall('/api/geocodificar', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ estados: [uf] }),
        });
        let d;
        try { d = await r.json(); } catch {
          // Timeout da Vercel (30s) — os imóveis não foram gravados, ainda estão na fila
          timeoutsConsecutivos++;
          setGeocRegiao(g => ({ ...g, [uf]: { rodando: true, processados: totalProc, falhas: totalFalhas, aviso: `⚡ ${timeoutsConsecutivos} timeout(s) — retentando...` } }));
          if (timeoutsConsecutivos >= MAX_TIMEOUTS) {
            setGeocRegiao(g => ({ ...g, [uf]: { rodando: false, erro: `${MAX_TIMEOUTS} timeouts consecutivos`, processados: totalProc, falhas: totalFalhas } }));
            break;
          }
          await new Promise(res => setTimeout(res, 2000)); // pausa antes de retentar
          continue;
        }
        timeoutsConsecutivos = 0; // reset ao receber resposta válida
        if (!r.ok || d.error) {
          setGeocRegiao(g => ({ ...g, [uf]: { rodando: false, erro: d.error || `HTTP ${r.status}`, processados: totalProc, falhas: totalFalhas } }));
          return;
        }
        totalProc += d.processados || 0;
        totalFalhas += d.falhas || 0;
        loops++;
        setGeocRegiao(g => ({ ...g, [uf]: { rodando: true, processados: totalProc, falhas: totalFalhas } }));
        if (!d.processados || d.processados < 5) break; // sem mais pendentes
        await new Promise(res => setTimeout(res, 300)); // pausa entre chamadas
      }
      setGeocRegiao(g => ({ ...g, [uf]: { rodando: false, processados: totalProc, falhas: totalFalhas, concluido: totalProc === 0 } }));
    } catch (e) {
      setGeocRegiao(g => ({ ...g, [uf]: { rodando: false, erro: e.message, processados: totalProc } }));
    } finally {
      // Atualiza contadores globais e recarrega pendentes do estado
      Promise.all([
        supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).not('latitude', 'is', null).neq('latitude', 0),
        supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).is('latitude', null),
        supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).eq('latitude', 0),
        supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).eq('estado', uf).is('latitude', null),
        supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).eq('estado', uf).eq('latitude', 0),
      ]).then(([comGeo, semNull, semZero, ufNull, ufZero]) => {
        const com = comGeo.count || 0;
        const sem = (semNull.count || 0) + (semZero.count || 0);
        setGeoStats({ com, sem, total: com + sem });
        // Atualiza pendentes reais do estado processado
        const ufPendentes = (ufNull.count || 0) + (ufZero.count || 0);
        setGeocPendentes(p => ({ ...p, [uf]: ufPendentes }));
      });
    }
  }

  async function rodarGeocDebug() {
    setGeocDebugRodando(true);
    setGeocDebug(null);
    try {
      const r = await apiCall('/api/geocod-debug', { method: 'GET' });
      const d = await r.json();
      setGeocDebug({ status: r.status, body: d });
    } catch (e) {
      setGeocDebug({ status: 'erro', body: { erro: e.message } });
    }
    setGeocDebugRodando(false);
  }

  async function rodarSysDebug(modulo) {
    setSysDebugRodando(s => ({ ...s, [modulo]: true }));
    setSysDebug(s => ({ ...s, [modulo]: null }));
    try {
      const r = await apiCall(`/api/sistema-debug?modulo=${modulo}`, { method: 'GET' });
      const d = await r.json();
      setSysDebug(s => ({ ...s, [modulo]: { status: r.status, body: d } }));
    } catch (e) {
      setSysDebug(s => ({ ...s, [modulo]: { status: 'erro', body: { erro: e.message } } }));
    }
    setSysDebugRodando(s => ({ ...s, [modulo]: false }));
  }

  function BotaoDebug({ modulo, label }) {
    const rodando = sysDebugRodando[modulo];
    const resultado = sysDebug[modulo];
    return (
      <div style={{ marginTop: 10 }}>
        <button onClick={() => rodarSysDebug(modulo)} disabled={rodando}
          style={{ padding: '5px 12px', borderRadius: 8, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}>
          {rodando ? '⏳ Verificando...' : `🔍 ${label || 'Diagnóstico'}`}
        </button>
        {resultado && (
          <div style={{ marginTop: 8, background: resultado.status === 200 ? '#f0fdf4' : '#fef2f2', borderRadius: 8, padding: '10px 12px', border: `1px solid ${resultado.status === 200 ? '#bbf7d0' : '#fecaca'}` }}>
            <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4, color: resultado.status === 200 ? '#059669' : '#dc2626' }}>
              {resultado.status === 200 ? '✅ OK' : `❌ Erro (${resultado.status})`}
            </div>
            <textarea readOnly onClick={e => e.target.select()} style={{ fontSize: 10, color: '#334155', margin: 0, whiteSpace: 'pre', maxHeight: 220, overflow: 'auto', width: '100%', background: 'transparent', border: 'none', resize: 'none', outline: 'none', fontFamily: 'monospace', cursor: 'text' }} value={JSON.stringify(resultado.body, null, 2)} />
          </div>
        )}
      </div>
    );
  }

  const UFS_GEOCOD_ORDEM = ['SP','MG','PR','RS','RJ','SC','BA','GO','CE','PE','MT','MS','ES','PA','MA','RN','PB','AL','PI','SE','TO','RO','AM','DF','AC','AP','RR'];

  async function carregarPendentes() {
    const results = await Promise.all(
      UFS_GEOCOD_ORDEM.map(async uf => {
        const [r1, r2] = await Promise.all([
          supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).eq('estado', uf).is('latitude', null),
          supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).eq('estado', uf).eq('latitude', 0),
        ]);
        return [uf, (r1.count || 0) + (r2.count || 0)];
      })
    );
    setGeocPendentes(Object.fromEntries(results));
    setGeocUltimoRefresh(new Date());
  }

  async function geocodificarTodos() {
    const total = UFS_GEOCOD_ORDEM.length;
    setGeocTodos({ rodando: true, atual: 0, total, ufAtual: UFS_GEOCOD_ORDEM[0], processadosTotal: 0 });
    let processadosTotal = 0;
    for (let i = 0; i < UFS_GEOCOD_ORDEM.length; i++) {
      const uf = UFS_GEOCOD_ORDEM[i];
      setGeocTodos(g => ({ ...g, atual: i + 1, ufAtual: uf }));
      setGeocRegiao(g => ({ ...g, [uf]: { rodando: true, processados: 0, falhas: 0 } }));
      let ufProc = 0, ufFalhas = 0, ufLoops = 0, ufTimeouts = 0;
      const MAX_UF_TIMEOUTS = 5;
      try {
        while (true) { // para quando não há mais pendentes ou muitos timeouts
          const r = await apiCall('/api/geocodificar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estados: [uf] }) });
          let d;
          try { d = await r.json(); } catch {
            // Timeout — imóveis não foram gravados, ainda estão na fila; retentar
            ufTimeouts++;
            setGeocRegiao(g => ({ ...g, [uf]: { rodando: true, processados: ufProc, falhas: ufFalhas, aviso: `⚡ ${ufTimeouts} timeout(s)` } }));
            if (ufTimeouts >= MAX_UF_TIMEOUTS) {
              setGeocRegiao(g => ({ ...g, [uf]: { rodando: false, erro: `${MAX_UF_TIMEOUTS} timeouts`, processados: ufProc, falhas: ufFalhas } }));
              break;
            }
            await new Promise(res => setTimeout(res, 2000));
            continue;
          }
          ufTimeouts = 0;
          if (!r.ok || d.error) {
            setGeocRegiao(g => ({ ...g, [uf]: { rodando: false, erro: d?.error || `Erro ${r.status}`, processados: ufProc, falhas: ufFalhas } }));
            break;
          }
          ufProc += d.processados || 0;
          ufFalhas += d.falhas || 0;
          ufLoops++;
          processadosTotal += d.processados || 0;
          setGeocTodos(g => ({ ...g, processadosTotal }));
          setGeocRegiao(g => ({ ...g, [uf]: { rodando: true, processados: ufProc, falhas: ufFalhas } }));
          if (!d.processados || d.processados < 5) break;
          await new Promise(res => setTimeout(res, 300));
        }
      } catch (e) {
        setGeocRegiao(g => ({ ...g, [uf]: { rodando: false, erro: e.message } }));
        continue;
      }
      setGeocRegiao(g => ({ ...g, [uf]: { rodando: false, processados: ufProc, falhas: ufFalhas, concluido: ufProc === 0 } }));
      await new Promise(res => setTimeout(res, 500));
    }
    setGeocTodos(g => ({ ...g, rodando: false }));
    // Atualiza contador após processar
    Promise.all([
      supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).not('latitude', 'is', null).neq('latitude', 0),
      supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).is('latitude', null),
      supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true }).eq('latitude', 0),
    ]).then(([comGeo, semNull, semZero]) => {
      const com = comGeo.count || 0;
      const sem = (semNull.count || 0) + (semZero.count || 0);
      setGeoStats({ com, sem, total: com + sem });
    });
  }

  // Lista de estados com horários do cron (UTC)
  const AGENDA_SCRAPER = TODOS_ESTADOS_SCRAPER.map((uf, i) => {
    const h = 22, m = i * 2;
    return { uf, hora: `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}` };
  });
  const AGENDA_GEOCOD = TODOS_ESTADOS_SCRAPER.map((uf, i) => {
    const horaTotal = Math.floor(i / 6); // 0,1,2,3,4
    const minuto = (i % 6) * 10;
    return { uf, hora: `${String(horaTotal).padStart(2,'0')}:${String(minuto).padStart(2,'0')}` };
  });

  async function triggerPuppeteer() {
    setPuppeteerStatus({ rodando: true });
    try {
      const r = await apiCall('/api/trigger-puppeteer', { method: 'POST' });
      const d = await r.json();
      if (!d.ok) throw new Error(d.error || 'Erro ao disparar workflow');
      setPuppeteerStatus({ agendado: true, msg: d.msg });
    } catch (e) {
      setPuppeteerStatus({ erro: e.message });
    }
  }

  // Scrapers planejados (fila nacional — Zuk/Sodré/Frazão/LJUD já integrados)
  const scrapersPlanjados = [
    { nome: 'MGL Leilões (MG/SP/ES)', volume: '~800-1.5k', status: 'planejado' },
    { nome: 'CCJ Leilões (nacional)', volume: '~1-2k', status: 'planejado' },
    { nome: 'Biasi Leilões', volume: '~3-5k', status: 'planejado' },
    { nome: 'Destak Leilões', volume: '~500-1k', status: 'planejado' },
    { nome: 'Santander', volume: '~8-15k', status: 'planejado' },
    { nome: 'HastaPública', volume: '~2-4k', status: 'planejado' },
    { nome: 'TopLeilões', volume: '~1-2k', status: 'planejado' },
    { nome: 'eLeilões', volume: '~500-1k', status: 'planejado' },
  ];

  const geoPct = geoStats.total > 0 ? Math.round((geoStats.com / geoStats.total) * 100) : 0;

  // Geocodificação foi movida para o FIM e enxugada: está ~100% e roda on-demand (o KPI de
  // geocode fica no topo), então deixa de disputar espaço com Fontes/Parceiros.
  const ABAS = [
    { key: 'fontes',    label: '🏛️ Fontes',    desc: `Caixa + ${FONTES_LEILAO.length} leiloeiros` },
    { key: 'parceiros', label: '🤝 Parceiros',  desc: `${parceiros.length} leiloeiros` },
    { key: 'roadmap',   label: '🚀 Roadmap',    desc: `${scrapersPlanjados.length} fontes planejadas` },
    { key: 'geocod',    label: '📍 Geo',        desc: `${geoPct}% · on-demand` },
  ];

  return (
    <div style={{ maxWidth: 860 }}>
      {/* ── KPIs ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Imóveis ativos',     valor: (status?.ativos ?? status?.total)?.toLocaleString('pt-BR') || '—',                                     icon: '🏠', cor: '#0D63DB' },
          { label: 'Geocodificados',      valor: `${geoStats.com.toLocaleString('pt-BR')} (${geoPct}%)`,                                               icon: '📍', cor: geoPct > 80 ? '#059669' : geoPct > 50 ? '#d97706' : '#dc2626' },
          { label: 'Última atualização', valor: status?.ultima_atualizacao ? new Date(status.ultima_atualizacao).toLocaleString('pt-BR') : '—',       icon: '🕐', cor: '#475569' },
          { label: 'Sem coordenadas',    valor: geoStats.sem.toLocaleString('pt-BR'),                                                                  icon: '⚠️', cor: geoStats.sem > 0 ? '#d97706' : '#059669' },
        ].map(k => (
          <div key={k.label} style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '14px 16px' }}>
            <div style={{ fontSize: 18, marginBottom: 4 }}>{k.icon}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: k.cor, lineHeight: 1.2 }}>{k.valor}</div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* ── Barra de progresso geocodificação ── */}
      {geoStats.total > 0 && (
        <div style={{ background: 'white', borderRadius: 10, border: '1px solid #e2e8f0', padding: '12px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>Cobertura de coordenadas GPS</span>
            <span style={{ fontSize: 12, color: '#64748b' }}>{geoStats.com.toLocaleString('pt-BR')} de {geoStats.total.toLocaleString('pt-BR')} imóveis</span>
          </div>
          <div style={{ height: 8, background: '#f1f5f9', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${geoPct}%`, background: geoPct > 80 ? '#10b981' : geoPct > 50 ? '#f59e0b' : '#ef4444', borderRadius: 8, transition: 'width 0.5s' }} />
          </div>
          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>Imóveis com lat/lng permitem filtro por mapa e raio de busca para os clientes</div>
        </div>
      )}

      {/* ── Abas ── */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
        {ABAS.map(a => (
          <button key={a.key} onClick={() => mudarAba(a.key)}
            style={{ padding: '8px 14px', borderRadius: 20, border: `1px solid ${abaAtiva === a.key ? '#0D63DB' : '#e2e8f0'}`, background: abaAtiva === a.key ? '#0D63DB' : 'white', color: abaAtiva === a.key ? 'white' : '#475569', fontWeight: 700, fontSize: 12, cursor: 'pointer', transition: 'all 0.15s' }}>
            {a.label}
            <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 6, opacity: 0.8 }}>{a.desc}</span>
          </button>
        ))}
      </div>

      {ultimoDebug && (
        <div style={{ background: '#1e293b', borderRadius: 10, padding: 14, marginBottom: 16, color: '#e2e8f0', fontSize: 11, fontFamily: 'monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontWeight: 700, color: '#fbbf24' }}>DEBUG — {ultimoDebug.uf} — {ultimoDebug.csv_tamanho} bytes</span>
            <button onClick={() => setUltimoDebug(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
          {ultimoDebug.csv_primeiras_linhas?.map((l, i) => (
            <div key={i} style={{ padding: '2px 0', borderBottom: '1px solid #334155', color: i === 0 ? '#86efac' : '#94a3b8', wordBreak: 'break-all' }}>
              <span style={{ color: '#475569', marginRight: 8 }}>L{i+1}:</span>{l}
            </div>
          ))}
          {!ultimoDebug.csv_primeiras_linhas && <div style={{ color: '#fca5a5' }}>{ultimoDebug.erro}</div>}
        </div>
      )}

      {/* ═══ ABA FONTES ═══ */}
      {abaAtiva === 'fontes' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Grade unificada de todas as fontes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>

            {/* ── Caixa Econômica Federal ── */}
            {(() => {
              const total = status?.total ?? null;
              const temDados = total > 0;
              const erros = Object.values(scraperRegiao).filter(r => r.erro).length;
              const agendados = Object.values(scraperRegiao).filter(r => r.agendado).length;
              return (
                <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', padding: '14px 16px', gridColumn: '1 / -1' }}>
                  {/* Cabeçalho */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 22 }}>🏦</span>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 14, color: '#111' }}>Caixa Econômica Federal</div>
                        <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>● CSV · 27 arquivos (1 por estado) · cron 22:00–22:52 UTC · retry ×3</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: erros > 0 ? '#fef2f2' : temDados ? '#f0fdf4' : '#f1f5f9', color: erros > 0 ? '#dc2626' : temDados ? '#16a34a' : '#94a3b8' }}>
                        {erros > 0 ? `❌ ${erros} erros` : agendados > 0 ? `● ${agendados} agendados` : temDados ? '● Ativo' : '○ Sem dados'}
                      </span>
                      <button onClick={() => rodarSysDebug('scraper')} disabled={sysDebugRodando['scraper']}
                        style={{ padding: '4px 10px', borderRadius: 7, background: '#fff', color: '#475569', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>
                        {sysDebugRodando['scraper'] ? '⏳' : '🔍 Diagnóstico'}
                      </button>
                      <button onClick={() => triggerScraper('todos', TODOS_ESTADOS_SCRAPER)} disabled={caixaTodos.rodando}
                        style={{ padding: '5px 12px', borderRadius: 7, background: caixaTodos.rodando ? '#f1f5f9' : '#c2410c', color: caixaTodos.rodando ? '#94a3b8' : '#fff', fontWeight: 700, fontSize: 11, cursor: caixaTodos.rodando ? 'default' : 'pointer', border: 'none' }}>
                        {caixaTodos.rodando ? `⏳ ${caixaTodos.ufAtual} [${caixaTodos.atual}/${caixaTodos.total}]` : '▶ Executar todos'}
                      </button>
                      <button onClick={triggerLeiloeiros} disabled={leil.rodando}
                        title="Sold + Mega + Superbid via Bright Data"
                        style={{ padding: '5px 12px', borderRadius: 7, background: leil.rodando ? '#f1f5f9' : '#4f46e5', color: leil.rodando ? '#94a3b8' : '#fff', fontWeight: 700, fontSize: 11, cursor: leil.rodando ? 'default' : 'pointer', border: 'none' }}>
                        {leil.rodando ? '⏳ Leiloeiros (BD)…' : '▶ Leiloeiros (BD)'}
                      </button>
                      <button onClick={triggerReconLjud} disabled={reconLj.rodando}
                        title="Sonda os endpoints de detalhe da LJUD p/ descobrir as datas de praça (loga em debug_fetch)"
                        style={{ padding: '5px 12px', borderRadius: 7, background: reconLj.rodando ? '#f1f5f9' : '#0891b2', color: reconLj.rodando ? '#94a3b8' : '#fff', fontWeight: 700, fontSize: 11, cursor: reconLj.rodando ? 'default' : 'pointer', border: 'none' }}>
                        {reconLj.rodando ? '⏳ Recon LJUD…' : '🔎 Recon datas LJUD'}
                      </button>
                    </div>
                  </div>

                  {(leil.msg || leil.erro) && (
                    <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 600, color: leil.erro ? '#dc2626' : '#16a34a' }}>
                      {leil.erro ? `❌ Leiloeiros (BD): ${leil.erro}` : `✅ Leiloeiros (BD): ${leil.msg}`}
                    </div>
                  )}
                  {(reconLj.msg || reconLj.erro) && (
                    <div style={{ marginBottom: 8, fontSize: 11, fontWeight: 600, color: reconLj.erro ? '#dc2626' : '#0e7490' }}>
                      {reconLj.erro ? `❌ Recon LJUD: ${reconLj.erro}` : `🔎 Recon LJUD: ${reconLj.msg}`}
                    </div>
                  )}

                  {/* Contador + progresso */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 28, fontWeight: 900, color: '#111', lineHeight: 1 }}>
                      {total != null ? total.toLocaleString('pt-BR') : '—'}
                    </span>
                    <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>imóveis no banco</span>
                  </div>

                  <BarraProgresso visivel={caixaTodos.rodando || (caixaTodos.total > 0 && !caixaTodos.rodando)} atual={caixaTodos.atual} total={caixaTodos.total}
                    label={caixaTodos.rodando ? `Agendando ${caixaTodos.ufAtual}...` : `✅ ${caixaTodos.atual} estados agendados`}
                    sublabel={caixaTodos.rodando ? 'Disparando workflows — não feche esta aba' : 'Scraper rodando em background · resultado em ~10 min'} cor="#c2410c" />

                  {sysDebug['scraper'] && (
                    <div style={{ marginBottom: 8, background: sysDebug['scraper'].status === 200 ? '#f0fdf4' : '#fef2f2', borderRadius: 8, padding: '8px 12px', border: `1px solid ${sysDebug['scraper'].status === 200 ? '#bbf7d0' : '#fecaca'}` }}>
                      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4, color: sysDebug['scraper'].status === 200 ? '#059669' : '#dc2626' }}>
                        {sysDebug['scraper'].status === 200 ? '✅ Diagnóstico OK' : `❌ Erro (${sysDebug['scraper'].status})`}
                        <button onClick={() => setSysDebug(s => ({ ...s, scraper: null }))} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 11 }}>✕</button>
                      </div>
                      <textarea readOnly onClick={e => e.target.select()} style={{ fontSize: 10, color: '#334155', margin: 0, whiteSpace: 'pre', maxHeight: 160, overflow: 'auto', width: '100%', background: 'transparent', border: 'none', resize: 'none', outline: 'none', fontFamily: 'monospace', cursor: 'text' }} value={JSON.stringify(sysDebug['scraper'].body, null, 2)} />
                    </div>
                  )}

                  {/* 27 estados expansíveis */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: '#64748b' }}>
                      {agendados > 0 ? <span style={{ color: '#059669', fontWeight: 700 }}>✅ {agendados} estados agendados</span> : 'Cron diário automático · ▶ para forçar por estado'}
                      {erros > 0 && <span style={{ color: '#dc2626', fontWeight: 700, marginLeft: 8 }}>· ❌ {erros} com erro</span>}
                    </span>
                    <button onClick={() => toggleExpandir('caixa')} style={{ fontSize: 11, color: '#0D63DB', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                      {estadosExpandidos.caixa ? '▲ Recolher' : `▼ Ver 27 estados${erros > 0 ? ` (${erros} ❌)` : ''}`}
                    </button>
                  </div>
                  {estadosExpandidos.caixa && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5, marginTop: 10 }}>
                      {AGENDA_SCRAPER.map(({ uf, hora }) => {
                        const r = scraperRegiao[uf] || {};
                        return (
                          <div key={uf} style={{ background: r.agendado ? '#f0fdf4' : r.erro ? '#fef2f2' : '#f8fafc', borderRadius: 7, padding: '6px 8px', border: `1px solid ${r.agendado ? '#bbf7d0' : r.erro ? '#fecaca' : '#e2e8f0'}` }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                              <span style={{ fontWeight: 800, fontSize: 12, color: '#334155' }}>{uf}</span>
                              <button onClick={() => triggerScraper(uf, [uf])} disabled={r.rodando}
                                style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: r.rodando ? '#f1f5f9' : '#eff6ff', color: r.rodando ? '#94a3b8' : '#0D63DB', border: `1px solid ${r.rodando ? '#e2e8f0' : '#bfdbfe'}`, borderRadius: 4, cursor: r.rodando ? 'default' : 'pointer', fontSize: 8 }}>
                                {r.rodando ? '…' : r.agendado ? '↺' : '▶'}
                              </button>
                            </div>
                            <div style={{ fontSize: 8, color: '#94a3b8' }}>{hora} UTC</div>
                            {r.agendado && <div style={{ fontSize: 8, color: '#059669', fontWeight: 700 }}>🚀 Agendado</div>}
                            {r.erro && <div style={{ fontSize: 8, color: '#dc2626', fontWeight: 700 }} title={r.erro}>❌ {r.erro.slice(0, 20)}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Leiloeiros (Puppeteer + Parceiros API) ── */}
            {[
              ...FONTES_LEILAO.map(f => ({ ...f, tipo: 'scraper' })),
              // Parceiros via API aparecem aqui conforme se conectam
              ...parceiros.filter(p => p.status === 'ativo').map(p => ({
                fonte: `parceiro_${p.id}`,
                nome: p.nome_fantasia || p.nome,
                cor: '#ea580c',
                desc: `API · token ativo`,
                tipo: 'parceiro',
                parceiro: p,
              })),
            ].map(s => {
              const total = leiloeiroContagem[s.fonte] ?? 0;
              const temDados = total > 0;
              const debugKey = `leiloeiro_${s.fonte}`;
              const sa = fonteSaude[s.fonte]; // saúde da última coleta
              // status visual: saúde da coleta tem prioridade sobre "tem dados"
              const saude = sa?.status; // 'ok' | 'degradado' | 'falhou'
              const badge = saude === 'falhou' ? { txt: '✕ Falhou', bg: '#fef2f2', cor: '#dc2626' }
                : saude === 'degradado' ? { txt: '⚠ Degradado', bg: '#fffbeb', cor: '#b45309' }
                : temDados ? { txt: '● Ativo', bg: `${s.cor}22`, cor: s.cor }
                : s.tipo === 'parceiro' ? { txt: '● Conectado', bg: `${s.cor}22`, cor: s.cor }
                : { txt: '○ Sem dados', bg: '#f1f5f9', cor: '#94a3b8' };
              const pct = (v) => `${Math.round((v || 0) * 100)}%`;
              const quando = sa?.executado_em ? new Date(sa.executado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null;
              return (
                <div key={s.fonte} style={{ background: `${s.cor}08`, borderRadius: 12, border: `1px solid ${saude === 'falhou' ? '#fecaca' : saude === 'degradado' ? '#fde68a' : `${s.cor}22`}`, padding: '14px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 13, color: '#111' }}>{s.nome}</div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{s.desc}</div>
                    </div>
                    <span title={sa?.motivo || ''} style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: badge.bg, color: badge.cor, whiteSpace: 'nowrap' }}>
                      {badge.txt}
                    </span>
                  </div>
                  <div style={{ fontSize: 24, fontWeight: 900, color: temDados ? s.cor : '#94a3b8', lineHeight: 1 }}>
                    {total.toLocaleString('pt-BR')}
                  </div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2, marginBottom: sa ? 6 : 10 }}>imóveis no banco</div>
                  {sa && (
                    <div style={{ fontSize: 9.5, color: '#64748b', marginBottom: 10, lineHeight: 1.5 }}>
                      <span title="% dos lotes com valor / UF / link do edital / foto">
                        valor {pct(sa.valor_pct)} · UF {pct(sa.uf_pct)} · edital {pct(sa.link_pct)} · foto {pct(sa.foto_pct)}
                      </span>
                      {quando && <div style={{ color: '#94a3b8' }}>última coleta {quando}{sa.estrategia ? ` · ${sa.estrategia}` : ''}</div>}
                    </div>
                  )}
                  {/* Diagnóstico determinístico (SEM IA): causa provável + próxima ação
                      de scraping, cruzando a última coleta com a anterior. */}
                  {(() => {
                    const diag = s.tipo === 'scraper' ? diagnosticoCaptacao(sa, fonteSaudePrev[s.fonte]) : null;
                    if (!diag) return null;
                    const c = diag.nivel === 'falhou' ? { bg: '#fef2f2', bd: '#fecaca', cor: '#b91c1c' } : { bg: '#fffbeb', bd: '#fde68a', cor: '#92400e' };
                    const lista = diag.problemas.slice(0, 3);
                    return (
                      <div style={{ background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 8, padding: '8px 10px', marginBottom: 10 }}>
                        <div style={{ fontSize: 9.5, fontWeight: 800, color: c.cor, marginBottom: 4 }}>🔧 Diagnóstico automático (sem IA)</div>
                        {lista.map((p, i) => (
                          <div key={i} style={{ fontSize: 9.5, color: c.cor, lineHeight: 1.5, marginBottom: i < lista.length - 1 ? 5 : 0 }}>
                            <div><strong>Causa:</strong> {p.causa}</div>
                            <div><strong>Ação:</strong> {p.acao}</div>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => rodarSysDebug(debugKey)} disabled={sysDebugRodando[debugKey]}
                      style={{ padding: '4px 10px', borderRadius: 6, background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: 10, fontWeight: 600 }}>
                      {sysDebugRodando[debugKey] ? '⏳' : '🔍 Diagnóstico'}
                    </button>
                    {s.tipo === 'scraper' && (
                      <button onClick={triggerPuppeteer} disabled={puppeteerStatus?.rodando}
                        style={{ padding: '4px 10px', borderRadius: 6, background: puppeteerStatus?.rodando ? '#f1f5f9' : s.cor, color: puppeteerStatus?.rodando ? '#94a3b8' : 'white', border: 'none', cursor: puppeteerStatus?.rodando ? 'default' : 'pointer', fontSize: 10, fontWeight: 700 }}>
                        {puppeteerStatus?.rodando ? '⏳ Rodando…' : '▶ Executar'}
                      </button>
                    )}
                  </div>
                  {sysDebug[debugKey] && (
                    <div style={{ marginTop: 8, background: sysDebug[debugKey].status === 200 ? '#f0fdf4' : '#fef2f2', borderRadius: 6, padding: '8px 10px', border: `1px solid ${sysDebug[debugKey].status === 200 ? '#bbf7d0' : '#fecaca'}` }}>
                      <div style={{ fontWeight: 700, fontSize: 10, marginBottom: 4, color: sysDebug[debugKey].status === 200 ? '#059669' : '#dc2626', display: 'flex', justifyContent: 'space-between' }}>
                        {sysDebug[debugKey].status === 200 ? '✅ OK' : `❌ Erro (${sysDebug[debugKey].status})`}
                        <button onClick={() => setSysDebug(d => ({ ...d, [debugKey]: null }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 10 }}>✕</button>
                      </div>
                      <textarea readOnly onClick={e => e.target.select()} style={{ fontSize: 9, color: '#334155', margin: 0, whiteSpace: 'pre', maxHeight: 120, overflow: 'auto', width: '100%', background: 'transparent', border: 'none', resize: 'none', outline: 'none', fontFamily: 'monospace', cursor: 'text' }} value={JSON.stringify(sysDebug[debugKey].body, null, 2)} />
                    </div>
                  )}
                </div>
              );
            })}

          </div>

          {/* Scraper Puppeteer status */}
          {(puppeteerStatus?.erro || puppeteerStatus?.agendado || sysDebug['banco']) && (
            <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '12px 16px', fontSize: 12 }}>
              <div style={{ fontWeight: 700, fontSize: 12, color: '#475569', marginBottom: 6 }}>Puppeteer · cron 07:00 BRT</div>
              {puppeteerStatus?.erro && <div style={{ color: '#ef4444', marginBottom: 6 }}>⚠️ {puppeteerStatus.erro}</div>}
              {puppeteerStatus?.agendado && <div style={{ color: '#059669', marginBottom: 6 }}>✅ {puppeteerStatus.msg}</div>}
              {sysDebug['banco'] && (
                <div>
                  <div style={{ fontWeight: 700, fontSize: 11, color: sysDebug['banco'].status === 200 ? '#059669' : '#dc2626' }}>
                    {sysDebug['banco'].status === 200 ? '✅ OK' : `❌ Erro (${sysDebug['banco'].status})`}
                    <button onClick={() => setSysDebug(s => ({ ...s, banco: null }))} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
                  </div>
                  <textarea readOnly style={{ fontSize: 10, width: '100%', maxHeight: 140, background: 'transparent', border: 'none', resize: 'none', outline: 'none', fontFamily: 'monospace' }} value={JSON.stringify(sysDebug['banco'].body, null, 2)} />
                </div>
              )}
              <button onClick={triggerPuppeteer} disabled={puppeteerStatus?.rodando}
                style={{ marginTop: 8, padding: '5px 12px', borderRadius: 7, background: '#0D63DB', color: 'white', fontWeight: 700, fontSize: 11, border: 'none', cursor: 'pointer' }}>
                {puppeteerStatus?.rodando ? '⏳' : '▶ Executar Puppeteer agora'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ═══ ABA GEOCODIFICAÇÃO ═══ */}
      {abaAtiva === 'geocod' && (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🗺️</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#111' }}>Geocodificação — Nominatim / OSM</div>
              <div style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>● Automático · 24h contínuo · a cada 10min · CEP+Correios → endereço → rua → bairro → cidade</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={() => rodarSysDebug('geocod')} disabled={sysDebugRodando['geocod']}
                style={{ padding: '5px 10px', borderRadius: 8, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}>
                {sysDebugRodando['geocod'] ? '⏳' : '🔍 Diagnóstico'}
              </button>
              <button onClick={geocodificarTodos} disabled={geocTodos.rodando}
                style={{ padding: '7px 14px', borderRadius: 8, background: geocTodos.rodando ? '#f1f5f9' : '#0D63DB', color: geocTodos.rodando ? '#94a3b8' : 'white', border: 'none', cursor: geocTodos.rodando ? 'default' : 'pointer', fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>
                {geocTodos.rodando
                  ? `⏳ ${geocTodos.ufAtual} [${geocTodos.atual}/27] · ${geocTodos.processadosTotal.toLocaleString('pt-BR')} / ${Object.values(geocPendentes).reduce((a, b) => a + b, 0).toLocaleString('pt-BR')} proc`
                  : '▶ Geocodificar todos'}
              </button>
            </div>
          </div>

          {sysDebug['geocod'] && (
            <div style={{ marginBottom: 12, background: sysDebug['geocod'].status === 200 ? '#f0fdf4' : '#fef2f2', borderRadius: 8, padding: '10px 12px', border: `1px solid ${sysDebug['geocod'].status === 200 ? '#bbf7d0' : '#fecaca'}` }}>
              <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4, color: sysDebug['geocod'].status === 200 ? '#059669' : '#dc2626' }}>
                {sysDebug['geocod'].status === 200 ? '✅ Diagnóstico OK' : `❌ Erro (${sysDebug['geocod'].status})`}
                <button onClick={() => setSysDebug(s => ({ ...s, geocod: null }))} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 11 }}>✕</button>
              </div>
              <textarea readOnly onClick={e => e.target.select()} style={{ fontSize: 10, color: '#334155', margin: 0, whiteSpace: 'pre', maxHeight: 220, overflow: 'auto', width: '100%', background: 'transparent', border: 'none', resize: 'none', outline: 'none', fontFamily: 'monospace', cursor: 'text' }} value={JSON.stringify(sysDebug['geocod'].body, null, 2)} />
            </div>
          )}

          {/* Resumo por nível */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Com coordenadas', valor: geoStats.com.toLocaleString('pt-BR'), cor: '#059669', bg: '#f0fdf4' },
              { label: 'Sem coordenadas', valor: geoStats.sem.toLocaleString('pt-BR'), cor: '#d97706', bg: '#fefce8' },
              { label: 'Cobertura GPS',   valor: `${geoPct}%`,                          cor: geoPct > 80 ? '#059669' : '#d97706', bg: '#f8fafc' },
            ].map(k => (
              <div key={k.label} style={{ background: k.bg, borderRadius: 10, padding: '12px 14px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: k.cor }}>{k.valor}</div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{k.label}</div>
              </div>
            ))}
          </div>

          <BarraProgresso
            visivel={geocTodos.rodando || (geocTodos.total > 0 && !geocTodos.rodando)}
            atual={geocTodos.atual} total={geocTodos.total}
            label={geocTodos.rodando ? `Geocodificando ${geocTodos.ufAtual}...` : `✅ Concluído — ${geocTodos.processadosTotal} imóveis geocodificados`}
            sublabel={geocTodos.rodando ? `${geocTodos.processadosTotal.toLocaleString('pt-BR')} / ${Object.values(geocPendentes).reduce((a, b) => a + b, 0).toLocaleString('pt-BR')} processados · 1 req/s Nominatim · não feche esta aba` : 'Atualização do mapa disponível'}
            cor="#0D63DB"
          />

          {/* Resumo + toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {geocTodos.rodando
                ? <span style={{ color: '#0D63DB', fontWeight: 700 }}>⏳ Processando {geocTodos.ufAtual}... · <b>{geocTodos.processadosTotal.toLocaleString('pt-BR')}</b> / {Object.values(geocPendentes).reduce((a, b) => a + b, 0).toLocaleString('pt-BR')} processados</span>
                : geocTodos.total > 0
                  ? <span style={{ color: '#059669', fontWeight: 700 }}>✅ Sessão concluída · {geocTodos.processadosTotal.toLocaleString('pt-BR')} imóveis geocodificados</span>
                  : <span>Cron 24h · a cada 10min · clique ▶ para forçar um estado agora{geocUltimoRefresh ? ` · atualizado ${geocUltimoRefresh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>}
            </div>
            <button onClick={() => { toggleExpandir('geocod'); if (!estadosExpandidos.geocod && Object.keys(geocPendentes).length === 0) carregarPendentes(); }} style={{ fontSize: 11, color: '#0D63DB', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
              {estadosExpandidos.geocod ? '▲ Recolher estados' : '▼ Ver todos os estados (27)'}
            </button>
          </div>

          {estadosExpandidos.geocod && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
              {UFS_GEOCOD_ORDEM.map(uf => {
                const r = geocRegiao[uf] || {};
                const pendentes = geocPendentes[uf];
                const temErro = !!r.erro;
                const temResultado = r.processados != null && !r.rodando;
                const pctFeito = pendentes > 0 ? Math.min(100, Math.round((r.processados / pendentes) * 100)) : (r.concluido ? 100 : 0);
                return (
                  <div key={uf} style={{ background: temErro ? '#fef2f2' : temResultado ? '#eff6ff' : '#f8fafc', borderRadius: 8, padding: '8px 10px', border: `1px solid ${temErro ? '#fecaca' : temResultado ? '#bfdbfe' : '#e2e8f0'}` }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span style={{ fontWeight: 800, fontSize: 13, color: '#334155' }}>{uf}</span>
                      <button onClick={() => triggerGeoc(uf)} disabled={r.rodando}
                        style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: r.rodando ? '#f1f5f9' : '#eff6ff', color: r.rodando ? '#94a3b8' : '#0D63DB', border: `1px solid ${r.rodando ? '#e2e8f0' : '#bfdbfe'}`, borderRadius: 5, cursor: r.rodando ? 'default' : 'pointer', fontSize: 10, fontWeight: 700 }}>
                        {r.rodando ? '…' : temResultado ? '↺' : '▶'}
                      </button>
                    </div>
                    {/* Pendentes antes de processar */}
                    {!r.rodando && !temResultado && !temErro && (
                      <div style={{ fontSize: 9, color: '#94a3b8' }}>
                        {pendentes != null ? `${pendentes.toLocaleString('pt-BR')} pendentes` : '…'}
                      </div>
                    )}
                    {r.rodando && (
                      <div style={{ marginTop: 3 }}>
                        <div style={{ background: '#dbeafe', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: '55%', background: r.aviso ? '#f59e0b' : '#0D63DB', borderRadius: 4, animation: 'pulse 1.2s ease-in-out infinite' }} />
                        </div>
                        <div style={{ fontSize: 9, color: r.aviso ? '#d97706' : '#0D63DB', fontWeight: 800, marginTop: 3 }}>
                          {r.aviso
                            ? `${r.aviso} · ${(r.processados || 0).toLocaleString('pt-BR')} proc`
                            : `⏳ ${(r.processados || 0).toLocaleString('pt-BR')} proc`}
                        </div>
                      </div>
                    )}
                    {temResultado && !temErro && (
                      <div style={{ marginTop: 3 }}>
                        <div style={{ background: '#e2e8f0', borderRadius: 4, height: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: r.concluido || pendentes === 0 ? '100%' : `${Math.min(100, pctFeito)}%`, background: (r.concluido || pendentes === 0) ? '#10b981' : '#0D63DB', borderRadius: 4 }} />
                        </div>
                        <div style={{ fontSize: 9, color: (r.concluido || pendentes === 0) ? '#059669' : '#0D63DB', fontWeight: 800, marginTop: 3 }}>
                          {(r.concluido || pendentes === 0)
                            ? `✅ fila zerada${r.falhas ? ` · ${r.falhas} falhas` : ''}`
                            : `📍 ${r.processados.toLocaleString('pt-BR')} proc · ${pendentes != null ? pendentes.toLocaleString('pt-BR') : '?'} restantes${r.falhas ? ` · ${r.falhas} falhas` : ''}`}
                        </div>
                      </div>
                    )}
                    {temErro && (
                      <div style={{ fontSize: 9, color: '#dc2626', fontWeight: 700, marginTop: 3 }} title={r.erro}>❌ {r.erro.slice(0, 40)}</div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 12 }}>
            Cascata 5 níveis: CEP+Correios → endereço → rua s/nº → bairro → cidade · cron 24h automático · ▶ processa até zerar
          </div>
        </div>
      )}

      {/* ═══ ABA PARCEIROS ═══ */}
      {abaAtiva === 'parceiros' && (
        <ParceirosLeiloeiroTab parceiros={parceiros} setParceiros={setParceiros} />
      )}

      {/* ═══ ABA ROADMAP ═══ */}
      {abaAtiva === 'roadmap' && (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: 20 }}>
          <div style={{ fontWeight: 800, fontSize: 14, color: '#111', marginBottom: 4 }}>Próximas integrações</div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 16 }}>
            Volume estimado ao integrar todas as fontes: <b style={{ color: '#0D63DB' }}>~50.000–80.000 imóveis</b> no banco.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {scrapersPlanjados.map(s => (
              <div key={s.nome} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px 14px', border: '1px dashed #cbd5e1' }}>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#334155' }}>{s.nome}</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{s.volume} imóveis</div>
                <div style={{ marginTop: 8, display: 'inline-block', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: '#fef3c7', color: '#92400e' }}>Em breve</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// COMERCIAL TAB — painel do comercial: todos os clientes (pagantes e não), por
// consultor, com atribuição. Substitui a antiga aba SDR.
// ═══════════════════════════════════════════════════════════════════════════════
const CLIENT_ROLES = ['explorador', 'top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
const PLANO_NOME = { explorador: 'Explorador', top2: 'Investidor Pro', top2_anual: 'Investidor Pro (anual)', assessorado: 'Assessorado', assessorado_anual: 'Assessorado (anual)', clube: 'Leilão Club', clube_anual: 'Leilão Club (anual)' };

function ComercialTab() {
  const [clientes, setClientes] = useState([]);
  const [consultores, setConsultores] = useState([]);
  const [leadsMap, setLeadsMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState('todos'); // 'todos' | 'sem' | consultorId
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    const [{ data: cl }, { data: cons }, { data: leads }] = await Promise.all([
      supabase.from('perfis').select('id, nome, role, plano, telefone, indicado_por, created_at, inadimplente_desde').in('role', CLIENT_ROLES).order('created_at', { ascending: false }),
      supabase.from('perfis').select('id, nome').eq('role', 'consultor').order('nome'),
      supabase.from('sdr_leads').select('user_id, origem').not('user_id', 'is', null),
    ]);
    setClientes(cl || []); setConsultores(cons || []);
    const m = {}; (leads || []).forEach(l => { if (l.user_id && !m[l.user_id]) m[l.user_id] = l.origem; });
    setLeadsMap(m);
    setLoading(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const atribuir = async (clienteId, consultorId) => {
    await supabase.from('perfis').update({ indicado_por: consultorId || null }).eq('id', clienteId);
    setClientes(prev => prev.map(c => c.id === clienteId ? { ...c, indicado_por: consultorId || null } : c));
  };

  const ehPagante = (c) => c.role && c.role !== 'explorador';
  const total = clientes.length;
  const pagantes = clientes.filter(ehPagante).length;
  const semCons = clientes.filter(c => !c.indicado_por).length;
  const inadimplentes = clientes.filter(c => c.inadimplente_desde).length;

  const porConsultor = consultores.map(co => {
    const meus = clientes.filter(c => c.indicado_por === co.id);
    return { ...co, total: meus.length, pagantes: meus.filter(ehPagante).length };
  });

  const filtrados = clientes.filter(c => {
    if (filtro === 'sem' && c.indicado_por) return false;
    if (filtro !== 'todos' && filtro !== 'sem' && c.indicado_por !== filtro) return false;
    if (busca && !`${c.nome || ''} ${c.telefone || ''}`.toLowerCase().includes(busca.toLowerCase())) return false;
    return true;
  });

  const card = (label, value, cor) => (
    <div style={{ background: '#fff', border: `2px solid ${cor}`, borderRadius: 12, padding: '10px 18px', minWidth: 120 }}>
      <div style={{ fontSize: 22, fontWeight: 900, color: cor }}>{value}</div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111111', margin: '0 0 4px' }}>Comercial</h2>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 18 }}>Todos os clientes (pagantes e não pagantes), por consultor. Quem entrou por link de consultor já vem vinculado; os demais aparecem em “sem consultor” para você atribuir.</div>

      {/* Resumo */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
        {card('Clientes', total, '#111111')}
        {card('Pagantes', pagantes, '#059669')}
        {card('Não pagantes', total - pagantes, '#0D63DB')}
        {card('Sem consultor', semCons, semCons > 0 ? '#d97706' : '#94a3b8')}
        {card('Inadimplentes', inadimplentes, inadimplentes > 0 ? '#dc2626' : '#94a3b8')}
      </div>

      {/* Consultores (clicáveis para filtrar) */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <button onClick={() => setFiltro('todos')} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${filtro === 'todos' ? '#0D63DB' : '#e2e8f0'}`, background: filtro === 'todos' ? '#eff6ff' : '#fff', fontSize: 12, fontWeight: 700, color: '#111', cursor: 'pointer' }}>Todos ({total})</button>
        <button onClick={() => setFiltro('sem')} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${filtro === 'sem' ? '#d97706' : '#e2e8f0'}`, background: filtro === 'sem' ? '#fffbeb' : '#fff', fontSize: 12, fontWeight: 700, color: '#92400e', cursor: 'pointer' }}>Sem consultor ({semCons})</button>
        {porConsultor.map(co => (
          <button key={co.id} onClick={() => setFiltro(co.id)} style={{ padding: '8px 14px', borderRadius: 10, border: `1px solid ${filtro === co.id ? '#059669' : '#e2e8f0'}`, background: filtro === co.id ? '#f0fdf4' : '#fff', fontSize: 12, fontWeight: 700, color: '#111', cursor: 'pointer' }}>
            🤝 {co.nome} <span style={{ color: '#64748b', fontWeight: 600 }}>({co.total} · {co.pagantes} pag.)</span>
          </button>
        ))}
      </div>

      {/* Busca */}
      <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por nome ou WhatsApp…" style={{ ...S.input, maxWidth: 320, marginBottom: 14 }} />

      {/* Tabela */}
      <div style={{ ...S.card, borderRadius: 14, overflowX: 'auto' }}>
        {loading ? <p style={{ color: '#94a3b8' }}>Carregando…</p>
          : filtrados.length === 0 ? <p style={{ color: '#94a3b8' }}>Nenhum cliente neste filtro.</p>
          : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#64748b', fontSize: 11 }}>
                  <th style={S.td}>Cliente</th><th style={S.td}>WhatsApp</th><th style={S.td}>Plano</th><th style={S.td}>Origem</th><th style={S.td}>Consultor</th><th style={S.td}>Entrou</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(c => (
                  <tr key={c.id}>
                    <td style={S.td}>{c.nome || '—'}</td>
                    <td style={S.td}>{c.telefone ? <a href={`https://wa.me/55${c.telefone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{ color: '#059669', fontWeight: 700, textDecoration: 'none' }}>{c.telefone}</a> : '—'}</td>
                    <td style={S.td}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.inadimplente_desde ? '#fee2e2' : ehPagante(c) ? '#dcfce7' : '#f1f5f9', color: c.inadimplente_desde ? '#dc2626' : ehPagante(c) ? '#166534' : '#475569' }}>
                        {c.inadimplente_desde ? 'Inadimplente' : (PLANO_NOME[c.role] || c.role)}
                      </span>
                    </td>
                    <td style={S.td}>{leadsMap[c.id] || <span style={{ color: '#cbd5e1' }}>orgânico</span>}</td>
                    <td style={S.td}>
                      <select value={c.indicado_por || ''} onChange={e => atribuir(c.id, e.target.value)}
                        style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${c.indicado_por ? '#e2e8f0' : '#f59e0b'}`, fontSize: 12, background: c.indicado_por ? '#fff' : '#fffbeb', color: '#111', cursor: 'pointer' }}>
                        <option value="">Sem consultor</option>
                        {consultores.map(co => <option key={co.id} value={co.id}>{co.nome}</option>)}
                      </select>
                    </td>
                    <td style={S.td}>{c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// EQUIPE TAB
// ═══════════════════════════════════════════════════════════════════════════════
const ROLE_BADGE_COLORS = { admin: { bg: '#fef3c7', color: '#92400e' }, analista: { bg: '#dbeafe', color: '#084BA6' }, consultor: { bg: '#d1fae5', color: '#065f46' }, advogado: { bg: '#ede9fe', color: '#5b21b6' }, leiloeiro: { bg: '#fff7ed', color: '#c2410c' } };

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
  em_andamento: { bg: '#dbeafe', color: '#084BA6', label: 'Em Andamento' },
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
  const [concedendo, setConcedendo] = useState(false);
  const [extrasMercado, setExtrasMercado] = useState(1);
  const [extrasDocumental, setExtrasDocumental] = useState(1);
  const [msgConcessao, setMsgConcessao] = useState('');

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
    let url = `https://calendar.google.com/calendar/r/eventedit?text=${encodeURIComponent('Reunião BidPro Brasil — ' + (sol.imovel_nome || 'Imóvel'))}`;
    url += `&details=${encodeURIComponent('Análise de imóvel em leilão — BidPro Brasil')}`;
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
      const r = await apiCall('/api/criar-sala-reuniao', {
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
      await apiCall('/api/notificar-reuniao', {
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

  async function concederAnalises() {
    if (!sol.user_id) return;
    if (extrasMercado < 0 || extrasDocumental < 0) { setMsgConcessao('Valores inválidos.'); return; }
    if (extrasMercado === 0 && extrasDocumental === 0) { setMsgConcessao('Selecione ao menos 1 análise para conceder.'); return; }
    setConcedendo(true); setMsgConcessao('');
    const { data: perfil } = await supabase.from('perfis').select('bonus_mercado, bonus_documental').eq('id', sol.user_id).single();
    const atualMercado = perfil?.bonus_mercado || 0;
    const atualDocumental = perfil?.bonus_documental || 0;
    const { error } = await supabase.from('perfis').update({
      bonus_mercado: atualMercado + extrasMercado,
      bonus_documental: atualDocumental + extrasDocumental,
    }).eq('id', sol.user_id);
    if (error) {
      setMsgConcessao('Erro ao conceder análises.');
    } else {
      const partes = [];
      if (extrasMercado > 0) partes.push(`${extrasMercado} mercadológica${extrasMercado > 1 ? 's' : ''}`);
      if (extrasDocumental > 0) partes.push(`${extrasDocumental} documental${extrasDocumental > 1 ? 'is' : ''}`);
      setMsgConcessao(`✅ Concedido: ${partes.join(' + ')}.`);
    }
    setConcedendo(false);
  }

  const meetCreateUrl = buildMeetCreateUrl();

  const statusSol = STATUS_SOL_COLORS[sol.status] || STATUS_SOL_COLORS.solicitado;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 32, width: '100%', maxWidth: 920, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', position: 'relative' }} onClick={e => e.stopPropagation()}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }}>✕</button>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {sol.tipo && <span style={{ background: '#eff6ff', color: '#084BA6', borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>{{ processual:'Processual', edital:'Edital', mercadologica:'Mercadológica', consulta:'Consulta com Especialista' }[sol.tipo] || sol.tipo}</span>}
          <span style={{ background: statusSol.bg, color: statusSol.color, borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>{statusSol.label}</span>
          {sol.tipo === 'processual' && <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 8, padding: '3px 12px', fontSize: 12, fontWeight: 700 }}>⏰ Prazo judicial</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {/* LEFT — Info */}
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#111111', marginBottom: 16 }}>Informações do Imóvel</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {[['Imóvel', sol.imovel_nome || '—'], ['Cidade', sol.imovel_cidade || '—'], ['Referência', sol.imovel_ref || '—'], ['Analista', analista?.nome || 'Não atribuído']].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 13, color: '#64748b', minWidth: 80 }}>{k}:</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#111111' }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Agendamento da Reunião</div>

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
                <a href={`mailto:${clienteEmail}?subject=Reunião BidPro Brasil — ${sol.imovel_nome || 'Imóvel'}`}
                  style={{ padding: '8px 14px', background: '#eff6ff', color: '#084BA6', borderRadius: 8, fontSize: 13, fontWeight: 700, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
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

            <div style={{ marginTop: 16, padding: '14px 16px', background: '#fffbeb', borderRadius: 10, border: '1.5px solid #fde68a' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#92400e', marginBottom: 10 }}>🎁 Conceder análises adicionais ao cliente</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#78350f', width: 110 }}>Mercadológicas</span>
                  <select value={extrasMercado} onChange={e => setExtrasMercado(Number(e.target.value))}
                    style={{ padding: '6px 10px', border: '1.5px solid #fde68a', borderRadius: 7, fontSize: 13, background: 'white', flex: 1 }}>
                    {[0,1,2,3,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#78350f', width: 110 }}>Documentais/Jur.</span>
                  <select value={extrasDocumental} onChange={e => setExtrasDocumental(Number(e.target.value))}
                    style={{ padding: '6px 10px', border: '1.5px solid #fde68a', borderRadius: 7, fontSize: 13, background: 'white', flex: 1 }}>
                    {[0,1,2,3,5].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <button onClick={concederAnalises} disabled={concedendo || !sol.user_id}
                  style={{ padding: '8px 14px', background: '#d97706', color: 'white', border: 'none', borderRadius: 7, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: concedendo ? 0.7 : 1, marginTop: 4 }}>
                  {concedendo ? 'Concedendo…' : 'Conceder'}
                </button>
              </div>
              {msgConcessao && <div style={{ marginTop: 8, fontSize: 12, color: msgConcessao.startsWith('✅') ? '#065f46' : '#dc2626' }}>{msgConcessao}</div>}
            </div>
          </div>

          {/* RIGHT — Checklist + Transcrições */}
          <div>
            <div style={{ fontWeight: 800, fontSize: 17, color: '#111111', marginBottom: 16 }}>Checklist de Análise</div>
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
      <div><div style={{ fontSize: 20, fontWeight: 900, color: '#0D63DB' }}>{perf.andamento}</div><div style={{ fontSize: 11, color: '#64748b' }}>Em andamento</div></div>
      <div><div style={{ fontSize: 20, fontWeight: 900, color: '#059669' }}>{perf.concluido}</div><div style={{ fontSize: 11, color: '#64748b' }}>Concluídos (mês)</div></div>
    </div>
  );
}

// Monitor de eficiência do jurídico (ranking de advogados + fila/atrasados).
// Base para a reatribuição automática por perda de prazo (cron).
function MonitorJuridico() {
  const [data, setData] = useState(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    apiCall('/api/juridico-eficiencia').then(r => r.json()).then(d => {
      if (d?.error) setErro(d.error); else setData(d);
    }).catch(() => setErro('falha'));
  }, []);
  if (erro) return null; // silencioso (ex.: sem permissão)
  const ranking = data?.ranking || [];
  return (
    <div style={{ background:'#fff', border:'1px solid #e2e8f0', borderRadius:14, padding:'18px 20px', marginBottom:24 }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10, flexWrap:'wrap', gap:8 }}>
        <div style={{ fontWeight:800, fontSize:14, color:'#111' }}>⚖️ Eficiência do Jurídico</div>
        <div style={{ display:'flex', gap:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:'#0f766e', background:'#f0fdfa', borderRadius:8, padding:'3px 10px' }}>{data?.pendentes ?? 0} em revisão</span>
          <span style={{ fontSize:12, fontWeight:700, color:(data?.atrasados? '#b91c1c':'#64748b'), background:(data?.atrasados?'#fef2f2':'#f1f5f9'), borderRadius:8, padding:'3px 10px' }}>{data?.atrasados ?? 0} atrasado(s)</span>
        </div>
      </div>
      {!ranking.length ? (
        <div style={{ fontSize:12, color:'#94a3b8', lineHeight:1.5 }}>Sem histórico de advogados ainda. O ranking aparece quando houver casos enviados ao jurídico. Lembretes nos dias úteis 2/4/6 e, na perda de prazo (7 dias úteis), a pasta é reatribuída por urgência ao advogado de melhor eficiência.</div>
      ) : (
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead><tr style={{ color:'#94a3b8', textAlign:'left' }}>
              {['Advogado','Score','Resp.','No prazo','Tempo médio','Enviados','Pend.'].map(h=><th key={h} style={{ padding:'6px 8px', fontWeight:700, whiteSpace:'nowrap' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {ranking.map((a,i)=>(
                <tr key={a.advogado_id||i} style={{ borderTop:'1px solid #f1f5f9' }}>
                  <td style={{ padding:'7px 8px', fontWeight:700, color:'#111', whiteSpace:'nowrap' }}>{a.nome||'—'}{i===0 && <span style={{ marginLeft:6, fontSize:10, color:'#15803d', fontWeight:800 }}>★ melhor</span>}</td>
                  <td style={{ padding:'7px 8px' }}><b style={{ color:(a.score>=70?'#15803d':a.score>=40?'#d97706':'#b91c1c') }}>{a.score ?? '—'}</b></td>
                  <td style={{ padding:'7px 8px' }}>{a.taxa_resposta_pct ?? '—'}%</td>
                  <td style={{ padding:'7px 8px' }}>{a.taxa_prazo_pct ?? '—'}%</td>
                  <td style={{ padding:'7px 8px', whiteSpace:'nowrap' }}>{a.tempo_medio_h!=null?`${a.tempo_medio_h}h`:'—'}</td>
                  <td style={{ padding:'7px 8px' }}>{a.enviados ?? 0}</td>
                  <td style={{ padding:'7px 8px' }}>{a.pendentes ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
      expira_em: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // validade 7 dias
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
    { label: '🔍 Convidar Analista',   roles: ['analista'],  bg: '#0D63DB' },
    { label: '⚖️ Convidar Advogado',   roles: ['advogado'],  bg: '#7c3aed' },
    { label: '🤝 Convidar Consultor',  roles: ['consultor'], bg: '#059669' },
    { label: '📣 Convidar Afiliado',   roles: ['afiliado'],  bg: '#db2777' },
    { label: '🔨 Convidar Leiloeiro',  roles: ['leiloeiro'], bg: '#ea580c' },
  ];

  return (
    <div>
      {/* ── SECTION A ─────────────────────────────────────────────────────────── */}
      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 14, marginBottom: 24 }}>
        {[
          ['Total Equipe', membros.length, '#111111'],
          ['Analistas', membros.filter(m=>m.role==='analista').length, '#0D63DB'],
          ['Advogados', membros.filter(m=>m.role==='advogado').length, '#7c3aed'],
          ['Consultores', membros.filter(m=>m.role==='consultor').length, '#059669'],
          ['Leiloeiros', membros.filter(m=>m.role==='leiloeiro').length, '#ea580c'],
          ['Finalizados Hoje', finalizadosHoje, '#f59e0b'],
        ].map(([l,v,c]) => (
          <div key={l} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px' }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: c }}>{v}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>{l}</div>
          </div>
        ))}
      </div>

      {/* Monitor de eficiência do jurídico */}
      <MonitorJuridico />

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
        <button
          style={{ padding: '9px 18px', background: '#db2777', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
          title="Link para HABILITAR VENDA numa conta que já existe (cliente ou equipe). Quem abre logado passa a vender e mantém o plano/função."
          onClick={async () => {
            const tipo = window.prompt('Link de venda para: "afiliado" (só comissão) ou "consultor" (com carteira)?', 'afiliado');
            if (tipo === null) return;
            const t = tipo.trim().toLowerCase() === 'consultor' ? 'consultor' : 'afiliado';
            const v = window.prompt('Comissão % sobre as vendas que vierem pelo link:', '10');
            if (v === null) return;
            const pct = Math.max(0, Math.min(100, Number(String(v).replace(',', '.')) || 0));
            const token = crypto.randomUUID();
            const { error } = await supabase.from('convites_vendedor').insert({ token, tipo: t, comissao_pct: pct, criado_por: user.id, expira_em: new Date(Date.now() + 90 * 864e5).toISOString() });
            if (error) { window.alert('Erro: ' + error.message); return; }
            const link = `${window.location.origin}/#/ativar-vendedor/${token}`;
            navigator.clipboard.writeText(link).catch(() => {});
            window.alert(`Link de venda (${t}, ${pct}%) criado e copiado:\n\n${link}\n\nEnvie para o cliente/equipe. Quem abrir logado passa a vender mantendo o plano/função.`);
          }}>
          📣 Link de venda
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
        <div style={{ fontWeight: 700, fontSize: 15, color: '#111111', marginBottom: 14 }}>Convites de Equipe Recentes</div>
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
        <h2 style={{ fontSize: 18, fontWeight: 800, color: '#111111', margin: 0 }}>Solicitações de Análise</h2>
        <button disabled={distribuindo} onClick={distribuirAutomaticamente}
          style={{ padding: '9px 18px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: distribuindo ? 0.7 : 1 }}>
          {distribuindo ? 'Distribuindo…' : '⚡ Distribuir automaticamente'}
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['todas','Todas'], ['aguardando','Aguardando'], ['andamento','Em Andamento'], ['concluidas','Concluídas']].map(([k,l]) => (
          <button key={k} onClick={() => setFiltroStatus(k)}
            style={{ padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 13, background: filtroStatus === k ? '#111111' : '#f1f5f9', color: filtroStatus === k ? '#fff' : '#475569' }}>
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
                  <td style={S.td}><span style={{ fontSize:12, background:'#eff6ff', color:'#084BA6', borderRadius:6, padding:'2px 8px', fontWeight:700 }}>{s.tipo||'—'}</span></td>
                  <td style={{ ...S.td, fontSize:13, color:'#475569' }}>{s.imovel_cidade||'—'}</td>
                  <td style={{ ...S.td, fontSize:12, color:'#94a3b8' }}>{s.criado_em ? new Date(s.criado_em).toLocaleDateString('pt-BR') : '—'}</td>
                  <td style={{ ...S.td, fontSize:13 }}>{analista?.nome || <span style={{ color:'#94a3b8' }}>Não atribuído</span>}</td>
                  <td style={S.td}><span style={{ background:st.bg, color:st.color, borderRadius:6, padding:'2px 10px', fontSize:12, fontWeight:700 }}>{st.label}</span></td>
                  <td style={S.td}><button onClick={() => setSolModal(s)} style={{ padding:'4px 10px', background:'#111111', color:'white', border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>Ver</button></td>
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
                  <input type="checkbox" checked={multiRoles.includes(r)} onChange={e => setMultiRoles(p => e.target.checked ? [...p,r] : p.filter(x=>x!==r))} style={{ accentColor:'#111111' }} />
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

// ═══════════════════════════════════════════════════════════════════════════════
// FINANCEIRO TAB — Gateway (MP/Asaas), saldo MP, saques da equipe
// ═══════════════════════════════════════════════════════════════════════════════
function FinanceiroTab() {
  const [gateway, setGateway] = React.useState('mp'); // 'mp' | 'asaas'
  const [gwSaving, setGwSaving] = React.useState(false);
  const [gwSaved,  setGwSaved]  = React.useState(false);
  const [mpSaldo,  setMpSaldo]  = React.useState(null);
  const [mpLoading, setMpLoading] = React.useState(true);
  const [mpTx, setMpTx] = React.useState(null);      // transações reais do MP
  const [mpTxLoading, setMpTxLoading] = React.useState(true);
  const [chkEmail, setChkEmail] = React.useState('');
  const [chkRes, setChkRes] = React.useState(null);
  const [chkLoad, setChkLoad] = React.useState(false);

  const verificarRecorrencia = async () => {
    const email = chkEmail.trim();
    if (!email) return;
    setChkLoad(true); setChkRes(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/mp-admin', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` }, body: JSON.stringify({ action: 'assinatura_email', email }) });
      const data = await res.json();
      setChkRes(res.ok ? data : { error: data?.error || 'Falha' });
    } catch { setChkRes({ error: 'Falha de conexão' }); }
    setChkLoad(false);
  };

  React.useEffect(() => {
    // Carrega config de gateway ativo
    supabase.from('config_financeira').select('gateway,ativo').then(({ data }) => {
      const mp = data?.find(r => r.gateway === 'mp');
      if (mp) setGateway(mp.ativo ? 'mp' : 'asaas');
    });
    // Saldo + transações reais do MP
    supabase.auth.getSession().then(({ data: { session } }) => {
      const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` };
      fetch('/api/mp-admin', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'saldo' }) })
        .then(r => r.json()).then(d => setMpSaldo(d)).catch(() => setMpSaldo(null)).finally(() => setMpLoading(false));
      fetch('/api/mp-admin', { method: 'POST', headers: auth, body: JSON.stringify({ action: 'transacoes', limit: 30 }) })
        .then(r => r.json()).then(d => setMpTx(d)).catch(() => setMpTx(null)).finally(() => setMpTxLoading(false));
    });
  }, []);

  const salvarGateway = async (gw) => {
    setGwSaving(true);
    await supabase.from('config_financeira').upsert({ gateway: 'mp', ativo: gw === 'mp' }, { onConflict: 'gateway' });
    await supabase.from('config_financeira').upsert({ gateway: 'asaas', ativo: gw === 'asaas' }, { onConflict: 'gateway' });
    setGateway(gw);
    setGwSaving(false);
    setGwSaved(true);
    setTimeout(() => setGwSaved(false), 2000);
  };

  const fmtBRL = v => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const S2 = {
    card:    { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '20px 24px', marginBottom: 20 },
    label:   { fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6, display: 'block' },
    gwBtn:   (ativo) => ({ padding: '10px 22px', borderRadius: 10, border: `2px solid ${ativo ? '#0D63DB' : '#e2e8f0'}`, background: ativo ? '#eff6ff' : 'white', color: ativo ? '#1d4ed8' : '#64748b', fontWeight: 700, fontSize: 14, cursor: 'pointer' }),
    tabBtn:  (ativo) => ({ padding: '7px 18px', borderRadius: 8, border: 'none', background: ativo ? '#0D63DB' : '#f1f5f9', color: ativo ? 'white' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }),
    badge:   (c) => ({ display: 'inline-block', padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, ...c }),
  };

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Gateway ativo */}
      <div style={S2.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 16 }}>Gateway de pagamento ativo</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
          <strong>Mercado Pago (principal)</strong> — saldo rende CDI, saque toda sexta-feira para a equipe.<br/>
          <strong>Asaas (backup)</strong> — ativado automaticamente se MP estiver indisponível, ou manualmente aqui.
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={S2.gwBtn(gateway === 'mp')} onClick={() => salvarGateway('mp')}>
            {gateway === 'mp' ? '✓ ' : ''}Mercado Pago (principal)
          </button>
          <button style={S2.gwBtn(gateway === 'asaas')} onClick={() => salvarGateway('asaas')}>
            {gateway === 'asaas' ? '✓ ' : ''}Asaas (backup)
          </button>
          {gwSaving && <span style={{ fontSize: 13, color: '#94a3b8' }}>Salvando…</span>}
          {gwSaved  && <span style={{ fontSize: 13, color: '#059669', fontWeight: 700 }}>✓ Salvo</span>}
        </div>
      </div>

      {/* Saldo MP */}
      <div style={S2.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 14 }}>Saldo Mercado Pago</div>
        {mpLoading ? (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</div>
        ) : mpSaldo?.error ? (
          <div style={{ color: mpSaldo.indisponivel ? '#64748b' : '#dc2626', fontSize: 13, lineHeight: 1.6 }}>
            {mpSaldo.indisponivel ? 'ℹ️ ' : '⚠️ '}{mpSaldo.error}
          </div>
        ) : mpSaldo ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Disponível', value: fmtBRL(mpSaldo.available_balance), cor: '#059669' },
              { label: 'A liberar', value: fmtBRL(mpSaldo.unavailable_balance), cor: '#d97706' },
              { label: 'Total', value: fmtBRL((mpSaldo.available_balance || 0) + (mpSaldo.unavailable_balance || 0)), cor: '#0D63DB' },
            ].map(m => (
              <div key={m.label} style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 20px', minWidth: 140 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>{m.label}</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: m.cor }}>{m.value}</div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Configure MP_ACCESS_TOKEN no Vercel para ver o saldo.</div>
        )}
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 12, lineHeight: 1.5 }}>
          Se o MP não expõe o saldo pela API, use as <strong>transações reais</strong> abaixo — é o valor que de fato entrou.
        </div>
      </div>

      {/* Transações reais do Mercado Pago — valor real da operação (bruto/taxa/líquido) */}
      <div style={S2.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 4 }}>Transações reais (Mercado Pago)</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Direto da API do MP — o valor efetivamente recebido, já descontada a taxa.</div>
        {mpTxLoading ? (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</div>
        ) : mpTx?.error ? (
          <div style={{ color: '#dc2626', fontSize: 13 }}>⚠️ {mpTx.error}</div>
        ) : mpTx?.transacoes ? (
          <>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16 }}>
              {[
                { label: `Recebido (líquido) · ${mpTx.resumo?.qtdAprovados || 0} aprovadas`, value: fmtBRL(mpTx.resumo?.totalLiquido), cor: '#059669' },
                { label: 'Bruto (aprovadas)', value: fmtBRL(mpTx.resumo?.totalBruto), cor: '#0D63DB' },
                { label: 'Taxas MP', value: fmtBRL((mpTx.resumo?.totalBruto || 0) - (mpTx.resumo?.totalLiquido || 0)), cor: '#d97706' },
              ].map(m => (
                <div key={m.label} style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 20px', minWidth: 150 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>{m.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: m.cor }}>{m.value}</div>
                </div>
              ))}
            </div>
            {/* Oculta as validações de cartão de R$ 0,00 (o MP cria uma por assinatura
                — apareciam como uma 2ª linha "duplicada" do mesmo cliente). */}
            {(() => { const _visiveis = mpTx.transacoes.filter(t => Number(t.bruto) > 0); return (
            _visiveis.length === 0 ? (
              <div style={{ color: '#94a3b8', fontSize: 13 }}>Nenhuma transação encontrada no Mercado Pago ainda.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '8px 10px', fontWeight: 700 }}>Data</th>
                      <th style={{ padding: '8px 10px', fontWeight: 700 }}>Cliente / descrição</th>
                      <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right' }}>Bruto</th>
                      <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right' }}>Taxa</th>
                      <th style={{ padding: '8px 10px', fontWeight: 700, textAlign: 'right' }}>Líquido</th>
                      <th style={{ padding: '8px 10px', fontWeight: 700 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {_visiveis.map(t => {
                      const stCor = t.status === 'approved' ? { background: '#dcfce7', color: '#166534' }
                        : (t.status === 'rejected' || t.status === 'cancelled') ? { background: '#fee2e2', color: '#991b1b' }
                        : { background: '#fef9c3', color: '#854d0e' };
                      const stLabel = t.status === 'approved' ? 'aprovado'
                        : t.status === 'rejected' ? 'recusado'
                        : t.status === 'cancelled' ? 'cancelado'
                        : t.status === 'refunded' ? 'estornado'
                        : t.status === 'charged_back' ? 'chargeback'
                        : (t.status || '—');
                      const dt = t.data ? new Date(t.data).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
                      return (
                        <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: '#475569' }}>{dt}</td>
                          <td style={{ padding: '8px 10px', color: '#111' }}>
                            <div>{t.email || '—'}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.descricao || t.metodo || ''}{t.parcelas > 1 ? ` · ${t.parcelas}x` : ''}</div>
                          </td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: '#0D63DB' }}>{fmtBRL(t.bruto)}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', color: '#d97706' }}>{t.taxa != null ? `- ${fmtBRL(t.taxa)}` : '—'}</td>
                          <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 800, color: '#059669' }}>{t.liquido != null ? fmtBRL(t.liquido) : '—'}</td>
                          <td style={{ padding: '8px 10px' }}><span style={{ ...S2.badge(stCor) }}>{stLabel}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )); })()}
          </>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Não foi possível carregar as transações do Mercado Pago.</div>
        )}
      </div>

      {/* Verificar recorrência de um assinante (preapproval do MP por e-mail) */}
      <div style={S2.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 4 }}>Verificar recorrência de um assinante</div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>Confirma no Mercado Pago se a assinatura vai continuar sendo cobrada (status, próxima cobrança e valor).</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input value={chkEmail} onChange={e => setChkEmail(e.target.value)} placeholder="e-mail do assinante" onKeyDown={e => e.key === 'Enter' && verificarRecorrencia()}
            style={{ flex: 1, minWidth: 220, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, outline: 'none' }} />
          <button onClick={verificarRecorrencia} disabled={chkLoad || !chkEmail.trim()} style={{ padding: '10px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: chkLoad || !chkEmail.trim() ? 0.5 : 1 }}>
            {chkLoad ? 'Verificando…' : 'Verificar'}
          </button>
        </div>
        {chkRes && (
          <div style={{ marginTop: 12 }}>
            {chkRes.error ? (
              <div style={{ color: '#dc2626', fontSize: 13 }}>⚠️ {chkRes.error}</div>
            ) : (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: chkRes.temRecorrenciaAtiva ? '#059669' : '#b45309', background: chkRes.temRecorrenciaAtiva ? '#ecfdf5' : '#fffbeb', border: `1px solid ${chkRes.temRecorrenciaAtiva ? '#a7f3d0' : '#fde68a'}`, borderRadius: 8, padding: '10px 12px' }}>
                  {chkRes.temRecorrenciaAtiva ? '✅ ' : '⚠️ '}{chkRes.resumo}
                </div>
                {(chkRes.assinaturas || []).map(a => (
                  <div key={a.id} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12, color: '#475569', marginTop: 8, padding: '8px 10px', background: '#f8fafc', borderRadius: 8 }}>
                    <span style={{ fontWeight: 700, color: a.status === 'authorized' ? '#059669' : a.status === 'cancelled' ? '#dc2626' : '#b45309' }}>{a.status}</span>
                    <span>{a.reason || '—'}</span>
                    {a.valor ? <span>R$ {a.valor.toFixed(2)}</span> : null}
                    {a.frequencia ? <span>a cada {a.frequencia}</span> : null}
                    {a.proximaCobranca ? <span>próx.: {String(a.proximaCobranca).slice(0, 10)}</span> : null}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRESTAÇÃO DE CONTAS TAB — saldos da equipe + solicitações de saque (/api/saque)
// ═══════════════════════════════════════════════════════════════════════════════
function PrestacaoContasTab() {
  const [saldos, setSaldos] = React.useState([]);
  const [pendentes, setPendentes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [processando, setProcessando] = React.useState({});
  const [msg, setMsg] = React.useState(null);
  const [reembolsos, setReembolsos] = React.useState([]);
  const [hojeSexta, setHojeSexta] = React.useState(false);
  const [proximaLib, setProximaLib] = React.useState(null);
  const [pagandoTodos, setPagandoTodos] = React.useState(false);
  const [analitico, setAnalitico] = React.useState({}); // user_id -> { loading, linhas, total } (aberto)

  const fmtBRL = v => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtLib = (iso) => { if (!iso) return null; try { return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(iso)); } catch { return null; } };

  const carregarReembolsos = React.useCallback(async () => {
    const { data } = await supabase.from('reembolsos_garantia').select('*').eq('status', 'solicitado').order('solicitado_em', { ascending: true });
    setReembolsos(Array.isArray(data) ? data : []);
  }, []);

  const resolverReembolso = async (id, novoStatus) => {
    setProcessando(p => ({ ...p, [id]: true }));
    await supabase.from('reembolsos_garantia').update({ status: novoStatus, processado_em: new Date().toISOString() }).eq('id', id);
    await carregarReembolsos();
    setProcessando(p => ({ ...p, [id]: false }));
  };

  const carregar = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiCall('/api/saque?todos=1');
      const data = await res.json();
      setSaldos(Array.isArray(data.saldos) ? data.saldos : []);
      setPendentes(Array.isArray(data.pendentes) ? data.pendentes : []);
      setHojeSexta(!!data.hoje_sexta);
      setProximaLib(data.proxima_liberacao || null);
    } catch { setSaldos([]); setPendentes([]); }
    await carregarReembolsos();
    setLoading(false);
  }, [carregarReembolsos]);

  React.useEffect(() => { carregar(); }, [carregar]);

  const acao = async (id, acaoTipo) => {
    setMsg(null);
    setProcessando(p => ({ ...p, [id]: true }));
    try {
      const res = await apiCall(`/api/saque?id=${id}`, { method: 'PATCH', body: JSON.stringify({ acao: acaoTipo }) });
      const data = await res.json();
      if (res.ok) {
        setMsg({ tipo: 'ok', txt: acaoTipo === 'pagar' ? 'Saque marcado como pago.' : 'Saque recusado.' });
        await carregar();
      } else {
        setMsg({ tipo: 'erro', txt: data.error || 'Erro ao processar.' });
      }
    } catch {
      setMsg({ tipo: 'erro', txt: 'Erro ao processar.' });
    }
    setProcessando(p => ({ ...p, [id]: false }));
  };

  // Libera TODOS os saques elegíveis (sexta + até o corte de 12h) de uma vez.
  const pagarTodos = async () => {
    if (!window.confirm('Liberar TODOS os saques elegíveis desta sexta? Confirme que já fez os PIX correspondentes.')) return;
    setPagandoTodos(true); setMsg(null);
    try {
      const res = await apiCall('/api/saque', { method: 'PATCH', body: JSON.stringify({ acao: 'pagar_todos' }) });
      const data = await res.json();
      if (res.ok) { setMsg({ tipo: 'ok', txt: `${data.pagos || 0} saque(s) liberado(s).` }); await carregar(); }
      else setMsg({ tipo: 'erro', txt: data.error || 'Erro ao liberar.' });
    } catch { setMsg({ tipo: 'erro', txt: 'Erro ao liberar.' }); }
    setPagandoTodos(false);
  };

  // Abre/fecha o analítico venda→repasse de um beneficiário (para conferência).
  const verAnalitico = async (userId) => {
    if (analitico[userId]) { setAnalitico(a => { const n = { ...a }; delete n[userId]; return n; }); return; }
    setAnalitico(a => ({ ...a, [userId]: { loading: true } }));
    try {
      const res = await apiCall(`/api/saque?analitico=1&user_id=${userId}`);
      const data = await res.json();
      setAnalitico(a => ({ ...a, [userId]: { loading: false, linhas: data.linhas || [], total: data.total_repasse || 0 } }));
    } catch { setAnalitico(a => ({ ...a, [userId]: { loading: false, linhas: [], total: 0 } })); }
  };

  const S2 = {
    card: { background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '20px 24px', marginBottom: 20 },
  };
  const TIPO_LBL = { honorario_exito: 'Honorário de êxito', comissao_venda: 'Comissão de venda' };

  return (
    <div style={{ maxWidth: 980 }}>
      {msg && (
        <div style={{ background: msg.tipo === 'ok' ? '#dcfce7' : '#fee2e2', color: msg.tipo === 'ok' ? '#15803d' : '#dc2626', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontWeight: 600, marginBottom: 16 }}>
          {msg.txt}
        </div>
      )}

      {/* Reembolsos — garantia de 7 dias (CDC art. 49) */}
      <div style={{ ...S2.card, border: reembolsos.length ? '1px solid #fecaca' : '1px solid #e2e8f0' }}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 4 }}>
          Reembolsos — garantia de 7 dias {reembolsos.length > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: '#dc2626', background: '#fef2f2', borderRadius: 999, padding: '1px 8px', marginLeft: 6 }}>{reembolsos.length} pendente{reembolsos.length > 1 ? 's' : ''}</span>}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>Cliente exerceu o direito de arrependimento. Execute o estorno de 100% no painel do gateway (Mercado Pago/Asaas) e marque como estornado.</div>
        {reembolsos.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '14px 0', fontSize: 13 }}>Nenhum reembolso pendente.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {reembolsos.map(r => (
              <div key={r.id} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{r.nome || r.email || '—'} · {r.plano}{r.valor_ref ? ` · ${fmtBRL(r.valor_ref)}` : ''}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{r.email} · gateway: {r.gateway}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Solicitado em {new Date(r.solicitado_em).toLocaleString('pt-BR')}</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => resolverReembolso(r.id, 'estornado')} disabled={processando[r.id]}
                    style={{ padding: '7px 16px', background: '#059669', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    Marcar estornado
                  </button>
                  <button onClick={() => resolverReembolso(r.id, 'recusado')} disabled={processando[r.id]}
                    style={{ padding: '7px 12px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Solicitações pendentes */}
      <div style={S2.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>
            Solicitações de saque {pendentes.length > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: '#0D63DB', background: '#eff6ff', borderRadius: 999, padding: '1px 8px', marginLeft: 6 }}>{pendentes.length}</span>}
          </div>
          {(() => {
            const elegiveis = pendentes.filter(p => p.elegivel_hoje).length;
            return (
              <button onClick={pagarTodos} disabled={pagandoTodos || !hojeSexta || elegiveis === 0}
                title={!hojeSexta ? 'Só às sextas-feiras' : elegiveis === 0 ? 'Nenhum saque elegível para hoje' : `Libera ${elegiveis} saque(s)`}
                style={{ padding: '8px 18px', background: (hojeSexta && elegiveis > 0 && !pagandoTodos) ? '#059669' : '#e2e8f0', color: (hojeSexta && elegiveis > 0 && !pagandoTodos) ? 'white' : '#94a3b8', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 12, cursor: (hojeSexta && elegiveis > 0 && !pagandoTodos) ? 'pointer' : 'default' }}>
                {pagandoTodos ? 'Liberando…' : `Pagar todos${elegiveis > 0 ? ` (${elegiveis})` : ''}`}
              </button>
            );
          })()}
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
          Pagamentos são liberados às sextas (corte 12h). {proximaLib && <>Próxima liberação: <strong>{fmtLib(proximaLib)}</strong>.</>} {!hojeSexta && 'Hoje não é sexta — libere no dia do pagamento.'}
        </div>
        {loading ? (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</div>
        ) : pendentes.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '20px 0', fontSize: 14 }}>Nenhuma solicitação pendente.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {pendentes.map(p => {
              const an = analitico[p.user_id];
              return (
              <div key={p.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '14px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>
                      {p.perfis?.nome || '—'} <span style={{ fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'capitalize' }}>· {p.perfis?.role || '—'}</span>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#059669', marginTop: 2 }}>{fmtBRL(Math.abs(Number(p.valor)))}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                      PIX: {p.perfis?.chave_pix || '—'} · {new Date(p.criado_em).toLocaleString('pt-BR')}
                    </div>
                    <span style={{ display: 'inline-block', marginTop: 6, fontSize: 10.5, fontWeight: 800, borderRadius: 999, padding: '1px 8px', background: p.elegivel_hoje ? '#dcfce7' : '#fef9c3', color: p.elegivel_hoje ? '#15803d' : '#a16207' }}>
                      {p.elegivel_hoje ? 'Elegível nesta sexta' : 'Próxima sexta'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button onClick={() => verAnalitico(p.user_id)}
                      style={{ padding: '7px 14px', background: an ? '#0D63DB' : '#eff6ff', color: an ? 'white' : '#0D63DB', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      Analítico
                    </button>
                    <button onClick={() => acao(p.id, 'pagar')} disabled={processando[p.id]}
                      style={{ padding: '7px 18px', background: processando[p.id] ? '#94a3b8' : '#059669', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      Pagar
                    </button>
                    <button onClick={() => acao(p.id, 'recusar')} disabled={processando[p.id]}
                      style={{ padding: '7px 18px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                      Recusar
                    </button>
                  </div>
                </div>

                {/* Analítico venda → repasse do beneficiário */}
                {an && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #cbd5e1' }}>
                    {an.loading ? (
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>Carregando analítico…</div>
                    ) : !an.linhas?.length ? (
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>Sem créditos lançados para este beneficiário.</div>
                    ) : (
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#475569', textAlign: 'left' }}>
                              {['Data', 'Origem', 'Venda', '%', 'Repasse'].map(h => <th key={h} style={{ padding: '5px 8px', fontWeight: 700 }}>{h}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            {an.linhas.map((l, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', color: '#334155' }}>
                                <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>{new Date(l.data).toLocaleDateString('pt-BR')}</td>
                                <td style={{ padding: '5px 8px' }}>{TIPO_LBL[l.tipo] || l.tipo}{l.referencia ? ` · ${l.referencia}` : ''}</td>
                                <td style={{ padding: '5px 8px' }}>{l.venda != null ? fmtBRL(l.venda) : '—'}</td>
                                <td style={{ padding: '5px 8px' }}>{l.percentual != null ? `${Number(l.percentual).toFixed(2)}%` : '—'}</td>
                                <td style={{ padding: '5px 8px', fontWeight: 700, color: l.repasse >= 0 ? '#059669' : '#dc2626' }}>{fmtBRL(l.repasse)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr style={{ borderTop: '2px solid #e2e8f0', fontWeight: 800, color: '#111' }}>
                              <td style={{ padding: '6px 8px' }} colSpan={4}>Total de repasses (créditos)</td>
                              <td style={{ padding: '6px 8px', color: '#059669' }}>{fmtBRL(an.total)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Saldos da equipe */}
      <div style={S2.card}>
        <div style={{ fontWeight: 800, fontSize: 15, color: '#111', marginBottom: 14 }}>Saldos da equipe</div>
        {loading ? (
          <div style={{ color: '#94a3b8', fontSize: 14 }}>Carregando…</div>
        ) : saldos.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#94a3b8', padding: '20px 0', fontSize: 14 }}>Nenhum saldo registrado.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={S.table}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  {['Nome', 'Papel', 'Disponível', 'Pendente', 'Chave PIX'].map(h => (
                    <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 700, color: '#475569', fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {saldos.map(s => (
                  <tr key={s.user_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '8px 10px', color: '#111' }}>{s.nome || '—'}</td>
                    <td style={{ padding: '8px 10px', color: '#64748b', textTransform: 'capitalize' }}>{s.role || '—'}</td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#059669' }}>{fmtBRL(s.saldo_disponivel)}</td>
                    <td style={{ padding: '8px 10px', color: '#d97706' }}>{fmtBRL(s.saque_pendente)}</td>
                    <td style={{ padding: '8px 10px', color: '#64748b' }}>{s.chave_pix || '—'}</td>
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

// MARKETING TAB — inteligência de buscas, demográficos, SDR e oportunidades
// (visível APENAS para role === 'admin')
// ═══════════════════════════════════════════════════════════════════════════════
function MarketingTab() {
  const [periodo, setPeriodo] = React.useState('30d');
  const [dataInicio, setDataInicio] = React.useState('');
  const [dataFim, setDataFim] = React.useState('');

  const thirtyDaysAgo = React.useMemo(() => {
    if (periodo === 'custom' && dataInicio) return new Date(dataInicio).toISOString();
    const dias = periodo === '7d' ? 7 : periodo === '90d' ? 90 : periodo === 'ano' ? 365 : 30;
    return new Date(Date.now() - dias * 24 * 60 * 60 * 1000).toISOString();
  }, [periodo, dataInicio]);

  const dataFimISO = React.useMemo(() => {
    if (periodo === 'custom' && dataFim) return new Date(dataFim + 'T23:59:59').toISOString();
    return new Date().toISOString();
  }, [periodo, dataFim]);

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
        supabase.from('busca_historico').select('cidade').not('cidade', 'is', null).gte('criado_em', thirtyDaysAgo).lte('criado_em', dataFimISO),
        supabase.from('busca_historico').select('tipo_imovel').not('tipo_imovel', 'is', null).gte('criado_em', thirtyDaysAgo).lte('criado_em', dataFimISO),
        supabase.from('busca_historico').select('estado').not('estado', 'is', null).gte('criado_em', thirtyDaysAgo).lte('criado_em', dataFimISO),
        supabase.from('busca_historico').select('pagamento_tipos').not('pagamento_tipos', 'is', null).gte('criado_em', thirtyDaysAgo).lte('criado_em', dataFimISO),
        supabase.from('busca_historico').select('user_id, id').gte('criado_em', thirtyDaysAgo).lte('criado_em', dataFimISO),
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
  }, [thirtyDaysAgo, dataFimISO]);

  useEffect(() => { carregar(); }, [carregar]);

  function exportarCSV() {
    const d = new Date().toLocaleDateString('pt-BR');
    const linhas = [
      `Relatório de Marketing BidPro Brasil - ${d}`, '',
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
      <div style={{ fontWeight: 800, fontSize: 16, color: '#111111' }}>{title}</div>
      {sub && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{sub}</div>}
    </div>
  );

  if (loading) return <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8' }}>Carregando dados de marketing...</div>;

  const FUNNEL_STEPS = ['novo', 'contatado', 'qualificado', 'convertido'];
  const FUNNEL_COLORS = ['#0D63DB', '#7c3aed', '#d97706', '#059669'];

  const periodoLabel = { '7d': 'Últimos 7 dias', '30d': 'Últimos 30 dias', '90d': 'Últimos 90 dias', 'ano': 'Último ano', 'custom': 'Personalizado' };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111111', margin: 0 }}>Inteligência de Marketing</h2>
          <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>Painel privado — somente admin</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={S.btn('outline')} onClick={carregar}>↻ Atualizar dados</button>
          <button style={S.btn('primary')} onClick={exportarCSV}>⬇ Exportar Relatório</button>
        </div>
      </div>

      {/* Filtro de tempo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24, flexWrap: 'wrap', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginRight: 4 }}>Período:</span>
        {['7d', '30d', '90d', 'ano', 'custom'].map(p => (
          <button key={p} onClick={() => setPeriodo(p)}
            style={{ fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 20, border: '2px solid', cursor: 'pointer',
              borderColor: periodo === p ? '#0D63DB' : '#e2e8f0',
              background: periodo === p ? '#eff6ff' : 'white',
              color: periodo === p ? '#0D63DB' : '#64748b' }}>
            {periodoLabel[p]}
          </button>
        ))}
        {periodo === 'custom' && (
          <>
            <input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)}
              style={{ fontSize: 12, padding: '4px 10px', border: '2px solid #e2e8f0', borderRadius: 8, color: '#111111', outline: 'none' }} />
            <span style={{ fontSize: 12, color: '#94a3b8' }}>até</span>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              style={{ fontSize: 12, padding: '4px 10px', border: '2px solid #e2e8f0', borderRadius: 8, color: '#111111', outline: 'none' }} />
          </>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#94a3b8' }}>
          {periodo !== 'custom' ? periodoLabel[periodo] : dataInicio && dataFim ? `${dataInicio} → ${dataFim}` : 'Selecione as datas'}
        </span>
      </div>

      {/* Painel Google Ads */}
      <div style={{ ...S.card, borderRadius: 16, marginBottom: 20 }}>
        {sectionHeader('Google Ads', 'Integrações e rastreamento ativo')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
          {[
            { label: 'Tag instalada', value: 'AW-16850175262', status: true, desc: 'Ativa em todas as páginas' },
            { label: 'Conversão: Cadastro', value: 'ID 7658576772', status: true, desc: 'Conta Uma por usuário' },
            { label: 'Conversão: Plano', value: 'ID 7658576769', status: true, desc: 'Valor dinâmico por plano' },
            { label: 'Page Views', value: 'Automático', status: true, desc: 'Toda troca de rota' },
          ].map(item => (
            <div key={item.label} style={{ background: '#f8fafc', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.status ? '#10b981' : '#f59e0b', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#111111', marginBottom: 2 }}>{item.value}</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>{item.desc}</div>
            </div>
          ))}
        </div>
        <div style={{ background: '#eff6ff', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#0D63DB' }}>
          ℹ️ Status "Inativo" no Google Ads é normal até o primeiro cadastro/assinatura ser disparado. Acesse <strong>tsn-app-two.vercel.app</strong> para ativar a tag de page_view.
        </div>
      </div>

      {/* Seção 1: Buscas */}
      <div style={{ ...S.card, borderRadius: 16, marginBottom: 20 }}>
        {sectionHeader('Painel de Buscas', 'Dados dos últimos 30 dias')}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
          {[
            { label: 'Total de buscas', value: buscas.total, color: '#0D63DB' },
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
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Cidades mais buscadas</div>
            {buscas.cidades.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Sem dados</div> : buscas.cidades.map(([cidade, count]) => (
              <div key={cidade} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                  <span>{cidade}</span><span style={{ fontWeight: 700, color: '#0D63DB' }}>{count}</span>
                </div>
                <div style={{ background: '#e2e8f0', borderRadius: 4, height: 8 }}>
                  <div style={{ background: 'linear-gradient(90deg,#0D63DB,#60a5fa)', borderRadius: 4, height: 8, width: `${(count / maxBar(buscas.cidades)) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Estados mais buscados</div>
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
          <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Tipos de imóvel buscados</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {buscas.tipos.length === 0 ? <span style={{ color: '#94a3b8', fontSize: 13 }}>Sem dados</span>
              : buscas.tipos.map(([tipo, count]) => (
                <span key={tipo} style={{ padding: '4px 14px', background: '#eff6ff', color: '#084BA6', borderRadius: 999, fontWeight: 700, fontSize: 13 }}>
                  {tipo} <span style={{ color: '#0D63DB' }}>({count})</span>
                </span>
              ))}
          </div>
        </div>
        {buscas.pagamentos.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Filtros de pagamento</div>
            {(() => {
              const total = buscas.pagamentos.reduce((s, [, c]) => s + c, 0);
              return buscas.pagamentos.map(([tipo, count]) => (
                <div key={tipo} style={{ marginBottom: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span>{tipo}</span><span style={{ fontWeight: 700 }}>{count} ({total > 0 ? ((count / total) * 100).toFixed(2) : '0,00'}%)</span>
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
            { label: 'Total de usuários', value: perfisData.total, color: '#111111' },
            { label: 'Usuários ativos', value: perfisData.ativos, color: '#059669' },
            { label: 'Usuários inativos', value: perfisData.inativos, color: '#dc2626' },
            { label: 'Taxa de atividade', value: perfisData.total > 0 ? ((perfisData.ativos / perfisData.total) * 100).toFixed(2) + '%' : '—', color: '#0D63DB' },
          ].map(k => (
            <div key={k.label} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px' }}>
              <div style={kpiStyle(k.color)}>{k.value}</div>
              <div style={kpiLabel}>{k.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Usuários por plano</div>
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
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Usuários por estado</div>
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
          <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Novos usuários por semana (últimas 12 semanas)</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80 }}>
            {(() => {
              const maxV = Math.max(...perfisData.semanas.map(s => s.count), 1);
              return perfisData.semanas.map(s => (
                <div key={s.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: '#475569', fontWeight: 700 }}>{s.count > 0 ? s.count : ''}</div>
                  <div style={{ width: '100%', background: s.count > 0 ? 'linear-gradient(180deg,#0D63DB,#60a5fa)' : '#e2e8f0', borderRadius: 4, height: `${Math.max((s.count / maxV) * 56, s.count > 0 ? 8 : 4)}px` }} />
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
            { label: 'Total de leads', value: sdrData.total, color: '#111111' },
            { label: 'Convertidos', value: sdrData.convertidos, color: '#059669' },
            { label: 'Taxa de conversão', value: sdrData.total > 0 ? ((sdrData.convertidos / sdrData.total) * 100).toFixed(2) + '%' : '—', color: '#0D63DB' },
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
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Funil de leads</div>
            {FUNNEL_STEPS.map((step, i) => {
              const count = sdrData.leadsStatus[step] || 0;
              const pct = sdrData.total > 0 ? (count / sdrData.total) * 100 : 0;
              const pctLabel = pct.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
              return (
                <div key={step} style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
                    <span style={{ textTransform: 'capitalize' }}>{step}</span>
                    <span style={{ fontWeight: 700, color: FUNNEL_COLORS[i] }}>{count} ({pctLabel}%)</span>
                  </div>
                  <div style={{ background: '#e2e8f0', borderRadius: 4, height: 10 }}>
                    <div style={{ background: FUNNEL_COLORS[i], borderRadius: 4, height: 10, width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Leads por produto</div>
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
          <div style={{ fontWeight: 700, fontSize: 14, color: '#111111', marginBottom: 10 }}>Leads por semana (últimas 8 semanas)</div>
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
                      <td style={{ ...S.td, fontWeight: 700, color: '#0D63DB' }}>{o.buscas}</td>
                      <td style={{ ...S.td, color: o.imoveis === 0 ? '#dc2626' : '#111111' }}>{o.imoveis === 0 ? '0 ⚠' : o.imoveis}</td>
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
                    <td style={{ ...S.td, fontWeight: 700, color: '#0D63DB' }}>{a.total_enviados || 0}</td>
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

// ═══════════════════════════════════════════════════════════════════════════════
// CENTRAL DA EQUIPE — monitoramento do pipeline de clientes (só leitura + direciona).
// A VERDADE vive na ficha do cliente; aqui a equipe/admin vê a carteira, o
// responsável, o tempo parado (SLA) e abre a ficha p/ agir. Sem dado próprio.
// Admin vê todos; analista/advogado veem os casos em que são responsáveis.
// ═══════════════════════════════════════════════════════════════════════════════
const ETAPAS_CASO = [
  { key: 'analise',    label: 'Análise (relatórios)',     cor: '#0D63DB', bg: '#eff6ff' },
  { key: 'decisao',    label: 'Aguardando reunião/parecer', cor: '#7c3aed', bg: '#f5f3ff' },
  { key: 'juridico',   label: 'Jurídico',                 cor: '#c2410c', bg: '#fff7ed' },
  { key: 'arremate',   label: 'Arremate em andamento',    cor: '#059669', bg: '#f0fdf4' },
  { key: 'concluido',  label: 'Concluído',                cor: '#64748b', bg: '#f8fafc' },
];
function etapaDoCaso(c) {
  if (c.concluido_em) return 'concluido';
  if (c.arrematado_em) return 'arremate';
  if (c.juridico_liberado || c.juridico_enviado_em) return 'juridico';
  if (c.mercadologico_status === 'concluido') return 'decisao';
  return 'analise';
}
function CentralEquipeTab() {
  const { user, role, iniciarSuporte } = useAuth();
  const nav = useNavigate();
  const [casos, setCasos] = React.useState([]);
  const [nomes, setNomes] = React.useState({});
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    (async () => {
      setLoading(true);
      let q = supabase.from('casos').select('*').order('updated_at', { ascending: true });
      // Admin vê tudo; membro vê só os seus (defensivo — hoje o painel é admin).
      if (role === 'analista') q = q.eq('analista_id', user.id);
      else if (role === 'advogado') q = q.eq('advogado_id', user.id);
      const { data } = await q;
      const lista = data || [];
      setCasos(lista);
      const ids = [...new Set(lista.flatMap(c => [c.cliente_id, c.analista_id, c.advogado_id]).filter(Boolean))];
      if (ids.length) {
        const { data: ps } = await supabase.from('perfis').select('id,nome').in('id', ids);
        const m = {}; (ps || []).forEach(p => { m[p.id] = p.nome || p.id.slice(0, 8); });
        setNomes(m);
      }
      setLoading(false);
    })();
  }, [user?.id, role]);

  const diasDe = (ts) => ts ? Math.floor((Date.now() - new Date(ts).getTime()) / 86400000) : null;
  const abrirFicha = (c) => {
    iniciarSuporte({ id: c.cliente_id, nome: nomes[c.cliente_id] || 'Cliente', role: 'assessorado' });
    nav('/caso/' + c.id);
  };

  const porEtapa = {};
  ETAPAS_CASO.forEach(e => { porEtapa[e.key] = []; });
  casos.forEach(c => { porEtapa[etapaDoCaso(c)].push(c); });

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#111', margin: 0 }}>Central da Equipe</h2>
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>
          Pipeline dos clientes por etapa. A ação acontece na ficha do cliente — aqui você monitora e direciona.
        </p>
      </div>
      {loading ? (
        <p style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>Carregando…</p>
      ) : casos.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
          Nenhum caso em andamento. Quando um cliente contratar assessoria e iniciar um caso, ele aparece aqui.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 12, alignItems: 'start' }}>
          {ETAPAS_CASO.map(e => (
            <div key={e.key} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 800, color: e.cor }}>{e.label}</span>
                <span style={{ fontSize: 11, fontWeight: 800, color: e.cor, background: e.bg, borderRadius: 999, padding: '1px 8px' }}>{porEtapa[e.key].length}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {porEtapa[e.key].map(c => {
                  const dias = diasDe(c.updated_at);
                  const parado = e.key !== 'concluido' && dias != null && dias >= 7;
                  return (
                    <div key={c.id} onClick={() => abrirFicha(c)}
                      style={{ background: 'white', border: `1px solid ${parado ? '#fecaca' : '#e2e8f0'}`, borderRadius: 10, padding: '10px 12px', cursor: 'pointer' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{nomes[c.cliente_id] || 'Cliente'}</div>
                      <div title={c.imovel_endereco || ''} style={{ fontSize: 11, color: '#64748b', margin: '2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.imovel_endereco || 'Imóvel —'}</div>
                      <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                        {c.advogado_id ? `Adv: ${nomes[c.advogado_id] || '—'}` : c.analista_id ? `Analista: ${nomes[c.analista_id] || '—'}` : 'Sem responsável'}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: parado ? '#dc2626' : '#94a3b8' }}>
                          {parado ? `⚠ parado ${dias}d` : dias != null ? `há ${dias}d` : '—'}
                        </span>
                        <span style={{ fontSize: 10.5, fontWeight: 700, color: '#0D63DB' }}>abrir ficha →</span>
                      </div>
                    </div>
                  );
                })}
                {porEtapa[e.key].length === 0 && <div style={{ fontSize: 11, color: '#cbd5e1', textAlign: 'center', padding: '8px 0' }}>—</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RADAR DE EDITAIS (CNJ/DJEN) — editais de leilão novos × leiloeiro (ver docs/RADAR_EDITAIS_CNJ.md)
// ═══════════════════════════════════════════════════════════════════════════════
function RadarEditaisTab() {
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [dias, setDias] = React.useState(30);
  const [soNaoInt, setSoNaoInt] = React.useState(false);
  const [erro, setErro] = React.useState('');

  const carregar = React.useCallback(() => {
    setLoading(true); setErro('');
    supabase.rpc('admin_radar_editais', { p_dias: dias, p_so_nao_integrado: soNaoInt })
      .then(({ data, error }) => { if (error) setErro(error.message); else setData(data); })
      .catch(e => setErro(String(e.message)))
      .finally(() => setLoading(false));
  }, [dias, soNaoInt]);
  React.useEffect(() => { carregar(); }, [carregar]);

  const k = data?.kpis || {};
  const editais = data?.editais || [];
  const brl = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR') : '—';
  const dt = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';

  return (
    <div style={{ maxWidth: 1100 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, flexWrap:'wrap', gap:8 }}>
        <div>
          <h2 style={{ margin:0, fontSize:18 }}>📜 Radar de Editais (CNJ)</h2>
          <div style={{ fontSize:12, color:'#64748b' }}>Editais de leilão (TJSP/TRT-15) via DJEN — edital novo × leiloeiro.</div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select value={dias} onChange={e=>setDias(Number(e.target.value))} style={{ padding:'6px 8px', borderRadius:8, border:'1px solid #e2e8f0' }}>
            <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option>
          </select>
          <label style={{ fontSize:12, display:'flex', gap:4, alignItems:'center' }}>
            <input type="checkbox" checked={soNaoInt} onChange={e=>setSoNaoInt(e.target.checked)} /> só não integrados
          </label>
          <button onClick={carregar} style={{ padding:'6px 10px', borderRadius:8, border:'1px solid #e2e8f0', background:'white', cursor:'pointer' }}>↻</button>
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:10, marginBottom:16 }}>
        {[
          { l:'Editais', v:k.total ?? '—', c:'#0D63DB' },
          { l:'Novos (7d)', v:k.novos_7d ?? '—', c:'#059669' },
          { l:'Leiloeiros', v:k.leiloeiros_distintos ?? '—', c:'#475569' },
          { l:'A integrar', v:k.nao_integrados ?? '—', c:'#d97706' },
          { l:'Já no acervo', v:k.ja_no_acervo ?? '—', c:'#059669' },
          { l:'Erro parse', v:k.erro_parse ?? '—', c:(k.erro_parse>0?'#dc2626':'#94a3b8') },
        ].map(x=>(
          <div key={x.l} style={{ background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'12px 14px' }}>
            <div style={{ fontSize:20, fontWeight:900, color:x.c }}>{x.v}</div>
            <div style={{ fontSize:11, color:'#64748b' }}>{x.l}</div>
          </div>
        ))}
      </div>

      {erro && <div style={{ background:'#fef2f2', color:'#b91c1c', padding:10, borderRadius:8, marginBottom:12, fontSize:13 }}>Erro: {erro}</div>}
      {loading ? <div style={{ color:'#64748b' }}>Carregando…</div> :
       editais.length === 0 ? (
        <div style={{ background:'#f8fafc', border:'1px dashed #cbd5e1', borderRadius:12, padding:24, textAlign:'center', color:'#64748b', fontSize:13 }}>
          Nenhum edital ainda. O cron <code>radar-editais-cron</code> roda a cada 4h, mas só trabalha
          até obter um pull bem-sucedido do DJEN no dia (se o DJEN cair, tenta de novo automaticamente).
          <br/>Validar o 1º run em produção (o proxy de dev bloqueia <code>pje.jus.br</code>).
        </div>
       ) : (
        <div style={{ overflowX:'auto', border:'1px solid #e2e8f0', borderRadius:12 }}>
          <table style={{ borderCollapse:'collapse', width:'100%', fontSize:12 }}>
            <thead><tr style={{ background:'#f8fafc' }}>
              {['Data','Comarca','Leiloeiro','Processo','1ª praça','Avaliação','Lance mín.','',''].map((h,i)=>(
                <th key={i} style={{ padding:'8px 10px', fontWeight:700, color:'#475569', borderBottom:'1px solid #e2e8f0', whiteSpace:'nowrap', textAlign:'left' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {editais.map(e=>(
                <tr key={e.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{dt(e.data_disponibilizacao)}</td>
                  <td title={e.orgao || e.comarca || ''} style={{ padding:'8px 10px', maxWidth:170, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.orgao || e.comarca || '—'}</td>
                  <td style={{ padding:'8px 10px' }}>
                    {e.leiloeiro_nome || <span style={{ color:'#94a3b8' }}>—</span>}{' '}
                    {e.leiloeiro_nome && (e.leiloeiro_integrado
                      ? <span style={{ fontSize:10, background:'#dcfce7', color:'#166534', padding:'1px 6px', borderRadius:6 }}>integrado</span>
                      : <span style={{ fontSize:10, background:'#fef3c7', color:'#92400e', padding:'1px 6px', borderRadius:6 }}>integrar</span>)}
                  </td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{e.numero_processo || '—'}</td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{dt(e.data_praca_1)}</td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{brl(e.valor_avaliacao)}</td>
                  <td style={{ padding:'8px 10px', whiteSpace:'nowrap' }}>{brl(e.lance_minimo)}</td>
                  <td style={{ padding:'8px 10px' }}>{e.status === 'erro_parse' ? '⚠' : '✓'}</td>
                  <td style={{ padding:'8px 10px' }}>{e.leilao_plataforma_url && <a href={e.leilao_plataforma_url} target="_blank" rel="noreferrer">abrir</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
       )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// QUALIDADE — invariantes de funcionalidade (Camada 1 do "bug bounty" de features)
// ═══════════════════════════════════════════════════════════════════════════════
function QualidadeTab() {
  const [inv, setInv] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [erro, setErro] = React.useState('');
  const carregar = React.useCallback(() => {
    setLoading(true); setErro('');
    supabase.rpc('admin_qa_invariantes')
      .then(({ data, error }) => { if (error) setErro(error.message); else setInv(data || []); })
      .catch(e => setErro(String(e.message))).finally(() => setLoading(false));
  }, []);
  React.useEffect(() => { carregar(); }, [carregar]);
  const alertas = (inv || []).filter(i => i.status === 'alerta');
  return (
    <div style={{ maxWidth: 920 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12, gap:8, flexWrap:'wrap' }}>
        <div>
          <h2 style={{ margin:0, fontSize:18 }}>✅ Qualidade — invariantes de funcionalidade</h2>
          <div style={{ fontSize:12, color:'#64748b' }}>"Bug bounty" de features: cada linha é uma asserção com limite calibrado. Regressão dispara alerta no monitor diário.</div>
        </div>
        <button onClick={carregar} style={{ padding:'6px 10px', borderRadius:8, border:'1px solid #e2e8f0', background:'white', cursor:'pointer' }}>↻</button>
      </div>
      {erro && <div style={{ background:'#fef2f2', color:'#b91c1c', padding:10, borderRadius:8, marginBottom:12, fontSize:13 }}>Erro: {erro}</div>}
      <div style={{ marginBottom:12, fontSize:14, fontWeight:800, color: alertas.length ? '#b91c1c' : '#059669' }}>
        {loading ? 'Carregando…' : alertas.length ? `⚠ ${alertas.length} invariante(s) em ALERTA` : '✓ Tudo dentro do limite'}
      </div>
      {!loading && (
        <div style={{ overflowX:'auto', border:'1px solid #e2e8f0', borderRadius:12 }}>
          <table style={{ borderCollapse:'collapse', width:'100%', fontSize:12 }}>
            <thead><tr style={{ background:'#f8fafc' }}>
              {['','Invariante','Categoria','Tipo','Valor','Limite'].map((h,i)=>(
                <th key={i} style={{ padding:'8px 10px', textAlign:'left', fontWeight:700, color:'#475569', borderBottom:'1px solid #e2e8f0' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {(inv || []).map(i=>(
                <tr key={i.chave} style={{ borderBottom:'1px solid #f1f5f9', background: i.status==='alerta' ? '#fef2f2' : 'white' }}>
                  <td style={{ padding:'8px 10px' }}>{i.status==='alerta' ? '⚠' : '✓'}</td>
                  <td style={{ padding:'8px 10px' }}>{i.titulo}</td>
                  <td style={{ padding:'8px 10px', color:'#64748b' }}>{i.categoria}</td>
                  <td style={{ padding:'8px 10px' }}><span style={{ fontSize:10, background: i.gravidade==='bug'?'#fee2e2':'#fef3c7', color: i.gravidade==='bug'?'#991b1b':'#92400e', padding:'1px 6px', borderRadius:6 }}>{i.gravidade}</span></td>
                  <td style={{ padding:'8px 10px', fontWeight:800 }}>{i.valor}</td>
                  <td style={{ padding:'8px 10px', color:'#94a3b8' }}>{i.limite}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Menus agrupados por área — navegação mais fácil que a lista corrida de abas.
// FONTE ÚNICA das abas: os botões, o tab default e o render saem daqui (não há mais
// lista `TABS` paralela p/ dessincronizar). `flatMap` dá o conjunto plano quando preciso.
const GRUPOS_ADMIN = [
  { nome: 'Início',              tabs: ['Dashboard'] },
  { nome: 'Clientes & Vendas',   tabs: ['Usuários', 'Convites', 'Comercial', 'Contratos'] },
  { nome: 'Conteúdo & Ofertas',  tabs: ['Cursos', 'eBooks', 'Promoções', 'Marketing'] },
  { nome: 'Equipe',              tabs: ['Central da Equipe', 'Equipe', 'Agenda'] },
  { nome: 'Dados & Fontes',      tabs: ['Scrapers', 'Registros', 'CNJ', 'Editais', 'Qualidade'] },
  { nome: 'Financeiro',          tabs: ['Financeiro', 'Prestação de contas'] },
  { nome: 'Sistema',             tabs: ['Configurações'] },
];

// Rótulos amigáveis das abas — a CHAVE interna (usada em tab===..., sessionStorage) NÃO muda,
// só o texto do botão. "Scrapers" vira "Operação de Coleta" (reposicionamento pedido).
const ROTULO_TAB = {
  Scrapers: '📡 Operação de Coleta',
  CNJ: '⚖️ CNJ',
  Registros: '🗂️ Registros',
  Editais: '📜 Radar de Editais',
  Qualidade: '✅ Qualidade',
  Marketing: '📣 Marketing',
};

// ═══════════════════════════════════════════════════════════════════════════════
// AGENDA TAB — Disponibilidade dos analistas e geração de slots
// ═══════════════════════════════════════════════════════════════════════════════
const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function AgendaTab() {
  const { user } = useAuth();
  const [analistas, setAnalistas] = React.useState([]);
  const [analistaSel, setAnalistaSel] = React.useState('');
  const [disps, setDisps] = React.useState([]);
  const [slots, setSlots] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [salvando, setSalvando] = React.useState(false);
  const [gerando, setGerando] = React.useState(false);
  const [msg, setMsg] = React.useState('');
  const [novaDisp, setNovaDisp] = React.useState({ dia_semana: 1, hora_inicio: '09:00', hora_fim: '12:00' });

  React.useEffect(() => {
    supabase.from('perfis').select('id,nome').in('role', ['analista','admin']).order('nome')
      .then(({ data }) => { setAnalistas(data || []); if (data?.length) setAnalistaSel(data[0].id); });
  }, []);

  React.useEffect(() => {
    if (!analistaSel) return;
    setLoading(true);
    Promise.all([
      supabase.from('disponibilidade_analista').select('*').eq('analista_id', analistaSel).order('dia_semana').order('hora_inicio'),
      supabase.from('slots_reuniao').select('id,data_hora,disponivel,reservado_por').eq('analista_id', analistaSel)
        .gte('data_hora', new Date().toISOString()).order('data_hora').limit(50),
    ]).then(([d, s]) => { setDisps(d.data || []); setSlots(s.data || []); setLoading(false); });
  }, [analistaSel]);

  async function adicionarDisp() {
    setSalvando(true); setMsg('');
    // insert().select() devolve a linha criada → anexa ao estado (sem refazer o SELECT completo).
    const { data: nova, error } = await supabase.from('disponibilidade_analista')
      .insert({ analista_id: analistaSel, ...novaDisp }).select().single();
    if (error) setMsg('Erro: ' + error.message);
    else {
      setMsg('✅ Disponibilidade adicionada');
      setDisps(p => [...p, nova].sort((a, b) =>
        a.dia_semana - b.dia_semana || String(a.hora_inicio).localeCompare(String(b.hora_inicio))));
    }
    setSalvando(false);
  }

  async function removerDisp(id) {
    if (!window.confirm('Remover esta disponibilidade?')) return;
    await supabase.from('disponibilidade_analista').delete().eq('id', id);
    setDisps(p => p.filter(d => d.id !== id));
  }

  async function gerarSlots() {
    setGerando(true); setMsg('');
    try {
      const res = await apiCall('/api/gerar-slots', { method: 'POST' });
      const data = await res.json();
      setMsg(`✅ ${data.gerados} slots gerados`);
      const { data: s } = await supabase.from('slots_reuniao').select('id,data_hora,disponivel,reservado_por')
        .eq('analista_id', analistaSel).gte('data_hora', new Date().toISOString()).order('data_hora').limit(50);
      setSlots(s || []);
    } catch { setMsg('Erro ao gerar slots'); }
    setGerando(false);
  }

  const fmtSlot = (iso) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <div style={{ padding: '0 4px' }}>
      <h2 style={{ fontWeight: 800, fontSize: 18, marginBottom: 20 }}>Agenda de Reuniões</h2>

      {/* Seletor de analista */}
      <div style={{ marginBottom: 20 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>Analista</label>
        <select value={analistaSel} onChange={e => setAnalistaSel(e.target.value)}
          style={{ padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 14, width: 280 }}>
          {analistas.map(a => <option key={a.id} value={a.id}>{a.nome}</option>)}
        </select>
      </div>

      {loading ? <div style={{ color: '#94a3b8' }}>Carregando...</div> : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Disponibilidade semanal */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Disponibilidade semanal</div>
            {disps.length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Nenhuma disponibilidade cadastrada.</div>}
            {disps.map(d => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: d.ativo ? '#f0fdf4' : '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 6, fontSize: 13 }}>
                <span style={{ fontWeight: 700, minWidth: 60 }}>{DIAS_SEMANA[d.dia_semana]}</span>
                <span style={{ color: '#475569' }}>{d.hora_inicio.slice(0,5)} – {d.hora_fim.slice(0,5)}</span>
                <button onClick={() => removerDisp(d.id)}
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>Remover</button>
              </div>
            ))}

            {/* Adicionar nova disponibilidade */}
            <div style={{ marginTop: 16, padding: '14px', background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Adicionar horário</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Dia</label>
                  <select value={novaDisp.dia_semana} onChange={e => setNovaDisp(p => ({ ...p, dia_semana: Number(e.target.value) }))}
                    style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13 }}>
                    {DIAS_SEMANA.map((d, i) => <option key={i} value={i}>{d}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Início</label>
                  <input type="time" value={novaDisp.hora_inicio} onChange={e => setNovaDisp(p => ({ ...p, hora_inicio: e.target.value }))}
                    style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Fim</label>
                  <input type="time" value={novaDisp.hora_fim} onChange={e => setNovaDisp(p => ({ ...p, hora_fim: e.target.value }))}
                    style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 7, fontSize: 13 }} />
                </div>
                <button onClick={adicionarDisp} disabled={salvando}
                  style={{ padding: '7px 16px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  {salvando ? '...' : '+ Adicionar'}
                </button>
              </div>
            </div>

            <button onClick={gerarSlots} disabled={gerando}
              style={{ marginTop: 14, width: '100%', padding: '10px', background: '#059669', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {gerando ? 'Gerando...' : '⚡ Gerar slots para próximas 3 semanas'}
            </button>

            {msg && <div style={{ marginTop: 10, fontSize: 13, color: msg.startsWith('✅') ? '#059669' : '#dc2626' }}>{msg}</div>}
          </div>

          {/* Slots gerados */}
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Próximos slots ({slots.length})</div>
            <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {slots.length === 0 && <div style={{ fontSize: 13, color: '#94a3b8' }}>Nenhum slot gerado ainda.</div>}
              {slots.map(s => (
                <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 12px', background: s.disponivel ? '#f0fdf4' : '#fef2f2', border: `1px solid ${s.disponivel ? '#bbf7d0' : '#fecaca'}`, borderRadius: 8, fontSize: 12 }}>
                  <span style={{ fontWeight: 600 }}>{fmtSlot(s.data_hora)}</span>
                  <span style={{ marginLeft: 'auto', fontWeight: 700, color: s.disponivel ? '#059669' : '#dc2626' }}>
                    {s.disponivel ? 'Livre' : 'Reservado'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

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
                      <div style={{ fontWeight: 700, fontSize: 14, color: '#111111' }}>
                        {sol?.imovel_nome || 'Imóvel sem nome'}{sol?.imovel_cidade ? ` — ${sol.imovel_cidade}` : ''}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        {cliente?.nome || '—'} · {cliente?.email || '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: '#eff6ff', color: '#084BA6' }}>{tipoLabel}</span>
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
  const [chat, setChat] = React.useState([]);
  const [pergunta, setPergunta] = React.useState('');
  const [perguntando, setPerguntando] = React.useState(false);
  const [gerarRelatorio, setGerarRelatorio] = React.useState(false);
  const [modalConv, setModalConv] = React.useState(false);
  const [filtroConv, setFiltroConv] = React.useState({ tipo: 'ultimos', valor: '10', chamado_id: '' });
  const [contextoConv, setContextoConv] = React.useState(null);
  const [resultadoCnj, setResultadoCnj] = React.useState(null);
  const chatRef = React.useRef(null);

  // Detecta se a mensagem é uma busca CNJ
  function detectarCNJ(texto) {
    const num = texto.match(/\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/);
    const ufMatch = texto.match(/\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/i);
    // Busca nacional por padrão (cobre todos os TJs/TRFs + superiores).
    if (num) return { numero_processo: num[0], uf: ufMatch ? ufMatch[1].toUpperCase() : undefined, nacional: true };
    const parteMatch = texto.match(/(?:nome(?:\s+da\s+parte)?|parte|devedor|propriet[aá]rio)[:\s]+([^,\n]+)/i);
    if (parteMatch) return { nome_parte: parteMatch[1].trim(), uf: ufMatch ? ufMatch[1].toUpperCase() : undefined, nacional: true };
    return null;
  }

  const [monitorando, setMonitorando] = React.useState({});
  async function monitorar(proc) {
    const id = proc.numero;
    setMonitorando(p => ({ ...p, [id]: 'loading' }));
    try {
      const r = await apiCall('/api/monitorar-processo', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero_processo: proc.numero, uf: (proc.tribunal || '').replace(/^TJ|^TRF\d?/, '') || undefined, rotulo: proc.classe || proc.assuntos || '' }) });
      setMonitorando(p => ({ ...p, [id]: r.ok ? 'ok' : 'erro' }));
    } catch { setMonitorando(p => ({ ...p, [id]: 'erro' })); }
  }

  async function aplicarContextoConv() {
    let filtro = {};
    if (filtroConv.tipo === 'chamado') filtro = { chamado_id: filtroConv.chamado_id };
    else if (filtroConv.tipo === 'usuario') filtro = { usuario_id: filtroConv.valor };
    else filtro = { ultimos_n: Number(filtroConv.valor) || 10 };
    setContextoConv(filtro);
    setModalConv(false);
  }

  async function enviarPergunta() {
    if (!pergunta.trim()) return;
    const texto = pergunta.trim();
    const novaMensagem = { role: 'user', content: texto };
    setChat(prev => [...prev, novaMensagem]);
    setPergunta('');
    setPerguntando(true);

    let cnj = resultadoCnj;

    // Tenta busca automática no CNJ se a mensagem contiver número ou nome de parte
    const params = detectarCNJ(texto);
    if (params) {
      setChat(prev => [...prev, { role: 'assistant', content: `🔍 Consultando DataJud com os dados encontrados na sua pergunta...` }]);
      try {
        const r = await apiCall('/api/cnj-datajud', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) });
        const data = await r.json();
        if (r.ok) {
          cnj = data;
          setResultadoCnj(data);
          const n = data.processos?.length || 0;
          setChat(prev => {
            const sem = prev.filter(m => !m.content.startsWith('🔍'));
            return [...sem, { role: 'assistant', content: `📋 Encontrei ${n} processo${n !== 1 ? 's' : ''} no DataJud. ${data.parecer?.texto || ''}` }];
          });
        }
      } catch (_) {}
    }

    try {
      const r = await apiCall('/api/admin-chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mensagem: texto,
          historico: chat.filter(m => !m.content.startsWith('🔍') && !m.content.startsWith('📋')),
          contexto_cnj: cnj || undefined,
          filtro_chamados: contextoConv || undefined,
          gerar_relatorio: gerarRelatorio,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Erro');
      setChat(prev => {
        const sem = prev.filter(m => !m.content.startsWith('🔍') && !m.content.startsWith('📋'));
        return [...sem, { role: 'user', content: texto }, { role: 'assistant', content: data.resposta }];
      });
      if (gerarRelatorio) setGerarRelatorio(false);
    } catch (e) {
      setChat(prev => [...prev, { role: 'assistant', content: `Erro: ${e.message}` }]);
    } finally {
      setPerguntando(false);
      setTimeout(() => chatRef.current?.scrollTo({ top: 9999, behavior: 'smooth' }), 100);
    }
  }

  function imprimirRelatorio() {
    const w = window.open('', '_blank');
    // Escapa HTML antes do document.write: about:blank herda a origem do app,
    // então conteúdo de chat não sanitizado seria DOM-XSS (o auto-escape do React
    // não cobre document.write).
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    w.document.write(`<html><head><title>Relatório — ${new Date().toLocaleDateString('pt-BR')}</title><style>body{font-family:sans-serif;padding:32px;color:#111111;max-width:800px;margin:0 auto}.user{background:#eff6ff;padding:12px;border-radius:8px;margin:8px 0}.assistant{background:#f8fafc;padding:12px;border-radius:8px;margin:8px 0}</style></head><body>`);
    w.document.write(`<h1>Relatório Administrativo — ${new Date().toLocaleString('pt-BR')}</h1>`);
    chat.forEach(m => w.document.write(`<div class="${m.role === 'user' ? 'user' : 'assistant'}"><strong>${m.role === 'user' ? 'Admin' : 'Assistente'}:</strong><br>${esc(m.content).replace(/\n/g, '<br>')}</div>`));
    w.document.write('</body></html>'); w.document.close(); w.print();
  }

  return (
    <div style={{ padding: '24px 0', height: 'calc(100vh - 200px)', minHeight: 500, display: 'flex', flexDirection: 'column' }}>
      <div style={{ background: 'white', borderRadius: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', flex: 1 }}>

        {/* Header */}
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#111111' }}>🧠 Inteligência Admin</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>CNJ DataJud · Atendimentos de usuários · Análises gerenciais</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {chat.length > 0 && <button onClick={imprimirRelatorio} style={{ padding: '6px 12px', background: '#f1f5f9', border: 'none', borderRadius: 7, fontSize: 12, color: '#475569', cursor: 'pointer', fontWeight: 600 }}>📄 Exportar</button>}
            {chat.length > 0 && <button onClick={() => { setChat([]); setResultadoCnj(null); }} style={{ padding: '6px 12px', background: '#f1f5f9', border: 'none', borderRadius: 7, fontSize: 12, color: '#94a3b8', cursor: 'pointer' }}>Limpar</button>}
          </div>
        </div>

        {/* Chips de contexto + carregar conversas */}
        <div style={{ padding: '10px 20px', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0, borderBottom: '1px solid #f8fafc', alignItems: 'center' }}>
          {resultadoCnj && (
            <span style={{ fontSize: 11, background: '#eff6ff', color: '#0D63DB', padding: '3px 10px', borderRadius: 99, fontWeight: 600, cursor: 'pointer' }} onClick={() => setResultadoCnj(null)}>
              📋 CNJ: {resultadoCnj.processos?.length || 0} processo(s) ✕
            </span>
          )}
          {contextoConv && (
            <span style={{ fontSize: 11, background: '#f0fdf4', color: '#16a34a', padding: '3px 10px', borderRadius: 99, fontWeight: 600, cursor: 'pointer' }} onClick={() => setContextoConv(null)}>
              💬 Atendimentos carregados ✕
            </span>
          )}
          <button onClick={() => setModalConv(true)} style={{ fontSize: 11, background: 'none', border: '1px dashed #cbd5e1', color: '#64748b', padding: '3px 10px', borderRadius: 99, cursor: 'pointer', fontWeight: 600 }}>
            + Carregar conversas de usuários
          </button>
          <span style={{ fontSize: 11, color: '#cbd5e1' }}>|</span>
          <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>Dica: cole o número do processo ou escreva "nome da parte: João Silva" (busca nacional)</span>
        </div>

        {/* Processos encontrados — com opção de monitorar (cron diário avisa novidades) */}
        {resultadoCnj?.processos?.length > 0 && (
          <div style={{ padding: '8px 20px 0', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto', flexShrink: 0 }}>
            {resultadoCnj.processos.slice(0, 10).map(proc => {
              const st = monitorando[proc.numero];
              return (
                <div key={proc.numero} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, background: proc.tem_bloqueante ? '#fef2f2' : '#f8fafc', border: '1px solid #eef2f7', borderRadius: 8, padding: '6px 10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontWeight: 700, color: '#111111' }}>{proc.numero}</span> <span style={{ color: '#94a3b8' }}>· {proc.tribunal} · {proc.classe || '—'}</span>
                    {proc.tem_suspensiva && <span style={{ color: '#b91c1c', fontWeight: 700 }}> · ⚠️ risco de suspensão</span>}
                  </div>
                  <button onClick={() => monitorar(proc)} disabled={st === 'loading' || st === 'ok'}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 7, border: 'none', cursor: st === 'ok' ? 'default' : 'pointer', fontWeight: 700, background: st === 'ok' ? '#dcfce7' : '#0D63DB', color: st === 'ok' ? '#15803d' : 'white', whiteSpace: 'nowrap' }}>
                    {st === 'ok' ? '🔔 Monitorando' : st === 'loading' ? '…' : st === 'erro' ? 'Erro — tentar' : '🔔 Monitorar'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Mensagens */}
        <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {chat.length === 0 && (
            <div style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', padding: '60px 20px', lineHeight: 1.8 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>🧠</div>
              <div style={{ fontWeight: 700, color: '#475569', marginBottom: 8 }}>Como posso ajudar?</div>
              <div style={{ maxWidth: 480, margin: '0 auto', fontSize: 13 }}>
                Pergunte sobre processos judiciais, usuários da plataforma, análises gerenciais ou qualquer dado do sistema.<br/><br/>
                <strong>Exemplos:</strong><br/>
                "Qual a situação do processo 1234567-89.2023.8.05.0001?"<br/>
                "Nome da parte: Maria Santos, BA — há penhora?"<br/>
                "Quais os últimos 10 atendimentos de suporte?"<br/>
                "Gere um relatório dos usuários inadimplentes"
              </div>
            </div>
          )}
          {chat.map((m, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div style={{ maxWidth: '80%', padding: '12px 16px', borderRadius: 14, background: m.role === 'user' ? '#0D63DB' : m.content.startsWith('📋') || m.content.startsWith('🔍') ? '#f0fdf4' : '#f8fafc', color: m.role === 'user' ? 'white' : '#111111', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap', border: m.role === 'user' ? 'none' : `1px solid ${m.content.startsWith('📋') || m.content.startsWith('🔍') ? '#bbf7d0' : '#e2e8f0'}` }}>
                {m.content}
              </div>
            </div>
          ))}
          {perguntando && (
            <div style={{ display: 'flex' }}>
              <div style={{ padding: '12px 16px', borderRadius: 14, background: '#f8fafc', color: '#94a3b8', fontSize: 14, border: '1px solid #e2e8f0' }}>Analisando...</div>
            </div>
          )}
        </div>

        {/* Input */}
        <div style={{ padding: '12px 20px 16px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, fontSize: 12, color: '#64748b', cursor: 'pointer' }}>
            <input type="checkbox" checked={gerarRelatorio} onChange={e => setGerarRelatorio(e.target.checked)} style={{ accentColor: '#0D63DB' }} />
            Gerar relatório formal estruturado
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <textarea value={pergunta} onChange={e => setPergunta(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), enviarPergunta())}
              placeholder="Digite sua pergunta... ou cole um número de processo para busca automática no CNJ"
              rows={2}
              style={{ flex: 1, padding: '10px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} />
            <button onClick={enviarPergunta} disabled={perguntando || !pergunta.trim()}
              style={{ padding: '10px 20px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 16, cursor: 'pointer', opacity: (perguntando || !pergunta.trim()) ? 0.5 : 1, alignSelf: 'flex-end' }}>
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* Modal carregar conversas */}
      {modalConv && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div style={{ background: 'white', borderRadius: 16, padding: 28, width: '100%', maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Carregar conversas de usuários</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                { tipo: 'ultimos', label: 'Últimos atendimentos' },
                { tipo: 'chamado', label: 'Chamado específico (ID)' },
                { tipo: 'usuario', label: 'Usuário específico (ID)' },
              ].map(({ tipo, label }) => (
                <label key={tipo} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, cursor: 'pointer' }}>
                  <input type="radio" name="tipo" value={tipo} checked={filtroConv.tipo === tipo} onChange={() => setFiltroConv(p => ({ ...p, tipo }))} />
                  {label}
                  {filtroConv.tipo === tipo && tipo === 'ultimos' && (
                    <input type="number" value={filtroConv.valor} onChange={e => setFiltroConv(p => ({ ...p, valor: e.target.value }))} min={1} max={20}
                      style={{ width: 60, padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }} />
                  )}
                  {filtroConv.tipo === tipo && tipo !== 'ultimos' && (
                    <input value={filtroConv.tipo === 'chamado' ? filtroConv.chamado_id : filtroConv.valor}
                      onChange={e => setFiltroConv(p => tipo === 'chamado' ? { ...p, chamado_id: e.target.value } : { ...p, valor: e.target.value })}
                      placeholder="UUID" style={{ flex: 1, padding: '4px 8px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12 }} />
                  )}
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
              <button onClick={() => setModalConv(false)} style={{ flex: 1, padding: 10, background: '#f1f5f9', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 600, color: '#475569' }}>Cancelar</button>
              <button onClick={aplicarContextoConv} style={{ flex: 2, padding: 10, background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700 }}>Aplicar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ROLES_SIMULAVEIS = [
  { key: 'explorador', label: '🔍 Explorador',      cor: '#64748b' },
  { key: 'top2',       label: '💎 Investidor Pro',   cor: '#0D63DB' },
  { key: 'assessorado',label: '🏠 Assessorado',      cor: '#d97706' },
  { key: 'clube',      label: '⭐ Leilão Club',      cor: '#6366f1' },
  { key: 'analista',   label: '🔍 Analista',         cor: '#f59e0b' },
  { key: 'advogado',   label: '⚖️ Advogado',         cor: '#7c3aed' },
  { key: 'consultor',  label: '🤝 Consultor',        cor: '#059669' },
  { key: 'leiloeiro',  label: '🔨 Leiloeiro',        cor: '#ea580c' },
];

export default function Admin() {
  const { role, loading, simularRole, roleSimulado } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState(() => sessionStorage.getItem('admin_tab') || 'Dashboard');
  const mudarTab = (t) => { setTab(t); sessionStorage.setItem('admin_tab', t); };

  if (loading) {
    return <div style={{ ...S.page, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><p style={{ color: '#64748b' }}>Carregando...</p></div>;
  }

  if (role !== 'admin') {
    return (
      <div style={S.page}>
        <div style={S.accessDenied}>
          <p style={{ fontSize: 48 }}>🔒</p>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111111' }}>Acesso restrito</h2>
          <p style={{ color: '#64748b' }}>Você não tem permissão para acessar esta área.</p>
          <button style={S.btn('primary')} onClick={() => navigate('/')}>Voltar ao início</button>
        </div>
      </div>
    );
  }

  return (
    <div style={S.page}>
      <div style={S.header}>
        <span style={S.headerTitle}>BidPro Brasil — Painel Administrativo</span>
        <button style={{ ...S.btn('outline'), background: 'transparent', color: '#94a3b8', border: '1px solid #334155', fontSize: 13 }} onClick={() => navigate('/buscar')}>
          ← Voltar ao app
        </button>
      </div>

      {/* Simulador de Role */}
      <div style={{ background: '#1e1b4b', padding: '10px 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid #312e81' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 1 }}>🎭 Simular como:</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ROLES_SIMULAVEIS.map(r => (
            <button key={r.key} onClick={() => simularRole(roleSimulado === r.key ? null : r.key)}
              style={{ padding: '4px 12px', borderRadius: 20, border: 'none', fontWeight: 700, fontSize: 11, cursor: 'pointer', background: roleSimulado === r.key ? r.cor : 'rgba(255,255,255,0.08)', color: roleSimulado === r.key ? 'white' : '#94a3b8', transition: 'all 0.15s' }}>
              {r.label}
            </button>
          ))}
          {roleSimulado && (
            <button onClick={() => simularRole(null)}
              style={{ padding: '4px 12px', borderRadius: 20, border: '1px solid rgba(255,100,100,0.4)', background: 'rgba(220,38,38,0.15)', color: '#fca5a5', fontWeight: 700, fontSize: 11, cursor: 'pointer' }}>
              ✕ Sair da simulação
            </button>
          )}
        </div>
        <span style={{ fontSize: 11, color: '#475569', marginLeft: 'auto' }}>Só muda a visualização — dados reais não são alterados</span>
      </div>

      <div style={S.body}>
        <div style={{ ...S.tabs, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'stretch' }}>
          {GRUPOS_ADMIN.map(g => (
            <div key={g.nome} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, width: 130, flexShrink: 0 }}>{g.nome}</span>
              {g.tabs.map(t => (
                <button key={t} style={S.tab(tab === t)} onClick={() => mudarTab(t)}>{ROTULO_TAB[t] || t}</button>
              ))}
            </div>
          ))}
        </div>

        {tab === 'Dashboard'      && <DashboardTab />}
        {tab === 'Cursos'         && <CursosTab />}
        {tab === 'eBooks'         && <EbooksTab />}
        {tab === 'Contratos'      && <ContratosTab />}
        {tab === 'Promoções'      && <PromoTab />}
        {tab === 'Convites'       && <ConvitesTab />}
        {tab === 'Usuários'       && <UsuariosTab />}
        {tab === 'Comercial'      && <ComercialTab />}
        {tab === 'Equipe'         && <EquipeTab />}
        {tab === 'Agenda'         && <AgendaTab />}
        {tab === 'Scrapers'       && <ScrapersTab />}
        {tab === 'Registros'      && <RegistrosTab />}
        {tab === 'CNJ'            && <CnjTab />}
        {tab === 'Editais'        && <RadarEditaisTab />}
        {tab === 'Qualidade'      && <QualidadeTab />}
        {tab === 'Configurações'  && <ConfigTab />}
        {tab === 'Financeiro'     && <FinanceiroTab />}
        {tab === 'Central da Equipe' && <CentralEquipeTab />}
        {tab === 'Prestação de contas' && <PrestacaoContasTab />}
        {tab === 'Marketing'      && <MarketingTab />}
      </div>
    </div>
  );
}
