/**
 * DRY-RUN do parser de PRODUÇÃO (lib/leilaopro-parse) sobre lotes VIVOS via Bright Data.
 * Valida CADA campo (título, cidade/UF, tipo, avaliação, mínimo, desconto, área, data,
 * modalidade, docs, encerrado) ANTES de qualquer grava no acervo do cliente. Não grava nada.
 * Env: BRIGHTDATA_API_TOKEN, ZONE. LEILAOPRO_TENANT (leffa|oscar), LEILAOPRO_MAX (default 8).
 */
import { TENANTS, extrairUrlsDeLote, parseDetalhe, montarRow, checarQualidade } from './lib/leilaopro-parse.mjs';
import { fetchUnlockerContado } from './lib/bd-ledger.mjs';

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const tenant = TENANTS[process.env.LEILAOPRO_TENANT || 'leffa'];
const MAX = Number(process.env.LEILAOPRO_MAX || 8);

if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }
if (!tenant) { console.log('tenant inválido'); process.exit(1); }

async function bdFetch(url, timeoutMs = 60000) {
  try {
    const r = await fetchUnlockerContado({
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}
const brl = v => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 });

(async () => {
  console.log(`DRY-RUN ${tenant.fonte} — ${tenant.base}/leilao/lotes/imoveis (max ${MAX})\n`);
  const L = await bdFetch(tenant.base + '/leilao/lotes/imoveis');
  const urls = extrairUrlsDeLote(L.body, tenant.base);
  console.log(`Listagem HTTP ${L.status} · ${urls.size} lote(s) de imóvel\n`);

  let ok = 0, encerrados = 0, ruins = 0;
  const vistos = [...urls.values()].slice(0, MAX);
  for (const url of vistos) {
    const D = await bdFetch(url);
    if (D.status !== 200 || !D.body) { console.log(`✗ ${url} → HTTP ${D.status}`); ruins++; continue; }
    const det = parseDetalhe(D.body, url);
    if (det.encerrado) { encerrados++; console.log(`— ENCERRADO: ${(det.titulo || '').slice(0, 60)} (${det.cidade}/${det.estado})`); continue; }
    const row = montarRow(url, det, tenant);
    const q = checarQualidade(row, { estrito: true });
    const desc = row.desconto_percentual;
    console.log(`${q.ok ? '✓' : '⚠'} [${row.fonte_id}] ${row.tipo.toUpperCase()} · ${row.cidade || '??'}/${row.estado || '??'}`);
    console.log(`    título: ${(row.titulo || '').slice(0, 78)}`);
    console.log(`    avaliação R$ ${brl(row.valor_avaliacao)} · mínimo R$ ${brl(row.valor_minimo)} · desconto ${desc == null ? '—' : desc + '%'} · área ${row.area_m2 || '—'} m²`);
    console.log(`    modalidade: ${row.modalidade} · praça: ${row.data_leilao || '—'} · foto: ${row.link_foto ? 'sim' : 'NÃO'} · docs: ${row.anexos.length} (${row.anexos.map(a => a.tipo).join(',') || '—'})`);
    if (!q.ok) { console.log(`    ⚠ qualidade: falta ${q.faltando?.join(', ') || q.motivo || 'reprovado'}`); ruins++; } else ok++;
  }
  console.log(`\n═══ ${ok} OK · ${encerrados} encerrados · ${ruins} com ressalva (de ${vistos.length} vistos) ═══`);
  console.log('Confira campo-a-campo contra o site ANTES de liberar a grava.');
})();
