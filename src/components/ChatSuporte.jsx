import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MessageCircle, X, Send, Paperclip, Bot, Loader2, UserCheck } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

const STAFF_ROLES = ['admin', 'analista', 'consultor', 'advogado'];
// Inatividade: avisar após 2min, fechar após 30min (em ms)
const AVISO_MS = 2 * 60 * 1000;
const FECHAR_MS = 30 * 60 * 1000;

export default function ChatSuporte() {
  const { user, role, isLoggedIn } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [ticket, setTicket] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [descricao, setDescricao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [loadingIA, setLoadingIA] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [anexos, setAnexos] = useState([]);
  const [novoTicket, setNovoTicket] = useState(false);
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
      carregarTicket();
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
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [ticket?.id]);

  // Timers de inatividade — reiniciados a cada mensagem do cliente
  const resetTimers = useCallback(() => {
    clearTimeout(avisoTimer.current);
    clearTimeout(fecharTimer.current);
    avisouInatividade.current = false;
    if (!ticket) return;

    avisoTimer.current = setTimeout(async () => {
      if (avisouInatividade.current) return;
      avisouInatividade.current = true;
      await supabase.from('chamados_mensagens').insert({
        chamado_id: ticket.id, autor_tipo: 'ia', autor_nome: 'TSN Assistente',
        conteudo: 'Ainda está por aqui? Estou disponível para continuar ajudando. Caso não haja resposta nos próximos 28 minutos, este atendimento será encerrado automaticamente.',
        anexos: [],
      });
    }, AVISO_MS);

    fecharTimer.current = setTimeout(async () => {
      const { error: errFim } = await supabase.from('chamados').update({
        status: 'finalizado', atendente_nome: 'Sistema (inatividade)',
        atualizado_em: new Date().toISOString(),
      }).eq('id', ticket.id).in('status', ['aberto', 'em_atendimento']);
      if (!errFim) {
        await supabase.from('chamados_mensagens').insert({
          chamado_id: ticket.id, autor_tipo: 'ia', autor_nome: 'TSN Assistente',
          conteudo: 'Este atendimento foi encerrado por inatividade. Se precisar de mais ajuda, abra um novo chamado.',
          anexos: [],
        });
        setTicket(p => p ? { ...p, status: 'finalizado' } : p);
      }
    }, FECHAR_MS);
  }, [ticket?.id]);

  useEffect(() => {
    return () => { clearTimeout(avisoTimer.current); clearTimeout(fecharTimer.current); };
  }, [ticket?.id]);

  if (!isLoggedIn || STAFF_ROLES.includes(role)) return null;

  async function carregarTicket() {
    setCarregando(true);
    const { data } = await supabase.from('chamados').select('*')
      .eq('user_id', user.id).in('status', ['aberto', 'em_atendimento'])
      .order('criado_em', { ascending: false }).limit(1);
    if (data?.length) {
      setTicket(data[0]);
      const { data: msgs } = await supabase.from('chamados_mensagens').select('*')
        .eq('chamado_id', data[0].id).order('criado_em', { ascending: true });
      setMensagens(msgs || []);
      setNovoTicket(false);
    } else {
      setTicket(null);
      setNovoTicket(true);
    }
    setCarregando(false);
  }

  async function criarChamado() {
    if (!descricao.trim()) return;
    setEnviando(true);
    const { data: novo } = await supabase.from('chamados').insert({
      user_id: user.id, user_email: user.email, user_nome: nomeUsuario,
      titulo: descricao.slice(0, 80),
    }).select().single();
    if (!novo) { setEnviando(false); return; }
    setTicket(novo);
    const { data: msg } = await supabase.from('chamados_mensagens').insert({
      chamado_id: novo.id, autor_id: user.id, autor_nome: nomeUsuario,
      autor_tipo: 'cliente', conteudo: descricao, anexos,
    }).select().single();
    const msgs = msg ? [msg] : [];
    setMensagens(msgs);
    setNovoTicket(false);
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
    await dispararIA(ticket, novaLista);
    setEnviando(false);
  }

  async function dispararIA(tk, msgs) {
    setLoadingIA(true);
    try {
      const res = await fetch('/api/chat-suporte', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: msgs, memoria: memoriaIA }),
      });
      const { resposta, escalar } = await res.json();
      if (resposta) {
        await supabase.from('chamados_mensagens').insert({
          chamado_id: tk.id, autor_tipo: 'ia',
          autor_nome: 'TSN Assistente', conteudo: resposta, anexos: [],
        });
        if (escalar) {
          setPrecisaAtendente(true);
          // Marca no chamado que precisa de atendente
          await supabase.from('chamados').update({ atualizado_em: new Date().toISOString() }).eq('id', tk.id);
        }
      }
    } catch (_) {
      await supabase.from('chamados_mensagens').insert({
        chamado_id: tk.id, autor_tipo: 'ia', autor_nome: 'TSN Assistente',
        conteudo: 'Não consegui processar sua mensagem no momento. Um membro da equipe irá atendê-lo em breve.',
        anexos: [],
      });
      setPrecisaAtendente(true);
    }
    setLoadingIA(false);
  }

  async function solicitarAtendente() {
    if (!ticket) return;
    await supabase.from('chamados_mensagens').insert({
      chamado_id: ticket.id, autor_tipo: 'ia', autor_nome: 'Sistema',
      conteudo: '— Cliente solicitou atendimento humano. Um membro da equipe assumirá em breve. —',
      anexos: [],
    });
    await supabase.from('chamados').update({ atualizado_em: new Date().toISOString() }).eq('id', ticket.id);
    setPrecisaAtendente(false);
  }

  async function encerrarAtendimento() {
    if (!ticket) return;
    await supabase.from('chamados').update({
      status: 'finalizado', atendente_nome: 'Auto-resolvido',
      atualizado_em: new Date().toISOString(),
    }).eq('id', ticket.id);
    await supabase.from('chamados_mensagens').insert({
      chamado_id: ticket.id, autor_tipo: 'ia', autor_nome: 'TSN Assistente',
      conteudo: 'Ótimo! Fico feliz em ter ajudado. Este atendimento foi encerrado. Se tiver mais dúvidas, estarei por aqui.',
      anexos: [],
    });
    setTicket(p => p ? { ...p, status: 'finalizado' } : p);
    clearTimeout(avisoTimer.current);
    clearTimeout(fecharTimer.current);
    // Gera resumo em background para memória futura
    if (user?.id) fetch('/api/resumir-ticket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticketId: ticket.id, userId: user.id }) });
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
    <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Bot size={11} color="white" />
    </div>
  );

  const isFinalizado = ticket?.status === 'finalizado';

  return (
    <>
      {/* Botão flutuante */}
      {!isOpen && (
        <button onClick={() => setIsOpen(true)} title="Suporte / Ajuda"
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9990, height: 48, padding: '0 20px 0 16px', borderRadius: 999, background: 'linear-gradient(135deg,#1d4ed8,#2563eb)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 20px rgba(37,99,235,0.45)', transition: 'transform 0.15s, box-shadow 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 6px 28px rgba(37,99,235,0.6)'; }}
          onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(37,99,235,0.45)'; }}>
          <MessageCircle size={20} />
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: '-0.01em' }}>Suporte</span>
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
          <div style={{ background: 'linear-gradient(135deg,#1e3a5f,#2563eb)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bot size={19} color="white" />
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>Suporte TSN Ativos</div>
                <div style={{ color: '#93c5fd', fontSize: 11 }}>
                  {ticket ? (isFinalizado ? 'Atendimento encerrado' : `Chamado #${ticket.id.slice(0, 8).toUpperCase()}`) : 'Assistente disponível'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {ticket && !isFinalizado && (
                <button onClick={() => { setTicket(null); setMensagens([]); setNovoTicket(true); setPrecisaAtendente(false); clearTimeout(avisoTimer.current); clearTimeout(fecharTimer.current); }} title="Novo chamado"
                  style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  + Novo
                </button>
              )}
              {isFinalizado && (
                <button onClick={() => { setTicket(null); setMensagens([]); setNovoTicket(true); setPrecisaAtendente(false); }} title="Novo chamado"
                  style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                  Novo chamado
                </button>
              )}
              <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center' }}>
                <X size={18} />
              </button>
            </div>
          </div>

          {carregando ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
              <Loader2 size={22} color="#2563eb" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : novoTicket ? (
            /* Formulário novo chamado */
            <div style={{ padding: 20, flexShrink: 0 }}>
              <p style={{ fontSize: 13, color: '#475569', margin: '0 0 14px', lineHeight: 1.6 }}>
                Olá, <strong style={{ color: '#0f172a' }}>{nomeUsuario}</strong>! Como posso ajudar?
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
                  style={{ flex: 1, padding: '9px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: (!descricao.trim() || enviando) ? 'not-allowed' : 'pointer', opacity: (!descricao.trim() || enviando) ? 0.6 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                  {enviando ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />} Enviar
                </button>
              </div>
              <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleFile} />
              <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 8, textAlign: 'center', marginBottom: 0 }}>Ctrl+V para colar prints de tela</p>
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
                        {m.autor_tipo === 'ia' ? 'TSN Assistente'
                          : m.autor_tipo === 'atendente' ? (m.autor_nome || 'Equipe TSN')
                          : m.autor_tipo === 'sistema' ? 'Sistema'
                          : 'Você'} · {fmtHora(m.criado_em)}
                      </span>
                    </div>
                    <div style={{
                      maxWidth: '85%', padding: '9px 13px',
                      borderRadius: m.autor_tipo === 'cliente' ? '14px 14px 4px 14px' : '4px 14px 14px 14px',
                      background: m.autor_tipo === 'cliente' ? '#2563eb'
                        : m.autor_tipo === 'atendente' ? '#f0fdf4'
                        : m.autor_nome === 'Sistema' ? '#fef3c7'
                        : '#f0f9ff',
                      color: m.autor_tipo === 'cliente' ? 'white' : '#0f172a',
                      fontSize: 13, lineHeight: 1.55,
                      border: m.autor_tipo !== 'cliente' ? `1px solid ${m.autor_tipo === 'atendente' ? '#86efac' : m.autor_nome === 'Sistema' ? '#fde68a' : '#bae6fd'}` : 'none',
                      fontStyle: m.autor_nome === 'Sistema' ? 'italic' : 'normal',
                    }}>
                      {m.conteudo}
                      {(m.anexos || []).length > 0 && (
                        <div style={{ marginTop: 6 }}>
                          {m.anexos.map((a, i) => a.tipo === 'imagem'
                            ? <img key={i} src={a.url} alt={a.nome} style={{ maxWidth: 160, display: 'block', marginTop: 4, borderRadius: 6 }} />
                            : <a key={i} href={a.url} download={a.nome} style={{ display: 'block', marginTop: 4, fontSize: 11, color: m.autor_tipo === 'cliente' ? 'rgba(255,255,255,0.85)' : '#2563eb', textDecoration: 'underline' }}>{a.nome}</a>
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
                  ✅ Atendimento encerrado — abra um novo chamado se precisar de mais ajuda
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
                    style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, padding: '9px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: ((!texto.trim() && !anexos.length) || enviando) ? 0.5 : 1, flexShrink: 0 }}>
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
