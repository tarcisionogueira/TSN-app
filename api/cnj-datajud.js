import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
/**
 * API CNJ DataJud — consulta jurídica completa para segurança da operação
 * Busca em tribunal estadual + TRF da região + STJ/STF
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/endpoints
 */

const CNJ_KEY = process.env.CNJ_DATAJUD_KEY;
const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';

// Tribunais estaduais por UF
const TRIBUNAL_ESTADUAL = {
  SP: 'tjsp', RJ: 'tjrj', MG: 'tjmg', RS: 'tjrs', PR: 'tjpr',
  SC: 'tjsc', BA: 'tjba', GO: 'tjgo', PE: 'tjpe', CE: 'tjce',
  ES: 'tjes', MA: 'tjma', PA: 'tjpa', PB: 'tjpb', RN: 'tjrn',
  MT: 'tjmt', MS: 'tjms', PI: 'tjpi', AL: 'tjal', SE: 'tjse',
  TO: 'tjto', DF: 'tjdft', AC: 'tjac', AM: 'tjam', AP: 'tjap',
  RO: 'tjro', RR: 'tjrr',
};

// TRF por UF
const TRF_MAP = {
  AC: 'trf1', AM: 'trf1', AP: 'trf1', BA: 'trf1', DF: 'trf1',
  GO: 'trf1', MA: 'trf1', MG: 'trf1', MT: 'trf1', PA: 'trf1',
  PI: 'trf1', RO: 'trf1', RR: 'trf1', TO: 'trf1',
  ES: 'trf2', RJ: 'trf2',
  MS: 'trf3', SP: 'trf3',
  PR: 'trf4', RS: 'trf4', SC: 'trf4',
  AL: 'trf5', CE: 'trf5', PB: 'trf5', PE: 'trf5', RN: 'trf5', SE: 'trf5',
};

// Palavras-chave de risco mapeadas a severidade e categoria
const RISCOS_MAP = [
  // BLOQUEANTES — impedem ou comprometem a arrematação
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

  // ALERTAS — riscos relevantes que merecem investigação
  { regex: /recurso\s+(?:especial|extraordin[aá]rio|de\s+apela[çc][aã]o)/i, severidade: 'alerta', categoria: 'Recurso Pendente', descricao: 'Recurso pendente de julgamento' },
  { regex: /ação\s+(?:revis?ional|anulatória|rescis[oó]ria)/i, severidade: 'alerta', categoria: 'Ação Anulatória', descricao: 'Ação anulatória ou revisional em curso' },
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

// Fases processuais com interpretação de risco
const FASES_RISCO = {
  'Execução': 'alto',
  'Cumprimento de Sentença': 'alto',
  'Execução Fiscal': 'alto',
  'Conhecimento': 'medio',
  'Recurso': 'medio',
  'Liquidação': 'medio',
  'Cautelar': 'baixo',
};

async function buscarTribunal(tribunal, query) {
  try {
    const url = `${BASE_URL}/api_publica_${tribunal}/_search`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `APIKey ${CNJ_KEY}`,
        'Content-Type': 'application/json',
      },
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
    if (regra.regex.test(textos)) {
      if (!riscos.find(r => r.categoria === regra.categoria)) {
        riscos.push({ severidade: regra.severidade, categoria: regra.categoria, descricao: regra.descricao });
      }
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

function extrairValorCausa(processo) {
  // Tenta extrair valor da causa de campos conhecidos
  return processo.valorCausa || processo.valor || null;
}

function formatarProcesso(hit, tribunal) {
  const s = hit._source || {};
  const riscos = analisarRiscos(s);
  const { fase, risco: nivelRisco } = detectarFase(s);
  const valorCausa = extrairValorCausa(s);

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
    nome: p.nome || '',
    tipo: p.polo || '',
    documento: p.cpf || p.cnpj || '',
    advogados: (p.advogados || []).map(a => ({ nome: a.nome || '', oab: a.numeroInscricao || '' })),
  }));

  // Score de risco: 0-100
  const bloqueantes = riscos.filter(r => r.severidade === 'bloqueante').length;
  const alertas = riscos.filter(r => r.severidade === 'alerta').length;
  const scoreRisco = Math.min(100, bloqueantes * 35 + alertas * 15);

  return {
    id: hit._id,
    tribunal: tribunal.toUpperCase(),
    numero: s.numeroProcesso || '',
    classe: s.classe?.nome || '',
    assuntos: (s.assuntos || []).map(a => a.nome).join('; '),
    orgao: s.orgaoJulgador?.nome || '',
    grau: s.grau || '',
    fase,
    nivel_risco: nivelRisco,
    data_ajuizamento: s.dataAjuizamento?.split('T')[0] || '',
    ultima_atualizacao: s.dataHoraUltimaAtualizacao?.split('T')[0] || '',
    valor_causa: valorCausa,
    partes,
    movimentos,
    riscos,
    score_risco: scoreRisco,
    // Flags rápidas
    tem_penhora: riscos.some(r => r.categoria === 'Penhora'),
    tem_arresto: riscos.some(r => r.categoria === 'Arresto'),
    tem_leilao: riscos.some(r => r.categoria === 'Hasta Pública'),
    tem_bloqueante: bloqueantes > 0,
  };
}

