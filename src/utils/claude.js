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

// Busca imóveis em leilão — gera exemplos realistas baseados nos filtros
export async function buscarImoveis(filtros) {
  const { tipo, estado, cidade, valorMin, valorMax, modalidade, pagamento } = filtros;

  const hoje = new Date();
  const datas = [7, 14, 21, 30].map(d => {
    const dt = new Date(hoje.getTime() + d * 86400000);
    return `${String(dt.getDate()).padStart(2,'0')}/${String(dt.getMonth()+1).padStart(2,'0')}/${dt.getFullYear()}`;
  });

  const prompt = `Gere uma lista de 10 IMÓVEIS EM LEILÃO fictícios, porém ALTAMENTE REALISTAS para o mercado imobiliário brasileiro, considerando os filtros abaixo. Os dados devem refletir preços, bairros e características verossímeis para a região.

FILTROS:
- Tipo: ${tipo || 'variado (casa, apartamento, terreno, comercial)'}
- Estado: ${estado || 'SP (padrão se não informado)'}
- Cidade: ${cidade || 'capital do estado'}
- Faixa de valor de arrematação: R$ ${valorMin ? Number(valorMin).toLocaleString('pt-BR') : '50.000'} a R$ ${valorMax ? Number(valorMax).toLocaleString('pt-BR') : '2.000.000'}
- Modalidade: ${modalidade || 'judicial e extrajudicial (mix)'}
- Pagamento aceito: ${(pagamento||[]).length ? pagamento.join(', ') : 'à vista, financiado e hipotecado (mix)'}

Datas disponíveis para leilão: ${datas.join(', ')}
Plataformas para usar: Caixa Econômica Federal, Sold Leilões, Biasi Leilões, Zukerman Leilões, REM Leilões, Frazão Leilões, Resale, Leilão Judicial Online

Retorne APENAS um JSON array. Formato de CADA item:
{
  "id": "leilao_001",
  "titulo": "Apartamento 3/4 com 2 vagas - Vila Mariana",
  "tipo": "casa|apartamento|terreno|comercial",
  "endereco": "Rua das Flores, 123 - Bairro",
  "cidade": "São Paulo",
  "estado": "SP",
  "modalidade": "judicial|extrajudicial",
  "pagamento": ["aVista","financiado"],
  "valorAvaliacao": 450000,
  "valorMinimo": 270000,
  "valorSegundaPraca": 225000,
  "desconto": 40,
  "dataLeilao": "DD/MM/AAAA",
  "leiloeiro": "João Silva Leilões",
  "plataforma": "Sold Leilões",
  "urlLote": "https://www.sold.com.br",
  "areaM2": 85,
  "descricao": "Descrição de 1 frase sobre o imóvel e estado de conservação",
  "destaques": ["Desconto de 40% sobre avaliação", "Aceita FGTS", "Localização privilegiada"]
}

IMPORTANTE: valorMinimo deve ser entre 30% e 65% do valorAvaliacao. desconto = (1 - valorMinimo/valorAvaliacao)*100.
Retorne SOMENTE o array JSON, sem markdown, sem texto adicional.`;

  const data = await callAPI({
    model: MODEL_FAST,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
    system: 'Você é especialista em leilões imobiliários brasileiros. Gere dados realistas. Retorne apenas JSON válido, sem markdown.',
  });

  const text = extractText(data);
  const result = parseJSON(text);
  if (Array.isArray(result) && result.length > 0) return result;

  // Fallback com dados estáticos se a API falhar
  return gerarDemoImoveis(filtros);
}

