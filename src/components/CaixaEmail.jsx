import React, { useState, useEffect, useCallback } from 'react';
import { Inbox, ShieldAlert, Send, Trash2, RefreshCw, PenSquare, Reply, Forward, Ban, Paperclip, X, Loader2, Undo2, MessageCircle, AlertCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { apiCall } from '../utils/apiCall';
import EmailHtml from './EmailHtml';

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
  const [ativa, setAtiva] = useState(null);      // mensagem aberta (linha completa)
  const [busca, setBusca] = useState('');
  const [compor, setCompor] = useState(null);    // { de, para, cc, assunto, texto, responder_a }
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

  useEffect(() => { setAtiva(null); carregar(); }, [carregar]);
  // Atualiza sozinha a cada minuto com a aba visível — sem depender de alguém lembrar do botão.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') carregar(); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function abrir(m) {
    const { data, error } = await supabase.from('email_caixa').select('*').eq('id', m.id).maybeSingle();
    if (error || !data) { setErro(error ? `Não consegui abrir a mensagem: ${error.message}` : 'Mensagem não encontrada.'); return; }
    setAtiva(data);
    if (!data.lido) {
      const { data: up, error: eUp } = await supabase.from('email_caixa').update({ lido: true }).eq('id', m.id).select('id');
      if (!eUp && up?.length) {
        setLista(prev => prev.map(x => x.id === m.id ? { ...x, lido: true } : x));
        setNaoLidos(prev => ({ ...prev, [data.pasta]: Math.max(0, (prev[data.pasta] || 1) - 1) }));
      }
    }
  }

  async function mover(m, destino, msgOk) {
    const { data, error } = await supabase.from('email_caixa').update({ pasta: destino }).eq('id', m.id).select('id');
    if (error || !data?.length) { setErro(error ? `Não consegui mover: ${error.message}` : 'Sem permissão para mover esta mensagem.'); return false; }
    setLista(prev => prev.filter(x => x.id !== m.id));
    setAtiva(null);
    setAviso(msgOk);
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
    setAtiva(null);
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

  function responder(m) {
    const caixaNossa = String(m.caixa || '').split('@')[0];
    setCompor({
      // Veio pra minha caixa pessoal → respondo como eu; veio pra comunicação → pelo mesmo endereço.
      de: (m.dono && meuEndereco) ? 'pessoal' : (CAIXAS.includes(caixaNossa) ? caixaNossa : dePadrao),
      para: m.de_email || '', cc: '',
      assunto: /^re:/i.test(m.assunto || '') ? m.assunto : `Re: ${m.assunto || ''}`,
      texto: '', responder_a: m.id, chamado_id: m.chamado_id,
    });
  }
  function encaminhar(m) {
    const corpo = `\n\n---------- Mensagem encaminhada ----------\nDe: ${m.de_nome ? `${m.de_nome} <${m.de_email}>` : m.de_email}\nData: ${new Date(m.criado_em).toLocaleString('pt-BR')}\nAssunto: ${m.assunto || ''}\n\n${m.texto || ''}`;
    setCompor({ de: dePadrao, para: '', cc: '', assunto: `Fwd: ${m.assunto || ''}`, texto: corpo.slice(0, 18000), responder_a: null });
  }

  async function enviar() {
    if (enviando || !compor) return;
    setEnviando(true); setErro('');
    try {
      const res = await apiCall('/api/email-caixa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ acao: 'enviar', de: compor.de, para: compor.para, cc: compor.cc, assunto: compor.assunto, texto: compor.texto, responder_a: compor.responder_a || undefined }),
      });
      const j = await lerJsonSeguro(res);
      if (!res.ok || !j.ok) { setErro(j.error || `Envio falhou (HTTP ${res.status}).`); return; }
      setCompor(null);
      setAviso(j.avisos?.length ? `Enviado — atenção: ${j.avisos.join('; ')}.` : 'E-mail enviado.');
      if (pasta === 'enviados') carregar();
    } catch (e) {
      setErro(`Envio falhou: ${e.message}`);
    } finally { setEnviando(false); }
  }

  const b = busca.trim().toLowerCase();
  const porOrigem = origem === 'todas' ? lista : lista.filter(m => (origem === 'minha' ? !!m.dono : !m.dono));
  const visiveis = b ? porOrigem.filter(m => [m.de_email, m.de_nome, m.assunto, (m.para || []).join(' ')].some(v => String(v || '').toLowerCase().includes(b))) : porOrigem;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 16, alignItems: 'start' }}>
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
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 12, minWidth: 220 }} />
        <button onClick={carregar} style={btn(false)} title="Atualizar"><RefreshCw size={14} /></button>
        <button onClick={() => setCompor({ de: dePadrao, para: '', cc: '', assunto: '', texto: '', responder_a: null })} style={{ ...btn(true), background: '#0D63DB' }}>
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
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
        {pasta === 'spam' && (
          <div style={{ padding: '10px 14px', background: '#fff7ed', borderBottom: '1px solid #fed7aa', fontSize: 11.5, color: '#9a3412' }}>
            Aqui cai o que veio de remetente <b>bloqueado</b> ou que <b>falhou na autenticação</b> (SPF/DKIM/DMARC — remetente possivelmente forjado). Nada daqui abre chamado. Não clique em links de mensagens suspeitas.
          </div>
        )}
        {carregando ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8' }}><Loader2 size={18} className="spin" /> Carregando…</div>
        ) : visiveis.length === 0 ? (
          <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>{erro ? 'Não foi possível carregar.' : 'Nenhuma mensagem aqui.'}</div>
        ) : visiveis.map(m => {
          const sel = ativa?.id === m.id;
          const quem = m.direcao === 'saida' ? `Para: ${(m.para || []).join(', ')}` : (m.de_nome || m.de_email || '(sem remetente)');
          return (
            <div key={m.id} onClick={() => abrir(m)}
              style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: sel ? '#eff6ff' : 'white', borderLeft: `3px solid ${!m.lido ? '#0D63DB' : 'transparent'}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: m.lido ? 600 : 800, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{quem}</span>
                <span style={{ fontSize: 11, color: '#94a3b8', flexShrink: 0 }}>{fmtData(m.criado_em)}</span>
              </div>
              <div style={{ fontSize: 12.5, color: '#334155', fontWeight: m.lido ? 500 : 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.assunto || '(sem assunto)'}</div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'center' }}>
                {m.chamado_id && <MessageCircle size={11} title="Virou chamado" />}
                {(m.anexos || []).length > 0 && <Paperclip size={11} />}
                {m.spam_motivo ? <span style={{ color: '#dc2626' }}>{m.spam_motivo}</span> : m.direcao === 'saida' ? <StatusEnvio m={m} /> : String(m.texto || '').slice(0, 90)}
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
      <div style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', minHeight: 420 }}>
        {!ativa ? (
          <div style={{ padding: 60, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
            <Inbox size={28} style={{ marginBottom: 8 }} /><br />Selecione uma mensagem.
          </div>
        ) : (
          <div style={{ padding: 18 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: '#111', marginBottom: 6 }}>{ativa.assunto || '(sem assunto)'}</div>
            <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.7 }}>
              <div><b>De:</b> {ativa.de_nome ? `${ativa.de_nome} <${ativa.de_email}>` : ativa.de_email}</div>
              <div><b>Para:</b> {(ativa.para || []).join(', ') || ativa.caixa}</div>
              {(ativa.cc || []).length > 0 && <div><b>Cc:</b> {ativa.cc.join(', ')}</div>}
              <div><b>Data:</b> {new Date(ativa.criado_em).toLocaleString('pt-BR')}</div>
              {ativa.direcao === 'saida' && <div><b>Status:</b> <StatusEnvio m={ativa} completo /></div>}
              {ativa.resposta_de && <div style={{ color: '#7c3aed', fontWeight: 700 }}><Reply size={12} /> Resposta a um e-mail enviado pela equipe (veja em Enviados).</div>}
              {ativa.chamado_id && <div style={{ color: '#0D63DB' }}><MessageCircle size={12} /> Esta mensagem está num chamado da fila — responder daqui também registra no chamado.</div>}
              {ativa.spam_motivo && <div style={{ color: '#dc2626', fontWeight: 700 }}><ShieldAlert size={12} /> Spam: {ativa.spam_motivo}</div>}
            </div>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }}>
              {ativa.direcao === 'entrada' && ativa.pasta !== 'spam' && <button onClick={() => responder(ativa)} style={btn(false)}><Reply size={13} /> Responder</button>}
              <button onClick={() => encaminhar(ativa)} style={btn(false)}><Forward size={13} /> Encaminhar</button>
              {ativa.direcao === 'entrada' && ativa.pasta === 'entrada' && <button onClick={() => mover(ativa, 'spam', 'Movido para Spam.')} style={btn(false)}><ShieldAlert size={13} /> Spam</button>}
              {ativa.pasta === 'spam' && <button onClick={() => mover(ativa, 'entrada', 'Devolvido à Entrada. (Não abre chamado automaticamente — responda daqui se precisar.)')} style={btn(false)}><Undo2 size={13} /> Não é spam</button>}
              {ativa.direcao === 'entrada' && ativa.de_email && <button onClick={() => bloquear(ativa, false)} style={{ ...btn(false), color: '#b91c1c' }}><Ban size={13} /> Bloquear remetente</button>}
              {ativa.direcao === 'entrada' && ativa.de_email && <button onClick={() => bloquear(ativa, true)} style={{ ...btn(false), color: '#b91c1c' }}><Ban size={13} /> Bloquear domínio</button>}
              {ativa.pasta !== 'lixeira'
                ? <button onClick={() => mover(ativa, 'lixeira', 'Movido para a Lixeira.')} style={btn(false)}><Trash2 size={13} /> Lixeira</button>
                : <button onClick={() => mover(ativa, ativa.direcao === 'saida' ? 'enviados' : 'entrada', 'Restaurado.')} style={btn(false)}><Undo2 size={13} /> Restaurar</button>}
            </div>

            {(ativa.anexos || []).length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                {ativa.anexos.map((a, i) => (a.id || (ativa.direcao === 'saida' && ativa.resend_email_id))
                  ? <button key={i} onClick={() => baixarAnexo(ativa, a, i)} style={{ ...btn(false), fontWeight: 600 }}><Paperclip size={12} /> {a.nome}</button>
                  : <span key={i} style={{ fontSize: 12, color: '#94a3b8' }}><Paperclip size={12} /> {a.nome}{ativa.direcao === 'saida' ? '' : ' (indisponível)'}</span>)}
              </div>
            )}

            {ativa.pasta === 'spam' || !ativa.html
              // Spam nunca renderiza HTML (nem no iframe isolado): imagem remota confirma ao
              // remetente que o endereço é lido — o que spammer mais quer saber.
              ? <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, color: '#1e293b', lineHeight: 1.6, overflowWrap: 'break-word' }}>{ativa.texto || '(mensagem sem texto)'}</div>
              : <EmailHtml html={ativa.html} altura={520} />}
          </div>
        )}
      </div>

      {/* COMPOR */}
      {compor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: 'white', borderRadius: 14, width: 'min(680px, 100%)', maxHeight: '92vh', overflow: 'auto', padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 800, fontSize: 16 }}>{compor.responder_a ? 'Responder' : 'Nova mensagem'}</span>
              <button onClick={() => setCompor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={18} /></button>
            </div>
            {compor.chamado_id && <div style={{ fontSize: 12, color: '#0D63DB', marginBottom: 8 }}>Esta resposta também entra no histórico do chamado.</div>}
            {[
              ['De', <select key="de" value={compor.de} onChange={e => setCompor({ ...compor, de: e.target.value })} style={campo}>
                {meuEndereco && <option value="pessoal">{meuEndereco} (você — respostas voltam para a sua caixa)</option>}
                {!soPessoal && CAIXAS.map(c => <option key={c} value={c}>{c}@bidprobrasil.com.br (comunicação — respostas vão para a fila de atendimento)</option>)}
              </select>],
              ['Para', <input key="para" value={compor.para} onChange={e => setCompor({ ...compor, para: e.target.value })} placeholder="email@exemplo.com (vários: separe por vírgula)" style={campo} />],
              ['Cc', <input key="cc" value={compor.cc} onChange={e => setCompor({ ...compor, cc: e.target.value })} placeholder="opcional" style={campo} />],
              ['Assunto', <input key="as" value={compor.assunto} onChange={e => setCompor({ ...compor, assunto: e.target.value })} style={campo} />],
            ].map(([rot, el]) => (
              <label key={rot} style={{ display: 'grid', gridTemplateColumns: '70px 1fr', alignItems: 'center', gap: 8, marginBottom: 8, fontSize: 12, fontWeight: 700, color: '#475569' }}>{rot}{el}</label>
            ))}
            <textarea value={compor.texto} onChange={e => setCompor({ ...compor, texto: e.target.value })} rows={12}
              placeholder="Escreva sua mensagem… (sua assinatura e o e-mail original, numa resposta, entram automaticamente)"
              style={{ ...campo, width: '100%', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button onClick={() => setCompor(null)} style={btn(false)}>Cancelar</button>
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
