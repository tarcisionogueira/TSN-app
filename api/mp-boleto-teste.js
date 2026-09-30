/**
 * POST /api/mp-boleto-teste  (só com CRON_SECRET — disparado pelo workflow mp-boleto-teste.yml)
 *
 * TESTE DE LIMITE DO BOLETO NA NOSSA CONTA (30/09, pedido do dono). O app do MP ("Cobrar") limita
 * o boleto a R$ 10 mil; a API (`/v1/payment_methods`) informa R$ 100 mil para `bolbradesco` — mas
 * esse número é de CATÁLOGO, não garante o da conta. A única prova é emitir: este endpoint emite UM
 * boleto do valor pedido e CANCELA na mesma chamada (taxa só existe se for pago; cancelado não pode
 * ser pago). Devolve o que o MP respondeu, inclusive a recusa — que é justamente a resposta.
 *
 * gateway='asaas' (30/09): o mesmo teste no Asaas — a doc diz até R$ 500 mil (conta PJ), mas há
 * relato de limite da CONTA diferente do site. Cria cliente de teste, emite boleto, apaga os dois.
 *
 * Pagador = a própria empresa (dados públicos do rodapé). Se o MP recusar por pagador = recebedor,
 * a mensagem diz isso e o teste é refeito com outro pagador — não é "limite".
 */
import { isCronAuthorized } from './_auth.js';

const MP = 'https://api.mercadopago.com';
const TETO_TESTE = 600000;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'use POST' });
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'não autorizado' });
  const token = (process.env.MP_ACCESS_TOKEN || '').trim();
  if (!token) return res.status(500).json({ error: 'MP_ACCESS_TOKEN ausente' });
  const valor = Math.round(Number(req.body?.valor) * 100) / 100;
  if (!(valor > 0) || valor > TETO_TESTE) return res.status(400).json({ error: `valor entre 0 e ${TETO_TESTE}` });
  if (req.body?.gateway === 'asaas') return testarAsaas(valor, res);

  const venc = new Date(Date.now() + 3 * 86400e3).toISOString().replace('Z', '-03:00').replace(/\.\d+-03:00$/, '.000-03:00');
  const payload = {
    transaction_amount: valor,
    description: 'TESTE INTERNO de limite de boleto — cancelado automaticamente',
    payment_method_id: 'bolbradesco',
    date_of_expiration: venc,
    external_reference: 'teste-boleto-limite',
    metadata: { tipo: 'teste_limite' },
    payer: {
      email: 'teste-boleto@bidprobrasil.com.br',
      first_name: 'Nogueira', last_name: 'Empreendimentos LTDA',
      identification: { type: 'CNPJ', number: '02311492000161' },
      address: { zip_code: '44056536', street_name: 'Rua Barra Avenida', street_number: 'SN', neighborhood: 'Mangabeira', city: 'Feira de Santana', federal_unit: 'BA' },
    },
  };
  const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let criado, status;
  try {
    const r = await fetch(`${MP}/v1/payments`, { method: 'POST', headers: { ...h, 'X-Idempotency-Key': `teste-boleto-${valor}-${Date.now()}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(25000) });
    status = r.status;
    criado = await r.json().catch(() => ({}));
  } catch (e) {
    return res.status(502).json({ etapa: 'emitir', erro: String(e?.message || e) });
  }
  if (!criado?.id) {
    // RECUSA do MP = a resposta do teste (ex.: valor acima do permitido). Devolve sem enfeitar.
    return res.status(200).json({ valor, emitiu: false, http: status, mensagem: criado?.message, causa: criado?.cause });
  }
  let cancelado = null;
  try {
    const c = await fetch(`${MP}/v1/payments/${criado.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ status: 'cancelled' }), signal: AbortSignal.timeout(25000) });
    const cj = await c.json().catch(() => ({}));
    cancelado = { http: c.status, status: cj?.status || null, mensagem: c.ok ? null : cj?.message };
  } catch (e) {
    cancelado = { erro: String(e?.message || e) }; // o boleto vence em 3 dias sozinho; o log manda cancelar à mão
  }
  return res.status(200).json({ valor, emitiu: true, payment_id: criado.id, status_emissao: criado.status, detalhe: criado.status_detail, cancelado });
}

// ── Asaas: cliente de teste → boleto → apaga boleto → apaga cliente. Recusa = a resposta do teste.
async function testarAsaas(valor, res) {
  const key = (process.env.ASAAS_API_KEY || '').trim();
  if (!key) return res.status(500).json({ error: 'ASAAS_API_KEY ausente' });
  const base = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
  const h = { access_token: key, 'Content-Type': 'application/json' };
  const chamar = async (metodo, path, body) => {
    const r = await fetch(`${base}${path}`, { method: metodo, headers: h, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(25000) });
    return { http: r.status, j: await r.json().catch(() => ({})) };
  };
  const cli = await chamar('POST', '/customers', { name: 'TESTE INTERNO limite de boleto', cpfCnpj: '02311492000161', email: 'teste-boleto@bidprobrasil.com.br',
    postalCode: '44056536', address: 'Rua Barra Avenida', addressNumber: 'SN', province: 'Mangabeira', notificationDisabled: true });
  if (!cli.j?.id) return res.status(200).json({ gateway: 'asaas', etapa: 'cliente', http: cli.http, erros: cli.j?.errors });
  const venc = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);
  const pag = await chamar('POST', '/payments', { customer: cli.j.id, billingType: 'BOLETO', value: valor, dueDate: venc,
    description: 'TESTE INTERNO de limite de boleto — apagado automaticamente', externalReference: 'teste-boleto-limite' });
  const apagarPag = pag.j?.id ? await chamar('DELETE', `/payments/${pag.j.id}`) : null;
  const apagarCli = await chamar('DELETE', `/customers/${cli.j.id}`);
  return res.status(200).json({
    gateway: 'asaas', ambiente: base.includes('sandbox') ? 'sandbox' : 'producao', valor,
    emitiu: !!pag.j?.id, http: pag.http, payment_id: pag.j?.id || null, status_emissao: pag.j?.status || null, erros: pag.j?.errors || null,
    apagado: apagarPag ? { http: apagarPag.http, deleted: apagarPag.j?.deleted ?? null } : null,
    cliente_apagado: { http: apagarCli.http, deleted: apagarCli.j?.deleted ?? null },
  });
}
