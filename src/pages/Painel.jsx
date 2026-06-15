import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Building2, BarChart3, TrendingUp, DollarSign, Plus, Trash2,
  ChevronDown, ChevronUp, CheckCircle2, Clock, XCircle, Home,
  LayoutGrid, Warehouse, ArrowUpCircle, ArrowDownCircle, X, Save,
} from 'lucide-react';
import { loadImoveis, saveImoveis, loadFavoritos } from '../utils/storage';
import { fmt, fmtPct } from '../utils/calculos';

const STATUS_CONFIG = {
  analise:    { l:'Em Análise',  c:'#f59e0b', bg:'#fef3c7' },
  aprovado:   { l:'Aprovado',    c:'#10b981', bg:'#d1fae5' },
  arrematado: { l:'Arrematado',  c:'#2563eb', bg:'#dbeafe' },
  em_reforma: { l:'Em Reforma',  c:'#8b5cf6', bg:'#ede9fe' },
  venda:      { l:'À Venda',     c:'#f97316', bg:'#ffedd5' },
  alugado:    { l:'Alugado',     c:'#06b6d4', bg:'#cffafe' },
  concluido:  { l:'Concluído',   c:'#64748b', bg:'#f1f5f9' },
  reprovado:  { l:'Reprovado',   c:'#ef4444', bg:'#fee2e2' },
};

