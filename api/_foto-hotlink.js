// CDNs com hotlink PROTEGIDO POR REFERER (foto E documento) — única lista, usada pelo img-proxy e
// pelos leitores de PDF do servidor (gerar-documental, baixar-doc) para mandar o Referer certo, e
// por quem monta <img> fora do React (página pública, e-mails), que não tem o
// fallback onError de src/utils/foto.js e precisa ir direto pelo proxy.
//
// cdnhp (HASTAPÚBLICA), medido 28/09 pelo servidor do banco: 200 com Referer do hastapublica,
// 403 com o nosso Referer e sem nenhum. Lista fechada: o chamador nunca escolhe o Referer.
export const REFERER_EXIGIDO = [
  [/^https:\/\/s3-sa-east-1\.amazonaws\.com\/cdnhp\//i, 'https://www.hastapublica.com.br/'],
];

export const refererExigido = (url) => REFERER_EXIGIDO.find(([re]) => re.test(String(url || '')))?.[1] || null;

// URL para <img> fora do app: CDN protegido → pelo proxy (`base` = origem absoluta, para e-mail;
// '' para página servida por nós). Demais → a própria URL.
export function fotoServivel(url, base = '') {
  if (!url || !refererExigido(url)) return url;
  return `${base}/api/img-proxy?url=${encodeURIComponent(url)}`;
}
