/**
 * GET /api/instagram-responder-cron — a espinha: FILA → MOTOR → RASCUNHO.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⚠️ ELE NÃO ENVIA NADA. Classifica, redige, decide e GRAVA. O envio é a peça seguinte
 * (`_ig-envio.js`), separada de propósito — enquanto ela não existe, o pior desfecho possível
 * aqui é um rascunho errado numa tabela, e não uma mensagem errada num cliente.
 *
 * ─── POR QUE UM CRON, E NÃO O WEBHOOK ────────────────────────────────────────────────
 * A Meta exige 200 rápido e reentrega quando demora; duas chamadas de IA levam segundos. O
 * webhook grava e sai; quem pensa é isto aqui. Mesma separação do motor de análise.
 *
 * ─── A ORDEM DE PROCESSAMENTO É A DA FILA, E ISSO É O PONTO ──────────────────────────
 * `ig_fila_resposta()` devolve ordenado por VENCIMENTO, não por chegada. Um comentário a 6
 * dias de perder a private reply vem antes de uma DM de 10 minutos. Se este cron reordenasse
 * por qualquer outro critério, a fila teria sido construída à toa.
 *
 * ─── DOIS FREIOS DE CUSTO, e eles medem coisas diferentes ────────────────────────────
 *   TETO_ITENS — quantas mensagens por rodada. Protege a fatura e o tempo da função.
 *   o CLAIM    — `ig_rascunho.mid_origem` é UNIQUE. Duas rodadas sobrepostas não gastam duas
 *                vezes pela mesma mensagem. O pré-filtro em JS evita a chamada de IA; o
 *                UNIQUE garante que, se escapar, o banco recusa.
 *
 * ─── ITEM EXPIRADO NÃO É IGNORADO: É CONTADO COMO PERDA ──────────────────────────────
 * Ele vira uma linha com `acao='perdido'`. Sem isso, janela queimada sairia da fila em
 * silêncio e o sistema pareceria em dia — que é a diferença entre "não havia o que fazer" e
 * "não deu tempo", e elas levam a decisões opostas.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { classificar, redigir, decidirEnvio, montarExemplos, MODELO_REDACAO } from './_ig-motor.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

const TETO_ITENS = 25;          // por rodada
const EXEMPLOS_DO_DONO = 8;     // quantas respostas dele entram no prompt como referência

async function sb(caminho, opts = {}) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, {
    ...opts,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  // `.ok` ANTES do corpo: o PostgREST devolve JSON em erro também, e lê-lo direto
  // transformaria "não consegui ler a fila" em "a fila está vazia" — que é a forma de falha
  // nº 1, e aqui ela faria o cron reportar sucesso sem ter feito nada.
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${caminho}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

const rpc = (fn, body = {}) => sb(`rpc/${fn}`, { method: 'POST', body: JSON.stringify(body) });

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'não autorizado' });
  if (!SB || !KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const inicio = Date.now();
  const resumo = { lidos: 0, ja_tinham_rascunho: 0, gravados: 0, por_acao: {}, erros: [] };

  try {
    const fila = (await rpc('ig_fila_resposta', { limite: TETO_ITENS * 2 })) || [];
    resumo.lidos = fila.length;
    // Fila vazia é resposta legítima aqui (a escuta pode estar dormente). O que NÃO pode
    // passar por vazio é falha de leitura — e ela lança lá em cima, não chega neste ponto.
    if (!fila.length) return res.status(200).json({ ok: true, ...resumo, motivo: 'fila_vazia' });

    // Pré-filtro do claim: quem já tem rascunho não volta ao motor. Evita a chamada de IA;
    // o UNIQUE em `mid_origem` é a rede embaixo, para o caso de duas rodadas se cruzarem.
    const mids = fila.map((f) => f.mid);
    const jaTem = new Set((await sb(
      `ig_rascunho?select=mid_origem&mid_origem=in.(${mids.map((m) => `"${String(m).replace(/"/g, '')}"`).join(',')})`,
    ) || []).map((r) => r.mid_origem));

    const [classes, personas, ofertas] = await Promise.all([
      sb('ig_classe?select=chave,titulo,instrucao,autonomo&ativo=is.true'),
      sb('ig_persona?select=instrucao,nunca_dizer,versao&ativo=is.true&order=criado_em.desc&limit=1'),
      sb('ig_oferta_vigente?select=titulo,link,intencao&ativo=is.true&order=inicio.desc&limit=1'),
    ]);
    const persona = personas?.[0] || null;
    const oferta = ofertas?.[0] || null;
    const instrucaoPorClasse = Object.fromEntries((classes || []).map((c) => [c.chave, c.instrucao]));

    // Persona ausente é bloqueio, não detalhe: sem ela o modelo escreveria com a voz dele
    // mesmo, e a trava `nunca_dizer` (que é mecânica e regulatória) não existiria.
    if (!persona) return res.status(500).json({ error: 'sem_persona_ativa', ...resumo });

    let processados = 0;
    for (const item of fila) {
      if (processados >= TETO_ITENS) break;
      if (jaTem.has(item.mid)) { resumo.ja_tinham_rascunho++; continue; }
      processados++;

      const linha = {
        mid_origem: item.mid, ig_user_id: item.ig_user_id, origem: item.origem,
        janela: item.janela, vence_em: item.vence_em,
        classe: item.classe, classe_conf: null, texto_sugerido: null,
        acao: 'rascunho', motivo: null, modelo: null,
      };

      try {
        // Janela vencida: NÃO gasta IA. Não há o que enviar, e um rascunho para janela morta
        // sugeriria ao dono que ainda dá tempo. Vira perda contada, que é o que ela é.
        if (item.expirado) {
          const d = decidirEnvio({ item, texto: null, persona });
          Object.assign(linha, { acao: d.acao, motivo: d.motivo });
        } else {
          const cl = await classificar({ texto: item.texto || '', origem: item.origem, classes: classes || [] });
          Object.assign(linha, { classe: cl.classe, classe_conf: cl.confianca });

          // Spam não recebe resposta e por isso não gasta redação. `decidirEnvio` decide;
          // aqui só se evita o custo de escrever algo que nunca sairia.
          if (cl.classe === 'spam') {
            const d = decidirEnvio({ item: { ...item, classe: 'spam' }, texto: null, persona });
            Object.assign(linha, { acao: d.acao, motivo: d.motivo });
          } else {
            // O histórico do DONO com esta pessoa é o que ensina o tom. `montarExemplos`
            // filtra `autor='dono'` de novo, de propósito: a consulta pode mudar, a regra não.
            const hist = await sb(
              `ig_mensagens?select=autor,texto&ig_user_id=eq.${encodeURIComponent(item.ig_user_id)}`
              + `&autor=eq.dono&texto=not.is.null&order=criado_em.desc&limit=${EXEMPLOS_DO_DONO}`,
            );
            const texto = await redigir({
              item: { ...item, classe: cl.classe }, persona, oferta,
              exemplos: montarExemplos(hist || [], EXEMPLOS_DO_DONO),
              instrucaoClasse: instrucaoPorClasse[cl.classe],
            });
            const autonomo = (classes || []).find((c) => c.chave === cl.classe)?.autonomo === true;
            const d = decidirEnvio({ item: { ...item, classe: cl.classe, autonomo }, texto, persona });
            Object.assign(linha, { texto_sugerido: texto, acao: d.acao, motivo: d.motivo, modelo: MODELO_REDACAO });
          }
        }
      } catch (e) {
        // Falha de IA vira rascunho com o MOTIVO visível — nunca sumiço. Assim o item aparece
        // no painel como "não consegui", que é diferente de não aparecer.
        Object.assign(linha, { acao: 'rascunho', motivo: `falha_motor: ${String(e?.message || e).slice(0, 120)}` });
        resumo.erros.push({ mid: item.mid, erro: String(e?.message || e).slice(0, 160) });
      }

      try {
        // `resolution=ignore-duplicates`: se outra rodada gravou primeiro, esta desiste em
        // silêncio — o trabalho foi perdido, mas nada é sobrescrito.
        await sb('ig_rascunho?on_conflict=mid_origem', {
          method: 'POST', body: JSON.stringify([linha]),
          headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
        });
        resumo.gravados++;
        resumo.por_acao[linha.acao] = (resumo.por_acao[linha.acao] || 0) + 1;

        // A classe volta para a mensagem: alimenta o corpus e faz a própria fila saber, na
        // rodada seguinte, se aquela classe é autônoma.
        if (linha.classe) {
          await sb(`ig_mensagens?mid=eq.${encodeURIComponent(item.mid)}`, {
            method: 'PATCH',
            body: JSON.stringify({ classe: linha.classe, classe_conf: linha.classe_conf }),
            headers: { Prefer: 'return=minimal' },
          });
        }
      } catch (e) {
        resumo.erros.push({ mid: item.mid, erro: `nao_gravou: ${String(e?.message || e).slice(0, 160)}` });
      }
    }

    return res.status(200).json({ ok: true, ...resumo, persona: persona.versao, ms: Date.now() - inicio });
  } catch (e) {
    // Falha de leitura NUNCA vira "ok, nada a fazer": o cron precisa gritar, senão a fila
    // envelhece em silêncio e a janela queima sem ninguém saber.
    console.error('[ig-responder]', e?.message || e);
    return res.status(500).json({ error: String(e?.message || e), ...resumo });
  }
}
