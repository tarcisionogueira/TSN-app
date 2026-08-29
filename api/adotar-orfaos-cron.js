/**
 * /api/adotar-orfaos-cron — ninguém fica órfão de carteira, mesmo sem nunca abrir o app.
 *
 * POR QUE EXISTE (28/08): `vincular_owner_default()` é chamada pelo `AuthContext`, no evento
 * SIGNED_IN — a regra do upline padrão só existia no NAVEGADOR. Quem nunca loga (inscrição na
 * aula ao vivo, cadastro com e-mail não confirmado, conta criada no checkout) ficava sem
 * consultor para sempre. Medido no dia: dos 67 clientes que já logaram, 67 tinham consultor;
 * os 2 sem consultor estavam entre os 3 que nunca logaram.
 *
 * A CARÊNCIA de 24h é o ponto, não um detalhe: preencher o upline no nascimento do perfil
 * roubaria a indicação do parceiro (`vincular_upline` só grava com `indicado_por` nulo, e o
 * `?ref=` do cadastro por Google é resolvido no navegador DEPOIS de o perfil existir).
 *
 * A regra em si mora no banco (`public.adotar_orfaos_padrao_dono`, declarada em
 * `regra_negocio` como `comercial.upline_padrao`) — aqui só o gatilho e a checagem honesta
 * da resposta: um 4xx/5xx do PostgREST NÃO pode virar "0 adotados, tudo certo".
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { isCronAuthorized } from './_auth.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const CARENCIA_HORAS = 24;

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SB || !KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/adotar_orfaos_padrao_dono`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_horas: CARENCIA_HORAS }),
      signal: AbortSignal.timeout(20000),
    });
    // `.ok` ANTES do corpo: sem isto, um 401 vira `{}` e o cron reporta sucesso sem ter
    // adotado ninguém — a falha que não sabe que falhou, catalogada no CLAUDE.md.
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      throw new Error(`rpc adotar_orfaos_padrao_dono: HTTP ${r.status} ${String(corpo).slice(0, 200)}`);
    }
    const out = await r.json();
    // Log SEMPRE, inclusive o zero — mesma regra de `desativar-encerrados-cron`. Na 1ª conferência
    // (29/08) o cron rodou às 09:10:21 e adotou 0 legitimamente (o único órfão ainda estava na
    // carência), mas como só falava quando adotava alguém, "rodou e não tinha o que fazer" e "não
    // rodou" ficaram indistinguíveis no log da função — foi preciso ir ao log de ACESSO da Vercel
    // para separar os dois. Silêncio não é prova de nada.
    console.log(`[adotar-orfaos] ${out?.adotados ?? '?'} adotado(s) · carência ${CARENCIA_HORAS}h · corte ${out?.corte || '?'}`);
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('[adotar-orfaos] falhou:', e?.message);
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
}
