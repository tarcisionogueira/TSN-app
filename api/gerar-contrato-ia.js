/**
 * Gera contrato jurídico com IA (Claude) com base na descrição fornecida.
 * Inclui: base legal, LGPD, anticorrupção, cláusulas equilibradas para ambas as partes.
 *
 * Env vars: CLAUDE_KEY, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY
 */
// 🔴 RUNTIME (corrigido 04/08): era `edge`. O Edge da Vercel tem teto DURO de ~25s, e esta
// rota gera um contrato inteiro (max_tokens 4000) numa chamada NÃO-streaming ao Claude, que
// leva bem mais que isso. Quando o teto estoura, a Vercel mata a função e devolve uma página
// de erro em TEXTO PURO ("An error occurred…") — o `catch` daqui de baixo nem chega a rodar,
// então o JSON `{ error }` nunca é enviado. Era esse texto que o front tentava dar `.json()`
// e virava o "Unexpected token 'A', "An error o"... is not valid JSON" na tela do dono.
// Todas as outras rotas pesadas de IA (gerar-analise, gerar-documental) já rodam em nodejs
// com maxDuration alto — esta era a única fora do padrão.
//
// ⚠️ `export const POST` (embaixo) é OBRIGATÓRIO junto com nodejs: com `export default`, o
// runtime Node da Vercel trata a função como Express `(req, res)` e IGNORA o `Response`
// devolvido — a função nunca sinaliza fim e trava até o maxDuration (504). Mesmo motivo
// documentado em reconciliar-assinaturas-cron.js.
export const config = { runtime: 'nodejs', maxDuration: 300 };
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
11. Deixa campos para preenchimento — [NOME COMPLETO], [CPF/CNPJ], [ENDEREÇO], [DATA], [VALOR] — APENAS para o que NÃO foi informado. Dado que veio na descrição ou em documento anexado entra TRANSCRITO no contrato; deixar em colchetes algo que o operador já forneceu é ERRO, obriga a redigitar e é a principal queixa de quem usa esta tela.
12. Rodapé: "Assinatura eletrônica qualificada/avançada válida nos termos da MP 2.200-2/2001 e da Lei 14.063/2020, com registro de IP, data/hora e hash de integridade do documento."`;

// SEM `export default` — de propósito. No runtime Node da Vercel o default export é tratado
// como assinatura Express `(req, res)`: o `Response` devolvido é DESCARTADO, a função nunca
// sinaliza fim e fica pendurada até o maxDuration (aqui, 300s de spinner na tela e depois 504).
// Foi o que aconteceu em 04/08 quando o default foi adicionado junto com o POST. Toda rota
// deste projeto que devolve `Response` exporta SÓ os métodos nomeados (ver os ~17 crons); as
// que têm `export default` usam a outra assinatura, com `res.status().json()`. Não misturar.
export const POST = handler;
async function handler(req) {
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

  // 24.000 caracteres (~6k tokens) para os anexos: 6.000 cortava um contrato inteiro no meio,
  // e o caso REAL desta rota é "gere de novo o contrato do ano passado com a data nova" — o
  // modelo precisa do documento inteiro, não do primeiro terço.
  const DOCS_MAX = 24000;
  const docsTexto = documentos ? String(documentos).slice(0, DOCS_MAX) : '';

  const userMessage = `Gere um contrato de ${tipoFinal || 'prestação de serviços'} com base na seguinte descrição em texto livre:

${descricao.slice(0, 4000)}

${partesFinal ? `Informações adicionais sobre as partes:\n${String(partesFinal).slice(0, 800)}\n` : ''}${docsTexto ? `DOCUMENTOS ANEXADOS PELO OPERADOR (conteúdo real, extraído dos arquivos):
${docsTexto}

COMO USAR OS ANEXOS — regra que vale mais que o hábito de deixar campo em branco:
- Todo dado que estiver nos anexos deve ser TRANSCRITO no contrato novo: nomes completos,
  CPF/CNPJ, endereços, estado civil, profissão, valores, prazos, objeto. NÃO deixe
  [NOME COMPLETO], [CPF], [ENDEREÇO] em nada que o anexo já informe — o operador anexou o
  documento justamente para não redigitar isso.
- Se um anexo for um CONTRATO ANTERIOR do mesmo tipo, trate-o como MODELO A RENOVAR:
  mantenha as MESMAS partes e as mesmas condições, alterando só o que a descrição mandar
  mudar (tipicamente datas, prazo e valor). Não troque as partes, não invente novas.
- Só use [CAMPO ENTRE COLCHETES] para o que REALMENTE não aparece em lugar nenhum.
- Se a descrição CONTRADISSER o anexo, a descrição vence (ela é a instrução de agora).
` : ''}
FORO OBRIGATÓRIO deste contrato: ${foroFinal} (eleja este foro com renúncia a qualquer outro, salvo ressalva legal imperativa).

Gere o contrato completo e pronto para uso.`;

  try {
    const r = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        // 8000: com anexo, o contrato novo TRANSCREVE a qualificação completa das partes em
        // vez de deixar colchetes, então a saída é bem maior que a de um contrato genérico.
        // Em 4000 uma renovação de contrato longo terminava cortada no meio de uma cláusula.
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
      // Limitado de propósito: com o padrão (3 retries × 120s) o pior caso passa de 6 min e
      // estoura o maxDuration de 300s — a Vercel mataria a função e o dono veria DE NOVO a
      // página de texto em vez do JSON de erro. Aqui o pior caso fica ~3,5 min, dentro do teto.
    }, { retries: 1, timeoutMs: 100000 });

    // Erro do Claude vem em JSON, mas um 5xx de borda/proxy pode vir em HTML/texto: ler direto
    // com .json() esconderia a causa atrás de um SyntaxError. Lê o corpo UMA vez e decide.
    const bruto = await r.text();
    let data; try { data = JSON.parse(bruto); } catch { data = null; }
    if (!r.ok) throw new Error(data?.error?.message || `Claude HTTP ${r.status}: ${bruto.slice(0, 200)}`);
    if (!data) throw new Error(`Resposta não-JSON do Claude: ${bruto.slice(0, 200)}`);
    const contrato = data.content?.[0]?.text?.trim();
    if (!contrato) throw new Error('Resposta vazia');
    // TRUNCAMENTO É DITO, não escondido: em `max_tokens` o contrato termina no meio de uma
    // cláusula e, na tela, parece completo — o operador mandaria assinar um documento cortado.
    const truncado = data.stop_reason === 'max_tokens';

    await auditLog({ acao: 'contrato_gerado_ia', user_id: user.id, ip, detalhes: { tipo: tipoFinal, foro: foroFinal, comDocs: !!documentos, truncado }, sucesso: true });

    return new Response(JSON.stringify({ ok: true, contrato, truncado }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    // A MENSAGEM vai para o cliente: "Erro ao gerar contrato" sozinho não dizia se foi cota,
    // timeout, chave errada ou modelo indisponível — e era o único sinal que o staff tinha.
    console.error('[gerar-contrato-ia]', e?.message);
    const motivo = /abort|timeout/i.test(e?.message || '')
      ? 'A IA demorou demais para responder. Tente de novo em alguns instantes.'
      : `Erro ao gerar contrato: ${String(e?.message || 'falha desconhecida').slice(0, 200)}`;
    return new Response(JSON.stringify({ error: motivo }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}
