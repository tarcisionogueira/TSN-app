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
 *
 * SEGUNDO TEMPLATE (25/10, pendência 356): a mesma plataforma tem um tema Bootstrap "responsivo"
 * (o mesmo da página de leilão do /externo/ do Sanches) — sem `l-cabecalho-*`. Nele:
 *   • cabeçalho do leilão: <h6 class="text-center mb-3"><strong>NOME</strong>, `<b>1º Leilão</b><p>data`
 *     (ou `<b>Data</b>` repetido por praça) e `<b>LOCAL:</b> CIDADE-UF` — o LOCAL é do LEILÃO, não do lote
 *     (Nasar: 28 imóveis da Porto Seguro em 9 cidades com LOCAL "SÃO PAULO-SP"); a cidade do LOTE vem no slug
 *     da URL ("…-em-sao-caetano-do-sul"), que a plataforma gera do campo cidade do bem;
 *   • valores em `<p class="mb-0 destaque"><b>RÓTULO: </b>R$ X</p>` — "Avaliação", "Lance Mínimo",
 *     "Lance Inicial", "1º Leilão"/"2º Leilão", "Valor de Venda", "Lance mínimo (avaliação)" e até
 *     rótulo VAZIO (Rodrigo: "<b>: </b>R$ 193.000,00" duas vezes);
 *   • status do LOTE no badge `p-2 float-lg-right`; categoria em <h5 class="mb-4">.
 * Tenants que rodam na RAIZ (sem /externo/): Lucas Ignacio e Moacira (`/leilao/<id>`, `/lote/<id>`).
 * Leilão/lote de TESTE da plataforma ("LEILÃO TESTE", "SIMULADOR DE LEILÃO", "SIMULE SEUS LANCES AQUI",
 * "lote-teste-normal") fica fora já na enumeração e, de novo, no detalhe.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { normCidade } from './inferir-uf.mjs';
import MUNICIPIOS from '../../api/_municipios.js';

