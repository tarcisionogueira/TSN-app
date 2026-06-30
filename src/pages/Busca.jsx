import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Loader2, Filter, ChevronDown, ChevronUp,
  ExternalLink, RefreshCw, MapPin,
  ArrowRight, X,
} from 'lucide-react';
import { saveBuscaRecente, loadImoveis, saveImoveis, generateId } from '../utils/storage';
import { buscarCidadesEstado, RAIOS_KM } from '../data/cidades';
import { PAGAMENTO_LABEL, PAGAMENTO_FILTRO_DB, pagamentoParaCanon, pagamentoBadge } from '../data/pagamento';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';
import { useIsMobile } from '../utils/useIsMobile';
import ScoreRisco from '../components/ScoreRisco';

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
// src pode ser uma string OU um array de candidatos (em ordem de preferência).
// No onError de um candidato, avançamos para o próximo (igual ao detalhe do
// imóvel: hotlink DIRETO primeiro, proxy só como fallback). Só mostramos o
// placeholder "Sem foto" quando TODOS os candidatos falharem.
function LazyImage({ src, alt, style }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const cands = Array.isArray(src) ? src.filter(Boolean) : (src ? [src] : []);
  const [idx, setIdx] = useState(0);
  useEffect(() => { setIdx(0); }, [Array.isArray(src) ? src.join('|') : src]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); obs.disconnect(); }
    }, { rootMargin: '100px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const atual = cands[idx] || null;
  return (
    <div ref={ref} style={{ ...style, background:'#f1f5f9', overflow:'hidden', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
      {visible && atual
        ? <img src={atual} alt={alt} loading="lazy"
            style={{ width:'100%', height:'100%', objectFit:'cover', display:'block' }}
            onError={() => setIdx(i => i + 1)}
          />
        : <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, color:'#cbd5e1', width:'100%', height:'100%' }}>
            <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 21V6.75A2.25 2.25 0 016 4.5h12A2.25 2.25 0 0120.25 6.75V21M9 21v-6h6v6"/></svg>
            <span style={{ fontSize:9, color:'#94a3b8', fontWeight:600 }}>Sem foto</span>
          </div>
      }
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

// Normaliza cidade IGUAL ao cidade_norm do banco: minúscula, sem acento/cedilha e
// sem pontuação/espaços. Assim "Santana de Parnaíba" = "Santana de Parnaiba",
// "Embu-Guaçu" = "Embu Guacu" = "embuguacu", "Sant'Ana" = "Santana", etc.
const normCidade = (c) => (c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// Candidatos de foto para o card da busca, em ordem de preferência. Igual ao
// detalhe do imóvel: o HOTLINK DIRETO funciona no navegador do usuário (IP
// residencial), enquanto o /api/img-proxy roda na Vercel e é bloqueado por
// vários hosts de leiloeiro (ex.: ms.sbwebservices.net → 403). Por isso a foto
// aparecia no detalhe mas não no card. Tentamos: 1) foto direta; 2) padrão Caixa
// por id; 3) proxy (fallback p/ fontes que bloqueiam hotlink por referer).
const fotoCandidatos = (im) => {
  const foto = im.foto;
  const isCef = im.fonte === 'CEF' || im.fonte === 'caixa';
  const caixaUrl = isCef && im.fonteId
    ? `https://venda-imoveis.caixa.gov.br/fotos/F${String(im.fonteId).replace(/^(caixa_|cef_)/, '')}21.jpg`
    : null;
  // Já hospedado por nós (supabase) ou caminho local: usa direto, sem fallback.
  if (foto && (foto.includes('supabase.co') || foto.startsWith('/'))) return [foto];
  const cands = [];
  if (foto && /^https?:\/\//.test(foto)) cands.push(foto);                 // 1) hotlink direto
  if (caixaUrl) cands.push(caixaUrl);                                       // 2) padrão de foto da Caixa
  if (!isCef && foto && /^https?:\/\//.test(foto)) cands.push(`/api/img-proxy?url=${encodeURIComponent(foto)}`); // 3) proxy
  return cands;
};

function MapaEmbutido({ filtros, resultados, nav, centroRaio, raioKm, raioAtivo, totalLista, visivel, height }) {
  const mapContainerRef = useRef(null);
  const leafletRef = useRef(null);
  const markersRef = useRef(null);
  const circlesRef = useRef(null);
  const resizeObsRef = useRef(null);
  const [imoveisMapa, setImoveisMapa] = React.useState([]);
  const [mapReady, setMapReady] = React.useState(false);
  const [carregando, setCarregando] = React.useState(true);

  const [semCoordenadas, setSemCoordenadas] = React.useState(false);

  useEffect(() => {
    async function carregar() {
      // Sem snapshot de filtros ainda (montagem antes da 1ª busca): não carrega
      // nada — evita puxar pins de todo o Brasil e crash por filtros nulos.
      if (!filtros) { setImoveisMapa([]); setCarregando(false); return; }
      setCarregando(true);
      setSemCoordenadas(false);

      // Query base com todos os filtros — sem restrição de coordenadas
      const aplicarFiltros = (base) => {
        let q = base.eq('ativo', true);
        if (filtros.estado) q = q.eq('estado', filtros.estado);
        if (filtros.tipos?.length) q = q.in('tipo', [...filtros.tipos, 'imovel']);
        if (filtros.modalidades?.length) q = q.in('modalidade', filtros.modalidades);
        if (filtros.valorMin) q = q.gte('valor_minimo', Number(String(filtros.valorMin).replace(/\D/g, '')));
        if (filtros.valorMax) q = q.lte('valor_minimo', Number(String(filtros.valorMax).replace(/\D/g, '')));
        // Cidades: OR entre cidades (único .or da query). Valores entre aspas para
        // suportar nomes com espaço/acento/parênteses sem quebrar o agrupamento.
        // No modo raio a cidade vira apenas o CENTRO — a área é definida pelo raio
        // (haversine abaixo), então não restringimos por cidade (igual à lista).
        if (!raioAtivo && filtros.cidades?.length) q = q.in('cidade_norm', filtros.cidades.map(normCidade));
        // Pagamento: igualdade exata (.in) nos valores canônicos. Combina várias
        // opções como união (Financiado + Hipotecado) sem encadear outro .or.
        if (filtros.pagamento?.length > 0) {
          const canon = pagamentoParaCanon(filtros.pagamento);
          if (canon.length) q = q.in('forma_pagamento', canon);
        }
        return q;
      };

      // Busca só imóveis com coordenadas (aparecem como pins)
      const { data } = await aplicarFiltros(
        supabase
          .from('imoveis_leilao')
          .select('id, titulo, cidade, estado, tipo, modalidade, valor_minimo, desconto_percentual, forma_pagamento, latitude, longitude, link_foto, geocod_nivel, fonte, fonte_id, area_m2, link_edital, link_matricula, score_juridico, score_financeiro')
          .not('latitude', 'is', null)
          .neq('latitude', 0)
          .limit(2000)
      );
      const comCoords = (data || []).filter(im => {
        if (!raioAtivo || !centroRaio || im.latitude == null || im.longitude == null || im.latitude === 0 || im.longitude === 0) return true;
        return haversine(centroRaio.lat, centroRaio.lng, Number(im.latitude), Number(im.longitude)) <= raioKm;
      });

      // Detecta caso onde há resultados na lista mas nenhum tem coordenadas
      if (comCoords.length === 0 && totalLista > 0) setSemCoordenadas(true);

      setImoveisMapa(comCoords);
      setCarregando(false);
    }
    carregar();
  }, [filtros, centroRaio, raioAtivo, raioKm, totalLista]);

  // Inicializa mapa
  useEffect(() => {
    if (!mapContainerRef.current || leafletRef.current) return;
    import('leaflet').then(async L => {
      // markercluster é PLUGIN: se falhar ao carregar/anexar, NÃO pode impedir o
      // mapa de ficar pronto (senão a centralização nunca roda → mapa no Brasil).
      try { await import('leaflet.markercluster'); } catch (e) { console.warn('[mapa] markercluster falhou', e); }
      delete L.Icon.Default.prototype._getIconUrl;
      // zoomControl no canto inferior direito: o topo-esquerdo é ocupado pelo
      // painel "Ver lista" (estilo Google) — evita os controles ficarem escondidos.
      leafletRef.current = L.map(mapContainerRef.current, { center: [-15.8, -47.9], zoom: 5, zoomControl: false });
      L.control.zoom({ position: 'bottomright' }).addTo(leafletRef.current);
      // CARTO basemaps (permite uso por apps; o tile.openstreetmap.org bloqueia
      // tráfego de aplicativo em produção -> mapa cinza/"falhado").
      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
        subdomains: 'abcd',
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 19,
      }).addTo(leafletRef.current);
      // Cluster agrupa os marcadores (evita travar com milhares de pins). Se o
      // plugin não estiver disponível, cai para um layerGroup simples — assim o
      // mapa SEMPRE fica pronto e centraliza, mesmo sem clusterização.
      try {
        markersRef.current = (typeof L.markerClusterGroup === 'function')
          ? L.markerClusterGroup({ maxClusterRadius: 55, showCoverageOnHover: false, chunkedLoading: true, disableClusteringAtZoom: 16, spiderfyOnMaxZoom: true, zoomToBoundsOnClick: true })
          : L.layerGroup();
      } catch (e) { console.warn('[mapa] markerClusterGroup falhou, usando layerGroup', e); markersRef.current = L.layerGroup(); }
      markersRef.current.addTo(leafletRef.current);
      circlesRef.current = L.layerGroup().addTo(leafletRef.current);
      // Corrige tiles incompletos quando o container foi montado enquanto estava oculto
      setTimeout(() => { if (leafletRef.current) leafletRef.current.invalidateSize(); }, 50);
      setTimeout(() => { if (leafletRef.current) leafletRef.current.invalidateSize(); }, 300);
      // ResizeObserver: recalcula o mapa sempre que o container muda de tamanho
      // (resolve Mapa+Lista, troca de aba e resize de janela de forma robusta)
      if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
        resizeObsRef.current = new ResizeObserver(() => {
          if (leafletRef.current) leafletRef.current.invalidateSize();
        });
        resizeObsRef.current.observe(mapContainerRef.current);
      }
      setMapReady(true);
    });
    return () => {
      if (resizeObsRef.current) { resizeObsRef.current.disconnect(); resizeObsRef.current = null; }
      if (leafletRef.current) { leafletRef.current.remove(); leafletRef.current = null; }
      setMapReady(false);
    };
  }, []);

  // Atualiza pins — depende de mapReady para garantir que o mapa está pronto
  useEffect(() => {
    if (!mapReady || !leafletRef.current || !markersRef.current) return;
    import('leaflet').then(L => {
      markersRef.current.clearLayers();
      if (circlesRef.current) circlesRef.current.clearLayers();
      imoveisMapa.forEach(im => {
        try {
        if (!im.latitude || !im.longitude) return;
        const cor = COR_TIPO[im.tipo] || '#111111';
        const icon = L.icon({ iconUrl: svgPin(cor), iconSize: [22, 33], iconAnchor: [11, 33], popupAnchor: [0, -33] });
        const fmt = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
        const marker = L.marker([im.latitude, im.longitude], { icon });
        const desc = im.desconto_percentual ? Number(im.desconto_percentual).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : null;
        const pgto = im.forma_pagamento;
        const pgtoLabel = pgto === 'financiado' ? 'Financiado' : pgto === 'hipotecado' ? 'Hipotecado' : pgto === 'a_vista' ? 'À Vista' : null;
        const pgtoColor = pgto === 'financiado' ? '#16a34a' : pgto === 'hipotecado' ? '#92400e' : '#475569';
        const pgtoBg = pgto === 'financiado' ? '#dcfce7' : pgto === 'hipotecado' ? '#fef3c7' : '#f1f5f9';

        // Precisão da geocodificação
        const nivel = im.geocod_nivel; // 'endereco' | 'rua' | 'bairro' | 'cidade' | null
        const isAproximado = nivel && nivel !== 'endereco';
        const nivelLabel = nivel === 'rua' ? '📍 Rua (±100m)' : nivel === 'bairro' ? '📍 Bairro (±500m)' : nivel === 'cidade' ? '🏙️ Cidade (±2km)' : null;
        const raioMetros = nivel === 'rua' ? 100 : nivel === 'bairro' ? 500 : nivel === 'cidade' ? 2000 : 0;

        const popupHTML = `
          <div style="font-family:Inter,sans-serif;min-width:190px;max-width:220px">
            ${im.link_foto ? `<img src="${im.fonte === 'CEF' || im.fonte === 'caixa' ? 'https://venda-imoveis.caixa.gov.br/fotos/F' + encodeURIComponent((im.fonte_id||'').replace(/^(caixa_|cef_)/,'')) + '21.jpg' : '/api/img-proxy?url=' + encodeURIComponent(im.link_foto)}" onerror="this.style.display='none'" style="width:100%;height:100px;object-fit:cover;border-radius:6px;margin-bottom:8px;display:block"/>` : ''}
            <div style="font-weight:700;font-size:12px;color:#111;margin-bottom:3px;line-height:1.3">${im.titulo || 'Imóvel'}</div>
            <div style="font-size:11px;color:#64748b;margin-bottom:6px">📍 ${im.cidade} — ${im.estado}</div>
            <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">
              ${desc ? `<span style="font-size:10px;font-weight:800;background:#dcfce7;color:#16a34a;padding:1px 6px;border-radius:20px">-${desc}%</span>` : ''}
              ${pgtoLabel ? `<span style="font-size:10px;font-weight:700;background:${pgtoBg};color:${pgtoColor};padding:1px 6px;border-radius:20px">${pgtoLabel}</span>` : ''}
              ${nivelLabel ? `<span style="font-size:10px;font-weight:600;background:#fef9c3;color:#92400e;padding:1px 6px;border-radius:20px">${nivelLabel}</span>` : ''}
              ${im.area_m2 > 0 && im.valor_minimo ? `<span style="font-size:10px;font-weight:700;background:#f1f5f9;color:#475569;padding:1px 6px;border-radius:20px">R$ ${Number(im.valor_minimo/im.area_m2).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/m²</span>` : ''}
              ${/^https?:\/\//i.test(im.link_edital||'') ? `<span style="font-size:10px;font-weight:700;background:#eff6ff;color:#084BA6;padding:1px 6px;border-radius:20px">📄 Edital</span>` : ''}
              ${/^https?:\/\//i.test(im.link_matricula||'') && !/matricula\.asp/i.test(im.link_matricula||'') ? `<span style="font-size:10px;font-weight:700;background:#f0fdf4;color:#15803d;padding:1px 6px;border-radius:20px">📄 Matrícula</span>` : ''}
            </div>
            <div style="font-size:15px;font-weight:900;color:#0D63DB;margin-bottom:8px">${fmt(im.valor_minimo)}</div>
            <button onclick="window.location.hash='/imovel/${im.id}'" style="width:100%;padding:7px;background:#0D63DB;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:11px">Ver detalhes →</button>
          </div>`;

        marker.bindPopup(popupHTML, { maxWidth: 240 });
        markersRef.current.addLayer(marker);

        // Círculo de raio para localização aproximada
        if (isAproximado && raioMetros > 0) {
          const circle = L.circle([im.latitude, im.longitude], {
            radius: raioMetros,
            color: '#0D63DB',
            fillColor: '#0D63DB',
            fillOpacity: 0.08,
            weight: 1.5,
            dashArray: '4 4',
          });
          circle.bindPopup(popupHTML, { maxWidth: 240 });
          circlesRef.current.addLayer(circle);
        }
        } catch { /* um imóvel ruim não pode quebrar os demais pins */ }
      });
    });
  }, [imoveisMapa, mapReady]);

  // ── CENTRALIZAÇÃO (efeito DEDICADO e à prova de timing) ───────────────────
  // Separado da renderização dos pins: mesmo que um pin dê erro, o mapa centraliza.
  // Roda algumas vezes (retry) porque, em login novo, o container pode ter
  // dimensão "velha" quando o fitBounds roda (e aí o mapa ficava no Brasil inteiro).
  useEffect(() => {
    if (!mapReady || !leafletRef.current || !visivel) return;
    const pts = imoveisMapa
      .map(im => [Number(im.latitude), Number(im.longitude)])
      .filter(([la, ln]) => isFinite(la) && isFinite(ln) && la !== 0 && ln !== 0);

    const aplicar = () => {
      const map = leafletRef.current;
      if (!map) return;
      try { map.invalidateSize(); } catch {}
      if (raioAtivo && centroRaio && isFinite(centroRaio.lat) && isFinite(centroRaio.lng)) {
        const z = raioKm <= 20 ? 12 : raioKm <= 50 ? 10 : raioKm <= 100 ? 9 : 8;
        try { map.setView([centroRaio.lat, centroRaio.lng], z); } catch {}
        return;
      }
      if (pts.length > 0) {
        // Ignora OUTLIERS de coordenada (cidade certa, lat/lng errada) só no zoom.
        let fit = pts;
        if (pts.length >= 4) {
          const lats = pts.map(p => p[0]).slice().sort((a, b) => a - b);
          const lngs = pts.map(p => p[1]).slice().sort((a, b) => a - b);
          const mid = arr => arr[Math.floor(arr.length / 2)];
          const cLat = mid(lats), cLng = mid(lngs);
          const dists = pts.map(p => haversine(cLat, cLng, p[0], p[1]));
          const medDist = dists.slice().sort((a, b) => a - b)[Math.floor(dists.length / 2)];
          const thr = Math.max(40, medDist * 4);
          const inliers = pts.filter((p, i) => dists[i] <= thr);
          if (inliers.length >= Math.ceil(pts.length * 0.6)) fit = inliers;
        }
        try { map.fitBounds(fit, { padding: [40, 40], maxZoom: 13 }); } catch { /* mapa ainda sem tamanho válido */ }
        return;
      }
      if (centroRaio && isFinite(centroRaio.lat) && isFinite(centroRaio.lng)) {
        try { map.setView([centroRaio.lat, centroRaio.lng], 11); } catch {}
      }
    };

    aplicar();
    const t1 = setTimeout(aplicar, 250);
    const t2 = setTimeout(aplicar, 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [imoveisMapa, mapReady, visivel, centroRaio, raioAtivo, raioKm]);

  // Quando o container fica visível novamente, corrige tamanho do mapa
  useEffect(() => {
    if (visivel && leafletRef.current) {
      // Duplo fire: 100ms para layout inicial, 400ms após possível transição CSS
      setTimeout(() => leafletRef.current?.invalidateSize(), 100);
      setTimeout(() => leafletRef.current?.invalidateSize(), 400);
    }
  }, [visivel]);

  return (
    <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid #e2e8f0', height: height || 'calc(100vh - 320px)', minHeight: 380, position: 'relative', isolation: 'isolate', zIndex: 0 }}>
      {carregando && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'white', padding: '6px 16px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontSize: 12, color: '#64748b' }}>
          Carregando imóveis…
        </div>
      )}
      {!carregando && imoveisMapa.length > 0 && (
        <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000, background: 'white', padding: '5px 14px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontSize: 12, fontWeight: 700, color: '#0D63DB' }}>
          {imoveisMapa.length} imóveis com localização
        </div>
      )}
      {!carregando && imoveisMapa.length === 0 && semCoordenadas && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'white', padding: '10px 18px', borderRadius: 12, boxShadow: '0 2px 12px rgba(0,0,0,0.15)', fontSize: 12, color: '#64748b', textAlign: 'center', maxWidth: 320 }}>
          <div style={{ fontWeight: 700, color: '#334155', marginBottom: 3 }}>📍 {totalLista} imóvel(is) encontrado(s) sem localização</div>
          <div>Coordenadas ainda não cadastradas. A geocodificação automática ocorre entre 21h e 7h (BRT) — os pins aparecem após o processamento noturno.</div>
        </div>
      )}
      {!carregando && imoveisMapa.length === 0 && !semCoordenadas && (
        <div style={{ position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'white', padding: '8px 18px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.12)', fontSize: 12, color: '#94a3b8' }}>
          Nenhum imóvel com localização para os filtros selecionados
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
  // Lê filtros pré-ativados via URL (usados no deep-link do email de alerta)
  const loc = typeof window !== 'undefined' ? window.location.hash : '';
  const _urlParams = React.useMemo(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    const qIdx = hash.indexOf('?');
    if (qIdx === -1) return {};
    return Object.fromEntries(new URLSearchParams(hash.slice(qIdx + 1)));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const plano = role || 'explorador';
  const canSite    = user && ROLES_SITE.includes(role);
  const canAnalise = user && ROLES_ANALISE.includes(role);
  const [analisesBonus, setAnalisesBonus] = useState(null);

  useEffect(() => {
    if (role !== 'explorador' || !user?.id) return;
    supabase.from('perfis').select('bonus_mercado').eq('id', user.id).single()
      .then(({ data }) => { if (data) setAnalisesBonus(data.bonus_mercado || 0); });
  }, [role, user?.id]);
  const FILTROS_INICIAL = { tipos:[], estado:'', cidades:[], raioKm:0, valorMin:'', valorMax:'', modalidades:[], pagamento:[] };
  // Se viemos de um deep-link de email, pré-popula os filtros e dispara busca
  const filtrosFromUrl = React.useMemo(() => {
    if (!_urlParams.estado) return null;
    return {
      tipos: _urlParams.tipo ? [_urlParams.tipo] : [],
      estado: _urlParams.estado || '',
      cidades: _urlParams.cidades ? _urlParams.cidades.split(',').filter(Boolean) : [],
      raioKm: 0,
      valorMin: _urlParams.valorMin || '',
      valorMax: _urlParams.valorMax || '',
      modalidades: _urlParams.modalidade ? [_urlParams.modalidade] : [],
      pagamento: _urlParams.pagamento ? _urlParams.pagamento.split(',').filter(Boolean) : [],
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Persiste filtros no sessionStorage para manter estado no F5
  const _filtrosInicio = React.useMemo(() => {
    if (filtrosFromUrl) return filtrosFromUrl;
    try { const s = sessionStorage.getItem('busca_filtros'); return s ? JSON.parse(s) : FILTROS_INICIAL; } catch { return FILTROS_INICIAL; }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [filtros, setFiltros] = useState(_filtrosInicio);
  const setFiltrosPersist = (fn) => setFiltros(prev => {
    const next = typeof fn === 'function' ? fn(prev) : fn;
    try { sessionStorage.setItem('busca_filtros', JSON.stringify(next)); } catch {}
    return next;
  });

  // Preset inicial na PRIMEIRA visita (sem deep-link e sem filtros na sessão):
  // PRIORIDADE para a cidade de RESIDÊNCIA do assinante; só se não houver endereço
  // cadastrado é que cai para o último alerta salvo. Efeito ÚNICO e sequencial —
  // evita a corrida entre "residência" e "último alerta" (que fazia o preset vir
  // da última busca em vez da cidade do usuário). Não sobrescreve se já interagiu.
  const presetTentado = useRef(false);
  useEffect(() => {
    if (presetTentado.current || filtrosFromUrl) { presetTentado.current = true; return; }
    let temSessao = false;
    try { temSessao = !!sessionStorage.getItem('busca_filtros'); } catch {}
    if (temSessao) { presetTentado.current = true; return; }
    if (!user?.id) return; // aguarda o usuário carregar
    presetTentado.current = true;
    (async () => {
      // 1) Residência (prioridade)
      let uf = '', cidade = '';
      try {
        const { data } = await supabase.from('perfis').select('endereco_uf,endereco_cidade').eq('id', user.id).single();
        uf = (data?.endereco_uf || '').toUpperCase();
        cidade = data?.endereco_cidade || '';
      } catch {}
      // 2) Fallback: último alerta salvo (só quando não há endereço de residência)
      let alerta = null;
      if (!uf && !cidade) {
        try {
          const { data } = await supabase.from('alertas_email').select('filtros').eq('user_id', user.id).single();
          if (data?.filtros?.estado) alerta = data.filtros;
        } catch {}
      }
      setFiltrosPersist(prev => {
        const jaTem = prev.estado || prev.cidades?.length || prev.tipos?.length || prev.modalidades?.length || prev.pagamento?.length || prev.valorMin || prev.valorMax;
        if (jaTem) return prev; // usuário já interagiu — não mexe
        if (uf || cidade) return { ...prev, estado: uf || prev.estado, cidades: cidade ? [cidade] : prev.cidades };
        if (alerta) return { ...FILTROS_INICIAL, ...alerta };
        return prev;
      });
    })();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [filtrosSalvos, setFiltrosSalvos] = useState([]);
  const [nomeFiltro, setNomeFiltro] = useState('');
  const [showSalvarModal, setShowSalvarModal] = useState(false);
  const [buscaCidade, setBuscaCidade] = useState('');
  const [dropdownIndex, setDropdownIndex] = useState(-1);
  const [cidadesEstado, setCidadesEstado] = useState([]);
  const [cidadesCarregando, setCidadesCarregando] = useState(false);
  const [resultados, setResultados] = useState([]);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');
  const [buscaFeita, setBuscaFeita] = useState(false);
  const [showFiltros, setShowFiltros] = useState(true);
  const [selecionados, setSelecionados] = useState([]);
  const [sortBy, setSortBy] = useState(() => { try { return sessionStorage.getItem('busca_sort') || 'desconto_desc'; } catch { return 'desconto_desc'; } });
  const [pagina, setPagina] = useState(1);
  const [totalResultados, setTotalResultados] = useState(0);
  const POR_PAGINA = 20;

  // Radius search state
  const [raioKmAtivo, setRaioKmAtivo] = useState(50);
  const [raioAtivo, setRaioAtivo] = useState(false);
  const [centroRaio, setCentroRaio] = useState(null);
  const [distancias, setDistancias] = useState({});
  const [vista, setVista] = useState('mapa'); // padrão: mapa estilo Google (com lista lateral)
  const [listaSobreMapa, setListaSobreMapa] = useState(true); // painel lista recolhível na vista Mapa (estilo Google)

  // Snapshot dos filtros/raio no momento do último clique em Buscar
  // MapaEmbutido usa este snapshot para garantir consistência com a lista
  const [filtrosBusca, setFiltrosBusca] = useState(null);
  const [centroBusca, setCentroBusca] = useState(null);
  const [raioAtivoBusca, setRaioAtivoBusca] = useState(false);
  const [raioKmBusca, setRaioKmBusca] = useState(50);

  // Busca cidades do estado selecionado via IBGE
  useEffect(() => {
    if (!filtros.estado) { setCidadesEstado([]); return; }
    let cancelled = false;
    setCidadesCarregando(true);
    buscarCidadesEstado(filtros.estado).then(lista => {
      if (!cancelled) { setCidadesEstado(lista); setCidadesCarregando(false); }
    });
    return () => { cancelled = true; };
  }, [filtros.estado]);

  // Ao trocar para mapa com cidade selecionada, geocodifica para auto-zoom
  useEffect(() => {
    if (vista === 'mapa' && filtrosBusca?.cidades?.[0] && !centroBusca) {
      geocodificarCidade(filtrosBusca.cidades[0], filtrosBusca.estado)
        .then(c => setCentroBusca(c));
    }
  }, [vista]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!user?.id) return;
    supabase.from('filtros_salvos').select('*').eq('user_id', user.id).order('criado_em', { ascending: false })
      .then(({ data }) => setFiltrosSalvos(data || []));
  }, [user?.id]);

  // (preset por residência/último alerta unificado no efeito sequencial acima)

  // Deep-link do email: ao carregar com filtros na URL, dispara busca automática
  const deepLinkDisparado = useRef(false);
  useEffect(() => {
    if (!filtrosFromUrl || deepLinkDisparado.current) return;
    deepLinkDisparado.current = true;
    const timer = setTimeout(() => {
      buscarPagina(1, filtrosFromUrl, sortBy, null, false, raioKmAtivo, null);
      setFiltrosBusca(filtrosFromUrl);
      setBuscaFeita(true);
    }, 300);
    return () => clearTimeout(timer);
  }, [filtrosFromUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // Busca reativa com debounce de 600ms quando filtros mudam e estado está preenchido.
  // Inclui raioAtivo/raioKmAtivo: ligar o raio ou mexer no raio re-dispara a busca
  // (antes só `filtros` disparava → o filtro de raio parecia "não funcionar").
  const buscarDebounceRef = useRef(null);
  useEffect(() => {
    if (!filtros.estado) return;
    // Raio ligado sem cidade não tem centro — evita busca inválida (a UI já avisa).
    if (raioAtivo && !filtros.cidades.length) return;
    clearTimeout(buscarDebounceRef.current);
    buscarDebounceRef.current = setTimeout(() => {
      buscar();
    }, 600);
    return () => clearTimeout(buscarDebounceRef.current);
  }, [filtros, raioAtivo, raioKmAtivo]); // eslint-disable-line react-hooks/exhaustive-deps

  const up = (name, val) => setFiltrosPersist(p => ({ ...p, [name]: val }));
  const togglePagamento = (v) => up('pagamento', filtros.pagamento.includes(v) ? filtros.pagamento.filter(x=>x!==v) : [...filtros.pagamento, v]);
  const toggleSelecionado = (id) => setSelecionados(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id]);
  const isSelecionado = (id) => selecionados.includes(id);

  // Mapeamento centralizado em src/data/pagamento.js
  const PAGAMENTO_DB = PAGAMENTO_FILTRO_DB;

  const limparFiltros = () => {
    setFiltrosPersist(FILTROS_INICIAL);
    try { sessionStorage.removeItem('busca_filtros'); sessionStorage.removeItem('busca_sort'); } catch {}
    setBuscaCidade('');
    setSelecionados([]);
    setPagina(1);
    setRaioAtivo(false);
    setCentroRaio(null);
    setDistancias({});
    setResultados([]);
    setTotalResultados(0);
    setBuscaFeita(false);
    setErro('');
    setFiltrosBusca(null);
    setCentroBusca(null);
    setRaioAtivoBusca(false);
  };

  // Centro da cidade para raio/auto-zoom. PRIMÁRIO: centroide das coordenadas dos
  // próprios imóveis no banco (instantâneo, sem dependência externa, e é onde os
  // imóveis realmente estão). FALLBACK: Nominatim com timeout (cidades sem imóveis
  // geocodificados). Antes dependia só do Nominatim no navegador, que bloqueia/
  // pendura chamadas web — travava a busca por raio e o auto-zoom.
  const geocodificarCidade = async (cidade, estado) => {
    if (!cidade) { setCentroRaio(null); return null; }
    // 1) Centroide dos imóveis da cidade (fonte da verdade)
    try {
      let q = supabase.from('imoveis_leilao')
        .select('latitude, longitude')
        .eq('ativo', true).eq('cidade_norm', normCidade(cidade))
        .not('latitude', 'is', null).neq('latitude', 0).limit(500);
      if (estado) q = q.eq('estado', estado);
      const { data } = await q;
      const pts = (data || []).filter(p => p.latitude != null && p.longitude != null && Number(p.latitude) !== 0 && Number(p.longitude) !== 0);
      if (pts.length) {
        const lat = pts.reduce((s, p) => s + Number(p.latitude), 0) / pts.length;
        const lng = pts.reduce((s, p) => s + Number(p.longitude), 0) / pts.length;
        if (isFinite(lat) && isFinite(lng)) {
          const centro = { lat, lng, label: cidade };
          setCentroRaio(centro);
          return centro;
        }
      }
    } catch {}
    // 2) Centróide oficial IBGE (servidor, sem rede externa) — SEMPRE resolve para
    // qualquer cidade real. É o fallback confiável para o auto-zoom quando os
    // imóveis ainda não têm coordenada (antes o mapa ficava no Brasil inteiro).
    if (estado) {
      try {
        const res = await apiCall(`/api/centroide-cidade?cidade=${encodeURIComponent(cidade)}&uf=${encodeURIComponent(estado)}`);
        const d = await res.json();
        if (d && d.ok && isFinite(d.lat) && isFinite(d.lng)) {
          const centro = { lat: Number(d.lat), lng: Number(d.lng), label: cidade };
          setCentroRaio(centro);
          return centro;
        }
      } catch {}
    }
    // 3) Último recurso: Nominatim (com timeout para nunca pendurar a busca)
    try {
      const query = estado ? `${cidade}, ${estado}, Brasil` : `${cidade}, Brasil`;
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=br`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);
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
      if (filtrosAtivos.tipos?.length) q = q.in('tipo', [...filtrosAtivos.tipos, 'imovel']);
      if (filtrosAtivos.modalidades?.length) q = q.in('modalidade', filtrosAtivos.modalidades);
      if (filtrosAtivos.valorMin) q = q.gte('valor_minimo', Number(String(filtrosAtivos.valorMin).replace(/\D/g, '')));
      if (filtrosAtivos.valorMax) q = q.lte('valor_minimo', Number(String(filtrosAtivos.valorMax).replace(/\D/g, '')));
      // Cidades: OR entre cidades (único .or da query). Aspas protegem nomes com
      // espaço/acento/parênteses (ex.: "Embu-Guaçu") de quebrar o agrupamento.
      const cidadesFiltro = cidadesRaio || (filtrosAtivos.cidades?.length > 0 ? filtrosAtivos.cidades : null);
      if (cidadesFiltro?.length > 0) {
        q = q.in('cidade_norm', cidadesFiltro.map(normCidade));
      }
      // Pagamento: igualdade exata (.in) nos valores canônicos do banco. Combina
      // várias opções como união (Financiado + Hipotecado) — antes encadeava um 2º
      // .or que, junto com o de cidades, podia quebrar a query (mapa "sumia").
      if (filtrosAtivos.pagamento?.length > 0) {
        const canon = pagamentoParaCanon(filtrosAtivos.pagamento);
        if (canon.length) q = q.in('forma_pagamento', canon);
      }
      return q;
    };

    const [coluna, dir] = sortAtivo === 'desconto_desc' ? ['desconto_percentual', false]
      : sortAtivo === 'desconto_asc' ? ['desconto_percentual', true]
      : sortAtivo === 'valor_asc'    ? ['valor_minimo', true]
      : sortAtivo === 'data_asc'     ? ['data_leilao', true]
      : ['valor_minimo', false];

    try {
      // ── Modo raio: PostGIS server-side (sem trazer 5000 registros pro browser) ──
      if (raioAtivoBusca && centro) {
        const body = {
          lat: centro.lat, lng: centro.lng, raioKm: raioKmBusca,
          pagina: paginaAlvo, porPagina: POR_PAGINA,
          filtros: {
            // Todos os filtros aplicados no servidor (RPC v2): múltiplos tipos,
            // modalidades e formas de pagamento — Financiado + Hipotecado juntos.
            tipos: filtrosAtivos.tipos || [],
            estado: filtrosAtivos.estado || '',
            modalidades: filtrosAtivos.modalidades || [],
            pagamento: pagamentoParaCanon(filtrosAtivos.pagamento || []),
            valorMin: filtrosAtivos.valorMin ? Number(String(filtrosAtivos.valorMin).replace(/\D/g, '')) : 0,
            valorMax: filtrosAtivos.valorMax ? Number(String(filtrosAtivos.valorMax).replace(/\D/g, '')) : 9999999999,
          },
        };
        const resp = await fetch('/api/busca-raio', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          setErro(err.error || 'Erro na busca por raio. Tente novamente.');
          setLoading(false);
          return;
        }
        const apiData = await resp.json();
        const dados = apiData.resultados || [];
        const offset = (paginaAlvo - 1) * POR_PAGINA;
        // Estima total: quando página cheia → há ao menos mais uma; quando parcial → sabemos o exato
        const totalEst = apiData.total ?? (offset + dados.length + (dados.length === POR_PAGINA ? 1 : 0));
        setTotalResultados(totalEst);

        const novasDistancias = {};
        const mapeados = dados.map(im => {
          if (im.distancia_km != null) novasDistancias[im.id] = Math.round(im.distancia_km);
          return {
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
            descricao: null,
            urlLote: im.url_lote,
            linkEdital: null,
            linkMatricula: null,
            foto: im.link_foto,
            leiloeiro: null,
            dataLeilao: im.data_leilao,
            pagamento: im.forma_pagamento ? [im.forma_pagamento] : [],
            viavel: null,
            scoreViabilidade: null,
            fracionado: null,
            fonte: im.fonte,
            fonteId: im.fonte_id,
            numeroEdital: null,
            numeroMatricula: null,
            numeroProcesso: null,
            latitude: im.latitude,
            longitude: im.longitude,
            scoreFinanceiro: im.score_financeiro ?? null,
            scoreJuridico: im.score_juridico ?? null,
          };
        });
        setDistancias(novasDistancias);
        setResultados(mapeados);
        setLoading(false);
        return;
      }

      // ── Modo normal: paginação server-side via Supabase ──
      let dbData, dbError;
      {
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
        pagamento: im.forma_pagamento ? [im.forma_pagamento] : [],
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
        scoreFinanceiro: im.score_financeiro ?? null,
        scoreJuridico: im.score_juridico ?? null,
      })) : [];

      setDistancias({});
      setResultados(mapeados);

      // Silent tracking — fire and forget
      try {
        const sid = sessionStorage.getItem('tsn_session_id') || (() => { const s = Math.random().toString(36).slice(2); sessionStorage.setItem('tsn_session_id', s); return s; })();
        supabase.from('busca_historico').insert({
          user_id: user?.id || null, session_id: sid, filtros: filtrosAtivos,
          resultados_count: totalResultados || 0, cidade: filtrosAtivos.cidades?.join(', ') || null,
          estado: filtrosAtivos.estado || null, tipo_imovel: filtrosAtivos.tipos?.join(',') || null,
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
            descricao: [filtrosAtivos.cidades?.join(', ') || filtrosAtivos.estado, filtrosAtivos.tipos?.join(', ')].filter(Boolean).join(' · ') || 'Preferência geral',
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

    // Resolve o CENTRO da cidade (await) para o auto-zoom do mapa — tanto no modo
    // raio quanto no modo normal. Antes, no modo normal isso era fire-and-forget e
    // logo em seguida setCentroBusca(centro=null) atropelava o resultado (corrida)
    // → o mapa não focava na cidade. Agora esperamos o centro e setamos uma vez só.
    if (filtros.cidades[0] && (raioAtivo || !centroRaio)) {
      if (raioAtivo) setLoading(true);
      centro = await geocodificarCidade(filtros.cidades[0], filtros.estado);
      // PostGIS handles radius filtering server-side — Overpass not needed
    }

    // Salva snapshot dos filtros ativos no momento da busca
    const filtrosSnapshot = { ...filtros };
    setFiltrosBusca(filtrosSnapshot);
    setCentroBusca(centro);
    setRaioAtivoBusca(raioAtivo);
    setRaioKmBusca(raioKmAtivo);

    buscarPagina(1, filtros, sortBy, centro, raioAtivo, raioKmAtivo, cidadesNaArea);
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

  const desconto = (im) => im.descontoPercentual ? Number(im.descontoPercentual) : (im.valorAvaliacao>0 ? (1-im.valorMinimo/im.valorAvaliacao)*100 : 0);
  const fmtDesc = (v) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ position:'relative' }}>
    {/* Badge fixo de análises bônus para explorador */}
    {role === 'explorador' && analisesBonus !== null && (
      <div style={{ position:'fixed', bottom: 80, left: '50%', transform:'translateX(-50%)', zIndex:1000, background: analisesBonus > 0 ? '#0D63DB' : '#dc2626', color:'white', borderRadius:999, padding:'8px 20px', fontSize:13, fontWeight:700, boxShadow:'0 4px 20px rgba(0,0,0,0.25)', display:'flex', alignItems:'center', gap:8, whiteSpace:'nowrap' }}>
        {analisesBonus > 0 ? `🎁 ${analisesBonus} análise${analisesBonus !== 1 ? 's' : ''} bônus disponível${analisesBonus !== 1 ? 'is' : ''}` : '🔒 Análises bônus esgotadas'}
      </div>
    )}
    <div style={{ maxWidth:1480, margin:'0 auto', padding: isMobile ? '16px 12px' : '20px', display:'flex', flexDirection:'column', gap:16 }}>

      {/* FILTROS (dropdown no topo — libera a largura toda para lista/mapa) */}
      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>

        {/* Filtros */}
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <button onClick={()=>setShowFiltros(!showFiltros)}
            style={{ width:'100%', padding:'13px 16px', background:'#111111', color:'white', border:'none', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', fontWeight:700, fontSize:13 }}>
            <span style={{ display:'flex', alignItems:'center', gap:7 }}><Filter size={14}/> Filtros</span>
            {showFiltros ? <ChevronUp size={13}/> : <ChevronDown size={13}/>}
          </button>
          {showFiltros && (
            <div style={{ padding:14, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(200px, 1fr))', gap:16, alignItems:'start' }}>
              <div>
                <label style={lbl}>Tipo de Imóvel</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { val: 'apartamento', label: 'Apartamento' },
                    { val: 'casa', label: 'Casa' },
                    { val: 'terreno', label: 'Terreno' },
                    { val: 'comercial', label: 'Comercial' },
                  ].map(({ val, label }) => {
                    const ativo = filtros.tipos?.includes(val);
                    return (
                      <button key={val} onClick={() => {
                        const arr = filtros.tipos || [];
                        setFiltrosPersist(p => ({ ...p, tipos: ativo ? arr.filter(v => v !== val) : [...arr, val] }));
                      }}
                        style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${ativo ? '#0D63DB' : '#e2e8f0'}`, background: ativo ? '#0D63DB' : '#f8fafc', color: ativo ? 'white' : '#475569', fontSize: 12, fontWeight: ativo ? 700 : 400, cursor: 'pointer' }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label style={lbl}>Modalidade</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { val: 'extrajudicial', label: 'Extrajudicial' },
                    { val: 'judicial', label: 'Judicial' },
                    { val: 'venda_direta', label: 'Venda Direta' },
                  ].map(({ val, label }) => {
                    const ativo = filtros.modalidades?.includes(val);
                    return (
                      <button key={val} onClick={() => {
                        const arr = filtros.modalidades || [];
                        setFiltrosPersist(p => ({ ...p, modalidades: ativo ? arr.filter(v => v !== val) : [...arr, val] }));
                      }}
                        style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${ativo ? '#0D63DB' : '#e2e8f0'}`, background: ativo ? '#0D63DB' : '#f8fafc', color: ativo ? 'white' : '#475569', fontSize: 12, fontWeight: ativo ? 700 : 400, cursor: 'pointer' }}>
                        {label}
                      </button>
                    );
                  })}
                </div>
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
                    ? cidadesEstado.filter(c => c.toLowerCase().includes(buscaCidade.toLowerCase()) && !filtros.cidades.includes(c))
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
                        placeholder={!filtros.estado ? 'Selecione um estado primeiro' : cidadesCarregando ? 'Carregando cidades...' : 'Buscar cidade (opcional)...'}
                        disabled={!filtros.estado || cidadesCarregando}
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
                            <div style={{ padding:'8px 12px', fontSize:11, color:'#94a3b8' }}>{cidadesCarregando ? 'Carregando...' : 'Nenhuma cidade encontrada'}</div>
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
                <div style={{ fontSize:11, color:'#475569', fontWeight:600, marginBottom:8, display:'flex', justifyContent:'space-between' }}>
                  <span>{filtros.valorMin ? 'R$ ' + Number(filtros.valorMin).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'R$ 0,00'}</span>
                  <span>{filtros.valorMax ? 'R$ ' + Number(filtros.valorMax).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Sem limite'}</span>
                </div>
                <div style={{ position:'relative', height:20, marginBottom:4 }}>
                  <input type="range" min={0} max={5000000} step={50000}
                    value={Number(filtros.valorMin) || 0}
                    onChange={e => { const v = Number(e.target.value); if (v <= (Number(filtros.valorMax) || 5000000)) up('valorMin', v || ''); }}
                    style={{ position:'absolute', width:'100%', height:4, appearance:'none', background:'transparent', pointerEvents:'auto', accentColor:'#0D63DB', zIndex:2 }}
                  />
                  <input type="range" min={0} max={5000000} step={50000}
                    value={Number(filtros.valorMax) || 5000000}
                    onChange={e => { const v = Number(e.target.value); if (v >= (Number(filtros.valorMin) || 0)) up('valorMax', v >= 5000000 ? '' : v); }}
                    style={{ position:'absolute', width:'100%', height:4, appearance:'none', background:'transparent', pointerEvents:'auto', accentColor:'#0D63DB', zIndex:2 }}
                  />
                  {/* Trilha visual */}
                  {(() => {
                    const min = Number(filtros.valorMin) || 0;
                    const max = Number(filtros.valorMax) || 5000000;
                    const pct = (v) => (v / 5000000) * 100;
                    return (
                      <div style={{ position:'absolute', top:'50%', transform:'translateY(-50%)', width:'100%', height:4, background:'#e2e8f0', borderRadius:4 }}>
                        <div style={{ position:'absolute', left:`${pct(min)}%`, right:`${100-pct(max)}%`, height:'100%', background:'#0D63DB', borderRadius:4 }}/>
                      </div>
                    );
                  })()}
                </div>
                <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:'#94a3b8' }}>
                  <span>R$ 0</span><span>R$ 1M</span><span>R$ 2,5M</span><span>R$ 5M+</span>
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
                {filtros.pagamento.length > 0 && (
                  <div style={{ fontSize:10, color:'#64748b', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:6, padding:'6px 8px', marginTop:6, lineHeight:1.5 }}>
                    ℹ️ Exibe apenas imóveis com pagamento confirmado no edital. Imóveis sem informação são omitidos para evitar dado incorreto.
                  </div>
                )}
              </div>
              {erro && <div style={{ padding:'8px 10px', background:'#fee2e2', borderRadius:8, fontSize:11, color:'#dc2626', fontWeight:600 }}>{erro}</div>}
              {!filtros.estado && (
                <div style={{ fontSize:11, color:'#92400e', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:7, padding:'7px 10px', fontWeight:600 }}>
                  Selecione um estado para habilitar a busca
                </div>
              )}
              {loading && (
                <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'8px', color:'#0D63DB', fontSize:12, fontWeight:700 }}>
                  <Loader2 size={14} style={{animation:'spin 1s linear infinite'}}/> Buscando...
                </div>
              )}
              <button onClick={limparFiltros}
                style={{ width:'100%', padding:'9px', background:'none', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                ✕ Limpar filtros
              </button>
            </div>
          )}
        </div>

      </div>

      {/* CONTEÚDO PRINCIPAL */}
      <div style={{ display:'flex', flexDirection:'column', gap:14, overflow: (vista === 'mapa' || vista === 'ambos') ? 'hidden' : undefined, maxHeight: (vista === 'mapa' || vista === 'ambos') ? '100vh' : undefined }}>

        {/* Filtros Salvos */}
        {user?.id && (
          <div style={{ background: 'white', borderRadius: 12, padding: '10px 14px', marginBottom: 0, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, flexShrink: 0 }}>Filtros salvos:</span>
            {filtrosSalvos.map(filtro => (
              <span key={filtro.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 20, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#084BA6', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <span onClick={() => setFiltrosPersist(filtro.filtros)}>{filtro.nome}</span>
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
              <select value={sortBy} onChange={e=>{ setSortBy(e.target.value); try { sessionStorage.setItem('busca_sort', e.target.value); } catch {} setPagina(1); buscarPagina(1, filtros, e.target.value, centroRaio, raioAtivo, raioKmAtivo); }}
                style={{ padding:'7px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, fontWeight:600, color:'#334155', background:'white', cursor:'pointer' }}>
                <option value="desconto_desc">Maior desconto primeiro</option>
                <option value="desconto_asc">Menor desconto primeiro</option>
                <option value="valor_asc">Menor valor primeiro</option>
                <option value="valor_desc">Maior valor primeiro</option>
                <option value="data_asc">Encerra em breve</option>
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

        {/* Vista Mapa embutido — usa snapshot dos filtros no momento da busca */}
        {buscaFeita && filtrosBusca && (
          <div style={{ display: (vista === 'mapa' || vista === 'ambos') ? 'block' : 'none' }}>
            {vista === 'ambos' ? (
              <div style={{ display:'flex', gap:14, height:'calc(100vh - 320px)', minHeight:380 }}>
                <div style={{ flex:'0 0 55%', minWidth:0 }}>
                  <MapaEmbutido filtros={filtrosBusca} resultados={resultadosFiltrados} nav={nav} centroRaio={centroBusca} raioKm={raioKmBusca} raioAtivo={raioAtivoBusca} totalLista={totalResultados} visivel={vista === 'ambos'} height="100%" />
                </div>
                <div style={{ flex:'1 1 45%', minWidth:0, overflowY:'auto', display:'flex', flexDirection:'column', gap:8 }}>
                  {resultadosFiltrados.slice(0, 30).map((im) => {
                    const desc = desconto(im);
                    const imgSrc = fotoCandidatos(im);
                    return (
                      <div key={im.id} onClick={() => nav('/imovel/'+im.id, { state: { imovel: im } })}
                        style={{ background:'white', borderRadius:10, border:'1px solid #e2e8f0', overflow:'hidden', display:'flex', cursor:'pointer', gap:0, flexShrink:0 }}
                        onMouseEnter={e=>e.currentTarget.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)'}
                        onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                        <LazyImage src={imgSrc} alt={im.titulo} style={{ width:72, height:72, flexShrink:0 }} />
                        <div style={{ padding:'8px 10px', flex:1, minWidth:0 }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'#111', marginBottom:2, lineHeight:1.3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{im.titulo || 'Imóvel'}</div>
                          <div style={{ fontSize:10, color:'#64748b', marginBottom:4 }}>📍 {im.cidade} — {im.estado}</div>
                          <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
                            <span style={{ fontSize:12, fontWeight:900, color:'#0D63DB' }}>{fmtBRL(im.valorMinimo)}</span>
                            {desc && <span style={{ fontSize:10, fontWeight:800, background:'#dcfce7', color:'#16a34a', padding:'0 5px', borderRadius:20 }}>-{fmtDesc(desc)}%</span>}
                            {im.areaM2 > 0 && im.valorMinimo && <span style={{ fontSize:9, fontWeight:700, background:'#f1f5f9', color:'#475569', padding:'0 5px', borderRadius:20 }}>R$ {Number(im.valorMinimo/im.areaM2).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/m²</span>}
                          </div>
                          {im.dataLeilao && <div style={{ fontSize:9, color:'#94a3b8', marginTop:2 }}>📅 {fmtData(im.dataLeilao)}</div>}
                        </div>
                      </div>
                    );
                  })}
                  {resultadosFiltrados.length > 30 && (
                    <div style={{ textAlign:'center', fontSize:11, color:'#94a3b8', padding:'8px 0' }}>
                      + {resultadosFiltrados.length - 30} imóveis — use Lista para ver todos
                    </div>
                  )}
                </div>
              </div>
            ) : (
              /* Vista Mapa estilo Google: mapa grande + lista lateral recolhível sobreposta */
              <div style={{ position:'relative', height:'calc(100vh - 210px)', minHeight:460 }}>
                <MapaEmbutido filtros={filtrosBusca} resultados={resultadosFiltrados} nav={nav} centroRaio={centroBusca} raioKm={raioKmBusca} raioAtivo={raioAtivoBusca} totalLista={totalResultados} visivel={vista === 'mapa'} height="100%" />
                {!isMobile && listaSobreMapa && (
                  <div style={{ position:'absolute', top:12, left:12, bottom:12, width:340, background:'white', borderRadius:14, boxShadow:'0 6px 24px rgba(0,0,0,0.18)', zIndex:1000, display:'flex', flexDirection:'column', overflow:'hidden' }}>
                    <div style={{ padding:'10px 14px', borderBottom:'1px solid #f1f5f9', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                      <span style={{ fontSize:13, fontWeight:800, color:'#111' }}>{totalResultados} imóvel(is)</span>
                      <button onClick={()=>setListaSobreMapa(false)} title="Recolher lista"
                        style={{ background:'#f1f5f9', border:'none', borderRadius:8, padding:'4px 10px', fontSize:12, fontWeight:700, color:'#64748b', cursor:'pointer' }}>‹ Recolher</button>
                    </div>
                    <div style={{ flex:1, overflowY:'auto', padding:'10px', display:'flex', flexDirection:'column', gap:8 }}>
                      {resultadosFiltrados.slice(0, 60).map((im) => {
                        const desc = desconto(im);
                        const imgSrc = fotoCandidatos(im);
                        return (
                          <div key={im.id} onClick={() => nav('/imovel/'+im.id, { state:{ imovel: im } })}
                            style={{ background:'white', borderRadius:10, border:'1px solid #e2e8f0', overflow:'hidden', display:'flex', cursor:'pointer', flexShrink:0 }}
                            onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='white'}>
                            <LazyImage src={imgSrc} alt={im.titulo} style={{ width:64, height:64, flexShrink:0 }} />
                            <div style={{ padding:'7px 10px', flex:1, minWidth:0 }}>
                              <div style={{ fontSize:12, fontWeight:700, color:'#111', lineHeight:1.3, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{im.titulo || 'Imóvel'}</div>
                              <div style={{ fontSize:10, color:'#64748b', margin:'2px 0 4px' }}>📍 {im.cidade} — {im.estado}</div>
                              <div style={{ display:'flex', gap:5, alignItems:'center', flexWrap:'wrap' }}>
                                <span style={{ fontSize:13, fontWeight:900, color:'#0D63DB' }}>{fmtBRL(im.valorMinimo)}</span>
                                {desc && <span style={{ fontSize:10, fontWeight:800, background:'#dcfce7', color:'#16a34a', padding:'0 5px', borderRadius:20 }}>-{fmtDesc(desc)}%</span>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {!isMobile && !listaSobreMapa && (
                  <button onClick={()=>setListaSobreMapa(true)}
                    style={{ position:'absolute', top:12, left:12, zIndex:1000, background:'white', border:'none', borderRadius:10, boxShadow:'0 4px 16px rgba(0,0,0,0.18)', padding:'9px 14px', fontSize:13, fontWeight:700, color:'#111', cursor:'pointer' }}>
                    ☰ Ver lista ({totalResultados})
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        {(vista === 'mapa' || vista === 'ambos') && !buscaFeita && (
          <div style={{ borderRadius:14, border:'1px solid #e2e8f0', height:'calc(100vh - 320px)', minHeight:380, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:10, background:'#f8fafc', color:'#94a3b8' }}>
            <span style={{ fontSize:32 }}>🗺️</span>
            <span style={{ fontSize:14, fontWeight:600 }}>Configure os filtros e selecione um estado para ver os imóveis no mapa</span>
          </div>
        )}

        {/* Resultados em cards */}
        {vista === 'lista' && !loading && resultadosFiltrados.length>0 && (
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)', gap:12 }}>
            {resultadosPagina.map((im)=>{
              const desc = desconto(im);
              const modalColor = im.modalidade==='judicial'||im.modalidade==='primeiro_leilao' ? { bg:'#fef3c7', color:'#92400e' } : { bg:'#dbeafe', color:'#084BA6' };
              const imgSrc = fotoCandidatos(im);

              return (
                <div key={im.id}
                  style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden', display:'flex', flexDirection:'column', cursor:'pointer', transition:'box-shadow 0.15s' }}
                  onClick={e => { if (e.target.closest('a,button,input')) return; nav('/imovel/'+im.id, { state: { imovel: im } }); }}
                  onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.1)'}
                  onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>

                  {/* Foto */}
                  <div style={{ width:'100%', height: isMobile ? 180 : 150, background:'#f1f5f9', position:'relative', overflow:'hidden' }}>
                    {imgSrc.length
                      ? <LazyImage src={imgSrc} alt={im.titulo} style={{ width:'100%', height:'100%' }}/>
                      : <div style={{ width:'100%', height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, color:'#cbd5e1' }}>
                          <svg width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5M3.75 21V6.75A2.25 2.25 0 016 4.5h12A2.25 2.25 0 0120.25 6.75V21M9 21v-6h6v6"/></svg>
                          <span style={{ fontSize:9, color:'#94a3b8', fontWeight:600 }}>Sem foto</span>
                        </div>
                    }
                    {desc>0 && (
                      <div style={{ position:'absolute', top:8, right:8, background: desc>=40?'#16a34a':desc>=20?'#d97706':'#dc2626', color:'white', fontWeight:900, fontSize:13, padding:'3px 8px', borderRadius:8 }}>
                        -{fmtDesc(desc)}%
                      </div>
                    )}
                    {(im.fonte==='CEF' || im.fonte==='caixa') && (
                      <div style={{ position:'absolute', top:8, left:8, background:'#c2410c', color:'white', fontSize:9, fontWeight:800, padding:'2px 7px', borderRadius:8 }}>CAIXA</div>
                    )}
                  </div>

                  {/* Conteúdo */}
                  <div style={{ flex:1, padding:'10px 12px', display:'flex', flexDirection:'column', gap:5 }}>
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {im.tipo && <span style={{ fontSize:9, fontWeight:700, background:'#f1f5f9', color:'#475569', padding:'1px 6px', borderRadius:8 }}>{TIPO_LABEL[im.tipo]||im.tipo}</span>}
                      <span style={{ fontSize:9, fontWeight:700, padding:'1px 6px', borderRadius:8, background:modalColor.bg, color:modalColor.color }}>
                        {MODAL_LABEL[im.modalidade] || im.modalidade || 'Leilão'}
                      </span>
                      {im.fracionado && <span style={{ fontSize:9, fontWeight:800, background:'#fef3c7', color:'#92400e', padding:'1px 6px', borderRadius:8 }}>⚠ Fração</span>}
                    </div>

                    <div style={{ fontWeight:700, color:'#111111', fontSize: isMobile ? 14 : 12, lineHeight:1.3, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                      {im.titulo || 'Imóvel'}
                    </div>

                    <div style={{ fontSize:10, color:'#64748b', display:'flex', alignItems:'center', gap:3, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                      <MapPin size={9} style={{ flexShrink:0 }}/>{[im.bairro, im.cidade, im.estado].filter(Boolean).join(', ')||'—'}
                      {distancias[im.id] != null && (
                        <span style={{ flexShrink:0, fontSize:9, fontWeight:700, background:'#eff6ff', color:'#084BA6', borderRadius:8, padding:'1px 6px' }}>
                          {distancias[im.id]} km
                        </span>
                      )}
                    </div>

                    {im.descricao && (
                      <div style={{ fontSize:10, color:'#64748b', lineHeight:1.4, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>
                        {im.descricao}
                      </div>
                    )}

                    <div style={{ marginTop:2 }}>
                      <div style={{ fontSize:9, color:'#94a3b8', fontWeight:600, textTransform:'uppercase', letterSpacing:0.4 }}>Lance Mín.</div>
                      <div style={{ fontWeight:900, color:'#111111', fontSize: isMobile ? 18 : 15 }}>{fmtBRL(im.valorMinimo)}</div>
                      {im.valorAvaliacao>0 && (
                        <div style={{ fontSize:10, color:'#64748b' }}>Aval. {fmtBRL(im.valorAvaliacao)}</div>
                      )}
                    </div>

                    {/* Indicadores de decisão: R$/m², disponibilidade de docs e score */}
                    {(() => {
                      const m2 = im.areaM2 > 0 && im.valorMinimo ? im.valorMinimo / im.areaM2 : null;
                      const temEdital = /^https?:\/\//i.test(im.linkEdital || '');
                      const temMatricula = /^https?:\/\//i.test(im.linkMatricula || '') && !/matricula\.asp/i.test(im.linkMatricula || '');
                      const score = im.scoreJuridico ?? im.scoreFinanceiro ?? null;
                      if (!m2 && !temEdital && !temMatricula && score == null) return null;
                      return (
                        <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
                          {m2 && <span style={{ fontSize:9, background:'#f1f5f9', color:'#475569', padding:'1px 6px', borderRadius:8, fontWeight:700 }}>R$ {Number(m2).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/m²</span>}
                          {temEdital && <span title="Edital disponível" style={{ fontSize:9, background:'#eff6ff', color:'#084BA6', padding:'1px 6px', borderRadius:8, fontWeight:700 }}>📄 Edital</span>}
                          {temMatricula && <span title="Matrícula disponível" style={{ fontSize:9, background:'#f0fdf4', color:'#15803d', padding:'1px 6px', borderRadius:8, fontWeight:700 }}>📄 Matrícula</span>}
                          {score != null && <span title="Score de análise" style={{ fontSize:9, background:'#faf5ff', color:'#7c3aed', padding:'1px 6px', borderRadius:8, fontWeight:800 }}>★ {score}</span>}
                        </div>
                      );
                    })()}

                    <div style={{ display:'flex', gap:4, flexWrap:'wrap', alignItems:'center' }}>
                      {(im.pagamento||[]).filter(Boolean).map(p => {
                        const badge = pagamentoBadge(p);
                        if (!badge) return null;
                        return (
                          <span key={p} title={`Forma de pagamento: ${badge.label}`} style={{ fontSize:9, background: badge.bg, color: badge.color, padding:'1px 6px', borderRadius:8, fontWeight:600 }}>
                            {badge.label}
                          </span>
                        );
                      })}
                      {/* Nenhuma informação de pagamento disponível */}
                      {(im.pagamento||[]).every(p => !p || !pagamentoBadge(p)) && (
                        <span style={{ fontSize:9, color:'#94a3b8', fontStyle:'italic' }}>Consultar edital</span>
                      )}
                      {im.areaM2>0 && <span style={{ fontSize:9, color:'#8b5cf6', fontWeight:700 }}>{im.areaM2}m²</span>}
                      <span style={{ fontSize:9, color:'#94a3b8' }}>{fmtData(im.dataLeilao, im.modalidade)}</span>
                    </div>

                    {(im.scoreFinanceiro !== null || im.scoreJuridico !== null) && (
                      <ScoreRisco scoreFinanceiro={im.scoreFinanceiro} scoreJuridico={im.scoreJuridico} size="sm" />
                    )}
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
        {vista === 'lista' && !loading && totalPaginas > 1 && (
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
