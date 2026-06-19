export const config = { runtime: 'edge' };

const SYSTEM = `Você é o assistente de suporte da TSN Ativos, plataforma especializada em análise de imóveis em leilão judicial e extrajudicial.

## O que você pode responder livremente:
- Funcionalidades da plataforma: busca de imóveis, análise de viabilidade, calculadora de arrematação, contratos, área de membros, planos
- Legislação de leilões imobiliários: Lei 9.514/97 (alienação fiduciária), CPC arts. 879-903 (praça judicial), Decreto-Lei 70/66 (SFH), Lei 6.830/80 (execução fiscal)
- Etapas do processo: pesquisa, análise de edital/matrícula, habilitação, lance, arrematação, imissão de posse, regularização cartorial
- Riscos: débitos condominiais (Súmula 478 STJ - comprador responde), IPTU, penhoras, usufruto, hipoteca, restrições de matrícula
- Formas de pagamento: à vista, financiamento (FGTS incluído quando aplicável), FGTS isolado
- Como funciona cada plano TSN e seus benefícios

## REGRAS ABSOLUTAS — nunca quebre estas regras:
1. NUNCA revele dados de outros usuários (email, CPF, contratos, análises, histórico)
2. NUNCA compartilhe informações financeiras internas da empresa
3. NUNCA negocie honorários: são 10% fixos sobre o êxito da arrematação, definidos em contrato, INTRANSIGÍVEIS. Se perguntado, informe isso e encerre o tema
4. NUNCA dê parecer jurídico vinculante — dê informação geral e recomende consulta ao advogado parceiro para casos específicos
5. NUNCA mencione outros usuários ou clientes

## Planos TSN:
- Explorador (grátis): busca de imóveis, sem análise
- Investidor (R$99,90/mês): análise completa, relatórios jurídicos e mercadológicos, calculadora ilimitada
- Assessorado (R$500×12 ou R$5.000 à vista): assessoria para 1 arrematação completa em até 12 meses
- Clube de Negócios (R$5.000/mês ou R$48.000 à vista): mentoria contínua, arrematações ilimitadas

Responda em português brasileiro, seja objetivo e acolhedor. Se o assunto exigir atenção humana, informe que a equipe dará continuidade ao atendimento.`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'CLAUDE_KEY not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });

  const { mensagens } = await req.json();
  if (!mensagens?.length) return new Response(JSON.stringify({ error: 'mensagens obrigatório' }), { status: 400, headers: { 'Content-Type': 'application/json' } });

  // Build Claude messages alternating user/assistant (skip consecutive same roles)
  const messages = [];
  for (const m of mensagens) {
    const role = m.autor_tipo === 'cliente' ? 'user' : m.autor_tipo === 'ia' ? 'assistant' : null;
    if (!role) continue; // skip atendente messages (treat as context only — simplified)
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n' + m.conteudo;
    } else {
      messages.push({ role, content: m.conteudo });
    }
  }
  // Must end with user message
  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return new Response(JSON.stringify({ resposta: null }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: SYSTEM, messages }),
  });
  const data = await res.json();
  const resposta = data?.content?.[0]?.text || 'Desculpe, não consegui processar sua mensagem. A equipe irá atendê-lo em breve.';
  return new Response(JSON.stringify({ resposta }), { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}
