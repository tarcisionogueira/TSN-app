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
import { resolveMx } from 'node:dns/promises';

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
// Fração dos lotes da fonte que estão na origem dominante. PORTAL de verdade (SUPERBID, SOLD,
// LEILAOBRASIL) hospeda os lotes no próprio domínio (~100%); SOFTWARE white-label (LEILOTECH, VLANCE,
// GESTAOLEILOES) põe cada leiloeiro no domínio DELE — ali a "origem dominante" é só o maior leiloeiro,
// e o e-mail dele não pode virar o "da plataforma" para os outros (dry-run de 04/10: oleiloes,
// hdleiloes e lancenoleilao saíram como "plataforma").
const fracaoDominante = new Map([...contagemOrigem].map(([f, m]) => {
  const tot = [...m.values()].reduce((a, b) => a + b, 0);
  return [f, tot ? Math.max(...m.values()) / tot : 0];
}));

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
  if (multi === true && (fracaoDominante.get(fonte) || 0) < 0.95) { // 95%: GESTAOLEILOES tem 94% num leiloeiro e 2 lotes de outro
    resultado.sem.push({ fonte, motivo: `plataforma white-label (${Math.round((fracaoDominante.get(fonte) || 0) * 100)}% dos lotes no domínio dominante) — só contato por leiloeiro` });
    console.log(`  ⤷ ${fonte.padEnd(20)} white-label: cada leiloeiro no próprio domínio — sem e-mail de plataforma (contato por leiloeiro abaixo)`);
    continue;
  }

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

