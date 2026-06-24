import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, DollarSign, Link2, Copy, Check, GraduationCap, Tag,
  TrendingUp, Clock, CheckCircle2, Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { usePlanos } from '../contexts/PlanosContext';
import { supabase } from '../utils/supabase';
import { fmt } from '../utils/calculos';
import { apiCall } from '../utils/apiCall';

const ROLES_CONSULTOR = ['consultor', 'admin'];

function fmtData(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return isNaN(dt) ? '—' : dt.toLocaleDateString('pt-BR');
}

function CopyBtn({ texto }) {
  const [ok, setOk] = useState(false);
  const copiar = async () => {
    try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1600); } catch (_) {}
  };
  return (
    <button onClick={copiar}
      style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px', background: ok?'#10b981':'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
      {ok ? <><Check size={13}/> Copiado</> : <><Copy size={13}/> Copiar</>}
    </button>
  );
}

export default function Consultor() {
  const nav = useNavigate();
  const { user, role, loading: authLoading } = useAuth();
  const planosCtx = usePlanos();
  const podeVer = ROLES_CONSULTOR.includes(role);

  const [perfil, setPerfil] = useState(null);
  const [carteira, setCarteira] = useState([]);
  const [comissoes, setComissoes] = useState([]);
  const [cursos, setCursos] = useState([]);
  const [ebooks, setEbooks] = useState([]);
  const [planosConfig, setPlanosConfig] = useState([]);
  const [sdrProdutos, setSdrProdutos] = useState([]);
  const [linksPromo, setLinksPromo] = useState([]);
  const [novoPromo, setNovoPromo] = useState({ produto: 'top1', desconto_pct: '', descricao_condicoes: '' });
  const [salvandoPromo, setSalvandoPromo] = useState(false);
  const [linksConvite, setLinksConvite] = useState([]);
  const [copiandoConvite, setCopiandoConvite] = useState('');
  const [aba, setAba] = useState('material'); // 'material' | 'carteira' | 'comissoes' | 'leads'
  const [filtroCarteira, setFiltroCarteira] = useState('todos'); // 'todos' | 'pagantes' | 'nao_pagantes'
  const [filtroComissao, setFiltroComissao] = useState('todos'); // 'todos' | 'pendente' | 'pago'
  const [leadsSDR, setLeadsSDR] = useState([]);
  const [leadDetalhe, setLeadDetalhe] = useState(null);
  const [clienteDetalhe, setClienteDetalhe] = useState(null);
  const [msgModal, setMsgModal] = useState(null);   // { nome, email, user_id }
  const [msgForm, setMsgForm] = useState({ assunto: '', conteudo: '' });
  const [enviandoMsg, setEnviandoMsg] = useState(false);
  const [msgOk, setMsgOk] = useState(false);
  const [reuniaoModal, setReuniaoModal] = useState(null); // { nome, email }
  const [reuniaoForm, setReuniaoForm] = useState({ data: '', hora: '10:00', duracao: 30 });
  const [criandoReuniao, setCriandoReuniao] = useState(false);
  const [reuniaoInfo, setReuniaoInfo] = useState(null); // { link, roomName, expiracao }
  const [estendendo, setEstendendo] = useState(false);
  const [estendeuMsg, setEstendeuMsg] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !podeVer) { setLoading(false); return; }
    async function load() {
      const [{ data: p }, { data: cli }, { data: com }, { data: cs }, { data: eb }, { data: lp }, { data: lc }, { data: pc }, { data: sdrProd }] = await Promise.all([
        supabase.from('perfis').select('codigo_indicacao, comissao_afiliado_pct, asaas_wallet_id').eq('id', user.id).single(),
        supabase.from('perfis').select('id, nome, email, whatsapp, telefone, role, plano, created_at').eq('indicado_por', user.id).order('created_at', { ascending: false }),
        supabase.from('comissoes').select('*').eq('beneficiario_id', user.id).order('created_at', { ascending: false }),
        supabase.from('cursos_admin').select('id, titulo, subtitulo, preco, emoji, cor, comissao_pct').eq('ativo', true).order('ordem'),
        supabase.from('ebooks_admin').select('id, titulo, preco, comissao_pct').eq('ativo', true).order('criado_em', { ascending: false }),
        supabase.from('links_promo').select('*').eq('criado_por', user.id).order('criado_em', { ascending: false }),
        supabase.from('links_convite').select('*').eq('criado_por', user.id).order('criado_em', { ascending: false }),
        supabase.from('planos_config').select('plano_key,nome,preco,preco_vista,comissao_pct').eq('ativo', true),
        supabase.from('sdr_produtos').select('id, nome, tipo').eq('ativo', true).order('criado_em', { ascending: false }),
      ]);
      setPerfil(p || null);
      setCarteira(cli || []);
      setComissoes(com || []);
      setCursos(cs || []);
      setEbooks(eb || []);
      setPlanosConfig(pc || []);
      setSdrProdutos(sdrProd || []);
      setLinksPromo(lp || []);
      setLinksConvite(lc || []);
      setLoading(false);
    }
    load();
  }, [user, podeVer]);

  useEffect(() => {
    if (!user || !podeVer) return;
    supabase.from('sdr_leads').select('*, sdr_produtos(nome, perguntas)').eq('consultor_id', user.id).order('criado_em', { ascending: false })
      .then(({ data }) => setLeadsSDR(data || []));
  }, [user, podeVer]);

  const gerarCodigo = async () => {
    const { data, error } = await supabase.rpc('gerar_codigo_indicacao', { p_id: user.id });
    if (error) { alert('Erro ao gerar código: ' + error.message); return; }
    if (data) setPerfil(p => ({ ...p, codigo_indicacao: data }));
  };

  // Aguarda auth e dados carregarem antes de avaliar autorização (evita flash de tela errada)
  if (authLoading || loading) return <div style={{ textAlign:'center', padding:'80px', color:'#94a3b8' }}>Carregando…</div>;

  if (!user) {
    return (
      <div style={{ maxWidth:520, margin:'80px auto', textAlign:'center', padding:'0 20px' }}>
        <h2 style={{ color:'#111111' }}>Acesso restrito</h2>
        <p style={{ color:'#64748b' }}>Faça login para acessar o painel do consultor.</p>
        <button onClick={()=>nav('/login')} style={{ padding:'10px 20px', background:'#0D63DB', color:'white', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer' }}>Entrar</button>
      </div>
    );
  }

  if (!podeVer) {
    return (
      <div style={{ maxWidth:520, margin:'80px auto', textAlign:'center', padding:'0 20px' }}>
        <h2 style={{ color:'#111111' }}>Programa de Consultores</h2>
        <p style={{ color:'#64748b' }}>Esta área é exclusiva para consultores parceiros da TSN. Fale com a equipe para se tornar um consultor e ganhar comissões recorrentes indicando clientes.</p>
        <button onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))} style={{ display:'inline-block', marginTop:8, padding:'10px 20px', background:'#0D63DB', color:'white', borderRadius:10, fontWeight:700, border:'none', cursor:'pointer' }}>Quero ser consultor</button>
      </div>
    );
  }

  const criarLinkPromo = async () => {
    setSalvandoPromo(true);
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const cod = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const payload = {
      codigo: cod,
      produto: novoPromo.produto,
      desconto_pct: Number(novoPromo.desconto_pct) || 0,
      descricao_condicoes: novoPromo.descricao_condicoes,
      criado_por: user.id,
      ativo: true,
    };
    const { data, error } = await supabase.from('links_promo').insert(payload).select().single();
    if (!error && data) setLinksPromo(p => [data, ...p]);
    setSalvandoPromo(false);
  };

  const togglePromo = async (lp) => {
    await supabase.from('links_promo').update({ ativo: !lp.ativo }).eq('id', lp.id);
    setLinksPromo(ps => ps.map(p => p.id === lp.id ? { ...p, ativo: !p.ativo } : p));
  };

  const gerarConvite = async () => {
    const codigo = Math.random().toString(36).substring(2, 10).toUpperCase();
    const { data, error } = await supabase.from('links_convite').insert({ codigo, criado_por: user.id }).select().single();
    if (!error && data) setLinksConvite(p => [data, ...p]);
  };

  const toggleConvite = async (c) => {
    await supabase.from('links_convite').update({ ativo: !c.ativo }).eq('id', c.id);
    setLinksConvite(ps => ps.map(p => p.id === c.id ? { ...p, ativo: !p.ativo } : p));
  };

  const copiarConvite = (codigo) => {
    navigator.clipboard.writeText(`${window.location.origin}/#/convite/${codigo}`);
    setCopiandoConvite(codigo);
    setTimeout(() => setCopiandoConvite(''), 2000);
  };

  // Nomes ao vivo do admin — fallback para chave se contexto ainda carregando
  const pNome = (key) => planosCtx?.[key]?.nome || key;
  const PRODUTOS_NOME = {
    top2: pNome('top2'), assessorado: pNome('assessorado'), clube: pNome('clube'),
  };

  function fmtPreco(v, decimais = 2) {
    return `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: decimais, maximumFractionDigits: decimais })}`;
  }

  function buildPlanosVenda() {
    if (!planosCtx) return [];
    const result = [];
    ['top2', 'assessorado', 'clube'].forEach(key => {
      const p = planosCtx[key];
      if (!p || p.ativo === false) return;
      const precoLabel = p.assinatura
        ? `${fmtPreco(p.preco)}/mês`
        : p.precoVista
          ? `${fmtPreco(p.preco)} em 12× ou ${fmtPreco(p.precoVista)} à vista`
          : fmtPreco(p.preco);
      result.push({ key, nome: p.nome, precoLabel });
      if (!p.assinatura && p.precoVista) {
        result.push({
          key: `${key}_vista`,
          nome: `${p.nome} (À Vista)`,
          precoLabel: `${fmtPreco(p.precoVista)} (${p.desconto_vista_pct || 20}% off)`,
        });
      }
    });
    return result;
  }

  const planosVenda = planosConfig.length > 0
    ? planosConfig.map(p => {
        const fmtBRL = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
        let precoLabel = '';
        if (p.preco) {
          if (p.cobrar) {
            precoLabel = `${fmtBRL(p.preco)}/mês`;
          } else {
            const parcelas = `${fmtBRL(p.preco)} em 12×`;
            precoLabel = p.preco_vista
              ? `${parcelas} · ${fmtBRL(p.preco_vista)} à vista`
              : parcelas;
          }
        }
        return { key: p.plano_key, nome: p.nome, precoLabel };
      })
    : buildPlanosVenda();

  const codigo = perfil?.codigo_indicacao;
  const origin = window.location.origin;
  const pct = Number(perfil?.comissao_afiliado_pct || 0); // fallback genérico

  // Retorna comissão configurada pelo admin para um plano ou produto específico
  function comissaoDePlano(planoKey) {
    const p = planosConfig.find(p => p.plano_key === planoKey);
    return p?.comissao_pct != null ? Number(p.comissao_pct) : pct;
  }

  const linkBase = codigo ? `${origin}/#/login?ref=${codigo}` : '';
  const linkPlanos = codigo ? `${origin}/#/planos?ref=${codigo}` : '';

  // Comissões: totais
  const totalPendente = comissoes.filter(c=>c.status==='pendente').reduce((s,c)=>s+Number(c.valor_comissao),0);
  const totalPago     = comissoes.filter(c=>c.status==='pago').reduce((s,c)=>s+Number(c.valor_comissao),0);
  const clientesPagantes = carteira.filter(c => c.plano && c.plano !== 'gratuito').length;

  async function enviarMensagem() {
    if (!msgForm.conteudo.trim()) return;
    setEnviandoMsg(true);
    await supabase.from('mensagens_diretas').insert({
      de_consultor_id: user.id,
      para_user_id: msgModal.user_id || null,
      para_email: msgModal.email || null,
      assunto: msgForm.assunto.trim() || 'Mensagem do seu consultor',
      conteudo: msgForm.conteudo.trim(),
    });
    setEnviandoMsg(false);
    setMsgOk(true);
    setTimeout(() => { setMsgModal(null); setMsgOk(false); setMsgForm({ assunto:'', conteudo:'' }); }, 1800);
  }

  async function criarReuniao() {
    if (!reuniaoForm.data) return;
    setCriandoReuniao(true);
    setReuniaoInfo(null);
    setEstendeuMsg('');
    const reuniaoEm = `${reuniaoForm.data}T${reuniaoForm.hora}:00`;
    const fakeId = `consultor-${user.id.slice(0,8)}-${Date.now()}`;
    try {
      const res = await apiCall('/api/criar-sala-reuniao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ solicitacaoId: fakeId, reuniaoEm, duracaoMin: Number(reuniaoForm.duracao) }),
      });
      const data = await res.json();
      if (data.meetLink) setReuniaoInfo({ link: data.meetLink, roomName: data.roomName });
    } catch (_) {}
    setCriandoReuniao(false);
  }

  async function estenderReuniao(min) {
    if (!reuniaoInfo?.roomName) return;
    setEstendendo(true);
    setEstendeuMsg('');
    try {
      const res = await apiCall('/api/estender-reuniao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName: reuniaoInfo.roomName, minutosExtras: min }),
      });
      const data = await res.json();
      if (data.ok) setEstendeuMsg(`+${min} min adicionados. Nova expiração: ${data.novaExpiracao}`);
      else setEstendeuMsg('Erro ao estender. Tente novamente.');
    } catch (_) { setEstendeuMsg('Erro ao estender.'); }
    setEstendendo(false);
    setTimeout(() => setEstendeuMsg(''), 4000);
  }

  const tabBtn = (id, label) => (
    <button onClick={()=>setAba(id)}
      style={{ padding:'10px 20px', border:'none', background: aba===id ? '#111111' : 'transparent', color: aba===id ? 'white' : '#64748b', fontWeight:700, fontSize:14, cursor:'pointer', borderRadius:'10px 10px 0 0', borderBottom: aba===id ? 'none' : '2px solid #e2e8f0' }}>
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', padding:'24px 20px' }}>
      <div style={{ marginBottom:20 }}>
        <h1 style={{ margin:0, fontSize:24, fontWeight:900, color:'#111111' }}>Painel do Consultor</h1>
        <p style={{ margin:'4px 0 0', fontSize:13, color:'#64748b' }}>Indique clientes e ganhe comissões recorrentes enquanto eles forem pagantes.</p>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:10, marginBottom:20 }}>
        {[
          { l:'Clientes na carteira', v: carteira.length, c:'#0D63DB', bg:'#eff6ff', icon:Users, onClick:()=>{ setFiltroCarteira('todos'); setAba('carteira'); } },
          { l:'Clientes pagantes', v: clientesPagantes, c:'#8b5cf6', bg:'#ede9fe', icon:TrendingUp, onClick:()=>{ setFiltroCarteira('pagantes'); setAba('carteira'); } },
          { l:'Comissão pendente', v:`R$ ${fmt(totalPendente,0)}`, c:'#f59e0b', bg:'#fffbeb', icon:Clock, onClick:()=>{ setFiltroComissao('pendente'); setAba('comissoes'); } },
          { l:'Comissão recebida', v:`R$ ${fmt(totalPago,0)}`, c:'#10b981', bg:'#f0fdf4', icon:CheckCircle2, onClick:()=>{ setFiltroComissao('pago'); setAba('comissoes'); } },
        ].map(k=>(
          <div key={k.l} onClick={k.onClick}
            style={{ background:k.bg, borderRadius:12, padding:'14px 16px', border:`1px solid ${k.c}40`, cursor:'pointer', transition:'box-shadow 0.15s', boxShadow:'0 1px 3px rgba(0,0,0,0.06)' }}
            onMouseEnter={e=>e.currentTarget.style.boxShadow=`0 4px 12px ${k.c}30`}
            onMouseLeave={e=>e.currentTarget.style.boxShadow='0 1px 3px rgba(0,0,0,0.06)'}>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, color:k.c, textTransform:'uppercase', marginBottom:6 }}>
              <k.icon size={13}/> {k.l}
            </div>
            <div style={{ fontSize:20, fontWeight:900, color:'#111111' }}>{k.v}</div>
            <div style={{ fontSize:10, color:k.c, marginTop:4, fontWeight:600 }}>clique para ver →</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e2e8f0', flexWrap:'wrap' }}>
        {tabBtn('material', '🔗 Material de Divulgação')}
        {tabBtn('carteira', `👥 Carteira (${carteira.length})`)}
        {tabBtn('comissoes', `💰 Comissões (${comissoes.length})`)}
      </div>

      <div style={{ background:'white', borderRadius:'0 12px 12px 12px', border:'1px solid #e2e8f0', borderTop:'none', padding:'20px' }}>

        {/* === MATERIAL DE DIVULGAÇÃO === */}
        {aba==='material' && (
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
              <>
                {/* Código (se tiver) */}
                {codigo && (
                  <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:12, padding:'14px 18px' }}>
                    <div style={{ fontSize:11, fontWeight:800, color:'#059669', textTransform:'uppercase', marginBottom:4 }}>Seu código de indicação</div>
                    <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                      <span style={{ fontSize:24, fontWeight:900, color:'#111111', letterSpacing:2 }}>{codigo}</span>
                      <span style={{ fontSize:12, color:'#64748b' }}>Comissão de <strong>{pct}%</strong> sobre produtos e assinaturas.</span>
                    </div>
                  </div>
                )}

                {/* ── Kit da Consulta ── */}
                <div style={{ background:'linear-gradient(135deg,#111111 0%,#1e3a5f 100%)', borderRadius:14, padding:'18px 20px' }}>
                  <div style={{ fontSize:12, fontWeight:800, color:'#60a5fa', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>🛒 Links para Compartilhar</div>
                  <p style={{ fontSize:12, color:'#94a3b8', margin:'0 0 14px' }}>Todos os produtos e links disponíveis para enviar ao cliente durante o atendimento.</p>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {[
                      {
                        emoji: '🧮',
                        label: 'Calculadora de Lances',
                        sub: 'Ferramenta gratuita · com chamada para a plataforma',
                        url: `${origin}/#/calculadora${codigo?`?ref=${codigo}`:''}`,
                        comissao: null,
                      },
                      {
                        emoji: '🎁',
                        label: 'Assinatura Explorador',
                        sub: 'Acesso gratuito · sem cartão',
                        url: `${origin}/#/checkout?plano=explorador${codigo?`&ref=${codigo}`:''}`,
                        comissao: null,
                      },
                      {
                        emoji: '⭐',
                        label: `Assinatura ${pNome('top2')}`,
                        sub: planosCtx?.top2 ? `${fmtPreco(planosCtx.top2.preco)}/mês` : 'R$ 49,90/mês',
                        url: `${origin}/#/checkout?plano=top2${codigo?`&ref=${codigo}`:''}`,
                        comissao: comissaoDePlano('top2'),
                        recorrente: true,
                      },
                      {
                        emoji: '🏅',
                        label: pNome('assessorado'),
                        sub: planosCtx?.assessorado
                          ? `${fmtPreco(planosCtx.assessorado.preco)} em 12× · ${fmtPreco(planosCtx.assessorado.precoVista || planosCtx.assessorado.preco * 12 * 0.8)} à vista`
                          : 'R$ 6.000 parcelado · R$ 5.000 à vista',
                        url: `${origin}/#/checkout?plano=assessorado${codigo?`&ref=${codigo}`:''}`,
                        comissao: comissaoDePlano('assessorado'),
                        recorrente: false,
                      },
                      {
                        emoji: '🏛️',
                        label: pNome('clube'),
                        sub: planosCtx?.clube
                          ? `${fmtPreco(planosCtx.clube.preco)} em 12× · ${fmtPreco(planosCtx.clube.precoVista || planosCtx.clube.preco * 12 * 0.8)} à vista`
                          : 'R$ 60.000/ano · R$ 48.000 à vista',
                        url: `${origin}/#/checkout?plano=clube${codigo?`&ref=${codigo}`:''}`,
                        comissao: comissaoDePlano('clube'),
                        recorrente: false,
                      },
                      ...cursos.map(c=>({
                        emoji: c.emoji||'🎓',
                        label: c.titulo,
                        sub: `Curso${Number(c.preco)>0?` · R$ ${Number(c.preco).toFixed(0)}`:'· Incluído na assinatura'}`,
                        url: `${origin}/#/p/curso/${c.id}${codigo?`?ref=${codigo}`:''}`,
                        comissao: c.comissao_pct != null ? Number(c.comissao_pct) : pct,
                        recorrente: false,
                      })),
                      ...ebooks.map(e=>({
                        emoji: '📖',
                        label: e.titulo,
                        sub: `eBook${Number(e.preco)>0?` · R$ ${Number(e.preco).toFixed(0)}`:'· Incluído na assinatura'}`,
                        url: `${origin}/#/p/ebook/${e.id}${codigo?`?ref=${codigo}`:''}`,
                        comissao: e.comissao_pct != null ? Number(e.comissao_pct) : pct,
                        recorrente: false,
                      })),
                      ...sdrProdutos.map(s=>({
                        emoji: s.tipo==='ebook'?'📖':s.tipo==='curso'?'🎓':s.tipo==='calculadora'?'🧮':'🎁',
                        label: s.nome,
                        sub: `${s.tipo||'Conteúdo'} · Acesso gratuito`,
                        url: `${origin}/#/p/captura/${s.id}`,
                        comissao: null,
                      })),
                    ].map((item,i)=>(
                      <div key={i} style={{ background:'rgba(255,255,255,0.07)', borderRadius:10, padding:'10px 14px', display:'flex', alignItems:'center', gap:10 }}>
                        <span style={{ fontSize:18, flexShrink:0 }}>{item.emoji}</span>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:13, fontWeight:700, color:'white', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.label}</div>
                          {item.sub && <div style={{ fontSize:11, color:'#60a5fa' }}>{item.sub}</div>}
                        </div>
                        {/* Comissão */}
                        <div style={{ flexShrink:0, minWidth:80, textAlign:'right' }}>
                          {item.comissao != null ? (
                            <div>
                              <div style={{ fontSize:13, fontWeight:800, color:'#10b981' }}>{item.comissao}%</div>
                              <div style={{ fontSize:10, color: item.recorrente ? '#34d399' : '#64748b', fontWeight:600 }}>
                                {item.recorrente ? '↻ recorrente' : 'por venda'}
                              </div>
                            </div>
                          ) : (
                            <div style={{ fontSize:11, color:'#475569' }}>—</div>
                          )}
                        </div>
                        <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                          <a href={item.url} target="_blank" rel="noreferrer"
                            style={{ padding:'4px 10px', background:'rgba(255,255,255,0.1)', color:'#94a3b8', border:'none', borderRadius:6, fontSize:11, fontWeight:700, textDecoration:'none', cursor:'pointer' }}>
                            Ver
                          </a>
                          <button onClick={()=>navigator.clipboard.writeText(item.url)}
                            style={{ padding:'4px 10px', background:'#0D63DB', color:'white', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer' }}>
                            Copiar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Rodapé informativo */}
                  <div style={{ marginTop:14, padding:'12px 14px', background:'rgba(16,185,129,0.08)', border:'1px solid rgba(16,185,129,0.2)', borderRadius:10 }}>
                    <div style={{ fontSize:11, fontWeight:800, color:'#10b981', marginBottom:4 }}>{`💡 Comissões recorrentes — Assinatura ${pNome('top2')}`}</div>
                    <p style={{ margin:0, fontSize:11, color:'#94a3b8', lineHeight:1.6 }}>
                      Enquanto o cliente mantiver a assinatura ativa, você recebe sua comissão todos os meses. Acompanhe de perto o sucesso de uso dos seus indicados — clientes engajados renovam mais e aumentam sua renda recorrente.
                    </p>
                  </div>
                </div>

              </>
          </div>
        )}

        {/* === CARTEIRA === */}
        {aba==='carteira' && (() => {
          const listaClientes = filtroCarteira === 'pagantes'
            ? carteira.filter(c => c.plano && c.plano !== 'gratuito' && c.plano !== 'explorador')
            : filtroCarteira === 'nao_pagantes'
            ? carteira.filter(c => !c.plano || c.plano === 'gratuito' || c.plano === 'explorador')
            : carteira;
          function ContatoCard({ nome, email, whatsapp, userId, plano, data, badge, badgeColor, badgeBg, onVerRespostas, tipo }) {
            const tel = (whatsapp || '').replace(/\D/g,'');
            const telFmt = whatsapp || '';
            const [copiadoTel, setCopiadoTel] = useState(false);
            function copiarTel() { navigator.clipboard.writeText(telFmt); setCopiadoTel(true); setTimeout(()=>setCopiadoTel(false),1500); }
            return (
              <div style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, padding:'14px 16px' }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                  {/* Avatar + Info */}
                  <div style={{ width:38, height:38, borderRadius:19, background: tipo==='lead'?'#fef3c7':'#eff6ff', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}>
                    {tipo==='lead' ? '🎯' : '👤'}
                  </div>
                  <div style={{ flex:1, minWidth:140 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', marginBottom:4 }}>
                      <span style={{ fontWeight:800, fontSize:14, color:'#111111' }}>{nome||'—'}</span>
                      <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:20, background:badgeBg||'#f1f5f9', color:badgeColor||'#64748b', textTransform:'uppercase' }}>{badge}</span>
                    </div>
                    <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                      {email && <span style={{ fontSize:12, color:'#64748b' }}>📧 {email}</span>}
                      {telFmt && (
                        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                          <span style={{ fontSize:12, color:'#64748b' }}>📱 {telFmt}</span>
                          <button onClick={copiarTel} style={{ fontSize:10, background:copiadoTel?'#dcfce7':'#f1f5f9', border:'none', borderRadius:4, padding:'1px 7px', cursor:'pointer', color:copiadoTel?'#166534':'#64748b', fontWeight:700 }}>
                            {copiadoTel ? '✓' : 'copiar'}
                          </button>
                        </div>
                      )}
                      {data && <span style={{ fontSize:11, color:'#94a3b8' }}>📅 {fmtData(data)}</span>}
                    </div>
                  </div>
                  {/* Ações */}
                  <div style={{ display:'flex', gap:6, flexWrap:'wrap', alignItems:'center' }}>
                    <button onClick={()=>{ setMsgModal({ nome, email, user_id: userId }); setMsgForm({ assunto:'', conteudo:'' }); }}
                      style={{ padding:'6px 12px', background:'#eff6ff', color:'#084BA6', border:'1px solid #bfdbfe', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                      ✉ Mensagem
                    </button>
                    <button onClick={()=>{ setReuniaoModal({ nome, email }); setReuniaoForm({ data:'', hora:'10:00', duracao:30 }); setReuniaoLink(''); }}
                      style={{ padding:'6px 12px', background:'#f0fdf4', color:'#15803d', border:'1px solid #bbf7d0', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                      📅 Reunião
                    </button>
                    {onVerRespostas && (
                      <button onClick={onVerRespostas}
                        style={{ padding:'6px 12px', background:'#fef9c3', color:'#92400e', border:'1px solid #fde68a', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                        Respostas
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          }

          return (
            <div>
              {/* Filtro clientes indicados */}
              <div style={{ display:'flex', gap:8, marginBottom:16, alignItems:'center', flexWrap:'wrap' }}>
                {[['todos','Todos'],['pagantes','Pagantes'],['nao_pagantes','Não pagantes']].map(([v,l])=>(
                  <button key={v} onClick={()=>setFiltroCarteira(v)}
                    style={{ padding:'5px 14px', border:'none', borderRadius:20, fontWeight:700, fontSize:12, cursor:'pointer', background:filtroCarteira===v?'#111111':'#f1f5f9', color:filtroCarteira===v?'white':'#475569' }}>
                    {l}
                  </button>
                ))}
                <span style={{ fontSize:12, color:'#94a3b8', marginLeft:4 }}>{listaClientes.length} cliente{listaClientes.length!==1?'s':''}</span>
              </div>

              {listaClientes.length === 0 && leadsSDR.length === 0 ? (
                <div style={{ textAlign:'center', padding:'40px', color:'#94a3b8' }}>
                  <Users size={40} color="#cbd5e1" style={{ margin:'0 auto 12px' }}/>
                  <p>{filtroCarteira==='pagantes' ? 'Nenhum cliente pagante ainda.' : filtroCarteira==='nao_pagantes' ? 'Nenhum cliente gratuito.' : 'Nenhum cliente ainda. Compartilhe seu link de indicação para começar.'}</p>
                </div>
              ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  {listaClientes.map(c => (
                    <ContatoCard key={c.id}
                      nome={c.nome} email={c.email} whatsapp={c.whatsapp||c.telefone} userId={c.id}
                      plano={c.plano} data={c.created_at} tipo="cliente"
                      badge={c.plano && c.plano !== 'gratuito' ? c.plano : 'gratuito'}
                      badgeBg={c.plano && c.plano !== 'gratuito' ? '#d1fae5' : '#f1f5f9'}
                      badgeColor={c.plano && c.plano !== 'gratuito' ? '#059669' : '#64748b'}
                    />
                  ))}
                </div>
              )}

              {/* Leads SDR */}
              {leadsSDR.length > 0 && (
                <div style={{ marginTop:24 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12, paddingTop:20, borderTop:'2px solid #f1f5f9' }}>
                    <span style={{ fontSize:13, fontWeight:800, color:'#475569', textTransform:'uppercase', letterSpacing:0.5 }}>🎯 Leads captados</span>
                    <span style={{ background:'#fef3c7', color:'#92400e', borderRadius:20, padding:'1px 10px', fontSize:11, fontWeight:700 }}>{leadsSDR.length}</span>
                    <span style={{ fontSize:11, color:'#94a3b8' }}>aguardando contato</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {leadsSDR.map(l => (
                      <ContatoCard key={l.id}
                        nome={l.nome} email={l.email} whatsapp={l.whatsapp} userId={l.user_id}
                        data={l.criado_em} tipo="lead"
                        badge={l.sdr_produtos?.nome || 'Lead'}
                        badgeBg="#fef3c7" badgeColor="#92400e"
                        onVerRespostas={() => setLeadDetalhe(l)}
                      />
                    ))}
                  </div>
                </div>
              )}


              {/* Modal: Respostas lead SDR */}
              {leadDetalhe && (
                <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
                  onClick={()=>setLeadDetalhe(null)}>
                  <div style={{ background:'white', borderRadius:14, padding:28, width:'100%', maxWidth:520, maxHeight:'80vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.2)' }}
                    onClick={e=>e.stopPropagation()}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
                      <div style={{ fontSize:16, fontWeight:800 }}>Respostas — {leadDetalhe.nome}</div>
                      <button onClick={()=>setLeadDetalhe(null)} style={{ background:'none', border:'none', fontSize:18, cursor:'pointer', color:'#94a3b8' }}>✕</button>
                    </div>
                    {leadDetalhe.respostas && Object.keys(leadDetalhe.respostas).length > 0 ? (
                      <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                        {(leadDetalhe.sdr_produtos?.perguntas||[]).map(p=>{
                          const r = leadDetalhe.respostas[p.id];
                          return r ? (
                            <div key={p.id} style={{ background:'#f8fafc', borderRadius:8, padding:'12px 14px' }}>
                              <div style={{ fontSize:12, color:'#64748b', marginBottom:4 }}>{p.texto}</div>
                              <div style={{ fontSize:14, fontWeight:700, color:'#111111' }}>{r}</div>
                            </div>
                          ) : null;
                        })}
                      </div>
                    ) : (
                      <div style={{ color:'#94a3b8', fontSize:13, textAlign:'center', padding:'20px 0' }}>Sem respostas de questionário registradas.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

        {/* === COMISSÕES === */}
        {aba==='comissoes' && (() => {
          const lista = filtroComissao === 'todos' ? comissoes : comissoes.filter(c => c.status === filtroComissao);
          return (
            <div>
              <div style={{ display:'flex', gap:8, marginBottom:14, alignItems:'center', flexWrap:'wrap' }}>
                {[['todos','Todas'],['pendente','Pendentes'],['pago','Recebidas'],['cancelado','Canceladas']].map(([v,l])=>(
                  <button key={v} onClick={()=>setFiltroComissao(v)}
                    style={{ padding:'5px 14px', border:'none', borderRadius:20, fontWeight:700, fontSize:12, cursor:'pointer', background:filtroComissao===v?'#111111':'#f1f5f9', color:filtroComissao===v?'white':'#475569' }}>
                    {l}
                  </button>
                ))}
              </div>
              {lista.length === 0 ? (
                <div style={{ textAlign:'center', padding:'50px', color:'#94a3b8' }}>
                  <DollarSign size={40} color="#cbd5e1" style={{ margin:'0 auto 12px' }}/>
                  <p>Nenhuma comissão {filtroComissao!=='todos'?`com status "${filtroComissao}"`:''} registrada ainda.</p>
                </div>
              ) : (
                <div style={{ overflowX:'auto' }}>
                  <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                    <thead>
                      <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                        {['Origem','Referência','Base','%','Comissão','Competência','Status'].map(h=>(
                          <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontWeight:700, color:'#475569', fontSize:11, textTransform:'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {lista.map((c,i)=>(
                        <tr key={c.id} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                          <td style={{ padding:'10px 14px', textTransform:'capitalize' }}>{c.origem}</td>
                          <td style={{ padding:'10px 14px', color:'#475569' }}>{c.referencia||'—'}</td>
                          <td style={{ padding:'10px 14px' }}>R$ {fmt(Number(c.valor_base),0)}</td>
                          <td style={{ padding:'10px 14px' }}>{Number(c.percentual)}%</td>
                          <td style={{ padding:'10px 14px', fontWeight:800, color:'#10b981' }}>R$ {fmt(Number(c.valor_comissao),0)}</td>
                          <td style={{ padding:'10px 14px', color:'#64748b' }}>{c.competencia?fmtData(c.competencia):'—'}</td>
                          <td style={{ padding:'10px 14px' }}>
                            <span style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:20,
                              background: c.status==='pago'?'#d1fae5':c.status==='cancelado'?'#fee2e2':'#fef3c7',
                              color: c.status==='pago'?'#059669':c.status==='cancelado'?'#dc2626':'#92400e' }}>
                              {c.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}
      </div>
      {/* === MODAL: MENSAGEM === */}
      {msgModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={()=>setMsgModal(null)}>
          <div style={{ background:'white', borderRadius:14, padding:28, width:'100%', maxWidth:480, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
              <div>
                <div style={{ fontSize:16, fontWeight:800, color:'#111111' }}>Mensagem para {msgModal.nome}</div>
                {msgModal.email && <div style={{ fontSize:12, color:'#64748b', marginTop:2 }}>{msgModal.email}</div>}
              </div>
              <button onClick={()=>setMsgModal(null)} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
            </div>
            {msgOk ? (
              <div style={{ textAlign:'center', padding:'20px 0' }}>
                <div style={{ fontSize:32, marginBottom:8 }}>✅</div>
                <div style={{ fontWeight:700, color:'#059669' }}>Mensagem enviada com sucesso!</div>
              </div>
            ) : (
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                <div>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:4 }}>Assunto</label>
                  <input value={msgForm.assunto} onChange={e=>setMsgForm(f=>({...f,assunto:e.target.value}))}
                    placeholder="Mensagem do seu consultor"
                    style={{ width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:14, boxSizing:'border-box', outline:'none' }} />
                </div>
                <div>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:4 }}>Mensagem *</label>
                  <textarea value={msgForm.conteudo} onChange={e=>setMsgForm(f=>({...f,conteudo:e.target.value}))}
                    placeholder="Escreva sua mensagem para o cliente…"
                    rows={5}
                    style={{ width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:14, boxSizing:'border-box', outline:'none', resize:'vertical' }} />
                </div>
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end' }}>
                  <button onClick={()=>setMsgModal(null)} style={{ padding:'9px 18px', background:'#f1f5f9', color:'#374151', border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' }}>Cancelar</button>
                  <button onClick={enviarMensagem} disabled={enviandoMsg || !msgForm.conteudo.trim()}
                    style={{ padding:'9px 20px', background:enviandoMsg?'#94a3b8':'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:enviandoMsg?'not-allowed':'pointer' }}>
                    {enviandoMsg ? 'Enviando…' : '✉ Enviar mensagem'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* === MODAL: AGENDAR REUNIÃO === */}
      {reuniaoModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}
          onClick={()=>{ setReuniaoModal(null); setReuniaoInfo(null); }}>
          <div style={{ background:'white', borderRadius:14, padding:28, width:'100%', maxWidth:500, boxShadow:'0 20px 60px rgba(0,0,0,0.25)' }}
            onClick={e=>e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
              <div style={{ fontSize:16, fontWeight:800, color:'#111111' }}>Agendar reunião — {reuniaoModal.nome}</div>
              <button onClick={()=>{ setReuniaoModal(null); setReuniaoInfo(null); }} style={{ background:'none', border:'none', fontSize:20, cursor:'pointer', color:'#94a3b8' }}>✕</button>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:12, marginBottom:16 }}>
              <div style={{ display:'flex', gap:10 }}>
                <div style={{ flex:1 }}>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:4 }}>Data *</label>
                  <input type="date" value={reuniaoForm.data} onChange={e=>setReuniaoForm(f=>({...f,data:e.target.value}))}
                    min={new Date().toISOString().split('T')[0]}
                    style={{ width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:14, boxSizing:'border-box', outline:'none' }} />
                </div>
                <div style={{ width:120 }}>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:4 }}>Horário</label>
                  <input type="time" value={reuniaoForm.hora} onChange={e=>setReuniaoForm(f=>({...f,hora:e.target.value}))}
                    style={{ width:'100%', padding:'9px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:14, boxSizing:'border-box', outline:'none' }} />
                </div>
                <div style={{ width:110 }}>
                  <label style={{ display:'block', fontSize:12, fontWeight:700, color:'#374151', marginBottom:4 }}>Duração</label>
                  <select value={reuniaoForm.duracao} onChange={e=>setReuniaoForm(f=>({...f,duracao:Number(e.target.value)}))}
                    style={{ width:'100%', padding:'9px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, outline:'none' }}>
                    <option value={30}>30 min</option>
                    <option value={45}>45 min</option>
                    <option value={60}>1 hora</option>
                    <option value={90}>1h30</option>
                  </select>
                </div>
              </div>
              <button onClick={criarReuniao} disabled={criandoReuniao || !reuniaoForm.data}
                style={{ padding:'11px', background:criandoReuniao||!reuniaoForm.data?'#94a3b8':'#059669', color:'white', border:'none', borderRadius:10, fontWeight:800, fontSize:14, cursor:criandoReuniao||!reuniaoForm.data?'not-allowed':'pointer' }}>
                {criandoReuniao ? 'Criando sala…' : '📅 Gerar link da reunião'}
              </button>
            </div>
            {reuniaoInfo && (
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {/* Link da sala */}
                <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:10, padding:'14px 16px' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#15803d', marginBottom:8 }}>✅ Sala criada! Envie este link ao cliente:</div>
                  <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    <input readOnly value={reuniaoInfo.link} style={{ flex:1, padding:'8px 10px', border:'1px solid #bbf7d0', borderRadius:8, fontSize:12, background:'white', color:'#111111', outline:'none' }} />
                    <button onClick={()=>navigator.clipboard.writeText(reuniaoInfo.link)}
                      style={{ padding:'8px 14px', background:'#059669', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
                      Copiar
                    </button>
                  </div>
                  <div style={{ marginTop:8, display:'flex', gap:8 }}>
                    {reuniaoModal.email && (
                      <button onClick={()=>{ setReuniaoModal(null); setReuniaoInfo(null); setMsgModal({ nome:reuniaoModal.nome, email:reuniaoModal.email }); setMsgForm({ assunto:'Convite para reunião TSN', conteudo:`Olá ${reuniaoModal.nome}! Segue o link para nossa reunião:\n\n${reuniaoInfo.link}\n\nData: ${reuniaoForm.data} às ${reuniaoForm.hora}\n\nAté lá!` }); }}
                        style={{ flex:1, padding:'8px', background:'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', textAlign:'center' }}>
                        ✉ Enviar por mensagem
                      </button>
                    )}
                    <a href={reuniaoInfo.link} target="_blank" rel="noreferrer"
                      style={{ flex:1, padding:'8px', background:'#111111', color:'white', borderRadius:8, fontWeight:700, fontSize:12, textDecoration:'none', textAlign:'center' }}>
                      Entrar na sala →
                    </a>
                  </div>
                </div>
                {/* Estender tempo */}
                <div style={{ background:'#fef9c3', border:'1px solid #fde68a', borderRadius:10, padding:'12px 14px' }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#92400e', marginBottom:8 }}>⏱ Estender duração da sala</div>
                  <p style={{ fontSize:11, color:'#a16207', margin:'0 0 10px' }}>Use enquanto estiver na reunião para adicionar tempo sem interromper a chamada.</p>
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    {[15, 30, 60].map(min => (
                      <button key={min} onClick={()=>estenderReuniao(min)} disabled={estendendo}
                        style={{ padding:'7px 16px', background: estendendo?'#d1d5db':'#f59e0b', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:estendendo?'not-allowed':'pointer' }}>
                        +{min} min
                      </button>
                    ))}
                  </div>
                  {estendeuMsg && (
                    <div style={{ marginTop:8, fontSize:12, color:'#15803d', fontWeight:600 }}>✅ {estendeuMsg}</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
