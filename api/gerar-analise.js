// Geração da análise mercadológica + laudo NO SERVIDOR (persistente).
// O cliente dispara e pode FECHAR a aba: a função Vercel continua rodando até o
// fim e grava o resultado em `analises_mercado`. Ao reabrir (qualquer device), o
// app lê o resultado do banco. Espelha os prompts de src/utils/claude.js.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';

const brl = (v) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertAnalise(row) {
  // upsert por (user_id, imovel_id)
  await sb('analises_mercado?on_conflict=user_id,imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch {}
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}
async function anthropic(payload, useSearch) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (useSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(payload) });
  return r.json();
}

function promptMercado({ endereco, tipoImovel, areaM2, cidade, estado, nomeCondominio }) {
  return `Você é um perito avaliador imobiliário. Realize pesquisa de mercado COMPLETA em DOIS NÍVEIS para o imóvel:
- Tipo: ${tipoImovel}, ${areaM2 ? areaM2 + 'm²' : 'área não informada'}
- Endereço: ${endereco}, ${cidade}/${estado}
${nomeCondominio ? `- Condomínio: ${nomeCondominio}` : ''}

REGRA OBRIGATÓRIA — MESMO TIPO: considere SOMENTE imóveis do MESMO TIPO (${tipoImovel}).
Descarte qualquer amostra de tipo diferente. Compare sempre ${tipoImovel} com ${tipoImovel}.

OBJETIVO: reunir o MÁXIMO de amostras possível. Faça várias buscas em fontes diferentes.

═══ NÍVEL 1 — MESMO CONDOMÍNIO / MESMO ENDEREÇO ═══
Busque o máximo de anúncios de venda E locação DENTRO do mesmo condomínio/edifício.
Se não encontrar no condomínio exato, busque na mesma rua. Meta: 8+ vendas e 5+ locações.

═══ NÍVEL 2 — VIZINHANÇA / BAIRRO ═══
Busque o máximo de anúncios (mesmo tipo) no bairro e adjacências (~1km). Meta: 15+ vendas e 8+ locações.

FONTES: ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Loft, 123i, Chaves na Mão, Net Imóveis. Cruze várias.

DATA DO ANÚNCIO: para CADA amostra, capture a data no campo "data" (formato "AAAA-MM"; senão "recente").
O preço varia no tempo — priorize as amostras mais recentes na média.

Retorne APENAS este JSON (sem markdown):
{
  "nivel1": { "descricao": "", "vendas": [{"descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0, "disponiveis": true },
  "nivel2": { "descricao": "", "vendas": [{"descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0 },
  "consolidado": { "precoMedioM2": 0, "aluguelMedio": 0, "yieldBruto": 0, "yieldLiquido": 0, "valorEstimadoImovel": 0, "descontoArremate": null },
  "comentario": "Análise qualitativa de 3-4 frases comparando os dois níveis e tendência."
}`;
}

