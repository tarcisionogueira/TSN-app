// Cliente Claude — suporta dev (VITE_CLAUDE_KEY) e produção (/api/claude via Vercel)
const DEV_KEY = import.meta.env.VITE_CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const MODEL_FAST = 'claude-haiku-4-5-20251001';

async function callAPI(payload, useSearch = false) {
  if (DEV_KEY) {
    // Modo dev: chama Anthropic diretamente (aceita CORS)
    const headers = {
      'x-api-key': DEV_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    if (useSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers, body: JSON.stringify(payload),
    });
    return r.json();
  }
  // Produção: via Edge Function (seguro)
  const r = await fetch('/api/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, useSearch }),
  });
  return r.json();
}

export function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}

export function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch {}
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  return null;
}

// Busca imóveis em leilão usando web_search
export async function buscarImoveis(filtros) {
  const { tipo, estado, cidade, valorMin, valorMax, modalidade, pagamento, dataInicio, dataFim } = filtros;
  const prompt = `Busque IMÓVEIS EM LEILÃO no Brasil com os seguintes filtros:
- Tipo: ${tipo || 'qualquer'}
- Estado: ${estado || 'qualquer'}
- Cidade: ${cidade || 'qualquer'}
- Faixa de valor: R$ ${valorMin||0} a R$ ${valorMax||'sem limite'}
- Modalidade: ${modalidade || 'judicial e extrajudicial'}
- Forma de pagamento: ${pagamento || 'qualquer'}
- Período: ${dataInicio||'aberto'} a ${dataFim||'aberto'}

FONTES PRIORITÁRIAS: Caixa Econômica Federal (venda-imoveis.caixa.gov.br), Sold Leilões, Biasi Leilões, Zukerman, REM Leilões, Frazão Leilões, Leilão Judicial Online, Resale/Creditas, sites de leiloeiros credenciados das Juntas Comerciais estaduais.

Retorne APENAS um JSON array com até 12 imóveis encontrados. Formato de CADA item:
{
  "id": "único gerado por você",
  "titulo": "descrição curta do imóvel",
  "tipo": "casa|apartamento|terreno|comercial",
  "endereco": "rua, bairro",
  "cidade": "nome",
  "estado": "sigla UF",
  "cep": "se disponível",
  "modalidade": "judicial|extrajudicial",
  "pagamento": ["aVista","financiado","hipotecado"],
  "valorAvaliacao": número ou null,
  "valorMinimo": número,
  "valorSegundaPraca": número ou null,
  "dataLeilao": "DD/MM/AAAA ou null",
  "leiloeiro": "nome do leiloeiro",
  "plataforma": "nome da plataforma",
  "urlLote": "link direto ao lote",
  "areaM2": número ou null,
  "descricao": "breve descrição do imóvel",
  "destaques": ["pontos positivos do lote"]
}

Retorne SOMENTE o JSON, sem markdown, sem explicações.`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: prompt }],
    system: 'Você é um especialista em leilões imobiliários brasileiros. Retorne apenas JSON válido, sem markdown.',
  }, true);

  const text = extractText(data);
  const result = parseJSON(text);
  return Array.isArray(result) ? result : [];
}

// Busca leiloeiros credenciados de uma junta comercial estadual
export async function buscarLeiloeirosEstado(estado) {
  const prompt = `Busque a LISTA DE LEILOEIROS OFICIAIS CREDENCIADOS pela junta comercial do estado ${estado} (Brasil).
Retorne JSON: {"leiloeiros": [{"nome": "...", "site": "url ou null", "telefone": "ou null", "especialidade": "imóveis/geral/etc"}], "fonteJunta": "url da junta comercial"}`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 2048,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: prompt }],
    system: 'Retorne apenas JSON válido.',
  }, true);

  return parseJSON(extractText(data)) || { leiloeiros: [], fonteJunta: '' };
}

// Extrai dados do edital/matrícula
export async function extrairDadosDocumento(texto) {
  const prompt = `Analise o texto abaixo (edital ou matrícula de imóvel em leilão) e extraia os dados estruturados.
Retorne APENAS JSON:
{
  "nome": "identificação curta",
  "tipo": "casa|apartamento|terreno|comercial",
  "endereco": "endereço completo",
  "cidade": "",
  "estado": "UF",
  "cep": "",
  "valorAvaliacao": número,
  "valorArrematacao": número (lance mínimo),
  "areaM2": número,
  "areaTerrenoM2": número ou null,
  "debitosAssumidos": número,
  "iptuMensal": número ou null,
  "condominioMensal": número ou null,
  "laudemio": número (se houver, senão 0),
  "foreiro": número (se houver, senão 0),
  "taxaLeiloeiroPercentual": número,
  "somenteAVista": boolean,
  "origem": "judicial|extrajudicial",
  "leiloeiro": "nome",
  "dataLeilao": "DD/MM/AAAA",
  "riscos": ["liste todos os gravames, ônus, pendências, usufrutos, hipotecas, penhoras, etc encontrados no texto"],
  "observacoes": "outras informações relevantes"
}

TEXTO DO DOCUMENTO:
${texto.substring(0, 6000)}`;

  const data = await callAPI({
    model: MODEL_FAST,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
    system: 'Extraia dados de documentos imobiliários. Retorne apenas JSON válido.',
  });

  return parseJSON(extractText(data));
}

