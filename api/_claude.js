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

export async function anthropicFetch(options, { retries = 3, baseDelay = 800, timeoutMs = 120000, noFallback = false } = {}) {
  // noFallback: NÚCLEO JURÍDICO (documental/mercadológico/laudo) roda SÓ no Claude.
  // O Gemini não lê PDF aqui e é menos confiável para o parecer — melhor falhar e
  // reprocessar (ciclo/retry) do que devolver um laudo pior. Gemini fica para o
  // chat de dúvidas (não crítico).
  let lastRes; // último Response retornável (falha retryável exaurida)
  for (let tent = 0; tent <= retries; tent++) {
    // Timeout por tentativa: sem ele, uma conexão pendurada trava a chamada para
    // sempre e o retry/fallback nunca acionam. O abort cai no catch → re-tenta.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(URL_CLAUDE, { ...options, signal: options.signal || ctrl.signal });
      if (!RETRYABLE.has(res.status)) {
        if (res.ok) medirClaude(options, res.clone()); // mede tokens/buscas sem consumir o corpo do caller
        return res; // sucesso ou erro não-retryável → devolve direto
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
        if (noFallback) throw e; // Claude-only: propaga a falha (o caller reprocessa)
        const fb = await geminiFetch(options, { timeoutMs: 8000 });
        if (fb) return fb;
        throw e;
      }
      await sleep(baseDelay * 2 ** tent + Math.floor(Math.random() * 300));
    } finally {
      clearTimeout(timer);
    }
  }
  // Chegou aqui = falha retryável do Anthropic esgotou os retries → fallback Gemini.
  if (noFallback) return lastRes; // Claude-only: devolve a resposta do Claude (ainda que 429/5xx)
  const fb = await geminiFetch(options, { timeoutMs: 8000 });
  return fb || lastRes;
}

// IA com GEMINI PRIMÁRIO e Claude como fallback — para funções NÃO-críticas
// (chat de dúvidas, resumo de tickets, cnj-chat). Decisão de custo: o núcleo
// (jurídico/documental/mercadológico) continua no Claude via anthropicFetch.
// Se GEMINI_API_KEY não existir, geminiFetch devolve null e cai no Claude
// automaticamente (seguro). Devolve o Response no shape do Anthropic.
export async function iaGeminiPrimary(options) {
  const g = await geminiFetch(options, { timeoutMs: 20000 });
  if (g) return g;
  return anthropicFetch(options);
}