function promptParecer(inp, m, mercado) {
  return `
Redija um PARECER EXECUTIVO de arrematação como Gestor Sênior da BidPro Brasil.

IMÓVEL: ${inp.tipo || inp.tipoImovel} — ${inp.endereco}
OBJETIVO: ${inp.objetivoCompra === 'uso_proprio' ? 'Uso Próprio' : 'Investimento'}
CENÁRIO: ${inp._cenario || 'À Vista'}
ORIGEM: ${inp.origem || 'extrajudicial'}
CIDADE: ${inp.cidade || ''}
ESTADO: ${inp.estado || ''}
TIPO: ${inp.tipo || 'apartamento'}
${inp.nomeCondominio ? `CONDOMÍNIO: ${inp.nomeCondominio}` : ''}

DADOS FINANCEIROS:
- Lance base: R$ ${brl(inp.valorArrematacao)}
- Capital mobilizado: R$ ${brl(m.capitalMobilizado)}
- Lucro/Economia: R$ ${brl(m.lucro)}
- Retorno: ${(m.roi || 0).toFixed(2)}%
- Teto de disputa: R$ ${brl(inp._teto)}

DADOS DE MERCADO:
- Preço médio/m²: R$ ${brl(mercado?.precoMedioM2)}
- Yield locação: ${(mercado?.yieldBruto || 0).toFixed(2)}% bruto / ${(mercado?.yieldLiquido || 0).toFixed(2)}% líquido
${mercado?.comentario ? `- Análise de mercado: ${mercado.comentario}` : ''}

RISCOS JURÍDICOS: ${(inp.riscos || []).map(r => r.texto || r).join('; ') || 'Nenhum identificado'}
OBSERVAÇÕES: ${inp.observacoes || 'Sem observações adicionais'}

Escreva em português formal. Estruture com 5 seções marcadas com "§ SEÇÃO:":
§ SEÇÃO: POSICIONAMENTO ESTRATÉGICO
§ SEÇÃO: DEFESA DA ARREMATAÇÃO
§ SEÇÃO: ANÁLISE DE RENTABILIDADE (locação, yield, payback)
§ SEÇÃO: CONCLUSÃO E RECOMENDAÇÃO DA GESTÃO
§ SEÇÃO: CHECKLIST DE DÉBITOS E DILIGÊNCIAS

Na seção CHECKLIST: para cada item, indicar status com [  ] Pendente | [S] Subrogado | [V] Verificado | [!] Atenção.
Se judicial e hasta pública, IPTU e condomínio subrogados (Lei 9.514/97, CPC art. 908). Se extrajudicial, débitos do arrematante.
Incluir a concessionária/órgão da região quando conhecido. Sem markdown, sem asteriscos.
Itens (um por linha, com status e como verificar): 1. ÁGUA E ESGOTO (concessionária da cidade) 2. ENERGIA (distribuidora) 3. GÁS (se aplicável) 4. IPTU — Prefeitura de ${inp.cidade || 'cidade'} 5. CONDOMÍNIO ${inp.nomeCondominio ? `(${inp.nomeCondominio})` : ''} 6. DÉBITOS TRABALHISTAS (TRT) 7. HIPOTECA/FINANCIAMENTO (matrícula).`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel, mercadoInputs, parecerInputs } = body;
  if (!imovelId || !mercadoInputs) { res.status(400).json({ error: 'imovelId e mercadoInputs obrigatórios' }); return; }

  const base = { user_id: user.id, imovel_id: String(imovelId), titulo: titulo || null, cidade: cidade || null, estado: estado || null, imovel: imovel || null, inputs: { mercadoInputs, parecerInputs } };
  await upsertAnalise({ ...base, status: 'gerando', erro: null, result: null });

  try {
    // 1) Mercado (web search)
    const mData = await anthropic({
      model: MODEL, max_tokens: 8000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      system: `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo (${mercadoInputs.tipoImovel}). Retorne apenas JSON válido.`,
      messages: [{ role: 'user', content: promptMercado(mercadoInputs) }],
    }, true);
    const mercado = parseJSON(extractText(mData)) || {};
    mercado.precoMedioM2 = mercado.consolidado?.precoMedioM2 || mercado.nivel2?.precoMedioM2 || 0;
    mercado.aluguelMedio = mercado.consolidado?.aluguelMedio || 0;
    mercado.yieldBruto = mercado.consolidado?.yieldBruto || 0;
    mercado.yieldLiquido = mercado.consolidado?.yieldLiquido || 0;
    mercado.vendas = mercado.nivel2?.vendas || [];
    mercado.locacoes = mercado.nivel2?.locacoes || [];

    const areaM2 = Number(mercadoInputs.areaM2) || 0;
    const valorMercado = (mercado.precoMedioM2 && areaM2) ? Math.round(mercado.precoMedioM2 * areaM2 * 0.9) : null;
    const valorLocacao = mercado.aluguelMedio ? Math.round(mercado.aluguelMedio) : null;

    // 2) Laudo (parecer)
    let parecer = '';
    if (parecerInputs?.d) {
      try {
        const pInp = { ...parecerInputs.d, valorMercado: valorMercado || parecerInputs.d.valorMercado, _cenario: parecerInputs.cenario, _teto: parecerInputs.teto };
        const pData = await anthropic({
          model: MODEL, max_tokens: 8000,
          system: 'Você é gestor sênior da BidPro Brasil. Redija pareceres executivos precisos. Nunca use markdown nem asteriscos. Apenas texto simples.',
          messages: [{ role: 'user', content: promptParecer(pInp, parecerInputs.metricas || {}, mercado) }],
        }, false);
        parecer = extractText(pData);
      } catch { /* laudo é complementar */ }
    }

    const result = { mercado, parecer, valorMercado, valorLocacao };
    await upsertAnalise({ ...base, status: 'concluida', erro: null, result });
    res.status(200).json({ ok: true, result });
  } catch (e) {
    await upsertAnalise({ ...base, status: 'erro', erro: String(e?.message || e) });
    res.status(500).json({ error: 'Falha ao gerar a análise', detalhe: String(e?.message || e) });
  }
}
