// Geração da análise mercadológica + laudo NO SERVIDOR (persistente).
// O cliente dispara e pode FECHAR a aba: a função Vercel continua rodando até o
// fim e grava o resultado em `analises_mercado`. Ao reabrir (qualquer device), o
// app lê o resultado do banco. Espelha os prompts de src/utils/claude.js.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { resumoAprendizadoTexto } from './_arremate-aprendizado.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const REUSE_DIAS = Number(process.env.ANALISE_REUSE_DIAS || 7); // reaproveita a pesquisa de mercado deste imóvel se feita há < N dias

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

// O agente que aprende com os relatórios SINALIZA anomalias (o gerador achou algo errado
// nos dados) para a verificação de saúde — sem custo, sem gerar relatório.
async function registrarAnomalia(tipo, fonte, imovelId, campo, detalhe) {
  try {
    await sb('rpc/registrar_anomalia_relatorio', {
      method: 'POST',
      body: JSON.stringify({ p_tipo: tipo, p_fonte: fonte || '', p_imovel_id: String(imovelId || ''), p_campo: campo || '', p_detalhe: detalhe || '' }),
    });
  } catch { /* nunca bloqueia o relatório */ }
}

// APRENDER NA EMISSÃO: ao emitir o relatório, grava uma lição DURÁVEL (corpus + sinais de
// qualidade) em agente_aprendizado — SEM chamada de IA extra (custo zero). Sobrevive à
// exclusão do relatório (tabela separada de analises_*). Guarda só dado POISON-RESISTENTE:
// valores do imóvel (scraper) e da pesquisa (servidor) — nunca derivados de input do
// usuário (ex.: valorMercado depende de areaM2 do cliente), p/ não envenenar o coletivo.
async function aprenderNaEmissao(imovel, mercado, temParecer) {
  try {
    const aval = Number(imovel?.valor_avaliacao) || null;
    const min  = Number(imovel?.valor_minimo) || null;
    const nAmostras = mercado?.amostras?.length || mercado?.comparaveis?.length || mercado?.anuncios?.length || 0;
    const precoM2 = Number(mercado?.precoMedioM2) || null;
    const corpus = {
      valor_avaliacao: aval, valor_minimo: min,
      desconto_pct: (aval > 0 && min > 0) ? Math.round((1 - min / aval) * 100) : null,
      preco_medio_m2: precoM2,
      aluguel_medio: Number(mercado?.aluguelMedio) || null,
      fipe_zap_m2: Number(mercado?.referenciaFipeZap?.precoMedioM2) || null,
      n_amostras: nAmostras,
    };
    const qualidade = {
      avaliacao_ausente: !(aval > 0),
      minimo_ausente: !(min > 0),
      mercado_vazio: !(precoM2 > 0) && nAmostras === 0,
      sem_parecer: !temParecer,
    };
    await sb('agente_aprendizado', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        agente: 'mercadologico', imovel_id: String(imovel?.id || ''),
        cidade: imovel?.cidade || null, uf: imovel?.estado || null,
        tipo: imovel?.tipo || null, modalidade: imovel?.modalidade || null,
        corpus, qualidade,
      }),
    });
  } catch { /* aprendizado é best-effort: nunca bloqueia o relatório */ }
}

// Corpus coletivo (emissões anteriores) da MESMA região/tipo, como referência
// observacional no prompt. Só valores poison-resistentes (pesquisa/scraper). Custo: 1 SELECT.
async function corpusDaRegiao(uf, tipo) {
  try {
    if (!uf || !tipo) return '';
    const rows = await (await sb(`agente_aprendizado?agente=eq.mercadologico&uf=eq.${encodeURIComponent(uf)}&tipo=eq.${encodeURIComponent(tipo)}&select=corpus&order=criado_em.desc&limit=40`)).json();
    if (!Array.isArray(rows)) return '';
    const m2 = rows.map(r => Number(r?.corpus?.preco_medio_m2)).filter(v => v > 0);
    if (m2.length < 3) return '';
    const desc = rows.map(r => Number(r?.corpus?.desconto_pct)).filter(v => v >= 0);
    const med = Math.round(m2.reduce((a, b) => a + b, 0) / m2.length);
    const descMed = desc.length ? Math.round(desc.reduce((a, b) => a + b, 0) / desc.length) : null;
    return `\n\nCORPUS DA REGIÃO (${tipo} em ${uf}, ${m2.length} análises recentes, referência OBSERVACIONAL): preço médio observado ~R$ ${med}/m²${descMed != null ? `, desconto médio ~${descMed}%` : ''}. Use como sanity-check, nunca como verdade absoluta.`;
  } catch { return ''; }
}

