// FILA DE CONFERÊNCIA DE PAGAMENTOS (Admin → Financeiro, 20/10 — pendências 231/232). Dinheiro que o webhook
// recebeu e NÃO aplicou sozinho: pagamento acima do saldo, de honorário/cobrança já quitado, ou estorno sobre
// repasse já creditado à equipe. Antes desta tela o item só saía da fila por SQL. Conferir exige escrever o que
// foi feito (fica gravado com quem conferiu) — a devolução ou o ajuste de saldo em si continuam com a equipe.
import React, { useCallback, useEffect, useState } from 'react';
import { apiCall } from '../utils/apiCall';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const data = (v) => (v ? new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const MOTIVO = {
  valor_acima_do_saldo: 'Pago ACIMA do saldo em aberto',
  ja_quitado: 'Pagamento de algo que já estava quitado',
  estorno_com_repasse_creditado: 'Estorno/chargeback com repasse já creditado à equipe',
  estorno_pagamento_parcial_cobranca: 'Estorno de pagamento PARCIAL de cobrança avulsa',
};

export default function PagamentosConferenciaAdmin() {
  const [fila, setFila] = useState(null);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState(null);
  const [obs, setObs] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState(null);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const r = await apiCall('/api/pagamentos-conferencia');
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(d.error || `Não consegui carregar a fila (HTTP ${r.status}).`); return; }
      setFila({ pendentes: d.pendentes || [], conferidos: d.conferidos || [] });
    } catch (e) { setErro(e?.message || 'Falha ao carregar a fila.'); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function conferir(item) {
    setOcupado(true); setMsg(null);
    try {
      const r = await apiCall('/api/pagamentos-conferencia', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, obs }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ erro: true, txt: d.error || `Falhou (HTTP ${r.status}).` }); return; }
      setAberto(null); setObs(''); setMsg({ txt: 'Conferência registrada.' });
      await carregar();
    } catch (e) { setMsg({ erro: true, txt: e?.message || 'Falhou.' }); }
    finally { setOcupado(false); }
  }

  if (erro) return <div style={{ padding: 16, background: '#fee2e2', color: '#b91c1c', borderRadius: 10, fontSize: 13.5 }}>{erro} <button onClick={carregar} style={{ marginLeft: 8 }}>Tentar de novo</button></div>;
  if (!fila) return <div style={{ color: '#94a3b8', fontSize: 13.5 }}>Carregando…</div>;

  const card = { border: '1px solid #e2e8f0', borderRadius: 12, padding: 14, marginBottom: 10, background: '#fff' };
  return (
    <div>
      <p style={{ fontSize: 13, color: '#475569', margin: '0 0 14px', lineHeight: 1.6 }}>
        Pagamentos que o sistema recebeu e <strong>não aplicou sozinho</strong>. Cada um precisa de uma decisão da equipe
        (devolver, aplicar à mão ou lançar o estorno do repasse). Enquanto houver pendente, o painel de saúde acusa.
      </p>
      {msg && <div style={{ marginBottom: 12, fontSize: 13, color: msg.erro ? '#b91c1c' : '#047857' }}>{msg.txt}</div>}
      <h3 style={{ fontSize: 14.5, margin: '0 0 10px' }}>Pendentes ({fila.pendentes.length})</h3>
      {!fila.pendentes.length && <div style={{ ...card, color: '#047857', fontSize: 13.5 }}>Nada a conferir.</div>}
      {fila.pendentes.map((p) => (
        <div key={p.id} style={card}>
          <div style={{ fontWeight: 700, fontSize: 13.5, color: '#b45309' }}>{MOTIVO[p.motivo] || p.motivo}</div>
          <div style={{ fontSize: 13, color: '#334155', marginTop: 6, lineHeight: 1.7 }}>
            {p.gateway} · pagamento <code>{p.gateway_payment_id}</code><br />
            Referência: <code>{p.referencia || '—'}</code><br />
            Valor: <strong>{fmt(p.valor)}</strong> · Esperado: {fmt(p.esperado)} · Recebido em {data(p.criado_em)}
          </div>
          {aberto === p.id ? (
            <div style={{ marginTop: 10 }}>
              <textarea value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} rows={2}
                placeholder="O que foi feito? Ex.: devolvido por Pix em 21/10; aplicado à parcela 3; estorno lançado no saldo do advogado."
                style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }} />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button disabled={ocupado || obs.trim().length < 5} onClick={() => conferir(p)}
                  style={{ padding: '8px 14px', borderRadius: 8, border: 'none', background: '#047857', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                  {ocupado ? 'Gravando…' : 'Marcar como conferido'}
                </button>
                <button onClick={() => { setAberto(null); setObs(''); }} style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }}>Cancelar</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setAberto(p.id); setObs(''); setMsg(null); }}
              style={{ marginTop: 10, padding: '7px 13px', borderRadius: 8, border: '1px solid #0D63DB', background: '#fff', color: '#0D63DB', fontWeight: 700, cursor: 'pointer' }}>
              Conferir
            </button>
          )}
        </div>
      ))}
      {!!fila.conferidos.length && (
        <>
          <h3 style={{ fontSize: 14.5, margin: '18px 0 10px' }}>Conferidos (90 dias)</h3>
          {fila.conferidos.map((p) => (
            <div key={p.id} style={{ ...card, background: '#f8fafc' }}>
              <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.7 }}>
                {MOTIVO[p.motivo] || p.motivo} · {fmt(p.valor)} · <code>{p.referencia || p.gateway_payment_id}</code><br />
                <span style={{ color: '#047857' }}>{data(p.conferido_em)} — {p.conferido_obs}</span>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
