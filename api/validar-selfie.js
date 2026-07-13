// POST /api/validar-selfie
// Recebe { imagem: "data:image/...", tipo?: 'rosto'|'documento'|'ambos' }
// Verifica com Claude Vision usando um prompt DEFINIDO NO SERVIDOR (allowlist por
// `tipo`) — nunca texto livre do cliente (evita prompt injection). Fail-closed:
// sem key ou em erro técnico NÃO aprova sozinho, marca para revisão manual.

export const config = { runtime: 'edge' };
import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { anthropicFetch } from './_claude.js';

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

// Prompts fixos por tipo de checagem KYC (o cliente só escolhe o `tipo`).
const PROMPTS = {
  rosto: 'Esta imagem tem um rosto humano nítido e frontal, sem obstruções? Responda SOMENTE JSON: {"ok": true/false, "motivo": ""}',
  documento: 'Esta imagem mostra um documento de identidade brasileiro (RG ou CNH) com nome e CPF legíveis? Responda SOMENTE JSON: {"ok": true/false, "motivo": "", "nome_detectado": "", "cpf_detectado": ""}',
  ambos: 'Esta imagem mostra simultaneamente um rosto humano E um documento de identidade? Responda SOMENTE JSON: {"ok": true/false, "motivo": ""}',
};

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

    const claudeData = await claudeRes.json();
    const text = claudeData?.content?.[0]?.text || '{}';

    let parsed;
    try { parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || '{}'); } catch { parsed = {}; }

    // Checagem por tipo — usa campo "ok" diretamente
    if (usaTipo) {
      if (parsed.ok === true) {
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
