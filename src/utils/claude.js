import { apiCall } from './apiCall';
// Cliente Claude — suporta dev (VITE_CLAUDE_KEY) e produção (/api/claude via Vercel)
const DEV_KEY = import.meta.env.VITE_CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const MODEL_FAST = 'claude-haiku-4-5';

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
  const r = await apiCall('/api/claude', {
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

// Busca imóveis em leilão — usa web_search para resultados reais, fallback sintético
export async function buscarImoveis(filtros) {
  const { tipo, estado, cidade, valorMin, valorMax, modalidade, pagamento } = filtros;

  const prompt = `Busque IMÓVEIS EM LEILÃO publicados AGORA no Brasil com os filtros:
- Tipo: ${tipo || 'qualquer (casa, apartamento, terreno, comercial)'}
- Estado: ${estado || 'SP'}
- Cidade: ${cidade || 'capital do estado'}
- Lance mínimo: R$ ${valorMin ? Number(valorMin).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '50.000,00'} a R$ ${valorMax ? Number(valorMax).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '5.000.000,00'}
- Modalidade: ${modalidade || 'judicial e extrajudicial'}
- Pagamento: ${(pagamento||[]).length ? pagamento.join(', ') : 'qualquer'}

PESQUISE nas seguintes fontes:
1. venda-imoveis.caixa.gov.br (Caixa Econômica Federal)
2. sold.com.br
3. biasi.com.br
4. zukerman.com.br
5. remleiloes.com.br
6. frazaoleiloes.com.br
7. resale.com.br
8. leilaojudicialonline.com.br
9. Sites de leiloeiros credenciados pela JUCE${estado||'SP'}

Retorne APENAS um JSON array com até 12 imóveis. Para cada item:
{
  "id": "único",
  "titulo": "descrição curta do imóvel",
  "tipo": "casa|apartamento|terreno|comercial",
  "endereco": "logradouro, bairro",
  "cidade": "nome",
  "estado": "UF",
  "modalidade": "judicial|extrajudicial",
  "pagamento": ["aVista","financiado","hipotecado"],
  "valorAvaliacao": número ou null,
  "valorMinimo": número (lance inicial),
  "valorSegundaPraca": número ou null,
  "dataLeilao": "DD/MM/AAAA ou null",
  "leiloeiro": "nome",
  "plataforma": "nome da plataforma",
  "urlLote": "URL direta ao lote se encontrada",
  "areaM2": número ou null,
  "descricao": "breve descrição",
  "destaques": ["destaque 1", "destaque 2"]
}
Retorne SOMENTE o array JSON, sem markdown.`;

  try {
    const data = await callAPI({
      model: MODEL,
      max_tokens: 6000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
      messages: [{ role: 'user', content: prompt }],
      system: 'Você é especialista em leilões imobiliários brasileiros. Busque leilões REAIS publicados agora. Retorne apenas JSON válido.',
    }, true);

    const text = extractText(data);
    const result = parseJSON(text);
    if (Array.isArray(result) && result.length > 0) return result;
  } catch (e) {
    console.warn('web_search falhou, usando geração sintética:', e.message);
  }

  // Fallback: gerar exemplos realistas sem web_search
  return gerarExemplosImoveis(filtros);
}

async function gerarExemplosImoveis(filtros) {
  const { tipo, estado, cidade, valorMin, valorMax, modalidade, pagamento } = filtros;
  const prompt = `Gere 8 imóveis em leilão FICTÍCIOS mas altamente REALISTAS para o mercado brasileiro:
- Estado: ${estado||'SP'}, Cidade: ${cidade||'São Paulo'}
- Tipo: ${tipo||'variado'}, Modalidade: ${modalidade||'misto'}
- Faixa de lance: R$ ${Number(valorMin||50000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} a R$ ${Number(valorMax||2000000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}

Retorne JSON array com campos: id, titulo, tipo, endereco, cidade, estado, modalidade, pagamento(array), valorAvaliacao, valorMinimo, areaM2, dataLeilao, leiloeiro, plataforma, urlLote, descricao, destaques(array)
Apenas JSON, sem markdown.`;

  try {
    const data = await callAPI({
      model: MODEL_FAST, max_tokens: 3000,
      messages: [{ role:'user', content:prompt }],
      system: 'Gere dados realistas de leilões imobiliários. Apenas JSON.',
    });
    const result = parseJSON(extractText(data));
    if (Array.isArray(result) && result.length>0) return result;
  } catch {}

  // Fallback estático final
  const uf = estado||'SP';
  const cid = cidade||(uf==='SP'?'São Paulo':uf==='RJ'?'Rio de Janeiro':'Curitiba');
  return [
    { id:'demo_1', titulo:`Apartamento 2/4 com vaga — ${cid}`, tipo:'apartamento', endereco:'Rua das Acácias, 450 — Jardim América', cidade:cid, estado:uf, modalidade:'extrajudicial', pagamento:['aVista','financiado'], valorAvaliacao:320000, valorMinimo:192000, areaM2:72, dataLeilao:'28/06/2026', leiloeiro:'Sold Leilões', plataforma:'Sold Leilões', urlLote:'https://www.sold.com.br', descricao:'Apartamento em bom estado, condomínio fechado.', destaques:['40% abaixo da avaliação','Aceita financiamento'] },
    { id:'demo_2', titulo:`Casa térrea 3/4 — ${cid}`, tipo:'casa', endereco:'Av. Central, 1200 — Bela Vista', cidade:cid, estado:uf, modalidade:'judicial', pagamento:['aVista'], valorAvaliacao:550000, valorMinimo:275000, areaM2:130, dataLeilao:'05/07/2026', leiloeiro:'Biasi Leilões', plataforma:'Biasi Leilões', urlLote:'https://www.biasi.com.br', descricao:'Casa com quintal, 2 vagas, precisa de reforma.', destaques:['50% de desconto','Terreno amplo'] },
    { id:'demo_3', titulo:`Terreno comercial 400m² — ${cid}`, tipo:'terreno', endereco:'Rua do Comércio, 88 — Centro', cidade:cid, estado:uf, modalidade:'judicial', pagamento:['aVista'], valorAvaliacao:480000, valorMinimo:288000, areaM2:400, dataLeilao:'12/07/2026', leiloeiro:'Zukerman Leilões', plataforma:'Zukerman Leilões', urlLote:'https://www.zukerman.com.br', descricao:'Terreno plano em região comercial.', destaques:['Zoneamento misto','Documentação limpa'] },
    { id:'demo_4', titulo:`Sala comercial 60m² — ${cid}`, tipo:'comercial', endereco:'Av. Brasil, 500 — Itaim', cidade:cid, estado:uf, modalidade:'extrajudicial', pagamento:['aVista','financiado'], valorAvaliacao:280000, valorMinimo:168000, areaM2:60, dataLeilao:'19/07/2026', leiloeiro:'REM Leilões', plataforma:'REM Leilões', urlLote:'https://www.remleiloes.com.br', descricao:'Sala no 5º andar, 1 vaga, prédio corporativo.', destaques:['Renda imediata','1 vaga inclusa'] },
    { id:'demo_5', titulo:`Apt 1/4 perto do metrô — ${cid}`, tipo:'apartamento', endereco:'Rua Vergueiro, 2300 — Vila Mariana', cidade:cid, estado:uf, modalidade:'extrajudicial', pagamento:['aVista','financiado','hipotecado'], valorAvaliacao:210000, valorMinimo:126000, areaM2:42, dataLeilao:'26/07/2026', leiloeiro:'Caixa Econômica Federal', plataforma:'Caixa Econômica Federal', urlLote:'https://venda-imoveis.caixa.gov.br', descricao:'Kitnet compacta, aceita FGTS.', destaques:['Aceita FGTS','Alta demanda de locação'] },
    { id:'demo_6', titulo:`Casa alto padrão 4/4 — ${cid}`, tipo:'casa', endereco:'Rua das Orquídeas, 77 — Alphaville', cidade:cid, estado:uf, modalidade:'judicial', pagamento:['aVista'], valorAvaliacao:1200000, valorMinimo:660000, areaM2:320, dataLeilao:'30/07/2026', leiloeiro:'Frazão Leilões', plataforma:'Frazão Leilões', urlLote:'https://www.frazaoleiloes.com.br', descricao:'Casa em condomínio fechado, piscina e área gourmet.', destaques:['45% abaixo','Condomínio fechado'] },
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

// Extrai dados de uma URL (PDF ou página HTML) sem armazenar nada
export async function extrairDadosDocumentoUrl(url) {
  const instrucao = getInstrucaoExtracao();

  // PDF URL: Claude lê diretamente via URL source (sem armazenamento)
  if (/\.pdf($|\?)/i.test(url) || url.includes('pdf')) {
    const content = [
      { type: 'document', source: { type: 'url', url } },
      { type: 'text', text: instrucao },
    ];
    const data = await callAPI({ model: MODEL_FAST, max_tokens: 2048, messages: [{ role: 'user', content }], system: 'Extraia dados de documentos imobiliários. Retorne apenas JSON válido.' });
    return parseJSON(extractText(data));
  }

  // Página HTML: busca via servidor (evita CORS) → extrai texto → análise
  const r = await apiCall('/api/fetch-url', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  const d = await r.json();
  if (d.error) throw new Error(d.error);

  let content;
  if (d.type === 'pdf') {
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.base64 } },
      { type: 'text', text: instrucao },
    ];
  } else {
    content = `${instrucao}\n\nCONTEÚDO DA PÁGINA:\n${d.texto}`;
  }
  const data = await callAPI({ model: MODEL_FAST, max_tokens: 2048, messages: [{ role: 'user', content }], system: 'Extraia dados de documentos imobiliários. Retorne apenas JSON válido.' });
  return parseJSON(extractText(data));
}

function getInstrucaoExtracao() {
  return `Analise o documento (edital ou matrícula de imóvel em leilão) e extraia os dados estruturados.
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
}`;
}

// Extrai dados do edital/matrícula — aceita texto puro ou PDF (base64)
export async function extrairDadosDocumento(texto, pdfBase64 = null) {
  const instrucao = getInstrucaoExtracao();

  let content;
  if (pdfBase64) {
    content = [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: instrucao },
    ];
  } else {
    content = `${instrucao}\n\nTEXTO DO DOCUMENTO:\n${texto.substring(0, 6000)}`;
  }

  const data = await callAPI({
    model: MODEL_FAST,
    max_tokens: 2048,
    messages: [{ role: 'user', content }],
    system: 'Extraia dados de documentos imobiliários. Retorne apenas JSON válido.',
  });

  return parseJSON(extractText(data));
}

// Análise de mercado com dois níveis: mesmo condomínio + vizinhança
export async function analisarMercado(inputs) {
  const { endereco, tipoImovel, areaM2, cidade, estado, nomeCondominio } = inputs;

  const prompt = `Você é um perito avaliador imobiliário. Realize pesquisa de mercado COMPLETA em DOIS NÍVEIS para o imóvel:
- Tipo: ${tipoImovel}, ${areaM2 ? areaM2 + 'm²' : 'área não informada'}
- Endereço: ${endereco}, ${cidade}/${estado}
${nomeCondominio ? `- Condomínio: ${nomeCondominio}` : ''}

REGRA OBRIGATÓRIA — MESMO TIPO: considere SOMENTE imóveis do MESMO TIPO (${tipoImovel}).
Descarte qualquer amostra de tipo diferente (ex.: não misture casa com apartamento,
nem terreno com comercial). Compare sempre ${tipoImovel} com ${tipoImovel}.

OBJETIVO: reunir o MÁXIMO de amostras possível (quanto mais anúncios reais, melhor a
avaliação). Faça várias buscas em fontes diferentes até esgotar os resultados úteis.

═══ NÍVEL 1 — MESMO CONDOMÍNIO / MESMO ENDEREÇO ═══
Busque o máximo de anúncios de venda E locação DENTRO do mesmo condomínio ou edifício.
Se não encontrar no condomínio exato, busque na mesma rua ou logradouro.
Meta: o máximo possível — idealmente 8+ amostras de venda e 5+ de locação.

═══ NÍVEL 2 — VIZINHANÇA / BAIRRO ═══
Busque o máximo de anúncios similares (mesmo tipo) no bairro e adjacências (raio ~1km).
Meta: o máximo possível — idealmente 15+ amostras de venda e 8+ de locação.

FONTES: ZAP Imóveis, VivaReal, OLX, Quinto Andar, Imovelweb, Loft, 123i, Chaves na Mão,
Net Imóveis, DF Imóveis, anúncios diretos de imobiliárias. Cruze várias fontes.

DATA DO ANÚNCIO: para CADA amostra, capture a data do anúncio no campo "data"
(formato "AAAA-MM"; se a fonte só indicar o mês/ano, use-o; se não houver data,
estime "recente"). O preço de imóvel varia com o tempo — a data é importante para
ponderar as amostras (priorize as mais recentes na média).

Retorne APENAS este JSON (sem markdown):
{
  "nivel1": {
    "descricao": "Ex: Residencial Torre Norte, Rua das Flores 100",
    "vendas": [{"descricao":"Apt 2/4 andar 8","valor":320000,"m2":72,"valorM2":4444,"fonte":"ZAP","data":"2025-11"}],
    "locacoes": [{"descricao":"Apt 2/4","valorMensal":2200,"fonte":"QuintoAndar","data":"2025-10"}],
    "precoMedioM2": número,
    "precoMinM2": número,
    "precoMaxM2": número,
    "aluguelMedio": número,
    "totalAmostras": número,
    "disponiveis": true|false
  },
  "nivel2": {
    "descricao": "Ex: Bairro Vila Mariana, raio 1km",
    "vendas": [{"descricao":"...","valor":número,"m2":número,"valorM2":número,"fonte":"","data":"AAAA-MM"}],
    "locacoes": [{"descricao":"...","valorMensal":número,"fonte":"","data":"AAAA-MM"}],
    "precoMedioM2": número,
    "precoMinM2": número,
    "precoMaxM2": número,
    "aluguelMedio": número,
    "totalAmostras": número
  },
  "consolidado": {
    "precoMedioM2": média ponderada dos dois níveis,
    "aluguelMedio": número,
    "yieldBruto": número (percentual anual = aluguelMedio*12/valorMedioTotal*100),
    "yieldLiquido": número (descontando 15% vacância/despesas),
    "valorEstimadoImovel": precoMedioM2 * ${areaM2 || 0},
    "descontoArremate": null
  },
  "comentario": "Análise qualitativa de 3-4 frases comparando os dois níveis, tendência do mercado e recomendação de precificação"
}`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 8000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
    messages: [{ role: 'user', content: prompt }],
    system: `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo de imóvel (${tipoImovel}). Faça buscas em várias fontes. Retorne apenas JSON válido.`,
  }, true);

  const result = parseJSON(extractText(data));
  // Compatibilidade retroativa com código que usa campos do nível raiz
  if (result) {
    result.precoMedioM2 = result.consolidado?.precoMedioM2 || result.nivel2?.precoMedioM2 || 0;
    result.aluguelMedio = result.consolidado?.aluguelMedio || 0;
    result.yieldBruto = result.consolidado?.yieldBruto || 0;
    result.yieldLiquido = result.consolidado?.yieldLiquido || 0;
    result.vendas = result.nivel2?.vendas || [];
    result.locacoes = result.nivel2?.locacoes || [];
  }
  return result;
}

