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
    const at = b.created_at || new Date().toISOString();

    // ─── QUAL É O ID DO E-MAIL NESTE EVENTO? (18/08, medido) ─────────────────────
    // Medição de 18/08, com uma semana de eventos reais: `delivered` casou 89 de 115,
    // `opened` 33 de 58, `bounced` 2 de 2 — e **`clicked` ZERO de 9**. Zero absoluto, em
    // cinco dias diferentes, não é retenção nem coincidência: o identificador que eu
    // extraía do evento de CLIQUE não é o id do e-mail. `email_id || id` funciona para os
    // outros porque neles o `id` É o e-mail; no clique o `id` é do próprio evento.
    //
    // Em vez de adivinhar a chave certa, tentamos as conhecidas EM ORDEM e — se nenhuma
    // casar — gravamos o diagnóstico (abaixo). Uma tentativa de adivinhação a mais custaria
    // outra semana de espera para descobrir que errei de novo.
    const cands = [b.data?.email_id, b.data?.emailId, b.data?.email?.id, b.data?.id, b.email_id]
      .filter((x) => typeof x === 'string' && x.length > 8);
    const emailId = cands[0] || null;

    if (emailId && SB && KEY) {
      // `return=representation` não é estilo: é o que faz o PATCH DIZER quantas linhas
      // alcançou. Com `return=minimal` um PATCH que não encontra nada devolve 204 —
      // exatamente igual a um que funcionou. Foi assim que 9 cliques sumiram sem um erro.
      const patch = async (campo, cond = '') => {
        for (const cand of cands) {
          try {
            const r = await fetch(`${SB}/rest/v1/emails_log?resend_id=eq.${encodeURIComponent(cand)}${cond}`, {
              method: 'PATCH',
              headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify(campo), signal: AbortSignal.timeout(4000),
            });
            if (r.ok) {
              const linhas = await r.json().catch(() => []);
              if (Array.isArray(linhas) && linhas.length) return true;   // achou e carimbou
            }
          } catch { /* tenta o próximo candidato */ }
        }
        return false;
      };

      let casou = null;   // null = evento que não carimba nada (não é falha)
      if (tipo === 'email.delivered') casou = await patch({ entregue_em: at, status: 'entregue' }, '&entregue_em=is.null');
      else if (tipo === 'email.opened') casou = await patch({ aberto_em: at }, '&aberto_em=is.null');
      else if (tipo === 'email.clicked') casou = await patch({ clicado_em: at }, '&clicado_em=is.null');
      else if (tipo === 'email.bounced') casou = await patch({ status: 'bounce' });
      else if (tipo === 'email.complained') casou = await patch({ status: 'reclamacao' });

      // NÃO ACHOU A LINHA: registra as CHAVES do payload em vez de sumir em silêncio.
      // Só as chaves e o tamanho — nunca o conteúdo, que traz endereço de cliente. Com isso,
      // o PRÓXIMO clique não casado responde qual campo usar, sem esperar outra semana.
      if (casou === false) {
        const chaves = Object.keys(b.data || {}).slice(0, 20).join(',');
        await fetch(`${SB}/rest/v1/webhook_eventos_processados`, {
          method: 'POST',
          headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
          body: JSON.stringify({ gateway: 'resend', gateway_payment_id: emailId, evento: `${tipo}:sem_match:${chaves}`.slice(0, 200) }),
          signal: AbortSignal.timeout(4000),
        }).catch(() => {});
      }

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
