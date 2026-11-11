/**
 * Cron (a cada 10 min) da integração Homio — 11/11.
 *
 * 1. Marca como ATIVADA a conta cuja dona já definiu a senha e enfileira o aviso `conta_ativada`
 *    (a Homio para de mandar lembrete e segue para a sequência do lançamento).
 * 2. Reenvia à Homio os avisos que falharam (até 10 tentativas por lead).
 * 3. Reenvia o e-mail de ativação que falhou por erro (não o que foi para a fila por orçamento:
 *    esse sai sozinho na drenagem da fila, e reenviar aqui seria mandar duas vezes).
 *
 * Tudo que fica parado aparece no health-check (`homio_leads_resumo`). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { sb, avisarHomio, enviarEmailAtivacao } from './_homio-io.js';

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  const out = { ativados: 0, avisos_ok: 0, avisos_falha: 0, emails_ok: 0, emails_falha: 0, erros: [] };

  const m = await sb('rpc/homio_leads_marcar_ativados', { method: 'POST', body: '{}' });
  if (m.ok) out.ativados = (await m.json().catch(() => [])).length;
  else out.erros.push(`marcar_ativados HTTP ${m.status}`);

  const p = await sb('homio_leads?homio_aviso_pendente=neq.{}&homio_aviso_tentativas=lt.10&select=*&order=recebido_em.asc&limit=50');
  if (p.ok) {
    for (const lead of await p.json().catch(() => [])) {
      for (const evento of lead.homio_aviso_pendente || []) {
        const r = await avisarHomio(evento, lead);
        if (r.pulado) break; // sem HOMIO_WEBHOOK_URL: nada a reenviar, o health-check mostra a fila parada
        if (r.ok) out.avisos_ok++; else out.avisos_falha++;
      }
    }
  } else out.erros.push(`avisos pendentes HTTP ${p.status}`);

  const desde = new Date(Date.now() - 7 * 86400000).toISOString();
  const e = await sb(`homio_leads?situacao=eq.conta_criada&email_ativacao_em=is.null&email_ativacao_erro=not.is.null&email_ativacao_erro=not.like.enfileirado*&recebido_em=gte.${desde}&select=*&limit=20`);
  if (e.ok) {
    for (const lead of await e.json().catch(() => [])) {
      const r = await enviarEmailAtivacao(lead);
      if (r.ok) out.emails_ok++; else out.emails_falha++;
    }
  } else out.erros.push(`e-mails pendentes HTTP ${e.status}`);

  if (out.erros.length) console.error('[homio-reenvio-cron]', out.erros.join(' | '));
  return res.status(out.erros.length ? 500 : 200).json(out);
}
