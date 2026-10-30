/**
 * /api/resend-webhook — recebe eventos do Resend (entrega/abertura/clique) e atualiza
 * emails_log para o Cliente 360 mostrar se o e-mail foi lido.
 *
 * Auth: query secret ?k=<RESEND_WEBHOOK_SECRET> (configure a URL do webhook no Resend com o
 * secret). Sem o secret, aceita mas só toca linhas que já existem (resend_id) — baixo impacto.
 * Só atualiza metadados de e-mails que NÓS enviamos (match por resend_id).
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

import { timingSafeEqualStr } from './_auth.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const SECRET = process.env.RESEND_WEBHOOK_SECRET;
const RESEND_KEY = process.env.RESEND_API_KEY;

const sbHeaders = () => ({ apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
const enderecoDe = (s) => (String(s || '').match(/<([^>]+)>/)?.[1] || String(s || '')).trim().toLowerCase();
const lista = (v) => (Array.isArray(v) ? v : v ? [v] : []).map(enderecoDe).filter(Boolean);

// Espelha em `email_caixa` (Enviados) um envio que não passou pelo app. Ver o chamador.
async function espelharEnvioNaCaixa(emailId, tipo, at) {
  if (!RESEND_KEY) { console.error('[resend-webhook] espelho: RESEND_API_KEY ausente'); return; }
  try {
    const ja = await fetch(`${SB}/rest/v1/email_caixa?resend_email_id=eq.${encodeURIComponent(emailId)}&select=id&limit=1`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(4000) });
    const linhas = ja.ok ? await ja.json().catch(() => null) : null;
    if (!Array.isArray(linhas)) { console.error('[resend-webhook] espelho: checagem HTTP', ja.status); return; }
    if (linhas.length) return;

    const r = await fetch(`https://api.resend.com/emails/${encodeURIComponent(emailId)}`,
      { headers: { Authorization: `Bearer ${RESEND_KEY}` }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) { console.error('[resend-webhook] espelho: Resend HTTP', r.status); return; }
    const em = await r.json().catch(() => null);
    if (!em?.from) { console.error('[resend-webhook] espelho: e-mail sem remetente no Resend'); return; }

    const de = enderecoDe(em.from);
    const eq = await fetch(`${SB}/rest/v1/equipe_email?endereco=eq.${encodeURIComponent(de)}&select=user_id&limit=1`,
      { headers: sbHeaders(), signal: AbortSignal.timeout(4000) });
    const donos = eq.ok ? await eq.json().catch(() => null) : null;
    if (!Array.isArray(donos)) { console.error('[resend-webhook] espelho: equipe_email HTTP', eq.status); return; }
    if (!donos.length) return; // remetente de sistema: não é caixa pessoal

    const nome = String(em.from).includes('<') ? String(em.from).split('<')[0].trim().replace(/^"|"$/g, '') : null;
    const ins = await fetch(`${SB}/rest/v1/email_caixa`, {
      method: 'POST', headers: { ...sbHeaders(), Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        direcao: 'saida', pasta: 'enviados', caixa: de, de_email: de, de_nome: nome || null,
        dono: donos[0].user_id, enviado_por: donos[0].user_id,
        para: lista(em.to), cc: lista(em.cc), assunto: String(em.subject || '').slice(0, 300),
        texto: em.text || null, html: em.html || null, message_id: em.message_id || null,
        resend_email_id: emailId, lido: true, criado_em: em.created_at || at,
        ...(tipo === 'email.delivered' ? { entregue_em: at, entrega_status: 'entregue' } : { entrega_status: 'bounce' }),
      }),
      signal: AbortSignal.timeout(4000),
    });
    if (!ins.ok) console.error('[resend-webhook] espelho: insert HTTP', ins.status, (await ins.text().catch(() => '')).slice(0, 200));
  } catch (e) { console.error('[resend-webhook] espelho:', String(e?.message || e)); }
}

export default async function handler(req, res) {
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(200).json({ ok: true, service: 'resend-webhook', hint: 'Configure a URL deste endpoint no Resend (com ?k=<secret>).' });
  }
  if (req.method !== 'POST') { res.status(405).end(); return; }

  if (SECRET) {
    let k = null;
    try { k = new URL(req.url, 'http://x').searchParams.get('k'); } catch { /* url malformada */ }
    if (!timingSafeEqualStr(k, SECRET)) { res.status(401).end(); return; }
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
      // `atingidos` guarda as linhas que o PATCH alcançou — é de lá que sai o DESTINATÁRIO
      // para a lista de supressão (27/08). Tirar o endereço do payload seria depender do
      // formato do evento; tirar da linha que casou usa o dado que já é nosso.
      let atingidos = [];
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
              if (Array.isArray(linhas) && linhas.length) { atingidos = linhas; return true; }   // achou e carimbou
            }
          } catch { /* tenta o próximo candidato */ }
        }
        return false;
      };

      // Chama uma das RPCs da lista de supressão para cada destinatário alcançado.
      const supressao = async (rpc, extra = {}) => {
        const alvos = [...new Set(atingidos.map((l) => l?.destinatario).filter(Boolean))];
        for (const dest of alvos) {
          await fetch(`${SB}/rest/v1/rpc/${rpc}`, {
            method: 'POST',
            headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_destinatario: dest, ...extra }),
            signal: AbortSignal.timeout(4000),
          }).catch(() => {});   // best-effort: nunca derruba o webhook
        }
      };

      let casou = null;   // null = evento que não carimba nada (não é falha)
      if (tipo === 'email.delivered') {
        casou = await patch({ entregue_em: at, status: 'entregue' }, '&entregue_em=is.null');
        // ENTREGA ZERA O CONTADOR. Sem esta linha, três caixas cheias ao longo de meses
        // suprimiriam um cliente ativo — foi o que quase aconteceu com um endereço real que
        // bounçou em 10 e 12/08 e recebeu normalmente em 24/08.
        if (casou) await supressao('emails_registrar_entrega');
      } else if (tipo === 'email.opened') casou = await patch({ aberto_em: at }, '&aberto_em=is.null');
      else if (tipo === 'email.clicked') casou = await patch({ clicado_em: at }, '&clicado_em=is.null');
      else if (tipo === 'email.bounced') {
        casou = await patch({ status: 'bounce' });
        // O TIPO DO BOUNCE É A INFORMAÇÃO QUE DECIDE, e era exatamente a que se perdia aqui.
        // `Permanent` = o endereço não existe (suprime na hora); `Transient` = caixa cheia ou
        // servidor fora (só suprime no 3º seguido). Na dúvida — campo ausente ou nome novo —
        // tratamos como TRANSITÓRIO: errar para o lado de continuar tentando devolve e-mail
        // a quem está vivo; errar para o outro corta cliente em silêncio.
        const bnc = b.data?.bounce || {};
        const rotulo = String(bnc.type || bnc.bounceType || bnc.subType || bnc.subtype || '');
        const permanente = /perman|hard/i.test(rotulo);
        if (casou) await supressao('emails_registrar_bounce', { p_permanente: permanente, p_detalhe: rotulo.slice(0, 300) });
      } else if (tipo === 'email.complained') {
        casou = await patch({ status: 'reclamacao' });
        if (casou) await supressao('emails_registrar_reclamacao');
      }

      // CAIXA DE E-MAIL DA EQUIPE (23/09): o mesmo carimbo vai para `email_caixa`, onde a tela
      // de Enviados mostra "entregue / aberto". Best-effort e independente do emails_log —
      // envio antigo pode estar num e não no outro. Nunca derruba o webhook.
      const carimboCaixa = tipo === 'email.delivered' ? [{ entregue_em: at, entrega_status: 'entregue' }, '&entregue_em=is.null']
        : tipo === 'email.opened' ? [{ aberto_em: at }, '&aberto_em=is.null']
        : tipo === 'email.clicked' ? [{ clicado_em: at }, '&clicado_em=is.null']
        : tipo === 'email.bounced' ? [{ entrega_status: 'bounce' }, '']
        : tipo === 'email.complained' ? [{ entrega_status: 'reclamacao' }, ''] : null;
      let caixaCasou = null; // null = não deu para saber (erro); false = nenhuma linha na caixa
      if (carimboCaixa) {
        caixaCasou = false;
        for (const cand of cands) {
          try {
            const rc = await fetch(`${SB}/rest/v1/email_caixa?resend_email_id=eq.${encodeURIComponent(cand)}${carimboCaixa[1]}`, {
              method: 'PATCH',
              headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
              body: JSON.stringify(carimboCaixa[0]), signal: AbortSignal.timeout(4000),
            });
            if (!rc.ok) { console.error('[resend-webhook] caixa HTTP', rc.status); caixaCasou = null; break; }
            const l = await rc.json().catch(() => []);
            if (Array.isArray(l) && l.length) { caixaCasou = true; break; }
          } catch (e) { console.error('[resend-webhook] caixa:', String(e?.message || e)); caixaCasou = null; break; }
        }
      }

      // ENVIO FEITO FORA DO APP (30/10, dono: "as caixas devem estar sincronizadas sempre").
      // E-mail mandado pela caixa do próprio Resend (ou pela sessão do Claude, via MCP) não passa
      // por api/email-caixa.js, então nunca entrava em Enviados — os 4 convites a leiloeiros de
      // 30/10 só apareciam no Resend. Na entrega (ou bounce) sem linha na caixa, buscamos o e-mail
      // no Resend e, se o remetente é o endereço PESSOAL de alguém da equipe (`equipe_email`),
      // registramos em Enviados dessa pessoa. Endereço de sistema (contato@, avisos de cron) fica
      // de fora de propósito: viraria milhares de linhas que ninguém mandou à mão.
      // O `carimboCaixa[1]` filtra `entregue_em=is.null`: um `delivered` repetido não casa e cairia
      // aqui — por isso o espelho confere a existência pelo id antes de inserir.
      if (caixaCasou === false && (tipo === 'email.delivered' || tipo === 'email.bounced')) {
        await espelharEnvioNaCaixa(emailId, tipo, at);
      }

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
