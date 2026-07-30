// PROGRAMA DE PARCEIROS — BidPro Brasil. Esta aba só aparece DEPOIS que a pessoa aceita ser
// parceira, então é uma tela de BOAS-VINDAS + explicação (não um convite). O parceiro: (1) pega
// seu link; (2) acompanha SEU NÍVEL (Comissão de Indicação + o que falta p/ subir); (3) vê o saldo
// a receber e, para SACAR, cadastra a PJ que vai receber (B2B); (4) vê seus indicados — no NÍVEL 1
// (venda direta dele) com contato; da rede abaixo (venda dos indicados dele) só nome e cidade (LGPD).
// Tema: azul BidPro (#0D63DB / #084BA6). Números do nível vêm da RPC `meu_nivel` (auth.uid).
import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { Users, Copy, Check, ChevronRight, ChevronDown, Award, Search, Wallet, Building2, Lock, ArrowRight, Sparkles, Phone, Mail } from 'lucide-react';

const card = { background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '18px 20px' };
const fmtBRL = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Plural correto dos nomes de rank em pt-BR (evita "Fundadors"/"Guardiãos"):
// terminação -ão → -ões (Guardião→Guardiões); -r → -res (Fundador→Fundadores);
// vogal → +s (Pioneiro→Pioneiros, Mestre→Mestres). Frases (ex.: "indicado pagante ativo")
// só entram no nível 1, que sempre pede 1 → nunca pluralizam.
const pluralRank = (nome, n) => {
  const s = String(nome || '');
  if (Number(n) <= 1) return s;
  if (/ão$/i.test(s)) return s.replace(/ão$/i, 'ões');
  if (/r$/i.test(s)) return s + 'es';
  return s + 's';
};

