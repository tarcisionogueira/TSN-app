/**
 * Parser puro — LEILÃO ELETRÔNICO (leilaoeletronico.com.br; leiloeiros André Zalcman JUCESP 1590 e Felipe
 * Rodrigues de Souza JUCESP 1462). Plataforma "Sua Plataforma de Leilão" (Degrau), a mesma de MGL/Viva/Franco,
 * mas SEM Cloudflare: o feed e as páginas abrem pela via grátis (medido 23/10 pelo banco: HTTP 200). Pendência 307.
 *
 * DUAS FONTES DE DADO, porque nenhuma basta sozinha (medido 23/10 no lote 2653):
 *  - FEED `/sitemap.xml` (`<listing>`, ver lib/degrau-feed.mjs): cidade, estado, bairro, coordenadas, fotos,
 *    avaliação (`<price>`) e, POR PRAÇA, fim e lance mínimo (`<available_dates_price_config>`). Na página, as
 *    praças (abertura, fechamento, lance) são preenchidas por JavaScript e chegam VAZIAS no HTML.
 *  - PÁGINA do lote: título (breadcrumb), modalidade (h1), avaliação, área, descrição, documentos e endereço.
 *  A enumeração guarda o item do feed em FEED (por id) e o parseDetalhe junta os dois. Os dois rodam no
 *  mesmo processo (o runner sempre enumera antes de abrir o detalhe).
 *
 * ⚠️ O JSON-LD da página NÃO é deste lote: no 2653 (casa de R$ 18 mi em Santana de Parnaíba) ele descrevia o
 *    2219 (terreno em Itapecerica da Serra, R$ 2,7 mi) — bloco copiado entre páginas. Não é lido.
 * ⚠️ `<rate>` vem em DOIS formatos no mesmo feed: "15000000,00 BRL" (reais) e "169390200 BRL" (CENTAVOS —
 *    lote 2419: price 1693902,00, 1ª praça 169390200 = a avaliação, 2ª 84695100 = 50%). Sem vírgula = centavos.
 */
import { lotesDoFeed, ehFeedDegrau } from './degrau-feed.mjs';
import { naoImovelDoFeed } from './mgl-parse.mjs';
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, titleCase, montarRowDom, UF_POR_NOME, UFS, cidadeUFBare, semPrefixoCidade } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';
import MUNICIPIOS from '../../api/_municipios.js';
import { normCidade } from './inferir-uf.mjs';

