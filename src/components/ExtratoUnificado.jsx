import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, RefreshCw, ArrowDownLeft, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

/**
 * EXTRATO UNIFICADO — o dinheiro que entrou e saiu das contas da plataforma, classificado.
 *
 * Pedido do dono (08/08): "traga o extrato real da plataforma, assim como uma classificação do
 * que está sendo investido, para podermos ter uma tomada de decisão com base no fluxo financeiro.
 * Podendo ser o extrato unificado ou separado por tipo de banco."
 *
 * O que esta tela mostra que as outras não mostravam: as SAÍDAS. A visão de hoje é de receita —
 * o endpoint de transações do Mercado Pago descarta de propósito tudo que não é recebimento, e é
 * exatamente ali que estão os custos pagos pela conta (IA, infraestrutura, anúncios). Sem os dois
 * lados não há fluxo de caixa, só faturamento.
 *
 * Honestidade da cobertura: a faixa do topo diz, sempre, quais contas foram lidas. Um total que
 * some Asaas + Mercado Pago não é a posição da empresa enquanto os quatro bancos não entrarem —
 * e um número que parece consolidado sem ser é pior que número nenhum.
 */

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ROTULO = {
  ia_e_dados: 'IA e dados',
  infraestrutura: 'Infraestrutura',
  marketing: 'Marketing e anúncios',
  taxa_gateway: 'Taxas de gateway',
  saque_e_transferencia: 'Saques e transferências',
  imposto: 'Impostos',
  assinatura: 'Assinaturas',
  credito_avulso: 'Créditos avulsos',
  receita_nao_classificada: 'Receita sem classificação',
  nao_classificado: 'Saída sem classificação',
};
const COR = {
  ia_e_dados: '#7c3aed', infraestrutura: '#0891b2', marketing: '#db2777',
  taxa_gateway: '#b45309', saque_e_transferencia: '#475569', imposto: '#dc2626',
  assinatura: '#059669', credito_avulso: '#0d9488',
  receita_nao_classificada: '#94a3b8', nao_classificado: '#f59e0b',
};

