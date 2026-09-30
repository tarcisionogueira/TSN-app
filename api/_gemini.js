// Cliente Gemini (generateContent) que devolve um Response no MESMO SHAPE do
// Anthropic (content[0].text, stop_reason, model, usage), para os callers
// existentes funcionarem sem alteração. Usado como:
//  (a) RESERVA do Claude (api/_claude.js) — quando o Claude para de funcionar, e
//  (b) PRIMÁRIO nas funções não-críticas (chat de dúvidas, resumo de tickets,
//      cnj-chat…) via iaGeminiPrimary, com o Claude de reserva.
// Dormente se GEMINI_API_KEY não existir → devolve null (comportamento seguro).
// Modelo configurável por GEMINI_MODEL (padrão gemini-2.5-flash).
//
// 30/09 (pedido do dono: "se uma IA parar, a outra assume, nos dois sentidos"): a reserva passou a
// levar os DOCUMENTOS e a BUSCA NA WEB, em vez de recusar.
//  · PDF/imagem (blocos `document`/`image` em base64, ou `url` baixada aqui) → `inline_data`. Antes
//    o conversor DESCARTAVA os anexos e o Gemini "analisava" sem ler — por isso a leitura de
//    documento tinha sido travada só no Claude. Agora ele lê os mesmos arquivos. Se o total passar
//    do limite de request inline (~20 MB), RECUSA (null) — nunca manda leitura parcial.
//  · Ferramenta `web_search` do Anthropic → `google_search` do Gemini; o nº de buscas feitas pelo
//    Google volta em `usage.server_tool_use.web_search_requests`, que é a PROVA que
//    api/_busca-com-prova.js exige (resposta sem busca continua sendo falha).
//  · Outras ferramentas (funções próprias, ex. chat do admin) → null: não há como emular.
//  · `stop_reason` mapeado (MAX_TOKENS → 'max_tokens'), para os callers que detectam JSON cortado.
//  · O `system` (onde entram os APRENDIZADOS dos agentes) vai em `systemInstruction` — a mesma
//    orientação chega às duas IAs.

import { medirGemini } from './_uso.js';

const LIMITE_INLINE_BYTES = 18 * 1024 * 1024; // folga sob o teto de ~20 MB do request inline

// Sem `Buffer`: este módulo também roda no Edge Runtime (via _claude.js).
function paraBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function blocoParaParte(b, fim) {
  if (!b || typeof b !== 'object') return null;
  if (b.type === 'text' && typeof b.text === 'string') return { text: b.text };
  if (b.type === 'document' || b.type === 'image') {
    const s = b.source || {};
    if (s.type === 'base64' && s.data) return { inline_data: { mime_type: s.media_type || (b.type === 'image' ? 'image/jpeg' : 'application/pdf'), data: s.data } };
    if (s.type === 'text' && typeof s.data === 'string') return { text: s.data };
    if (s.type === 'url' && /^https:\/\//i.test(s.url || '')) {
      const resta = fim - Date.now();
      if (resta < 2000) throw new Error('sem tempo para baixar o anexo');
      const r = await fetch(s.url, { signal: AbortSignal.timeout(resta) }); // o download conta no MESMO prazo da reserva
      if (!r.ok) throw new Error(`anexo url HTTP ${r.status}`);
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > LIMITE_INLINE_BYTES) throw new Error(`anexo url com ${(bytes.length / 1048576).toFixed(1)} MB`);
      const mime = (r.headers.get('content-type') || '').split(';')[0] || (b.type === 'image' ? 'image/jpeg' : 'application/pdf');
      return { inline_data: { mime_type: mime, data: paraBase64(bytes) } };
    }
    throw new Error(`anexo em formato não suportado (${s.type || '?'})`);
  }
  return null; // tool_use/tool_result/server_tool_use de volta anterior: sem equivalente — ignora
}

export async function geminiFetch(options, { timeoutMs = 15000 } = {}) {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  if (!key) return null;
  const model = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

  let payload;
  try { payload = JSON.parse(options?.body || '{}'); } catch { return null; }

  const fim = Date.now() + timeoutMs; // prazo ÚNICO: download de anexo + chamada
  const { system, messages, max_tokens, tools } = payload;
  if (!Array.isArray(messages)) return null;
  // Só a busca na web tem equivalente; ferramenta própria (função) não dá para emular.
  const ferramentas = Array.isArray(tools) ? tools : [];
  const soBusca = ferramentas.every((t) => /^web_search/.test(String(t?.type || '')));
  if (!soBusca) return null;
  const comBusca = ferramentas.length > 0;

  let contents;
  try {
    contents = [];
    for (const m of messages) {
      const blocos = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (Array.isArray(m.content) ? m.content : []);
      const parts = (await Promise.all(blocos.map((b) => blocoParaParte(b, fim)))).filter(Boolean);
      if (!parts.length) continue;
      const role = m.role === 'assistant' ? 'model' : 'user';
      // Gemini exige alternância de papéis: funde mensagens seguidas do mesmo papel.
      const ult = contents[contents.length - 1];
      if (ult && ult.role === role) ult.parts.push(...parts); else contents.push({ role, parts });
    }
  } catch (e) {
    console.error('[gemini] anexo não convertido — reserva recusada:', e?.message || e);
    return null;
  }
  if (!contents.length) return null;
  const bytesInline = contents.reduce((s, c) => s + c.parts.reduce((a, p) => a + (p.inline_data ? p.inline_data.data.length * 0.75 : 0), 0), 0);
  if (bytesInline > LIMITE_INLINE_BYTES) {
    console.error(`[gemini] anexos somam ${(bytesInline / 1048576).toFixed(1)} MB (> limite inline) — reserva recusada`);
    return null;
  }

  const gBody = { contents };
  if (system) gBody.systemInstruction = { parts: [{ text: typeof system === 'string' ? system : (Array.isArray(system) ? system.map((s) => s?.text || '').join('\n') : String(system)) }] };
  // thinkingBudget 0: o "pensamento" do 2.5 consome o maxOutputTokens e cortava JSON longo.
  gBody.generationConfig = { ...(max_tokens ? { maxOutputTokens: max_tokens } : {}), thinkingConfig: { thinkingBudget: 0 } };
  if (comBusca) gBody.tools = [{ google_search: {} }];

  const resta = fim - Date.now();
  if (resta < 2000) { console.error('[gemini] prazo consumido pelos anexos — reserva recusada'); return null; }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), resta);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(gBody), signal: ctrl.signal },
    );
    if (!res.ok) {
      const det = await res.text().catch(() => '');
      console.error(`[gemini] HTTP ${res.status}: ${det.slice(0, 160)}`);
      return null;
    }
    const data = await res.json();
    medirGemini(model, data, comBusca ? 'grounding' : 'messages'); // mede tokens (fire-and-forget)
    const cand = data?.candidates?.[0];
    const text = (cand?.content?.parts || [])
      .map((p) => (p && typeof p.text === 'string' ? p.text : ''))
      .join('');
    if (!text) return null;
    const buscas = comBusca ? (cand?.groundingMetadata?.webSearchQueries || []).length : 0;
    const stop = cand?.finishReason === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
    return new Response(
      JSON.stringify({
        content: [{ type: 'text', text }], stop_reason: stop, model, provedor: 'gemini',
        usage: comBusca ? { server_tool_use: { web_search_requests: buscas } } : {},
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'x-ia-provedor': 'gemini' } },
    );
  } catch (e) {
    console.error('[gemini] falhou:', e?.name === 'AbortError' ? `timeout ${resta}ms` : (e?.message || e));
    return null;
  } finally {
    clearTimeout(t);
  }
}
