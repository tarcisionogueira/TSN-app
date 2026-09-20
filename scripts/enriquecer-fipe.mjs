#!/usr/bin/env node
/**
 * Enriquecimento de valor FIPE de referência para veículos em leilão.
 *
 * API pública gratuita (fipe.parallelum.com.br, projeto deividfortuna/fipe): 500 req/dia sem
 * token. Confirmado via recon ao vivo (20/09): marca vem em nome COMPOSTO ("GM - Chevrolet",
 * "VW - VolksWagen"), modelo vem em descrição COMPLETA da versão ("Gol (novo) 1.0 Mi Total
 * Flex 8V 2p") — nosso `marca`/`modelo` é texto livre e curto da fonte do leilão ("Chevrolet",
 * "Gol"). Casamento é heurístico, nunca "chuta": marca por igualdade normalizada (com fallback
 * pro sufixo depois de " - "); modelo pela PRIMEIRA PALAVRA normalizada igual à primeira
 * palavra do nome FIPE (evita "Gol" casar com "Golf" — usar `includes` aqui já mordeu antes,
 * ver CLAUDE.md formas de bug conhecidas). Sem casamento único e confiante → `fipe_status`
 * distingue 'ok' de 'aproximado' (2+ versões bateram no ano — valor é indicativo, pegamos a
 * 1ª de forma determinística pra não gastar 1 chamada extra por versão) de 'sem_match'.
 *
 * `tipo_veiculo` está NULO em ~80% do acervo (medido 20/09) — não dá pra confiar nele pra
 * escolher direto entre carro/moto/caminhão. Tenta as 3 categorias da FIPE em ordem (a
 * categoria do `tipo_veiculo`, quando preenchida, primeiro — economiza 1-2 chamadas), pára na
 * primeira que casar a marca.
 *
 * NUNCA roda no fluxo de captura — a FIPE só atualiza a tabela 1x/mês, não faz sentido chamar
 * a cada scrape. Cron diário, lote pequeno (LIMITE) pra caber com folga na cota gratuita.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: FIPE_LIMITE (padrão 60).
 */
import { createClient } from '@supabase/supabase-js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.FIPE_LIMITE || '60', 10);
const BASE = 'https://fipe.parallelum.com.br/api/v2';
const CATEGORIAS = ['cars', 'motorcycles', 'trucks'];
const TIPO_PARA_CATEGORIA = { carro: 'cars', moto: 'motorcycles', motocicleta: 'motorcycles', caminhao: 'trucks' };
// 'sem_match' custa 1-3 chamadas de marca sem achar nada — não vale repetir todo dia; 'ok'/
// 'aproximado' a FIPE só muda 1x/mês, 25 dias é folga suficiente.
const RETENTAR_SEM_MATCH_DIAS = 90;
const RETENTAR_OK_DIAS = 25;

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB, KEY);

export const normalizar = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const primeiraPalavra = (s) => normalizar(s).split(' ')[0] || '';

async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' } });
  if (!r.ok) { console.log(`  ⚠️ GET ${path} -> ${r.status}`); return null; }
  try { return await r.json(); }
  catch (e) { console.log(`  ⚠️ GET ${path} -> resposta não é JSON válido (${String(e.message).slice(0, 80)})`); return null; }
}

// Prova que a linha mudou (`.select()`) em vez de confiar em `error: null` — update que a RLS
// filtra devolve `error: null` do mesmo jeito (ver CLAUDE.md, forma nº 3). Loga e devolve false
// em qualquer divergência, pra quem chama decidir se conta como sucesso ou como erro.
async function gravar(id, campos) {
  const { data, error } = await supabase.from('veiculos_leilao').update(campos).eq('id', id).select('id');
  if (error) { console.log(`  ⚠️ gravação falhou (veículo ${id}): ${error.message}`); return false; }
  if (!data?.length) { console.log(`  ⚠️ gravação não alcançou nenhuma linha (veículo ${id}) — RLS ou id inexistente`); return false; }
  return true;
}

