// Resiliência para a API do Claude (SPOF nº1: um provedor, uma chave, zero retry).
// Mesma semântica do fetch — devolve o Response — mas re-tenta em 429/500/502/503/529
// e erros de rede, com backoff exponencial + jitter, honrando Retry-After. Ponto
// único para toda chamada Claude do backend: troque `fetch(URL_CLAUDE, opts)` por
// `anthropicFetch(opts)`.
export const URL_CLAUDE = 'https://api.anthropic.com/v1/messages';
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function anthropicFetch(options, { retries = 3, baseDelay = 800 } = {}) {
  let lastErr;
  for (let tent = 0; tent <= retries; tent++) {
    try {
      const res = await fetch(URL_CLAUDE, options);
      if (!RETRYABLE.has(res.status) || tent === retries) return res;
      const ra = Number(res.headers.get('retry-after'));
      const espera = ra > 0 ? ra * 1000 : baseDelay * 2 ** tent + Math.floor(Math.random() * 300);
      await sleep(espera);
    } catch (e) {
      lastErr = e;
      if (tent === retries) throw e;
      await sleep(baseDelay * 2 ** tent + Math.floor(Math.random() * 300));
    }
  }
  throw lastErr;
}
