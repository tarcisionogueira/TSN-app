/**
 * PESQUISA WEB COM GROUNDING (Gemini + Google Search) — motor ÚNICO de busca de mercado.
 *
 * Estava embutido no `gerar-analise.js` desde 30/07, quando o mercadológico migrou do Claude
 * web_search para cá. O ÍNDICE ficou para trás no Claude e o preço disso apareceu em 06/08:
 * a pesquisa de "casa" em Santana de Parnaíba/Jardim Paula **abortou nas duas tentativas
 * (200s)** e o cliente recebeu "a pesquisa de mercado falhou" — enquanto o mercadológico, no
 * mesmo tipo de trabalho, conclui em 60–90s. Além do tempo, o Claude web_search custa ~4x
 * (US$ 0,54 contra US$ 0,14 por geração): o resultado da busca volta para o contexto e são
 * ~114 mil tokens de ENTRADA por chamada.
 *
 * Aqui a função vira compartilhada, e o Claude segue como FALLBACK em ambos — quem já rodava
 * assim não muda de comportamento, e o Índice ganha o caminho rápido.
 *
 * Devolve TEXTO cru + diagnóstico: cada chamador aplica o próprio parser (o do relatório
 * recupera JSON truncado; o do Índice é mais simples), então o motor não precisa saber do
 * formato de ninguém.
 */
import { medirGemini } from './_uso.js';

const GEMINI_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

export const geminiDisponivel = () => !!GEMINI_KEY;

/**
 * @returns {{texto: string, custoMicro: number, diag: object}} em sucesso, ou {__falhou: true, __erroApi} em falha.
 * NUNCA lança: o chamador decide se cai no Claude.
 */
export async function groundingGemini({ prompt, sistema, timeoutMs, maxOutputTokens = 24000 }) {
  if (!GEMINI_KEY) return { __falhou: true, __erroApi: 'sem GEMINI_API_KEY' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(20000, timeoutMs || 60000));
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, signal: ctrl.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sistema }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          // thinkingBudget 0: sem isto o "pensamento" do 2.5-flash consome o teto de saída e o
          // JSON vem truncado (configuração validada no piloto A/B).
          generationConfig: { maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } },
        }) });
    if (!r.ok) { const b = await r.text().catch(() => ''); return { __falhou: true, __erroApi: `HTTP ${r.status}: ${b.slice(0, 120)}` }; }
    const data = await r.json();
    // O custo volta para o chamador acumular na medição por geração (custo_micro), além de
    // já ficar registrado no painel por provedor/dia.
    let custoMicro = 0;
    try { custoMicro = (await medirGemini(GEMINI_MODEL, data, 'grounding')) || 0; } catch { /* mede best-effort */ }
    const texto = (data?.candidates?.[0]?.content?.parts || []).map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    return {
      texto, custoMicro,
      diag: { motor: 'gemini', stop: data?.candidates?.[0]?.finishReason || null, textoLen: texto.length, out_tokens: data?.usageMetadata?.candidatesTokenCount || 0 },
    };
  } catch (e) {
    return { __falhou: true, __erroApi: `gemini exc: ${String(e?.message || e).slice(0, 120)}` };
  } finally { clearTimeout(timer); }
}
