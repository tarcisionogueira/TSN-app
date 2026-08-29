import { fetchUnlockerContado } from './lib/bd-ledger.mjs';
/**
 * Recon FOCADO no bloco de PREÇOS/PRAÇAS de 1 lote LeilãoPro (não adivinhar preço — lição emiliomatos).
 * Dump do HTML (tags preservadas) ao redor de cada valor e das palavras praça/avaliação/lance.
 * Env: BRIGHTDATA_API_TOKEN, ZONE. LEILAOPRO_DET = URL de detalhe.
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
const DET = process.env.LEILAOPRO_DET || 'https://www.leffaleiloes.com.br/leilao/um-apartamento-no-edificio-longh-beach-com-area-real-privativa-de-103-250m2-na-rua-itapeva-n-316-situado-no-centro-da-cidade-de-/lote_id/7208';

if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes.'); process.exit(1); }

async function bdFetch(url, timeoutMs = 60000) {
  const r = await fetchUnlockerContado({
    method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: r.status, body: await r.text().catch(() => '') };
}

(async () => {
  const D = await bdFetch(DET);
  let b = D.body;
  console.log(`DETALHE → HTTP ${D.status} len=${b.length}`);
  // remove só script/style, mantém as tags de conteúdo p/ ver rótulos junto dos valores
  b = b.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const alvos = ['praça', 'praca', 'pra&ccedil;a', 'avalia', 'lance inicial', 'lance mínimo', 'lance minimo', '1ª', '2ª', '1&ordf;', '2&ordf;'];
  for (const a of alvos) {
    const i = b.toLowerCase().indexOf(a.toLowerCase());
    if (i >= 0) {
      const trecho = b.slice(Math.max(0, i - 220), i + 320).replace(/<[^>]+>/g, ' § ').replace(/\s*§\s*/g, ' | ').replace(/\s+/g, ' ').trim();
      console.log(`\n[«${a}»] …${trecho}…`);
    }
  }
  // Bloco em volta de cada valor monetário distinto
  const vals = [...new Set((b.replace(/<[^>]+>/g, ' ').match(/R\$\s?[\d.]+,\d{2}/g) || []))];
  console.log(`\n[valores distintos] ${vals.join(' | ')}`);
  for (const v of vals.slice(0, 6)) {
    const i = b.indexOf(v.replace('R$', '').trim());
    if (i >= 0) {
      const trecho = b.slice(Math.max(0, i - 260), i + 60).replace(/<[^>]+>/g, ' § ').replace(/\s*§\s*/g, ' | ').replace(/\s+/g, ' ').trim();
      console.log(`\n[valor ${v}] contexto ANTES: …${trecho.slice(-260)}…`);
    }
  }
})();
