/**
 * MOTOR `sbidloja` (27/10) — transporte das lojas white-label Superbid Exchange (lib/sbidloja-parse.mjs). A API
 * offer-query responde JSON com Origin/Referer do superbid.net; se o runner levar recusa, a mesma consulta vai pelo
 * banco (`json_pedir`, que manda exatamente esse Origin). Nunca Bright Data, nunca Firecrawl.
 *
 * SEM DUPLICAR O PORTAL: toda oferta do catálogo que já está ATIVA no acervo como `sbid_<id>`/`sold_<id>` sai da lista
 * antes do parser (e entra em `_noPortal`, para a conta de completude). Se não der para CONFERIR (banco fora), a página
 * volta como falha — gravar sem conferir criaria a duplicata que esta regra existe para impedir.
 */
import { viaBanco } from './fetch-fonte.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
export const COBERTURA_SBIDLOJA = new Map();   // storeId → { total, noPortal, nossos }

async function buscarApi(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9', Origin: 'https://www.superbid.net', Referer: 'https://www.superbid.net/' }, signal: AbortSignal.timeout(30000) });
    const txt = await r.text();
    if (r.ok) return { txt, via: 'api' };
    const b = await viaBanco(url, { json: true });
    return b.html ? { txt: b.html, via: 'banco' } : { txt: null, via: `api HTTP ${r.status} · banco: ${b.motivo}` };
  } catch (e) {
    console.log(`   [sbidloja] API pelo runner falhou (${String(e?.cause?.code || e?.message || e).slice(0, 60)}) — tentando pelo banco`);
    const b = await viaBanco(url, { json: true });
    return b.html ? { txt: b.html, via: 'banco' } : { txt: null, via: `api rede: ${String(e?.cause?.code || e?.message || e).slice(0, 50)} · banco: ${b.motivo}` };
  }
}

// Quais destas ofertas o acervo JÁ tem ativas por outro coletor da rede Superbid — o portal (`sbid_`, `sold_`) ou os
// coletores por loja do scraper-puppeteer (`dilson_`, `kron_`, `jmf_`, `totall_`, `crep_`)? Set de ids, ou null se não
// conseguiu ler.
const PREFIXOS_REDE = ['sbid', 'sold', 'dilson', 'kron', 'jmf', 'totall', 'crep'];
export async function ofertasNoPortal(ids, { fetchFn = fetch } = {}) {
  if (!ids.length) return new Set();
  const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, SK = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !SK) return null;
  const fids = ids.flatMap((id) => PREFIXOS_REDE.map((p) => `${p}_${id}`)).join(',');
  try {
    const r = await fetchFn(`${SB}/rest/v1/imoveis_leilao?select=fonte_id&ativo=eq.true&fonte_id=in.(${fids})`, { headers: { apikey: SK, Authorization: `Bearer ${SK}` }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) { console.log(`   [sbidloja] conferência com o portal: HTTP ${r.status}`); return null; }
    return new Set((await r.json()).map((x) => String(x.fonte_id).replace(/^[a-z]+_/, '')));
  } catch (e) { console.log(`   [sbidloja] conferência com o portal falhou: ${String(e?.message || e).slice(0, 80)}`); return null; }
}

export function criarMotorSbidLoja() {
  const estado = { semCota: false };
  async function fetchFonte(url) {
    const u = new URL(url);
    if (!u.searchParams.has('pageNumber')) u.searchParams.set('pageNumber', '1');
    const storeId = (u.searchParams.get('filter') || '').match(/stores\.id:(\d+)/)?.[1] || null;
    const { txt, via } = await buscarApi(u.toString());
    if (!txt) return { html: null, via };
    let j; try { j = JSON.parse(txt); } catch { return { html: null, via: `${via}: resposta não é JSON` }; }
    if (!Array.isArray(j?.offers)) return { html: null, via: `${via}: JSON sem "offers"` };
    const ids = j.offers.map((o) => String(o?.id || '')).filter(Boolean);
    const noPortal = await ofertasNoPortal(ids);
    if (!noPortal) return { html: null, via: `${via}: não consegui conferir o que o portal já trouxe — não gravo sem conferir` };
    const ficam = j.offers.filter((o) => !noPortal.has(String(o?.id)));
    const ant = COBERTURA_SBIDLOJA.get(storeId) || { total: Number(j.total) || 0, noPortal: 0, nossos: 0 };
    ant.noPortal += j.offers.length - ficam.length; ant.nossos += ficam.length;
    COBERTURA_SBIDLOJA.set(storeId, ant);
    return { html: JSON.stringify({ total: j.total, _storeId: storeId, _noPortal: ant.noPortal, offers: ficam }), via };
  }
  return { fetchFonte, estado };
}

export function tabelaCoberturaSbidLoja(tenants) {
  const linhas = ['loja (storeId) | imóveis abertos que a API declara | já vêm pelo portal | nossos (fora do portal) | ok'];
  for (const t of tenants) {
    const c = COBERTURA_SBIDLOJA.get(t.storeId);
    linhas.push(c ? `${t.loja} (${t.storeId}) | ${c.total} | ${c.noPortal} | ${c.nossos} | ${c.noPortal + c.nossos >= 0.9 * c.total ? 'ok' : 'NÃO'}`
      : `${t.loja} (${t.storeId}) | — | — | — | NÃO LIDO`);
  }
  return linhas.join('\n');
}
