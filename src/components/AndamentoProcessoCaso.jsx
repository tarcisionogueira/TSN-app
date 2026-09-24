import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';

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
                    <span style={{ flex: 1, minWidth: 0, color: '#1e293b' }}>{a.texto}</span>
                    <button style={{ ...btn('#15803d'), padding: '4px 8px', fontSize: 11 }} disabled={salvando}
                      onClick={() => registrar({ etapaTxt: a.texto.slice(0, 200), observacao: obs, origem: 'cnj', dataEvento: a.data, referencia: { resumo_ia: true } })}>
                      Registrar
                    </button>
                  </div>
                ))}
              </>}
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
