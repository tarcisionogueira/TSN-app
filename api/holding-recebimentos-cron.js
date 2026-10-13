/**
 * /api/holding-recebimentos-cron — puxa da HOLDING as entradas das contas bancárias da empresa
 * (13/10, dono: conferir honorários pagos direto no banco; "manter os dois sistemas independentes").
 *
 * Contrato: GET {HOLDING_API_URL}/api/externo/recebimentos (repositório holding-nogueira,
 * lib/integracoes/externo.ts), token `HOLDING_EXTRATO_TOKEN` — SÓ desta direção, diferente do
 * `HOLDING_API_TOKEN` (holding lendo o BidPro). Sem as duas variáveis, a rotina responde "não
 * configurada" e nada mais muda: o BidPro funciona igual sem a holding.
 *
 * Regras de leitura (as que já morderam os dois lados):
 *  - lista cortada não é extrato: `recebimentos.length` ≠ `total` → erro, nada gravado;
 *  - resposta sem `ok: true` é falha, nunca "nenhum recebimento" (escopo não configurado = 409 lá);
 *  - redirecionamento só para o MESMO site (o fetch automático descartaria o Authorization).
 * Grava em `holding_recebimentos` (fora da DRE). Janela padrão 60 dias; `?dias=` até 400.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

const mesmoSite = (a, b) => {
  try { const h = (x) => new URL(x).hostname.replace(/^www\./, ''); return new URL(b).protocol === 'https:' && h(a) === h(b); }
  catch { return false; } // URL inválida no Location: não segue
};

async function buscar(base, token, dias) {
  const ate = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const desde = new Date(Date.parse(`${ate}T12:00:00Z`) - dias * 864e5).toISOString().slice(0, 10);
  let url = `${base.replace(/\/+$/, '')}/api/externo/recebimentos?desde=${desde}&ate=${ate}`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: 'manual', signal: AbortSignal.timeout(25000) });
    if (r.status >= 300 && r.status < 400) {
      const prox = new URL(r.headers.get('location') || '', url).toString();
      if (!mesmoSite(url, prox)) throw new Error(`holding redirecionou para outro site (${new URL(prox).hostname}) — não reenvio o token`);
      url = prox; continue;
    }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.ok) throw new Error(`holding HTTP ${r.status}: ${j?.erro || 'resposta sem ok'}`);
    if (!Array.isArray(j.recebimentos) || !Number.isFinite(Number(j.total))) throw new Error('resposta da holding sem lista/total');
    if (j.recebimentos.length !== Number(j.total)) throw new Error(`lista cortada: ${j.recebimentos.length} de ${j.total} — nada gravado`);
    return { periodo: j.periodo, titulares: j.titulares || [], recebimentos: j.recebimentos };
  }
  throw new Error('redirecionamentos demais');
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  const base = (process.env.HOLDING_API_URL || '').trim();
  const token = (process.env.HOLDING_EXTRATO_TOKEN || '').trim();
  if (!base || token.length < 32) { res.status(200).json({ ok: false, configurada: false, motivo: 'HOLDING_API_URL/HOLDING_EXTRATO_TOKEN ausentes — integração desligada' }); return; }

  const dias = Math.min(400, Math.max(1, Number(new URL(req.url, 'http://x').searchParams.get('dias')) || 60));
  let ext;
  try { ext = await buscar(base, token, dias); }
  catch (e) {
    console.error('[holding-recebimentos]', e.message);
    res.status(502).json({ ok: false, erro: e.message }); return;
  }

  const linhas = ext.recebimentos
    .filter((r) => r?.id && /^\d{4}-\d{2}-\d{2}$/.test(r.data || '') && Number(r.valor) > 0)
    .map((r) => ({ id: String(r.id).slice(0, 64), data: r.data, valor: Number(r.valor), descricao: String(r.descricao || '').slice(0, 300),
      instituicao: String(r.instituicao || '').slice(0, 80), conta: String(r.conta || '').slice(0, 80), lido_em: new Date().toISOString() }));
  if (linhas.length) {
    const up = await fetch(`${SUPABASE_URL}/rest/v1/holding_recebimentos?on_conflict=id`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(linhas),
    });
    if (!up.ok) {
      const det = await up.text().catch(() => '');
      console.error('[holding-recebimentos] gravar', up.status, det.slice(0, 200));
      res.status(502).json({ ok: false, erro: `falha ao gravar (HTTP ${up.status})` }); return;
    }
    const gravadas = (await up.json().catch(() => [])).length;
    if (gravadas !== linhas.length) console.error(`[holding-recebimentos] ${gravadas} de ${linhas.length} gravadas`);
  }
  res.status(200).json({ ok: true, periodo: ext.periodo, titulares: ext.titulares.map((t) => t?.nome).filter(Boolean), lidos: ext.recebimentos.length, gravados: linhas.length });
}
