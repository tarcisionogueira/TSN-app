/**
 * GET /api/veiculo-fipe?id=...   (logado, admin/analista — mesmo nível de acesso da tela
 * /admin/veiculos-leilao, ver App.jsx)
 *
 * On-demand: ao abrir a tela do veículo, busca o valor FIPE se ainda não tiver (ou estiver
 * velho) e grava. Se já tem valor fresco, devolve o cache sem gastar nem 1 chamada da cota
 * diária — a régua de "fresco" é a mesma do cron em lote (RETENTAR_*_DIAS em api/_fipe.js).
 * Cota esgotada não é erro: devolve o que já existe (mesmo velho) com `cota_esgotada: true`,
 * nunca finge que achou um valor que não achou.
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };

import { getUser, getUserRoleById } from './_auth.js';
import { criarFipeFetch, buscarFipe, fipeEstaVelho } from './_fipe.js';

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
  if (!['admin', 'analista'].includes(role)) { res.status(403).json({ error: 'Sem acesso' }); return; }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const id = params.get('id');
  if (!id) { res.status(400).json({ error: 'id obrigatório' }); return; }

  const [v] = await (await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}&select=id,marca,modelo,ano_fabricacao,ano_modelo,tipo_veiculo,valor_fipe,fipe_codigo,fipe_mes_referencia,fipe_status,fipe_atualizado_em`)).json();
  if (!v) { res.status(404).json({ error: 'Veículo não encontrado' }); return; }

  if (!fipeEstaVelho(v.fipe_status, v.fipe_atualizado_em)) {
    res.status(200).json({ valor_fipe: v.valor_fipe, fipe_codigo: v.fipe_codigo, fipe_mes_referencia: v.fipe_mes_referencia, fipe_status: v.fipe_status, de_cache: true });
    return;
  }
  if (!v.marca || !v.modelo || !v.ano_fabricacao) {
    res.status(200).json({ valor_fipe: null, fipe_status: 'sem_dados', de_cache: false });
    return;
  }

  const fipeGet = criarFipeFetch(async () => {
    const r = await sb('rpc/registrar_uso_fipe', { method: 'POST', body: JSON.stringify({ p_teto: 450 }) });
    if (!r.ok) return { permitido: false };
    return r.json();
  });
  const resultado = await buscarFipe(fipeGet, v);

  if (resultado.status === 'sem_cota') {
    res.status(200).json({ valor_fipe: v.valor_fipe, fipe_codigo: v.fipe_codigo, fipe_mes_referencia: v.fipe_mes_referencia, fipe_status: v.fipe_status, de_cache: true, cota_esgotada: true });
    return;
  }

  const agora = new Date().toISOString();
  const patch = resultado.status === 'ok' || resultado.status === 'aproximado'
    ? { valor_fipe: resultado.valor, fipe_codigo: resultado.codigoFipe, fipe_mes_referencia: resultado.mesReferencia, fipe_status: resultado.status, fipe_atualizado_em: agora }
    : { fipe_status: resultado.status, fipe_atualizado_em: agora };

  const grava = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  if (!grava.ok) {
    console.error(`[veiculo-fipe] gravação falhou (veículo ${id}): ${grava.status}`);
    res.status(200).json({ valor_fipe: null, fipe_status: 'erro', de_cache: false });
    return;
  }
  const [gravado] = await grava.json();
  if (!gravado) {
    console.error(`[veiculo-fipe] update não alcançou nenhuma linha (veículo ${id}) — RLS ou id inexistente`);
    res.status(200).json({ valor_fipe: null, fipe_status: 'erro', de_cache: false });
    return;
  }
  res.status(200).json({ valor_fipe: gravado.valor_fipe, fipe_codigo: gravado.fipe_codigo, fipe_mes_referencia: gravado.fipe_mes_referencia, fipe_status: gravado.fipe_status, de_cache: false });
}
