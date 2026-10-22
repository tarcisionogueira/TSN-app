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
 *
 * FREIO PELO SALDO DA CONTA (22/10, dono: "não ultrapassar os créditos gratuitos; o que depende
 * deles volta sozinho quando renovar"). Plano grátis = 1.000 créditos/mês, renovados no período
 * (firecrawl.dev/pricing, conferido em 22/10). O teto por execução não olhava a conta: 4 passos
 * semanais somavam até ~950/mês, e o que a sessão do Claude gasta pelo conector sai do mesmo saldo.
 * Antes da 1ª página, lê `GET /v2/team/credit-usage` e limita esta execução a
 *   (restante − FIRECRAWL_RESERVA) ÷ semanas até a renovação ÷ FIRECRAWL_PASSOS
 * — o mês não se esgota na 1ª semana. Saldo ilegível = NÃO gasta (falha fechada, mesma regra do
 * Bright Data). Renovou o período → o saldo volta e a coleta volta sozinha, sem ninguém mexer.
 * O consumo vai para `uso_integracoes` (provedor `firecrawl`, painel "Custos & Uso").
 */
const API = 'https://api.firecrawl.dev/v2/scrape';
const API_SALDO = 'https://api.firecrawl.dev/v2/team/credit-usage';
const SEMANA = 7 * 864e5;

/** Quantas páginas esta execução pode usar, dado o saldo. Puro (testável). */
export function orcamentoFirecrawl({ restante, fimPeriodo, teto, reserva, passos, agora = Date.now() }) {
  if (!Number.isFinite(restante)) return 0;
  const fim = Date.parse(fimPeriodo || '');
  // Sem data de renovação: supõe 4 semanas — o lado conservador.
  const semanas = Number.isFinite(fim) && fim > agora ? Math.max(1, Math.ceil((fim - agora) / SEMANA)) : 4;
  return Math.max(0, Math.min(teto, Math.floor((restante - reserva) / semanas / Math.max(1, passos))));
}

async function lerSaldo(chave) {
  try {
    const r = await fetch(API_SALDO, { headers: { Authorization: `Bearer ${chave}` }, signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => null);
    const d = j?.data || {};
    const restante = Number(d.remainingCredits ?? d.remaining_credits);
    if (!r.ok || !j?.success || !Number.isFinite(restante)) return { erro: `saldo ilegível (HTTP ${r.status})` };
    return { restante, plano: Number(d.planCredits ?? d.plan_credits) || null, fimPeriodo: d.billingPeriodEnd ?? d.billing_period_end ?? null };
  } catch (e) { return { erro: `saldo ilegível (${String(e?.message || e).slice(0, 60)})` }; }
}

async function registrarConsumo(paginas, creditos) {
  const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB || !KEY || !paginas) return;
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/registrar_uso`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_provedor: 'firecrawl', p_operacao: 'scrape', p_requests: paginas, p_unidades: creditos }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.warn(`  [firecrawl] consumo não registrado em uso_integracoes: HTTP ${r.status}`);
  } catch (e) { console.warn(`  [firecrawl] consumo não registrado: ${e?.message || e}`); }
}

export function criarMotorFirecrawl({ timeoutMs = 60000, waitFor = 0 } = {}) {
  const chave = (process.env.FIRECRAWL_API_KEY || '').trim();
  const tetoExec = Math.max(1, Number(process.env.FIRECRAWL_MAX_PAGINAS) || 60);
  const reserva = Math.max(0, Number(process.env.FIRECRAWL_RESERVA ?? 100)); // sobra p/ diagnóstico da sessão
  const passos = Math.max(1, Number(process.env.FIRECRAWL_PASSOS) || 4);     // passos do workflow semanal
  const estado = { paginas: 0, creditos: 0, falhas: 0, teto: tetoExec, semCota: false, saldo: null };
  let teto = tetoExec;
  let orcado = null; // promessa: o saldo é lido UMA vez por execução

  async function orcar() {
    const sd = await lerSaldo(chave);
    estado.saldo = sd;
    if (sd.erro) { teto = 0; console.warn(`  [firecrawl] ${sd.erro} — não gasto sem saber o saldo (volta na próxima execução)`); return; }
    teto = orcamentoFirecrawl({ restante: sd.restante, fimPeriodo: sd.fimPeriodo, teto: tetoExec, reserva, passos });
    console.log(`  [firecrawl] saldo ${sd.restante}${sd.plano ? `/${sd.plano}` : ''} créditos · renova ${sd.fimPeriodo || '?'} · esta execução pode usar ${teto} (reserva ${reserva}, ${passos} passos)`);
  }

  async function fetchFonte(url) {
    if (!chave) return { html: null, via: 'firecrawl-sem-chave', definitivo: true };
    await (orcado ||= orcar());
    if (estado.paginas >= teto) {
      console.warn(`  [firecrawl] orçamento de ${teto} páginas nesta execução — ${url} não buscada (créditos grátis, não falha da fonte; volta quando o saldo renovar)`);
      estado.semCota = true; // o runner grava 'sem_cota' (orçamento), não regressão da fonte
      return { html: null, via: 'firecrawl-teto', definitivo: true, semCota: true };
    }
    estado.paginas++;
    try {
      const r = await fetch(API, {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
        // waitFor: página montada por JS (MGL/trimpath) só tem os valores depois de rodar o script.
        // XML (feed /sitemap.xml da Degrau) não tem script para esperar: com waitFor o Firecrawl deu 408 na
        // VIVA (15/10); sem ele, 200 em segundos.
        body: JSON.stringify({ url, formats: ['rawHtml'], maxAge: 0, timeout: timeoutMs, ...(waitFor > 0 && !/\.xml(\?|$)/i.test(url) ? { waitFor } : {}) }),
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
    await registrarConsumo(estado.paginas, estado.creditos);
  }

  return { fetchFonte, estado, fechar };
}
