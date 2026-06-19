import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, CheckCircle2, Clock, User, Send, Paperclip, Bot, Loader2, UserCheck, XCircle, AlertCircle, RefreshCw } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

const STATUS_CONFIG = {
  aberto: { label: 'Aberto', cor: '#10b981', bg: '#d1fae5', icon: AlertCircle },
  em_atendimento: { label: 'Em atendimento', cor: '#2563eb', bg: '#dbeafe', icon: Clock },
  finalizado: { label: 'Finalizado', cor: '#64748b', bg: '#f1f5f9', icon: CheckCircle2 },
};

export default function Atendimento() {
  const { user } = useAuth();
  const [chamados, setChamados] = useState([]);
  const [filtro, setFiltro] = useState('pendentes');
  const [chamadoAtivo, setChamadoAtivo] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef();
  const msgEndRef = useRef();
  const nomeAtendente = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Atendente';

  useEffect(() => { carregarChamados(); }, [filtro]);
  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensagens]);

  useEffect(() => {
    const ch = supabase.channel('fila-atendimento')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chamados' }, () => carregarChamados())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [filtro]);

  useEffect(() => {
    if (!chamadoAtivo) return;
    const ch = supabase.channel(`atend-${chamadoAtivo.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chamados_mensagens', filter: `chamado_id=eq.${chamadoAtivo.id}` },
        p => setMensagens(prev => prev.find(m => m.id === p.new.id) ? prev : [...prev, p.new]))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [chamadoAtivo?.id]);

  async function carregarChamados() {
    setLoading(true);
    let q = supabase.from('chamados').select('*').order('criado_em', { ascending: true });
    if (filtro === 'pendentes') q = q.in('status', ['aberto', 'em_atendimento']);
    else if (filtro !== 'todos') q = q.eq('status', filtro);
    const { data } = await q;
    setChamados(data || []);
    setLoading(false);
  }

  async function abrirChamado(c) {
    setChamadoAtivo(c);
    const { data } = await supabase.from('chamados_mensagens').select('*').eq('chamado_id', c.id).order('criado_em', { ascending: true });
    setMensagens(data || []);
  }

  async function assumirChamado() {
    if (!chamadoAtivo) return;
    await supabase.from('chamados').update({ status: 'em_atendimento', atendente_id: user.id, atendente_nome: nomeAtendente, atualizado_em: new Date().toISOString() }).eq('id', chamadoAtivo.id);
    setChamadoAtivo(prev => ({ ...prev, status: 'em_atendimento', atendente_id: user.id, atendente_nome: nomeAtendente }));
    carregarChamados();
  }

  async function finalizarChamado() {
    if (!chamadoAtivo || !window.confirm('Finalizar este chamado?')) return;
    await supabase.from('chamados').update({ status: 'finalizado', atualizado_em: new Date().toISOString() }).eq('id', chamadoAtivo.id);
    setChamadoAtivo(prev => ({ ...prev, status: 'finalizado' }));
    carregarChamados();
  }

  async function enviarMensagem() {
    if ((!texto.trim() && !anexos.length) || !chamadoAtivo) return;
    setEnviando(true);
    const { data: msg } = await supabase.from('chamados_mensagens').insert({
      chamado_id: chamadoAtivo.id, autor_id: user.id, autor_nome: nomeAtendente,
      autor_tipo: 'atendente', conteudo: texto || '[anexo]', anexos,
    }).select().single();
    if (msg) setMensagens(prev => [...prev, msg]);
    await supabase.from('chamados').update({ atualizado_em: new Date().toISOString() }).eq('id', chamadoAtivo.id);
    setTexto(''); setAnexos([]);
    setEnviando(false);
  }

  function handlePaste(e) {
    for (const item of e.clipboardData?.items || []) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = ev => setAnexos(prev => [...prev, { tipo: 'imagem', url: ev.target.result, nome: 'screenshot.png' }]);
        reader.readAsDataURL(file);
      }
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setAnexos(prev => [...prev, { tipo: file.type.startsWith('image/') ? 'imagem' : 'arquivo', url: ev.target.result, nome: file.name }]);
    reader.readAsDataURL(file);
    e.target.value = '';
  }

  const fmtData = d => new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'short' });
  const fmtHora = d => new Date(d).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });
  const contPorStatus = (s) => chamados.filter(c => c.status === s).length;

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 20px', display: 'grid', gridTemplateColumns: '320px 1fr', gap: 20, minHeight: 'calc(100vh - 120px)', alignItems: 'start' }}>

      {/* Sidebar — Fila */}
      <div>
        <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>Fila de Atendimento</div>
            <button onClick={carregarChamados} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4, display: 'flex' }}><RefreshCw size={14}/></button>
          </div>
          {/* Status summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0, borderBottom: '1px solid #f1f5f9' }}>
            {[['aberto','Abertos','#10b981'],['em_atendimento','Em at.','#2563eb'],['finalizado','Finalizados','#64748b']].map(([s,l,c]) => (
              <div key={s} style={{ padding:'10px 8px', textAlign:'center', borderRight:'1px solid #f1f5f9' }}>
                <div style={{ fontSize:18, fontWeight:900, color:c }}>{contPorStatus(s)}</div>
                <div style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>{l}</div>
              </div>
            ))}
          </div>
          {/* Filter tabs */}
          <div style={{ padding: '8px 12px', display: 'flex', gap: 6, borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
            {[['pendentes','Pendentes'],['todos','Todos'],['finalizado','Finalizados']].map(([k,l]) => (
              <button key={k} onClick={() => setFiltro(k)}
                style={{ padding:'4px 12px', borderRadius:20, border:'none', fontSize:11, fontWeight:700, cursor:'pointer', background:filtro===k?'#0f172a':'#f1f5f9', color:filtro===k?'white':'#64748b' }}>{l}</button>
            ))}
          </div>
          {/* List */}
          <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {loading ? (
              <div style={{ padding:24, textAlign:'center' }}><Loader2 size={20} color="#2563eb" style={{ animation:'spin 1s linear infinite' }}/></div>
            ) : chamados.length === 0 ? (
              <div style={{ padding:24, textAlign:'center', color:'#94a3b8', fontSize:13 }}>Nenhum chamado</div>
            ) : chamados.map(c => {
              const s = STATUS_CONFIG[c.status] || STATUS_CONFIG.aberto;
              const ativo = chamadoAtivo?.id === c.id;
              return (
                <button key={c.id} onClick={() => abrirChamado(c)}
                  style={{ width:'100%', padding:'12px 14px', border:'none', background:ativo?'#eff6ff':'none', textAlign:'left', cursor:'pointer', borderBottom:'1px solid #f8fafc' }}
                  onMouseEnter={e=>{ if(!ativo) e.currentTarget.style.background='#f8fafc'; }}
                  onMouseLeave={e=>{ if(!ativo) e.currentTarget.style.background='none'; }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
                    <span style={{ fontSize:13, fontWeight:700, color:'#0f172a', lineHeight:1.3, flex:1, marginRight:8 }}>{c.titulo}</span>
                    <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10, background:s.bg, color:s.cor, whiteSpace:'nowrap' }}>{s.label}</span>
                  </div>
                  <div style={{ fontSize:11, color:'#64748b' }}>{c.user_nome || c.user_email} · {fmtData(c.criado_em)}</div>
                  {c.atendente_nome && <div style={{ fontSize:10, color:'#94a3b8', marginTop:2 }}>Atendente: {c.atendente_nome}</div>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main panel — Conversation */}
      {!chamadoAtivo ? (
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:60 }}>
          <MessageCircle size={48} color="#cbd5e1" />
          <p style={{ color:'#94a3b8', marginTop:16, fontSize:14 }}>Selecione um chamado na fila para visualizar</p>
        </div>
      ) : (
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', display:'flex', flexDirection:'column', overflow:'hidden' }}>
          {/* Header */}
          <div style={{ padding:'14px 20px', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
            <div>
              <h2 style={{ margin:0, fontSize:15, fontWeight:800, color:'#0f172a' }}>{chamadoAtivo.titulo}</h2>
              <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                <User size={11} style={{ verticalAlign:'middle', marginRight:4 }}/>{chamadoAtivo.user_nome || chamadoAtivo.user_email}
                {chamadoAtivo.atendente_nome && <> · Atendente: <strong>{chamadoAtivo.atendente_nome}</strong></>}
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              {chamadoAtivo.status === 'aberto' && (
                <button onClick={assumirChamado}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 16px', background:'#2563eb', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  <UserCheck size={14}/> Assumir
                </button>
              )}
              {chamadoAtivo.status !== 'finalizado' && (
                <button onClick={finalizarChamado}
                  style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', background:'#f1f5f9', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  <CheckCircle2 size={14}/> Finalizar
                </button>
              )}
              {chamadoAtivo.status === 'finalizado' && (
                <span style={{ padding:'6px 14px', background:'#f1f5f9', color:'#64748b', borderRadius:8, fontSize:12, fontWeight:700 }}>
                  <CheckCircle2 size={13} style={{ verticalAlign:'middle', marginRight:4 }}/>Finalizado
                </span>
              )}
            </div>
          </div>

          {/* Messages */}
          <div style={{ padding:20, flex:1, overflowY:'auto', minHeight:320, maxHeight:440, display:'flex', flexDirection:'column', gap:12 }}>
            {mensagens.map(m => (
              <div key={m.id} style={{ display:'flex', flexDirection:'column', alignItems:m.autor_tipo==='cliente'?'flex-start':'flex-end' }}>
                <div style={{ fontSize:11, color:'#94a3b8', marginBottom:3 }}>
                  {m.autor_tipo==='ia'?'TSN Assistente':m.autor_tipo==='atendente'?(m.autor_nome||'Equipe'):m.autor_nome||'Cliente'} · {fmtHora(m.criado_em)}
                </div>
                <div style={{ maxWidth:'75%', padding:'10px 14px', borderRadius:12, background:m.autor_tipo==='cliente'?'#f1f5f9':m.autor_tipo==='ia'?'#eff6ff':'#ecfdf5', color:'#0f172a', fontSize:13, lineHeight:1.6, border:`1px solid ${m.autor_tipo==='cliente'?'#e2e8f0':m.autor_tipo==='ia'?'#bae6fd':'#86efac'}` }}>
                  {m.autor_tipo === 'ia' && <div style={{ fontSize:10, fontWeight:700, color:'#2563eb', marginBottom:4, display:'flex', alignItems:'center', gap:4 }}><Bot size={11}/>Assistente</div>}
                  {m.conteudo}
                  {(m.anexos||[]).map((a,i) => a.tipo==='imagem' ? <img key={i} src={a.url} alt={a.nome} style={{ maxWidth:200, display:'block', marginTop:8, borderRadius:8 }} /> : <a key={i} href={a.url} download={a.nome} style={{ display:'block', marginTop:6, fontSize:12, color:'#2563eb' }}>{a.nome}</a>)}
                </div>
              </div>
            ))}
            <div ref={msgEndRef} />
          </div>

          {/* Reply input */}
          {chamadoAtivo.status !== 'finalizado' && (
            <div style={{ padding:'12px 16px', borderTop:'1px solid #f1f5f9' }}>
              {anexos.length > 0 && (
                <div style={{ display:'flex', gap:5, marginBottom:8, flexWrap:'wrap' }}>
                  {anexos.map((a,i) => (
                    <div key={i} style={{ position:'relative' }}>
                      {a.tipo==='imagem' ? <img src={a.url} alt={a.nome} style={{ width:48, height:48, objectFit:'cover', borderRadius:6, border:'2px solid #e2e8f0' }} /> : <div style={{ padding:'4px 8px', background:'#f1f5f9', borderRadius:6, fontSize:10, color:'#64748b' }}>{a.nome.slice(0,14)}</div>}
                      <button onClick={() => setAnexos(p => p.filter((_,j)=>j!==i))} style={{ position:'absolute', top:-4, right:-4, background:'#ef4444', color:'white', border:'none', borderRadius:'50%', width:14, height:14, fontSize:9, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', padding:0 }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display:'flex', gap:8, alignItems:'flex-end' }}>
                <button onClick={() => fileRef.current?.click()} style={{ background:'none', border:'none', color:'#94a3b8', cursor:'pointer', padding:8, borderRadius:8 }}><Paperclip size={16}/></button>
                <textarea value={texto} onChange={e=>setTexto(e.target.value)} onPaste={handlePaste} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();enviarMensagem();}}} placeholder="Responder ao cliente... (Ctrl+V para colar print)" rows={2} style={{ flex:1, padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:10, fontSize:13, resize:'none', outline:'none', fontFamily:'inherit' }} />
                <button onClick={enviarMensagem} disabled={(!texto.trim()&&!anexos.length)||enviando} style={{ background:'#0f172a', color:'white', border:'none', borderRadius:10, padding:10, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', opacity:((!texto.trim()&&!anexos.length)||enviando)?0.5:1 }}>
                  {enviando ? <Loader2 size={15} style={{ animation:'spin 1s linear infinite' }}/> : <Send size={15}/>}
                </button>
                <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" style={{ display:'none' }} onChange={handleFile} />
              </div>
            </div>
          )}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
