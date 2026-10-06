import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { registrarEvento } from '../utils/tracker';

/**
 * ANDAMENTO DO PROCESSO — diário de um CASO ou de um ARREMATADO (pedido do dono, 24/09).
 * Equipe (admin/analista/consultor/advogado) consulta o CNJ e registra; o assessorado dono
 * do registro só LÊ as etapas marcadas "visível ao cliente" (RLS em caso_andamentos).
 *
 * A arrematação do assessorado corre em prazo processual (auto de arrematação, carta, imissão…)
 * e o caso não tinha onde dizer em que passo está. Aqui o dono:
 *   1. registra a etapa à mão (com observação), e/ou
 *   2. clica "Consultar andamento no CNJ" — o servidor busca as movimentações (DataJud) e as
 *      publicações (DJEN) do processo e ele escolhe qual vira etapa registrada.
 * Nada é consultado sozinho (custo zero em repouso).
 *
 * Grava direto em `caso_andamentos` (RLS: equipe escreve, dono lê). O número do processo mora nas linhas desta
 * tabela, não em `casos` — ver a migração caso_andamentos_processo.sql.
 */
const btn = (bg = '#0D63DB') => ({ padding: '8px 14px', background: bg, color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' });
const inp = { width: '100%', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };
const fmt = (d) => { if (!d) return '—'; const x = new Date(String(d).length === 10 ? `${d}T12:00:00` : d); return isNaN(x) ? String(d) : x.toLocaleDateString('pt-BR'); };

// O resumo vira UMA etapa legível para o cliente (observação ≤ 4000, check da tabela).
const textoDoResumo = (r) => [
  r.situacao,
  r.acao_do_arrematante ? `O que você precisa fazer: ${r.acao_do_arrematante}` : null,
  r.alerta ? `Atenção: ${r.alerta}` : null,
  r.proximos_passos?.length ? `Próximos passos:\n${r.proximos_passos.map((p, i) => `${i + 1}. ${p}`).join('\n')}` : null,
].filter(Boolean).join('\n\n').slice(0, 4000);

// Etapas típicas do leilão extrajudicial (banco/alienação fiduciária) — atalhos; o texto é editável.
const ETAPAS_EXTRAJUDICIAL = [
  'Pagamento do lance confirmado',
  'Contrato / escritura de compra e venda assinada',
  'ITBI pago',
  'Escritura registrada no cartório de imóveis',
  'Notificação do ocupante para desocupação',
  'Ação de imissão na posse ajuizada',
  'Imóvel desocupado — chaves entregues',
];

// A etapa aceita 200 caracteres (check no banco): corta na última frase/palavra inteira, nunca
// no meio ("…notificado sobre a arrem" chegou ao histórico do cliente assim).
function etapaCurta(t) {
  const s = String(t || '').trim();
  if (s.length <= 200) return s;
  const corte = s.slice(0, 199);
  const fim = Math.max(corte.lastIndexOf('. '), corte.lastIndexOf('; '));
  return fim >= 60 ? corte.slice(0, fim + 1) : `${corte.slice(0, corte.lastIndexOf(' '))}…`;
}

export default function AndamentoProcessoCaso({ casoId = null, arrematadoId = null, imovelId = null, podeEditar = true, cardStyle }) {
  const dono = arrematadoId ? { col: 'arrematado_id', id: arrematadoId } : { col: 'caso_id', id: casoId };
  const [linhas, setLinhas] = useState([]);
  const [erroLista, setErroLista] = useState('');
  const [numero, setNumero] = useState('');
  const [etapa, setEtapa] = useState('');
  const [obs, setObs] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [consultando, setConsultando] = useState(false);
  const [consulta, setConsulta] = useState(null);
  const [msg, setMsg] = useState('');
  const [visivel, setVisivel] = useState(true);
  const [extrajudicial, setExtrajudicial] = useState(false);
  const [mostrarCnj, setMostrarCnj] = useState(false);
  const [juris, setJuris] = useState(null);           // null | { carregando } | resultado | { erro }

  const carregar = useCallback(async () => {
    const { data, error } = await supabase.from('caso_andamentos')
      .select('id, etapa, observacao, origem, numero_processo, data_evento, criado_em, visivel_cliente')
      .eq(dono.col, dono.id).order('criado_em', { ascending: false });
    if (error) { setErroLista(`Não consegui ler o andamento: ${error.message}`); return; }
    setErroLista('');
    setLinhas(data || []);
    const n = (data || []).find(l => l.numero_processo)?.numero_processo;
    if (n) setNumero(prev => prev || n);
  }, [dono.col, dono.id]);

  useEffect(() => { carregar(); }, [carregar]);

  // Nº do processo JÁ CONHECIDO (24/09, dono: "não preciso digitar, já há o processo que ocasionou o
  // leilão"): vem do lote arrematado quando o diário ainda não registrou nenhum número.
  // Leilão EXTRAJUDICIAL (24/09, dono: arremate de R$ 63 mil "não há processo — qual a melhor forma de
  // apresentar?"): não existe processo para consultar no CNJ. O andamento é de cartório e posse, então o
  // painel troca a busca do CNJ por atalhos das etapas desse caminho.
  useEffect(() => {
    if (!imovelId) return;
    let vivo = true;
    supabase.from('imoveis_leilao').select('numero_processo, modalidade').eq('id', imovelId).maybeSingle()
      .then(({ data }) => {
        if (!vivo || !data) return;
        setExtrajudicial(/extra/i.test(String(data.modalidade || '')));
        if (podeEditar && data.numero_processo) setNumero(prev => prev || data.numero_processo);
      });
    return () => { vivo = false; };
  }, [imovelId, podeEditar]);

  const registrar = async ({ etapaTxt, observacao, origem = 'manual', dataEvento = null, referencia = null }) => {
    const e = String(etapaTxt || '').trim();
    if (e.length < 2) { setMsg('Descreva a etapa.'); return; }
    setSalvando(true); setMsg('');
    const { data, error } = await supabase.from('caso_andamentos').insert({
      [dono.col]: dono.id, visivel_cliente: visivel, etapa: e.slice(0, 200), observacao: (observacao || '').trim() || null,
      origem, data_evento: dataEvento, referencia, numero_processo: numero.trim() || null,
    }).select('id');
    setSalvando(false);
    if (error || !data?.length) { setMsg(`Não gravou: ${error?.message || 'nenhuma linha criada'}`); return; }
    // Rastro no Cliente 360 (06/10): o 360 só guardava o clique "Registrar", sem o QUE foi registrado —
    // quando o andamento sumiu, o texto só existia no cache do resumo. Agora o conteúdo fica no rastro.
    registrarEvento('submit', { alvo: `andamento registrado · ${origem}`, detalhe: `${dataEvento || ''} ${e}`.trim() });
    setEtapa(''); setObs(''); setMsg('Etapa registrada.');
    carregar();
  };

  const consultar = async () => {
    setConsultando(true); setMsg(''); setConsulta(null);
    try {
      const r = await apiCall('/api/caso-andamento-cnj', { method: 'POST', body: JSON.stringify({ [dono.col]: dono.id, numero_processo: numero.trim() || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setConsulta(d);
      if (d.numero_processo) setNumero(d.numero_processo);
    } catch (e) {
      setMsg(`Consulta falhou: ${e.message}`);
    } finally {
      setConsultando(false);
    }
  };

  // Jurisprudência da etapa (30/09): pesquisa nos sites dos tribunais, cache de 30 dias por tema.
  const temaJuris = (p) => p?.etapa_arrematacao?.etapa
    ? `${p.etapa_arrematacao.etapa} em leilão judicial: prazos, efeitos e riscos para o arrematante`
    : 'arrematação em leilão judicial: impugnação, carta de arrematação e imissão na posse';
  const pesquisarJuris = async () => {
    setJuris({ carregando: true });
    try {
      const p = consulta?.previsao;
      const r = await apiCall('/api/caso-andamento-cnj', { method: 'POST', body: JSON.stringify({ acao: 'jurisprudencia', tema: temaJuris(p),
        contexto: [consulta?.datajud?.processo?.tribunal, consulta?.datajud?.processo?.classe].filter(Boolean).join(' · ') }) });
      const d = await r.json().catch(() => ({}));
      setJuris(r.ok ? d : { erro: d.erro || d.error || `HTTP ${r.status}` });
    } catch (e) { setJuris({ erro: e.message }); }
  };
  const textoPrevisao = (p) => [p.resumo, p.etapa_arrematacao ? `Etapa: ${p.etapa_arrematacao.etapa}. Próximo passo: ${p.etapa_arrematacao.proximo} (${p.etapa_arrematacao.base_legal}).` : null, p.aviso].filter(Boolean).join('\n');

  const movs = consulta?.datajud?.processo?.movimentos || [];
  const pubs = consulta?.djen?.publicacoes || [];
  const resumo = consulta?.resumo || null;

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{extrajudicial ? '🏠 Andamento da arrematação' : '⚖️ Andamento do processo'}</div>
          {extrajudicial && <div style={{ fontSize: 11.5, color: '#475569', margin: '2px 0' }}>Leilão extrajudicial — não há processo na Justiça: o caminho é pagamento, escritura, registro no cartório e posse.</div>}
          <div style={{ fontSize: 11, color: '#64748b' }}>{podeEditar ? 'Equipe registra; o cliente vê as etapas marcadas como visíveis. ' : ''}Etapa atual: <strong>{linhas[0]?.etapa || 'nenhuma registrada'}</strong>{linhas[0] ? ` · ${fmt(linhas[0].data_evento || linhas[0].criado_em)}` : ''}</div>
        </div>
      </div>

      {podeEditar && <>
      {extrajudicial && !mostrarCnj ? (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          {ETAPAS_EXTRAJUDICIAL.map(t => (
            <button key={t} type="button" onClick={() => setEtapa(t)}
              style={{ padding: '5px 10px', background: etapa === t ? '#0D63DB' : '#eff6ff', color: etapa === t ? 'white' : '#0D63DB', border: '1px solid #bfdbfe', borderRadius: 999, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
              {t}
            </button>
          ))}
          <button type="button" onClick={() => setMostrarCnj(true)} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 11, textDecoration: 'underline', cursor: 'pointer' }}>
            Virou ação na Justiça (ex.: imissão na posse)? Consultar no CNJ
          </button>
        </div>
      ) : (
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={{ ...inp, flex: '1 1 240px', minWidth: 0 }} placeholder="Nº do processo (CNJ, 20 dígitos)" value={numero} onChange={e => setNumero(e.target.value)} />
        <button style={btn()} disabled={consultando} onClick={consultar}>{consultando ? 'Consultando e resumindo… (até 1 min)' : 'Consultar andamento no CNJ'}</button>
      </div>
      )}

      {consulta && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12, background: '#f8fafc' }}>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
            Processo <strong>{consulta.numero_processo}</strong> ({consulta.origem_numero})
            {consulta.datajud?.processo && <> · {consulta.datajud.processo.tribunal} · {consulta.datajud.processo.orgao}</>}
          </div>

          {resumo?.ok && (
            <div style={{ background: 'white', border: '1px solid #bfdbfe', borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', letterSpacing: 0.3, marginBottom: 4 }}>EM LINGUAGEM SIMPLES</div>
              <div style={{ fontSize: 14, color: '#0f172a', lineHeight: 1.45, marginBottom: 8 }}>{resumo.situacao}</div>
              {resumo.alerta && <div style={{ fontSize: 13, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>⚠️ {resumo.alerta}</div>}
              {resumo.acao_do_arrematante && <div style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>👉 <strong>O que o arrematante precisa fazer:</strong> {resumo.acao_do_arrematante}</div>}
              {resumo.acontecimentos?.length > 0 && <>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', margin: '8px 0 4px' }}>O QUE ACONTECEU</div>
                {resumo.acontecimentos.map((a, i) => (
                  <div key={`a${i}`} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, padding: '5px 0', borderTop: i ? '1px solid #f1f5f9' : 'none' }}>
                    <span style={{ color: '#64748b', minWidth: 72 }}>{fmt(a.data)}</span>
                    <span style={{ flex: 1, minWidth: 0, color: '#1e293b' }}>
                      {a.texto}
                      {/* Prova literal (28/09): o trecho da publicação/movimento que sustenta o item —
                          para a equipe conferir ANTES de registrar no histórico do cliente. */}
                      {a.trecho && <span style={{ display: 'block', fontSize: 11, color: '#64748b', fontStyle: 'italic', marginTop: 2 }}>“{a.trecho}”</span>}
                    </span>
                    <button style={{ ...btn('#15803d'), padding: '4px 8px', fontSize: 11 }} disabled={salvando}
                      onClick={() => registrar({ etapaTxt: etapaCurta(a.texto), observacao: a.texto.length > 200 ? a.texto : obs, origem: 'cnj', dataEvento: a.data, referencia: { resumo_ia: true, trecho: a.trecho || null } })}>
                      Registrar
                    </button>
                  </div>
                ))}
              </>}
              {resumo.descartados_sem_prova > 0 && <div style={{ fontSize: 11, color: '#92400e', margin: '4px 0' }}>
                {resumo.descartados_sem_prova} item(ns) do resumo automático foram descartados por não terem trecho correspondente nas publicações — confira o processo.
              </div>}
              {resumo.proximos_passos?.length > 0 && <>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', margin: '8px 0 4px' }}>PRÓXIMOS PASSOS ESPERADOS</div>
                <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#1e293b', lineHeight: 1.5 }}>
                  {resumo.proximos_passos.map((p, i) => <li key={`p${i}`}>{p}</li>)}
                </ol>
              </>}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                <button style={btn('#15803d')} disabled={salvando} onClick={() => registrar({ etapaTxt: 'Atualização do processo', observacao: textoDoResumo(resumo), origem: 'cnj', dataEvento: new Date().toISOString().slice(0, 10), referencia: { resumo_ia: true } })}>
                  Registrar este resumo no andamento
                </button>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Resumo automático das publicações — confira antes de registrar.</span>
              </div>
            </div>
          )}
          {consulta.previsao?.disponivel && (() => {
            const p = consulta.previsao;
            const cor = { andando: '#15803d', lento: '#b45309', parado: '#b91c1c' }[p.status] || '#334155';
            return (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#334155', letterSpacing: 0.3, minWidth: 0 }}>⏱️ PREVISÃO DO PRÓXIMO ANDAMENTO</div>
                {p.status && <span style={{ fontSize: 11, fontWeight: 800, color: cor, background: `${cor}14`, borderRadius: 999, padding: '2px 8px' }}>{p.status === 'andando' ? 'Andando' : p.status === 'lento' ? 'Mais lento que o normal' : 'Parado'}</span>}
              </div>
              {p.so_referencia && <div style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', marginBottom: 6 }}>{p.resumo}</div>}
              {p.proximo_despacho && (
                <div style={{ fontSize: 14, color: '#0f172a', marginBottom: 6 }}>
                  🧑‍⚖️ {p.proximo_despacho.atrasado
                    ? <>O juiz costuma despachar a cada <strong>~{p.entre_despachos.mediana} dias</strong>; o último foi em {fmt(p.proximo_despacho.ultimo)}, <strong>há {p.proximo_despacho.dias_desde} dias — acima do normal</strong>. Vale cobrar a secretaria.</>
                    : <>Próximo despacho do juiz esperado entre <strong>{fmt(p.proximo_despacho.de)}</strong> e <strong>{fmt(p.proximo_despacho.ate)}</strong> (costuma despachar a cada ~{p.entre_despachos.mediana} dias).</>}
                  <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>Base: {p.proximo_despacho.fonte}. Metade dos intervalos entre despachos fica entre {p.entre_despachos.p25} e {p.entre_despachos.p75} dias.</span>
                </div>
              )}
              {p.proxima_janela && !p.proximo_despacho && (
                <div style={{ fontSize: 14, color: '#0f172a', marginBottom: 6 }}>
                  {p.proxima_janela.atrasada
                    ? <>Próxima movimentação <strong>já era esperada até {fmt(p.proxima_janela.ate)}</strong> — vale cobrar a secretaria.</>
                    : <>Próxima movimentação provável entre <strong>{fmt(p.proxima_janela.de)}</strong> e <strong>{fmt(p.proxima_janela.ate)}</strong>.</>}
                  <span style={{ display: 'block', fontSize: 11, color: '#64748b' }}>Base: {p.proxima_janela.fonte}. Último ato: {p.ultimo_ato.rotulo || p.ultimo_ato.descricao} em {fmt(p.ultimo_ato.data)} (há {p.dias_desde_ultimo} dias).</span>
                </div>
              )}
              {p.entre_despachos && !p.proximo_despacho && <div style={{ fontSize: 13, color: '#1e293b', marginBottom: 6 }}>🧑‍⚖️ Entre um despacho do juiz e o próximo: <strong>~{p.entre_despachos.mediana} dias</strong> (metade entre {p.entre_despachos.p25} e {p.entre_despachos.p75}) — {p.entre_despachos.fonte}.</div>}
              {p.ultimo_ato && <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 6 }}>Último ato: {p.ultimo_ato.rotulo || p.ultimo_ato.descricao} em {fmt(p.ultimo_ato.data)} (há {p.dias_desde_ultimo} dias).</div>}
              {p.fluxo_provavel?.length > 0 && <>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', margin: '8px 0 4px' }}>O QUE COSTUMA VIR DEPOIS DE "{(p.ultimo_ato?.rotulo || '').toUpperCase()}"</div>
                {p.fluxo_provavel.map((f, i) => (
                  <div key={`f${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '3px 0' }}>
                    <div style={{ width: 90, height: 8, background: '#f1f5f9', borderRadius: 99, overflow: 'hidden', flexShrink: 0 }}><div style={{ width: `${f.probabilidade}%`, height: '100%', background: '#0D63DB' }} /></div>
                    <span style={{ minWidth: 36, fontWeight: 700 }}>{f.probabilidade}%</span>
                    <span style={{ flex: 1, minWidth: 0 }}>{f.proximo}{f.mediana_dias > 0 ? ` · em ~${f.mediana_dias} dias` : ' · geralmente no mesmo dia'}</span>
                  </div>
                ))}
                <div style={{ fontSize: 10.5, color: '#94a3b8' }}>Frequência real em processos acompanhados pela plataforma{p.justica ? ` (Justiça ${p.justica})` : ''}.</div>
              </>}
              {p.etapa_arrematacao && (
                <div style={{ fontSize: 12.5, color: '#1e293b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '6px 10px', marginTop: 8 }}>
                  <strong>Etapa da arrematação: {p.etapa_arrematacao.etapa}.</strong> {p.etapa_arrematacao.proximo} <span style={{ color: '#64748b' }}>({p.etapa_arrematacao.base_legal})</span>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 6 }}>{p.aviso}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <button style={btn('#15803d')} disabled={salvando} onClick={() => registrar({ etapaTxt: 'Previsão do próximo andamento', observacao: textoPrevisao(p), origem: 'cnj', dataEvento: new Date().toISOString().slice(0, 10), referencia: { previsao: true } })}>Registrar previsão no andamento</button>
                <button style={btn('#475569')} disabled={juris?.carregando} onClick={pesquisarJuris}>{juris?.carregando ? 'Pesquisando nos tribunais… (até 1 min)' : '📚 Jurisprudência desta etapa'}</button>
              </div>
              {juris && !juris.carregando && (
                <div style={{ marginTop: 8 }}>
                  {juris.erro && <div style={{ fontSize: 12, color: '#92400e' }}>Não foi possível pesquisar agora: {juris.erro}</div>}
                  {!juris.erro && !juris.itens?.length && <div style={{ fontSize: 12, color: '#64748b' }}>A pesquisa nos sites dos tribunais não trouxe decisão com link verificável para este tema.</div>}
                  {juris.itens?.map((j, i) => (
                    <div key={`j${i}`} style={{ fontSize: 12.5, padding: '6px 0', borderTop: '1px solid #f1f5f9' }}>
                      <strong>{[j.tribunal, j.processo, j.data].filter(Boolean).join(' · ') || 'Decisão'}</strong> — {j.tese}{' '}
                      <a href={j.url} target="_blank" rel="noopener noreferrer" style={{ color: '#0D63DB' }}>ver no tribunal</a>
                    </div>
                  ))}
                  {juris.itens?.length > 0 && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{juris.aviso}{juris.do_cache ? ' (pesquisa recente reaproveitada)' : ''}</div>}
                </div>
              )}
            </div>
            );
          })()}
          {resumo && !resumo.ok && <div style={{ fontSize: 12, color: '#92400e', marginBottom: 8 }}>{(consulta.datajud?.erro || consulta.djen?.erro) && !movs.length && !pubs.length ? 'O resumo simples sai quando o CNJ ou o Diário Oficial responderem — tente de novo em alguns minutos.' : `Não foi possível gerar o resumo simples agora (${resumo.erro}).`}</div>}

          {consulta.datajud?.erro && (
            <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}>
              {consulta.datajud.aviso || 'Não foi possível consultar o CNJ (DataJud) agora.'}
              <details style={{ marginTop: 4 }}><summary style={{ cursor: 'pointer', color: '#a16207' }}>detalhe técnico</summary>
                <div style={{ color: '#78716c', overflowWrap: 'anywhere', fontSize: 11, marginTop: 4 }}>{consulta.datajud.erro}</div>
              </details>
            </div>
          )}
          {!consulta.datajud?.erro && !consulta.datajud?.processo && <div style={{ fontSize: 12, color: '#92400e', marginBottom: 6 }}>O CNJ respondeu, mas não encontrou este número em {(consulta.datajud?.tribunais || []).join(', ').toUpperCase() || '—'}.</div>}
          {consulta.djen?.erro && <div style={{ fontSize: 12, color: '#92400e', marginBottom: 6 }}>O Diário Oficial (DJEN) não respondeu agora — tente de novo em alguns minutos. <span style={{ color: '#a8a29e', fontSize: 11 }}>({consulta.djen.erro})</span></div>}

          {(movs.length > 0 || pubs.length > 0) && (
          <details open={!resumo?.ok}>
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 700, color: '#334155', margin: '6px 0' }}>Ver textos originais ({movs.length} movimentações · {pubs.length} publicações)</summary>
          {movs.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', margin: '6px 0' }}>MOVIMENTAÇÕES (DataJud)</div>}
          {movs.map((m, i) => (
            <div key={`m${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, padding: '4px 0', borderTop: i ? '1px solid #e2e8f0' : 'none' }}>
              <span style={{ color: '#64748b', minWidth: 72 }}>{fmt(m.data)}</span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{m.descricao}</span>
              <button style={{ ...btn('#15803d'), padding: '4px 8px', fontSize: 11 }} disabled={salvando}
                onClick={() => registrar({ etapaTxt: m.descricao, observacao: obs, origem: 'cnj', dataEvento: m.data ? String(m.data).slice(0, 10) : null, referencia: { ...m, tribunal: consulta.datajud?.processo?.tribunal } })}>
                Registrar
              </button>
            </div>
          ))}
          {pubs.length > 0 && <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', margin: '10px 0 6px' }}>PUBLICAÇÕES (DJEN)</div>}
          {pubs.map((p, i) => (
            <div key={`p${i}`} style={{ fontSize: 12, padding: '6px 0', borderTop: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ color: '#64748b', minWidth: 72 }}>{fmt(p.data_disponibilizacao)}</span>
                <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{p.tipo_documento || 'Publicação'} · {p.orgao || p.tribunal || ''}</span>
                <button style={{ ...btn('#15803d'), padding: '4px 8px', fontSize: 11 }} disabled={salvando}
                  onClick={() => registrar({ etapaTxt: `${p.tipo_documento || 'Publicação'} (DJEN)`, observacao: obs || String(p.texto || '').slice(0, 600), origem: 'djen', dataEvento: p.data_disponibilizacao ? String(p.data_disponibilizacao).slice(0, 10) : null, referencia: { tribunal: p.tribunal, orgao: p.orgao, tipo_documento: p.tipo_documento } })}>
                  Registrar
                </button>
              </div>
              <div style={{ color: '#475569', marginTop: 2 }}>{String(p.texto || '').slice(0, 280)}{String(p.texto || '').length > 280 ? '…' : ''}</div>
            </div>
          ))}
          </details>
          )}
          {consulta.djen?.ok && !pubs.length && <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>{consulta.djen.observacao || 'DJEN sem publicações para este processo.'}</div>}
        </div>
      )}

      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        <input style={inp} placeholder="Etapa (ex.: Auto de arrematação assinado, Aguardando carta, Imissão na posse…)" value={etapa} onChange={e => setEtapa(e.target.value)} />
        <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} placeholder="Observação (opcional)" value={obs} onChange={e => setObs(e.target.value)} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button style={btn('#0f172a')} disabled={salvando} onClick={() => registrar({ etapaTxt: etapa, observacao: obs })}>{salvando ? 'Salvando…' : 'Registrar etapa'}</button>
          <label style={{ fontSize: 12, color: '#475569', display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={visivel} onChange={e => setVisivel(e.target.checked)} /> Visível ao cliente
          </label>
        </div>
      </div>
      </>}
      {msg && <div style={{ fontSize: 12, color: msg.startsWith('Etapa') ? '#15803d' : '#b91c1c', marginBottom: 8 }}>{msg}</div>}
      {erroLista && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 8 }}>{erroLista}</div>}

      {!podeEditar && !linhas.length && !erroLista && <div style={{ fontSize: 12, color: '#64748b' }}>A equipe ainda não registrou etapas deste processo.</div>}
      {linhas.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', marginBottom: 6 }}>HISTÓRICO</div>
          {linhas.map(l => (
            <div key={l.id} style={{ fontSize: 12, padding: '6px 0', borderTop: '1px solid #e2e8f0' }}>
              <span style={{ color: '#64748b' }}>{fmt(l.data_evento || l.criado_em)}</span> · <strong>{l.etapa}</strong>
              {podeEditar && <span style={{ color: '#94a3b8' }}> ({l.origem === 'manual' ? 'manual' : l.origem.toUpperCase()}{l.visivel_cliente ? '' : ' · só equipe'})</span>}
              {l.observacao && <div style={{ color: '#475569', marginTop: 2, whiteSpace: 'pre-wrap' }}>{l.observacao}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
