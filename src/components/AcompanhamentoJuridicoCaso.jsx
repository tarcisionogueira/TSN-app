import { useState } from 'react';
import { Mail, Loader2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../utils/supabase';

/**
 * Comunicação automática do caso com o JURÍDICO (17/10; ampliado 12/11, pedido do dono). Quem lê:
 * api/casos-acompanhamento-cron.js.
 *  - Para/Cc: valem quando o caso NÃO tem advogado vinculado (com advogado, vão os e-mails do cadastro dele).
 *  - Pedido de ATUALIZAÇÃO e pedido da GUIA de cada parcela: liga/desliga separado, valendo para qualquer caso
 *    (antes o único "ligado" era ignorado em caso com advogado vinculado).
 *  - Frequência da atualização: 7/14/21/28 dias, sempre às segundas. Escolhida aqui, a leitura das devolutivas
 *    (juridico-devolutivas-cron) não sobrescreve mais (acompanhamento_intervalo_manual).
 *  - Copiar o cliente: o cliente vai em cópia nesses e-mails e vem marcado por padrão ao responder e-mail do
 *    caso na caixa (CaixaEmail).
 * Só operação ARREMATADA recebe lembrete (regra do dono, 17/10) — o cron já filtra pela etapa.
 */
const RE_EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const lista = (t) => [...new Set(String(t || '').split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))];
const ETAPAS_ARREMATE = ['arrematado', 'honorarios_pagos', 'procuracao_assinada', 'pos_arrematacao'];
const INTERVALOS = [[7, 'Toda semana'], [14, 'A cada 2 semanas'], [21, 'A cada 3 semanas'], [28, 'A cada 4 semanas']];

