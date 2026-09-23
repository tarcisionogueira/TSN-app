/**
 * APURAÇÃO SUPERBID/SOLD pelo IP RESIDENCIAL — 23/09/2026.
 *
 * Por que existe: 4.460 imóveis SUPERBID, 349 SOLD e 2.186 veículos SUPERBID vencidos sem
 * resultado. O cron da Vercel lê a página /oferta/<id>, que é montada no navegador e, de
 * datacenter (Vercel e GitHub), toma 403 do Cloudflare — até de dentro do Chromium ("Failed to
 * fetch"). Do IP residencial do dono a offer-query responde (recon de 23/09, WSL).
 *
 * O QUE A API DEVOLVE numa oferta encerrada (medido): `offerStatus.{sold,closed,…}`,
 * `auction.allOffersOfThisAuctionIsClosed`, `offerDetail.{initialBidValue,currentMinBid,
 * currentMaxBid}`. Na única amostra medida, TODO `offerStatus` veio false — inclusive `closed`,
 * com o leilão encerrado. Ou seja: a bandeira pode não refletir o fim. Por isso:
 *
 *   • EM SECO POR PADRÃO (forma nº 10 do CLAUDE.md: rodar sobre dado real ANTES de gravar).
 *     Imprime cada oferta com os sinais e a classificação que DARIA, e a distribuição no fim.
 *     Só grava com SBID_APLICAR=1 — e só depois de a distribuição em seco ter sido conferida
 *     contra ofertas cujo desfecho se sabe.
 *   • NUNCA INFERE vendido: só `offerStatus.sold === true` (ou lance máximo ACIMA do mínimo com
 *     o leilão encerrado) vira vendido. Sem lance exige leilão encerrado E lance máximo igual ao
 *     mínimo E `sold` false. Qualquer outra combinação = indeterminado (não grava resultado,
 *     só conta a tentativa).
 *   • "Não achei a oferta" NÃO é sem lance: vira `nao_encontrada` e não grava resultado (forma
 *     nº 4 — ausência não é resposta).
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; SBID_APLICAR=1 grava; SBID_LIMITE (padrão 60
 * em seco, 400 aplicando); SBID_IDS=1,2,3 força ids (diagnóstico, nunca grava).
 */
import puppeteer from 'puppeteer';

const SB_URL = process.env.VITE_SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APLICAR = process.env.SBID_APLICAR === '1' && !process.env.SBID_IDS;
const LIMITE = Number(process.env.SBID_LIMITE || (APLICAR ? 400 : 60));
const MAX_TENTATIVAS = 6;
if (!SB_URL || !SB_KEY) { console.error('defina VITE_SUPABASE_URL e SUPABASE_SERVICE_KEY'); process.exit(1); }

async function sb(path, init = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`supabase ${r.status} em ${path.split('?')[0]}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

const idDaUrl = (u) => (String(u || '').match(/\/oferta\/(\d+)/) || [])[1] || null;

// ── candidatos: vencidos sem resultado, mais recentes primeiro ─────────────────────────────
const hoje = new Date().toISOString().slice(0, 10);
let alvos = [];
if (process.env.SBID_IDS) {
  alvos = process.env.SBID_IDS.split(',').map(s => s.trim()).filter(Boolean).map(id => ({ tabela: '-', id: null, ofertaId: id }));
} else {
  const filtroRes = `or=(resultado_leilao.is.null,resultado_leilao.eq.indeterminado)&resultado_apuracao_tentativas=lt.${MAX_TENTATIVAS}`;
  const meio = Math.ceil(LIMITE / 2);
  const [imo, vei] = await Promise.all([
    sb(`imoveis_leilao?fonte=in.(SUPERBID,SOLD)&data_fim=lt.${hoje}&${filtroRes}&select=id,url_lote,resultado_apuracao_tentativas,ativo,suprimido_motivo&order=data_fim.desc&limit=${meio}`),
    sb(`veiculos_leilao?fonte=eq.SUPERBID&data_leilao=lt.${hoje}&${filtroRes}&select=id,link_lote,resultado_apuracao_tentativas&order=data_leilao.desc&limit=${LIMITE - meio}`),
  ]);
  for (const r of imo) { const o = idDaUrl(r.url_lote); if (o) alvos.push({ tabela: 'imoveis_leilao', ...r, ofertaId: o }); }
  for (const r of vei) { const o = idDaUrl(r.link_lote); if (o) alvos.push({ tabela: 'veiculos_leilao', ...r, ofertaId: o }); }
}
console.log(`[apurar-superbid] ${APLICAR ? 'APLICANDO' : 'EM SECO'} · ${alvos.length} oferta(s)`);
if (!alvos.length) process.exit(0);

// ── navegador: entra no site e consulta a API de dentro dele ──────────────────────────────
const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-blink-features=AutomationControlled', '--window-size=1280,900'],
});
const page = await browser.newPage();
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
await page.goto('https://www.superbid.net/categorias/imoveis', { waitUntil: 'domcontentloaded', timeout: 45000 })
  .catch(e => console.log('goto:', e.message));
await new Promise(r => setTimeout(r, 3000));

async function consultar(ofertaId) {
  return page.evaluate(async (id, bruto) => {
    const erros = [];
    for (const st of ['closed', 'finished', '', 'opened']) {
      const u = `https://offer-query.superbid.net/offers/?portalId=[2,15]&locale=pt_BR${st ? `&searchType=${st}` : ''}&filter=id:${id}&pageNumber=1&pageSize=5`;
      try {
        const x = await fetch(u, { headers: { Accept: 'application/json' } });
        if (!x.ok) { erros.push(`${st || 'nenhum'}:http ${x.status}`); continue; }
        const j = await x.json();
        const lista = j.offers || j.content || j.results || j.items || [];
        const of = lista.find(o => String(o?.id) === String(id));
        if (!of) continue;
        // Diagnóstico (SBID_IDS): devolve a oferta INTEIRA — o campo que separa "sem lance" de
        // "1 lance no mínimo" ainda não foi identificado (maior = mínimo nos dois casos).
        if (bruto) return { ok: true, via: st || 'nenhum', bruto: JSON.stringify(of) };
        const s = of.offerStatus || {};
        const d = of.offerDetail || {};
        return {
          ok: true, via: st || 'nenhum',
          sold: s.sold === true, closed: s.closed === true, closedToBids: s.closedToBids === true,
          leilaoEncerrado: of.auction?.allOffersOfThisAuctionIsClosed === true,
          min: Number(d.currentMinBid ?? d.initialBidValue ?? NaN),
          max: Number(d.currentMaxBid ?? NaN),
        };
      } catch (e) { erros.push(`${st || 'nenhum'}:${e.message}`); }
    }
    return { ok: false, erros };
  }, ofertaId, !!process.env.SBID_IDS);
}

