import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Heart, FileText, TrendingUp, Clock, CheckCircle2, XCircle, BarChart3, Trash2, DollarSign, Plus, Home, LayoutGrid, Warehouse } from 'lucide-react';
import { loadImoveis, saveImoveis, loadFavoritos, toggleFavorito } from '../utils/storage';
import { fmt } from '../utils/calculos';

const STATUS_CONFIG = {
  analise:   { l:'Em Análise',  c:'#f59e0b', bg:'#fef3c7', icon:Clock },
  aprovado:  { l:'Aprovado',    c:'#10b981', bg:'#d1fae5', icon:CheckCircle2 },
  arrematado:{ l:'Arrematado',  c:'#2563eb', bg:'#dbeafe', icon:CheckCircle2 },
  em_reforma:{ l:'Em Reforma',  c:'#8b5cf6', bg:'#ede9fe', icon:Building2 },
  venda:     { l:'À Venda',     c:'#f97316', bg:'#ffedd5', icon:TrendingUp },
  alugado:   { l:'Alugado',     c:'#06b6d4', bg:'#cffafe', icon:Home },
  concluido: { l:'Concluído',   c:'#64748b', bg:'#f1f5f9', icon:CheckCircle2 },
  reprovado: { l:'Reprovado',   c:'#ef4444', bg:'#fee2e2', icon:XCircle },
};

const TIPO_ICONS = { casa:Home, apartamento:Building2, terreno:LayoutGrid, comercial:Warehouse };

