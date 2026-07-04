// Backfill único: preenche cpf_hash + cpf_enc dos perfis que ainda só têm o CPF
// em texto claro. Roda sob demanda (admin ou CRON_SECRET). Processa em lotes;
// chame de novo até 'restantes' zerar. NÃO apaga o plaintext (isso é a etapa 2).
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized, getUser, getUserRoleById } from './_auth.js';
import { hashCpf, encryptCpf, cpfCriptoAtivo } from './_cpf.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
function sb(path, opts = {}) {
  return fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

export default async function handler(req, res) {
  let ok = isCronAuthorized(req);
  if (!ok) { const u = await getUser(req); if (u && (await getUserRoleById(u.id)) === 'admin') ok = true; }
  if (!ok) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!cpfCriptoAtivo()) { res.status(400).json({ error: 'CPF_ENC_KEY ausente no ambiente' }); return; }

  const rows = await (await sb('perfis?cpf=not.is.null&cpf_enc=is.null&select=id,cpf&limit=500')).json();
  const lista = Array.isArray(rows) ? rows : [];
  let migrados = 0, erros = 0;
  for (const r of lista) {
    try {
      const [h, e] = await Promise.all([hashCpf(r.cpf), encryptCpf(r.cpf)]);
      if (!h || !e) { erros++; continue; }
      const up = await sb(`perfis?id=eq.${r.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ cpf_hash: h, cpf_enc: e }) });
      if (up.ok) migrados++; else erros++;
    } catch { erros++; }
  }
  res.status(200).json({ ok: true, migrados, erros, restantes_neste_lote: lista.length - migrados });
}