function gerarParecerRisco(processos) {
  if (!processos.length) return { texto: 'Nenhum processo encontrado nos tribunais consultados. Recomenda-se consulta adicional no cartório de registro de imóveis.', nivel: 'verde' };

  const bloqueantes = processos.flatMap(p => p.riscos.filter(r => r.severidade === 'bloqueante'));
  const alertas = processos.flatMap(p => p.riscos.filter(r => r.severidade === 'alerta'));
  const scoreMax = Math.max(...processos.map(p => p.score_risco));

  if (bloqueantes.length > 0) {
    return {
      nivel: 'vermelho',
      texto: `OPERAÇÃO COM RISCO ALTO. Encontrados ${bloqueantes.length} risco(s) bloqueante(s) em ${processos.length} processo(s): ${[...new Set(bloqueantes.map(r => r.categoria))].join(', ')}. Recomenda-se análise jurídica especializada antes de qualquer arrematação.`,
      recomendacao: 'Consulte advogado especializado em direito imobiliário e execuções antes de participar do leilão.',
    };
  }
  if (alertas.length > 0) {
    return {
      nivel: 'amarelo',
      texto: `OPERAÇÃO COM RISCOS A MONITORAR. ${alertas.length} alerta(s) identificado(s) em ${processos.length} processo(s): ${[...new Set(alertas.map(r => r.categoria))].join(', ')}. Riscos não impedem a arrematação mas exigem acompanhamento.`,
      recomendacao: 'Monitore o andamento processual e inclua cláusula de ressarcimento no planejamento financeiro.',
    };
  }
  return {
    nivel: 'verde',
    texto: `Consulta em ${processos.length} processo(s) não identificou riscos bloqueantes. A operação apresenta viabilidade jurídica preliminar favorável. Confirme junto ao cartório de registro de imóveis.`,
    recomendacao: 'Prossiga com a due diligence documental (certidão de matrícula atualizada e certidões negativas).',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIP(req);
  const rl = checkRateLimit(`cnj-datajud:${ip}`, 20, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { numero_processo, nome_parte, uf } = req.body || {};

  if (!numero_processo && !nome_parte) return res.status(400).json({ error: 'Informe numero_processo ou nome_parte' });
  if (!uf) return res.status(400).json({ error: 'UF obrigatório' });

  const estadual = TRIBUNAL_ESTADUAL[uf?.toUpperCase()];
  const trf = TRF_MAP[uf?.toUpperCase()];

  if (!estadual) return res.status(400).json({ error: `UF inválida: ${uf}` });

  // Monta query
  let query;
  if (numero_processo) {
    const numLimpo = numero_processo.replace(/\D/g, '');
    query = {
      bool: {
        should: [
          { match: { numeroProcesso: numero_processo } },
          { match: { numeroProcesso: numLimpo } },
        ],
        minimum_should_match: 1,
      },
    };
  } else {
    query = {
      nested: {
        path: 'partes',
        query: { match: { 'partes.nome': { query: nome_parte, fuzziness: 'AUTO' } } },
      },
    };
  }

  try {
    // Busca em paralelo: tribunal estadual + TRF + STJ
    const tribunais = [estadual, trf, 'stj'].filter(Boolean);
    const resultados = await Promise.all(tribunais.map(t => buscarTribunal(t, query)));

    const processos = [];
    const erros = [];

    for (const resultado of resultados) {
      if (resultado._erro) erros.push(`${resultado._tribunal}: ${resultado._erro}`);
      const hits = resultado.hits?.hits || [];
      for (const hit of hits) {
        processos.push(formatarProcesso(hit, resultado._tribunal));
      }
    }

    // Remove duplicatas pelo número do processo
    const unique = processos.filter((p, i, arr) => arr.findIndex(x => x.numero === p.numero) === i);

    // Ordena: bloqueantes primeiro, depois por score
    unique.sort((a, b) => {
      if (a.tem_bloqueante && !b.tem_bloqueante) return -1;
      if (!a.tem_bloqueante && b.tem_bloqueante) return 1;
      return b.score_risco - a.score_risco;
    });

    const parecer = gerarParecerRisco(unique);

    return res.status(200).json({
      processos: unique,
      total: unique.length,
      tribunais_consultados: tribunais,
      erros: erros.length ? erros : undefined,
      parecer,
    });
  } catch (err) {
    console.error('CNJ DataJud erro:', err.message);
    return res.status(500).json({ error: 'Erro interno na consulta CNJ' });
  }
}
