/**
 * GET /api/limpar-documentos-cron
 * Cron diário: apaga arquivos de imovel_anexos onde:
 *   - data_leilao + 90 dias < hoje
 *   - arrematado = false
 *   - storage_path IS NOT NULL (arquivo existe no bucket)
 *
 * Mantém registros do banco (sem storage_path) para auditoria.
 * Processa em lotes de 50 para não exceder o timeout da Edge.
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

  const hoje = new Date();
  const corte = new Date(hoje);
  corte.setDate(corte.getDate() - 90);
  const corteISO = corte.toISOString().slice(0, 10); // YYYY-MM-DD

  // Busca anexos elegíveis para exclusão (leilão encerrado há 90+ dias, não arrematado, com arquivo)
  const listRes = await sb(
    `imovel_anexos?arrematado=eq.false&data_leilao=lte.${corteISO}&storage_path=not.is.null&select=id,storage_path&limit=50`
  );

  if (!listRes.ok) {
    return new Response(JSON.stringify({ error: 'Erro ao buscar anexos' }), { status: 500 });
  }

  const anexos = await listRes.json();
  if (!anexos.length) {
    return new Response(JSON.stringify({ msg: 'Nenhum documento para limpar', corte: corteISO }), { status: 200 });
  }

  const paths = anexos.map(a => a.storage_path);
  const ids   = anexos.map(a => a.id);

  // Remove arquivos do bucket em lote
  const delStorage = await storage(`object/${BUCKET}`, {
    method: 'DELETE',
    body: JSON.stringify({ prefixes: paths }),
  });

  // Limpa storage_path no banco (mantém o registro para auditoria)
  const updateRes = await sb(`imovel_anexos?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    body: JSON.stringify({ storage_path: null, url: null }),
  });

  return new Response(JSON.stringify({
    removidos: paths.length,
    storage_ok: delStorage.ok,
    banco_ok: updateRes.ok,
    corte: corteISO,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
