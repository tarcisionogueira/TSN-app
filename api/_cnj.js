/**
 * Helper CNJ DataJud — consulta processual por número ou por nome da parte.
 * Reusado por /api/cnj-datajud (endpoint) e /api/processar-analise (triagem).
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/endpoints
 */
const CNJ_KEY = process.env.CNJ_DATAJUD_KEY;
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

const TRIBUNAL_ESTADUAL = {
  SP: 'tjsp', RJ: 'tjrj', MG: 'tjmg', RS: 'tjrs', PR: 'tjpr',
  SC: 'tjsc', BA: 'tjba', GO: 'tjgo', PE: 'tjpe', CE: 'tjce',
  ES: 'tjes', MA: 'tjma', PA: 'tjpa', PB: 'tjpb', RN: 'tjrn',
  MT: 'tjmt', MS: 'tjms', PI: 'tjpi', AL: 'tjal', SE: 'tjse',
  TO: 'tjto', DF: 'tjdft', AC: 'tjac', AM: 'tjam', AP: 'tjap',
  RO: 'tjro', RR: 'tjrr',
};
const TRF_MAP = {
  AC: 'trf1', AM: 'trf1', AP: 'trf1', BA: 'trf1', DF: 'trf1',
  GO: 'trf1', MA: 'trf1', MT: 'trf1', PA: 'trf1',
  PI: 'trf1', RO: 'trf1', RR: 'trf1', TO: 'trf1',
  ES: 'trf2', RJ: 'trf2',
  MS: 'trf3', SP: 'trf3',
  PR: 'trf4', RS: 'trf4', SC: 'trf4',
  AL: 'trf5', CE: 'trf5', PB: 'trf5', PE: 'trf5', RN: 'trf5', SE: 'trf5',
  // TRF6 (instalado em 2022) tem jurisdição sobre Minas Gerais. Antes MG caía em
  // trf1 e os processos federais de MG não eram encontrados. Processos antigos de
  // MG ainda podem estar na base do trf1 → a busca por UF de MG consulta os dois
  // (ver buscarProcessosCNJ). api_publica_trf6 existe no DataJud; se falhar, cai
  // no tratamento de erro por-tribunal sem quebrar a consulta.
  MG: 'trf6',
};
// JUSTIÇA DO TRABALHO (12/09) — a busca por UF nunca consultava a Justiça do Trabalho:
// só somava TJ (estadual) + TRF (federal) + STJ. Achado real: um processo de execução
// trabalhista (0000199-97.2016.5.05.0195, TRT5/BA) que o dono achou na hora no site
// oficial do CNJ (comunica.pje.jus.br) saiu "0 processos" no nosso sistema — não porque
// o DataJud estivesse fora do ar, mas porque `tribunais` nunca incluía `trt5`. Mapa
// oficial de jurisdição (estável, publicado pelo CNJ — SP e os pares PA/AP, DF/TO,
// AM/RR, RO/AC dividem região).
const TRT_MAP = {
  AC: ['trt14'], AL: ['trt19'], AP: ['trt8'], AM: ['trt11'], BA: ['trt5'],
  CE: ['trt7'], DF: ['trt10'], ES: ['trt17'], GO: ['trt18'], MA: ['trt16'],
  MT: ['trt23'], MS: ['trt24'], MG: ['trt3'], PA: ['trt8'], PB: ['trt13'],
  PR: ['trt9'], PE: ['trt6'], PI: ['trt22'], RJ: ['trt1'], RN: ['trt21'],
  RS: ['trt4'], RO: ['trt14'], RR: ['trt11'], SC: ['trt12'],
  SP: ['trt2', 'trt15'], SE: ['trt20'], TO: ['trt10'],
};
// Todos os 24 TRTs — para o modo `nacional` (que hoje também pulava a Justiça do
// Trabalho por completo, mesmo varrendo "todos os tribunais").
const TODOS_TRT = Array.from({ length: 24 }, (_, i) => `trt${i + 1}`);

