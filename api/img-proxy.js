export const config = { runtime: 'edge' };

import { ALLOWED_HOSTS } from './_allowed-hosts.js';

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) return new Response('Missing url', { status: 400 });

  let targetUrl;
  try {
    targetUrl = new URL(url);
  } catch {
    return new Response('Invalid url', { status: 400 });
  }
  // Match exato — impede bypass via evil-venda-imoveis.caixa.gov.br
  if (!ALLOWED_HOSTS.has(targetUrl.hostname)) {
    return new Response('Domain not allowed', { status: 403 });
  }
  // Só HTTPS
  if (targetUrl.protocol !== 'https:') {
    return new Response('Only HTTPS allowed', { status: 403 });
  }

  // OBS: para a Caixa (venda-imoveis.caixa.gov.br) este proxy NÃO resolve no e-mail — a
  // Caixa recusa o IP da Vercel (edge e node) e devolve 404. As fotos da Caixa são
  // hospedadas no nosso Storage pelo backfill (scripts/backfill-fotos-caixa.mjs); este
  // proxy segue útil para os demais hosts da whitelist.
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
