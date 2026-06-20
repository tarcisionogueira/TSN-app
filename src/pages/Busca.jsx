import React, { useState, useEffect } from 'react';
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
  if (!d) return modalidade === 'venda_direta' ? 'Venda Direta' : 'Sem data';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'2-digit' });
}

const TIPO_LABEL = { casa:'Casa', apartamento:'Apartamento', terreno:'Terreno/Lote', comercial:'Comercial', rural:'Rural', galpao:'Galpão', sala:'Sala Comercial', vaga:'Vaga de Garagem', imovel:'Imóvel' };
const MODAL_LABEL = { primeiro_leilao:'1ª Praça', segundo_leilao:'2ª Praça', venda_direta:'Venda Direta', licitacao_aberta:'Licitação Aberta', judicial:'Judicial', extrajudicial:'Extrajudicial' };
const fmtBRL = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';

const PLANO_LABELS = {
  explorador: 'Explorador', top1: 'Investidor', top2: 'Investidor Pro',
  assessorado: 'Assessorado', clube: 'Clube de Negócios',
};

export default function Busca() {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { role, user } = useAuth();
  const plano = role || 'explorador';
  const canSite    = user && ROLES_SITE.includes(role);
  const canAnalise = user && ROLES_ANALISE.includes(role);
  const FILTROS_INICIAL = { tipo:'', estado:'', cidades:[], raioKm:0, valorMin:'', valorMax:'', modalidade:'', pagamento:[] };
  const [filtros, setFiltros] = useState(FILTROS_INICIAL);
  const [filtrosSalvos, setFiltrosSalvos] = useState([]);
  const [nomeFiltro, setNomeFiltro] = useState('');
  const [showSalvarModal, setShowSalvarModal] = useState(false);
  const [buscaCidade, setBuscaCidade] = useState('');
  const [dropdownIndex, setDropdownIndex] = useState(-1);
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [buscaFeita, setBuscaFeita] = useState(false);
  const [showFiltros, setShowFiltros] = useState(true);
  const [selecionados, setSelecionados] = useState([]);
  const [sortBy, setSortBy] = useState('desconto_desc');
  const [pagina, setPagina] = useState(1);
  const [totalResultados, setTotalResultados] = useState(0);
  const POR_PAGINA = 50;

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('filtros_salvos').select('*').eq('user_id', user.id).order('criado_em', { ascending: false })
      .then(({ data }) => setFiltrosSalvos(data || []));
  }, [user?.id]);

  const up = (name, val) => setFiltros(p => ({ ...p, [name]: val }));
  const togglePagamento = (v) => up('pagamento', filtros.pagamento.includes(v) ? filtros.pagamento.filter(x=>x!==v) : [...filtros.pagamento, v]);
  const toggleSelecionado = (id) => setSelecionados(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]);
  const isSelecionado = (id) => selecionados.includes(id);

  // Mapeamento: valor do checkbox → valor(es) no banco
  const PAGAMENTO_DB = { aVista: ['a_vista','aVista','À Vista'], financiado: ['financiado','Financiado'], hipotecado: ['hipotecado','Hipotecado'] };

  const limparFiltros = () => { setFiltros(FILTROS_INICIAL); setBuscaCidade(''); setSelecionados([]); setPagina(1); };

  async function salvarFiltroAtual() {
    if (!nomeFiltro.trim() || !user?.id) return;
    const { data } = await supabase.from('filtros_salvos').insert({
      user_id: user.id, nome: nomeFiltro.trim(), filtros,
    }).select().single();
    if (data) setFiltrosSalvos(p => [data, ...p]);
    setNomeFiltro(''); setShowSalvarModal(false);
  }

  async function deletarFiltro(id) {
    await supabase.from('filtros_salvos').delete().eq('id', id);
    setFiltrosSalvos(p => p.filter(f => f.id !== id));
  }

  const buscarPagina = async (paginaAlvo, filtrosAtivos, sortAtivo) => {
    setErro(''); setLoading(true); setBuscaFeita(true); setResultados([]);

    const buildQuery = (base) => {
      let q = base.eq('ativo', true);
      if (filtrosAtivos.estado) q = q.eq('estado', filtrosAtivos.estado);
      if (filtrosAtivos.cidades?.length > 0) {
        const orParts = filtrosAtivos.cidades.map(c => `cidade.ilike.${c}`).join(',');
        q = q.or(orParts);
      }
      if (filtrosAtivos.tipo) q = q.in('tipo', [filtrosAtivos.tipo, 'imovel']);
      if (filtrosAtivos.modalidade) q = q.eq('modalidade', filtrosAtivos.modalidade);
      if (filtrosAtivos.valorMin) q = q.gte('valor_minimo', Number(String(filtrosAtivos.valorMin).replace(/\D/g, '')));
      if (filtrosAtivos.valorMax) q = q.lte('valor_minimo', Number(String(filtrosAtivos.valorMax).replace(/\D/g, '')));
      if (filtrosAtivos.pagamento?.length > 0) {
        const dbVals = filtrosAtivos.pagamento.flatMap(v => PAGAMENTO_DB[v] || [v]);
        const orParts = dbVals.map(v => `forma_pagamento.ilike.${v}`).join(',');
        q = q.or(orParts);
      }
      return q;
    };

    const offset = (paginaAlvo - 1) * POR_PAGINA;
    const [coluna, dir] = sortAtivo === 'desconto_desc' ? ['desconto_percentual', false]
      : sortAtivo === 'desconto_asc' ? ['desconto_percentual', true]
      : sortAtivo === 'valor_asc'    ? ['valor_minimo', true]
      : ['valor_minimo', false];

    try {
      const [{ count }, { data: dbData, error: dbError }] = await Promise.all([
        buildQuery(supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true })),
        buildQuery(supabase.from('imoveis_leilao').select('*'))
          .order(coluna, { ascending: dir, nullsFirst: false })
          .range(offset, offset + POR_PAGINA - 1),
      ]);

      setTotalResultados(count || 0);

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
        linkMatricula: im.link_matricula,
        foto: im.link_foto,
        leiloeiro: im.leiloeiro,
        dataLeilao: im.data_leilao,
        pagamento: [im.forma_pagamento],
        viavel: im.viavel,
        scoreViabilidade: im.score_viabilidade,
        fracionado: im.fracionado,
        fonte: im.fonte,
        numeroEdital: im.numero_edital,
        numeroMatricula: im.numero_matricula,
        numeroProcesso: im.numero_processo,
      })) : [];
      setResultados(mapeados);

      // Silent tracking — fire and forget
      try {
        const sid = sessionStorage.getItem('tsn_session_id') || (() => { const s = Math.random().toString(36).slice(2); sessionStorage.setItem('tsn_session_id', s); return s; })();
        supabase.from('busca_historico').insert({
          user_id: user?.id || null, session_id: sid, filtros: filtrosAtivos,
          resultados_count: count || 0, cidade: filtrosAtivos.cidades?.join(', ') || null,
          estado: filtrosAtivos.estado || null, tipo_imovel: filtrosAtivos.tipo || null,
          valor_min: filtrosAtivos.valorMin ? Number(filtrosAtivos.valorMin) : null,
          valor_max: filtrosAtivos.valorMax ? Number(filtrosAtivos.valorMax) : null,
          pagamento_tipos: filtrosAtivos.pagamento?.length > 0 ? filtrosAtivos.pagamento : null,
          sort_usado: sortAtivo,
        }).then(() => {}).catch(() => {});
      } catch (_) {}

      if (user?.id && (filtrosAtivos.estado || filtrosAtivos.cidades?.length > 0)) {
        try {
          supabase.from('alertas_email').upsert({
            user_id: user.id, filtros: filtrosAtivos,
            descricao: [filtrosAtivos.cidades?.join(', ') || filtrosAtivos.estado, filtrosAtivos.tipo].filter(Boolean).join(' · ') || 'Preferência geral',
            ativo: true,
          }, { onConflict: 'user_id' }).then(() => {}).catch(() => {});
        } catch (_) {}
      }
    } catch (e) {
      setErro('Erro na busca. Tente novamente.');
      console.error(e);
    }
    setLoading(false);
  };

  const buscar = () => {
    setPagina(1);
    saveBuscaRecente({ ...filtros, cidade: filtros.cidades.join(', ') });
    buscarPagina(1, filtros, sortBy);
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

  // Resultados já chegam filtrados/ordenados/paginados do servidor
  const resultadosFiltrados = resultados;
  const resultadosPagina = resultados;
  const totalPaginas = Math.max(1, Math.ceil(totalResultados / POR_PAGINA));

  const desconto = (im) => im.descontoPercentual ? Math.round(im.descontoPercentual) : (im.valorAvaliacao>0 ? Math.round((1-im.valorMinimo/im.valorAvaliacao)*100) : 0);

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
                  <option value="primeiro_leilao">1ª Praça</option>
                  <option value="segundo_leilao">2ª Praça</option>
                  <option value="venda_direta">Venda Direta</option>
                  <option value="licitacao_aberta">Licitação Aberta</option>
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
                {(() => {
                  const cidadesFiltradas = filtros.estado
                    ? (CIDADES_POR_ESTADO[filtros.estado] || []).filter(c => c.toLowerCase().includes(buscaCidade.toLowerCase()) && !filtros.cidades.includes(c))
                    : [];
                  const handleKeyDown = (e) => {
                    if (!cidadesFiltradas.length) return;
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setDropdownIndex(i => Math.min(i + 1, cidadesFiltradas.length - 1));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setDropdownIndex(i => Math.max(i - 1, -1));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      const cidade = cidadesFiltradas[dropdownIndex >= 0 ? dropdownIndex : 0];
                      if (cidade) { up('cidades', [...filtros.cidades, cidade]); setBuscaCidade(''); setDropdownIndex(-1); }
                    } else if (e.key === 'Escape') {
                      setBuscaCidade(''); setDropdownIndex(-1);
                    }
                  };
                  return (
                    <>
                      <input
                        value={buscaCidade}
                        onChange={e=>{ setBuscaCidade(e.target.value); setDropdownIndex(-1); }}
                        onKeyDown={handleKeyDown}
                        placeholder={filtros.estado ? 'Buscar cidade (opcional)...' : 'Selecione um estado primeiro'}
                        disabled={!filtros.estado}
                        style={{ ...inp, marginBottom:4 }}
                        autoComplete="off"
                      />
                      {filtros.estado && buscaCidade.length >= 1 && (
                        <div style={{ maxHeight:160, overflowY:'auto', border:'1px solid #e2e8f0', borderRadius:8, background:'white' }}>
                          {cidadesFiltradas.map((c, idx) => (
                            <button key={c}
                              onClick={()=>{ up('cidades', [...filtros.cidades, c]); setBuscaCidade(''); setDropdownIndex(-1); }}
                              style={{ width:'100%', padding:'7px 12px', border:'none', background: idx === dropdownIndex ? '#eff6ff' : 'none', textAlign:'left', cursor:'pointer', fontSize:12, color: idx === dropdownIndex ? '#1d4ed8' : '#334155', borderBottom:'1px solid #f1f5f9', fontWeight: idx === dropdownIndex ? 700 : 400 }}
                              onMouseEnter={e=>{ setDropdownIndex(idx); e.currentTarget.style.background='#eff6ff'; }}
                              onMouseLeave={e=>{ if (dropdownIndex !== idx) e.currentTarget.style.background='none'; }}>
                              {c}
                            </button>
                          ))}
                          {cidadesFiltradas.length === 0 && (
                            <div style={{ padding:'8px 12px', fontSize:11, color:'#94a3b8' }}>Nenhuma cidade encontrada</div>
                          )}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
              <div style={{ opacity: 0.5, pointerEvents: 'none' }} title="Em breve">
                <label style={lbl}>Raio de distância <span style={{ fontSize:9, background:'#e2e8f0', padding:'1px 5px', borderRadius:4 }}>Em breve</span></label>
                <select value={filtros.raioKm} onChange={e=>up('raioKm', Number(e.target.value))} style={inp} disabled>
                  {RAIOS_KM.map(r=><option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Valor de Lance (R$)</label>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
                  <input type="text" inputMode="numeric"
                    value={filtros.valorMin ? 'R$ ' + Number(String(filtros.valorMin).replace(/\D/g,'')).toLocaleString('pt-BR') : ''}
                    onChange={e=>{ const n=e.target.value.replace(/\D/g,''); up('valorMin', n); }}
                    placeholder="R$ Mínimo" style={inp}/>
                  <input type="text" inputMode="numeric"
                    value={filtros.valorMax ? 'R$ ' + Number(String(filtros.valorMax).replace(/\D/g,'')).toLocaleString('pt-BR') : ''}
                    onChange={e=>{ const n=e.target.value.replace(/\D/g,''); up('valorMax', n); }}
                    placeholder="R$ Máximo" style={inp}/>
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
              <button onClick={limparFiltros}
                style={{ width:'100%', padding:'9px', background:'none', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                ✕ Limpar filtros
              </button>
            </div>
          )}
        </div>

      </div>

      {/* CONTEÚDO PRINCIPAL */}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

        {/* Filtros Salvos */}
        {user?.id && (
          <div style={{ background: 'white', borderRadius: 12, padding: '10px 14px', marginBottom: 0, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Filtros salvos:</span>
            {filtrosSalvos.map(filtro => (
              <span key={filtro.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1d4ed8', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <span onClick={() => setFiltros(filtro.filtros)}>{filtro.nome}</span>
                <button onClick={() => deletarFiltro(filtro.id)} style={{ background: 'none', border: 'none', color: '#93c5fd', cursor: 'pointer', padding: 0, fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center' }}>×</button>
              </span>
            ))}
            {!showSalvarModal && (
              <button onClick={() => setShowSalvarModal(true)} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                + Salvar filtros atuais
              </button>
            )}
            {showSalvarModal && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={nomeFiltro} onChange={e => setNomeFiltro(e.target.value)}
                  placeholder="Nome do filtro..." autoFocus
                  onKeyDown={e => e.key === 'Enter' && salvarFiltroAtual()}
                  style={{ padding: '4px 8px', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, outline: 'none', width: 140 }} />
                <button onClick={salvarFiltroAtual} style={{ padding: '4px 10px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Salvar</button>
                <button onClick={() => { setShowSalvarModal(false); setNomeFiltro(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
            )}
          </div>
        )}

        {/* Header de resultados */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <div>
            <h1 style={{ margin:0, fontSize:18, fontWeight:900, color:'#0f172a' }}>Busca de Imóveis em Leilão</h1>
            <p style={{ margin:'4px 0 0', fontSize:12, color:'#64748b' }}>
              {loading ? 'Buscando leilões...'
                : buscaFeita ? `${totalResultados} imóvel(is) encontrado(s) · página ${pagina} de ${totalPaginas}`
                : 'Configure os filtros e clique em Buscar Leilões'}
            </p>
          </div>
          <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
            {buscaFeita && !loading && (
              <select value={sortBy} onChange={e=>{ setSortBy(e.target.value); setPagina(1); buscarPagina(1, filtros, e.target.value); }}
                style={{ padding:'7px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:600, color:'#334155', background:'white', cursor:'pointer' }}>
                <option value="desconto_desc">Maior desconto primeiro</option>
                <option value="desconto_asc">Menor desconto primeiro</option>
                <option value="valor_asc">Menor valor primeiro</option>
                <option value="valor_desc">Maior valor primeiro</option>
              </select>
            )}
            {selecionados.length>0 && (
              <button onClick={()=>irParaAnalise(resultados.find(r=>r.id===selecionados[0]))}
                style={{ padding:'8px 16px', background:'#10b981', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                <ArrowRight size={13}/> Analisar imóvel selecionado
              </button>
            )}
            {buscaFeita&&!loading && (
              <button onClick={buscar}
                style={{ padding:'7px 12px', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:700, color:'#475569', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                <RefreshCw size={12}/> Atualizar
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
                    : <>
                        <strong>Plano {PLANO_LABELS[role] || 'atual'}:</strong> Você vê os imóveis e a flag de viabilidade 🟢/🔴.
                        {' '}Para gerar análise completa, faça upgrade para o <strong>Plano Investidor</strong> ou superior.
                      </>
                  }
                </div>
                {user && (
                  <button onClick={()=>nav('/planos')} style={{ padding:'7px 14px', background:'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                    Ver planos
                  </button>
                )}
                {!user && (
                  <button onClick={()=>nav('/login')} style={{ padding:'7px 14px', background:'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                    Entrar
                  </button>
                )}
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

        {/* Resultados em cards */}
        {!loading && resultadosFiltrados.length>0 && (
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:14 }}>
            {resultadosPagina.map((im)=>{
              const desc = desconto(im);
              const modalLabel = MODAL_LABEL[im.modalidade] || im.modalidade || '—';
              const modalColor = im.modalidade==='judicial'||im.modalidade==='primeiro_leilao' ? { bg:'#fef3c7', color:'#92400e' } : { bg:'#dbeafe', color:'#1e40af' };

              return (
                <div key={im.id}
                  style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden', display:'flex', flexDirection:'column', cursor:'pointer', transition:'box-shadow 0.15s' }}
                  onClick={e => { if (e.target.closest('a,button,input')) return; nav('/imovel/'+im.id, { state: { imovel: im } }); }}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.08)'}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>

                  {/* Card body: photo + content */}
                  <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', gap:0 }}>
                    {/* Thumbnail */}
                    <div style={{ width: isMobile ? '100%' : 160, height: isMobile ? 160 : 110, flexShrink:0, background:'#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', position:'relative' }}>
                      {im.foto
                        ? <img src={im.foto} alt="foto" style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }} onError={e=>{ e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='flex'; }}/>
                        : null}
                      <div style={{ display: im.foto ? 'none' : 'flex', alignItems:'center', justifyContent:'center', width:'100%', height:'100%', color:'#cbd5e1', flexDirection:'column', gap:4 }}>
                        <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 21V6.75A2.25 2.25 0 016 4.5h12A2.25 2.25 0 0120.25 6.75V21M9 21v-6h6v6M12 4.5v.01"/></svg>
                        <span style={{ fontSize:9, color:'#94a3b8', fontWeight:600 }}>Sem foto</span>
                      </div>
                    </div>

                    {/* Content */}
                    <div style={{ flex:1, padding:'12px 14px', display:'flex', flexDirection:'column', gap:6, minWidth:0 }}>
                      {/* Badges row */}
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap', alignItems:'center' }}>
                        {im.tipo && <span style={{ fontSize:9, fontWeight:700, background:'#f1f5f9', color:'#475569', padding:'2px 7px', borderRadius:10, whiteSpace:'nowrap' }}>{TIPO_LABEL[im.tipo]||im.tipo}</span>}
                        <span style={{ fontSize:9, fontWeight:700, padding:'2px 7px', borderRadius:10, whiteSpace:'nowrap', background:modalColor.bg, color:modalColor.color }}>{modalLabel}</span>
                        {im.fonte === 'CEF' && (
                          <span style={{ fontSize:9, fontWeight:800, background:'#fff7ed', color:'#c2410c', border:'1px solid #fed7aa', padding:'2px 7px', borderRadius:10, whiteSpace:'nowrap' }}>CAIXA</span>
                        )}
                        {im.fonte && im.fonte !== 'CEF' && (
                          <span style={{ fontSize:9, fontWeight:700, background:'#f8fafc', color:'#64748b', border:'1px solid #e2e8f0', padding:'2px 7px', borderRadius:10, whiteSpace:'nowrap' }}>{im.fonte}</span>
                        )}
                        {im.fracionado && (
                          <span style={{ fontSize:9, fontWeight:800, background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a', padding:'2px 6px', borderRadius:10, whiteSpace:'nowrap' }}>⚠ Fracionado</span>
                        )}
                      </div>

                      {/* Title */}
                      <div style={{ fontWeight:700, color:'#0f172a', fontSize:13, lineHeight:1.3, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                        {im.titulo||im.nome}
                      </div>

                      {/* Location */}
                      <div style={{ fontSize:11, color:'#64748b', display:'flex', alignItems:'center', gap:4, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                        <MapPin size={10} style={{ flexShrink:0 }}/> {[im.endereco, im.bairro, im.cidade, im.estado].filter(Boolean).join(', ')||'—'}
                      </div>

                      {/* Lance + Avaliação + Desconto */}
                      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                        <div>
                          <div style={{ fontSize:9, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:0.4 }}>Lance Mín.</div>
                          <div style={{ fontWeight:900, color:'#0f172a', fontSize:16 }}>{fmtBRL(im.valorMinimo)}</div>
                        </div>
                        {im.valorAvaliacao>0 && (
                          <div>
                            <div style={{ fontSize:9, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:0.4 }}>Avaliação</div>
                            <div style={{ fontSize:12, color:'#64748b' }}>{fmtBRL(im.valorAvaliacao)}</div>
                          </div>
                        )}
                        {desc>0 && (
                          <span style={{ background: desc>=40?'#dcfce7':desc>=20?'#fef9c3':'#fee2e2', color: desc>=40?'#15803d':desc>=20?'#92400e':'#dc2626', fontWeight:900, fontSize:14, padding:'4px 10px', borderRadius:8, whiteSpace:'nowrap' }}>
                            -{desc}%
                          </span>
                        )}
                      </div>

                      {/* Date + pagamento + area */}
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                        <span style={{ fontSize:10, color:'#64748b', fontWeight:600 }}>{fmtData(im.dataLeilao, im.modalidade)}</span>
                        {(im.pagamento||[]).map(p=>(
                          <span key={p} style={{ fontSize:9, background:'#f1f5f9', color:'#475569', padding:'2px 7px', borderRadius:10, fontWeight:600 }}>
                            {p==='a_vista'||p==='aVista'?'À Vista':p==='financiado'?'Financiado':'Hipotecado'}
                          </span>
                        ))}
                        {im.areaM2>0 && <span style={{ fontSize:10, color:'#8b5cf6', fontWeight:600 }}>{im.areaM2}m²</span>}
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div style={{ display:'flex', gap:8, padding:'10px 14px', borderTop:'1px solid #f1f5f9', background:'#fafafa' }}>
                    <button
                      onClick={e=>{ e.stopPropagation(); nav('/imovel/'+im.id, { state: { imovel: im } }); }}
                      style={{ flex:1, padding:'9px', background:'white', color:'#334155', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                      Ver detalhes →
                    </button>
                    {canAnalise
                      ? <button onClick={e=>{ e.stopPropagation(); irParaAnalise(im); }}
                          style={{ flex:1, padding:'9px', background:'#2563eb', color:'white', border:'none', borderRadius:8, fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                          📊 Analisar
                        </button>
                      : <span title="Disponível no plano Investidor ou acima"
                          style={{ flex:1, padding:'9px', background:'#f8fafc', color:'#cbd5e1', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:700, cursor:'not-allowed', display:'flex', alignItems:'center', justifyContent:'center', gap:5 }}>
                          🔒 Analisar
                        </span>
                    }
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Paginação */}
        {!loading && totalPaginas > 1 && (
          <div style={{ background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'12px 18px', display:'flex', justifyContent:'center', alignItems:'center', gap:8 }}>
            <button onClick={()=>{ const p=Math.max(1,pagina-1); setPagina(p); buscarPagina(p, filtros, sortBy); }} disabled={pagina===1}
              style={{ padding:'6px 14px', border:'1px solid #e2e8f0', borderRadius:7, fontWeight:700, fontSize:12, cursor:pagina===1?'not-allowed':'pointer', background:pagina===1?'#f8fafc':'white', color:pagina===1?'#cbd5e1':'#334155' }}>
              ← Anterior
            </button>
            {Array.from({length:totalPaginas},(_,i)=>i+1).filter(n=>n===1||n===totalPaginas||Math.abs(n-pagina)<=2).reduce((acc,n,idx,arr)=>{
              if(idx>0&&n-arr[idx-1]>1) acc.push('…');
              acc.push(n); return acc;
            },[]).map((n,i)=>
              n==='…' ? <span key={'e'+i} style={{color:'#94a3b8',fontSize:12}}>…</span>
              : <button key={n} onClick={()=>{ setPagina(n); buscarPagina(n, filtros, sortBy); }}
                  style={{ padding:'6px 11px', border:`1px solid ${n===pagina?'#2563eb':'#e2e8f0'}`, borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer', background:n===pagina?'#2563eb':'white', color:n===pagina?'white':'#334155' }}>
                  {n}
                </button>
            )}
            <button onClick={()=>{ const p=Math.min(totalPaginas,pagina+1); setPagina(p); buscarPagina(p, filtros, sortBy); }} disabled={pagina===totalPaginas}
              style={{ padding:'6px 14px', border:'1px solid #e2e8f0', borderRadius:7, fontWeight:700, fontSize:12, cursor:pagina===totalPaginas?'not-allowed':'pointer', background:pagina===totalPaginas?'#f8fafc':'white', color:pagina===totalPaginas?'#cbd5e1':'#334155' }}>
              Próxima →
            </button>
          </div>
        )}

        {/* Sem resultados */}
        {buscaFeita && !loading && totalResultados===0 && !erro && (
          <div style={{ textAlign:'center', padding:'60px 20px', background:'white', borderRadius:14, border:'1px solid #e2e8f0' }}>
            <Search size={40} color="#94a3b8" style={{ margin:'0 auto 16px' }}/>
            <h3 style={{ color:'#334155', fontWeight:800, margin:'0 0 8px' }}>Nenhum resultado</h3>
            <p style={{ color:'#94a3b8', fontSize:13, lineHeight:1.6 }}>
              Tente remover filtros ou ampliar a busca para todo o estado.
              {role === 'admin' && <><br/><strong style={{ color:'#d97706' }}>Admin:</strong> Se o banco estiver vazio, acesse <em>Admin → Scrapers → Buscar imóveis Caixa</em> para importar os dados.</>}
            </p>
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
