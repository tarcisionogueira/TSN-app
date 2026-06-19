import React, { useState, useEffect, useRef } from 'react';
import { MessageCircle, CheckCircle2, Clock, Send, Paperclip, Bot, Loader2, Plus, ChevronLeft } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function MeusChamados() {
  const { user } = useAuth();
  const [aba, setAba] = useState('abertos');
  const [chamados, setChamados] = useState([]);
  const [chamadoAtivo, setChamadoAtivo] = useState(null);
  const [mensagens, setMensagens] = useState([]);
  const [texto, setTexto] = useState('');
  const [anexos, setAnexos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [loadingIA, setLoadingIA] = useState(false);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef();
  const msgEndRef = useRef();

  const nomeUsuario = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Cliente';

  useEffect(() => { if (user) carregarChamados(); }, [user, aba]);
  useEffect(() => { msgEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [mensagens]);

  useEffect(() => {
    if (!chamadoAtivo) return;
    const ch = supabase.channel(`mchamado-${chamadoAtivo.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chamados_mensagens', filter: `chamado_id=eq.${chamadoAtivo.id}` },
        payload => setMensagens(prev => prev.find(m => m.id === payload.new.id) ? prev : [...prev, payload.new]))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [chamadoAtivo?.id]);

  async function carregarChamados() {
    setLoading(true);
    const { data } = await supabase.from('chamados').select('*').eq('user_id', user.id)
      .in('status', aba === 'abertos' ? ['aberto','em_atendimento'] : ['finalizado'])
      .order('atualizado_em', { ascending: false });
    setChamados(data || []);
    setLoading(false);
  }

  async function abrirChamado(c) {
    setChamadoAtivo(c);
    const { data } = await supabase.from('chamados_mensagens').select('*').eq('chamado_id', c.id).order('criado_em', { ascending: true });
    setMensagens(data || []);
  }

  async function enviarMensagem() {
    if ((!texto.trim() && !anexos.length) || !chamadoAtivo) return;
    setEnviando(true);
    const { data: msg } = await supabase.from('chamados_mensagens').insert({
      chamado_id: chamadoAtivo.id, autor_id: user.id, autor_nome: nomeUsuario,
      autor_tipo: 'cliente', conteudo: texto || '[anexo]', anexos,
    }).select().single();
    const novaLista = msg ? [...mensagens, msg] : mensagens;
    setMensagens(novaLista);
    setTexto(''); setAnexos([]);
    // Trigger AI
    setLoadingIA(true);
    try {
      const res = await fetch('/api/chat-suporte', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mensagens: novaLista }) });
      const { resposta } = await res.json();
      if (resposta) {
        await supabase.from('chamados_mensagens').insert({ chamado_id: chamadoAtivo.id, autor_tipo: 'ia', autor_nome: 'TSN Assistente', conteudo: resposta, anexos: [] });
      }
    } catch (_) {}
    setLoadingIA(false);
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

  const fmtData = d => new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'short', year:'numeric' });
  const fmtHora = d => new Date(d).toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' });

  const STATUS = { aberto: { label:'Aberto', cor:'#10b981', bg:'#d1fae5' }, em_atendimento: { label:'Em atendimento', cor:'#2563eb', bg:'#dbeafe' }, finalizado: { label:'Finalizado', cor:'#64748b', bg:'#f1f5f9' } };

  if (chamadoAtivo) {
    const s = STATUS[chamadoAtivo.status] || STATUS.aberto;
    return (
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px' }}>
        <button onClick={() => setChamadoAtivo(null)} style={{ display:'flex', alignItems:'center', gap:6, background:'none', border:'none', color:'#2563eb', fontWeight:700, fontSize:13, cursor:'pointer', marginBottom:16, padding:0 }}>
          <ChevronLeft size={16} /> Voltar aos chamados
        </button>
        <div style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <div style={{ padding:'16px 20px', borderBottom:'1px solid #f1f5f9', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <h2 style={{ margin:0, fontSize:16, fontWeight:800, color:'#0f172a' }}>{chamadoAtivo.titulo}</h2>
              <div style={{ fontSize:12, color:'#94a3b8', marginTop:2 }}>Aberto em {fmtData(chamadoAtivo.criado_em)}</div>
            </div>
            <span style={{ fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20, background:s.bg, color:s.cor }}>{s.label}</span>
          </div>
          <div style={{ padding:20, maxHeight:460, overflowY:'auto', display:'flex', flexDirection:'column', gap:12 }}>
            {mensagens.map(m => (
              <div key={m.id} style={{ display:'flex', flexDirection:'column', alignItems:m.autor_tipo==='cliente'?'flex-end':'flex-start' }}>
                <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
                  <span style={{ fontSize:11, color:'#94a3b8' }}>
                    {m.autor_tipo==='ia'?'TSN Assistente':m.autor_tipo==='atendente'?(m.autor_nome||'Equipe TSN'):'Você'} · {fmtHora(m.criado_em)}
                  </span>
                </div>
                <div style={{ maxWidth:'80%', padding:'10px 14px', borderRadius:m.autor_tipo==='cliente'?'16px 16px 4px 16px':'16px 16px 16px 4px', background:m.autor_tipo==='cliente'?'#2563eb':m.autor_tipo==='ia'?'#f0f9ff':'#f0fdf4', color:m.autor_tipo==='cliente'?'white':'#0f172a', fontSize:14, lineHeight:1.6, border:m.autor_tipo!=='cliente'?`1px solid ${m.autor_tipo==='ia'?'#bae6fd':'#86efac'}`:'none' }}>
                  {m.conteudo}
                  {(m.anexos||[]).map((a,i) => a.tipo==='imagem' ? <img key={i} src={a.url} alt={a.nome} style={{ maxWidth:220, display:'block', marginTop:8, borderRadius:8 }} /> : <a key={i} href={a.url} download={a.nome} style={{ display:'block', marginTop:6, fontSize:12, color:m.autor_tipo==='cliente'?'rgba(255,255,255,0.9)':'#2563eb' }}>{a.nome}</a>)}
                </div>
              </div>
            ))}
            {loadingIA && <div style={{ display:'flex', gap:6, color:'#64748b', fontSize:12, alignItems:'center' }}><Loader2 size={13} style={{animation:'spin 1s linear infinite'}}/> Respondendo...</div>}
            <div ref={msgEndRef} />
          </div>
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
                <textarea value={texto} onChange={e=>setTexto(e.target.value)} onPaste={handlePaste} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();enviarMensagem();}}} placeholder="Digite sua mensagem... (Ctrl+V para colar print)" rows={2} style={{ flex:1, padding:'8px 12px', border:'1px solid #e2e8f0', borderRadius:10, fontSize:13, resize:'none', outline:'none', fontFamily:'inherit' }} />
                <button onClick={enviarMensagem} disabled={(!texto.trim()&&!anexos.length)||enviando} style={{ background:'#2563eb', color:'white', border:'none', borderRadius:10, padding:10, cursor:'pointer', display:'flex', opacity:((!texto.trim()&&!anexos.length)||enviando)?0.5:1 }}><Send size={15}/></button>
                <input ref={fileRef} type="file" accept="image/*,.pdf,.doc,.docx" style={{ display:'none' }} onChange={handleFile} />
              </div>
              <p style={{ fontSize:10, color:'#94a3b8', marginTop:4, marginBottom:0 }}>Ctrl+V para colar prints · Enter para enviar · Shift+Enter nova linha</p>
            </div>
          )}
          {chamadoAtivo.status === 'finalizado' && (
            <div style={{ padding:'12px 20px', background:'#f8fafc', borderTop:'1px solid #f1f5f9', fontSize:13, color:'#64748b', textAlign:'center' }}>
              <CheckCircle2 size={14} style={{ verticalAlign:'middle', marginRight:6, color:'#10b981' }}/> Chamado finalizado
            </div>
          )}
        </div>
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <h1 style={{ margin:0, fontSize:22, fontWeight:900, color:'#0f172a' }}>Meus Chamados</h1>
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:20 }}>
        {[['abertos','Em aberto'],['finalizados','Finalizados']].map(([k,l]) => (
          <button key={k} onClick={() => setAba(k)} style={{ padding:'8px 20px', borderRadius:10, border:'none', fontWeight:700, fontSize:13, cursor:'pointer', background:aba===k?'#2563eb':'white', color:aba===k?'white':'#64748b', border:aba!==k?'1px solid #e2e8f0':'none' }}>{l}</button>
        ))}
      </div>
      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:40 }}><Loader2 size={24} color="#2563eb" style={{ animation:'spin 1s linear infinite' }}/></div>
      ) : chamados.length === 0 ? (
        <div style={{ textAlign:'center', padding:'60px 20px', background:'white', borderRadius:14, border:'1px solid #e2e8f0' }}>
          <MessageCircle size={40} color="#cbd5e1" style={{ margin:'0 auto 16px' }}/>
          <h3 style={{ color:'#475569', fontWeight:700 }}>{aba === 'abertos' ? 'Nenhum chamado aberto' : 'Nenhum chamado finalizado'}</h3>
          {aba === 'abertos' && <p style={{ color:'#94a3b8', fontSize:13 }}>Use o botão de chat no canto da tela para abrir um chamado.</p>}
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {chamados.map(c => {
            const s = STATUS[c.status] || STATUS.aberto;
            return (
              <button key={c.id} onClick={() => abrirChamado(c)} style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, padding:'14px 18px', textAlign:'left', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', transition:'box-shadow 0.15s' }}
                onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.08)'}
                onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:'#0f172a', marginBottom:4 }}>{c.titulo}</div>
                  <div style={{ fontSize:12, color:'#94a3b8' }}>{fmtData(c.criado_em)}</div>
                </div>
                <span style={{ fontSize:11, fontWeight:700, padding:'4px 10px', borderRadius:20, background:s.bg, color:s.cor, whiteSpace:'nowrap', marginLeft:12 }}>{s.label}</span>
              </button>
            );
          })}
        </div>
      )}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}
