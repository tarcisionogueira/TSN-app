// Resiliência para a API do Claude (SPOF nº1: um provedor, uma chave, zero retry).
// Mesma semântica do fetch — devolve o Response — mas re-tenta em 429/500/502/503/529
// e erros de rede, com backoff exponencial + jitter, honrando Retry-After. Ponto
// único para toda chamada Claude do backend: troque `fetch(URL_CLAUDE, opts)` por
// `anthropicFetch(opts)`.
export const URL_CLAUDE = 'https://api.anthropic.com/v1/messages';
const RETRYABLE = new Set([429, 500, 502, 503, 529]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function anthropicFetch(options, { retries = 3, baseDelay = 800, timeoutMs = 120000 } = {}) {
  let lastRes; // último Response retornável (falha retryável exaurida)
  for (let tent = 0; tent <= retries; tent++) {
    // Timeout por tentativa: sem ele, uma conexão pendurada trava a chamada para
    // sempre e o retry/fallback nunca acionam. O abort cai no catch → re-tenta.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(URL_CLAUDE, { ...options, signal: options.signal || ctrl.signal });
      if (!RETRYABLE.has(res.status)) return res; // sucesso ou erro não-retryável → devolve direto
      if (tent === retries) { lastRes = res; break; } // retries exauridos com falha retryável
      const ra = Number(res.headers.get('retry-after'));
      const espera = ra > 0 ? ra * 1000 : baseDelay * 2 ** tent + Math.floor(Math.random() * 300);
      await sleep(espera);
    } catch (e) {
      if (tent === retries) { // rede caiu/timeout no último ataque → tenta fallback antes de propagar
        const fb = await iaFallback(options);
        if (fb) return fb;
        throw e;
      }
      await sleep(baseDelay * 2 ** tent + Math.floor(Math.random() * 300));
    } finally {
      clearTimeout(timer);
    }
  }
  // Chegou aqui = falha retryável do Anthropic esgotou os retries.
  const fb = await iaFallback(options);
  return fb || lastRes;
}

/**
 * FALLBACK GEMINI (remove o SPOF de "um provedor só").
 * -------------------------------------------------------
 * Só é acionado DEPOIS que os retries do Anthropic se esgotam (falha retryável
 * ou queda de rede). Requer `process.env.GEMINI_API_KEY`; sem essa env o
 * comportamento é IDÊNTICO ao de hoje (nunca dispara → seguro em produção).
 * Modelo configurável por `GEMINI_MODEL` (padrão gemini-2.5-flash).
 *
 * PRIVACIDADE: recomenda-se usar a chave do TIER PAGO do Gemini — no tier
 * gratuito o Google pode usar o conteúdo para treino, e o fluxo documental lê
 * edital E matrícula (a matrícula contém dados pessoais de terceiros). No tier
 * pago os dados não são usados para treino. Lembrando: isto é só a rede de
 * segurança — o Claude continua sendo o modelo primário de todas as chamadas.
 *
 * Traduz a requisição Anthropic (options.body em JSON) para o formato
 * generateContent do Gemini e devolve um Response SINTÉTICO no MESMO SHAPE do
 * Anthropic (`content[0].text`, `stop_reason`, `model`, `usage`), para que os
 * callers existentes continuem funcionando sem alteração.
 *
 * NÃO faz fallback quando a requisição usa `tools`/web search (só a Anthropic
 * replica a ferramenta aqui): retorna null e o chamador recebe o Response
 * original de falha. Uma única tentativa, timeout de 8s; falha → null.
 */
async function iaFallback(options) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

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

  // Gemini usa papéis 'user' e 'model' (mapeia 'assistant'→'model') e
  // systemInstruction separado.
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: toText(m.content) }],
  }));
  const gBody = { contents };
  if (system) gBody.systemInstruction = { parts: [{ text: system }] };
  if (max_tokens) gBody.generationConfig = { maxOutputTokens: max_tokens };

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(gBody), signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
      .join('');
    if (!text) return null;
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text }],
        stop_reason: 'end_turn',
        model,
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
