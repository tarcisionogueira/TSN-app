import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Calendar, Tag, Building2, FileText, ExternalLink, BarChart2, AlertTriangle, CheckCircle, Clock, Home, Banknote } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

const TIPO_LABEL = { casa:'Casa', apartamento:'Apartamento', terreno:'Terreno/Lote', comercial:'Comercial', rural:'Rural', galpao:'Galpão', sala:'Sala Comercial', vaga:'Vaga de Garagem', imovel:'Imóvel' };
const MODAL_LABEL = { primeiro_leilao:'1ª Praça', segundo_leilao:'2ª Praça', venda_direta:'Venda Direta', licitacao_aberta:'Licitação Aberta', extrajudicial:'Extrajudicial', judicial:'Judicial' };
const fmtBRL = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';

function fmtData(d, modalidade) {
  if (!d) return modalidade === 'venda_direta' ? 'Venda Direta' : 'Sem data definida';
  const dt = new Date(d);
  return dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

const PLANOS_ANALISE = ['top1','top2','assessorado','clube','analista','admin'];
const EQUIPE = ['admin', 'analista', 'advogado', 'consultor'];
const GESTORES = ['admin', 'analista'];

const TIPO_ANEXO_LABEL = {
  edital: 'Edital',
  auto_arrematacao: 'Auto de Arrematação',
  carta_arrematacao: 'Carta de Arrematação',
  matricula: 'Matrícula',
  contrato: 'Contrato',
  procuracao: 'Procuração',
  outro: 'Outro',
};

const TIPO_USERDOC_LABEL = {
  identidade: 'Identidade',
  comprovante_pagamento: 'Comprovante de Pagamento',
  procuracao: 'Procuração',
  cnd: 'CND',
  outro: 'Outro',
};

const STATUS_ARREMATACAO = {
  em_processo: { label: 'Em Processo', bg: '#fef9c3', color: '#92400e' },
  finalizado: { label: 'Finalizado', bg: '#dcfce7', color: '#15803d' },
  cancelado: { label: 'Cancelado', bg: '#fee2e2', color: '#dc2626' },
};

async function getAuthHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, opts = {}) {
  const headers = await getAuthHeader();
  const res = await fetch(path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...headers, ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { error: text }; }
  return { ok: res.ok, status: res.status, data };
}

