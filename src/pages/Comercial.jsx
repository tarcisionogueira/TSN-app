/**
 * ÁREA COMERCIAL — parceiro consultor de CONSÓRCIO e HOME EQUITY (F2 do plano
 * docs/PLANO_CONSULTOR_COMERCIAL.md; F1 = RPCs/regras no banco).
 *
 * O que esta tela promete (decisões do dono, 21/08):
 *   • Só leads de alavancagem atribuídos a MIM — o filtro é da RPC, não daqui.
 *   • Contato ESCONDIDO até o "Receber cliente" (2 cliques: o 2º confirma) —
 *     receber grava o evento e só então telefone/e-mail aparecem.
 *   • Cada passo vira evento imutável (trilha visível no card).
 *   • Finalizar exige resultado + comentário; perdido exige motivo. Quem valida é a
 *     RPC — a tela só conduz (regra na tela se contorna; no banco, não).
 *
 * Toda leitura confere `error` (postgrest-js não lança — forma #2 da casa).
 */
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { reportarErroCliente } from '../utils/reportarErro';
import {
  Briefcase, Phone, Mail, UserCheck, CheckCircle2, Clock, ChevronDown, ChevronUp,
  Loader2, Lock, MessageSquare, Flag, RefreshCw,
} from 'lucide-react';

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px' };
const PRODUTO_CFG = {
  'alavancagem_home_equity': { rot: 'Home Equity', cor: '#0f766e', bg: '#ccfbf1' },
  'alavancagem_consorcio':   { rot: 'Consórcio',   cor: '#084BA6', bg: '#dbeafe' },
};
const STATUS_CFG = {
  novo:           { rot: 'Aguardando recebimento', cor: '#854d0e', bg: '#fef9c3' },
  atribuido:      { rot: 'Aguardando recebimento', cor: '#854d0e', bg: '#fef9c3' },
  em_atendimento: { rot: 'Em atendimento',         cor: '#084BA6', bg: '#dbeafe' },
  finalizado:     { rot: 'Finalizado',             cor: '#475569', bg: '#f1f5f9' },
};
const MOTIVOS_PERDIDO = [
  ['sem_interesse', 'Cliente sem interesse'],
  ['nao_qualificou', 'Não qualificou (renda/garantia)'],
  ['fechou_por_fora', 'Fechou direto com a financeira'],
  ['outro', 'Outro motivo'],
];
const fmtData = (d) => { const x = d ? new Date(d) : null; return x && !isNaN(x) ? x.toLocaleDateString('pt-BR') : '—'; };
const diasDesde = (d) => { const x = d ? new Date(d) : null; return x && !isNaN(x) ? Math.floor((Date.now() - x.getTime()) / 86400000) : null; };
const soDigitos = (t) => String(t || '').replace(/\D/g, '');
// wa.me exige DDI: prefixa 55 só quando o número ainda não o tem (12+ dígitos com 55 = já tem).
const waNumero = (t) => { const d = soDigitos(t); return (d.startsWith('55') && d.length >= 12) ? d : `55${d}`; };

