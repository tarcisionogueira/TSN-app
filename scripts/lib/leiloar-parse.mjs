/**
 * Parser puro — PLATAFORMA LEILOAR (plataformaleiloar.com.br; 1º tenant: leiloesuberlandia.com.br).
 * Recon 28/09 feito pelo SERVIDOR DO BANCO (net.http_get — a nuvem do Claude não alcança os
 * sites): HTML estático (CakePHP, HTML 4.01), SEM Cloudflare neste tenant, dois níveis:
 *   home /externo/            → cards de leilão  /externo/leilao/<id>/<slug>
 *   leilão /externo/leilao/N  → cards de lote    /externo/lote/<id>/<slug>
 *   lote   /externo/lote/N    → cabeçalho do leilão (nome, "…, CIDADE-UF", datas das hastas)
 *                               + #l-cabecalho-infos-valores (Avaliação / Lance Minimo)
 *                               + #l-lote-descricao <p> + foto em #l-lote-galeria + PDF "IMPRIMIR".
 * Fixtures reais em scripts/testes/fixtures/leiloar-*.html.
 *
 * ⚠️ crleiloes.com.br roda a MESMA plataforma, mas com Cloudflare até no IP residencial (27/09)
 * — não entra aqui; o parser serve se um dia o acesso abrir.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2 } from '../../api/_texto-imovel.js';
import { normCidade } from './inferir-uf.mjs';

export const TENANTS = {
  uberlandia: { fonte: 'UBERLANDIALEILOES', leiloeiro: 'Uberlândia Leilões (Rodrigo de Oliveira Lopes)', base: 'https://www.leiloesuberlandia.com.br' },
};

const limpar = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Nível 1: leilões na home. Nível 2: lotes no leilão. Chave = id numérico.
export function extrairUrlsDeEvento(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/externo\/leilao\/(\d+)(?:\/[a-z0-9-]*)?)["']/gi)) {
    if (!urls.has(m[2])) urls.set(m[2], new URL(`/externo/leilao/${m[2]}`, base).href);
  }
  return urls;
}
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](\/externo\/lote\/(\d+)(\/[a-z0-9-]+)?)["']/gi)) {
    // Prefere a URL com slug (a que o site linka no card); sem slug também abre.
    if (!urls.has(m[2]) || m[3]) urls.set(m[2], new URL(m[1], base).href);
  }
  return urls;
}
export const idDaUrl = (url) => (String(url).match(/\/externo\/lote\/(\d+)/) || [])[1] || null;

// "23/09/2026 às 14:00:00" → ISO com fuso de Brasília.
const dataHora = (s) => {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(20\d{2})(?:\s*(?:às|as)\s*(\d{2}):(\d{2}))?/i);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '12'}:${m[5] || '00'}:00-03:00` : null;
};

// Cidade com acento: o cabeçalho traz "UBERLANDIA-MG" (sem acento); a descrição costuma trazer
// "Uberlândia". Usa a grafia da descrição quando ela normaliza para a mesma cidade.
function cidadeComAcento(cidadeCaps, descricao) {
  const alvo = normCidade(cidadeCaps);
  const palavras = alvo.split(' ').length;
  const toks = String(descricao || '').split(/[^A-Za-zÀ-ÿ']+/).filter(Boolean);
  for (let i = 0; i + palavras <= toks.length; i++) {
    const cand = toks.slice(i, i + palavras).join(' ');
    if (normCidade(cand) === alvo) return titleCase(cand.toLowerCase());
  }
  return titleCase(String(cidadeCaps).toLowerCase());
}

const TIPOS = [[/apartamento|\bapto\b/i, 'Apartamento'], [/\bcasa\b|resid[êe]ncia/i, 'Casa'], [/sobrado/i, 'Sobrado'],
  [/sala comercial|\bsala\b/i, 'Sala Comercial'], [/galp[ãa]o|barrac[ãa]o/i, 'Galpão'], [/\bloja\b/i, 'Loja'],
  [/ch[áa]cara/i, 'Chácara'], [/fazenda|im[óo]vel rural|gleba/i, 'Imóvel Rural'], [/terreno|\blote n/i, 'Terreno']];

export function parseDetalhe(html, url) {
  const h = String(html || '');
  const nomeLeilao = limpar((h.match(/class="l-cabecalho-nome">([\s\S]*?)<\/span>/i) || [])[1]);
  const local = limpar((h.match(/class="l-cabecalho-infos-local">([\s\S]*?)<\/span>/i) || [])[1]).replace(/^[\s,]+/, '');
  const mLocal = local.match(/^(.+?)\s*-\s*([A-Z]{2})$/);
  const descricao = limpar((h.match(/<div id="l-lote-descricao">[\s\S]*?<p>([\s\S]*?)<\/p>/i) || [])[1]);
  const cidade = mLocal ? cidadeComAcento(mLocal[1], descricao) : null;
  const estado = mLocal ? mLocal[2] : null;

  // Datas: "1ª HASTA: …", "ATÉ: …", "2ª HASTA : …", "ATÉ: …" (ou "1°hasta"/"até"). O fim de cada
  // hasta ("ATÉ") é o prazo real de lance — é ele que vira data_leilao / data_leilao_2.
  const itens = [...(h.match(/<ul class="l-cabecalho-datas">([\s\S]*?)<\/ul>/i)?.[1] ?? '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => limpar(m[1]));
  const fins = itens.filter((t) => /^at[ée]\s*:/i.test(t)).map(dataHora).filter(Boolean);
  const inicios = itens.filter((t) => /hasta/i.test(t)).map(dataHora).filter(Boolean);

  const valores = h.match(/<ul id="l-cabecalho-infos-valores"[^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? '';
  const rotulado = (rot) => plaus(num((valores.match(new RegExp(`${rot}[^<]*<\\/span>\\s*<strong>\\s*R\\$\\s*([\\d.]+,\\d{2})`, 'i')) || [])[1]));
  const avaliacao = rotulado('Avalia[çc][ãa]o');
  const minimo = rotulado('Lance M[íi]nimo');

  const foto = (h.match(/<div id="l-lote-galeria">[\s\S]*?<img src="([^"]+)"/i) || [])[1] || null;
  const fotoAbs = foto && !/default\.(jpe?g|png)/i.test(foto) ? new URL(foto.replace('/externo/../', '/'), url).href : null;
  const pdf = (h.match(/href="([^"]+\.pdf)"[^>]*class="l-itm-imprimir"/i) || h.match(/class="l-itm-imprimir"[^>]*href="([^"]+\.pdf)"/i) || [])[1];
  const edital = pdf ? new URL(pdf.replace(/\/externo\/bens\/\.\.\/\.\.\//, '/'), url).href : null;
  const status = limpar((h.match(/<span id="l-status"[^>]*>([\s\S]*?)<\/span>/i) || [])[1]).toUpperCase();

  // Tipo = a palavra-chave que aparece PRIMEIRO na descrição ("Um terreno situado… Residencial
  // Lago Azul" é terreno — o nome do loteamento não pode virar "Casa"; dry-run 28/09).
  const tipo = TIPOS.map(([re, nome]) => ({ nome, pos: descricao.search(re) })).filter((t) => t.pos >= 0)
    .sort((a, b) => a.pos - b.pos)[0]?.nome || 'Imóvel';
  const bairro = (descricao.match(/\bbairro\s+([A-ZÀ-Ý][\wÀ-ÿ' ]{2,40}?)(?=[,.;]| na | no | à )/i) || [])[1];
  const titulo = `${tipo}${bairro ? ` - ${titleCase(bairro.trim().toLowerCase())}` : ''}${cidade ? ` - ${cidade}/${estado}` : ''}`;
  const mat = (descricao.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo || avaliacao,
    modalidade: /extrajudicial/i.test(nomeLeilao) ? 'extrajudicial' : 'judicial',
    area_m2: extrairAreaM2(descricao) || 0,
    descricao: descricao ? `${nomeLeilao ? `${nomeLeilao}. ` : ''}${descricao}`.slice(0, 8000) : null,
    data_leilao: fins[0] || inicios[0] || null,
    data_leilao_2: fins[1] || null,
    link_foto: fotoAbs, link_edital: edital || url,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital do leilão', url: edital }] : [],
    numero_matricula: mat,
    // Status do lote diferente de ABERTO (VENDIDO, ENCERRADO, SUSPENSO, RETIRADO…) = fora.
    encerrado: !!status && !/ABERTO|EM LOTEAMENTO|AGUARDANDO/.test(status),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
