/**
 * Gera contrato jurídico com IA (Claude) com base na descrição fornecida.
 * Inclui: base legal, LGPD, anticorrupção, cláusulas equilibradas para ambas as partes.
 *
 * Env vars: CLAUDE_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const ROLES_STAFF = ['admin', 'consultor', 'analista', 'advogado'];

const SYSTEM_PROMPT = `Você é um advogado especialista em contratos do direito brasileiro com 20 anos de experiência.
Ao gerar um contrato você SEMPRE:
1. Usa linguagem técnico-jurídica clara, sem excessos — cada cláusula tem um propósito concreto.
2. Indica a legislação de base de cada cláusula relevante (ex: Art. 104 CC, Art. 6° CDC, Lei 13.709/2018 - LGPD).
3. Inclui cláusula de LGPD (Lei 13.709/2018) sobre coleta, uso e proteção de dados pessoais.
4. Inclui cláusula de conformidade anticorrupção (Lei 12.846/2013 - Lei Anticorrupção).
5. Redige defesa equilibrada para ambas as partes — sem favorecimento unilateral.
6. Estrutura o documento com: PARTES, OBJETO, OBRIGAÇÕES DE CADA PARTE, VALOR E PAGAMENTO (se aplicável), PRAZO E RESCISÃO, LGPD, ANTICORRUPÇÃO, DISPOSIÇÕES GERAIS, FORO.
7. Usa numeração sequencial de cláusulas (1., 2., 2.1, 2.2...).
8. Retorna APENAS o texto do contrato, sem explicações, sem markdown extra — apenas o documento pronto para assinar.
9. Inclui espaços para preenchimento de dados das partes: [NOME COMPLETO], [CPF/CNPJ], [ENDEREÇO], [DATA], etc.
10. Indica no rodapé: "Assinatura eletrônica válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020."`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = checkRateLimit(`gerar-contrato-ia:${ip}`, 5, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  const role = await getUserRoleById(user.id);
  if (!ROLES_STAFF.includes(role)) return forbidden('Apenas staff pode gerar contratos');

  const CLAUDE_KEY = process.env.CLAUDE_KEY;
  if (!CLAUDE_KEY) return new Response(JSON.stringify({ error: 'CLAUDE_KEY não configurada' }), { status: 500 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 }); }

  const { descricao, tipoContrato, partesAdicionais } = body;
  if (!descricao || descricao.trim().length < 20) {
    return new Response(JSON.stringify({ error: 'Descreva o contrato com pelo menos 20 caracteres' }), { status: 400 });
  }

  const userMessage = `Gere um contrato de ${tipoContrato || 'prestação de serviços'} com base na seguinte descrição:

${descricao.slice(0, 2000)}

${partesAdicionais ? `Informações adicionais sobre as partes:\n${partesAdicionais.slice(0, 500)}` : ''}

Gere o contrato completo e pronto para uso.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 3000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Erro Claude');
    const contrato = data.content?.[0]?.text?.trim();
    if (!contrato) throw new Error('Resposta vazia');

    await auditLog({ acao: 'contrato_gerado_ia', user_id: user.id, ip, detalhes: { tipo: tipoContrato }, sucesso: true });

    return new Response(JSON.stringify({ ok: true, contrato }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[gerar-contrato-ia]', e.message);
    return new Response(JSON.stringify({ error: 'Erro ao gerar contrato' }), { status: 500 });
  }
}
