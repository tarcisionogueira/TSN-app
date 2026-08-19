/**
 * Adapter Bright Data (Web Unlocker) — camada de fetch que desbloqueia fontes que
 * barram o IP do servidor (ex.: Caixa bloqueia a Vercel). É opcional e seguro:
 *  - Sem BRIGHTDATA_API_TOKEN/ZONE configurados → retorna null (chamador cai no fetch comum).
 *  - Respeita uma TRAVA DE TETO semanal (registrar_uso_brightdata) → nunca estoura custo.
 *
 * Uso típico (fallback): tenta fetch direto; se falhar e a fonte costuma bloquear,
 * chama fetchViaBrightData(url) como segunda tentativa.
 *
 * ─── DUAS CORREÇÕES DE 11/08, as duas medidas ──────────────────────────────────
 * (1) AS SUB-COTAS NÃO EXISTIAM. Elas eram contadas num Map em MEMÓRIA DO PROCESSO;
 *     cada run do Actions e cada invocação da Vercel começava do zero. Resultado: não
 *     limitavam ninguém e — o que doeu — não RESERVAVAM nada. O teto global de 450/semana
 *     ficou saturado 4 semanas seguidas (20/07 a 10/08; a última bateu 450 na segunda às
 *     13h) e o scraper RJ, que precisa de ~13 requests e não tem via grátis (o site é 100%
 *     Cloudflare), nunca achou um crédito livre. Agora a contagem por propósito e a
 *     RESERVA vivem no banco (migração brightdata_reserva_por_proposito.sql).
 *
 * (2) `null` DIZIA QUATRO COISAS DIFERENTES: não configurado · teto atingido · sub-cota
 *     · erro de rede. O chamador não conseguia distinguir "acabou a cota" de "a fonte não
 *     tem nada" — e o scraper RJ lia isso como "fim das páginas", saía com exit 0 e o
 *     workflow ficava VERDE sem ter coletado nada. É a forma #4 do CLAUDE.md ("null como
 *     acabou"). Agora existe `buscarViaBrightData`, que LANÇA com o motivo; o
 *     `fetchViaBrightData` (null) segue para os chamadores antigos, mas não é o caminho
 *     recomendado para coleta nova.
 *
 * Env vars (na Vercel): BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, BRIGHTDATA_MAX_REQ_SEMANA.
 */

const BD_TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const BD_ZONE  = process.env.BRIGHTDATA_ZONE;
const SB_URL   = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY;
// TETO: hoje isto e apenas o ULTIMO RECURSO. Desde 18/08 o teto efetivo vem da
// CONFIGURACAO no banco (`brightdata_uso.teto`), e `registrar_uso_brightdata` ignora este
// numero quando ha teto configurado. Por que mudou: este default era 450 e os disparos
// manuais mandavam 520 — o numero que o dono escolheu. Com 488 usados, quem perguntava
// com 450 batia em limite 424 e era RECUSADO; quem perguntava com 520 batia em 494 e
// passava. Mesmo instante, mesma fonte, respostas opostas — e CALIL, VEGAS e
// GESTAOLEILOES ficaram de 14 a 18/08 sem coleta da manha com o acervo INTACTO.
// Para mudar o teto: escreva em `brightdata_uso.teto`. Mexer nesta env NAO muda o freio.
const TETO     = parseInt(process.env.BRIGHTDATA_MAX_REQ_SEMANA || '450', 10);

/** Erro tipado: quem chama consegue diferenciar "sem cota" de "a fonte respondeu errado". */
export class ErroBrightData extends Error {
  constructor(motivo, detalhe) {
    super(`brightdata:${motivo}${detalhe ? ` — ${detalhe}` : ''}`);
    this.name = 'ErroBrightData';
    this.motivo = motivo;   // sem_config | teto_global | subcota | reservado_para_outros | cota_indisponivel | rede | http
    this.detalhe = detalhe || null;
    // Só o teto/sub-cota é "o sistema decidiu não gastar"; o resto é falha de verdade.
    // `subcota_dia` (18/08): rateio diario da sub-cota — recusa de ORCAMENTO igual as outras.
    // Sem ele aqui, o rateio chegaria como falha da fonte: a forma #5 de novo.
    this.semCota = ['teto_global', 'subcota', 'subcota_dia', 'reservado_para_outros', 'cota_indisponivel'].includes(motivo);
  }
}

/** Bright Data está configurado nesta instância? */
export function brightDataDisponivel() {
  return !!(BD_TOKEN && BD_ZONE);
}

/**
 * Incrementa o consumo semanal e diz se ainda está sob o teto (atômico no banco).
 * Retorna { permitido, motivo, ... } — o motivo vem da RPC, que já conhece reserva e sub-cota.
 */
