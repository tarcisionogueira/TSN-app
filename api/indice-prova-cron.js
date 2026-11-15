// CONFERÊNCIA AO VIVO DOS LINKS DO ÍNDICE (15/11, arena #484). A cada hora: lê as respostas do lote pedido na rodada
// anterior (indice_prova_ler: conferido / morto / não conferível → indice_link_prova) e pede o próximo lote de até 50
// (indice_prova_pedir → pg_net, grátis). Toda a lógica mora no banco; este cron só dispara e deixa rastro.
// Ordem LER → PEDIR: o pg_net só busca depois do commit, então o lote pedido agora é lido na próxima hora.
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function rpc(nome, body = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: 'POST',
    signal: AbortSignal.timeout(40000),
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const texto = await r.text();
  if (!r.ok) throw new Error(`${nome}: HTTP ${r.status} ${texto.slice(0, 200)}`);
  return texto ? JSON.parse(texto) : null;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { res.status(500).json({ error: 'Config ausente' }); return; }
  try {
    const lidas = await rpc('indice_prova_ler');
    const pedidos = await rpc('indice_prova_pedir', { p_lim: Math.min(100, Math.max(1, Number(req.query?.lote) || 50)) });
    // Carimbo para o health-check saber que a conferência roda (falhar aqui não derruba a rodada, mas fica no log).
    await rpc('registrar_heartbeat', { p_chave: 'indice_prova', p_detalhe: JSON.stringify({ lidas, pedidos }) })
      .catch((e) => console.error('[indice-prova] heartbeat não gravado:', e.message));
    console.log('[indice-prova]', JSON.stringify({ lidas, pedidos }));
    res.status(200).json({ ok: true, lidas, pedidos });
  } catch (e) {
    console.error('[indice-prova] falhou:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
}
