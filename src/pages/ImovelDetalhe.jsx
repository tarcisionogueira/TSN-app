import React, { useEffect, useState, useRef } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Calendar, Tag, Building2, FileText, ExternalLink, BarChart2, AlertTriangle, CheckCircle, Clock, Home, Banknote, Paperclip, Upload, Trash2, ChevronDown, ChevronUp, UserCheck } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

const TIPO_ANEXO_LABEL = {
  edital: 'Edital', auto_arrematacao: 'Auto de Arrematação', carta_arrematacao: 'Carta de Arrematação',
  matricula: 'Matrícula', contrato: 'Contrato', procuracao: 'Procuração', outro: 'Outro',
};
const TIPO_DOC_LABEL = {
  identidade: 'Identidade/CPF', comprovante_pagamento: 'Comprovante de Pagamento',
  procuracao: 'Procuração', cnd: 'CND/Certidão', outro: 'Outro',
};
const STATUS_ARR = {
  em_processo: { label: 'Em Processo', bg: '#fef9c3', color: '#92400e' },
  finalizado:  { label: 'Finalizado',  bg: '#dcfce7', color: '#166534' },
  cancelado:   { label: 'Cancelado',   bg: '#fee2e2', color: '#991b1b' },
};

function SecaoArrematacao({ imovelId, imovelTitulo }) {
  const { user, role } = useAuth();
  const [dados, setDados] = useState(null); // { arrematacao, anexos, docs }
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState({ processo: true, pessoal: true });
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState({ arrematante_email: '', valor_arrematado: '', data_leilao: '', leiloeiro: '', numero_processo: '', observacoes: '' });
  const [salvando, setSalvando] = useState(false);
  const [uploadando, setUploadando] = useState({});
  const inputProcessoRef = useRef();
  const inputPessoalRef = useRef();

  const ROLES_ESCRITA = ['admin', 'analista'];
  const ROLES_LEITURA = ['admin', 'analista', 'advogado', 'consultor'];
  const podeVer = ROLES_LEITURA.includes(role) || dados?.arrematacao?.arrematante_id === user?.id;
  const podeEscrever = ROLES_ESCRITA.includes(role);
  const podeAnexo = podeEscrever || role === 'advogado';

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token;

  const carregar = async () => {
    setLoading(true);
    try {
      const t = await token();
      const r = await fetch(`/api/arrematacoes?imovel_id=${imovelId}`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) setDados(await r.json());
    } finally { setLoading(false); }
  };

  useEffect(() => { if (user && (ROLES_LEITURA.includes(role) || role === 'assessorado' || role === 'explorador')) carregar(); else setLoading(false); }, [user, role]); // eslint-disable-line

  const registrar = async () => {
    setSalvando(true);
    try {
      // Busca arrematante pelo email
      const { data: perfis } = await supabase.from('perfis').select('id,nome').ilike('email', form.arrematante_email.trim()).limit(1);
      if (!perfis?.length) { alert('Usuário não encontrado com esse email'); setSalvando(false); return; }
      const arrematante_id = perfis[0].id;
      const t = await token();
      const r = await fetch('/api/arrematacoes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imovel_id: imovelId, arrematante_id, valor_arrematado: parseFloat(form.valor_arrematado) || null, data_leilao: form.data_leilao || null, leiloeiro: form.leiloeiro, numero_processo: form.numero_processo, observacoes: form.observacoes }),
      });
      if (r.ok) { setModalAberto(false); carregar(); }
      else { const e = await r.json(); alert(e.error || 'Erro ao registrar'); }
    } finally { setSalvando(false); }
  };

  const atualizarStatus = async (status) => {
    const t = await token();
    await fetch(`/api/arrematacoes?id=${dados.arrematacao.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    carregar();
  };

  const uploadAnexo = async (file, tabela) => {
    if (!file) return;
    const key = `${tabela}_${file.name}`;
    setUploadando(u => ({ ...u, [key]: true }));
    try {
      const t = await token();
      const arrId = dados?.arrematacao?.id || 'geral';
      const tipo = tabela === 'imovel' ? 'outro' : 'outro';
      const nomeArq = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // Pega URL assinada
      const signR = await fetch(`/api/arrematacoes?signed_url=1&arrematacao_id=${arrId}&tipo=${tipo}&nome=${nomeArq}&tabela=${tabela}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!signR.ok) { alert('Erro ao preparar upload'); return; }
      const { signedURL, publicUrl } = await signR.json();

      // Upload direto para Storage
      const upR = await fetch(signedURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      if (!upR.ok) { alert('Erro no upload'); return; }

      // Salva registro
      if (tabela === 'imovel') {
        const r = await fetch(`/api/arrematacoes?anexo=1`, {
          method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ arrematacao_id: arrId, imovel_id: imovelId, tipo, nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) }),
        });
        if (!r.ok) alert('Erro ao registrar anexo');
      } else {
        await supabase.from('usuario_docs').insert({ user_id: user.id, arrematacao_id: arrId, tipo, nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) });
      }
      carregar();
    } finally { setUploadando(u => ({ ...u, [key]: false })); }
  };

  const deletarAnexo = async (id, tabela) => {
    if (!confirm('Remover documento?')) return;
    const t = await token();
    await fetch(`/api/arrematacoes?id=${id}&tabela=${tabela}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
    carregar();
  };

  const deletarDocPessoal = async (id) => {
    if (!confirm('Remover documento?')) return;
    await supabase.from('usuario_docs').delete().eq('id', id).eq('user_id', user.id);
    carregar();
  };

  if (!user || loading) return null;
  if (!podeVer && !podeEscrever) return null;

  const arr = dados?.arrematacao;
  const statusInfo = arr ? (STATUS_ARR[arr.status] || STATUS_ARR.em_processo) : null;

  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 24, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: arr ? 16 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserCheck size={18} color="#7c3aed" />
          <span style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Arrematação</span>
          {arr && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999, background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {arr && podeEscrever && arr.status === 'em_processo' && (
            <button onClick={() => atualizarStatus('finalizado')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#dcfce7', color: '#166534', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>✓ Finalizar</button>
          )}
          {arr && podeEscrever && arr.status !== 'cancelado' && (
            <button onClick={() => atualizarStatus('cancelado')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#fee2e2', color: '#991b1b', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>✕ Cancelar</button>
          )}
          {!arr && podeEscrever && (
            <button onClick={() => setModalAberto(true)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7c3aed', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Registrar Arrematação</button>
          )}
        </div>
      </div>

      {arr && (
        <>
          {/* Info da arrematação */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 14 }}>
            {arr.arrematante_nome && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>ARREMATANTE</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.arrematante_nome}</div></div>}
            {arr.valor_arrematado && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>VALOR ARREMATADO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>R$ {Number(arr.valor_arrematado).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div></div>}
            {arr.data_leilao && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>DATA DO LEILÃO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{new Date(arr.data_leilao + 'T12:00:00').toLocaleDateString('pt-BR')}</div></div>}
            {arr.leiloeiro && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>LEILOEIRO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.leiloeiro}</div></div>}
            {arr.numero_processo && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Nº PROCESSO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.numero_processo}</div></div>}
          </div>
          {arr.observacoes && <div style={{ fontSize: 13, color: '#475569', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>{arr.observacoes}</div>}

          {/* Documentos do processo */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 12 }}>
            <button onClick={() => setAberto(a => ({ ...a, processo: !a.processo }))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#111' }}>
                <Paperclip size={14} color="#7c3aed" /> Documentos do Processo
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>({(dados.anexos || []).length})</span>
              </div>
              {aberto.processo ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
            </button>
            {aberto.processo && (
              <div style={{ padding: '0 16px 14px' }}>
                {(dados.anexos || []).length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>Nenhum documento adicionado.</div>}
                {(dados.anexos || []).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileText size={14} color="#7c3aed" />
                      <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0D63DB', fontWeight: 600, textDecoration: 'none' }}>{a.nome}</a>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{TIPO_ANEXO_LABEL[a.tipo] || a.tipo}</span>
                    </div>
                    {podeEscrever && <button onClick={() => deletarAnexo(a.id, 'imovel_anexos')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={13} /></button>}
                  </div>
                ))}
                {podeAnexo && (
                  <div style={{ marginTop: 10 }}>
                    <input ref={inputProcessoRef} type="file" style={{ display: 'none' }} onChange={e => { uploadAnexo(e.target.files[0], 'imovel'); e.target.value = ''; }} />
                    <button onClick={() => inputProcessoRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px dashed #c4b5fd', background: '#faf5ff', color: '#7c3aed', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      <Upload size={13} /> Adicionar documento
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Documentos pessoais (só o arrematante e admin/analista) */}
          {(arr.arrematante_id === user?.id || podeEscrever) && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10 }}>
              <button onClick={() => setAberto(a => ({ ...a, pessoal: !a.pessoal }))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#111' }}>
                  👤 Meus Documentos
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>({(dados.docs || []).length}) · privado</span>
                </div>
                {aberto.pessoal ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
              </button>
              {aberto.pessoal && (
                <div style={{ padding: '0 16px 14px' }}>
                  {(dados.docs || []).length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>Nenhum documento pessoal adicionado.</div>}
                  {(dados.docs || []).map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText size={14} color="#0891b2" />
                        <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0D63DB', fontWeight: 600, textDecoration: 'none' }}>{d.nome}</a>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{TIPO_DOC_LABEL[d.tipo] || d.tipo}</span>
                      </div>
                      <button onClick={() => deletarDocPessoal(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <div style={{ marginTop: 10 }}>
                    <input ref={inputPessoalRef} type="file" style={{ display: 'none' }} onChange={async e => {
                      const file = e.target.files[0]; if (!file) return;
                      const key = `pessoal_${file.name}`; setUploadando(u => ({ ...u, [key]: true }));
                      try {
                        const t = await token();
                        const arrId = dados?.arrematacao?.id || 'geral';
                        const nomeArq = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                        const signR = await fetch(`/api/arrematacoes?signed_url=1&arrematacao_id=${arrId}&tipo=outro&nome=${nomeArq}&tabela=usuario`, { headers: { Authorization: `Bearer ${t}` } });
                        if (!signR.ok) { alert('Erro ao preparar upload'); return; }
                        const { signedURL, publicUrl } = await signR.json();
                        const upR = await fetch(signedURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
                        if (!upR.ok) { alert('Erro no upload'); return; }
                        await supabase.from('usuario_docs').insert({ user_id: user.id, arrematacao_id: arrId, tipo: 'outro', nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) });
                        carregar();
                      } finally { setUploadando(u => ({ ...u, [key]: false })); e.target.value = ''; }
                    }} />
                    <button onClick={() => inputPessoalRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px dashed #bae6fd', background: '#f0f9ff', color: '#0891b2', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      <Upload size={13} /> Adicionar meu documento
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal registrar arrematação */}
      {modalAberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setModalAberto(false); }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Registrar Arrematação</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>{imovelTitulo}</div>
            {[
              { label: 'E-mail do arrematante *', key: 'arrematante_email', type: 'email', placeholder: 'usuario@email.com' },
              { label: 'Valor arrematado (R$)', key: 'valor_arrematado', type: 'number', placeholder: '0,00' },
              { label: 'Data do leilão', key: 'data_leilao', type: 'date' },
              { label: 'Leiloeiro', key: 'leiloeiro', type: 'text', placeholder: 'Nome do leiloeiro' },
              { label: 'Nº do Processo', key: 'numero_processo', type: 'text', placeholder: '0000000-00.0000.0.00.0000' },
            ].map(({ label, key, type, placeholder }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>{label}</label>
                <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
              </div>
            ))}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Observações</label>
              <textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} rows={3} placeholder="Informações adicionais..."
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setModalAberto(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#475569' }}>Cancelar</button>
              <button onClick={registrar} disabled={salvando || !form.arrematante_email} style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: salvando ? '#c4b5fd' : '#7c3aed', color: 'white', fontWeight: 700, fontSize: 13, cursor: salvando ? 'default' : 'pointer' }}>{salvando ? 'Salvando...' : 'Registrar Arrematação'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const TIPO_LABEL = { casa:'Casa', apartamento:'Apartamento', terreno:'Terreno/Lote', comercial:'Comercial', rural:'Rural', galpao:'Galpão', sala:'Sala Comercial', vaga:'Vaga de Garagem', imovel:'Imóvel' };
const MODAL_LABEL = { primeiro_leilao:'1ª Praça', segundo_leilao:'2ª Praça', venda_direta:'Venda Direta', licitacao_aberta:'Licitação Aberta', extrajudicial:'Extrajudicial', judicial:'Judicial' };
const fmtBRL = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';

function fmtData(d, modalidade) {
  if (!d) return modalidade === 'venda_direta' ? 'Venda Direta' : 'Sem data definida';
  const dt = new Date(d);
  return dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

const PLANOS_ANALISE = ['top1','top2','assessorado','clube','analista','admin'];

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

      {/* Seção Arrematação — visível para roles com acesso ou se for o arrematante */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 20px 40px' }}>
        <SecaoArrematacao imovelId={id} imovelTitulo={imovel.titulo} />
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
