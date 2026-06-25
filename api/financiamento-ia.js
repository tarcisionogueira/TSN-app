export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const MODELOS_PERMITIDOS = ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'];

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = checkRateLimit(`financiamento-ia:${ip}`, 5, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const CLAUDE_KEY = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
  if (!CLAUDE_KEY) {
    return new Response(JSON.stringify({ error: 'Serviço de IA não configurado' }), { status: 500 });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 });
  }

  const editalTexto = String(body.editalTexto || '').slice(0, 8000);
  if (!editalTexto.trim()) {
    return new Response(JSON.stringify({ error: 'editalTexto obrigatório' }), { status: 400 });
  }

  const system = `Você é um especialista em imóveis de leilão brasileiro.
Analise o texto do edital e extraia os parâmetros de financiamento/pagamento.
Responda SOMENTE com um JSON válido, sem markdown, sem explicações.
Campos a extrair:
- valor_imovel: número (valor de avaliação ou lance mínimo em R$, sem símbolos)
- valor_sinal: número (valor do sinal/entrada em R$) ou null
- sinal_percentual: número (% do sinal, ex: 30 para 30%) ou null
- num_parcelas: inteiro (número de parcelas do financiamento) ou null
- valor_parcela: número (valor de cada parcela em R$) ou null
- taxa_juros_anual: número (taxa anual em %, ex: 10.5) ou null
- indice_correcao: string (um de: "SELIC", "IPCA", "IGPM", "prefixado", "TR") ou null
- data_sinal: string ISO "YYYY-MM-DD" (data de vencimento do sinal) ou null
- data_primeira_parcela: string ISO "YYYY-MM-DD" ou null
- notas: string com observações relevantes extraídas (máx 300 chars) ou null
Se algum campo não estiver no edital, retorne null para esse campo.`;

  const messages = [
    { role: 'user', content: `Texto do edital:\n\n${editalTexto}` },
  ];

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system,
      messages,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error('[financiamento-ia] Claude error:', err.slice(0, 300));
    return new Response(JSON.stringify({ error: 'Erro na análise de IA' }), { status: 502 });
  }

  const aiData = await resp.json();
  const texto = aiData?.content?.[0]?.text || '{}';

  let params;
  try {
    params = JSON.parse(texto);
  } catch {
    return new Response(JSON.stringify({ error: 'IA retornou resposta inválida', raw: texto.slice(0, 200) }), { status: 502 });
  }

  // Sanitiza e normaliza campos numéricos
  const resultado = {
    valor_imovel:          Number(params.valor_imovel) || null,
    valor_sinal:           Number(params.valor_sinal) || null,
    sinal_percentual:      Number(params.sinal_percentual) || null,
    num_parcelas:          Number(params.num_parcelas) ? Math.floor(Number(params.num_parcelas)) : null,
    valor_parcela:         Number(params.valor_parcela) || null,
    taxa_juros_anual:      Number(params.taxa_juros_anual) || null,
    indice_correcao:       ['SELIC','IPCA','IGPM','prefixado','TR'].includes(params.indice_correcao) ? params.indice_correcao : null,
    data_sinal:            /^\d{4}-\d{2}-\d{2}$/.test(params.data_sinal || '') ? params.data_sinal : null,
    data_primeira_parcela: /^\d{4}-\d{2}-\d{2}$/.test(params.data_primeira_parcela || '') ? params.data_primeira_parcela : null,
    notas:                 params.notas ? String(params.notas).slice(0, 300) : null,
    origem_preenchimento:  'ia_edital',
  };

  return new Response(JSON.stringify(resultado), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
