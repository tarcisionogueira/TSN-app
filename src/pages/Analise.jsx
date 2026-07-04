import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIsMobile } from '../utils/useIsMobile';
import {
  FileText, Loader2, Sparkles, BarChart3, ShieldAlert, TrendingUp,
  CheckCircle2, XCircle, AlertTriangle, Gavel, DollarSign, Printer, ExternalLink,
  Save, ChevronDown, ChevronUp, UploadCloud, Building2, MapPin,
  Home, ClipboardList, LineChart, Award, Info, RefreshCw, Lock,
  Scale, Search, User, Calendar, ChevronRight, AlertCircle, MessageCircle, ClipboardCheck, CreditCard,
} from 'lucide-react';
import { extrairDadosDocumento, extrairDadosDocumentoUrl, analisarMercado, gerarParecer } from '../utils/claude';
import { calcularMetricasCenario, calcularTetoLance, calcularSAC, calcularPrice, calcularVPL, calcularTIR, calcularPayback, calcularMultiplo, fluxoLocacao, TMA_PADRAO, fmt, fmtPct } from '../utils/calculos';
import { caixaMatriculaUrl, caixaRegrasVendaUrl } from '../utils/caixa';
import { loadImoveis, saveImoveis, generateId } from '../utils/storage';
import { useAuth } from '../contexts/AuthContext';
import { useAnalises } from '../contexts/AnalisesContext';
import { supabase } from '../utils/supabase';
import TabelaAmortizacao from '../components/TabelaAmortizacao';
import RiscoJuridico from '../components/RiscoJuridico';
import Lancamentos from '../components/Lancamentos';
import { gerarPDF } from '../components/RelatorioPDF';
import { apiCall } from '../utils/apiCall';
import GuiaPosArrematacao from '../components/GuiaPosArrematacao';
import FinanciamentoTracker from '../components/FinanciamentoTracker';

const VAZIO = {
  id: '', nome: '', tipo: 'apartamento', endereco: '', cidade: '', estado: '', cep: '',
  nomeCondominio: '', objetivoCompra: 'investimento', status: 'analise', origem: 'extrajudicial',
  somenteAVista: false, tabelaAmortizacao: 'sac', leiloeiro: '', dataLeilao: '',
  taxaLeiloeiroPercentual: 5, honorariosPercentual: 10, taxaAdministrativaPercentual: 0, despesasAdministrativas: 0,
  valorAvaliacao: 0, valorArrematacao: 0,
  areaM2: 0, areaTerrenoM2: 0, valorMercado: 0, valorLocacao: 0,
  manutencaoEstimada: 0, prazoReformaMeses: 3, debitosAssumidos: 0,
  iptuMensal: 0, condominioMensal: 0, itbiPercentual: 5,
  laudemio: 0, foreiro: 0, sinalPercentual: 5, prazoMeses: 360,
  cetAnual: 12, prazoVendaMeses: 12, observacoes: '', riscos: [], lancamentos: [],
};

const STATUS_OPTS = [
  ['analise','Em Análise'],['aprovado','Aprovado'],['arrematado','Arrematado'],
  ['em_reforma','Em Reforma'],['venda','À Venda'],['alugado','Alugado'],
  ['concluido','Concluído'],['reprovado','Reprovado'],
];

const TIPO_OPTS = [['casa','Casa'],['apartamento','Apartamento'],['terreno','Terreno'],['comercial','Comercial']];

