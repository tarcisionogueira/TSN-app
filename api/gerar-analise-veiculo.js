// Análise de VEÍCULO — UM relatório só (21/09, pedido do dono: "no lugar de dois relatórios
// [...], seria apenas um relatório com base em tudo que o leiloeiro disponibilizar entre
// edital ou descrição e anexos [...]. Trazer o relatório com a FIPE atualizada e no lugar de
// uma pesquisa mercadológica aprofundada seria basicamente condições do veículo pra ter uma
// noção se é uma boa compra ou não. Veículos ideal em 65% da FIPE.").
//
// Por que não é uma cópia de api/gerar-analise.js: aqui não existe matrícula, ITBI nem
// comparáveis geocodificados (não é imóvel) — o material é só o que o PRÓPRIO leiloeiro
// publicou (edital/laudo em anexos + descrição do lote) mais a FIPE já cacheada na linha de
// `veiculos_leilao` (api/veiculo-fipe.js já busca isso quando a tela do veículo abre — aqui só
// LEMOS o que já está lá, sem nova chamada à API da FIPE, mesmo princípio de "ler o que já
// está cacheado" usado no resto do app). Uma chamada de IA só; sem CNJ, sem QSA, sem geocode.
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { getUser, isCronAuthorized } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude, registrarCustoGeracao } from './_uso.js';
import { fetchExternoSeguro } from './_allowed-hosts.js';
import { buscarComProva, EXIGE_BUSCA } from './_busca-com-prova.js';
import { comCascataBusca } from './_busca-modelo.js';
import { revendaPorAnuncios, extrairComissaoPct, extrairDebitosDeclarados, consertarAcentos, marcaMobiauto, modelosMobiauto, anunciosMobiauto, filtrarVersao } from '../src/utils/viabilidadeVeiculo.js';
import { paginaViaBanco } from './_contato-lote.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';