export default function AcompanhamentoJuridicoCaso({ caso, onSalvo, cardStyle }) {
  const [para, setPara] = useState((caso.acompanhamento_para || []).join(', '));
  const [cc, setCc] = useState((caso.acompanhamento_cc || []).join(', '));
  const [intervalo, setIntervalo] = useState(caso.acompanhamento_intervalo_dias || 7);
  // Caso sem advogado: o envio só sai depois do 1º "ligado" (aprovação do rascunho). Com advogado, sai sempre.
  const [ligado, setLigado] = useState(Boolean(caso.acompanhamento_liberado_em));
  const [atualizacao, setAtualizacao] = useState(caso.acompanhamento_atualizacao_ativa !== false);
  const [guia, setGuia] = useState(caso.acompanhamento_guia_ativa !== false);
  const [copiarCliente, setCopiarCliente] = useState(Boolean(caso.copiar_cliente));
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState({ ok: '', erro: '' });

  const salvar = async () => {
    setMsg({ ok: '', erro: '' });
    const lp = lista(para), lc = lista(cc).filter((e) => !lp.includes(e));
    const invalido = [...lp, ...lc].find((e) => !RE_EMAIL.test(e));
    if (invalido) { setMsg({ ok: '', erro: `E-mail inválido: ${invalido}` }); return; }
    if (ligado && !lp.length && !caso.advogado_id) { setMsg({ ok: '', erro: 'Informe ao menos um e-mail em "Para" (o caso não tem advogado vinculado).' }); return; }
    const dias = INTERVALOS.some(([d]) => d === Number(intervalo)) ? Number(intervalo) : 7;
    setSalvando(true);
    // .select() prova o que mudou: RLS que não deixa gravar devolve error null e zero linhas.
    const { data, error } = await supabase.from('casos').update({
      acompanhamento_para: lp.length ? lp : null,
      acompanhamento_cc: lc.length ? lc : null,
      acompanhamento_intervalo_dias: dias,
      acompanhamento_intervalo_manual: true,
      acompanhamento_liberado_em: ligado ? (caso.acompanhamento_liberado_em || new Date().toISOString()) : null,
      acompanhamento_atualizacao_ativa: atualizacao,
      acompanhamento_guia_ativa: guia,
      copiar_cliente: copiarCliente,
    }).eq('id', caso.id).select('id, acompanhamento_para, acompanhamento_cc, acompanhamento_intervalo_dias, acompanhamento_intervalo_manual, acompanhamento_liberado_em, acompanhamento_atualizacao_ativa, acompanhamento_guia_ativa, copiar_cliente');
    setSalvando(false);
    if (error || !data?.length) { setMsg({ ok: '', erro: `Não salvou: ${error?.message || 'sem permissão para alterar este caso'}` }); return; }
    setIntervalo(dias);
    setMsg({ ok: 'Salvo. Vale a partir do próximo envio.', erro: '' });
    onSalvo?.(data[0]);
  };

  const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' };
  const lbl = { fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 4 };
  const chk = { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: '#1e293b', lineHeight: 1.4, cursor: 'pointer' };
  const nota = { display: 'block', fontSize: 11.5, color: '#64748b' };
  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, fontSize: 15, marginBottom: 6 }}>
        <Mail size={16} /> Andamento com o jurídico
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: '#64748b', lineHeight: 1.5 }}>
        E-mails automáticos ao escritório pedindo atualização do processo e a guia de cada parcela.
        {caso.advogado_id ? ' Com advogado vinculado, vão para os e-mails do cadastro dele.' : ''}
      </p>
      {!ETAPAS_ARREMATE.includes(caso.status_etapa) && (
        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px' }}>
          Os pedidos automáticos começam depois do arremate. Até lá, vale só a cópia ao cliente ao responder e-mail deste caso.
        </p>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        {!caso.advogado_id && (
          <>
            <div><label style={lbl}>Para</label><input style={inp} value={para} onChange={(e) => setPara(e.target.value)} placeholder="email@escritorio.adv.br" inputMode="email" /></div>
            <div><label style={lbl}>Cópia</label><input style={inp} value={cc} onChange={(e) => setCc(e.target.value)} placeholder="separe por vírgula" inputMode="email" /></div>
            <label style={chk}><input type="checkbox" checked={ligado} onChange={(e) => setLigado(e.target.checked)} />
              <span>Envio automático liberado<span style={nota}>Desligado, nada sai para o escritório deste caso.</span></span></label>
          </>
        )}
        <label style={chk}><input type="checkbox" checked={atualizacao} onChange={(e) => setAtualizacao(e.target.checked)} />
          <span>Pedir atualização do processo<span style={nota}>Sai às segundas de manhã, na frequência abaixo.</span></span></label>
        <div style={{ paddingLeft: 26, opacity: atualizacao ? 1 : 0.5 }}>
          <label style={lbl}>Frequência do pedido de atualização</label>
          <select style={{ ...inp, width: 220 }} value={Number(intervalo)} disabled={!atualizacao} onChange={(e) => setIntervalo(Number(e.target.value))}>
            {INTERVALOS.map(([d, t]) => <option key={d} value={d}>{t}</option>)}
          </select>
          {!caso.acompanhamento_intervalo_manual && <span style={{ ...nota, marginTop: 4 }}>Hoje ajustada pela leitura das respostas do escritório; ao salvar, passa a valer a sua escolha.</span>}
        </div>
        <label style={chk}><input type="checkbox" checked={guia} onChange={(e) => setGuia(e.target.checked)} />
          <span>Pedir a guia de cada parcela<span style={nota}>5 dias antes do vencimento, e de novo na véspera se a guia não chegou.</span></span></label>
        <label style={chk}><input type="checkbox" checked={copiarCliente} onChange={(e) => setCopiarCliente(e.target.checked)} />
          <span>Copiar o cliente nas comunicações com o jurídico<span style={nota}>O cliente vai em cópia nesses e-mails (e recebe as respostas do escritório com "Responder a todos"), e vem marcado ao responder e-mail deste caso na caixa.</span></span></label>
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
