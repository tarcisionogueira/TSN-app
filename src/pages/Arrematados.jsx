import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Search, Plus, Building2, FileText, DollarSign, X, Trash2, UploadCloud, ArrowUpCircle, ArrowDownCircle, ExternalLink, Loader2, ChevronLeft } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useAnalises } from '../contexts/AnalisesContext';
import { useIsMobile } from '../utils/useIsMobile';

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS = {
  arrematado: { l: 'Arrematado', c: '#0D63DB', bg: '#dbeafe' },
  reforma:    { l: 'Em reforma', c: '#b45309', bg: '#fef3c7' },
  alugado:    { l: 'Alugado',    c: '#7c3aed', bg: '#ede9fe' },
  venda:      { l: 'À venda',    c: '#0d9488', bg: '#ccfbf1' },
  concluido:  { l: 'Concluído',  c: '#15803d', bg: '#dcfce7' },
};
const CATEGORIAS = ['Arrematação', 'Honorários advocatícios', 'Taxa do leiloeiro', 'ITBI / Registro', 'Reforma', 'IPTU', 'Condomínio', 'Débitos assumidos', 'Venda', 'Aluguel recebido', 'Outro'];
// Documentos do ciclo do arremate — ficam permanentes (nunca apagados) e alimentam
// a IA. Judicial: auto/carta. Extrajudicial: boleto sinal/aquisição, contrato do
// banco (financiado), escritura (lavratura) e matrícula registrada.
const DOC_TIPOS = [
  ['auto_arrematacao', 'Auto de arrematação (judicial)'],
  ['carta_arrematacao', 'Carta de arrematação (judicial)'],
  ['boleto_sinal', 'Boleto do sinal (extrajudicial)'],
  ['boleto_aquisicao', 'Boleto da aquisição (extrajudicial)'],
  ['contrato_banco', 'Contrato do banco (financiado)'],
  ['escritura', 'Escritura / lavratura'],
  ['matricula_registrada', 'Matrícula registrada'],
  ['edital', 'Edital'],
  ['matricula', 'Matrícula'],
  ['outro', 'Outro documento'],
];
const DOC_TIPO_LABEL = Object.fromEntries(DOC_TIPOS.map(([v, l]) => [v, l]));

function fotoImovel(im) {
  if (!im) return null;
  const isCef = im.fonte === 'CEF' || im.fonte === 'caixa';
  const id = (im.fonteId || im.fonte_id || '').replace(/^(caixa_|cef_)/, '');
  if (isCef && id) return `https://venda-imoveis.caixa.gov.br/fotos/F${id}21.jpg`;
  const f = im.foto || im.link_foto;
  if (!f) return null;
  return (f.includes('supabase.co') || f.startsWith('/')) ? f : `/api/img-proxy?url=${encodeURIComponent(f)}`;
}