export default function Comercial() {
  const { user, loading: authLoading } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [semAcesso, setSemAcesso] = useState(false);
  const [erro, setErro] = useState('');
  const [expand, setExpand] = useState({});           // lead_id → bool (acompanhamento aberto)
  const [trilhas, setTrilhas] = useState({});         // lead_id → { eventos | erro }
  const [confirmaRec, setConfirmaRec] = useState(null); // lead_id aguardando o 2º clique do Receber
  const [busy, setBusy] = useState('');               // `${lead_id}:${acao}`
  const [feedback, setFeedback] = useState({});       // lead_id → texto do campo de feedback
  const [msgCard, setMsgCard] = useState({});         // lead_id → {tipo:'ok'|'erro', texto}
  const [modalFinal, setModalFinal] = useState(null); // lead em finalização
  const [finalForm, setFinalForm] = useState({ resultado: '', motivo: '', comentario: '' });

  const carregar = useCallback(async () => {
    // A RPC nega com "sem acesso comercial" para quem não tem a capacidade — esse
    // erro é ESTADO da tela (área restrita), não falha para o Cliente 360.
    const { data, error } = await supabase.rpc('comercial_meus_leads');
    if (error) {
      if (/sem acesso|nao autenticado/i.test(error.message || '')) setSemAcesso(true);
      else {
        setErro('Não foi possível carregar seus clientes. Tente novamente.');
        reportarErroCliente({ msg: `comercial_meus_leads: ${error.message}` });
      }
    } else {
      setLeads(Array.isArray(data) ? data : []);
      setSemAcesso(false); setErro('');
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (!authLoading && user) carregar(); }, [authLoading, user, carregar]);

  const carregarTrilha = useCallback(async (leadId) => {
    const { data, error } = await supabase.from('sdr_lead_eventos')
      .select('tipo, autor_papel, comentario, criado_em').eq('lead_id', leadId)
      .order('criado_em', { ascending: true });
    // `error` conferido: sem isso, falha de leitura viraria "trilha vazia" (forma #2).
    setTrilhas(prev => ({ ...prev, [leadId]: error ? { erro: true } : { eventos: data || [] } }));
  }, []);

  const toggleExpand = (leadId) => {
    setExpand(prev => {
      const abre = !prev[leadId];
      if (abre && !trilhas[leadId]) carregarTrilha(leadId);
      return { ...prev, [leadId]: abre };
    });
  };

  const pingCard = (leadId, tipo, texto) => {
    setMsgCard(prev => ({ ...prev, [leadId]: { tipo, texto } }));
    setTimeout(() => setMsgCard(prev => (prev[leadId]?.texto === texto ? { ...prev, [leadId]: null } : prev)), 6000);
  };

  // "Receber cliente" em DOIS cliques — o segundo é a confirmação pedida pelo dono:
  // receber = declarar que o atendimento começou, com registro em nome do consultor.
  const receber = async (lead) => {
    if (confirmaRec !== lead.id) { setConfirmaRec(lead.id); return; }
    setConfirmaRec(null);
    setBusy(`${lead.id}:receber`);
    const { error } = await supabase.rpc('comercial_receber_lead', { p_lead: lead.id });
    if (error) {
      pingCard(lead.id, 'erro', error.message || 'Não foi possível receber o cliente.');
      reportarErroCliente({ msg: `comercial_receber_lead: ${error.message}` });
    } else {
      await carregar();
      await carregarTrilha(lead.id);   // se o acompanhamento estiver aberto, já mostra o 'recebido'
      pingCard(lead.id, 'ok', 'Cliente recebido — atendimento registrado em seu nome. Bom trabalho!');
    }
    setBusy('');
  };

  const registrar = async (lead, tipo, comentario, extras = {}) => {
    setBusy(`${lead.id}:${tipo}`);
    const { error } = await supabase.rpc('comercial_registrar_evento', {
      p_lead: lead.id, p_tipo: tipo, p_comentario: comentario || null,
      p_resultado: extras.resultado || null, p_motivo: extras.motivo || null,
    });
    if (error) {
      pingCard(lead.id, 'erro', error.message || 'Não foi possível registrar.');
    } else {
      setFeedback(prev => ({ ...prev, [lead.id]: '' }));
      await carregar();
      await carregarTrilha(lead.id);
      const OK = {
        contato: 'Contato registrado.',
        feedback: 'Feedback registrado na trilha.',
        atendimento_confirmado: 'Atendimento confirmado! Em 15 dias o cliente recebe nossa pesquisa de satisfação.',
        finalizado: 'Cliente finalizado — obrigado pelo registro completo.',
        reaberto: 'Atendimento reaberto.',
      }[tipo] || 'Registrado.';
      pingCard(lead.id, 'ok', OK);
    }
    setBusy('');
    return !error;
  };

  const submeterFinal = async () => {
    if (!modalFinal) return;
    const ok = await registrar(modalFinal, 'finalizado', finalForm.comentario, {
      resultado: finalForm.resultado, motivo: finalForm.motivo || null,
    });
    if (ok) { setModalFinal(null); setFinalForm({ resultado: '', motivo: '', comentario: '' }); }
  };

  if (authLoading || loading) return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
      <Loader2 size={22} style={{ animation: 'spin 1s linear infinite', marginRight: 10 }} /> Carregando sua área comercial…
    </div>
  );

  if (semAcesso) return (
    <div style={{ maxWidth: 560, margin: '60px auto', padding: '0 20px', textAlign: 'center' }}>
      <div style={{ ...card, padding: '36px 28px' }}>
        <Lock size={34} color="#94a3b8" style={{ marginBottom: 12 }} />
        <div style={{ fontSize: 19, fontWeight: 900, color: '#111', marginBottom: 8 }}>Área do parceiro comercial</div>
        <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: 0 }}>
          Esta área é dos parceiros que atendem os pedidos de <b>consórcio</b> e <b>home equity</b> dos clientes.
          O acesso é liberado por convite da equipe BidPro — se você recebeu um convite de consultor, ative-o
          primeiro; se acredita que deveria ter acesso, fale com a equipe pelo Atendimento.
        </p>
      </div>
    </div>
  );

  const aguardando = leads.filter(l => !l.recebido_em && !l.finalizado_em);
  const emAtend = leads.filter(l => l.recebido_em && !l.finalizado_em);
  const finalizados = leads.filter(l => l.finalizado_em);

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Cabeçalho */}
      <div style={{ background: 'linear-gradient(135deg, #0D63DB 0%, #084BA6 100%)', borderRadius: 18, padding: '24px', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Briefcase size={22} />
          <div style={{ fontSize: 21, fontWeight: 900 }}>Área Comercial — Consórcio & Home Equity</div>
        </div>
        <div style={{ fontSize: 13, opacity: 0.95, marginTop: 8, lineHeight: 1.6 }}>
          Aqui chegam os clientes que <b>pediram contato</b> para consórcio ou home equity e foram atribuídos a você.
          Clique em <b>Receber cliente</b> para iniciar o atendimento — o contato aparece na hora e o início fica
          registrado em seu nome. Cada passo (contato, feedback, conclusão) entra na trilha do cliente.
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
        {[['Aguardando você', aguardando.length, '#b45309'], ['Em atendimento', emAtend.length, '#084BA6'], ['Finalizados', finalizados.length, '#475569']].map(([rot, n, cor]) => (
          <div key={rot} style={{ ...card, padding: '14px 16px' }}>
            <div style={{ fontSize: 26, fontWeight: 900, color: cor }}>{n}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b' }}>{rot}</div>
          </div>
        ))}
      </div>

      {erro && (
        <div style={{ ...card, borderColor: '#fecaca', background: '#fef2f2', color: '#b91c1c', fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 10 }}>
          {erro}
          <button onClick={() => { setLoading(true); carregar(); }} style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#b91c1c', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw size={13} /> Tentar de novo
          </button>
        </div>
      )}

      {!erro && leads.length === 0 && (
        <div style={{ ...card, textAlign: 'center', padding: '40px 24px', color: '#64748b' }}>
          <Clock size={28} color="#94a3b8" style={{ marginBottom: 10 }} />
          <div style={{ fontWeight: 800, color: '#334155', marginBottom: 6 }}>Nenhum cliente atribuído a você ainda</div>
          <div style={{ fontSize: 13, lineHeight: 1.6 }}>Assim que um cliente pedir consórcio ou home equity e for atribuído a você, ele aparece aqui — e você recebe o contato ao clicar em Receber cliente.</div>
        </div>
      )}

      {/* Cards de lead */}
      {leads.map(lead => {
        const prod = PRODUTO_CFG[lead.origem] || { rot: lead.produto || '—', cor: '#475569', bg: '#f1f5f9' };
        const st = STATUS_CFG[lead.status] || STATUS_CFG.novo;
        const recebido = !!lead.recebido_em;
        const finalizado = !!lead.finalizado_em;
        const parado = diasDesde(lead.ultimo_evento_em || lead.criado_em);
        const trilha = trilhas[lead.id];
        const m = msgCard[lead.id];
        return (
          <div key={lead.id} style={{ ...card, opacity: finalizado ? 0.75 : 1 }}>
            {/* Linha 1: nome + badges */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 15.5, fontWeight: 800, color: '#111', flex: 1, minWidth: 160 }}>{lead.nome || 'Cliente'}</div>
              <span style={{ fontSize: 11, fontWeight: 800, color: prod.cor, background: prod.bg, borderRadius: 999, padding: '3px 10px' }}>{prod.rot}</span>
              <span style={{ fontSize: 11, fontWeight: 800, color: st.cor, background: st.bg, borderRadius: 999, padding: '3px 10px' }}>{st.rot}</span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
              Pedido em {fmtData(lead.criado_em)}
              {recebido && <> · recebido em {fmtData(lead.recebido_em)}</>}
              {!finalizado && parado != null && parado >= 2 && <span style={{ color: '#b45309', fontWeight: 700 }}> · {parado} dias sem registro</span>}
              {finalizado && lead.resultado && <> · resultado: <b style={{ color: lead.resultado === 'ganho' ? '#15803d' : '#b91c1c' }}>{lead.resultado}</b></>}
            </div>

            {/* Contato: SÓ existe depois de receber (a RPC devolve null antes — por desenho) */}
            {recebido && (lead.telefone || lead.email) && (
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 10, fontSize: 13, fontWeight: 700 }}>
                {lead.telefone && (
                  <a href={`https://wa.me/${waNumero(lead.telefone)}`} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#15803d', textDecoration: 'none', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '6px 12px' }}>
                    <Phone size={13} /> {lead.telefone} · WhatsApp
                  </a>
                )}
                {lead.email && (
                  <a href={`mailto:${lead.email}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#084BA6', textDecoration: 'none', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '6px 12px' }}>
                    <Mail size={13} /> {lead.email}
                  </a>
                )}
              </div>
            )}

            {m && (
              <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: m.tipo === 'ok' ? '#f0fdf4' : '#fef2f2', color: m.tipo === 'ok' ? '#15803d' : '#b91c1c', border: `1px solid ${m.tipo === 'ok' ? '#bbf7d0' : '#fecaca'}` }}>{m.texto}</div>
            )}

            {/* Ações */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {!recebido && !finalizado && (
                <button onClick={() => receber(lead)} disabled={busy === `${lead.id}:receber`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 18px', background: confirmaRec === lead.id ? '#b45309' : '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13.5, cursor: 'pointer' }}>
                  {busy === `${lead.id}:receber` ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                    : <UserCheck size={15} />}
                  {confirmaRec === lead.id ? 'Confirmar: inicio o atendimento agora' : 'Receber cliente'}
                </button>
              )}
              {confirmaRec === lead.id && (
                <button onClick={() => setConfirmaRec(null)} style={{ padding: '11px 14px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Agora não</button>
              )}
              {recebido && !finalizado && (
                <>
                  <button onClick={() => registrar(lead, 'atendimento_confirmado', 'Atendimento realizado — confirmado pelo consultor')}
                    disabled={!!busy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 14px', background: '#f0fdf4', color: '#15803d', border: '1px solid #bbf7d0', borderRadius: 10, fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>
                    <CheckCircle2 size={14} /> Atendimento realizado
                  </button>
                  <button onClick={() => { setModalFinal(lead); setFinalForm({ resultado: '', motivo: '', comentario: '' }); }}
                    disabled={!!busy}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 14px', background: '#111111', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>
                    <Flag size={14} /> Finalizar
                  </button>
                </>
              )}
              <button onClick={() => toggleExpand(lead.id)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: 'white', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', marginLeft: 'auto' }}>
                {expand[lead.id] ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Acompanhamento
              </button>
            </div>

            {/* Acompanhamento: trilha + feedback */}
            {expand[lead.id] && (
              <div style={{ marginTop: 14, borderTop: '1px solid #f1f5f9', paddingTop: 12 }}>
                {!trilha && <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Carregando trilha…</div>}
                {trilha?.erro && <div style={{ fontSize: 12.5, color: '#b91c1c' }}>Não foi possível carregar a trilha agora.</div>}
                {trilha?.eventos && (
                  trilha.eventos.length === 0
                    ? <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Sem registros ainda — receba o cliente para começar.</div>
                    : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                        {trilha.eventos.map((ev, i) => (
                          <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12.5, alignItems: 'baseline' }}>
                            <span style={{ color: '#94a3b8', whiteSpace: 'nowrap', fontSize: 11.5 }}>{new Date(ev.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            <span style={{ fontWeight: 800, color: '#084BA6', whiteSpace: 'nowrap' }}>{{ recebido: 'Recebido', contato: 'Contato', feedback: 'Feedback', atendimento_confirmado: 'Atendimento ✓', finalizado: 'Finalizado', reaberto: 'Reaberto', atribuido: 'Atribuído', nps_enviado: 'Pesquisa enviada', nps_respondido: 'Cliente respondeu' }[ev.tipo] || ev.tipo}</span>
                            <span style={{ color: '#475569', overflowWrap: 'anywhere' }}>{ev.comentario}</span>
                          </div>
                        ))}
                      </div>
                    )
                )}
                {recebido && !finalizado && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <textarea value={feedback[lead.id] || ''} onChange={e => setFeedback(prev => ({ ...prev, [lead.id]: e.target.value }))}
                      placeholder="Como foi o contato? Registre aqui o andamento (fica na trilha do cliente)…"
                      rows={2}
                      style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'inherit', resize: 'vertical' }} />
                    <button onClick={() => registrar(lead, 'feedback', (feedback[lead.id] || '').trim())}
                      disabled={!!busy || (feedback[lead.id] || '').trim().length < 3}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', opacity: (feedback[lead.id] || '').trim().length < 3 ? 0.5 : 1 }}>
                      {busy === `${lead.id}:feedback` ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <MessageSquare size={14} />} Registrar
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Modal Finalizar */}
      {modalFinal && (
        <div onClick={() => setModalFinal(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, maxWidth: 460, width: '100%', padding: '22px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 900, fontSize: 17, color: '#111', marginBottom: 4 }}>Finalizar atendimento</div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginBottom: 14 }}>{modalFinal.nome} · o registro completo protege você e a BidPro na negociação.</div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>Resultado</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              {[['ganho', 'Contratou ✓', '#15803d', '#f0fdf4'], ['perdido', 'Não contratou', '#b91c1c', '#fef2f2'], ['sem_contato', 'Sem retorno do cliente', '#b45309', '#fffbeb']].map(([v, rot, cor, bg]) => (
                <button key={v} onClick={() => setFinalForm(f => ({ ...f, resultado: v }))}
                  style={{ padding: '9px 14px', borderRadius: 10, fontWeight: 800, fontSize: 12.5, cursor: 'pointer', border: finalForm.resultado === v ? `2px solid ${cor}` : '1px solid #e2e8f0', color: cor, background: finalForm.resultado === v ? bg : 'white' }}>
                  {rot}
                </button>
              ))}
            </div>
            {finalForm.resultado === 'perdido' && (
              <>
                <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>Motivo</div>
                <select value={finalForm.motivo} onChange={e => setFinalForm(f => ({ ...f, motivo: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, marginBottom: 12, background: 'white' }}>
                  <option value="">Selecione o motivo…</option>
                  {MOTIVOS_PERDIDO.map(([v, rot]) => <option key={v} value={v}>{rot}</option>)}
                </select>
              </>
            )}
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>Comentário (obrigatório)</div>
            <textarea value={finalForm.comentario} onChange={e => setFinalForm(f => ({ ...f, comentario: e.target.value }))}
              rows={3} placeholder="Resuma o desfecho: o que foi contratado/proposto, valores conversados, próximo passo…"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box', marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setModalFinal(null)} style={{ padding: '10px 16px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
              <button onClick={submeterFinal}
                disabled={!!busy || !finalForm.resultado || finalForm.comentario.trim().length < 5 || (finalForm.resultado === 'perdido' && !finalForm.motivo)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 18px', background: '#111111', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer', opacity: (!finalForm.resultado || finalForm.comentario.trim().length < 5 || (finalForm.resultado === 'perdido' && !finalForm.motivo)) ? 0.5 : 1 }}>
                {busy.endsWith(':finalizado') ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Flag size={14} />} Registrar desfecho
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
