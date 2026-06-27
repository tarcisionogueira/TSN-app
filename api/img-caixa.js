// Edge Function: proxy de imagens da Caixa Econômica Federal
// Estratégia: tenta URL direta previsível primeiro (mais rápido),
// depois raspa HTML como fallback.
export const config = { runtime: 'edge' };

const CACHE_TTL = 60 * 60 * 24; // 24 horas

const HEADERS_BROWSER = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
  'Referer': 'https://venda-imoveis.caixa.gov.br/',
};

const CACHE_HEADERS = {
  'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
  'X-Source': 'caixa-proxy',
};

async function tentarFetchImagem(url) {
  try {
    const r = await fetch(url, { headers: HEADERS_BROWSER, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    if (!ct.startsWith('image/')) return null;
    const buf = await r.arrayBuffer();
    if (buf.byteLength < 500) return null; // muito pequeno = placeholder/erro
    return { buf, ct };
  } catch {
    return null;
  }
}

function svgPlaceholder() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <rect width="400" height="300" fill="#f1f5f9"/>
    <text x="200" y="145" text-anchor="middle" fill="#94a3b8" font-size="14" font-family="sans-serif">Foto não disponível</text>
    <text x="200" y="165" text-anchor="middle" fill="#cbd5e1" font-size="11" font-family="sans-serif">Caixa Econômica Federal</text>
  </svg>`;
  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': `public, max-age=3600` },
  });
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const rawId = searchParams.get('id') || '';
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!id) return new Response('id obrigatório', { status: 400 });

  const BASE = 'https://venda-imoveis.caixa.gov.br';
  const detalheUrl = `${BASE}/sistema/detalhe-imovel.asp?hdniip=${id}`;

  // ── Estratégia 1: URLs diretas previsíveis (padrão Caixa) ──
  const candidatos = [
    // Padrão real da Caixa: /fotos/F{id}NN.jpg (F + número + índice da foto)
    `${BASE}/fotos/F${id}21.jpg`,
    `${BASE}/fotos/F${id}1.jpg`,
    `${BASE}/fotos/F${id}.jpg`,
    `${BASE}/sistema/imgs/foto_imovel/${id}_1.jpg`,
    `${BASE}/sistema/imgs/foto_imovel/${id}.jpg`,
    `${BASE}/sistema/imgs/foto_imovel/${id}_1.jpeg`,
    `${BASE}/fotos/${id}_1.jpg`,
  ];

  for (const url of candidatos) {
    const img = await tentarFetchImagem(url);
    if (img) {
      return new Response(img.buf, { headers: { 'Content-Type': img.ct, ...CACHE_HEADERS } });
    }
  }

  // ── Estratégia 2: Raspar HTML da página de detalhe ──
  try {
    const resp = await fetch(detalheUrl, {
      headers: {
        ...HEADERS_BROWSER,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!resp.ok) return svgPlaceholder();
    const html = await resp.text();

    const imgMatch =
      html.match(/(?:id=["']imgFoto["']|class=["'][^"']*foto[^"']*["'])[^>]*src=["']([^"']+)["']/i) ||
      html.match(/src=["']([^"']*\/fotos\/F?[^"']+\.(?:jpg|jpeg|png|gif))["']/i) ||
      html.match(/src=["']([^"']*foto_imovel[^"']+)["']/i) ||
      html.match(/src=["']([^"']*\/sistema\/imgs\/[^"']+\.(?:jpg|jpeg|png|gif))["']/i);

    if (!imgMatch) return svgPlaceholder();

    let imgUrl = imgMatch[1];
    if (imgUrl.startsWith('/')) imgUrl = `${BASE}${imgUrl}`;

    // Valida domínio
    try {
      const parsed = new URL(imgUrl);
      if (parsed.hostname !== 'venda-imoveis.caixa.gov.br') return svgPlaceholder();
    } catch {
      return svgPlaceholder();
    }

    const img = await tentarFetchImagem(imgUrl);
    if (img) {
      return new Response(img.buf, { headers: { 'Content-Type': img.ct, ...CACHE_HEADERS } });
    }

    // Fallback: redireciona para URL da imagem diretamente
    return Response.redirect(imgUrl, 302);
  } catch {
    return svgPlaceholder();
  }
}
