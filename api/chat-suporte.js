export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { iaGeminiPrimary } from './_claude.js';
import { checkRateLimit, rateLimitedResponse } from './_rate-limit.js';
import { sb, lerLista, paraEquipe, catalogoAssessoria } from './_atendimento-canal.js';

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
- Assessorado: assessoria com a equipe acompanhando do edital à imissão; a quantidade de arrematações depende do pacote contratado
- Leilão Club: mentoria contínua e arrematações ilimitadas, prioridade máxima

## Quando o cliente relatar uma DIFICULDADE ou algo que "não funciona":
1. Acolha com empatia e, se ainda não houver um print anexado, PEÇA gentilmente um print (captura de tela) do que está acontecendo — explique que ajuda a entender rápido ("se puder, me manda um print da tela — é só apertar Ctrl+V aqui que ele cola"). Não peça print de novo se o cliente já anexou uma imagem.
2. Classifique a dificuldade:
   - É uma FALHA/BUG da plataforma (algo quebrado, erro, botão que não responde, tela que não carrega, resultado errado)? → registre para correção encerrando com o marcador [[BUG]] (além de tranquilizar o cliente de que a equipe vai corrigir). Um humano será acionado.
   - É NECESSIDADE DE ORIENTAÇÃO (a pessoa não sabe onde clicar/como usar)? → ORIENTE você mesmo, passo a passo, de forma amigável, até resolver. Não escale se você consegue orientar.

## Quando encaminhar para atendente humano:
SOMENTE quando necessário — ações na conta, FALHAS/BUGS, problemas técnicos não resolvidos após 3+ trocas, pedido explícito por uma pessoa, ou caso específico que exige a analista. Ao encaminhar, avise que um especialista responderá o quanto antes e encerre a resposta com exatamente este marcador (sem nada depois): [[ESCALAR]]  (para falhas de plataforma, use [[BUG]], que também aciona um humano).

