import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Sparkles, TrendingUp, Users, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

/**
 * MONITOR FINANCEIRO — para onde o dinheiro está indo, e o que fazer a respeito.
 *
 * Pedido do dono (08/08): "um monitor de pra onde está indo o dinheiro, com um gráfico ou um
 * direcionamento... visualizar de forma simples e prática como está a saúde financeira. Bom ter
 * um diagnóstico, podendo ser pelo Gemini, para dar direções básicas em cima de pagamentos,
 * assim como sugestões comerciais."
 *
 * Três blocos, do mais concreto para o mais interpretativo:
 *   1. FILA DE CREDORES — quem ainda não tem conta contábil, ordenado por VOLUME. Um clique
 *      classifica o credor e todos os lançamentos dele, de uma vez. É o trabalho que faz a DRE
 *      existir, e por isso vem primeiro.
 *   2. GRÁFICO — entradas × saídas mês a mês e a divisão das saídas por grupo. SVG puro, sem
 *      biblioteca: são poucas barras e uma dependência a mais custaria mais que o gráfico.
 *   3. DIAGNÓSTICO — leitura dos números. Os achados determinísticos (margem, concentração,
 *      pendências) aparecem SEMPRE; o texto do Gemini entra por cima quando disponível, e a tela
 *      diz qual dos dois está vendo — "a IA não respondeu" é diferente de "a IA disse que está bem".
 */

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mesBR = (c) => { const [a, m] = String(c || '').split('-'); return `${m}/${String(a || '').slice(2)}`; };
const CORES = ['#0D63DB', '#7c3aed', '#0891b2', '#db2777', '#059669', '#b45309', '#dc2626', '#475569'];

