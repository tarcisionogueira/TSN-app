import React from 'react';
import { Building2, TrendingUp, AlertTriangle, CheckCircle2, Clock, XCircle, Home, Warehouse, LayoutGrid, Trash2, PlusCircle, BarChart3, DollarSign, Calendar } from 'lucide-react';
import { fmt } from '../utils/calculos';

const STATUS_CONFIG = {
  analise: { label: 'Em Análise', color: '#f59e0b', bg: '#fef3c7', icon: Clock },
  aprovado: { label: 'Aprovado', color: '#10b981', bg: '#d1fae5', icon: CheckCircle2 },
  arrematado: { label: 'Arrematado', color: '#2563eb', bg: '#dbeafe', icon: CheckCircle2 },
  em_reforma: { label: 'Em Reforma', color: '#8b5cf6', bg: '#ede9fe', icon: Building2 },
  venda: { label: 'À Venda', color: '#f97316', bg: '#ffedd5', icon: TrendingUp },
  alugado: { label: 'Alugado', color: '#06b6d4', bg: '#cffafe', icon: Home },
  concluido: { label: 'Concluído', color: '#64748b', bg: '#f1f5f9', icon: CheckCircle2 },
  reprovado: { label: 'Reprovado', color: '#ef4444', bg: '#fee2e2', icon: XCircle },
};

const TIPO_ICONS = { casa: Home, apartamento: Building2, terreno: LayoutGrid, comercial: Warehouse };

export default function Portfolio({ imoveis, onAbrir, onNovo, onExcluir }) {
  const totais = imoveis.reduce((acc, im) => {
    acc.total++;
    acc.valorTotal += Number(im.valorArrematacao) || 0;
    acc.aprovados += im.status === 'aprovado' ? 1 : 0;
    acc.arrematados += ['arrematado','em_reforma','venda','alugado','concluido'].includes(im.status) ? 1 : 0;
    return acc;
  }, { total: 0, valorTotal: 0, aprovados: 0, arrematados: 0 });

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '24px 20px' }}>
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 28 }}>
        {[
          { label: 'Imóveis Cadastrados', value: totais.total, icon: Building2, color: '#2563eb', bg: '#dbeafe' },
          { label: 'Valor Total Portfólio', value: `R$ ${fmt(totais.valorTotal, 0)}`, icon: DollarSign, color: '#10b981', bg: '#d1fae5' },
          { label: 'Aprovados / Ativos', value: totais.aprovados + totais.arrematados, icon: CheckCircle2, color: '#8b5cf6', bg: '#ede9fe' },
          { label: 'Concluídos', value: imoveis.filter(i => i.status === 'concluido').length, icon: BarChart3, color: '#f59e0b', bg: '#fef3c7' },
        ].map((stat, i) => (
          <div key={i} style={{ background: 'white', borderRadius: 16, padding: 20, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: stat.bg, borderRadius: 10, padding: 10 }}>
                <stat.icon size={20} color={stat.color} />
              </div>
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>{stat.value}</div>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginTop: 3 }}>{stat.label}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Grid de imóveis */}
      {imoveis.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px 20px', background: 'white', borderRadius: 20, border: '2px dashed #cbd5e1' }}>
          <Building2 size={56} color="#94a3b8" style={{ margin: '0 auto 16px' }} />
          <h2 style={{ color: '#334155', fontWeight: 900, fontSize: 22, margin: '0 0 8px' }}>Nenhum imóvel cadastrado</h2>
          <p style={{ color: '#94a3b8', marginBottom: 24 }}>Clique em "Novo Imóvel" para iniciar sua análise de leilão.</p>
          <button onClick={onNovo} style={{ background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, padding: '12px 24px', fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <PlusCircle size={16} /> Cadastrar Primeiro Imóvel
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {imoveis.map(im => {
            const status = STATUS_CONFIG[im.status] || STATUS_CONFIG.analise;
            const TipoIcon = TIPO_ICONS[im.tipoImovel] || Building2;
            const StatusIcon = status.icon;
            return (
              <div key={im.id} onClick={() => onAbrir(im)}
                style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', cursor: 'pointer', overflow: 'hidden', boxShadow: '0 2px 6px rgba(0,0,0,0.06)', transition: 'transform 0.15s, box-shadow 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)'; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.06)'; }}>
                <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ background: '#dbeafe', borderRadius: 8, padding: 8 }}>
                      <TipoIcon size={18} color="#2563eb" />
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a', lineHeight: 1.2 }}>
                        {im.nome || 'Sem nome'}
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, textTransform: 'uppercase', fontWeight: 600, letterSpacing: 0.5 }}>
                        {im.tipoImovel} · {im.origem}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ background: status.bg, color: status.color, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 20, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <StatusIcon size={10} /> {status.label}
                    </span>
                    <button onClick={e => { e.stopPropagation(); if(confirm('Excluir este imóvel?')) onExcluir(im.id); }}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div style={{ padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: '#64748b', marginBottom: 12, lineHeight: 1.4 }}>
                    {im.endereco ? im.endereco.substring(0, 80) + (im.endereco.length > 80 ? '...' : '') : 'Endereço não informado'}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>ARREMATAÇÃO</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: '#1e293b' }}>R$ {fmt(im.valorArrematacao, 0)}</div>
                    </div>
                    <div style={{ background: '#f0fdf4', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 600 }}>VGV / MERCADO</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: '#15803d' }}>R$ {fmt(im.valorMercado, 0)}</div>
                    </div>
                  </div>
                  {im.updatedAt && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 10, color: '#94a3b8', fontSize: 10 }}>
                      <Calendar size={10} /> Atualizado: {new Date(im.updatedAt).toLocaleDateString('pt-BR')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
