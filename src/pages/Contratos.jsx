import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, CheckCircle2, Clock, ShieldCheck, X, Users, MapPin, Download, Plus, Trash2, Link2, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { useIsMobile } from '../utils/useIsMobile';
import AssinaturaCanvas from '../components/AssinaturaCanvas';
import { gerarContratoPDF } from '../components/ContratoPDF';

// TELA ÚNICA de contratos (pedido do dono: um só visual, funcionalidades juntas).
// - CLIENTE/equipe não-admin: vê os PRÓPRIOS contratos (ler, assinar, ver assinantes, comprovante).
// - ADMIN: vê TODOS os contratos (agrupados por grupo) e gerencia — abrir documento, signatários
//   (com edição e link), ATRIBUIR a um usuário/arrematação (mesmo assinado), baixar com assinaturas,
//   excluir. Criar novo contrato pelo botão "Novo contrato" (→ /contratos/novo).
const STAFF = ['admin', 'consultor', 'analista', 'advogado'];

async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function capturarGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null), { timeout: 6000 });
  });
}

const STATUS_INFO = {
  rascunho:              { label: 'Em preparação',             cor: '#64748b', bg: '#f1f5f9' },
  aguardando_assinatura: { label: 'Aguardando assinatura',     cor: '#d97706', bg: '#fef3c7' },
  aguardando:            { label: 'Aguardando assinatura',     cor: '#d97706', bg: '#fef3c7' },
  assinado:              { label: 'Assinado',                  cor: '#059669', bg: '#dcfce7' },
  cancelado:             { label: 'Cancelado',                 cor: '#dc2626', bg: '#fee2e2' },
};

