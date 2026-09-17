// Disposável: regera UM relatório mercadológico específico via o caminho de
// cron (isCron, sem cobrar cota) — mesmo padrão usado pelos self-heals de
// api/regenerar-relatorios-cron.js. Uso único: validar o fix de
// parcelamento/forma_pagamento no lote ZUK (17/09). Apagar depois de usar.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const BASE = 'https://www.bidprobrasil.com.br';
const IMOVEL_ID = process.env.REGEN_IMOVEL_ID;

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

const [row] = await (await sb(
  `analises_mercado?imovel_id=eq.${encodeURIComponent(IMOVEL_ID)}&select=user_id,titulo,cidade,estado,imovel,inputs&limit=1`
)).json();

if (!row?.inputs?.mercadoInputs) {
  console.error('Sem inputs.mercadoInputs — não dá para regerar.', JSON.stringify(row));
  process.exit(1);
}

console.log('Regerando para user_id:', row.user_id, '| titulo:', row.titulo);

const r = await fetch(`${BASE}/api/gerar-analise`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
  body: JSON.stringify({
    imovelId: IMOVEL_ID,
    paraUserId: row.user_id,
    titulo: row.titulo,
    cidade: row.cidade,
    estado: row.estado,
    imovel: row.imovel || null,
    mercadoInputs: row.inputs.mercadoInputs,
    parecerInputs: row.inputs.parecerInputs,
  }),
  signal: AbortSignal.timeout(120000),
});

const txt = await r.text();
console.log('Status:', r.status);
console.log(txt.slice(0, 3000));
