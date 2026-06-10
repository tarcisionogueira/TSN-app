import React, { useState } from 'react';
import { ShieldAlert, Plus, Trash2, AlertTriangle, XCircle, Info } from 'lucide-react';

const RISCOS_COMUNS = [
  { texto: 'Usufruto vitalício — impossibilita a posse imediata do imóvel', tipo: 'bloqueante' },
  { texto: 'Ação de nulidade em curso — risco de desfazimento do arremate', tipo: 'bloqueante' },
  { texto: 'Bem de família declarado judicialmente', tipo: 'bloqueante' },
  { texto: 'Aforamento com direito de preferência da União/Município', tipo: 'alerta' },
  { texto: 'Laudêmio pendente — custo adicional no registro', tipo: 'alerta' },
  { texto: 'Imóvel em área de preservação ambiental (APP)', tipo: 'alerta' },
  { texto: 'Pendência de ITBI anterior não quitado', tipo: 'alerta' },
  { texto: 'Irregularidade construtiva — pode exigir regularização', tipo: 'informativo' },
  { texto: 'Débitos de condomínio além dos informados no edital', tipo: 'informativo' },
  { texto: 'Imóvel com locatário — necessidade de notificação extrajudicial', tipo: 'informativo' },
];

const TIPO_CONFIG = {
  bloqueante: { label: 'Bloqueante', color: '#dc2626', bg: '#fee2e2', icon: XCircle },
  alerta: { label: 'Alerta', color: '#d97706', bg: '#fef3c7', icon: AlertTriangle },
  informativo: { label: 'Informativo', color: '#2563eb', bg: '#dbeafe', icon: Info },
};

export default function RiscoJuridico({ riscos, onChange }) {
  const [texto, setTexto] = useState('');
  const [tipo, setTipo] = useState('alerta');

  const adicionar = () => {
    if (!texto.trim()) return;
    onChange([...riscos, { id: Date.now(), texto: texto.trim(), tipo }]);
    setTexto('');
  };

  const remover = (id) => onChange(riscos.filter(r => r.id !== id));

  const adicionarComum = (r) => {
    if (!riscos.find(ex => ex.texto === r.texto)) {
      onChange([...riscos, { id: Date.now(), ...r }]);
    }
  };

  const temBloqueante = riscos.some(r => r.tipo === 'bloqueante');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {temBloqueante && (
        <div style={{ background: '#fef2f2', border: '2px solid #dc2626', borderRadius: 10, padding: 12, display: 'flex', gap: 8 }}>
          <XCircle size={18} color="#dc2626" style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12, fontWeight: 700, color: '#b91c1c' }}>
            ATENÇÃO: Existem riscos BLOQUEANTES que podem impossibilitar a posse do imóvel. Consulte advogado antes de arrematar.
          </div>
        </div>
      )}

      {/* Lista de riscos cadastrados */}
      {riscos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {riscos.map(r => {
            const cfg = TIPO_CONFIG[r.tipo] || TIPO_CONFIG.informativo;
            return (
              <div key={r.id} style={{ background: cfg.bg, border: `1px solid ${cfg.color}40`, borderRadius: 8, padding: '8px 12px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <cfg.icon size={14} color={cfg.color} style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, fontSize: 12, color: '#334155', lineHeight: 1.4 }}>{r.texto}</div>
                <span style={{ fontSize: 9, fontWeight: 800, color: cfg.color, background: 'white', padding: '2px 6px', borderRadius: 10, flexShrink: 0 }}>{cfg.label}</span>
                <button onClick={() => remover(r.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, flexShrink: 0 }}>
                  <Trash2 size={13} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Adicionar novo */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase' }}>Adicionar Risco</div>
        <textarea value={texto} onChange={e => setTexto(e.target.value)} placeholder="Descreva o risco jurídico identificado..."
          style={{ width: '100%', padding: '8px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, resize: 'vertical', minHeight: 60 }} />
        <div style={{ display: 'flex', gap: 8 }}>
          {Object.entries(TIPO_CONFIG).map(([v, cfg]) => (
            <button key={v} onClick={() => setTipo(v)}
              style={{ flex: 1, padding: '6px', border: `2px solid ${tipo === v ? cfg.color : '#e2e8f0'}`, borderRadius: 8, background: tipo === v ? cfg.bg : 'white', color: cfg.color, fontWeight: 700, fontSize: 10, cursor: 'pointer' }}>
              {cfg.label}
            </button>
          ))}
        </div>
        <button onClick={adicionar} style={{ width: '100%', padding: '8px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12 }}>
          <Plus size={14} /> Adicionar
        </button>
      </div>

      {/* Riscos comuns */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 8 }}>Riscos Frequentes (clique para adicionar)</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {RISCOS_COMUNS.map((r, i) => {
            const cfg = TIPO_CONFIG[r.tipo];
            const jaAdicionado = riscos.some(ex => ex.texto === r.texto);
            return (
              <button key={i} onClick={() => adicionarComum(r)} disabled={jaAdicionado}
                style={{ textAlign: 'left', padding: '7px 10px', border: `1px solid ${cfg.color}30`, borderRadius: 8, background: jaAdicionado ? '#f1f5f9' : cfg.bg, cursor: jaAdicionado ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: jaAdicionado ? 0.5 : 1 }}>
                <cfg.icon size={12} color={cfg.color} style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: '#334155', lineHeight: 1.3 }}>{r.texto}</span>
                <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, marginLeft: 'auto', flexShrink: 0 }}>{cfg.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
