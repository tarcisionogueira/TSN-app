/**
 * RECON (em seco, não grava) — portal NOVA SERRANA LEILÕES (plataforma Webzi/"eblonline", Vue + API .NET em
 * api.serranaleiloes.com.br). leonardoveigaleiloes.com.br e lorranaleiloes.com.br servem o MESMO portal.
 * Triagem 22/10 (#292). A API pede um token de cliente anônimo: o site busca no carregamento, com as
 * credenciais de cliente PÚBLICAS do próprio bundle (`client_credentials`) — lidas do bundle a cada execução,
 * nunca gravadas no repositório. Imprime amostras do JSON para desenhar o parser.
 */
import { viaBanco } from './lib/motor/fetch-fonte.mjs';

const SITE = 'https://www.leiloesnovaserrana.com.br';
const API = 'https://api.serranaleiloes.com.br/';
const ID = 'https://id.serranaleiloes.com.br/';

async function texto(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status} ${t.slice(0, 200)}`);
  return t;
}

// O site (Cloudflare) dá 403 ao IP do GitHub e abre pelo banco (AWS): o bundle vem por lá. Só a API vai direto.
async function doSite(url) {
  try { return await texto(url); } catch (e) {
    const b = await viaBanco(url);
    if (!b.html) throw new Error(`${url}: direto (${String(e.message).slice(0, 60)}) e banco (${b.motivo}) falharam`, { cause: e });
    console.log(`${url}: via banco`);
    return b.html;
  }
}
const home = await doSite(SITE);
const app = (home.match(/\/js\/app\.[a-z0-9]+\.js/) || [])[0];
if (!app) throw new Error('bundle app.js não encontrado na home');
const js = await doSite(SITE + app);
const cid = (js.match(/"client_id","([^"]+)"/) || [])[1];
const sec = (js.match(/"client_secret","([^"]+)"/) || [])[1];
if (!cid || !sec) throw new Error('credenciais de cliente não encontradas no bundle');
const tok = JSON.parse(await texto(`${ID}connect/token`, {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: cid, client_secret: sec, grant_type: 'client_credentials' }),
}));
console.log('token ok:', !!tok.access_token, 'expira em', tok.expires_in, 's · scope', tok.scope);
const H = { Authorization: `Bearer ${tok.access_token}`, Accept: 'application/json' };
const get = async (p) => JSON.parse(await texto(API + p, { headers: H }));

for (const status of ['aberto', 'breve']) {
  const l = await get(`leilao?pageSize=100&pageNumber=1&status=${status}`);
  console.log(`\n== leilões ${status}: ${l.data?.length} (total ${l.totalRecords}, nextPage ${l.nextPage})`);
  console.log(JSON.stringify(l.data?.[0] || l).slice(0, 2500));
  for (const lei of (l.data || []).slice(0, 1)) {
    const lotes = await get(`lote?LeilaoId=${lei.id}&PageSize=100&PageNumber=1&RemoverEncerrados=true`);
    console.log(`-- lotes do leilão ${lei.id}: ${lotes.data?.length} (total ${lotes.totalRecords})`);
    console.log(JSON.stringify(lotes.data?.[0] || lotes).slice(0, 3000));
    const um = lotes.data?.[0];
    if (um) console.log('-- Lote/<id>:', JSON.stringify((await get(`Lote/${um.id}`)).data).slice(0, 5000));
  }
  console.log('categorias por leilão:', (l.data || []).map((x) => `${x.id}:${x.titulo || x.nome || x.descricao || ''}`.slice(0, 80)).join(' | ').slice(0, 2000));
}
