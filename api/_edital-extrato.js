/**
 * EXTRATO DO EDITAL (determinístico, custo zero) — praças (nº, valor, data), forma de
 * pagamento e avaliação, lidos do edital/regras do LOTE para o relatório MERCADOLÓGICO
 * usar o DOCUMENTO como fonte de verdade da melhor praça e das condições (pedido do
 * dono 30/07). Sem IA e sem Bright Data: fetch direto + pdf-parse + regex. PDF
 * escaneado (sem camada de texto) não é lido aqui — fica para o laudo documental
 * (leitura por visão). Best-effort por contrato: QUALQUER falha devolve null e o
 * relatório segue exatamente como antes.
 */
import { hostExternoSeguro, fetchExternoSeguro } from './_allowed-hosts.js';
import { carregarPDFParse } from './_pdf-safe.js';
import { extrairDatasLeilao } from './enriquecer-lote.js';
import { cacheLer, cacheGravar, chaveUrl, chaveConteudo, extrairMatriculaTexto, extrairPagamentoTexto, extrairCustosTexto, extrairIdentidadeTexto } from './_doc-extracao.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

/**
 * PUBLICA NA FICHA DO IMÓVEL o que a leitura do documento apurou (pedido do dono, 06/08:
 * "que também apareça na tela do imóvel — isso gera mais credibilidade"). Fica aqui, e não
 * no chamador, porque TODO caminho que lê edital/matrícula passa por este módulo: o
 * mercadológico, o laudo e qualquer rotina futura enriquecem a ficha só de rodar.
 *
 * `registrar_doc_fatos` faz MERGE atômico por chave de topo — a leitura da matrícula não
 * apaga o que o edital apurou, e duas gerações simultâneas do mesmo lote não se atropelam.
 * Best-effort por contrato: falhar aqui nunca afeta o relatório em curso.
 */
