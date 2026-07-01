import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Play, Lock, CheckCircle2, Clock, BookOpen, ChevronLeft,
  ChevronDown, ChevronUp, Award, Crown, ArrowRight, ArrowLeft, ChevronRight,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { CURSOS, PLANOS } from '../data/cursos';

// ── localStorage fallback ─────────────────────────────────────────────────────
function getProgressoLocal() {
  try { return JSON.parse(localStorage.getItem('tsn_progresso') || '{}'); } catch { return {}; }
}
function salvarProgressoLocal(id, feito) {
  const p = getProgressoLocal();
  p[id] = feito;
  localStorage.setItem('tsn_progresso', JSON.stringify(p));
}
function getPlano() { return localStorage.getItem('tsn_plano_membro') || 'explorador'; }

const PLANOS_PAGOS = ['top2','assessorado','clube','analista','consultor','advogado','admin'];

function podeAssistir(licao, plano, comprouAvulso = false) {
  if (licao.gratis) return true;
  if (comprouAvulso) return true;
  return PLANOS_PAGOS.includes(plano);
}

export default function Curso() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, role } = useAuth();
  const curso = CURSOS.find(c => c.id === id);
  // Role from auth takes precedence over localStorage fallback
  const plano = role || getPlano();

  // progresso: { [aula_id]: true }
  const [progresso, setProgresso] = useState(getProgressoLocal());
  const [loadingProgresso, setLoadingProgresso] = useState(false);
  const [licaoAtiva, setLicaoAtiva] = useState(null);
  const [modulosAbertos, setModulosAbertos] = useState({ 0: true });
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [comprouAvulso, setComprouAvulso] = useState(false);

  // Verifica compra avulsa (curso pago standalone)
  useEffect(() => {
    if (!user || !id || PLANOS_PAGOS.includes(plano)) return;
    supabase.from('compras_produtos')
      .select('id').eq('user_id', user.id).eq('produto_tipo', 'curso').eq('produto_id', id).eq('status', 'ativo')
      .then(({ data }) => { if (data?.length > 0) setComprouAvulso(true); });
  }, [user, id, plano]);

  // Video progress simulation ref (tracks "watched" percentage)
  const videoTimerRef = useRef(null);
  const autoSavedRef = useRef(false); // tracks if 80% save already fired this session
  const [videoProgress, setVideoProgress] = useState(0); // 0-100
  const [videoPlaying, setVideoPlaying] = useState(false);

  const todasLicoes = curso ? curso.modulos.flatMap(m => m.licoes) : [];
  const concluidas = todasLicoes.filter(l => progresso[l.id]).length;
  const pct = todasLicoes.length > 0 ? Math.round(concluidas / todasLicoes.length * 100) : 0;

  // ── Carregar progresso do Supabase ──────────────────────────────────────────
  useEffect(() => {
    if (!user || !id) return;
    setLoadingProgresso(true);
    supabase
      .from('aula_progresso')
      .select('aula_id, concluida')
      .eq('user_id', user.id)
      .eq('curso_id', id)
      .then(({ data, error }) => {
        if (!error && data) {
          const map = {};
          data.forEach(r => { if (r.concluida) map[r.aula_id] = true; });
          // Merge with local (local wins if Supabase table doesn't exist yet)
          const local = getProgressoLocal();
          setProgresso({ ...local, ...map });
        }
        setLoadingProgresso(false);
      })
      .catch(() => setLoadingProgresso(false));
  }, [user, id]);

  // ── Salvar progresso no Supabase + localStorage ─────────────────────────────
  const salvarProgresso = useCallback(async (aulaid, feito) => {
    salvarProgressoLocal(aulaid, feito);
    setProgresso(p => ({ ...p, [aulaid]: feito }));
    if (!user) return;
    try {
      await supabase
        .from('aula_progresso')
        .upsert(
          { user_id: user.id, aula_id: aulaid, curso_id: id, concluida: feito },
          { onConflict: 'user_id,aula_id' }
        );
    } catch (_) { /* table may not exist yet, local fallback is fine */ }
  }, [user, id]);

  // ── Abrir na primeira aula disponível ──────────────────────────────────────
  useEffect(() => {
    if (curso) {
      const emProgresso = todasLicoes.find(l => !progresso[l.id] && podeAssistir(l, plano, comprouAvulso));
      const primeiraGratis = todasLicoes.find(l => l.gratis);
      setLicaoAtiva(emProgresso || primeiraGratis || todasLicoes[0]);
      setVideoProgress(0);
      setVideoPlaying(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Reset autoSaved flag when changing lesson
  useEffect(() => { autoSavedRef.current = false; setVideoProgress(0); setVideoPlaying(false); }, [licaoAtiva?.id]);

  // ── Simulação de progresso de vídeo ────────────────────────────────────────
  useEffect(() => {
    if (!videoPlaying || !licaoAtiva) return;
    videoTimerRef.current = setInterval(() => {
      setVideoProgress(prev => {
        const next = prev + 1;
        // Auto-mark complete at 80% — use ref to avoid stale closure
        if (next >= 80 && !autoSavedRef.current) {
          autoSavedRef.current = true;
          salvarProgresso(licaoAtiva.id, true);
        }
        if (next >= 100) {
          clearInterval(videoTimerRef.current);
          setVideoPlaying(false);
          return 100;
        }
        return next;
      });
    }, 300);
    return () => clearInterval(videoTimerRef.current);
  }, [videoPlaying, licaoAtiva, salvarProgresso]);

  if (!curso) {
    return (
      <div style={{ maxWidth:800, margin:'80px auto', textAlign:'center', padding:20 }}>
        <div style={{ fontSize:40 }}>🔍</div>
        <h2 style={{ color:'#334155' }}>Curso não encontrado</h2>
        <button onClick={()=>nav('/membros')} style={{ background:'#0D63DB', color:'white', border:'none', borderRadius:10, padding:'10px 20px', fontWeight:700, cursor:'pointer', marginTop:16 }}>
          Voltar à Área de Membros
        </button>
      </div>
    );
  }

  const podeVer = licaoAtiva ? podeAssistir(licaoAtiva, plano, comprouAvulso) : false;

  const marcarConcluida = (lid) => {
    salvarProgresso(lid, true);
    const idx = todasLicoes.findIndex(l => l.id === lid);
    if (idx < todasLicoes.length - 1) {
      setTimeout(() => {
        setLicaoAtiva(todasLicoes[idx + 1]);
        setVideoProgress(0);
        setVideoPlaying(false);
      }, 500);
    }
  };

  const irParaLicao = (lic) => {
    if (!podeAssistir(lic, plano, comprouAvulso)) { setShowUpgrade(true); return; }
    setLicaoAtiva(lic);
    setVideoProgress(0);
    setVideoPlaying(false);
    clearInterval(videoTimerRef.current);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const licaoIdx = todasLicoes.findIndex(l => l.id === licaoAtiva?.id);
  const licaoAnterior = licaoIdx > 0 ? todasLicoes[licaoIdx - 1] : null;
  const proximaLicao = licaoIdx < todasLicoes.length - 1 ? todasLicoes[licaoIdx + 1] : null;

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding:'20px', display:'grid', gridTemplateColumns:'360px 1fr', gap:20, alignItems:'start' }}>

      {/* SIDEBAR */}
      <div style={{ display:'flex', flexDirection:'column', gap:12, position:'sticky', top:82 }}>

        {/* Cabeçalho do curso */}
        <div style={{ background:`linear-gradient(135deg, ${curso.cor} 0%, ${curso.cor}cc 100%)`, borderRadius:16, padding:'20px' }}>
          <button onClick={()=>nav('/membros')}
            style={{ display:'flex', alignItems:'center', gap:6, background:'rgba(255,255,255,0.15)', border:'none', borderRadius:8, padding:'6px 12px', color:'white', fontSize:12, fontWeight:600, cursor:'pointer', marginBottom:14 }}>
            <ChevronLeft size={13}/> Todos os cursos
          </button>
          <div style={{ fontSize:40, marginBottom:10 }}>{curso.emoji}</div>
          <h2 style={{ margin:'0 0 6px', fontSize:17, fontWeight:900, color:'white', lineHeight:1.2 }}>{curso.titulo}</h2>
          <p style={{ margin:'0 0 16px', fontSize:12, color:'rgba(255,255,255,0.75)', lineHeight:1.5 }}>{curso.subtitulo}</p>
          <div style={{ display:'flex', gap:12, fontSize:11, color:'rgba(255,255,255,0.7)' }}>
            <span><Clock size={11}/> {curso.duracao}</span>
            <span><BookOpen size={11}/> {curso.aulas} aulas</span>
          </div>
        </div>

        {/* Barra de progresso geral */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'14px 16px' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#334155' }}>Seu progresso</span>
            <span style={{ fontSize:13, fontWeight:900, color:curso.cor }}>{pct}%</span>
          </div>
          <div style={{ height:8, background:'#f1f5f9', borderRadius:8, overflow:'hidden' }}>
            <div style={{ height:8, background:curso.cor, width:`${pct}%`, borderRadius:8, transition:'width 0.4s' }}/>
          </div>
          <div style={{ fontSize:11, color:'#94a3b8', marginTop:6 }}>{concluidas} de {todasLicoes.length} aulas concluídas</div>
          {pct === 100 && (
            <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:6, background:'#fef3c7', borderRadius:8, padding:'8px 12px' }}>
              <Award size={14} color="#f59e0b"/>
              <span style={{ fontSize:11, fontWeight:700, color:'#92400e' }}>Curso concluído! 🎉</span>
            </div>
          )}
        </div>

        {/* Lista de módulos e aulas */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          {curso.modulos.map((mod, mi) => (
            <div key={mi}>
              <button onClick={()=>setModulosAbertos(p=>({...p,[mi]:!p[mi]}))}
                style={{ width:'100%', padding:'12px 16px', border:'none', background:modulosAbertos[mi]?'#f8fafc':'white', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #f1f5f9', textAlign:'left' }}>
                <div>
                  <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:0.4, marginBottom:2 }}>
                    Módulo {mi+1}
                  </div>
                  <div style={{ fontSize:12, fontWeight:700, color:'#111111', lineHeight:1.3 }}>{mod.titulo.replace(`Módulo ${mi+1} — `, '')}</div>
                </div>
                {modulosAbertos[mi] ? <ChevronUp size={14} color="#94a3b8"/> : <ChevronDown size={14} color="#94a3b8"/>}
              </button>
              {modulosAbertos[mi] && mod.licoes.map((lic) => {
                const ativa = licaoAtiva?.id === lic.id;
                const feita = progresso[lic.id];
                const pode = podeAssistir(lic, plano);
                return (
                  <button key={lic.id} onClick={()=>irParaLicao(lic)}
                    style={{ width:'100%', padding:'10px 16px 10px 24px', border:'none', borderBottom:'1px solid #f8fafc', background:ativa?curso.cor+'12':'white', cursor:'pointer', display:'flex', alignItems:'center', gap:10, textAlign:'left', transition:'background 0.15s' }}
                    onMouseEnter={e=>{ if(!ativa) e.currentTarget.style.background='#f8fafc'; }}
                    onMouseLeave={e=>{ if(!ativa) e.currentTarget.style.background='white'; }}>
                    <div style={{ flexShrink:0 }}>
                      {feita
                        ? <CheckCircle2 size={16} color="#10b981"/>
                        : !pode
                          ? <Lock size={14} color="#94a3b8"/>
                          : <div style={{ width:16, height:16, borderRadius:'50%', border:`2px solid ${ativa?curso.cor:'#cbd5e1'}`, background:ativa?curso.cor:'transparent', display:'flex', alignItems:'center', justifyContent:'center' }}>
                              {ativa && <div style={{ width:6, height:6, background:'white', borderRadius:'50%' }}/>}
                            </div>}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12, fontWeight:ativa?700:500, color:ativa?curso.cor:'#334155', lineHeight:1.3, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {feita && <span style={{ marginRight:4 }}>✅</span>}{lic.titulo}
                      </div>
                      <div style={{ fontSize:10, color:'#94a3b8', marginTop:2, display:'flex', gap:6 }}>
                        <span>{lic.duracao}</span>
                        {lic.gratis && <span style={{ color:'#10b981', fontWeight:600 }}>Grátis</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ÁREA DE CONTEÚDO */}
      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

        {/* Breadcrumb */}
        <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'#94a3b8' }}>
          <span style={{ cursor:'pointer', color:'#0D63DB', fontWeight:600 }} onClick={()=>nav('/membros')}>Membros</span>
          <ChevronRight size={13}/>
          <span style={{ color:'#64748b' }}>{curso.titulo}</span>
          {licaoAtiva && <><ChevronRight size={13}/><span style={{ color:'#64748b' }}>{licaoAtiva.titulo}</span></>}
        </div>

        {licaoAtiva && (
          <>
            {podeVer ? (
              <div style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden' }}>

                {/* Player simulado com progresso */}
                <div style={{ background:'#111111', aspectRatio:'16/9', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, position:'relative' }}
                  onClick={() => { if (podeVer) setVideoPlaying(p => !p); }}>
                  <div style={{ position:'absolute', inset:0, background:`radial-gradient(circle at 30% 40%, ${curso.cor}30 0%, transparent 60%)` }}/>
                  <div style={{ fontSize:72, position:'relative' }}>{curso.emoji}</div>
                  <div style={{ position:'relative', textAlign:'center' }}>
                    <div style={{ fontSize:16, fontWeight:700, color:'white', marginBottom:8 }}>{licaoAtiva.titulo}</div>
                    <div style={{ fontSize:12, color:'#94a3b8' }}>{licaoAtiva.duracao}</div>
                  </div>
                  <button style={{ position:'relative', width:64, height:64, borderRadius:'50%', background:curso.cor, border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', boxShadow:`0 0 0 8px ${curso.cor}40` }}
                    onClick={e => { e.stopPropagation(); setVideoPlaying(p => !p); }}>
                    <Play size={24} color="white" fill="white" style={{ marginLeft:3 }}/>
                  </button>
                  {/* Barra de progresso de vídeo */}
                  <div style={{ position:'absolute', bottom:16, left:16, right:16, display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ flex:1, height:4, background:'rgba(255,255,255,0.15)', borderRadius:4, cursor:'pointer', position:'relative' }}>
                      <div style={{ width:`${videoProgress}%`, height:4, background:curso.cor, borderRadius:4, transition:'width 0.3s' }}/>
                    </div>
                    <span style={{ fontSize:11, color:'#94a3b8', flexShrink:0 }}>
                      {videoPlaying ? `${videoProgress}%` : '0:00'} / {licaoAtiva.duracao}
                    </span>
                  </div>
                  {videoPlaying && (
                    <div style={{ position:'absolute', top:12, right:12, background:'rgba(0,0,0,0.6)', borderRadius:6, padding:'3px 8px', fontSize:10, color:'white', fontWeight:600 }}>
                      ▶ Assistindo…
                    </div>
                  )}
                  {videoProgress >= 80 && progresso[licaoAtiva.id] && !videoPlaying && (
                    <div style={{ position:'absolute', top:12, right:12, background:'#10b981', borderRadius:6, padding:'3px 8px', fontSize:10, color:'white', fontWeight:600 }}>
                      ✅ Concluída automaticamente
                    </div>
                  )}
                </div>

                {/* Controles + título */}
                <div style={{ padding:'22px 24px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14, flexWrap:'wrap', gap:10 }}>
                    <div>
                      <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', marginBottom:4 }}>
                        {curso.modulos.find(m=>m.licoes.some(l=>l.id===licaoAtiva.id))?.titulo}
                      </div>
                      <h2 style={{ margin:0, fontSize:20, fontWeight:900, color:'#111111' }}>{licaoAtiva.titulo}</h2>
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {licaoAnterior && (
                        <button onClick={()=>irParaLicao(licaoAnterior)}
                          style={{ padding:'7px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', background:'white', color:'#475569', display:'flex', alignItems:'center', gap:5 }}>
                          <ArrowLeft size={13}/> Anterior
                        </button>
                      )}
                      {!progresso[licaoAtiva.id] ? (
                        <button onClick={()=>marcarConcluida(licaoAtiva.id)}
                          style={{ padding:'7px 16px', background:curso.cor, color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                          <CheckCircle2 size={13}/> Marcar como concluída
                        </button>
                      ) : (
                        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', background:'#d1fae5', borderRadius:8, fontSize:12, fontWeight:700, color:'#065f46' }}>
                          <CheckCircle2 size={13}/> Concluída
                        </div>
                      )}
                      {proximaLicao && (
                        <button onClick={()=>irParaLicao(proximaLicao)}
                          style={{ padding:'7px 12px', background:'#111111', color:'white', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                          Próxima <ArrowRight size={13}/>
                        </button>
                      )}
                    </div>
                  </div>

                  <div style={{ background:'#f8fafc', borderRadius:12, padding:'16px 18px', borderLeft:`4px solid ${curso.cor}` }}>
                    <div style={{ fontSize:11, fontWeight:700, color:curso.cor, textTransform:'uppercase', marginBottom:8 }}>Sobre esta aula</div>
                    <p style={{ margin:0, fontSize:14, color:'#334155', lineHeight:1.8 }}>{licaoAtiva.descricao}</p>
                  </div>

                  {/* Material de apoio */}
                  <div style={{ marginTop:16 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', marginBottom:10 }}>Material de apoio</div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      {['📄 Slides da aula', '📊 Planilha de cálculo', '📋 Checklist PDF'].map(m=>(
                        <div key={m} style={{ padding:'7px 12px', background:'#f1f5f9', borderRadius:8, fontSize:12, color:'#475569', fontWeight:500, cursor:'pointer', border:'1px solid #e2e8f0' }}>
                          {m}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Conteúdo bloqueado */
              <div style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden' }}>
                <div style={{ background:'#111111', aspectRatio:'16/9', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, position:'relative' }}>
                  <div style={{ position:'absolute', inset:0, backdropFilter:'blur(2px)' }}/>
                  <div style={{ position:'relative', textAlign:'center' }}>
                    <div style={{ width:72, height:72, borderRadius:'50%', background:'rgba(255,255,255,0.1)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
                      <Lock size={32} color="rgba(255,255,255,0.5)"/>
                    </div>
                    <div style={{ fontSize:16, fontWeight:700, color:'white', marginBottom:8 }}>Conteúdo exclusivo para assinantes</div>
                    <div style={{ fontSize:13, color:'#94a3b8', marginBottom:24 }}>{licaoAtiva.titulo}</div>
                    <button onClick={()=>setShowUpgrade(true)}
                      style={{ padding:'12px 28px', background:'#6366f1', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', gap:8, margin:'0 auto' }}>
                      <Crown size={16}/> Desbloquear acesso
                    </button>
                  </div>
                </div>
                <div style={{ padding:'20px 24px', textAlign:'center', color:'#64748b', fontSize:13 }}>
                  Faça upgrade do seu plano para acessar esta e todas as outras aulas do curso.
                </div>
              </div>
            )}

            {/* A seguir neste módulo */}
            <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'16px 20px' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:0.5, marginBottom:12 }}>A seguir neste módulo</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {todasLicoes.slice(licaoIdx+1, licaoIdx+4).map((lic) => (
                  <button key={lic.id} onClick={()=>irParaLicao(lic)}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', border:'none', borderRadius:10, background:'#f8fafc', cursor:'pointer', textAlign:'left' }}
                    onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='#f8fafc'}>
                    <div style={{ width:36, height:36, borderRadius:8, background:podeAssistir(lic,plano)?curso.cor+'20':'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {progresso[lic.id] ? <CheckCircle2 size={16} color="#10b981"/>
                        : !podeAssistir(lic,plano) ? <Lock size={14} color="#94a3b8"/>
                        : <Play size={14} color={curso.cor}/>}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'#111111' }}>{lic.titulo}</div>
                      <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>{lic.duracao}{lic.gratis?' · Grátis':''}</div>
                    </div>
                    <ChevronRight size={14} color="#94a3b8"/>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal upgrade */}
      {showUpgrade && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={()=>setShowUpgrade(false)}>
          <div style={{ background:'white', borderRadius:20, padding:'32px', maxWidth:480, width:'100%' }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ textAlign:'center', marginBottom:24 }}>
              <div style={{ width:64, height:64, borderRadius:16, background:'#ede9fe', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px' }}>
                <Crown size={28} color="#7c3aed"/>
              </div>
              <h3 style={{ margin:'0 0 8px', fontSize:20, fontWeight:900 }}>Desbloqueie o conteúdo completo</h3>
              <p style={{ margin:0, color:'#64748b', fontSize:14, lineHeight:1.6 }}>
                Acesse todas as {todasLicoes.length} aulas do curso <strong>{curso.titulo}</strong> e muito mais.
              </p>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
              {[
                { p:'essencial', label:'Plano Essencial — R$ 97/mês', desc:'Fundamentos completos' },
                { p:'profissional', label:'Plano Profissional — R$ 297/mês', desc:'Todos os cursos + novidades', destaque:true },
              ].map(({p:pk,label,desc,destaque})=>(
                <button key={pk} onClick={()=>{ localStorage.setItem('tsn_plano_membro',pk); setShowUpgrade(false); window.location.reload(); }}
                  style={{ padding:'14px 18px', border:`2px solid ${destaque?'#7c3aed':'#e2e8f0'}`, borderRadius:12, background:destaque?'#ede9fe':'white', cursor:'pointer', textAlign:'left' }}>
                  <div style={{ fontWeight:700, color:destaque?'#7c3aed':'#111111', fontSize:14 }}>{label}</div>
                  <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{desc}</div>
                </button>
              ))}
            </div>
            <p style={{ margin:0, fontSize:11, color:'#94a3b8', textAlign:'center' }}>
              Simulação local — integração Asaas em breve para pagamento real.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