const S = {
  input: { width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, color: '#111111', boxSizing: 'border-box', outline: 'none' },
  label: { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 },
  secao: { marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0' },
};

export default function Contratos() {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { user, effectiveUserId, loading: authLoading, role } = useAuth();
  const isStaff = STAFF.includes(role);
  const isAdmin = role === 'admin';
  const [grupos, setGrupos] = useState([]);       // [{ rep, linhas, total, assinados, statusAgg }]
  const [loading, setLoading] = useState(true);

  // Roster (assinantes)
  const [partesDe, setPartesDe] = useState(null);
  const [partes, setPartes] = useState([]);
  const [partesLoad, setPartesLoad] = useState(false);

  // Assinatura (cliente)
  const [aberto, setAberto] = useState(null);
  const [assinatura, setAssinatura] = useState('');
  const [cpfAssinante, setCpfAssinante] = useState('');
  const [aceite, setAceite] = useState(false);
  const [geo, setGeo] = useState(null);
  const [geoStatus, setGeoStatus] = useState('idle');
  const [usaTestemunha, setUsaTestemunha] = useState(false);
  const [nomeTest, setNomeTest] = useState('');
  const [cpfTest, setCpfTest] = useState('');
  const [assinaturaTest, setAssinaturaTest] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  // Gestão (admin)
  const [detalhe, setDetalhe] = useState(null);   // { ...rep, _grupo }
  const [roster, setRoster] = useState([]);
  const [rosterLoad, setRosterLoad] = useState(false);
  const [editParte, setEditParte] = useState(null);
  const [savingParte, setSavingParte] = useState(false);
  // Atribuição a usuário/arrematação
  const [atrUserBusca, setAtrUserBusca] = useState('');
  const [atrUserRes, setAtrUserRes] = useState([]);
  const [atrUser, setAtrUser] = useState(null);
  const [atrArrematacoes, setAtrArrematacoes] = useState([]);
  const [atrBusy, setAtrBusy] = useState(false);

  // Agrupa linhas por contrato_grupo_id (uma linha por parte) → um card por grupo.
  const agrupar = (linhas) => {
    const m = new Map();
    for (const cl of linhas) {
      const gid = cl.contrato_grupo_id || cl.id;
      if (!m.has(gid)) m.set(gid, { gid, rep: cl, linhas: [] });
      m.get(gid).linhas.push(cl);
    }
    return Array.from(m.values()).map(g => {
      const total = g.linhas.length;
      const assinados = g.linhas.filter(l => l.status === 'assinado' || l.assinado_em).length;
      return { ...g, total, assinados, statusAgg: assinados >= total ? 'assinado' : 'aguardando' };
    });
  };

  const carregar = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    // ADMIN: todos os contratos. Demais: só os do próprio e-mail (RLS já garante o escopo).
    let q = supabase.from('contratos_link').select('*').neq('status', 'cancelado').order('criado_em', { ascending: false });
    if (!isAdmin) q = q.eq('assinante_email', user.email);
    const { data } = await q;
    setGrupos(agrupar(data || []));
    setLoading(false);
  }, [user, isAdmin]);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!user) return;
    apiCall('/api/cpf-revelar', { method: 'POST', body: JSON.stringify({ ids: [user.id], full: true }) })
      .then(r => r.json()).then(d => { const c = d?.cpfs?.[user.id]; if (c) setCpfAssinante(c); }).catch(() => {});
  }, [user]);

  // ── Roster (assinantes) — comum aos dois modos ──
  const verAssinantes = async (g) => {
    setPartesDe(g.rep); setPartes([]); setPartesLoad(true);
    try {
      if (g.rep.contrato_grupo_id) {
        const { data } = await supabase.rpc('get_partes_contrato', { p_grupo_id: g.rep.contrato_grupo_id });
        setPartes(Array.isArray(data) && data.length ? data : montarRoster(g));
      } else setPartes(montarRoster(g));
    } catch { setPartes(montarRoster(g)); }
    setPartesLoad(false);
  };
  const montarRoster = (g) => g.linhas.map(l => ({
    id: l.id, nome: l.dados_signatario?.nome || l.dados_signatario?.razao_social || l.assinante_email,
    email: l.assinante_email, assinou: l.status === 'assinado' || !!l.assinado_em, assinado_em: l.assinado_em,
    requer_testemunha: !!l.requer_testemunha, testemunha_assinou: !!l.testemunha_em, nome_testemunha: l.nome_testemunha,
  }));

  // ── CLIENTE: abrir para ler/assinar/visualizar ──
  const abrir = (c) => {
    setAberto(c); setAssinatura(''); setAceite(false);
    setUsaTestemunha(false); setNomeTest(''); setCpfTest(''); setAssinaturaTest('');
    setGeo(null); setGeoStatus('idle'); setErro('');
  };
  const buscarGeo = async () => { setGeoStatus('buscando'); const g = await capturarGeo(); if (g) { setGeo(g); setGeoStatus('ok'); } else setGeoStatus('negado'); };
  const assinar = async () => {
    setErro('');
    if (!assinatura) { setErro('Assine no campo indicado para continuar.'); return; }
    if (!aceite) { setErro('Marque o aceite dos termos do contrato.'); return; }
    if (usaTestemunha) {
      if (!nomeTest.trim()) { setErro('Informe o nome da testemunha.'); return; }
      if (!cpfTest.trim()) { setErro('Informe o CPF da testemunha.'); return; }
      if (!assinaturaTest) { setErro('A testemunha deve assinar no campo indicado.'); return; }
    }
    setSalvando(true);
    try {
      const carimbo = new Date().toISOString();
      const hash = await sha256(aberto.conteudo + '|' + assinatura + '|' + carimbo);
      const payload = {
        status: 'assinado', assinatura_data: assinatura, assinante_nome: user?.user_metadata?.nome || '',
        assinante_cpf: cpfAssinante.trim() || null, assinatura_hash: hash, assinado_em: carimbo,
        latitude: geo?.lat || null, longitude: geo?.lng || null,
      };
      if (usaTestemunha) { payload.nome_testemunha = nomeTest.trim(); payload.cpf_testemunha = cpfTest.trim(); payload.assinatura_testemunha = assinaturaTest; payload.testemunha_em = carimbo; }
      const { error } = await supabase.from('contratos_link').update(payload).eq('id', aberto.id);
      if (error) throw error;
      setAberto(null); await carregar();
    } catch (e) { setErro('Não foi possível registrar a assinatura. ' + (e.message || '')); }
    setSalvando(false);
  };
  const baixarComprovante = (c) => {
    const linhas = [
      `COMPROVANTE DE CONTRATO ASSINADO`, `Título: ${c.titulo}`, ``, `──────────────────────────────────────`,
      c.conteudo, `──────────────────────────────────────`, ``, `DADOS DE ASSINATURA`,
      `Assinante: ${c.assinante_nome || '—'}`, `CPF: ${c.assinante_cpf || '—'}`,
      `Data/Hora: ${c.assinado_em ? new Date(c.assinado_em).toLocaleString('pt-BR') : '—'}`,
      `Hash SHA-256: ${c.assinatura_hash || '—'}`,
    ];
    const blob = new Blob([linhas.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `contrato-${c.id.slice(0, 8)}.txt`; a.click(); URL.revokeObjectURL(url);
  };

  // ── ADMIN: detalhe/gestão ──
  const abrirDetalhe = async (g) => {
    setDetalhe({ ...g.rep, _grupo: g }); setEditParte(null); setRoster([]); setRosterLoad(true);
    setAtrUser(null); setAtrUserBusca(''); setAtrArrematacoes([]);
    try {
      let ps = [];
      if (g.rep.contrato_grupo_id) { const { data } = await supabase.rpc('get_partes_contrato', { p_grupo_id: g.rep.contrato_grupo_id }); ps = Array.isArray(data) ? data : []; }
      if (!ps.length) ps = montarRoster(g);
      setRoster(ps);
    } catch { setRoster(montarRoster(g)); }
    setRosterLoad(false);
  };
  const excluirGrupo = async () => {
    const g = detalhe?._grupo; if (!g) return;
    if (!window.confirm(`Excluir DEFINITIVAMENTE este documento${g.total > 1 ? ` e as ${g.total} partes` : ''}? Não dá para desfazer.`)) return;
    try {
      if (g.rep.contrato_grupo_id) await supabase.from('contratos_link').delete().eq('contrato_grupo_id', g.rep.contrato_grupo_id);
      else await supabase.from('contratos_link').delete().eq('id', g.rep.id);
    } catch (e) { alert('Erro ao excluir: ' + (e?.message || e)); return; }
    setDetalhe(null); carregar();
  };
  const salvarSignatario = async () => {
    if (!editParte?.id) return;
    setSavingParte(true);
    try {
      const linha = (detalhe?._grupo?.linhas || []).find(l => l.id === editParte.id) || {};
      const dados = { ...(linha.dados_signatario || {}) };
      if (editParte.nome != null) dados.nome = editParte.nome;
      if (editParte.cpf != null) dados.cpf = editParte.cpf;
      const patch = { dados_signatario: dados };
      if (editParte.email != null) patch.assinante_email = editParte.email;
      const { error } = await supabase.from('contratos_link').update(patch).eq('id', editParte.id);
      if (error) throw error;
      setRoster(rs => rs.map(x => x.id === editParte.id ? { ...x, nome: editParte.nome, email: editParte.email } : x));
      setEditParte(null); carregar();
    } catch (e) { alert('Não foi possível salvar: ' + (e?.message || e)); }
    setSavingParte(false);
  };
  const copiarTexto = (t) => { if (t) { navigator.clipboard?.writeText(t); alert('Link copiado.'); } };
  // VER DOCUMENTO: abre DIRETO o arquivo com as assinaturas que existem (documento + manifesto).
  // Não assinado → sai não assinado; 1 de 2 → mostra parcial; todos → todas as assinaturas.
  const verDocumento = async (g) => {
    let roster = [];
    try {
      if (g.rep.contrato_grupo_id) {
        const { data } = await supabase.rpc('get_partes_contrato', { p_grupo_id: g.rep.contrato_grupo_id });
        roster = Array.isArray(data) ? data : [];
      }
    } catch { /* segue sem roster (cai no fallback do PDF) */ }
    if (isAdmin && g.linhas?.length) {
      roster = g.linhas.map(l => ({
        nome: l.dados_signatario?.nome || l.dados_signatario?.razao_social || l.assinante_email,
        assinou: l.status === 'assinado' || !!l.assinado_em, assinado_em: l.assinado_em, _full: true,
        dados_signatario: l.dados_signatario, assinatura: l.assinatura, assinante_ip: l.assinante_ip,
        assinante_geo: l.assinante_geo, assinante_user_agent: l.assinante_user_agent,
        dados_complementados_em: l.dados_complementados_em, token: l.token, email: l.assinante_email,
        assinatura_testemunha: l.assinatura_testemunha, nome_testemunha: l.nome_testemunha,
        requer_testemunha: !!l.requer_testemunha, testemunha_assinou: !!l.testemunha_em,
      }));
    } else {
      roster = roster.map(p => ({ ...p, eu: p.email === user?.email }));
    }
    try { await gerarContratoPDF({ contrato: g.rep, roster }); } catch { alert('Não foi possível gerar o documento.'); }
  };
  const baixarComAssinaturas = () => {
    if (!detalhe?._grupo) return;
    const rosterFull = detalhe._grupo.linhas.map(l => ({
      nome: l.dados_signatario?.nome || l.dados_signatario?.razao_social || l.assinante_email,
      assinou: l.status === 'assinado' || !!l.assinado_em, assinado_em: l.assinado_em, _full: true,
      dados_signatario: l.dados_signatario, assinatura: l.assinatura, assinante_ip: l.assinante_ip,
      assinante_geo: l.assinante_geo, assinante_user_agent: l.assinante_user_agent,
      dados_complementados_em: l.dados_complementados_em, token: l.token, email: l.assinante_email,
      assinatura_testemunha: l.assinatura_testemunha, nome_testemunha: l.nome_testemunha,
      requer_testemunha: !!l.requer_testemunha, testemunha_assinou: !!l.testemunha_em,
    }));
    try { gerarContratoPDF({ contrato: detalhe, roster: rosterFull }); } catch { alert('Não foi possível gerar o PDF.'); }
  };
  // Atribuição
  const buscarUsuarioAtr = async (q) => {
    setAtrUserBusca(q); setAtrUser(null); setAtrArrematacoes([]);
    if (q.trim().length < 2) { setAtrUserRes([]); return; }
    const { data } = await supabase.from('perfis').select('id, nome').ilike('nome', `%${q.trim()}%`).limit(8);
    setAtrUserRes(Array.isArray(data) ? data : []);
  };
  const escolherUsuarioAtr = async (u) => {
    setAtrUser(u); setAtrUserBusca(u.nome || '(sem nome)'); setAtrUserRes([]);
    const { data } = await supabase.from('arrematados').select('id, imovel_id, titulo, cidade, estado').eq('user_id', u.id).order('created_at', { ascending: false });
    setAtrArrematacoes(Array.isArray(data) ? data : []);
  };
  const aplicarAtribuicao = async (patch, msgOk) => {
    if (!detalhe) return;
    setAtrBusy(true);
    try {
      const q = detalhe.contrato_grupo_id
        ? supabase.from('contratos_link').update(patch).eq('contrato_grupo_id', detalhe.contrato_grupo_id)
        : supabase.from('contratos_link').update(patch).eq('id', detalhe.id);
      const { error } = await q;
      if (error) throw error;
      setDetalhe(d => (d ? { ...d, ...patch } : d));
      setAtrUser(null); setAtrUserBusca(''); setAtrArrematacoes([]);
      await carregar();
      if (msgOk) alert(msgOk);
    } catch { alert('Não foi possível atualizar a atribuição (verifique a permissão).'); }
    setAtrBusy(false);
  };
  const atribuirArrematacao = (a) => aplicarAtribuicao(
    { arremate_user_id: atrUser.id, arremate_imovel_id: a.imovel_id },
    'Documento atribuído. Aparece agora nos documentos da arrematação do usuário e entra no aprendizado da IA.');
  const tornarAvulso = () => aplicarAtribuicao({ arremate_user_id: null, arremate_imovel_id: null });

  if (authLoading || loading) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Carregando…</div>;
  if (!user) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <h2 style={{ color: '#111111' }}>Acesso restrito</h2>
        <p style={{ color: '#64748b' }}>Faça login para ver seus contratos.</p>
        <button onClick={() => nav('/login')} style={{ padding: '10px 20px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>Entrar</button>
      </div>
    );
  }

  const ehImg = (nome, url) => /\.(jpe?g|png|gif|webp)($|\?|#)/i.test(nome || '') || /\.(jpe?g|png|gif|webp)($|\?|#)/i.test(url || '');

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: isMobile ? '16px 12px' : '28px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 900, color: '#111111', margin: '0 0 4px' }}>{isAdmin ? 'Contratos' : 'Meus Contratos'}</h1>
          <p style={{ color: '#64748b', margin: 0, fontSize: 14 }}>
            {isAdmin ? 'Gestão dos documentos: assinaturas, atribuição a arrematações e download.' : 'Contratos de assessoria, clube de negócios e demais produtos.'}
          </p>
        </div>
        {isStaff && (
          <div style={{ display: 'flex', gap: 8 }}>
            {isAdmin && (
              <button onClick={() => nav('/contratos/templates')}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                <Users size={15} /> Templates equipe
              </button>
            )}
            <button onClick={() => nav('/contratos/novo')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              <Plus size={15} /> Novo contrato
            </button>
          </div>
        )}
      </div>

      {grupos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'white', borderRadius: 16, border: '1px solid #e2e8f0' }}>
          <FileText size={40} color="#94a3b8" style={{ margin: '0 auto 14px' }} />
          <h3 style={{ color: '#334155', margin: '0 0 6px' }}>Nenhum contrato ainda</h3>
          <p style={{ color: '#94a3b8', fontSize: 13 }}>{isAdmin ? 'Crie um contrato pelo botão “Novo contrato”.' : 'Quando um contrato for emitido para você, ele aparecerá aqui.'}</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {grupos.map(g => {
            const c = g.rep;
            const si = STATUS_INFO[g.statusAgg] || STATUS_INFO.rascunho;
            const aguardando = c.status === 'aguardando' || c.status === 'aguardando_assinatura';
            return (
              <div key={g.gid} style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: isMobile ? '14px 16px' : '18px 20px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'center', gap: isMobile ? 12 : 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#111111' }}>
                    {c.arremate_imovel_id && <Link2 size={13} style={{ verticalAlign: 'middle', marginRight: 4, color: '#0D63DB' }} />}
                    {c.titulo}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    {c.tipo_contrato && <span style={{ textTransform: 'capitalize' }}>{c.tipo_contrato}</span>}
                    {g.total > 1 && <span> · {g.assinados}/{g.total} assinaram</span>}
                    {c.assinado_em && <span> · Assinado em {new Date(c.assinado_em).toLocaleDateString('pt-BR')}</span>}
                    {!c.assinado_em && c.criado_em && <span> · Enviado em {new Date(c.criado_em).toLocaleDateString('pt-BR')}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: si.bg, color: si.cor, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {g.statusAgg === 'assinado' ? <CheckCircle2 size={13} /> : <Clock size={13} />} {si.label}
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => verAssinantes(g)}
                    style={{ padding: isMobile ? '10px 12px' : '8px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, minHeight: 44 }}>
                    <Users size={13} /> Assinantes
                  </button>
                  {/* Cliente aguardando a PRÓPRIA assinatura → assinar. Senão, abre o documento
                      com as assinaturas DIRETO (sem tela intermediária). */}
                  {!isAdmin && aguardando ? (
                    <button onClick={() => nav(`/c/${c.token}`)}
                      style={{ padding: isMobile ? '12px 16px' : '8px 16px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', minHeight: 44 }}>
                      Ler e assinar
                    </button>
                  ) : (
                    <button onClick={() => verDocumento(g)}
                      style={{ padding: isMobile ? '12px 16px' : '8px 16px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', minHeight: 44 }}>
                      Ver documento
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => abrirDetalhe(g)}
                      style={{ padding: isMobile ? '12px 16px' : '8px 16px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', minHeight: 44 }}>
                      Gerir
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal CLIENTE: leitura/assinatura/visualização */}
      {aberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setAberto(null)}>
          <div style={{ background: 'white', borderRadius: 18, width: '100%', maxWidth: isMobile ? '100%' : 900, maxHeight: isMobile ? '100dvh' : '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#111111' }}>{aberto.titulo}</h3>
              <button onClick={() => setAberto(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>
            <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.7, color: '#334155', background: '#f8fafc', borderRadius: 10, padding: 16, border: '1px solid #f1f5f9' }}>{aberto.conteudo}</div>
              {aberto.status === 'assinado' ? (
                <div style={{ marginTop: 18 }}>
                  <div style={{ padding: 16, background: '#dcfce7', borderRadius: 10, border: '1px solid #86efac' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#166534', marginBottom: 10 }}><ShieldCheck size={16} /> Contrato assinado eletronicamente</div>
                    {aberto.assinatura_data && <img src={aberto.assinatura_data} alt="Assinatura" style={{ maxHeight: 80, background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', padding: 6 }} />}
                    <div style={{ fontSize: 11, color: '#15803d', marginTop: 10, lineHeight: 1.8 }}>
                      <div><strong>Assinante:</strong> {aberto.assinante_nome || '—'} · CPF: {aberto.assinante_cpf || '—'}</div>
                      <div><strong>Data/Hora:</strong> {aberto.assinado_em ? new Date(aberto.assinado_em).toLocaleString('pt-BR') : '—'}</div>
                      <div style={{ wordBreak: 'break-all' }}><strong>Hash SHA-256:</strong> {aberto.assinatura_hash}</div>
                    </div>
                  </div>
                  <button onClick={() => baixarComprovante(aberto)} style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, color: '#475569', cursor: 'pointer' }}><Download size={14} /> Baixar comprovante</button>
                </div>
              ) : ['aguardando', 'aguardando_assinatura'].includes(aberto.status) ? (
                <div>
                  <div style={S.secao}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#111111', marginBottom: 12 }}>Identificação do assinante</div>
                    <label style={S.label}>CPF</label>
                    <input style={S.input} value={cpfAssinante} onChange={e => setCpfAssinante(e.target.value)} placeholder="000.000.000-00" maxLength={14} />
                  </div>
                  <div style={S.secao}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#111111', marginBottom: 8 }}>Assinatura do contratante</div>
                    <AssinaturaCanvas onChange={setAssinatura} />
                  </div>
                  <div style={S.secao}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <MapPin size={14} color="#64748b" />
                      <span style={{ fontSize: 12, color: '#64748b' }}>
                        {geoStatus === 'idle' && 'Localização não capturada (opcional — aumenta a validade jurídica)'}
                        {geoStatus === 'buscando' && 'Buscando localização…'}
                        {geoStatus === 'ok' && `Localização: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`}
                        {geoStatus === 'negado' && 'Permissão de localização negada.'}
                      </span>
                      {geoStatus === 'idle' && <button type="button" onClick={buscarGeo} style={{ marginLeft: 'auto', padding: '5px 12px', background: '#eff6ff', color: '#0D63DB', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>Capturar localização</button>}
                    </div>
                  </div>
                  <div style={S.secao}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={usaTestemunha} onChange={e => setUsaTestemunha(e.target.checked)} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#111111', display: 'flex', alignItems: 'center', gap: 6 }}><Users size={14} /> Adicionar testemunha (opcional)</span>
                    </label>
                    {usaTestemunha && (
                      <div style={{ marginTop: 14, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 12 }}>
                          <div><label style={S.label}>Nome da testemunha</label><input style={S.input} value={nomeTest} onChange={e => setNomeTest(e.target.value)} placeholder="Nome completo" /></div>
                          <div><label style={S.label}>CPF da testemunha</label><input style={S.input} value={cpfTest} onChange={e => setCpfTest(e.target.value)} placeholder="000.000.000-00" maxLength={14} /></div>
                        </div>
                        <label style={S.label}>Assinatura da testemunha</label>
                        <AssinaturaCanvas onChange={setAssinaturaTest} altura={140} />
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#475569', cursor: 'pointer' }}>
                      <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 2 }} />
                      Li e concordo integralmente com os termos deste contrato, e reconheço esta assinatura eletrônica como juridicamente válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020.
                    </label>
                  </div>
                  {erro && <div style={{ marginTop: 10, padding: '8px 12px', background: '#fee2e2', color: '#dc2626', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{erro}</div>}
                </div>
              ) : <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>Este contrato não requer assinatura.</div>}
            </div>
            {['aguardando', 'aguardando_assinatura'].includes(aberto.status) && aberto.requer_assinatura && (
              <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
                <button onClick={() => setAberto(null)} style={{ padding: '10px 18px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>Cancelar</button>
                <button onClick={assinar} disabled={salvando} style={{ padding: '10px 22px', background: '#059669', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: salvando ? 0.7 : 1 }}><ShieldCheck size={15} /> {salvando ? 'Registrando…' : 'Assinar contrato'}</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal ADMIN: gestão do documento */}
      {detalhe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setDetalhe(null)}>
          <div style={{ background: 'white', borderRadius: 18, width: '100%', maxWidth: isMobile ? '100%' : 860, maxHeight: isMobile ? '100dvh' : '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#111111' }}>{detalhe.titulo}</h3>
              <button onClick={() => setDetalhe(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>
            <div style={{ padding: '18px 22px', overflowY: 'auto', flex: 1 }}>
              {/* Signatários */}
              <div style={{ border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', marginBottom: 14, background: '#f8fbff' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#0D63DB', textTransform: 'uppercase', marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Signatários {roster.length ? `(${roster.filter(p => p.assinou).length}/${roster.length} assinaram)` : ''}</span>
                  {rosterLoad && <span style={{ color: '#94a3b8', fontWeight: 600, textTransform: 'none' }}>carregando…</span>}
                </div>
                {!rosterLoad && roster.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>Aguardando preenchimento.</div>}
                {roster.map((p, i) => {
                  const linhasG = detalhe._grupo?.linhas || [];
                  const linha = linhasG.find(l => l.id === p.id) || (p.email && linhasG.find(l => (l.assinante_email || l.dados_signatario?.email) === p.email));
                  // Link SEM hash: preview rico ("Assinatura de documento: <título>") no
                  // WhatsApp; o /c/<token> redireciona a pessoa para a tela de assinatura.
                  const linkP = linha?.token ? `${window.location.origin}/c/${linha.token}` : null;
                  const emEdicao = editParte?.id === p.id;
                  return (
                    <div key={p.id || i} style={{ borderTop: i ? '1px solid #e2e8f0' : 'none', padding: '8px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: '#111111' }}>{p.nome || <span style={{ color: '#94a3b8', fontStyle: 'italic', fontWeight: 500 }}>Aguardando preenchimento</span>}</div>
                          {p.email && <div style={{ fontSize: 11, color: '#475569' }}>{p.email}</div>}
                        </div>
                        <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: (p.assinou ? '#059669' : '#d97706') + '20', color: p.assinou ? '#059669' : '#d97706' }}>{p.assinou ? `✓ Assinou${p.assinado_em ? ' · ' + new Date(p.assinado_em).toLocaleDateString('pt-BR') : ''}` : 'Pendente'}</span>
                      </div>
                      {p.requer_testemunha && <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 2 }}>Testemunha: {p.testemunha_assinou ? '✓ assinou' : 'pendente'}</div>}
                      <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                        {!p.assinou && linkP && <button style={{ padding: '3px 8px', fontSize: 10.5, border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, cursor: 'pointer', color: '#475569' }} onClick={() => copiarTexto(linkP)}>Copiar link</button>}
                        {!p.assinou && p.id && !emEdicao && <button style={{ padding: '3px 8px', fontSize: 10.5, border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, cursor: 'pointer', color: '#475569' }} onClick={() => setEditParte({ id: p.id, nome: (linha?.dados_signatario?.nome) || p.nome || '', cpf: (linha?.dados_signatario?.cpf) || '', email: (linha?.assinante_email) || p.email || '' })}>Alterar dados</button>}
                        {p.assinou && <span style={{ fontSize: 10.5, color: '#94a3b8' }}>Assinado — dados travados (integridade).</span>}
                      </div>
                      {emEdicao && (
                        <div style={{ marginTop: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', display: 'grid', gap: 6 }}>
                          <input placeholder="Nome" value={editParte.nome} onChange={e => setEditParte(v => ({ ...v, nome: e.target.value }))} style={{ ...S.input, padding: '6px 8px', fontSize: 12 }} />
                          <input placeholder="CPF/CNPJ" value={editParte.cpf} onChange={e => setEditParte(v => ({ ...v, cpf: e.target.value }))} style={{ ...S.input, padding: '6px 8px', fontSize: 12 }} />
                          <input placeholder="E-mail" value={editParte.email} onChange={e => setEditParte(v => ({ ...v, email: e.target.value }))} style={{ ...S.input, padding: '6px 8px', fontSize: 12 }} />
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button style={{ padding: '4px 10px', fontSize: 11, border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, cursor: 'pointer', color: '#475569' }} onClick={() => setEditParte(null)} disabled={savingParte}>Cancelar</button>
                            <button style={{ padding: '4px 10px', fontSize: 11, border: 'none', background: '#0D63DB', color: 'white', borderRadius: 6, cursor: 'pointer' }} onClick={salvarSignatario} disabled={savingParte}>{savingParte ? 'Salvando…' : 'Salvar'}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Documento / conteúdo */}
              {detalhe.arquivo_url ? (
                <div style={{ marginBottom: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Documento</div>
                    <button style={{ padding: '4px 10px', fontSize: 11, border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, cursor: 'pointer', color: '#475569' }} onClick={() => window.open(detalhe.arquivo_url, '_blank', 'noopener')}>Abrir em nova aba</button>
                  </div>
                  {ehImg(detalhe.arquivo_nome, detalhe.arquivo_url)
                    ? <img src={detalhe.arquivo_url} alt="Documento" style={{ width: '100%', borderRadius: 10, maxHeight: 520, objectFit: 'contain', background: '#fff', border: '1px solid #e2e8f0' }} />
                    : <iframe src={detalhe.arquivo_url} title="Documento" style={{ width: '100%', height: '55vh', border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff' }} />}
                </div>
              ) : (
                <div style={{ background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0', padding: '14px 16px', maxHeight: 300, overflowY: 'auto', marginBottom: 14 }}>
                  <div style={{ fontSize: 13, color: '#111111', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{detalhe.conteudo}</div>
                </div>
              )}

              {/* Atribuição a arrematação */}
              <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 6 }}>🔗 Atribuição a uma arrematação</div>
                {detalhe.arremate_imovel_id ? (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 12, color: '#166534', fontWeight: 700 }}>✓ Atribuído (imóvel {String(detalhe.arremate_imovel_id).slice(0, 8)}…) — aparece nos documentos do arremate do usuário.</span>
                    <button style={{ padding: '5px 10px', fontSize: 11, border: '1px solid #e2e8f0', background: 'white', borderRadius: 6, cursor: 'pointer', color: '#475569' }} disabled={atrBusy} onClick={tornarAvulso}>Tornar avulso</button>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 8 }}>Documento avulso. Para vincular a um usuário e à arrematação dele (mesmo já assinado), busque o usuário:</div>
                    <div style={{ position: 'relative', marginBottom: (atrUser && atrArrematacoes.length) ? 8 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #e2e8f0', borderRadius: 8, padding: '2px 10px', background: 'white' }}>
                        <Search size={14} color="#94a3b8" />
                        <input value={atrUserBusca} onChange={e => buscarUsuarioAtr(e.target.value)} placeholder="Buscar usuário por nome…" style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13, padding: '7px 0', color: '#111', background: 'transparent' }} />
                      </div>
                      {atrUserRes.length > 0 && !atrUser && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden' }}>
                          {atrUserRes.map(u => <button key={u.id} onClick={() => escolherUsuarioAtr(u)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 12px', border: 'none', background: 'white', cursor: 'pointer', fontSize: 13, color: '#334155' }}>{u.nome || '(sem nome)'}</button>)}
                        </div>
                      )}
                    </div>
                    {atrUser && (atrArrematacoes.length ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div style={{ fontSize: 11, color: '#64748b' }}>Arrematações de {atrUser.nome}:</div>
                        {atrArrematacoes.map(a => <button key={a.id} disabled={atrBusy} onClick={() => atribuirArrematacao(a)} style={{ textAlign: 'left', padding: '8px 12px', fontSize: 12, border: '1px solid #e2e8f0', background: 'white', borderRadius: 8, cursor: 'pointer', color: '#334155' }}>{a.titulo || a.imovel_id}{a.cidade ? ` · ${a.cidade}/${a.estado || ''}` : ''}</button>)}
                      </div>
                    ) : <div style={{ fontSize: 12, color: '#94a3b8' }}>Esse usuário ainda não tem arrematações cadastradas.</div>)}
                  </>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <button style={{ padding: '9px 16px', border: 'none', background: '#fee2e2', color: '#dc2626', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }} onClick={excluirGrupo}><Trash2 size={14} /> Excluir documento</button>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button style={{ padding: '9px 16px', border: 'none', background: '#0D63DB', color: 'white', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }} onClick={baixarComAssinaturas}>Visualizar com assinaturas</button>
                  <button style={{ padding: '9px 16px', border: '1px solid #e2e8f0', background: 'white', color: '#475569', borderRadius: 8, fontWeight: 600, fontSize: 13, cursor: 'pointer' }} onClick={() => setDetalhe(null)}>Fechar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Assinantes (comum) */}
      {partesDe && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setPartesDe(null)}>
          <div style={{ background: 'white', borderRadius: 18, width: '100%', maxWidth: isMobile ? '100%' : 520, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #f1f5f9' }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#111111', display: 'flex', alignItems: 'center', gap: 8 }}><Users size={17} color="#0D63DB" /> Assinantes</h3>
              <button onClick={() => setPartesDe(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>
            <div style={{ padding: '14px 22px 20px', overflowY: 'auto' }}>
              <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14 }}>{partesDe.titulo}</div>
              {partesLoad ? <div style={{ color: '#94a3b8', fontSize: 13, padding: '8px 0' }}>Carregando…</div>
                : partes.length === 0 ? <div style={{ color: '#94a3b8', fontSize: 13, padding: '8px 0' }}>Não foi possível carregar as partes.</div>
                : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 10 }}>{partes.filter(p => p.assinou).length} de {partes.length} já {partes.filter(p => p.assinou).length === 1 ? 'assinou' : 'assinaram'}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {partes.map(p => (
                        <div key={p.id || p.email} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '10px 12px', background: '#f8fafc', border: '1px solid #f1f5f9', borderRadius: 10 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 700, fontSize: 13.5, color: '#111111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.nome}</div>
                            <div style={{ fontSize: 11.5, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.email}</div>
                            {p.requer_testemunha && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Testemunha: {p.testemunha_assinou ? `assinou${p.nome_testemunha ? ` (${p.nome_testemunha})` : ''}` : 'pendente'}</div>}
                          </div>
                          <span style={{ flexShrink: 0, fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20, background: p.assinou ? '#dcfce7' : '#fef3c7', color: p.assinou ? '#059669' : '#d97706', display: 'flex', alignItems: 'center', gap: 4 }}>
                            {p.assinou ? <CheckCircle2 size={12} /> : <Clock size={12} />} {p.assinou ? (p.assinado_em ? `Assinou ${new Date(p.assinado_em).toLocaleDateString('pt-BR')}` : 'Assinou') : 'Pendente'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
