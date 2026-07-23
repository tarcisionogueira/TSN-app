/**
 * /api/regenerar-relatorios-cron — REGERAÇÃO POR VÍCIO (loop de aprendizado).
 *
 * Executa o "apontamento para regerar": quando um relatório saiu com VÍCIO regenerável
 * (regen_motivo != null — matrícula não lida, CNJ não consultado, contradição/revisão no
 * laudo…), dispara um NOVO ciclo de geração com orçamento fresco. Se a causa-raiz foi
 * resolvida (doc capturado, valor confirmado), o gerador re-emite SEM o vício e o flag
 * some. Se persistir, regen_tentativas sobe até o teto e para (economia: não regera
 * infinito um vício permanente, ex.: matrícula que não existe).
 *
 * SEGURO: server-side, fire-and-forget, best-effort — nunca toca o fluxo vivo do usuário
 * (o gerador é chamado por CRON_SECRET, sem cota, e re-emite o relatório existente; um
 * 'gerando' preso >15min é destravado pelo limpar-analises-cron). ECONÔMICO: teto de
 * tentativas + lote pequeno + janela de assentamento + corte de 72h + roda a cada 6h.
 *
 * Escopo: documental e laudo (vícios regeneráveis por regen_motivo) + MERCADO que falhou por
 * TIMEOUT (transitório) — este é re-tentado UMA vez com orçamento fresco (self-heal), para o
 * cliente não ficar com um 'erro' preso sem reagir. Os vícios de valor do mercado (avaliação/
 * mínimo ausentes) seguem se auto-corrigindo no garantirValores a cada geração.
 * Autorizado por CRON_SECRET (Bearer). Registrado no vercel.json.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET = (process.env.CRON_SECRET || '').trim();
// Domínio canônico (www): o apex redireciona 308 — igual ao documental-retry-cron.
const BASE = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace('://bidprobrasil.com.br', '://www.bidprobrasil.com.br');

const MAX_TENT = 3;   // teto de regeração por relatório (economia)
const LOTE = 2;       // por tipo, por run (cada um abre 1 chamada de IA longa)
const SETTLE_H = 2;   // espera o dado assentar (captura de doc/valor) antes de gastar IA
const JANELA_H = 72;  // não regera relatório mais velho que isto

const AGENTES = [
  { tabela: 'analises_documental', endpoint: 'gerar-documental' },
  { tabela: 'analises_laudo',      endpoint: 'gerar-laudo-viabilidade' },
];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY || !CRON_SECRET) { res.status(500).json({ error: 'env ausente' }); return; }

  const agora = Date.now();
  const settle = new Date(agora - SETTLE_H * 3600 * 1000).toISOString();
  const janela = new Date(agora - JANELA_H * 3600 * 1000).toISOString();
  const out = {};

  for (const { tabela, endpoint } of AGENTES) {
    let rows = [];
    try {
      const q = `${tabela}?status=eq.concluida&regen_motivo=not.is.null&regen_tentativas=lt.${MAX_TENT}`
        + `&updated_at=lt.${encodeURIComponent(settle)}&updated_at=gt.${encodeURIComponent(janela)}`
        + `&order=updated_at.asc&limit=${LOTE}&select=user_id,imovel_id,titulo,cidade,estado,regen_tentativas`;
      rows = await (await sb(q)).json();
    } catch { rows = []; }
    if (!Array.isArray(rows) || !rows.length) { out[tabela] = 0; continue; }

    await Promise.allSettled(rows.map(async (r) => {
      // Incrementa a tentativa ANTES de disparar (mesmo se a geração falhar, conta —
      // evita loop). O gerador, ao re-emitir, limpa regen_motivo se o vício sumiu.
      try {
        await sb(`${tabela}?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ regen_tentativas: (r.regen_tentativas || 0) + 1, regen_em: new Date().toISOString() }),
        });
      } catch { /* segue mesmo assim */ }
      await fetch(`${BASE}/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
        body: JSON.stringify({ imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado }),
        signal: AbortSignal.timeout(9000),
      }).catch(() => {});
    }));
    out[tabela] = rows.length;
  }

  // SELF-HEAL do MERCADO: relatório que falhou por TIMEOUT (transitório) é re-tentado UMA vez
  // (teto 1 = economia) com orçamento fresco. O gerador de mercado exige mercadoInputs → relemos
  // do `inputs` gravado na própria linha. Mesma janela de assentamento/corte dos demais.
  let mktRetry = 0;
  try {
    const q = `analises_mercado?status=eq.erro&erro=ilike.*tempo*limite*&regen_tentativas=lt.1`
      + `&updated_at=lt.${encodeURIComponent(settle)}&updated_at=gt.${encodeURIComponent(janela)}`
      + `&order=updated_at.asc&limit=${LOTE}&select=user_id,imovel_id,titulo,cidade,estado,imovel,inputs,regen_tentativas`;
    const rows = await (await sb(q)).json();
    if (Array.isArray(rows)) {
      await Promise.allSettled(rows.map(async (r) => {
        if (!r?.inputs?.mercadoInputs) return; // sem os inputs originais não dá p/ regerar
        try {
          await sb(`analises_mercado?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ regen_tentativas: (r.regen_tentativas || 0) + 1, regen_em: new Date().toISOString() }),
          });
        } catch { /* segue mesmo assim */ }
        await fetch(`${BASE}/api/gerar-analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
          body: JSON.stringify({
            imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
            imovel: r.imovel || null, mercadoInputs: r.inputs.mercadoInputs, parecerInputs: r.inputs.parecerInputs,
          }),
          signal: AbortSignal.timeout(9000),
        }).catch(() => {});
        mktRetry++;
      }));
    }
  } catch { /* self-heal best-effort: nunca derruba o cron */ }
  out.analises_mercado_timeout = mktRetry;

  // SELF-HEAL do MERCADO VAZIO: relatório que CONCLUIU mas voltou SEM amostras (fonte de
  // pesquisa instável no momento — 0 vendas/locações e sem preço) NÃO cobra cota do cliente
  // e é re-tentado em background com orçamento fresco, até 48h após criado (janela pela IDADE
  // do relatório — created_at não desliza no upsert). Teto de tentativas p/ não gastar IA
  // eternamente num mercado GENUINAMENTE raso (imóvel atípico sem comparáveis): passado o teto,
  // fica como "não estimado" (estado final correto). Ao PREENCHER, o flag some e para sozinho.
  let mktVazio = 0;
  const MAX_VAZIO = 8;                 // ~48h a cada 6h de cron
  const idade48 = new Date(agora - 48 * 3600 * 1000).toISOString();
  try {
    const q = `analises_mercado?status=eq.concluida&result->>mercadoVazio=eq.true&regen_tentativas=lt.${MAX_VAZIO}`
      + `&created_at=gt.${encodeURIComponent(idade48)}`
      + `&order=updated_at.asc&limit=${LOTE}&select=user_id,imovel_id,titulo,cidade,estado,imovel,inputs,regen_tentativas`;
    const rows = await (await sb(q)).json();
    if (Array.isArray(rows)) {
      await Promise.allSettled(rows.map(async (r) => {
        if (!r?.inputs?.mercadoInputs) return; // sem os inputs originais não dá p/ regerar
        try {
          await sb(`analises_mercado?user_id=eq.${encodeURIComponent(String(r.user_id))}&imovel_id=eq.${encodeURIComponent(String(r.imovel_id))}`, {
            method: 'PATCH', headers: { Prefer: 'return=minimal' },
            body: JSON.stringify({ regen_tentativas: (r.regen_tentativas || 0) + 1, regen_em: new Date().toISOString() }),
          });
        } catch { /* segue mesmo assim */ }
        await fetch(`${BASE}/api/gerar-analise`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-cron-secret': CRON_SECRET },
          body: JSON.stringify({
            imovelId: r.imovel_id, paraUserId: r.user_id, titulo: r.titulo, cidade: r.cidade, estado: r.estado,
            imovel: r.imovel || null, mercadoInputs: r.inputs.mercadoInputs, parecerInputs: r.inputs.parecerInputs,
          }),
          signal: AbortSignal.timeout(9000),
        }).catch(() => {});
        mktVazio++;
      }));
    }
  } catch { /* self-heal best-effort: nunca derruba o cron */ }
  out.analises_mercado_vazio = mktVazio;

  res.status(200).json({ ok: true, regenerados: out });
}
