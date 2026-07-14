import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play, CheckCircle2, BookOpen, Star,
  ChevronRight, Crown, Search, AlertTriangle,
} from 'lucide-react';
import { CATEGORIAS, PLANOS, PACOTE } from '../data/cursos';
import { fetchPlanosComConfig } from '../utils/planosConfig';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';

// Progresso salvo no localStorage (fallback)
function getProgressoLocal() {
  try { return JSON.parse(localStorage.getItem('tsn_progresso') || '{}'); } catch { return {}; }
}

function getPlano() {
  return localStorage.getItem('tsn_plano_membro') || 'explorador';
}

function podeAssistir(licao, planAtual) {
  if (licao.gratis) return true;
  if (planAtual === 'admin') return true;
  return planAtual === 'assessorado' || planAtual === 'clube';
}

// Placeholder de capa de ebook com gradiente e inicial
function EbookCover({ titulo }) {
  const colors = [
    ['#6366f1','#4f46e5'],
    ['#0ea5e9','#0284c7'],
    ['#10b981','#059669'],
    ['#f59e0b','#d97706'],
    ['#ef4444','#dc2626'],
    ['#8b5cf6','#7c3aed'],
  ];
  const idx = titulo ? titulo.charCodeAt(0) % colors.length : 0;
  const [c1, c2] = colors[idx];
  const letra = titulo?.[0]?.toUpperCase() || '?';
  return (
    <div style={{ width:'100%', aspectRatio:'2/3', background:`linear-gradient(135deg,${c1},${c2})`, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:8 }}>
      <div style={{ fontSize:48, fontWeight:900, color:'white', lineHeight:1 }}>{letra}</div>
      <div style={{ fontSize:9, color:'rgba(255,255,255,0.7)', fontWeight:700, textTransform:'uppercase', letterSpacing:1 }}>eBook</div>
    </div>
  );
}

