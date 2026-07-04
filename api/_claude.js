// Resiliência para a API do Claude (SPOF nº1: um provedor, uma chave, zero retry).
// Mesma semântica do fetch — devolve o Response — mas re-tenta em 429/500/502/503/529
// e erros de rede, com backoff exponencial + jitter, honrando Retry-After. Ponto
// único para toda chamada Claude do backend: troque `fetch(URL_CLAUDE, opts)` por
// `anthropicFetch(opts)`.
export const URL_CLAUDE = 'https://api.anthropic.com/v1/messages';
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function anthropicFetch(options, { retries = 3, baseDelay = 800 } = {}) {
  let lastRes; // último Response retornável (falha retryável exaurida)
  for (let tent = 0; tent <= retries; tent++) {
    try {
      const res = await fetch(URL_CLAUDE, options);
      if (!RETRYABLE.has(res.status)) return res; // sucesso ou erro não-retryável → devolve direto
      if (tent === retries) { lastRes = res; break; } // retries exauridos com falha retryável
      const ra = Number(res.headers.get('retry-after'));
      const espera = ra > 0 ? ra * 1000 : baseDelay * 2 ** tent + Math.floor(Math.random() * 300);
      await sleep(espera);
    } catch (e) {
      if (tent === retries) { // rede caiu no último ataque → tenta fallback antes de propagar
        const fb = await openaiFallback(options);
        if (fb) return fb;
        throw e;
      }
      await sleep(baseDelay * 2 ** tent + Math.floor(Math.random() * 300));
    }
  }
  // Chegou aqui = falha retryável do Anthropic esgotou os retries.
  const fb = await openaiFallback(options);
  return fb || lastRes;
}

/**
 * FALLBACK OPENAI (remove o SPOF de "um provedor só").
 * -------------------------------------------------------
 * Só é acionado DEPOIS que os retries do Anthropic se esgotam (falha retryável
 * ou queda de rede). Requer `process.env.OPENAI_API_KEY`; sem essa env o
 * comportamento é IDÊNTICO ao de hoje (nunca dispara → seguro em produção).
 *
 * Traduz a requisição Anthropic (options.body em JSON) para o formato
 * chat/completions da OpenAI e devolve um Response SINTÉTICO com corpo no
 * MESMO SHAPE do Anthropic (`content[0].text`, `stop_reason`, `model`, `usage`),
 * para que os callers existentes (`data.content[0].text`, `res.ok`, `res.status`)
 * continuem funcionando sem alteração.
 *
 * NÃO faz fallback quando a requisição usa `tools`/web search — a OpenAI não
 * replica a ferramenta web_search do Anthropic aqui; nesse caso retorna null e
 * o chamador recebe o Response original de falha do Anthropic.
 *
 * Estratégia: uma única tentativa (sem loop de retry), timeout de 8s.
 * Qualquer falha → retorna null (chamador usa o Response de falha original).
 */
async function openaiFallback(options) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  let payload;
  try {
    payload = JSON.parse(options?.body || '{}');
  } catch {
    return null;
  }

  const { system, messages, max_tokens, tools } = payload;
  // Sem suporte a tools/web_search no fallback.
  if (tools) return null;
  if (!Array.isArray(messages)) return null;

  // Converte content do Anthropic (string OU array de {type:'text',text}) em string simples.
  const toText = (content) => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
        .map((b) => b.text)
        .join('\n');
    }
    return '';
  };

  const oaMessages = [];
  if (system) oaMessages.push({ role: 'system', content: system });
  for (const m of messages) {
    oaMessages.push({ role: m.role, content: toText(m.content) });
  }

  const oaBody = { model: 'gpt-4o', messages: oaMessages };
  if (max_tokens) oaBody.max_completion_tokens = max_tokens;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(oaBody),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content || '';
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        model: 'gpt-4o',
        usage: {},
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
