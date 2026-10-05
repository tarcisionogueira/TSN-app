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
    const r = await sb(`sistema_heartbeat?chave=eq.${encodeURIComponent(chave)}&select=ultimo_em,detalhe`);
    if (!r.ok) { console.warn(`[residencial] heartbeat ${chave} ilegível (HTTP ${r.status}) — cron cobre as fontes`); return []; }
    const [hb] = await r.json();
    const fresco = hb?.ultimo_em && Date.now() - Date.parse(hb.ultimo_em) < RESERVA_DIAS * 86400000;
    if (!fresco) return [];
    // POR FONTE (05/10, #44): o carimbo valia para TODAS as fontes se o runner lesse QUALQUER
    // página — em 05/10 leu 10 de 93 (VIP em laço de redirect) e o cron pulou VIP mesmo assim: 536
    // lotes vencidos, 0 tentados. Agora o runner escreve `cobertas=ZUK,JELEILOES` (só as que ele
    // de fato abriu) e o cron cobre o resto. Carimbo no formato antigo (sem `cobertas=`) = todas.
    const m = String(hb.detalhe || '').match(/cobertas=([A-Z0-9_,]*)/);
    if (!m) return fontes;
    const cobertas = new Set(m[1].split(',').filter(Boolean));
    return fontes.filter((f) => cobertas.has(f));
  } catch (e) {
    console.warn(`[residencial] heartbeat ${chave} falhou (${e?.message || e}) — cron cobre as fontes`);
    return [];
  }
}
