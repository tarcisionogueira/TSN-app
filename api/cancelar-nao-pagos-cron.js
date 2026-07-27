/**
 * /api/cancelar-nao-pagos-cron — cancela cobranças/assinaturas Asaas NÃO PAGAS em 24h.
 *
 * Motivo: o checkout cria a assinatura recorrente no Asaas (POST /subscriptions com
 * nextDueDate=hoje) ANTES da confirmação do pagamento. Se o cliente abandona o
 * checkout, o Asaas segue gerando cobranças (boleto/pix) e, por ser assinatura,
 * ainda emite a cobrança do mês seguinte — foi o e-mail de cobrança indevida que o
 * usuário recebeu. Regra de negócio: pagamento não realizado em 24h é cancelado.
 *
 * O que faz (idempotente, best-effort):
 *  - Varre as cobranças PENDING/OVERDUE criadas há mais de 24h.
 *  - Cobrança de ASSINATURA cujo cliente NUNCA teve pagamento pago (RECEIVED/
 *    CONFIRMED) → abandono: DELETE /subscriptions/{id} (mata a recorrência) e
 *    remove a cobrança em aberto. NÃO toca em assinatura com algum pagamento pago
 *    (cliente ativo — a cobrança pendente é a mensalidade legítima do mês).
 *  - Cobrança AVULSA (à vista, sem assinatura) não paga em 24h → DELETE /payments/{id}.
 *
 * Roda de 6/6h (vercel.json). Autorizado por CRON_SECRET (Authorization: Bearer).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();

// Mesmos status "pago" usados em verificar-pagamento.js (RECEIVED_IN_CASH = baixa manual).
const STATUS_PAGO = new Set(['RECEIVED', 'CONFIRMED', 'RECEIVED_IN_CASH']);
const HORAS_LIMITE = 24;

async function asaas(path, opts = {}) {
  return fetch(`${ASAAS_URL}${path}`, {
    ...opts,
    headers: { access_token: ASAAS_KEY, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function asaasGet(path) {
  const r = await asaas(path);
  return r.ok ? r.json() : null;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!ASAAS_KEY) { res.status(500).json({ error: 'ASAAS_API_KEY ausente' }); return; }

  // dateCreated do Asaas é DATA (YYYY-MM-DD). Cortamos por (hoje - 24h): só cobranças
  // criadas ATÉ essa data entram (garante ≥24h — nunca cancela cobrança do dia).
  const cutoff = new Date(Date.now() - HORAS_LIMITE * 3600 * 1000);
  const cutoffData = cutoff.toISOString().slice(0, 10);

  const subCache = new Map();     // subId → tem pagamento pago?
  const subCanceladas = new Set();
  let vistos = 0, assinaturasCanceladas = 0, cobrancasRemovidas = 0, avulsasRemovidas = 0, ignoradasPagas = 0, indeterminados = 0;
  const erros = [];

  // Retorna true (tem pago) / false (zero pagos confirmado) / null (consulta FALHOU).
  // Fail-closed: só cachea um resultado REAL — nunca cachea (nem age sobre) uma consulta
  // que falhou, para não cancelar pagante por instabilidade transitória do Asaas.
  const subTemPagamento = async (subId) => {
    if (subCache.has(subId)) return subCache.get(subId);
    const r = await asaas(`/payments?subscription=${subId}&limit=100`);
    if (!r.ok) return null;                       // consulta falhou → indeterminado
    const d = await r.json().catch(() => null);
    if (!d || !Array.isArray(d.data)) return null; // resposta inesperada → indeterminado
    const pago = d.data.some(p => STATUS_PAGO.has(p.status));
    subCache.set(subId, pago);
    return pago;
  };

  try {
    for (const status of ['PENDING', 'OVERDUE']) {
      for (let offset = 0; offset < 10000; offset += 100) {
        const url = `/payments?status=${status}&dateCreated%5Ble%5D=${cutoffData}&limit=100&offset=${offset}`;
        const data = await asaasGet(url);
        const results = data?.data || [];
        if (!results.length) break;

        for (const p of results) {
          vistos++;
          if (STATUS_PAGO.has(p.status)) continue; // sanidade

          if (p.subscription) {
            // Cliente ativo (já pagou alguma cobrança dessa assinatura) → não mexe:
            // a cobrança pendente é a mensalidade legítima, não um abandono. FAIL-CLOSED:
            // se a consulta ao Asaas falhou (null), não dá para confirmar abandono → pula
            // e reavalia no próximo ciclo (nunca cancela pagante por instabilidade da API).
            const temPg = await subTemPagamento(p.subscription);
            if (temPg === null) { indeterminados++; continue; }
            if (temPg) { ignoradasPagas++; continue; }
            // Abandono: cancela a assinatura inteira (para de gerar cobranças).
            if (!subCanceladas.has(p.subscription)) {
              const dr = await asaas(`/subscriptions/${p.subscription}`, { method: 'DELETE' });
              if (dr.ok) { assinaturasCanceladas++; subCanceladas.add(p.subscription); }
              else erros.push(`sub ${p.subscription}: HTTP ${dr.status}`);
            }
            // Remove a cobrança em aberto (o DELETE da assinatura já limpa as futuras;
            // este é best-effort para a fatura já emitida — 404 é esperado e ok).
            const pd = await asaas(`/payments/${p.id}`, { method: 'DELETE' });
            if (pd.ok) cobrancasRemovidas++;
          } else {
            // Cobrança avulsa (à vista) abandonada há mais de 24h → remove.
            const pd = await asaas(`/payments/${p.id}`, { method: 'DELETE' });
            if (pd.ok) avulsasRemovidas++;
            else erros.push(`avulsa ${p.id}: HTTP ${pd.status}`);
          }
        }

        if (!data?.hasMore) break;
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message, parcial: { assinaturasCanceladas, cobrancasRemovidas, avulsasRemovidas } });
    return;
  }

  res.status(200).json({
    ok: true, vistos, assinaturasCanceladas, cobrancasRemovidas, avulsasRemovidas,
    ignoradasPagas, indeterminados, erros: erros.slice(0, 20),
  });
}
