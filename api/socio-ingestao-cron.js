/**
 * /api/socio-ingestao-cron — ingere a base SOCIO-DEMOGRÁFICA por cidade (IBGE).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA QUE DITOU O DESENHO (constraint explícito do dono):
 *   "atenção com a separação das etapas para não cairmos no mesmo erro anterior de
 *    sobrecarregar o tempo de coleta das informações no relatório."
 * Então: NADA disto acontece durante o relatório. Este cron roda 1x por mês, sozinho, e
 * grava em `cidade_socio`. O relatório só faz UMA leitura indexada (`socio_regiao`), que
 * custa milissegundos. O tempo de coleta do relatório não muda em nada.
 *
 * E o cron também não se sobrecarrega: processa UMA FONTE POR EXECUÇÃO (a mais atrasada),
 * porque cada agregado do IBGE devolve os 5.570 municípios de uma vez — juntar quatro numa
 * execução só seria repetir o erro em outra camada.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * AUTONOMIA (o que o dono pediu: "assim como o Índice conseguimos replicar para ter
 * autonomia?"): não há ID de agregado nem nome de variável NO CÓDIGO. Tudo vem da tabela
 * `socio_fontes`. Se o IBGE renomear uma variável ou trocar um agregado de número, o conserto
 * é um UPDATE em SQL — sem deploy e sem esperar sessão. O casamento é por NOME (regex), que
 * muda muito menos que id.
 *
 * Chamável por CRON_SECRET (Vercel Cron) ou por ADMIN logado (para rodar sob demanda).
 * Query opcional: ?fonte=<chave> força uma fonte; ?todas=1 processa todas as ativas.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized, getUserRole } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const IBGE = 'https://servicodados.ibge.gov.br';

// Colunas de `cidade_socio` que têm par de ANO e de valor ANTERIOR. É o que permite a uma
// fonte com DOIS períodos (ex.: estimativa populacional dos 2 últimos anos) preencher o
// "antes" e o "depois" sozinha — de onde sai o crescimento recente.
const ANO_DE = { populacao: 'populacao_ano', domicilios: 'domicilios_ano', pop_estim: 'pop_estim_ano', nascimentos: 'nascimentos_ano' };
const ANT_DE = { populacao: ['populacao_ant', 'populacao_ant_ano'], pop_estim: ['pop_estim_ant', 'pop_estim_ant_ano'] };
// Colunas de domicílio que não têm ano próprio — herdam `domicilios_ano` do período da fonte.
const DOMICILIO = ['domicilios', 'domicilios_ocupados', 'domicilios_vagos', 'moradores_por_domicilio'];

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  signal: init.signal || AbortSignal.timeout(30000),
});

const cidadeNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const num = (v) => {
  // O IBGE devolve '-' e '...' para "não aplicável"/"sem dado". Virar 0 seria mentir.
  if (v === null || v === undefined) return null;
  let s = String(v).trim();
  if (!s || /^[-.]+$/.test(s) || s === 'X' || s === '..') return null;

  // SEPARADOR DECIMAL (corrigido em 12/08, antes do dado ser usado). A versão anterior
  // apagava TODO ponto, assumindo formato brasileiro (ponto = milhar). A API v3 do IBGE usa
  // ponto como DECIMAL: "1521.202" km² de São Paulo virava 1.521.202 — mil vezes maior, e
  // plausível o bastante para passar despercebido num campo que ninguém confere de cabeça.
  // A densidade saía igual, 752.826 hab/km² em vez de 7.528.
  // Regra que cobre os três formatos que aparecem:
  //   tem vírgula        → vírgula é decimal, ponto é milhar  ("1.521,20")
  //   dois ou mais pontos→ pontos são milhar                  ("11.451.999")
  //   um ponto só        → é decimal, preserva                ("1521.202")
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length >= 2) s = s.replace(/\./g, '');

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

async function jsonIBGE(url, ms = 60000) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`IBGE ${r.status} em ${url.replace(IBGE, '')}`);
  return r.json();
}

/** Mapa código IBGE (7 dígitos) → { cidade_norm, uf }. Uma chamada, ~5.570 municípios. */
async function mapaMunicipios() {
  const lista = await jsonIBGE(`${IBGE}/api/v1/localidades/municipios?view=nivelado`);
  const mapa = new Map();
  for (const m of Array.isArray(lista) ? lista : []) {
    const id = String(m['municipio-id'] || '');
    const nome = m['municipio-nome'];
    const uf = m['UF-sigla'];
    if (id && nome && uf) mapa.set(id, { cidade_norm: cidadeNorm(nome), uf: String(uf).toUpperCase() });
  }
  if (!mapa.size) throw new Error('lista de municípios do IBGE veio vazia');
  return mapa;
}

