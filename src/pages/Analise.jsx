import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsMobile } from '../utils/useIsMobile';
import {
  FileText, Loader2, Sparkles, BarChart3, ShieldAlert, TrendingUp,
  CheckCircle2, XCircle, AlertTriangle, Gavel, DollarSign, Printer,
  Save, ChevronDown, ChevronUp, UploadCloud, Building2, MapPin,
  Home, ClipboardList, LineChart, Award, Info, RefreshCw, Lock,
  Scale, Search, User, Calendar, ChevronRight, AlertCircle, MessageCircle,
} from 'lucide-react';
import { extrairDadosDocumento, analisarMercado, gerarParecer } from '../utils/claude';
import { calcularMetricasCenario, calcularTetoLance, calcularSAC, calcularPrice, fmt, fmtPct } from '../utils/calculos';
import { loadImoveis, saveImoveis, generateId } from '../utils/storage';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import TabelaAmortizacao from '../components/TabelaAmortizacao';
import RiscoJuridico from '../components/RiscoJuridico';
import Lancamentos from '../components/Lancamentos';
import { gerarPDF } from '../components/RelatorioPDF';

const VAZIO = {
  id: '', nome: '', tipo: 'apartamento', endereco: '', cidade: '', estado: '', cep: '',
  nomeCondominio: '', objetivoCompra: 'investimento', status: 'analise', origem: 'extrajudicial',
  somenteAVista: false, tabelaAmortizacao: 'sac', leiloeiro: '', dataLeilao: '',
  taxaLeiloeiroPercentual: 5, valorAvaliacao: 0, valorArrematacao: 0,
  areaM2: 0, areaTerrenoM2: 0, valorMercado: 0, valorLocacao: 0,
  manutencaoEstimada: 0, prazoReformaMeses: 3, debitosAssumidos: 0,
  iptuMensal: 0, condominioMensal: 0, itbiPercentual: 3,
  laudemio: 0, foreiro: 0, sinalPercentual: 5, prazoMeses: 360,
  cetAnual: 12, prazoVendaMeses: 12, observacoes: '', riscos: [], lancamentos: [],
};

const STATUS_OPTS = [
  ['analise','Em Análise'],['aprovado','Aprovado'],['arrematado','Arrematado'],
  ['em_reforma','Em Reforma'],['venda','À Venda'],['alugado','Alugado'],
  ['concluido','Concluído'],['reprovado','Reprovado'],
];

const TIPO_OPTS = [['casa','Casa'],['apartamento','Apartamento'],['terreno','Terreno'],['comercial','Comercial']];

