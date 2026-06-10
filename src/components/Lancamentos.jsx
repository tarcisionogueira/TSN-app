import React, { useState } from 'react';
import { Plus, Trash2, DollarSign, TrendingUp, TrendingDown } from 'lucide-react';
import { fmt } from '../utils/calculos';

const CATEGORIAS = ['Arrematação','Sinal','Parcela Banco','Reforma','ITBI/Registro','Honorários','Débitos','IPTU','Condomínio','Laudêmio','Foreiro','Receita de Aluguel','Receita de Venda','Outros'];

export default function Lancamentos({ lancamentos, onChange }) {
  const [form, setForm] = useState({ data: new Date().toISOString().slice(0, 10), descricao: '', categoria: 'Outros', valor: '', tipo: 'saida' });

  const adicionar = () => {
    if (!form.descricao || !form.valor) return;
    onChange([...lancamentos, { id: Date.now(), ...form, valor: parseFloat(form.valor) }]);
    setForm(prev => ({ ...prev, descricao: '', valor: '' }));
  };

  const remover = (id) => onChange(lancamentos.filter(l => l.id !== id));

  const totais = lancamentos.reduce((acc, l) => {
    if (l.tipo === 'entrada') acc.entradas += l.valor;
    else acc.saidas += l.valor;
    return acc;
  }, { entradas: 0, saidas: 0 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Resumo */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
        {[
          { label: 'Saídas', value: totais.saidas, color: '#dc2626', bg: '#fef2f2' },
          { label: 'Entradas', value: totais.entradas, color: '#10b981', bg: '#d1fae5' },
          { label: 'Saldo', value: totais.entradas - totais.saidas, color: (totais.entradas - totais.saidas) >= 0 ? '#2563eb' : '#dc2626', bg: '#eff6ff' },
        ].map((s, i) => (
          <div key={i} style={{ background: s.bg, borderRadius: 10, padding: '10px 12px', textAlign: 'center' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>{s.label}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: s.color, marginTop: 3 }}>R$ {fmt(s.value, 0)}</div>
          </div>
        ))}
      </div>

      {/* Formulário */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Novo Lançamento</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <input type="date" value={form.data} onChange={e => setForm(p => ({ ...p, data: e.target.value }))}
            style={{ padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
          <select value={form.tipo} onChange={e => setForm(p => ({ ...p, tipo: e.target.value }))}
            style={{ padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 700, background: form.tipo === 'entrada' ? '#d1fae5' : '#fee2e2', color: form.tipo === 'entrada' ? '#065f46' : '#b91c1c' }}>
            <option value="saida">Saída (-)</option>
            <option value="entrada">Entrada (+)</option>
          </select>
        </div>
        <select value={form.categoria} onChange={e => setForm(p => ({ ...p, categoria: e.target.value }))}
          style={{ padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, background: 'white' }}>
          {CATEGORIAS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <input placeholder="Descrição" value={form.descricao} onChange={e => setForm(p => ({ ...p, descricao: e.target.value }))}
          style={{ padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" placeholder="Valor (R$)" value={form.valor} onChange={e => setForm(p => ({ ...p, valor: e.target.value }))}
            style={{ flex: 1, padding: '7px 8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }} />
          <button onClick={adicionar} style={{ padding: '7px 14px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <Plus size={13} /> Lançar
          </button>
        </div>
      </div>

      {/* Lista */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 280, overflowY: 'auto' }}>
        {lancamentos.length === 0 && <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: 12, padding: 20 }}>Nenhum lançamento registrado</div>}
        {[...lancamentos].reverse().map(l => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'white', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ background: l.tipo === 'entrada' ? '#d1fae5' : '#fee2e2', borderRadius: 6, padding: 5 }}>
              {l.tipo === 'entrada' ? <TrendingUp size={12} color="#10b981" /> : <TrendingDown size={12} color="#dc2626" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.descricao}</div>
              <div style={{ fontSize: 10, color: '#94a3b8' }}>{l.data} · {l.categoria}</div>
            </div>
            <div style={{ fontWeight: 800, fontSize: 13, color: l.tipo === 'entrada' ? '#10b981' : '#dc2626', flexShrink: 0 }}>
              {l.tipo === 'entrada' ? '+' : '-'} R$ {fmt(l.valor, 0)}
            </div>
            <button onClick={() => remover(l.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}>
              <Trash2 size={12} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
