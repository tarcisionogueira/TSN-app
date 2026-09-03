/**
 * /api/limpar-eventos-cron — retenção do clickstream. Apaga eventos_atividade com mais de
 * 30 dias (economia — a tabela é de alto volume). Roda 1x/dia. Autorizado por CRON_SECRET.
 *
 * 21/08: a versão anterior fazia UM DELETE sem faixa e devolvia ok:true SEM checar `.ok` — a
 * "falha que não sabe que falhou". Num backlog (cron parado alguns dias), o DELETE único de
 * milhões de linhas estoura o timeout, a resposta de erro NÃO era lida, o cron dizia sucesso e
 * a tabela só crescia — cada rodada mais lenta que a anterior, sem nunca recuperar. Agora:
 * apaga em FATIAS por dia (do mais antigo até o corte), checa `.ok` a cada fatia, respeita um
 * orçamento de tempo e reporta quantas linhas saíram + se terminou.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const RETENCAO_DIAS = 30;
const DIA_MS = 86400000;

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SB || !KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  const corte = new Date(Date.now() - RETENCAO_DIAS * DIA_MS);
  const deadline = Date.now() + 50000; // folga dentro do maxDuration 60
  let apagados = 0, fatias = 0;
  try {
    // Mais antigo, para fatiar do começo. `.ok` ANTES do corpo: um 401/5xx aqui não é "vazio".
    const oRes = await fetch(`${SB}/rest/v1/eventos_atividade?select=criado_em&order=criado_em.asc&limit=1`,
      { headers, signal: AbortSignal.timeout(15000) });
    if (!oRes.ok) throw new Error(`leitura do mais antigo: HTTP ${oRes.status}`);
    const oldest = await oRes.json().catch(() => []);
    if (!Array.isArray(oldest) || !oldest.length) {
      return new Response(JSON.stringify({ ok: true, apagados: 0, motivo: 'nada a apagar' }), { headers: { 'Content-Type': 'application/json' } });
    }
    let ini = new Date(oldest[0].criado_em);
    while (ini < corte && Date.now() < deadline) {
      const fim = new Date(Math.min(ini.getTime() + DIA_MS, corte.getTime()));
      const r = await fetch(
        `${SB}/rest/v1/eventos_atividade?criado_em=gte.${encodeURIComponent(ini.toISOString())}&criado_em=lt.${encodeURIComponent(fim.toISOString())}`,
        { method: 'DELETE', headers: { ...headers, Prefer: 'count=exact' }, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error(`DELETE fatia ${ini.toISOString()}: HTTP ${r.status}`);
      apagados += Number((r.headers.get('content-range') || '').split('/')[1]) || 0; // "0-N/TOTAL"
      fatias++;
      ini = fim;
    }
    const completo = ini >= corte;
    if (!completo) console.warn(`[limpar-eventos] parou no orçamento de tempo em ${ini.toISOString()} — continua amanhã (${apagados} apagados hoje)`);

    // ─── RETENÇÃO DO ACERVO DE INSTAGRAM (LGPD) ──────────────────────────────────────
    // Conteúdo de DM é dado pessoal de TERCEIRO, que nunca teve conta aqui. A spec
    // (docs/INSTAGRAM_AUTOMACAO.md §7.3) manda definir retenção ANTES de gravar, e este
    // é o lugar em que ela vira mecanismo: um cron que já roda 1×/dia, em vez de uma
    // promessa dependente de alguém lembrar.
    //
    // NÃO derruba a limpeza principal se falhar — são retenções independentes, e perder a
    // do clickstream por causa da do Instagram trocaria um problema por outro. Mas também
    // não some: vai no corpo da resposta, que é o que o health-check lê.
    let instagram = null;
    try {
      const rIg = await fetch(`${SB}/rest/v1/rpc/ig_limpar_antigas`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: '{}', signal: AbortSignal.timeout(15000),
      });
      if (!rIg.ok) throw new Error(`HTTP ${rIg.status}`);
      instagram = await rIg.json();
    } catch (e) {
      instagram = { erro: String(e?.message || e) };
      console.error('[limpar-eventos] retenção do Instagram falhou:', instagram.erro);
    }

    return new Response(JSON.stringify({ ok: true, apagados, fatias, completo, corte: corte.toISOString(), instagram }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, apagados }), { status: 500 });
  }
}
