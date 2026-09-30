/**
 * Scraper NORDESTE — VEÍCULOS INTEIROS (30/09, pedido do dono: "pode integrar só os veículos
 * inteiros da NORDESTE"). O coletor de imóveis (scraper-nordeste.mjs) descarta pela URL os ~400
 * lotes de bem móvel das varas federais/TRT-5; aqui entram só os veículos inteiros (sem sucata,
 * peça ou carcaça) em `veiculos_leilao`. Mesma enumeração (home → eventos → lotes), mesmo motor
 * `dom` (grátis, sem Bright Data) e o parser puro `lib/nordeste-veiculo.mjs`.
 *
 * Env: NORDESTE_VEIC_MAX (60 detalhes/rodada) · NORDESTE_MAX_EVENTOS (15) · NORDESTE_VEIC_DRYRUN
 * (default '1' — grava só com '0'). Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote } from './lib/nordeste-parse.mjs';
import { ehVeiculoInteiro, veiculoDoDetalhe, montarRowVeiculo } from './lib/nordeste-veiculo.mjs';
import { registrarSaude } from './_saude-fonte.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);
const DRYRUN = process.env.NORDESTE_VEIC_DRYRUN !== '0';
const MAX = Number(process.env.NORDESTE_VEIC_MAX || 60);
const MAX_EVENTOS = Number(process.env.NORDESTE_MAX_EVENTOS || 15);
const FONTE_SAUDE = 'NORDESTE_VEICULOS';

async function main() {
  const { base } = TENANTS.nordeste;
  const motor = criarMotorDom({ esperaMs: 3500 });
  console.log(`NORDESTE veículos ${DRYRUN ? '(SECO — não grava)' : '(GRAVANDO)'} · até ${MAX} detalhes`);
  try {
    const home = await motor.fetchFonte(`${base}/`);
    if (!home.html) throw new Error(`home não abriu (${home.via})`);
    const eventos = [...extrairUrlsDeEvento(home.html, base).values()].slice(0, MAX_EVENTOS);
    const lotes = new Map();
    let eventosLidos = 0;
    for (const ev of eventos) {
      const r = await motor.fetchFonte(ev);
      if (!r.html) { console.warn(`  evento não abriu: ${ev} (${r.via})`); continue; }
      eventosLidos++;
      for (const [id, url] of extrairUrlsDeLote(r.html, base)) lotes.set(id, url);
    }
    const alvos = [...lotes.values()].filter(ehVeiculoInteiro);
    console.log(`  ${eventosLidos}/${eventos.length} eventos · ${lotes.size} lotes · ${alvos.length} veículos inteiros`);

    const rows = [], contatos = new Map();
    let falhas = 0;
    for (const url of alvos.slice(0, MAX)) {
      const r = await motor.fetchFonte(url);
      if (!r.html) { falhas++; console.warn(`  detalhe não abriu: ${url} (${r.via})`); continue; }
      const v = veiculoDoDetalhe(r.html, url);
      if (v.motivo) { falhas++; console.warn(`  ${url}: ${v.motivo}`); continue; }
      if (!v.valor_minimo) { falhas++; console.warn(`  ${url}: sem valor`); continue; }
      const row = montarRowVeiculo(url, v);
      rows.push(row);
      if (v.email_leiloeiro) contatos.set(v.leiloeiro, { leiloeiro: v.leiloeiro, email: v.email_leiloeiro, obs: 'payload do lote (nordesteleiloes.com.br)' });
      if (rows.length <= 8) console.log(`  [${DRYRUN ? 'seco' : 'ok'}] ${row.tipo_veiculo} · ${row.marca || '?'} ${row.modelo || ''} ${row.ano_modelo || ''} · R$ ${row.valor_minimo} / aval ${row.valor_avaliacao} · ${row.cidade || '?'}/${row.estado || '?'} · placa ${row.placa || '—'} · ativo=${row.ativo}`);
    }
    console.log(`  prontos: ${rows.length} · falhas: ${falhas} · contatos de leiloeiro: ${contatos.size}`);

    if (!DRYRUN && rows.length) {
      const { data, error } = await supabase.from('veiculos_leilao').upsert(rows, { onConflict: 'fonte,fonte_id' }).select('id');
      if (error) throw new Error(`upsert veiculos: ${error.message}`);
      console.log(`✅ ${data?.length || 0} veículos NORDESTE gravados/atualizados.`);
      if (contatos.size) {
        const { error: ec } = await supabase.rpc('contato_leiloeiro_tenant_auto', { p_fonte: 'NORDESTE', p_itens: [...contatos.values()] });
        if (ec) console.warn(`  contatos não gravados: ${ec.message}`);
      }
    }
    if (!DRYRUN) {
      await registrarSaude(supabase, FONTE_SAUDE, rows, 'dom', {
        ok: eventosLidos === eventos.length && falhas === 0, enumerados: alvos.length,
        motivo: eventosLidos < eventos.length ? `${eventos.length - eventosLidos} evento(s) não abriram` : (falhas ? `${falhas} detalhe(s) falharam` : ''),
      });
    }
  } finally { await motor.fechar(); }
}

main().catch(async (e) => {
  console.error('NORDESTE veículos falhou:', e?.message || e);
  if (!DRYRUN) await registrarSaude(supabase, FONTE_SAUDE, [], 'dom', { ok: false, motivo: String(e?.message || e).slice(0, 200) }).catch(() => {}); // padrao-ok: registrar a falha é best-effort; o exit 1 abaixo já reprova o job
  process.exit(1);
});