export const TENANTS = {
  leilaoeletronico: { fonte: 'LEILAOELETRONICO', leiloeiro: 'Leilão Eletrônico', base: 'https://www.leilaoeletronico.com.br', catalogo: '/sitemap.xml' },
  // ── MESMA PLATAFORMA DEGRAU, MESMO HTML (24/10, varredura de leiloeiros não cobertos) ─────────────────────────
  // Achados na triagem JUCEMG/JUCESP (`leiloeiro_triagem`): a home dá 400 a UA de navegador (IIS) e Cloudflare só
  // na beira — `pagina_pedir_pelada` (banco) abre home, feed /sitemap.xml e página de lote com HTTP 200, sem Bright
  // Data nem Firecrawl. As páginas têm as MESMAS seções `dg-lote-*` do Leilão Eletrônico (conferido nos 9 sites,
  // 2 lotes cada). Entre parênteses: lotes ABERTOS no feed em 24/10 (antes do filtro de não-imóvel).
  // Nenhum estava no acervo por outra fonte (cruzado por domínio do url_lote E por nome do leiloeiro em imoveis_leilao).
  // ⚠️ destakleiloes também está em TENANTS_PADRAO de scripts/scraper_vlance.py (Vlance, recon de 23/07) — lá rende 0
  //    lote hoje: o site migrou para a Degrau. O fonte_id aqui é `destakleiloes_<id>` (o do Vlance seria outro), sem colisão.
  destak:     { fonte: 'DESTAKLEILOES',  leiloeiro: 'Destak Leilões',  base: 'https://www.destakleiloes.com.br', catalogo: '/sitemap.xml' },      // 399, nacional (Marcus Vinicius Y. Uebara)
  taba:       { fonte: 'TABALEILOES',    leiloeiro: 'Taba Leilões',    base: 'https://www.tabaleiloes.com.br', catalogo: '/sitemap.xml' },        // 178, nacional (Wesley O. Ascanio)
  oficial:    { fonte: 'LEILAOOFICIALONLINE', leiloeiro: 'Leilão Oficial Online', base: 'https://www.leilaooficialonline.com.br', catalogo: '/sitemap.xml' }, // 72, SP (Clécio O. de Carvalho)
  silva:      { fonte: 'SILVALEILOES',   leiloeiro: 'Silva Leilões',   base: 'https://www.silvaleiloes.com.br', catalogo: '/sitemap.xml' },       // 36 (Renan Souza Silva)
  pulse:      { fonte: 'PULSELEILOES',   leiloeiro: 'Pulse Leilões',   base: 'https://www.pulseleiloes.com.br', catalogo: '/sitemap.xml' },       // 32, SP (Mayara Turina Loterio)
  silveira:   { fonte: 'SILVEIRALEILOES', leiloeiro: 'Silveira Leilões', base: 'https://www.silveiraleiloes.com.br', catalogo: '/sitemap.xml' },  // 23, SP (Marcelo E. F. Pierobom Silveira)
  milhao:     { fonte: 'MILHAOLEILOES',  leiloeiro: 'Milhão Leilões',  base: 'https://www.milhaoleiloes.com.br', catalogo: '/sitemap.xml' },      // 22, MG/GO (Guilherme Caixeta Borges)
  up:         { fonte: 'UPLEILAO',       leiloeiro: 'UP Leilão',       base: 'https://www.upleilao.com.br', catalogo: '/sitemap.xml' },           // 12, SP (Paulo Marcelo Silva Almeida)
  select:     { fonte: 'SELECTLEILOES',  leiloeiro: 'Select Leilões',  base: 'https://www.selectleiloes.com.br', catalogo: '/sitemap.xml' },      //  6, SP/MS (Mauricio S. Appolinario)
  // 24/10 (2ª leva, triagem575 — leiloeiros ATIVOS das Juntas ainda não coletados). Mesma Degrau; home dá 400 a UA
  // de navegador e abre "pelada" (o fetch do motor já repete sem cabeçalho). Feed e 1–2 lotes de cada pelo banco,
  // passados neste parser em seco. Entre parênteses: lotes abertos que sobram depois do filtro de não-imóvel.
  // Nenhum lote destes domínios estava no acervo. FORA: falleirosleiloes.com.br (feed vazio hoje). GF e Absoluta
  // entraram depois (pendência 356, abaixo).
  inova:      { fonte: 'INOVALEILAO',    leiloeiro: 'Inova Leilão (Dias Martins)', base: 'https://www.inovaleilao.com.br', catalogo: '/sitemap.xml' }, // 91, PE/AL
  barreto:    { fonte: 'BARRETOLEIL',    leiloeiro: 'Barreto Leilões (Bruno Barreto Sanches)', base: 'https://www.barretoleiloes.com.br', catalogo: '/sitemap.xml' }, // 61, GO/MT/MS/PR
  chbarbosa:  { fonte: 'CHBARBOSA',      leiloeiro: 'CH Barbosa Leilões (Carlos Henrique Barbosa)', base: 'https://www.chbarbosaleiloes.com.br', catalogo: '/sitemap.xml' }, // 15, GO/MT
  erikamaciel: { fonte: 'ERIKAMACIEL',   leiloeiro: 'Leiloeira Erika Maciel', base: 'https://www.leiloeiraerikamaciel.com.br', catalogo: '/sitemap.xml' }, //  2, RJ
  gracie:     { fonte: 'GRACIELEIL',     leiloeiro: 'Gracie Leilões (Renato Gracie)', base: 'https://www.gracieleiloes.com.br', catalogo: '/sitemap.xml' }, //  1, PE
  // 24/10 (pendência 356). GF: o <city> do feed é o padrão "Acrelândia/Acre" em TODOS os lotes e o título traz o BAIRRO
  // ("Vila Prudente/ SP") — entrou depois que a cidade passou a exigir prova do IBGE (parseDetalhe). 27 imóveis abertos.
  gf:         { fonte: 'GFLEILOES',      leiloeiro: 'GF Leilões', base: 'https://www.gfleiloes.com.br', catalogo: '/sitemap.xml' }, // 27, SP
  // ABSOLUTA (recon 24/10 pelo banco, via pelada): a rota do feed ESTÁ certa — 38, 41 e 44 abrem com HTTP 200 e as
  // seções dg-lote-*. Os 404 da 1ª triagem eram 30 e 31, lotes que saíram do site e o feed ainda lista. O motor já trata
  // isso (detalhe que não abre = sem detalhe, não grava). O feed tem ainda 5 "exemplo-de-leilao" (demo da plataforma).
  absoluta:   { fonte: 'ABSOLUTALEIL',   leiloeiro: 'Absoluta Leilões', base: 'https://www.absolutaleiloes.com.br', catalogo: '/sitemap.xml' }, // 12, SP/MA
};

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const ufDoNome = (nome) => UF_POR_NOME[semAcento(nome).trim().replace(/\s+/g, '-')] || null;