/**
 * Rótulo de um resultado: "Variável | Categoria | Categoria". É contra ISTO que o regex do
 * `mapa` casa — assim "Domicílios recenseados" + categoria "Vago" cai em domicilios_vagos,
 * que é o número que sustenta a leitura de estoque ocioso.
 */
function rotulos(variavel, resultado) {
  const cats = (resultado?.classificacoes || [])
    .flatMap((c) => Object.values(c?.categoria || {}))
    .filter((s) => s && !/^total$/i.test(s));
  return [variavel, ...cats].join(' | ');
}

function colunaPara(rotulo, mapa) {
  for (const [padrao, coluna] of Object.entries(mapa || {})) {
    try { if (new RegExp(padrao, 'i').test(rotulo)) return coluna; } catch { /* regex inválido na config: ignora */ }
  }
  return null;
}

async function processarFonte(fonte, municipios) {
  const t0 = Date.now();
  const periodo = fonte.periodo === 'last' ? '-1' : String(fonte.periodo || '-1');

  // Pede só as variáveis que interessam quando conseguimos identificá-las nos metadados:
  // resposta menor, mesma informação. Se os metadados falharem, pede todas (degradação suave).
  //
  // ARMADILHA MEDIDA EM 12/08: este filtro é o ponto onde a ingestão emagrece em silêncio. O
  // mapa de `censo_populacao` aponta 4 colunas (populacao, area_km2, densidade, crescimento) e
  // só `populacao` chegou; o de `censo_domicilios` aponta 4 e só `domicilios_ocupados` chegou.
  // As duas execuções gravaram `ok=true`, 5.570 linhas e `rotulos_ignorados: []` — porque o que
  // não é PEDIDO nunca chega para ser ignorado. Guardamos os nomes vistos para que a próxima
  // pessoa não precise adivinhar contra qual string o regex deveria casar.
  let variaveis = 'all';
  let nomesMeta = [];
  try {
    const meta = await jsonIBGE(`${IBGE}/api/v3/agregados/${fonte.agregado}/metadados`, 20000);
    nomesMeta = (meta?.variaveis || []).map((v) => String(v?.nome || ''));
    const ids = (meta?.variaveis || []).filter((v) => colunaPara(String(v?.nome || ''), fonte.mapa)).map((v) => v.id);
    if (ids.length) variaveis = ids.join('|');
  } catch { /* segue com 'all' */ }

  const url = `${IBGE}/api/v3/agregados/${fonte.agregado}/periodos/${periodo}/variaveis/${variaveis}?localidades=N6[all]`;
  const dados = await jsonIBGE(url, 120000);
  if (!Array.isArray(dados) || !dados.length) throw new Error('agregado sem dados para N6');

  // Acumula por município: { <ibge>: { <coluna>: { [periodo]: valor } } }
  const porMunicipio = new Map();
  let semColuna = new Set();
  for (const v of dados) {
    for (const resultado of v?.resultados || []) {
      const rot = rotulos(v?.variavel || '', resultado);
      const coluna = colunaPara(rot, fonte.mapa);
      if (!coluna) { semColuna.add(rot); continue; }
      for (const s of resultado?.series || []) {
        const id = String(s?.localidade?.id || '');
        if (!municipios.has(id)) continue;
        let acc = porMunicipio.get(id);
        if (!acc) { acc = {}; porMunicipio.set(id, acc); }
        const alvo = acc[coluna] || (acc[coluna] = {});
        for (const [p, valor] of Object.entries(s?.serie || {})) {
          const n = num(valor);
          if (n !== null) alvo[p] = n;
        }
      }
    }
  }
  if (!porMunicipio.size) {
    throw new Error(`nenhuma variável do agregado casou com o mapa. Rótulos vistos: ${[...semColuna].slice(0, 6).join(' ;; ') || '(nenhum)'}`);
  }

  // Monta as linhas: período mais recente vira o valor corrente; havendo dois, o anterior
  // preenche o par `_ant` (é dele que sai o crescimento a.a. em socio_derivar).
  const linhas = [];
  for (const [id, cols] of porMunicipio) {
    const { cidade_norm, uf } = municipios.get(id);
    const linha = { nivel: 'cidade', bairro_norm: '', cidade_norm, uf, ibge_codigo: id, detalhe: {} };
    let anoDomicilio = null;
    for (const [coluna, porPeriodo] of Object.entries(cols)) {
      const anos = Object.keys(porPeriodo).sort();
      if (!anos.length) continue;
      const ultimo = anos[anos.length - 1];
      linha[coluna] = porPeriodo[ultimo];
      if (ANO_DE[coluna]) linha[ANO_DE[coluna]] = Number(String(ultimo).slice(0, 4)) || null;
      if (DOMICILIO.includes(coluna)) anoDomicilio = Number(String(ultimo).slice(0, 4)) || anoDomicilio;
      if (anos.length > 1 && ANT_DE[coluna]) {
        const anterior = anos[anos.length - 2];
        const [colAnt, colAntAno] = ANT_DE[coluna];
        linha[colAnt] = porPeriodo[anterior];
        linha[colAntAno] = Number(String(anterior).slice(0, 4)) || null;
      }
    }
    if (anoDomicilio && !linha.domicilios_ano) linha.domicilios_ano = anoDomicilio;
    linha.detalhe[fonte.chave] = { agregado: fonte.agregado, periodo, em: new Date().toISOString().slice(0, 10) };
    linhas.push(linha);
  }

  // Grava em blocos — 5.570 linhas num payload só é convite a timeout.
  let gravadas = 0;
  for (let i = 0; i < linhas.length; i += 400) {
    const bloco = linhas.slice(i, i + 400);
    const r = await sb('rpc/socio_upsert', { method: 'POST', body: JSON.stringify({ p_rows: bloco }), signal: AbortSignal.timeout(45000) });
    if (!r.ok) throw new Error(`socio_upsert ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
    gravadas += Number(await r.json().catch(() => 0)) || 0;
  }
  // COLUNA PEDIDA QUE NÃO CHEGOU. Sem esta conferência a ingestão declara sucesso completo
  // tendo trazido 1 de 4 colunas — foi o que aconteceu com os dois censos, e o efeito só
  // apareceu semanas depois, quando `cidade_socio.area_km2` (vazia) inviabilizou medir
  // território mapeado. "5.570 linhas gravadas" parece perfeito e não é.
  const esperadas = [...new Set(Object.values(fonte.mapa || {}))];
  const recebidas = [...new Set(linhas.flatMap((l) => Object.keys(l)))];
  const faltando = esperadas.filter((c) => !recebidas.includes(c));

  return {
    gravadas, municipios: porMunicipio.size, ms: Date.now() - t0,
    rotulos_ignorados: [...semColuna].slice(0, 10),
    colunas_esperadas: esperadas,
    colunas_faltando: faltando,
    // Os nomes que o IBGE realmente expõe, para ajustar o regex do `mapa` sem tentativa e erro.
    variaveis_do_agregado: nomesMeta.slice(0, 20),
  };
}

async function registrar(fonte, ok, linhas, ms, erro, detalhe) {
  try {
    await sb('socio_ingestao', { method: 'POST', body: JSON.stringify({ fonte, ok, linhas, ms, erro: erro ? String(erro).slice(0, 500) : null, detalhe: detalhe || null }) });
    await sb(`socio_fontes?chave=eq.${encodeURIComponent(fonte)}`, {
      method: 'PATCH',
      body: JSON.stringify({ ultimo_em: new Date().toISOString(), ultimo_ok: ok, ultimo_linhas: linhas, ultimo_erro: erro ? String(erro).slice(0, 500) : null }),
    });
  } catch (e) { console.error('[socio] falha ao registrar:', e?.message || e); }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) {
    // Admin logado também dispara — o dono não deve depender de esperar o cron mensal.
    const role = await getUserRole(req).catch(() => null);
    if (role !== 'admin') return res.status(401).json({ error: 'Não autorizado' });
  }
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const url = new URL(req.url, 'http://x');
  const forcada = url.searchParams.get('fonte') || '';
  const todas = url.searchParams.get('todas') === '1';

  // SONDA DE METADADOS: `?metadados=4714` devolve os nomes das variáveis daquele agregado do
  // IBGE e não escreve nada. Existe porque descobrir o agregado certo era um ciclo de
  // deploy-e-torcer: em 12/08 ficou provado que o 4709 (usado por `censo_populacao`) NÃO tem
  // área nem densidade — só População residente, Variação absoluta e Taxa de crescimento
  // geométrico. Sem esta sonda, achar onde a área mora custaria um deploy por tentativa.
  // BUSCA NO CATÁLOGO: `?buscar=urbaniz` lista os agregados cujo nome (ou o da pesquisa)
  // contém o termo. Sem isto, achar o agregado certo é adivinhar número por número — foi o
  // que custou caro até a sonda `metadados` existir. Não escreve nada.
  const termo = (url.searchParams.get('buscar') || '').trim().toLowerCase();
  if (termo) {
    try {
      const cat = await jsonIBGE(`${IBGE}/api/v3/agregados`, 60000);
      const achados = [];
      for (const pesquisa of Array.isArray(cat) ? cat : []) {
        for (const ag of pesquisa?.agregados || []) {
          const alvo = `${pesquisa?.nome || ''} | ${ag?.nome || ''}`.toLowerCase();
          if (alvo.includes(termo)) achados.push({ id: ag?.id, nome: ag?.nome, pesquisa: pesquisa?.nome });
          if (achados.length >= 40) break;
        }
        if (achados.length >= 40) break;
      }
      return res.status(200).json({ ok: true, termo, total: achados.length, agregados: achados });
    } catch (e) {
      return res.status(200).json({ ok: false, termo, erro: String(e?.message || e).slice(0, 300) });
    }
  }

  const sonda = url.searchParams.get('metadados') || '';
  if (sonda) {
    try {
      const meta = await jsonIBGE(`${IBGE}/api/v3/agregados/${encodeURIComponent(sonda)}/metadados`, 20000);
      return res.status(200).json({
        ok: true, agregado: sonda, nome: meta?.nome || null,
        periodos: meta?.periodicidade || null,
        variaveis: (meta?.variaveis || []).map((v) => ({ id: v?.id, nome: v?.nome, unidade: v?.unidade })),
      });
    } catch (e) {
      return res.status(200).json({ ok: false, agregado: sonda, erro: String(e?.message || e).slice(0, 300) });
    }
  }

  // Cadência: o cron roda todo dia, mas só toca em fonte com mais de 25 dias (dado do IBGE é
  // anual/decenal — reingerir diariamente seria queimar chamada à toa). Efeito prático: nos
  // primeiros dias após o deploy a base se preenche sozinha, uma fonte por dia, e depois cada
  // uma se renova ~mensalmente. Sem carga concentrada e sem precisar de disparo manual.
  const corte = new Date(Date.now() - 25 * 864e5).toISOString();
  let fontes = [];
  try {
    const q = forcada
      ? `socio_fontes?chave=eq.${encodeURIComponent(forcada)}&select=*`
      : `socio_fontes?ativa=eq.true&or=(ultimo_em.is.null,ultimo_em.lt.${corte})&select=*&order=ultimo_em.asc.nullsfirst,ordem.asc`;
    const r = await sb(q);
    if (!r.ok) throw new Error(`socio_fontes ${r.status}`);
    fontes = await r.json();
    // UMA fonte por execução (a mais atrasada), a menos que peçam explicitamente todas.
    if (!forcada && !todas) fontes = fontes.slice(0, 1);
  } catch (e) {
    console.error('[socio]', e?.message || e);
    return res.status(500).json({ error: 'Não foi possível ler socio_fontes' });
  }
  if (!fontes.length) return res.status(200).json({ ok: true, msg: 'nada a ingerir (todas as fontes frescas)', fontes: [] });

  let municipios;
  try {
    municipios = await mapaMunicipios();
  } catch (e) {
    await registrar(fontes[0]?.chave || 'localidades', false, 0, null, e?.message || e, null);
    return res.status(200).json({ ok: false, erro: `lista de municípios: ${e?.message || e}` });
  }

  const resultado = [];
  for (const f of fontes) {
    if (f.ativa === false && !forcada) continue;
    const t0 = Date.now();
    try {
      const r = await processarFonte(f, municipios);
      // Coluna pedida que não veio = ingestão PARCIAL, e parcial não é `ok`. Registrar como
      // sucesso aqui foi o que manteve `area_km2` e `domicilios` vazios por 8 dias com o
      // painel de fontes todo verde.
      const parcial = (r.colunas_faltando || []).length > 0;
      await registrar(f.chave, !parcial, r.gravadas, r.ms,
        parcial ? `ingestão PARCIAL: colunas sem dado — ${r.colunas_faltando.join(', ')}` : null,
        { municipios: r.municipios, rotulos_ignorados: r.rotulos_ignorados,
          colunas_esperadas: r.colunas_esperadas, colunas_faltando: r.colunas_faltando,
          variaveis_do_agregado: r.variaveis_do_agregado });
      resultado.push({ fonte: f.chave, ok: !parcial, linhas: r.gravadas, ms: r.ms,
        colunas_faltando: r.colunas_faltando, variaveis_do_agregado: r.variaveis_do_agregado });
    } catch (e) {
      // Uma fonte quebrada NUNCA derruba as outras nem apaga o que já está gravado —
      // o socio_upsert só sobrescreve coluna com valor novo (coalesce).
      await registrar(f.chave, false, 0, Date.now() - t0, e?.message || e, null);
      resultado.push({ fonte: f.chave, ok: false, erro: String(e?.message || e).slice(0, 300) });
    }
  }

  // Derivados (vagos %, crescimento a.a., leitura de pressão) recalculados com a régua
  // autocalibrada nos tercis do país. Barato e sempre coerente com o que acabou de entrar.
  let derivadas = 0;
  try {
    const r = await sb('rpc/socio_derivar', { method: 'POST', body: '{}', signal: AbortSignal.timeout(60000) });
    if (r.ok) derivadas = Number(await r.json().catch(() => 0)) || 0;
    else console.error('[socio] socio_derivar', r.status);
  } catch (e) { console.error('[socio] socio_derivar', e?.message || e); }

  console.log('[socio]', JSON.stringify({ resultado, derivadas }));
  return res.status(200).json({ ok: resultado.every((r) => r.ok), fontes: resultado, derivadas });
}
