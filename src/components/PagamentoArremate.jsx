// PAGAMENTO DA ARREMATAÇÃO (29/09, pedido do dono): marcador da data da arrematação + cronograma
// (entrada e parcelas) + lembrete antes de cada vencimento. Regra de datas/valores em
// src/utils/parcelamentoArremate.js (a mesma do cron que manda o aviso por e-mail).
// A guia de depósito NÃO é gerada aqui — sai do portal do banco/tribunal pelo nº do processo.
// "Emitir guia" (12/10, em validação, só equipe): diz ONDE emitir e entrega os dados prontos.
import React from 'react';
import { supabase } from '../utils/supabase';
import { cronograma, proximaPendente, avisoPenalidade } from '../utils/parcelamentoArremate';
import { portaisDaGuia, CALCULADORA_BCB } from '../utils/guiaDeposito';

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBR = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '—');
const inp = { padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, width: '100%', boxSizing: 'border-box' };
const rot = { fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 4, display: 'block' };

export default function PagamentoArremate({ arr, podeEditar, cardStyle, ehEquipe = false }) {
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
  const [processo, setProcesso] = React.useState(arr.imovel?.numero_processo || '');
  React.useEffect(() => {
    if (!arr.imovel_id) return;
    supabase.from('imoveis_leilao').select('modalidade, numero_processo').eq('id', arr.imovel_id).maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.warn('[PagamentoArremate] modalidade/processo:', error.message); return; }
        if (data?.modalidade) setModalidade(data.modalidade);
        if (data?.numero_processo) setProcesso(data.numero_processo);
      });
  }, [arr.imovel_id]);
  // Condições LIDAS do auto/carta de arrematação (12/10, pedido do dono: o índice e as parcelas estão
  // no documento — ninguém deveria digitar). Só equipe, em validação. Roda sozinho uma vez por sessão
  // quando o cronograma ainda não tem a prova do documento (`fonte_doc`).
  const [lendo, setLendo] = React.useState(false);
  const [leitura, setLeitura] = React.useState(null); // { ok, avisos, erro }
  const lerDoDocumento = React.useCallback(async () => {
    setLendo(true); setLeitura(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch('/api/ler-condicoes-arremate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
        body: JSON.stringify({ arrematado_id: arr.id }),
      });
      const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) setLeitura({ ok: false, erro: d.error || `HTTP ${r.status}` });
      else if (!d.ok) setLeitura({ ok: false, erro: d.erro || 'Não foi possível ler o documento.' });
      else { setP(d.parcelamento || null); setLeitura({ ok: true, avisos: d.avisos || [] }); }
    } catch (e) {
      setLeitura({ ok: false, erro: `Falha de rede: ${e?.message || e}` });
    }
    setLendo(false);
  }, [arr.id]);
  React.useEffect(() => {
    if (!ehEquipe || p?.fonte_doc) return;
    const chave = `leu-condicoes-${arr.id}`;
    try { if (sessionStorage.getItem(chave)) return; sessionStorage.setItem(chave, '1'); }
    catch { /* sem storage: lê mesmo assim, uma vez por montagem */ }
    lerDoDocumento();
  }, [ehEquipe, arr.id]); // eslint-disable-line react-hooks/exhaustive-deps
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
    if (p?.fonte_doc) novo.fonte_doc = { ...p.fonte_doc, editado_a_mao: true };
    if (p?.guias) novo.guias = p.guias;
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
        {ehEquipe && !editando && (
          <button onClick={lerDoDocumento} disabled={lendo} title="Lê entrada, parcelas, vencimentos e índice do auto/carta de arrematação anexado ao caso"
            style={{ padding: '6px 12px', borderRadius: 8, background: '#0D63DB', color: 'white', border: 'none', cursor: lendo ? 'wait' : 'pointer', fontSize: 12, fontWeight: 700, marginLeft: 'auto' }}>
            {lendo ? 'Lendo o documento…' : p?.fonte_doc ? 'Reler do auto/carta' : 'Ler do auto/carta'}
          </button>
        )}
        {podeEditar && !editando && (
          <button onClick={() => { setForm((f) => ({ ...f, ...(p || {}) })); setEditando(true); }} style={{ padding: '6px 12px', borderRadius: 8, background: 'white', color: '#0D63DB', border: '1px solid #bfdbfe', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
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
          <label><span style={rot}>Índice de correção (lido do auto/carta)</span>
            <input value={form.indice || ''} placeholder="ex.: IPCA, INPC, TJ" onChange={(e) => setForm((f) => ({ ...f, indice: e.target.value }))} style={inp} /></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <button onClick={salvarForm} disabled={salvando} style={{ padding: '8px 14px', borderRadius: 8, background: '#0f172a', color: 'white', border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>{salvando ? 'Salvando…' : 'Salvar'}</button>
            <button onClick={() => setEditando(false)} style={{ padding: '8px 12px', borderRadius: 8, background: 'white', border: '1px solid #cbd5e1', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
          </div>
        </div>
      )}
      {erro && <p style={{ fontSize: 12, color: '#dc2626', marginTop: 8 }}>⚠️ {erro}</p>}
      {leitura && !leitura.ok && <p style={{ fontSize: 12, color: '#b45309', marginTop: 8 }}>⚠️ {leitura.erro}</p>}
      {leitura?.ok && leitura.avisos.length > 0 && (
        <ul style={{ fontSize: 12, color: '#b45309', margin: '8px 0 0', paddingLeft: 18 }}>{leitura.avisos.map((a) => <li key={a}>{a}</li>)}</ul>
      )}
      {p?.fonte_doc && (
        <details style={{ marginTop: 8, fontSize: 11.5, color: '#475569' }}>
          <summary style={{ cursor: 'pointer' }}>
            📄 Condições lidas do {p.fonte_doc.tipo === 'carta_arrematacao' ? 'carta de arrematação' : 'auto de arrematação'} ({p.fonte_doc.nome}) em {dataBR(p.fonte_doc.lido_em)}{p.indice ? ` · índice: ${p.indice}` : ' · sem índice no documento'}
          </summary>
          {p.fonte_doc.trecho_pagamento && <p style={{ margin: '6px 0 0', fontStyle: 'italic' }}>Pagamento: “{p.fonte_doc.trecho_pagamento}”</p>}
          {p.fonte_doc.trecho_indice && <p style={{ margin: '4px 0 0', fontStyle: 'italic' }}>Índice: “{p.fonte_doc.trecho_indice}”</p>}
        </details>
      )}

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
          {ehEquipe && prox && <GuiaDeposito parcela={prox} processo={processo} indice={p.indice} partes={p.fonte_doc} titulo={arr.titulo} userId={arr.user_id} dataArrematacao={arr.data_arrematacao}
            arrematadoId={arr.id} imovelId={arr.imovel_id} guiaGerada={p.guias?.[prox.idx] || null} onParcelamento={setP}
            marcarPaga={async (idx) => salvar({ ...p, pagas: [...new Set([...(p.pagas || []).map(Number), idx])].sort((a, b) => a - b) })} />}
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

// Painel "Emitir guia" — só equipe enquanto validamos (12/10). Não gera boleto: aponta o portal do
// tribunal pelo nº CNJ e deixa os dados prontos para copiar. Valor NOMINAL; correção pela
// calculadora oficial do BCB conforme o índice do edital.
// Chamada autenticada às rotas do servidor (token da sessão).
async function chamarApi(caminho, { json, form } = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const r = await fetch(caminho, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session?.access_token || ''}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : form,
  });
  const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
  if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
  return d;
}

function GuiaDeposito({ parcela, processo, indice, partes, titulo, userId, dataArrematacao, arrematadoId, imovelId, guiaGerada, onParcelamento, marcarPaga }) {
  const [aberto, setAberto] = React.useState(false);
  // Nome do depositante = o arrematante (o SIF pede "Nome do depositante" quando ele não é parte).
  const [arrematante, setArrematante] = React.useState('');
  React.useEffect(() => {
    if (!aberto || !userId || arrematante) return;
    supabase.from('perfis').select('nome').eq('id', userId).maybeSingle()
      .then(({ data, error }) => { if (error) console.warn('[GuiaDeposito] arrematante:', error.message); else if (data?.nome) setArrematante(data.nome); });
  }, [aberto, userId, arrematante]);
  const [copiado, setCopiado] = React.useState('');
  // Fluxo da guia já gerada (12/10, opção 1): anexar → ler → enviar ao cliente → comprovante dá baixa.
  const [ocupado, setOcupado] = React.useState('');
  const [msg, setMsg] = React.useState(null); // { tipo: 'ok'|'erro', txt, avisos }
  const subir = async (file, tipo, descricao) => {
    const fd = new FormData();
    fd.append('file', file); fd.append('imovel_id', imovelId); fd.append('tipo', tipo); fd.append('descricao', descricao);
    const d = await chamarApi('/api/upload-anexo', { form: fd });
    if (!d.anexo_id) throw new Error('upload sem identificador do anexo');
    return d.anexo_id;
  };
  const anexarGuia = async (file) => {
    if (!file) return;
    setOcupado('guia'); setMsg(null);
    try {
      const anexoId = await subir(file, 'boleto_aquisicao', `Guia ${parcela.rotulo}`);
      const d = await chamarApi('/api/guia-parcela', { json: { acao: 'ler', arrematado_id: arrematadoId, anexo_id: anexoId, parcela_idx: parcela.idx } });
      onParcelamento(d.parcelamento);
      setMsg({ tipo: 'ok', txt: 'Guia anexada e lida. Confira os dados e envie ao cliente.', avisos: d.avisos || [] });
    } catch (e) { setMsg({ tipo: 'erro', txt: e.message }); }
    setOcupado('');
  };
  const enviarCliente = async () => {
    setOcupado('enviar'); setMsg(null);
    try {
      const d = await chamarApi('/api/guia-parcela', { json: { acao: 'enviar', arrematado_id: arrematadoId, parcela_idx: parcela.idx } });
      if (d.parcelamento) onParcelamento(d.parcelamento);
      setMsg({ tipo: 'ok', txt: `Guia enviada para ${d.enviada_para}.${d.aviso ? ` ${d.aviso}` : ''}` });
    } catch (e) { setMsg({ tipo: 'erro', txt: e.message }); }
    setOcupado('');
  };
  const anexarComprovante = async (file) => {
    if (!file) return;
    setOcupado('comprovante'); setMsg(null);
    try {
      await subir(file, 'comprovante_pagamento', `Comprovante ${parcela.rotulo}`);
      const ok = await marcarPaga(parcela.idx);
      setMsg(ok ? { tipo: 'ok', txt: `Comprovante anexado e ${parcela.rotulo} marcada como paga.` } : { tipo: 'erro', txt: 'Comprovante anexado, mas não consegui marcar a parcela como paga — marque na tabela.' });
    } catch (e) { setMsg({ tipo: 'erro', txt: e.message }); }
    setOcupado('');
  };
  const botaoArquivo = (rotulo, onFile, chave, cor = '#0f172a') => (
    <label style={{ padding: '7px 12px', borderRadius: 8, background: ocupado ? '#94a3b8' : cor, color: 'white', fontSize: 12, fontWeight: 700, cursor: ocupado ? 'wait' : 'pointer' }}>
      {ocupado === chave ? 'Enviando…' : rotulo}
      <input type="file" accept="application/pdf,image/*" disabled={!!ocupado} style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; onFile(f); }} />
    </label>
  );
  const guia = portaisDaGuia(processo);
  const copiar = async (rotulo, texto) => {
    try { await navigator.clipboard.writeText(texto); setCopiado(rotulo); setTimeout(() => setCopiado(''), 1800); }
    catch (e) { console.warn('[GuiaDeposito] copiar:', e?.message); setCopiado('erro'); }
  };
  const valorTxt = Number(parcela.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // O SIF do TRT5 recusa observação com mais de 70 caracteres (12/10) e o boleto caiu com "Internal
  // Server Error" com travessão/acentos — sai curta e sem acento.
  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w\s./-]/g, ' ').replace(/\s+/g, ' ').trim();
  const observacao = semAcento(`${parcela.rotulo} arrematacao${processo ? ` proc ${guia?.cnj.formatado || processo}` : ''}`).slice(0, 70);
  const resumo = [
    `Processo: ${guia?.cnj.formatado || processo || '(não informado)'}`,
    guia ? `Tribunal: ${guia.tribunal} · vara/órgão de origem ${guia.cnj.origem}` : null,
    `Referência: ${parcela.rotulo} da arrematação — ${titulo || 'imóvel arrematado'}`,
    `Valor nominal: R$ ${valorTxt}${indice ? ` (corrigir pelo ${indice}, conforme o auto/carta)` : ''}`,
    `Vencimento: ${dataBR(parcela.venc)}`,
    `Depositante: ${arrematante || 'o arrematante'} (CPF do arrematante)`,
    'Finalidade: ARREMATAÇÃO DE BENS',
    `Observação: ${observacao}`,
  ].filter(Boolean).join('\n');
  const linha = (rotulo, valor, chave) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderTop: '1px solid #f1f5f9', fontSize: 12.5 }}>
      <span style={{ color: '#64748b', minWidth: 0 }}>{rotulo}</span>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center', minWidth: 0 }}>
        <b style={{ color: '#0f172a', overflowWrap: 'anywhere', textAlign: 'right' }}>{valor}</b>
        {chave && <button onClick={() => copiar(rotulo, chave)} style={{ border: '1px solid #cbd5e1', background: 'white', borderRadius: 6, fontSize: 11, padding: '2px 6px', cursor: 'pointer' }}>{copiado === rotulo ? 'copiado' : 'copiar'}</button>}
      </span>
    </div>
  );
  return (
    <div style={{ marginTop: 10, border: '1px dashed #93c5fd', borderRadius: 10, padding: '10px 12px', background: '#f8fbff' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', minWidth: 0 }}>🧾 Emitir guia — {parcela.rotulo} <span style={{ fontSize: 10.5, fontWeight: 700, color: '#7c3aed', background: '#f3e8ff', borderRadius: 6, padding: '1px 6px', marginLeft: 4 }}>equipe · em validação</span></div>
        <button onClick={() => setAberto((v) => !v)} style={{ padding: '6px 12px', borderRadius: 8, background: '#0D63DB', color: 'white', border: 'none', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{aberto ? 'Fechar' : 'Emitir guia'}</button>
      </div>
      {aberto && (
        <div style={{ marginTop: 8 }}>
          {!guia && (
            <p style={{ fontSize: 12.5, color: '#b45309', margin: '4px 0 8px' }}>
              ⚠️ Nº do processo {processo ? `"${processo}" fora do padrão CNJ` : 'não cadastrado no imóvel'} — peça o nº ao jurídico antes de emitir; sem ele não dá para saber o portal certo.
            </p>
          )}
          {linha('Processo', guia?.cnj.formatado || processo || '—', guia?.cnj.formatado || processo || null)}
          {guia && linha('Tribunal', `${guia.tribunal} · origem ${guia.cnj.origem}`, null)}
          {linha('Valor nominal', `R$ ${valorTxt}`, valorTxt)}
          {linha('Vencimento', dataBR(parcela.venc), null)}
          {linha('Índice (do auto/carta)', indice || 'não consta no documento', null)}
          {linha('Reclamado (executado)', partes?.executado || 'não lido — use “Reler do auto/carta”', partes?.executado || null)}
          {linha('Reclamante (exequente)', partes?.exequente || 'não lido — use “Reler do auto/carta”', partes?.exequente || null)}
          {linha('Depositante', arrematante || 'o arrematante', arrematante || null)}
          {linha('Finalidade', 'ARREMATAÇÃO DE BENS', null)}
          {linha('Observação', observacao, observacao)}
          {guia && (
            <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {guia.opcoes.map((o) => (
                <a key={o.url + o.banco} href={o.url} target="_blank" rel="noopener noreferrer" title={o.nota || ''}
                  style={{ padding: '7px 12px', borderRadius: 8, background: '#0f172a', color: 'white', textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>
                  Abrir {o.sistema} ({o.banco}) ↗
                </a>
              ))}
              <a href={CALCULADORA_BCB} target="_blank" rel="noopener noreferrer" style={{ padding: '7px 12px', borderRadius: 8, background: 'white', color: '#0D63DB', border: '1px solid #bfdbfe', textDecoration: 'none', fontSize: 12, fontWeight: 700 }}>Calcular correção (BCB) ↗</a>
              <button onClick={() => copiar('tudo', resumo)} style={{ padding: '7px 12px', borderRadius: 8, background: 'white', border: '1px solid #cbd5e1', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>{copiado === 'tudo' ? 'Dados copiados' : 'Copiar todos os dados'}</button>
            </div>
          )}
          {guia?.opcoes.some((o) => o.nota) && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 11.5, color: '#475569' }}>
              {guia.opcoes.filter((o) => o.nota).map((o) => <li key={o.sistema}>{o.sistema}: {o.nota}</li>)}
            </ul>
          )}
          <ol style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: '#334155', lineHeight: 1.55 }}>
            <li>No portal, informe o nº do processo. Em <b>Reclamante</b> e <b>Reclamado</b>, escolha as partes que o auto/carta indica (acima). Com vários reclamantes e o auto sem distinguir, confirme com o jurídico/secretaria da vara — a guia fica vinculada a essa parte.</li>
            <li>Marque <b>“Depositante não está cadastrado no processo”</b> — o arrematante não é parte — e preencha nome e CPF do arrematante.</li>
            <li><b>Instituição financeira</b>: Caixa ou Banco do Brasil. <b>Finalidade</b>: <b>ARREMATAÇÃO DE BENS</b>.</li>
            <li><b>Valor do depósito</b>: o nominal da parcela{indice ? <> corrigido pelo <b>{indice}</b> desde a arrematação</> : ''} (confira na calculadora do BCB; na dúvida, com o jurídico).</li>
            <li><b>Observação</b>: cole a observação acima. Forma de pagamento: <b>PIX</b> (compensa na hora) ou boleto.</li>
            <li>Envie a guia ao cliente, anexe o comprovante no caso e marque a parcela como paga.</li>
          </ol>
          {copiado === 'erro' && <p style={{ fontSize: 11.5, color: '#dc2626', marginTop: 6 }}>Não foi possível copiar — selecione o texto manualmente.</p>}

          <div style={{ marginTop: 12, borderTop: '1px solid #dbeafe', paddingTop: 10 }}>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#0f172a', marginBottom: 6 }}>Guia gerada</div>
            {guiaGerada ? (
              <>
                {linha('Valor da guia', guiaGerada.valor != null ? `R$ ${Number(guiaGerada.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '—', null)}
                {linha('Vencimento da guia', guiaGerada.vencimento ? dataBR(guiaGerada.vencimento) : '—', null)}
                {guiaGerada.pix && linha('PIX copia e cola', `${guiaGerada.pix.slice(0, 28)}…`, guiaGerada.pix)}
                {guiaGerada.linha_digitavel && linha('Código de barras', guiaGerada.linha_digitavel, guiaGerada.linha_digitavel)}
                {guiaGerada.id_deposito && linha('ID do depósito', guiaGerada.id_deposito, guiaGerada.id_deposito)}
                <div style={{ fontSize: 11.5, color: '#475569', marginTop: 4 }}>
                  {guiaGerada.enviada_em ? `✅ Enviada ao cliente (${guiaGerada.enviada_para || 'e-mail do cadastro'}) em ${dataBR(guiaGerada.enviada_em)}.` : 'Ainda não enviada ao cliente.'}
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={enviarCliente} disabled={!!ocupado} style={{ padding: '7px 12px', borderRadius: 8, background: '#0D63DB', color: 'white', border: 'none', fontSize: 12, fontWeight: 700, cursor: ocupado ? 'wait' : 'pointer' }}>
                    {ocupado === 'enviar' ? 'Enviando…' : guiaGerada.enviada_em ? 'Reenviar ao cliente' : 'Enviar ao cliente'}
                  </button>
                  {botaoArquivo('Anexar comprovante (dá baixa)', anexarComprovante, 'comprovante', '#15803d')}
                  {botaoArquivo('Trocar guia', anexarGuia, 'guia', '#64748b')}
                </div>
              </>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {botaoArquivo('Anexar guiaGerada gerada (PDF)', anexarGuia, 'guia')}
                <span style={{ fontSize: 11.5, color: '#64748b' }}>O sistema lê valor, vencimento, código de barras e PIX.</span>
              </div>
            )}
            {msg && (
              <div style={{ marginTop: 8, fontSize: 12, color: msg.tipo === 'ok' ? '#15803d' : '#dc2626' }}>
                {msg.tipo === 'ok' ? '✓ ' : '⚠️ '}{msg.txt}
                {msg.avisos?.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: '#b45309' }}>{msg.avisos.map((a) => <li key={a}>{a}</li>)}</ul>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
