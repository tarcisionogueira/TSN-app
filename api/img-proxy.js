export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) return new Response('Missing url', { status: 400 });

  // Whitelist exata de hostnames permitidos (sem substring match para evitar SSRF)
  const ALLOWED_HOSTS = new Set([
    'venda-imoveis.caixa.gov.br',
    'imovelx.caixa.gov.br',
    'www.caixa.gov.br',
    'leiloes.superbid.net',
    'img.superbid.net',
    'www.superbid.net',
    'superbid.net',
    'sold.com.br',
    'www.sold.com.br',
    'leiloeiro.com.br',
    'www.leiloeiro.com.br',
    'megaleiloes.com.br',
    'www.megaleiloes.com.br',
    'zukerman.com.br',
    'www.zukerman.com.br',
    'eleiloes.com.br',
    'www.eleiloes.com.br',
    'frazaoleiloes.com.br',
    'www.frazaoleiloes.com.br',
    'biassi.com.br',
    'www.biassi.com.br',
    'hastapublica.com.br',
    'www.hastapublica.com.br',
  ]);
  let targetUrl;
  try {
    targetUrl = new URL(url);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }
  // Exact match — impede bypass via evil-venda-imoveis.caixa.gov.br
  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return new Response('Domain not allowed', { status: 403 });
  }
  // Só HTTPS
  if (targetUrl.protocol !== 'https:') {
    return new Response('Only HTTPS allowed', { status: 403 });
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://${targetUrl.hostname}/`,
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return new Response('Image not found', { status: 404 });

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const body = await res.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response('Proxy error', { status: 502 });
  }
}
