import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  FileText, Loader2, CheckCircle2, AlertTriangle,
  BarChart3, TrendingUp, ShieldAlert, Gavel, DollarSign, Download,
  Calendar, Video, MessageSquare, ChevronDown, ChevronUp,
  Lock, ExternalLink,
  Check, Send, ClipboardList, Save, Upload, Sparkles, Scale,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { useIsMobile } from '../utils/useIsMobile';
import AgendarReuniao from '../components/AgendarReuniao';

// ─── Estilos base ────────────────────────────────────────────────────────────
const card = { background:'white', borderRadius:16, border:'1px solid #e2e8f0', padding:'20px 22px', boxShadow:'0 1px 4px rgba(0,0,0,0.04)' };
const inp = { width:'100%', padding:'9px 11px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, background:'white', color:'#111111', boxSizing:'border-box' };
const lbl = { fontSize:10, fontWeight:700, color:'#64748b', display:'block', marginBottom:5, textTransform:'uppercase', letterSpacing:0.5 };
const btn = (color='#0D63DB') => ({ padding:'10px 20px', background:color, color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:13, cursor:'pointer' });

const fmt = (v) => v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 }) : '—';
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const mesRef = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0,10); };

// ─── Cotas por plano ─────────────────────────────────────────────────────────
// mercado = relatórios mercadológico + viabilidade financeira
// documental = relatórios análise documental e jurídica
// O analista pode conceder +2 de cada tipo manualmente (extras_mercado / extras_documental)
const COTAS_PLANO = {
  explorador: { mercado:5,   documental:0,  reunioes:0 },
  top2:       { mercado:15,  documental:15, reunioes:2 },
  assessorado:{ mercado:15,  documental:15, reunioes:2 },
  clube:      { mercado:15,  documental:15, reunioes:4 },
  analista:   { mercado:999, documental:999, reunioes:999 },
  advogado:   { mercado:999, documental:999, reunioes:999 },
  admin:      { mercado:999, documental:999, reunioes:999 },
  consultor:  { mercado:999, documental:999, reunioes:999 },
};

const PLANOS_JURIDICO = ['assessorado','clube','analista','advogado','admin'];

const TIPOS_ANALISE = [
  { tipo:'mercadologica',      label:'Análise de Mercado',        icon:BarChart3,    desc:'Avaliação de valor de mercado, comparativos e tendências regionais' },
  { tipo:'financeira',         label:'Viabilidade Financeira',    icon:TrendingUp,   desc:'ROI, teto de lance, cenários de revenda e locação' },
  { tipo:'fluxo_caixa',        label:'Fluxo de Caixa 12 meses',  icon:DollarSign,   desc:'Projeção mensal de receitas e despesas pós-arrematação' },
  { tipo:'juridica_preliminar',label:'Viabilidade Jurídica Prévia', icon:ShieldAlert, desc:'Consulta CNJ, débitos, ônus e riscos jurídicos identificados' },
];

const STATUS_ETAPA_LABEL = {
  analise_solicitada:'Análise Solicitada', analises_prontas:'Relatórios Prontos',
  reuniao_agendada:'Reunião Agendada', reuniao_realizada:'Reunião Realizada',
  juridico_solicitado:'Jurídico Solicitado', juridico_concluido:'Parecer Jurídico Pronto',
  segunda_reuniao:'2ª Reunião Agendada', arrematado:'Imóvel Arrematado',
  honorarios_pagos:'Honorários Pagos', procuracao_assinada:'Procuração Assinada',
  pos_arrematacao:'Pós-Arrematação',
};

const STATUS_JOB_COLOR = { aguardando:'#f59e0b', processando:'#3b82f6', concluido:'#10b981', falha_parcial:'#f59e0b', falha:'#ef4444' };
const STATUS_JOB_LABEL = { aguardando:'Aguardando', processando:'Processando', concluido:'Concluído', falha_parcial:'Atenção', falha:'Falha' };

const RISCO_COLOR = { baixo:'#10b981', medio:'#f59e0b', alto:'#ef4444' };
const PARECER_COLOR = { recomendo:'#10b981', recomendo_ressalvas:'#f59e0b', nao_recomendo:'#ef4444' };
const PARECER_LABEL = { recomendo:'Recomendo', recomendo_ressalvas:'Recomendo com Ressalvas', nao_recomendo:'Não Recomendo' };

// ─── Badge ───────────────────────────────────────────────────────────────────
function Badge({ label, color='#64748b', bg='#f1f5f9' }) {
  return <span style={{ fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:20, background:bg, color, display:'inline-block' }}>{label}</span>;
}

