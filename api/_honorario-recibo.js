/**
 * enviarReciboHonorario(arrematacaoId) — e-mail-recibo ao arrematante quando o honorário de
 * êxito fecha (soma dos recebimentos bate o total), discriminando cada parte recebida (Pix,
 * cheque, cartão) e o imóvel da operação. Pedido do dono, 17/09 (caso Marcos: Pix + 3 cheques
 * + saldo no cartão — o cliente precisa de um comprovante da operação inteira, não só do
 * pagamento do cartão que o Mercado Pago manda separado).
 *
 * IDEMPOTÊNCIA: reivindica o envio com um PATCH condicional (`honorarios_recibo_enviado_em
 * IS NULL`) — só quem ganha essa corrida manda o e-mail. Sem isto, um recebimento manual e o
 * webhook do cartão fechando o honorário quase ao mesmo tempo mandariam o recibo em dobro.
 * Chamar sempre em BEST-EFFORT (nunca bloquear a resposta do endpoint que fechou o honorário
 * por causa de uma falha de e-mail).
 */
import { enviarEmail } from './_email.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_URL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

const METODO_LABEL = {
  pix_externo: 'Pix', cheque: 'Cheque', cartao_mp: 'Cartão de crédito',
  dinheiro: 'Dinheiro', transferencia: 'Transferência',
};

const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtData = (d) => d ? new Date(d).toLocaleDateString('pt-BR') : '—';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function sb(path, opts) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
}
async function emailDoUsuario(id) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/admin/users/${id}`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    if (!r.ok) { console.error('[_honorario-recibo] emailDoUsuario: admin/users devolveu', r.status); return null; }
    const d = await r.json();
    return d?.email || null;
  } catch (e) { console.error('[_honorario-recibo] emailDoUsuario falhou:', e?.message || e); return null; }
}

export async function enviarReciboHonorario(arrematacaoId) {
  try {
    const arrRes = await sb(`arrematacoes?id=eq.${arrematacaoId}&select=id,valor_arrematado,honorarios_valor,honorarios_status,honorarios_pago_em,honorarios_recibo_enviado_em,arrematante_id,imovel_id,caso_id`);
    if (!arrRes.ok) { console.error('[_honorario-recibo] leitura da arrematação devolveu', arrRes.status); return { ok: false, motivo: 'leitura_falhou' }; }
    const [arr] = await arrRes.json();
    if (!arr) return { ok: false, motivo: 'arrematacao_nao_encontrada' };
    if (!['pago', 'distribuido'].includes(arr.honorarios_status)) return { ok: false, motivo: 'nao_pago' };
    if (arr.honorarios_recibo_enviado_em) return { ok: false, motivo: 'ja_enviado' };

    // Reivindica o envio ANTES de montar o e-mail — a corrida é aqui, não na hora de chamar
    // a Resend. `select=id` + PATCH condicional: 0 linhas voltando = perdeu a corrida, desiste.
    const claim = await sb(`arrematacoes?id=eq.${arrematacaoId}&honorarios_recibo_enviado_em=is.null`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ honorarios_recibo_enviado_em: new Date().toISOString() }),
    });
    const claimed = claim.ok ? await claim.json().catch(() => []) : [];
    if (!claimed.length) return { ok: false, motivo: 'corrida_perdida' };

    const [recebimentos, imovelR, email] = await Promise.all([
      sb(`honorarios_recebimentos?arrematacao_id=eq.${arrematacaoId}&status=eq.confirmado&order=criado_em.asc&select=metodo,valor,criado_em`).then(r => r.ok ? r.json() : []),
      arr.imovel_id ? sb(`imoveis_leilao?id=eq.${arr.imovel_id}&select=titulo,endereco,cidade`).then(r => r.ok ? r.json() : []) : Promise.resolve([]),
      emailDoUsuario(arr.arrematante_id),
    ]);
    if (!email) return { ok: false, motivo: 'sem_email' };
    const imovel = imovelR[0] || null;

    const linhasHtml = recebimentos.map(r => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#334155">${esc(METODO_LABEL[r.metodo] || r.metodo)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:12px">${fmtData(r.criado_em)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#059669">${fmtBRL(r.valor)}</td>
      </tr>`).join('');

    const html = `<div style="font-family:sans-serif;max-width:560px;margin:0 auto">
      <h2 style="color:#0D63DB">Recibo de pagamento — Honorários de êxito</h2>
      <p>Olá! Confirmamos o pagamento integral dos honorários de êxito referentes à sua arrematação. Segue o discriminativo:</p>
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px 16px;margin:14px 0">
        <div style="font-size:13px;color:#64748b;margin-bottom:4px">Imóvel</div>
        <div style="font-weight:700;color:#111">${esc(imovel?.titulo || 'Imóvel da arrematação')}</div>
        ${imovel?.endereco ? `<div style="font-size:13px;color:#334155;margin-top:2px">${esc(imovel.endereco)}${imovel.cidade ? ', ' + esc(imovel.cidade) : ''}</div>` : ''}
        <div style="font-size:13px;color:#64748b;margin-top:8px">Valor arrematado</div>
        <div style="font-weight:700;color:#111">${fmtBRL(arr.valor_arrematado)}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin:14px 0">
        <thead><tr style="background:#f1f5f9">
          <th style="padding:8px 10px;text-align:left;font-size:12px;color:#64748b">Forma</th>
          <th style="padding:8px 10px;text-align:left;font-size:12px;color:#64748b">Data</th>
          <th style="padding:8px 10px;text-align:right;font-size:12px;color:#64748b">Valor</th>
        </tr></thead>
        <tbody>${linhasHtml}</tbody>
        <tfoot><tr>
          <td colspan="2" style="padding:10px;font-weight:800;color:#111">Total pago</td>
          <td style="padding:10px;text-align:right;font-weight:900;color:#111;font-size:16px">${fmtBRL(arr.honorarios_valor)}</td>
        </tr></tfoot>
      </table>
      <p style="font-size:12px;color:#94a3b8">Pago em ${fmtData(arr.honorarios_pago_em)}. Este recibo é gerado automaticamente pela BidPro Brasil e não substitui nota fiscal, quando aplicável.</p>
      <p style="margin-top:18px"><a href="${APP_URL}" style="color:#0D63DB;font-weight:700">BidPro Brasil →</a></p>
    </div>`;

    const envio = await enviarEmail({
      from: 'BidPro Brasil <noreply@bidprobrasil.com.br>',
      to: [email],
      subject: 'Recibo — Honorários de êxito pagos',
      html,
      meta: { tipo: 'honorario_recibo', userId: arr.arrematante_id },
    });
    return { ok: !!envio?.ok, envio };
  } catch (e) {
    console.error('[_honorario-recibo] falhou:', e?.message || e);
    return { ok: false, motivo: 'erro', erro: String(e?.message || e) };
  }
}
