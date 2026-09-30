import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { buscarProcessosCNJ } from './_cnj.js';
import { buscarQSA } from './_pj-socio.js';
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

  const { numero_processo, uf, nacional = true, modalidade = null } = req.body || {};
  let { nome_parte } = req.body || {};
  if (!numero_processo && !nome_parte) return res.status(400).json({ error: 'Informe numero_processo ou nome_parte' });
  if (!nacional && !uf) return res.status(400).json({ error: 'UF obrigatório (ou use nacional:true)' });

  // CPF/CNPJ no campo de nome (auditoria 30/09, item 3): o DJEN só busca por NOME. CNPJ vira a
  // razão social da Receita; CPF não tem fonte aberta → pede o nome (antes saía selo VERDE).
  let documento = null;
  const dig = String(nome_parte || '').replace(/\D/g, '');
  if (!numero_processo && nome_parte && /^[\d.\-/\s]+$/.test(String(nome_parte).trim())) {
    if (dig.length === 11) return res.status(400).json({ error: 'Busca por CPF não é possível em fonte aberta — informe o NOME COMPLETO da pessoa.' });
    if (dig.length !== 14) return res.status(400).json({ error: 'Informe o nome completo, a razão social ou um CNPJ válido.' });
    const qsa = await buscarQSA(dig).catch((e) => { console.warn('[cnj-datajud] Receita:', e?.message || e); return null; });
    if (!qsa?.razao_social) return res.status(502).json({ error: 'Não consegui obter a razão social deste CNPJ na Receita agora — informe a razão social.' });
    nome_parte = qsa.razao_social; documento = dig;
  }

  try {
    const r = await buscarProcessosCNJ({ numero_processo, nome_parte, uf, nacional, modalidade, documento });
    if (r.erros?.some(e => /UF inválida/.test(e))) return res.status(400).json({ error: r.erros[0] });
    return res.status(200).json(r);
  } catch (err) {
    console.error('CNJ DataJud erro:', err.message);
    return res.status(500).json({ error: 'Erro interno na consulta CNJ' });
  }
}