// `catalogo`: tenant na raiz do domínio usa '/'; o padrão do motor é '/externo/'.
export const TENANTS = {
  uberlandia: { fonte: 'UBERLANDIALEILOES', leiloeiro: 'Uberlândia Leilões (Rodrigo de Oliveira Lopes)', base: 'https://www.leiloesuberlandia.com.br' },
  // 2º template (25/10, #356). Nomes e matrículas: leiloeiro_junta.
  nasar: { fonte: 'NASARLEILOES', leiloeiro: 'Ives Harrison Nasar dos Santos (JUCEC 30)', base: 'https://nasarleiloes.com.br' },
  rodrigo: { fonte: 'RODRIGOLEILOES', leiloeiro: 'Rodrigo Octávio Bouças Ignacio (JUCIS-DF 186)', base: 'https://rodrigoleiloes.com.br' },
  marquesbarreto: { fonte: 'MARQUESBARRETO', leiloeiro: 'Luciene Marques de Sousa Barreto (JUCIS-DF 95)', base: 'https://marquesbarretoleiloes.com.br' },
  lucasignacio: { fonte: 'LUCASIGNACIO', leiloeiro: 'Lucas Henrique Ignacio de Souza (JUCIS-DF 99)', base: 'https://lucasignacioleiloes.com.br', catalogo: '/' },
  moacira: { fonte: 'MOACIRA', leiloeiro: 'Moacira Tegoni Goedert (JUCIS-DF 63)', base: 'https://www.moacira.lel.br', catalogo: '/' },
  // 1º template, mas com o endereço no LOCAL ("Rua Guapore nº 64, Bairro …, PONTA PORA-MS") e as praças
  // como "Início/Encerramento 1º Leilão".
  ipc: { fonte: 'IPCLEILOES', leiloeiro: 'IPC Leilões (Cibele Rigolin Pereira de Figueiredo, JUCEMS 038)', base: 'https://ipcleiloes.com.br' },
  // 26/10 (3ª leva das Juntas, triagem `junta_2410`). Home → leilões → lotes lidos pelo banco e passados no motor em seco.
  dux: { fonte: 'DUXLEILOES', leiloeiro: 'Dux Leilões', base: 'https://duxleiloes.com.br', catalogo: '/' },
  flaviocosta: { fonte: 'FLAVIOCOSTA', leiloeiro: 'Flávio Costa Leilões', base: 'https://flaviocostaleiloes.com.br', catalogo: '/' },
  jussiara: { fonte: 'JUSSIARALEIL', leiloeiro: 'Jussiara Leilões', base: 'https://jussiaraleiloes.com', catalogo: '/' },
  mrl4: { fonte: 'MRL4LEILOES', leiloeiro: 'MRL4 Leilões', base: 'https://mrl4leiloes.com.br', catalogo: '/' },
  // 26/10 (regra do dono: leiloeiro ATIVO em família que já lemos fica ligado mesmo sem lote hoje). Prova pelo banco
  // (pg_net, grátis): o catálogo do motor responde 200 com o rodapé/links da Plataforma Leiloar (/externo/area/…,
  // /externo/leiloes-passados) e NENHUM link /leilao/<id> — a home vazia da plataforma. Adring lista só o lote 380
  // "leilao-simulacao-treinamento", que `ehTeste` já descarta. Fonte que nunca teve lote não entra em
  // fonte_baseline_aprendida, então não há alarme de `zerou`/`regressao` para ela.
  adring: { fonte: 'ADRINGLEIL', leiloeiro: 'ADring Leilões (Adriano Carlos Oliveira Silva)', base: 'https://adringleiloes.com.br' }, // 0 (DF)
  almoeda: { fonte: 'ALMOEDALEIL', leiloeiro: 'Almoeda Leilões (Ioneide Maria Fernandes Sampaio)', base: 'https://almoedaleiloes.com.br' }, // 0 (DF)
  hatory: { fonte: 'HATORYLEIL', leiloeiro: 'Hatory Leilões (Clauberto Fernandes Nascimento Júnior)', base: 'https://hatoryleiloes.com.br' }, // 0 (BA)
  ml: { fonte: 'MLLEILOES', leiloeiro: 'ML Leilões (Silvio Luiz Silva de Moura Leite)', base: 'https://mlleiloes.com.br' }, // 0 (MT)
  up: { fonte: 'UPLEILOES', leiloeiro: 'Up Leilões (Eucélia Madalena de Souza)', base: 'https://upleiloes.com.br' }, // 0 (DF)
  // Curiau e Tenório: hoje só leilão de veículo (UNIFAP; DETRAN "em elaboração", na raiz) — 0 imóvel, o motor descarta o
  // que não é imóvel. Ligados pelo próximo leilão de imóvel.
  curiau: { fonte: 'CURIAULEIL', leiloeiro: 'Curiaú Leilões (José Carlos Zingra)', base: 'https://curiauleiloes.com.br' }, // 0 imóvel (AP)
  // JUCESP/JUCEMG (triagem pelo banco de 26/10, `tri2610`). Adri e Bolsa na RAIZ (/externo/ dá 404; home lista
  // /leilao/<id>); Federal e OA em /externo/. Leilões e lotes lidos pelo banco e passados no motor em seco.
  adri: { fonte: 'ADRILEIL', leiloeiro: 'Adri Leilões (Laiza Machado de Oliveira Adri)', base: 'https://www.adrileiloes.com.br', catalogo: '/' }, // 1 leilão (MG)
  bolsa: { fonte: 'BOLSADELEIL', leiloeiro: 'Bolsa de Leilões', base: 'https://www.bolsadeleiloes.com.br', catalogo: '/' }, // 3 leilões
  federal: { fonte: 'FEDERALLEIL', leiloeiro: 'Federal Leilões', base: 'https://www.leiloesfederal.com.br' }, // 1 leilão, 7 lotes
  oa: { fonte: 'OALEILOES', leiloeiro: 'OA Leilões', base: 'https://www.oaleiloes.com.br' }, // 8 leilões
  tenorio: { fonte: 'TENORIOLEIL', leiloeiro: 'Tenório Leilões (Luis Guilherme Tenório)', base: 'https://tenorioleiloes.com.br', catalogo: '/' }, // 0 imóvel (MS)
  // FORA (26/10): prosperarleiloes (GO) — a home lista 8 leilões de imóvel, mas a página /externo/leilao/<id> deste tenant
  // não tem NENHUM link /lote/ (só o auditório ao vivo); o motor enumera só os 5 lotes em destaque na home (3 prontos no
  // seco): 5 de ≥ 8, abaixo dos 90% de cobertura — pede recon de onde o lote mora; brasilialeiloes (só o "leilao-teste" 558 — site de teste/simulação); fkleiloes e salgueiroleiloes
  // (/externo/ 404 e a raiz é uma casca vazia, só o rodapé "Copyright Plataforma Leiloar" — não há catálogo que prove
  // onde o leilão apareceria).
};

