/**
 * POST /api/informar-vendido   (logado)
 * Body: { imovelId }
 *
 * Imóvel da CAIXA que a própria Caixa já tirou do ar ("O imóvel que você procura não está mais
 * disponível para venda"), mas que segue na nossa vitrine até a lista do dia seguinte (14/10, dono:
 * "fui acessar um outro imóvel e não chega na página dele"). Venda direta/online da Caixa vende a
 * qualquer hora do dia, e a lista oficial (CSV) só sai uma vez por dia.
 *
 * Conferir sozinho não dá: o detalhe-imovel.asp responde 403 (WAF) a acesso automatizado — medido
 * em 14/10 pelo pg_net (Brasil), e em 21/09 já falhava até pelo Bright Data. Quem vê a página é o
 * NAVEGADOR do cliente. Então o cliente avisa com um clique e o lote sai da vitrine para todos.
 *
 * Seguro por desenho: só DESATIVA (não carimba 'vendido'), e o coletor da Caixa (api/scraper-caixa.js)
 * grava `ativo: true` em todo lote presente na lista do dia — aviso errado ou mal-intencionado se
 * desfaz sozinho em menos de 24 h. Só vale para fonte CEF.
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

import { getUser } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }

  const imovelId = String(req.body?.imovelId || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(imovelId)) { res.status(400).json({ error: 'imovelId inválido' }); return; }

  const rl = await checkRateLimit(`informar-vendido:user:${user.id}`, 10, 3_600_000);
  if (!rl.ok) { rateLimitedRes(res, rl.resetAt); return; }
  // #236 (20/10): o limite era só POR CONTA — várias contas grátis tiravam o acervo da Caixa do ar em massa.
  // Teto também por IP e um teto global diário (o uso legítimo medido é de poucos avisos por dia).
  const rlIp = await checkRateLimit(`informar-vendido:ip:${getIP(req)}`, 10, 3_600_000);
  if (!rlIp.ok) { rateLimitedRes(res, rlIp.resetAt); return; }
  const rlGlobal = await checkRateLimit('informar-vendido:global', 80, 86_400_000);
  if (!rlGlobal.ok) { console.error('[informar-vendido] teto global diário atingido — possível abuso'); rateLimitedRes(res, rlGlobal.resetAt); return; }

  const rRow = await sb(`imoveis_leilao?id=eq.${imovelId}&select=id,fonte,ativo&limit=1`);
  if (!rRow.ok) { res.status(502).json({ error: 'Não foi possível ler o imóvel agora.' }); return; }
  const [row] = await rRow.json().catch(() => []);
  if (!row) { res.status(404).json({ error: 'Imóvel não encontrado' }); return; }
  if (row.fonte !== 'CEF') { res.status(400).json({ error: 'Disponível só para imóveis da Caixa.' }); return; }
  if (!row.ativo) { res.status(200).json({ ok: true, removido: true, jaEstava: true }); return; }

  // `return=representation` prova que a linha mudou (RLS/filtro que não alcança nada devolve 200 vazio).
  const up = await sb(`imoveis_leilao?id=eq.${imovelId}&fonte=eq.CEF`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ativo: false }),
  });
  const linhas = up.ok ? await up.json().catch(() => []) : [];
  if (!up.ok || !Array.isArray(linhas) || !linhas.length) {
    console.error('[informar-vendido] não desativou', imovelId, up.status);
    res.status(502).json({ error: 'Não consegui retirar o imóvel agora. Tente de novo.' });
    return;
  }
  console.log('[informar-vendido]', JSON.stringify({ imovelId, userId: user.id }));
  res.status(200).json({ ok: true, removido: true });
}
