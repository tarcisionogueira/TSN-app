/**
 * GET /api/enriquecer-lote?imovel_id=...   (logado)
 * On-demand: ao abrir a tela de um imóvel de leiloeiro, vasculha a PÁGINA DO LOTE
 * atrás de matrícula, edital, regras de venda, demais anexos e foto — e grava no
 * imóvel. Cada leiloeiro guarda esses arquivos em lugares diferentes, então
 * varremos o HTML/JSON inteiro (ver _doc-scan.js) em vez de seletor por site.
 *
 * Fonte CEF (Caixa) é ignorada: lá os links são determinísticos (caixa.js) e o
 * IP do servidor é bloqueado. Fontes de leiloeiro que barram o servidor caem no
 * Bright Data (sob teto semanal). Só revisita se ainda não enriquecido (ou ?forcar=1).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { buscarViaBrightData } from './_brightdata.js';
import { hostExternoSeguro, fetchExternoSeguro } from './_allowed-hosts.js';
import { vasculharDocumentos, chaveDocCanonica } from './_doc-scan.js';
import { extrairRegistroMatricula } from './_registro-matricula.js';
import { extrairDescricaoDoCorpo, extrairAreaM2, decodificarEntidades } from './_texto-imovel.js';
import { carregarPDFParse } from './_pdf-safe.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// fetch direto; se 403/erro → Bright Data (desbloqueia fontes que barram o servidor).
export async function fetchLote(url) {
  // Anti-SSRF: URL vinda do banco (url_lote/link_edital) — nunca alcança rede interna/metadados.
  if (!hostExternoSeguro(url)) return { html: '', finalUrl: url, via: 'bloqueado' };
  const h = { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9' };
  let resp = null;
  try { resp = await fetchExternoSeguro(url, { headers: h, signal: AbortSignal.timeout(9000) }); } catch { resp = null; }
  if (resp && resp.ok) {
    const text = await resp.text().catch(() => '');
    if (text && text.length > 500) return { html: text, finalUrl: resp.url || url, via: 'direct' };
  }
  // 19/08: era o `fetchViaBrightData` LEGADO, que devolve null tanto para "teto de cota"
  // quanto para "página vazia" — a forma #5 que o próprio _brightdata.js documenta como
  // resolvida. A recusa de ORÇAMENTO carimbava o lote como visitado (enriquecido_em) e o
  // jogava para o fim da fila. Agora ela chega NOMEADA (`semCota: true`) ao chamador.
  try {
    const bd = await buscarViaBrightData(url, { proposito: 'geral' });
    const text = await bd.text().catch(() => '');
    if (text) return { html: text, finalUrl: url, via: 'brightdata' };
  } catch (e) {
    if (e?.semCota) return { html: '', finalUrl: url, via: 'sem_cota', semCota: true };
  }
  return { html: '', finalUrl: url, via: 'fail' };
}

/**
 * Extrai o PAR de datas do lote: quando ABRE e quando ENCERRA.
 *
 * POR QUE MUDOU (achado do dono em 02/08, lote `gl_28450`): a versão anterior juntava todas as
 * datas ancoradas em "leilão/praça/..." e devolvia `Math.min` — a mais CEDO. Numa página que
 * publica "Início do leilão: 03/08/2026 00:00" e "Encerramento do leilão: 03/11/2026 15:00",
 * a mais cedo é sempre o INÍCIO. Guardávamos a data que menos importa e perdíamos o PRAZO PARA
 * DAR LANCE — e o app exibia "Data do leilão 03/08/26" num leilão aberto até novembro.
 *
 * Como faz agora: acha TODA data dd/mm/aaaa da página, olha as ~90 letras ANTES dela para saber
 * do que se trata e classifica em três baldes:
 *   • FIM     — "encerramento", "término", "limite", "2ª praça"  → é o prazo real;
 *   • INÍCIO  — "início", "abertura", "1ª praça";
 *   • NEUTRO  — só "leilão"/"data", sem dizer qual.
 * Regras: início = a mais cedo dos INÍCIO (ou dos NEUTROS); fim = a mais TARDE dos FIM (ou o
 * maior NEUTRO quando há dois ou mais, que é o caso clássico de 1ª/2ª praça sem rótulo).
 * A HORA é preservada no fim — "encerra 15:00" é informação que decide lance.
 *
 * Exigir uma palavra-âncora no contexto continua sendo o que impede pegar data solta do texto
 * (nº de alvará, data de matrícula). Sem âncora, a data é ignorada.
 *
 * DATA JÁ PASSADA (achado do dono, 07/08 — "continua com relatório disponível mesmo após o
 * leilão encerrado"): as datas anteriores a ontem eram DESCARTADAS aqui. A consequência era
 * silenciosa e grave: numa página que diz "Leilão encerrado em 22/07/2026", nada era extraído,
 * o lote ficava SEM DATA para sempre, e sem data o gate de leilão encerrado falha aberto — ou
 * seja, o lote vencido seguia oferecendo relatório. Agora a mais recente das datas passadas
 * volta em `encerradaEm`, num campo SEPARADO: quem grava decide se registra (o cron/ondemand
 * registram só quando não há nenhuma data futura, para nunca rebaixar um prazo bom).
 */