async function consumirCota(proposito = 'geral') {
  if (!SB_URL || !SB_KEY) return { permitido: false, motivo: 'cota_indisponivel', detalhe: 'sem credencial do Supabase' };
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/registrar_uso_brightdata`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_teto: TETO, p_proposito: proposito }),
      signal: AbortSignal.timeout(8000),
    });
    // `.ok` checado ANTES do corpo: um 4xx/5xx aqui não é "teto atingido", é contador
    // indisponível — e tratar os dois como a mesma coisa foi o que escondeu 4 semanas
    // de saturação atrás de um check verde.
    if (!r.ok) return { permitido: false, motivo: 'cota_indisponivel', detalhe: `RPC HTTP ${r.status}` };
    const j = await r.json().catch(() => null);
    if (!j || typeof j !== 'object') return { permitido: false, motivo: 'cota_indisponivel', detalhe: 'RPC sem corpo' };
    return { permitido: j.permitido === true, motivo: j.motivo || (j.permitido ? 'ok' : 'teto_global'), ...j };
  } catch (e) {
    return { permitido: false, motivo: 'cota_indisponivel', detalhe: String(e?.message || e).slice(0, 120) };
  }
}

/**
 * Registra o DESFECHO da chamada. O contador de cota incrementa ANTES do fetch (tem de ser
 * assim: é uma reserva atômica), então ele mede PERMISSÃO CONCEDIDA, não gasto. Quando a
 * chamada nem chega ao fornecedor, não houve gasto — e segurar o crédito penaliza a coleta
 * por um erro de rede nosso. Foi o que abriu a distância entre o nosso ledger (~2.549 desde
 * 29/06) e os ~780 créditos que o painel do Bright Data mostra consumidos. (11/08)
 */
async function registrarResultado(proposito, ok, devolver) {
  if (!SB_URL || !SB_KEY) return;
  try {
    await fetch(`${SB_URL}/rest/v1/rpc/registrar_resultado_brightdata`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_proposito: proposito, p_ok: ok, p_devolver: devolver }),
      signal: AbortSignal.timeout(5000),
    });
  } catch { /* contabilidade é best-effort: não pode derrubar a coleta */ }
}

/** Chamada crua ao Web Unlocker, já com a cota consumida. Lança ErroBrightData. */
async function chamarUnlocker(url, { method, headers, timeoutMs, proposito }) {
  try {
    // headers: a Web Unlocker API (/request) valida `headers` como OBJETO
    // { "Accept": "...", "Origin": "..." } — passar array [{name,value}] devolve
    // HTTP 400 "headers must be of type object". Repassa o objeto como veio.
    const temHeaders = headers && typeof headers === 'object' && Object.keys(headers).length > 0;
    const r = await fetch('https://api.brightdata.com/request', {
      method: 'POST',
      headers: { Authorization: `Bearer ${BD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: BD_ZONE, url, method, format: 'raw', ...(temHeaders ? { headers } : {}) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Chegou ao fornecedor (mesmo com status de erro) → foi consumido, não devolve.
    await registrarResultado(proposito, true, false);
    return r;
  } catch (e) {
    // Não chegou lá: devolve o crédito ao teto.
    await registrarResultado(proposito, false, true);
    throw new ErroBrightData('rede', String(e?.message || e).slice(0, 160));
  }
}

/**
 * CAMINHO RECOMENDADO para coleta nova: devolve o Response ou **LANÇA** ErroBrightData.
 * Nunca devolve algo que possa ser confundido com "a fonte não tem conteúdo".
 * Use `e.semCota` para separar "o freio de custo agiu" de "a coleta falhou".
 */
export async function buscarViaBrightData(url, { method = 'GET', headers = null, proposito = 'geral', timeoutMs = 45000, exigirOk = true } = {}) {
  if (!brightDataDisponivel()) throw new ErroBrightData('sem_config', 'BRIGHTDATA_API_TOKEN/ZONE ausentes');
  const cota = await consumirCota(proposito);
  if (!cota.permitido) {
    throw new ErroBrightData(cota.motivo, cota.detalhe
      || `propósito ${proposito}: ${cota.usado ?? '?'} usados · total ${cota.usado_total ?? '?'}/${cota.teto ?? TETO}`);
  }
  const resp = await chamarUnlocker(url, { method, headers, timeoutMs, proposito });
  if (exigirOk && !resp.ok) throw new ErroBrightData('http', `HTTP ${resp.status} em ${url}`);
  return resp;
}

/**
 * Busca uma URL via Bright Data Web Unlocker. Retorna um objeto Response (fetch)
 * com o corpo bruto da fonte, ou null se: BD não configurado, teto atingido, ou erro.
 * O chamador usa resp.ok / resp.arrayBuffer() / resp.text() normalmente.
 *
 * COMPATIBILIDADE: mantido para os chamadores que já tratam `null` como "não deu, siga
 * pelo caminho grátis" (fallback legítimo). Para COLETA — onde `null` vira dado faltando
 * sem ninguém perceber — use `buscarViaBrightData`.
 */
export async function fetchViaBrightData(url, opts = {}) {
  try {
    return await buscarViaBrightData(url, { ...opts, exigirOk: false });
  } catch (e) {
    if (!(e instanceof ErroBrightData)) throw e;
    return null;
  }
}
