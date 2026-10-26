// Evolução mensal de imóveis e veículos em leilão (admin, 26/10).
// Duas linhas por série, de propósito: "Total" mede a NOSSA cobertura (cresce quando conectamos leiloeiro);
// "Mesmos leiloeiros" é o painel fixo — só ele mede o mercado. Mês futuro = leilão já agendado (ainda cresce).
import React, { useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

const COR_TOTAL = '#93c5fd';
const COR_PAINEL = '#0D63DB';
const NOME_MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (m) => `${NOME_MES[Number(m.slice(5, 7)) - 1]}/${m.slice(2, 4)}`;
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('pt-BR'));

const METRICAS = {
  leiloes: { rotulo: 'Leilões no mês', total: 'leiloes', painel: 'leiloes_painel', ajuda: 'Lotes com a 1ª data de leilão no mês. Mês à frente = já agendado (ainda vai crescer).' },
  estoque: { rotulo: 'Estoque médio', total: 'estoque', painel: 'estoque_painel', ajuda: 'Média diária de lotes ativos no acervo durante o mês.' },
};

function variacao(atual, anterior) {
  if (!anterior || atual == null) return null;
  return Math.round(((atual - anterior) / anterior) * 100);
}

function Grafico({ linhas, metrica, mesAtual }) {
  const m = METRICAS[metrica];
  const pontos = linhas.filter((l) => l[m.total] != null);
  if (!pontos.length) {
    return <div style={{ fontSize: 12, color: '#64748b', padding: '18px 0' }}>Sem dado desta medida ainda — a foto diária começa a acumular a partir de hoje.</div>;
  }
  const max = Math.max(...pontos.map((l) => l[m.total] || 0), 1);
  const L = 560, A = 170, base = A - 22, larg = L / pontos.length;
  const barra = Math.min(34, larg * 0.36);
  return (
    <svg viewBox={`0 0 ${L} ${A}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={m.rotulo}>
      {pontos.map((l, i) => {
        const x = i * larg + larg / 2;
        const hT = ((l[m.total] || 0) / max) * (base - 16);
        const hP = ((l[m.painel] || 0) / max) * (base - 16);
        const futuro = l.mes > mesAtual;
        return (
          <g key={l.mes} opacity={futuro ? 0.45 : 1}>
            <rect x={x - barra - 1} y={base - hT} width={barra} height={hT} fill={COR_TOTAL} rx="3">
              <title>{`${rotuloMes(l.mes)} · total ${fmt(l[m.total])}`}</title>
            </rect>
            <rect x={x + 1} y={base - hP} width={barra} height={hP} fill={COR_PAINEL} rx="3">
              <title>{`${rotuloMes(l.mes)} · mesmos leiloeiros ${fmt(l[m.painel])}`}</title>
            </rect>
            <text x={x} y={A - 6} textAnchor="middle" fontSize="11" fill="#475569">{rotuloMes(l.mes)}{futuro ? '*' : ''}</text>
          </g>
        );
      })}
      <line x1="0" x2={L} y1={base} y2={base} stroke="#e2e8f0" />
    </svg>
  );
}

function Bloco({ titulo, linhas, metrica, mesAtual, painelFontes }) {
  const m = METRICAS[metrica];
  const reais = linhas.filter((l) => l[m.total] != null);
  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#0f172a', minWidth: 0 }}>{titulo} · {m.rotulo}</div>
        <div style={{ fontSize: 11, color: '#64748b' }}>Painel fixo: {painelFontes} leiloeiros</div>
      </div>
      <Grafico linhas={linhas} metrica={metrica} mesAtual={mesAtual} />
      {reais.length > 0 && (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }}>
          <thead>
            <tr style={{ color: '#64748b', textAlign: 'right' }}>
              <th style={{ textAlign: 'left', fontWeight: 600, padding: '4px 0' }}>Mês</th>
              <th style={{ fontWeight: 600 }}>Total</th>
              <th style={{ fontWeight: 600 }}>Mesmos leiloeiros</th>
              <th style={{ fontWeight: 600 }} title="Variação do painel fixo contra o mês anterior — é o sinal de mercado.">Variação (painel)</th>
            </tr>
          </thead>
          <tbody>
            {reais.map((l, i) => {
              const v = i > 0 ? variacao(l[m.painel], reais[i - 1][m.painel]) : null;
              return (
                <tr key={l.mes} style={{ borderTop: '1px solid #f1f5f9', textAlign: 'right', color: l.mes > mesAtual ? '#94a3b8' : '#0f172a' }}>
                  <td style={{ textAlign: 'left', padding: '4px 0' }}>{rotuloMes(l.mes)}{l.mes > mesAtual ? ' (agendado)' : l.mes === mesAtual ? ' (parcial)' : ''}</td>
                  <td>{fmt(l[m.total])}</td>
                  <td>{fmt(l[m.painel])}</td>
                  <td style={{ color: v == null ? '#94a3b8' : v >= 0 ? '#059669' : '#dc2626' }}>{v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function MercadoEvolucao() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [metrica, setMetrica] = useState('leiloes');

  useEffect(() => {
    let vivo = true;
    supabase.rpc('mercado_evolucao_mensal', { p_meses: 12 }).then(({ data, error }) => {
      if (!vivo) return;
      // Erro de leitura NÃO pode virar gráfico vazio (forma 2 do CLAUDE.md).
      if (error) setErro(error.message || 'falha ao ler a série');
      else setDados(data);
    });
    return () => { vivo = false; };
  }, []);

  if (erro) return <div style={{ background: '#fef2f2', color: '#b91c1c', borderRadius: 10, padding: 14, fontSize: 13 }}>Não consegui ler a série de mercado: {erro}</div>;
  if (!dados) return <div style={{ fontSize: 13, color: '#64748b', padding: 14 }}>Carregando a evolução do mercado…</div>;

  const serie = Array.isArray(dados.serie) ? dados.serie : [];
  const porTipo = (t) => serie.filter((l) => l.tipo === t);
  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        {Object.entries(METRICAS).map(([k, m]) => (
          <button key={k} onClick={() => setMetrica(k)}
            style={{ padding: '6px 12px', borderRadius: 16, border: `1px solid ${metrica === k ? COR_PAINEL : '#e2e8f0'}`, background: metrica === k ? COR_PAINEL : 'white', color: metrica === k ? 'white' : '#475569', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            {m.rotulo}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 12, color: '#475569', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 14, lineHeight: 1.5 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, background: COR_TOTAL, borderRadius: 2, marginRight: 4 }} />
        <b>Total</b>: tudo o que captamos — cresce quando conectamos leiloeiro novo, então mede a nossa cobertura.{' '}
        <span style={{ display: 'inline-block', width: 10, height: 10, background: COR_PAINEL, borderRadius: 2, margin: '0 4px 0 6px' }} />
        <b>Mesmos leiloeiros</b>: só quem já estava no acervo no início da série e segue hoje — <b>é este que mostra o mercado</b>.
        {' '}{METRICAS[metrica].ajuda} * = agendado.
      </div>
      <Bloco titulo="Imóveis" linhas={porTipo('imovel')} metrica={metrica} mesAtual={dados.mes_atual} painelFontes={dados.painel_fontes?.imovel ?? '—'} />
      <Bloco titulo="Veículos" linhas={porTipo('veiculo')} metrica={metrica} mesAtual={dados.mes_atual} painelFontes={dados.painel_fontes?.veiculo ?? '—'} />
      <div style={{ fontSize: 11, color: '#94a3b8' }}>
        Série desde {dados.primeiro_mes_completo?.imovel || '—'} (imóveis) e {dados.primeiro_mes_completo?.veiculo || '—'} (veículos): o 1º mês de coleta é parcial e fica de fora.
        Foto diária do estoque: imóveis desde {dados.inicio_foto?.imovel || '—'}, veículos desde {dados.inicio_foto?.veiculo || '—'}.
      </div>
    </div>
  );
}