// Faixa do lance mínimo vs. FIPE — regra do dono (21/09): "veículos ideal em 65% da FIPE".
// Determinístico no SERVIDOR (a IA não calcula percentual — só interpreta o número pronto,
// mesmo princípio de calcularMetricasCenario em gerar-analise.js: servidor calcula, IA nunca
// inventa aritmética).
function faixaFipe(pct) {
  if (pct == null) return 'sem_fipe';
  if (pct <= 65) return 'otima';
  if (pct <= 85) return 'boa';
  if (pct <= 100) return 'atencao';
  return 'alta';
}

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertAnaliseVeiculo(row) {
  await sb('analises_veiculo?on_conflict=user_id,veiculo_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}

// REVENDA PELA WEBMOTORS (29/09, pedido do dono): média dos 5 anúncios mais baratos − 10%.
// A API/listagem da Webmotors bloqueia robô (PerimeterX) e o robots.txt proíbe a busca
// automatizada — a Bright Data recusou "em respeito ao robots.txt". O caminho legítimo é a
// busca web da IA (anúncios PÚBLICOS indexados), com PROVA de que pesquisou (_busca-com-prova:
// resposta sem busca é falha, nunca "mercado vazio"). A conta dos 5 mais baratos é feita aqui,
// no código (revendaPorAnuncios), nunca pela IA. Devolve { revenda, motivo } — nunca lança.
// REVENDA PELO MOBIAUTO (30/09) — 1ª opção, GRÁTIS e determinística: listagem por modelo/ano lida
// via banco (a Webmotors dá 403 ao banco e à Vercel). Só cai na busca web paga se não houver 3
// comparáveis. Nunca lança; { revenda } ou { revenda: null, motivo }.
async function revendaMobiauto(v, deadline) {
  const marca = marcaMobiauto(v.marca);
  const ano = Number(v.ano_modelo || v.ano_fabricacao) || null;
  const modelos = modelosMobiauto(v.modelo);
  if (!marca || !ano || !modelos.length) return { revenda: null, motivo: 'Mobiauto: sem marca/modelo/ano' };
  const motivos = [];
  for (const modelo of modelos) {
    if (Date.now() > deadline - 3000) { motivos.push('sem tempo'); break; }
    const url = `https://www.mobiauto.com.br/comprar/carros/brasil/${marca}/${modelo}/ano-${ano}`;
    const b = await paginaViaBanco(url, deadline);
    if (!b.html) { motivos.push(`${modelo}: ${b.motivo}`); continue; }
    const anuncios = anunciosMobiauto(b.html, { marca, modelo, ano });
    if (!anuncios.length) { motivos.push(`${modelo}: 0 anúncios`); continue; }
    const f = filtrarVersao(anuncios, v.modelo);
    const revenda = revendaPorAnuncios(f.lista, v.valor_fipe);
    if (revenda) return { revenda: { ...revenda, mesmaVersao: f.versao, listagem: url } };
    motivos.push(`${modelo}: ${anuncios.length} anúncio(s), menos de 3 na faixa de 30–200% da FIPE`);
  }
  return { revenda: null, motivo: `Mobiauto: ${motivos.join('; ')}` };
}

async function buscarRevendaMercado(v, prazoMs, userId, gasto = { micro: 0 }) {
  const mob = await revendaMobiauto(v, Date.now() + Math.min(prazoMs, 25000));
  if (mob.revenda) return { revenda: mob.revenda, motivo: null };
  const r = await buscarRevendaWeb(v, prazoMs, userId, gasto);
  return r.revenda ? r : { revenda: null, motivo: [mob.motivo, r.motivo].filter(Boolean).join(' · ') };
}

async function buscarRevendaWeb(v, prazoMs, userId, gasto = { micro: 0 }) {
  const alvo = [v.marca, v.modelo, v.titulo].filter(Boolean).join(' · ').slice(0, 200);
  const ano = v.ano_modelo || v.ano_fabricacao || '';
  if (!alvo || !ano) return { revenda: null, motivo: 'sem marca/modelo/ano para buscar anúncios' };
  // 30/09 (dono): a revenda é a MÉDIA dos anúncios da Webmotors − 10% — pede TODOS os comparáveis,
  // não "os mais baratos" (isso enviesava a média para baixo). Outros portais só completam.
  // 30/09 (1ª regeração): os 4 relatórios voltaram com lista VAZIA — a página da Webmotors é JS e o
  // trecho indexado raramente traz o preço. Consultas concretas por portal + preço lido no próprio
  // resultado da busca (título/trecho com "R$") valem como anúncio.
  const fipeRef = Number(v.valor_fipe) > 0 ? ` (FIPE de referência: R$ ${Math.round(Number(v.valor_fipe)).toLocaleString('pt-BR')} — use só para conferir que é o mesmo veículo)` : '';
  const prompt = `Pesquise anúncios À VENDA do veículo: ${alvo}, ano modelo ${ano}${fipeRef}.
Faça estas buscas, nesta ordem: "${[v.marca, v.modelo || v.titulo].filter(Boolean).join(' ').slice(0, 80)} ${ano} webmotors"; depois o mesmo com "olx", "icarros" e "mobiauto".
Traga TODOS os anúncios que encontrar da Webmotors com a mesma motorização e o mesmo ano — sem escolher só os mais baratos nem só os mais caros. Só se a Webmotors tiver menos de 3, complete com OLX, iCarros ou Mobiauto.
Vale o preço que aparece no título ou no trecho do resultado da busca (ex.: "Fiat Cronos Drive 1.3 2020 — R$ 62.900"), desde que seja de UM anúncio de venda e não uma faixa "a partir de".
Só anúncios reais de venda (nada de leilão, peças, sucata, "consórcio" ou "repasse de financiamento"), ano modelo ${ano}.
Responda SOMENTE JSON: {"anuncios":[{"preco": número em reais, "titulo": "versão como anunciada", "ano": número, "km": número ou null, "local": "cidade/UF", "portal": "webmotors|olx|icarros|mobiauto", "url": "link do anúncio"}]} — até 12 anúncios.`;
  let motivo = null;
  const tentar = async (degrau, timeoutMs) => {
    const { texto, buscas } = await buscarComProva({
      degrau, chave: CLAUDE_KEY, webUses: 6, timeoutMs, maxTokens: 4000,
      system: `Pesquisador de preços de veículos usados. ${EXIGE_BUSCA}`, prompt,
      aoCusto: (c) => { gasto.micro += Number(c) || 0; try { registrarCustoGeracao('veiculo_mercado', { userId, custoMicro: c, ok: true, meta: { veiculoId: v.id, modelo: degrau.model } }); } catch { /* medição não bloqueia */ } },
    });
    if (!buscas) { motivo = 'a IA não pesquisou (resposta sem busca na web)'; return null; }
    const j = parseJSON(texto);
    if (!j) { motivo = 'resposta da busca sem JSON'; return null; }
    return Array.isArray(j.anuncios) ? j.anuncios : [];
  };
  try {
    const anuncios = await comCascataBusca((degrau) => tentar(degrau, Math.min(prazoMs, 70000)))
      .catch((e) => { motivo = `1ª busca falhou: ${String(e?.message || e).slice(0, 60)}`; return null; }) || [];
    const revenda = revendaPorAnuncios(anuncios, v.valor_fipe);
    // 30/09: uma 2ª tentativa com o Sonnet (busca dinâmica) foi testada 3× no Cronos e ABORTOU nas 3,
    // mesmo com ~55 s — retirada: só alongava o relatório. A busca web não extrai preço da Webmotors
    // (página JS, robots.txt proíbe robô); a revenda cai na régua sobre a FIPE e o motivo aparece.
    if (revenda) return { revenda, motivo: null };
    // Diz QUANTOS vieram e quantos caíram no filtro — "0 comparáveis" sozinho não separa "a busca
    // não achou" de "achou e o filtro descartou" (a forma #10 do CLAUDE.md).
    const validos = anuncios.filter((a) => Number(a?.preco) > 0).length;
    return { revenda: null, motivo: motivo && !anuncios.length ? motivo : `a busca trouxe ${anuncios.length} anúncio(s), ${validos} com preço — menos de 3 comparáveis depois do filtro de preço (30–200% da FIPE)` };
  } catch (e) {
    return { revenda: null, motivo: `busca de anúncios falhou: ${String(e?.message || e).slice(0, 80)}` };
  }
}

function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch { /* tenta os formatos abaixo */ }
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch { /* tenta o bruto abaixo */ } }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch { /* sem recuperação — devolve null */ } }
  return null;
}
function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
}

