/**
 * MOTOR `api` (13/10) — fonte cujo catálogo é uma API JSON pública que exige CABEÇALHO próprio
 * (ex.: plataforma Ares/Supabase: `apikey: sb_publishable_…`, a chave que o próprio site manda do
 * navegador). Mesmo contrato do criarMotorFetch ({ html, via }), sem Bright Data: API JSON aberta
 * não tem Cloudflare na frente, e quando recusa (401 = chave trocada) o motivo vai NOMEADO no `via`
 * até a saúde da fonte — nunca vira "fonte sem lote" calado.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

export function criarMotorApi(cfg) {
  const estado = { semCota: false };
  const cabecalhos = new Map((cfg.tenants || []).map(t => [new URL(t.base).host, t.headers || {}]));
  // PAGINAÇÃO POSTGREST (22/10, Savoy: 2.391 lotes vivos). A consulta do catálogo pede `limit=1000` e o
  // PostgREST devolve no máximo isso — com `listaCompleta` o resto seria desligado como "sumiu". Com
  // `cfg.paginarPostgrest`, página cheia puxa a próxima (`offset`) e o texto devolvido é UM array só.
  // Página que falha no meio derruba a lista inteira (nunca entrega metade como se fosse tudo).
  async function fetchPaginado(url, opts) {
    const lim = Number(new URL(url).searchParams.get('limit')) || 0;
    const primeira = await fetchUma(url, opts);
    if (!cfg.paginarPostgrest || !lim || !primeira.html) return primeira;
    let todos; try { todos = JSON.parse(primeira.html); } catch { return primeira; }
    if (!Array.isArray(todos)) return primeira;
    for (let pag = 1, ult = todos.length; ult === lim && pag < 20; pag++) {
      const u = new URL(url); u.searchParams.set('offset', String(pag * lim));
      const r = await fetchUma(u.toString(), opts);
      if (!r.html) return { html: null, via: `${r.via} (página ${pag + 1} do catálogo)` };
      const arr = JSON.parse(r.html);
      todos.push(...arr); ult = arr.length;
    }
    return { html: JSON.stringify(todos), via: primeira.via };
  }
  async function fetchUma(url, { timeoutMs = 30000 } = {}) {
    let host = ''; try { host = new URL(url).host; } catch { return { html: null, via: 'url inválida' }; }
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, Accept: 'application/json', ...(cabecalhos.get(host) || {}) } });
      const txt = await r.text();
      if (!r.ok) return { html: null, via: `api HTTP ${r.status} ${txt.slice(0, 80)}` };
      return { html: txt, via: 'api' };
    } catch (e) {
      return { html: null, via: `api rede: ${String(e?.name === 'AbortError' ? `timeout ${timeoutMs / 1000}s` : e?.cause?.code || e?.message || e).slice(0, 60)}` };
    } finally { clearTimeout(t); }
  }
  return { fetchFonte: fetchPaginado, estado };
}
