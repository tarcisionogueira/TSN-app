import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, DollarSign, Link2, Copy, Check, GraduationCap, Tag,
  TrendingUp, Clock, CheckCircle2, Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { fmt } from '../utils/calculos';

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
      style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 12px', background: ok?'#10b981':'#2563eb', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:12, cursor:'pointer', whiteSpace:'nowrap' }}>
      {ok ? <><Check size={13}/> Copiado</> : <><Copy size={13}/> Copiar</>}
    </button>
  );
}

export default function Consultor() {
  const nav = useNavigate();
  const { user, role, loading: authLoading } = useAuth();
  const podeVer = ROLES_CONSULTOR.includes(role);

  const [perfil, setPerfil] = useState(null);
  const [carteira, setCarteira] = useState([]);
  const [comissoes, setComissoes] = useState([]);
  const [cursos, setCursos] = useState([]);
  const [planosConfig, setPlanosConfig] = useState([]);
  const [linksPromo, setLinksPromo] = useState([]);
  const [novoPromo, setNovoPromo] = useState({ produto: 'top1', desconto_pct: '', descricao_condicoes: '' });
  const [salvandoPromo, setSalvandoPromo] = useState(false);
  const [linksConvite, setLinksConvite] = useState([]);
  const [copiandoConvite, setCopiandoConvite] = useState('');
  const [aba, setAba] = useState('material'); // 'material' | 'carteira' | 'comissoes'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !podeVer) { setLoading(false); return; }
    async function load() {
      const [{ data: p }, { data: cli }, { data: com }, { data: cs }, { data: lp }, { data: lc }, { data: pc }] = await Promise.all([
        supabase.from('perfis').select('codigo_indicacao, comissao_afiliado_pct, asaas_wallet_id').eq('id', user.id).single(),
        supabase.from('perfis').select('id, nome, role, plano, created_at').eq('indicado_por', user.id).order('created_at', { ascending: false }),
        supabase.from('comissoes').select('*').eq('beneficiario_id', user.id).order('created_at', { ascending: false }),
        supabase.from('cursos_admin').select('id, titulo, subtitulo, preco, emoji, cor').eq('ativo', true).order('ordem'),
        supabase.from('links_promo').select('*').eq('criado_por', user.id).order('criado_em', { ascending: false }),
        supabase.from('links_convite').select('*').eq('criado_por', user.id).order('criado_em', { ascending: false }),
        supabase.from('planos_config').select('plano_key,nome,preco,preco_vista').eq('ativo', true),
      ]);
      setPerfil(p || null);
      setCarteira(cli || []);
      setComissoes(com || []);
      setCursos(cs || []);
      setPlanosConfig(pc || []);
      setLinksPromo(lp || []);
      setLinksConvite(lc || []);
      setLoading(false);
    }
    load();
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
        <h2 style={{ color:'#0f172a' }}>Acesso restrito</h2>
        <p style={{ color:'#64748b' }}>Faça login para acessar o painel do consultor.</p>
        <button onClick={()=>nav('/login')} style={{ padding:'10px 20px', background:'#2563eb', color:'white', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer' }}>Entrar</button>
      </div>
    );
  }

  if (!podeVer) {
    return (
      <div style={{ maxWidth:520, margin:'80px auto', textAlign:'center', padding:'0 20px' }}>
        <h2 style={{ color:'#0f172a' }}>Programa de Consultores</h2>
        <p style={{ color:'#64748b' }}>Esta área é exclusiva para consultores parceiros da TSN. Fale com a equipe para se tornar um consultor e ganhar comissões recorrentes indicando clientes.</p>
        <a href="mailto:tarcisioaraujo@reimob.com.br" style={{ display:'inline-block', marginTop:8, padding:'10px 20px', background:'#2563eb', color:'white', borderRadius:10, fontWeight:700, textDecoration:'none' }}>Quero ser consultor</a>
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

  const PRODUTOS_NOME = { top1: 'Investidor', top2: 'Investidor Pro', assessorado: 'Assessorado', clube: 'Leilão Club' };

  const PLANOS_VENDA = [
    { key: 'top1',              nome: 'Investidor',                  precoLabel: 'R$ 49,90/mês' },
    { key: 'assessorado',       nome: 'Assessorado',                 precoLabel: '12× R$ 500' },
    { key: 'assessorado_vista', nome: 'Assessorado (À Vista)',        precoLabel: 'R$ 5.000' },
    { key: 'clube',             nome: 'Clube de Negócios',            precoLabel: 'R$ 5.000/mês' },
    { key: 'clube_vista',       nome: 'Clube de Negócios (À Vista)', precoLabel: 'R$ 48.000' },
  ];

  const planosVenda = planosConfig.length > 0
    ? planosConfig.map(p => ({
        key: p.plano_key,
        nome: p.nome,
        precoLabel: p.preco ? `R$ ${Number(p.preco).toFixed(2).replace('.',',')}` : (PLANOS_VENDA.find(x => x.key === p.plano_key)?.precoLabel || ''),
      }))
    : PLANOS_VENDA;

  const codigo = perfil?.codigo_indicacao;
  const origin = window.location.origin;
  const pct = Number(perfil?.comissao_afiliado_pct || 0);

  const linkBase = codigo ? `${origin}/#/login?ref=${codigo}` : '';
  const linkPlanos = codigo ? `${origin}/#/planos?ref=${codigo}` : '';

  // Comissões: totais
  const totalPendente = comissoes.filter(c=>c.status==='pendente').reduce((s,c)=>s+Number(c.valor_comissao),0);
  const totalPago     = comissoes.filter(c=>c.status==='pago').reduce((s,c)=>s+Number(c.valor_comissao),0);
  const clientesPagantes = carteira.filter(c => c.plano && c.plano !== 'gratuito').length;

  const tabBtn = (id, label) => (
    <button onClick={()=>setAba(id)}
      style={{ padding:'10px 20px', border:'none', background: aba===id ? '#0f172a' : 'transparent', color: aba===id ? 'white' : '#64748b', fontWeight:700, fontSize:14, cursor:'pointer', borderRadius:'10px 10px 0 0', borderBottom: aba===id ? 'none' : '2px solid #e2e8f0' }}>
      {label}
    </button>
  );

  return (
    <div style={{ maxWidth:1100, margin:'0 auto', padding:'24px 20px' }}>
      <div style={{ marginBottom:20 }}>
        <h1 style={{ margin:0, fontSize:24, fontWeight:900, color:'#0f172a' }}>Painel do Consultor</h1>
        <p style={{ margin:'4px 0 0', fontSize:13, color:'#64748b' }}>Indique clientes e ganhe comissões recorrentes enquanto eles forem pagantes.</p>
      </div>

      {/* KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))', gap:10, marginBottom:20 }}>
        {[
          { l:'Clientes na carteira', v: carteira.length, c:'#2563eb', bg:'#eff6ff', icon:Users },
          { l:'Clientes pagantes', v: clientesPagantes, c:'#8b5cf6', bg:'#ede9fe', icon:TrendingUp },
          { l:'Comissão pendente', v:`R$ ${fmt(totalPendente,0)}`, c:'#f59e0b', bg:'#fffbeb', icon:Clock },
          { l:'Comissão recebida', v:`R$ ${fmt(totalPago,0)}`, c:'#10b981', bg:'#f0fdf4', icon:CheckCircle2 },
        ].map(k=>(
          <div key={k.l} style={{ background:k.bg, borderRadius:12, padding:'14px 16px', border:`1px solid ${k.c}20` }}>
            <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, fontWeight:700, color:k.c, textTransform:'uppercase', marginBottom:6 }}>
              <k.icon size={13}/> {k.l}
            </div>
            <div style={{ fontSize:20, fontWeight:900, color:'#0f172a' }}>{k.v}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:0, borderBottom:'2px solid #e2e8f0' }}>
        {tabBtn('material', '🔗 Material de Divulgação')}
        {tabBtn('carteira', `👥 Carteira (${carteira.length})`)}
        {tabBtn('comissoes', `💰 Comissões (${comissoes.length})`)}
      </div>

      <div style={{ background:'white', borderRadius:'0 12px 12px 12px', border:'1px solid #e2e8f0', borderTop:'none', padding:'20px' }}>

        {/* === MATERIAL DE DIVULGAÇÃO === */}
        {aba==='material' && (
          <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
            {!codigo ? (
              <div style={{ textAlign:'center', padding:'30px' }}>
                <Link2 size={40} color="#cbd5e1" style={{ margin:'0 auto 12px' }}/>
                <p style={{ color:'#64748b', marginBottom:16 }}>Você ainda não tem um código de indicação.</p>
                <button onClick={gerarCodigo} style={{ padding:'10px 22px', background:'#2563eb', color:'white', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer' }}>
                  Gerar meu código
                </button>
              </div>
            ) : (
              <>
                {/* Seu código */}
                <div style={{ background:'#f0fdf4', border:'1px solid #bbf7d0', borderRadius:12, padding:'16px 18px' }}>
                  <div style={{ fontSize:11, fontWeight:800, color:'#059669', textTransform:'uppercase', marginBottom:4 }}>Seu código de indicação</div>
                  <div style={{ display:'flex', alignItems:'center', gap:12, flexWrap:'wrap' }}>
                    <span style={{ fontSize:26, fontWeight:900, color:'#0f172a', letterSpacing:2 }}>{codigo}</span>
                    <span style={{ fontSize:12, color:'#64748b' }}>Comissão de <strong>{pct}%</strong> sobre produtos e assinaturas, enquanto o cliente pagar.</span>
                  </div>
                </div>

                {/* Link geral */}
                <div>
                  <div style={{ fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:8 }}>Link geral de indicação</div>
                  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                    <input readOnly value={linkBase} style={{ flex:1, minWidth:240, padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#334155', background:'#f8fafc' }}/>
                    <CopyBtn texto={linkBase}/>
                  </div>
                </div>

                {/* Planos */}
                <div>
                  <div style={{ fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:10 }}>📋 Planos</div>
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:12 }}>
                    {planosVenda.map(pl => {
                      const link = `${origin}/#/p/plano/${pl.key}?ref=${codigo}`;
                      return (
                        <div key={pl.key} style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, padding:16 }}>
                          <div style={{ fontWeight:700, color:'#0f172a', fontSize:14, marginBottom:4 }}>{pl.nome}</div>
                          <div style={{ fontSize:13, color:'#2563eb', fontWeight:600, marginBottom:12 }}>{pl.precoLabel}</div>
                          <div style={{ display:'flex', gap:8 }}>
                            <CopyBtn texto={link}/>
                            <a href={link} target="_blank" rel="noreferrer"
                              style={{ padding:'8px 12px', border:'1px solid #2563eb', color:'#2563eb', borderRadius:8, fontWeight:700, fontSize:12, textDecoration:'none', whiteSpace:'nowrap' }}>
                              Ver página
                            </a>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Cursos */}
                <div>
                  <div style={{ fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:10 }}>🎓 Cursos</div>
                  {cursos.length === 0 ? (
                    <p style={{ fontSize:13, color:'#94a3b8' }}>Nenhum curso disponível no momento.</p>
                  ) : (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(240px, 1fr))', gap:12 }}>
                      {cursos.map(c => {
                        const link = `${origin}/#/p/curso/${c.id}?ref=${codigo}`;
                        return (
                          <div key={c.id} style={{ background:'white', border:'1px solid #e2e8f0', borderRadius:12, padding:16 }}>
                            <div style={{ fontWeight:700, color:'#0f172a', fontSize:14, marginBottom:4 }}>
                              {c.emoji ? `${c.emoji} ` : ''}{c.titulo}
                            </div>
                            <div style={{ fontSize:13, color:'#2563eb', fontWeight:600, marginBottom:12 }}>
                              {Number(c.preco) > 0 ? `R$ ${fmt(Number(c.preco), 0)}` : 'Gratuito'}
                            </div>
                            <div style={{ display:'flex', gap:8 }}>
                              <CopyBtn texto={link}/>
                              <a href={link} target="_blank" rel="noreferrer"
                                style={{ padding:'8px 12px', border:'1px solid #2563eb', color:'#2563eb', borderRadius:8, fontWeight:700, fontSize:12, textDecoration:'none', whiteSpace:'nowrap' }}>
                                Ver página
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Links de convite */}
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase' }}>
                      🎯 Links de convite
                    </div>
                    <button onClick={gerarConvite} style={{ padding:'5px 12px', background:'#0f172a', color:'white', border:'none', borderRadius:6, fontSize:12, fontWeight:700, cursor:'pointer' }}>
                      + Gerar convite
                    </button>
                  </div>
                  <p style={{ fontSize:12, color:'#94a3b8', marginBottom:8 }}>Convites vinculam o novo usuário a você como indicador.</p>
                  {linksConvite.length === 0 ? (
                    <p style={{ fontSize:13, color:'#94a3b8' }}>Nenhum convite gerado ainda.</p>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      {linksConvite.map(c => {
                        const convUrl = `${origin}/#/convite/${c.codigo}`;
                        return (
                          <div key={c.id} style={{ padding:'12px 14px', border:`1px solid ${c.ativo?'#e2e8f0':'#fecaca'}`, borderRadius:10, background:c.ativo?'white':'#fff5f5' }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8, flexWrap:'wrap' }}>
                              <div>
                                <span style={{ fontFamily:'monospace', fontWeight:900, fontSize:14, color:'#0f172a', marginRight:8 }}>{c.codigo}</span>
                                <span style={{ fontSize:12, color:'#64748b' }}>{c.usos} uso{c.usos!==1?'s':''}</span>
                                {!c.ativo && <span style={{ fontSize:11, color:'#dc2626', fontWeight:700, marginLeft:6 }}>INATIVO</span>}
                              </div>
                              <div style={{ display:'flex', gap:6 }}>
                                <button onClick={() => copiarConvite(c.codigo)} style={{ padding:'5px 10px', background:copiandoConvite===c.codigo?'#dcfce7':'#f1f5f9', border:'none', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', color:copiandoConvite===c.codigo?'#166534':'#374151' }}>
                                  {copiandoConvite===c.codigo?'✓ Copiado':'Copiar link'}
                                </button>
                                <button onClick={() => toggleConvite(c)} style={{ padding:'5px 10px', background:c.ativo?'#fee2e2':'#dcfce7', border:'none', borderRadius:6, fontSize:11, fontWeight:700, color:c.ativo?'#dc2626':'#166534', cursor:'pointer' }}>
                                  {c.ativo?'Desativar':'Ativar'}
                                </button>
                              </div>
                            </div>
                            <div style={{ marginTop:4, fontSize:11, color:'#94a3b8', fontFamily:'monospace', wordBreak:'break-all' }}>{convUrl}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Links Promocionais */}
                <div style={{ borderTop:'2px solid #e2e8f0', paddingTop:18 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:12 }}>
                    <Tag size={13}/> Links Promocionais com Desconto
                  </div>

                  <div style={{ background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10, padding:'14px 16px', marginBottom:14 }}>
                    <div style={{ fontSize:12, fontWeight:700, color:'#475569', marginBottom:10 }}>Criar novo link promocional</div>
                    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                      <select value={novoPromo.produto} onChange={e => setNovoPromo(p=>({...p, produto:e.target.value}))}
                        style={{ padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#0f172a', background:'white' }}>
                        {Object.entries(PRODUTOS_NOME).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                      <input type="number" value={novoPromo.desconto_pct} onChange={e => setNovoPromo(p=>({...p,desconto_pct:e.target.value}))}
                        placeholder="Desconto %" min="0" max="100"
                        style={{ padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#0f172a' }} />
                    </div>
                    <textarea value={novoPromo.descricao_condicoes} onChange={e => setNovoPromo(p=>({...p,descricao_condicoes:e.target.value}))}
                      placeholder="Condições promocionais (ex: '30% de desconto no 1º mês para novos clientes indicados por você')"
                      rows={2} style={{ width:'100%', padding:'8px 10px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#0f172a', resize:'vertical', boxSizing:'border-box', marginBottom:10 }}/>
                    <button onClick={criarLinkPromo} disabled={salvandoPromo}
                      style={{ padding:'8px 20px', background:'#2563eb', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer' }}>
                      {salvandoPromo ? 'Gerando…' : '+ Gerar link'}
                    </button>
                  </div>

                  {linksPromo.length === 0 ? (
                    <p style={{ fontSize:13, color:'#94a3b8' }}>Nenhum link promocional criado ainda.</p>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      {linksPromo.map(lp => {
                        const lpUrl = `${origin}/#/promo/${lp.codigo}`;
                        return (
                          <div key={lp.id} style={{ padding:'12px 14px', border:`1px solid ${lp.ativo?'#e2e8f0':'#fecaca'}`, borderRadius:10, background:lp.ativo?'white':'#fff5f5' }}>
                            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8, flexWrap:'wrap' }}>
                              <div>
                                <span style={{ fontFamily:'monospace', fontWeight:900, fontSize:14, color:'#0f172a', marginRight:8 }}>{lp.codigo}</span>
                                <span style={{ fontSize:12, color:'#2563eb', fontWeight:700 }}>{PRODUTOS_NOME[lp.produto]}</span>
                                {lp.desconto_pct > 0 && <span style={{ fontSize:12, color:'#059669', fontWeight:700, marginLeft:6 }}>{lp.desconto_pct}% off</span>}
                                {!lp.ativo && <span style={{ fontSize:11, color:'#dc2626', fontWeight:700, marginLeft:6 }}>INATIVO</span>}
                              </div>
                              <div style={{ display:'flex', gap:6 }}>
                                <CopyBtn texto={lpUrl}/>
                                <button onClick={() => togglePromo(lp)}
                                  style={{ padding:'5px 10px', background:lp.ativo?'#fee2e2':'#dcfce7', border:'none', borderRadius:6, fontSize:11, fontWeight:700, color:lp.ativo?'#dc2626':'#166534', cursor:'pointer' }}>
                                  {lp.ativo?'Desativar':'Ativar'}
                                </button>
                              </div>
                            </div>
                            {lp.descricao_condicoes && <div style={{ marginTop:6, fontSize:12, color:'#64748b' }}>📋 {lp.descricao_condicoes}</div>}
                            <div style={{ marginTop:4, fontSize:11, color:'#94a3b8', fontFamily:'monospace', wordBreak:'break-all' }}>{lpUrl}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* === CARTEIRA === */}
        {aba==='carteira' && (
          carteira.length === 0 ? (
            <div style={{ textAlign:'center', padding:'50px', color:'#94a3b8' }}>
              <Users size={40} color="#cbd5e1" style={{ margin:'0 auto 12px' }}/>
              <p>Nenhum cliente na sua carteira ainda. Compartilhe seu link de indicação para começar.</p>
            </div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
                <thead>
                  <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                    {['Cliente','Plano','Cadastro'].map(h=>(
                      <th key={h} style={{ padding:'10px 14px', textAlign:'left', fontWeight:700, color:'#475569', fontSize:11, textTransform:'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {carteira.map((c,i)=>(
                    <tr key={c.id} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                      <td style={{ padding:'12px 14px', fontWeight:700, color:'#0f172a' }}>{c.nome||'—'}</td>
                      <td style={{ padding:'12px 14px' }}>
                        <span style={{ fontSize:11, fontWeight:700, padding:'3px 9px', borderRadius:20, background: c.plano&&c.plano!=='gratuito'?'#d1fae5':'#f1f5f9', color: c.plano&&c.plano!=='gratuito'?'#059669':'#64748b', textTransform:'uppercase' }}>
                          {c.plano || 'gratuito'}
                        </span>
                      </td>
                      <td style={{ padding:'12px 14px', color:'#64748b' }}>{fmtData(c.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {/* === COMISSÕES === */}
        {aba==='comissoes' && (
          comissoes.length === 0 ? (
            <div style={{ textAlign:'center', padding:'50px', color:'#94a3b8' }}>
              <DollarSign size={40} color="#cbd5e1" style={{ margin:'0 auto 12px' }}/>
              <p>Nenhuma comissão registrada ainda. Elas aparecem aqui quando seus clientes pagam produtos ou assinaturas.</p>
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
                  {comissoes.map((c,i)=>(
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
          )
        )}
      </div>
    </div>
  );
}
