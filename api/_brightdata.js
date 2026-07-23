/**
 * Adapter Bright Data (Web Unlocker) — camada de fetch que desbloqueia fontes que
 * barram o IP do servidor (ex.: Caixa bloqueia a Vercel). É opcional e seguro:
 *  - Sem BRIGHTDATA_API_TOKEN/ZONE configurados → retorna null (chamador cai no fetch comum).
 *  - Respeita uma TRAVA DE TETO semanal (registrar_uso_brightdata) → nunca estoura custo.
 *
 * Uso típico (fallback): tenta fetch direto; se falhar e a fonte costuma bloquear,
 * chama fetchViaBrightData(url) como segunda tentativa.
 *
 * Env vars (na Vercel): BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, BRIGHTDATA_MAX_REQ_SEMANA.
 */

const BD_TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const BD_ZONE  = process.env.BRIGHTDATA_ZONE;
const SB_URL   = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY;
const TETO     = parseInt(process.env.BRIGHTDATA_MAX_REQ_SEMANA || '450', 10);

// Sub-cotas SUAVES por propósito: impedem que UM consumidor devore sozinho o teto
// semanal e deixe os demais (datas/doc/geo) sem cota. A paginação profunda do LJUD
// é o caso que estoura o orçamento, então limitamos 'ljud' a ~180/semana; os outros
// propósitos seguem dividindo o restante até o teto global. O teto global (RPC no
// banco) continua sendo o fail-safe DURO de custo — isto é só um repartidor.
const SUBCOTAS = {
  ljud: parseInt(process.env.BRIGHTDATA_MAX_LJUD_SEMANA || '180', 10),
  // Captura de documentos (caminho 3 do captura-documentos.mjs): teto semanal próprio
  // p/ desbloquear leiloeiros anti-bot (ex.: PECINI) sem devorar o orçamento dos
  // demais propósitos (datas/geo/scrapers). O teto global (RPC) segue como trava dura.
  docs: parseInt(process.env.BRIGHTDATA_MAX_DOCS_SEMANA || '150', 10),
  // Scraper RJ Leilões (100% Cloudflare → só via Web Unlocker): sub-cota própria p/
  // o RJ não monopolizar o teto semanal compartilhado.
  rj: parseInt(process.env.BRIGHTDATA_MAX_RJ_SEMANA || '120', 10),
  // Radar de Editais (DJEN/Comunica): o WAF do CNJ bloqueia o IP de datacenter da
  // Vercel (403). Sub-cota pequena — o auto-ajuste do radar já faz só 1 pull OK/dia
  // (~6-18 req), então ~120/semana sobra e não devora o orçamento dos demais.
  radar: parseInt(process.env.BRIGHTDATA_MAX_RADAR_SEMANA || '250', 10),
  // Cluster SOLEON multi-tenant (calil/vegas/3torres...): só o 3torres está atrás de
  // Cloudflare — o scraper tenta fetch GRÁTIS primeiro e só cai no Web Unlocker quando
  // barrado, então o gasto real fica bem abaixo desta sub-cota.
  soleon: parseInt(process.env.BRIGHTDATA_MAX_SOLEON_SEMANA || '150', 10),
  // Cluster "Gestão de Leilões" PHP (extrajust/lancetotal/lancenoleilao/granado): backend
  // ÚNICO (mesmo idLeilao nos 4 domínios) atrás de Cloudflare → 1 fonte, Web Unlocker.
  gestao: parseInt(process.env.BRIGHTDATA_MAX_GESTAO_SEMANA || '150', 10),
};
// Contagem por propósito na semana corrente, mantida na memória do processo. A
// paginação profunda (o caso que estoura a cota) roda numa única invocação, então
// este contador a barra DENTRO da run; entre invocações ele reinicia (limite suave,
// por isso o teto global no banco continua sendo a trava real). 'geral' não tem
// sub-cota → comportamento idêntico ao de antes (compatível para trás).
const usoPorProposito = new Map();
let _baldeSemana = null;
function contarProposito(proposito) {
  const balde = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)); // balde semanal
  if (balde !== _baldeSemana) { usoPorProposito.clear(); _baldeSemana = balde; } // virou a semana → zera
  return usoPorProposito.get(proposito) || 0;
}
function registrarProposito(proposito) {
  usoPorProposito.set(proposito, contarProposito(proposito) + 1);
}

/** Bright Data está configurado nesta instância? */
export function brightDataDisponivel() {
  return !!(BD_TOKEN && BD_ZONE);
}

/** Incrementa o consumo semanal e diz se ainda está sob o teto (atômico no banco). */
async function consumirCota(proposito = 'geral') {
  if (!SB_URL || !SB_KEY) return false;
  // Sub-cota suave: se este propósito já bateu seu limite semanal (contagem por
  // processo), recusa ANTES de gastar a cota global — assim sobra orçamento p/ os
  // demais. Propósitos sem sub-cota (ex.: 'geral') não são afetados.
  const sub = SUBCOTAS[proposito];
  if (sub != null && contarProposito(proposito) >= sub) return false;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/registrar_uso_brightdata`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_teto: TETO }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    const permitido = j?.permitido === true;
    // Só contabiliza no propósito o que efetivamente passou no teto global.
    if (permitido && sub != null) registrarProposito(proposito);
    return permitido;
  } catch {
    return false;
  }
}

/**
 * Busca uma URL via Bright Data Web Unlocker. Retorna um objeto Response (fetch)
 * com o corpo bruto da fonte, ou null se: BD não configurado, teto atingido, ou erro.
 * O chamador usa resp.ok / resp.arrayBuffer() / resp.text() normalmente.
 */
export async function fetchViaBrightData(url, { method = 'GET', headers = null, proposito = 'geral', timeoutMs = 45000 } = {}) {
  if (!brightDataDisponivel()) return null;
  const liberado = await consumirCota(proposito);
  if (!liberado) return null; // teto semanal atingido → não chama (fail-safe de custo)
  try {
    // headers: a Web Unlocker API (/request) valida `headers` como OBJETO
    // { "Accept": "...", "Origin": "..." } — passar array [{name,value}] devolve
    // HTTP 400 "headers must be of type object". Repassa o objeto como veio.
    const temHeaders = headers && typeof headers === 'object' && Object.keys(headers).length > 0;
    const resp = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${BD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: BD_ZONE, url, method, format: 'raw', ...(temHeaders ? { headers } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return resp;
  } catch {
    return null;
  }
}
