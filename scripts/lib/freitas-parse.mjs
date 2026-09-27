/**
 * Parser puro — FREITAS LEILOEIRO (freitasleiloeiro.com.br). Site próprio em ASP.NET MVC, sem
 * Cloudflare (recon Bright Data 26-27/09, HTML bruto em recon_dump origem='deep' ids 50-56).
 *
 * Catálogo de imóveis: `/Leiloes/Pesquisar?Categoria=2` (Categoria 1 = veículos, 3 = materiais).
 * Página ÚNICA, sem paginação (27/09: 12 lotes em 5 leilões). Cada card traz o link
 * `/Leiloes/LoteDetalhes?leilaoId=<L>&loteNumero=<N>`, cidade/UF e o "Lance Inicial".
 *
 * Detalhe: tudo no HTML estático — "Data do Leilão dd/mm/aaaa Horário hh:mm" (ou "-" quando é
 * venda por PROPOSTAS), "Endereço: … - Cidade/UF", "Descrição completa: …", PDFs no CDN
 * (edital/matricula/catalogo/condicao) e o tipo do lote no JS (`tiposImoveis.indexOf(parseInt('19'))`,
 * 19 = imóvel).
 *
 * ⚠️ NÃO usar `textoDe` no HTML inteiro: há um `<script` sem fechamento casado no topo da página e o
 * regex de remoção de script engole o conteúdo do lote até o fim do documento (medido em 27/09 — o
 * texto útil sumia e o parser sairia vazio com cara de "lote sem descrição"). Recorta a partir de
 * `id="dvFotos"` ANTES de limpar.
 *
 * ⚠️ Lote "ABERTO PARA PROPOSTAS" (ex.: leilão 7924) NÃO mostra valor no detalhe — o valor só
 * existe no card do catálogo. `extrairUrlsDeLote` guarda o valor/cidade de cada card em
 * `CARDS` (mesmo processo) e `parseDetalhe` usa como reserva. Sem card, o valor fica 0 e o
 * portão de qualidade do runner descarta — melhor que inventar.
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, titleCase, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  freitas: { fonte: 'FREITAS', leiloeiro: 'Freitas Leiloeiro', base: 'https://www.freitasleiloeiro.com.br' },
};

const TIPO_IMOVEL = '19';
const RE_LOTE = /\/Leiloes\/LoteDetalhes\?leilaoId=(\d+)&(?:amp;)?loteNumero=(\d+)/i;
const RE_LOTE_G = new RegExp(RE_LOTE.source, 'gi');

/** Cache card → { valor, cidade, estado } preenchido na enumeração (chave = id do lote). */
export const CARDS = new Map();

const limpar = s => String(s || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<script[\s\S]*$/i, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
  .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/\s+/g, ' ').trim();

export const idDaUrl = url => {
  const m = String(url || '').match(RE_LOTE);
  return m ? `${m[1]}-${Number(m[2])}` : null;
};

function cidadeUf(s) {
  // "SAO PAULO/SP" · "Sao Paulo/SP" · "Rio Branco-AC." (início da descrição)
  const m = String(s || '').match(/([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .]{1,60}?)\s*[/-]\s*([A-Z]{2})\b/);
  if (!m) return { cidade: null, estado: null };
  return { cidade: titleCase(m[1].trim()), estado: m[2] };
}

