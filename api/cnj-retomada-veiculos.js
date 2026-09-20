/**
 * POST /api/cnj-retomada-veiculos  (logado, admin/analista)
 * Busca no CNJ DataJud processos de busca e apreensão/alienação fiduciária de um banco/
 * financeira, listando nome do executado, processo, tribunal e valor da causa. Uso INTERNO
 * pra avaliação — não envia nada a ninguém. Motor em ./_cnj.js (buscarRetomadaVeiculos).
 *
 * Não devolve marca/modelo/placa de veículo — o DataJud não expõe isso (ver comentário na
 * função). Não confundir com /api/cnj-datajud (consulta genérica por processo/parte, usada
 * na due diligence de imóvel).
 */
import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { buscarRetomadaVeiculos } from './_cnj.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIP(req);
  const rl = await checkRateLimit(`cnj-retomada-veiculos:${ip}`, 20, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  const role = await getUserRoleById(user.id);
  if (!['admin', 'analista'].includes(role)) { res.status(403).json({ error: 'Sem acesso' }); return; }

  const { banco, uf, nacional = true } = req.body || {};
  if (!banco) return res.status(400).json({ error: 'Informe o banco/credor' });
  if (!nacional && !uf) return res.status(400).json({ error: 'UF obrigatório (ou use nacional:true)' });

  try {
    const r = await buscarRetomadaVeiculos({ banco, uf, nacional });
    if (r.erros?.some(e => /UF inválida/.test(e))) return res.status(400).json({ error: r.erros[0] });
    return res.status(200).json(r);
  } catch (err) {
    console.error('CNJ retomada veículos erro:', err.message);
    return res.status(500).json({ error: 'Erro interno na consulta CNJ' });
  }
}
