/**
 * POST /api/captura-handoff-envio — o CELULAR entrega a foto (rota anônima, autorizada pelo
 * CÓDIGO do QR, nunca por sessão).
 *
 * O que esta rota pode fazer, de propósito, é só isto: gravar um arquivo no bucket privado
 * `documentos` sob a pasta do DONO DO CÓDIGO e registrar a linha em `usuario_docs`. Ela não lê
 * documento nenhum, não devolve URL assinada para o telefone e não toca no perfil — quem valida
 * a identidade continua sendo /api/validar-selfie, chamado pelo DESKTOP autenticado. Assim o
 * código do QR é uma permissão de ENTREGA, e o pior caso de um código vazado é alguém entregar
 * uma foto errada na conta — nunca ver ou levar o documento de quem quer que seja.
 *
 * Limite de tamanho: a foto chega já reduzida pelo celular (a tela do handoff redimensiona em
 * canvas antes de enviar). O teto aqui é a rede de segurança — e existe porque o corpo de uma
 * função serverless tem limite próprio: sem redução, uma foto de celular moderno estoura.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { carregarHandoff, hashCodigo, FLUXOS } from './captura-handoff.js';
import { checkRateLimit, getIP } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const MAX_BYTES = 4 * 1024 * 1024;
// tipo do handoff → tipo em `usuario_docs` (o mesmo que Perfil.jsx e o modal do parceiro gravam,
// para o KYC enxergar o documento venha ele do computador ou do celular).
const TIPO_DOC = {
  documento: 'kyc_documento_frente',
  documento_verso: 'kyc_documento_verso',
  selfie: 'kyc_selfie',
};
const EXT_OK = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const ip = getIP(req);
  const rl = await checkRateLimit(`handoff-envio:${ip}`, 30, 10 * 60_000);
  if (!rl.ok) { res.status(429).json({ error: 'Muitos envios. Aguarde alguns minutos.' }); return; }

  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { body = {}; }
  const codigo = String(body.codigo || '').trim();
  const tipo = String(body.tipo || '').trim();
  const imagem = String(body.imagem || '');

  const { erro, handoff } = await carregarHandoff(codigo);
  if (erro) {
    const msg = erro === 'expirado' ? 'Este código expirou. Gere um novo QR no computador.'
      : erro === 'cancelado' ? 'Este código foi cancelado no computador.'
      : 'Código inválido.';
    res.status(erro === 'indisponivel' ? 503 : 410).json({ error: msg, motivo: erro });
    return;
  }
  if (handoff.concluido_em) { res.status(409).json({ error: 'Este envio já foi concluído.', motivo: 'concluido' }); return; }
  if (handoff.envios >= 12) { res.status(429).json({ error: 'Limite de envios atingido para este código.', motivo: 'teto' }); return; }

  const aceita = FLUXOS[handoff.fluxo]?.aceita || [];
  if (!aceita.includes(tipo)) { res.status(400).json({ error: 'Tipo de foto não previsto neste passo.' }); return; }

  // data URL → bytes. Só imagem: o celular está tirando FOTO; PDF continua pelo computador.
  const m = imagem.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) { res.status(400).json({ error: 'Envie uma foto (JPG, PNG ou WEBP).' }); return; }
  const mime = m[1];
  let bin;
  try { bin = Buffer.from(m[2], 'base64'); } catch { bin = null; }
  if (!bin || !bin.length) { res.status(400).json({ error: 'Não foi possível ler a foto.' }); return; }
  if (bin.length > MAX_BYTES) { res.status(413).json({ error: 'Foto muito grande. Tente novamente — ela deveria ser reduzida automaticamente.' }); return; }

  // Mesmo caminho de pasta que o desktop usa (`pj/<user>/…`): o KYC e o painel continuam
  // enxergando o documento sem saber por qual dispositivo ele entrou.
  const ext = EXT_OK[mime] || 'jpg';
  const prefixo = tipo === 'selfie' ? 'kyc-rosto' : tipo === 'documento_verso' ? 'kyc-doc-verso' : 'kyc-doc-frente';
  const path = `pj/${handoff.user_id}/${prefixo}-${Date.now()}.${ext}`;

  const up = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${path}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': mime, 'x-upsert': 'false' },
    body: bin,
  });
  if (!up.ok) {
    const det = await up.text().catch(() => '');
    console.error('[captura-handoff-envio] upload', up.status, det.slice(0, 200));
    res.status(502).json({ error: 'Falha ao guardar a foto. Tente de novo.' });
    return;
  }

  // URL assinada longa (mesmo padrão do desktop) — fica no banco, NÃO volta para o telefone.
  let urlAssinada = path;
  try {
    const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 3650 }),
    });
    if (s.ok) { const j = await s.json(); if (j?.signedURL) urlAssinada = `${SUPABASE_URL}/storage/v1${j.signedURL}`; }
  } catch { /* segue com o path; o registro é o que importa */ }

  const insOk = await sb('usuario_docs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      user_id: handoff.user_id, tipo: TIPO_DOC[tipo] || 'kyc_documento_frente',
      nome: `${prefixo}.${ext}`, url: urlAssinada, tamanho_kb: Math.round(bin.length / 1024),
    }),
  });
  if (!insOk.ok) {
    const det = await insOk.text().catch(() => '');
    console.error('[captura-handoff-envio] usuario_docs', insOk.status, det.slice(0, 200));
    res.status(502).json({ error: 'Foto guardada, mas o registro falhou. Tente de novo.' });
    return;
  }

  // Progresso do handoff: acumula o que já chegou e fecha quando todos os PASSOS do fluxo
  // estiverem cobertos (aí o desktop pode seguir sozinho).
  const itens = [...(Array.isArray(handoff.itens) ? handoff.itens : []), { tipo, em: new Date().toISOString() }];
  const tipos = new Set(itens.map(i => i?.tipo));
  const passos = FLUXOS[handoff.fluxo]?.passos || [];
  const concluido = passos.every(p => tipos.has(p));
  await sb(`captura_handoff?codigo_hash=eq.${hashCodigo(codigo)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ itens, envios: (handoff.envios || 0) + 1, ...(concluido ? { concluido_em: new Date().toISOString() } : {}) }),
  }).catch(() => {});

  res.status(200).json({ ok: true, tipo, concluido, faltam: passos.filter(p => !tipos.has(p)) });
}
