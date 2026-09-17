/**
 * GET  /api/honorario-recebimento?arrematacao_id=<uuid>
 *   Lista as partes já registradas de um honorário + saldo restante. Staff (admin/
 *   analista/advogado) — mesmo papel que já vê o link de pagamento em Caso.jsx.
 *
 * POST /api/honorario-recebimento
 *   Registra um recebimento MANUAL (Pix recebido fora do sistema, cheque, dinheiro,
 *   transferência) contra um honorário já existente — "destrinchar" o pagamento em
 *   partes com justificativa (pedido do dono, 17/09: Pix já recebido na conta pessoal +
 *   cheque + saldo no cartão pelo link de sempre). Só admin grava (mesma trava de
 *   config_honorarios) — a trigger `honorarios_recebimentos_valida_teto` no banco é quem
 *   de fato impede passar do valor total, este endpoint só filtra role/formato antes.
 */
import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const METODOS = new Set(['pix_externo', 'cheque', 'cartao_mp', 'dinheiro', 'transferencia']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function sb(path, opts) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', ...(opts?.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
}

export default async function handler(req, res) {
  const ip = getIP(req);
  const rl = await checkRateLimit(`honorario-recebimento:${ip}`, 20, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas. Aguarde.' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });
  const role = await getUserRoleById(user.id);

  if (req.method === 'GET') {
    if (!['admin', 'analista', 'advogado'].includes(role)) return res.status(403).json({ error: 'Sem permissão.' });
    const arrematacaoId = String(req.query?.arrematacao_id || '');
    if (!UUID_RE.test(arrematacaoId)) return res.status(400).json({ error: 'arrematacao_id inválido' });
    try {
      const [arrR, recR] = await Promise.all([
        sb(`arrematacoes?id=eq.${arrematacaoId}&select=id,honorarios_valor,honorarios_status`),
        sb(`honorarios_recebimentos?arrematacao_id=eq.${arrematacaoId}&order=criado_em.desc`),
      ]);
      if (!arrR.ok) throw new Error(`arrematacao_falhou_${arrR.status}`);
      const [arr] = await arrR.json();
      if (!arr) return res.status(404).json({ error: 'Arrematação não encontrada.' });
      const recebimentos = recR.ok ? await recR.json() : [];
      const somado = recebimentos.filter(r => r.status === 'confirmado').reduce((s, r) => s + Number(r.valor || 0), 0);
      const total = Number(arr.honorarios_valor) || 0;
      return res.status(200).json({
        ok: true, arrematacao_id: arr.id, honorarios_status: arr.honorarios_status,
        total, recebido: somado, saldo_restante: Math.max(0, Math.round((total - somado) * 100) / 100),
        recebimentos,
      });
    } catch (e) {
      console.error('[honorario-recebimento] GET falhou:', e?.message || e);
      return res.status(500).json({ error: 'Erro ao carregar recebimentos.' });
    }
  }

  if (req.method === 'POST') {
    if (role !== 'admin') return res.status(403).json({ error: 'Só admin registra recebimento manual.' });
    const { arrematacao_id, metodo, valor, justificativa, comprovante_url, status } = req.body || {};
    if (!UUID_RE.test(String(arrematacao_id || ''))) return res.status(400).json({ error: 'arrematacao_id inválido' });
    if (!METODOS.has(String(metodo))) return res.status(400).json({ error: 'método inválido' });
    if (metodo === 'cartao_mp') return res.status(400).json({ error: 'cartão via link é gravado pelo webhook, não manualmente.' });
    const v = Number(valor);
    if (!(v > 0)) return res.status(400).json({ error: 'valor deve ser maior que zero' });
    if (String(justificativa || '').trim().length < 5) return res.status(400).json({ error: 'justificativa obrigatória (mín. 5 caracteres)' });
    const statusFinal = ['confirmado', 'aguardando_compensacao'].includes(status) ? status : 'confirmado';

    try {
      const ins = await sb('honorarios_recebimentos', {
        method: 'POST',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({
          arrematacao_id, metodo, valor: v, status: statusFinal,
          justificativa: String(justificativa).slice(0, 500),
          comprovante_url: comprovante_url || null,
          registrado_por: user.id,
        }),
      });
      if (!ins.ok) {
        const detalhe = await ins.json().catch(() => null);
        // A trigger do banco (teto do valor) responde 400/500 com a mensagem já pronta —
        // repassa direto em vez de um genérico "erro interno".
        return res.status(409).json({ error: detalhe?.message || 'Não foi possível registrar (confira o saldo restante).' });
      }
      const [criado] = await ins.json();
      await auditLog({ acao: 'honorario_recebimento_manual', user_id: user.id, ip, detalhes: { arrematacao_id, metodo, valor: v, status: statusFinal }, sucesso: true });
      return res.status(200).json({ ok: true, recebimento: criado });
    } catch (e) {
      console.error('[honorario-recebimento] POST falhou:', e?.message || e);
      return res.status(500).json({ error: 'Erro ao registrar recebimento.' });
    }
  }

  return res.status(405).end();
}
