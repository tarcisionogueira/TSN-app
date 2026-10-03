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

/** Gancho do motor: só age nos itens de pacote (`/lote/`) sem cidade/UF válida. */
export async function enriquecerLocalizacao(rows) {
  const alvo = rows.filter(r => /\/lote\//.test(r.url_lote || '') && !(r.cidade && ufValida(r.estado)));
  if (!alvo.length) return 'localização pela API: nenhum item de pacote sem cidade';
  const slugs = [...new Set(alvo.map(r => idDaUrl(r.url_lote)).filter(Boolean))];
  const chave = await capturarChave(`/lote/${slugs[0]}`);
  const lotes = await getApi(`public_lots?select=slug,city_id,state_id&slug=in.(${slugs.map(encodeURIComponent).join(',')})`, chave);
  const ids = (k) => [...new Set(lotes.map(l => l[k]).filter(Boolean))];
  const cidades = ids('city_id').length ? await getApi(`cities?select=id,name&id=in.(${ids('city_id').join(',')})`, chave) : [];
  const estados = ids('state_id').length ? await getApi(`states?select=id,code&id=in.(${ids('state_id').join(',')})`, chave) : [];
  const { preenchidos, semDado } = aplicarLocalizacao(alvo, lotes, cidades, estados);
  return `localização pela API: ${preenchidos}/${alvo.length} item(ns) de pacote com cidade${semDado ? ` · ${semDado} sem dado na API` : ''}`;
}
