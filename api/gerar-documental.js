// Geração da ANÁLISE DOCUMENTAL + PROCESSO NO SERVIDOR (persistente).
// Lê edital, matrícula e demais anexos do lote (via Bright Data quando o host
// bloqueia o servidor), extrai ônus/gravames/débitos/ocupação e CONSULTA o CNJ.
// O cliente dispara e pode FECHAR a aba: a função Vercel continua e grava em
// `analises_documental`. Espelha a mecânica de gerar-analise.js (mercadológico).
//
// ESCOPO: documental/jurídico (leitura dos documentos + processo). A viabilidade
// financeira e o mercado ficam no relatório MERCADOLÓGICO (gerar-analise.js).
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { fetchViaBrightData } from './_brightdata.js';
import { anthropicFetch } from './_claude.js';
import { buscarProcessosCNJ } from './_cnj.js';
import { consultarComunicaDJEN, consultarCNDT, consultarCNIB, consultarProtestos } from './_laudo-fontes.js';
import { consultarCertidoesFiscais } from './_certidoes-fontes.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertDoc(row) {
  await sb('analises_documental?on_conflict=user_id,imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

// ── Cache de documentos no bucket privado `documentos` ──────────────────────
// O servidor recebe 403 nos PDFs da Caixa (IP de datacenter) e cai no Bright Data
// (IP residencial), que tem TETO SEMANAL. Cachear o PDF baixado evita re-baixar
// nas re-gerações e no laudo de viabilidade — economiza Bright Data. A retenção
// (5d sem reunião / 30d com reunião / permanente se arrematou) é do cron.
const BUCKET = 'documentos';
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s || '');
function storage(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(opts.headers || {}) },
  });
}
function tipoDoRotulo(rotulo) {
  const r = String(rotulo || '').toLowerCase();
  if (r.includes('matríc') || r.includes('matric')) return 'matricula';
  if (r.includes('edital')) return 'edital';
  if (r.includes('regras')) return 'regras_venda';
  return null; // anexos genéricos não entram no cache por tipo
}
// Documentos já ARMAZENADOS deste imóvel (manual do analista ou cache anterior).
async function mapaCache(imovelId) {
  try {
    const rows = await (await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(imovelId)}&storage_path=not.is.null&select=tipo,storage_path&limit=10`)).json();
    const m = {};
    for (const x of (Array.isArray(rows) ? rows : [])) if (x?.tipo && !m[x.tipo]) m[x.tipo] = x;
    return m;
  } catch { return {}; }
}
async function lerDocDoBucket(storagePath) {
  try {
    const sign = await storage(`object/sign/${BUCKET}/${storagePath}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 600 }),
    });
    if (!sign.ok) return null;
    const { signedURL } = await sign.json().catch(() => ({}));
    if (!signedURL) return null;
    const r = await fetch(`${SUPABASE_URL}/storage/v1${signedURL}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;
    return { kind: 'pdf', base64: buf.toString('base64') };
  } catch { return null; }
}
// Salva o PDF baixado no bucket (só se AINDA não houver doc armazenado do tipo —
// nunca sobrescreve um upload manual do analista). Best-effort: nunca trava o laudo.
async function salvarDocBucket(imovelId, tipo, rotulo, origemUrl, base64, dataLeilaoIso) {
  try {
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length || buffer.length > 20 * 1024 * 1024) return;
    const storagePath = `casos/${imovelId}/${Date.now()}_${tipo}.pdf`;
    const up = await storage(`object/${BUCKET}/${storagePath}`, {
      method: 'POST', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'true' }, body: buffer,
    });
    if (!up.ok) return;
    let url = '';
    try {
      const s = await storage(`object/sign/${BUCKET}/${storagePath}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600 }) });
      if (s.ok) { const { signedURL } = await s.json().catch(() => ({})); if (signedURL) url = `${SUPABASE_URL}/storage/v1${signedURL}`; }
    } catch { /* url fica '' — os leitores assinam sob demanda pelo storage_path */ }
    const payload = {
      imovel_id: imovelId, tipo, nome: `${rotulo}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_'),
      url, storage_path: storagePath, origem_url: origemUrl || null,
      data_leilao: dataLeilaoIso ? String(dataLeilaoIso).slice(0, 10) : null,
      arrematado: false, tamanho_kb: Math.round(buffer.length / 1024),
    };
    await sb('imovel_anexos', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(payload) });
  } catch { /* cache best-effort */ }
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
async function anthropic(payload, fetchOpts) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const r = await anthropicFetch({ method: 'POST', headers, body: JSON.stringify(payload) }, fetchOpts);
  return r.json();
}

// Documentos ESTÁTICOS da Caixa (venda-imoveis.caixa.gov.br). O portal grava no
// banco links de página (matricula.asp / detalhe-imovel.asp) que NÃO são o arquivo
// — a matrícula e as regras reais são PDFs estáticos. Sem isto, imóvel da Caixa
// chegava à IA sem NENHUM documento legível → laudo bloqueado. O IP de datacenter
// recebe 403 nesses PDFs, mas o lerDoc cai no Bright Data (IP residencial) e lê.
const ehCaixa = (fonte) => /caixa|cef/i.test(fonte || '');
function caixaMatriculaUrl({ fonte, estado, fonteId } = {}) {
  if (!ehCaixa(fonte)) return null;
  const num = String(fonteId || '').replace(/\D/g, '');
  const uf = String(estado || '').trim().toUpperCase();
  if (!num || uf.length !== 2) return null;
  return `https://venda-imoveis.caixa.gov.br/editais/matricula/${uf}/${num}.pdf`;
}
function caixaRegrasVendaUrl({ fonte } = {}) {
  if (!ehCaixa(fonte)) return null;
  return 'https://venda-imoveis.caixa.gov.br/editais/regras-VOL/comocomprar.pdf';
}

