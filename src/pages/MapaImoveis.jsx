import React, { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { useNavigate } from 'react-router-dom';

// CARTO basemaps: permite uso por apps (o tile.openstreetmap.org bloqueia em produção).
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> © <a href="https://carto.com/attributions">CARTO</a>';

// Limite de imóveis carregados por bbox conforme zoom
function limitePorZoom(z) {
  if (z >= 13) return 500;
  if (z >= 10) return 300;
  if (z >= 7)  return 200;
  return 100;
}

const COR_TIPO = {
  apartamento: '#0D63DB',
  casa: '#059669',
  terreno: '#d97706',
  comercial: '#7c3aed',
  sala: '#7c3aed',
  galpao: '#dc2626',
  rural: '#065f46',
  vaga: '#64748b',
  imovel: '#111111',
};

function svgPin(cor) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="36" viewBox="0 0 24 36">
      <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${cor}" stroke="white" stroke-width="1.5"/>
      <circle cx="12" cy="12" r="5" fill="white"/>
    </svg>`
  )}`;
}

export default function MapaImoveis() {
  const mapRef = useRef(null);
  const leafletMap = useRef(null);
  const clusterLayer = useRef(null);
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [estados, setEstados] = useState([]);
  const [selecionado, setSelecionado] = useState(null);

  // Ref para manter filtros acessíveis nos event listeners do Leaflet
  const filtrosRef = useRef({ tipo: '', estado: '' });
  useEffect(() => { filtrosRef.current = { tipo: filtroTipo, estado: filtroEstado }; }, [filtroTipo, filtroEstado]);

  const carregarPorBbox = useCallback(async (map) => {
    if (!map || !clusterLayer.current) return;
    setLoading(true);

    const z = map.getZoom();
    const bounds = map.getBounds();
    const { tipo, estado } = filtrosRef.current;

    let q = supabase
      .from('imoveis_leilao')
      .select('id, titulo, cidade, estado, tipo, valor_minimo, latitude, longitude, link_foto, fonte, fonte_id')
      .eq('ativo', true)
      .not('latitude', 'is', null)
      .neq('latitude', 0)
      .not('longitude', 'is', null)
      .neq('longitude', 0)
      .gte('latitude', bounds.getSouth())
      .lte('latitude', bounds.getNorth())
      .gte('longitude', bounds.getWest())
      .lte('longitude', bounds.getEast())
      .limit(limitePorZoom(z));

    if (tipo) q = q.eq('tipo', tipo);
    if (estado) q = q.eq('estado', estado);

    const { data } = await q;
    const lista = data || [];

    import('leaflet').then(async L => {
      // Carrega CSS e plugin de cluster dinamicamente
      if (!document.getElementById('leaflet-cluster-css')) {
        const link = document.createElement('link');
        link.id = 'leaflet-cluster-css';
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css';
        document.head.appendChild(link);
        const link2 = document.createElement('link');
        link2.rel = 'stylesheet';
        link2.href = 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css';
        document.head.appendChild(link2);
      }

      // Importa plugin de cluster
      await import('leaflet.markercluster');

      clusterLayer.current.clearLayers();

      lista.forEach(im => {
        if (im.latitude == null || im.longitude == null || im.latitude === 0 || im.longitude === 0) return;
        const cor = COR_TIPO[im.tipo] || '#111111';
        const icon = L.icon({ iconUrl: svgPin(cor), iconSize: [24, 36], iconAnchor: [12, 36], popupAnchor: [0, -36] });
        const marker = L.marker([im.latitude, im.longitude], { icon });
        const fmt = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
        // Foto da Caixa via hotlink direto (Vercel é bloqueada); outros usam link_foto.
        const _num = (im.fonte_id || '').replace(/^(caixa_|cef_)/, '');
        const _fotoSrc = (im.fonte === 'caixa' || im.fonte === 'CEF')
          ? (_num ? `https://venda-imoveis.caixa.gov.br/fotos/F${_num}21.jpg` : '')
          : (typeof im.link_foto === 'string' ? im.link_foto : '');
        marker.bindPopup(`
          <div style="font-family:Inter,sans-serif;min-width:200px">
            ${_fotoSrc
              ? `<img src="${_fotoSrc}" style="width:100%;height:100px;object-fit:cover;border-radius:6px;margin-bottom:8px" onerror="this.style.display='none'"/>`
              : ''}
            <div style="font-weight:700;font-size:13px;color:#111;margin-bottom:4px">${im.titulo || 'Imóvel'}</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:6px">${im.cidade || ''} — ${im.estado || ''}</div>
            <div style="font-size:14px;font-weight:800;color:#0D63DB;margin-bottom:8px">${fmt(im.valor_minimo)}</div>
            <button onclick="window.location.hash='/imovel/${im.id}'" style="width:100%;padding:6px;background:#0D63DB;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px">Ver detalhes →</button>
          </div>
        `);
        marker.on('click', () => setSelecionado(im));
        clusterLayer.current.addLayer(marker);
      });

      setTotal(lista.length);
      setLoading(false);
    });
  }, []);

  // Carrega estados para o filtro
  useEffect(() => {
    supabase.from('imoveis_leilao').select('estado').eq('ativo', true)
      .not('latitude', 'is', null).neq('latitude', 0)
      .then(({ data }) => {
        const unicos = [...new Set((data || []).map(e => e.estado).filter(Boolean))].sort();
        setEstados(unicos);
      });
  }, []);

  // Inicializa mapa Leaflet com MarkerClusterGroup
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;

    import('leaflet').then(async L => {
      await import('leaflet.markercluster');

      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      const map = L.map(mapRef.current, {
        center: [-15.8, -47.9],
        zoom: 5,
        zoomControl: true,
      });

      L.tileLayer(TILE_URL, { subdomains: 'abcd', attribution: ATTRIBUTION, maxZoom: 19 }).addTo(map);

      // Cluster com estilo personalizado
      const cluster = L.markerClusterGroup({
        maxClusterRadius: 60,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        iconCreateFunction: (c) => {
          const n = c.getChildCount();
          const size = n >= 100 ? 48 : n >= 20 ? 40 : 32;
          const bg = n >= 100 ? '#dc2626' : n >= 20 ? '#d97706' : '#0D63DB';
          return L.divIcon({
            html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${bg};color:white;font-weight:800;font-size:${size < 40 ? 12 : 14}px;display:flex;align-items:center;justify-content:center;border:2.5px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.25)">${n}</div>`,
            className: '',
            iconSize: [size, size],
            iconAnchor: [size / 2, size / 2],
          });
        },
      });

      cluster.addTo(map);
      clusterLayer.current = cluster;
      leafletMap.current = map;

      const onMove = () => carregarPorBbox(map);
      map.on('moveend', onMove);
      map.on('zoomend', onMove);

      // Carregamento inicial
      carregarPorBbox(map);
    });

    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
        clusterLayer.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Recarrega quando filtros mudam
  useEffect(() => {
    if (!leafletMap.current) return;
    carregarPorBbox(leafletMap.current);
  }, [filtroTipo, filtroEstado, carregarPorBbox]);

  const fmt = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
  const TIPOS = ['apartamento', 'casa', 'terreno', 'comercial', 'sala', 'galpao', 'rural', 'vaga', 'imovel'];

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ background: '#111111', color: '#fff', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>←</button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Mapa de Imóveis</span>
          {!loading && total > 0 && (
            <span style={{ fontSize: 12, color: '#60a5fa', background: '#1e293b', padding: '2px 10px', borderRadius: 20 }}>
              {total} visível{total !== 1 ? 'is' : ''} nesta área
            </span>
          )}
        </div>
        <button onClick={() => navigate('/buscar')} style={{ fontSize: 12, padding: '5px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
          Ver lista →
        </button>
      </div>

      {/* Filtros */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e2e8f0', padding: '10px 20px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filtroTipo} onChange={e => setFiltroTipo(e.target.value)}
          style={{ fontSize: 13, padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none', color: '#111' }}>
          <option value="">Todos os tipos</option>
          {TIPOS.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
        <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}
          style={{ fontSize: 13, padding: '6px 12px', border: '1px solid #e2e8f0', borderRadius: 8, outline: 'none', color: '#111' }}>
          <option value="">Todos os estados</option>
          {estados.map(e => <option key={e} value={e}>{e}</option>)}
        </select>
        {(filtroTipo || filtroEstado) && (
          <button onClick={() => { setFiltroTipo(''); setFiltroEstado(''); }}
            style={{ fontSize: 12, padding: '5px 12px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', color: '#64748b' }}>
            Limpar filtros
          </button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['Apartamento','#0D63DB'],['Casa','#059669'],['Terreno','#d97706'],['Comercial','#7c3aed'],['Rural','#065f46']].map(([tipo, cor]) => (
            <div key={tipo} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#64748b' }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: cor }} />
              {tipo}
            </div>
          ))}
        </div>
      </div>

      {/* Mapa */}
      <div style={{ position: 'relative', height: 'calc(100vh - 110px)' }}>
        {loading && (
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'white', padding: '8px 20px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontSize: 13, color: '#64748b', whiteSpace: 'nowrap' }}>
            Carregando imóveis…
          </div>
        )}
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* Painel inferior ao clicar num pin */}
      {selecionado && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: 'white', borderTop: '1px solid #e2e8f0', padding: '16px 20px', zIndex: 2000, boxShadow: '0 -4px 20px rgba(0,0,0,0.1)', display: 'flex', gap: 14, alignItems: 'center' }}>
          {(() => {
            const num = (selecionado.fonte_id || '').replace(/^(caixa_|cef_)/, '');
            const ehCaixa = selecionado.fonte === 'caixa' || selecionado.fonte === 'CEF';
            const fotoSel = ehCaixa
              ? (num ? `https://venda-imoveis.caixa.gov.br/fotos/F${num}21.jpg` : null)
              : (typeof selecionado.link_foto === 'string' && selecionado.link_foto ? selecionado.link_foto : null);
            return fotoSel ? (
              <img src={fotoSel} alt="" style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }}
                onError={e => e.target.style.display = 'none'} />
            ) : null;
          })()}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#111', marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selecionado.titulo}</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 4 }}>{selecionado.cidade} — {selecionado.estado}</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#0D63DB' }}>{fmt(selecionado.valor_minimo)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => setSelecionado(null)}
              style={{ padding: '8px 14px', background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, cursor: 'pointer', color: '#64748b' }}>
              Fechar
            </button>
            <button onClick={() => navigate(`/imovel/${selecionado.id}`)}
              style={{ padding: '8px 16px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Ver detalhes →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