const brl = (v) => (v || v === 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '—');

// Documentos do lote como blocos NATIVOS pro Claude (mesma técnica de gerar-analise.js —
// PDF vai como `document` base64, sem extrair texto local; imagem também pode ir como
// `image` quando o anexo aponta pra uma foto, ex. laudo escaneado como JPG). Até 5 anexos e
// 6.5 MB cada — orçamento de tempo/tokens de uma função com 1 chamada de IA só.
async function anexosParaBlocos(anexos, deadline) {
  const blocos = [];
  const urls = (Array.isArray(anexos) ? anexos : [])
    .map((a) => (typeof a === 'string' ? a : a?.url))
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, 5);
  for (const url of urls) {
    if (Date.now() > deadline) break;
    try {
      const r = await fetchExternoSeguro(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (!buf?.length || buf.length > 6_500_000) continue;
      const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
      const ehImagem = /^image\//i.test(ct);
      if (ehPdf) {
        blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') }, title: 'documento do lote' });
      } else if (ehImagem) {
        blocos.push({ type: 'image', source: { type: 'base64', media_type: ct.split(';')[0], data: buf.toString('base64') } });
      }
    } catch { /* anexo indisponível — segue com os demais, nunca bloqueia o relatório */ }
  }
  return blocos;
}

// PÁGINA DO LOTE (30/09, dono: "a IA leia TUDO que tiver sobre o veículo" — a comissão e os débitos
// nem sempre estão na descrição gravada). Texto visível + o campo estruturado de comissão quando a
// plataforma publica (SUPERBID: commercialCondition.auctioneerCommissionPercent). Nunca lança: sem
// página, o relatório segue com o resto — e o motivo fica em `paginaLote` do resultado.
// Via banco (pg_net do Supabase): a Superbid devolve 403 à Vercel e 200 ao banco (medido em 30/09,
// 1ª regeração — os 4 relatórios saíram "página do lote respondeu HTTP 403"). Mesmo par de RPCs
// do motor de coleta (pagina_pedir/pagina_ler, só service_role). Nunca lança; null = não veio.
// (o helper mora em api/_contato-lote.js desde 30/09 — a proposta ao leiloeiro usa o mesmo)

async function lerPaginaDoLote(url, deadline) {
  if (!/^https?:\/\//i.test(String(url || ''))) return { texto: '', comissaoPct: null, motivo: 'sem link do lote' };
  try {
    let html = null, motivoDireto = null;
    try {
      const r = await fetchExternoSeguro(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, signal: AbortSignal.timeout(Math.max(3000, Math.min(10000, deadline - Date.now()))) });
      if (r.ok) html = (await r.text()).slice(0, 3_000_000);
      else motivoDireto = `HTTP ${r.status}`;
    } catch (e) { motivoDireto = String(e?.message || e).slice(0, 60); }
    if (!html) {
      const b = await paginaViaBanco(url, deadline);
      if (!b.html) return { texto: '', comissaoPct: null, motivo: `página do lote indisponível (direto: ${motivoDireto}; banco: ${b.motivo})` };
      html = b.html.slice(0, 3_000_000);
    }
    const m = html.match(/"auctioneerCommissionPercent"\s*:\s*(\d+(?:\.\d+)?)/);
    const texto = consertarAcentos(html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\s+/g, ' ')).trim().slice(0, 12000);
    const pct = m ? Number(m[1]) : null;
    return { texto, comissaoPct: pct > 0 && pct <= 20 ? pct : null, motivo: texto ? null : 'página do lote sem texto legível' };
  } catch (e) {
    return { texto: '', comissaoPct: null, motivo: `página do lote ilegível: ${String(e?.message || e).slice(0, 60)}` };
  }
}

