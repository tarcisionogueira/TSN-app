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

import { isCronAuthorized } from './_auth.js';

export default async function handler(req, res) {
  // Auth de cron em tempo CONSTANTE (helper compartilhado isCronAuthorized).
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }

  let stats = null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/stats_completude_imoveis`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    // FALHA-ALTO (07/08): sem checar `r.ok`, um erro do PostgREST (404 se a função sumir numa
    // migração, 500, timeout) volta como JSON {code,message} e virava um `stats` "válido" com
    // tudo zero — o monitor que existe para gritar "o scraper de uma fonte quebrou" respondia
    // ok:true e se auto-silenciava justamente quando a própria medição parou de funcionar.
    if (!r.ok) {
      const corpo = await r.text().catch(() => '');
      return res.status(502).json({ error: 'RPC stats_completude_imoveis falhou', http: r.status, detalhe: String(corpo).slice(0, 200) });
    }
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

  // PINO GENÉRICO rotulado como preciso (backstop do achado de 05/08: mesma coordenada
  // exata compartilhada por logradouros DIFERENTES + geocod_nivel 'rua'/'endereco' —
  // 3.458 lotes presos assim, invisíveis porque nunca entravam na fila de refazer).
  // A cascata foi corrigida (nivelNominatim em _geo.js) e o acervo re-enfileirado;
  // este check garante que, se o padrão VOLTAR (provedor novo, regressão), o dono
  // fica sabendo em até 1 ciclo. Limite 300 ≈ 1% do acervo: acima disso não é ruído.
  let pinosGenericos = 0;
  try {
    const rp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/geocode_pinos_genericos_total`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (rp.ok) pinosGenericos = Number(await rp.json()) || 0;
  } catch { /* função pode não existir antes da migração; não derruba o monitor */ }
  if (pinosGenericos > 300) {
    regressoes.push(`${pinosGenericos} lotes com pino genérico rotulado como preciso (coordenada repetida entre ruas diferentes) — regressão do geocode; rodar a migração geocode_pino_generico_detectar_refazer.sql re-enfileira`);
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

  console.log('[monitor-dados]', JSON.stringify({ regressoes, pinos_genericos: pinosGenericos, stats }));
  return res.status(200).json({ ok: true, regressoes, pinos_genericos: pinosGenericos, stats });
}
