/**
 * DRY-RUN do PARSER de produção do EMILIOMATOS, fora do ledger de cota.
 * Importa a MESMA lib que o scraper grava (lib/emiliomatos-parse.mjs) e roda em N lotes reais
 * via Bright Data DIRETO (api.brightdata.com — não passa pela cota semanal). Não grava nada.
 * Serve para conferir preço/status/campos ANTES de liberar teto e gravar de verdade.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE. [PARSE_N] (default 6).
 */
import { BASE, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade } from './lib/emiliomatos-parse.mjs';

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const N = parseInt(process.env.PARSE_N || '6', 10);
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bd(url, timeoutMs = 60000) {
  const r = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, html: await r.text().catch(() => '') };
}

(async () => {
  console.log(`DRY-RUN do parser de produção — ${N} lotes reais (Bright Data direto)\n`);
  const lista = await bd(`${BASE}/busca/segmento/imoveis`);
  const lotes = [...extrairUrlsDeLote(lista.html).values()].slice(0, N);
  console.log(`listagem HTTP ${lista.status} → ${lotes.length} lote(s) para testar\n`);

  let bons = 0, enc = 0, reprov = 0;
  for (const url of lotes) {
    const d = await bd(url);
    const det = parseDetalhe(d.html, url);
    const row = montarRow(url, det);
    const q = checarQualidade(row, { estrito: false });
    const flag = det.encerrado ? '⛔ ENCERRADO' : q.descartar ? `✗ descartado (${q.motivo || '?'})` : '✓ ingerível';
    if (det.encerrado) enc++; else if (q.descartar) reprov++; else bons++;
    console.log(`── ${url.split('/').pop()}  ${flag}`);
    console.log(`   titulo: ${row.titulo}`);
    console.log(`   local : ${row.cidade || '?'}/${row.estado || '?'}  · tipo ${row.tipo} · ${row.modalidade} · ${row.area_m2 || '?'} m²`);
    console.log(`   ofertas: ${JSON.stringify(det.ofertas)}`);
    console.log(`   aval R$ ${row.valor_avaliacao}  · mín R$ ${row.valor_minimo}  · desconto ${row.desconto_percentual ?? '—'}%  · score ${row.score_viabilidade}`);
    console.log(`   foto ${row.link_foto ? 'ok' : '—'} · matrícula ${row.numero_matricula || '—'} · ${(row.anexos || []).length} anexo(s)`);
  }
  console.log(`\n═══ ${bons} ingerível(is) · ${enc} encerrado(s) · ${reprov} descartado(s) de ${lotes.length} ═══`);
  console.log('Confira: desconto plausível (não ~98%), aval≥mín, cidade/UF certos, encerrados pulados.');
})();
