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
