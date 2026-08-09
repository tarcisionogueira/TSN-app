import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Download, Mail, RefreshCw, Check, AlertTriangle, FileText } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { supabase } from '../utils/supabase';

/**
 * CONCILIAÇÃO BANCÁRIA — classificar o extrato pelo plano de contas e entregar à contabilidade.
 *
 * O fluxo da tela é o mesmo do fechamento contábil, nesta ordem:
 *   1. Importar o extrato da competência (persiste; reimportar não duplica).
 *   2. Ver o que caiu em 9.9 A CLASSIFICAR — é a fila de trabalho real.
 *   3. Corrigir a conta e conciliar. Ao corrigir, dá para transformar aquilo em REGRA: o
 *      lançamento igual do mês que vem já chega classificado.
 *   4. Exportar (PDF/OFX) ou enviar por e-mail à contabilidade, que fecha a DRE.
 *
 * A tela insiste no número de pendentes porque é ele que decide se a DRE fecha certa. Um extrato
 * "conciliado" com 40 lançamentos em A CLASSIFICAR não é um fechamento, é uma lista.
 */

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const mesAtual = () => new Date().toISOString().slice(0, 7);

export default function ConciliacaoBancaria() {
  const [de, setDe] = useState(mesAtual());
  const [ate, setAte] = useState(mesAtual());
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState('');
  const [msg, setMsg] = useState(null);
  const [soPendentes, setSoPendentes] = useState(false);
  const [emailContab, setEmailContab] = useState('');
  const [bancoOfx, setBancoOfx] = useState('Bradesco');
  const [ofxErros, setOfxErros] = useState([]);

  const carregar = useCallback(async () => {
    setCarregando(true); setMsg(null);
    try {
      const r = await apiCall(`/api/conciliacao?acao=listar&de=${de}&ate=${ate}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: 'erro', txt: d?.error || 'Não consegui carregar a conciliação.' }); setDados(null); }
      else setDados(d);
    } catch { setMsg({ tipo: 'erro', txt: 'Falha de conexão.' }); setDados(null); }
    setCarregando(false);
  }, [de, ate]);

  useEffect(() => { carregar(); }, [carregar]);

  async function acao(nome, corpo, rotulo) {
    setOcupado(nome); setMsg(null);
    try {
      const r = await apiCall('/api/conciliacao', { method: 'POST', body: JSON.stringify({ acao: nome, de, ate, ...corpo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ tipo: 'erro', txt: d?.error || `Falha em ${rotulo}.` });
      else { setMsg({ tipo: 'ok', txt: d.mensagem || `${rotulo} concluído.` }); await carregar(); }
    } catch { setMsg({ tipo: 'erro', txt: `Falha de conexão em ${rotulo}.` }); }
    setOcupado('');
  }

  // Sobe o OFX em base64. O arquivo é texto, mas vem em ISO-8859-1 com frequência — mandar
  // como string deixaria o navegador "consertar" o acento e o servidor receberia lixo. Em
  // base64 os bytes chegam intactos e quem decide o encoding é o leitor, lendo o cabeçalho.
  async function enviarOfx(file) {
    if (!file) return;
    setOcupado('importar_ofx'); setMsg(null); setOfxErros([]);
    try {
      const b64 = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
        fr.onerror = reject;
        fr.readAsDataURL(file);
      });
      const r = await apiCall('/api/conciliacao', {
        method: 'POST',
        body: JSON.stringify({ acao: 'importar_ofx', arquivo: b64, banco: bancoOfx, de, ate }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg({ tipo: 'erro', txt: d?.error || 'Não consegui importar o OFX.' }); setOfxErros(d?.erros || []); }
      else { setMsg({ tipo: 'ok', txt: d.mensagem || 'Extrato importado.' }); setOfxErros(d.erros || []); await carregar(); }
    } catch { setMsg({ tipo: 'erro', txt: 'Falha ao ler o arquivo.' }); }
    setOcupado('');
  }

  // Download com o token da sessão: a rota é admin-only, então não dá para abrir por <a href>.
  async function baixar(tipo) {
    setOcupado(tipo);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`/api/conciliacao?acao=${tipo}&de=${de}&ate=${ate}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (!r.ok) { setMsg({ tipo: 'erro', txt: 'Não consegui gerar o arquivo.' }); setOcupado(''); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = tipo === 'ofx' ? `conciliacao-${de}-a-${ate}.ofx` : `conciliacao-${de}-a-${ate}.html`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      setMsg({ tipo: 'ok', txt: tipo === 'ofx' ? 'OFX baixado.' : 'Relatório baixado — abra e use "Imprimir → Salvar como PDF".' });
    } catch { setMsg({ tipo: 'erro', txt: 'Falha ao baixar.' }); }
    setOcupado('');
  }

  const lancs = (dados?.lancamentos || []).filter(l => !soPendentes || l.conta === '9.9' || l.classificado_por === 'pendente');
  const contas = dados?.plano_contas || [];
  const r = dados?.resumo || {};

  const btn = (cor) => ({ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 13px', borderRadius: 9, border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700, background: cor, color: '#fff' });

  return (
    <div>
      {/* Competência + ações */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
        <input type="month" value={de} onChange={e => setDe(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }} />
        <span style={{ color: '#94a3b8', fontSize: 13 }}>até</span>
        <input type="month" value={ate} onChange={e => setAte(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }} />
        <button onClick={() => acao('importar', { dias: 180 }, 'Importação')} disabled={!!ocupado} style={btn('#0D63DB')}>
          {ocupado === 'importar' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={14} />} Atualizar agora
        </button>
        <button onClick={() => acao('classificar', {}, 'Reclassificação')} disabled={!!ocupado} style={{ ...btn('#fff'), color: '#334155', border: '1px solid #cbd5e1' }}>
          <FileText size={14} /> Reclassificar
        </button>
        {/* FECHAR A COMPETÊNCIA — o mês entregue à contabilidade para de aceitar lançamento
            novo. Sem isso, uma reimportação ou um extrato atrasado muda a DRE de um mês já
            assinado, e o contador perde a confiança no número. Reabrir é possível, exige
            motivo e fica registrado: a trava serve para tornar a mudança consciente. */}
        <button
          onClick={() => {
            if (!window.confirm(`Fechar a competência ${de}?\n\nDepois disso, nenhum lançamento entra, muda ou sai desse mês — é o que garante que a DRE entregue à contabilidade não mude depois. Dá para reabrir informando o motivo.`)) return;
            acao('fechar_competencia', { competencia: de }, 'Fechamento');
          }}
          disabled={!!ocupado}
          style={{ ...btn('#fff'), color: '#92400e', border: '1px solid #fcd34d' }}>
          <Check size={14} /> Fechar {de}
        </button>
        <button
          onClick={() => {
            const motivo = window.prompt(`Reabrir a competência ${de}?\n\nInforme o motivo — ele fica registrado com o seu nome e a data:`);
            if (motivo === null) return;
            if (!motivo.trim()) { setMsg({ tipo: 'erro', txt: 'A reabertura exige um motivo.' }); return; }
            acao('reabrir_competencia', { competencia: de, motivo: motivo.trim() }, 'Reabertura');
          }}
          disabled={!!ocupado}
          style={{ ...btn('#fff'), color: '#64748b', border: '1px solid #e2e8f0' }}>
          Reabrir
        </button>
      </div>

      <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 12, lineHeight: 1.55 }}>
        O extrato das contas conectadas entra <strong>sozinho todo dia</strong> (janela de 45 dias, para pegar estorno e recebimento retroativo). O botão acima é só para ver o movimento de hoje sem esperar.
      </div>

      {/* ── EXTRATO DE BANCO POR ARQUIVO (OFX) ──────────────────────────────────────────
          Mercado Pago, Asaas e Inter entram por API. Bradesco, C6 e Caixa não têm caminho
          automático viável hoje — mas todos exportam OFX no internet banking. O arquivo
          entra aqui e segue o MESMO fluxo: mesma tabela, mesma classificação, mesma DRE.
          Reimportar não duplica (a chave é conta + identificador do lançamento). */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '13px 15px', marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, fontWeight: 800, color: '#334155', marginBottom: 6 }}>Extrato de banco por arquivo (OFX)</div>
        <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10, lineHeight: 1.55 }}>
          Para Bradesco, C6, Caixa e qualquer conta sem integração. No internet banking, exporte o extrato no formato <strong>OFX</strong> (às vezes aparece como “Money”, “Dinheiro” ou “OFX/QIF”). Reimportar o mesmo arquivo <strong>não duplica</strong> lançamento.
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={bancoOfx} onChange={e => setBancoOfx(e.target.value)}
            style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13 }}>
            {['Bradesco', 'C6 Bank', 'Caixa', 'Banco Inter', 'Outro banco'].map(b => <option key={b} value={b}>{b}</option>)}
          </select>
          <label style={{ ...btn(ocupado === 'importar_ofx' ? '#94a3b8' : '#059669'), cursor: ocupado ? 'default' : 'pointer' }}>
            {ocupado === 'importar_ofx'
              ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Lendo o arquivo…</>
              : <><Download size={14} style={{ transform: 'rotate(180deg)' }} /> Enviar arquivo OFX</>}
            <input type="file" accept=".ofx,.OFX,text/plain,application/x-ofx" style={{ display: 'none' }}
              disabled={!!ocupado} onChange={e => enviarOfx(e.target.files?.[0])} />
          </label>
        </div>
        {ofxErros.length > 0 && (
          <div style={{ marginTop: 9, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, color: '#92400e', lineHeight: 1.6 }}>
            <strong>Linhas ignoradas nesta importação:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>{ofxErros.slice(0, 8).map((e, i) => <li key={i}>{e}</li>)}</ul>
          </div>
        )}
      </div>

      {msg && (
        <div style={{ background: msg.tipo === 'erro' ? '#fef2f2' : '#f0fdf4', border: `1px solid ${msg.tipo === 'erro' ? '#fecaca' : '#bbf7d0'}`, color: msg.tipo === 'erro' ? '#dc2626' : '#166534', borderRadius: 9, padding: '9px 13px', fontSize: 12.5, marginBottom: 12 }}>{msg.txt}</div>
      )}

      {carregando && <div style={{ padding: 30, textAlign: 'center', color: '#64748b' }}><Loader2 size={19} style={{ animation: 'spin 1s linear infinite' }} /></div>}

      {!carregando && dados && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
            {[['Entradas', brl(r.entradas), '#059669'], ['Saídas', brl(r.saidas), '#dc2626'],
              ['Resultado', brl((r.entradas || 0) - (r.saidas || 0)), (r.entradas || 0) >= (r.saidas || 0) ? '#059669' : '#dc2626'],
              ['Conciliados', `${r.conciliados || 0} de ${r.total || 0}`, '#475569'],
              ['A classificar', String(r.pendentes || 0), (r.pendentes || 0) > 0 ? '#b45309' : '#059669']].map(([rot, val, cor]) => (
              <div key={rot} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '12px 15px', flex: 1, minWidth: 130 }}>
                <div style={{ fontSize: 10.5, color: '#64748b', fontWeight: 700, textTransform: 'uppercase' }}>{rot}</div>
                <div style={{ fontSize: 17, fontWeight: 900, color: cor, marginTop: 3 }}>{val}</div>
              </div>
            ))}
          </div>

          {(r.pendentes || 0) > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 13px', fontSize: 12.5, color: '#92400e', marginBottom: 14, lineHeight: 1.55 }}>
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
              <span><strong>{r.pendentes} lançamento(s) em 9.9 A CLASSIFICAR.</strong> A DRE não fecha certa enquanto eles não tiverem conta — classifique antes de enviar à contabilidade.</span>
            </div>
          )}

          {/* Exportação */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 13.5, fontWeight: 900, color: '#111', marginBottom: 10 }}>Entregar à contabilidade</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => baixar('html')} disabled={!!ocupado} style={{ ...btn('#fff'), color: '#334155', border: '1px solid #cbd5e1' }}><Download size={14} /> Relatório (PDF)</button>
              <button onClick={() => baixar('ofx')} disabled={!!ocupado} style={{ ...btn('#fff'), color: '#334155', border: '1px solid #cbd5e1' }}><Download size={14} /> Extrato (OFX)</button>
              <input value={emailContab} onChange={e => setEmailContab(e.target.value)} placeholder="e-mail da contabilidade"
                style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, minWidth: 220 }} />
              <button onClick={() => acao('enviar', { email: emailContab }, 'Envio')} disabled={!!ocupado} style={btn('#059669')}>
                {ocupado === 'enviar' ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Mail size={14} />} Enviar
              </button>
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 8, lineHeight: 1.55 }}>
              O relatório abre no navegador — use <strong>Imprimir → Salvar como PDF</strong>. O OFX vai anexado no e-mail e importa direto no sistema contábil.
            </div>
          </div>

          {/* DRE */}
          {!!dados.dre?.length && (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px', marginBottom: 16 }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#111', marginBottom: 8 }}>Demonstrativo por conta</div>
              {dados.dre.map(l => (
                <div key={l.conta} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12.5 }}>
                  <span style={{ color: '#334155' }}><strong style={{ color: '#94a3b8', fontWeight: 700 }}>{l.conta}</strong> {l.nome} <span style={{ color: '#94a3b8' }}>({l.qtd})</span></span>
                  <strong style={{ color: l.natureza === 'receita' ? '#059669' : '#dc2626' }}>{brl(l.total)}</strong>
                </div>
              ))}
            </div>
          )}

          {/* Lançamentos */}
          <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
              <div style={{ fontSize: 13.5, fontWeight: 900, color: '#111' }}>Lançamentos ({lancs.length})</div>
              <label style={{ fontSize: 12, color: '#475569', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={soPendentes} onChange={e => setSoPendentes(e.target.checked)} /> só os que faltam classificar
              </label>
            </div>
            {!lancs.length && <div style={{ fontSize: 13, color: '#94a3b8', padding: '10px 0' }}>Nada aqui. Importe o extrato da competência para começar.</div>}
            {lancs.map(l => (
              <LinhaLancamento key={l.id} l={l} contas={contas} onFeito={carregar} />
            ))}
          </div>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function LinhaLancamento({ l, contas, onFeito }) {
  const [conta, setConta] = useState(l.conta || '9.9');
  const [virarRegra, setVirarRegra] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [compondo, setCompondo] = useState(false);
  const pendente = l.conta === '9.9' || l.classificado_por === 'pendente';

  async function conciliar() {
    setSalvando(true);
    try {
      await apiCall('/api/conciliacao', {
        method: 'POST',
        body: JSON.stringify({ acao: 'conciliar', id: l.id, conta, virar_regra: virarRegra }),
      });
      onFeito?.();
    } catch { /* a tela recarrega e mostra o estado real */ }
    setSalvando(false);
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f1f5f9', flexWrap: 'wrap',
      background: pendente ? '#fffbeb' : 'transparent' }}>
      <div style={{ flex: 1, minWidth: 180 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.descricao || '(sem histórico)'}</div>
        <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
          {String(l.data || '').split('-').reverse().join('/')} · {l.banco} · {l.classificado_por}
          {l.conciliado && <span style={{ color: '#059669', fontWeight: 700 }}> · conciliado ✓</span>}
        </div>
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: l.direcao === 'saida' ? '#dc2626' : '#059669', minWidth: 110, textAlign: 'right' }}>
        {l.direcao === 'saida' ? '−' : '+'} {brl(l.valor_liquido ?? l.valor_bruto)}
      </div>
      <select value={conta} onChange={e => setConta(e.target.value)}
        style={{ padding: '5px 8px', borderRadius: 7, border: `1px solid ${pendente ? '#fbbf24' : '#cbd5e1'}`, fontSize: 11.5, maxWidth: 240 }}>
        {contas.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nome}</option>)}
      </select>
      <label style={{ fontSize: 10.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }} title="Cria uma regra a partir deste histórico — o próximo lançamento igual já vem classificado">
        <input type="checkbox" checked={virarRegra} onChange={e => setVirarRegra(e.target.checked)} /> virar regra
      </label>
      {/* COMPOR: quando a linha do banco é, contabilmente, mais de uma coisa. */}
      <button onClick={() => setCompondo(v => !v)} title="Dividir este lançamento em partes com contas diferentes"
        style={{ padding: '6px 10px', borderRadius: 8, border: `1px solid ${l.rateado ? '#7c3aed' : '#cbd5e1'}`, background: l.rateado ? '#f5f3ff' : '#fff', color: l.rateado ? '#7c3aed' : '#475569', cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>
        {l.rateado ? 'Composto ✓' : 'Compor'}
      </button>
      <button onClick={conciliar} disabled={salvando}
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 11px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 11.5, fontWeight: 800, background: l.conciliado ? '#f1f5f9' : '#059669', color: l.conciliado ? '#475569' : '#fff' }}>
        {salvando ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={12} />} {l.conciliado ? 'Reconciliar' : 'Conciliar'}
      </button>
      {compondo && <PainelRateio l={l} contas={contas} onFeito={() => { setCompondo(false); onFeito?.(); }} />}
    </div>
  );
}