// Leilão/lote de TESTE da plataforma (brasilialeiloes, rodrigo, IPC, marquesbarreto, lucasignacio — 24/10) e de
// TREINAMENTO (Moacira, leilão 593: "Bem #1 (apenas para fins de treinamento)", 11 lotes com lance fictício).
export const ehTeste = (s) => /\bteste\b|simulador|simule\b|treinamento|apenas para fins|\bbem \d+ apenas para\b/i.test(String(s || '').replace(/[-_]+/g, ' '));

const limpar = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Nível 1: leilões na home. Nível 2: lotes no leilão. Chave = id numérico. Prefixo `/externo` opcional
// (Lucas Ignacio e Moacira rodam na raiz) e href absoluto aceito (Moacira linka "https://www.moacira.lel.br/lote/…").
// Slug de teste ("leilao-teste", "simulador-de-leilao", "simule-seus-lances-aqui", "lote-teste-normal") fica fora.
const RE_EVENTO = /href=["']((?:https?:\/\/[^/"']+)?(\/externo)?\/leilao\/(\d+)(?:\/([a-z0-9-]*))?)["']/gi;
const RE_LOTE = /href=["']((?:https?:\/\/[^/"']+)?(?:\/externo)?\/lote\/(\d+)(\/[a-z0-9-]+)?)["']/gi;
export function extrairUrlsDeEvento(html, base) {
  const urls = new Map();
  const teste = new Set();
  for (const m of String(html || '').matchAll(RE_EVENTO)) {
    if (ehTeste(m[4])) { teste.add(m[3]); continue; }
    if (!urls.has(m[3])) urls.set(m[3], new URL(`${m[2] || ''}/leilao/${m[3]}`, base).href);
  }
  for (const id of teste) urls.delete(id);
  return urls;
}
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  const teste = new Set();
  for (const m of String(html || '').matchAll(RE_LOTE)) {
    if (ehTeste(m[3])) { teste.add(m[2]); continue; }
    // Prefere a URL com slug (a que o site linka no card; o slug carrega a cidade do bem); sem slug também abre.
    let u; try { u = new URL(m[1], base); } catch { continue; } // href inválido: ignora
    if (u.host.replace(/^www\./, '') !== new URL(base).host.replace(/^www\./, '')) continue;
    u = new URL(u.pathname, base).href; // mesmo host do tenant (moacira.lel.br × www.moacira.lel.br)
    const anterior = urls.get(m[2]);
    // Slug com "-em-<cidade>" ganha do slug com o nome do leilão (Moacira: home "leilao-20a-vara-civel-de-brasilia",
    // leilão "imovel-localizado-em-qs-314-em-samambaia").
    if (!anterior || (m[3] && (!/-em-[a-z]/.test(anterior) || /-em-[a-z]/.test(m[3])))) urls.set(m[2], u);
  }
  for (const id of teste) urls.delete(id);
  return urls;
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

