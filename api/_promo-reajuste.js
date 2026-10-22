/**
 * Fim da PROMOÇÃO DE PLANO (22/10, dono): o link promocional (links_promo.recorrente_preco, ex.: Investidor Pro
 * R$ 49,90) vale 12 meses, enquanto a assinatura estiver ativa e em dia. No 13º mês a recorrência no Mercado Pago
 * passa ao preço vigente do plano (planos_config), com aviso por e-mail 15 dias antes.
 *
 * Roda dentro do /api/renovacao-avisos-cron (1×/dia) — sem cron novo. Fonte dos casos: o link reservado a um
 * usuário (reservado_para) × a assinatura dele no espelho mp_assinaturas (authorized, mesmo plano, valor = preço
 * promocional). Início = criação do mandato no MP (dados_mp.date_created) ou do espelho.
 *
 * Idempotência pela PK de webhook_eventos_processados: `promo_aviso:<preapproval>` (o e-mail que não saiu libera a
 * trava) e `promo_reajuste:<preapproval>` (gravado só DEPOIS do PUT aceito pelo MP — falha tenta de novo amanhã).
 */
import { enviarEmail } from './_email.js';

const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const EMAIL_FROM = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';
const hdr = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const DIA = 86400000;
const MESES_PROMO = 12;
const AVISO_DIAS_ANTES = 15;
const fmtBRL = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtData = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function getJson(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: hdr, signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}
// true = marcou agora (1ª vez); false = já marcado; erro inesperado → null (não age).
async function marcar(id, evento) {
  const r = await fetch(`${SB}/rest/v1/webhook_eventos_processados`, {
    method: 'POST', headers: { ...hdr, Prefer: 'return=minimal' },
    body: JSON.stringify({ gateway: 'mercadopago', gateway_payment_id: String(id), evento }),
  });
  if (r.status === 201 || r.ok) return true;
  if (r.status === 409) return false;
  return null;
}
// Quando foi marcado (Date) ou null.
async function marcadoEm(id, evento) {
  const rows = await getJson(`webhook_eventos_processados?gateway=eq.mercadopago&gateway_payment_id=eq.${encodeURIComponent(id)}&evento=eq.${encodeURIComponent(evento)}&select=processado_em&limit=1`);
  return rows.length ? new Date(rows[0].processado_em || 0) : null;
}
async function desmarcar(id, evento) {
  await fetch(`${SB}/rest/v1/webhook_eventos_processados?gateway=eq.mercadopago&gateway_payment_id=eq.${encodeURIComponent(id)}&evento=eq.${encodeURIComponent(evento)}`, { method: 'DELETE', headers: hdr }).catch(() => {});
}
async function emailENome(userId) {
  const r = await fetch(`${SB}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
  const u = r.ok ? await r.json() : null;
  const [p] = await getJson(`perfis?id=eq.${userId}&select=nome`).catch(() => []);
  return { email: u?.email ? String(u.email).toLowerCase() : null, nome: p?.nome || '' };
}

function corpoAviso({ nome, plano, promo, cheio, data }) {
  const saud = nome ? `Olá, ${esc(nome.split(' ')[0])}!` : 'Olá!';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <p style="font-size:15px">${saud}</p>
    <p style="font-size:14px;line-height:1.7">Os <strong>12 meses da sua condição promocional</strong> do plano
    <strong>${esc(plano)}</strong> terminam em <strong>${esc(data)}</strong>. A partir dessa data, a mensalidade passa
    ao valor normal do plano. <strong>Você não precisa fazer nada para continuar</strong>: é só um aviso com antecedência.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:8px 0;color:#64748b">Valor promocional (até ${esc(data)})</td><td style="padding:8px 0;text-align:right;font-weight:700">${fmtBRL(promo)}/mês</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;border-top:1px solid #e2e8f0">Valor a partir de ${esc(data)}</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">${fmtBRL(cheio)}/mês</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;border-top:1px solid #e2e8f0">Forma de pagamento</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">Cobrança recorrente no cartão cadastrado</td></tr>
    </table>
    <p style="font-size:13px;line-height:1.7;color:#475569">Se preferir não continuar, você pode cancelar a assinatura na
    sua área do cliente antes dessa data, sem multa.</p>
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil · aviso da sua condição promocional.</p>
  </div>`;
}

export async function processarFimDePromocoes() {
  const res = { casos: 0, avisados: 0, reajustados: 0, erros: [] };
  if (!MP_TOKEN || !SB || !KEY) { res.erros.push('env ausente'); return res; }
  const links = await getJson('links_promo?recorrente_preco=gt.0&reservado_para=not.is.null&select=codigo,produto,recorrente_preco,reservado_para');
  if (!links.length) return res;
  const precos = new Map((await getJson('planos_config?select=plano_key,nome,preco')).map((p) => [p.plano_key, p]));
  const agora = Date.now();

  for (const l of links) {
    const subs = await getJson(`mp_assinaturas?user_id=eq.${l.reservado_para}&status=eq.authorized&plano_key=like.${encodeURIComponent(l.produto)}*&select=mp_assinatura_id,plano_key,valor_contratado,criado_em,dados_mp`);
    const plano = precos.get(l.produto);
    const cheio = Number(plano?.preco) || 0;
    for (const s of subs) {
      // Só o mandato no valor promocional (o do plano anual/outro valor não é desta promoção).
      if (Math.abs(Number(s.valor_contratado) - Number(l.recorrente_preco)) >= 0.05) continue;
      if (!(cheio > Number(l.recorrente_preco))) { res.erros.push(`${l.codigo}: preço cheio ${cheio} não é maior que o promocional`); continue; }
      res.casos++;
      const inicio = new Date(s.dados_mp?.date_created || s.criado_em);
      const fim = new Date(inicio); fim.setMonth(fim.getMonth() + MESES_PROMO);
      const id = s.mp_assinatura_id;
      try {
        // 1) AVISO 15 dias antes (ou já, se a janela começou e ainda não reajustou).
        if (agora >= fim.getTime() - AVISO_DIAS_ANTES * DIA) {
          const nova = await marcar(id, 'promo_aviso:fim12m');
          if (nova) {
            const { email, nome } = await emailENome(l.reservado_para);
            const r = email ? await enviarEmail({
              from: EMAIL_FROM, to: email,
              subject: `Sua condição promocional do ${plano?.nome || 'plano'} termina em ${fmtData(fim)}`,
              html: corpoAviso({ nome, plano: plano?.nome || l.produto, promo: l.recorrente_preco, cheio, data: fmtData(fim) }),
              meta: { userId: l.reservado_para, tipo: 'transacional' },
            }) : null;
            if (r?.ok || r?.enfileirado) res.avisados++;
            else { await desmarcar(id, 'promo_aviso:fim12m'); res.erros.push(`${id}: aviso não saiu (${email ? 'envio' : 'sem e-mail'})`); }
          }
        }
        // 2) REAJUSTE no fim dos 12 meses — e nunca antes de 15 dias do aviso ter saído (aviso atrasado empurra o
        //    reajuste; a cliente sempre tem a antecedência prometida).
        const avisoEm = await marcadoEm(id, 'promo_aviso:fim12m');
        if (avisoEm && agora >= Math.max(fim.getTime(), avisoEm.getTime() + AVISO_DIAS_ANTES * DIA)
            && !(await marcadoEm(id, 'promo_reajuste:fim12m'))) {
          const up = await fetch(`https://api.mercadopago.com/preapproval/${encodeURIComponent(id)}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ auto_recurring: { transaction_amount: Number(cheio.toFixed(2)), currency_id: 'BRL' } }),
          });
          if (up.ok) { await marcar(id, 'promo_reajuste:fim12m'); res.reajustados++; }
          else res.erros.push(`${id}: PUT preapproval HTTP ${up.status} ${(await up.text().catch(() => '')).slice(0, 120)}`);
        }
      } catch (e) { res.erros.push(`${id}: ${String(e?.message || e).slice(0, 120)}`); }
    }
  }
  return res;
}
