/**
 * /api/resend-webhook — recebe eventos do Resend (entrega/abertura/clique) e atualiza
 * emails_log para o Cliente 360 mostrar se o e-mail foi lido.
 *
 * Auth: query secret ?k=<RESEND_WEBHOOK_SECRET> (configure a URL do webhook no Resend com o
 * secret). Sem o secret, aceita mas só toca linhas que já existem (resend_id) — baixo impacto.
 * Só atualiza metadados de e-mails que NÓS enviamos (match por resend_id).
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SECRET = process.env.RESEND_WEBHOOK_SECRET;

export default async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(200).json({ ok: true, service: 'resend-webhook', hint: 'Configure a URL deste endpoint no Resend (com ?k=<secret>).' });
  }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  if (SECRET) {
    let k = null;
    try { k = new URL(req.url, 'http://x').searchParams.get('k'); } catch { /* url malformada */ }
    if (k !== SECRET) { res.status(401).end(); return; }
  }

  try {
    const b = req.body || {};
    const tipo = b.type || '';
    const emailId = b.data?.email_id || b.data?.id || null;
    const at = b.created_at || new Date().toISOString();
    if (emailId && SB && KEY) {
      const patch = async (campo, cond = '') => {
        await fetch(`${SB}/rest/v1/emails_log?resend_id=eq.${encodeURIComponent(emailId)}${cond}`, {
          method: 'PATCH',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
          body: JSON.stringify(campo), signal: AbortSignal.timeout(4000),
        }).catch(() => {});
      };
      if (tipo === 'email.delivered') await patch({ entregue_em: at, status: 'entregue' }, '&entregue_em=is.null');
      else if (tipo === 'email.opened') await patch({ aberto_em: at }, '&aberto_em=is.null');
      else if (tipo === 'email.clicked') await patch({ clicado_em: at }, '&clicado_em=is.null');
      else if (tipo === 'email.bounced') await patch({ status: 'bounce' });
      else if (tipo === 'email.complained') await patch({ status: 'reclamacao' });

      // REGISTRA O TIPO QUE CHEGOU — mesmo o que não sabemos tratar (11/08).
      // Sem isto, `aberturas = 0` tem DUAS leituras que não se distinguem: "ninguém abriu"
      // e "o Resend não está nos mandando `email.opened`". A segunda é problema de
      // configuração e some da vista, porque parece resultado. Com o carimbo do evento dá
      // para responder em uma query: se `email.opened` NUNCA chegou, o webhook não está
      // inscrito nesse evento; se chega e a coluna segue nula, aí sim é comportamento real.
      await fetch(`${SB}/rest/v1/webhook_eventos_processados`, {
        method: 'POST',
        headers: {
          apikey: KEY, Authorization: `Bearer ${KEY}`,
          'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal',
        },
        body: JSON.stringify({ gateway: 'resend', gateway_payment_id: emailId, evento: tipo }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => {});
    }
  } catch { /* nunca falha o webhook */ }
  res.status(204).end();
}
