/**
 * /api/espelhar-docs-cron — copia matrícula e edital do SITE DO LEILOEIRO para o nosso bucket.
 *
 * REGRA DO DONO (08/08): "os leiloeiros em que volta e meia temos uma quebra, devemos passar a
 * armazenar esses documentos".
 *
 * O QUE ESTAVA EM RISCO, medido: dos lotes de leiloeiro com documento, quase nenhum tinha cópia
 * nossa — só ZUK (265) e GRUPOLANCE (212). Todo o resto era um link para o site do leiloeiro.
 * Quando o site cai, troca de endereço ou tira o lote do ar, o relatório documental perde a
 * matrícula e o edital que ele mesmo prometeu — e depois do leilão não há como recuperar.
 *
 * A FILA É AUTO-ORDENADA pela instabilidade REAL de cada fonte (`fonte_instabilidade()`, % de
 * execuções que não terminaram 'ok' nos últimos 60 dias). Quem quebra mais, espelha primeiro;
 * fonte nova instável entra sozinha; fonte que estabilizou sai. Ninguém mantém lista na mão.
 *
 * CUIDADOS DE CUSTO E EDUCAÇÃO: lote pequeno por execução, teto de tamanho por arquivo, e o
 * documento NÃO é rebaixado — o link original continua no acervo; a cópia entra como espelho.
 * Falhar aqui nunca altera o lote.
 *
 * ─── DUAS CORREÇÕES DE 11/08, medidas ─────────────────────────────────────────
 * (1) A FILA ESTAVA NA ORDEM ERRADA. Era `criado_em asc`: o documento de um lote que vai a
 *     leilão depois de amanhã ficava atrás de milhares cujo leilão é daqui a três meses.
 *     Depois do leilão o leiloeiro tira o lote do ar e o documento é irrecuperável — a perda
 *     que este cron existe para evitar. Agora a ordem é por DATA DO LEILÃO
 *     (`proximos_espelho_documentos`), depois instabilidade da fonte, depois chegada.
 * (2) A FILA NÃO DRENAVA. 4.079 pendentes contra 543 copiados: o cron enfileirava 200 por
 *     execução e copiava 25. Vazão real conferida: 148-150/dia → ~27 dias só para a fila
 *     atual, que cresce. O teto de 25 era um teto de CONTAGEM onde o que limita é TEMPO —
 *     a função tem 300s e gastava ~30s. Agora o lote é orçamento de tempo (lote é teto de
 *     contagem, nunca de teto de tempo).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { hostExternoSeguro, fetchExternoSeguro } from './_allowed-hosts.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
// TAMANHO DE CADA LEITURA DA FILA — e por que 1000 e não mais (11/08, medido duas vezes).
//
// 1ª medição: com LOTE 600 a rodada copiou 598 e terminou em 138s de 240s. Não faltou tempo,
// acabou o lote. Subi para 1200 esperando ~1.150 cópias.
// 2ª medição: a rodada seguinte copiou 985 + 14 ignorados = **999**. Esse número redondo é a
// resposta: o PostgREST CORTA a resposta em 1.000 linhas SEM AVISAR, inclusive em RPC que
// devolve conjunto. Pedir 1200 e receber 1000 não gera erro nenhum — é a mesma armadilha que
// o `api/publico.js` já documenta neste repositório ("limit=100000" devolvia 1.000 e a página
// foi ao ar anunciando 980 imóveis num acervo de 33 mil).
//
// Então LOTE acima de 1000 é ilusão. O jeito de usar o orçamento inteiro é LER DE NOVO depois
// de processar — o laço abaixo faz isso, e funciona porque documento copiado sai da fila,
// então a leitura seguinte traz os PRÓXIMOS, não os mesmos.
const LOTE = Math.min(1000, Number(process.env.ESPELHO_LOTE || 1000));
// Downloads simultâneos. O gargalo é rede de terceiro, não CPU nossa — ver o pool abaixo.
const CONCORRENCIA = Math.max(1, Number(process.env.ESPELHO_CONCORRENCIA || 6));
// Sai com folga antes do maxDuration de 300s: um download pode levar 25s (o timeout abaixo),
// então paramos aos 240s para sempre haver tempo de responder e registrar o resultado.
const ORCAMENTO_MS = Number(process.env.ESPELHO_ORCAMENTO_MS || 240000);
const MAX_BYTES = 25 * 1024 * 1024; // matrícula digitalizada passa de 10 MB; 25 é folga sensata
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function marcar(id, patch) {
  await sb(`documento_espelho?id=eq.${id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, atualizado_em: new Date().toISOString() }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // Reabastece a fila antes de trabalhar: lotes novos entram na ordem da instabilidade da fonte.
  let enfileirados = 0;
  try {
    const r = await sb('rpc/enfileirar_espelho_documentos', { method: 'POST', body: JSON.stringify({ p_limite: 500 }) });
    if (r.ok) enfileirados = await r.json().catch(() => 0);
    else console.error('[espelhar-docs] enfileirar', r.status, (await r.text().catch(() => '')).slice(0, 200));
  } catch (e) { console.error('[espelhar-docs] enfileirar erro', e?.message); }

  // A leitura da fila é BINDADA e tem `.ok` checado: antes era
  // `await (await sb(...)).json().catch(() => [])` — uma falha de leitura virava lista vazia,
  // o cron respondia `ok: true, motivo: 'fila vazia'` e ninguém ficava sabendo que a fila
  // parou. É a forma #1/#3 do CLAUDE.md, no mesmo arquivo que protege documento de cliente.
  //
  // Devolve { erro } em vez de lançar, porque a 1ª leitura e as seguintes têm desfechos
  // diferentes: falhar na primeira é 502 (não fizemos nada); falhar na quarta é parar e
  // responder com o que já foi copiado — jogar fora 3 lotes de trabalho por um erro de rede
  // na leitura seguinte seria pior que o problema.
  async function lerFila() {
    const r = await sb('rpc/proximos_espelho_documentos', {
      method: 'POST', body: JSON.stringify({ p_limite: LOTE }),
    });
    if (!r.ok) return { erro: `fila HTTP ${r.status}`, detalhe: (await r.text().catch(() => '')).slice(0, 200) };
    const j = await r.json().catch(() => null);
    if (!Array.isArray(j)) return { erro: 'fila com corpo inesperado' };
    return { itens: j };
  }

  const t0 = Date.now();
  let copiados = 0, falhas = 0, ignorados = 0, processados = 0, semTempo = 0;
  let leituras = 0, erroLeitura = null;

  /** Espelha UM documento. Não lança: devolve o desfecho para o pool contabilizar. */
  async function espelhar(d) {
    // Anti-SSRF: só host externo permitido — a URL veio do acervo, mas o acervo vem de scraper.
    if (!hostExternoSeguro(d.url_origem)) {
      await marcar(d.id, { status: 'ignorado', motivo: 'host não permitido' });
      return 'ignorado';
    }
    let bin = null, mime = 'application/pdf';
    try {
      const r = await fetchExternoSeguro(d.url_origem, {
        headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' },
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) { await marcar(d.id, { status: 'pendente', tentativas: (d.tentativas || 0) + 1, motivo: `HTTP ${r.status}` }); return 'falha'; }
      mime = (r.headers.get('content-type') || 'application/pdf').split(';')[0].trim();
      const buf = new Uint8Array(await r.arrayBuffer());
      // Página HTML de erro travestida de documento: não espelha lixo como se fosse matrícula.
      if (/text\/html/i.test(mime)) { await marcar(d.id, { status: 'ignorado', motivo: 'resposta HTML, não é documento' }); return 'ignorado'; }
      if (!buf.length || buf.length > MAX_BYTES) { await marcar(d.id, { status: 'ignorado', motivo: `tamanho ${buf.length}` }); return 'ignorado'; }
      bin = Buffer.from(buf);
    } catch (e) {
      await marcar(d.id, { status: 'pendente', tentativas: (d.tentativas || 0) + 1, motivo: String(e?.message || e).slice(0, 120) });
      return 'falha';
    }

    const ext = /pdf/i.test(mime) ? 'pdf' : /jpe?g/i.test(mime) ? 'jpg' : /png/i.test(mime) ? 'png' : 'bin';
    // Sufixo do id no nome: com os ANEXOS na fila (11/08) um mesmo imóvel passa a ter VÁRIOS
    // documentos do mesmo tipo — o rj_82634 tem 1ª, 2ª e 3ª publicação. Com o path antigo
    // (`${tipo}.${ext}`) o `x-upsert: true` faria o segundo sobrescrever o primeiro e as duas
    // linhas apontariam para o mesmo arquivo: dois registros, um documento. As 543 cópias já
    // feitas mantêm o path antigo — elas não são reprocessadas (status 'copiado').
    const path = `espelho/${d.fonte}/${d.imovel_id}/${d.tipo}-${String(d.id).slice(0, 8)}.${ext}`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': mime, 'x-upsert': 'true' },
      body: bin,
    });
    if (!up.ok) {
      await marcar(d.id, { status: 'pendente', tentativas: (d.tentativas || 0) + 1, motivo: `upload ${up.status}` });
      return 'falha';
    }
    await marcar(d.id, { status: 'copiado', storage_path: path, bytes: bin.length, motivo: null });
    return 'copiado';
  }

  // ─── POOL DE TRABALHADORES (11/08, medido) ────────────────────────────────────
  // A primeira execução com orçamento de tempo copiou 113 documentos em 240s — 2,1s cada,
  // quase tudo esperando o download do CDN do leiloeiro. Sequencial, o teto é esse: 678/dia
  // contra 1.200/dia entrando na fila enquanto os anexos são enfileirados. A fila NÃO drenava.
  // Com CONCORRENCIA downloads em voo, o tempo ocioso vira vazão sem pedir mais recurso a
  // ninguém — é o mesmo padrão já validado no backup-r2-cron. Cada trabalhador respeita o
  // MESMO orçamento de tempo, então a função continua terminando antes do maxDuration.
  // 6 é deliberadamente modesto: são CDNs de terceiros e não queremos parecer rajada.
  //
  // ─── LER → PROCESSAR → LER DE NOVO, até o tempo acabar (11/08, 2ª medição) ────
  // O pool sozinho não bastava: com um único `lerFila()` a rodada terminava em 179s de 240s
  // porque o PostgREST devolve no MÁXIMO 1.000 linhas, sem avisar (ver o comentário do LOTE).
  // Ou seja, 60s de orçamento sobravam todo dia por um teto que ninguém tinha declarado.
  // Reler funciona porque o que foi copiado sai da fila: a leitura seguinte traz os PRÓXIMOS.
  // A guarda `!lote.itens.length` é o que garante término — fila vazia encerra o laço.
  for (;;) {
    if (Date.now() - t0 > ORCAMENTO_MS) break;
    const lote = await lerFila();
    if (lote.erro) {
      if (leituras === 0) {   // nada feito ainda: é 502 mesmo
        console.error('[espelhar-docs] leitura da fila falhou', lote.erro, lote.detalhe || '');
        res.status(502).json({ ok: false, enfileirados, erro: lote.erro, detalhe: lote.detalhe });
        return;
      }
      erroLeitura = lote.erro;   // já copiamos algo: para e reporta junto com o resultado
      break;
    }
    if (!lote.itens.length) break;
    leituras++;

    const pend = lote.itens;
    let cursor = 0;
    const trabalhador = async () => {
      for (;;) {
        if (Date.now() - t0 > ORCAMENTO_MS) return;
        const i = cursor++;
        if (i >= pend.length) return;
        processados++;
        const r = await espelhar(pend[i]).catch(() => 'falha');
        if (r === 'copiado') copiados++;
        else if (r === 'ignorado') ignorados++;
        else falhas++;
      }
    };
    await Promise.all(Array.from({ length: CONCORRENCIA }, trabalhador));
    // Sobrou item do lote = o tempo acabou no meio dele. Não adianta reler.
    if (cursor < pend.length) { semTempo = pend.length - cursor; break; }
  }

  if (leituras === 0) {
    console.log('[espelhar-docs]', JSON.stringify({ enfileirados, processados: 0, motivo: 'fila vazia' }));
    res.status(200).json({ ok: true, enfileirados, processados: 0, motivo: 'fila vazia' });
    return;
  }

  // Quanto ainda falta: sem isto, "copiei 25" parece progresso mesmo quando a fila cresce
  // mais rápido do que drena — que foi exatamente o que aconteceu por três dias.
  let pendentes = null;
  try {
    const r = await sb('documento_espelho?status=eq.pendente&tentativas=lt.3&select=id', {
      headers: { Prefer: 'count=exact', Range: '0-0' },
    });
    if (r.ok) pendentes = Number((r.headers.get('content-range') || '').split('/')[1]) || null;
  } catch { /* contagem é informativa; não derruba a execução */ }

  // Log sempre, inclusive quando não houve baixa: silêncio não distingue "nada a fazer" de
  // "cron parou" — a lição do monitor de fontes.
  // `leituras` e `ms` entram na resposta porque foram eles que revelaram o teto invisível do
  // PostgREST: uma rodada que faz 1 leitura e termina antes do orçamento está batendo em
  // algum limite que não é o tempo. Sem esses dois números, isso só apareceu comparando
  // cópias entre dois dias — caro demais para um dado que cabe no log.
  const saida = {
    enfileirados, processados, copiados, falhas, ignorados,
    sem_tempo: semTempo, pendentes, leituras, ms: Date.now() - t0,
    ...(erroLeitura ? { erro_leitura: erroLeitura } : {}),
  };
  console.log('[espelhar-docs]', JSON.stringify(saida));
  res.status(200).json({ ok: true, ...saida });
}