// Análise de mercado com comparativos
export async function analisarMercado(inputs) {
  const { endereco, tipoImovel, areaM2, cidade, estado, isCondominio } = inputs;
  const prompt = `Realize pesquisa de mercado imobiliário para:
- Imóvel: ${tipoImovel} com ${areaM2}m²
- Localização: ${endereco}, ${cidade}/${estado}
- É condomínio fechado: ${isCondominio ? 'SIM — busque EXCLUSIVAMENTE dentro deste condomínio' : 'NÃO — busque no mesmo bairro'}

TAREFA 1 — VENDA: Encontre até 10 imóveis similares à venda. Para cada: portal, endereço/identificação, valor total e valor/m².
TAREFA 2 — LOCAÇÃO: Encontre até 6 imóveis similares para alugar. Para cada: portal, identificação, valor mensal.
TAREFA 3 — CALCULE:
- Preço médio de venda (R$/m²)
- Faixa de preço de venda (min-max)
- Aluguel médio mensal
- Yield bruto médio de locação (aluguel/valor_venda × 100 %)
- Yield líquido estimado (descontando 15% de vacância/despesas)

Retorne JSON:
{
  "vendas": [{"descricao":"...","valor":número,"m2":número,"valorM2":número,"fonte":""}],
  "locacoes": [{"descricao":"...","valorMensal":número,"fonte":""}],
  "precoMedioM2": número,
  "precoMinM2": número,
  "precoMaxM2": número,
  "aluguelMedio": número,
  "yieldBruto": número (percentual),
  "yieldLiquido": número (percentual),
  "totalAmostrasVenda": número,
  "totalAmostrasLocacao": número,
  "comentario": "análise qualitativa do mercado local em 2-3 frases"
}`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 4096,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: prompt }],
    system: 'Você é um perito avaliador imobiliário. Retorne apenas JSON válido.',
  }, true);

  return parseJSON(extractText(data));
}

// Gera parecer executivo completo
export async function gerarParecer(inputs, metricas, mercado) {
  const prompt = `
Redija um PARECER EXECUTIVO de arrematação como Gestor Sênior da TSN Ativos.

IMÓVEL: ${inputs.tipoImovel} — ${inputs.endereco}
OBJETIVO: ${inputs.objetivoCompra === 'uso_proprio' ? 'Uso Próprio' : 'Investimento'}
CENÁRIO: ${inputs._cenario || 'À Vista'}

DADOS FINANCEIROS:
- Lance base: R$ ${(inputs.valorArrematacao||0).toLocaleString('pt-BR')}
- Capital mobilizado: R$ ${(metricas.capitalMobilizado||0).toLocaleString('pt-BR')}
- Lucro/Economia: R$ ${(metricas.lucro||0).toLocaleString('pt-BR')}
- Retorno: ${(metricas.roi||0).toFixed(1)}%
- Teto de disputa: R$ ${(inputs._teto||0).toLocaleString('pt-BR')}

DADOS DE MERCADO:
- Preço médio/m²: R$ ${(mercado?.precoMedioM2||0).toLocaleString('pt-BR')}
- Yield locação: ${(mercado?.yieldBruto||0).toFixed(2)}% bruto / ${(mercado?.yieldLiquido||0).toFixed(2)}% líquido
${mercado?.comentario ? `- Análise de mercado: ${mercado.comentario}` : ''}

RISCOS JURÍDICOS: ${(inputs.riscos||[]).map(r=>r.texto||r).join('; ') || 'Nenhum identificado'}
OBSERVAÇÕES: ${inputs.observacoes || 'Sem observações adicionais'}

Escreva em português formal. Estruture com 4 seções marcadas com "§ SEÇÃO:":
§ SEÇÃO: POSICIONAMENTO ESTRATÉGICO
§ SEÇÃO: DEFESA DA ARREMATAÇÃO
§ SEÇÃO: ANÁLISE DE RENTABILIDADE (locação, yield, payback)
§ SEÇÃO: CONCLUSÃO E RECOMENDAÇÃO DA GESTÃO`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 3000,
    messages: [{ role: 'user', content: prompt }],
    system: 'Você é gestor sênior da TSN Ativos. Redija pareceres executivos precisos e persuasivos.',
  });

  return extractText(data);
}
