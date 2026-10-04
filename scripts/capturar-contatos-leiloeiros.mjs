/**
 * E-MAIL DOS LEILOEIROS SEM CONTATO — 29/09 (pedido do dono: "por que ainda temos vários
 * leiloeiros sem e-mail para enviar propostas?").
 *
 * Medido no mesmo dia: 61 fontes com lote ativo, só 5 com e-mail. A captura automática existia
 * (scripts/_contato-leiloeiro.mjs), mas (1) só era chamada pelos coletores de scraper-puppeteer —
 * fontes de outros coletores (motor, SATO, SOLEON, BAYIT, CRLEILOES, scraper.js) nunca tentavam;
 * (2) 25 sites protegem o e-mail com o Cloudflare (sem "@" no HTML); (3) 17 só têm o e-mail na
 * página de contato; (4) mesma marca em outro TLD era recusada; e (5) nada disso deixava rastro —
 * "não achei" saía calado. Este varredor passa por TODAS as fontes, de qualquer coletor, com a
 * mesma regra do coletor (e-mail do domínio do site; nunca endereço suprimido; nunca sobrescreve
 * 'manual'), e diz o MOTIVO de cada fonte que ficar sem.
 *
 * Plataformas multi-tenant (SUPERBID, SUPORTE, V-Lance…): o contato principal é por LEILOEIRO do lote
 * (`leiloeiro_contato_tenant`); desde 04/10 o varredor grava também o e-mail DA PLATAFORMA (mesmo
 * domínio do site) como reserva — ver o comentário no laço. E portais públicos (CEF, VENDASGOV, EDITAL_DJEN), que não recebem proposta por e-mail.
 * EM SECO por padrão; CONTATO_APLICAR=1 grava.
 */
import puppeteer from 'puppeteer';
import { buscarEmailDoSite, dominioBase } from './_contato-leiloeiro.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APLICAR = process.env.CONTATO_APLICAR === '1';
const FORA = new Set(['CEF', 'caixa', 'VENDASGOV', 'EDITAL_DJEN']);
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
async function todas(path) {
  const out = [];
  for (let de = 0; ; de += 1000) {
    const pag = await sb(`${path}&limit=1000&offset=${de}`);
    out.push(...pag);
    if (pag.length < 1000) return out;
  }
}

// 403 DE DATACENTER (29/09, 1ª rodada em seco): 30 das 57 homes respondem 403 a `fetch` saído do
// runner do GitHub (proteção anti-robô por IP) e 200 ao Chrome — que é como os coletores entram
// nesses mesmos sites todo dia. Então: fetch primeiro (barato); se não passar, Chrome.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
let navegador = null;
async function htmlNoChrome(url) {
  navegador ??= await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await navegador.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500)); // desafio anti-robô / rodapé montado por JS
    if (res && res.status() >= 400 && res.status() !== 403) throw new Error(`HTTP ${res.status()} no Chrome`);
    return await page.content();
  } finally { await page.close().catch(() => {}); } // padrao-ok: fechar aba best-effort
}
async function obterHtml(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' } });
    if (r.ok) return await r.text();
  } catch { /* cai para o Chrome logo abaixo — o motivo final vem de lá */ }
  return htmlNoChrome(url);
}

// Uma ORIGEM por fonte — a MAIS FREQUENTE entre os lotes ativos (04/10). Era a do 1º lote lido: em
// plataforma com loja white-label de leiloeiro, esse 1º lote podia estar no domínio de UM leiloeiro, e
// o e-mail dele viraria o "da plataforma" para todos (o caso JRF). A maioria é o domínio da plataforma.
const contagemOrigem = new Map(); // fonte → Map(origin → n)
const guardar = (fonte, url) => {
  if (!fonte || FORA.has(fonte)) return;
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return;
    const m = contagemOrigem.get(fonte) || new Map();
    m.set(u.origin, (m.get(u.origin) || 0) + 1);
    contagemOrigem.set(fonte, m);
  } catch { /* URL inválida: tenta a próxima linha da fonte */ }
};
for (const r of await todas('imoveis_leilao?ativo=eq.true&fonte=not.in.(CEF,caixa)&select=fonte,url_lote,link_edital&order=fonte')) guardar(r.fonte, r.url_lote || r.link_edital);
for (const r of await todas('veiculos_leilao?ativo=eq.true&select=fonte,link_lote&order=fonte')) guardar(r.fonte, r.link_lote);
const origemPorFonte = new Map([...contagemOrigem].map(([f, m]) => [f, [...m].sort((a, b) => b[1] - a[1])[0][0]]));

const contatos = new Map((await sb('leiloeiro_contato?select=fonte,email,origem')).map((c) => [c.fonte, c]));
const resultado = { gravado: [], achado: [], sem: [], multi: [], ja: [] };

