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
import { anthropicFetch } from './_claude.js';

const ROLES_STAFF = ['admin', 'consultor', 'analista', 'advogado'];

const FORO_PADRAO = process.env.CONTRATO_FORO || 'Comarca de Feira de Santana, Estado da Bahia';
const MODEL = process.env.CONTRATO_IA_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `Você é um advogado especialista em contratos do direito brasileiro com 20 anos de experiência, redigindo para MÁXIMO RESGUARDO JURÍDICO da CONTRATANTE (a empresa emissora) sem tornar o contrato abusivo ou nulo.
Ao gerar um contrato você SEMPRE:
1. Usa linguagem técnico-jurídica clara e precisa — cada cláusula tem propósito concreto e é executável.
2. Fundamenta as cláusulas relevantes na legislação (ex.: Art. 104, 421 e 422 do Código Civil; Art. 6° do CDC quando houver relação de consumo; Lei 13.709/2018 - LGPD; Lei 12.846/2013 - Anticorrupção).
3. Inclui cláusula de LGPD (Lei 13.709/2018): base legal do tratamento, finalidade, compartilhamento, direitos do titular, segurança e retenção dos dados pessoais.
4. Inclui cláusula de conformidade ANTICORRUPÇÃO (Lei 12.846/2013 e Decreto 11.129/2022): vedação a atos lesivos, compliance e rescisão por descumprimento.
5. Inclui cláusulas de proteção robusta: PRAZO E VIGÊNCIA; RESCISÃO (motivada e imotivada) com aviso prévio; MULTA/PENALIDADE por inadimplemento; CONFIDENCIALIDADE/SIGILO; CASO FORTUITO E FORÇA MAIOR (Art. 393 CC); CESSÃO E SUBCONTRATAÇÃO; NOTIFICAÇÕES; NÃO NOVAÇÃO E INDEPENDÊNCIA DAS CLÁUSULAS; INTEGRALIDADE DO ACORDO.
6. Redige com equilíbrio (Art. 422 CC - boa-fé) — protege a CONTRATANTE mas mantém obrigações recíprocas, para não ser anulável por abusividade.
7. Cláusula de FORO: elege OBRIGATORIAMENTE o foro da ${FORO_PADRAO}, com renúncia a qualquer outro por mais privilegiado que seja. Se as partes/objeto exigirem outro foro por lei imperativa (ex.: consumidor - domicílio do consumidor), aponte a ressalva.
8. Estrutura o documento nesta ordem: QUALIFICAÇÃO DAS PARTES, OBJETO, OBRIGAÇÕES DE CADA PARTE, VALOR E FORMA DE PAGAMENTO (se aplicável), PRAZO E VIGÊNCIA, RESCISÃO E MULTA, CONFIDENCIALIDADE, LGPD, ANTICORRUPÇÃO, FORÇA MAIOR, DISPOSIÇÕES GERAIS, FORO, e fecho com data e campos de assinatura.
9. Usa numeração sequencial de cláusulas (1., 2., 2.1, 2.2...).
10. Retorna APENAS o texto do contrato, sem explicações nem markdown — documento pronto para assinar.
11. Inclui campos para preenchimento: [NOME COMPLETO], [CPF/CNPJ], [ENDEREÇO], [DATA], [VALOR], etc.
12. Rodapé: "Assinatura eletrônica qualificada/avançada válida nos termos da MP 2.200-2/2001 e da Lei 14.063/2020, com registro de IP, data/hora e hash de integridade do documento."`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const ip = getIP(req);
  const rl = await checkRateLimit(`gerar-contrato-ia:${ip}`, 5, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  const role = await getUserRoleById(user.id);
  if (!ROLES_STAFF.includes(role)) return forbidden('Apenas staff pode gerar contratos');

  const CLAUDE_KEY = process.env.CLAUDE_KEY;
  if (!CLAUDE_KEY) return new Response(JSON.stringify({ error: 'CLAUDE_KEY não configurada' }), { status: 500 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 }); }

  // Aceita tanto os nomes novos (tipoContrato/partesAdicionais) quanto os que o
  // front-end de fato envia (tipo/partes). `foro` opcional sobrepõe o padrão.
  // `documentos` = texto já extraído de anexos (PDF/imagem) para preencher o contrato.
  const {
    descricao,
    tipoContrato, tipo,
    partesAdicionais, partes,
    foro,
    documentos,
  } = body;
  const tipoFinal = tipoContrato || tipo;
  const partesFinal = partesAdicionais || partes;
  const foroFinal = (typeof foro === 'string' && foro.trim()) ? foro.trim() : FORO_PADRAO;

  if (!descricao || descricao.trim().length < 20) {
    return new Response(JSON.stringify({ error: 'Descreva o contrato com pelo menos 20 caracteres' }), { status: 400 });
  }

  const userMessage = `Gere um contrato de ${tipoFinal || 'prestação de serviços'} com base na seguinte descrição em texto livre:

${descricao.slice(0, 4000)}

${partesFinal ? `Informações adicionais sobre as partes:\n${String(partesFinal).slice(0, 800)}\n` : ''}${documentos ? `Informações extraídas de documentos anexados (use para preencher qualificações, valores, datas e objeto):\n${String(documentos).slice(0, 6000)}\n` : ''}
FORO OBRIGATÓRIO deste contrato: ${foroFinal} (eleja este foro com renúncia a qualquer outro, salvo ressalva legal imperativa).

Gere o contrato completo e pronto para uso.`;

  try {
    const r = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    const data = await r.json();
    if (!r.ok) throw new Error(data.error?.message || 'Erro Claude');
    const contrato = data.content?.[0]?.text?.trim();
    if (!contrato) throw new Error('Resposta vazia');

    await auditLog({ acao: 'contrato_gerado_ia', user_id: user.id, ip, detalhes: { tipo: tipoFinal, foro: foroFinal, comDocs: !!documentos }, sucesso: true });

    return new Response(JSON.stringify({ ok: true, contrato }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[gerar-contrato-ia]', e.message);
    return new Response(JSON.stringify({ error: 'Erro ao gerar contrato' }), { status: 500 });
  }
}