export default function Membros() {
  const nav = useNavigate();
  const { user, role } = useAuth();
  const [categoria, setCategoria] = useState('Todos');
  const [busca, setBusca] = useState('');
  const [progresso, setProgresso] = useState(getProgressoLocal());
  const [plano, setPlano] = useState(role || getPlano());
  const [showPlanos, setShowPlanos] = useState(false);
  const [showCancelar, setShowCancelar] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [cancelMsg, setCancelMsg] = useState('');
  const [cursos, setCursos] = useState([]);
  const [ebooks, setEbooks] = useState([]);
  // Preços dos planos: começa no estático (render imediato) e é sobrescrito com os
  // valores AO VIVO do admin (planos_config). Antes usava só o estático (cursos.js),
  // então mudar um preço no admin NÃO refletia na área de membros.
  const [planos, setPlanos] = useState(PLANOS);

  // Carregar cursos, aulas e ebooks
  useEffect(() => {
    async function fetchData() {
      const { data: cs } = await supabase.from('cursos_admin').select('*').eq('ativo', true).order('ordem');
      const { data: as } = await supabase.from('aulas_admin').select('*').order('ordem');
      const { data: es } = await supabase.from('ebooks_admin').select('id, titulo, descricao, capa_url, gratuito, ativo, preco, comissao_pct, assinatura, planos_gratis, criado_em').eq('ativo', true).order('criado_em', { ascending: false });

      const cursosComModulos = (cs || []).map(c => {
        const aulasC = (as || []).filter(a => a.curso_id === c.id);
        const modulosMap = {};
        aulasC.forEach(a => {
          const mod = a.modulo || 'Módulo 1';
          if (!modulosMap[mod]) modulosMap[mod] = { titulo: mod, licoes: [] };
          modulosMap[mod].licoes.push({ id: a.id, titulo: a.titulo, descricao: a.descricao, video_url: a.video_url, duracao: a.duracao, gratis: a.gratis });
        });
        return { ...c, bg: c.cor + '20', modulos: Object.values(modulosMap), aulas: aulasC.length };
      });

      setCursos(cursosComModulos);
      setEbooks(es || []);
    }
    fetchData();
    // Preços dos planos AO VIVO do admin (planos_config).
    fetchPlanosComConfig().then(setPlanos).catch(() => {});
  }, []);

  // Carregar progresso do Supabase (merge com local)
  useEffect(() => {
    if (!user) return;
    supabase
      .from('aula_progresso')
      .select('aula_id, concluida')
      .eq('user_id', user.id)
      .then(({ data, error }) => {
        if (!error && data && data.length > 0) {
          const map = {};
          data.forEach(r => { if (r.concluida) map[r.aula_id] = true; });
          setProgresso(prev => ({ ...prev, ...map }));
        }
      })
      .catch(() => {});
  }, [user]);

  const cursosFiltrados = cursos.filter(c => {
    const matchCat = categoria === 'Todos' || c.categoria === categoria;
    const matchBusca = !busca || c.titulo.toLowerCase().includes(busca.toLowerCase()) || (c.descricao || '').toLowerCase().includes(busca.toLowerCase());
    return matchCat && matchBusca;
  });

  const totalAulas = cursos.reduce((s, c) => s + c.aulas, 0);
  const aulasConcluidas = Object.keys(progresso).filter(k => progresso[k]).length;
  const cursosDestaques = cursos.filter(c => c.destaque);

  // Calcular pct por curso para "continuar assistindo"
  const cursosComPct = cursos.map(c => {
    const allLicoes = c.modulos.flatMap(m => m.licoes);
    const total = allLicoes.length;
    const feitas = allLicoes.filter(l => progresso[l.id]).length;
    const pct = total > 0 ? Math.round(feitas / total * 100) : 0;
    return { ...c, pct, feitas, totalLicoes: total };
  });

  const cursosEmProgresso = cursosComPct.filter(c => c.pct > 0 && c.pct < 100);

  useEffect(() => { if (role) setPlano(role); }, [role]);

  const ativarPlano = (p) => {
    localStorage.setItem('tsn_plano_membro', p);
    setPlano(p);
    setShowPlanos(false);
  };

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding:'24px 20px' }}>

      {/* Hero */}
      <div style={{ background:'linear-gradient(135deg, #111111 0%, #1e1b4b 50%, #111111 100%)', borderRadius:20, padding:'40px 48px', marginBottom:28, position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:-60, right:-60, width:240, height:240, borderRadius:'50%', background:'rgba(99,102,241,0.15)' }}/>
        <div style={{ position:'absolute', bottom:-40, right:120, width:160, height:160, borderRadius:'50%', background:'rgba(37,99,235,0.12)' }}/>
        <div style={{ position:'relative', zIndex:1 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:16 }}>
            <div style={{ background:'#6366f1', borderRadius:10, padding:'8px 14px', fontSize:12, fontWeight:800, color:'white', textTransform:'uppercase', letterSpacing:1 }}>
              Área de Membros
            </div>
            <div style={{ background:'rgba(255,255,255,0.1)', borderRadius:10, padding:'8px 14px', fontSize:12, fontWeight:700, color:'#94a3b8' }}>
              Plano atual: <span style={{ color:'white' }}>{PLANOS[plano]?.nome}</span>
            </div>
          </div>
          <h1 style={{ margin:'0 0 12px', fontSize:32, fontWeight:900, color:'white', lineHeight:1.2 }}>
            Sua trilha de conhecimento<br/>em leilões imobiliários
          </h1>
          <p style={{ margin:'0 0 24px', fontSize:15, color:'#94a3b8', maxWidth:500, lineHeight:1.7 }}>
            Do zero ao portfólio profissional. {cursos.length} cursos, {totalAulas} aulas com metodologia exclusiva BidPro Brasil.
          </p>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>
              {[
                [totalAulas, 'Aulas'],
                [cursos.length, 'Cursos'],
                [ebooks.length, 'eBooks'],
                [aulasConcluidas, 'Concluídas'],
                ['∞', 'Acesso'],
              ].map(([v,l])=>(
                <div key={l} style={{ textAlign:'center' }}>
                  <div style={{ fontSize:26, fontWeight:900, color:'white' }}>{v}</div>
                  <div style={{ fontSize:11, color:'#64748b', fontWeight:600, textTransform:'uppercase' }}>{l}</div>
                </div>
              ))}
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:10, alignItems:'center' }}>
              {plano !== 'explorador' && (
                <button onClick={()=>setShowCancelar(true)}
                  style={{ padding:'11px 16px', background:'transparent', color:'#ef4444', border:'1px solid #ef444460', borderRadius:10, fontWeight:600, fontSize:13, cursor:'pointer' }}>
                  Cancelar plano
                </button>
              )}
              <button onClick={()=>setShowPlanos(true)}
                style={{ padding:'11px 22px', background:'#6366f1', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', gap:8 }}>
                <Crown size={15}/> {plano==='explorador'?'Fazer upgrade':'Gerenciar plano'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Continuar assistindo ─────────────────────────────────────────────── */}
      {cursosEmProgresso.length > 0 && (
        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:12, fontWeight:800, color:'#0D63DB', textTransform:'uppercase', letterSpacing:1, marginBottom:14, display:'flex', alignItems:'center', gap:6 }}>
            <Play size={13} fill="#0D63DB"/> Continuar assistindo
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(340px,1fr))', gap:14 }}>
            {cursosEmProgresso.map(c => (
              <div key={c.id} onClick={()=>nav(`/membros/curso/${c.id}`)}
                style={{ background:'white', borderRadius:16, border:'1px solid #dbeafe', padding:'16px 18px', cursor:'pointer', display:'flex', gap:14, alignItems:'center', boxShadow:'0 2px 8px rgba(37,99,235,0.08)', transition:'all 0.2s' }}
                onMouseEnter={e=>{ e.currentTarget.style.boxShadow='0 8px 24px rgba(37,99,235,0.15)'; e.currentTarget.style.transform='translateY(-2px)'; }}
                onMouseLeave={e=>{ e.currentTarget.style.boxShadow='0 2px 8px rgba(37,99,235,0.08)'; e.currentTarget.style.transform='none'; }}>
                {/* Mini capa */}
                <div style={{ width:56, height:56, borderRadius:12, background:`linear-gradient(135deg,${c.cor},${c.cor}cc)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:28, flexShrink:0 }}>
                  {c.emoji}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:800, fontSize:14, color:'#111111', marginBottom:4, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.titulo}</div>
                  {/* Barra de progresso */}
                  <div style={{ height:6, background:'#f1f5f9', borderRadius:6, overflow:'hidden', marginBottom:4 }}>
                    <div style={{ height:6, background:c.cor, width:`${c.pct}%`, borderRadius:6, transition:'width 0.4s' }}/>
                  </div>
                  <div style={{ fontSize:11, color:'#64748b' }}>{c.pct}% concluído · {c.feitas} de {c.totalLicoes} aulas</div>
                </div>
                <ChevronRight size={16} color={c.cor}/>
              </div>
            ))}
          </div>
        </div>
      )}

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
                  <div style={{ fontWeight:900, fontSize:16, color:'#111111', marginBottom:4 }}>{c.titulo}</div>
                  <div style={{ fontSize:12, color:'#64748b', lineHeight:1.5, marginBottom:8 }}>{c.subtitulo}</div>
                  <div style={{ display:'flex', gap:12, fontSize:11, color:'#94a3b8' }}>
                    <span><BookOpen size={11}/> {c.aulas} aulas</span>
                    <span style={{ marginLeft:'auto', fontWeight:800, color:c.preco===0?'#10b981':c.cor }}>
                      {c.preco===0?'Gratuito':`R$ ${Number(c.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
              style={{ padding:'7px 14px', border:'1px solid #e2e8f0', borderRadius:20, fontSize:12, fontWeight:700, cursor:'pointer', background:categoria===cat?'#111111':'white', color:categoria===cat?'white':'#64748b', transition:'all 0.15s' }}>
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grade de cursos */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:16 }}>
        {cursosFiltrados.map(c => {
          const cp = cursosComPct.find(x => x.id === c.id) || c;
          const pct = cp.pct ?? 0;
          const concluidas = cp.feitas ?? 0;
          return (
            <div key={c.id} onClick={()=>nav(`/membros/curso/${c.id}`)}
              style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden', cursor:'pointer', transition:'all 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.05)' }}
              onMouseEnter={e=>{ e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.12)'; e.currentTarget.style.transform='translateY(-3px)'; }}
              onMouseLeave={e=>{ e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.05)'; e.currentTarget.style.transform='none'; }}>

              {/* Capa */}
              {c.capa_url ? (
                <img src={c.capa_url} alt={c.titulo}
                  style={{ width:'100%', aspectRatio:'2/3', objectFit:'cover', display:'block', background:'#f1f5f9' }}
                  onError={e=>{ e.currentTarget.style.display='none'; }}/>
              ) : (
                <div style={{ background:`linear-gradient(135deg, ${c.cor} 0%, ${c.cor}cc 100%)`, aspectRatio:'2/3', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:10 }}>
                  <div style={{ fontSize:52 }}>{c.emoji}</div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.8)', fontWeight:700, textTransform:'uppercase', textAlign:'center', padding:'0 12px' }}>{c.categoria}</div>
                </div>
              )}

              {/* Barra de progresso */}
              {concluidas > 0 && (
                <div style={{ height:3, background:'#f1f5f9' }}>
                  <div style={{ height:3, background:c.cor, width:`${pct}%` }}/>
                </div>
              )}

              <div style={{ padding:'12px 14px' }}>
                <div style={{ fontWeight:800, fontSize:13, color:'#111111', lineHeight:1.4 }}>{c.titulo}</div>
                {concluidas > 0 && pct < 100 && (
                  <div style={{ fontSize:10, color:'#0D63DB', fontWeight:700, marginTop:4 }}>{pct}% concluído</div>
                )}
                {pct === 100 && (
                  <div style={{ fontSize:10, color:'#10b981', fontWeight:700, marginTop:4 }}>✅ Concluído</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Seção de eBooks */}
      {ebooks.length > 0 && (
        <div style={{ marginTop:24 }}>
          <div style={{ fontSize:12, fontWeight:800, color:'#6366f1', textTransform:'uppercase', letterSpacing:1, marginBottom:14, display:'flex', alignItems:'center', gap:6 }}>
            📖 eBooks & Materiais
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:16 }}>
            {ebooks.map(eb => (
              <div key={eb.id} onClick={()=>nav(`/membros/ebook/${eb.id}`)}
                style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', overflow:'hidden', cursor:'pointer', transition:'all 0.2s', boxShadow:'0 1px 3px rgba(0,0,0,0.05)' }}
                onMouseEnter={e=>{ e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.12)'; e.currentTarget.style.transform='translateY(-3px)'; }}
                onMouseLeave={e=>{ e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.05)'; e.currentTarget.style.transform='none'; }}>
                {eb.capa_url ? (
                  <img src={eb.capa_url} alt={eb.titulo}
                    style={{ width:'100%', aspectRatio:'2/3', objectFit:'cover', display:'block', background:'#f1f5f9' }}
                    onError={e=>{ e.currentTarget.style.display='none'; e.currentTarget.insertAdjacentHTML('afterend',''); }}/>
                ) : (
                  <EbookCover titulo={eb.titulo}/>
                )}
                <div style={{ padding:'10px 12px' }}>
                  <div style={{ fontWeight:800, fontSize:12, color:'#111111', lineHeight:1.4 }}>{eb.titulo}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de planos */}
      {showPlanos && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={()=>setShowPlanos(false)}>
          <div style={{ background:'white', borderRadius:20, padding:'32px', maxWidth:860, width:'100%', boxShadow:'0 24px 60px rgba(0,0,0,0.3)', maxHeight:'90vh', overflowY:'auto' }}
            onClick={e=>e.stopPropagation()}>
            <h2 style={{ margin:'0 0 4px', fontSize:22, fontWeight:900 }}>Planos de Acesso</h2>
            <p style={{ margin:'0 0 24px', color:'#64748b', fontSize:14 }}>Escolha o plano ideal para sua jornada em leilões imobiliários</p>

            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:14, marginBottom:20 }}>
              {Object.entries(planos).map(([k,p])=>(
                <div key={k} onClick={()=>ativarPlano(k)}
                  style={{ borderRadius:16, border:`2px solid ${plano===k?p.cor:p.destaque?p.cor+'60':'#e2e8f0'}`, padding:'20px 18px', cursor:'pointer', background:plano===k?p.cor+'10':p.destaque?p.cor+'06':'white', transition:'all 0.15s', position:'relative' }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=p.cor} onMouseLeave={e=>e.currentTarget.style.borderColor=plano===k?p.cor:p.destaque?p.cor+'60':'#e2e8f0'}>
                  {p.destaque && <div style={{ position:'absolute', top:-10, left:'50%', transform:'translateX(-50%)', background:p.cor, color:'white', fontSize:10, fontWeight:800, padding:'3px 12px', borderRadius:20, whiteSpace:'nowrap' }}>⭐ MAIS POPULAR</div>}
                  <div style={{ fontWeight:900, fontSize:16, color:p.cor, marginBottom:6 }}>{p.nome}</div>
                  <div style={{ fontSize:28, fontWeight:900, color:'#111111', lineHeight:1 }}>
                    {p.precoLabel}
                  </div>
                  {p.periodicidade && <div style={{ fontSize:12, color:'#94a3b8', marginBottom:12 }}>{p.periodicidade}</div>}
                  {!p.periodicidade && <div style={{ marginBottom:12 }}/>}
                  <div style={{ fontSize:11, color:'#64748b', lineHeight:1.6, marginBottom:14 }}>{p.descricao}</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                    {p.recursos.map((r,i)=>(
                      <div key={i} style={{ fontSize:11, color: r.startsWith('✅')?'#374151':'#94a3b8' }}>{r}</div>
                    ))}
                  </div>
                  {plano===k
                    ? <div style={{ marginTop:14, fontSize:11, fontWeight:700, color:p.cor, display:'flex', alignItems:'center', gap:4 }}><CheckCircle2 size={12}/> Plano ativo</div>
                    : <button style={{ marginTop:14, width:'100%', padding:'9px', background:p.cor, color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                        {k==='explorador'?'Usar gratuitamente':`Assinar ${p.nome}`}
                      </button>
                  }
                </div>
              ))}
            </div>

            {/* Pacote de cursos */}
            <div style={{ borderRadius:14, border:'2px dashed #f59e0b', padding:'18px 20px', background:'#fffbeb', display:'flex', alignItems:'center', gap:16, flexWrap:'wrap' }}>
              <div style={{ flex:1, minWidth:200 }}>
                <div style={{ fontSize:12, fontWeight:800, color:'#92400e', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>📦 {PACOTE.titulo}</div>
                <div style={{ fontSize:13, color:'#78350f' }}>Todos os 4 cursos pagos em um único pacote, economize <strong>R$ {PACOTE.economia}</strong></div>
              </div>
              <div style={{ textAlign:'right' }}>
                <div style={{ fontSize:12, color:'#94a3b8', textDecoration:'line-through' }}>R$ {PACOTE.precoOriginal}</div>
                <div style={{ fontSize:24, fontWeight:900, color:'#92400e' }}>R$ {PACOTE.preco}</div>
                <button style={{ marginTop:6, padding:'8px 18px', background:'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                  Adquirir pacote
                </button>
              </div>
            </div>

            <p style={{ margin:'14px 0 0', fontSize:11, color:'#94a3b8', textAlign:'center' }}>
              Em produção, pagamentos serão processados via Asaas. Por ora, selecione para simular o acesso.
            </p>
          </div>
        </div>
      )}

      {/* Modal de cancelamento */}
      {showCancelar && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:9999, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={e => e.target === e.currentTarget && setShowCancelar(false)}>
          <div style={{ background:'white', borderRadius:16, padding:28, width:'100%', maxWidth:440, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>
            {cancelMsg ? (
              <div style={{ textAlign:'center', padding:'20px 0' }}>
                <div style={{ fontSize:36 }}>{cancelMsg.includes('Erro') ? '❌' : '✅'}</div>
                <p style={{ fontWeight:700, color:'#111111', marginTop:12 }}>{cancelMsg}</p>
                <button onClick={() => setShowCancelar(false)} style={{ marginTop:16, padding:'10px 24px', background:'#111111', color:'white', border:'none', borderRadius:8, fontWeight:700, cursor:'pointer' }}>Fechar</button>
              </div>
            ) : (
              <>
                <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
                  <AlertTriangle size={24} color="#ef4444" />
                  <h3 style={{ margin:0, fontSize:18, fontWeight:800, color:'#111111' }}>Cancelar plano</h3>
                </div>
                <p style={{ fontSize:14, color:'#475569', marginBottom:8, lineHeight:1.6 }}>
                  Ao cancelar, você perde o acesso aos recursos do plano <strong>{PLANOS[plano]?.nome}</strong> ao final do período atual.
                </p>
                <p style={{ fontSize:13, color:'#64748b', marginBottom:20, lineHeight:1.6 }}>
                  Tem certeza? Se preferir, pode fazer o downgrade para um plano menor.
                </p>
                <div style={{ display:'flex', gap:10 }}>
                  <button onClick={() => setShowCancelar(false)}
                    style={{ flex:1, padding:'11px', border:'1px solid #e2e8f0', borderRadius:8, background:'white', color:'#475569', fontWeight:600, fontSize:13, cursor:'pointer' }}>
                    Manter plano
                  </button>
                  <button disabled={cancelando} onClick={async () => {
                    if (!user?.email) return;
                    setCancelando(true);
                    try {
                      // Cancela a renovação automática nos dois gateways (MP é o
                      // principal; Asaas é o fallback) — idempotente por e-mail.
                      const [rMp, rAs] = await Promise.allSettled([
                        apiCall('/api/mp', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'cancelar_assinatura', email: user.email }) }),
                        apiCall('/api/asaas', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ action:'cancelar_assinatura', email: user.email }) }),
                      ]);
                      const okMp = rMp.status === 'fulfilled' && rMp.value.ok;
                      const okAs = rAs.status === 'fulfilled' && rAs.value.ok;
                      if (!okMp && !okAs) throw new Error('Não foi possível cancelar a renovação. Fale com o suporte.');
                      setCancelMsg('Renovação automática cancelada. Você mantém o acesso até o fim do período já pago, sem novas cobranças.');
                    } catch(e) {
                      setCancelMsg('Erro: ' + e.message);
                    }
                    setCancelando(false);
                  }}
                    style={{ flex:1, padding:'11px', border:'none', borderRadius:8, background:'#ef4444', color:'white', fontWeight:700, fontSize:13, cursor:'pointer', opacity: cancelando ? 0.6 : 1 }}>
                    {cancelando ? 'Cancelando…' : 'Sim, cancelar'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