// ── Painel de documentos (imovel_anexos ou usuario_docs) ─────────────────────
function DocPanel({ title, docs, arrematacaoId, imovelId, docType, tipoOpts, canUpload, canDelete, onRefresh }) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadTipo, setUploadTipo] = useState(Object.keys(tipoOpts)[0]);
  const [uploadErr, setUploadErr] = useState('');
  const fileRef = useRef(null);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr('');
    try {
      const nome = file.name;
      // 1. Get signed upload URL
      const signRes = await apiFetch(
        `/api/arrematacoes?signed_url=1&arrematacao_id=${arrematacaoId}&tipo=${uploadTipo}&nome=${encodeURIComponent(nome)}&doc_type=${docType}`
      );
      if (!signRes.ok) throw new Error(signRes.data?.error || 'Erro ao obter URL');
      const { signedUrl } = signRes.data;

      // 2. Upload to storage
      const putRes = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putRes.ok) throw new Error('Falha no upload do arquivo');

      // 3. Save doc record
      const { data: { publicUrl } } = supabase.storage.from('arrematacoes').getPublicUrl(`${arrematacaoId}/${uploadTipo}/${nome}`);
      const saveRes = await apiFetch('/api/arrematacoes?save_doc=1', {
        method: 'POST',
        body: JSON.stringify({
          arrematacao_id: arrematacaoId,
          imovel_id: imovelId,
          tipo: uploadTipo,
          nome,
          url: publicUrl,
          tamanho_kb: Math.round(file.size / 1024),
          doc_type: docType,
        }),
      });
      if (!saveRes.ok) throw new Error(saveRes.data?.error || 'Erro ao salvar documento');
      fileRef.current.value = '';
      onRefresh();
    } catch (e) {
      setUploadErr(e.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(docId) {
    if (!confirm('Remover este documento?')) return;
    await apiFetch(`/api/arrematacoes?doc_id=${docId}&doc_type=${docType}`, { method: 'DELETE' });
    onRefresh();
  }

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', marginTop: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ width: '100%', background: '#f8fafc', border: 'none', padding: '12px 16px', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 14, fontWeight: 700, color: '#334155' }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{open ? '▲' : '▼'} {docs.length} arquivo(s)</span>
      </button>
      {open && (
        <div style={{ padding: '16px' }}>
          {docs.length === 0 && (
            <p style={{ fontSize: 13, color: '#94a3b8', margin: '0 0 12px' }}>Nenhum documento ainda.</p>
          )}
          {docs.map(doc => (
            <div key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 18 }}>📄</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <a href={doc.url} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 13, fontWeight: 600, color: '#0D63DB', textDecoration: 'none', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {doc.nome}
                </a>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  {(tipoOpts)[doc.tipo] || doc.tipo}{doc.tamanho_kb ? ` · ${doc.tamanho_kb} KB` : ''}
                </span>
              </div>
              {canDelete && (
                <button
                  onClick={() => handleDelete(doc.id)}
                  style={{ background: '#fee2e2', border: 'none', color: '#dc2626', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  Remover
                </button>
              )}
            </div>
          ))}
          {canUpload && (
            <div style={{ marginTop: 16, padding: '12px', background: '#f8fafc', borderRadius: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 8 }}>Enviar documento</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select
                  value={uploadTipo}
                  onChange={e => setUploadTipo(e.target.value)}
                  style={{ fontSize: 13, padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: '#334155' }}
                >
                  {Object.entries(tipoOpts).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
                <input ref={fileRef} type="file" style={{ fontSize: 13 }} />
                <button
                  onClick={handleUpload}
                  disabled={uploading}
                  style={{ padding: '7px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
                  {uploading ? 'Enviando…' : 'Enviar'}
                </button>
              </div>
              {uploadErr && <p style={{ fontSize: 12, color: '#dc2626', margin: '6px 0 0' }}>{uploadErr}</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Modal de registro/edição de arrematação ──────────────────────────────────
function ArrematacaoModal({ imovelId, arrematacao, onClose, onSaved }) {
  const [form, setForm] = useState({
    arrematante_email: '',
    arrematante_id: arrematacao?.arrematante_id || '',
    valor_arrematado: arrematacao?.valor_arrematado || '',
    data_leilao: arrematacao?.data_leilao || '',
    leiloeiro: arrematacao?.leiloeiro || '',
    numero_processo: arrematacao?.numero_processo || '',
    observacoes: arrematacao?.observacoes || '',
  });
  const [searching, setSearching] = useState(false);
  const [perfis, setPerfis] = useState([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function searchUser(q) {
    if (!q || q.length < 3) return;
    setSearching(true);
    const { data } = await supabase.from('perfis').select('id, nome, email').or(`email.ilike.%${q}%,nome.ilike.%${q}%`).limit(5);
    setPerfis(data || []);
    setSearching(false);
  }

  async function handleSave() {
    setErr('');
    if (!form.arrematante_id && !arrematacao) { setErr('Selecione o arrematante'); return; }
    setSaving(true);
    try {
      let res;
      if (arrematacao) {
        res = await apiFetch(`/api/arrematacoes?id=${arrematacao.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            status: form.status || arrematacao.status,
            observacoes: form.observacoes,
            valor_arrematado: form.valor_arrematado || null,
          }),
        });
      } else {
        res = await apiFetch('/api/arrematacoes', {
          method: 'POST',
          body: JSON.stringify({
            imovel_id: imovelId,
            arrematante_id: form.arrematante_id,
            valor_arrematado: form.valor_arrematado || null,
            data_leilao: form.data_leilao || null,
            leiloeiro: form.leiloeiro || null,
            numero_processo: form.numero_processo || null,
            observacoes: form.observacoes || null,
          }),
        });
      }
      if (!res.ok) { setErr(res.data?.error || 'Erro ao salvar'); setSaving(false); return; }
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  const inp = (field, label, type = 'text', extra = {}) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>{label}</label>
      {type === 'textarea' ? (
        <textarea value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          rows={3} style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, boxSizing: 'border-box', resize: 'vertical', color: '#334155' }} />
      ) : (
        <input type={type} value={form[field]} onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
          style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, boxSizing: 'border-box', color: '#334155' }}
          {...extra} />
      )}
    </div>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 16, padding: 28, width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 800, color: '#111111' }}>
          {arrematacao ? 'Editar Arrematação' : 'Registrar Arrematação'}
        </h3>

        {!arrematacao && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>Arrematante (buscar por e-mail ou nome)</label>
            <input
              type="text"
              placeholder="Digite e-mail ou nome..."
              onChange={e => searchUser(e.target.value)}
              style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, boxSizing: 'border-box', color: '#334155' }}
            />
            {searching && <p style={{ fontSize: 12, color: '#94a3b8', margin: '4px 0 0' }}>Buscando…</p>}
            {perfis.length > 0 && (
              <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 4, overflow: 'hidden' }}>
                {perfis.map(p => (
                  <button key={p.id}
                    onClick={() => { setForm(f => ({ ...f, arrematante_id: p.id, arrematante_email: p.email || p.nome })); setPerfis([]); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', fontSize: 13, color: '#334155', background: form.arrematante_id === p.id ? '#eff6ff' : 'white' }}>
                    {p.nome} — {p.email}
                  </button>
                ))}
              </div>
            )}
            {form.arrematante_id && (
              <p style={{ fontSize: 12, color: '#15803d', margin: '4px 0 0', fontWeight: 600 }}>Selecionado: {form.arrematante_email}</p>
            )}
          </div>
        )}

        {inp('valor_arrematado', 'Valor Arrematado (R$)', 'number', { step: '0.01', min: '0' })}
        {inp('data_leilao', 'Data do Leilão', 'date')}
        {inp('leiloeiro', 'Leiloeiro')}
        {inp('numero_processo', 'Número do Processo')}
        {inp('observacoes', 'Observações', 'textarea')}

        {arrematacao && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 4 }}>Status</label>
            <select
              value={form.status || arrematacao.status}
              onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              style={{ width: '100%', fontSize: 14, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 8, boxSizing: 'border-box', color: '#334155' }}>
              <option value="em_processo">Em Processo</option>
              <option value="finalizado">Finalizado</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>
        )}

        {err && <p style={{ fontSize: 13, color: '#dc2626', margin: '0 0 12px' }}>{err}</p>}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose}
            style={{ padding: '9px 18px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: 'pointer', color: '#475569' }}>
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '9px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.7 : 1 }}>
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Seção arrematação ─────────────────────────────────────────────────────────
function SecaoArrematacao({ imovelId, user, role }) {
  const [loading, setLoading] = useState(true);
  const [arrematacao, setArrematacao] = useState(null);
  const [anexos, setAnexos] = useState([]);
  const [userDocs, setUserDocs] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const isGestor = GESTORES.includes(role);
  const isEquipe = EQUIPE.includes(role);

  async function load() {
    setLoading(true);
    const res = await apiFetch(`/api/arrematacoes?imovel_id=${imovelId}`);
    if (res.ok) {
      setArrematacao(res.data.arrematacao || null);
      setAnexos(res.data.imovel_anexos || []);
      setUserDocs(res.data.usuario_docs || []);
    }
    setLoading(false);
  }

  useEffect(() => { if (imovelId) load(); }, [imovelId]);

  // Visibilidade: equipe ou o próprio arrematante
  const isArrematante = arrematacao && arrematacao.arrematante_id === user?.id;
  const podeVer = isEquipe || isArrematante || (role === 'assessorado' && isArrematante);

  if (!user || (!isEquipe && !podeVer && !arrematacao)) return null;
  if (!isEquipe && !arrematacao) return null;

  const statusInfo = arrematacao ? (STATUS_ARREMATACAO[arrematacao.status] || STATUS_ARREMATACAO.em_processo) : null;

  return (
    <div style={{ background: 'white', borderRadius: 16, border: '2px solid #e2e8f0', padding: '24px', marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          🏛️ Arrematação
        </h2>
        {arrematacao && statusInfo && (
          <span style={{ background: statusInfo.bg, color: statusInfo.color, fontWeight: 700, fontSize: 12, padding: '4px 12px', borderRadius: 20 }}>
            {statusInfo.label}
          </span>
        )}
      </div>

      {loading && <p style={{ fontSize: 13, color: '#94a3b8' }}>Carregando…</p>}

      {!loading && !arrematacao && isGestor && (
        <div>
          <p style={{ fontSize: 13, color: '#94a3b8', marginBottom: 12 }}>Nenhuma arrematação registrada para este imóvel.</p>
          <button
            onClick={() => { setEditMode(false); setShowModal(true); }}
            style={{ padding: '9px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Registrar Arrematação
          </button>
        </div>
      )}

      {!loading && arrematacao && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 16 }}>
            {[
              { label: 'Valor Arrematado', value: fmtBRL(arrematacao.valor_arrematado) },
              { label: 'Data do Leilão', value: fmtDate(arrematacao.data_leilao) },
              { label: 'Leiloeiro', value: arrematacao.leiloeiro || '—' },
              { label: 'Nº Processo', value: arrematacao.numero_processo || '—' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: '#f8fafc', borderRadius: 10, padding: '12px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#334155' }}>{value}</div>
              </div>
            ))}
          </div>
          {arrematacao.observacoes && (
            <div style={{ background: '#f8fafc', borderRadius: 10, padding: '12px', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Observações</div>
              <p style={{ fontSize: 13, color: '#475569', margin: 0, whiteSpace: 'pre-wrap' }}>{arrematacao.observacoes}</p>
            </div>
          )}

          {isGestor && (
            <button
              onClick={() => { setEditMode(true); setShowModal(true); }}
              style={{ padding: '7px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', color: '#475569', marginBottom: 12 }}>
              Editar
            </button>
          )}

          {/* Painel documentos do processo */}
          {(isEquipe || isArrematante) && (
            <DocPanel
              title="Documentos do Processo"
              docs={anexos}
              arrematacaoId={arrematacao.id}
              imovelId={imovelId}
              docType="imovel_anexo"
              tipoOpts={TIPO_ANEXO_LABEL}
              canUpload={['admin', 'analista', 'advogado'].includes(role)}
              canDelete={isGestor}
              onRefresh={load}
            />
          )}

          {/* Painel documentos pessoais */}
          {isArrematante && (
            <DocPanel
              title="Meus Documentos"
              docs={userDocs}
              arrematacaoId={arrematacao.id}
              imovelId={imovelId}
              docType="usuario_doc"
              tipoOpts={TIPO_USERDOC_LABEL}
              canUpload={true}
              canDelete={true}
              onRefresh={load}
            />
          )}
        </div>
      )}

      {showModal && (
        <ArrematacaoModal
          imovelId={imovelId}
          arrematacao={editMode ? arrematacao : null}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); load(); }}
        />
      )}
    </div>
  );
}

export default function ImovelDetalhe() {
  const nav = useNavigate();
  const loc = useLocation();
  const { id: paramId } = useParams();
  const { user, role } = useAuth();
  const [imovel, setImovel] = useState(loc.state?.imovel || null);
  const [loading, setLoading] = useState(!loc.state?.imovel);
  const [imgError, setImgError] = useState(false);

  const id = loc.state?.imovel?.id || paramId;

  useEffect(() => {
    if (imovel) return;
    if (!id) { nav('/buscar'); return; }
    setLoading(true);
    supabase.from('imoveis_leilao').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (!data) { nav('/buscar'); return; }
        setImovel({
          id: data.id, titulo: data.titulo, tipo: data.tipo, modalidade: data.modalidade,
          estado: data.estado, cidade: data.cidade, bairro: data.bairro, endereco: data.endereco,
          valorAvaliacao: data.valor_avaliacao, valorMinimo: data.valor_minimo,
          descontoPercentual: data.desconto_percentual, areaM2: data.area_m2, descricao: data.descricao,
          urlLote: data.url_lote || data.link_edital || data.link_regras_venda, linkEdital: data.link_edital, linkMatricula: data.link_matricula, linkRegrasVenda: data.link_regras_venda,
          foto: data.link_foto, leiloeiro: data.leiloeiro, dataLeilao: data.data_leilao,
          pagamento: [data.forma_pagamento], fonte: data.fonte,
          numeroEdital: data.numero_edital, numeroMatricula: data.numero_matricula,
          numeroProcesso: data.numero_processo,
        });
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
        <div style={{ fontWeight: 600 }}>Carregando imóvel…</div>
      </div>
    </div>
  );

  if (!imovel) return null;

  const desc = imovel.descontoPercentual || 0;
  const descColor = desc >= 40 ? '#15803d' : desc >= 20 ? '#92400e' : '#dc2626';
  const descBg    = desc >= 40 ? '#dcfce7' : desc >= 20 ? '#fef9c3' : '#fee2e2';
  const podeFazerAnalise = PLANOS_ANALISE.includes(role);
  const economia = imovel.valorAvaliacao && imovel.valorMinimo ? imovel.valorAvaliacao - imovel.valorMinimo : null;

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', paddingBottom: 80 }}>

      {/* Breadcrumb */}
      <div style={{ background: '#111111', padding: '12px 20px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}>
            <ArrowLeft size={15} /> Voltar à busca
          </button>
          <span style={{ color: '#334155', fontSize: 13 }}>/</span>
          <span style={{ color: '#64748b', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{imovel.titulo || 'Imóvel'}</span>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }} className="detalhe-grid">

          {/* Coluna esquerda */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Foto + badges */}
            <div style={{ borderRadius: 16, overflow: 'hidden', position: 'relative', background: '#111111', minHeight: 260 }}>
              {imovel.foto && !imgError ? (
                <img src={imovel.foto} alt={imovel.titulo} onError={() => setImgError(true)}
                  style={{ width: '100%', height: 320, objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#475569' }}>
                  <Home size={48} color="#334155" />
                  <span style={{ fontSize: 13 }}>Sem foto disponível</span>
                </div>
              )}
              <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {imovel.tipo && <span style={{ background: '#111111', color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{TIPO_LABEL[imovel.tipo] || imovel.tipo}</span>}
                {imovel.modalidade && <span style={{ background: '#084BA6', color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{MODAL_LABEL[imovel.modalidade] || imovel.modalidade}</span>}
              </div>
              {desc > 0 && (
                <div style={{ position: 'absolute', top: 16, right: 16, background: descBg, color: descColor, fontWeight: 900, fontSize: 18, padding: '6px 12px', borderRadius: 10, lineHeight: 1 }}>
                  -{desc}%
                </div>
              )}
            </div>

            {/* Título e localização */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h1 style={{ fontSize: 'clamp(16px, 3vw, 22px)', fontWeight: 800, color: '#111111', margin: '0 0 12px', lineHeight: 1.3 }}>
                {imovel.titulo || 'Imóvel em leilão'}
              </h1>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: '#64748b', fontSize: 14 }}>
                {(imovel.endereco || imovel.cidade) && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MapPin size={14} color="#0D63DB" />
                    {[imovel.endereco, imovel.bairro, imovel.cidade, imovel.estado].filter(Boolean).join(', ')}
                  </span>
                )}
                {imovel.areaM2 > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Building2 size={14} color="#8b5cf6" /> {imovel.areaM2} m²
                  </span>
                )}
                {imovel.leiloeiro && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag size={14} color="#0891b2" /> {imovel.leiloeiro}
                  </span>
                )}
              </div>
            </div>

            {/* Valores */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Banknote size={18} color="#0D63DB" /> Valores
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
                <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Lance mínimo</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#111111' }}>{fmtBRL(imovel.valorMinimo)}</div>
                </div>
                {imovel.valorAvaliacao && (
                  <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Avaliação</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#64748b' }}>{fmtBRL(imovel.valorAvaliacao)}</div>
                  </div>
                )}
                {economia && (
                  <div style={{ background: '#dcfce7', borderRadius: 12, padding: '16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Economia potencial</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#15803d' }}>{fmtBRL(economia)}</div>
                  </div>
                )}
              </div>
              {imovel.pagamento?.filter(Boolean).length > 0 && (
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Pagamento:</span>
                  {imovel.pagamento.filter(Boolean).map(p => (
                    <span key={p} style={{ fontSize: 12, background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>{p}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Data do leilão */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={18} color="#0D63DB" /> Data do leilão
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Clock size={16} color="#64748b" />
                <span style={{ fontSize: 15, fontWeight: 600, color: '#334155' }}>{fmtData(imovel.dataLeilao, imovel.modalidade)}</span>
              </div>
            </div>

            {/* Descrição */}
            {imovel.descricao && (
              <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} color="#0D63DB" /> Descrição
                </h2>
                <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{imovel.descricao}</p>
              </div>
            )}

            {/* Documentos */}
            {(imovel.numeroEdital || imovel.numeroMatricula || imovel.numeroProcesso || imovel.linkEdital || imovel.linkMatricula || imovel.linkRegrasVenda) && (
              <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} color="#0D63DB" /> Documentos
                </h2>

                {/* Números de referência */}
                {(imovel.numeroEdital || imovel.numeroMatricula || imovel.numeroProcesso) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {imovel.numeroEdital && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: '#94a3b8', minWidth: 110 }}>Nº Edital:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#eff6ff', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroEdital}</span>
                      </div>
                    )}
                    {imovel.numeroMatricula && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: '#94a3b8', minWidth: 110 }}>Nº Matrícula:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#f0fdf4', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroMatricula}</span>
                      </div>
                    )}
                    {imovel.numeroProcesso && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: '#94a3b8', minWidth: 110 }}>Nº Processo:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#faf5ff', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroProcesso}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Botões de PDF */}
                {(imovel.linkEdital || imovel.linkMatricula || imovel.linkRegrasVenda) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {imovel.linkEdital && (
                      <a href={imovel.linkEdital} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, color: '#084BA6', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                        📄 Edital
                      </a>
                    )}
                    {imovel.linkRegrasVenda && (
                      <a href={imovel.linkRegrasVenda} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, color: '#c2410c', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                        📋 Regras de Venda Online
                      </a>
                    )}
                    {imovel.linkMatricula && (
                      <a href={imovel.linkMatricula} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#15803d', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                        📄 Matrícula
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Aviso de risco */}
            <div style={{ background: '#fffbeb', borderRadius: 16, border: '1px solid #fbbf24', padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: 13, color: '#92400e', margin: 0, lineHeight: 1.6 }}>
                <strong>Atenção:</strong> Antes de arrematar, verifique o edital, a matrícula do imóvel e possíveis ônus ou ocupantes. Recomendamos solicitar uma análise completa com nossa equipe.
              </p>
            </div>

            {/* Seção arrematação */}
            {user && (EQUIPE.includes(role) || role === 'assessorado') && imovel.id && (
              <SecaoArrematacao imovelId={imovel.id} user={user} role={role} />
            )}
          </div>

          {/* Sidebar direita */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 80 }} className="detalhe-sidebar">

            {/* Card de ação */}
            <div style={{ background: 'white', borderRadius: 16, border: '2px solid #e2e8f0', padding: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Lance mínimo</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#111111', marginBottom: 4 }}>{fmtBRL(imovel.valorMinimo)}</div>
              {desc > 0 && (
                <div style={{ display: 'inline-block', background: descBg, color: descColor, fontWeight: 800, fontSize: 13, padding: '3px 10px', borderRadius: 8, marginBottom: 16 }}>
                  {desc}% abaixo da avaliação
                </div>
              )}

              {/* Ir ao leiloeiro */}
              {imovel.urlLote && (
                <div style={{ marginBottom: 10 }}>
                  <a href={imovel.urlLote} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#111111', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box' }}>
                    <ExternalLink size={15} /> {imovel.fonte === 'caixa' ? 'Ver no portal da Caixa' : 'Ir ao leiloeiro'}
                  </a>
                  <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 6 }}>
                    ⚠️ Se o link estiver expirado, o imóvel pode ter sido vendido.{' '}
                    {imovel.fonte === 'caixa' && (
                      <a href="https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp" target="_blank" rel="noopener noreferrer"
                        style={{ color: '#0D63DB', fontWeight: 600 }}>
                        Buscar na CEF →
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Solicitar análise */}
              {user ? (
                podeFazerAnalise ? (
                  <button onClick={() => nav('/analise', { state: { imovel } })}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    <BarChart2 size={15} /> Solicitar Análise
                  </button>
                ) : (
                  <button onClick={() => nav('/planos')}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    <BarChart2 size={15} /> Fazer upgrade para analisar
                  </button>
                )
              ) : (
                <button onClick={() => nav('/login')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  <BarChart2 size={15} /> Entrar para analisar
                </button>
              )}

              <div style={{ marginTop: 16, padding: '12px', background: '#f8fafc', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  <CheckCircle size={13} color="#22c55e" /> Análise gerada em minutos
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  <CheckCircle size={13} color="#22c55e" /> Laudo mercadológico e jurídico
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                  <CheckCircle size={13} color="#22c55e" /> Projeção de rentabilidade
                </div>
              </div>
            </div>

            {/* Info rápida */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Resumo</div>
              {[
                { label: 'Tipo', value: TIPO_LABEL[imovel.tipo] || imovel.tipo },
                { label: 'Modalidade', value: MODAL_LABEL[imovel.modalidade] || imovel.modalidade },
                { label: 'Cidade/UF', value: imovel.cidade ? `${imovel.cidade}/${imovel.estado}` : imovel.estado },
                { label: 'Área', value: imovel.areaM2 ? `${imovel.areaM2} m²` : null },
                { label: 'Fonte', value: imovel.fonte },
                { label: 'Leiloeiro', value: imovel.leiloeiro },
              ].filter(({ value }) => value).map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ color: '#94a3b8' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: '#334155', textAlign: 'right', maxWidth: 160 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .detalhe-grid { grid-template-columns: 1fr !important; }
          .detalhe-sidebar { position: static !important; }
        }
      `}</style>
    </div>
  );
}
