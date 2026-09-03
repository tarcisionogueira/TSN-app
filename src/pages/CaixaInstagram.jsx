import React, { useCallback, useEffect, useState } from 'react';
import { apiCall } from '../utils/apiCall';

/**
 * CAIXA DE RASCUNHOS DO INSTAGRAM — o dono lê, edita, copia e registra.
 *
 * ⚠️ ELA NÃO ENVIA, E ISSO ESTÁ ESCRITO NA TELA. Enquanto a Meta não liberar a permissão de
 * envio, quem responde é ele, no app. O botão chama "Copiar e marcar", não "Enviar".
 *
 * ─── O TEXTO QUE VAI PARA A MEDIÇÃO É O DESTA CAIXA, NÃO O SUGERIDO ──────────────────
 * A régua de promoção ("a classe vira autônoma quando 8 de 10 rascunhos saem sem edição")
 * compara `texto_sugerido` com `texto_enviado`. Por isso o fluxo é: EDITE AQUI até ficar como
 * você vai mandar, e só então copie. Se a edição acontecesse depois, no app do Instagram, a
 * tela gravaria como "enviado sem edição" um texto que foi reescrito — e a régua liberaria
 * respostas automáticas com base numa medição que só mediu a si mesma.
 *
 * ─── COPIAR E MARCAR SÃO UM CLIQUE SÓ, DE PROPÓSITO ──────────────────────────────────
 * `whatsapp_disparo_log` ficou zerado porque marcar era um clique DEPOIS do trabalho feito, e
 * ninguém volta para marcar. Mas se a cópia falhar, a marcação NÃO acontece: registrar "enviei
 * este texto" quando o texto nem chegou à área de transferência seria inventar o dado que a
 * régua vai ler.
 */
const PRAZO = { private_reply: '7 dias (tiro único)', dm_24h: '24 horas' };

function Prazo({ horas, expirado }) {
  if (horas == null) return <span style={{ color: '#94a3b8', fontSize: 12 }}>sem prazo conhecido</span>;
  if (expirado) return <span style={{ color: '#991b1b', fontSize: 12, fontWeight: 800 }}>JANELA VENCIDA</span>;
  const cor = horas < 6 ? '#b91c1c' : horas < 24 ? '#b45309' : '#166534';
  const txt = horas < 1 ? `${Math.max(1, Math.round(horas * 60))} min` : `${horas} h`;
  return <span style={{ color: cor, fontSize: 12, fontWeight: 800 }}>restam {txt}</span>;
}