function parseValor(precoStr) {
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

// Modelo: só a PRIMEIRA PALAVRA, comparada por IGUALDADE (não `includes` — "gol" é substring
// de "golf", um `includes` erraria aí). Retorna todos os candidatos (pode ser mais de um: a
// FIPE lista cada motorização/câmbio como um "modelo" separado).
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

async function main() {
  const desde90 = new Date(Date.now() - RETENTAR_SEM_MATCH_DIAS * 86400000).toISOString();
  const desde25 = new Date(Date.now() - RETENTAR_OK_DIAS * 86400000).toISOString();
  // Pendente = nunca tentado, OU tentativa antiga (o teto depende do status da última tentativa
  // — sem isto, `sem_match` seria retentado todo dia e estouraria a cota à toa).
  const { data: candidatos, error: errBusca } = await supabase
    .from('veiculos_leilao')
    .select('id, marca, modelo, ano_fabricacao, ano_modelo, tipo_veiculo, fipe_status, fipe_atualizado_em')
    .eq('ativo', true)
    .not('marca', 'is', null)
    .not('modelo', 'is', null)
    .not('ano_fabricacao', 'is', null)
    .or(`fipe_atualizado_em.is.null,and(fipe_status.eq.sem_match,fipe_atualizado_em.lt.${desde90}),and(fipe_status.neq.sem_match,fipe_atualizado_em.lt.${desde25})`)
    .limit(LIMITE);
  if (errBusca) { console.error('Erro ao buscar candidatos:', errBusca.message); process.exit(1); }
  if (!candidatos?.length) { console.log('Nada pendente.'); return; }
  console.log(`${candidatos.length} veículo(s) candidato(s) a enriquecer.`);

  // Cache por execução — marcas e modelos por categoria (várias fontes citam a mesma marca).
  const marcasPorCategoria = new Map();
  const modelosPorMarca = new Map(); // chave: `${categoria}:${codigoMarca}`
  async function marcasDe(categoria) {
    if (!marcasPorCategoria.has(categoria)) {
      const lista = await get(`/${categoria}/brands`);
      marcasPorCategoria.set(categoria, Array.isArray(lista) ? lista : null);
    }
    return marcasPorCategoria.get(categoria);
  }

  let ok = 0, aproximado = 0, semMatch = 0, erro = 0;
  for (const v of candidatos) {
    try {
      let achado = null; // { categoria, codigoMarca }
      for (const categoria of ordemCategorias(v.tipo_veiculo)) {
        const marcas = await marcasDe(categoria);
        if (!marcas) continue; // categoria fora do ar nesta execução — tenta a próxima
        const indice = indexarMarcas(marcas);
        const codigoMarca = acharMarca(v.marca, marcas, indice);
        if (codigoMarca) { achado = { categoria, codigoMarca, marcas }; break; }
      }
      if (!achado) {
        const gravou = await gravar(v.id, { fipe_status: 'sem_match', fipe_atualizado_em: new Date().toISOString() });
        gravou ? semMatch++ : erro++; continue;
      }
      const { categoria, codigoMarca } = achado;
      const chaveCache = `${categoria}:${codigoMarca}`;
      if (!modelosPorMarca.has(chaveCache)) {
        modelosPorMarca.set(chaveCache, await get(`/${categoria}/brands/${codigoMarca}/models`) || []);
      }
      const modelos = modelosPorMarca.get(chaveCache);
      const candidatosModelo = acharCandidatosModelo(v.modelo, modelos);
      if (!candidatosModelo.length) {
        const gravou = await gravar(v.id, { fipe_status: 'sem_match', fipe_atualizado_em: new Date().toISOString() });
        gravou ? semMatch++ : erro++; continue;
      }

      // Testa candidatos um a um, para de checar assim que achar 2 (só precisamos saber se é
      // único ou não — o valor final vem sempre do PRIMEIRO que bateu, então checar um 3º/4º
      // não muda o resultado, só gasta cota à toa).
      const bateram = [];
      for (const cm of candidatosModelo) {
        if (bateram.length >= 2) break;
        const codigoModelo = cm.code ?? cm.codigo;
        const anos = await get(`/${categoria}/brands/${codigoMarca}/models/${codigoModelo}/years`);
        if (!Array.isArray(anos)) continue;
        const anoOk = anos.find(a => anoBate(a.name || a.nome, v.ano_fabricacao, v.ano_modelo));
        if (anoOk) bateram.push({ codigoModelo, codigoAno: anoOk.code ?? anoOk.codigo });
      }
      if (!bateram.length) {
        const gravou = await gravar(v.id, { fipe_status: 'sem_match', fipe_atualizado_em: new Date().toISOString() });
        gravou ? semMatch++ : erro++; continue;
      }

      const escolhido = bateram[0];
      const detalhe = await get(`/${categoria}/brands/${codigoMarca}/models/${escolhido.codigoModelo}/years/${escolhido.codigoAno}`);
      const valor = parseValor(detalhe?.price);
      if (!valor) {
        await gravar(v.id, { fipe_status: 'erro', fipe_atualizado_em: new Date().toISOString() });
        erro++; continue;
      }
      const status = bateram.length > 1 ? 'aproximado' : 'ok';
      const gravou = await gravar(v.id, {
        valor_fipe: valor,
        fipe_codigo: detalhe.codeFipe || null,
        fipe_mes_referencia: detalhe.referenceMonth || null,
        fipe_status: status,
        fipe_atualizado_em: new Date().toISOString(),
      });
      if (!gravou) { erro++; continue; }
      status === 'ok' ? ok++ : aproximado++;
    } catch (e) {
      console.log(`  ⚠️ veículo ${v.id}: ${String(e.message).slice(0, 100)}`);
      erro++;
    }
  }
  console.log(`Concluído: ${ok} ok, ${aproximado} aproximado, ${semMatch} sem_match, ${erro} erro.`);
}

main();
