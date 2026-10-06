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
import { enviarEmail } from './_email.js';
import { cancelarRecorrenciaPro } from './_recorrencia-unica.js';

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
  // AVISO AO CLIENTE (06/10, regra_negocio['assessoria.inclui_pro']): os benefícios do Investidor
  // Pro vinham da assessoria, sem mensalidade. Concluída, o banco devolveu o papel (explorador, ou
  // top2 se ele tem Pro próprio) e o cliente precisa saber como manter os benefícios.
  const avisos = { enviados: 0, falhas: [] };
  for (const u of (out?.usuarios || [])) {
    try {
      await avisarConclusao(u);
      avisos.enviados++;
    } catch (e) {
      avisos.falhas.push({ user_id: u.user_id, erro: String(e?.message || e).slice(0, 160) });
    }
  }
  // MENSALIDADE DO PRO NÃO CORRE DURANTE A ASSESSORIA (06/10, regra_negocio['assessoria.inclui_pro']).
  // Varredura de todos os assessorados ATIVOS: cobre os caminhos em que a assessoria entra sem
  // passar pelo webhook (contrato assinado — que dispara este cron na hora —, registro manual do
  // Admin). Os webhooks já cancelam na confirmação; aqui é a rede. O helper nunca lança e alerta.
  const pro = { verificados: 0, mp: 0, asaas: 0, falhas: 0 };
  const ra = await fetch(`${SUPABASE_URL}/rest/v1/plano_assinaturas?status=eq.ativo&plano_key=eq.assessorado&select=user_id`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!ra.ok) {
    pro.erro = `leitura de plano_assinaturas HTTP ${ra.status}`;
  } else {
    const uids = [...new Set((await ra.json()).map((x) => x.user_id).filter(Boolean))];
    for (const uid of uids) {
      const c = await cancelarRecorrenciaPro({ userId: uid, origem: 'varredura-assessorados' });
      pro.verificados++;
      pro.mp += c.mpCancelados.length;
      pro.asaas += c.asaasCancelados.length;
      if (c.erros.length) pro.falhas++;
    }
  }
  // Log sempre, inclusive com 0: silêncio não distingue "nada a concluir" de "cron parou".
  console.log('[concluir-assessorias]', JSON.stringify({ ...(out || {}), avisos, pro }));
  return new Response(JSON.stringify({ ok: true, ...(out || {}), avisos, pro }), { headers: { 'Content-Type': 'application/json' } });
}

async function avisarConclusao({ user_id: userId, role }) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${encodeURIComponent(userId)}&select=nome,email`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!r.ok) throw new Error(`perfil HTTP ${r.status}`);
  const [p] = await r.json();
  if (!p?.email) throw new Error('perfil sem e-mail');
  const base = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  const nome = String(p.nome || '').trim().split(' ')[0] || 'Investidor';
  const manteveProprio = /^top2/.test(String(role || ''));
  const btn = (href, txt, cor) => `<a href="${href}" style="background:${cor};color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;display:inline-block;margin:0 8px 10px 0">${txt}</a>`;
  const linhaPro = manteveProprio
    ? 'Como você mantém a sua assinatura do <strong>Investidor Pro</strong>, os benefícios dele continuam ativos.'
    : 'Os benefícios do <strong>Investidor Pro</strong> vinham incluídos na assessoria e se encerram com ela. Para mantê-los, você pode <strong>contratar uma nova assessoria</strong> para o próximo imóvel ou <strong>assinar o Investidor Pro</strong>.';
  const env = await enviarEmail({
    to: p.email,
    subject: 'Sua assessoria foi concluída — próximos passos',
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:540px;margin:0 auto;color:#1e293b">
      <h2 style="color:#0D63DB;margin:0 0 12px">Parabéns, ${nome}! 🏠</h2>
      <p style="font-size:15px;line-height:1.6">A sua assessoria foi <strong>concluída</strong>: a carta de arrematação e a matrícula registrada do imóvel já estão no seu acompanhamento.</p>
      <p style="font-size:15px;line-height:1.6">${linhaPro}</p>
      <p style="margin:20px 0 10px">${btn(`${base}/#/checkout?plano=assessorado`, 'Contratar nova assessoria', '#d97706')}${manteveProprio ? '' : btn(`${base}/#/checkout?plano=top2`, 'Assinar o Investidor Pro', '#0D63DB')}</p>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px">BidPro Brasil — Leilão &amp; Investimentos</p>
    </div>`,
    text: `Parabéns, ${nome}! A sua assessoria foi concluída. ${linhaPro.replace(/<[^>]+>/g, '')}\n\nNova assessoria: ${base}/#/checkout?plano=assessorado${manteveProprio ? '' : `\nInvestidor Pro: ${base}/#/checkout?plano=top2`}\n\nBidPro Brasil — Leilão & Investimentos`,
    meta: { tipo: 'assessoria_concluida', userId },
    idempotencyKey: `assessoria_concluida_${userId}_${new Date().toISOString().slice(0, 10)}`,
  });
  // Represado por orçamento (`enfileirado`) é entrega adiada, não falha.
  if (!env?.ok && !env?.enfileirado) throw new Error(env?.error || 'envio falhou');
}