// Comissão declarada em OUTROS lotes do MESMO leilão (mesmo evento da plataforma). No SUPERBID o
// percentual costuma estar só nas "Condições de venda" do evento, escrito na descrição de alguns
// lotes e não de outros. Só o mesmo evento — leiloeiro igual em outro evento pode cobrar outra taxa.
async function comissaoDoMesmoLeilao(v) {
  const evento = v?.raw?.auction?.id;
  if (!evento || !v.fonte) return null;
  try {
    const r = await sb(`veiculos_leilao?fonte=eq.${encodeURIComponent(v.fonte)}&raw->auction->>id=eq.${encodeURIComponent(String(evento))}&id=neq.${encodeURIComponent(v.id)}&descricao=ilike.*comiss*&select=descricao&limit=15`);
    if (!r.ok) { console.warn('[veiculo] comissão do mesmo leilão: HTTP', r.status); return null; }
    const pcts = (await r.json()).map((x) => extrairComissaoPct(x.descricao)).filter((n) => n != null);
    // Só vale quando os lotes concordam — percentuais diferentes no mesmo evento = não dá para escolher.
    return pcts.length && pcts.every((n) => n === pcts[0]) ? pcts[0] : null;
  } catch (e) { console.warn('[veiculo] comissão do mesmo leilão:', e?.message || e); return null; }
}

