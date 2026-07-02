/**
 * GET/POST /api/monitor-dados-cron   (cron — protegido por CRON_SECRET)
 * MONITOR DE QUALIDADE/REGRESSÃO DOS DADOS DO ACERVO.
 *
 * Por que existe: se um leiloeiro muda o layout do site, o scraper passa a trazer
 * campos vazios em massa (coordenada, valor, área) sem ninguém perceber. Este cron
 * mede a taxa de campos faltando no LOTE RECENTE (últimos 3 dias) e ALERTA quando
 * passa de um limite — sinal de que a fonte quebrou e o scraper precisa de conserto.
 * Também reporta a completude geral do acervo (validação contínua).
 *
 * Não bloqueia nada; só observa e avisa. data_leilao ausente NÃO dispara alerta
 * (é esperado em licitação/venda direta — preenchido depois pelo edital/on-demand).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { alertarErro } from './_error-alert.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Limites de alerta no lote recente (acima disso = provável regressão da fonte).
const LIMITE = { coord: 0.60, valor: 0.40, area: 0.50 };
const MIN_AMOSTRA = 20; // não alerta com pouca coleta recente (evita falso positivo)

export default async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) { res.status(503).json({ error: 'CRON_SECRET não configurado' }); return; }
  const auth = (req.headers.authorization || '').replace('Bearer ', '');
  const sent = req.headers['x-cron-secret'] || auth || new URL(req.url, 'http://localhost').searchParams.get('secret');
  if (sent !== cronSecret) { res.status(401).json({ error: 'Não autorizado' }); return; }

  let stats = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/stats_completude_imoveis`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    stats = await r.json();
  } catch (e) {
    return res.status(500).json({ error: 'Falha ao ler stats', detalhe: String(e?.message || e) });
  }
  if (!stats || typeof stats !== 'object') return res.status(500).json({ error: 'stats inválido' });

  const recTotal = Number(stats.rec_total) || 0;
  const taxa = (n) => (recTotal > 0 ? (Number(n) || 0) / recTotal : 0);
  const regressoes = [];
  if (recTotal >= MIN_AMOSTRA) {
    if (taxa(stats.rec_sem_coord) > LIMITE.coord) regressoes.push(`coordenada faltando em ${(taxa(stats.rec_sem_coord) * 100).toFixed(0)}% do lote recente`);
    if (taxa(stats.rec_sem_valor) > LIMITE.valor) regressoes.push(`valor faltando em ${(taxa(stats.rec_sem_valor) * 100).toFixed(0)}% do lote recente`);
    if (taxa(stats.rec_sem_area) > LIMITE.area)  regressoes.push(`área faltando em ${(taxa(stats.rec_sem_area) * 100).toFixed(0)}% do lote recente`);
  }

  if (regressoes.length) {
    try {
      await alertarErro({
        rota: 'monitor-dados',
        erro: `Possível regressão de dados no acervo: ${regressoes.join('; ')}. Verifique o scraper da fonte (layout pode ter mudado).`,
        extra: stats,
      });
    } catch { /* alerta é best-effort */ }
  }

  console.log('[monitor-dados]', JSON.stringify({ regressoes, stats }));
  return res.status(200).json({ ok: true, regressoes, stats });
}
