/**
 * Existe lote de imóvel ABERTO no emiliomatos? — amostra ESPALHADA por páginas.
 * A listagem ordena encerrados-primeiro (as praças de 2025 vêm no topo), então amostrar só
 * o começo engana. Aqui pegamos lotes de páginas distintas (1,6,11,15) e checamos status +
 * data da praça via a lib. Se houver abertos, o scraper de produção (que pula encerrado
 * por lote) vai ingeri-los sozinho; se não houver, não há praça ativa agora.
 * Bright Data DIRETO (fora da cota). Não grava.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE. [PAGS] csv (default "1,6,11,15"), [POR_PAG] (default 3).
 */
import { BASE, extrairUrlsDeLote, parseDetalhe } from './lib/emiliomatos-parse.mjs';
import { fetchUnlockerContado } from './lib/bd-ledger.mjs';

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }
const PAGS = (process.env.PAGS || '1,6,11,15').split(',').map(s => parseInt(s, 10));
const POR_PAG = parseInt(process.env.POR_PAG || '3', 10);

async function bd(url, timeoutMs = 60000) {
  const r = await fetchUnlockerContado({
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, html: await r.text().catch(() => '') };
}
// data da praça no corpo ("… de 2025, 12:00" / "01/09/2026")
function dataPraca(html) {
  const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return (t.match(/\d{1,2}\/\d{1,2}\/20\d{2}/) || t.match(/\d{1,2}\s+de\s+\w+\s+de\s+20\d{2}/i) || [])[0] || '?';
}

(async () => {
  console.log(`Amostra espalhada — páginas ${PAGS.join(',')} × ${POR_PAG} lotes\n`);
  let abertos = 0, enc = 0, tot = 0;
  const urlsAbertos = [];
  for (const p of PAGS) {
    const l = await bd(`${BASE}/busca/segmento/imoveis${p > 1 ? `?page=${p}` : ''}`);
    const lotes = [...extrairUrlsDeLote(l.html).values()].slice(0, POR_PAG);
    console.log(`pág ${p}: ${lotes.length} lote(s)`);
    for (const u of lotes) {
      const d = await bd(u);
      const det = parseDetalhe(d.html, u);
      tot++;
      if (det.encerrado) enc++; else { abertos++; urlsAbertos.push(u); }
      console.log(`   ${det.encerrado ? '⛔' : '✅ ABERTO'}  ${det.cidade || '?'}/${det.estado || '?'}  data ${dataPraca(d.html)}  aval R$ ${det.valor_avaliacao} min R$ ${det.valor_minimo}  ${u.split('/').pop()}`);
    }
  }
  console.log(`\n═══ ${abertos} aberto(s) · ${enc} encerrado(s) de ${tot} amostrados ═══`);
  if (abertos) { console.log('ABERTOS achados:'); urlsAbertos.forEach(u => console.log('   ' + u)); console.log('→ vale gravar: o scraper ingere os abertos e pula os encerrados.'); }
  else console.log('→ nenhum aberto na amostra: emiliomatos parece sem praça de imóvel ativa agora. Gravar ingeriria zero.');
})();