export default function MonitorFinanceiro() {
  const [mon, setMon] = useState(null);
  const [forn, setForn] = useState(null);
  const [contas, setContas] = useState([]);
  const [diag, setDiag] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState('');
  const [msg, setMsg] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const [rm, rf, rl] = await Promise.all([
        apiCall('/api/conciliacao?acao=monitor&meses=6'),
        apiCall('/api/conciliacao?acao=fornecedores'),
        apiCall('/api/conciliacao?acao=listar'),
      ]);
      const [dm, df, dl] = await Promise.all([rm.json().catch(() => ({})), rf.json().catch(() => ({})), rl.json().catch(() => ({}))]);
      // Cada resposta é checada: um 403 traz JSON sem os campos e a tela mostraria zeros como se
      // fossem a verdade financeira.
      setMon(rm.ok ? dm : null);
      setForn(rf.ok ? df : null);
      setContas(rl.ok ? (dl.plano_contas || []) : []);
      if (!rm.ok || !rf.ok) setMsg(dm?.error || df?.error || 'Não consegui carregar tudo.');
    } catch { setMsg('Falha de conexão.'); }
    setCarregando(false);
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function diagnosticar() {
    setOcupado('diag');
    try {
      const r = await apiCall('/api/conciliacao', { method: 'POST', body: JSON.stringify({ acao: 'diagnostico' }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d?.error || 'Não consegui gerar o diagnóstico.');
      else setDiag(d);
    } catch { setMsg('Falha ao diagnosticar.'); }
    setOcupado('');
  }

  // MESCLAR: o mesmo credor grafado de dois jeitos ("Bright Data" e "BRIGHTDATA"). Sem isto ele
  // ocupa duas linhas na fila, divide o próprio histórico, e a DRE mostra dois custos onde há um.
  async function mesclar(deChave, paraChave) {
    setOcupado(deChave);
    try {
      const r = await apiCall('/api/conciliacao', { method: 'POST', body: JSON.stringify({ acao: 'mesclar_fornecedor', de_chave: deChave, para_chave: paraChave }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d?.error || 'Falha ao mesclar.');
      else { setMsg(`Credores unidos — ${d.lancamentos_migrados} lançamento(s) migrados.`); await carregar(); }
    } catch { setMsg('Falha de conexão.'); }
    setOcupado('');
  }

  async function definirCredor(chave, conta) {
    setOcupado(chave);
    try {
      const r = await apiCall('/api/conciliacao', { method: 'POST', body: JSON.stringify({ acao: 'definir_fornecedor', chave, conta }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(d?.error || 'Falha ao classificar o credor.');
      else { setMsg(`Credor classificado — ${d.lancamentos_reclassificados} lançamento(s) atualizados.`); await carregar(); }
    } catch { setMsg('Falha de conexão.'); }
    setOcupado('');
  }

  const serie = mon?.serie || [];
  const maxBarra = Math.max(1, ...serie.map(s => Math.max(s.entradas, s.saidas)));
  const grupos = mon?.por_grupo || [];
  const totalSaidas = grupos.reduce((s, g) => s + g.total, 0);

  return (
    <div>
      {msg && <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af', borderRadius: 9, padding: '9px 13px', fontSize: 12.5, marginBottom: 12 }}>{msg}</div>}
      {carregando && <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}><Loader2 size={19} style={{ animation: 'spin 1s linear infinite' }} /></div>}

      {!carregando && (
        <>
          {/* 1. FILA DE CREDORES — o trabalho que faz a DRE existir */}
          {!!forn?.pendentes?.length && (
            <div style={{ background: '#fff', border: '1px solid #fde68a', borderRadius: 12, padding: '15px 17px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4 }}>
                <Users size={16} color="#b45309" />
                <span style={{ fontSize: 13.5, fontWeight: 900, color: '#111' }}>Credores a classificar ({forn.resumo?.sem_conta})</span>
              </div>
              <div style={{ fontSize: 11.5, color: '#92400e', marginBottom: 12, lineHeight: 1.55 }}>
                {brl(forn.resumo?.valor_sem_conta)} sem conta contábil. Classifique o credor <strong>uma vez</strong> — todos os lançamentos dele, passados e futuros, passam a cair na conta certa sozinhos.
              </div>
              {forn.pendentes.slice(0, 12).map(f => (
                <div key={f.chave} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 800, color: '#111' }}>{f.nome_exibicao || f.chave}</div>
                    <div style={{ fontSize: 10.5, color: '#94a3b8' }}>{f.ocorrencias} lançamento(s) · {f.direcao === 'saida' ? 'saída' : 'entrada'} · {brl(f.total_valor)}</div>
                  </div>
                  <select defaultValue="" disabled={ocupado === f.chave}
                    onChange={e => { if (e.target.value) definirCredor(f.chave, e.target.value); }}
                    style={{ padding: '6px 9px', borderRadius: 8, border: '1px solid #fbbf24', fontSize: 11.5, maxWidth: 260 }}>
                    <option value="">Classificar em…</option>
                    {contas.filter(c => (f.direcao === 'entrada' ? c.natureza === 'receita' : c.natureza !== 'receita'))
                      .map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nome}</option>)}
                  </select>
                  {/* Mesclar com outro credor já conhecido — resolve a mesma empresa escrita de
                      dois jeitos, que a normalização sozinha não junta. */}
                  <select defaultValue="" disabled={ocupado === f.chave}
                    onChange={e => { if (e.target.value) mesclar(f.chave, e.target.value); }}
                    title="É o mesmo credor de outro já cadastrado? Una os dois."
                    style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 11, maxWidth: 150, color: '#64748b' }}>
                    <option value="">é o mesmo que…</option>
                    {[...(forn.classificados || []), ...forn.pendentes.filter(x => x.chave !== f.chave)]
                      .slice(0, 60).map(o => <option key={o.chave} value={o.chave}>{o.nome_exibicao || o.chave}</option>)}
                  </select>
                  {ocupado === f.chave && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: '#b45309' }} />}
                </div>
              ))}
            </div>
          )}

          {/* 2. GRÁFICO — entradas × saídas por mês */}
          {!!serie.length && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '15px 17px', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
                <TrendingUp size={16} color="#0D63DB" />
                <span style={{ fontSize: 13.5, fontWeight: 900, color: '#111' }}>Entradas × saídas — últimos {mon.meses} meses</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 150, paddingBottom: 22, position: 'relative' }}>
                {serie.map(s => (
                  <div key={s.competencia} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: '100%', width: '100%', justifyContent: 'center' }}>
                      <div title={`Entradas ${brl(s.entradas)}`} style={{ width: 16, height: `${(s.entradas / maxBarra) * 100}%`, background: '#059669', borderRadius: '3px 3px 0 0', minHeight: s.entradas > 0 ? 3 : 0 }} />
                      <div title={`Saídas ${brl(s.saidas)}`} style={{ width: 16, height: `${(s.saidas / maxBarra) * 100}%`, background: '#dc2626', borderRadius: '3px 3px 0 0', minHeight: s.saidas > 0 ? 3 : 0 }} />
                    </div>
                    <div style={{ position: 'absolute', bottom: 4, fontSize: 10, color: '#64748b', fontWeight: 700 }}>{mesBR(s.competencia)}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#64748b', marginTop: 4 }}>
                <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#059669', borderRadius: 2, marginRight: 4 }} />Entradas</span>
                <span><span style={{ display: 'inline-block', width: 9, height: 9, background: '#dc2626', borderRadius: 2, marginRight: 4 }} />Saídas</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, color: serie[serie.length - 1]?.resultado >= 0 ? '#059669' : '#dc2626' }}>
                  Último mês: {brl(serie[serie.length - 1]?.resultado)}
                </span>
              </div>
            </div>
          )}

          {/* Para onde foi — divisão das saídas */}
          {!!grupos.length && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '15px 17px', marginBottom: 16 }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#111', marginBottom: 12 }}>Para onde o dinheiro foi</div>
              <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', marginBottom: 12 }}>
                {grupos.map((g, i) => (
                  <div key={g.grupo} title={`${g.grupo}: ${brl(g.total)}`}
                    style={{ width: `${totalSaidas > 0 ? (g.total / totalSaidas) * 100 : 0}%`, background: CORES[i % CORES.length] }} />
                ))}
              </div>
              {grupos.map((g, i) => (
                <div key={g.grupo} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 12.5 }}>
                  <span style={{ color: '#334155' }}>
                    <span style={{ display: 'inline-block', width: 9, height: 9, background: CORES[i % CORES.length], borderRadius: 2, marginRight: 6 }} />
                    {g.grupo}
                  </span>
                  <strong style={{ color: '#475569' }}>{brl(g.total)} · {totalSaidas > 0 ? Math.round((g.total / totalSaidas) * 100) : 0}%</strong>
                </div>
              ))}
            </div>
          )}

          {/* Maiores credores */}
          {!!mon?.top_credores?.length && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '15px 17px', marginBottom: 16 }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#111', marginBottom: 10 }}>Maiores credores do período</div>
              {mon.top_credores.map(c => (
                <div key={c.credor} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12.5 }}>
                  <span style={{ color: '#334155' }}>{c.credor} <span style={{ color: '#94a3b8' }}>({c.qtd}× · {c.conta || 'sem conta'})</span></span>
                  <strong style={{ color: '#dc2626' }}>{brl(c.total)}</strong>
                </div>
              ))}
            </div>
          )}

          {/* 3. DIAGNÓSTICO */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '15px 17px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 13.5, fontWeight: 900, color: '#111' }}>Diagnóstico da operação</span>
              <button onClick={diagnosticar} disabled={!!ocupado}
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 12.5, fontWeight: 800, background: '#7c3aed', color: '#fff' }}>
                {ocupado === 'diag' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />} Analisar
              </button>
            </div>

            {!diag && <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.6 }}>Lê os números dos últimos 6 meses e devolve direções sobre pagamentos e sugestões comerciais. Roda no Gemini — custa centavos.</div>}

            {diag && (
              <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  {[['Entradas', brl(diag.numeros?.entradas), '#059669'], ['Saídas', brl(diag.numeros?.saidas), '#dc2626'],
                    ['Resultado', brl(diag.numeros?.resultado), (diag.numeros?.resultado || 0) >= 0 ? '#059669' : '#dc2626'],
                    ['Margem', diag.numeros?.margem_pct == null ? '—' : `${diag.numeros.margem_pct}%`, (diag.numeros?.margem_pct || 0) >= 20 ? '#059669' : '#b45309']].map(([r, v, c]) => (
                    <div key={r} style={{ flex: 1, minWidth: 110 }}>
                      <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{r}</div>
                      <div style={{ fontSize: 16, fontWeight: 900, color: c }}>{v}</div>
                    </div>
                  ))}
                </div>

                {!!diag.achados?.length && (
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9, padding: '10px 13px', marginBottom: 12 }}>
                    {diag.achados.map((a, i) => (
                      <div key={i} style={{ display: 'flex', gap: 7, fontSize: 12.5, color: '#92400e', lineHeight: 1.55, marginBottom: i < diag.achados.length - 1 ? 5 : 0 }}>
                        <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} /> {a}
                      </div>
                    ))}
                  </div>
                )}

                {diag.diagnostico
                  ? <div style={{ fontSize: 13, color: '#334155', lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>{diag.diagnostico}</div>
                  : <div style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic' }}>A IA não respondeu agora — os achados acima vêm dos números e valem por si.</div>}
              </>
            )}
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
