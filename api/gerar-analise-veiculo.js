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

import { garantirFipe } from './_fipe-garantir.js';
import { sinalVendaRestrita } from './_venda-restrita.js';
import { getUser, isCronAuthorized } from './_auth.js';
import { ehEquipe } from './_leilao-encerrado.js';
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude, registrarCustoGeracao } from './_uso.js';
import { fetchExternoSeguro } from './_allowed-hosts.js';
import { buscarComProva, EXIGE_BUSCA } from './_busca-com-prova.js';
import { comCascataBusca } from './_busca-modelo.js';
import { revendaPorAnuncios, extrairComissaoPct, extrairDebitosDeclarados, consertarAcentos, marcaMobiauto, modelosMobiauto, anunciosMobiauto, filtrarVersao, modeloDoTitulo, slugsModeloMobiauto, anunciosOlx } from '../src/utils/viabilidadeVeiculo.js';
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
// LANÇA em não-2xx (04/10, varredura): antes a gravação de 'concluida' podia falhar calada — cota
// consumida, resposta 200 e a tela presa em "gerando". Mesmo contrato do mercadológico/documental.
async function upsertAnaliseVeiculo(row) {
  const r = await sb('analises_veiculo?on_conflict=user_id,veiculo_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`analises_veiculo ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
}

// REVENDA PELA WEBMOTORS (29/09, pedido do dono): média dos 5 anúncios mais baratos − 10%.
// A API/listagem da Webmotors bloqueia robô (PerimeterX) e o robots.txt proíbe a busca
// automatizada — a Bright Data recusou "em respeito ao robots.txt". O caminho legítimo é a
// busca web da IA (anúncios PÚBLICOS indexados), com PROVA de que pesquisou (_busca-com-prova:
// resposta sem busca é falha, nunca "mercado vazio"). A conta dos 5 mais baratos é feita aqui,
// no código (revendaPorAnuncios), nunca pela IA. Devolve { revenda, motivo } — nunca lança.
// REVENDA PELOS PORTAIS (30/09) — 1ª opção, GRÁTIS e determinística, lida via banco (a Webmotors dá
// 403 ao banco e à Vercel; o Mercado Livre devolve a página de "tráfego suspeito"). MOBIAUTO e OLX
// em PARALELO e as amostras SOMADAS (dono, 30/09: "buscar uma quantidade satisfatória para calcular
// o preço médio"). Só cai na busca web paga se o conjunto não tiver 3 comparáveis. Nunca lança.
async function anunciosDoMobiauto(v, deadline) {
  const marca = marcaMobiauto(v.marca);
  const ano = Number(v.ano_modelo || v.ano_fabricacao) || null;
  const modeloTxt = v.modelo || modeloDoTitulo(v.titulo, v.marca);
  const candidatos = modelosMobiauto(modeloTxt);
  if (!marca || !ano || !candidatos.length) return { anuncios: [], motivo: 'Mobiauto: sem marca/modelo/ano' };
  const motivos = [];
  const ler = async (modelo) => {
    const url = `https://www.mobiauto.com.br/comprar/carros/brasil/${marca}/${modelo}/ano-${ano}`;
    const b = await paginaViaBanco(url, deadline);
    if (!b.html) { motivos.push(`${modelo}: ${b.motivo}`); return []; }
    const a = anunciosMobiauto(b.html, { marca, modelo, ano });
    if (!a.length) motivos.push(`${modelo}: 0 anúncios`);
    return a;
  };
  for (const modelo of candidatos) {
    if (Date.now() > deadline - 3000) { motivos.push('sem tempo'); break; }
    const a = await ler(modelo);
    if (a.length) return { anuncios: a, motivo: null };
  }
  // Nenhum candidato tem o ano: o portal pode usar um nome mais longo ("L200 TRITON" 2021 só existe
  // como "l200-triton-sport") — a página da MARCA/ANO lista os slugs que existem; lê os que começam
  // pelo candidato (no máx. 2, para caber no prazo).
  if (Date.now() < deadline - 6000) {
    const b = await paginaViaBanco(`https://www.mobiauto.com.br/comprar/carros/brasil/${marca}/ano-${ano}`, deadline);
    const achados = b.html ? slugsModeloMobiauto(b.html, marca, candidatos).filter((m) => !candidatos.includes(m)).slice(0, 2) : [];
    if (!b.html) motivos.push(`página da marca/ano: ${b.motivo}`);
    const listas = await Promise.all(achados.map((m) => ler(m)));
    const todos = listas.flat();
    if (todos.length) return { anuncios: todos, motivo: null };
  }
  return { anuncios: [], motivo: `Mobiauto: ${motivos.join('; ')}` };
}

async function anunciosDaOlx(v, deadline) {
  const ano = Number(v.ano_modelo || v.ano_fabricacao) || null;
  const modeloTxt = v.modelo || modeloDoTitulo(v.titulo, v.marca);
  const marca = String(v.marca || '').replace(/^i\s*\//i, '').split(/\s+-\s+|\//).pop().trim();
  // Marca + 2 primeiras palavras do modelo + ano: específico o bastante para a busca, sem a versão
  // (a versão é filtrada depois — pô-la na busca zera o resultado quando o anunciante abrevia).
  const termos = [marca, ...String(modeloTxt || '').split(/\s+/).filter((t) => !/^nov[oa]$/i.test(t)).slice(0, 2), ano].filter(Boolean).join(' ');
  if (!ano || !modeloTxt) return { anuncios: [], motivo: 'OLX: sem modelo/ano' };
  const url = `https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios?q=${encodeURIComponent(termos.toLowerCase())}`;
  const b = await paginaViaBanco(url, deadline);
  if (!b.html) return { anuncios: [], motivo: `OLX: ${b.motivo}` };
  const a = anunciosOlx(b.html, { ano, modelo: modeloTxt });
  return { anuncios: a, motivo: a.length ? null : 'OLX: 0 anúncios do modelo/ano' };
}

async function buscarRevendaMercado(v, prazoMs, userId, gasto = { micro: 0 }) {
  // PRAZO ÚNICO (01/10): portais + busca web cabem em `prazoMs` SOMADOS. Antes a busca web recebia o
  // prazo inteiro de novo, por degrau (portais 30 s + 70 s + 70 s > maxDuration 120 s): a Vercel
  // matava a função e o relatório ficava "gerando" para sempre, sem estorno — o defeito do índice.
  const fim = Date.now() + prazoMs;
  const deadline = Math.min(fim, Date.now() + 30000);
  const [mob, olx] = await Promise.all([anunciosDoMobiauto(v, deadline), anunciosDaOlx(v, deadline)]);
  const todos = [...mob.anuncios, ...olx.anuncios];
  const modeloTxt = v.modelo || modeloDoTitulo(v.titulo, v.marca);
  if (todos.length) {
    // Palavras do nome do modelo (candidatos + slug que o Mobiauto de fato usou) não são versão.
    const nomesModelo = [...modelosMobiauto(modeloTxt), ...mob.anuncios.map((a) => String(a.url || '').split('/')[7] || '')];
    const f = filtrarVersao(todos, modeloTxt, nomesModelo);
    const revenda = revendaPorAnuncios(f.lista, v.valor_fipe);
    if (revenda) return { revenda: { ...revenda, mesmaVersao: f.versao }, motivo: null };
  }
  const motivoPortais = [mob.motivo, olx.motivo, todos.length ? `${todos.length} anúncio(s) nos portais, menos de 3 na faixa de 30–200% da FIPE` : null].filter(Boolean).join('; ');
  if (fim - Date.now() < 15000) return { revenda: null, motivo: [motivoPortais, 'sem tempo para a busca de anúncios na web'].filter(Boolean).join(' · ') };
  const r = await buscarRevendaWeb(v, fim, userId, gasto);
  return r.revenda ? r : { revenda: null, motivo: [motivoPortais, r.motivo].filter(Boolean).join(' · ') };
}

async function buscarRevendaWeb(v, fim, userId, gasto = { micro: 0 }) {
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
    // Cada degrau recebe só o que SOBRA do prazo; sobe de degrau só com 25 s de folga.
    const anuncios = await comCascataBusca((degrau) => tentar(degrau, Math.max(10000, Math.min(fim - Date.now(), 70000))),
      { podeContinuar: () => fim - Date.now() > 25000 })
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

// Quebra de linha/tabulação CRUA dentro de string JSON (03/10, Equinox EV: parecer completo,
// stop=end_turn, 4.375 caracteres — e JSON.parse recusou). O parecer é markdown longo e o modelo às
// vezes solta "\n" literal no meio da string; isso é JSON inválido, não resposta vazia. Escapa só o
// que está DENTRO de string (fora dela, quebra de linha é espaço em branco legítimo).
export function escaparControlesEmString(s) {
  let out = '', dentro = false, esc = false;
  for (const ch of s) {
    if (dentro) {
      if (esc) { esc = false; out += ch; continue; }
      if (ch === '\\') { esc = true; out += ch; continue; }
      if (ch === '"') { dentro = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { out += '\\r'; continue; }
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else {
      if (ch === '"') dentro = true;
      out += ch;
    }
  }
  return out;
}

export function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  const tentar = (s) => { try { return JSON.parse(s); } catch { /* tenta a versão com controles escapados */ }
    try { return JSON.parse(escaparControlesEmString(s)); } catch { return null; } };
  const direto = tentar(clean);
  if (direto) return direto;
  // Do 1º "{" ao ÚLTIMO "}": cobre a cerca ```json``` e também um ``` DENTRO do parecer, que fazia o
  // recorte não-guloso da cerca parar no meio do JSON.
  const ini = clean.indexOf('{'), fimObj = clean.lastIndexOf('}');
  if (ini >= 0 && fimObj > ini) { const j = tentar(clean.slice(ini, fimObj + 1)); if (j) return j; }
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { const j = tentar(md[1].trim()); if (j) return j; }
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

// CONDIÇÕES DE PAGAMENTO DA PLATAFORMA (10/10, dono: "a IA deve identificar as formas de pagamento
// disponíveis e quanto seria a comissão do leiloeiro"). A SUPERBID publica no estado da página
// (__NEXT_DATA__) da oferta: `groupOffer.commissionPercent` (a comissão de verdade — o campo
// `commercialCondition.auctioneerCommissionPercent`, que líamos sozinho, vem NULO: medido em 10/10
// nas 5 ofertas com relatório, todas "5%, presumida" com 5% publicado ao lado) e
// `commercialCondition` (cartão, limite do cartão, parcelas, entrada mínima). Procura a oferta PELO ID
// (a página também lista outras ofertas do evento) e só cai no primeiro objeto quando não acha o id.
function condicoesDaPlataforma(html, url) {
  const vazio = { comissaoPct: null, formas: [], parcelamento: null };
  const m = String(html || '').match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return vazio;
  let raiz; try { raiz = JSON.parse(m[1]); } catch { return vazio; } // estado da página ilegível = sem condições; o relatório segue pelo texto
  const idOferta = Number((String(url || '').match(/\/oferta\/(\d+)/) || [])[1]) || null;
  let doId = null, primeiro = null, passos = 0;
  const visitar = (no, prof) => {
    if (doId || !no || typeof no !== 'object' || prof > 14 || ++passos > 60000) return;
    if (!Array.isArray(no) && (no.commercialCondition || no.groupOffer)) {
      if (idOferta && Number(no.id) === idOferta) { doId = no; return; }
      if (!primeiro) primeiro = no;
    }
    for (const v of Array.isArray(no) ? no : Object.values(no)) visitar(v, prof + 1);
  };
  visitar(raiz, 0);
  const of = doId || (idOferta ? null : primeiro);
  if (!of) return vazio;
  const cc = of.commercialCondition || {};
  const pct = [cc.auctioneerCommissionPercent, of.groupOffer?.commissionPercent].map(Number).find((n) => n > 0 && n <= 20) ?? null;
  const formas = ['À vista (pagamento do lote, comissão e encargos)'];
  const lim = Number(cc.transactionLimit);
  if (cc.allowsCreditCard) {
    formas.push(`Cartão de crédito${cc.allowCreditCardTotalValue === false ? ' (parte do valor)' : ''}${lim > 0 ? ` para lotes de até ${brl(lim)}` : ''}${cc.allowCreditCardCommission === false ? ' — a comissão do leiloeiro não entra no cartão' : ''}`);
  }
  const nParc = Math.round(Number(cc.maxInstallments)), entrada = Number(cc.minAdvanceRate);
  const parcelamento = nParc >= 2 && nParc <= 60 && entrada >= 5 && entrada < 100 ? { entradaPct: entrada, parcelas: nParc, correcao: null } : null;
  if (parcelamento) formas.push(`Parcelado: entrada mínima de ${entrada}% + até ${nParc} parcelas`);
  return { comissaoPct: pct, formas, parcelamento };
}

async function lerPaginaDoLote(url, deadline) {
  if (!/^https?:\/\//i.test(String(url || ''))) return { texto: '', comissaoPct: null, plataforma: null, motivo: 'sem link do lote' };
  try {
    let html = null, motivoDireto = null;
    try {
      const r = await fetchExternoSeguro(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, signal: AbortSignal.timeout(Math.max(3000, Math.min(10000, deadline - Date.now()))) });
      if (r.ok) html = (await r.text()).slice(0, 3_000_000);
      else motivoDireto = `HTTP ${r.status}`;
    } catch (e) { motivoDireto = String(e?.message || e).slice(0, 60); }
    if (!html) {
      const b = await paginaViaBanco(url, deadline);
      if (!b.html) return { texto: '', comissaoPct: null, plataforma: null, motivo: `página do lote indisponível (direto: ${motivoDireto}; banco: ${b.motivo})` };
      html = b.html.slice(0, 3_000_000);
    }
    const m = html.match(/"auctioneerCommissionPercent"\s*:\s*(\d+(?:\.\d+)?)/);
    const texto = consertarAcentos(html
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
      .replace(/\s+/g, ' ')).trim().slice(0, 12000);
    const plataforma = condicoesDaPlataforma(html, url);
    const pct = m ? Number(m[1]) : null;
    return { texto, comissaoPct: pct > 0 && pct <= 20 ? pct : plataforma.comissaoPct, plataforma, motivo: texto ? null : 'página do lote sem texto legível' };
  } catch (e) {
    return { texto: '', comissaoPct: null, plataforma: null, motivo: `página do lote ilegível: ${String(e?.message || e).slice(0, 60)}` };
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
- Formas de pagamento publicadas pela plataforma: ${extra.formasPlataforma?.length ? extra.formasPlataforma.join('; ') : 'não publicadas em campo próprio — procure no edital, na página e na descrição (o "à vista" do cadastro é padrão da coleta, NÃO é condição do edital)'}
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
  "formasPagamento": ["cada forma de pagamento que o edital, a página ou a descrição ACEITAM, uma por item, com a condição (ex.: 'à vista em até 24h após a aprovação, por TED/boleto', 'cartão de crédito', 'parcelado: 30% de entrada + 10 parcelas', 'financiamento'). Vazio se nenhum deles disser."],
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
  // Equipe passa (proposta de compra direta pós-leilão — ver ehEquipe em api/_leilao-encerrado.js).
  if (v.data_leilao && new Date(v.data_leilao).getTime() < Date.now() && !(viaCron || await ehEquipe(sb, user.id))) {
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
  try {
    await upsertAnaliseVeiculo({ ...base, status: 'gerando', erro: null });
  } catch (e) {
    console.error('[veiculo] gravação inicial falhou:', e?.message || e);
    if (cota?.ok && cota.tipo && !cobrarCredito) {
      try { await sb('rpc/estornar_veiculo_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch (e2) { console.error('[veiculo] estorno falhou:', e2?.message || e2); }
    }
    res.status(503).json({ error: 'Não consegui iniciar o relatório agora (banco indisponível). Nada foi cobrado — tente de novo em instantes.' });
    return;
  }

  // FIPE NUNCA FALTA NO RELATÓRIO (02/10, dono: "temos marca, nome, ano e modelo — conseguimos
  // triangular"). Sem valor válido, tenta AGORA — forçando por cima da espera de 90 dias de um
  // `sem_match` antigo — com a mesma régua da tela (api/_fipe-garantir.js: ano pelo edital, cache,
  // cota e triangulação por ano+combustível). Teto de 25 s: não pode comer o prazo da análise.
  if (!(Number(v.valor_fipe) > 0 && ['ok', 'aproximado'].includes(v.fipe_status))) {
    try {
      const fipe = await Promise.race([
        garantirFipe(v, { forcar: true }),
        new Promise((ok) => setTimeout(() => ok(null), 25000)),
      ]);
      if (fipe?.valor_fipe > 0) Object.assign(v, { valor_fipe: fipe.valor_fipe, fipe_status: fipe.fipe_status, fipe_mes_referencia: fipe.fipe_mes_referencia, fipe_codigo: fipe.fipe_codigo });
      else console.warn(`[veiculo] FIPE não obtida para ${veiculoId}: ${fipe ? `${fipe.fipe_status}${fipe.motivo ? ` — ${fipe.motivo}` : ''}${fipe.cota_esgotada ? ' (cota do dia esgotada)' : ''}` : 'sem resposta em 25 s'}`);
    } catch (e) { console.warn(`[veiculo] FIPE falhou para ${veiculoId}:`, e?.message || e); }
  }

  let estornado = false; // idempotente: o catch final também chama, e o estorno não pode sair 2×
  const estornar = async () => {
    if (estornado) return;
    estornado = true;
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
    // Prazo TOTAL da busca (portais + web): 80 s, dentro do teto. A análise principal corre em paralelo.
    const revendaP = buscarRevendaMercado(v, Math.max(20000, HARD_MS - 25000 - (Date.now() - T0)), user.id, gastoBusca);
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

    const content = [...blocosDoc, { type: 'text', text: promptVeiculo(v, percentualFipe, faixa, { paginaTexto: pagina.texto, taxasPlataforma, formasPlataforma: pagina.plataforma?.formas }) }];
    // UMA chamada ao modelo. Chamada de novo, uma vez, quando o JSON volta inválido (ver abaixo).
    const chamarModelo = async () => {
      const r = await anthropicFetch({
        method: 'POST',
        headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          // 2600 → 4000 (30/09): com reparos, débitos e a página inteira do lote na entrada, a Strada
          // 2025 voltou 2× "Resposta vazia" — JSON cortado no teto de saída não parseia.
          model: MODEL, max_tokens: 4000,
          system: 'Você é um avaliador de veículos de leilão. Responda SOMENTE JSON válido, sem markdown ao redor.',
          messages: [{ role: 'user', content }],
        }),
      }, { retries: 1, timeoutMs: Math.max(20000, HARD_MS - (Date.now() - T0) - 10000), noFallback: true });
      if (!r.ok) {
        let corpo = ''; try { corpo = await r.text(); } catch { /* sem corpo */ }
        throw new Error(`anthropic_http_${r.status}: ${corpo.slice(0, 300)}`);
      }
      const d = await r.json();
      try { registrarCustoGeracao('veiculo', { userId: user.id, custoMicro: custoRespostaClaude(MODEL, d?.usage), ok: true, meta: { veiculoId } }); } catch { /* medição não bloqueia */ }
      return d;
    };
    let data = await chamarModelo();
    let parsed = parseJSON(extractText(data)) || {};
    // JSON INVÁLIDO NÃO É RESPOSTA VAZIA (03/10, Equinox EV): o parecer veio inteiro (stop=end_turn) e o
    // parse falhou — o relatório caía e o admin teve de clicar de novo, quando a 2ª geração saiu em 30 s.
    // Repete UMA vez, só se o texto veio (não é recusa/vazio) e ainda sobra prazo para outra chamada.
    if (!String(parsed.parecer || '').trim() && extractText(data).trim() && data?.stop_reason === 'end_turn'
        && HARD_MS - (Date.now() - T0) > 45000) {
      console.warn(`[veiculo] JSON inválido na 1ª resposta (${veiculoId}) — repetindo uma vez`);
      data = await chamarModelo();
      parsed = parseJSON(extractText(data)) || {};
    }

    if (!String(parsed.parecer || '').trim()) {
      // Sem parecer = falha, não "veículo sem informação" — estorna, nunca cobra o vazio
      // (mesma regra de "resposta de erro não é conteúdo válido" do CLAUDE.md).
      await estornar();
      // O MOTIVO vai junto (30/09): "vazia" sozinho não separava JSON cortado no teto de saída
      // (stop_reason=max_tokens) de recusa ou de formato inesperado.
      const bruto = extractText(data);
      const motivoVazio = `${bruto.trim() ? 'JSON inválido' : 'sem texto'}, stop=${data?.stop_reason || '?'}, ${bruto.length} chars${bruto ? `: ${bruto.slice(0, 120)}` : ''}`;
      console.error(`[veiculo] resposta sem parecer (${veiculoId}): ${motivoVazio}`);
      await upsertAnaliseVeiculo({ ...base, status: 'erro', erro: `Resposta ${bruto.trim() ? 'inválida' : 'vazia'} da IA (${motivoVazio})`.slice(0, 300) });
      res.status(502).json({ error: 'Não foi possível gerar o relatório agora. Tente novamente.' });
      return;
    }

    const result = {
      parecer: parsed.parecer,
      // Venda restrita (01/10): ciência no topo dos riscos, determinística — a IA não vê esse sinal.
      riscos: [
        ...((() => { const sr = sinalVendaRestrita({ raw: v?.raw, descricao: v?.descricao, titulo: v?.titulo }); return sr ? [sr.aviso] : []; })()),
        ...(Array.isArray(parsed.riscos) ? parsed.riscos.filter((r) => typeof r === 'string' && r.trim()) : []),
      ],
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
      // O publicado pela plataforma em campo próprio vence a leitura da IA (10/10).
      parcelamento: pagina.plataforma?.parcelamento || (() => {
        const p = parsed.parcelamento;
        const e = Number(p?.entradaPct), n = Math.round(Number(p?.parcelas));
        return p && e >= 5 && e < 100 && n >= 2 && n <= 60 ? { entradaPct: e, parcelas: n, correcao: typeof p.correcao === 'string' ? p.correcao.slice(0, 120) : null } : null;
      })(),
      // Formas de pagamento (10/10): campo da plataforma + o que a IA leu no edital/página/descrição.
      // Vazio = ninguém publicou; a tela diz "não informadas" em vez de afirmar "à vista".
      formasPagamento: [...new Set([...(pagina.plataforma?.formas || []), ...listaDeTextos(parsed.formasPagamento)])].slice(0, 8),
      formasPagamentoFonte: pagina.plataforma?.formas?.length ? 'página do lote (campos da plataforma)' : (listaDeTextos(parsed.formasPagamento).length ? 'edital/página/descrição (leitura da IA)' : null),
      fipeValor: v.valor_fipe || null, fipeStatus: v.fipe_status || null, fipeMesReferencia: v.fipe_mes_referencia || null,
      valorMinimo: v.valor_minimo || null, percentualFipe, faixaFipe: faixa,
      // Revenda sugerida pelo mercado (média dos 5 anúncios mais baratos − 10%) ou o motivo de não ter.
      // Espera LIMITADA: se a busca ainda não voltou perto do teto, o relatório sai sem a revenda e
      // diz por quê — melhor que a Vercel matar a função com o relatório pronto na memória.
      ...(await Promise.race([
        revendaP.catch((e) => ({ revenda: null, motivo: `busca de anúncios falhou: ${String(e?.message || e).slice(0, 80)}` })),
        new Promise((ok) => setTimeout(() => ok({ revenda: null, motivo: 'busca de anúncios não terminou a tempo' }), Math.max(1000, HARD_MS - (Date.now() - T0)))),
      ]).then(({ revenda, motivo }) => ({ revendaMercado: revenda, revendaMercadoMotivo: motivo }))),
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
    try { await upsertAnaliseVeiculo({ ...base, status: 'erro', erro: String(e?.message || e).slice(0, 500) }); }
    catch (e2) { console.error('[veiculo] registro do erro falhou:', e2?.message || e2); }
    if (!res.headersSent) res.status(500).json({ error: 'Falha ao gerar o relatório do veículo.' });
  }
}
