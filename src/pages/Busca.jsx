import React, { useState, useEffect, useRef, useCallback } from 'react';
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

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

const ESTADOS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];


const inp = { width:'100%', padding:'9px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, background:'white', color:'#111111', boxSizing:'border-box' };
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

// Carrega imagem apenas quando o elemento entra na viewport
function LazyImage({ src, alt, style }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '100px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ ...style, background:'#f1f5f9', overflow:'hidden', flexShrink:0 }}>
      {visible && src && (
        <img src={src} alt={alt} loading="lazy"
          style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
          onError={e => { e.currentTarget.style.display = 'none'; }}
        />
      )}
    </div>
  );
}


const PLANO_LABELS = {
  explorador: 'Explorador', top1: 'Investidor', top2: 'Investidor Pro',
  assessorado: 'Assessorado', clube: 'Clube de Negócios',
};

const COR_TIPO = {
  apartamento: '#0D63DB', casa: '#059669', terreno: '#d97706',
  comercial: '#7c3aed', sala: '#7c3aed', galpao: '#dc2626',
  rural: '#065f46', vaga: '#64748b', imovel: '#111111',
};

function svgPin(cor) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="33" viewBox="0 0 24 36">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${cor}" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="5" fill="white"/>
    </svg>`
  )}`;
}

function MapaEmbutido({ filtros, resultados, nav }) {
  const mapContainerRef = useRef(null);
  const leafletRef = useRef(null);
  const markersRef = useRef(null);
  const [imoveisMapa, setImoveisMapa] = React.useState([]);

  // Carrega imóveis com coordenadas usando os filtros ativos
  useEffect(() => {
    async function carregar() {
      let q = supabase
        .from('imoveis_leilao')
        .select('id, titulo, cidade, estado, tipo, valor_minimo, latitude, longitude, link_foto')
        .eq('ativo', true)
        .not('latitude', 'is', null)
        .neq('latitude', 0)
        .limit(2000);
      if (filtros.tipo) q = q.eq('tipo', filtros.tipo);
      if (filtros.estado) q = q.eq('estado', filtros.estado);
      if (filtros.cidades?.length) q = q.in('cidade', filtros.cidades);
      if (filtros.valorMin) q = q.gte('valor_minimo', filtros.valorMin);
      if (filtros.valorMax) q = q.lte('valor_minimo', filtros.valorMax);
      const { data } = await q;
      setImoveisMapa(data || []);
    }
    carregar();
  }, [filtros]);

  // Inicializa mapa
  useEffect(() => {
    if (!mapContainerRef.current || leafletRef.current) return;
    import('leaflet').then(L => {
      delete L.Icon.Default.prototype._getIconUrl;
      leafletRef.current = L.map(mapContainerRef.current, { center: [-15.8, -47.9], zoom: 5 });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', maxZoom: 18,
      }).addTo(leafletRef.current);
      markersRef.current = L.layerGroup().addTo(leafletRef.current);
    });
    return () => { if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null; } };
  }, []);

  // Atualiza pins
  useEffect(() => {
    if (!leafletRef.current || !markersRef.current) return;
    import('leaflet').then(L => {
      markersRef.current.clearLayers();
      imoveisMapa.forEach(im => {
        if (!im.latitude || !im.longitude) return;
        const cor = COR_TIPO[im.tipo] || '#111111';
        const icon = L.icon({ iconUrl: svgPin(cor), iconSize: [22, 33], iconAnchor: [11, 33], popupAnchor: [0, -33] });
        const fmt = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
        const marker = L.marker([im.latitude, im.longitude], { icon });
        marker.bindPopup(`
          <div style="font-family:Inter,sans-serif;min-width:180px">
            ${im.link_foto ? `<img src="${im.link_foto}" style="width:100%;height:90px;object-fit:cover;border-radius:6px;margin-bottom:8px"/>` : ''}
            <div style="font-weight:700;font-size:12px;color:#111;margin-bottom:3px">${im.titulo || 'Imóvel'}</div>
            <div style="font-size:11px;color:#64748b;margin-bottom:5px">${im.cidade} — ${im.estado}</div>
            <div style="font-size:13px;font-weight:800;color:#0D63DB;margin-bottom:8px">${fmt(im.valor_minimo)}</div>
            <button onclick="window.location.hash='/imovel/${im.id}'" style="width:100%;padding:5px;background:#0D63DB;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:700;font-size:11px">Ver detalhes →</button>
          </div>
        `);
        markersRef.current.addLayer(marker);
      });
    });
  }, [imoveisMapa]);

  const fmt = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';

  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0', height: 'calc(100vh - 220px)', minHeight: 400, position: 'relative' }}>
      <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
      {imoveisMapa.length === 0 && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'white', padding: '6px 16px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontSize: 12, color: '#64748b' }}>
          Carregando imóveis no mapa…
        </div>
      )}
      {imoveisMapa.length > 0 && (
        <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000, background: 'white', padding: '5px 14px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontSize: 12, fontWeight: 700, color: '#0D63DB' }}>
          {imoveisMapa.length} imóveis com localização
        </div>
      )}
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
    </div>
  );
}

