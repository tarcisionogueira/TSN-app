/**
 * GET /api/asaas-consultar-cobranca?id=<payment_id>  (admin apenas)
 *
 * Diagnóstico do pedido do dono (21/09, HANDOFF): confirmar se dá pra saber "está a
 * receber e quando libera" direto pela API do Asaas, sem abrir o painel. A doc oficial
 * (docs.asaas.com) cita `creditDate`/`estimatedCreditDate` no objeto de cobrança, mas o
 * sandbox de desenvolvimento não tem ASAAS_API_KEY nem acesso à doc completa (bloqueio de
 * rede) — não dá pra confirmar o SIGNIFICADO exato de cada campo sem ler uma resposta real.
 * Este endpoint só faz o GET cru na cobrança e devolve o JSON como o Asaas mandou, pro
 * admin ler ao vivo (com a chave que já existe em produção) antes de qualquer código
 * interpretar esses campos. Puramente leitura — não grava nada, não decide nada.
 *
 * Devolve também o pagamento formatado (installment/dueDate/status) e, quando o Asaas
 * também tiver um registro de ANTECIPAÇÃO pra esta cobrança, os dados dela junto — a
 * pergunta do dono era "confirma se antecipou e quando libera", e a resposta pode estar
 * em qualquer um dos dois objetos dependendo do caso.
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox'
  ? 'https://api-sandbox.asaas.com/v3'
  : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

async function asaasGet(path) {
  const r = await fetch(`${ASAAS_URL}${path}`, { headers: { access_token: ASAAS_KEY } });
  const corpo = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, corpo };
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  const rPerfil = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!rPerfil.ok) return res.status(502).json({ error: 'Não consegui checar seu perfil' });
  const [perfil] = await rPerfil.json();
  if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });

  if (!ASAAS_KEY) return res.status(500).json({ error: 'ASAAS_API_KEY ausente' });
  const id = String(req.query?.id || '').trim();
  if (!/^pay_[a-zA-Z0-9]+$/.test(id)) {
    return res.status(400).json({ error: 'Informe ?id=pay_XXXXXXXXXXXX (o id da cobrança no Asaas — visível no painel Asaas ou no webhook recebido)' });
  }

  const pagamento = await asaasGet(`/payments/${encodeURIComponent(id)}`);
  if (!pagamento.ok) {
    return res.status(pagamento.status === 404 ? 404 : 502).json({ error: 'Asaas não respondeu com a cobrança', detalhe: pagamento.corpo });
  }

  // Antecipação: só existe endpoint dedicado se a cobrança tiver sido antecipada
  // (`GET /payments/{id}/anticipations` — doc do Asaas). 404/erro aqui é NORMAL (cobrança
  // sem antecipação) — não é falha do diagnóstico, por isso não derruba a resposta.
  const antecipacoes = await asaasGet(`/payments/${encodeURIComponent(id)}/anticipations`);

  return res.status(200).json({
    cobranca_crua: pagamento.corpo,
    campos_de_liberacao: {
      status: pagamento.corpo?.status ?? null,
      creditDate: pagamento.corpo?.creditDate ?? null,
      estimatedCreditDate: pagamento.corpo?.estimatedCreditDate ?? null,
      dueDate: pagamento.corpo?.dueDate ?? null,
      clientPaymentDate: pagamento.corpo?.clientPaymentDate ?? null,
      anticipated: pagamento.corpo?.anticipated ?? null,
      anticipable: pagamento.corpo?.anticipable ?? null,
    },
    antecipacoes: antecipacoes.ok ? antecipacoes.corpo : { nao_encontrado_ou_sem_antecipacao: antecipacoes.corpo },
  });
}
