export const config = { runtime: 'edge' };

// POST /api/verificar-identidade-kyc  (fluxo PÚBLICO de assinatura — auth por token)
//
// Verifica com Claude Vision, para a assinatura de um contrato:
//   1. o DOCUMENTO é um documento de identidade real e legível (não um anexo aleatório);
//   2. a pessoa da SELFIE é a MESMA da foto do documento (face-match);
//   3. (se declarado) o nome/CPF do documento confere com o que o signatário informou.
//
// Comporta documento FÍSICO (frente + verso) e DIGITAL (CNH-e / RG digital).
// Veredito HÍBRIDO: bloqueia SÓ em fraude clara (rosto claramente diferente ou
// documento claramente inválido); em dúvida/foto ruim devolve 'revisar' (assina,
// mas fica sinalizado p/ a equipe). Prompt DEFINIDO NO SERVIDOR (sem texto livre do
// cliente → anti prompt-injection). Fail-open-to-review: sem key/erro → 'revisar'.

import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { getUser, getUserRoleById } from './_auth.js';
import { anthropicFetch } from './_claude.js';

const ROLES_STAFF = ['admin', 'consultor', 'analista', 'advogado'];

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

const soDigitos = (s) => String(s || '').replace(/\D/g, '');

// Bloco de imagem a partir de um data URL (valida o prefixo).
function imgBlock(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return null;
  const media_type = dataUrl.match(/data:(image\/\w+);/)?.[1] || 'image/jpeg';
  const data = dataUrl.split(',')[1];
  if (!data) return null;
  return { type: 'image', source: { type: 'base64', media_type, data } };
}

const PROMPT = `Você é um verificador de identidade (KYC) para assinatura de contrato. Você recebe, nesta ordem, uma SELFIE do rosto da pessoa e a(s) foto(s) do DOCUMENTO de identidade dela (RG, CNH ou versão digital — CNH-e/RG digital; documento físico pode vir em frente e verso). Compare e responda SOMENTE com JSON, sem texto fora do JSON:
{
  "documento_valido": true,
  "tipo_documento": "",
  "nome_detectado": "",
  "cpf_detectado": "",
  "foto_documento_visivel": true,
  "mesma_pessoa": true,
  "confianca": "alta",
  "motivo": ""
}
Regras:
- "documento_valido": true se for realmente um documento de identidade brasileiro (físico ou digital) legível; FALSE apenas se for CLARAMENTE outra coisa (imagem aleatória, objeto, papel em branco) ou claramente falsificado/editado. Se for um documento real porém com foto tremida/reflexo, mantenha true e use "confianca":"baixa".
- "cpf_detectado": só dígitos; "" se não achar.
- "foto_documento_visivel": o documento traz a foto do rosto do titular?
- "mesma_pessoa": a pessoa da SELFIE é a MESMA da foto do documento? Seja conservador: só true com "confianca":"alta" se as feições baterem claramente.
- "confianca": "alta" | "media" | "baixa" — sua confiança na conclusão de mesma_pessoa (use "baixa" quando qualquer imagem estiver ruim/ilegível).
- "motivo": curto, em português, explicando o ponto principal.`;

