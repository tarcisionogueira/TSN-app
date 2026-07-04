// Cliente Gemini (generateContent) que devolve um Response no MESMO SHAPE do
// Anthropic (content[0].text, stop_reason, model, usage), para os callers
// existentes funcionarem sem alteração. Usado como:
//  (a) FALLBACK do Claude (api/_claude.js), e
//  (b) PRIMÁRIO em funções não-críticas (chat de dúvidas, resumo de tickets,
//      cnj-chat) — decisão de custo, mantendo o Claude no núcleo (jurídico/
//      documental/mercadológico).
// Dormente se GEMINI_API_KEY não existir → devolve null (comportamento seguro).
// NÃO cobre requisições com tools/web_search (só o Anthropic tem aqui).
// Modelo configurável por GEMINI_MODEL (padrão gemini-2.5-flash).

import { medirGemini } from './_uso.js';

export async function geminiFetch(options, { timeoutMs = 15000 } = {}) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

  let payload;
  try { payload = JSON.parse(options?.body || '{}'); } catch { return null; }

  const { system, messages, max_tokens, tools } = payload;
  if (tools) return null;                 // sem tools/web_search no Gemini aqui
  if (!Array.isArray(messages)) return null;

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
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(gBody), signal: ctrl.signal },
    );
    if (!res.ok) return null;
    const data = await res.json();
    medirGemini(model, data, 'messages'); // mede tokens (fire-and-forget)
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
      .join('');
    if (!text) return null;
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text }], stop_reason: 'end_turn', model, usage: {} }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}
