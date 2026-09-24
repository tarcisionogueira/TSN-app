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
  useEffect(() => {
    if (!podeEditar || !imovelId) return;
    let vivo = true;
    supabase.from('imoveis_leilao').select('numero_processo').eq('id', imovelId).maybeSingle()
      .then(({ data }) => { if (vivo && data?.numero_processo) setNumero(prev => prev || data.numero_processo); });
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

  return (
    <div style={cardStyle}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>⚖️ Andamento do processo</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{podeEditar ? 'Equipe registra; o cliente vê as etapas marcadas como visíveis. ' : ''}Etapa atual: <strong>{linhas[0]?.etapa || 'nenhuma registrada'}</strong>{linhas[0] ? ` · ${fmt(linhas[0].data_evento || linhas[0].criado_em)}` : ''}</div>
        </div>
      </div>

      {podeEditar && <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <input style={{ ...inp, flex: '1 1 240px', minWidth: 0 }} placeholder="Nº do processo (CNJ, 20 dígitos)" value={numero} onChange={e => setNumero(e.target.value)} />
        <button style={btn()} disabled={consultando} onClick={consultar}>{consultando ? 'Consultando…' : 'Consultar andamento no CNJ'}</button>
      </div>

      {consulta && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, marginBottom: 12, background: '#f8fafc' }}>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
            Processo <strong>{consulta.numero_processo}</strong> ({consulta.origem_numero})
            {consulta.datajud?.processo && <> · {consulta.datajud.processo.tribunal} · {consulta.datajud.processo.classe} · {consulta.datajud.processo.orgao}</>}
          </div>
          {consulta.datajud?.erro && <div style={{ fontSize: 12, color: '#b91c1c', marginBottom: 6 }}>DataJud não respondeu: {consulta.datajud.erro}</div>}
          {!consulta.datajud?.erro && !consulta.datajud?.processo && <div style={{ fontSize: 12, color: '#92400e', marginBottom: 6 }}>DataJud respondeu e não achou este número (tribunais: {(consulta.datajud?.tribunais || []).join(', ') || '—'}).</div>}
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
          {consulta.djen?.erro && <div style={{ fontSize: 12, color: '#b91c1c', marginTop: 6 }}>DJEN não respondeu: {consulta.djen.erro}</div>}
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