export default function Busca() {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { role, user } = useAuth();
  const plano = role || 'explorador';
  const canSite    = user && ROLES_SITE.includes(role);
  const canAnalise = user && ROLES_ANALISE.includes(role);
  const [analisesBonus, setAnalisesBonus] = useState(null);

  useEffect(() => {
    if (role !== 'explorador' || !user?.id) return;
    supabase.from('perfis').select('analises_bonus').eq('id', user.id).single()
      .then(({ data }) => { if (data) setAnalisesBonus(data.analises_bonus || 0); });
  }, [role, user?.id]);
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
  const POR_PAGINA = 20;

  // Radius search state
  const [raioKmAtivo, setRaioKmAtivo] = useState(50);
  const [raioAtivo, setRaioAtivo] = useState(false);
  const [centroRaio, setCentroRaio] = useState(null); // { lat, lng, label }
  const [distancias, setDistancias] = useState({}); // id -> km
  const [vista, setVista] = useState('lista'); // 'lista' | 'mapa'
  const [imoveisMapa, setImoveisMapa] = useState([]);
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);

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

  const limparFiltros = () => {
    setFiltros(FILTROS_INICIAL);
    setBuscaCidade('');
    setSelecionados([]);
    setPagina(1);
    setRaioAtivo(false);
    setCentroRaio(null);
    setDistancias({});
    setGeocodingErro('');
  };

  const geocodificarCidade = async (cidade, estado) => {
    if (!cidade) return null;
    const query = estado ? `${cidade}, ${estado}, Brasil` : `${cidade}, Brasil`;
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`;
      const res = await fetch(url, { headers: { 'User-Agent': 'BidPro-Brasil/1.0' } });
      const data = await res.json();
      if (data && data.length > 0) {
        const centro = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), label: cidade };
        setCentroRaio(centro);
        return centro;
      }
    } catch {}
    setCentroRaio(null);
    return null;
  };

  // Busca coordenadas de todas as cidades do estado via Overpass API (cached 30 dias)
  const getCidadesEstadoComCoords = async (uf) => {
    const CACHE_KEY = `bidpro_overpass_v1_${uf}`;
    const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.data;
    } catch {}

    const query = `[out:json][timeout:30];rel["ISO3166-2"="BR-${uf}"];map_to_area->.s;node["place"~"city|town|village"](area.s);out center;`;
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: query,
      });
      const json = await res.json();
      const cidades = (json.elements || [])
        .filter(e => e.tags?.name)
        .map(e => ({ nome: e.tags.name, lat: e.lat, lng: e.lon }));
      try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: cidades })); } catch {}
      return cidades;
    } catch { return []; }
  };

  const toggleRaio = () => {
    const next = !raioAtivo;
    setRaioAtivo(next);
    if (next) {
      if (filtros.cidades.length > 1) up('cidades', [filtros.cidades[0]]);
      const cidade = filtros.cidades[0] || filtros.cidades[0];
      if (cidade) geocodificarCidade(cidade, filtros.estado);
    } else {
      setCentroRaio(null); setDistancias({});
    }
  };

  async function salvarFiltroAtual() {
    if (!nomeFiltro.trim() || !user?.id) return;
    const { data, error } = await supabase.from('filtros_salvos').insert({
      user_id: user.id, nome: nomeFiltro.trim(), filtros,
    }).select().single();
    if (error) { alert('Erro ao salvar filtro. Tente novamente.'); return; }
    if (data) setFiltrosSalvos(p => [data, ...p]);
    setNomeFiltro(''); setShowSalvarModal(false);
  }

  async function deletarFiltro(id) {
    await supabase.from('filtros_salvos').delete().eq('id', id);
    setFiltrosSalvos(p => p.filter(f => f.id !== id));
  }

  const buscarPagina = async (paginaAlvo, filtrosAtivos, sortAtivo, centro = centroRaio, raioAtivoBusca = raioAtivo, raioKmBusca = raioKmAtivo, cidadesRaio = null) => {
    setErro(''); setLoading(true); setBuscaFeita(true); setResultados([]);

    const buildQuery = (base) => {
      let q = base.eq('ativo', true);
      if (filtrosAtivos.estado) q = q.eq('estado', filtrosAtivos.estado);
      // cidadesRaio: list of cities within the radius (from Overpass geocoding)
      const cidadesFiltro = cidadesRaio || (filtrosAtivos.cidades?.length > 0 ? filtrosAtivos.cidades : null);
      if (cidadesFiltro?.length > 0) {
        const orParts = cidadesFiltro.map(c => `cidade.ilike.${c}`).join(',');
        q = q.or(orParts);
      }
      if (filtrosAtivos.tipo) q = q.in('tipo', [filtrosAtivos.tipo, 'imovel']);
      if (filtrosAtivos.modalidade) q = q.eq('modalidade', filtrosAtivos.modalidade);
      if (filtrosAtivos.valorMin) q = q.gte('valor_minimo', Number(String(filtrosAtivos.valorMin).replace(/\D/g, '')));
      if (filtrosAtivos.valorMax) q = q.lte('valor_minimo', Number(String(filtrosAtivos.valorMax).replace(/\D/g, '')));
      if (filtrosAtivos.pagamento?.length > 0) {
        const dbVals = filtrosAtivos.pagamento.flatMap(v => PAGAMENTO_DB[v] || [v]);
        const orParts = dbVals.map(v => `forma_pagamento.ilike.%${v}%`).join(',');
        q = q.or(orParts);
      }
      return q;
    };

    const [coluna, dir] = sortAtivo === 'desconto_desc' ? ['desconto_percentual', false]
      : sortAtivo === 'desconto_asc' ? ['desconto_percentual', true]
      : sortAtivo === 'valor_asc'    ? ['valor_minimo', true]
      : ['valor_minimo', false];

    try {
      let dbData, dbError;

      if (raioAtivoBusca && centro && cidadesRaio) {
        // City-based radius: buildQuery already applies cidadesRaio as the city filter
        const { data, error } = await buildQuery(supabase.from('imoveis_leilao').select('*'))
          .order(coluna, { ascending: dir, nullsFirst: false })
          .limit(5000);
        dbData = data;
        dbError = error;
      } else {
        const offset = (paginaAlvo - 1) * POR_PAGINA;
        const [{ count }, { data, error }] = await Promise.all([
          buildQuery(supabase.from('imoveis_leilao').select('*', { count: 'exact', head: true })),
          buildQuery(supabase.from('imoveis_leilao').select('*'))
            .order(coluna, { ascending: dir, nullsFirst: false })
            .range(offset, offset + POR_PAGINA - 1),
        ]);
        dbData = data;
        dbError = error;
        setTotalResultados(count || 0);
      }

      let mapeados = (!dbError && dbData) ? dbData.map(im => ({
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
        fonteId: im.fonte_id,
        numeroEdital: im.numero_edital,
        numeroMatricula: im.numero_matricula,
        numeroProcesso: im.numero_processo,
        latitude: im.latitude,
        longitude: im.longitude,
      })) : [];

      // Radius: all results are already city-filtered; add distance badge for those with coords
      if (raioAtivoBusca && centro && cidadesRaio) {
        const novasDistancias = {};
        mapeados.forEach(im => {
          if (im.latitude != null && im.longitude != null) {
            novasDistancias[im.id] = Math.round(haversine(centro.lat, centro.lng, Number(im.latitude), Number(im.longitude)));
          }
        });
        setDistancias(novasDistancias);
        setTotalResultados(mapeados.length);
        const offset = (paginaAlvo - 1) * POR_PAGINA;
        mapeados = mapeados.slice(offset, offset + POR_PAGINA);
      } else {
        setDistancias({});
      }

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

  const buscar = async () => {
    if (!filtros.estado) { setErro('Selecione um estado para buscar.'); return; }
    if (raioAtivo && !filtros.cidades.length) {
      setErro('Selecione uma cidade para usar a busca por raio.');
      return;
    }
    setErro('');
    setPagina(1);
    saveBuscaRecente({ ...filtros, cidade: filtros.cidades.join(', ') });

    let centro = centroRaio;
    let cidadesNaArea = null;

    if (raioAtivo && filtros.cidades[0]) {
      setLoading(true);
      // 1. Geocodifica cidade centro
      centro = await geocodificarCidade(filtros.cidades[0], filtros.estado);
      if (centro) {
        // 2. Busca todas as cidades do estado com coordenadas (Overpass, cached)
        const todasCidades = await getCidadesEstadoComCoords(filtros.estado);
        // 3. Filtra as que estão dentro do raio
        cidadesNaArea = todasCidades
          .filter(c => haversine(centro.lat, centro.lng, c.lat, c.lng) <= raioKmAtivo)
          .map(c => c.nome);
        // Garante que a cidade centro está incluída
        if (!cidadesNaArea.some(c => c.toLowerCase() === filtros.cidades[0].toLowerCase())) {
          cidadesNaArea.push(filtros.cidades[0]);
        }
      }
    }

    buscarPagina(1, filtros, sortBy, centro, raioAtivo, raioKmAtivo, cidadesNaArea);
  };

  const imgUrlCaixa = (im) => {
    if (im.fonte !== 'CEF') return null;
    const id = (im.fonte_id || '').replace(/^cef_/, '');
    return id ? `/api/img-caixa?id=${encodeURIComponent(id)}` : null;
  };

  const irParaAnalise = (im) => {
    nav('/caso', { state: { imovel: im } });
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
    <div style={{ position:'relative' }}>
    {/* Badge fixo de análises bônus para explorador */}
    {role === 'explorador' && analisesBonus !== null && (
      <div style={{ position:'fixed', bottom: 80, left: '50%', transform:'translateX(-50%)', zIndex:1000, background: analisesBonus > 0 ? '#0D63DB' : '#dc2626', color:'white', borderRadius:999, padding:'8px 20px', fontSize:13, fontWeight:700, boxShadow:'0 4px 20px rgba(0,0,0,0.25)', display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap' }}>
        {analisesBonus > 0 ? `🎁 ${analisesBonus} análise${analisesBonus !== 1 ? 's' : ''} bônus disponível${analisesBonus !== 1 ? 'is' : ''}` : '🔒 Análises bônus esgotadas'}
      </div>
    )}
    <div style={{ maxWidth:1280, margin:'0 auto', padding: isMobile ? '16px 12px' : '24px 20px', display:'grid', gridTemplateColumns: isMobile ? '1fr' : '280px 1fr', gap:20, alignItems:'start' }}>

      {/* SIDEBAR */}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

        {/* Filtros */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <button onClick={()=>setShowFiltros(!showFiltros)}
            style={{ width:'100%', padding:'13px 16px', background:'#111111', color:'white', border:'none', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', fontWeight:700, fontSize:13 }}>
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
                <label style={lbl}>Estado (UF) <span style={{ color:'#ef4444' }}>*</span></label>
                <select value={filtros.estado} onChange={e=>{ up('estado',e.target.value); up('cidades',[]); setBuscaCidade(''); setErro(''); }} style={{ ...inp, borderColor: !filtros.estado ? '#fca5a5' : '#e2e8f0' }}>
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
                      <span key={c} style={{ display:'flex', alignItems:'center', gap:3, background:'#dbeafe', color:'#084BA6', fontSize:11, fontWeight:700, padding:'3px 8px', borderRadius:20 }}>
                        {c}
                        <button onClick={()=>up('cidades', filtros.cidades.filter(x=>x!==c))}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#084BA6', padding:0, display:'flex' }}>
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
                      if (cidade) {
                        const novas = raioAtivo ? [cidade] : [...filtros.cidades, cidade];
                        up('cidades', novas); setBuscaCidade(''); setDropdownIndex(-1);
                        if (raioAtivo) geocodificarCidade(cidade, filtros.estado);
                      }
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
                              style={{ width:'100%', padding:'7px 12px', border:'none', background: idx === dropdownIndex ? '#eff6ff' : 'none', textAlign:'left', cursor:'pointer', fontSize:12, color: idx === dropdownIndex ? '#084BA6' : '#334155', borderBottom:'1px solid #f1f5f9', fontWeight: idx === dropdownIndex ? 700 : 400 }}
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
              {/* Radius search — toggle sempre visível */}
              <div style={{ borderTop:'1px solid #f1f5f9', paddingTop:12 }}>
                <label style={{ ...lbl, display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ display:'flex', alignItems:'center', gap:5 }}><MapPin size={11}/> Buscar por raio</span>
                  <button
                    onClick={toggleRaio}
                    style={{ background: raioAtivo ? '#0D63DB' : '#e2e8f0', border:'none', borderRadius:20, width:36, height:20, cursor:'pointer', position:'relative', transition:'background 0.2s', flexShrink:0 }}>
                    <span style={{ position:'absolute', top:2, left: raioAtivo ? 18 : 2, width:16, height:16, borderRadius:'50%', background:'white', transition:'left 0.2s', display:'block' }}/>
                  </button>
                </label>
                {raioAtivo && (
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {filtros.cidades.length > 0 ? (
                      <div style={{ fontSize:10, color:'#16a34a', background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:6, padding:'6px 8px', display:'flex', alignItems:'center', gap:4 }}>
                        <MapPin size={10}/> Centro: <strong>{filtros.cidades[0]}{filtros.estado ? ` — ${filtros.estado}` : ''}</strong>
                      </div>
                    ) : (
                      <div style={{ fontSize:10, color:'#92400e', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:6, padding:'6px 8px' }}>
                        Selecione uma cidade acima para usar o raio.
                      </div>
                    )}
                    <div>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:5 }}>
                        <span style={{ fontSize:10, fontWeight:700, color:'#475569', textTransform:'uppercase', letterSpacing:0.5 }}>Raio</span>
                        <span style={{ fontSize:12, fontWeight:800, color:'#0D63DB' }}>{raioKmAtivo} km</span>
                      </div>
                      <input
                        type="range"
                        min={10} max={200} step={1}
                        value={raioKmAtivo}
                        onChange={e => setRaioKmAtivo(Number(e.target.value))}
                        style={{ width:'100%', accentColor:'#0D63DB', cursor:'pointer' }}
                      />
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'#94a3b8', marginTop:2 }}>
                        <span>10 km</span>
                        <span>50</span>
                        <span>100</span>
                        <span>200 km</span>
                      </div>
                    </div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {[10, 25, 50, 100, 200].map(r => (
                        <button key={r} onClick={() => setRaioKmAtivo(r)}
                          style={{ padding:'4px 10px', border:`1px solid ${raioKmAtivo===r?'#0D63DB':'#e2e8f0'}`, borderRadius:20, fontSize:10, fontWeight:700, cursor:'pointer', background: raioKmAtivo===r?'#eff6ff':'white', color: raioKmAtivo===r?'#084BA6':'#64748b', transition:'all 0.1s' }}>
                          {r} km
                        </button>
                      ))}
                    </div>
                    <div style={{ fontSize:9, color:'#94a3b8', lineHeight:1.4 }}>
                      Imóveis sem localização cadastrada serão excluídos dos resultados.
                    </div>
                  </div>
                )}
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
              {!filtros.estado && (
                <div style={{ fontSize:11, color:'#92400e', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:7, padding:'7px 10px', fontWeight:600 }}>
                  Selecione um estado para habilitar a busca
                </div>
              )}
              <button onClick={buscar} disabled={loading || !filtros.estado}
                style={{ width:'100%', padding:'11px', background: filtros.estado ? '#0D63DB' : '#94a3b8', color:'white', border:'none', borderRadius:8, fontWeight:800, fontSize:13, cursor: filtros.estado ? 'pointer' : 'not-allowed', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
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
              <span key={filtro.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#084BA6', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
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
                <button onClick={salvarFiltroAtual} style={{ padding: '4px 10px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Salvar</button>
                <button onClick={() => { setShowSalvarModal(false); setNomeFiltro(''); }} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 14 }}>×</button>
              </div>
            )}
          </div>
        )}

        {/* Header de resultados */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', padding:'14px 18px', marginBottom:12 }}>
          {/* Linha 1: título + visualização */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:10, marginBottom: buscaFeita && !loading ? 10 : 0 }}>
            <div>
              <h1 style={{ margin:0, fontSize:18, fontWeight:900, color:'#111111' }}>Busca de Imóveis em Leilão</h1>
              <p style={{ margin:'4px 0 0', fontSize:12, color:'#64748b' }}>
                {loading ? 'Buscando leilões...'
                  : buscaFeita ? `${totalResultados} imóvel(is) encontrado(s) · página ${pagina} de ${totalPaginas}`
                  : 'Configure os filtros e clique em Buscar Leilões'}
              </p>
            </div>
            {/* Alternador Lista / Mapa */}
            <div style={{ display:'flex', background:'#f1f5f9', borderRadius:10, padding:3, gap:2 }}>
              <button onClick={() => setVista('lista')}
                style={{ padding:'6px 16px', borderRadius:8, border:'none', fontWeight:700, fontSize:12, cursor:'pointer', background: vista==='lista' ? 'white' : 'transparent', color: vista==='lista' ? '#111111' : '#64748b', boxShadow: vista==='lista' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                ☰ Lista
              </button>
              <button onClick={() => setVista('mapa')}
                style={{ padding:'6px 16px', borderRadius:8, border:'none', fontWeight:700, fontSize:12, cursor:'pointer', background: vista==='mapa' ? 'white' : 'transparent', color: vista==='mapa' ? '#111111' : '#64748b', boxShadow: vista==='mapa' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                🗺️ Mapa
              </button>
            </div>
          </div>
          {/* Linha 2: controles (só quando há resultados) */}
          {buscaFeita && !loading && (
            <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', paddingTop:10, borderTop:'1px solid #f1f5f9' }}>
              <select value={sortBy} onChange={e=>{ setSortBy(e.target.value); setPagina(1); buscarPagina(1, filtros, e.target.value, centroRaio, raioAtivo, raioKmAtivo); }}
                style={{ padding:'7px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:600, color:'#334155', background:'white', cursor:'pointer' }}>
                <option value="desconto_desc">Maior desconto primeiro</option>
                <option value="desconto_asc">Menor desconto primeiro</option>
                <option value="valor_asc">Menor valor primeiro</option>
                <option value="valor_desc">Maior valor primeiro</option>
              </select>
              {selecionados.length>0 && (
                <button onClick={()=>irParaAnalise(resultados.find(r=>r.id===selecionados[0]))}
                  style={{ padding:'7px 14px', background:'#10b981', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                  <ArrowRight size={13}/> Analisar selecionado
                </button>
              )}
              <button onClick={() => buscarPagina(pagina, filtros, sortBy, centroRaio, raioAtivo, raioKmAtivo)}
                style={{ padding:'7px 12px', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:700, color:'#475569', cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                <RefreshCw size={12}/> Atualizar
              </button>
              {loading && <Loader2 size={18} color="#0D63DB" style={{animation:'spin 1s linear infinite'}}/>}
            </div>
          )}
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

        {/* Vista Mapa embutido */}
        {vista === 'mapa' && (
          <MapaEmbutido filtros={filtros} resultados={resultadosFiltrados} nav={nav} />
        )}

        {/* Resultados em cards */}
        {vista === 'lista' && !loading && resultadosFiltrados.length>0 && (
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap:12 }}>
            {resultadosPagina.map((im)=>{
              const desc = desconto(im);
              const modalColor = im.modalidade==='judicial'||im.modalidade==='primeiro_leilao' ? { bg:'#fef3c7', color:'#92400e' } : { bg:'#dbeafe', color:'#084BA6' };
              const imgSrc = im.foto || imgUrlCaixa({ ...im, fonte_id: im.fonteId });

              return (
                <div key={im.id}
                  style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden', display:'flex', flexDirection:'column', cursor:'pointer', transition:'box-shadow 0.15s' }}
                  onClick={e => { if (e.target.closest('a,button,input')) return; nav('/imovel/'+im.id, { state: { imovel: im } }); }}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.1)'}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>

                  {/* Foto */}
                  <div style={{ width:'100%', height: isMobile ? 180 : 150, background:'#f1f5f9', position:'relative', overflow:'hidden' }}>
                    {imgSrc
                      ? <LazyImage src={imgSrc} alt={im.titulo} style={{ width:'100%', height:'100%' }}/>
                      : <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, color:'#cbd5e1' }}>
                          <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 21V6.75A2.25 2.25 0 016 4.5h12A2.25 2.25 0 0120.25 6.75V21M9 21v-6h6v6"/></svg>
                          <span style={{ fontSize:9, color:'#94a3b8', fontWeight:600 }}>Sem foto</span>
                        </div>
                    }
                    {desc>0 && (
                      <div style={{ position:'absolute', top:8, right:8, background: desc>=40?'#16a34a':desc>=20?'#d97706':'#dc2626', color:'white', fontWeight:900, fontSize:13, padding:'3px 8px', borderRadius:8 }}>
                        -{desc}%
                      </div>
                    )}
                    {im.fonte==='CEF' && (
                      <div style={{ position:'absolute', top:8, left:8, background:'#c2410c', color:'white', fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:8 }}>CAIXA</div>
                    )}
                  </div>

                  {/* Conteúdo */}
                  <div style={{ flex:1, padding:'10px 12px', display:'flex', flexDirection:'column', gap:5 }}>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {im.tipo && <span style={{ fontSize:9, fontWeight:700, background:'#f1f5f9', color:'#475569', padding:'1px 6px', borderRadius:8 }}>{TIPO_LABEL[im.tipo]||im.tipo}</span>}
                      <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:8, background:modalColor.bg, color:modalColor.color }}>
                        {im.modalidade==='judicial'?'Judicial':'Extrajudicial'}
                      </span>
                      {im.fracionado && <span style={{ fontSize:9, fontWeight:800, background:'#fef3c7', color:'#92400e', padding:'1px 6px', borderRadius:8 }}>⚠ Fração</span>}
                    </div>

                    <div style={{ fontWeight:700, color:'#111111', fontSize: isMobile ? 14 : 12, lineHeight:1.3, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                      {im.titulo||im.nome}
                    </div>

                    <div style={{ fontSize:10, color:'#64748b', display:'flex', alignItems:'center', gap:3, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                      <MapPin size={9} style={{ flexShrink:0 }}/>{[im.bairro, im.cidade, im.estado].filter(Boolean).join(', ')||'—'}
                      {distancias[im.id] != null && (
                        <span style={{ flexShrink:0, fontSize:9, fontWeight:700, background:'#eff6ff', color:'#084BA6', borderRadius:8, padding:'1px 6px' }}>
                          {distancias[im.id]} km
                        </span>
                      )}
                    </div>

                    <div style={{ marginTop:2 }}>
                      <div style={{ fontSize:9, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:0.4 }}>Lance Mín.</div>
                      <div style={{ fontWeight:900, color:'#111111', fontSize: isMobile ? 18 : 15 }}>{fmtBRL(im.valorMinimo)}</div>
                      {im.valorAvaliacao>0 && (
                        <div style={{ fontSize:10, color:'#64748b' }}>Aval. {fmtBRL(im.valorAvaliacao)}</div>
                      )}
                    </div>

                    <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
                      {(im.pagamento||[]).map(p=>(
                        <span key={p} style={{ fontSize:9, background:'#f1f5f9', color:'#475569', padding:'1px 6px', borderRadius:8, fontWeight:600 }}>
                          {p==='a_vista'||p==='aVista'?'À Vista':p==='financiado'?'Financiado':'Hipotecado'}
                        </span>
                      ))}
                      {im.areaM2>0 && <span style={{ fontSize:9, color:'#8b5cf6', fontWeight:700 }}>{im.areaM2}m²</span>}
                      <span style={{ fontSize:9, color:'#94a3b8' }}>{fmtData(im.dataLeilao, im.modalidade)}</span>
                    </div>
                  </div>

                  {/* Botões */}
                  <div style={{ display:'flex', gap:6, padding:'8px 12px', borderTop:'1px solid #f1f5f9', background:'#fafafa' }}>
                    <button onClick={e=>{ e.stopPropagation(); nav('/imovel/'+im.id, { state: { imovel: im } }); }}
                      style={{ flex:1, padding:'8px 4px', background:'white', color:'#334155', border:'1px solid #e2e8f0', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                      Ver →
                    </button>
                    {canAnalise
                      ? <button onClick={e=>{ e.stopPropagation(); irParaAnalise(im); }}
                          style={{ flex:2, padding:'8px 4px', background:'#0D63DB', color:'white', border:'none', borderRadius:8, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                          📊 Analisar
                        </button>
                      : <span style={{ flex:2, padding:'8px 4px', background:'#f8fafc', color:'#cbd5e1', border:'1px solid #e2e8f0', borderRadius:8, fontSize:11, fontWeight:700, cursor:'not-allowed', display:'flex', alignItems:'center', justifyContent:'center' }}>
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
            <button onClick={()=>{ const p=Math.max(1,pagina-1); setPagina(p); buscarPagina(p, filtros, sortBy, centroRaio, raioAtivo, raioKmAtivo); }} disabled={pagina===1}
              style={{ padding:'6px 14px', border:'1px solid #e2e8f0', borderRadius:7, fontWeight:700, fontSize:12, cursor:pagina===1?'not-allowed':'pointer', background:pagina===1?'#f8fafc':'white', color:pagina===1?'#cbd5e1':'#334155' }}>
              ← Anterior
            </button>
            {Array.from({length:totalPaginas},(_,i)=>i+1).filter(n=>n===1||n===totalPaginas||Math.abs(n-pagina)<=2).reduce((acc,n,idx,arr)=>{
              if(idx>0&&n-arr[idx-1]>1) acc.push('…');
              acc.push(n); return acc;
            },[]).map((n,i)=>
              n==='…' ? <span key={'e'+i} style={{color:'#94a3b8',fontSize:12}}>…</span>
              : <button key={n} onClick={()=>{ setPagina(n); buscarPagina(n, filtros, sortBy, centroRaio, raioAtivo, raioKmAtivo); }}
                  style={{ padding:'6px 11px', border:`1px solid ${n===pagina?'#0D63DB':'#e2e8f0'}`, borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer', background:n===pagina?'#0D63DB':'white', color:n===pagina?'white':'#334155' }}>
                  {n}
                </button>
            )}
            <button onClick={()=>{ const p=Math.min(totalPaginas,pagina+1); setPagina(p); buscarPagina(p, filtros, sortBy, centroRaio, raioAtivo, raioKmAtivo); }} disabled={pagina===totalPaginas}
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
    </div>
  );
}
