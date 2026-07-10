export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { anthropicFetch } from './_claude.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  return r.json();
}

// Minimização de PII: mascara CPF e telefone no texto livre das conversas antes de
// mandar para a IA (o admin ainda vê nome/status pelos campos estruturados).
const redigirPII = (t) => String(t || '')
  .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[CPF]')
  .replace(/\b(?:\+?55\s?)?\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, '[TEL]');

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'CLAUDE_KEY não configurada' }), { status: 500 });

  let reqBody;
  try {
    reqBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const reqBodyMensagem = String(reqBody.mensagem || '').slice(0, 4000); // limite anti-abuso/prompt-injection
  const mensagem = reqBodyMensagem;
  const historico = (Array.isArray(reqBody.historico) ? reqBody.historico : []).slice(-20); // no máx. 20 turnos
  const { contexto_cnj, filtro_chamados, gerar_relatorio } = reqBody;

  const isUUID = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

  let contextoBlocos = [];

  // 1. Contexto CNJ se houver busca ativa
  if (contexto_cnj) {
    contextoBlocos.push(`## Processos CNJ encontrados\n\`\`\`json\n${JSON.stringify(contexto_cnj, null, 2).slice(0, 6000)}\n\`\`\``);
  }

  // 2. Conversas de usuários — carrega com filtros
  if (filtro_chamados) {
    const { usuario_id, chamado_id } = filtro_chamados;
    // Coerção a inteiro no intervalo [1,20] — evita string com caracteres extras
    // (ex.: "20&order=role.desc") virar NaN ou parâmetro injetado na URL PostgREST.
    const ultimos_n = Math.min(Math.max(1, parseInt(filtro_chamados.ultimos_n, 10) || 5), 20);
    let q;
    if (chamado_id && isUUID(chamado_id)) {
      // Conversa específica
      const msgs = await sbGet(`chamados_mensagens?chamado_id=eq.${encodeURIComponent(chamado_id)}&order=criado_em.asc&select=autor_tipo,autor_nome,conteudo,criado_em`);
      const chamado = await sbGet(`chamados?id=eq.${encodeURIComponent(chamado_id)}&select=user_email,user_nome,titulo,status,criado_em`);
      contextoBlocos.push(`## Conversa #${chamado_id.slice(0,8).toUpperCase()}\nCliente: ${chamado[0]?.user_nome || chamado[0]?.user_email || '?'}\nStatus: ${chamado[0]?.status}\n\n${msgs.map(m => `[${new Date(m.criado_em).toLocaleString('pt-BR')}] ${m.autor_tipo === 'cliente' ? 'Cliente' : 'Assistente'}: ${redigirPII(m.conteudo)}`).join('\n')}`);
    } else if (usuario_id && isUUID(usuario_id)) {
      // Todos os chamados de um usuário
      const chamados = await sbGet(`chamados?user_id=eq.${encodeURIComponent(usuario_id)}&order=criado_em.desc&limit=10&select=id,titulo,status,criado_em,user_nome`);
      const detalhes = await Promise.all(chamados.slice(0, 3).map(async c => {
        const msgs = await sbGet(`chamados_mensagens?chamado_id=eq.${c.id}&order=criado_em.asc&select=autor_tipo,conteudo&limit=20`);
        return `### Chamado "${c.titulo}" (${c.status})\n${msgs.map(m => `${m.autor_tipo === 'cliente' ? 'Cliente' : 'Assistente'}: ${redigirPII(m.conteudo)}`).join('\n')}`;
      }));
      contextoBlocos.push(`## Histórico do usuário ${chamados[0]?.user_nome || usuario_id}\n${detalhes.join('\n\n')}`);
    } else {
      // Últimos N chamados geral
      const chamados = await sbGet(`chamados?order=criado_em.desc&limit=${ultimos_n}&select=id,titulo,status,user_nome,user_email,criado_em`);
      contextoBlocos.push(`## Últimos ${chamados.length} atendimentos\n${chamados.map(c => `- #${c.id.slice(0,8).toUpperCase()} | ${c.user_nome || c.user_email} | "${c.titulo}" | ${c.status} | ${new Date(c.criado_em).toLocaleDateString('pt-BR')}`).join('\n')}`);
    }
  }

  const contextoStr = contextoBlocos.join('\n\n');

  const system = `Você é o assistente de inteligência administrativa da BidPro Brasil, plataforma de análise de imóveis em leilão.

Você tem acesso privilegiado a:
- Processos judiciais consultados no CNJ DataJud
- Histórico de atendimentos e conversas de todos os usuários da plataforma
- Dados das integrações (PGFN, Receita Federal, etc.) quando disponíveis

Seu papel é responder perguntas do administrador sobre:
- Situação jurídica de processos e partes
- Padrões nas conversas de suporte (problemas recorrentes, dúvidas frequentes)
- Insights sobre usuários específicos
- Geração de relatórios gerenciais

${gerar_relatorio ? 'O administrador solicitou um RELATÓRIO FORMAL. Estruture a resposta com: título, data, sumário executivo, dados detalhados, conclusões e recomendações.' : ''}

Seja preciso, direto e use os dados disponíveis. NUNCA invente dados que não estejam no contexto.`;

  const messages = [
    // Whitelist de role + content string truncado (evita injeção via histórico forjado).
    ...historico
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) })),
    { role: 'user', content: contextoStr ? `${contextoStr}\n\n---\nPergunta: ${mensagem}` : mensagem },
  ];

  const r = await anthropicFetch({
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 2048, system, messages }),
  });
  const data = await r.json();
  if (!r.ok) return new Response(JSON.stringify({ error: data.error?.message || 'Erro' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  return new Response(JSON.stringify({ resposta: data.content[0].text }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}
