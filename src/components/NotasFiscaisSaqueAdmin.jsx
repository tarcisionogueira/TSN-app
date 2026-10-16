// FILA DE NOTAS FISCAIS DE SAQUE (Admin → Financeiro). Nasceu em 16/10, quando a nota passou a
// ser exigida em TODO saque: até então a IA mandava para "revisão manual" toda nota sem
// confirmação da prefeitura e NÃO EXISTIA tela para alguém conferir — a nota ficava parada e o
// saque do parceiro, travado, sem ninguém saber.
//
// Decisões (todas gravam quem, quando e o motivo — api/saque-nf.js, PATCH, só admin):
//   • Aprovar ............. libera o saque daquele valor.
//   • Reprovar ............ o parceiro pode anexar outra (motivo aparece para ele).
//   • Liberar substituição  a nota sai de cena como 'substituida' e o parceiro anexa outra.
// Nada é apagado: a nota é documento contábil. Nota já usada num saque não muda mais.
import React, { useCallback, useEffect, useState } from 'react';
import { apiCall } from '../utils/apiCall';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const cnpj = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : (v || '—');
};
const COR = {
  revisao_manual: ['#a16207', '#fef9c3', 'Em conferência'],
  aprovada: ['#047857', '#d1fae5', 'Aprovada'],
  reprovada: ['#b91c1c', '#fee2e2', 'Reprovada'],
  substituida: ['#475569', '#f1f5f9', 'Substituída'],
};
const VERIF = {
  confirmada: 'Emissão confirmada no verificador da prefeitura',
  inconclusiva: 'Verificador da prefeitura inconclusivo',
  sem_link: 'Nota sem link de verificação da prefeitura',
  nao_checada: 'IA não conseguiu ler a nota',
};

