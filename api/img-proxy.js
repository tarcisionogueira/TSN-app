export const config = { runtime: 'edge' };

import { hostExternoSeguro, fetchExternoSeguro } from './_allowed-hosts.js';

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
  // Só HTTPS.
  if (targetUrl.protocol !== 'https:') {
    return new Response('Only HTTPS allowed', { status: 403 });
  }
  // Anti-SSRF: bloqueia rede interna/metadados de nuvem, mas LIBERA qualquer CDN público de
  // leiloeiro. A allowlist EXATA (host por host) escondia quase todas as fotos — cada leiloeiro
  // usa um subdomínio de CDN diferente (cdn1.megaleiloes, ms.sbwebservices.net, imagens.portalzuk,
  // s3-sa-east-1, ged.pestanaleiloes, cdn-biasi.blueintra, …). O proxy só devolve IMAGEM (abaixo),
  // então não vira open-proxy de conteúdo arbitrário.
  if (!hostExternoSeguro(url)) {
    return new Response('Domain not allowed', { status: 403 });
  }

  // OBS: para a Caixa (venda-imoveis.caixa.gov.br) este proxy NÃO resolve — a Caixa recusa o IP
  // da Vercel e devolve 404. As fotos da Caixa vão para o nosso Storage pelo backfill; este proxy
  // serve os demais hosts.
  try {
    // fetchExternoSeguro revalida CADA hop: o guard acima só via a 1ª URL, e o fetch seguia
    // redirect por padrão — um host liberado podia devolver 302 para 169.254.169.254/10.x e o
    // proxy buscava a rede interna. Lança 'ssrf_bloqueado' (cai no catch → 502).
    const res = await fetchExternoSeguro(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://${targetUrl.hostname}/`,
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return new Response('Image not found', { status: 404 });

    const contentType = res.headers.get('content-type') || '';
    // SEGURANÇA: só repassa IMAGEM (impede usar o proxy p/ conteúdo arbitrário/HTML de negação).
    if (!/^image\//i.test(contentType)) return new Response('Not an image', { status: 415 });
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