// "15000000,00 BRL" → 15000000 · "169390200 BRL" → 1693902 (centavos).
export function valorDoFeed(s) {
  const t = String(s || '').replace(/[^\d,]/g, '');
  if (!t) return 0;
  return t.includes(',') ? num(t) : Number(t) / 100;
}

// Item do feed → dados por id. Guarda TODOS (abertos e encerrados): um lote do acervo que saiu do feed ou só tem
// praça vencida é "encerrado" no detalhe.
export function itensDoFeed(xml) {
  const out = new Map();
  for (const [, item] of String(xml || '').matchAll(/<listing>([\s\S]*?)<\/listing>/gi)) {
    const u = (item.match(/<url>\s*([^<\s]*\/lote\/[^<\s/]+\/(\d+)\/?)\s*<\/url>/i) || []);
    if (!u[2]) continue;
    const tag = (n) => limpo((item.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, 'i')) || [])[1]);
    const comp = (n) => limpo((item.match(new RegExp(`<component name="${n}">([\\s\\S]*?)</component>`, 'i')) || [])[1]);
    const lat = Number.parseFloat(tag('latitude')), lng = Number.parseFloat(tag('longitude'));
    const coordOk = lat < 6 && lat > -34 && lng < -28 && lng > -74 && lat !== 0 && lng !== 0;
    const pracas = [...item.matchAll(/<available_dates_price_config>([\s\S]*?)<\/available_dates_price_config>/gi)].map(([, p]) => ({
      fim: (p.match(/<end_date>\s*([\d-]+T[\d:]+)/i) || [])[1] || null,
      valor: valorDoFeed((p.match(/<rate>([^<]*)<\/rate>/i) || [])[1]),
    })).filter((p) => p.fim).sort((a, b) => a.fim.localeCompare(b.fim));
    out.set(u[2], {
      url: u[1], modalidade: tag('name'), cidade: comp('city') || null, estado: ufDoNome(comp('region')),
      bairro: tag('neighborhood') || null, latitude: coordOk ? lat : null, longitude: coordOk ? lng : null,
      fotos: [...new Set([...item.matchAll(/<image>\s*<url>\s*([^<\s]+)\s*<\/url>/gi)].map((m) => m[1]))],
      avaliacao: valorDoFeed(tag('price')), pracas,
    });
  }
  return out;
}

