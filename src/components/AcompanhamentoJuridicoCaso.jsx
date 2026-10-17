import { useState } from 'react';
import { Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../utils/supabase';

/**
 * Destinatários e recorrência do e-mail de ANDAMENTO ao jurídico (17/10, pedido do dono: "autonomia" — antes só
 * mudava no banco). Quem lê: api/casos-acompanhamento-cron.js — Para/Cc valem quando o caso NÃO tem advogado
 * vinculado (com advogado, vão os e-mails do cadastro dele); o intervalo e o liga/desliga valem sempre.
 * Só operação ARREMATADA recebe lembrete (regra do dono, 17/10) — o cron já filtra pela etapa.
 */
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const lista = (t) => [...new Set(String(t || '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];

export default function AcompanhamentoJuridicoCaso({ caso, onSalvo, cardStyle }) {
  const [para, setPara] = useState((caso.acompanhamento_para || []).join(', '));
  const [cc, setCc] = useState((caso.acompanhamento_cc || []).join(', '));
  const [intervalo, setIntervalo] = useState(caso.acompanhamento_intervalo_dias || 7);
  const [ligado, setLigado] = useState(Boolean(caso.acompanhamento_liberado_em));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState({ ok: '', erro: '' });

  const salvar = async () => {
    setMsg({ ok: '', erro: '' });
    const lp = lista(para), lc = lista(cc).filter((e) => !lp.includes(e));
    const invalido = [...lp, ...lc].find((e) => !RE_EMAIL.test(e));
    if (invalido) { setMsg({ ok: '', erro: `E-mail inválido: ${invalido}` }); return; }
    if (ligado && !lp.length && !caso.advogado_id) { setMsg({ ok: '', erro: 'Informe ao menos um e-mail em "Para" (o caso não tem advogado vinculado).' }); return; }
    // O cron só conhece 7 (toda quarta) e 14 (quarta sim, quarta não). A leitura das respostas do escritório
    // (juridico-devolutivas-cron) também ajusta entre os dois.
    const dias = Number(intervalo) === 14 ? 14 : 7;
    setSalvando(true);
    // .select() prova o que mudou: RLS que não deixa gravar devolve error null e zero linhas.
    const { data, error } = await supabase.from('casos').update({
      acompanhamento_para: lp.length ? lp : null,
      acompanhamento_cc: lc.length ? lc : null,
      acompanhamento_intervalo_dias: dias,
      acompanhamento_liberado_em: ligado ? (caso.acompanhamento_liberado_em || new Date().toISOString()) : null,
    }).eq('id', caso.id).select('id, acompanhamento_para, acompanhamento_cc, acompanhamento_intervalo_dias, acompanhamento_liberado_em');
    setSalvando(false);
    if (error || !data?.length) { setMsg({ ok: '', erro: `Não salvou: ${error?.message || 'sem permissão para alterar este caso'}` }); return; }
    setIntervalo(dias);
    setMsg({ ok: 'Salvo. Vale a partir do próximo envio.', erro: '' });
    onSalvo?.(data[0]);
  };

  const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' };
  const lbl = { fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 };
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
        <Mail size={16} /> Andamento com o jurídico
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
        Pedido de atualização e da guia de cada parcela, enviado automaticamente.
        {caso.advogado_id ? ' Com advogado vinculado, vai para os e-mails do cadastro dele; aqui você ajusta a frequência e liga/desliga.' : ''}
      </p>
      <div style={{ display: 'grid', gap: 10 }}>
        <div><label style={lbl}>Para</label><input style={inp} value={para} onChange={(e) => setPara(e.target.value)} placeholder="email@escritorio.adv.br" inputMode="email" /></div>
        <div><label style={lbl}>Cópia</label><input style={inp} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="separe por vírgula" inputMode="email" /></div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div><label style={lbl}>Frequência (às quartas)</label>
            <select style={{ ...inp, width: 150 }} value={Number(intervalo) === 14 ? 14 : 7} onChange={(e) => setIntervalo(Number(e.target.value))}>
              <option value={7}>Semanal</option><option value={14}>Quinzenal</option>
            </select></div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 8 }}>
            <input type="checkbox" checked={ligado} onChange={(e) => setLigado(e.target.checked)} /> Envio automático ligado
          </label>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={salvar} disabled={salvando}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 8, border: 'none', background: '#0D63DB', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            {salvando ? <Loader2 size={14} /> : <CheckCircle2 size={14} />} Salvar
          </button>
          {msg.ok && <span style={{ fontSize: 12, color: '#15803d' }}>{msg.ok}</span>}
          {msg.erro && <span style={{ fontSize: 12, color: '#b91c1c' }}>{msg.erro}</span>}
        </div>
      </div>
    </div>
  );
}
