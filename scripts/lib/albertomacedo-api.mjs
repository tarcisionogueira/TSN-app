/**
 * Localização dos lotes ALBERTOMACEDO pela API pública do próprio site (03/10).
 *
 * O site é uma SPA sobre PostgREST (api.albertomacedoleiloes.com.br/rest/v1). Item de PACOTE
 * (`/lote/<n>-<slug>`) não escreve a cidade na página: o lote só traz `city_id`/`state_id`, e o
 * nome vem das tabelas `cities`/`states`. O parser de DOM (cidadeDoLote) nunca a achou — 12 lotes
 * do pacote "Imóveis em CE, GO, PR e SP" entraram em 01/10 sem cidade, fora da vitrine e com pino
 * chutado pelo geocodificador. Recon de 03/10 (recon-albertomacedo-api.mjs) provou o caminho:
 * Moema → city "São Paulo" + state code "SP"; os 8 itens do pacote têm city_id.
 *
 * A chave é a PÚBLICA que a página manda em toda chamada (header `apikey`), capturada em runtime
 * num Chromium — nunca fica no código. Falha em qualquer passo LANÇA com o motivo: o chamador
 * (gancho `enriquecerProntos` do motor) loga e segue sem enriquecer — a coleta não para por isso.
 */
import puppeteer from 'puppeteer';
import { idDaUrl } from './albertomacedo-parse.mjs';

const BASE = 'https://albertomacedoleiloes.com.br';
const API = 'https://api.albertomacedoleiloes.com.br/rest/v1';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const ufValida = (uf) => /^[A-Z]{2}$/.test(String(uf || ''));

/** Abre uma página do site e devolve o header `apikey` da 1ª chamada à API. */
export async function capturarChave(rota) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let chave = null;
  try {
    const ctx = await browser.createBrowserContext();   // sessão isolada (Cloudflare por sessão)
    const page = await ctx.newPage();
    await page.setUserAgent(UA);
    page.on('request', (req) => {
      if (!chave && req.url().startsWith(API)) chave = req.headers()['apikey'] || null;
    });
    await page.goto(`${BASE}${rota}`, { waitUntil: 'networkidle2', timeout: 60000 });
  } finally { await browser.close(); }
  if (!chave) throw new Error(`chave pública da API não apareceu ao abrir ${rota}`);
  return chave;
}

