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
    // FUNIL PÚBLICO (30/07): visitante SEM conta também conta — mas com regras mais duras:
    // exige anon_id, só ROTAS PÚBLICAS, menos tipos e lote menor (anti-abuso; RLS fechado e
    // retenção de 30d seguem valendo). Sem isto, quem clicava num link de venda e não
    // cadastrava era invisível — impossível distinguir "ninguém clicou" de "página quebrou".
    const anonId = typeof b.anon_id === 'string' ? (b.anon_id.replace(/[^\w-]/g, '').slice(0, 48) || null) : null;
    const TIPOS_ANON = new Set(['pageview', 'click', 'submit', 'api_erro', 'api_falha_rede']);
    // `leiloes` entrou em 12/08 e é a correção mais cara da lista: são as ~33 mil páginas de
    // acervo público (servidas por /api/publico, FORA do React), o principal ativo de aquisição
    // do site. Sem esta palavra, o evento chegava aqui e era descartado com 204 — silêncio dos
    // dois lados: o tracker não rodava lá E o servidor recusaria se rodasse. Medido antes da
    // correção: em 30 dias, visitante anônimo aparecia em CINCO rotas (/, /planos, /login,
    // /termos, /privacidade) e ZERO nas 33 mil. Não dava para distinguir "o SEO não traz
    // ninguém" de "não estamos medindo" — que são diagnósticos opostos.
    const ROTA_PUBLICA = /^\/($|p\/|leiloes|planos|login|cadastro|termos|privacidade|convite|cadastro-parceiro|contrato|testemunha|ativar|redefinir|recuperar|\(auth-redirect\))/;
    let lista = eventos;
    if (!userId) {
      if (!anonId) { res.status(204).end(); return; }
      lista = eventos.filter((e) => e && TIPOS_ANON.has(e.tipo) && ROTA_PUBLICA.test(String(e.rota || ''))).slice(0, 12);
      if (!lista.length) { res.status(204).end(); return; }
    }

    // Hora da AÇÃO (ts do cliente), não da ingestão — exigência de auditoria (data+hora fiel).
    // Aceita só ts plausível (últimas 48h até +2min de clock skew); fora disso, now() do banco.
    const agora = Date.now();
    const tsValido = (t) => Number.isFinite(t) && t > agora - 48 * 3600 * 1000 && t < agora + 120000;
    const rows = lista
      .filter((e) => e && TIPOS.has(e.tipo))
      .map((e) => ({
        user_id: userId, role: userId ? (role || null) : 'anonimo', anon_id: anonId, tipo: e.tipo,
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
