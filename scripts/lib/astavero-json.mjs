/**
 * Parser puro — plataforma ASTAVERO (backend Angular + API JSON própria, multi-tenant). Recon 05/10
 * (pendência #41): o recon de 13/09 achou `/app/lotes` e concluiu "responde 403 sem sessão" — testava
 * GET com querystring. O bundle (`main.*.js`) mostra que é **POST com corpo JSON** (`home.nav`), e
 * assim responde 200 sem login, sem cookie, sem Cloudflare. Mesmo backend em 5 leiloeiros (abaixo).
 *
 *  - LISTAGEM  POST /app/lotes        {botao:'ABERTOS', categoria:'Imóveis', uf:'', cidade:'', …}
 *              → { lotes:[{id, leilao, lote, nome, local:'Cidade - UF', valor, avaliacao, praca,
 *                  data, status, vara, origem, image, url}], pag:{count}, categorias:[…] }
 *  - LEILÃO    POST /app/pregao/init  {id: <leilão>, …} — SEM `id` nunca responde; o `lote` que vem junto é o 1º
 *              do leilão, não o pedido (medido) — daqui só se usa `leilao` (datas d1/d2, anexos/edital).
 *  - LOTE      POST /app/pregao/lote  {id: <lote>} — o lote certo.
 *              → { leilao:{datas:{d1,d2,…}, anexos:[{url, private, type}]}, lote:{v:{avaliacao,
 *                  primeira, segunda}, p:{processo, vara, tipo, falencia}, d:{cidade, uf, bairro,
 *                  endereco, cep}, nome, detalhada(HTML), status} }
 */
import { decodificarEntidades, extrairAreaM2 } from '../../api/_texto-imovel.js';
import { classificarPatio } from './patio-veiculo.mjs';

