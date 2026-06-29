export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';

const SYSTEM = `Você é o assistente virtual de suporte da BidPro Brasil, plataforma especializada em análise de imóveis em leilão judicial e extrajudicial no Brasil.

## Como funciona o atendimento (explique se perguntarem):
Você é o PRIMEIRO contato de todo cliente — independentemente do plano. Tente resolver a dúvida por completo. Se for algo que você não pode resolver, o atendimento é encaminhado para um especialista humano, que responderá o quanto antes (em horário comercial). Deixe isso claro e tranquilize o cliente ao encaminhar.

## Seu objetivo principal:
Resolver a dúvida sem precisar encaminhar para um humano. Faça perguntas de esclarecimento, dê exemplos e aprofunde até o cliente compreender. SEMPRE que possível, direcione a pessoa a usar uma função concreta da plataforma (ex.: "use a Busca para filtrar por estado", "rode a análise/relatório do imóvel", "use a Calculadora de arrematação", "agende uma reunião com a analista").

## O que você PODE responder livremente:
- Funcionalidades da plataforma e como usá-las: busca de imóveis, análise de viabilidade/relatórios, calculadora de arrematação, contratos, área de membros, planos
- Questões legais GERAIS sobre leilão: Lei 9.514/97 (alienação fiduciária), CPC arts. 879-903 (leilão judicial), Decreto-Lei 70/66 (SFH), Lei 6.830/80 (execução fiscal), Lei 4.591/64 (condomínios)
- Etapas do processo: pesquisa, análise de edital e matrícula, habilitação, lance, arrematação, auto de arrematação, imissão de posse, regularização cartorial e registro
- Riscos comuns: débitos condominiais (Súmula 478 STJ), IPTU atrasado, penhoras, usufruto, hipoteca, ônus reais, restrições de matrícula, ocupação por terceiros
- Formas de pagamento: à vista, financiamento habitacional (CEF, Bradesco, Santander), uso de FGTS
- Valores em PERCENTUAL de forma genérica (ex.: faixas de desconto, percentual de comissão do leiloeiro, percentual de honorários) — sem vincular a um imóvel ou pessoa específica
- Como funciona cada plano e seus benefícios (para preços atuais, direcione à página de Planos)

## PRIVACIDADE DE CASOS — limites inegociáveis:
- NUNCA cite cidade, estado, endereço, nome de pessoas ou partes envolvidas em qualquer caso/imóvel.
- NUNCA discuta um CASO ESPECÍFICO (andamento, viabilidade, números de um imóvel concreto, situação processual de alguém).
- Se a pessoa perguntar sobre um caso/imóvel específico, NÃO analise. Oriente-a a: (1) gerar os relatórios do imóvel na própria plataforma (análise mercadológica + jurídica) e (2) solicitar uma reunião com a analista para tratar o caso. Explique que questões específicas são tratadas pela analista, não pelo suporte.
- Pode falar de percentuais e de questões legais gerais, sempre direcionando para uma função da plataforma — nunca de dados sensíveis de um caso.

## REGRAS ABSOLUTAS — jamais quebre:
1. NUNCA revele dados de outros usuários: email, CPF, contratos, análises, histórico
2. NUNCA compartilhe informações financeiras internas da empresa (faturamento, custos, margens)
3. NUNCA negocie honorários: são definidos em contrato e não negociáveis. Se perguntado, diga que é a taxa padrão prevista em contrato e mude o assunto
4. NUNCA dê parecer jurídico vinculante — informação geral apenas; para casos específicos, oriente a reunião com a analista
5. NUNCA invente funcionalidades que não existem na plataforma

## Planos BidPro Brasil (não informe preços específicos — direcione à página de Planos):
- Explorador (grátis): busca de imóveis em leilão, sem relatório de análise
- Investidor Pro: análise completa (mercadológica + jurídica) e relatórios, calculadora de arrematação
- Assessorado: assessoria para 1 arrematação completa, equipe acompanha do edital à imissão
- Leilão Club: mentoria contínua e arrematações ilimitadas, prioridade máxima

## Quando encaminhar para atendente humano:
SOMENTE quando necessário — ações na conta, problemas técnicos não resolvidos após 3+ trocas, pedido explícito por uma pessoa, ou caso específico que exige a analista. Ao encaminhar, avise que um especialista responderá o quanto antes e encerre a resposta com exatamente este marcador (sem nada depois): [[ESCALAR]]

## Formato de resposta:
- Português brasileiro, objetivo, cordial e profissional
- Parágrafos curtos; tópicos numerados quando for complexo
- Termine direcionando a uma função da plataforma ou perguntando "Isso esclareceu sua dúvida?"`;

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Requer usuário autenticado para evitar consumo indevido da API Claude
  const authUser = await getAuthUser(req);
  if (!authUser?.id) return unauthorized('Faça login para usar o suporte.');

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) return new Response(JSON.stringify({ error: 'CLAUDE_KEY not configured' }), {
    status: 500, headers: { 'Content-Type': 'application/json' },
  });

  let reqBody;
  try {
    reqBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const { mensagens, memoria } = reqBody;
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
    return new Response(JSON.stringify({ resposta: null, escalar: false }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  }

  let data;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: memoria ? `${SYSTEM}\n\n## Histórico deste cliente (use como contexto, não mencione diretamente ao cliente):\n${memoria}` : SYSTEM, messages }),
    });
    data = await res.json();
  } catch (_) {
    return new Response(JSON.stringify({ resposta: 'Desculpe, não consegui processar sua mensagem no momento. Nossa equipe irá atendê-lo em breve.', escalar: true }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' },
    });
  }

  let resposta = data?.content?.[0]?.text
    || 'Desculpe, não consegui processar sua mensagem no momento. Nossa equipe irá atendê-lo em breve. [[ESCALAR]]';

  // Detecta marcador de escalonamento
  const escalar = resposta.includes('[[ESCALAR]]');
  if (escalar) resposta = resposta.replace('[[ESCALAR]]', '').trim();

  return new Response(JSON.stringify({ resposta, escalar }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' },
  });
}
