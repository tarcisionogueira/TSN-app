/**
 * MOTOR DE FETCH — FIRECRAWL (10/10). Mesmo contrato do fetch-dom: `fetchFonte(url) → { html, via }`.
 *
 * Por que existe: sites atrás de Cloudflare que dão 403 ao runner do GitHub E ao proxy ISP do
 * Bright Data (LEJE desde 24/09 — ver fontes/leje.mjs). Medido em 10/10 pelo conector Firecrawl:
 * home e detalhe do LEJE com HTTP 200, proxy "basic", 1 crédito por página, e o parser existente
 * (lib/leje-parse.mjs) extraiu título, cidade, avaliação, lance e matrícula do HTML devolvido.
 *
 * Freio de custo (forma nº 5 do CLAUDE.md): teto de páginas POR EXECUÇÃO (FIRECRAWL_MAX_PAGINAS,
 * padrão 60). Estourado, devolve `via: 'firecrawl-teto'` — o "não" do orçamento tem nome próprio
 * e não se confunde com "a fonte não tem nada". Sem FIRECRAWL_API_KEY: `via: 'firecrawl-sem-chave'`,
 * que o runner registra como falha (não consegui buscar), nunca como fonte vazia.
 */
const API = 'https://api.firecrawl.dev/v2/scrape';

export function criarMotorFirecrawl({ timeoutMs = 60000 } = {}) {
  const chave = (process.env.FIRECRAWL_API_KEY || '').trim();
  const teto = Math.max(1, Number(process.env.FIRECRAWL_MAX_PAGINAS) || 60);
  const estado = { paginas: 0, creditos: 0, falhas: 0, teto, semCota: false };

  async function fetchFonte(url) {
    if (!chave) return { html: null, via: 'firecrawl-sem-chave', definitivo: true };
    if (estado.paginas >= teto) {
      console.warn(`  [firecrawl] teto de ${teto} páginas nesta execução — ${url} não buscada (decisão de orçamento, não falha da fonte)`);
      estado.semCota = true; // o runner grava 'sem_cota' (orçamento), não regressão da fonte
      return { html: null, via: 'firecrawl-teto', definitivo: true, semCota: true };
    }
    estado.paginas++;
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['rawHtml'], maxAge: 0, timeout: timeoutMs }),
        signal: AbortSignal.timeout(timeoutMs + 15000),
      });
      const j = await r.json().catch(() => null);
      // O Firecrawl pode responder 200 com `success: false` — o erro mora no corpo (forma nº 1).
      if (!r.ok || !j?.success) {
        estado.falhas++;
        console.warn(`  [firecrawl] ${url}: HTTP ${r.status} ${String(j?.error || '').slice(0, 120)}`);
        return { html: null, via: `firecrawl-${r.status}` };
      }
      const meta = j.data?.metadata || {};
      estado.creditos += Number(meta.creditsUsed) || 1;
      // Status da PÁGINA (não da API): 403/404 do site alvo chegam aqui com a API em 200.
      const st = Number(meta.statusCode) || 0;
      if (st >= 400) return { html: null, via: `firecrawl-pagina-${st}`, definitivo: st === 404 };
      return { html: j.data?.rawHtml || null, via: 'firecrawl' };
    } catch (e) {
      estado.falhas++;
      console.warn(`  [firecrawl] ${url}: ${String(e?.message || e).slice(0, 120)}`);
      return { html: null, via: 'firecrawl-falha' };
    }
  }

  async function fechar() {
    console.log(`  [firecrawl] uso desta execução: ${estado.paginas} página(s), ${estado.creditos} crédito(s), ${estado.falhas} falha(s)`);
  }

  return { fetchFonte, estado, fechar };
}