export default function CaixaInstagram() {
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [textos, setTextos] = useState({});     // edições em curso, por id
  const [resolvidos, setResolvidos] = useState(() => new Set());
  const [ocupado, setOcupado] = useState(null);
  const [copiaFalhou, setCopiaFalhou] = useState(() => new Set());

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const r = await apiCall('/api/admin-ig-caixa');
      const j = await r.json().catch(() => ({}));
      // `.ok` conferido: o endpoint devolve 502 quando uma LEITURA falha, e um `.json()` direto
      // viraria "caixa vazia" — "não há o que responder" é descanso, "não consegui ler" é
      // janela queimando. Na tela as duas se parecem; nas consequências, não.
      if (!r.ok || j?.error) throw new Error(j?.error || 'Falhou ao carregar a caixa');
      setDados(j);
      setTextos(Object.fromEntries(j.itens.map((i) => [i.id, i.texto_sugerido || ''])));
      setResolvidos(new Set());
      setErro('');
    } catch (e) { setErro(String(e.message || e)); }
    finally { setCarregando(false); }
  }, []);

  useEffect(() => { carregar(); }, [carregar]);

  async function registrar(item, acao, extra = {}) {
    setOcupado(item.id);
    try {
      const r = await apiCall('/api/admin-ig-caixa', {
        method: 'POST', body: JSON.stringify({ acao, id: item.id, ...extra }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) throw new Error(j?.error || `HTTP ${r.status}`);
      setResolvidos((s) => new Set(s).add(item.id));
      // O desfecho valeu (a régua já leu), mas se a mensagem não saiu da fila o item volta
      // amanhã. Dizer isso agora evita que a tela pareça repetir rascunho sem motivo.
      if (j.fila_limpa === false) {
        setErro('Registrei, mas não consegui tirar a mensagem da fila — este item pode reaparecer amanhã.');
      }
      return true;
    } catch (e) {
      console.error('[ig-caixa] falha ao registrar', acao, item.id, e);
      setErro(`Não registrei (${String(e.message || e)}). O rascunho continua na caixa.`);
      return false;
    } finally { setOcupado(null); }
  }

  async function copiarEMarcar(item) {
    const texto = (textos[item.id] || '').trim();
    if (!texto) { setErro('A caixa está vazia — não há o que copiar nem o que medir.'); return; }
    try {
      await navigator.clipboard.writeText(texto);
    } catch (e) {
      // Cópia falhou = o texto não chegou às suas mãos. Marcar aqui gravaria "enviei isto"
      // sobre algo que nem foi copiado, e é justamente esse campo que a régua lê depois.
      console.error('[ig-caixa] clipboard recusou', e);
      setCopiaFalhou((s) => new Set(s).add(item.id));
      setErro('O navegador não deixou copiar. Selecione o texto à mão e use "Já copiei — marcar".');
      return;
    }
    await registrar(item, 'enviado', { texto });
  }

  async function mudarEstado(item, estado) {
    setOcupado(item.id);
    try {
      const r = await apiCall('/api/admin-ig-caixa', {
        method: 'POST', body: JSON.stringify({ acao: 'estado', ig_user_id: item.ig_user_id, estado }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.error) throw new Error(j?.error || `HTTP ${r.status}`);
      setDados((d) => ({ ...d, itens: d.itens.map((i) => (i.ig_user_id === item.ig_user_id ? { ...i, estado } : i)) }));
    } catch (e) {
      console.error('[ig-caixa] falha ao mudar estado', item.ig_user_id, e);
      setErro(`Não mudei o estado da conversa (${String(e.message || e)}).`);
    } finally { setOcupado(null); }
  }

  if (carregando) return <div style={{ padding: 28, fontFamily: 'system-ui' }}>Carregando a caixa…</div>;
  if (erro && !dados) return <div style={{ padding: 28, color: '#991b1b', fontFamily: 'system-ui' }}>{erro}</div>;

  const pendentes = (dados?.itens || []).filter((i) => !resolvidos.has(i.id));
  const responder = pendentes.filter((i) => i.acao === 'rascunho' || i.acao === 'enviar');
  const semAcao = pendentes.filter((i) => i.acao === 'perdido' || i.acao === 'ignorar');
  const B = { border: '1px solid #cbd5e1', borderRadius: 9, padding: '9px 12px', fontSize: 13.5, fontWeight: 700, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' };

  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: '24px 18px 60px', fontFamily: 'system-ui, sans-serif', color: '#0f172a' }}>
      <h1 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 4px' }}>Caixa do Instagram</h1>
      <p style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 9, padding: '10px 12px', lineHeight: 1.6, margin: '10px 0 0' }}>
        Esta tela <strong>não envia</strong>. Ela sugere, você <strong>edita aqui</strong> até ficar como vai
        mandar, copia e responde no app. Edite <em>antes</em> de copiar: é o texto desta caixa que vira a
        medição de quando uma classe pode passar a responder sozinha.
      </p>

      {erro && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '10px 12px', fontSize: 13, margin: '14px 0' }}>{erro}</div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', margin: '16px 0 6px' }}>
        <div style={{ fontSize: 15, fontWeight: 800 }}>{responder.length} para responder</div>
        {semAcao.length > 0 && <span style={{ fontSize: 12.5, color: '#64748b' }}>· {semAcao.length} sem ação (spam ou janela perdida)</span>}
        <button onClick={carregar} style={{ ...B, marginLeft: 'auto' }}>Recarregar</button>
      </div>
      {dados?.truncado && (
        <div style={{ fontSize: 12.5, color: '#b45309' }}>A caixa veio no teto — há mais rascunhos além destes.</div>
      )}

      {/* A RÉGUA. Fica no topo porque é ela que responde "já dá para soltar alguma classe?" —
          e ela mesma se recusa a responder abaixo do mínimo de amostra, em vez de dar um
          percentual plausível. `null` aqui é falha de leitura, não ausência de histórico. */}
      {dados?.regua === null && (
        <div style={{ fontSize: 12.5, color: '#b45309', marginTop: 8 }}>(não consegui ler a régua de promoção)</div>
      )}
      {Array.isArray(dados?.regua) && dados.regua.length > 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', margin: '12px 0 6px', fontSize: 12.5, color: '#475569' }}>
          <strong style={{ color: '#0f172a' }}>Enviados sem editar</strong>
          {dados.regua.map((l) => (
            <div key={l.classe} style={{ marginTop: 4 }}>
              {l.classe}: {l.sem_edicao}/{l.enviados} — <span style={{ fontWeight: 700 }}>{l.veredito}</span>
            </div>
          ))}
        </div>
      )}

      {responder.length === 0 && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, margin: '16px 0', textAlign: 'center', fontSize: 14.5, color: '#475569' }}>
          Nada para responder agora.
          <div style={{ fontSize: 12.5, color: '#94a3b8', marginTop: 6 }}>
            Se a escuta ainda está dormente (sem o app da Meta configurado), esta caixa fica vazia por isso — e não porque ninguém escreveu.
          </div>
        </div>
      )}

      {responder.map((it) => (
        <div key={it.id} style={{ border: '1px solid #e2e8f0', borderRadius: 14, padding: 16, marginBottom: 16, background: '#fff' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 11.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, color: '#1d4ed8' }}>
              {it.origem}{it.classe ? ` · ${it.classe}` : ''}
            </span>
            <Prazo horas={it.horas_restantes} expirado={it.expirado} />
            <span style={{ fontSize: 11.5, color: '#94a3b8' }}>{PRAZO[it.janela] || it.janela || ''}</span>
            {it.estado && it.estado !== 'bot' && (
              <span style={{ fontSize: 11.5, fontWeight: 800, color: '#b45309' }}>conversa {it.estado}</span>
            )}
          </div>

          <div style={{ fontSize: 13, color: '#475569', marginBottom: 4 }}>
            {it.username ? `@${it.username}` : `id ${it.ig_user_id}`}
          </div>

          {/* A PERGUNTA. Ausência de LINHA e texto vazio são coisas diferentes: mensagem só com
              foto ou áudio existe e não tem texto. Dizer "não escreveu nada" nos dois casos
              esconderia uma falha de leitura atrás de um fato comum. */}
          <div style={{ fontSize: 13.5, lineHeight: 1.55, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 11px', marginBottom: 10, color: '#334155', whiteSpace: 'pre-wrap' }}>
            {it.pergunta_ausente
              ? <em style={{ color: '#b45309' }}>não encontrei a mensagem de origem (mid {it.mid_origem})</em>
              : (it.pergunta || <em style={{ color: '#94a3b8' }}>sem texto — mensagem de mídia</em>)}
          </div>

          {it.texto_sugerido ? (
            <textarea
              value={textos[it.id] ?? ''}
              onChange={(e) => setTextos((t) => ({ ...t, [it.id]: e.target.value }))}
              rows={Math.min(12, Math.max(4, String(textos[it.id] || '').split('\n').length + 2))}
              style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13.5, lineHeight: 1.6, padding: 11, borderRadius: 10, border: '1px solid #cbd5e1', color: '#0f172a', resize: 'vertical' }}
            />
          ) : (
            <div style={{ fontSize: 13, color: '#991b1b', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '9px 11px' }}>
              O motor não redigiu nada aqui. Motivo: <strong>{it.motivo || 'não registrado'}</strong>
            </div>
          )}

          {/* O MOTIVO É PARTE DA TELA, não detalhe técnico: quando ele perguntar "por que isto
              não saiu sozinho?", a resposta tem de estar aqui, e não numa reconstrução. */}
          {it.texto_sugerido && it.motivo && (
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>
              Não sai sozinho porque: <strong>{it.motivo}</strong>
              {it.classe_conf != null && ` · confiança ${it.classe_conf}`}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {it.texto_sugerido && (
              <button onClick={() => copiarEMarcar(it)} disabled={ocupado === it.id}
                style={{ ...B, flex: 1, minWidth: 200, background: ocupado === it.id ? '#cbd5e1' : '#16a34a', color: '#fff', border: 'none', padding: 13, fontSize: 15, fontWeight: 800 }}>
                {ocupado === it.id ? 'Registrando…' : 'Copiar e marcar enviado'}
              </button>
            )}
            {copiaFalhou.has(it.id) && (
              <button onClick={() => registrar(it, 'enviado', { texto: (textos[it.id] || '').trim() })} disabled={ocupado === it.id} style={B}>
                Já copiei — marcar
              </button>
            )}
            {it.username && (
              <a href={`https://ig.me/m/${encodeURIComponent(it.username)}`} target="_blank" rel="noopener noreferrer" style={{ ...B, textDecoration: 'none', color: '#0f172a', display: 'inline-block' }}>
                Abrir direct
              </a>
            )}
            <button onClick={() => registrar(it, 'descartar', { motivo: '' })} disabled={ocupado === it.id} style={{ ...B, color: '#991b1b' }}>
              Descartar
            </button>
            <button onClick={() => mudarEstado(it, it.estado === 'humano' ? 'bot' : 'humano')} disabled={ocupado === it.id} style={B}>
              {it.estado === 'humano' ? 'Devolver ao bot' : 'Assumir'}
            </button>
          </div>
        </div>
      ))}

      {semAcao.length > 0 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#475569', margin: '22px 0 8px' }}>
            Sem ação ({semAcao.length}) — spam ou janela já vencida
          </div>
          {semAcao.map((it) => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 2px', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: it.acao === 'perdido' ? '#991b1b' : '#94a3b8', minWidth: 74 }}>
                {it.acao === 'perdido' ? 'PERDIDA' : 'spam'}
              </span>
              <span style={{ fontSize: 13, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#475569' }}>
                {it.pergunta || `(${it.origem})`}
              </span>
              <button onClick={() => registrar(it, 'descartar', { motivo: it.acao })} disabled={ocupado === it.id} style={{ ...B, padding: '5px 9px', fontSize: 12 }}>
                Dar baixa
              </button>
            </div>
          ))}
        </>
      )}

      {/* Contagens, não percentuais — o percentual é a régua lá em cima, que tem mínimo de
          amostra. Duas fontes para a mesma conta, e a que engana é a que alguém acaba citando. */}
      {Array.isArray(dados?.resumo) && dados.resumo.length > 0 && (
        <div style={{ marginTop: 26, fontSize: 12.5, color: '#64748b' }}>
          <strong style={{ color: '#0f172a' }}>Histórico por classe</strong>
          {dados.resumo.map((l) => (
            <div key={l.classe} style={{ marginTop: 3 }}>
              {l.classe}: {l.pendentes} pendentes · {l.enviados} enviados · {l.descartados} descartados
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
