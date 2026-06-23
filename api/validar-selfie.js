// POST /api/validar-selfie
// Recebe { imagem: "data:image/...", validacao_prompt?: string }
// Verifica com Claude Vision conforme o prompt fornecido, ou faz verificação genérica

export const config = { runtime: 'edge' };
import { getUser, getUserRole, unauthorized, forbidden } from './_auth.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response(JSON.stringify({ ok: false, mensagem: 'Método não permitido.' }), { status: 405 });

  const user = await getUser(req);
  if (!user) return unauthorized();

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ ok: false, mensagem: 'JSON inválido.' }), { status: 400 });
  }

  const { imagem, validacao_prompt } = body;
  if (!imagem || !imagem.startsWith('data:image/')) {
    return new Response(JSON.stringify({ ok: false, mensagem: 'Imagem inválida.' }), { status: 400 });
  }

  const claudeKey = process.env.CLAUDE_KEY || process.env.VITE_CLAUDE_KEY;
  if (!claudeKey) {
    // Sem key, aceita a foto para não bloquear o cadastro
    return new Response(JSON.stringify({ ok: true, mensagem: 'Foto recebida. Verificação será feita pela equipe.' }), { status: 200 });
  }

  // Extrai base64
  const base64 = imagem.split(',')[1];
  const mediaType = imagem.match(/data:(image\/\w+);/)?.[1] || 'image/jpeg';

  // Monta o prompt: usa o fornecido ou cai no genérico
  const promptText = validacao_prompt
    ? `${validacao_prompt}\n\nResponda SOMENTE com o JSON, sem texto adicional.`
    : `Analise esta imagem e responda APENAS com JSON no formato:
{"rosto_visivel": true/false, "documento_visivel": true/false, "aprovado": true/false, "motivo": "texto curto"}

Regras:
- "rosto_visivel": há uma pessoa com o rosto visível e nítido?
- "documento_visivel": há um documento de identidade (RG, CNH, passaporte) visível?
- "aprovado": true apenas se ambos rosto E documento estiverem visíveis e legíveis
- "motivo": se não aprovado, explique em pt-BR o que está faltando (máx 80 chars)

Responda SOMENTE com o JSON, sem texto adicional.`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
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

    // Se veio validacao_prompt, usa campo "ok" diretamente
    if (validacao_prompt) {
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

    // Prompt genérico — usa campo "aprovado"
    if (parsed.aprovado) {
      return new Response(JSON.stringify({
        ok: true,
        mensagem: 'Identidade verificada com sucesso.',
        detalhes: parsed,
      }), { status: 200 });
    } else {
      return new Response(JSON.stringify({
        ok: false,
        mensagem: parsed.motivo || 'Não foi possível verificar o documento. Certifique-se de que rosto e documento estão visíveis.',
        detalhes: parsed,
      }), { status: 200 });
    }
  } catch (err) {
    // Em caso de falha técnica, não bloqueia o cadastro
    return new Response(JSON.stringify({
      ok: true,
      mensagem: 'Foto recebida. Verificação será realizada pela equipe.',
    }), { status: 200 });
  }
}