export default function Painel() {
  const nav = useNavigate();
  const [imoveis, setImoveis] = useState([]);
  const [favoritos, setFavoritos] = useState([]);
  const [aba, setAba] = useState('portfolio');

  useEffect(() => {
    setImoveis(loadImoveis());
    setFavoritos(loadFavoritos());
  }, []);

  const excluir = (id) => {
    if (!confirm('Excluir este imóvel do portfólio?')) return;
    const updated = imoveis.filter(i => i.id !== id);
    saveImoveis(updated);
    setImoveis(updated);
  };

  const removerFav = (id) => {
    const fav = favoritos.find(f => f.id === id);
    if (!fav) return;
    const updated = toggleFavorito(fav);
    setFavoritos(updated);
  };

  // KPIs
  const totalArremate = imoveis.reduce((s, i) => s + (Number(i.valorArrematacao) || 0), 0);
  const totalVGV = imoveis.reduce((s, i) => s + (Number(i.valorMercado) || 0), 0);
  const aprovados = imoveis.filter(i => ['aprovado','arrematado','em_reforma','venda','alugado'].includes(i.status)).length;
  const lucroEst = imoveis.reduce((s, i) => {
    const l = Number(i.valorMercado || 0) * 0.9 - Number(i.valorArrematacao || 0) * 1.2;
    return s + Math.max(0, l);
  }, 0);

  const ABAS = [
    { id: 'portfolio', label: `Portfólio (${imoveis.length})`, icon: Building2 },
    { id: 'favoritos', label: `Favoritos (${favoritos.length})`, icon: Heart },
  ];

  const CardImovel = ({ im, isFav = false }) => {
    const s = STATUS_CONFIG[im.status] || STATUS_CONFIG.analise;
    const TIcon = TIPO_ICONS[im.tipo] || Building2;
    return (
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', cursor: 'pointer' }}
        onClick={() => nav('/analise', { state: { imovel: im } })}
        onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
        onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.transform = ''; }}>
        <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ background: '#dbeafe', borderRadius: 8, padding: 8 }}><TIcon size={16} color="#2563eb"/></div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 13, color: '#0f172a', lineHeight: 1.2 }}>{im.nome || im.titulo || 'Sem nome'}</div>
              <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', fontWeight: 600, marginTop: 2 }}>{im.tipo} · {im.cidade||im.estado||''}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ background: s.bg, color: s.c, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20 }}>{s.l}</span>
            <button onClick={e => { e.stopPropagation(); isFav ? removerFav(im.id) : excluir(im.id); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
              <Trash2 size={13}/>
            </button>
          </div>
        </div>
        <div style={{ padding: '12px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase' }}>Arremate</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#1e293b', marginTop: 2 }}>R$ {fmt(im.valorArrematacao||im.valorMinimo||0, 0)}</div>
            </div>
            <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '8px 10px' }}>
              <div style={{ fontSize: 9, color: '#16a34a', fontWeight: 700, textTransform: 'uppercase' }}>Mercado</div>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#15803d', marginTop: 2 }}>R$ {fmt(im.valorMercado||0, 0)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={e => { e.stopPropagation(); nav('/analise', { state: { imovel: im } }); }}
              style={{ flex: 1, padding: '8px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <BarChart3 size={13}/> Abrir Análise
            </button>
            {im.parecer && <button onClick={e => { e.stopPropagation(); alert('PDF: abra a análise e clique em PDF'); }}
              style={{ padding: '8px 12px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              <FileText size={13} color="#64748b"/>
            </button>}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 20px' }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: '#0f172a' }}>Meu Painel</h1>
          <p style={{ margin: '4px 0 0', fontSize: 14, color: '#64748b' }}>Portfólio e acompanhamento de imóveis</p>
        </div>
        <button onClick={() => nav('/analise')} style={{ padding: '10px 18px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Plus size={15}/> Nova Análise
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 14, marginBottom: 28 }}>
        {[
          { l:'Imóveis no Portfólio', v:imoveis.length, c:'#2563eb', bg:'#dbeafe', icon:Building2 },
          { l:'Total Arrematação', v:`R$ ${fmt(totalArremate,0)}`, c:'#ef4444', bg:'#fee2e2', icon:DollarSign },
          { l:'VGV Total', v:`R$ ${fmt(totalVGV,0)}`, c:'#10b981', bg:'#d1fae5', icon:TrendingUp },
          { l:'Lucro Estimado', v:`R$ ${fmt(lucroEst,0)}`, c:'#8b5cf6', bg:'#ede9fe', icon:BarChart3 },
          { l:'Aprovados/Ativos', v:aprovados, c:'#f59e0b', bg:'#fef3c7', icon:CheckCircle2 },
          { l:'Favoritos Salvos', v:favoritos.length, c:'#dc2626', bg:'#fee2e2', icon:Heart },
        ].map((k,i) => (
          <div key={i} style={{ background: 'white', borderRadius: 14, padding: 18, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: k.bg, borderRadius: 10, padding: 10 }}><k.icon size={18} color={k.c}/></div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>{k.v}</div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 3 }}>{k.l}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Status breakdown */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '16px 20px', marginBottom: 20, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {Object.entries(STATUS_CONFIG).map(([k, s]) => {
          const count = imoveis.filter(i => i.status === k).length;
          if (count === 0) return null;
          return (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, background: s.bg, borderRadius: 20, padding: '5px 12px' }}>
              <s.icon size={12} color={s.c}/>
              <span style={{ fontSize: 12, fontWeight: 700, color: s.c }}>{s.l}: {count}</span>
            </div>
          );
        })}
      </div>

      {/* Abas */}
      <div style={{ display: 'flex', gap: 4, background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 4, marginBottom: 16, width: 'fit-content' }}>
        {ABAS.map(a => (
          <button key={a.id} onClick={() => setAba(a.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', border: 'none', borderRadius: 10, background: aba===a.id?'#0f172a':'transparent', color: aba===a.id?'white':'#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            <a.icon size={14}/> {a.label}
          </button>
        ))}
      </div>

      {aba === 'portfolio' && (
        imoveis.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '70px 20px', background: 'white', borderRadius: 16, border: '2px dashed #cbd5e1' }}>
            <Building2 size={48} color="#94a3b8" style={{ margin: '0 auto 16px' }}/>
            <h3 style={{ color: '#334155', fontWeight: 900, margin: '0 0 8px' }}>Portfólio vazio</h3>
            <p style={{ color: '#94a3b8', marginBottom: 24, fontSize: 14 }}>Salve análises de imóveis para acompanhar aqui.</p>
            <button onClick={() => nav('/analise')} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, padding: '11px 24px', fontWeight: 700, cursor: 'pointer' }}>
              Fazer Primeira Análise
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {imoveis.map(im => <CardImovel key={im.id} im={im}/>)}
          </div>
        )
      )}

      {aba === 'favoritos' && (
        favoritos.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '70px 20px', background: 'white', borderRadius: 16, border: '2px dashed #cbd5e1' }}>
            <Heart size={48} color="#94a3b8" style={{ margin: '0 auto 16px' }}/>
            <h3 style={{ color: '#334155', fontWeight: 900, margin: '0 0 8px' }}>Nenhum favorito</h3>
            <p style={{ color: '#94a3b8', fontSize: 14 }}>Favorite imóveis na busca para acompanhá-los aqui.</p>
            <button onClick={() => nav('/buscar')} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, padding: '11px 24px', fontWeight: 700, cursor: 'pointer', marginTop: 16 }}>
              Buscar Imóveis
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
            {favoritos.map(im => <CardImovel key={im.id} im={im} isFav/>)}
          </div>
        )
      )}
    </div>
  );
}
