/**
 * POST /api/reapurar-resultado-leilao   (logado)
 * Body: { imovelId? | veiculoId? }
 *
 * Pedido do dono (21/09): "ao abrir a tela específica do imóvel rode novamente para o
 * leiloeiro e atualize o status caso esteja divergente. Mantenha informando como
 * indeterminado até rodar novamente e atualizar". Complementa o cron diário
 * (api/apurar-resultado-leilao-cron.js, 1x/dia): aqui é ON-DEMAND, disparado quando o
 * cliente/equipe abre a tela do lote — só reprocessa quando o status atual é
 * 'indeterminado' (não confirma nada sozinho quando ainda é NULL — isso é papel do cron
 * revisitar depois que o leilão realmente encerrar; nem quando já é 'vendido'/'sem_lance',
 * que já são conclusões confirmadas e não precisam de nova checagem).
 *
 * MESMO parser/fetch do cron (`apurarResultadoDoTexto`/`fetchLote`) — um só lugar decide o
 * que é sinal de venda, sem duplicar a lógica. Mesma lista de fontes excluídas também (SODRE/
 * PESTANA/EDITAL_DJEN — ver FONTES_APURACAO_NAO_CONFIAVEL): não adianta reprocessar aqui o que
 * o cron já sabe que não vai resolver.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { getUser } from './_auth.js';
import { fetchLote } from './enriquecer-lote.js';
import { apurarResultadoDoTexto } from './_resultado-leilao.js';
import { checkRateLimit, rateLimitedRes } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const MAX_TENTATIVAS = 3; // mesmo teto do cron — reapuração on-demand soma na MESMA contagem
const COOLDOWN_MS = 6 * 3600000; // não refaz o fetch se a última tentativa foi há < 6h (evita vários clientes abrindo o mesmo lote gastarem Bright Data à toa)
// Mesmo conjunto de api/apurar-resultado-leilao-cron.js (FONTES_APURACAO_NAO_CONFIAVEL) — sem
// isto o cron nunca tentaria essas fontes de novo, mas esta rota on-demand ainda tentaria toda
// vez que um cliente abrisse o lote. SODRE em especial: confirmado ao vivo que o resultado só
// existe depois de hidratação JS — sem headless browser aqui, gastar Bright Data não resolve.
const FONTES_APURACAO_NAO_CONFIAVEL = new Set(['PESTANA', 'EDITAL_DJEN', 'SODRE']);

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

  const imovelId = String(req.body?.imovelId || '').trim() || null;
  const veiculoId = String(req.body?.veiculoId || '').trim() || null;
  if (!imovelId && !veiculoId) { res.status(400).json({ error: 'imovelId ou veiculoId obrigatório' }); return; }

  const tabela = imovelId ? 'imoveis_leilao' : 'veiculos_leilao';
  const id = imovelId || veiculoId;
  const colunaUrl = imovelId ? 'url_lote,link_edital' : 'link_lote';

  const rlUser = await checkRateLimit(`reapurar-resultado:user:${user.id}`, 40, 3_600_000);
  if (!rlUser.ok) { rateLimitedRes(res, rlUser.resetAt); return; }

  const rRow = await sb(`${tabela}?id=eq.${encodeURIComponent(id)}&select=id,fonte,${colunaUrl},resultado_leilao,valor_lance_vencedor,resultado_apurado_em,resultado_apuracao_tentativas&limit=1`);
  if (!rRow.ok) { res.status(500).json({ error: 'Não foi possível ler o lote agora.' }); return; }
  const [row] = await rRow.json().catch(() => []);
  if (!row) { res.status(404).json({ error: 'Lote não encontrado' }); return; }

  const semAlteracao = () => res.status(200).json({ ok: true, resultado_leilao: row.resultado_leilao, valor_lance_vencedor: row.valor_lance_vencedor, atualizado: false });

  // Só reprocessa 'indeterminado' — 'vendido'/'sem_lance' já são conclusão, NULL é papel do cron.
  if (row.resultado_leilao !== 'indeterminado') return semAlteracao();
  if (FONTES_APURACAO_NAO_CONFIAVEL.has(row.fonte)) return semAlteracao();
  if ((Number(row.resultado_apuracao_tentativas) || 0) >= MAX_TENTATIVAS) return semAlteracao();
  if (row.resultado_apurado_em && (Date.now() - new Date(row.resultado_apurado_em).getTime()) < COOLDOWN_MS) return semAlteracao();

  const alvo = imovelId ? (row.url_lote || row.link_edital) : row.link_lote;
  if (!alvo || !/^https?:\/\//.test(alvo)) return semAlteracao();

  let html = '';
  try { ({ html } = await fetchLote(alvo, { proposito: 'geral_cliente' })); } catch { html = ''; } // padrao-ok: fetchLote já loga a falha real; html='' cai no ramo abaixo, sem afirmar nada
  if (!html) return semAlteracao(); // sem conteúdo agora: não conta tentativa, tenta de novo depois (cron ou próxima visita passado o cooldown)

  const achado = apurarResultadoDoTexto(html);
  const tentativas = (Number(row.resultado_apuracao_tentativas) || 0) + 1;
  const patch = { resultado_apurado_em: new Date().toISOString(), resultado_apuracao_tentativas: tentativas };
  if (achado) { patch.resultado_leilao = achado.resultado; if (achado.valor) patch.valor_lance_vencedor = achado.valor; }
  else { patch.resultado_leilao = 'indeterminado'; }

  await sb(`${tabela}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });

  res.status(200).json({
    ok: true,
    resultado_leilao: patch.resultado_leilao,
    valor_lance_vencedor: patch.valor_lance_vencedor ?? row.valor_lance_vencedor,
    atualizado: achado ? achado.resultado !== row.resultado_leilao : false,
  });
}
