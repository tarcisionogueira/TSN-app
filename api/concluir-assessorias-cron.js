export const config = { runtime: 'nodejs', maxDuration: 60 };

/**
 * /api/concluir-assessorias-cron — encerra a assessoria quando ela foi ENTREGUE.
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * Regra do dono (29/08): *"a assessoria termina com a carta da arrematação e matrícula do
 * registro"*. Até aqui o fim era `acesso_fim`, derivado de `planos_config.acesso_meses` (12) —
 * um PRAZO. Prazo é teto administrativo, não conclusão de serviço: entregar em 4 meses deixava
 * a assinatura "ativa" por mais 8, e passar dos 12 sem os documentos não é conclusão, é
 * vencimento. Agora são estados diferentes porque são coisas diferentes.
 *
 * Quem decide é `concluir_assessorias_entregues()`, no banco, declarada em
 * `regra_negocio['assessoria.encerramento']` — a regra não mora neste arquivo.
 *
 * ⚠️ Exige `imovel_id` na assinatura e ARQUIVO LEGÍVEL nos dois documentos (`storage_path`):
 * registro de link não encerra serviço nenhum, e sem imóvel não há onde procurar a prova.
 */
import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export async function GET(req) { return handler(req); }
export async function POST(req) { return handler(req); }

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/concluir_assessorias_entregues`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_limite: 200 }),
  });
  // `.ok` checado: encerramento que falha calado deixaria assessorias entregues como "ativas"
  // para sempre — e ninguém procura o que o painel diz estar em dia.
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    console.log('[concluir-assessorias] FALHOU', r.status, txt.slice(0, 200));
    return new Response(JSON.stringify({ ok: false, status: r.status, detalhe: txt.slice(0, 200) }), { status: 502 });
  }
  const out = await r.json().catch(() => null);
  // Log sempre, inclusive com 0: silêncio não distingue "nada a concluir" de "cron parou".
  console.log('[concluir-assessorias]', JSON.stringify(out));
  return new Response(JSON.stringify({ ok: true, ...(out || {}) }), { headers: { 'Content-Type': 'application/json' } });
}