// Confirmação SOB DEMANDA de VALORES no detalhe/edital (só quando um relatório é pedido —
// sem varredura em massa). Cobre dois casos:
//  - AVALIAÇÃO ausente (ex.: GrupoLance judicial — só vem no detalhe);
//  - LANCE MÍNIMO ausente/sentinela (ex.: o scraper anulou um 999999999 — regra do dono:
//    "se vier valor assim, acessar o edital pra confirmar o valor da venda").
// Corrige no banco (com desconto/score) e, o que não confirmar, SINALIZA como anomalia.
// Sem teto de valor absoluto (imóvel caro é válido) — só sanidade avaliação >= mínimo.
async function garantirValores(imovelId) {
  let im = null;
  try {
    const rows = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=fonte,url_lote,link_edital,valor_avaliacao,valor_minimo&limit=1`)).json();
    im = Array.isArray(rows) ? rows[0] : null;
  } catch { return; }
  if (!im) return;
  const SENT = new Set([999999999, 99999999, 9999999999, 111111111, 123456789]);
  const limpo = (v) => { const n = Number(v) || 0; return SENT.has(n) ? 0 : n; };
  let aval = limpo(im.valor_avaliacao);
  let vmin = limpo(im.valor_minimo);
  const faltaAval = aval <= 0, faltaMin = vmin <= 0;
  if (!faltaAval && !faltaMin) return; // nada a confirmar

  const url = im.url_lote || im.link_edital;
  if (url && /^https?:\/\//.test(url)) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(15000) });
      if (r.ok) {
        const txt = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
        const maiorPorRotulo = (re) => { let best = 0; for (const m of txt.matchAll(re)) { const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0; if (v > best) best = v; } return best; };
        if (faltaAval) { const a = maiorPorRotulo(/avalia[çc][aã]o[^R]{0,40}R\$\s*([\d.]+,\d{2})/gi); if (a >= 1000) aval = a; }
        if (faltaMin)  { const mn = maiorPorRotulo(/(?:lance\s*m[íi]nimo|valor\s*m[íi]nimo|lance\s*inicial|1[ºoª°]?\s*(?:leil[aã]o|pra[çc]a)|2[ºoª°]?\s*(?:leil[aã]o|pra[çc]a))[^R]{0,40}R\$\s*([\d.]+,\d{2})/gi); if (mn >= 1000) vmin = mn; }
      }
    } catch { /* segue */ }
  }

  const patch = {};
  if (faltaAval && aval > 0) patch.valor_avaliacao = aval;
  if (faltaMin && vmin > 0) patch.valor_minimo = vmin;
  const par = aval > 0 && vmin > 0 && aval >= vmin; // desconto só faz sentido com avaliação >= mínimo
  if (par && (patch.valor_avaliacao != null || patch.valor_minimo != null)) {
    patch.desconto_percentual = Math.round((1 - vmin / aval) * 100);
    patch.viavel = (1 - vmin / aval) >= 0.3;
    patch.score_viabilidade = Math.min(100, Math.round((1 - vmin / aval) * 150));
  }
  if (Object.keys(patch).length) {
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  }
  if (aval <= 0) await registrarAnomalia('avaliacao_ausente', im.fonte, imovelId, 'valor_avaliacao', `Avaliação não confirmada no detalhe/edital (${url || 'sem url'}).`);
  if (vmin <= 0) await registrarAnomalia('valor_minimo_ausente', im.fonte, imovelId, 'valor_minimo', `Lance mínimo não confirmado no detalhe/edital (${url || 'sem url'}).`);
}
// Pesquisa de mercado recente do MESMO imóvel (de qualquer usuário). Reaproveitada
// para não refazer a busca cara a cada pedido — só a data é renovada. O laudo
// (parecer) continua sendo gerado por pedido, pois depende do lance/cenário de cada um.
async function mercadoRecente(imovelId) {
  const desde = new Date(Date.now() - REUSE_DIAS * 24 * 3600 * 1000).toISOString();
  const r = await sb(`analises_mercado?imovel_id=eq.${encodeURIComponent(imovelId)}&status=eq.concluida&updated_at=gte.${desde}&select=result,updated_at&order=updated_at.desc&limit=1`);
  if (!r.ok) return null;
  const [row] = await r.json().catch(() => []);
  const mkt = row?.result?.mercado;
  // NÃO reaproveita pesquisa VAZIA (sem amostras nem preço): reusar um resultado
  // ruim propagaria o "mercadológico sem amostras". Melhor refazer a busca.
  if (mkt && (((mkt.vendas?.length || 0) + (mkt.locacoes?.length || 0)) > 0 || mkt.precoMedioM2 > 0)) {
    return { mercado: mkt, em: row.updated_at };
  }
  return null;
}

async function anthropic(payload, useSearch, fetchOpts) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (useSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';
  const r = await anthropicFetch({ method: 'POST', headers, body: JSON.stringify(payload) }, fetchOpts);
  return r.json();
}

export function promptMercado({ endereco, tipoImovel, areaM2, cidade, estado, nomeCondominio }) {
  return `Você é um perito avaliador imobiliário. Realize pesquisa de mercado COMPLETA em DOIS NÍVEIS para o imóvel:
- Tipo: ${tipoImovel}, ${areaM2 ? areaM2 + 'm²' : 'área não informada'}
- Endereço: ${endereco}, ${cidade}/${estado}
${nomeCondominio ? `- Condomínio: ${nomeCondominio}` : ''}

REGRA OBRIGATÓRIA — MESMO TIPO: considere SOMENTE imóveis do MESMO TIPO (${tipoImovel}).
Descarte qualquer amostra de tipo diferente. Compare sempre ${tipoImovel} com ${tipoImovel}.

MÉTODO DE AVALIAÇÃO POR TIPO (aplique o adequado ao tipo "${tipoImovel}"):
- Residencial (casa, apartamento): preço por m² de área privativa/construída, mesmo padrão e região.
- Terreno/lote: preço por m² de TERRENO (nunca de construção).
- Comercial (sala, loja, conjunto): preço por m² comercial na mesma vocação/região.
- Galpão/industrial: preço por m² de área CONSTRUÍDA, considerando pé-direito, docas e localização logística; use comparáveis de galpões, jamais residenciais.
- Rural (fazenda, sítio, chácara): avalie por HECTARE (não por m² de construção), considerando aptidão do solo (lavoura/pasto), recursos hídricos, benfeitorias e acesso; use comparáveis RURAIS da região.
- Atípico/outros (posto, hotel, imóvel especial, terreno de marinha): o mercado comparável é RASO. Busque o tipo específico; se não houver ao menos 3 a 4 amostras coerentes, diga EXPLICITAMENTE que a estimativa é apenas INDICATIVA, alargue a faixa (precoMinM2/precoMaxM2) e recomende laudo de avaliação presencial. NUNCA force uma média residencial de m² num imóvel atípico ou rural.
Se o tipo exigir outra unidade que não o m² de construção (ex.: rural por hectare, terreno por m² de lote), use essa unidade em precoMedioM2 e EXPLIQUE a unidade adotada em "comentario".

REGRA OBRIGATÓRIA — NADA DE LEILÃO NA AMOSTRA: descarte QUALQUER anúncio de leilão, praça,
hasta pública, venda direta bancária/Caixa, alienação fiduciária, extrajudicial/judicial ou
imóvel retomado. Esses preços ficam 30–60% abaixo do mercado e CONTAMINAM a média e o mínimo
(R$/m²). Compare só com o MERCADO LIVRE de venda normal. Outlier muito abaixo dos demais, sem
justificativa, também deve ser descartado como provável leilão disfarçado.

OBJETIVO: reunir o MÁXIMO de amostras possível. Faça várias buscas em fontes diferentes.

═══ NÍVEL 1 — COMPARATIVOS DIRETOS (mesmo condomínio/endereço) ═══
Busque o máximo de anúncios de venda E locação DENTRO do mesmo condomínio/edifício ou
na mesma rua. Se NÃO encontrar ao menos 5 amostras, EXPANDA o raio para ~250m ao redor
do endereço para complementar (mantendo o mesmo tipo de imóvel). Meta: 8+ vendas e 5+ locações.

═══ NÍVEL 2 — VIZINHANÇA (bairro e adjacências, ~1km) ═══
Busque o máximo de anúncios (mesmo tipo) no bairro e adjacências (~1km). Meta: 15+ vendas e 8+ locações.

FONTES (grandes portais): ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Loft, 123i, Chaves na Mão, Net Imóveis. Cruze várias.

FONTES LOCAIS (OBRIGATÓRIO — frequentemente MAIS confiáveis): além dos grandes portais, busque também ANÚNCIOS DE IMOBILIÁRIAS DA PRÓPRIA CIDADE de ${cidade}/${estado}. Pesquise por "imobiliária ${cidade}", "imóveis à venda ${cidade}" (e o bairro, se houver) e abra os sites das imobiliárias locais — os anúncios delas costumam refletir MELHOR o preço praticado na praça e podem ser COMPLEMENTARES ou até DECISIVOS na composição do valor. Inclua essas amostras nos níveis 1/2 com "fonte" = nome da imobiliária local, e dê PESO ao menos igual ao dos grandes portais quando forem recentes e do mesmo tipo/microrregião.

DATA DO ANÚNCIO: para CADA amostra, capture a data no campo "data" (formato "AAAA-MM"; senão "recente").
RECÊNCIA (IMPORTANTE): priorize FORTEMENTE anúncios do ANO CORRENTE e dos últimos ~12 meses. EVITE anúncios com mais de ~18 meses, a menos que não haja recentes suficientes — o preço muda rápido. Na média, dê MENOS peso às amostras antigas. Se a maioria das amostras for antiga (ex.: de anos anteriores), diga isso EXPLICITAMENTE no "comentario" e trate a estimativa como menos precisa (alargue precoMinM2/precoMaxM2).

═══ REFERÊNCIA INDEPENDENTE — ÍNDICE FipeZAP ═══
Busque o Índice FipeZAP mais recente para ${cidade}/${estado}: preço médio de VENDA por m²
(residencial), e a VALORIZAÇÃO acumulada em 12 meses da cidade. É uma referência oficial
independente da média de anúncios — serve para VALIDAR se nossa média está coerente. Se não
achar a cidade, use a região metropolitana/capital mais próxima e sinalize em "fonte". Se não
houver dado confiável, marque "encontrado": false (não invente número).

═══ ZONEAMENTO URBANO (uso do solo) ═══
Consulte o ZONEAMENTO OFICIAL do endereço no órgão municipal (Plano Diretor / Lei de Uso e Ocupação do Solo; em capitais use o GIS oficial: GeoSampa/SP, Data.Rio, IPPUC/Curitiba, BHMap/PBH etc.). Informe a ZONA e o que ela permite (residencial/comercial/misto; e gabarito/coeficiente de aproveitamento se constar) SOMENTE se achar em FONTE OFICIAL — e cite a fonte. Se NÃO houver fonte oficial confiável, marque "encontrado": false e diga exatamente ONDE obter (Secretaria de Urbanismo/Planejamento da Prefeitura, pelo endereço ou inscrição imobiliária). NUNCA invente ou especule a zona.

Retorne APENAS este JSON (sem markdown):
{
  "nivel1": { "descricao": "", "vendas": [{"descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0, "disponiveis": true },
  "nivel2": { "descricao": "", "vendas": [{"descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0 },
  "consolidado": { "precoMedioM2": 0, "aluguelMedio": 0, "yieldBruto": 0, "yieldLiquido": 0, "valorEstimadoImovel": 0, "descontoArremate": null },
  "referenciaFipeZap": { "encontrado": true, "precoMedioM2": 0, "valorizacao12m": 0, "mesReferencia": "AAAA-MM", "localidade": "", "fonte": "" },
  "zoneamento": { "encontrado": false, "zona": "", "resumoUso": "", "fonte": "", "ondeObter": "" },
  "comentario": "Análise qualitativa de 3-4 frases comparando os dois níveis, a tendência e a ADERÊNCIA da média dos anúncios ao FipeZAP (se divergirem >15%, explique por quê)."
}`;
}

// Bloco de débitos/encargos JÁ INFORMADOS que serão assumidos (entram como CUSTO
// na viabilidade). Se constam na documentação do lote → o parecer cita; se não
// constam → cita mesmo assim e aponta ONDE buscar/confirmar (referências).
function blocoDebitos(inp, docs, brlFn) {
  const itens = [];
  if (Number(inp.debitosAssumidos) > 0) itens.push(`Débitos assumidos (gerais): R$ ${brlFn(inp.debitosAssumidos)}`);
  if (Number(inp.iptuMensal) > 0) itens.push(`IPTU: R$ ${brlFn(inp.iptuMensal)}/mês`);
  if (Number(inp.condominioMensal) > 0) itens.push(`Condomínio: R$ ${brlFn(inp.condominioMensal)}/mês`);
  if (Number(inp.laudemio) > 0) itens.push(`Laudêmio: R$ ${brlFn(inp.laudemio)}`);
  if (Number(inp.foreiro) > 0) itens.push(`Foreiro/foro: R$ ${brlFn(inp.foreiro)}`);
  if (!itens.length) return '';
  const temDocs = !!(docs && (docs.edital || docs.matricula || (Array.isArray(docs.anexos) && docs.anexos.length)));
  return `
DÉBITOS/ENCARGOS A ASSUMIR (informados — JÁ ENTRAM como custo na viabilidade acima):
${itens.map(i => '- ' + i).join('\n')}
${temDocs
  ? 'A documentação do lote está disponível (edital/matrícula/anexos). Na seção de débitos, CONFIRME se cada débito acima consta na documentação; para os que constarem, cite a fonte; para os que NÃO estiverem discriminados, sinalize e indique onde obter (referências abaixo).'
  : 'A documentação detalhada do lote NÃO foi anexada. Na seção de débitos, liste-os e — como não há documento discriminando-os — oriente claramente ONDE buscar/confirmar cada um (referências abaixo).'}
REFERÊNCIAS para confirmar/obter os valores quando não constarem na documentação:
- IPTU e taxas municipais: certidão de débitos imobiliários na Prefeitura (Secretaria da Fazenda), pelo número de inscrição/IPTU.
- Condomínio: declaração de débitos condominiais com a administradora ou o síndico.
- Ônus, hipotecas e débitos propter rem: matrícula atualizada no Cartório de Registro de Imóveis competente.
- Responsabilidade por débitos após a arrematação (quem paga o quê): cláusulas do EDITAL do leilão.
- Laudêmio/foro (terreno de marinha): SPU — Secretaria de Patrimônio da União, ou o ente foreiro.`;
}

// Foco do parecer por PERFIL-BASE do investidor (triagem no cadastro). Direciona o
// que o agente prioriza — o mesmo imóvel se defende diferente para cada perfil.
const PERFIL_FOCO = {
  revenda: 'PERFIL DO COMPRADOR: REVENDA (flip). Priorize margem, velocidade de saída e liquidez de revenda; enfatize o teto de lance que preserva o lucro na revenda.',
  locacao: 'PERFIL DO COMPRADOR: LOCAÇÃO (renda). Priorize o yield (aluguel/preço), a renda mensal líquida e o payback pela locação; o cenário de revenda é secundário.',
  uso_proprio: 'PERFIL DO COMPRADOR: USO PRÓPRIO. Priorize a economia frente ao mercado e a adequação ao uso; o piso de 30% de lucro não se aplica.',
  incorporacao: 'PERFIL DO COMPRADOR: INCORPORAÇÃO. Priorize o POTENCIAL CONSTRUTIVO (terreno, aproveitamento e zoneamento) e a viabilidade de incorporar; avalie o valor pelo potencial, não só pelo imóvel atual.',
};

function promptParecer(inp, m, mercado, docs) {
  const usoProprio = inp.objetivoCompra === 'uso_proprio';
  const debitos = blocoDebitos(inp, docs, brl);
  const focoPerfil = PERFIL_FOCO[inp._perfil] || '';
  return `
Redija um PARECER EXECUTIVO MERCADOLÓGICO E DE VIABILIDADE FINANCEIRA como Gestor Sênior da BidPro Brasil.
${focoPerfil ? `\n${focoPerfil}\n` : ''}

ESCOPO ESTRITO: foque EXCLUSIVAMENTE em mercado × valor de aquisição e viabilidade
financeira. NÃO faça análise JURÍDICA (consulta de processo/CNJ, validade de penhora,
gravames, riscos de nulidade, diligências) — isso é dos relatórios DOCUMENTAL e
JURÍDICO. EXCEÇÃO: os DÉBITOS/ENCARGOS A ASSUMIR informados abaixo DEVEM constar,
pois são CUSTO da operação e impactam a viabilidade — apenas no aspecto financeiro
(valor e onde confirmar), sem entrar no mérito jurídico.

IMÓVEL: ${inp.tipo || inp.tipoImovel} — ${inp.endereco}, ${inp.cidade || ''}/${inp.estado || ''}
OBJETIVO: ${usoProprio ? 'USO PRÓPRIO' : 'INVESTIMENTO'}
${inp.nomeCondominio ? `CONDOMÍNIO: ${inp.nomeCondominio}` : ''}

MERCADO:
- Preço médio/m² (média dos anúncios): R$ ${brl(mercado?.precoMedioM2)}
- Aluguel médio: R$ ${brl(mercado?.aluguelMedio)} · Yield: ${(mercado?.yieldBruto || 0).toFixed(2)}% bruto / ${(mercado?.yieldLiquido || 0).toFixed(2)}% líquido
${mercado?.referenciaFipeZap?.encontrado ? `- Referência FipeZAP (${mercado.referenciaFipeZap.localidade || inp.cidade || ''}, ${mercado.referenciaFipeZap.mesReferencia || 'recente'}): R$ ${brl(mercado.referenciaFipeZap.precoMedioM2)}/m² · valorização 12m: ${(Number(mercado.referenciaFipeZap.valorizacao12m) || 0).toFixed(1)}%. Compare com a média dos anúncios acima: se divergirem muito, comente e use a mais conservadora na defesa.` : ''}
${mercado?.comentario ? `- Leitura de mercado: ${mercado.comentario}` : ''}

AQUISIÇÃO E RETORNO:
- Lance SEM disputa (lance base): R$ ${brl(inp.valorArrematacao)}
- Lance MÁXIMO COM disputa (preserva o piso de lucro): R$ ${brl(inp._teto)}
- Capital total aportado: R$ ${brl(m.capitalMobilizado)}
- Lucro/Economia estimada: R$ ${brl(m.lucro)}
- Retorno (ROI/ROE): ${(m.roi || 0).toFixed(2)}%
OBSERVAÇÕES: ${inp.observacoes || 'Sem observações adicionais'}
${debitos}

REGRA DE VIABILIDADE:
${usoProprio
  ? '- Como é USO PRÓPRIO, o piso de 30% de lucro NÃO se aplica. O foco é a ECONOMIA frente ao valor de mercado (quanto o comprador economiza ao adquirir no leilão em vez de no mercado). Defenda a aquisição pela economia e adequação ao uso.'
  : '- A operação só é VIÁVEL com no mínimo 30% de lucro líquido. Avalie SEM DISPUTA (lance base) e COM DISPUTA (até o lance máximo que ainda preserva 30%).'}

Escreva em português formal, texto simples (sem markdown/asteriscos e SEM travessão "—"; use vírgula, ponto ou dois-pontos, pois o travessão dá cara de texto gerado por IA e reduz a confiança do cliente). Estruture com "§ SEÇÃO:":
§ SEÇÃO: POSICIONAMENTO ESTRATÉGICO (mercado × valor de aquisição; desconto real frente ao mercado)
§ SEÇÃO: CENÁRIOS DE LANCE (sem disputa e com disputa; até onde dá para subir o lance mantendo ${usoProprio ? 'a economia' : 'o piso de 30%'})
§ SEÇÃO: PROJEÇÃO DE RENTABILIDADE (projeção de 12 MESES considerando o pagamento em parcelas até a revenda; deixe claro que VENDER ANTES dos 12 meses AUMENTA o lucro; cite ROI/ROE, yield de locação como alternativa e payback)${debitos ? '\n§ SEÇÃO: DÉBITOS E ENCARGOS ASSUMIDOS (liste os débitos informados que entram como custo; diga se constam na documentação do lote; para os que não constarem, aponte as referências de onde obter/confirmar)' : ''}
§ SEÇÃO: DEFESA DA OPERAÇÃO (argumentos objetivos de por que ${usoProprio ? 'a compra para uso compensa' : 'o investimento compensa'})
§ SEÇÃO: CONCLUSÃO E RECOMENDAÇÃO

IMPORTANTE — SE NÃO HOUVER VIABILIDADE${usoProprio ? ' (economia irrelevante frente ao mercado)' : ' (lucro abaixo de 30%)'}:
seja DIRETO e CURTO. Explique objetivamente O PORQUÊ (ex.: preço de aquisição próximo do
mercado, custos elevados, margem insuficiente) e recomende NÃO avançar. Não alongue o relatório.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel, mercadoInputs, parecerInputs } = body;
  if (!imovelId || !mercadoInputs) { res.status(400).json({ error: 'imovelId e mercadoInputs obrigatórios' }); return; }

  // Geração EM NOME DE (admin/analista ao atribuir um arremate manual): grava sob o
  // CLIENTE (para o relatório pertencer a ele) e não cobra cota — atribuição
  // administrativa gratuita. Só admin/analista pode; senão ignora e usa o próprio.
  let ownerId = user.id, onBehalf = false;
  if (body.paraUserId && body.paraUserId !== user.id) {
    try {
      const [p] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
      if (p && (p.role === 'admin' || p.role === 'analista')) { ownerId = String(body.paraUserId); onBehalf = true; }
    } catch { /* mantém o próprio */ }
  }

  // Data do leilão (para a regra de limpeza: 15 dias após o leilão sem arrematar).
  const rawData = imovel?.dataLeilao || parecerInputs?.d?.dataLeilao || null;
  const dataLeilao = rawData && !isNaN(Date.parse(rawData)) ? new Date(rawData).toISOString() : null;
  const base = { user_id: ownerId, imovel_id: String(imovelId), titulo: titulo || null, cidade: cidade || null, estado: estado || null, imovel: imovel || null, inputs: { mercadoInputs, parecerInputs }, data_leilao: dataLeilao };

  // ── Cota NO SERVIDOR (anti-abuso do custo de IA) ────────────────────────────
  // A cota é consumida aqui (onde o custo ocorre), não mais só no cliente — que
  // podia ser burlado chamando esta API direto. Cobra apenas em análise NOVA
  // deste imóvel para este usuário; re-gerar/atualizar o mesmo imóvel não recobra
  // (espelha o "isNovo" do cliente). Falha na checagem não trava quem tem direito.
  let cota = null;
  try {
    const jaConcluida = await (await sb(`analises_mercado?user_id=eq.${ownerId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=imovel_id&limit=1`)).json();
    const isNovo = !(Array.isArray(jaConcluida) && jaConcluida.length);
    if (isNovo && !onBehalf) {
      const rc = await sb('rpc/consumir_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) });
      cota = await rc.json().catch(() => null);
      if (cota && cota.ok === false) {
        const msg = cota.erro === 'limite_mensal' ? 'Limite mensal de análises atingido para o seu plano.'
          : cota.erro === 'sem_credito' ? 'Você não tem créditos de análise disponíveis.'
          : 'Cota de análises indisponível.';
        res.status(402).json({ error: msg, cota });
        return;
      }
    }
  } catch { /* checagem de cota nunca bloqueia quem tem direito */ }

  // Confirmação sob demanda dos VALORES (avaliação + lance mínimo) no detalhe/edital ANTES
  // de gerar — corrige avaliação zerada e valor sentinela; o que não confirmar vira anomalia.
  try { await garantirValores(String(imovelId)); } catch { /* nunca bloqueia o relatório */ }

  await upsertAnalise({ ...base, status: 'gerando', erro: null, result: null });

  // DEADLINE interno < maxDuration (300s). Sem isto, se a pesquisa de mercado (web
  // search, até 6 buscas) + o parecer passarem de 5 min, a Vercel MATA a função no
  // meio e o catch abaixo NUNCA roda — a linha fica presa em 'gerando' para sempre
  // (foi o que travou o relatório do Igor). Com o deadline, perdemos a corrida ANTES
  // do corte e gravamos 'erro' com mensagem clara, para o cliente poder tentar de novo.
  const DEADLINE_MS = 270000; // < maxDuration 300s, com folga p/ gravar 'erro' e responder
  const prazo = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo_limite')), DEADLINE_MS));

  try {
    const { result, valorMercado } = await Promise.race([prazo, (async () => {
    // 1) Mercado — reaproveita pesquisa recente do mesmo imóvel (se houver), senão busca.
    let mercado, reaproveitado = false;
    const recente = await mercadoRecente(String(imovelId));
    if (recente) {
      mercado = { ...recente.mercado, reaproveitado: true, pesquisaEm: recente.em };
      reaproveitado = true;
    } else {
      // A busca de mercado (web search) é a etapa lenta. O timeout PADRÃO do
      // anthropicFetch é 120s — CURTO DEMAIS para 5 buscas + geração: a chamada
      // abortava aos 120s e re-tentava, sem NUNCA concluir (era o motivo do erro
      // recorrente). Aqui damos uma janela real de ~200s numa tentativa só, dentro
      // do deadline de 270s (a etapa do parecer, curta, cabe no resto).
      const buscarMercado = async () => {
        const mData = await anthropic({
          model: MODEL, max_tokens: 8000,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
          system: `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo (${mercadoInputs.tipoImovel}). Retorne apenas JSON válido.`,
          messages: [{ role: 'user', content: promptMercado(mercadoInputs) }],
        }, true, { retries: 1, timeoutMs: 200000, noFallback: true });
        const m = parseJSON(extractText(mData)) || {};
        m.precoMedioM2 = m.consolidado?.precoMedioM2 || m.nivel2?.precoMedioM2 || 0;
        m.aluguelMedio = m.consolidado?.aluguelMedio || 0;
        m.yieldBruto = m.consolidado?.yieldBruto || 0;
        m.yieldLiquido = m.consolidado?.yieldLiquido || 0;
        m.vendas = m.nivel2?.vendas || [];
        m.locacoes = m.nivel2?.locacoes || [];
        m.pesquisaEm = new Date().toISOString();
        return m;
      };
      const semAmostras = (m) => ((m.vendas?.length || 0) + (m.locacoes?.length || 0)) === 0 && !(m.precoMedioM2 > 0);
      // Contramedida "mercadológico sem amostras": uma resposta VÁLIDA mas vazia (a
      // busca web falhou/rate-limit) não pode virar relatório final. Uma resposta vazia
      // costuma voltar rápido, então cabe UMA nova tentativa dentro do deadline.
      mercado = await buscarMercado();
      if (semAmostras(mercado)) mercado = await buscarMercado();
    }

    const areaM2 = Number(mercadoInputs.areaM2) || 0;
    const valorMercado = (mercado.precoMedioM2 && areaM2) ? Math.round(mercado.precoMedioM2 * areaM2 * 0.9) : null;
    const valorLocacao = mercado.aluguelMedio ? Math.round(mercado.aluguelMedio) : null;

    // 2) Laudo (parecer). Carrega os docs do lote para o parecer poder dizer se os
    // débitos informados já constam na documentação (ou apontar onde buscar).
    let parecer = '';
    if (parecerInputs?.d) {
      try {
        let docs = null;
        try {
          const [dRow] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=link_edital,link_matricula,link_regras_venda,anexos&limit=1`)).json();
          if (dRow) docs = { edital: dRow.link_edital, matricula: dRow.link_matricula, regras: dRow.link_regras_venda, anexos: dRow.anexos };
        } catch { /* sem docs → o parecer orienta onde buscar */ }
        // Perfil-base do investidor (triagem) — direciona o foco do parecer.
        let perfilInvestidor = null;
        try {
          const [p] = await (await sb(`perfis?id=eq.${ownerId}&select=perfil_investidor&limit=1`)).json();
          perfilInvestidor = p?.perfil_investidor || null;
        } catch { /* sem perfil → parecer padrão pelo objetivoCompra */ }
        const pInp = { ...parecerInputs.d, valorMercado: valorMercado || parecerInputs.d.valorMercado, _cenario: parecerInputs.cenario, _teto: parecerInputs.teto, _perfil: perfilInvestidor };
        // APRENDIZADO: correções que analistas fizeram em avaliações anteriores
        // (via transcrição de reunião → mercado_aprendizado) voltam ao prompt. No-op
        // enquanto não houver lições; fica mais assertivo com o uso.
        let aprendizadoMercado = '';
        try {
          const licoes = await (await sb('mercado_aprendizado?select=campo,valor_ia,valor_real,observacao&order=criado_em.desc&limit=30')).json();
          if (Array.isArray(licoes)) {
            const linhas = licoes
              .filter(l => l && (l.valor_real || l.observacao))
              .map(l => `- ${l.campo ? l.campo + ': ' : ''}o sistema estimou "${String(l.valor_ia || '—').slice(0, 100)}", o analista corrigiu para "${String(l.valor_real || '—').slice(0, 100)}"${l.observacao ? ` — ${String(l.observacao).slice(0, 160)}` : ''}`);
            if (linhas.length) aprendizadoMercado = `\n\nAPRENDIZADOS COM ANALISTAS (correções reais de avaliações anteriores — aplique estas lições e evite repetir os mesmos erros):\n${linhas.join('\n')}`;
          }
        } catch { /* aprendizado é best-effort */ }
        // Calibração por ARREMATES REAIS (previsto×realizado, por modalidade).
        try { aprendizadoMercado += await resumoAprendizadoTexto(imovel?.modalidade || null); } catch { /* best-effort */ }
        // Corpus coletivo da MESMA região/tipo (aprendizado das emissões anteriores).
        try { aprendizadoMercado += await corpusDaRegiao(imovel?.estado || null, imovel?.tipo || null); } catch { /* best-effort */ }
        const pData = await anthropic({
          model: MODEL, max_tokens: 8000,
          system: 'Você é gestor sênior da BidPro Brasil. Redija um parecer MERCADOLÓGICO e de VIABILIDADE FINANCEIRA. Não faça análise jurídica (CNJ, gravames, diligências) — isso é de outros relatórios. EXCEÇÃO: os débitos/encargos informados que serão assumidos DEVEM constar (são custo da operação), com a indicação de onde confirmá-los. Preciso e persuasivo. Nunca use markdown nem asteriscos. Nunca use travessão (o caractere "—"); escreva com vírgula, ponto ou dois-pontos. Apenas texto simples.' + aprendizadoMercado,
          messages: [{ role: 'user', content: promptParecer(pInp, parecerInputs.metricas || {}, mercado, docs) }],
        }, false, { retries: 1, timeoutMs: 55000, noFallback: true });
        parecer = extractText(pData);
      } catch { /* laudo é complementar */ }
    }

    // Lembrete fixo (não-IA): a análise é apoio e não substitui a verificação
    // presencial. Recomenda visitar o imóvel ou ver um similar com corretor.
    const AVISO_MERCADO = '§ SEÇÃO: LEMBRETE E PRÓXIMO PASSO\nEsta análise mercadológica é gerada com apoio de inteligência artificial e tem caráter informativo — pode conter imprecisões e não substitui a verificação presencial. Antes de decidir, recomendamos VISITAR o imóvel pessoalmente ou AGENDAR com um corretor de confiança para conhecer um imóvel similar na região, confirmando estado de conservação, localização e o valor praticado no mercado.';
    if (parecer) parecer += `\n\n${AVISO_MERCADO}`;

      const result = { mercado, parecer, valorMercado, valorLocacao, reaproveitado, pesquisaEm: mercado.pesquisaEm };
      return { result, valorMercado };
    })()]);

    await upsertAnalise({ ...base, status: 'concluida', erro: null, result });
    // Aprende NA EMISSÃO (durável, sem IA): corpus + qualidade → agente_aprendizado.
    await aprenderNaEmissao(imovel, mercado, !!parecer);

    // SEGURANÇA: NÃO realimentar o score do CARD do catálogo com valores desta análise.
    // roi (parecerInputs.metricas) e areaM2 (mercadoInputs) vêm do CLIENTE e são
    // por-cenário — assim um usuário conseguia ENVENENAR score_financeiro/analise_viavel/
    // valor_mercado que TODOS veem naquele imóvel. O score do catálogo é calculado pelo
    // processo confiável (api/calcular-score.js) a partir dos dados do PRÓPRIO imóvel,
    // nunca por input de usuário. A análise individual continua salva acima (upsertAnalise)
    // e visível só para quem a gerou.
    res.status(200).json({ ok: true, result, cota });
  } catch (e) {
    const timeout = String(e?.message) === 'tempo_limite';
    const msg = timeout
      ? 'A pesquisa de mercado demorou mais que o tempo limite do servidor. Costuma ser temporário: tente gerar novamente.'
      : String(e?.message || e);
    await upsertAnalise({ ...base, status: 'erro', erro: msg });
    // Estorna a cota consumida (não cobra por análise que falhou; evita cobrança
    // dupla na re-tentativa, já que 'erro' não conta como concluída em isNovo).
    if (cota && cota.ok && cota.tipo) {
      try { await sb('rpc/estornar_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
    }
    res.status(timeout ? 504 : 500).json({ error: timeout ? 'Tempo limite ao gerar a análise' : 'Falha ao gerar a análise', detalhe: msg });
  }
}
