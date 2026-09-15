/**
 * POST /api/marketing-confirmar-cadastro — conversão OFFLINE de Cadastro ao Google Ads.
 *
 * `trackCadastro` (src/utils/gtag.js) já dispara a conversão pelo NAVEGADOR, logo após o
 * `signUp()` — mas isso é ANTES da confirmação de e-mail, e antes de `perfis.mkt_gclid` ser
 * gravado (a atribuição só é persistida no primeiro SIGNED_IN, por `registrar_marketing` em
 * `AuthContext.jsx`). Bloqueador de anúncio, aba fechada entre o cadastro e o clique no
 * e-mail, ou in-app browser sem `gtag` apagam o sinal do navegador. Esta rota é o
 * COMPLEMENTO server-side, chamada do mesmo ponto do AuthContext logo depois de
 * `registrar_marketing` — mesmo princípio do CAPI pro Meta (`_meta-capi.js`).
 *
 * IDEMPOTENTE NO SERVIDOR: todo SIGNED_IN chama esta rota, não só o primeiro. O UPDATE só
 * vira `mkt_cadastro_ads_enviado=false → true` uma vez; do segundo login em diante o WHERE
 * não bate em nenhuma linha e a rota não manda nada ao Google (forma nº 3 do CLAUDE.md: RLS/
 * filtro sem linha não é erro — só o `Prefer: return=representation` prova se mudou).
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';
import { enviarCadastroOffline, googleAdsCadastroAtivo } from './_google-ads.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return; }
  // Sem a ação configurada, nem vale gastar o UPDATE de idempotência.
  if (!googleAdsCadastroAtivo()) { res.status(200).json({ skipped: 'google_ads_cadastro_inativo' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'não autorizado' }); return; }
  try {
    const r = await sb(
      `perfis?id=eq.${user.id}&mkt_cadastro_ads_enviado=is.false`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ mkt_cadastro_ads_enviado: true }),
      },
    );
    if (!r.ok) { res.status(200).json({ skipped: 'update_falhou' }); return; }
    const [row] = await r.json();
    if (!row) { res.status(200).json({ skipped: 'ja_enviado' }); return; } // outro login já marcou
    if (!row.mkt_gclid) { res.status(200).json({ skipped: 'sem_gclid' }); return; }
    const resultado = await enviarCadastroOffline({ gclid: row.mkt_gclid, orderId: `cad_${user.id}` });
    res.status(200).json(resultado);
  } catch (e) {
    console.error('[marketing-confirmar-cadastro] erro:', e?.message || e);
    res.status(200).json({ ok: false, erro: String(e?.message || e) });
  }
}
