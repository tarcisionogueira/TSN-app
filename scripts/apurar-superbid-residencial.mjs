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
 *   • A REGRA (ver `classificar`) usa `totalBids`, `winnerBid` e `reservedPrice` — medidos em
 *     23/09. `offerStatus.sold` e "máximo = mínimo" NÃO servem: vieram iguais em vendido falso,
 *     deserto e lance único. Condicional (lance abaixo da reserva) e retirado não gravam
 *     resultado: ficam indeterminado e voltam na próxima rodada (até 6 tentativas).
 *   • "Não achei a oferta" NÃO é sem lance: vira `nao_encontrada` e não grava resultado (forma
 *     nº 4 — ausência não é resposta).
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY; SBID_APLICAR=1 grava; SBID_LIMITE (padrão 60
 * em seco, 400 aplicando); SBID_IDS=1,2,3 força ids (diagnóstico, nunca grava).
 */
import puppeteer from 'puppeteer';
import { classificarOferta } from './lib/superbid-resultado.mjs';

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
  return page.evaluate(async (id) => {
    const erros = [];
    for (const st of ['closed', 'finished', '', 'opened']) {
      const u = `https://offer-query.superbid.net/offers/?portalId=[2,15]&locale=pt_BR${st ? `&searchType=${st}` : ''}&filter=id:${id}&pageNumber=1&pageSize=5`;
      try {
        const x = await fetch(u, { headers: { Accept: 'application/json' } });
        if (!x.ok) { erros.push(`${st || 'nenhum'}:http ${x.status}`); continue; }
        const j = await x.json();
        const lista = j.offers || j.content || j.results || j.items || [];
        const of = lista.find(o => String(o?.id) === String(id));
        if (of) return { ok: true, via: st || 'nenhum', of };
      } catch (e) { erros.push(`${st || 'nenhum'}:${e.message}`); } // padrao-ok: motivo vai para erros[], impresso e vira 'erro' (exit 3 se todos)
    }
    return { ok: false, erros };
  }, ofertaId);
}

const dist = {};
let gravados = 0, falhasGravacao = 0;
for (const a of alvos) {
  const q = await consultar(a.ofertaId);
  if (q.ok && process.env.SBID_IDS) {
    // Diagnóstico: oferta inteira vai para o BANCO (recon_dump) — JSON longo demais para print.
    try {
      await sb('recon_dump', { method: 'POST', body: JSON.stringify({ origem: 'sbid_oferta', chave: String(a.ofertaId), conteudo: q.of }) });
      console.log(`  ${a.ofertaId} → oferta completa gravada em recon_dump (via=${q.via}) · daria ${classificarOferta(q.of).resultado}`);
    } catch (e) { console.log(`  ${a.ofertaId} → falhou gravar dump: ${e.message}`); }
    continue;
  }
  const r = q.ok ? classificarOferta(q.of) : { resultado: q.erros?.length ? 'erro' : 'nao_encontrada' };
  const res = r.resultado, c = r.c;
  dist[res] = (dist[res] || 0) + 1;
  console.log(`  ${a.tabela.padEnd(15)} ${a.ofertaId} → ${res.padEnd(13)} ${c
    ? `lances=${c.lances} vencedor=${c.vencedor} max=${c.max} reserva=${c.reserva} removido=${c.removido} status=${c.statusCode}`
    : `(${(q.erros || []).join(' | ') || 'sem oferta em nenhum searchType'})`}`);

  if (APLICAR && a.id && res !== 'erro') {
    const patch = { resultado_apurado_em: new Date().toISOString(), resultado_apuracao_tentativas: (a.resultado_apuracao_tentativas || 0) + 1 };
    // em_andamento: a data do nosso acervo venceu mas o site ainda aceita lance (praça
    // prorrogada). Conta a tentativa sem gravar resultado — senão o lote volta ao topo da
    // fila todo dia e come as vagas dos outros.
    if (res === 'em_andamento') { /* só a tentativa */ }
    else if (res === 'vendido' || res === 'sem_lance') {
      patch.resultado_leilao = res;
      if (res === 'vendido' && r.valor) patch.valor_lance_vencedor = r.valor;
      if (a.tabela === 'imoveis_leilao') patch.resultado_origem = 'api_superbid_residencial';
    } else {
      patch.resultado_leilao = 'indeterminado';
    }
    // Leilão negativo volta para a vitrine (23/09) — mesmo `religarSeNaoVendido` do cron da
    // Vercel: o lote foi desligado por praça vencida ou por sair da vitrine da SUPERBID, e é
    // justamente o que o cliente procura para propor compra. Fica 15 dias
    // (desativar_leiloes_encerrados / sweep / retenção de veículos respeitam a mesma janela).
    const religavel = a.tabela !== 'imoveis_leilao' || !a.suprimido_motivo || ['praca_vencida', 'sumiu_da_fonte'].includes(a.suprimido_motivo);
    if (religavel && res !== 'vendido' && res !== 'em_andamento' && res !== 'retirado') {
      patch.ativo = true;
      if (a.tabela === 'imoveis_leilao') patch.suprimido_motivo = null;
    }
    try {
      const rp = await sb(`${a.tabela}?id=eq.${a.id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
      if (Array.isArray(rp) && rp.length) gravados++; else { falhasGravacao++; console.log(`    ⚠️ PATCH não alcançou ${a.tabela}#${a.id}`); }
    } catch (e) { falhasGravacao++; console.log(`    ⚠️ ${e.message}`); }
  }
  await new Promise(r => setTimeout(r, 1200)); // 1 oferta/s — IP de casa, sem pressa
}
await browser.close();

console.log(`[apurar-superbid] distribuição: ${JSON.stringify(dist)}${APLICAR ? ` · gravados=${gravados} falhas=${falhasGravacao}` : ' · EM SECO, nada gravado'}`);
// Tudo "erro" = a API não respondeu daqui (bloqueio): isso tem que sair ≠ 0, não verde.
if ((dist.erro || 0) === alvos.length) { console.error('[apurar-superbid] TODAS as consultas falharam — API inacessível deste IP'); process.exit(3); }
if (falhasGravacao) process.exit(4);
