import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Send, Paperclip, Bot, Loader2, UserCheck, ArrowLeft, Plus, ChevronRight } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';

const STAFF_ROLES = ['admin', 'analista', 'consultor', 'advogado'];
// Inatividade: avisar após 2min, fechar após 30min (em ms)
const AVISO_MS = 2 * 60 * 1000;
const FECHAR_MS = 30 * 60 * 1000;

// WhatsApp da empresa — PREENCHIDO SÓ quando a integração gerar o número (env
// VITE_WHATSAPP_NUMERO, formato internacional, só dígitos, ex.: 5571999999999).
// Enquanto vazio, a opção "Falar no WhatsApp" fica OCULTA (nada muda no chat atual);
// setar a env e redeployar faz o botão aparecer sozinho, sem mexer no código.
const WHATSAPP_NUMERO = String(import.meta.env.VITE_WHATSAPP_NUMERO || '').replace(/\D/g, '');

// Mapeia o role/plano do cliente para o segmento carimbado no chamado.
function segmentoDoRole(r) {
  if (r === 'explorador') return 'explorador';
  if (r === 'top2') return 'investidor';
  if (r === 'assessorado') return 'assessorado';
  if (r === 'clube') return 'clube';
  return 'outro';
}

const STATUS_LABEL = {
  aberto: 'Em aberto', aguardando_atendente: 'Aguardando atendente',
  em_atendimento: 'Em atendimento', finalizado: 'Finalizado',
};

// Marca "B" do BidPro (mesmo glifo do logo.svg). `quadrado` desenha o fundo azul.
function MarcaBP({ size = 30, quadrado = true }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      {quadrado && <rect width="40" height="40" rx="9" fill="#0D63DB" />}
      <path d="M10 8h12c4 0 7 2.5 7 6s-3 5.5-3 5.5 4 1.5 4 6c0 4-3.5 6.5-8 6.5H10V8z" fill="white" />
      <path d="M15 13h6c1.5 0 3 1 3 2.5S22.5 18 21 18h-6v-5z" fill="#0D63DB" />
      <path d="M15 23h7c2 0 3.5 1 3.5 2.8S24 28.5 22 28.5h-7V23z" fill="#0D63DB" />
      <path d="M26 9l6-1-4 6h4l-7 10 2-7h-4l3-8z" fill="#60a5fa" opacity="0.9" />
    </svg>
  );
}

