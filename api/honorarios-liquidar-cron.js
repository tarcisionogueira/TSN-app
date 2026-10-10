/**
 * /api/honorarios-liquidar-cron — repasse automático do honorário de êxito (10/10, pedido do dono).
 *
 * Todo dia: para cada arrematação com honorário PAGO e ainda não distribuído por inteiro, relê o
 * líquido de cada recebimento (o cartão do Asaas compensa ~D+30; o cheque, quando compensa) e
 * credita no saldo de advogado/parceiro/admin o que ficou disponível desde a última vez
 * (regra honorario.split_sobre_liquido — a conta é do banco, em honorario_liquidar).
 *
 * Só entra arrematação COM advogado vinculado, ou já FINALIZADA (o admin confirmou sem advogado):
 * sem advogado, a fatia do jurídico iria toda para o admin e não volta — é a mesma trava da tela
 * de finalização (api/arrematacoes.js).
 *
 * Avisa o admin por e-mail quando credita algo ou quando um líquido não pôde ser lido (aí nada é
 * creditado — repassar sobre o bruto pagaria mais do que entrou). `?seco=1` só calcula.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { liquidarHonorario } from './_honorario-liquidacao.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM         = process.env.APP_ALERTS_FROM || 'BidPro Brasil <alertas@bidprobrasil.com.br>';
const ADMIN        = process.env.ADMIN_ALERT_EMAIL || null;

async function db(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: {
    apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const seco = new URL(req.url, BASE).searchParams.get('seco') === '1';
  const lista = await db('arrematacoes?honorarios_status=eq.pago&or=(advogado_id.not.is.null,status.eq.finalizado)&select=id,valor_arrematado,honorarios_status,advogado_id,analista_id,arrematante_id,status');
  if (!lista.ok || !Array.isArray(lista.data)) {
    console.error('[honorarios-liquidar] leitura HTTP', lista.status);
    return new Response(JSON.stringify({ ok: false, erro: `leitura HTTP ${lista.status}` }), { status: 500 });
  }
  const res = { arrematacoes: lista.data.length, creditado: 0, falhas: [], detalhes: [], seco };
  for (const arr of lista.data) {
    try {
      const r = await liquidarHonorario(db, arr, { seco });
      res.creditado += Number(r.creditado_agora || 0);
      res.detalhes.push({ id: arr.id, creditado_agora: r.creditado_agora, resta_a_repassar: r.resta_a_repassar, falta_compensar: r.falta_compensar, liquido_desconhecido: r.liquido_desconhecido, linhas: r.linhas });
      for (const f of r.falhas_liquido || []) res.falhas.push({ arrematacao: arr.id, ...f });
    } catch (e) {
      console.error('[honorarios-liquidar]', arr.id, e?.message);
      res.falhas.push({ arrematacao: arr.id, erro: String(e?.message || e).slice(0, 200) });
    }
  }
  if (!seco && ADMIN && (res.creditado > 0 || res.falhas.length)) {
    const linhas = res.detalhes.filter((d) => d.creditado_agora > 0).flatMap((d) => (d.linhas || []).filter((l) => l.creditar_agora > 0)
      .map((l) => `<li>${esc(l.papel)} ${esc(l.nome || '')}: <b>${brl(l.creditar_agora)}</b> (arremate ${esc(d.id.slice(0, 8))})</li>`));
    const falhas = res.falhas.map((f) => `<li>${esc(f.arrematacao.slice(0, 8))} · ${esc(f.metodo || '')} ${esc(f.erro)}</li>`);
    const env = await enviarEmail({
      from: FROM, to: ADMIN,
      subject: res.creditado > 0 ? `Honorário de êxito: ${brl(res.creditado)} creditado(s) automaticamente` : 'Honorário de êxito: líquido não lido — repasse parado',
      html: `<div style="font-family:Arial,sans-serif;max-width:600px">${linhas.length ? `<p>Repasse creditado no saldo (sobre o líquido recebido):</p><ul>${linhas.join('')}</ul>` : ''}`
        + `${falhas.length ? `<p style="color:#b91c1c">Não foi possível ler o líquido — nada foi creditado nessas operações:</p><ul>${falhas.join('')}</ul>` : ''}</div>`,
      meta: { tipo: 'honorario_liquidacao' },
    });
    if (!env?.ok) console.error('[honorarios-liquidar] aviso ao admin não saiu:', env?.error);
  }
  console.log('[honorarios-liquidar]', JSON.stringify({ ...res, detalhes: res.detalhes.length }));
  return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
