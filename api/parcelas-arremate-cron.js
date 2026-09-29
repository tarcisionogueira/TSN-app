/**
 * GET/POST /api/parcelas-arremate-cron — lembra o arrematante (com cópia para a equipe) de cada
 * vencimento do pagamento da arrematação (29/09, pedido do dono).
 *
 * Por quê: no leilão judicial parcelado, atraso em qualquer parcela gera multa de 10% sobre a
 * parcela + as vincendas e o credor pode pedir o desfazimento da arrematação (art. 895, §§4º-5º,
 * CPC). A guia de depósito é emitida no portal do banco/tribunal pelo nº do processo — sem API
 * pública — então o sistema não a gera: ele SABE a data e o valor e avisa antes.
 *
 * Régua: 5 dias antes, 1 dia antes e 1 dia depois (atraso). Datas/valores vêm de
 * src/utils/parcelamentoArremate.js — a MESMA regra que a tela mostra. Dedup por (arremate,
 * parcela, marco) em webhook_eventos_processados, mesmo mecanismo de aviso-cortesia-vencendo-cron.
 * ?seco=1 apura sem enviar. Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { cronograma, proximaPendente, avisoPenalidade } from '../src/utils/parcelamentoArremate.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM         = process.env.APP_ALERTS_FROM || process.env.EMAIL_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const EQUIPE       = process.env.ADMIN_ALERT_EMAIL || null;
// Marco = JANELA, não dia exato: se o envio do dia 5 falhar, o de 4, 3 ou 2 ainda cai no mesmo marco
// e tenta de novo (a trava é por marco — sai UM aviso por janela). Com dia exato, "liberar a trava
// para tentar amanhã" não adiantava nada: amanhã já não era marco (revisão 29/09).
const marcoDe = (dias) => (dias >= 2 && dias <= 5 ? 5 : dias >= 0 && dias <= 1 ? 1 : dias <= -1 && dias >= -7 ? -1 : null);

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });
const dataBR = (s) => String(s).slice(0, 10).split('-').reverse().join('/');

async function emailDoUsuario(userId) {
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
    if (!r.ok) { console.error(`[parcelas-arremate] usuário ${userId}: HTTP ${r.status}`); return null; }
    const u = await r.json();
    return u?.email ? String(u.email).toLowerCase() : null;
  } catch (e) { console.error('[parcelas-arremate] emailDoUsuario falhou:', e?.message); return null; }
}

// O INSERT é a trava (PK única). Erro inesperado → trata como já avisado (não duplica envio).
async function travar(chave) {
  try {
    const r = await sb('webhook_eventos_processados', { method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ gateway: 'parcela_arremate', gateway_payment_id: chave.split('|')[0], evento: chave }) });
    if (r.status === 201 || r.ok) return true;
    if (r.status !== 409) console.error(`[parcelas-arremate] trava ${chave}: HTTP ${r.status}`);
    return false;
  } catch (e) { console.error('[parcelas-arremate] trava falhou (não envia):', e?.message); return false; }
}
async function liberar(chave) {
  await sb(`webhook_eventos_processados?gateway=eq.parcela_arremate&evento=eq.${encodeURIComponent(chave)}`, { method: 'DELETE' })
    .catch((e) => console.error('[parcelas-arremate] liberar trava falhou:', e?.message));
}

export function corpo({ titulo, prox, penalidade, processo, link }) {
  const quando = prox.dias > 0 ? `vence em ${prox.dias} dia${prox.dias > 1 ? 's' : ''}` : prox.dias === 0 ? 'vence hoje' : `está em atraso há ${-prox.dias} dia${prox.dias < -1 ? 's' : ''}`;
  return `<div style="font-family:Arial,sans-serif;max-width:560px;color:#0f172a">
  <h2 style="margin:0 0 8px">${prox.dias < 0 ? '⚠️' : '⏰'} ${esc(prox.rotulo)} ${esc(quando)}</h2>
  <p style="margin:0 0 12px;color:#475569">${esc(titulo)}</p>
  <table style="border-collapse:collapse;font-size:14px">
    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Vencimento</td><td><b>${dataBR(prox.venc)}</b></td></tr>
    <tr><td style="padding:4px 12px 4px 0;color:#64748b">Valor nominal</td><td><b>${brl(prox.valor)}</b></td></tr>
    ${processo ? `<tr><td style="padding:4px 12px 4px 0;color:#64748b">Processo</td><td>${esc(processo)}</td></tr>` : ''}
  </table>
  <p style="font-size:13px;color:#475569">Emita a guia de depósito no portal do banco/tribunal com o número do processo — a correção do índice do edital é aplicada na própria guia.</p>
  <p style="font-size:13px;color:#b91c1c">${esc(penalidade)}</p>
  <p><a href="${link}" style="background:#0D63DB;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Ver cronograma</a></p>
</div>`;
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const seco = new URL(req.url, BASE).searchParams.get('seco') === '1';
  const r = await sb('arrematados?parcelamento=not.is.null&select=id,user_id,titulo,imovel_id,valor_arrematacao,data_arrematacao,imovel,parcelamento');
  if (!r.ok) {
    const det = await r.text().catch(() => '');
    console.error(`[parcelas-arremate] leitura falhou: HTTP ${r.status} ${det.slice(0, 200)}`);
    return new Response(JSON.stringify({ ok: false, erro: `leitura HTTP ${r.status}` }), { status: 500 });
  }
  const lista = await r.json();
  // Modalidade e processo da FONTE (imóvel do acervo) — o jsonb do arremate costuma vir sem eles.
  const ids = [...new Set(lista.map((a) => a.imovel_id).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x || ''))))];
  const fonte = {};
  if (ids.length) {
    const ri = await sb(`imoveis_leilao?id=in.(${ids.join(',')})&select=id,modalidade,numero_processo`);
    if (ri.ok) for (const i of await ri.json()) fonte[i.id] = i;
    else console.error(`[parcelas-arremate] leitura do imóvel: HTTP ${ri.status} — segue com o jsonb do arremate`);
  }
  const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // dia em Brasília
  const res = { arremates: lista.length, no_marco: 0, enviados: 0, ja_avisados: 0, sem_email: 0, falhas: 0, seco };
  for (const a of lista) {
    // Uma linha com jsonb ruim (data inválida → RangeError) não pode derrubar o aviso dos outros.
    let prox;
    try { prox = proximaPendente(cronograma(a.parcelamento, { valor: a.valor_arrematacao, dataArrematacao: a.data_arrematacao }), hoje); }
    catch (e) { res.falhas++; console.error(`[parcelas-arremate] cronograma ilegível ${a.id}:`, e?.message); continue; }
    const marco = prox ? marcoDe(prox.dias) : null;
    if (marco === null) continue;
    res.no_marco++;
    if (seco) continue;
    const chave = `${a.id}|${prox.idx}|${prox.venc}|${marco}`;
    if (!(await travar(chave))) { res.ja_avisados++; continue; }
    const email = await emailDoUsuario(a.user_id);
    if (!email) { res.sem_email++; await liberar(chave); continue; }
    try {
      // enviarEmail NÃO lança: falha do Resend, suprimido e sem_resend voltam como { ok:false }.
      const env = await enviarEmail({
        from: FROM, to: email, cc: EQUIPE && EQUIPE !== email ? EQUIPE : undefined,
        subject: `${prox.dias < 0 ? 'Parcela em atraso' : 'Lembrete de parcela'}: ${prox.rotulo} — ${dataBR(prox.venc)}`,
        html: corpo({ titulo: a.titulo || 'Imóvel arrematado', prox, penalidade: avisoPenalidade(fonte[a.imovel_id]?.modalidade || a.imovel?.modalidade), processo: fonte[a.imovel_id]?.numero_processo || a.imovel?.numero_processo, link: `${BASE}/arrematados` }),
        meta: { userId: a.user_id, tipo: 'parcela_arremate' },
        idempotencyKey: `parcela_arremate:${chave}`,
      });
      if (env?.ok) res.enviados++;
      else if (env?.enfileirado) res.enfileirados = (res.enfileirados || 0) + 1; // a fila entrega depois
      else throw new Error(env?.error || 'envio sem confirmação');
    } catch (e) {
      res.falhas++;
      console.error(`[parcelas-arremate] envio falhou ${chave}:`, e?.message);
      await liberar(chave); // tenta de novo amanhã — o marco é uma janela, amanhã ainda vale
    }
  }
  console.log('[parcelas-arremate]', JSON.stringify(res));
  return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