export default function ChatSuporte() {
  const { user, effectiveRole, isLoggedIn } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [view, setView] = useState('lista'); // 'lista' | 'novo' | 'conversa'
  const [listaChamados, setListaChamados] = useState([]);
  const [ticket, setTicket] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [loadingIA, setLoadingIA] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [anexos, setAnexos] = useState([]);
  const [precisaAtendente, setPrecisaAtendente] = useState(false);
  const [memoriaIA, setMemoriaIA] = useState('');
  const fileRef = useRef();
  const msgEndRef = useRef();
  const avisoTimer = useRef(null);
  const fecharTimer = useRef(null);
  const avisouInatividade = useRef(false);

  const nomeUsuario = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Cliente';

  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensagens]);
  useEffect(() => {
    if (isOpen && user) {
      carregarLista();
      supabase.from('perfis').select('memoria_ia').eq('id', user.id).single()
        .then(({ data }) => { if (data?.memoria_ia) setMemoriaIA(data.memoria_ia); });
    }
  }, [isOpen, user?.id]);

  useEffect(() => {
    const handler = () => setIsOpen(true);
    window.addEventListener('tsn:open-chat', handler);
    return () => window.removeEventListener('tsn:open-chat', handler);
  }, []);

  useEffect(() => {
    if (!ticket) return;
    const ch = supabase.channel(`chat-${ticket.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chamados_mensagens',
        filter: `chamado_id=eq.${ticket.id}`,
      }, p => setMensagens(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'chamados',
        filter: `id=eq.${ticket.id}`,
      }, p => {
        setTicket(prev => prev ? { ...prev, ...p.new } : prev);
        // Desmonta timers quando atendente humano assume
        if (['em_atendimento', 'aguardando_atendente'].includes(p.new.status)) {
          clearTimeout(avisoTimer.current);
          clearTimeout(fecharTimer.current);
        }
      })
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [ticket?.id]);

  // Timers de inatividade — só atuam em chamados 'aberto' (IA respondendo)
  // Quando um atendente humano assumiu, timers são desarmados
  const resetTimers = useCallback(() => {
    clearTimeout(avisoTimer.current);
    clearTimeout(fecharTimer.current);
    avisouInatividade.current = false;
    if (!ticket) return;
    // Não arma timers se um humano já está envolvido
    if (['em_atendimento', 'aguardando_atendente'].includes(ticket.status)) return;

    avisoTimer.current = setTimeout(async () => {
      if (avisouInatividade.current) return;
      avisouInatividade.current = true;
      await supabase.from('chamados_mensagens').insert({
        chamado_id: ticket.id, autor_tipo: 'ia', autor_nome: 'BidPro Assistente',
        conteudo: 'Ainda está por aqui? Estou disponível para continuar ajudando. Caso não haja resposta nos próximos 28 minutos, este atendimento será encerrado automaticamente.',
        anexos: [],
      });
    }, AVISO_MS);

    fecharTimer.current = setTimeout(async () => {
      // Só fecha se ainda estiver 'aberto' — nunca interrompe atendente humano
      const { error: errFim } = await supabase.from('chamados').update({
        status: 'finalizado', atendente_nome: 'Sistema (inatividade)',
        atualizado_em: new Date().toISOString(),
      }).eq('id', ticket.id).eq('status', 'aberto');
      if (!errFim) {
        await supabase.from('chamados_mensagens').insert({
          chamado_id: ticket.id, autor_tipo: 'ia', autor_nome: 'BidPro Assistente',
          conteudo: 'Este atendimento foi encerrado por inatividade. Se precisar de mais ajuda, abra um novo chamado.',
          anexos: [],
        });
        setTicket(p => p ? { ...p, status: 'finalizado' } : p);
      }
    }, FECHAR_MS);
  }, [ticket?.id, ticket?.status]);

  useEffect(() => {
    return () => { clearTimeout(avisoTimer.current); clearTimeout(fecharTimer.current); };
  }, [ticket?.id]);

  if (!isLoggedIn || STAFF_ROLES.includes(effectiveRole)) return null;

  // Lista TODOS os atendimentos do cliente (abertos e finalizados)
  async function carregarLista() {
    setCarregando(true);
    const { data } = await supabase.from('chamados').select('*')
      .eq('user_id', user.id)
      .order('atualizado_em', { ascending: false, nullsFirst: false })
      .order('criado_em', { ascending: false });
    const lista = data || [];
    setListaChamados(lista);
    // Sem nenhum atendimento ainda → já abre o formulário de nova dúvida
    setView(lista.length ? 'lista' : 'novo');
    setTicket(null); setMensagens([]); setPrecisaAtendente(false);
    setCarregando(false);
  }

  async function abrirChamado(c) {
    setCarregando(true);
    setTicket(c);
    const { data: msgs } = await supabase.from('chamados_mensagens').select('*')
      .eq('chamado_id', c.id).order('criado_em', { ascending: true });
    setMensagens(msgs || []);
    setPrecisaAtendente(false);
    setView('conversa');
    setCarregando(false);
    resetTimers();
  }

  async function criarChamado() {
    if (!descricao.trim()) return;
    setEnviando(true);
    const { data: novo } = await supabase.from('chamados').insert({
      user_id: user.id, user_email: user.email, user_nome: nomeUsuario,
      titulo: descricao.slice(0, 80), segmento: segmentoDoRole(effectiveRole),
    }).select().single();
    if (!novo) { setEnviando(false); return; }
    setTicket(novo);
    const { data: msg } = await supabase.from('chamados_mensagens').insert({
      chamado_id: novo.id, autor_id: user.id, autor_nome: nomeUsuario,
      autor_tipo: 'cliente', conteudo: descricao, anexos,
    }).select().single();
    const msgs = msg ? [msg] : [];
    setMensagens(msgs);
    setView('conversa');
    setDescricao(''); setAnexos([]);
    resetTimers();
    await dispararIA(novo, msgs);
    setEnviando(false);
  }

  async function enviarMensagem() {
    if ((!texto.trim() && !anexos.length) || !ticket) return;
    if (ticket.status === 'finalizado') return;
    setEnviando(true);
    setPrecisaAtendente(false);
    const { data: msg } = await supabase.from('chamados_mensagens').insert({
      chamado_id: ticket.id, autor_id: user.id, autor_nome: nomeUsuario,
      autor_tipo: 'cliente', conteudo: texto || '[anexo]', anexos,
    }).select().single();
    const novaLista = msg ? [...mensagens, msg] : mensagens;
    setMensagens(novaLista);
    setTexto(''); setAnexos([]);
    resetTimers();
    // Só aciona IA se não houver atendente humano ou solicitação pendente
    if (!['em_atendimento', 'aguardando_atendente'].includes(ticket.status)) {
      await dispararIA(ticket, novaLista);
    }
    setEnviando(false);
  }

  async function dispararIA(tk, msgs) {
    setLoadingIA(true);
    try {
      const res = await apiCall('/api/chat-suporte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: msgs, memoria: memoriaIA }),
      });
      const { resposta, escalar } = await res.json();
      if (resposta) {
        await supabase.from('chamados_mensagens').insert({
          chamado_id: tk.id, autor_tipo: 'ia',
          autor_nome: 'BidPro Assistente', conteudo: resposta, anexos: [],
        });
        if (escalar) {
          setPrecisaAtendente(true);
          // Marca no chamado que precisa de atendente
          await supabase.from('chamados').update({ atualizado_em: new Date().toISOString() }).eq('id', tk.id);
        }
      }
    } catch (_) {
      await supabase.from('chamados_mensagens').insert({
        chamado_id: tk.id, autor_tipo: 'ia', autor_nome: 'BidPro Assistente',
        conteudo: 'Não consegui processar sua mensagem no momento. Um membro da equipe irá atendê-lo em breve.',
        anexos: [],
      });
      setPrecisaAtendente(true);
    }
    setLoadingIA(false);
  }

  async function solicitarAtendente() {
    if (!ticket) return;
    await supabase.from('chamados').update({
      status: 'aguardando_atendente',
      atualizado_em: new Date().toISOString(),
    }).eq('id', ticket.id);
    await supabase.from('chamados_mensagens').insert({
      chamado_id: ticket.id, autor_tipo: 'ia', autor_nome: 'Sistema',
      conteudo: '✅ Encaminhamos você para um especialista da nossa equipe. Você será respondido por aqui mesmo o quanto antes (em horário comercial). Pode deixar mais detalhes enquanto isso, que já adiantamos o atendimento.',
      anexos: [],
    });
    setTicket(prev => ({ ...prev, status: 'aguardando_atendente' }));
    setPrecisaAtendente(false);
  }

  async function encerrarAtendimento() {
    if (!ticket) return;
    await supabase.from('chamados').update({
      status: 'finalizado', atendente_nome: 'Auto-resolvido',
      atualizado_em: new Date().toISOString(),
    }).eq('id', ticket.id);
    await supabase.from('chamados_mensagens').insert({
      chamado_id: ticket.id, autor_tipo: 'ia', autor_nome: 'BidPro Assistente',
      conteudo: 'Ótimo! Fico feliz em ter ajudado. Este atendimento foi encerrado. Se tiver mais dúvidas, estarei por aqui.',
      anexos: [],
    });
    setTicket(p => p ? { ...p, status: 'finalizado' } : p);
    clearTimeout(avisoTimer.current);
    clearTimeout(fecharTimer.current);
    // Gera resumo em background para memória futura
    if (user?.id) apiCall('/api/resumir-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticketId: ticket.id, userId: user.id }) });
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

  const fmtHora = d => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  const AvatarIA = () => (
    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#0D63DB', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Bot size={11} color="white" />
    </div>
  );

  const isFinalizado = ticket?.status === 'finalizado';

  return (
    <>
      {/* Botão flutuante, círculo no tema do header (preto) com a marca B */}
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} title="Precisa de ajuda? Fale com a gente"
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9990, height: 58, borderRadius: 999, background: '#111111', color: 'white', border: '1px solid #1f2937', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 0, padding: 0, overflow: 'hidden', boxShadow: '0 8px 24px rgba(17,17,17,0.28)', transition: 'gap 0.2s, padding 0.2s, box-shadow 0.2s, transform 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 30px rgba(17,17,17,0.36)'; e.currentTarget.style.gap = '10px'; e.currentTarget.style.paddingRight = '20px'; const lbl = e.currentTarget.querySelector('[data-fab-label]'); if (lbl) { lbl.style.maxWidth = '120px'; lbl.style.opacity = '1'; } }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(17,17,17,0.28)'; e.currentTarget.style.gap = '0px'; e.currentTarget.style.paddingRight = '0px'; const lbl = e.currentTarget.querySelector('[data-fab-label]'); if (lbl) { lbl.style.maxWidth = '0px'; lbl.style.opacity = '0'; } }}>
          {/* Disco com a marca + indicador online */}
          <span style={{ position: 'relative', width: 58, height: 58, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <MarcaBP size={30} />
            <span style={{ position: 'absolute', top: 12, right: 12, width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid #111111' }} />
          </span>
          {/* Rótulo revelado no hover */}
          <span data-fab-label style={{ maxWidth: 0, opacity: 0, whiteSpace: 'nowrap', overflow: 'hidden', fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em', transition: 'max-width 0.25s, opacity 0.2s' }}>
            Precisa de ajuda?
          </span>
        </button>
      )}

      {/* Widget de chat */}
      {isOpen && (
        <div style={{ position: 'fixed', bottom: 0, right: 0, zIndex: 9990,
          width: 'min(420px, 100vw)', height: 'min(620px, 100dvh)',
          background: 'white',
          borderRadius: window.innerWidth < 480 ? '20px 20px 0 0' : 20,
          boxShadow: '0 16px 56px rgba(0,0,0,0.25)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          margin: window.innerWidth < 480 ? 0 : '0 16px 16px 0',
        }}>

          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#0D63DB)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {view !== 'lista' && (
                <button onClick={() => carregarLista()} title="Voltar aos meus atendimentos"
                  style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}>
                  <ArrowLeft size={18} />
                </button>
              )}
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bot size={19} color="white" />
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>Suporte BidPro Brasil</div>
                <div style={{ color: '#93c5fd', fontSize: 11 }}>
                  {view === 'conversa' && ticket ? (isFinalizado ? 'Atendimento encerrado' : `Chamado #${ticket.id.slice(0, 8).toUpperCase()}`)
                    : view === 'novo' ? 'Nova dúvida'
                    : 'Meus atendimentos'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
                <X size={18} />
              </button>
            </div>
          </div>

          {carregando ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <Loader2 size={22} color="#0D63DB" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : view === 'lista' ? (
            /* Lista de todos os atendimentos do cliente */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ padding: '12px 16px', flexShrink: 0 }}>
                <button onClick={() => { setDescricao(''); setAnexos([]); setView('novo'); }}
                  style={{ width: '100%', padding: '10px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  <Plus size={15} /> Nova dúvida
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px 12px' }}>
                {listaChamados.length === 0 ? (
                  <p style={{ textAlign: 'center', color: '#94a3b8', fontSize: 13, padding: '24px 12px' }}>Você ainda não tem atendimentos.</p>
                ) : listaChamados.map(c => {
                  const fin = c.status === 'finalizado';
                  return (
                    <button key={c.id} onClick={() => abrirChamado(c)}
                      style={{ width: '100%', textAlign: 'left', background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '11px 13px', marginBottom: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#111111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.titulo || 'Atendimento'}</div>
                        <div style={{ fontSize: 11, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontWeight: 700, color: fin ? '#64748b' : '#15803d' }}>{STATUS_LABEL[c.status] || c.status}</span>
                          <span style={{ color: '#cbd5e1' }}>·</span>
                          <span style={{ color: '#94a3b8' }}>{new Date(c.atualizado_em || c.criado_em).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
                        </div>
                      </div>
                      <ChevronRight size={16} color="#cbd5e1" />
                    </button>
                  );
                })}
              </div>
            </div>
          ) : view === 'novo' ? (
            /* Formulário novo chamado */
            <div style={{ padding: 20, flexShrink: 0 }}>
              <p style={{ fontSize: 13, color: '#475569', margin: '0 0 14px', lineHeight: 1.6 }}>
                Olá, <strong style={{ color: '#111111' }}>{nomeUsuario}</strong>! Como posso ajudar?
              </p>
              <textarea
                value={descricao} onChange={e => setDescricao(e.target.value)} onPaste={handlePaste}
                placeholder="Descreva sua dúvida ou problema..."
                rows={5}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, resize: 'none', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
              />
              {anexos.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {anexos.map((a, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      {a.tipo === 'imagem'
                        ? <img src={a.url} alt={a.nome} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '2px solid #e2e8f0' }} />
                        : <div style={{ width: 56, height: 56, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: '#64748b', fontWeight: 600, textAlign: 'center', padding: 4 }}>{a.nome.slice(0, 10)}</div>}
                      <button onClick={() => setAnexos(p => p.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={() => fileRef.current?.click()}
                  style={{ padding: '9px 12px', background: '#f1f5f9', border: 'none', borderRadius: 8, color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600 }}>
                  <Paperclip size={13} /> Anexar
                </button>
                <button onClick={criarChamado} disabled={!descricao.trim() || enviando}
                  style={{ flex: 1, padding: '9px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: (!descricao.trim() || enviando) ? 'not-allowed' : 'pointer', opacity: (!descricao.trim() || enviando) ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  {enviando ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />} Enviar
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleFile} />
              <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 8, textAlign: 'center', marginBottom: 0 }}>Ctrl+V para colar prints de tela</p>
              {/* Alternativa: falar no WhatsApp (aparece só quando o número existir) */}
              {WHATSAPP_NUMERO && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '14px 0 10px' }}>
                    <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                    <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>ou</span>
                    <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                  </div>
                  <a href={`https://wa.me/${WHATSAPP_NUMERO}?text=${encodeURIComponent('Olá! Vim pelo site da BidPro Brasil e gostaria de falar por aqui.')}`}
                    target="_blank" rel="noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '10px', background: '#25D366', color: 'white', borderRadius: 10, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                    🟢 Falar no WhatsApp
                  </a>
                  <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 6, textAlign: 'center', marginBottom: 0 }}>Continue no seu WhatsApp, sem precisar manter o site aberto.</p>
                </>
              )}
            </div>
          ) : (
            /* Conversa ativa */
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 8px', display: 'flex', flexDirection: 'column', gap: 10, minHeight: 240, maxHeight: 360 }}>
                {mensagens.map(m => (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.autor_tipo === 'cliente' ? 'flex-end' : 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                      {m.autor_tipo !== 'cliente' && <AvatarIA />}
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>
                        {m.autor_tipo === 'ia' ? 'BidPro Assistente'
                          : m.autor_tipo === 'atendente' ? (m.autor_nome || 'Equipe BidPro')
                          : m.autor_tipo === 'sistema' ? 'Sistema'
                          : 'Você'} · {fmtHora(m.criado_em)}
                      </span>
                    </div>
                    <div style={{
                      maxWidth: '85%', padding: '9px 13px',
                      borderRadius: m.autor_tipo === 'cliente' ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                      background: m.autor_tipo === 'cliente' ? '#0D63DB'
                        : m.autor_tipo === 'atendente' ? '#f0fdf4'
                        : m.autor_nome === 'Sistema' ? '#fef3c7'
                        : '#f0f9ff',
                      color: m.autor_tipo === 'cliente' ? 'white' : '#111111',
                      fontSize: 13, lineHeight: 1.55,
                      border: m.autor_tipo !== 'cliente' ? `1px solid ${m.autor_tipo === 'atendente' ? '#86efac' : m.autor_nome === 'Sistema' ? '#fde68a' : '#bae6fd'}` : 'none',
                      fontStyle: m.autor_nome === 'Sistema' ? 'italic' : 'normal',
                    }}>
                      {m.conteudo}
                      {(m.anexos || []).length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          {m.anexos.map((a, i) => a.tipo === 'imagem'
                            ? <img key={i} src={a.url} alt={a.nome} style={{ maxWidth: 160, display: 'block', marginTop: 4, borderRadius: 6 }} />
                            : <a key={i} href={a.url} download={a.nome} style={{ display: 'block', marginTop: 4, fontSize: 11, color: m.autor_tipo === 'cliente' ? 'rgba(255,255,255,0.85)' : '#0D63DB', textDecoration: 'underline' }}>{a.nome}</a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {loadingIA && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12 }}>
                    <AvatarIA />
                    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
                      {[0, 1, 2].map(i => (
                        <span key={i} style={{ width: 5, height: 5, borderRadius: '50%', background: '#93c5fd', display: 'inline-block', animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
                      ))}
                    </div>
                  </div>
                )}
                <div ref={msgEndRef} />
              </div>

              {/* Banner "precisa atendente" */}
              {precisaAtendente && !isFinalizado && (
                <div style={{ padding: '10px 14px', background: '#fef3c7', borderTop: '1px solid #fde68a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 12, color: '#92400e', flex: 1, lineHeight: 1.4 }}>
                    Prefere falar com um atendente?
                  </span>
                  <button onClick={solicitarAtendente}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', background: '#d97706', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    <UserCheck size={13} /> Sim, quero atendente
                  </button>
                </div>
              )}

              {/* Banner atendimento encerrado */}
              {isFinalizado && (
                <div style={{ padding: '10px 14px', background: '#f0fdf4', borderTop: '1px solid #86efac', fontSize: 12, color: '#166534', textAlign: 'center' }}>
                  ✅ Atendimento encerrado, abra um novo chamado se precisar de mais ajuda
                </div>
              )}

              {/* Botões de ação rápida quando não finalizado */}
              {!isFinalizado && !loadingIA && mensagens.some(m => m.autor_tipo === 'ia') && (
                <div style={{ padding: '6px 12px 0', display: 'flex', gap: 6 }}>
                  <button onClick={encerrarAtendimento}
                    style={{ flex: 1, padding: '6px 10px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, color: '#166534', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                    ✅ Problema resolvido
                  </button>
                </div>
              )}

              {/* Preview anexos */}
              {anexos.length > 0 && (
                <div style={{ display: 'flex', gap: 5, padding: '6px 14px 0', flexWrap: 'wrap' }}>
                  {anexos.map((a, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      {a.tipo === 'imagem'
                        ? <img src={a.url} alt={a.nome} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '2px solid #e2e8f0' }} />
                        : <div style={{ padding: '3px 6px', background: '#f1f5f9', borderRadius: 6, fontSize: 9, color: '#64748b', fontWeight: 600 }}>{a.nome.slice(0, 12)}</div>}
                      <button onClick={() => setAnexos(p => p.filter((_, j) => j !== i))}
                        style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: 14, height: 14, fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input */}
              {!isFinalizado && (
                <div style={{ padding: '8px 12px 10px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 6, alignItems: 'flex-end', flexShrink: 0 }}>
                  <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex', flexShrink: 0 }}>
                    <Paperclip size={16} />
                  </button>
                  <textarea
                    value={texto} onChange={e => setTexto(e.target.value)} onPaste={handlePaste}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensagem(); } }}
                    placeholder="Digite... (Enter envia · Ctrl+V para print)"
                    rows={2}
                    style={{ flex: 1, padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4 }}
                  />
                  <button onClick={enviarMensagem} disabled={(!texto.trim() && !anexos.length) || enviando}
                    style={{ background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, padding: '9px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: ((!texto.trim() && !anexos.length) || enviando) ? 0.5 : 1, flexShrink: 0 }}>
                    {enviando ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                  </button>
                  <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleFile} />
                </div>
              )}
            </>
          )}

          <style>{`
            @keyframes spin { to { transform: rotate(360deg); } }
            @keyframes bounce { 0%,60%,100% { transform: translateY(0); } 30% { transform: translateY(-4px); } }
          `}</style>
        </div>
      )}
    </>
  );
}
