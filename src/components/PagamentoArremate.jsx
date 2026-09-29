// PAGAMENTO DA ARREMATAÇÃO (29/09, pedido do dono): marcador da data da arrematação + cronograma
// (entrada e parcelas) + lembrete antes de cada vencimento. Regra de datas/valores em
// src/utils/parcelamentoArremate.js (a mesma do cron que manda o aviso por e-mail).
// A guia de depósito NÃO é gerada aqui — sai do portal do banco/tribunal pelo nº do processo.
import React from 'react';
import { supabase } from '../utils/supabase';
import { cronograma, proximaPendente, avisoPenalidade } from '../utils/parcelamentoArremate';

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const inp = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const rot = { fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, display: 'block' };

export default function PagamentoArremate({ arr, podeEditar, cardStyle }) {
  const [p, setP] = React.useState(arr.parcelamento || null);
  const [editando, setEditando] = React.useState(false);
  const [form, setForm] = React.useState(() => ({ forma: 'parcelado', entrada_pct: 25, entrada_venc: arr.data_arrematacao || '', parcelas: 30, primeira_venc: '', indice: '', ...(arr.parcelamento || {}) }));
  const [salvando, setSalvando] = React.useState(false);
  const [erro, setErro] = React.useState('');
  const [verTudo, setVerTudo] = React.useState(false);

  const valor = Number(arr.valor_arrematacao) || 0;
  // Modalidade da FONTE (o imóvel do acervo): o jsonb do arremate costuma vir sem ela, e
  // `arrematacoes.tipo_leilao` já foi visto divergente (judicial gravado como extrajudicial).
  const [modalidade, setModalidade] = React.useState(arr.imovel?.modalidade || '');
  React.useEffect(() => {
    if (!arr.imovel_id) return;
    supabase.from('imoveis_leilao').select('modalidade').eq('id', arr.imovel_id).maybeSingle()
      .then(({ data, error }) => { if (error) console.warn('[PagamentoArremate] modalidade:', error.message); else if (data?.modalidade) setModalidade(data.modalidade); });
  }, [arr.imovel_id]);
  const itens = cronograma(p, { valor, dataArrematacao: arr.data_arrematacao });
  const prox = proximaPendente(itens);
  const diasDesde = arr.data_arrematacao ? Math.round((Date.now() - new Date(`${arr.data_arrematacao}T12:00:00`).getTime()) / 86400000) : null;

  const salvar = async (novo) => {
    setSalvando(true); setErro('');
    const { data, error } = await supabase.rpc('salvar_parcelamento_arremate', { p_arrematado: arr.id, p_parcelamento: novo });
    setSalvando(false);
    if (error) { setErro(error.message || 'Não foi possível salvar.'); return false; }
    setP(data || null);
    return true;
  };
  const salvarForm = async () => {
    const novo = form.forma === 'a_vista'
      ? { forma: 'a_vista', entrada_venc: form.entrada_venc || null, indice: form.indice || null, pagas: p?.pagas || [] }
      : { forma: 'parcelado', entrada_pct: Number(form.entrada_pct) || 25, entrada_venc: form.entrada_venc || null, parcelas: Number(form.parcelas) || 1, primeira_venc: form.primeira_venc || null, indice: form.indice || null, pagas: p?.pagas || [] };
    if (await salvar(novo)) setEditando(false);
  };
  const alternarPaga = async (idx) => {
    const pagas = new Set((p?.pagas || []).map(Number));
    if (pagas.has(idx)) pagas.delete(idx); else pagas.add(idx);
    await salvar({ ...p, pagas: [...pagas].sort((a, b) => a - b) });
  };

  const cor = !prox ? { bg: '#f0fdf4', bd: '#bbf7d0', fg: '#15803d' }
    : prox.dias < 0 ? { bg: '#fef2f2', bd: '#fecaca', fg: '#b91c1c' }
    : prox.dias <= 7 ? { bg: '#fffbeb', bd: '#fde68a', fg: '#b45309' }
    : { bg: '#f0f9ff', bd: '#bae6fd', fg: '#0369a1' };
  const quando = (d) => (d === 0 ? 'vence HOJE' : d > 0 ? `vence em ${d} dia${d > 1 ? 's' : ''}` : `ATRASADA há ${-d} dia${d < -1 ? 's' : ''}`);
  const visiveis = verTudo ? itens : itens.filter((x) => !x.paga).slice(0, 4);

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>📅 Pagamento da arrematação</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {arr.data_arrematacao
              ? <>Arrematado em <b style={{ color: '#0f172a' }}>{dataBR(arr.data_arrematacao)}</b>{diasDesde != null && diasDesde >= 0 ? ` · há ${diasDesde} dia${diasDesde === 1 ? '' : 's'}` : ''}</>
              : 'Data da arrematação não registrada'}
          </div>
        </div>
        {podeEditar && !editando && (
          <button onClick={() => setEditando(true)} style={{ padding: '6px 12px', borderRadius: 8, background: 'white', color: '#0D63DB', border: '1px solid #bfdbfe', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
            {p ? 'Editar condições' : 'Registrar condições'}
          </button>
        )}
      </div>

      {editando && (
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <label><span style={rot}>Forma</span>
            <select value={form.forma} onChange={(e) => setForm((f) => ({ ...f, forma: e.target.value }))} style={inp}>
              <option value="parcelado">Parcelado</option><option value="a_vista">À vista</option>
            </select></label>
          {form.forma === 'parcelado' && <label><span style={rot}>Entrada (%)</span>
            <input type="number" min="0" max="100" value={form.entrada_pct} onChange={(e) => setForm((f) => ({ ...f, entrada_pct: e.target.value }))} style={inp} /></label>}
          <label><span style={rot}>{form.forma === 'parcelado' ? 'Vencimento da entrada' : 'Vencimento do pagamento'}</span>
            <input type="date" value={form.entrada_venc || ''} onChange={(e) => setForm((f) => ({ ...f, entrada_venc: e.target.value }))} style={inp} /></label>
          {form.forma === 'parcelado' && <>
            <label><span style={rot}>Nº de parcelas</span>
              <input type="number" min="1" max="60" value={form.parcelas} onChange={(e) => setForm((f) => ({ ...f, parcelas: e.target.value }))} style={inp} /></label>
            <label><span style={rot}>1º vencimento das parcelas</span>
              <input type="date" value={form.primeira_venc || ''} onChange={(e) => setForm((f) => ({ ...f, primeira_venc: e.target.value }))} style={inp} /></label>
          </>}
          <label><span style={rot}>Índice de correção (edital)</span>
            <input value={form.indice || ''} placeholder="ex.: IPCA, INPC, TJ" onChange={(e) => setForm((f) => ({ ...f, indice: e.target.value }))} style={inp} /></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button onClick={salvarForm} disabled={salvando} style={{ padding: '8px 14px', borderRadius: 8, background: '#0f172a', color: 'white', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button onClick={() => setEditando(false)} style={{ padding: '8px 12px', borderRadius: 8, background: 'white', border: '1px solid #cbd5e1', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
      {erro && <p style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>⚠️ {erro}</p>}

      {!p && !editando && (
        <p style={{ fontSize: 12.5, color: '#64748b', marginTop: 10 }}>
          Registre as condições do auto de arrematação (à vista ou parcelado) para o sistema lembrar de cada vencimento antes do prazo.
        </p>
      )}

      {p && itens.length > 0 && (
        <>
          <div style={{ marginTop: 12, background: cor.bg, border: `1px solid ${cor.bd}`, borderRadius: 10, padding: '10px 14px' }}>
            {prox ? (
              <div style={{ fontSize: 13.5, color: cor.fg, fontWeight: 800 }}>
                ⏰ {prox.rotulo} · {brl(prox.valor)} · {dataBR(prox.venc)} — {quando(prox.dias)}
              </div>
            ) : <div style={{ fontSize: 13.5, color: cor.fg, fontWeight: 800 }}>✅ Todas as parcelas registradas como pagas</div>}
            {prox && <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4 }}>{avisoPenalidade(modalidade)}</div>}
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              A guia de depósito é emitida no portal do banco/tribunal com o nº do processo. Valor nominal{p.indice ? ` — a correção pelo ${p.indice} é aplicada na guia` : ' — a correção do edital é aplicada na guia'}. Lembrete por e-mail 5 dias e 1 dia antes do vencimento.
            </div>
          </div>
          <table style={{ width: '100%', marginTop: 10, borderCollapse: 'collapse', fontSize: 12.5 }}>
            <tbody>
              {visiveis.map((x) => (
                <tr key={x.idx} style={{ borderTop: '1px solid #f1f5f9', color: x.paga ? '#94a3b8' : '#0f172a' }}>
                  <td style={{ padding: '6px 4px' }}>{dataBR(x.venc)}</td>
                  <td style={{ padding: '6px 4px' }}>{x.rotulo}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 700 }}>{brl(x.valor)}</td>
                  <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                    {podeEditar
                      ? <label style={{ cursor: 'pointer', fontSize: 12 }}><input type="checkbox" checked={x.paga} disabled={salvando} onChange={() => alternarPaga(x.idx)} /> paga</label>
                      : (x.paga ? 'paga' : '')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {itens.length > visiveis.length || verTudo ? (
            <button onClick={() => setVerTudo((v) => !v)} style={{ marginTop: 6, background: 'none', border: 'none', color: '#2563eb', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}>
              {verTudo ? 'mostrar só as próximas' : `ver cronograma completo (${itens.length})`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
