import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, CheckCircle2, Send, Paperclip, Bot, Loader2, UserCheck, RefreshCw, AlertCircle, Clock, User } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';

const STATUS_CFG = {
  aberto:               { label: 'Aberto',             cor: '#10b981', bg: '#d1fae5' },
  aguardando_atendente: { label: 'Aguarda atendente',  cor: '#f59e0b', bg: '#fef3c7' },
  em_atendimento:       { label: 'Em atendimento',     cor: '#0D63DB', bg: '#dbeafe' },
  finalizado:           { label: 'Finalizado',         cor: '#64748b', bg: '#f1f5f9' },
};

// Segmento do solicitante — para priorizar e organizar a fila.
// Ordem = prioridade de atendimento (do cliente mais valioso ao curioso).
const SEGMENTOS = {
  interno:     { label: 'Interno / Jurídico', curto: 'Interno', cor: '#0f766e', bg: '#ccfbf1' },
  clube:       { label: 'Leilão Club',   curto: 'Club',      cor: '#7c3aed', bg: '#f3e8ff' },
  assessorado: { label: 'Assessorado',   curto: 'Assessor.', cor: '#b45309', bg: '#fef3c7' },
  investidor:  { label: 'Investidor Pro', curto: 'Inv. Pro', cor: '#0D63DB', bg: '#dbeafe' },
  explorador:  { label: 'Explorador',    curto: 'Explorad.', cor: '#0891b2', bg: '#cffafe' },
  curioso:     { label: 'Curioso',       curto: 'Curioso',   cor: '#64748b', bg: '#f1f5f9' },
  outro:       { label: 'Outro',         curto: 'Outro',     cor: '#94a3b8', bg: '#f8fafc' },
};
const ORDEM_SEG = ['interno', 'clube', 'assessorado', 'investidor', 'explorador', 'curioso'];
// Resolve o segmento de um chamado (curioso = sem cadastro).
const segOf = c => c.segmento || (c.user_id ? 'outro' : 'curioso');

// Escopo de atendimento por papel (espelha a RLS no banco).
// null = vê todos. [] = não atende clientes (canal interno).
const ESCOPO_PAPEL = {
  admin: null,
  consultor: ['curioso', 'explorador', 'outro'], // não-clientes (Comercial)
  analista: ['investidor', 'assessorado', 'clube', 'interno'], // clientes + jurídico interno
  advogado: [], // responde por e-mail; não acessa o painel de clientes
};