## Formato de resposta:
- Português brasileiro, objetivo, cordial e profissional
- Parágrafos curtos; tópicos numerados quando for complexo
- Termine direcionando a uma função da plataforma ou perguntando "Isso esclareceu sua dúvida?"`;

// Ajuste por CANAL — o MESMO agente atende o chat do site E (futuramente) o
// WhatsApp. 'site' não altera nada (comportamento atual); 'whatsapp' só encurta.
const CANAL_HINT = {
  site: '\n\n## Canal: chat do site\nSe a pessoa pedir para falar com alguém ou com a equipe, NÃO tente resolver antes: diga em uma frase que vai passar para a equipe e encerre com [[ESCALAR]] — o sistema avisa a equipe e informa ao cliente o prazo (até 24 h em dia útil e até 48 h em fim de semana e feriado). Não prometa outro prazo. Se pedir o advogado do caso, diga que pode usar o botão com o nome dele logo abaixo da conversa, quando existir; não prometa advogado se não souber que existe. Você não recebe autorização de lance, não aprova nem recusa oportunidade e não dá parecer jurídico: se a pessoa disser algo como "pode dar lance de 300 mil", responda que isso não vale como autorização por aqui e encaminhe à equipe.',
  // WhatsApp = atendimento E venda (01/10, dono: "agente de IA para atender e campanha perpétua para
  // a IA vender e direcionar o cliente ao sistema"). Mesmo agente, mesmas regras de privacidade e de
  // preço do SYSTEM; aqui só o ROTEIRO de quem ainda não é cliente e o LINK RASTREADO — é o
  // utm_medium=ia que faz o cadastro aparecer em wa_funil() e em perfis.mkt_*.
  whatsapp: '\n\n## Canal: WhatsApp'
    + '\n- Mensagens CURTAS (2 a 4 frases), tom de conversa entre pessoas, UMA pergunta por vez. Nada de markdown, listas longas ou textão. Use o primeiro nome da pessoa.'
    + '\n- Se já é cliente (veja o histórico): atenda como suporte normal; se for explorador (grátis), conduza ao plano pago pelo mesmo roteiro abaixo.'
    + '\n\n## Quem ainda NÃO é cliente — você é um consultor que cria CONEXÃO antes de vender:'
    + '\n1. CONEXÃO: cumprimente pelo nome, mostre interesse genuíno e pergunte o que a trouxe até aqui. Se veio de anúncio, parta do assunto dele. Valide o que ela contar ("faz sentido", "muita gente começa assim") antes da próxima pergunta.'
    + '\n2. PERFIL — descubra, ao longo da conversa e sem cara de questionário: objetivo (investir para revender, alugar, morar, só aprender), experiência com leilão (nunca, já tentou, já arrematou), região de interesse, capital/forma de pagamento (à vista, financiamento, FGTS) e prazo. Não repita pergunta já respondida (veja "Perfil já levantado" no histórico).'
    + '\n3. OFERTA, nesta ordem de prioridade, ligando ao perfil:'
    + '\n   a) PLANO PAGO do sistema (prioridade): para quem quer investir/comprar — relatórios de mercado e jurídico de cada imóvel, filtros por região e forma de pagamento. Quem quer arrematar com a equipe fazendo tudo → Assessoria. Use os preços do CATÁLOGO abaixo, nunca outros.'
    + '\n   b) E-BOOK (entrada): para quem ainda está aprendendo, tem medo ou não decidiu — é barato e cada e-book inclui 1 mês do Investidor Pro, então ela já testa o sistema. Ofereça também como alternativa quando ela recusar o plano.'
    + '\n   c) CURSOS: só se o CATÁLOGO listar algum; se não listar, não ofereça (diga "em breve" apenas se perguntarem).'
    + '\n4. LEVAR AO SISTEMA com o link do CATÁLOGO correspondente (use os links EXATAMENTE como estão). Diga em 1 frase o que fazer lá. Sem decisão agora? Ofereça a conta grátis para ver os imóveis da região dela.'
    + '\n5. Assessoria, reunião com analista, negociação ou "quero falar com alguém" → diga que um consultor vai chamar por aqui e encerre com [[ESCALAR]].'
    + '\n- Objeções: "leilão é arriscado" → o risco está no que não se leu; os relatórios mostram dívidas, ocupação e o processo antes do lance. "Está caro" → compare com o custo de UM erro de arremate (dívida de condomínio, ação anulatória); se ainda assim, ofereça o e-book com 1 mês do sistema. "Não tenho dinheiro à vista" → há leilões com parcelamento, financiamento e FGTS, e o filtro mostra quais. "Vou pensar" → pergunte o que falta para decidir.'
    + '\n- NUNCA prometa lucro, desconto garantido ou resultado; não cite imóvel, caso ou cliente específico; não invente preço, produto ou condição fora do CATÁLOGO. Se a pessoa não quiser mais mensagens, agradeça e pare.'
    + '\n- Ao final de TODA resposta a quem não é cliente, acrescente numa linha separada o perfil levantado até agora, só com o que ela disse: [[PERFIL: objetivo=…; experiencia=…; regiao=…; capital=…; prazo=…; interesse=plano|assessoria|ebook|indefinido]] (campos desconhecidos = ?). Essa linha é interna e não chega à pessoa.',
};

// NÚCLEO REUTILIZÁVEL do agente (site + futuro WhatsApp). Recebe a conversa e a
// memória DO PRÓPRIO cliente; devolve { resposta, escalar }. Não faz auth nem HTTP,
// então o webhook do WhatsApp poderá chamá-lo igual ao chat do site. As regras de
// privacidade (nunca dado de terceiros, nunca caso específico) vivem no SYSTEM.
export async function responderSuporte({ mensagens, memoria, canal = 'site', apiKey, catalogo = '' }) {
  // Monta as mensagens (alterna user/assistant; ignora mensagens de atendente humano).
  const messages = [];
  for (const m of mensagens || []) {
    const role = m.autor_tipo === 'cliente' ? 'user' : m.autor_tipo === 'ia' ? 'assistant' : null;
    if (!role) continue;
    if (messages.length && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += '\n' + m.conteudo;
    } else {
      messages.push({ role, content: m.conteudo });
    }
  }
  if (!messages.length || messages[messages.length - 1].role !== 'user') return { resposta: null, escalar: false };

  const system = `${SYSTEM}${CANAL_HINT[canal] || ''}${catalogo ? `\n\n## CATÁLOGO (dados vivos do sistema — preços e links válidos agora; prevalece sobre "direcione à página de Planos")\n${catalogo}` : ''}${memoria ? `\n\n## Histórico deste cliente (use como contexto, não mencione diretamente ao cliente):\n${memoria}` : ''}`;
  const res = await iaGeminiPrimary({
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system, messages }),
  });
  const data = await res.json();
  const textoIa = data?.content?.[0]?.text;
  let resposta = textoIa
    || 'Não consegui processar sua mensagem no momento. Passei a sua conversa para a nossa equipe. [[ESCALAR]]';
  // [[BUG]] = falha de plataforma (registra p/ correção) — também aciona um humano (escalar).
  const bug = resposta.includes('[[BUG]]');
  const escalar = resposta.includes('[[ESCALAR]]') || bug;
  // Perfil do lead (canal WhatsApp): linha interna, nunca vai para a pessoa.
  const mPerfil = resposta.match(/\[\[PERFIL:([^\]]*)\]\]/);
  const perfilLead = mPerfil ? mPerfil[1].trim().slice(0, 400) : null;
  resposta = resposta.replace(/\[\[PERFIL:[^\]]*\]\]/g, '').replace('[[ESCALAR]]', '').replace('[[BUG]]', '').trim();
  return { resposta, escalar, bug, perfilLead, falhaIa: !textoIa };
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Requer usuário autenticado para evitar consumo indevido da API Claude
  const authUser = await getAuthUser(req);
  if (!authUser?.id) return unauthorized('Faça login para usar o suporte.');

  // Rate limit por usuário (bug bounty 03/09): todo outro endpoint que chama IA
  // (cnj-chat.js, claude.js) já limita antes de gastar tokens; este ficou de fora —
  // qualquer conta autenticada, inclusive o plano gratuito, podia chamar sem limite.
  const rl = await checkRateLimit(`chat-suporte:${authUser.id}`, 20, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

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
  const { mensagens, memoria, canal } = reqBody;
  if (!reqBody.chamado_id && !mensagens?.length) return new Response(JSON.stringify({ error: 'mensagens obrigatório' }), {
    status: 400, headers: { 'Content-Type': 'application/json' },
  });

  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

  // ESCALADA NO SERVIDOR (07/11, 1º passo da arena). Com `chamado_id`, o servidor grava a resposta da IA e,
  // se ela escalar (ou falhar), passa o chamado à equipe NESTA requisição: status `aguardando_atendente`,
  // aviso ao cliente com o prazo calculado e e-mail à equipe. Antes isso dependia do navegador do cliente
  // chamar a transferência depois — fechou a aba no meio, ninguém era avisado.
  if (reqBody.chamado_id) {
    try {
      return new Response(JSON.stringify(await responderNoChamado({ authUser, chamadoId: reqBody.chamado_id, memoria, apiKey })), { status: 200, headers: CORS });
    } catch (e) {
      console.error('[chat-suporte] chamado', String(e?.message || e));
      return new Response(JSON.stringify({ error: 'Não consegui responder agora.' }), { status: 502, headers: CORS });
    }
  }

  try {
    const out = await responderSuporte({ mensagens, memoria, canal: canal || 'site', apiKey });
    return new Response(JSON.stringify(out), { status: 200, headers: CORS });
  } catch (_) {
    return new Response(JSON.stringify({ resposta: 'Desculpe, não consegui processar sua mensagem no momento. Nossa equipe irá atendê-lo em breve.', escalar: true }), { status: 200, headers: CORS });
  }
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function responderNoChamado({ authUser, chamadoId, memoria, apiKey }) {
  if (!RE_UUID.test(String(chamadoId))) throw new Error('chamado_id inválido');
  // Posse conferida com a service key; a conversa vem do BANCO, não do corpo da requisição.
  const [chamado] = await lerLista(`chamados?id=eq.${chamadoId}&user_id=eq.${authUser.id}&select=*&limit=1`);
  if (!chamado) throw new Error('chamado não encontrado');
  // Com pessoa na conversa a IA não entra.
  if (['em_atendimento', 'aguardando_atendente', 'finalizado'].includes(chamado.status)) return { resposta: null, gravado: false, chamado };
  const mensagens = await lerLista(`chamados_mensagens?chamado_id=eq.${chamadoId}&select=autor_tipo,conteudo&order=criado_em.asc&limit=60`);

  let out;
  try {
    // Assessoria no CATÁLOGO pela regra assessoria.preco_independe_do_imovel (preço fixo + êxito).
    out = await responderSuporte({ mensagens, memoria, canal: 'site', apiKey, catalogo: await catalogoAssessoria() });
  } catch (e) {
    console.error('[chat-suporte] IA falhou', String(e?.message || e));
    out = { resposta: 'Não consegui processar sua mensagem no momento. Passei a sua conversa para a nossa equipe.', escalar: true, falhaIa: true };
  }
  if (!out.resposta) return { resposta: null, gravado: false, chamado };

  const ri = await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal',
    body: { chamado_id: chamado.id, autor_tipo: 'ia', autor_nome: 'BidPro Assistente', conteudo: out.resposta, anexos: [] } });
  if (!ri.ok) console.error('[chat-suporte] resposta da IA não gravada', ri.status);

  let atual = chamado;
  if (out.escalar) {
    const falas = mensagens.filter((m) => m.autor_tipo === 'cliente').slice(-5).map((m) => m.conteudo).join('\n\n') || chamado.titulo || '(sem texto)';
    const [perfil] = await lerLista(`perfis?id=eq.${authUser.id}&select=nome&limit=1`);
    atual = await paraEquipe({ ...chamado, tipo: out.bug ? 'bug' : chamado.tipo }, perfil?.nome || authUser.email, falas, {
      motivoInterno: out.falhaIa ? 'A IA falhou ao responder.' : out.bug ? 'A IA identificou uma FALHA da plataforma.' : 'A IA encaminhou para uma pessoa.',
    });
  }
  return { resposta: out.resposta, escalar: !!out.escalar, bug: !!out.bug, gravado: ri.ok, chamado: atual };
}
