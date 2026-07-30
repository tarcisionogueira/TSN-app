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
import { fetchViaBrightData } from './_brightdata.js';
import { hostExternoSeguro } from './_allowed-hosts.js';
import { vasculharDocumentos, chaveDocCanonica } from './_doc-scan.js';
import { extrairRegistroMatricula } from './_registro-matricula.js';
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
  try { resp = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(9000) }); } catch { resp = null; }
  if (resp && resp.ok) {
    const text = await resp.text().catch(() => '');
    if (text && text.length > 500) return { html: text, finalUrl: resp.url || url, via: 'direct' };
  }
  const bd = await fetchViaBrightData(url);
  if (bd && bd.ok) {
    const text = await bd.text().catch(() => '');
    if (text) return { html: text, finalUrl: url, via: 'brightdata' };
  }
  return { html: '', finalUrl: url, via: 'fail' };
}

// Extrai a DATA do próximo leilão/praça da página do lote (Caixa OU leiloeiro).
// Conservador: ancora em "leilão/praça/encerra/licitação/data", aceita ano com 2 ou
// 4 dígitos e escolhe a PRÓXIMA data futura — em leilões de 2 praças ignora a 1ª já
// passada, evitando mostrar um dia errado ao cliente.
export function extrairDataLeilao(html) {
  if (!html) return null;
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const re = /(?:leil[ãa]o|pra[çc]a|encerra|licita[çc][ãa]o|data)[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{2,4})/gi;
  const ontem = Date.now() - 86400000;
  const limite = Date.now() + 400 * 86400000; // até ~1 ano à frente
  const futuras = [];
  let m;
  while ((m = re.exec(txt))) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const t = Date.parse(`${y}-${m[2]}-${m[1]}`);
    if (!isNaN(t) && t >= ontem && t < limite) futuras.push(t);
  }
  if (!futuras.length) return null;
  return new Date(Math.min(...futuras)).toISOString().slice(0, 10);
}

// Extrai o VALOR DE AVALIAÇÃO da página do lote (leiloeiros mostram "Valor de
// avaliação"/"Valor Avaliado"/"Avaliação: R$ ..."). Muitos leiloeiros não trazem a
// avaliação na listagem em massa (ou mandam sentinela), então buscamos on-demand.
export function extrairAvaliacao(html) {
  if (!html) return null;
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
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
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' }, redirect: 'follow', signal: AbortSignal.timeout(9000) });
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

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=id,fonte,modalidade,data_leilao,url_lote,link_edital,link_matricula,link_regras_venda,link_foto,anexos,enriquecido_em,ficha_cef,matricula_scan_em&limit=1`)).json();
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
    const data = html ? extrairDataLeilao(html) : null;
    const patch = { enriquecido_em: new Date().toISOString() };
    if (data) patch.data_leilao = data;
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }).catch(() => {});
    res.status(200).json({ ok: !!data, pulado: 'cef', alterado: !!data, data_leilao: data || null }); return;
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
  const precisaData = !im.data_leilao && !ehVendaDireta; // leilão de leiloeiro sem data → também busca
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

  // Pula só quando já tem tudo (docs E data) ou tentou há pouco (throttle de 12h).
  if (!forcar && ((temDocs && !precisaData) || enriqRecente)) {
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
  // Data do leilão do leiloeiro (mesma extração da CEF): só quando falta e não é venda direta.
  const dataLeilao = precisaData ? extrairDataLeilao(html) : null;
  if (dataLeilao) patch.data_leilao = dataLeilao;

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
    anexos: achado.anexos,
  });
}
