import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Calendar, Heart, BarChart3, ExternalLink, Home, Building2, LayoutGrid, Warehouse, Gavel } from 'lucide-react';
import { isFavorito, toggleFavorito } from '../utils/storage';
import { fmt } from '../utils/calculos';

const TIPO_ICONS = { casa: Home, apartamento: Building2, terreno: LayoutGrid, comercial: Warehouse };
const TIPO_COLORS = { casa: '#10b981', apartamento: '#2563eb', terreno: '#f59e0b', comercial: '#8b5cf6' };

export default function PropertyCard({ imovel, onFavToggle }) {
  const nav = useNavigate();
  const [fav, setFav] = React.useState(isFavorito(imovel.id));
  const TIcon = TIPO_ICONS[imovel.tipo] || Building2;
  const tColor = TIPO_COLORS[imovel.tipo] || '#2563eb';
  const desconto = imovel.valorAvaliacao && imovel.valorMinimo
    ? Math.round((1 - imovel.valorMinimo / imovel.valorAvaliacao) * 100) : null;

  const handleFav = (e) => {
    e.stopPropagation();
    const updated = toggleFavorito(imovel);
    setFav(!fav);
    if (onFavToggle) onFavToggle(updated);
  };

  const handleAnalise = (e) => {
    e.stopPropagation();
    nav('/analise', { state: { imovel } });
  };

  return (
    <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 2px 6px rgba(0,0,0,0.06)', transition: 'transform 0.15s, box-shadow 0.15s', cursor: 'default' }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.1)'; }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)'; }}>

      {/* Topo colorido */}
      <div style={{ background: `linear-gradient(135deg, ${tColor}22, ${tColor}10)`, borderBottom: `3px solid ${tColor}`, padding: '14px 16px', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ background: `${tColor}22`, borderRadius: 8, padding: 8 }}>
              <TIcon size={18} color={tColor} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a', lineHeight: 1.3 }}>{imovel.titulo || 'Imóvel em Leilão'}</div>
              <div style={{ fontSize: 10, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>
                {imovel.tipo} · {imovel.modalidade}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {desconto && <span style={{ background: '#dc2626', color: 'white', fontSize: 10, fontWeight: 800, padding: '3px 7px', borderRadius: 6 }}>-{desconto}%</span>}
            <button onClick={handleFav} style={{ background: fav ? '#fee2e2' : '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 6, cursor: 'pointer', display: 'flex' }}>
              <Heart size={14} color={fav ? '#dc2626' : '#94a3b8'} fill={fav ? '#dc2626' : 'none'} />
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: '14px 16px' }}>
        {/* Localização */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#64748b', fontSize: 11, marginBottom: 12 }}>
          <MapPin size={11} />
          <span>{imovel.cidade}/{imovel.estado}{imovel.endereco ? ` · ${imovel.endereco}` : ''}</span>
        </div>

        {/* Valores */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
          {imovel.valorAvaliacao && (
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Avaliação</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginTop: 2 }}>R$ {fmt(imovel.valorAvaliacao, 0)}</div>
            </div>
          )}
          <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '8px 10px' }}>
            <div style={{ fontSize: 9, color: '#16a34a', fontWeight: 700, textTransform: 'uppercase' }}>Lance Mínimo</div>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#15803d', marginTop: 2 }}>R$ {fmt(imovel.valorMinimo, 0)}</div>
          </div>
        </div>

        {/* Info */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {imovel.areaM2 && <span style={{ background: '#f1f5f9', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700, color: '#475569' }}>{imovel.areaM2}m²</span>}
          {(imovel.pagamento||[]).map(p => (
            <span key={p} style={{ background: '#dbeafe', borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 700, color: '#1e40af' }}>
              {p === 'aVista' ? 'À Vista' : p === 'financiado' ? 'Financiado' : 'Hipotecado'}
            </span>
          ))}
        </div>

        {imovel.dataLeilao && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#f59e0b', fontWeight: 600, marginBottom: 12 }}>
            <Calendar size={12} /> Data: {imovel.dataLeilao}
          </div>
        )}

        {imovel.leiloeiro && (
          <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 12 }}>
            <Gavel size={10} style={{ display: 'inline', marginRight: 4 }} />Leiloeiro: {imovel.leiloeiro}
          </div>
        )}

        {/* Ações */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleAnalise}
            style={{ flex: 1, padding: '9px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <BarChart3 size={13} /> Ver Análise
          </button>
          {imovel.urlLote && (
            <button onClick={() => window.open(imovel.urlLote, '_blank')}
              style={{ padding: '9px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <ExternalLink size={14} color="#64748b" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
