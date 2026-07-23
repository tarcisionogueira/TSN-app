/**
 * Recon PROFUNDO de páginas específicas (listing + detalhe) de um cluster de leiloeiros —
 * o passo seguinte ao recon-leiloeiros-backlog.mjs (que só classifica a plataforma pela home).
 * Aqui buscamos URLs concretas e imprimimos EXTRATOS ESTRUTURADOS (links, texto visível,
 * contextos de R$/m²/matrícula/praça, e o HTML do 1º "card" repetido) para desenhar os
 * mappers do scraper novo SEM adivinhar. Só DIAGNOSTICA — não grava nada no banco.
 *
 * Roda no GitHub Actions (egress liberado) via Bright Data Web Unlocker — os sites batem
 * 403/challenge no IP de datacenter. Chama a API do Bright Data DIRETO → NÃO passa pela cota
 * semanal (450). Teto próprio: DEEP_MAX (default 12).
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, DEEP_URLS (csv de URLs completas), [DEEP_MAX].
 */

const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE  = process.env.BRIGHTDATA_ZONE;
const DEEP_MAX = parseInt(process.env.DEEP_MAX || '12', 10);
const URLS = (process.env.DEEP_URLS || '').split(',').map(s => s.trim()).filter(Boolean);

let usados = 0;
async function bdFetch(url, timeoutMs = 60000) {
  const r = await fetch('https://api.brightdata.com/request', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ zone: ZONE, url, format: 'raw' }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  usados++;
  return { status: r.status, html: await r.text().catch(() => '') };
}

// Texto visível: remove script/style/comentários, decodifica entidades básicas, colapsa ws.
function textoVisivel(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&ordm;/gi, 'º')
    .replace(/&aacute;/gi, 'á').replace(/&atilde;/gi, 'ã').replace(/&ccedil;/gi, 'ç')
    .replace(/&eacute;/gi, 'é').replace(/&oacute;/gi, 'ó').replace(/&iacute;/gi, 'í')
    .replace(/\s+/g, ' ')
    .trim();
}

// Contextos: ~70 chars ao redor de cada marcador-chave (dedup).
function contextos(txt, re, span = 70, max = 14) {
  const out = [];
  let m;
  const rg = new RegExp(re, 'gi');
  while ((m = rg.exec(txt)) && out.length < max) {
    const i = m.index;
    out.push('…' + txt.slice(Math.max(0, i - span), i + m[0].length + span).trim() + '…');
  }
  return [...new Set(out)];
}

// Todos os href, categorizados (relativos e absolutos), dedup.
function hrefs(html) {
  const all = [...new Set((html.match(/href=["']([^"'#]+)["']/gi) || [])
    .map(s => (s.match(/href=["']([^"']+)/i) || [])[1])
    .filter(u => u && !/^(mailto:|tel:|javascript:|https?:\/\/(?:www\.)?(?:facebook|instagram|wa\.me|whatsapp|google|youtube))/i.test(u)))];
  return all;
}

// Primeiro bloco de HTML "cru" que casa um marcador — revela o template do card p/ seletores.
function blocoBruto(html, re, ctx = 900, max = 2) {
  const out = [];
  let m;
  const rg = new RegExp(re, 'gi');
  while ((m = rg.exec(html)) && out.length < max) {
    const i = m.index;
    out.push(html.slice(Math.max(0, i - ctx), i + ctx).replace(/\s+/g, ' ').trim());
    rg.lastIndex = i + ctx; // pula à frente p/ não repetir o mesmo card
  }
  return out;
}

(async () => {
  if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes — abortando (nada gasto).'); process.exit(1); }
  if (!URLS.length) { console.log('⚠️ DEEP_URLS vazio — nada a fazer.'); process.exit(1); }
  console.log(`Recon PROFUNDO — ${URLS.length} URLs · teto ${DEEP_MAX} requests Bright Data.\n`);

  for (let i = 0; i < URLS.length; i++) {
    if (usados >= DEEP_MAX) { console.log(`\n⛔ Teto ${DEEP_MAX} atingido — parando. Faltaram: ${URLS.slice(i).join(' , ')}`); break; }
    const url = URLS[i];
    try {
      const { status, html } = await bdFetch(url);
      const titulo = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
      const cf = /just a moment|challenge-platform|cf-chl|cf-mitigated/i.test(html);
      const txt = textoVisivel(html);
      console.log(`\n\n█████████ ${url}`);
      console.log(`  HTTP ${status} · len=${html.length}${cf ? ' · CHALLENGE' : ''} · título="${titulo}"`);

      const links = hrefs(html);
      const loteLinks = links.filter(u => /(lote|leilao|imovel|bem|oferta|item|lance)/i.test(u)).slice(0, 40);
      const outros   = links.filter(u => !/(lote|leilao|imovel|bem|oferta|item|lance)/i.test(u)).slice(0, 20);
      console.log(`  LINKS lote/leilão (${loteLinks.length}): ${JSON.stringify(loteLinks)}`);
      console.log(`  outros links: ${JSON.stringify(outros)}`);

      console.log(`  R$: ${JSON.stringify(contextos(txt, 'R\\$\\s?[\\d.]+', 55))}`);
      console.log(`  área/m²: ${JSON.stringify(contextos(txt, '[\\d.,]+\\s?m(?:²|2)|área|metr', 55, 8))}`);
      console.log(`  praça/avaliação/lance: ${JSON.stringify(contextos(txt, 'pra[çc]a|avalia|lance\\s*(?:inicial|m[íi]nimo)|1[ªa]|2[ªa]', 45, 10))}`);
      console.log(`  matrícula/processo/edital: ${JSON.stringify(contextos(txt, 'matr[íi]cula|processo|edital|comarca|vara', 45, 8))}`);
      console.log(`  endereço/CEP/cidade: ${JSON.stringify(contextos(txt, 'CEP|endere|bairro|munic[íi]|/\\s?[A-Z]{2}\\b', 40, 8))}`);
      console.log(`  data/horário: ${JSON.stringify(contextos(txt, '\\d{2}\\/\\d{2}\\/\\d{4}|encerra|abertura', 40, 6))}`);

      // Template do card (bloco cru ao redor do 1º R$ e do 1º link de lote).
      console.log(`  ░ bloco cru @R$: ${JSON.stringify(blocoBruto(html, 'R\\$', 750, 2))}`);
      console.log(`  ░ TEXTO VISÍVEL (5k): ${txt.slice(0, 5000)}`);
    } catch (e) {
      console.log(`\n\n█████████ ${url}  → ERRO: ${String(e.message).slice(0, 140)}`);
    }
  }
  console.log(`\n\n═══ FIM (${usados} requests Bright Data usados) ═══`);
})();
