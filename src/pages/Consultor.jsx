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
  const { user, role } = useAuth();
  const podeVer = ROLES_CONSULTOR.includes(role);

  const [perfil, setPerfil] = useState(null);
  const [carteira, setCarteira] = useState([]);
  const [comissoes, setComissoes] = useState([]);
  const [cursos, setCursos] = useState([]);
  const [aba, setAba] = useState('material'); // 'material' | 'carteira' | 'comissoes'
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !podeVer) { setLoading(false); return; }
    async function load() {
      const [{ data: p }, { data: cli }, { data: com }, { data: cs }] = await Promise.all([
        supabase.from('perfis').select('codigo_indicacao, comissao_afiliado_pct, asaas_wallet_id').eq('id', user.id).single(),
        supabase.from('perfis').select('id, nome, role, plano, created_at').eq('indicado_por', user.id).order('created_at', { ascending: false }),
        supabase.from('comissoes').select('*').eq('beneficiario_id', user.id).order('created_at', { ascending: false }),
        supabase.from('cursos_admin').select('id, titulo, preco').eq('ativo', true).order('ordem'),
      ]);
      setPerfil(p || null);
      setCarteira(cli || []);
      setComissoes(com || []);
      setCursos(cs || []);
      setLoading(false);
    }
    load();
  }, [user, podeVer]);

  const gerarCodigo = async () => {
    const { data } = await supabase.rpc('gerar_codigo_indicacao', { p_id: user.id });
    if (data) setPerfil(p => ({ ...p, codigo_indicacao: data }));
  };

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

  if (loading) return <div style={{ textAlign:'center', padding:'80px', color:'#94a3b8' }}>Carregando…</div>;

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

                {/* Link mensalidade/planos */}
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:8 }}>
                    <Tag size={13}/> Link de assinaturas (mensalidade)
                  </div>
                  <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                    <input readOnly value={linkPlanos} style={{ flex:1, minWidth:240, padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:8, fontSize:13, color:'#334155', background:'#f8fafc' }}/>
                    <CopyBtn texto={linkPlanos}/>
                  </div>
                </div>

                {/* Links de cursos */}
                <div>
                  <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, fontWeight:800, color:'#475569', textTransform:'uppercase', marginBottom:8 }}>
                    <GraduationCap size={13}/> Links de cursos
                  </div>
                  {cursos.length === 0 ? (
                    <p style={{ fontSize:13, color:'#94a3b8' }}>Nenhum curso disponível no momento.</p>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                      {cursos.map(c => {
                        const link = `${origin}/#/membros/curso/${c.id}?ref=${codigo}`;
                        return (
                          <div key={c.id} style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', padding:'10px 12px', border:'1px solid #e2e8f0', borderRadius:8 }}>
                            <div style={{ flex:1, minWidth:180 }}>
                              <div style={{ fontWeight:700, color:'#0f172a', fontSize:13 }}>{c.titulo}</div>
                              <div style={{ fontSize:11, color:'#64748b' }}>{Number(c.preco)>0?`R$ ${fmt(Number(c.preco),0)}`:'Gratuito'}</div>
                            </div>
                            <CopyBtn texto={link}/>
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
