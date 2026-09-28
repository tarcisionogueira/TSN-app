// Node (não Edge): precisa de `dns.lookup` pra fechar o SSRF por DNS-rebinding (achado da
// auditoria de 18/09) — o Edge Runtime não expõe resolver. `export const GET` (não
// `export default`): no runtime Node da Vercel, `export default` é tratado como assinatura
// Express (req,res) e o `Response` retornado seria ignorado → 504 (mesmo cuidado de
// anunciar-produto.js/convidar-live.js).
export const config = { runtime: 'nodejs' };

import dns from 'node:dns/promises';
import { hostExternoSeguro, fetchExternoSeguro, ipLiteralEhInterna } from './_allowed-hosts.js';
import { refererExigido } from './_foto-hotlink.js';

// Resolve o hostname e reprova se QUALQUER endereço resolvido (IPv4 ou IPv6) for
// interno/reservado. `hostExternoSeguro` já bloqueou o caso óbvio (IP literal na URL);
// isto fecha o caso de um domínio público cujo DNS aponta pra 169.254.169.254/10.x/127.0.0.1
// — o gap que a auditoria achou (a checagem antiga só olhava o TEXTO do hostname). Falha
// FECHADA: erro de resolução também bloqueia, nunca deixa passar por não saber checar.
async function hostnameResolveParaSeguro(hostname) {
  try {
    const enderecos = await dns.lookup(hostname, { all: true, verbatim: true });
    return enderecos.length > 0 && enderecos.every((e) => !ipLiteralEhInterna(e.address));
  } catch {
    return false; // padrao-ok: fail-closed deliberado — DNS não resolveu, não confia no host
  }
}

// Alguns buckets servem foto como `binary/octet-stream` (o mesmo cdnhp). Só nesse caso genérico
// a imagem é reconhecida pela ASSINATURA dos primeiros bytes — HTML/JSON/PDF seguem recusados.
function tipoPelaAssinatura(buf) {
  const b = new Uint8Array(buf.slice(0, 12));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export const GET = handler;
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
    // `hostnameResolveParaSeguro` roda em CADA hop também — sem ele, um hostname que passa no
    // texto mas resolve pra rede interna só era pego se aparecesse DEPOIS de um redirect
    // (aqui é pego já no primeiro hop, que é o hostname original de `url`).
    const res = await fetchExternoSeguro(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': refererExigido(url) || `https://${targetUrl.hostname}/`, // CDN com hotlink protegido: ver _foto-hotlink.js
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(8000),
    }, 4, hostnameResolveParaSeguro);

    if (!res.ok) return new Response('Image not found', { status: 404 });

    let contentType = res.headers.get('content-type') || '';
    // SEGURANÇA: só repassa IMAGEM (impede usar o proxy p/ conteúdo arbitrário/HTML de negação).
    // Tipo genérico (octet-stream/vazio) só passa se os bytes forem de imagem.
    // EXCEÇÃO FECHADA (28/09): PDF, e só dos CDNs da lista de Referer exigido (_foto-hotlink.js).
    // Ali o cliente NÃO consegue abrir o edital pelo link do leiloeiro (403 sem o Referer deles),
    // e o proxy é o único caminho. Fora da lista, PDF continua recusado — não vira proxy aberto.
    const pdfPermitido = !!refererExigido(url);
    const generico = !contentType || /^(binary|application)\/octet-stream/i.test(contentType);
    if (!/^image\//i.test(contentType) && !generico && !(pdfPermitido && /^application\/pdf/i.test(contentType))) return new Response('Not an image', { status: 415 });
    const body = await res.arrayBuffer();
    if (generico || /^application\/pdf/i.test(contentType)) {
      const ehPdf = pdfPermitido && new TextDecoder().decode(new Uint8Array(body.slice(0, 5))) === '%PDF-';
      contentType = ehPdf ? 'application/pdf' : tipoPelaAssinatura(body);
      if (!contentType) return new Response('Not an image', { status: 415 });
    }

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