async function getApi(path, chave) {
  const r = await fetch(`${API}/${path}`, { headers: { apikey: chave, Authorization: `Bearer ${chave}`, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`API ${path.split('?')[0]} → HTTP ${r.status}`);
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(`API ${path.split('?')[0]} → resposta sem lista`);
  return j;
}

/**
 * PURO (testável sem rede). Preenche cidade/estado de quem está sem, a partir das linhas da API.
 * Nunca sobrescreve uma cidade que o parser já achou. → { preenchidos, semDado }
 */
export function aplicarLocalizacao(rows, lotesApi, cidades, estados) {
  const porSlug = new Map(lotesApi.map(l => [l.slug, l]));
  const cidadePorId = new Map(cidades.map(c => [c.id, c.name]));
  const ufPorId = new Map(estados.map(e => [e.id, String(e.code || '').toUpperCase()]));
  let preenchidos = 0, semDado = 0;
  for (const row of rows) {
    if (row.cidade && ufValida(row.estado)) continue;
    const lote = porSlug.get(idDaUrl(row.url_lote));
    const cidade = lote && cidadePorId.get(lote.city_id);
    const uf = lote && ufPorId.get(lote.state_id);
    if (!cidade || !ufValida(uf)) { semDado++; continue; }
    row.cidade = cidade; row.estado = uf; preenchidos++;
  }
  return { preenchidos, semDado };
}

/**
 * PURO (testável sem rede). DOCUMENTOS do lote pela tabela `lot_documents` da API (22/10).
 * O site desenha a lista de documentos com onClick (sem <a href>), e o parser de DOM nunca os achou:
 * 28 lotes ativos com 0 documento, com 722 documentos publicados na API (113 edital, 65 matrícula,
 * 56 avaliação). `/lote/<slug>` casa por `public_lots.slug`; `/leilao/<uuid>` é o id do EVENTO e
 * casa por `public_lots.auction_id` — só quando o evento tem UM lote (pacote não tem como saber qual).
 * `.bin` fica de fora (não é arquivo legível). Nunca apaga documento que o row já tenha.
 */
const TIPO_DOC = { edital: 'edital', matricula: 'matricula', avaliacao: 'laudo' };
export function aplicarDocumentos(rows, lotesApi, docsApi) {
  const porSlug = new Map(lotesApi.map(l => [l.slug, l]));
  const porEvento = new Map();
  for (const l of lotesApi) if (l.auction_id) (porEvento.get(l.auction_id) || porEvento.set(l.auction_id, []).get(l.auction_id)).push(l);
  const docsPorLote = new Map();
  for (const d of docsApi) {
    const url = String(d.file_url || '');
    if (!/^https?:\/\//i.test(url) || /\.bin(\?|#|$)/i.test(url)) continue;
    (docsPorLote.get(d.lot_id) || docsPorLote.set(d.lot_id, []).get(d.lot_id)).push({
      tipo: TIPO_DOC[String(d.document_type || '').toLowerCase()] || 'outro',
      nome: String(d.title || d.document_type || 'Documento').trim().slice(0, 120), url,
    });
  }
  let comDoc = 0;
  for (const row of rows) {
    const id = idDaUrl(row.url_lote);
    const doEvento = porEvento.get(id);
    const lote = porSlug.get(id) || (doEvento && doEvento.length === 1 ? doEvento[0] : null);
    const docs = lote && docsPorLote.get(lote.id);
    if (!docs?.length) continue;
    const atuais = Array.isArray(row.anexos) ? row.anexos : [];
    const novos = docs.filter(d => !atuais.some(a => a?.url === d.url));
    row.anexos = [...atuais, ...novos];
    const ed = row.anexos.find(a => a.tipo === 'edital'), mat = row.anexos.find(a => a.tipo === 'matricula');
    if (ed) row.link_edital = ed.url;
    if (mat) row.link_matricula = mat.url;
    comDoc++;
  }
  return { comDoc };
}

const ehUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

/**
 * Gancho do motor. (1) Localização dos itens de pacote (`/lote/`) sem cidade/UF válida.
 * (2) Documentos de TODOS os lotes pela `lot_documents` (22/10). Uma chave, capturada uma vez.
 */
export async function enriquecerLocalizacao(rows) {
  const ids = [...new Set(rows.map(r => idDaUrl(r.url_lote)).filter(Boolean))];
  if (!ids.length) return 'API: nenhum lote';
  const chave = await capturarChave(`/${/\/lote\//.test(rows[0].url_lote || '') ? 'lote' : 'leilao'}/${idDaUrl(rows[0].url_lote)}`);
  const slugs = ids.filter(i => !ehUuid(i)), eventos = ids.filter(ehUuid);
  const lotes = [];
  const enc = (xs) => xs.map(encodeURIComponent).join(',');
  for (let i = 0; i < slugs.length; i += 50) lotes.push(...await getApi(`public_lots?select=id,slug,auction_id,city_id,state_id&slug=in.(${enc(slugs.slice(i, i + 50))})`, chave));
  for (let i = 0; i < eventos.length; i += 50) lotes.push(...await getApi(`public_lots?select=id,slug,auction_id,city_id,state_id&auction_id=in.(${enc(eventos.slice(i, i + 50))})`, chave));

  // (1) localização — só itens de pacote sem cidade/UF
  const alvoLoc = rows.filter(r => /\/lote\//.test(r.url_lote || '') && !(r.cidade && ufValida(r.estado)));
  let msgLoc = 'nenhum item de pacote sem cidade';
  if (alvoLoc.length) {
    const idsDe = (k) => [...new Set(lotes.map(l => l[k]).filter(Boolean))];
    const cidades = idsDe('city_id').length ? await getApi(`cities?select=id,name&id=in.(${idsDe('city_id').join(',')})`, chave) : [];
    const estados = idsDe('state_id').length ? await getApi(`states?select=id,code&id=in.(${idsDe('state_id').join(',')})`, chave) : [];
    const { preenchidos, semDado } = aplicarLocalizacao(alvoLoc, lotes, cidades, estados);
    msgLoc = `${preenchidos}/${alvoLoc.length} item(ns) de pacote com cidade${semDado ? ` · ${semDado} sem dado na API` : ''}`;
  }

  // (2) documentos
  const loteIds = [...new Set(lotes.map(l => l.id).filter(Boolean))];
  const docs = [];
  for (let i = 0; i < loteIds.length; i += 50) docs.push(...await getApi(`lot_documents?select=lot_id,title,file_url,document_type&lot_id=in.(${enc(loteIds.slice(i, i + 50))})`, chave));
  const { comDoc } = aplicarDocumentos(rows, lotes, docs);
  return `API: localização ${msgLoc} · documentos em ${comDoc}/${rows.length} lote(s) (${docs.length} na API)`;
}
