/**
 * POST /api/indice-mercado — GERA o Índice de mercado de uma região fazendo a PESQUISA
 * mercadológica ao vivo (busca web, como o mercadológico, porém SEM o relatório): coleta
 * comparáveis de VENDA e LOCAÇÃO (R$/m²) em 2 níveis (rua/≤250m e ~1km), GUARDA cada amostra
 * em indice_amostras (append-only, peso por data) e devolve o R$/m² ponderado da região.
 *
 * Cobrança: cota mensal do plano (limite_ia 'indice') e, esgotada, CRÉDITO (custo real × mult).
 * Explorador só VISUALIZA (não gera). Node runtime — a busca web é lenta.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { getUser } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude } from './_uso.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const EST_INDICE_MICRO = 600000; // ~US$0,60 estimado (1 busca web + tokens) p/ pré-autorizar crédito

async function rpc(name, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json().catch(() => null) : null;
}
async function perfilDe(uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${uid}&select=role,indice_count,indice_mes`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const d = r.ok ? await r.json().catch(() => []) : [];
  return d[0] || null;
}

function extractText(data) {
  try { return (data?.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n'); } catch { return ''; }
}
function parseJSON(txt) {
  if (!txt) return null;
  const fence = txt.match(/```(?:json)?\s*([\s\S]*?)```/);
  const s = (fence ? fence[1] : txt).trim();
  const i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j < 0) return null;
  try { return JSON.parse(s.slice(i, j + 1)); } catch { return null; }
}

const promptIndice = ({ endereco, condominio, tipo, cidade, uf }) => `Você é um perito avaliador imobiliário. Pesquise o MERCADO LIVRE de VENDA e LOCAÇÃO para o imóvel do tipo "${tipo}" em ${endereco || cidade}, ${cidade}/${uf}, em DOIS NÍVEIS:
- NÍVEL 1: ${condominio ? `MESMO condomínio/empreendimento "${condominio}" (ou o quarteirão)` : 'mesmo condomínio/rua'} — raio de ~250m do endereço.
- NÍVEL 2: bairro e adjacências (~1km).

REGRAS:
- SÓ o MESMO TIPO (${tipo}). Descarte tipos diferentes.
- SÓ MERCADO LIVRE: descarte QUALQUER leilão, praça, venda direta bancária/Caixa, alienação fiduciária, extrajudicial/judicial ou retomado (preços 30–60% abaixo contaminam o índice).
- Priorize anúncios RECENTES (≤12 meses). Capture a data de cada amostra.
- Faça várias buscas (ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Chaves na Mão e imobiliárias LOCAIS de ${cidade}).

Para CADA amostra capture: valorM2 (R$/m² de VENDA) nas vendas; aluguelM2 (R$/m²/mês) nas locações; area (m²); data (formato "AAAA-MM"); fonte (portal ou imobiliária).

Retorne SOMENTE JSON válido, sem texto fora do JSON:
{"nivel1":{"vendas":[{"valorM2":0,"area":0,"data":"AAAA-MM","fonte":""}],"locacoes":[{"aluguelM2":0,"area":0,"data":"AAAA-MM","fonte":""}]},"nivel2":{"vendas":[],"locacoes":[]}}`;

// Monta as amostras (venda e locação) no formato do ingerir_amostras_indice, com fonte_ref
// determinístico (dedup entre re-buscas): regiao|tipo|natureza|valorM2|area.
// Guarda DETERMINÍSTICA anti-leilão (o LLM às vezes inclui um comparável de leilão/Caixa
// apesar do prompt; o preço fica 30–60% abaixo e contamina o índice). Barra pela fonte.
const FONTE_LEILAO = /leil[ãa]o|arremat|hasta.?p[uú]bl|\bcef\b|caixa\s*econ|aliena[çc]|extrajud|retomad|venda\s*direta|megaleil|zukerman|foreclos/i;
function montarAmostras(mercado, ctx) {
  const out = [];
  const base = { cidade_norm: ctx.cidadeNorm, uf: ctx.uf, bairro_norm: ctx.bairroNorm || null, lat: ctx.lat, lng: ctx.lng, tipo: ctx.tipo, origem: 'pesquisa_web' };
  const dataOk = (d) => (/^\d{4}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 7) + '-01' : null);
  for (const nivel of [1, 2]) {
    const bloco = mercado?.[`nivel${nivel}`] || {};
    for (const v of (bloco.vendas || [])) {
      const vm = Number(v?.valorM2);
      if (vm > 0 && !FONTE_LEILAO.test(String(v?.fonte || ''))) out.push({ ...base, natureza: 'venda', valor_m2: vm, area_m2: v?.area || null, nivel, data_anuncio: dataOk(v?.data),
        fonte_ref: `web|${ctx.cidadeNorm}|${ctx.tipo}|venda|${Math.round(vm)}|${Math.round(Number(v?.area) || 0)}|${dataOk(v?.data) || ''}` });
    }
    for (const l of (bloco.locacoes || [])) {
      const am = Number(l?.aluguelM2);
      if (am > 0 && am < 500 && !FONTE_LEILAO.test(String(l?.fonte || ''))) out.push({ ...base, natureza: 'locacao', valor_m2: am, area_m2: l?.area || null, nivel, data_anuncio: dataOk(l?.data),
        fonte_ref: `web|${ctx.cidadeNorm}|${ctx.tipo}|locacao|${am}|${Math.round(Number(l?.area) || 0)}|${dataOk(l?.data) || ''}` });
    }
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!CLAUDE_KEY || !SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Serviço indisponível' }); return; }

  const body = req.body || {};
  const cidadeNorm = norm(body.cidade);
  const uf = String(body.uf || '').trim().toUpperCase();
  const bairroNorm = norm(body.bairro) || null;
  const SEGS = ['apartamento', 'casa', 'terreno', 'comercial'];
  const tipo = SEGS.includes(String(body.tipo || '').toLowerCase()) ? String(body.tipo).toLowerCase() : 'apartamento';
  const lat = Number.isFinite(+body.lat) ? +body.lat : null;
  const lng = Number.isFinite(+body.lng) ? +body.lng : null;
  if (!cidadeNorm || !/^[A-Z]{2}$/.test(uf)) { res.status(400).json({ error: 'Informe a cidade e a UF (2 letras).' }); return; }

  // Papel + cota. Explorador/consultor NÃO geram (só visualizam).
  const perfil = await perfilDe(user.id);
  const role = perfil?.role || 'explorador';
  const limite = await rpc('limite_ia_efetivo', { p_user_id: user.id, p_tipo: 'indice' }); // int|null (admin/legado ∞/5)
  const ilimitado = limite === null;
  if (!ilimitado && (limite || 0) <= 0) { res.status(403).json({ error: 'Gerar o índice de mercado é um recurso dos planos pagos.', motivo: 'sem_indice' }); return; }

  // Cota mensal → depois crédito. Só cobra ao ENTREGAR (abaixo).
  let cobrarCredito = false;
  if (!ilimitado) {
    const mesAtual = new Date().toISOString().slice(0, 7);
    const usadas = (perfil?.indice_mes === mesAtual) ? (perfil?.indice_count || 0) : 0;
    if (usadas >= limite) {
      const pode = await rpc('pode_debitar', { p_user_id: user.id, p_custo_micro_estimado: EST_INDICE_MICRO });
      if (pode !== true) { res.status(402).json({ error: 'Sua cota mensal de índice acabou. Recarregue créditos para gerar mais.', motivo: 'sem_credito' }); return; }
      cobrarCredito = true;
    }
  }

  // Pesquisa mercadológica ao vivo (busca web).
  let custoMicro = 0, mercado = null;
  try {
    const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-beta': 'web-search-2025-03-05' };
    const r = await anthropicFetch({
      method: 'POST', headers,
      body: JSON.stringify({
        model: MODEL, max_tokens: 6000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        system: `Perito avaliador. Só ${tipo}, só mercado livre (descarte leilão). Retorne apenas JSON válido.`,
        messages: [{ role: 'user', content: promptIndice({ endereco: body.endereco, condominio: body.condominio, tipo, cidade: body.cidade, uf }) }],
      }),
    }, { retries: 0, timeoutMs: 100000, noFallback: true });
    if (!r.ok) throw new Error(`anthropic_http_${r.status}`);
    const data = await r.json();
    try { custoMicro = custoRespostaClaude(MODEL, data?.usage); } catch { /* medição best-effort */ }
    mercado = parseJSON(extractText(data));
  } catch (e) {
    res.status(502).json({ error: 'A pesquisa de mercado falhou. Tente novamente.', detalhe: String(e?.message || e).slice(0, 120) });
    return;
  }

  // Guarda as amostras e recomputa o índice ponderado.
  const amostras = montarAmostras(mercado, { cidadeNorm, uf, bairroNorm, lat, lng, tipo });
  let inseridas = 0;
  if (amostras.length) inseridas = (await rpc('ingerir_amostras_indice', { p_amostras: amostras })) || 0;

  const pond = await rpc('indice_regiao_ponderado', { p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
  if (!pond || pond.venda_m2 == null) { res.status(200).json({ ok: true, gerado: false, motivo: 'sem_amostras', inseridas }); return; }

  // Cobra: cota mensal (consome 1) OU crédito (custo real × mult). Só aqui, no sucesso.
  let cota = { ilimitado };
  if (!ilimitado) {
    if (cobrarCredito) {
      const dc = await rpc('debitar_credito', { p_user_id: user.id, p_func: 'indice', p_custo_micro: Math.round(custoMicro), p_justificativa: `Índice de mercado — ${body.cidade || cidadeNorm}/${uf}`, p_referencia: `${cidadeNorm}|${tipo}` });
      cota = { credito: dc };
    } else {
      cota = (await rpc('consumir_indice_por', { p_user_id: user.id })) || {};
    }
  }

  res.status(200).json({
    ok: true, gerado: true, fonte: 'mercado', nivel: pond.nivel,
    venda_m2: pond.venda_m2, aluguel_m2: pond.locacao_m2 != null ? pond.locacao_m2 : Math.round(pond.venda_m2 * 0.004 * 100) / 100,
    n_amostras: (pond.n_venda || 0) + (pond.n_locacao || 0), inseridas, cota,
  });
}