// O id do lote é sequencial POR SITE (Destak 6200 e Taba 6200 são lotes diferentes) e o runner roda os tenants um
// depois do outro no MESMO processo: chave só por id deixava o feed do tenant anterior responder pelo lote do seguinte
// (cidade, praças e "encerrado" de outro site, sem erro nenhum). A chave é host + id; HOSTS_COM_FEED diz de quais
// sites o feed já foi lido nesta execução (é ele, não o tamanho do mapa, que permite concluir "saiu do feed").
const FEED = new Map();
const HOSTS_COM_FEED = new Set();
const hostDe = (u) => { try { return new URL(u).host.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const chaveFeed = (u, id) => `${hostDe(u)}|${id}`;

export function extrairUrlsDeLote(html, base) {
  if (!ehFeedDegrau(html)) return new Map();
  for (const [id, it] of itensDoFeed(html)) {
    let abs = base;
    try { abs = new URL(it.url, base).href; } catch { /* url malformada no feed: o lote fica com o host do tenant */ }
    FEED.set(chaveFeed(abs, id), it);
  }
  HOSTS_COM_FEED.add(hostDe(base));
  return lotesDoFeed(html, base, { descartar: naoImovelDoFeed });
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/[^/]+\/(\d+)/) || [])[1] || null;

// Praça vigente = a primeira que ainda não fechou; a seguinte vira a 2ª (mesmo critério do ares-parse).
// O feed traz hora local de Brasília sem fuso.
function pracasVigentes(pracas, agoraISO) {
  const i = pracas.findIndex((p) => p.fim >= agoraISO);
  const vig = i >= 0 ? pracas[i] : pracas[pracas.length - 1] || null;
  const prox = i >= 0 ? pracas[i + 1] || null : null;
  return { vig, prox, encerrado: pracas.length > 0 && i < 0 };
}

function modalidadeDe(s) {
  const t = semAcento(s);
  if (/venda direta/.test(t)) return 'venda_direta';
  if (/extrajudicial|particular/.test(t)) return 'extrajudicial';
  if (/judicial/.test(t)) return 'judicial';
  return 'extrajudicial';
}

// Tema sem campo de modalidade: o que o leilão ESCREVE no nome/slug ("Leilão Judicial - …"); sem isso, processo CNJ na
// descrição = judicial. "Execução de Título Extrajudicial" é nome de AÇÃO judicial — por isso a descrição não é lida
// como texto, só o número do processo conta.
const RE_CATEGORIA_NAO_IMOVEL = /^(diversos|veiculos?|carros?|motos?|caminh|maquinas?|equipamentos?|bens moveis|moveis|sucatas?|eletro|informatica|animais|semoventes)/;
const RE_NOME_DIZ_O_BEM = /im[oó]ve|casa|apartament|\bapto?\b|terreno|\blotes?\b|gleba|fazenda|s[ií]tio|ch[aá]cara|galp[aã]o|pr[eé]dio|\bsala|\bloja|sobrado|[aá]rea|rural|edif|resid|comercia|vaga|direitos|im[oó]vel|kitnet|cobertura|haras|industrial|barrac[aã]o/i;
const slugLegivel = (url) => {
  const sl = String(url).split('/lote/')[1] || '';
  try { return decodeURIComponent(sl).replace(/-/g, ' '); } catch { return sl.replace(/-/g, ' '); } // % solto no slug: usa cru
};
function modalidadeSemCampo(texto, proc, nomeFeed) {
  const t = semAcento(texto);
  if (/venda direta/.test(t)) return 'venda_direta';
  if (/extrajudicial|alienacao particular|particular/.test(t)) return 'extrajudicial';
  if (/\bjudicial\b/.test(t)) return 'judicial';
  if (proc) return 'judicial';
  return modalidadeDe(nomeFeed || '');
}

const secao = (h, id) => (h.match(new RegExp(`<section[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</section>`, 'i')) || [])[1] || '';

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  // Lote que REDIRECIONA para o Comprei (venda direta da PGFN — UP Leilão 89, 24/10): a página que chega é a do gov,
  // sem nada da plataforma. Esse imóvel já entra pela fonte COMPREI; ler aqui seria gravar o feed como se fosse o
  // lote, com título genérico e sem cidade. null = "não li esta página" (o runner conta como sem detalhe).
  if (!/dg-lote/i.test(h) && /comprei\.pgfn\.gov\.br|O Comprei [ée] uma plataforma/i.test(h.slice(0, 5000))) return null;
  const id = idDaUrl(url);
  const feed = FEED.get(chaveFeed(url, id)) || null;

  // Título = último item do breadcrumb ("Leilão de Casa de Alto Padrão, em Santana de Parnaíba/SP EXTRAJUDICIAL").
  // O 1º <nav> da página é o menu do topo: o breadcrumb é a lista que começa em "Home".
  const bc = [...((h.match(/>\s*Home\s*<\/a>\s*<\/li>([\s\S]*?)<\/ul>/i) || [])[1] || '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => limpo(m[1]));
  const tituloCru = bc.length ? bc[bc.length - 1] : '';
  // Categoria da plataforma = 1º item depois de "Home" no breadcrumb (Residenciais, Comerciais, Terrenos, Rurais,
  // Industriais… e Diversos/Veículos, que não são imóvel). Medido em 24/10 nos 9 tenants novos: Destak tem 10 "Diversos"
  // em 25 lotes (estrutura eólica, móveis, prensa) que o texto não denuncia — sem isto entravam no acervo de imóveis.
  const categoria = bc.length > 1 ? bc[0] : '';
  const naoImovel = RE_CATEGORIA_NAO_IMOVEL.test(semAcento(categoria));
  // DOIS TEMAS DA MESMA PLATAFORMA (24/10). Leilão Eletrônico: `<h1 class="dg-titulo"><span class="dg-lote-tipo">EXTRAJUDICIAL`
  // e o breadcrumb termina no nome do lote. Destak/Taba/Silva/Pulse/Milhão…: `<h1 class="dg-lote-titulo"><span
  // class="dg-lote-nome">Três Casas em Itapecerica da Serra/SP</span>` e o breadcrumb é "<nome do LEILÃO> <nome do lote>"
  // colado — lido como título, saía "Três Casas em Itapecerica da Serra/SP Três Casas em Itapecerica da Serra/SP".
  // Com `dg-lote-nome` o título é ele; o breadcrumb continua servindo para cidade/UF e modalidade.
  // Variante sem o <span> (Leilão Oficial Online): o nome é o texto solto do h1 antes do " | Cód do leilão".
  const nomeLote = limpo((h.match(/<span[^>]*class=["'][^"']*\bdg-lote-nome\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)
    || h.match(/<h1[^>]*class=["'][^"']*\bdg-lote-titulo\b[^"']*["'][^>]*>\s*([^<|]*[^<|\s])\s*\|/i) || [])[1]);
  // Nome de lote que não diz o que é o bem — Taba "Ubatuba - SP" (o bem está no nome do LEILÃO: "Terrenos e
  // Apartamento - J013(2)"), Pulse "." — vira "<leilão> - <lote>", com o leilão tirado do breadcrumb sem o nome repetido.
  let nomeTitulo = nomeLote;
  if (nomeLote && !RE_NOME_DIZ_O_BEM.test(nomeLote)) {
    const leilao = tituloCru.endsWith(nomeLote) ? tituloCru.slice(0, -nomeLote.length).trim() : tituloCru;
    nomeTitulo = [leilao, nomeLote.replace(/^[\s.\-|]+|[\s.\-|]+$/g, '')].filter(Boolean).join(' - ');
  }
  let titulo = (nomeTitulo || tituloCru.replace(/\s+(EXTRAJUDICIAL|JUDICIAL|VENDA DIRETA|PARTICULAR)\s*$/i, ''))
    .replace(/^Leil+[ãa]o\s+(de|do|da)\s+/i, '').replace(/^\w/, (c) => c.toUpperCase()).slice(0, 180) || null;
  // Modalidade: o tema do Leilão Eletrônico escreve no `dg-lote-tipo`. O outro tema não tem campo nenhum — o h1 é o
  // nome do lote e, lido como modalidade, dava "extrajudicial" para "Leilão Judicial - Casa em Igarapé/MG".
  const h1 = limpo((h.match(/<span[^>]*class=["'][^"']*\bdg-lote-tipo\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [])[1])
    || (nomeLote ? '' : limpo((h.match(/<h1[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1]));

  const avalPagina = plaus(num((h.match(/Avalia[çc][ãa]o:\s*<\/span>\s*<strong[^>]*>\s*R\$\s*([\d.,]+)/i) || [])[1]));

  // Área: os cartões de "Informações" (title="ÁREA CONSTRUÍDA" / "ÁREA ÚTIL" / "ÁREA DO TERRENO"…). Construída/útil
  // antes de terreno; sem cartão, o extrator central lê a descrição.
  const cards = [...secao(h, 'dg-lote-informacoes').matchAll(/title=["']([^"']+)["'][\s\S]*?<span>\s*<span[^>]*>([^<]+)<\/span>/gi)]
    .map(([, t, v]) => ({ t: semAcento(decodificarEntidades(t)), v: decodificarEntidades(v).trim() }));
  const areaCard = ['construida', 'util', 'privativa', 'total', 'terreno']
    .map((k) => cards.find((c) => c.t.includes('area') && c.t.includes(k))).filter(Boolean)
    .map((c) => extrairArea(`${c.v.replace(/m\s*$/i, 'm²')}`, '')).find((v) => v > 0) || 0;

  const descricao = limpo(secao(h, 'dg-lote-descricao').replace(/<h2[\s\S]*?<\/h2>/i, '')).slice(0, 8000) || null;
  // Nem o lote nem o leilão dizem o bem (Select: leilão "2ª VARA DE EXECUÇÃO DE CAMPO GRANDE-MS", lote "01"): a 1ª frase
  // da descrição, que é onde este leiloeiro escreve o que está à venda.
  if (nomeLote && titulo && !RE_NOME_DIZ_O_BEM.test(titulo) && descricao) {
    const frase = descricao.split(/\n|(?<=[a-zà-ÿ0-9)]{3})\.\s/i)[0].trim();
    if (RE_NOME_DIZ_O_BEM.test(frase)) titulo = frase.slice(0, 180);
  }
  // Endereço: a <div class="dg-lote-local-endereco">. O genérico "1ª <div> com texto" pegava, na página REAL,
  // a <div class="col-xs-12"> que sobra só com espaços depois de tirar o <h3> — e o endereço saía nulo nos
  // 137 lotes (23/10; a fixture simplificada não tinha essa camada). Exige ao menos um caractere visível.
  const loc = secao(h, 'dg-lote-local').replace(/<h3[\s\S]*?<\/h3>/i, '');
  const endereco = limpo((loc.match(/class=["'][^"']*dg-lote-local-endereco[^"']*["'][^>]*>\s*([^<]*\S[^<]*?)\s*<\/div>/i)
    || loc.match(/<div[^>]*>\s*([^<]*\S[^<]{4,198}?)\s*<\/div>/) || [])[1]) || null;

  const anexos = [...secao(h, 'dg-lote-documentos').matchAll(/<li[^>]*>\s*([^<]+?)\s*<a[\s\S]*?<\/li>/gi)].flatMap(([bloco, nome]) => {
    const dl = (bloco.match(/href=["']([^"']*\/download\/[^"']+)["']/i) || [])[1];
    if (!dl) return [];
    const n = limpo(nome);
    const tipo = /matr[íi]cula/i.test(n) ? 'matricula' : /edital/i.test(n) ? 'edital' : /laudo|avalia/i.test(n) ? 'laudo' : 'outro';
    let abs; try { abs = new URL(dl, url).href; } catch { return []; }
    return [{ tipo, nome: n.slice(0, 120) || 'Documento', url: abs }];
  });

  const mat = (String(descricao || '').match(/matr[íi]cula(?:\s+imobili[áa]ria)?\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;
  const proc = (String(descricao || '').match(/\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/) || [])[1] || null;

  // Datas e lances só do feed (na página vêm vazios). Lote fora do feed lido nesta rodada = saiu do site.
  const agoraISO = new Date(+agora - 3 * 3600e3).toISOString().slice(0, 19);
  const { vig, prox, encerrado } = pracasVigentes(feed?.pracas || [], agoraISO);
  const avaliacao = avalPagina || plaus(feed?.avaliacao) || plaus(feed?.pracas?.[0]?.valor);
  const minimo = plaus(vig?.valor) || avaliacao;
  const minimo2 = prox ? plaus(prox.valor) : 0;

  // Cidade/UF — ordem medida em 23/10: (1) o "Cidade/UF" ESCRITO no título; (2) o feed; (3) a descrição. O feed
  // não pode vir primeiro: lote recém-cadastrado sai com o valor-padrão do seletor, "Acrelândia/Acre" (o 1º
  // município do IBGE) — 3 de 240 (2823, 2824 "Apartamento e Vaga em Brasília/DF", 2826). Esse padrão só vale se o
  // próprio lote citar Acrelândia.
  // + "Cidade - UF" no nome do lote (Taba: "Domingos Martins - ES - Ponto Alto", "Lote 14 - Ananindeua - PA - Icuí"),
  // só com UF que existe. Sem ele a cidade vinha da descrição, onde o extrator genérico cortava "município de
  // Domingos Martins/ES" em "Ípio de Domingos Martins" (24/10).
  const doTitulo = tituloCru.match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)\s*\/\s*([A-Z]{2})\b/)
    || [...String(nomeLote || '').matchAll(/(?:^|\s[-–]\s)([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)\s+[-–]\s+([A-Z]{2})(?![A-Za-z])/g)].find((m) => UFS.has(m[2]))
    || [];
  const feedPlaceholder = semAcento(feed?.cidade) === 'acrelandia' && !/acrel[aâ]ndia/i.test(`${tituloCru} ${descricao || ''}`);
  const daDescricao = cidadeUFBare(`${descricao || ''} ${endereco || ''}`);
  // "4ª VARA CÍVEL DE DOURADOS/MS" (Select, 24/10): o nome da vara antes da cidade saía como cidade ("Vara Cível de Dourados").
  const cidadeTitulo = doTitulo[1] ? titleCase(semPrefixoCidade(doTitulo[1].replace(/^.*\bem\s+/i, '').replace(/^.*\bvara\b.*?\bd[aeo]s?\s+/i, ''))) : null;
  // UF que a PÁGINA declara: "Cidade/UF" do título ou o "| SP" no fim dele (GF: "… | Vila Prudente | SP").
  const ufFimTitulo = (tituloCru.match(/\|\s*([A-Z]{2})\s*$/) || [])[1];
  const ufPagina = doTitulo[2] || (UFS.has(ufFimTitulo) ? ufFimTitulo : null);
  // CIDADE SÓ COM PROVA DO IBGE (24/10, GF Leilões): o título da GF escreve o BAIRRO no lugar da cidade ("Vila Prudente/ SP",
  // "… | Vila Prudente | SP") e o feed manda o padrão do seletor ("Acrelândia/Acre") em todos os lotes — os dois saíam
  // como cidade, plausíveis e errados. Cada candidato (título → feed → descrição) só vale se o par cidade+UF existe no
  // IBGE; e o feed não vence a página: UF do feed diferente da UF que o título declara = valor padrão, não endereço.
  const noIbge = (c, uf) => !!c && !!uf && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`);
  const feedConfere = !feedPlaceholder && (!ufPagina || feed?.estado === ufPagina);
  const candidatos = [
    [cidadeTitulo, doTitulo[2]],
    feedConfere ? [feed?.cidade, feed?.estado] : [],
    [daDescricao?.cidade, daDescricao?.estado],
  ];
  const [cidade, ufCidade] = candidatos.find(([c, uf]) => noIbge(c, uf)) || [null, null];
  const estado = ufCidade || ufPagina || (feedConfere && feed?.estado) || daDescricao?.estado || null;

  return {
    naoImovel,
    titulo, cidade, estado, endereco, bairro: feed?.bairro || null,
    latitude: feed?.latitude ?? null, longitude: feed?.longitude ?? null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    valor_minimo_2: minimo2 && minimo2 !== minimo ? minimo2 : null,
    data_leilao: vig?.fim ? vig.fim.slice(0, 10) : null,
    data_leilao_2: prox?.fim ? new Date(`${prox.fim}-03:00`).toISOString() : null,
    modalidade: h1 ? modalidadeDe(h1) : modalidadeSemCampo(`${tituloCru} ${slugLegivel(url)}`, proc, feed?.modalidade),
    area_m2: areaCard || extrairArea(titulo || '', descricao || ''),
    descricao, numero_matricula: mat, numero_processo: proc, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: feed?.fotos?.[0] || null, fotos: feed?.fotos || [],
    encerrado: HOSTS_COM_FEED.has(hostDe(url)) && (!feed || encerrado),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  endereco: det.endereco || null, bairro: det.bairro || null, numero_processo: det.numero_processo || null,
  valor_minimo_2: det.valor_minimo_2 || null,
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
  ...(det.latitude != null ? { latitude: det.latitude, longitude: det.longitude, geocod_nivel: 'endereco' } : {}),
});
export { checarQualidade };