function promptVeiculo(v, percentualFipe, faixa, extra = {}) {
  const sinais = [
    v.sinistro && `Sinistro (classificação do leiloeiro): ${v.sinistro}`,
    v.is_sucata && 'Vendido como SUCATA — só certificado de baixa, SEM ATPV-e (transferência não é a padrão)',
    v.motor_alerta && 'Leiloeiro menciona dano no MOTOR na descrição',
    // Estado do motor como o leiloeiro DECLARA (motor_status_do_texto, 30/09) — a IA confirma no texto.
    ({ funciona: 'Motor declarado FUNCIONANDO pelo leiloeiro', nao_funciona: 'Motor declarado SEM FUNCIONAR/avariado pelo leiloeiro', nao_testado: 'Motor declarado NÃO TESTADO pelo leiloeiro — funcionamento incerto', servivel: 'Sucata com motor SERVÍVEL (aproveitável como peça) — não significa que funciona' })[v.motor_status],
    v.financiavel === false && 'NÃO aceita financiamento — só à vista',
    v.financiavel === true && 'Aceita financiamento',
    v.ipva_situacao && `IPVA: ${v.ipva_situacao}`,
  ].filter(Boolean).join('\n- ');

  const fipeTexto = faixa === 'sem_fipe'
    ? 'FIPE não disponível para este veículo (marca/modelo/ano não bateram com a tabela, ou consulta ainda não feita).'
    : `Lance mínimo é ${percentualFipe.toFixed(1)}% da FIPE (R$ ${brl(v.valor_fipe)}, referência ${v.fipe_mes_referencia || 'não informada'}${v.fipe_status === 'aproximado' ? ' — valor APROXIMADO, mais de uma versão do modelo bateu com o ano' : ''}). Regra da casa: ATÉ 65% da FIPE é considerado ótimo ponto de entrada; acima de 100% (lance acima da própria FIPE) é sinal de alerta forte.`;

  return `Você avalia veículos de leilão para um investidor. Use SOMENTE o que está nos documentos anexos e na descrição abaixo — nunca invente característica, defeito ou ausência de defeito que não conste. Quando a informação não constar em lugar nenhum, diga explicitamente "não informado pelo leiloeiro" em vez de presumir.

DADOS DO LOTE (do sistema, não do documento — confie neles):
- ${[v.marca, v.modelo].filter(Boolean).join(' ') || v.titulo || 'Veículo'}${[v.ano_fabricacao, v.ano_modelo].filter(Boolean).length ? ` — ano ${[v.ano_fabricacao, v.ano_modelo].filter(Boolean).join('/')}` : ''}
- KM: ${v.km != null ? Number(v.km).toLocaleString('pt-BR') : 'não informado'} · Placa: ${v.placa || 'não informada'}
- Câmbio/combustível/cor: ${[v.cambio, v.combustivel, v.cor].filter(Boolean).join(' · ') || 'não informados'}
- Modalidade: ${v.modalidade === 'judicial' ? 'Judicial' : v.modalidade === 'extrajudicial' ? 'Extrajudicial' : 'não identificada'}
- Origem da venda: ${ORIGEM_PROMPT[v.origem_venda] || 'não identificada (o leiloeiro não informa quem vende)'}
- Forma de pagamento: ${v.forma_pagamento || 'não informada'}
- Lance mínimo: R$ ${brl(v.valor_minimo)}${v.valor_avaliacao > 0 ? ` · Avaliação do leiloeiro: R$ ${brl(v.valor_avaliacao)}` : ''}
- Leiloeiro/plataforma: ${[v.leiloeiro, v.fonte].filter(Boolean).join(' · ') || 'não informado'}${v.comitente_edital ? ` · Comitente: ${v.comitente_edital}` : ''}
- Pátio: ${[v.patio, v.cidade, v.estado].filter(Boolean).join(' · ') || 'não informado'}${v.opcionais ? `\n- Opcionais: ${String(v.opcionais).slice(0, 300)}` : ''}${v.motor_doc_texto ? `\n- Trecho de documento sobre o motor: ${String(v.motor_doc_texto).slice(0, 400)}` : ''}
${extra.taxasPlataforma ? `- Taxas publicadas pela plataforma para este lote: ${extra.taxasPlataforma}\n` : ''}${sinais ? `\nSINAIS JÁ IDENTIFICADOS PELO SISTEMA (vieram do próprio leiloeiro, confirme/aprofunde com o documento, não repita cru):\n- ${sinais}\n` : ''}
${fipeTexto}

DESCRIÇÃO DO LEILOEIRO:
${v.descricao ? consertarAcentos(v.descricao).slice(0, 12000) : '(nenhuma descrição textual — use só os documentos anexos, se houver)'}
${extra.paginaTexto ? `\nTEXTO DA PÁGINA DO LOTE NO SITE DO LEILOEIRO (condições de venda, taxas, débitos — leia inteiro):\n${extra.paginaTexto}\n` : ''}
TAREFA: com base em tudo acima e nos documentos anexos (se houver — edital/laudo/matrícula do veículo), responda SOMENTE JSON válido, sem markdown, neste formato:
{
  "parecer": "markdown curto (max ~350 palavras): condição do veículo (avarias, procedência, débitos/multas se constarem), o que o documento CONFIRMA ou CONTRADIZ da descrição, e o veredito final considerando o percentual da FIPE",
  "riscos": ["cada risco concreto encontrado — sinistro, sucata, IPVA em aberto, débito/multa nos documentos, financiamento restrito, etc. Vazio se nenhum."],
  "condicoesResumo": "uma frase objetiva sobre o estado geral do veículo",
  "comissaoLeiloeiroPct": número (ex.: 5, 7.5, 10) — a comissão do leiloeiro EXATAMENTE como o edital, os anexos, a página do lote ou a descrição informam (NÃO presuma 5%: varia por leiloeiro e por leilão); null se nenhum deles informar,
  "comissaoTrecho": "o trecho literal (até 160 caracteres) onde a comissão aparece, ou null",
  "custos": [{"item": "descrição curta", "valor": número em reais}] — SOMENTE débitos e taxas que o edital, a página ou a descrição dizem ficar com o ARREMATANTE e trazem VALOR: débitos em aberto (IPVA, multas, licenciamento, DPVAT), taxa administrativa/encargos de administração, pátio/estadia/depósito, remoção, despachante. Some nada, copie cada valor como está. NUNCA inclua reparos, honorários de assessoria nem a comissão do leiloeiro. Lista vazia se nada constar,
  "debitosSemValor": ["débito/encargo que fica com o arrematante mas SEM valor informado — ex.: 'multas e IPVA anteriores ao leilão, valor não informado', 'encargos de administração conforme condições de venda'. Vazio se nada."],
  "reparos": ["reparo/atenção apontado pela condição DECLARADA (ex.: 'pneus ruins — troca', 'bateria fraca', 'volante desgastado', 'pequenos amassados'), SEM valor. Vazio se nada."],
  "parcelamento": {"entradaPct": número (ex.: 25 = sinal de 25% do lance), "parcelas": número de parcelas do saldo, "correcao": "índice/juros do saldo, se informado"} SÓ se o edital/descrição PERMITIR expressamente pagar em parcelas; senão null,
  "recomendacao": "comprar" | "avaliar_com_cautela" | "evitar"
}
Leia TUDO acima (dados, descrição, página do lote e documentos) antes de preencher comissão e débitos — é o que define o custo real da compra.
NUNCA presuma que o veículo está em bom estado por AUSÊNCIA de menção — ausência de informação é "não informado", não é sinal positivo.`;
}

function listaDeTextos(x) {
  return (Array.isArray(x) ? x : []).filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim().slice(0, 160)).slice(0, 12);
}

