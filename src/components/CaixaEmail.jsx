import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Inbox, ShieldAlert, Send, Trash2, RefreshCw, PenSquare, Reply, Forward, Ban, Paperclip, X, Loader2, Undo2, MessageCircle, AlertCircle, ArrowLeft, FileText, Mail, MailOpen, Minus, Maximize2, Minimize2, EllipsisVertical, ChevronLeft, ChevronRight, ChevronDown, Keyboard, Clock } from 'lucide-react';
import { useIsMobile } from '../utils/useIsMobile';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';
import EmailHtml from './EmailHtml';
import CampoEmails, { separarEmails } from './CampoEmails';
import RevisarTexto from './RevisarTexto';
import CobrarPosicao from './CobrarPosicao';

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
  { k: 'agendados', label: 'Agendados', Icon: Clock },
  { k: 'lixeira', label: 'Lixeira', Icon: Trash2 },
];
const CAIXAS = ['suporte', 'contato', 'privacidade'];
const COLS_LISTA = 'id,direcao,pasta,caixa,dono,de_email,de_nome,para,assunto,texto,lido,criado_em,chamado_id,caso_id,spam_motivo,anexos,resposta_de,entregue_em,aberto_em,clicado_em,entrega_status';
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
// AVATAR (23/11, inspirado no Gmail): bolinha com a inicial, cor fixa por endereço — a mesma pessoa
// tem sempre a mesma cor, o que ajuda a separar quem é quem numa conversa longa.
const CORES_AVATAR = ['#0D63DB', '#16a34a', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#4f46e5', '#65a30d', '#b45309', '#0f766e'];
function Avatar({ nome, email, nossa, tamanho = 32 }) {
  const base = String(email || nome || '?').toLowerCase();
  let h = 0;
  for (let i = 0; i < base.length; i++) h = (h * 31 + base.charCodeAt(i)) >>> 0;
  const letra = (String(nome || '').replace(/["'<>]/g, '').trim()[0] || String(email || '?')[0] || '?').toUpperCase();
  return (
    <span aria-hidden="true" style={{ width: tamanho, height: tamanho, borderRadius: 999, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      background: nossa ? '#111111' : CORES_AVATAR[h % CORES_AVATAR.length], color: 'white', fontSize: tamanho * 0.44, fontWeight: 700 }}>
      {nossa ? 'B' : letra}
    </span>
  );
}
// ANEXOS E ETIQUETAS NA LINHA DA LISTA (23/11, inspirado no Gmail): antes era só um clipe e um balão.
// Agora o nome dos anexos (até 2, clicáveis) com o tipo em cor, e etiquetas de Chamado, Caso e de
// qual caixa a conversa veio (quando a lista mistura "Minha caixa" e "Comunicação").
const COR_EXT = { pdf: '#dc2626', doc: '#2563eb', docx: '#2563eb', xls: '#16a34a', xlsx: '#16a34a', csv: '#16a34a', jpg: '#9333ea', jpeg: '#9333ea', png: '#9333ea', gif: '#9333ea', webp: '#9333ea', zip: '#b45309', rar: '#b45309' };
const etiqueta = (cor, fundo) => ({ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '1px 8px', borderRadius: 999, fontSize: 10.5, fontWeight: 700, color: cor, background: fundo, whiteSpace: 'nowrap' });
function EtiquetasLinha({ msgs, m, mostrarCaixa, onAnexo }) {
  const anexos = msgs.flatMap(x => (x.anexos || []).map((a, i) => ({ x, a, i }))).filter(({ a }) => a && !a.inline && a.enviado !== false);
  const chamado = msgs.some(x => x.chamado_id);
  const caso = msgs.some(x => x.caso_id);
  const caixa = mostrarCaixa ? (m.dono ? { t: 'Minha caixa', cor: '#0D63DB', fundo: '#eff6ff' } : m.caixa ? { t: `${String(m.caixa).split('@')[0]}@`, cor: '#15803d', fundo: '#f0fdf4' } : null) : null;
  if (!anexos.length && !chamado && !caso && !caixa) return null;
  return (
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      {anexos.slice(0, 2).map(({ x, a, i }) => {
        const ext = String(a.nome || '').split('.').pop().toLowerCase();
        const abre = !!a.id; // só o que tem cópia baixável abre direto da lista
        const conteudo = <>
          <span style={{ fontSize: 9, fontWeight: 800, color: 'white', background: COR_EXT[ext] || '#64748b', borderRadius: 3, padding: '0 3px', textTransform: 'uppercase' }}>{(ext || 'arq').slice(0, 4)}</span>
          <span style={{ maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.nome || 'anexo'}</span>
        </>;
        const estilo = { display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, border: '1px solid #e2e8f0', background: 'white', fontSize: 11, color: '#334155', maxWidth: 160 };
        return abre
          ? <button key={`${x.id}-${i}`} type="button" title={`Abrir ${a.nome || 'anexo'}`} onClick={(e) => { e.stopPropagation(); onAnexo(x, a, i); }} style={{ ...estilo, cursor: 'pointer' }}>{conteudo}</button>
          : <span key={`${x.id}-${i}`} title={a.nome || ''} style={estilo}>{conteudo}</span>;
      })}
      {anexos.length > 2 && <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>+{anexos.length - 2}</span>}
      {chamado && <span style={etiqueta('#0D63DB', '#eff6ff')}><MessageCircle size={10} /> Chamado</span>}
      {caso && <span style={etiqueta('#7c3aed', '#f5f3ff')}>Caso</span>}
      {caixa && <span style={etiqueta(caixa.cor, caixa.fundo)}>{caixa.t}</span>}
    </div>
  );
}
// "para mim", "para suporte@" ou "para fulano, +2" — o endereço completo fica nos detalhes.
function resumoPara(m) {
  const lista = (m.para || []).map(semToken);
  if (!lista.length) return semToken(m.caixa) || '';
  const primeiro = lista[0].split('@')[0];
  const extras = lista.length - 1 + (m.cc || []).length;
  return extras > 0 ? `${primeiro}, +${extras}` : primeiro;
}
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

// encaminhar_anexos (28/10): o rascunho guarda também as REFERÊNCIAS a anexos de mensagens da caixa (o mesmo
// formato do Encaminhar). Antes sumiam ao fechar a janela, e um rascunho montado com anexos já recebidos voltava sem eles.
// 23/11: + cco, citar e caso_id — o envio AGENDADO sai do rascunho pelo cron, então o rascunho tem de
// guardar tudo o que o botão Enviar mandaria (senão a resposta agendada perderia a citação ou o caso).
const CAMPOS_RASCUNHO = ['de', 'para', 'cc', 'cco', 'assunto', 'texto', 'responder_a', 'chamado_id', 'anexos', 'encaminhar_anexos', 'citar', 'caso_id'];
// Rascunho e Agendado moram na mesma tabela (email_rascunhos); Agendado = rascunho com hora marcada.
const ehPastaRascunho = (p) => p === 'rascunhos' || p === 'agendados';
// Linha do banco → janela de Escrever (uuid vazio não pode virar '' e citar é booleano).
const rascunhoParaCompor = (r, dePadrao) => ({
  ...Object.fromEntries(CAMPOS_RASCUNHO.map((k) => [k, r[k] ?? ''])),
  responder_a: r.responder_a || null, chamado_id: r.chamado_id || null, caso_id: r.caso_id || null, citar: !!r.citar,
  de: r.de || dePadrao, rascunho_id: r.id,
  alerta: r.agendamento_erro || null, // ex.: "JÁ FOI ENVIADO" ou envio interrompido — aparece no topo do Escrever
});
const fmtAgendado = (iso) => new Date(iso).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const temConteudo = (c) => !!(c && (String(c.para || '').trim() || String(c.cco || '').trim() || String(c.assunto || '').trim() || String(c.texto || '').trim() || c.anexos?.length || c.encaminhar_anexos?.length));

// ANEXAR E COLAR IMAGEM (09/10, dono). O arquivo sobe DIRETO para o bucket, no prefixo do próprio
// usuário (o servidor só aceita esse prefixo), e o e-mail leva o caminho. Teto do Resend: 40 MB por
// mensagem, já contando a codificação — aqui 25 MB por arquivo e 30 MB no total.
const MAX_ARQ = 25 * 1024 * 1024, MAX_TOTAL = 30 * 1024 * 1024;
const nomeSeguro = (n) => String(n || 'arquivo').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(-80) || 'arquivo';
const fmtTam = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

// Termo de busca que pode ir dentro do `.or()` do PostgREST: vírgula, parênteses, aspas, dois-pontos e
// curinga quebrariam a sintaxe do filtro (ou injetariam outro filtro). Some com eles; o resto vira texto.
const POR_PAGINA = 50;
const termoBusca = (s) => String(s || '').replace(/[,()"'\\:*%]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const fmtData = (iso) => {
  const d = new Date(iso);
  const hoje = new Date();
  return d.toDateString() === hoje.toDateString()
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const btn = (ativo) => ({ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0', background: ativo ? '#111111' : 'white', color: ativo ? 'white' : '#334155', fontSize: 12, fontWeight: 700, cursor: 'pointer' });
// Botão só de ícone (23/11, inspirado no Gmail): a barra de leitura tinha até 8 botões com texto
// quebrando em duas linhas. O nome vai no `title` (dica ao passar o mouse) e no `aria-label`.
const iconeBtn = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, borderRadius: 8, border: '1px solid transparent', background: 'none', color: '#475569', cursor: 'pointer', padding: 0, flexShrink: 0 };
function BotaoIcone({ titulo, onClick, Icon, cor, tamanho = 16 }) {
  return (
    <button type="button" title={titulo} aria-label={titulo} onClick={onClick}
      onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
      style={{ ...iconeBtn, ...(cor ? { color: cor } : {}) }}>
      <Icon size={tamanho} />
    </button>
  );
}

// Corpo não-JSON (502 da plataforma, HTML de erro) não pode estourar a tela: vira um `error`
// que diz o status — quem chama mostra essa frase em vez de "falhou" sem motivo.
async function lerJsonSeguro(res) {
  try { return await res.json(); }
  catch (e) { return { error: `Resposta inesperada do servidor (HTTP ${res.status}): ${e.message}` }; }
}

// ── GUARDA DA CONVERSA (27/09, dono: "o principal são os documentos expedidos") ──────────────
// Mostra até quando a conversa fica guardada e por quê, e deixa VINCULAR à operação (caso).
// Vinculada a caso aberto = sem prazo; concluído = conclusão + 10 anos (CC art. 205/1.194 — a
// regra inteira mora no banco, `_email_caixa_prazos`, migração email_retencao_por_operacao.sql).
const REGRAS_GUARDA = {
  retencao_manual: 'Retenção manual — sem prazo',
  operacao_em_andamento: 'Operação em andamento — sem prazo',
  operacao_concluida_10a: 'Operação concluída — 10 anos da conclusão',
  juridico_10a: 'Jurídico — 10 anos',
  spam_30d: 'Spam — 30 dias',
  // 30/09: piso de 24 meses (decisão do dono). Chaves antigas mantidas para linha já calculada.
  avulso_24m: 'Avulso — 24 meses',
  sem_resposta_24m: 'Negociação sem resposta — 24 meses',
  com_resposta_24m: 'Negociação sem acordo — 24 meses',
  avulso_90d: 'Avulso — 90 dias',
  sem_resposta_180d: 'Negociação sem resposta — 180 dias',
  com_resposta_365d: 'Negociação sem acordo — 1 ano',
};
function GuardaConversa({ conversa, onErro, onAviso, soLeitura }) {
  const ids = useMemo(() => conversa.map(m => m.id), [conversa]);
  const [prazos, setPrazos] = useState(null);
  const [casos, setCasos] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const ler = useCallback(async () => {
    if (!ids.length) return;
    const { data, error } = await supabase.rpc('email_caixa_prazos', { p_ids: ids });
    if (error) { setPrazos(null); onErro(`Não consegui ler o prazo de guarda: ${error.message}`); return; }
    setPrazos(data || []);
  }, [ids, onErro]);
  useEffect(() => { setPrazos(null); ler(); }, [ler]);
  async function abrirCasos() {
    if (casos) return;
    const { data, error } = await supabase.rpc('email_caixa_casos_opcoes');
    if (error) { onErro(`Não consegui listar as operações: ${error.message}`); return; }
    setCasos(data || []);
  }
  async function definir({ caso, mudarCaso, reter }) {
    setSalvando(true);
    const { data: n, error } = await supabase.rpc('email_caixa_definir_retencao', { p_ids: ids, p_caso: caso || null, p_mudar_caso: mudarCaso, p_reter: reter ?? null });
    setSalvando(false);
    if (error) { onErro(`Não consegui salvar: ${error.message}`); return; }
    if (!n) { onErro('Nada foi alterado — sem acesso a estas mensagens?'); return; }
    onAviso(mudarCaso ? (caso ? `Conversa vinculada à operação (${n} mensagem(ns)).` : 'Vínculo removido.') : (reter ? 'Retenção manual ligada — sem prazo.' : 'Retenção manual desligada.'));
    ler();
  }
  if (!prazos) return null;
  // A conversa inteira compartilha a regra; o prazo mais longo é o que vale para ela.
  const p = prazos.find(x => !x.guardar_ate) || [...prazos].sort((a, b) => new Date(b.guardar_ate) - new Date(a.guardar_ate))[0];
  if (!p) return null;
  const casoAtual = prazos.find(x => x.caso_id)?.caso_id || '';
  const manual = p.regra === 'retencao_manual';
  const opcoes = casos || [];
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 12px', padding: '8px 10px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 12, color: '#334155' }}>
      <span title="Base: Código Civil arts. 1.194 e 205; Lei 9.613/98 art. 10; LGPD arts. 15-16.">
        🗂️ <b>{REGRAS_GUARDA[p.regra] || p.regra}</b>{p.guardar_ate ? ` · guardar até ${new Date(p.guardar_ate).toLocaleDateString('pt-BR')}` : ''}
      </span>
      {!soLeitura && <>
      <select value={casoAtual} disabled={salvando} onFocus={abrirCasos} onMouseDown={abrirCasos}
        onChange={e => definir({ caso: e.target.value, mudarCaso: true })}
        style={{ fontSize: 12, padding: '4px 6px', borderRadius: 8, border: '1px solid #cbd5e1', maxWidth: '100%' }}>
        <option value="">{casoAtual ? '— desvincular da operação —' : 'Vincular à operação…'}</option>
        {casoAtual && !opcoes.some(c => c.id === casoAtual) && <option value={casoAtual}>Operação vinculada</option>}
        {opcoes.map(c => <option key={c.id} value={c.id}>{(c.imovel_endereco || 'Caso sem endereço').slice(0, 60)} · {c.concluido_em ? 'concluído' : c.status_etapa}</option>)}
      </select>
      <button disabled={salvando} onClick={() => definir({ mudarCaso: false, reter: !manual })} style={{ ...btn(false), padding: '4px 10px' }}
        title="Retenção manual: para litígio ou ordem judicial. A conversa não é apagada enquanto estiver ligada.">
        {manual ? 'Desligar retenção manual' : 'Reter sem prazo'}
      </button>
      </>}
    </div>
  );
}

// Texto de e-mail dominado por URLs (a versão texto de e-mail transacional/marketing traz cada imagem
// como "[https://…]"): mais caracteres de link do que de texto, e link suficiente para não ser um e-mail
// comum com 1–2 endereços.
function textoSoDeLinks(t) {
  const links = (String(t).match(/https?:\/\/\S+/g) || []).join('').length;
  const resto = String(t).replace(/\[?https?:\/\/\S+\]?/g, '').replace(/\s+/g, ' ').trim().length;
  return links > 400 && links > resto;
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
  // Mensagens ABERTAS da conversa (23/11, dono: "os emails antigos deveriam poder minimizar"). Ao abrir,
  // só a mais nova e as não lidas vêm expandidas; as outras viram uma linha (quem, trecho, data).
  const [abertas, setAbertas] = useState(() => new Set());
  const leitorRef = useRef(null);
  // Celular (23/09): lista e leitor lado a lado (340px + 1fr) empurravam a mensagem para fora da
  // tela. Abaixo de 900px vira app de e-mail: OU a lista, OU a mensagem aberta com "Voltar".
  const estreito = useIsMobile(900);
  // Pastas numa COLUNA LATERAL (23/11, inspirado no Gmail) só quando cabe: com a tela de Atendimento
  // limitada a 1200px, abaixo disso a terceira coluna espremeria a leitura — volta a barra de botões.
  const lateral = !useIsMobile(1180);
  const [busca, setBusca] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState(''); // o que de fato foi ao banco (após a pausa na digitação)
  const [pagina, setPagina] = useState(0);
  const [total, setTotal] = useState(null);       // contagem exata da pasta com os filtros; null = não consegui ler
  const seqLista = useRef(0);                      // só a resposta da leitura MAIS NOVA entra na tela
  const buscaRef = useRef(null);                   // atalho "/" põe o cursor na busca
  const [compor, setCompor] = useState(null);    // { de, para, cc, assunto, texto, responder_a, rascunho_id? }
  // Escrever em JANELA NO CANTO (23/11, inspirado no Gmail): era um modal que tapava a caixa inteira,
  // e não dava para consultar outro e-mail enquanto escrevia. 'normal' | 'min' (só a barra) | 'max'.
  const [tamCompor, setTamCompor] = useState('normal');
  // Cc SÓ QUANDO PRECISAR (23/11): o campo fica escondido atrás de um link "Cc" ao lado do Para; abre
  // sozinho se já houver cópia (rascunho retomado, cliente do caso marcado).
  const [abrirCc, setAbrirCc] = useState(false);
  const [abrirCco, setAbrirCco] = useState(false); // Cco (23/11): mesma regra do Cc
  // Uma vez à vista, o Cc não some se a pessoa apagar o último endereço enquanto edita.
  const temCc = !!String(compor?.cc || '').trim();
  useEffect(() => { if (temCc) setAbrirCc(true); }, [temCc]);
  const temCco = !!String(compor?.cco || '').trim();
  useEffect(() => { if (temCco) setAbrirCco(true); }, [temCco]);
  // Seleção em LOTE por conversa (chave da conversa) e ações ao passar o mouse na linha (23/11).
  const [selecionadas, setSelecionadas] = useState(() => new Set());
  const [linhaHover, setLinhaHover] = useState(null);
  const [menuMais, setMenuMais] = useState(false);
  const [ajudaAtalhos, setAjudaAtalhos] = useState(false);
  const [agend, setAgend] = useState({ n: 0, falhou: 0 }); // pasta Agendados: total e quantos falharam
  const [menuAgendar, setMenuAgendar] = useState(false);   // seta do Enviar → "Agendar envio"
  const [quandoPersonalizado, setQuandoPersonalizado] = useState('');
  const [rascunhos, setRascunhos] = useState([]);
  const [salvoEm, setSalvoEm] = useState(null);  // hora do último salvamento automático
  const rascunhoId = useRef(null);               // ref (não estado): gravar o id não pode redisparar o salvamento
  const salvando = useRef(Promise.resolve());    // fila: dois salvamentos nunca inserem duas linhas
  // Trava de envio (25/09): `enviando` é estado e só vale no próximo render — dois toques rápidos no
  // celular passavam os dois e o e-mail saía 2×. A ref trava na hora; a chave deixa o servidor
  // reconhecer a repetição mesmo assim (retry, aba duplicada).
  const enviandoRef = useRef(false);
  const chaveEnvio = useRef(null);
  const [subindo, setSubindo] = useState(0);     // arquivos ainda subindo — trava o Enviar
  const inputArquivo = useRef(null);
  const loc = useLocation();
  const navigate = useNavigate();
  const [enviando, setEnviando] = useState(false);
  const [bloqueados, setBloqueados] = useState([]);
  const [origem, setOrigem] = useState('todas');
  const [meuEndereco, setMeuEndereco] = useState(null); // tarcisio@… (equipe_email) ou null
  // CONTATOS DO HISTÓRICO (13/10, pedido do dono: autopreencher com Tab ou clique). Endereços que
  // escreveram para nós ou para quem escrevemos, do mais frequente para o menos; carregado 1× ao
  // abrir o Escrever (a RLS já limita às mensagens que esta pessoa pode ver). Automáticos ficam fora.
  const [contatos, setContatos] = useState([]);
  const contatosCarregados = useRef(false);
  useEffect(() => {
    if (!compor || contatosCarregados.current) return;
    contatosCarregados.current = true;
    supabase.from('email_caixa').select('de_email, de_nome, para, cc, direcao').order('criado_em', { ascending: false }).limit(800)
      .then(({ data, error }) => {
        if (error) { console.warn('[caixa] contatos do histórico:', error.message); contatosCarregados.current = false; return; }
        const robo = /(^|[._-])(no-?reply|nao-?responda|mailer-daemon|bounce|notifica|notifications?|alertas?)([._-]|@)/i;
        const mapa = new Map();
        const somar = (email, nome) => {
          const e = String(email || '').trim().toLowerCase();
          if (!e || !e.includes('@') || robo.test(e)) return;
          const atual = mapa.get(e) || { email: e, nome: '', n: 0 };
          atual.n += 1;
          if (nome && !atual.nome) atual.nome = String(nome).replace(/["<>]/g, '').trim();
          mapa.set(e, atual);
        };
        for (const m of data || []) {
          if (m.direcao === 'entrada') somar(m.de_email, m.de_nome);
          else [...(m.para || []), ...(m.cc || [])].forEach((e) => somar(e));
        }
        setContatos([...mapa.values()].sort((a, b) => b.n - a.n));
      });
  }, [compor]);
  const { user } = useAuth();
  useEffect(() => {
    if (!user?.id) return;
    let vivo = true;
    supabase.from('equipe_email').select('endereco').eq('user_id', user.id).maybeSingle() // padrao-ok: caixa pessoal é do ATENDENTE logado (id real), nunca do cliente personificado no modo suporte
      .then(({ data, error }) => { if (vivo) { if (error) setErro(`Não consegui ler seu endereço da equipe: ${error.message}`); setMeuEndereco(data?.endereco || null); } });
    return () => { vivo = false; };
  }, [user?.id]);
  const dePadrao = meuEndereco ? 'pessoal' : 'suporte';

  // Contagem da pasta Agendados (os meus): quantos esperam e quantos FALHARAM — falha aparece em
  // vermelho na pasta, senão um e-mail que não saiu ficaria esquecido lá dentro.
  const contarAgendados = useCallback(async () => {
    const { data, error } = await supabase.from('email_rascunhos').select('agendamento_status').not('agendado_para', 'is', null); // padrao-ok: RLS — só os do usuário logado
    if (error) { console.warn('[caixa] contagem de agendados:', error.message); return; }
    setAgend({ n: (data || []).length, falhou: (data || []).filter(x => x.agendamento_status === 'falhou').length });
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro('');
    if (ehPastaRascunho(pasta)) {
      let q = supabase.from('email_rascunhos').select('*'); // padrao-ok: RLS devolve só os rascunhos do próprio usuário logado
      q = pasta === 'agendados'
        ? q.not('agendado_para', 'is', null).order('agendado_para', { ascending: true })
        : q.is('agendado_para', null).order('atualizado_em', { ascending: false });
      const { data: rs, error: eR } = await q.limit(200);
      if (eR) setErro(`Não consegui ler os ${pasta}: ${eR.message}`);
      setRascunhos(eR ? [] : (rs || [])); setLista([]); setTotal(null); setCarregando(false);
      contarAgendados();
      return;
    }
    // BUSCA E PÁGINAS NO BANCO (23/11, inspirado no Gmail). Antes vinham as 200 mais recentes e a busca
    // filtrava só essas: medido nesse dia, Enviados tinha 218 — as 18 mais antigas nunca apareciam, nem
    // buscando. Agora o filtro (busca, origem) vai ao banco, a lista vem em páginas de POR_PAGINA e a
    // contagem é a exata. A busca olha também o CORPO (texto), como o Gmail.
    const meu = ++seqLista.current;
    let q = supabase.from('email_caixa').select(COLS_LISTA, { count: 'exact' }).eq('pasta', pasta);
    if (origem === 'minha') q = q.not('dono', 'is', null);
    else if (origem === 'comunicacao') q = q.is('dono', null);
    const termo = termoBusca(buscaAplicada);
    // `destinatarios_texto` = para + cc em texto (coluna gerada, migração email_caixa_busca_destinatarios.sql):
    // `para` é array e o PostgREST não acha trecho dentro de array.
    if (termo) q = q.or(['de_email', 'de_nome', 'assunto', 'texto', 'destinatarios_texto'].map(c => `${c}.ilike.*${termo}*`).join(','));
    const ini = pagina * POR_PAGINA;
    const { data, error, count } = await q.order('criado_em', { ascending: false }).range(ini, ini + POR_PAGINA - 1);
    if (meu !== seqLista.current) return; // chegou depois de outra busca mais nova: descarta
    if (error) { setErro(`Não consegui ler a caixa: ${error.message}`); setLista([]); setTotal(null); }
    else { setLista(data || []); setTotal(count ?? null); }
    const { data: nl, error: eNl } = await supabase.from('email_caixa').select('pasta').eq('lido', false).in('pasta', ['entrada', 'spam']);
    if (!eNl) setNaoLidos((nl || []).reduce((a, r) => ({ ...a, [r.pasta]: (a[r.pasta] || 0) + 1 }), {}));
    if (pasta === 'spam') {
      const { data: bl, error: eBl } = await supabase.from('email_bloqueados').select('id,padrao,motivo,criado_em').order('criado_em', { ascending: false });
      if (eBl) setErro(`Não consegui ler a lista de bloqueados: ${eBl.message}`); else setBloqueados(bl || []);
    }
    setCarregando(false);
    contarAgendados();
  }, [pasta, origem, buscaAplicada, pagina, contarAgendados]);
  // Trocar pasta, origem ou busca volta para a 1ª página.
  useEffect(() => { setPagina(0); }, [pasta, origem, buscaAplicada]);
  // A busca vai ao banco 350 ms depois da última tecla, não a cada letra.
  useEffect(() => {
    const t = setTimeout(() => setBuscaAplicada(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => { setAtiva(null); setConversa([]); setSelecionadas(new Set()); setMenuMais(false); carregar(); }, [carregar]);
  useEffect(() => { setMenuMais(false); }, [ativa]);
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
      .in('pasta', pastas).or(filtro.join(',')).order('criado_em', { ascending: false }).limit(200);
    // 18/10 (bug bounty): era `ascending: true` + limit 200 — com o escritório jurídico (centenas de e-mails)
    // vinham só os 200 MAIS ANTIGOS e a conversa aberta perdia justamente as últimas mensagens. Agora as 200
    // mais recentes; a ordem cronológica é refeita abaixo (msgs.sort).
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
  // Ao abrir uma conversa: expande a mais nova e as não lidas, recolhe o resto e põe o PAINEL DE LEITURA
  // no topo. Antes era `scrollIntoView` na última mensagem, que rolava a PÁGINA inteira para baixo com
  // todas as antigas abertas por extenso (dono, 23/11: "sair descendo a tela"). A chave é a conversa
  // (1ª mensagem): reler a mesma conversa (ação, marcar lida) não fecha o que a pessoa abriu.
  const chaveConversa = conversa[0]?.id || null;
  useEffect(() => {
    if (!conversa.length) { setAbertas(new Set()); return; }
    const ult = conversa[conversa.length - 1];
    setAbertas(new Set([ult.id, ...conversa.filter(x => !x.lido && x.direcao === 'entrada').map(x => x.id)]));
    leitorRef.current?.scrollTo?.({ top: 0 });
  }, [chaveConversa]); // eslint-disable-line react-hooks/exhaustive-deps
  const alternarAberta = (id) => setAbertas(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  // Move a conversa INTEIRA desta pasta (não só a última mensagem — senão ela continuaria na lista).
  // `destinoDe` recebe a mensagem porque Restaurar devolve saída → Enviados e entrada → Entrada.
  // `moverMsgs` (23/11) é o mesmo caminho para a conversa aberta, a ação da linha e o lote selecionado.
  async function moverMsgs(alvo, destinoDe, msgOk) {
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
    setTotal(t => (t == null ? t : Math.max(0, t - movidas.size)));
    if (conversa.some(x => movidas.has(x.id))) { setAtiva(null); setConversa([]); }
    setSelecionadas(new Set());
    setAviso(movidas.size > 1 ? `${msgOk} (${movidas.size} mensagens)` : msgOk);
    // Contador de não lidas das pastas: a mensagem movida pode ter levado um "não lido" junto.
    const { data: nl, error: eNl } = await supabase.from('email_caixa').select('pasta').eq('lido', false).in('pasta', ['entrada', 'spam']);
    if (!eNl) setNaoLidos((nl || []).reduce((a, r) => ({ ...a, [r.pasta]: (a[r.pasta] || 0) + 1 }), {}));
    return true;
  }
  const mover = (destinoDe, msgOk) => moverMsgs(conversa.filter(x => x.pasta === pasta), destinoDe, msgOk);
  const paraLixeira = (msgs) => moverMsgs(msgs, () => 'lixeira', 'Movido para a Lixeira.');
  const paraSpam = (msgs) => moverMsgs(msgs, () => 'spam', 'Movido para Spam.');
  const restaurar = (msgs) => moverMsgs(msgs, (x) => (x.direcao === 'saida' ? 'enviados' : 'entrada'), 'Restaurado.');
  const naoESpam = (msgs) => moverMsgs(msgs, () => 'entrada', 'Devolvido à Entrada. (Não abre chamado automaticamente — responda daqui se precisar.)');

  // MARCAR COMO LIDA / NÃO LIDA (23/11, pedido do dono a partir do Gmail). Abrir a conversa marca
  // tudo como lido e não havia volta. Só mensagem RECEBIDA tem "lido" com sentido; ao desmarcar,
  // basta a mais recente recebida voltar a "não lida" para a conversa reaparecer em negrito.
  // `grupos` = uma lista de conversas, cada uma em ordem CRONOLÓGICA (a última é a mais nova).
  async function marcarLido(grupos, lido) {
    const porConversa = grupos.map(g => g.filter(x => x.direcao === 'entrada')).filter(r => r.length);
    const ids = porConversa.flatMap(r => (lido ? r.filter(x => !x.lido) : r.slice(-1).filter(x => x.lido))).map(x => x.id);
    if (!porConversa.length) { setAviso('Só há mensagens enviadas por nós aqui — não há o que marcar.'); return false; }
    if (!ids.length) { setAviso(lido ? 'Já estava lida.' : 'Já estava não lida.'); return false; }
    const { data, error } = await supabase.from('email_caixa').update({ lido }).in('id', ids).select('id,pasta');
    if (error) { setErro(`Não consegui marcar como ${lido ? 'lida' : 'não lida'}: ${error.message}`); return false; }
    if (!data?.length) { setErro('Nada foi alterado — sem acesso a estas mensagens?'); return false; }
    const feitas = new Set(data.map(r => r.id));
    setLista(prev => prev.map(x => (feitas.has(x.id) ? { ...x, lido } : x)));
    setConversa(prev => prev.map(x => (feitas.has(x.id) ? { ...x, lido } : x)));
    setNaoLidos(prev => data.reduce((a, r) => ({ ...a, [r.pasta]: Math.max(0, (a[r.pasta] || 0) + (lido ? -1 : 1)) }), prev));
    setSelecionadas(new Set());
    return true;
  }
  // Ordem da conversa aberta é da mais antiga para a mais nova; a da LISTA é da mais nova para a mais antiga.
  const cronologica = (msgs) => [...msgs].sort((a, b2) => new Date(a.criado_em) - new Date(b2.criado_em));
  async function naoLidaDaLeitura() {
    if (await marcarLido([conversa.filter(x => x.pasta === pasta)], false)) { setAtiva(null); setConversa([]); setAviso('Marcada como não lida.'); }
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

  // Abre o anexo COM O TIPO CERTO (26/09, dono: página em branco no iPhone). O link do Resend
  // entrega tudo como "download genérico" e o navegador do app não mostra; o servidor repassa o
  // arquivo com o tipo pelo nome (PDF, página…). A aba abre JÁ no clique — aberta depois do
  // await, o iPhone a trata como pop-up e bloqueia.
  async function baixarAnexo(m, a, idx) {
    const aba = window.open('', '_blank');
    try {
      const res = await apiCall('/api/email-caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'anexo', id: m.id, anexo_id: a.id || undefined, anexo_idx: idx, proxy: true }) });
      if (!res.ok || /application\/json/.test(res.headers.get('content-type') || '')) {
        const j = await lerJsonSeguro(res);
        // Cópia nossa no Storage: abre o link direto (vídeo/áudio precisam ler por pedaços).
        if (res.ok && j.direto && j.url) { if (aba) aba.location.href = j.url; else window.location.href = j.url; return; }
        aba?.close();
        setErro(j.error || `Não consegui abrir o anexo (HTTP ${res.status}).`);
        return;
      }
      const url = URL.createObjectURL(await res.blob());
      if (aba) aba.location.href = url; else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 120000);
    } catch (e) { aba?.close(); setErro(`Não consegui abrir o anexo: ${e.message}`); }
  }

  // ── RASCUNHO (24/09) ────────────────────────────────────────────────────────────────
  // Abrir o Escrever sempre passa por aqui: zera (ou retoma) o id do rascunho.
  // Com a janela no canto (23/11), dá para clicar Responder/Escrever com outra mensagem ainda aberta.
  // Antes de trocar, a anterior é GRAVADA — e só depois o id do rascunho muda; trocar o id com um
  // salvamento ainda na fila faria o novo e-mail sobrescrever o rascunho antigo.
  async function abrirCompor(c) {
    if (compor && temConteudo(compor)) {
      await salvarRascunho(compor);
      setAviso('O e-mail que estava sendo escrito ficou salvo em Rascunhos.');
      if (ehPastaRascunho(pasta)) carregar();
    } else await salvando.current;
    setTamCompor('normal');
    setAbrirCc(false);
    setAbrirCco(false);
    setMenuAgendar(false);
    rascunhoId.current = c?.rascunho_id || null;
    if (c) c = { ...c, anexos: Array.isArray(c.anexos) ? c.anexos : [], encaminhar_anexos: Array.isArray(c.encaminhar_anexos) ? c.encaminhar_anexos : [] };
    chaveEnvio.current = crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    setSalvoEm(null);
    setCompor(c);
  }
  function salvarRascunho(c) {
    if (!temConteudo(c)) return salvando.current;
    const linha = Object.fromEntries(CAMPOS_RASCUNHO.map((k) => [k, c[k] ?? null]));
    // uuid vazio ('') e booleano em texto quebram a gravação: normaliza antes (23/11, campos novos).
    for (const k of ['responder_a', 'chamado_id', 'caso_id']) linha[k] = linha[k] || null;
    linha.citar = !!linha.citar;
    linha.atualizado_em = new Date().toISOString();
    // Resolve `true` só quando gravou — o Agendar precisa saber, os demais só esperam.
    salvando.current = salvando.current.then(async () => {
      const q = rascunhoId.current
        ? supabase.from('email_rascunhos').update(linha).eq('id', rascunhoId.current).select('id')
        : supabase.from('email_rascunhos').insert(linha).select('id');
      const { data, error } = await q;
      // `.select()` prova a gravação: update barrado pela RLS devolve error null e 0 linhas.
      if (error || !data?.length) { setErro(`Rascunho NÃO foi salvo: ${error?.message || 'sem permissão'}`); return false; }
      rascunhoId.current = data[0].id;
      setSalvoEm(new Date());
      return true;
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
      if (ehPastaRascunho(pasta)) carregar();
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
  // ── AGENDAR ENVIO (23/11, a seta do Enviar no Gmail) ──────────────────────────────────────────
  // Agendado = rascunho com hora marcada; quem envia é api/email-agendados-cron.js (a cada 5 min), pela
  // MESMA função do botão Enviar. Aqui só se grava o rascunho e se marca a hora — e só depois de o
  // rascunho estar gravado (senão o cron mandaria uma versão velha do texto).
  async function agendar(quando) {
    setMenuAgendar(false);
    if (!compor) return;
    const d = new Date(quando);
    if (Number.isNaN(d.getTime())) { setErro('Data e hora inválidas.'); return; }
    if (d.getTime() < Date.now() + 60_000) { setErro('Escolha uma hora pelo menos 1 minuto à frente (para agora, use Enviar).'); return; }
    if (d.getTime() > Date.now() + 365 * 86_400_000) { setErro('O agendamento pode ser de no máximo 1 ano.'); return; }
    if (subindo > 0) { setErro('Aguarde os anexos terminarem de subir.'); return; }
    if (!String(compor.para || '').trim() || !String(compor.assunto || '').trim() || !String(compor.texto || '').trim()) {
      setErro('Para agendar, preencha o destinatário, o assunto e a mensagem.'); return;
    }
    const gravou = await salvarRascunho({ ...compor });
    if (!gravou || !rascunhoId.current) return; // salvarRascunho já disse o motivo
    const { data, error } = await supabase.from('email_rascunhos')
      .update({ agendado_para: d.toISOString(), agendamento_status: 'agendado', agendamento_erro: null, chave_envio: chaveEnvio.current, atualizado_em: new Date().toISOString() })
      .eq('id', rascunhoId.current).select('id');
    if (error || !data?.length) { setErro(`Não consegui agendar: ${error?.message || 'sem permissão'}. O e-mail ficou em Rascunhos.`); return; }
    rascunhoId.current = null;
    setCompor(null);
    setAviso(`Agendado para ${fmtAgendado(d)}. Até lá ele fica em Agendados — dá para cancelar ou editar.`);
    contarAgendados();
    if (ehPastaRascunho(pasta)) carregar();
  }
  // Só cancela o que ainda NÃO começou a sair: o filtro de status é a trava contra o cron no meio do envio.
  async function cancelarAgendamento(r, calado = false) {
    const { data, error } = await supabase.from('email_rascunhos')
      .update({ agendado_para: null, agendamento_status: null, agendamento_erro: r.agendamento_status === 'falhou' ? r.agendamento_erro : null })
      .eq('id', r.id).in('agendamento_status', ['agendado', 'falhou']).select('id');
    if (error) { setErro(`Não consegui cancelar o agendamento: ${error.message}`); return false; }
    if (!data?.length) { setErro('Não deu para cancelar: o envio já começou (ou já saiu). Confira em Enviados.'); carregar(); return false; }
    setRascunhos((prev) => prev.filter((x) => x.id !== r.id));
    contarAgendados();
    if (!calado) setAviso('Agendamento cancelado — o e-mail voltou para Rascunhos.');
    return true;
  }
  // Abrir um agendado para editar cancela o agendamento (como no Gmail): editar com o cron podendo
  // mandar a qualquer momento seria mandar uma versão pela metade.
  async function abrirAgendado(r) {
    if (r.agendamento_status === 'enviando') { setAviso('Este e-mail está sendo enviado agora.'); return; }
    if (!(await cancelarAgendamento(r, true))) return;
    await abrirCompor(rascunhoParaCompor(r, dePadrao));
    setAviso('Para editar, o agendamento foi cancelado. Envie agora ou agende de novo pela seta ao lado de Enviar.');
  }
  // Atalhos de hora como os do Gmail: amanhã de manhã/à tarde e a próxima segunda de manhã.
  const opcoesAgendar = () => {
    const em = (dias, h) => { const d = new Date(); d.setDate(d.getDate() + dias); d.setHours(h, 0, 0, 0); return d; };
    const seg = new Date(); seg.setDate(seg.getDate() + (((8 - seg.getDay()) % 7) || 7)); seg.setHours(8, 0, 0, 0);
    return [['Amanhã de manhã', em(1, 8)], ['Amanhã à tarde', em(1, 13)], ['Segunda-feira de manhã', seg]];
  };
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

  async function responder(m) {
    const caixaNossa = String(m.caixa || '').split('@')[0];
    // `await`: a leitura do cliente do caso (abaixo) só pode completar a janela DESTA resposta.
    await abrirCompor({
      // Veio pra minha caixa pessoal → respondo como eu; veio pra comunicação → pelo mesmo endereço.
      de: (m.dono && meuEndereco) ? 'pessoal' : (CAIXAS.includes(caixaNossa) ? caixaNossa : dePadrao),
      para: m.de_email || '', cc: '',
      assunto: /^re:/i.test(m.assunto || '') ? m.assunto : `Re: ${m.assunto || ''}`,
      texto: '', responder_a: m.id, chamado_id: m.chamado_id, citar: false,
    });
    // 12/11 (dono): resposta a e-mail de CASO oferece copiar o cliente — marcado por padrão quando o caso pede
    // (casos.copiar_cliente). Leitura falhou: a caixa avisa e a resposta segue sem a opção (nunca cópia silenciosa).
    const casoId = m.caso_id || conversa.find((x) => x.caso_id)?.caso_id;
    if (!soPessoal && casoId) {
      apiCall('/api/email-caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'cliente_do_caso', caso_id: casoId }) })
        .then(lerJsonSeguro)
        .then((j) => {
          if (!j?.ok || !j.email) { if (j?.error) setAviso(`Sem a opção de copiar o cliente: ${j.error}`); return; }
          const email = String(j.email).toLowerCase();
          setCompor((c) => {
            if (!c || c.responder_a !== m.id) return c;
            const cc = String(c.cc || '').split(/[,;\s]+/).filter(Boolean);
            const novoCc = j.copiar_cliente && !cc.map((e) => e.toLowerCase()).includes(email) ? [...cc, email].join(', ') : c.cc;
            return { ...c, cliente_caso: { email, nome: j.nome || null }, cc: novoCc };
          });
        })
        .catch((e) => { console.error('[caixa] cliente do caso:', e?.message); setAviso('Não consegui ler o cliente do caso — a opção de copiá-lo não aparece nesta resposta.'); });
    }
  }
  // Liga/desliga o cliente do caso no Cc da resposta (12/11).
  function alternarClienteCc(marcar) {
    setCompor((c) => {
      if (!c?.cliente_caso) return c;
      const email = c.cliente_caso.email;
      const cc = String(c.cc || '').split(/[,;\s]+/).filter(Boolean).filter((e) => e.toLowerCase() !== email);
      return { ...c, cc: (marcar ? [...cc, email] : cc).join(', ') };
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
    // ANEXOS VÃO JUNTO (09/10, dono: "Encaminhar a conversa" chegou sem os anexos). Como em todo
    // cliente de e-mail: encaminhar leva os anexos; responder leva só o texto. Vai a REFERÊNCIA de
    // cada anexo (mensagem + id ou posição); o servidor busca o arquivo e recusa o envio se faltar um.
    const encaminhar_anexos = msgs.flatMap((m) => (m.anexos || []).map((a, i) => ({ id: m.id, anexo_id: a.id || undefined, anexo_idx: i, nome: a.nome || 'anexo' }))
      .filter((x, i) => { const a = (m.anexos || [])[i]; return a && a.enviado !== false && (a.id || a.arquivo || (m.direcao === 'saida' && m.resend_email_id)); }));
    abrirCompor({ de: dePadrao, para: '', cc: '', assunto: `Fwd: ${String(ult?.assunto || '').replace(RE_PREFIXO, '')}`, texto: corpo.slice(0, 18000), responder_a: null, encaminhar_anexos });
  }

  // SÓ O ANEXO AO CLIENTE (10/10, dono): o advogado responde com a guia da parcela e ela segue ao
  // cliente sem o texto do advogado — mensagem padrão nossa + apenas os anexos daquela mensagem
  // (dá para tirar algum no "×" antes de enviar). O destinatário vem do caso, não de digitação.
  async function anexoAoCliente(m) {
    setErro('');
    const res = await apiCall('/api/email-caixa', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ acao: 'cliente_do_caso', caso_id: m.caso_id }) });
    const j = await lerJsonSeguro(res);
    if (!res.ok || !j.ok) { setErro(j.error || `Não consegui achar o cliente do caso (HTTP ${res.status}).`); return; }
    const encaminhar_anexos = (m.anexos || []).map((a, i) => ({ id: m.id, anexo_id: a.id || undefined, anexo_idx: i, nome: a.nome || 'anexo' }));
    const primeiro = String(j.nome || '').split(' ')[0];
    abrirCompor({
      de: meuEndereco ? 'pessoal' : dePadrao, para: j.email, cc: '',
      assunto: `Guia de pagamento — ${j.endereco || 'seu imóvel arrematado'}`,
      texto: `Olá${primeiro ? `, ${primeiro}` : ''}!\n\nSegue em anexo a guia de pagamento da parcela do seu arremate${j.endereco ? ` (${j.endereco})` : ''}.\n\nConfira o valor e o vencimento e, depois de pagar, responda este e-mail com o comprovante para registrarmos.\n\nQualquer dúvida, é só responder.`,
      responder_a: null, encaminhar_anexos, caso_id: m.caso_id,
    });
  }

  // Sobe os arquivos e põe em compor.anexos. `inline` = imagem colada: o marcador "[imagem: nome]"
  // entra no texto onde estava o cursor e o servidor troca pela imagem no corpo do e-mail.
  async function anexarArquivos(arquivos, { inline = false, alvo = null } = {}) {
    const lista = [...(arquivos || [])].filter(Boolean);
    if (!lista.length || !user?.id) return;
    let total = (compor?.anexos || []).reduce((t, a) => t + (a.tamanho || 0), 0);
    for (const f of lista) {
      if (f.size > MAX_ARQ) { setErro(`"${f.name}" passa de 25 MB — e-mail não comporta. Mande por link.`); continue; }
      if (total + f.size > MAX_TOTAL) { setErro('Os anexos passam de 30 MB no total — o e-mail não comporta.'); break; }
      total += f.size;
      const hora = new Date().toLocaleTimeString('pt-BR').replace(/:/g, '');
      const nome = inline && (!f.name || f.name === 'image.png') ? `imagem-colada-${hora}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}` : (f.name || 'arquivo');
      const arquivo = `email/saida/${user.id}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${nomeSeguro(nome)}`;
      if (inline && alvo) {
        const marcador = `[imagem: ${nome}]`;
        const ini = alvo.selectionStart ?? alvo.value.length, fim = alvo.selectionEnd ?? ini;
        setCompor((c) => (c ? { ...c, texto: `${c.texto.slice(0, ini)}\n${marcador}\n${c.texto.slice(fim)}` } : c));
      }
      setSubindo((n) => n + 1);
      const tirarMarcador = () => { if (inline) setCompor((c) => (c ? { ...c, texto: c.texto.split(`[imagem: ${nome}]`).join('') } : c)); };
      try {
        const { error } = await supabase.storage.from('documentos').upload(arquivo, f, { contentType: f.type || 'application/octet-stream', upsert: false });
        if (error) { tirarMarcador(); setErro(`Não consegui anexar "${nome}": ${error.message}`); continue; }
        setCompor((c) => (c ? { ...c, anexos: [...(c.anexos || []), { arquivo, nome, tamanho: f.size, ...(inline ? { inline: true } : {}) }] } : c));
      } catch (e) {
        console.error('[caixa] upload de anexo:', e);
        tirarMarcador();
        setErro(`Não consegui anexar "${nome}": ${e.message}`);
      } finally { setSubindo((n) => n - 1); }
    }
  }
  function aoColar(e) {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) return;           // texto colado segue o caminho normal
    e.preventDefault();
    anexarArquivos(imgs, { inline: true, alvo: e.target });
  }

  async function enviar() {
    if (enviandoRef.current || enviando || !compor) return;
    if (subindo > 0) { setErro('Aguarde os anexos terminarem de subir.'); return; }
    enviandoRef.current = true;
    setEnviando(true); setErro('');
    try {
      const res = await apiCall('/api/email-caixa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'enviar', de: compor.de, para: compor.para, cc: compor.cc, cco: compor.cco, assunto: compor.assunto, texto: compor.texto, responder_a: compor.responder_a || undefined, citar: !!(compor.responder_a && compor.citar), encaminhar_anexos: compor.encaminhar_anexos?.length ? compor.encaminhar_anexos : undefined, anexos: compor.anexos?.length ? compor.anexos.map(({ arquivo, nome, inline }) => ({ arquivo, nome, inline })) : undefined, caso_id: compor.caso_id || undefined, chave_envio: chaveEnvio.current || undefined }),
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

  // Número ao lado da pasta: não lidas (Entrada/Spam) ou, em Agendados, quantos esperam — em vermelho se
  // algum FALHOU (aí o número é o de falhas, que é o que pede ação).
  const contagemPasta = (k) => (k === 'agendados' ? (agend.falhou || agend.n) : naoLidos[k] || 0);
  const corContagem = (k) => (k === 'spam' || (k === 'agendados' && agend.falhou) ? '#dc2626' : null);
  // Busca e origem já vêm filtradas do banco (`carregar`) — a lista é a página como veio.
  const visiveis = lista;
  // Lista vem da mais nova para a mais antiga: o 1º de cada grupo é a mensagem mais recente.
  const conversas = useMemo(() => {
    const mapa = new Map();
    visiveis.forEach(m => { const k = chaveConversa(m); if (!mapa.has(k)) mapa.set(k, { chave: k, msgs: [] }); mapa.get(k).msgs.push(m); });
    return [...mapa.values()];
  }, [visiveis]);
  const ultimaEntrada = [...conversa].reverse().find(x => x.direcao === 'entrada');

  // ATALHOS DE TECLADO (23/11, os do Gmail). Ignorados enquanto se digita (campo, texto, seleção) e
  // com a janela de Escrever aberta — senão "r" ou "c" no meio de uma frase disparariam ações.
  // O ouvinte é um só (montado uma vez); a ref recebe a versão atual a cada render.
  const atalhoRef = useRef(null);
  useEffect(() => {
    atalhoRef.current = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const alvo = e.target;
      const tag = String(alvo?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || alvo?.isContentEditable) {
        if (e.key === 'Escape' && alvo === buscaRef.current) alvo.blur();
        return;
      }
      const k = e.key;
      if (k === '?') { e.preventDefault(); setAjudaAtalhos(v => !v); return; }
      if (k === 'Escape') {
        if (ajudaAtalhos) setAjudaAtalhos(false);
        else if (menuMais) setMenuMais(false);
        else if (ativa && !compor) { setAtiva(null); setConversa([]); }
        return;
      }
      if (compor && tamCompor !== 'min') return;
      if (k === '/') { e.preventDefault(); buscaRef.current?.focus(); return; }
      if (k === 'c') { e.preventDefault(); abrirCompor({ de: dePadrao, para: '', cc: '', assunto: '', texto: '', responder_a: null }); return; }
      if (ehPastaRascunho(pasta)) return;
      if (k === 'j' || k === 'k') {
        if (!conversas.length) return;
        e.preventDefault();
        const idx = ativa ? conversas.findIndex(c => conversa.some(x => x.id === c.msgs[0].id)) : -1;
        const novo = idx < 0 ? 0 : Math.min(conversas.length - 1, Math.max(0, idx + (k === 'j' ? 1 : -1)));
        if (novo !== idx) abrir(conversas[novo]);
        return;
      }
      if (!ativa) return;
      if (k === 'u') { setAtiva(null); setConversa([]); }
      else if (k === 'r' && ultimaEntrada && pasta !== 'spam') { e.preventDefault(); responder(ultimaEntrada); }
      else if (k === 'f') { e.preventDefault(); encaminhar([conversa[conversa.length - 1] || ativa]); }
      else if (k === '#' || k === 'Delete') {
        if (pasta === 'lixeira') mover((x) => (x.direcao === 'saida' ? 'enviados' : 'entrada'), 'Restaurado.');
        else mover(() => 'lixeira', 'Movido para a Lixeira.');
      }
      else if (k === '!' && pasta === 'entrada') mover(() => 'spam', 'Movido para Spam.');
      else if (k === 'U' && ultimaEntrada && pasta !== 'enviados') naoLidaDaLeitura();
    };
  });
  useEffect(() => {
    const ouvir = (e) => atalhoRef.current?.(e);
    window.addEventListener('keydown', ouvir);
    return () => window.removeEventListener('keydown', ouvir);
  }, []);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: estreito ? 'minmax(0, 1fr)' : lateral ? '176px 330px minmax(0, 1fr)' : '340px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      {lateral ? (
        // Tela larga: no topo só a busca e o atualizar; pastas, origem e Escrever vão para a coluna lateral.
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' }}>
          <input ref={buscaRef} type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar na caixa inteira (remetente, destinatário, assunto, texto)…  /"
            style={{ flex: 1, maxWidth: 560, marginLeft: 192, padding: '9px 16px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#f1f5f9', fontSize: 13 }} />
          <BotaoIcone titulo="Atualizar" Icon={RefreshCw} onClick={carregar} />
          <BotaoIcone titulo="Atalhos de teclado (?)" Icon={Keyboard} onClick={() => setAjudaAtalhos(true)} />
        </div>
      ) : (
      /* Barra de pastas + ações (tela média e celular) */
      <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {PASTAS.map(({ k, label, Icon }) => (
          <button key={k} onClick={() => setPasta(k)} style={btn(pasta === k)}>
            <Icon size={14} /> {label}
            {contagemPasta(k) > 0 && <span style={{ background: corContagem(k) || '#0D63DB', color: 'white', borderRadius: 10, padding: '0 7px', fontSize: 10 }}>{contagemPasta(k)}</span>}
          </button>
        ))}
        <span style={{ width: 1, height: 22, background: '#e2e8f0', margin: '0 4px' }} />
        {ORIGENS.map(([k, l]) => (
          <button key={k} onClick={() => setOrigem(k)} style={{ ...btn(origem === k), background: origem === k ? '#334155' : 'white' }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        <input ref={buscaRef} type="search" value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar na caixa inteira (remetente, destinatário, assunto, texto)…  /"
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, minWidth: estreito ? 0 : 220, flex: estreito ? '1 1 100%' : undefined }} />
        <button onClick={carregar} style={btn(false)} title="Atualizar"><RefreshCw size={14} /></button>
        {!estreito && <button onClick={() => setAjudaAtalhos(true)} style={btn(false)} title="Atalhos de teclado (?)"><Keyboard size={14} /></button>}
        <button onClick={() => abrirCompor({ de: dePadrao, para: '', cc: '', assunto: '', texto: '', responder_a: null })} style={{ ...btn(true), background: '#0D63DB' }}>
          <PenSquare size={14} /> Escrever
        </button>
      </div>
      )}

      {(erro || aviso) && (
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, fontWeight: 600,
          background: erro ? '#fef2f2' : '#f0fdf4', color: erro ? '#b91c1c' : '#15803d', border: `1px solid ${erro ? '#fecaca' : '#bbf7d0'}` }}>
          <AlertCircle size={14} /> <span style={{ flex: 1 }}>{erro || aviso}</span>
          <button onClick={() => { setErro(''); setAviso(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><X size={14} /></button>
        </div>
      )}

      {/* COLUNA LATERAL (tela larga): Escrever em destaque, pastas com contagem e o filtro de origem. */}
      {lateral && (
        <nav aria-label="Pastas" style={{ display: 'grid', gap: 2, position: 'sticky', top: 12 }}>
          <button onClick={() => abrirCompor({ de: dePadrao, para: '', cc: '', assunto: '', texto: '', responder_a: null })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 10, justifySelf: 'start', padding: '14px 22px', marginBottom: 12, borderRadius: 16, border: 'none', background: '#dbeafe', color: '#0f2f66', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 1px 3px rgba(15,23,42,.12)' }}>
            <PenSquare size={18} /> Escrever
          </button>
          {PASTAS.map(({ k, label, Icon }) => {
            const ativo = pasta === k;
            return (
              <button key={k} onClick={() => setPasta(k)} aria-current={ativo ? 'page' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '7px 12px 7px 16px', border: 'none', borderRadius: 999, cursor: 'pointer', textAlign: 'left',
                  background: ativo ? '#dbeafe' : 'none', color: ativo ? '#0f2f66' : '#334155', fontSize: 13, fontWeight: ativo || (k !== 'agendados' && naoLidos[k] > 0) ? 800 : 500 }}>
                <Icon size={16} /> <span style={{ flex: 1 }}>{label}</span>
                {contagemPasta(k) > 0 && <span style={{ fontSize: 11.5, fontWeight: 700, color: corContagem(k) || 'inherit' }}>{contagemPasta(k)}</span>}
              </button>
            );
          })}
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', margin: '16px 0 4px 16px' }}>Origem</div>
          {ORIGENS.map(([k, l]) => (
            <button key={k} onClick={() => setOrigem(k)} aria-pressed={origem === k}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '6px 12px 6px 16px', border: 'none', borderRadius: 999, cursor: 'pointer', textAlign: 'left',
                background: origem === k ? '#f1f5f9' : 'none', color: '#334155', fontSize: 12.5, fontWeight: origem === k ? 700 : 500 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: k === 'minha' ? '#0D63DB' : k === 'comunicacao' ? '#16a34a' : '#94a3b8' }} /> {l}
            </button>
          ))}
        </nav>
      )}

      {/* LISTA */}
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden', display: estreito && ativa ? 'none' : undefined }}>
        {pasta === 'spam' && (
          <div style={{ padding: '10px 14px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', fontSize: 11.5, color: '#9a3412' }}>
            Aqui cai o que veio de remetente <b>bloqueado</b> ou que <b>falhou na autenticação</b> (SPF/DKIM/DMARC — remetente possivelmente forjado). Nada daqui abre chamado. Não clique em links de mensagens suspeitas.
          </div>
        )}
        {/* SELEÇÃO EM LOTE (23/11): marcar várias conversas e agir de uma vez, como no Gmail. */}
        {!ehPastaRascunho(pasta) && !carregando && (conversas.length > 0 || pagina > 0) && (() => {
          const marcadas = conversas.filter(c => selecionadas.has(c.chave));
          const msgsMarcadas = marcadas.flatMap(c => c.msgs);
          const todas = marcadas.length === conversas.length;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '4px 8px 4px 14px', borderBottom: '1px solid #e2e8f0', background: marcadas.length ? '#eff6ff' : '#f8fafc', minHeight: 40 }}>
              <input type="checkbox" aria-label="Selecionar todas" title={todas ? 'Desmarcar todas' : 'Selecionar todas desta página'}
                checked={todas} ref={(el) => { if (el) el.indeterminate = marcadas.length > 0 && !todas; }}
                onChange={() => setSelecionadas(todas ? new Set() : new Set(conversas.map(c => c.chave)))}
                style={{ width: 15, height: 15, cursor: 'pointer', margin: '0 8px 0 0' }} />
              {marcadas.length === 0 ? (() => {
                // PÁGINAS (23/11, como o "1–50 de 18.819" do Gmail). Conta MENSAGENS (o que o banco
                // pagina); a lista agrupa em conversas dentro da página.
                const ini = pagina * POR_PAGINA;
                const fim = ini + lista.length;
                const temMais = total != null ? fim < total : lista.length === POR_PAGINA;
                return (
                  <>
                    {buscaAplicada && <span style={{ fontSize: 11.5, color: '#0D63DB', fontWeight: 700, marginRight: 8 }}>Busca: “{buscaAplicada}”</span>}
                    <span style={{ fontSize: 11.5, color: '#64748b', marginLeft: 'auto', marginRight: 4 }}
                      title={total == null ? 'Não consegui contar o total' : `${total} mensagem(ns) nesta pasta${buscaAplicada ? ' com esta busca' : ''}`}>
                      {lista.length ? `${(ini + 1).toLocaleString('pt-BR')}–${fim.toLocaleString('pt-BR')}` : '0'}
                      {total != null && ` de ${total.toLocaleString('pt-BR')}`}
                    </span>
                    <span style={{ opacity: pagina > 0 ? 1 : 0.35, pointerEvents: pagina > 0 ? 'auto' : 'none' }}>
                      <BotaoIcone titulo="Mais recentes" Icon={ChevronLeft} onClick={() => setPagina(p => Math.max(0, p - 1))} />
                    </span>
                    <span style={{ opacity: temMais ? 1 : 0.35, pointerEvents: temMais ? 'auto' : 'none' }}>
                      <BotaoIcone titulo="Mais antigas" Icon={ChevronRight} onClick={() => setPagina(p => p + 1)} />
                    </span>
                  </>
                );
              })() : (
                <>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#0D63DB', marginRight: 'auto' }}>{marcadas.length} selecionada(s)</span>
                  {pasta === 'lixeira'
                    ? <BotaoIcone titulo="Restaurar" Icon={Undo2} onClick={() => restaurar(msgsMarcadas)} />
                    : <BotaoIcone titulo="Mover para a Lixeira" Icon={Trash2} onClick={() => paraLixeira(msgsMarcadas)} />}
                  {pasta === 'entrada' && <BotaoIcone titulo="Mover para Spam" Icon={ShieldAlert} onClick={() => paraSpam(msgsMarcadas)} />}
                  {pasta === 'spam' && <BotaoIcone titulo="Não é spam" Icon={Undo2} onClick={() => naoESpam(msgsMarcadas)} />}
                  {pasta !== 'enviados' && <BotaoIcone titulo="Marcar como lida" Icon={MailOpen} onClick={() => marcarLido(marcadas.map(c => cronologica(c.msgs)), true)} />}
                  {pasta !== 'enviados' && <BotaoIcone titulo="Marcar como não lida" Icon={Mail} onClick={() => marcarLido(marcadas.map(c => cronologica(c.msgs)), false)} />}
                  <BotaoIcone titulo="Limpar seleção" Icon={X} onClick={() => setSelecionadas(new Set())} />
                </>
              )}
            </div>
          );
        })()}
        {carregando ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}><Loader2 size={18} className="spin" /> Carregando…</div>
        ) : ehPastaRascunho(pasta) ? (
          rascunhos.length === 0
            ? <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{erro ? 'Não foi possível carregar.' : pasta === 'agendados' ? 'Nenhum e-mail agendado. No Escrever, use a seta ao lado de Enviar para marcar a hora.' : 'Nenhum rascunho. Tudo que você começar a escrever fica salvo aqui sozinho.'}</div>
            : rascunhos.map((r) => {
              const agendado = !!r.agendado_para;
              const falhou = r.agendamento_status === 'falhou';
              const enviandoAgora = r.agendamento_status === 'enviando';
              return (
              <div key={r.id} onClick={() => (agendado ? abrirAgendado(r) : abrirCompor(rascunhoParaCompor(r, dePadrao)))}
                style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', borderLeft: `3px solid ${falhou ? '#dc2626' : agendado ? '#0D63DB' : '#f59e0b'}`, background: falhou ? '#fef2f2' : 'white' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.para ? `Para: ${r.para}` : '(sem destinatário)'}</span>
                  <span style={{ fontSize: 11, color: agendado ? '#0D63DB' : '#94a3b8', fontWeight: agendado ? 700 : 400, flexShrink: 0 }}>{agendado ? fmtAgendado(r.agendado_para) : fmtData(r.atualizado_em)}</span>
                </div>
                <div style={{ fontSize: 12.5, color: '#334155', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.assunto || '(sem assunto)'}</div>
                {agendado ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 11.5, color: falhou ? '#b91c1c' : '#0D63DB', fontWeight: 600, overflowWrap: 'anywhere' }}>
                      {falhou ? `✗ Não saiu: ${r.agendamento_erro || 'falha desconhecida'}` : enviandoAgora ? 'Enviando agora…' : <><Clock size={11} /> Envio agendado para {fmtAgendado(r.agendado_para)}</>}
                    </span>
                    {!enviandoAgora && <button type="button" onClick={(e) => { e.stopPropagation(); cancelarAgendamento(r); }}
                      style={{ ...btn(false), padding: '3px 9px', fontSize: 11 }}>{falhou ? 'Voltar a rascunho' : 'Cancelar agendamento'}</button>}
                  </div>
                ) : (
                  <div style={{ fontSize: 11.5, color: r.agendamento_erro ? '#b91c1c' : '#b45309', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.agendamento_erro || `Rascunho · ${String(r.texto || '').slice(0, 80) || 'sem texto'}`}
                  </div>
                )}
              </div>
              );
            })
        ) : visiveis.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{erro ? 'Não foi possível carregar.' : buscaAplicada ? `Nada encontrado para “${buscaAplicada}” nesta pasta.` : 'Nenhuma mensagem aqui.'}</div>
        ) : conversas.map(({ chave, msgs }) => {
          const m = msgs[0];
          const sel = !!ativa && conversa.some(x => x.id === m.id);
          const naoLida = msgs.some(x => !x.lido);
          const entrada = msgs.find(x => x.direcao === 'entrada');
          const quem = entrada ? (entrada.de_nome || entrada.de_email || '(sem remetente)') : `Para: ${listaSemToken(m.para)}`;
          const marcada = selecionadas.has(chave);
          // Ações da linha aparecem ao passar o mouse (no lugar da data), só no computador — no
          // celular não há "passar o mouse"; lá vale a caixinha + a barra de lote.
          const acoesLinha = !estreito && linhaHover === chave;
          const parar = (fn) => (e) => { e.stopPropagation(); fn(); };
          return (
            <div key={chave} onClick={() => abrir({ chave, msgs })}
              onMouseEnter={() => setLinhaHover(chave)} onMouseLeave={() => setLinhaHover(h => (h === chave ? null : h))}
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: marcada ? '#dbeafe' : sel ? '#eff6ff' : acoesLinha ? '#f8fafc' : 'white', borderLeft: `3px solid ${naoLida ? '#0D63DB' : 'transparent'}`, boxShadow: acoesLinha ? 'inset 0 -1px 0 #e2e8f0, 0 1px 3px rgba(15,23,42,.08)' : 'none' }}>
              <input type="checkbox" checked={marcada} aria-label="Selecionar conversa" onClick={(e) => e.stopPropagation()}
                onChange={() => setSelecionadas(prev => { const n = new Set(prev); if (n.has(chave)) n.delete(chave); else n.add(chave); return n; })}
                style={{ width: 15, height: 15, marginTop: 2, cursor: 'pointer', flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', minHeight: 20 }}>
                <span style={{ fontSize: 13, fontWeight: naoLida ? 800 : 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {quem}{msgs.length > 1 && <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: '#64748b' }}>({msgs.length})</span>}
                </span>
                {acoesLinha ? (
                  <span style={{ display: 'inline-flex', flexShrink: 0, margin: '-6px -6px -6px 0' }}>
                    {pasta === 'lixeira'
                      ? <BotaoIcone titulo="Restaurar" Icon={Undo2} tamanho={15} onClick={parar(() => restaurar(msgs))} />
                      : <BotaoIcone titulo="Mover para a Lixeira" Icon={Trash2} tamanho={15} onClick={parar(() => paraLixeira(msgs))} />}
                    {pasta === 'entrada' && <BotaoIcone titulo="Mover para Spam" Icon={ShieldAlert} tamanho={15} onClick={parar(() => paraSpam(msgs))} />}
                    {entrada && pasta !== 'enviados' && (naoLida
                      ? <BotaoIcone titulo="Marcar como lida" Icon={MailOpen} tamanho={15} onClick={parar(() => marcarLido([cronologica(msgs)], true))} />
                      : <BotaoIcone titulo="Marcar como não lida" Icon={Mail} tamanho={15} onClick={parar(() => marcarLido([cronologica(msgs)], false))} />)}
                  </span>
                ) : (
                  <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{fmtData(m.criado_em)}</span>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: '#334155', fontWeight: naoLida ? 700 : 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.assunto || '(sem assunto)'}</div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {m.spam_motivo ? <span style={{ color: '#dc2626' }}>{m.spam_motivo}</span> : m.direcao === 'saida' ? <StatusEnvio m={m} /> : separarCitacao(m.texto).principal.slice(0, 90)}
              </div>
              <EtiquetasLinha msgs={msgs} m={m} mostrarCaixa={origem === 'todas' && !soPessoal} onAnexo={(x, a, i) => baixarAnexo(x, a, i)} />
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
      {/* Tela larga (23/11, dono): o leitor fica PRESO na tela, ao lado da lista, e rola sozinho — o corpo do
          e-mail desce sem levar a lista e as pastas junto. No celular segue a rolagem da página. */}
      <div ref={leitorRef} style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', minHeight: estreito ? 0 : 420, minWidth: 0, display: estreito && !ativa ? 'none' : undefined,
        ...(estreito ? {} : { position: 'sticky', top: 12, maxHeight: 'calc(100vh - 24px)', overflowY: 'auto', overscrollBehavior: 'contain' }) }}>
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
              {conversa.length > 1 && (
                <button type="button" onClick={() => setAbertas(abertas.size >= conversa.length ? new Set([conversa[conversa.length - 1].id]) : new Set(conversa.map(x => x.id)))}
                  style={{ marginLeft: 8, background: 'none', border: 'none', padding: 0, color: '#0D63DB', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>
                  {abertas.size >= conversa.length ? 'Recolher as antigas' : 'Expandir todas'}
                </button>
              )}
              {conversa.some(x => x.chamado_id) && <div style={{ color: '#0D63DB' }}><MessageCircle size={12} /> Esta conversa está num chamado da fila — responder daqui também registra no chamado.</div>}
            </div>

            {/* BARRA DE AÇÕES (23/11, inspirada no Gmail): eram até 8 botões com texto quebrando em duas
                linhas. Ficam à vista Responder + ícones do dia a dia; o que é raro ou perigoso (bloquear)
                vai para o "⋮ Mais". O que cada ícone faz aparece ao passar o mouse. */}
            {(() => {
              const itensMais = [
                conversa.length > 1 && { k: 'fwd-todas', label: `Encaminhar a conversa inteira (${conversa.length})`, Icon: Forward, fn: () => encaminhar(conversa) },
                !soPessoal && ultimaEntrada?.caso_id && ultimaEntrada.anexos?.length > 0 && { k: 'anexo', label: 'Enviar só o anexo ao cliente', Icon: Forward, cor: '#047857', fn: () => anexoAoCliente(ultimaEntrada) },
                ultimaEntrada?.de_email && { k: 'bl-rem', label: 'Bloquear remetente', Icon: Ban, cor: '#b91c1c', fn: () => bloquear(ultimaEntrada, false) },
                ultimaEntrada?.de_email && { k: 'bl-dom', label: 'Bloquear domínio inteiro', Icon: Ban, cor: '#b91c1c', fn: () => bloquear(ultimaEntrada, true) },
              ].filter(Boolean);
              return (
                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0', paddingBottom: 10, borderBottom: '1px solid #f1f5f9' }}>
                  {ultimaEntrada && pasta !== 'spam' && <button onClick={() => responder(ultimaEntrada)} style={{ ...btn(false), marginRight: 6 }}><Reply size={13} /> Responder</button>}
                  <BotaoIcone titulo={conversa.length > 1 ? 'Encaminhar a última mensagem' : 'Encaminhar'} Icon={Forward} onClick={() => encaminhar([conversa[conversa.length - 1] || ativa])} />
                  <span style={{ width: 1, height: 20, background: '#e2e8f0', margin: '0 4px' }} />
                  {pasta === 'entrada' && <BotaoIcone titulo="Mover para Spam" Icon={ShieldAlert} onClick={() => mover(() => 'spam', 'Movido para Spam.')} />}
                  {pasta === 'spam' && <BotaoIcone titulo="Não é spam (devolver à Entrada)" Icon={Undo2} onClick={() => mover(() => 'entrada', 'Devolvido à Entrada. (Não abre chamado automaticamente — responda daqui se precisar.)')} />}
                  {pasta !== 'lixeira'
                    ? <BotaoIcone titulo="Mover para a Lixeira" Icon={Trash2} onClick={() => mover(() => 'lixeira', 'Movido para a Lixeira.')} />
                    : <BotaoIcone titulo="Restaurar" Icon={Undo2} onClick={() => mover((x) => (x.direcao === 'saida' ? 'enviados' : 'entrada'), 'Restaurado.')} />}
                  {ultimaEntrada && pasta !== 'enviados' && <BotaoIcone titulo="Marcar como não lida" Icon={Mail} onClick={naoLidaDaLeitura} />}
                  {itensMais.length > 0 && (
                    <span style={{ position: 'relative' }}>
                      <BotaoIcone titulo="Mais ações" Icon={EllipsisVertical} onClick={() => setMenuMais(v => !v)} />
                      {menuMais && <>
                        {/* Clique fora fecha o menu. */}
                        <div onClick={() => setMenuMais(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                        <div role="menu" style={{ position: 'absolute', top: 36, right: 0, zIndex: 41, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,.14)', padding: 4, minWidth: 240 }}>
                          {itensMais.map(({ k, label, Icon, cor, fn }) => (
                            <button key={k} role="menuitem" onClick={() => { setMenuMais(false); fn(); }}
                              onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                              style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 10px', border: 'none', background: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: cor || '#334155', textAlign: 'left' }}>
                              <Icon size={14} /> {label}
                            </button>
                          ))}
                        </div>
                      </>}
                    </span>
                  )}
                </div>
              );
            })()}

            {pasta !== 'spam' && pasta !== 'lixeira' && user?.id && <CobrarPosicao conversa={conversa} userId={user.id} onErro={setErro} onAviso={setAviso} />}

            <GuardaConversa conversa={conversa} onErro={setErro} onAviso={setAviso} soLeitura={soPessoal} />

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
              // Versão texto que é quase só LINK (30/09, print do dono: e-mail do Mercado Pago virou
              // uma parede de "[https://…]" — cada imagem do HTML vira URL no texto). Nesse caso a
              // versão formatada abre por padrão; o botão continua alternando. Spam segue só texto.
              // HTML guardado no teto de 300k (29/10) foi CORTADO na entrada — imagem colada em base64
              // estourava o limite e o resto do e-mail sumia. O texto está inteiro: abre nele.
              // RECOLHIDA: uma linha só — quem, trecho e data. Clicar abre.
              if (!abertas.has(m.id)) {
                const trecho = (principal || m.texto || '').replace(/\s+/g, ' ').trim().slice(0, 160) || (m.html ? '(mensagem formatada)' : '(sem texto)');
                return (
                  <button key={m.id} type="button" onClick={() => alternarAberta(m.id)} title="Abrir esta mensagem"
                    style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none', border: 'none',
                      borderTop: idx ? '1px solid #e2e8f0' : 'none', borderLeft: `3px solid ${nossa ? '#0D63DB' : '#cbd5e1'}`, padding: '10px 0 10px 12px', marginBottom: 2 }}>
                    <Avatar nome={nossa ? 'BidPro' : m.de_nome} email={m.de_email} nossa={nossa} />
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ fontSize: 13, fontWeight: !m.lido && !nossa ? 800 : 700, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nossa ? 'Nós' : (m.de_nome || m.de_email)}</span>
                      <span style={{ fontSize: 12, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{trecho}</span>
                    </span>
                    {(m.anexos || []).length > 0 && <Paperclip size={13} color="#94a3b8" style={{ flexShrink: 0 }} />}
                    <span style={{ color: '#94a3b8', fontSize: 11.5, flexShrink: 0, paddingRight: 4 }}>{new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                  </button>
                );
              }
              const htmlCortado = !!m.html && m.html.length >= 300000 && !!m.texto;
              const padraoHtml = !!m.html && !htmlCortado && (!m.texto || textoSoDeLinks(m.texto));
              const mostrarHtml = !spam && !!m.html && (v.html !== undefined ? v.html : padraoHtml);
              return (
                <div key={m.id}
                  style={{ borderTop: idx ? '1px solid #e2e8f0' : 'none', padding: '14px 0 14px 12px', borderLeft: `3px solid ${nossa ? '#0D63DB' : '#cbd5e1'}`, marginBottom: 2, scrollMarginTop: 12 }}>
                  {/* CABEÇALHO (23/11, inspirado no Gmail): avatar + nome em destaque, endereço miúdo e
                      "para …" resumido; o endereçamento completo abre no ▾ (antes ia tudo por extenso). */}
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <Avatar nome={nossa ? 'BidPro' : m.de_nome} email={m.de_email} nossa={nossa} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                        <span onClick={conversa.length > 1 ? () => alternarAberta(m.id) : undefined} title={conversa.length > 1 ? 'Recolher esta mensagem' : undefined}
                          style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, cursor: conversa.length > 1 ? 'pointer' : undefined }}>
                          <b style={{ color: '#111' }}>{nossa ? 'Nós' : (m.de_nome || m.de_email)}</b>
                          <span style={{ marginLeft: 6, fontSize: 11.5, color: '#64748b' }}>{nossa ? semToken(m.de_email) : (m.de_nome ? `<${m.de_email}>` : '')}</span>
                        </span>
                        <span style={{ color: '#94a3b8', fontSize: 11.5, flexShrink: 0 }}>{new Date(m.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <button type="button" onClick={() => alternar('detalhes')} aria-expanded={!!v.detalhes}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 11.5, color: '#64748b' }}>
                        para {resumoPara(m)} {v.detalhes ? '▴' : '▾'}
                      </button>
                      {v.detalhes && (
                        <div style={{ marginTop: 6, padding: '8px 10px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#475569', display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', gap: '3px 8px', overflowWrap: 'anywhere' }}>
                          <span style={{ color: '#94a3b8' }}>de:</span><span>{m.de_nome ? `${m.de_nome} <${semToken(m.de_email)}>` : semToken(m.de_email)}</span>
                          <span style={{ color: '#94a3b8' }}>para:</span><span>{listaSemToken(m.para) || semToken(m.caixa)}</span>
                          {(m.cc || []).length > 0 && <><span style={{ color: '#94a3b8' }}>cc:</span><span>{listaSemToken(m.cc)}</span></>}
                          {(m.cco || []).length > 0 && <><span style={{ color: '#94a3b8' }} title="Cópia oculta: o destinatário não vê">cco:</span><span>{listaSemToken(m.cco)} <span style={{ color: '#94a3b8' }}>(oculto)</span></span></>}
                          <span style={{ color: '#94a3b8' }}>data:</span><span>{new Date(m.criado_em).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}</span>
                          <span style={{ color: '#94a3b8' }}>assunto:</span><span>{m.assunto || '(sem assunto)'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {nossa && <div style={{ marginTop: 2 }}><StatusEnvio m={m} completo /></div>}
                  {m.spam_motivo && <div style={{ color: '#dc2626', fontWeight: 700, fontSize: 12 }}><ShieldAlert size={12} /> Spam: {m.spam_motivo}</div>}

                  {(m.anexos || []).length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '8px 0' }}>
                      {m.anexos.map((a, i) => a.enviado === false
                        // 16/10: anexo que NÃO foi no e-mail (o servidor não conseguiu baixar, ou o Resend
                        // não entregou). Mostrar como clicável fingia um envio que não aconteceu.
                        ? <span key={i} title={a.motivo || ''} style={{ fontSize: 12, color: '#b91c1c', textDecoration: 'line-through' }}><Paperclip size={12} /> {a.nome} — não foi no e-mail</span>
                        : (a.id || (nossa && m.resend_email_id))
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
                      {m.html && m.texto && <button onClick={() => setVerMais(prev => ({ ...prev, [m.id]: { ...(prev[m.id] || {}), html: !mostrarHtml } }))} style={linkBtn}>{mostrarHtml ? 'Ver só o texto' : 'Ver formatado (original)'}</button>}
                    </div>
                  )}
                  {/* No celular a barra de ações fica lá no topo, fora da vista de quem leu até o fim (29/10). */}
                  {ultima && pasta !== 'spam' && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
                      {ultimaEntrada && <button onClick={() => responder(ultimaEntrada)} style={btn(false)}><Reply size={13} /> Responder</button>}
                      <button onClick={() => encaminhar([m])} style={btn(false)}><Forward size={13} /> Encaminhar</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* COMPOR */}
      {ajudaAtalhos && (
        <div onClick={() => setAjudaAtalhos(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.35)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div role="dialog" aria-label="Atalhos de teclado" onClick={(e) => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 14, padding: 20, width: 'min(460px, 100%)', boxShadow: '0 12px 40px rgba(15,23,42,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: 15, display: 'inline-flex', alignItems: 'center', gap: 8 }}><Keyboard size={16} /> Atalhos de teclado</span>
              <BotaoIcone titulo="Fechar" Icon={X} onClick={() => setAjudaAtalhos(false)} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '70px minmax(0, 1fr)', gap: '7px 12px', fontSize: 13, color: '#334155', alignItems: 'center' }}>
              {[
                ['j / k', 'Próxima / anterior conversa'],
                ['u', 'Voltar à lista'],
                ['r', 'Responder'],
                ['f', 'Encaminhar a última mensagem'],
                ['#', 'Mover para a Lixeira (na Lixeira: restaurar)'],
                ['!', 'Mover para Spam'],
                ['Shift+U', 'Marcar como não lida'],
                ['c', 'Escrever'],
                ['/', 'Buscar'],
                ['Esc', 'Fechar menu / conversa'],
                ['?', 'Mostrar esta ajuda'],
              ].map(([t, d]) => (
                <React.Fragment key={t}>
                  <kbd style={{ justifySelf: 'start', fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700, padding: '2px 7px', borderRadius: 6, border: '1px solid #cbd5e1', borderBottomWidth: 2, background: '#f8fafc', color: '#111' }}>{t}</kbd>
                  <span>{d}</span>
                </React.Fragment>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 11.5, color: '#94a3b8' }}>Os atalhos não funcionam enquanto você digita num campo ou com a janela de Escrever aberta.</div>
          </div>
        </div>
      )}

      {/* JANELA NO CANTO (23/11, inspirada no Gmail): não tapa a caixa — dá para abrir outra conversa
          e consultar enquanto escreve. Minimizar deixa só a barra; tela cheia escurece o fundo. No
          celular continua ocupando a tela (não cabe janela flutuante). */}
      {compor && (() => {
        const minimizada = tamCompor === 'min' && !estreito;
        const cheia = tamCompor === 'max' && !estreito;
        const posicao = estreito ? { inset: 0, borderRadius: 0 }
          : minimizada ? { right: 24, bottom: 0, width: 320, borderRadius: '12px 12px 0 0' }
          : cheia ? { top: '4vh', left: '50%', transform: 'translateX(-50%)', width: 'min(1000px, 94vw)', height: '92vh', borderRadius: 12 }
          : { right: 24, bottom: 0, width: 'min(580px, calc(100vw - 48px))', height: 'min(660px, 88vh)', borderRadius: '12px 12px 0 0' };
        const titulo = compor.responder_a ? 'Responder' : 'Nova mensagem';
        const parar = (fn) => (e) => { e.stopPropagation(); fn(); };
        return (<>
        {cheia && <div onClick={() => setTamCompor('normal')} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.35)', zIndex: 999 }} />}
        <div role="dialog" aria-label={titulo} style={{ position: 'fixed', ...posicao, zIndex: 1000, background: 'white', border: '1px solid #e2e8f0', boxShadow: '0 8px 32px rgba(15,23,42,.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div onClick={minimizada ? () => setTamCompor('normal') : undefined} title={minimizada ? 'Abrir' : undefined}
              style={{ display: 'flex', alignItems: 'center', gap: 2, padding: '6px 6px 6px 14px', background: '#f1f5f9', cursor: minimizada ? 'pointer' : 'default', flexShrink: 0 }}>
              <span style={{ flex: 1, minWidth: 0, fontWeight: 700, fontSize: 13.5, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {minimizada && compor.assunto ? compor.assunto : titulo}
                {salvoEm && !minimizada && <span style={{ marginLeft: 10, fontSize: 11.5, fontWeight: 600, color: '#94a3b8' }}>rascunho salvo {salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
              </span>
              {!estreito && <BotaoIcone titulo={minimizada ? 'Abrir' : 'Minimizar'} Icon={Minus} tamanho={15} onClick={parar(() => setTamCompor(minimizada ? 'normal' : 'min'))} />}
              {!estreito && <BotaoIcone titulo={cheia ? 'Sair da tela cheia' : 'Tela cheia'} Icon={cheia ? Minimize2 : Maximize2} tamanho={14} onClick={parar(() => setTamCompor(cheia ? 'normal' : 'max'))} />}
              <BotaoIcone titulo="Fechar (o rascunho fica salvo)" Icon={X} tamanho={16} onClick={parar(fecharCompor)} />
            </div>
            {!minimizada && <>
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
            {compor.alerta && <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, fontWeight: 600, color: '#b91c1c', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '6px 10px', marginBottom: 8 }}><AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {compor.alerta}</div>}
            {compor.chamado_id && <div style={{ fontSize: 12, color: '#0D63DB', marginBottom: 8 }}>Esta resposta também entra no histórico do chamado.</div>}
            {[
              ['De', <select key="de" value={compor.de} onChange={e => setCompor({ ...compor, de: e.target.value })} style={campo}>
                {meuEndereco && <option value="pessoal">{meuEndereco} (você — respostas voltam para a sua caixa)</option>}
                {!soPessoal && CAIXAS.map(c => <option key={c} value={c}>{c}@bidprobrasil.com.br (comunicação — respostas vão para a fila de atendimento)</option>)}
              </select>],
              // Etiquetas por endereço (25/09): Tab/Enter/vírgula ou terminar em .com.br confirma cada um.
              // `key` = a chave deste envio: remonta só ao abrir outro rascunho, não a cada tecla.
              ['Para', <div key="para" style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <CampoEmails key={`para-${chaveEnvio.current}`} valorInicial={separarEmails(compor.para)} onChange={l => setCompor(c => (c && c.para !== l.join(', ') ? { ...c, para: l.join(', ') } : c))} placeholder="email@exemplo.com.br" sugestoes={contatos} />
                </div>
                {!(abrirCc || temCc) && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setAbrirCc(true); }} title="Adicionar cópia (Cc)"
                    style={{ background: 'none', border: 'none', padding: '4px 6px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#475569' }}>Cc</button>
                )}
                {!(abrirCco || temCco) && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setAbrirCco(true); }} title="Adicionar cópia oculta (Cco) — quem está em Para e Cc não vê"
                    style={{ background: 'none', border: 'none', padding: '4px 6px', cursor: 'pointer', fontSize: 12.5, fontWeight: 600, color: '#475569' }}>Cco</button>
                )}
              </div>],
              (abrirCc || temCc) && ['Cc', <CampoEmails key={`cc-${chaveEnvio.current}`} valorInicial={separarEmails(compor.cc)} onChange={l => setCompor(c => (c && c.cc !== l.join(', ') ? { ...c, cc: l.join(', ') } : c))} placeholder="opcional" sugestoes={contatos} />],
              (abrirCco || temCco) && ['Cco', <CampoEmails key={`cco-${chaveEnvio.current}`} valorInicial={separarEmails(compor.cco)} onChange={l => setCompor(c => (c && (c.cco || '') !== l.join(', ') ? { ...c, cco: l.join(', ') } : c))} placeholder="cópia oculta — ninguém vê" sugestoes={contatos} />],
              ['Assunto', <input key="as" value={compor.assunto} onChange={e => setCompor({ ...compor, assunto: e.target.value })} style={campo} />],
            ].filter(Boolean).map(([rot, el]) => (
              <label key={rot} style={{ display: 'grid', gridTemplateColumns: '70px minmax(0, 1fr)', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 700, color: '#475569' }}>{rot}{el}</label>
            ))}
            <textarea value={compor.texto} onChange={e => setCompor({ ...compor, texto: e.target.value })} rows={cheia ? 18 : 10}
              onPaste={aoColar}
              onDragOver={e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); }}
              onDrop={e => { if (e.dataTransfer?.files?.length) { e.preventDefault(); anexarArquivos(e.dataTransfer.files); } }}
              spellCheck lang="pt-BR"
              placeholder="Escreva sua mensagem… (sua assinatura entra automaticamente)"
              style={{ ...campo, width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
              <RevisarTexto texto={compor.texto} onAplicar={t => setCompor(c => ({ ...c, texto: t }))} />
              <button type="button" onClick={() => inputArquivo.current?.click()} style={{ ...btn(false), fontSize: 12 }}>
                <Paperclip size={13} /> Anexar arquivos
              </button>
              <input ref={inputArquivo} type="file" multiple hidden onChange={e => { anexarArquivos(e.target.files); e.target.value = ''; }} />
              <span style={{ fontSize: 11.5, color: '#94a3b8' }}>ou arraste para o texto · imagem copiada: cole (Ctrl+V) no texto</span>
            </div>
            {(compor.anexos?.length > 0 || subindo > 0) && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}><Paperclip size={12} /> Anexos{subindo > 0 ? ` — subindo ${subindo}…` : ''}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {(compor.anexos || []).map((a, i) => (
                    <span key={a.arquivo} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', border: '1px solid #e2e8f0', borderRadius: 999, background: '#f8fafc' }}>
                      {a.inline ? '🖼️ ' : ''}{a.nome} <span style={{ color: '#94a3b8' }}>({fmtTam(a.tamanho || 0)})</span>
                      <button type="button" title="Remover anexo" onClick={() => setCompor(c => ({ ...c, anexos: c.anexos.filter((_, j) => j !== i), texto: a.inline ? c.texto.split(`[imagem: ${a.nome}]`).join('') : c.texto }))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {compor.encaminhar_anexos?.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: '#475569' }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}><Paperclip size={12} /> {compor.encaminhar_anexos.length} anexo(s) vão junto:</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {compor.encaminhar_anexos.map((a, i) => (
                    <span key={`${a.id}-${a.anexo_idx}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', border: '1px solid #e2e8f0', borderRadius: 999, background: '#f8fafc' }}>
                      {a.nome}
                      <button type="button" title="Não encaminhar este anexo" onClick={() => setCompor(c => ({ ...c, encaminhar_anexos: c.encaminhar_anexos.filter((_, j) => j !== i) }))}
                        style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            )}
            {compor.cliente_caso && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12.5, color: '#047857', fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={String(compor.cc || '').toLowerCase().split(/[,;\s]+/).includes(compor.cliente_caso.email)} onChange={e => alternarClienteCc(e.target.checked)} />
                Copiar o cliente{compor.cliente_caso.nome ? ` (${compor.cliente_caso.nome})` : ''} — {compor.cliente_caso.email}
              </label>
            )}
            {compor.responder_a && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: '#475569', cursor: 'pointer' }}>
                <input type="checkbox" checked={!!compor.citar} onChange={e => setCompor({ ...compor, citar: e.target.checked })} />
                Incluir no final o e-mail que estou respondendo (citado). Desmarcado: vai só o que você escreveu.
              </label>
            )}
            </div>
            {/* Rodapé fixo: Enviar sempre à vista, mesmo com texto longo rolando acima. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', borderTop: '1px solid #f1f5f9', flexShrink: 0 }}>
              {/* Enviar + seta (23/11, como no Gmail): a seta abre "Agendar envio". */}
              <span style={{ position: 'relative', display: 'inline-flex' }}>
                <button onClick={enviar} disabled={enviando} style={{ ...btn(true), background: '#0D63DB', opacity: enviando ? 0.6 : 1, padding: '8px 16px 8px 18px', borderRadius: '999px 0 0 999px', border: 'none' }}>
                  {enviando ? <Loader2 size={14} /> : <Send size={14} />} Enviar
                </button>
                <button type="button" onClick={() => { setQuandoPersonalizado(''); setMenuAgendar(v => !v); }} disabled={enviando} title="Agendar envio" aria-label="Agendar envio" aria-expanded={menuAgendar}
                  style={{ ...btn(true), background: '#0D63DB', opacity: enviando ? 0.6 : 1, padding: '8px 10px', borderRadius: '0 999px 999px 0', border: 'none', borderLeft: '1px solid rgba(255,255,255,.35)' }}>
                  <ChevronDown size={14} />
                </button>
                {menuAgendar && <>
                  <div onClick={() => setMenuAgendar(false)} style={{ position: 'fixed', inset: 0, zIndex: 1 }} />
                  <div role="menu" style={{ position: 'absolute', bottom: 44, left: 0, zIndex: 2, background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 8px 24px rgba(15,23,42,.18)', padding: 6, width: 270 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '.04em', padding: '4px 8px 6px' }}><Clock size={11} /> Agendar envio</div>
                    {opcoesAgendar().map(([rot, d]) => (
                      <button key={rot} type="button" role="menuitem" onClick={() => agendar(d)}
                        onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; }} onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                        style={{ display: 'flex', justifyContent: 'space-between', gap: 8, width: '100%', padding: '7px 8px', border: 'none', background: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12.5, color: '#334155', textAlign: 'left' }}>
                        <span style={{ fontWeight: 600 }}>{rot}</span><span style={{ color: '#64748b' }}>{fmtAgendado(d)}</span>
                      </button>
                    ))}
                    <div style={{ borderTop: '1px solid #f1f5f9', margin: '6px 0 0', padding: '8px 8px 4px', display: 'grid', gap: 6 }}>
                      <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569' }}>Escolher data e hora</label>
                      <input type="datetime-local" value={quandoPersonalizado} onChange={(e) => setQuandoPersonalizado(e.target.value)} style={{ ...campo, padding: '6px 8px' }} />
                      <button type="button" disabled={!quandoPersonalizado} onClick={() => agendar(quandoPersonalizado)}
                        style={{ ...btn(true), background: '#0D63DB', justifyContent: 'center', opacity: quandoPersonalizado ? 1 : 0.5 }}>
                        <Clock size={13} /> Agendar
                      </button>
                    </div>
                  </div>
                </>}
              </span>
              <button onClick={fecharCompor} style={btn(false)}>{temConteudo(compor) ? 'Salvar e fechar' : 'Cancelar'}</button>
              {temConteudo(compor) && <span style={{ marginLeft: 'auto' }}><BotaoIcone titulo="Descartar rascunho" Icon={Trash2} cor="#b91c1c" onClick={descartarRascunho} /></span>}
            </div>
            </>}
        </div>
        </>);
      })()}
    </div>
  );
}

const campo = { padding: '8px 10px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13, boxSizing: 'border-box', width: '100%' };