for (const [fonte, origem] of [...origemPorFonte.entries()].sort()) {
  if (contatos.get(fonte)?.email) { resultado.ja.push(fonte); continue; }
  // PLATAFORMA MULTI-TENANT (04/10, pendência 131): o contato principal é por LEILOEIRO do lote
  // (`leiloeiro_contato_tenant`), mas ~1.900 lotes ativos não tinham NENHUM e-mail resolvível porque
  // estas fontes eram puladas inteiras. O resolvedor (`contato_leiloeiro_resolver`) já aceita um
  // e-mail DA PLATAFORMA como reserva (escopo 'plataforma', só `origem='auto'`), usado apenas quando
  // o leiloeiro do lote não tem o próprio — é o canal que a plataforma publica para atendimento.
  // A mesma régua do site próprio vale aqui: só e-mail do domínio DA PLATAFORMA (nunca o de um
  // leiloeiro citado na home — o caso JRF de 28/09 era exatamente um e-mail de outro domínio).
  // O edital do DJEN fica de fora: lá o e-mail é do leiloeiro que assinou, não da plataforma.
  const multi = await sb('rpc/fonte_multi_tenant', { method: 'POST', body: JSON.stringify({ p_fonte: fonte }) });
  if (multi === true) resultado.multi.push(fonte);

  let { achado, url, motivo } = await buscarEmailDoSite(origem, { obterHtml });
  // 2ª FONTE: EDITAIS DO DJEN (29/09). O leiloeiro assina o edital publicado no Diário da Justiça
  // e quase sempre põe o e-mail ali — 7 das 14 fontes "sem e-mail no site" tinham o endereço em
  // `editais_leilao.texto_integral`. Só vale e-mail do MESMO domínio do site (o edital também
  // cita a vara, o tribunal e o cartório), e o mais citado ganha.
  if (!achado && !multi) {
    const dom = dominioBase(new URL(origem).hostname);
    const rotulo = dom.split('.')[0];
    const editais = await sb(`editais_leilao?texto_integral=ilike.*${encodeURIComponent(rotulo)}*&select=texto_integral&limit=60`).catch((e) => { console.log(`  ⚠ ${fonte}: editais ilegíveis (${String(e.message).slice(0, 80)})`); return []; });
    const cont = new Map();
    for (const e of editais || []) for (const m of String(e.texto_integral || '').matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      const em = m[0].toLowerCase().replace(/\.$/, '');
      if (dominioBase(em.split('@')[1]) === dom && !/^(lgpd|privacidade|dpo|noreply|no-reply)@/.test(em)) cont.set(em, (cont.get(em) || 0) + 1);
    }
    const [melhor] = [...cont.entries()].sort((a, b) => b[1] - a[1]);
    if (melhor) { achado = { email: melhor[0], contexto: `citado em ${melhor[1]} edital(is) do DJEN` }; url = 'editais_leilao (DJEN)'; }
    else motivo += ` · e nenhum edital do DJEN com e-mail @${dom}`;
  }
  if (!achado) { resultado.sem.push({ fonte, motivo: multi ? `plataforma: ${motivo}` : motivo }); console.log(`  ✗ ${fonte.padEnd(20)} ${origem} — ${multi ? '(plataforma) ' : ''}${motivo}`); continue; }

  const sup = await sb(`emails_supressao?destinatario=eq.${encodeURIComponent(achado.email)}&select=suprimido`);
  if (sup?.[0]?.suprimido) { resultado.sem.push({ fonte, motivo: `${achado.email} está suprimido (bounce/reclamação)` }); console.log(`  ✗ ${fonte.padEnd(20)} ${achado.email} suprimido`); continue; }

  console.log(`  ✓ ${fonte.padEnd(20)} ${achado.email}  (${url === origem ? 'home' : url})${multi ? '  [e-mail da PLATAFORMA — reserva quando o leiloeiro do lote não tem o próprio]' : ''}`);
  if (!APLICAR) { resultado.achado.push(fonte); continue; }
  // `origem=is.null` no filtro não existe para upsert; a proteção do 'manual' é o `continue` acima
  // (fonte com e-mail não chega aqui) — e 'manual' sem e-mail não existe (o POST exige e-mail).
  const gravou = await sb('leiloeiro_contato?on_conflict=fonte', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ fonte, email: achado.email, origem: 'auto', observacao: `${multi ? 'PLATAFORMA (reserva) · ' : ''}${achado.contexto || ''} · achado em ${url}`.slice(0, 300), atualizado_em: new Date().toISOString() }),
  });
  if (gravou?.length) resultado.gravado.push(fonte);
  else resultado.sem.push({ fonte, motivo: 'upsert não devolveu linha' });
}

console.log(`\n${APLICAR ? 'GRAVADO' : 'EM SECO'} — fontes: ${origemPorFonte.size} · já tinham: ${resultado.ja.length} · multi-tenant: ${resultado.multi.length} · ${APLICAR ? `gravados: ${resultado.gravado.length}` : `achados: ${resultado.achado.length}`} · sem e-mail: ${resultado.sem.length}`);
const porMotivo = {};
for (const s of resultado.sem) { const k = s.motivo.replace(/\(.*\)/, '').trim(); porMotivo[k] = (porMotivo[k] || 0) + 1; }
for (const [k, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)} × ${k}`);
await navegador?.close();
