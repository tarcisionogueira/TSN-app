/**
 * ONDE ESTÁ O VEÍCULO (pátio) — pedido do dono, 24/09. Cada leiloeiro informa de um jeito, medido
 * no acervo ativo:
 *   SODRE     `raw.lot_location_address` = endereço completo do pátio ("rod. pres. dutra, km 223,5…")
 *   SUPERBID  quase nunca escreve o endereço (29 de 6.688); traz `raw.product.location` com cidade e
 *             COORDENADA → mapa aproximado. Quando a descrição tem "Endereço: …", ela vence.
 *   ZUK       `raw.addr` termina em "Cidade / UF - Bairro"
 *   MEGA / SUPORTE / WEBLEILOES  `raw.localidade` / `raw.local` (cidade)
 *   demais    "Endereço/Local do pátio/de retirada/de visitação: …" na descrição
 * Sem nada disso, a cidade/UF do lote — e a tela diz que é só a cidade, não inventa rua.
 */
const limpa = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const RE_END = /(?:endere[çc]o|local)(?:\s+(?:do|de|da)\s+(?:p[aá]tio|retirada|visita[çc][ãa]o|bem|vistoria))?\s*:\s*([^|;]{8,160}?)(?=\s*(?:\(|\.\s|$|leil[aã]o\b))/i;

export function localDoPatio(v) {
  const raw = (v && typeof v.raw === 'object' && v.raw) || {};
  const cidadeUf = [v?.cidade, v?.estado].filter(Boolean).join(' / ');
  let endereco = null, origem = null, lat = null, lon = null;

  if (raw.lot_location_address) { endereco = limpa(raw.lot_location_address); origem = 'endereço do pátio informado pelo leiloeiro'; }
  if (!endereco) {
    const m = limpa(raw.offerDescription).match(RE_END) || limpa(v?.descricao).match(RE_END);
    if (m) { endereco = m[1].trim(); origem = 'endereço citado na descrição do lote'; }
  }
  if (!endereco && raw.addr) {
    const m = limpa(raw.addr).match(/([A-Za-zÀ-ÿ' -]{3,} \/ [A-Z]{2} - [^.]{2,80})$/);
    if (m) { endereco = m[1].trim(); origem = 'bairro/cidade informados pelo leiloeiro'; }
  }
  const geo = raw.product?.location?.locationGeo;
  if (geo && Number.isFinite(Number(geo.lat)) && Number.isFinite(Number(geo.lon))) { lat = Number(geo.lat); lon = Number(geo.lon); }
  const cidadeFonte = limpa(raw.product?.location?.city || raw.localidade || raw.local || raw.lot_location || '');

  const alvo = endereco || cidadeFonte || cidadeUf;
  const mapaUrl = lat != null
    ? `https://www.google.com/maps?q=${lat},${lon}`
    : (alvo ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(alvo)}` : null);
  return {
    endereco,
    cidade: cidadeFonte || cidadeUf || null,
    origem: origem || (cidadeFonte || cidadeUf ? 'só a cidade — o leiloeiro não informou a rua do pátio' : null),
    mapaUrl,
    mapaAproximado: lat != null && !endereco,
  };
}
