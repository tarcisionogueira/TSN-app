/**
 * Parser puro — D1 LANCE LEILÕES (d1lance.com.br, leiloeiro José Roberto Neves Amorim; SP/MT e bancos — Porto Bank,
 * Banco Pan, TJSP/TJRJ). Plataforma própria em Laravel + Livewire (Vite, `build/assets/api_service-*.js`), mídia em
 * `midia.d1lance.com.br/public/…`. Sem anti-bot: fetch direto, grátis. Recon 30/10:
 *
 *   • `/navegar-pelo-mapa?tipo_filtro=imoveis` (d1lance.com → 301 para .com.br) traz TODOS os lotes de imóvel de uma vez:
 *     115 cards `<a href="/lote/<bairro-cidadeuf>/<id>" class="link_para_detalhes_lote card <situação>">` e, no
 *     componente Livewire `listagem-de-leiloes` (atributo `wire:initial-data`), o mesmo acervo em JSON com
 *     `lastPage: 1`. `?page=N` é ignorado (a "próxima página" é evento Livewire `carregarPaginaSeguinte`, por POST com
 *     sessão) — por isso o `totalDoCatalogo` lê o `lastPage`: se um dia passar de 1, a lista é declarada cortada.
 *     Situações no dia: 50 AGUARDANDO_INICIO, 35 INICIADO, 30 RECEBENDO_PROPOSTAS (praça vencida, aceitando proposta
 *     até `pos_encerramento.ate` — fica fora pela regra "última praça no passado = encerrado").
 *     O menu diz "Imóveis 85": é a soma sem os 30 em proposta.
 *   • O slug da URL não importa (`/lote/x/2233` abre o mesmo lote); o id é a chave.
 *   • Lote: tudo no componente Livewire `sidebar` → `lote`: `pracas_do_lote` [{nome, valor, inicio, termino}],
 *     `bens_do_lote` [{valor_avaliacao (laudo), valor_atual_do_bem (avaliação ATUALIZADA = base da 1ª praça),
 *     porcentagem_de_penhora, endereco{rua, numero, bairro, cidade{nome}, estado{sigla}}, imovel{matricula,
 *     area_construida, area_terreno}, movel_ou_outro}], `leilao_detalhes.modalidade` (JUDICIAL | EXTRAJUDICIAL |
 *     PARTICULAR), `midias_do_lote` (categoria 7 = foto, 1 = documento: matrícula, laudo, IPTU…), `descricao_lote`
 *     (HTML com descrição, matrícula, ônus e débitos). Edital = fragmento HTML em `/edital_do_leilao/<id>`.
 *   • Valores: a avaliação usada é a ATUALIZADA (`valor_atual_do_bem`): na 1ª praça judicial ela É o lance (2233:
 *     laudo R$ 230.626,36, atualizada e 1ª praça R$ 238.950,08). Praça única com 50% (1697) sai com avaliação
 *     R$ 1.826.514,75 e lance R$ 913.257,38. No extrajudicial (alienação fiduciária, 2296) o 2º leilão é a DÍVIDA e
 *     pode passar da avaliação (R$ 949.259,62 contra 386.970,56) — é o que o site publica; fica em `valor_minimo_2`.
 *   • Datas da plataforma em horário de Brasília ("2026-11-26 15:00:00.000000" = card "26/11/2026 15h00").
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, numPayload, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

const BASE = 'https://d1lance.com.br';
const MIDIA = 'https://midia.d1lance.com.br/public/';
export const CATALOGO = '/navegar-pelo-mapa?tipo_filtro=imoveis';
export const TENANTS = {
  d1lance: { fonte: 'D1LANCE', leiloeiro: 'D1 Lance Leilões (José Roberto Neves Amorim)', base: BASE },
};

export const idDaUrl = (url) => (String(url).match(/\/lote\/[^/?#]+\/(\d+)/) || [])[1] || null;

// Card do catálogo: o href vem antes da classe `link_para_detalhes_lote` na mesma tag.
const RE_CARD = /<a\s+href="(?:https?:\/\/(?:www\.)?d1lance\.com(?:\.br)?)?(\/lote\/[a-z0-9-]+\/(\d+))"[^>]*\blink_para_detalhes_lote\b/gi;

/** Catálogo `/navegar-pelo-mapa?tipo_filtro=imoveis` → Map id → url do lote. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(RE_CARD)) out.set(m[2], `${BASE}${m[1]}`);
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

// Atributo `wire:initial-data` → JSON. Só as 5 entidades que o Blade usa ao escapar atributo (&amp; por último).
const desescapar = (s) => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
/** Dados (`serverMemo.data`) do 1º componente Livewire com esse nome, ou null. */
export function componenteLivewire(html, nome) {
  for (const m of String(html || '').matchAll(/wire:initial-data="([^"]+)"/g)) {
    if (!m[1].includes(`&quot;name&quot;:&quot;${nome}&quot;`)) continue;
    try { return JSON.parse(desescapar(m[1]))?.serverMemo?.data || null; }
    catch (e) { console.warn(`[d1lance] componente ${nome} ilegível: ${String(e?.message || e).slice(0, 80)}`); return null; }
  }
  return null;
}