// Gera o parecer MERCADOLÓGICO e de VIABILIDADE FINANCEIRA (sem jurídico/CNJ).
export async function gerarParecer(inputs, metricas, mercado) {
  const brl = (v) => (v||0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const usoProprio = inputs.objetivoCompra === 'uso_proprio';
  // Débitos/encargos JÁ INFORMADOS que serão assumidos: entram como custo e devem
  // constar no parecer — citando a documentação se houver, ou as referências de
  // onde buscar quando não estiverem discriminadas.
  const blocoDebitos = (() => {
    const itens = [];
    if (Number(inputs.debitosAssumidos) > 0) itens.push(`Débitos assumidos (gerais): R$ ${brl(inputs.debitosAssumidos)}`);
    if (Number(inputs.iptuMensal) > 0) itens.push(`IPTU: R$ ${brl(inputs.iptuMensal)}/mês`);
    if (Number(inputs.condominioMensal) > 0) itens.push(`Condomínio: R$ ${brl(inputs.condominioMensal)}/mês`);
    if (Number(inputs.laudemio) > 0) itens.push(`Laudêmio: R$ ${brl(inputs.laudemio)}`);
    if (Number(inputs.foreiro) > 0) itens.push(`Foreiro/foro: R$ ${brl(inputs.foreiro)}`);
    if (!itens.length) return '';
    const temDocs = !!(inputs.linkEdital || inputs.linkMatricula || (Array.isArray(inputs.anexos) && inputs.anexos.length));
    return `
DÉBITOS/ENCARGOS A ASSUMIR (informados — JÁ ENTRAM como custo na viabilidade):
${itens.map(i => '- ' + i).join('\n')}
${temDocs
  ? 'Há documentação do lote disponível. CONFIRME se cada débito acima consta nela; cite a fonte quando constar e, quando não constar, indique onde obter (referências abaixo).'
  : 'Sem documentação detalhada anexada: liste os débitos e oriente ONDE buscar/confirmar cada um (referências abaixo).'}
REFERÊNCIAS quando não constarem na documentação:
- IPTU/taxas: certidão de débitos imobiliários na Prefeitura (Secretaria da Fazenda), pela inscrição/IPTU.
- Condomínio: declaração de débitos com a administradora/síndico.
- Ônus, hipotecas e débitos propter rem: matrícula atualizada no Cartório de Registro de Imóveis.
- Responsabilidade por débitos após a arrematação: cláusulas do EDITAL do leilão.
- Laudêmio/foro (terreno de marinha): SPU ou o ente foreiro.`;
  })();
  const prompt = `
Redija um PARECER EXECUTIVO MERCADOLÓGICO E DE VIABILIDADE FINANCEIRA como Gestor Sênior da BidPro Brasil.

ESCOPO ESTRITO: foque EXCLUSIVAMENTE em mercado × valor de aquisição e viabilidade
financeira. NÃO faça análise JURÍDICA (CNJ, gravames, validade de penhora, diligências)
— isso é dos relatórios DOCUMENTAL e JURÍDICO. EXCEÇÃO: os DÉBITOS/ENCARGOS A ASSUMIR
informados abaixo DEVEM constar (são custo da operação), no aspecto financeiro.

IMÓVEL: ${inputs.tipo || inputs.tipoImovel} — ${inputs.endereco}, ${inputs.cidade || ''}/${inputs.estado || ''}
OBJETIVO: ${usoProprio ? 'USO PRÓPRIO' : 'INVESTIMENTO'}
${inputs.nomeCondominio ? `CONDOMÍNIO: ${inputs.nomeCondominio}` : ''}

MERCADO:
- Preço médio/m²: R$ ${brl(mercado?.precoMedioM2)}
- Aluguel médio: R$ ${brl(mercado?.aluguelMedio)} · Yield: ${(mercado?.yieldBruto||0).toFixed(2)}% bruto / ${(mercado?.yieldLiquido||0).toFixed(2)}% líquido
${mercado?.comentario ? `- Leitura de mercado: ${mercado.comentario}` : ''}

AQUISIÇÃO E RETORNO:
- Lance SEM disputa (lance base): R$ ${brl(inputs.valorArrematacao)}
- Lance MÁXIMO COM disputa (preserva o piso de lucro): R$ ${brl(inputs._teto)}
- Capital total aportado: R$ ${brl(metricas.capitalMobilizado)}
- Lucro/Economia estimada: R$ ${brl(metricas.lucro)}
- Retorno (ROI/ROE): ${(metricas.roi||0).toFixed(2)}%
OBSERVAÇÕES: ${inputs.observacoes || 'Sem observações adicionais'}
${blocoDebitos}

REGRA DE VIABILIDADE:
${usoProprio
  ? '- Como é USO PRÓPRIO, o piso de 30% de lucro NÃO se aplica. Foque na ECONOMIA frente ao mercado e na adequação ao uso.'
  : '- A operação só é VIÁVEL com no mínimo 30% de lucro líquido. Avalie SEM DISPUTA e COM DISPUTA (até o lance que ainda preserva 30%).'}

Escreva em português formal, texto simples (sem markdown/asteriscos). Estruture com "§ SEÇÃO:":
§ SEÇÃO: POSICIONAMENTO ESTRATÉGICO (mercado × valor de aquisição; desconto real)
§ SEÇÃO: CENÁRIOS DE LANCE (sem disputa e com disputa; até onde subir mantendo ${usoProprio ? 'a economia' : 'o piso de 30%'})
§ SEÇÃO: PROJEÇÃO DE RENTABILIDADE (projeção de 12 MESES com pagamento parcelado até a revenda; deixe claro que VENDER ANTES aumenta o lucro; ROI/ROE, locação como alternativa e payback)${blocoDebitos ? '\n§ SEÇÃO: DÉBITOS E ENCARGOS ASSUMIDOS (liste os débitos informados que entram como custo; diga se constam na documentação; para os que não constarem, aponte as referências de onde obter/confirmar)' : ''}
§ SEÇÃO: DEFESA DA OPERAÇÃO
§ SEÇÃO: CONCLUSÃO E RECOMENDAÇÃO

SE NÃO HOUVER VIABILIDADE${usoProprio ? ' (economia irrelevante)' : ' (lucro < 30%)'}: seja DIRETO e CURTO — explique objetivamente o porquê e recomende não avançar, sem alongar.`;

  const data = await callAPI({
    model: MODEL,
    max_tokens: 4500,
    messages: [{ role: 'user', content: prompt }],
    system: 'Você é gestor sênior da BidPro Brasil. Redija um parecer MERCADOLÓGICO e de VIABILIDADE FINANCEIRA — sem análise jurídica, CNJ, débitos ou diligências. Preciso e persuasivo. Nunca use markdown, asteriscos ou formatação especial. Use apenas texto simples.',
  });

  return extractText(data);
}
