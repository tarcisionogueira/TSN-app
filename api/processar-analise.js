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
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { urlDocumento } from './_storage.js';
import { buscarProcessosCNJ } from './_cnj.js';
import { consultarComunicaDJEN, consultarCNDT, consultarCNIB, consultarProtestos } from './_laudo-fontes.js';
import { anthropicFetch } from './_claude.js';

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
  const resp = await anthropicFetch({
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

const INSTRUCAO = `Analise o documento (edital, regras de venda direta ou matrícula de imóvel em leilão) e extraia em JSON:
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

function calcularScoreJuridico({ riscos, sancoes, temProcesso, processosCNJ = [] }) {
  let score = 100;
  score -= (riscos?.length || 0) * 12;   // cada gravame/ônus encontrado
  score -= (sancoes?.length || 0) * 10;  // cada sanção CEIS/CNEP do executado
  if (temProcesso) score -= 8;           // existência de processo judicial
  // Ações do devedor que podem suspender/anular/atrasar o leilão
  if (processosCNJ.some(p => p.tem_suspensiva)) score -= 25;
  score -= processosCNJ.filter(p => p.tem_bloqueante).length * 15;
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !ROLES_STAFF.includes(perfil.role)) {
    return res.status(403).json({ error: 'Apenas a equipe pode gerar a análise.' });
  }
  if (!CLAUDE_KEY) return res.status(500).json({ error: 'IA não configurada (CLAUDE_KEY)' });

  const body = req.body || {};
  const { caso_id } = body;
  if (!caso_id) return res.status(400).json({ error: 'caso_id obrigatório' });

  const secoesFaltando = [];

  // 1. Caso + imóvel
  const [caso] = await (await sb(`casos?id=eq.${encodeURIComponent(caso_id)}&select=id,imovel_id,cliente_id`)).json();
  if (!caso) return res.status(404).json({ error: 'Caso não encontrado' });
  const [imovel] = caso.imovel_id
    ? await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(caso.imovel_id)}&select=*`)).json()
    : [null];

  // 2. Documentos anexados ao IMÓVEL (matrícula/edital) — imovel_anexos é por
  //    imovel_id (compartilhado entre casos), NÃO por caso_id (coluna inexistente).
  let anexos = caso.imovel_id
    ? await (await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(caso.imovel_id)}&tipo=in.(matricula,edital,regras_venda)&storage_path=not.is.null&select=id,tipo,url,nome,storage_path`)).json()
    : [];
  if (!Array.isArray(anexos)) anexos = [];
  // Assina cada documento SOB DEMANDA (curta duração) — não usa link de 1 ano.
  for (const a of anexos) a.url = await urlDocumento(a);
  // Fallback (leiloeiros): sem anexo no storage, usa o edital/regras PÚBLICOS do
  // próprio imóvel (URL real, não a matricula.asp da Caixa que exige sessão).
  if (anexos.length === 0) {
    const ehUrlPub = v => typeof v === 'string' && /^https?:\/\//i.test(v) && !/matricula\.asp|detalhe-imovel\.asp/i.test(v);
    const pub = [];
    if (ehUrlPub(imovel?.link_edital)) pub.push({ tipo: 'edital', url: imovel.link_edital, nome: 'Edital' });
    if (ehUrlPub(imovel?.link_regras_venda)) pub.push({ tipo: 'regras_venda', url: imovel.link_regras_venda, nome: 'Regras de venda' });
    if (pub.length) anexos = pub;
  }
  if (anexos.length === 0) {
    // Imóvel da Caixa sem documento anexado → enfileira captura automática da
    // matrícula (GitHub Actions/Puppeteer); a análise é gerada quando ela chegar.
    const ehCEF = /caixa|cef/i.test(imovel?.fonte || '');
    const hdniip = (String(imovel?.link_matricula || '').match(/hdniip=(\d+)/) || [])[1] || String(imovel?.fonte_id || '').replace(/\D/g, '');
    if (ehCEF && hdniip) {
      await sb('cef_matricula_fila?on_conflict=imovel_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ imovel_id: imovel.id, hdniip, caso_id, status: 'pendente' }),
      }).catch(() => {});
      return res.status(202).json({ error: 'Buscando a matrícula automaticamente na Caixa. Tente gerar a análise novamente em alguns minutos.', captura_enfileirada: true });
    }
    return res.status(422).json({ error: 'Anexe a matrícula e/ou o edital ao caso antes de gerar a análise.' });
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

  // 4b. CNJ DataJud — busca processual abrangente.
  //  - judicial: pelo nº do processo do edital;
  //  - extrajudicial (ou sem nº): pelo NOME do devedor, para detectar ações
  //    tentando suspender/anular/atrasar o leilão (anulatória, embargos, tutela,
  //    consignação, liminar, nulidade do leilão...).
  let processosCNJ = [];
  let parecerCNJ = null;
  const ehExtrajudicial = imovel?.modalidade === 'extrajudicial';
  const uf = imovel?.estado;
  const tarefasCNJ = [];
  // Por número: o tribunal está embutido no nº CNJ — basta a UF (barato).
  if (numeroProcesso) tarefasCNJ.push(buscarProcessosCNJ({ numero_processo: numeroProcesso, uf, nacional: !uf }));
  // Por nome do devedor: varredura NACIONAL (pega ações em qualquer estado/justiça).
  if ((ehExtrajudicial || !numeroProcesso) && executadoNome) tarefasCNJ.push(buscarProcessosCNJ({ nome_parte: executadoNome, uf, nacional: true }));
  if (tarefasCNJ.length) {
    try {
      const resCNJ = await Promise.all(tarefasCNJ);
      const todos = resCNJ.flatMap(r => r?.processos || []);
      processosCNJ = todos.filter((p, i, a) => a.findIndex(x => x.numero === p.numero) === i);
      parecerCNJ = resCNJ.map(r => r?.parecer).filter(Boolean).sort((a, b) =>
        ({ vermelho: 0, amarelo: 1, verde: 2 }[a.nivel] - { vermelho: 0, amarelo: 1, verde: 2 }[b.nivel]))[0] || null;
    } catch { secoesFaltando.push('cnj_datajud'); }
  } else if (ehExtrajudicial && !executadoNome) {
    secoesFaltando.push('cnj_devedor_nao_identificado');
  }
  const riscoSuspensao = processosCNJ.some(p => p.tem_suspensiva);
  // Resumo enxuto para o relatório/e-mail (evita JSON gigante)
  const processosResumo = processosCNJ.slice(0, 12).map(p => ({
    numero: p.numero, tribunal: p.tribunal, classe: p.classe, assuntos: p.assuntos,
    fase: p.fase, data_ajuizamento: p.data_ajuizamento, nivel_risco: p.nivel_risco,
    categorias_risco: [...new Set((p.riscos || []).map(r => r.categoria))],
    tem_suspensiva: p.tem_suspensiva, tem_bloqueante: p.tem_bloqueante,
  }));

  // 4c. Fontes públicas complementares (gratuitas). Instabilidade → fila 48h
  //     (analise_pendencias), reprocessada pelo /api/laudo-retry-cron.
  const enfileirar48h = async (secao, alvo, erro) => {
    try {
      await sb('analise_pendencias?on_conflict=caso_id,secao', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ caso_id, imovel_id: imovel?.id || null, secao, alvo, status: 'pendente', ultimo_erro: erro || null, atualizado_em: new Date().toISOString() }),
      });
    } catch { /* não bloqueia o laudo */ }
  };
  let djen = null, cndt = null, cnib = null, protestos = null;
  const [rDjen, rCndt, rCnib, rProt] = await Promise.all([
    numeroProcesso ? consultarComunicaDJEN(numeroProcesso).catch(() => ({ instavel: true, erro: 'exceção' })) : Promise.resolve(null),
    executadoDoc ? consultarCNDT(executadoDoc).catch(() => ({ instavel: true, erro: 'exceção' })) : Promise.resolve(null),
    executadoDoc ? consultarCNIB(executadoDoc).catch(() => ({ instavel: true, erro: 'exceção' })) : Promise.resolve(null),
    executadoDoc ? consultarProtestos(executadoDoc).catch(() => ({ instavel: true, erro: 'exceção' })) : Promise.resolve(null),
  ]);
  if (rDjen?.ok) djen = rDjen.dados; else if (rDjen?.instavel) { secoesFaltando.push('djen'); await enfileirar48h('djen', { numero_processo: numeroProcesso }, rDjen.erro); }
  if (rCndt?.ok) cndt = rCndt.dados; else if (rCndt?.instavel) { secoesFaltando.push('cndt'); await enfileirar48h('cndt', { doc: executadoDoc }, rCndt.erro); }
  if (rCnib?.ok) cnib = rCnib.dados; else if (rCnib?.instavel) { secoesFaltando.push('cnib'); await enfileirar48h('cnib', { doc: executadoDoc }, rCnib.erro); }
  if (rProt?.ok) protestos = rProt.dados; else if (rProt?.instavel) { secoesFaltando.push('protestos'); await enfileirar48h('protestos', { doc: executadoDoc }, rProt.erro); }

  // 5. Scores
  const scoreJuridico = calcularScoreJuridico({ riscos, sancoes, temProcesso: !!numeroProcesso, processosCNJ });
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
    modalidade: imovel?.modalidade || null,
    riscos, sancoes,
    processos_cnj: processosResumo,
    risco_suspensao: riscoSuspensao,
    parecer_cnj: parecerCNJ,
    cndt_trabalhista: cndt,       // débito trabalhista do executado (TST/BNDT)
    cnib_indisponibilidade: cnib, // indisponibilidade de bens do executado (CNIB)
    protestos,                    // protestos em cartório (CENPROT)
    djen_comunicacoes: djen,      // intimações/andamentos nacionais (DJEN/CNJ)
    secoes_em_confirmacao: secoesFaltando.filter(s => ['cndt', 'cnib', 'protestos', 'djen'].includes(s)),
    score_juridico: scoreJuridico, score_financeiro: scoreFinanceiro,
  };

  let parecerMd = '';
  try {
    parecerMd = await claude({
      model: MODEL,
      max_tokens: 3000,
      system: `Você é um analista jurídico de leilões de imóveis no Brasil. Gere um parecer claro e objetivo em MARKDOWN (pt-BR) com as seções: ## Resumo, ## Análise Documental (averbações/ônus da matrícula e do edital), ## Análise Judicial (executado, processo, sanções CEIS/CNEP), ## Situação do Devedor e Risco de Suspensão, ## Recomendação.