const RISCOS_MAP = [
  // BLOQUEANTES
  { regex: /penhora\s+do\s+(?:im[oó]vel|bem|direito)/i, severidade: 'bloqueante', categoria: 'Penhora', descricao: 'Penhora diretamente sobre o bem' },
  { regex: /penhora/i, severidade: 'bloqueante', categoria: 'Penhora', descricao: 'Penhora registrada no processo' },
  { regex: /arresto/i, severidade: 'bloqueante', categoria: 'Arresto', descricao: 'Arresto de bem' },
  { regex: /hipoteca\s+judicial/i, severidade: 'bloqueante', categoria: 'Hipoteca Judicial', descricao: 'Hipoteca judicial sobre o bem' },
  { regex: /aliena[çc][aã]o\s+fiduci[aá]ria/i, severidade: 'bloqueante', categoria: 'Alienação Fiduciária', descricao: 'Alienação fiduciária — credor tem propriedade resolúvel' },
  { regex: /usu?fruto/i, severidade: 'bloqueante', categoria: 'Usufruto', descricao: 'Usufruto registrado — bem tem gravame de uso' },
  { regex: /anticrese/i, severidade: 'bloqueante', categoria: 'Anticrese', descricao: 'Anticrese sobre o bem' },
  { regex: /reintegra[çc][aã]o\s+de\s+posse/i, severidade: 'bloqueante', categoria: 'Reintegração de Posse', descricao: 'Ação de reintegração de posse em curso' },
  { regex: /embargos?\s+à\s+arremata[çc][aã]o/i, severidade: 'bloqueante', categoria: 'Embargos', descricao: 'Embargos à arrematação — pode suspender ou anular o leilão' },
  { regex: /nulidade\s+(?:do\s+leil[aã]o|da\s+arremata[çc][aã]o)/i, severidade: 'bloqueante', categoria: 'Nulidade', descricao: 'Discussão de nulidade do leilão' },
  { regex: /bem\s+(?:de\s+)?fam[ií]lia/i, severidade: 'bloqueante', categoria: 'Bem de Família', descricao: 'Imóvel pode ser impenhorável como bem de família' },
  { regex: /suspens[aã]o\s+(?:da\s+)?(?:arremata[çc][aã]o|hasta|leil[aã]o)/i, severidade: 'bloqueante', categoria: 'Suspensão', descricao: 'Suspensão da arrematação ou leilão determinada' },

  // ALERTAS
  { regex: /recurso\s+(?:especial|extraordin[aá]rio|de\s+apela[çc][aã]o)/i, severidade: 'alerta', categoria: 'Recurso Pendente', descricao: 'Recurso pendente de julgamento' },
  { regex: /ação\s+(?:revis?ional|anulatória|rescis[oó]ria)/i, severidade: 'alerta', categoria: 'Ação Anulatória', descricao: 'Ação anulatória ou revisional em curso' },
  { regex: /consigna[çc][aã]o\s+(?:em\s+)?pagamento/i, severidade: 'alerta', categoria: 'Consignação', descricao: 'Ação de consignação em pagamento (devedor pode estar discutindo a dívida)' },
  { regex: /impugna[çc][aã]o/i, severidade: 'alerta', categoria: 'Impugnação', descricao: 'Impugnação no processo' },
  { regex: /tutela\s+(?:antecipada|cautelar|de\s+urg[eê]ncia)/i, severidade: 'alerta', categoria: 'Tutela Urgente', descricao: 'Tutela de urgência — pode haver liminar bloqueando' },
  { regex: /liminar/i, severidade: 'alerta', categoria: 'Liminar', descricao: 'Liminar concedida — verifique se afeta o bem' },
  { regex: /fal[eê]ncia|recupera[çc][aã]o\s+judicial/i, severidade: 'alerta', categoria: 'Falência/Recuperação', descricao: 'Processo de falência ou recuperação judicial' },
  { regex: /inventário|arrolamento/i, severidade: 'alerta', categoria: 'Inventário', descricao: 'Bem pode estar em inventário' },
  { regex: /dívida\s+ativa|execu[çc][aã]o\s+fiscal/i, severidade: 'alerta', categoria: 'Execução Fiscal', descricao: 'Execução fiscal — possível dívida com o fisco' },
  { regex: /hasta\s+p[uú]blica|leil[aã]o\s+(?:judicial|p[uú]blico)/i, severidade: 'alerta', categoria: 'Hasta Pública', descricao: 'Hasta pública / leilão registrado no processo' },
  { regex: /adjudica[çc][aã]o/i, severidade: 'alerta', categoria: 'Adjudicação', descricao: 'Adjudicação — credor pode ter assumido o bem' },
  { regex: /concurso\s+de\s+credores/i, severidade: 'alerta', categoria: 'Múltiplos Credores', descricao: 'Concurso de credores — múltiplas penhoras' },
  { regex: /interdito|incapaz/i, severidade: 'alerta', categoria: 'Capacidade Civil', descricao: 'Questão de capacidade civil do devedor' },
];

