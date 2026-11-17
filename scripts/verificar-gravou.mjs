/**
 * Trava de fim de job (auditoria de captura, 17/11, item 5): o workflow só fica verde se ALGUMA
 * fonte do job coletou. Em 16/11 o "Scraper Firecrawl (semanal)" fechou com sucesso e as 4 fontes
 * dele tinham voltado `firecrawl-500` — sucesso carimbado sem nada gravado (forma nº 5).
 *
 * Uso: node scripts/verificar-gravou.mjs <ISO do início do job> FONTE1,FONTE2,...
 * Reprova (exit 1) quando: nenhuma das fontes reportou saúde desde o início (o passo nem chegou a
 * medir), ou TODAS as que reportaram vieram `falhou`. `sem_cota` é decisão de orçamento: não
 * reprova, mas é dito no log. Não consegue ler o banco → exit 2 (não checar não é "está tudo bem").
 */
import './lib/env-runner.mjs';

const [desde, lista] = process.argv.slice(2);
const fontes = String(lista || '').split(',').map((f) => f.trim()).filter(Boolean);
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!desde || !fontes.length || !SB_URL || !SB_KEY) {
  console.error('uso: verificar-gravou.mjs <desde ISO> <FONTES csv> (com VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY)');
  process.exit(2);
}

const url = `${SB_URL}/rest/v1/fonte_saude?select=fonte,status,motivo,total&executado_em=gte.${encodeURIComponent(desde)}`
  + `&fonte=in.(${fontes.map(encodeURIComponent).join(',')})&order=executado_em.desc`;
let linhas;
try {
  const r = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  linhas = await r.json();
} catch (e) {
  console.error('::error::não consegui ler fonte_saude —', e.message);
  process.exit(2);
}

const ultima = new Map();
for (const l of linhas) if (!ultima.has(l.fonte)) ultima.set(l.fonte, l);
for (const f of fontes) {
  const l = ultima.get(f);
  console.log(`${f}: ${l ? `${l.status} (${l.total ?? 0}) ${String(l.motivo || '').slice(0, 120)}` : 'NÃO REPORTOU'}`);
}
const reportaram = [...ultima.values()];
if (!reportaram.length) { console.error('::error::nenhuma fonte do job reportou saúde — o job não mediu nada'); process.exit(1); }
const medidas = reportaram.filter((l) => l.status !== 'sem_cota');
if (!medidas.length) { console.log('::warning::todas pararam por orçamento (sem_cota) — decisão de custo, não falha'); process.exit(0); }
if (medidas.every((l) => l.status === 'falhou')) {
  console.error(`::error::todas as ${medidas.length} fonte(s) medidas falharam — o job não gravou nada`);
  process.exit(1);
}
console.log(`ok: ${medidas.filter((l) => l.status !== 'falhou').length} de ${medidas.length} fonte(s) coletaram`);
