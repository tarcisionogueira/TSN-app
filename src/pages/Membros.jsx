import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, Lock, CheckCircle2, Clock, BookOpen, Star, Users,
  ChevronRight, Award, Zap, Crown, Search, Filter,
} from 'lucide-react';
import { CURSOS, CATEGORIAS, PLANOS_MEMBROS } from '../data/cursos';

// Progresso salvo no localStorage
function getProgresso() {
  try { return JSON.parse(localStorage.getItem('tsn_progresso') || '{}'); } catch { return {}; }
}

function getPlano() {
  return localStorage.getItem('tsn_plano_membro') || 'gratuito';
}

function podeAssistir(licao, planAtual) {
  if (licao.gratis) return true;
  return planAtual === 'profissional' || planAtual === 'vitalicio';
}

export default function Membros() {
  const nav = useNavigate();
  const [categoria, setCategoria] = useState('Todos');
  const [busca, setBusca] = useState('');
  const [progresso, setProgresso] = useState(getProgresso());
  const [plano, setPlano] = useState(getPlano());
  const [showPlanos, setShowPlanos] = useState(false);

  const cursosFiltrados = CURSOS.filter(c => {
    const matchCat = categoria === 'Todos' || c.categoria === categoria;
    const matchBusca = !busca || c.titulo.toLowerCase().includes(busca.toLowerCase()) || c.descricao.toLowerCase().includes(busca.toLowerCase());
    return matchCat && matchBusca;
  });

  const totalAulas = CURSOS.reduce((s, c) => s + c.aulas, 0);
  const aulasConcluidas = Object.keys(progresso).filter(k => progresso[k]).length;
  const cursosDestaques = CURSOS.filter(c => c.destaque);

  const NIVEL_COR = { 'Iniciante':'#10b981', 'Intermediário':'#f59e0b', 'Avançado':'#ef4444' };

  const ativarPlano = (p) => {
    localStorage.setItem('tsn_plano_membro', p);
    setPlano(p);
    setShowPlanos(false);
  };

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding:'24px 20px' }}>

      {/* Hero */}
      <div style={{ background:'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)', borderRadius:20, padding:'40px 48px', marginBottom:28, position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:-60, right:-60, width:240, height:240, borderRadius:'50%', background:'rgba(99,102,241,0.15)' }}/>
        <div style={{ position:'absolute', bottom:-40, right:120, width:160, height:160, borderRadius:'50%', background:'rgba(37,99,235,0.12)' }}/>
        <div style={{ position:'relative', zIndex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
            <div style={{ background:'#6366f1', borderRadius:10, padding:'8px 14px', fontSize:12, fontWeight:800, color:'white', textTransform:'uppercase', letterSpacing:1 }}>
              Área de Membros
            </div>
            <div style={{ background:'rgba(255,255,255,0.1)', borderRadius:10, padding:'8px 14px', fontSize:12, fontWeight:700, color:'#94a3b8' }}>
              Plano atual: <span style={{ color:'white' }}>{PLANOS_MEMBROS[plano]?.nome}</span>
            </div>
          </div>
          <h1 style={{ margin:'0 0 12px', fontSize:32, fontWeight:900, color:'white', lineHeight:1.2 }}>
            Sua trilha de conhecimento<br/>em leilões imobiliários
          </h1>
          <p style={{ margin:'0 0 24px', fontSize:15, color:'#94a3b8', maxWidth:500, lineHeight:1.7 }}>
            Do zero ao portfólio profissional. {CURSOS.length} cursos, {totalAulas} aulas com metodologia exclusiva TSN Ativos.
          </p>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
              {[
                [totalAulas+'+', 'Aulas'],
                [CURSOS.length, 'Cursos'],
                [aulasConcluidas, 'Concluídas'],
                ['∞', 'Acesso'],
              ].map(([v,l])=>(
                <div key={l} style={{ textAlign:'center' }}>
                  <div style={{ fontSize:26, fontWeight:900, color:'white' }}>{v}</div>
                  <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase' }}>{l}</div>
                </div>
              ))}
            </div>
            <button onClick={()=>setShowPlanos(true)}
              style={{ marginLeft:'auto', padding:'11px 22px', background:'#6366f1', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
              <Crown size={15}/> {plano==='gratuito'?'Fazer upgrade':'Gerenciar plano'}
            </button>
          </div>
        </div>
      </div>

      {/* Destaques */}
      {cursosDestaques.length > 0 && (
        <div style={{ marginBottom:24 }}>
          <div style={{ fontSize:12, fontWeight:800, color:'#f59e0b', textTransform:'uppercase', letterSpacing:1, marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
            <Star size={13} fill="#f59e0b"/> Cursos em destaque
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(400px,1fr))', gap:14 }}>
            {cursosDestaques.map(c => (
              <div key={c.id} onClick={()=>nav(`/membros/curso/${c.id}`)}
                style={{ background:`linear-gradient(135deg, ${c.cor}15 0%, white 60%)`, borderRadius:16, border:`2px solid ${c.cor}40`, padding:'20px 22px', cursor:'pointer', display:'flex', gap:16, alignItems:'center' }}
                onMouseEnter={e=>e.currentTarget.style.borderColor=c.cor} onMouseLeave={e=>e.currentTarget.style.borderColor=c.cor+'40'}>
                <div style={{ fontSize:48, flexShrink:0 }}>{c.emoji}</div>
                <div style={{ flex:1 }}>
                  <div style={{ display:'flex', gap:6, marginBottom:6 }}>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:c.bg, color:c.cor }}>{c.nivel}</span>
                    <span style={{ fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:20, background:'#fef3c7', color:'#92400e' }}>★ Destaque</span>
                  </div>
                  <div style={{ fontWeight:900, fontSize:16, color:'#0f172a', marginBottom:4 }}>{c.titulo}</div>
                  <div style={{ fontSize:12, color:'#64748b', lineHeight:1.5, marginBottom:8 }}>{c.subtitulo}</div>
                  <div style={{ display:'flex', gap:12, fontSize:11, color:'#94a3b8' }}>
                    <span><Clock size={11}/> {c.duracao}</span>
                    <span><BookOpen size={11}/> {c.aulas} aulas</span>
                    <span style={{ marginLeft:'auto', fontWeight:800, color:c.preco===0?'#10b981':c.cor }}>
                      {c.preco===0?'Gratuito':`R$ ${c.preco}`}
                    </span>
                  </div>
                </div>
                <ChevronRight size={18} color={c.cor}/>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Busca e filtros */}
      <div style={{ display:'flex', gap:12, marginBottom:16, flexWrap:'wrap', alignItems:'center' }}>
        <div style={{ position:'relative', flex:1, minWidth:200 }}>
          <Search size={14} color="#94a3b8" style={{ position:'absolute', left:11, top:'50%', transform:'translateY(-50%)' }}/>
          <input value={busca} onChange={e=>setBusca(e.target.value)} placeholder="Buscar curso..."
            style={{ width:'100%', padding:'9px 11px 9px 32px', border:'1px solid #e2e8f0', borderRadius:10, fontSize:13, boxSizing:'border-box' }}/>
        </div>
        <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
          {CATEGORIAS.map(cat => (
            <button key={cat} onClick={()=>setCategoria(cat)}
              style={{ padding:'7px 14px', border:'1px solid #e2e8f0', borderRadius:20, fontSize:12, fontWeight:700, cursor:'pointer', background:categoria===cat?'#0f172a':'white', color:categoria===cat?'white':'#64748b', transition:'all 0.15s' }}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grade de cursos */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:16 }}>
        {cursosFiltrados.map(c => {
          const totalLicoes = c.modulos.flatMap(m=>m.licoes).length;
          const concluidas = c.modulos.flatMap(m=>m.licoes).filter(l=>progresso[l.id]).length;
          const pct = totalLicoes > 0 ? Math.round(concluidas/totalLicoes*100) : 0;
          return (
            <div key={c.id} onClick={()=>nav(`/membros/curso/${c.id}`)}
              style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden', cursor:'pointer', transition:'all 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.05)' }}
              onMouseEnter={e=>{ e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.12)'; e.currentTarget.style.transform='translateY(-2px)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.05)'; e.currentTarget.style.transform='none'; }}>

              {/* Thumbnail */}
              <div style={{ background:`linear-gradient(135deg, ${c.cor} 0%, ${c.cor}cc 100%)`, padding:'28px 24px', display:'flex', alignItems:'center', gap:16 }}>
                <div style={{ fontSize:44 }}>{c.emoji}</div>
                <div>
                  <div style={{ fontSize:10, color:'rgba(255,255,255,0.7)', fontWeight:700, textTransform:'uppercase', marginBottom:4 }}>{c.categoria}</div>
                  <div style={{ fontSize:15, fontWeight:900, color:'white', lineHeight:1.3 }}>{c.titulo}</div>
                </div>
              </div>

              {/* Barra de progresso */}
              {concluidas > 0 && (
                <div style={{ height:4, background:'#f1f5f9' }}>
                  <div style={{ height:4, background:c.cor, width:`${pct}%`, transition:'width 0.3s' }}/>
                </div>
              )}

              <div style={{ padding:'16px 18px' }}>
                <p style={{ margin:'0 0 12px', fontSize:12, color:'#64748b', lineHeight:1.6 }}>{c.descricao.slice(0,100)}...</p>

                <div style={{ display:'flex', gap:8, marginBottom:12, flexWrap:'wrap' }}>
                  <span style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:20, background:'#f1f5f9', color:NIVEL_COR[c.nivel]||'#64748b', border:`1px solid ${NIVEL_COR[c.nivel]}40` }}>{c.nivel}</span>
                  <span style={{ fontSize:10, fontWeight:600, padding:'3px 8px', borderRadius:20, background:'#f8fafc', color:'#64748b', display:'flex', alignItems:'center', gap:3 }}><Clock size={10}/> {c.duracao}</span>
                  <span style={{ fontSize:10, fontWeight:600, padding:'3px 8px', borderRadius:20, background:'#f8fafc', color:'#64748b', display:'flex', alignItems:'center', gap:3 }}><BookOpen size={10}/> {c.aulas} aulas</span>
                </div>

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    {c.gratuito ? (
                      <span style={{ fontWeight:800, fontSize:15, color:'#10b981' }}>Gratuito</span>
                    ) : (
                      <div>
                        <span style={{ fontSize:11, color:'#94a3b8' }}>Acesso individual: </span>
                        <span style={{ fontWeight:800, fontSize:15, color:c.cor }}>R$ {c.preco}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    {concluidas>0 && <span style={{ fontSize:10, color:'#10b981', fontWeight:700 }}>{pct}%</span>}
                    <button style={{ background:c.cor, color:'white', border:'none', borderRadius:8, padding:'7px 14px', fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                      {pct===100 ? <><CheckCircle2 size={12}/> Concluído</> : pct>0 ? <><Play size={12}/> Continuar</> : <><Play size={12}/> Iniciar</>}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal de planos */}
      {showPlanos && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={()=>setShowPlanos(false)}>
          <div style={{ background:'white', borderRadius:20, padding:'32px', maxWidth:700, width:'100%', boxShadow:'0 24px 60px rgba(0,0,0,0.3)' }}
            onClick={e=>e.stopPropagation()}>
            <h2 style={{ margin:'0 0 6px', fontSize:22, fontWeight:900 }}>Planos de Acesso</h2>
            <p style={{ margin:'0 0 24px', color:'#64748b', fontSize:14 }}>Escolha o plano ideal para sua jornada</p>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))', gap:12 }}>
              {Object.entries(PLANOS_MEMBROS).map(([k,p])=>(
                <div key={k} onClick={()=>ativarPlano(k)}
                  style={{ borderRadius:14, border:`2px solid ${plano===k?p.cor:'#e2e8f0'}`, padding:'18px 16px', cursor:'pointer', background:plano===k?p.cor+'10':'white', transition:'all 0.15s' }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=p.cor} onMouseLeave={e=>e.currentTarget.style.borderColor=plano===k?p.cor:'#e2e8f0'}>
                  <div style={{ fontWeight:900, fontSize:15, color:p.cor, marginBottom:4 }}>{p.nome}</div>
                  <div style={{ fontSize:22, fontWeight:900, color:'#0f172a', marginBottom:8 }}>
                    {k==='gratuito'?'Grátis':`R$ ${p.preco}`}
                  </div>
                  <div style={{ fontSize:11, color:'#64748b', lineHeight:1.5 }}>{p.descricao}</div>
                  {plano===k && <div style={{ marginTop:10, fontSize:11, fontWeight:700, color:p.cor, display:'flex', alignItems:'center', gap:4 }}><CheckCircle2 size={12}/> Plano ativo</div>}
                </div>
              ))}
            </div>
            <p style={{ margin:'16px 0 0', fontSize:11, color:'#94a3b8', textAlign:'center' }}>
              Em produção, pagamentos serão processados via Asaas. Por ora, selecione para simular o acesso.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