Na seção "Situação do Devedor e Risco de Suspensão" use o campo processos_cnj: liste ações em nome do devedor que possam SUSPENDER, ANULAR ou ATRASAR o leilão (ex.: ação anulatória/revisional, embargos à arrematação, tutela de urgência/liminar, consignação em pagamento, discussão de nulidade do leilão). Se modalidade='extrajudicial', dê ênfase especial a esse risco (no extrajudicial o edital não traz processo, mas o devedor fiduciante pode estar litigando). Se risco_suspensao=true, destaque como ALERTA ALTO. Se não houver processos, diga que não foram localizadas ações suspensivas nos tribunais consultados e recomende confirmação manual.
Na "Análise Judicial" incorpore também: cndt_trabalhista (débito trabalhista do executado — se positiva, é ALERTA de possível penhora trabalhista), protestos (protestos em cartório do vendedor) e djen_comunicacoes (intimações/andamentos recentes do processo no DJEN — use para indicar a fase atual e datas). Se o campo secoes_em_confirmacao listar alguma fonte (cndt/protestos/djen), diga explicitamente que ESSA seção está "em confirmação (conclui em até 48h)" por instabilidade momentânea da fonte, sem tratar como ausência de risco.
Seja direto, prático e prudente. Não invente dados que não estejam no JSON.`,
      messages: [{ role: 'user', content: `Dados coletados (JSON):\n\n${JSON.stringify(dados, null, 2)}\n\nObservações extraídas dos documentos:\n${obs.join('\n') || '—'}` }],
    });
  } catch {
    secoesFaltando.push('parecer');
    parecerMd = `## Parecer (parcial)\nNão foi possível gerar o parecer automático no momento.\n\n- **Gravames/ônus:** ${riscos.join('; ') || '—'}\n- **Sanções CEIS/CNEP:** ${sancoes.length}\n- **Processos do devedor (CNJ):** ${processosResumo.length}${riscoSuspensao ? ' — ⚠️ ação que pode suspender/atrasar o leilão' : ''}\n- **Score jurídico:** ${scoreJuridico}/100`;
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

  return res.status(200).json({
    ok: true,
    score_juridico: scoreJuridico,
    score_financeiro: scoreFinanceiro,
    executado: executadoNome,
    executado_cpf_cnpj: executadoDoc,
    numero_processo: numeroProcesso,
    riscos,
    sancoes_encontradas: sancoes.length,
    processos_cnj: processosResumo.length,
    risco_suspensao: riscoSuspensao,
    incompleto,
    secoes_faltando: secoesFaltando,
    parecer_md: parecerMd,
  });
}
