import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { fmt } from '../utils/calculos';

export default function TabelaAmortizacao({ sacTabela, priceTabela, d }) {
  const [open, setOpen] = useState(false);
  const [vista, setVista] = useState('sac');
  if (sacTabela.length === 0) return null;
  const tabela = vista === 'sac' ? sacTabela : priceTabela;
  const total = tabela.reduce((s, r) => ({ parcela: s.parcela + r.parcela, juros: s.juros + r.juros, amortizacao: s.amortizacao + r.amortizacao }), { parcela: 0, juros: 0, amortizacao: 0 });

  return (
    <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', padding: '14px 18px', background: '#111111', color: 'white', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700 }}>
        <span>Tabela de Amortização SAC / PRICE</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && (
        <div>
          <div style={{ display: 'flex', gap: 8, padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
            {[['sac','SAC (Sistema de Amortização Constante)'],['price','PRICE (Prestações Iguais)']].map(([v, l]) => (
              <button key={v} onClick={() => setVista(v)}
                style={{ padding: '6px 14px', border: 'none', borderRadius: 8, background: vista === v ? '#111111' : '#f1f5f9', color: vista === v ? 'white' : '#64748b', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                {l}
              </button>
            ))}
          </div>
          <div style={{ padding: '0 16px 12px', fontSize: 12, color: '#64748b', display: 'flex', gap: 20 }}>
            <span>Total pago: <b style={{ color: '#dc2626' }}>R$ {fmt(total.parcela)}</b></span>
            <span>Total juros: <b style={{ color: '#f97316' }}>R$ {fmt(total.juros)}</b></span>
            <span>Principal: <b>R$ {fmt(total.amortizacao)}</b></span>
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
                <tr>{['Mês','Parcela','Amortização','Juros','Saldo Devedor'].map(h => (
                  <th key={h} style={{ padding: '8px 10px', textAlign: h === 'Mês' ? 'left' : 'right', fontWeight: 700, color: '#475569', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {tabela.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '7px 10px' }}>{r.mes}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#dc2626' }}>R$ {fmt(r.parcela)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right' }}>R$ {fmt(r.amortizacao)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#f97316' }}>R$ {fmt(r.juros)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 600, color: '#084BA6' }}>R$ {fmt(r.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
