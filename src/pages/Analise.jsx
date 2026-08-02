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
import { arquivoParaBase64 } from '../utils/arquivo';
import { reportarErroCliente } from '../utils/reportarErro';
import { extrairDadosDocumento, extrairDadosDocumentoUrl, analisarMercado, gerarParecer } from '../utils/claude';
import { calcularMetricasCenario, calcularTetoLance, calcularSAC, calcularPrice, calcularVPL, calcularTIR, calcularPayback, calcularMultiplo, fluxoLocacao, TMA_PADRAO, fmt, fmtPct } from '../utils/calculos';
import { caixaMatriculaUrl, caixaRegrasVendaUrl } from '../utils/caixa';
import { loadImoveis, saveImoveis, generateId } from '../utils/storage';
import { useAuth } from '../contexts/AuthContext';
import { useAnalises } from '../contexts/AnalisesContext';
import { supabase } from '../utils/supabase';
import { assinarAnexos, chaveDocCanonica } from '../utils/docUrl';
import TabelaAmortizacao from '../components/TabelaAmortizacao';
import { gerarPDF } from '../components/RelatorioPDF';
import { gerarLaudoPDF } from '../components/LaudoPDF';
import { gerarDocumentalPDF } from '../components/DocumentalPDF';
import { gerarCombinadoPDF } from '../components/CombinadoPDF';
import { scoreBidPro, scoreLabel } from '../utils/score';
import { apiCall } from '../utils/apiCall';

// Rótulos do tipo de ocupação no Raio-X jurídico (Fase 1).
const OCUP_LABEL_A = {
  desocupado: 'Desocupado', proprietario: 'Ocupado pelo proprietário', locatario: 'Ocupado por locatário',
  posseiro: 'Ocupado por posseiro', comodato: 'Ocupado (comodato)', invasao: 'Ocupado (invasão)',
};

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

// Cabeçalho de "banda" do relatório mercadológico — organiza a informação (antes era
// uma pilha vertical longa) em 4 blocos numerados: Resumo, Referências de preço,
// Amostras/comparativos e Metodologia. Mantém a MESMA informação, só agrupada.
function BandaMercado({ n, titulo, sub, cor = '#0D63DB' }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:2 }}>
      <span style={{ width:22, height:22, borderRadius:7, background:cor, color:'white', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:900, flexShrink:0 }}>{n}</span>
      <span style={{ fontSize:12.5, fontWeight:800, color:'#0f172a', textTransform:'uppercase', letterSpacing:0.5 }}>{titulo}</span>
      {sub && <span style={{ fontSize:11, color:'#94a3b8', fontWeight:600 }}>· {sub}</span>}
      <span style={{ flex:1, height:1, background:'#e2e8f0' }} />
    </div>
  );
}

// Limite de relatórios mercadológicos+viabilidade por plano/mês (espelha limite_ia
// no banco). Explorador: 5/mês, sem documental/jurídico. Todos os acessos têm cota;
// só o admin é ilimitado. Equipe (analista/advogado) NÃO gera relatórios (só
// recebe/visualiza demandas) → sem entrada aqui = limite 0.
const LIMITE_POR_ROLE = {
  explorador: 3, consultor: 5,
  top2: 10, top2_anual: 10,
  assessorado: 10, assessorado_anual: 10,
  clube: 10, clube_anual: 10,
};
// Assinantes ANTIGOS (plano_legado) mantêm 15 (grandfather). O banco é a fonte da
// verdade (limite_ia_efetivo); aqui é só p/ o espelho de UI não bloquear antes da hora.
const ROLES_PAGOS_CLIENTE = ['top2', 'top2_anual', 'assessorado', 'assessorado_anual', 'clube', 'clube_anual'];
const limiteRelatorios = (role, planoLegado) =>
  (planoLegado && ROLES_PAGOS_CLIENTE.includes(role)) ? 15 : (LIMITE_POR_ROLE[role] || 0);
const mesAtual = () => new Date().toISOString().slice(0, 7);
const ROLES_SEM_LIMITE = ['admin'];
// Documental/jurídico só a partir do Investidor Pro (explorador/consultor não têm).
const ROLES_SEM_DOCUMENTAL = ['explorador', 'consultor'];
const ROLES_COM_CNJ   = ['top2','assessorado','clube','analista','advogado','admin'];