export default function NotasFiscaisSaqueAdmin() {
  const [notas, setNotas] = useState(null);
  const [erro, setErro] = useState('');
  const [filtro, setFiltro] = useState('pendentes');
  const [ocupado, setOcupado] = useState(null);
  const [msg, setMsg] = useState(null);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const r = await apiCall('/api/saque-nf');
      const d = await r.json().catch(() => ({}));
      // Leitura que falhou não é fila vazia — dizer "nenhuma nota pendente" esconderia saque travado.
      if (!r.ok) { setErro(d.error || `Não consegui carregar as notas (HTTP ${r.status}).`); return; }
      setNotas(Array.isArray(d.notas) ? d.notas : []);
    } catch (e) {
      setErro(e?.message || 'Falha ao carregar as notas.');
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function decidir(nota, acao) {
    let motivo = '';
    if (acao !== 'aprovar') {
      motivo = window.prompt(acao === 'reprovar'
        ? 'Motivo da reprovação (o parceiro vai ler):'
        : 'Motivo da substituição (o parceiro vai ler):') || '';
      if (!motivo.trim()) return;
    } else if (!window.confirm(`Aprovar a nota de ${fmt(nota.valor_nf)} de ${nota.parceiro?.nome || 'parceiro'}? Isso libera o saque desse valor.`)) {
      return;
    }
    setOcupado(nota.id); setMsg(null);
    try {
      const r = await apiCall('/api/saque-nf', { method: 'PATCH', body: JSON.stringify({ id: nota.id, acao, motivo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ tipo: 'erro', txt: d.error || 'Não consegui gravar a decisão.' });
      else setMsg({ tipo: 'ok', txt: acao === 'aprovar' ? 'Nota aprovada — o saque desse valor está liberado.' : acao === 'reprovar' ? 'Nota reprovada.' : 'Substituição liberada — o parceiro já pode anexar outra nota.' });
    } catch (e) {
      setMsg({ tipo: 'erro', txt: e?.message || 'Falha ao gravar.' });
    } finally {
      setOcupado(null);
      carregar();
    }
  }

  const lista = (notas || []).filter((n) =>
    filtro === 'pendentes' ? (n.status === 'revisao_manual' && !n.lancamento_id) : true);
  const pendentes = (notas || []).filter((n) => n.status === 'revisao_manual' && !n.lancamento_id).length;

  const btn = (cor) => ({ padding: '6px 12px', border: 'none', borderRadius: 7, background: cor, color: 'white', fontWeight: 700, fontSize: 12, cursor: 'pointer' });

  return (
    <div>
      <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#9a3412', lineHeight: 1.55, marginBottom: 14 }}>
        Todo saque exige nota fiscal da empresa do beneficiário contra a BidPro, no <strong>valor bruto exato do saque</strong>.
        A IA lê cada nota; só aprova sozinha quando a prefeitura confirma a emissão. O resto cai aqui. A nota nunca é apagada:
        reprovar ou liberar a substituição deixa o parceiro anexar outra, e a anterior fica no histórico.
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        {[['pendentes', `Para conferir (${pendentes})`], ['todas', 'Todas']].map(([k, l]) => (
          <button key={k} onClick={() => setFiltro(k)}
            style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: filtro === k ? '#0D63DB' : 'white', color: filtro === k ? 'white' : '#334155', fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>{l}</button>
        ))}
        <button onClick={carregar} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', color: '#334155', fontSize: 12.5, cursor: 'pointer' }}>Atualizar</button>
      </div>

      {erro && <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 8, padding: '9px 12px', fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{erro}</div>}
      {msg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 700, color: msg.tipo === 'ok' ? '#047857' : '#b91c1c' }}>{msg.txt}</div>}
      {notas === null && !erro && <div style={{ color: '#64748b', fontSize: 13 }}>Carregando…</div>}
      {notas && !lista.length && <div style={{ color: '#64748b', fontSize: 13 }}>{filtro === 'pendentes' ? 'Nenhuma nota esperando conferência.' : 'Nenhuma nota enviada ainda.'}</div>}

      <div style={{ display: 'grid', gap: 10 }}>
        {lista.map((n) => {
          const [cor, fundo, rot] = COR[n.status] || ['#334155', '#f1f5f9', n.status];
          const usada = !!n.lancamento_id;
          const ia = n.ia_veredito || {};
          const valorDifere = n.valor_nf != null && Math.abs(Number(n.valor_nf) - Number(n.valor_pedido)) > 0.01;
          return (
            <div key={n.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 99, color: cor, background: fundo }}>{usada ? 'Usada em saque' : rot}</span>
                <strong style={{ fontSize: 13.5, color: '#0f172a' }}>{n.parceiro?.nome || n.user_id}</strong>
                <span style={{ fontSize: 12, color: '#64748b' }}>{n.parceiro?.razao_social || ''} · CNPJ cadastrado {cnpj(n.parceiro?.cnpj)}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: '#94a3b8' }}>{new Date(n.criado_em).toLocaleString('pt-BR')}</span>
              </div>
              <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 6, fontSize: 12, color: '#334155' }}>
                <div>Saque pedido: <strong>{fmt(n.valor_pedido)}</strong></div>
                <div style={{ color: valorDifere ? '#b91c1c' : undefined }}>Valor da nota: <strong>{fmt(n.valor_nf)}</strong>{valorDifere ? ' (difere)' : ''}</div>
                <div>Nº {n.numero || '—'} · emitida {n.emitida_em ? new Date(`${n.emitida_em}T12:00:00`).toLocaleDateString('pt-BR') : '—'}</div>
                <div>Emitente: {cnpj(n.emitente_cnpj)}{ia.emitente_nome ? ` (${ia.emitente_nome})` : ''}</div>
                <div>Tomador: {cnpj(n.tomador_cnpj)}{ia.tomador_nome ? ` (${ia.tomador_nome})` : ''}</div>
                <div>{VERIF[n.verificacao_status] || n.verificacao_status || '—'}
                  {n.verificacao_url && <> · <a href={n.verificacao_url} target="_blank" rel="noreferrer" style={{ color: '#0D63DB', fontWeight: 700 }}>abrir verificador</a></>}
                </div>
              </div>
              {n.motivo && <div style={{ marginTop: 6, fontSize: 12, color: '#475569', lineHeight: 1.5 }}>{n.motivo}</div>}
              <div style={{ marginTop: 9, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {n.arquivo_url
                  ? <a href={n.arquivo_url} target="_blank" rel="noreferrer" style={{ padding: '6px 12px', borderRadius: 7, border: '1px solid #cbd5e1', color: '#0D63DB', fontWeight: 700, fontSize: 12, textDecoration: 'none' }}>📄 Abrir nota</a>
                  : <span style={{ fontSize: 12, color: '#b45309' }}>Não consegui gerar o link do arquivo.</span>}
                {!usada && n.status === 'revisao_manual' && (
                  <button disabled={ocupado === n.id} onClick={() => decidir(n, 'aprovar')} style={btn('#059669')}>Aprovar</button>
                )}
                {!usada && (n.status === 'revisao_manual' || n.status === 'aprovada') && (
                  <button disabled={ocupado === n.id} onClick={() => decidir(n, 'reprovar')} style={btn('#dc2626')}>Reprovar</button>
                )}
                {!usada && (n.status === 'revisao_manual' || n.status === 'aprovada') && (
                  <button disabled={ocupado === n.id} onClick={() => decidir(n, 'liberar_substituicao')} style={btn('#475569')}>Liberar substituição</button>
                )}
                {usada && <span style={{ fontSize: 11.5, color: '#64748b' }}>Vinculada ao saque #{n.lancamento_id} — não pode mais ser alterada.</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
