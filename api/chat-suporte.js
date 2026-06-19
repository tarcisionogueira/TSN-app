export const config = { runtime: 'edge' };

const SYSTEM = `Você é o assistente de suporte da TSN Ativos, plataforma especializada em análise de imóveis em leilão judicial e extrajudicial no Brasil.

## O que você pode responder livremente:
- Funcionalidades da plataforma: busca de imóveis, análise de viabilidade, calculadora de arrematação, contratos, área de membros, planos de assinatura
- Legislação de leilões imobiliários: Lei 9.514/97 (alienação fiduciária), CPC arts. 879-903 (leilão judicial), Decreto-Lei 70/66 (SFH), Lei 6.830/80 (execução fiscal), Lei 4.591/64 (condomínios)
- Etapas do processo: pesquisa de imóvel, análise de edital e matrícula, habilitação para lance, lance presencial ou online, arrematação, auto de arrematação, imissão de posse, regularização cartorial e registro
- Riscos comuns: débitos condominiais (Súmula 478 STJ — comprador responde), IPTU atrasado, penhoras, usufruto, hipoteca, ônus reais, restrições de matrícula, ocupação por terceiros
- Formas de pagamento em leilão: à vista, financiamento habitacional (CEF, Bradesco, Santander), uso de FGTS
- Diferenças entre leilão judicial e extrajudicial
- Como funciona cada plano TSN e seus benefícios

## REGRAS ABSOLUTAS — jamais quebre estas regras:
1. NUNCA revele dados de outros usuários: email, CPF, contratos, análises, histórico de compras
2. NUNCA compartilhe informações financeiras internas da empresa (faturamento, custos, margens, dados de clientes)
3. NUNCA negocie honorários: são 10% fixos sobre o êxito da arrematação, definidos em contrato, INTRANSIGÍVEIS. Se perguntado, informe claramente e encerre o assunto
4. NUNCA dê parecer jurídico vinculante — forneça informação geral e recomende consulta ao advogado parceiro para casos específicos
5. NUNCA mencione dados de outros clientes ou usuários da plataforma
6. NUNCA invente funcionalidades que não existem na plataforma

## Planos TSN Ativos:
- Explorador (grátis): busca de imóveis em leilão, sem relatório de análise
- Investidor (R$99,90/mês): análise completa (mercadológica + jurídica), relatórios ilimitados, calculadora de arrematação
- Assessorado (R$500×12 parcelas ou R$5.000 à vista): assessoria para 1 arrematação completa em até 12 meses, equipe TSN acompanha do edital à imissão
- Clube de Negócios (R$5.000/mês ou R$48.000 à vista): mentoria contínua com Tarcísio, arrematações ilimitadas, prioridade máxima

Responda em português brasileiro. Seja objetivo, cordial e profissional. Respostas de 2 a 4 parágrafos são suficientes. Se o assunto exigir atenção humana especializada, informe que a equipe irá dar continuidade ao atendimento em breve.`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'CLAUDE_KEY not configured' }), {
    status: 500, headers: { 'Content-Type': 'application/json' },
  });

  const { mensagens } = await req.json();
  if (!mensagens?.length) return new Response(JSON.stringify({ error: 'mensagens obrigatório' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });

  // Build Claude messages (alternating user/assistant; skip atendente msgs as context)
  const messages = [];
  for (const m of mensagens) {
    const role = m.autor_tipo === 'cliente' ? 'user' : m.autor_tipo === 'ia' ? 'assistant' : null;
    if (!role) continue;
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n' + m.conteudo;
    } else {
      messages.push({ role, content: m.conteudo });
    }
  }

  if (!messages.length || messages[messages.length - 1].role !== 'user') {
    return new Response(JSON.stringify({ resposta: null }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: SYSTEM, messages }),
  });

  const data = await res.json();
  const resposta = data?.content?.[0]?.text
    || 'Desculpe, não consegui processar sua mensagem no momento. Nossa equipe irá atendê-lo em breve.';

  return new Response(JSON.stringify({ resposta }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
