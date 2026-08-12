import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useIsMobile } from '../utils/useIsMobile';
import {
  Building2, BarChart3, TrendingUp, DollarSign, Plus, Trash2,
  ChevronDown, ChevronUp, CheckCircle2, Clock, XCircle, Home,
  LayoutGrid, Warehouse, ArrowUpCircle, ArrowDownCircle, X, Save,
  FileText, Scale, CalendarClock, ShieldCheck, Printer, Sparkles, Hourglass,
  Users,
} from 'lucide-react';
import { loadImoveis, saveImoveis, loadFavoritos } from '../utils/storage';
import { fmt, fmtPct } from '../utils/calculos';
import { useAuth } from '../contexts/AuthContext';
import { gerarPDFFinanceiro } from '../components/RelatorioFinanceiroPDF';
import { supabase } from '../utils/supabase';
import { reportarErroCliente } from '../utils/reportarErro';

// Tipos de avaliação disponíveis na aba "Em Análise"
const AVALIACOES = [
  { key:'mercadologica', label:'Avaliação Mercadológica + Viabilidade', desc:'Relatório de mercado em 2 níveis com viabilidade financeira e fluxo de caixa.', icon:BarChart3, cor:'#10b981', bg:'#f0fdf4', via:'analise' },
  { key:'edital',        label:'Avaliação de Edital e Matrícula',         desc:'Leitura do edital, matrícula e certidões com extração de riscos via IA.',       icon:FileText,  cor:'#0D63DB', bg:'#eff6ff', via:'analise' },
  { key:'processual',    label:'Avaliação Processual',                    desc:'Análise processual do imóvel com extração de riscos e pendências. Liberação em até 24h.',          icon:Scale,     cor:'#8b5cf6', bg:'#ede9fe', via:'integracao' },
];

// Tipos de solicitação fora do catálogo de avaliações (workflow /analise).
const TIPO_LABEL_EXTRA = {
  consulta: 'Revisão pelo analista',
  juridico: 'Encaminhamento jurídico',
  leiloeiro_sugerido: 'Leiloeiro sugerido (fora da base)',
};

const ROLES_ANALISTA = ['analista','advogado','admin'];

// Estado de uma solicitação (row do Supabase)
function statusAvaliacao(solic) {
  if (!solic) return { st:'disponivel', l:'Disponível', c:'#64748b', bg:'#f1f5f9' };
  if (solic.status === 'concluido') return { st:'concluido', l:'Laudo pronto', c:'#10b981', bg:'#d1fae5' };
  if (solic.prazo_ate && Date.now() >= new Date(solic.prazo_ate).getTime())
    return { st:'concluido', l:'Laudo pronto', c:'#10b981', bg:'#d1fae5' };
  if (solic.status === 'em_andamento') return { st:'em_andamento', l:'Em andamento (24h)', c:'#f59e0b', bg:'#fef3c7' };
  return { st:'disponivel', l:'Disponível', c:'#64748b', bg:'#f1f5f9' };
}

