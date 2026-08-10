/**
 * POST /api/agendar-plano — DOWNGRADE agendado para o FIM do período já pago.
 *
 * O PROBLEMA QUE ISTO RESOLVE (10/08). A troca de plano só existia pelo Asaas
 * (`/api/asaas` action `gerenciar_assinatura`), e o Asaas é o gateway de BACKUP. O assinante
 * típico — que veio pelo Mercado Pago, o principal — clicava em "Confirmar" e recebia
 * *"Cliente não encontrado no Asaas. Faça a primeira assinatura."*, sem nenhum caminho
 * alternativo. Na prática, não existia downgrade para a maioria dos clientes.
 *
 * POR QUE **AGENDAR**, E NÃO AS DUAS ALTERNATIVAS ÓBVIAS:
 *
 *  ✗ Cancelar e recriar mais barato AGORA — o cliente perde o restante do período que já pagou.
 *    Downgrade não pode custar dinheiro a quem está pedindo para gastar menos.
 *
 *  ✗ Só baixar o valor da recorrência no gateway — funciona no Asaas (é o que
 *    `gerenciar_assinatura` faz, com `updatePendingPayments:false`) e **NÃO funciona no MP**:
 *    o webhook identifica o plano pelo `external_reference` (`userId|planoKey`), não pelo
 *    valor. Baixar só o valor deixaria a pessoa pagando o preço do Investidor Pro e
 *    continuando com o Clube — um bug de receita silencioso.
 *
 *  ✓ AGENDAR: marca `perfis.plano_agendado`, cancela a auto-renovação e PRESERVA o acesso até
 *    `plano_vencimento`. Perto da virada, `renovacao-avisos-cron` convida o cliente a autorizar
 *    o plano novo — MP e Asaas exigem consentimento para uma nova recorrência, e nunca
 *    cobramos em silêncio. É exatamente a mecânica já provada da troca anual→mensal
 *    (`ciclo_agendado`, ver api/agendar-ciclo.js): mesmo desenho, mesma garantia.
 *
 * SEGURANÇA: lê o PRÓPRIO perfil com a service key e decide pelo que está no BANCO. O body só
 * diz qual é o plano de destino — nunca quem é o usuário, nunca o preço. O cancelamento no MP
 * reusa o filtro por `external_reference` do usuário autenticado (anti-IDOR, ver api/mp.js).
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };

import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
const MP_URL = 'https://api.mercadopago.com';
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();

// Hierarquia dos planos recorrentes. Só existe DOWNGRADE entre eles; assessoria é avulsa e
// não entra (não é recorrência) — por isso não está aqui.
const ORDEM = ['top2', 'clube'];

function sb(path, opts = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    signal: opts.signal || AbortSignal.timeout(12000),
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

/**
 * Cancela a AUTO-RENOVAÇÃO nos dois gateways. Não rebaixa nada: o acesso segue pela âncora
 * `plano_vencimento` do perfil. Devolve quantas assinaturas foram efetivamente canceladas em
 * cada lado — o chamador precisa saber, porque "não achei nenhuma" e "não consegui cancelar"
 * levam a desfechos diferentes.
 */
