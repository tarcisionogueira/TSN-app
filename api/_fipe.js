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
export function acharCandidatosModelo(nossoModelo, modelos) {
  const alvo = primeiraPalavra(nossoModelo);
  if (!alvo || alvo.length < 2) return [];
  return modelos.filter(m => primeiraPalavra(m.name || m.nome || '') === alvo);
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
export function criarFipeFetch(reservar) {
  return async function fipeGet(path) {
    let decisao;
    try { decisao = await reservar(); }
    catch (e) { console.log(`  ⚠️ reserva de cota FIPE falhou: ${String(e.message).slice(0, 100)}`); decisao = { permitido: false }; }
    if (!decisao?.permitido) throw new ErroFipeSemCota();
    const r = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    try { return await r.json(); }
    catch (e) { console.log(`  ⚠️ FIPE ${path}: resposta não é JSON válido (${String(e.message).slice(0, 80)})`); return null; }
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
  const { marca, modelo, ano_fabricacao: anoFabricacao, ano_modelo: anoModelo, tipo_veiculo: tipoVeiculo } = veiculo;
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
