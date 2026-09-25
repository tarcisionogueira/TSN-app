import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Inbox, ShieldAlert, Send, Trash2, RefreshCw, PenSquare, Reply, Forward, Ban, Paperclip, X, Loader2, Undo2, MessageCircle, AlertCircle, ArrowLeft, FileText } from 'lucide-react';
import { useIsMobile } from '../utils/useIsMobile';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';
import EmailHtml from './EmailHtml';
import CampoEmails, { separarEmails } from './CampoEmails';

// ─── CAIXA DE E-MAIL DA EQUIPE (23/09, pedido do dono) ────────────────────────────────────
// Tudo que chega em suporte@/contato@/privacidade@ (via webhook do Resend → `email_caixa`) e
// tudo que a equipe envia daqui. Spam = remetente bloqueado pela equipe ou autenticação que
// falhou (SPF/DKIM/DMARC) — esses NÃO abrem chamado. Ler/mover/bloquear é direto no banco
// (RLS: só equipe); enviar e baixar anexo passam por /api/email-caixa (precisam de segredo).
//
// Regra da casa aplicada aqui: `{ data, error }` sempre olhado (lista vazia por erro de
// leitura parece caixa vazia), e toda mudança confirma com `.select()` — update que a RLS
// barra devolve `error: null` sem ter mudado nada.

const PASTAS = [
  { k: 'entrada', label: 'Entrada', Icon: Inbox },
  { k: 'spam', label: 'Spam', Icon: ShieldAlert },
  { k: 'enviados', label: 'Enviados', Icon: Send },
  { k: 'rascunhos', label: 'Rascunhos', Icon: FileText },
  { k: 'lixeira', label: 'Lixeira', Icon: Trash2 },
];
const CAIXAS = ['suporte', 'contato', 'privacidade'];
const COLS_LISTA = 'id,direcao,pasta,caixa,dono,de_email,de_nome,para,assunto,texto,lido,criado_em,chamado_id,spam_motivo,anexos,resposta_de,entregue_em,aberto_em,clicado_em,entrega_status';
// Filtro de origem (23/09): caixa PESSOAL (endereço da própria pessoa, privada) × COMUNICAÇÃO
// (contato@/suporte@/privacidade@ — da equipe toda).
// Sinal de ENTREGA/ABERTURA de e-mail enviado (webhook do Resend → email_caixa). "Aberto"
// depende de o destinatário carregar imagens: é sinal forte, mas "não aberto" não prova nada.
const fmtHora = (iso) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function StatusEnvio({ m, completo }) {
  if (m.direcao !== 'saida') return null;
  const [txt, cor, dica] = m.entrega_status === 'bounce' ? ['✗ Não entregue (bounce)', '#b91c1c', 'O servidor do destinatário recusou.']
    : m.entrega_status === 'reclamacao' ? ['⚠ Marcado como spam pelo destinatário', '#b91c1c', '']
    : m.clicado_em ? [`👁 Aberto · clicou ${fmtHora(m.clicado_em)}`, '#15803d', '']
    : m.aberto_em ? [`👁 Aberto ${fmtHora(m.aberto_em)}`, '#15803d', '']
    : m.entregue_em ? ['✓ Entregue · ainda não aberto', '#0D63DB', 'Quem bloqueia imagens no e-mail nunca aparece como aberto.']
    : ['… Enviado · aguardando confirmação de entrega', '#94a3b8', ''];
  return <span title={dica} style={{ fontSize: completo ? 12.5 : 11, fontWeight: 700, color: cor }}>{txt}</span>;
}
const ORIGENS = [['todas', 'Todas'], ['minha', 'Minha caixa'], ['comunicacao', 'Comunicação']];
const RE_EMAIL = /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
// Texto plano com endereço de e-mail clicável → abre o "Escrever" daqui (24/09), não o app do aparelho.
function TextoComEmails({ texto, onEscrever }) {
  const partes = String(texto || '').split(RE_EMAIL);
  return partes.map((p, i) => (i % 2 === 1
    ? <button key={i} onClick={() => onEscrever(p)} title="Escrever para este endereço"
        style={{ background: 'none', border: 'none', padding: 0, color: '#0D63DB', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}>{p}</button>
    : <React.Fragment key={i}>{p}</React.Fragment>));
}
// ── CONVERSA (25/09, pedido do dono) ─────────────────────────────────────────────────────
// A lista mostrava cada e-mail solto, e a resposta da equipe ficava em "Enviados": ler uma troca
// era abrir 6 itens em 2 pastas. Agora agrupa por CONVERSA = outra ponta + assunto sem os
// prefixos (Re:/RES:/ENC:/Fwd:…) e abre tudo em sequência, com o histórico citado recolhido.
// Não usa message_id/in_reply_to como chave: o Outlook repete o mesmo message_id em respostas
// diferentes e `referencias` chega em formatos misturados (medido no banco em 25/09) — o
// `resposta_de` (gravado pelo nosso webhook) entra como elo extra na hora de abrir.
const RE_PREFIXO = /^\s*((re|res|fw|fwd|enc|tr|rv|aw|wg)\s*(\[\d+\])?\s*:\s*)+/i;
const normAssunto = (s) => String(s || '').replace(RE_PREFIXO, '').replace(/\s+/g, ' ').trim().toLowerCase();
// Endereço de resposta da equipe leva um código (`tarcisio+<token>@bidprobrasil.com.br`) que
// encadeia a resposta ao envio. O código é só roteamento — na TELA mostra o endereço normal
// (25/09, dono: "é confuso olhar"). Os dados continuam com o código.
const semToken = (e) => String(e || '').replace(/\+[a-z0-9]+@(bidprobrasil\.com\.br)$/i, '@$1');
const listaSemToken = (l) => [...new Set((l || []).map(semToken))].join(', ');
const contraparte = (m) => String(m.direcao === 'saida' ? ((m.para || [])[0] || '') : (m.de_email || '')).trim().toLowerCase();
const chaveConversa = (m) => `${contraparte(m)}|${normAssunto(m.assunto)}`;
// Endereço que pode ir cru num filtro `.or()` do PostgREST (vírgula/parêntese/aspas quebrariam a sintaxe).
const RE_FILTRO_SEGURO = /^[^\s,()"{}]+@[^\s,()"{}]+$/;
// Corta o texto na 1ª linha de histórico citado ("Em … escreveu:", "De: … Enviada em:", ">").
const RE_CITACAO = /^\s*(-{2,}\s*(mensagem original|original message|mensagem encaminhada|forwarded message)|_{8,}\s*$|(de|from)\s*:\s*\S.*)/i;
function separarCitacao(texto) {
  const linhas = String(texto || '').split(/\r?\n/);
  const corte = linhas.findIndex((l, i) => i > 0 && (/^\s*>/.test(l) || RE_CITACAO.test(l)
    || /^\s*(em\s.{3,300}escreveu|on\s.{3,300}wrote)\s*:?\s*$/i.test(`${l} ${linhas[i + 1] || ''}`.trim())
    || /^\s*(em\s.{3,300}escreveu|on\s.{3,300}wrote)\s*:?\s*$/i.test(l)));
  if (corte < 0) return { principal: String(texto || '').trim(), citado: '' };
  const principal = linhas.slice(0, corte).join('\n').trim();
  // Mensagem que é só citação (encaminhamento puro): mostra tudo em vez de um corpo vazio.
  if (!principal) return { principal: String(texto || '').trim(), citado: '' };
  return { principal, citado: linhas.slice(corte).join('\n').trim() };
}

const CAMPOS_RASCUNHO = ['de', 'para', 'cc', 'assunto', 'texto', 'responder_a', 'chamado_id'];
const temConteudo = (c) => !!(c && (String(c.para || '').trim() || String(c.assunto || '').trim() || String(c.texto || '').trim()));

const fmtData = (iso) => {
  const d = new Date(iso);
  const hoje = new Date();
  return d.toDateString() === hoje.toDateString()
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const btn = (ativo) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: ativo ? '#111111' : 'white', color: ativo ? 'white' : '#334155', fontSize: 12, fontWeight: 700, cursor: 'pointer' });

