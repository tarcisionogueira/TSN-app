/**
 * GET /api/veiculo-fipe?id=...   (qualquer usuário logado — 20/10, dono: "a FIPE pode aparecer sob
 * demanda para quem acessar a página do carro"). Cliente: só veículo da vitrine, 40 consultas/hora
 * (a cota da FIPE é UMA para todos — 450/dia — e não pode ser queimada por um só) e sem placa no
 * retorno (placa é dado do plano Veículos, vem por veiculo_leiloeiro).
 *
 * On-demand: ao abrir a tela do veículo, busca o valor FIPE se ainda não tiver (ou estiver
 * velho) e grava. Se já tem valor fresco, devolve o cache sem gastar nem 1 chamada da cota
 * diária — a régua de "fresco" é a mesma do cron em lote (RETENTAR_*_DIAS em api/_fipe.js).
 * Cota esgotada não é erro: devolve o que já existe (mesmo velho) com `cota_esgotada: true`,
 * nunca finge que achou um valor que não achou.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 }; // 30 s: pode ler o edital (PDF) para achar o ano

import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, rateLimitedRes } from './_rate-limit.js';
import { garantirFipe, COLUNAS_FIPE } from './_fipe-garantir.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  const role = await getUserRoleById(user.id);
  const equipe = ['admin', 'analista', 'consultor', 'advogado'].includes(role); // = eh_equipe() no banco
  if (!equipe) {
    const rl = await checkRateLimit(`veiculo-fipe:${user.id}`, 40, 3_600_000);
    if (!rl.ok) { rateLimitedRes(res, rl.resetAt); return; }
  }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const id = params.get('id');
  if (!id) { res.status(400).json({ error: 'id obrigatório' }); return; }

  const lido = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}${equipe ? '' : '&status_patio=eq.confirmado'}&select=${COLUNAS_FIPE}`);
  if (!lido.ok) { res.status(503).json({ error: `Leitura do veículo falhou (${lido.status})` }); return; }
  const [v] = await lido.json();
  if (!v) { res.status(404).json({ error: 'Veículo não encontrado' }); return; }
  const fipe = await garantirFipe(v);
  if (!equipe) delete fipe.placa;
  res.status(200).json(fipe);
}
