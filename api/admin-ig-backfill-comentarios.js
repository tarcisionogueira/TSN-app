/**
 * POST /api/admin-ig-backfill-comentarios — importa, uma vez, os comentários dos últimos N
 * dias (padrão 90) direto da Graph API, pra alimentar o corpus de aprendizado (`ig_mensagens`)
 * com respostas REAIS que o dono já deu antes de existir webhook nenhum aqui.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Pedido do dono (09/09): "veja se tem como deixar um agente aprender" com o que ele mesmo
 * responde. `montarExemplos()`/`EXEMPLOS_DO_DONO` (`_ig-motor.js`) só têm o que ver a partir
 * de quando o webhook foi ligado — este endpoint estende isso pra trás, usando o MESMO token
 * (`IG_PAGE_TOKEN`) e a MESMA permissão (`instagram_business_manage_comments`) já concedidos
 * pra Send API. A Windsor.ai tentou cobrir isso primeiro e esbarrou num "Application does not
 * have permission" que a reconexão da conta não resolveu — provavelmente limitação do app
 * DELES, não nosso; não investigado mais a fundo por estar fora do nosso controle.
 *
 * ─── ONDE CADA COMENTÁRIO VAI PARAR EM `ig_mensagens` ──────────────────────────────────
 * Pra cada resposta do dono encontrada (comentário-filho com `from.id = IG_USER_ID`), grava
 * DUAS linhas — o comentário PAI (autor='pessoa', a pergunta original) e a resposta dele
 * (autor='dono') — na MESMA forma que o webhook grava, pra `montarExemplos()` não precisar
 * saber a diferença. `mid` leva o prefixo `bf_` (além do `c_` de sempre) especificamente pra
 * ficar rastreável que veio de backfill, não do webhook ao vivo — ex.: `bf_c_179004...`.
 * Isso também evita colisão com o `mid` real que o webhook grava pro MESMO comentário, caso
 * a janela de sobreposição (backfill rodando enquanto o webhook já está no ar) exista — o
 * preço é uma linha duplicada nesse caso raro, não uma linha faltando ou uma sobrescrita.
 *
 * ─── POR QUE PROCESSA EM ORDEM E PARA ANTES DO TIMEOUT, NÃO TUDO DE UMA VEZ ────────────
 * Conta ativa pode ter dezenas de posts em 90 dias, cada um com sua própria chamada de
 * comentários — não dá pra garantir que cabe em 60s. Por isso corta o laço com folga
 * (`ORCAMENTO_MS`) e devolve `terminado:false` + `proximo_cursor` — clicar de novo no botão
 * continua de onde parou (idempotente: `ignore-duplicates` no `mid` torna reprocessar seguro).
 *
 * ⚠️ SEM CONFIRMAÇÃO CONTRA TRÁFEGO REAL — mesma ressalva de `_instagram-envio.js`: o formato
 * exato de `replies{...}` como sub-campo de `/comments` merece conferência contra a
 * documentação viva da Meta antes do 1º uso real (não verificável deste ambiente).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { getUser } from './_auth.js';
import { envioConfigurado, GRAPH_VERSION } from './_instagram-envio.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const IG_USER_ID = process.env.IG_USER_ID;
const IG_PAGE_TOKEN = process.env.IG_PAGE_TOKEN;

const ORCAMENTO_MS = 48000;           // corta o laço com folga sobre os 60s do maxDuration
const DIAS_PADRAO = 90;

/**
 * Monta o par pai+resposta a partir de um comentário e uma de suas replies — pura, sem rede,
 * testável em isolamento (é aqui que mora o risco: prefixo `bf_c_` errado, ou gravar a resposta
 * de OUTRA pessoa como se fosse do dono porque `from.id` não bateu certo). `null` quando a
 * reply não é do dono (nada a gravar) ou falta o mínimo pra identificar o comentário.
 */
export function montarParCorpus({ comentario, resposta, igUserId }) {
  if (!comentario?.id || !resposta?.id) return null;
  if (String(resposta?.from?.id ?? '') !== String(igUserId ?? '')) return null;
  const pai = typeof comentario.text === 'string'
    ? {
        mid: `bf_c_${comentario.id}`, ig_user_id: String(comentario?.from?.id || 'desconhecido'),
        direcao: 'recebida', origem: 'comentario', autor: 'pessoa',
        texto: comentario.text, respondida: true,
        ocorrido_em: comentario.timestamp ? new Date(comentario.timestamp).toISOString() : null,
      }
    : null;
  return {
    pai,
    resposta: {
      // `ig_user_id` da resposta é o do COMENTÁRIO PAI (a pessoa da conversa), não o do dono —
      // mesmo cuidado que `lerMensagem` já toma pro echo de DM, senão vira "conversa com nós mesmos".
      mid: `bf_c_${resposta.id}`, ig_user_id: String(comentario?.from?.id || 'desconhecido'),
      direcao: 'enviada', origem: 'comentario', autor: 'dono',
      texto: typeof resposta.text === 'string' ? resposta.text : null, respondida: true,
      ocorrido_em: resposta.timestamp ? new Date(resposta.timestamp).toISOString() : null,
    },
  };
}

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: {
    apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json', ...(init.headers || {}),
  },
});

