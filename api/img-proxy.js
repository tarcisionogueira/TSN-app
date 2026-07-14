// Proxy de imagens para o E-MAIL (e fallback do site). Runtime NODE (não edge):
// o IP do edge da Vercel (Cloudflare) é RECUSADO pela Caixa (venda-imoveis.caixa.gov.br
// responde 404 ao edge), enquanto IPs de datacenter (AWS/Azure) recebem 200. O runtime
// nodejs roda em AWS, que a Caixa atende — sem isso a foto do e-mail quebra (o cliente
// de e-mail busca esta URL e recebe 404).
// IMPORTANTE: exportar por método (GET) — com nodejs, `export default` é tratado como
// assinatura Express e o Response é ignorado (trava até o maxDuration).
export const config = { runtime: 'nodejs', maxDuration: 15 };

import { ALLOWED_HOSTS } from './_allowed-hosts.js';

async function handler(req) {
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

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Referer': `https://${targetUrl.hostname}/`,
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!res.ok) return new Response('Image not found', { status: 404 });

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const body = await res.arrayBuffer();

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400, s-maxage=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch {
    return new Response('Proxy error', { status: 502 });
  }
}

export const GET = handler;
export const POST = handler;
