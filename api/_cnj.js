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
  GO: 'trf1', MA: 'trf1', MG: 'trf1', MT: 'trf1', PA: 'trf1',
  PI: 'trf1', RO: 'trf1', RR: 'trf1', TO: 'trf1',
  ES: 'trf2', RJ: 'trf2',
  MS: 'trf3', SP: 'trf3',
  PR: 'trf4', RS: 'trf4', SC: 'trf4',
  AL: 'trf5', CE: 'trf5', PB: 'trf5', PE: 'trf5', RN: 'trf5', SE: 'trf5',
};

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

const FASES_RISCO = {
  'Execução': 'alto', 'Cumprimento de Sentença': 'alto', 'Execução Fiscal': 'alto',
  'Conhecimento': 'medio', 'Recurso': 'medio', 'Liquidação': 'medio', 'Cautelar': 'baixo',
};

async function buscarTribunal(tribunal, query) {
  try {
    const url = `${BASE_URL}/api_publica_${tribunal}/_search`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `APIKey ${CNJ_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ size: 10, query }),
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { hits: { hits: [], total: { value: 0 } }, _tribunal: tribunal, _erro: `HTTP ${res.status}` };
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

export function gerarParecerRisco(processos) {
  if (!processos.length) return { nivel: 'verde', texto: 'Nenhum processo encontrado nos tribunais consultados. Recomenda-se consulta adicional no cartório de registro de imóveis.' };
  const bloqueantes = processos.flatMap(p => p.riscos.filter(r => r.severidade === 'bloqueante'));
  const alertas = processos.flatMap(p => p.riscos.filter(r => r.severidade === 'alerta'));
  if (bloqueantes.length > 0) return { nivel: 'vermelho', texto: `OPERAÇÃO COM RISCO ALTO. ${bloqueantes.length} risco(s) bloqueante(s) em ${processos.length} processo(s): ${[...new Set(bloqueantes.map(r => r.categoria))].join(', ')}.`, recomendacao: 'Consulte advogado especializado antes do leilão.' };
  if (alertas.length > 0) return { nivel: 'amarelo', texto: `RISCOS A MONITORAR. ${alertas.length} alerta(s) em ${processos.length} processo(s): ${[...new Set(alertas.map(r => r.categoria))].join(', ')}.`, recomendacao: 'Monitore o andamento processual.' };
  return { nivel: 'verde', texto: `Consulta em ${processos.length} processo(s) sem riscos bloqueantes.`, recomendacao: 'Prossiga com a due diligence documental.' };
}

/**
 * Consulta o CNJ DataJud por número de processo OU por nome da parte, na UF dada.
 * Retorna { processos, total, tribunais_consultados, erros, parecer }.
 */
export async function buscarProcessosCNJ({ numero_processo, nome_parte, uf }) {
  if (!CNJ_KEY) return { processos: [], total: 0, tribunais_consultados: [], erros: ['CNJ_DATAJUD_KEY ausente'], parecer: gerarParecerRisco([]) };
  const ufUp = String(uf || '').toUpperCase();
  const estadual = TRIBUNAL_ESTADUAL[ufUp];
  const trf = TRF_MAP[ufUp];
  if (!estadual) return { processos: [], total: 0, tribunais_consultados: [], erros: [`UF inválida: ${uf}`], parecer: gerarParecerRisco([]) };

  let query;
  if (numero_processo) {
    const numLimpo = String(numero_processo).replace(/\D/g, '');
    query = { bool: { should: [{ match: { numeroProcesso: numero_processo } }, { match: { numeroProcesso: numLimpo } }], minimum_should_match: 1 } };
  } else if (nome_parte) {
    query = { nested: { path: 'partes', query: { match: { 'partes.nome': { query: nome_parte, fuzziness: 'AUTO' } } } } };
  } else {
    return { processos: [], total: 0, tribunais_consultados: [], erros: ['informe numero_processo ou nome_parte'], parecer: gerarParecerRisco([]) };
  }

  const tribunais = [estadual, trf, 'stj'].filter(Boolean);
  const resultados = await Promise.all(tribunais.map(t => buscarTribunal(t, query)));
  const processos = [];
  const erros = [];
  for (const r of resultados) {
    if (r._erro) erros.push(`${r._tribunal}: ${r._erro}`);
    for (const hit of (r.hits?.hits || [])) processos.push(formatarProcesso(hit, r._tribunal));
  }
  const unique = processos.filter((p, i, arr) => arr.findIndex(x => x.numero === p.numero) === i);
  unique.sort((a, b) => (a.tem_bloqueante === b.tem_bloqueante ? b.score_risco - a.score_risco : a.tem_bloqueante ? -1 : 1));
  return { processos: unique, total: unique.length, tribunais_consultados: tribunais, erros: erros.length ? erros : undefined, parecer: gerarParecerRisco(unique) };
}