async function cancelarRecorrencias({ userId, email }) {
  const out = { mp: 0, asaas: 0, falhas: [] };

  if (MP_TOKEN && email) {
    try {
      const r = await fetch(`${MP_URL}/preapproval/search?payer_email=${encodeURIComponent(email)}&status=authorized`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` }, signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) throw new Error(`busca ${r.status}`);
      const j = await r.json();
      // FILTRO ANTI-IDOR: só preapprovals cujo external_reference começa com o userId
      // AUTENTICADO. Sem ele, um e-mail no body cancelaria a assinatura de terceiro.
      const ids = (j?.results || [])
        .filter((x) => String(x.external_reference || '').split('|')[0] === userId)
        .map((x) => x.id).filter(Boolean);
      for (const id of ids) {
        const c = await fetch(`${MP_URL}/preapproval/${id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'cancelled' }),
          signal: AbortSignal.timeout(12000),
        });
        if (c.ok) out.mp++; else out.falhas.push(`mp ${id}: HTTP ${c.status}`);
      }
    } catch (e) { out.falhas.push(`mp: ${String(e?.message || e)}`); }
  }

  if (ASAAS_KEY && email) {
    try {
      const rc = await fetch(`${ASAAS_URL}/customers?email=${encodeURIComponent(email)}`, {
        headers: { access_token: ASAAS_KEY }, signal: AbortSignal.timeout(12000),
      });
      const cus = rc.ok ? (await rc.json().catch(() => null))?.data?.[0] : null;
      if (cus) {
        const rs = await fetch(`${ASAAS_URL}/subscriptions?customer=${cus.id}&status=ACTIVE`, {
          headers: { access_token: ASAAS_KEY }, signal: AbortSignal.timeout(12000),
        });
        const subs = rs.ok ? (await rs.json().catch(() => null))?.data || [] : [];
        for (const s of subs) {
          const d = await fetch(`${ASAAS_URL}/subscriptions/${s.id}`, {
            method: 'DELETE', headers: { access_token: ASAAS_KEY }, signal: AbortSignal.timeout(12000),
          });
          if (d.ok) out.asaas++; else out.falhas.push(`asaas ${s.id}: HTTP ${d.status}`);
        }
      }
    } catch (e) { out.falhas.push(`asaas: ${String(e?.message || e)}`); }
  }

  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Método não permitido' }); return; }
  if (!SB_URL || !SB_KEY) { res.status(500).json({ error: 'Servidor não configurado' }); return; }

  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Não autenticado' }); return; }

  const rl = await checkRateLimit(`agendar-plano:${user.id}:${getIP(req)}`, 5, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl);

  const alvo = String(req.body?.alvo || '').trim();
  if (!ORDEM.includes(alvo)) { res.status(400).json({ error: 'Plano de destino inválido.' }); return; }

  // Estado AUTORITATIVO do banco — nunca o que o cliente afirma ser.
  const perfilRes = await sb(`perfis?id=eq.${encodeURIComponent(user.id)}&select=role,plano_vencimento,plano_agendado`);
  if (!perfilRes.ok) { res.status(502).json({ error: 'Não consegui ler seu plano agora. Tente em instantes.' }); return; }
  const [perfil] = await perfilRes.json().catch(() => []);
  if (!perfil) { res.status(404).json({ error: 'Perfil não encontrado.' }); return; }

  const atual = String(perfil.role || '').replace(/_anual$/, '');
  const iAtual = ORDEM.indexOf(atual), iAlvo = ORDEM.indexOf(alvo);
  if (iAtual < 0) { res.status(400).json({ error: 'Seu plano atual não é uma assinatura recorrente.' }); return; }
  if (iAlvo === iAtual) { res.status(400).json({ error: 'Você já está neste plano.' }); return; }
  // Este endpoint é SÓ de downgrade. Upgrade cobra agora e segue pelo checkout — misturar os
  // dois aqui abriria a porta para "subir de plano sem pagar a diferença".
  if (iAlvo > iAtual) { res.status(400).json({ error: 'Para subir de plano, use o checkout — o upgrade vale na hora.' }); return; }

  // Sem vencimento conhecido não há "fim do período pago" para agendar. Nesse caso o honesto é
  // não prometer data nenhuma: a equipe resolve. (Não inventamos uma data para o cliente.)
  if (!perfil.plano_vencimento) {
    res.status(409).json({ error: 'Não consegui identificar até quando o seu plano atual está pago. Fale com o suporte que fazemos a troca manualmente, sem você perder nada.' });
    return;
  }

  const canc = await cancelarRecorrencias({ userId: user.id, email: user.email });
  // Se NADA foi cancelado e houve FALHA, a renovação segue viva: agendar aqui deixaria o
  // cliente pagando o plano caro de novo no vencimento, achando que trocou. Fail-closed.
  if (canc.mp === 0 && canc.asaas === 0 && canc.falhas.length) {
    console.error('[agendar-plano] nenhuma recorrência cancelada', canc.falhas.join('; '));
    res.status(502).json({ error: 'Não consegui alterar sua assinatura no gateway agora. Nada foi mudado — tente em instantes.' });
    return;
  }

  const upd = await sb(`perfis?id=eq.${encodeURIComponent(user.id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ plano_agendado: alvo }),
  });
  const [linha] = upd.ok ? await upd.json().catch(() => []) : [];
  if (!linha) {
    // A recorrência JÁ foi cancelada acima. Não dá para dizer "tudo certo" sem a marcação —
    // sem ela o cron nunca convida o cliente a autorizar o plano novo e ele simplesmente cai.
    console.error('[agendar-plano] recorrência cancelada mas plano_agendado NÃO gravou', user.id);
    res.status(502).json({
      error: 'Sua renovação automática foi cancelada, mas não consegui registrar a troca. Fale com o suporte para concluir — o seu acesso atual segue normalmente até o vencimento.',
    });
    return;
  }

  auditLog({ acao: 'plano_downgrade_agendado', user_id: user.id, ip: getIP(req), sucesso: true,
    detalhes: { de: atual, para: alvo, vencimento: perfil.plano_vencimento, cancelados: { mp: canc.mp, asaas: canc.asaas } } });

  res.status(200).json({
    ok: true, tipo: 'downgrade_agendado',
    de: atual, para: alvo,
    vale_a_partir_de: perfil.plano_vencimento,
    // O cliente precisa saber as três coisas: não paga agora, não perde o que pagou, e vai
    // receber um convite para autorizar o plano novo perto da virada.
    mensagem: 'Troca agendada. Você mantém o plano atual até o fim do período já pago, sem nenhuma cobrança agora — e perto do vencimento enviamos o link para ativar o novo plano.',
  });
}
