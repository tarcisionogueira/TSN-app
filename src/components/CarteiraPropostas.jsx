import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { fmtBRL } from '../utils/format';
import { lerSessao, gravarSessao, useRolagemDaLista } from '../utils/estadoLista';

// CARTEIRA DE PROPOSTAS (14/10, pedido do dono): os lotes de leiloeiro cujo leilão ENCERROU SEM
// LANCE confirmado e que ainda estão na janela de 15 dias — os únicos em que cabe proposta de
// compra direta ao leiloeiro. Fonte única: `oportunidades_proposta()` (só equipe, ordena por
// interesse dos clientes → desconto → prazo). A Caixa fica de fora: venda online/direta dela é
// compra direta no site, sem leiloeiro para receber proposta.
// Daqui a equipe abre o lote, gera os relatórios (liberados para a equipe em lote encerrado sem
// lance — liberaEquipePosLeilao) e vai à página do leiloeiro. "Gerar relatórios" abre a análise com
// `autoGerar`: mercadológico e documental saem em sequência, sem outro clique (mesma máquina da proposta).

const TIPO = { casa: 'Casa', apartamento: 'Apto', terreno: 'Terreno', comercial: 'Comercial', rural: 'Rural', galpao: 'Galpão', imovel: 'Imóvel' };

const corPrazo = (d) => (d == null ? '#64748b' : d <= 3 ? '#dc2626' : d <= 7 ? '#d97706' : '#059669');

