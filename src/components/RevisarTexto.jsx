import React, { useState } from 'react';
import { Loader2, SpellCheck } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

// CORREÇÃO ORTOGRÁFICA SUGERIDA (30/09, dono: "manter um bom padrão de resposta" nos e-mails).
// Botão ao lado da caixa de texto: pede a revisão (api/revisar-texto.js), MOSTRA o que mudaria
// e só troca o texto se a pessoa clicar em Aplicar. O sublinhado nativo do navegador fica ligado
// na própria textarea (`spellCheck` + `lang="pt-BR"`) — este botão cobre o que ele não pega
// (acentuação, concordância, maiúscula no fechamento).
export default function RevisarTexto({ texto, onAplicar, style }) {
  const [estado, setEstado] = useState(null); // null | 'carregando' | { corrigido, mudancas, motivo } | { erro }

  const revisar = async () => {
    setEstado('carregando');
    try {
      const r = await apiCall('/api/revisar-texto', { method: 'POST', body: JSON.stringify({ texto }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) { setEstado({ erro: j?.error || 'Revisão indisponível agora.' }); return; }
      setEstado({ corrigido: j.corrigido, mudancas: j.mudancas || [], motivo: j.motivo || null, base: texto });
    } catch { setEstado({ erro: 'Revisão indisponível agora.' }); }
  };

  const desatualizada = estado && typeof estado === 'object' && estado.base !== undefined && estado.base !== texto;
  const caixa = { marginTop: 6, padding: '8px 10px', borderRadius: 8, fontSize: 11.5, lineHeight: 1.5 };

  return (
    <div style={style}>
      <button type="button" onClick={revisar} disabled={estado === 'carregando' || !String(texto || '').trim()}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'none', border: '1px solid #cbd5e1', borderRadius: 6, padding: '4px 9px', fontSize: 11.5, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
        {estado === 'carregando' ? <Loader2 size={12} className="animate-spin" /> : <SpellCheck size={12} />} Revisar ortografia
      </button>
      {estado?.erro && <div style={{ ...caixa, background: '#fef2f2', color: '#b91c1c' }}>{estado.erro}</div>}
      {estado?.motivo && <div style={{ ...caixa, background: '#fffbeb', color: '#92400e' }}>Sem sugestão segura: {estado.motivo}</div>}
      {estado?.corrigido != null && !estado.motivo && !desatualizada && (
        estado.corrigido === estado.base
          ? <div style={{ ...caixa, background: '#f0fdf4', color: '#15803d' }}>✓ Nenhuma correção encontrada.</div>
          : (
            <div style={{ ...caixa, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a' }}>
              <b>Correções sugeridas:</b>
              <ul style={{ margin: '4px 0 6px', paddingLeft: 18 }}>
                {(estado.mudancas.length ? estado.mudancas : [{ de: '(ajustes de pontuação/formatação)', para: '' }]).map((m, i) => (
                  <li key={i}><span style={{ textDecoration: m.para ? 'line-through' : 'none', color: '#64748b' }}>{m.de}</span>{m.para ? <> → <b>{m.para}</b></> : null}</li>
                ))}
              </ul>
              <button type="button" onClick={() => { onAplicar(estado.corrigido); setEstado(null); }}
                style={{ background: '#0D63DB', color: 'white', border: 'none', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 700, cursor: 'pointer', marginRight: 6 }}>Aplicar</button>
              <button type="button" onClick={() => setEstado(null)}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>Manter como está</button>
            </div>
          )
      )}
    </div>
  );
}