/**
 * Quantos lotes o site declara no catálogo: os do JSON da listagem; se o Livewire disser que há página seguinte
 * (`lastPage` > `currentPage`), declara um a mais — enumerar só a 1ª página vira "lista cortada", não "lotes sumiram".
 */
export function totalDoCatalogo(html) {
  const d = componenteLivewire(html, 'listagem-de-leiloes');
  if (!d || !Array.isArray(d.lotes)) return null;
  return d.lotes.length + (Number(d.lastPage) > Number(d.currentPage || 1) ? 1 : 0);
}

const json = (x) => { if (typeof x !== 'string' || !/^\s*[[{]/.test(x)) return x; try { return JSON.parse(x); } catch { return null; } }; // padrao-ok: campo opcional serializado; ilegível = ausente
const iso = (s) => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00` : null; };
const textoHtml = (h) => decodificarEntidades(String(h || '').replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const FORA = /ENCERRAD|ARREMATAD|VENDID|CANCELAD|SUSPENS|RETIRAD|SUSTAD|ADIAD/i;
const midia = (p) => (p ? MIDIA + encodeURI(String(p).replace(/^\/+/, '')) : null);

export function parseDetalhe(html, urlLote, { agora = new Date() } = {}) {
  const lote = componenteLivewire(html, 'sidebar')?.lote;
  if (!lote || !lote.id) return null;
  const bens = Array.isArray(lote.bens_do_lote) ? lote.bens_do_lote : [];
  const b0 = bens[0] || {};
  const end = b0.endereco || {};
  const detalhes = json(lote.leilao_detalhes) || {};
  const modSite = String(detalhes.modalidade || lote.leilao?.modalidade || '').toUpperCase();

  // Praças em ordem; a corrente é a 1ª que ainda não terminou. Nenhuma no futuro = encerrado.
  const pracas = (Array.isArray(lote.pracas_do_lote) ? lote.pracas_do_lote : json(lote.pracas_do_lote) || [])
    .map((p) => ({ valor: numPayload(p.valor), fim: iso(p.termino) }))
    .filter((p) => p.fim && p.valor > 0)
    .sort((a, b) => Date.parse(a.fim) - Date.parse(b.fim));
  const iAtual = pracas.findIndex((p) => Date.parse(p.fim) >= agora);
  const atual = pracas[iAtual >= 0 ? iAtual : pracas.length - 1];
  const proxima = iAtual >= 0 ? pracas[iAtual + 1] : null;
  if (!atual) return null;

  // Avaliação ATUALIZADA (a que o site usa na 1ª praça), somada se o lote reúne mais de um bem (apto + vaga).
  const aval = bens.reduce((s, b) => s + (numPayload(b.valor_atual_do_bem) || numPayload(b.valor_avaliacao)), 0)
    || numPayload(lote.pos_encerramento?.valor_avaliacao);

  const local = end.cidade?.nome
    ? { cidade: end.cidade.nome, estado: end.estado?.sigla || end.cidade.sigla || null }
    : cidadeDoTexto(String(lote.titulo_do_lote || '').replace(/\s+-\s+([A-Z]{2})$/, '/$1'));

  const desc = textoHtml(lote.descricao_lote);
  const sub = String(lote.subtitulo_do_lote || lote.titulo_lote || b0.identificador_do_bem || '').trim();
  // "Apartamento - 40,32 m² - 1 vaga(s)" → "Apartamento"; "Sala Comercial - Conj. 91 - 52,89 m²" → "Sala Comercial - Conj. 91".
  const tipoSeg = sub.replace(/\s*-\s*\d.*$/, '').trim() || 'Imóvel';
  const rua = [end.rua, end.numero].filter(Boolean).join(', ') + (end.complemento ? ` ${end.complemento}` : '');
  const ondeTit = rua ? [titleCase(rua.toLowerCase()).replace(/\bS\/n\b/i, 'S/N'), end.bairro].filter(Boolean).join(' - ')
    : String(lote.titulo_do_lote || '').replace(/\s+-\s+[^-]+$/, '').trim();
  // `porcentagem_de_penhora` (50, 25, 16,66…) NÃO é fatia à venda: é a parte do executado, e o bem vai à praça INTEIRO
  // (art. 843 CPC) — a 2ª praça prova: 75% em 1581/2109 (50% do executado + a cota do coproprietário a 100%), 80% em
  // 2135, 85% em 2170, sobre a avaliação do imóvel todo (casa de 369 m² no Santo Amaro a R$ 3,86 mi). Pôr "50% do imóvel"
  // no título descartava 13 lotes inteiros como fração ideal. Venda de parte de verdade vem escrita na descrição
  // ("Parte ideal de 75% de um apartamento", 2140) e a regra de fração a pega lá.
  const base = `${tipoSeg}${ondeTit ? ` - ${ondeTit}` : ''}`;

  const midias = (json(lote.midias_do_lote) || []).filter((m) => m?.midias?.url);
  const fotos = [...new Set(midias.filter((m) => Number(m.midias.categoria_de_midia) === 7)
    .sort((a, b) => (b.imagem_de_capa || 0) - (a.imagem_de_capa || 0)).map((m) => midia(m.midias.url)))];
  const docs = midias.filter((m) => Number(m.midias.categoria_de_midia) !== 7).map((m) => {
    const arq = String(m.midias.url).split('/').pop();
    const nome = arq.replace(/^lote_\d+_/, '').replace(/\.\w+$/, '').replace(/_+/g, ' ').trim() || 'Documento';
    const tipo = /matr[íi]cula|\bmat\.?\s*\d/i.test(nome) ? 'matricula' : 'documento';
    return { tipo, nome, url: midia(m.midias.url) };
  });
  const edital = `${BASE}/edital_do_leilao/${lote.id}`;
  const matDoc = docs.find((d) => d.tipo === 'matricula');

  const mat = String(b0.imovel?.matricula || '');
  const area = num(b0.imovel?.area_construida) || num(b0.imovel?.area_terreno) || extrairAreaM2(desc) || 0;
  const situacao = String(lote.status || '');
  const fim = pracas.length ? pracas[pracas.length - 1].fim : null;

  return {
    titulo: (local.cidade && !base.includes(local.cidade) ? `${base} - ${local.cidade}/${local.estado}` : base).slice(0, 200),
    cidade: local.cidade || null, estado: local.estado || null,
    valor_avaliacao: aval || 0, valor_minimo: atual.valor,
    valor_minimo_2: proxima?.valor && proxima.valor !== atual.valor ? proxima.valor : null,
    modalidade: /^JUDICIAL/.test(modSite) ? 'judicial' : /VENDA/.test(modSite) ? 'venda_direta' : 'extrajudicial',
    area_m2: area,
    descricao: [desc || sub, lote.titulo_do_lote && `Local: ${lote.titulo_do_lote}.`].filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: atual.fim, data_leilao_2: proxima?.fim || null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital,
    link_matricula: matDoc?.url || null,
    anexos: [{ tipo: 'edital', nome: 'Edital', url: edital }, ...docs],
    // "nº 137.165 do 1º CRI de Guarulhos/SP" · "n° 72.883 do 2º CRI…" · "nº 9.714 na 1º CRI – Camaçari/BA"
    numero_matricula: (mat.match(/n\s*[º°o.]*\s*([\d.]{1,12}(?:-[A-Z])?)\b/i) || [])[1]?.replace(/\.$/, '')
      || numeroMatriculaDoTexto(desc) || null,
    situacao,
    // Lote só de bem móvel/outro (sem `imovel`) não é imóvel — o filtro `tipo_filtro=imoveis` já deveria excluir.
    naoImovel: bens.length > 0 && bens.every((b) => !b.imovel && b.movel_ou_outro),
    encerrado: FORA.test(situacao) || !!lote.motivo_suspensao || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  valor_minimo_2: det.valor_minimo_2 || null,
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
