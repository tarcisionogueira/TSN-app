/**
 * FIPE de referência — casamento marca/modelo/ano contra a API pública gratuita
 * (fipe.parallelum.com.br, projeto deividfortuna/fipe: 500 req/dia sem token).
 * Compartilhado entre o cron em lote (scripts/enriquecer-fipe.mjs) e a busca sob
 * demanda ao abrir a tela do veículo (api/veiculo-fipe.js) — mesma régua nos dois,
 * mesma trava de custo nos dois (ver `fipe_uso`/`registrar_uso_fipe`, espelho do
 * `brightdata_uso`/`registrar_uso_brightdata` já usado pro Bright Data).
 *
 * Confirmado via recon ao vivo (20/09) antes de escrever o casamento: marca vem em
 * nome COMPOSTO ("GM - Chevrolet", "VW - VolksWagen"), modelo vem em descrição
 * COMPLETA da versão ("Gol (novo) 1.0 Mi Total Flex 8V 2p") — nosso `marca`/`modelo`
 * é texto livre e curto da fonte do leilão ("Chevrolet", "Gol"). Casamento nunca
 * "chuta": marca por igualdade normalizada (com fallback pro sufixo após " - ");
 * modelo pela PRIMEIRA PALAVRA normalizada IGUAL (não `includes` — "gol" é
 * substring de "golf", errou antes com esse idioma noutro parser deste repo).
 */
const BASE = 'https://fipe.parallelum.com.br/api/v2';
const CATEGORIAS = ['cars', 'motorcycles', 'trucks'];
const TIPO_PARA_CATEGORIA = { carro: 'cars', moto: 'motorcycles', motocicleta: 'motorcycles', caminhao: 'trucks' };

// 'sem_match' custa 1-3 chamadas de marca sem achar nada — não vale repetir todo dia; 'ok'/
// 'aproximado' a FIPE só muda 1x/mês, 25 dias é folga suficiente. Usado tanto pelo cron em
// lote quanto pela busca sob demanda, pra não terem critérios diferentes de "está velho".
// TETO DA COTA GRÁTIS (500/dia sem token, por dia UTC). Um contador só no banco
// (`fipe_uso`/`registrar_uso_fipe`) para os dois caminhos: o cron para em TETO_CRON e os 50
// restantes ficam para a busca sob demanda (o dono abrindo um veículo), que para em
// TETO_DIARIO — 50 abaixo dos 500, margem para relógio/contagem da API diferirem da nossa.
//
// 25/09 (dono: "alguns carros que entrei não carregaram a FIPE"): o cron rodava às 5h BRT e
// comia 400 das 450 logo cedo — o dono, abrindo veículo de dia, tinha só 50. O cron passou para
// o FIM do dia UTC (19h BRT; a cota vira às 21h BRT) e gasta só a sobra; de dia a busca sob
// demanda tem a cota inteira. COTA configurável: com token grátis do fipe.parallelum (header
// X-Subscription-Token) a cota do plano sobe — basta FIPE_TOKEN + FIPE_COTA_DIARIA no ambiente
// (Vercel e secret do GitHub), sem mexer em código. Sem as duas, fica o padrão sem token (500).
const COTA_DIARIA_FIPE = Math.max(50, Number(process.env.FIPE_COTA_DIARIA) || 500);
export const TETO_DIARIO_FIPE = COTA_DIARIA_FIPE - 50;
export const TETO_CRON_FIPE = COTA_DIARIA_FIPE - 80;
const FIPE_TOKEN = process.env.FIPE_TOKEN || '';

export const RETENTAR_SEM_MATCH_DIAS = 90;
export const RETENTAR_OK_DIAS = 25;

export function fipeEstaVelho(fipeStatus, fipeAtualizadoEm) {
  if (!fipeAtualizadoEm) return true;
  const dias = (Date.now() - new Date(fipeAtualizadoEm).getTime()) / 86400000;
  return fipeStatus === 'sem_match' ? dias >= RETENTAR_SEM_MATCH_DIAS : dias >= RETENTAR_OK_DIAS;
}

