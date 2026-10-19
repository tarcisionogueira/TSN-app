import { useState, useEffect, useCallback } from 'react';
import { CalendarClock, Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

/**
 * Parcelas da arrematação na tela do CASO (15/10, pedido do dono): guia recebida → aprovada e enviada ao arrematante →
 * comprovante → paga. A guia que chega por e-mail é ligada à parcela pelo parcelas-documentos-cron e fica
 * "aguardando aprovação"; o envio só sai pelo botão daqui (api/guia-parcela.js, acao 'enviar').
 * Datas: "pagar até" = vencimento − folga, em dia útil (src/utils/parcelamentoArremate.js); o vencimento real vai junto.
 */
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—');

function estado(item, guia, pagamento) {
  if (item.paga) return { txt: pagamento?.pago_em ? `Paga em ${dataBR(pagamento.pago_em)}` : 'Paga', cor: '#15803d' };
  if (guia?.enviada_em) return { txt: `Guia enviada em ${dataBR(guia.enviada_em)} · aguardando comprovante`, cor: '#0D63DB' };
  if (guia && (guia.storage_path || guia.anexo_id)) return { txt: 'Guia recebida · aguardando sua aprovação', cor: '#b45309', aprovar: true };
  return { txt: 'Sem guia', cor: '#94a3b8' };
}

export default function ParcelasCaso({ casoId, cardStyle }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(null);
  const [verTodas, setVerTodas] = useState(false);
  // Confirmação NA TELA (15/10): window.confirm é bloqueado em silêncio em navegador de celular/app embutido — o
  // dono "aprovou" a guia do Marcos e nenhuma requisição chegou ao servidor.
  const [confirmando, setConfirmando] = useState(null);
  const [ok, setOk] = useState('');

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const r = await apiCall('/api/guia-parcela', { method: 'POST', body: JSON.stringify({ acao: 'listar', caso_id: casoId }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDados(d);
    } catch (e) { console.error('[ParcelasCaso] carregar:', e?.message); setErro(`Não foi possível carregar as parcelas: ${e.message}`); setDados({ itens: [], docs: [], falhou: true }); }
  }, [casoId]);
  useEffect(() => { if (casoId) carregar(); }, [casoId, carregar]);

  const aprovar = async (item) => {
    setErro(''); setOk('');
    setEnviando(item.idx);
    try {
      const r = await apiCall('/api/guia-parcela', { method: 'POST', body: JSON.stringify({ acao: 'enviar', arrematado_id: dados.arrematado.id, parcela_idx: item.idx }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setOk(`Guia da ${item.rotulo} enviada para ${d.enviada_para} (cópia para você).`);
      if (d.aviso) setErro(d.aviso);
      setConfirmando(null);
      await carregar();
    } catch (e) { console.error('[ParcelasCaso] enviar:', e?.message); setErro(`Não foi possível enviar: ${e.message}`); }
    finally { setEnviando(null); }
  };

  // 19/10: falha de carga NÃO é "caso sem parcelamento" — o aviso de erro tem que aparecer (forma 4).
  if (dados && !dados.falhou && !dados.arrematado && !(dados.docs || []).length) return null;
  const itens = dados?.itens || [];
  const pendentes = itens.filter((x) => !x.paga);
  const visiveis = verTodas ? itens : [...itens.filter((x) => x.paga).slice(-1), ...pendentes.slice(0, 3)];
  const docsAviso = (dados?.docs || []).filter((d) => d.parcela_status === 'aviso');

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <CalendarClock size={18} color="#0D63DB" />
        <div style={{ fontSize: 15, fontWeight: 800, color: '#111111' }}>Parcelas da arrematação</div>
        {dados?.arrematado && <span style={{ fontSize: 12, color: '#64748b' }}>{itens.length - pendentes.length} de {itens.length} pagas · folga {dados.arrematado.folga_dias} dia(s)</span>}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        Vencimento a cada 30 dias da data do leilão. "Pagar até" é o vencimento menos a folga, antecipado para dia útil. A guia que chega por e-mail entra aqui sozinha e só vai ao arrematante com a sua aprovação.
      </div>
      {erro && <div style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 10 }}>{erro}</div>}
      {ok && <div style={{ fontSize: 12.5, color: '#15803d', fontWeight: 700, marginBottom: 10 }}>✓ {ok}</div>}
      {dados === null && <div style={{ fontSize: 13, color: '#64748b' }}><Loader2 size={14} style={{ verticalAlign: -2 }} /> Carregando…</div>}
      {dados && !dados.arrematado && <div style={{ fontSize: 13, color: '#64748b' }}>Este caso ainda não tem o parcelamento registrado (tela de Arrematados).</div>}
      {visiveis.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
          <thead><tr style={{ color: '#64748b', textAlign: 'left' }}>
            <th style={{ padding: '4px' }}>Parcela</th><th style={{ padding: '4px', textAlign: 'right' }}>Valor</th>
            <th style={{ padding: '4px' }}>Pagar até</th><th style={{ padding: '4px' }}>Vencimento</th><th style={{ padding: '4px' }}>Situação</th><th />
          </tr></thead>
          <tbody>
            {visiveis.map((x) => {
              const g = dados.guias?.[x.idx]; const st = estado(x, g, dados.pagamentos?.[x.idx]);
              return (
                <tr key={x.idx} style={{ borderTop: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '6px 4px', fontWeight: 700 }}>{x.rotulo}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>{brl(g?.valor || x.valor)}</td>
                  <td style={{ padding: '6px 4px', fontWeight: 700 }}>{dataBR(x.pagar_ate)}</td>
                  <td style={{ padding: '6px 4px', color: '#64748b' }}>{dataBR(x.venc)}</td>
                  <td style={{ padding: '6px 4px', color: st.cor }}>
                    {x.paga ? <CheckCircle2 size={13} style={{ verticalAlign: -2 }} /> : null} {st.txt}
                    {g?.avisos?.length > 0 && !x.paga && <div style={{ fontSize: 11, color: '#b45309' }}><AlertTriangle size={11} style={{ verticalAlign: -1 }} /> {g.avisos.join(' ')}</div>}
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                    {(st.aprovar || (g?.enviada_em && !x.paga)) && (confirmando === x.idx ? (
                      <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                        {st.aprovar && (
                          <div style={{ fontSize: 11, color: '#334155', textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 8px', lineHeight: 1.6 }}>
                            <div><b>Nome:</b> {g?.depositante || 'não lido na guia'} <span style={{ color: '#64748b' }}>· caso: {dados.conferir?.cliente || '—'}</span></div>
                            <div><b>Processo:</b> {g?.processo || 'não lido na guia'} <span style={{ color: '#64748b' }}>· caso: {dados.conferir?.processo || '—'}</span></div>
                            <div><b>Valor:</b> {brl(g?.valor)} <span style={{ color: '#64748b' }}>· parcela: {brl(x.valor)}</span></div>
                          </div>
                        )}
                        <span style={{ fontSize: 11, color: '#334155' }}>Enviar ao arrematante: pagar até {dataBR(x.pagar_ate)}?</span>
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <button onClick={() => aprovar(x)} disabled={enviando === x.idx}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: 'none', background: '#15803d', color: 'white', cursor: 'pointer' }}>
                            {enviando === x.idx ? <Loader2 size={12} /> : <Send size={12} />} Confirmar envio
                          </button>
                          <button onClick={() => setConfirmando(null)} disabled={enviando === x.idx}
                            style={{ fontSize: 12, padding: '6px 10px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}>Cancelar</button>
                        </span>
                      </div>
                    ) : (
                      <button onClick={() => { setConfirmando(x.idx); setOk(''); setErro(''); }}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, border: st.aprovar ? 'none' : '1px solid #cbd5e1', background: st.aprovar ? '#0D63DB' : 'white', color: st.aprovar ? 'white' : '#334155', cursor: 'pointer' }}>
                        <Send size={12} /> {st.aprovar ? 'Aprovar e enviar' : 'Reenviar'}
                      </button>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {itens.length > visiveis.length && <button onClick={() => setVerTodas(true)} style={{ marginTop: 8, fontSize: 12, background: 'none', border: 'none', color: '#0D63DB', cursor: 'pointer', padding: 0 }}>Ver todas as {itens.length} parcelas</button>}
      {docsAviso.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: '#b45309' }}>
          <b>Documentos que não liguei a nenhuma parcela:</b>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{docsAviso.map((d) => <li key={d.id}>{d.titulo || d.nome}: {d.parcela_aviso}</li>)}</ul>
        </div>
      )}
    </div>
  );
}
