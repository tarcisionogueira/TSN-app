import React, { useEffect, useState } from 'react';
import { Loader2, Mail, Send, X } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

// PROPOSTA DE COMPRA DIRETA AO LEILOEIRO — saiu do card da busca para a página do veículo (30/09,
// dono: "na busca só visualizar; leiloeiro, FIPE e proposta na página do veículo"). Abre já
// preparando o rascunho (preview — não manda nada); ENVIAR manda o texto atual da caixa.
export default function PropostaVeiculoModal({ veiculo, onFechar }) {
  const propondoVeiculo = veiculo;
  // Proposta de compra direta ao leiloeiro (17/09) — mesmo padrão de "Pedir ao leiloeiro"
  // (Analise.jsx): PREVIEW monta o rascunho editável (não manda nada); ENVIAR manda o texto
  // atual da caixa (editado ou não). `propondoVeiculo` guarda o veículo em edição; `null`
  // fecha o modal.
  const [propostaTexto, setPropostaTexto] = useState('');
  const [propostaInfo, setPropostaInfo] = useState(null); // { linkLote, contatoDisponivel } | null
  const [propostaCarregando, setPropostaCarregando] = useState(false);
  const [propostaEnviando, setPropostaEnviando] = useState(false);
  const [propostaMsg, setPropostaMsg] = useState(''); // { texto, tipo: 'success'|'error' } via string+cor abaixo
  const [propostaMsgTipo, setPropostaMsgTipo] = useState('error');

  const abrirProposta = async (v) => {
    setPropostaTexto(''); setPropostaInfo(null); setPropostaMsg(''); setPropostaCarregando(true);
    try {
      const r = await apiCall('/api/propor-veiculo-leiloeiro', { method: 'POST', body: JSON.stringify({ veiculo_id: v.id, action: 'preview' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) { setPropostaMsgTipo('error'); setPropostaMsg(j?.error || 'Não foi possível preparar a proposta agora.'); return; }
      setPropostaTexto(j.texto || ''); setPropostaInfo({ linkLote: j.linkLote, contatoDisponivel: j.contatoDisponivel, redator: j.redator || null, textoPadrao: j.textoPadrao || '' });
    } catch {
      setPropostaMsgTipo('error'); setPropostaMsg('Não foi possível preparar a proposta agora.');
    } finally { setPropostaCarregando(false); }
  };

  const enviarProposta = async () => {
    if (!propondoVeiculo || propostaEnviando) return;
    setPropostaEnviando(true); setPropostaMsg('');
    try {
      const r = await apiCall('/api/propor-veiculo-leiloeiro', { method: 'POST', body: JSON.stringify({ veiculo_id: propondoVeiculo.id, action: 'enviar', texto: propostaTexto }) });
      const j = await r.json().catch(() => ({}));
      if (j?.semContato) { setPropostaInfo(i => ({ ...i, contatoDisponivel: false })); setPropostaMsgTipo('error'); setPropostaMsg('Este leiloeiro ainda não tem e-mail de contato cadastrado — copie o texto acima e envie manualmente.'); return; }
      if (!r.ok || j?.error) { setPropostaMsgTipo('error'); setPropostaMsg(j?.error || 'Não foi possível enviar a proposta agora.'); return; }
      setPropostaMsgTipo('success'); setPropostaMsg(`Proposta enviada ao leiloeiro (${j.destinatario}). A resposta cai direto no seu e-mail.`);
    } catch {
      setPropostaMsgTipo('error'); setPropostaMsg('Não foi possível enviar a proposta agora.');
    } finally { setPropostaEnviando(false); }
  };

  const fecharProposta = () => onFechar?.();
  useEffect(() => { if (veiculo) abrirProposta(veiculo); }, [veiculo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!propondoVeiculo) return null;
  return (
        <div onClick={fecharProposta} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: 14, maxWidth: 520, width: '100%', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <Mail size={17} color="#6d28d9" />
                <h2 style={{ fontSize: 15, fontWeight: 900, color: '#111111', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Propor compra direta</h2>
              </div>
              <button onClick={fecharProposta} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 14px' }}>
              {[propondoVeiculo.marca, propondoVeiculo.modelo, propondoVeiculo.ano_fabricacao].filter(Boolean).join(' ') || propondoVeiculo.titulo} — leilão já ocorrido, sem sinal de comprador.
            </p>

            {propostaCarregando ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0', color: '#64748b', fontSize: 13 }}>
                <Loader2 size={16} className="animate-spin" /> Preparando rascunho…
              </div>
            ) : (
              <>
                {propostaInfo?.contatoDisponivel === false && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: '#92400e', marginBottom: 10 }}>
                    Este leiloeiro ainda não tem e-mail de contato cadastrado. Copie o texto abaixo e envie manualmente
                    {propostaInfo.linkLote ? <> (a página do lote fica <a href={propostaInfo.linkLote} target="_blank" rel="noopener noreferrer" style={{ color: '#92400e', fontWeight: 700 }}>aqui</a>)</> : null}.
                  </div>
                )}
                {propostaInfo?.redator && (
                  <div style={{ fontSize: 11.5, marginBottom: 6, color: propostaInfo.redator.usado ? '#15803d' : '#92400e' }}>
                    {propostaInfo.redator.usado
                      ? `✍️ Rascunho no seu estilo, aprendido dos seus ${propostaInfo.redator.exemplos} último(s) e-mail(s) a leiloeiros — revise antes de enviar.`
                      : `Texto padrão (o redator não usou: ${propostaInfo.redator.motivo}).`}
                    {propostaInfo.redator.usado && propostaInfo.textoPadrao && (
                      <button type="button" onClick={() => { setPropostaTexto(propostaInfo.textoPadrao); setPropostaInfo(i => ({ ...i, redator: { ...i.redator, usado: false, motivo: 'você voltou ao texto padrão' } })); }}
                        style={{ marginLeft: 8, background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, cursor: 'pointer', fontSize: 11.5 }}>usar texto padrão</button>
                    )}
                  </div>
                )}
                <textarea value={propostaTexto} onChange={e => setPropostaTexto(e.target.value)} rows={10}
                  style={{ width: '100%', padding: 10, border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', color: '#111111', boxSizing: 'border-box', resize: 'vertical', lineHeight: 1.5 }} />
                {propostaMsg && (
                  <div style={{ marginTop: 10, fontSize: 12, fontWeight: 600, color: propostaMsgTipo === 'success' ? '#15803d' : '#b91c1c' }}>{propostaMsg}</div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button onClick={fecharProposta} style={{ padding: '9px 16px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12.5, fontWeight: 700, color: '#64748b', cursor: 'pointer' }}>
                    {propostaMsgTipo === 'success' ? 'Fechar' : 'Cancelar'}
                  </button>
                  {propostaMsgTipo !== 'success' && (
                    <button onClick={enviarProposta} disabled={propostaEnviando || !propostaTexto.trim()}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 16px', background: propostaEnviando ? '#c4b5fd' : '#6d28d9', color: 'white', border: 'none', borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: propostaEnviando ? 'default' : 'pointer' }}>
                      {propostaEnviando ? <><Loader2 size={14} className="animate-spin" /> Enviando…</> : <><Send size={13} /> Enviar proposta</>}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
  );
}
