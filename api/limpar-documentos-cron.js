/**
 * GET /api/limpar-documentos-cron
 * Cron diário: apaga do bucket os documentos (edital/matrícula/anexos) elegíveis
 * pela RETENÇÃO EM CAMADAS (RPC anexos_expirados):
 *   • SEM data (venda direta)  → mantém enquanto o imóvel está no acervo; apaga
 *                                 quando a CEF o retira (imoveis_leilao.ativo=false).
 *   • COM data + sem reunião   → apaga no dia seguinte ao leilão (curioso gera de novo).
 *   • COM data + reunião       → mantém 30 dias após o leilão (janela p/ arremate).
 *   • arrematado = true        → nunca apaga (permanente).
 *
 * Mantém o registro no banco (sem storage_path/url) para auditoria.
 * Processa em lotes para não estourar o timeout da Edge.
 */

export const runtime = 'edge';

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET       = 'documentos';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function storage(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });

  // A regra em camadas (com/sem reunião) vive na RPC anexos_expirados — junta
  // imovel_anexos × reunioes × casos, o que o filtro PostgREST não faz sozinho.
  const rpcRes = await sb('rpc/anexos_expirados', {
    method: 'POST',
    body: JSON.stringify({ p_limite: 200 }),
  });
  if (!rpcRes.ok) {
    return new Response(JSON.stringify({ error: 'Erro ao apurar anexos expirados', detalhe: await rpcRes.text().catch(() => '') }), { status: 500 });
  }

  const anexos = await rpcRes.json().catch(() => []);
  if (!Array.isArray(anexos) || !anexos.length) {
    return new Response(JSON.stringify({ msg: 'Nenhum documento para limpar' }), { status: 200 });
  }

  const paths = anexos.map(a => a.storage_path).filter(Boolean);
  const ids   = anexos.map(a => a.id);

  // Remove os arquivos do bucket em lote (best-effort).
  const delStorage = await storage(`object/${BUCKET}`, {
    method: 'DELETE',
    body: JSON.stringify({ prefixes: paths }),
  });

  // Zera storage_path/url no banco (mantém a linha para auditoria).
  const updateRes = await sb(`imovel_anexos?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    body: JSON.stringify({ storage_path: null, url: null }),
  });

  return new Response(JSON.stringify({
    removidos: paths.length,
    storage_ok: delStorage.ok,
    banco_ok: updateRes.ok,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
