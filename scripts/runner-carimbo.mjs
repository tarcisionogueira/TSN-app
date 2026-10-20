#!/usr/bin/env node
// Carimbo da RODADA do runner residencial em sistema_heartbeat (20/10, #249).
// "O PC estava ligado de madrugada?" era deduzido de buraco em fonte_saude. Agora cada rodada diz QUEM a
// disparou (agenda do cron/Windows ou o recuperador, que só age quando a máquina volta depois de >6 h fora)
// e há quanto tempo foi a anterior completa — a madrugada perdida vira uma linha legível no banco.
// Uso: node scripts/runner-carimbo.mjs <chave> <detalhe>. Falha nunca derruba a rodada (é diagnóstico).
const [chave, detalhe] = process.argv.slice(2);
const URL_BASE = process.env.VITE_SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
if (!chave || !URL_BASE || !KEY) process.exit(0);
try {
  const r = await fetch(`${URL_BASE}/rest/v1/rpc/registrar_heartbeat`, {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_chave: chave, p_detalhe: String(detalhe || '').slice(0, 300) }),
  });
  if (!r.ok) console.error(`[carimbo] ${chave}: HTTP ${r.status}`);
} catch (e) { console.error(`[carimbo] ${chave}: ${e?.message || e}`); }
