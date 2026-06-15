import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Loader2, Filter, ChevronDown, ChevronUp, Globe,
  ExternalLink, AlertCircle, RefreshCw, MapPin, Building2,
  CheckCircle2, ArrowRight, X,
} from 'lucide-react';
import { buscarImoveis, buscarLeiloeirosEstado } from '../utils/claude';
import { saveBuscaRecente, loadImoveis, saveImoveis, generateId } from '../utils/storage';
import { CIDADES_POR_ESTADO, RAIOS_KM } from '../data/cidades';

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const JUCE = {
  SP:'https://www.jucesp.sp.gov.br/Servicos/LeiloeirosPublicosOficiais',
  RJ:'https://www.jucerj.rj.gov.br/index.php/relacao-de-leiloeiros',
  MG:'https://www.jucemg.mg.gov.br/leiloeiros',
  BA:'https://www.juceb.ba.gov.br/servicos/leiloeiros',
  PR:'https://www.jucepar.pr.gov.br/Pagina/Leiloeiros',
  RS:'https://www.jucergs.rs.gov.br',
  PE:'https://www.jucepe.pe.gov.br',
};

const PLATAFORMAS = [
  { nome:'Caixa Econômica Federal', url:'https://venda-imoveis.caixa.gov.br', desc:'Maior acervo nacional', badge:'CEF' },
  { nome:'Sold Leilões', url:'https://www.sold.com.br', desc:'Judicial e extrajudicial', badge:'SOLD' },
  { nome:'Biasi Leilões', url:'https://www.biasi.com.br', desc:'Referência nacional', badge:'BIASI' },
  { nome:'Zukerman Leilões', url:'https://www.zukerman.com.br', desc:'Foco SP/RJ', badge:'ZUK' },
  { nome:'REM Leilões', url:'https://www.remleiloes.com.br', desc:'Multi-estado', badge:'REM' },
  { nome:'Frazão Leilões', url:'https://www.frazaoleiloes.com.br', desc:'Nordeste', badge:'FRZ' },
  { nome:'Resale', url:'https://www.resale.com.br', desc:'Creditas Imóveis', badge:'RES' },
  { nome:'Leilão Judicial Online', url:'https://www.leilaojudicialonline.com.br', desc:'Judicial', badge:'LJO' },
];