// Categorias que indicam tentativa de suspender/anular/atrasar o leilão
const CATEGORIAS_SUSPENSIVAS = ['Suspensão', 'Nulidade', 'Embargos', 'Ação Anulatória', 'Consignação', 'Tutela Urgente', 'Liminar', 'Impugnação', 'Recurso Pendente'];

// Tribunais superiores disponíveis na API pública do DataJud
const SUPERIORES = ['stj', 'tst', 'tse'];
// Conjunto nacional: todos os TJs + todos os TRFs + todos os TRTs + superiores (deduplicado)
const TODOS_TRIBUNAIS = [...new Set([...Object.values(TRIBUNAL_ESTADUAL), ...Object.values(TRF_MAP), ...TODOS_TRT, ...SUPERIORES])];

const FASES_RISCO = {
  'Execução': 'alto', 'Cumprimento de Sentença': 'alto', 'Execução Fiscal': 'alto',
  'Conhecimento': 'medio', 'Recurso': 'medio', 'Liquidação': 'medio', 'Cautelar': 'baixo',
};

async function buscarTribunal(tribunal, query) {
  try {
    const url = `${BASE_URL}/api_publica_${tribunal}/_search`;
    const pedir = () => fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `APIKey ${CNJ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: 10, query }),
      signal: AbortSignal.timeout(12000),
    });
    let res = await pedir();
    // 24/09 — HTTP 429 `es_rejected_execution_exception` = a fila de busca do DataJud está cheia
    // (sobrecarga DO CNJ, não erro nosso). Uma nova tentativa curta costuma passar; mais que isso
    // só agrava a fila deles e prende a tela.
    if (res.status === 429) { await new Promise(r => setTimeout(r, 1800)); res = await pedir(); }
    // 19/09 — HTTP 400 sozinho não diz NADA (query malformada? campo inexistente? sintaxe
    // Elasticsearch errada?). Achado ao vivo: 6/6 tribunais devolvendo 400 ao mesmo tempo pra
    // uma busca por NOME DA PARTE (query `nested`) — enquanto a busca por NÚMERO (query
    // `bool/match` simples) passava 5/6 na mesma rodada. O corpo do erro do Elasticsearch diz
    // exatamente qual campo/sintaxe ele rejeitou; sem capturar isso, cada 400 novo exige
    // arqueologia de log igual a esta. Trunca pra não inchar o log com o erro inteiro.
    if (!res.ok) {
      const corpo = await res.text().catch(() => '');
      return { hits: { hits: [], total: { value: 0 } }, _tribunal: tribunal, _erro: `HTTP ${res.status}${corpo ? ` — ${corpo.slice(0, 300)}` : ''}` };
    }
    const data = await res.json();
    return { ...data, _tribunal: tribunal };
  } catch (err) {
    return { hits: { hits: [], total: { value: 0 } }, _tribunal: tribunal, _erro: err.message };
  }
}

function analisarRiscos(processo) {
  const riscos = [];
  const textos = [
    ...(processo.movimentos || []).map(m => `${m.nome || ''} ${m.complemento || ''}`),
    processo.classe?.nome || '',
    ...(processo.assuntos || []).map(a => a.nome || ''),
  ].join(' ');
  for (const regra of RISCOS_MAP) {
    if (regra.regex.test(textos) && !riscos.find(r => r.categoria === regra.categoria)) {
      riscos.push({ severidade: regra.severidade, categoria: regra.categoria, descricao: regra.descricao });
    }
  }
  return riscos;
}

function detectarFase(processo) {
  const classe = processo.classe?.nome || '';
  const movimentos = (processo.movimentos || []).map(m => m.nome || '').join(' ');
  for (const [fase, risco] of Object.entries(FASES_RISCO)) {
    if (classe.includes(fase) || movimentos.includes(fase)) return { fase, risco };
  }
  return { fase: 'Não identificada', risco: 'desconhecido' };
}

function formatarProcesso(hit, tribunal) {
  const s = hit._source || {};
  const riscos = analisarRiscos(s);
  const { fase, risco: nivelRisco } = detectarFase(s);
  const movimentos = (s.movimentos || [])
    .sort((a, b) => new Date(b.dataHora || 0) - new Date(a.dataHora || 0))
    .slice(0, 20)
    .map(m => ({
      data: m.dataHora?.split('T')[0] || '',
      descricao: [m.nome, m.complemento].filter(Boolean).join(' — ').slice(0, 200),
      codigo: m.codigo,
      risco: RISCOS_MAP.find(r => r.regex.test(`${m.nome || ''} ${m.complemento || ''}`))?.severidade || null,
    }));
  const partes = (s.partes || []).map(p => ({
    nome: p.nome || '', tipo: p.polo || '', documento: p.cpf || p.cnpj || '',
    advogados: (p.advogados || []).map(a => ({ nome: a.nome || '', oab: a.numeroInscricao || '' })),
  }));
  const bloqueantes = riscos.filter(r => r.severidade === 'bloqueante').length;
  const alertas = riscos.filter(r => r.severidade === 'alerta').length;
  const scoreRisco = Math.min(100, bloqueantes * 35 + alertas * 15);
  return {
    id: hit._id, tribunal: tribunal.toUpperCase(), numero: s.numeroProcesso || '',
    classe: s.classe?.nome || '', assuntos: (s.assuntos || []).map(a => a.nome).join('; '),
    orgao: s.orgaoJulgador?.nome || '', grau: s.grau || '', fase, nivel_risco: nivelRisco,
    data_ajuizamento: s.dataAjuizamento?.split('T')[0] || '',
    ultima_atualizacao: s.dataHoraUltimaAtualizacao?.split('T')[0] || '',
    valor_causa: s.valorCausa || s.valor || null,
    partes, movimentos, riscos, score_risco: scoreRisco,
    tem_penhora: riscos.some(r => r.categoria === 'Penhora'),
    tem_arresto: riscos.some(r => r.categoria === 'Arresto'),
    tem_leilao: riscos.some(r => r.categoria === 'Hasta Pública'),
    tem_bloqueante: bloqueantes > 0,
    tem_suspensiva: riscos.some(r => CATEGORIAS_SUSPENSIVAS.includes(r.categoria)),
  };
}

/**
 * PARECER DE RISCO PROCESSUAL.
 *
 * ACHADO GRAVE (08/08, varredura das anomalias): lista vazia devolvia **verde** com o texto
 * "Nenhum processo encontrado nos tribunais consultados" em TODOS os caminhos — inclusive quando
 * a consulta nem aconteceu (chave `CNJ_DATAJUD_KEY` ausente, UF inválida, tribunal fora do ar).
 * Pior: em lote JUDICIAL o processo existe por definição, e mesmo assim o cliente lia um selo
 * verde dizendo que não há processo. Caso real: lote MEGA, processo 1139028-25.2021.8.26.0100,
 * anomalia `cnj_vazio` registrada — e o relatório entregue com `nivel: verde`.
 *
 * Não é um número errado, é um SELO DE SEGURANÇA JURÍDICA indevido: leva alguém a dar lance
 * achando que a due diligence processual passou. A regra agora separa as três situações:
 *   • NÃO CONSULTAMOS (erro/sem chave/sem tribunal)      → 'nao_verificado', nunca verde;
 *   • CONSULTAMOS e não achamos, mas o lote é JUDICIAL
 *     ou temos o número do processo                       → 'amarelo' (não localizado ≠ inexistente);
 *   • CONSULTAMOS e não achamos, sem indício de processo  → verde, com a ressalva de sempre.
 *
 * @param {Array} processos
 * @param {{erros?: string[], tribunais?: string[], numeroProcesso?: string, modalidade?: string}} ctx
 */
export function gerarParecerRisco(processos, ctx = {}) {
  if (!processos.length) {
    const houveErro = Array.isArray(ctx.erros) && ctx.erros.length > 0;
    const consultou = Array.isArray(ctx.tribunais) && ctx.tribunais.length > 0 && !houveErro;
    const ehJudicial = /judicial/i.test(String(ctx.modalidade || ''));
    const temNumero = !!String(ctx.numeroProcesso || '').replace(/\D/g, '');

    if (!consultou) {
      return {
        nivel: 'nao_verificado',
        texto: 'NÃO FOI POSSÍVEL CONSULTAR os tribunais agora. Isto NÃO significa que não existe processo — a consulta processual deste lote está pendente.',
        recomendacao: 'Confirme o processo no tribunal (ou peça a consulta ao suporte) antes de dar lance.',
        motivo: houveErro ? 'consulta_falhou' : 'consulta_nao_realizada',
      };
    }
    if (ehJudicial || temNumero) {
      return {
        nivel: 'amarelo',
        texto: `Processo ${temNumero ? `${ctx.numeroProcesso} ` : ''}NÃO LOCALIZADO na base pública do CNJ${ehJudicial ? ', embora o lote seja de leilão JUDICIAL (há processo por definição)' : ''}. A base do DataJud tem atraso e cobertura parcial — ausência ali não é ausência de processo.`,
        recomendacao: 'Confirme os autos no tribunal de origem antes de dar lance.',
        motivo: 'nao_localizado',
      };
    }
    return { nivel: 'verde', texto: 'Nenhum processo encontrado nos tribunais consultados. Recomenda-se consulta adicional no cartório de registro de imóveis.', motivo: 'sem_processo' };
  }
  const bloqueantes = processos.flatMap(p => p.riscos.filter(r => r.severidade === 'bloqueante'));
  const alertas = processos.flatMap(p => p.riscos.filter(r => r.severidade === 'alerta'));
  if (bloqueantes.length > 0) return { nivel: 'vermelho', texto: `OPERAÇÃO COM RISCO ALTO. ${bloqueantes.length} risco(s) bloqueante(s) em ${processos.length} processo(s): ${[...new Set(bloqueantes.map(r => r.categoria))].join(', ')}.`, recomendacao: 'Consulte advogado especializado antes do leilão.' };
  if (alertas.length > 0) return { nivel: 'amarelo', texto: `RISCOS A MONITORAR. ${alertas.length} alerta(s) em ${processos.length} processo(s): ${[...new Set(alertas.map(r => r.categoria))].join(', ')}.`, recomendacao: 'Monitore o andamento processual.' };
  return { nivel: 'verde', texto: `Consulta em ${processos.length} processo(s) sem riscos bloqueantes.`, recomendacao: 'Prossiga com a due diligence documental.' };
}

// Roda a query em cada tribunal (em lotes, ~36 tribunais no modo nacional não podem estourar
// conexões de uma vez), formata os hits e deduplica por número de processo. Extraído em 20/09
// pra ser reusado por buscarRetomadaVeiculos() sem duplicar esta parte (a batelada/dedupe/sort
// já levou vários fixes ao vivo — duas cópias divergiriam no primeiro ajuste).
async function executarBuscaCNJ(tribunais, query) {
  const resultados = [];
  const LOTE = 8;
  for (let i = 0; i < tribunais.length; i += LOTE) {
    const parte = tribunais.slice(i, i + LOTE);
    resultados.push(...await Promise.all(parte.map(t => buscarTribunal(t, query))));
  }
  const processos = [];
  const erros = [];
  for (const r of resultados) {
    if (r._erro) erros.push(`${r._tribunal}: ${r._erro}`);
    for (const hit of (r.hits?.hits || [])) processos.push(formatarProcesso(hit, r._tribunal));
  }
  // 18/09 — antes o motivo real (timeout? HTTP 5xx? rate limit?) morria aqui: `erros` virava
  // `parecer.motivo='consulta_falhou'` no relatório, mas o TEXTO do erro nunca aparecia em
  // lugar nenhum (nem log, nem banco) — impossível diferenciar DataJud fora do ar de bug
  // nosso na próxima ocorrência. Log simples resolve pro Vercel; `erros` no retorno já viaja
  // pro chamador persistir se quiser (gerar-documental.js agora grava em result.cnj.erros).
  if (erros.length) console.error(`[cnj] falha em ${erros.length}/${tribunais.length} tribunal(is):`, erros.join(' | '));
  const unique = processos.filter((p, i, arr) => arr.findIndex(x => x.numero === p.numero) === i);
  unique.sort((a, b) => (a.tem_bloqueante === b.tem_bloqueante ? b.score_risco - a.score_risco : a.tem_bloqueante ? -1 : 1));
  return { processos: unique, erros };
}

/**
 * Consulta o CNJ DataJud por número de processo OU por nome da parte, na UF dada.
 * Retorna { processos, total, tribunais_consultados, erros, parecer }.
 */
/**
 * O TRIBUNAL EXATO a partir do número CNJ (NNNNNNN-DD.AAAA.J.TR.OOOO): J é o ramo da Justiça e TR o
 * tribunal. 24/09 — o andamento do arremate (TRT5) consultava TJBA + TRF1 + TRF5 + TST + STJ ao
 * mesmo tempo, e o DataJud recusou quatro deles com 429: cinco buscas para um processo que só
 * pode estar num lugar. Devolve null quando o número não permite saber (aí vale a busca por UF).
 */
// Justiça Estadual (J=8): o TR é a UF em ordem alfabética do nome do estado (01 AC … 27 TO).
const UF_POR_TR_ESTADUAL = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SE','SP','TO'];
export function tribunalDoNumeroCnj(numero) {
  const d = String(numero || '').replace(/\D/g, '');
  if (d.length !== 20) return null;
  const tr = parseInt(d.slice(14, 16), 10);
  if (d[13] === '8') return TRIBUNAL_ESTADUAL[UF_POR_TR_ESTADUAL[tr - 1]] || null;
  if (d[13] === '5' && tr >= 1 && tr <= 24) return `trt${tr}`;
  if (d[13] === '4' && tr >= 1 && tr <= 6) return `trf${tr}`;
  return null;
}

export async function buscarProcessosCNJ({ numero_processo, nome_parte, uf, nacional = false, modalidade = null, tribunais: tribunaisExatos = null }) {
  if (!CNJ_KEY) return { processos: [], total: 0, tribunais_consultados: [], erros: ['CNJ_DATAJUD_KEY ausente'], parecer: gerarParecerRisco([], { erros: ['CNJ_DATAJUD_KEY ausente'], numeroProcesso: numero_processo, modalidade }) };
  const ufUp = String(uf || '').toUpperCase();
  const estadual = TRIBUNAL_ESTADUAL[ufUp];
  const trf = TRF_MAP[ufUp];
  // nacional = varre todos os TJs + TRFs + superiores; senão, foca na UF + STJ.
  const exatos = Array.isArray(tribunaisExatos) ? tribunaisExatos.filter(Boolean) : [];
  if (!nacional && !estadual && !exatos.length) return { processos: [], total: 0, tribunais_consultados: [], erros: [`UF inválida: ${uf}`], parecer: gerarParecerRisco([], { erros: [`UF inválida: ${uf}`], numeroProcesso: numero_processo, modalidade }) };

  let query;
  if (numero_processo) {
    const numLimpo = String(numero_processo).replace(/\D/g, '');
    query = { bool: { should: [{ match: { numeroProcesso: numero_processo } }, { match: { numeroProcesso: numLimpo } }], minimum_should_match: 1 } };
  } else if (nome_parte) {
    // 19/09 — NÃO envolver em `nested`: o log de erro (capturado ao vivo após o fix do corpo
    // de resposta) mostrou HTTP 400 em 6/6 tribunais com o motivo exato do Elasticsearch:
    // "failed to create query: [nested] failed to find nested object under path [partes]" —
    // no mapping público do DataJud, `partes` NÃO é do tipo `nested`, é objeto/array comum.
    // `match` direto em `partes.nome` é a forma correta (mesma que a API pública documenta).
    query = { match: { 'partes.nome': { query: nome_parte, fuzziness: 'AUTO' } } };
  } else {
    return { processos: [], total: 0, tribunais_consultados: [], erros: ['informe numero_processo ou nome_parte'], parecer: gerarParecerRisco([], { erros: ['sem critério de busca'], modalidade }) };
  }

  // Por UF: TJ da UF + TRF da região + TRT da região (12/09, ver TRT_MAP acima) + STJ
  // (+ TST quando há TRT). MG também consulta o trf1 (base legada anterior ao TRF6).
  // No modo nacional TODOS_TRIBUNAIS já cobre trf1..trf6 e trt1..trt24.
  const trfLegado = ufUp === 'MG' ? 'trf1' : null;
  const trtsUf = TRT_MAP[ufUp] || [];
  const tribunais = exatos.length ? [...exatos] : nacional ? [...TODOS_TRIBUNAIS]
    : [estadual, trf, trfLegado, ...trtsUf, trtsUf.length ? 'tst' : null, 'stj'].filter(Boolean);
  // Quando o NÚMERO do processo está disponível, o próprio número já diz a Justiça
  // (segmento J) e a região (segmento TR) — mais confiável que inferir pela UF do
  // imóvel (o executado pode ter ajuizado/ser executado em região diferente). Formato
  // CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos). J=5 → Justiça do Trabalho.
  if (numero_processo && !exatos.length) {
    const dig = String(numero_processo).replace(/\D/g, '');
    if (dig.length === 20 && dig[13] === '5') {
      const trtExato = `trt${parseInt(dig.slice(14, 16), 10)}`;
      if (!tribunais.includes(trtExato)) tribunais.push(trtExato);
      if (!tribunais.includes('tst')) tribunais.push('tst');
    }
  }
  const { processos: unique, erros } = await executarBuscaCNJ(tribunais, query);
  return { processos: unique, total: unique.length, tribunais_consultados: tribunais, erros: erros.length ? erros : undefined, parecer: gerarParecerRisco(unique, { erros, tribunais, numeroProcesso: numero_processo, modalidade }) };
}

/**
 * Processos de BUSCA E APREENSÃO / ALIENAÇÃO FIDUCIÁRIA de veículo, filtrados pelo nome do
 * credor (banco/financeira). Pedido do dono (20/09) — uso interno (admin/analista), só lista
 * pra revisão; não envia nada a ninguém.
 *
 * LIMITAÇÃO REAL do DataJud, documentada pra não vender o que a API não entrega: ele expõe
 * só METADADO do processo (partes, classe, assuntos, movimentos) — NUNCA o conteúdo da
 * petição. Placa, marca, modelo e ano do veículo NÃO existem em nenhum campo estruturado
 * aqui; só apareceriam dentro do PDF da petição inicial de cada processo, que este código não
 * lê (ler documento por tribunal é outro projeto — dezenas de sistemas diferentes, do
 * tamanho da frota de scrapers de leiloeiro que este repo já tem, e vários exigem
 * credencial de parte/OAB pra abrir o PDF mesmo sendo processo público). `valor_causa` é o
 * proxy mais próximo de "valor da dívida" que a API pública realmente entrega — normalmente
 * é o valor cobrado na ação, não necessariamente o saldo devedor atualizado.
 */
export async function buscarRetomadaVeiculos({ banco, uf, nacional = true }) {
  if (!CNJ_KEY) return { processos: [], total: 0, erros: ['CNJ_DATAJUD_KEY ausente'] };
  const bancoLimpo = String(banco || '').trim();
  if (!bancoLimpo) return { processos: [], total: 0, erros: ['informe o nome do banco/credor'] };
  const ufUp = String(uf || '').toUpperCase();
  const estadual = TRIBUNAL_ESTADUAL[ufUp];
  if (!nacional && !estadual) return { processos: [], total: 0, erros: [`UF inválida: ${uf}`] };
  const trf = TRF_MAP[ufUp];
  const trfLegado = ufUp === 'MG' ? 'trf1' : null;
  const trtsUf = TRT_MAP[ufUp] || [];
  const tribunais = nacional ? [...TODOS_TRIBUNAIS]
    : [estadual, trf, trfLegado, ...trtsUf, trtsUf.length ? 'tst' : null, 'stj'].filter(Boolean);

  // Mesma lição de nome_parte acima: `match` direto em `partes.nome`, nunca `nested` (o
  // mapping público não marca `partes` como nested). Filtro de assunto/classe em `should`
  // (qualquer um dos dois serve — tribunais diferentes classificam de formas diferentes).
  const query = {
    bool: {
      must: [
        { match: { 'partes.nome': { query: bancoLimpo, fuzziness: 'AUTO' } } },
        { bool: { should: [
          { match: { 'assuntos.nome': 'Alienação Fiduciária' } },
          { match: { 'classe.nome': 'Busca e Apreensão' } },
        ], minimum_should_match: 1 } },
      ],
    },
  };

  const { processos, erros } = await executarBuscaCNJ(tribunais, query);
  const resultado = processos.map(p => ({
    numero: p.numero, tribunal: p.tribunal, classe: p.classe, assuntos: p.assuntos,
    orgao: p.orgao, fase: p.fase, data_ajuizamento: p.data_ajuizamento,
    ultima_atualizacao: p.ultima_atualizacao, valor_causa: p.valor_causa,
    banco: p.partes.find(pp => /ativo/i.test(pp.tipo))?.nome || bancoLimpo,
    executado: p.partes.filter(pp => /passivo/i.test(pp.tipo)).map(pp => ({ nome: pp.nome, documento: pp.documento })),
    movimentos: p.movimentos.slice(0, 5),
  }));
  return { processos: resultado, total: resultado.length, tribunais_consultados: tribunais, erros: erros.length ? erros : undefined };
}

/**
 * Publicações do DJEN (Comunica API do CNJ) de um processo, pelo número CNJ. Sem token, fetch
 * direto (não passa pelo Bright Data). Movida de _admin-chat-tools.js em 24/09 para ser usada
 * também pelo andamento do caso (api/caso-andamento-cnj.js) — uma cópia só da regra.
 * Devolve { total, publicacoes[] } ou { erro } — nunca lista vazia no lugar de falha.
 */
export async function buscarDjen({ numero_processo, maxTexto = 1200 }) {
  const num = String(numero_processo || '').replace(/\D/g, '');
  if (!/^\d{15,25}$/.test(num)) return { erro: 'número de processo inválido — precisa do padrão CNJ (20 dígitos)' };
  const url = `https://comunicaapi.pje.jus.br/api/v1/comunicacao?numeroProcesso=${num}&itensPorPagina=30`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!r.ok) return { erro: `DJEN respondeu ${r.status}` };
    const data = await r.json();
    const items = data?.items || data?.content || data?.comunicacoes || [];
    if (!items.length) return { total: 0, publicacoes: [], observacao: 'Nenhuma publicação encontrada no DJEN para este processo (a base cobre a partir de 2022).' };
    // A mesma intimação sai uma vez por destinatário (16/09 veio duas vezes, idêntica): uma só basta.
    const vistos = new Set();
    const unicos = items.filter((it) => { const k = `${it.data_disponibilizacao || it.dataDisponibilizacao}|${String(it.texto || '').slice(0, 2000)}`; return !vistos.has(k) && vistos.add(k); });
    return {
      total: unicos.length,
      publicacoes: unicos.slice(0, 15).map((it) => ({
        data_disponibilizacao: it.data_disponibilizacao || it.dataDisponibilizacao || null,
        tribunal: it.siglaTribunal || it.sigla_tribunal || null,
        orgao: it.nomeOrgao || it.nome_orgao || null,
        tipo_documento: it.tipoDocumento || it.tipo_documento || null,
        texto: String(it.texto || it.texto_integral || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxTexto),
      })),
    };
  } catch (e) {
    return { erro: `falha ao consultar DJEN: ${e.message}` };
  } finally {
    clearTimeout(t);
  }
}