const RE_DATA_LOTE = /(\d{2})\/(\d{2})\/(\d{2,4})(?:[^0-9]{0,12}(\d{1,2})[:h](\d{2}))?/g;
const CTX_ANCORA = /leil|pra[cçÇ]|encerr|in[íi]cio|inicio|abertura|t[eé]rmino|termino|licita|aliena|data/i;
// `fechamento` entrou em 23/08: é como a plataforma de Gustavo Reis/Valero/Sued Peter
// (fonte SUPORTE) rotula o PRAZO — "1ª Leilão Abertura 06/10 14:30 Fechamento 09/10 14:30".
// Sem ele, a janela de 90 caracteres antes da data pegava o "Abertura" da frase e TODAS as
// datas caíam no balde de início: `fim` saía nulo e o prazo para dar lance nunca era gravado.
// Medido nas 3 páginas amostradas da fonte, todas assim.
const CTX_FIM    = /encerr|t[eé]rmino|termino|fim d|final d|limite|at[ée] |fechamento|2[ªa°]?\s*pra[cç]a|segunda\s*pra[cç]a/i;
const CTX_INICIO = /in[íi]cio|inicio|abertura|come[cç]|1[ªa°]?\s*pra[cç]a|primeira\s*pra[cç]a|abre/i;

// Âncora ESTRITA, para ler datas do TEXTO DO EDITAL (não da página do lote): num edital a
// palavra "data" aparece o tempo todo ("a contar da data do pagamento"), então lá ela não
// serve de âncora — só valem as expressões que falam do ATO do leilão.
const CTX_ANCORA_ESTRITA = /leil|pra[cçÇ]|encerr|hasta|aliena|licita|t[eé]rmino|termino/i;

