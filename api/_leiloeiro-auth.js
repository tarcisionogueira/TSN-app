/**
 * Fallback de LOGIN ON-DEMAND unificado por leiloeiro.
 *
 * Objetivo (pedido do dono): se o scraper NÃO conseguiu o documento, o sistema loga
 * com e-mail/senha do leiloeiro e puxa o doc na hora — para QUALQUER fonte. Cada
 * leiloeiro tem um "adaptador" de login próprio (o login/estrutura muda por site).
 * Aqui fica o REGISTRO desses adaptadores; a análise (gerar-documental) chama
 * `capturarDocsLoginOnDemand(fonte, loteUrl, deadline)` e recebe uma forma uniforme:
 *   { matricula, edital, laudo, regras, anexos:[{url,nome,tipo}] } | null
 *
 * Credenciais: <FONTE>_EMAIL / <FONTE>_SENHA no Vercel (exceção histórica: Grupo Lance
 * usa GL_*; Zuk usa ZUK_*). Tudo é fetch (sem navegador) para rodar no serverless.
 *
 * Status dos adaptadores:
 *   - ZUK .......... ✅ funcional (login Laravel)
 *   - GRUPOLANCE ... ✅ funcional (login Yii)
 *   - SODRE ........ ⏳ molde pendente (SPA + API JSON) — encaixe pronto
 *   - FRAZAO ....... ⏳ molde pendente (login não localizado) — encaixe pronto
 *   - MEGA/BIASI ... docs públicos (não precisa login; o scraper/backfill cobre)
 */
import { capturarDocsZukLogado } from './_zuk-auth.js';
import { loginGrupoLance, sessaoAnonima, coletarDocsGrupoLance, resolverDocUrl } from './_grupolance-auth.js';

// ── Adaptador Grupo Lance (on-demand, um lote) ───────────────────────────────
// Loga, lê a página anônima (logado o GL esconde os .doc-link) e resolve as URLs
// gated (matrícula/laudo/análise) para o CDN. Não grava nada.
async function grupoLanceOnDemand(loteUrl, deadline) {
  if (!loteUrl || !/grupolance\.com\.br/i.test(loteUrl)) return null;
  if (deadline && Date.now() > deadline - 12000) return null;
  const jar = await loginGrupoLance();
  if (!jar) return null;
  const anon = await sessaoAnonima();
  const docs = await coletarDocsGrupoLance(loteUrl, anon);
  const out = { matricula: null, edital: null, laudo: null, regras: null, anexos: [] };
  for (const d of docs) {
    let url = d.url;
    if (d.gated) { url = await resolverDocUrl(d.url, jar, loteUrl); if (!url) continue; }
    if (d.tipo === 'matricula' && !out.matricula) out.matricula = url;
    else if (d.tipo === 'laudo' && !out.laudo) out.laudo = url;
    else if (d.tipo === 'edital' && !out.edital) out.edital = url;
    else if (d.tipo === 'regras' && !out.regras) out.regras = url;
    out.anexos.push({ url, nome: d.rotulo || d.tipo, tipo: d.tipo });
  }
  return out.anexos.length ? out : null;
}

// ── Adaptador Zuk (reusa o helper existente; já devolve matricula/laudo/anexos) ──
async function zukOnDemand(loteUrl, deadline) {
  const zk = await capturarDocsZukLogado(loteUrl, deadline);
  if (!zk) return null;
  return { matricula: zk.matricula || null, edital: null, laudo: zk.laudo || null, regras: null, anexos: zk.anexos || [] };
}

// ── Registro fonte → adaptador. Novos leiloeiros: some aqui quando o molde existir. ──
function adaptadorDe(fonte) {
  const f = String(fonte || '').toLowerCase();
  if (/zuk|zukerman/.test(f)) return zukOnDemand;
  if (/grupolance|grupo.?lance/.test(f)) return grupoLanceOnDemand;
  // ⏳ pendentes (encaixe pronto — plugar quando o molde for construído):
  // if (/sodr[eé]/.test(f)) return sodreOnDemand;      // SPA + API prd-api.sodresantoro
  // if (/fraz[aã]o/.test(f)) return frazaoOnDemand;    // login Bricks/WordPress
  return null;
}

/**
 * Tenta capturar os documentos de UM lote via login do leiloeiro (fallback on-demand).
 * @returns {Promise<null | {matricula, edital, laudo, regras, anexos}>}
 */
export async function capturarDocsLoginOnDemand(fonte, loteUrl, deadline) {
  const adapter = adaptadorDe(fonte);
  if (!adapter || !loteUrl) return null;
  try { return await adapter(loteUrl, deadline); }
  catch (e) { console.warn(`[leiloeiro-auth] ${fonte} on-demand erro: ${e?.message}`); return null; }
}

// Diz se existe via de login para a fonte (para logs/diagnóstico).
export function temLoginParaFonte(fonte) { return !!adaptadorDe(fonte); }