function classificar(c) {
  if (!c.ok) return c.erros?.length ? 'erro' : 'nao_encontrada';
  const temMax = Number.isFinite(c.max) && c.max > 0;
  const acima = temMax && Number.isFinite(c.min) && c.max > c.min;
  const encerrado = c.leilaoEncerrado || c.closed || c.closedToBids;
  if (c.sold) return 'vendido';
  if (encerrado && acima) return 'vendido';
  // SUSPENSO (23/09): `max === min` NÃO prova sem lance — 5008418 foi VENDIDA por exatamente o
  // mínimo (1.721.807,43) e a API mostra max = min. Falta o campo de nº de lances/vencedor.
  if (encerrado && temMax && c.max === c.min) return 'indeterminado';
  return 'indeterminado';
}

const dist = {};
let gravados = 0, falhasGravacao = 0;
for (const a of alvos) {
  const c = await consultar(a.ofertaId);
  if (c.bruto) { console.log(`\n══════ ${a.ofertaId} (via=${c.via})\n${c.bruto.slice(0, 12000)}`); continue; }
  const res = classificar(c);
  dist[res] = (dist[res] || 0) + 1;
  console.log(`  ${a.tabela.padEnd(15)} ${a.ofertaId} → ${res.padEnd(14)} ${c.ok
    ? `via=${c.via} sold=${c.sold} closed=${c.closed} leilaoEnc=${c.leilaoEncerrado} min=${c.min} max=${c.max}`
    : `(${(c.erros || []).join(' | ') || 'sem oferta em nenhum searchType'})`}`);

  if (APLICAR && a.id && res !== 'erro') {
    const patch = { resultado_apurado_em: new Date().toISOString(), resultado_apuracao_tentativas: (a.resultado_apuracao_tentativas || 0) + 1 };
    if (res === 'vendido' || res === 'sem_lance') {
      patch.resultado_leilao = res;
      if (res === 'vendido' && Number.isFinite(c.max) && c.max > 0) patch.valor_lance_vencedor = c.max;
      if (a.tabela === 'imoveis_leilao') patch.resultado_origem = 'api_superbid_residencial';
    } else {
      patch.resultado_leilao = 'indeterminado';
    }
    try {
      const r = await sb(`${a.tabela}?id=eq.${a.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      if (Array.isArray(r) && r.length) gravados++; else { falhasGravacao++; console.log(`    ⚠️ PATCH não alcançou ${a.tabela}#${a.id}`); }
    } catch (e) { falhasGravacao++; console.log(`    ⚠️ ${e.message}`); }
  }
  await new Promise(r => setTimeout(r, 1200)); // 1 oferta/s — IP de casa, sem pressa
}
await browser.close();

console.log(`[apurar-superbid] distribuição: ${JSON.stringify(dist)}${APLICAR ? ` · gravados=${gravados} falhas=${falhasGravacao}` : ' · EM SECO, nada gravado'}`);
// Tudo "erro" = a API não respondeu daqui (bloqueio): isso tem que sair ≠ 0, não verde.
if ((dist.erro || 0) === alvos.length) { console.error('[apurar-superbid] TODAS as consultas falharam — API inacessível deste IP'); process.exit(3); }
if (falhasGravacao) process.exit(4);