// ── 2ª ETAPA: CONTATO POR LEILOEIRO nas plataformas multi-tenant (04/10, pendência 131) ──────────
// O e-mail da plataforma é só reserva; o certo é o do LEILOEIRO do lote. O leiloeiro assina o edital
// publicado no DJEN e quase sempre põe o e-mail ali (medido: JM Leilões, DH Leilões, Rodovalho…). O
// edital também cita vara, tribunal e cartório, então só entra domínio com "leil" no nome, nunca
// jus.br/gov.br/mp.br nem endereço de vara/LGPD — e o mais citado ganha. Grava em
// leiloeiro_contato_tenant (origem 'auto'; um 'manual' nunca é sobrescrito: o insert ignora conflito).
const resTenant = { achado: [], gravado: [], sem: 0 };
const cacheMx = new Map();
async function temMx(dom) {
  if (!cacheMx.has(dom)) cacheMx.set(dom, resolveMx(dom).then((r) => r.length > 0).catch((e) => {
    if (!['ENOTFOUND', 'ENODATA'].includes(e.code)) console.log(`  ⚠ MX de ${dom} não verificado (${e.code}) — não grava`);
    return false;
  }));
  return cacheMx.get(dom);
}
const ehMulti = new Set(resultado.multi);
const lotesTenant = await todas('imoveis_leilao?ativo=eq.true&leiloeiro=not.is.null&select=fonte,leiloeiro&order=fonte');
const porTenant = new Map();
for (const r of lotesTenant) {
  if (!ehMulti.has(r.fonte) || String(r.leiloeiro).trim().length < 8) continue;
  const k = `${r.fonte}|${r.leiloeiro}`;
  porTenant.set(k, (porTenant.get(k) || 0) + 1);
}
const jaTenant = new Set((await sb('leiloeiro_contato_tenant?select=fonte,leiloeiro_chave')).map((c) => `${c.fonte}|${c.leiloeiro_chave}`));
const RUIM = /(\.jus\.br|\.gov\.br|\.mp\.br|\.leg\.br)$/i;
const LOCAL_RUIM = /^(lgpd|privacidade|dpo|encarregado|noreply|no-reply)|vara|civel|cartorio|forum|tribunal/i;
for (const [k, nLotes] of [...porTenant].sort((a, b) => b[1] - a[1])) {
  const [fonte, leiloeiro] = k.split('|');
  const chave = await sb('rpc/leiloeiro_chave_tenant', { method: 'POST', body: JSON.stringify({ p_fonte: fonte, p_leiloeiro: leiloeiro }) });
  if (!chave || jaTenant.has(`${fonte}|${chave}`)) continue;
  // Nome sem o sufixo "- Leiloeira Oficial"/"LEILÕES" — o edital escreve o nome civil.
  const nome = String(leiloeiro).replace(/\s*[-–].*$/, '').replace(/\b(leil[õo]es|leiloeir[oa]s?( oficial)?)\b/gi, '').trim();
  // Nome de UMA palavra ("NOGUEIRA", "Vasconcelos") casa com qualquer edital que a cite — dry-run de
  // 04/10 deu NOGUEIRA LEILÕES → contato@saraivaleiloes (outra leiloeira, mesmo edital). Exige 2+ palavras.
  if (nome.length < 8 || nome.split(/\s+/).filter((w) => w.length >= 3).length < 2) { resTenant.sem++; continue; }
  const editais = await sb(`editais_leilao?texto_integral=ilike.*${encodeURIComponent(nome)}*&select=texto_integral&limit=40`).catch((e) => { console.log(`  ⚠ ${fonte} / ${leiloeiro}: editais ilegíveis (${String(e.message).slice(0, 80)})`); return []; });
  const cont = new Map();
  const nomeRe = new RegExp(nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi');
  for (const e of editais || []) {
    // O e-mail tem de estar PERTO do nome (até 1.500 caracteres): o edital cita vários leiloeiros,
    // comitentes e a plataforma, e "o mais citado no texto inteiro" premiava o de outra pessoa.
    const txt = String(e.texto_integral || '');
    const semAcento = txt.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const posNome = [...semAcento.matchAll(nomeRe)].map((m) => m.index);
    if (!posNome.length) continue;
    for (const m of txt.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) {
      if (!posNome.some((p) => Math.abs(p - m.index) <= 1500)) continue;
      const em = m[0].toLowerCase().replace(/\.$/, '');
      const [local, dom] = em.split('@');
      if (!dom || RUIM.test(dom) || LOCAL_RUIM.test(local) || !/leil/i.test(dom)) continue;
      cont.set(em, (cont.get(em) || 0) + 1);
    }
  }
  // Domínio sem MX não recebe e-mail: o edital da Hidirlene traz "leiloesjudiciaises" (erro de
  // digitação). Fica com o mais citado cujo domínio responde MX; DNS fora do ar = não grava.
  let melhor = null;
  for (const cand of [...cont.entries()].sort((a, b) => b[1] - a[1])) {
    if (await temMx(cand[0].split('@')[1])) { melhor = cand; break; }
  }
  if (!melhor) { resTenant.sem++; continue; }
  const sup = await sb(`emails_supressao?destinatario=eq.${encodeURIComponent(melhor[0])}&select=suprimido`);
  if (sup?.[0]?.suprimido) { resTenant.sem++; continue; }
  console.log(`  ✓ ${fonte.padEnd(14)} ${leiloeiro.slice(0, 34).padEnd(34)} ${melhor[0]}  (${melhor[1]} edital(is) do DJEN · ${nLotes} lotes)`);
  resTenant.achado.push(k);
  if (!APLICAR) continue;
  const g = await sb('leiloeiro_contato_tenant?on_conflict=fonte,leiloeiro_chave', {
    method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ fonte, leiloeiro_chave: chave, leiloeiro, email: melhor[0], origem: 'auto', observacao: `citado em ${melhor[1]} edital(is) do DJEN com o nome "${nome}"`.slice(0, 300), atualizado_em: new Date().toISOString() }),
  });
  if (g?.length) resTenant.gravado.push(k);
}
console.log(`\nLEILOEIROS DE PLATAFORMA — ${APLICAR ? `gravados: ${resTenant.gravado.length}` : `achados: ${resTenant.achado.length}`} · sem e-mail no DJEN: ${resTenant.sem}`);

console.log(`\n${APLICAR ? 'GRAVADO' : 'EM SECO'} — fontes: ${origemPorFonte.size} · já tinham: ${resultado.ja.length} · multi-tenant: ${resultado.multi.length} · ${APLICAR ? `gravados: ${resultado.gravado.length}` : `achados: ${resultado.achado.length}`} · sem e-mail: ${resultado.sem.length}`);
const porMotivo = {};
for (const s of resultado.sem) { const k = s.motivo.replace(/\(.*\)/, '').trim(); porMotivo[k] = (porMotivo[k] || 0) + 1; }
for (const [k, n] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(3)} × ${k}`);
await navegador?.close();
