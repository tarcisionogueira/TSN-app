import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Play, Lock, CheckCircle2, BookOpen, ChevronLeft,
  ChevronDown, ChevronUp, Award, Crown, ArrowRight, ArrowLeft, ChevronRight, Share2,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { setItemSeguro } from '../utils/storageSeguro.js';
import { useAuth } from '../contexts/AuthContext';
import CapaCurso from '../components/CapaCurso';
import { videoEmbed } from '../utils/videoEmbed';
import DicaAudioIOS from '../components/DicaAudioIOS';
import PlayerVideo from '../components/PlayerVideo';
import { CURSOS, PLANOS } from '../data/cursos';

// ── localStorage fallback ─────────────────────────────────────────────────────
function getProgressoLocal() {
  try { return JSON.parse(localStorage.getItem('tsn_progresso') || '{}'); } catch { return {}; }
}
function salvarProgressoLocal(id, feito) {
  const p = getProgressoLocal();
  p[id] = feito;
  setItemSeguro('tsn_progresso', JSON.stringify(p));
}
function getPlano() { return localStorage.getItem('tsn_plano_membro') || 'explorador'; }

const PLANOS_PAGOS = ['top2','assessorado','clube','analista','consultor','advogado','admin'];
const MAT_ICON = { excel: '📊', word: '📝', ppt: '📽️', pdf: '📄', link: '🔗' };

function podeAssistir(licao, plano, comprouAvulso = false, planosGratis = [], cursoGratuito = false) {
  // CURSO GRATUITO É GRATUITO (11/08). `curso.gratuito` marca o curso como livre e a Área de
  // Membros já estampa "Grátis" no card — mas esta função nunca consultava a flag. Resultado:
  // o curso de BOAS-VINDAS aparecia com o selo Grátis e abria CADEADO para quem está no plano
  // explorador, ou seja, exatamente o recém-chegado a quem o vídeo se destina. O rótulo
  // prometia uma coisa e o portão fazia outra.
  if (cursoGratuito) return true;
  if (licao.gratis) return true;                 // amostra grátis (preview)
  if (comprouAvulso) return true;                // comprou o curso avulso
  if (PLANOS_PAGOS.includes(plano)) return true; // plano pago / equipe
  // "Grátis por classe de assinante" definido no cadastro do curso (planos_gratis)
  if (Array.isArray(planosGratis) && (planosGratis.includes(plano) || (plano === 'top2' && planosGratis.includes('top2_anual')))) return true;
  return false;
}

/**
 * "Abre em 3 dias" / "abre em 20/09" — a escolha entre as duas formas não é estética: perto,
 * o aluno pensa em dias; longe, em data. E abaixo de 1 dia a contagem em dias imprimiria
 * "abre em 0 dias", que soa como defeito. Sem data conhecida, some a frase em vez de mentir.
 */
