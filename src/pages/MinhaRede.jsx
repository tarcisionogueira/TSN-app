// PROGRAMA DE PARCEIROS — BidPro Brasil. Aqui o parceiro: (1) vê a apresentação comercial e
// pega seu link; (2) acompanha SEU NÍVEL (Comissão de Indicação + o que falta p/ subir); (3) vê o
// saldo a receber e, para SACAR, cadastra a PJ que vai receber (modelo B2B); (4) vê a ÁRVORE de
// indicações (LGPD: só nome e cidade). O esquema de níveis fica "sob o capô" — nada de jargão de
// "multinível" na porta. Números do nível vêm da RPC `meu_nivel` (auth.uid — só o próprio).
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { Users, Copy, Check, ChevronRight, ChevronDown, Award, Search, Network, Wallet, Building2, Lock, ArrowRight, Sparkles } from 'lucide-react';

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px' };
const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

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

  // Nível + financeiro (do próprio parceiro)
  const [nivel, setNivel] = useState(null);           // retorno de meu_nivel()
  const [saldo, setSaldo] = useState(0);
  const [faltando, setFaltando] = useState([]);       // pré-requisitos do saque (inclui empresa/CNPJ p/ parceiro)
  const [naoGanhaNovas, setNaoGanhaNovas] = useState(false);
  const [proximaLib, setProximaLib] = useState(null);
  // Cadastro da PJ
  const [pj, setPj] = useState({ cnpj: '', razao_social: '', pj_chave_pix: '' });
  const [pjSalva, setPjSalva] = useState(false);
  const [salvandoPj, setSalvandoPj] = useState(false);
  const [msgPj, setMsgPj] = useState(null);
  // Saque
  const [valorSaque, setValorSaque] = useState('');
  const [msgSaque, setMsgSaque] = useState(null);
  const [sacando, setSacando] = useState(false);

  const linkIndicacao = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/planos?ref=${codigo || uid || ''}`;
  const linkDisplay = linkIndicacao.replace(/^https?:\/\/(www\.)?/, '');
  const copiar = () => { navigator.clipboard?.writeText(linkIndicacao); setCopiado(true); setTimeout(() => setCopiado(false), 2000); };
  const fmtLib = (iso) => { try { return new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).format(new Date(iso)); } catch { return null; } };

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc('minha_rede', rootId ? { p_root: rootId } : {});
      setRows(Array.isArray(data) ? data : []);
    } catch { setRows([]); }
    setLoading(false);
  }, [rootId]);
  useEffect(() => { carregar(); }, [carregar]);

  // Nível + saldo + PJ (só do próprio usuário logado — não muda com a busca do admin)
  const carregarMeu = useCallback(async () => {
    if (!uid) return;
    try {
      const { data: n } = await supabase.rpc('meu_nivel');
      setNivel(n && n.ok ? n : null);
    } catch { setNivel(null); }
    try {
      const res = await apiCall('/api/saque');
      const sq = await res.json();
      setSaldo(Number(sq.saldo || 0));
      setFaltando(Array.isArray(sq.faltando) ? sq.faltando : []);
      setNaoGanhaNovas(!!sq.nao_ganha_novas);
      setProximaLib(sq.proxima_liberacao || null);
    } catch { /* mantém zeros */ }
    try {
      const { data: p } = await supabase.from('perfis').select('codigo_indicacao, cnpj, razao_social, pj_chave_pix').eq('id', uid).maybeSingle();
      if (p?.codigo_indicacao) setCodigo(p.codigo_indicacao);
      const temPj = !!(p?.cnpj);
      setPj({ cnpj: p?.cnpj || '', razao_social: p?.razao_social || '', pj_chave_pix: p?.pj_chave_pix || '' });
      setPjSalva(temPj);
    } catch { /* ignora */ }
  }, [uid]);
  useEffect(() => { carregarMeu(); }, [carregarMeu]);

  const buscarParceiro = async (q) => {
    setBusca(q);
    if (!isAdmin || q.trim().length < 2) { setResultados([]); return; }
    const { data } = await supabase.from('perfis').select('id, nome').ilike('nome', `%${q.trim()}%`).limit(8);
    setResultados(Array.isArray(data) ? data : []);
  };

  async function salvarPj() {
    setSalvandoPj(true); setMsgPj(null);
    const payload = {
      cnpj: (pj.cnpj || '').trim(),
      razao_social: (pj.razao_social || '').trim(),
      pj_chave_pix: (pj.pj_chave_pix || '').trim(),
    };
    if (!payload.cnpj || !payload.razao_social || !payload.pj_chave_pix) {
      setMsgPj({ tipo: 'erro', txt: 'Preencha CNPJ, razão social e a chave PIX da empresa.' });
      setSalvandoPj(false); return;
    }
    const { error } = await supabase.from('perfis').update(payload).eq('id', uid);
    if (error) setMsgPj({ tipo: 'erro', txt: 'Erro ao salvar os dados da empresa.' });
    else { setPjSalva(true); setMsgPj({ tipo: 'ok', txt: 'Empresa cadastrada! Você já pode solicitar o saque.' }); carregarMeu(); }
    setSalvandoPj(false);
    setTimeout(() => setMsgPj(null), 4000);
  }

  async function solicitarSaque() {
    const valor = Number(valorSaque);
    if (!valor || valor <= 0) { setMsgSaque({ tipo: 'erro', txt: 'Informe um valor válido.' }); return; }
    if (valor > saldo) { setMsgSaque({ tipo: 'erro', txt: 'Valor maior que o disponível.' }); return; }
    setSacando(true); setMsgSaque(null);
    try {
      const res = await apiCall('/api/saque', { method: 'POST', body: JSON.stringify({ valor }) });
      const data = await res.json();
      if (res.ok) {
        const lib = fmtLib(proximaLib);
        setMsgSaque({ tipo: 'ok', txt: `Saque solicitado! Pagamento ${lib ? `na ${lib}` : 'na próxima sexta'}. Saldo restante: ${fmtBRL(data.saldo_restante)}` });
        setValorSaque(''); carregarMeu();
      } else setMsgSaque({ tipo: 'erro', txt: data.error || 'Não foi possível solicitar o saque.' });
    } catch { setMsgSaque({ tipo: 'erro', txt: 'Erro ao solicitar saque.' }); }
    setSacando(false);
    setTimeout(() => setMsgSaque(null), 6000);
  }

  const raiz = rows.find(r => r.nivel === 0);
  const filhosDe = (id) => rows.filter(r => r.parent_id === id).sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const toggle = (id) => setExpandido(e => ({ ...e, [id]: e[id] === false ? true : false }));
  const rede = rows.filter(r => r.nivel >= 1);
  const diretos = rede.filter(r => r.nivel === 1).length;
  const parceirosRede = rede.filter(r => r.parceiro).length;

  const precisaEmpresa = faltando.some(f => /empresa|cnpj/i.test(f));
  const outrosPendentes = faltando.filter(f => !/empresa|cnpj|pix da empresa|razão social/i.test(f));

  const Stat = ({ n, label, cor }) => (
    <div style={{ ...card, textAlign: 'center', padding: '16px 12px' }}>
      <div style={{ fontSize: 26, fontWeight: 900, color: cor }}>{n}</div>
      <div style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, marginTop: 2 }}>{label}</div>
    </div>
  );

  const rankNome = nivel?.rank_atual?.nome;
  const indicacaoPct = nivel?.comissao_indicacao_pct ?? 20;

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Apresentação comercial — missão, sem jargão de "multinível" */}
      <div style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4c1d95 100%)', borderRadius: 18, padding: '26px 24px', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Network size={22} /><div style={{ fontSize: 22, fontWeight: 900 }}>Seja Parceiro BidPro Brasil</div></div>
        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 12, lineHeight: 1.4 }}>
          Transforme vidas através do investimento em leilões.
        </div>
        <div style={{ fontSize: 13.5, opacity: 0.95, marginTop: 8, lineHeight: 1.6 }}>
          Um bom leilão muda a vida de quem compra bem — e de quem mostra o caminho. Ao indicar, você leva
          um serviço de alta qualidade para quem quer investir com segurança e é <strong>bem recompensado
          por cada pessoa que ajuda a entrar nesse mundo</strong>.
        </div>
        <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
          {['Você indica', 'A pessoa é bem cuidada', 'Você é recompensado'].map((t, i) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700 }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900 }}>{i + 1}</span>
              {t}
            </div>
          ))}
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

      {/* SEU NÍVEL — Comissão de Indicação + progresso (o esquema de níveis fica sob o capô) */}
      {!isAdmin && (
        <div style={{ ...card, background: 'linear-gradient(180deg,#fbfaff 0%, #ffffff 60%)', border: '1px solid #ede9fe' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Sparkles size={18} color="#7c3aed" />
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>Seu Nível</div>
          </div>

          {nivel?.tem_rank ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 22, fontWeight: 900, color: '#6d28d9' }}>{rankNome}</div>
                <div style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>seu nível atual</div>
              </div>
              <div style={{ background: '#f5f3ff', borderRadius: 10, padding: '12px 14px', marginTop: 10 }}>
                <div style={{ fontSize: 13, color: '#4c1d95', fontWeight: 700 }}>
                  💸 Comissão de Indicação: <span style={{ fontSize: 16, fontWeight: 900 }}>{indicacaoPct}%</span>
                </div>
                <div style={{ fontSize: 11.5, color: '#7c3aed', marginTop: 2 }}>sobre cada pagamento de quem você trouxe — enquanto seguir ativo.</div>
              </div>
              {nivel?.proximo ? (
                <div style={{ fontSize: 12.5, color: '#334155', marginTop: 12, lineHeight: 1.6 }}>
                  <strong>Para chegar a {nivel.proximo.nome}:</strong>{' '}
                  {nivel.proximo.faltam_diretos > 0 && <>faltam <strong>{nivel.proximo.faltam_diretos}</strong> indicado(s) pagante(s)</>}
                  {nivel.proximo.faltam_diretos > 0 && nivel.proximo.faltam_rede > 0 && ' e '}
                  {nivel.proximo.faltam_rede > 0 && <><strong>{nivel.proximo.faltam_rede}</strong> na sua rede</>}
                  {nivel.proximo.faltam_diretos === 0 && nivel.proximo.faltam_rede === 0 && 'você já bateu os requisitos — atualiza no próximo ciclo!'}
                </div>
              ) : (
                <div style={{ fontSize: 12.5, color: '#059669', marginTop: 12, fontWeight: 700 }}>🏆 Você está no nível máximo. Parabéns!</div>
              )}
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#475569', lineHeight: 1.6 }}>
              {naoGanhaNovas
                ? <>Você já pode indicar e formar sua rede. Para <strong>desbloquear seus ganhos e seu nível</strong>, tenha uma assinatura ativa e faça sua primeira indicação paga.</>
                : <>Faça sua <strong>primeira indicação paga</strong> para desbloquear o nível <strong>Pioneiro</strong> e começar a ganhar sua Comissão de Indicação.</>}
            </div>
          )}

          {/* Trilha de níveis percorrida */}
          {Array.isArray(nivel?.trilha) && nivel.trilha.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
              {nivel.trilha.map((t, i) => (
                <React.Fragment key={t.nome}>
                  {i > 0 && <ChevronRight size={13} color="#cbd5e1" />}
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 9px', borderRadius: 999,
                    background: t.atingido ? '#7c3aed' : '#f1f5f9', color: t.atingido ? 'white' : '#94a3b8' }}>
                    {t.nome}
                  </span>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FINANCEIRO — saldo a receber + gate de PJ (modelo B2B) */}
      {!isAdmin && (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Wallet size={18} color="#059669" />
            <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>Seus ganhos</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 30, fontWeight: 900, color: '#059669' }}>{fmtBRL(saldo)}</div>
            <div style={{ fontSize: 12.5, color: '#64748b', fontWeight: 600 }}>a receber</div>
          </div>

          {/* Gate: para sacar, precisa cadastrar a PJ que vai receber (B2B) */}
          {precisaEmpresa ? (
            <div style={{ marginTop: 14, border: '1px solid #fde68a', background: '#fffbeb', borderRadius: 12, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 800, color: '#92400e' }}>
                <Building2 size={16} /> Cadastre sua empresa para sacar
              </div>
              <div style={{ fontSize: 12, color: '#a16207', marginTop: 4, lineHeight: 1.55 }}>
                O pagamento é feito para uma empresa (PJ) da qual você é sócio — assim o valor é 100% seu e você
                cuida da sua parte. É rápido: se ainda não tem, dá para abrir um MEI grátis.
              </div>
              <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                <input value={pj.cnpj} onChange={e => setPj(p => ({ ...p, cnpj: e.target.value }))} placeholder="CNPJ da empresa"
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 11px', fontSize: 13 }} />
                <input value={pj.razao_social} onChange={e => setPj(p => ({ ...p, razao_social: e.target.value }))} placeholder="Razão social"
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 11px', fontSize: 13 }} />
                <input value={pj.pj_chave_pix} onChange={e => setPj(p => ({ ...p, pj_chave_pix: e.target.value }))} placeholder="Chave PIX da empresa"
                  style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 11px', fontSize: 13 }} />
              </div>
              <button onClick={salvarPj} disabled={salvandoPj}
                style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', background: '#d97706', color: 'white', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: salvandoPj ? 'default' : 'pointer', opacity: salvandoPj ? 0.7 : 1 }}>
                {salvandoPj ? 'Salvando…' : <>Cadastrar empresa <ArrowRight size={15} /></>}
              </button>
              {msgPj && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: msgPj.tipo === 'ok' ? '#059669' : '#dc2626' }}>{msgPj.txt}</div>}
            </div>
          ) : (
            <>
              {pjSalva && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#059669', display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                  <Check size={14} /> Empresa cadastrada: {pj.razao_social || pj.cnpj}
                </div>
              )}
              {outrosPendentes.length > 0 ? (
                <div style={{ marginTop: 12, fontSize: 12.5, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px' }}>
                  Para liberar o saque, complete seu cadastro: <strong>{outrosPendentes.join(', ')}</strong>.
                </div>
              ) : saldo > 0 ? (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input type="number" value={valorSaque} onChange={e => setValorSaque(e.target.value)} placeholder={`Valor até ${fmtBRL(saldo)}`}
                    style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: '9px 11px', fontSize: 13, width: 170 }} />
                  <button onClick={solicitarSaque} disabled={sacando}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '10px 16px', background: '#059669', color: 'white', border: 'none', borderRadius: 9, fontWeight: 800, fontSize: 13, cursor: sacando ? 'default' : 'pointer', opacity: sacando ? 0.7 : 1 }}>
                    {sacando ? 'Solicitando…' : 'Solicitar saque'}
                  </button>
                </div>
              ) : (
                <div style={{ marginTop: 10, fontSize: 12, color: '#94a3b8' }}>Você ainda não tem saldo a sacar.</div>
              )}
              {msgSaque && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: msgSaque.tipo === 'ok' ? '#059669' : '#dc2626' }}>{msgSaque.txt}</div>}
            </>
          )}
          <div style={{ marginTop: 12, fontSize: 10.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 5, lineHeight: 1.5 }}>
            <Lock size={11} /> Pagamentos são processados toda sexta-feira, para a conta da sua empresa.
          </div>
        </div>
      )}

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
        <Award size={13} style={{ verticalAlign: -2 }} /> Sua comissão é devida nos meses em que sua assinatura está em dia na data da cobrança do indicado.
      </div>
    </div>
  );
}
