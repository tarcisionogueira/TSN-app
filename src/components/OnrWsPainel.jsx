import React, { useCallback, useEffect, useState } from 'react';
import { apiCall } from '../utils/apiCall';

/**
 * PAINEL DO WEB SERVICE OFICIAL DA ONR (22/11) — só admin (o endpoint devolve 403 aos demais e o
 * painel some). Mostra se as credenciais estão na Vercel, se o serviço da ONR responde, e roda o
 * teste ponta a ponta (login + lista de cartórios, sem custo). Ver api/_onr-ws.js.
 */
const B = { padding: '7px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' };

export default function OnrWsPainel() {
  const [st, setSt] = useState(null);
  const [oculto, setOculto] = useState(false);
  const [teste, setTeste] = useState(null);
  const [rodando, setRodando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const r = await apiCall('/api/onr-ws');
      if (r.status === 403 || r.status === 401) { setOculto(true); return; }
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setSt(j);
    } catch (e) { setSt({ erro: String(e.message || e) }); }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function rodar(acao) {
    setRodando(true); setTeste(null);
    try {
      const r = await apiCall('/api/onr-ws', { method: 'POST', body: JSON.stringify({ acao }) });
      const j = await r.json().catch(() => ({}));
      setTeste({ acao, ...j, http: r.status });
      await carregar();
    } catch (e) { setTeste({ acao, ok: false, erro: String(e.message || e) }); }
    finally { setRodando(false); }
  }

  if (oculto || !st) return null;
  return (
    <div style={{ border: '1px solid #bfdbfe', background: '#f8fbff', borderRadius: 12, padding: 14, marginBottom: 20, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>🔌 Web Service oficial da ONR</strong>
        <span style={{ color: '#64748b' }}>{st.ambiente === 'homologacao' ? 'ambiente de homologação' : st.ambiente}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          <button style={B} disabled={rodando || !st.configurado} onClick={() => rodar('teste')}>{rodando ? 'Testando…' : 'Testar conexão'}</button>
          <button style={B} disabled={rodando || !st.configurado} onClick={() => rodar('saldo')}>Saldo</button>
        </span>
      </div>
      {st.erro && <div style={{ color: '#b91c1c', marginTop: 6 }}>{st.erro}</div>}
      {!st.erro && (
        <div style={{ marginTop: 6, color: '#475569', lineHeight: 1.6 }}>
          {st.configurado ? '✅ Credenciais na Vercel' : <>⚠️ Faltam na Vercel: <strong>{st.falta.join(', ')}</strong></>}
          {' · '}{st.servico_no_ar ? '✅ ONR respondendo' : '❌ ONR não responde'}
          {' · '}{st.tokens_livres} token(s) livres
        </div>
      )}
      {teste && (
        <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: teste.ok ? '#f0fdf4' : '#fef2f2', color: teste.ok ? '#166534' : '#991b1b' }}>
          {(teste.passos || []).map((p, i) => <div key={i}>{p.ok ? '✅' : '❌'} {p.passo}: {p.detalhe}</div>)}
          {teste.acao === 'saldo' && (teste.ok ? `Saldo: R$ ${teste.saldo}` : `❌ ${teste.erro}`)}
          {teste.hash_case_aceito && <div>Hash aceito em <strong>{teste.hash_case_aceito === 'upper' ? 'maiúsculas' : 'minúsculas'}</strong>{teste.hash_case_aceito !== st.hash_case && ' — ajuste ONR_WS_HASH_CASE na Vercel'}</div>}
          {teste.erro && teste.acao !== 'saldo' && <div>❌ {teste.erro}</div>}
        </div>
      )}
      {(st.ultimas_chamadas || []).length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Últimas chamadas</summary>
          {st.ultimas_chamadas.map((c, i) => (
            <div key={i} style={{ color: c.ok ? '#475569' : '#b91c1c', marginTop: 3 }}>
              {new Date(c.criado_em).toLocaleString('pt-BR')} · {c.servico}.{c.metodo} · {c.ok ? 'ok' : `erro ${c.codigo_erro ?? ''} ${c.erro || ''}`}{c.valor_total ? ` · R$ ${c.valor_total}` : ''}
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