const pctValido = (n) => (Number(n) > 0 && Number(n) <= 20 ? Number(n) : null);
function comissaoComFonte({ pagina, textoDoLote, ia, iaTrecho, irmaos }) {
  const doTexto = extrairComissaoPct(textoDoLote);
  if (pagina.comissaoPct != null) return { comissaoLeiloeiroPct: pagina.comissaoPct, comissaoFonte: 'página do lote (campo da plataforma)' };
  if (doTexto != null) return { comissaoLeiloeiroPct: doTexto, comissaoFonte: 'descrição/condições do lote' };
  if (pctValido(ia) != null) return { comissaoLeiloeiroPct: pctValido(ia), comissaoFonte: 'edital/documentos do lote', comissaoTrecho: typeof iaTrecho === 'string' ? iaTrecho.slice(0, 160) : null };
  if (irmaos != null) return { comissaoLeiloeiroPct: irmaos, comissaoFonte: 'outros lotes do mesmo leilão' };
  return { comissaoLeiloeiroPct: null, comissaoFonte: null };
}

// IA + leitura determinística, sem contar duas vezes o mesmo débito (mesmo valor = mesmo item).
function juntarDebitos(daIa, doTexto, fipe) {
  const F = Number(fipe) || 0;
  const ia = (Array.isArray(daIa) ? daIa : [])
    .map((c) => ({ item: String(c?.item || '').slice(0, 120), valor: Math.round(Number(c?.valor) * 100) / 100, origem: 'declarado' }))
    .filter((c) => c.item && c.valor > 0);
  const mesmos = new Set(ia.map((c) => c.valor));
  return [...ia, ...doTexto.filter((d) => !mesmos.has(d.valor))]
    // item maior que o próprio carro é leitura errada
    .filter((c) => !(F > 0) || c.valor < F)
    .slice(0, 12);
}

