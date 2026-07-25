// MINHA REDE (Programa de Parceiros) — o parceiro vê seu link, seus números e a ÁRVORE de
// indicações (quem ele indicou e, se viraram parceiros, a rede abaixo deles). Por LGPD, a
// árvore vem da RPC `minha_rede` (SECURITY DEFINER) SEM nenhum dado de contato: só nome e
// cidade/UF. Um parceiro só enxerga a PRÓPRIA sub-árvore; o admin pode ver a de qualquer um.
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { Users, Copy, Check, ChevronRight, ChevronDown, Award, Search, Network } from 'lucide-react';

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px' };

function Nodo({ nodo, filhosDe, expandido, toggle, nivel }) {
  const filhos = filhosDe(nodo.id);
  const temFilhos = filhos.length > 0;
  const aberto = expandido[nodo.id] !== false; // aberto por padrão
  return (
    <div style={{ marginLeft: nivel === 0 ? 0 : 18, borderLeft: nivel === 0 ? 'none' : '1px solid #ede9fe', paddingLeft: nivel === 0 ? 0 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0' }}>
        {temFilhos ? (
          <button onClick={() => toggle(nodo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', display: 'flex', padding: 0 }}>
            {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : <span style={{ width: 16, display: 'inline-block' }} />}
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: nodo.parceiro ? '#7c3aed' : '#e2e8f0', color: nodo.parceiro ? 'white' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
          {(nodo.nome || '?')[0].toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {nodo.nome}
            {nodo.parceiro && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: '#6d28d9', background: '#f5f3ff', borderRadius: 999, padding: '1px 7px' }}>PARCEIRO</span>}
          </div>
          <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{nodo.cidade_uf || 'cidade não informada'}{Number(nodo.n_indicados) > 0 ? ` · ${nodo.n_indicados} indicado${nodo.n_indicados > 1 ? 's' : ''}` : ''}</div>
        </div>
      </div>
      {temFilhos && aberto && filhos.map(f => (
        <Nodo key={f.id} nodo={f} filhosDe={filhosDe} expandido={expandido} toggle={toggle} nivel={nivel + 1} />
      ))}
    </div>
  );
}

export default function MinhaRede() {
  const { user, effectiveUserId, effectiveRole } = useAuth();
  const isAdmin = effectiveRole === 'admin';
  const uid = effectiveUserId || user?.id;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [codigo, setCodigo] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [expandido, setExpandido] = useState({});
  const [rootId, setRootId] = useState(null); // admin: ver a rede de outro parceiro
  const [rootNome, setRootNome] = useState('');
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState([]);

  const linkIndicacao = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/planos?ref=${codigo || uid || ''}`;
  const linkDisplay = linkIndicacao.replace(/^https?:\/\/(www\.)?/, '');
  const copiar = () => { navigator.clipboard?.writeText(linkIndicacao); setCopiado(true); setTimeout(() => setCopiado(false), 2000); };

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc('minha_rede', rootId ? { p_root: rootId } : {});
      setRows(Array.isArray(data) ? data : []);
    } catch { setRows([]); }
    setLoading(false);
  }, [rootId]);
  useEffect(() => { carregar(); }, [carregar]);

  useEffect(() => {
    if (!uid) return;
    supabase.from('perfis').select('codigo_indicacao').eq('id', uid).maybeSingle()
      .then(({ data }) => { if (data?.codigo_indicacao) setCodigo(data.codigo_indicacao); });
  }, [uid]);

  const buscarParceiro = async (q) => {
    setBusca(q);
    if (!isAdmin || q.trim().length < 2) { setResultados([]); return; }
    const { data } = await supabase.from('perfis').select('id, nome').ilike('nome', `%${q.trim()}%`).limit(8);
    setResultados(Array.isArray(data) ? data : []);
  };

  const raiz = rows.find(r => r.nivel === 0);
  const filhosDe = (id) => rows.filter(r => r.parent_id === id).sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const toggle = (id) => setExpandido(e => ({ ...e, [id]: e[id] === false ? true : false }));
  const rede = rows.filter(r => r.nivel >= 1);
  const diretos = rede.filter(r => r.nivel === 1).length;
  const parceirosRede = rede.filter(r => r.parceiro).length;

  const Stat = ({ n, label, cor }) => (
    <div style={{ ...card, textAlign: 'center', padding: '16px 12px' }}>
      <div style={{ fontSize: 26, fontWeight: 900, color: cor }}>{n}</div>
      <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Cabeçalho / apresentação */}
      <div style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)', borderRadius: 18, padding: '24px 24px', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Network size={22} /><div style={{ fontSize: 22, fontWeight: 900 }}>Minha Rede</div></div>
        <div style={{ fontSize: 13.5, opacity: 0.95, marginTop: 8, lineHeight: 1.6 }}>
          Indique investidores para a BidPro e ganhe comissões recorrentes — inclusive quando os seus indicados também viram parceiros e trazem novas pessoas. Acompanhe abaixo a sua rede.
        </div>
      </div>

      {/* Link de indicação */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 8 }}>Seu link de indicação</div>
        <div style={{ background: '#faf5ff', border: '1px solid #ede9fe', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#6d28d9', wordBreak: 'break-all', fontFamily: 'monospace', marginBottom: 10 }}>{linkDisplay}</div>
        <button onClick={copiar} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: '#7c3aed', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
          {copiado ? <><Check size={16} /> Link copiado!</> : <><Copy size={16} /> Copiar meu link</>}
        </button>
      </div>

      {/* Admin: ver a rede de outro parceiro */}
      {isAdmin && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 8 }}>👑 Admin — ver a rede de um parceiro</div>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px' }}>
              <Search size={15} color="#94a3b8" />
              <input value={busca} onChange={e => buscarParceiro(e.target.value)} placeholder="Buscar por nome…"
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13, color: '#111', background: 'transparent' }} />
              {(rootId) && <button onClick={() => { setRootId(null); setRootNome(''); setBusca(''); setResultados([]); }} style={{ fontSize: 11, color: '#7c3aed', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>ver a minha</button>}
            </div>
            {resultados.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden' }}>
                {resultados.map(r => (
                  <button key={r.id} onClick={() => { setRootId(r.id); setRootNome(r.nome); setResultados([]); setBusca(r.nome); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'white', cursor: 'pointer', fontSize: 13, color: '#334155' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    {r.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
          {rootNome && <div style={{ fontSize: 12, color: '#6d28d9', marginTop: 8, fontWeight: 700 }}>Exibindo a rede de: {rootNome}</div>}
        </div>
      )}

      {/* Números */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Stat n={diretos} label="Indicados diretos" cor="#7c3aed" />
        <Stat n={rede.length} label="Rede total" cor="#0D63DB" />
        <Stat n={parceirosRede} label="Viraram parceiros" cor="#059669" />
      </div>

      {/* Árvore */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Users size={18} color="#7c3aed" />
          <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>Árvore de indicações</div>
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
          Por privacidade (LGPD), mostramos apenas <strong>nome e cidade</strong> de cada pessoa da sua rede — nunca telefone, e-mail ou contato.
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Carregando sua rede…</div>
        ) : !raiz || rede.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Você ainda não tem indicados. Compartilhe seu link acima para começar a formar sua rede.
          </div>
        ) : (
          <div>{filhosDe(raiz.id).map(f => (
            <Nodo key={f.id} nodo={f} filhosDe={filhosDe} expandido={expandido} toggle={toggle} nivel={0} />
          ))}</div>
        )}
      </div>

      <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', lineHeight: 1.6 }}>
        <Award size={13} style={{ verticalAlign: -2 }} /> A comissão de cada indicado é sua nos meses em que sua assinatura está em dia na data da cobrança dele. O acompanhamento financeiro fica em <strong>Comissões</strong>.
      </div>
    </div>
  );
}
