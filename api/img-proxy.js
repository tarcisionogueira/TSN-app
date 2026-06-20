export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) return new Response('Missing url', { status: 400 });

  // Só permite domínios conhecidos de leiloeiros
  const allowed = [
    'venda-imoveis.caixa.gov.br',
    'imovelx.caixa.gov.br',
    'www.caixa.gov.br',
    'superbid.net',
    'sold.com.br',
    'leiloeiro.com.br',
  ];
  let targetUrl;
  try {
    targetUrl = new URL(url);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }
  if (!allowed.some(d => targetUrl.hostname.includes(d))) {
    return new Response('Domain not allowed', { status: 403 });
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