// Corpo não-JSON (502 da plataforma, HTML de erro) não pode estourar a tela: vira um `error`
// que diz o status — quem chama mostra essa frase em vez de "falhou" sem motivo.
async function lerJsonSeguro(res) {
  try { return await res.json(); }
  catch (e) { return { error: `Resposta inesperada do servidor (HTTP ${res.status}): ${e.message}` }; }
}

export default function CaixaEmail({ soPessoal = false }) {
  const [pasta, setPasta] = useState('entrada');
  const [lista, setLista] = useState([]);
  const [naoLidos, setNaoLidos] = useState({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ativa, setAtiva] = useState(null);      // mensagem mais recente da conversa aberta (linha completa)
  const [conversa, setConversa] = useState([]);  // todas as mensagens da conversa, da mais antiga à mais nova
  const [verMais, setVerMais] = useState({});    // { [id]: { html, citado } } — o que cada cartão mostra aberto
  const ultimaRef = useRef(null);
  // Celular (23/09): lista e leitor lado a lado (340px + 1fr) empurravam a mensagem para fora da
  // tela. Abaixo de 900px vira app de e-mail: OU a lista, OU a mensagem aberta com "Voltar".
  const estreito = useIsMobile(900);
  const [busca, setBusca] = useState('');
  const [compor, setCompor] = useState(null);    // { de, para, cc, assunto, texto, responder_a, rascunho_id? }
  const [rascunhos, setRascunhos] = useState([]);
  const [salvoEm, setSalvoEm] = useState(null);  // hora do último salvamento automático
  const rascunhoId = useRef(null);               // ref (não estado): gravar o id não pode redisparar o salvamento
  const salvando = useRef(Promise.resolve());    // fila: dois salvamentos nunca inserem duas linhas
  // Trava de envio (25/09): `enviando` é estado e só vale no próximo render — dois toques rápidos no
  // celular passavam os dois e o e-mail saía 2×. A ref trava na hora; a chave deixa o servidor
  // reconhecer a repetição mesmo assim (retry, aba duplicada).
  const enviandoRef = useRef(false);
  const chaveEnvio = useRef(null);
  const loc = useLocation();
  const navigate = useNavigate();
  const [enviando, setEnviando] = useState(false);
  const [bloqueados, setBloqueados] = useState([]);
  const [origem, setOrigem] = useState('todas');
  const [meuEndereco, setMeuEndereco] = useState(null); // tarcisio@… (equipe_email) ou null
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    supabase.from('equipe_email').select('endereco').eq('user_id', user.id).maybeSingle() // padrao-ok: caixa pessoal é do ATENDENTE logado (id real), nunca do cliente personificado no modo suporte
      .then(({ data, error }) => { if (vivo) { if (error) setErro(`Não consegui ler seu endereço da equipe: ${error.message}`); setMeuEndereco(data?.endereco || null); } });
    return () => { vivo = false; };
  }, [user?.id]);
  const dePadrao = meuEndereco ? 'pessoal' : 'suporte';

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    if (pasta === 'rascunhos') {
      const { data: rs, error: eR } = await supabase.from('email_rascunhos') // padrao-ok: RLS devolve só os rascunhos do próprio usuário logado
        .select('*').order('atualizado_em', { ascending: false }).limit(200);
      if (eR) setErro(`Não consegui ler os rascunhos: ${eR.message}`);
      setRascunhos(eR ? [] : (rs || [])); setLista([]); setCarregando(false);
      return;
    }
    const { data, error } = await supabase.from('email_caixa').select(COLS_LISTA)
      .eq('pasta', pasta).order('criado_em', { ascending: false }).limit(200);
    if (error) { setErro(`Não consegui ler a caixa: ${error.message}`); setLista([]); }
    else setLista(data || []);
    const { data: nl, error: eNl } = await supabase.from('email_caixa').select('pasta').eq('lido', false).in('pasta', ['entrada', 'spam']);
    if (!eNl) setNaoLidos((nl || []).reduce((a, r) => ({ ...a, [r.pasta]: (a[r.pasta] || 0) + 1 }), {}));
    if (pasta === 'spam') {
      const { data: bl, error: eBl } = await supabase.from('email_bloqueados').select('id,padrao,motivo,criado_em').order('criado_em', { ascending: false });
      if (eBl) setErro(`Não consegui ler a lista de bloqueados: ${eBl.message}`); else setBloqueados(bl || []);
    }
    setCarregando(false);
  }, [pasta]);

  useEffect(() => { setAtiva(null); setConversa([]); carregar(); }, [carregar]);
  // Atualiza sozinha a cada minuto com a aba visível — sem depender de alguém lembrar do botão.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  // Abre a CONVERSA inteira: as mensagens desta pasta + o outro lado (Entrada ↔ Enviados), numa
  // leitura só. Spam nunca mistura com o resto (nem o resto com o spam).
  async function abrir(grupo) {
    const base = grupo.msgs[0];
    const ids = grupo.msgs.map(x => x.id);
    const c = contraparte(base);
    const pastas = pasta === 'spam' ? ['spam'] : [...new Set([pasta, 'entrada', 'enviados'])];
    const filtro = [`id.in.(${ids.join(',')})`];
    if (RE_FILTRO_SEGURO.test(c)) filtro.push(`de_email.ilike.${c}`, `para.cs.{"${c}"}`);
    const { data, error } = await supabase.from('email_caixa').select('*')
      .in('pasta', pastas).or(filtro.join(',')).order('criado_em', { ascending: true }).limit(200);
    if (error || !data?.length) { setErro(error ? `Não consegui abrir a conversa: ${error.message}` : 'Mensagem não encontrada.'); return; }
    const chave = chaveConversa(base);
    const doGrupo = new Set(ids);
    const msgs = data.filter(x => doGrupo.has(x.id) || chaveConversa(x) === chave);
    const noFio = new Set(msgs.map(x => x.id));
    // `resposta_de`: resposta que chegou a um e-mail nosso, mesmo que o assunto tenha mudado.
    data.forEach(x => { if (!noFio.has(x.id) && (noFio.has(x.resposta_de) || msgs.some(y => y.resposta_de === x.id))) { msgs.push(x); noFio.add(x.id); } });
    msgs.sort((a, b2) => new Date(a.criado_em) - new Date(b2.criado_em));
    setConversa(msgs);
    setVerMais({});
    setAtiva(msgs.find(x => x.id === base.id) || msgs[msgs.length - 1]);
    if (estreito) window.scrollTo({ top: 0, behavior: 'smooth' }); // a conversa ocupa o lugar da lista
    const naoLidas = msgs.filter(x => !x.lido && x.direcao === 'entrada').map(x => x.id);
    if (naoLidas.length) {
      const { data: up, error: eUp } = await supabase.from('email_caixa').update({ lido: true }).in('id', naoLidas).select('id,pasta');
      if (eUp) { console.warn('[caixa] não consegui marcar como lida:', eUp.message); return; }
      const marcadas = new Set((up || []).map(r => r.id));
      setLista(prev => prev.map(x => marcadas.has(x.id) ? { ...x, lido: true } : x));
      setNaoLidos(prev => (up || []).reduce((a, r) => ({ ...a, [r.pasta]: Math.max(0, (a[r.pasta] || 1) - 1) }), prev));
    }
  }
  // Conversa longa: leva direto à mensagem mais nova (a de baixo), que é a que se veio ler.
  useEffect(() => {
    if (conversa.length > 1) ultimaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [conversa]);

  // Move a conversa INTEIRA desta pasta (não só a última mensagem — senão ela continuaria na lista).
  // `destinoDe` recebe a mensagem porque Restaurar devolve saída → Enviados e entrada → Entrada.
  async function mover(destinoDe, msgOk) {
    const alvo = conversa.filter(x => x.pasta === pasta);
    const porDestino = {};
    alvo.forEach(x => { const d = destinoDe(x); (porDestino[d] = porDestino[d] || []).push(x.id); });
    const movidas = new Set();
    for (const [destino, ids] of Object.entries(porDestino)) {
      const { data, error } = await supabase.from('email_caixa').update({ pasta: destino }).in('id', ids).select('id');
      if (error) { setErro(`Não consegui mover: ${error.message}`); break; }
      (data || []).forEach(r => movidas.add(r.id));
    }
    if (!movidas.size) { setErro(prev => prev || 'Sem permissão para mover esta conversa.'); return false; }
    setLista(prev => prev.filter(x => !movidas.has(x.id)));
    setAtiva(null); setConversa([]);
    setAviso(movidas.size > 1 ? `${msgOk} (${movidas.size} mensagens da conversa)` : msgOk);
    return true;
  }

  async function bloquear(m, porDominio) {
    const email = String(m.de_email || '').toLowerCase();
    if (!email.includes('@')) return;
    const padrao = porDominio ? '@' + email.split('@')[1] : email;
    const alvo = porDominio ? `todo o domínio ${padrao}` : email;
    if (!window.confirm(`Bloquear ${alvo}?\n\nE-mails novos desse remetente vão direto para Spam e não abrem chamado. Os que já estão na Entrada serão movidos para Spam.`)) return;
    const { error } = await supabase.from('email_bloqueados').insert({ padrao, motivo: `bloqueado a partir de "${(m.assunto || '').slice(0, 80)}"` }).select('id');
    if (error && !/duplicate|23505/i.test(error.message)) { setErro(`Não consegui bloquear: ${error.message}`); return; }
    let q = supabase.from('email_caixa').update({ pasta: 'spam' }).eq('pasta', 'entrada').eq('direcao', 'entrada');
    q = porDominio ? q.ilike('de_email', `%${padrao}`) : q.eq('de_email', email);
    const { data: movidos, error: eMov } = await q.select('id');
    if (eMov) { setErro(`Bloqueado, mas não consegui mover os e-mails antigos: ${eMov.message}`); }
    setAtiva(null); setConversa([]);
    setAviso(`${alvo} bloqueado. ${movidos?.length || 0} e-mail(s) movido(s) para Spam.`);
    carregar();
  }

  async function desbloquear(b) {
    const { data, error } = await supabase.from('email_bloqueados').delete().eq('id', b.id).select('id');
    if (error || !data?.length) { setErro(error ? `Não consegui desbloquear: ${error.message}` : 'Sem permissão para desbloquear.'); return; }
    setBloqueados(prev => prev.filter(x => x.id !== b.id));
    setAviso(`${b.padrao} desbloqueado. Mensagens já em Spam continuam lá — use “Não é spam” para trazer de volta.`);
  }

  async function baixarAnexo(m, a, idx) {
    try {
      const res = await apiCall('/api/email-caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'anexo', id: m.id, anexo_id: a.id || undefined, anexo_idx: idx }) });
      const j = await lerJsonSeguro(res);
      if (!res.ok || !j.url) { setErro(j.error || `Não consegui baixar o anexo (HTTP ${res.status}).`); return; }
      window.open(j.url, '_blank', 'noopener,noreferrer');
    } catch (e) { setErro(`Não consegui baixar o anexo: ${e.message}`); }
  }

  // ── RASCUNHO (24/09) ────────────────────────────────────────────────────────────────
  // Abrir o Escrever sempre passa por aqui: zera (ou retoma) o id do rascunho.
  function abrirCompor(c) {
    rascunhoId.current = c?.rascunho_id || null;
    chaveEnvio.current = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    setSalvoEm(null);
    setCompor(c);
  }
  function salvarRascunho(c) {
    if (!temConteudo(c)) return salvando.current;
    const linha = Object.fromEntries(CAMPOS_RASCUNHO.map((k) => [k, c[k] ?? null]));
    linha.atualizado_em = new Date().toISOString();
    salvando.current = salvando.current.then(async () => {
      const q = rascunhoId.current
        ? supabase.from('email_rascunhos').update(linha).eq('id', rascunhoId.current).select('id')
        : supabase.from('email_rascunhos').insert(linha).select('id');
      const { data, error } = await q;
      // `.select()` prova a gravação: update barrado pela RLS devolve error null e 0 linhas.
      if (error || !data?.length) { setErro(`Rascunho NÃO foi salvo: ${error?.message || 'sem permissão'}`); return; }
      rascunhoId.current = data[0].id;
      setSalvoEm(new Date());
    });
    return salvando.current;
  }
  // Salva sozinho 1,2 s depois da última tecla — pausar no meio não perde nada.
  useEffect(() => {
    if (!compor) return;
    const t = setTimeout(() => { salvarRascunho(compor); }, 1200);
    return () => clearTimeout(t);
  }, [compor]); // eslint-disable-line react-hooks/exhaustive-deps
  async function fecharCompor() {
    const c = compor;
    setCompor(null);
    if (temConteudo(c)) {
      await salvarRascunho(c);
      setAviso('Rascunho salvo — continue depois em Rascunhos.');
      if (pasta === 'rascunhos') carregar();
    }
  }
  async function descartarRascunho() {
    const id = rascunhoId.current;
    await salvando.current;
    setCompor(null);
    if (!id) return;
    const { data, error } = await supabase.from('email_rascunhos').delete().eq('id', rascunhoId.current || id).select('id');
    if (error || !data?.length) { setErro(`Não consegui apagar o rascunho: ${error?.message || 'sem permissão'}`); return; }
    rascunhoId.current = null;
    setRascunhos((prev) => prev.filter((r) => r.id !== data[0].id));
    setAviso('Rascunho descartado.');
  }
  function escreverPara(para, assunto = '') {
    abrirCompor({ de: dePadrao, para, cc: '', assunto, texto: '', responder_a: null });
  }
  // Link de e-mail clicado dentro de uma mensagem (EmailHtml reescreve `mailto:` para cá).
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const para = q.get('escrever');
    if (!para) return;
    escreverPara(para, q.get('assunto') || '');
    q.delete('escrever'); q.delete('assunto');
    navigate({ pathname: loc.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
  }, [loc.search]); // eslint-disable-line react-hooks/exhaustive-deps

  function responder(m) {
    const caixaNossa = String(m.caixa || '').split('@')[0];
    abrirCompor({
      // Veio pra minha caixa pessoal → respondo como eu; veio pra comunicação → pelo mesmo endereço.
      de: (m.dono && meuEndereco) ? 'pessoal' : (CAIXAS.includes(caixaNossa) ? caixaNossa : dePadrao),
      para: m.de_email || '', cc: '',
      assunto: /^re:/i.test(m.assunto || '') ? m.assunto : `Re: ${m.assunto || ''}`,
      texto: '', responder_a: m.id, chamado_id: m.chamado_id, citar: false,
    });
  }
  // Encaminhar (25/09): só a última mensagem OU a conversa inteira. Cada mensagem entra sem o
  // histórico citado dela (senão a conversa se repetiria dentro de si mesma a cada resposta).
  // Passando do limite do campo, ficam as MAIS RECENTES — é o que quem recebe precisa ler primeiro.
  function encaminhar(msgs) {
    const bloco = (m) => `---------- Mensagem encaminhada ----------\nDe: ${m.de_nome ? `${m.de_nome} <${m.de_email}>` : m.de_email}\nPara: ${listaSemToken(m.para)}\nData: ${new Date(m.criado_em).toLocaleString('pt-BR')}\nAssunto: ${m.assunto || ''}\n\n${separarCitacao(m.texto).principal}`;
    const blocos = [];
    let tamanho = 0, cortou = false;
    for (const m of [...msgs].reverse()) {
      const b = bloco(m);
      if (tamanho + b.length > 17500 && blocos.length) { cortou = true; break; }
      blocos.unshift(b); tamanho += b.length + 2;
    }
    const corpo = `\n\n${cortou ? '(mensagens mais antigas omitidas por tamanho)\n\n' : ''}${blocos.join('\n\n')}`;
    const ult = msgs[msgs.length - 1];
    abrirCompor({ de: dePadrao, para: '', cc: '', assunto: `Fwd: ${String(ult?.assunto || '').replace(RE_PREFIXO, '')}`, texto: corpo.slice(0, 18000), responder_a: null });
  }

  async function enviar() {
    if (enviandoRef.current || enviando || !compor) return;
    enviandoRef.current = true;
    setEnviando(true); setErro('');
    try {
      const res = await apiCall('/api/email-caixa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'enviar', de: compor.de, para: compor.para, cc: compor.cc, assunto: compor.assunto, texto: compor.texto, responder_a: compor.responder_a || undefined, citar: !!(compor.responder_a && compor.citar), chave_envio: chaveEnvio.current || undefined }),
      });
      const j = await lerJsonSeguro(res);
      if (!res.ok || !j.ok) { setErro(j.error || `Envio falhou (HTTP ${res.status}).`); return; }
      setCompor(null);
      // Enviado: o rascunho some. Espera um salvamento em voo terminar, senão ele recriaria a linha.
      await salvando.current;
      if (rascunhoId.current) {
        const idR = rascunhoId.current; rascunhoId.current = null;
        const { error: eDel } = await supabase.from('email_rascunhos').delete().eq('id', idR).select('id');
        if (eDel) console.warn('[caixa] e-mail enviado, mas o rascunho ficou:', eDel.message);
        setRascunhos((prev) => prev.filter((r) => r.id !== idR));
      }
      setAviso(j.avisos?.length ? `Enviado — atenção: ${j.avisos.join('; ')}.` : 'E-mail enviado.');
      if (pasta === 'enviados') carregar();
    } catch (e) {
      setErro(`Envio falhou: ${e.message}`);
    } finally { enviandoRef.current = false; setEnviando(false); }
  }

  const b = busca.trim().toLowerCase();
  const porOrigem = origem === 'todas' ? lista : lista.filter(m => (origem === 'minha' ? !!m.dono : !m.dono));
  const visiveis = b ? porOrigem.filter(m => [m.de_email, m.de_nome, m.assunto, (m.para || []).join(' ')].some(v => String(v || '').toLowerCase().includes(b))) : porOrigem;
  // Lista vem da mais nova para a mais antiga: o 1º de cada grupo é a mensagem mais recente.
  const conversas = useMemo(() => {
    const mapa = new Map();
    visiveis.forEach(m => { const k = chaveConversa(m); if (!mapa.has(k)) mapa.set(k, { chave: k, msgs: [] }); mapa.get(k).msgs.push(m); });
    return [...mapa.values()];
  }, [visiveis]);
  const ultimaEntrada = [...conversa].reverse().find(x => x.direcao === 'entrada');

  return (
    <div style={{ display: 'grid', gridTemplateColumns: estreito ? 'minmax(0, 1fr)' : '340px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      {/* Barra de pastas + ações */}
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {PASTAS.map(({ k, label, Icon }) => (
          <button key={k} onClick={() => setPasta(k)} style={btn(pasta === k)}>
            <Icon size={14} /> {label}
            {naoLidos[k] > 0 && <span style={{ background: k === 'spam' ? '#dc2626' : '#0D63DB', color: 'white', borderRadius: 10, padding: '0 7px', fontSize: 10 }}>{naoLidos[k]}</span>}
          </button>
        ))}
        <span style={{ width: 1, height: 22, background: '#e2e8f0', margin: '0 4px' }} />
        {ORIGENS.map(([k, l]) => (
          <button key={k} onClick={() => setOrigem(k)} style={{ ...btn(origem === k), background: origem === k ? '#334155' : 'white' }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar remetente ou assunto…"
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, minWidth: estreito ? 0 : 220, flex: estreito ? '1 1 100%' : undefined }} />
        <button onClick={carregar} style={btn(false)} title="Atualizar"><RefreshCw size={14} /></button>
        <button onClick={() => abrirCompor({ de: dePadrao, para: '', cc: '', assunto: '', texto: '', responder_a: null })} style={{ ...btn(true), background: '#0D63DB' }}>
          <PenSquare size={14} /> Escrever
        </button>
      </div>

      {(erro || aviso) && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
          background: erro ? '#fef2f2' : '#f0fdf4', color: erro ? '#b91c1c' : '#15803d', border: `1px solid ${erro ? '#fecaca' : '#bbf7d0'}` }}>
          <AlertCircle size={14} /> <span style={{ flex: 1 }}>{erro || aviso}</span>
          <button onClick={() => { setErro(''); setAviso(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* LISTA */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', display: estreito && ativa ? 'none' : undefined }}>
        {pasta === 'spam' && (
          <div style={{ padding: '10px 14px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', fontSize: 11.5, color: '#9a3412' }}>
            Aqui cai o que veio de remetente <b>bloqueado</b> ou que <b>falhou na autenticação</b> (SPF/DKIM/DMARC — remetente possivelmente forjado). Nada daqui abre chamado. Não clique em links de mensagens suspeitas.
          </div>
        )}
        {carregando ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}><Loader2 size={18} className="spin" /> Carregando…</div>
        ) : pasta === 'rascunhos' ? (
          rascunhos.length === 0
            ? <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{erro ? 'Não foi possível carregar.' : 'Nenhum rascunho. Tudo que você começar a escrever fica salvo aqui sozinho.'}</div>
            : rascunhos.map((r) => (
              <div key={r.id} onClick={() => abrirCompor({ ...Object.fromEntries(CAMPOS_RASCUNHO.map((k) => [k, r[k] ?? ''])), responder_a: r.responder_a || null, chamado_id: r.chamado_id || null, de: r.de || dePadrao, rascunho_id: r.id })}
                style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', borderLeft: '3px solid #f59e0b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.para ? `Para: ${r.para}` : '(sem destinatário)'}</span>
                  <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{fmtData(r.atualizado_em)}</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.assunto || '(sem assunto)'}</div>
                <div style={{ fontSize: 11.5, color: '#b45309', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Rascunho · {String(r.texto || '').slice(0, 80) || 'sem texto'}</div>
              </div>
            ))
        ) : visiveis.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{erro ? 'Não foi possível carregar.' : 'Nenhuma mensagem aqui.'}</div>
        ) : conversas.map(({ chave, msgs }) => {
          const m = msgs[0];
          const sel = !!ativa && conversa.some(x => x.id === m.id);
          const naoLida = msgs.some(x => !x.lido);
          const entrada = msgs.find(x => x.direcao === 'entrada');
          const quem = entrada ? (entrada.de_nome || entrada.de_email || '(sem remetente)') : `Para: ${listaSemToken(m.para)}`;
          return (
            <div key={chave} onClick={() => abrir({ chave, msgs })}
              style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: sel ? '#eff6ff' : 'white', borderLeft: `3px solid ${naoLida ? '#0D63DB' : 'transparent'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: naoLida ? 800 : 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {quem}{msgs.length > 1 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#64748b' }}>({msgs.length})</span>}
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{fmtData(m.criado_em)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#334155', fontWeight: naoLida ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.assunto || '(sem assunto)'}</div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'center' }}>
                {msgs.some(x => x.chamado_id) && <MessageCircle size={11} title="Virou chamado" />}
                {msgs.some(x => (x.anexos || []).length > 0) && <Paperclip size={11} />}
                {m.spam_motivo ? <span style={{ color: '#dc2626' }}>{m.spam_motivo}</span> : m.direcao === 'saida' ? <StatusEnvio m={m} /> : separarCitacao(m.texto).principal.slice(0, 90)}
              </div>
            </div>
          );
        })}
        {pasta === 'spam' && bloqueados.length > 0 && (
          <div style={{ padding: '10px 14px', background: '#f8fafc', borderTop: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', marginBottom: 6 }}>Remetentes bloqueados</div>
            {bloqueados.map(bq => (
              <div key={bq.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '3px 0' }}>
                <span style={{ fontFamily: 'monospace' }}>{bq.padrao}</span>
                <button onClick={() => desbloquear(bq)} style={{ background: 'none', border: 'none', color: '#0D63DB', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>Desbloquear</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LEITOR */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', minHeight: estreito ? 0 : 420, minWidth: 0, display: estreito && !ativa ? 'none' : undefined }}>
        {estreito && ativa && (
          <button onClick={() => { setAtiva(null); setConversa([]); }} style={{ ...btn(false), margin: '12px 12px 0' }}><ArrowLeft size={14} /> Voltar à lista</button>
        )}
        {!ativa ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            <Inbox size={28} style={{ marginBottom: 8 }} /><br />Selecione uma mensagem.
          </div>
        ) : (
          <div style={{ padding: estreito ? 14 : 18 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111', marginBottom: 4, overflowWrap: 'anywhere' }}>{ativa.assunto || '(sem assunto)'}</div>
            <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>
              {conversa.length > 1 ? `${conversa.length} mensagens nesta conversa — da mais antiga para a mais nova.` : '1 mensagem.'}
              {conversa.some(x => x.chamado_id) && <div style={{ color: '#0D63DB' }}><MessageCircle size={12} /> Esta conversa está num chamado da fila — responder daqui também registra no chamado.</div>}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
              {ultimaEntrada && pasta !== 'spam' && <button onClick={() => responder(ultimaEntrada)} style={btn(false)}><Reply size={13} /> Responder</button>}
              <button onClick={() => encaminhar([conversa[conversa.length - 1] || ativa])} style={btn(false)}><Forward size={13} /> {conversa.length > 1 ? 'Encaminhar a última' : 'Encaminhar'}</button>
              {conversa.length > 1 && <button onClick={() => encaminhar(conversa)} style={btn(false)}><Forward size={13} /> Encaminhar a conversa ({conversa.length})</button>}
              {pasta === 'entrada' && <button onClick={() => mover(() => 'spam', 'Movido para Spam.')} style={btn(false)}><ShieldAlert size={13} /> Spam</button>}
              {pasta === 'spam' && <button onClick={() => mover(() => 'entrada', 'Devolvido à Entrada. (Não abre chamado automaticamente — responda daqui se precisar.)')} style={btn(false)}><Undo2 size={13} /> Não é spam</button>}
              {ultimaEntrada?.de_email && <button onClick={() => bloquear(ultimaEntrada, false)} style={{ ...btn(false), color: '#b91c1c' }}><Ban size={13} /> Bloquear remetente</button>}
              {ultimaEntrada?.de_email && <button onClick={() => bloquear(ultimaEntrada, true)} style={{ ...btn(false), color: '#b91c1c' }}><Ban size={13} /> Bloquear domínio</button>}
              {pasta !== 'lixeira'
                ? <button onClick={() => mover(() => 'lixeira', 'Movido para a Lixeira.')} style={btn(false)}><Trash2 size={13} /> Lixeira</button>
                : <button onClick={() => mover((x) => (x.direcao === 'saida' ? 'enviados' : 'entrada'), 'Restaurado.')} style={btn(false)}><Undo2 size={13} /> Restaurar</button>}
            </div>

            {conversa.map((m, idx) => {
              const ultima = idx === conversa.length - 1;
              const nossa = m.direcao === 'saida';
              const spam = m.pasta === 'spam';
              const { principal, citado } = separarCitacao(m.texto);
              const v = verMais[m.id] || {};
              const alternar = (campo) => setVerMais(prev => ({ ...prev, [m.id]: { ...(prev[m.id] || {}), [campo]: !(prev[m.id] || {})[campo] } }));
              const linkBtn = { background: 'none', border: 'none', padding: 0, color: '#0D63DB', cursor: 'pointer', fontSize: 12, fontWeight: 700 };
              // Spam nunca renderiza HTML (nem no iframe isolado): imagem remota confirma ao
              // remetente que o endereço é lido — o que spammer mais quer saber.
              const mostrarHtml = !spam && !!m.html && (v.html || !m.texto);
              return (
                <div key={m.id} ref={ultima ? ultimaRef : undefined}
                  style={{ borderTop: idx ? '1px solid #e2e8f0' : 'none', padding: '14px 0 14px 12px', borderLeft: `3px solid ${nossa ? '#0D63DB' : '#cbd5e1'}`, marginBottom: 2, scrollMarginTop: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 12.5, color: '#475569', overflowWrap: 'anywhere' }}>
                    <span><b style={{ color: '#111' }}>{nossa ? `Nós (${m.de_email})` : (m.de_nome ? `${m.de_nome} <${m.de_email}>` : m.de_email)}</b>
                      {' → '}{listaSemToken(m.para) || semToken(m.caixa)}{(m.cc || []).length > 0 && ` · Cc: ${listaSemToken(m.cc)}`}</span>
                    <span style={{ color: '#94a3b8', flexShrink: 0 }}>{new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  {nossa && <div style={{ marginTop: 2 }}><StatusEnvio m={m} completo /></div>}
                  {m.spam_motivo && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: 12 }}><ShieldAlert size={12} /> Spam: {m.spam_motivo}</div>}

                  {(m.anexos || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
                      {m.anexos.map((a, i) => (a.id || (nossa && m.resend_email_id))
                        ? <button key={i} onClick={() => baixarAnexo(m, a, i)} style={{ ...btn(false), fontWeight: 600 }}><Paperclip size={12} /> {a.nome}</button>
                        : <span key={i} style={{ fontSize: 12, color: '#94a3b8' }}><Paperclip size={12} /> {a.nome}{nossa ? '' : ' (indisponível)'}</span>)}
                    </div>
                  )}

                  <div style={{ marginTop: 8 }}>
                    {mostrarHtml
                      ? <EmailHtml html={m.html} altura={ultima ? 520 : 360} />
                      : <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#1e293b', lineHeight: 1.6, overflowWrap: 'break-word' }}>
                          {!m.texto ? '(mensagem sem texto)' : spam ? m.texto : <TextoComEmails texto={v.citado ? m.texto : principal} onEscrever={(e) => escreverPara(e)} />}
                        </div>}
                  </div>
                  {!spam && (
                    <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
                      {!mostrarHtml && citado && <button onClick={() => alternar('citado')} style={linkBtn}>{v.citado ? 'Ocultar histórico citado' : '··· Mostrar histórico citado'}</button>}
                      {m.html && m.texto && <button onClick={() => alternar('html')} style={linkBtn}>{v.html ? 'Ver só o texto' : 'Ver formatado (original)'}</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* COMPOR */}
      {compor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'white', borderRadius: 14, width: 'min(680px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>{compor.responder_a ? 'Responder' : 'Nova mensagem'}
                {salvoEm && <span style={{ marginLeft: 10, fontSize: 11.5, fontWeight: 600, color: '#94a3b8' }}>rascunho salvo {salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
              </span>
              <button onClick={fecharCompor} title="Fechar (o rascunho fica salvo)" style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            {compor.chamado_id && <div style={{ fontSize: 12, color: '#0D63DB', marginBottom: 8 }}>Esta resposta também entra no histórico do chamado.</div>}
            {[
              ['De', <select key="de" value={compor.de} onChange={e => setCompor({ ...compor, de: e.target.value })} style={campo}>
                {meuEndereco && <option value="pessoal">{meuEndereco} (você — respostas voltam para a sua caixa)</option>}
                {!soPessoal && CAIXAS.map(c => <option key={c} value={c}>{c}@bidprobrasil.com.br (comunicação — respostas vão para a fila de atendimento)</option>)}
              </select>],
              // Etiquetas por endereço (25/09): Tab/Enter/vírgula ou terminar em .com.br confirma cada um.
              // `key` = a chave deste envio: remonta só ao abrir outro rascunho, não a cada tecla.
              ['Para', <CampoEmails key={`para-${chaveEnvio.current}`} valorInicial={separarEmails(compor.para)} onChange={l => setCompor(c => (c && c.para !== l.join(', ') ? { ...c, para: l.join(', ') } : c))} placeholder="email@exemplo.com.br" />],
              ['Cc', <CampoEmails key={`cc-${chaveEnvio.current}`} valorInicial={separarEmails(compor.cc)} onChange={l => setCompor(c => (c && c.cc !== l.join(', ') ? { ...c, cc: l.join(', ') } : c))} placeholder="opcional" />],
              ['Assunto', <input key="as" value={compor.assunto} onChange={e => setCompor({ ...compor, assunto: e.target.value })} style={campo} />],
            ].map(([rot, el]) => (
              <label key={rot} style={{ display: 'grid', gridTemplateColumns: '70px minmax(0, 1fr)', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 700, color: '#475569' }}>{rot}{el}</label>
            ))}
            <textarea value={compor.texto} onChange={e => setCompor({ ...compor, texto: e.target.value })} rows={12}
              placeholder="Escreva sua mensagem… (sua assinatura entra automaticamente)"
              style={{ ...campo, width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
            {compor.responder_a && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: '#475569', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!compor.citar} onChange={e => setCompor({ ...compor, citar: e.target.checked })} />
                Incluir no final o e-mail que estou respondendo (citado). Desmarcado: vai só o que você escreveu.
              </label>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              {temConteudo(compor) && <button onClick={descartarRascunho} style={{ ...btn(false), color: '#b91c1c', marginRight: 'auto' }}><Trash2 size={13} /> Descartar</button>}
              <button onClick={fecharCompor} style={btn(false)}>{temConteudo(compor) ? 'Salvar e fechar' : 'Cancelar'}</button>
              <button onClick={enviar} disabled={enviando} style={{ ...btn(true), background: '#0D63DB', opacity: enviando ? 0.6 : 1 }}>
                {enviando ? <Loader2 size={14} /> : <Send size={14} />} Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const campo = { padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box', width: '100%' };
