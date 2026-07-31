// POST /api/validar-selfie
// Recebe { imagem: "data:image/...", tipo?: 'rosto'|'documento'|'ambos' }
// Verifica com Claude Vision usando um prompt DEFINIDO NO SERVIDOR (allowlist por
// `tipo`) — nunca texto livre do cliente (evita prompt injection). Fail-closed:
// sem key ou em erro técnico NÃO aprova sozinho, marca para revisão manual.

export const config = { runtime: 'edge' };
import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { anthropicFetch } from './_claude.js';
import { compararRostoDocumento } from './_kyc-match.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Persiste o resultado do KYC no perfil pela SERVICE KEY (server-side, autoritativo).
// Antes, o cliente (Perfil.jsx) escrevia identidade_validada=true direto no Supabase
// após a resposta da IA — bastava chamar o update no console p/ auto-validar. Agora o
// servidor grava e o trigger proteger_campos_sensiveis_perfil bloqueia a escrita pelo
// cliente. Best-effort: o front reflete o resultado retornado pela IA de qualquer forma.
async function marcarIdentidade(userId, campos) {
  if (!SUPABASE_URL || !SERVICE_KEY || !userId) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${userId}`, {
      method: 'PATCH',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(campos),
    });
  } catch { /* não trava a resposta da verificação */ }
}

// Último documento de identidade do usuário no acervo (frente por foto ou arquivo da CNH).
async function buscarDocumentoUsuario(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/usuario_docs?user_id=eq.${userId}&tipo=in.(kyc_documento,kyc_documento_frente)&select=url,nome,tipo,criado_em&order=criado_em.desc&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const j = await r.json().catch(() => []);
    return Array.isArray(j) && j.length ? j[0] : null;
  } catch { return null; }
}

// Baixa uma imagem (URL assinada do bucket privado) → base64 p/ o Claude Vision. Cap de ~4MB
// (limite prático do Vision e da memória do Edge). Retorna null se não for imagem/for grande demais.
async function urlImagemParaBase64(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')) return null; // PDF (CNH digital) e outros não entram no match automático
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) return null;
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return { base64: btoa(bin), mediaType: ct.split(';')[0] };
  } catch { return null; }
}

const ehArquivoPdf = (doc) => /\.pdf(\?|$)/i.test(String(doc?.url || '')) || /\.pdf$/i.test(String(doc?.nome || ''));

// Prompts fixos por tipo de checagem KYC (o cliente só escolhe o `tipo`).
const PROMPTS = {
  rosto: 'Esta imagem tem um rosto humano nítido e frontal, sem obstruções? Responda SOMENTE JSON: {"ok": true/false, "motivo": ""}',
  documento: 'Esta imagem mostra um documento de identidade brasileiro (RG ou CNH) com nome e CPF legíveis? Responda SOMENTE JSON: {"ok": true/false, "motivo": "", "nome_detectado": "", "cpf_detectado": ""}',
  ambos: 'Esta imagem mostra simultaneamente um rosto humano E um documento de identidade? Responda SOMENTE JSON: {"ok": true/false, "motivo": ""}',
};

// KYC do PARCEIRO (e afins): valida a selfie CONTRA o documento já enviado — mesma pessoa.
// Fecha o buraco de "selfie de qualquer um + documento aleatório passa". Fail-closed: sem key,
// documento em PDF, dúvida ou falha técnica → NÃO aprova sozinho, manda p/ revisão manual (pendente).
async function validarRostoContraDocumento(user, selfieB64, selfieMedia, claudeKey) {
  const jsonResp = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

  // 1) Precisa existir o DOCUMENTO no acervo (frente por foto ou arquivo da CNH).
  const doc = await buscarDocumentoUsuario(user.id);
  if (!doc) {
    return jsonResp({ ok: false, falta_documento: true, mensagem: 'Envie primeiro a foto do seu documento (RG/CNH) para concluir.' });
  }

  // 2) Sem key → não dá p/ comparar: revisão manual (fail-closed).
  if (!claudeKey) {
    await marcarIdentidade(user.id, { identidade_pendente: true });
    return jsonResp({ ok: false, pendente: true, mensagem: 'Selfie recebida. Sua identidade será confirmada pela equipe em breve.' });
  }

  // 3) Documento em PDF (CNH digital) → não há como fazer o match automático da foto: revisão manual.
  const docImg = ehArquivoPdf(doc) ? null : await urlImagemParaBase64(doc.url);
  if (!docImg) {
    await marcarIdentidade(user.id, { identidade_pendente: true });
    return jsonResp({ ok: false, pendente: true, mensagem: 'Selfie recebida. Como o documento foi enviado em arquivo/PDF, a conferência será feita pela equipe em breve.' });
  }

  // 4) Face match selfie × documento (motor compartilhado — 2 imagens, prompt do servidor).
  const parsed = await compararRostoDocumento({
    selfieB64, selfieMedia, docB64: docImg.base64, docMedia: docImg.mediaType, claudeKey,
  });
  if (!parsed) {
    // Falha técnica (indisponibilidade/JSON inválido) → NÃO reprova o legítimo; revisão manual.
    await marcarIdentidade(user.id, { identidade_pendente: true });
    return jsonResp({ ok: false, pendente: true, indisponivel: true, mensagem: 'Selfie recebida. A verificação será concluída pela equipe em instantes.' });
  }

  const conf = String(parsed.confianca || '').toLowerCase();
  const altaConfianca = conf === 'alta';

  // APROVA só com match CLARO: selfie com rosto, documento válido com foto, MESMA pessoa e confiança alta.
  if (parsed.selfie_rosto_ok === true && parsed.documento_ok === true && parsed.mesma_pessoa === true && altaConfianca) {
    await marcarIdentidade(user.id, { identidade_validada: true, identidade_validada_em: new Date().toISOString(), identidade_pendente: false });
    return jsonResp({ ok: true, mensagem: 'Identidade verificada: a selfie confere com o documento.' });
  }

  // REJEIÇÃO CLARA (com confiança) — mensagem específica, mantém o campo aberto p/ refazer.
  if (altaConfianca && parsed.mesma_pessoa === false && parsed.documento_ok === true && parsed.selfie_rosto_ok === true) {
    return jsonResp({ ok: false, rejeitado: true, mensagem: 'O rosto da selfie não confere com a foto do documento enviado. Tire uma selfie sua, do mesmo titular do documento.' });
  }
  if (altaConfianca && parsed.selfie_rosto_ok === false) {
    return jsonResp({ ok: false, rejeitado: true, mensagem: parsed.motivo || 'A selfie precisa mostrar seu rosto nítido e de frente. Evite fotos de tela, objetos ou paisagem.' });
  }
  if (altaConfianca && parsed.documento_ok === false) {
    return jsonResp({ ok: false, rejeitado: true, mensagem: parsed.motivo || 'Não consegui ler a foto do documento (rosto do RG/CNH). Reenvie o documento nítido e tente a selfie de novo.' });
  }

  // DÚVIDA (confiança média/baixa) → revisão manual, sem aprovar.
  await marcarIdentidade(user.id, { identidade_pendente: true });
  return jsonResp({ ok: false, pendente: true, mensagem: 'Selfie recebida. Para sua segurança, a conferência final será feita pela equipe em breve.' });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, mensagem: 'Método não permitido.' }), { status: 405 });

  const ip = getIP(req);
  const rl = await checkRateLimit(`validar-selfie:${ip}`, 10, 5 * 60 * 1000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, mensagem: 'JSON inválido.' }), { status: 400 });
  }

  const { imagem, tipo } = body;
  if (!imagem || !imagem.startsWith('data:image/')) {
    return new Response(JSON.stringify({ ok: false, mensagem: 'Imagem inválida.' }), { status: 400 });
  }

  // Checagem por etapa (rosto/documento/ambos, usadas no KYC de equipe) NÃO conclui a
  // validação de identidade do perfil — só o fluxo genérico (selfie+documento do Perfil)
  // marca identidade_validada. Computado aqui p/ estar disponível nas saídas fail-closed.
  const usaTipo = typeof tipo === 'string' && !!PROMPTS[tipo];

  const claudeKey = process.env.CLAUDE_KEY;

  // KYC do PARCEIRO: a selfie ('rosto') é conferida CONTRA o documento já enviado (mesma pessoa),
  // não basta "ter um rosto". Intercepta aqui — a função trata key ausente/erro/PDF (fail-closed).
  if (tipo === 'rosto') {
    const selfieB64 = imagem.split(',')[1];
    const selfieMedia = imagem.match(/data:(image\/\w+);/)?.[1] || 'image/jpeg';
    return await validarRostoContraDocumento(user, selfieB64, selfieMedia, claudeKey);
  }

  if (!claudeKey) {
    // Fail-closed: sem key NÃO aprova sozinho — vai para revisão manual da equipe.
    if (!usaTipo) await marcarIdentidade(user.id, { identidade_pendente: true });
    return new Response(JSON.stringify({ ok: false, mensagem: 'Foto recebida. A verificação será feita pela equipe.' }), { status: 200 });
  }

  // Extrai base64
  const base64 = imagem.split(',')[1];
  const mediaType = imagem.match(/data:(image\/\w+);/)?.[1] || 'image/jpeg';

  // Prompt SEMPRE do servidor (allowlist por `tipo`). Nunca concatena texto do cliente.
  const promptText = usaTipo
    ? `${PROMPTS[tipo]}\n\nResponda SOMENTE com o JSON, sem texto adicional.`
    : `Analise esta imagem e responda APENAS com JSON no formato:
{"rosto_visivel": true/false, "documento_visivel": true/false, "aprovado": true/false, "motivo": "texto curto"}

Regras:
- "rosto_visivel": há uma pessoa com o rosto visível e nítido?
- "documento_visivel": há um documento de identidade (RG, CNH, passaporte) visível?
- "aprovado": true apenas se ambos rosto E documento estiverem visíveis e legíveis
- "motivo": se não aprovado, explique em pt-BR o que está faltando (máx 80 chars)

Responda SOMENTE com o JSON, sem texto adicional.`;

  try {
    const claudeRes = await anthropicFetch({
      method: 'POST',
      headers: {
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64 },
            },
            {
              type: 'text',
              text: promptText,
            },
          ],
        }],
      }),
    });

    // Sem checar claudeRes.ok, uma indisponibilidade do Claude (4xx/5xx) virava corpo {} →
    // parsed.ok !== true → rejeição genérica "tente novamente" em HTTP 200, indistinguível
    // de uma reprovação real (usuário legítimo barrado durante um incidente da plataforma).
    if (!claudeRes.ok) {
      return new Response(JSON.stringify({
        ok: false,
        mensagem: 'Verificação temporariamente indisponível. Tente novamente em alguns minutos.',
        indisponivel: true,
      }), { status: 503, headers: { 'Content-Type': 'application/json' } });
    }
    const claudeData = await claudeRes.json();
    const text = claudeData?.content?.[0]?.text || '{}';

    let parsed;
    try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { parsed = {}; }

    // Checagem por tipo — usa campo "ok" diretamente
    if (usaTipo) {
      if (parsed.ok === true) {
        // (A selfie do parceiro — tipo 'rosto' — é tratada antes, com face match contra o documento.)
        return new Response(JSON.stringify({
          ok: true,
          mensagem: 'Verificação concluída com sucesso.',
          detalhes: parsed,
        }), { status: 200 });
      } else {
        return new Response(JSON.stringify({
          ok: false,
          mensagem: parsed.motivo || 'Não foi possível verificar a imagem. Tente novamente.',
          detalhes: parsed,
        }), { status: 200 });
      }
    }

    // Prompt genérico — usa campo "aprovado". Persiste o resultado no perfil (server-side).
    if (parsed.aprovado) {
      await marcarIdentidade(user.id, { identidade_validada: true, identidade_validada_em: new Date().toISOString(), identidade_pendente: false });
      return new Response(JSON.stringify({
        ok: true,
        mensagem: 'Identidade verificada com sucesso.',
        detalhes: parsed,
      }), { status: 200 });
    } else {
      await marcarIdentidade(user.id, { identidade_pendente: true });
      return new Response(JSON.stringify({
        ok: false,
        mensagem: parsed.motivo || 'Não foi possível verificar o documento. Certifique-se de que rosto e documento estão visíveis.',
        detalhes: parsed,
      }), { status: 200 });
    }
  } catch (err) {
    // Fail-closed: falha técnica NÃO aprova automaticamente — vai para revisão manual.
    if (!usaTipo) await marcarIdentidade(user.id, { identidade_pendente: true });
    return new Response(JSON.stringify({
      ok: false,
      mensagem: 'Foto recebida. A verificação será realizada pela equipe.',
    }), { status: 200 });
  }
}