export default function Atendimento() {
  const { user, effectiveRole } = useAuth();
  const escopo = ESCOPO_PAPEL[effectiveRole] ?? []; // papéis fora da lista não atendem
  const segsVisiveis = (escopo === null ? ORDEM_SEG : ORDEM_SEG.filter(s => escopo.includes(s)));
  const [chamados, setChamados] = useState([]);
  const [filtro, setFiltro] = useState('pendentes');
  const [segFiltro, setSegFiltro] = useState('todos');
  const [chamadoAtivo, setChamadoAtivo] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const fileRef = useRef();
  const msgEndRef = useRef();

  const nomeAtendente = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Atendente';

  useEffect(() => { carregarChamados(); }, [filtro]);
  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensagens]);

  // Realtime: novos chamados e atualizações
  useEffect(() => {
    const ch = supabase.channel('fila-suporte')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chamados' }, (p) => {
        carregarChamados();
        if (p.new?.id) setChamadoAtivo(prev => prev?.id === p.new.id ? { ...prev, ...p.new } : prev);
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [filtro]);

  // Realtime: mensagens do chamado ativo
  useEffect(() => {
    if (!chamadoAtivo) return;
    const ch = supabase.channel(`atend-msg-${chamadoAtivo.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chamados_mensagens', filter: `chamado_id=eq.${chamadoAtivo.id}` },
        p => setMensagens(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [chamadoAtivo?.id]);

  async function carregarChamados() {
    setLoading(true);
    let q = supabase.from('chamados').select('*').order('criado_em', { ascending: true });
    if (filtro === 'pendentes') q = q.in('status', ['aberto', 'aguardando_atendente', 'em_atendimento']);
    else if (filtro !== 'todos') q = q.eq('status', filtro);
    const { data, error } = await q;
    if (!error) {
      const ordem = { aguardando_atendente: 0, aberto: 1, em_atendimento: 2, finalizado: 3 };
      const sorted = (data || []).sort((a, b) => (ordem[a.status] ?? 9) - (ordem[b.status] ?? 9));
      setChamados(sorted);
    }
    setLoading(false);
  }

  async function abrirChamado(c) {
    setChamadoAtivo(c);
    const { data } = await supabase.from('chamados_mensagens').select('*')
      .eq('chamado_id', c.id).order('criado_em', { ascending: true });
    setMensagens(data || []);
  }

  async function assumirChamado() {
    if (!chamadoAtivo) return;
    await supabase.from('chamados').update({
      status: 'em_atendimento', atendente_id: user.id,
      atendente_nome: nomeAtendente, atualizado_em: new Date().toISOString(),
    }).eq('id', chamadoAtivo.id);
    setChamadoAtivo(p => ({ ...p, status: 'em_atendimento', atendente_id: user.id, atendente_nome: nomeAtendente }));
  }

  async function finalizarChamado() {
    if (!chamadoAtivo || !window.confirm(`Finalizar o chamado "${chamadoAtivo.titulo}"?`)) return;
    await supabase.from('chamados').update({ status: 'finalizado', atualizado_em: new Date().toISOString() }).eq('id', chamadoAtivo.id);
    setChamadoAtivo(p => ({ ...p, status: 'finalizado' }));
  }

  async function enviarMensagem() {
    if ((!texto.trim() && !anexos.length) || !chamadoAtivo) return;
    setEnviando(true);
    const { data: msg, error: msgErr } = await supabase.from('chamados_mensagens').insert({
      chamado_id: chamadoAtivo.id, autor_id: user.id, autor_nome: nomeAtendente,
      autor_tipo: 'atendente', conteudo: texto || '[anexo]', anexos,
    }).select().single();
    if (msgErr) { alert('Erro ao enviar mensagem. Tente novamente.'); setEnviando(false); return; }
    if (msg) setMensagens(prev => [...prev, msg]);
    await supabase.from('chamados').update({ atualizado_em: new Date().toISOString() }).eq('id', chamadoAtivo.id);
    // Notifica o cliente por e-mail (essencial para leads sem conta)
    if (texto.trim() && chamadoAtivo.user_email) {
      apiCall('/api/notificar-cliente', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chamado_id: chamadoAtivo.id, mensagem: texto }),
      }).catch(() => {});
    }
    setTexto(''); setAnexos([]);
    setEnviando(false);
  }

  function handlePaste(e) {
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const reader = new FileReader();
        reader.onload = ev => setAnexos(p => [...p, { tipo: 'imagem', url: ev.target.result, nome: 'screenshot.png' }]);
        reader.readAsDataURL(item.getAsFile());
      }
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setAnexos(p => [...p, { tipo: file.type.startsWith('image/') ? 'imagem' : 'arquivo', url: ev.target.result, nome: file.name }]);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const fmtData = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const fmtHora = d => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  // Contadores restritos ao escopo do papel: sem isso o resumo somava chamados que a
  // lista (abaixo) esconde por escopo — aparecia "1 Aberto" com a fila vazia (ex.: um
  // chamado de 'explorador' visto por um Analista, cujo escopo não inclui esse segmento).
  const chamadosNoEscopo = chamados.filter(c => escopo === null || escopo.includes(segOf(c)));
  const cont = s => chamadosNoEscopo.filter(c => c.status === s).length;
  const contSeg = seg => chamadosNoEscopo.filter(c => segOf(c) === seg).length;
  const buscaLower = busca.toLowerCase();
  const chamadosFiltrados = chamados.filter(c => {
    if (escopo !== null && !escopo.includes(segOf(c))) return false; // escopo do papel (simulação fiel + defesa em profundidade)
    if (segFiltro !== 'todos' && segOf(c) !== segFiltro) return false;
    if (!busca.trim()) return true;
    return (c.user_nome || '').toLowerCase().includes(buscaLower) ||
      (c.user_email || '').toLowerCase().includes(buscaLower) ||
      (c.atendente_nome || '').toLowerCase().includes(buscaLower) ||
      (c.titulo || '').toLowerCase().includes(buscaLower);
  });

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '310px 1fr', gap: 20, maxWidth: 1200, margin: '0 auto', padding: '24px 20px', minHeight: 'calc(100vh - 140px)', alignItems: 'start' }}>

      {/* ===== SIDEBAR — FILA ===== */}
      <div>
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>

          {/* Título */}
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontWeight: 800, fontSize: 15, color: '#111111' }}>Fila de Atendimento</span>
            <button onClick={carregarChamados} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4, display: 'flex' }} title="Atualizar">
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Resumo por status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #f1f5f9' }}>
            {[['aberto', 'Abertos', '#10b981'], ['em_atendimento', 'Em at.', '#0D63DB'], ['finalizado', 'Final.', '#94a3b8']].map(([s, l, c]) => (
              <div key={s} style={{ padding: '10px 6px', textAlign: 'center', borderRight: '1px solid #f1f5f9' }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: c }}>{cont(s)}</div>
                <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>{l}</div>
              </div>
            ))}
          </div>

          {/* Filtros de status */}
          <div style={{ padding: '8px 12px', display: 'flex', gap: 5, borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
            {[['pendentes', 'Pendentes'], ['todos', 'Todos'], ['finalizado', 'Finalizados']].map(([k, l]) => (
              <button key={k} onClick={() => setFiltro(k)}
                style={{ padding: '4px 12px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: filtro === k ? '#111111' : '#f1f5f9', color: filtro === k ? 'white' : '#64748b' }}>
                {l}
              </button>
            ))}
          </div>

          {/* Filtros por segmento de cliente (somente os do escopo do papel) */}
          {segsVisiveis.length > 0 && (
          <div style={{ padding: '8px 12px', display: 'flex', gap: 5, borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
            <button onClick={() => setSegFiltro('todos')}
              style={{ padding: '4px 10px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: segFiltro === 'todos' ? '#111111' : '#f1f5f9', color: segFiltro === 'todos' ? 'white' : '#64748b' }}>
              Todos
            </button>
            {segsVisiveis.map(seg => {
              const cfg = SEGMENTOS[seg];
              const n = contSeg(seg);
              const sel = segFiltro === seg;
              return (
                <button key={seg} onClick={() => setSegFiltro(seg)} title={cfg.label}
                  style={{ padding: '4px 10px', borderRadius: 20, border: 'none', fontSize: 11, fontWeight: 700, cursor: 'pointer', background: sel ? cfg.cor : cfg.bg, color: sel ? 'white' : cfg.cor }}>
                  {cfg.curto}{n > 0 ? ` ${n}` : ''}
                </button>
              );
            })}
          </div>
          )}

          {/* Busca por cliente ou atendente */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid #f1f5f9' }}>
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por cliente ou atendente..."
              style={{ width: '100%', padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, color: '#111111', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>

          {/* Lista de chamados */}
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center' }}>
                <Loader2 size={20} color="#0D63DB" style={{ animation: 'spin 1s linear infinite' }} />
              </div>
            ) : chamadosFiltrados.length === 0 ? (
              <div style={{ padding: '28px 16px', textAlign: 'center', color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
                {escopo !== null && escopo.length === 0
                  ? 'Seu acesso é interno (com analista e administração). Você não recebe chamados de clientes por aqui.'
                  : 'Nenhum chamado'}
              </div>
            ) : chamadosFiltrados.map(c => {
              const s = STATUS_CFG[c.status] || STATUS_CFG.aberto;
              const ativo = chamadoAtivo?.id === c.id;
              return (
                <button key={c.id} onClick={() => abrirChamado(c)}
                  style={{ width: '100%', padding: '11px 14px', border: 'none', background: ativo ? '#eff6ff' : 'none', textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid #f8fafc', borderLeft: ativo ? '3px solid #0D63DB' : '3px solid transparent', transition: 'background 0.1s' }}
                  onMouseEnter={e => { if (!ativo) e.currentTarget.style.background = '#f8fafc'; }}
                  onMouseLeave={e => { if (!ativo) e.currentTarget.style.background = 'none'; }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#111111', lineHeight: 1.3, flex: 1, marginRight: 6 }}>{c.titulo}</span>
                    <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 10, background: s.bg, color: s.cor, whiteSpace: 'nowrap' }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
                    {(() => { const sg = SEGMENTOS[segOf(c)] || SEGMENTOS.outro; return (
                      <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 8, background: sg.bg, color: sg.cor }}>{sg.curto}</span>
                    ); })()}
                    <span><User size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />{c.user_nome || c.user_email?.split('@')[0]}{' · '}{fmtData(c.criado_em)}</span>
                  </div>
                  {c.atendente_nome && (
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>Atend.: {c.atendente_nome}</div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ===== PAINEL PRINCIPAL — CONVERSA ===== */}
      {!chamadoAtivo ? (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 400, padding: 60 }}>
          <MessageCircle size={48} color="#e2e8f0" />
          <p style={{ color: '#94a3b8', marginTop: 16, fontSize: 14 }}>Selecione um chamado na fila</p>
        </div>
      ) : (
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Cabeçalho do chamado ativo */}
          <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111111', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {chamadoAtivo.titulo}
                {(() => { const sg = SEGMENTOS[segOf(chamadoAtivo)] || SEGMENTOS.outro; return (
                  <span style={{ fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 10, background: sg.bg, color: sg.cor }}>{sg.label}</span>
                ); })()}
              </div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                <User size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                {chamadoAtivo.user_nome || chamadoAtivo.user_email}
                {chamadoAtivo.atendente_nome && <> · Atend.: <strong>{chamadoAtivo.atendente_nome}</strong></>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {(() => {
                const s = STATUS_CFG[chamadoAtivo.status];
                return (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, background: s?.bg, color: s?.cor }}>{s?.label}</span>
                );
              })()}
              {['aberto', 'aguardando_atendente'].includes(chamadoAtivo.status) && (
                <button onClick={assumirChamado}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  <UserCheck size={14} /> Assumir
                </button>
              )}
              {chamadoAtivo.status !== 'finalizado' && (
                <button onClick={finalizarChamado}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#f1f5f9', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                  <CheckCircle2 size={14} /> Finalizar
                </button>
              )}
            </div>
          </div>

          {/* Mensagens */}
          <div style={{ padding: '20px', flex: 1, overflowY: 'auto', minHeight: 320, maxHeight: 460, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mensagens.length === 0 && (
              <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: 20 }}>Sem mensagens ainda</div>
            )}
            {mensagens.map(m => {
              const isSistema = m.autor_tipo === 'sistema';
              const incoming = m.autor_tipo === 'cliente' || m.autor_tipo === 'advogado';
              const bg = m.autor_tipo === 'cliente' ? '#f8fafc' : m.autor_tipo === 'ia' ? '#eff6ff'
                : m.autor_tipo === 'advogado' ? '#ccfbf1' : isSistema ? '#fef9c3' : '#ecfdf5';
              const bd = m.autor_tipo === 'cliente' ? '#e2e8f0' : m.autor_tipo === 'ia' ? '#bae6fd'
                : m.autor_tipo === 'advogado' ? '#5eead4' : isSistema ? '#fde68a' : '#86efac';
              return (
              <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: isSistema ? 'center' : incoming ? 'flex-start' : 'flex-end' }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 3 }}>
                  {m.autor_tipo === 'ia' ? (
                    <><Bot size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />BidPro Assistente · {fmtHora(m.criado_em)}</>
                  ) : m.autor_tipo === 'advogado' ? (
                    <>⚖️ Advogado (por e-mail) · {fmtHora(m.criado_em)}</>
                  ) : m.autor_tipo === 'atendente' ? (
                    <>{m.autor_nome || 'Atendente'} · {fmtHora(m.criado_em)}</>
                  ) : isSistema ? (
                    <>{m.autor_nome || 'Sistema'} · {fmtHora(m.criado_em)}</>
                  ) : (
                    <><User size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{m.autor_nome || 'Cliente'} · {fmtHora(m.criado_em)}</>
                  )}
                </div>
                <div style={{
                  maxWidth: isSistema ? '90%' : '76%', padding: '10px 14px', borderRadius: 12,
                  background: bg, color: '#111111', fontSize: 13, lineHeight: 1.6,
                  fontStyle: isSistema ? 'italic' : 'normal', textAlign: isSistema ? 'center' : 'left',
                  border: `1px solid ${bd}`,
                }}>
                  {m.autor_tipo === 'ia' && (
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#0D63DB', marginBottom: 5 }}>Resposta automática</div>
                  )}
                  {m.conteudo}
                  {(m.anexos || []).map((a, i) => a.tipo === 'imagem'
                    ? <img key={i} src={a.url} alt={a.nome} style={{ maxWidth: 200, display: 'block', marginTop: 8, borderRadius: 8 }} />
                    : <a key={i} href={a.url} download={a.nome} style={{ display: 'block', marginTop: 6, fontSize: 12, color: '#0D63DB' }}>{a.nome}</a>
                  )}
                </div>
              </div>
              );
            })}
            <div ref={msgEndRef} />
          </div>

          {/* Input de resposta */}
          {chamadoAtivo.status !== 'finalizado' ? (
            <div style={{ padding: '12px 16px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
              {anexos.length > 0 && (
                <div style={{ display: 'flex', gap: 5, marginBottom: 8, flexWrap: 'wrap' }}>
                  {anexos.map((a, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      {a.tipo === 'imagem'
                        ? <img src={a.url} alt={a.nome} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '2px solid #e2e8f0' }} />
                        : <div style={{ padding: '4px 8px', background: '#f1f5f9', borderRadius: 6, fontSize: 10, color: '#64748b', fontWeight: 600 }}>{a.nome.slice(0, 14)}</div>}
                      <button onClick={() => setAnexos(p => p.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: 15, height: 15, fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 8, borderRadius: 8 }}>
                  <Paperclip size={16} />
                </button>
                <textarea
                  value={texto} onChange={e => setTexto(e.target.value)} onPaste={handlePaste}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensagem(); } }}
                  placeholder="Responder ao cliente… (Ctrl+V para colar print · Enter para enviar)"
                  rows={2}
                  style={{ flex: 1, padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4 }}
                />
                <button onClick={enviarMensagem} disabled={(!texto.trim() && !anexos.length) || enviando}
                  style={{ background: '#111111', color: 'white', border: 'none', borderRadius: 10, padding: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: ((!texto.trim() && !anexos.length) || enviando) ? 0.5 : 1 }}>
                  {enviando ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={15} />}
                </button>
                <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleFile} />
              </div>
            </div>
          ) : (
            <div style={{ padding: '12px 20px', background: '#f8fafc', borderTop: '1px solid #f1f5f9', fontSize: 13, color: '#64748b', textAlign: 'center', flexShrink: 0 }}>
              <CheckCircle2 size={14} style={{ verticalAlign: 'middle', marginRight: 6, color: '#10b981' }} />
              Chamado finalizado
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
