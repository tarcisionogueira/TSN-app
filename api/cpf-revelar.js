/**
 * POST /api/cpf-revelar  — devolve o CPF de um ou mais perfis a partir do
 * cpf_enc (a chave só existe no backend). Serve dois usos:
 *   • display: máscara (•••.•••.XXX-••) — para telas do admin e do próprio user
 *   • contrato: CPF cheio — só para o próprio titular ou equipe jurídica
 *     (admin/advogado/analista), pois entra em documento legal (procuração).
 *
 * Corpo: { ids: [uuid...], full?: boolean }
 * Resposta: { cpfs: { [id]: string } }  (omite ids sem permissão)
 */
export const config = { runtime: 'nodejs' };

import { getUser, getUserRoleById } from './_auth.js';
import { decryptCpf, maskCpf } from './_cpf.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAFF_MASCARA = ['admin', 'advogado', 'analista', 'consultor'];
const STAFF_CHEIO   = ['admin', 'advogado', 'analista'];

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
  });
}

export default async function handler(req, res) {
  const origin = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const user = await getUser(req);
  if (!user?.id) return res.status(401).json({ error: 'Não autorizado' });

  const full = req.body?.full === true;
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(x => UUID_RE.test(x)).slice(0, 200) : [];
  if (!ids.length) return res.status(200).json({ cpfs: {} });

  const role = await getUserRoleById(user.id);
  const podeCheio   = full && (STAFF_CHEIO.includes(role));
  const podeMascara = STAFF_MASCARA.includes(role);

  const rows = await sb(`perfis?id=in.(${ids.join(',')})&select=id,cpf,cpf_enc`).then(r => r.json()).catch(() => []);
  const out = {};
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const ehDono = row.id === user.id;                       // titular sempre pode o seu
    const claro = row.cpf_enc ? (await decryptCpf(row.cpf_enc)) : (row.cpf || null);
    if (!claro) continue;
    if (full) {
      if (ehDono || podeCheio) out[row.id] = claro;          // cheio: dono ou jurídico
    } else {
      if (ehDono || podeMascara) out[row.id] = maskCpf(claro); // máscara: dono ou equipe
    }
  }
  return res.status(200).json({ cpfs: out });
}