// Números da operação: avaliação, valor de mercado (relatório), arrematação, lucro.
function StatOp({ label, valor, cor, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 130, background: '#f8fafc', borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color: cor || '#111' }}>{valor == null ? '—' : brl(valor)}</div>
      {sub && <div style={{ fontSize: 10.5, color: cor || '#94a3b8', fontWeight: 700 }}>{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tela do arremate (dedicada): números da operação + Lançamentos + Documentos
// ─────────────────────────────────────────────────────────────────────────────
function Detalhe({ arr, onBack, onChange, soLeitura }) {
  const [aba, setAba] = React.useState(arr._abaInicial || 'lancamentos');
  const [lancs, setLancs] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [docs, setDocs] = React.useState([]);
  const [docsLoading, setDocsLoading] = React.useState(true);
  const [enviando, setEnviando] = React.useState(false);
  const [docTipo, setDocTipo] = React.useState('auto_arrematacao');
  const [imovelId, setImovelId] = React.useState(arr.imovel_id || null);
  const [nums, setNums] = React.useState({ avaliacao: null, valorMercado: null });
  const [novo, setNovo] = React.useState({ tipo: 'saida', categoria: 'Reforma', descricao: '', valor: '', data: new Date().toISOString().slice(0, 10) });

  React.useEffect(() => {
    supabase.from('arrematado_lancamentos').select('*').eq('arrematado_id', arr.id).order('data', { ascending: false })
      .then(({ data }) => { setLancs(Array.isArray(data) ? data : []); setLoading(false); });
  }, [arr.id]);

  // Documentos do arremate: fonte única = imovel_anexos (é o que a atribuição gravou
  // e o que a IA lê). Assim os anexos incluídos na atribuição aparecem aqui.
  const carregarDocs = React.useCallback(async () => {
    if (!imovelId) { setDocs([]); setDocsLoading(false); return; }
    setDocsLoading(true);
    const { data } = await supabase.from('imovel_anexos')
      .select('id,tipo,nome,storage_path,criado_em')
      .eq('imovel_id', imovelId).order('criado_em', { ascending: true });
    setDocs(Array.isArray(data) ? data : []);
    setDocsLoading(false);
  }, [imovelId]);
  React.useEffect(() => { carregarDocs(); }, [carregarDocs]);

  // Números da operação: avaliação (imóvel) + valor de mercado (relatório concluído).
  React.useEffect(() => {
    let vivo = true;
    (async () => {
      let avaliacao = null, valorMercado = null;
      if (imovelId) {
        try { const { data: im } = await supabase.from('imoveis_leilao').select('valor_avaliacao').eq('id', imovelId).maybeSingle(); avaliacao = im?.valor_avaliacao ?? null; } catch { /* ignore */ }
        try {
          const { data: am } = await supabase.from('analises_mercado').select('result').eq('user_id', arr.user_id).eq('imovel_id', imovelId).eq('status', 'concluida').order('updated_at', { ascending: false }).limit(1);
          valorMercado = am?.[0]?.result?.valorMercado ?? null;
        } catch { /* ignore */ }
      }
      if (vivo) setNums({ avaliacao, valorMercado });
    })();
    return () => { vivo = false; };
  }, [imovelId, arr.user_id]);

  const entradas = lancs.filter(l => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor || 0), 0);
  const saidas = lancs.filter(l => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor || 0), 0);
  const saldo = entradas - saidas;
  const arrematacao = Number(arr.valor_arrematacao) || null;
  const lucro = (nums.valorMercado != null && arrematacao != null) ? (nums.valorMercado - arrematacao) : null;
  const lucroPct = (lucro != null && arrematacao > 0) ? (lucro / arrematacao) * 100 : null;

  const addLanc = async () => {
    const valor = Number(String(novo.valor).replace(/\./g, '').replace(',', '.'));
    if (!valor || valor <= 0) return;
    const { data: { user } } = await supabase.auth.getUser();
    const row = { arrematado_id: arr.id, user_id: user.id, tipo: novo.tipo, categoria: novo.categoria, descricao: novo.descricao.trim() || null, valor, data: novo.data || null };
    const { data, error } = await supabase.from('arrematado_lancamentos').insert(row).select().single();
    if (!error && data) { setLancs(prev => [data, ...prev]); setNovo(n => ({ ...n, descricao: '', valor: '' })); }
  };
  const delLanc = async (id) => {
    await supabase.from('arrematado_lancamentos').delete().eq('id', id);
    setLancs(prev => prev.filter(l => l.id !== id));
  };

  // Garante o imóvel-âncora (cria sob demanda se o arrematado não veio da base).
  const garantirAncora = async () => {
    if (imovelId) return imovelId;
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch('/api/arrematado-ancora', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ arrematado_id: arr.id }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.imovel_id) throw new Error(d.error || 'Não foi possível preparar o anexo.');
    setImovelId(d.imovel_id);
    onChange?.({ ...arr, imovel_id: d.imovel_id });
    return d.imovel_id;
  };

  const uploadDoc = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.type !== 'application/pdf') { alert('Envie o documento em PDF.'); return; }
    if (file.size > 20 * 1024 * 1024) { alert('Arquivo acima de 20 MB.'); return; }
    setEnviando(true);
    try {
      const imId = await garantirAncora();
      const fd = new FormData();
      fd.append('file', file); fd.append('imovel_id', imId); fd.append('tipo', docTipo); fd.append('arrematado', 'true');
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/upload-anexo', { method: 'POST', headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}, body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha no envio');
      await carregarDocs();
    } catch (err) { alert(err.message || 'Erro ao enviar o documento.'); }
    finally { setEnviando(false); }
  };
  const abrirDoc = async (d) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/anexo-url', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) }, body: JSON.stringify({ anexo_id: d.id }) });
      const j = await res.json().catch(() => ({}));
      if (j.url) window.open(j.url, '_blank', 'noopener'); else alert(j.error || 'Não foi possível abrir o documento.');
    } catch { alert('Não foi possível abrir o documento.'); }
  };
  const delDoc = async (d) => {
    if (!confirm(`Remover "${d.nome}"? Use quando o anexo não tiver a ver com esta arrematação.`)) return;
    const { error } = await supabase.from('imovel_anexos').delete().eq('id', d.id);
    if (error) { alert('Não foi possível remover o documento.'); return; }
    setDocs(prev => prev.filter(x => x.id !== d.id));
  };

  const inp = { width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 13, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
  const tab = (k, label, Icon) => (
    <button onClick={() => setAba(k)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', border: 'none', borderRadius: 10, background: aba === k ? '#0D63DB' : '#f1f5f9', color: aba === k ? 'white' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
      <Icon size={15} /> {label}{k === 'documentos' && docs.length ? ` (${docs.length})` : ''}
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Cabeçalho: voltar + título + números da operação */}
      <div>
        <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '7px 12px', fontSize: 13, fontWeight: 700, color: '#334155', cursor: 'pointer', marginBottom: 12 }}>
          <ChevronLeft size={16} /> Voltar
        </button>
        <div style={{ fontSize: 20, fontWeight: 900, color: '#111' }}>{arr.titulo || 'Imóvel arrematado'}</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>{[arr.cidade, arr.estado].filter(Boolean).join(', ')}</div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <StatOp label="Avaliação" valor={nums.avaliacao} />
        <StatOp label="Valor de mercado" valor={nums.valorMercado} cor="#0d9488" sub={nums.valorMercado == null ? 'gere o relatório' : null} />
        <StatOp label="Arrematação" valor={arrematacao} cor="#0D63DB" />
        <StatOp label="Lucro × mercado" valor={lucro} cor={lucro == null ? null : (lucro >= 0 ? '#15803d' : '#dc2626')} sub={lucroPct == null ? null : `${lucroPct >= 0 ? '+' : ''}${lucroPct.toFixed(0)}% sobre a arrematação`} />
      </div>

      <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', gap: 8, padding: '14px 20px 0' }}>
          {tab('lancamentos', 'Lançamentos', DollarSign)}
          {tab('documentos', 'Documentos', FileText)}
        </div>

        <div style={{ padding: 20 }}>
          {aba === 'lancamentos' && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                {[{ l: 'Entradas', v: entradas, c: '#059669' }, { l: 'Saídas', v: saidas, c: '#dc2626' }, { l: 'Saldo', v: saldo, c: saldo >= 0 ? '#0D63DB' : '#dc2626' }].map(m => (
                  <div key={m.l} style={{ flex: 1, minWidth: 120, background: '#f8fafc', borderRadius: 10, padding: '10px 14px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>{m.l}</div>
                    <div style={{ fontSize: 17, fontWeight: 900, color: m.c }}>{brl(m.v)}</div>
                  </div>
                ))}
              </div>
              {!soLeitura && (
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 10 }}>Novo lançamento</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                  <button onClick={() => setNovo(n => ({ ...n, tipo: 'entrada' }))} style={{ flex: 1, padding: '8px', borderRadius: 8, border: `1px solid ${novo.tipo === 'entrada' ? '#059669' : '#e2e8f0'}`, background: novo.tipo === 'entrada' ? '#ecfdf5' : 'white', color: novo.tipo === 'entrada' ? '#059669' : '#64748b', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Entrada</button>
                  <button onClick={() => setNovo(n => ({ ...n, tipo: 'saida' }))} style={{ flex: 1, padding: '8px', borderRadius: 8, border: `1px solid ${novo.tipo === 'saida' ? '#dc2626' : '#e2e8f0'}`, background: novo.tipo === 'saida' ? '#fef2f2' : 'white', color: novo.tipo === 'saida' ? '#dc2626' : '#64748b', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>Saída</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <select value={novo.categoria} onChange={e => setNovo(n => ({ ...n, categoria: e.target.value }))} style={inp}>
                    {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <input type="date" value={novo.data} onChange={e => setNovo(n => ({ ...n, data: e.target.value }))} style={inp} />
                </div>
                <input placeholder="Descrição (opcional)" value={novo.descricao} onChange={e => setNovo(n => ({ ...n, descricao: e.target.value }))} style={{ ...inp, marginBottom: 8 }} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <input placeholder="Valor (R$)" inputMode="decimal" value={novo.valor} onChange={e => setNovo(n => ({ ...n, valor: e.target.value }))} style={{ ...inp, flex: 1 }} />
                  <button onClick={addLanc} style={{ padding: '9px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Adicionar</button>
                </div>
              </div>
              )}
              {loading ? <div style={{ color: '#94a3b8', fontSize: 13 }}>Carregando…</div> : lancs.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>Nenhum lançamento ainda.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {lancs.map(l => (
                    <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid #f1f5f9', borderRadius: 10 }}>
                      {l.tipo === 'entrada' ? <ArrowUpCircle size={18} color="#059669" /> : <ArrowDownCircle size={18} color="#dc2626" />}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{l.categoria}{l.descricao ? <span style={{ fontWeight: 400, color: '#64748b' }}> · {l.descricao}</span> : ''}</div>
                        <div style={{ fontSize: 11, color: '#94a3b8' }}>{l.data ? new Date(l.data + 'T12:00:00').toLocaleDateString('pt-BR') : ''}</div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 800, color: l.tipo === 'entrada' ? '#059669' : '#dc2626' }}>{l.tipo === 'entrada' ? '+' : '−'} {brl(l.valor)}</div>
                      {!soLeitura && <button onClick={() => delLanc(l.id)} style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer' }}><Trash2 size={15} /></button>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {aba === 'documentos' && (
            <>
              {soLeitura ? (
                <div style={{ fontSize: 12, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '9px 12px', marginBottom: 12, fontWeight: 600 }}>
                  👁 Modo suporte — somente visualização dos documentos do assinante.
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, lineHeight: 1.5 }}>
                    Selecione o tipo e anexe o PDF. Os documentos do arremate ficam <b>permanentes</b> (nunca apagados) e alimentam a IA. Anexe ao longo do tempo (auto/carta, contrato do banco, escritura, matrícula registrada…). Se algum anexo não for desta arrematação, remova pelo ícone de lixeira.
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                    <select value={docTipo} onChange={e => setDocTipo(e.target.value)} style={{ ...inp, flex: 1, minWidth: 200 }}>
                      {DOC_TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '9px 16px', border: '1.5px dashed #cbd5e1', borderRadius: 10, cursor: enviando ? 'default' : 'pointer', color: '#0D63DB', fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap' }}>
                      {enviando ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Enviando…</> : <><UploadCloud size={16} /> Anexar PDF</>}
                      <input type="file" accept="application/pdf,.pdf" onChange={uploadDoc} disabled={enviando} style={{ display: 'none' }} />
                    </label>
                  </div>
                </>
              )}
              {docsLoading ? (
                <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>Carregando documentos…</div>
              ) : docs.length === 0 ? (
                <div style={{ color: '#94a3b8', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>{soLeitura ? 'O assinante ainda não anexou documentos.' : 'Nenhum documento anexado. Guarde aqui o auto/carta de arrematação, contrato do banco, escritura, matrícula registrada, edital.'}</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {docs.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid #f1f5f9', borderRadius: 10 }}>
                      <FileText size={17} color="#1e3a8a" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <button onClick={() => abrirDoc(d)} style={{ background: 'none', border: 'none', padding: 0, textAlign: 'left', fontSize: 13, fontWeight: 700, color: '#1e3a8a', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block', width: '100%' }}>{d.nome}</button>
                        {d.tipo && d.tipo !== 'outro' && <div style={{ fontSize: 10.5, color: '#7c3aed', fontWeight: 700 }}>{DOC_TIPO_LABEL[d.tipo] || d.tipo}</div>}
                      </div>
                      <button onClick={() => abrirDoc(d)} title="Abrir" style={{ background: 'none', border: 'none', color: '#0D63DB', cursor: 'pointer' }}><ExternalLink size={15} /></button>
                      {!soLeitura && <button onClick={() => delDoc(d)} title="Remover" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer' }}><Trash2 size={15} /></button>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal "Registrar arrematação"
// ─────────────────────────────────────────────────────────────────────────────
function NovoArrematado({ onClose, onCriar, sugestoes, inicial }) {
  const [form, setForm] = React.useState({
    titulo: inicial?.titulo || '', cidade: inicial?.cidade || '', estado: inicial?.estado || '',
    valor: inicial?.valor ? String(inicial.valor) : '', data: new Date().toISOString().slice(0, 10),
    imovel_id: inicial?.imovelId || null, imovel: inicial?.imovel || null,
    modalidade: inicial?.modalidade || 'extrajudicial', numero_processo: '',
  });
  const [salvando, setSalvando] = React.useState(false);
  const inp = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };

  const escolher = (s) => setForm(f => ({ ...f, titulo: s.titulo || '', cidade: s.cidade || '', estado: s.estado || '', imovel_id: s.imovelId || null, imovel: s.imovel || null, modalidade: s.imovel?.modalidade || f.modalidade }));

  const salvar = async () => {
    if (!form.titulo.trim()) return;
    setSalvando(true);
    const valor = Number(String(form.valor).replace(/\./g, '').replace(',', '.')) || null;
    // modalidade e nº do processo viajam no jsonb `imovel` (a tabela não tem colunas
    // próprias) — o imóvel-âncora e o corpus os leem de lá.
    await onCriar({
      titulo: form.titulo.trim(), cidade: form.cidade.trim() || null, estado: form.estado.trim() || null,
      valor_arrematacao: valor, data_arrematacao: form.data || null, imovel_id: form.imovel_id,
      imovel: { ...(form.imovel || {}), modalidade: form.modalidade, numero_processo: form.numero_processo.trim() || null },
    });
    setSalvando(false);
  };

  return (
    <div onClick={e => e.target === e.currentTarget && onClose()} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '5vh 16px', overflowY: 'auto' }}>
      <div style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 500, padding: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ margin: 0, fontWeight: 900, fontSize: 18, color: '#111' }}>Registrar arrematação</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
        </div>
        {sugestoes.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', marginBottom: 6 }}>Das suas análises</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {sugestoes.slice(0, 8).map(s => (
                <button key={s.imovelId} onClick={() => escolher(s)} style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${form.imovel_id === s.imovelId ? '#0D63DB' : '#e2e8f0'}`, background: form.imovel_id === s.imovelId ? '#eff6ff' : 'white', color: '#334155', fontSize: 12, fontWeight: 600, cursor: 'pointer', maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.titulo}</button>
              ))}
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input placeholder="Título do imóvel *" value={form.titulo} onChange={e => setForm(f => ({ ...f, titulo: e.target.value }))} style={inp} />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8 }}>
            <input placeholder="Cidade" value={form.cidade} onChange={e => setForm(f => ({ ...f, cidade: e.target.value }))} style={inp} />
            <input placeholder="UF" maxLength={2} value={form.estado} onChange={e => setForm(f => ({ ...f, estado: e.target.value.toUpperCase() }))} style={inp} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <input placeholder="Valor arrematado (R$)" inputMode="decimal" value={form.valor} onChange={e => setForm(f => ({ ...f, valor: e.target.value }))} style={inp} />
            <input type="date" value={form.data} onChange={e => setForm(f => ({ ...f, data: e.target.value }))} style={inp} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <select value={form.modalidade} onChange={e => setForm(f => ({ ...f, modalidade: e.target.value }))} style={inp}>
              <option value="extrajudicial">Extrajudicial</option>
              <option value="judicial">Judicial</option>
            </select>
            <input placeholder="Nº do processo (CNJ, se houver)" value={form.numero_processo} onChange={e => setForm(f => ({ ...f, numero_processo: e.target.value }))} style={inp} />
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: -4 }}>Com o nº do processo acompanhamos a evolução no CNJ até o encerramento. Depois de registrar, você anexa os documentos.</div>
          <button onClick={salvar} disabled={!form.titulo.trim() || salvando} style={{ padding: '12px', background: '#059669', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer', opacity: form.titulo.trim() && !salvando ? 1 : 0.5 }}>
            {salvando ? 'Salvando…' : 'Registrar arrematação'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function Arrematados() {
  const nav = useNavigate();
  const loc = useLocation();
  const isMobile = useIsMobile();
  const [prefill, setPrefill] = React.useState(null);
  const { user, effectiveUserId, impersonate } = useAuth();
  const soLeitura = !!impersonate; // modo suporte: só visualiza, não altera pelo cliente
  const { analises, documentais } = useAnalises();
  const uid = effectiveUserId || user?.id || null;
  const [arrematados, setArrematados] = React.useState([]);
  const [saldos, setSaldos] = React.useState({}); // arrematado_id → saldo
  const [nDocs, setNDocs] = React.useState({});    // imovel_id → nº de anexos
  const [mercado, setMercado] = React.useState({}); // imovel_id → valorMercado
  const [loading, setLoading] = React.useState(true);
  const [sel, setSel] = React.useState(null);
  const [novo, setNovo] = React.useState(false);

  const carregar = React.useCallback(async () => {
    if (!uid) return;
    setLoading(true);
    const { data } = await supabase.from('arrematados').select('*').eq('user_id', uid).order('updated_at', { ascending: false });
    const lista = Array.isArray(data) ? data : [];
    setArrematados(lista);
    if (lista.length) {
      // saldo por arrematado
      const { data: ls } = await supabase.from('arrematado_lancamentos').select('arrematado_id,tipo,valor').in('arrematado_id', lista.map(a => a.id));
      const acc = {};
      (ls || []).forEach(l => { acc[l.arrematado_id] = (acc[l.arrematado_id] || 0) + (l.tipo === 'entrada' ? 1 : -1) * Number(l.valor || 0); });
      setSaldos(acc);
      // números por imóvel: nº de documentos (imovel_anexos) + valor de mercado (relatório)
      const imovelIds = [...new Set(lista.map(a => a.imovel_id).filter(Boolean))];
      if (imovelIds.length) {
        try {
          const { data: an } = await supabase.from('imovel_anexos').select('imovel_id').in('imovel_id', imovelIds);
          const dc = {}; (an || []).forEach(x => { dc[x.imovel_id] = (dc[x.imovel_id] || 0) + 1; }); setNDocs(dc);
        } catch { setNDocs({}); }
        try {
          const { data: am } = await supabase.from('analises_mercado').select('imovel_id,result,updated_at').eq('user_id', uid).in('imovel_id', imovelIds).eq('status', 'concluida').order('updated_at', { ascending: false });
          const mm = {}; (am || []).forEach(x => { if (!(x.imovel_id in mm)) mm[x.imovel_id] = x.result?.valorMercado ?? null; }); setMercado(mm);
        } catch { setMercado({}); }
      } else { setNDocs({}); setMercado({}); }
    } else { setSaldos({}); setNDocs({}); setMercado({}); }
    setLoading(false);
  }, [uid]);
  React.useEffect(() => { carregar(); }, [carregar]);

  // Veio de "✅ Arrematei!" (Painel) com o imóvel pré-preenchido → abre o registro.
  // Em modo suporte não abre (o registro é ação do próprio assinante).
  React.useEffect(() => {
    if (loc.state?.prefill && !soLeitura) {
      setPrefill(loc.state.prefill);
      setNovo(true);
      nav('.', { replace: true, state: {} }); // não reabre ao voltar
    }
  }, [loc.state]); // eslint-disable-line

  const sugestoes = React.useMemo(() => {
    const by = {};
    [...(analises || []), ...(documentais || [])].forEach(a => { if (a?.imovelId && !by[a.imovelId]) by[a.imovelId] = a; });
    return Object.values(by);
  }, [analises, documentais]);

  const criar = async (payload) => {
    const { data, error } = await supabase.from('arrematados').insert({ user_id: uid, status: 'arrematado', ...payload }).select().single();
    if (!error && data) {
      if (payload.valor_arrematacao) {
        await supabase.from('arrematado_lancamentos').insert({ arrematado_id: data.id, user_id: uid, tipo: 'saida', categoria: 'Arrematação', valor: payload.valor_arrematacao, data: payload.data_arrematacao || null });
      }
      setNovo(false);
      setPrefill(null);
      await carregar();
      // Abre a tela do arremate já nos Documentos — é onde anexa auto/carta,
      // contrato do banco, escritura, matrícula registrada.
      setSel({ ...data, _abaInicial: 'documentos' });
    }
  };

  const remover = async (id, e) => {
    e.stopPropagation();
    if (!confirm('Remover este arrematado? Os lançamentos e a lista de documentos serão apagados.')) return;
    await supabase.from('arrematados').delete().eq('id', id);
    setArrematados(prev => prev.filter(a => a.id !== id));
  };

  const acaoBtn = (label, Icon, cor, onClick) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'white', color: cor, border: `1px solid ${cor}33`, borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? '16px 12px' : '28px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {sel ? (
        <Detalhe arr={sel} soLeitura={soLeitura} onBack={() => { setSel(null); carregar(); }} onChange={(u) => { setSel(u); setArrematados(prev => prev.map(a => a.id === u.id ? u : a)); }} />
      ) : (
      <>
      <div>
        <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>BidPro Brasil</div>
        <h1 style={{ fontSize: 24, fontWeight: 900, color: '#111', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Home size={22} color="#059669" /> Meus Arrematados
        </h1>
      </div>

      {soLeitura && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '9px 12px', fontSize: 12.5, color: '#9a3412', fontWeight: 600 }}>
          👁 Modo suporte — somente visualização. Você acompanha as telas do assinante para orientá-lo; alterações são feitas por ele.
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {!soLeitura && acaoBtn('Registrar arrematação', Plus, '#059669', () => setNovo(true))}
        {acaoBtn('Minhas análises', Search, '#0D63DB', () => nav('/analises'))}
      </div>

      {loading ? (
        <div style={{ color: '#94a3b8', fontSize: 14, padding: 20 }}>Carregando…</div>
      ) : arrematados.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
          <Home size={40} color="#cbd5e1" />
          <div style={{ fontSize: 15, fontWeight: 800, color: '#334155', margin: '14px 0 6px' }}>Nenhum imóvel arrematado ainda</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18, lineHeight: 1.5 }}>{soLeitura ? 'O assinante ainda não registrou nenhuma arrematação.' : 'Registre uma arrematação para acompanhar seus documentos e o financeiro do lote.'}</div>
          {!soLeitura && (
            <button onClick={() => setNovo(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', background: '#059669', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
              <Plus size={16} /> Registrar arrematação
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {arrematados.map(a => {
            const foto = fotoImovel(a.imovel);
            const st = STATUS[a.status] || STATUS.arrematado;
            const saldo = saldos[a.id] || 0;
            const docsCount = a.imovel_id ? (nDocs[a.imovel_id] || 0) : (Array.isArray(a.documentos) ? a.documentos.length : 0);
            const arrematacao = Number(a.valor_arrematacao) || null;
            const vMerc = a.imovel_id ? (mercado[a.imovel_id] ?? null) : null;
            const lucro = (vMerc != null && arrematacao != null) ? (vMerc - arrematacao) : null;
            return (
              <div key={a.id} onClick={() => setSel(a)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; }}>
                <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {foto ? <img src={foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} /> : <Building2 size={22} color="#cbd5e1" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.titulo || 'Imóvel'}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b' }}>{[a.cidade, a.estado].filter(Boolean).join(', ')}</div>
                  <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: st.bg, color: st.c }}>{st.l}</span>
                    <span style={{ color: '#94a3b8' }}><FileText size={11} style={{ verticalAlign: -1 }} /> {docsCount} doc{docsCount !== 1 ? 's' : ''}</span>
                    {arrematacao != null && <span style={{ color: '#0D63DB', fontWeight: 700 }}>Arremat. {brl(arrematacao)}</span>}
                    {vMerc != null && <span style={{ color: '#0d9488', fontWeight: 700 }}>Mercado {brl(vMerc)}</span>}
                    {lucro != null && <span style={{ color: lucro >= 0 ? '#15803d' : '#dc2626', fontWeight: 700 }}>Lucro×merc. {lucro >= 0 ? '+' : ''}{brl(lucro)}</span>}
                    <span style={{ fontWeight: 700, color: saldo >= 0 ? '#0D63DB' : '#dc2626' }}>Saldo {brl(saldo)}</span>
                  </div>
                </div>
                {!soLeitura && <button onClick={(e) => remover(a.id, e)} title="Remover" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4, flexShrink: 0 }}>×</button>}
              </div>
            );
          })}
        </div>
      )}
      </>
      )}

      {novo && <NovoArrematado onClose={() => { setNovo(false); setPrefill(null); }} onCriar={criar} sugestoes={sugestoes} inicial={prefill} />}
    </div>
  );
}
