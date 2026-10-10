import React, { useMemo } from 'react';
import { organizarDescricao } from '../utils/descricaoOrganizada';

// Descrição do leiloeiro em BLOCOS (10/10, pedido do dono: "não ficar amontoada a informação").
// A quebra é de src/utils/descricaoOrganizada.js (pura, testada); aqui só a apresentação.
// `formatar` (opcional) é aplicado a cada trecho de texto — o imóvel passa formatarDescricaoImovel.
const ROTULO_NA_FRENTE = /^([A-Za-zÀ-ú0-9º°()/ .]{2,40}):\s+(.*)$/;

function ComRotulo({ texto }) {
  const m = String(texto).match(ROTULO_NA_FRENTE);
  if (!m) return texto;
  return <><b style={{ color: '#0f172a' }}>{m[1]}:</b> {m[2]}</>;
}

export default function DescricaoOrganizada({ texto, formatar = (t) => t, tamanho = 13.5 }) {
  const blocos = useMemo(() => organizarDescricao(texto), [texto]);
  if (!blocos.length) return null;
  const f = (t) => formatar(t) || t;
  const titulo = { fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.4, margin: '0 0 6px' };
  const corpo = { fontSize: tamanho, color: '#334155', lineHeight: 1.6 };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {blocos.map((b, i) => {
        if (b.tipo === 'intro') return <div key={i} style={{ ...corpo, fontWeight: 700, color: '#0f172a' }}>{b.texto}</div>;
        if (b.tipo === 'campos') return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '8px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}>
            {b.itens.map(([k, v], j) => (
              <div key={j} style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600 }}>{k}</div>
                <div style={{ fontSize: tamanho - 0.5, color: '#0f172a', fontWeight: 700, overflowWrap: 'anywhere' }}>{v}</div>
              </div>
            ))}
          </div>
        );
        if (b.tipo === 'checklist') return (
          <div key={i}>
            <div style={titulo}>Itens e acessórios</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {b.tem.map((x, j) => <span key={`t${j}`} style={{ fontSize: 12, padding: '3px 9px', borderRadius: 999, background: '#ecfdf5', color: '#047857', border: '1px solid #a7f3d0', fontWeight: 600 }}>✓ {x}</span>)}
              {b.naoTem.map((x, j) => <span key={`n${j}`} style={{ fontSize: 12, padding: '3px 9px', borderRadius: 999, background: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0', textDecoration: 'line-through' }}>{x}</span>)}
            </div>
          </div>
        );
        if (b.tipo === 'lista') return (
          <div key={i}>
            <div style={titulo}>{b.titulo}</div>
            <ul style={{ ...corpo, margin: 0, paddingLeft: 18 }}>{b.itens.map((x, j) => <li key={j}>{f(x)}</li>)}</ul>
          </div>
        );
        if (b.tipo === 'linhas') return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {b.itens.map((l, j) => l.marcador
              ? <div key={j} style={{ ...corpo, display: 'flex', gap: 8 }}><span style={{ color: '#94a3b8' }}>•</span><span><ComRotulo texto={f(l.texto)} /></span></div>
              : <div key={j} style={corpo}><ComRotulo texto={f(l.texto)} /></div>)}
          </div>
        );
        if (b.tipo === 'paragrafos') return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {b.itens.map((p, j) => <p key={j} style={{ ...corpo, margin: 0 }}><ComRotulo texto={f(p)} /></p>)}
          </div>
        );
        return null;
      })}
    </div>
  );
}
