/**
 * QA — Gera o relatório documental/jurídico para uma lista de imóveis de amostra,
 * usando o caminho CRON do /api/gerar-documental (x-cron-secret + paraUserId): não
 * exige sessão de usuário nem consome cota. Serve para validar, após um scrape com
 * captura de documentos, se as IAs conseguem LER matrícula/edital/anexos e emitir
 * o laudo em cada fonte nova (ZUK, SODRE, PESTANA, ...).
 *
 * Env necessários (secrets do GitHub Actions):
 *   APP_BASE_URL           ex.: https://app.bidprobrasil.com.br
 *   CRON_SECRET            o mesmo do endpoint
 *   AMOSTRA_IDS            imovelIds separados por vírgula
 *   AMOSTRA_PARA_USER      user_id (perfil) sob o qual as análises são gravadas
 */

const BASE = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');
const CRON = process.env.CRON_SECRET || '';
const IDS = String(process.env.AMOSTRA_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const PARA = String(process.env.AMOSTRA_PARA_USER || '').trim();

if (!BASE || !CRON) { console.error('❌ APP_BASE_URL/CRON_SECRET ausentes'); process.exit(1); }
if (!IDS.length || !PARA) { console.error('❌ AMOSTRA_IDS/AMOSTRA_PARA_USER ausentes'); process.exit(1); }

const sev = (r) => `${r?.nivelRisco || '?'} | docs lidos: matrícula=${!!r?.documentosAnalisados?.matricula} edital=${!!r?.documentosAnalisados?.edital} laudo=${!!r?.documentosAnalisados?.laudo}`;

async function gerar(imovelId) {
  const t0 = Date.now();
  try {
    const resp = await fetch(`${BASE}/api/gerar-documental`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': CRON },
      body: JSON.stringify({ imovelId, paraUserId: PARA }),
    });
    const txt = await resp.text();
    let j = null; try { j = JSON.parse(txt); } catch { /* html/erro */ }
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    if (!resp.ok) { console.log(`  ✗ ${imovelId} → HTTP ${resp.status} (${secs}s) ${txt.slice(0, 160)}`); return; }
    const r = j?.result || j?.parecer ? j : (j?.analise || j);
    const parecer = r?.parecer || r?.result?.parecer;
    const nivel = r?.nivelRisco || r?.result?.nivelRisco;
    const docs = r?.documentosAnalisados || r?.result?.documentosAnalisados;
    const falt = r?.faltando || r?.result?.faltando;
    const prelim = r?.preliminar ?? r?.result?.preliminar;
    console.log(`  ✓ ${imovelId} (${secs}s) → nível=${nivel} preliminar=${prelim} faltando=${JSON.stringify(falt || [])} docs=${JSON.stringify(docs || {})}`);
    if (parecer) console.log(`      parecer: ${String(parecer).slice(0, 220).replace(/\s+/g, ' ')}...`);
  } catch (e) {
    console.log(`  ✗ ${imovelId} → erro ${String(e.message).slice(0, 120)}`);
  }
}

(async () => {
  console.log(`\n🧪 Gerando ${IDS.length} análises de amostra via ${BASE}/api/gerar-documental\n`);
  for (const id of IDS) { await gerar(id); }
  console.log('\n✅ Concluído. Leia analises_documental no Supabase para a síntese completa.');
})();