// "23/09/2026 às 14:00:00" → ISO com fuso de Brasília.
const dataHora = (s) => {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(20\d{2})(?:\s*(?:às|as)\s*(\d{2}):(\d{2}))?/i);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '12'}:${m[5] || '00'}:00-03:00` : null;
};

// Cidade com acento: o cabeçalho traz "UBERLANDIA-MG" (sem acento); a descrição costuma trazer
// "Uberlândia". Usa a grafia da descrição quando ela normaliza para a mesma cidade.
export function cidadeComAcento(cidadeCaps, descricao) {
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
  [/sala comercial|conjunto comercial|\bsalas?\b/i, 'Sala Comercial'], [/galp[ãa]o|barrac[ãa]o/i, 'Galpão'], [/\blojas?\b/i, 'Loja'],
  // 25/10 (Nasar/Porto Seguro): "Imóvel monousuário comercial", "Prédio comercial".
  [/pr[ée]dio/i, 'Prédio'], [/im[óo]vel\s+(?:monousu[áa]rio\s+)?comercial/i, 'Imóvel Comercial'],
  [/ch[áa]cara/i, 'Chácara'], [/fazenda|im[óo]vel rural|lote rural|gleba/i, 'Imóvel Rural'],
  // "Imóvel descrito como Vaga de Garagem n° 3, Lote n° 2" (Marques Barreto) — o título tem de dizer vaga para o
  // portão ehVagaGaragem (scraper-core) descartar; antes saía "Terreno" pelo "Lote n°".
  [/\bvagas?\s+(?:de\s+)?garagem|\bbox\s+(?:de\s+)?garagem/i, 'Vaga de Garagem'],
  // "Área do Terreno: 213,46m2" é medida, não tipo (Nasar: conjunto comercial saía "Terreno").
  [/(?<![áa]rea\s+d[eo]\s+)terreno|\blote n/i, 'Terreno']];

// ── CIDADE DO LOTE — só com prova do IBGE ───────────────────────────────────────────────────────
const UFS_DA_CIDADE = new Map(); // "campinas" → Set(['SP'])
for (const k of Object.keys(MUNICIPIOS)) {
  const [uf, c] = k.split('|');
  if (!UFS_DA_CIDADE.has(c)) UFS_DA_CIDADE.set(c, new Set());
  UFS_DA_CIDADE.get(c).add(uf);
}
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// "Rua Guapore nº 64, Bairro Manoel Padial Urel, PONTA PORA-MS" (IPC) → ["PONTA PORA", "MS"]: o LOCAL pode trazer o
// endereço inteiro antes da cidade; ela é o último pedaço depois da vírgula.
export function cidadeUfDoLocal(local) {
  const m = String(local || '').split(',').pop().trim().match(/^(.+?)\s*-\s*([A-Z]{2})$/);
  return m ? { cidade: m[1].trim(), uf: m[2] } : { cidade: null, uf: null };
}

// Cidade do lote: 1º o slug da URL ("…-em-sao-caetano-do-sul", gerado do campo cidade do BEM), com a UF do LOCAL
// quando a cidade existe nela; senão a UF escrita junto da cidade no texto ("Campinas/SP", "Ponta Porã (MS)"); senão
// a única UF do IBGE que tem a cidade. 2º o LOCAL do leilão, se existir no IBGE. Nada disso = sem cidade (nunca o
// LOCAL de outro lote do mesmo leilão, nem o endereço inteiro como cidade).
// O IBGE do DF é um município só (Brasília) e o texto quase nunca escreve "Brasília" com acento ("Samambaia, Distrito Federal").
const comAcento = (cidade, uf, texto) => (uf === 'DF' && normCidade(cidade) === 'brasilia' ? 'Brasília' : cidadeComAcento(String(cidade).toUpperCase(), texto));
export function cidadeDoLote({ url, local, texto }) {
  const l = cidadeUfDoLocal(local);
  const slug = (String(url || '').match(/\/lote\/\d+\/([a-z0-9-]+)/) || [])[1] || '';
  const ms = slug.match(/-em-([a-z0-9-]+)$/);
  if (ms) {
    const cand = ms[1].replace(/-/g, ' ');
    const ufs = UFS_DA_CIDADE.get(normCidade(cand)) || new Set();
    let uf = l.uf && ufs.has(l.uf) ? l.uf : null;
    if (!uf) {
      const t = semAcento(texto);
      uf = [...ufs].find((u) => new RegExp(`\\b${cand}\\s*(?:/|-|–|\\(|,)\\s*${u.toLowerCase()}\\b`).test(t)) || null;
    }
    if (!uf && ufs.size === 1) uf = [...ufs][0];
    if (uf) return { cidade: comAcento(cand, uf, texto), estado: uf };
  }
  if (l.cidade && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${l.uf}|${normCidade(l.cidade)}`)) {
    return { cidade: comAcento(l.cidade, l.uf, texto), estado: l.uf };
  }
  // DF: o IBGE tem um município só; região administrativa ("SAMAMBAIA-DF", "…-em-samambaia") é Brasília.
  if (l.uf === 'DF') return { cidade: 'Brasília', estado: 'DF' };
  return { cidade: null, estado: l.uf || null };
}