export function extrairDatasLeilao(html, { estrito = false } = {}) {
  const vazio = { inicio: null, fim: null, encerradaEm: null };
  if (!html) return vazio;
  const ancora = estrito ? CTX_ANCORA_ESTRITA : CTX_ANCORA;
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const ontem = Date.now() - 86400000;
  const piso = Date.now() - 400 * 86400000;   // datas passadas ainda úteis (ver `passadas`)
  const limite = Date.now() + 730 * 86400000; // 2 anos: janelas de alienação passam de 1 ano
  const fins = [], inicios = [], neutros = [], passadas = [];
  let m;
  RE_DATA_LOTE.lastIndex = 0;
  while ((m = RE_DATA_LOTE.exec(txt))) {
    const ctx = txt.slice(Math.max(0, m.index - 90), m.index);
    if (!ancora.test(ctx)) continue;                         // data solta do texto: ignora
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const hh = m[4] ? String(m[4]).padStart(2, '0') : '00';
    const mi = m[5] || '00';
    // -03:00 fixo: leiloeiro brasileiro publica em horário de Brasília.
    const t = Date.parse(`${y}-${m[2]}-${m[1]}T${hh}:${mi}:00-03:00`);
    if (isNaN(t) || t >= limite) continue;
    // Passado recente (até ~13 meses) fica guardado à parte: é o que revela que o leilão JÁ
    // ACONTECEU. Não entra nos baldes de início/fim para não contaminar o prazo.
    if (t < ontem) { if (t >= piso) passadas.push(t); continue; }
    if (CTX_FIM.test(ctx)) fins.push(t);
    else if (CTX_INICIO.test(ctx)) inicios.push(t);
    else neutros.push(t);
  }
  const iso = (t) => new Date(t).toISOString();
  // O DIA sai no fuso de Brasília, não em UTC. As datas foram lidas da página como -03:00, então
  // qualquer horário a partir das 21h vira o dia seguinte no toISOString — um leilão que começa
  // "03/08 às 22:00" era gravado como 04/08 e o lote parecia aberto um dia a mais. Mesmo erro que
  // fez a tela anunciar "encerrado em 04/08" num leilão de 03/08 (lote Rua Ita 55).
  const dia = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  // A data de encerramento só é afirmada quando NÃO há nenhuma data futura na página — com
  // uma futura por perto, a passada costuma ser a 1ª praça já vencida, e o lote segue vivo.
  const encerradaEm = (!fins.length && !inicios.length && !neutros.length && passadas.length)
    ? dia(Math.max(...passadas)) : null;

  if (!fins.length && !inicios.length && !neutros.length) return { ...vazio, encerradaEm };

  const baseInicio = inicios.length ? inicios : neutros;
  const inicio = baseInicio.length ? dia(Math.min(...baseInicio)) : null;
  let fim = fins.length ? iso(Math.max(...fins))
    // sem rótulo explícito, DUAS ou mais datas = 1ª e 2ª praça: a última é o prazo.
    : (neutros.length >= 2 ? iso(Math.max(...neutros)) : null);
  // Fim igual ao início não acrescenta nada (e viraria ruído na tela).
  if (fim && inicio && fim.slice(0, 10) === inicio) fim = null;
  // …MAS anular aqui não pode APAGAR uma 2ª praça que a página publica (23/08, WEBLEILOES).
  // A página traz um contador "Encerra em 31/08" (vira FIM) junto de "1º Leilão … 31/08" e
  // "2º Leilão … 23/09" (viram NEUTROS, sem rótulo de praça). O FIM do contador é o MESMO dia
  // do início, colapsava para null pela regra acima, e o prazo REAL — 23/09, a 2ª praça — se
  // perdia: o lote ficava sem prazo nenhum. Quando isso acontece, vale a regra que a própria
  // função já documenta para duas datas sem rótulo: a mais TARDE é o prazo.
  if (!fim && inicio && neutros.length) {
    const maiorNeutro = Math.max(...neutros);
    if (dia(maiorNeutro) > inicio) fim = iso(maiorNeutro);
  }
  // LEILÃO NÃO ENCERRA ANTES DE COMEÇAR. A classificação vive de uma janela de 90 caracteres
  // antes da data, e quando as datas ficam muito próximas no texto essa janela pode alcançar a
  // palavra-âncora da data VIZINHA — aí a 1ª praça cai no balde "fim" e a 2ª no "início", e sai
  // um par invertido (visto ao montar o teste desta mudança). Par incoerente na tela é pior que
  // dado faltando: o cliente leria "leilão 23/09, prazo 31/08". Ordenar é o que o texto de fato
  // sustenta — a data mais cedo abre, a mais tarde encerra.
  if (fim && inicio && fim.slice(0, 10) < inicio) {
    const todas = [...fins, ...inicios, ...neutros];
    const abre = dia(Math.min(...todas));
    const encerra = iso(Math.max(...todas));
    return { inicio: abre, fim: encerra.slice(0, 10) > abre ? encerra : null, encerradaEm: null };
  }
  return { inicio, fim, encerradaEm: null };
}