export default function Analise() {
  const location = useLocation();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { user, role, nome, planoLegado } = useAuth();
  const imovelInicial = location.state?.imovel;
  // Arremate atribuído pela equipe: gera os relatórios EM NOME DO cliente (paraUserId)
  // para que eles pertençam a ele (aparecem nas Análises/acompanhamento do cliente).
  const paraUserId = location.state?.paraUserId || null;
  // Arremate atribuído com docs → gera os 3 relatórios EM SEQUÊNCIA automaticamente
  // (mercadológico → documental → laudo), lendo os anexos. Só na chegada da atribuição.
  const autoGerar = location.state?.autoGerar || false;
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
  const [upgrade, setUpgrade] = useState(null); // popup de compra: null | { tipo:'plano'|'cota', titulo }
  const limiteRole = limiteRelatorios(role, planoLegado);

  // Lê os contadores de cota do perfil (fonte da verdade). O CONSUMO da cota
  // passou a ser server-side (/api/gerar-analise → consumir_analise_por); aqui só
  // LEMOS para pintar o estado da tela — chamamos no mount e após cada geração.
  const carregarCota = React.useCallback(async () => {
    if (!user || semLimite) return;
    const { data, error } = await supabase.from('perfis')
      .select('analises_mes, analises_count, amostra_mercado_usadas, bonus_mercado').eq('id', user.id).single();
    if (error || !data) return;
    // EXPLORADOR: contador de AMOSTRA VITALÍCIA (não reseta por mês). Demais planos: cota mensal.
    const count = role === 'explorador'
      ? (data.amostra_mercado_usadas || 0)
      : (data.analises_mes === mesAtual() ? (data.analises_count || 0) : 0);
    const bonus = data.bonus_mercado || 0;
    setAnalisesUsadas(count);
    setAnalisesBonus(bonus);
    // Bloqueia só quando estourou o limite E não há bônus por cima
    // (espelha consumir_analise_por: consome o principal primeiro, bônus como excedente).
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
        .in('tipo', ['matricula', 'edital', 'regras_venda', 'laudo', 'proposta', 'auto_arrematacao', 'carta_arrematacao', 'contrato_banco', 'escritura', 'boleto_sinal', 'boleto_aquisicao', 'matricula_registrada', 'outro']);
      // Re-assina os docs guardados (o url gravado é signed de 1h e expira).
      if (!cancel) setDocsLeiloeiro(await assinarAnexos(data || []));
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
            const txt = `[CNJ ${p.tribunal}] ${r.descricao}, ${p.numero}`;
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
  const { iniciar: iniciarAnalise, getAnalise, iniciarDocumental, getDocumental, iniciarLaudo, getLaudo } = useAnalises();
  const analiseImovelId = imovelInicial?.id || d.id;
  // "Arrematei este imóvel": o cliente sinaliza o arremate → mantém os documentos
  // (Retenção Etapa 2). Autoconsentido; só protege, nunca apaga.
  const [arrematadoSinalizado, setArrematadoSinalizado] = useState(false);
  const [sinalizandoArremate, setSinalizandoArremate] = useState(false);
  const sinalizarArremate = async () => {
    if (arrematadoSinalizado || sinalizandoArremate) return;
    const raw = window.prompt(`Confirme o arremate de "${d.nome || imovelInicial?.titulo || 'este imóvel'}".\n\nPor quanto você arrematou? (somente números inteiros em reais, ex: 250000)`);
    if (raw == null) return; // cancelou
    const valor = Number(String(raw).replace(/[^\d]/g, ''));
    if (!valor || valor <= 0) { window.alert('Informe um valor de arremate válido (somente números).'); return; }
    setSinalizandoArremate(true);
    try {
      const res = await apiCall('/api/sinalizar-arremate', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imovel_id: analiseImovelId, titulo: d.nome || imovelInicial?.titulo, cidade: d.cidade, estado: d.estado, valor }) });
      if (res.ok) setArrematadoSinalizado(true);
      else { const dd = await res.json().catch(() => ({})); window.alert(dd.error || 'Não foi possível registrar o arremate.'); }
    } catch { /* ok */ }
    setSinalizandoArremate(false);
  };
  const analiseEntry = getAnalise(analiseImovelId);
  const docEntry = getDocumental(analiseImovelId);
  const laudoEntry = getLaudo(analiseImovelId);
  const gerandoLaudo = laudoEntry?.status === 'gerando';
  const relLaudoGerado = laudoEntry?.status === 'concluida' && !laudoEntry?.result?.precisaRelatorios;
  const gerandoMercado = analiseEntry?.status === 'gerando';
  // Documental também roda em SEGUNDO PLANO no servidor (/api/gerar-documental):
  // o "gerando"/"pronto" derivam do contexto (persistente, vale entre devices).
  const gerandoDocumental = docEntry?.status === 'gerando';
  // Derivado do contexto (persistente), igual ao documental. Antes era useState(false) LOCAL
  // que só virava true nesta sessão ao observar o mercado — com documental-sem-mercado ficava
  // false para sempre e as duas metades do gate liam fontes diferentes. Agora leem a MESMA
  // fonte de verdade, então o card reflete o estado real ao reabrir.
  const relMercadoGerado = analiseEntry?.status === 'concluida' && !!analiseEntry?.result;
  // "concluida" com precisaDocumentos NÃO é pronto — ainda está capturando/faltando
  // documentos. Separar os dois estados evita a incoerência "Pronto na lista / abre
  // Preparando ainda" (o mesmo status precisa valer em TODA a tela).
  const relDocumentalPreparando = docEntry?.status === 'concluida' && !!docEntry?.result?.precisaDocumentos;
  const relDocumentalGerado = docEntry?.status === 'concluida' && !docEntry?.result?.precisaDocumentos;
  const [parecerDocumental, setParecerDocumental] = useState(null); // resultado do servidor
  const [docMsg, setDocMsg] = useState('');
  // Auto-poll da captura de documentos (leiloeiro integrado): quando o servidor está
  // baixando os PDFs, re-gera sozinho até ler — sem o usuário clicar de novo.
  const [preparandoDocs, setPreparandoDocs] = useState(false);
  const capturaPollRef = React.useRef({ n: 0, timer: null });
  React.useEffect(() => () => clearTimeout(capturaPollRef.current.timer), []);
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

  // Controle de abertura por seção. Os formulários MANUAIS do documental (Edital,
  // Matrícula, CNJ) começam RECOLHIDOS: a análise é um clique (o servidor lê os
  // documentos e consulta o CNJ sozinho); a digitação manual fica como opção
  // avançada, sem poluir a tela.
  const [openSec, setOpenSec] = useState({ doc:false, dados:true, mercado:true, viabilidade:true, fluxo:true, laudo:true, matricula:false, cnj:false, guia:true, financiamento:true });
  const toggleSec = (k) => setOpenSec(p => ({ ...p, [k]: !p[k] }));
  // Abre uma seção e rola até ela (usado pela barra lateral)
  const irPara = (k, id) => { setOpenSec(p => ({ ...p, [k]: true })); setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); };

  // Abre o COMPROVANTE de certidão renderizado (não em código): busca o HTML e reabre num Blob
  // FORÇANDO text/html — a URL do Storage às vezes exibe o comprovante como CÓDIGO-FONTE em vez de
  // renderizar a página. Injeta charset e, quando dá p/ detectar, um <base> no domínio do órgão
  // (p/ o CSS/JS relativo carregar). Reserva a aba no clique; se falhar, cai na URL original.
  const verComprovante = useCallback(async (e, url) => {
    e.preventDefault();
    const w = window.open('', '_blank');
    try {
      const res = await fetch(url);
      let html = await res.text();
      // O comprovante é uma página PRÓPRIA, estática e sem dependências externas. NÃO
      // injetamos <base> no domínio do órgão (era isso que fazia um shell de portal
      // re-hidratar AO VIVO e mostrar a tela de digitação em vez da prova). Como defesa
      // em profundidade contra comprovantes legados (shells crus), removemos qualquer
      // <script> e <base> e renderizamos INERTE.
      html = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<base\b[^>]*>/gi, '');
      if (!/<meta\s+charset/i.test(html)) html = `<!doctype html><meta charset="utf-8">${html}`;
      const blobUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
      if (w) w.location.href = blobUrl; else window.open(blobUrl, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch {
      if (w) w.location.href = url; else window.open(url, '_blank', 'noopener');
    }
  }, []);

  // Abre um anexo do nosso Storage RE-ASSINANDO na hora: as signed URLs do bucket `documentos`
  // EXPIRAM, então a URL gravada em imovel_anexos dá erro ("invalid signature") depois de um tempo.
  // Reserva a aba já no clique (evita bloqueio de popup) e navega quando a URL fresca chega do
  // /api/anexo-url (servidor, service role, gated a staff/dono). Se falhar, cai na URL persistida.
  const abrirAnexo = useCallback(async (e, anexoId, fallbackUrl) => {
    e.preventDefault();
    const w = window.open('', '_blank');
    let url = fallbackUrl;
    try {
      const res = await apiCall('/api/anexo-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ anexo_id: anexoId }) });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.url) url = data.url;
    } catch { /* usa o fallback (URL persistida) */ }
    if (w) w.location.href = url; else window.open(url, '_blank', 'noopener');
  }, []);

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
  // Pesquisa de mercado veio VAZIA (fonte instável no momento): sem valor de mercado o
  // ROI daria "-100%/reprovada" — enganoso. Nesse caso mostramos "não estimado".
  const mercadoSemDados = !(Number(d.valorMercado) > 0)
    && !(Number(mercado?.precoMedioM2) > 0)
    && (((mercado?.nivel1?.vendas?.length || 0) + (mercado?.nivel2?.vendas?.length || 0)) === 0);
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

  // Upload do PDF direto para o bucket (imovel_anexos) feito PELO PRÓPRIO USUÁRIO —
  // sem os documentos ele não gera os relatórios nem agenda. O arquivo vira CACHE
  // (a análise documental passa a ler o documento de verdade). Requer imóvel da
  // base (uuid); em inclusão manual pura, o caminho é colar o texto do documento.
  const [enviandoAnexo, setEnviandoAnexo] = useState('');
  const enviarDocBucket = async (file, tipo) => {
    if (!file) return;
    const imovelId = imovelInicial?.id;
    if (!imovelId) { showMsg('Envio direto de arquivo é para imóveis da base. Aqui, cole o texto do documento.', 'error'); return; }
    if (file.type !== 'application/pdf') { showMsg('Envie o documento em PDF.', 'error'); return; }
    if (file.size > 20 * 1024 * 1024) { showMsg('Arquivo acima de 20 MB.', 'error'); return; }
    setEnviandoAnexo(tipo);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('imovel_id', imovelId);
      fd.append('tipo', tipo);
      if (imovelInicial?.dataLeilao) fd.append('data_leilao', String(imovelInicial.dataLeilao).slice(0, 10));
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/upload-anexo', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Falha no envio');
      const LBL = { matricula: 'Matrícula', edital: 'Edital', outro: 'Documento complementar' };
      // Complementares ('outro') podem ser vários — acumula. Matrícula/edital são
      // únicos — substitui o do mesmo tipo.
      setDocsLeiloeiro(prev => [...prev.filter(x => tipo === 'outro' ? true : x.tipo !== tipo), { id: data.anexo_id, tipo, nome: file.name, url: data.url_publica }]);
      if (tipo === 'outro') {
        // Complementar não dispara a geração sozinho (o usuário pode anexar vários
        // antes de gerar); entra na próxima análise pois o servidor lê todos os anexos.
        showMsg('Documento complementar anexado.');
      } else {
        showMsg(`${LBL[tipo] || 'Documento'} enviado! Gerando a análise…`);
        // bypassPreCheck: o doc acabou de subir (está no banco/imovel_anexos que o
        // servidor lê); o docsLeiloeiro do closure ainda está desatualizado, então
        // não deixamos a pré-checagem barrar de novo — o servidor já vê o anexo.
        gerarRelDocumental(false, true);
      }
    } catch (e) {
      showMsg(e.message || 'Erro ao enviar o documento.', 'error');
    } finally { setEnviandoAnexo(''); }
  };

  // Tela DEDICADA de "documento faltante": pede SÓ o que falta (matrícula e/ou
  // edital/regras), mostra o link do leiloeiro para baixar, e deixa anexar outros
  // documentos. Reaproveitada tanto quando NÃO há nada legível (precisaDocumentos)
  // quanto quando a análise saiu mas faltou um documento central (ex.: SUPERBID
  // com matrícula lida e edital ausente — pede só o edital).
  const DOC_FALTA_LABEL = { matricula: 'Matrícula', edital: 'Edital', regras_venda: 'Regras de venda' };
  const DocsFaltantesCard = ({ faltando = [], paginaLeiloeiro, motivo, compact = false }) => {
    const faltam = [...new Set(faltando)].filter(t => DOC_FALTA_LABEL[t]);
    if (!faltam.length && !compact) faltam.push('matricula', 'edital'); // fallback defensivo
    const complementares = docsLeiloeiro.filter(x => x.tipo === 'outro');
    const jaTem = (t) => docsLeiloeiro.some(x => x.tipo === t);
    const listaTxt = faltam.map(t => DOC_FALTA_LABEL[t].toLowerCase()).join(' e ');
    const AnexoBtn = ({ tipo, cor, rotulo, ok }) => (
      <label style={{ padding:'11px 18px', background: ok ? '#f0fdf4' : cor, color: ok ? '#15803d' : 'white', border: ok ? '1px solid #86efac' : 'none', borderRadius:10, fontWeight:800, fontSize:13.5, cursor: enviandoAnexo?'default':'pointer', display:'inline-flex', alignItems:'center', gap:7, opacity: (enviandoAnexo && enviandoAnexo!==tipo) ? 0.6 : 1 }}>
        {enviandoAnexo===tipo ? <><Loader2 size={15} style={{animation:'spin 1s linear infinite'}}/> Enviando…</> : ok ? <>✓ {rotulo} anexado</> : <>📎 {rotulo}</>}
        <input type="file" accept="application/pdf" disabled={!!enviandoAnexo} onChange={e=>{ const f=e.target.files?.[0]; e.target.value=''; enviarDocBucket(f, tipo); }} style={{display:'none'}}/>
      </label>
    );
    const titulo = faltam.length === 1
      ? `Falta ${DOC_FALTA_LABEL[faltam[0]].toLowerCase()} para concluir a análise`
      : 'Faltam documentos para concluir a análise';
    return (
      <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:16, padding: compact ? '18px 20px' : '24px', display:'flex', flexDirection:'column', gap:13, alignItems:'flex-start' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <FileText size={compact?18:20} color="#c2410c"/>
          <div style={{ fontSize: compact?15:16, fontWeight:900, color:'#9a3412' }}>{titulo}</div>
        </div>
        <p style={{ fontSize: compact?13:14, color:'#7c2d12', lineHeight:1.6, margin:0 }}>
          {motivo || `Para a análise ficar completa, anexe ${listaTxt} em PDF. Você encontra ${faltam.length>1?'os documentos':'o documento'} na página do lote, no site do leiloeiro.`}
        </p>
        {paginaLeiloeiro && (
          <a href={paginaLeiloeiro} target="_blank" rel="noreferrer"
            style={{ display:'inline-flex', alignItems:'center', gap:7, padding:'9px 15px', background:'white', border:'1px solid #fdba74', borderRadius:10, color:'#c2410c', fontWeight:800, fontSize:13, textDecoration:'none' }}>
            <ExternalLink size={14}/> Abrir a página do lote no leiloeiro
          </a>
        )}
        {imovelInicial?.id ? (<>
          <div style={{ display:'flex', flexWrap:'wrap', gap:10 }}>
            {faltam.map(t => (
              <AnexoBtn key={t} tipo={t} cor={t==='matricula'?'#c2410c':'#9a3412'} rotulo={`${DOC_FALTA_LABEL[t]} (PDF)`} ok={jaTem(t)}/>
            ))}
            <AnexoBtn tipo="outro" cor="#b45309" rotulo="Outro documento" ok={false}/>
          </div>
          {complementares.length > 0 && (
            <div style={{ fontSize:12, color:'#7c2d12', lineHeight:1.5 }}>
              <strong>{complementares.length}</strong> documento(s) complementar(es) anexado(s): {complementares.map(c=>c.nome).join(', ')}
            </div>
          )}
          <button onClick={()=>setModoManual(true)} style={{ background:'none', border:'none', color:'#9a3412', fontSize:12.5, fontWeight:700, cursor:'pointer', textDecoration:'underline', padding:0 }}>ou colar o texto do documento</button>
        </>) : (
          <button onClick={()=>setModoManual(true)} style={{ padding:'11px 18px', background:'#c2410c', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:14, cursor:'pointer' }}>
            📎 Anexar {listaTxt}
          </button>
        )}
      </div>
    );
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.type === 'text/plain') {
      setTextoDoc(await file.text());
    } else if (file.type === 'application/pdf') {
      // Extrai via IA diretamente do PDF — sem precisar de texto intermediário
      setLoadDoc(true);
      try {
        // Base64 em BLOCOS (utils/arquivo.js): espalhar um PDF de vários MB em
        // String.fromCharCode(...bytes) estoura a pilha. Dentro do try — fora dele a falha
        // era silenciosa: o loader nem começava e nenhum erro aparecia.
        const b64 = await arquivoParaBase64(file);
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

  // `override` existe porque "Corrigir e regerar" precisa pesquisar com os valores CORRIGIDOS
  // no mesmo clique: `setD` é assíncrono e esta função captura o `d` do render atual — o
  // setTimeout de 150ms não trocava o closure, então a pesquisa saía com a cidade/metragem
  // ANTIGAS, justamente as que o documental acabara de desmentir.
  const analisarMercadoClick = async (override = null) => {
    // Só aceita override de DADOS (nunca um evento de clique passado por engano no onClick).
    const ov = (override && typeof override === 'object' && !override.nativeEvent && !override.target) ? override : null;
    const dd = ov ? { ...d, ...ov } : d;
    if (!dd.endereco && !dd.cidade) { showMsg('Preencha o endereço ou cidade antes.','error'); return; }
    setLoadMercado(true);
    try {
      const res = await analisarMercado({
        endereco: dd.endereco||dd.cidade, tipoImovel: dd.tipo,
        areaM2: dd.areaM2, cidade: dd.cidade, estado: dd.estado,
        nomeCondominio: dd.nomeCondominio||'',
      });
      setMercado(res);
      if (res?.precoMedioM2 && dd.areaM2) up('valorMercado', Math.round(res.precoMedioM2*dd.areaM2*0.9));
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
      areaM2: dSnap.areaM2, areaTerrenoM2: dSnap.areaTerrenoM2 || 0,
      cidade: dSnap.cidade, estado: dSnap.estado,
      nomeCondominio: dSnap.nomeCondominio || '',
    };
    const parecerInputs = { d: dSnap, metricas, teto, cenario: isAVista ? 'À Vista' : 'Alavancado' };
    showMsg('Geração iniciada no servidor, pode até fechar a aba; acompanhe em "Análises" no topo.');
    iniciarAnalise(
      { imovelId: analiseImovelId, titulo: d.nome || d.endereco || imovelInicial?.titulo || 'Imóvel', cidade: d.cidade, estado: d.estado, imovel: imovelInicial || null, paraUserId },
      { mercadoInputs, parecerInputs }
    );
  };

  // Aplica o resultado da geração (que rodou em segundo plano) ao reabrir/voltar
  // à tela: mercado, valores e laudo. Roda uma vez por conclusão.
  const aplicadoRef = React.useRef(null);
  // Item 2: correções que o documental achou nos docs e que impactam o mercadológico já gerado
  // (ex.: cidade/metragem diferentes) — a tela informa o IMPACTO e oferece regerar ao usuário.
  const [correcoesMercado, setCorrecoesMercado] = useState(null);
  // Reidrata o aviso a partir do que o documental GRAVOU (analises_mercado.correcoes_sugeridas).
  // Sem isto o alerta só existia na resposta HTTP daquela geração: recarregar a página — ou
  // fechar a aba durante o documental — fazia a divergência (cidade/metragem errada no
  // mercadológico) sumir para sempre, mesmo estando salva no banco.
  useEffect(() => {
    if (correcoesMercado) return;
    const salvas = getAnalise(analiseImovelId)?.correcoesSugeridas;
    if (Array.isArray(salvas) && salvas.length) setCorrecoesMercado(salvas);
  }, [analiseImovelId, analiseEntry?.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
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
    // Avaliação confirmada no SERVIDOR (garantirValores leu edital/anexos e corrigiu o
    // banco durante a geração): sem isto o card seguia "Não informada" mesmo com o valor
    // recuperado — só voltava se o usuário reabrisse o imóvel pela Busca. Preenche apenas
    // quando o campo está vazio (nunca sobrescreve o que o usuário digitou).
    if (Number(r.valorAvaliacao) > 0) setD(p => (Number(p.valorAvaliacao) > 0 ? p : { ...p, valorAvaliacao: r.valorAvaliacao }));
    if (r.parecer) { setParecer(r.parecer); setD(p => ({ ...p, parecer: r.parecer })); }
    carregarCota(); // a geração consumiu cota no servidor, atualiza os contadores
    showMsg('Relatório Mercadológico + Viabilidade pronto!');
  }, [analiseEntry?.status, analiseEntry?.updatedAt, analiseImovelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Relatório 2: Análise Documental + Processo (AO MOTOR / servidor) ───────
  // Dispara /api/gerar-documental: lê edital/matrícula/anexos do lote e consulta o
  // CNJ NO SERVIDOR. O usuário pode FECHAR a aba — continua e grava no banco; o
  // resultado é aplicado de volta pelo efeito abaixo. Texto/processo colados na
  // tela (staff/inclusão manual) são enviados como reforço.
  const gerarRelDocumental = (auto, bypassPreCheck) => {
    if (gerandoDocumental) return;
    // Ação manual do usuário (não é o auto-poll da captura) → zera o contador de
    // tentativas para uma nova rodada completa de espera pela captura.
    if (auto !== true) { capturaPollRef.current.n = 0; clearTimeout(capturaPollRef.current.timer); setPreparandoDocs(false); }
    setDocMsg('');
    // Limpa o resultado anterior (ex.: "precisa documentos") para a tela mostrar
    // "Gerando…" como no mercadológico, e não a tela antiga de anexos na hora.
    setParecerDocumental(null);
    aplicadoDocRef.current = null;
    // Resolve as URLs REAIS dos documentos (mesma lógica da barra lateral): para a
    // Caixa, o PDF estático da matrícula/regras — não a página .asp do banco. Sem
    // isto o servidor chegava sem documento legível e o laudo saía bloqueado.
    const ehArq = (v) => /^https?:\/\//i.test(v||'') && !/matricula\.asp|detalhe-imovel\.asp/i.test(v);
    const anexoMat = docsLeiloeiro.find(x => x.tipo === 'matricula')?.url;
    const urlMatricula = caixaMatriculaUrl({ fonte: imovelInicial?.fonte, estado: imovelInicial?.estado, fonteId: imovelInicial?.fonteId })
      || (ehArq(anexoMat) ? anexoMat : null) || (ehArq(imovelInicial?.linkMatricula) ? imovelInicial.linkMatricula : null) || undefined;
    const urlRegras = caixaRegrasVendaUrl({ fonte: imovelInicial?.fonte })
      || (ehArq(imovelInicial?.linkRegrasVenda) ? imovelInicial.linkRegrasVenda : null) || undefined;

    // PRÉ-CHECAGEM DE DOCUMENTOS (no próprio botão, antes de gerar):
    // • matrícula + edital legíveis → gera direto (nada é pedido depois).
    // • falta algo, mas o leiloeiro é integrado / tem página do lote → gera e deixa a
    //   captura automática buscar (mostra "preparando", sem pedir ao cliente).
    // • falta algo e NÃO dá pra baixar sozinho → pede o documento AGORA, sem gastar a
    //   análise nem fazer o cliente esperar o servidor só para então pedir o anexo.
    const ehVendaDiretaDoc = /venda_direta/i.test(String(imovelInicial?.modalidade || ''));
    const temMatriculaDoc = !!(urlMatricula || textoMatricula.trim());
    const temEditalDoc = !!(ehArq(imovelInicial?.linkEdital) || urlRegras || urlEdital.trim() || textoDoc.trim()
      || docsLeiloeiro.some(x => x.tipo === 'edital' || x.tipo === 'regras'));
    const ehCaixaDoc = /caixa|cef/i.test(String(imovelInicial?.fonte || ''));
    // A MATRÍCULA só é baixada sozinha na Caixa (PDF estático). Nos demais leiloeiros
    // ela quase nunca é hospedada — então, faltando, pede logo. O EDITAL costuma estar
    // na página do lote → é auto-capturável em quem tem página.
    const matriculaAutoCap = ehCaixaDoc;
    const editalAutoCap = ehCaixaDoc || ehArq(imovelInicial?.linkEdital) || ehArq(imovelInicial?.linkRegrasVenda);
    const faltando = [];
    if (!temMatriculaDoc && !matriculaAutoCap) faltando.push('matricula');
    if (!temEditalDoc && !editalAutoCap) faltando.push(ehVendaDiretaDoc ? 'regras_venda' : 'edital');
    if (auto !== true && !bypassPreCheck && faltando.length) {
      const labelDoc = { matricula: 'a matrícula', edital: 'o edital', regras_venda: 'as regras da venda' };
      const faltaTxt = faltando.map(t => labelDoc[t]).join(' e ');
      setParecerDocumental({
        precisaDocumentos: true, faltando,
        paginaLeiloeiro: (ehArq(imovelInicial?.linkEdital) ? imovelInicial.linkEdital : null),
        motivo: `A análise jurídica precisa da matrícula e do edital. Anexe ${faltaTxt} (PDF) para gerar a análise.`,
      });
      setRelSel('documental');
      return; // pede o anexo já — não chama o servidor nem consome a análise
    }

    const payload = {
      urlEdital: (ehArq(imovelInicial?.linkEdital) ? imovelInicial.linkEdital : (urlEdital || '')).trim() || undefined,
      urlMatricula,
      urlRegras,
      textoEdital: textoDoc.trim() || undefined,
      textoMatricula: textoMatricula.trim() || undefined,
      processoNumero: cnjNumero.trim() || undefined,
      processoNome: cnjNome.trim() || undefined,
    };
    showMsg('Análise documental iniciada no servidor, pode fechar a aba; acompanhe em "Análises" no topo.');
    iniciarDocumental(
      { imovelId: analiseImovelId, titulo: d.nome || d.endereco || imovelInicial?.titulo || 'Imóvel', cidade: d.cidade, estado: d.estado, imovel: imovelInicial || null, paraUserId },
      payload
    );
    // Gera IN-PLACE como o mercadológico: o card mostra "Gerando…" e o usuário
    // fica no launcher. Não troca para a tela dedicada aqui — só quando o servidor
    // pedir documentos (ver efeito abaixo), aí sim abre a tela de anexar.
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
    // Sem documentos legíveis → não mostra um laudo de "não consta"; pede os
    // anexos (matrícula/edital). A análise só roda com material real.
    if (r.precisaDocumentos) {
      setParecerDocumental(r);
      setDocMsg(r.motivo || 'Anexe a matrícula e o edital (PDF) para gerar a análise documental.');
      setRelSel('documental');
      // Leiloeiro integrado baixando os documentos → re-gera sozinho (até ~2 min).
      // SÓ faz o poll quando a captura é REAL (emCaptura) E a linha é RECENTE (dentro da
      // janela de captura ~3 min). Sem a trava de frescor, reabrir um relatório ANTIGO
      // preso em "precisaDocumentos" reiniciava o loop de 5 regerações a cada visita
      // (custo de IA à toa + spinner infinito). Linha antiga → mostra direto o anexo manual.
      const fresco = docEntry.updatedAt && (Date.now() - new Date(docEntry.updatedAt).getTime() < 3 * 60 * 1000);
      if (r.emCaptura && fresco && capturaPollRef.current.n < 5) {
        capturaPollRef.current.n += 1;
        setPreparandoDocs(true);
        showMsg('Preparando os documentos… a análise sai sozinha em cerca de 1 minuto.');
        clearTimeout(capturaPollRef.current.timer);
        capturaPollRef.current.timer = setTimeout(() => { gerarRelDocumental(true); }, 25000);
      } else {
        setPreparandoDocs(false);
        capturaPollRef.current.n = 0;
        showMsg(r.motivo || 'Anexe a matrícula e o edital para gerar a análise.', 'error');
      }
      return;
    }
    // Leu os documentos: encerra qualquer poll de captura em andamento.
    setPreparandoDocs(false);
    capturaPollRef.current.n = 0;
    clearTimeout(capturaPollRef.current.timer);
    setParecerDocumental(r);
    // Preenche os riscos do imóvel a partir do que a IA encontrou nos documentos.
    if (Array.isArray(r.riscos) && r.riscos.length) {
      setD(p => ({ ...p, riscos: r.riscos.map(x => ({
        id: Date.now() + Math.random(),
        texto: x.constaNaDoc === false ? `${x.descricao || x.categoria} (não consta na documentação, a confirmar)` : (x.descricao || x.categoria),
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
    // Item 2: o documental leu os docs e achou dado que corrige o mercadológico → informa o impacto.
    if (Array.isArray(r.correcoesMercado) && r.correcoesMercado.length) setCorrecoesMercado(r.correcoesMercado);
    if (!r.parecer && !(r.documentosLidos || []).length) {
      setDocMsg('Não foi possível ler documentos automaticamente. Anexe a matrícula/edital ou cole o texto/nº do processo e gere novamente.');
    }
    showMsg('Análise Documental + Processo pronta!');
  }, [docEntry?.status, docEntry?.updatedAt, analiseImovelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ambosRelatorios = relMercadoGerado && relDocumentalGerado;
  // Gate do AGENDAMENTO com o analista: só após os TRÊS relatórios concluídos (Mercadológico +
  // Documental + Laudo de Viabilidade). Antes usava `ambosRelatorios` (só 2) e liberava o
  // agendamento no 2º relatório. NÃO reutilizar `ambosRelatorios` aqui: ele libera a GERAÇÃO do
  // Laudo (que exige só os 2 anteriores) — por isso é uma variável separada.
  const relatoriosConcluidos = relMercadoGerado && relDocumentalGerado && relLaudoGerado;

  // ─── Relatório 3: Laudo de Viabilidade (Agente de Defesa / parecer final) ───
  // Consolida os DOIS relatórios anteriores num veredito. Roda no servidor
  // (/api/gerar-laudo-viabilidade) e NÃO reprocessa fontes pagas — só sintetiza o
  // que já foi gerado. Só liberado com os dois relatórios prontos.
  const gerarRelLaudo = () => {
    if (!ambosRelatorios) { showMsg('Gere o Mercadológico e a Documental antes do Laudo de Viabilidade.', 'error'); return; }
    if (gerandoLaudo) return;
    showMsg('Laudo de viabilidade iniciado no servidor, consolida os dois relatórios; pode fechar a aba.');
    iniciarLaudo({ imovelId: analiseImovelId, titulo: d.nome || d.endereco || imovelInicial?.titulo || 'Imóvel', cidade: d.cidade, estado: d.estado, imovel: imovelInicial || null, paraUserId });
    setRelSel('laudo');
  };

  // AUTO-SEQUÊNCIA (arremate atribuído com docs): gera os 3 relatórios EM ORDEM sozinho —
  // mercadológico → documental → laudo. A ordem do produto já é segura: a atribuição (item 1)
  // lê a matrícula p/ os dados, e o item 2 oferece regerar se o documental achar uma correção.
  // Cada etapa dispara a seguinte quando a anterior CONCLUI (máquina de estados por ref).
  const autoSeqRef = React.useRef({ etapa: 0 });
  useEffect(() => {
    if (!autoGerar) return;
    const s = autoSeqRef.current;
    if (s.etapa === 0 && !relMercadoGerado && analiseEntry?.status !== 'gerando') { s.etapa = 1; gerarRelMercado(); return; }
    if (s.etapa === 1 && relMercadoGerado && !relDocumentalGerado && !gerandoDocumental && !relDocumentalPreparando) { s.etapa = 2; gerarRelDocumental(true); return; }
    if (s.etapa === 2 && ambosRelatorios && !relLaudoGerado && !gerandoLaudo) { s.etapa = 3; gerarRelLaudo(); }
  }, [autoGerar, relMercadoGerado, relDocumentalGerado, relLaudoGerado, gerandoDocumental, gerandoLaudo, relDocumentalPreparando, ambosRelatorios, analiseEntry?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Reunião com analista → ACOMPANHAMENTO (fluxo real no Caso) ─────────────
  // O agendamento de verdade (escolher analista+horário, o analista dar o parecer
  // e só então liberar o jurídico) vive na tela do Caso. Aqui apenas levamos o
  // cliente para lá — o Caso cria/abre o caso deste imóvel e mostra o agendamento.
  // Isso substitui o antigo stub (flags locais + "marcar realizada" pelo cliente).
  const irParaAcompanhamento = () => {
    if (!relatoriosConcluidos) { showMsg('Gere os três relatórios (Mercadológico, Documental e Laudo de Viabilidade) antes de agendar.', 'error'); return; }
    const imv = imovelInicial || {
      id: d.id, endereco: d.endereco, cidade: d.cidade, estado: d.estado,
      valorMinimo: d.valorArrematacao, valorAvaliacao: d.valorAvaliacao, modalidade: d.origem,
    };
    nav('/caso', { state: { imovel: imv } });
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
      } catch { /* portfólio local já foi salvo, erro de rede não bloqueia o usuário */ }
    }

    // A cota NÃO é mais consumida aqui: o consumo passou para o servidor, na
    // geração (/api/gerar-analise → consumir_analise_por), à prova de burla.
    // Aqui apenas relemos os contadores para manter a tela em dia.
    carregarCota();
  };

  // BidScore da aba documental: deriva a camada JURÍDICA do nível de risco +
  // pontos de atenção (mesma fórmula do backend), o que funciona também para
  // análises antigas (a coluna score_juridico quase não está preenchida). As demais
  // camadas vêm dos campos do imóvel quando disponíveis.
  const bidscoreDoc = (() => {
    if (!parecerDocumental || parecerDocumental.precisaDocumentos) return null;
    const pa = parecerDocumental.pontosAtencao || {};
    const nr = parecerDocumental.nivelRisco;
    const baseJur = nr === 'verde' ? 85 : nr === 'vermelho' ? 30 : 55;
    const scoreJuridico = Math.max(0, Math.min(100, Math.round(baseJur - (pa.altos || 0) * 10 - (pa.medios || 0) * 4)));
    const desc = d.valorAvaliacao > 0 ? (1 - d.valorArrematacao / d.valorAvaliacao) * 100 : (d.descontoPercentual ?? undefined);
    return scoreBidPro({ desconto: desc, modalidade: d.modalidade, tipo: d.tipo, scoreLocalizacao: d.scoreLocalizacao, scoreJuridico, scoreFinanceiro: d.scoreFinanceiro, valorMercado: d.valorMercado, valorMinimo: d.valorArrematacao, analiseViavel: d.analiseViavel });
  })();

  // Veredito jurídico do documental para o CABEÇALHO (aprovado / com ressalvas /
  // reprovado), derivado do nível de risco + pontos de atenção.
  const vereditoDoc = (() => {
    if (!parecerDocumental || parecerDocumental.precisaDocumentos) return null;
    // Preliminar = a IA não conseguiu ler os documentos por completo desta vez. NÃO
    // damos veredito confiante — sinalizamos que a leitura precisa ser refeita/revisada.
    if (parecerDocumental.preliminar) return { txt: 'ANÁLISE PRELIMINAR', sub: 'A fonte ficou indisponível agora e não deu para concluir a leitura. O sistema vai tentar de novo automaticamente (a cada hora, por até 48h). Se preferir, anexe a matrícula/edital em PDF para sair na hora.', bg: '#e0e7ff', c: '#3730a3' };
    const nr = parecerDocumental.nivelRisco;
    const pa = parecerDocumental.pontosAtencao || {};
    if (nr === 'vermelho' || (pa.altos || 0) > 0) return { txt: 'REPROVADO', sub: 'Alto risco jurídico — resolver os pontos antes de qualquer lance', bg: '#fee2e2', c: '#b91c1c' };
    if (nr === 'amarelo' || (pa.medios || 0) > 0) return { txt: 'APROVADO COM RESSALVAS', sub: 'Viável, com pontos a confirmar com o analista e jurídico', bg: '#fef3c7', c: '#92400e' };
    return { txt: 'APROVADO', sub: 'Sem impedimentos jurídicos identificados na documentação', bg: '#dcfce7', c: '#15803d' };
  })();

  // Exportação de PDF CONTEXTUAL: cada aba baixa o SEU relatório (antes o botão do
  // topo sempre gerava o mercadológico, mesmo estando no documental).
  const podeExportarPDF =
    (relSel === 'documental' && parecerDocumental && !parecerDocumental.precisaDocumentos) ||
    (relSel === 'laudo' && relLaudoGerado && !!laudoEntry?.result) ||
    ((relSel === 'mercado' || relSel === null) && !!parecer);

  // Cabeçalho comum dos PDFs (identificação): quem solicitou + nível (role), e — quando o
  // documental já rodou — executado/processo/matrícula extraídos. Todos opcionais (só aparece o
  // que houver). Um só objeto passado aos 3 relatórios.
  const cabPDF = {
    solicitante: { nome, role },
    executado: parecerDocumental?.extracao?.executadoNome || '',
    processo: parecerDocumental?.extracao?.numeroProcesso || cnjNumero || '',
    matricula: parecerDocumental?.extracao?.numeroMatricula || '',
  };

  const imprimirPDF = () => {
    if (relSel === 'documental' && parecerDocumental && !parecerDocumental.precisaDocumentos) {
      return gerarDocumentalPDF({ imovel: d, parecer: parecerDocumental, bidscore: bidscoreDoc, cab: cabPDF });
    }
    if (relSel === 'laudo' && relLaudoGerado && laudoEntry?.result) {
      return gerarLaudoPDF({ imovel: d, laudo: laudoEntry.result, cab: cabPDF });
    }
    return gerarPDF({ d, metricas, metricasTeto, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTab, priceTab, mercado, parecer, indicadores, cab: cabPDF });
  };

  // "Baixar os 3": só liberado quando os TRÊS relatórios estão prontos. Gera um
  // único PDF com Mercadológico + Documental + Conclusão, na ordem.
  const mercadoProntoPDF = !!parecer;
  const documentalProntoPDF = !!parecerDocumental && !parecerDocumental.precisaDocumentos;
  const laudoProntoPDF = relLaudoGerado && !!laudoEntry?.result;
  const podeExportarTodos = mercadoProntoPDF && documentalProntoPDF && laudoProntoPDF;

  const imprimirTodosPDF = () => {
    gerarCombinadoPDF({
      mercado: mercadoProntoPDF ? { d, metricas, metricasTeto, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTab, priceTab, mercado, parecer, indicadores, cab: cabPDF } : null,
      documental: documentalProntoPDF ? { imovel: d, parecer: parecerDocumental, bidscore: bidscoreDoc, cab: cabPDF } : null,
      laudo: laudoProntoPDF ? { imovel: d, laudo: laudoEntry.result, cab: cabPDF } : null,
    });
  };

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
  // A MAIORIA dos leilões NÃO divulga avaliação (só CEF/MEGA a têm; LJUD/GrupoLance/
  // Pestana/Biasi/Frazão/VIP/Sodré = 100% sem). Sem ela, o desconto vs avaliação sai 0%
  // e o relatório parece "sem oportunidade" — enganoso para o assinante. Ancoramos o
  // número PRINCIPAL no MERCADO (que a pesquisa sempre estima) quando não há avaliação.
  const descontoMercado = (d.valorMercado>0 && d.valorArrematacao>0) ? (1 - d.valorArrematacao/d.valorMercado)*100 : 0;
  const descontoPrincipal = descontoArremate > 0 ? descontoArremate : descontoMercado;
  const descontoPrincipalVsMercado = !(descontoArremate > 0) && descontoMercado > 0;

  // ÁREA SUSPEITA (provável TOTAL/terreno, não a privativa): a base do valor de mercado é a
  // área privativa. O gerador sinaliza via mercado.areaAlerta; como reforço, detectamos aqui
  // quando os comparáveis passam de 3× o R$/m² implícito na avaliação (ex.: 121 m² × R$10.980
  // = R$1,3M vs avaliação R$329k, que ~30 m² privativos explicariam). Nesse caso não exibimos a
  // base pm²×área inflada: pedimos a Área Privativa e usamos a avaliação como referência.
  const areaAlerta = mercado?.areaAlerta || null;
  const _aArea = Number(d.areaM2) || Number(d.areaTerrenoM2) || 0;
  const _aPm2 = Number(mercado?.precoMedioM2) || 0;
  const _aAvalM2 = Number(d.valorAvaliacao) > 0 && _aArea > 0 ? Number(d.valorAvaliacao) / _aArea : 0;
  const areaSuspeita = !!areaAlerta || (_aAvalM2 > 0 && _aPm2 > 0 && _aPm2 > 3 * _aAvalM2);
  const areaPrivativaImplicita = areaAlerta?.areaPrivativaImplicita || (_aPm2 > 0 && Number(d.valorAvaliacao) > 0 ? Math.round(Number(d.valorAvaliacao) / _aPm2) : 0);

  return (
    <div style={{ maxWidth: 1280, margin:'0 auto', padding: isMobile ? '12px' : '20px', display:'flex', flexDirection:'column', gap:14 }}>

      {/* HEADER */}
      <div style={{ background:'#111111', borderRadius:16, padding:'18px 22px', display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
        <div>
          <div style={{ fontSize:11, color:'#64748b', fontWeight:700, textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>Análise de Viabilidade</div>
          <div style={{ fontSize:18, fontWeight:900, color:'white', lineHeight:1.2 }}>{d.nome||'Novo Imóvel'}</div>
          {d.cidade && <div style={{ fontSize:12, color:'#94a3b8', marginTop:3, display:'flex', alignItems:'center', gap:5 }}><MapPin size={11}/>{d.cidade}{d.estado?`, ${d.estado}`:''}</div>}
        </div>
        {/* Ações do topo. "Ver imóvel" leva à ficha completa (mais fotos, mapa,
            documentos e dados que podem ser úteis durante a análise). Salvar/PDF
            só aparecem quando já há algo gerado. */}
        <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
          {imovelInicial?.id && (
            <button onClick={() => nav(`/imovel/${imovelInicial.id}`)} title="Abrir a ficha completa do imóvel"
              style={{ padding:'8px 14px', background:'transparent', color:'white', border:'1px solid #475569', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
              <Building2 size={14}/> Ver imóvel
            </button>
          )}
          {(relMercadoGerado || relDocumentalGerado) && (
            <>
              <button onClick={salvar} style={{ padding:'8px 16px', background:saved?'#10b981':'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6, transition:'background 0.2s' }}>
                {saved ? <><CheckCircle2 size={14}/> Salvo!</> : <><Save size={14}/> Salvar</>}
              </button>
              {podeExportarPDF && (
                <button onClick={imprimirPDF} style={{ padding:'8px 14px', background:'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                  <Printer size={14}/> PDF
                </button>
              )}
              {podeExportarTodos && (
                <button onClick={imprimirTodosPDF} title="Baixar os três relatórios num único PDF, na ordem" style={{ padding:'8px 14px', background:'#111111', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                  <Printer size={14}/> Baixar os 3 (PDF)
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Contador de análises por role */}
      {!semLimite && (
        <div style={{ padding:'10px 16px', borderRadius:10, background: analisesBloqueado ? '#fee2e2' : role === 'explorador' ? '#eff6ff' : '#fef3c7', color: analisesBloqueado ? '#dc2626' : role === 'explorador' ? '#084BA6' : '#92400e', fontSize:12, fontWeight:700, display:'flex', alignItems:'center', justifyContent:'space-between', gap:12 }}>
          <span>{analisesBloqueado
            ? (role === 'explorador'
                ? `🔒 Você usou seus ${limiteRole} relatórios de amostra. Compre créditos para gerar mais.`
                : `🔒 Limite de ${limiteRole} análises mensais atingido.`)
            : role === 'explorador'
              ? `📊 Relatórios de amostra: ${analisesUsadas}/${limiteRole}${analisesBonus > 0 ? ` (+${analisesBonus} bônus)` : ''}`
              : `📊 Análises este mês: ${analisesUsadas}/${limiteRole}`
          }</span>
          {analisesBloqueado && (
            role === 'explorador'
              ? <button onClick={() => nav('/creditos')} style={{ padding:'6px 14px', background:'#dc2626', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                  Comprar créditos
                </button>
              : <button onClick={() => setUpgrade({ tipo:'cota', titulo:null })} style={{ padding:'6px 14px', background:'#dc2626', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                  Fazer upgrade
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
            <div style={{ fontWeight:900, color:'#b91c1c', fontSize:14, marginBottom:6 }}>⚠ RISCO JURÍDICO BLOQUEANTE, OPERAÇÃO SUSPENSA</div>
            {riscosBloqueantes.map(r=><div key={r.id} style={{color:'#dc2626',fontSize:12,marginBottom:2}}>• {r.texto}</div>)}
          </div>
        </div>
      )}

      {/* DIVERGÊNCIA DE DOCUMENTAÇÃO (≠ risco jurídico): os documentos descrevem um imóvel
          DIFERENTE do informado p/ análise. Não reprova a operação — pede REGERAR com o dado certo. */}
      {Array.isArray(parecerDocumental?.divergenciasImovel) && parecerDocumental.divergenciasImovel.length>0 && (
        <div style={{ background:'#fffbeb', border:'2px solid #f59e0b', borderRadius:14, padding:'14px 18px', display:'flex', gap:12 }}>
          <FileText size={22} color="#d97706" style={{flexShrink:0,marginTop:2}}/>
          <div>
            <div style={{ fontWeight:900, color:'#92400e', fontSize:14, marginBottom:6 }}>⚠️ DIVERGÊNCIA DE DOCUMENTAÇÃO — não é risco jurídico</div>
            {parecerDocumental.divergenciasImovel.map((dv,i)=><div key={i} style={{color:'#92400e',fontSize:12,marginBottom:2}}>• {dv.descricao || dv.titulo}</div>)}
            <div style={{ fontSize:11.5, color:'#78350f', marginTop:6 }}>Os documentos descrevem um imóvel diferente do informado para análise (endereço/cidade/lote). A matrícula é a fonte de verdade — <strong>regere o relatório com os dados corretos</strong> (use “Corrigir e regerar” abaixo, quando aparecer).</div>
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
              const docMap = { edital:'Edital', matricula:'Matrícula', regras_venda:'Regra de venda online', laudo:'Laudo de Avaliação' };
              // Só os tópicos pertinentes à modalidade: venda direta tem "regra de
              // venda online" (não edital de leilão); leilão judicial/extrajudicial
              // tem edital. Matrícula vale em todos.
              const isVendaDireta = (imovelInicial?.modalidade || '') === 'venda_direta';
              // Anexos capturados pelo scraper/on-demand (imoveis_leilao.anexos) —
              // fonte do Laudo de Avaliação e demais docs além do que o usuário subiu.
              const anexosScrape = Array.isArray(imovelInicial?.anexos) ? imovelInicial.anexos : [];
              const acharAnexo = (t) => docsLeiloeiro.find(x => x.tipo === t) || anexosScrape.find(x => x.tipo === t);
              const temLaudo = !!acharAnexo('laudo');
              const base = isVendaDireta ? ['regras_venda','matricula'] : ['edital','matricula'];
              // Laudo de avaliação entra quando existe (traz o valor oficial — pesa no mercadológico).
              const topicos = temLaudo ? [...base, 'laudo'] : base;
              // Links válidos: matricula.asp e detalhe-imovel.asp são páginas do
              // portal (dão 404 / não são arquivo) — não viram link de documento.
              const ehArquivo = (v) => /^https?:\/\//i.test(v||'') && !/matricula\.asp|detalhe-imovel\.asp/i.test(v);
              // DOCUMENTO de verdade = ARQUIVO (PDF ou objeto no nosso Storage). Uma PÁGINA
              // (link_edital = página do lote na maioria dos leiloeiros; link_matricula = página)
              // NÃO é doc — se cair aqui, o item vira "via página do leiloeiro" (honesto), não
              // finge ser a matrícula/edital. Espelha o gate da tela do imóvel.
              const ehDocArquivo = (v) => /^https?:\/\//i.test(v||'') && (/\.pdf(\?|#|$)/i.test((v||'').trim()) || /\/storage\/v1\/object\/(sign|public)\//i.test(v||''));
              // Matrícula CEF: PDF estático em /editais/matricula/<UF>/<num>.pdf.
              const matriculaCef = caixaMatriculaUrl({ fonte: imovelInicial?.fonte, estado: imovelInicial?.estado, fonteId: imovelInicial?.fonteId });
              // Fallback "nunca sem documento": se o ARQUIVO não foi coletado, o
              // documento cai na PÁGINA do lote no leiloeiro (onde ele está).
              const paginaLeiloeiro = [imovelInicial?.urlLote, imovelInicial?.linkEdital, imovelInicial?.linkLeilao, imovelInicial?.url]
                .find(u => /^https?:\/\//i.test(u || '')) || null;
              const docsView = topicos.map(t => {
                const a = acharAnexo(t);
                const anexoUrl = (a?.url && /^https?:\/\//.test(a.url)) ? a.url : null;
                let fileUrl;
                if (t === 'matricula') {
                  // Prefere o PDF estático da Caixa (limpo, abre igual à tela do
                  // imóvel) ao anexo capturado — que às vezes é um "print" de
                  // visualizador, com baixa legibilidade. Anexo só como fallback.
                  fileUrl = matriculaCef || anexoUrl || (ehDocArquivo(imovelInicial?.linkMatricula) ? imovelInicial.linkMatricula : null);
                } else if (t === 'regras_venda') {
                  // "Regras da Venda Online": PDF padrão da Caixa (o link azul do
                  // portal). É o ARQUIVO de regras de fato — preferido ao anexo.
                  fileUrl = (isVendaDireta && caixaRegrasVendaUrl({ fonte: imovelInicial?.fonte }))
                    || anexoUrl || (ehDocArquivo(imovelInicial?.linkRegrasVenda) ? imovelInicial.linkRegrasVenda : null);
                } else if (t === 'laudo') {
                  // Laudo de avaliação: só existe como anexo capturado (sem coluna
                  // dedicada). Não cai na página do lote — se não há arquivo, não mostra.
                  fileUrl = anexoUrl;
                } else {
                  // Guard: link_edital só vira "Edital" se for ARQUIVO (PDF/Storage) E não for a
                  // matrícula (CEF grava link_edital = matrícula). A maioria dos leiloeiros grava
                  // link_edital = página do lote → não é arquivo → cai p/ o anexo (edital-PDF real)
                  // ou p/ a página do leiloeiro. Nunca finge ser edital, nem abre a matrícula.
                  const editalArq = (ehDocArquivo(imovelInicial?.linkEdital) && imovelInicial.linkEdital !== matriculaCef) ? imovelInicial.linkEdital : null;
                  fileUrl = anexoUrl || editalArq;
                }
                // Edital/regra/matrícula sempre com destino: arquivo, senão a página do leiloeiro.
                const url = fileUrl || paginaLeiloeiro;
                // anexoId p/ RE-ASSINAR no clique: só quando a URL escolhida É a do nosso anexo
                // (imovel_anexos) — as signed URLs do bucket `documentos` EXPIRAM e a URL gravada
                // passa a dar erro ao abrir; re-assinamos na hora via /api/anexo-url.
                const anexoId = (fileUrl && fileUrl === anexoUrl && a?.id) ? a.id : null;
                return { t, label: docMap[t], url, fileUrl, anexoId, viaPagina: !fileUrl && !!paginaLeiloeiro };
              });
              // CONTRAMEDIDA (docs capturados que não classificaram): alguns leiloeiros
              // servem edital/matrícula por URLs OPACAS (hash, sem "edital"/"matric" no
              // nome — ex.: SUPERBID s.superbid.net/attachment/...pdf). O capturador
              // salva como tipo 'outro'. Antes esses PDFs ficavam ESCONDIDOS. Aqui
              // listamos TODO PDF capturado que ainda não apareceu, com rótulo LIMPO
              // (nunca a URL crua) — nada fica atrás de um link do site.
              // Dedup por ARQUIVO (chave canônica): o mesmo edital com querystring volátil
              // (?v=/assinatura regenerada a cada scrape) aparecia como 7 linhas "Edital".
              const kDoc = (u) => chaveDocCanonica(u) || u;
              const urlsMostradas = new Set(docsView.map(d => d.fileUrl).filter(Boolean).map(kDoc));
              // Rótulo humano: só usa o "nome" se for texto de verdade (não URL, path
              // ou nome de arquivo tipo "1727787880704.pdf"); senão, rótulo genérico.
              const nomeLimpo = (n) => {
                const s = (n || '').trim();
                if (!s || /https?:|\/|\.pdf$|^\d[\d._-]*$/i.test(s) || !/[a-zà-ú]{3}/i.test(s)) return null;
                return s.slice(0, 48);
              };
              const todosAnexos = [...docsLeiloeiro, ...anexosScrape];
              const extras = [];
              const vistos = new Set();
              // Rótulos distintos p/ docs DIFERENTES do mesmo tipo (legítimo: edital 1ª/2ª
              // praça, retificação): "Edital", "Edital (2)"… — nunca N linhas idênticas.
              const porRotulo = {};
              for (const d of docsView) if (d.fileUrl && d.label) porRotulo[d.label] = 1;
              for (const a of todosAnexos) {
                const u = (a?.url && /^https?:\/\//.test(a.url)) ? a.url : null;
                if (!u) continue;
                const k = kDoc(u);
                if (urlsMostradas.has(k) || vistos.has(k)) continue;
                // já contemplado pelos tópicos padrão? (evita duplicar laudo/edital/etc.)
                if (topicos.includes(a.tipo) && docsView.find(d => d.t === a.tipo)?.fileUrl) continue;
                vistos.add(k);
                const rot = docMap[a.tipo] || nomeLimpo(a.nome) || `Documento do lote${extras.length ? ' ' + (extras.length + 1) : ''}`;
                porRotulo[rot] = (porRotulo[rot] || 0) + 1;
                const label = porRotulo[rot] > 1 ? `${rot} (${porRotulo[rot]})` : rot;
                extras.push({ t: `extra_${extras.length}`, label, url: u, fileUrl: u, anexoId: a?.id || null });
              }
              // Quando HÁ PDFs capturados sem classificação (extras), o "no site" por
              // tópico vira enganoso: aparece "Matrícula → abre o site" AO LADO do PDF
              // real. Nesses casos escondemos o fallback por tópico e oferecemos UM
              // link único ao leiloeiro (para o que faltou, ex.: edital não coletado).
              const temExtras = extras.length > 0;
              const principais = docsView.filter(d => d.fileUrl || !temExtras);
              const docsFinal = [...principais, ...extras];
              const algum = docsFinal.some(x => x.url);
              // Faltou algum doc padrão (sem arquivo) e temos página do leiloeiro?
              const faltando = docsView.some(d => !d.fileUrl);
              return (
                <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                  {docsFinal.map(it => it.url ? (
                    <a key={it.t} href={it.url} target="_blank" rel="noreferrer"
                      onClick={it.anexoId ? (e) => abrirAnexo(e, it.anexoId, it.url) : undefined}
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, textDecoration:'none', fontSize:13, fontWeight:600, color:'#0D63DB', minWidth:0 }}
                      onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                      <FileText size={14} style={{ flexShrink:0 }}/>
                      <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.label}</span>
                      {it.viaPagina && <span style={{ fontSize:10, color:'#94a3b8', fontWeight:600, flexShrink:0 }}>no site</span>}
                      <ExternalLink size={11} style={{ marginLeft:'auto', flexShrink:0 }}/>
                    </a>
                  ) : (
                    <div key={it.t} style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', fontSize:13, fontWeight:600, color:'#94a3b8' }}>
                      <FileText size={14} style={{ flexShrink:0 }}/> <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.label}</span> <span style={{ marginLeft:'auto', fontSize:10, fontWeight:700, flexShrink:0 }}>anexe acima ↑</span>
                    </div>
                  ))}
                  {/* Link único ao leiloeiro quando escondemos os "no site" por tópico */}
                  {temExtras && faltando && paginaLeiloeiro && (
                    <a href={paginaLeiloeiro} target="_blank" rel="noreferrer"
                      style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8, textDecoration:'none', fontSize:12, fontWeight:600, color:'#64748b' }}
                      onMouseEnter={e=>e.currentTarget.style.background='#f8fafc'} onMouseLeave={e=>e.currentTarget.style.background='none'}>
                      <ExternalLink size={13} style={{ flexShrink:0 }}/> Ver outros documentos no site do leiloeiro
                    </a>
                  )}
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
                { k:'mercado', label:'Mercadológico + Viabilidade', ok: relMercadoGerado, busy: gerandoMercado },
                { k:'documental', label:'Documental + Processo', ok: relDocumentalGerado, busy: gerandoDocumental || relDocumentalPreparando },
                { k:'laudo', label:'Laudo de Viabilidade', ok: relLaudoGerado, busy: gerandoLaudo },
              ].map(it => {
                // Clicável quando pronto OU em andamento (para abrir e ver o status).
                const clicavel = it.ok || it.busy;
                return (
                <button key={it.k} disabled={!clicavel} onClick={() => { if (clicavel) setRelSel(it.k); }}
                  title={clicavel ? '' : 'Gere o relatório no centro para abrir aqui'}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', border:'none', background: relSel===it.k ? '#eff6ff' : 'none', borderRadius:8, cursor: clicavel?'pointer':'default', textAlign:'left', fontSize:13, fontWeight:600, color: it.ok ? '#334155' : it.busy ? '#b45309' : '#cbd5e1' }}
                  onMouseEnter={e=>{ if(clicavel && relSel!==it.k) e.currentTarget.style.background='#f8fafc'; }} onMouseLeave={e=>{ if(relSel!==it.k) e.currentTarget.style.background='none'; }}>
                  <span style={{ width:18, height:18, borderRadius:'50%', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:800, background: it.ok ? '#dcfce7' : it.busy ? '#fef3c7' : '#f1f5f9', color: it.ok ? '#15803d' : it.busy ? '#b45309' : '#cbd5e1' }}>{it.ok ? '✓' : it.busy ? <Loader2 size={11} style={{ animation:'spin 1s linear infinite' }}/> : '·'}</span>
                  {it.label}
                </button>
                );
              })}
            </div>
          </div>

          {/* Reunião com analista → acompanhamento (fluxo real no Caso: agenda o
              horário, o analista dá o parecer e só então libera o jurídico). */}
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            <button onClick={irParaAcompanhamento} disabled={!relatoriosConcluidos}
              title={!relatoriosConcluidos ? 'Gere os três relatórios para liberar' : ''}
              style={{ width:'100%', padding:'11px', background: !relatoriosConcluidos ? '#e2e8f0' : '#0D63DB', color: !relatoriosConcluidos ? '#94a3b8' : 'white', border:'none', borderRadius:12, fontWeight:700, fontSize:13, cursor: !relatoriosConcluidos ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
              <Calendar size={15}/> Agendar reunião com analista
            </button>
            <div style={{ fontSize:10, color:'#94a3b8', textAlign:'center', lineHeight:1.4 }}>
              {!relatoriosConcluidos
                ? 'Disponível após gerar os três relatórios (Mercadológico, Documental e Laudo de Viabilidade).'
                : 'Você escolhe o horário; após a reunião o analista dá o parecer e libera o jurídico.'}
            </div>
          </div>
        </aside>
        )}

        {/* ── CENTRAL (relatórios) ── */}
        <div style={{ display:'flex', flexDirection:'column', gap:14, minWidth:0 }}>

          {/* Barra de voltar (quando um relatório está aberto no centro) */}
          {relSel !== null && (
            <div style={{ position:'sticky', top:0, zIndex:20, display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, background:'#f8fafc', padding:'10px 0', marginBottom:2 }}>
              <button onClick={() => setRelSel(null)} style={{ display:'flex', alignItems:'center', gap:6, background:'white', border:'1px solid #cbd5e1', borderRadius:10, padding:'9px 15px', fontSize:13, fontWeight:800, color:'#0D63DB', cursor:'pointer', boxShadow:'0 1px 4px rgba(0,0,0,0.1)' }}>← Voltar / gerar outro relatório</button>
              {podeExportarPDF && <button onClick={imprimirPDF} style={{ display:'flex', alignItems:'center', gap:6, background:'#0D63DB', border:'none', borderRadius:10, padding:'9px 15px', fontSize:13, fontWeight:700, color:'white', cursor:'pointer' }}><Printer size={14}/> PDF</button>}
            </div>
          )}

          {/* LAUNCHER, inclusão manual (topo, quando ativa) + botões de gerar */}
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
                Sobe pro topo do centro quando o modo manual está ativo. NÃO aparece quando o
                relatório documental JÁ foi gerado (ex.: arremate atribuído manualmente) — aí o
                imóvel já está na base e "incluir imóvel de outro leiloeiro" só confunde. */}
            {modoManual && !relDocumentalGerado && (
              <div style={{ border:'1px dashed #c4b5fd', background:'#faf5ff', borderRadius:16, padding: isMobile?'16px 18px':'20px 22px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                  <Building2 size={17} color="#7c3aed"/>
                  <div style={{ fontSize:15, fontWeight:900, color:'#111' }}>{semImovelBase ? 'Incluir lote manualmente' : 'Imóvel de outro leiloeiro'}</div>
                </div>
                <div style={{ fontSize:12, color:'#64748b', lineHeight:1.6, marginBottom:12 }}>
                  Cole o <strong>link do lote</strong> e/ou anexe o <strong>edital/matrícula</strong> de um imóvel que não está na nossa base. A IA extrai os dados (endereço, valores, área, leiloeiro, riscos) e libera os relatórios abaixo. <strong>É uma análise fora da base</strong>, os dados dependem do que você fornecer (sem a curadoria BidPro). Nossa equipe é avisada para avaliar integrar este leiloeiro.
                </div>
                {externoNotificado ? (
                  <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#ecfdf5', border:'1px solid #a7f3d0', borderRadius:10, fontSize:12, fontWeight:700, color:'#065f46' }}>
                    <CheckCircle2 size={15}/> Análise liberada, gere os relatórios abaixo. Equipe avisada.
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
              <div style={{ fontSize:13, color:'#64748b', marginBottom:18, lineHeight:1.6 }}>A IA usa automaticamente os dados e documentos deste imóvel. Gere cada relatório, eles vão para a barra lateral e abrem aqui. Com os dois prontos, libera a reunião com o analista.</div>
              <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr':'1fr 1fr', gap:14 }}>
                {[
                  { k:'mercado', cor:'#0d9488', bg:'#f0fdfa', Icon:BarChart3, titulo:'Mercadológico + Viabilidade Financeira', desc:'Avaliação de mercado (níveis 1 e 2), estrutura de custos, cenários, ROI/ROE e teto de lance.', ok:relMercadoGerado, gerando:gerandoMercado, fn:gerarRelMercado, block: analisesBloqueado, seqBloqueado:false, ordem:1 },
                  { k:'documental', cor:'#1e3a8a', bg:'#eef2ff', Icon:Scale, titulo:'Análise Documental + Processo', desc:'Leitura do edital/matrícula (ônus e gravames) e consulta do processo no CNJ + certidões fiscais.', ok:relDocumentalGerado, gerando:gerandoDocumental, preparando:relDocumentalPreparando, fn:gerarRelDocumental, block:false, seqBloqueado: !relMercadoGerado && !relDocumentalGerado, planoBloqueado: ROLES_SEM_DOCUMENTAL.includes(role), ordem:2 },
                  { k:'laudo', cor:'#111111', bg:'#f1f5f9', Icon:Award, titulo:'Laudo de Viabilidade (Parecer Final)', desc:'Consolida os dois relatórios acima num veredito de defesa (aprovado/condicional/reprovado), com condições e diligências. Não reprocessa fontes, sintetiza o que já foi gerado.', ok:relLaudoGerado, gerando:gerandoLaudo, fn:gerarRelLaudo, block:false, seqBloqueado: !ambosRelatorios && !relLaudoGerado, planoBloqueado: ROLES_SEM_DOCUMENTAL.includes(role), ordem:3 },
                ].map(c => {
                  const travado = c.gerando || c.preparando || c.block || c.seqBloqueado || c.planoBloqueado;
                  return (
                  <div key={c.k} style={{ border:`1px solid ${c.ok?c.cor:c.preparando?'#fde68a':'#e2e8f0'}`, borderRadius:14, padding:'18px', display:'flex', flexDirection:'column', gap:12, background: c.ok?c.bg:'white', opacity: c.seqBloqueado?0.7:1 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:40, height:40, borderRadius:10, background:c.bg, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}><c.Icon size={20} color={c.cor}/></div>
                      <div style={{ fontSize:14, fontWeight:800, color:'#111', lineHeight:1.25 }}><span style={{ color:c.cor }}>{c.ordem}.</span> {c.titulo}</div>
                    </div>
                    <div style={{ fontSize:12, color:'#64748b', lineHeight:1.6, flex:1 }}>{c.desc}</div>
                    <div style={{ display:'flex', gap:8 }}>
                      {c.planoBloqueado ? (
                        <button onClick={() => setUpgrade({ tipo:'plano', titulo:c.titulo })}
                          style={{ flex:1, padding:'10px', background:c.cor, color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                          <Lock size={14}/> Disponível no Investidor Pro
                        </button>
                      ) : c.block ? (
                        <button onClick={() => setUpgrade({ tipo:'cota', titulo:c.titulo })}
                          style={{ flex:1, padding:'10px', background:c.cor, color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                          <Lock size={14}/> Limite atingido, fazer upgrade
                        </button>
                      ) : (
                        <button onClick={c.fn} disabled={travado}
                          style={{ flex:1, padding:'10px', background: travado?(c.preparando?'#d97706':'#cbd5e1'):c.cor, color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor: (travado && !c.preparando)?'default':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                          {c.gerando ? <><Loader2 size={15} style={{animation:'spin 1s linear infinite'}}/> Gerando...</>
                            : c.preparando ? <><Loader2 size={15} style={{animation:'spin 1s linear infinite'}}/> Preparando documentos…</>
                            : c.seqBloqueado ? <><Lock size={14}/> Gere o 1º antes</>
                            : <><Sparkles size={15}/> {c.ok?'Regerar':'Gerar'}</>}
                        </button>
                      )}
                      {(c.ok || c.preparando) && <button onClick={()=>setRelSel(c.k)} style={{ padding:'10px 14px', background:'white', color:c.cor, border:`1px solid ${c.cor}`, borderRadius:10, fontWeight:800, fontSize:13, cursor:'pointer' }}>Abrir</button>}
                    </div>
                    {(c.gerando || c.preparando) && (
                      <div style={{ fontSize:11, color: c.preparando?'#b45309':c.cor, lineHeight:1.4, textAlign:'center' }}>
                        {c.preparando
                          ? 'Ainda buscando o edital/matrícula do lote pelas rotas automáticas. Se não chegarem, você pode anexar os PDFs manualmente ao abrir.'
                          : c.k==='mercado'
                          ? 'Buscando preços de mercado em tempo real e montando a viabilidade, pode levar até ~2 min. Pode fechar a aba; continua no servidor.'
                          : 'Lendo edital/matrícula/anexos e consultando o processo no CNJ, roda no servidor; pode fechar a aba.'}
                      </div>
                    )}
                    {/* BARRA DE EVOLUÇÃO (mercadológico): cada etapa da geração preenche a barra e
                        mostra sua contagem quando conclui. Etapas isoladas com tempos independentes. */}
                    {c.k==='mercado' && c.gerando && Array.isArray(analiseEntry?.progresso?.etapas) && analiseEntry.progresso.etapas.length > 0 && (() => {
                      const ets = analiseEntry.progresso.etapas;
                      const resolved = ets.filter(e => ['concluido','pulado','erro'].includes(e.status)).length + 0.5 * ets.filter(e => e.status==='gerando').length;
                      const pct = Math.round((resolved / ets.length) * 100);
                      return (
                        <div style={{ marginTop:2 }}>
                          <div style={{ height:6, borderRadius:99, background:'#e2e8f0', overflow:'hidden' }}>
                            <div style={{ height:'100%', width:`${Math.max(6, pct)}%`, background:c.cor, borderRadius:99, transition:'width .5s ease' }}/>
                          </div>
                          <div style={{ display:'flex', flexDirection:'column', gap:6, marginTop:10 }}>
                            {ets.map((e) => {
                              const st = e.status;
                              const ic = st==='concluido' ? <CheckCircle2 size={13} color="#15803d"/>
                                : st==='gerando' ? <Loader2 size={13} color={c.cor} style={{ animation:'spin 1s linear infinite' }}/>
                                : st==='erro' ? <AlertTriangle size={13} color="#b45309"/>
                                : st==='pulado' ? <span style={{ fontSize:12, color:'#94a3b8', fontWeight:800 }}>—</span>
                                : <span style={{ width:12, height:12, borderRadius:'50%', border:'2px solid #cbd5e1', display:'inline-block' }}/>;
                              const cor = st==='concluido' ? '#15803d' : st==='gerando' ? '#111' : st==='erro' ? '#b45309' : '#94a3b8';
                              return (
                                <div key={e.key} style={{ display:'flex', alignItems:'center', gap:8, fontSize:11.5, color:cor, fontWeight: st==='gerando'?800:600 }}>
                                  <span style={{ width:14, display:'flex', justifyContent:'center', flexShrink:0 }}>{ic}</span>
                                  <span style={{ flex:1, lineHeight:1.3 }}>{e.label}</span>
                                  {e.n != null && st==='concluido' && <span style={{ fontSize:10.5, fontWeight:800, color:'#64748b', background:'#f1f5f9', borderRadius:6, padding:'1px 6px' }}>{e.n}</span>}
                                  {st==='erro' && e.key==='contexto' && <span style={{ fontSize:10, color:'#94a3b8' }}>opcional</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );})}
              </div>
              {docMsg && <div style={{ marginTop:14, padding:'10px 14px', background:'#fef3c7', border:'1px solid #fde68a', borderRadius:10, fontSize:12, color:'#92400e' }}>{docMsg}</div>}
            </div>
          </>
          )}

          {/* ===== RELATÓRIO: ANÁLISE DOCUMENTAL + PROCESSO ===== */}
          {relSel === 'documental' && (
            <div style={{ background:'linear-gradient(135deg,#0f172a,#1e3a8a)', borderRadius:16, padding:'18px 22px', color:'white', display:'flex', alignItems:'center', justifyContent:'space-between', gap:14, flexWrap:'wrap' }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, textTransform:'uppercase', opacity:0.85 }}>Relatório · BidPro Brasil</div>
                <div style={{ fontSize:18, fontWeight:900, marginTop:2 }}>Análise Documental e Processo</div>
                <div style={{ fontSize:12, opacity:0.9, marginTop:4 }}>{d.nome||'Imóvel'}{[d.cidade,d.estado].filter(Boolean).length ? ` · ${[d.cidade,d.estado].filter(Boolean).join(', ')}` : ''}</div>
              </div>
              {vereditoDoc && (
                <div style={{ background:vereditoDoc.bg, color:vereditoDoc.c, borderRadius:12, padding:'10px 16px', textAlign:'right', flexShrink:0, maxWidth:280 }}>
                  <div style={{ fontSize:15, fontWeight:900, letterSpacing:0.3 }}>{vereditoDoc.txt}</div>
                  <div style={{ fontSize:10.5, fontWeight:600, marginTop:2, lineHeight:1.35, opacity:0.95 }}>{vereditoDoc.sub}</div>
                </div>
              )}
            </div>
          )}

          {/* Enquanto a IA gera (cliente): estado de carregamento no lugar da antiga
              tela de formulários, a análise roda inteira no servidor. */}
          {relSel === 'documental' && !parecerDocumental && (gerandoDocumental || docEntry?.status === 'gerando') && (
            <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:16, padding:'28px 22px', display:'flex', flexDirection:'column', alignItems:'center', gap:12, textAlign:'center' }}>
              <Loader2 size={28} color="#1e3a8a" style={{ animation:'spin 1s linear infinite' }}/>
              <div style={{ fontSize:15, fontWeight:800, color:'#111' }}>Gerando a análise documental e jurídica…</div>
              <div style={{ fontSize:13, color:'#64748b', lineHeight:1.6, maxWidth:460 }}>A IA está lendo o edital/matrícula e as regras da venda, consultando o processo no CNJ e as certidões fiscais. Leva alguns instantes, você pode fechar a aba; continua no servidor e aparece aqui quando pronto.</div>
            </div>
          )}

          {/* Captura de documentos em andamento (leiloeiro integrado) → a análise
              sai sozinha quando os PDFs chegarem; não pedimos anexo manual aqui. */}
          {relSel === 'documental' && parecerDocumental?.precisaDocumentos && preparandoDocs && (
            <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:16, padding:'28px 22px', display:'flex', flexDirection:'column', alignItems:'center', gap:12, textAlign:'center' }}>
              <Loader2 size={28} color="#c2410c" style={{ animation:'spin 1s linear infinite' }}/>
              <div style={{ fontSize:15, fontWeight:800, color:'#9a3412' }}>Preparando os documentos…</div>
              <div style={{ fontSize:13, color:'#7c2d12', lineHeight:1.6, maxWidth:460 }}>Estamos baixando o edital e a matrícula direto do leiloeiro integrado. Leva cerca de 1 minuto e a análise é gerada sozinha, sem você precisar clicar. Se preferir, você pode anexar os PDFs manualmente abaixo.</div>
            </div>
          )}

          {/* Parecer documental gerado NO SERVIDOR (lê edital/matrícula/anexos + CNJ) */}
          {relSel === 'documental' && parecerDocumental?.precisaDocumentos && !preparandoDocs && (
            <DocsFaltantesCard
              faltando={parecerDocumental.faltando || ['matricula','edital']}
              paginaLeiloeiro={parecerDocumental.paginaLeiloeiro}
              motivo={parecerDocumental.motivo}
            />
          )}
          {/* Análise gerada, mas faltou um documento central (ex.: matrícula lida e
              edital ausente): pede SÓ o que falta, sem refazer tudo. */}
          {relSel === 'documental' && parecerDocumental && !parecerDocumental.precisaDocumentos && (parecerDocumental.faltando?.length > 0) && (
            <DocsFaltantesCard compact faltando={parecerDocumental.faltando} paginaLeiloeiro={parecerDocumental.paginaLeiloeiro} />
          )}
          {relSel === 'documental' && parecerDocumental && !parecerDocumental.precisaDocumentos && (
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

              {/* BidScore (0 a 10): potencial de oportunidade, com a camada jurídica
                  desta análise já incorporada. */}
              {bidscoreDoc && (() => {
                const corCamada = (n) => n >= 7 ? '#16a34a' : n >= 4 ? '#d97706' : '#dc2626';
                return (
                  <div style={{ padding:'12px 14px', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:12 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:46, height:46, borderRadius:11, background:bidscoreDoc.cor, color:'white', fontWeight:900, fontSize:18, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>{bidscoreDoc.nota.toFixed(1)}</div>
                      <div style={{ minWidth:0 }}>
                        <div style={{ fontSize:13.5, fontWeight:900, color:'#111' }}>BidScore</div>
                        <div style={{ fontSize:11.5, color:'#64748b', lineHeight:1.3 }}>{scoreLabel(bidscoreDoc.base)}</div>
                      </div>
                    </div>
                    <div style={{ marginTop:10, display:'flex', flexDirection:'column', gap:6 }}>
                      {bidscoreDoc.camadas.map(c => (
                        <div key={c.key} style={{ display:'flex', alignItems:'center', gap:8 }}>
                          <div style={{ width:82, fontSize:11.5, fontWeight:700, color:'#475569', flexShrink:0 }}>{c.label}</div>
                          <div style={{ flex:1, height:7, background:'#e2e8f0', borderRadius:20, overflow:'hidden' }}>
                            <div style={{ width:`${c.nota*10}%`, height:'100%', background:corCamada(c.nota), borderRadius:20 }}/>
                          </div>
                          <div style={{ width:62, textAlign:'right', fontSize:11.5, color:'#64748b', flexShrink:0 }}>{c.nota.toFixed(1)} <span style={{ color:'#cbd5e1' }}>·{c.peso}%</span></div>
                        </div>
                      ))}
                    </div>
                    <div style={{ marginTop:8, fontSize:11, color:'#94a3b8', lineHeight:1.5 }}>Nota de 0 a 10 (triagem), média ponderada das camadas presentes. Não substitui o parecer do analista.</div>
                  </div>
                );
              })()}

              {/* Resumo escaneável: pontos de atenção + dados-chave da matrícula */}
              {(() => {
                const pa = parecerDocumental.pontosAtencao;
                const ex = parecerDocumental.extracao || {};
                const chips = [];
                if (pa && pa.total > 0) {
                  if (pa.altos > 0) chips.push({ t: `${pa.altos} alta${pa.altos>1?'s':''}`, bg:'#fee2e2', c:'#b91c1c' });
                  if (pa.medios > 0) chips.push({ t: `${pa.medios} média${pa.medios>1?'s':''}`, bg:'#fef3c7', c:'#92400e' });
                }
                const fatos = [];
                if (ex.indisponibilidadePenhora === 'sim') fatos.push({ t:'Indisponibilidade/penhora ativa', bg:'#fee2e2', c:'#b91c1c' });
                else if (ex.indisponibilidadePenhora === 'nao') fatos.push({ t:'Sem indisponibilidade/penhora', bg:'#dcfce7', c:'#15803d' });
                if (ex.dataConsolidacao) fatos.push({ t:`Consolidação: ${ex.dataConsolidacao}`, bg:'#eff6ff', c:'#0D63DB' });
                if (ex.condominioNome) fatos.push({ t:`Condomínio: ${ex.condominioNome}${ex.condominioCnpj?` (${ex.condominioCnpj})`:''}`, bg:'#f1f5f9', c:'#475569' });
                if (!chips.length && !fatos.length) return null;
                return (
                  <div style={{ display:'flex', flexDirection:'column', gap:8, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:12, padding:'12px 14px' }}>
                    {pa && pa.total > 0 && (
                      <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                        <span style={{ fontSize:12.5, fontWeight:800, color:'#334155' }}>⚠ {pa.total} ponto{pa.total>1?'s':''} de atenção</span>
                        {chips.map((c,i)=><span key={i} style={{ fontSize:11, fontWeight:700, padding:'2px 9px', borderRadius:20, background:c.bg, color:c.c }}>{c.t}</span>)}
                      </div>
                    )}
                    {fatos.length > 0 && (
                      <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                        {fatos.map((c,i)=><span key={i} style={{ fontSize:11, fontWeight:700, padding:'3px 10px', borderRadius:8, background:c.bg, color:c.c }}>{c.t}</span>)}
                      </div>
                    )}
                  </div>
                );
              })()}

              {(parecerDocumental.documentosLidos || []).length > 0 && (
                <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                  {parecerDocumental.documentosLidos.map((dl, i) => (
                    <a key={i} href={dl.url} target="_blank" rel="noopener noreferrer" style={{ fontSize:11, fontWeight:700, color:'#1e3a8a', background:'#eef2ff', padding:'3px 9px', borderRadius:6, textDecoration:'none' }}>📄 {dl.rotulo}</a>
                  ))}
                </div>
              )}
              {(parecerDocumental.checklist || []).length > 0 && (
                <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:12, padding:'14px 16px' }}>
                  <div style={{ fontSize:12, fontWeight:800, color:'#334155', marginBottom:2, display:'flex', alignItems:'center', gap:7 }}>
                    📋 Fontes e comprovantes das informações
                    {parecerDocumental.pendencias > 0 && (
                      <span style={{ marginLeft:'auto', fontSize:10.5, fontWeight:800, color:'#92400e', background:'#fef3c7', padding:'2px 8px', borderRadius:20 }}>
                        {parecerDocumental.pendencias} pendente(s)
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:'#94a3b8', lineHeight:1.5, marginBottom:10 }}>
                    De onde vieram os dados deste relatório — documentos lidos e consultas públicas, com o comprovante de cada uma.
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                    {parecerDocumental.checklist.map((c, i) => {
                      const cor = c.status==='feito' ? '#16a34a' : c.status==='pendente' ? '#d97706' : c.status==='diligencia' ? '#2563eb' : '#94a3b8';
                      const ic  = c.status==='feito' ? '✓' : c.status==='pendente' ? '⏳' : c.status==='diligencia' ? '📌' : '—';
                      // Chip de CONEXÃO/diagnóstico por fonte: deixa claro se a fonte
                      // respondeu, ficou indisponível agora, exige diligência manual, ou
                      // não havia dado para consultar.
                      const conn = c.status==='feito' ? { t:'conectado', bg:'#dcfce7', c:'#15803d' }
                        : c.status==='pendente' ? { t:'indisponível agora', bg:'#fef3c7', c:'#92400e' }
                        : c.status==='diligencia' ? { t:'em validação (jurídico)', bg:'#dbeafe', c:'#1e40af' }
                        : { t:'sem dado p/ consultar', bg:'#f1f5f9', c:'#64748b' };
                      return (
                        <div key={i} style={{ display:'flex', gap:9, alignItems:'flex-start' }}>
                          <span style={{ color:cor, fontWeight:900, fontSize:13, lineHeight:1.5, flexShrink:0, width:14, textAlign:'center' }}>{ic}</span>
                          <div style={{ minWidth:0, flex:1 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                              <div style={{ fontSize:12.5, fontWeight:700, color:'#111' }}>{c.label}</div>
                              <span style={{ fontSize:10, fontWeight:800, padding:'1px 7px', borderRadius:20, background:conn.bg, color:conn.c }}>{conn.t}</span>
                            </div>
                            <div style={{ fontSize:11.5, color:'#64748b', lineHeight:1.5 }}>{c.detalhe}</div>
                            {c.comprovante && (
                              <a href={c.comprovante} target="_blank" rel="noopener noreferrer" onClick={(e) => verComprovante(e, c.comprovante)} style={{ display:'inline-flex', alignItems:'center', gap:4, marginTop:3, fontSize:11, fontWeight:700, color:'#1e3a8a', textDecoration:'none' }}>📄 Ver certidão do portal</a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {parecerDocumental.pendencias > 0 && (
                    <div style={{ marginTop:10, fontSize:11.5, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:8, padding:'8px 11px', lineHeight:1.5 }}>
                      Algumas consultas públicas não retornaram de forma conclusiva automaticamente agora. Liberamos o relatório com o que já temos; os itens pendentes entram na validação do analista e do jurídico antes do lance (o sistema também reprocessa as fontes automaticamente).
                    </div>
                  )}
                </div>
              )}
              {parecerDocumental.raioX && (() => {
                const rx = parecerDocumental.raioX;
                const brl = v => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
                const dataBR = s => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || ''); };
                const cad = (rx.cadeiaDominial || []).filter(a => a && (a.parte || a.evento));
                const cert = (rx.certidoesRecomendadas || []).filter(c => c && c.nome);
                const oc = rx.ocupacaoDetalhe || {}, fr = rx.fraudeExecucao || {}, dp = rx.direitoPreferencia || {}, db = rx.debitos || {}, cr = rx.cronogramaLeilao || {};
                const temOc = oc.tipo && oc.tipo !== 'nao_consta';
                const temFr = fr.risco && fr.risco !== 'nenhum';
                const cron = [cr.primeiraPraca && `1ª praça: ${dataBR(cr.primeiraPraca)}`, cr.segundaPraca && `2ª praça: ${dataBR(cr.segundaPraca)}`, cr.prazoPagamento && `Pagamento: ${cr.prazoPagamento}`, cr.prazoEmbargos && `Embargos: ${cr.prazoEmbargos}`].filter(Boolean);
                if (!cad.length && !cert.length && !temOc && !temFr && !dp.existe && !db.totalAssumidoArrematante && !db.aLevantar && !cron.length) return null;
                const Bloco = ({ titulo, children }) => (
                  <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'12px 14px' }}>
                    <div style={{ fontSize:12, fontWeight:800, color:'#334155', marginBottom:8 }}>{titulo}</div>
                    {children}
                  </div>
                );
                return (
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    <div style={{ fontSize:13, fontWeight:900, color:'#1e3a8a', display:'flex', alignItems:'center', gap:7 }}>🔎 Raio-X jurídico</div>
                    {temFr && (
                      <div style={{ background: fr.risco==='alto'?'#fef2f2':'#fffbeb', border:`1px solid ${fr.risco==='alto'?'#fecaca':'#fde68a'}`, borderRadius:10, padding:'12px 14px' }}>
                        <div style={{ fontSize:12.5, fontWeight:800, color: fr.risco==='alto'?'#b91c1c':'#b45309' }}>⚠ Risco de fraude à execução: {fr.risco}</div>
                        {fr.motivo && <div style={{ fontSize:12, color:'#475569', marginTop:4, lineHeight:1.5 }}>{fr.motivo}</div>}
                      </div>
                    )}
                    {temOc && (
                      <Bloco titulo="Ocupação">
                        <div style={{ fontSize:12.5, color:'#334155', lineHeight:1.6 }}>
                          <strong>{OCUP_LABEL_A[oc.tipo] || oc.tipo}</strong>
                          {oc.direitos ? ` · ${oc.direitos}` : ''}
                          {oc.prazoMeses ? ` · desocupação ~${oc.prazoMeses} ${oc.prazoMeses>1?'meses':'mês'}` : ''}
                          {oc.custoEstimado ? ` · custo est. ${brl(oc.custoEstimado)}` : ''}
                          {oc.procedimentoDesocupacao ? <div style={{ color:'#64748b', marginTop:3 }}>{oc.procedimentoDesocupacao}</div> : null}
                        </div>
                      </Bloco>
                    )}
                    {(db.totalAssumidoArrematante > 0 || (db.propterRem||[]).length > 0 || db.aLevantar) && (
                      <Bloco titulo="Débitos">
                        <div style={{ fontSize:12.5, color:'#334155', lineHeight:1.6 }}>
                          {db.totalAssumidoArrematante > 0 ? <div>Você assume (propter rem): <strong style={{ color:'#b45309' }}>{brl(db.totalAssumidoArrematante)}</strong></div> : (db.aLevantar ? <div style={{ color:'#b45309' }}>Débitos propter rem a levantar (IPTU/condomínio).</div> : null)}
                          {(db.propterRem||[]).length>0 && <div style={{ color:'#64748b' }}>Acompanham o imóvel: {(db.propterRem).join(', ')}</div>}
                          {(db.pessoais||[]).length>0 && <div style={{ color:'#64748b' }}>Do devedor (não transferem): {(db.pessoais).join(', ')}</div>}
                        </div>
                      </Bloco>
                    )}
                    {dp.existe && (
                      <Bloco titulo="Direito de preferência/adjudicação">
                        <div style={{ fontSize:12.5, color:'#334155' }}>Sujeito a preferência de: {(dp.titulares||[]).join(', ') || 'terceiros (verificar)'}.</div>
                      </Bloco>
                    )}
                    {cron.length > 0 && (
                      <Bloco titulo="Cronograma do leilão">
                        <div style={{ fontSize:12.5, color:'#334155', display:'flex', flexWrap:'wrap', gap:'4px 14px' }}>{cron.map((c,i)=><span key={i}>{c}</span>)}</div>
                      </Bloco>
                    )}
                    {cad.length > 0 && (
                      <Bloco titulo={`Cadeia dominial (${cad.length})`}>
                        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                          {cad.slice(0,10).map((a,i)=>(
                            <div key={i} style={{ fontSize:12, color:'#334155', display:'flex', gap:8 }}>
                              <span style={{ color:'#94a3b8', fontWeight:700, flexShrink:0, minWidth:70 }}>{a.ato || '—'}{a.data ? ` · ${dataBR(a.data)}` : ''}</span>
                              <span>{[a.evento, a.parte].filter(Boolean).join(' — ')}</span>
                            </div>
                          ))}
                        </div>
                      </Bloco>
                    )}
                    {cert.length > 0 && (
                      <Bloco titulo={`Certidões recomendadas (${cert.length})`}>
                        <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                          {cert.map((c,i)=>(
                            <div key={i} style={{ fontSize:12, color:'#334155', display:'flex', gap:8, alignItems:'flex-start' }}>
                              <span style={{ flexShrink:0 }}>{c.online ? '🟢' : '📄'}</span>
                              <div><strong>{c.nome}</strong>{c.orgao ? ` · ${c.orgao}` : ''}{c.motivo ? <span style={{ color:'#64748b' }}> — {c.motivo}</span> : ''}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{ fontSize:10.5, color:'#94a3b8', marginTop:6 }}>🟢 emissão online gratuita · 📄 requer cartório/órgão</div>
                      </Bloco>
                    )}
                  </div>
                );
              })()}
              {parecerDocumental.parecer && (
                <div style={{ fontSize:15, color:'#1e293b', lineHeight:1.85, whiteSpace:'pre-wrap', fontWeight:400 }}>
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

          {/* PRÓXIMO PASSO, destaque ao fim do Documental: reunião com o analista */}
          {relSel === 'documental' && parecerDocumental && !isStaffAnalise && (
            <div style={{ background:'#faf5ff', border:'2px solid #c4b5fd', borderRadius:16, padding:'18px 20px', display:'flex', gap:14, alignItems:'flex-start' }}>
              <ShieldAlert size={22} color="#7c3aed" style={{ flexShrink:0, marginTop:2 }}/>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:14, fontWeight:900, color:'#5b21b6', marginBottom:4 }}>Antes de dar o lance, valide com um especialista</div>
                <div style={{ fontSize:12.5, color:'#4c1d95', lineHeight:1.7, marginBottom:12 }}>
                  Arrematar é uma <strong>operação de risco</strong> e deve ser conduzida profissionalmente. Com os três relatórios prontos, <strong>agende uma reunião com um analista BidPro</strong> para revisar a operação, tirar dúvidas e decidir com segurança.
                </div>
                <button onClick={irParaAcompanhamento} disabled={!relatoriosConcluidos}
                  title={!relatoriosConcluidos ? 'Gere o Laudo de Viabilidade para liberar' : ''}
                  style={{ padding:'11px 18px', background: !relatoriosConcluidos?'#cbd5e1':'#7c3aed', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor:!relatoriosConcluidos?'default':'pointer', display:'inline-flex', alignItems:'center', gap:8 }}>
                  <Calendar size={15}/> Agendar reunião com analista
                </button>
                {!relatoriosConcluidos && <div style={{ fontSize:11, color:'#7c3aed', marginTop:8 }}>Gere os três relatórios (Mercadológico, Documental e Laudo de Viabilidade) para liberar o agendamento.</div>}
              </div>
            </div>
          )}

          {/* ===== RELATÓRIO 3: LAUDO DE VIABILIDADE (AGENTE DE DEFESA) ===== */}
          {relSel === 'laudo' && (
            <div style={{ background:'linear-gradient(135deg,#111827,#334155)', borderRadius:16, padding:'18px 22px', color:'white' }}>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, textTransform:'uppercase', opacity:0.85 }}>Parecer Final · BidPro Brasil</div>
              <div style={{ fontSize:18, fontWeight:900, marginTop:2, display:'flex', alignItems:'center', gap:8 }}><Award size={19}/> Laudo de Viabilidade</div>
              <div style={{ fontSize:12, opacity:0.9, marginTop:4 }}>Consolida o Mercadológico + a Documental num veredito de defesa · {d.nome||'Imóvel'}</div>
            </div>
          )}

          {relSel === 'laudo' && (gerandoLaudo || (laudoEntry?.status === 'gerando')) && (
            <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:16, padding:'28px 22px', display:'flex', flexDirection:'column', alignItems:'center', gap:12, textAlign:'center' }}>
              <Loader2 size={28} color="#111827" style={{ animation:'spin 1s linear infinite' }}/>
              <div style={{ fontSize:15, fontWeight:800, color:'#111' }}>Consolidando o parecer final…</div>
              <div style={{ fontSize:13, color:'#64748b', lineHeight:1.6, maxWidth:460 }}>O agente de defesa está cruzando o relatório mercadológico/financeiro com o documental/jurídico para emitir o veredito. É rápido, não refaz pesquisas nem lê documentos de novo, só sintetiza o que já foi gerado.</div>
            </div>
          )}

          {relSel === 'laudo' && laudoEntry?.result?.precisaRelatorios && (
            <div style={{ background:'#fffbeb', border:'2px solid #fde68a', borderRadius:16, padding:'22px', display:'flex', gap:14, alignItems:'flex-start' }}>
              <AlertTriangle size={22} color="#d97706" style={{ flexShrink:0, marginTop:2 }}/>
              <div>
                <div style={{ fontSize:14, fontWeight:900, color:'#92400e', marginBottom:4 }}>Gere os dois relatórios antes do laudo</div>
                <div style={{ fontSize:13, color:'#b45309', lineHeight:1.6 }}>{laudoEntry.result.motivo || 'O laudo de viabilidade é uma síntese, precisa do Mercadológico e da Documental prontos.'}</div>
              </div>
            </div>
          )}

          {relSel === 'laudo' && relLaudoGerado && laudoEntry?.result && (() => {
            const L = laudoEntry.result;
            const vMap = {
              aprovado:    { txt:'APROVADO, VIÁVEL', bg:'#dcfce7', bd:'#86efac', cor:'#15803d', ic:'✓' },
              condicional: { txt:'CONDICIONAL, VIÁVEL COM RESSALVAS', bg:'#fef3c7', bd:'#fde68a', cor:'#92400e', ic:'!' },
              reprovado:   { txt:'REPROVADO, NÃO RECOMENDADO', bg:'#fee2e2', bd:'#fca5a5', cor:'#b91c1c', ic:'✗' },
            };
            const v = vMap[L.veredito] || vMap.condicional;
            const bloco = (titulo, itens, cor) => (Array.isArray(itens) && itens.length) ? (
              <div style={{ marginTop:14 }}>
                <div style={{ fontSize:12, fontWeight:800, color:cor, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>{titulo}</div>
                <ul style={{ margin:0, paddingLeft:18, display:'flex', flexDirection:'column', gap:4 }}>
                  {itens.map((it,i)=><li key={i} style={{ fontSize:13, color:'#334155', lineHeight:1.6 }}>{it}</li>)}
                </ul>
              </div>
            ) : null;
            return (
              <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:16, padding:'22px' }}>
                <div style={{ background:v.bg, border:`2px solid ${v.bd}`, borderRadius:12, padding:'14px 16px', textAlign:'center' }}>
                  <div style={{ fontSize:16, fontWeight:900, color:v.cor }}>{v.ic} VEREDITO: {v.txt}</div>
                  {L.resumoExecutivo && <div style={{ fontSize:13, color:v.cor, marginTop:6, lineHeight:1.6 }}>{L.resumoExecutivo}</div>}
                </div>
                {bloco('Pontos fortes', L.pontosFortes, '#15803d')}
                {bloco('Pontos de atenção', L.pontosDeAtencao, '#92400e')}
                {bloco('Condições para aprovação', L.condicoes, '#b45309')}
                {bloco('Diligências pendentes (confirmar antes do lance)', L.diligenciasPendentes, '#0369a1')}
                {L.controleQualidade && (() => {
                  const q = L.controleQualidade;
                  const barra = (label, v) => (
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <div style={{ width:110, fontSize:11, fontWeight:700, color:'#475569' }}>{label}</div>
                      <div style={{ flex:1, height:7, background:'#e2e8f0', borderRadius:20, overflow:'hidden' }}>
                        <div style={{ width:`${Math.max(0,Math.min(100,v||0))}%`, height:'100%', background: (v||0)>=70?'#16a34a':(v||0)>=50?'#d97706':'#dc2626', borderRadius:20 }}/>
                      </div>
                      <div style={{ width:38, textAlign:'right', fontSize:11, color:'#64748b' }}>{v!=null?`${v}%`:'—'}</div>
                    </div>
                  );
                  return (
                    <div style={{ marginTop:16, padding:'12px 14px', border:'1px solid #e2e8f0', borderRadius:12, background:'#f8fafc' }}>
                      <div style={{ fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8, display:'flex', alignItems:'center', gap:8 }}>
                        Controle de qualidade dos relatórios
                        {q.recomendaRevisao && <span style={{ fontSize:10, fontWeight:800, color:'#b91c1c', background:'#fee2e2', padding:'2px 8px', borderRadius:20 }}>Revisar antes do lance</span>}
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                        {barra('Mercadológico', q.confiancaMercadologico)}
                        {barra('Documental', q.confiancaDocumental)}
                      </div>
                      {bloco('Contradições encontradas', q.contradicoes, '#b91c1c')}
                      {bloco('Lacunas críticas', q.lacunasCriticas, '#92400e')}
                    </div>
                  );
                })()}
                {L.parecer && (
                  <div style={{ marginTop:16, paddingTop:14, borderTop:'1px solid #f1f5f9' }}>
                    <div style={{ fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Parecer de defesa</div>
                    {/* § SEÇÃO vira tópicos titulados. O LEMBRETE (aviso legal) sai daqui e vai como
                        rodapé, para o "Resumo da Operação" ser o fecho do relatório. */}
                    {String(L.parecer).split(/§\s*SEÇÃO:/i).map(s => s.trim()).filter(Boolean)
                      .filter(sec => !/^LEMBRETE/i.test(sec))
                      .map((sec, i) => {
                        const nl = sec.indexOf('\n');
                        const titulo = (nl < 0 ? sec : sec.slice(0, nl)).trim();
                        const corpo = (nl < 0 ? '' : sec.slice(nl)).trim();
                        return (
                          <div key={i} style={{ marginBottom:12 }}>
                            <div style={{ fontSize:11.5, fontWeight:800, color:'#111827', textTransform:'uppercase', letterSpacing:0.5, marginBottom:3 }}>{titulo}</div>
                            {corpo && <div style={{ fontSize:13, color:'#334155', lineHeight:1.75, whiteSpace:'pre-wrap' }}>{corpo}</div>}
                          </div>
                        );
                      })}
                  </div>
                )}
                {Array.isArray(L.resumoOperacao) && L.resumoOperacao.length > 0 && (
                  <div style={{ marginTop:16, padding:'14px 16px', border:'2px solid #111827', borderRadius:12, background:'#f8fafc' }}>
                    <div style={{ fontSize:12, fontWeight:900, color:'#111827', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Resumo da Operação</div>
                    <ul style={{ margin:0, paddingLeft:18, display:'flex', flexDirection:'column', gap:5 }}>
                      {L.resumoOperacao.map((it,i)=><li key={i} style={{ fontSize:13, color:'#1e293b', lineHeight:1.65, fontWeight:600 }}>{it}</li>)}
                    </ul>
                  </div>
                )}
                <div style={{ marginTop:12, fontSize:11, color:'#94a3b8', lineHeight:1.5 }}>
                  Documento de apoio à decisão, gerado com apoio de inteligência artificial a partir dos relatórios Mercadológico e Documental. Não substitui a análise de um profissional nem a vistoria do imóvel. Valide o veredito com um analista BidPro antes de qualquer lance.
                </div>
                <button onClick={() => gerarLaudoPDF({ imovel: d, laudo: L, cab: cabPDF })}
                  style={{ marginTop:16, width:'100%', padding:'13px', background:'#111827', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                  <Printer size={16}/> Baixar Parecer Final em PDF
                </button>
                <button onClick={sinalizarArremate}
                  disabled={arrematadoSinalizado || sinalizandoArremate}
                  title="Confirmo que arrematei este imóvel — mantém os documentos guardados"
                  style={{ marginTop:10, width:'100%', padding:'12px', background: arrematadoSinalizado ? '#ecfdf5' : 'white', color:'#059669', border:'1.5px solid #a7f3d0', borderRadius:12, fontWeight:800, fontSize:14, cursor: arrematadoSinalizado ? 'default' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                  <Award size={16}/> {arrematadoSinalizado ? 'Arremate confirmado ✓' : (sinalizandoArremate ? 'Enviando…' : 'Arrematei este imóvel')}
                </button>
              </div>
            );
          })()}

          {relSel === 'documental' && isStaffAnalise && modoManual && !relDocumentalGerado && (<>

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
                // ERA AQUI o crash de 30/07: `String.fromCharCode(...new Uint8Array(buf))`
                // espalhava cada byte do PDF como argumento e estourava a pilha ("Maximum call
                // stack size exceeded") — a aba morria sem mensagem nenhuma. Agora usa o mesmo
                // conversor em blocos do resto do app, e a falha vira aviso em vez de tela morta.
                try {
                  if (f.type === 'application/pdf') {
                    const b64 = await arquivoParaBase64(f);
                    const ext = await extrairDadosDocumento('', b64).catch(() => null);
                    if (ext?.observacoes) setTextoMatricula(ext.observacoes);
                    else setTextoMatricula(`[PDF matrícula: ${f.name}]`);
                  } else { setTextoMatricula(await f.text()); }
                } catch (err) {
                  showMsg('Não consegui ler esse arquivo de matrícula. Tente um PDF menor ou cole o texto.', 'error');
                  reportarErroCliente({ msg: `upload matrícula: ${err?.message || err}`, stack: err?.stack });
                }
              }} style={{display:'none'}}/>
            </label>
          </div>
        </Section>
      )}

      </>)}
      {/* Formulários manuais (CNJ, certidões, dados/custos editáveis) só aparecem se a
          equipe LIGAR "Incluir URL / arquivos" (modoManual) — para leiloeiro não
          integrado ou refino. Por padrão é 1 clique: a IA lê os docs e consulta o CNJ
          e as certidões no servidor, sem tela intermediária. */}
      {relSel === 'documental' && isStaffAnalise && modoManual && !relDocumentalGerado && (<>

      {/* ── ETAPA 1C: CONSULTA JURÍDICA CNJ, apenas roles com CNJ ── */}
      {!temCNJ && (
        <div style={{ padding:'12px 16px', borderRadius:10, background:'#f8fafc', border:'1px solid #e2e8f0', fontSize:13, color:'#64748b', display:'flex', alignItems:'center', gap:10, marginBottom:8 }}>
          <Lock size={15} color="#94a3b8"/>
          <span>Consulta Jurídica CNJ disponível a partir do plano <strong>Investidor Pro</strong>.</span>
          <button onClick={() => nav('/planos')} style={{ marginLeft:'auto', padding:'5px 12px', background:'#0D63DB', color:'white', border:'none', borderRadius:7, fontWeight:700, fontSize:12, cursor:'pointer' }}>Ver planos</button>
        </div>
      )}
      {temCNJ && <Section step="1C" title="Consulta Jurídica, CNJ DataJud" icon={Scale} color="#dc2626"
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
              <strong>DataJud, CNJ:</strong> Busca o processo diretamente no tribunal do estado informado na Etapa 2. Penhoras e arrestos são adicionados automaticamente como riscos jurídicos.
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
                        {proc.classe}{proc.assuntos ? `, ${proc.assuntos}` : ''} · Fase: <strong>{proc.fase}</strong>
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
              Certidões Fiscais, CPF ou CNPJ do Executado
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
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Dívida Ativa, PGFN</div>
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
                <Field label="Nome / Referência" name="nome" value={d.nome||''} onChange={upN} ph="Ex: Apt 302 Torre Norte, Rua das Flores"/>
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
                  (judicial E extrajudicial), NÃO é sucumbência. Editável; entra nos
                  aportes e na viabilidade. */}
              <Field label="Honorários BidPro / êxito (%)" name="honorariosPercentual"
                value={d.honorariosPercentual != null ? d.honorariosPercentual : 10}
                onChange={upN} type="number"/>
              {/* Taxa administrativa do leilão (% além do leiloeiro, comum na Superbid)
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

          {/* Riscos jurídicos: NÃO se digita mais. A análise Documental + Processo lê
              os documentos e consulta as integrações (CNJ + certidões) e preenche os
              riscos sozinha — basta gerar o relatório. Mantemos só as notas de visita. */}
          <div>
            <Field label="Observações / Notas de Visita (opcional)" name="observacoes" value={d.observacoes||''} onChange={upN} type="textarea" rows={3} ph="Anotações de visita, pontos de atenção, potencial de negociação..."/>
          </div>
          {/* Lançamentos financeiros NÃO pertencem à análise (que é de ORIENTAÇÃO).
              O lançamento real acontece no fluxo de ACOMPANHAMENTO pós-arrematação
              (tela do Caso/Guia). Removido daqui para não confundir. */}
        </div>
      </Section>

      </>)}

      {relSel === 'mercado' && (
        <div style={{ background:'linear-gradient(135deg,#0B48A6,#0D63DB)', borderRadius:16, padding:'18px 22px', color:'white' }}>
          <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, textTransform:'uppercase', opacity:0.85 }}>Relatório · BidPro Brasil</div>
          <div style={{ fontSize:18, fontWeight:900, marginTop:2 }}>Mercadológico e Viabilidade Financeira</div>
          <div style={{ fontSize:12, opacity:0.9, marginTop:4 }}>{d.nome||'Imóvel'}{[d.cidade,d.estado].filter(Boolean).length ? ` · ${[d.cidade,d.estado].filter(Boolean).join(', ')}` : ''}{descontoPrincipal>0 ? ` · Desconto ${fmtPct(descontoPrincipal)}${descontoPrincipalVsMercado ? ' vs mercado' : ''}` : ''}</div>
        </div>
      )}
      {relSel === 'mercado' && (<>

      <div style={{ display:'flex', flexDirection:'column', gap:14, marginTop:14 }}>
        {/* ── VALORES DE REFERÊNCIA (topo): avaliação do leilão + lance mínimo da
             praça + venda estimada no mercado. Os 3 números que o leigo compara. ── */}
        {(() => {
          const area = Number(d.areaM2) || Number(d.areaTerrenoM2) || 0;
          const pm2 = Number(mercado?.precoMedioM2) || 0;
          const valorMedia = pm2 && area ? Math.round(pm2 * area) : (Number(d.valorMercado) || 0);
          const sugerido = Number(d.valorMercado) || (valorMedia ? Math.round(valorMedia * 0.9) : 0);
          const vAval = Number(d.valorAvaliacao) || 0;
          const vArr = Number(d.valorArrematacao) || 0;
          if (!valorMedia && !sugerido && !vAval && !vArr) return null;
          const descAval = vAval > 0 && vArr > 0 ? (1 - vArr / vAval) * 100 : 0;
          // Quantas amostras de VENDA compõem o preço médio (transparência do tíquete)
          // e quanto a venda estimada fica abaixo dessa média (cálculo explícito).
          const nAmostras = ((mercado?.nivel1?.vendas?.length || 0) + (mercado?.nivel2?.vendas?.length || 0))
            || Number(mercado?.totalAmostrasVenda) || (mercado?.vendas?.length || 0)
            || ((mercado?.nivel1?.totalAmostras || 0) + (mercado?.nivel2?.totalAmostras || 0));
          const descSugerido = valorMedia > 0 && sugerido > 0 ? Math.round((1 - sugerido / valorMedia) * 100) : 0;
          const card = { background:'rgba(255,255,255,0.12)', borderRadius:12, padding:'12px 14px' };
          const rot = { fontSize:10, opacity:0.85, fontWeight:700, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4 };
          const num = { fontSize:22, fontWeight:900 };
          const sub = { fontSize:10, opacity:0.8, marginTop:2, lineHeight:1.4 };
          return (
            <div style={{ background:'linear-gradient(135deg,#0B48A6,#0D63DB)', borderRadius:16, padding: isMobile?'16px':'18px 22px', color:'white' }}>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, textTransform:'uppercase', opacity:0.85, marginBottom:10 }}>Valores de referência</div>
              <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr':'repeat(3,1fr)', gap:12 }}>
                <div style={card}>
                  <div style={rot}>Avaliação do leilão</div>
                  <div style={num}>{vAval>0 ? `R$ ${fmt(vAval)}` : 'Não informada'}</div>
                  <div style={sub}>{vAval>0 ? 'valor que o leilão atribuiu ao imóvel' : 'o leilão não divulgou avaliação; a análise usa o valor de mercado'}</div>
                </div>
                <div style={card}>
                  <div style={rot}>Lance mínimo (praça atual)</div>
                  <div style={num}>{vArr>0 ? `R$ ${fmt(vArr)}` : '—'}</div>
                  <div style={sub}>{descAval>0 ? `${fmtPct(descAval)} abaixo da avaliação` : 'ponto de partida do lance'}</div>
                </div>
                <div style={{ ...card, background:'rgba(167,243,208,0.18)' }}>
                  <div style={rot}>Venda estimada no mercado</div>
                  <div style={{ ...num, color:'#a7f3d0' }}>{sugerido>0 ? `R$ ${fmt(sugerido)}` : '—'}</div>
                  <div style={sub}>quanto tende a vender no mercado (conservador)</div>
                </div>
              </div>
              {areaSuspeita ? (
                <div style={{ fontSize:10.5, marginTop:10, lineHeight:1.5, background:'rgba(250,204,21,0.16)', border:'1px solid rgba(250,204,21,0.55)', borderRadius:8, padding:'8px 10px' }}>
                  ⚠️ A área informada ({fmt(area)} m²) parece ser a área <strong>total/terreno</strong>, não a privativa: os comparáveis (R$ {fmt(pm2)}/m²) indicam cerca de <strong>{fmt(areaPrivativaImplicita)} m²</strong> privativos. Informe a <strong>Área Privativa (m²)</strong> do edital para estimar o mercado por comparáveis. Enquanto isso, a análise usa a <strong>avaliação do leilão</strong> como referência (não multiplicamos o R$/m² pela área total).
                </div>
              ) : mercado?.fonteEstimativa === 'indice_bidpro' ? (
                <div style={{ fontSize:10.5, opacity:0.85, marginTop:10, lineHeight:1.5 }}>
                  Base de mercado: <strong>Índice BidPro</strong> (base própria da região) — sem anúncios comparáveis ativos no momento; a conta de comparáveis não se aplica.
                </div>
              ) : mercado?.consolidado?.baseCalculo ? (
                <div style={{ fontSize:10.5, opacity:0.85, marginTop:10, lineHeight:1.5 }}>
                  Base de mercado ({(mercado?.consolidado?.unidadeValor || '').replace(/_/g,' ') || 'por tipo'}): {mercado.consolidado.baseCalculo}.{nAmostras > 0 ? ` Média de ${nAmostras} comparáve${nAmostras > 1 ? 'is' : 'l'} do mesmo tipo/região.` : ''} Valor conservador para revenda em prazo saudável.
                </div>
              ) : valorMedia>0 && (
                <div style={{ fontSize:10.5, opacity:0.8, marginTop:10, lineHeight:1.5 }}>
                  Base de mercado: {pm2 && area ? `R$ ${fmt(pm2)}/m² × ${fmt(area)} m² = R$ ${fmt(valorMedia)}` : `R$ ${fmt(valorMedia)}`}{nAmostras > 0 ? ` — média de ${nAmostras} anúncio${nAmostras > 1 ? 's' : ''} comparáve${nAmostras > 1 ? 'is' : 'l'} (mesmo condomínio/endereço + raio de ~1 km)` : ' (média dos anúncios)'}.{descSugerido > 0 ? ` A venda estimada (R$ ${fmt(sugerido)}) fica ${descSugerido}% abaixo dessa média — margem conservadora para revenda em prazo saudável.` : ' A venda estimada aplica margem conservadora para revenda em prazo saudável.'}
                </div>
              )}
            </div>
          );
        })()}
        {/* ── CONDIÇÕES LIDAS NO EDITAL (extrato determinístico do servidor): praças com
            valores/datas + forma de pagamento, direto do DOCUMENTO do lote. ── */}
        {(mercado?.condicoesEdital && ((mercado.condicoesEdital.pracas || []).some(p => p.valor > 0 || p.data) || mercado.condicoesEdital.formaPagamento)) && (() => {
          const ce = mercado.condicoesEdital;
          const pr = (ce.pracas || []).filter(p => p.valor > 0 || p.data);
          const dataBr = (d) => (d ? String(d).split('-').reverse().join('/') : null);
          return (
            <div style={{ background:'#f0f9ff', border:'1px solid #bae6fd', borderRadius:14, padding:'14px 18px' }}>
              <div style={{ fontSize:11, fontWeight:800, letterSpacing:1, textTransform:'uppercase', color:'#0369a1', marginBottom:8 }}>Condições lidas no edital</div>
              {pr.length > 0 && (
                <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom: ce.formaPagamento ? 8 : 0 }}>
                  {pr.map(p => (
                    <div key={p.n} style={{ fontSize:13, color:'#0c4a6e' }}>
                      <strong>{p.n}ª praça:</strong> {p.valor > 0 ? `R$ ${fmt(p.valor)}` : 'valor no edital'}{p.data ? ` · ${dataBr(p.data)}` : ''}
                    </div>
                  ))}
                </div>
              )}
              {ce.formaPagamento && (
                <div style={{ fontSize:12, color:'#0c4a6e', lineHeight:1.55 }}><strong>Pagamento (edital):</strong> {ce.formaPagamento}</div>
              )}
              <div style={{ fontSize:10.5, color:'#64748b', marginTop:8 }}>Extraído automaticamente do edital do lote — confirme no documento antes do lance{ce.fonte ? <> (<a href={ce.fonte} target="_blank" rel="noreferrer" style={{ color:'#0369a1' }}>abrir edital</a>)</> : null}.</div>
            </div>
          );
        })()}
        {/* ── CAPA / RESUMO PARA LEIGOS: veredito + 3 números + próximo passo ── */}
        <div style={{ background:'white', borderRadius:16, border:'1px solid #e2e8f0', padding: isMobile?'16px':'20px 22px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            {isUsoProprio ? <CheckCircle2 size={22} color="#10b981"/> : (mercadoSemDados ? <AlertTriangle size={22} color="#f59e0b"/> : (isViavel ? <CheckCircle2 size={22} color="#10b981"/> : <XCircle size={22} color="#ef4444"/>))}
            <span style={{ fontSize:16, fontWeight:900, color: mercadoSemDados ? '#92400e' : (isViavel?'#065f46':'#b91c1c') }}>
              {isUsoProprio ? 'Aprovado para uso próprio' : (mercadoSemDados ? 'Mercado não estimado nesta análise' : (isViavel ? 'Operação viável, vale avançar' : 'Operação reprovada, retorno insuficiente'))}
            </span>
          </div>
          {mercadoSemDados && (
            <div style={{ fontSize:12.5, lineHeight:1.6, color:'#92400e', background:'#fffbeb', border:'1px solid #fde68a', borderRadius:10, padding:'10px 12px', marginBottom:14 }}>
              A pesquisa de mercado <strong>não retornou amostras desta vez</strong> (fonte instável no momento). <strong>Não consumimos sua cota</strong> e o sistema vai <strong>tentar de novo automaticamente</strong> (a cada poucas horas, por até 48h) — quando preencher, aparece aqui sozinho. Se preferir na hora, <strong>gere novamente</strong> (grátis) ou informe o valor de mercado. Os indicadores de retorno (ROI/TIR) ficam indisponíveis até haver estimativa — <strong>não é uma reprovação da operação</strong>.
            </div>
          )}
          <div style={{ display:'grid', gridTemplateColumns: isMobile?'1fr':'repeat(3,1fr)', gap:10 }}>
            {[
              [areaSuspeita ? 'Desconto vs. avaliação' : 'Desconto vs. mercado', d.valorMercado>0 ? fmtPct((1-(d.valorArrematacao||0)/d.valorMercado)*100) : '—', '#0D63DB'],
              [isAVista?'Retorno (ROI)':'Retorno (ROE)', mercadoSemDados ? '—' : fmtPct(metricas.roi), mercadoSemDados ? '#94a3b8' : (metricas.roi>=0?'#10b981':'#ef4444')],
              ['Rentabilidade anual (TIR)', indicadores.tir!=null ? fmtPct(indicadores.tir)+' a.a.' : '—', '#7c3aed'],
            ].map(([l,v,c])=>(
              <div key={l} style={{ background:'#f8fafc', borderRadius:12, padding:'12px 14px', textAlign:'center', border:'1px solid #e2e8f0' }}>
                <div style={{ fontSize:9, color:'#64748b', fontWeight:800, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>{l}</div>
                <div style={{ fontSize:20, fontWeight:900, color:c }}>{v}</div>
              </div>
            ))}
          </div>
          {(() => {
            const okStyle = mercadoSemDados
              ? { bg:'#fffbeb', bd:'#fde68a', fg:'#92400e' }
              : (isViavel ? { bg:'#f0fdf4', bd:'#bbf7d0', fg:'#15803d' } : { bg:'#fef2f2', bd:'#fecaca', fg:'#991b1b' });
            const txt = mercadoSemDados
              ? 'O sistema já vai tentar de novo automaticamente (por até 48h, sem consumir sua cota) para obter a estimativa de mercado e os indicadores de retorno. Se preferir na hora, gere novamente (grátis) ou informe o valor de mercado manualmente.'
              : (isUsoProprio
                ? 'Imóvel adequado ao uso próprio pelo preço analisado. Confirme os documentos com o time.'
                : (isViavel
                  ? 'Os números fecham acima da meta. Agende a reunião com o analista para validar e seguir com a documentação.'
                  : 'Pelo lance analisado, o retorno fica abaixo da meta. Reveja o valor do lance (veja o teto adiante) ou avalie outro imóvel.'));
            return (
              <div style={{ marginTop:14, padding:'12px 14px', background:okStyle.bg, border:`1px solid ${okStyle.bd}`, borderRadius:12, fontSize:13, color:okStyle.fg, lineHeight:1.6 }}>
                <strong>Próximo passo:</strong> {txt}
              </div>
            );
          })()}
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

      {/* Item 2 — CORREÇÃO COM IMPACTO: a leitura dos documentos (documental) achou dado que
          corrige o mercadológico já gerado. Informa o impacto e OFERECE regerar (dono pediu). */}
      {Array.isArray(correcoesMercado) && correcoesMercado.length > 0 && (
        <div style={{ background:'#fffbeb', border:'1px solid #fcd34d', borderRadius:12, padding:'14px 16px', marginBottom:14 }}>
          <div style={{ fontSize:13, fontWeight:800, color:'#92400e', marginBottom:6 }}>
            ⚠️ A leitura dos documentos corrigiu dados que impactam a Avaliação Mercadológica
          </div>
          <ul style={{ margin:'6px 0 10px', paddingLeft:18, fontSize:12.5, color:'#78350f', lineHeight:1.6 }}>
            {correcoesMercado.map((c, i) => (
              <li key={i}><strong style={{textTransform:'capitalize'}}>{c.campo}:</strong> {c.de} → <strong>{c.para}</strong>. {c.impacto}</li>
            ))}
          </ul>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button onClick={() => {
              const cs = correcoesMercado || [];
              // Monta o override ANTES: o mesmo objeto vai para o estado e para a pesquisa,
              // então a regeração usa exatamente os dados corrigidos (não os do render atual).
              const corr = {};
              for (const c of cs) {
                if (c.campo === 'cidade') { const m = String(c.para).match(/(.+?)[\/,]\s*([A-Za-z]{2})\s*$/); if (m) { corr.cidade = m[1].trim(); corr.estado = m[2].toUpperCase(); } }
                if (c.campo === 'metragem') { const n = parseFloat(String(c.para).replace(/[^0-9,.]/g,'').replace(/\./g,'').replace(',', '.')); if (n>0) corr.areaM2 = n; }
              }
              setD(p => ({ ...p, ...corr }));
              setCorrecoesMercado(null);
              analisarMercadoClick(corr);
            }} style={{ padding:'8px 14px', background:'#d97706', color:'white', border:'none', borderRadius:8, fontWeight:800, fontSize:12.5, cursor:'pointer' }}>
              Corrigir e regerar a avaliação
            </button>
            <button onClick={() => setCorrecoesMercado(null)} style={{ padding:'8px 14px', background:'transparent', color:'#92400e', border:'1px solid #fcd34d', borderRadius:8, fontWeight:700, fontSize:12.5, cursor:'pointer' }}>
              Manter como está
            </button>
          </div>
        </div>
      )}

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

          <button onClick={() => analisarMercadoClick()} disabled={loadMercado}
            style={{ width:'100%', padding:'13px', background:loadMercado?'#6ee7b7':'#10b981', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
            {loadMercado ? <><Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/> Pesquisando amostras no mercado...</> : <><BarChart3 size={16}/> {mercado ? 'Atualizar Pesquisa de Mercado' : 'Iniciar Avaliação Mercadológica com IA'}</>}
          </button>

          {mercado && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

              {/* ═══════════ BANDA 1 — RESUMO: para que serve + números-chave ═══════════ */}
              <BandaMercado n={1} titulo="Resumo" sub="para que serve e números-chave" cor="#0D63DB" />

              {/* Classificação por objetivo — para QUE o imóvel é bom (Revenda / Locação / Temporada) */}
              {mercado.classificacaoIntencao?.algum && (() => {
                const c = mercado.classificacaoIntencao;
                const chips = [
                  c.revenda && ['🔁 Revenda', c.motivos?.revenda, '#0D63DB', '#eff6ff'],
                  c.locacao && ['🏠 Locação', c.motivos?.locacao, '#7c3aed', '#f5f3ff'],
                  c.temporada && ['🏖️ Temporada', c.motivos?.temporada, '#0891b2', '#ecfeff'],
                ].filter(Boolean);
                return (
                  <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, padding:'12px 16px' }}>
                    <div style={{ fontSize:11, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Indicado para</div>
                    <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : `repeat(${chips.length},1fr)`, gap:8 }}>
                      {chips.map(([label, motivo, cor, bg]) => (
                        <div key={label} style={{ background:bg, border:`1px solid ${cor}30`, borderRadius:10, padding:'10px 12px' }}>
                          <div style={{ fontSize:13, fontWeight:800, color:cor }}>{label}</div>
                          {motivo && <div style={{ fontSize:11, color:'#475569', marginTop:3, lineHeight:1.45 }}>{motivo}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {mercado.fonteEstimativa === 'indice_bidpro' && (
                <div style={{ fontSize:12.5, lineHeight:1.6, color:'#3730a3', background:'#eef2ff', border:'1px solid #c7d2fe', borderRadius:10, padding:'10px 12px', marginBottom:12 }}>
                  <strong>Referência: Índice BidPro.</strong> Não havia anúncios comparáveis ativos nesta localidade no momento, então a estimativa de mercado usa o <strong>Índice BidPro</strong> (nossa base própria da região) como referência. Serve para saber se o valor é atrativo; assim que surgirem comparáveis ativos, o sistema atualiza automaticamente.
                </div>
              )}

              {/* KPIs consolidados */}
              <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:10 }}>
                {[
                  [mercado.fonteEstimativa === 'indice_bidpro' ? 'Preço/m² (Índice BidPro)' : 'Preço Médio/m²', `R$ ${fmt(mercado.precoMedioM2||0)}`, '#0D63DB','#eff6ff'],
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

              {/* ═══════════ BANDA 2 — REFERÊNCIAS DE PREÇO: validação cruzada ═══════════ */}
              {(mercado.referenciaFipeZap?.encontrado || (mercado.indiceBidPro && (Number(mercado.indiceBidPro.venda_m2) > 0 || Number(mercado.indiceBidPro.aluguel_m2) > 0))) && (
                <BandaMercado n={2} titulo="Referências de preço" sub="FipeZAP + Índice BidPro (validação cruzada)" cor="#4f46e5" />
              )}

              {/* Validação FipeZAP, média dos anúncios × índice independente */}
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

              {/* Índice BidPro — nossa base própria de mercado por microrregião (venda + locação) */}
              {mercado.indiceBidPro && (Number(mercado.indiceBidPro.venda_m2) > 0 || Number(mercado.indiceBidPro.aluguel_m2) > 0) && (() => {
                const ib = mercado.indiceBidPro;
                const nivelLabel = ib.nivel === 'bairro' ? `bairro ${ib.bairro_norm || ''}`.trim()
                  : ib.nivel === 'grid' ? 'microrregião (~1 km)'
                  : ib.nivel === 'estado' ? 'estado (referência ampla)' : 'cidade';
                const yieldIdx = (Number(ib.venda_m2) > 0 && Number(ib.aluguel_m2) > 0) ? (Number(ib.aluguel_m2) * 12 / Number(ib.venda_m2) * 100) : 0;
                return (
                  <div style={{ borderRadius:12, border:'1px solid #c7d2fe', background:'#eef2ff', padding:'12px 16px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                      <Award size={14} color="#4f46e5"/>
                      <span style={{ fontSize:12, fontWeight:800, color:'#111' }}>Índice BidPro (nossa base)</span>
                      <span style={{ fontSize:10.5, color:'#64748b' }}>{nivelLabel} · {ib.n_amostras || 0} amostras</span>
                      <span style={{ marginLeft:'auto', fontSize:10, fontWeight:700, padding:'2px 8px', borderRadius:999, background:'#e0e7ff', color:'#3730a3' }}>{ib.fonte === 'relatorio' ? 'consolidado dos relatórios' : 'base do acervo'}</span>
                    </div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8, fontSize:12 }}>
                      <div><div style={{ color:'#94a3b8', fontSize:10, fontWeight:700 }}>VENDA R$/m²</div><div style={{ fontWeight:800, color:'#4f46e5' }}>{Number(ib.venda_m2) > 0 ? `R$ ${fmt(ib.venda_m2)}` : '—'}</div></div>
                      <div><div style={{ color:'#94a3b8', fontSize:10, fontWeight:700 }}>LOCAÇÃO R$/m²/mês</div><div style={{ fontWeight:800, color:'#7c3aed' }}>{Number(ib.aluguel_m2) > 0 ? `R$ ${fmt(ib.aluguel_m2)}` : 'em formação'}</div></div>
                      <div><div style={{ color:'#94a3b8', fontSize:10, fontWeight:700 }}>YIELD ÍNDICE</div><div style={{ fontWeight:800, color:'#059669' }}>{yieldIdx > 0 ? fmtPct(yieldIdx)+' a.a.' : '—'}</div></div>
                    </div>
                    <div style={{ fontSize:10.5, color:'#6366f1', marginTop:8, lineHeight:1.5 }}>Índice proprietário BidPro (nível {nivelLabel}), referência independente para <strong>venda</strong> e <strong>locação</strong>, consolidada das análises da plataforma (complementar ao FipeZAP e aos anúncios). O aluguel é semeado à medida que os relatórios da região são gerados.</div>
                  </div>
                );
              })()}

              {/* Composição por período (4 meses) + frescor: valor recente OU projetado p/ hoje pela curva */}
              {mercado.indiceComposicao && Array.isArray(mercado.indiceComposicao.periodos) && mercado.indiceComposicao.periodos.length >= 1 && (() => {
                const comp = mercado.indiceComposicao;
                return (
                  <div style={{ borderRadius:12, border:'1px solid #c7d2fe', background:'#f8faff', padding:'12px 16px' }}>
                    {mercado.avisoFrescor && (
                      <div style={{ display:'flex', gap:8, alignItems:'flex-start', marginBottom:10, padding:'8px 12px', borderRadius:8, background:'#fff7ed', border:'1px solid #fed7aa' }}>
                        <span style={{ fontSize:14, lineHeight:1 }}>⏳</span>
                        <span style={{ fontSize:11, color:'#9a3412', lineHeight:1.5 }}>{mercado.avisoFrescor}</span>
                      </div>
                    )}
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap' }}>
                      <span style={{ fontSize:12, fontWeight:800, color:'#111' }}>Composição por período (venda R$/m²)</span>
                      <span style={{ fontSize:10.5, color:'#64748b' }}>a cada 4 meses · {comp.total_anuncios || 0} anúncio(s) · {comp.n_recentes || 0} recente(s)</span>
                      {comp.projetado && <span style={{ marginLeft:'auto', fontSize:10, fontWeight:800, padding:'2px 8px', borderRadius:999, background:'#fff7ed', color:'#c2410c' }}>VALOR PROJETADO</span>}
                    </div>
                    <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                      {comp.periodos.slice(-6).map((p, i) => (
                        <div key={i} style={{ flex:'1 1 90px', minWidth:90, background:'white', borderRadius:8, padding:'8px 10px', border:'1px solid #eef2f7' }}>
                          <div style={{ fontSize:10, color:'#64748b' }}>{p.label}</div>
                          <div style={{ fontSize:14, fontWeight:800, color:'#0f172a' }}>{Number(p.m2) > 0 ? `R$ ${fmt(p.m2)}` : '—'}</div>
                          <div title={p.fora_padrao ? 'Período com poucas amostras no padrão — valor usa a referência da região' : undefined}
                            style={{ fontSize:9.5, color: p.fora_padrao ? '#c2410c' : '#94a3b8' }}>
                            {p.n} anúncio(s){p.fora_padrao ? ' · ref. região' : ''}
                          </div>
                        </div>
                      ))}
                    </div>
                    {comp.taxa_aa != null && <div style={{ fontSize:10.5, color:'#6366f1', marginTop:8, lineHeight:1.5 }}>Valorização estimada da região: ~{comp.taxa_aa}% a.a. (curva do Índice BidPro).{comp.projetado ? ' O valor de mercado exibido é projetado para hoje a partir dos anúncios de períodos anteriores.' : ''}</div>}
                  </div>
                );
              })()}

              {/* Valorização BidPro — curva de preço/m² por ano (base própria de amostras datadas) */}
              {Array.isArray(mercado.valorizacao?.serie) && mercado.valorizacao.serie.length >= 2 && (() => {
                const vz = mercado.valorizacao;
                const serie = vz.serie;
                const max = Math.max(...serie.map(p => Number(p.m2) || 0)) || 1;
                const pos = Number(vz.valorizacao_periodo_pct) >= 0;
                return (
                  <div style={{ borderRadius:12, border:'1px solid #bbf7d0', background:'#f0fdf4', padding:'12px 16px' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap' }}>
                      <TrendingUp size={14} color="#059669"/>
                      <span style={{ fontSize:12, fontWeight:800, color:'#111' }}>Valorização BidPro (venda R$/m²)</span>
                      <span style={{ fontSize:10.5, color:'#64748b' }}>{vz.ano_inicial}–{vz.ano_final} · base própria</span>
                      <span style={{ marginLeft:'auto', fontSize:11, fontWeight:800, padding:'2px 10px', borderRadius:999, background: pos ? '#dcfce7' : '#fee2e2', color: pos ? '#166534' : '#991b1b' }}>
                        {pos ? '+' : ''}{Number(vz.valorizacao_periodo_pct).toFixed(1)}% no período · {Number(vz.valorizacao_aa_pct).toFixed(1)}% a.a.
                      </span>
                    </div>
                    <div style={{ display:'flex', alignItems:'flex-end', gap:10, height:96, padding:'0 4px' }}>
                      {serie.map(p => {
                        const h = Math.max(6, Math.round((Number(p.m2) / max) * 72));
                        return (
                          <div key={p.ano} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4, justifyContent:'flex-end', height:'100%' }}>
                            <div style={{ fontSize:10, fontWeight:800, color:'#065f46' }}>R$ {fmt(p.m2)}</div>
                            <div title={`${p.n} amostras`} style={{ width:'100%', maxWidth:46, height:h, borderRadius:'6px 6px 0 0', background:'linear-gradient(180deg,#34d399,#059669)' }} />
                            <div style={{ fontSize:10.5, fontWeight:700, color:'#334155' }}>{p.ano}</div>
                            <div style={{ fontSize:9, color:'#94a3b8' }}>{p.n} am.</div>
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize:10.5, color:'#047857', marginTop:8, lineHeight:1.5 }}>Mediana do preço/m² dos <strong>anúncios de venda</strong> por ano na base BidPro da região — leitura de <strong>tendência</strong> (anos com poucas amostras têm menos precisão). Não inclui preços de leilão/arremate.</div>
                  </div>
                );
              })()}

              {/* PADRÃO DO IMÓVEL — popular/médio/alto (comparar SEMELHANTE com SEMELHANTE) */}
              {mercado?.consolidado?.padraoImovel && (() => {
                const meta = {
                  popular:    { label: 'Popular / econômico', cor: '#0369a1', bg: '#f0f9ff', bd: '#bae6fd' },
                  medio:      { label: 'Médio',               cor: '#334155', bg: '#f1f5f9', bd: '#e2e8f0' },
                  medio_alto: { label: 'Médio-alto',          cor: '#6d28d9', bg: '#f5f3ff', bd: '#ddd6fe' },
                  alto:       { label: 'Alto padrão',         cor: '#6d28d9', bg: '#f5f3ff', bd: '#ddd6fe' },
                  luxo:       { label: 'Luxo',                cor: '#b45309', bg: '#fffbeb', bd: '#fde68a' },
                }[String(mercado.consolidado.padraoImovel).toLowerCase()];
                if (!meta) return null;
                return (
                  <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', borderRadius:12, border:`1px solid ${meta.bd}`, background:meta.bg, padding:'10px 16px' }}>
                    <Home size={14} color={meta.cor} />
                    <span style={{ fontSize:12, fontWeight:800, color:'#111' }}>Padrão do imóvel</span>
                    <span style={{ fontSize:11, fontWeight:800, padding:'2px 10px', borderRadius:999, background:'#fff', border:`1px solid ${meta.cor}`, color:meta.cor }}>{meta.label}</span>
                    <span style={{ fontSize:10.5, color:'#64748b', flexBasis:'100%' }}>A avaliação compara SÓ imóveis do mesmo padrão (semelhante com semelhante): dentro do mesmo tipo e cidade, o padrão altera o R$/m² em várias vezes.</span>
                  </div>
                );
              })()}

              {/* PERFIL DA REGIÃO — atratividade e valorização (explica o R$/m² da microrregião) */}
              {mercado.perfilRegiao && (mercado.perfilRegiao.tier || mercado.perfilRegiao.motivos || (mercado.perfilRegiao.atratividades || []).filter(Boolean).length > 0) && (() => {
                const pr = mercado.perfilRegiao;
                const tierLabel = { valorizado_alto: 'Região valorizada', intermediario: 'Região intermediária', valorizado_baixo: 'Região menos valorizada' }[pr.tier] || '';
                const tierColor = { valorizado_alto: '#059669', intermediario: '#d97706', valorizado_baixo: '#dc2626' }[pr.tier] || '#0D63DB';
                const atr = (pr.atratividades || []).filter(Boolean);
                const fra = (pr.fragilidades || []).filter(Boolean);
                return (
                  <div style={{ borderRadius: 12, border: '1px solid #dbeafe', background: '#f8fafc', padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                      <MapPin size={14} color={tierColor} />
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>Perfil da região (atratividade e valorização)</span>
                      {tierLabel && <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 999, background: '#fff', border: `1px solid ${tierColor}`, color: tierColor }}>{tierLabel}</span>}
                    </div>
                    {pr.motivos && <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.6, marginBottom: (atr.length || fra.length) ? 8 : 0 }}>{pr.motivos}</div>}
                    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 10 }}>
                      {atr.length > 0 && <div><div style={{ fontSize: 10, fontWeight: 800, color: '#059669', textTransform: 'uppercase', marginBottom: 4 }}>Atratividades</div><ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: '#334155', lineHeight: 1.6 }}>{atr.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
                      {fra.length > 0 && <div><div style={{ fontSize: 10, fontWeight: 800, color: '#dc2626', textTransform: 'uppercase', marginBottom: 4 }}>Fragilidades</div><ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: '#334155', lineHeight: 1.6 }}>{fra.map((a, i) => <li key={i}>{a}</li>)}</ul></div>}
                    </div>
                  </div>
                );
              })()}

              {/* SEGURANÇA PÚBLICA — dados OFICIAIS, factual (não rótulo subjetivo) */}
              {mercado.segurancaPublica && (mercado.segurancaPublica.encontrado || mercado.segurancaPublica.recomendacao) && (() => {
                const sp = mercado.segurancaPublica;
                return (
                  <div style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff', padding: '12px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
                      <ShieldAlert size={14} color="#64748b" />
                      <span style={{ fontSize: 12, fontWeight: 800, color: '#111' }}>Segurança pública da região (dados oficiais)</span>
                      {sp.periodo && <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#94a3b8' }}>{sp.periodo}</span>}
                    </div>
                    {sp.encontrado ? (
                      <div style={{ fontSize: 12, color: '#334155', lineHeight: 1.6 }}>
                        {sp.nivel && <div><strong>Nível:</strong> {sp.nivel}</div>}
                        {sp.indicadores && <div>{sp.indicadores}</div>}
                        {sp.tendencia && <div><strong>Tendência:</strong> {sp.tendencia}</div>}
                        {sp.fonte && <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 4 }}>Fonte: {sp.fonte}</div>}
                      </div>
                    ) : (
                      <div style={{ fontSize: 11.5, color: '#64748b', lineHeight: 1.6 }}>Sem indicador oficial confiável para a microrregião. {sp.recomendacao || 'Recomenda-se diligência local (visita ao local e consulta de ocorrências da região).'}</div>
                    )}
                  </div>
                );
              })()}

              {/* ═══════════ BANDA 3 — AMOSTRAS E COMPARATIVOS (recolhível) ═══════════ */}
              {/* A "muita informação" ficava aberta o tempo todo e poluía. Agora as amostras
                  brutas vêm num <details> fechado por padrão — o resumo/refs ficam à vista e
                  quem quer o detalhe expande. As tabelas continuam idênticas. */}
              <details style={{ border:'1px solid #e2e8f0', borderRadius:12, overflow:'hidden' }}>
                <summary style={{ cursor:'pointer', listStyle:'none', padding:'12px 16px', background:'#f8fafc', display:'flex', alignItems:'center', gap:10, fontSize:12.5, fontWeight:800, color:'#0f172a' }}>
                  <span style={{ width:22, height:22, borderRadius:7, background:'#10b981', color:'white', display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:900, flexShrink:0 }}>3</span>
                  <span style={{ textTransform:'uppercase', letterSpacing:0.5 }}>Amostras e comparativos</span>
                  <span style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>· Nível 1: {mercado.nivel1?.totalAmostras||0} · Nível 2: {mercado.nivel2?.totalAmostras||0} amostras</span>
                  <span style={{ marginLeft:'auto', fontSize:11, color:'#0D63DB', fontWeight:700 }}>ver detalhes ▾</span>
                </summary>
                <div style={{ display:'flex', flexDirection:'column', gap:14, padding:'14px' }}>

              {/* Nível 1, Mesmo Condomínio */}
              <div style={{ borderRadius:12, border:'2px solid #0D63DB', overflow:'hidden' }}>
                <div style={{ background:'#0D63DB', padding:'10px 16px', display:'flex', alignItems:'center', gap:8 }}>
                  <Building2 size={15} color="white"/>
                  <span style={{ fontWeight:800, color:'white', fontSize:13 }}>Comparativos diretos, mesmo condomínio / endereço (raio ~250 m)</span>
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
                      <div style={{ fontSize:11, fontWeight:700, color:'#0D63DB', textTransform:'uppercase', marginBottom:8 }}>Venda, {mercado.nivel1.vendas.length} imóveis</div>
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
                      <div style={{ fontSize:11, fontWeight:700, color:'#8b5cf6', textTransform:'uppercase', marginBottom:8 }}>Locação, {mercado.nivel1.locacoes.length} imóveis</div>
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

              {/* Nível 2, Vizinhança */}
              <div style={{ borderRadius:12, border:'2px solid #10b981', overflow:'hidden' }}>
                <div style={{ background:'#10b981', padding:'10px 16px', display:'flex', alignItems:'center', gap:8 }}>
                  <MapPin size={15} color="white"/>
                  <span style={{ fontWeight:800, color:'white', fontSize:13 }}>Vizinhança, bairro e adjacências (~1 km)</span>
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
                      <div style={{ fontSize:11, fontWeight:700, color:'#10b981', textTransform:'uppercase', marginBottom:8 }}>Venda, {mercado.nivel2.vendas.length} imóveis</div>
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
                      <div style={{ fontSize:11, fontWeight:700, color:'#8b5cf6', textTransform:'uppercase', marginBottom:8 }}>Locação, {mercado.nivel2.locacoes.length} imóveis</div>
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

                </div>
              </details>

              {/* ═══════════ BANDA 4 — METODOLOGIA E OBSERVAÇÕES ═══════════ */}
              <BandaMercado n={4} titulo="Metodologia e observações" sub="datas, fontes e ressalvas" cor="#64748b" />

              {/* Datas do relatório: quando foi gerado e quando expira (removido se não arrematado) */}
              {(() => {
                const ent = analiseEntry;
                const fmtD = (ms) => ms ? new Date(ms).toLocaleDateString('pt-BR') : null;
                const dl = ent?.dataLeilao || imovelInicial?.dataLeilao || d.dataLeilao;
                const dlMs = dl && !isNaN(Date.parse(dl)) ? Date.parse(dl) : null;
                // Gerado: usa updatedAt do relatório; se faltar (ex.: cache antigo), cai no
                // pesquisaEm do próprio resultado (sempre presente) e por fim no startedAt.
                const geradoMs = ent?.updatedAt
                  || (mercado?.pesquisaEm && !isNaN(Date.parse(mercado.pesquisaEm)) ? Date.parse(mercado.pesquisaEm) : null)
                  || ent?.startedAt || null;
                const baseCriacao = ent?.startedAt || geradoMs;
                // Regra do cron: 15 dias após o leilão (se há data) OU 60 dias após a criação.
                const expMs = dlMs ? dlMs + 15 * 864e5 : (baseCriacao ? baseCriacao + 60 * 864e5 : null);
                if (!geradoMs && !expMs) return null; // sem nada a mostrar (não deixa "—" vazio)
                return (
                  <div style={{ display:'flex', flexWrap:'wrap', gap:10, alignItems:'center', fontSize:11.5, color:'#64748b', background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'8px 14px' }}>
                    {geradoMs && <span>🗓️ Gerado em <strong style={{ color:'#334155' }}>{fmtD(geradoMs)}</strong></span>}
                    {expMs && <span>· ⏳ Expira em <strong style={{ color:'#334155' }}>{fmtD(expMs)}</strong> <span style={{ color:'#94a3b8' }}>({dlMs ? '15 dias após o leilão' : '60 dias'}, se não arrematado)</span></span>}
                  </div>
                );
              })()}

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

          {/* Cenários de disputa, Sem disputa vs Com disputa (piso de 30% de lucro) */}
          {!isUsoProprio && d.valorArrematacao > 0 && d.valorMercado > 0 && (() => {
            const cd = cenariosDisputa;
            const pisoOk = cd.tetoBest > cd.lanceBase;
            // Só mostra o cenário "com disputa" quando ele é REAL: o teto que
            // preserva o piso de lucro precisa estar ACIMA do lance base (mínimo).
            // Um teto abaixo do lance mínimo é impossível (não se dá lance abaixo
            // do mínimo) — então não exibimos esse card irreal.
            const cards = [
              { tag:'SEM DISPUTA', cor:'#10b981', bg:'#f0fdf4', lance:cd.lanceBase, m:cd.semDisputa, nota:'Arremata pelo lance base' },
              ...(pisoOk ? [{ tag:'COM DISPUTA, PIOR CASO', cor:'#f59e0b', bg:'#fef3c7', lance:cd.tetoBest, m:cd.comDisputa, nota:`Piso de ${PISO_LUCRO}% de lucro líquido` }] : []),
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
                      ? <><strong>Validação:</strong> mesmo numa disputa, dá para cobrir até <strong>R$ {fmt(cd.tetoBest)}</strong> mantendo o piso de {PISO_LUCRO}% de lucro líquido. Acima desse lance, a operação deixa de compensar, é o limite para parar de dar lances.</>
                      : <><strong>Atenção:</strong> no lance base o retorno já está abaixo de {PISO_LUCRO}%. Não há margem para disputa, só compensa abaixo de <strong>R$ {fmt(cd.tetoBest)}</strong>.</>}
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
                  {isViavel ? (isUsoProprio?'Aprovado para Uso Próprio':'Operação Viável, Aprovada pela BidPro Brasil') : 'Operação Reprovada, Retorno Insuficiente'}
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

          {/* Resumo de caixa: quanto ter AO ARREMATAR × quanto suportar POR MÊS × despesas NA VENDA */}
          <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr' : (isUsoProprio ? 'repeat(2,1fr)' : 'repeat(3,1fr)'), gap:12 }}>
            <div style={{ background:'#fff7ed', border:'1px solid #fed7aa', borderRadius:14, padding:'16px 18px' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'#c2410c', textTransform:'uppercase', letterSpacing:0.5 }}>1 · Disponível ao arrematar</div>
              <div style={{ fontSize:23, fontWeight:900, color:'#9a3412', margin:'6px 0 4px' }}>R$ {fmt(metricas.desembolsoInicial)}</div>
              <div style={{ fontSize:12, color:'#9a3412' }}>{isAVista ? 'Lance + custos, pagos à vista na arrematação' : `Sinal (${d.sinalPercentual||0}%) + custos iniciais (leiloeiro, honorários, ITBI…)`}</div>
            </div>
            <div style={{ background:'#eff6ff', border:'1px solid #bfdbfe', borderRadius:14, padding:'16px 18px' }}>
              <div style={{ fontSize:11, fontWeight:800, color:'#1d4ed8', textTransform:'uppercase', letterSpacing:0.5 }}>2 · Custo mensal a suportar</div>
              <div style={{ fontSize:23, fontWeight:900, color:'#1e3a8a', margin:'6px 0 4px' }}>R$ {fmt(metricas.parcelaMedia + metricas.carregoMensal)}<span style={{ fontSize:13, fontWeight:700 }}> /mês</span></div>
              <div style={{ fontSize:12, color:'#1e3a8a' }}>
                {metricas.parcelaMedia>0 ? `Parcela do banco ~R$ ${fmt(metricas.parcelaMedia)}` : 'Sem parcela (à vista)'}
                {metricas.carregoMensal>0 ? ` + IPTU/cond. R$ ${fmt(metricas.carregoMensal)}` : ''} · projeção {metricas.mesesCarregados} meses
              </div>
            </div>
            {!isUsoProprio && (
              <div style={{ background:'#fef2f2', border:'1px solid #fecaca', borderRadius:14, padding:'16px 18px' }}>
                <div style={{ fontSize:11, fontWeight:800, color:'#b91c1c', textTransform:'uppercase', letterSpacing:0.5 }}>3 · Despesas ao vender</div>
                <div style={{ fontSize:23, fontWeight:900, color:'#991b1b', margin:'6px 0 4px' }}>R$ {fmt(metricas.custoVenda)}</div>
                <div style={{ fontSize:12, color:'#991b1b' }}>Comissão 5% + IR sobre ganho de capital{metricas.saldoDevedor>0 ? ' + quitação do saldo do banco' : ''}</div>
              </div>
            )}
          </div>

          {/* Cenário alternativo: LOCAÇÃO (segurar e alugar em vez de vender) */}
          {metricas.aluguelMensal>0 && (() => {
            const custoMensal = metricas.parcelaMedia + metricas.carregoMensal;
            const cobertura = custoMensal>0 ? (metricas.aluguelMensal / custoMensal) * 100 : 100;
            const liquidoMensal = metricas.aluguelMensal - custoMensal;
            return (
              <div style={{ background:'#f5f3ff', border:'1px solid #ddd6fe', borderRadius:14, padding:'16px 20px' }}>
                <div style={{ fontSize:11, fontWeight:800, color:'#6d28d9', textTransform:'uppercase', letterSpacing:0.5, marginBottom:10 }}>Cenário alternativo · Locação (segurar e alugar, sem vender)</div>
                <div style={{ display:'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4,1fr)', gap:12 }}>
                  <div><div style={{ fontSize:11, color:'#7c3aed', fontWeight:700 }}>Aluguel mensal</div><div style={{ fontSize:18, fontWeight:900, color:'#5b21b6' }}>R$ {fmt(metricas.aluguelMensal)}</div></div>
                  <div><div style={{ fontSize:11, color:'#7c3aed', fontWeight:700 }}>Cobre do custo mensal</div><div style={{ fontSize:18, fontWeight:900, color: cobertura>=100?'#059669':'#5b21b6' }}>{fmtPct(cobertura,0)}</div></div>
                  <div><div style={{ fontSize:11, color:'#7c3aed', fontWeight:700 }}>Resultado mensal</div><div style={{ fontSize:18, fontWeight:900, color: liquidoMensal>=0?'#059669':'#dc2626' }}>{liquidoMensal>=0?'+ ':'- '}R$ {fmt(Math.abs(liquidoMensal))}</div></div>
                  <div><div style={{ fontSize:11, color:'#7c3aed', fontWeight:700 }}>Yield anual</div><div style={{ fontSize:18, fontWeight:900, color:'#5b21b6' }}>{fmtPct(metricas.yieldAnual)}</div></div>
                </div>
                <div style={{ fontSize:11.5, color:'#6d28d9', marginTop:10, lineHeight:1.6 }}>
                  Alugando, o aluguel cobre {cobertura>=100?'integralmente':'parcialmente'} a parcela + carrego. <strong>Não incidem</strong> IR de ganho de capital nem comissão de corretor sobre venda — só os custos de locação (IPTU/condomínio e eventual taxa de administração). {cobertura<100 ? `Faltam R$ ${fmt(custoMensal-metricas.aluguelMensal)}/mês de aporte até o aluguel cobrir tudo.` : 'O imóvel se paga sozinho no mês.'}
                </div>
              </div>
            );
          })()}

          {/* Tabela financeira detalhada */}
          <div style={{ borderRadius:12, border:'1px solid #e2e8f0', overflow:'hidden' }}>
            <div style={{ background:'#111111', padding:'12px 18px' }}>
              <div style={{ fontSize:13, fontWeight:800, color:'white' }}>Detalhamento Financeiro, Lance sem disputa vs com disputa</div>
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
                    !isAVista && metricas.parcelasPagas>0 && [`Parcelas Banco (projeção ${metricas.mesesCarregados} meses)`, metricas.parcelasPagas, metricasTeto.parcelasPagas],
                    (d.iptuMensal>0||d.condominioMensal>0) && [`Carrego IPTU/Cond. (${metricas.mesesCarregados} meses)`, metricas.custoCarrrego, metricasTeto.custoCarrrego],
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

      {/* Laudo/defesa (texto longo) saiu daqui: agora é o 3º relatório (Laudo de Viabilidade). O Mercadológico fica só com os números. */}

      {/* PRÓXIMO PASSO, destaque ao fim do Mercadológico: seguir para o Documental */}
      <div style={{ background:'#fff7ed', border:'2px solid #fdba74', borderRadius:16, padding:'18px 20px', display:'flex', gap:14, alignItems:'flex-start' }}>
        <ShieldAlert size={22} color="#ea580c" style={{ flexShrink:0, marginTop:2 }}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:900, color:'#9a3412', marginBottom:4 }}>Próximo passo para uma decisão segura</div>
          <div style={{ fontSize:12.5, color:'#7c2d12', lineHeight:1.7, marginBottom:12 }}>
            Arrematar em leilão é uma <strong>operação de risco</strong> e deve ser conduzida de forma profissional. A viabilidade financeira sozinha não basta: gere também a <strong>Análise Documental + Jurídica</strong> (ônus, gravames, ocupação e processo) antes de dar o lance.
          </div>
          {ROLES_SEM_DOCUMENTAL.includes(role) ? (
            <button onClick={() => setUpgrade({ tipo:'plano', titulo:'Análise Documental + Jurídica' })} style={{ padding:'11px 18px', background:'#1e3a8a', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:13, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:8 }}>
              <Lock size={15}/> Análise Documental, disponível no Investidor Pro
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

      {/* Guia Pós-Arrematação, Financiamento e registro ONR foram movidos para o
          ACOMPANHAMENTO (tela do Caso), o pós-arremate não pertence à análise de
          orientação. Lá aparecem num botão fixo + popup após sinalizar o arremate. */}

        </div>{/* fim central */}
      </div>{/* fim grid 2 colunas */}

      {/* Popup de compra (passo 5): upgrade para o Investidor Pro quando o cliente esbarra
          num relatório bloqueado por plano ou por cota. Abre no lugar, sem tirar o cliente da
          análise. O CTA usa o fluxo de assinatura existente (/planos); quando o checkout do
          passo 7 estiver pronto, é só repontar aqui. */}
      {upgrade && (
        <div onClick={() => setUpgrade(null)}
          style={{ position:'fixed', inset:0, background:'rgba(15,23,42,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'white', borderRadius:18, width:'100%', maxWidth:440, overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ background:'linear-gradient(135deg,#0D63DB,#084BA6)', padding:'22px 24px', color:'white' }}>
              <div style={{ display:'inline-flex', alignItems:'center', gap:8, background:'rgba(255,255,255,0.18)', borderRadius:20, padding:'4px 12px', fontSize:11, fontWeight:800, letterSpacing:0.5, textTransform:'uppercase' }}>
                <Sparkles size={13}/> Investidor Pro
              </div>
              <div style={{ fontSize:20, fontWeight:900, marginTop:12, lineHeight:1.2 }}>
                {upgrade.tipo === 'cota' ? 'Você usou suas análises do mês' : 'Desbloqueie a análise completa'}
              </div>
              <div style={{ fontSize:13, opacity:0.92, marginTop:6, lineHeight:1.55 }}>
                {upgrade.tipo === 'cota'
                  ? `Você atingiu o limite de ${limiteRole} análises mensais. Assine o Investidor Pro e continue analisando com folga.`
                  : `${upgrade.titulo ? `"${upgrade.titulo}" faz parte do ` : 'Faz parte do '}Investidor Pro: a leitura jurídica e o parecer final que decidem o lance com segurança.`}
              </div>
            </div>
            <div style={{ padding:'20px 24px' }}>
              <div style={{ fontSize:12, fontWeight:800, color:'#64748b', textTransform:'uppercase', letterSpacing:0.5, marginBottom:10 }}>O que você desbloqueia</div>
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  ['⚖️','Análise Documental + Jurídica','Edital e matrícula lidos (ônus, gravames, ocupação) mais o processo no CNJ e as certidões.'],
                  ['🏆','Laudo de Viabilidade (Parecer Final)','O veredito de defesa que cruza mercado e jurídico, com o resumo da operação.'],
                  ['📊','Mais análises por mês','Volume de relatórios mercadológicos folgado para investir sem travar.'],
                ].map(([ic,t,ds],i) => (
                  <div key={i} style={{ display:'flex', gap:10, alignItems:'flex-start' }}>
                    <span style={{ fontSize:18, flexShrink:0 }}>{ic}</span>
                    <div>
                      <div style={{ fontSize:13.5, fontWeight:800, color:'#111' }}>{t}</div>
                      <div style={{ fontSize:12, color:'#64748b', lineHeight:1.5 }}>{ds}</div>
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => { setUpgrade(null); nav('/planos'); }}
                style={{ width:'100%', marginTop:18, padding:'13px', background:'#0D63DB', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:15, cursor:'pointer' }}>
                Assinar o Investidor Pro →
              </button>
              <button onClick={() => setUpgrade(null)}
                style={{ width:'100%', marginTop:8, padding:'10px', background:'none', color:'#94a3b8', border:'none', fontSize:13, fontWeight:600, cursor:'pointer' }}>
                Agora não
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}