// Origem da venda (25/09 — public.classificar_origem_veiculo): muda o que a análise deve checar.
const ORIGEM_PROMPT = {
  judicial: 'Judicial — há processo; confira no edital ônus, débitos que ficam com o arrematante e prazo de entrega',
  financeira: 'Financeira/banco — retomada de financiamento; costuma ter documentação regular, confira débitos anteriores',
  seguradora: 'Seguradora — sinistro ou recuperado de roubo; a MONTA (pequena/média/grande) e o histórico definem o valor',
  patio: 'Detran/pátio — removido ou apreendido; atenção a débitos, restrições (RENAJUD) e se sai com documento ou só baixa',
  orgao_publico: 'Órgão público — frota pública usada; desgaste de uso intenso é comum, manutenção costuma ser registrada',
  corporativo: 'Corporativo — empresa vendendo a própria frota; em geral manutenção em dia e documentação regular',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  // Regeração pelo servidor (30/09, `regenerar-relatorios-cron?veiculo=`): CRON_SECRET + dono da
  // análise. Só REGERA o que já existe para esse dono (conferido abaixo) e nunca mexe em cota.
  const paraUserId = String(req.body?.paraUserId || '');
  const viaCron = isCronAuthorized(req) && /^[0-9a-f-]{36}$/i.test(paraUserId);
  const user = viaCron ? { id: paraUserId } : await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const veiculoId = String(req.body?.veiculoId || '').trim();
  if (!veiculoId) { res.status(400).json({ error: 'veiculoId obrigatório' }); return; }

  // Sempre lê o veículo FRESCO do banco — nunca confia num snapshot que o cliente mandou (foi
  // exatamente isso que causou o "lance mínimo ausente" do relatório de imóvel em 20/09: um
  // payload incompleto persistido e nunca mais atualizado).
  const rv = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(veiculoId)}&select=*&limit=1`);
  const [v] = rv.ok ? await rv.json() : [];
  if (!v) { res.status(404).json({ error: 'Veículo não encontrado' }); return; }

  // Leilão já ocorrido → não gera e não cobra (mesma regra do imóvel, api/_leilao-encerrado.js).
  if (v.data_leilao && new Date(v.data_leilao).getTime() < Date.now()) {
    res.status(422).json({ error: 'Leilão já encerrado — não é possível gerar o relatório para este veículo.', leilaoEncerrado: true });
    return;
  }

  if (viaCron) {
    const rExiste = await sb(`analises_veiculo?user_id=eq.${user.id}&veiculo_id=eq.${encodeURIComponent(veiculoId)}&select=id&limit=1`);
    const existe = rExiste.ok ? await rExiste.json() : null;
    if (!Array.isArray(existe) || !existe.length) { res.status(rExiste.ok ? 404 : 502).json({ error: rExiste.ok ? 'Sem análise anterior deste veículo para esse usuário — regeração não cria análise nova.' : 'Não consegui conferir a análise anterior.' }); return; }
  }

  // ── Cota no servidor (mesmo padrão de consumir_analise_por) ──
  let cota = null;
  let cobrarCredito = false;
  if (!viaCron) try {
    const jaConcluida = await (await sb(`analises_veiculo?user_id=eq.${user.id}&veiculo_id=eq.${encodeURIComponent(veiculoId)}&status=eq.concluida&select=veiculo_id&limit=1`)).json();
    const isNovo = !(Array.isArray(jaConcluida) && jaConcluida.length);
    if (isNovo) {
      const rc = await sb('rpc/consumir_veiculo_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) });
      cota = await rc.json().catch(() => null); // padrao-ok: leitura best-effort — cota null (rc falhou) cai no catch externo e NÃO bloqueia, mesmo padrão de api/gerar-analise.js
      if (cota && cota.ok === false) {
        const EST_VEICULO_MICRO = 400000; // ~US$0,40 (1 chamada, poucos documentos)
        const pode = await sb('rpc/pode_debitar', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_custo_micro_estimado: EST_VEICULO_MICRO }) });
        const podeCredito = await pode.json().catch(() => false); // padrao-ok: leitura falhou → nega crédito (resposta segura), nunca libera geração não paga
        if (podeCredito === true) {
          cobrarCredito = true;
        } else {
          res.status(402).json({ error: 'Sua cota mensal de análises de veículo acabou. Recarregue créditos para gerar relatórios adicionais.', motivo: 'sem_credito', cota });
          return;
        }
      }
    }
  } catch { /* checagem de cota nunca bloqueia quem tem direito */ }

  const T0 = Date.now();
  const HARD_MS = 105000; // < maxDuration 120s, deixa margem p/ gravar erro/concluída e responder

  const base = {
    user_id: user.id, veiculo_id: veiculoId,
    titulo: v.titulo || [v.marca, v.modelo].filter(Boolean).join(' ') || null,
    marca: v.marca || null, modelo: v.modelo || null, veiculo: v,
  };
  await upsertAnaliseVeiculo({ ...base, status: 'gerando', erro: null });

  const estornar = async () => {
    if (cota?.ok && cota.tipo && !cobrarCredito) {
      try { await sb('rpc/estornar_veiculo_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* best-effort */ }
    }
  };

  try {
    const percentualFipe = (v.valor_fipe > 0 && (v.fipe_status === 'ok' || v.fipe_status === 'aproximado') && v.valor_minimo > 0)
      ? (Number(v.valor_minimo) / Number(v.valor_fipe)) * 100
      : null;
    const faixa = faixaFipe(percentualFipe);

    // Em paralelo com a análise: não soma tempo ao relatório (prazo próprio, dentro do teto).
    // `gastoBusca` soma o custo da busca de anúncios para entrar no débito do crédito (revisão 29/09:
    // o débito cobrava só a análise principal e a busca saía de graça para quem paga por crédito).
    const gastoBusca = { micro: 0 };
    // Prazo da busca 70 → 93 s (30/09): a 2ª tentativa (Sonnet, busca dinâmica) abortava com ~45 s
    // sobrando nos 4 veículos regerados. A análise principal corre em paralelo e termina antes.
    const revendaP = buscarRevendaMercado(v, Math.min(70000, HARD_MS - 25000), user.id, gastoBusca);
    const prazoDocs = T0 + Math.min(45000, HARD_MS - 30000);
    const [blocosDoc, pagina, comissaoIrmaos] = await Promise.all([
      anexosParaBlocos(v.anexos, prazoDocs),
      lerPaginaDoLote(v.link_lote, prazoDocs),
      comissaoDoMesmoLeilao(v),
    ]);
    const semDocumentos = blocosDoc.length === 0 && !String(v.descricao || '').trim() && !pagina.texto;
    // Taxas que a plataforma publica em campo próprio (SODRÉ: "Comissão: 5.00% do valor do lance,
    // Depósito de Bens: R$ 550,00, ..."). Vão para a IA e para a leitura determinística abaixo.
    const taxasPlataforma = consertarAcentos(v?.raw?.lot_rate_information || '').slice(0, 600);
    const textoDoLote = [v.descricao, taxasPlataforma, pagina.texto].filter(Boolean).join(' \n ');

    const content = [...blocosDoc, { type: 'text', text: promptVeiculo(v, percentualFipe, faixa, { paginaTexto: pagina.texto, taxasPlataforma }) }];
    const r = await anthropicFetch({
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2600,
        system: 'Você é um avaliador de veículos de leilão. Responda SOMENTE JSON válido, sem markdown ao redor.',
        messages: [{ role: 'user', content }],
      }),
    }, { retries: 1, timeoutMs: Math.max(20000, HARD_MS - (Date.now() - T0) - 10000), noFallback: true });

    if (!r.ok) {
      let corpo = ''; try { corpo = await r.text(); } catch { /* sem corpo */ }
      throw new Error(`anthropic_http_${r.status}: ${corpo.slice(0, 300)}`);
    }
    const data = await r.json();
    try { registrarCustoGeracao('veiculo', { userId: user.id, custoMicro: custoRespostaClaude(MODEL, data?.usage), ok: true, meta: { veiculoId } }); } catch { /* medição não bloqueia */ }
    const parsed = parseJSON(extractText(data)) || {};

    if (!String(parsed.parecer || '').trim()) {
      // Sem parecer = falha, não "veículo sem informação" — estorna, nunca cobra o vazio
      // (mesma regra de "resposta de erro não é conteúdo válido" do CLAUDE.md).
      await estornar();
      await upsertAnaliseVeiculo({ ...base, status: 'erro', erro: 'Resposta vazia da IA' });
      res.status(502).json({ error: 'Não foi possível gerar o relatório agora. Tente novamente.' });
      return;
    }

    const result = {
      parecer: parsed.parecer,
      riscos: Array.isArray(parsed.riscos) ? parsed.riscos.filter((r) => typeof r === 'string' && r.trim()) : [],
      condicoesResumo: typeof parsed.condicoesResumo === 'string' ? parsed.condicoesResumo : '',
      recomendacao: ['comprar', 'avaliar_com_cautela', 'evitar'].includes(parsed.recomendacao) ? parsed.recomendacao : null,
      // Custos para o teto de lance (29/09). Valida o que vem da IA: número positivo, menor que a
      // FIPE (item maior que o próprio carro é leitura errada), origem conhecida, no máximo 12.
      // Comissão (30/09): o que o LOTE declara vence; depois a IA (que leu anexos e página); depois
      // outro lote do mesmo evento; só então a tela presume 5% — e diz de onde veio cada uma.
      ...comissaoComFonte({ pagina, textoDoLote, ia: parsed.comissaoLeiloeiroPct, iaTrecho: parsed.comissaoTrecho, irmaos: comissaoIrmaos }),
      // Débitos/taxas COM valor declarado. Reparo nunca tem valor aqui (dono, 30/09: "citar, sem
      // valores") — vai em `reparos`. A leitura determinística cobre o que a IA deixar passar.
      // Só descrição + taxas da plataforma: a página pode listar OUTROS lotes ("veja também") e o valor
      // de outro carro entraria aqui — a página inteira vai só para a IA, que lê o contexto.
      custos: juntarDebitos(parsed.custos, extrairDebitosDeclarados([v.descricao, taxasPlataforma].filter(Boolean).join(' \n ')), v.valor_fipe),
      debitosSemValor: listaDeTextos(parsed.debitosSemValor),
      reparos: listaDeTextos(parsed.reparos),
      paginaLote: pagina.motivo || 'lida',
      // Parcelamento (29/09): só com sinal e nº de parcelas plausíveis — valor fora disso é leitura errada.
      parcelamento: (() => {
        const p = parsed.parcelamento;
        const e = Number(p?.entradaPct), n = Math.round(Number(p?.parcelas));
        return p && e >= 5 && e < 100 && n >= 2 && n <= 60 ? { entradaPct: e, parcelas: n, correcao: typeof p.correcao === 'string' ? p.correcao.slice(0, 120) : null } : null;
      })(),
      fipeValor: v.valor_fipe || null, fipeStatus: v.fipe_status || null, fipeMesReferencia: v.fipe_mes_referencia || null,
      valorMinimo: v.valor_minimo || null, percentualFipe, faixaFipe: faixa,
      // Revenda sugerida pelo mercado (média dos 5 anúncios mais baratos − 10%) ou o motivo de não ter.
      ...(await revendaP.then(({ revenda, motivo }) => ({ revendaMercado: revenda, revendaMercadoMotivo: motivo }))),
      semDocumentos,
    };
    await upsertAnaliseVeiculo({ ...base, status: 'concluida', erro: null, result });

    if (cobrarCredito) {
      try {
        await sb('rpc/debitar_credito', { method: 'POST', body: JSON.stringify({
          p_user_id: user.id, p_func: 'veiculo', p_custo_micro: Math.round(custoRespostaClaude(MODEL, data?.usage) + gastoBusca.micro),
          p_justificativa: 'Análise de veículo (cota mensal esgotada)', p_referencia: veiculoId,
        }) });
      } catch { /* best-effort — nunca desfaz um relatório já entregue */ }
    }
    res.status(200).json({ ok: true, status: 'concluida' });
  } catch (e) {
    await estornar();
    await upsertAnaliseVeiculo({ ...base, status: 'erro', erro: String(e?.message || e).slice(0, 500) });
    res.status(500).json({ error: 'Falha ao gerar o relatório do veículo.' });
  }
}