const inp = { width:'100%', padding:'9px 11px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, background:'white', color:'#111111', boxSizing:'border-box' };
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

function Section({ step, title, icon: Icon, color='#0D63DB', open, onToggle, badge, children, id }) {
  return (
    <div id={id} style={{background:'white',borderRadius:16,border:'1px solid #e2e8f0',overflow:'hidden',boxShadow:'0 1px 4px rgba(0,0,0,0.04)',scrollMarginTop:'80px'}}>
      <button onClick={onToggle} style={{width:'100%',padding:'16px 20px',border:'none',background:'white',cursor:'pointer',display:'flex',alignItems:'center',gap:14,textAlign:'left'}}>
        <div style={{width:36,height:36,borderRadius:10,background:open?color:'#f1f5f9',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'background 0.2s'}}>
          <Icon size={17} color={open?'white':color}/>
        </div>
        <div style={{flex:1}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {step && <span style={{fontSize:10,fontWeight:800,color:open?color:'#94a3b8',textTransform:'uppercase',letterSpacing:1}}>Etapa {step}</span>}
            {badge && <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:20,background:open?color+'18':' #f1f5f9',color:open?color:'#94a3b8'}}>{badge}</span>}
          </div>
          <div style={{fontSize:15,fontWeight:800,color:'#111111',marginTop:1}}>{title}</div>
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

// Limite de relatórios mercadológicos+viabilidade por plano/mês (espelha limite_ia
// no banco). Explorador: 5/mês, sem documental/jurídico. Todos os acessos têm cota;
// só o admin é ilimitado. Equipe (analista/advogado) NÃO gera relatórios (só
// recebe/visualiza demandas) → sem entrada aqui = limite 0.
const LIMITE_POR_ROLE = {
  explorador: 5, consultor: 5,
  top2: 15, top2_anual: 15,
  assessorado: 15, assessorado_anual: 15,
  clube: 15, clube_anual: 15,
};
const mesAtual = () => new Date().toISOString().slice(0, 7);
const ROLES_SEM_LIMITE = ['admin'];
// Documental/jurídico só a partir do Investidor Pro (explorador/consultor não têm).
const ROLES_SEM_DOCUMENTAL = ['explorador', 'consultor'];
const ROLES_COM_CNJ   = ['top2','assessorado','clube','analista','advogado','admin'];

export default function Analise() {
  const location = useLocation();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { user, role } = useAuth();
  const imovelInicial = location.state?.imovel;
  // Modo "inclusão manual de lote": cola URL e/ou anexa edital/matrícula; a IA
  // extrai e libera os relatórios. Vira um botão de opção no menu — ao ativar, a
  // inclusão manual sobe pro topo do centro e a geração de relatórios fica abaixo.
  // Sem imóvel da base (entrada 100% manual) já começa ligado e não desliga.
  const semImovelBase = !imovelInicial;
  const [modoManual, setModoManual] = useState(location.state?.manual || semImovelBase);

  const temCNJ = ROLES_COM_CNJ.includes(role);
  const semLimite = ROLES_SEM_LIMITE.includes(role);

  const [analisesBloqueado, setAnalisesBloqueado] = useState(false);
  const [analisesUsadas, setAnalisesUsadas] = useState(0);
  const [analisesBonus, setAnalisesBonus] = useState(0);
  const limiteRole = LIMITE_POR_ROLE[role] || 0;

  // Lê os contadores de cota do perfil (fonte da verdade). O CONSUMO da cota
  // passou a ser server-side (/api/gerar-analise → consumir_analise_por); aqui só
  // LEMOS para pintar o estado da tela — chamamos no mount e após cada geração.
  const carregarCota = React.useCallback(async () => {
    if (!user || semLimite) return;
    const { data, error } = await supabase.from('perfis')
      .select('analises_mes, analises_count, bonus_mercado').eq('id', user.id).single();
    if (error || !data) return;
    const count = data.analises_mes === mesAtual() ? (data.analises_count || 0) : 0;
    const bonus = data.bonus_mercado || 0;
    setAnalisesUsadas(count);
    setAnalisesBonus(bonus);
    // Bloqueia só quando estourou o limite mensal E não há bônus por cima
    // (espelha consumir_analise_por: consome o mensal primeiro, bônus como excedente).
    setAnalisesBloqueado(count >= limiteRole && bonus <= 0);
  }, [role, user, semLimite, limiteRole]);

  useEffect(() => { carregarCota(); }, [carregarCota]);

  const [d, setD] = useState(() => {
    if (imovelInicial) return {
      ...VAZIO, id: generateId(), nome: imovelInicial.titulo||'',
      tipo: imovelInicial.tipo||'apartamento', endereco: imovelInicial.endereco||'',
      cidade: imovelInicial.cidade||'', estado: imovelInicial.estado||'',
      valorAvaliacao: imovelInicial.valorAvaliacao||0, valorArrematacao: imovelInicial.valorMinimo||0,
      areaM2: imovelInicial.areaM2||0, leiloeiro: imovelInicial.leiloeiro||'',
      dataLeilao: imovelInicial.dataLeilao||'', origem: imovelInicial.modalidade||'extrajudicial',
      somenteAVista: !imovelInicial.pagamento?.includes('financiado'),
      // Venda direta e Licitação (Caixa) normalmente NÃO têm leiloeiro → sem taxa.
      // Demais: 5% (editável — alguns leiloeiros cobram mais). Confirmar no edital.
      taxaLeiloeiroPercentual: /venda[_ ]?direta|licitac/i.test(imovelInicial.modalidade||'') ? 0 : 5,
    };
    return { ...VAZIO, id: generateId() };
  });

  const [textoDoc, setTextoDoc] = useState('');
  const [textoMatricula, setTextoMatricula] = useState('');
  const [urlEdital, setUrlEdital] = useState(imovelInicial?.linkEdital || '');

  // Entradas automáticas: o imóvel vindo do leiloeiro/busca já traz docs e dados.
  // Carrega anexos (matrícula/edital/regras) e pré-preenche o processo p/ o CNJ.
  useEffect(() => {
    if (!imovelInicial) return;
    if (imovelInicial.numeroProcesso) setCnjNumero(imovelInicial.numeroProcesso);
    const idImovel = imovelInicial.id;
    if (!idImovel) return;
    let cancel = false;
    (async () => {
      const { data } = await supabase.from('imovel_anexos')
        .select('id,tipo,nome,url,criado_em')
        .eq('imovel_id', idImovel)
        .in('tipo', ['matricula', 'edital', 'regras_venda']);
      if (!cancel) setDocsLeiloeiro(data || []);
    })();
    return () => { cancel = true; };
  }, [imovelInicial]);

  // CNJ DataJud
  const [cnjNumero, setCnjNumero] = useState('');
  const [cnjNome, setCnjNome] = useState('');
  const [cnjResultados, setCnjResultados] = useState(null);
  const [loadCnj, setLoadCnj] = useState(false);
  const [cnjErro, setCnjErro] = useState('');

  // Certidões (CND + PGFN)
  const [certDocumento, setCertDocumento] = useState('');
  const [certResultados, setCertResultados] = useState(null);
  const [loadCert, setLoadCert] = useState(false);
  const [certErro, setCertErro] = useState('');

  const buscarCertidoes = async () => {
    if (!certDocumento.trim()) return;
    setLoadCert(true); setCertErro(''); setCertResultados(null);
    try {
      const res = await apiCall('/api/certidoes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documento: certDocumento.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro na consulta');
      setCertResultados(data);
      // Adiciona irregularidade como risco automaticamente
      if (data.parecer?.nivel === 'vermelho') {
        const txt = `[Certidão] ${data.parecer.texto}`;
        const existentes = new Set((d.riscos || []).map(r => r.texto));
        if (!existentes.has(txt)) up('riscos', [...(d.riscos || []), { id: Date.now(), texto: txt, tipo: 'alerta' }]);
      }
    } catch (err) { setCertErro(err.message); }
    setLoadCert(false);
  };

  const cenario_role_pro = ['top2', 'assessorado', 'clube', 'analista', 'advogado', 'admin'];

  const buscarCNJ = async () => {
    if (!cnjNumero.trim() && !cnjNome.trim()) return;
    if (!d.estado) { setCnjErro('Preencha o Estado do imóvel (Etapa 2) para determinar o tribunal.'); return; }
    setLoadCnj(true); setCnjErro(''); setCnjResultados(null);
    try {
      const res = await apiCall('/api/cnj-datajud', {
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

  // ─── Fluxo de relatórios (nova tela orientada a relatórios) ────────────────
  // relSel: qual painel está aberto no centro.
  //   null      → launcher (somente os botões de gerar)
  //   'mercado' → Relatório Mercadológico + Viabilidade Financeira
  //   'documental' → Relatório de Análise Documental + Processo
  const [relSel, setRelSel] = useState(null);
  // Análise mercadológica roda em SEGUNDO PLANO no AnalisesContext: o usuário pode
  // sair desta tela e navegar/buscar imóveis enquanto gera. "Gerando" deriva do
  // contexto; o resultado é aplicado de volta quando concluído (efeito abaixo).
  const { iniciar: iniciarAnalise, getAnalise, iniciarDocumental, getDocumental } = useAnalises();
  const analiseImovelId = imovelInicial?.id || d.id;
  const analiseEntry = getAnalise(analiseImovelId);
  const docEntry = getDocumental(analiseImovelId);
  const gerandoMercado = analiseEntry?.status === 'gerando';
  // Documental também roda em SEGUNDO PLANO no servidor (/api/gerar-documental):
  // o "gerando"/"pronto" derivam do contexto (persistente, vale entre devices).
  const gerandoDocumental = docEntry?.status === 'gerando';
  const [relMercadoGerado, setRelMercadoGerado] = useState(false);
  const relDocumentalGerado = docEntry?.status === 'concluida';
  const [parecerDocumental, setParecerDocumental] = useState(null); // resultado do servidor
  const [docMsg, setDocMsg] = useState('');
  // Estado do workflow analista → jurídico (sessão)
  const [reuniaoSolicitada, setReuniaoSolicitada] = useState(false);
  const [reuniaoRealizada, setReuniaoRealizada] = useState(false);
  const [juridicoEnviado, setJuridicoEnviado] = useState(false);
  const [docsLeiloeiro, setDocsLeiloeiro] = useState([]); // anexos do imóvel (matrícula/edital/regras)
  const isStaffAnalise = ['analista','advogado','admin','consultor'].includes(role);
  // Cliente: analisar imóvel de leiloeiro ainda não integrado (fora da base)
  const [externoLink, setExternoLink] = useState('');
  const [externoEnviando, setExternoEnviando] = useState(false);
  const [externoNotificado, setExternoNotificado] = useState(false);

  // Controle de abertura por seção
  const [openSec, setOpenSec] = useState({ doc:true, dados:true, mercado:true, viabilidade:true, fluxo:true, laudo:true, matricula:true, cnj:true, guia:true, financiamento:true });
  const toggleSec = (k) => setOpenSec(p => ({ ...p, [k]: !p[k] }));
  // Abre uma seção e rola até ela (usado pela barra lateral)
  const irPara = (k, id) => { setOpenSec(p => ({ ...p, [k]: true })); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); };

  const up = useCallback((name, val) => setD(p => ({ ...p, [name]: val })), []);
  const upN = useCallback((e) => {
    const { name, value } = e.target;
    const texts = ['nome','tipo','endereco','cidade','estado','cep','nomeCondominio','objetivoCompra','origem','status','tabelaAmortizacao','leiloeiro','dataLeilao','observacoes'];
    setD(p => ({ ...p, [name]: texts.includes(name) ? value : (parseFloat(value)||0) }));
  }, []);

  const isAVista = cenario === 'aVista' || d.somenteAVista;
  const isUsoProprio = d.objetivoCompra === 'uso_proprio';
  const META = isUsoProprio ? 0 : 30;

  const metricas = useMemo(() => calcularMetricasCenario(d, d.valorArrematacao||0, isAVista), [d, isAVista]);
  const teto = useMemo(() => calcularTetoLance(d, isAVista, META, d.valorMercado||0), [d, isAVista, META]);
  const metricasTeto = useMemo(() => calcularMetricasCenario(d, teto, isAVista), [d, teto, isAVista]);
  const isViavel = isUsoProprio ? true : metricas.roi >= META;
  const riscosBloqueantes = (d.riscos||[]).filter(r => r.tipo === 'bloqueante');

  // ─── Cenários de disputa (relatório mercadológico) ─────────────────────────
  // "Sem disputa": arremata pelo lance base. "Com disputa": pior caso aceitável —
  // a concorrência empurra o preço até o teto que ainda preserva o piso de lucro
  // líquido. Tudo calculado na MELHOR condição de pagamento.
  const PISO_LUCRO = 30;
  // Data do anúncio ("2025-11" → "nov/25"). Preço varia no tempo — mostramos a data.
  const fmtDataAnuncio = (s) => {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})$/);
    if (!m) return String(s);
    const meses = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
    return `${meses[(+m[2]) - 1] || m[2]}/${m[1].slice(2)}`;
  };
  const cenariosDisputa = useMemo(() => {
    const lanceBase = d.valorArrematacao || 0;
    const podeFin = !d.somenteAVista;
    const mAV = calcularMetricasCenario(d, lanceBase, true);
    const mFIN = podeFin ? calcularMetricasCenario(d, lanceBase, false) : null;
    // Melhor condição = maior retorno no lance base (sem disputa)
    const usarAVista = !mFIN || mAV.roi >= mFIN.roi;
    const condLabel = usarAVista ? 'À Vista' : 'Financiado / Alavancado';
    const semDisputa = usarAVista ? mAV : mFIN;
    const tetoBest = calcularTetoLance(d, usarAVista, PISO_LUCRO, d.valorMercado || 0);
    const comDisputa = calcularMetricasCenario(d, tetoBest, usarAVista);
    return { condLabel, usarAVista, lanceBase, semDisputa, tetoBest, comDisputa };
  }, [d]);

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
      // Operação de revenda (flip): a única entrada é a VENDA no mês-alvo (pVenda).
      // Não há renda de aluguel mês a mês — o imóvel é comprado para revender, não
      // para locar. Os meses anteriores só têm saídas (carrego/parcela/reforma).
      const entrada = i===pVenda ? metricas.receitaLiquida : 0;
      saldo += entrada - saida;
      totalSaidas += saida;
      linhas.push({ mes:i, entrada, saida, descricao: parts.join('+')||'Manutenção', saldo });
    }
    return { linhas, totalSaidas, totalEntradas: metricas.receitaLiquida };
  }, [d, metricas, isAVista, isUsoProprio]);

  // ─── Indicadores de retorno (VPL, TIR, payback, múltiplo) ──────────────────
  // TMA (régua): padrão 12% a.a., ajustável em Premissas (d.tmaAnual).
  const tma = Number(d.tmaAnual) || TMA_PADRAO;
  const indicadores = useMemo(() => {
    const fluxosRevenda = (fluxo.linhas || []).map(l => (l.entrada || 0) - (l.saida || 0));
    const loc = fluxoLocacao(d, Number(d.horizonteLocacaoMeses) || 60);
    return {
      tma,
      vpl: calcularVPL(fluxosRevenda, tma),
      tir: calcularTIR(fluxosRevenda),
      payback: calcularPayback(fluxosRevenda, tma),
      multiplo: calcularMultiplo(metricas.capitalMobilizado, metricas.receitaLiquida),
      loc: { ...loc, vpl: calcularVPL(loc.fluxos, tma), tir: calcularTIR(loc.fluxos) },
    };
  }, [fluxo, metricas, d, tma]);

  const showMsg = (text, type='success') => { setMsg({ text, type }); setTimeout(()=>setMsg({text:'',type:''}), 3500); };

  const aplicarExtracao = (ext) => {
    if (!ext) return;
    setD(p => ({
      ...p, ...ext,
      valorMercado: ext.valorMercado || (ext.valorAvaliacao ? ext.valorAvaliacao * 1.15 : p.valorMercado),
      riscos: ext.riscos ? ext.riscos.map(r => ({
        id: Date.now() + Math.random(), texto: r, tipo:
          r.toLowerCase().includes('usufruto') || r.toLowerCase().includes('bloqueio') || r.toLowerCase().includes('impedimento') ? 'bloqueante' : 'alerta'
      })) : p.riscos,
    }));
    setOpenSec(p => ({ ...p, doc: false, dados: true, viabilidade: true }));
    showMsg('Dados extraídos com sucesso!');
  };

  const analisarUrl = async () => {
    const url = urlEdital.trim();
    if (!url || !/^https?:\/\//.test(url)) { showMsg('Informe uma URL válida (https://...).', 'error'); return; }
    setLoadDoc(true);
    try {
      const ext = await extrairDadosDocumentoUrl(url);
      aplicarExtracao(ext);
    } catch (e) { showMsg(e.message || 'Erro ao analisar URL.', 'error'); }
    setLoadDoc(false);
  };

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
      aplicarExtracao(ext);
    } catch { showMsg('Erro ao extrair dados.','error'); }
    setLoadDoc(false);
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type === 'text/plain') {
      setTextoDoc(await file.text());
    } else if (file.type === 'application/pdf') {
      const buf = await file.arrayBuffer();
      const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
      // Extrai via IA diretamente do PDF — sem precisar de texto intermediário
      setLoadDoc(true);
      try {
        const ext = await extrairDadosDocumento('', b64);
        if (ext) {
          setTextoDoc(`[PDF: ${file.name}]`);
          setD(p => ({
            ...p,
            nome: ext.nome || p.nome, tipo: ext.tipo || p.tipo,
            endereco: ext.endereco || p.endereco, cidade: ext.cidade || p.cidade,
            estado: ext.estado || p.estado, cep: ext.cep || p.cep,
            valorAvaliacao: ext.valorAvaliacao || p.valorAvaliacao,
            valorArrematacao: ext.valorArrematacao || p.valorArrematacao,
            areaM2: ext.areaM2 || p.areaM2, areaTerrenoM2: ext.areaTerrenoM2 || p.areaTerrenoM2,
            debitosAssumidos: ext.debitosAssumidos ?? p.debitosAssumidos,
            iptuMensal: ext.iptuMensal ?? p.iptuMensal,
            condominioMensal: ext.condominioMensal ?? p.condominioMensal,
            laudemio: ext.laudemio ?? p.laudemio, foreiro: ext.foreiro ?? p.foreiro,
            taxaLeiloeiroPercentual: ext.taxaLeiloeiroPercentual || p.taxaLeiloeiroPercentual,
            somenteAVista: ext.somenteAVista ?? p.somenteAVista,
            origem: ext.origem || p.origem, leiloeiro: ext.leiloeiro || p.leiloeiro,
            dataLeilao: ext.dataLeilao || p.dataLeilao,
            riscos: ext.riscos?.length ? ext.riscos.map(r => ({ id: Date.now()+Math.random(), texto: r, tipo: r.toLowerCase().includes('usufruto')||r.toLowerCase().includes('bloqueio')||r.toLowerCase().includes('impedimento') ? 'bloqueante' : 'alerta' })) : p.riscos,
            observacoes: ext.observacoes || p.observacoes,
          }));
          setOpenSec(p => ({ ...p, doc: false, dados: true, viabilidade: true }));
          showMsg(`PDF lido pela IA: ${file.name}`);
        }
      } catch { showMsg('Erro ao processar PDF.', 'error'); }
      setLoadDoc(false);
    } else {
      showMsg('Use arquivos .pdf ou .txt.', 'error');
    }
  };

  // ─── Cliente: analisar imóvel de leiloeiro ainda NÃO integrado ─────────────
  // O cliente cola o link do lote e/ou anexa edital/matrícula. Reaproveita a
  // extração por URL/arquivo (antes restrita à equipe) para liberar a geração
  // dos relatórios e avisa a equipe (solicitacoes 'leiloeiro_sugerido') para
  // avaliar integrar o leiloeiro. É uma análise "fora da base" — sem a garantia
  // da curadoria BidPro; depende do que o cliente forneceu.
  const dominioDoLink = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const analisarLeiloeiroExterno = async () => {
    const link = externoLink.trim();
    const temDoc = !!(textoDoc.trim() || textoMatricula.trim());
    if (!link && !temDoc) { showMsg('Cole o link do lote ou anexe o edital/matrícula primeiro.', 'error'); return; }
    if (link && !/^https?:\/\//.test(link)) { showMsg('Informe um link válido (https://...).', 'error'); return; }
    setExternoEnviando(true);
    try {
      // 1) Extrai os dados do imóvel a partir do que o cliente forneceu
      if (link) {
        setUrlEdital(link);
        try { const ext = await extrairDadosDocumentoUrl(link); aplicarExtracao(ext); }
        catch { /* extração pode falhar; segue com anexos/dados manuais */ }
      } else if (temDoc) {
        await extrairDoc();
      }
      // 2) Avisa a equipe para avaliar integrar este leiloeiro (uma única vez)
      if (user && !externoNotificado) {
        const dominio = dominioDoLink(link);
        const { error } = await supabase.from('solicitacoes').insert({
          user_id: user.id,
          imovel_ref: d.id || 'externo',
          imovel_nome: d.nome || d.endereco || 'Imóvel fora da base',
          imovel_cidade: d.cidade || '',
          tipo: 'leiloeiro_sugerido',
          status: 'solicitado',
          notas_analista: `Análise fora da base (cliente). Link: ${link || '(somente anexos)'}${dominio ? ` · domínio: ${dominio}` : ''}.`,
        });
        if (error) throw error;
      }
      setExternoNotificado(true);
      showMsg('Análise liberada! Gere os relatórios acima. A equipe foi avisada para avaliar integrar este leiloeiro.');
    } catch {
      showMsg('Não foi possível liberar a análise. Tente novamente.', 'error');
    } finally {
      setExternoEnviando(false);
    }
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

  // ─── Relatório 1: Mercadológico + Viabilidade Financeira ───────────────────
  // Gera tudo automaticamente a partir dos dados do imóvel (sem formulário).
  const gerarRelMercado = () => {
    if (analisesBloqueado) { showMsg('Limite de análises atingido.', 'error'); return; }
    if (!d.endereco && !d.cidade) { showMsg('Imóvel sem endereço/cidade para avaliar o mercado.', 'error'); return; }
    if (gerandoMercado) return;
    // Snapshots dos dados no momento do clique — a geração roda no provider e
    // não depende mais desta tela ficar montada.
    const dSnap = { ...d };
    const mercadoInputs = {
      endereco: dSnap.endereco || dSnap.cidade, tipoImovel: dSnap.tipo,
      areaM2: dSnap.areaM2, cidade: dSnap.cidade, estado: dSnap.estado,
      nomeCondominio: dSnap.nomeCondominio || '',
    };
    const parecerInputs = { d: dSnap, metricas, teto, cenario: isAVista ? 'À Vista' : 'Alavancado' };
    showMsg('Geração iniciada no servidor — pode até fechar a aba; acompanhe em "Análises" no topo.');
    iniciarAnalise(
      { imovelId: analiseImovelId, titulo: d.nome || d.endereco || imovelInicial?.titulo || 'Imóvel', cidade: d.cidade, estado: d.estado, imovel: imovelInicial || null },
      { mercadoInputs, parecerInputs }
    );
  };

  // Aplica o resultado da geração (que rodou em segundo plano) ao reabrir/voltar
  // à tela: mercado, valores e laudo. Roda uma vez por conclusão.
  const aplicadoRef = React.useRef(null);
  useEffect(() => {
    const entry = getAnalise(analiseImovelId);
    if (entry?.status === 'gerando') return;
    if (entry?.status === 'erro' && aplicadoRef.current !== entry.updatedAt) {
      aplicadoRef.current = entry.updatedAt;
      showMsg(entry.erro || 'Erro ao gerar o relatório mercadológico.', 'error');
      carregarCota(); // ex.: bloqueio por limite/sem-crédito veio do servidor
      return;
    }
    if (entry?.status !== 'concluida' || !entry.result) return;
    if (aplicadoRef.current === entry.updatedAt) return;
    aplicadoRef.current = entry.updatedAt;
    const r = entry.result;
    if (r.mercado) setMercado(r.mercado);
    if (r.valorMercado) up('valorMercado', r.valorMercado);
    if (r.valorLocacao) up('valorLocacao', r.valorLocacao);
    if (r.parecer) { setParecer(r.parecer); setD(p => ({ ...p, parecer: r.parecer })); }
    setRelMercadoGerado(true);
    carregarCota(); // a geração consumiu cota no servidor — atualiza os contadores
    showMsg('Relatório Mercadológico + Viabilidade pronto!');
  }, [analiseEntry?.status, analiseEntry?.updatedAt, analiseImovelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Relatório 2: Análise Documental + Processo (AO MOTOR / servidor) ───────
  // Dispara /api/gerar-documental: lê edital/matrícula/anexos do lote e consulta o
  // CNJ NO SERVIDOR. O usuário pode FECHAR a aba — continua e grava no banco; o
  // resultado é aplicado de volta pelo efeito abaixo. Texto/processo colados na
  // tela (staff/inclusão manual) são enviados como reforço.
  const gerarRelDocumental = () => {
    if (gerandoDocumental) return;
    setDocMsg('');
    // Resolve as URLs REAIS dos documentos (mesma lógica da barra lateral): para a
    // Caixa, o PDF estático da matrícula/regras — não a página .asp do banco. Sem
    // isto o servidor chegava sem documento legível e o laudo saía bloqueado.
    const ehArq = (v) => /^https?:\/\//i.test(v||'') && !/matricula\.asp|detalhe-imovel\.asp/i.test(v);
    const anexoMat = docsLeiloeiro.find(x => x.tipo === 'matricula')?.url;
    const urlMatricula = caixaMatriculaUrl({ fonte: imovelInicial?.fonte, estado: imovelInicial?.estado, fonteId: imovelInicial?.fonteId })
      || (ehArq(anexoMat) ? anexoMat : null) || (ehArq(imovelInicial?.linkMatricula) ? imovelInicial.linkMatricula : null) || undefined;
    const urlRegras = caixaRegrasVendaUrl({ fonte: imovelInicial?.fonte })
      || (ehArq(imovelInicial?.linkRegrasVenda) ? imovelInicial.linkRegrasVenda : null) || undefined;
    const payload = {
      urlEdital: (ehArq(imovelInicial?.linkEdital) ? imovelInicial.linkEdital : (urlEdital || '')).trim() || undefined,
      urlMatricula,
      urlRegras,
      textoEdital: textoDoc.trim() || undefined,
      textoMatricula: textoMatricula.trim() || undefined,
      processoNumero: cnjNumero.trim() || undefined,
      processoNome: cnjNome.trim() || undefined,
    };
    showMsg('Análise documental iniciada no servidor — pode fechar a aba; acompanhe em "Análises" no topo.');
    iniciarDocumental(
      { imovelId: analiseImovelId, titulo: d.nome || d.endereco || imovelInicial?.titulo || 'Imóvel', cidade: d.cidade, estado: d.estado, imovel: imovelInicial || null },
      payload
    );
    setRelSel('documental');
  };

  // Aplica o resultado da documental gerada em segundo plano (riscos, extração,
  // CNJ e parecer) quando concluída. Roda uma vez por conclusão.
  const aplicadoDocRef = React.useRef(null);
  useEffect(() => {
    if (!docEntry) return;
    if (docEntry.status === 'gerando') return;
    if (docEntry.status === 'erro' && aplicadoDocRef.current !== docEntry.updatedAt) {
      aplicadoDocRef.current = docEntry.updatedAt;
      showMsg(docEntry.erro || 'Erro ao gerar a análise documental.', 'error');
      return;
    }
    if (docEntry.status !== 'concluida' || !docEntry.result) return;
    if (aplicadoDocRef.current === docEntry.updatedAt) return;
    aplicadoDocRef.current = docEntry.updatedAt;
    const r = docEntry.result;
    setParecerDocumental(r);
    // Preenche os riscos do imóvel a partir do que a IA encontrou nos documentos.
    if (Array.isArray(r.riscos) && r.riscos.length) {
      setD(p => ({ ...p, riscos: r.riscos.map(x => ({
        id: Date.now() + Math.random(),
        texto: x.constaNaDoc === false ? `${x.descricao || x.categoria} (não consta na documentação — confirmar)` : (x.descricao || x.categoria),
        tipo: x.severidade === 'bloqueante' ? 'bloqueante' : 'alerta',
      })) }));
    }
    // Custos do edital que a IA extraiu (taxa administrativa/despesas) → alimenta a
    // projeção financeira. Só sobrescreve quando a IA trouxe um valor > 0.
    if (r.extracao) {
      const ex = r.extracao;
      const taxaAdm = Number(ex.taxaAdministrativaPercentual) || 0;
      const despAdm = Number(ex.despesasAdministrativas) || 0;
      if (taxaAdm > 0 || despAdm > 0) {
        setD(p => ({ ...p,
          ...(taxaAdm > 0 ? { taxaAdministrativaPercentual: taxaAdm } : {}),
          ...(despAdm > 0 ? { despesasAdministrativas: despAdm } : {}),
        }));
      }
    }
    // Espelha a consulta CNJ que rodou no servidor, no console de CNJ da tela.
    if (r.cnj) setCnjResultados({ processos: r.cnj.processos || [], total: r.cnj.total || 0, tribunais_consultados: r.cnj.tribunais || [], parecer: r.cnj.parecer });
    if (!r.parecer && !(r.documentosLidos || []).length) {
      setDocMsg('Não foi possível ler documentos automaticamente. Anexe a matrícula/edital ou cole o texto/nº do processo e gere novamente.');
    }
    showMsg('Análise Documental + Processo pronta!');
  }, [docEntry?.status, docEntry?.updatedAt, analiseImovelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ambosRelatorios = relMercadoGerado && relDocumentalGerado;

  // ─── Workflow: reunião com analista → encaminhar ao jurídico ────────────────
  const solicitarReuniao = async () => {
    if (!ambosRelatorios) return;
    await solicitarAnalista();
    setReuniaoSolicitada(true);
  };
  const marcarReuniaoRealizada = () => {
    setReuniaoRealizada(true);
    showMsg('Reunião marcada como realizada. Encaminhamento ao jurídico liberado.');
  };
  const encaminharJuridico = async () => {
    if (!reuniaoRealizada || juridicoEnviado) return;
    try {
      if (user) {
        await supabase.from('solicitacoes').insert({
          user_id: user.id,
          imovel_ref: d.id || null,
          imovel_nome: d.nome || d.endereco || 'Imóvel',
          imovel_cidade: d.cidade || '',
          tipo: 'juridico',
          status: 'solicitado',
          notas_analista: 'Encaminhamento ao jurídico após reunião com analista (tela de análise).',
        });
      }
      setJuridicoEnviado(true);
      showMsg('Encaminhado ao jurídico. A devolutiva chega no Atendimento.');
    } catch {
      showMsg('Erro ao encaminhar ao jurídico.', 'error');
    }
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
        // Sincroniza o flag arrematado nas análises geradas (regra de limpeza: o
        // cron só apaga as NÃO arrematadas 15 dias após o leilão) — mercado + documental.
        await supabase.from('analises_mercado').update({ arrematado: isArrematado }).eq('user_id', user.id).eq('imovel_id', payload.imovel_id);
        await supabase.from('analises_documental').update({ arrematado: isArrematado }).eq('user_id', user.id).eq('imovel_id', payload.imovel_id);
      } catch { /* portfólio local já foi salvo — erro de rede não bloqueia o usuário */ }
    }

    // A cota NÃO é mais consumida aqui: o consumo passou para o servidor, na
    // geração (/api/gerar-analise → consumir_analise_por), à prova de burla.
    // Aqui apenas relemos os contadores para manter a tela em dia.
    carregarCota();
  };

  const imprimirPDF = () => gerarPDF({ d, metricas, metricasTeto, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTab, priceTab, mercado, parecer, indicadores });

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
      notas_analista: `Laudo gerado. Desconto: ${d.valorAvaliacao > 0 ? ((1 - d.valorArrematacao / d.valorAvaliacao) * 100).toFixed(2) : '?'}%. Pedido de revisão pelo cliente.`,
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
    <div style={{ maxWidth: 1280, margin:'0 auto', padding: isMobile ? '12px' : '20px', display:'flex', flexDirection:'column', gap:14 }}>

      {/* HEADER */}
      <div style={{ background:'#111111', borderRadius:16, padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:11, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Análise de Viabilidade</div>
          <div style={{ fontSize:18, fontWeight:900, color:'white', lineHeight:1.2 }}>{d.nome||'Novo Imóvel'}</div>
          {d.cidade && <div style={{ fontSize:12, color:'#94a3b8', marginTop:3, display:'flex', alignItems:'center', gap:5 }}><MapPin size={11}/>{d.cidade}{d.estado?`, ${d.estado}`:''}</div>}
        </div>
        {/* Status + Salvar + PDF só aparecem quando já há algo gerado (no launcher
            limpo eram redundantes). */}
        {(relMercadoGerado || relDocumentalGerado) && (
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={salvar} style={{ padding:'8px 16px', background:saved?'#10b981':'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6, transition:'background 0.2s' }}>
            {saved ? <><CheckCircle2 size={14}/> Salvo!</> : <><Save size={14}/> Salvar</>}
          </button>
          {parecer && (
            <button onClick={imprimirPDF} style={{ padding:'8px 14px', background:'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              <Printer size={14}/> PDF
            </button>
          )}
        </div>
        )}
      </div>

      {/* Contador de análises por role */}
      {!semLimite && (
        <div style={{ padding:'10px 16px', borderRadius:10, background: analisesBloqueado ? '#fee2e2' : role === 'explorador' ? '#eff6ff' : '#fef3c7', color: analisesBloqueado ? '#dc2626' : role === 'explorador' ? '#084BA6' : '#92400e', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <span>{analisesBloqueado
            ? (role === 'explorador'
                ? '🔒 Você usou suas 5 análises do mês. Faça upgrade para continuar.'
                : `🔒 Limite de ${limiteRole} análises mensais atingido.`)
            : role === 'explorador'
              ? `📊 Análises mercadológicas este mês: ${analisesUsadas}/${limiteRole}${analisesBonus > 0 ? ` (+${analisesBonus} bônus)` : ''}`
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

      {/* ===== 2 COLUNAS: barra lateral (status/ações) + central (etapas) ===== */}
      <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : '260px 1fr', gap:16, alignItems:'start' }}>

        {/* ── BARRA LATERAL ── */}
        {!isMobile && (
        <aside style={{ position:'sticky', top:80, display:'flex', flexDirection:'column', gap:12 }}>

          {/* Opção de menu: inclusão manual (URL/arquivos). Ao ativar, o centro
              mostra a inclusão manual em cima e a geração de relatórios embaixo.
              Some quando a entrada já é 100% manual (não há o que alternar). */}
          {!semImovelBase && (
            <>
              <button onClick={() => setModoManual(m => !m)}
                style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'12px 14px', border:`1px solid ${modoManual?'#7c3aed':'#e2e8f0'}`, background: modoManual?'#faf5ff':'white', borderRadius:14, cursor:'pointer', fontSize:13, fontWeight:800, color: modoManual?'#7c3aed':'#334155', textAlign:'left' }}>
                <Building2 size={17} color={modoManual?'#7c3aed':'#94a3b8'}/>
                <span style={{ flex:1 }}>{modoManual ? 'Inclusão manual ativa' : 'Incluir URL / arquivos'}</span>
                <span style={{ width:34, height:18, borderRadius:20, background: modoManual?'#7c3aed':'#e2e8f0', position:'relative', flexShrink:0, transition:'background .15s' }}>
                  <span style={{ position:'absolute', top:2, left: modoManual?18:2, width:14, height:14, borderRadius:'50%', background:'white', transition:'left .15s' }}/>
                </span>
              </button>
              <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.5, padding:'0 4px', marginTop:-2 }}>
                Use quando o imóvel <strong>não veio da busca do BidPro</strong> ou quando <strong>algum documento não foi coletado</strong>: cole a <strong>URL do lote no site do leiloeiro</strong> (a IA busca os anexos) ou <strong>anexe os arquivos</strong> (edital, matrícula, regras) para a IA analisar.
              </div>
            </>
          )}

          {/* Documentos do leiloeiro */}
          <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:14, padding:14 }}>
            <div style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>Documentos do leiloeiro</div>
            {(() => {
              const docMap = { edital:'Edital', matricula:'Matrícula', regras_venda:'Regra de venda online' };
              // Só os tópicos pertinentes à modalidade: venda direta tem "regra de
              // venda online" (não edital de leilão); leilão judicial/extrajudicial
              // tem edital. Matrícula vale em todos.
              const isVendaDireta = (imovelInicial?.modalidade || '') === 'venda_direta';
              const topicos = isVendaDireta ? ['regras_venda','matricula'] : ['edital','matricula'];
              // Links válidos: matricula.asp e detalhe-imovel.asp são páginas do
              // portal (dão 404 / não são arquivo) — não viram link de documento.
              const ehArquivo = (v) => /^https?:\/\//i.test(v||'') && !/matricula\.asp|detalhe-imovel\.asp/i.test(v);
              // Matrícula CEF: PDF estático em /editais/matricula/<UF>/<num>.pdf.
              const matriculaCef = caixaMatriculaUrl({ fonte: imovelInicial?.fonte, estado: imovelInicial?.estado, fonteId: imovelInicial?.fonteId });
              // Fallback "nunca sem documento": se o ARQUIVO não foi coletado, o
              // documento cai na PÁGINA do lote no leiloeiro (onde ele está).
              const paginaLeiloeiro = [imovelInicial?.urlLote, imovelInicial?.linkEdital, imovelInicial?.linkLeilao, imovelInicial?.url]
                .find(u => /^https?:\/\//i.test(u || '')) || null;
              const docsView = topicos.map(t => {
                const a = docsLeiloeiro.find(x => x.tipo === t);
                const anexoUrl = (a?.url && /^https?:\/\//.test(a.url)) ? a.url : null;
                let fileUrl;
                if (t === 'matricula') {
                  // Prefere o PDF estático da Caixa (limpo, abre igual à tela do
                  // imóvel) ao anexo capturado — que às vezes é um "print" de
                  // visualizador, com baixa legibilidade. Anexo só como fallback.
                  fileUrl = matriculaCef || anexoUrl || (ehArquivo(imovelInicial?.linkMatricula) ? imovelInicial.linkMatricula : null);
                } else if (t === 'regras_venda') {
                  // "Regras da Venda Online": PDF padrão da Caixa (o link azul do
                  // portal). É o ARQUIVO de regras de fato — preferido ao anexo.
                  fileUrl = (isVendaDireta && caixaRegrasVendaUrl({ fonte: imovelInicial?.fonte }))
                    || anexoUrl || (ehArquivo(imovelInicial?.linkRegrasVenda) ? imovelInicial.linkRegrasVenda : null);
                } else {
                  fileUrl = anexoUrl || (ehArquivo(imovelInicial?.linkEdital) ? imovelInicial.linkEdital : null);
                }
                // Edital/regra/matrícula sempre com destino: arquivo, senão a página do leiloeiro.
                const url = fileUrl || paginaLeiloeiro;
                return { t, label: docMap[t], url, viaPagina: !fileUrl && !!paginaLeiloeiro };
              });
              const algum = docsView.some(x => x.url);
              return (
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  {docsView.map(it => it.url ? (
                    <a key={it.t} href={it.url} target="_blank" rel="noreferrer"
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, textDecoration:'none', fontSize:13, fontWeight:600, color:'#0D63DB' }}
                      onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                      <FileText size={14}/> {it.label}
                      {it.viaPagina && <span style={{ fontSize:10, color:'#94a3b8', fontWeight:600 }}>no site</span>}
                      <ExternalLink size={11} style={{ marginLeft:'auto' }}/>
                    </a>
                  ) : (
                    <div key={it.t} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', fontSize:13, fontWeight:600, color:'#94a3b8' }}>
                      <FileText size={14}/> {it.label} <span style={{ marginLeft:'auto', fontSize:10, fontWeight:700 }}>anexe acima ↑</span>
                    </div>
                  ))}
                  {!algum && <div style={{ fontSize:11, color:'#94a3b8', marginTop:4, lineHeight:1.4 }}>Sem anexos do leiloeiro para este imóvel.</div>}
                </div>
              );
            })()}
          </div>

          {/* Relatórios gerados */}
          <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:14, padding:14 }}>
            <div style={{ fontSize:11, fontWeight:800, color:'#94a3b8', textTransform:'uppercase', letterSpacing:1, marginBottom:10 }}>Relatórios</div>
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {[
                { k:'mercado', label:'Mercadológico + Viabilidade', ok: relMercadoGerado },
                { k:'documental', label:'Documental + Processo', ok: relDocumentalGerado },
              ].map(it => (
                // Não clicável até o relatório ser gerado (geração é pelos cards do centro).
                <button key={it.k} disabled={!it.ok} onClick={() => { if (it.ok) setRelSel(it.k); }}
                  title={it.ok ? '' : 'Gere o relatório no centro para abrir aqui'}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', border:'none', background: relSel===it.k ? '#eff6ff' : 'none', borderRadius:8, cursor: it.ok?'pointer':'default', textAlign:'left', fontSize:13, fontWeight:600, color: it.ok ? '#334155' : '#cbd5e1' }}
                  onMouseEnter={e=>{ if(it.ok && relSel!==it.k) e.currentTarget.style.background='#f8fafc'; }} onMouseLeave={e=>{ if(relSel!==it.k) e.currentTarget.style.background='none'; }}>
                  <span style={{ width:18, height:18, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, background: it.ok ? '#dcfce7' : '#f1f5f9', color: it.ok ? '#15803d' : '#cbd5e1' }}>{it.ok ? '✓' : '·'}</span>
                  {it.label}
                </button>
              ))}
            </div>
          </div>

          {/* Workflow: reunião com analista → encaminhar ao jurídico */}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <button onClick={solicitarReuniao} disabled={!ambosRelatorios || reuniaoSolicitada}
              title={!ambosRelatorios ? 'Gere os dois relatórios para liberar' : ''}
              style={{ width:'100%', padding:'11px', background: !ambosRelatorios ? '#e2e8f0' : reuniaoSolicitada ? '#10b981' : '#0D63DB', color: !ambosRelatorios ? '#94a3b8' : 'white', border:'none', borderRadius:12, fontWeight:700, fontSize:13, cursor: (!ambosRelatorios||reuniaoSolicitada) ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              {reuniaoSolicitada ? <><CheckCircle2 size={15}/> Reunião solicitada</> : <><Calendar size={15}/> Solicitar reunião com analista</>}
            </button>
            {!ambosRelatorios && <div style={{ fontSize:10, color:'#94a3b8', textAlign:'center', lineHeight:1.4 }}>Disponível após gerar os dois relatórios.</div>}

            {isStaffAnalise && reuniaoSolicitada && !reuniaoRealizada && (
              <button onClick={marcarReuniaoRealizada}
                style={{ width:'100%', padding:'9px', background:'#111111', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:12, cursor:'pointer' }}>
                ✓ Marcar reunião realizada
              </button>
            )}

            <button onClick={encaminharJuridico} disabled={!reuniaoRealizada || juridicoEnviado}
              title={!reuniaoRealizada ? 'Disponível somente após a reunião com o analista' : ''}
              style={{ width:'100%', padding:'11px', background: juridicoEnviado ? '#10b981' : !reuniaoRealizada ? '#e2e8f0' : '#7c3aed', color: (!reuniaoRealizada && !juridicoEnviado) ? '#94a3b8' : 'white', border:'none', borderRadius:12, fontWeight:700, fontSize:13, cursor: (!reuniaoRealizada||juridicoEnviado) ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              {juridicoEnviado ? <><CheckCircle2 size={15}/> Encaminhado ao jurídico</> : <><Scale size={15}/> Encaminhar ao jurídico</>}
            </button>
            {juridicoEnviado ? (
              <div style={{ fontSize:10, color:'#0f766e', textAlign:'center', lineHeight:1.4, background:'#f0fdfa', border:'1px solid #99f6e4', borderRadius:8, padding:'6px 8px' }}>
                📨 Encaminhado. Aguardando a devolutiva do jurídico — prazo de <b>até 7 dias úteis</b>. Você é avisado no Atendimento assim que o parecer chegar.
              </div>
            ) : !reuniaoRealizada && (
              <div style={{ fontSize:10, color:'#94a3b8', textAlign:'center', lineHeight:1.4 }}>Disponível somente após a reunião com o analista.</div>
            )}
          </div>
        </aside>
        )}

        {/* ── CENTRAL (relatórios) ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:14, minWidth:0 }}>

          {/* Barra de voltar (quando um relatório está aberto no centro) */}
          {relSel !== null && (
            <div style={{ position:'sticky', top:0, zIndex:20, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'#f8fafc', padding:'10px 0', marginBottom:2 }}>
              <button onClick={() => setRelSel(null)} style={{ display:'flex', alignItems:'center', gap:6, background:'white', border:'1px solid #cbd5e1', borderRadius:10, padding:'9px 15px', fontSize:13, fontWeight:800, color:'#0D63DB', cursor:'pointer', boxShadow:'0 1px 4px rgba(0,0,0,0.1)' }}>← Voltar / gerar outro relatório</button>
              <button onClick={imprimirPDF} style={{ display:'flex', alignItems:'center', gap:6, background:'#0D63DB', border:'none', borderRadius:10, padding:'9px 15px', fontSize:13, fontWeight:700, color:'white', cursor:'pointer' }}><Printer size={14}/> PDF</button>
            </div>
          )}

          {/* LAUNCHER — inclusão manual (topo, quando ativa) + botões de gerar */}
          {relSel === null && (
          <>
            {/* Opção de menu no mobile (a barra lateral fica oculta em telas pequenas) */}
            {isMobile && !semImovelBase && (
              <>
                <button onClick={() => setModoManual(m => !m)}
                  style={{ display:'flex', alignItems:'center', gap:9, width:'100%', padding:'12px 14px', border:`1px solid ${modoManual?'#7c3aed':'#e2e8f0'}`, background: modoManual?'#faf5ff':'white', borderRadius:14, cursor:'pointer', fontSize:13, fontWeight:800, color: modoManual?'#7c3aed':'#334155', textAlign:'left' }}>
                  <Building2 size={17} color={modoManual?'#7c3aed':'#94a3b8'}/>
                  <span style={{ flex:1 }}>{modoManual ? 'Inclusão manual ativa' : 'Incluir URL / arquivos'}</span>
                  <span style={{ width:34, height:18, borderRadius:20, background: modoManual?'#7c3aed':'#e2e8f0', position:'relative', flexShrink:0 }}>
                    <span style={{ position:'absolute', top:2, left: modoManual?18:2, width:14, height:14, borderRadius:'50%', background:'white' }}/>
                  </span>
                </button>
                <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.5, padding:'0 4px', marginTop:-2 }}>
                  Use quando o imóvel <strong>não veio da busca do BidPro</strong> ou quando <strong>algum documento não foi coletado</strong>: cole a <strong>URL do lote no site do leiloeiro</strong> (a IA busca os anexos) ou <strong>anexe os arquivos</strong> para a IA analisar.
                </div>
              </>
            )}

            {/* ── Inclusão manual / imóvel de outro leiloeiro (URL + anexos) ──
                Sobe pro topo do centro quando o modo manual está ativo. */}
            {modoManual && (
              <div style={{ border:'1px dashed #c4b5fd', background:'#faf5ff', borderRadius:16, padding: isMobile?'16px 18px':'20px 22px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <Building2 size={17} color="#7c3aed"/>
                  <div style={{ fontSize:15, fontWeight:900, color:'#111' }}>{semImovelBase ? 'Incluir lote manualmente' : 'Imóvel de outro leiloeiro'}</div>
                </div>
                <div style={{ fontSize:12, color:'#64748b', lineHeight:1.6, marginBottom:12 }}>
                  Cole o <strong>link do lote</strong> e/ou anexe o <strong>edital/matrícula</strong> de um imóvel que não está na nossa base. A IA extrai os dados (endereço, valores, área, leiloeiro, riscos) e libera os relatórios abaixo. <strong>É uma análise fora da base</strong> — os dados dependem do que você fornecer (sem a curadoria BidPro). Nossa equipe é avisada para avaliar integrar este leiloeiro.
                </div>
                {externoNotificado ? (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#ecfdf5', border:'1px solid #a7f3d0', borderRadius:10, fontSize:12, fontWeight:700, color:'#065f46' }}>
                    <CheckCircle2 size={15}/> Análise liberada — gere os relatórios abaixo. Equipe avisada.
                  </div>
                ) : (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    <input value={externoLink} onChange={e=>setExternoLink(e.target.value)} placeholder="Link do lote / página do leiloeiro (https://...)"
                      style={{ width:'100%', padding:'10px 12px', border:'1px solid #ddd6fe', borderRadius:9, fontSize:13, color:'#111', boxSizing:'border-box' }}
                      onKeyDown={e=>{ if(e.key==='Enter' && !externoEnviando) analisarLeiloeiroExterno(); }}/>
                    <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                      <label style={{ display:'flex', alignItems:'center', gap:7, padding:'9px 14px', border:'2px dashed #ddd6fe', borderRadius:10, color:'#7c3aed', fontSize:12, fontWeight:700, cursor:'pointer' }}>
                        <UploadCloud size={15}/> {textoDoc.trim() ? 'Edital anexado ✓' : 'Anexar edital/matrícula (PDF/TXT)'}
                        <input type="file" accept=".pdf,.txt" onChange={handleFileUpload} style={{display:'none'}}/>
                      </label>
                      <button onClick={analisarLeiloeiroExterno} disabled={externoEnviando || analisesBloqueado}
                        style={{ flex:1, minWidth:180, padding:'10px 16px', background:(externoEnviando||analisesBloqueado)?'#cbd5e1':'#7c3aed', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor:(externoEnviando||analisesBloqueado)?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                        {externoEnviando ? <><Loader2 size={15} style={{animation:'spin 1s linear infinite'}}/> Liberando...</> : analisesBloqueado ? <><Lock size={14}/> Limite atingido</> : <><Sparkles size={15}/> Liberar análise deste imóvel</>}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:16, padding: isMobile?'18px':'26px' }}>
              <div style={{ fontSize:16, fontWeight:900, color:'#111', marginBottom:4 }}>Gerar relatórios de análise</div>
              <div style={{ fontSize:13, color:'#64748b', marginBottom:18, lineHeight:1.6 }}>A IA usa automaticamente os dados e documentos deste imóvel. Gere cada relatório — eles vão para a barra lateral e abrem aqui. Com os dois prontos, libera a reunião com o analista.</div>
              <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr':'1fr 1fr', gap:14 }}>
                {[
                  { k:'mercado', cor:'#0d9488', bg:'#f0fdfa', Icon:BarChart3, titulo:'Mercadológico + Viabilidade Financeira', desc:'Avaliação de mercado (níveis 1 e 2), estrutura de custos, cenários, ROI/ROE e teto de lance.', ok:relMercadoGerado, gerando:gerandoMercado, fn:gerarRelMercado, block: analisesBloqueado, seqBloqueado:false, ordem:1 },
                  { k:'documental', cor:'#1e3a8a', bg:'#eef2ff', Icon:Scale, titulo:'Análise Documental + Processo', desc:'Leitura do edital/matrícula (ônus e gravames) e consulta do processo no CNJ + certidões fiscais.', ok:relDocumentalGerado, gerando:gerandoDocumental, fn:gerarRelDocumental, block:false, seqBloqueado: !relMercadoGerado, planoBloqueado: ROLES_SEM_DOCUMENTAL.includes(role), ordem:2 },
                ].map(c => {
                  const travado = c.gerando || c.block || c.seqBloqueado || c.planoBloqueado;
                  return (
                  <div key={c.k} style={{ border:`1px solid ${c.ok?c.cor:'#e2e8f0'}`, borderRadius:14, padding:'18px', display:'flex', flexDirection:'column', gap:12, background: c.ok?c.bg:'white', opacity: c.seqBloqueado?0.7:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:40, height:40, borderRadius:10, background:c.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><c.Icon size={20} color={c.cor}/></div>
                      <div style={{ fontSize:14, fontWeight:800, color:'#111', lineHeight:1.25 }}><span style={{ color:c.cor }}>{c.ordem}.</span> {c.titulo}</div>
                    </div>
                    <div style={{ fontSize:12, color:'#64748b', lineHeight:1.6, flex:1 }}>{c.desc}</div>
                    <div style={{ display:'flex', gap:8 }}>
                      {c.planoBloqueado ? (
                        <button onClick={()=>nav('/planos')}
                          style={{ flex:1, padding:'10px', background:c.cor, color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                          <Lock size={14}/> Disponível no Investidor Pro
                        </button>
                      ) : (
                        <button onClick={c.fn} disabled={travado}
                          style={{ flex:1, padding:'10px', background: travado?'#cbd5e1':c.cor, color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor: travado?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                          {c.gerando ? <><Loader2 size={15} style={{animation:'spin 1s linear infinite'}}/> Gerando...</>
                            : c.block ? <><Lock size={14}/> Limite atingido</>
                            : c.seqBloqueado ? <><Lock size={14}/> Gere o 1º antes</>
                            : <><Sparkles size={15}/> {c.ok?'Regerar':'Gerar'}</>}
                        </button>
                      )}
                      {c.ok && <button onClick={()=>setRelSel(c.k)} style={{ padding:'10px 14px', background:'white', color:c.cor, border:`1px solid ${c.cor}`, borderRadius:10, fontWeight:800, fontSize:13, cursor:'pointer' }}>Abrir</button>}
                    </div>
                    {c.gerando && (
                      <div style={{ fontSize:11, color:c.cor, lineHeight:1.4, textAlign:'center' }}>
                        {c.k==='mercado'
                          ? 'Buscando preços de mercado em tempo real e montando a viabilidade — pode levar até ~2 min. Pode fechar a aba; continua no servidor.'
                          : 'Lendo edital/matrícula/anexos e consultando o processo no CNJ — roda no servidor; pode fechar a aba.'}
                      </div>
                    )}
                  </div>
                );})}
              </div>
              {docMsg && <div style={{ marginTop:14, padding:'10px 14px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:10, fontSize:12, color:'#92400e' }}>{docMsg}</div>}
            </div>
          </>
          )}

          {/* ===== RELATÓRIO: ANÁLISE DOCUMENTAL + PROCESSO ===== */}
          {relSel === 'documental' && (
            <div style={{ background:'linear-gradient(135deg,#0f172a,#1e3a8a)', borderRadius:16, padding:'18px 22px', color:'white' }}>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, textTransform:'uppercase', opacity:0.85 }}>Relatório · BidPro Brasil</div>
              <div style={{ fontSize:18, fontWeight:900, marginTop:2 }}>Análise Documental e Processo</div>
              <div style={{ fontSize:12, opacity:0.9, marginTop:4 }}>{d.nome||'Imóvel'}{[d.cidade,d.estado].filter(Boolean).length ? ` · ${[d.cidade,d.estado].filter(Boolean).join(', ')}` : ''}</div>
            </div>
          )}

          {/* Enquanto a IA gera (cliente): estado de carregamento no lugar da antiga
              tela de formulários — a análise roda inteira no servidor. */}
          {relSel === 'documental' && !parecerDocumental && (gerandoDocumental || docEntry?.status === 'gerando') && (
            <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:16, padding:'28px 22px', display:'flex', flexDirection:'column', alignItems:'center', gap:12, textAlign:'center' }}>
              <Loader2 size={28} color="#1e3a8a" style={{ animation:'spin 1s linear infinite' }}/>
              <div style={{ fontSize:15, fontWeight:800, color:'#111' }}>Gerando a análise documental e jurídica…</div>
              <div style={{ fontSize:13, color:'#64748b', lineHeight:1.6, maxWidth:460 }}>A IA está lendo o edital/matrícula e as regras da venda, consultando o processo no CNJ e as certidões fiscais. Leva alguns instantes — você pode fechar a aba; continua no servidor e aparece aqui quando pronto.</div>
            </div>
          )}

          {/* Parecer documental gerado NO SERVIDOR (lê edital/matrícula/anexos + CNJ) */}
          {relSel === 'documental' && parecerDocumental && (
            <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:16, padding:'20px 22px', display:'flex', flexDirection:'column', gap:14 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <Scale size={18} color="#1e3a8a"/>
                <div style={{ fontSize:15, fontWeight:900, color:'#111' }}>Parecer Documental e Jurídico (IA)</div>
                {parecerDocumental.nivelRisco && (
                  <span style={{ marginLeft:'auto', fontSize:11, fontWeight:800, padding:'3px 10px', borderRadius:20,
                    background: parecerDocumental.nivelRisco==='vermelho'?'#fee2e2':parecerDocumental.nivelRisco==='amarelo'?'#fef3c7':'#dcfce7',
                    color: parecerDocumental.nivelRisco==='vermelho'?'#b91c1c':parecerDocumental.nivelRisco==='amarelo'?'#92400e':'#15803d' }}>
                    Risco {parecerDocumental.nivelRisco}
                  </span>
                )}
              </div>
              {(parecerDocumental.documentosLidos || []).length > 0 && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {parecerDocumental.documentosLidos.map((dl, i) => (
                    <a key={i} href={dl.url} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, fontWeight:700, color:'#1e3a8a', background:'#eef2ff', padding:'3px 9px', borderRadius:6, textDecoration:'none' }}>📄 {dl.rotulo}</a>
                  ))}
                </div>
              )}
              {(parecerDocumental.checklist || []).length > 0 && (
                <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:12, padding:'14px 16px' }}>
                  <div style={{ fontSize:12, fontWeight:800, color:'#334155', marginBottom:10, display:'flex', alignItems:'center', gap:7 }}>
                    📋 Evolução das consultas
                    {parecerDocumental.pendencias > 0 && (
                      <span style={{ marginLeft:'auto', fontSize:10.5, fontWeight:800, color:'#92400e', background:'#fef3c7', padding:'2px 8px', borderRadius:20 }}>
                        {parecerDocumental.pendencias} pendente(s)
                      </span>
                    )}
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {parecerDocumental.checklist.map((c, i) => {
                      const cor = c.status==='feito' ? '#16a34a' : c.status==='pendente' ? '#d97706' : '#94a3b8';
                      const ic  = c.status==='feito' ? '✓' : c.status==='pendente' ? '⏳' : '—';
                      return (
                        <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                          <span style={{ color:cor, fontWeight:900, fontSize:13, lineHeight:1.5, flexShrink:0, width:14, textAlign:'center' }}>{ic}</span>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:12.5, fontWeight:700, color:'#111' }}>{c.label}</div>
                            <div style={{ fontSize:11.5, color:'#64748b', lineHeight:1.5 }}>{c.detalhe}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {parecerDocumental.pendencias > 0 && (
                    <div style={{ marginTop:10, fontSize:11.5, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'8px 11px', lineHeight:1.5 }}>
                      Algumas fontes públicas estavam instáveis/em verificação no momento. Liberamos o relatório com o que já temos e ele é <strong>complementado automaticamente em até 48h</strong> — sem custo extra.
                    </div>
                  )}
                </div>
              )}
              {parecerDocumental.parecer && (
                <div style={{ fontSize:13.5, color:'#334155', lineHeight:1.75, whiteSpace:'pre-wrap' }}>
                  {parecerDocumental.parecer.replace(/§\s*SEÇÃO:/g, '\n§ ').trim()}
                </div>
              )}
              {(parecerDocumental.lacunas || []).length > 0 && (
                <div style={{ background:'#fffbeb', border:'1px solid #fde68a', borderRadius:12, padding:'12px 16px' }}>
                  <div style={{ fontSize:12, fontWeight:800, color:'#92400e', marginBottom:6 }}>⚠ Dados a confirmar (não constam na documentação)</div>
                  <ul style={{ margin:0, paddingLeft:18, fontSize:12.5, color:'#92400e', lineHeight:1.6 }}>
                    {parecerDocumental.lacunas.map((l, i) => <li key={i}>{l}</li>)}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* PRÓXIMO PASSO — destaque ao fim do Documental: reunião com o analista */}
          {relSel === 'documental' && parecerDocumental && !isStaffAnalise && (
            <div style={{ background:'#faf5ff', border:'2px solid #c4b5fd', borderRadius:16, padding:'18px 20px', display:'flex', gap:14, alignItems:'flex-start' }}>
              <ShieldAlert size={22} color="#7c3aed" style={{ flexShrink:0, marginTop:2 }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:900, color:'#5b21b6', marginBottom:4 }}>Antes de dar o lance, valide com um especialista</div>
                <div style={{ fontSize:12.5, color:'#4c1d95', lineHeight:1.7, marginBottom:12 }}>
                  Arrematar é uma <strong>operação de risco</strong> e deve ser conduzida profissionalmente. Com os dois relatórios prontos, <strong>agende uma reunião com um analista BidPro</strong> para revisar a operação, tirar dúvidas e decidir com segurança.
                </div>
                <button onClick={solicitarReuniao} disabled={!ambosRelatorios || reuniaoSolicitada}
                  title={!ambosRelatorios ? 'Gere também o relatório Mercadológico para liberar' : ''}
                  style={{ padding:'11px 18px', background: (!ambosRelatorios||reuniaoSolicitada)?'#cbd5e1':'#7c3aed', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor:(!ambosRelatorios||reuniaoSolicitada)?'default':'pointer', display:'inline-flex', alignItems:'center', gap:8 }}>
                  {reuniaoSolicitada ? <><CheckCircle2 size={15}/> Reunião solicitada</> : <><Calendar size={15}/> Agendar reunião com analista</>}
                </button>
                {!ambosRelatorios && <div style={{ fontSize:11, color:'#7c3aed', marginTop:8 }}>Gere também o relatório Mercadológico + Viabilidade para liberar o agendamento.</div>}
              </div>
            </div>
          )}

          {relSel === 'documental' && isStaffAnalise && (<>

      {/* ── ETAPA 1: DOCUMENTO ── */}
      <Section id="sec-doc" step="1" title="Edital" icon={FileText} color="#0D63DB" open={openSec.doc} onToggle={()=>toggleSec('doc')} badge="Upload ou cole o texto">
        <div style={{ display:'flex', flexDirection:'column', gap:12, paddingTop:14 }}>
          <textarea value={textoDoc} onChange={e=>setTextoDoc(e.target.value)} rows={7}
            placeholder="Cole aqui o texto do edital do leilão. A extração irá capturar endereço, valores, área, leiloeiro, riscos jurídicos, ônus, débitos, datas e muito mais..."
            style={{ width:'100%', padding:'12px', border:'1px solid #e2e8f0', borderRadius:10, fontSize:13, color:'#111111', resize:'vertical', boxSizing:'border-box', lineHeight:1.6, fontFamily:'inherit' }}/>
          {/* URL do edital/lote */}
          <div style={{ display:'flex', gap:6 }}>
            <input value={urlEdital} onChange={e=>setUrlEdital(e.target.value)} placeholder="URL do edital ou página do lote (https://...)"
              style={{ flex:1, padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:9, fontSize:13, color:'#111' }}
              onKeyDown={e=>{ if(e.key==='Enter' && !loadDoc) analisarUrl(); }}/>
            <button onClick={analisarUrl} disabled={loadDoc||analisesBloqueado||!urlEdital.trim()}
              style={{ padding:'9px 14px', background:urlEdital.trim()&&!analisesBloqueado?'#7c3aed':'#e2e8f0', color:urlEdital.trim()&&!analisesBloqueado?'white':'#94a3b8', border:'none', borderRadius:9, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
              {loadDoc ? '⏳' : <><Search size={13}/> Analisar URL</>}
            </button>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <label style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'10px', border:'2px dashed #e2e8f0', borderRadius:10, color:'#64748b', fontSize:13, fontWeight:600, cursor:'pointer', transition:'border-color 0.2s' }}
              onMouseEnter={e=>e.currentTarget.style.borderColor='#0D63DB'} onMouseLeave={e=>e.currentTarget.style.borderColor='#e2e8f0'}>
              <UploadCloud size={16}/> Upload PDF ou .TXT
              <input type="file" accept=".pdf,.txt" onChange={handleFileUpload} style={{display:'none'}}/>
            </label>
            <button onClick={extrairDoc} disabled={loadDoc||analisesBloqueado||(!textoDoc.trim()&&!textoMatricula.trim())}
              style={{ flex:2, padding:'10px', background:(textoDoc.trim()||textoMatricula.trim())&&!analisesBloqueado?'#0D63DB':'#e2e8f0', color:(textoDoc.trim()||textoMatricula.trim())&&!analisesBloqueado?'white':'#94a3b8', border:'none', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              {loadDoc ? <><Loader2 size={15} style={{animation:'spin 1s linear infinite'}}/> Extraindo dados...</> : analisesBloqueado ? <><Lock size={14}/> Limite atingido</> : <><Sparkles size={15}/> Extrair dados</>}
            </button>
          </div>
          <div style={{ display:'flex', gap:8, fontSize:11, color:'#94a3b8' }}>
            <Info size={12} style={{flexShrink:0,marginTop:1}}/>
            <span>Cole a URL do lote, faça upload de PDF/TXT ou cole o texto do edital. A IA extrai todos os dados sem armazenar o arquivo.</span>
          </div>
        </div>
      </Section>

      {/* ── ETAPA 1B: MATRÍCULA (Investidor Pro e acima) ── */}
      {['top2','assessorado','clube','analista','advogado','admin'].includes(role) && (
        <Section id="sec-matricula" step="1B" title="Matrícula do Imóvel" icon={ClipboardList} color="#7c3aed" open={openSec.matricula ?? false} onToggle={()=>toggleSec('matricula')} badge="Incluso no Investidor Pro">
          <div style={{ display:'flex', flexDirection:'column', gap:12, paddingTop:14 }}>
            <div style={{ background:'#ede9fe', border:'1px solid #c4b5fd', borderRadius:10, padding:'10px 14px', fontSize:12, color:'#6d28d9' }}>
              <strong>Investidor Pro:</strong> Cole a matrícula do imóvel junto com o edital. Os dois documentos são extraídos juntos em uma única análise, identificando ônus, usufrutos, hipotecas, alienações e histórico de proprietários.
            </div>
            <textarea value={textoMatricula} onChange={e=>setTextoMatricula(e.target.value)} rows={6}
              placeholder="Cole aqui o texto da matrícula do imóvel (certidão de inteiro teor). A análise identificará automaticamente ônus reais, hipotecas, penhoras, usufrutos, alienação fiduciária e histórico de proprietários..."
              style={{ width:'100%', padding:'12px', border:'1px solid #c4b5fd', borderRadius:10, fontSize:13, color:'#111111', resize:'vertical', boxSizing:'border-box', lineHeight:1.6, fontFamily:'inherit' }}/>
            <label style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7, padding:'10px', border:'2px dashed #c4b5fd', borderRadius:10, color:'#7c3aed', fontSize:13, fontWeight:600, cursor:'pointer' }}>
              <UploadCloud size={16}/> Upload matrícula PDF ou .TXT
              <input type="file" accept=".pdf,.txt" onChange={async e => {
                const f = e.target.files[0]; if (!f) return;
                if (f.type === 'application/pdf') {
                  const buf = await f.arrayBuffer();
                  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
                  const ext = await extrairDadosDocumento('', b64).catch(() => null);
                  if (ext?.observacoes) setTextoMatricula(ext.observacoes);
                  else setTextoMatricula(`[PDF matrícula: ${f.name}]`);
                } else { setTextoMatricula(await f.text()); }
              }} style={{display:'none'}}/>
            </label>
          </div>
        </Section>
      )}

      </>)}
      {/* Formulários manuais (CNJ, certidões, dados/custos editáveis) são ferramenta
          da EQUIPE. O cliente clica "Gerar" e recebe o PARECER pronto (a IA já faz a
          consulta CNJ e as certidões no servidor) — sem tela intermediária. */}
      {relSel === 'documental' && isStaffAnalise && (<>

      {/* ── ETAPA 1C: CONSULTA JURÍDICA CNJ — apenas roles com CNJ ── */}
      {!temCNJ && (
        <div style={{ padding:'12px 16px', borderRadius:10, background:'#f8fafc', border:'1px solid #e2e8f0', fontSize:13, color:'#64748b', display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <Lock size={15} color="#94a3b8"/>
          <span>Consulta Jurídica CNJ disponível a partir do plano <strong>Investidor Pro</strong>.</span>
          <button onClick={() => nav('/planos')} style={{ marginLeft:'auto', padding:'5px 12px', background:'#0D63DB', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer' }}>Ver planos</button>
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
                        <span style={{ fontWeight: 800, fontSize: 13, color: '#111111' }}>{proc.numero}</span>
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
                          proc.valor_causa ? ['Valor da Causa', `R$ ${Number(proc.valor_causa).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`] : null,
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
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', marginBottom: 6, letterSpacing: 0.5 }}>Partes Processuais</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {proc.partes.map((parte, i) => (
                              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', background: i % 2 === 0 ? '#f8fafc' : 'white', borderRadius: 6, fontSize: 12 }}>
                                <User size={12} color="#64748b" style={{ flexShrink: 0, marginTop: 1 }} />
                                <div style={{ flex: 1 }}>
                                  <span style={{ fontWeight: 700, color: '#111111' }}>{parte.nome}</span>
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

            {/* ── Certidões: CND + PGFN ── */}
            <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Certidões Fiscais — CPF ou CNPJ do Executado
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#475569' }}>
              Consulta pública na <strong>Receita Federal</strong> (situação cadastral) e <strong>PGFN</strong> (Dívida Ativa da União). Não requer certificado digital.
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={certDocumento}
                onChange={e => setCertDocumento(e.target.value)}
                placeholder="CPF (000.000.000-00) ou CNPJ (00.000.000/0000-00)"
                style={{ flex: 1, padding: '9px 11px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13 }}
              />
              <button onClick={buscarCertidoes} disabled={loadCert || !certDocumento.trim()}
                style={{ padding: '9px 16px', background: loadCert ? '#94a3b8' : '#0f172a', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                {loadCert ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Consultando...</> : <><Search size={13} /> Consultar</>}
              </button>
            </div>

            {certErro && (
              <div style={{ padding: '10px 14px', background: '#fee2e2', borderRadius: 8, fontSize: 12, color: '#dc2626', display: 'flex', gap: 8 }}>
                <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {certErro}
              </div>
            )}

            {certResultados && (() => {
              const cores = { vermelho: ['#fef2f2','#dc2626','#fee2e2'], amarelo: ['#fefce8','#d97706','#fef3c7'], verde: ['#f0fdf4','#16a34a','#dcfce7'] };
              const [bg, cor, borda] = cores[certResultados.parecer?.nivel] || cores.verde;
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ background: bg, border: `2px solid ${borda}`, borderRadius: 10, padding: '12px 16px' }}>
                    <div style={{ fontWeight: 800, fontSize: 12, color: cor, marginBottom: 4 }}>
                      {certResultados.parecer?.nivel === 'verde' ? '✅ SITUAÇÃO FISCAL REGULAR' : certResultados.parecer?.nivel === 'amarelo' ? '⚠️ VERIFICAÇÃO PARCIAL' : '🔴 IRREGULARIDADE FISCAL'}
                    </div>
                    <div style={{ fontSize: 12, color: cor }}>{certResultados.parecer?.texto}</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                    {/* Receita Federal */}
                    {certResultados.receita_federal && (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Receita Federal</div>
                        {certResultados.receita_federal.ok ? (
                          <>
                            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>{certResultados.receita_federal.nome || '—'}</div>
                            <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: certResultados.receita_federal.regular ? '#16a34a' : '#dc2626' }} />
                              <span style={{ color: certResultados.receita_federal.regular ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{certResultados.receita_federal.situacao}</span>
                            </div>
                            {certResultados.receita_federal.municipio && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{certResultados.receita_federal.municipio}/{certResultados.receita_federal.uf}</div>}
                          </>
                        ) : (
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>{certResultados.receita_federal.erro || 'Indisponível'}</div>
                        )}
                      </div>
                    )}
                    {/* PGFN */}
                    {certResultados.divida_ativa && (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '12px 14px' }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Dívida Ativa — PGFN</div>
                        {certResultados.divida_ativa.ok ? (
                          <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: certResultados.divida_ativa.regular ? '#16a34a' : '#dc2626' }} />
                            <span style={{ color: certResultados.divida_ativa.regular ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{certResultados.divida_ativa.situacao}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>{certResultados.divida_ativa.erro || 'Indisponível'}</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            </div>

          </div>
        )}
      </Section>}

      {/* ── ETAPA 2: DADOS DO IMÓVEL ── */}
      <Section step="2" title="Dados do Imóvel" icon={Home} color="#111111" open={openSec.dados} onToggle={()=>toggleSec('dados')}
        badge={d.nome ? d.tipo.charAt(0).toUpperCase()+d.tipo.slice(1) : 'Preencha ou extraia do edital'}>
        <div style={{ display:'flex', flexDirection:'column', gap:18, paddingTop:14 }}>

          {/* Identificação */}
          <div>
            <div style={{ fontSize:11, fontWeight:800, color:'#0D63DB', textTransform:'uppercase', letterSpacing:1, marginBottom:10, paddingBottom:6, borderBottom:'2px solid #eff6ff' }}>Identificação</div>
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
              {/* Honorários BidPro (taxa de ÊXITO do escritório, partilhada com jurídico/
                  analista quando ativos): 10% por padrão, aplica-se a TODO arremate
                  (judicial E extrajudicial) — NÃO é sucumbência. Editável; entra nos
                  aportes e na viabilidade. */}
              <Field label="Honorários BidPro / êxito (%)" name="honorariosPercentual"
                value={d.honorariosPercentual != null ? d.honorariosPercentual : 10}
                onChange={upN} type="number"/>
              {/* Taxa administrativa do leilão (% além do leiloeiro — comum na Superbid)
                  e despesas administrativas (valor fixo, raras). Constam no EDITAL. */}
              <Field label="Taxa Administrativa (%)" name="taxaAdministrativaPercentual" value={d.taxaAdministrativaPercentual||0} onChange={upN} type="number"/>
              <Field label="Despesas Administrativas (R$)" name="despesasAdministrativas" value={d.despesasAdministrativas||0} onChange={upN} type="number"/>
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
                      style={{ flex:1, padding:'9px', border:'none', borderRadius:8, background:(d.tabelaAmortizacao||'sac')===v?'#111111':'#f1f5f9', color:(d.tabelaAmortizacao||'sac')===v?'white':'#64748b', fontWeight:700, fontSize:12, cursor:'pointer' }}>
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

      </>)}

      {relSel === 'mercado' && (
        <div style={{ background:'linear-gradient(135deg,#0B48A6,#0D63DB)', borderRadius:16, padding:'18px 22px', color:'white' }}>
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, textTransform:'uppercase', opacity:0.85 }}>Relatório · BidPro Brasil</div>
          <div style={{ fontSize:18, fontWeight:900, marginTop:2 }}>Mercadológico e Viabilidade Financeira</div>
          <div style={{ fontSize:12, opacity:0.9, marginTop:4 }}>{d.nome||'Imóvel'}{[d.cidade,d.estado].filter(Boolean).length ? ` · ${[d.cidade,d.estado].filter(Boolean).join(', ')}` : ''} · Desconto {fmtPct(descontoArremate)}</div>
        </div>
      )}
      {relSel === 'mercado' && (<>

      <div style={{ display:'flex', flexDirection:'column', gap:14, marginTop:14 }}>
        {/* ── CAPA / RESUMO PARA LEIGOS: veredito + 3 números + próximo passo ── */}
        <div style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', padding: isMobile?'16px':'20px 22px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            {isViavel ? <CheckCircle2 size={22} color="#10b981"/> : <XCircle size={22} color="#ef4444"/>}
            <span style={{ fontSize:16, fontWeight:900, color:isViavel?'#065f46':'#b91c1c' }}>
              {isUsoProprio ? 'Aprovado para uso próprio' : (isViavel ? 'Operação viável — vale avançar' : 'Operação reprovada — retorno insuficiente')}
            </span>
          </div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr':'repeat(3,1fr)', gap:10 }}>
            {[
              ['Desconto vs. mercado', d.valorMercado>0 ? fmtPct((1-(d.valorArrematacao||0)/d.valorMercado)*100) : '—', '#0D63DB'],
              [isAVista?'Retorno (ROI)':'Retorno (ROE)', fmtPct(metricas.roi), metricas.roi>=0?'#10b981':'#ef4444'],
              ['Rentabilidade anual (TIR)', indicadores.tir!=null ? fmtPct(indicadores.tir)+' a.a.' : '—', '#7c3aed'],
            ].map(([l,v,c])=>(
              <div key={l} style={{ background:'#f8fafc', borderRadius:12, padding:'12px 14px', textAlign:'center', border:'1px solid #e2e8f0' }}>
                <div style={{ fontSize:9, color:'#64748b', fontWeight:800, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>{l}</div>
                <div style={{ fontSize:20, fontWeight:900, color:c }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:14, padding:'12px 14px', background:isViavel?'#f0fdf4':'#fef2f2', border:`1px solid ${isViavel?'#bbf7d0':'#fecaca'}`, borderRadius:12, fontSize:13, color:isViavel?'#15803d':'#991b1b', lineHeight:1.6 }}>
            <strong>Próximo passo:</strong> {isUsoProprio
              ? 'Imóvel adequado ao uso próprio pelo preço analisado. Confirme os documentos com o time.'
              : (isViavel
                ? 'Os números fecham acima da meta. Agende a reunião com o analista para validar e seguir com a documentação.'
                : 'Pelo lance analisado, o retorno fica abaixo da meta. Reveja o valor do lance (veja o teto adiante) ou avalie outro imóvel.')}
          </div>
        </div>

        {/* ── INDICADORES DE RETORNO: VPL / TIR / payback / múltiplo + locação ── */}
        <div style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', padding: isMobile?'16px':'20px 22px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize:14, fontWeight:900, color:'#111', marginBottom:4 }}>Indicadores de retorno</div>
          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:14 }}>Régua (TMA): consideramos que o dinheiro deveria render ao menos <strong>{fmtPct(indicadores.tma,0)} ao ano</strong>. Os números abaixo já descontam essa régua.</div>
          <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr 1fr':'repeat(4,1fr)', gap:10 }}>
            {[
              ['VPL (revenda)', `R$ ${fmt(indicadores.vpl,0)}`, indicadores.vpl>=0?'#10b981':'#ef4444', 'Ganho hoje além da régua'],
              ['TIR (revenda)', indicadores.tir!=null?fmtPct(indicadores.tir)+' a.a.':'—', '#7c3aed', 'Rentabilidade anual'],
              ['Payback', indicadores.payback.meses!=null?`${indicadores.payback.meses} meses`:'—', '#0D63DB', 'Tempo p/ recuperar'],
              ['Múltiplo do capital', indicadores.multiplo!=null?`${fmt(indicadores.multiplo)}x`:'—', '#f59e0b', 'Quanto o capital volta'],
            ].map(([l,v,c,sub])=>(
              <div key={l} style={{ background:'#f8fafc', borderRadius:12, padding:'12px 14px', border:'1px solid #e2e8f0' }}>
                <div style={{ fontSize:9, color:c, fontWeight:800, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>{l}</div>
                <div style={{ fontSize:18, fontWeight:900, color:c }}>{v}</div>
                <div style={{ fontSize:10, color:'#94a3b8', marginTop:3 }}>{sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop:12, padding:'12px 14px', background:'#faf5ff', border:'1px solid #e9d5ff', borderRadius:12 }}>
            <div style={{ fontSize:12, fontWeight:800, color:'#6b21a8', marginBottom:6 }}>Cenário de locação (segurar e alugar por {indicadores.loc.horizonte} meses, venda ao final)</div>
            <div style={{ display:'flex', gap:18, flexWrap:'wrap', fontSize:13, color:'#4b5563' }}>
              <div>Aluguel líquido: <strong>R$ {fmt(indicadores.loc.aluguelLiquido)}/mês</strong></div>
              <div>VPL: <strong style={{ color: indicadores.loc.vpl>=0?'#10b981':'#ef4444' }}>R$ {fmt(indicadores.loc.vpl,0)}</strong></div>
              <div>TIR: <strong>{indicadores.loc.tir!=null?fmtPct(indicadores.loc.tir)+' a.a.':'—'}</strong></div>
            </div>
            <div style={{ fontSize:10, color:'#a78bfa', marginTop:6 }}>Premissa: compra à vista, aluguel líquido de IPTU/condomínio e venda ao valor de mercado atual no fim do período.</div>
          </div>
        </div>
      </div>

      {/* ── ETAPA 3: AVALIAÇÃO MERCADOLÓGICA ── */}
      <Section id="sec-mercado" step="3" title="Avaliação Mercadológica" icon={BarChart3} color="#10b981" open={openSec.mercado} onToggle={()=>toggleSec('mercado')}
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
                  ['Preço Médio/m²', `R$ ${fmt(mercado.precoMedioM2||0)}`, '#0D63DB','#eff6ff'],
                  ['Aluguel Médio', `R$ ${fmt(mercado.aluguelMedio||0)}/mês`, '#8b5cf6','#ede9fe'],
                  ['Rentabilidade Bruta (aluguel)', fmtPct(mercado.yieldBruto||0)+' a.a.', '#10b981','#f0fdf4'],
                  ['Rentabilidade Líquida (aluguel)', fmtPct(mercado.yieldLiquido||0)+' a.a.', '#f59e0b','#fef3c7'],
                ].map(([l,v,c,bg])=>(
                  <div key={l} style={{background:bg,borderRadius:12,padding:'14px 16px',textAlign:'center',border:`1px solid ${c}30`}}>
                    <div style={{fontSize:9,color:c,fontWeight:800,textTransform:'uppercase',marginBottom:6,letterSpacing:0.5}}>{l}</div>
                    <div style={{fontSize:20,fontWeight:900,color:c}}>{v}</div>
                  </div>
                ))}
              </div>

              {/* Validação FipeZAP — média dos anúncios × índice independente */}
              {mercado.referenciaFipeZap?.encontrado && mercado.referenciaFipeZap.precoMedioM2 > 0 && (() => {
                const anuncios = mercado.precoMedioM2 || 0;
                const fipe = mercado.referenciaFipeZap.precoMedioM2 || 0;
                const div = fipe ? Math.round((anuncios - fipe) / fipe * 100) : 0;
                const alinhado = Math.abs(div) <= 15;
                return (
                  <div style={{ borderRadius:12, border:`1px solid ${alinhado ? '#bbf7d0' : '#fed7aa'}`, background: alinhado ? '#f0fdf4' : '#fff7ed', padding:'12px 16px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                      <span style={{ fontSize:12, fontWeight:800, color:'#111' }}>Validação FipeZAP</span>
                      <span style={{ fontSize:10.5, color:'#64748b' }}>{mercado.referenciaFipeZap.localidade || ''} · {mercado.referenciaFipeZap.mesReferencia || 'recente'}</span>
                      <span style={{ marginLeft:'auto', fontSize:11, fontWeight:800, padding:'2px 8px', borderRadius:999, background: alinhado ? '#dcfce7' : '#ffedd5', color: alinhado ? '#166534' : '#9a3412' }}>
                        {alinhado ? '✓ Média alinhada' : `⚠ ${div > 0 ? '+' : ''}${div}% vs FipeZAP`}
                      </span>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, fontSize:12 }}>
                      <div><div style={{ color:'#94a3b8', fontSize:10, fontWeight:700 }}>ANÚNCIOS R$/m²</div><div style={{ fontWeight:800, color:'#0D63DB' }}>R$ {fmt(anuncios)}</div></div>
                      <div><div style={{ color:'#94a3b8', fontSize:10, fontWeight:700 }}>FipeZAP R$/m²</div><div style={{ fontWeight:800, color:'#111' }}>R$ {fmt(fipe)}</div></div>
                      <div><div style={{ color:'#94a3b8', fontSize:10, fontWeight:700 }}>VALORIZAÇÃO 12M</div><div style={{ fontWeight:800, color: (mercado.referenciaFipeZap.valorizacao12m||0) >= 0 ? '#059669' : '#dc2626' }}>{fmtPct(mercado.referenciaFipeZap.valorizacao12m||0)}</div></div>
                    </div>
                  </div>
                );
              })()}

              {/* Nível 1 — Mesmo Condomínio */}
              <div style={{ borderRadius:12, border:'2px solid #0D63DB', overflow:'hidden' }}>
                <div style={{ background:'#0D63DB', padding:'10px 16px', display:'flex', alignItems:'center', gap:8 }}>
                  <Building2 size={15} color="white"/>
                  <span style={{ fontWeight:800, color:'white', fontSize:13 }}>Comparativos diretos — mesmo condomínio / endereço (raio ~250 m)</span>
                  <span style={{ marginLeft:'auto', background:'rgba(255,255,255,0.2)', borderRadius:20, padding:'2px 10px', fontSize:11, fontWeight:700, color:'white', whiteSpace:'nowrap' }}>
                    {mercado.nivel1?.totalAmostras||0} amostras
                  </span>
                </div>
                {mercado.nivel1?.descricao && (
                  <div style={{ padding:'11px 16px', background:'#eff6ff', borderBottom:'1px solid #dbeafe', fontSize:12, color:'#334155', lineHeight:1.65 }}>{mercado.nivel1.descricao}</div>
                )}
                <div style={{ padding:14, display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:14 }}>
                  {mercado.nivel1?.vendas?.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#0D63DB', textTransform:'uppercase', marginBottom:8 }}>Venda — {mercado.nivel1.vendas.length} imóveis</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:8 }}>
                        {[['Mín R$/m²',`${fmt(mercado.nivel1.precoMinM2||0)}`,'#ef4444'],['Médio R$/m²',`${fmt(mercado.nivel1.precoMedioM2||0)}`,'#0D63DB'],['Máx R$/m²',`${fmt(mercado.nivel1.precoMaxM2||0)}`,'#10b981']].map(([l,v,c])=>(
                          <div key={l} style={{ background:'#f8fafc', borderRadius:8, padding:'8px 10px', textAlign:'center' }}>
                            <div style={{ fontSize:9, color:'#94a3b8', fontWeight:700, textTransform:'uppercase', marginBottom:2 }}>{l}</div>
                            <div style={{ fontSize:14, fontWeight:900, color:c }}>R$ {v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {mercado.nivel1.vendas.map((v,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:i%2===0?'#f8fafc':'white', borderRadius:6, fontSize:11 }}>
                            <span style={{ color:'#334155', flex:1, marginRight:8 }}>{v.descricao} <span style={{ color:'#94a3b8' }}>({v.fonte}{v.data ? ` · ${fmtDataAnuncio(v.data)}` : ''})</span></span>
                            <span style={{ fontWeight:700, color:'#0D63DB', flexShrink:0 }}>R$ {fmt(v.valor)} · {fmt(v.valorM2)}/m²</span>
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
                        <div style={{ fontSize:20, fontWeight:900, color:'#7c3aed' }}>R$ {fmt(mercado.nivel1.aluguelMedio||0)}/mês</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {mercado.nivel1.locacoes.map((l,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:i%2===0?'#f8fafc':'white', borderRadius:6, fontSize:11 }}>
                            <span style={{ color:'#334155' }}>{l.descricao} <span style={{ color:'#94a3b8' }}>({l.fonte}{l.data ? ` · ${fmtDataAnuncio(l.data)}` : ''})</span></span>
                            <span style={{ fontWeight:700, color:'#8b5cf6' }}>R$ {fmt(l.valorMensal)}/mês</span>
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
                  <span style={{ fontWeight:800, color:'white', fontSize:13 }}>Vizinhança — bairro e adjacências (~1 km)</span>
                  <span style={{ marginLeft:'auto', background:'rgba(255,255,255,0.2)', borderRadius:20, padding:'2px 10px', fontSize:11, fontWeight:700, color:'white', whiteSpace:'nowrap' }}>
                    {mercado.nivel2?.totalAmostras||0} amostras
                  </span>
                </div>
                {mercado.nivel2?.descricao && (
                  <div style={{ padding:'11px 16px', background:'#f0fdf4', borderBottom:'1px solid #bbf7d0', fontSize:12, color:'#334155', lineHeight:1.65 }}>{mercado.nivel2.descricao}</div>
                )}
                <div style={{ padding:14, display:'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap:14 }}>
                  {mercado.nivel2?.vendas?.length > 0 && (
                    <div>
                      <div style={{ fontSize:11, fontWeight:700, color:'#10b981', textTransform:'uppercase', marginBottom:8 }}>Venda — {mercado.nivel2.vendas.length} imóveis</div>
                      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:8 }}>
                        {[['Mín',`${fmt(mercado.nivel2.precoMinM2||0)}`,'#ef4444'],['Médio',`${fmt(mercado.nivel2.precoMedioM2||0)}`,'#10b981'],['Máx',`${fmt(mercado.nivel2.precoMaxM2||0)}`,'#0D63DB']].map(([l,v,c])=>(
                          <div key={l} style={{ background:'#f0fdf4', borderRadius:8, padding:'8px 10px', textAlign:'center' }}>
                            <div style={{ fontSize:9, color:'#94a3b8', fontWeight:700, textTransform:'uppercase', marginBottom:2 }}>{l} R$/m²</div>
                            <div style={{ fontSize:14, fontWeight:900, color:c }}>R$ {v}</div>
                          </div>
                        ))}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {mercado.nivel2.vendas.slice(0,8).map((v,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:i%2===0?'#f8fafc':'white', borderRadius:6, fontSize:11 }}>
                            <span style={{ color:'#334155', flex:1, marginRight:8 }}>{v.descricao} <span style={{ color:'#94a3b8' }}>({v.fonte}{v.data ? ` · ${fmtDataAnuncio(v.data)}` : ''})</span></span>
                            <span style={{ fontWeight:700, color:'#10b981', flexShrink:0 }}>R$ {fmt(v.valor)} · {fmt(v.valorM2)}/m²</span>
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
                        <div style={{ fontSize:20, fontWeight:900, color:'#7c3aed' }}>R$ {fmt(mercado.nivel2.aluguelMedio||0)}/mês</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                        {mercado.nivel2.locacoes.map((l,i)=>(
                          <div key={i} style={{ display:'flex', justifyContent:'space-between', padding:'6px 10px', background:i%2===0?'#f8fafc':'white', borderRadius:6, fontSize:11 }}>
                            <span style={{ color:'#334155' }}>{l.descricao} <span style={{ color:'#94a3b8' }}>({l.fonte}{l.data ? ` · ${fmtDataAnuncio(l.data)}` : ''})</span></span>
                            <span style={{ fontWeight:700, color:'#8b5cf6' }}>R$ {fmt(l.valorMensal)}/mês</span>
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
      <Section id="sec-viabilidade" step="4" title="Análise de Viabilidade" icon={TrendingUp} color="#f59e0b" open={openSec.viabilidade} onToggle={()=>toggleSec('viabilidade')}
        badge={d.valorArrematacao>0 ? (isViavel?'✓ Aprovada':'✗ Reprovada') : 'Preencha os valores'}>
        <div style={{ display:'flex', flexDirection:'column', gap:14, paddingTop:14 }}>

          {/* Cenário */}
          <div style={{ display:'flex', alignItems:'center', gap:10, background:'#f8fafc', borderRadius:10, padding:'12px 16px' }}>
            <span style={{ fontSize:12, fontWeight:700, color:'#64748b' }}>CENÁRIO:</span>
            {[['aVista','À Vista','#0D63DB'],['financiado','Alavancado','#10b981']].map(([v,l,c])=>(
              <button key={v} onClick={()=>setCenario(v)} disabled={v==='financiado'&&d.somenteAVista}
                style={{ padding:'7px 20px', borderRadius:8, background:cenario===v?c:'white', color:cenario===v?'white':'#64748b', fontWeight:800, fontSize:13, cursor:'pointer', border:`2px solid ${cenario===v?c:'#e2e8f0'}`, opacity:v==='financiado'&&d.somenteAVista?0.4:1 }}>
                {l}
              </button>
            ))}
          </div>

          {/* Cenários de disputa — Sem disputa vs Com disputa (piso de 30% de lucro) */}
          {!isUsoProprio && d.valorArrematacao > 0 && d.valorMercado > 0 && (() => {
            const cd = cenariosDisputa;
            const pisoOk = cd.tetoBest > cd.lanceBase;
            // Só mostra o cenário "com disputa" quando ele é REAL: o teto que
            // preserva o piso de lucro precisa estar ACIMA do lance base (mínimo).
            // Um teto abaixo do lance mínimo é impossível (não se dá lance abaixo
            // do mínimo) — então não exibimos esse card irreal.
            const cards = [
              { tag:'SEM DISPUTA', cor:'#10b981', bg:'#f0fdf4', lance:cd.lanceBase, m:cd.semDisputa, nota:'Arremata pelo lance base' },
              ...(pisoOk ? [{ tag:'COM DISPUTA — PIOR CASO', cor:'#f59e0b', bg:'#fef3c7', lance:cd.tetoBest, m:cd.comDisputa, nota:`Piso de ${PISO_LUCRO}% de lucro líquido` }] : []),
            ];
            return (
              <div style={{ border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden' }}>
                <div style={{ background:'#0B48A6', padding:'10px 16px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap' }}>
                  <span style={{ fontSize:13, fontWeight:800, color:'white' }}>Cenários de Disputa</span>
                  <span style={{ fontSize:11, fontWeight:700, color:'white', background:'rgba(255,255,255,0.18)', borderRadius:20, padding:'2px 10px' }}>Melhor condição: {cd.condLabel}</span>
                </div>
                <div style={{ padding:14, display:'grid', gridTemplateColumns: (isMobile || cards.length === 1) ? '1fr' : '1fr 1fr', gap:12 }}>
                  {cards.map(c => (
                    <div key={c.tag} style={{ border:`2px solid ${c.cor}`, borderRadius:12, overflow:'hidden' }}>
                      <div style={{ background:c.bg, padding:'8px 14px', fontSize:11, fontWeight:800, color:c.cor, letterSpacing:0.5 }}>{c.tag}</div>
                      <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:7 }}>
                        {[
                          ['Lance', `R$ ${fmt(c.lance)}`],
                          ['Capital aportado', `R$ ${fmt(c.m.capitalMobilizado)}`],
                          ['Lucro líquido', `R$ ${fmt(c.m.lucro)}`],
                        ].map(([l,v]) => (
                          <div key={l} style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                            <span style={{ color:'#64748b' }}>{l}</span><span style={{ fontWeight:700, color:'#111' }}>{v}</span>
                          </div>
                        ))}
                        <div style={{ marginTop:4, background:c.cor, borderRadius:8, padding:'8px 12px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <span style={{ fontSize:11, fontWeight:700, color:'white', opacity:0.9 }}>{cd.usarAVista ? 'ROI' : 'ROE'}</span>
                          <span style={{ fontSize:18, fontWeight:900, color:'white' }}>{fmtPct(c.m.roi)}</span>
                        </div>
                        <div style={{ fontSize:10, color:'#94a3b8' }}>{c.nota}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ padding:'0 14px 14px' }}>
                  <div style={{ background: pisoOk ? '#f0fdf4' : '#fef2f2', border:`1px solid ${pisoOk ? '#bbf7d0' : '#fecaca'}`, borderRadius:10, padding:'10px 14px', fontSize:12, color: pisoOk ? '#15803d' : '#b91c1c', lineHeight:1.6 }}>
                    {pisoOk
                      ? <><strong>Validação:</strong> mesmo numa disputa, dá para cobrir até <strong>R$ {fmt(cd.tetoBest)}</strong> mantendo o piso de {PISO_LUCRO}% de lucro líquido. Acima desse lance, a operação deixa de compensar — é o limite para parar de dar lances.</>
                      : <><strong>Atenção:</strong> no lance base o retorno já está abaixo de {PISO_LUCRO}%. Não há margem para disputa — só compensa abaixo de <strong>R$ {fmt(cd.tetoBest)}</strong>.</>}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* KPIs grandes */}
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:12 }}>
            <KpiCard large label="Capital Aportado" value={`R$ ${fmt(metricas.capitalMobilizado)}`} sub="Total mobilizado" color="#ef4444" bg="#fef2f2" icon={DollarSign}/>
            <KpiCard large label={isUsoProprio?'Economia Real':'Lucro Líquido'} value={`R$ ${fmt(metricas.lucro)}`} sub={`${fmtPct(metricas.roi)} ${isAVista?'ROI':'ROE'}`} color={metricas.roi>=META?'#10b981':'#ef4444'} bg={metricas.roi>=META?'#d1fae5':'#fef2f2'} icon={TrendingUp}/>
            <KpiCard large label="Rentabilidade do Aluguel" value={fmtPct(metricas.yieldMensal)+'/mês'} sub={fmtPct(metricas.yieldAnual)+' a.a.'} color="#8b5cf6" bg="#ede9fe" icon={BarChart3}/>
            <KpiCard large label="Teto de Disputa" value={`R$ ${fmt(teto)}`} sub={`Margem de ${META}%`} color="#f59e0b" bg="#fef3c7" icon={Gavel}/>
          </div>

          {/* Badge de viabilidade */}
          <div style={{ background:isViavel?'#d1fae5':'#fee2e2', border:`2px solid ${isViavel?'#10b981':'#ef4444'}`, borderRadius:14, padding: isMobile ? '14px 16px' : '18px 22px', display:'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent:'space-between', gap:16 }}>
            <div style={{ display:'flex', alignItems:'center', gap:14 }}>
              {isViavel ? <CheckCircle2 size={32} color="#10b981"/> : <XCircle size={32} color="#ef4444"/>}
              <div>
                <div style={{ fontWeight:900, fontSize:17, color:isViavel?'#065f46':'#b91c1c' }}>
                  {isViavel ? (isUsoProprio?'Aprovado para Uso Próprio':'Operação Viável — Aprovada pela BidPro Brasil') : 'Operação Reprovada — Retorno Insuficiente'}
                </div>
                <div style={{ fontSize:13, color:isViavel?'#047857':'#dc2626', marginTop:4 }}>
                  {isUsoProprio ? `Economia de R$ ${fmt(metricas.lucro)} sobre o valor de mercado` : `ROI ${fmtPct(metricas.roi)} · Mínimo exigido: ${META}% · Teto de lance: R$ ${fmt(teto)}`}
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
            <div style={{ background:'#111111', padding:'12px 18px' }}>
              <div style={{ fontSize:13, fontWeight:800, color:'white' }}>Detalhamento Financeiro — Lance sem disputa vs com disputa</div>
            </div>
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                <thead>
                  <tr style={{ background:'#f8fafc' }}>
                    {['Item','% do Aporte',`Lance sem disputa  R$ ${fmt(d.valorArrematacao)}`,`Lance com disputa  R$ ${fmt(teto)}`].map((h,i)=>(
                      <th key={h} style={{ padding:'10px 14px', textAlign:i===0?'left':'right', fontWeight:700, color:'#475569', borderBottom:'2px solid #e2e8f0', whiteSpace:'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['Arrematação/Sinal', isAVista?metricas.vArremate:metricas.valorSinal, isAVista?metricasTeto.vArremate:metricasTeto.valorSinal],
                    ['Honorários Jurídicos (10%)', metricas.honorarios, metricasTeto.honorarios],
                    ['Taxa Leiloeiro', metricas.taxaLeiloeiro, metricasTeto.taxaLeiloeiro],
                    d.taxaAdministrativaPercentual>0 && ['Taxa Administrativa', metricas.taxaAdministrativa, metricasTeto.taxaAdministrativa],
                    d.despesasAdministrativas>0 && ['Despesas Administrativas', metricas.despesasAdm, metricasTeto.despesasAdm],
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
                    <td style={{ padding:'12px 14px', color:'#084BA6', fontSize:14 }}>RETORNO ({isAVista?'ROI':'ROE'})</td><td/>
                    <td style={{ padding:'12px 14px', textAlign:'right', color:'#0D63DB', fontSize:20 }}>{fmtPct(metricas.roi)}</td>
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
              ['Total de Saídas',`R$ ${fmt(fluxo.totalSaidas)}`,'#ef4444','#fef2f2'],
              ['Receita Final',`R$ ${fmt(fluxo.totalEntradas)}`,'#10b981','#f0fdf4'],
              ['Resultado',`R$ ${fmt(fluxo.totalEntradas-fluxo.totalSaidas)}`,(fluxo.totalEntradas-fluxo.totalSaidas)>=0?'#10b981':'#ef4444',(fluxo.totalEntradas-fluxo.totalSaidas)>=0?'#d1fae5':'#fee2e2'],
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
                <tr style={{ background:'#111111' }}>
                  {['Mês','Descrição','Entradas','Saídas','Saldo Acumulado'].map((h,i)=>(
                    <th key={h} style={{ padding:'9px 12px', textAlign:i<=1?'left':'right', fontWeight:700, color:'#94a3b8', whiteSpace:'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fluxo.linhas.map((row,i)=>(
                  <tr key={i} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                    <td style={{ padding:'7px 12px', fontWeight:700, color:'#111111' }}>Mês {row.mes}</td>
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
      <Section id="sec-laudo" step="6" title="Laudo de Viabilidade e Defesa da Arrematação" icon={Award} color="#111111" open={openSec.laudo} onToggle={()=>toggleSec('laudo')}
        badge={parecer ? 'Gerado' : 'Gere o parecer executivo'}>
        <div style={{ display:'flex', flexDirection:'column', gap:14, paddingTop:14 }}>
          <div style={{ display:'flex', gap:10, alignItems:'flex-start', background:'#f8fafc', borderRadius:12, padding:'14px 16px' }}>
            <Sparkles size={16} color="#6366f1" style={{flexShrink:0,marginTop:1}}/>
            <div style={{ fontSize:12, color:'#334155', lineHeight:1.7 }}>
              O laudo é gerado automaticamente junto com o relatório <strong>Mercadológico + Viabilidade</strong> (lá em cima), com base em todos os dados, avaliação de mercado e riscos jurídicos. Inclui <strong>posicionamento estratégico, defesa da arrematação, análise de rentabilidade e conclusão da gestão</strong>. Para atualizá-lo, regere o relatório Mercadológico.
            </div>
          </div>

          {loadParecer && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, padding:'14px', color:'#6366f1', fontWeight:700, fontSize:13 }}>
              <Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/> Gerando laudo executivo...
            </div>
          )}
          {!parecer && !loadParecer && (
            <div style={{ fontSize:12, color:'#94a3b8', textAlign:'center', padding:'8px 0' }}>
              O laudo aparece aqui depois de gerar o relatório Mercadológico + Viabilidade.
            </div>
          )}

          {parecer && (
            <>
              <div style={{ background:'#111111', borderRadius:12, padding:'20px 22px' }}>
                {parecer.split('§ SEÇÃO:').filter(Boolean).map((sec, i) => {
                  const [titulo, ...corpo] = sec.split('\n');
                  return (
                    <div key={i} style={{ marginBottom: i < 3 ? 22 : 0 }}>
                      <div style={{ fontSize:11, fontWeight:800, color:'#34d399', textTransform:'uppercase', letterSpacing:1, marginBottom:8, display:'flex', alignItems:'center', gap:6 }}>
                        <span style={{ background:'#111111', borderRadius:6, padding:'2px 8px' }}>§ {titulo.trim()}</span>
                      </div>
                      <p style={{ margin:0, fontSize:13, lineHeight:1.9, color:'#cbd5e1', whiteSpace:'pre-wrap' }}>{corpo.join('\n').trim()}</p>
                    </div>
                  );
                })}
              </div>
              <button onClick={imprimirPDF}
                style={{ width:'100%', padding:'13px', background:'#0D63DB', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                <Printer size={16}/> Exportar Laudo Completo em PDF
              </button>
              {user && !['analista','advogado','consultor','admin'].includes(role) && (
                <button onClick={solicitarAnalista} disabled={solicitando || solicitado}
                  style={{ width:'100%', padding:'13px', background: solicitado ? '#10b981' : '#111111', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:14, cursor: solicitado ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity: solicitando ? 0.7 : 1 }}>
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

      {/* PRÓXIMO PASSO — destaque ao fim do Mercadológico: seguir para o Documental */}
      <div style={{ background:'#fff7ed', border:'2px solid #fdba74', borderRadius:16, padding:'18px 20px', display:'flex', gap:14, alignItems:'flex-start' }}>
        <ShieldAlert size={22} color="#ea580c" style={{ flexShrink:0, marginTop:2 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:900, color:'#9a3412', marginBottom:4 }}>Próximo passo para uma decisão segura</div>
          <div style={{ fontSize:12.5, color:'#7c2d12', lineHeight:1.7, marginBottom:12 }}>
            Arrematar em leilão é uma <strong>operação de risco</strong> e deve ser conduzida de forma profissional. A viabilidade financeira sozinha não basta: gere também a <strong>Análise Documental + Jurídica</strong> (ônus, gravames, ocupação e processo) antes de dar o lance.
          </div>
          {ROLES_SEM_DOCUMENTAL.includes(role) ? (
            <button onClick={()=>nav('/planos')} style={{ padding:'11px 18px', background:'#1e3a8a', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:8 }}>
              <Lock size={15}/> Análise Documental — disponível no Investidor Pro
            </button>
          ) : (
            <button onClick={()=> relDocumentalGerado ? setRelSel('documental') : gerarRelDocumental()} disabled={gerandoDocumental}
              style={{ padding:'11px 18px', background: gerandoDocumental?'#cbd5e1':'#1e3a8a', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor: gerandoDocumental?'default':'pointer', display:'inline-flex', alignItems:'center', gap:8 }}>
              {gerandoDocumental ? <><Loader2 size={15} style={{animation:'spin 1s linear infinite'}}/> Gerando…</> : <><Scale size={15}/> {relDocumentalGerado ? 'Abrir Análise Documental + Jurídica' : 'Gerar Análise Documental + Jurídica'}</>}
            </button>
          )}
        </div>
      </div>

      </>)}

      {/* ── GUIA PÓS-ARREMATAÇÃO (aparece somente quando status = arrematado) ── */}
      {d.status === 'arrematado' && relSel === 'mercado' && (
        <>
          <Section step="7" title="Guia Pós-Arrematação" icon={ClipboardCheck} color="#059669"
            open={openSec.guia} onToggle={() => toggleSec('guia')}
            badge={`${d.origem === 'judicial' ? 'Judicial' : 'Extrajudicial'} — checklist completo`}>
            <div style={{ paddingTop: 14 }}>
              <GuiaPosArrematacao
                modalidade={d.origem || 'extrajudicial'}
                imovelId={d.id}
                onNavCNJ={() => { toggleSec('cnj'); document.querySelector('[data-sec="cnj"]')?.scrollIntoView({ behavior: 'smooth' }); }}
                onNavCertidoes={() => { toggleSec('cnj'); }}
              />
            </div>
          </Section>

          {/* ── FINANCIAMENTO TRACKER ── */}
          <Section step="8" title="Financiamento da Arrematação" icon={CreditCard} color="#7c3aed"
            open={openSec.financiamento} onToggle={() => toggleSec('financiamento')}
            badge="Sinal · Parcelas · Alertas de vencimento">
            <div style={{ paddingTop: 14 }}>
              <FinanciamentoTracker
                imovelId={d.id}
                imovelNome={d.nome || d.endereco || 'Imóvel arrematado'}
                onSalvo={() => {}}
              />
            </div>
          </Section>

          {/* Atalho rápido para ONR */}
          <div style={{ margin: '8px 0', padding: '14px 18px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 14, color: '#1d4ed8' }}>Registrar imóvel — ONR Digital</div>
              <div style={{ fontSize: 12, color: '#3b82f6', marginTop: 2 }}>Protocole o registro de transferência de propriedade no cartório via SREI ou presencialmente.</div>
            </div>
            <button onClick={() => nav(`/registro-imovel/${d.id}`)}
              style={{ padding: '9px 18px', background: '#1d4ed8', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Iniciar registro →
            </button>
          </div>
        </>
      )}

        </div>{/* fim central */}
      </div>{/* fim grid 2 colunas */}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}
