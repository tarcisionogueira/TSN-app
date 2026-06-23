// Edge Function: proxy de imagens da Caixa Econômica Federal
// Rota: /api/img-caixa?id=12345678
// Busca a URL da imagem na página de detalhe da Caixa e redireciona (com cache de 24h)
// A Caixa não fornece URL direta de imagem — precisamos raspar o HTML do detalhe.

export const config = { runtime: 'edge' };

const CACHE_TTL = 60 * 60 * 24; // 24 horas em segundos

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const id = (searchParams.get('id') || '').replace(/[^a-zA-Z0-9_-]/g, '');

  if (!id) {
    return new Response('id obrigatório', { status: 400 });
  }

  const detalheUrl = `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${id}`;

  try {
    const resp = await fetch(detalheUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TSN-Scraper/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    });

    if (!resp.ok) {
      return new Response('Imagem não disponível', { status: 404 });
    }

    const html = await resp.text();

    // A Caixa usa tags <img> com class "foto-imovel" ou id "imgFoto"
    // Exemplos encontrados no HTML:
    //   <img src="/sistema/imgs/foto_imovel/12345678_1.jpg" ...>
    //   <img id="imgFoto" src="...">
    const imgMatch = html.match(
      /(?:id=["']imgFoto["']|class=["'][^"']*foto[^"']*["'])[^>]*src=["']([^"']+)["']/i
    ) || html.match(
      /src=["']([^"']*foto_imovel[^"']+)["']/i
    ) || html.match(
      /src=["']([^"']*\/sistema\/imgs\/[^"']+\.(?:jpg|jpeg|png|gif))["']/i
    );

    if (!imgMatch) {
      // Retorna imagem placeholder SVG se não encontrou foto
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
        <rect width="400" height="300" fill="#f0f0f0"/>
        <text x="200" y="150" text-anchor="middle" fill="#999" font-size="16" font-family="sans-serif">Sem foto disponível</text>
      </svg>`;
      return new Response(svg, {
        headers: {
          'Content-Type': 'image/svg+xml',
          'Cache-Control': `public, max-age=${CACHE_TTL}`,
        },
      });
    }

    let imgUrl = imgMatch[1];
    if (imgUrl.startsWith('/')) {
      imgUrl = `https://venda-imoveis.caixa.gov.br${imgUrl}`;
    }

    // Valida que a URL final é estritamente do domínio da Caixa
    const parsedImg = new URL(imgUrl);
    if (parsedImg.hostname !== 'venda-imoveis.caixa.gov.br') {
      return new Response('URL de imagem inválida', { status: 403 });
    }

    // Busca a imagem e faz proxy
    const imgResp = await fetch(imgUrl, {
      headers: { 'Referer': detalheUrl },
      cf: { cacheTtl: CACHE_TTL, cacheEverything: true },
    });

    if (!imgResp.ok) {
      return Response.redirect(imgUrl, 302);
    }

    const contentType = imgResp.headers.get('content-type') || 'image/jpeg';
    const imgBuf = await imgResp.arrayBuffer();

    return new Response(imgBuf, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${CACHE_TTL}, s-maxage=${CACHE_TTL}`,
        'X-Source': 'caixa-proxy',
      },
    });
  } catch (err) {
    return new Response(`Erro: ${err.message}`, { status: 502 });
  }
}
