import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Car, Plus, Loader2, FileSignature, CheckCircle2, AlertTriangle, Clock, ExternalLink, X } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { fmtBRL } from '../utils/format';

// RASTREIO DE VEÍCULO ARREMATADO + ASSESSORIA DE VEÍCULO (23/11, pedido do dono).
// Uso interno (admin/analista). A assessoria de veículo NÃO está aberta ao público: não há checkout nem
// botão para o cliente — o caso nasce aqui, lançado à mão (regra_negocio assessoria_veiculo.lancamento_manual,
// aplicada pelo RLS de veiculo_casos). Honorário (5%, mínimo R$ 2.000) é calculado pelo BANCO
// (veiculo_honorario), nunca nesta tela. Mudança de etapa entra sozinha na linha do tempo (trigger).

const ETAPAS = [
  { k: 'arrematado', l: 'Arrematado' },
  { k: 'pagamento_confirmado', l: 'Pagamento' },
  { k: 'documentos_retirada', l: 'Docs de retirada' },
  { k: 'retirada_liberada', l: 'Retirada liberada' },
  { k: 'retirada_agendada', l: 'Retirada agendada' },
  { k: 'retirado', l: 'Retirado' },
  { k: 'vistoria', l: 'Vistoria' },
  { k: 'transferencia', l: 'Transferência DETRAN' },
  { k: 'documentado', l: 'Documento em nome' },
  { k: 'concluido', l: 'Concluído' },
];
const ROTULO = Object.fromEntries([...ETAPAS.map(e => [e.k, e.l]), ['cancelado', 'Cancelado']]);
const HON = { nao_se_aplica: 'Sem assessoria', pendente: 'Honorário a cobrar', cobrado: 'Honorário cobrado', pago: 'Honorário pago', isento: 'Isento' };
const CAMPOS = [
  ['titulo', 'Veículo (título)', 'text'], ['marca', 'Marca', 'text'], ['modelo', 'Modelo', 'text'],
  ['ano_fabricacao', 'Ano fab.', 'number'], ['ano_modelo', 'Ano modelo', 'number'], ['cor', 'Cor', 'text'],
  ['placa', 'Placa', 'text'], ['chassi', 'Chassi', 'text'], ['renavam', 'RENAVAM', 'text'],
  ['leiloeiro', 'Leiloeiro', 'text'], ['plataforma', 'Plataforma', 'text'], ['evento', 'Leilão/evento', 'text'],
  ['lote', 'Lote', 'text'], ['comitente', 'Comitente (vendedor)', 'text'], ['link_lote', 'Link do lote', 'text'],
  ['valor_arremate', 'Valor do arremate (R$)', 'number'], ['valor_total_pago', 'Total pago ao leiloeiro (R$)', 'number'],
  ['valor_fipe', 'FIPE de referência (R$)', 'number'], // 26/11: base do lucro projetado no painel de Assessorados
  ['data_arremate', 'Data do arremate', 'date'], ['pago_em', 'Pago em', 'date'],
  ['local_retirada', 'Local de retirada', 'text'], ['retirada_desde', 'Retirada a partir de', 'date'],
  ['estadia_a_partir', 'Estadia cobrada a partir de', 'date'], ['estadia_diaria', 'Estadia por dia (R$)', 'number'],
];
const NUMERICOS = new Set(CAMPOS.filter(c => c[2] === 'number').map(c => c[0]));

