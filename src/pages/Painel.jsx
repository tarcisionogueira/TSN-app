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
  const [favoritosIds] = useState(() => {
    try { return JSON.parse(localStorage.getItem('tsn_favoritos') || '[]').map(f=>f.id||f); } catch { return []; }
  });
  const [controleAberto, setControleAberto] = useState(null);
  const [filtroStatus, setFiltroStatus] = useState('');
  const [sortCol, setSortCol] = useState('updatedAt');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => { setImoveis(loadImoveis()); }, []);

  const atualizarImovel = (imAtualizado) => {
    const updated = imoveis.map(i => i.id===imAtualizado.id ? imAtualizado : i);
    setImoveis(updated);
    saveImoveis(updated);
  };

  const excluir = (id, e) => {
    e.stopPropagation();
    if (!confirm('Remover do portfólio?')) return;
    const updated = imoveis.filter(i=>i.id!==id);
    setImoveis(updated);
    saveImoveis(updated);
  };

  const alterarStatus = (id, status, e) => {
    e.stopPropagation();
    const updated = imoveis.map(i=>i.id===id?{...i,status,updatedAt:new Date().toISOString()}:i);
    setImoveis(updated);
    saveImoveis(updated);
  };

  const sort = (col) => {
    if (sortCol===col) setSortAsc(p=>!p);
    else { setSortCol(col); setSortAsc(false); }
  };

  const lucroImovel = (im) => {
    const entrada = (im.lancamentosFinanceiros||[]).filter(l=>l.tipo==='entrada').reduce((s,l)=>s+Number(l.valor),0);
    const saida   = (im.lancamentosFinanceiros||[]).filter(l=>l.tipo==='saida').reduce((s,l)=>s+Number(l.valor),0);
    if (entrada>0||saida>0) return entrada-saida;
    const arremate = Number(im.valorArrematacao||im.valorMinimo||0);
    const mercado  = Number(im.valorMercado||0);
    return mercado>0 ? Math.round(mercado*0.9 - arremate*1.2) : 0;
  };

  const filtrados = imoveis
    .filter(im => !filtroStatus || im.status===filtroStatus)
    .sort((a,b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (sortCol==='lucro') { va=lucroImovel(a); vb=lucroImovel(b); }
      if (sortCol==='valorArrematacao'||sortCol==='valorMercado') { va=Number(va)||0; vb=Number(vb)||0; }
      if (va<vb) return sortAsc?-1:1;
      if (va>vb) return sortAsc?1:-1;
      return 0;
    });

  // KPIs
  const totalArremate = imoveis.reduce((s,i)=>s+Number(i.valorArrematacao||i.valorMinimo||0),0);
  const totalMercado  = imoveis.reduce((s,i)=>s+Number(i.valorMercado||0),0);
  const totalLucro    = imoveis.reduce((s,i)=>s+Math.max(0,lucroImovel(i)),0);
  const arrematados   = imoveis.filter(i=>['arrematado','em_reforma','venda','alugado'].includes(i.status)).length;

  const Th = ({ col, children }) => (
    <th onClick={()=>sort(col)} style={{ padding:'10px 14px', textAlign:'left', fontWeight:700, color:'#475569', fontSize:11, textTransform:'uppercase', letterSpacing:0.5, cursor:'pointer', whiteSpace:'nowrap', userSelect:'none' }}>
      {children} {sortCol===col?(sortAsc?'↑':'↓'):''}
    </th>
  );

  return (
    <div style={{ maxWidth:1280, margin:'0 auto', padding:'24px 20px' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:24, flexWrap:'wrap', gap:12 }}>
        <div>
          <h1 style={{ margin:0, fontSize:24, fontWeight:900, color:'#0f172a' }}>Painel de Controle</h1>
          <p style={{ margin:'4px 0 0', fontSize:13, color:'#64748b' }}>{imoveis.length} imóvel(is) no portfólio</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={()=>nav('/buscar')} style={{ padding:'10px 16px', background:'white', color:'#334155', border:'1px solid #e2e8f0', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer' }}>
            Buscar Leilões
          </button>
          <button onClick={()=>nav('/analise')} style={{ padding:'10px 16px', background:'#2563eb', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
            <Plus size={14}/> Nova Análise
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12, marginBottom:20 }}>
        {[
          ['Portfólio',imoveis.length,'#2563eb','#dbeafe',Building2],
          ['Total Investido',`R$ ${fmt(totalArremate,0)}`,'#ef4444','#fee2e2',DollarSign],
          ['VGV Total',`R$ ${fmt(totalMercado,0)}`,'#10b981','#d1fae5',TrendingUp],
          ['Lucro Estimado',`R$ ${fmt(totalLucro,0)}`,'#8b5cf6','#ede9fe',BarChart3],
          ['Arrematados',arrematados,'#f59e0b','#fef3c7',CheckCircle2],
        ].map(([l,v,c,bg,Icon])=>(
          <div key={l} style={{ background:'white', borderRadius:12, padding:'14px 16px', border:'1px solid #e2e8f0', display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ background:bg, borderRadius:9, padding:9 }}><Icon size={16} color={c}/></div>
            <div>
              <div style={{ fontSize:18, fontWeight:900, color:'#0f172a', lineHeight:1 }}>{v}</div>
              <div style={{ fontSize:11, color:'#64748b', fontWeight:600, marginTop:3 }}>{l}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filtro status */}
      <div style={{ display:'flex', gap:6, marginBottom:14, flexWrap:'wrap' }}>
        <button onClick={()=>setFiltroStatus('')}
          style={{ padding:'5px 12px', border:'1px solid #e2e8f0', borderRadius:20, fontSize:11, fontWeight:700, cursor:'pointer', background:!filtroStatus?'#0f172a':'white', color:!filtroStatus?'white':'#64748b' }}>
          Todos ({imoveis.length})
        </button>
        {Object.entries(STATUS_CONFIG).map(([k,s])=>{
          const count = imoveis.filter(i=>i.status===k).length;
          if(!count) return null;
          return (
            <button key={k} onClick={()=>setFiltroStatus(filtroStatus===k?'':k)}
              style={{ padding:'5px 12px', border:`1px solid ${filtroStatus===k?s.c:'#e2e8f0'}`, borderRadius:20, fontSize:11, fontWeight:700, cursor:'pointer', background:filtroStatus===k?s.bg:'white', color:filtroStatus===k?s.c:'#64748b' }}>
              {s.l} ({count})
            </button>
          );
        })}
      </div>

      {/* Tabela */}
      {imoveis.length === 0 ? (
        <div style={{ textAlign:'center', padding:'70px 20px', background:'white', borderRadius:16, border:'2px dashed #cbd5e1' }}>
          <Building2 size={48} color="#94a3b8" style={{ margin:'0 auto 16px' }}/>
          <h3 style={{ color:'#334155', fontWeight:900, margin:'0 0 8px' }}>Portfólio vazio</h3>
          <p style={{ color:'#94a3b8', marginBottom:24, fontSize:14 }}>Busque leilões, analise imóveis e salve-os aqui.</p>
          <button onClick={()=>nav('/buscar')} style={{ background:'#2563eb', color:'white', border:'none', borderRadius:10, padding:'11px 24px', fontWeight:700, cursor:'pointer' }}>
            Buscar Leilões
          </button>
        </div>
      ) : (
        <div style={{ background:'white', borderRadius:14, border:'1px solid #e2e8f0', overflow:'hidden' }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                  <Th col="nome">Imóvel / Endereço</Th>
                  <Th col="status">Status</Th>
                  <Th col="valorArrematacao">Aquisição</Th>
                  <Th col="valorMercado">Mercado</Th>
                  <Th col="lucro">Lucro Estimado</Th>
                  <th style={{ padding:'10px 14px', fontSize:11, color:'#475569', fontWeight:700, textTransform:'uppercase' }}>Saldo Lançamentos</th>
                  <th style={{ padding:'10px 14px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((im,i) => {
                  const lucro = lucroImovel(im);
                  const entradas = (im.lancamentosFinanceiros||[]).filter(l=>l.tipo==='entrada').reduce((s,l)=>s+Number(l.valor),0);
                  const saidas   = (im.lancamentosFinanceiros||[]).filter(l=>l.tipo==='saida').reduce((s,l)=>s+Number(l.valor),0);
                  const saldo = entradas - saidas;
                  const hasLanc = (im.lancamentosFinanceiros||[]).length > 0;
                  return (
                    <tr key={im.id} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>

                      {/* Imóvel */}
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ fontWeight:700, color:'#0f172a', fontSize:13 }}>{im.nome||'Sem nome'}</div>
                        <div style={{ fontSize:11, color:'#64748b', marginTop:2 }}>
                          {im.endereco ? im.endereco.slice(0,45)+(im.endereco.length>45?'...':'') : '—'}
                        </div>
                        {im.cidade && <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>{im.cidade}{im.estado?`, ${im.estado}`:''}</div>}
                      </td>

                      {/* Status editável */}
                      <td style={{ padding:'12px 14px' }}>
                        <select value={im.status||'analise'} onChange={e=>alterarStatus(im.id,e.target.value,e)}
                          onClick={e=>e.stopPropagation()}
                          style={{ fontSize:11, fontWeight:700, border:`1px solid ${STATUS_CONFIG[im.status]?.c||'#e2e8f0'}`, borderRadius:20, padding:'4px 10px', background:STATUS_CONFIG[im.status]?.bg||'#f1f5f9', color:STATUS_CONFIG[im.status]?.c||'#64748b', cursor:'pointer' }}>
                          {Object.entries(STATUS_CONFIG).map(([v,s])=><option key={v} value={v}>{s.l}</option>)}
                        </select>
                      </td>

                      {/* Aquisição */}
                      <td style={{ padding:'12px 14px', fontWeight:700, color:'#0f172a' }}>
                        R$ {fmt(Number(im.valorArrematacao||im.valorMinimo||0),0)}
                      </td>

                      {/* Mercado */}
                      <td style={{ padding:'12px 14px', fontWeight:700, color:'#10b981' }}>
                        {im.valorMercado>0 ? `R$ ${fmt(Number(im.valorMercado),0)}` : '—'}
                      </td>

                      {/* Lucro estimado */}
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ fontWeight:700, color:lucro>=0?'#10b981':'#ef4444', fontSize:14 }}>
                          {im.valorMercado>0 ? `R$ ${fmt(Math.abs(lucro),0)}` : '—'}
                        </div>
                        {im.valorMercado>0&&im.valorArrematacao>0 && (
                          <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>
                            {fmtPct(lucro/Number(im.valorArrematacao)*100)} ROI est.
                          </div>
                        )}
                      </td>

                      {/* Saldo lançamentos reais */}
                      <td style={{ padding:'12px 14px' }}>
                        {hasLanc ? (
                          <>
                            <div style={{ fontWeight:700, color:saldo>=0?'#10b981':'#ef4444', fontSize:14 }}>
                              R$ {fmt(Math.abs(saldo),0)}
                            </div>
                            <div style={{ fontSize:10, color:'#94a3b8', marginTop:1 }}>
                              {(im.lancamentosFinanceiros||[]).length} lançamentos
                            </div>
                          </>
                        ) : (
                          <span style={{ fontSize:11, color:'#cbd5e1' }}>Sem lançamentos</span>
                        )}
                      </td>

                      {/* Ações */}
                      <td style={{ padding:'12px 14px' }}>
                        <div style={{ display:'flex', gap:6, justifyContent:'flex-end' }}>
                          <button onClick={()=>setControleAberto(im)}
                            style={{ padding:'6px 12px', background:'#10b981', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                            💰 Financeiro
                          </button>
                          <button onClick={()=>nav('/analise',{state:{imovel:im}})}
                            style={{ padding:'6px 12px', background:'#2563eb', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                            📊 Análise
                          </button>
                          <button onClick={e=>excluir(im.id,e)}
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

      {/* Modal controle financeiro */}
      {controleAberto && (
        <ControleFinanceiro
          im={controleAberto}
          onClose={()=>setControleAberto(null)}
          onUpdate={(imAtualizado)=>{ atualizarImovel(imAtualizado); setControleAberto(imAtualizado); }}
        />
      )}
    </div>
  );
}