/**
 * COMPOSIÇÃO DE UM LANÇAMENTO — o caso do acordo com dedução.
 * Um pagamento de R$ 1.000 em que R$ 200 foram dedução de uma despesa já paga é UMA linha no
 * banco e DUAS na contabilidade. Aqui as partes são digitadas e o servidor confere se somam o
 * valor do lançamento: rateio que não fecha vira erro contábil, então é recusado com a
 * diferença na tela.
 */
function PainelRateio({ l, contas, onFeito }) {
  const valor = Number(l.valor_liquido ?? l.valor_bruto ?? 0);
  const [partes, setPartes] = useState([{ conta: l.conta || '9.9', valor: valor, descricao: '', contraparte: '' }]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const soma = partes.reduce((s, p) => s + (Number(p.valor) || 0), 0);
  const diferenca = Number((valor - soma).toFixed(2));

  const mudar = (i, campo, v) => setPartes(ps => ps.map((p, j) => (j === i ? { ...p, [campo]: v } : p)));

  async function salvar() {
    setSalvando(true); setErro('');
    try {
      const r = await apiCall('/api/conciliacao', {
        method: 'POST',
        body: JSON.stringify({ acao: 'ratear', id: l.id, partes: partes.filter(p => Number(p.valor)) }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setErro(d?.error || 'Não consegui gravar a composição.');
      else onFeito?.();
    } catch { setErro('Falha de conexão.'); }
    setSalvando(false);
  }

  return (
    <div style={{ flexBasis: '100%', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginTop: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 800, color: '#111', marginBottom: 8 }}>
        Compor {brl(valor)} em partes
        <span style={{ fontWeight: 500, color: diferenca === 0 ? '#059669' : '#b45309', marginLeft: 8 }}>
          {diferenca === 0 ? 'fecha ✓' : `faltam ${brl(diferenca)}`}
        </span>
      </div>
      {partes.map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
          <select value={p.conta} onChange={e => mudar(i, 'conta', e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #cbd5e1', fontSize: 11.5, maxWidth: 230 }}>
            {contas.map(c => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.nome}</option>)}
          </select>
          <input type="number" step="0.01" value={p.valor} onChange={e => mudar(i, 'valor', e.target.value)}
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #cbd5e1', fontSize: 11.5, width: 100 }} placeholder="valor" />
          <input value={p.descricao} onChange={e => mudar(i, 'descricao', e.target.value)} placeholder="o que é esta parte"
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #cbd5e1', fontSize: 11.5, flex: 1, minWidth: 140 }} />
          <input value={p.contraparte} onChange={e => mudar(i, 'contraparte', e.target.value)} placeholder="credor/pagador"
            style={{ padding: '5px 8px', borderRadius: 7, border: '1px solid #cbd5e1', fontSize: 11.5, width: 130 }} />
          {partes.length > 1 && (
            <button onClick={() => setPartes(ps => ps.filter((_, j) => j !== i))}
              style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 16 }}>×</button>
          )}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
        <button onClick={() => setPartes(ps => [...ps, { conta: '9.9', valor: diferenca > 0 ? diferenca : 0, descricao: '', contraparte: '' }])}
          style={{ padding: '6px 11px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontSize: 11.5, fontWeight: 700, color: '#334155' }}>
          + parte
        </button>
        <button onClick={salvar} disabled={salvando}
          style={{ padding: '6px 13px', borderRadius: 8, border: 'none', background: '#7c3aed', color: '#fff', cursor: 'pointer', fontSize: 11.5, fontWeight: 800 }}>
          {salvando ? 'Salvando…' : 'Salvar composição'}
        </button>
        <button onClick={() => apiCall('/api/conciliacao', { method: 'POST', body: JSON.stringify({ acao: 'ratear', id: l.id, partes: [] }) }).then(onFeito)}
          style={{ padding: '6px 11px', borderRadius: 8, border: 'none', background: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 11.5 }}>
          desfazer composição
        </button>
      </div>
      {erro && <div style={{ fontSize: 11.5, color: '#dc2626', marginTop: 7 }}>{erro}</div>}
    </div>
  );
}
