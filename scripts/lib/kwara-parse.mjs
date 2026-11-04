/**
 * Parser puro — KWARA (kwara.com.br), marketplace de leilão EXTRAJUDICIAL: os vendedores são empresas (SPE, securitizadora,
 * banco credor fiduciário — "Enforce", "FAZENDA FLORES SPE"), não um leiloeiro por tenant. Next.js com RSC; sem anti-bot →
 * fetch direto, grátis. Recon 04/11:
 *
 *   • Catálogo de imóveis: `/busca?assetCategoryIds[]=1335572019495831134` — 24 cards na página (o `?page=` NÃO pagina:
 *     devolve a mesma página). Em 04/11 eram 26 resultados; os 2 que não cabem ficam para quando sair alguém da 1ª página.
 *   • Lote `/bens/<slug>-<id>`: JSON-LD `Product` no HTML (name "Terreno de 338m² no Parque Tv - Bauru/SP", description =
 *     texto da matrícula, image[], offers.price = lance inicial da fase corrente, offers.priceValidUntil = fim da fase,
 *     availability InStock/SoldOut). O resto vem no stream RSC (`self.__next_f.push`): `lotDetails` com `files[]` (PDFs com
 *     título "Matrícula 125.484.pdf" / "Edital…"), `locationAddress`, `characteristics` (ocupação, débitos, pagamento),
 *     `currentLotAuctionSetting.listingPhase` ("1º Leilão" / "2º Leilão", startsAt/endsAt), `isEnded`.
 *   • Encerrado = `isEnded: true` ou availability SoldOut. Lote encerrado que aceita proposta (`acceptsProposalsUntil`) fica
 *     de fora: não há lance mínimo público nessa fase.
 *   • "Cota de consórcio de imóvel" aparece na mesma categoria e não é imóvel.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

export const CATEGORIA_IMOVEIS = '1335572019495831134';
export const TENANTS = {
  kwara: { fonte: 'KWARA', leiloeiro: 'Kwara', base: 'https://www.kwara.com.br' },
};

export const idDaUrl = (url) => (String(url).match(/\/bens\/[a-z0-9-]*?-(\d{10,})(?:[/?#]|$)/i) || [])[1] || null;

/** Busca → Map id → url absoluta. Cota de consórcio sai pelo slug (não é imóvel). */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/\/bens\/([a-z0-9-]+-(\d{10,}))/gi)) {
    if (/cota-de-consorcio|consorcio/i.test(m[1])) continue;
    out.set(m[2], `${String(base || '').replace(/\/$/, '')}/bens/${m[1]}`);
  }
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

/** O stream RSC do Next: concatena os pedaços de `self.__next_f.push([1,"…"])` já desescapados. */
export function fluxoRsc(html) {
  let s = '';
  for (const m of String(html || '').matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try { s += JSON.parse(`"${m[1]}"`); } catch { /* padrao-ok: pedaço com escape inválido não carrega dado do lote; os demais seguem */ }
  }
  return s;
}

function produtoLd(html) {
  for (const m of String(html || '').matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]);
      for (const o of Array.isArray(j) ? j : [j]) if (o?.['@type'] === 'Product') return o;
    } catch { /* padrao-ok: bloco LD ilegível; o próximo pode ser o Product */ }
  }
  return null;
}

const campo = (s, re) => (String(s).match(re) || [])[1];
const limpar = (t) => decodificarEntidades(String(t || '')).replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const p = produtoLd(html);
  if (!p?.name) return null;
  const f = fluxoRsc(html);
  const ini = f.indexOf('"lotDetails"');
  const det = ini >= 0 ? f.slice(ini, ini + 40000) : '';
  const nome = limpar(p.name);
  const descMatricula = limpar(p.description).replace(/^"|"$/g, '');
  const endereco = limpar(campo(det, /"locationAddress":"((?:[^"\\]|\\.)*)"/));
  const caracteristicas = (() => {
    const bloco = campo(det, /"characteristics":(\{[^{}]*\})/);
    try { return Object.entries(JSON.parse(bloco || '{}')).map(([k, v]) => `${k}: ${limpar(v)}`); } catch { return []; }
  })();
  // A fase VIGENTE é a de `currentLotAuctionSetting`; o 1º `listingPhase` do bloco pode ser o 1º leilão já vencido (lote em
  // 2º leilão saía "encerrado" com a data de 22/10 — Santa Rosa de Viterbo e Peruíbe em 04/11). O JSON-LD
  // `priceValidUntil` acompanha a fase vigente e vale primeiro.
  const atual = (det.match(/"currentLotAuctionSetting":\{[\s\S]*?"lotId"/) || [''])[0];
  const fase = campo(atual, /"phaseName":"([^"]+)"/);
  const fimFase = p.offers?.priceValidUntil || campo(atual, /"endsAt":"([^"]+)"/) || null;
  const inicial = Number(campo(det, /"currentLotAuctionSetting":\{[^]*?"startingBidCents":(\d+)/)) / 100 || Number(p.offers?.price) || 0;
  // O stream RSC traz também os lotes RELACIONADOS (carrossel): campo buscado no stream inteiro pode ser de outro lote.
  // Por isso o valor estimado só vale dentro do bloco `lotDetails` deste lote, e o "encerrado" sai do JSON-LD.
  const estimado = Number(campo(det, /"estimatedValueCents":(\d+)/)) / 100 || 0;
  const encerrado = /SoldOut/i.test(p.offers?.availability || '') || (fimFase ? Date.parse(fimFase) < agora : false);
  const arquivos = [...det.matchAll(/"title":"([^"]+\.pdf)","url":"(https:\/\/cdn\.kwara\.com\.br\/lot-files\/[^"]+)"/gi)].map((m) => ({ nome: limpar(m[1]).replace(/^\d+\s*-\s*/, '').replace(/\.pdf$/i, ''), url: encodeURI(m[2]) }));
  const edital = arquivos.find((a) => /edital/i.test(a.nome));
  const matricula = arquivos.find((a) => /matr[íi]cula/i.test(a.nome));
  const fotos = (Array.isArray(p.image) ? p.image : [p.image]).filter((u) => /^https?:\/\//.test(u || ''));
  const local = [cidadeDoTexto(nome), cidadeDoTexto(endereco)].find((c) => c.cidade) || { cidade: null, estado: campo(det, /"propertyState":"([A-Z]{2})"/) || null };
  const vendedor = limpar(campo(det, /"seller":\{"displayName":"([^"]+)"/));
  return {
    titulo: nome.slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: estimado || 0,
    valor_minimo: inicial,
    valor_minimo_2: null,
    modalidade: 'extrajudicial',
    area_m2: extrairAreaM2(`${nome} ${descMatricula}`) || 0,
    descricao: [descMatricula, endereco && `Endereço: ${endereco}`, ...caracteristicas, fase && `Fase atual: ${fase}.`, vendedor && `Vendedor: ${vendedor}.`]
      .filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: fimFase,
    data_leilao_2: null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital ? edital.url : url,
    link_matricula: matricula ? matricula.url : null,
    anexos: [...(edital ? [{ tipo: 'edital', nome: 'Edital', url: edital.url }] : []), ...(matricula ? [{ tipo: 'matricula', nome: matricula.nome, url: matricula.url }] : [])],
    numero_matricula: numeroMatriculaDoTexto(`${matricula?.nome || ''} ${descMatricula}`) || null,
    naoImovel: /cons[óo]rcio/i.test(nome),
    encerrado,
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
