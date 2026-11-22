/**
 * /api/instagram-gatilhos — o "ManyChat" da BidPro: comentou a PALAVRA, recebe o material no direct.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Quem chama: o webhook do Instagram logo depois de gravar um comentário (waitUntil) e o cron de
 * reserva a cada 5 min (pega o que o webhook não conseguiu acordar). Os dois com `x-cron-secret`.
 *
 * Para cada comentário recente que casa com um gatilho ativo (`ig_gatilhos`):
 *  1. CLAIM em `ig_gatilho_disparos` (comment_mid UNIQUE) — webhook e cron nunca mandam dois;
 *  2. private reply (o direct sancionado pela Meta para quem comentou: 1 por comentário, 7 dias);
 *  3. resposta pública curta sorteada sob o comentário ("Te mandei no direct! 📩");
 *  4. a DM enviada entra em `ig_mensagens` (autor 'bot') → o gatilho do banco abre o chamado
 *     canal 'instagram' na tela de Atendimento; quando a pessoa responder o direct, cai lá.
 * A mesma pessoa no mesmo gatilho em 7 dias = 'repetido': só a resposta pública, sem 2º direct.
 * DM recusada pela Meta → o comentário continua na caixa /admin/instagram (não marca respondida).
 *
 * GET (equipe, via admin-ig-gatilhos) não existe aqui: este endpoint só DISPARA.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { envioConfigurado, enviarPrivateReply, responderComentarioPublicamente } from './_instagram-envio.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const JANELA_DIAS = 7;                 // private reply só vale até 7 dias depois do comentário
const REPETIDO_DIAS = 7;
const ORCAMENTO_MS = 45000;

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

/** Minúsculas, sem acento, sem pontuação: "PATRIMÔNIO!!" e "patrimonio" são a mesma palavra. */
export function normalizar(t) {
  return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9#@\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Primeiro gatilho que casa: a palavra (ou expressão) inteira no comentário, e o post certo quando o
 * gatilho é preso a um. Gatilho de post específico ganha do genérico (mais intencional).
 */
export function casarGatilho(texto, mediaId, gatilhos, agora = new Date()) {
  const t = ` ${normalizar(texto).replace(/#/g, '')} `;
  if (!t.trim()) return null;
  const vivos = (gatilhos || []).filter((g) => g.ativo !== false && (!g.valido_ate || new Date(g.valido_ate) > agora));
  const ordem = [...vivos.filter((g) => g.media_id), ...vivos.filter((g) => !g.media_id)];
  for (const g of ordem) {
    if (g.media_id && String(g.media_id) !== String(mediaId || '')) continue;
    const p = normalizar(g.palavra).replace(/#/g, '');
    if (p && t.includes(` ${p} `)) return g;
  }
  return null;
}

/** Texto do direct: {nome} vira o @ (ou some), {link} vira o link do gatilho. */
export function montarMensagem(gatilho, username) {
  let m = String(gatilho.mensagem_dm || '');
  m = m.replace(/\{nome\}/gi, username ? `@${username}` : '').replace(/\{link\}/gi, gatilho.link || '');
  if (gatilho.link && !m.includes(gatilho.link)) m = `${m.trim()}\n\n${gatilho.link}`;
  // Sem @: "Oi {nome}!" vira "Oi!" (e não "Oi !").
  return m.replace(/[ \t]+\n/g, '\n').replace(/ {2,}/g, ' ').replace(/ +([!?,.])/g, '$1').replace(/^\s*[,!]\s*/, '').trim();
}

export function sortearPublica(gatilho, rnd = Math.random) {
  const ops = (gatilho.respostas_publicas || []).map((s) => String(s || '').trim()).filter(Boolean);
  return ops.length ? ops[Math.floor(rnd() * ops.length)] : null;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'não autorizado' });
  if (!SB || !SVC) return res.status(500).json({ error: 'Supabase não configurado' });
  const inicio = Date.now();
  const resumo = { gatilhos: 0, candidatos: 0, enviados: 0, repetidos: 0, falhas: 0 };
  try {
    const agoraIso = new Date().toISOString();
    const gatilhos = (await sb('GET', `ig_gatilhos?ativo=is.true&or=(valido_ate.is.null,valido_ate.gt.${agoraIso})&select=*`)) || [];
    resumo.gatilhos = gatilhos.length;
    if (!gatilhos.length) return res.status(200).json({ ok: true, ...resumo, motivo: 'sem_gatilho_ativo' });
    if (!envioConfigurado()) return res.status(503).json({ ok: false, ...resumo, motivo: 'IG_USER_ID/IG_PAGE_TOKEN ausentes' });

    const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString();
    const recentes = (await sb('GET', `ig_mensagens?origem=eq.comentario&autor=eq.pessoa&respondida=is.false&texto=not.is.null&criado_em=gt.${desde}&select=mid,ig_user_id,texto,media_id&order=criado_em.asc&limit=150`)) || [];
    const casados = recentes.map((m) => ({ m, g: casarGatilho(m.texto, m.media_id, gatilhos) })).filter((x) => x.g);
    if (!casados.length) return res.status(200).json({ ok: true, ...resumo });

    const mids = casados.map((x) => `"${x.m.mid.replace(/"/g, '')}"`).join(',');
    const ja = new Set(((await sb('GET', `ig_gatilho_disparos?comment_mid=in.(${encodeURIComponent(mids)})&select=comment_mid`)) || []).map((d) => d.comment_mid));
    const fila = casados.filter((x) => !ja.has(x.m.mid));
    resumo.candidatos = fila.length;

    const ids = [...new Set(fila.map((x) => x.m.ig_user_id))];
    const nomes = new Map();
    if (ids.length) {
      const convs = (await sb('GET', `ig_conversas?ig_user_id=in.(${ids.map(encodeURIComponent).join(',')})&select=ig_user_id,username`)) || [];
      for (const c of convs) nomes.set(c.ig_user_id, c.username);
    }

    for (const { m, g } of fila) {
      if (Date.now() - inicio > ORCAMENTO_MS) break;
      // CLAIM: se outra rodada já pegou este comentário, o banco devolve vazio e seguimos.
      const [claim] = (await sb('POST', 'ig_gatilho_disparos?on_conflict=comment_mid',
        { gatilho_id: g.id, comment_mid: m.mid, ig_user_id: m.ig_user_id },
        'resolution=ignore-duplicates,return=representation')) || [];
      if (!claim) continue;

      const desdeRep = new Date(Date.now() - REPETIDO_DIAS * 86400000).toISOString();
      const [anterior] = (await sb('GET', `ig_gatilho_disparos?gatilho_id=eq.${g.id}&ig_user_id=eq.${encodeURIComponent(m.ig_user_id)}&status=eq.enviado&criado_em=gt.${desdeRep}&select=id&limit=1`)) || [];

      let dm = { ok: false, erro: 'repetido' };
      if (!anterior) {
        const texto = montarMensagem(g, nomes.get(m.ig_user_id));
        dm = await enviarPrivateReply(m.mid, texto);
        if (dm.ok) {
          await sb('POST', 'ig_mensagens?on_conflict=mid', {
            mid: dm.message_id, ig_user_id: m.ig_user_id, direcao: 'enviada', origem: 'dm', autor: 'bot',
            texto, ocorrido_em: new Date().toISOString(), respondida: true,
          }, 'resolution=ignore-duplicates,return=minimal');
        }
      }
      const frase = sortearPublica(g);
      const pub = frase && (dm.ok || anterior) ? await responderComentarioPublicamente(m.mid, frase) : { ok: false, erro: 'sem_publica' };

      const status = anterior ? 'repetido' : dm.ok ? 'enviado' : 'falhou';
      const erro = [!dm.ok && !anterior ? `dm: ${dm.erro} ${dm.detalhe || ''}` : '', !pub.ok && pub.erro !== 'sem_publica' ? `publica: ${pub.erro} ${pub.detalhe || ''}` : '']
        .filter(Boolean).join(' | ').slice(0, 400) || null;
      await sb('PATCH', `ig_gatilho_disparos?id=eq.${claim.id}`, { status, dm_ok: anterior ? null : dm.ok, publica_ok: pub.ok, erro }, 'return=minimal');
      if (status !== 'falhou') {
        await sb('PATCH', `ig_mensagens?mid=eq.${encodeURIComponent(m.mid)}`, { respondida: true }, 'return=minimal');
      } else {
        console.warn('[ig-gatilho] direct recusado:', m.mid, erro);
      }
      resumo[status === 'enviado' ? 'enviados' : status === 'repetido' ? 'repetidos' : 'falhas']++;
    }
    return res.status(200).json({ ok: true, ...resumo, ms: Date.now() - inicio });
  } catch (e) {
    console.error('[ig-gatilho]', e?.message || e);
    return res.status(500).json({ ok: false, error: String(e?.message || e).slice(0, 300), ...resumo });
  }
}
