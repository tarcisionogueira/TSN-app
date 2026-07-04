export const config = { runtime: 'edge' };
import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { iaGeminiPrimary } from './_claude.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = checkRateLimit(`cnj-chat:${ip}`, 20, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  let reqBody;
  try {
    reqBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const { mensagem, contexto, historico = [] } = reqBody;

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'CLAUDE_KEY não configurada' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const systemPrompt = `Você é um especialista em direito imobiliário e análise de processos judiciais brasileiros com foco em leilões de imóveis.
Analise os dados dos processos do CNJ DataJud fornecidos no contexto e responda às perguntas do usuário de forma objetiva e técnica.
Foque em: riscos à arrematação, penhoras, gravames, capacidade de imissão de posse, e recomendações práticas.
Seja direto e use linguagem acessível mas precisa. Não mencione IA ou sistemas internos.`;

  const contextStr = JSON.stringify(contexto, null, 2).slice(0, 8000);

  const messages = [
    ...historico.map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: `Contexto dos processos consultados:\n\`\`\`json\n${contextStr}\n\`\`\`\n\nPergunta: ${mensagem}` },
  ];

  try {
    const r = await iaGeminiPrimary({
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Erro na API');
    return new Response(JSON.stringify({ resposta: data.content[0].text }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('cnj-chat erro:', e.message);
    return new Response(JSON.stringify({ error: 'Erro interno' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