const inp = { width:'100%', padding:'9px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, background:'white', color:'#0f172a', boxSizing:'border-box' };
const lbl = { fontSize:10, fontWeight:700, color:'#475569', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 };

export default function Busca() {
  const nav = useNavigate();
  const plano = localStorage.getItem('tsn_plano_membro') || 'gratuito';
  const isPago = plano === 'analista' || plano === 'gestor';
  const [filtros, setFiltros] = useState({ tipo:'', estado:'SP', cidades:[], raioKm:0, valorMin:'', valorMax:'', modalidade:'', pagamento:[] });
  const [buscaCidade, setBuscaCidade] = useState('');
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingLeiloeiros, setLoadingLeiloeiros] = useState(false);
  const [leiloeiros, setLeiloeiros] = useState(null);
  const [erro, setErro] = useState('');
  const [buscaFeita, setBuscaFeita] = useState(false);
  const [showFiltros, setShowFiltros] = useState(true);
  const [showJuce, setShowJuce] = useState(false);
  const [selecionados, setSelecionados] = useState([]);
  const [imovelDetalhes, setImovelDetalhes] = useState(null);

  const up = (name, val) => setFiltros(p => ({ ...p, [name]: val }));
  const togglePagamento = (v) => up('pagamento', filtros.pagamento.includes(v) ? filtros.pagamento.filter(x=>x!==v) : [...filtros.pagamento, v]);
  const toggleSelecionado = (id) => setSelecionados(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]);
  const isSelecionado = (id) => selecionados.includes(id);

  const buscar = async () => {
    setErro(''); setLoading(true); setBuscaFeita(true); setResultados([]);
    // Passa cidades e raio para o filtro
    const filtrosApi = { ...filtros, cidade: filtros.cidades.join(', ') };
    saveBuscaRecente(filtrosApi);
    try {
      const res = await buscarImoveis(filtrosApi);
      setResultados(res);
      if (res.length === 0) setErro('Nenhum resultado. Tente ajustar os filtros ou verificar as plataformas diretamente.');
    } catch (e) {
      setErro('Erro na busca. Verifique a chave de API e tente novamente.');
      console.error(e);
    }
    setLoading(false);
  };

  const buscarLeiloeiros = async () => {
    if (!filtros.estado) { setErro('Selecione um estado.'); return; }
    setLoadingLeiloeiros(true);
    try { setLeiloeiros(await buscarLeiloeirosEstado(filtros.estado)); }
    catch { setErro('Não foi possível buscar os leiloeiros.'); }
    setLoadingLeiloeiros(false);
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
    <div style={{ maxWidth:1280, margin:'0 auto', padding:'24px 20px', display:'grid', gridTemplateColumns:'280px 1fr', gap:20, alignItems:'start' }}>

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
                <label style={lbl}>Cidade(s) — múltipla seleção</label>
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
                  placeholder={filtros.estado ? 'Buscar cidade...' : 'Selecione um estado primeiro'}
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

        {/* Leiloeiros da Junta */}
        <div style={{ background:'white', borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <button onClick={()=>setShowJuce(!showJuce)}
            style={{ width:'100%', padding:'11px 14px', background:'#f8fafc', border:'none', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', fontWeight:700, fontSize:12, color:'#334155' }}>
            <span style={{ display:'flex', alignItems:'center', gap:7 }}><Globe size={13}/> Leiloeiros Credenciados</span>
            {showJuce ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
          </button>
          {showJuce && (
            <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
              <p style={{ fontSize:11, color:'#64748b', margin:0, lineHeight:1.5 }}>
                Leiloeiros registrados nas Juntas Comerciais (JUCESP, JUCERJ, etc.)
              </p>
              {filtros.estado && JUCE[filtros.estado] && (
                <a href={JUCE[filtros.estado]} target="_blank" rel="noopener noreferrer"
                  style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, color:'#2563eb', fontWeight:600, textDecoration:'none' }}>
                  <ExternalLink size={11}/> Lista JUCE{filtros.estado}
                </a>
              )}
              <button onClick={buscarLeiloeiros} disabled={loadingLeiloeiros||!filtros.estado}
                style={{ padding:'7px', background:'#0f172a', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:5, opacity:!filtros.estado?0.5:1 }}>
                {loadingLeiloeiros ? <Loader2 size={12} style={{animation:'spin 1s linear infinite'}}/> : <Search size={12}/>}
                {filtros.estado ? `Leiloeiros no ${filtros.estado}` : 'Selecione um estado'}
              </button>
              {leiloeiros && (leiloeiros.leiloeiros||[]).map((l,i)=>(
                <div key={i} style={{ padding:'7px 10px', background:'#f8fafc', borderRadius:7, border:'1px solid #e2e8f0' }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#0f172a' }}>{l.nome}</div>
                  {l.especialidade && <div style={{ fontSize:10, color:'#64748b' }}>{l.especialidade}</div>}
                  {l.site && <a href={l.site} target="_blank" rel="noopener noreferrer" style={{ fontSize:10, color:'#2563eb', textDecoration:'none' }}>{l.site}</a>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Plataformas */}
        <div style={{ background:'white', borderRadius:12, border:'1px solid #e2e8f0', padding:'12px 14px' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Plataformas</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {PLATAFORMAS.map(p=>(
              <a key={p.nome} href={p.url} target="_blank" rel="noopener noreferrer"
                style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 9px', borderRadius:7, textDecoration:'none', border:'1px solid #f1f5f9' }}
                onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                <span style={{ background:'#0f172a', color:'white', fontSize:8, fontWeight:800, padding:'2px 5px', borderRadius:4, flexShrink:0 }}>{p.badge}</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'#0f172a' }}>{p.nome}</div>
                  <div style={{ fontSize:10, color:'#94a3b8' }}>{p.desc}</div>
                </div>
                <ExternalLink size={10} color="#94a3b8"/>
              </a>
            ))}
          </div>
        </div>
      </div>

      {/* CONTEÚDO PRINCIPAL */}
      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

        {/* Header de resultados */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10 }}>
          <div>
            <h1 style={{ margin:0, fontSize:18, fontWeight:900, color:'#0f172a' }}>Busca de Imóveis em Leilão</h1>
            <p style={{ margin:'4px 0 0', fontSize:12, color:'#64748b' }}>
              {loading ? 'Buscando leilões com IA...'
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
            <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:12, padding:'14px 18px', display:'flex', gap:10 }}>
              <AlertCircle size={16} color="#2563eb" style={{flexShrink:0,marginTop:1}}/>
              <div style={{ fontSize:13, color:'#1e40af', lineHeight:1.7 }}>
                <strong>Como funciona:</strong> A IA busca leilões reais publicados em plataformas como Caixa Econômica, Sold, Biasi e leiloeiros das Juntas Comerciais.
                <br/><strong>Dica:</strong> Selecione <strong>Estado = SP</strong> e clique em Buscar Leilões para começar.
              </div>
            </div>
            {!isPago && (
              <div style={{ background:'#fef3c7', border:'1px solid #fde68a', borderRadius:12, padding:'12px 16px', display:'flex', gap:10, alignItems:'center' }}>
                <span style={{ fontSize:16 }}>🔒</span>
                <div style={{ fontSize:13, color:'#92400e', flex:1 }}>
                  <strong>Plano Explorador (gratuito):</strong> Você vê os imóveis, o desconto e a flag de viabilidade 🟢/🔴. Para acessar o leiloeiro e gerar análise completa, faça upgrade para o plano <strong>Analista</strong>.
                </div>
                <button onClick={()=>{}} style={{ padding:'7px 14px', background:'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
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
            {/* Header tabela */}
            <div style={{ display:'grid', gridTemplateColumns:'36px 1fr 100px 120px 120px 80px 200px', gap:0, background:'#f8fafc', borderBottom:'2px solid #e2e8f0', padding:'9px 16px', alignItems:'center' }}>
              {['','Imóvel / Localização','Modalidade','Lance Mínimo','Avaliação','Desc.','Ações'].map((h,i)=>(
                <div key={i} style={{ fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:0.4 }}>{h}</div>
              ))}
            </div>

            {resultadosFiltrados.map((im,i)=>{
              const desc = desconto(im);
              const sel = isSelecionado(im.id);
              return (
                <div key={im.id}
                  style={{ display:'grid', gridTemplateColumns:'36px 1fr 100px 120px 120px 80px 200px', gap:0, padding:'12px 16px', borderBottom:'1px solid #f1f5f9', background:sel?'#eff6ff':i%2===0?'white':'#fafafa', alignItems:'center', transition:'background 0.15s' }}>

                  {/* Checkbox seleção */}
                  <input type="checkbox" checked={sel} onChange={()=>toggleSelecionado(im.id)}
                    style={{ width:16, height:16, cursor:'pointer', accentColor:'#2563eb' }}/>

                  {/* Info do imóvel */}
                  <div style={{ paddingRight:12 }}>
                    <div style={{ fontWeight:700, color:'#0f172a', fontSize:13, lineHeight:1.2 }}>{im.titulo||im.nome}</div>
                    <div style={{ fontSize:11, color:'#64748b', marginTop:2, display:'flex', alignItems:'center', gap:4 }}>
                      <MapPin size={10}/> {im.endereco||'—'}{im.cidade?', '+im.cidade:''}
                    </div>
                    <div style={{ display:'flex', gap:5, marginTop:4, flexWrap:'wrap' }}>
                      {im.areaM2>0 && <span style={{ fontSize:10, color:'#8b5cf6', fontWeight:600 }}>{im.areaM2}m²</span>}
                      {(im.pagamento||[]).map(p=>(
                        <span key={p} style={{ fontSize:9, background:'#f1f5f9', color:'#475569', padding:'1px 6px', borderRadius:10, fontWeight:600 }}>
                          {p==='aVista'?'À Vista':p==='financiado'?'Financ.':'Hipot.'}
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

                  {/* Ações */}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                    {im.urlLote && (
                      isPago
                        ? <a href={im.urlLote} target="_blank" rel="noopener noreferrer"
                            style={{ padding:'5px 8px', background:'#f1f5f9', color:'#475569', border:'1px solid #e2e8f0', borderRadius:6, fontSize:11, fontWeight:600, textDecoration:'none', display:'flex', alignItems:'center', gap:4 }}>
                            <ExternalLink size={11}/> Site
                          </a>
                        : <span title="Disponível no plano Analista"
                            style={{ padding:'5px 8px', background:'#f8fafc', color:'#cbd5e1', border:'1px solid #e2e8f0', borderRadius:6, fontSize:11, fontWeight:600, display:'flex', alignItems:'center', gap:4, cursor:'not-allowed' }}>
                            🔒 Site
                          </span>
                    )}
                    {isPago
                      ? <button onClick={()=>irParaAnalise(im)}
                          style={{ padding:'5px 10px', background:'#2563eb', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
                          📊 Analisar
                        </button>
                      : <span title="Disponível no plano Analista"
                          style={{ padding:'5px 10px', background:'#f8fafc', color:'#cbd5e1', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'not-allowed', whiteSpace:'nowrap' }}>
                          🔒 Analisar
                        </span>
                    }
                    {plano === 'gestor'
                      ? <button onClick={()=>marcarArrematado(im)}
                          style={{ padding:'5px 10px', background:'#10b981', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', whiteSpace:'nowrap' }}>
                          ✓ Arrematado
                        </button>
                      : null
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
        @media (max-width: 768px) {
          div[style*="280px 1fr"] { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
