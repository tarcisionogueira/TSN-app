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
const SEG_TIPOS = ['apartamento', 'casa', 'terreno', 'comercial'];

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

// Um imóvel "todos" faz UMA busca ampla cobrindo os 4 tipos (economia do dono: "puxar tudo o
// que tiver anunciado e a IA só filtra e organiza a cada raio"), com o tipo em CADA amostra.
const promptIndice = ({ endereco, condominio, bairro, tipo, cidade, uf }) => {
  const todos = tipo === 'todos';
  // Sem rua/condomínio/bairro → MAPEAR A CIDADE INTEIRA (o dono: "pega uma cidade, traz tudo o
  // que estiver anunciado e a IA filtra/organiza por região"). Cada amostra leva seu BAIRRO, então
  // uma única busca de cidade semeia vários bairros — a resolução por 250m/bairro vem daí.
  const cidadeInteira = !endereco && !condominio && !bairro;
  const alvo = todos ? 'de TODOS os tipos (apartamento, casa, terreno, comercial)' : `para o imóvel do tipo "${tipo}"`;
  const regraTipo = todos
    ? '- Cubra os 4 tipos (apartamento, casa, terreno, comercial). Em CADA amostra informe "tipo": exatamente um de apartamento|casa|terreno|comercial (sem variações). Traga no MÁXIMO 6 amostras por tipo por nível (não estoure o limite da resposta).'
    : `- SÓ o MESMO TIPO (${tipo}). Descarte tipos diferentes.`;
  const campoTipo = todos ? '"tipo":"apartamento",' : '';
  const niveis = cidadeInteira
    ? `- NÍVEL 1: bairros CENTRAIS / mais valorizados de ${cidade}.
- NÍVEL 2: DEMAIS bairros de ${cidade}.
Como NÃO há endereço/bairro específico, MAPEIE A CIDADE INTEIRA: traga amostras de VÁRIOS bairros diferentes (não concentre num só) para cobrir a cidade.`
    : `- NÍVEL 1: ${condominio ? `MESMO condomínio/empreendimento "${condominio}" (ou o quarteirão)` : bairro ? `bairro "${bairro}"` : 'mesmo condomínio/rua'} — raio de ~250m${endereco ? ' do endereço' : ''}.
- NÍVEL 2: ${bairro ? `bairros vizinhos a "${bairro}"` : 'bairro e adjacências'} (~1km).`;
  return `Você é um perito avaliador imobiliário. Pesquise o MERCADO LIVRE de VENDA e LOCAÇÃO ${alvo} em ${endereco || bairro || cidade}, ${cidade}/${uf}, em DOIS NÍVEIS:
${niveis}

REGRAS:
${regraTipo}
- SÓ MERCADO LIVRE: descarte QUALQUER leilão, praça, venda direta bancária/Caixa, alienação fiduciária, extrajudicial/judicial ou retomado (preços 30–60% abaixo contaminam o índice).
- Priorize anúncios RECENTES (≤12 meses). Capture a data de cada amostra.
- Faça várias buscas (ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Chaves na Mão e imobiliárias LOCAIS de ${cidade}).
- Informe o BAIRRO de cada amostra (essencial para classificar a cidade por região).${cidadeInteira ? ' TRAGA amostras de bairros DIFERENTES.' : ''}
- Mesmo em CIDADE PEQUENA há anúncios: pesquise "${cidade} ${uf}" + o tipo nesses portais e TRAGA o que encontrar — NÃO retorne listas vazias se existir qualquer anúncio real de mercado (venda/locação). Terreno costuma ter R$/m² BAIXO (ex.: 100–400 R$/m²): isso é normal, capture assim mesmo.

Para CADA amostra capture: ${todos ? 'tipo (apartamento|casa|terreno|comercial); ' : ''}bairro (nome do bairro do imóvel); endereco (logradouro + número, SE o anúncio mostrar — ajuda a posicionar no mapa); cep (só os dígitos, se houver); valorM2 (R$/m² de VENDA) nas vendas; aluguelM2 (R$/m²/mês) nas locações; area (m²); data (formato "AAAA-MM"); fonte (portal ou imobiliária).

Retorne SOMENTE JSON válido, sem texto fora do JSON:
{"nivel1":{"vendas":[{${campoTipo}"bairro":"","endereco":"","cep":"","valorM2":0,"area":0,"data":"AAAA-MM","fonte":""}],"locacoes":[{${campoTipo}"bairro":"","endereco":"","cep":"","aluguelM2":0,"area":0,"data":"AAAA-MM","fonte":""}]},"nivel2":{"vendas":[],"locacoes":[]}}`;
};

