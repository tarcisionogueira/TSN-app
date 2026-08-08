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

// O documento do KYC SÓ vale se o arquivo estiver no NOSSO Storage. A linha de `usuario_docs`
// é escrita pelo próprio cliente (RLS permite inserir a própria linha — Perfil.jsx:542,
// KycParceiroModal.jsx:62), então `url` é campo controlado por ele: sem esta trava, bastava
// inserir `{tipo:'kyc_documento', url:'https://site-do-atacante/rg-forjado.jpg'}` e o face match
// comparava a selfie com um "documento" fabricado pelo próprio usuário — aprovando identidade
// (pré-requisito de saque). Fecha também o SSRF: o servidor deixa de buscar URL arbitrária.
// Todos os gravadores legítimos usam URL assinada/pública dos nossos buckets.
function ehUrlDoNossoStorage(url) {
  const base = String(SUPABASE_URL || '').replace(/\/+$/, '');
  if (!base) return false;
  return String(url || '').startsWith(`${base}/storage/v1/`);
}

// PATH do nosso bucket privado (ex.: `pj/<uuid>/kyc-doc-frente-123.jpg`). Só reconhece a forma
// exata que os nossos gravadores usam — nunca um caminho arbitrário do cliente.
function pathDoNossoBucket(v) {
  const s = String(v || '');
  return /^pj\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+$/.test(s) ? s : null;
}

// Assina o path com a SERVICE KEY, na hora. Por que o servidor faz isso em vez de confiar na
// URL gravada (08/08): TODOS os 8 documentos KYC do sistema estavam com PATH CRU em vez de URL
// assinada — o `createSignedUrl` do cliente falhava e o código caía no `signed?.signedUrl || path`,
// gravando o path em silêncio. Como a trava exigia URL do Storage, o face match NUNCA rodava:
// toda identidade caía em "revisão manual", e identidade validada é pré-requisito de SAQUE.
// Assinando aqui, o servidor deixa de depender do que o cliente conseguiu gravar — e o caminho
// continua fechado a URL de fora (o path é validado pelo formato acima).
async function assinarPathPrivado(path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) { console.error('[validar-selfie] sign', r.status, (await r.text().catch(() => '')).slice(0, 200)); return null; }
    const j = await r.json().catch(() => null);
    return j?.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
  } catch (e) { console.error('[validar-selfie] sign erro', e?.message); return null; }
}

