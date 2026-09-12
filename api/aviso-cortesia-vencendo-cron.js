/**
 * GET/POST /api/aviso-cortesia-vencendo-cron — avisa QUEM GANHOU plano de bônus (compra de
 * curso/eBook com `concede_plano`, ex.: 3 meses de Investidor Pro) que o acesso está prestes
 * a terminar, com CTA para assinar antes de voltar a Explorador.
 *
 * POR QUE EXISTE (10/09, curso "Destravando o Investidor" — R$99 → 3 meses de Investidor Pro).
 * O objetivo de negócio do bônus é converter quem ganhou em assinante pagante. Sem aviso, a
 * conversão depende da pessoa notar sozinha que o acesso sumiu — e ela só percebe DEPOIS de
 * já ter perdido, no pior momento possível para pedir para ela voltar a pagar.
 *
 * NÃO CONFUNDIR com `renovacao-avisos-cron.js`: aquele varre PREAPPROVALS do Mercado Pago
 * (assinatura recorrente com cartão autorizado) e diz "você não precisa fazer nada". Quem
 * ganhou o plano de bônus (`perfis.plano_ciclo = 'cortesia'`) NÃO tem preapproval nenhum —
 * não aparece lá, e por isso nunca recebia aviso nenhum. É essa lacuna que este cron fecha.
 * `plano_ciclo='cortesia'` só existe quando a pessoa NUNCA teve ciclo pago próprio
 * (`conceder_plano_usuario` preserva o ciclo já existente); quem já assina de verdade nunca
 * cai aqui, então não há risco de mandar "assine" para quem já assina.
 *
 * JANELA 5–7 dias antes do vencimento (mais folga que o aviso transacional de 3 dias do MP,
 * porque decidir assinar pela primeira vez pede mais tempo que só confirmar uma cobrança que
 * já ia sair sozinha). Dedup por (user, data de vencimento) em `webhook_eventos_processados`
 * — mesma trava de `renovacao-avisos-cron.js` —, então rodar todo dia dentro da janela manda
 * UMA vez só, com folga para o caso de o cron falhar num dia específico.
 *
 * SEGURANÇA / ROLLOUT: DESLIGADO por padrão (`app_config.aviso_cortesia_ativo`), mesmo padrão
 * do `ativacao-nudge-cron.js` — é e-mail NOVO para cliente de verdade, então o primeiro
 * disparo pede autorização explícita, não redeploy. Desligado = DRY-RUN (apura e não envia).
 * Freio de mão: env `AVISO_CORTESIA_ATIVO=0` derruba mesmo com o banco ligado.
 *
 * ?limite=N — solta em lote (mesmo motivo do ativacao-nudge: o primeiro disparo de uma
 * cadência nova é também o teste dela).
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { assinarUnsub } from './cancelar-alertas.js';
import { linkRastreado } from './_link-email.js';
import { utmEmail } from './_utm.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM         = process.env.APP_ALERTS_FROM || process.env.EMAIL_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
// Freio de mão do painel: '0' desliga tudo, independente do banco (mesmo padrão do ativacao-nudge).
const FREIO_ENV    = process.env.AVISO_CORTESIA_ATIVO === '0';
const TETO_ENVIOS  = 200; // válvula de segurança — bem acima do esperado, nunca deve ser atingido
const DIA          = 86400000;
const JANELA_MIN_DIAS = 5;
const JANELA_MAX_DIAS = 7;

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

// E-mail do assinante fica em `auth.users` (GoTrue admin), não em `perfis`. Mesmo caminho
// que renovacao-avisos-cron/retencao-avisos-cron já usam.
async function emailDoUsuario(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.email ? String(u.email).toLowerCase() : null;
  } catch (e) { console.error('[aviso-cortesia-vencendo] emailDoUsuario falhou:', e?.message); return null; }
}

// Idempotência: o INSERT é a trava (PK única em webhook_eventos_processados), mesmo mecanismo
// de renovacao-avisos-cron.js. `gateway:'cortesia'` não colide com as linhas 'mercadopago'.
async function jaAvisado(userId, dataVencimento) {
  try {
    const r = await sb('webhook_eventos_processados', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ gateway: 'cortesia', gateway_payment_id: String(userId), evento: `aviso_cortesia:${dataVencimento}` }),
    });
    if (r.status === 201 || r.ok) return false;
    if (r.status === 409) return true;
    return true; // erro inesperado → não arriscar duplicar envio
  } catch (e) { console.error('[aviso-cortesia-vencendo] jaAvisado falhou (assumindo já avisado, para não duplicar envio):', e?.message); return true; }
}
async function liberarTrava(userId, dataVencimento) {
  await sb(`webhook_eventos_processados?gateway=eq.cortesia&gateway_payment_id=eq.${encodeURIComponent(String(userId))}&evento=eq.${encodeURIComponent('aviso_cortesia:' + dataVencimento)}`,
    { method: 'DELETE' }).catch(() => {});
}

// Só top2 por ora — é o único plano que algum produto concede hoje (o curso de lançamento) e
// o corpo do e-mail abaixo fala especificamente dos benefícios do Investidor Pro. Se um dia um
// produto conceder Assessoria/Club, esta lista E o texto do e-mail precisam crescer juntos —
// generalizar só a lista deixaria o texto errado para quem ganhasse outro plano.
const PLANOS_VALIDOS = ['top2'];

// Exportado (em vez de inline no handler) porque é a régua que decide QUEM recebe o aviso —
// e uma régua de dias que só existe embutida no handler só pode ser testada duplicando a
// fórmula no teste, o que quebra silenciosamente no dia em que uma das duas cópias mudar
// sozinha. `venc`/`agora` em ms epoch.
export function dentroDaJanela(vencMs, agoraMs) {
  if (!Number.isFinite(vencMs)) return false;
  const dias = Math.ceil((vencMs - agoraMs) / DIA);
  return dias >= JANELA_MIN_DIAS && dias <= JANELA_MAX_DIAS;
}

function cabecalho() {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0D63DB;background-image:linear-gradient(135deg,#0D63DB 0%,#0B4BA6 100%);border-radius:14px 14px 0 0;">
    <tr><td align="center" style="padding:22px 20px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>
          <td style="background:#ffffff;border-radius:9px;width:34px;height:34px;text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:900;color:#0D63DB;line-height:34px;">B</td>
          <td style="padding-left:10px;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:900;color:#ffffff;letter-spacing:-.2px;white-space:nowrap;">
            BidPro <span style="font-weight:400;letter-spacing:2px;font-size:12px;opacity:.85;">BRASIL</span>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>`;
}

// Exportado para permitir prévia manual (mesmo motivo de ativacao-nudge-cron.js: o dono
// precisa ver o e-mail exatamente como o cliente vai receber antes de autorizar o disparo).
export function corpo({ nome, planoNome, planoPreco, dataFmt, checkoutUrl, unsubUrl }) {
  const saudacao = nome ? `Olá, ${esc(String(nome).split(' ')[0])}!` : 'Olá!';
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:22px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;margin:0 auto;">
      <tr><td>${cabecalho()}</td></tr>
      <tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:26px 24px;color:#0f172a;">
        <p style="font-size:15px;font-weight:700;margin:0 0 12px;">${saudacao}</p>
        <p style="font-size:14px;line-height:1.7;color:#334155;margin:0 0 14px;">
          Seu acesso de cortesia ao <strong>${esc(planoNome)}</strong> — o bônus da sua compra recente —
          termina em <strong>${esc(dataFmt)}</strong>. Depois disso, sua conta volta a ser Explorador
          (busca grátis, sem os relatórios completos).
        </p>
        <p style="font-size:14px;line-height:1.7;color:#334155;margin:0 0 8px;">Para continuar com:</p>
        <ul style="font-size:14px;line-height:1.8;color:#334155;margin:0 0 18px;padding-left:20px;">
          <li>Relatório mercadológico com valor real de mercado</li>
          <li>Análise de edital, matrícula e alertas de risco (usufruto, penhora, ônus)</li>
          <li>10 relatórios/mês de cada tipo</li>
        </ul>
        <div style="text-align:center;margin:22px 0 10px;">
          <a href="${checkoutUrl}" target="_blank" style="display:inline-block;background:#0D63DB;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">Continuar por ${esc(planoPreco)}/mês →</a>
        </div>
        <p style="text-align:center;font-size:12.5px;color:#94a3b8;margin:0;">Cancele quando quiser, sem multa.</p>
      </td></tr>
      <tr><td style="padding:16px 24px 0;text-align:center;">
        <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0;">
          BidPro Brasil · Você recebe este e-mail porque tem um acesso de cortesia prestes a vencer.<br>
          <a href="${unsubUrl}" style="color:#94a3b8;">Não quero mais receber</a>.
        </p>
      </td></tr>
    </table>
  </div>`;
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let limite = 0;
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    limite = Math.max(0, Number(q.get('limite') || 0) || 0);
  } catch { /* url malformada */ }

  // Interruptor no banco. Falha de leitura => DESLIGADO: sem certeza de autorização, não
  // manda e-mail para cliente (mesmo padrão de ativacao-nudge-cron.js).
  let ligadoNoBanco = false;
  try {
    const r = await sb('app_config?key=eq.aviso_cortesia_ativo&select=value');
    if (r.ok) {
      const linhas = await r.json();
      ligadoNoBanco = String(linhas?.[0]?.value ?? '').toLowerCase() === 'true';
    } else {
      console.error('[aviso-cortesia-vencendo] leitura do interruptor devolveu', r.status, '— assumindo desligado');
    }
  } catch (e) { console.error('[aviso-cortesia-vencendo] leitura do interruptor falhou (assumindo desligado):', e?.message); }
  const ATIVO = ligadoNoBanco && !FREIO_ENV;

  const resumo = { ativo: ATIVO, freio_env: FREIO_ENV, elegiveis: 0, avisados: 0, falhas: 0, sem_email: 0 };

  // Planos-preço vêm do banco, nunca hardcoded — mesmo princípio de produto.downsell
  // (regra_negocio): preço escrito em código vira um segundo lugar dizendo quanto custa.
  const precos = {};
  try {
    const r = await sb(`planos_config?plano_key=in.(${PLANOS_VALIDOS.join(',')})&select=plano_key,nome,preco`);
    if (r.ok) { for (const p of (await r.json())) precos[p.plano_key] = p; }
    else console.error('[aviso-cortesia-vencendo] leitura de planos_config devolveu', r.status);
  } catch (e) { console.error('[aviso-cortesia-vencendo] planos_config falhou:', e?.message); }

  const agora = Date.now();
  const candRes = await sb(`perfis?select=id,nome,role,plano_vencimento&plano_ciclo=eq.cortesia&role=in.(${PLANOS_VALIDOS.join(',')})&plano_vencimento=not.is.null`);
  if (!candRes.ok) {
    return new Response(JSON.stringify({ error: 'consulta de candidatos falhou', detalhe: await candRes.text().catch(() => '') }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const todos = await candRes.json().catch(() => []);

  // Quem já tem conversão automática agendada (compra com cartão salvo, ver
  // api/ativar-assinatura-bonus-cron.js) não precisa do "assine manualmente" — os dois
  // e-mails juntos confundem mais do que ajudam. Best-effort: falhou a leitura, segue sem
  // excluir ninguém (pior caso é um e-mail redundante, não uma falha de envio).
  let comConversaoAutomatica = new Set();
  try {
    const rAuto = await sb('compras_produtos?select=user_id&mp_card_id=not.is.null&assinatura_id=is.null');
    if (rAuto.ok) comConversaoAutomatica = new Set((await rAuto.json()).map((c) => c.user_id));
    else console.error('[aviso-cortesia-vencendo] leitura de conversão automática devolveu', rAuto.status, '— seguindo sem excluir');
  } catch (e) { console.error('[aviso-cortesia-vencendo] leitura de conversão automática falhou (seguindo sem excluir):', e?.message); }

  const naJanela = (Array.isArray(todos) ? todos : [])
    .filter((p) => !comConversaoAutomatica.has(p.id))
    .filter((p) => dentroDaJanela(Date.parse(p.plano_vencimento), agora));
  resumo.elegiveis = naJanela.length;
  const lista = limite > 0 ? naJanela.slice(0, limite) : naJanela.slice(0, TETO_ENVIOS);

  if (!ATIVO) {
    resumo.previa = lista.map((p) => ({
      role: p.role, dias: Math.ceil((Date.parse(p.plano_vencimento) - agora) / DIA),
      venc: String(p.plano_vencimento).slice(0, 10), nome: p.nome || '(sem nome)',
    }));
    return new Response(JSON.stringify({ ok: true, dry_run: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });
  }

  for (const p of lista) {
    try {
      const email = await emailDoUsuario(p.id);
      if (!email) { resumo.sem_email++; continue; }

      const dataVenc = String(p.plano_vencimento).slice(0, 10);
      if (await jaAvisado(p.id, dataVenc)) continue;

      const planoInfo = precos[p.role] || {};
      const planoNome = planoInfo.nome || p.role;
      const planoPreco = brl(planoInfo.preco);
      const dataFmt = new Date(p.plano_vencimento).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' });
      const checkoutUrl = linkRastreado(p.id, 'cortesia_vencendo', `/#/checkout?plano=${p.role}&${utmEmail('cortesia_vencendo')}`);
      const unsubUrl = `${BASE}/api/cancelar-alertas?token=${assinarUnsub(p.id)}`;

      const r = await enviarEmail({
        from: FROM,
        to: email,
        subject: `Seu acesso ${planoNome} termina em ${dataFmt}`,
        html: corpo({ nome: p.nome, planoNome, planoPreco, dataFmt, checkoutUrl, unsubUrl }),
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        meta: { tipo: 'cortesia_vencendo', userId: p.id },
      });

      if (r?.ok) resumo.avisados++;
      else { resumo.falhas++; await liberarTrava(p.id, dataVenc); }
    } catch (e) {
      resumo.falhas++;
      console.error('[aviso-cortesia-vencendo] falha:', e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });
}
