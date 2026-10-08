// GALERIA COMPLETA DO VEÍCULO (29/09, pedido do dono: "confirme porque não está trazendo todas
// as fotos"). Até aqui MEGA, ZUK, LJUD e SUPORTE gravavam SÓ a foto do card da listagem — 1 foto
// por veículo, enquanto a página do lote tem a galeria inteira. A página do lote já é visitada
// (pátio + anexos, `visitarTextoDetalhe`), então ler a galeria dali custa zero requisição a mais.
//
// Regras por fonte, medidas no HTML real de um lote de cada (pg_net, 29/09). O cuidado é o mesmo
// nas três: a página do lote também mostra fotos de OUTROS lotes ("veja também"), e pegar toda
// imagem da página penduraria carro alheio na galeria. Cada regra ancora no lote:
//   MEGA    cdn1.megaleiloes.com.br/batches/<id do lote>/<hash>_<tamanho>.jpg — os outros lotes
//           aparecem com OUTRO id de batch. Mesma foto vem em 3 tamanhos: fica a maior.
//   ZUK     imagens.portalzuk.com.br/detalhe/… é a galeria; /mini/… são os cards de outros lotes.
//   SUPORTE static.suporteleiloes.com.br/<tenant>/bens/<id do bem>/arquivos/… — o id do bem vem
//           da foto de capa (a listagem já usa essa pasta); sem capa, a pasta mais frequente.
// LJUD não entra aqui: a página do lote é montada por JS e o HTML não tem foto nenhuma — a
// galeria vem da API (get-lotes, tipo=1), que já devolve `fotos` por lote.

const MAX_FOTOS = 30;

// Imóveis com a galeria na MESMA pasta da capa, exclusiva do lote (medido em 08/10, 2 lotes reais de cada).
// 2ª leva (08/10, backfill medido: CALIL 28/30, SUPORTE 30/30, RJLEILOES 28/30, ISAIAS 22/30, LANCEJA 13/14…).
// A regra só age quando a capa está numa pasta `/bens/<id>/` — fonte que não usa esse formato devolve [].
export const FONTES_PASTA_DA_CAPA = new Set(['KLEILOES', 'JELEILOES', 'LEILAOBRASIL', 'TORRES3', 'DANIELGARCIA', 'FERREIRALEIL',
  'CALIL', 'VEGAS', 'ISAIAS', 'APICE', 'CERULI', 'LANCEJA', 'TMLEILOES', 'PURCENA', 'AGOSTINHO', 'CASAMARTILLO', 'INFINITY',
  'ALEXANDREPEDROSA', 'JOAOEMILIO', 'RJLEILOES']);

// "Sem imagem" do próprio site não é foto: MEGA grava card-no-image, ZUK ImgNaoDisp*.
export const ehFotoPlaceholder = (u) => /no-image|nao-?disp|sem-?foto|placeholder/i.test(String(u || ''));