export default function ExtratoUnificado() {
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [dias, setDias] = useState(90);
  const [banco, setBanco] = useState('todos');

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    try {
      const r = await apiCall(`/api/financeiro-extrato?dias=${dias}`);
      const d = await r.json().catch(() => ({}));
      // Checa o .ok ANTES de usar o corpo: um 403/429 traz JSON sem `resumo` e a tela ficaria
      // mostrando zeros como se fosse a verdade financeira da empresa.
      if (!r.ok) { setErro(d?.error || 'Não consegui carregar o extrato.'); setDados(null); }
      else setDados(d);
    } catch { setErro('Falha de conexão ao carregar o extrato.'); setDados(null); }
    setCarregando(false);
  }, [dias]);

  useEffect(() => { carregar(); }, [carregar]);

  const lancs = (dados?.lancamentos || []).filter(l => banco === 'todos' || l.banco === banco);
  const bancos = ['todos', ...new Set((dados?.lancamentos || []).map(l => l.banco))];
  const saidas = (dados?.por_categoria || []).filter(c => c.direcao === 'saida');
  const entradas = (dados?.por_categoria || []).filter(c => c.direcao === 'entrada');
  const totalSaidas = saidas.reduce((s, c) => s + c.total, 0);

  const card = (rot, val, cor, sub) => (
    <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', flex: 1, minWidth: 150 }}>
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>{rot}</div>
      <div style={{ fontSize: 19, fontWeight: 900, color: cor, marginTop: 4 }}>{val}</div>
      {sub && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <select value={dias} onChange={e => setDias(Number(e.target.value))}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 600 }}>
          {[30, 60, 90, 180, 365].map(d => <option key={d} value={d}>Últimos {d} dias</option>)}
        </select>
        <select value={banco} onChange={e => setBanco(e.target.value)}
          style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, fontWeight: 600 }}>
          {bancos.map(b => <option key={b} value={b}>{b === 'todos' ? 'Todas as contas' : b}</option>)}
        </select>
        <button onClick={carregar} disabled={carregando}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 13px', border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#334155' }}>
          <RefreshCw size={13} /> Atualizar
        </button>
      </div>

      {/* TOTAL INCOMPLETO tem faixa PRÓPRIA, vermelha, acima da cobertura (08/08). Enquanto a
          leitura parava calada nos 100 primeiros lançamentos, o resumo mostrava a soma de um
          pedaço com cara de número fechado — e dois períodos não batiam entre si. Agora, se
          faltou lançamento, isso é a primeira coisa que a tela diz. */}
      {dados && dados.completo === false && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: '#b91c1c', marginBottom: 10, lineHeight: 1.55, fontWeight: 600 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          {/* A faixa NÃO crava mais a causa (10/08). O texto anterior dizia sempre "o período tem
              mais lançamentos... reduza o período", mas incompleto também acontece quando a API
              do gateway RECUSA a leitura (403) — e aí reduzir o período não resolve nada. A causa
              real vem em `avisos`, logo abaixo, fonte por fonte. */}
          {/* NOMEIA A CONTA (10/08). Cada banco tem saúde PRÓPRIA agora, então a faixa pode dizer
              "o Asaas" em vez de "algo" — e deixa explícito que as contas boas seguem confiáveis.
              Antes, um 403 no Asaas invalidava também o Mercado Pago, que estava perfeito. */}
          <span>
            {dados.bancos_incompletos?.length
              ? <>Leitura incompleta em <strong>{dados.bancos_incompletos.join(' e ')}</strong>. O total unificado abaixo está <strong>subestimado</strong> — as demais contas seguem íntegras. Veja o motivo em <strong>Por conta</strong>.</>
              : <>Estes totais estão <strong>incompletos</strong> — parte do movimento não entrou na soma. O motivo está em <strong>Cobertura</strong>, logo abaixo.</>}
          </span>
        </div>
      )}

      {dados?.cobertura && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '10px 13px', fontSize: 12, color: '#1e40af', marginBottom: 14, lineHeight: 1.55 }}>
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span><strong>Cobertura:</strong> {dados.cobertura}{dados.avisos?.length ? ` · ${dados.avisos.join(' · ')}` : ''}</span>
        </div>
      )}

      {carregando && <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite' }} /><div style={{ marginTop: 8, fontSize: 13 }}>Lendo as contas…</div></div>}
      {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '11px 14px', fontSize: 13, color: '#dc2626' }}>{erro}</div>}

      {!carregando && dados && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {card('Entradas', brl(dados.resumo?.entradas), '#059669', `${dados.periodo?.dias} dias`)}
            {card('Saídas', brl(dados.resumo?.saidas), '#dc2626', `${saidas.reduce((s, c) => s + c.qtd, 0)} lançamentos`)}
            {card('Resultado', brl(dados.resumo?.resultado), (dados.resumo?.resultado || 0) >= 0 ? '#059669' : '#dc2626', 'entradas − saídas')}
          </div>

          {/* Saldos por conta */}
          {!!dados.contas?.length && (
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
              {dados.contas.map(c => (
                <div key={c.banco} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 15px', flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>{c.banco}</div>
                  <div style={{ fontSize: 17, fontWeight: 900, color: c.saldo_indisponivel ? '#94a3b8' : '#111', marginTop: 3 }}>
                    {c.saldo_indisponivel ? 'saldo indisponível' : brl(c.saldo)}
                  </div>
                  {c.saldo_a_liberar > 0 && <div style={{ fontSize: 11, color: '#b45309', marginTop: 2 }}>+ {brl(c.saldo_a_liberar)} a liberar</div>}
                </div>
              ))}
            </div>
          )}

          {/* PARA ONDE O DINHEIRO ESTÁ INDO — é a pergunta que motivou a tela */}
          {!!saidas.length && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#111', marginBottom: 12 }}>Para onde o dinheiro foi</div>
              {saidas.map(c => {
                const pct = totalSaidas > 0 ? (c.total / totalSaidas) * 100 : 0;
                return (
                  <div key={c.categoria} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: '#334155' }}>{ROTULO[c.categoria] || c.categoria} <span style={{ color: '#94a3b8', fontWeight: 500 }}>({c.qtd})</span></span>
                      <span style={{ fontWeight: 800, color: COR[c.categoria] || '#475569' }}>{brl(c.total)} · {pct.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: 7, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: COR[c.categoria] || '#475569' }} />
                    </div>
                  </div>
                );
              })}
              {saidas.some(c => c.categoria === 'nao_classificado') && (
                <div style={{ fontSize: 11.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 11px', marginTop: 10, lineHeight: 1.5 }}>
                  As saídas sem classificação ficam visíveis de propósito: é aí que aparece o gasto novo que nenhuma regra previu.
                </div>
              )}
            </div>
          )}

          {/* Resultado por conta */}
          {!!dados.por_banco?.length && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px', marginBottom: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 900, color: '#111', marginBottom: 10 }}>Por conta</div>
              {/* Cada conta com o PRÓPRIO selo. Isolar os bancos só serve se a tela mostrar o
                  isolamento: uma conta furada não contamina mais a leitura das outras, e o motivo
                  fica ao lado do número que ele afeta — não numa faixa genérica no topo. */}
              {dados.por_banco.map(b => (
                <div key={b.banco} style={{ padding: '9px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, color: '#334155', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                      {b.banco}
                      <span style={{ fontSize: 10.5, fontWeight: 800, padding: '2px 8px', borderRadius: 20,
                        background: b.completo === false ? '#fef2f2' : '#f0fdf4',
                        color: b.completo === false ? '#b91c1c' : '#15803d',
                        border: `1px solid ${b.completo === false ? '#fecaca' : '#bbf7d0'}` }}>
                        {b.completo === false ? 'incompleto' : 'íntegro'}
                      </span>
                    </span>
                    <span style={{ color: '#64748b' }}>
                      <span style={{ color: '#059669' }}>+{brl(b.entradas)}</span>{'  '}
                      <span style={{ color: '#dc2626' }}>−{brl(b.saidas)}</span>{'  '}
                      <strong style={{ color: b.resultado >= 0 ? '#059669' : '#dc2626' }}>= {brl(b.resultado)}</strong>
                    </span>
                  </div>
                  {b.completo === false && !!b.motivos?.length && (
                    <div style={{ marginTop: 5, fontSize: 11.5, color: '#b45309', lineHeight: 1.5 }}>
                      {b.motivos.map((m, i) => <div key={i}>• {m}</div>)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Extrato */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#111', marginBottom: 10 }}>Extrato {banco === 'todos' ? 'unificado' : `· ${banco}`} <span style={{ color: '#94a3b8', fontWeight: 500, fontSize: 12 }}>({lancs.length})</span></div>
            {!lancs.length && <div style={{ fontSize: 13, color: '#94a3b8', padding: '12px 0' }}>Nenhum lançamento no período.</div>}
            {lancs.map(l => (
              <div key={`${l.banco}-${l.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                {l.direcao === 'entrada' ? <ArrowDownLeft size={15} color="#059669" /> : <ArrowUpRight size={15} color="#dc2626" />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.descricao}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>
                    {l.data ? new Date(`${l.data}T12:00:00`).toLocaleDateString('pt-BR') : '—'} · {l.banco}
                    <span style={{ marginLeft: 6, background: '#f1f5f9', color: COR[l.categoria] || '#475569', borderRadius: 5, padding: '1px 6px', fontWeight: 700 }}>{ROTULO[l.categoria] || l.categoria}</span>
                  </div>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: l.direcao === 'entrada' ? '#059669' : '#dc2626' }}>
                    {l.direcao === 'entrada' ? '+' : '−'} {brl(l.liquido ?? l.bruto)}
                  </div>
                  {l.taxa > 0 && <div style={{ fontSize: 10.5, color: '#94a3b8' }}>taxa {brl(l.taxa)}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
