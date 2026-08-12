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
import { groundingGemini, geminiDisponivel } from './_grounding.js';
import { SEG_TIPOS, norm, extractText, parseJSON, promptIndice, montarAmostras } from './_indice-core.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const EST_INDICE_MICRO = 600000; // ~US$0,60 estimado (1 busca web + tokens) p/ pré-autorizar crédito

// Variante que DIZ se a chamada deu certo. O `rpc()` abaixo colapsa "falhou" e "sem resultado"
// no mesmo `null` — o que é aceitável onde o chamador trata os dois igual, e é BUG onde a
// diferença muda a mensagem ao cliente. Use esta quando a distinção importar.
async function rpcOk(name, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.error('[indice-mercado] RPC falhou', name, r.status, (await r.text().catch(() => '')).slice(0, 200));
    return { ok: false, data: null };
  }
  return { ok: true, data: await r.json().catch(() => null) };
}

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
  // Convenção canônica de `cidade_norm` no banco é SEM ESPAÇO (imoveis_leilao e
  // cidade_socio, as duas maiores tabelas). `norm()` produz COM espaço; passar essa
  // forma para a RPC fazia a consulta não achar nada em cidade de nome composto.
  const cidadeNormDb = String(cidadeNorm || '').replace(/\s+/g, '');
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
  let custoMicro = 0, mercado = null, motivoFalha = null, motorUsado = null;
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  // MOTOR PRIMÁRIO: Gemini grounding — o MESMO do mercadológico desde 30/07. O Índice tinha
  // ficado para trás no Claude web_search e a conta chegou em 06/08: a pesquisa de "casa" em
  // Santana de Parnaíba/Jardim Paula ABORTOU nas duas tentativas (200s) e o cliente recebeu
  // "a pesquisa de mercado falhou" — enquanto o mercadológico, no mesmo tipo de trabalho,
  // conclui em 60–90s. O Claude segue como FALLBACK: se o Gemini falhar ou vier vazio, o
  // caminho antigo assume, então nada do que funcionava deixa de funcionar.
  const buscarGemini = async (webUses, timeoutMs, compacto = false) => {
    if (!geminiDisponivel()) return null;
    const teto = `\n\nORÇAMENTO DE BUSCA: faça no MÁXIMO ${webUses} busca(s) na web, priorizando as que trazem anúncios do MESMO tipo e da MENOR distância. Traga VENDA e LOCAÇÃO.`;
    const g = await groundingGemini({
      prompt: promptIndice({ endereco: body.endereco, condominio: body.condominio, bairro: body.bairro, tipo, cidade: body.cidade, uf, compacto }) + teto,
      sistema: `Perito avaliador. Só ${tipo}. Só mercado livre (descarte leilão). Retorne apenas JSON válido.`,
      timeoutMs, maxOutputTokens: 24000,
    });
    custoMicro += Number(g.custoMicro) || 0;   // Gemini também entra na medição da geração
    if (g.__falhou) { motivoFalha = `gemini: ${g.__erroApi}`; return null; }
    const json = parseJSON(g.texto);
    if (!json) { motivoFalha = `gemini JSON incompleto (stop=${g.diag?.stop}, out_tokens=${g.diag?.out_tokens})`; return null; }
    motorUsado = 'gemini';
    return json;
  };
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
    if (json) motorUsado = 'claude';
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
  // Gemini primeiro (rápido e barato); só cai no Claude se ele não entregar.
  try { mercado = await buscarGemini(8, Math.min(80000, t1)); } catch { mercado = null; }
  // RESERVA DA 2ª TENTATIVA (07/08). Aqui estava o furo: `t1` reserva 90s para a 2ª, mas esta
  // 1ª do Claude usava `restante() - 30000` — só 30s. As duas tentativas ARROJADAS então comiam
  // o orçamento inteiro e sobravam 30s, ABAIXO dos 35s que a COMPACTA exige, então ela nunca
  // rodava. Foi exatamente o que derrubou o Índice de TERRENO do Gênesis 2 (Colinas da
  // Anhanguera, Santana de Parnaíba) às 16:57: "rede/timeout: AbortError | sem orçamento de
  // tempo para a 2ª (restavam 30s)" — 80s no Gemini + 115s no Claude = 195s dos 225s.
  // A compacta é justamente a que "costuma concluir" (comentário do próprio desenho), e é a
  // que mais importa em mercado RASO como terreno em condomínio, onde a busca arrojada demora
  // mais e entrega menos. Deixá-la de fora transformava pesquisa difícil em falha certa.
  const RESERVA_2A_MS = 90000;
  if (!mercado && restante() > RESERVA_2A_MS + 30000) {
    try { mercado = await buscar(8, Math.min(t1, restante() - RESERVA_2A_MS)); } catch { mercado = null; }
  }
  // 2ª tentativa ESTREITA e COMPACTA: menos buscas e menos amostras pedidas. Só entra com
  // tempo de sobra real — melhor devolver o motivo da 1ª falha do que morrer no timeout.
  if (!mercado && restante() > 35000) {
    try { mercado = await buscarGemini(3, Math.min(60000, restante() - 15000), true); } catch { mercado = null; }
    if (!mercado && restante() > 35000) {
      try { mercado = await buscar(3, Math.min(80000, restante() - 15000), true); } catch { mercado = null; }
    }
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

  // GEOCODIFICAR NA HORA (07/08, pedido do dono). As amostras nascem SEM coordenada — quem
  // triangula é o `indice-geocodificar-cron`, que roda de 4 em 4 horas. Quem gerava um índice
  // às 15:35 via o recorte por raio (250 m / 1 km) vazio até as 15:50, porque a distância não
  // tinha como ser calculada: o relatório então descia para o nível de bairro e dizia ao
  // cliente que só achou "região próxima". Era o caso da Alameda Dourada, 71.
  // Aqui o cron é ACORDADO logo após a ingestão, sem esperar o relógio. Fire-and-forget com
  // timeout curto: a geocodificação é melhoria de precisão, não pode atrasar nem derrubar a
  // resposta que o cliente está esperando. Se falhar, o cron das 4h faz o de sempre.
  if (inseridas > 0 && process.env.CRON_SECRET) {
    const base = (process.env.APP_BASE_URL || 'https://bidprobrasil.com.br').replace('://bidprobrasil.com.br', '://www.bidprobrasil.com.br');
    fetch(`${base}/api/indice-geocodificar-cron?lote=40`, {
      headers: { 'x-cron-secret': process.env.CRON_SECRET },
      signal: AbortSignal.timeout(3000),
    }).catch(() => { /* best-effort: o cron agendado cobre */ });
  }
  // Tempo REAL de cada pesquisa bem-sucedida — é o que permite calibrar o orçamento acima em
  // vez de estimar. Sem isto, a única duração observável era a das que estouravam.
  console.log('[indice-mercado] ok', { cidade: cidadeNorm, uf, tipo, motor: motorUsado, segundos: Math.round((Date.now() - T0) / 1000), amostras: amostras.length, inseridas });
  // Custo REAL desta pesquisa. É a única forma de comparar o índice (Claude web_search) com o
  // mercadológico (Gemini grounding) na mesma régua — os dois fazem o mesmo tipo de trabalho.
  await registrarCustoGeracao('indice', { userId: user.id, imovelId: `${cidadeNorm}|${tipo}`, custoMicro, ok: amostras.length > 0, meta: { uf, bairro: bairroNorm || null, motor: motorUsado, amostras: amostras.length, inseridas, segundos: Math.round((Date.now() - T0) / 1000) } });

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
    const r = await rpc('indice_bairros_cidade', { p_cidade_norm: cidadeNormDb, p_uf: uf, p_tipo: t });
    return Array.isArray(r) ? r : [];
  };


  // FALHA DA RPC ≠ REGIÃO SEM MERCADO (10/08). `rpc()` devolve `null` tanto para "a RPC falhou"
  // quanto para "não veio resultado", e o teste `!pond` fundia os dois em `motivo:'sem_amostras'`.
  // A tela então imprimia "Não encontramos anúncios de <tipo> nesta localidade" — depois de a
  // pesquisa web ter rodado inteira (60–200s, custo real) e de `ingerir_amostras_indice` ter
  // inserido N amostras. O cliente concluía que a região não tem mercado e/ou clicava de novo,
  // disparando outra pesquisa cara. O irmão desse defeito já fora corrigido na leitura
  // (`IndiceConsulta.jsx:44`, "FALHA != NÃO MAPEADO", 07/08) — faltava aqui, na escrita.
  // `inseridas > 0` com "sem amostras" é contradição em si: se acabamos de inserir, há amostra.
  const pondRes = await rpcOk('indice_regiao_ponderado', { p_cidade_norm: cidadeNormDb, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
  if (!pondRes.ok) {
    res.status(502).json({ ok: false, gerado: false, motivo: 'ponderacao_indisponivel', inseridas,
      error: 'As amostras foram coletadas, mas não consegui calcular o índice agora. Tente de novo em instantes — não é falta de mercado na região.' });
    return;
  }
  const pond = pondRes.data;
  if (!pond || pond.venda_m2 == null) { res.status(200).json({ ok: true, gerado: false, motivo: 'sem_amostras', inseridas }); return; }

  const cota = await cobrar();
  res.status(200).json({
    ok: true, gerado: true, fonte: 'mercado', nivel: pond.nivel,
    venda_m2: pond.venda_m2, aluguel_m2: tipo === 'terreno' ? null : (pond.locacao_m2 != null ? pond.locacao_m2 : null),
    n_amostras: (pond.n_venda || 0) + (pond.n_locacao || 0), inseridas, regioes: await regioesDe(tipo), cota,
  });
}