async function publicarDocFatos(imovelId, fatos) {
  if (!SUPABASE_URL || !SERVICE_KEY || !imovelId || !fatos) return;
  const uteis = Object.fromEntries(Object.entries(fatos).filter(([, v]) => v && (typeof v !== 'object' || Object.values(v).some((x) => x !== null && x !== ''))));
  if (!Object.keys(uteis).length) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_doc_fatos`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ p_imovel_id: String(imovelId), p_fatos: { ...uteis, em: new Date().toISOString() } }),
      signal: AbortSignal.timeout(8000),
    });
  } catch { /* enriquecer a ficha nunca bloqueia a geração */ }
}

const parseValor = (s) => {
  const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) && v >= 1000 && v < 100000000 ? v : 0;
};

// Extrai praças/pagamento/avaliação de TEXTO plano (PDF com camada de texto ou HTML).
// Exportada para teste isolado (scripts) e reuso.
export function extrairCondicoes(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 300) return null;
  const out = { pracas: [], formaPagamento: '', avaliacao: 0 };
  // Avaliação: maior valor ANCORADO na palavra (não pega débito/lance solto).
  for (const m of t.matchAll(/avalia[çc][ãa]o[^R$\d]{0,40}R?\$?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/gi)) {
    const v = parseValor(m[1]);
    if (v > out.avaliacao) out.avaliacao = v;
  }
  // Praças/leilões: nº + data/valor na JANELA logo após a menção — janela FIXA de 240
  // chars cortada na próxima menção de praça (lookahead lazy falhava quando a última
  // praça ia até o fim do texto). 1ª ocorrência de cada nº vence.
  const vistos = new Set();
  const reMencao = /([12])\s*[ºªo°.]{0,2}\s*(?:leil[ãa]o|pra[çc]a|hasta)/gi;
  let m;
  while ((m = reMencao.exec(t))) {
    const n = Number(m[1]);
    if (vistos.has(n)) continue;
    let jan = t.slice(m.index + m[0].length, m.index + m[0].length + 240);
    const prox = jan.search(/[12]\s*[ºªo°.]{0,2}\s*(?:leil[ãa]o|pra[çc]a|hasta)/i);
    if (prox > 0) jan = jan.slice(0, prox);
    const dm = jan.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    const vm = jan.match(/R\$\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/);
    const valor = vm ? parseValor(vm[1]) : 0;
    const data = dm ? `${dm[3]}-${dm[2]}-${dm[1]}` : null;
    if (valor > 0 || data) { vistos.add(n); out.pracas.push({ n, valor, data }); }
  }
  out.pracas.sort((a, b) => a.n - b.n);
  // Forma de pagamento: FRASES ORIGINAIS do edital com termos de condição (fiel, sem
  // IA) — o parecer e o front citam o texto, nunca uma paráfrase.
  const reKw = /(à\s*vista|a\s*vista|parcelad|parcelas?\b|sinal\b|entrada\s+de|cau[çc][ãa]o|fgts|financiament|itbi|comiss[ãa]o\s+d[oe]\s+leiloeiro|comiss[ãa]o\s+de\s+\d|carta\s+de\s+arremata|prazo\s+de\s+pagamento)/i;
  const frases = [];
  for (const fr of t.split(/(?<=[.;])\s+/)) {
    if (frases.length >= 4) break;
    const s = fr.trim();
    if (s.length >= 25 && s.length <= 400 && reKw.test(s)) frases.push(s.slice(0, 240));
  }
  out.formaPagamento = frases.join(' ').slice(0, 800);
  if (!out.pracas.length && !out.formaPagamento && !(out.avaliacao > 0)) return null;
  return out;
}

// Baixa e devolve o TEXTO de um candidato (PDF → pdf-parse; HTML → sem tags), ou null.
export async function lerTexto(url, deadline) {
  if (!hostExternoSeguro(url)) return null;
  const budget = deadline - Date.now();
  if (budget < 3000) return null;
  try {
    const r = await fetchExternoSeguro(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(Math.min(12000, budget - 500)) });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > 12_000_000) return null;
    const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
    if (ehPdf) {
      const PDFParse = await carregarPDFParse();
      const parser = new PDFParse({ data: buf });
      try {
        const res = await parser.getText();
        return String(res?.text || '').slice(0, 120000);
      } finally { await parser.destroy().catch(() => {}); }
    }
    return buf.toString('utf8')
      .replace(/<script[^]*?<\/script>/gi, ' ').replace(/<style[^]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').slice(0, 120000);
  } catch { return null; }
}

/**
 * Lê o edital/regras do lote e devolve { pracas, formaPagamento, avaliacao, pagamento, custos,
 * identidade, datas, fonteUrl, pertenceAoLote } ou null. `pertenceAoLote:false` = o documento lido NÃO bate com os
 * valores do lote (edital de outro lote anexado por engano) — o chamador descarta e
 * registra anomalia; dado errado com selo de "confirmado no edital" é pior que ausente.
 *
 * `datas` = { inicio, fim } lidos do TEXTO do edital com âncora estrita. É a rede de
 * segurança pedida pelo dono em 03/08: há lote cujo LEILOEIRO não publica data na página
 * (ex.: `vegas_7588`) mas cujo edital publica. Enquanto ninguém pede relatório, ficamos de
 * acordo com o leiloeiro (sem data); ao gerar o relatório, o edital preenche a lacuna.
 */
export async function extratoEdital(imovelId, { deadline } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const fim = Number(deadline) || (Date.now() + 45000);
  let im = null;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=link_edital,link_regras_venda,anexos,valor_minimo,valor_avaliacao&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    [im] = await r.json();
  } catch { return null; }
  if (!im) return null;
  const anexos = Array.isArray(im.anexos) ? im.anexos : [];
  const ehPdfUrl = (u) => /\.pdf(\?|#|$)/i.test(u || '');
  // Candidatos do mais provável ao menos: edital-PDF dos anexos → link_edital-arquivo →
  // regras-PDF → edital sem extensão. Página SPA do lote fica de fora (valor não está
  // no HTML cru — comprovado no garantirValores).
  const cands = [...new Set([
    ...anexos.filter(a => a?.tipo === 'edital' && ehPdfUrl(a.url)).map(a => a.url),
    ehPdfUrl(im.link_edital) ? im.link_edital : null,
    ...anexos.filter(a => a?.tipo === 'regras' && ehPdfUrl(a.url)).map(a => a.url),
    ...anexos.filter(a => a?.tipo === 'edital' && !ehPdfUrl(a.url)).map(a => a.url),
  ].filter(u => u && /^https?:\/\//i.test(u)))].slice(0, 3);
  for (const url of cands) {
    if (Date.now() > fim) break;
    // CACHE-FIRST por URL canônica (querystring de signed URL fora): outro relatório
    // — ou a regeneração deste — já leu este edital → pula download+parse inteiros.
    // Só os FATOS do documento vêm do cache; `pertenceAoLote` é POR LOTE (o mesmo
    // edital cobre vários) e é sempre recalculado abaixo contra os valores DESTE lote.
    let cond = null, datas = null, pagamento = null, custos = null, identidade = null, deCache = false;
    const hit = await cacheLer(chaveUrl(url));
    if (hit?.campos?.condicoes) {
      cond = hit.campos.condicoes; datas = hit.campos.datas || null;
      pagamento = hit.campos.pagamento || null; deCache = true;
      custos = hit.campos.custos || null; identidade = hit.campos.identidade || null;
    } else {
      const txt = await lerTexto(url, fim);
      if (!txt) continue;
      cond = extrairCondicoes(txt);
      if (!cond) continue;
      // Datas do ATO (início/encerramento) direto do texto — só têm valor quando as
      // praças não trouxeram data; vão à parte, sem interferir no que já existia.
      try { const d = extrairDatasLeilao(txt, { estrito: true }); if (d.inicio || d.fim) datas = d; } catch { /* best-effort */ }
      // Pagamento ESTRUTURADO (fluxo de caixa) e metragem que o EDITAL às vezes traz —
      // grátis, no mesmo texto já baixado. Grava no cache pelas DUAS chaves: URL
      // (lookup pré-download) e conteúdo (idempotência entre URLs do mesmo PDF).
      pagamento = extrairPagamentoTexto(txt);
      // CUSTOS declarados (taxa administrativa, IPTU, condomínio — comissão vem no
      // `pagamento`) e IDENTIDADE (condomínio/logradouro/bairro). Os custos entram na
      // PROJEÇÃO; a identidade ancora a BUSCA e a classificação de tipo/padrão.
      custos = extrairCustosTexto(txt);
      identidade = extrairIdentidadeTexto(txt);
      const mat = extrairMatriculaTexto(txt);
      const campos = { condicoes: cond, datas, pagamento, custos, identidade, ...(mat ? { matricula: mat } : {}) };
      const meta = { url, imovelId, tipoDoc: 'edital', campos, via: 'regex', confianca: 60 };
      await cacheGravar(chaveUrl(url), meta);
      await cacheGravar(chaveConteudo(txt), meta);
    }
    const vmin = Number(im.valor_minimo) || 0;
    const aval = Number(im.valor_avaliacao) || 0;
    let pertence = true;
    if (vmin > 0 && cond.pracas.some(p => p.valor > 0)) {
      // Alguma praça do documento plausível vs o lance do lote (1ª praça ≈ avaliação
      // pode chegar a ~3,4x o lance da 2ª; abaixo de 0,3x ou acima disso = outro lote).
      pertence = cond.pracas.some(p => p.valor > 0 && p.valor >= vmin * 0.3 && p.valor <= vmin * 3.4);
    }
    if (pertence && aval > 0 && cond.avaliacao > 0) {
      const razao = cond.avaliacao / aval;
      if (razao < 0.5 || razao > 2) pertence = false;
    }
    // Ficha do imóvel: só publica o que PERTENCE ao lote (edital de outro lote anexado por
    // engano vira anomalia no chamador e não pode virar "informação confirmada" na tela).
    if (pertence) {
      await publicarDocFatos(imovelId, { identidade, custos, pagamento, fonteEdital: url });
    }
    return { ...cond, pagamento, custos, identidade, datas, fonteUrl: url, pertenceAoLote: pertence, deCache };
  }
  return null;
}

/**
 * METRAGEM/Nº DA MATRÍCULA para o mercadológico — determinística e com cache, SEM
 * depender do laudo documental (que continua sendo quem lê matrícula escaneada por
 * visão). Casos documentados de divergência de metragem anúncio×matrícula pedem a
 * área REAL antes do R$/m². Candidatos: anexos tipo matrícula → link_matricula →
 * anexo do acervo (imovel_anexos). Best-effort: null nunca degrada o relatório.
 */
export async function extratoMatricula(imovelId, { deadline } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const fim = Number(deadline) || (Date.now() + 30000);
  let im = null, anexoAcervo = null;
  try {
    const hdr = { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=link_matricula,anexos&limit=1`, hdr);
    [im] = await r.json();
    const ra = await fetch(`${SUPABASE_URL}/rest/v1/imovel_anexos?imovel_id=eq.${encodeURIComponent(imovelId)}&tipo=eq.matricula&select=url&limit=1`, hdr);
    [anexoAcervo] = await ra.json().catch(() => []);
  } catch { return null; }
  if (!im) return null;
  // 1º: leitura por VISÃO do documental (confiança 90), publicada por imóvel. É a mais
  // precisa e já foi paga — se existe, nada é baixado nem re-lido.
  const porImovel = await cacheLer(`i:${String(imovelId)}`, { maxDias: 36500 });
  if (Number(porImovel?.campos?.matricula?.areaPrivativaM2) > 0) {
    await publicarDocFatos(imovelId, { matricula: porImovel.campos.matricula });
    return { ...porImovel.campos.matricula, fonteUrl: null, deCache: true, via: 'visao' };
  }
  const anexos = Array.isArray(im.anexos) ? im.anexos : [];
  const cands = [...new Set([
    ...anexos.filter(a => a?.tipo === 'matricula').map(a => a.url),
    im.link_matricula,
    anexoAcervo?.url,
  ].filter(u => u && /^https?:\/\//i.test(u) && !/matricula\.asp|detalhe-imovel\.asp/i.test(u)))].slice(0, 3);
  for (const url of cands) {
    if (Date.now() > fim) break;
    const hit = await cacheLer(chaveUrl(url));
    if (hit?.campos?.matricula) {
      await publicarDocFatos(imovelId, { matricula: hit.campos.matricula, identidade: hit.campos.identidade || null, fonteMatricula: url });
      return { ...hit.campos.matricula, fonteUrl: url, deCache: true };
    }
    const txt = await lerTexto(url, fim);
    if (!txt) continue;
    const mat = extrairMatriculaTexto(txt);
    if (!mat) continue; // PDF escaneado/sem âncora → fica p/ a visão do documental
    // A MATRÍCULA descreve o imóvel melhor que o edital (é dela que sai o nome do
    // empreendimento e o logradouro na forma registral) — lê a identidade no mesmo texto.
    const idm = extrairIdentidadeTexto(txt);
    const meta = { url, imovelId, tipoDoc: 'matricula', campos: { matricula: mat, ...(idm ? { identidade: idm } : {}) }, via: 'regex', confianca: 60 };
    await cacheGravar(chaveUrl(url), meta);
    await cacheGravar(chaveConteudo(txt), meta);
    await publicarDocFatos(imovelId, { matricula: mat, identidade: idm, fonteMatricula: url });
    return { ...mat, fonteUrl: url, deCache: false };
  }
  return null;
}
