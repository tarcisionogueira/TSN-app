/**
 * /api/documental-retry-cron — retenta laudos documentais PRELIMINARES.
 *
 * Quando o Claude não conclui a leitura dos documentos no tempo, o laudo sai
 * marcado como `preliminar: true`. Este cron roda de HORA EM HORA e, para cada
 * laudo preliminar criado nas últimas 48h, dispara um NOVO ciclo de geração
 * (/api/gerar-documental) com orçamento fresco — muitas vezes o Claude conclui
 * numa próxima tentativa (menos carga). Assim que a leitura conclui, o laudo
 * deixa de ser `preliminar` e para de ser retentado. Sem risco de rebaixar: só
 * mexe em laudos que ainda NÃO têm parecer real.
 *
 * Cada geração roda numa INVOCAÇÃO independente (fire-and-forget): a cron só
 * garante o disparo (aborta a própria conexão em ~9s) e não espera os ~200s.
 *
 * Roda de hora em hora (vercel.json). Autorizado por CRON_SECRET (Bearer).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
// Domínio canônico (www): o apex redireciona 308 — igual ao webhook do MP.
const BASE = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace('://bidprobrasil.com.br', '://www.bidprobrasil.com.br');
const LOTE = 4; // poucos por hora: cada um abre 1 chamada Claude longa

async function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) { res.status(500).json({ error: 'env ausente' }); return; }

  // Preliminares dentro das últimas 48h (mais antigos primeiro — dão a vez às que
  // esperam há mais tempo). Passadas 48h, paramos de retentar (não fica eterno).
  // A janela é medida em `created_at`, NÃO em `updated_at`: a própria retentativa reescreve
  // o updated_at, então o teto de 48h nunca chegava a valer — um documental que ficasse
  // preliminar era regerado a cada 6h para sempre, queimando IA e leitura de documento sem
  // nenhuma chance de sair do lugar. `created_at` é preservado pelo upsert.
  const desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
  const q = `analises_documental?status=eq.concluida&result->>preliminar=eq.true&created_at=gt.${encodeURIComponent(desde)}&order=created_at.asc&limit=${LOTE}&select=user_id,imovel_id,titulo,cidade,estado`;
  let rows = [];
  try { rows = await (await sb(q)).json(); } catch { rows = []; }
  if (!Array.isArray(rows) || !rows.length) { res.status(200).json({ ok: true, retentados: 0 }); return; }

  // Dispara em paralelo; aborta a própria conexão em ~9s (a geração continua no
  // destino, invocação independente, até concluir). allSettled p/ não travar a cron.
  await Promise.allSettled(rows.map((r) =>
    fetch(`${BASE}/api/gerar-documental`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
      body: JSON.stringify({ imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado }),
      signal: AbortSignal.timeout(9000),
    }).catch(() => {})
  ));

  res.status(200).json({ ok: true, retentados: rows.length });
}
