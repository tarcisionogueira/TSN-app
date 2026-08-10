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

  // ORÇAMENTO DE TEMPO (10/08). `maxDuration` aqui é 60s, mas o laço abaixo é dimensionado para
  // 10.000 offsets: cada cobrança com assinatura custa um GET (`/payments?subscription=`) mais
  // dois DELETE, tudo sequencial — uma única página de 100 pode valer 100-300 chamadas ao Asaas.
  // Sem checagem de deadline, a invocação morria com "Task timed out", `res.status(200)` nunca
  // rodava e o array `erros` (a ÚNICA memória de um DELETE que falhou) sumia junto: a mesma
  // indistinguibilidade entre "falhou" e "nunca rodou" que motivou a correção do backup-r2-cron.
  // Com o corte, a varredura termina sempre e DIZ que ficou pela metade; o run seguinte continua
  // de onde a lista estiver (é idempotente — o que já foi cancelado não reaparece como PENDING).
  const T0 = Date.now();
  const ORCAMENTO_MS = 45000; // de 60s: sobra para responder e registrar
  let cortadoPorTempo = false;
  try {
    for (const status of ['PENDING', 'OVERDUE']) {
      if (cortadoPorTempo) break;
      for (let offset = 0; offset < 10000; offset += 100) {
        if (Date.now() - T0 > ORCAMENTO_MS) { cortadoPorTempo = true; break; }
        const url = `/payments?status=${status}&dateCreated%5Ble%5D=${cutoffData}&limit=100&offset=${offset}`;
        const data = await asaasGet(url);
        const results = data?.data || [];
        if (!results.length) break;

        for (const p of results) {
          if (Date.now() - T0 > ORCAMENTO_MS) { cortadoPorTempo = true; break; }
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

        if (cortadoPorTempo || !data?.hasMore) break;
      }
    }
  } catch (e) {
    res.status(500).json({ error: e.message, parcial: { assinaturasCanceladas, cobrancasRemovidas, avulsasRemovidas } });
    return;
  }

  res.status(200).json({
    ok: true, vistos, assinaturasCanceladas, cobrancasRemovidas, avulsasRemovidas,
    // `completo: false` = a varredura NÃO alcançou o fim da lista. Sem este campo, um run
    // cortado no meio se lia exatamente como um run que não tinha nada a fazer.
    completo: !cortadoPorTempo, cortado_por_tempo: cortadoPorTempo,
    ignoradasPagas, indeterminados, erros: erros.slice(0, 20),
  });
}