export default function CarteiraPropostas() {
  const nav = useNavigate();
  const [linhas, setLinhas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  // Voltar do lote para a carteira no MESMO lugar (15/10, dono): filtros por aba em sessionStorage e a
  // rolagem devolvida ao voltar (mesmo mecanismo da Busca — utils/estadoLista.js).
  const salvo = lerSessao('carteira_filtros', {}) || {};
  const [uf, setUf] = useState(salvo.uf || '');
  const [fonte, setFonte] = useState(salvo.fonte || '');
  const [busca, setBusca] = useState(salvo.busca || '');
  const [soInteresse, setSoInteresse] = useState(!!salvo.soInteresse);
  useEffect(() => { gravarSessao('carteira_filtros', { uf, fonte, busca, soInteresse }); }, [uf, fonte, busca, soInteresse]);
  useRolagemDaLista('carteira_propostas', !carregando);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    // `error` checado: lista vazia e lista ilegível pedem ações opostas (forma nº 2 do CLAUDE.md).
    const { data, error } = await supabase.rpc('oportunidades_proposta', { p_limite: 1000, p_estado: null });
    if (error) { console.error('[CarteiraPropostas]', error.message); setErro(error.message); setLinhas([]); }
    else setLinhas(data || []);
    setCarregando(false);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const ufs = useMemo(() => [...new Set(linhas.map(l => l.estado).filter(Boolean))].sort(), [linhas]);
  const fontes = useMemo(() => [...new Set(linhas.map(l => l.fonte).filter(Boolean))].sort(), [linhas]);

  const filtradas = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return linhas.filter(l => (!uf || l.estado === uf)
      && (!fonte || l.fonte === fonte)
      && (!soInteresse || (l.relatorios || 0) + (l.favoritos || 0) > 0)
      && (!t || `${l.titulo || ''} ${l.cidade || ''}`.toLowerCase().includes(t)));
  }, [linhas, uf, fonte, busca, soInteresse]);

  const kpis = useMemo(() => ({
    total: filtradas.length,
    interesse: filtradas.filter(l => (l.relatorios || 0) + (l.favoritos || 0) > 0).length,
    vencendo: filtradas.filter(l => l.dias_restantes != null && l.dias_restantes <= 3).length,
  }), [filtradas]);

  const sel = { padding: '7px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, background: 'white' };
  const btn = (bg, fg, bd) => ({ padding: '5px 10px', borderRadius: 7, background: bg, color: fg, border: `1px solid ${bd}`, fontSize: 11, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', textDecoration: 'none' });

  return (
    <div style={{ maxWidth: 1100, width: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontWeight: 900, fontSize: 18, color: '#111111' }}>🎯 Carteira de propostas</div>
        <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
          Lotes de leiloeiro cujo leilão <strong>encerrou sem lance</strong> (apurado na página do leiloeiro) e que seguem na
          vitrine por 15 dias — candidatos a proposta de compra direta. Ordem: interesse dos clientes (relatórios e favoritos),
          depois desconto e prazo. A Caixa não entra (venda direta é comprada no próprio site).
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
        {[
          { l: 'Lotes sem lance', v: kpis.total, c: '#0D63DB' },
          { l: 'Com interesse de cliente', v: kpis.interesse, c: '#6d28d9' },
          { l: 'Saem da vitrine em ≤ 3 dias', v: kpis.vencendo, c: kpis.vencendo ? '#dc2626' : '#059669' },
        ].map(k => (
          <div key={k.l} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: k.c }}>{k.v.toLocaleString('pt-BR')}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>{k.l}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar título ou cidade" style={{ ...sel, flex: '1 1 200px' }} />
        <select value={uf} onChange={e => setUf(e.target.value)} style={sel}>
          <option value="">Todas as UFs</option>{ufs.map(u => <option key={u} value={u}>{u}</option>)}
        </select>
        <select value={fonte} onChange={e => setFonte(e.target.value)} style={sel}>
          <option value="">Todos os leiloeiros</option>{fontes.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <label style={{ fontSize: 12, color: '#334155', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
          <input type="checkbox" checked={soInteresse} onChange={e => setSoInteresse(e.target.checked)} /> Só com interesse
        </label>
        <button onClick={carregar} style={btn('white', '#0D63DB', '#bfdbfe')}>↻ Atualizar</button>
      </div>

      {erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 10, padding: 12, fontSize: 12.5 }}>
          Não consegui ler a carteira ({erro}). Isto não é "lista vazia" — tente atualizar.
        </div>
      )}
      {carregando ? (
        <div style={{ fontSize: 13, color: '#64748b' }}>Carregando…</div>
      ) : !erro && !filtradas.length ? (
        <div style={{ fontSize: 13, color: '#64748b' }}>Nenhum lote sem lance com esses filtros.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtradas.map(l => (
            <div key={l.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 12px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 320px', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 3 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, background: '#f3e8ff', color: '#6d28d9', padding: '1px 6px', borderRadius: 8 }}>Sem lance</span>
                  {l.tipo && <span style={{ fontSize: 9, fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: 8 }}>{TIPO[l.tipo] || l.tipo}</span>}
                  <span style={{ fontSize: 9, fontWeight: 700, background: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: 8 }}>{l.fonte}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, color: '#111111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={l.titulo}>{l.titulo || 'Imóvel'}</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{[l.cidade, l.estado].filter(Boolean).join(' / ') || '—'}</div>
              </div>
              <div style={{ flex: '0 0 auto', textAlign: 'right', minWidth: 130 }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#111111' }}>{l.valor_minimo ? fmtBRL(l.valor_minimo) : '—'}</div>
                <div style={{ fontSize: 10, color: '#64748b' }}>
                  {l.valor_avaliacao ? `aval. ${fmtBRL(l.valor_avaliacao)}` : 'sem avaliação'}
                  {l.desconto_percentual > 0 ? ` · −${l.desconto_percentual}%` : ''}
                </div>
              </div>
              <div style={{ flex: '0 0 auto', textAlign: 'center', minWidth: 90 }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: corPrazo(l.dias_restantes) }}>
                  {l.dias_restantes == null ? '—' : l.dias_restantes <= 0 ? 'último dia' : `${l.dias_restantes} dia${l.dias_restantes === 1 ? '' : 's'}`}
                </div>
                <div style={{ fontSize: 10, color: '#64748b' }}>leilão {l.ultima_praca ? l.ultima_praca.split('-').reverse().join('/') : '—'}</div>
              </div>
              <div style={{ flex: '0 0 auto', textAlign: 'center', minWidth: 70 }} title="Relatórios gerados · favoritos">
                <div style={{ fontSize: 12, fontWeight: 800, color: (l.relatorios || l.favoritos) ? '#6d28d9' : '#94a3b8' }}>📄 {l.relatorios || 0} · ★ {l.favoritos || 0}</div>
                <div style={{ fontSize: 10, color: '#64748b' }}>interesse</div>
              </div>
              <div style={{ flex: '0 0 auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button onClick={() => nav(`/imovel/${l.id}`)} style={btn('white', '#334155', '#e2e8f0')}>Abrir</button>
                <button onClick={() => nav(`/analise?imovel=${encodeURIComponent(l.id)}`, { state: { autoGerar: true } })} style={btn('#0D63DB', 'white', '#0D63DB')}>Gerar relatórios</button>
                {l.url_lote && <a href={l.url_lote} target="_blank" rel="noopener noreferrer" style={btn('#111111', 'white', '#111111')}>Leiloeiro ↗</a>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
