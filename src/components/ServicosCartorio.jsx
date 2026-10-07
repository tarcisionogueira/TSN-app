import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Copy, Plus, Landmark } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

// SERVIÇOS DE CARTÓRIO (07/10, pedido do dono) — UM componente para os dois lugares:
//  · na tela do ARREMATE do portfólio (`arrematadoId`, 07/10): o servidor resolve se existe uma
//    arrematação formal por trás; existindo, o serviço nasce presa a ela, senão fica preso ao
//    arremate — nunca "avulso solto", que perderia a ligação com o que o originou.
//  · no caso do assessorado (`arrematacaoId`): o serviço nasce vinculado àquela arrematação;
//    o cliente vê o andamento e o botão de pagar; a equipe contrata, cobra e avança o status.
//  · no Admin → Financeiro → Cartório (sem `arrematacaoId`): todas as operações, filtro por
//    status, operação AVULSA (cliente fora de uma arrematação nossa) e o catálogo de preços.
// Regra do dono: a parcela "para dar entrada" é paga ANTES do protocolo — o banco recusa
// 'protocolado' com parcela em aberto; a tela só repete o aviso.

const fmt = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (v) => (v ? new Date(v).toLocaleDateString('pt-BR') : '');
const STATUS = {
  aguardando_pagamento: { t: 'Aguardando 1º pagamento', c: '#92400e', b: '#fef3c7' },
  em_preparo: { t: 'Em preparo', c: '#1e40af', b: '#dbeafe' },
  aguardando_entrada: { t: 'Aguardando pagamento da entrada', c: '#92400e', b: '#fef3c7' },
  pronto_para_protocolo: { t: 'Pago — pronto para dar entrada', c: '#166534', b: '#dcfce7' },
  protocolado: { t: 'Protocolado no cartório', c: '#1e40af', b: '#dbeafe' },
  exigencia: { t: 'Exigência do cartório', c: '#9a3412', b: '#ffedd5' },
  registrado: { t: 'Registrado', c: '#166534', b: '#dcfce7' },
  cancelado: { t: 'Cancelado', c: '#475569', b: '#f1f5f9' },
};
const PARC = { pendente: 'A cobrar', cobrada: 'Boleto enviado', paga: 'Paga', cancelada: 'Cancelada' };
const totalParc = (p) => Number(p.valor || 0) + Number(p.custas || 0);
// "serviço R$ X + custas R$ Y" quando há custas do cartório somadas no mesmo boleto.
const composicao = (p) => (Number(p.custas) > 0 && Number(p.valor) > 0 ? ` (serviço ${fmt(p.valor)} + custas ${fmt(p.custas)})` : Number(p.custas) > 0 ? ' (custas do cartório)' : '');
const inp = { width: '100%', padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' };
const btn = (bg, cor = 'white') => ({ padding: '7px 12px', border: 'none', borderRadius: 8, background: bg, color: cor, fontWeight: 700, fontSize: 12, cursor: 'pointer' });

export default function ServicosCartorio({ arrematacaoId = null, arrematadoId = null, ehEquipe = false, ehAdmin = false }) {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [filtro, setFiltro] = useState('abertos');
  const [form, setForm] = useState(null);           // nova operação
  const [catEdit, setCatEdit] = useState(null);     // edição do catálogo
  const [protocolo, setProtocolo] = useState({});   // servico_id -> número digitado
  const [copiado, setCopiado] = useState('');
  const [custasForm, setCustasForm] = useState({});  // servico_id -> valor das custas da devolutiva

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const q = arrematadoId ? `?arrematado_id=${arrematadoId}`
        : arrematacaoId ? `?arrematacao_id=${arrematacaoId}` : '';
      const r = await apiCall(`/api/servicos-cartorio${q}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
      setDados(d);
    } catch (e) { setErro(e.message || 'Não foi possível carregar os serviços de cartório.'); }
  }, [arrematacaoId, arrematadoId]);
  useEffect(() => { carregar(); }, [carregar]);

  const acao = async (chave, body, okMsg) => {
    setOcupado(chave); setErro('');
    try {
      const r = await apiCall('/api/servicos-cartorio', { method: 'POST', body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Erro ${r.status}`);
      await carregar();
      if (okMsg) alert(typeof okMsg === 'function' ? okMsg(d) : okMsg);
      return d;
    } catch (e) { setErro(e.message); return null; } finally { setOcupado(''); }
  };

  const copiar = (link) => { navigator.clipboard?.writeText(link); setCopiado(link); setTimeout(() => setCopiado(''), 2000); };
  const msgCobranca = (d) => {
    const c = d?.cobranca || d;
    if (!c?.link) return 'Feito.';
    return `Cobrança gerada${c.emailEnviado ? ' e enviada por e-mail ao cliente' : ' (e-mail NÃO saiu — copie o link e envie ao cliente)'}.`;
  };

  if (!dados && !erro) return <div style={{ padding: 12, fontSize: 12, color: '#64748b' }}><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Carregando serviços de cartório…</div>;

  const ctx = arrematacaoId || arrematadoId;   // tela de UM arremate/caso, não o painel geral
  const servicos = (dados?.servicos || []).filter((s) => ctx || filtro === 'todos'
    || (filtro === 'abertos' ? !['registrado', 'cancelado'].includes(s.status) : s.status === filtro));
  const catalogo = (dados?.catalogo || []).filter((c) => c.ativo !== false);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 13, color: '#111', minWidth: 0 }}>
          <Landmark size={15} /> Serviços de cartório
        </div>
        {ehEquipe && !form && catalogo.length > 0 && (
          <button style={btn('#0D63DB')} onClick={() => setForm({ catalogo_id: catalogo[0].id, cliente_nome: '', cliente_email: '', imovel_descricao: '', cartorio: '', matricula: '', observacoes: '' })}>
            <Plus size={12} style={{ verticalAlign: -2 }} /> {ctx ? 'Contratar serviço' : 'Nova operação avulsa'}
          </button>
        )}
      </div>

      {erro && <div style={{ fontSize: 12, color: '#991b1b', background: '#fee2e2', borderRadius: 8, padding: '8px 10px' }}>{erro}</div>}

      {!ctx && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {[['abertos', 'Em andamento'], ['aguardando_entrada', 'Aguardando entrada'], ['pronto_para_protocolo', 'Prontos p/ protocolo'], ['protocolado', 'Protocolados'], ['registrado', 'Registrados'], ['todos', 'Todos']].map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)} style={{ ...btn(filtro === k ? '#0D63DB' : 'white', filtro === k ? 'white' : '#475569'), border: '1px solid #e2e8f0', borderRadius: 20 }}>{l}</button>
          ))}
        </div>
      )}

      {form && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <select value={form.catalogo_id} onChange={(e) => setForm({ ...form, catalogo_id: e.target.value })} style={inp}>
            {catalogo.map((c) => (
              <option key={c.id} value={c.id}>{c.nome} — {fmt((c.parcelas || []).reduce((t, p) => t + totalParc(p), 0))} ({(c.parcelas || []).length}×)</option>
            ))}
          </select>
          {(() => { const c = catalogo.find((x) => x.id === form.catalogo_id); return c ? (
            <div style={{ fontSize: 11.5, color: '#475569' }}>
              {(c.parcelas || []).map((p, i) => <div key={i}>{i + 1}. {p.rotulo}: <strong>{fmt(totalParc(p))}</strong>{composicao(p)}</div>)}
              <div style={{ color: '#64748b', marginTop: 2 }}>A 1ª parcela é cobrada ao contratar, por boleto. Custas não tabeladas (ex.: registro) são lançadas depois da devolutiva do cartório.</div>
            </div>) : null; })()}
          {!ctx && (
            <>
              <input placeholder="Nome do cliente" value={form.cliente_nome} onChange={(e) => setForm({ ...form, cliente_nome: e.target.value })} style={inp} />
              <input placeholder="E-mail do cliente (recebe a cobrança)" value={form.cliente_email} onChange={(e) => setForm({ ...form, cliente_email: e.target.value })} style={inp} inputMode="email" />
              <input placeholder="Imóvel (endereço / descrição)" value={form.imovel_descricao} onChange={(e) => setForm({ ...form, imovel_descricao: e.target.value })} style={inp} />
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 8 }}>
            <input placeholder="Cartório (ex.: RI de Barueri)" value={form.cartorio} onChange={(e) => setForm({ ...form, cartorio: e.target.value })} style={inp} />
            <input placeholder="Matrícula" value={form.matricula} onChange={(e) => setForm({ ...form, matricula: e.target.value })} style={inp} />
          </div>
          <textarea placeholder="Observações (opcional)" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} style={{ ...inp, minHeight: 50 }} />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button style={btn('white', '#475569')} onClick={() => setForm(null)}>Cancelar</button>
            <button style={btn('#0D63DB')} disabled={ocupado === 'criar'}
              onClick={async () => { const d = await acao('criar', { action: 'criar', ...form, arrematacao_id: arrematacaoId || undefined, arrematado_id: arrematadoId || undefined }, msgCobranca); if (d) setForm(null); }}>
              {ocupado === 'criar' ? 'Criando…' : 'Criar e cobrar 1ª parcela'}
            </button>
          </div>
        </div>
      )}

      {servicos.length === 0 && !form && (
        <div style={{ fontSize: 12, color: '#64748b' }}>
          {arrematacaoId ? 'Nenhum serviço de cartório contratado para esta arrematação.' : 'Nenhuma operação neste filtro.'}
        </div>
      )}

      {servicos.map((s) => {
        const st = STATUS[s.status] || { t: s.status, c: '#475569', b: '#f1f5f9' };
        const abertas = (s.parcelas || []).filter((p) => !['paga', 'cancelada'].includes(p.status));
        const total = (s.parcelas || []).reduce((t, p) => t + totalParc(p), 0);
        return (
          <div key={s.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 12, background: 'white' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#111' }}>{s.servico_nome} · {fmt(total)}</div>
                {!arrematacaoId && <div style={{ fontSize: 12, color: '#334155' }}>{s.cliente_nome || '—'}{s.arrematacao_id ? '' : ' · avulsa'}</div>}
                {s.imovel_descricao && <div style={{ fontSize: 11.5, color: '#64748b' }}>{s.imovel_descricao}</div>}
                {(s.cartorio || s.matricula) && <div style={{ fontSize: 11.5, color: '#64748b' }}>{[s.cartorio, s.matricula && `Matrícula ${s.matricula}`].filter(Boolean).join(' · ')}</div>}
                {s.protocolo_numero && <div style={{ fontSize: 11.5, color: '#334155' }}>Protocolo {s.protocolo_numero}{s.protocolado_em ? ` em ${dt(s.protocolado_em)}` : ''}</div>}
              </div>
              <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 8px', borderRadius: 999, background: st.b, color: st.c, whiteSpace: 'nowrap' }}>{st.t}</span>
            </div>

            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {(s.parcelas || []).map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, flexWrap: 'wrap' }}>
                  <span style={{ flex: 1, minWidth: 140, color: '#334155' }}>{p.ordem}. {p.rotulo} — <strong>{fmt(totalParc(p))}</strong><span style={{ color: '#64748b' }}>{composicao(p)}</span></span>
                  <span style={{ color: p.status === 'paga' ? '#059669' : '#92400e', fontWeight: 700 }}>{PARC[p.status] || p.status}{p.paga_em ? ` ${dt(p.paga_em)}` : ''}</span>
                  {p.status === 'cobrada' && p.link && (
                    ehEquipe
                      ? <button style={btn('white', '#0D63DB')} onClick={() => copiar(p.link)}><Copy size={11} style={{ verticalAlign: -1 }} /> {copiado === p.link ? 'Copiado' : 'Link'}</button>
                      : <a href={p.link} target="_blank" rel="noopener noreferrer" style={{ ...btn('#0D63DB'), textDecoration: 'none' }}>Pagar (boleto)</a>
                  )}
                  {ehEquipe && p.status === 'pendente' && s.status !== 'cancelado' && (
                    <button style={btn('#0D63DB')} disabled={ocupado === p.id}
                      onClick={() => acao(p.id, { action: 'cobrar', parcela_id: p.id }, msgCobranca)}>
                      {ocupado === p.id ? 'Gerando…' : 'Cobrar'}
                    </button>
                  )}
                </div>
              ))}
            </div>

            {!ehEquipe && s.status === 'aguardando_entrada' && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: '#475569' }}>Seu registro está preparado. Assim que o pagamento for confirmado, damos entrada no cartório.</div>
            )}

            {ehEquipe && !['registrado', 'cancelado'].includes(s.status) && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #e2e8f0', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                {['pronto_para_protocolo', 'em_preparo', 'aguardando_entrada'].includes(s.status) && (
                  <>
                    <input placeholder="Nº do protocolo" value={protocolo[s.id] || ''} onChange={(e) => setProtocolo({ ...protocolo, [s.id]: e.target.value })} style={{ ...inp, width: 150 }} />
                    <button style={btn(abertas.length ? '#94a3b8' : '#059669')} disabled={ocupado === `p${s.id}`}
                      title={abertas.length ? 'O cliente paga antes de darmos entrada.' : ''}
                      onClick={() => {
                        if (abertas.length) { setErro('Há parcela não paga: o cliente paga antes de darmos entrada no cartório.'); return; }
                        acao(`p${s.id}`, { action: 'status', servico_id: s.id, status: 'protocolado', protocolo_numero: protocolo[s.id] });
                      }}>Dar entrada (protocolar)</button>
                  </>
                )}
                {['protocolado', 'exigencia'].includes(s.status) && (
                  <>
                    {s.status === 'protocolado' && <button style={btn('#ea580c')} onClick={() => acao(`e${s.id}`, { action: 'status', servico_id: s.id, status: 'exigencia' })}>Exigência</button>}
                    {s.status === 'exigencia' && <button style={btn('#0D63DB')} onClick={() => acao(`e${s.id}`, { action: 'status', servico_id: s.id, status: 'protocolado' })}>Exigência cumprida</button>}
                    <button style={btn('#059669')} onClick={() => acao(`r${s.id}`, { action: 'status', servico_id: s.id, status: 'registrado' })}>Registrado</button>
                  </>
                )}
                {['protocolado', 'exigencia', 'pronto_para_protocolo', 'em_preparo', 'aguardando_entrada'].includes(s.status) && (
                  <span style={{ display: 'flex', gap: 6, alignItems: 'center', width: '100%' }}>
                    <input placeholder="Custas do cartório (R$)" inputMode="decimal" value={custasForm[s.id] || ''}
                      onChange={(e) => setCustasForm({ ...custasForm, [s.id]: e.target.value })} style={{ ...inp, width: 170 }} />
                    <button style={btn('white', '#0D63DB')} disabled={ocupado === `k${s.id}`}
                      title="Valor que o cartório informou na devolutiva — vai por boleto ao cliente"
                      onClick={async () => { const d = await acao(`k${s.id}`, { action: 'adicionar_custas', servico_id: s.id, valor: custasForm[s.id] }, msgCobranca); if (d) setCustasForm({ ...custasForm, [s.id]: '' }); }}>
                      Cobrar custas
                    </button>
                  </span>
                )}
                <button style={{ ...btn('white', '#991b1b'), marginLeft: 'auto' }}
                  onClick={() => { if (window.confirm('Cancelar este serviço? As cobranças em aberto deixam de valer.')) acao(`c${s.id}`, { action: 'status', servico_id: s.id, status: 'cancelado' }); }}>
                  Cancelar
                </button>
              </div>
            )}
          </div>
        );
      })}

      {ehAdmin && !arrematacaoId && (
        <div style={{ marginTop: 6, borderTop: '1px solid #e2e8f0', paddingTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, fontSize: 12.5, minWidth: 0 }}>Catálogo de serviços e preços</div>
            {!catEdit && <button style={btn('white', '#0D63DB')} onClick={() => setCatEdit({ nome: '', descricao: '', parcelas: [{ rotulo: 'Na contratação', valor: '', momento: 'contratacao' }, { rotulo: 'Para dar entrada', valor: '', momento: 'entrada' }], ativo: true })}>+ Novo serviço</button>}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', margin: '2px 0 6px' }}>Serviço = sua remuneração. Custas tabela = taxa do cartório já conhecida (certidões), cobrada no mesmo boleto. Mudar o preço não altera serviços já contratados.</div>
          {(dados?.catalogo || []).map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, padding: '4px 0' }}>
              <span style={{ flex: 1, minWidth: 0, color: c.ativo === false ? '#94a3b8' : '#334155' }}>
                {c.nome}{c.ativo === false ? ' (inativo)' : ''} — {(c.parcelas || []).map((p) => fmt(totalParc(p)) + composicao(p)).join(' + ')}
              </span>
              <button style={btn('white', '#0D63DB')} onClick={() => setCatEdit({ ...c, parcelas: (c.parcelas || []).map((p) => ({ ...p })) })}>Editar</button>
            </div>
          ))}
          {catEdit && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: 10, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, background: '#f8fafc' }}>
              <input placeholder="Nome (ex.: Registro com averbação)" value={catEdit.nome} onChange={(e) => setCatEdit({ ...catEdit, nome: e.target.value })} style={inp} />
              <input placeholder="Descrição (opcional)" value={catEdit.descricao || ''} onChange={(e) => setCatEdit({ ...catEdit, descricao: e.target.value })} style={inp} />
              {catEdit.parcelas.map((p, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.3fr) auto', gap: 6 }}>
                  <input placeholder="Rótulo da parcela" value={p.rotulo} onChange={(e) => { const ps = [...catEdit.parcelas]; ps[i] = { ...p, rotulo: e.target.value }; setCatEdit({ ...catEdit, parcelas: ps }); }} style={inp} />
                  <input placeholder="Serviço R$" inputMode="decimal" value={p.valor} onChange={(e) => { const ps = [...catEdit.parcelas]; ps[i] = { ...p, valor: e.target.value.replace(',', '.') }; setCatEdit({ ...catEdit, parcelas: ps }); }} style={inp} />
                  <input placeholder="Custas tabela R$" title="Custas do cartório quando já tabeladas (certidões). Vão no mesmo boleto." inputMode="decimal" value={p.custas ?? ''} onChange={(e) => { const ps = [...catEdit.parcelas]; ps[i] = { ...p, custas: e.target.value.replace(',', '.') }; setCatEdit({ ...catEdit, parcelas: ps }); }} style={inp} />
                  <select value={p.momento} onChange={(e) => { const ps = [...catEdit.parcelas]; ps[i] = { ...p, momento: e.target.value }; setCatEdit({ ...catEdit, parcelas: ps }); }} style={inp}>
                    <option value="contratacao">Na contratação</option>
                    <option value="entrada">Antes de dar entrada</option>
                    <option value="outro">Outro momento</option>
                  </select>
                  <button style={btn('white', '#991b1b')} onClick={() => setCatEdit({ ...catEdit, parcelas: catEdit.parcelas.filter((_, j) => j !== i) })}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button style={btn('white', '#0D63DB')} onClick={() => setCatEdit({ ...catEdit, parcelas: [...catEdit.parcelas, { rotulo: '', valor: '', momento: 'outro' }] })}>+ Parcela</button>
                <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
                  <input type="checkbox" checked={catEdit.ativo !== false} onChange={(e) => setCatEdit({ ...catEdit, ativo: e.target.checked })} /> Ativo
                </label>
                <span style={{ flex: 1, minWidth: 0 }} />
                <button style={btn('white', '#475569')} onClick={() => setCatEdit(null)}>Cancelar</button>
                <button style={btn('#0D63DB')} disabled={ocupado === 'cat'}
                  onClick={async () => { const d = await acao('cat', { action: 'catalogo_salvar', ...catEdit }); if (d) setCatEdit(null); }}>Salvar</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
