/**
 * POST /api/indice-mercado — GERA o Índice de mercado de uma região fazendo a PESQUISA
 * mercadológica ao vivo (busca web, como o mercadológico, porém SEM o relatório): coleta
 * comparáveis de VENDA e LOCAÇÃO (R$/m²) em 2 níveis (rua/≤250m e ~1km), GUARDA cada amostra
 * em indice_amostras (append-only, peso por data) e devolve o R$/m² ponderado da região.
 *
 * Cobrança: cota mensal do plano (limite_ia 'indice') e, esgotada, CRÉDITO (custo real × mult).
 * Explorador só VISUALIZA (não gera). Node runtime — a busca web é lenta.
 */
export const config = { runtime: 'nodejs', maxDuration: 250 };

import { getUser } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude, registrarCustoGeracao } from './_uso.js';
import { SEG_TIPOS, norm, extractText, parseJSON, promptIndice, montarAmostras } from './_indice-core.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const EST_INDICE_MICRO = 600000; // ~US$0,60 estimado (1 busca web + tokens) p/ pré-autorizar crédito

async function rpc(name, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json().catch(() => null) : null;
}

// Limite de IA: a falha da RPC NÃO pode virar "ilimitado". `rpc()` devolve null tanto para
// "sem limite" (admin/legado) quanto para "a chamada falhou" — e a linha abaixo lia null como
// ∞, então uma indisponibilidade do banco liberava a pesquisa web PAGA de graça, para qualquer
// papel. Aqui distinguimos os dois casos e falhamos FECHADO (503 "tente de novo"), nunca com a
// mensagem falsa de "sua cota acabou".
async function limiteIaOuFalha(name, body) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return { erro: true };
    const v = await r.json().catch(() => undefined);
    if (v === undefined) return { erro: true };
    return { erro: false, valor: v };
  } catch { return { erro: true }; }
}
async function perfilDe(uid) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${uid}&select=role,indice_count,indice_mes`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const d = r.ok ? await r.json().catch(() => []) : [];
  return d[0] || null;
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
  // UMA PESQUISA = UM TIPO (decisão do dono, 06/08). A busca "todos os tipos numa tacada" foi a
  // aposta inicial e não se sustentou: 4 tipos × 2 níveis dividem o MESMO teto de 16k de saída e
  // as MESMAS 8 buscas, e o pedido não fecha no tempo — o Cauaxi estourou os 250s da função sem
  // entregar nada, enquanto as pesquisas de tipo único do mesmo dia concluíram em 97s e 131s
  // trazendo 70 e 85 amostras cada. Recusado no SERVIDOR, não só escondido na tela: caminho que
  // não fecha no tempo não pode continuar alcançável.
  if (tipoRaw === 'todos') {
    res.status(400).json({ error: 'Escolha um tipo por vez (apartamento, casa, terreno ou comercial). Cada pesquisa cobre um tipo e vai somando à base.', motivo: 'tipo_unico' });
    return;
  }
  const tipo = SEG_TIPOS.includes(tipoRaw) ? tipoRaw : 'apartamento';
  const lat = Number.isFinite(+body.lat) ? +body.lat : null;
  const lng = Number.isFinite(+body.lng) ? +body.lng : null;
  if (!cidadeNorm || !/^[A-Z]{2}$/.test(uf)) { res.status(400).json({ error: 'Informe a cidade e a UF (2 letras).' }); return; }

  // Papel + cota. Explorador/consultor NÃO geram (só visualizam).
  const perfil = await perfilDe(user.id);
  const role = perfil?.role || 'explorador';
  const lim = await limiteIaOuFalha('limite_ia_efetivo', { p_user_id: user.id, p_tipo: 'indice' }); // int|null (admin/legado ∞/5)
  if (lim.erro) { res.status(503).json({ error: 'Não foi possível confirmar seu limite agora. Tente de novo em instantes.', motivo: 'limite_indisponivel' }); return; }
  const limite = lim.valor;
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

  // Pesquisa mercadológica ao vivo (busca web). Igual ao relatório: 1ª tentativa ARROJADA (8
  // buscas) e, se travar OU vier JSON truncado (parseJSON=null numa cidade grande), 2ª tentativa
  // ESTREITA (3 buscas) que costuma CONCLUIR — evita 502 e "0 amostras" numa pesquisa cara.
  const T0 = Date.now();
  let custoMicro = 0, mercado = null, motivoFalha = null;
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  const buscar = async (webUses, timeoutMs, compacto = false) => {
    let r;
    try {
      r = await anthropicFetch({
        method: 'POST', headers,
        body: JSON.stringify({
          model: MODEL, max_tokens: 12000,
          // web_search_20260209 (filtragem dinâmica): o modelo filtra os resultados da busca ANTES
          // de entrarem no contexto — mais acerto e menos token gasto com página irrelevante. Não
          // precisa de header beta nem de declarar code_execution junto (roda por baixo).
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: webUses }],
          system: `Perito avaliador. Só ${tipo}. Só mercado livre (descarte leilão). Retorne apenas JSON válido.`,
          messages: [{ role: 'user', content: promptIndice({ endereco: body.endereco, condominio: body.condominio, bairro: body.bairro, tipo, cidade: body.cidade, uf, compacto }) }],
        }),
        // SEM retry interno: ele MULTIPLICA o relógio (150s + backoff + 150s ≈ 300s) e estoura o
        // maxDuration de 250s antes de a 2ª tentativa existir — foi o 504 de 13:43. Quem faz o
        // papel de retry é a 2ª tentativa (compacta), que é orçada e cabe no tempo.
      }, { retries: 0, timeoutMs, noFallback: true });
    } catch (e) {
      motivoFalha = `rede/timeout: ${e?.name || ''} ${e?.message || ''}`.trim();
      throw e;
    }
    if (!r.ok) { motivoFalha = `anthropic_http_${r.status}`; throw new Error(motivoFalha); }
    const data = await r.json();
    try { custoMicro += custoRespostaClaude(MODEL, data?.usage); } catch { /* medição best-effort */ }
    const json = parseJSON(extractText(data)); // null se truncou (JSON incompleto)
    // DIAGNÓSTICO (achado 06/08): o 502 era MUDO — no log da Vercel só aparecia o status, sem
    // dizer se foi 429, timeout ou JSON cortado, e sem isso não dá para saber o que corrigir.
    if (!json) motivoFalha = `JSON incompleto (stop_reason=${data?.stop_reason}, output_tokens=${data?.usage?.output_tokens}, buscas=${data?.usage?.server_tool_use?.web_search_requests})`;
    return json;
  };
  // ORÇAMENTO DE TEMPO (achado 06/08 — 504 "Task timed out after 250 seconds"): os timeouts
  // eram FIXOS (150s + 80s) e não conversavam com o maxDuration. Somados ao overhead já
  // raspavam o teto; com um retry interno passavam dele, e o cliente recebia a página de erro
  // da Vercel em texto puro no lugar do nosso JSON. Agora o relógio manda: a 1ª tentativa nunca
  // invade o tempo reservado da 2ª, e a 2ª só começa se REALMENTE couber.
  const FOLGA_MS = 25000;                    // ingestão das amostras + montagem da resposta
  const ORCAMENTO_MS = 250000 - FOLGA_MS;    // maxDuration da função menos a folga
  const restante = () => ORCAMENTO_MS - (Date.now() - T0);
  const t1 = Math.min(120000, Math.max(30000, restante() - 90000));
  try { mercado = await buscar(8, t1); } catch { mercado = null; }
  // 2ª tentativa ESTREITA e COMPACTA: menos buscas e menos amostras pedidas. Só entra com
  // tempo de sobra real — melhor devolver o motivo da 1ª falha do que morrer no timeout.
  if (!mercado && restante() > 35000) {
    try { mercado = await buscar(3, Math.min(80000, restante() - 15000), true); } catch { mercado = null; }
  } else if (!mercado) {
    motivoFalha = `${motivoFalha || 'falha na 1ª tentativa'} | sem orçamento de tempo para a 2ª (restavam ${Math.round(restante() / 1000)}s)`;
  }
  if (!mercado) {
    console.error('[indice-mercado] pesquisa falhou', { cidade: cidadeNorm, uf, tipo, bairro: bairroNorm, segundos: Math.round((Date.now() - T0) / 1000), motivo: motivoFalha });
    // Pesquisa que falhou GASTOU: registra como desperdício (ok:false) para a média por
    // geração distinguir o custo do produto do custo das tentativas perdidas.
    await registrarCustoGeracao('indice', { userId: user.id, imovelId: `${cidadeNorm}|${tipo}`, custoMicro, ok: false, meta: { uf, bairro: bairroNorm || null, motivo: String(motivoFalha || '').slice(0, 120) } });
    res.status(502).json({ error: 'A pesquisa de mercado falhou. Tente novamente.', detalhe: motivoFalha || 'busca instável' });
    return;
  }

  // Guarda as amostras e recomputa o índice ponderado.
  const amostras = montarAmostras(mercado, { cidadeNorm, uf, bairroNorm, lat, lng, tipo, todos: false });
  let inseridas = 0;
  if (amostras.length) inseridas = (await rpc('ingerir_amostras_indice', { p_amostras: amostras })) || 0;
  // Tempo REAL de cada pesquisa bem-sucedida — é o que permite calibrar o orçamento acima em
  // vez de estimar. Sem isto, a única duração observável era a das que estouravam.
  console.log('[indice-mercado] ok', { cidade: cidadeNorm, uf, tipo, segundos: Math.round((Date.now() - T0) / 1000), amostras: amostras.length, inseridas });
  // Custo REAL desta pesquisa. É a única forma de comparar o índice (Claude web_search) com o
  // mercadológico (Gemini grounding) na mesma régua — os dois fazem o mesmo tipo de trabalho.
  await registrarCustoGeracao('indice', { userId: user.id, imovelId: `${cidadeNorm}|${tipo}`, custoMicro, ok: amostras.length > 0, meta: { uf, bairro: bairroNorm || null, amostras: amostras.length, inseridas, segundos: Math.round((Date.now() - T0) / 1000) } });

  // Cobra 1 crédito só no SUCESSO: cota mensal → crédito. Uma pesquisa = um tipo = 1 crédito.
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


  const pond = await rpc('indice_regiao_ponderado', { p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
  if (!pond || pond.venda_m2 == null) { res.status(200).json({ ok: true, gerado: false, motivo: 'sem_amostras', inseridas }); return; }

  const cota = await cobrar();
  res.status(200).json({
    ok: true, gerado: true, fonte: 'mercado', nivel: pond.nivel,
    venda_m2: pond.venda_m2, aluguel_m2: tipo === 'terreno' ? null : (pond.locacao_m2 != null ? pond.locacao_m2 : null),
    n_amostras: (pond.n_venda || 0) + (pond.n_locacao || 0), inseridas, regioes: await regioesDe(tipo), cota,
  });
}