// Lê um documento do lote: PDF → base64 (bloco document); HTML/texto → texto
// limpo. Tenta fetch direto e cai no Bright Data quando o host bloqueia o servidor.
async function lerDoc(url, deadline) {
  if (!url || !/^https?:\/\//.test(url) || Date.now() > deadline) return null;
  const h = { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' };
  const ehPdfUrl = /\.pdf(\?|#|$)/i.test(url);

  // Extrai um documento útil de UMA resposta (fetch direto OU Bright Data). Só aceita
  // PDF de verdade quando a URL é .pdf — assim o HTML de negação da Caixa (200) NÃO
  // vira "texto lixo" que faz a IA dizer que não leu nada.
  const extrair = async (resp) => {
    if (!resp || !resp.ok) return null;
    const ct = resp.headers.get('content-type') || '';
    const buf = Buffer.from(await resp.arrayBuffer().catch(() => new ArrayBuffer(0)));
    if (!buf.length) return null;
    const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
    if (ehPdf) { if (buf.length > 6_500_000) return null; return { kind: 'pdf', base64: buf.toString('base64'), url }; }
    if (ehPdfUrl) return null; // .pdf que não veio PDF = bloqueio/HTML → falha desta tentativa
    const txt = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (txt.length < 80) return null;
    return { kind: 'text', text: txt.slice(0, 12000), url };
  };

  // 1) fetch direto (grátis). 2) Bright Data (IP residencial) — fura o 403 da Caixa
  // nos PDFs. Aceita o 1º que render um documento válido; para .pdf, o direto que
  // trouxer HTML de negação é descartado e o Bright Data assume.
  let doc = null;
  try { doc = await extrair(await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(12000) })); } catch { doc = null; }
  if (doc) { console.log(`[lerDoc] direto OK (${doc.kind}) ${url}`); return doc; }
  if (Date.now() > deadline) return null;
  // Bright Data: manda cabeçalhos que a Caixa espera (senão devolve HTML de negação
  // em vez do PDF). Loga o status para diagnóstico (token x bloqueio da fonte).
  const ehCaixaUrl = /venda-imoveis\.caixa\.gov\.br/i.test(url);
  const bdHeaders = ehCaixaUrl
    ? { 'User-Agent': UA, Referer: 'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp', Accept: 'application/pdf,application/octet-stream,*/*' }
    : { 'User-Agent': UA, Accept: '*/*' };
  try {
    const bd = await fetchViaBrightData(url, { headers: bdHeaders });
    if (bd) {
      const bdClone = bd.clone();
      console.log(`[lerDoc] brightdata resp status=${bd.status} ct=${bd.headers.get('content-type') || ''} ${url}`);
      doc = await extrair(bd);
      if (!doc) {
        const snippet = (await bdClone.text().catch(() => '')).slice(0, 300).replace(/\s+/g, ' ');
        console.log(`[lerDoc] brightdata body[0..300]: ${snippet}`);
      }
    } else console.log(`[lerDoc] brightdata indisponível (token/zone ausente ou teto) ${url}`);
  } catch (e) { console.warn(`[lerDoc] brightdata erro ${e?.message} ${url}`); doc = null; }
  console.log(`[lerDoc] brightdata ${doc ? 'OK ('+doc.kind+')' : 'FALHOU'} ${url}`);
  return doc;
}

const promptDocumental = (im, temProc) => `Você é advogado especialista em leilões de imóveis. Analise os DOCUMENTOS anexados (edital, matrícula e demais anexos do lote)${temProc ? ' e os PROCESSOS consultados no CNJ' : ''} e produza uma ANÁLISE DOCUMENTAL E JURÍDICA do imóvel:
- Tipo: ${im.tipo || 'imóvel'} — ${im.endereco || ''}, ${im.cidade || ''}/${im.estado || ''}
- Modalidade: ${im.modalidade || 'não informada'}

ESCOPO: leitura dos documentos e situação processual. NÃO faça análise de mercado/preço/viabilidade financeira (isso é do relatório MERCADOLÓGICO).

Avalie e descreva: ônus reais, gravames, hipotecas, penhoras, arrestos, indisponibilidades, usufruto, alienação fiduciária; ocupação (ocupado/desocupado/posseiro/locado) e quem responde pela desocupação; débitos discriminados (IPTU, condomínio, taxas) e DE QUEM é a responsabilidade após a arrematação (conforme o edital); condições do edital (forma de pagamento, prazos, comissão, AJG); restrições registrárias; e a situação do(s) processo(s).

REGISTRO DO IMÓVEL: extraia do CABEÇALHO da matrícula o CARTÓRIO/SERVENTIA de Registro de Imóveis (com o número do Ofício, ex.: "1º Ofício de Registro de Imóveis"), a COMARCA/município do registro e o número da MATRÍCULA. Esses dados constam no topo de toda matrícula. Preencha "cartorio", "comarca" e "numeroMatricula" em "extracao" quando constarem; se não houver matrícula legível, deixe vazio (não invente).

DADOS-CHAVE DA MATRÍCULA (quando constarem — preencha em "extracao"; se não constar, deixe vazio, NÃO invente):
- "dataConsolidacao": data da CONSOLIDAÇÃO DA PROPRIEDADE em nome do credor fiduciário (típico de alienação fiduciária/Lei 9.514, na averbação "Av-"), formato AAAA-MM-DD. É determinante para os prazos do ex-mutuário — capture se houver.
- "indisponibilidadePenhora": há INDISPONIBILIDADE, PENHORA, ARRESTO ou bloqueio ATIVO na matrícula? Responda "sim", "nao" ou "nao_consta".
- "condominioNome" e "condominioCnpj": nome do condomínio e CNPJ, se o imóvel for em condomínio (útil para levantar o débito condominial).

CUSTOS DO EDITAL (importantes p/ a projeção financeira): capture a comissão do leiloeiro e, SE HOUVER, a TAXA ADMINISTRATIVA do leilão/portal (percentual sobre a arrematação, ALÉM da comissão do leiloeiro — comum na Superbid) em "taxaAdministrativaPercentual", e eventuais DESPESAS ADMINISTRATIVAS de valor fixo em "despesasAdministrativas". Se o edital não mencionar, deixe 0.

REGRA IMPORTANTE: se algum dado (ex.: débitos, ônus, ocupação) NÃO estiver discriminado nos documentos disponíveis, NÃO invente — sinalize como "não consta na documentação analisada" e indique ONDE confirmar (certidão de débitos na Prefeitura; declaração de débitos com a administradora/síndico; matrícula atualizada no Cartório de Registro de Imóveis; cláusulas do edital; SPU para laudêmio/foro).

CLASSIFICAÇÃO DE RISCO — REGRAS ESTRITAS (evite alarmismo; leilão de imóvel tem particularidades legais que o comprador leigo desconhece):
- AUSÊNCIA DE INFORMAÇÃO NÃO É RISCO BLOQUEANTE. Quando um dado não consta nos documentos, é DILIGÊNCIA PENDENTE — severidade "informativo" (no máximo "alerta"), NUNCA "bloqueante". Falta de documento é "a confirmar", não "operação inviável".
- ITENS COMUNS E ESPERADOS EM LEILÃO, que a LEI resolve e NÃO impedem a arrematação (classifique "informativo" ou "alerta", sempre com a nota legal — jamais "bloqueante"):
  • Penhora/execução que originou o leilão: é o que levou o bem à hasta; baixada com a arrematação.
  • Hipoteca: EXTINGUE-SE com a arrematação (art. 1.499, VI, CC; art. 903 CPC) — o arrematante recebe livre do gravame.
  • Indisponibilidades/bloqueios da execução (BACENJUD/RENAJUD/CNIB): levantados na expedição da carta de arrematação.
  • Ocupação (devedor/terceiro): o juízo garante a IMISSÃO DE POSSE ao arrematante no leilão judicial — é questão de PRAZO e CUSTO, não impedimento.
- "BLOQUEANTE" é reservado a RISCO CONCRETO E COMPROVADO nos documentos que realmente inviabiliza: cláusula real de inalienabilidade, indisponibilidade que NÃO se resolve com a arrematação, ação anulatória do próprio leilão em curso, vício grave no edital, bem de família com impedimento específico. NA DÚVIDA, use "alerta", não "bloqueante".
- Se NÃO houver documento legível, NÃO produza um laudo marcando tudo como "não consta/bloqueante" — apenas registre que os documentos precisam ser obtidos (nível de risco "amarelo", não "vermelho").

VALORES A LEVANTAR (OBRIGATÓRIO sinalizar como pendência/diligência quando não vierem discriminados em R$ nos documentos):
- LAUDÊMIO E FORO/PENSÃO: se a matrícula/edital indicar imóvel FOREIRO, AFORADO, terreno de MARINHA ou da UNIÃO/SPU, avise que há laudêmio (≈5%) e foro a pagar e que o VALOR PRECISA SER LEVANTADO na SPU/SPUnet antes do lance.
- DÉBITOS CONDOMINIAIS: se houver condomínio e o valor do débito não estiver discriminado, avise que o débito condominial precisa ser levantado com a administradora/síndico (pode ser propter rem — acompanha o imóvel).
- IPTU/TAXAS: se o IPTU/taxas em aberto não estiverem discriminados, avise que precisam ser levantados na Prefeitura.
Coloque cada um desses como item em "lacunas" e cite na seção DÉBITOS E RESPONSABILIDADES do parecer.

OCUPAÇÃO POR PESSOA VULNERÁVEL (risco de desocupação — avaliar SEMPRE, em TODO imóvel, independentemente do status de ocupação declarado, e com atenção redobrada em leilão EXTRAJUDICIAL da Lei 9.514/97, onde não há processo judicial prévio):
- O status "ocupado/desocupado" do edital NÃO é confiável: é comum o imóvel dito "desocupado" ter moradores e o dito "ocupado" estar vazio. Portanto NUNCA descarte o risco de vulnerabilidade só porque o edital diz "desocupado" — a verificação em campo é indispensável em qualquer caso.
- A presença de IDOSO (Estatuto do Idoso, Lei 10.741/03), PESSOA COM DEFICIÊNCIA, CRIANÇA/ADOLESCENTE ou pessoa em vulnerabilidade social no imóvel é o principal fator de RESISTÊNCIA e ATRASO na imissão de posse/desocupação (liminares humanitárias, atuação do Ministério Público/Defensoria, repercussão social). Classifique como "alerta" (é questão de prazo/custo/estratégia, NUNCA "bloqueante").
- NÃO é possível — nem lícito — confirmar isso remotamente por dados de saúde: o cadastro do SUS/CNS é DADO PESSOAL SENSÍVEL protegido pela LGPD (art. 11), de acesso restrito ao sistema de saúde. NÃO afirme ter consultado essa base, NÃO invente idade/condição do ocupante.
- Em TODO imóvel, registre em "riscos" o item de possível vulnerabilidade na ocupação (severidade "alerta") e recomende as diligências LÍCITAS de verificação: (a) consulta processual pública — se for leilão JUDICIAL, checar no processo o marcador de PRIORIDADE DE TRAMITAÇÃO (idoso/PcD/doença grave), que é público; (b) visita ao imóvel e diligência de vizinhança (imprescindível — o status do edital não substitui); (c) leitura atenta do edital/auto de constatação, que às vezes descreve os ocupantes. Cite isso na seção OCUPAÇÃO E POSSE do parecer.

RAIO-X JURÍDICO (preencha o objeto "raioX" a partir da matrícula, do edital e do CNJ. Quando um item NÃO constar nos documentos, deixe vazio/zero — NÃO invente):
1) CADEIA DOMINIAL: sequência de proprietários e atos da matrícula (registros "R-" e averbações "Av-"), com data e evento (compra e venda, doação, penhora, baixa de ônus...). Do mais recente ao mais antigo, no máximo 10.
2) CERTIDÕES RECOMENDADAS: as que o arrematante deve obter antes do lance, com órgão e por quê (ônus reais atualizada no CRI; distribuidores cível/trabalhista/federal do executado p/ checar fraude à execução; CND de IPTU; declaração de débitos do condomínio). "online": true quando é emitida grátis pela internet.
3) FRAUDE À EXECUÇÃO/CONTRA CREDORES: cruzando o executado com o CNJ, o risco de a arrematação ser anulada (transmissão do bem após o início da ação; outras execuções contra o devedor). risco "nenhum|baixo|medio|alto" + motivo curto.
4) OCUPAÇÃO DETALHADA: tipo, direitos do ocupante (ex.: locatário com preferência), procedimento e prazo/custo estimado de desocupação.
5) DIREITO DE PREFERÊNCIA/ADJUDICAÇÃO DE TERCEIROS: condômino, locatário, credor hipotecário/fiduciário, confrontante (rural). Liste os titulares.
6) DÉBITOS PROPTER REM × PESSOAIS: separe o que ACOMPANHA o imóvel (IPTU, condomínio, taxas) do que é pessoal do devedor. Estime o total que o ARREMATANTE assume em R$; se não der, marque aLevantar=true.
7) CRONOGRAMA DO LEILÃO: 1ª e 2ª praça, prazo de pagamento e prazo de embargos/recursos, conforme o edital.

Retorne APENAS este JSON (sem markdown):
{
  "extracao": { "numeroMatricula": "", "cartorio": "(nome do Cartório/Serventia de Registro de Imóveis onde a matrícula está registrada — inclua o Ofício, ex.: '2º Ofício de Registro de Imóveis'; extraia do CABEÇALHO da matrícula, se constar)", "comarca": "(comarca/município do registro de imóveis, do cabeçalho da matrícula, se constar)", "numeroEdital": "", "numeroProcesso": "", "executadoNome": "(nome do executado/devedor/ex-mutuário/proprietário, se constar)", "executadoDoc": "(CPF ou CNPJ do executado/devedor, só dígitos, se constar)", "dataConsolidacao": "(AAAA-MM-DD da consolidação da propriedade pelo credor fiduciário, se constar; senão vazio)", "indisponibilidadePenhora": "sim|nao|nao_consta", "condominioNome": "", "condominioCnpj": "", "origem": "judicial|extrajudicial", "dataLeilao": "AAAA-MM-DD (data do leilão/praça OU prazo final das propostas na licitação/venda — o que constar no edital; senão vazio)", "ocupacao": "", "responsavelDesocupacao": "", "debitosDiscriminados": [{"tipo":"","valor":0,"responsavel":"","constaNaDoc":true}], "responsabilidadeDebitos": "", "formaPagamento": "", "comissaoLeiloeiro": "", "taxaAdministrativaPercentual": 0, "despesasAdministrativas": 0 },
  "raioX": {
    "cadeiaDominial": [{"ato":"","data":"AAAA-MM-DD","evento":"","parte":""}],
    "certidoesRecomendadas": [{"nome":"","orgao":"","online":false,"motivo":""}],
    "fraudeExecucao": {"risco":"nenhum|baixo|medio|alto","motivo":""},
    "ocupacaoDetalhe": {"tipo":"desocupado|proprietario|locatario|posseiro|comodato|invasao|nao_consta","direitos":"","procedimentoDesocupacao":"","prazoMeses":0,"custoEstimado":0},
    "direitoPreferencia": {"existe":false,"titulares":[]},
    "debitos": {"totalAssumidoArrematante":0,"propterRem":[],"pessoais":[],"aLevantar":true},
    "cronogramaLeilao": {"primeiraPraca":"","segundaPraca":"","prazoPagamento":"","prazoEmbargos":""}
  },
  "riscos": [{"categoria":"","descricao":"","severidade":"bloqueante|alerta|informativo","constaNaDoc":true}],
  "lacunas": ["dados que NÃO constam na documentação e onde confirmar"],
  "nivelRisco": "verde|amarelo|vermelho",
  "parecer": "Parecer documental/jurídico em português formal, texto simples (sem markdown/asteriscos e SEM travessão '—'; use vírgula, ponto ou dois-pontos, pois o travessão dá cara de texto de IA), estruturado com '§ SEÇÃO:'. § SEÇÃO: SITUAÇÃO REGISTRÁRIA (matrícula/ônus/gravames); § SEÇÃO: OCUPAÇÃO E POSSE; § SEÇÃO: DÉBITOS E RESPONSABILIDADES (o que consta e o que precisa ser confirmado, com as referências); § SEÇÃO: CONDIÇÕES DO EDITAL; § SEÇÃO: SITUAÇÃO PROCESSUAL${temProc ? ' (com base no CNJ)' : ''}; § SEÇÃO: CONCLUSÃO E DILIGÊNCIAS RECOMENDADAS."
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  // Análise documental e jurídica NÃO pertence ao Explorador (só a partir do
  // Investidor Pro). Bloqueia no servidor — à prova de burla pela API.
  try {
    const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
    if (!perfil || perfil.role === 'explorador' || perfil.role == null) {
      res.status(402).json({ error: 'A análise documental e jurídica está disponível a partir do plano Investidor Pro.', upgrade: true });
      return;
    }
  } catch { /* se a checagem falhar, não trava quem tem direito */ }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel } = body;
  if (!imovelId) { res.status(400).json({ error: 'imovelId obrigatório' }); return; }

  // Geração EM NOME DE (admin/analista ao atribuir arremate manual): grava sob o
  // cliente e não cobra cota (atribuição administrativa gratuita).
  let ownerId = user.id, onBehalf = false;
  if (body.paraUserId && body.paraUserId !== user.id) {
    try {
      const [p] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
      if (p && (p.role === 'admin' || p.role === 'analista')) { ownerId = String(body.paraUserId); onBehalf = true; }
    } catch { /* mantém o próprio */ }
  }

  // ── Cota documental NO SERVIDOR (anti-abuso do custo de IA) ─────────────────
  // Mesmo padrão do mercadológico (gerar-analise): cobra só em análise NOVA deste
  // imóvel; re-gerar/atualizar o mesmo não recobra. Explorador já foi barrado
  // acima; admin é ilimitado na RPC. O limite por plano vem de limite_ia (banco).
  let cota = null; // hoisted p/ permitir estorno no catch se a geração falhar
  try {
    const jaFeita = await (await sb(`analises_documental?user_id=eq.${ownerId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=imovel_id&limit=1`)).json();
    const isNovo = !(Array.isArray(jaFeita) && jaFeita.length);
    if (isNovo && !onBehalf) {
      const rc = await sb('rpc/consumir_documental_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) });
      cota = await rc.json().catch(() => null);
      if (cota && cota.ok === false) {
        const msg = cota.erro === 'limite_mensal' ? 'Limite mensal de análises documentais atingido para o seu plano.'
          : cota.erro === 'sem_documental' ? 'A análise documental e jurídica não está incluída no seu plano.'
          : 'Cota de análises documentais indisponível.';
        res.status(402).json({ error: msg, cota });
        return;
      }
    }
  } catch { /* checagem de cota nunca bloqueia quem tem direito */ }

  // Carrega os documentos do lote do banco (fonte da verdade).
  let row = null;
  try {
    const [r] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=tipo,endereco,cidade,estado,modalidade,fonte,fonte_id,link_edital,link_matricula,link_regras_venda,anexos,numero_processo,ficha_cef,data_leilao&limit=1`)).json();
    row = r || null;
  } catch { /* segue com o que veio no body */ }

  const im = {
    tipo: imovel?.tipo || row?.tipo, endereco: imovel?.endereco || row?.endereco,
    cidade: cidade || imovel?.cidade || row?.cidade, estado: estado || imovel?.estado || row?.estado,
    modalidade: imovel?.modalidade || row?.modalidade,
  };
  const dataLeilao = (() => {
    const raw = imovel?.dataLeilao || null;
    return raw && !isNaN(Date.parse(raw)) ? new Date(raw).toISOString() : null;
  })();

  const base = { user_id: ownerId, imovel_id: String(imovelId), titulo: titulo || im.endereco || null, cidade: im.cidade || null, estado: im.estado || null, imovel: imovel || null, inputs: body.inputs || null, data_leilao: dataLeilao };
  await upsertDoc({ ...base, status: 'gerando', erro: null, result: null });

  // Orçamento da fase de COLETA (leitura de docs + CNJ): capado em 165s para SOBRAR
  // tempo para a IA (extração) + consultas de fontes + gravação, tudo dentro do
  // maxDuration de 300s. Antes eram 250s aqui e a chamada de IA depois estourava.
  const deadline = Date.now() + 165000;
  // DEADLINE HARD do handler inteiro (< maxDuration 300s): se qualquer etapa travar/
  // re-tentar além disso, perdemos a corrida e gravamos 'erro' — a linha NUNCA fica
  // presa em 'gerando' (mesmo problema que travou o mercadológico do Igor).
  const DEADLINE_MS = 285000;
  const prazo = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo_limite')), DEADLINE_MS));
  try {
    const result = await Promise.race([prazo, (async () => {
    // 1) Reúne os documentos. ORDEM IMPORTA: os arquivos JÁ GUARDADos no nosso storage
    //    (imovel_anexos — captura por navegador OU upload manual) vêm PRIMEIRO. São
    //    URLs assinadas, de leitura direta e confiável. As URLs cruas da Caixa vêm por
    //    último (falham por sessão e QUEIMAVAM o tempo da coleta antes de chegar no
    //    arquivo que já temos — era por isso que pedia anexo mesmo com a matrícula pronta).
    const anexos = Array.isArray(row?.anexos) ? row.anexos : [];
    const urls = [];
    const ehPagina = (u) => /matricula\.asp|detalhe-imovel\.asp/i.test(u || '');
    const add = (u, rotulo) => { if (u && /^https?:\/\//.test(u) && !ehPagina(u) && !urls.find(x => x.url === u)) urls.push({ url: u, rotulo }); };
    // 1º: anexos guardados no storage (capturados por navegador ou enviados pela equipe).
    try {
      const manuais = await (await sb(`imovel_anexos?imovel_id=eq.${encodeURIComponent(String(imovelId))}&order=criado_em.desc&select=tipo,nome,url&limit=10`)).json();
      for (const a of (Array.isArray(manuais) ? manuais : [])) add(a.url, a.nome || (a.tipo ? a.tipo[0].toUpperCase() + a.tipo.slice(1) : 'Anexo'));
    } catch { /* segue com os do lote */ }
    // 2º: anexos capturados no scrape (jsonb do lote).
    for (const a of anexos) { if (urls.length >= 7) break; add(a.url, a.nome || 'Anexo'); }
    // 3º: URLs do cliente + os PDFs estáticos da Caixa (fallback quando não há arquivo guardado).
    const cxFonte = { fonte: row?.fonte, estado: row?.estado || estado, fonteId: row?.fonte_id };
    add(body?.urlMatricula, 'Matrícula');
    add(caixaMatriculaUrl(cxFonte), 'Matrícula (Caixa)');
    add(row?.link_matricula, 'Matrícula');
    add(row?.link_edital || body?.urlEdital, 'Edital');
    add(body?.urlRegras, 'Regras de venda');
    add(caixaRegrasVendaUrl(cxFonte), 'Regras de venda (Caixa)');
    add(row?.link_regras_venda, 'Regras de venda');

    // Cache-first: documentos já armazenados deste imóvel (poupa Bright Data).
    const podeCache = isUuid(String(imovelId));
    const cache = podeCache ? await mapaCache(String(imovelId)) : {};
    const blocos = [];
    const lidos = [];
    for (const u of urls) {
      if (blocos.length >= 4 || Date.now() > deadline) break; // limita custo/payload
      const tipoDoc = tipoDoRotulo(u.rotulo);
      let doc = null, deCache = false;
      // 1) Se já temos o PDF no bucket (manual do analista ou cache anterior), lê de lá.
      if (podeCache && tipoDoc && cache[tipoDoc]?.storage_path) {
        doc = await lerDocDoBucket(cache[tipoDoc].storage_path);
        if (doc) deCache = true;
      }
      // 2) Senão, lê da fonte (fetch direto → Bright Data) e GUARDA para a próxima.
      if (!doc) {
        doc = await lerDoc(u.url, deadline);
        if (doc?.kind === 'pdf' && doc.base64 && podeCache && tipoDoc && !cache[tipoDoc] && Date.now() < deadline) {
          cache[tipoDoc] = { tipo: tipoDoc }; // evita salvar 2× o mesmo tipo neste run
          await salvarDocBucket(String(imovelId), tipoDoc, u.rotulo, u.url, doc.base64, dataLeilao);
        }
      }
      if (!doc) continue;
      lidos.push({ rotulo: u.rotulo, url: u.url, kind: doc.kind, cache: deCache });
      if (doc.kind === 'pdf') blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 }, title: u.rotulo });
      else blocos.push({ type: 'text', text: `=== ${u.rotulo} (${u.url}) ===\n${doc.text}` });
    }
    // Texto colado manualmente (inclusão manual / fallback).
    if (body?.textoEdital) blocos.push({ type: 'text', text: `=== EDITAL (texto informado) ===\n${String(body.textoEdital).slice(0, 12000)}` });
    if (body?.textoMatricula) blocos.push({ type: 'text', text: `=== MATRÍCULA (texto informado) ===\n${String(body.textoMatricula).slice(0, 12000)}` });

    // GATE: sem documento LEGÍVEL (nenhum lido e nenhum texto colado), NÃO gera um
    // laudo de "não consta/bloqueante" — falta de leitura NÃO é risco jurídico, é
    // diligência pendente (o laudo "operação suspensa" era falso e assustador).
    // Vale MESMO quando há nº de processo: sem a matrícula/edital não há base
    // documental para um parecer. Pede/obtém os documentos.
    const temTextoColado = !!(body?.textoEdital || body?.textoMatricula);
    if (lidos.length === 0 && !temTextoColado) {
      // Leiloeiro INTEGRADO (Caixa): a matrícula/edital só saem por navegador real
      // (sessão). Em vez de pedir anexo manual, ENFILEIRA a captura automática (job
      // que roda a cada 10 min baixa o PDF via navegador e guarda no storage; a
      // próxima geração lê de lá). Só cai no anexo manual se não for integrado.
      const ehCaixaFonte = /caixa|cef/i.test(row?.fonte || '');
      // Tem página de lote de onde um navegador real consegue baixar os PDFs?
      const temPaginaLote = /^https?:\/\//i.test(String(row?.link_edital || '')) || /^https?:\/\//i.test(String(row?.link_regras_venda || ''));
      let enfileirado = false;
      if (ehCaixaFonte) {
        const hdniip = (String(row?.link_matricula || '').match(/hdniip=(\d+)/) || [])[1] || String(row?.fonte_id || '').replace(/\D/g, '');
        if (hdniip) {
          try {
            await sb('cef_matricula_fila?on_conflict=imovel_id', {
              method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({ imovel_id: String(imovelId), hdniip, status: 'pendente' }),
            });
            enfileirado = true;
          } catch { /* segue com a mensagem */ }
        }
      } else if (temPaginaLote) {
        // Demais leiloeiros integrados: enfileira a captura genérica por navegador
        // real (job a cada 15 min abre a página do lote e baixa os PDFs para o storage).
        try {
          await sb('documentos_fila?on_conflict=imovel_id', {
            method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ imovel_id: String(imovelId), status: 'pendente' }),
          });
          enfileirado = true;
        } catch { /* segue com a mensagem */ }
      }
      const semDocs = {
        precisaDocumentos: true,
        integrado: ehCaixaFonte || temPaginaLote,
        emCaptura: enfileirado,
        documentosLidos: [],
        motivo: enfileirado
          ? `Estamos baixando os documentos automaticamente${ehCaixaFonte ? ' direto da Caixa' : ''} (leiloeiro integrado). Isso leva alguns minutos. Volte e gere de novo em instantes, ou anexe a matrícula e o edital (PDF) se quiser a análise na hora.`
          : (urls.length
            ? 'Os documentos deste lote existem, mas a fonte não liberou a leitura automática agora. Anexe a matrícula e o edital (PDF) para gerar a análise na hora.'
            : 'Este lote ainda não tem documentos vinculados. Anexe a matrícula e o edital (PDF) para gerar a análise.'),
      };
      await upsertDoc({ ...base, status: 'concluida', erro: null, result: semDocs });
      if (cota && cota.ok && cota.tipo) {
        try { await sb('rpc/estornar_documental_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
      }
      return semDocs;
    }

    // 2) Consulta o CNJ (quando há processo e UF). Modalidade judicial prioriza.
    const procNum = body?.processoNumero || row?.numero_processo || null;
    const procNome = body?.processoNome || null;
    let cnj = null;
    if ((procNum || procNome) && im.estado && Date.now() < deadline) {
      try { cnj = await buscarProcessosCNJ({ numero_processo: procNum || undefined, nome_parte: procNome || undefined, uf: im.estado }); }
      catch { /* CNJ pode estar indisponível */ }
    }

    // 3) Monta a mensagem para o Claude (documentos + resumo do CNJ).
    const temProc = !!(cnj && cnj.total);
    const content = [...blocos];
    if (temProc) {
      const resumoProc = cnj.processos.slice(0, 8).map(p => `- ${p.numero} (${p.tribunal || ''}) classe ${p.classe || '-'} | riscos: ${(p.riscos || []).map(r => r.categoria).join(', ') || 'nenhum'}`).join('\n');
      content.push({ type: 'text', text: `=== PROCESSOS CNJ (${cnj.total}) ===\nParecer automático: ${cnj.parecer?.texto || ''}\n${resumoProc}` });
    }
    if (!content.length) content.push({ type: 'text', text: 'Nenhum documento pôde ser lido automaticamente. Produza a análise possível e detalhe em "lacunas" o que precisa ser obtido e onde.' });
    content.push({ type: 'text', text: promptDocumental(im, temProc) });

    // APRENDIZADO: incorpora as correções que os advogados fizeram em devolutivas
    // anteriores (tabela juridico_aprendizado, alimentada por inbound-juridico),
    // para o parecer evitar repetir os mesmos erros. Loop de melhoria contínua —
    // sem devolutivas ainda, é no-op; vai ficando mais preciso com o uso.
    let aprendizados = '';
    try {
      const licoes = await (await sb('juridico_aprendizado?select=campo,valor_ia,valor_advogado,observacao&order=criado_em.desc&limit=40')).json();
      if (Array.isArray(licoes)) {
        const linhas = licoes
          .filter(l => l && (l.campo || l.observacao || l.valor_advogado))
          .slice(0, 30)
          .map(l => `- ${l.campo ? l.campo + ': ' : ''}o sistema indicou "${String(l.valor_ia || '—').slice(0, 120)}", o advogado corrigiu para "${String(l.valor_advogado || '—').slice(0, 120)}"${l.observacao ? ` — ${String(l.observacao).slice(0, 200)}` : ''}`);
        if (linhas.length) aprendizados = `\n\nAPRENDIZADOS COM ADVOGADOS (correções reais de devolutivas anteriores — aplique estas lições e NÃO repita os mesmos erros):\n${linhas.join('\n')}`;
      }
    } catch { /* aprendizado é best-effort, nunca trava o parecer */ }

    const data = await anthropic({
      model: MODEL, max_tokens: 6000,
      system: 'Você é advogado especialista em leilões de imóveis. Análise documental e processual — sem análise de mercado/preço. Não invente dados ausentes: sinalize lacunas e onde confirmar. Retorne apenas JSON válido.' + aprendizados,
      messages: [{ role: 'user', content }],
    }, { retries: 1, timeoutMs: 110000 });
    const parsed = parseJSON(extractText(data)) || {};

    // SALVAGUARDA anti-alarmismo (reforça o prompt): ausência de informação e itens
    // ROTINEIROS de leilão (penhora/execução, hipoteca que se extingue, bloqueios
    // da execução, ocupação com imissão garantida) NÃO podem sair como "bloqueante".
    // Rebaixa para "alerta" — o bloqueante fica só para risco concreto e comprovado.
    if (Array.isArray(parsed.riscos)) {
      const rotineiro = /penhora|execu[çc]|hipotec|indisponibil|bacenjud|renajud|arresto|ocupa|imiss|bloqueio/i;
      for (const r of parsed.riscos) {
        if (!r || r.severidade !== 'bloqueante') continue;
        const txt = `${r.categoria || ''} ${r.descricao || ''}`;
        const ausente = r.constaNaDoc === false || /n[ãa]o consta|a confirmar|n[ãa]o (?:foi|puderam|p[ôo]de)/i.test(txt);
        if (ausente || rotineiro.test(txt)) r.severidade = 'alerta';
      }
      // Coerência: sem bloqueante real, não classifica como "vermelho".
      if (!parsed.riscos.some(r => r?.severidade === 'bloqueante') && parsed.nivelRisco === 'vermelho') {
        parsed.nivelRisco = 'amarelo';
      }
    }

    // ── Fontes externas do laudo (best-effort — NUNCA travam o parecer) ─────────
    // Com base no processo e no CPF/CNPJ do executado que a IA extraiu: andamentos
    // (DJEN/Comunica CNJ), débitos trabalhistas (CNDT), protestos (CENPROT) e
    // certidões fiscais (Receita/PGFN/FGTS). Viram uma seção do laudo do cliente —
    // o mesmo conjunto que o fluxo de Caso já usava.
    const ex = parsed.extracao || {};
    const execDoc = String(ex.executadoDoc || '').replace(/\D/g, '');
    const docOk = execDoc.length === 11 || execDoc.length === 14;
    const procFontes = procNum || ex.numeroProcesso || null;
    let fontesTxt = '', fontesExternas = null;
    try {
      const [djen, cndt, cnib, prot, cert] = await Promise.all([
        procFontes ? consultarComunicaDJEN(procFontes).catch(() => null) : null,
        docOk ? consultarCNDT(execDoc).catch(() => null) : null,
        docOk ? consultarCNIB(execDoc).catch(() => null) : null,
        docOk ? consultarProtestos(execDoc).catch(() => null) : null,
        docOk ? consultarCertidoesFiscais(execDoc).catch(() => null) : null,
      ]);
      fontesExternas = { djen, cndt, cnib, protestos: prot, certidoes: cert };
      const linhas = [];
      if (djen?.ok) linhas.push(`• Andamentos (DJEN/Comunica CNJ): ${djen.resumo}`);
      if (cndt?.ok) linhas.push(`• Débitos trabalhistas (CNDT): ${cndt.resumo}`);
      if (cnib?.ok) linhas.push(`• Indisponibilidade de bens (CNIB): ${cnib.resumo}`);
      if (prot?.ok) linhas.push(`• Protestos (CENPROT): ${prot.resumo}`);
      if (cert?.resumo) linhas.push(`• Certidões fiscais (Receita/PGFN/FGTS): ${cert.resumo}`);
      if (!docOk && !procFontes) linhas.push('• Não foi possível identificar CPF/CNPJ do executado nem nº do processo nos documentos — consultas externas não realizadas.');
      if (linhas.length) fontesTxt = `\n\n§ SEÇÃO: CERTIDÕES E FONTES EXTERNAS\n\n${linhas.join('\n')}\n\nConsultas públicas automáticas — confirme em certidão oficial atualizada antes do lance.`;
    } catch { /* fontes externas nunca derrubam o laudo */ }

    // Checklist de evolução: o que já foi consultado e o que ficou PENDENTE (fonte
    // instável/CAPTCHA) — deixa o relatório transparente e justifica o prazo p/ liberar.
    const fx = fontesExternas || {};
    const stItem = (label, fonte, naMsg) => {
      if (!fonte) return { label, status: 'na', detalhe: naMsg };
      if (fonte.ok) return { label, status: 'feito', detalhe: fonte.resumo || fonte.situacao || 'Consultado' };
      if (fonte.instavel) return { label, status: 'pendente', detalhe: 'Fonte instável/CAPTCHA no momento — nova tentativa automática em até 48h; o relatório será complementado.' };
      return { label, status: 'na', detalhe: fonte.erro || 'Sem apontamento' };
    };
    const checklist = [
      { label: 'Documentos do lote (matrícula/edital/regras)',
        status: lidos.length ? 'feito' : (urls.length ? 'pendente' : 'na'),
        detalhe: lidos.length
          ? `${lidos.length} documento(s) lido(s): ${lidos.map(l => l.rotulo).join(', ')}`
          : (urls.length ? 'Documentos localizados, mas a fonte não liberou a leitura agora — nova tentativa em breve.' : 'Nenhum documento vinculado ao lote.') },
      { label: 'Processo judicial (CNJ/DataJud)',
        status: cnj ? 'feito' : (procFontes ? 'pendente' : 'na'),
        detalhe: cnj ? `${cnj.total ?? 0} processo(s) · ${(cnj.tribunais_consultados || []).join(', ') || 'tribunais consultados'}` : (procFontes ? 'Aguardando o DataJud (pode ter lag).' : 'Sem nº de processo para consultar.') },
      stItem('Andamentos processuais (DJEN/Comunica CNJ)', fx.djen, 'Sem nº de processo para consultar.'),
      stItem('Débitos trabalhistas (CNDT/BNDT)', fx.cndt, 'Sem CPF/CNPJ do executado nos documentos.'),
      stItem('Indisponibilidade de bens (CNIB)', fx.cnib, 'Sem CPF/CNPJ do executado nos documentos.'),
      stItem('Protestos em cartório (CENPROT)', fx.protestos, 'Sem CPF/CNPJ do executado nos documentos.'),
      { label: 'Certidões fiscais (Receita/PGFN/FGTS)',
        status: fx.certidoes?.resumo ? 'feito' : (docOk ? 'pendente' : 'na'),
        detalhe: fx.certidoes?.resumo || (docOk ? 'Aguardando as fontes fiscais.' : 'Sem CPF/CNPJ do executado nos documentos.') },
    ];
    const pendencias = checklist.filter(c => c.status === 'pendente').length;

    // Lembrete fixo (não-IA): análise preliminar; próximo passo é o analista e,
    // com aprovação, o laudo jurídico definitivo por advogado.
    const AVISO_DOCUMENTAL = '\n\n§ SEÇÃO: LEMBRETE E PRÓXIMO PASSO\nEsta análise documental e processual é gerada com apoio de inteligência artificial, a partir dos documentos disponíveis e de consultas públicas — pode conter imprecisões e não substitui a análise de um profissional. Recomendamos AGENDAR uma conversa com um analista para revisar o caso; uma vez aprovado, o caso é encaminhado ao JURÍDICO para emissão do LAUDO DEFINITIVO por advogado.';

    // LGPD: mascara o CPF do executado/ex-mutuário no resultado exibido (só os
    // dígitos do meio ficam visíveis). O documento cheio já foi usado nas consultas
    // acima (CNJ/certidões) e NÃO é exibido — diferencial nosso frente a quem vaza
    // o CPF completo de terceiros no relatório.
    if (parsed.extracao && parsed.extracao.executadoDoc) {
      const d = String(parsed.extracao.executadoDoc).replace(/\D/g, '');
      parsed.extracao.executadoDoc = d.length === 11 ? `•••.${d.slice(3, 6)}.${d.slice(6, 9)}-••`
        : d.length === 14 ? `••.${d.slice(2, 5)}.${d.slice(5, 8)}/••••-••` : null;
    }
    // Pontos de atenção (resumo escaneável no topo, com contagem por severidade).
    const rlist = Array.isArray(parsed.riscos) ? parsed.riscos : [];
    const pontosAtencao = {
      total: rlist.length,
      altos: rlist.filter(r => r?.severidade === 'bloqueante').length,
      medios: rlist.filter(r => r?.severidade === 'alerta').length,
    };

    const result = {
      extracao: parsed.extracao || null,
      riscos: parsed.riscos || [],
      pontosAtencao,
      lacunas: parsed.lacunas || [],
      nivelRisco: parsed.nivelRisco || (temProc ? cnj.parecer?.nivel : null) || 'amarelo',
      parecer: (parsed.parecer || '') + fontesTxt + AVISO_DOCUMENTAL,
      cnj: cnj ? { total: cnj.total, parecer: cnj.parecer, processos: cnj.processos?.slice(0, 12) || [], tribunais: cnj.tribunais_consultados } : null,
      fontesExternas,
      documentosLidos: lidos,
      checklist,
      pendencias,
      raioX: parsed.raioX || null,
      geradoEm: new Date().toISOString(),
    };
    await upsertDoc({ ...base, status: 'concluida', erro: null, result });

    // Alimenta a camada JURÍDICO do Score BidPro no acervo (antes ficava 0/acervo:
    // só o fluxo staff gravava). Deriva 0–100 do nível de risco + severidade dos
    // riscos encontrados. score_financeiro já é preenchido por backfill determinístico.
    try {
      const risc = Array.isArray(result.riscos) ? result.riscos : [];
      const bloqueantes = risc.filter(r => r?.severidade === 'bloqueante').length;
      const alertas     = risc.filter(r => r?.severidade === 'alerta').length;
      const baseJur = result.nivelRisco === 'verde' ? 85 : result.nivelRisco === 'vermelho' ? 30 : 55;
      const scoreJuridico = Math.max(0, Math.min(100, Math.round(baseJur - bloqueantes * 10 - alertas * 4)));
      await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ score_juridico: scoreJuridico, score_calculado_em: new Date().toISOString() }),
      });
    } catch { /* não bloqueia o laudo */ }

    // Ficha do imóvel (cartório/ofício, comarca, matrícula, ocupação) lida da
    // matrícula/edital pela IA — disponibiliza na TELA DO IMÓVEL para todo lote
    // judicial/extrajudicial, sem custo extra (mesma leitura do laudo). Faz MERGE
    // com a ficha existente (ex.: a que o cron da Caixa capturou) e nunca apaga.
    try {
      const ex = parsed.extracao || {};
      const extra = {};
      const setStr = (k, v) => { const s = String(v || '').trim(); if (s && !/^(n[ãa]o consta|n\/a|-|vazio)$/i.test(s)) extra[k] = s; };
      setStr('cartorio', ex.cartorio);
      setStr('comarca', ex.comarca);
      setStr('matricula', ex.numeroMatricula);
      if (ex.ocupacao) setStr('ocupacao', ex.ocupacao);
      // Dados-chave da matrícula (inspirado no que os concorrentes destacam).
      setStr('dataConsolidacao', ex.dataConsolidacao);
      setStr('condominioNome', ex.condominioNome);
      setStr('condominioCnpj', ex.condominioCnpj);
      if (ex.indisponibilidadePenhora && ex.indisponibilidadePenhora !== 'nao_consta') extra.indisponibilidadePenhora = ex.indisponibilidadePenhora;
      if (Object.keys(extra).length) {
        const fichaMerged = { ...(row?.ficha_cef && typeof row.ficha_cef === 'object' ? row.ficha_cef : {}), ...extra };
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ficha_cef: fichaMerged }),
        });
      }
    } catch { /* não bloqueia o laudo */ }

    // Raio-X jurídico COMPACTO na TELA DO IMÓVEL (selos + campos): persiste um
    // resumo do raioX no imóvel para a ficha exibir sem reabrir o laudo. Custo
    // zero (mesma leitura). Sobrescreve com o dado mais recente da análise.
    try {
      const rx = parsed.raioX || {};
      const oc = rx.ocupacaoDetalhe || {};
      const fj = {
        nivelRisco: result.nivelRisco || null,
        fraudeExecucao: rx.fraudeExecucao?.risco && rx.fraudeExecucao.risco !== 'nenhum' ? rx.fraudeExecucao.risco : null,
        direitoPreferencia: !!(rx.direitoPreferencia?.existe),
        ocupacaoTipo: oc.tipo && oc.tipo !== 'nao_consta' ? oc.tipo : null,
        desocupacaoPrazoMeses: Number(oc.prazoMeses) || null,
        desocupacaoCusto: Number(oc.custoEstimado) || null,
        debitosAssumidos: Number(rx.debitos?.totalAssumidoArrematante) || null,
        debitosALevantar: !!(rx.debitos?.aLevantar),
        proprietariosNaCadeia: Array.isArray(rx.cadeiaDominial) ? rx.cadeiaDominial.filter(a => a && (a.parte || a.evento)).length : 0,
        primeiraPraca: rx.cronogramaLeilao?.primeiraPraca || null,
        segundaPraca: rx.cronogramaLeilao?.segundaPraca || null,
        prazoPagamento: rx.cronogramaLeilao?.prazoPagamento || null,
        certidoesPendentes: Array.isArray(rx.certidoesRecomendadas) ? rx.certidoesRecomendadas.length : 0,
        atualizadoEm: new Date().toISOString(),
      };
      await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ficha_juridica: fj }),
      });
    } catch { /* não bloqueia o laudo */ }

    // Data do leilão/prazo de propostas: a lista em massa da Caixa vem SEM data para
    // licitação/judicial/venda direta — mas o edital tem. Se a IA extraiu e o imóvel
    // está sem data, grava no imóvel (mantém a base fiel à fonte, sem sobrescrever).
    try {
      const dRaw = String(parsed.extracao?.dataLeilao || '').trim();
      const mIso = dRaw.match(/(\d{4})-(\d{2})-(\d{2})/);
      const mBr = dRaw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const iso = mIso ? `${mIso[1]}-${mIso[2]}-${mIso[3]}` : mBr ? `${mBr[3]}-${mBr[2]}-${mBr[1]}` : null;
      if (iso && !row?.data_leilao) {
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ data_leilao: iso }),
        });
      }
    } catch { /* não bloqueia o laudo */ }

    return result;
    })()]);

    res.status(200).json({ ok: true, result });
  } catch (e) {
    const timeout = String(e?.message) === 'tempo_limite';
    const msg = timeout ? 'A geração excedeu o tempo limite do servidor. Costuma ser temporário: tente novamente.' : String(e?.message || e);
    await upsertDoc({ ...base, status: 'erro', erro: msg });
    // Estorna a cota consumida (não cobra por análise que falhou).
    if (cota && cota.ok && cota.tipo) {
      try { await sb('rpc/estornar_documental_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
    }
    res.status(timeout ? 504 : 500).json({ error: timeout ? 'Tempo limite ao gerar a análise documental' : 'Falha ao gerar a análise documental', detalhe: msg });
  }
}
