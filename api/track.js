/**
 * /api/track — ingest de eventos de atividade do cliente (navegação, cliques, falhas de API).
 * Alimenta o Cliente 360 (diagnóstico de possíveis falhas). Só registra usuários IDENTIFICADOS
 * (user_id do token — o cliente não escolhe o user_id). Escrita só pelo servidor (service key).
 * Fire-and-forget: nunca quebra o cliente.
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

import { getUser, getUserRoleById } from './_auth.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
// api_vazio = ação-chave (relatório) que voltou SEM estimativa — o dono quer ver isso no 360
// (era enviado pelo apiCall.js mas caía fora da allowlist e sumia silenciosamente).
// submit/change = ações sem clique (ENTER em form, select/filtro/arquivo); api_falha_rede =
// fetch que nem chegou ao servidor; pdf_gerado/pdf_falha = ENTREGA do documento (choke point
// do pdfImprimir) — auditoria de cobertura do tracker de 30/07.
const TIPOS = new Set(['pageview', 'click', 'submit', 'change', 'api_erro', 'api_vazio', 'api_falha_rede', 'pdf_gerado', 'pdf_falha']);

// Defesa em profundidade: NUNCA persistir token/segredo no log de atividade, mesmo que um cliente
// antigo/adulterado mande (ex.: #access_token=... do fluxo implícito, ou um JWT eyJ...). Redige.
const RE_SEGREDO = /(access_token|refresh_token|provider_token|provider_refresh_token|id_token|[?&#]token=|[?&]code=|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i;
const redigir = (s) => { const v = String(s || ''); return RE_SEGREDO.test(v) ? '(redigido)' : v; };

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const b = req.body || {};
    const eventos = Array.isArray(b.eventos) ? b.eventos.slice(0, 30) : [];
    if (!eventos.length || !SB || !KEY) { res.status(204).end(); return; }

    let userId = null, role = null;
    try { const u = await getUser(req); userId = u?.id || null; if (userId) role = await getUserRoleById(userId); } catch { /* anônimo */ }
    if (!userId) { res.status(204).end(); return; } // só usuários logados

    // Hora da AÇÃO (ts do cliente), não da ingestão — exigência de auditoria (data+hora fiel).
    // Aceita só ts plausível (últimas 48h até +2min de clock skew); fora disso, now() do banco.
    const agora = Date.now();
    const tsValido = (t) => Number.isFinite(t) && t > agora - 48 * 3600 * 1000 && t < agora + 120000;
    const rows = eventos
      .filter((e) => e && TIPOS.has(e.tipo))
      .map((e) => ({
        user_id: userId, role: role || null, tipo: e.tipo,
        rota: (redigir(e.rota).slice(0, 200)) || null,
        alvo: (redigir(e.alvo).slice(0, 200)) || null,
        detalhe: (redigir(e.detalhe).slice(0, 300)) || null,
        ...(tsValido(Number(e.ts)) ? { criado_em: new Date(Number(e.ts)).toISOString() } : {}),
      }));
    if (rows.length) {
      await fetch(`${SB}/rest/v1/eventos_atividade`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(rows), signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  } catch { /* nunca falha o cliente por causa do track */ }
  res.status(204).end();
}
