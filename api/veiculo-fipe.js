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
export const config = { runtime: 'nodejs', maxDuration: 30 }; // 30 s: pode ler o edital (PDF) para achar o ano

import { getUser, getUserRoleById } from './_auth.js';
import { anoPorDocumento } from './_ano-veiculo.js';
import { criarFipeFetch, buscarFipe, fipeEstaVelho, RETENTAR_OK_DIAS, TETO_DIARIO_FIPE } from './_fipe.js';

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

  const [v] = await (await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}&select=id,titulo,marca,modelo,placa,chassi,anexos,link_lote,ano_fabricacao,ano_modelo,tipo_veiculo,valor_fipe,fipe_codigo,fipe_mes_referencia,fipe_status,fipe_atualizado_em`)).json();
  if (!v) { res.status(404).json({ error: 'Veículo não encontrado' }); return; }

  if (!fipeEstaVelho(v.fipe_status, v.fipe_atualizado_em)) {
    res.status(200).json({ valor_fipe: v.valor_fipe, fipe_codigo: v.fipe_codigo, fipe_mes_referencia: v.fipe_mes_referencia, fipe_status: v.fipe_status, de_cache: true });
    return;
  }
  // Sem marca/modelo na fonte, `buscarFipe` tenta pelo título (24/09) e devolve 'sem_dados'
  // quando nem o título tem — sem gastar cota.
  // SEM ANO → procura no EDITAL e na página do lote (26/09, dono: "quase todos disponibilizam
  // um edital"). Só para o veículo aberto; custo zero (PDF com texto + HTML público). Não achou →
  // grava 'sem_dados' com data, e a próxima abertura não repete a leitura (fipeEstaVelho: 90 dias).
  if (!v.ano_fabricacao) {
    const lotesPorDoc = async (url) => {
      const r = await sb(`veiculos_leilao?anexos=cs.${encodeURIComponent(JSON.stringify([{ url }]))}&select=id&limit=2`);
      if (!r.ok) return 2; // não consegui contar → trata como documento de vários lotes (não usa o texto inteiro)
      return (await r.json().catch(() => [])).length;
    };
    const achado = await anoPorDocumento(v, lotesPorDoc);
    if (!achado.ano) {
      console.log(`[veiculo-fipe] ${id}: ano não achado (${achado.motivos.join(' · ') || 'sem edital nem página'})`);
      const r = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ fipe_status: 'sem_dados', fipe_atualizado_em: new Date().toISOString() }) });
      if (!r.ok) console.error(`[veiculo-fipe] ${id}: não gravei sem_dados (${r.status})`);
      res.status(200).json({ valor_fipe: null, fipe_status: 'sem_dados', de_cache: false, motivo: achado.motivos[achado.motivos.length - 1] || null });
      return;
    }
    const patchAno = { ano_fabricacao: achado.ano[0], ano_modelo: achado.ano[1] };
    if (achado.placa && !v.placa) patchAno.placa = achado.placa;
    const gAno = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patchAno) });
    const [comAno] = gAno.ok ? await gAno.json().catch(() => []) : [];
    if (!comAno) console.error(`[veiculo-fipe] ${id}: ano achado (${achado.fonte}) mas não gravou (${gAno.status}) — segue a FIPE com ele assim mesmo`);
    console.log(`[veiculo-fipe] ${id}: ano ${achado.ano.join('/')} pelo ${achado.fonte}${achado.placa ? ` · placa ${achado.placa}` : ''}`);
    Object.assign(v, patchAno);
  }
  // Mesmo cache de respostas do cron (`fipe_cache`, 25 dias) — acerto não gasta cota.
  const validoDesde = new Date(Date.now() - RETENTAR_OK_DIAS * 86400000).toISOString();
  const cacheFipe = {
    async ler(path) {
      const r = await sb(`fipe_cache?path=eq.${encodeURIComponent(path)}&obtido_em=gte.${validoDesde}&select=resposta`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const [linha] = await r.json();
      return linha?.resposta;
    },
    async gravar(path, resposta) {
      const r = await sb('fipe_cache', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ path, resposta, obtido_em: new Date().toISOString() }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    },
  };

  const fipeGet = criarFipeFetch(async () => {
    const r = await sb('rpc/registrar_uso_fipe', { method: 'POST', body: JSON.stringify({ p_teto: TETO_DIARIO_FIPE }) });
    if (!r.ok) return { permitido: false };
    return r.json();
  }, cacheFipe);
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
  res.status(200).json({ valor_fipe: gravado.valor_fipe, fipe_codigo: gravado.fipe_codigo, fipe_mes_referencia: gravado.fipe_mes_referencia, fipe_status: gravado.fipe_status, de_cache: false,
    ano_fabricacao: gravado.ano_fabricacao, ano_modelo: gravado.ano_modelo, placa: gravado.placa });
}
