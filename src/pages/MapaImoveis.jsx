import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabase';
import { useNavigate } from 'react-router-dom';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

// Cores por tipo de imóvel
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
  const markersLayer = useRef(null);
  const navigate = useNavigate();

  const [imoveis, setImoveis] = useState([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [estados, setEstados] = useState([]);
  const [selecionado, setSelecionado] = useState(null);

  useEffect(() => {
    carregarImoveis();
  }, [filtroTipo, filtroEstado]);

  async function carregarImoveis() {
    setLoading(true);
    let q = supabase
      .from('imoveis_leilao')
      .select('id, titulo, cidade, estado, tipo, valor_minimo, latitude, longitude, link_foto')
      .eq('ativo', true)
      .not('latitude', 'is', null)
      .neq('latitude', 0)
      .limit(2000);

    if (filtroTipo) q = q.eq('tipo', filtroTipo);
    if (filtroEstado) q = q.eq('estado', filtroEstado);

    const { data, count } = await q;
    setImoveis(data || []);
    setTotal(count || (data || []).length);

    // Extrai estados únicos para o filtro
    if (!estados.length) {
      const { data: ests } = await supabase
        .from('imoveis_leilao')
        .select('estado')
        .eq('ativo', true)
        .not('latitude', 'is', null)
        .neq('latitude', 0);
      const unicos = [...new Set((ests || []).map(e => e.estado).filter(Boolean))].sort();
      setEstados(unicos);
    }
    setLoading(false);
  }

  // Inicializa mapa Leaflet
  useEffect(() => {
    if (!mapRef.current || leafletMap.current) return;
    import('leaflet').then(L => {
      // Fix ícones padrão do Leaflet no Vite
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      leafletMap.current = L.map(mapRef.current, {
        center: [-15.8, -47.9],
        zoom: 5,
        zoomControl: true,
      });

      L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, maxZoom: 18 }).addTo(leafletMap.current);
      markersLayer.current = L.layerGroup().addTo(leafletMap.current);
    });
    return () => {
      if (leafletMap.current) {
        leafletMap.current.remove();
        leafletMap.current = null;
      }
    };
  }, []);

  // Atualiza pins quando imóveis mudam
  useEffect(() => {
    if (!leafletMap.current || !markersLayer.current) return;
    import('leaflet').then(L => {
      markersLayer.current.clearLayers();
      imoveis.forEach(im => {
        if (!im.latitude || !im.longitude) return;
        const cor = COR_TIPO[im.tipo] || '#111111';
        const icon = L.icon({ iconUrl: svgPin(cor), iconSize: [24, 36], iconAnchor: [12, 36], popupAnchor: [0, -36] });
        const marker = L.marker([im.latitude, im.longitude], { icon });
        const fmt = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
        marker.bindPopup(`
          <div style="font-family:Inter,sans-serif;min-width:200px">
            ${im.link_foto ? `<img src="${im.link_foto}" style="width:100%;height:100px;object-fit:cover;border-radius:6px;margin-bottom:8px"/>` : ''}
            <div style="font-weight:700;font-size:13px;color:#111;margin-bottom:4px">${im.titulo || 'Imóvel'}</div>
            <div style="font-size:12px;color:#64748b;margin-bottom:6px">${im.cidade} — ${im.estado}</div>
            <div style="font-size:14px;font-weight:800;color:#0D63DB;margin-bottom:8px">${fmt(im.valor_minimo)}</div>
            <button onclick="window.location.hash='/imovel/${im.id}'" style="width:100%;padding:6px;background:#0D63DB;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px">Ver detalhes →</button>
          </div>
        `);
        marker.on('click', () => setSelecionado(im));
        markersLayer.current.addLayer(marker);
      });
    });
  }, [imoveis]);

  const fmt = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—';
  const TIPOS = ['apartamento', 'casa', 'terreno', 'comercial', 'sala', 'galpao', 'rural', 'vaga', 'imovel'];

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div style={{ background: '#111111', color: '#fff', padding: '0 20px', height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>←</button>
          <span style={{ fontWeight: 700, fontSize: 16 }}>Mapa de Imóveis</span>
          {!loading && <span style={{ fontSize: 12, color: '#60a5fa', background: '#1e293b', padding: '2px 10px', borderRadius: 20 }}>{imoveis.length} imóveis no mapa</span>}
        </div>
        <button onClick={() => navigate('/buskar')} style={{ fontSize: 12, padding: '5px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
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
        {/* Legenda de cores */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {[['apartamento','#0D63DB'],['casa','#059669'],['terreno','#d97706'],['comercial','#7c3aed'],['rural','#065f46']].map(([tipo, cor]) => (
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
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: 'white', padding: '8px 20px', borderRadius: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontSize: 13, color: '#64748b' }}>
            Carregando imóveis…
          </div>
        )}
        {/* CSS do Leaflet via link */}
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
      </div>
    </div>
  );
}
