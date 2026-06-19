import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, X, Send, Paperclip, Bot, CheckCircle2, Loader2, ChevronDown } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

const STAFF_ROLES = ['admin', 'analista', 'consultor', 'advogado'];

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
  const fileRef = useRef();
  const msgEndRef = useRef();
  const channelRef = useRef();

  const nomeUsuario = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Cliente';

  // Only show for logged-in non-staff users
  if (!isLoggedIn || STAFF_ROLES.includes(role)) return null;

  // Scroll to bottom when messages change
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [mensagens]);

  // Load active ticket on open
  useEffect(() => {
    if (!isOpen || !user) return;
    carregarTicket();
  }, [isOpen, user]);

  // Realtime subscription
  useEffect(() => {
    if (!ticket) return;
    const ch = supabase.channel(`chamado-${ticket.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'chamados_mensagens',
        filter: `chamado_id=eq.${ticket.id}`,
      }, payload => {
        setMensagens(prev => {
          if (prev.find(m => m.id === payload.new.id)) return prev;
          return [...prev, payload.new];
        });
      })
      .subscribe();
    channelRef.current = ch;
    return () => supabase.removeChannel(ch);
  }, [ticket?.id]);

  async function carregarTicket() {
    setCarregando(true);
    const { data } = await supabase
      .from('chamados')
      .select('*')
      .eq('user_id', user.id)
      .in('status', ['aberto', 'em_atendimento'])
      .order('criado_em', { ascending: false })
      .limit(1);
    if (data?.length) {
      setTicket(data[0]);
      const { data: msgs } = await supabase
        .from('chamados_mensagens')
        .select('*')
        .eq('chamado_id', data[0].id)
        .order('criado_em', { ascending: true });
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
    const titulo = descricao.slice(0, 80);
    const { data: novo } = await supabase.from('chamados').insert({
      user_id: user.id,
      user_email: user.email,
      user_nome: nomeUsuario,
      titulo,
    }).select().single();
    if (!novo) { setEnviando(false); return; }
    setTicket(novo);
    // Insert first message
    const { data: msg } = await supabase.from('chamados_mensagens').insert({
      chamado_id: novo.id,
      autor_id: user.id,
      autor_nome: nomeUsuario,
      autor_tipo: 'cliente',
      conteudo: descricao,
      anexos,
    }).select().single();
    const msgs = msg ? [msg] : [];
    setMensagens(msgs);
    setNovoTicket(false);
    setDescricao('');
    setAnexos([]);
    // Trigger AI
    await triggerIA(novo.id, msgs);
    setEnviando(false);
  }

  async function enviarMensagem() {
    if ((!texto.trim() && !anexos.length) || !ticket) return;
    setEnviando(true);
    const { data: msg } = await supabase.from('chamados_mensagens').insert({
      chamado_id: ticket.id,
      autor_id: user.id,
      autor_nome: nomeUsuario,
      autor_tipo: 'cliente',
      conteudo: texto || '[anexo]',
      anexos,
    }).select().single();
    const msgsList = msg ? [...mensagens, msg] : mensagens;
    setMensagens(msgsList);
    setTexto('');
    setAnexos([]);
    // Trigger AI
    await triggerIA(ticket.id, msgsList);
    setEnviando(false);
  }

  async function triggerIA(chamadoId, msgsList) {
    setLoadingIA(true);
    try {
      const res = await fetch('/api/chat-suporte', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensagens: msgsList }),
      });
      const { resposta } = await res.json();
      if (resposta) {
        await supabase.from('chamados_mensagens').insert({
          chamado_id: chamadoId,
          autor_tipo: 'ia',
          autor_nome: 'TSN Assistente',
          conteudo: resposta,
          anexos: [],
        });
      }
    } catch (_) {}
    setLoadingIA(false);
  }

  async function novoTicketFn() {
    setTicket(null);
    setMensagens([]);
    setNovoTicket(true);
  }

  function handlePaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (ev) => {
          setAnexos(prev => [...prev, { tipo: 'imagem', url: ev.target.result, nome: 'screenshot.png' }]);
        };
        reader.readAsDataURL(file);
      }
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAnexos(prev => [...prev, { tipo: file.type.startsWith('image/') ? 'imagem' : 'arquivo', url: ev.target.result, nome: file.name }]);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const fmtHora = (d) => new Date(d).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          title="Suporte / Ajuda"
          style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9990, width: 52, height: 52, borderRadius: '50%', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 20px rgba(37,99,235,0.5)', transition: 'transform 0.2s' }}
          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.1)'}
          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
          <MessageCircle size={22} />
        </button>
      )}

      {/* Chat widget */}
      {isOpen && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9990, width: 360, maxWidth: 'calc(100vw - 32px)', background: 'white', borderRadius: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg, #1e3a5f, #2563eb)', padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Bot size={18} color="white" />
              </div>
              <div>
                <div style={{ color: 'white', fontWeight: 800, fontSize: 14 }}>Suporte TSN</div>
                <div style={{ color: '#93c5fd', fontSize: 11 }}>
                  {ticket ? `Chamado #${ticket.id.slice(0,8)}` : 'Assistente disponível'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {ticket && <button onClick={novoTicketFn} title="Novo chamado" style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: 8, padding: '5px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>+ Novo</button>}
              <button onClick={() => setIsOpen(false)} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', padding: 4, display: 'flex' }}>
                <X size={18} />
              </button>
            </div>
          </div>

          {carregando ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32 }}>
              <Loader2 size={20} color="#2563eb" style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : novoTicket ? (
            /* New ticket form */
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: '#475569', marginBottom: 14, lineHeight: 1.6 }}>
                Olá, <strong>{nomeUsuario}</strong>! Como posso ajudar você hoje?
              </p>
              <textarea
                value={descricao}
                onChange={e => setDescricao(e.target.value)}
                onPaste={handlePaste}
                placeholder="Descreva sua dúvida ou problema..."
                rows={5}
                style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, resize: 'none', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
              />
              {/* Attachment preview */}
              {anexos.length > 0 && (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                  {anexos.map((a, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      {a.tipo === 'imagem'
                        ? <img src={a.url} alt={a.nome} style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8, border: '2px solid #e2e8f0' }} />
                        : <div style={{ width: 60, height: 60, background: '#f1f5f9', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#64748b', fontWeight: 600, textAlign: 'center', padding: 4 }}>{a.nome.slice(0,12)}</div>
                      }
                      <button onClick={() => setAnexos(prev => prev.filter((_,j)=>j!==i))}
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
              <p style={{ fontSize: 10, color: '#94a3b8', marginTop: 8, textAlign: 'center' }}>Ctrl+V para colar prints de tela</p>
            </div>
          ) : (
            /* Active conversation */
            <>
              <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10, minHeight: 300, maxHeight: 360 }}>
                {mensagens.map(m => (
                  <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: m.autor_tipo === 'cliente' ? 'flex-end' : 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                      {m.autor_tipo !== 'cliente' && (
                        <div style={{ width: 18, height: 18, borderRadius: '50%', background: m.autor_tipo === 'ia' ? '#2563eb' : '#059669', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Bot size={10} color="white" />
                        </div>
                      )}
                      <span style={{ fontSize: 10, color: '#94a3b8' }}>
                        {m.autor_tipo === 'ia' ? 'TSN Assistente' : m.autor_tipo === 'atendente' ? (m.autor_nome || 'Equipe TSN') : 'Você'} · {fmtHora(m.criado_em)}
                      </span>
                    </div>
                    <div style={{
                      maxWidth: '85%', padding: '9px 12px', borderRadius: m.autor_tipo === 'cliente' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      background: m.autor_tipo === 'cliente' ? '#2563eb' : m.autor_tipo === 'ia' ? '#f0f9ff' : '#f0fdf4',
                      color: m.autor_tipo === 'cliente' ? 'white' : '#0f172a',
                      fontSize: 13, lineHeight: 1.5,
                      border: m.autor_tipo !== 'cliente' ? `1px solid ${m.autor_tipo === 'ia' ? '#bae6fd' : '#86efac'}` : 'none'
                    }}>
                      {m.conteudo}
                      {(m.anexos || []).length > 0 && (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
                          {m.anexos.map((a, i) => (
                            a.tipo === 'imagem'
                              ? <img key={i} src={a.url} alt={a.nome} style={{ maxWidth: 160, borderRadius: 6, border: '1px solid rgba(255,255,255,0.3)' }} />
                              : <a key={i} href={a.url} download={a.nome} style={{ fontSize: 11, color: m.autor_tipo === 'cliente' ? 'rgba(255,255,255,0.8)' : '#2563eb', textDecoration: 'underline' }}>{a.nome}</a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                {loadingIA && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#64748b', fontSize: 12 }}>
                    <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Respondendo...
                  </div>
                )}
                <div ref={msgEndRef} />
              </div>

              {/* Attachment preview */}
              {anexos.length > 0 && (
                <div style={{ display: 'flex', gap: 5, padding: '0 14px 8px', flexWrap: 'wrap' }}>
                  {anexos.map((a, i) => (
                    <div key={i} style={{ position: 'relative' }}>
                      {a.tipo === 'imagem'
                        ? <img src={a.url} alt={a.nome} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 6, border: '2px solid #e2e8f0' }} />
                        : <div style={{ padding: '4px 8px', background: '#f1f5f9', borderRadius: 6, fontSize: 10, color: '#64748b', fontWeight: 600 }}>{a.nome.slice(0,12)}</div>
                      }
                      <button onClick={() => setAnexos(prev => prev.filter((_,j)=>j!==i))}
                        style={{ position: 'absolute', top: -4, right: -4, background: '#ef4444', color: 'white', border: 'none', borderRadius: '50%', width: 14, height: 14, fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Input area */}
              <div style={{ padding: '10px 12px', borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <button onClick={() => fileRef.current?.click()} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 6, borderRadius: 8, display: 'flex' }}>
                  <Paperclip size={16} />
                </button>
                <textarea
                  value={texto}
                  onChange={e => setTexto(e.target.value)}
                  onPaste={handlePaste}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviarMensagem(); } }}
                  placeholder="Digite sua mensagem... (Ctrl+V para colar print)"
                  rows={2}
                  style={{ flex: 1, padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.4 }}
                />
                <button onClick={enviarMensagem} disabled={(!texto.trim() && !anexos.length) || enviando}
                  style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, padding: 10, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: ((!texto.trim() && !anexos.length) || enviando) ? 0.5 : 1 }}>
                  <Send size={15} />
                </button>
                <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleFile} />
              </div>
            </>
          )}
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}
    </>
  );
}