const CAT_LANC = [
  'Arrematação','Honorários TSN','Taxa Leiloeiro','ITBI / Registro',
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
        <div style={{ background:'#0f172a', borderRadius:'18px 18px 0 0', padding:'18px 22px', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
          <div>
            <div style={{ fontSize:12, color:'#64748b', fontWeight:700, textTransform:'uppercase', marginBottom:4 }}>Controle Financeiro</div>
            <div style={{ fontSize:17, fontWeight:900, color:'white', lineHeight:1.3 }}>{im.nome || im.endereco || 'Imóvel'}</div>
            {im.cidade && <div style={{ fontSize:12, color:'#94a3b8', marginTop:3 }}>{im.cidade}{im.estado?', '+im.estado:''}</div>}
          </div>
          <button onClick={onClose} style={{ background:'#1e293b', border:'none', borderRadius:8, padding:8, cursor:'pointer', color:'#94a3b8' }}>
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
              <div style={{ fontSize:22, fontWeight:900, color:c }}>R$ {fmt(Math.abs(v),0)}</div>
            </div>
          ))}
        </div>

        {/* Novo lançamento */}
        <div style={{ padding:'16px 22px', borderBottom:'1px solid #f1f5f9', background:'#f8fafc' }}>
          <div style={{ fontSize:11, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:12 }}>Novo Lançamento</div>
          <div style={{ display:'grid', gridTemplateColumns:'120px 1fr 1fr 100px auto', gap:8, alignItems:'flex-end' }}>
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
            <button onClick={adicionar} style={{ padding:'8px 14px', background:'#2563eb', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:13, cursor:'pointer', whiteSpace:'nowrap', height:36 }}>
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
                    {l.tipo==='entrada'?'+ ':'- '}R$ {fmt(l.valor,0)}
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
  const [imoveis, setImoveis] = useState([]);
  const [aba, setAba] = useState('arrematacoes'); // 'arrematacoes' | 'lancamentos'
  const [controleAberto, setControleAberto] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [novoLanc, setNovoLanc] = useState({ data: new Date().toISOString().slice(0,10), tipo:'saida', categoria:'Outros', imovelId:'', descricao:'', valor:'' });

  useEffect(() => { setImoveis(loadImoveis()); }, []);

  const atualizarImovel = (imAtualizado) => {
    const updated = imoveis.map(i => i.id===imAtualizado.id ? imAtualizado : i);
    setImoveis(updated);
    saveImoveis(updated);
  };

  const excluir = (id) => {
    if (!confirm('Remover do portfólio?')) return;
    const updated = imoveis.filter(i=>i.id!==id);
    setImoveis(updated);
    saveImoveis(updated);
  };

  const alterarStatus = (id, status) => {
    const updated = imoveis.map(i=>i.id===id?{...i,status,updatedAt:new Date().toISOString()}:i);
    setImoveis(updated);
    saveImoveis(updated);
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

  const filtrados = imoveis.filter(im => !filtroStatus || im.status===filtroStatus);

  const tabBtn = (id, label) => (
    <button onClick={()=>setAba(id)}
      style={{ padding:'10px 20px', border:'none', background: aba===id ? '#0f172a' : 'transparent', color: aba===id ? 'white' : '#64748b', fontWeight:700, fontSize:14, cursor:'pointer', borderRadius: aba===id ? '10px 10px 0 0' : '10px 10px 0 0', borderBottom: aba===id ? 'none' : '2px solid #e2e8f0' }}>
      {label}
    </button>
  );

  const inp2 = { padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:7, fontSize:12, background:'white', boxSizing:'border-box' };

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding:'24px 20px' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ margin:0, fontSize:24, fontWeight:900, color:'#0f172a' }}>Meu Portfólio</h1>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'#64748b' }}>{imoveis.length} imóvel(is) · {todosLancamentos.length} lançamentos</p>
        </div>
        <button onClick={()=>nav('/buscar')}
          style={{ padding:'10px 18px', background:'#2563eb', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
          + Buscar Leilões
        </button>
      </div>

      {/* KPIs rápidos */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))', gap:10, marginBottom:20 }}>
        {[
          { l:'Imóveis', v: imoveis.length, c:'#2563eb', bg:'#eff6ff' },
          { l:'Total Investido', v:`R$ ${fmt(imoveis.reduce((s,i)=>s+Number(i.valorArrematacao||0),0),0)}`, c:'#ef4444', bg:'#fef2f2' },
          { l:'Entradas', v:`R$ ${fmt(totalEntradas,0)}`, c:'#10b981', bg:'#f0fdf4' },
          { l:'Saídas', v:`R$ ${fmt(totalSaidas,0)}`, c:'#f59e0b', bg:'#fffbeb' },
          { l:'Saldo Real', v:`R$ ${fmt(totalEntradas-totalSaidas,0)}`, c:(totalEntradas-totalSaidas)>=0?'#10b981':'#ef4444', bg:(totalEntradas-totalSaidas)>=0?'#f0fdf4':'#fef2f2' },
        ].map(k=>(
          <div key={k.l} style={{ background:k.bg, borderRadius:12, padding:'14px 16px', border:`1px solid ${k.c}20` }}>
            <div style={{ fontSize:11, fontWeight:700, color:k.c, textTransform:'uppercase', marginBottom:4 }}>{k.l}</div>
            <div style={{ fontSize:18, fontWeight:900, color:'#0f172a' }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e2e8f0', marginBottom:0 }}>
        {tabBtn('arrematacoes', `🏠 Arrematações (${imoveis.length})`)}
        {tabBtn('lancamentos', `💰 Lançamentos (${todosLancamentos.length})`)}
      </div>

      {/* === ABA ARREMATAÇÕES === */}
      {aba==='arrematacoes' && (
        <div style={{ background:'white', borderRadius:'0 12px 12px 12px', border:'1px solid #e2e8f0', borderTop:'none', overflow:'hidden' }}>

          {/* Filtros rápidos */}
          <div style={{ padding:'12px 16px', borderBottom:'1px solid #f1f5f9', display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
            <span style={{ fontSize:11, fontWeight:700, color:'#64748b', marginRight:4 }}>STATUS:</span>
            <button onClick={()=>setFiltroStatus('')}
              style={{ padding:'4px 10px', border:'1px solid #e2e8f0', borderRadius:20, fontSize:11, fontWeight:700, cursor:'pointer', background:!filtroStatus?'#0f172a':'white', color:!filtroStatus?'white':'#64748b' }}>
              Todos
            </button>
            {Object.entries(STATUS_CONFIG).map(([k,s])=>{
              const count = imoveis.filter(i=>i.status===k).length;
              if(!count) return null;
              return (
                <button key={k} onClick={()=>setFiltroStatus(filtroStatus===k?'':k)}
                  style={{ padding:'4px 10px', border:`1px solid ${filtroStatus===k?s.c:'#e2e8f0'}`, borderRadius:20, fontSize:11, fontWeight:700, cursor:'pointer', background:filtroStatus===k?s.bg:'white', color:filtroStatus===k?s.c:'#64748b' }}>
                  {s.l} ({count})
                </button>
              );
            })}
          </div>

          {imoveis.length === 0 ? (
            <div style={{ textAlign:'center', padding:'70px 20px' }}>
              <div style={{ fontSize:48, marginBottom:16 }}>🏠</div>
              <h3 style={{ color:'#334155', fontWeight:900, margin:'0 0 8px' }}>Portfólio vazio</h3>
              <p style={{ color:'#94a3b8', marginBottom:24, fontSize:14 }}>Busque leilões e marque como Arrematado para acompanhar aqui.</p>
              <button onClick={()=>nav('/buscar')} style={{ background:'#2563eb', color:'white', border:'none', borderRadius:10, padding:'11px 24px', fontWeight:700, cursor:'pointer' }}>
                Buscar Leilões
              </button>
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                    {['Imóvel','Status','Aquisição (R$)','Projeção Venda','Venda Real','ROI Real','Ações'].map(h=>(
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontWeight:700, color:'#475569', fontSize:11, textTransform:'uppercase', letterSpacing:0.5, whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((im,i) => {
                    const c = calcImovel(im);
                    return (
                      <tr key={im.id} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                        <td style={{ padding:'12px 14px' }}>
                          <div style={{ fontWeight:700, color:'#0f172a', fontSize:13 }}>{im.nome||'Sem nome'}</div>
                          <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>{im.cidade}{im.estado?`, ${im.estado}`:''}</div>
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          <select value={im.status||'analise'} onChange={e=>alterarStatus(im.id,e.target.value)}
                            style={{ fontSize:11, fontWeight:700, border:`1px solid ${STATUS_CONFIG[im.status]?.c||'#e2e8f0'}`, borderRadius:20, padding:'4px 10px', background:STATUS_CONFIG[im.status]?.bg||'#f1f5f9', color:STATUS_CONFIG[im.status]?.c||'#64748b', cursor:'pointer' }}>
                            {Object.entries(STATUS_CONFIG).map(([v,s])=><option key={v} value={v}>{s.l}</option>)}
                          </select>
                        </td>
                        <td style={{ padding:'12px 14px', fontWeight:800, color:'#0f172a' }}>
                          R$ {fmt(Number(im.valorArrematacao||0),0)}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          {c.projecaoVenda > 0
                            ? <><div style={{ fontWeight:700, color:'#10b981' }}>R$ {fmt(c.projecaoVenda,0)}</div>
                                <div style={{ fontSize:10, color:'#94a3b8' }}>proj. ({c.roiProj!=null?fmtPct(c.roiProj):'—'} ROI)</div></>
                            : <span style={{ color:'#cbd5e1', fontSize:12 }}>—</span>}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          {c.vendaReal > 0
                            ? <div style={{ fontWeight:800, color:'#10b981' }}>R$ {fmt(c.vendaReal,0)}</div>
                            : <span style={{ color:'#cbd5e1', fontSize:12 }}>Não vendido</span>}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          {c.roiReal != null
                            ? <span style={{ fontWeight:900, fontSize:15, color:c.roiReal>=40?'#10b981':c.roiReal>=0?'#f59e0b':'#ef4444' }}>{fmtPct(c.roiReal)}</span>
                            : c.roiProj != null
                            ? <span style={{ fontSize:12, color:'#94a3b8' }}>proj: {fmtPct(c.roiProj)}</span>
                            : <span style={{ color:'#cbd5e1', fontSize:12 }}>—</span>}
                        </td>
                        <td style={{ padding:'12px 14px' }}>
                          <div style={{ display:'flex', gap:6 }}>
                            <button onClick={()=>setControleAberto(im)}
                              style={{ padding:'6px 10px', background:'#f0fdf4', color:'#10b981', border:'1px solid #bbf7d0', borderRadius:7, fontWeight:700, fontSize:11, cursor:'pointer', whiteSpace:'nowrap' }}>
                              💰 Lançar
                            </button>
                            <button onClick={()=>nav('/analise',{state:{imovel:im}})}
                              style={{ padding:'6px 10px', background:'#eff6ff', color:'#2563eb', border:'1px solid #bfdbfe', borderRadius:7, fontWeight:700, fontSize:11, cursor:'pointer' }}>
                              📊
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
          )}
        </div>
      )}

      {/* === ABA LANÇAMENTOS === */}
      {aba==='lancamentos' && (
        <div style={{ background:'white', borderRadius:'0 12px 12px 12px', border:'1px solid #e2e8f0', borderTop:'none', overflow:'hidden' }}>

          {/* Formulário novo lançamento */}
          <div style={{ padding:'16px 20px', borderBottom:'1px solid #e2e8f0', background:'#f8fafc' }}>
            <div style={{ fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:12 }}>Novo Lançamento</div>
            <div style={{ display:'grid', gridTemplateColumns:'130px 1fr 1fr 1fr 120px auto', gap:8, alignItems:'flex-end' }}>
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
                style={{ padding:'8px 16px', background:'#2563eb', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:13, cursor:'pointer', height:36, whiteSpace:'nowrap' }}>
                + Lançar
              </button>
            </div>
            <div style={{ marginTop:8 }}>
              <input value={novoLanc.descricao} onChange={e=>setNovoLanc(p=>({...p,descricao:e.target.value}))} placeholder="Descrição (opcional)"
                style={{ ...inp2, width:'100%' }}/>
            </div>
          </div>

          {/* Lista de lançamentos */}
          {todosLancamentos.length === 0 ? (
            <div style={{ textAlign:'center', padding:'50px 20px', color:'#94a3b8', fontSize:13 }}>Nenhum lançamento ainda. Adicione acima.</div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                    {['Data','Imóvel','Tipo','Categoria','Descrição','Valor',''].map(h=>(
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontWeight:700, color:'#475569', fontSize:11, textTransform:'uppercase', letterSpacing:0.5 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {todosLancamentos.map((l,i)=>(
                    <tr key={l.id||i} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                      <td style={{ padding:'10px 14px', fontSize:12, color:'#64748b', whiteSpace:'nowrap' }}>{l.data}</td>
                      <td style={{ padding:'10px 14px', fontWeight:600, color:'#334155', fontSize:12 }}>{l.imovelNome}</td>
                      <td style={{ padding:'10px 14px' }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:l.tipo==='entrada'?'#d1fae5':'#fee2e2', color:l.tipo==='entrada'?'#059669':'#dc2626' }}>
                          {l.tipo==='entrada'?'Entrada':'Saída'}
                        </span>
                      </td>
                      <td style={{ padding:'10px 14px', fontSize:12, color:'#475569' }}>{l.categoria}</td>
                      <td style={{ padding:'10px 14px', fontSize:12, color:'#64748b' }}>{l.descricao||'—'}</td>
                      <td style={{ padding:'10px 14px', fontWeight:800, color:l.tipo==='entrada'?'#10b981':'#ef4444', whiteSpace:'nowrap' }}>
                        {l.tipo==='entrada'?'+ ':'− '}R$ {fmt(Number(l.valor),0)}
                      </td>
                      <td style={{ padding:'10px 14px' }}>
                        <button onClick={()=>removerLancamento(l.imovelId, l.id)}
                          style={{ background:'none', border:'none', cursor:'pointer', color:'#ef4444', padding:2 }}>
                          <Trash2 size={13}/>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          td, th { padding: 8px 8px !important; }
        }
      `}</style>
    </div>
  );
}