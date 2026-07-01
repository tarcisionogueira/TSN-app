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
const TETO     = parseInt(process.env.BRIGHTDATA_MAX_REQ_SEMANA || '300', 10);

/** Bright Data está configurado nesta instância? */
export function brightDataDisponivel() {
  return !!(BD_TOKEN && BD_ZONE);
}

/** Incrementa o consumo semanal e diz se ainda está sob o teto (atômico no banco). */
async function consumirCota() {
  if (!SB_URL || !SB_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/registrar_uso_brightdata`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_teto: TETO }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return false;
    const j = await r.json().catch(() => null);
    return j?.permitido === true;
  } catch {
    return false;
  }
}

/**
 * Busca uma URL via Bright Data Web Unlocker. Retorna um objeto Response (fetch)
 * com o corpo bruto da fonte, ou null se: BD não configurado, teto atingido, ou erro.
 * O chamador usa resp.ok / resp.arrayBuffer() / resp.text() normalmente.
 */
export async function fetchViaBrightData(url, { method = 'GET', headers = null } = {}) {
  if (!brightDataDisponivel()) return null;
  const liberado = await consumirCota();
  if (!liberado) return null; // teto semanal atingido → não chama (fail-safe de custo)
  try {
    // headers: array [{name,value}] p/ a Web Unlocker (ex.: Origin/Referer de XHR,
    // necessários em APIs que só respondem a chamadas com fingerprint de navegador).
    const bdHeaders = headers
      ? Object.entries(headers).map(([name, value]) => ({ name, value }))
      : undefined;
    const resp = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${BD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: BD_ZONE, url, method, format: 'raw', ...(bdHeaders ? { headers: bdHeaders } : {}) }),
      signal: AbortSignal.timeout(45000),
    });
    return resp;
  } catch {
    return null;
  }
}