// ─── Timeline de etapas ───────────────────────────────────────────────────────
function EtapaTimeline({ status }) {
  const etapas = [
    'analise_solicitada','analises_prontas','reuniao_agendada','reuniao_realizada',
    'juridico_solicitado','juridico_concluido','segunda_reuniao','arrematado',
    'honorarios_pagos','procuracao_assinada','pos_arrematacao'
  ];
  const idx = etapas.indexOf(status);
  return (
    <div style={{ display:'flex', gap:4, alignItems:'center', flexWrap:'wrap' }}>
      {etapas.map((e, i) => (
        <React.Fragment key={e}>
          <div style={{
            width:10, height:10, borderRadius:'50%',
            background: i < idx ? '#10b981' : i === idx ? '#0D63DB' : '#e2e8f0',
            flexShrink:0,
            title: STATUS_ETAPA_LABEL[e],
          }} title={STATUS_ETAPA_LABEL[e]} />
          {i < etapas.length-1 && <div style={{ flex:1, minWidth:4, height:2, background: i < idx ? '#10b981' : '#e2e8f0' }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─── Card de análise ──────────────────────────────────────────────────────────
function AnaliseCard({ info, job, relatorio, onSolicitar, solicitando, podeSolicitar }) {
  const [open, setOpen] = useState(false);
  const Icon = info.icon;

  const statusColor = job ? STATUS_JOB_COLOR[job.status] : '#94a3b8';
  const statusLabel = job ? STATUS_JOB_LABEL[job.status] : 'Não solicitada';

  return (
    <div style={{ ...card, padding:'16px 18px' }}>
      <div style={{ display:'flex', alignItems:'flex-start', gap:12 }}>
        <div style={{ width:38, height:38, borderRadius:10, background: job?.status==='concluido' ? '#ecfdf5' : '#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <Icon size={18} color={job?.status==='concluido' ? '#10b981' : '#64748b'} />
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
            <span style={{ fontWeight:800, fontSize:14, color:'#111111' }}>{info.label}</span>
            <Badge label={statusLabel} color={statusColor} bg={statusColor+'18'} />
            {job?.status === 'concluido' && relatorio && (
              <button onClick={() => setOpen(o=>!o)} style={{ background:'none', border:'none', color:'#0D63DB', fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
                {open ? 'Ocultar' : 'Ver relatório'} {open ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
              </button>
            )}
          </div>
          <div style={{ fontSize:12, color:'#64748b', marginTop:3 }}>{info.desc}</div>
          {job && job.status !== 'concluido' && (
            <div style={{ fontSize:11, color:'#94a3b8', marginTop:4 }}>
              {job.status === 'aguardando' && 'Na fila — prazo de 48h para conclusão'}
              {job.status === 'processando' && 'Analisando dados...'}
              {job.status === 'falha' && `Erro: ${job.erro_msg || 'Falha no processamento'}`}
              {job.status === 'falha_parcial' && 'Concluído com informações parciais'}
            </div>
          )}
        </div>
        {!job && podeSolicitar && (
          <button onClick={onSolicitar} disabled={solicitando} style={{ ...btn(), fontSize:12, padding:'7px 14px', flexShrink:0, opacity: solicitando?0.6:1 }}>
            {solicitando ? <Loader2 size={13} style={{animation:'spin 1s linear infinite'}}/> : 'Solicitar'}
          </button>
        )}
        {!job && !podeSolicitar && (
          <div style={{ display:'flex', alignItems:'center', gap:4, color:'#94a3b8', fontSize:11 }}>
            <Lock size={12}/>Cota esgotada
          </div>
        )}
      </div>
      {open && relatorio && (
        <div style={{ marginTop:16, padding:'14px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0' }}>
          <div style={{ fontSize:12, color:'#475569', lineHeight:1.7, whiteSpace:'pre-wrap' }}>
            {relatorio.conteudo_md}
          </div>
          {relatorio.incompleto && (
            <div style={{ marginTop:10, padding:'8px 12px', background:'#fef3c7', borderRadius:8, fontSize:11, color:'#92400e' }}>
              <AlertTriangle size={12} style={{marginRight:4,verticalAlign:'middle'}}/> Relatório parcial — algumas seções não puderam ser obtidas.
            </div>
          )}
          <button onClick={() => window.print()} style={{ ...btn('#64748b'), fontSize:11, padding:'6px 12px', marginTop:10 }}>
            <Download size={12} style={{marginRight:5,verticalAlign:'middle'}}/>Imprimir / Salvar PDF
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Análise jurídica automática (IA) — apenas equipe ─────────────────────────
const scoreColor = (s) => s >= 70 ? '#10b981' : s >= 40 ? '#f59e0b' : '#ef4444';

function ScorePill({ label, valor }) {
  if (valor == null) return null;
  const c = scoreColor(valor);
  return (
    <div style={{ padding:'8px 14px', borderRadius:10, background:c+'18', border:`1px solid ${c}40`, minWidth:120 }}>
      <div style={{ fontSize:10, fontWeight:700, color:'#64748b', marginBottom:2 }}>{label}</div>
      <div style={{ fontSize:20, fontWeight:900, color:c }}>{valor}<span style={{ fontSize:11, color:'#94a3b8', fontWeight:700 }}> /100</span></div>
    </div>
  );
}

// Linha de upload de um documento (matrícula ou edital)
function DocUploadRow({ tipo, label, anexo, enviando, onArquivo }) {
  const ref = useRef(null);
  const aceitos = 'application/pdf,image/png,image/jpeg';
  return (
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 12px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0' }}>
      <div style={{ width:30, height:30, borderRadius:8, background: anexo ? '#ecfdf5' : '#eef2f7', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
        {anexo ? <CheckCircle2 size={15} color="#10b981"/> : <FileText size={15} color="#94a3b8"/>}
      </div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, color:'#111111' }}>{label}</div>
        <div style={{ fontSize:11, color: anexo ? '#10b981' : '#94a3b8', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          {anexo ? `Anexado: ${anexo.nome}` : 'Nenhum arquivo (PDF, JPG ou PNG)'}
        </div>
      </div>
      <input
        ref={ref} type="file" accept={aceitos} style={{ display:'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onArquivo(tipo, f); e.target.value=''; }}
      />
      <button
        onClick={() => ref.current?.click()}
        disabled={!!enviando}
        style={{ ...btn(anexo ? '#64748b' : '#0D63DB'), fontSize:12, padding:'7px 12px', flexShrink:0, opacity: enviando?0.6:1, display:'flex', alignItems:'center', gap:6 }}
      >
        {enviando === tipo
          ? <Loader2 size={13} style={{ animation:'spin 1s linear infinite' }}/>
          : <Upload size={13}/>}
        {anexo ? 'Substituir' : 'Anexar'}
      </button>
    </div>
  );
}

function AnaliseAutomatica({ casoId, imovelId, relatorioInicial, onConcluido }) {
  const [anexos, setAnexos] = useState([]);
  const [enviando, setEnviando] = useState(null);   // 'matricula' | 'edital' | null
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState('');
  const [res, setRes] = useState(relatorioInicial?.conteudo_json || null);
  const [parecerMd, setParecerMd] = useState(relatorioInicial?.conteudo_md || '');
  const [aberto, setAberto] = useState(false);

  const carregarAnexos = useCallback(async () => {
    if (!imovelId) return;
    const { data } = await supabase.from('imovel_anexos')
      .select('id,tipo,nome,criado_em')
      .eq('imovel_id', imovelId)
      .in('tipo', ['matricula', 'edital']);
    setAnexos(data || []);
  }, [imovelId]);

  useEffect(() => { carregarAnexos(); }, [carregarAnexos]);

  const anexoDe = (tipo) => anexos.find(a => a.tipo === tipo);

  const enviarArquivo = async (tipo, file) => {
    if (!imovelId) { setErro('Imóvel não vinculado ao caso.'); return; }
    setErro(''); setEnviando(tipo);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const fd = new FormData();
      fd.append('file', file);
      fd.append('imovel_id', imovelId);
      fd.append('tipo', tipo);
      const r = await fetch('/api/upload-anexo', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session?.access_token || ''}` },
        body: fd,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Falha no upload do documento.');
      await carregarAnexos();
    } catch (e) {
      setErro(e.message);
    } finally {
      setEnviando(null);
    }
  };

  const gerar = async () => {
    setErro(''); setGerando(true);
    try {
      const r = await apiCall('/api/processar-analise', { method:'POST', body: JSON.stringify({ caso_id: casoId }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Falha ao gerar a análise.');
      setRes(j);
      setParecerMd(j.parecer_md || '');
      setAberto(true);
      onConcluido?.();
    } catch (e) {
      setErro(e.message);
    } finally {
      setGerando(false);
    }
  };

  // Normaliza a resposta da API e o conteudo_json salvo (formatos levemente diferentes)
  const v = res || {};
  const scoreJ = v.score_juridico;
  const scoreF = v.score_financeiro;
  const riscos = Array.isArray(v.riscos) ? v.riscos : [];
  const executadoNome = v.executado?.nome ?? (typeof v.executado === 'string' ? v.executado : null);
  const executadoDoc = v.executado?.cpf_cnpj ?? v.executado_cpf_cnpj ?? null;
  const numeroProcesso = v.numero_processo ?? null;
  const sancoesN = Array.isArray(v.sancoes) ? v.sancoes.length : (v.sancoes_encontradas ?? null);
  const incompleto = v.incompleto;
  const temResultado = scoreJ != null || parecerMd;

  const temMatricula = !!anexoDe('matricula');
  const temEdital = !!anexoDe('edital');
  const temAlgum = temMatricula || temEdital;

  return (
    <div style={{ ...card, padding:'16px 18px', border:'1px solid #c7d2fe', background:'#f5f7ff' }}>
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:4 }}>
        <div style={{ width:34, height:34, borderRadius:9, background:'#eef2ff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <Sparkles size={17} color="#4f46e5"/>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:800, fontSize:14, color:'#111111' }}>Análise jurídica automática (IA)</div>
          <div style={{ fontSize:11.5, color:'#64748b' }}>Equipe — anexe matrícula/edital e gere o parecer com score</div>
        </div>
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:12 }}>
        <DocUploadRow tipo="matricula" label="Matrícula" anexo={anexoDe('matricula')} enviando={enviando} onArquivo={enviarArquivo}/>
        <DocUploadRow tipo="edital" label="Edital" anexo={anexoDe('edital')} enviando={enviando} onArquivo={enviarArquivo}/>
      </div>

      {erro && (
        <div style={{ marginTop:10, padding:'8px 12px', background:'#fef2f2', border:'1px solid #fecaca', borderRadius:8, fontSize:12, color:'#991b1b' }}>
          {erro}
        </div>
      )}

      <button
        onClick={gerar}
        disabled={!temAlgum || gerando}
        style={{ ...btn('#4f46e5'), marginTop:12, width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8, opacity: (!temAlgum || gerando) ? 0.55 : 1, cursor: (!temAlgum || gerando) ? 'not-allowed' : 'pointer' }}
      >
        {gerando ? <Loader2 size={15} style={{ animation:'spin 1s linear infinite' }}/> : <Scale size={15}/>}
        {gerando ? 'Gerando análise...' : (temResultado ? 'Regerar análise' : 'Gerar análise')}
      </button>
      {!temAlgum && (
        <div style={{ fontSize:11, color:'#94a3b8', marginTop:6, textAlign:'center' }}>
          Anexe a matrícula e/ou o edital para liberar a análise.
        </div>
      )}

      {temResultado && (
        <div style={{ marginTop:14, paddingTop:14, borderTop:'1px solid #e2e8f0' }}>
          <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:12 }}>
            <ScorePill label="SCORE JURÍDICO" valor={scoreJ}/>
            <ScorePill label="SCORE FINANCEIRO" valor={scoreF}/>
          </div>

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:12 }}>
            {executadoNome && <div><span style={lbl}>Executado</span><div style={{ fontSize:13, fontWeight:700 }}>{executadoNome}{executadoDoc ? ` · ${executadoDoc}` : ''}</div></div>}
            {numeroProcesso && <div><span style={lbl}>Processo</span><div style={{ fontSize:13, fontWeight:700 }}>{numeroProcesso}</div></div>}
            {sancoesN != null && <div><span style={lbl}>Sanções CEIS/CNEP</span><div style={{ fontSize:13, fontWeight:700, color: sancoesN>0 ? '#ef4444':'#10b981' }}>{sancoesN}</div></div>}
            {riscos.length > 0 && <div><span style={lbl}>Gravames/ônus</span><div style={{ fontSize:13, fontWeight:700, color:'#d97706' }}>{riscos.length}</div></div>}
          </div>

          {riscos.length > 0 && (
            <div style={{ marginBottom:12 }}>
              <span style={lbl}>Riscos identificados</span>
              <ul style={{ margin:'4px 0 0', paddingLeft:18, fontSize:12, color:'#475569', lineHeight:1.6 }}>
                {riscos.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}

          {parecerMd && (
            <div>
              <button onClick={() => setAberto(o => !o)} style={{ background:'none', border:'none', color:'#0D63DB', fontSize:12, fontWeight:700, cursor:'pointer', display:'flex', alignItems:'center', gap:4, padding:0 }}>
                {aberto ? 'Ocultar parecer' : 'Ver parecer completo'} {aberto ? <ChevronUp size={12}/> : <ChevronDown size={12}/>}
              </button>
              {aberto && (
                <div style={{ marginTop:10, padding:'14px', background:'white', borderRadius:10, border:'1px solid #e2e8f0', fontSize:12, color:'#475569', lineHeight:1.7, whiteSpace:'pre-wrap', maxHeight:340, overflow:'auto' }}>
                  {parecerMd}
                </div>
              )}
            </div>
          )}

          {incompleto && (
            <div style={{ marginTop:10, padding:'8px 12px', background:'#fef3c7', borderRadius:8, fontSize:11, color:'#92400e' }}>
              <AlertTriangle size={12} style={{ marginRight:4, verticalAlign:'middle' }}/> Análise parcial — algumas seções não puderam ser obtidas.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Seção colapsável ─────────────────────────────────────────────────────────
function Secao({ title, icon: Icon, color='#0D63DB', open, onToggle, badge, children, disabled }) {
  return (
    <div style={{ ...card, padding:0, overflow:'hidden', opacity: disabled ? 0.5 : 1 }}>
      <button onClick={disabled ? undefined : onToggle} style={{ width:'100%', padding:'16px 20px', border:'none', background:'white', cursor: disabled ? 'default' : 'pointer', display:'flex', alignItems:'center', gap:12, textAlign:'left' }}>
        <div style={{ width:36, height:36, borderRadius:10, background: open ? color : '#f1f5f9', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
          <Icon size={16} color={open ? 'white' : color}/>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:15, fontWeight:800, color: disabled ? '#94a3b8' : '#111111' }}>{title}</div>
          {badge && <div style={{ fontSize:11, color:'#64748b', marginTop:1 }}>{badge}</div>}
        </div>
        {disabled ? <Lock size={14} color="#cbd5e1"/> : open ? <ChevronUp size={15} color="#94a3b8"/> : <ChevronDown size={15} color="#94a3b8"/>}
      </button>
      {open && !disabled && <div style={{ padding:'0 20px 20px', borderTop:'1px solid #f1f5f9' }}>{children}</div>}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function Caso() {
  const { id: casoId } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { user, role } = useAuth();

  const imovelInit = location.state?.imovel;

  // ─── Estados gerais ──────────────────────────────────────────────────────
  const [caso, setCaso] = useState(null);
  const [imovelExtra, setImovelExtra] = useState(null); // data_leilao, titulo, link_leilao
  const [showAgendar, setShowAgendar] = useState(null); // null | 1 | 2
  const [jobs, setJobs] = useState([]);
  const [relatorios, setRelatorios] = useState([]);
  const [reunioes, setReunioes] = useState([]);
  const [juridica, setJuridica] = useState(null);
  const [arrematacao, setArrematacao] = useState(null);
  const [procuracao, setProcuracao] = useState(null);
  const [cota, setCota] = useState(null);

  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');

  // ─── Controles de UI ─────────────────────────────────────────────────────
  const [secOpen, setSecOpen] = useState({ analises:true, reuniao:false, juridico:false, arr:false, proc:false, chat:false });
  const toggleSec = (k) => setSecOpen(p => ({ ...p, [k]:!p[k] }));

  const [solicitando, setSolicitando] = useState({});

  // ─── Chat ────────────────────────────────────────────────────────────────
  const [msgs, setMsgs] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [chamadoId, setChamadoId] = useState(null);
  const chatRef = useRef(null);

  // ─── Arrematação form ─────────────────────────────────────────────────────
  const [arrForm, setArrForm] = useState({ valor_arrematado:'', documento_url:'', tipo_leilao:'judicial', em_nome_proprio:true, beneficiario_nome:'', beneficiario_cpf:'', beneficiario_qualif:'', beneficiario_endereco:'' });
  const [arrFileNome, setArrFileNome] = useState('');
  const [salvandoArr, setSalvandoArr] = useState(false);

  // ─── Honorários ──────────────────────────────────────────────────────────
  const [honorariosConfig, setHonorariosConfig] = useState({ total_pct:10, admin_pct:4.5, advogado_pct:4.5, analista_pct:1 });
  const [monitorExito, setMonitorExito] = useState(null); // distribuição do êxito (só admin)

  // ─── Procuração ──────────────────────────────────────────────────────────
  const [gerandoProc, setGerandoProc] = useState(false);

  const isAnalista = ['analista','admin'].includes(role);
  const isAdvogado = ['advogado','admin'].includes(role);
  const isStaff    = ['analista','advogado','admin','consultor'].includes(role);
  const isCliente  = !isStaff;
  const podeSolicitarJuridico = PLANOS_JURIDICO.includes(role);

  // Monitor do êxito (quem recebe e quanto): só admin, quando há arrematação.
  useEffect(() => {
    if (role !== 'admin' || !arrematacao?.id) { setMonitorExito(null); return; }
    let cancel = false;
    apiCall(`/api/honorarios-split?arrematacao_id=${arrematacao.id}`).then(r => r.json()).then(d => {
      if (!cancel && d && Array.isArray(d.linhas)) setMonitorExito(d);
    }).catch(() => {});
    return () => { cancel = true; };
  }, [role, arrematacao?.id]);

  // ─── Carregar caso ────────────────────────────────────────────────────────
  const carregarCaso = useCallback(async () => {
    if (!user) return;
    try {
      let casoData;
      if (casoId) {
        const { data, error } = await supabase.from('casos').select('*').eq('id', casoId).single();
        if (error) throw error;
        casoData = data;
      } else if (imovelInit) {
        // Verifica se já existe caso para este imovel_id do cliente
        const { data: existente } = await supabase.from('casos')
          .select('*')
          .eq('cliente_id', user.id)
          .eq('imovel_id', imovelInit.id)
          .maybeSingle();
        if (existente) {
          casoData = existente;
          nav(`/caso/${existente.id}`, { replace: true });
        } else {
          // Cria novo caso
          const { data: novo, error: errNovo } = await supabase.from('casos').insert({
            cliente_id: user.id,
            imovel_id: imovelInit.id || null,
            imovel_endereco: [imovelInit.endereco, imovelInit.cidade, imovelInit.estado].filter(Boolean).join(', '),
            imovel_valor: imovelInit.valorMinimo || imovelInit.valorAvaliacao || null,
            status_etapa: 'analise_solicitada',
            tipo_leilao: imovelInit.modalidade === 'judicial' ? 'judicial' : 'extrajudicial',
          }).select().single();
          if (errNovo) throw errNovo;
          casoData = novo;
          nav(`/caso/${novo.id}`, { replace: true });
        }
      } else {
        setErro('Imóvel não especificado.');
        setLoading(false);
        return;
      }

      setCaso(casoData);

      // Carrega dados paralelos
      const [jobsR, relR, reunR, jurR, arrR, procR, cotaR, configHon, imovelR] = await Promise.all([
        supabase.from('analise_jobs').select('*').eq('caso_id', casoData.id),
        supabase.from('analise_relatorios').select('*').eq('caso_id', casoData.id),
        supabase.from('reunioes').select('*').eq('caso_id', casoData.id).order('numero'),
        supabase.from('analise_juridica').select('*').eq('caso_id', casoData.id).maybeSingle(),
        supabase.from('arrematacoes').select('*').eq('caso_id', casoData.id).maybeSingle(),
        supabase.from('procuracoes').select('*').eq('caso_id', casoData.id).order('versao', {ascending:false}).limit(1).maybeSingle(),
        supabase.from('cotas_analise').select('*').eq('usuario_id', user.id).eq('mes_ref', mesRef()).maybeSingle(),
        supabase.from('config_honorarios').select('*').eq('id', 1).maybeSingle(),
        casoData.imovel_id
          ? supabase.from('imoveis').select('data_leilao,titulo,link_leilao').eq('id', casoData.imovel_id).maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      setJobs(jobsR.data || []);
      setRelatorios(relR.data || []);
      setReunioes(reunR.data || []);
      setJuridica(jurR.data || null);
      setArrematacao(arrR.data || null);
      setProcuracao(procR.data || null);
      if (configHon.data) setHonorariosConfig(configHon.data);
      if (imovelR.data) setImovelExtra(imovelR.data);

      // Cota: se não existe, usa defaults do plano
      const planoRole = role || 'explorador';
      const limites = COTAS_PLANO[planoRole] || COTAS_PLANO.explorador;
      if (cotaR.data) {
        setCota(cotaR.data);
      } else {
        setCota({ analises_usadas:0, analises_limite: limites.mercado, reunioes_usadas:0, reunioes_limite: limites.reunioes, extras_analista:0 });
      }

      // Carrega ou cria chamado vinculado ao caso
      let chamado = null;
      const { data: chamadoExist } = await supabase.from('chamados')
        .select('id').eq('caso_id', casoData.id).maybeSingle();
      if (chamadoExist) {
        chamado = chamadoExist;
      } else {
        const { data: novoChamado } = await supabase.from('chamados').insert({
          user_id: casoData.cliente_id,
          caso_id: casoData.id,
          titulo: `Análise: ${casoData.imovel_endereco || 'Imóvel'}`,
          descricao: 'Canal de atendimento vinculado ao fluxo de análise.',
          status: 'em_atendimento',
        }).select('id').single();
        chamado = novoChamado;
      }

      if (chamado) {
        const { data: msgsData } = await supabase.from('chamados_mensagens')
          .select('*, perfis(nome, role)')
          .eq('chamado_id', chamado.id)
          .order('created_at');
        setMsgs((msgsData || []).map(m => ({ ...m, remetente_id: m.user_id, texto: m.mensagem })));
        setChamadoId(chamado.id);
      }

    } catch (e) {
      setErro(e.message);
    } finally {
      setLoading(false);
    }
  }, [casoId, user, role, imovelInit, nav]);

  useEffect(() => { carregarCaso(); }, [carregarCaso]);

  // Scroll chat
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs]);

  // Polling de jobs em processamento
  useEffect(() => {
    if (!caso) return;
    const temAtivos = jobs.some(j => ['aguardando','processando'].includes(j.status));
    if (!temAtivos) return;
    const t = setInterval(() => carregarCaso(), 30000);
    return () => clearInterval(t);
  }, [caso, jobs, carregarCaso]);

  // ─── Solicitar análise ───────────────────────────────────────────────────
  const solicitarAnalise = async (tipo) => {
    if (!caso || !user) return;
    setSolicitando(p => ({ ...p, [tipo]:true }));
    setMsg('');
    try {
      // Verifica cota (staff tem cota ilimitada)
      if (isCliente) {
        const limites = COTAS_PLANO[role] || COTAS_PLANO.explorador;
        const usadas = cota?.analises_usadas || 0;
        const limite = (cota?.analises_limite || limites.mercado) + (cota?.extras_analista || 0);
        if (usadas >= limite) {
          setMsg('Você atingiu o limite de análises do seu plano neste mês.');
          return;
        }
      }

      // Cria job
      const prazoLimite = new Date(Date.now() + 48*60*60*1000).toISOString();
      const { error } = await supabase.from('analise_jobs').upsert({
        caso_id: caso.id,
        tipo,
        status: 'aguardando',
        tentativas: 0,
        max_tentativas: 3,
        prazo_limite_em: prazoLimite,
        input_json: {
          imovel_endereco: caso.imovel_endereco,
          imovel_valor: caso.imovel_valor,
          tipo_leilao: caso.tipo_leilao,
        },
      }, { onConflict: 'caso_id,tipo', ignoreDuplicates: true });
      if (error) throw error;

      // Incrementa cota se cliente
      if (isCliente) {
        const mes = mesRef();
        await supabase.from('cotas_analise').upsert({
          usuario_id: user.id,
          mes_ref: mes,
          analises_usadas: (cota?.analises_usadas || 0) + 1,
          analises_limite: COTAS_PLANO[role]?.mercado || 3,
          reunioes_usadas: cota?.reunioes_usadas || 0,
          reunioes_limite: COTAS_PLANO[role]?.reunioes || 0,
        }, { onConflict: 'usuario_id,mes_ref' });
        setCota(p => ({ ...p, analises_usadas: (p?.analises_usadas||0)+1 }));
      }

      setMsg('Análise solicitada! Você receberá notificação quando o relatório estiver pronto.');
      await carregarCaso();
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    } finally {
      setSolicitando(p => ({ ...p, [tipo]:false }));
    }
  };

  // ─── Enviar para jurídico ────────────────────────────────────────────────
  const encaminharJuridico = async () => {
    if (!caso) return;
    setSolicitando(p => ({ ...p, juridico:true }));
    try {
      const prazo = new Date(Date.now() + 10*24*60*60*1000).toISOString();
      const { error } = await supabase.from('analise_juridica').insert({
        caso_id: caso.id,
        prazo_ate: prazo,
        // pré-preenche o que a IA já tem nos relatórios
      });
      if (error && !error.message.includes('duplicate')) throw error;
      // Sorteia o advogado entre os ativos (uma vez) e fixa no caso
      let advogadoId = caso.advogado_id;
      if (!advogadoId) {
        const { data: advs } = await supabase.from('perfis').select('id').eq('role','advogado').eq('ativo', true);
        if (advs?.length) {
          advogadoId = advs[Math.floor(Math.random() * advs.length)].id;
          await supabase.from('casos').update({ advogado_id: advogadoId }).eq('id', caso.id);
        }
      }
      // Um clique: envia ao advogado por e-mail (anexos + avaliação documental),
      // marca o caso como solicitado e abre o acompanhamento no Atendimento interno.
      const r = await apiCall('/api/enviar-juridico-email', { method:'POST', body: JSON.stringify({ caso_id: caso.id }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Falha ao enviar e-mail ao advogado');
      await carregarCaso();
      setMsg(`📨 Documentação enviada ao advogado (${d.advogado}) com ${d.anexos} anexo(s). A devolutiva chega por e-mail e aparece no Atendimento. Prazo de 10 dias.`);
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    } finally {
      setSolicitando(p => ({ ...p, juridico:false }));
    }
  };

  // ─── Registrar arrematação ────────────────────────────────────────────────
  const salvarArrematacao = async () => {
    if (!caso) return;
    setSalvandoArr(true);
    try {
      const valor = parseFloat(String(arrForm.valor_arrematado).replace(/\./g,'').replace(',','.')) || 0;
      if (!valor) { setMsg('Informe o valor de arrematação.'); return; }

      const honorariosValor = valor * (honorariosConfig.total_pct / 100);

      const { data: arr, error } = await supabase.from('arrematacoes').upsert({
        caso_id: caso.id,
        cliente_id: user.id,
        tipo_leilao: arrForm.tipo_leilao,
        valor_arrematado: valor,
        honorarios_valor: honorariosValor,
        honorarios_status: 'pendente',
        em_nome_proprio: arrForm.em_nome_proprio,
        ...(arrForm.em_nome_proprio ? {} : {
          beneficiario_nome: arrForm.beneficiario_nome,
          beneficiario_cpf: arrForm.beneficiario_cpf,
          beneficiario_qualif: arrForm.beneficiario_qualif,
          beneficiario_endereco: arrForm.beneficiario_endereco,
        }),
        documento_tipo: arrForm.tipo_leilao === 'judicial' ? 'auto_arrematacao' : 'boleto',
      }, { onConflict: 'caso_id' }).select().single();
      if (error) throw error;

      await supabase.from('casos').update({ status_etapa:'arrematado' }).eq('id', caso.id);
      setArrematacao(arr);
      setMsg(`Arrematação registrada! Honorários de ${fmt(honorariosValor)} serão cobrados (${Number(honorariosConfig.total_pct).toFixed(2)}%).`);
      await carregarCaso();
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    } finally {
      setSalvandoArr(false);
    }
  };

  // ─── Gerar procuração ─────────────────────────────────────────────────────
  const gerarProcuracao = async () => {
    if (!caso || !arrematacao) return;
    setGerandoProc(true);
    try {
      // Busca dados do cliente e advogado
      const { data: perfilCliente } = await supabase.from('perfis').select('nome,cpf,endereco').eq('id', caso.cliente_id).single();
      const advId = caso.advogado_id;
      const perfilAdv = advId ? (await supabase.from('perfis').select('nome,cpf,endereco').eq('id', advId).single()).data : null;

      const dadosOutorgante = {
        nome: perfilCliente?.nome || '',
        cpf: perfilCliente?.cpf || '',
        endereco: perfilCliente?.endereco || '',
      };
      const dadosOutorgado = perfilAdv ? {
        nome: perfilAdv.nome || '',
        cpf: perfilAdv.cpf || '',
        endereco: perfilAdv.endereco || '',
      } : {};
      const dadosImovel = {
        endereco: caso.imovel_endereco,
        valor: arrematacao.valor_arrematado,
        tipo_leilao: caso.tipo_leilao,
        ...(arrematacao.em_nome_proprio ? {} : {
          beneficiario_nome: arrematacao.beneficiario_nome,
          beneficiario_cpf: arrematacao.beneficiario_cpf,
        }),
      };

      // Gera conteúdo via Edge Function (ou stub)
      const conteudo = `# PROCURAÇÃO\n\n**OUTORGANTE:** ${dadosOutorgante.nome} (CPF: ${dadosOutorgante.cpf})\n**Endereço:** ${dadosOutorgante.endereco}\n\n**OUTORGADO:** ${dadosOutorgado.nome || '(advogado a ser designado)'} (CPF: ${dadosOutorgado.cpf || ''})\n\n**OBJETO:** Representação no processo de arrematação do imóvel situado em ${dadosImovel.endereco}, pelo valor de ${fmt(dadosImovel.valor)}, ${caso.tipo_leilao === 'judicial' ? 'em leilão judicial' : 'em leilão extrajudicial'}.\n\n${!arrematacao.em_nome_proprio ? `\n**BENEFICIÁRIO:** ${arrematacao.beneficiario_nome} (CPF: ${arrematacao.beneficiario_cpf})\n` : ''}\n\nPoderes: representar o OUTORGANTE perante o leiloeiro, assinar documentos, receber o imóvel e praticar todos os atos necessários à conclusão da arrematação.\n\n_Gerado em ${new Date().toLocaleDateString('pt-BR')}_`;

      const { data: proc, error } = await supabase.from('procuracoes').insert({
        caso_id: caso.id,
        arrematacao_id: arrematacao.id,
        cliente_id: user.id,
        advogado_id: advId || null,
        dados_outorgante: dadosOutorgante,
        dados_outorgado: dadosOutorgado,
        dados_imovel: dadosImovel,
        conteudo_md: conteudo,
        versao: 1,
        assinado: false,
        advogado_notificado: false,
        admin_notificado: false,
      }).select().single();
      if (error) throw error;

      setProcuracao(proc);
      setMsg('Procuração gerada! Leia e assine para notificar o advogado.');
      toggleSec('proc');
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    } finally {
      setGerandoProc(false);
    }
  };

  // ─── Assinar procuração ───────────────────────────────────────────────────
  const assinarProcuracao = async () => {
    if (!procuracao) return;
    try {
      await supabase.from('procuracoes').update({
        assinado: true,
        assinado_em: new Date().toISOString(),
        ip_assinatura: 'cliente',
        advogado_notificado: true,
        admin_notificado: true,
      }).eq('id', procuracao.id);

      await supabase.from('casos').update({ status_etapa:'procuracao_assinada' }).eq('id', caso.id);
      await carregarCaso();
      setMsg('Procuração assinada! Advogado e administrador foram notificados.');
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    }
  };

  // ─── Enviar mensagem no chat ──────────────────────────────────────────────
  const enviarMsg = async () => {
    if (!chatInput.trim() || !caso || !chamadoId) return;
    setEnviando(true);
    try {
      const { data: nova } = await supabase.from('chamados_mensagens').insert({
        chamado_id: chamadoId,
        user_id: user.id,
        mensagem: chatInput.trim(),
        remetente_role: role,
      }).select('*, perfis(nome, role)').single();
      setMsgs(p => [...p, { ...nova, remetente_id: nova.user_id, texto: nova.mensagem }]);
      setChatInput('');
    } catch (e) {
      setMsg(`Erro ao enviar: ${e.message}`);
    } finally {
      setEnviando(false);
    }
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const getJob = (tipo) => jobs.find(j => j.tipo === tipo);
  const getRel = (tipo) => relatorios.filter(r => r.tipo === tipo).sort((a,b) => b.versao - a.versao)[0];
  const analisesConcluidas = TIPOS_ANALISE.every(t => getJob(t.tipo)?.status === 'concluido');
  const reuniao1 = reunioes.find(r => r.numero === 1);
  const reuniao2 = reunioes.find(r => r.numero === 2);

  const cotaInfo = cota ? {
    usadas: cota.analises_usadas || 0,
    limite: (cota.analises_limite || 3) + (cota.extras_analista || 0),
    reunioesUsadas: cota.reunioes_usadas || 0,
    reunioesLimite: cota.reunioes_limite || 0,
  } : { usadas:0, limite:3, reunioesUsadas:0, reunioesLimite:0 };

  const podeSolicitarAnalise = isStaff || cotaInfo.usadas < cotaInfo.limite;

  // ─── Google Agenda ────────────────────────────────────────────────────────
  const linkGoogleAgenda = () => {
    const titulo = imovelExtra?.titulo || caso?.imovel_endereco || 'Leilão de Imóvel';
    const dataLeilao = imovelExtra?.data_leilao;
    const linkLeilao = imovelExtra?.link_leilao || '';
    const endereco   = caso?.imovel_endereco || '';

    // Formata data para o formato do Google Calendar: YYYYMMDD
    // Se não há horário definido, define como dia inteiro
    let dates = '';
    if (dataLeilao) {
      const d = dataLeilao.replace(/-/g, '');
      dates = `${d}/${d}`;
    }

    const detalhes = [
      `📋 Imóvel: ${endereco}`,
      linkLeilao ? `🔗 Link do leilão: ${linkLeilao}` : '',
      `📁 Caso BidPro: ${window.location.origin}/#/caso/${caso?.id}`,
    ].filter(Boolean).join('\n');

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `🏠 Leilão — ${titulo}`,
      ...(dates ? { dates } : {}),
      details: detalhes,
      ...(endereco ? { location: endereco } : {}),
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', minHeight:'60vh' }}>
      <Loader2 size={32} color="#0D63DB" style={{animation:'spin 1s linear infinite'}}/>
    </div>
  );

  if (erro) return (
    <div style={{ maxWidth:600, margin:'60px auto', padding:24, textAlign:'center' }}>
      <AlertTriangle size={40} color="#ef4444" style={{marginBottom:12}}/>
      <div style={{ color:'#ef4444', fontWeight:700, fontSize:16 }}>{erro}</div>
      <button onClick={() => nav(-1)} style={{ ...btn('#64748b'), marginTop:16 }}>Voltar</button>
    </div>
  );

  if (!caso) return null;

  const statusAtual = caso.status_etapa;

  return (
    <div style={{ maxWidth:860, margin:'0 auto', padding: isMobile ? '16px 12px' : '28px 20px' }}>

      {/* Cabeçalho */}
      <div style={{ ...card, marginBottom:20 }}>
        <div style={{ display:'flex', alignItems:'flex-start', gap:14, flexWrap:'wrap' }}>
          <div style={{ flex:1, minWidth:200 }}>
            <div style={{ fontSize:12, color:'#94a3b8', fontWeight:600, marginBottom:4 }}>Análise de Imóvel</div>
            <div style={{ fontSize:18, fontWeight:900, color:'#111111', lineHeight:1.3 }}>
              {caso.imovel_endereco || 'Imóvel sem endereço'}
            </div>
            {caso.imovel_valor && (
              <div style={{ fontSize:13, color:'#64748b', marginTop:4 }}>
                Valor de referência: <strong>{fmt(caso.imovel_valor)}</strong>
              </div>
            )}
            <div style={{ marginTop:10 }}>
              <Badge label={STATUS_ETAPA_LABEL[statusAtual] || statusAtual} color="#0D63DB" bg="#eff6ff"/>
              <span style={{ marginLeft:8, fontSize:11, color:'#64748b' }}>{caso.tipo_leilao === 'judicial' ? 'Leilão Judicial' : 'Leilão Extrajudicial'}</span>
            </div>
          </div>
          {imovelInit?.url && (
            <a href={imovelInit.url} target="_blank" rel="noreferrer" style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, color:'#0D63DB', fontWeight:700, textDecoration:'none' }}>
              Ver no leiloeiro <ExternalLink size={12}/>
            </a>
          )}
        </div>
        <div style={{ marginTop:14 }}>
          <EtapaTimeline status={statusAtual}/>
        </div>
      </div>

      {/* Cota */}
      {isCliente && (
        <div style={{ ...card, marginBottom:20, background:'#f8fafc', padding:'12px 16px', display:'flex', gap:20, flexWrap:'wrap', alignItems:'center' }}>
          <div>
            <span style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>ANÁLISES NO MÊS</span>
            <div style={{ fontSize:18, fontWeight:900, color: cotaInfo.usadas >= cotaInfo.limite ? '#ef4444' : '#111111' }}>
              {cotaInfo.usadas} / {cotaInfo.limite}
            </div>
          </div>
          <div>
            <span style={{ fontSize:11, color:'#64748b', fontWeight:600 }}>REUNIÕES NO MÊS</span>
            <div style={{ fontSize:18, fontWeight:900, color:'#111111' }}>
              {cotaInfo.reunioesUsadas} / {cotaInfo.reunioesLimite}
            </div>
          </div>
          {cotaInfo.usadas >= cotaInfo.limite && (
            <div style={{ fontSize:12, color:'#92400e', background:'#fef3c7', padding:'8px 12px', borderRadius:8 }}>
              Cota esgotada para este mês.
              <button onClick={() => nav('/planos')} style={{ marginLeft:8, color:'#0D63DB', background:'none', border:'none', fontWeight:700, cursor:'pointer', fontSize:12 }}>Fazer upgrade</button>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div style={{ padding:'12px 16px', background: msg.startsWith('Erro') ? '#fef2f2' : '#f0fdf4', border:'1px solid', borderColor: msg.startsWith('Erro') ? '#fecaca' : '#bbf7d0', borderRadius:10, marginBottom:16, fontSize:13, color: msg.startsWith('Erro') ? '#991b1b' : '#166534' }}>
          {msg}
          <button onClick={()=>setMsg('')} style={{ float:'right', background:'none', border:'none', cursor:'pointer', color:'#94a3b8' }}>×</button>
        </div>
      )}

      {/* Seção 1: Análises */}
      <div style={{ marginBottom:12 }}>
        <Secao
          title="Análises e Relatórios"
          icon={BarChart3}
          color="#0D63DB"
          open={secOpen.analises}
          onToggle={() => toggleSec('analises')}
          badge={`${jobs.filter(j=>j.status==='concluido').length} de ${TIPOS_ANALISE.length} concluídas`}
        >
          <div style={{ display:'flex', flexDirection:'column', gap:10, paddingTop:14 }}>
            {(isAnalista || isAdvogado) && (
              <AnaliseAutomatica
                casoId={caso.id}
                imovelId={caso.imovel_id}
                relatorioInicial={getRel('juridica_preliminar')}
                onConcluido={carregarCaso}
              />
            )}
            {TIPOS_ANALISE.map(info => (
              <AnaliseCard
                key={info.tipo}
                info={info}
                job={getJob(info.tipo)}
                relatorio={getRel(info.tipo)}
                podeSolicitar={podeSolicitarAnalise}
                solicitando={!!solicitando[info.tipo]}
                onSolicitar={() => solicitarAnalise(info.tipo)}
              />
            ))}
          </div>

          {analisesConcluidas && !reuniao1 && (isAnalista || (COTAS_PLANO[role]?.reunioes || 0) > 0) && (
            <div style={{ marginTop:16, padding:'14px 16px', background:'#eff6ff', borderRadius:10, border:'1px solid #bfdbfe' }}>
              {showAgendar === 1 ? (
                <AgendarReuniao
                  casoId={caso.id}
                  analistaId={caso.analista_id}
                  reuniaoNum={1}
                  titulo="Agendar 1ª Reunião com Analista"
                  onAgendado={() => { setShowAgendar(null); carregarCaso(); }}
                  onCancelar={() => setShowAgendar(null)}
                />
              ) : (
                <>
                  <div style={{ fontWeight:700, fontSize:14, color:'#084BA6', marginBottom:8 }}>
                    {isAnalista ? 'Relatórios prontos — agendar reunião com cliente' : 'Relatórios prontos — agende sua reunião com o analista'}
                  </div>
                  <button onClick={() => setShowAgendar(1)} style={{ ...btn('#0D63DB'), fontSize:12 }}>
                    <Calendar size={13} style={{marginRight:6,verticalAlign:'middle'}}/>Escolher horário
                  </button>
                </>
              )}
            </div>
          )}
        </Secao>
      </div>

      {/* Seção 2: Reunião 1 */}
      <div style={{ marginBottom:12 }}>
        <Secao
          title="Reunião com Analista"
          icon={Video}
          color="#7c3aed"
          open={secOpen.reuniao}
          onToggle={() => toggleSec('reuniao')}
          badge={reuniao1 ? (reuniao1.status === 'realizada' ? 'Realizada' : `Agendada: ${fmtDate(reuniao1.data_hora)}`) : 'Aguardando relatórios'}
          disabled={!analisesConcluidas && !reuniao1}
        >
          {reuniao1 ? (
            <div style={{ paddingTop:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div><span style={lbl}>Data e Hora</span><div style={{ fontSize:14, fontWeight:700 }}>{fmtDate(reuniao1.data_hora)}</div></div>
                <div><span style={lbl}>Status</span><Badge label={reuniao1.status} color={reuniao1.status==='realizada'?'#10b981':'#7c3aed'} bg={reuniao1.status==='realizada'?'#ecfdf5':'#f5f3ff'}/></div>
              </div>
              {reuniao1.link_videochamada && (
                <a href={reuniao1.link_videochamada} target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:12, padding:'8px 14px', background:'#7c3aed', color:'white', borderRadius:8, fontWeight:700, fontSize:12, textDecoration:'none' }}>
                  <Video size={13}/> Acessar videochamada
                </a>
              )}
              {reuniao1.observacoes && (
                <div style={{ marginTop:12, fontSize:12, color:'#475569' }}><strong>Observações:</strong> {reuniao1.observacoes}</div>
              )}

              {/* Encaminhar para jurídico (pós-reunião 1, analista) */}
              {isAnalista && reuniao1.status === 'realizada' && !juridica && podeSolicitarJuridico && (
                <div style={{ marginTop:16, padding:'14px', background:'#fefce8', borderRadius:10, border:'1px solid #fde68a' }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'#92400e', marginBottom:4 }}>Encaminhar para análise jurídica</div>
                  <div style={{ fontSize:11, color:'#a16207', marginBottom:8 }}>Um clique envia ao advogado, por e-mail, todos os anexos + a avaliação documental. A devolutiva dele volta automaticamente para o Atendimento.</div>
                  <button onClick={encaminharJuridico} disabled={!!solicitando.juridico} style={{ ...btn('#d97706'), fontSize:12, opacity: solicitando.juridico?0.6:1 }}>
                    {solicitando.juridico
                      ? <><Loader2 size={13} style={{marginRight:6,verticalAlign:'middle',animation:'spin 1s linear infinite'}}/>Enviando…</>
                      : <><ClipboardList size={13} style={{marginRight:6,verticalAlign:'middle'}}/>Encaminhar ao Jurídico</>}
                  </button>
                </div>
              )}
              {isCliente && reuniao1.status === 'realizada' && !podeSolicitarJuridico && !juridica && (
                <div style={{ marginTop:12, padding:'12px', background:'#fef2f2', borderRadius:8, fontSize:12, color:'#991b1b' }}>
                  A análise jurídica está disponível apenas nos planos Assessorado e Leilão Club.
                  <button onClick={() => nav('/planos')} style={{ marginLeft:8, color:'#0D63DB', background:'none', border:'none', fontWeight:700, cursor:'pointer', fontSize:12 }}>Fazer upgrade</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ paddingTop:14, color:'#64748b', fontSize:13 }}>
              {analisesConcluidas
                ? 'Clique em "Escolher horário" acima para agendar sua reunião com o analista.'
                : 'A reunião será liberada após a conclusão dos relatórios de análise.'}
            </div>
          )}
        </Secao>
      </div>

      {/* Seção 3: Análise Jurídica */}
      <div style={{ marginBottom:12 }}>
        <Secao
          title="Análise Jurídica"
          icon={ShieldAlert}
          color="#d97706"
          open={secOpen.juridico}
          onToggle={() => toggleSec('juridico')}
          badge={juridica ? (juridica.entregue_em ? 'Parecer emitido' : `Prazo: ${fmtDate(juridica.prazo_ate)}`) : 'Aguardando encaminhamento'}
          disabled={!juridica && !isAnalista}
        >
          {juridica ? (
            <div style={{ paddingTop:14 }}>
              {/* Visualização para cliente — só após entrega */}
              {isCliente && !juridica.entregue_em && (
                <div style={{ color:'#64748b', fontSize:13 }}>
                  O advogado está analisando. Prazo: <strong>{fmtDate(juridica.prazo_ate)}</strong>
                </div>
              )}
              {(!isCliente || juridica.entregue_em) && juridica.nivel_risco && (
                <div>
                  <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:14 }}>
                    <div style={{ padding:'10px 16px', borderRadius:10, background: RISCO_COLOR[juridica.nivel_risco]+'18', border:`1px solid ${RISCO_COLOR[juridica.nivel_risco]}40` }}>
                      <div style={{ fontSize:10, fontWeight:700, color:'#64748b', marginBottom:2 }}>NÍVEL DE RISCO</div>
                      <div style={{ fontSize:16, fontWeight:900, color: RISCO_COLOR[juridica.nivel_risco], textTransform:'uppercase' }}>{juridica.nivel_risco}</div>
                    </div>
                    {juridica.resultado && (
                      <div style={{ padding:'10px 16px', borderRadius:10, background: PARECER_COLOR[juridica.resultado]+'18', border:`1px solid ${PARECER_COLOR[juridica.resultado]}40` }}>
                        <div style={{ fontSize:10, fontWeight:700, color:'#64748b', marginBottom:2 }}>PARECER</div>
                        <div style={{ fontSize:16, fontWeight:900, color: PARECER_COLOR[juridica.resultado] }}>{PARECER_LABEL[juridica.resultado]}</div>
                      </div>
                    )}
                  </div>
                  {juridica.ressalvas && (
                    <div style={{ padding:'12px', background:'#fef3c7', borderRadius:8, fontSize:12, color:'#92400e', marginBottom:12 }}>
                      <strong>Ressalvas:</strong> {juridica.ressalvas}
                    </div>
                  )}
                  {juridica.relatorio_md && (
                    <div style={{ padding:'14px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0', fontSize:12, color:'#475569', lineHeight:1.7, whiteSpace:'pre-wrap', maxHeight:300, overflow:'auto' }}>
                      {juridica.relatorio_md}
                    </div>
                  )}
                </div>
              )}

              {/* Cliente — ações após parecer jurídico entregue */}
              {isCliente && juridica.entregue_em && (
                <div style={{ marginTop:16, padding:'14px 16px', background:'#eff6ff', borderRadius:10, border:'1px solid #bfdbfe' }}>
                  <div style={{ fontWeight:700, fontSize:13, color:'#084BA6', marginBottom:4 }}>Próximos passos</div>
                  <div style={{ fontSize:12, color:'#1e40af', marginBottom:12, lineHeight:1.6 }}>
                    Seu analista entrará em contato para orientá-lo sobre a habilitação no leiloeiro e a estratégia de lance.
                    Enquanto isso, adicione o leilão à sua agenda para não perder a data.
                  </div>
                  <a
                    href={linkGoogleAgenda()}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'9px 16px', background:'#4285F4', color:'white', borderRadius:8, fontWeight:700, fontSize:12, textDecoration:'none' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 48 48" style={{flexShrink:0}}>
                      <path fill="#fff" d="M24 22v4h7c-.3 1.6-1.3 3-2.7 3.9l4.3 3.3c2.5-2.3 4-5.7 4-9.7 0-.9-.1-1.8-.2-2.6H24z"/>
                      <path fill="#fff" d="M13.5 28.9l-1 .8-3.5 2.7C11.3 35.6 15.4 38 20 38c3.3 0 6.1-1.1 8.1-3l-4.3-3.3c-1.1.7-2.4 1.1-3.8 1.1-3 0-5.5-2-6.5-4.9z"/>
                      <path fill="#fff" d="M9 17.3c-.7 1.4-1 3-1 4.7s.3 3.3 1 4.7l4.5-3.5c-.2-.7-.4-1.4-.4-2.2s.1-1.5.4-2.2L9 17.3z"/>
                      <path fill="#fff" d="M20 14c1.7 0 3.3.6 4.5 1.8l3.4-3.4C25.9 10.5 23.1 9 20 9c-4.6 0-8.7 2.4-11 6.1l4.5 3.5c1-2.9 3.5-4.6 6.5-4.6z"/>
                    </svg>
                    Adicionar ao Google Agenda
                  </a>
                </div>
              )}

              {/* Advogado — formulário de checklist */}
              {isAdvogado && !juridica.entregue_em && (
                <ChecklistJuridico juridica={juridica} casoId={caso.id} onSalvo={carregarCaso}/>
              )}

              {/* 2ª reunião — analista ou cliente agenda após parecer */}
              {juridica.entregue_em && !reuniao2 && (isAnalista || (COTAS_PLANO[role]?.reunioes || 0) >= 2) && (
                <div style={{ marginTop:16, padding:'14px', background:'#ecfdf5', borderRadius:10, border:'1px solid #bbf7d0' }}>
                  {showAgendar === 2 ? (
                    <AgendarReuniao
                      casoId={caso.id}
                      analistaId={caso.analista_id}
                      reuniaoNum={2}
                      titulo="Agendar 2ª Reunião — Aprovação"
                      onAgendado={() => { setShowAgendar(null); carregarCaso(); }}
                      onCancelar={() => setShowAgendar(null)}
                    />
                  ) : (
                    <>
                      <div style={{ fontWeight:700, fontSize:13, color:'#166534', marginBottom:8 }}>
                        {isAnalista ? 'Agendar 2ª reunião com cliente para aprovação' : 'Agende a 2ª reunião para aprovação do parecer'}
                      </div>
                      <button onClick={() => setShowAgendar(2)} style={{ ...btn('#10b981'), fontSize:12 }}>
                        <Calendar size={13} style={{marginRight:6,verticalAlign:'middle'}}/>Escolher horário
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div style={{ paddingTop:14, color:'#64748b', fontSize:13 }}>
              {isAnalista
                ? 'Realize a 1ª reunião e então encaminhe para análise jurídica.'
                : 'Aguardando encaminhamento pelo analista após a reunião inicial.'}
            </div>
          )}
        </Secao>
      </div>

      {/* Seção 4: 2ª Reunião */}
      {reuniao2 && (
        <div style={{ marginBottom:12 }}>
          <Secao
            title="2ª Reunião — Aprovação"
            icon={Video}
            color="#0891b2"
            open={secOpen.reuniao2 || false}
            onToggle={() => setSecOpen(p=>({...p, reuniao2:!p.reuniao2}))}
            badge={reuniao2.status === 'realizada' ? 'Realizada' : `Agendada: ${fmtDate(reuniao2.data_hora)}`}
          >
            <div style={{ paddingTop:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <div><span style={lbl}>Data e Hora</span><div style={{ fontSize:14, fontWeight:700 }}>{fmtDate(reuniao2.data_hora)}</div></div>
                <div><span style={lbl}>Status</span><Badge label={reuniao2.status} color="#0891b2" bg="#ecfeff"/></div>
              </div>
              {reuniao2.link_videochamada && (
                <a href={reuniao2.link_videochamada} target="_blank" rel="noreferrer" style={{ display:'inline-flex', alignItems:'center', gap:6, marginTop:12, padding:'8px 14px', background:'#0891b2', color:'white', borderRadius:8, fontWeight:700, fontSize:12, textDecoration:'none' }}>
                  <Video size={13}/> Acessar videochamada
                </a>
              )}
              {reuniao2.observacoes && (
                <div style={{ marginTop:10, fontSize:12, color:'#475569' }}><strong>Observações:</strong> {reuniao2.observacoes}</div>
              )}
              {/* Botão Google Agenda para o leilão — visível ao cliente */}
              {isCliente && (
                <div style={{ marginTop:14, paddingTop:12, borderTop:'1px solid #e2e8f0' }}>
                  <div style={{ fontSize:12, color:'#64748b', marginBottom:8 }}>Não esqueça de salvar o leilão na sua agenda:</div>
                  <a
                    href={linkGoogleAgenda()}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'8px 14px', background:'#4285F4', color:'white', borderRadius:8, fontWeight:700, fontSize:12, textDecoration:'none' }}
                  >
                    <Calendar size={13}/> Adicionar ao Google Agenda
                  </a>
                </div>
              )}
            </div>
          </Secao>
        </div>
      )}

      {/* Seção 5: Arrematação */}
      <div style={{ marginBottom:12 }}>
        <Secao
          title="Registrar Arrematação"
          icon={Gavel}
          color="#059669"
          open={secOpen.arr}
          onToggle={() => toggleSec('arr')}
          badge={arrematacao ? `${fmt(arrematacao.valor_arrematado)} — ${arrematacao.honorarios_status}` : 'Aguardando habilitação no leiloeiro'}
          disabled={!juridica?.entregue_em && !arrematacao}
        >
          {arrematacao ? (
            <div style={{ paddingTop:14 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
                <div><span style={lbl}>Valor Arrematado</span><div style={{ fontSize:18, fontWeight:900, color:'#059669' }}>{fmt(arrematacao.valor_arrematado)}</div></div>
                <div>
                  <span style={lbl}>Honorários ({Number(honorariosConfig.total_pct).toFixed(2)}%)</span>
                  <div style={{ fontSize:18, fontWeight:900, color:'#111111' }}>{fmt(arrematacao.honorarios_valor)}</div>
                </div>
              </div>
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:10 }}>
                <Badge label={arrematacao.honorarios_status === 'pago' ? 'Honorários pagos' : 'Honorários pendentes'}
                  color={arrematacao.honorarios_status === 'pago' ? '#10b981' : '#f59e0b'}
                  bg={arrematacao.honorarios_status === 'pago' ? '#ecfdf5' : '#fef3c7'}/>
              </div>
              {!arrematacao.em_nome_proprio && (
                <div style={{ padding:'10px 12px', background:'#f8fafc', borderRadius:8, fontSize:12, color:'#475569' }}>
                  <strong>Beneficiário:</strong> {arrematacao.beneficiario_nome} (CPF: {arrematacao.beneficiario_cpf})
                </div>
              )}

              {/* Monitor da distribuição do êxito (só admin) */}
              {role === 'admin' && monitorExito && (
                <div style={{ marginTop:14, padding:'14px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <div style={{ fontSize:12.5, fontWeight:800, color:'#111' }}>Distribuição do êxito ({Number(monitorExito.total_pct).toFixed(2)}%)</div>
                    <span style={{ fontSize:10.5, fontWeight:700, padding:'2px 8px', borderRadius:999, background: monitorExito.distribuido ? '#dcfce7' : '#fef3c7', color: monitorExito.distribuido ? '#166534' : '#92400e' }}>
                      {monitorExito.distribuido ? 'Distribuído' : 'Projeção'}
                    </span>
                  </div>
                  <div style={{ fontSize:11, color:'#64748b', marginBottom:8 }}>
                    {monitorExito.distribuido ? 'Valores já creditados nesta venda.' : 'Projeção com base nos % vigentes. O admin recebe o saldo. Editável em Usuários → 💰 Êxito.'}
                  </div>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
                    <thead><tr style={{ color:'#94a3b8', textAlign:'left' }}>
                      <th style={{ padding:'4px 0', fontWeight:700 }}>Envolvido</th>
                      <th style={{ padding:'4px 0', fontWeight:700 }}>Papel</th>
                      <th style={{ padding:'4px 0', fontWeight:700, textAlign:'right' }}>%</th>
                      <th style={{ padding:'4px 0', fontWeight:700, textAlign:'right' }}>Valor</th>
                    </tr></thead>
                    <tbody>
                      {monitorExito.linhas.map((l, i) => (
                        <tr key={i} style={{ borderTop:'1px solid #e2e8f0' }}>
                          <td style={{ padding:'6px 0', color:'#334155', fontWeight:600 }}>{l.nome || '—'}</td>
                          <td style={{ padding:'6px 0', color:'#64748b', textTransform:'capitalize' }}>{l.papel}</td>
                          <td style={{ padding:'6px 0', textAlign:'right', fontWeight:700, color:'#111' }}>{Number(l.pct).toFixed(2)}%</td>
                          <td style={{ padding:'6px 0', textAlign:'right', fontWeight:800, color:'#059669' }}>{fmt(l.valor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Botão gerar procuração */}
              {arrematacao.honorarios_status === 'pago' && !procuracao && isCliente && (
                <div style={{ marginTop:16 }}>
                  <button onClick={gerarProcuracao} disabled={gerandoProc} style={{ ...btn('#0D63DB'), display:'flex', alignItems:'center', gap:6 }}>
                    {gerandoProc ? <Loader2 size={13} style={{animation:'spin 1s linear infinite'}}/> : <FileText size={13}/>}
                    Gerar Procuração
                  </button>
                </div>
              )}
              {arrematacao.honorarios_status !== 'pago' && isCliente && (
                <div style={{ marginTop:12, padding:'12px', background:'#eff6ff', borderRadius:8, fontSize:12, color:'#084BA6' }}>
                  Após a confirmação do pagamento dos honorários, o botão de gerar procuração será liberado.
                </div>
              )}
            </div>
          ) : (
            <div style={{ paddingTop:14 }}>
              <div style={{ fontSize:13, color:'#64748b', marginBottom:16 }}>
                Após se habilitar no leiloeiro e arrematar, registre a arrematação aqui para iniciar o processo de honorários e procuração.
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div>
                  <label style={lbl}>Tipo de Leilão</label>
                  <select value={arrForm.tipo_leilao} onChange={e=>setArrForm(p=>({...p,tipo_leilao:e.target.value}))} style={inp}>
                    <option value="judicial">Judicial</option>
                    <option value="extrajudicial">Extrajudicial</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Valor Arrematado (R$)</label>
                  <input value={arrForm.valor_arrematado} onChange={e=>setArrForm(p=>({...p,valor_arrematado:e.target.value}))} style={inp} placeholder="0,00"/>
                </div>
                {arrForm.valor_arrematado && (
                  <div style={{ padding:'10px 14px', background:'#f0fdf4', borderRadius:8, fontSize:12, color:'#166534' }}>
                    Honorários estimados ({Number(honorariosConfig.total_pct).toFixed(2)}%): <strong>{fmt(parseFloat(String(arrForm.valor_arrematado).replace(/\./g,'').replace(',','.'))*honorariosConfig.total_pct/100)}</strong>
                    <div style={{ fontSize:11, marginTop:4, color:'#64748b' }}>
                      Admin {Number(honorariosConfig.admin_pct).toFixed(2)}% · Advogado {Number(honorariosConfig.advogado_pct).toFixed(2)}% · Analista {Number(honorariosConfig.analista_pct).toFixed(2)}%
                    </div>
                  </div>
                )}
                <div>
                  <label style={lbl}>Compra em nome</label>
                  <div style={{ display:'flex', gap:10 }}>
                    <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
                      <input type="radio" checked={arrForm.em_nome_proprio} onChange={()=>setArrForm(p=>({...p,em_nome_proprio:true}))}/>Próprio
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, cursor:'pointer' }}>
                      <input type="radio" checked={!arrForm.em_nome_proprio} onChange={()=>setArrForm(p=>({...p,em_nome_proprio:false}))}/>Terceiro
                    </label>
                  </div>
                </div>
                {!arrForm.em_nome_proprio && (
                  <div style={{ display:'flex', flexDirection:'column', gap:10, padding:'12px', background:'#f8fafc', borderRadius:10 }}>
                    <div><label style={lbl}>Nome do Beneficiário</label><input value={arrForm.beneficiario_nome} onChange={e=>setArrForm(p=>({...p,beneficiario_nome:e.target.value}))} style={inp} placeholder="Nome completo"/></div>
                    <div><label style={lbl}>CPF do Beneficiário</label><input value={arrForm.beneficiario_cpf} onChange={e=>setArrForm(p=>({...p,beneficiario_cpf:e.target.value}))} style={inp} placeholder="000.000.000-00"/></div>
                    <div><label style={lbl}>Qualificação</label><input value={arrForm.beneficiario_qualif} onChange={e=>setArrForm(p=>({...p,beneficiario_qualif:e.target.value}))} style={inp} placeholder="Nacionalidade, estado civil, profissão"/></div>
                    <div><label style={lbl}>Endereço</label><input value={arrForm.beneficiario_endereco} onChange={e=>setArrForm(p=>({...p,beneficiario_endereco:e.target.value}))} style={inp} placeholder="Endereço completo"/></div>
                  </div>
                )}
                <div>
                  <label style={lbl}>Anexar documento ({arrForm.tipo_leilao === 'judicial' ? 'Auto de Arrematação' : 'Boleto'})</label>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e=>setArrFileNome(e.target.files[0]?.name||'')} style={{ fontSize:12 }}/>
                  {arrFileNome && <div style={{ fontSize:11, color:'#64748b', marginTop:4 }}>{arrFileNome}</div>}
                </div>
                <button onClick={salvarArrematacao} disabled={salvandoArr} style={{ ...btn('#059669'), alignSelf:'flex-start', display:'flex', alignItems:'center', gap:6 }}>
                  {salvandoArr ? <Loader2 size={13} style={{animation:'spin 1s linear infinite'}}/> : <Gavel size={13}/>}
                  Registrar Arrematação
                </button>
              </div>
            </div>
          )}
        </Secao>
      </div>

      {/* Seção 6: Procuração */}
      {procuracao && (
        <div style={{ marginBottom:12 }}>
          <Secao
            title="Procuração"
            icon={FileText}
            color="#7c3aed"
            open={secOpen.proc}
            onToggle={() => toggleSec('proc')}
            badge={procuracao.assinado ? 'Assinada' : 'Aguardando assinatura'}
          >
            <div style={{ paddingTop:14 }}>
              <div style={{ padding:'16px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0', fontSize:12, color:'#475569', lineHeight:1.7, whiteSpace:'pre-wrap', maxHeight:400, overflow:'auto', marginBottom:14 }}>
                {procuracao.conteudo_md}
              </div>
              {!procuracao.assinado && isCliente && (
                <button onClick={assinarProcuracao} style={{ ...btn('#7c3aed'), display:'flex', alignItems:'center', gap:6 }}>
                  <Check size={14}/> Assinar Procuração
                </button>
              )}
              {procuracao.assinado && (
                <div style={{ display:'flex', alignItems:'center', gap:8, color:'#10b981', fontWeight:700, fontSize:13 }}>
                  <CheckCircle2 size={16}/> Assinada em {fmtDate(procuracao.assinado_em)}
                </div>
              )}
            </div>
          </Secao>
        </div>
      )}

      {/* Seção 7: Atendimento / Chat */}
      <div style={{ marginBottom:12 }}>
        <Secao
          title="Atendimento"
          icon={MessageSquare}
          color="#0891b2"
          open={secOpen.chat}
          onToggle={() => toggleSec('chat')}
          badge={msgs.length > 0 ? `${msgs.length} mensagem(ns)` : 'Canal aberto'}
          disabled={isCliente && !reuniao1}
        >
          <div style={{ paddingTop:14 }}>
            {arrematacao && (
              <div style={{ padding:'8px 12px', background:'#ecfdf5', borderRadius:8, fontSize:11, color:'#166534', fontWeight:600, marginBottom:12 }}>
                Arrematação em andamento
              </div>
            )}
            <div ref={chatRef} style={{ height:280, overflow:'auto', display:'flex', flexDirection:'column', gap:8, padding:'10px', background:'#f8fafc', borderRadius:10, border:'1px solid #e2e8f0', marginBottom:10 }}>
              {msgs.length === 0 && (
                <div style={{ textAlign:'center', color:'#94a3b8', fontSize:12, marginTop:'auto', marginBottom:'auto' }}>Nenhuma mensagem ainda.</div>
              )}
              {msgs.map(m => {
                const meu = m.remetente_id === user?.id;
                return (
                  <div key={m.id} style={{ alignSelf: meu ? 'flex-end' : 'flex-start', maxWidth:'80%' }}>
                    {!meu && <div style={{ fontSize:10, color:'#94a3b8', marginBottom:2 }}>{m.perfis?.nome || 'Sistema'}</div>}
                    <div style={{ padding:'8px 12px', borderRadius: meu ? '12px 12px 2px 12px' : '12px 12px 12px 2px', background: meu ? '#0D63DB' : 'white', color: meu ? 'white' : '#111111', fontSize:13, border: meu ? 'none' : '1px solid #e2e8f0' }}>
                      {m.texto}
                    </div>
                    <div style={{ fontSize:10, color:'#94a3b8', marginTop:2, textAlign: meu ? 'right' : 'left' }}>{fmtDate(m.created_at)}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input
                value={chatInput}
                onChange={e=>setChatInput(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&!e.shiftKey&&enviarMsg()}
                placeholder="Digite sua mensagem..."
                style={{ ...inp, flex:1 }}
              />
              <button onClick={enviarMsg} disabled={enviando || !chatInput.trim()} style={{ ...btn(), padding:'9px 16px', display:'flex', alignItems:'center', gap:6 }}>
                {enviando ? <Loader2 size={13} style={{animation:'spin 1s linear infinite'}}/> : <Send size={14}/>}
              </button>
            </div>
          </div>
        </Secao>
      </div>

    </div>
  );
}

// ─── Checklist Jurídico (advogado) ────────────────────────────────────────────
function ChecklistJuridico({ juridica, casoId, onSalvo }) {
  const [form, setForm] = useState({
    debitos_iptu_valor: juridica.debitos_iptu_valor || '',
    debitos_cond_valor: juridica.debitos_cond_valor || '',
    hierarquia_ok: juridica.hierarquia_ok ?? null,
    custo_desocupacao_est: juridica.custo_desocupacao_est || '',
    red_flags: juridica.red_flags || '',
    nivel_risco: juridica.nivel_risco || '',
    acoes_pos_arremate: juridica.acoes_pos_arremate || '',
    resultado: juridica.resultado || '',
    ressalvas: juridica.ressalvas || '',
  });
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState('');

  const salvar = async (entregar=false) => {
    setSalvando(true);
    try {
      const upd = {
        ...form,
        debitos_iptu_valor: form.debitos_iptu_valor ? parseFloat(form.debitos_iptu_valor) : null,
        debitos_cond_valor: form.debitos_cond_valor ? parseFloat(form.debitos_cond_valor) : null,
        custo_desocupacao_est: form.custo_desocupacao_est ? parseFloat(form.custo_desocupacao_est) : null,
        ...(entregar ? { entregue_em: new Date().toISOString() } : {}),
      };
      await supabase.from('analise_juridica').update(upd).eq('caso_id', casoId);
      if (entregar) {
        await supabase.from('casos').update({ status_etapa:'juridico_concluido' }).eq('id', casoId);
      }
      setMsg(entregar ? 'Parecer entregue! Cliente e analista foram notificados.' : 'Rascunho salvo.');
      await onSalvo();
    } catch (e) {
      setMsg(`Erro: ${e.message}`);
    } finally {
      setSalvando(false);
    }
  };

  const f = (k,v) => setForm(p=>({...p,[k]:v}));
  const inp2 = { width:'100%', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:7, fontSize:12, background:'white', color:'#111111', boxSizing:'border-box' };

  return (
    <div style={{ marginTop:14 }}>
      <div style={{ fontWeight:700, fontSize:13, color:'#111111', marginBottom:12 }}>Checklist Jurídico</div>

      {/* Seção 5: débitos e hierarquia */}
      <div style={{ background:'#f8fafc', borderRadius:10, padding:'14px', marginBottom:10 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#64748b', marginBottom:10, textTransform:'uppercase' }}>Seção 5 — Débitos e Hierarquia</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
          <div><label style={lbl}>Débitos IPTU (R$)</label><input value={form.debitos_iptu_valor} onChange={e=>f('debitos_iptu_valor',e.target.value)} style={inp2} placeholder="0.00"/></div>
          <div><label style={lbl}>Débitos Condomínio (R$)</label><input value={form.debitos_cond_valor} onChange={e=>f('debitos_cond_valor',e.target.value)} style={inp2} placeholder="0.00"/></div>
        </div>
        <div><label style={lbl}>Hierarquia de créditos OK?</label>
          <div style={{ display:'flex', gap:10 }}>
            {[['true','Sim'],['false','Não'],['','-']].map(([v,l]) => (
              <label key={v} style={{ display:'flex', alignItems:'center', gap:4, fontSize:12, cursor:'pointer' }}>
                <input type="radio" checked={String(form.hierarquia_ok)===v} onChange={()=>f('hierarquia_ok',v==='true'?true:v==='false'?false:null)}/>{l}
              </label>
            ))}
          </div>
        </div>
        <div style={{ marginTop:10 }}><label style={lbl}>Custo estimado de desocupação (R$)</label><input value={form.custo_desocupacao_est} onChange={e=>f('custo_desocupacao_est',e.target.value)} style={inp2} placeholder="0.00"/></div>
      </div>

      {/* Seção 6: Conclusão */}
      <div style={{ background:'#f8fafc', borderRadius:10, padding:'14px', marginBottom:12 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'#64748b', marginBottom:10, textTransform:'uppercase' }}>Seção 6 — Conclusão</div>
        <div style={{ marginBottom:10 }}><label style={lbl}>Red flags identificadas</label><textarea value={form.red_flags} onChange={e=>f('red_flags',e.target.value)} rows={2} style={{...inp2,resize:'vertical'}} placeholder="Descreva riscos ocultos identificados"/></div>
        <div style={{ marginBottom:10 }}>
          <label style={lbl}>Nível de Risco</label>
          <select value={form.nivel_risco} onChange={e=>f('nivel_risco',e.target.value)} style={inp2}>
            <option value="">Selecione</option>
            <option value="baixo">Baixo</option>
            <option value="medio">Médio</option>
            <option value="alto">Alto</option>
          </select>
        </div>
        <div style={{ marginBottom:10 }}>
          <label style={lbl}>Parecer</label>
          <select value={form.resultado} onChange={e=>f('resultado',e.target.value)} style={inp2}>
            <option value="">Selecione</option>
            <option value="recomendo">Recomendo</option>
            <option value="recomendo_ressalvas">Recomendo com Ressalvas</option>
            <option value="nao_recomendo">Não Recomendo</option>
          </select>
        </div>
        <div style={{ marginBottom:10 }}><label style={lbl}>Ressalvas</label><textarea value={form.ressalvas} onChange={e=>f('ressalvas',e.target.value)} rows={2} style={{...inp2,resize:'vertical'}} placeholder="Ressalvas ou condições para recomendação"/></div>
        <div style={{ marginBottom:10 }}><label style={lbl}>Ações pós-arremate recomendadas</label><textarea value={form.acoes_pos_arremate} onChange={e=>f('acoes_pos_arremate',e.target.value)} rows={2} style={{...inp2,resize:'vertical'}} placeholder="Ex: imissão na posse, baixa de hipoteca, etc."/></div>
      </div>

      {msg && <div style={{ padding:'8px 12px', background: msg.startsWith('Erro') ? '#fef2f2' : '#f0fdf4', borderRadius:8, fontSize:12, color: msg.startsWith('Erro') ? '#991b1b' : '#166534', marginBottom:10 }}>{msg}</div>}

      <div style={{ display:'flex', gap:10 }}>
        <button onClick={() => salvar(false)} disabled={salvando} style={{ ...btn('#64748b'), fontSize:12, display:'flex', alignItems:'center', gap:5 }}>
          {salvando ? <Loader2 size={12} style={{animation:'spin 1s linear infinite'}}/> : <Save size={12}/>}Salvar Rascunho
        </button>
        <button onClick={() => salvar(true)} disabled={salvando || !form.resultado || !form.nivel_risco} style={{ ...btn('#d97706'), fontSize:12, display:'flex', alignItems:'center', gap:5 }}>
          <Check size={12}/>Entregar Parecer
        </button>
      </div>
    </div>
  );
}