export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Método não permitido' }), { status: 405, headers });
  if (!SUPABASE_URL || !SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500, headers });

  const ip = getIP(req);
  const rl = await checkRateLimit(`verificar-kyc:${ip}`, 8, 5 * 60 * 1000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }

  const { token, selfie, doc_tipo, doc_frente, doc_verso, doc_digital, nome_declarado, cpf_declarado } = body || {};

  // Auth: OU pelo token do contrato (assinatura pública), OU por staff autenticado
  // (pré-checagem no Admin ao gerar o contrato, quando ainda não há token).
  if (token) {
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(token))) {
      return new Response(JSON.stringify({ error: 'Token inválido' }), { status: 400, headers });
    }
    const rc = await sb(`contratos_link?token=eq.${encodeURIComponent(token)}&select=id,status,expira_em`);
    const rows = await rc.json().catch(() => []);
    const contrato = Array.isArray(rows) ? rows[0] : null;
    if (!contrato) return new Response(JSON.stringify({ error: 'Contrato não encontrado' }), { status: 404, headers });
    if (!['aguardando', 'aguardando_assinatura'].includes(contrato.status)) {
      return new Response(JSON.stringify({ error: 'Contrato indisponível' }), { status: 409, headers });
    }
  } else {
    const user = await getUser(req);
    if (!user) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401, headers });
    const role = await getUserRoleById(user.id);
    if (!ROLES_STAFF.includes(role)) return new Response(JSON.stringify({ error: 'Apenas a equipe pode verificar' }), { status: 403, headers });
  }

  // Monta as imagens: selfie + documento (físico frente/verso OU digital).
  const selfieBlock = imgBlock(selfie);
  if (!selfieBlock) return new Response(JSON.stringify({ error: 'Selfie inválida' }), { status: 400, headers });

  const docBlocks = [];
  if (doc_tipo === 'digital') {
    const b = imgBlock(doc_digital);
    if (b) docBlocks.push({ rotulo: 'DOCUMENTO DIGITAL (CNH-e / RG digital)', b });
  } else {
    const f = imgBlock(doc_frente);
    if (f) docBlocks.push({ rotulo: 'DOCUMENTO — FRENTE', b: f });
    const v = imgBlock(doc_verso);
    if (v) docBlocks.push({ rotulo: 'DOCUMENTO — VERSO', b: v });
  }
  if (!docBlocks.length) return new Response(JSON.stringify({ error: 'Envie a foto do documento' }), { status: 400, headers });

  const claudeKey = process.env.CLAUDE_KEY;
  // Fail-open-to-review: sem key não bloqueia (não trava cliente legítimo), mas marca revisão.
  if (!claudeKey) {
    return new Response(JSON.stringify({ resultado: 'revisar', mensagem: 'Verificação será revisada pela equipe.', detalhes: null }), { status: 200, headers });
  }

  // content: selfie primeiro (rotulada), depois cada imagem do documento, e o prompt no fim.
  const content = [
    { type: 'text', text: 'SELFIE (rosto da pessoa):' }, selfieBlock,
    ...docBlocks.flatMap(({ rotulo, b }) => [{ type: 'text', text: `${rotulo}:` }, b]),
    { type: 'text', text: PROMPT },
  ];

  try {
    const res = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': claudeKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.KYC_IA_MODEL || 'claude-haiku-4-5-20251001', max_tokens: 400, messages: [{ role: 'user', content }] }),
    });
    const data = await res.json();
    const text = data?.content?.[0]?.text || '{}';
    let p;
    try { p = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { p = {}; }

    // Cruza CPF declarado x detectado (quando ambos existem).
    const cpfDecl = soDigitos(cpf_declarado);
    const cpfDet = soDigitos(p.cpf_detectado);
    const cpfConfere = (cpfDecl && cpfDet) ? (cpfDecl === cpfDet) : null;

    // Veredito HÍBRIDO.
    const rostoDiferenteClaro = p.mesma_pessoa === false && p.confianca === 'alta';
    const documentoInvalidoClaro = p.documento_valido === false;
    const fraudeClara = rostoDiferenteClaro || documentoInvalidoClaro;

    let resultado;
    if (fraudeClara) {
      resultado = 'bloqueado';
    } else if (p.documento_valido === true && p.mesma_pessoa === true && p.confianca !== 'baixa' && cpfConfere !== false) {
      resultado = 'aprovado';
    } else {
      resultado = 'revisar';
    }

    const mensagem = resultado === 'bloqueado'
      ? (rostoDiferenteClaro
          ? 'A selfie não corresponde à foto do documento. Envie sua própria selfie e o seu documento.'
          : 'O documento enviado não parece um documento de identidade válido. Reenvie uma foto nítida do RG/CNH.')
      : resultado === 'aprovado'
        ? 'Identidade verificada.'
        : 'Recebido. Sua identidade passará por uma revisão adicional.';

    return new Response(JSON.stringify({
      resultado,
      mensagem,
      detalhes: {
        documento_valido: p.documento_valido ?? null,
        tipo_documento: p.tipo_documento || null,
        nome_detectado: p.nome_detectado || null,
        cpf_detectado: cpfDet || null,
        mesma_pessoa: p.mesma_pessoa ?? null,
        confianca: p.confianca || null,
        cpf_confere_declarado: cpfConfere,
        motivo: p.motivo || null,
      },
    }), { status: 200, headers });
  } catch {
    // Falha técnica não bloqueia (híbrido) — vai para revisão manual.
    return new Response(JSON.stringify({ resultado: 'revisar', mensagem: 'Não foi possível concluir a verificação automática; será revisada pela equipe.', detalhes: null }), { status: 200, headers });
  }
}