// Compatibilidade: quem só quer "a data do lote" continua chamando isto. Devolve o INÍCIO —
// o campo `data_leilao` sempre significou isso. O prazo real vai em `data_leilao_2`.
export function extrairDataLeilao(html) {
  return extrairDatasLeilao(html).inicio;
}

// Extrai o VALOR DE AVALIAÇÃO da página do lote (leiloeiros mostram "Valor de
// avaliação"/"Valor Avaliado"/"Avaliação: R$ ..."). Muitos leiloeiros não trazem a
// avaliação na listagem em massa (ou mandam sentinela), então buscamos on-demand.
export function extrairAvaliacao(html) {
  if (!html) return null;
  // Decodifica antes de procurar o rotulo (18/08): `Avalia&ccedil;&atilde;o` nao casa com
  // /avalia[cç][aã]o/, e o resultado nao e erro — e avaliacao ausente com cara de "o leiloeiro
  // nao informou". Esta funcao atende TODAS as fontes no enriquecimento sob demanda.
  const txt = decodificarEntidades(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const re = /avalia[cç][aã]?[o]?\w*[^R$\d]{0,18}R?\$?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/gi;
  let m;
  while ((m = re.exec(txt))) {
    const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    if (v && v >= 1000 && v < 100000000) return v; // 1º valor plausível ancorado em "avaliação"
  }
  return null;
}

// Lê cartório/ofício/comarca do CABEÇALHO da matrícula (PDF de texto). GRÁTIS:
// download DIRETO apenas (nunca Bright Data — matrícula bloqueada por 403 fica
// para o laudo documental, que já usa o proxy pago sob demanda). Devolve os
// campos extraídos ou null. Só tenta quando a URL é um .pdf.
async function lerCartorioMatricula(url) {
  if (!hostExternoSeguro(url) || !/\.pdf(\?|#|$)/i.test(url)) return null;
  try {
    const r = await fetchExternoSeguro(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' }, signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 12_000_000 || buf.slice(0, 5).toString('latin1') !== '%PDF-') return null;
    const PDFParse = await carregarPDFParse();
    const parser = new PDFParse({ data: buf });
    const res = await parser.getText();
    await parser.destroy();
    return extrairRegistroMatricula(res?.text || '');
  } catch { return null; }
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const id = params.get('imovel_id');
  const forcar = params.get('forcar') === '1';
  if (!id) { res.status(400).json({ error: 'imovel_id obrigatório' }); return; }

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=id,fonte,modalidade,data_leilao,data_leilao_2,url_lote,link_edital,link_matricula,link_regras_venda,link_foto,anexos,enriquecido_em,ficha_cef,matricula_scan_em,titulo,descricao,area_m2,valor_avaliacao,valor_minimo&limit=1`)).json();
  if (!im) { res.status(404).json({ error: 'Imóvel não encontrado' }); return; }

  // CEF: os LINKS de documento são determinísticos (não precisa vasculhar), MAS a
  // DATA do leilão/licitação fica na PÁGINA do imóvel (não vem no CSV em massa).
  // Busca a data on-demand p/ o cliente se planejar. Venda direta é contínua (sem
  // data). Throttle de 12h e nunca sobrescreve data já existente.
  if (im.fonte === 'CEF' || im.fonte === 'caixa') {
    const ehVendaDireta = /venda[_ ]?direta/i.test(im.modalidade || '');
    const recente = im.enriquecido_em && (Date.now() - new Date(im.enriquecido_em).getTime() < 12 * 3600 * 1000);
    if (ehVendaDireta || im.data_leilao || (recente && !forcar)) {
      res.status(200).json({ ok: true, pulado: ehVendaDireta ? 'cef_venda_direta' : im.data_leilao ? 'cef_tem_data' : 'cef_recente', alterado: false }); return;
    }
    const { html } = await fetchLote(im.url_lote || '');
    const { inicio: data, fim } = html ? extrairDatasLeilao(html) : { inicio: null, fim: null };
    const patch = { enriquecido_em: new Date().toISOString() };
    if (data) patch.data_leilao = data;
    // 2ª praça da Caixa: é o prazo que vale quando a 1ª não arremata.
    if (fim && !im.data_leilao_2) patch.data_leilao_2 = fim;
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }).catch(() => {});
    res.status(200).json({ ok: !!(data || fim), pulado: 'cef', alterado: !!(data || fim), data_leilao: data || null, data_leilao_2: fim || null }); return;
  }
  // Ficha (cartório/ofício/comarca) a partir da matrícula em PDF — GRÁTIS e só
  // uma vez por imóvel (marca matricula_scan_em, igual ao cron). Roda mesmo que o
  // resto já esteja completo, desde que falte o cartório e já exista o link.
  const temCartorio = !!(im.ficha_cef && typeof im.ficha_cef === 'object' && im.ficha_cef.cartorio);
  if (!im.matricula_scan_em && !temCartorio && /\.pdf(\?|#|$)/i.test(im.link_matricula || '')) {
    const reg = await lerCartorioMatricula(im.link_matricula);
    const p = { matricula_scan_em: new Date().toISOString() };
    if (reg) p.ficha_cef = { ...(im.ficha_cef && typeof im.ficha_cef === 'object' ? im.ficha_cef : {}), ...reg };
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(p) }).catch(() => {});
    im.matricula_scan_em = p.matricula_scan_em;
    if (p.ficha_cef) im.ficha_cef = p.ficha_cef;
  }

  // Revisita se o imóvel AINDA não tem documentos. Antes, uma tentativa que falhava
  // (fonte bloqueava o fetch) marcava enriquecido_em e o imóvel ficava travado SEM
  // matrícula/edital/regras PARA SEMPRE. Agora: só pula de vez quando já achou algo;
  // se ainda não tem doc, tenta de novo após 12h (throttle p/ não martelar a fonte).
  const temDocs = !!(im.link_matricula || im.link_regras_venda || (Array.isArray(im.anexos) && im.anexos.length));
  const ehVendaDireta = /venda[_ ]?direta/i.test(im.modalidade || '');
  // Falta data quando não temos o início OU não temos o ENCERRAMENTO. O segundo caso era
  // invisível antes: o lote com data de início parecia "completo" e nunca era revisitado, então
  // o prazo real (que é o que decide o lance) nunca chegava a ser capturado.
  const precisaData = (!im.data_leilao || !im.data_leilao_2) && !ehVendaDireta;
  const enriqRecente = im.enriquecido_em && (Date.now() - new Date(im.enriquecido_em).getTime() < 12 * 3600 * 1000);
  // Enfileira a captura por navegador SEMPRE que ABREM um lote de leiloeiro sem
  // documento REAL (PDF) — inclusive quando o scrape de HTML é pulado pelo throttle
  // de 12h (era o buraco: um lote que falhou o scrape ficava travado sem captura).
  // On-demand por interesse: só o que alguém abre entra na fila. Idempotente.
  const temDocRealAgora = /\.pdf(\?|#|$)/i.test(im.link_matricula || '')
    || /\.pdf(\?|#|$)/i.test(im.link_regras_venda || '')
    || (Array.isArray(im.anexos) && im.anexos.length > 0);
  const alvoLote = im.url_lote || im.link_edital;
  if (!temDocRealAgora && /^https?:\/\//.test(String(alvoLote || ''))) {
    try {
      await sb('documentos_fila?on_conflict=imovel_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify({ imovel_id: String(id), status: 'pendente' }) });
    } catch { /* best-effort */ }
  }

  // "COMPLETO" PRECISA INCLUIR O QUE PASSAMOS A EXTRAIR (17/08). Até agora `ja_completo`
  // significava "tem documento e tem data" — a definição foi escrita quando esta função só
  // buscava isso. Ao passar a extrair METRAGEM e DESCRIÇÃO, um lote com edital e data era
  // declarado completo e PULADO, com `area_m2 = 0` — ou seja, a correção nunca rodaria
  // exatamente onde é necessária. É o mesmo defeito que esta sessão vem catalogando: um teste
  // de completude que não foi atualizado junto com o que se considera completo.
  // Medido na BIASI: 472 lotes ativos, TODOS sem área, 49 já com `enriquecido_em`.
  const descEcoDoTitulo = (() => {
    const d = String(im.descricao || '').trim();
    const t = String(im.titulo || '').trim();
    return !d || (t && d.replace(t, '').replace(/[\s—·|-]+/g, '').length < 40);
  })();
  const precisaTexto = !(Number(im.area_m2) > 0) || descEcoDoTitulo;

  // Pula só quando já tem tudo (docs E data E texto) ou tentou há pouco (throttle de 12h).
  // O throttle de 12h continua valendo por cima: ele existe para não martelar a fonte, e essa
  // razão não muda por termos mais campos a preencher.
  if (!forcar && ((temDocs && !precisaData && !precisaTexto) || enriqRecente)) {
    res.status(200).json({ ok: true, pulado: (temDocs && !precisaData) ? 'ja_completo' : 'tentado_recente', alterado: false, anexos: im.anexos || [] }); return;
  }

  const alvo = im.url_lote || im.link_edital;
  if (!alvo || !/^https?:\/\//.test(alvo)) {
    res.status(200).json({ ok: true, pulado: 'sem_url', alterado: false }); return;
  }

  const { html, finalUrl, via } = await fetchLote(alvo);
  if (!html) {
    // Marca a tentativa para não martelar a fonte a cada abertura.
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ enriquecido_em: new Date().toISOString() }) }).catch(() => {});
    res.status(200).json({ ok: false, via, alterado: false, motivo: 'sem_conteudo' }); return;
  }

  const achado = vasculharDocumentos(html, finalUrl, im.link_foto);

  // Monta o patch: só preenche o que faltava (não sobrescreve dado já bom).
  const patch = { enriquecido_em: new Date().toISOString() };
  // Anexos: UNIÃO por chave canônica com os já gravados — a substituição cega
  // apagava docs de pipelines dedicados (matrícula GL, edital login-gated) que o
  // scan deste momento não enxerga. Achado do dia primeiro (assinatura mais nova).
  if (achado.anexos.length) {
    const atuais = Array.isArray(im.anexos) ? im.anexos : [];
    const kDe = (a) => chaveDocCanonica(a?.url) || a?.url || null;
    const vistos = new Set(achado.anexos.map(kDe).filter(Boolean));
    const merge = [...achado.anexos];
    for (const a of atuais) { const k = kDe(a); if (k && !vistos.has(k)) { vistos.add(k); merge.push(a); } }
    patch.anexos = merge.slice(0, 25);
  }
  if (achado.matricula && !im.link_matricula) patch.link_matricula = achado.matricula;
  if (achado.edital && !im.link_edital) patch.link_edital = achado.edital;
  if (achado.regras && !im.link_regras_venda) patch.link_regras_venda = achado.regras;
  if (achado.foto && !im.link_foto) patch.link_foto = achado.foto;
  // PAR de datas do leiloeiro (mesma extração da CEF): início E encerramento. Cada um só é
  // gravado se ainda faltava — nunca sobrescreve dado bom já existente.
  const datas = precisaData ? extrairDatasLeilao(html) : { inicio: null, fim: null, encerradaEm: null };
  if (datas.inicio && !im.data_leilao) patch.data_leilao = datas.inicio;
  if (datas.fim && !im.data_leilao_2) patch.data_leilao_2 = datas.fim;
  // A página só tinha data JÁ PASSADA e o lote não tinha data nenhuma: é um leilão que já
  // aconteceu. Registrar isso é o que faz o gate de leilão encerrado enxergar o lote — sem
  // registrar, ele ficava eternamente "sem data" e continuava oferecendo relatório.
  if (datas.encerradaEm && !im.data_leilao && !im.data_leilao_2) patch.data_leilao = datas.encerradaEm;

  // ─── METRAGEM E DESCRIÇÃO (17/08) ────────────────────────────────────────────────────────
  // Esta função já está com o HTML da página do lote em mãos — e até hoje extraía dela
  // documentos, foto, datas e avaliação, mas NÃO a metragem nem a descrição. Isso deixava
  // 2.227 lotes ativos sem área (495 sem nem matrícula de onde tirá-la) enquanto a informação
  // estava na página que acabamos de baixar.
  //
  // É o melhor lugar possível para a correção: custo ZERO de requisição (o download já
  // aconteceu), roda SOB DEMANDA (quando o cliente abre a ficha) e serve TODA fonte de uma vez
  // — inclusive a BIASI, cujo coletor lê só os cards da listagem e por isso grava `area_m2: 0`
  // e `descricao: title` fixos no código, em 100% dos 472 lotes.
  //
  // Só preenche o que falta, como todo o resto deste patch: área só se não havia, e descrição
  // só quando a atual não passa de um eco do título (que é o estado de SUPERBID 1.492/1.494,
  // PESTANA 1.029/1.029, LJUD 981/981, BIASI 472/472). Dado bom nunca é sobrescrito.
  if (!(Number(im.area_m2) > 0)) {
    const areaPag = extrairAreaM2(String(html).replace(/<[^>]+>/g, ' '));
    if (areaPag > 0) patch.area_m2 = areaPag;
  }
  // Reusa `descEcoDoTitulo` calculado no teste de completude acima — a mesma regra em dois
  // lugares divergiria no primeiro ajuste, e aí o endpoint decidiria visitar a página por um
  // critério e gravar por outro.
  if (descEcoDoTitulo) {
    const descPag = extrairDescricaoDoCorpo(html);
    if (descPag) patch.descricao = descPag.slice(0, 500);
  }

  // ⚠️ `valor_avaliacao`/`valor_minimo` NÃO vinham no `select` (corrigido em 17/08, junto com
  // a inclusão de titulo/descricao/area_m2). O guard abaixo lia `undefined`, `avalAtual` dava
  // sempre 0 e a condição "quando não temos uma válida" nunca conferia nada — a avaliação da
  // página sobrescrevia a do banco em todo enriquecimento, inclusive por cima de valor bom.
  // Achado colateral: a coluna que o código lê tem de estar na projeção, e nada avisa quando
  // não está — `im.campo` ausente é `undefined`, que passa calado por qualquer `Number(...)`.
  // AVALIAÇÃO real da página do lote (quando não temos uma válida) — corrige o
  // "100% abaixo da avaliação" sem valor e recalcula o desconto. O trigger do banco
  // ainda valida (descarta sentinela). Vale p/ todos os leiloeiros.
  const avalAtual = Number(im.valor_avaliacao) || 0;
  const minAtual = Number(im.valor_minimo) || 0;
  if (avalAtual <= 0) {
    const aval = extrairAvaliacao(html);
    if (aval && aval > minAtual) {
      patch.valor_avaliacao = aval;
      if (minAtual > 0) patch.desconto_percentual = Math.round((1 - minAtual / aval) * 100);
    }
  }

  // Matrícula recém-descoberta (PDF) e ainda sem cartório → lê o cabeçalho grátis.
  const matriculaUrlFinal = patch.link_matricula || im.link_matricula;
  if (!im.matricula_scan_em && !temCartorio && /\.pdf(\?|#|$)/i.test(matriculaUrlFinal || '')) {
    const reg = await lerCartorioMatricula(matriculaUrlFinal);
    patch.matricula_scan_em = new Date().toISOString();
    if (reg) patch.ficha_cef = { ...(im.ficha_cef && typeof im.ficha_cef === 'object' ? im.ficha_cef : {}), ...reg };
  }

  const up = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });

  res.status(200).json({
    ok: up.ok, via, alterado: up.ok,
    encontrados: achado.anexos.length,
    matricula: patch.link_matricula || im.link_matricula || null,
    edital: patch.link_edital || im.link_edital || null,
    regras: patch.link_regras_venda || im.link_regras_venda || null,
    foto: patch.link_foto || im.link_foto || null,
    data_leilao: patch.data_leilao || im.data_leilao || null,
    data_leilao_2: patch.data_leilao_2 || im.data_leilao_2 || null,
    anexos: achado.anexos,
  });
}
