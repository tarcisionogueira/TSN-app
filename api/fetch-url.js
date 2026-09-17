// Busca URL externa e retorna conteúdo para análise pela IA
// Sem armazenamento — conteúdo processado em memória e descartado
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { hostPermitido, fetchExternoSeguro } from './_allowed-hosts.js';

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const user = await getAuthUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  let url;
  try {
    const body = await req.json();
    url = body.url?.trim();
  } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400 });
  }

  if (!url || !/^https:\/\//.test(url)) {
    return new Response(JSON.stringify({ error: 'URL inválida' }), { status: 400 });
  }
  // Anti-SSRF: só hosts de leiloeiros/CEF na whitelist exata
  if (!hostPermitido(url)) {
    return new Response(JSON.stringify({ error: 'Domínio não permitido' }), { status: 403 });
  }

  try {
    // SSRF (17/09, achado de auditoria): `hostPermitido` só valida a URL inicial — um 302 do
    // próprio host permitido para 169.254.169.254/10.x/localhost passava batido com
    // `redirect:'follow'` cru, e aqui o conteúdo baixado VOLTA pro cliente (exfiltração, não
    // só um fetch cego). `fetchExternoSeguro` revalida CADA hop (mesmo padrão de
    // enriquecer-lote.js/gerar-analise.js/etc.).
    const resp = await fetchExternoSeguro(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BidProBrasil-Bot/1.0)' },
    });

    const contentType = resp.headers.get('content-type') || '';

    if (contentType.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
      // PDF: retorna base64 para o Claude processar como document
      const buf = await resp.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let b64 = '';
      const chunk = 8192;
      for (let i = 0; i < bytes.length; i += chunk) {
        b64 += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const base64 = btoa(b64);
      return new Response(JSON.stringify({ type: 'pdf', base64, size: bytes.length }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // HTML/texto: extrai texto limpo
    const html = await resp.text();
    // Remove scripts, styles e tags — mantém texto legível
    const texto = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 12000); // Claude haiku: 4k output, manter prompt razoável

    return new Response(JSON.stringify({ type: 'html', texto, size: texto.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('fetch-url erro:', e);
    return new Response(JSON.stringify({ error: 'Erro ao buscar URL' }), { status: 500 });
  }
}