// Baixa uma imagem (URL assinada do bucket privado) → base64 p/ o Claude Vision. Cap de ~4MB
// (limite prático do Vision e da memória do Edge). Retorna null se não for imagem/for grande demais.
async function urlImagemParaBase64(url) {
  let alvo = url;
  if (!ehUrlDoNossoStorage(alvo)) {
    const path = pathDoNossoBucket(alvo);
    if (!path) return null;
    alvo = await assinarPathPrivado(path);
    if (!alvo) return null;
  }
  try {
    const r = await fetch(alvo, { signal: AbortSignal.timeout(12000) });
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

// Última SELFIE do usuário no acervo. Serve ao "continuar no celular": o telefone entrega a foto
// (rota do QR, que só escreve) e o DESKTOP autenticado pede a validação sem ter os bytes em mãos.
// Mesma trava do documento: só vale arquivo do NOSSO Storage (ehUrlDoNossoStorage), então uma
// linha forjada em `usuario_docs` apontando para fora não vira selfie válida.
async function buscarSelfieUsuario(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/usuario_docs?user_id=eq.${userId}&tipo=eq.kyc_selfie&select=url,nome,criado_em&order=criado_em.desc&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
    const j = await r.json().catch(() => []);
    return Array.isArray(j) && j.length ? j[0] : null;
  } catch { return null; }
}

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

  // 3) Documento em PDF (CNH digital) ou fora do nosso Storage → sem match automático: revisão manual.
  //    (fora do Storage = linha forjada em usuario_docs; nunca aprova sozinha — ver ehUrlDoNossoStorage)
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
  const claudeKeyEnv = process.env.CLAUDE_KEY;

  // ── "Continuar no celular": a selfie já está no acervo, o desktop só pede a conferência ──
  // O telefone entrega a foto pela rota do QR (que apenas escreve). Quem dispara a validação é
  // esta sessão, do próprio titular — o código do QR nunca vale como credencial aqui.
  if (body.selfie_do_acervo === true) {
    const selfie = await buscarSelfieUsuario(user.id);
    const img = selfie ? await urlImagemParaBase64(selfie.url) : null;
    if (!img) {
      return new Response(JSON.stringify({ ok: false, mensagem: 'Ainda não recebi a selfie enviada pelo celular. Aguarde alguns segundos e tente de novo.' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return await validarRostoContraDocumento(user, img.base64, img.mediaType, claudeKeyEnv);
  }

  if (!imagem || !imagem.startsWith('data:image/')) {
    return new Response(JSON.stringify({ ok: false, mensagem: 'Imagem inválida.' }), { status: 400 });
  }

  // Checagem por etapa (rosto/documento/ambos, usadas no KYC de equipe) NÃO conclui a
  // validação de identidade do perfil — só o fluxo genérico (selfie+documento do Perfil)
  // marca identidade_validada. Computado aqui p/ estar disponível nas saídas fail-closed.
  const usaTipo = typeof tipo === 'string' && !!PROMPTS[tipo];

  const claudeKey = process.env.CLAUDE_KEY;

  // TODA aprovação de identidade passa pelo FACE MATCH contra o documento no acervo — tanto o
  // KYC do parceiro (tipo 'rosto') quanto o fluxo do Perfil (sem `tipo`).
  // Era aqui o furo (achado 02/08): sem `tipo`, o endpoint julgava UMA foto enviada pelo próprio
  // cliente ("tem rosto? tem documento?") e, se a IA dissesse sim, gravava identidade_validada —
  // sem nunca comparar com o documento do titular. Uma foto de outra pessoa segurando o documento
  // dela aprovava a SUA conta, e identidade validada é pré-requisito de SAQUE.
  // Agora `identidade_validada` é escrito em UM lugar só: validarRostoContraDocumento.
  if (tipo === 'rosto' || !usaTipo) {
    const selfieB64 = imagem.split(',')[1];
    const selfieMedia = imagem.match(/data:(image\/\w+);/)?.[1] || 'image/jpeg';
    return await validarRostoContraDocumento(user, selfieB64, selfieMedia, claudeKey);
  }

  // Daqui p/ baixo é só a checagem por ETAPA do KYC de equipe (documento/ambos), que NUNCA
  // conclui a validação de identidade — apenas diz se a foto daquela etapa está legível.
  if (!claudeKey) {
    return new Response(JSON.stringify({ ok: false, mensagem: 'Foto recebida. A verificação será feita pela equipe.' }), { status: 200 });
  }

  // Extrai base64
  const base64 = imagem.split(',')[1];
  const mediaType = imagem.match(/data:(image\/\w+);/)?.[1] || 'image/jpeg';

  // Prompt SEMPRE do servidor (allowlist por `tipo`). Nunca concatena texto do cliente.
  const promptText = `${PROMPTS[tipo]}\n\nResponda SOMENTE com o JSON, sem texto adicional.`;

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

    // Checagem por ETAPA (documento/ambos): responde só se aquela foto está legível. Nenhuma
    // escrita em perfis — quem valida identidade é o face match, acima.
    return new Response(JSON.stringify({
      ok: parsed.ok === true,
      mensagem: parsed.ok === true
        ? 'Verificação concluída com sucesso.'
        : (parsed.motivo || 'Não foi possível verificar a imagem. Tente novamente.'),
      detalhes: parsed,
    }), { status: 200 });
  } catch (err) {
    // Fail-closed: falha técnica NÃO aprova automaticamente.
    return new Response(JSON.stringify({
      ok: false,
      mensagem: 'Foto recebida. A verificação será realizada pela equipe.',
    }), { status: 200 });
  }
}