const card = { background: 'white', borderRadius: 14, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', padding: 18 };
const inp = { width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #cbd5e1', fontSize: 13, boxSizing: 'border-box' };
const btn = (cor = '#0D63DB', claro = false) => ({ padding: '8px 14px', borderRadius: 8, border: claro ? `1px solid ${cor}` : 'none', background: claro ? 'white' : cor, color: claro ? cor : 'white', fontSize: 13, fontWeight: 700, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 });

const hojeISO = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const diasAte = (d) => (d ? Math.round((new Date(`${d}T12:00:00Z`) - new Date(`${hojeISO()}T12:00:00Z`)) / 86400e3) : null);
const dataBR = (d) => (d ? new Date(`${String(d).slice(0, 10)}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '—');

function limpar(form) {
  const out = {};
  for (const [k] of CAMPOS) {
    const v = form[k];
    if (v === '' || v === undefined || v === null) { out[k] = null; continue; }
    out[k] = NUMERICOS.has(k) ? Number(String(v).replace(',', '.')) : (typeof v === 'string' ? v.trim() : v);
  }
  if (out.placa) out.placa = out.placa.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return out;
}

// Alertas do caso: o que pede ação agora (estadia correndo, prazo de evento vencendo, honorário sem cobrança).
function alertasDo(c, eventos) {
  const a = [];
  const ativo = !['concluido', 'cancelado'].includes(c.etapa);
  const antesDaRetirada = ETAPAS.findIndex(e => e.k === c.etapa) < ETAPAS.findIndex(e => e.k === 'retirado');
  if (ativo && antesDaRetirada && c.estadia_a_partir) {
    const d = diasAte(c.estadia_a_partir);
    if (d <= 0) a.push({ cor: '#dc2626', t: `Estadia já correndo desde ${dataBR(c.estadia_a_partir)}${c.estadia_diaria ? ` (${fmtBRL(c.estadia_diaria)}/dia)` : ''}` });
    else if (d <= 7) a.push({ cor: '#d97706', t: `Estadia começa em ${d} dia(s) (${dataBR(c.estadia_a_partir)}) — retirar antes` });
  }
  for (const e of eventos || []) {
    if (!e.prazo || !ativo) continue;
    const d = diasAte(e.prazo);
    if (d <= 3) a.push({ cor: d < 0 ? '#dc2626' : '#d97706', t: `${e.titulo}: prazo ${d < 0 ? 'vencido em' : 'até'} ${dataBR(e.prazo)}` });
  }
  if (c.assessoria && c.honorario_status === 'pendente' && c.honorario_valor) a.push({ cor: '#7c3aed', t: `Honorário de ${fmtBRL(c.honorario_valor)} ainda sem cobrança` });
  return a;
}

export default function VeiculosArrematados() {
  const nav = useNavigate();
  const [casos, setCasos] = useState([]);
  const [nomes, setNomes] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [selId, setSelId] = useState(null);
  const [eventos, setEventos] = useState([]);
  const [novo, setNovo] = useState(false);

  async function carregar(manterSel = true) {
    setCarregando(true); setErro('');
    const { data, error } = await supabase.from('veiculo_casos').select('*').order('criado_em', { ascending: false }).limit(200);
    if (error) { setErro(`Não consegui ler os casos: ${error.message}`); setCarregando(false); return; }
    setCasos(data || []);
    const ids = [...new Set((data || []).map(c => c.cliente_id).filter(Boolean))];
    if (ids.length) {
      const { data: ps, error: eP } = await supabase.from('perfis').select('id,nome').in('id', ids);
      if (eP) setErro(`Casos lidos, mas os nomes dos clientes não: ${eP.message}`);
      else setNomes(Object.fromEntries((ps || []).map(p => [p.id, p.nome])));
    }
    if (!manterSel || !(data || []).some(c => c.id === selId)) setSelId(data?.[0]?.id || null);
    setCarregando(false);
  }
  useEffect(() => { carregar(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function carregarEventos(id) {
    if (!id) { setEventos([]); return; }
    const { data, error } = await supabase.from('veiculo_caso_eventos').select('*').eq('caso_id', id)
      .order('data_evento', { ascending: false }).order('criado_em', { ascending: false });
    if (error) { setErro(`Não consegui ler a linha do tempo: ${error.message}`); return; }
    setEventos(data || []);
  }
  useEffect(() => { carregarEventos(selId); }, [selId]);

  const sel = casos.find(c => c.id === selId) || null;

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '20px 16px 60px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <button onClick={() => nav(-1)} style={btn('#475569', true)}><ArrowLeft size={15} /> Voltar</button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#111', display: 'flex', alignItems: 'center', gap: 8 }}><Car size={22} /> Veículos arrematados</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Rastreio do pátio até o documento em nome do arrematante · assessoria de veículo só por lançamento manual</div>
        </div>
        <button onClick={() => setNovo(true)} style={btn()}><Plus size={15} /> Lançar veículo</button>
      </div>

      {erro && <div style={{ ...card, background: '#fef2f2', color: '#991b1b', marginBottom: 12, fontSize: 13 }}>{erro}</div>}
      {aviso && <div style={{ ...card, background: '#f0fdf4', color: '#166534', marginBottom: 12, fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 10 }}><span style={{ whiteSpace: 'pre-wrap', minWidth: 0, overflowWrap: 'anywhere' }}>{aviso}</span><X size={16} style={{ cursor: 'pointer', flexShrink: 0 }} onClick={() => setAviso('')} /></div>}

      {novo && <NovoCaso onFechar={() => setNovo(false)} onCriado={async (id) => { setNovo(false); setAviso('Veículo lançado.'); await carregar(); setSelId(id); }} />}

      {carregando ? <div style={{ ...card, textAlign: 'center', color: '#64748b' }}><Loader2 size={18} className="animate-spin" /> Carregando…</div>
        : !casos.length ? <div style={{ ...card, textAlign: 'center', color: '#64748b' }}>Nenhum veículo lançado ainda.</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 330px) minmax(0, 1fr)', gap: 16, alignItems: 'start' }} className="veic-grid">
            <style>{'@media (max-width: 860px) { .veic-grid { grid-template-columns: 1fr !important; } }'}</style>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {casos.map(c => {
                const i = ETAPAS.findIndex(e => e.k === c.etapa);
                return (
                  <button key={c.id} onClick={() => setSelId(c.id)} style={{ ...card, padding: 12, textAlign: 'left', cursor: 'pointer', border: c.id === selId ? '2px solid #0D63DB' : '2px solid transparent' }}>
                    <div style={{ fontWeight: 700, fontSize: 14, color: '#111' }}>{c.titulo}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{[c.placa, nomes[c.cliente_id], c.leiloeiro || c.plataforma].filter(Boolean).join(' · ') || '—'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      <div style={{ flex: 1, height: 6, background: '#e2e8f0', borderRadius: 3 }}>
                        <div style={{ width: `${c.etapa === 'cancelado' ? 0 : ((i + 1) / ETAPAS.length) * 100}%`, height: 6, background: c.etapa === 'concluido' ? '#16a34a' : '#0D63DB', borderRadius: 3 }} />
                      </div>
                      <span style={{ fontSize: 11, fontWeight: 700, color: c.etapa === 'cancelado' ? '#dc2626' : '#334155' }}>{ROTULO[c.etapa]}</span>
                    </div>
                    {c.assessoria && <div style={{ fontSize: 11, color: '#7c3aed', marginTop: 6, fontWeight: 600 }}>Assessoria · {HON[c.honorario_status]}{c.honorario_valor ? ` · ${fmtBRL(c.honorario_valor)}` : ''}</div>}
                  </button>
                );
              })}
            </div>
            {sel && <DetalheCaso key={sel.id} caso={sel} nomeCliente={nomes[sel.cliente_id]} eventos={eventos}
              onErro={setErro} onAviso={setAviso}
              onMudou={async () => { await carregar(); await carregarEventos(sel.id); }} />}
          </div>
        )}
    </div>
  );
}

function BuscaCliente({ valor, nome, onEscolher }) {
  const [q, setQ] = useState('');
  const [res, setRes] = useState([]);
  const [erro, setErro] = useState('');
  useEffect(() => {
    const termo = q.trim().replace(/[%,()]/g, '');
    if (termo.length < 3) { setRes([]); return undefined; }
    const t = setTimeout(async () => {
      const { data, error } = await supabase.from('perfis').select('id,nome,role').ilike('nome', `%${termo}%`).limit(8);
      if (error) { setErro(error.message); setRes([]); return; }
      setErro(''); setRes(data || []);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div>
      {valor ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <b>{nome || valor}</b>
          <button type="button" onClick={() => onEscolher(null, null)} style={{ ...btn('#64748b', true), padding: '3px 8px', fontSize: 11 }}>trocar</button>
        </div>
      ) : (
        <>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Digite 3+ letras do nome do cliente" style={inp} />
          {erro && <div style={{ fontSize: 11, color: '#dc2626' }}>Busca falhou: {erro}</div>}
          {res.map(p => (
            <div key={p.id} onClick={() => { onEscolher(p.id, p.nome); setQ(''); setRes([]); }} style={{ padding: '6px 8px', fontSize: 13, cursor: 'pointer', borderBottom: '1px solid #f1f5f9' }}>
              {p.nome} <span style={{ color: '#94a3b8', fontSize: 11 }}>{p.role}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function NovoCaso({ onFechar, onCriado }) {
  const [form, setForm] = useState({ data_arremate: hojeISO() });
  const [cliente, setCliente] = useState({ id: null, nome: null });
  const [assessoria, setAssessoria] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar(e) {
    e.preventDefault();
    const dados = limpar(form);
    if (!dados.titulo || dados.titulo.length < 3) { setErro('Informe o veículo (título).'); return; }
    if (assessoria && !cliente.id) { setErro('Assessoria exige o cliente vinculado (é quem assina o termo).'); return; }
    setSalvando(true); setErro('');
    const { data, error } = await supabase.from('veiculo_casos')
      .insert({ ...dados, cliente_id: cliente.id, assessoria, etapa: form.etapa || 'arrematado' }).select('id').single();
    setSalvando(false);
    if (error || !data?.id) { setErro(`Não foi lançado: ${error?.message || 'o banco não devolveu o caso'}`); return; }
    onCriado(data.id);
  }

  return (
    <form onSubmit={salvar} style={{ ...card, marginBottom: 16, border: '1px solid #bfdbfe' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 15, minWidth: 0 }}>Lançar veículo arrematado</div>
        <X size={18} style={{ cursor: 'pointer' }} onClick={onFechar} />
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 4 }}>Cliente (arrematante)</div>
        <BuscaCliente valor={cliente.id} nome={cliente.nome} onEscolher={(id, nome) => setCliente({ id, nome })} />
      </div>
      <Campos form={form} setForm={setForm} />
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={assessoria} onChange={e => setAssessoria(e.target.checked)} />
          Assessoria de veículo contratada (5% do arremate, mín. R$ 2.000 — calculado pelo sistema)
        </label>
        <label style={{ fontSize: 13 }}>Etapa atual:{' '}
          <select value={form.etapa || 'arrematado'} onChange={e => setForm(f => ({ ...f, etapa: e.target.value }))} style={{ ...inp, width: 'auto', display: 'inline-block' }}>
            {ETAPAS.map(e => <option key={e.k} value={e.k}>{e.l}</option>)}
          </select>
        </label>
      </div>
      {erro && <div style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{erro}</div>}
      <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
        <button type="submit" disabled={salvando} style={btn()}>{salvando ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Lançar</button>
        <button type="button" onClick={onFechar} style={btn('#64748b', true)}>Cancelar</button>
      </div>
    </form>
  );
}

function Campos({ form, setForm }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10 }}>
      {CAMPOS.map(([k, l, t]) => (
        <label key={k} style={{ fontSize: 12, fontWeight: 600, color: '#475569', gridColumn: k === 'titulo' || k === 'link_lote' ? 'span 2' : undefined }}>
          {l}
          <input type={t} step={t === 'number' ? '0.01' : undefined} value={form[k] ?? ''} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={{ ...inp, marginTop: 3 }} />
        </label>
      ))}
    </div>
  );
}

function DetalheCaso({ caso, nomeCliente, eventos, onErro, onAviso, onMudou }) {
  const [editando, setEditando] = useState(false);
  const [form, setForm] = useState(caso);
  const [ocupado, setOcupado] = useState('');
  const [ev, setEv] = useState({ titulo: '', data_evento: hojeISO(), prazo: '', observacao: '', visivel_cliente: true });
  const alertas = useMemo(() => alertasDo(caso, eventos), [caso, eventos]);
  const idx = ETAPAS.findIndex(e => e.k === caso.etapa);

  // Toda mutação prova o que mudou com .select(): RLS que filtra a linha devolve error null e 0 linhas.
  async function atualizar(patch, okMsg) {
    setOcupado('salvar');
    const { data, error } = await supabase.from('veiculo_casos').update(patch).eq('id', caso.id).select('id');
    setOcupado('');
    if (error || !data?.length) { onErro(`Não salvou: ${error?.message || 'sem permissão para alterar este caso'}`); return false; }
    if (okMsg) onAviso(okMsg);
    await onMudou();
    return true;
  }

  async function mudarEtapa(k) {
    if (k === caso.etapa) return;
    if (!window.confirm(`Mover para "${ROTULO[k]}"? A mudança entra na linha do tempo.`)) return;
    await atualizar({ etapa: k }, `Etapa: ${ROTULO[k]}.`);
  }

  async function salvarDados() {
    const dados = limpar(form);
    if (!dados.titulo) { onErro('O veículo precisa de um título.'); return; }
    if (await atualizar(dados, 'Dados do veículo salvos.')) setEditando(false);
  }

  async function addEvento(e) {
    e.preventDefault();
    if (ev.titulo.trim().length < 2) { onErro('Descreva o acontecimento.'); return; }
    setOcupado('evento');
    const { data, error } = await supabase.from('veiculo_caso_eventos').insert({
      caso_id: caso.id, etapa: caso.etapa, titulo: ev.titulo.trim(), data_evento: ev.data_evento || hojeISO(),
      prazo: ev.prazo || null, observacao: ev.observacao.trim() || null, visivel_cliente: ev.visivel_cliente,
    }).select('id');
    setOcupado('');
    if (error || !data?.length) { onErro(`Acontecimento não registrado: ${error?.message || 'sem permissão'}`); return; }
    setEv({ titulo: '', data_evento: hojeISO(), prazo: '', observacao: '', visivel_cliente: true });
    await onMudou();
  }

  async function apagarEvento(id) {
    if (!window.confirm('Apagar este registro da linha do tempo?')) return;
    const { data, error } = await supabase.from('veiculo_caso_eventos').delete().eq('id', id).select('id');
    if (error || !data?.length) { onErro(`Não apagou: ${error?.message || 'registros automáticos de etapa não se apagam'}`); return; }
    await onMudou();
  }

  async function gerarTermo(cobrar) {
    setOcupado(cobrar ? 'cobrar' : 'termo');
    try {
      const r = await apiCall('/api/veiculo-assessoria-termo', { method: 'POST', body: JSON.stringify({ caso_id: caso.id, cobrar }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) { onErro(`Termo não gerado: ${d.error || `HTTP ${r.status}`}`); return; }
      onAviso([`Termo ${d.ja_existia ? 'já existia' : 'gerado'} (${d.status === 'assinado' ? 'assinado' : 'aguardando assinatura'}): ${d.termo_url}`,
        d.cobranca_url && `Cobrança do honorário: ${d.cobranca_url}`, d.aviso && `Atenção: ${d.aviso}`].filter(Boolean).join('\n'));
      await onMudou();
    } catch (e) {
      onErro(`Termo não gerado: ${e.message}`);
    } finally { setOcupado(''); }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#111' }}>{caso.titulo}</div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 3 }}>
              {[caso.placa && `Placa ${caso.placa}`, caso.lote && `Lote ${caso.lote}`, caso.evento && `Leilão ${caso.evento}`, caso.leiloeiro || caso.plataforma].filter(Boolean).join(' · ')}
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 2 }}>Cliente: <b>{nomeCliente || (caso.cliente_id ? caso.cliente_id.slice(0, 8) : 'não vinculado')}</b></div>
          </div>
          <div style={{ textAlign: 'right', fontSize: 13 }}>
            <div>Arremate: <b>{fmtBRL(caso.valor_arremate) || '—'}</b>{caso.data_arremate ? ` em ${dataBR(caso.data_arremate)}` : ''}</div>
            <div>Total pago: <b>{fmtBRL(caso.valor_total_pago) || '—'}</b>{caso.pago_em ? ` em ${dataBR(caso.pago_em)}` : ''}</div>
            {caso.valor_fipe > 0 && <div>FIPE: <b>{fmtBRL(caso.valor_fipe)}</b></div>}
            {caso.link_lote && <a href={caso.link_lote} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#0D63DB', display: 'inline-flex', alignItems: 'center', gap: 4 }}>Ver lote <ExternalLink size={12} /></a>}
            {/* 26/11 (dono): o relatório do veículo (FIPE, média de anúncios, viabilidade) fica junto do caso,
                como o mercadológico fica na pasta do imóvel. Abre o relatório gravado do lote ligado ao caso. */}
            {caso.veiculo_id && <div><a href={`#/analise-veiculo?veiculo=${encodeURIComponent(caso.veiculo_id)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#7c3aed', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 4 }}>Relatório do veículo <ExternalLink size={12} /></a></div>}
          </div>
        </div>

        {alertas.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {alertas.map((a, i) => <div key={i} style={{ fontSize: 13, color: a.cor, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}><AlertTriangle size={14} /> {a.t}</div>)}
          </div>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 14 }}>
          {ETAPAS.map((e, i) => {
            const feito = caso.etapa !== 'cancelado' && i <= idx;
            return (
              <button key={e.k} onClick={() => mudarEtapa(e.k)} disabled={!!ocupado} title="Mover para esta etapa"
                style={{ padding: '6px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: i === idx ? '2px solid #0D63DB' : '1px solid #cbd5e1',
                  background: feito ? (i === idx ? '#0D63DB' : '#dbeafe') : 'white', color: feito ? (i === idx ? 'white' : '#1e3a8a') : '#64748b', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                {feito && i < idx && <CheckCircle2 size={12} />}{e.l}
              </button>
            );
          })}
          {caso.etapa !== 'cancelado'
            ? <button onClick={() => mudarEtapa('cancelado')} disabled={!!ocupado} style={{ padding: '6px 10px', borderRadius: 999, fontSize: 12, border: '1px solid #fecaca', background: 'white', color: '#dc2626', cursor: 'pointer' }}>Cancelar caso</button>
            : <span style={{ padding: '6px 10px', fontSize: 12, fontWeight: 700, color: '#dc2626' }}>Caso cancelado</span>}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginTop: 14, fontSize: 13, color: '#334155' }}>
          <div>Retirada a partir de: <b>{dataBR(caso.retirada_desde)}</b></div>
          <div>Estadia a partir de: <b>{dataBR(caso.estadia_a_partir)}</b>{caso.estadia_diaria ? ` · ${fmtBRL(caso.estadia_diaria)}/dia` : ''}</div>
          <div>Local de retirada: <b>{caso.local_retirada || '—'}</b></div>
          <div>Chassi / RENAVAM: <b>{caso.chassi || '—'} / {caso.renavam || '—'}</b></div>
        </div>
        <div style={{ marginTop: 12 }}>
          <button onClick={() => { setForm(caso); setEditando(v => !v); }} style={btn('#0D63DB', true)}>{editando ? 'Fechar edição' : 'Editar dados'}</button>
        </div>
        {editando && (
          <div style={{ marginTop: 12 }}>
            <Campos form={form} setForm={setForm} />
            <button onClick={salvarDados} disabled={!!ocupado} style={{ ...btn(), marginTop: 12 }}>{ocupado === 'salvar' ? <Loader2 size={14} className="animate-spin" /> : null} Salvar dados</button>
          </div>
        )}
      </div>

      <Assessoria caso={caso} ocupado={ocupado} onAtualizar={atualizar} onGerarTermo={gerarTermo} onErro={onErro} />

      <div style={card}>
        <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><Clock size={16} /> Linha do tempo</div>
        <form onSubmit={addEvento} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 8, marginBottom: 14 }} className="veic-ev">
          <style>{'@media (max-width: 620px) { .veic-ev { grid-template-columns: 1fr !important; } }'}</style>
          <input value={ev.titulo} onChange={e => setEv(v => ({ ...v, titulo: e.target.value }))} placeholder="O que aconteceu (ex.: termo de responsabilidade aceito)" style={inp} />
          <label style={{ fontSize: 11, color: '#64748b' }}>Data<input type="date" value={ev.data_evento} onChange={e => setEv(v => ({ ...v, data_evento: e.target.value }))} style={inp} /></label>
          <label style={{ fontSize: 11, color: '#64748b' }}>Prazo (opcional)<input type="date" value={ev.prazo} onChange={e => setEv(v => ({ ...v, prazo: e.target.value }))} style={inp} /></label>
          <textarea value={ev.observacao} onChange={e => setEv(v => ({ ...v, observacao: e.target.value }))} placeholder="Detalhes (opcional)" rows={2} style={{ ...inp, gridColumn: '1 / -1' }} />
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12 }}><input type="checkbox" checked={ev.visivel_cliente} onChange={e => setEv(v => ({ ...v, visivel_cliente: e.target.checked }))} /> Visível para o cliente</label>
            <button type="submit" disabled={!!ocupado} style={btn()}>{ocupado === 'evento' ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Registrar</button>
          </div>
        </form>
        {!eventos.length ? <div style={{ fontSize: 13, color: '#64748b' }}>Nada registrado ainda.</div> : (
          <div style={{ borderLeft: '2px solid #e2e8f0', paddingLeft: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {eventos.map(e => (
              <div key={e.id} style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', left: -21, top: 3, width: 10, height: 10, borderRadius: 5, background: e.origem === 'etapa' ? '#0D63DB' : '#94a3b8' }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>
                  {e.titulo}
                  {!e.visivel_cliente && <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}> · interno</span>}
                  {e.origem === 'manual' && <X size={12} style={{ cursor: 'pointer', color: '#94a3b8', marginLeft: 6, verticalAlign: 'middle' }} onClick={() => apagarEvento(e.id)} />}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{dataBR(e.data_evento)}{e.prazo ? ` · prazo ${dataBR(e.prazo)}` : ''}</div>
                {e.observacao && <div style={{ fontSize: 12, color: '#334155', whiteSpace: 'pre-wrap', marginTop: 2 }}>{e.observacao}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Assessoria({ caso, ocupado, onAtualizar, onGerarTermo, onErro }) {
  const [cliente, setCliente] = useState({ id: null, nome: null });
  const [cobranca, setCobranca] = useState(null);
  useEffect(() => {
    let vivo = true;
    if (!caso.cobranca_id) { setCobranca(null); return undefined; }
    supabase.from('cobrancas_avulsas').select('id,status,valor,pago_em').eq('id', caso.cobranca_id).maybeSingle()
      .then(({ data, error }) => { if (!vivo) return; if (error) onErro(`Não li a cobrança do honorário: ${error.message}`); else setCobranca(data); });
    return () => { vivo = false; };
  }, [caso.cobranca_id]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={card}>
      <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}><FileSignature size={16} /> Assessoria de veículo</div>
      {!caso.assessoria ? (
        <div style={{ fontSize: 13, color: '#475569' }}>
          <div style={{ marginBottom: 8 }}>Sem assessoria — só rastreio. Para contratar (5% do arremate, mínimo R$ 2.000), vincule o cliente e ative.</div>
          {!caso.cliente_id && <div style={{ marginBottom: 8 }}><BuscaCliente valor={cliente.id} nome={cliente.nome} onEscolher={(id, nome) => setCliente({ id, nome })} /></div>}
          <button disabled={!!ocupado || (!caso.cliente_id && !cliente.id)} onClick={() => onAtualizar({ assessoria: true, ...(caso.cliente_id ? {} : { cliente_id: cliente.id }) }, 'Assessoria ativada — honorário calculado pelo sistema.')} style={btn('#7c3aed')}>
            Ativar assessoria
          </button>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: '#334155', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div>Honorário: <b>{caso.honorario_valor ? fmtBRL(caso.honorario_valor) : 'aguarda o valor do arremate'}</b>
            {caso.honorario_pct ? ` (${caso.honorario_pct}% · mínimo ${fmtBRL(caso.honorario_minimo)})` : ''} · <b style={{ color: '#7c3aed' }}>{HON[caso.honorario_status]}</b></div>
          {cobranca && <div>Cobrança: <a href={`#/cobranca/${cobranca.id}`} target="_blank" rel="noopener noreferrer">{fmtBRL(cobranca.valor)} · {cobranca.status}{cobranca.pago_em ? ` em ${dataBR(cobranca.pago_em)}` : ''}</a></div>}
          {caso.termo_url && <div style={{ overflowWrap: 'anywhere' }}>Termo: <a href={caso.termo_url} target="_blank" rel="noopener noreferrer">{caso.termo_url}</a></div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button disabled={!!ocupado} onClick={() => onGerarTermo(false)} style={btn('#7c3aed', true)}>{ocupado === 'termo' && <Loader2 size={14} className="animate-spin" />} {caso.termo_url ? 'Ver/gerar termo' : 'Gerar termo'}</button>
            {!['cobrado', 'pago', 'isento'].includes(caso.honorario_status) && (
              <button disabled={!!ocupado || !caso.honorario_valor} onClick={() => onGerarTermo(true)} style={btn('#7c3aed')}>{ocupado === 'cobrar' && <Loader2 size={14} className="animate-spin" />} Termo + cobrança do honorário</button>
            )}
            {caso.honorario_status !== 'pago' && (cobranca?.status === 'paga' || caso.honorario_status === 'cobrado') && (
              <button disabled={!!ocupado} onClick={() => window.confirm('Confirmar que o honorário foi PAGO?') && onAtualizar({ honorario_status: 'pago' }, 'Honorário marcado como pago.')} style={btn('#16a34a')}>Marcar honorário pago</button>
            )}
            {caso.honorario_status === 'pendente' && (
              <button disabled={!!ocupado} onClick={() => window.confirm('Isentar o honorário deste caso?') && onAtualizar({ honorario_status: 'isento' }, 'Honorário isento.')} style={btn('#64748b', true)}>Isentar</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
