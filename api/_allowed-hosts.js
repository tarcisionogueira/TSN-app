/**
 * Whitelist exata de hostnames externos que os proxies/downloaders do servidor
 * podem acessar (anti-SSRF). Match EXATO — nunca substring, para impedir bypass
 * via evil-venda-imoveis.caixa.gov.br ou similares.
 *
 * Inclui CEF + leiloeiros cadastrados (fotos, editais, matrículas, anexos).
 */
export const ALLOWED_HOSTS = new Set([
  // Caixa Econômica Federal
  'venda-imoveis.caixa.gov.br',
  'imovelx.caixa.gov.br',
  'www.caixa.gov.br',
  // Superbid
  'leiloes.superbid.net', 'img.superbid.net', 'www.superbid.net', 'superbid.net',
  // Sold
  'sold.com.br', 'www.sold.com.br',
  // Agregadores / leiloeiros
  'leiloeiro.com.br', 'www.leiloeiro.com.br',
  'megaleiloes.com.br', 'www.megaleiloes.com.br',
  'zukerman.com.br', 'www.zukerman.com.br', 'portalzuk.com.br', 'www.portalzuk.com.br',
  'eleiloes.com.br', 'www.eleiloes.com.br',
  'frazaoleiloes.com.br', 'www.frazaoleiloes.com.br',
  'biassi.com.br', 'www.biassi.com.br', 'biasileiloes.com.br', 'www.biasileiloes.com.br',
  'hastapublica.com.br', 'www.hastapublica.com.br',
  'kcleiloes.com.br', 'www.kcleiloes.com.br',
  'patiorocha.com.br', 'www.patiorocha.com.br',
  'albertomacedo.com.br', 'www.albertomacedo.com.br',
  'vipleiloes.com.br', 'www.vipleiloes.com.br',
  'grupolance.com.br', 'www.grupolance.com.br',
  // Banco do Brasil
  'seuimovelbb.com.br', 'www.seuimovelbb.com.br', 'www42.bb.com.br',
]);

/** Retorna true se a URL é https e o hostname está na whitelist exata. */
export function hostPermitido(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return false; }
  return u.protocol === 'https:' && ALLOWED_HOSTS.has(u.hostname);
}

// Faixas de IP INTERNAS/reservadas que um fetch do servidor NUNCA deve alcançar
// (loopback, redes privadas, link-local/metadados de nuvem, CGNAT, "this network").
const FAIXAS_IP_INTERNAS = [
  /^127\./,                                    // loopback
  /^10\./,                                      // privado classe A
  /^192\.168\./,                                // privado classe C
  /^169\.254\./,                                // link-local / metadados AWS/GCP/Azure
  /^172\.(1[6-9]|2\d|3[01])\./,                 // privado classe B (172.16–172.31)
  /^0\./,                                        // "this" network
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,   // CGNAT 100.64.0.0/10
];

// Anti-SSRF para os fetchers de ENRIQUECIMENTO (enriquecer-lote, geocodificar,
// gerar-documental): eles precisam alcançar QUALQUER leiloeiro/CDN público — uma
// allowlist exata quebraria a cobertura — mas jamais a rede interna ou o endpoint
// de metadados da nuvem. Bloqueia literais de IP privado/loopback/link-local e
// hostnames internos. Não resolve DNS (o runtime serverless não expõe resolver);
// cobre o vetor concreto: uma URL de documento no banco apontando p/ 169.254.169.254,
// localhost, 10.x, etc. Trata URL ilegível/protocolo não-http como interno (fail-closed).
export function ehHostInterno(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ''); // remove colchetes de IPv6
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.internal') || host.endsWith('.local') || host.endsWith('.lan')) return true;
  // IPv6 loopback / não-especificado / link-local (fe80::) / unique-local (fc00::/7)
  if (host === '::1' || host === '::') return true;
  if (/^fe80:/i.test(host) || /^f[cd][0-9a-f]*:/i.test(host)) return true;
  // IPv4-mapeado em IPv6 (::ffff:a.b.c.d) — o parser WHATWG normaliza p/ hex
  // (::ffff:a9fe:a9fe), driblando o teste de IPv4 abaixo. Bloqueia todos os mapeados:
  // embutem um IPv4 e são vetor clássico de bypass de SSRF; nenhum uso legítimo aqui.
  if (/::ffff:/i.test(host)) return true;
  // IPv4 (literal, inclusive na forma pontilhada dentro de um mapeado não-normalizado)
  const m = host.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  const ipv4 = m ? m[1] : host;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(ipv4) && FAIXAS_IP_INTERNAS.some((re) => re.test(ipv4))) return true;
  return false;
}

/** Destino externo seguro: http(s) público e que NÃO aponta p/ rede interna/metadados. */
export function hostExternoSeguro(rawUrl) {
  return !!rawUrl && /^https?:\/\//i.test(rawUrl) && !ehHostInterno(rawUrl);
}

/**
 * fetch que segue redirects MANUALMENTE revalidando CADA hop com hostExternoSeguro.
 * Fecha o SSRF residual do redirect:'follow', que seguia um 302 externo → 169.254.169.254
 * (metadados de nuvem) / 10.x / localhost sem revalidar. Uso: leitores de documento
 * (edital/matrícula) cuja URL vem do banco. Lança 'ssrf_bloqueado' se um hop for interno.
 */
export async function fetchExternoSeguro(url, opts = {}, maxHops = 4) {
  let atual = url;
  for (let i = 0; i <= maxHops; i++) {
    if (!hostExternoSeguro(atual)) throw new Error('ssrf_bloqueado');
    const r = await fetch(atual, { ...opts, redirect: 'manual' });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) return r;                              // 3xx sem Location → devolve como está
      atual = new URL(loc, atual).toString();          // resolve relativo ao hop atual
      continue;
    }
    return r;
  }
  throw new Error('ssrf_muitos_redirects');
}