export const normalizar = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const primeiraPalavra = (s) => normalizar(s).split(' ')[0] || '';

export function parseValor(precoStr) {
  const n = String(precoStr || '').match(/([\d.]+,\d{2})/);
  if (!n) return null;
  const v = parseFloat(n[1].replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Marca FIPE: nome cru ("GM - Chevrolet") + sufixo após " - " ("Chevrolet") — ambos indexados
// normalizados, pra casar tanto "Chevrolet" quanto (se algum dia aparecer) "GM Chevrolet".
export function indexarMarcas(marcas) {
  const porChaveExata = new Map();
  for (const m of marcas) {
    const nome = m.name || m.nome || '';
    const codigo = m.code ?? m.codigo;
    const sufixo = nome.includes(' - ') ? nome.split(' - ').slice(1).join(' - ') : null;
    porChaveExata.set(normalizar(nome), codigo);
    if (sufixo) porChaveExata.set(normalizar(sufixo), codigo);
  }
  return porChaveExata;
}

export function acharMarca(nossaMarca, marcas, indice) {
  const chave = normalizar(nossaMarca);
  if (!chave || chave.length < 3) return null;
  if (indice.has(chave)) return indice.get(chave);
  // Fallback: nossa marca é PREFIXO do nome FIPE normalizado ("kia" -> "kia motors").
  // Exige candidato ÚNICO — prefixo ambíguo (bateria em 2+ marcas) não decide sozinho.
  const candidatos = marcas.filter(m => normalizar(m.name || m.nome || '').startsWith(chave));
  return candidatos.length === 1 ? (candidatos[0].code ?? candidatos[0].codigo) : null;
}

// Modelo: só a PRIMEIRA PALAVRA, comparada por IGUALDADE. Retorna todos os candidatos (pode
// ser mais de um: a FIPE lista cada motorização/câmbio como um "modelo" separado).
//
// Estreitamento (24/09): "CG" casa ~40 modelos da Honda e cada um custa 1 chamada de `/years`
// — era isso que queimava as 450/dia em ~45 veículos. Quando o nosso modelo tem mais palavras
// ("CG 160 FAN"), ficam só os candidatos com MAIS palavras em comum; empate mantém todos.
// Se a 1ª palavra não casa e é letra+número colados ("YBR150", "CG150"), tenta a parte em letras.
export function acharCandidatosModelo(nossoModelo, modelos) {
  let alvo = primeiraPalavra(nossoModelo);
  if (!alvo) return [];
  // 1ª palavra de 1 letra ("C-100 BIZ") não decide sozinha — vai direto ao fallback de versão
  let cands = alvo.length < 2 ? [] : modelos.filter(m => primeiraPalavra(m.name || m.nome || '') === alvo);
  let palavras = normalizar(nossoModelo).split(' ').slice(1, 4);
  const colado = alvo.match(/^([a-z]{2,})(\d{2,4})[a-z]?$/);
  if (!cands.length && colado) {
    alvo = colado[1];
    palavras = [colado[2], ...palavras];
    cands = modelos.filter(m => primeiraPalavra(m.name || m.nome || '') === alvo);
  }
  // Nome de VERSÃO no lugar do modelo ("HONDA FAN 125" = "CG 125 Fan", "C-100 BIZ" = "Biz 100",
  // "FACTOR YBR 125" = "YBR 125 Factor"): 1ª palavra com 3+ letras do nosso modelo, procurada
  // em QUALQUER posição do nome FIPE. Visto no 1º run de 24/09 (23 sem_match, quase todos assim).
  if (!cands.length) {
    const todas = normalizar(nossoModelo).split(' ');
    const chave = todas.find(w => /^[a-z]{3,}$/.test(w));
    if (chave) {
      cands = modelos.filter(m => normalizar(m.name || m.nome || '').split(' ').includes(chave));
      palavras = todas.filter(w => w !== chave).slice(0, 3);
    }
  }
  if (cands.length < 2 || !palavras.length) return cands;
  const pontos = (m) => { const ws = new Set(normalizar(m.name || m.nome || '').split(' ')); return palavras.filter(p => ws.has(p)).length; };
  const melhor = Math.max(...cands.map(pontos));
  return melhor > 0 ? cands.filter(m => pontos(m) === melhor) : cands;
}

// ─── MARCA/MODELO PELO TÍTULO (24/09) ─────────────────────────────────────────────────────
// 93% do acervo ativo vinha sem `modelo` (SUPERBID 6.688, LJUD 1.248) e o cron exigia
// marca+modelo+ano — ou seja, só ~530 veículos podiam ter FIPE, nunca os outros 7 mil. O
// título quase sempre tem os dois: "HONDA CG 160 FAN 2021 2022", "VW/GOL CLI – 96/96 – Franca",
// "Marca: FORD / Modelo: KA SE", "BIZ 125 ES - HONDA, 2007/2008". Só entra marca de uma lista
// fechada (nada de "primeira palavra do título"), e a saída é só EM MEMÓRIA — não grava
// `marca`/`modelo`, porque dado inferido não pode se passar por dado da fonte.
const MARCA_ALIAS = {
  vw: 'volkswagen', volks: 'volkswagen', volkswagen: 'volkswagen', gm: 'chevrolet', gmc: 'chevrolet',
  chevrolet: 'chevrolet', chev: 'chevrolet', fiat: 'fiat', ford: 'ford', renault: 'renault',
  hyundai: 'hyundai', toyota: 'toyota', honda: 'honda', yamaha: 'yamaha', nissan: 'nissan',
  peugeot: 'peugeot', citroen: 'citroen', jeep: 'jeep', kia: 'kia', mitsubishi: 'mitsubishi',
  mmc: 'mitsubishi', suzuki: 'suzuki', mercedes: 'mercedes-benz', audi: 'audi', bmw: 'bmw',
  volvo: 'volvo', scania: 'scania', iveco: 'iveco', chery: 'chery', caoa: 'caoa chery', jac: 'jac',
  lifan: 'lifan', byd: 'byd', dafra: 'dafra', shineray: 'shineray', kawasaki: 'kawasaki',
  harley: 'harley-davidson', triumph: 'triumph', ducati: 'ducati', haojue: 'haojue', bajaj: 'bajaj',
  renalt: 'renault', ktm: 'ktm', troller: 'troller', ssangyong: 'ssangyong', dodge: 'dodge', ram: 'ram',
  chrysler: 'chrysler', subaru: 'subaru', land: 'land rover', jta: 'suzuki', kasinski: 'kasinski',
  sundown: 'sundown', traxx: 'traxx', agrale: 'agrale', effa: 'effa', jaguar: 'jaguar', porsche: 'porsche',
};
// palavra que não é modelo (prefixo de categoria, condição, rótulo) — pulada ao procurar o modelo
const NAO_MODELO = new Set(['i', 'imp', 'importado', 'sucata', 'para', 'prensa', 'motocicleta', 'motoneta',
  'moto', 'automovel', 'veiculo', 'veiculos', 'lote', 'marca', 'modelo', 'benz', 'rover', 'davidson', 'em', 'leilao', 'de']);

export function marcaModeloDoTitulo(titulo, marcaConhecida = null) {
  const toks = normalizar(titulo).split(' ').filter(Boolean);
  const alvoMarca = marcaConhecida ? normalizar(marcaConhecida).split(' ')[0] : null;
  const ehModelo = (t) => t && !NAO_MODELO.has(t) && !MARCA_ALIAS[t] && !/^(19|20)\d{2}$/.test(t) && /[a-z0-9]/.test(t) && !/^\d{1,2}$/.test(t);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (!(MARCA_ALIAS[t] || (alvoMarca && t === alvoMarca))) continue;
    if (t === 'land' && toks[i + 1] !== 'rover') continue;
    const marca = marcaConhecida || MARCA_ALIAS[t];
    // modelo DEPOIS da marca (o comum) …
    const depois = [];
    for (let j = i + 1; j < toks.length && depois.length < 3; j++) {
      if (/^(19|20)\d{2}$/.test(toks[j])) break;       // ano encerra o modelo
      if (!depois.length && !ehModelo(toks[j])) continue;
      if (depois.length && (MARCA_ALIAS[toks[j]] || NAO_MODELO.has(toks[j]))) break;
      depois.push(toks[j]);
    }
    if (depois.length) return { marca, modelo: depois.join(' ') };
    // … ou ANTES dela ("BIZ 125 ES - HONDA", "YBR125K- YAMAHA")
    const antes = toks.slice(0, i).filter(ehModelo);
    if (antes.length) return { marca, modelo: antes.slice(0, 3).join(' ') };
    return null;
  }
  return null;
}

export function anoBate(nomeAno, anoFabricacao, anoModelo) {
  const ano = parseInt(String(nomeAno || '').match(/\d{4}/)?.[0] || '', 10);
  if (!ano) return false;
  return ano === anoFabricacao || ano === anoModelo;
}

function ordemCategorias(tipoVeiculo) {
  const preferida = TIPO_PARA_CATEGORIA[String(tipoVeiculo || '').toLowerCase()];
  if (!preferida) return CATEGORIAS;
  return [preferida, ...CATEGORIAS.filter(c => c !== preferida)];
}

export class ErroFipeSemCota extends Error {
  constructor() { super('Cota diária da FIPE esgotada'); this.semCota = true; }
}

/**
 * Chamada HTTP única, sempre precedida da reserva atômica no banco. `reservar()` é quem
 * chama `registrar_uso_fipe` — recebe o client de quem monta (supabase-js num script, ou o
 * fetch cru do REST numa função serverless) e devolve `{permitido, ...}`; erro ao checar
 * (`reservar()` lançou/devolveu algo inesperado) NUNCA vira "permitido" por omissão — não
 * consegui checar não é o mesmo que "pode gastar" (mesmo princípio do `verificar:schema`).
 */
// `cache` (opcional, 24/09): { ler(path) → resposta|undefined, gravar(path, resposta) }. A FIPE
// muda 1x/mês e as listas de marcas/modelos/anos quase nunca — sem cache persistente o cron
// rebaixava as MESMAS listas todo dia e gastava a cota nelas. Acerto de cache não consome cota.
export function criarFipeFetch(reservar, cache = null) {
  return async function fipeGet(path) {
    if (cache) {
      try { const hit = await cache.ler(path); if (hit !== undefined && hit !== null) return hit; }
      catch (e) { console.log(`  ⚠️ cache FIPE (leitura ${path}) falhou: ${String(e.message).slice(0, 80)} — segue pela API`); }
    }
    let decisao;
    try { decisao = await reservar(); }
    catch (e) { console.log(`  ⚠️ reserva de cota FIPE falhou: ${String(e.message).slice(0, 100)}`); decisao = { permitido: false }; }
    if (!decisao?.permitido) throw new ErroFipeSemCota();
    const r = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json', ...(FIPE_TOKEN ? { 'X-Subscription-Token': FIPE_TOKEN } : {}) }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) { console.log(`  ⚠️ FIPE ${path}: HTTP ${r.status}`); return null; }
    let j;
    try { j = await r.json(); }
    catch (e) { console.log(`  ⚠️ FIPE ${path}: resposta não é JSON válido (${String(e.message).slice(0, 80)})`); return null; }
    // só resposta ÚTIL vai pro cache: objeto de erro ({error}) ou vazio seria servido por 25 dias
    const util = Array.isArray(j) ? j.length > 0 : (j && typeof j === 'object' && !j.error);
    if (cache && util) {
      try { await cache.gravar(path, j); }
      catch (e) { console.log(`  ⚠️ cache FIPE (gravação ${path}) falhou: ${String(e.message).slice(0, 80)}`); }
    }
    return j;
  };
}

/**
 * Orquestra o casamento completo pra 1 veículo. `cache` (Map) é opcional — passe o MESMO
 * Map entre chamadas de um lote pra não repetir `/brands`/`/models` já vistos (cron faz
 * isso; a busca sob demanda de 1 veículo só não precisa).
 * Retorna { status: 'ok'|'aproximado'|'sem_match'|'sem_cota'|'erro', valor?, codigoFipe?, mesReferencia? }.
 * NUNCA lança por "não achei" — só `ErroFipeSemCota` sobe (quem chama decide o que fazer:
 * cron para o lote, endpoint on-demand devolve "tente mais tarde").
 */
export async function buscarFipe(fipeGet, veiculo, cache = new Map()) {
  const { ano_fabricacao: anoFabricacao, ano_modelo: anoModelo, tipo_veiculo: tipoVeiculo } = veiculo;
  const doTitulo = (!veiculo.marca || !veiculo.modelo) ? marcaModeloDoTitulo(veiculo.titulo, veiculo.marca) : null;
  // marca da fonte em sigla ("MMC", "VW", "GM") vira o nome que a FIPE usa
  const marcaFonte = veiculo.marca ? (MARCA_ALIAS[normalizar(veiculo.marca)] || veiculo.marca) : null;
  const marca = marcaFonte || doTitulo?.marca;
  const modelo = veiculo.modelo || doTitulo?.modelo;
  if (!marca || !modelo || !anoFabricacao) return { status: 'sem_dados' };
  try {
    let achado = null;
    for (const categoria of ordemCategorias(tipoVeiculo)) {
      const chaveMarcas = `marcas:${categoria}`;
      if (!cache.has(chaveMarcas)) cache.set(chaveMarcas, await fipeGet(`/${categoria}/brands`));
      const marcas = cache.get(chaveMarcas);
      if (!Array.isArray(marcas)) continue;
      const indice = indexarMarcas(marcas);
      const codigoMarca = acharMarca(marca, marcas, indice);
      if (codigoMarca) { achado = { categoria, codigoMarca }; break; }
    }
    if (!achado) return { status: 'sem_match' };

    const { categoria, codigoMarca } = achado;
    const chaveModelos = `modelos:${categoria}:${codigoMarca}`;
    if (!cache.has(chaveModelos)) cache.set(chaveModelos, await fipeGet(`/${categoria}/brands/${codigoMarca}/models`) || []);
    const modelos = cache.get(chaveModelos);
    const candidatosModelo = acharCandidatosModelo(modelo, modelos);
    if (!candidatosModelo.length) return { status: 'sem_match' };

    // Pára de checar assim que achar 2 — só precisamos saber se é único; o valor final vem
    // sempre do PRIMEIRO que bateu, então checar um 3º/4º não muda o resultado.
    const bateram = [];
    for (const cm of candidatosModelo) {
      if (bateram.length >= 2) break;
      const codigoModelo = cm.code ?? cm.codigo;
      const anos = await fipeGet(`/${categoria}/brands/${codigoMarca}/models/${codigoModelo}/years`);
      if (!Array.isArray(anos)) continue;
      const anoOk = anos.find(a => anoBate(a.name || a.nome, anoFabricacao, anoModelo));
      if (anoOk) bateram.push({ codigoModelo, codigoAno: anoOk.code ?? anoOk.codigo });
    }
    if (!bateram.length) return { status: 'sem_match' };

    const escolhido = bateram[0];
    const detalhe = await fipeGet(`/${categoria}/brands/${codigoMarca}/models/${escolhido.codigoModelo}/years/${escolhido.codigoAno}`);
    const valor = parseValor(detalhe?.price);
    if (!valor) return { status: 'erro' };

    return {
      status: bateram.length > 1 ? 'aproximado' : 'ok',
      valor, codigoFipe: detalhe.codeFipe || null, mesReferencia: detalhe.referenceMonth || null,
    };
  } catch (e) {
    if (e instanceof ErroFipeSemCota) return { status: 'sem_cota' };
    throw e;
  }
}
