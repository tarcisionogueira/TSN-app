/**
 * POST /api/processar-analise
 * Orquestra a análise completa de um caso de leilão.
 *
 * Fluxo:
 *  1. Carrega o caso + imóvel.
 *  2. Lê os documentos anexados ao caso (imovel_anexos tipo matricula|edital).
 *  3. IA (Claude) extrai de cada documento: averbações/ônus, CPF/CNPJ do
 *     executado, nº do processo, origem.
 *  4. Judicial: cruza o CPF/CNPJ do executado com sanções CEIS/CNEP
 *     (RPC consultar_sancoes). [DataJud por processo entra na próxima iteração.]
 *  5. Calcula score jurídico (heurística sobre gravames + sanções + processo)
 *     e score financeiro (desconto/modalidade).
 *  6. Gera parecer consolidado em markdown e grava em analise_relatorios;
 *     atualiza os scores em imoveis_leilao.
 *
 * Acesso: equipe (analista/advogado/admin).
 * Body: { caso_id }   — os PDFs vêm de imovel_anexos do caso.
 *
 * Observação: a obtenção dos documentos é manual (upload). A matrícula da
 * Caixa não tem URL direta; o analista baixa no portal e anexa ao caso.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { getUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY || process.env.ANTHROPIC_API_KEY;
const MODEL_FAST   = 'claude-haiku-4-5-20251001';
const MODEL        = 'claude-sonnet-4-6';
const ROLES_STAFF  = ['analista', 'advogado', 'admin'];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function claude({ model, system, messages, max_tokens = 2048 }) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens, system, messages }),
  });
  if (!resp.ok) throw new Error(`Claude ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  return data?.content?.[0]?.text || '';
}

function parseJSON(t) {
  try { return JSON.parse(String(t).replace(/```json|```/g, '').trim()); } catch { return null; }
}

const INSTRUCAO = `Analise o documento (edital ou matrícula de imóvel em leilão) e extraia em JSON:
{
  "riscos": ["liste TODOS os gravames, ônus, penhoras, hipotecas, usufrutos, indisponibilidades, alienações fiduciárias e averbações restritivas encontrados no texto"],
  "executado_nome": "nome do executado/proprietário que está perdendo o imóvel, ou null",
  "executado_cpf_cnpj": "CPF ou CNPJ do executado (apenas dígitos), ou null",
  "numero_processo": "número do processo judicial (padrão CNJ) se houver, ou null",
  "origem": "judicial|extrajudicial",
  "observacoes": "outras informações jurídicas relevantes (máx 500 caracteres)"
}
Retorne APENAS o JSON, sem markdown.`;

// Extrai dados jurídicos de um anexo (PDF) via Claude
async function extrairDoc(anexo) {
  let content;
  try {
    const r = await fetch(anexo.url);
    if (!r.ok) throw new Error(`download ${r.status}`);
    const b64 = Buffer.from(await r.arrayBuffer()).toString('base64');
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
      { type: 'text', text: INSTRUCAO },
    ];
  } catch {
    // fallback: envia a URL diretamente ao modelo
    content = [
      { type: 'document', source: { type: 'url', url: anexo.url } },
      { type: 'text', text: INSTRUCAO },
    ];
  }
  const txt = await claude({
    model: MODEL_FAST,
    max_tokens: 2048,
    system: 'Extraia dados jurídicos de documentos imobiliários de leilão. Responda apenas JSON válido.',
    messages: [{ role: 'user', content }],
  });
  return parseJSON(txt) || {};
}

function calcularScoreJuridico({ riscos, sancoes, temProcesso }) {
  let score = 100;
  score -= (riscos?.length || 0) * 12;   // cada gravame/ônus encontrado
  score -= (sancoes?.length || 0) * 10;  // cada sanção CEIS/CNEP do executado
  if (temProcesso) score -= 8;           // existência de processo judicial
  return Math.max(0, Math.min(100, Math.round(score)));
}

function calcularScoreFinanceiro(imovel) {
  const desc = Number(imovel?.desconto_percentual) || 0;
  let s = 50 + Math.min(desc * 0.6, 60);
  if (imovel?.modalidade === 'extrajudicial') s += 5;
  if (imovel?.modalidade === 'judicial') s -= 10;
  if (imovel?.tipo === 'terreno') s -= 5;
  if (imovel?.tipo === 'apartamento' || imovel?.tipo === 'casa') s += 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await getUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !ROLES_STAFF.includes(perfil.role)) {
    return new Response(JSON.stringify({ error: 'Apenas a equipe pode gerar a análise.' }), { status: 403 });
  }
  if (!CLAUDE_KEY) return new Response(JSON.stringify({ error: 'IA não configurada (CLAUDE_KEY)' }), { status: 500 });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 }); }
  const { caso_id } = body;
  if (!caso_id) return new Response(JSON.stringify({ error: 'caso_id obrigatório' }), { status: 400 });

  const secoesFaltando = [];

  // 1. Caso + imóvel
  const [caso] = await (await sb(`casos?id=eq.${encodeURIComponent(caso_id)}&select=id,imovel_id,cliente_id`)).json();
  if (!caso) return new Response(JSON.stringify({ error: 'Caso não encontrado' }), { status: 404 });
  const [imovel] = caso.imovel_id
    ? await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(caso.imovel_id)}&select=*`)).json()
    : [null];

  // 2. Documentos anexados (matrícula/edital)
  const anexos = await (await sb(`imovel_anexos?caso_id=eq.${encodeURIComponent(caso_id)}&tipo=in.(matricula,edital)&select=id,tipo,url,nome`)).json();
  if (!Array.isArray(anexos) || anexos.length === 0) {
    return new Response(JSON.stringify({ error: 'Anexe a matrícula e/ou o edital ao caso antes de gerar a análise.' }), { status: 422 });
  }

  // 3. Extração por IA
  let riscos = [];
  let executadoDoc = null, executadoNome = null, numeroProcesso = null;
  const obs = [];
  for (const a of anexos) {
    try {
      const d = await extrairDoc(a);
      if (Array.isArray(d.riscos)) riscos.push(...d.riscos);
      if (!executadoDoc && d.executado_cpf_cnpj) executadoDoc = String(d.executado_cpf_cnpj).replace(/\D/g, '') || null;
      if (!executadoNome && d.executado_nome) executadoNome = d.executado_nome;
      if (!numeroProcesso && d.numero_processo) numeroProcesso = d.numero_processo;
      if (d.observacoes) obs.push(`(${a.tipo}) ${d.observacoes}`);
    } catch {
      secoesFaltando.push(`extracao_${a.tipo}`);
    }
  }
  riscos = [...new Set(riscos.filter(Boolean))];

  // 4. Judicial — sanções CEIS/CNEP pelo CPF/CNPJ do executado
  let sancoes = [];
  if (executadoDoc) {
    try {
      const r = await sb('rpc/consultar_sancoes', { method: 'POST', body: JSON.stringify({ p_doc: executadoDoc }) });
      const j = await r.json();
      sancoes = Array.isArray(j) ? j : [];
    } catch {
      secoesFaltando.push('sancoes');
    }
  } else {
    secoesFaltando.push('executado_nao_identificado');
  }

  // 5. Scores
  const scoreJuridico = calcularScoreJuridico({ riscos, sancoes, temProcesso: !!numeroProcesso });
  const scoreFinanceiro = calcularScoreFinanceiro(imovel);

  // 6. Parecer consolidado
  const dados = {
    imovel: imovel ? {
      titulo: imovel.titulo, endereco: imovel.endereco, cidade: imovel.cidade, estado: imovel.estado,
      valor_minimo: imovel.valor_minimo, valor_avaliacao: imovel.valor_avaliacao,
      desconto_percentual: imovel.desconto_percentual, modalidade: imovel.modalidade, tipo: imovel.tipo,
    } : null,
    executado: { nome: executadoNome, cpf_cnpj: executadoDoc },
    numero_processo: numeroProcesso,
    riscos, sancoes,
    score_juridico: scoreJuridico, score_financeiro: scoreFinanceiro,
  };

  let parecerMd = '';
  try {
    parecerMd = await claude({
      model: MODEL,
      max_tokens: 3000,
      system: 'Você é um analista jurídico de leilões de imóveis no Brasil. Gere um parecer claro e objetivo em MARKDOWN (pt-BR) com as seções: ## Resumo, ## Análise Documental (averbações/ônus da matrícula e do edital), ## Análise Judicial (executado, processo, sanções CEIS/CNEP), ## Recomendação. Seja direto, prático e prudente. Não invente dados que não estejam no JSON.',
      messages: [{ role: 'user', content: `Dados coletados (JSON):\n\n${JSON.stringify(dados, null, 2)}\n\nObservações extraídas dos documentos:\n${obs.join('\n') || '—'}` }],
    });
  } catch {
    secoesFaltando.push('parecer');
    parecerMd = `## Parecer (parcial)\nNão foi possível gerar o parecer automático no momento.\n\n- **Gravames/ônus:** ${riscos.join('; ') || '—'}\n- **Sanções CEIS/CNEP:** ${sancoes.length}\n- **Score jurídico:** ${scoreJuridico}/100`;
  }

  const incompleto = secoesFaltando.length > 0;

  // 7. Persiste relatório (upsert por caso/tipo/versão) + scores
  await sb('analise_relatorios?on_conflict=caso_id,tipo,versao', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      caso_id, tipo: 'juridica_preliminar', versao: 1,
      conteudo_md: parecerMd, conteudo_json: dados,
      gerado_por_modelo: MODEL, incompleto, secoes_faltando: secoesFaltando,
    }),
  }).catch(() => {});

  if (imovel?.id) {
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovel.id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ score_juridico: scoreJuridico, score_financeiro: scoreFinanceiro }),
    }).catch(() => {});
  }

  return new Response(JSON.stringify({
    ok: true,
    score_juridico: scoreJuridico,
    score_financeiro: scoreFinanceiro,
    executado: executadoNome,
    executado_cpf_cnpj: executadoDoc,
    numero_processo: numeroProcesso,
    riscos,
    sancoes_encontradas: sancoes.length,
    incompleto,
    secoes_faltando: secoesFaltando,
    parecer_md: parecerMd,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
