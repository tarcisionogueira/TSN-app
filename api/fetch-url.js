// Busca URL externa e retorna conteúdo para análise pela IA
// Sem armazenamento — conteúdo processado em memória e descartado
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { hostPermitido, fetchExternoSeguro } from './_allowed-hosts.js';
import { decodificarEntidades } from './_texto-imovel.js';

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
    // Cookies entre redirects + UA de navegador: a VIP seta cookie e redireciona para si mesma; sem os
    // dois o laço de redirect virava "Erro ao buscar URL" (05/10, Alphaville).
    const resp = await fetchExternoSeguro(url, {
      manterCookies: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9',
      },
    }, 8);
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: `o site respondeu HTTP ${resp.status}` }), { status: 502 });
    }

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
      .replace(/&[#a-z0-9]+;/gi, (e) => decodificarEntidades(e)) // "Leil&#xE3;o" → "Leilão" (VIP)
      .replace(/\s{2,}/g, ' ')
      .trim()
      // 30 mil (era 12 mil): a página do lote traz menu e rodapé; a DESCRIÇÃO do leiloeiro (comissão,
      // pagamento, ocupação) vinha depois do corte.
      .slice(0, 30000);

    return new Response(JSON.stringify({ type: 'html', texto, size: texto.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('fetch-url erro:', e);
    // O MOTIVO vai para a tela ("muitos redirects", "bloqueado"): "Erro ao buscar URL" não dizia o que fazer.
    const motivo = /muitos_redirects/.test(e?.message) ? 'o site exige navegador (redirecionamento em laço)'
      : /ssrf/.test(e?.message) ? 'destino bloqueado por segurança' : 'falha de rede ao acessar o site';
    return new Response(JSON.stringify({ error: `Erro ao buscar URL: ${motivo}` }), { status: 502 });
  }
}