export const TENANTS = [
  { fonte: 'DAMIANILEILOES', leiloeiro: 'Damiani Leilões', base: 'https://www.damianileiloes.com.br' },
  { fonte: 'MAZZOLLILEILOES', leiloeiro: 'Mazzolli Leilões', base: 'https://www.mazzollileiloes.com.br' },
  { fonte: 'FBLEILOES', leiloeiro: 'FB Leilões', base: 'https://www.fbleiloes.com.br' },
  { fonte: 'DBSLEILOES', leiloeiro: 'DBS Leilões', base: 'https://www.dbsleiloes.com.br' },
  { fonte: 'SAULOJULIOLEILOEIRO', leiloeiro: 'Saulo Júlio Leiloeiro', base: 'https://www.saulojulioleiloeiro.com.br' },
  // 26/10 — a "família LEILOADOR" da JUCESC (formula, portaldoleiloeiro, sabrina, elisa, leia) é Astavero: os portais
  // ?pg=item de cada um são vitrine COMPARTILHADA (os mesmos ids nos quatro) e o pregão mora em instâncias Astavero
  // próprias — o POST /app/lotes dava 404 porque era tentado no domínio do portal, não no da instância. Medido pelo
  // banco (POST JSON, 26/10): leiloador.com.br 6 imóveis abertos (edital "julio_ramos_leiloes" — Júlio Ramos Luz, JUCESC,
  // portaldoleiloeiro.com.br), sabrinaleiloes.lel.br 1, deltta 0 imóvel e 267 veículos, leia/tai/itamar/formulla 0
  // (ligados vazios: regra do dono). O leiloeiro vai pelo NOME da Junta onde o host da instância não é o domínio dela.
  { fonte: 'LEILOADOR', leiloeiro: 'Júlio Ramos Luz', base: 'https://leiloador.com.br' },
  { fonte: 'SABRINALEILOES', leiloeiro: 'Sabrina Leilões', base: 'https://www.sabrinaleiloes.lel.br' },
  { fonte: 'LEIALEILOES', leiloeiro: 'Leia Leilões', base: 'https://www.leialeiloes.lel.br' },
  { fonte: 'DELTTALEILOES', leiloeiro: 'Deltta Leilões', base: 'https://www.delttaleiloes.com.br' },
  { fonte: 'TAILEILOES', leiloeiro: 'Tai Leilões', base: 'https://taileiloes.com.br' },
  { fonte: 'ITAMARLEILOES', leiloeiro: 'Itamar Coraci Xavier De Liz', base: 'https://leiloesitamar.com.br' },
  { fonte: 'FORMULLALEILOES', leiloeiro: 'Aridina Maria Do Amaral', base: 'https://www.formullaleiloes.com.br' },
  // 26/10 — o cluster "NAO_E_LEILAO?" da triagem (31 domínios da JUCESC com a home vazia para o pg_net: SPA Angular sem
  // texto) era ASTAVERO. Impressão digital testada em TODOS pelo banco (POST /app/lotes, 26/10): 27 responderam o JSON
  // da plataforma (deltta e tai estão no bloco de cima). Bampi veio da varredura dos 208 "desconhecidos" (o único). Nos
  // comentários, os imóveis abertos no dia — os de 0
  // entram vazios (regra do dono). Fora: octa, maleiloesro, vardana (404 em /app/lotes), leiloeslr (SSL),
  // fabrikadeleiloes (sem DNS no www). Leiloeiro = nome da JUCESC (o cruzamento da Junta casa por host E por nome).
  { fonte: 'BALDISSERALEILOEIROS', leiloeiro: 'Ruy Walter Baldissera', base: 'https://www.baldisseraleiloeiros.com.br' }, // 70
  { fonte: 'OESTELEILOES', leiloeiro: 'Odiclesio Jaison Storchio', base: 'https://www.oesteleiloes.com.br' },               // 32
  { fonte: 'BALDISSERALEILOES', leiloeiro: 'Andréa Baldissera', base: 'https://www.baldisseraleiloes.com.br' },             // 20
  { fonte: 'NELCILEILOES', leiloeiro: 'Nelcir Aparecida Catafesta', base: 'https://www.nelcileiloes.com.br' },              // 18
  { fonte: 'FABIANEBALDISSERA', leiloeiro: 'Fabiane Tissiane Baldissera De Souza', base: 'https://www.fabianebaldisseraleiloes.com.br' }, // 16
  { fonte: 'TOPLEILOES', leiloeiro: 'Paulo Pizzolatti Neto', base: 'https://www.topleiloes.com.br' },                       // 12
  { fonte: 'KROBELLEILOES', leiloeiro: 'Janine Ledoux Krobel Lorenz', base: 'https://www.krobelleiloes.com.br' },           // 9
  { fonte: 'BAMPILEILOES', leiloeiro: 'Ricardo Bampi', base: 'https://www.bampileiloes.com.br' },                           // 5
  { fonte: 'SAMPAIOLEILOES', leiloeiro: 'João Paulo Sampaio Damiani', base: 'https://www.sampaioleiloes.com.br' },          // 3
  { fonte: 'ZAMPIERILEILAO', leiloeiro: 'Jefferson Eduardo Zampieri', base: 'https://www.zampierileilao.com.br' },          // 2
  { fonte: 'ADAIANAGARCIA', leiloeiro: 'Adaiana Garcia', base: 'https://www.adaianagarcialeiloes.com.br' },                 // 2
  { fonte: 'GESTORDELEILOES', leiloeiro: 'Eduardo De Werk', base: 'https://www.gestordeleiloes.com.br' },                   // 1
  { fonte: 'CORREAQUINHONES', leiloeiro: 'Eloisa Auxiliadora Menegassi Correa', base: 'https://www.correaquinhonesleiloes.com.br' }, // 1
  { fonte: 'MAXTERLEILOES', leiloeiro: 'Simone Wenning', base: 'https://www.maxterleiloes.com.br' },
  { fonte: 'SUPREMALEILOES', leiloeiro: 'Taisa Raquel Pereira Carvalho', base: 'https://www.supremaleiloes.com.br' },
  { fonte: 'HITOLEILOES', leiloeiro: 'Andreia Cristina Nunes', base: 'https://www.hitoleiloes.com.br' },
  { fonte: 'LEILOESREI', leiloeiro: 'Roger Wenning', base: 'https://www.leiloesrei.com.br' },
  { fonte: 'AMARQUESLEILOES', leiloeiro: 'Auriannye Marques', base: 'https://www.amarquesleiloes.com.br' },
  { fonte: 'FOXLEILOES', leiloeiro: 'Maurício Guerra Alves', base: 'https://www.foxleiloes.com.br' },
  { fonte: 'OMEGA1LEILOES', leiloeiro: 'Osmar Sergio Costa', base: 'https://www.omega1leiloes.com.br' },
  { fonte: 'VVLEILOES', leiloeiro: 'Débora Viale Prazeres Vilela Veiga', base: 'https://www.vvleiloes.com.br' },
  { fonte: 'BRASSIANILEILOES', leiloeiro: 'Viviane Aparecida Brassiani Engicht', base: 'https://www.brassianileiloes.com.br' },
  { fonte: 'RODOLFOMACARINI', leiloeiro: 'Rodolfo Macarini De Souza', base: 'https://www.leiloeirorodolfomacarini.com.br' },
  { fonte: 'TROMBETTALEILOES', leiloeiro: 'Claudio Trombetta', base: 'https://www.trombettaleiloes.com.br' },
  { fonte: 'MAXXLEILOES', leiloeiro: 'Tatiana Sofka Antunes Ferreira', base: 'https://www.maxxleiloes.com.br' },
  { fonte: 'ALINEMAROS', leiloeiro: 'Aline Maros', base: 'https://www.alinemaros.com.br' },
];

