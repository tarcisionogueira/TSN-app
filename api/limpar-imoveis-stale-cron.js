/**
 * Cron — desativa imóveis CEF que saíram da Caixa (por estado).
 * Corrige o buraco do sweep do scraper (que filtrava fonte='caixa' enquanto o dado
 * é 'CEF' → nunca removia nada, acumulando imóveis vencidos que davam "imóvel não
 * disponível" ao clicar em Acessar leiloeiro). Chama a RPC segura por-estado.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { alertarErro } from './_error-alert.js';

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
  // EM LOTES (17/10): um UPDATE só sobre ~1.000 linhas atravessa ~30 triggers e estoura os 8 s do
  // statement_timeout TODO DIA — e como nunca termina, o backlog nunca diminui. As RPCs `_lote`
  // tocam no máx. LOTE linhas; aqui chamamos até vir menos que LOTE ou acabar o orçamento.
  const LOTE = 200;
  const inicio = Date.now();
  async function emLotes(fn, body, orcamentoMs) {
    let total = 0;
    for (let i = 0; i < 25 && Date.now() - inicio < orcamentoMs; i++) {
      const r = await rpc(fn, { ...body, lote: LOTE });
      if (!r.ok) return { erro: `${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`, parcial: total };
      const n = Number(await r.json());
      if (!Number.isFinite(n)) return { erro: 'resposta sem contagem', parcial: total };
      total += n;
      if (n < LOTE) return total;
    }
    return { erro: `orçamento de tempo esgotou com backlog restante`, parcial: total };
  }

  // 1) CEF (sweep por estado, já existente).
  // 13/10: falha AQUI saía com 500 sem log nenhum e PULAVA todos os passos abaixo (leiloeiro stale,
  // encerrados, pino genérico). Medido: o pino genérico acumulou 276 e 1.228 imóveis CEF que a Caixa
  // já tinha tirado da lista seguiam na vitrine. Agora é um passo como os outros: falha vira alerta.
  let desativados = null;
  try {
    desativados = await emLotes('desativar_imoveis_cef_vencidos_lote', { margem: `${MARGEM_HORAS} hours` }, 25000);
  } catch (e) { desativados = { erro: String(e?.message || e).slice(0, 200) }; }

  // 1b) CEF VENDIDO inferido (23/09): imóvel de leilão/licitação que SAIU da lista da Caixa a
  // partir da véspera do leilão = vendido (resultado_origem='inferido_lista_caixa'). Roda logo
  // após o sweep acima — mesmo relógio do CSV. Best-effort: falha aqui não derruba a limpeza.
  let vendidosCef = null;
  try {
    const rv = await rpc('apurar_vendidos_cef', {});
    vendidosCef = rv.ok ? await rv.json().catch(() => null) : { erro: (await rv.text().catch(() => '')).slice(0, 200) };
  } catch (e) { vendidosCef = { erro: String(e?.message || e).slice(0, 200) }; }

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

  // 4) PINO GENÉRICO (18/08). O trigger `trg_geocode_pino_generico` deixou de escrever na
  // própria tabela — era a causa do `ON CONFLICT ... cannot affect row a second time` que
  // derrubava upserts inteiros (12 dias de CEF/RJ congelado). Só que ele tem early-return
  // quando latitude/longitude/endereço vêm iguais, que é o caso da recoleta rotineira: a linha
  // IRMÃ nunca reavalia sozinha. Sem esta varredura, coordenada compartilhada por vias
  // diferentes fica marcada como precisa para sempre — e o cliente vê o pino na porta errada.
  // Aqui roda FORA de qualquer upsert, então pode tocar várias linhas sem risco de colisão.
  let pinos = null;
  try {
    pinos = await emLotes('demover_pinos_genericos_lote', {}, 52000);
  } catch (e) { pinos = { erro: String(e?.message || e).slice(0, 200) }; }

  // Best-effort NÃO pode ser invisível (23/08): a varredura do pino genérico morreu em
  // statement timeout por DIAS com o cron devolvendo ok:true — o {erro} só existia no log
  // e ninguém lê log de cron que "deu certo". Uma falha aqui não derruba os outros passos,
  // mas vira alerta (e-mail do health) para não crescer em silêncio de novo.
  const falhas = Object.entries({ cef: desativados, vendidos_cef: vendidosCef, leiloeiro, encerrados, pinos })
    .filter(([, v]) => v && typeof v === 'object' && v.erro)
    .map(([k, v]) => `${k}: ${v.erro}`);
  if (falhas.length) {
    try { alertarErro({ rota: 'limpar-imoveis-stale', erro: `Passo(s) da limpeza diária falhou(aram): ${falhas.join(' · ')}`, extra: { desativados } }); } catch { /* alerta é best-effort */ }
  }

  (falhas.length ? console.error : console.log)('[limpar-imoveis-stale]', JSON.stringify({ desativados, margem_horas: MARGEM_HORAS, leiloeiro, encerrados, pinos, falhas }));
  return res.status(falhas.length ? 500 : 200).json({ ok: !falhas.length, desativados, vendidos_cef: vendidosCef, leiloeiro, leiloes_encerrados: encerrados, pinos_genericos: pinos });
}