const inp = { width:'100%', padding:'9px 11px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, background:'white', color:'#0f172a', boxSizing:'border-box' };
const lbl = { fontSize:10, fontWeight:700, color:'#64748b', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 };

function Field({ label, name, value, onChange, type='text', opts=[], rows=2, ph='', prefix='' }) {
  const s = { ...inp, background: prefix ? '#f8fafc' : 'white' };
  return (
    <div>
      <label style={lbl}>{label}</label>
      {type==='select'
        ? <select name={name} value={value} onChange={onChange} style={s}>{opts.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
        : type==='textarea'
        ? <textarea name={name} value={value} onChange={onChange} rows={rows} placeholder={ph} style={{...s,resize:'vertical'}}/>
        : <div style={{position:'relative'}}>
            {prefix && <span style={{position:'absolute',left:10,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'#64748b',fontWeight:600}}>{prefix}</span>}
            <input name={name} type={type} value={value} onChange={onChange} placeholder={ph} style={{...s,paddingLeft:prefix?28:s.padding}}/>
          </div>
      }
    </div>
  );
}

function Section({ step, title, icon: Icon, color='#2563eb', open, onToggle, badge, children }) {
  return (
    <div style={{background:'white',borderRadius:16,border:'1px solid #e2e8f0',overflow:'hidden',boxShadow:'0 1px 4px rgba(0,0,0,0.04)'}}>
      <button onClick={onToggle} style={{width:'100%',padding:'16px 20px',border:'none',background:'white',cursor:'pointer',display:'flex',alignItems:'center',gap:14,textAlign:'left'}}>
        <div style={{width:36,height:36,borderRadius:10,background:open?color:'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'background 0.2s'}}>
          <Icon size={17} color={open?'white':color}/>
        </div>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {step && <span style={{fontSize:10,fontWeight:800,color:open?color:'#94a3b8',textTransform:'uppercase',letterSpacing:1}}>Etapa {step}</span>}
            {badge && <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:open?color+'18':' #f1f5f9',color:open?color:'#94a3b8'}}>{badge}</span>}
          </div>
          <div style={{fontSize:15,fontWeight:800,color:'#0f172a',marginTop:1}}>{title}</div>
        </div>
        {open ? <ChevronUp size={16} color="#94a3b8"/> : <ChevronDown size={16} color="#94a3b8"/>}
      </button>
      {open && <div style={{padding:'0 20px 20px',borderTop:'1px solid #f1f5f9'}}>{children}</div>}
    </div>
  );
}

function KpiCard({ label, value, sub, color, bg, icon: Icon, large }) {
  return (
    <div style={{background:'white',borderRadius:14,border:'1px solid #e2e8f0',padding:large?'20px 22px':'16px',boxShadow:'0 1px 3px rgba(0,0,0,0.05)'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
        <span style={{fontSize:10,color:'#94a3b8',fontWeight:700,textTransform:'uppercase',letterSpacing:0.5,lineHeight:1.4}}>{label}</span>
        <div style={{background:bg,borderRadius:8,padding:'6px'}}><Icon size={15} color={color}/></div>
      </div>
      <div style={{fontSize:large?28:22,fontWeight:900,color,lineHeight:1}}>{value}</div>
      {sub && <div style={{fontSize:11,color:'#94a3b8',marginTop:6,fontWeight:500}}>{sub}</div>}
    </div>
  );
}

const LIMITE_POR_ROLE = { explorador: 0, top1: 20, top2: 20 }; // 0 = usa bônus
const mesAtual = () => new Date().toISOString().slice(0, 7);
const ROLES_SEM_LIMITE = ['assessorado','clube','analista','advogado','admin'];
const ROLES_COM_CNJ   = ['top1','top2','assessorado','clube','analista','advogado','admin'];

export default function Analise() {
  const location = useLocation();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { user, role } = useAuth();
  const imovelInicial = location.state?.imovel;

  const temCNJ = ROLES_COM_CNJ.includes(role);
  const semLimite = ROLES_SEM_LIMITE.includes(role);

  const [analisesBloqueado, setAnalisesBloqueado] = useState(false);
  const [analisesUsadas, setAnalisesUsadas] = useState(0);
  const [analisesBonus, setAnalisesBonus] = useState(0);
  const limiteRole = LIMITE_POR_ROLE[role] || 0;

  useEffect(() => {
    if (!user || semLimite) return;
    const col = role === 'explorador'
      ? 'analises_mes, analises_count, analises_bonus'
      : 'analises_mes, analises_count';
    supabase.from('perfis').select(col).eq('id', user.id).single()
      .then(({ data, error }) => {
        if (error || !data) return;
        if (role === 'explorador') {
          const bonus = data.analises_bonus || 0;
          setAnalisesBonus(bonus);
          setAnalisesUsadas(0);
          setAnalisesBloqueado(bonus <= 0);
        } else {
          const count = data.analises_count || 0;
          if (data.analises_mes === mesAtual()) {
            setAnalisesUsadas(count);
            setAnalisesBloqueado(count >= limiteRole);
          } else {
            supabase.from('perfis').update({ analises_mes: mesAtual(), analises_count: 0 }).eq('id', user.id);
            setAnalisesUsadas(0);
            setAnalisesBloqueado(false);
          }
        }
      });
  }, [role, user, semLimite, limiteRole]);

  const [d, setD] = useState(() => {
    if (imovelInicial) return {
      ...VAZIO, id: generateId(), nome: imovelInicial.titulo||'',
      tipo: imovelInicial.tipo||'apartamento', endereco: imovelInicial.endereco||'',
      cidade: imovelInicial.cidade||'', estado: imovelInicial.estado||'',
      valorAvaliacao: imovelInicial.valorAvaliacao||0, valorArrematacao: imovelInicial.valorMinimo||0,
      areaM2: imovelInicial.areaM2||0, leiloeiro: imovelInicial.leiloeiro||'',
      dataLeilao: imovelInicial.dataLeilao||'', origem: imovelInicial.modalidade||'extrajudicial',
      somenteAVista: !imovelInicial.pagamento?.includes('financiado'),
    };
    return { ...VAZIO, id: generateId() };
  });

  const [textoDoc, setTextoDoc] = useState('');
  const [textoMatricula, setTextoMatricula] = useState('');

  // CNJ DataJud
  const [cnjNumero, setCnjNumero] = useState('');
  const [cnjNome, setCnjNome] = useState('');
  const [cnjResultados, setCnjResultados] = useState(null);
  const [loadCnj, setLoadCnj] = useState(false);
  const [cnjErro, setCnjErro] = useState('');

  const cenario_role_pro = ['top2', 'assessorado', 'clube', 'analista', 'advogado', 'admin'];

  const buscarCNJ = async () => {
    if (!cnjNumero.trim() && !cnjNome.trim()) return;
    if (!d.estado) { setCnjErro('Preencha o Estado do imóvel (Etapa 2) para determinar o tribunal.'); return; }
    setLoadCnj(true); setCnjErro(''); setCnjResultados(null);
    try {
      const res = await fetch('/api/cnj-datajud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero_processo: cnjNumero.trim(), nome_parte: cnjNome.trim(), uf: d.estado }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na consulta');
      setCnjResultados(data);
      // Adiciona riscos automaticamente ao perfil da análise
      if (data.processos?.length > 0) {
        const existentes = new Set((d.riscos || []).map(r => r.texto));
        const novos = [];
        data.processos.forEach(p => {
          p.riscos?.forEach(r => {
            const txt = `[CNJ ${p.tribunal}] ${r.descricao} — ${p.numero}`;
            if (!existentes.has(txt)) {
              novos.push({ id: Date.now() + Math.random(), texto: txt, tipo: r.severidade });
              existentes.add(txt);
            }
          });
        });
        if (novos.length) up('riscos', [...(d.riscos || []), ...novos]);
      }
    } catch (err) { setCnjErro(err.message); }
    setLoadCnj(false);
  };

  const [cenario, setCenario] = useState('financiado');
  const [mercado, setMercado] = useState(null);
  const [parecer, setParecer] = useState('');
  const [loadDoc, setLoadDoc] = useState(false);
  const [loadMercado, setLoadMercado] = useState(false);
  const [loadParecer, setLoadParecer] = useState(false);
  const [saved, setSaved] = useState(false);
  const [msg, setMsg] = useState({ text:'', type:'' });
  const [solicitando, setSolicitando] = useState(false);
  const [solicitado, setSolicitado] = useState(false);

  // Controle de abertura por seção
  const [openSec, setOpenSec] = useState({ doc:true, dados:true, mercado:false, viabilidade:true, fluxo:false, laudo:false, matricula:false, cnj:false });
  const toggleSec = (k) => setOpenSec(p => ({ ...p, [k]: !p[k] }));

  const up = useCallback((name, val) => setD(p => ({ ...p, [name]: val })), []);
  const upN = useCallback((e) => {
    const { name, value } = e.target;
    const texts = ['nome','tipo','endereco','cidade','estado','cep','nomeCondominio','objetivoCompra','origem','status','tabelaAmortizacao','leiloeiro','dataLeilao','observacoes'];
    setD(p => ({ ...p, [name]: texts.includes(name) ? value : (parseFloat(value)||0) }));
  }, []);

  const isAVista = cenario === 'aVista' || d.somenteAVista;
  const isUsoProprio = d.objetivoCompra === 'uso_proprio';
  const META = isUsoProprio ? 0 : 40;

  const metricas = useMemo(() => calcularMetricasCenario(d, d.valorArrematacao||0, isAVista), [d, isAVista]);
  const teto = useMemo(() => calcularTetoLance(d, isAVista, META, d.valorMercado||0), [d, isAVista, META]);
  const metricasTeto = useMemo(() => calcularMetricasCenario(d, teto, isAVista), [d, teto, isAVista]);
  const isViavel = isUsoProprio ? true : metricas.roi >= META;
  const riscosBloqueantes = (d.riscos||[]).filter(r => r.tipo === 'bloqueante');

  const sacTab = useMemo(() => {
    const p = (d.valorArrematacao||0) * (1 - (d.sinalPercentual||0)/100);
    return calcularSAC(p, d.cetAnual||0, d.prazoMeses||0);
  }, [d.valorArrematacao, d.sinalPercentual, d.cetAnual, d.prazoMeses]);

  const priceTab = useMemo(() => {
    const p = (d.valorArrematacao||0) * (1 - (d.sinalPercentual||0)/100);
    return calcularPrice(p, d.cetAnual||0, d.prazoMeses||0);
  }, [d.valorArrematacao, d.sinalPercentual, d.cetAnual, d.prazoMeses]);

  const fluxo = useMemo(() => {
    const pVenda = Number(d.prazoVendaMeses)||12;
    const pRef = Math.min(Number(d.prazoReformaMeses)||3, pVenda);
    const parcelaRef = d.manutencaoEstimada>0 ? d.manutencaoEstimada/pRef : 0;
    let saldo = -(isAVista?metricas.vArremate:metricas.valorSinal) - metricas.taxaLeiloeiro - metricas.honorarios - metricas.itbiRegistro - (d.laudemio||0) - (d.foreiro||0);
    const linhas = [{ mes:0, entrada:0, saida:-saldo, descricao:'Investimento Inicial', saldo }];
    let totalSaidas = -saldo;
    for (let i=1; i<=pVenda; i++) {
      let saida = (d.iptuMensal||0) + (d.condominioMensal||0);
      const parts = [];
      if (saida>0) parts.push('Carrego');
      if (!isAVista && i<=(d.prazoMeses||0)) { saida += metricas.parcelaMedia; parts.push('Parcela'); }
      if (i===1 && d.debitosAssumidos>0) { saida += d.debitosAssumidos; parts.push('Débitos'); }
      if (i<=pRef && parcelaRef>0) { saida += parcelaRef; parts.push('Reforma'); }
      const entrada = i===pVenda ? metricas.receitaLiquida : (d.valorLocacao>0 && !isUsoProprio ? d.valorLocacao : 0);
      saldo += entrada - saida;
      totalSaidas += saida;
      linhas.push({ mes:i, entrada, saida, descricao: parts.join('+')||'Manutenção', saldo });
    }
    return { linhas, totalSaidas, totalEntradas: metricas.receitaLiquida };
  }, [d, metricas, isAVista, isUsoProprio]);

  const showMsg = (text, type='success') => { setMsg({ text, type }); setTimeout(()=>setMsg({text:'',type:''}), 3500); };

  const extrairDoc = async () => {
    if (!textoDoc.trim() && !textoMatricula.trim()) { showMsg('Cole o texto do edital ou matrícula primeiro.','error'); return; }
    setLoadDoc(true);
    try {
      // Combina edital + matrícula para extração unificada (top2+)
      const textoCompleto = [
        textoDoc.trim() ? `=== EDITAL ===\n${textoDoc.trim()}` : '',
        textoMatricula.trim() ? `=== MATRÍCULA ===\n${textoMatricula.trim()}` : '',
      ].filter(Boolean).join('\n\n');
      const ext = await extrairDadosDocumento(textoCompleto);
      if (ext) {
        setD(p => ({
          ...p, ...ext,
          valorMercado: ext.valorMercado || (ext.valorAvaliacao ? ext.valorAvaliacao*1.15 : p.valorMercado),
          riscos: ext.riscos ? ext.riscos.map(r => ({
            id: Date.now()+Math.random(), texto: r, tipo:
              r.toLowerCase().includes('usufruto')||r.toLowerCase().includes('bloqueio')||r.toLowerCase().includes('impedimento') ? 'bloqueante' : 'alerta'
          })) : p.riscos,
        }));
        setOpenSec(p => ({ ...p, doc:false, dados:true, viabilidade:true }));
        showMsg('Dados extraídos com sucesso!');
      }
    } catch { showMsg('Erro ao extrair dados.','error'); }
    setLoadDoc(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type==='text/plain') { setTextoDoc(await file.text()); }
    else { showMsg('Use arquivos .txt ou cole o texto. PDF em breve.','error'); }
  };

  const analisarMercadoClick = async () => {
    if (!d.endereco && !d.cidade) { showMsg('Preencha o endereço ou cidade antes.','error'); return; }
    setLoadMercado(true);
    try {
      const res = await analisarMercado({
        endereco: d.endereco||d.cidade, tipoImovel: d.tipo,
        areaM2: d.areaM2, cidade: d.cidade, estado: d.estado,
        nomeCondominio: d.nomeCondominio||'',
      });
      setMercado(res);
      if (res?.precoMedioM2 && d.areaM2) up('valorMercado', Math.round(res.precoMedioM2*d.areaM2*0.9));
      if (res?.aluguelMedio) up('valorLocacao', Math.round(res.aluguelMedio));
      setOpenSec(p => ({ ...p, mercado:true, viabilidade:true }));
      showMsg('Avaliação mercadológica concluída!');
    } catch { showMsg('Erro na análise de mercado.','error'); }
    setLoadMercado(false);
  };

  const gerarParecerClick = async () => {
    setLoadParecer(true);
    try {
      const txt = await gerarParecer({ ...d, _cenario:isAVista?'À Vista':'Alavancado', _teto:teto }, metricas, mercado);
      setParecer(txt);
      setD(p => ({ ...p, parecer:txt }));
      setOpenSec(p => ({ ...p, laudo:true }));
      showMsg('Laudo gerado com sucesso!');
    } catch { showMsg('Erro ao gerar laudo.','error'); }
    setLoadParecer(false);
  };

  const salvar = async () => {
    const list = loadImoveis();
    const idx = list.findIndex(i => i.id===d.id);
    const isNovo = idx < 0;
    const entry = { ...d, parecer, mercado, updatedAt: new Date().toISOString() };
    saveImoveis(isNovo ? [...list, entry] : list.map(i=>i.id===d.id?entry:i));
    setSaved(true); showMsg('Imóvel salvo no portfólio!');
    setTimeout(()=>setSaved(false), 2500);

    // Salva/atualiza no banco (relatorios) — falha silenciosa não afeta o portfólio local
    if (user) {
      try {
        const isArrematado = d.status === 'arrematado';
        const expiraEm = isArrematado ? null : new Date(Date.now() + 90*24*60*60*1000).toISOString();
        const payload = {
          user_id: user.id,
          imovel_id: imovelInicial?.id || d.id,
          imovel_nome: d.nome,
          imovel_cidade: d.cidade,
          imovel_estado: d.estado,
          valor_minimo: d.valorArrematacao || null,
          valor_avaliacao: d.valorAvaliacao || null,
          desconto_percentual: d.valorAvaliacao > 0 ? Math.round((1 - d.valorArrematacao / d.valorAvaliacao) * 100) : null,
          status: d.status || 'analise',
          dados: { ...d, mercado },
          parecer: parecer || null,
          arrematado: isArrematado,
          data_arrematacao: isArrematado ? (d.dataArrematacao || new Date().toISOString()) : null,
          expira_em: expiraEm,
        };
        const { data: existing, error: existErr } = await supabase.from('relatorios')
          .select('id').eq('user_id', user.id).eq('imovel_id', payload.imovel_id).maybeSingle();
        if (!existErr) {
          if (existing?.id) {
            await supabase.from('relatorios').update(payload).eq('id', existing.id);
          } else {
            await supabase.from('relatorios').insert(payload);
          }
        }
      } catch { /* portfólio local já foi salvo — erro de rede não bloqueia o usuário */ }
    }

    // Contabiliza análise para top1 (só conta ao salvar pela primeira vez)
    if (role === 'top1' && user && isNovo) {
      const mes = mesAtual();
      const novoCount = analisesUsadas + 1;
      if (role === 'explorador') {
        const novoBonus = Math.max(0, analisesBonus - 1);
        await supabase.from('perfis').update({ analises_bonus: novoBonus }).eq('id', user.id);
        setAnalisesBonus(novoBonus);
        if (novoBonus <= 0) setAnalisesBloqueado(true);
      } else {
        await supabase.from('perfis').update({ analises_mes: mes, analises_count: novoCount }).eq('id', user.id);
        setAnalisesUsadas(novoCount);
        if (novoCount >= limiteRole) setAnalisesBloqueado(true);
      }
    }
  };

  const imprimirPDF = () => gerarPDF({ d, metricas, metricasTeto, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTab, priceTab, mercado, parecer });

  const solicitarAnalista = async () => {
    if (!user || solicitando || solicitado) return;
    setSolicitando(true);
    const { error } = await supabase.from('solicitacoes').insert({
      user_id: user.id,
      imovel_ref: d.id || null,
      imovel_nome: d.nome || d.endereco || 'Imóvel sem nome',
      imovel_cidade: d.cidade || '',
      tipo: 'consulta',
      status: 'solicitado',
      notas_analista: `Laudo gerado. Desconto: ${d.valorAvaliacao > 0 ? ((1 - d.valorArrematacao / d.valorAvaliacao) * 100).toFixed(1) : '?'}%. Pedido de revisão pelo cliente.`,
    });
    setSolicitando(false);
    if (!error) {
      setSolicitado(true);
      showMsg('Solicitação enviada! Nossa equipe entrará em contato em breve.', 'success');
    } else {
      showMsg('Erro ao enviar solicitação. Tente novamente.', 'error');
    }
  };

  const descontoArremate = d.valorAvaliacao>0 ? ((1 - d.valorArrematacao/d.valorAvaliacao)*100) : 0;

  return (
    <div style={{ maxWidth: 960, margin:'0 auto', padding: isMobile ? '12px' : '20px', display:'flex', flexDirection:'column', gap:14 }}>

      {/* HEADER */}
      <div style={{ background:'#0f172a', borderRadius:16, padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:11, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Análise de Viabilidade</div>
          <div style={{ fontSize:18, fontWeight:900, color:'white', lineHeight:1.2 }}>{d.nome||'Novo Imóvel'}</div>
          {d.cidade && <div style={{ fontSize:12, color:'#94a3b8', marginTop:3, display:'flex', alignItems:'center', gap:5 }}><MapPin size={11}/>{d.cidade}{d.estado?`, ${d.estado}`:''}</div>}
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <select name="status" value={d.status||'analise'} onChange={upN}
            style={{ fontSize:12, fontWeight:700, border:'1px solid #334155', borderRadius:8, padding:'7px 10px', background:'#1e293b', color:'white' }}>
            {STATUS_OPTS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
          </select>
          <button onClick={salvar} style={{ padding:'8px 16px', background:saved?'#10b981':'#2563eb', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6, transition:'background 0.2s' }}>
            {saved ? <><CheckCircle2 size={14}/> Salvo!</> : <><Save size={14}/> Salvar</>}
          </button>
          {parecer && (
            <button onClick={imprimirPDF} style={{ padding:'8px 14px', background:'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              <Printer size={14}/> PDF
            </button>
          )}
        </div>
      </div>

      {/* Contador de análises por role */}
      {!semLimite && (
        <div style={{ padding:'10px 16px', borderRadius:10, background: analisesBloqueado ? '#fee2e2' : role === 'explorador' ? '#eff6ff' : '#fef3c7', color: analisesBloqueado ? '#dc2626' : role === 'explorador' ? '#1e40af' : '#92400e', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <span>{analisesBloqueado
            ? (role === 'explorador'
                ? '🔒 Suas análises bônus foram utilizadas. Faça upgrade para continuar.'
                : `🔒 Limite de ${limiteRole} análises mensais atingido.`)
            : role === 'explorador'
              ? `🎁 Análises bônus disponíveis: ${analisesBonus}`
              : `📊 Análises este mês: ${analisesUsadas}/${limiteRole}`
          }</span>
          {analisesBloqueado && (
            <button onClick={() => nav('/planos')} style={{ padding:'6px 14px', background:'#dc2626', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
              Ver planos
            </button>
          )}
        </div>
      )}

      {msg.text && <div style={{ padding:'10px 16px', borderRadius:10, background:msg.type==='error'?'#fee2e2':'#d1fae5', color:msg.type==='error'?'#dc2626':'#065f46', fontSize:12, fontWeight:700 }}>{msg.text}</div>}

      {/* ALERTA BLOQUEANTE */}
      {riscosBloqueantes.length>0 && (
        <div style={{ background:'#fef2f2', border:'2px solid #dc2626', borderRadius:14, padding:'14px 18px', display:'flex', gap:12 }}>
          <ShieldAlert size={22} color="#dc2626" style={{flexShrink:0,marginTop:2}}/>
          <div>
            <div style={{ fontWeight:900, color:'#b91c1c', fontSize:14, marginBottom:6 }}>⚠ RISCO JURÍDICO BLOQUEANTE — OPERAÇÃO SUSPENSA</div>
            {riscosBloqueantes.map(r=><div key={r.id} style={{color:'#dc2626',fontSize:12,marginBottom:2}}>• {r.texto}</div>)}
          </div>
        </div>
      )}

      {/* ── ETAPA 1: DOCUMENTO ── */}
      <Section step="1" title="Edital" icon={FileText} color="#2563eb" open={openSec.doc} onToggle={()=>toggleSec('doc')} badge="Upload ou cole o texto">
        <div style={{ display:'flex', flexDirection:'column', gap:12, paddingTop:14 }}>
          <textarea value={textoDoc} onChange={e=>setTextoDoc(e.target.value)} rows={7}
            placeholder="Cole aqui o texto do edital do leilão. A extração irá capturar endereço, valores, área, leiloeiro, riscos jurídicos, ônus, débitos, datas e muito mais..."
            style={{ width:'100%', padding:'12px', border:'1px solid #e2e8f0', borderRadius:10, fontSize:13, color:'#0f172a', resize:'vertical', boxSizing:'border-box', lineHeight:1.6, fontFamily:'inherit' }}/>
          <div style={{ display:'flex', gap:8 }}>
            <label style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'10px', border:'2px dashed #e2e8f0', borderRadius:10, color:'#64748b', fontSize:13, fontWeight:600, cursor:'pointer', transition:'border-color 0.2s' }}
              onMouseEnter={e=>e.currentTarget.style.borderColor='#2563eb'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e2e8f0'}>
              <UploadCloud size={16}/> Upload .TXT
              <input type="file" accept=".txt" onChange={handleFileUpload} style={{display:'none'}}/>
            </label>
            <button onClick={extrairDoc} disabled={loadDoc||analisesBloqueado||(!textoDoc.trim()&&!textoMatricula.trim())}
              style={{ flex:2, padding:'10px', background:(textoDoc.trim()||textoMatricula.trim())&&!analisesBloqueado?'#2563eb':'#e2e8f0', color:(textoDoc.trim()||textoMatricula.trim())&&!analisesBloqueado?'white':'#94a3b8', border:'none', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              {loadDoc ? <><Loader2 size={15} style={{animation:'spin 1s linear infinite'}}/> Extraindo dados...</> : analisesBloqueado ? <><Lock size={14}/> Limite atingido</> : <><Sparkles size={15}/> Extrair dados</>}
            </button>
          </div>
          <div style={{ display:'flex', gap:8, fontSize:11, color:'#94a3b8' }}>
            <Info size={12} style={{flexShrink:0,marginTop:1}}/>
            <span>Extrai: endereço, valores, área, leiloeiro, riscos jurídicos, ônus, débitos, laudêmio, datas e muito mais.</span>
          </div>
        </div>
      </Section>

      {/* ── ETAPA 1B: MATRÍCULA (Investidor Pro e acima) ── */}
      {['top2','assessorado','clube','analista','advogado','admin'].includes(role) && (
        <Section step="1B" title="Matrícula do Imóvel" icon={ClipboardList} color="#7c3aed" open={openSec.matricula ?? false} onToggle={()=>toggleSec('matricula')} badge="Incluso no Investidor Pro">
          <div style={{ display:'flex', flexDirection:'column', gap:12, paddingTop:14 }}>
            <div style={{ background:'#ede9fe', border:'1px solid #c4b5fd', borderRadius:10, padding:'10px 14px', fontSize:12, color:'#6d28d9' }}>
              <strong>Investidor Pro:</strong> Cole a matrícula do imóvel junto com o edital. Os dois documentos são extraídos juntos em uma única análise, identificando ônus, usufrutos, hipotecas, alienações e histórico de proprietários.
            </div>
            <textarea value={textoMatricula} onChange={e=>setTextoMatricula(e.target.value)} rows={6}
              placeholder="Cole aqui o texto da matrícula do imóvel (certidão de inteiro teor). A análise identificará automaticamente ônus reais, hipotecas, penhoras, usufrutos, alienação fiduciária e histórico de proprietários..."
              style={{ width:'100%', padding:'12px', border:'1px solid #c4b5fd', borderRadius:10, fontSize:13, color:'#0f172a', resize:'vertical', boxSizing:'border-box', lineHeight:1.6, fontFamily:'inherit' }}/>
            <label style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'10px', border:'2px dashed #c4b5fd', borderRadius:10, color:'#7c3aed', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              <UploadCloud size={16}/> Upload matrícula .TXT
              <input type="file" accept=".txt" onChange={async e => { const f = e.target.files[0]; if (f) setTextoMatricula(await f.text()); }} style={{display:'none'}}/>
            </label>
          </div>
        </Section>
      )}

      {/* ── ETAPA 1C: CONSULTA JURÍDICA CNJ — apenas roles com CNJ ── */}
      {!temCNJ && (
        <div style={{ padding:'12px 16px', borderRadius:10, background:'#f8fafc', border:'1px solid #e2e8f0', fontSize:13, color:'#64748b', display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <Lock size={15} color="#94a3b8"/>
          <span>Consulta Jurídica CNJ disponível a partir do plano <strong>Investidor Pro</strong>.</span>
          <button onClick={() => nav('/planos')} style={{ marginLeft:'auto', padding:'5px 12px', background:'#2563eb', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer' }}>Ver planos</button>
        </div>
      )}
      {temCNJ && <Section step="1C" title="Consulta Jurídica — CNJ DataJud" icon={Scale} color="#dc2626"
        open={openSec.cnj ?? false} onToggle={() => toggleSec('cnj')}
        badge="Investidor Pro">

        {!cenario_role_pro.includes(role) ? (
          /* Tela de bloqueio para planos abaixo do Investidor Pro */
          <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#fef2f2', border: '2px solid #fca5a5', borderRadius: 14, padding: '22px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center' }}>
              <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Lock size={26} color="#dc2626" />
              </div>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#b91c1c', marginBottom: 6 }}>Consulta Jurídica disponível no Investidor Pro</div>
                <div style={{ fontSize: 13, color: '#dc2626', lineHeight: 1.7, maxWidth: 420 }}>
                  Busque o processo judicial pelo número CNJ ou nome da parte diretamente no tribunal. Identifica penhoras, arrestos, hastas públicas e todas as movimentações processuais em tempo real.
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 360 }}>
                {[
                  'Busca por número do processo (CNJ)',
                  'Busca por nome da parte / executado',
                  'Detecção automática de penhoras e arrestos',
                  'Histórico completo de movimentações',
                  'Adição automática de riscos jurídicos',
                ].map(item => (
                  <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'white', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#334155' }}>
                    <CheckCircle2 size={14} color="#dc2626" /> {item}
                  </div>
                ))}
              </div>
              <button onClick={() => nav('/planos')}
                style={{ padding: '11px 28px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
                Conhecer o Investidor Pro
              </button>
            </div>
          </div>
        ) : (
          /* Funcionalidade completa para Investidor Pro+ */
          <div style={{ paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#b91c1c', lineHeight: 1.6 }}>
              <strong>DataJud — CNJ:</strong> Busca o processo diretamente no tribunal do estado informado na Etapa 2. Penhoras e arrestos são adicionados automaticamente como riscos jurídicos.
            </div>

            {/* Formulário de busca */}
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Número do Processo (CNJ)</label>
                <input value={cnjNumero} onChange={e => setCnjNumero(e.target.value)}
                  placeholder="0000000-00.0000.8.26.0000"
                  style={{ width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', boxSizing: 'border-box' }} />
              </div>
              <div>
                <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.5 }}>Nome da Parte / Executado</label>
                <input value={cnjNome} onChange={e => setCnjNome(e.target.value)}
                  placeholder="Nome completo ou CPF/CNPJ"
                  style={{ width: '100%', padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, background: 'white', boxSizing: 'border-box' }} />
              </div>
            </div>

            <button onClick={buscarCNJ} disabled={loadCnj || (!cnjNumero.trim() && !cnjNome.trim())}
              style={{ width: '100%', padding: '11px', background: loadCnj ? '#fca5a5' : '#dc2626', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {loadCnj ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Consultando DataJud...</> : <><Search size={15} /> Buscar no CNJ DataJud</>}
            </button>

            {cnjErro && (
              <div style={{ padding: '10px 14px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#dc2626', display: 'flex', gap: 8 }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {cnjErro}
              </div>
            )}

            {/* Resultados */}
            {cnjResultados && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

                {/* Parecer consolidado */}
                {(() => {
                  const p = cnjResultados.parecer;
                  const cores = { vermelho: ['#fef2f2','#dc2626','#fee2e2'], amarelo: ['#fefce8','#d97706','#fef3c7'], verde: ['#f0fdf4','#16a34a','#dcfce7'] };
                  const [bg, cor, borda] = cores[p?.nivel] || cores.verde;
                  return (
                    <div style={{ background: bg, border: `2px solid ${borda}`, borderRadius: 12, padding: '14px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                        {p?.nivel === 'vermelho' ? <ShieldAlert size={18} color={cor} /> : p?.nivel === 'amarelo' ? <AlertTriangle size={18} color={cor} /> : <CheckCircle2 size={18} color={cor} />}
                        <span style={{ fontWeight: 900, fontSize: 13, color: cor }}>
                          {p?.nivel === 'vermelho' ? 'RISCO ALTO — ATENÇÃO ANTES DE ARREMATAR' : p?.nivel === 'amarelo' ? 'RISCOS A MONITORAR' : 'VIABILIDADE JURÍDICA PRELIMINAR FAVORÁVEL'}
                        </span>
                      </div>
                      <p style={{ margin: 0, fontSize: 12, color: cor, lineHeight: 1.7 }}>{p?.texto}</p>
                      {p?.recomendacao && <p style={{ margin: '8px 0 0', fontSize: 11, color: cor, fontStyle: 'italic', lineHeight: 1.6 }}>→ {p.recomendacao}</p>}
                      <div style={{ marginTop: 10, fontSize: 11, color: '#94a3b8' }}>
                        Tribunais consultados: {cnjResultados.tribunais_consultados?.map(t => t.toUpperCase()).join(', ')} · {cnjResultados.total} processo(s) encontrado(s)
                        {cnjResultados.erros?.length > 0 && <span style={{ color: '#f59e0b' }}> · {cnjResultados.erros.length} tribunal(is) indisponível(is)</span>}
                      </div>
                    </div>
                  );
                })()}

                {cnjResultados.total === 0 && (
                  <div style={{ padding: '16px', background: '#f8fafc', borderRadius: 10, fontSize: 12, color: '#64748b', textAlign: 'center' }}>
                    Nenhum processo encontrado nos tribunais consultados. Verifique também no cartório de registro de imóveis.
                  </div>
                )}

                {cnjResultados.processos?.map((proc, idx) => (
                  <div key={idx} style={{ border: `2px solid ${proc.tem_bloqueante ? '#fca5a5' : proc.riscos?.length > 0 ? '#fde68a' : '#e2e8f0'}`, borderRadius: 12, overflow: 'hidden' }}>

                    {/* Header do processo */}
                    <div style={{ background: proc.tem_bloqueante ? '#fef2f2' : proc.riscos?.length > 0 ? '#fefce8' : '#f8fafc', padding: '12px 16px', borderBottom: '1px solid #e2e8f0' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                        <Scale size={13} color={proc.tem_bloqueante ? '#dc2626' : '#64748b'} />
                        <span style={{ fontWeight: 800, fontSize: 13, color: '#0f172a' }}>{proc.numero}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: '#e2e8f0', color: '#475569' }}>{proc.tribunal}</span>
                        {proc.riscos?.filter(r => r.severidade === 'bloqueante').map(r => (
                          <span key={r.categoria} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#fee2e2', color: '#dc2626' }}>⛔ {r.categoria}</span>
                        ))}
                        {proc.riscos?.filter(r => r.severidade === 'alerta').map(r => (
                          <span key={r.categoria} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: '#fef3c7', color: '#92400e' }}>⚠ {r.categoria}</span>
                        ))}
                      </div>
                      <div style={{ fontSize: 12, color: '#64748b' }}>
                        {proc.classe}{proc.assuntos ? ` — ${proc.assuntos}` : ''} · Fase: <strong>{proc.fase}</strong>
                      </div>
                    </div>

                    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>

                      {/* KPIs do processo */}
                      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap: 8 }}>
                        {[
                          ['Órgão Julgador', proc.orgao],
                          ['Ajuizado em', proc.data_ajuizamento],
                          ['Última mov.', proc.ultima_atualizacao],
                          proc.valor_causa ? ['Valor da Causa', `R$ ${Number(proc.valor_causa).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`] : null,
                        ].filter(Boolean).map(([l, v]) => (
                          <div key={l} style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 10px' }}>
                            <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>{l}</div>
                            <div style={{ fontSize: 11, color: '#334155', fontWeight: 600 }}>{v || '—'}</div>
                          </div>
                        ))}
                      </div>

                      {/* Score de risco */}
                      {proc.score_risco > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, flexShrink: 0 }}>Score de risco:</span>
                          <div style={{ flex: 1, height: 8, background: '#e2e8f0', borderRadius: 4, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${proc.score_risco}%`, background: proc.score_risco >= 70 ? '#dc2626' : proc.score_risco >= 35 ? '#f59e0b' : '#10b981', borderRadius: 4, transition: 'width 0.5s' }} />
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 900, color: proc.score_risco >= 70 ? '#dc2626' : proc.score_risco >= 35 ? '#f59e0b' : '#10b981', flexShrink: 0 }}>{proc.score_risco}/100</span>
                        </div>
                      )}

                      {/* Partes */}
                      {proc.partes?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#2563eb', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.5 }}>Partes Processuais</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {proc.partes.map((parte, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', background: i % 2 === 0 ? '#f8fafc' : 'white', borderRadius: 6, fontSize: 12 }}>
                                <User size={12} color="#64748b" style={{ flexShrink: 0, marginTop: 1 }} />
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontWeight: 700, color: '#0f172a' }}>{parte.nome}</span>
                                  {parte.tipo && <span style={{ color: '#94a3b8', marginLeft: 6, fontSize: 11 }}>({parte.tipo})</span>}
                                  {parte.documento && <span style={{ color: '#64748b', marginLeft: 6, fontSize: 10 }}>{parte.documento}</span>}
                                  {parte.advogados?.length > 0 && (
                                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
                                      Adv: {parte.advogados.map(a => `${a.nome}${a.oab ? ` (OAB ${a.oab})` : ''}`).join(', ')}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Movimentações */}
                      {proc.movimentos?.length > 0 && (
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.5 }}>Movimentações Recentes ({proc.movimentos.length})</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 280, overflowY: 'auto' }}>
                            {proc.movimentos.map((mov, i) => (
                              <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '6px 10px', background: mov.risco === 'bloqueante' ? '#fef2f2' : mov.risco === 'alerta' ? '#fefce8' : i % 2 === 0 ? '#f8fafc' : 'white', borderRadius: 6, fontSize: 11 }}>
                                <div style={{ flexShrink: 0, color: '#94a3b8', fontSize: 10, paddingTop: 1, minWidth: 76 }}>{mov.data}</div>
                                <span style={{ color: mov.risco === 'bloqueante' ? '#dc2626' : mov.risco === 'alerta' ? '#92400e' : '#334155', lineHeight: 1.5 }}>
                                  {mov.risco && <strong>[{mov.risco === 'bloqueante' ? '⛔' : '⚠'}] </strong>}{mov.descricao}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>}

      {/* ── ETAPA 2: DADOS DO IMÓVEL ── */}
      <Section step="2" title="Dados do Imóvel" icon={Home} color="#0f172a" open={openSec.dados} onToggle={()=>toggleSec('dados')}
        badge={d.nome ? d.tipo.charAt(0).toUpperCase()+d.tipo.slice(1) : 'Preencha ou extraia do edital'}>
        <div style={{ display:'flex', flexDirection:'column', gap:18, paddingTop:14 }}>

          {/* Identificação */}
          <div>
            <div style={{ fontSize:11, fontWeight:800, color:'#2563eb', textTransform:'uppercase', letterSpacing:1, marginBottom:10, paddingBottom:6, borderBottom:'2px solid #eff6ff' }}>Identificação</div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:12 }}>
              <div style={{ gridColumn:'span 2' }}>
                <Field label="Nome / Referência" name="nome" value={d.nome||''} onChange={upN} ph="Ex: Apt 302 Torre Norte — Rua das Flores"/>
              </div>
              <Field label="Tipo de Imóvel" name="tipo" value={d.tipo} onChange={upN} type="select" opts={TIPO_OPTS}/>
              <Field label="Modalidade" name="origem" value={d.origem||'extrajudicial'} onChange={upN} type="select" opts={[['extrajudicial','Extrajudicial'],['judicial','Judicial']]}/>
              <div style={{ gridColumn:'span 2' }}>
                <Field label="Endereço Completo" name="endereco" value={d.endereco||''} onChange={upN} type="textarea" rows={2} ph="Rua, número, complemento, bairro"/>
              </div>
              <Field label="Nome do Condomínio (se houver)" name="nomeCondominio" value={d.nomeCondominio||''} onChange={upN} ph="Ex: Residencial Park View"/>
              <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr', gap:10 }}>
                <Field label="Cidade" name="cidade" value={d.cidade||''} onChange={upN}/>
                <Field label="UF" name="estado" value={d.estado||''} onChange={upN} ph="SP"/>
              </div>
              <Field label="Objetivo da Compra" name="objetivoCompra" value={d.objetivoCompra} onChange={upN} type="select" opts={[['investimento','Investimento'],['uso_proprio','Uso Próprio']]}/>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <Field label="Leiloeiro" name="leiloeiro" value={d.leiloeiro||''} onChange={upN}/>
                <Field label="Data do Leilão" name="dataLeilao" value={d.dataLeilao||''} onChange={upN} type="date"/>
              </div>
            </div>
          </div>

          {/* Valores */}
          <div>
            <div style={{ fontSize:11, fontWeight:800, color:'#10b981', textTransform:'uppercase', letterSpacing:1, marginBottom:10, paddingBottom:6, borderBottom:'2px solid #f0fdf4' }}>Valores do Leilão</div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3,1fr)', gap:12 }}>
              <Field label="Avaliação do Edital (R$)" name="valorAvaliacao" value={d.valorAvaliacao||0} onChange={upN} type="number" prefix="R$"/>
              <Field label="Lance / Arrematação (R$)" name="valorArrematacao" value={d.valorArrematacao||0} onChange={upN} type="number" prefix="R$"/>
              <div style={{ background:'#fef3c7', borderRadius:10, padding:'10px 12px' }}>
                <div style={{ fontSize:10, color:'#92400e', fontWeight:700, textTransform:'uppercase', marginBottom:4 }}>Desconto</div>
                <div style={{ fontSize:26, fontWeight:900, color:descontoArremate>30?'#16a34a':'#d97706' }}>{fmtPct(descontoArremate)}</div>
                <div style={{ fontSize:10, color:'#92400e' }}>sobre avaliação</div>
              </div>
              <Field label="Área Privativa (m²)" name="areaM2" value={d.areaM2||0} onChange={upN} type="number"/>
              <Field label="Área Terreno (m²)" name="areaTerrenoM2" value={d.areaTerrenoM2||0} onChange={upN} type="number"/>
              <Field label="Preço de Mercado / VGV (R$)" name="valorMercado" value={d.valorMercado||0} onChange={upN} type="number" prefix="R$"/>
            </div>
          </div>

          {/* Custos */}
          <div>
            <div style={{ fontSize:11, fontWeight:800, color:'#8b5cf6', textTransform:'uppercase', letterSpacing:1, marginBottom:10, paddingBottom:6, borderBottom:'2px solid #ede9fe' }}>Custos e Encargos</div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3,1fr)', gap:12 }}>
              <Field label="Taxa Leiloeiro (%)" name="taxaLeiloeiroPercentual" value={d.taxaLeiloeiroPercentual||5} onChange={upN} type="number"/>
              <Field label="ITBI + Registro (%)" name="itbiPercentual" value={d.itbiPercentual||3} onChange={upN} type="number"/>
              <div style={{ background:'#f0fdf4', borderRadius:10, padding:'10px 12px' }}>
                <div style={{ fontSize:10, color:'#16a34a', fontWeight:700, textTransform:'uppercase', marginBottom:4 }}>Honorários TSN (fixo 10%)</div>
                <div style={{ fontSize:20, fontWeight:900, color:'#15803d' }}>R$ {fmt((d.valorArrematacao||0)*0.10, 0)}</div>
              </div>
              <Field label="IPTU Mensal (R$)" name="iptuMensal" value={d.iptuMensal||0} onChange={upN} type="number"/>
              <Field label="Condomínio (R$)" name="condominioMensal" value={d.condominioMensal||0} onChange={upN} type="number"/>
              <Field label="Débitos Assumidos (R$)" name="debitosAssumidos" value={d.debitosAssumidos||0} onChange={upN} type="number"/>
              <Field label="Reforma / Retrofit (R$)" name="manutencaoEstimada" value={d.manutencaoEstimada||0} onChange={upN} type="number"/>
              <Field label="Prazo Reforma (meses)" name="prazoReformaMeses" value={d.prazoReformaMeses||3} onChange={upN} type="number"/>
              <Field label="Prazo p/ Venda (meses)" name="prazoVendaMeses" value={d.prazoVendaMeses||12} onChange={upN} type="number"/>
              <Field label="Laudêmio (R$)" name="laudemio" value={d.laudemio||0} onChange={upN} type="number"/>
              <Field label="Foreiro (R$)" name="foreiro" value={d.foreiro||0} onChange={upN} type="number"/>
              <Field label="Locação Ref. Mensal (R$)" name="valorLocacao" value={d.valorLocacao||0} onChange={upN} type="number"/>
            </div>
          </div>

          {/* Financiamento */}
          <div>
            <div style={{ fontSize:11, fontWeight:800, color:'#f59e0b', textTransform:'uppercase', letterSpacing:1, marginBottom:10, paddingBottom:6, borderBottom:'2px solid #fef3c7' }}>Financiamento</div>
            <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:12 }}>
              <div style={{ gridColumn: isMobile ? 'span 2' : 'span 4', background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:10, padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:8 }}>
                <span style={{ fontSize:12, fontWeight:700, color:'#c2410c' }}>Condição de Pagamento</span>
                <select value={d.somenteAVista?'sim':'nao'} onChange={e=>up('somenteAVista',e.target.value==='sim')}
                  style={{ fontSize:12, fontWeight:700, border:'1px solid #fed7aa', borderRadius:8, padding:'5px 10px', background:'white', color:'#c2410c' }}>
                  <option value="nao">Aceita Financiamento / Alavancado</option>
                  <option value="sim">Exclusivamente À Vista</option>
                </select>
              </div>
              <Field label="Sinal (%)" name="sinalPercentual" value={d.sinalPercentual||5} onChange={upN} type="number"/>
              <Field label="Prazo (meses)" name="prazoMeses" value={d.prazoMeses||360} onChange={upN} type="number"/>
              <Field label="CET / Juros a.a. (%)" name="cetAnual" value={d.cetAnual||12} onChange={upN} type="number"/>
              <div>
                <label style={lbl}>Tabela</label>
                <div style={{ display:'flex', gap:6 }}>
                  {[['sac','SAC'],['price','PRICE']].map(([v,l])=>(
                    <button key={v} onClick={()=>up('tabelaAmortizacao',v)}
                      style={{ flex:1, padding:'9px', border:'none', borderRadius:8, background:(d.tabelaAmortizacao||'sac')===v?'#0f172a':'#f1f5f9', color:(d.tabelaAmortizacao||'sac')===v?'white':'#64748b', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Riscos e Observações */}
          <div>
            <div style={{ fontSize:11, fontWeight:800, color:'#ef4444', textTransform:'uppercase', letterSpacing:1, marginBottom:10, paddingBottom:6, borderBottom:'2px solid #fef2f2' }}>Riscos Jurídicos</div>
            <RiscoJuridico riscos={d.riscos||[]} onChange={r=>up('riscos',r)}/>
          </div>
          <div>
            <Field label="Observações / Notas de Visita" name="observacoes" value={d.observacoes||''} onChange={upN} type="textarea" rows={3} ph="Anotações de visita, pontos de atenção, potencial de negociação..."/>
          </div>
          <Lancamentos lancamentos={d.lancamentos||[]} onChange={l=>up('lancamentos',l)}/>
        </div>
      </Section>

      {/* ── ETAPA 3: AVALIAÇÃO MERCADOLÓGICA ── */}
      <Section step="3" title="Avaliação Mercadológica" icon={BarChart3} color="#10b981" open={openSec.mercado} onToggle={()=>toggleSec('mercado')}
        badge={mercado ? `Nível 1: ${mercado.nivel1?.totalAmostras||0} amostras · Nível 2: ${mercado.nivel2?.totalAmostras||0} amostras` : 'Comparativos de venda e locação'}>
        <div style={{ display:'flex', flexDirection:'column', gap:16, paddingTop:14 }}>
          <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:12, padding:'14px 16px', display:'flex', gap:12, alignItems:'flex-start' }}>
            <Info size={15} color="#16a34a" style={{flexShrink:0,marginTop:1}}/>
            <div style={{ fontSize:12, color:'#15803d', lineHeight:1.6 }}>
              <strong>Dois níveis de pesquisa:</strong> A IA busca o máximo de amostras <strong>no mesmo condomínio/endereço</strong> (Nível 1) e depois no <strong>bairro/vizinhança</strong> (Nível 2), tanto para venda quanto para locação. Preencha o endereço e nome do condomínio na etapa anterior para resultados mais precisos.
            </div>
          </div>

          <button onClick={analisarMercadoClick} disabled={loadMercado}
            style={{ width:'100%', padding:'13px', background:loadMercado?'#6ee7b7':'#10b981', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {loadMercado ? <><Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/> Pesquisando amostras no mercado...</> : <><BarChart3 size={16}/> {mercado ? 'Atualizar Pesquisa de Mercado' : 'Iniciar Avaliação Mercadológica com IA'}</>}
          </button>

          {mercado && (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

              {/* KPIs consolidados */}
              <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:10 }}>
                {[
                  ['Preço Médio/m²', `R$ ${fmt(mercado.precoMedioM2||0,0)}`, '#2563eb','#eff6ff'],
                  ['Aluguel Médio', `R$ ${fmt(mercado.aluguelMedio||0,0)}/mês`, '#8b5cf6','#ede9fe'],
                  ['Yield Bruto', fmtPct(mercado.yieldBruto||0)+' a.a.', '#10b981','#f0fdf4'],
                  ['Yield Líquido', fmtPct(mercado.yieldLiquido||0)+' a.a.', '#f59e0b','#fef3c7'],
                ].map(([l,v,c,bg])=>(
                  <div key={l} style={{background:bg,borderRadius:12,padding:'14px 16px',textAlign:'center',border:`1px solid ${c}30`}}>
                    <div style={{fontSize:9,color:c,fontWeight:800,textTransform:'uppercase',marginBottom:6,letterSpacing:0.5}}>{l}</div>
                    <div style={{fontSize:20,fontWeight:900,color:c}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Nível 1 — Mesmo Condomínio */}
              <div style={{ borderRadius:12, border:'2px solid #2563eb', overflow:'hidden' }}>
                <div style={{ background:'#2563eb', padding:'10px 16px', display:'flex', alignItems:'center', gap:8 }}>
                  <Building2 size={15} color="white"/>
                  <span style={{ fontWeight:800, color:'white', fontSize:13 }}>Nível 1 — {mercado.nivel1?.descricao||'Mesmo Condomínio / Endereço'}</span>
                  <span style={{ marginLeft:'auto', background:'rgba(255,255,255,0.2)', borderRadius:20, padding:'2px 10px', fontSize:11, fontWeight:700, color:'white' }}>
                    {mercado.nivel1?.totalAmostras||0} amostras
                  </span>
                </div>
                <div style={{ padding:14, display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:14 }}>
                  {mercado.nivel1?.vendas?.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#2563eb', textTransform:'uppercase', marginBottom:8 }}>Venda — {mercado.nivel1.vendas.length} imóveis</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:8 }}>
                        {[['Mín R$/m²',`${fmt(mercado.nivel1.precoMinM2||0,0)}`,'#ef4444'],['Médio R$/m²',`${fmt(mercado.nivel1.precoMedioM2||0,0)}`,'#2563eb'],['Máx R$/m²',`${fmt(mercado.nivel1.precoMaxM2||0,0)}`,'#10b981']].map(([l,v,c])=>(
                          <div key={l} style={{ background:'#f8fafc', borderRadius:8, padding:'8px 10px', textAlign:'center' }}>
                            <div style={{ fontSize:9, color:'#94a3b8', fontWeight:700, textTransform:'uppercase', marginBottom:2 }}>{l}</div>
                            <div style={{ fontSize:14, fontWeight:900, color:c }}>R$ {v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {mercado.nivel1.vendas.map((v,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:i%2===0?'#f8fafc':'white', borderRadius:6, fontSize:11 }}>
                            <span style={{ color:'#334155', flex:1, marginRight:8 }}>{v.descricao} <span style={{ color:'#94a3b8' }}>({v.fonte})</span></span>
                            <span style={{ fontWeight:700, color:'#2563eb', flexShrink:0 }}>R$ {fmt(v.valor,0)} · {fmt(v.valorM2,0)}/m²</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {mercado.nivel1?.locacoes?.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#8b5cf6', textTransform:'uppercase', marginBottom:8 }}>Locação — {mercado.nivel1.locacoes.length} imóveis</div>
                      <div style={{ background:'#f5f3ff', borderRadius:8, padding:'10px 12px', marginBottom:8, textAlign:'center' }}>
                        <div style={{ fontSize:9, color:'#7c3aed', fontWeight:700, textTransform:'uppercase', marginBottom:2 }}>Aluguel Médio</div>
                        <div style={{ fontSize:20, fontWeight:900, color:'#7c3aed' }}>R$ {fmt(mercado.nivel1.aluguelMedio||0,0)}/mês</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {mercado.nivel1.locacoes.map((l,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:i%2===0?'#f8fafc':'white', borderRadius:6, fontSize:11 }}>
                            <span style={{ color:'#334155' }}>{l.descricao} <span style={{ color:'#94a3b8' }}>({l.fonte})</span></span>
                            <span style={{ fontWeight:700, color:'#8b5cf6' }}>R$ {fmt(l.valorMensal,0)}/mês</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {!mercado.nivel1?.vendas?.length && !mercado.nivel1?.locacoes?.length && (
                    <div style={{ gridColumn:'span 2', textAlign:'center', padding:'20px', color:'#94a3b8', fontSize:12 }}>
                      <AlertTriangle size={20} color="#f59e0b" style={{margin:'0 auto 8px'}}/>
                      Não foram encontradas amostras no mesmo condomínio/endereço. Consulte o Nível 2.
                    </div>
                  )}
                </div>
              </div>

              {/* Nível 2 — Vizinhança */}
              <div style={{ borderRadius:12, border:'2px solid #10b981', overflow:'hidden' }}>
                <div style={{ background:'#10b981', padding:'10px 16px', display:'flex', alignItems:'center', gap:8 }}>
                  <MapPin size={15} color="white"/>
                  <span style={{ fontWeight:800, color:'white', fontSize:13 }}>Nível 2 — {mercado.nivel2?.descricao||'Vizinhança / Bairro'}</span>
                  <span style={{ marginLeft:'auto', background:'rgba(255,255,255,0.2)', borderRadius:20, padding:'2px 10px', fontSize:11, fontWeight:700, color:'white' }}>
                    {mercado.nivel2?.totalAmostras||0} amostras
                  </span>
                </div>
                <div style={{ padding:14, display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:14 }}>
                  {mercado.nivel2?.vendas?.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#10b981', textTransform:'uppercase', marginBottom:8 }}>Venda — {mercado.nivel2.vendas.length} imóveis</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:8 }}>
                        {[['Mín',`${fmt(mercado.nivel2.precoMinM2||0,0)}`,'#ef4444'],['Médio',`${fmt(mercado.nivel2.precoMedioM2||0,0)}`,'#10b981'],['Máx',`${fmt(mercado.nivel2.precoMaxM2||0,0)}`,'#2563eb']].map(([l,v,c])=>(
                          <div key={l} style={{ background:'#f0fdf4', borderRadius:8, padding:'8px 10px', textAlign:'center' }}>
                            <div style={{ fontSize:9, color:'#94a3b8', fontWeight:700, textTransform:'uppercase', marginBottom:2 }}>{l} R$/m²</div>
                            <div style={{ fontSize:14, fontWeight:900, color:c }}>R$ {v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {mercado.nivel2.vendas.slice(0,8).map((v,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:i%2===0?'#f8fafc':'white', borderRadius:6, fontSize:11 }}>
                            <span style={{ color:'#334155', flex:1, marginRight:8 }}>{v.descricao} <span style={{ color:'#94a3b8' }}>({v.fonte})</span></span>
                            <span style={{ fontWeight:700, color:'#10b981', flexShrink:0 }}>R$ {fmt(v.valor,0)} · {fmt(v.valorM2,0)}/m²</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {mercado.nivel2?.locacoes?.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#8b5cf6', textTransform:'uppercase', marginBottom:8 }}>Locação — {mercado.nivel2.locacoes.length} imóveis</div>
                      <div style={{ background:'#f5f3ff', borderRadius:8, padding:'10px 12px', marginBottom:8, textAlign:'center' }}>
                        <div style={{ fontSize:9, color:'#7c3aed', fontWeight:700, textTransform:'uppercase', marginBottom:2 }}>Aluguel Médio</div>
                        <div style={{ fontSize:20, fontWeight:900, color:'#7c3aed' }}>R$ {fmt(mercado.nivel2.aluguelMedio||0,0)}/mês</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {mercado.nivel2.locacoes.map((l,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:i%2===0?'#f8fafc':'white', borderRadius:6, fontSize:11 }}>
                            <span style={{ color:'#334155' }}>{l.descricao} <span style={{ color:'#94a3b8' }}>({l.fonte})</span></span>
                            <span style={{ fontWeight:700, color:'#8b5cf6' }}>R$ {fmt(l.valorMensal,0)}/mês</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {mercado.comentario && (
                <div style={{ background:'#f8fafc', borderRadius:10, padding:'14px 16px', borderLeft:'4px solid #10b981' }}>
                  <div style={{ fontSize:10, fontWeight:800, color:'#10b981', textTransform:'uppercase', marginBottom:6 }}>Análise de Mercado</div>
                  <p style={{ margin:0, fontSize:12, color:'#334155', lineHeight:1.8 }}>{mercado.comentario}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── ETAPA 4: ANÁLISE DE VIABILIDADE ── */}
      <Section step="4" title="Análise de Viabilidade" icon={TrendingUp} color="#f59e0b" open={openSec.viabilidade} onToggle={()=>toggleSec('viabilidade')}
        badge={d.valorArrematacao>0 ? (isViavel?'✓ Aprovada':'✗ Reprovada') : 'Preencha os valores'}>
        <div style={{ display:'flex', flexDirection:'column', gap:14, paddingTop:14 }}>

          {/* Cenário */}
          <div style={{ display:'flex', alignItems:'center', gap:10, background:'#f8fafc', borderRadius:10, padding:'12px 16px' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#64748b' }}>CENÁRIO:</span>
            {[['aVista','À Vista','#2563eb'],['financiado','Alavancado','#10b981']].map(([v,l,c])=>(
              <button key={v} onClick={()=>setCenario(v)} disabled={v==='financiado'&&d.somenteAVista}
                style={{ padding:'7px 20px', borderRadius:8, border:'none', background:cenario===v?c:'white', color:cenario===v?'white':'#64748b', fontWeight:800, fontSize:13, cursor:'pointer', border:`2px solid ${cenario===v?c:'#e2e8f0'}`, opacity:v==='financiado'&&d.somenteAVista?0.4:1 }}>
                {l}
              </button>
            ))}
          </div>

          {/* KPIs grandes */}
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:12 }}>
            <KpiCard large label="Capital Aportado" value={`R$ ${fmt(metricas.capitalMobilizado,0)}`} sub="Total mobilizado" color="#ef4444" bg="#fef2f2" icon={DollarSign}/>
            <KpiCard large label={isUsoProprio?'Economia Real':'Lucro Líquido'} value={`R$ ${fmt(metricas.lucro,0)}`} sub={`${fmtPct(metricas.roi)} ${isAVista?'ROI':'ROE'}`} color={metricas.roi>=META?'#10b981':'#ef4444'} bg={metricas.roi>=META?'#d1fae5':'#fef2f2'} icon={TrendingUp}/>
            <KpiCard large label="Yield Locação" value={fmtPct(metricas.yieldMensal)+'/mês'} sub={fmtPct(metricas.yieldAnual)+' a.a.'} color="#8b5cf6" bg="#ede9fe" icon={BarChart3}/>
            <KpiCard large label="Teto de Disputa" value={`R$ ${fmt(teto,0)}`} sub={`Margem de ${META}%`} color="#f59e0b" bg="#fef3c7" icon={Gavel}/>
          </div>

          {/* Badge de viabilidade */}
          <div style={{ background:isViavel?'#d1fae5':'#fee2e2', border:`2px solid ${isViavel?'#10b981':'#ef4444'}`, borderRadius:14, padding: isMobile ? '14px 16px' : '18px 22px', display:'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent:'space-between', gap:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:14 }}>
              {isViavel ? <CheckCircle2 size={32} color="#10b981"/> : <XCircle size={32} color="#ef4444"/>}
              <div>
                <div style={{ fontWeight:900, fontSize:17, color:isViavel?'#065f46':'#b91c1c' }}>
                  {isViavel ? (isUsoProprio?'Aprovado para Uso Próprio':'Operação Viável — Aprovada pela TSN Ativos') : 'Operação Reprovada — Retorno Insuficiente'}
                </div>
                <div style={{ fontSize:13, color:isViavel?'#047857':'#dc2626', marginTop:4 }}>
                  {isUsoProprio ? `Economia de R$ ${fmt(metricas.lucro,0)} sobre o valor de mercado` : `ROI ${fmtPct(metricas.roi)} · Mínimo exigido: 40% · Teto de lance: R$ ${fmt(teto,0)}`}
                </div>
              </div>
            </div>
            {mercado && (
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontSize:10, color:'#94a3b8', fontWeight:700 }}>DESCONTO vs MERCADO</div>
                <div style={{ fontSize:24, fontWeight:900, color:isViavel?'#10b981':'#ef4444' }}>
                  {d.valorMercado>0 ? fmtPct((1-d.valorArrematacao/d.valorMercado)*100) : '—'}
                </div>
              </div>
            )}
          </div>

          {/* Tabela financeira detalhada */}
          <div style={{ borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
            <div style={{ background:'#0f172a', padding:'12px 18px' }}>
              <div style={{ fontSize:13, fontWeight:800, color:'white' }}>Detalhamento Financeiro — Lance Base vs Teto</div>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f8fafc' }}>
                    {['Item','% do Aporte',`Lance Base  R$ ${fmt(d.valorArrematacao,0)}`,`Teto  R$ ${fmt(teto,0)}`].map((h,i)=>(
                      <th key={h} style={{ padding:'10px 14px', textAlign:i===0?'left':'right', fontWeight:700, color:'#475569', borderBottom:'2px solid #e2e8f0', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Arrematação/Sinal', isAVista?metricas.vArremate:metricas.valorSinal, isAVista?metricasTeto.vArremate:metricasTeto.valorSinal],
                    ['Honorários Jurídicos (10%)', metricas.honorarios, metricasTeto.honorarios],
                    ['Taxa Leiloeiro', metricas.taxaLeiloeiro, metricasTeto.taxaLeiloeiro],
                    ['ITBI + Registro', metricas.itbiRegistro, metricasTeto.itbiRegistro],
                    d.laudemio>0 && ['Laudêmio', metricas.laudemio, metricasTeto.laudemio],
                    d.foreiro>0 && ['Foreiro', metricas.foreiro, metricasTeto.foreiro],
                    d.debitosAssumidos>0 && ['Débitos Assumidos', metricas.debitos, metricasTeto.debitos],
                    d.manutencaoEstimada>0 && ['Reforma/Retrofit', metricas.manutencao, metricasTeto.manutencao],
                    !isAVista && metricas.parcelasPagas>0 && ['Parcelas Banco', metricas.parcelasPagas, metricasTeto.parcelasPagas],
                    (d.iptuMensal>0||d.condominioMensal>0) && ['Carrego (IPTU/Cond)', metricas.custoCarrrego, metricasTeto.custoCarrrego],
                  ].filter(Boolean).filter(r=>r[1]>0||r[2]>0).map(([label,base,tetoV],i)=>(
                    <tr key={i} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                      <td style={{ padding:'9px 14px', color:'#334155' }}>{label}</td>
                      <td style={{ padding:'9px 14px', textAlign:'right', color:'#94a3b8', fontSize:11 }}>{metricas.capitalMobilizado>0?fmtPct(base/metricas.capitalMobilizado*100):'-'}</td>
                      <td style={{ padding:'9px 14px', textAlign:'right', color:'#dc2626', fontWeight:600 }}>- R$ {fmt(base)}</td>
                      <td style={{ padding:'9px 14px', textAlign:'right', color:'#92400e', fontWeight:600 }}>- R$ {fmt(tetoV)}</td>
                    </tr>
                  ))}
                  <tr style={{ background:'#fef2f2', fontWeight:800 }}>
                    <td style={{ padding:'11px 14px' }}>TOTAL APORTADO (A)</td>
                    <td style={{ padding:'11px 14px', textAlign:'right', color:'#94a3b8' }}>100%</td>
                    <td style={{ padding:'11px 14px', textAlign:'right', color:'#dc2626', fontSize:14 }}>R$ {fmt(metricas.capitalMobilizado)}</td>
                    <td style={{ padding:'11px 14px', textAlign:'right', color:'#92400e', fontSize:14 }}>R$ {fmt(metricasTeto.capitalMobilizado)}</td>
                  </tr>
                  {[
                    [isUsoProprio?'Valor de Mercado':'Venda Bruta (90%)', metricas.valorRef, metricasTeto.valorRef, '#10b981'],
                    !isUsoProprio && ['(-) Comissão + IR', -(metricas.comissao+metricas.ir), -(metricasTeto.comissao+metricasTeto.ir), '#dc2626'],
                    !isAVista && metricas.saldoDevedor>0 && ['(-) Quitação Banco', -metricas.saldoDevedor, -metricasTeto.saldoDevedor, '#dc2626'],
                  ].filter(Boolean).map(([label,base,tetoV,color],i)=>(
                    <tr key={'r'+i} style={{ borderBottom:'1px solid #f1f5f9' }}>
                      <td style={{ padding:'9px 14px', color:'#334155' }}>{label}</td><td/>
                      <td style={{ padding:'9px 14px', textAlign:'right', color, fontWeight:600 }}>{base>0?'+ ':'- '}R$ {fmt(Math.abs(base))}</td>
                      <td style={{ padding:'9px 14px', textAlign:'right', color, fontWeight:600 }}>{tetoV>0?'+ ':'- '}R$ {fmt(Math.abs(tetoV))}</td>
                    </tr>
                  ))}
                  <tr style={{ background:'#d1fae5', fontWeight:900 }}>
                    <td style={{ padding:'12px 14px', color:'#065f46', fontSize:14 }}>RESULTADO (B − A)</td><td/>
                    <td style={{ padding:'12px 14px', textAlign:'right', color:metricas.lucro>=0?'#10b981':'#dc2626', fontSize:18 }}>R$ {fmt(metricas.lucro)}</td>
                    <td style={{ padding:'12px 14px', textAlign:'right', color:metricasTeto.lucro>=0?'#047857':'#dc2626', fontSize:18 }}>R$ {fmt(metricasTeto.lucro)}</td>
                  </tr>
                  <tr style={{ background:'#dbeafe', fontWeight:900 }}>
                    <td style={{ padding:'12px 14px', color:'#1e40af', fontSize:14 }}>RETORNO ({isAVista?'ROI':'ROE'})</td><td/>
                    <td style={{ padding:'12px 14px', textAlign:'right', color:'#2563eb', fontSize:20 }}>{fmtPct(metricas.roi)}</td>
                    <td style={{ padding:'12px 14px', textAlign:'right', color:'#f59e0b', fontSize:20 }}>{fmtPct(metricasTeto.roi)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Section>

      {/* ── ETAPA 5: PROJEÇÃO DE FLUXO DE CAIXA ── */}
      <Section step="5" title="Projeção de Fluxo de Caixa" icon={LineChart} color="#6366f1" open={openSec.fluxo} onToggle={()=>toggleSec('fluxo')}
        badge={`${d.prazoVendaMeses||12} meses`}>
        <div style={{ display:'flex', flexDirection:'column', gap:16, paddingTop:14 }}>
          {/* Sumário */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12 }}>
            {[
              ['Total de Saídas',`R$ ${fmt(fluxo.totalSaidas,0)}`,'#ef4444','#fef2f2'],
              ['Receita Final',`R$ ${fmt(fluxo.totalEntradas,0)}`,'#10b981','#f0fdf4'],
              ['Resultado',`R$ ${fmt(fluxo.totalEntradas-fluxo.totalSaidas,0)}`,(fluxo.totalEntradas-fluxo.totalSaidas)>=0?'#10b981':'#ef4444',(fluxo.totalEntradas-fluxo.totalSaidas)>=0?'#d1fae5':'#fee2e2'],
            ].map(([l,v,c,bg])=>(
              <div key={l} style={{background:bg,borderRadius:12,padding:'14px 16px',textAlign:'center'}}>
                <div style={{fontSize:10,color:c,fontWeight:800,textTransform:'uppercase',marginBottom:6}}>{l}</div>
                <div style={{fontSize:22,fontWeight:900,color:c}}>{v}</div>
              </div>
            ))}
          </div>

          {/* Tabela fluxo */}
          <div style={{ borderRadius:10, border:'1px solid #e2e8f0', overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
              <thead>
                <tr style={{ background:'#1e293b' }}>
                  {['Mês','Descrição','Entradas','Saídas','Saldo Acumulado'].map((h,i)=>(
                    <th key={h} style={{ padding:'9px 12px', textAlign:i<=1?'left':'right', fontWeight:700, color:'#94a3b8', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fluxo.linhas.map((row,i)=>(
                  <tr key={i} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                    <td style={{ padding:'7px 12px', fontWeight:700, color:'#0f172a' }}>Mês {row.mes}</td>
                    <td style={{ padding:'7px 12px', color:'#64748b', fontSize:11 }}>{row.descricao}</td>
                    <td style={{ padding:'7px 12px', textAlign:'right', color:'#10b981', fontWeight:600 }}>{row.entrada>0?`+ R$ ${fmt(row.entrada)}`:'—'}</td>
                    <td style={{ padding:'7px 12px', textAlign:'right', color:'#dc2626', fontWeight:600 }}>{row.saida>0?`- R$ ${fmt(row.saida)}`:'—'}</td>
                    <td style={{ padding:'7px 12px', textAlign:'right', fontWeight:700, color:row.saldo>=0?'#10b981':'#dc2626', background:row.saldo>=0?'#f0fdf4':'#fef2f2' }}>R$ {fmt(row.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* SAC / PRICE */}
          {!d.somenteAVista && <TabelaAmortizacao sacTabela={sacTab} priceTabela={priceTab} d={d}/>}
        </div>
      </Section>

      {/* ── ETAPA 6: LAUDO DE VIABILIDADE ── */}
      <Section step="6" title="Laudo de Viabilidade e Defesa da Arrematação" icon={Award} color="#0f172a" open={openSec.laudo} onToggle={()=>toggleSec('laudo')}
        badge={parecer ? 'Gerado' : 'Gere o parecer executivo'}>
        <div style={{ display:'flex', flexDirection:'column', gap:14, paddingTop:14 }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start', background:'#f8fafc', borderRadius:12, padding:'14px 16px' }}>
            <Sparkles size={16} color="#6366f1" style={{flexShrink:0,marginTop:1}}/>
            <div style={{ fontSize:12, color:'#334155', lineHeight:1.7 }}>
              O laudo é gerado pelo <strong>Claude</strong> com base em todos os dados preenchidos, avaliação de mercado e riscos jurídicos. Inclui <strong>posicionamento estratégico, defesa da arrematação, análise de rentabilidade e conclusão da gestão</strong>. Ideal para apresentação ao cliente ou arquivo interno.
            </div>
          </div>

          <button onClick={gerarParecerClick} disabled={loadParecer}
            style={{ width:'100%', padding:'14px', background:loadParecer?'#a5b4fc':'#6366f1', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {loadParecer ? <><Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/> Gerando laudo executivo...</> : <><Sparkles size={16}/> {parecer?'Regerar Laudo':'Gerar Laudo de Viabilidade com IA'}</>}
          </button>

          {parecer && (
            <>
              <div style={{ background:'#0f172a', borderRadius:12, padding:'20px 22px' }}>
                {parecer.split('§ SEÇÃO:').filter(Boolean).map((sec, i) => {
                  const [titulo, ...corpo] = sec.split('\n');
                  return (
                    <div key={i} style={{ marginBottom: i < 3 ? 22 : 0 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:'#34d399', textTransform:'uppercase', letterSpacing:1, marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ background:'#1e293b', borderRadius:6, padding:'2px 8px' }}>§ {titulo.trim()}</span>
                      </div>
                      <p style={{ margin:0, fontSize:13, lineHeight:1.9, color:'#cbd5e1', whiteSpace:'pre-wrap' }}>{corpo.join('\n').trim()}</p>
                    </div>
                  );
                })}
              </div>
              <button onClick={imprimirPDF}
                style={{ width:'100%', padding:'13px', background:'#2563eb', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                <Printer size={16}/> Exportar Laudo Completo em PDF
              </button>
              {user && !['analista','advogado','consultor','admin'].includes(role) && (
                <button onClick={solicitarAnalista} disabled={solicitando || solicitado}
                  style={{ width:'100%', padding:'13px', background: solicitado ? '#10b981' : '#0f172a', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:14, cursor: solicitado ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity: solicitando ? 0.7 : 1 }}>
                  {solicitando
                    ? <><Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/> Enviando...</>
                    : solicitado
                    ? <><CheckCircle2 size={16}/> Solicitação enviada! Nossa equipe entrará em contato.</>
                    : <><MessageCircle size={16}/> Solicitar Revisão com Especialista</>
                  }
                </button>
              )}
            </>
          )}
        </div>
      </Section>

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}
