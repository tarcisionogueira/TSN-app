import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Loader2, Filter, ChevronDown, ChevronUp,
  ExternalLink, RefreshCw, MapPin,
  ArrowRight, X,
} from 'lucide-react';
import { saveBuscaRecente, loadImoveis, saveImoveis, generateId } from '../utils/storage';
import { CIDADES_POR_ESTADO, RAIOS_KM } from '../data/cidades';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../utils/useIsMobile';

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];


const inp = { width:'100%', padding:'9px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, background:'white', color:'#0f172a', boxSizing:'border-box' };
const lbl = { fontSize:10, fontWeight:700, color:'#475569', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 };

const ROLES_SITE   = ['explorador','top1','top2','assessorado','clube','consultor','analista','advogado','admin'];
const ROLES_ANALISE = ['top1','top2','assessorado','clube','analista','advogado','admin'];

function fmtData(d, modalidade) {
  if (!d) return modalidade === 'venda_direta' ? 'Venda Direta' : '—';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

export default function Busca() {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { role, user } = useAuth();
  const plano = role || 'explorador';
  const canSite    = user && ROLES_SITE.includes(role);
  const canAnalise = user && ROLES_ANALISE.includes(role);
  const [filtros, setFiltros] = useState({ tipo:'', estado:'', cidades:[], raioKm:0, valorMin:'', valorMax:'', modalidade:'', pagamento:[] });
  const [buscaCidade, setBuscaCidade] = useState('');
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [buscaFeita, setBuscaFeita] = useState(false);
  const [showFiltros, setShowFiltros] = useState(true);
  const [selecionados, setSelecionados] = useState([]);

  const up = (name, val) => setFiltros(p => ({ ...p, [name]: val }));
  const togglePagamento = (v) => up('pagamento', filtros.pagamento.includes(v) ? filtros.pagamento.filter(x=>x!==v) : [...filtros.pagamento, v]);
  const toggleSelecionado = (id) => setSelecionados(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]);
  const isSelecionado = (id) => selecionados.includes(id);

  const buscar = async () => {
    setErro(''); setLoading(true); setBuscaFeita(true); setResultados([]);
    const filtrosApi = { ...filtros, cidade: filtros.cidades.join(', ') };
    saveBuscaRecente(filtrosApi);
    try {
      // 1. Tenta buscar do banco Supabase (scraper diário)
      let query = supabase
        .from('imoveis_leilao')
        .select('*')
        .eq('ativo', true)
        .order('score_viabilidade', { ascending: false })
        .limit(100);

      if (filtros.estado) query = query.eq('estado', filtros.estado);
      if (filtros.cidades.length > 0) query = query.in('cidade', filtros.cidades);
      if (filtros.tipo) query = query.eq('tipo', filtros.tipo);
      if (filtros.modalidade) query = query.eq('modalidade', filtros.modalidade);
      if (filtros.valorMin) query = query.gte('valor_minimo', Number(filtros.valorMin));
      if (filtros.valorMax) query = query.lte('valor_minimo', Number(filtros.valorMax));
      if (filtros.pagamento?.length > 0) query = query.in('forma_pagamento', filtros.pagamento);

      const { data: dbData, error: dbError } = await query;

      const mapeados = (!dbError && dbData) ? dbData.map(im => ({
        id: im.id,
        titulo: im.titulo,
        tipo: im.tipo,
        modalidade: im.modalidade,
        estado: im.estado,
        cidade: im.cidade,
        bairro: im.bairro,
        endereco: im.endereco,
        valorAvaliacao: im.valor_avaliacao,
        valorMinimo: im.valor_minimo,
        descontoPercentual: im.desconto_percentual,
        areaM2: im.area_m2,
        descricao: im.descricao,
        urlLote: im.url_lote || im.link_edital,
        linkEdital: im.link_edital,
        foto: im.link_foto,
        leiloeiro: im.leiloeiro,
        dataLeilao: im.data_leilao,
        pagamento: [im.forma_pagamento],
        viavel: im.viavel,
        scoreViabilidade: im.score_viabilidade,
        fracionado: im.fracionado,
        fonte: im.fonte,
      })) : [];
      setResultados(mapeados);
    } catch (e) {
      setErro('Erro na busca. Tente novamente.');
      console.error(e);
    }
    setLoading(false);
  };

  const irParaAnalise = (im) => {
    nav('/analise', { state: { imovel: im } });
  };

  const marcarArrematado = (im) => {
    const imoveis = loadImoveis();
    const existente = imoveis.find(i => i.id === im.id);
    if (!existente) {
      const novo = {
        id: im.id || generateId(),
        nome: im.titulo || im.nome || '',
        tipo: im.tipo || 'apartamento',
        endereco: im.endereco || '',
        cidade: im.cidade || '',
        estado: im.estado || '',
        valorArrematacao: im.valorMinimo || 0,
        valorAvaliacao: im.valorAvaliacao || 0,
        valorMercado: im.valorAvaliacao || 0,
        areaM2: im.areaM2 || 0,
        leiloeiro: im.leiloeiro || '',
        dataLeilao: im.dataLeilao || '',
        origem: im.modalidade || 'extrajudicial',
        status: 'arrematado',
        objetivoCompra: 'investimento',
        updatedAt: new Date().toISOString(),
        lancamentosFinanceiros: [],
        taxaLeiloeiroPercentual: 5,
        honorariosPercentual: 10,
        itbiPercentual: 3,
        somenteAVista: !im.pagamento?.includes('financiado'),
        prazoMeses: 360, cetAnual: 12, sinalPercentual: 5, prazoVendaMeses: 12,
      };
      saveImoveis([...imoveis, novo]);
    } else {
      saveImoveis(imoveis.map(i => i.id===im.id ? { ...i, status:'arrematado' } : i));
    }
    nav('/painel');
  };

  // Filtro client-side sobre resultados
  const resultadosFiltrados = useMemo(() => {
    return resultados.filter(im => {
      if (filtros.tipo && im.tipo !== filtros.tipo) return false;
      if (filtros.modalidade && im.modalidade !== filtros.modalidade) return false;
      if (filtros.valorMin && im.valorMinimo < Number(filtros.valorMin)) return false;
      if (filtros.valorMax && im.valorMinimo > Number(filtros.valorMax)) return false;
      if (filtros.pagamento?.length > 0 && !filtros.pagamento.some(p => im.pagamento?.includes(p))) return false;
      return true;
    });
  }, [resultados, filtros]);

  const fmt0 = (v) => (v||0).toLocaleString('pt-BR', { minimumFractionDigits:0 });
  const desconto = (im) => im.valorAvaliacao>0 ? Math.round((1-im.valorMinimo/im.valorAvaliacao)*100) : 0;

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding: isMobile ? '16px 12px' : '24px 20px', display:'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', gap:20, alignItems:'start' }}>

      {/* SIDEBAR */}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

        {/* Filtros */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <button onClick={()=>setShowFiltros(!showFiltros)}
            style={{ width:'100%', padding:'13px 16px', background:'#0f172a', color:'white', border:'none', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', fontWeight:700, fontSize:13 }}>
            <span style={{ display:'flex', alignItems:'center', gap:7 }}><Filter size={14}/> Filtros</span>
            {showFiltros ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
          </button>
          {showFiltros && (
            <div style={{ padding:14, display:'flex', flexDirection:'column', gap:12 }}>
              <div>
                <label style={lbl}>Tipo de Imóvel</label>
                <select value={filtros.tipo} onChange={e=>up('tipo',e.target.value)} style={inp}>
                  <option value="">Todos</option>
                  {[['casa','Casa'],['apartamento','Apartamento'],['terreno','Terreno/Lote'],['comercial','Comercial']].map(([v,l])=><option key={v} value={v}>{l}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Modalidade</label>
                <select value={filtros.modalidade} onChange={e=>up('modalidade',e.target.value)} style={inp}>
                  <option value="">Todas</option>
                  <option value="judicial">Judicial</option>
                  <option value="extrajudicial">Extrajudicial</option>
                </select>
              </div>
              <div>
                <label style={lbl}>Estado (UF)</label>
                <select value={filtros.estado} onChange={e=>{ up('estado',e.target.value); up('cidades',[]); setBuscaCidade(''); }} style={inp}>
                  <option value="">Todos</option>
                  {ESTADOS.map(e=><option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Cidade(s) — opcional, múltipla seleção</label>
                <div style={{ fontSize:10, color:'#94a3b8', marginBottom:6 }}>Deixe vazio para buscar em todo o estado</div>
                {/* Cidades selecionadas */}
                {filtros.cidades.length > 0 && (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginBottom:6 }}>
                    {filtros.cidades.map(c=>(
                      <span key={c} style={{ display:'flex', alignItems:'center', gap:3, background:'#dbeafe', color:'#1e40af', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:20 }}>
                        {c}
                        <button onClick={()=>up('cidades', filtros.cidades.filter(x=>x!==c))}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#1e40af', padding:0, display:'flex' }}>
                          <X size={10}/>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  value={buscaCidade}
                  onChange={e=>setBuscaCidade(e.target.value)}
                  placeholder={filtros.estado ? 'Buscar cidade (opcional)...' : 'Selecione um estado primeiro'}
                  disabled={!filtros.estado}
                  style={{ ...inp, marginBottom:4 }}
                />
                {filtros.estado && buscaCidade.length >= 1 && (
                  <div style={{ maxHeight:160, overflowY:'auto', border:'1px solid #e2e8f0', borderRadius:8, background:'white' }}>
                    {(CIDADES_POR_ESTADO[filtros.estado] || [])
                      .filter(c => c.toLowerCase().includes(buscaCidade.toLowerCase()) && !filtros.cidades.includes(c))
                      .map(c => (
                        <button key={c} onClick={()=>{ up('cidades', [...filtros.cidades, c]); setBuscaCidade(''); }}
                          style={{ width:'100%', padding:'7px 12px', border:'none', background:'none', textAlign:'left', cursor:'pointer', fontSize:12, color:'#334155', borderBottom:'1px solid #f1f5f9' }}
                          onMouseEnter={e=>e.currentTarget.style.background='#eff6ff'}
                          onMouseLeave={e=>e.currentTarget.style.background='none'}>
                          {c}
                        </button>
                      ))
                    }
                    {(CIDADES_POR_ESTADO[filtros.estado] || []).filter(c=>c.toLowerCase().includes(buscaCidade.toLowerCase())&&!filtros.cidades.includes(c)).length===0 && (
                      <div style={{ padding:'8px 12px', fontSize:11, color:'#94a3b8' }}>Nenhuma cidade encontrada</div>
                    )}
                  </div>
                )}
              </div>
              <div>
                <label style={lbl}>Raio de distância</label>
                <select value={filtros.raioKm} onChange={e=>up('raioKm', Number(e.target.value))} style={inp}>
                  {RAIOS_KM.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Valor de Lance (R$)</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                  <input type="number" value={filtros.valorMin} onChange={e=>up('valorMin',e.target.value)} placeholder="Mínimo" style={inp}/>
                  <input type="number" value={filtros.valorMax} onChange={e=>up('valorMax',e.target.value)} placeholder="Máximo" style={inp}/>
                </div>
              </div>
              <div>
                <label style={lbl}>Forma de Pagamento</label>
                {[['aVista','À Vista'],['financiado','Financiado'],['hipotecado','Hipotecado']].map(([v,l])=>(
                  <label key={v} style={{ display:'flex', alignItems:'center', gap:7, cursor:'pointer', fontSize:12, color:'#334155', marginBottom:5 }}>
                    <input type="checkbox" checked={filtros.pagamento.includes(v)} onChange={()=>togglePagamento(v)} style={{ width:14, height:14 }}/>
                    {l}
                  </label>
                ))}
              </div>
              {erro && <div style={{ padding:'8px 10px', background:'#fee2e2', borderRadius:8, fontSize:11, color:'#dc2626', fontWeight:600 }}>{erro}</div>}
              <button onClick={buscar} disabled={loading}
                style={{ width:'100%', padding:'11px', background:'#2563eb', color:'white', border:'none', borderRadius:8, fontWeight:800, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                {loading ? <><Loader2 size={14} style={{animation:'spin 1s linear infinite'}}/> Buscando...</> : <><Search size={14}/> Buscar Leilões</>}
              </button>
            </div>
          )}
        </div>

      </div>

      {/* CONTEÚDO PRINCIPAL */}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

        {/* Header de resultados */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <div>
            <h1 style={{ margin:0, fontSize:18, fontWeight:900, color:'#0f172a' }}>Busca de Imóveis em Leilão</h1>
            <p style={{ margin:'4px 0 0', fontSize:12, color:'#64748b' }}>
              {loading ? 'Buscando leilões...'
                : buscaFeita ? `${resultadosFiltrados.length} imóvel(is) encontrado(s)`
                : 'Configure os filtros e clique em Buscar Leilões'}
            </p>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center' }}>
            {selecionados.length>0 && (
              <button onClick={()=>irParaAnalise(resultados.find(r=>r.id===selecionados[0]))}
                style={{ padding:'8px 16px', background:'#10b981', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                <ArrowRight size={13}/> Analisar selecionado ({selecionados.length})
              </button>
            )}
            {buscaFeita&&!loading && (
              <button onClick={buscar}
                style={{ padding:'7px 12px', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:700, color:'#475569', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                <RefreshCw size={12}/> Nova busca
              </button>
            )}
            {loading && <Loader2 size={18} color="#2563eb" style={{animation:'spin 1s linear infinite'}}/>}
          </div>
        </div>

        {/* Info inicial */}
        {!buscaFeita && (
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {!canAnalise && (
              <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:12, padding:'12px 16px', display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ fontSize:16 }}>🔒</span>
                <div style={{ fontSize:13, color:'#92400e', flex:1 }}>
                  {!user
                    ? <><strong>Faça login</strong> para acessar o site do leiloeiro e gerar análises completas dos imóveis.</>
                    : <><strong>Plano Explorador:</strong> Você vê os imóveis e a flag de viabilidade 🟢/🔴. Para gerar análise completa, faça upgrade para o <strong>Plano Investidor</strong> ou superior.</>
                  }
                </div>
                <button onClick={()=>nav('/planos')} style={{ padding:'7px 14px', background:'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                  Ver planos
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {[1,2,3,4,5].map(i=>(
              <div key={i} style={{ height:80, background:'white', borderRadius:12, border:'1px solid #e2e8f0', animation:'pulse 1.5s ease-in-out infinite' }}/>
            ))}
          </div>
        )}

        {/* Resultados em lista */}
        {!loading && resultadosFiltrados.length>0 && (
          <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
            {/* Desktop: header tabela */}
            {!isMobile && (
              <div style={{ display:'grid', gridTemplateColumns:'36px 1fr 110px 120px 120px 72px 90px 190px', gap:0, background:'#f8fafc', borderBottom:'2px solid #e2e8f0', padding:'9px 16px', alignItems:'center' }}>
                {['','Imóvel / Localização','Modalidade','Lance Mín.','Avaliação','Desc.','Data','Ações'].map((h,i)=>(
                  <div key={i} style={{ fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:0.4 }}>{h}</div>
                ))}
              </div>
            )}

            {resultadosFiltrados.map((im,i)=>{
              const desc = desconto(im);
              const sel = isSelecionado(im.id);

              // Mobile: card layout
              if (isMobile) {
                return (
                  <div key={im.id} style={{ padding:'14px 16px', borderBottom:'1px solid #f1f5f9', background:sel?'#eff6ff':i%2===0?'white':'#fafafa' }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, marginBottom:8 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                          <input type="checkbox" checked={sel} onChange={()=>toggleSelecionado(im.id)}
                            style={{ width:16, height:16, cursor:'pointer', accentColor:'#2563eb', flexShrink:0 }}/>
                          <span style={{ fontWeight:700, color:'#0f172a', fontSize:14, lineHeight:1.2 }}>{im.titulo||im.nome}</span>
                          {im.fracionado && (
                            <span style={{ fontSize:9, fontWeight:800, background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a', padding:'1px 6px', borderRadius:10, whiteSpace:'nowrap' }}>
                              ⚠ Fracionado
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize:12, color:'#64748b', marginTop:4, display:'flex', alignItems:'center', gap:4 }}>
                          <MapPin size={11}/> {im.endereco||'—'}{im.cidade?', '+im.cidade:''}
                        </div>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0 }}>
                        {desc>0 && <div style={{ fontSize:18, fontWeight:900, color:desc>=40?'#10b981':'#f59e0b' }}>{desc}% {desc>=30?'🟢':'🔴'}</div>}
                      </div>
                    </div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8, marginBottom:10 }}>
                      <div>
                        <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>Lance mín.</div>
                        <div style={{ fontWeight:800, color:'#0f172a', fontSize:16 }}>R$ {fmt0(im.valorMinimo)}</div>
                      </div>
                      {im.valorAvaliacao>0 && (
                        <div>
                          <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>Avaliação</div>
                          <div style={{ fontSize:13, color:'#64748b' }}>R$ {fmt0(im.valorAvaliacao)}</div>
                        </div>
                      )}
                      <div>
                        <div style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>Data</div>
                        <div style={{ fontSize:13, color:'#64748b' }}>{fmtData(im.dataLeilao, im.modalidade)}</div>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:8 }}>
                      <span style={{ fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:20, background:im.modalidade==='judicial'?'#fef3c7':'#dbeafe', color:im.modalidade==='judicial'?'#92400e':'#1e40af' }}>
                        {im.modalidade==='judicial'?'Judicial':'Extrajudicial'}
                      </span>
                      {im.areaM2>0 && <span style={{ fontSize:11, color:'#8b5cf6', fontWeight:600, padding:'3px 8px', background:'#f5f3ff', borderRadius:20 }}>{im.areaM2}m²</span>}
                      {(im.pagamento||[]).map(p=>(
                        <span key={p} style={{ fontSize:10, background:'#f1f5f9', color:'#475569', padding:'2px 8px', borderRadius:10, fontWeight:600 }}>
                          {p==='a_vista'||p==='aVista'?'À Vista':p==='financiado'?'Financiado':'Hipotecado'}
                        </span>
                      ))}
                    </div>
                    <div style={{ display:'flex', gap:8 }}>
                      {im.urlLote && (
                        canSite
                          ? <a href={im.urlLote} target="_blank" rel="noopener noreferrer"
                              style={{ flex:1, padding:'10px 8px', background:'#f1f5f9', color:'#475569', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, fontWeight:600, textDecoration:'none', display:'flex', alignItems:'center', justifyContent:'center', gap:4, minHeight:44 }}>
                              <ExternalLink size={13}/> Site
                            </a>
                          : <span style={{ flex:1, padding:'10px 8px', background:'#f8fafc', color:'#cbd5e1', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, fontWeight:600, display:'flex', alignItems:'center', justifyContent:'center', gap:4, cursor:'not-allowed', minHeight:44 }}>
                              🔒 Site
                            </span>
                      )}
                      {canAnalise
                        ? <button onClick={()=>irParaAnalise(im)}
                            style={{ flex:2, padding:'10px', background:'#2563eb', color:'white', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6, minHeight:44 }}>
                            📊 Analisar
                          </button>
                        : <span style={{ flex:2, padding:'10px', background:'#f8fafc', color:'#cbd5e1', border:'none', borderRadius:8, fontSize:13, fontWeight:700, cursor:'not-allowed', display:'flex', alignItems:'center', justifyContent:'center', gap:6, minHeight:44 }}>
                            🔒 Analisar
                          </span>
                      }
                    </div>
                  </div>
                );
              }

              // Desktop: row layout
              return (
                <div key={im.id}
                  style={{ display:'grid', gridTemplateColumns:'36px 1fr 110px 120px 120px 72px 90px 190px', gap:0, padding:'12px 16px', borderBottom:'1px solid #f1f5f9', background:sel?'#eff6ff':i%2===0?'white':'#fafafa', alignItems:'center', transition:'background 0.15s' }}>

                  {/* Checkbox seleção */}
                  <input type="checkbox" checked={sel} onChange={()=>toggleSelecionado(im.id)}
                    style={{ width:16, height:16, cursor:'pointer', accentColor:'#2563eb' }}/>

                  {/* Info do imóvel */}
                  <div style={{ paddingRight:12 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap' }}>
                      <span style={{ fontWeight:700, color:'#0f172a', fontSize:13, lineHeight:1.2 }}>{im.titulo||im.nome}</span>
                      {im.fracionado && (
                        <span style={{ fontSize:9, fontWeight:800, background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a', padding:'1px 6px', borderRadius:10, whiteSpace:'nowrap' }}>
                          ⚠ Fracionado
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:'#64748b', marginTop:2, display:'flex', alignItems:'center', gap:4 }}>
                      <MapPin size={10}/> {im.endereco||'—'}{im.cidade?', '+im.cidade:''}
                    </div>
                    <div style={{ display:'flex', gap:5, marginTop:4, flexWrap:'wrap' }}>
                      {im.areaM2>0 && <span style={{ fontSize:10, color:'#8b5cf6', fontWeight:600 }}>{im.areaM2}m²</span>}
                      {(im.pagamento||[]).map(p=>(
                        <span key={p} style={{ fontSize:9, background:'#f1f5f9', color:'#475569', padding:'1px 6px', borderRadius:10, fontWeight:600 }}>
                          {p==='a_vista'||p==='aVista'?'À Vista':p==='financiado'?'Financ.':'Hipot.'}
                        </span>
                      ))}
                      <span style={{ fontSize:9, color:'#94a3b8' }}>{im.plataforma||im.leiloeiro}</span>
                    </div>
                  </div>

                  {/* Modalidade */}
                  <div>
                    <span style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:20, background:im.modalidade==='judicial'?'#fef3c7':'#dbeafe', color:im.modalidade==='judicial'?'#92400e':'#1e40af' }}>
                      {im.modalidade==='judicial'?'Judicial':'Extrajud.'}
                    </span>
                  </div>

                  {/* Lance */}
                  <div style={{ fontWeight:800, color:'#0f172a', fontSize:14 }}>
                    R$ {fmt0(im.valorMinimo)}
                  </div>

                  {/* Avaliação */}
                  <div style={{ fontSize:12, color:'#64748b' }}>
                    {im.valorAvaliacao>0 ? `R$ ${fmt0(im.valorAvaliacao)}` : '—'}
                  </div>

                  {/* Desconto + Flag */}
                  <div style={{ display:'flex', flexDirection:'column', gap:3, alignItems:'flex-start' }}>
                    {desc>0 && (
                      <span style={{ fontSize:14, fontWeight:900, color:desc>=40?'#10b981':'#f59e0b' }}>{desc}%</span>
                    )}
                    {desc>0 && (
                      <span style={{ fontSize:11, fontWeight:800 }}>
                        {desc>=30 ? '🟢' : '🔴'}
                      </span>
                    )}
                  </div>

                  {/* Data */}
                  <div style={{ fontSize:11, color:'#64748b' }}>{fmtData(im.dataLeilao, im.modalidade)}</div>

                  {/* Ações */}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {im.urlLote && (
                      canSite
                        ? <a href={im.urlLote} target="_blank" rel="noopener noreferrer"
                            style={{ padding:'5px 8px', background:'#f1f5f9', color:'#475569', border:'1px solid #e2e8f0', borderRadius:6, fontSize:11, fontWeight:600, textDecoration:'none', display:'flex', alignItems:'center', gap:4 }}>
                            <ExternalLink size={11}/> Site
                          </a>
                        : <span title={user ? '' : 'Faça login para acessar o site do leiloeiro'}
                            style={{ padding:'5px 8px', background:'#f8fafc', color:'#cbd5e1', border:'1px solid #e2e8f0', borderRadius:6, fontSize:11, fontWeight:600, display:'flex', alignItems:'center', gap:4, cursor:'not-allowed' }}>
                            🔒 Site
                          </span>
                    )}
                    {canAnalise
                      ? <button onClick={()=>irParaAnalise(im)}
                          style={{ padding:'5px 10px', background:'#2563eb', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
                          📊 Analisar
                        </button>
                      : <span title="Disponível no plano Investidor ou acima"
                          style={{ padding:'5px 10px', background:'#f8fafc', color:'#cbd5e1', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'not-allowed', whiteSpace:'nowrap' }}>
                          🔒 Analisar
                        </span>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Sem resultados */}
        {buscaFeita && !loading && resultadosFiltrados.length===0 && !erro && (
          <div style={{ textAlign:'center', padding:'60px 20px', background:'white', borderRadius:14, border:'1px solid #e2e8f0' }}>
            <Search size={40} color="#94a3b8" style={{ margin:'0 auto 16px' }}/>
            <h3 style={{ color:'#334155', fontWeight:800, margin:'0 0 8px' }}>Nenhum resultado</h3>
            <p style={{ color:'#94a3b8', fontSize:13 }}>Tente remover filtros ou buscar diretamente nas plataformas.</p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
      `}</style>
    </div>
  );
}
