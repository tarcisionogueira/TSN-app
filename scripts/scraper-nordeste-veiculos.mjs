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
import { ehVeiculoInteiro, veiculoDoDetalhe, montarRowVeiculo, promoverLeilaoDePatio } from './lib/nordeste-veiculo.mjs';
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
  // Páginas de evento de pátio têm centenas de lotes: 45 s estourou em 2 de 13 no seco de 30/09.
  const motor = criarMotorDom({ esperaMs: 3500, timeoutMs: 90000 });
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

    // Teto de MAX detalhes por rodada e acervo maior que ele (100 no seco de 30/09): na ordem da
    // página os mesmos MAX seriam lidos sempre e o resto NUNCA. Primeiro o que ainda não está no
    // banco, depois o mais antigo. Sem conseguir ler o banco, a ordem da página (e o motivo no log).
    const idDe = (url) => montarRowVeiculo(url, {}).fonte_id;
    const { data: jaTem, error: eJa } = await supabase.from('veiculos_leilao')
      .select('fonte_id, atualizado_em').eq('fonte', 'NORDESTE').in('fonte_id', alvos.map(idDe));
    if (eJa) console.warn(`  sem a idade dos já gravados (${eJa.message}) — ordem da página`);
    const idade = new Map((jaTem || []).map((r) => [r.fonte_id, r.atualizado_em || '']));
    alvos.sort((a, b) => {
      const ia = idade.has(idDe(a)) ? idade.get(idDe(a)) : null, ib = idade.has(idDe(b)) ? idade.get(idDe(b)) : null;
      if (ia === null || ib === null) return (ia === null ? 0 : 1) - (ib === null ? 0 : 1);
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
    console.log(`  ${alvos.length - idade.size} novo(s) na frente · lendo ${Math.min(MAX, alvos.length)}`);

    const rows = [], contatos = new Map();
    let falhas = 0;
    for (const url of alvos.slice(0, MAX)) {
      const r = await motor.fetchFonte(url);
      if (!r.html) { falhas++; console.warn(`  detalhe não abriu: ${url} (${r.via})`); continue; }
      const v = veiculoDoDetalhe(r.html, url);
      if (v.motivo) { falhas++; console.warn(`  ${url}: ${v.motivo}`); continue; }
      if (!v.valor_minimo) { falhas++; console.warn(`  ${url}: sem valor`); continue; }
      const row = montarRowVeiculo(url, v);
      // Regra do dono (13/09): bem com o executado/devedor nunca é gravado.
      if (row.status_patio === 'excluido') { console.warn(`  ${url}: com o executado/devedor — não gravado`); continue; }
      rows.push(row);
      if (v.email_leiloeiro) contatos.set(v.leiloeiro, { leiloeiro: v.leiloeiro, email: v.email_leiloeiro, obs: 'payload do lote (nordesteleiloes.com.br)' });
      if (rows.length <= 8) console.log(`  [${DRYRUN ? 'seco' : 'ok'}] ${row.tipo_veiculo} · ${row.marca || '?'} ${row.modelo || ''} ${row.ano_modelo || ''} · R$ ${row.valor_minimo} / aval ${row.valor_avaliacao} · ${row.cidade || '?'}/${row.estado || '?'} · placa ${row.placa || '—'} · ativo=${row.ativo}`);
    }
    // LEILÃO DE PÁTIO COMO PROVA (07/10, decisão do dono): a Nordeste não publica descrição nos
    // lotes de pátio (recon na página viva), então o classificador não tem texto para ler e eles
    // ficavam fora de /veiculos. A nomenclatura "VEÍCULO CONSERVADO" do leiloeiro é a prova —
    // vetada no leilão inteiro se algum lote dele acusar bem com o executado.
    const antes = rows.filter((r) => r.status_patio === 'confirmado').length;
    promoverLeilaoDePatio(rows);
    const promovidos = rows.filter((r) => r.status_patio === 'confirmado').length - antes;
    if (promovidos) console.log(`  ${promovidos} lote(s) de leilão de pátio promovidos a 'confirmado' (sem ficha publicada pelo leiloeiro)`);

    // Mesma foto em 3+ lotes = imagem genérica do site (banner/logo), não foto do bem (regra de anularFotoRepetida).
    const freq = new Map();
    for (const r of rows) if (r.fotos) freq.set(r.fotos[0], (freq.get(r.fotos[0]) || 0) + 1);
    let genericas = 0;
    for (const r of rows) if (r.fotos && freq.get(r.fotos[0]) >= 3) { delete r.fotos; genericas++; }
    console.log(`  prontos: ${rows.length} · falhas: ${falhas} · com foto: ${rows.filter((r) => r.fotos).length}${genericas ? ` (${genericas} genérica(s) descartada(s))` : ''} · contatos de leiloeiro: ${contatos.size}`);

    if (!DRYRUN && rows.length) {
      // Em GRUPOS de mesmo conjunto de colunas: num upsert misto o PostgREST grava NULL na coluna que falta, e o
      // lote cuja foto não veio nesta rodada perderia a que já tinha (mesma regra do scraper-globo/astavero).
      const grupos = new Map();
      for (const r of rows) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
      let gravados = 0;
      for (const g of grupos.values()) {
        const { data, error } = await supabase.from('veiculos_leilao').upsert(g, { onConflict: 'fonte,fonte_id' }).select('id');
        if (error) throw new Error(`upsert veiculos: ${error.message}`);
        gravados += data?.length || 0;
      }
      console.log(`✅ ${gravados} veículos NORDESTE gravados/atualizados.`);
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
