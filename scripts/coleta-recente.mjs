#!/usr/bin/env node
// FREIO DO CUSTO PAGO (decisão do dono 30/07): o cron da CI (Bright Data) vira REDE DE
// SEGURANÇA — só roda se o runner RESIDENCIAL (grátis) não coletar a fonte há N dias.
// Fonte da verdade: coleta_cliente.ultima_em (o gate marca ao CONCLUIR uma coleta de
// casa). Imprime `pular=1|0` no stdout (consumido via $GITHUB_OUTPUT no workflow);
// detalhes vão para o stderr. Em erro de rede/config, imprime pular=0 (fail-open:
// melhor pagar uma coleta do que ficar sem acervo).
const [fonte, diasArg] = process.argv.slice(2);
const dias = Number(diasArg) || 7;
const URL_BASE = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!fonte || !URL_BASE || !KEY) {
  console.error('[coleta-recente] uso: coleta-recente.mjs <FONTE> [dias] (+ env VITE_SUPABASE_URL/SUPABASE_SERVICE_KEY)');
  console.log('pular=0');
  process.exit(0);
}
try {
  const r = await fetch(
    `${URL_BASE}/rest/v1/coleta_cliente?fonte=eq.${encodeURIComponent(fonte)}&select=ultima_em&limit=1`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(15000) },
  );
  const [row] = await r.json();
  const t = row?.ultima_em ? Date.parse(row.ultima_em) : 0;
  const fresco = t > 0 && Date.now() - t < dias * 86400000;
  console.error(`[coleta-recente] ${fonte}: última coleta residencial = ${row?.ultima_em || 'nunca'} → ${fresco ? `PULAR o cron pago (< ${dias} dias)` : 'RODAR via Bright Data (rede de segurança)'}`);
  console.log(`pular=${fresco ? 1 : 0}`);
} catch (e) {
  console.error('[coleta-recente] erro (fail-open):', String(e?.message || e).slice(0, 120));
  console.log('pular=0');
}