export const tipoDoTexto = (descricao) => TIPOS.map(([re, nome]) => ({ nome, pos: descricao.search(re) })).filter((t) => t.pos >= 0)
  .sort((a, b) => a.pos - b.pos)[0]?.nome
  // Sem tipo reconhecido: "Imóvel" só se a descrição DIZ imóvel. Até 08/10 o padrão era 'Imóvel'
  // para tudo, e esse rótulo inventado no título fazia o `naoEhImovel` do motor deixar passar
  // carro, moto, sofá e aparador (12 de 19 ativos da UBERLANDIALEILOES eram bens móveis
  // anunciados como "Imóvel - Machado/MG"). Com "Bem", o filtro do motor decide pelo texto real.
  || (/im[óo]ve(?:l|is)/i.test(descricao) ? 'Imóvel' : 'Bem');

// "A fração correspondente à 50% (cinquenta por cento), de uma gleba…" (IPC 1270/1271): o portão ehFracaoIdeal só
// reconhece "fração/parte ideal" — a fatia declarada no começo da descrição vira "Fração ideal" no título.
const RE_FATIA = /^\W*(?:matr[íi]cula[^:]{0,20}:\s*)?(?:a\s+)?(?:fra[çc][ãa]o|parte)\s+(?:ideal\s+)?(?:correspondente\s+)?(?:[àa]\s+|de\s+)?\d{1,2}(?:[.,]\d+)?\s*%/i;
export function tituloDe(descricao, cidade, estado) {
  if (RE_FATIA.test(descricao)) return `Fração ideal - ${tipoDoTexto(descricao)}${cidade ? ` - ${cidade}/${estado}` : ''}`;
  // Tipo = a palavra-chave que aparece PRIMEIRO na descrição ("Um terreno situado… Residencial
  // Lago Azul" é terreno — o nome do loteamento não pode virar "Casa"; dry-run 28/09).
  const tipo = tipoDoTexto(descricao);
  const bairro = (descricao.match(/\bbairro\s+([A-ZÀ-Ý][\wÀ-ÿ' ]{2,40}?)(?=[,.;]| na | no | à )/i) || [])[1];
  return `${tipo}${bairro ? ` - ${titleCase(bairro.trim().toLowerCase())}` : ''}${cidade ? ` - ${cidade}/${estado}` : ''}`;
}
export const matriculaDe = (t) => ((t.match(/matr[íi]cula(?:d[oa]\s+sob\s+o)?(?:\s+imobili[áa]ria)?(?:\s+de)?\s*(?:n\.?\s*[º°o]?\.?\s*)?(\d[\d.]{2,})/i) || [])[1] || numeroMatriculaDoTexto(t) || '')
  .replace(/\.+$/, '') || null;
// Data de praça plausível: a "venda direta" da plataforma vem com 01/01/2045 (e "30/11/-0001" no relógio).
const dataPlausivel = (iso) => (iso && Number(iso.slice(0, 4)) <= new Date().getFullYear() + 3 ? iso : null);

// ── 1º TEMPLATE (l-cabecalho-*) ──────────────────────────────────────────────────────────────────
function parseClassico(h, url) {
  const nomeLeilao = limpar((h.match(/class="l-cabecalho-nome">([\s\S]*?)<\/span>/i) || [])[1]);
  const local = limpar((h.match(/class="l-cabecalho-infos-local">([\s\S]*?)<\/span>/i) || [])[1]).replace(/^[\s,]+/, '');
  const curta = limpar((h.match(/<div id="l-lote-descricao">[\s\S]*?<p>([\s\S]*?)<\/p>/i) || [])[1]);
  const completa = limpar((h.match(/<div id="l-lote-descricao-completa">[\s\S]*?<p>([\s\S]*?)<\/p>/i) || [])[1]);
  const descricao = completa.length > curta.length ? completa : curta;
  const textoMeio = limpar((h.match(/<div class="l-cabecalho-texto-meio">([\s\S]*?)<\/div>/i) || [])[1]);
  const { cidade, estado } = cidadeDoLote({ url, local, texto: `${descricao} ${textoMeio}` });

  // Datas: "1ª HASTA: …", "ATÉ: …", "2ª HASTA : …", "ATÉ: …" (ou "1°hasta"/"até"). O fim de cada
  // hasta ("ATÉ") é o prazo real de lance — é ele que vira data_leilao / data_leilao_2.
  // IPC (25/10): "Início 1º Leilão: …" / "Encerramento 1º Leilão: …".
  const itens = [...(h.match(/<ul class="l-cabecalho-datas">([\s\S]*?)<\/ul>/i)?.[1] ?? '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => limpar(m[1]));
  const fins = itens.filter((t) => /^(?:at[ée]|encerramento)[^:]{0,30}:/i.test(t)).map(dataHora).map(dataPlausivel).filter(Boolean);
  const inicios = itens.filter((t) => /hasta|^in[íi]cio/i.test(t)).map(dataHora).map(dataPlausivel).filter(Boolean);

  const valores = h.match(/<ul id="l-cabecalho-infos-valores"[^>]*>([\s\S]*?)<\/ul>/i)?.[1] ?? '';
  const rotulado = (rot) => plaus(num((valores.match(new RegExp(`${rot}[^<]*<\\/span>\\s*<strong>\\s*R\\$\\s*([\\d.]+,\\d{2})`, 'i')) || [])[1]));
  const avaliacao = rotulado('Avalia[çc][ãa]o');
  const minimo = rotulado('Lance M[íi]nimo');
  // IPC: só a avaliação no quadro; o mínimo da 2ª praça vem no texto do leilão ("Para o 2º Leilão: ofertas a partir de
  // R$ 132.000,00 (60% do valor da avaliação)").
  const minimo2 = plaus(num((textoMeio.match(/2[ºªo°]\s*(?:leil[ãa]o|pra[çc]a)[^$\d]{0,60}R\$\s*([\d.]+,\d{2})/i) || [])[1]));

  const foto = (h.match(/<div id="l-lote-galeria">[\s\S]*?<img src="([^"]+)"/i) || [])[1] || null;
  const fotoAbs = foto && !/default\.(jpe?g|png)/i.test(foto) ? new URL(foto.replace('/externo/../', '/'), url).href : null;
  const pdf = (h.match(/href="([^"]+\.pdf)"[^>]*class="l-itm-imprimir"/i) || h.match(/class="l-itm-imprimir"[^>]*href="([^"]+\.pdf)"/i) || [])[1];
  const edital = pdf ? new URL(pdf.replace(/\/externo\/bens\/\.\.\/\.\.\//, '/'), url).href : null;
  const status = limpar((h.match(/<span id="l-status"[^>]*>([\s\S]*?)<\/span>/i) || [])[1]).toUpperCase();

  return {
    nomeLeilao, status,
    titulo: tituloDe(curta || descricao, cidade, estado), cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo || avaliacao,
    valor_minimo_2: minimo2 && minimo2 !== (minimo || avaliacao) ? minimo2 : null,
    modalidade: /extrajudicial/i.test(nomeLeilao) ? 'extrajudicial' : 'judicial',
    area_m2: extrairAreaM2(descricao) || 0,
    descricao: descricao ? `${nomeLeilao ? `${nomeLeilao}. ` : ''}${descricao}`.slice(0, 8000) : null,
    data_leilao: fins[0] || inicios[0] || null,
    data_leilao_2: fins[1] || null,
    link_foto: fotoAbs, link_edital: edital || url,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital do leilão', url: edital }] : [],
    numero_matricula: matriculaDe(descricao),
  };
}

// ── 2º TEMPLATE (Bootstrap "responsivo") ──────────────────────────────────────────────────────────
const CATEGORIA_NAO_IMOVEL = /ve[íi]cul|moto|autom[óo]v|caminh|[ôo]nibus|m[áa]quin|equipament|eletr[ôo]|m[óo]veis|sucata|semovent|animai|j[óo]ias|recicl/i;
function parseResponsivo(h, url) {
  const origem = new URL(url).origin;
  const nomeLeilao = limpar((h.match(/<h6 class="text-center mb-3">\s*<strong>([\s\S]*?)<\/strong>/i) || [])[1]);
  const local = limpar((h.match(/<b>\s*LOCAL:\s*<\/b>([^<]*)/i) || [])[1]);
  const categoria = limpar((h.match(/<h5 class="mb-4">([^<]*)<\/h5>/i) || [])[1]);
  const status = limpar((h.match(/class="badge badge-\w+ p-2 float-lg-right"[^>]*>([^<]*)</i) || [])[1]).toUpperCase();
  const curta = limpar((h.match(/Descri[çc][ãa]o do bem:\s*<\/h6>\s*<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1]);
  const completa = limpar((h.match(/DESCRI[ÇC][ÃA]O COMPLETA\s*<\/h6>([\s\S]*?)(?=<div class="col-4|<h6[^>]*>\s*MANIFESTOS|<footer)/i) || [])[1]);
  const descricao = completa.length > curta.length ? completa : curta;
  const { cidade, estado } = cidadeDoLote({ url, local, texto: `${curta} ${completa}` });

  // Praças do cabeçalho: "<b>1º Leilão</b><p> 10/11/2026 às 10:00:00" ou "<b>Data</b><p> …" (uma por praça).
  // `<b class="me-1">1ª Hasta</b>` (26/10, Dux): rótulo com atributo e "Hasta" no lugar de "Leilão".
  const pracas = [...h.matchAll(/<b(?:\s[^>]*)?>\s*([^<]{0,30}?)\s*<\/b>\s*<p>\s*(\d{2}\/\d{2}\/\d{4}\s*(?:[àa]s)?\s*\d{2}:\d{2})/gi)]
    .filter((m) => /leil|data|pra[çc]a|hasta/i.test(m[1])).map((m) => dataPlausivel(dataHora(m[2]))).filter(Boolean);
  // Sem praça no cabeçalho, o prazo do lote: "Este lote se encerrará no dia: <p>23/11/2026 <span>a partir 13:00:00" (MRL4).
  if (!pracas.length) {
    const fim = h.match(/se\s+encerrar[áa]\s+no\s+dia:?\s*<\/h6>\s*<p[^>]*>\s*(\d{2}\/\d{2}\/\d{4})(?:[\s\S]{0,120}?(\d{2}:\d{2}))?/i);
    const iso = fim && dataPlausivel(dataHora(`${fim[1]}${fim[2] ? ` às ${fim[2]}` : ''}`));
    if (iso) pracas.push(iso);
  }

  // Valores por rótulo. "Incremento" não é preço. Rótulo de praça ("1º Leilão") ou VAZIO (Rodrigo) = valores em
  // ordem de praça; na 1ª praça judicial o mínimo É a avaliação. "Valor de Venda" (venda direta) não é avaliação.
  // `<div class="bem-lance-valores"><div><strong>Avaliação: </strong>R$ …` (26/10, Dux) é a mesma ficha em outra marcação.
  const vals = [...h.matchAll(/<p class="mb-0 destaque">\s*<b>([^<]*)<\/b>\s*R\$\s*([\d.]+,\d{2})|<div>\s*<strong>([^<]*)<\/strong>\s*R\$\s*([\d.]+,\d{2})/gi)]
    .map((m) => (m[1] != null ? m : [m[0], m[3], m[4]]))
    .map((m) => ({ rot: limpar(m[1]).replace(/:\s*$/, '').trim(), v: plaus(num(m[2])) }))
    .filter((x) => x.v && !/incremento/i.test(x.rot));
  const mins = vals.filter((x) => !/^avalia/i.test(x.rot)).map((x) => x.v);
  const soPracas = vals.length && vals.every((x) => !x.rot || /leil[ãa]o|pra[çc]a/i.test(x.rot));
  const avaliacao = vals.find((x) => /^avalia|\(avalia/i.test(x.rot))?.v || (soPracas ? mins[0] : 0);
  const venda = /venda\s+direta/i.test(nomeLeilao) || vals.some((x) => /venda/i.test(x.rot));

  const foto = (h.match(/src="([^"]*bem_foto\/(?!thumb)[^"]+)"/i) || [])[1];
  const pdf = (h.match(/href="([^"]*arquivos_leilao\/[^"]+\.pdf)"/i) || [])[1];
  const edital = pdf ? `${origem}/arquivos/arquivos_leilao/${pdf.split('/').pop()}` : null;

  return {
    nomeLeilao, status,
    // Categoria do site OU ficha de veículo sem tipo de imóvel no texto: a Nasar publica moto ("Marca: HONDA … Placa …
    // Chassi …") na categoria "Imóveis Diversos".
    naoImovel: (!!categoria && CATEGORIA_NAO_IMOVEL.test(categoria) && !/im[óo]ve/i.test(categoria))
      // Sem NENHUM tipo de imóvel no texto do bem ("1 (uma) mesa de cabeceira", moto com placa e chassi) não é imóvel.
      || tipoDoTexto(curta || descricao) === 'Bem',
    titulo: tituloDe(curta || descricao, cidade, estado), cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: mins[0] || avaliacao,
    valor_minimo_2: mins[1] && mins[1] !== mins[0] ? mins[1] : null,
    modalidade: venda ? 'venda_direta' : /extrajudicial|fiduci|banco/i.test(nomeLeilao) ? 'extrajudicial' : 'judicial',
    area_m2: extrairAreaM2(descricao) || 0,
    descricao: descricao ? `${nomeLeilao ? `${nomeLeilao}. ` : ''}${descricao}`.slice(0, 8000) : null,
    data_leilao: venda ? null : pracas[0] || null,
    data_leilao_2: venda ? null : pracas[1] || null,
    link_foto: foto ? `${origem}/arquivos/bem_foto/${foto.split('/').pop()}` : null,
    link_edital: edital || url,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital / arquivo do leilão', url: edital }] : [],
    numero_matricula: matriculaDe(descricao),
  };
}

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  const classico = /class="l-cabecalho-nome"/.test(h);
  if (!classico && !/<b>\s*LOCAL:\s*<\/b>|class="mb-0 destaque"/i.test(h)) return null; // nenhum dos dois templates
  const { nomeLeilao, status, ...det } = classico ? parseClassico(h, url) : parseResponsivo(h, url);
  // Leilão/lote de teste da plataforma: nunca vira lote.
  if (ehTeste(nomeLeilao) || ehTeste((String(url).match(/\/lote\/\d+\/([a-z0-9-]+)/) || [])[1])) return { encerrado: true, teste: true };
  // Status do lote diferente de ABERTO (VENDIDO, ENCERRADO, SUSPENSO, RETIRADO, CANCELADO…) = fora.
  // "ENVIE SUA PROPOSTA" (26/10, Jussiara: 24 lotes do leilão de venda direta 851, prazo 31/12/2026) é bem recebendo
  // proposta — aberto; tratá-lo como status desconhecido descartava o leilão inteiro como encerrado.
  if (status && !/ABERTO|EM LOTEAMENTO|AGUARDANDO|EM BREVE|PROPOSTA/.test(status)) return { ...det, encerrado: true };
  // 1ª praça vencida e 2ª por vir: o lance de agora é o da 2ª.
  const t = (d) => (d ? Date.parse(d) : NaN);
  if (det.data_leilao_2 && t(det.data_leilao) < agora && t(det.data_leilao_2) >= agora) {
    Object.assign(det, { data_leilao: det.data_leilao_2, valor_minimo: det.valor_minimo_2 || det.valor_minimo, data_leilao_2: null, valor_minimo_2: null });
  }
  const ultima = t(det.data_leilao_2 || det.data_leilao);
  return { ...det, encerrado: Number.isFinite(ultima) && ultima < agora };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  valor_minimo_2: det.valor_minimo_2 || null,
});
export { checarQualidade };
