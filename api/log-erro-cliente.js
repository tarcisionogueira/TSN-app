// Recebe erros de runtime do cliente (ErrorBoundary de render + handlers globais
// assíncronos) e os PERSISTE em erros_cliente (dedup por fingerprint) além de logar
// nos Runtime Logs da Vercel. A verificação de saúde lê essa tabela e sinaliza —
// assim QUALQUER quebra que atinja o usuário (não só RLS) aparece proativamente,
// para não repetir o caso "Algo deu errado" de um assinante sem sabermos.
//
// Sem auth OBRIGATÓRIA (o boundary pode disparar antes de logar), mas se vier o
// Bearer do usuário, resolvemos o user_id (liga o erro ao assinante). Escrita só
// pelo servidor (service key) via RPC security definer — o cliente nunca toca a tabela.
export const config = { runtime: 'nodejs', maxDuration: 10 };

import crypto from 'node:crypto';
import { getUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// Neutraliza números/UUIDs para agrupar o "mesmo" erro (economia: 1 linha por classe).
function normalizar(s = '') {
  return String(s).toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, ':id')
    .replace(/\d+/g, '#')
    .trim();
}

function rotaDe(url = '') {
  const h = String(url).split('#')[1] || '';
  const base = (h || String(url)).split('?')[0];
  return normalizar(base).slice(0, 120);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const b = req.body || {};
    const msg = String(b.msg || '').slice(0, 300);
    const url = String(b.url || '').slice(0, 300);
    const ua = String(b.ua || '').slice(0, 300);
    const rota = rotaDe(url);

    // Visível nos Runtime Logs (diagnóstico imediato).
    console.error('[erro-cliente]', JSON.stringify({
      msg, rota, url, ua, stack: String(b.stack || '').slice(0, 4000), at: new Date().toISOString(),
    }));

    // Persiste (best-effort) para a saúde enxergar. Nunca falha o cliente.
    if (SUPABASE_URL && SERVICE_KEY && msg) {
      const fingerprint = crypto.createHash('sha1').update(`${normalizar(msg)}|${rota}`).digest('hex').slice(0, 16);
      let userId = null;
      try { userId = (await getUser(req))?.id || null; } catch { /* anônimo */ }
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_erro_cliente`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        // p_stack: o front sempre mandou a pilha e ela morria aqui (a RPC não tinha o parâmetro).
        // Sem stack, um "Maximum call stack size exceeded" chega sem nenhuma pista de origem.
        body: JSON.stringify({ p_fingerprint: fingerprint, p_msg: msg, p_rota: rota, p_url: url, p_ua: ua, p_user_id: userId, p_stack: String(b.stack || '').slice(0, 4000) || null }),
        signal: AbortSignal.timeout(4000),
      }).catch(() => {});
    }
  } catch { /* nunca falha o cliente por causa do log */ }
  res.status(204).end();
}
