/**
 * Cron — desativa imóveis CEF que saíram da Caixa (por estado).
 * Corrige o buraco do sweep do scraper (que filtrava fonte='caixa' enquanto o dado
 * é 'CEF' → nunca removia nada, acumulando imóveis vencidos que davam "imóvel não
 * disponível" ao clicar em Acessar leiloeiro). Chama a RPC segura por-estado.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
// Margem (horas) além da última varredura do estado — conservador p/ não remover
// imóveis de um estado varrido em um run que demorou.
const MARGEM_HORAS = Number(process.env.STALE_MARGEM_HORAS || 24);

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const rpc = (fn, body) => fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });

  // 1) CEF (sweep por estado, já existente).
  const r = await rpc('desativar_imoveis_cef_vencidos', { margem: `${MARGEM_HORAS} hours` });
  if (!r.ok) {
    const detalhe = await r.text().catch(() => '');
    return res.status(500).json({ error: 'Falha ao desativar vencidos (CEF)', detalhe: detalhe.slice(0, 300) });
  }
  const desativados = await r.json().catch(() => 0);

  // 2) LEILOEIROS (novo): desativa o que saiu do site (não veio no último scrape da fonte). Guarda
  // anti-regressão embutida na RPC (pula fonte com remoção > 40% = scrape degradado). Best-effort:
  // uma falha aqui não derruba o resultado do CEF.
  let leiloeiro = null;
  try {
    const r2 = await rpc('desativar_imoveis_leiloeiro_stale', { margem: '36 hours', teto_pct: 0.40 });
    leiloeiro = r2.ok ? await r2.json().catch(() => null) : { erro: (await r2.text().catch(() => '')).slice(0, 200) };
  } catch (e) { leiloeiro = { erro: String(e?.message || e).slice(0, 200) }; }

  // 3) LEILÃO VENCIDO (07/08, regra do dono: lote com data passada não pode ficar aparecendo e
  // criando expectativa). O gatilho do banco já derruba a cada escrita do scraper; esta varredura
  // é para o lote que ninguém tocou e cuja data venceu sozinha. Venda direta nunca entra — lá a
  // data é vestigial e a venda é contínua.
  let encerrados = null;
  try {
    const r3 = await rpc('desativar_leiloes_encerrados', {});
    encerrados = r3.ok ? await r3.json().catch(() => null) : { erro: (await r3.text().catch(() => '')).slice(0, 200) };
  } catch (e) { encerrados = { erro: String(e?.message || e).slice(0, 200) }; }

  console.log('[limpar-imoveis-stale]', JSON.stringify({ desativados, margem_horas: MARGEM_HORAS, leiloeiro, encerrados }));
  return res.status(200).json({ ok: true, desativados, leiloeiro, leiloes_encerrados: encerrados });
}
