// BUSCA DE MERCADO NO CLAUDE QUE PROVA QUE BUSCOU (28/09) — usada pelo Índice ao vivo
// (indice-mercado.js) e pelo reforço proativo (indice-reforco-cron.js).
//
// Por que existe: com o Gemini fora (403 em 08/09, depois 402 sem crédito), toda pesquisa de
// mercado caiu no Claude Haiku, e no Índice ele respondia DE MEMÓRIA — `end_turn` com ~400
// tokens e `server_tool_use` ausente. A 1ª tentativa vinha sem JSON e a compacta devolvia listas
// vazias em 6 s, que a tela mostrava como "não encontramos anúncios": ausência de busca entregue
// como mercado vazio. Zero amostras novas de 11/09 a 28/09.
//
// Contrato: devolve `{ data, texto, buscas, cobrou, pausas }`. Quem chama decide o que aceitar,
// mas a regra da casa é uma só — **`buscas === 0` nunca é resultado**, é falha.
//   · `pause_turn` é continuado (a busca server-side pausa em pesquisas longas);
//   · resposta sem nenhuma busca recebe UMA cobrança na mesma conversa;
//   · o relógio é um prazo único: nenhuma volta extra começa sem 15 s de folga.
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude } from './_uso.js';
import { extractText } from './_indice-core.js';

const COBRANCA = 'Você respondeu sem pesquisar. Use AGORA a ferramenta web_search nos portais (ZAP, VivaReal, OLX, QuintoAndar, Imovelweb) e em imobiliárias locais, e responda SOMENTE com o JSON pedido, só com anúncios reais encontrados.';
export const EXIGE_BUSCA = 'Use a ferramenta web_search para pesquisar os anúncios ANTES de responder — nunca responda de memória. Ao final, retorne apenas JSON válido.';

export async function buscarComProva({ degrau, chave, system, prompt, webUses, timeoutMs, maxTokens = 12000, aoCusto = null, cobranca = COBRANCA }) {
  const headers = { 'x-api-key': chave, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const prazo = Date.now() + timeoutMs;
  const messages = [{ role: 'user', content: prompt }];
  let data = null, buscas = 0, pausas = 0, cobrou = false;
  for (;;) {
    const resta = prazo - Date.now();
    if (data && resta < 15000) break; // sem tempo para mais uma volta: avalia o que já veio
    // SEM retry interno: ele multiplica o relógio e estoura o maxDuration antes de a 2ª tentativa
    // (compacta) existir. Quem faz o papel de retry é o chamador.
    const r = await anthropicFetch({
      method: 'POST', headers,
      body: JSON.stringify({ model: degrau.model, max_tokens: maxTokens, tools: [degrau.ferramenta(webUses)], system, messages }),
    }, { retries: 0, timeoutMs: Math.max(10000, resta), noFallback: true });
    if (!r.ok) throw new Error(`anthropic_http_${r.status}`);
    data = await r.json();
    if (aoCusto) { try { aoCusto(custoRespostaClaude(degrau.model, data?.usage)); } catch { /* medição best-effort */ } }
    buscas += Number(data?.usage?.server_tool_use?.web_search_requests) || 0;
    if (data?.stop_reason === 'pause_turn' && Array.isArray(data.content) && pausas < 3) {
      messages.push({ role: 'assistant', content: data.content }); pausas++; continue;
    }
    if (!buscas && !cobrou && Array.isArray(data?.content) && data.content.length) {
      cobrou = true;
      messages.push({ role: 'assistant', content: data.content });
      messages.push({ role: 'user', content: cobranca });
      continue;
    }
    break;
  }
  return { data, texto: extractText(data), buscas, cobrou, pausas };
}
