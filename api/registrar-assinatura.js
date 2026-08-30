export const config = { runtime: 'edge' };

/**
 * POST /api/registrar-assinatura — admin registra uma ASSESSORIA/CLUBE contratada FORA do
 * gateway (pagamento externo, acordo comercial).
 * ═══════════════════════════════════════════════════════════════════════════════════════════
 * POR QUE EXISTE (29/08): o dono relatou um cliente que "contratou uma nova assessoria e pagou
 * por fora do sistema" e perguntou como registrar. Não havia como: `plano_assinaturas` existe
 * desde `add_planos_fidelidade.sql`, o Admin tem tela que LISTA os assessorados a partir dela e
 * botões de cancelar/estender — e **nenhum `insert` existia em lugar nenhum do código**. A
 * tabela tinha 0 linhas.
 *
 * O efeito era o que o dono via na tela: o cliente aparece "Assessoria · PAGO" (isso vem do
 * `role`), com **0 pagamentos e 0 contratos**, e some da lista de assessorados do Admin. O
 * dinheiro que entrou por fora existia só na memória de quem fechou o acordo.
 *
 * Quem aplica a regra é `registrar_assinatura_manual()` no banco — não um `insert` daqui:
 * fidelidade e acesso saem de `planos_config` (são política do plano, não campo digitado), a
 * promoção reusa `promover_para_assessorado()` (a mesma da atribuição manual), e
 * `regra_negocio['assinatura.registro_manual']` deixa tudo auditável por
 * `auditoria_regras_negocio()`.
 *
 * ⚠️ NÃO carimba `plano_pago_em`. Esse campo é a âncora da garantia de 7 dias do CDC
 * (`regra_negocio['garantia.ancora_7d']`), e se pagamento FORA do gateway abre ou não essa
 * janela — e a partir de quando — é decisão do dono, não deste endpoint. Fica explícito na
 * resposta para não virar omissão silenciosa.
 */
import { getAuthUser, getUserRoleById } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const PLANOS = new Set(['assessorado', 'clube']);
// 'contrato' NAO entra aqui de proposito: essa origem e escrita por `assinar-contrato.js`,
// e deixar o admin escolhe-la a mao faria duas coisas diferentes usarem o mesmo rotulo —
// depois ninguem sabe se a assinatura veio de contrato assinado ou de digitacao.
const FORMAS = new Set(['externo', 'a_vista', 'parcelado', 'recorrente']);
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const role = await getUserRoleById(user.id);
  // Só ADMIN: registrar assinatura concede plano e dinheiro declarado. Analista atribui
  // arremate (que não mexe em direitos), mas conceder plano é outro nível.
  if (role !== 'admin') return json({ error: 'Apenas admin pode registrar assinatura.' }, 403);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Supabase não configurado' }, 500);

  const body = await req.json().catch(() => ({}));
  const { user_id, plano_key, forma_pagamento, valor_total, valor_mensal, imovel_id, notas } = body || {};
  if (!user_id) return json({ error: 'user_id obrigatório' }, 400);
  if (!PLANOS.has(plano_key)) return json({ error: `plano_key deve ser um de: ${[...PLANOS].join(', ')}` }, 400);
  const forma = FORMAS.has(forma_pagamento) ? forma_pagamento : 'externo';
  // Valor vem de campo de texto brasileiro ("6.000,00"): converte aqui, uma vez, em vez de
  // deixar cada chamador inventar o seu parser.
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_assinatura_manual`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_user_id: user_id, p_plano_key: plano_key, p_forma_pagamento: forma,
      p_valor_total: num(valor_total), p_valor_mensal: num(valor_mensal),
      p_imovel_id: imovel_id || null, p_notas: notas || null, p_admin: user.id,
    }),
  });
  // `.ok` checado de propósito: um registro que falha em silêncio devolveria sucesso à tela e o
  // admin fecharia acreditando que registrou — o dinheiro seguiria só na memória de alguém, que
  // é exatamente o problema que este endpoint veio resolver.
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    return json({ error: `Falha ao registrar (HTTP ${r.status})`, detalhe: txt.slice(0, 300) }, 502);
  }
  const out = await r.json().catch(() => null);
  return json({
    ok: true,
    ...(out || {}),
    aviso_garantia: 'A janela de 7 dias do CDC NÃO foi ancorada (plano_pago_em intacto): '
      + 'pagamento fora do gateway é decisão comercial do dono.',
  });
}