function Nodo({ nodo, filhosDe, expandido, toggle, nivel }) {
  const filhos = filhosDe(nodo.id);
  const temFilhos = filhos.length > 0;
  const aberto = expandido[nodo.id] !== false; // aberto por padrão
  const temContato = !!(nodo.telefone || nodo.email); // só vem no nível 1 (venda direta)
  return (
    <div style={{ marginLeft: nivel === 0 ? 0 : 18, borderLeft: nivel === 0 ? 'none' : '1px solid #dbeafe', paddingLeft: nivel === 0 ? 0 : 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 0' }}>
        {temFilhos ? (
          <button onClick={() => toggle(nodo.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#0D63DB', display: 'flex', padding: 0 }}>
            {aberto ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </button>
        ) : <span style={{ width: 16, display: 'inline-block' }} />}
        <div style={{ width: 30, height: 30, borderRadius: '50%', background: nodo.parceiro ? '#0D63DB' : '#e2e8f0', color: nodo.parceiro ? 'white' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, flexShrink: 0 }}>
          {(nodo.nome || '?')[0].toUpperCase()}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {nodo.nome}
            {nodo.parceiro && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: '#084BA6', background: '#eff6ff', borderRadius: 999, padding: '1px 7px' }}>PARCEIRO</span>}
            {/* Plano do indicado DIRETO (a RPC só devolve no nível 1 — LGPD): identifica de
                relance grátis × Investidor Pro × Assessoria × Leilão Club (pedido do dono). */}
            {(() => {
              const P = {
                explorador: { rot: 'Grátis', cor: '#64748b', bg: '#f1f5f9' },
                top2: { rot: 'Investidor Pro', cor: '#0D63DB', bg: '#dbeafe' },
                assessorado: { rot: 'Assessoria', cor: '#7c3aed', bg: '#f3e8ff' },
                clube: { rot: 'Leilão Club', cor: '#b45309', bg: '#fef3c7' },
                consultor: { rot: 'Consultor', cor: '#0f766e', bg: '#ccfbf1' },
              }[nodo.plano];
              return P ? <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 800, color: P.cor, background: P.bg, borderRadius: 999, padding: '1px 7px' }}>{P.rot}</span> : null;
            })()}
          </div>
          <div style={{ fontSize: 11.5, color: '#94a3b8' }}>{nodo.cidade_uf || 'cidade não informada'}{Number(nodo.n_indicados) > 0 ? ` · ${nodo.n_indicados} indicado${nodo.n_indicados > 1 ? 's' : ''}` : ''}</div>
          {temContato && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11.5, color: '#0D63DB', fontWeight: 600, marginTop: 2 }}>
              {nodo.telefone && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Phone size={11} />{nodo.telefone}</span>}
              {nodo.email && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={11} />{nodo.email}</span>}
            </div>
          )}
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
  const [codigoPronto, setCodigoPronto] = useState(false); // evita o "pisca": só mostra o link quando o código curto carregou
  const [copiado, setCopiado] = useState(false);
  const [expandido, setExpandido] = useState({});
  const [rootId, setRootId] = useState(null); // admin: ver a rede de outro parceiro
  const [rootNome, setRootNome] = useState('');
  const [busca, setBusca] = useState('');
  const [resultados, setResultados] = useState([]);
  // Admin — reconciliação: atribuir um cliente (indicado) a um parceiro manualmente.
  const [recCli, setRecCli] = useState(null);        // {id, nome} cliente escolhido
  const [recCliBusca, setRecCliBusca] = useState('');
  const [recCliRes, setRecCliRes] = useState([]);
  const [recPar, setRecPar] = useState(null);        // {id, nome} parceiro escolhido
  const [recParBusca, setRecParBusca] = useState('');
  const [recParRes, setRecParRes] = useState([]);
  const [recMsg, setRecMsg] = useState(null);
  const [recSalvando, setRecSalvando] = useState(false);

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

  // Link GERAL do parceiro → tela de INÍCIO do site (o visitante entra, navega, vê os produtos e
  // vem a assinar). A indicação (?ref=) é capturada globalmente (AuthContext) e vincula quem
  // clicar, quantas pessoas forem, ao parceiro. (A venda DIRETA de um produto específico usa os
  // links por produto: ebook/curso em /p/... e planos em /checkout?plano=...)
  const linkIndicacao = `${window.location.origin}${window.location.pathname.replace(/\/$/, '')}#/?ref=${codigo || uid || ''}`;
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
      let cod = p?.codigo_indicacao;
      // Garante o código CURTO antes de exibir o link (senão o link mostrava o uid longo
      // e "piscava" para o código quando carregava). Gera se ainda não existir.
      if (!cod) {
        try {
          await supabase.rpc('gerar_codigo_indicacao', { p_id: uid });
          const { data: p2 } = await supabase.from('perfis').select('codigo_indicacao').eq('id', uid).maybeSingle();
          cod = p2?.codigo_indicacao;
        } catch { /* mantém o fallback do uid */ }
      }
      if (cod) setCodigo(cod);
      const temPj = !!(p?.cnpj);
      setPj({ cnpj: p?.cnpj || '', razao_social: p?.razao_social || '', pj_chave_pix: p?.pj_chave_pix || '' });
      setPjSalva(temPj);
    } catch { /* ignora */ }
    finally { setCodigoPronto(true); }
  }, [uid]);
  useEffect(() => { carregarMeu(); }, [carregarMeu]);

  const buscarParceiro = async (q) => {
    setBusca(q);
    if (!isAdmin || q.trim().length < 2) { setResultados([]); return; }
    const { data } = await supabase.from('perfis').select('id, nome').ilike('nome', `%${q.trim()}%`).limit(8);
    setResultados(Array.isArray(data) ? data : []);
  };

  // Admin — reconciliação: busca genérica de perfis (cliente OU parceiro) por nome.
  const buscarPerfil = async (q, setRes) => {
    if (!isAdmin || q.trim().length < 2) { setRes([]); return; }
    const { data } = await supabase.from('perfis').select('id, nome').ilike('nome', `%${q.trim()}%`).limit(8);
    setRes(Array.isArray(data) ? data : []);
  };
  const atribuirIndicado = async () => {
    if (!recCli?.id || !recPar?.id) { setRecMsg({ tipo: 'erro', txt: 'Escolha o cliente e o parceiro.' }); return; }
    setRecSalvando(true); setRecMsg(null);
    try {
      const { data, error } = await supabase.rpc('admin_atribuir_indicado', { p_cliente: recCli.id, p_parceiro: recPar.id });
      if (error) throw error;
      if (data === true) {
        setRecMsg({ tipo: 'ok', txt: `✓ ${recCli.nome} agora está vinculado(a) a ${recPar.nome}.` });
        setRecCli(null); setRecPar(null); setRecCliBusca(''); setRecParBusca('');
        carregar(); // atualiza a rede exibida
      } else {
        setRecMsg({ tipo: 'erro', txt: 'Não foi possível atribuir (evita auto-indicação e ciclos). Confira a escolha.' });
      }
    } catch { setRecMsg({ tipo: 'erro', txt: 'Erro ao atribuir. Tente novamente.' }); }
    setRecSalvando(false);
    setTimeout(() => setRecMsg(null), 6000);
  };

  async function salvarPj() {
    setSalvandoPj(true); setMsgPj(null);
    const cnpjDigits = (pj.cnpj || '').replace(/\D/g, '');
    if (cnpjDigits.length !== 14) {
      setMsgPj({ tipo: 'erro', txt: 'CNPJ inválido — informe os 14 dígitos.' });
      setSalvandoPj(false); return;
    }
    const payload = {
      cnpj: cnpjDigits,
      razao_social: (pj.razao_social || '').trim(),
      pj_chave_pix: (pj.pj_chave_pix || '').trim(),
      pj_dados_atualizados_em: new Date().toISOString(),
    };
    if (!payload.razao_social || !payload.pj_chave_pix) {
      setMsgPj({ tipo: 'erro', txt: 'Preencha a razão social e a chave PIX da empresa.' });
      setSalvandoPj(false); return;
    }
    // SEGURANÇA (anti-interposição): o cliente NÃO valida a própria PJ. Grava só os dados
    // (cnpj/razão/pix — campos não protegidos) e pede a verificação de sócio ao servidor
    // (QSA da Receita). O saque só libera quando o backend confirmar pj_validada_em — nunca
    // por este update do cliente (o trigger reverte pj_validada_em de qualquer forma).
    const { error } = await supabase.from('perfis').update(payload).eq('id', uid);
    if (error) { setMsgPj({ tipo: 'erro', txt: 'Erro ao salvar os dados da empresa.' }); setSalvandoPj(false); return; }
    setPjSalva(true);
    let validada = false;
    try {
      const r = await apiCall('/api/validar-pj-socio', { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json().catch(() => ({}));
      validada = r.ok && !!d?.matched;
    } catch { /* rede fora → segue como pendente; a equipe valida no 1º saque */ }
    setMsgPj(validada
      ? { tipo: 'ok', txt: '✓ Empresa validada — você já pode solicitar o saque.' }
      : { tipo: 'ok', txt: 'Empresa cadastrada. Estamos verificando se você consta como sócio na Receita; se não confirmar, a equipe valida no seu 1º saque.' });
    await carregarMeu();
    setSalvandoPj(false);
    setTimeout(() => setMsgPj(null), 6000);
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

  // Barra de progresso rumo ao próximo nível (atual/alvo, com "faltam N").
  const Progresso = ({ label, atual, alvo, faltam }) => {
    const pct = alvo > 0 ? Math.min(100, Math.round((atual / alvo) * 100)) : 0;
    return (
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 11.5, fontWeight: 700, color: '#475569', marginBottom: 5 }}>
          <span>{label}</span>
          <span>{atual}/{alvo}{faltam > 0 ? <span style={{ color: '#0D63DB' }}> · faltam {faltam}</span> : <span style={{ color: '#059669' }}> ✓</span>}</span>
        </div>
        <div style={{ height: 9, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, #0D63DB, #084BA6)', borderRadius: 999, transition: 'width .4s' }} />
        </div>
        <div style={{ fontSize: 10.5, color: '#0D63DB', fontWeight: 800, marginTop: 4, textAlign: 'right' }}>{pct}%</div>
      </div>
    );
  };

  const rankNome = nivel?.rank_atual?.nome;
  const indicacaoPct = nivel?.comissao_indicacao_pct ?? 25;
  const bonusInf = Number(nivel?.rank_atual?.bonus_infinito_pct || 0); // > 0 = faixa de liderança
  // Fechamento MENSAL do nível (dia 1) — data anunciada. O cron ranks-recalc-cron roda
  // recalcular_ranks em "0 6 1 * *"; promoção/queda passam a valer a partir dessa conferência.
  const proximaConferencia = (() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
  })();

  return (
    <div style={{ maxWidth: 820, margin: '0 auto', padding: '28px 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* BOAS-VINDAS — esta aba só aparece após o aceite; é acolhimento + explicação (sem jargão) */}
      <div style={{ background: 'linear-gradient(135deg, #0D63DB 0%, #084BA6 100%)', borderRadius: 18, padding: '26px 24px', color: 'white' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><Sparkles size={22} /><div style={{ fontSize: 22, fontWeight: 900 }}>Bem-vindo(a) ao Programa de Parceiros BidPro Brasil</div></div>
        <div style={{ fontSize: 15, fontWeight: 800, marginTop: 12, lineHeight: 1.4 }}>
          Transforme vidas através do investimento em leilões.
        </div>
        <div style={{ fontSize: 13.5, opacity: 0.95, marginTop: 8, lineHeight: 1.6 }}>
          Um bom leilão muda a vida de quem compra bem — e de quem mostra o caminho. Ao indicar, você leva
          um serviço de alta qualidade para quem quer investir com segurança e é <strong>bem recompensado
          por cada pessoa que ajuda a entrar nesse mundo</strong>. Abaixo estão seu link, seu nível e seus ganhos.
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

      {/* Aviso: só GANHA comissão quem tem assinatura ativa — aparece só p/ quem ainda NÃO atende
          o requisito (não-pagante); some quando assina. Nunca para admin. */}
      {!isAdmin && naoGanhaNovas && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ fontSize: 13, color: '#9a3412', fontWeight: 800 }}>⚠️ Para GANHAR comissões, mantenha a assinatura em dia</div>
          <div style={{ fontSize: 12, color: '#9a3412', lineHeight: 1.55, marginTop: 4 }}>
            A comissão de cada indicado é sua se, na <strong>data da cobrança</strong> dele, sua assinatura estiver em dia.
            Você indica sempre e saca o que já ganhou — <strong>assine para voltar a receber</strong> as próximas.
          </div>
          <button onClick={() => { window.location.hash = '#/planos'; }}
            style={{ marginTop: 10, padding: '9px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
            Assinar
          </button>
        </div>
      )}

      {/* Link de indicação — só renderiza quando o código curto está pronto (sem "pisca") */}
      <div style={card}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#334155', marginBottom: 8 }}>Seu link de indicação</div>
        {!codigoPronto ? (
          <div style={{ background: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#94a3b8', marginBottom: 10 }}>Gerando seu link…</div>
        ) : (
          <>
            <div style={{ background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#084BA6', wordBreak: 'break-all', fontFamily: 'monospace', marginBottom: 10 }}>{linkDisplay}</div>
            <button onClick={copiar} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: 'pointer' }}>
              {copiado ? <><Check size={16} /> Link copiado!</> : <><Copy size={16} /> Copiar meu link</>}
            </button>
          </>
        )}
      </div>

      {/* SEU NÍVEL — hero + comissões (indicação e loja) + progresso pro próximo. Mostra
          também para o admin (o dono quer ver a mesma visão do parceiro). */}
      {(
        <div style={{ ...card, padding: 0, overflow: 'hidden', border: '1px solid #dbeafe' }}>
          {/* Hero */}
          <div style={{ background: 'linear-gradient(135deg, #0D63DB 0%, #084BA6 100%)', color: 'white', padding: '18px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.92 }}>
              <Sparkles size={15} /> Seu nível
            </div>
            {nivel?.tem_rank ? (
              <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8, gap: 10, flexWrap: 'wrap' }}>
                <div style={{ fontSize: 27, fontWeight: 900, lineHeight: 1 }}>{rankNome}</div>
                <div style={{ textAlign: 'center', background: 'rgba(255,255,255,0.16)', borderRadius: 12, padding: '6px 14px' }}>
                  <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1 }}>{indicacaoPct}%</div>
                  <div style={{ fontSize: 10, opacity: 0.92, fontWeight: 700, marginTop: 2 }}>por indicação</div>
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 19, fontWeight: 900, marginTop: 8 }}>Comece a construir 🚀</div>
            )}
          </div>

          {/* Corpo */}
          <div style={{ padding: '16px 20px' }}>
            {/* Quanto ganho ao fazer uma VENDA (sempre) */}
            <div style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.6, marginBottom: 12 }}>
              Quando você vende, ganha <strong style={{ color: '#084BA6' }}>{nivel?.venda_pct ?? 25}%</strong> sobre a assinatura de quem você trouxe, e a <strong>comissão do produto</strong> nas vendas da loja (ebooks/cursos).
            </div>

            {/* Da minha EQUIPE (se o meu nível já libera) */}
            {nivel?.tem_rank && Number(nivel?.equipe?.pct_total) > 0 && (
              <div style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.55, marginBottom: 12, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px' }}>
                👥 <strong>Da sua equipe</strong>: como <strong>{rankNome}</strong>, você também ganha <strong>{Number(nivel.equipe.pct_total)}%</strong> sobre as vendas da equipe que você formou (até {nivel.equipe.niveis} {nivel.equipe.niveis > 1 ? 'gerações' : 'geração'}).
              </div>
            )}
            {bonusInf > 0 && (
              <div style={{ fontSize: 12.5, color: '#5b21b6', lineHeight: 1.55, marginBottom: 12, background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 10, padding: '10px 12px' }}>
                💎 Liderança ({rankNome}): + <strong>bônus infinito de {bonusInf}%</strong> sobre TODA a sua rede.
              </div>
            )}

            {/* PRÓXIMO nível — apenas o imediatamente seguinte */}
            {nivel?.proximo ? (
              <div style={{ borderTop: '1px solid #eef2f7', paddingTop: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>Próximo nível</div>
                    <div style={{ fontSize: 18, fontWeight: 900, color: '#0D63DB' }}>{nivel.proximo.nome}</div>
                  </div>
                  {/* Chip do que passa a receber — o "carrot" do desafio */}
                  <div style={{ textAlign: 'center', background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 10, padding: '6px 14px' }}>
                    <div style={{ fontSize: 19, fontWeight: 900, color: '#084BA6', lineHeight: 1 }}>{Number(nivel.proximo.equipe_delta_pct) > 0 ? `+${Number(nivel.proximo.equipe_delta_pct)}%` : Number(nivel.proximo.bonus_infinito_pct) > 0 ? `+${Number(nivel.proximo.bonus_infinito_pct)}%` : Number(nivel.proximo.equipe_pct_total) > 0 ? `${Number(nivel.proximo.equipe_pct_total)}%` : `${indicacaoPct}%`}</div>
                    <div style={{ fontSize: 9.5, color: '#64748b', fontWeight: 700, marginTop: 2 }}>{Number(nivel.proximo.equipe_delta_pct) > 0 ? 'a mais da equipe' : Number(nivel.proximo.bonus_infinito_pct) > 0 ? 'bônus infinito' : Number(nivel.proximo.equipe_pct_total) > 0 ? 'da equipe' : 'por indicação'}</div>
                  </div>
                </div>
                <Progresso
                  label={`${nivel.proximo.req_pernas} ${pluralRank(nivel.proximo.sub_nome, nivel.proximo.req_pernas)} na sua rede direta`}
                  atual={nivel.proximo.tem || 0} alvo={nivel.proximo.req_pernas} faltam={nivel.proximo.faltam} />
                <div style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.55, marginTop: 6, background: '#eff6ff', border: '1px solid #dbeafe', borderRadius: 10, padding: '9px 12px' }}>
                  {Number(nivel.proximo.equipe_pct_total) > 0
                    ? <>Ao chegar em <strong>{nivel.proximo.nome}</strong>, você passa a ganhar <strong>{Number(nivel.proximo.equipe_pct_total)}%</strong> sobre as vendas da equipe (até {nivel.proximo.equipe_niveis} {nivel.proximo.equipe_niveis > 1 ? 'gerações' : 'geração'}){Number(nivel.proximo.equipe_delta_pct) > 0 ? <> — <strong>+{Number(nivel.proximo.equipe_delta_pct)}%</strong> a mais que hoje</> : null}</>
                    : <>Ao chegar em <strong>{nivel.proximo.nome}</strong>, você <strong>desbloqueia seus ganhos</strong> e começa a receber os <strong>{nivel?.venda_pct ?? 25}%</strong> por indicação</>}
                  {Number(nivel.proximo.bonus_infinito_pct) > 0 ? <>, e entra na <strong>liderança</strong> com <strong>bônus infinito de {Number(nivel.proximo.bonus_infinito_pct)}%</strong> sobre toda a rede</> : null}.
                </div>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
                  📅 O nível é confirmado no <strong>fechamento mensal</strong> (dia 1) — próxima conferência: <strong>{proximaConferencia}</strong>.
                </div>
              </div>
            ) : nivel?.tem_rank ? (
              <div style={{ fontSize: 13, color: '#059669', fontWeight: 800, marginTop: 4 }}>🏆 Você chegou ao nível máximo. Parabéns!</div>
            ) : null}

          </div>
        </div>
      )}

      {/* SUA TRILHA DE CARREIRA — mostra APENAS o nível atual ("VOCÊ ESTÁ AQUI") e o próximo
          ("PRÓXIMA CONQUISTA"). Os níveis futuros ficam ocultos de propósito: o parceiro os
          descobre à medida que se gradua (menos ansiedade, mais foco no próximo passo). Dados
          de meu_nivel().trilha (filtramos por estado 'atual'|'proximo'). */}
      {Array.isArray(nivel?.trilha) && nivel.trilha.some(t => t.estado === 'atual' || t.estado === 'proximo') && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px 6px' }}>
            <div style={{ fontSize: 11.5, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 0.6, display: 'flex', alignItems: 'center', gap: 7 }}>
              <Award size={16} /> Sua trilha de carreira
            </div>
            <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 4, lineHeight: 1.5 }}>
              Cada nível conquistado libera o próximo — e quanto mais alto, mais você ganha da equipe que formou.
            </div>
          </div>
          <div style={{ padding: '6px 20px 4px' }}>
            {nivel.trilha.filter(t => t.estado === 'atual' || t.estado === 'proximo').map((t, i, arr) => {
              const conquistado = t.estado === 'conquistado';
              const atual = t.estado === 'atual';
              const proximo = t.estado === 'proximo';
              const bloqueado = t.estado === 'bloqueado';
              const destaque = atual || proximo;
              const ultimo = i === arr.length - 1;
              return (
                <div key={t.ordem} style={{ display: 'flex', gap: 12, alignItems: 'stretch' }}>
                  {/* Marcador + conector */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      background: (conquistado || atual) ? 'linear-gradient(135deg,#0D63DB,#084BA6)' : proximo ? '#fff' : '#f1f5f9',
                      border: proximo ? '2px solid #0D63DB' : bloqueado ? '1.5px dashed #cbd5e1' : 'none',
                      boxShadow: atual ? '0 0 0 4px rgba(13,99,219,0.15)' : 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      color: (conquistado || atual) ? '#fff' : proximo ? '#0D63DB' : '#94a3b8' }}>
                      {conquistado ? <Check size={16} /> : bloqueado ? <Lock size={13} /> : <span style={{ fontSize: 12.5, fontWeight: 900 }}>{t.ordem}</span>}
                    </div>
                    {!ultimo && <div style={{ width: 2, flex: 1, minHeight: 16, background: conquistado ? '#0D63DB' : '#e2e8f0' }} />}
                  </div>
                  {/* Conteúdo do nível */}
                  <div style={{ paddingBottom: 16, opacity: bloqueado ? 0.55 : 1, flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14.5, fontWeight: 900, color: destaque ? '#0D63DB' : '#111' }}>{t.nome}</span>
                      {atual && <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', background: '#0D63DB', padding: '2px 7px', borderRadius: 20 }}>VOCÊ ESTÁ AQUI</span>}
                      {proximo && <span style={{ fontSize: 9, fontWeight: 800, color: '#0D63DB', background: '#eff6ff', padding: '2px 7px', borderRadius: 20 }}>PRÓXIMA CONQUISTA</span>}
                      {Number(t.bonus_infinito_pct) > 0 && <span style={{ fontSize: 9, fontWeight: 800, color: '#5b21b6', background: '#f5f3ff', padding: '2px 7px', borderRadius: 20 }}>💎 Liderança</span>}
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3, lineHeight: 1.5 }}>
                      {t.ordem === 1
                        ? <>Meta: <strong>{t.req_pernas} {t.req_sub_nome}</strong></>
                        : <>Meta: <strong>{t.req_pernas} {pluralRank(t.req_sub_nome, t.req_pernas)}</strong> na sua rede direta</>}
                    </div>
                    <div style={{ fontSize: 11.5, color: destaque ? '#334155' : '#94a3b8', marginTop: 2 }}>
                      <strong>{t.indicacao_pct}%</strong> por indicação
                      {Number(t.equipe_pct_total) > 0 && <> · <strong>{Number(t.equipe_pct_total)}%</strong> da equipe (até {t.equipe_niveis} ger.)</>}
                      {Number(t.bonus_infinito_pct) > 0 && <> · <strong>+{Number(t.bonus_infinito_pct)}%</strong> infinito</>}
                    </div>
                    {proximo && nivel?.proximo && (
                      <div style={{ marginTop: 7 }}>
                        <div style={{ height: 7, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ width: `${nivel.proximo.progresso_pct || 0}%`, height: '100%', background: 'linear-gradient(90deg,#0D63DB,#084BA6)', borderRadius: 999, transition: 'width .4s' }} />
                        </div>
                        <div style={{ fontSize: 10.5, color: '#0D63DB', fontWeight: 800, marginTop: 3 }}>
                          {nivel.proximo.progresso_pct || 0}% · {nivel.proximo.tem || 0}/{nivel.proximo.req_pernas}{nivel.proximo.faltam > 0 ? ` · faltam ${nivel.proximo.faltam}` : ' ✓'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10.5, color: '#94a3b8', margin: '0 20px', padding: '10px 0 16px', borderTop: '1px solid #f1f5f9', lineHeight: 1.55 }}>
            No <strong>1º nível</strong> (sua indicação direta) você recebe <strong>{indicacaoPct}%</strong> das <strong>assinaturas</strong> (ex.: Investidor Pro) e das vendas da <strong>loja</strong> (e-books e cursos). Os produtos de <strong>alto ticket</strong> — <strong>Assessoria</strong> e <strong>Leilão Club</strong> — pagam <strong>{Number(nivel?.indicacao_por_tipo?.venda_direta ?? 10)}%</strong> no 1º nível. A comissão é sempre <strong>mediante o pagamento recebido</strong>: em assinatura recorrente, <strong>mês a mês</strong>; em compra à vista ou parcelada recebida de uma vez, <strong>de uma vez</strong>. Os níveis 2+ da rede recebem percentuais menores.
          </div>
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
          <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 8 }}>👑 Admin — ver os indicados de um parceiro</div>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px' }}>
              <Search size={15} color="#94a3b8" />
              <input value={busca} onChange={e => buscarParceiro(e.target.value)} placeholder="Buscar por nome…"
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13, color: '#111', background: 'transparent' }} />
              {(rootId) && <button onClick={() => { setRootId(null); setRootNome(''); setBusca(''); setResultados([]); }} style={{ fontSize: 11, color: '#0D63DB', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>ver a minha</button>}
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
          {rootNome && <div style={{ fontSize: 12, color: '#084BA6', marginTop: 8, fontWeight: 700 }}>Exibindo os indicados de: {rootNome}</div>}
        </div>
      )}

      {/* Admin — reconciliar indicação: atribuir manualmente um cliente ao parceiro que o indicou.
          Recupera indicações que se perderam (cliente entrou por link antigo sem registrar o parceiro). */}
      {isAdmin && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#334155', marginBottom: 4 }}>👑 Admin — atribuir um indicado a um parceiro</div>
          <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 10, lineHeight: 1.5 }}>
            Reconciliação manual: escolha o <strong>cliente</strong> e o <strong>parceiro</strong> que o indicou.
            Útil quando a indicação se perdeu (link antigo). Impede auto-indicação e ciclos.
          </div>
          {/* Cliente */}
          <div style={{ position: 'relative', marginBottom: 8 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', marginBottom: 3 }}>CLIENTE (indicado)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px' }}>
              <Search size={15} color="#94a3b8" />
              <input value={recCliBusca} onChange={e => { setRecCli(null); setRecCliBusca(e.target.value); buscarPerfil(e.target.value, setRecCliRes); }} placeholder="Buscar cliente por nome…"
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13, color: '#111', background: 'transparent' }} />
            </div>
            {recCliRes.length > 0 && !recCli && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden' }}>
                {recCliRes.map(r => (
                  <button key={r.id} onClick={() => { setRecCli(r); setRecCliBusca(r.nome); setRecCliRes([]); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'white', cursor: 'pointer', fontSize: 13, color: '#334155' }}>
                    {r.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
          {/* Parceiro */}
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: '#64748b', marginBottom: 3 }}>PARCEIRO (quem indicou)</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 12px' }}>
              <Search size={15} color="#94a3b8" />
              <input value={recParBusca} onChange={e => { setRecPar(null); setRecParBusca(e.target.value); buscarPerfil(e.target.value, setRecParRes); }} placeholder="Buscar parceiro por nome…"
                style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13, color: '#111', background: 'transparent' }} />
            </div>
            {recParRes.length > 0 && !recPar && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, marginTop: 4, boxShadow: '0 8px 24px rgba(0,0,0,0.1)', zIndex: 10, overflow: 'hidden' }}>
                {recParRes.map(r => (
                  <button key={r.id} onClick={() => { setRecPar(r); setRecParBusca(r.nome); setRecParRes([]); }}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 12px', border: 'none', background: 'white', cursor: 'pointer', fontSize: 13, color: '#334155' }}>
                    {r.nome}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button onClick={atribuirIndicado} disabled={recSalvando || !recCli || !recPar}
            style={{ padding: '9px 16px', background: (recCli && recPar) ? '#0D63DB' : '#cbd5e1', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: (recCli && recPar && !recSalvando) ? 'pointer' : 'default' }}>
            {recSalvando ? 'Atribuindo…' : 'Atribuir ao parceiro'}
          </button>
          {recMsg && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: recMsg.tipo === 'ok' ? '#059669' : '#dc2626' }}>{recMsg.txt}</div>}
        </div>
      )}

      {/* Números */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Stat n={diretos} label="Indicados diretos" cor="#0D63DB" />
        <Stat n={rede.length} label="Rede total" cor="#084BA6" />
        <Stat n={parceirosRede} label="Viraram parceiros" cor="#059669" />
      </div>

      {/* Seus indicados */}
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <Users size={18} color="#0D63DB" />
          <div style={{ fontSize: 15, fontWeight: 800, color: '#111' }}>Seus indicados</div>
        </div>
        <div style={{ fontSize: 11.5, color: '#94a3b8', marginBottom: 12, lineHeight: 1.5 }}>
          Seus <strong>indicados diretos</strong> aparecem com <strong>contato</strong> — foi a sua venda direta. Já a
          rede abaixo deles (as vendas dos seus indicados) aparece só com <strong>nome e cidade</strong>, por privacidade (LGPD).
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>Carregando seus indicados…</div>
        ) : !raiz || rede.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            Você ainda não tem indicados. Compartilhe seu link acima para começar.
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
