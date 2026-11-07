/**
 * /api/inter-cobrancas-cron — a cada 10 min: reconsulta no Inter as cobranças (Pix/boleto) ainda sem baixa e
 * aplica a baixa do que foi pago. É a rede de segurança do webhook (que pode não chegar) e da tela (que o
 * pagador pode fechar). Também registra a URL do webhook no Inter uma vez (fica anotado em app_config).
 * Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };
import { isCronAuthorized } from './_auth.js';
import { inter, interConfigurado } from './_inter.js';
import { atualizar, sb, SITUACOES_MORTAS } from './_inter-cobranca.js';

const ORCAMENTO_MS = 45000;
// O endereço do webhook vai SEMPRE com www: bidprobrasil.com.br responde 308 para o www, e um aviso bancário que não
// segue redirecionamento se perderia (07/11). Mudou o valor, a rotina recadastra sozinha.
const WEBHOOK_URL = 'https://www.bidprobrasil.com.br/api/inter-webhook';

async function registrarWebhookUmaVez() {
  const chave = 'inter_cobranca_webhook';
  const r = await sb(`app_config?key=eq.${chave}&select=value&limit=1`);
  if (!r.ok) return { erro: `leitura app_config HTTP ${r.status}` };
  const url = WEBHOOK_URL;
  const [c] = await r.json();
  if (String(c?.value || '') === url) return { ja: true };
  const w = await inter('PUT', '/cobranca/v3/cobrancas/webhook', { webhookUrl: url });
  if (!w.ok) return { erro: `Inter recusou o webhook: ${w.status} ${w.erro}` };
  const g = await sb('app_config', { method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { key: chave, value: url } });
  return g.ok ? { registrado: url } : { erro: `gravar app_config HTTP ${g.status}` };
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!interConfigurado()) return res.status(200).json({ ok: true, pulado: 'sem credencial do Inter' });
  const t0 = Date.now();
  try {
    const webhook = await registrarWebhookUmaVez().catch((e) => ({ erro: e.message }));
    if (webhook.erro) console.error('[inter-cobrancas-cron] webhook', webhook.erro);

    const desde = new Date(Date.now() - 40 * 86400e3).toISOString();
    const r = await sb(`inter_cobrancas?baixa_aplicada_em=is.null&codigo_solicitacao=not.is.null&situacao=not.in.(${SITUACOES_MORTAS.join(',')})&criado_em=gte.${desde}&order=consultado_em.asc.nullsfirst&limit=40`);
    if (!r.ok) throw new Error(`leitura HTTP ${r.status}`);
    const abertas = await r.json();
    let consultadas = 0, baixas = 0, falhas = 0, cortado = false;
    for (const linha of abertas) {
      if (Date.now() - t0 > ORCAMENTO_MS) { cortado = true; break; }
      const { linha: atual, erro } = await atualizar(linha);
      consultadas++;
      if (erro) falhas++;
      if (atual?.baixa_aplicada_em && !linha.baixa_aplicada_em) baixas++;
    }
    const out = { ok: true, abertas: abertas.length, consultadas, baixas, falhas, cortado, webhook };
    console.log('[inter-cobrancas-cron]', JSON.stringify(out));
    return res.status(200).json(out);
  } catch (e) {
    console.error('[inter-cobrancas-cron]', e?.message || e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
