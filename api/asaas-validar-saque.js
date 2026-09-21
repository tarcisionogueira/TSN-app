/**
 * POST /api/asaas-validar-saque — Webhook de "Mecanismo para validação de saque"
 * (Asaas → nosso servidor, Menu do usuário > Integrações > Mecanismos de segurança).
 *
 * Segunda camada de segurança pro saque PIX (pedido do dono, 21/09): mesmo com a chave de
 * API correta, o Asaas só EXECUTA a transferência depois que respondemos aprovando. O
 * Asaas chama esta URL ~5s depois de `POST /transfers` (api/asaas.js::transferir_pix) com
 * o payload da operação; respondemos { status: 'APPROVED' } ou { status: 'REFUSED',
 * refuseReason }. Timeout ou 3 falhas seguidas = Asaas cancela a operação sozinho
 * (fail-closed do lado deles).
 *
 * REGRA DE OURO da doc oficial: "não aprove uma operação apenas porque o payload tem
 * estrutura válida" — comparamos contra o registro que NÓS gravamos ANTES de pedir a
 * transferência (`asaas_transferencias_pendentes`, inserido em asaas.js::transferir_pix).
 * Sem esse registro prévio, não há o que comparar — e por isso é fail-closed: qualquer
 * coisa que não bater exatamente é recusada.
 *
 * Único tipo de operação que este sistema de fato inicia via API é TRANSFER (saque PIX
 * de comissão). Qualquer outro tipo (BILL, PIX_QR_CODE, MOBILE_PHONE_RECHARGE,
 * PIX_REFUND) nunca foi pedido por nós — se aparecer, é recusado sem exceção (mesmo
 * princípio: "não aprove operações desconhecidas").
 */
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_TOKEN = process.env.ASAAS_SAQUE_WEBHOOK_TOKEN;

const json = (status, refuseReason) => new Response(
  JSON.stringify(refuseReason ? { status, refuseReason } : { status }),
  { status: 200, headers: { 'Content-Type': 'application/json' } }
);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // Token opcional na doc do Asaas, mas obrigatório aqui: sem ele, qualquer chamada não
  // autenticada poderia tentar aprovar transferências (fail-closed).
  const token = req.headers.get('asaas-access-token');
  if (!WEBHOOK_TOKEN || !token || token !== WEBHOOK_TOKEN) {
    return json('REFUSED', 'Token de autenticação ausente ou inválido.');
  }

  let body;
  try { body = await req.json(); } catch (e) { console.error('[asaas-validar-saque] payload inválido:', e?.message || e); return json('REFUSED', 'Payload inválido.'); }

  const tipo = body?.type;
  if (tipo !== 'TRANSFER') {
    // Este sistema nunca inicia BILL/PIX_QR_CODE/MOBILE_PHONE_RECHARGE/PIX_REFUND via API —
    // qualquer um desses chegando aqui é uma operação que NÃO partiu daqui.
    return json('REFUSED', `Tipo de operação "${tipo || 'desconhecido'}" não é iniciado por este sistema.`);
  }

  const transfer = body?.transfer;
  const transferId = transfer?.id;
  const valor = Number(transfer?.value);
  const chavePix = transfer?.bankAccount?.pixAddressKey || null;
  if (!transferId || !Number.isFinite(valor)) {
    return json('REFUSED', 'Payload de transferência incompleto.');
  }

  if (!SUPABASE_URL || !SVC) return json('REFUSED', 'Configuração do servidor ausente.');

  let registro;
  try {
    const r = await sb(`asaas_transferencias_pendentes?asaas_transfer_id=eq.${encodeURIComponent(transferId)}&select=*&limit=1`);
    if (!r.ok) return json('REFUSED', 'Não foi possível consultar o registro da transferência.');
    [registro] = await r.json();
  } catch (e) {
    console.error('[asaas-validar-saque] falha ao consultar registro:', e?.message || e);
    return json('REFUSED', 'Falha ao consultar o registro da transferência.');
  }

  if (!registro) return json('REFUSED', 'Transferência não encontrada no nosso banco.');

  // Já validada antes (retry do Asaas, ou nova tentativa): responde o MESMO resultado, não
  // reprocessa — evita aprovação duplicada (recomendação explícita da doc do Asaas).
  if (registro.validado_em && registro.resultado) {
    return json(registro.resultado, registro.resultado === 'REFUSED' ? 'Já processada anteriormente.' : undefined);
  }

  // Compara com o que NÓS pedimos — tolerância de 1 centavo pro valor por causa de ponto
  // flutuante indo e voltando entre JS e o JSON do Asaas.
  const valorBate = Math.abs(Number(registro.valor) - valor) < 0.01;
  const chaveBate = !registro.chave_pix || !chavePix || registro.chave_pix === chavePix;
  const aprovado = valorBate && chaveBate;
  const resultado = aprovado ? 'APPROVED' : 'REFUSED';
  const motivo = !valorBate
    ? `Valor divergente: pedimos R$${registro.valor}, o Asaas confirma R$${valor}.`
    : !chaveBate
      ? 'Chave PIX de destino divergente da que registramos.'
      : undefined;

  try {
    await sb(`asaas_transferencias_pendentes?asaas_transfer_id=eq.${encodeURIComponent(transferId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ validado_em: new Date().toISOString(), resultado }),
    });
  } catch { /* best-effort: se o PATCH falhar, a decisão já foi tomada e respondida abaixo */ }

  return json(resultado, motivo);
}
