/**
 * /sitemap-leiloes.xml — o mapa que o Google usa para achar as 33 mil páginas novas.
 *
 * POR QUE ELE PRECISA EXISTIR: sem sitemap, o robô só encontra o que está linkado, e um
 * acervo desse tamanho levaria meses para ser descoberto (ou nunca seria, nas cidades
 * pequenas). Com sitemap, o Google recebe a lista pronta.
 *
 * FORMATO: índice + partes. O protocolo limita 50 mil URLs (e 50 MB) por arquivo; usamos
 * partes de 5 mil para cada requisição ser rápida e barata — e para uma parte que falhe não
 * levar o mapa inteiro junto.
 *   /sitemap-leiloes.xml         → índice: aponta para as partes
 *   /sitemap-leiloes.xml?p=1..N  → cada parte com até 5 mil imóveis
 *   parte 0                      → as páginas de estado e de cidade (o esqueleto do site)
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE = 'https://www.bidprobrasil.com.br';
const POR_PARTE = 5000;
const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

async function sb(path, comTotal = false) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(comTotal ? { Prefer: 'count=exact' } : {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`supabase ${r.status}`);
  const total = Number(String(r.headers.get('content-range') || '').split('/')[1]) || 0;
  return { linhas: await r.json(), total };
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).send('indisponível');
  const u = new URL(req.url, 'http://x');
  const p = u.searchParams.get('p');
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=21600, stale-while-revalidate=86400');

  try {
    // ── Índice ──
    if (p === null) {
      const { total } = await sb('imoveis_leilao?ativo=eq.true&select=id&limit=1', true);
      const partes = Math.max(1, Math.ceil(total / POR_PARTE));
      const hoje = new Date().toISOString().slice(0, 10);
      const itens = ['0', ...Array.from({ length: partes }, (_, i) => String(i + 1))]
        .map((n) => `<sitemap><loc>${SITE}/sitemap-leiloes.xml?p=${n}</loc><lastmod>${hoje}</lastmod></sitemap>`).join('');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${itens}</sitemapindex>`);
    }

    // ── Parte 0: esqueleto (estados + cidades) ──
    if (p === '0') {
      const { linhas } = await sb('imoveis_leilao?ativo=eq.true&select=estado,cidade_norm&limit=100000');
      const cidades = new Set(); const ufs = new Set();
      (linhas || []).forEach((r) => {
        const uf = String(r.estado || '').toUpperCase();
        if (!UFS.includes(uf)) return;
        ufs.add(uf);
        if (r.cidade_norm) cidades.add(`${uf}/${r.cidade_norm}`);
      });
      const urls = [
        `<url><loc>${SITE}/leiloes</loc><changefreq>daily</changefreq><priority>0.9</priority></url>`,
        ...[...ufs].map((uf) => `<url><loc>${SITE}/leiloes/${uf.toLowerCase()}</loc><changefreq>daily</changefreq><priority>0.8</priority></url>`),
        ...[...cidades].map((k) => { const [uf, c] = k.split('/'); return `<url><loc>${SITE}/leiloes/${uf.toLowerCase()}/${esc(c)}</loc><changefreq>daily</changefreq><priority>0.7</priority></url>`; }),
      ].join('');
      return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
    }

    // ── Partes 1..N: imóveis ──
    const n = Math.max(1, Math.min(200, Number(p) || 1));
    const { linhas } = await sb(
      `imoveis_leilao?ativo=eq.true&select=id,titulo,atualizado_em&order=id.asc&offset=${(n - 1) * POR_PARTE}&limit=${POR_PARTE}`);
    const urls = (linhas || []).map((im) => {
      const lastmod = im.atualizado_em ? String(im.atualizado_em).slice(0, 10) : null;
      return `<url><loc>${SITE}/leilao/${im.id}/${slug(im.titulo || 'imovel')}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.6</priority></url>`;
    }).join('');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
  } catch (e) {
    console.error('[sitemap-leiloes]', e?.message || e);
    return res.status(500).send('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>');
  }
}