/** Lotes do catálogo; de brinde guarda valor/cidade de cada card em CARDS. */
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  const h = String(html || '');
  // Cada card começa em class="cardlote" — fatiar por ele mantém o valor preso ao PRÓPRIO lote.
  const cards = h.split(/class="cardlote"/i).slice(1);
  for (const card of cards) {
    const m = card.match(RE_LOTE);
    if (!m) continue;
    const url = new URL(m[0].replace(/&amp;/g, '&'), base).href;
    const id = idDaUrl(url);
    urls.set(id, url);
    const valor = plaus(num((card.match(/cardLote-vlr[^>]*>\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
    const local = limpar((card.match(/cardLote-details[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
    CARDS.set(id, { valor, ...cidadeUf(local) });
  }
  // Rede de segurança: link de lote fora do padrão de card também entra (sem dados de card).
  for (const m of h.matchAll(RE_LOTE_G)) {
    const url = new URL(m[0].replace(/&amp;/g, '&'), base).href;
    const id = idDaUrl(url);
    if (!urls.has(id)) urls.set(id, url);
  }
  return urls;
}

const TIPOS = [
  ['conjunto comercial', 'Conjunto Comercial'], ['sala comercial', 'Sala Comercial'], ['apartamento', 'Apartamento'],
  ['sobrado', 'Sobrado'], ['casa', 'Casa'], ['galp[ãa]o', 'Galpão'], ['pr[ée]dio', 'Prédio'], ['loja', 'Loja'],
  ['terreno', 'Terreno'], ['fazenda', 'Fazenda'], ['s[íi]tio', 'Sítio'], ['ch[áa]cara', 'Chácara'],
  ['im[óo]vel rural', 'Imóvel Rural'], ['[áa]rea rural', 'Área Rural'], ['lote', 'Lote'], ['sala', 'Sala'],
];
function tipoDaDescricao(d) {
  for (const [re, nome] of TIPOS) if (new RegExp(`\\b${re}\\b`, 'i').test(d)) return nome;
  return 'Imóvel';
}

const RE_ENCERRADO = /\b(VENDIDO|ARREMATADO|ENCERRADO|CANCELADO|RETIRADO|SUSPENSO|PREJUDICADO|SEM LICITANTES|DESERTO)\b/;

export function parseDetalhe(html, url) {
  const h = String(html || '');
  const i = h.search(/id="dvFotos"/i);
  const txt = limpar(i >= 0 ? h.slice(i) : h);
  const id = idDaUrl(url);
  const card = CARDS.get(id) || {};

  const tipoId = (h.match(/tiposImoveis\.indexOf\(parseInt\('(\d+)'\)\)/) || [])[1] || null;
  const descricao = ((txt.match(/Descri[çc][ãa]o completa:\s*(.+?)(?:\s+Clique aqui para simular|\s+Informa[çc][õo]es importantes:|$)/i) || [])[1] || '').trim() || null;
  const endereco = ((txt.match(/Endere[çc]o:\s*(.+?)\s+Descri[çc][ãa]o completa:/i) || [])[1] || '').trim();

  // Cidade: fim do "Endereço: … - Cidade/UF" > início da descrição ("Rio Branco-AC.") > card.
  let loc = endereco ? cidadeUf(endereco.split(/\s+-\s+/).pop()) : { cidade: null, estado: null };
  if (!loc.estado && descricao) loc = cidadeUf(descricao.slice(0, 60));
  if (!loc.estado) loc = { cidade: card.cidade || null, estado: card.estado || null };

  const dataBr = (txt.match(/Data do Leil[ãa]o\s+(\d{2})\/(\d{2})\/(20\d{2})/i) || []);
  const data_leilao = dataBr[3] ? `${dataBr[3]}-${dataBr[2]}-${dataBr[1]}` : null;
  const propostas = /ABERTO PARA PROPOSTAS/i.test(txt);

  const lance = plaus(num((txt.match(/R\$\s*([\d.]+,\d{2})\s*Lance\s+(?:M[íi]nimo|Inicial)/i) || [])[1]));
  const avaliacao = plaus(num((txt.match(/avalia[çc][ãa]o[^R]{0,40}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const minimo = lance || card.valor || 0;

  const pdf = tipo => (h.match(new RegExp(`https?://[^"'\\s]+/${tipo}/[^"'\\s]+\\.pdf`, 'i')) || [])[0] || null;
  const link_edital = pdf('edital'), link_matricula = pdf('matricula');
  const anexos = [
    link_edital && { tipo: 'edital', nome: 'Edital', url: link_edital },
    link_matricula && { tipo: 'matricula', nome: 'Matrícula', url: link_matricula },
    pdf('condicao') && { tipo: 'outro', nome: 'Condições de venda', url: pdf('condicao') },
    pdf('catalogo') && { tipo: 'outro', nome: 'Catálogo do leilão', url: pdf('catalogo') },
  ].filter(Boolean);

  const foto = (h.match(/https?:\/\/[^"'\s]+\/LEILOES\/\d+\/FOTOS\/[^"'\s]+\.(?:jpe?g|png|webp)/i) || [])[0] || null;
  // Número termina em DÍGITO: "sob nº 53.610." não leva o ponto final da frase.
  const mat = (descricao || '').match(/Matr(?:[íi]cula|\.)\s*(?:n[º°.]?\s*)?(\d[\d.]*\d)/i)
    || (descricao || '').match(/Registro de Im[óo]veis[^.]{0,120}?sob\s+n[º°]?\s*(\d[\d.]*\d)/i);

  const tipo = tipoDaDescricao(descricao || '');
  const titulo = loc.cidade ? `${tipo} - ${loc.cidade}/${loc.estado}` : tipo;
  const status = (txt.match(/Curtidas\s+\d+\s+([A-ZÇÃÕÉÊÍÓÚ ]{4,40}?)\s+(?:Condi|Edital|Cat[áa]logo)/) || [])[1] || '';

  return {
    titulo, cidade: loc.cidade, estado: loc.estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade: propostas ? 'venda_direta' : (/\bprocesso\b|judicial/i.test(descricao || '') ? 'judicial' : 'extrajudicial'),
    area_m2: extrairArea(titulo, descricao || ''),
    descricao,
    data_leilao,
    numero_matricula: mat ? mat[1] : null,
    link_edital, link_matricula, anexos, link_foto: foto,
    // Categoria=2 já filtra; o tipo do JS é a segunda trava (lote de veículo/material não entra).
    encerrado: (tipoId && tipoId !== TIPO_IMOVEL) || RE_ENCERRADO.test(status),
    _tipoId: tipoId, _status: status || null,
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
