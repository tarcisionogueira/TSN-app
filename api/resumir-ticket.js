export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const apiKey = process.env.CLAUDE_KEY;
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY;
  if (!apiKey || !supabaseUrl || !supabaseKey) {
    return new Response(JSON.stringify({ error: 'env vars faltando' }), { status: 500 });
  }

  const { ticketId, userId } = await req.json();
  if (!ticketId || !userId) return new Response(JSON.stringify({ error: 'ticketId e userId obrigatórios' }), { status: 400 });

  // Busca mensagens do ticket
  const msgsRes = await fetch(`${supabaseUrl}/rest/v1/chamados_mensagens?chamado_id=eq.${ticketId}&order=criado_em.asc&select=autor_tipo,conteudo`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  const msgs = await msgsRes.json();
  if (!msgs?.length) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  const conversa = msgs.map(m => `${m.autor_tipo === 'cliente' ? 'Cliente' : 'Assistente'}: ${m.conteudo}`).join('\n');

  // Busca memória atual do usuário
  const perfilRes = await fetch(`${supabaseUrl}/rest/v1/perfis?id=eq.${userId}&select=memoria_ia`, {
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
  });
  const [perfil] = await perfilRes.json();
  const memoriaAtual = perfil?.memoria_ia || '';

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Você é um sistema de memória. Dado o histórico de atendimento abaixo e a memória prévia do usuário, gere um resumo conciso (máx 200 palavras) dos interesses, dúvidas recorrentes e contexto relevante deste cliente para futuras interações.

MEMÓRIA PRÉVIA:
${memoriaAtual || '(nenhuma)'}

CONVERSA ATUAL:
${conversa.slice(0, 3000)}

Responda apenas com o resumo atualizado, em português, sem preâmbulo.`,
      }],
    }),
  });
  const claudeData = await claudeRes.json();
  const novaMemoria = claudeData?.content?.[0]?.text?.trim();
  if (!novaMemoria) return new Response(JSON.stringify({ ok: true }), { status: 200 });

  await fetch(`${supabaseUrl}/rest/v1/perfis?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ memoria_ia: novaMemoria }),
  });

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