function abreQuando(iso) {
  if (!iso) return 'em breve';
  const alvo = new Date(iso).getTime();
  if (Number.isNaN(alvo)) return 'em breve';
  const horas = (alvo - Date.now()) / 3600000;
  if (horas <= 0) return 'em instantes';
  if (horas < 24) return `em ${Math.max(1, Math.round(horas))}h`;
  const dias = Math.ceil(horas / 24);
  if (dias <= 14) return `em ${dias} dia${dias > 1 ? 's' : ''}`;
  return `em ${new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

export default function Curso() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, role, effectiveUserId } = useAuth();
  // Curso ESTÁTICO (slug legado, ex. 'onboarding') OU do BANCO (cursos_admin, uuid).
  // O estático vence quando o id bate; senão, carrega do banco (destrava os cursos
  // criados no admin + honra o planos_gratis do cadastro).
  const cursoStatic = CURSOS.find(c => c.id === id);
  const [cursoDb, setCursoDb] = useState(null);
  const [carregandoCurso, setCarregandoCurso] = useState(false);
  const curso = cursoStatic || cursoDb;
  // Role from auth takes precedence over localStorage fallback
  const plano = role || getPlano();

  useEffect(() => {
    if (cursoStatic || !id) return;
    setCarregandoCurso(true); setCursoDb(null);
    (async () => {
      const { data: c } = await supabase.from('cursos_admin').select('*').eq('id', id).eq('ativo', true).single();
      if (!c) { setCarregandoCurso(false); return; }
      const { data: as } = await supabase.from('aulas_admin').select('*').eq('curso_id', id).order('ordem');
      const modMap = {};
      (as || []).forEach(a => {
        const m = a.modulo || 'Módulo 1';
        (modMap[m] = modMap[m] || []).push({ id: a.id, titulo: a.titulo || '', duracao: a.duracao || '', gratis: !!a.gratis, descricao: a.descricao || '', video_url: a.video_url || '', materiais: Array.isArray(a.materiais) ? a.materiais : [] });
      });
      // LIBERAÇÃO POR MÓDULO. Quem decide é o SERVIDOR: a RPC carimba o início do aluno na
      // primeira chamada e devolve, por módulo, se já abriu e quando abre. Calcular isso aqui
      // exigiria a data de início no cliente — e ela não existe até alguém carimbá-la.
      //
      // Erro NÃO tranca o curso. Um aluno pagante barrado por falha de leitura é pior do que
      // um módulo aberto cedo demais; então o padrão é liberado, e a falha vai para o console.
      // (`liberacao` fica null e o mapa abaixo devolve `undefined`, que a tela lê como aberto.)
      let liberacao = null;
      try {
        const { data: libs, error: errLib } = await supabase.rpc('curso_modulos_liberacao', { p_curso: id });
        if (errLib) throw errLib;
        liberacao = Object.fromEntries((libs || []).map(l => [l.modulo, l]));
      } catch (e) { console.error('[curso] nao li a liberacao dos modulos:', e?.message || e); }

      setCursoDb({
        id: c.id, titulo: c.titulo, subtitulo: c.subtitulo || '', descricao: c.descricao || '',
        capa_url: c.capa_url || '', cor: c.cor || '#0D63DB',
        aulas: (as || []).length, preco: Number(c.preco || 0), gratuito: !!c.gratuito,
        planos_gratis: Array.isArray(c.planos_gratis) ? c.planos_gratis : [],
        modulos: Object.entries(modMap).map(([titulo, licoes]) => ({
          titulo, licoes,
          bloqueado: liberacao ? liberacao[titulo]?.liberado === false : false,
          abreEm: liberacao?.[titulo]?.abre_em || null,
        })),
      });
      setCarregandoCurso(false);
    })();
  }, [id, cursoStatic]);

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
    // Posse é de quem se está VENDO (modo suporte mostra a compra do cliente, não a do admin).
    supabase.from('compras_produtos')
      .select('id').eq('user_id', effectiveUserId || user.id).eq('produto_tipo', 'curso').eq('produto_id', id).eq('status', 'ativo')
      .then(({ data }) => { if (data?.length > 0) setComprouAvulso(true); });
  }, [user, effectiveUserId, id, plano]);

  // Video progress simulation ref (tracks "watched" percentage)

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
      .eq('user_id', effectiveUserId || user.id)   // suporte vê o progresso do CLIENTE
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
  }, [user, effectiveUserId, id]);

  // ── Salvar progresso no Supabase + localStorage ─────────────────────────────
  const salvarProgresso = useCallback(async (aulaid, feito) => {
    salvarProgressoLocal(aulaid, feito);
    setProgresso(p => ({ ...p, [aulaid]: feito }));
    if (!user) return;
    try {
      await supabase
        .from('aula_progresso')
        .upsert(
          { user_id: user.id, aula_id: aulaid, curso_id: id, concluida: feito }, // padrao-ok: progresso é de QUEM assiste; sob suporte grava o do admin (RLS) e não contamina o do cliente
          { onConflict: 'user_id,aula_id' }
        );
    } catch (_) { /* table may not exist yet, local fallback is fine */ }
  }, [user, id]);

  // ── Abrir na primeira aula disponível ──────────────────────────────────────
  useEffect(() => {
    if (curso) {
      const emProgresso = todasLicoes.find(l => !progresso[l.id] && podeAssistir(l, plano, comprouAvulso, curso?.planos_gratis, curso?.gratuito));
      const primeiraGratis = todasLicoes.find(l => l.gratis);
      setLicaoAtiva(emProgresso || primeiraGratis || todasLicoes[0]);
    }
  // Também dispara quando o curso do BANCO termina de carregar (curso: null → objeto).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, !!curso]);

  // ── A SIMULAÇÃO DE PROGRESSO DE VÍDEO FOI REMOVIDA (11/08) ─────────────────
  // Havia aqui um `setInterval` que subia 1% a cada 300ms e marcava a aula como CONCLUÍDA ao
  // chegar a 80%. Era código morto — `setVideoPlaying(true)` nunca foi chamado em lugar
  // nenhum, porque o iframe do YouTube não avisa que começou a tocar. Mas era código morto
  // PERIGOSO: bastava alguém ligar o gatilho para a plataforma passar a dar aula por
  // concluída com base em TEMPO DECORRIDO — marcando como assistido o vídeo de quem deixou a
  // aba aberta e foi almoçar. Progresso de vídeo que não pode ser medido não deve ser
  // inventado: quem declara que assistiu é a pessoa, no botão.

  if (!curso && carregandoCurso) {
    return (
      <div style={{ maxWidth:800, margin:'120px auto', textAlign:'center', padding:20, color:'#94a3b8' }}>
        Carregando curso…
      </div>
    );
  }

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

  const podeVer = licaoAtiva ? podeAssistir(licaoAtiva, plano, comprouAvulso, curso?.planos_gratis, curso?.gratuito) : false;

  // `feito=false` DESMARCA. Marcar por engano acontece; sem volta, a pessoa fica com o curso
  // dado por completo sem ter assistido — e o pop-up de boas-vindas, que lê este mesmo
  // progresso, sumiria para sempre. Só avança para a próxima aula quando MARCA.
  const marcarConcluida = (lid, feito = true) => {
    salvarProgresso(lid, feito);
    if (!feito) return;
    const idx = todasLicoes.findIndex(l => l.id === lid);
    if (idx < todasLicoes.length - 1) {
      setTimeout(() => setLicaoAtiva(todasLicoes[idx + 1]), 500);
    }
  };

  const irParaLicao = (lic) => {
    if (!podeAssistir(lic, plano, comprouAvulso, curso?.planos_gratis, curso?.gratuito)) { setShowUpgrade(true); return; }
    setLicaoAtiva(lic);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const licaoIdx = todasLicoes.findIndex(l => l.id === licaoAtiva?.id);
  const licaoAnterior = licaoIdx > 0 ? todasLicoes[licaoIdx - 1] : null;
  const proximaLicao = licaoIdx < todasLicoes.length - 1 ? todasLicoes[licaoIdx + 1] : null;

  return (
    <div className="curso-grid" style={{ maxWidth:1280, margin:'0 auto', padding:'20px', display:'grid', gridTemplateColumns:'360px 1fr', gap:20, alignItems:'start' }}>
      {/* NO CELULAR O PLAYER SUMIA (relato do dono, 11/08). A grade era `360px 1fr` FIXO, sem
          media query: numa tela de ~390px a barra lateral sozinha consumia 360, e a coluna do
          vídeo era empurrada para fora da viewport. O vídeo estava lá — só que fora da tela.
          Agora a grade colapsa e o PLAYER VEM PRIMEIRO: quem abre uma aula quer assistir, não
          rolar a lista de módulos até o fim para achar o vídeo. A barra lateral também deixa
          de ser `sticky` no celular, onde grudar no topo só rouba altura útil. */}
      <style>{`
        @media (max-width: 900px){
          .curso-grid{ grid-template-columns: 1fr !important; }
          .curso-grid > .curso-conteudo{ order: 1; }
          .curso-grid > .curso-lateral{ order: 2; position: static !important; }
        }
      `}</style>

      {/* SIDEBAR */}
      <div className="curso-lateral" style={{ display:'flex', flexDirection:'column', gap:12, position:'sticky', top:82 }}>

        {/* CABEÇALHO DO CURSO — refeito em 11/08 a pedido do dono ("esse quadro azul não está
            agregando"). Ele tinha razão, e por três motivos concretos:
              • o monograma "CA" era ruído — e estava QUEBRADO: `capa_url` nunca entrava no
                objeto do curso, então a arte que ele subiu nunca aparecia ali (bug meu);
              • havia um ícone de relógio sozinho, sem número, porque curso do banco não tem
                campo de duração — a tela exibia um dado que não existe;
              • e o progresso aparecia TRÊS vezes na mesma página: no bloco azul, num card
                próprio logo abaixo e na barra sob o player.
            Agora é um cabeçalho branco como o resto da página, com o card de progresso
            fundido dentro dele — um card a menos — e só informação que existe de verdade. */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'14px 16px' }}>
          <button onClick={()=>nav('/membros')}
            style={{ display:'flex', alignItems:'center', gap:5, background:'transparent', border:'none', padding:0, color:'#64748b', fontSize:12.5, fontWeight:700, cursor:'pointer', marginBottom:10 }}>
            <ChevronLeft size={14}/> Todos os cursos
          </button>

          <h2 style={{ margin:'0 0 4px', fontSize:16, fontWeight:900, color:'#0f172a', lineHeight:1.3 }}>{curso.titulo}</h2>
          {curso.subtitulo && (
            <p style={{ margin:'0 0 12px', fontSize:12.5, color:'#64748b', lineHeight:1.5 }}>{curso.subtitulo}</p>
          )}

          <div style={{ display:'flex', alignItems:'center', gap:7, flexWrap:'wrap', fontSize:12, color:'#64748b', marginBottom:9 }}>
            <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}>
              <BookOpen size={12}/> {todasLicoes.length} {todasLicoes.length === 1 ? 'aula' : 'aulas'}
            </span>
            <span>·</span>
            <span>{concluidas} {concluidas === 1 ? 'concluída' : 'concluídas'}</span>
            {(curso.gratuito || !Number(curso.preco || 0)) && (
              <><span>·</span><span style={{ color:'#059669', fontWeight:700 }}>Grátis</span></>
            )}
          </div>

          <div style={{ height:6, background:'#f1f5f9', borderRadius:6, overflow:'hidden' }}>
            <div style={{ height:6, background:curso.cor, width:`${pct}%`, borderRadius:6, transition:'width 0.4s' }}/>
          </div>

          {pct === 100 && (
            <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:6, background:'#fef3c7', borderRadius:8, padding:'8px 12px' }}>
              <Award size={14} color="#f59e0b"/>
              <span style={{ fontSize:11, fontWeight:700, color:'#92400e' }}>Curso concluído! 🎉</span>
            </div>
          )}

          {/* Parceiro: link de venda do curso (só cursos do banco, pagos) */}
          {cursoDb && Number(curso.preco || 0) > 0 && user && (
            <div style={{ marginTop:12 }}><CompartilharCurso cursoId={curso.id}/></div>
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
                {mod.bloqueado
                  ? <span style={{ fontSize:11, fontWeight:800, color:'#b45309', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:20, padding:'3px 9px', whiteSpace:'nowrap' }}>
                      {abreQuando(mod.abreEm)}
                    </span>
                  : (modulosAbertos[mi] ? <ChevronUp size={14} color="#94a3b8"/> : <ChevronDown size={14} color="#94a3b8"/>)}
              </button>
              {/* MÓDULO AINDA FECHADO: diz QUANDO abre, e não só que está fechado. Cadeado sem
                  data é o que faz o aluno escrever para o suporte perguntando se quebrou. */}
              {modulosAbertos[mi] && mod.bloqueado && (
                <div style={{ padding:'14px 16px', background:'#fffbeb', borderBottom:'1px solid #f1f5f9', fontSize:12.5, color:'#92400e', lineHeight:1.6 }}>
                  Este módulo abre <strong>{abreQuando(mod.abreEm)}</strong>. As aulas vão aparecer aqui
                  automaticamente — não precisa fazer nada.
                </div>
              )}
              {modulosAbertos[mi] && !mod.bloqueado && mod.licoes.map((lic) => {
                const ativa = licaoAtiva?.id === lic.id;
                const feita = progresso[lic.id];
                const pode = podeAssistir(lic, plano, comprouAvulso, curso?.planos_gratis, curso?.gratuito);
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
                        {/* Sem o ✅ aqui: o ícone circulado à ESQUERDA já sinaliza a aula feita,
                            e o dono já pediu emoji fora do produto ("não fica profissional").
                            Dois sinais para o mesmo fato é ruído, não reforço. */}
                        {lic.titulo}
                      </div>
                      {/* Só renderiza o que existe: `duracao` não é campo de curso do banco,
                         e um <span> vazio dentro de um flex com gap deixa um buraco. */}
                      {(lic.duracao || lic.gratis) && (
                        <div style={{ fontSize:10, color:'#94a3b8', marginTop:2, display:'flex', gap:6 }}>
                          {lic.duracao && <span>{lic.duracao}</span>}
                          {lic.gratis && <span style={{ color:'#10b981', fontWeight:600 }}>Grátis</span>}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* ÁREA DE CONTEÚDO */}
      <div className="curso-conteudo" style={{ display:'flex', flexDirection:'column', gap:16, minWidth:0 }}>

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

                {/* Player de vídeo — real quando a aula tem video_url; senão, capa "em breve".
                    Ao TERMINAR, marca a aula como assistida sozinha (o player avisa o fim por
                    postMessage — ver PlayerVideo.jsx). O botão manual continua ali para quem o
                    provedor não reporta ou para quem assistiu por fora. */}
                {videoEmbed(licaoAtiva.video_url) ? (
                  <PlayerVideo
                    url={licaoAtiva.video_url}
                    titulo={licaoAtiva.titulo}
                    onFim={() => { if (!progresso[licaoAtiva.id]) marcarConcluida(licaoAtiva.id); }}
                  />
                ) : (
                  // Sem vídeo cadastrado: capa neutra (nada de "player" falso).
                  <div style={{ background:'#111111', aspectRatio:'16/9', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:14, position:'relative' }}>
                    <div style={{ position:'absolute', inset:0, background:`radial-gradient(circle at 30% 40%, ${curso.cor}30 0%, transparent 60%)` }}/>
                    <div style={{ position:'relative' }}><CapaCurso curso={curso} tamanho={84} raio={18}/></div>
                    <div style={{ position:'relative', textAlign:'center' }}>
                      <div style={{ fontSize:16, fontWeight:700, color:'white', marginBottom:6 }}>{licaoAtiva.titulo}</div>
                      <div style={{ fontSize:12, color:'#94a3b8' }}>Vídeo em breve</div>
                    </div>
                  </div>
                )}

                {/* Controles + título */}
                <div style={{ padding:'22px 24px' }}>
                  <DicaAudioIOS style={{ marginBottom:14 }} />

                  {/* PROGRESSO JUNTO DO VÍDEO (pedido do dono, 11/08). A barra existia só na
                      barra lateral — que no celular agora fica DEPOIS do player, ou seja, fora
                      de vista justamente na hora em que ela importa: logo após assistir. Aqui
                      ela responde "quanto falta" sem rolar a página. */}
                  <div style={{ marginBottom:16 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                      <span style={{ fontSize:11.5, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:0.4 }}>Seu progresso no curso</span>
                      <span style={{ fontSize:13, fontWeight:900, color:curso.cor }}>{pct}%</span>
                    </div>
                    <div style={{ height:7, background:'#f1f5f9', borderRadius:6, overflow:'hidden' }}>
                      <div style={{ height:7, background:curso.cor, width:`${pct}%`, borderRadius:6, transition:'width 0.4s' }}/>
                    </div>
                    <div style={{ fontSize:11.5, color:'#94a3b8', marginTop:5 }}>
                      {concluidas} de {todasLicoes.length} {todasLicoes.length === 1 ? 'aula concluída' : 'aulas concluídas'}
                      {concluidas === todasLicoes.length && todasLicoes.length > 0 ? ' · curso completo 🎉' : ''}
                    </div>
                  </div>

                  {/* ORDEM DE LEITURA DO YOUTUBE (pedido do dono, 11/08): título primeiro,
                      metadados em uma linha discreta logo abaixo, DEPOIS a barra de ações, e a
                      descrição num card cinza no fim. Antes o título vinha atrás de um rótulo
                      de módulo em caixa alta e disputava a linha com quatro botões — quem abre
                      uma aula quer ler o nome dela antes de qualquer outra coisa. */}
                  <h2 style={{ margin:'0 0 6px', fontSize:20, fontWeight:900, color:'#111111', lineHeight:1.3 }}>{licaoAtiva.titulo}</h2>
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:12.5, color:'#64748b', marginBottom:14 }}>
                    <span style={{ fontWeight:600 }}>{curso.modulos.find(m=>m.licoes.some(l=>l.id===licaoAtiva.id))?.titulo}</span>
                    {(() => {
                      const i = todasLicoes.findIndex(l => l.id === licaoAtiva.id);
                      return i >= 0 ? <><span>·</span><span>Aula {i + 1} de {todasLicoes.length}</span></> : null;
                    })()}
                    {licaoAtiva.duracao && <><span>·</span><span>{licaoAtiva.duracao}</span></>}
                    {progresso[licaoAtiva.id] && (
                      <><span>·</span><span style={{ color:'#059669', fontWeight:700, display:'inline-flex', alignItems:'center', gap:4 }}><CheckCircle2 size={12}/> concluída</span></>
                    )}
                  </div>

                  <div style={{ display:'flex', justifyContent:'flex-start', alignItems:'center', marginBottom:16, flexWrap:'wrap', gap:8, paddingBottom:16, borderBottom:'1px solid #f1f5f9' }}>
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
                          <CheckCircle2 size={13}/> Marcar como assistida
                        </button>
                      ) : (
                        // Clicável para DESMARCAR: marcar por engano acontece, e sem volta a
                        // pessoa fica com o curso "completo" sem ter assistido — e o pop-up de
                        // boas-vindas, que lê este mesmo progresso, some para sempre.
                        <button onClick={()=>marcarConcluida(licaoAtiva.id, false)}
                          title="Clique para desmarcar"
                          style={{ display:'flex', alignItems:'center', gap:6, padding:'7px 12px', background:'#d1fae5', border:'1px solid #a7f3d0', borderRadius:8, fontSize:12, fontWeight:700, color:'#065f46', cursor:'pointer' }}>
                          <CheckCircle2 size={13}/> Aula assistida
                        </button>
                      )}
                      {proximaLicao && (
                        <button onClick={()=>irParaLicao(proximaLicao)}
                          style={{ padding:'7px 12px', background:'#111111', color:'white', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                          Próxima <ArrowRight size={13}/>
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card de descrição no formato do YouTube: cinza, cantos arredondados, sem
                      barra colorida — a informação é o texto, não a moldura. Aula sem descrição
                      não renderiza um card vazio (isso lia como "faltou carregar"). */}
                  {String(licaoAtiva.descricao || '').trim() && (
                    <div style={{ background:'#f2f2f2', borderRadius:12, padding:'14px 16px' }}>
                      <div style={{ fontSize:12.5, fontWeight:700, color:'#0f172a', marginBottom:8 }}>Sobre esta aula</div>
                      <p style={{ margin:0, fontSize:14, color:'#334155', lineHeight:1.75, whiteSpace:'pre-line' }}>{licaoAtiva.descricao}</p>
                    </div>
                  )}

                  {/* Material de apoio — só se a aula tiver algo anexado (senão, nada) */}
                  {Array.isArray(licaoAtiva.materiais) && licaoAtiva.materiais.length > 0 && (
                    <div style={{ marginTop:16 }}>
                      <div style={{ fontSize:12, fontWeight:700, color:'#475569', textTransform:'uppercase', marginBottom:10 }}>Material de apoio</div>
                      <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                        {licaoAtiva.materiais.map((mt, i) => (
                          <a key={i} href={mt.url} target="_blank" rel="noreferrer" download
                            style={{ padding:'8px 14px', background:'#f1f5f9', borderRadius:8, fontSize:12, color:'#334155', fontWeight:600, border:'1px solid #e2e8f0', textDecoration:'none', display:'inline-flex', alignItems:'center', gap:6 }}>
                            {MAT_ICON[mt.tipo] || '🔗'} {mt.nome || 'Material'}
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
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

            {/* ─── "A SEGUIR" ────────────────────────────────────────────────────────────
                Tinha DOIS defeitos, os dois visíveis no print do dono (11/08):
                  • Renderizava a moldura VAZIA na última aula, porque `slice` a partir do fim
                    devolve lista vazia — um card com título e nada dentro, que não comunica
                    coisa alguma. Card sem conteúdo é ruído; ou tem o que dizer, ou não existe.
                  • Dizia "neste módulo" enquanto fatiava `todasLicoes`, que é a lista do CURSO
                    INTEIRO. Com dois módulos de uma aula, o card prometia uma coisa e
                    mostrava outra.
                Agora: quando há próxima, o título é "A seguir no curso" e ela aparece; quando
                a pessoa chegou ao fim, o card vira o FECHAMENTO — que é a mensagem que faltava
                ali: "acabou, e aqui está o que você fez". */}
            {todasLicoes.slice(licaoIdx + 1).length === 0 ? (
              <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'18px 20px', textAlign:'center' }}>
                <div style={{ fontSize:14, fontWeight:800, color:'#0f172a', marginBottom:4 }}>
                  {pct === 100 ? 'Você concluiu o curso 🎉' : 'Esta é a última aula'}
                </div>
                <div style={{ fontSize:12.5, color:'#64748b', lineHeight:1.55, marginBottom:14 }}>
                  {pct === 100
                    ? 'Assistiu a tudo. O conteúdo continua disponível para rever quando quiser.'
                    : `Faltam ${todasLicoes.length - concluidas} ${todasLicoes.length - concluidas === 1 ? 'aula' : 'aulas'} para concluir o curso — role a lista e retome de onde parou.`}
                </div>
                <button onClick={()=>nav('/membros')}
                  style={{ background:curso.cor, color:'white', border:'none', borderRadius:10, padding:'10px 18px', fontSize:13, fontWeight:800, cursor:'pointer' }}>
                  Ver outros cursos
                </button>
              </div>
            ) : (
            <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'16px 20px' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:0.5, marginBottom:12 }}>A seguir no curso</div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {todasLicoes.slice(licaoIdx+1, licaoIdx+4).map((lic) => (
                  <button key={lic.id} onClick={()=>irParaLicao(lic)}
                    style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 12px', border:'none', borderRadius:10, background:'#f8fafc', cursor:'pointer', textAlign:'left' }}
                    onMouseEnter={e=>e.currentTarget.style.background='#f1f5f9'} onMouseLeave={e=>e.currentTarget.style.background='#f8fafc'}>
                    <div style={{ width:36, height:36, borderRadius:8, background:podeAssistir(lic, plano, comprouAvulso, curso?.planos_gratis, curso?.gratuito)?curso.cor+'20':'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      {progresso[lic.id] ? <CheckCircle2 size={16} color="#10b981"/>
                        : !podeAssistir(lic, plano, comprouAvulso, curso?.planos_gratis, curso?.gratuito) ? <Lock size={14} color="#94a3b8"/>
                        : <Play size={14} color={curso.cor}/>}
                    </div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600, color:'#111111' }}>{lic.titulo}</div>
                      {/* Sem duração, o separador ficava solto na frente (" · Grátis"). */}
                      {(lic.duracao || lic.gratis) && (
                        <div style={{ fontSize:11, color:'#94a3b8', marginTop:2 }}>
                          {[lic.duracao, lic.gratis ? 'Grátis' : ''].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                    <ChevronRight size={14} color="#94a3b8"/>
                  </button>
                ))}
              </div>
            </div>
            )}
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
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:16 }}>
              {/* Comprar SÓ o curso (avulso) — só cursos do banco com preço */}
              {cursoDb && Number(curso.preco || 0) > 0 && (
                <button onClick={()=>{ setShowUpgrade(false); nav(`/p/curso/${id}`); }}
                  style={{ padding:'14px 18px', border:'none', borderRadius:12, background:'#7c3aed', color:'white', cursor:'pointer', textAlign:'center', fontWeight:800, fontSize:15 }}>
                  Comprar este curso — R$ {Number(curso.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} →
                </button>
              )}
              {/* Assinar um plano que inclui o acervo */}
              <button onClick={()=>{ setShowUpgrade(false); nav('/planos'); }}
                style={{ padding:'13px 18px', border:'2px solid #e2e8f0', borderRadius:12, background:'white', color:'#111111', cursor:'pointer', textAlign:'center', fontWeight:700, fontSize:14 }}>
                Ver planos que incluem este curso →
              </button>
            </div>
            <p style={{ margin:0, fontSize:11, color:'#94a3b8', textAlign:'center' }}>
              Comprando o curso, o acesso é liberado assim que o pagamento é confirmado.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// Parceiro: gera/reaproveita o código de indicação e copia o link de venda do curso
// (/#/p/curso/:id?ref=CÓDIGO). Quem comprar por esse link gera comissão para o parceiro.
function CompartilharCurso({ cursoId }) {
  const { user, effectiveUserId } = useAuth();
  const [copiado, setCopiado] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  async function gerarECopiar() {
    setBusy(true);
    try {
      // Suporte: link de afiliado do usuário VISTO; não gera código como admin.
      const alvoId = effectiveUserId || user.id;
      const suporte = alvoId !== user.id;
      let { data: perfil } = await supabase.from('perfis').select('codigo_indicacao').eq('id', alvoId).single();
      let codigo = perfil?.codigo_indicacao;
      if (!codigo && !suporte) {
        await supabase.rpc('gerar_codigo_indicacao', { p_id: user.id });
        const { data: p2 } = await supabase.from('perfis').select('codigo_indicacao').eq('id', user.id).single();
        codigo = p2?.codigo_indicacao;
      }
      const link = `${window.location.origin}/#/p/curso/${cursoId}${codigo ? `?ref=${codigo}` : ''}`;
      let ok = false;
      try { await navigator.clipboard.writeText(link); ok = true; } catch { /* clipboard bloqueado */ }
      if (ok) { setCopiado(true); setTimeout(() => setCopiado(false), 2500); }
      else window.prompt('Copie o link de venda:', link);
    } catch { /* silencioso */ }
    finally { setBusy(false); }
  }
  return (
    <button onClick={gerarECopiar} disabled={busy}
      style={{ marginTop:14, width:'100%', padding:'9px 12px', background:'rgba(255,255,255,0.14)', color:'white', border:'1px solid rgba(255,255,255,0.25)', borderRadius:8, fontWeight:700, fontSize:12, cursor: busy?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
      <Share2 size={13}/> {copiado ? '✓ Link copiado!' : busy ? 'Gerando…' : 'Compartilhar para vender'}
    </button>
  );
}