const urlsDoHtml = (html) => [...new Set((String(html || '').replace(/\\\//g, '/')
  .match(/https?:\/\/[^"'\s<>()\\]+?\.(?:jpe?g|png|webp)/gi) || []))];

const TAM_MEGA = { '1024x768': 3, '670x380': 2, '320x240': 1 };

export function galeriaDoHtml(fonte, html, { capa = null, idLote = null } = {}) {
  const urls = urlsDoHtml(html).filter((u) => !ehFotoPlaceholder(u));
  let out = [];
  if (fonte === 'MEGA') {
    const lote = String(capa || '').match(/\/batches\/(\d+)\//)?.[1] || (String(idLote || '').match(/(\d+)/) || [])[1];
    if (!lote) return [];
    const porHash = new Map();
    for (const u of urls) {
      const m = u.match(/\/batches\/(\d+)\/([0-9a-f]+)_(\d+x\d+)\.\w+$/i);
      if (!m || m[1] !== lote) continue;
      const nota = TAM_MEGA[m[3]] || 0;
      if (!porHash.has(m[2]) || porHash.get(m[2]).nota < nota) porHash.set(m[2], { u, nota });
    }
    out = [...porHash.values()].map((x) => x.u);
  } else if (fonte === 'ZUK') {
    out = urls.filter((u) => /^https?:\/\/imagens\.portalzuk\.com\.br\/detalhe\//i.test(u));
  } else if (fonte === 'BIASI') {
    // 08/10 (imóveis): o visualizador do lote usa o tamanho 1000 (`/images/lot/16/11/1000/1611385.jpg`, fotos
    // em sequência); capa e "veja também" vêm em 250/500. Medido em 2 lotes reais: 14 e 4 fotos.
    out = urls.filter((u) => /^https?:\/\/cdn-biasi\.blueintra\.com\/images\/lot\/\d+\/\d+\/1000\/\d+\.(?:jpe?g|png|webp)$/i.test(u));
  } else if (FONTES_PASTA_DA_CAPA.has(fonte)) {
    // 08/10 (imóveis): a capa mora numa pasta EXCLUSIVA do lote (`…/bens/<id>/arquivos/` na plataforma
    // Suporte Leilões; `…/bens/0000031582/` na de TORRES3/DANIELGARCIA/FERREIRALEIL). A galeria é o resto
    // da mesma pasta. Sem capa numa pasta dessas → nada (não se adivinha a pasta do lote).
    const pasta = String(capa || '').match(/^(https?:\/\/[^?#]+\/bens\/\d+\/(?:arquivos\/)?)/i)?.[1] || null;
    out = pasta ? urls.filter((u) => u.startsWith(pasta)) : [];
  } else if (fonte === 'SUPORTE') {
    const pasta = (u) => u.match(/^(https?:\/\/static\.suporteleiloes\.com\.br\/[^/]+\/bens\/\d+\/arquivos\/)/i)?.[1] || null;
    let alvo = pasta(String(capa || ''));
    if (!alvo) {
      const cont = new Map();
      for (const u of urls) { const p = pasta(u); if (p) cont.set(p, (cont.get(p) || 0) + 1); }
      alvo = [...cont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    }
    out = alvo ? urls.filter((u) => u.startsWith(alvo)) : [];
  }
  return out.slice(0, MAX_FOTOS);
}

// Galeria final do lote: a do detalhe, com a capa da listagem na frente quando ela é foto de
// verdade (a capa é o que a busca mostra — mantê-la em 1º evita trocar a miniatura do card).
export function montarFotos(capa, galeria = []) {
  const c = capa && /^https?:\/\//.test(capa) && !ehFotoPlaceholder(capa) ? capa : null;
  const g = (galeria || []).filter((u) => u && !ehFotoPlaceholder(u));
  if (!g.length) return c ? [c] : [];
  // A capa costuma ser a mesma foto da galeria em outro tamanho: não duplica.
  const chave = (u) => String(u).replace(/_(\d+x\d+)(?=\.\w+$)/, '').replace(/\/(mini|detalhe|640x480|196x146|250|500|1000)\//, '/').replace(/\.\w+$/, '');
  const lista = c && !g.some((u) => chave(u) === chave(c)) ? [c, ...g] : g;
  return [...new Set(lista)].slice(0, MAX_FOTOS);
}

// GALERIA NÃO ENCOLHE (mesmo princípio do "pátio não esquece" em salvarVeiculos): a leitura do
// detalhe é em rodízio (~60-120 lotes/rodada). Lote não relido hoje chega só com a capa; sem
// isto, a rodada gravaria 1 foto por cima da galeria provada ontem.
export function fotosPreservadas(novas, anteriores) {
  const n = Array.isArray(novas) ? novas.filter((u) => !ehFotoPlaceholder(u)) : [];
  const a = Array.isArray(anteriores) ? anteriores.filter((u) => !ehFotoPlaceholder(u)) : [];
  return n.length <= 1 && a.length > n.length ? a : n;
}
