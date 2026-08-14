/**
 * GET/POST /api/indice-aprendizado-cron — fecha o loop de precisão do Índice BidPro.
 *   (3) RECÊNCIA: consolida o índice (nível cidade) a partir das amostras DATADAS
 *       recentes (indice_consolidar_amostras) — dado velho deixa de dominar.
 *   (4) CALIBRAÇÃO: ajusta fator_calibracao comparando a REVENDA real com o índice
 *       (indice_calibrar). Sem gabarito de revenda, não mexe em nada.
 *   (+) SUPERVISOR (opcional, Gemini): lê anomalias/vícios recentes + regiões calibradas
 *       e ESCREVE uma sugestão de ajuste (aprendizado_sugestoes) para o DONO revisar.
 *       Nunca altera prompt sozinho. Dormente sem GEMINI_API_KEY.
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { geminiFetch } from './_gemini.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
}
async function rpc(name, body) {
  const r = await sb(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body || {}) });
  return r.ok ? r.json().catch(() => null) : null;
}
async function get(path) { const r = await sb(path); return r.ok ? r.json().catch(() => []) : []; }

// Supervisor: monta um resumo dos sinais da semana e pede ao Gemini 2-4 sugestões
// CONCRETAS de ajuste de prompt/regra. Só grava se houver o que revisar e sem repetir
// em <6 dias. Best-effort: nunca quebra o cron.
async function supervisor() {
  if (!process.env.GEMINI_API_KEY) return { rodou: false, motivo: 'sem GEMINI_API_KEY' };
  try {
    const ultimas = await get('aprendizado_sugestoes?select=criado_em&order=criado_em.desc&limit=1');
    if (ultimas?.[0]?.criado_em && (Date.now() - Date.parse(ultimas[0].criado_em)) < 6 * 86400000) {
      return { rodou: false, motivo: 'sugestão recente (<6d)' };
    }
    const desde = new Date(Date.now() - 7 * 86400000).toISOString();
    const [anomalias, qualidade, calibradas] = await Promise.all([
      get(`relatorio_anomalias?select=tipo&criado_em=gte.${desde}`),
      get(`agente_aprendizado?select=agente,qualidade&criado_em=gte.${desde}&limit=500`),
      get('cidade_indicadores?select=cidade_norm,uf,fator_calibracao&fator_calibracao=neq.1&limit=50'),
    ]);
    // Agrega os sinais (contagens) — poison-resistente, sem PII.
    const contAnom = {};
    for (const a of (anomalias || [])) contAnom[a.tipo] = (contAnom[a.tipo] || 0) + 1;
    const contVicio = {};
    for (const q of (qualidade || [])) for (const [k, v] of Object.entries(q.qualidade || {})) if (v === true) contVicio[k] = (contVicio[k] || 0) + 1;

    const temSinal = Object.keys(contAnom).length || Object.keys(contVicio).length || (calibradas || []).length;
    if (!temSinal) return { rodou: false, motivo: 'sem sinais na semana' };

    // ═══ O SUPERVISOR PRECISA SABER O QUE CADA VÍCIO SIGNIFICA (14/08) ═══════════════════
    // Até aqui ele recebia só os NOMES dos vícios com as contagens (`edital_nao_lido: 5`) e,
    // sem saber o que são, supunha o óbvio: que a IA não estava lendo o edital. As quatro
    // revisões semanais de 23/07 a 11/08 propuseram, todas, mudanças de PROMPT. Nenhuma
    // resolveria nada, porque nenhum desses vícios é causado pelo prompt:
    //   • edital_nao_lido / matricula_nao_lida = `!da.edital` / `!da.matricula` — o documento
    //     não estava disponível para ler (o leiloeiro não publicou, ou a captura falhou);
    //   • cnj_nao_consultado = há número de processo e a consulta ao CNJ não voltou;
    //   • avaliacao_ausente / minimo_ausente = o LOTE não tem esses valores na nossa base;
    //   • sem_parecer = a geração estourou a reserva de 55s e o parecer não chegou a rodar;
    //   • mercado_vazio = a pesquisa não achou amostras na praça.
    // Pedir ao modelo "melhore o prompt" diante disso produz texto plausível e inútil — e
    // pior, texto que PARECE ter resolvido. Agora ele recebe a legenda e a alavanca de cada
    // sinal, e é obrigado a classificar cada sugestão pela alavanca certa.
    const LEGENDA = {
      edital_nao_lido: { significa: 'o edital não estava disponível para leitura (leiloeiro não publicou ou a captura falhou)', alavanca: 'captura' },
      matricula_nao_lida: { significa: 'a matrícula não estava disponível para leitura', alavanca: 'captura' },
      cnj_nao_consultado: { significa: 'o lote tem número de processo, mas a consulta ao CNJ não retornou', alavanca: 'integracao' },
      modalidade_indefinida: { significa: 'o lote está sem modalidade na base', alavanca: 'captura' },
      avaliacao_ausente: { significa: 'o lote não tem valor de avaliação na nossa base', alavanca: 'captura' },
      minimo_ausente: { significa: 'o lote não tem lance mínimo na nossa base', alavanca: 'captura' },
      mercado_vazio: { significa: 'a pesquisa de comparáveis não achou amostras na praça', alavanca: 'pesquisa' },
      sem_parecer: { significa: 'a geração estourou o orçamento de tempo e o parecer não rodou', alavanca: 'orcamento' },
      tem_contradicoes: { significa: 'o laudo se contradiz entre seções', alavanca: 'prompt' },
      tem_lacunas_criticas: { significa: 'o laudo saiu com lacuna crítica declarada', alavanca: 'prompt' },
      recomenda_revisao: { significa: 'o laudo pediu revisão humana', alavanca: 'prompt' },
    };
    const legendaDosSinais = Object.fromEntries(
      Object.keys(contVicio).map((k) => [k, LEGENDA[k] || { significa: '(sinal novo, sem legenda)', alavanca: 'desconhecida' }]));
    const resumoSinais = JSON.stringify({ anomalias: contAnom, vicios: contVicio, regioes_calibradas: (calibradas || []).length });
    const prompt = `Você é um supervisor de qualidade dos relatórios imobiliários da BidPro. Recebe os SINAIS agregados da última semana (contagens, sem dados pessoais) e a LEGENDA de cada sinal, com a ALAVANCA que de fato o corrige.

REGRA MAIS IMPORTANTE: só proponha mudança de PROMPT para sinal cuja alavanca é "prompt". Para os demais, a correção é de captura de documento, de integração externa, de orçamento de tempo ou de pesquisa — e um ajuste de prompt ali NÃO resolve nada, só produz texto que parece solução. Nesses casos, descreva a correção na alavanca certa (o que instrumentar, medir ou corrigir fora do prompt).

Proponha de 2 a 4 ajustes CONCRETOS e acionáveis. Se um sinal alto não tiver correção possível pela nossa mão, diga isso em vez de inventar ação.

Responda em JSON: {"sugestoes":[{"titulo":"","alavanca":"prompt|captura|integracao|orcamento|pesquisa","acao":"","porque":""}]}.

SINAIS: ${resumoSinais}

LEGENDA: ${JSON.stringify(legendaDosSinais)}`;

    // `max_tokens` subiu de 1200 para 6000: o Gemini 2.5 Flash gasta orçamento de saída com
    // RACIOCÍNIO, e o que sobrava para a resposta cortava o JSON no meio. As quatro sugestões
    // gravadas até hoje têm 147 a 298 caracteres e todas terminam no meio de uma frase — e
    // como o `JSON.parse` falhava, caíam no ramo `bruto`, que é o ramo de ERRO. Ou seja: as
    // quatro "sugestões" do histórico são, na verdade, quatro falhas de parse guardadas como
    // se fossem conteúdo.
    const resp = await geminiFetch({ method: 'POST', body: JSON.stringify({
      system: 'Responda só JSON válido, em português, sem markdown.',
      messages: [{ role: 'user', content: prompt }], max_tokens: 6000,
    }) }, { timeoutMs: 40000 });
    if (!resp) return { rodou: false, motivo: 'gemini indisponível' };
    const data = await resp.json().catch(() => null);
    const texto = data?.content?.[0]?.text || '';
    // Falha de parse não pode mais se disfarçar de sugestão. Grava com `__falhou` e o motivo,
    // para a tela do Admin distinguir "o supervisor propôs isto" de "o supervisor não
    // conseguiu responder" — que é a diferença entre revisar e perder tempo.
    let detalhe = null;
    try {
      detalhe = JSON.parse(texto.replace(/```json|```/g, '').trim());
      if (!Array.isArray(detalhe?.sugestoes) || !detalhe.sugestoes.length) {
        detalhe = { __falhou: 'JSON sem lista de sugestões', bruto: texto.slice(0, 4000) };
      }
    } catch {
      detalhe = { __falhou: 'resposta não é JSON válido (provável corte por limite de tokens)', bruto: texto.slice(0, 4000) };
    }
    const falhou = !!detalhe?.__falhou;

    await sb('aprendizado_sugestoes', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        escopo: 'mercadologico',
        resumo: falhou
          ? `Revisão semanal FALHOU — ${detalhe.__falhou}`
          : `Revisão semanal (${Object.keys(contAnom).length} tipos de anomalia, ${Object.keys(contVicio).length} vícios)`,
        detalhe: { sinais: { anomalias: contAnom, vicios: contVicio }, legenda: legendaDosSinais, sugestoes: detalhe },
      }),
    });
    return { rodou: true, falhou };
  } catch (e) { return { rodou: false, motivo: e?.message }; }
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });

  const consolidadas = await rpc('indice_consolidar_amostras', {});
  const calibradas   = await rpc('indice_calibrar', {});
  const sup          = await supervisor();

  return new Response(JSON.stringify({
    ok: true,
    cidades_consolidadas: Number.isFinite(+consolidadas) ? +consolidadas : consolidadas,
    regioes_calibradas:   Number.isFinite(+calibradas) ? +calibradas : calibradas,
    supervisor: sup,
  }), { headers: { 'Content-Type': 'application/json' } });
}
