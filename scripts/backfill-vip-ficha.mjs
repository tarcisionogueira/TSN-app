/**
 * Passada ÚNICA (#141, 08/10): preenche a ficha (descrição, endereço, CEP, ocupação) dos lotes
 * VIP ativos que a coleta diária não revisita — os `sem_lance` mantidos ativos por 15 dias para
 * proposta de compra e os que saíram da agenda. Usa o MESMO leitor testado da coleta
 * (scripts/lib/vip-ficha.mjs). Só preenche o que está vazio/eco; nunca apaga.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY · VIP_BACKFILL_MAX (150) · VIP_BACKFILL_SECO=1 (não grava)
 */
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';
import { fichaVip } from './lib/vip-ficha.mjs';

const MAX = Number(process.env.VIP_BACKFILL_MAX || 150);
const SECO = process.env.VIP_BACKFILL_SECO === '1';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const eco = (r) => { const d = String(r.descricao || '').trim(); const t = String(r.titulo || '').trim(); return !d || (t && d.replace(t, '').replace(/[\s—·|-]+/g, '').length < 40); };

const { data: rows, error } = await supabase.from('imoveis_leilao')
  .select('id, fonte_id, titulo, descricao, endereco, cep, ocupacao, url_lote')
  .eq('fonte', 'VIP').eq('ativo', true).not('url_lote', 'is', null).limit(1000);
if (error) { console.error(`Não consegui ler o acervo VIP: ${error.message}`); process.exit(2); }
const alvos = rows.filter(eco).slice(0, MAX);
console.log(`VIP backfill ${SECO ? '(SECO)' : '(GRAVANDO)'}: ${alvos.length} de ${rows.length} ativos com descrição eco do título`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
let gravados = 0, semPainel = 0, falhas = 0;
try {
  for (const r of alvos) {
    try {
      const resp = await page.goto(r.url_lote, { waitUntil: 'networkidle2', timeout: 30000 });
      if (!resp || resp.status() >= 400) { falhas++; console.log(`  ${r.fonte_id}: HTTP ${resp?.status()}`); continue; }
      const f = fichaVip(await page.evaluate(() => document.body.innerText || ''));
      if (!f.descricao) { semPainel++; console.log(`  ${r.fonte_id}: painel "Descrição" não encontrado`); continue; }
      const patch = { descricao: f.descricao };
      if (f.endereco && !r.endereco) patch.endereco = f.endereco;
      if (f.cep && !r.cep) patch.cep = f.cep;
      if (f.ocupacao && !r.ocupacao) patch.ocupacao = f.ocupacao;
      if (SECO) { gravados++; console.log(`  ${r.fonte_id}: (seco) ${Object.keys(patch).join(', ')}`); continue; }
      // `.select()` prova o que mudou — update que não alcança linha nenhuma devolve error null.
      const { data: up, error: eu } = await supabase.from('imoveis_leilao').update(patch).eq('id', r.id).select('id');
      if (eu || !up?.length) { falhas++; console.log(`  ${r.fonte_id}: não gravou (${eu?.message || '0 linhas'})`); continue; }
      gravados++;
    } catch (e) { falhas++; console.log(`  ${r.fonte_id}: ${String(e.message).slice(0, 80)}`); }
  }
} finally { await browser.close(); }
console.log(`\nVIP backfill: ${gravados} preenchidos · ${semPainel} sem painel · ${falhas} falhas · de ${alvos.length} alvos`);
if (alvos.length && gravados === 0) process.exitCode = 1;