export const CORPO_LISTAGEM = { botao: 'ABERTOS', categoria: 'Imóveis', uf: '', cidade: '', varacomitente: '', f: '' };

const texto = (html) => decodificarEntidades(String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const reais = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 1000 ? Math.round(n * 100) / 100 : 0; };
const UF_RE = /^[A-Z]{2}$/;

export function localDaListagem(local) {
  const m = String(local || '').match(/^(.+?)\s*[-/]\s*([A-Z]{2})\s*$/);
  return m ? { cidade: m[1].trim(), estado: m[2] } : { cidade: null, estado: null };
}

const TIPO = [[/apart|flat|kitnet|cobertura|\bapto\b/i, 'apartamento'], [/casa|sobrado|resid[êe]ncia/i, 'casa'],
  [/fazenda|s[íi]tio|ch[áa]cara|gleba|rural/i, 'rural'],
  [/sala|loja|galp[ãa]o|barrac[ãa]o|pr[ée]dio|comercial|industrial|box|garagem/i, 'comercial'],
  [/terreno|lote\b|[áa]rea/i, 'terreno']];
export const tipoDe = (txt) => TIPO.find(([re]) => re.test(txt))?.[1] || 'imovel';

/** Linha de imoveis_leilao a partir do item da listagem + resposta de /app/pregao/init (ou null). */
export function montarRowAstavero(item, det, tenant) {
  const lote = det?.lote || {};
  const leilao = det?.leilao || {};
  const v = lote.v || {};
  const p = lote.p || {};
  const d = lote.d || {};
  const titulo = String(lote.nome || item.nome || '').replace(/^Lote\s+[\w.]+\s*-\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const descricao = texto(lote.detalhada).slice(0, 8000) || titulo;
  // Cartório escreve "área privativa de 59,74000m²" (5 casas): o extrator central lia 74000 m² num
  // apartamento (dry-run 05/10, Mazzolli). Para medir a área, corta o excesso de casas decimais.
  const paraArea = `${titulo} ${descricao}`.replace(/(\d),(\d{2})\d{1,6}(?=\s*(?:m²|m2|metros))/gi, '$1,$2');
  const daLista = localDaListagem(item.local);
  const estado = UF_RE.test(String(d.uf || '')) ? d.uf : daLista.estado;
  const cidade = String(d.cidade || '').trim() || daLista.cidade;
  const primeira = reais(v.primeira) || reais(item.praca === 1 ? item.valor : 0);
  const segunda = reais(v.segunda);
  const avaliacao = Math.max(reais(v.avaliacao), reais(item.avaliacao), primeira);
  // Praça vigente: 2ª quando a listagem já diz praça 2 — o lance que vale hoje é o dela.
  const minimo = item.praca === 2 && segunda ? segunda : (primeira || reais(item.valor));
  const datas = leilao.datas || {};
  const anexos = (Array.isArray(leilao.anexos) ? leilao.anexos : []).concat(Array.isArray(lote.anexos) ? lote.anexos : [])
    // Foto do lote também vem em `anexos` (.jpg) — documento é só o que não é imagem.
    .filter((a) => a && !a.private && /^https?:\/\//.test(a.url || '') && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(a.url))
    .map((a) => ({ tipo: /edital/i.test(a.arquivo || a.url) ? 'edital' : /matr[íi]cula/i.test(a.arquivo || a.url) ? 'matricula' : 'outro',
      nome: /edital/i.test(a.arquivo || a.url) ? 'Edital' : /matr[íi]cula/i.test(a.arquivo || a.url) ? 'Matrícula' : 'Documento', url: a.url }));
  // Com processo/vara é JUDICIAL — "Execução de Título Extrajudicial" é uma ação na Justiça; a palavra
  // "extrajudicial" no tipo da ação não muda a natureza do leilão (o teste com o lote real pegou isso).
  const judicial = !!(p.processo || p.vara || item.vara) || !/aliena[cç][aã]o\s+fiduci|extrajudicial/i.test(descricao.slice(0, 2000));
  const row = {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${item.id}`,
    titulo: titulo || `Imóvel ${tenant.leiloeiro} ${item.lote || item.id}`,
    tipo: tipoDe(`${titulo} ${descricao.slice(0, 600)}`),
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    cidade: cidade || null, estado: estado || null,
    bairro: String(d.bairro || '').trim(),
    endereco: String(d.endereco || '').length <= 200 ? String(d.endereco || '').trim() : '',
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    valor_minimo_2: item.praca === 2 ? null : (segunda || null),
    area_m2: extrairAreaM2(paraArea) || 0,
    descricao,
    numero_processo: p.processo || null,
    numero_matricula: (descricao.match(/matr[íi]cul\w*\s+(?:sob\s+(?:o\s+)?)?(?:n[º°.o]?\s*)?([\d.]{3,})/i) || [])[1]?.replace(/\./g, '') || null,
    url_lote: item.url || `${tenant.base}/pregao/${item.leilao}/${item.id}`,
    leiloeiro: tenant.leiloeiro,
    // Na 2ª praça a data que vale é a dela: d1 já passou, e a limpeza por data apagaria um lote ainda aberto
    // (Mazzolli, dry-run 05/10: d1 = 01/10, praça corrente 08/10). `lote.datas.leilao` = praça corrente.
    data_leilao: item.praca === 2 ? (datas.d2 || lote.datas?.leilao || item.data || null) : (datas.d1 || item.data || null),
    data_leilao_2: item.praca === 2 ? null : (datas.d2 || null),
    forma_pagamento: 'a_vista', ativo: true, suprimido_motivo: null, atualizado_em: new Date().toISOString(),
  };
  if (d.cep && /^\d{5}-?\d{3}$/.test(String(d.cep))) row.cep = String(d.cep).replace('-', '');
  if (item.image) { row.link_foto = item.image; row.fotos = [item.image]; }
  if (anexos.length) {
    row.anexos = anexos;
    row.link_edital = anexos.find((a) => a.tipo === 'edital')?.url || null;
    row.link_matricula = anexos.find((a) => a.tipo === 'matricula')?.url || null;
  }
  if (avaliacao > 0 && minimo > 0) row.desconto_percentual = Math.max(0, Math.round((1 - minimo / avaliacao) * 100));
  return row;
}

// ── VEÍCULOS (05/10, #139) ────────────────────────────────────────────────────────────────────────
// Mesma API, `categoria: 'Veículos'`. O NOME varia por leiloeiro ("FORD/FIESTA 1.6 SEL AT 2018/2018",
// "Renault Fluence Pri 20A - 2012", "TIGUAN 2.0", "Um Automóvel, VW, Voyage 1.6 Trend, 2010/2011"), mas a
// DESCRIÇÃO do oficial de justiça traz marca, modelo, anos, placa, Renavam, chassi, cor e combustível —
// ela vence o nome sempre que diz. `lote.sucata` vem da própria plataforma.
export const CORPO_LISTAGEM_VEICULOS = { ...CORPO_LISTAGEM, categoria: 'Veículos' };

const MARCAS = 'honda|yamaha|fiat|ford|volkswagen|vw|chevrolet|gm|renault|toyota|hyundai|nissan|peugeot|citro[eë]n|jeep|mitsubishi|suzuki|kawasaki|bmw|iveco|scania|volvo|mercedes(?:-benz)?|m\\.?\\s?benz|kia|chery|caoa chery|jac|audi|land rover|dafra|shineray|haojue|agrale|marcopolo|randon|librelato|facchi|guerra|noma|lider|dodge|ram|chrysler|harley-davidson|triumph|ducati|byd|gwm|troller|effa|lifan'; // eslint-disable-line max-len
const RE_MARCA_BARRA = new RegExp(`(?:^|[\\s,(])(?:I\\s*/\\s*)?(${MARCAS})\\s*/\\s*([A-Z0-9][^,;()\\n]{1,60}?)(?=\\s*(?:\\(|,|;|\\bano\\b|\\b(?:19|20)\\d{2}\\b|$))`, 'i');
// Importado no CRLV: "I/VW TIGUAN 2.0 TSI (Importado)" — marca e modelo separados por ESPAÇO, não barra.
const RE_MARCA_IMPORT = new RegExp(`(?:^|[\\s,(])I\\s*/\\s*(${MARCAS})\\s+([A-Z0-9][^,;()\\n]{1,60}?)(?=\\s*(?:\\(|,|;|\\bano\\b|$))`, 'i');
const RE_MARCA_ROTULO = new RegExp(`marca\\s*:?\\s*(${MARCAS})\\s*,?\\s*(?:modelo\\s*:?\\s*([^,;\\n]{2,60}))?`, 'i');
const CANON = { vw: 'VOLKSWAGEN', gm: 'CHEVROLET', 'm.benz': 'MERCEDES-BENZ', 'm benz': 'MERCEDES-BENZ', mbenz: 'MERCEDES-BENZ', mercedes: 'MERCEDES-BENZ' };
const marcaCanon = (m) => { const k = String(m || '').toLowerCase().replace(/\s+/g, ' ').trim(); return (CANON[k] || CANON[k.replace(/[.\s]/g, '')] || k.toUpperCase()) || null; };

export function veiculoDaDescricao(desc, nome = '') {
  const t = String(desc || '').replace(/\s+/g, ' ');
  let marca = null, modelo = null;
  const rot = t.match(RE_MARCA_ROTULO);
  if (rot) { marca = rot[1]; modelo = rot[2] || null; }
  if (!marca) { const b = t.match(RE_MARCA_BARRA) || t.match(RE_MARCA_IMPORT) || String(nome).match(RE_MARCA_BARRA); if (b) { marca = b[1]; modelo = b[2]; } }
  const anos = t.match(/ano\s+(?:de\s+)?fabrica[çc][ãa]o\s*:?\s*((?:19|20)\d{2})[\s\S]{0,30}?ano\s+(?:de\s+)?modelo\s*:?\s*((?:19|20)\d{2})/i)
    || t.match(/ano\s*\/\s*modelo\s*:?\s*((?:19|20)\d{2})\s*\/\s*((?:19|20)\d{2})/i)
    || t.match(/\bano\s+((?:19|20)\d{2})\s+e\s+modelo\s+((?:19|20)\d{2})/i)
    || t.match(/\b((?:19[5-9]|20[0-4])\d)\s*\/\s*((?:19[5-9]|20[0-4])\d)\b/)
    || String(nome).match(/\b((?:19[5-9]|20[0-4])\d)\s*\/\s*((?:19[5-9]|20[0-4])\d)\b/);
  // Um ano só ("Renault Megane GT Dyn 16 - 2013", "ano 2006"): é o ano-MODELO; fabricação fica sem — não inventa.
  const anoUnico = anos ? null : (t.match(/\bano\s*:?\s*((?:19[5-9]|20[0-4])\d)\b/i) || String(nome).match(/(?:-\s*|\s)((?:19[5-9]|20[0-4])\d)\s*\.?\s*$/))?.[1];
  const placa = (t.match(/\bplacas?\s*:?\s*([A-Z]{3}-?\d[A-Z0-9]\d{2})\b/i) || [])[1];
  const chassi = (t.match(/\bchassi\s*:?\s*(?:n[º°.o]?\s*)?([A-HJ-NPR-Z0-9]{17})\b/i) || [])[1];
  const renavam = (t.match(/\brenavam\s*:?\s*(?:n[º°.o]?\s*)?(\d{9,11})\b/i) || [])[1];
  const cor = (t.match(/\bcor\s*:?\s*(preta|branca|prata|cinza|vermelha|azul|verde|amarela|bege|marrom|dourada|laranja|vinho|grafite|roxa|rosa)\b/i) || [])[1];
  const comb = /\bflex\b|[áa]lcool\s+e\s+gasolina|gasolina\s*\/\s*[áa]lcool/i.test(t) ? 'flex'
    : /\bdiesel\b/i.test(t) ? 'diesel' : /\bh[íi]brido\b/i.test(t) ? 'híbrido' : /\bel[ée]trico\b/i.test(t) ? 'elétrico' : /\bgasolina\b/i.test(t) ? 'gasolina' : null;
  // "Local para vistoria: rua …, em Balneário Piçarras (SC)." · "Vistoria: Rua …, Lages – SC."
  // Termina no FIM DA FRASE (ponto + maiúscula), não no 1º ponto: "n.º 1274" tem ponto.
  const vistoria = (t.match(/(?:local\s+(?:para|de)\s+)?vistoria\s*:\s*([\s\S]{8,180}?)(?=\.\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ]|\.?\s*$)/i) || [])[1]?.trim() || null;
  return {
    marca: marca ? marcaCanon(marca) : null,
    // "207 PASSION XR 2010/2011." — o ano vazava para o modelo (dry-run 05/10, Saulo Júlio).
    modelo: modelo ? modelo.replace(/\s+/g, ' ').trim().replace(/[,.;]+$/, '')
      .replace(/[\s,-]*\b(?:19|20)\d{2}(?:\s*\/\s*(?:19|20)\d{2})?\s*\.?$/, '').replace(/[,.;-]+$/, '').trim().slice(0, 80) || null : null,
    ano_fabricacao: anos ? Number(anos[1]) : null, ano_modelo: anos ? Number(anos[2]) : (anoUnico ? Number(anoUnico) : null),
    placa: placa ? placa.replace('-', '').toUpperCase() : null, chassi: chassi ? chassi.toUpperCase() : null, renavam: renavam || null,
    cor: cor ? cor.toLowerCase() : null, combustivel: comb, vistoria,
  };
}

/** Linha de veiculos_leilao a partir da listagem + detalhe (`lerDetalhe` do scraper) ou null. */
export function montarRowVeiculoAstavero(item, det, tenant, { marcaModeloAno, tipoVeiculo }) {
  const lote = det?.lote || {};
  const leilao = det?.leilao || {};
  const v = lote.v || {};
  const d = lote.d || {};
  const nome = String(lote.nome || item.nome || '').replace(/^Lote\s+[\w.]+\s*-\s*/i, '').replace(/^\d+\.\s+/, '').replace(/\s+/g, ' ').trim();
  const descricao = texto(lote.detalhada).slice(0, 8000) || nome;
  const daDesc = veiculoDaDescricao(descricao, nome);
  const doNome = marcaModeloAno(nome);
  const daLista = localDaListagem(item.local);
  const reaisV = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 100 ? Math.round(n * 100) / 100 : 0; };
  const primeira = reaisV(v.primeira), segunda = reaisV(v.segunda);
  const avaliacao = Math.max(reaisV(v.avaliacao), reaisV(item.avaliacao), primeira);
  const minimo = item.praca === 2 && segunda ? segunda : (primeira || reaisV(item.valor));
  const datas = leilao.datas || {};
  const anexos = (Array.isArray(leilao.anexos) ? leilao.anexos : []).concat(Array.isArray(lote.anexos) ? lote.anexos : [])
    .filter((a) => a && !a.private && /^https?:\/\//.test(a.url || '') && !/\.(jpe?g|png|webp|gif)(\?|$)/i.test(a.url))
    .map((a) => ({ tipo: /edital/i.test(a.arquivo || a.url) ? 'edital' : 'outro', nome: /edital/i.test(a.arquivo || a.url) ? 'Edital' : 'Documento', url: a.url }));
  const fotos = [item.image].concat((Array.isArray(lote.anexos) ? lote.anexos : []).filter((a) => a && !a.private && /\.(jpe?g|png|webp)(\?|$)/i.test(a.url || '')).map((a) => a.url))
    .filter((u, i, arr) => u && /^https?:\/\//.test(u) && arr.indexOf(u) === i);
  const patio = classificarPatio(descricao);
  const sucata = lote.sucata === true || /\bsucata\b/i.test(`${nome} ${descricao.slice(0, 400)}`);
  return {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${item.id}`,
    leiloeiro: tenant.leiloeiro, titulo: nome.slice(0, 180) || `Veículo ${tenant.leiloeiro}`, descricao,
    marca: daDesc.marca || doNome.marca, modelo: daDesc.modelo || doNome.modelo,
    ano_fabricacao: daDesc.ano_fabricacao || doNome.ano_fabricacao, ano_modelo: daDesc.ano_modelo || doNome.ano_modelo,
    placa: daDesc.placa, chassi: daDesc.chassi, renavam: daDesc.renavam, cor: daDesc.cor, combustivel: daDesc.combustivel,
    tipo_veiculo: tipoVeiculo(`${nome} ${descricao.slice(0, 200)}`),
    valor_avaliacao: avaliacao || null, valor_minimo: minimo || null,
    desconto_percentual: avaliacao > 0 && minimo > 0 ? Math.max(0, Math.round((1 - minimo / avaliacao) * 100)) : null,
    cidade: String(d.cidade || '').trim() || daLista.cidade, estado: /^[A-Z]{2}$/.test(String(d.uf || '')) ? d.uf : daLista.estado,
    link_lote: item.url || `${tenant.base}/pregao/${item.leilao}/${item.id}`,
    fotos: fotos.length ? fotos : null,
    data_leilao: item.praca === 2 ? (datas.d2 || lote.datas?.leilao || item.data || null) : (datas.d1 || lote.datas?.leilao || item.data || null),
    modalidade: lote.p?.processo || item.vara ? 'judicial' : 'extrajudicial', forma_pagamento: 'a_vista',
    is_sucata: sucata, anexos: anexos.length ? anexos : null,
    // `raw.lot_location_address` é onde a tela do veículo lê o endereço do pátio (src/utils/patioVeiculo.js).
    raw: { plataforma: 'astavero', processo: lote.p?.processo || null, vara: lote.p?.vara || item.vara || null, praca: item.praca ?? null,
      segunda_praca: segunda || null, lot_location_address: daDesc.vistoria },
    // Pátio pelo classificador ÚNICO (lib/patio-veiculo.mjs). Local de vistoria sem sinal de devedor =
    // 'nao_confirmado' (aparece com selo, opção 2 do dono, 05/10); 'excluido' nem chega a ser gravado (scraper).
    status_patio: patio.status,
    status_patio_motivo: patio.motivo,
    ativo: true, atualizado_em: new Date().toISOString(),
  };
}
