// Resiliência para a API do Claude (SPOF nº1: um provedor, uma chave, zero retry).
// Mesma semântica do fetch — devolve o Response — mas re-tenta em 429/500/502/503/529
// e erros de rede, com backoff exponencial + jitter, honrando Retry-After. Ponto
// único para toda chamada Claude do backend: troque `fetch(URL_CLAUDE, opts)` por
// `anthropicFetch(opts)`.
import { geminiFetch } from './_gemini.js';
import { medirClaude, registrarUso } from './_uso.js';

export const URL_CLAUDE = 'https://api.anthropic.com/v1/messages';
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Falha do PROVEDOR (não do pedido): chave inválida/revogada (401/403), sem crédito (402, ou 400
// "credit balance is too low" — é assim que o Anthropic avisa saldo zerado), modelo retirado (404).
// Re-tentar não adianta; trocar de IA sim.
const FALHA_PROVEDOR = new Set([401, 402, 403, 404]);
async function provedorParou(res) {
  if (FALHA_PROVEDOR.has(res.status)) return true;
  if (res.status !== 400) return false;
  const corpo = await res.clone().text().catch(() => '');
  return /credit balance|billing|quota/i.test(corpo);
}

// Tempo da reserva: o do pedido original (documento longo precisa dele), com piso de 20 s e teto
// de 60 s para caber no limite da função serverless depois das tentativas do Claude.
const tempoReserva = (timeoutMs) => Math.max(20000, Math.min(timeoutMs, 60000));

async function reservaGemini(options, timeoutMs, motivo) {
  const fb = await geminiFetch(options, { timeoutMs: tempoReserva(timeoutMs) });
  if (fb) console.warn(`[ia] Claude indisponível (${motivo}) — respondido pelo Gemini`);
  return fb;
}

export async function anthropicFetch(options, { retries = 3, baseDelay = 800, timeoutMs = 120000, noFallback = false } = {}) {
  // 30/09 (pedido do dono: "se uma IA parar, a outra assume, nos dois sentidos"): a reserva Gemini
  // vale para TODA função, inclusive o núcleo (documental/mercadológico/laudo), que antes era
  // Claude-only porque o conversor descartava os PDFs. Agora api/_gemini.js lê os mesmos anexos e
  // faz a mesma busca na web — e recusa (null) quando não consegue, caso em que volta a resposta
  // do Claude. Os APRENDIZADOS entram no `system`, que vai inteiro para as duas IAs.
  // `noFallback: 'estrito'` é a única exceção (teste A/B, que precisa medir o Claude puro);
  // o antigo `noFallback: true` passou a ser ignorado de propósito.
  const estrito = noFallback === 'estrito';
  let lastRes; // último Response retornável (falha retryável exaurida)
  for (let tent = 0; tent <= retries; tent++) {
    // Timeout por tentativa: sem ele, uma conexão pendurada trava a chamada para
    // sempre e o retry/fallback nunca acionam. O abort cai no catch → re-tenta.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(URL_CLAUDE, { ...options, signal: options.signal || ctrl.signal });
      if (!RETRYABLE.has(res.status)) {
        if (res.ok) { medirClaude(options, res.clone()); return res; } // mede tokens/buscas sem consumir o corpo do caller
        if (!estrito && await provedorParou(res)) {
          console.error(`[ia] Claude HTTP ${res.status} (falha do provedor) — tentando o Gemini`);
          return (await reservaGemini(options, timeoutMs, `HTTP ${res.status}`)) || res;
        }
        return res; // erro do PEDIDO (400 comum, 413…) → devolve direto; a outra IA erraria igual
      }
      if (tent === retries) { lastRes = res; break; } // retries exauridos com falha retryável
      const ra = Number(res.headers.get('retry-after'));
      const espera = ra > 0 ? ra * 1000 : baseDelay * 2 ** tent + Math.floor(Math.random() * 300);
      await sleep(espera);
    } catch (e) {
      // GASTO INVISÍVEL: `medirClaude` só mede `res.ok`. Um timeout do NOSSO lado (AbortError)
      // não cancela o trabalho já feito do outro lado — a chamada é cobrada e não aparece em
      // `uso_integracoes`, então o painel some justamente com o desperdício. Cada tentativa
      // abortada/quebrada vira uma linha `abortada` (sem custo estimável — não sabemos os
      // tokens), para que o número de chamadas cobradas e não entregues seja AUDITÁVEL.
      registrarUso('claude', 'abortada', { requests: 1 }); // fire-and-forget: nunca atrasa o retry
      if (tent === retries) { // rede caiu/timeout no último ataque → tenta fallback antes de propagar
        if (estrito) throw e;
        const fb = await reservaGemini(options, timeoutMs, e?.name === 'AbortError' ? 'timeout' : 'rede');
        if (fb) return fb;
        throw e;
      }
      await sleep(baseDelay * 2 ** tent + Math.floor(Math.random() * 300));
    } finally {
      clearTimeout(timer);
    }
  }
  // Chegou aqui = falha retryável do Anthropic esgotou os retries → fallback Gemini.
  if (estrito) return lastRes;
  return (await reservaGemini(options, timeoutMs, `HTTP ${lastRes?.status} esgotado`)) || lastRes;
}

// IA com GEMINI PRIMÁRIO e Claude como fallback — para funções NÃO-críticas
// (chat de dúvidas, resumo de tickets, cnj-chat). Decisão de custo: o núcleo
// (jurídico/documental/mercadológico) continua no Claude via anthropicFetch.
// Se GEMINI_API_KEY não existir, geminiFetch devolve null e cai no Claude
// automaticamente (seguro). Devolve o Response no shape do Anthropic.
export async function iaGeminiPrimary(options, { timeoutMs = 20000, claude = {} } = {}) {
  const g = await geminiFetch(options, { timeoutMs });
  if (g) return g;
  return anthropicFetch(options, claude);
}

// Atalho para prompt de TEXTO simples com Gemini primário e Claude de reserva (ou o contrário,
// com `primario: 'claude'`). Monta o corpo no formato Anthropic — as duas IAs recebem o MESMO
// `system` e o MESMO prompt. Devolve { texto, provedor } ou null (as duas falharam / sem chave).
export async function iaTexto({ prompt, system, maxTokens = 2000, model = 'claude-haiku-4-5-20251001', timeoutMs = 30000, primario = 'gemini' }) {
  const chave = (process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY || '').trim();
  const options = {
    method: 'POST',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, ...(system ? { system } : {}), messages: [{ role: 'user', content: prompt }] }),
  };
  let r;
  try {
    r = primario === 'claude'
      ? await anthropicFetch(options, { retries: 1, timeoutMs })
      : await iaGeminiPrimary(options, { timeoutMs, claude: { retries: 1, timeoutMs } });
  } catch (e) {
    console.error('[ia] iaTexto: as duas IAs falharam:', e?.message || e);
    return null;
  }
  if (!r.ok) {
    console.error(`[ia] iaTexto: HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
    return null;
  }
  const data = await r.json();
  const texto = (data?.content || []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
  if (!texto) return null;
  return { texto, provedor: data?.provedor || 'claude', stop: data?.stop_reason || null };
}
