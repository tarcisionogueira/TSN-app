import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { buscarProcessosCNJ } from './_cnj.js';
/**
 * API CNJ DataJud — consulta jurídica (por número de processo ou nome da parte).
 * O motor de busca/classificação vive em ./_cnj.js (reusado pela triagem da análise).
 * Docs: https://datajud-wiki.cnj.jus.br/api-publica/endpoints
 */

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = getIP(req);
  const rl = await checkRateLimit(`cnj-datajud:${ip}`, 20, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autorizado' }); return; }

  const { numero_processo, nome_parte, uf, nacional = true } = req.body || {};
  if (!numero_processo && !nome_parte) return res.status(400).json({ error: 'Informe numero_processo ou nome_parte' });
  if (!nacional && !uf) return res.status(400).json({ error: 'UF obrigatório (ou use nacional:true)' });

  try {
    const r = await buscarProcessosCNJ({ numero_processo, nome_parte, uf, nacional });
    if (r.erros?.some(e => /UF inválida/.test(e))) return res.status(400).json({ error: r.erros[0] });
    return res.status(200).json(r);
  } catch (err) {
    console.error('CNJ DataJud erro:', err.message);
    return res.status(500).json({ error: 'Erro interno na consulta CNJ' });
  }
}