async function chamarGraph(caminho, params) {
  const url = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${caminho}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set('access_token', IG_PAGE_TOKEN);
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => null);
  // `.ok` antes do corpo — mesma régua de _instagram-envio.js: a Graph API devolve JSON de
  // erro também em 4xx, e ler direto trataria "a Meta recusou" como "veio vazio".
  if (!r.ok) throw new Error(`graph_${r.status}: ${j?.error?.message || 'sem detalhe'}`);
  return j;
}

/** Grava par pergunta+resposta — best-effort, uma falha não derruba o lote inteiro. */
async function gravarPar({ pai, resposta }) {
  const linhas = [pai, resposta].filter(Boolean);
  if (!linhas.length) return true;
  const r = await sb('ig_mensagens', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(linhas),
  }).catch((e) => ({ ok: false, text: async () => String(e?.message || e) }));
  if (!r.ok) console.error('[ig-backfill] não gravou par:', await r.text());
  return r.ok;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  const rPerfil = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!rPerfil.ok) return res.status(502).json({ error: 'perfil_ilegivel', detalhe: await rPerfil.text() });
  const [perfil] = await rPerfil.json();
  if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });

  if (!envioConfigurado()) return res.status(409).json({ error: 'envio_nao_configurado', detalhe: 'IG_USER_ID/IG_PAGE_TOKEN ausentes na Vercel' });

  const corpo = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const dias = Number(corpo?.dias) > 0 ? Number(corpo.dias) : DIAS_PADRAO;
  const corteMs = Date.now() - dias * 86400000;
  let cursorMedia = typeof corpo?.cursor_media === 'string' ? corpo.cursor_media : undefined;

  const inicio = Date.now();
  let mediaVerificadas = 0;
  let respostasDoDono = 0;
  let paresGravados = 0;
  let terminado = false;
  let proximoCursor = null;

  paginaMedia:
  for (;;) {
    if (Date.now() - inicio > ORCAMENTO_MS) { proximoCursor = cursorMedia || null; break; }

    let pagina;
    try {
      pagina = await chamarGraph(`${IG_USER_ID}/media`, {
        fields: 'id,timestamp', limit: 25, ...(cursorMedia ? { after: cursorMedia } : {}),
      });
    } catch (e) {
      return res.status(502).json({ error: 'media_ilegivel', detalhe: String(e?.message || e) });
    }

    const itens = Array.isArray(pagina?.data) ? pagina.data : [];
    if (!itens.length) { terminado = true; break; }

    for (const media of itens) {
      const quando = Date.parse(media?.timestamp || '');
      if (Number.isFinite(quando) && quando < corteMs) { terminado = true; break paginaMedia; }
      if (Date.now() - inicio > ORCAMENTO_MS) { proximoCursor = cursorMedia || null; break paginaMedia; }

      mediaVerificadas++;
      let cursorComentario;
      for (;;) {
        let comentarios;
        try {
          comentarios = await chamarGraph(`${media.id}/comments`, {
            fields: 'id,text,timestamp,from,replies{id,text,timestamp,from}',
            limit: 50, ...(cursorComentario ? { after: cursorComentario } : {}),
          });
        } catch (e) {
          console.error('[ig-backfill] comentários ilegíveis pra', media.id, ':', e?.message);
          break; // um post com erro não derruba o backfill inteiro
        }

        for (const c of Array.isArray(comentarios?.data) ? comentarios.data : []) {
          const respostas = Array.isArray(c?.replies?.data) ? c.replies.data : [];
          for (const rep of respostas) {
            const par = montarParCorpus({ comentario: c, resposta: rep, igUserId: IG_USER_ID });
            if (!par) continue; // não é resposta do dono, ou dado insuficiente
            respostasDoDono++;
            if (await gravarPar(par)) paresGravados++;
          }
        }

        cursorComentario = comentarios?.paging?.cursors?.after;
        if (!cursorComentario || !comentarios?.paging?.next) break;
        if (Date.now() - inicio > ORCAMENTO_MS) break;
      }
    }

    cursorMedia = pagina?.paging?.cursors?.after;
    if (!cursorMedia || !pagina?.paging?.next) { terminado = true; break; }
  }

  console.log('[ig-backfill]', user.id, 'media=', mediaVerificadas, 'respostas=', respostasDoDono, 'pares=', paresGravados, 'terminado=', terminado);
  return res.status(200).json({
    ok: true, media_verificadas: mediaVerificadas, respostas_do_dono_encontradas: respostasDoDono,
    pares_gravados: paresGravados, terminado,
    // Se `terminado:false`, chame de novo com este cursor pra continuar de onde parou.
    proximo_cursor_media: terminado ? null : proximoCursor,
  });
}