// Monta as amostras (venda e locação) no formato do ingerir_amostras_indice, com fonte_ref
// determinístico (dedup entre re-buscas): regiao|tipo|natureza|valorM2|area.
// Guarda DETERMINÍSTICA anti-leilão (o LLM às vezes inclui um comparável de leilão/Caixa
// apesar do prompt; o preço fica 30–60% abaixo e contamina o índice). Barra pela fonte.
const FONTE_LEILAO = /leil[ãa]o|arremat|hasta.?p[uú]bl|\bcef\b|caixa\s*econ|aliena[çc]|extrajud|retomad|venda\s*direta|megaleil|zukerman|foreclos/i;
function montarAmostras(mercado, ctx) {
  const out = [];
  const dataOk = (d) => (/^\d{4}-\d{2}/.test(String(d || '')) ? String(d).slice(0, 7) + '-01' : null);
  // Em "todos", o tipo vem de CADA amostra (a IA classificou) — TOLERANTE a variações de rótulo
  // ("Apto", "Casa/condomínio", "Terreno/área", "Loja/galpão"): mapeia por palavra-chave para os 4
  // canônicos. O matching ESTRITO derrubava toda amostra cujo rótulo não fosse exatamente 1 dos 4
  // (causa do "gerou 0 amostras"). No modo single, é o tipo do ctx.
  const canonTipo = (t) => {
    const s = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (/apart|apto|\bap\b|flat|kitn|studio|loft/.test(s)) return 'apartamento';
    if (/casa|sobrado|condomin|residenc|geminad/.test(s)) return 'casa';
    if (/terren|lote|\barea\b|gleba|chacara|sitio|fazend|rural/.test(s)) return 'terreno';
    if (/comerci|industri|loja|\bsala\b|galp|ponto|escritor|predio|barrac/.test(s)) return 'comercial';
    if (SEG_TIPOS.includes(s)) return s;
    return null;
  };
  const tipoDe = (s) => ctx.todos ? canonTipo(s?.tipo) : ctx.tipo;
  // BAIRRO por AMOSTRA (a IA classifica cada anúncio): é o que permite MAPEAR a cidade por região
  // a partir de UMA busca. Sem o bairro da amostra, cai no bairro do contexto (consulta de bairro).
  const bairroDe = (s) => norm(s?.bairro) || ctx.bairroNorm || null;
  // endereço/CEP por amostra: o cron gratuito (indice-geocodificar-cron) usa esses campos + o
  // bairro pra TRIANGULAR a lat/lng de CADA imóvel (cascata IBGE+Correios+Nominatim) e habilitar
  // a resolução por 250m. Quando a consulta já tem coordenada (endereço), lat/lng vêm do ctx.
  const cepDe = (s) => (String(s?.cep || '').replace(/\D/g, '').slice(0, 8) || null);
  const endDe = (s) => (String(s?.endereco || '').trim().slice(0, 180) || null);
  const linha = (s, natureza, vm2) => ({ cidade_norm: ctx.cidadeNorm, uf: ctx.uf, bairro_norm: bairroDe(s),
    lat: ctx.lat, lng: ctx.lng, tipo: tipoDe(s), origem: 'pesquisa_web', natureza, valor_m2: vm2, area_m2: s?.area || null,
    cep: cepDe(s), endereco: endDe(s) });
  for (const nivel of [1, 2]) {
    const bloco = mercado?.[`nivel${nivel}`] || {};
    for (const v of (bloco.vendas || [])) {
      const vm = Number(v?.valorM2); const tp = tipoDe(v); const brr = bairroDe(v) || '';
      if (tp && vm > 0 && !FONTE_LEILAO.test(String(v?.fonte || ''))) out.push({ ...linha(v, 'venda', vm), nivel, data_anuncio: dataOk(v?.data),
        fonte_ref: `web|${ctx.cidadeNorm}|${brr}|${tp}|venda|${Math.round(vm)}|${Math.round(Number(v?.area) || 0)}|${dataOk(v?.data) || ''}` });
    }
    for (const l of (bloco.locacoes || [])) {
      const am = Number(l?.aluguelM2); const tp = tipoDe(l); const brr = bairroDe(l) || '';
      if (tp && am > 0 && am < 500 && !FONTE_LEILAO.test(String(l?.fonte || ''))) out.push({ ...linha(l, 'locacao', am), nivel, data_anuncio: dataOk(l?.data),
        fonte_ref: `web|${ctx.cidadeNorm}|${brr}|${tp}|locacao|${am}|${Math.round(Number(l?.area) || 0)}|${dataOk(l?.data) || ''}` });
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
  const tipoRaw = String(body.tipo || '').toLowerCase();
  const todos = tipoRaw === 'todos';                       // 1 busca ampla cobre os 4 tipos (economia)
  const tipo = todos ? 'todos' : (SEG_TIPOS.includes(tipoRaw) ? tipoRaw : 'apartamento');
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
        model: MODEL, max_tokens: todos ? 8000 : 6000,   // "todos" retorna 4 tipos → JSON maior (evita truncar)
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
        system: `Perito avaliador. ${todos ? 'Cubra os 4 tipos (apartamento, casa, terreno, comercial) e marque o "tipo" de CADA amostra.' : 'Só ' + tipo + '.'} Só mercado livre (descarte leilão). Retorne apenas JSON válido.`,
        messages: [{ role: 'user', content: promptIndice({ endereco: body.endereco, condominio: body.condominio, bairro: body.bairro, tipo, cidade: body.cidade, uf }) }],
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
  const amostras = montarAmostras(mercado, { cidadeNorm, uf, bairroNorm, lat, lng, tipo, todos });
  let inseridas = 0;
  if (amostras.length) inseridas = (await rpc('ingerir_amostras_indice', { p_amostras: amostras })) || 0;

  // Cobra 1 crédito só no SUCESSO (mesma regra para single e todos): cota mensal → crédito.
  const cobrar = async () => {
    if (ilimitado) return { ilimitado: true };
    if (cobrarCredito) {
      const dc = await rpc('debitar_credito', { p_user_id: user.id, p_func: 'indice', p_custo_micro: Math.round(custoMicro), p_justificativa: `Índice de mercado — ${body.cidade || cidadeNorm}/${uf}`, p_referencia: `${cidadeNorm}|${tipo}` });
      return { credito: dc };
    }
    return (await rpc('consumir_indice_por', { p_user_id: user.id })) || {};
  };

  // TODOS OS TIPOS: uma única busca ampla semeou os 4 tipos → apresenta POR TIPO. Sucesso = pelo
  // menos um tipo com amostras. Cobra 1 crédito (economia: 1 pesquisa cobre tudo).
  // Sem rua/bairro → é consulta de CIDADE: devolvemos também a classificação POR BAIRRO (mapa da
  // cidade por região). Bairro com poucos dados não entra aqui e cai na média (nível 3) do ponderado.
  const cidadeAmpla = !bairroNorm && lat == null && lng == null;
  const regioesDe = async (t) => {
    if (!cidadeAmpla) return [];
    const r = await rpc('indice_bairros_cidade', { p_cidade_norm: cidadeNorm, p_uf: uf, p_tipo: t });
    return Array.isArray(r) ? r : [];
  };

  if (todos) {
    const porTipo = [];
    for (const t of SEG_TIPOS) {
      const p = await rpc('indice_regiao_ponderado', { p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: t });
      if (p && p.venda_m2 != null) porTipo.push({ tipo: t, nivel: p.nivel, venda_m2: p.venda_m2,
        aluguel_m2: p.locacao_m2 != null ? p.locacao_m2 : Math.round(p.venda_m2 * 0.004 * 100) / 100,
        n_amostras: (p.n_venda || 0) + (p.n_locacao || 0), regioes: await regioesDe(t) });
    }
    if (!porTipo.length) { res.status(200).json({ ok: true, gerado: false, motivo: 'sem_amostras', inseridas }); return; }
    const cota = await cobrar();
    res.status(200).json({ ok: true, gerado: true, todos: true, fonte: 'mercado', inseridas, porTipo, cota });
    return;
  }

  const pond = await rpc('indice_regiao_ponderado', { p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
  if (!pond || pond.venda_m2 == null) { res.status(200).json({ ok: true, gerado: false, motivo: 'sem_amostras', inseridas }); return; }

  const cota = await cobrar();
  res.status(200).json({
    ok: true, gerado: true, fonte: 'mercado', nivel: pond.nivel,
    venda_m2: pond.venda_m2, aluguel_m2: pond.locacao_m2 != null ? pond.locacao_m2 : Math.round(pond.venda_m2 * 0.004 * 100) / 100,
    n_amostras: (pond.n_venda || 0) + (pond.n_locacao || 0), inseridas, regioes: await regioesDe(tipo), cota,
  });
}