function diasAteLeilao(dataLeilao) {
  if (!dataLeilao) return null;
  const d = new Date(dataLeilao);
  if (isNaN(d)) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

const STATUS_CONFIG = {
  analise:    { l:'Em Análise',  c:'#f59e0b', bg:'#fef3c7' },
  aprovado:   { l:'Aprovado',    c:'#10b981', bg:'#d1fae5' },
  arrematado: { l:'Arrematado',  c:'#0D63DB', bg:'#dbeafe' },
  em_reforma: { l:'Em Reforma',  c:'#8b5cf6', bg:'#ede9fe' },
  venda:      { l:'À Venda',     c:'#f97316', bg:'#ffedd5' },
  alugado:    { l:'Alugado',     c:'#06b6d4', bg:'#cffafe' },
  concluido:  { l:'Concluído',   c:'#64748b', bg:'#f1f5f9' },
  reprovado:  { l:'Reprovado',   c:'#ef4444', bg:'#fee2e2' },
};

const CAT_LANC = [
  'Arrematação','Honorários','Taxa Leiloeiro','ITBI / Registro',
  'Reforma / Retrofit','Parcela Banco','IPTU','Condomínio','Laudêmio',
  'Foreiro','Débitos','Venda','Locação','Outros',
];

function BadgeStatus({ status }) {
  const s = STATUS_CONFIG[status] || STATUS_CONFIG.analise;
  return <span style={{ background:s.bg, color:s.c, fontSize:10, fontWeight:700, padding:'3px 9px', borderRadius:20, whiteSpace:'nowrap' }}>{s.l}</span>;
}

function ControleFinanceiro({ im, onClose, onUpdate }) {
  const [lancamentos, setLancamentos] = useState(im.lancamentosFinanceiros || []);
  const [form, setForm] = useState({ data: new Date().toISOString().slice(0,10), tipo:'saida', categoria:'Outros', descricao:'', valor:'' });

  const totalEntradas = lancamentos.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+Number(l.valor),0);
  const totalSaidas   = lancamentos.filter(l=>l.tipo==='saida').reduce((s,l)=>s+Number(l.valor),0);
  const saldo = totalEntradas - totalSaidas;

  const adicionar = () => {
    if (!form.valor || Number(form.valor)<=0) return;
    const novo = { ...form, id: Date.now(), valor: Number(form.valor) };
    const updated = [...lancamentos, novo];
    setLancamentos(updated);
    setForm(p => ({ ...p, descricao:'', valor:'' }));
    onUpdate({ ...im, lancamentosFinanceiros: updated });
  };

  const remover = (id) => {
    const updated = lancamentos.filter(l=>l.id!==id);
    setLancamentos(updated);
    onUpdate({ ...im, lancamentosFinanceiros: updated });
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'flex-start', justifyContent:'center', padding:'24px 16px', overflowY:'auto' }}>
      <div style={{ background:'white', borderRadius:18, width:'100%', maxWidth:680, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}>

        {/* Header */}
        <div style={{ background:'#111111', borderRadius:'18px 18px 0 0', padding:'18px 22px', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:12, color:'#64748b', fontWeight:700, textTransform:'uppercase', marginBottom:4 }}>Controle Financeiro</div>
            <div style={{ fontSize:17, fontWeight:900, color:'white', lineHeight:1.3 }}>{im.nome || im.endereco || 'Imóvel'}</div>
            {im.cidade && <div style={{ fontSize:12, color:'#94a3b8', marginTop:3 }}>{im.cidade}{im.estado?', '+im.estado:''}</div>}
          </div>
          <button onClick={onClose} style={{ background:'#111111', border:'none', borderRadius:8, padding:8, cursor:'pointer', color:'#94a3b8' }}>
            <X size={16}/>
          </button>
        </div>

        {/* Sumário */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:0, borderBottom:'1px solid #e2e8f0' }}>
          {[
            ['Entradas',totalEntradas,'#10b981','#f0fdf4'],
            ['Saídas',totalSaidas,'#ef4444','#fef2f2'],
            ['Saldo',saldo,saldo>=0?'#10b981':'#ef4444',saldo>=0?'#d1fae5':'#fee2e2'],
          ].map(([l,v,c,bg])=>(
            <div key={l} style={{ padding:'16px 18px', background:bg, borderRight:'1px solid #e2e8f0', textAlign:'center' }}>
              <div style={{ fontSize:10, color:c, fontWeight:800, textTransform:'uppercase', marginBottom:4 }}>{l}</div>
              <div style={{ fontSize:22, fontWeight:900, color:c }}>R$ {fmt(Math.abs(v))}</div>
            </div>
          ))}
        </div>

        {/* Novo lançamento */}
        <div style={{ padding:'16px 22px', borderBottom:'1px solid #f1f5f9', background:'#f8fafc' }}>
          <div style={{ fontSize:11, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:12 }}>Novo Lançamento</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(120px, 1fr))', gap:8, alignItems:'flex-end' }}>
            <div>
              <label style={{ fontSize:10, fontWeight:700, color:'#64748b', display:'block', marginBottom:4 }}>DATA</label>
              <input type="date" value={form.data} onChange={e=>setForm(p=>({...p,data:e.target.value}))}
                style={{ width:'100%', padding:'8px', border:'1px solid #e2e8f0', borderRadius:7, fontSize:12, boxSizing:'border-box' }}/>
            </div>
            <div>
              <label style={{ fontSize:10, fontWeight:700, color:'#64748b', display:'block', marginBottom:4 }}>TIPO</label>
              <select value={form.tipo} onChange={e=>setForm(p=>({...p,tipo:e.target.value}))}
                style={{ width:'100%', padding:'8px', border:'1px solid #e2e8f0', borderRadius:7, fontSize:12, boxSizing:'border-box', background:form.tipo==='entrada'?'#f0fdf4':'#fef2f2', fontWeight:700, color:form.tipo==='entrada'?'#16a34a':'#dc2626' }}>
                <option value="saida">Saída (−)</option>
                <option value="entrada">Entrada (+)</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize:10, fontWeight:700, color:'#64748b', display:'block', marginBottom:4 }}>CATEGORIA</label>
              <select value={form.categoria} onChange={e=>setForm(p=>({...p,categoria:e.target.value}))}
                style={{ width:'100%', padding:'8px', border:'1px solid #e2e8f0', borderRadius:7, fontSize:12, boxSizing:'border-box' }}>
                {CAT_LANC.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:10, fontWeight:700, color:'#64748b', display:'block', marginBottom:4 }}>VALOR (R$)</label>
              <input type="number" value={form.valor} onChange={e=>setForm(p=>({...p,valor:e.target.value}))} placeholder="0,00"
                style={{ width:'100%', padding:'8px', border:'1px solid #e2e8f0', borderRadius:7, fontSize:12, boxSizing:'border-box' }}/>
            </div>
            <button onClick={adicionar} style={{ padding:'8px 14px', background:'#0D63DB', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:13, cursor:'pointer', whiteSpace:'nowrap', height:36 }}>
              + Lançar
            </button>
          </div>
          <div style={{ marginTop:8 }}>
            <input value={form.descricao} onChange={e=>setForm(p=>({...p,descricao:e.target.value}))} placeholder="Descrição (opcional)"
              style={{ width:'100%', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:7, fontSize:12, boxSizing:'border-box' }}/>
          </div>
        </div>

        {/* Lista de lançamentos */}
        <div style={{ padding:'16px 22px', maxHeight:320, overflowY:'auto' }}>
          {lancamentos.length === 0 ? (
            <div style={{ textAlign:'center', padding:'30px', color:'#94a3b8', fontSize:13 }}>Nenhum lançamento registrado</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {[...lancamentos].reverse().map((l,i)=>(
                <div key={l.id||i} style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 12px', background:i%2===0?'#f8fafc':'white', borderRadius:8 }}>
                  {l.tipo==='entrada'
                    ? <ArrowUpCircle size={16} color="#10b981" style={{flexShrink:0}}/>
                    : <ArrowDownCircle size={16} color="#ef4444" style={{flexShrink:0}}/>}
                  <span style={{ fontSize:11, color:'#64748b', flexShrink:0, width:80 }}>{l.data}</span>
                  <span style={{ fontSize:11, color:'#475569', fontWeight:600, flexShrink:0, width:120 }}>{l.categoria}</span>
                  <span style={{ fontSize:12, color:'#334155', flex:1 }}>{l.descricao}</span>
                  <span style={{ fontSize:13, fontWeight:700, color:l.tipo==='entrada'?'#10b981':'#ef4444', flexShrink:0, width:100, textAlign:'right' }}>
                    {l.tipo==='entrada'?'+ ':'- '}R$ {fmt(l.valor)}
                  </span>
                  <button onClick={()=>remover(l.id)} style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', padding:2, flexShrink:0 }}>
                    <Trash2 size={12}/>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Painel() {
  const nav = useNavigate();
  const _loc = useLocation();
  const _abaInicial = _loc.state?.aba || (new URLSearchParams(_loc.search).get('aba')) || 'analise';
  const isMobile = useIsMobile();
  const { user, role } = useAuth();
  const isAnalista = ROLES_ANALISTA.includes(role);
  const [imoveis, setImoveis] = useState([]);
  const [aba, setAba] = useState(_abaInicial);
  const [imovelLancamentos, setImovelLancamentos] = useState(null);
  const [controleAberto, setControleAberto] = useState(null);
  const [agendando, setAgendando] = useState(null);
  const [dataAgenda, setDataAgenda] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [novoLanc, setNovoLanc] = useState({ data: new Date().toISOString().slice(0,10), tipo:'saida', categoria:'Outros', imovelId:'', descricao:'', valor:'' });

  // Supabase state for Em Análise workflow
  const [solicitacoes, setSolicitacoes] = useState([]); // do próprio user (ou todas, se analista)
  const [agendamentos, setAgendamentos] = useState([]); // idem
  const [todasSolics, setTodasSolics] = useState([]);   // analista: todos os clientes
  const [todosAgends, setTodosAgends] = useState([]);   // analista: todos os clientes
  const [loadingAnalise, setLoadingAnalise] = useState(false);
  const [proximasReunioes, setProximasReunioes] = useState([]);

  useEffect(() => { setImoveis(loadImoveis()); }, []);

  const carregarAnalise = useCallback(async () => {
    if (!user) return;
    setLoadingAnalise(true);
    try {
      // `error` checado nas TRÊS: dentro de um Promise.all um 400 vira `undefined` e o `|| []`
      // o transforma em "não há nada" — foi assim que o card de reuniões sumiu sem sintoma
      // quando `reuniao_em` ainda não existia na tabela (11–12/08).
      const [{ data: solics, error: e1 }, { data: agends, error: e2 }, { data: reunioes, error: e3 }] = await Promise.all([
        supabase.from('solicitacoes').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('agendamentos').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
        supabase.from('solicitacoes').select('id,imovel_nome,imovel_cidade,reuniao_em,reuniao_duracao_min,google_meet_link')
          .eq('user_id', user.id).not('reuniao_em', 'is', null).not('google_meet_link', 'is', null)
          .gte('reuniao_em', new Date().toISOString()).order('reuniao_em', { ascending: true }).limit(5),
      ]);
      // Lista vazia por FALHA deixa rastro em `erros_cliente` — o mesmo canal que o ritual
      // de abertura lê todo dia. Sem isso, "o cliente não tem reunião marcada" e "a consulta
      // quebrou" são indistinguíveis na tela e no banco.
      const falha = e1 || e2 || e3;
      if (falha) reportarErroCliente({ msg: `painel/analise: ${falha.message}` });

      setSolicitacoes(solics || []);
      setAgendamentos(agends || []);
      setProximasReunioes(reunioes || []);

      if (isAnalista) {
        const [{ data: ts }, { data: ta }] = await Promise.all([
          supabase.from('solicitacoes').select('*').neq('user_id', user.id).in('status', ['solicitado','em_andamento']).order('created_at', { ascending: false }),
          supabase.from('agendamentos').select('*').neq('user_id', user.id).in('status', ['solicitado','confirmado']).order('created_at', { ascending: false }),
        ]);
        // Busca nomes dos clientes
        const allUserIds = [...new Set([...(ts||[]), ...(ta||[])].map(r => r.user_id))];
        let perfisMapa = {};
        if (allUserIds.length > 0) {
          const { data: ps } = await supabase.from('perfis').select('id,nome').in('id', allUserIds);
          (ps||[]).forEach(p => { perfisMapa[p.id] = p.nome; });
        }
        setTodasSolics((ts||[]).map(r => ({ ...r, cliente_nome: perfisMapa[r.user_id] || r.user_id.slice(0,8) })));
        setTodosAgends((ta||[]).map(r => ({ ...r, cliente_nome: perfisMapa[r.user_id] || r.user_id.slice(0,8) })));
      }
    } finally {
      setLoadingAnalise(false);
    }
  }, [user, isAnalista]);

  useEffect(() => { carregarAnalise(); }, [carregarAnalise]);

  const atualizarImovel = (imAtualizado) => {
    const updated = imoveis.map(i => i.id===imAtualizado.id ? imAtualizado : i);
    setImoveis(updated);
    saveImoveis(updated);
  };

  // Remoção explícita do portfólio também limpa os relatórios salvos no servidor.
  // (A regra automática de não-arrematação — 15 dias após o leilão sem arrematar —
  // fica a cargo do cron limpar-analises-cron.)
  const excluir = (id) => {
    if (!confirm('Remover do portfólio? Os relatórios de análise deste imóvel também serão apagados.')) return;
    const updated = imoveis.filter(i=>i.id!==id);
    setImoveis(updated);
    saveImoveis(updated);
    if (id && user?.id) {
      supabase.from('analises_mercado').delete().eq('user_id', user.id).eq('imovel_id', String(id)).then(()=>{}).catch(()=>{});
      supabase.from('analises_documental').delete().eq('user_id', user.id).eq('imovel_id', String(id)).then(()=>{}).catch(()=>{});
    }
  };

  const alterarStatus = (id, status) => {
    const updated = imoveis.map(i=>i.id===id?{...i,status,updatedAt:new Date().toISOString()}:i);
    setImoveis(updated);
    saveImoveis(updated);
    // Arrematou → marca a análise como arrematada (NUNCA é apagada pelo cron).
    if (id && user?.id) {
      const arrematou = ['arrematado','em_reforma','venda','alugado','concluido'].includes(status);
      if (arrematou) {
        supabase.from('analises_mercado').update({ arrematado: true }).eq('user_id', user.id).eq('imovel_id', String(id)).then(()=>{}).catch(()=>{});
        supabase.from('analises_documental').update({ arrematado: true }).eq('user_id', user.id).eq('imovel_id', String(id)).then(()=>{}).catch(()=>{});
      }
    }
  };

  const adicionarLancamento = () => {
    if (!novoLanc.valor || !novoLanc.imovelId) return;
    const im = imoveis.find(i=>i.id===novoLanc.imovelId);
    if (!im) return;
    const lanc = { ...novoLanc, id: Date.now(), valor: Number(novoLanc.valor) };
    const updated = { ...im, lancamentosFinanceiros: [...(im.lancamentosFinanceiros||[]), lanc] };
    atualizarImovel(updated);
    setNovoLanc(p => ({ ...p, descricao:'', valor:'' }));
  };

  const removerLancamento = (imovelId, lancId) => {
    const im = imoveis.find(i=>i.id===imovelId);
    if (!im) return;
    const updated = { ...im, lancamentosFinanceiros: (im.lancamentosFinanceiros||[]).filter(l=>l.id!==lancId) };
    atualizarImovel(updated);
  };

  // ── Workflow "Em Análise" (Supabase) ──
  const solicitarAvaliacao = async (im, tipo) => {
    const av = AVALIACOES.find(a => a.key === tipo);
    if (av?.via === 'analise') { nav('/analise', { state:{ imovel:im } }); return; }
    // Processual: registra no Supabase com prazo de 24h
    const prazoAte = new Date(Date.now() + 24*3600*1000).toISOString();
    const { error } = await supabase.from('solicitacoes').insert({
      user_id: user.id,
      imovel_ref: im.id,
      imovel_nome: im.nome || im.endereco || 'Imóvel',
      imovel_cidade: im.cidade || '',
      tipo,
      status: 'em_andamento',
      prazo_ate: prazoAte,
    });
    if (!error) carregarAnalise();
    else alert('Erro ao solicitar avaliação. Tente novamente.');
  };

  const agendarAnalista = async (im) => {
    if (!dataAgenda) return;
    const dias = diasAteLeilao(im.dataLeilao);
    if (im.dataLeilao) {
      const dAgenda = new Date(dataAgenda);
      const dLeilao = new Date(im.dataLeilao);
      if (Math.ceil((dLeilao - dAgenda) / 86400000) < 7) {
        alert('A reunião deve ser agendada com no mínimo 7 dias de antecedência do leilão.'); return;
      }
    }
    if (dias != null && dias < 7) { alert('Este leilão ocorre em menos de 7 dias — não é possível agendar aprovação com analista.'); return; }

    // Upsert: cancela agendamento anterior do mesmo imóvel e cria novo
    const agExistente = agendamentos.find(a => a.imovel_ref === im.id && a.status === 'solicitado');
    if (agExistente) {
      await supabase.from('agendamentos').update({ status:'cancelado', updated_at: new Date().toISOString() }).eq('id', agExistente.id);
    }
    const { error } = await supabase.from('agendamentos').insert({
      user_id: user.id,
      imovel_ref: im.id,
      imovel_nome: im.nome || im.endereco || 'Imóvel',
      imovel_cidade: im.cidade || '',
      data_agendamento: dataAgenda,
      status: 'solicitado',
    });
    if (!error) { carregarAnalise(); setAgendando(null); setDataAgenda(''); }
    else alert('Erro ao agendar. Tente novamente.');
  };

  const aprovarEncaminhar = async (agendId) => {
    if (!confirm('Aprovar a análise e encaminhar ao jurídico?')) return;
    const { error } = await supabase.from('agendamentos').update({
      status: 'encaminhado_juridico',
      aprovado_por: user.id,
      aprovado_em: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', agendId);
    if (!error) carregarAnalise();
    else alert('Erro ao aprovar. Tente novamente.');
  };

  // Cálculos por imóvel
  const calcImovel = (im) => {
    const lancs = im.lancamentosFinanceiros || [];
    const entradas = lancs.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+Number(l.valor),0);
    const saidas   = lancs.filter(l=>l.tipo==='saida').reduce((s,l)=>s+Number(l.valor),0);
    const vendaReal = lancs.filter(l=>l.categoria==='Venda').reduce((s,l)=>s+Number(l.valor),0);
    const totalInvestido = saidas || Number(im.valorArrematacao||0);
    const projecaoVenda = Number(im.valorMercado||0) * 0.9;
    const roiReal = vendaReal > 0 && totalInvestido > 0 ? ((vendaReal - totalInvestido) / totalInvestido * 100) : null;
    const roiProj = projecaoVenda > 0 && totalInvestido > 0 ? ((projecaoVenda - totalInvestido) / totalInvestido * 100) : null;
    return { entradas, saidas, vendaReal, totalInvestido, projecaoVenda, roiReal, roiProj };
  };

  // Todos os lançamentos com referência ao imóvel
  const todosLancamentos = imoveis.flatMap(im =>
    (im.lancamentosFinanceiros||[]).map(l => ({ ...l, imovelNome: im.nome || im.endereco || 'Imóvel', imovelId: im.id }))
  ).sort((a,b) => (b.data||'').localeCompare(a.data||''));

  const totalEntradas = todosLancamentos.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+Number(l.valor),0);
  const totalSaidas   = todosLancamentos.filter(l=>l.tipo==='saida').reduce((s,l)=>s+Number(l.valor),0);

  // Lançamentos agrupados por imóvel (para a aba financeira e o PDF)
  const lancamentosPorImovel = imoveis
    .map(im => ({ id: im.id, nome: im.nome || im.endereco || 'Imóvel', cidade: im.cidade, lancamentos: [...(im.lancamentosFinanceiros||[])].sort((a,b)=>(b.data||'').localeCompare(a.data||'')) }))
    .filter(g => g.lancamentos.length > 0);

  const imprimirAnalise = (im) => {
    const w = window.open('', '_blank');
    const data = new Date().toLocaleDateString('pt-BR');
    w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head>
      <meta charset="UTF-8"/><title>Relatório — ${im.nome||'Imóvel'}</title>
      <style>
        body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 30px;color:#1a1a1a;line-height:1.7}
        h1{font-size:22px;font-weight:bold;border-bottom:2px solid #111111;padding-bottom:10px;margin-bottom:6px}
        h2{font-size:15px;font-weight:bold;margin:24px 0 6px;color:#334155;text-transform:uppercase;letter-spacing:.5px}
        .meta{font-size:12px;color:#64748b;margin-bottom:24px}
        .corpo{white-space:pre-wrap;font-size:14px;line-height:1.85}
        .rodape{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center}
        @media print{body{margin:20px}}
      </style>
    </head><body>
      <h1>Relatório de Análise</h1>
      <div class="meta">
        ${im.nome||'Imóvel sem nome'}${im.cidade?` · ${im.cidade}`:''}${im.estado?`/${im.estado}`:''}
        ${im.dataLeilao ? ` · Leilão: ${new Date(im.dataLeilao).toLocaleDateString('pt-BR')}` : ''}
        · Gerado em ${data}
      </div>
      ${im.parecer ? `<h2>Parecer e Viabilidade</h2><div class="corpo">${im.parecer.replace(/</g,'&lt;')}</div>` : ''}
      ${im.mercado ? `<h2>Dados de Mercado</h2><div class="corpo">${im.mercado.replace(/</g,'&lt;')}</div>` : ''}
      <div class="rodape">BidPro Brasil · Relatório gerado em ${data}</div>
      <script>window.onload=()=>{window.print();}</script>
    </body></html>`);
    w.document.close();
  };

  const exportarPDFFinanceiro = () => {
    if (lancamentosPorImovel.length === 0) { alert('Nenhum lançamento para exportar.'); return; }
    gerarPDFFinanceiro({ grupos: lancamentosPorImovel, totalEntradas, totalSaidas });
  };

  // Imóveis em fluxo de análise — enriquecidos com dados do Supabase
  const emAnalise = imoveis
    .filter(im => ['analise','aprovado','reprovado'].includes(im.status || 'analise'))
    .map(im => ({
      ...im,
      _solics: solicitacoes.filter(s => s.imovel_ref === im.id),
      _agend: agendamentos.find(a => a.imovel_ref === im.id && a.status !== 'cancelado'),
    }));

  // Imóveis arrematados (e posteriores)
  const arrematados = imoveis.filter(im => ['arrematado','em_reforma','venda','alugado','concluido'].includes(im.status));

  const filtrados = imoveis.filter(im => !filtroStatus || im.status===filtroStatus);

  const marcarArrematado = (im) => {
    if (!confirm('Confirmar arrematação deste imóvel? Você vai para "Meus Arrematados" para registrar e anexar os documentos (auto/carta, contrato do banco, escritura, matrícula registrada).')) return;
    alterarStatus(im.id, 'arrematado');
    // Direciona para a tela de arrematados com o imóvel pré-preenchido — lá o
    // cliente confirma o registro e anexa os documentos do arremate.
    nav('/arrematados', { state: { prefill: {
      titulo: im.nome || im.titulo || '', cidade: im.cidade || '', estado: im.estado || '',
      // SÓ o uuid do acervo. `im.id` é o id LOCAL do portfólio (`tsn_…`) e ia direto para
      // `arrematados.imovel_id`, coluna TEXT que o aceitava e depois não casava com nenhuma
      // tabela de verdade. Sem uuid, vai `null` — e o Arrematados cria a âncora certa via
      // /api/arrematado-ancora, que é exatamente o caminho previsto para lote fora do acervo.
      valor: im.valorArrematacao || im.valorMinimo || '', imovelId: im.imovelIdAcervo || null,
      imovel: im, modalidade: /judicial/i.test(im.modalidade || '') && !/extra/i.test(im.modalidade || '') ? 'judicial' : 'extrajudicial',
    } } });
  };

  const tabBtn = (id, label) => (
    <button onClick={()=>setAba(id)}
      style={{ padding:'10px 20px', border:'none', background: aba===id ? '#111111' : 'transparent', color: aba===id ? 'white' : '#64748b', fontWeight:700, fontSize:14, cursor:'pointer', borderRadius: aba===id ? '10px 10px 0 0' : '10px 10px 0 0', borderBottom: aba===id ? 'none' : '2px solid #e2e8f0' }}>
      {label}
    </button>
  );

  const inp2 = { padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:7, fontSize:12, background:'white', boxSizing:'border-box' };

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding: isMobile ? '16px 12px' : '24px 20px' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ margin:0, fontSize:24, fontWeight:900, color:'#111111' }}>Meu Portfólio</h1>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'#64748b' }}>{imoveis.length} imóvel(is) · {todosLancamentos.length} lançamentos</p>
        </div>
        <button onClick={()=>nav('/buscar')}
          style={{ padding:'10px 18px', background:'#0D63DB', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
          + Buscar Leilões
        </button>
      </div>

      {/* KPIs rápidos */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginBottom:20 }}>
        {[
          { l:'Imóveis', v: imoveis.length, c:'#0D63DB', bg:'#eff6ff' },
          { l:'Total Investido', v:`R$ ${fmt(imoveis.reduce((s,i)=>s+Number(i.valorArrematacao||0),0),0)}`, c:'#ef4444', bg:'#fef2f2' },
          { l:'Entradas', v:`R$ ${fmt(totalEntradas)}`, c:'#10b981', bg:'#f0fdf4' },
          { l:'Saídas', v:`R$ ${fmt(totalSaidas)}`, c:'#f59e0b', bg:'#fffbeb' },
          { l:'Saldo Real', v:`R$ ${fmt(totalEntradas-totalSaidas)}`, c:(totalEntradas-totalSaidas)>=0?'#10b981':'#ef4444', bg:(totalEntradas-totalSaidas)>=0?'#f0fdf4':'#fef2f2' },
        ].map(k=>(
          <div key={k.l} style={{ background:k.bg, borderRadius:12, padding:'14px 16px', border:`1px solid ${k.c}20` }}>
            <div style={{ fontSize:11, fontWeight:700, color:k.c, textTransform:'uppercase', marginBottom:4 }}>{k.l}</div>
            <div style={{ fontSize:18, fontWeight:900, color:'#111111' }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e2e8f0', marginBottom:0, overflowX:'auto', WebkitOverflowScrolling:'touch' }}>
        {tabBtn('analise', isMobile ? `🔎 Análise (${emAnalise.length})` : `🔎 Em Análise (${emAnalise.length})`)}
        {tabBtn('arrematacoes', isMobile ? `🏠 Arrem. (${arrematados.length})` : `🏠 Arrematação (${arrematados.length})`)}
        {tabBtn('lancamentos', isMobile ? `💰 Lançam. (${todosLancamentos.length})` : `💰 Lançamentos (${todosLancamentos.length})`)}
      </div>

      {/* === ABA ARREMATAÇÃO === */}
      {aba==='arrematacoes' && (
        <div style={{ background:'white', borderRadius:'0 12px 12px 12px', border:'1px solid #e2e8f0', borderTop:'none', overflow:'hidden' }}>
          {arrematados.length === 0 ? (
            <div style={{ textAlign:'center', padding:'70px 20px' }}>
              <div style={{ fontSize:48, marginBottom:16 }}>🏠</div>
              <h3 style={{ color:'#334155', fontWeight:900, margin:'0 0 8px' }}>Nenhum imóvel arrematado ainda</h3>
              <p style={{ color:'#94a3b8', marginBottom:24, fontSize:14 }}>Na aba "Em Análise", clique em <strong>✅ Arrematei!</strong> para mover um imóvel para cá.</p>
              <button onClick={()=>setAba('analise')} style={{ background:'#0D63DB', color:'white', border:'none', borderRadius:10, padding:'11px 24px', fontWeight:700, cursor:'pointer' }}>
                Ver Em Análise
              </button>
            </div>
          ) : (
            <div>
              {/* Indicadores — média dos RESULTADOS das operações REALIZADAS (vendidas).
                  Só conta o que tem resultado de fato; projeções não entram. */}
              {(() => {
                const realizadas = arrematados.map(calcImovel).filter(c => c.roiReal !== null && c.vendaReal > 0);
                const n = realizadas.length;
                const lucroTotal = realizadas.reduce((s,c)=>s+(c.vendaReal - c.totalInvestido), 0);
                const roiMedio = n ? realizadas.reduce((s,c)=>s+c.roiReal,0)/n : 0;
                const lucroMedio = n ? lucroTotal/n : 0;
                const investido = realizadas.reduce((s,c)=>s+c.totalInvestido, 0);
                if (!n) return (
                  <div style={{ padding:'14px 18px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0', fontSize:12, color:'#64748b' }}>
                    📊 Os indicadores de resultado aparecem aqui quando você registrar a <strong>venda</strong> de uma operação (em "Lançamentos").
                  </div>
                );
                const cards = [
                  { l:'Operações realizadas', v:String(n), c:'#0D63DB', bg:'#eff6ff' },
                  { l:'ROI médio realizado', v:`${roiMedio.toFixed(1)}%`, c: roiMedio>=0?'#059669':'#dc2626', bg: roiMedio>=0?'#f0fdf4':'#fef2f2' },
                  { l:'Lucro líquido médio', v:`R$ ${fmt(lucroMedio,0)}`, c: lucroMedio>=0?'#059669':'#dc2626', bg: lucroMedio>=0?'#f0fdf4':'#fef2f2' },
                  { l:'Lucro total realizado', v:`R$ ${fmt(lucroTotal,0)}`, c: lucroTotal>=0?'#059669':'#dc2626', bg:'#f8fafc' },
                  { l:'Capital investido (realizadas)', v:`R$ ${fmt(investido,0)}`, c:'#7c3aed', bg:'#faf5ff' },
                ];
                return (
                  <div style={{ display:'grid', gridTemplateColumns: isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)', gap:10, padding:'16px 18px', borderBottom:'1px solid #e2e8f0' }}>
                    {cards.map(k => (
                      <div key={k.l} style={{ background:k.bg, borderRadius:10, padding:'12px 14px' }}>
                        <div style={{ fontSize:18, fontWeight:900, color:k.c }}>{k.v}</div>
                        <div style={{ fontSize:10.5, color:'#64748b', marginTop:2, lineHeight:1.3 }}>{k.l}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                    {['Imóvel','Cidade / Bairro','Status','Val. Arrematação','Total Desembolsado','Entrada (Venda)','ROI','Ações'].map(h=>(
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontWeight:700, color:'#475569', fontSize:11, textTransform:'uppercase', letterSpacing:0.5, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {arrematados.map((im,i) => {
                    const c = calcImovel(im);
                    const totalDesembolsado = c.saidas || Number(im.valorArrematacao||0);
                    const entradaVenda = c.vendaReal;
                    const roi = entradaVenda > 0 && totalDesembolsado > 0
                      ? ((entradaVenda - totalDesembolsado) / totalDesembolsado * 100) : null;
                    return (
                      <tr key={im.id} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                        <td style={{ padding:'12px 14px' }}>
                          <div style={{ fontWeight:700, color:'#111111', fontSize:13 }}>{im.nome||'Sem nome'}</div>
                        </td>
                        <td style={{ padding:'12px 14px', fontSize:12, color:'#64748b' }}>
                          {[im.cidade, im.bairro, im.estado].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          <select value={im.status} onChange={e=>alterarStatus(im.id,e.target.value)}
                            style={{ fontSize:11, fontWeight:700, border:`1px solid ${STATUS_CONFIG[im.status]?.c||'#e2e8f0'}`, borderRadius:20, padding:'4px 10px', background:STATUS_CONFIG[im.status]?.bg||'#f1f5f9', color:STATUS_CONFIG[im.status]?.c||'#64748b', cursor:'pointer' }}>
                            {Object.entries(STATUS_CONFIG).map(([v,s])=><option key={v} value={v}>{s.l}</option>)}
                          </select>
                        </td>
                        <td style={{ padding:'12px 14px', fontWeight:800, color:'#111111' }}>
                          R$ {fmt(Number(im.valorArrematacao||0))}
                        </td>
                        <td style={{ padding:'12px 14px', fontWeight:700, color:'#ef4444' }}>
                          R$ {fmt(totalDesembolsado)}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          {entradaVenda > 0
                            ? <span style={{ fontWeight:800, color:'#10b981' }}>R$ {fmt(entradaVenda)}</span>
                            : <span style={{ color:'#cbd5e1', fontSize:12 }}>Não vendido</span>}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          {roi != null
                            ? <span style={{ fontWeight:900, fontSize:15, color:roi>=40?'#10b981':roi>=0?'#f59e0b':'#ef4444' }}>{fmtPct(roi)}</span>
                            : <span style={{ color:'#cbd5e1', fontSize:12 }}>—</span>}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          <div style={{ display:'flex', gap:6 }}>
                            <button onClick={()=>setControleAberto(im)}
                              style={{ padding:'6px 10px', background:'#f0fdf4', color:'#10b981', border:'1px solid #bbf7d0', borderRadius:7, fontWeight:700, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>
                              💰 Lançar
                            </button>
                            <button onClick={()=>excluir(im.id)}
                              style={{ padding:'6px 8px', background:'#fef2f2', color:'#ef4444', border:'1px solid #fecaca', borderRadius:7, cursor:'pointer' }}>
                              <Trash2 size={13}/>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </div>
          )}
        </div>
      )}

      {/* === ABA EM ANÁLISE === */}
      {aba==='analise' && (
        <div style={{ background:'white', borderRadius:'0 12px 12px 12px', border:'1px solid #e2e8f0', borderTop:'none', overflow:'hidden' }}>

          {/* Próximas Reuniões do cliente */}
          {proximasReunioes.length > 0 && (
            <div style={{ borderBottom:'2px solid #e2e8f0', padding:'18px', background:'#eff6ff' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
                <CalendarClock size={16} color="#0D63DB"/>
                <span style={{ fontWeight:900, fontSize:14, color:'#084BA6' }}>Próximas Reuniões</span>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {proximasReunioes.map(r => {
                  const dataHora = new Date(r.reuniao_em).toLocaleString('pt-BR', {
                    weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo',
                  });
                  return (
                    <div key={r.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'14px 16px', background:'white', borderRadius:12, border:'1px solid #bfdbfe', flexWrap:'wrap' }}>
                      <div>
                        <div style={{ fontWeight:700, color:'#111111', fontSize:14 }}>{r.imovel_nome || 'Imóvel'}{r.imovel_cidade ? ` — ${r.imovel_cidade}` : ''}</div>
                        <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                          📅 <strong style={{ textTransform:'capitalize' }}>{dataHora}</strong> · {r.reuniao_duracao_min || 30} min
                        </div>
                      </div>
                      <a href={r.google_meet_link} target="_blank" rel="noreferrer"
                        style={{ padding:'9px 18px', background:'#0D63DB', color:'white', borderRadius:9, fontWeight:700, fontSize:13, textDecoration:'none', whiteSpace:'nowrap' }}>
                        📹 Entrar na Reunião
                      </a>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Painel do analista: solicitações e agendamentos de outros usuários */}
          {isAnalista && (todasSolics.length > 0 || todosAgends.length > 0) && (
            <div style={{ borderBottom:'2px solid #e2e8f0', padding:'18px', background:'#f0fdf4' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
                <Users size={16} color="#10b981"/>
                <span style={{ fontWeight:900, fontSize:14, color:'#065f46' }}>Fila de Clientes</span>
                <span style={{ fontSize:11, color:'#64748b' }}>— solicitações e reuniões pendentes de aprovação</span>
              </div>

              {todosAgends.length > 0 && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:8 }}>Agendamentos pendentes</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {todosAgends.map(ag => (
                      <div key={ag.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, padding:'12px 16px', background:'white', borderRadius:10, border:'1px solid #d1fae5', flexWrap:'wrap' }}>
                        <div>
                          <div style={{ fontWeight:700, color:'#111111', fontSize:13 }}>{ag.imovel_nome}</div>
                          <div style={{ fontSize:12, color:'#64748b' }}>
                            {ag.imovel_cidade && <>{ag.imovel_cidade} · </>}
                            Cliente: <strong>{ag.cliente_nome}</strong> · Reunião em{' '}
                            <strong>{new Date(ag.data_agendamento + 'T00:00:00').toLocaleDateString('pt-BR')}</strong>
                          </div>
                        </div>
                        <button onClick={() => aprovarEncaminhar(ag.id)}
                          style={{ padding:'8px 14px', background:'#10b981', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6, whiteSpace:'nowrap' }}>
                          <ShieldCheck size={14}/> Aprovar e encaminhar ao jurídico
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {todasSolics.length > 0 && (
                <div>
                  <div style={{ fontSize:11, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:8 }}>Avaliações em andamento</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {todasSolics.map(s => (
                      <div key={s.id} style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 16px', background:'white', borderRadius:10, border:'1px solid #e2e8f0', flexWrap:'wrap' }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:20, background:'#fef3c7', color:'#92400e' }}>
                          {AVALIACOES.find(a=>a.key===s.tipo)?.label || TIPO_LABEL_EXTRA[s.tipo] || s.tipo}
                        </span>
                        <span style={{ fontSize:13, fontWeight:700, color:'#111111' }}>{s.imovel_nome}</span>
                        {s.imovel_cidade && <span style={{ fontSize:12, color:'#64748b' }}>{s.imovel_cidade}</span>}
                        <span style={{ fontSize:12, color:'#64748b' }}>Cliente: <strong>{s.cliente_nome}</strong></span>
                        {s.prazo_ate && <span style={{ fontSize:11, color:'#f59e0b' }}>Prazo: {new Date(s.prazo_ate).toLocaleString('pt-BR')}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Imóveis do próprio usuário em análise */}
          {emAnalise.length === 0 ? (
            <div style={{ textAlign:'center', padding:'70px 20px' }}>
              <div style={{ fontSize:48, marginBottom:16 }}>🔎</div>
              <h3 style={{ color:'#334155', fontWeight:900, margin:'0 0 8px' }}>Nenhum imóvel em análise</h3>
              <p style={{ color:'#94a3b8', marginBottom:24, fontSize:14 }}>Na busca de leilões, clique em <strong>Analisar</strong> para trazer um imóvel para cá.</p>
              <button onClick={()=>nav('/buscar')} style={{ background:'#0D63DB', color:'white', border:'none', borderRadius:10, padding:'11px 24px', fontWeight:700, cursor:'pointer' }}>
                Buscar Leilões
              </button>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:16, padding:'18px' }}>
              {emAnalise.map(im => {
                const dias = diasAteLeilao(im.dataLeilao);
                const ag = im._agend;
                const podeAgendar = dias == null || dias >= 7;
                return (
                  <div key={im.id} style={{ border:'1px solid #e2e8f0', borderRadius:14, overflow:'hidden' }}>
                    {/* Cabeçalho do imóvel */}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, padding:'14px 18px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0', flexWrap:'wrap' }}>
                      <div>
                        <div style={{ fontWeight:800, color:'#111111', fontSize:15 }}>{im.nome||'Sem nome'}</div>
                        <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>
                          {im.cidade}{im.estado?`, ${im.estado}`:''}
                          {im.dataLeilao && <> · Leilão {dias!=null ? (dias>=0?`em ${dias} dia(s)`:'já ocorrido') : ''}</>}
                        </div>
                      </div>
                      <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                        <BadgeStatus status={im.status||'analise'}/>
                        {im.parecer && (
                          <button onClick={() => imprimirAnalise(im)}
                            style={{ padding:'7px 14px', background:'#f1f5f9', color:'#475569', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                            <Printer size={13}/> Relatório
                          </button>
                        )}
                        <button onClick={()=>nav('/analise',{state:{imovel:im}})}
                          style={{ padding:'7px 14px', background:'#111111', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                          <Sparkles size={13}/> Abrir análise
                        </button>
                        <button onClick={()=>marcarArrematado(im)}
                          style={{ padding:'7px 14px', background:'#10b981', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                          ✅ Arrematei!
                        </button>
                      </div>
                    </div>

                    {/* Cards das 3 avaliações */}
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12, padding:'16px 18px' }}>
                      {AVALIACOES.map(av => {
                        const solic = im._solics?.find(s => s.tipo === av.key);
                        const stt = statusAvaliacao(solic);
                        const Icon = av.icon;
                        return (
                          <div key={av.key} style={{ border:`1px solid ${av.cor}30`, borderRadius:12, padding:'14px', background:av.bg, display:'flex', flexDirection:'column', gap:8 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                              <div style={{ width:30, height:30, borderRadius:8, background:av.cor, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                                <Icon size={15} color="white"/>
                              </div>
                              <span style={{ fontSize:12.5, fontWeight:800, color:'#111111', lineHeight:1.25 }}>{av.label}</span>
                            </div>
                            <p style={{ margin:0, fontSize:11, color:'#64748b', lineHeight:1.5, minHeight:46 }}>{av.desc}</p>
                            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:6 }}>
                              <span style={{ background:stt.bg, color:stt.c, fontSize:10, fontWeight:800, padding:'3px 9px', borderRadius:20, display:'inline-flex', alignItems:'center', gap:4 }}>
                                {stt.st==='em_andamento' ? <Hourglass size={10}/> : stt.st==='concluido' ? <CheckCircle2 size={10}/> : <Clock size={10}/>}
                                {stt.l}
                              </span>
                              <button onClick={()=>solicitarAvaliacao(im, av.key)} disabled={stt.st==='em_andamento'}
                                style={{ padding:'6px 12px', background:stt.st==='em_andamento'?'#e2e8f0':av.cor, color:stt.st==='em_andamento'?'#94a3b8':'white', border:'none', borderRadius:7, fontWeight:700, fontSize:11, cursor:stt.st==='em_andamento'?'default':'pointer', whiteSpace:'nowrap' }}>
                                {stt.st==='em_andamento' ? 'Aguarde 24h' : stt.st==='concluido' ? 'Ver laudo' : 'Solicitar'}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Faixa de agendamento / aprovação */}
                    <div style={{ padding:'14px 18px', borderTop:'1px solid #f1f5f9', background:'#fcfcfd', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, fontSize:12, color:'#475569' }}>
                        <CalendarClock size={16} color="#0D63DB"/>
                        {ag?.status === 'encaminhado_juridico' ? (
                          <span style={{ color:'#10b981', fontWeight:700 }}>✓ Aprovado e encaminhado ao jurídico</span>
                        ) : ag?.status === 'solicitado' ? (
                          <span>Reunião com analista agendada para <strong>{new Date(ag.data_agendamento + 'T00:00:00').toLocaleDateString('pt-BR')}</strong> · aguardando aprovação</span>
                        ) : (
                          <span>Agende uma reunião com o analista para aprovação (mín. 7 dias antes do leilão).</span>
                        )}
                      </div>

                      <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                        {/* Analistas vendo imóveis próprios também podem aprovar */}
                        {isAnalista && ag?.status === 'solicitado' && (
                          <button onClick={()=>aprovarEncaminhar(ag.id)}
                            style={{ padding:'8px 14px', background:'#10b981', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                            <ShieldCheck size={14}/> Aprovar e encaminhar ao jurídico
                          </button>
                        )}
                        {ag?.status !== 'encaminhado_juridico' && agendando === im.id ? (
                          <>
                            <input type="date" value={dataAgenda} onChange={e=>setDataAgenda(e.target.value)}
                              style={{ ...inp2, padding:'7px 10px' }}/>
                            <button onClick={()=>agendarAnalista(im)}
                              style={{ padding:'8px 14px', background:'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                              Confirmar
                            </button>
                            <button onClick={()=>{setAgendando(null);setDataAgenda('');}}
                              style={{ padding:'8px 10px', background:'transparent', color:'#64748b', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, cursor:'pointer' }}>
                              Cancelar
                            </button>
                          </>
                        ) : ag?.status !== 'encaminhado_juridico' && (
                          <button onClick={()=>{ if(!podeAgendar){alert('Este leilão ocorre em menos de 7 dias — não é possível agendar.');return;} setAgendando(im.id); setDataAgenda(''); }}
                            style={{ padding:'8px 14px', background:'white', color:'#0D63DB', border:'2px solid #bfdbfe', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', opacity:podeAgendar?1:0.5 }}>
                            {ag?.status === 'solicitado' ? 'Reagendar' : 'Agendar com analista'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* === ABA LANÇAMENTOS === */}
      {aba==='lancamentos' && imovelLancamentos && (
        <ControleFinanceiro
          im={imovelLancamentos}
          onClose={()=>setImovelLancamentos(null)}
          onUpdate={(imAtualizado)=>{ atualizarImovel(imAtualizado); setImovelLancamentos(imAtualizado); }}
        />
      )}

      {aba==='lancamentos' && !imovelLancamentos && (
        <div style={{ background:'white', borderRadius:'0 12px 12px 12px', border:'1px solid #e2e8f0', borderTop:'none', overflow:'hidden' }}>

          {/* Cards de imóveis arrematados para selecionar */}
          {arrematados.length > 0 && (
            <div style={{ padding:'16px 20px', borderBottom:'1px solid #e2e8f0' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:12 }}>Selecione um imóvel para lançar</div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:10 }}>
                {arrematados.map(im => {
                  const c = calcImovel(im);
                  const sc = STATUS_CONFIG[im.status] || STATUS_CONFIG.arrematado;
                  return (
                    <div key={im.id} onClick={()=>setImovelLancamentos(im)}
                      style={{ border:`1px solid ${sc.c}40`, borderRadius:12, padding:'12px 14px', cursor:'pointer', background:sc.bg+'80', transition:'all 0.15s' }}
                      onMouseEnter={e=>e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)'}
                      onMouseLeave={e=>e.currentTarget.style.boxShadow='none'}>
                      <div style={{ fontWeight:800, fontSize:13, color:'#111111', marginBottom:4 }}>{im.nome||'Sem nome'}</div>
                      <div style={{ fontSize:11, color:'#64748b', marginBottom:6 }}>{im.cidade||'—'}</div>
                      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
                        <span style={{ color:'#ef4444' }}>Saídas: R$ {fmt(c.saidas)}</span>
                        <span style={{ color:'#10b981' }}>Entradas: R$ {fmt(c.entradas)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Barra de totais consolidados + export */}
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, padding:'14px 20px', borderBottom:'1px solid #e2e8f0', flexWrap:'wrap' }}>
            <div style={{ display:'flex', gap:18, flexWrap:'wrap' }}>
              <div><span style={{ fontSize:10, color:'#16a34a', fontWeight:800, textTransform:'uppercase' }}>Entradas</span><div style={{ fontSize:18, fontWeight:900, color:'#10b981' }}>R$ {fmt(totalEntradas)}</div></div>
              <div><span style={{ fontSize:10, color:'#dc2626', fontWeight:800, textTransform:'uppercase' }}>Saídas</span><div style={{ fontSize:18, fontWeight:900, color:'#ef4444' }}>R$ {fmt(totalSaidas)}</div></div>
              <div><span style={{ fontSize:10, color:(totalEntradas-totalSaidas)>=0?'#16a34a':'#dc2626', fontWeight:800, textTransform:'uppercase' }}>Saldo Geral</span><div style={{ fontSize:18, fontWeight:900, color:(totalEntradas-totalSaidas)>=0?'#10b981':'#ef4444' }}>R$ {fmt(totalEntradas-totalSaidas)}</div></div>
            </div>
            <button onClick={exportarPDFFinanceiro}
              style={{ padding:'9px 16px', background:'#f59e0b', color:'white', border:'none', borderRadius:9, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:7 }}>
              <Printer size={15}/> Exportar PDF
            </button>
          </div>

          {/* Formulário novo lançamento */}
          <div style={{ padding:'16px 20px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc' }}>
            <div style={{ fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:12 }}>Novo Lançamento</div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '130px 1fr 1fr 1fr 120px auto', gap:8, alignItems:'flex-end' }}>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'#64748b', marginBottom:4 }}>DATA</div>
                <input type="date" value={novoLanc.data} onChange={e=>setNovoLanc(p=>({...p,data:e.target.value}))} style={{ ...inp2, width:'100%' }}/>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'#64748b', marginBottom:4 }}>IMÓVEL</div>
                <select value={novoLanc.imovelId} onChange={e=>setNovoLanc(p=>({...p,imovelId:e.target.value}))}
                  style={{ ...inp2, width:'100%' }}>
                  <option value="">Selecione...</option>
                  {imoveis.map(im=><option key={im.id} value={im.id}>{im.nome||im.endereco||'Imóvel'}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'#64748b', marginBottom:4 }}>TIPO</div>
                <select value={novoLanc.tipo} onChange={e=>setNovoLanc(p=>({...p,tipo:e.target.value}))}
                  style={{ ...inp2, width:'100%', background:novoLanc.tipo==='entrada'?'#f0fdf4':'#fef2f2', fontWeight:700, color:novoLanc.tipo==='entrada'?'#16a34a':'#dc2626' }}>
                  <option value="saida">Saída (−)</option>
                  <option value="entrada">Entrada (+)</option>
                </select>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'#64748b', marginBottom:4 }}>CATEGORIA</div>
                <select value={novoLanc.categoria} onChange={e=>setNovoLanc(p=>({...p,categoria:e.target.value}))}
                  style={{ ...inp2, width:'100%' }}>
                  {CAT_LANC.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:700, color:'#64748b', marginBottom:4 }}>VALOR (R$)</div>
                <input type="number" value={novoLanc.valor} onChange={e=>setNovoLanc(p=>({...p,valor:e.target.value}))} placeholder="0,00"
                  style={{ ...inp2, width:'100%' }}/>
              </div>
              <button onClick={adicionarLancamento}
                disabled={!novoLanc.imovelId || !novoLanc.valor}
                style={{ padding:'8px 16px', background: (!novoLanc.imovelId||!novoLanc.valor) ? '#94a3b8' : '#0D63DB', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:13, cursor: (!novoLanc.imovelId||!novoLanc.valor) ? 'not-allowed' : 'pointer', height:36, whiteSpace:'nowrap' }}>
                + Lançar
              </button>
            </div>
            <div style={{ marginTop:8 }}>
              <input value={novoLanc.descricao} onChange={e=>setNovoLanc(p=>({...p,descricao:e.target.value}))} placeholder="Descrição (opcional)"
                style={{ ...inp2, width:'100%' }}/>
            </div>
          </div>

          {/* Lançamentos agrupados por imóvel */}
          {lancamentosPorImovel.length === 0 ? (
            <div style={{ textAlign:'center', padding:'50px 20px', color:'#94a3b8', fontSize:13 }}>Nenhum lançamento ainda. Adicione acima.</div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:18, padding:'18px 20px' }}>
              {lancamentosPorImovel.map(g => {
                const ent = g.lancamentos.filter(l=>l.tipo==='entrada').reduce((s,l)=>s+Number(l.valor),0);
                const sai = g.lancamentos.filter(l=>l.tipo==='saida').reduce((s,l)=>s+Number(l.valor),0);
                const sld = ent - sai;
                return (
                  <div key={g.id} style={{ border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden' }}>
                    {/* Cabeçalho do imóvel com subtotais */}
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:12, padding:'10px 16px', background:'#f8fafc', borderBottom:'1px solid #e2e8f0', flexWrap:'wrap' }}>
                      <div style={{ fontWeight:800, color:'#111111', fontSize:14 }}>🏠 {g.nome}{g.cidade?<span style={{ fontSize:12, color:'#94a3b8', fontWeight:500 }}> · {g.cidade}</span>:null}</div>
                      <div style={{ display:'flex', gap:14, fontSize:12 }}>
                        <span style={{ color:'#10b981', fontWeight:700 }}>+ R$ {fmt(ent)}</span>
                        <span style={{ color:'#ef4444', fontWeight:700 }}>− R$ {fmt(sai)}</span>
                        <span style={{ color:sld>=0?'#10b981':'#ef4444', fontWeight:900 }}>Saldo R$ {fmt(sld)}</span>
                      </div>
                    </div>
                    <div style={{ overflowX:'auto' }}>
                      <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                        <thead>
                          <tr style={{ background:'#fcfcfd', borderBottom:'1px solid #e2e8f0' }}>
                            {['Data','Tipo','Categoria','Descrição','Valor',''].map(h=>(
                              <th key={h} style={{ padding:'8px 14px', textAlign:'left', fontWeight:700, color:'#475569', fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {g.lancamentos.map((l,i)=>(
                            <tr key={l.id||i} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                              <td style={{ padding:'9px 14px', fontSize:12, color:'#64748b', whiteSpace:'nowrap' }}>{l.data}</td>
                              <td style={{ padding:'9px 14px' }}>
                                <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:l.tipo==='entrada'?'#d1fae5':'#fee2e2', color:l.tipo==='entrada'?'#059669':'#dc2626' }}>
                                  {l.tipo==='entrada'?'Entrada':'Saída'}
                                </span>
                              </td>
                              <td style={{ padding:'9px 14px', fontSize:12, color:'#475569' }}>{l.categoria}</td>
                              <td style={{ padding:'9px 14px', fontSize:12, color:'#64748b' }}>{l.descricao||'—'}</td>
                              <td style={{ padding:'9px 14px', fontWeight:800, color:l.tipo==='entrada'?'#10b981':'#ef4444', whiteSpace:'nowrap' }}>
                                {l.tipo==='entrada'?'+ ':'− '}R$ {fmt(Number(l.valor))}
                              </td>
                              <td style={{ padding:'9px 14px' }}>
                                <button onClick={()=>removerLancamento(g.id, l.id)}
                                  style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', padding:2 }}>
                                  <Trash2 size={13}/>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal controle financeiro (para lançar de dentro de uma arrematação) */}
      {controleAberto && (
        <ControleFinanceiro
          im={controleAberto}
          onClose={()=>setControleAberto(null)}
          onUpdate={(imAtualizado)=>{ atualizarImovel(imAtualizado); setControleAberto(imAtualizado); }}
        />
      )}

      <style>{`
        @media (max-width: 768px) {
          table { font-size: 11px !important; }
          td, th { padding: 6px 8px !important; }
        }
      `}</style>
    </div>
  );
}