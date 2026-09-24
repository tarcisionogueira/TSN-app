/**
 * FONTES QUE O RUNNER RESIDENCIAL COBRE (24/09, regra do dono) — uma lista só, usada pelo script
 * do runner (scripts/apurar-e-datar-residencial.mjs) e pelos crons da Vercel.
 *
 * "Caso não rode no residencial durante sete dias, deve rodar via Bright Data utilizando as cotas."
 * O runner grava um carimbo em `sistema_heartbeat` SÓ quando leu páginas de verdade. Enquanto o
 * carimbo tem menos de 7 dias, os crons PULAM estas fontes (a subcota diária `geral` do Bright
 * Data — 25/dia — sobra para o resto). Sem carimbo há 7+ dias, ou carimbo ilegível, os crons
 * voltam a cobri-las: na dúvida, cobrir (falhar ABERTO para a reserva, nunca deixar a fonte órfã).
 */
// KRONLEILOES saiu em 24/09: é Superbid white-label (página montada no navegador) — apurada pela
// offer-query em scripts/apurar-superbid-residencial.mjs, como SUPERBID/SOLD.
export const FONTES_APURACAO_RESIDENCIAL = ['ZUK', 'VIP', 'JELEILOES'];
export const FONTES_DATAS_RESIDENCIAL = ['BIASI', 'LJUD', 'GRUPOLANCE'];
export const HB_APURACAO = 'runner_residencial_apuracao';
export const HB_DATAS = 'runner_residencial_datas';
const RESERVA_DIAS = 7;

/**
 * @param {(path: string) => Promise<Response>} sb  fetch do PostgREST com a service key
 * @returns {Promise<string[]>} fontes a EXCLUIR do cron (vazio = cron cobre todas)
 */
export async function fontesCobertasPeloResidencial(sb, chave, fontes) {
  try {
    const r = await sb(`sistema_heartbeat?chave=eq.${encodeURIComponent(chave)}&select=ultimo_em`);
    if (!r.ok) { console.warn(`[residencial] heartbeat ${chave} ilegível (HTTP ${r.status}) — cron cobre as fontes`); return []; }
    const [hb] = await r.json();
    const fresco = hb?.ultimo_em && Date.now() - Date.parse(hb.ultimo_em) < RESERVA_DIAS * 86400000;
    return fresco ? fontes : [];
  } catch (e) {
    console.warn(`[residencial] heartbeat ${chave} falhou (${e?.message || e}) — cron cobre as fontes`);
    return [];
  }
}