function gerarDemoImoveis(filtros) {
  const uf = filtros.estado || 'SP';
  const cid = filtros.cidade || (uf === 'SP' ? 'São Paulo' : uf === 'RJ' ? 'Rio de Janeiro' : 'Curitiba');
  return [
    { id:'demo_1', titulo:`Apartamento 2/4 reformado — ${cid}`, tipo:'apartamento', endereco:'Rua das Acácias, 450 — Jardim América', cidade:cid, estado:uf, modalidade:'extrajudicial', pagamento:['aVista','financiado'], valorAvaliacao:320000, valorMinimo:192000, valorSegundaPraca:160000, desconto:40, dataLeilao:'28/06/2026', leiloeiro:'Sold Leilões', plataforma:'Sold Leilões', urlLote:'https://www.sold.com.br', areaM2:72, descricao:'Apartamento em bom estado, condomínio fechado com área de lazer.', destaques:['40% abaixo da avaliação','Aceita financiamento','Área de lazer completa'] },
    { id:'demo_2', titulo:`Casa térrea 3/4 — ${cid}`, tipo:'casa', endereco:'Av. Paulista, 1200 — Bela Vista', cidade:cid, estado:uf, modalidade:'judicial', pagamento:['aVista'], valorAvaliacao:550000, valorMinimo:275000, valorSegundaPraca:220000, desconto:50, dataLeilao:'05/07/2026', leiloeiro:'Biasi Leilões', plataforma:'Biasi Leilões', urlLote:'https://www.biasi.com.br', areaM2:130, descricao:'Casa com quintal, 2 vagas de garagem, precisa de reforma.', destaques:['50% de desconto','Terreno amplo','Potencial retrofit'] },
    { id:'demo_3', titulo:`Terreno comercial 400m² — ${cid}`, tipo:'terreno', endereco:'Rua do Comércio, 88 — Centro', cidade:cid, estado:uf, modalidade:'judicial', pagamento:['aVista'], valorAvaliacao:480000, valorMinimo:288000, valorSegundaPraca:240000, desconto:40, dataLeilao:'12/07/2026', leiloeiro:'Zukerman Leilões', plataforma:'Zukerman Leilões', urlLote:'https://www.zukerman.com.br', areaM2:400, descricao:'Terreno plano em região comercial, zoneamento misto.', destaques:['Excelente localização','Zoneamento misto','Documentação limpa'] },
    { id:'demo_4', titulo:`Sala comercial 60m² — ${cid}`, tipo:'comercial', endereco:'Av. Brasil, 500 — Itaim', cidade:cid, estado:uf, modalidade:'extrajudicial', pagamento:['aVista','financiado'], valorAvaliacao:280000, valorMinimo:168000, valorSegundaPraca:140000, desconto:40, dataLeilao:'19/07/2026', leiloeiro:'REM Leilões', plataforma:'REM Leilões', urlLote:'https://www.remleiloes.com.br', areaM2:60, descricao:'Sala no 5º andar, 1 vaga, prédio corporativo com portaria 24h.', destaques:['Renda imediata possível','1 vaga inclusa','Prédio corporativo'] },
    { id:'demo_5', titulo:`Apartamento 1/4 — ${cid}`, tipo:'apartamento', endereco:'Rua Vergueiro, 2300 — Vila Mariana', cidade:cid, estado:uf, modalidade:'extrajudicial', pagamento:['aVista','financiado','hipotecado'], valorAvaliacao:210000, valorMinimo:126000, valorSegundaPraca:105000, desconto:40, dataLeilao:'26/07/2026', leiloeiro:'Caixa Econômica Federal', plataforma:'Caixa Econômica Federal', urlLote:'https://venda-imoveis.caixa.gov.br', areaM2:42, descricao:'Kitnet compacta, aceita FGTS, perto do metrô.', destaques:['Aceita FGTS','Perto do metrô','Alta demanda de locação'] },
    { id:'demo_6', titulo:`Casa com piscina 4/4 — ${cid}`, tipo:'casa', endereco:'Rua das Orquídeas, 77 — Alphaville', cidade:cid, estado:uf, modalidade:'judicial', pagamento:['aVista'], valorAvaliacao:1200000, valorMinimo:660000, valorSegundaPraca:540000, desconto:45, dataLeilao:'30/07/2026', leiloeiro:'Frazão Leilões', plataforma:'Frazão Leilões', urlLote:'https://www.frazaoleiloes.com.br', areaM2:320, descricao:'Casa alto padrão em condomínio fechado, piscina e área gourmet.', destaques:['45% abaixo da avaliação','Condomínio fechado','Potencial venda de R$ 1,2M'] },
  ];
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
