/**
 * Scraper Cláudio Reis Leiloeiro Oficial (crleiloes.com.br) — imóveis e veículos, via
 * Bright Data Web Unlocker.
 * ────────────────────────────────────────────────────────────────────────────
 * COMO ESTE SITE FOI DESTRAVADO (19/09, mesma classe de achado do RJLEILOES/11/08):
 * o site é 100% atrás de Cloudflare por REPUTAÇÃO DE IP de datacenter — confirmado ao
 * vivo: fetch cru do GitHub Actions em `/bens/pesquisaAvancada` deu HTTP 403 "Just a
 * moment..." em TODAS as páginas, enquanto o MESMO fetch do IP do Supabase (pg_net)
 * passou sem desafio. Dois caminhos foram testados e descartados antes deste:
 *   1. Puppeteer com `puppeteer-extra-plugin-stealth` (grátis, IP de datacenter) —
 *      travou no desafio nos 3 domínios da rede "Plataforma Leiloar" (crleiloes,
 *      leiloesuberlandia) e no lucasleiloeiro; o problema não é fingerprint, é IP.
 *   2. Proxy ISP da Bright Data ($2/IP/mês) + Chromium real — PASSOU o desafio, mas a
 *      rota `/leiloes` (a "vitrine") só mostra ~19 lotes "destaque" renderizados no
 *      servidor; a listagem completa carrega via busca AJAX que uma visita simples de
 *      página não dispara.
 * A rota que RESOLVE os dois problemas de uma vez: `/bens/pesquisaAvancada/page:N` —
 * é o endpoint real de busca do site (form `id="BemPesquisaAvancadaForm"`, CakePHP 2.x,
 * paginação clássica `page:N` na URL), **server-rendered, sem precisar de JS** — só
 * precisa de um IP que o Cloudflare aceite, e é isso que o Web Unlocker (já contratado,
 * cota compartilhada de `api/_brightdata.js`) resolve, mais simples e mais barato que
 * proxy+navegador. 12 lotes por página; `page:N` além do fim REDIRECIONA pra página 1
 * (confirmado: page:4 devolveu o mesmo conjunto de ids da página 1) — é o sinal de fim.
 *
 * O CATÁLOGO É PEQUENO (achado ao medir, não estimado): ~15-20 lotes ativos no total,
 * bem abaixo dos "321 imóveis + 149 veículos" citados num recon anterior (aquele número
 * vinha de um heurística mais grosseira, não de contagem real). E é MISTO: imóveis,
 * veículos E máquinas/equipamentos agrícolas (trator, grade aradora, roçadeira,
 * motoniveladora, compressor) — estes últimos não têm tabela própria no banco (não são
 * nem `imoveis_leilao` nem `veiculos_leilao`) e são ignorados de propósito.
 *
 * SEGURANÇA DE CUSTO (cada request = 1 chamada Bright Data, cota do propósito 'crleiloes'):
 *   - CRLEILOES_MAX_LOTES (default 30): teto de lotes de detalhe por execução — folgado
 *     pro tamanho real do acervo, então normalmente processa tudo numa rodada só.
 *   - CRLEILOES_MAX_PAGES (default 8): teto de páginas de listagem — bem acima do
 *     necessário (medido: 2-3 páginas), só rede de segurança contra crescimento do acervo.
 *   - CRLEILOES_DRYRUN (default '1'): NÃO grava — só busca/parseia e loga o que inseriria.
 *     Mesma lição do RJLEILOES (11/08): default gravando por engano gastou cota 8× sem
 *     gravar nada. Passe CRLEILOES_DRYRUN=0 pra gravar de verdade.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { buscarViaBrightData, brightDataDisponivel, ErroBrightData } from '../api/_brightdata.js';
import { extrairGenerico, checarQualidade } from './lib/scraper-core.mjs';
import { decodificarEntidades } from '../api/_texto-imovel.js';
import { registrarSaude } from './_saude-fonte.mjs';

const BASE = 'https://www.crleiloes.com.br';
const MAX_LOTES = Number(process.env.CRLEILOES_MAX_LOTES || 30);
const MAX_PAGES = Number(process.env.CRLEILOES_MAX_PAGES || 8);
const DRYRUN = process.env.CRLEILOES_DRYRUN !== '0';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (s) => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// Mesma classe de FalhaDeAcesso do scraper-rj.mjs: falha de ACESSO nunca vira "fonte
// vazia" (forma #4 do CLAUDE.md), e `semCota` viaja pro monitor não confundir freio de
// orçamento com regressão da fonte (forma #5).
class FalhaDeAcesso extends Error {
  constructor(motivo, detalhe, semCota = false) {
    super(detalhe ? `${motivo}: ${detalhe}` : motivo);
    this.motivo = motivo;
    this.semCota = semCota === true;
  }
}

async function bd(url, { timeoutMs = 60000 } = {}) {
  let r;
  try {
    r = await buscarViaBrightData(url, { proposito: 'crleiloes', timeoutMs, exigirOk: false });
  } catch (e) {
    if (e instanceof ErroBrightData) throw new FalhaDeAcesso(e.motivo, e.detalhe || e.message, e.semCota);
    throw e;
  }
  const body = await r.text().catch(() => null);
  if (!r.ok) throw new FalhaDeAcesso('http', `HTTP ${r.status} em ${url}`);
  if (body == null) throw new FalhaDeAcesso('corpo_ilegivel', url);
  return body;
}

function inferirTipoImovel(titulo = '') {
  const t = titulo.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  if (/casa|sobrado|resid[êe]nc/.test(t)) return 'casa';
  if (/terreno|gleba|[áa]rea\s+urbana/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]o|pr[ée]dio|escrit[óo]rio/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

// Máquinas/equipamentos não têm tabela própria — nem imóvel, nem veículo. Checa ANTES
// de veículo/imóvel: "carretão DE TRATOR" não pode cair em veículo por causa da palavra solta.
const RE_MAQUINA = /\b(trator|carret[ãa]o|grade\s+arador|ro[çc]adeira|motonivelad|compressor\s+de\s+ar|colheitadeira|retro\s?-?escavadeira|p[áa]\s+carregadeira|implemento\s+agr[íi]cola)\b/i;
const RE_VEICULO = /\b(motocicleta|motoneta|caminh[ãa]o|caminhonete)\b|\bve[íi]culo\b.{0,25}(marca|modelo|placa)/i;
const RE_IMOVEL = /\b(im[óo]vel|casa|apartamento|sobrado|terreno|gleba|pr[ée]dio|comercial|sala\s+comercial|galp[ãa]o|s[íi]tio|fazenda|ch[áa]cara|kitnet|cobertura|\bloja\b)\b/i;

// Retorna 'imovel' | 'veiculo' | null (máquina/ambíguo — melhor não capturar do que
// capturar errado numa tabela que não é a dele).
function classificar(titulo) {
  const t = (titulo || '');
  if (RE_MAQUINA.test(t)) return null;
  if (RE_VEICULO.test(t)) return 'veiculo';
  if (RE_IMOVEL.test(t)) return 'imovel';
  return null;
}

// Extrai os cards `.bem-card` de uma página de listagem. Regex sobre string (não DOM):
// o HTML já chega como texto via Bright Data, sem navegador pra dar querySelector.
function extrairCards(html) {
  const cards = [];
  const blocos = html.split('<div class="bem-card ');
  for (let i = 1; i < blocos.length; i++) {
    const b = blocos[i];
    const idm = b.match(/\/lote\/(\d+)/);
    if (!idm) continue;
    const id = idm[1];
    const tituloM = b.match(/Ver descri[çc][ãa]o completa deste lote"[^>]*>([^<]{1,200})/i);
    const titulo = tituloM ? decodificarEntidades(tituloM[1]).replace(/\s+/g, ' ').trim() : '';
    const avalM = b.match(/Avalia[çc][ãa]o<\/span><h5>\s*R\$\s*([\d.]+,\d{2})/i);
    const lanceM = b.match(/Lance Inicial<\/span><h4>\s*R\$\s*([\d.]+,\d{2})/i);
    const locM = b.match(/bem-card-localizacao"[^>]*>\s*<i[^>]*>\s*<\/i>\s*([^<]+)<\/button>/i);
    const statusM = b.match(/badge-(?:success|danger|warning|secondary)">([^<]+)</i);
    const modM = b.match(/badge-primary">([^<]+)</i);
    let cidade = null, estado = null;
    if (locM) {
      const partes = locM[1].split(',').map((s) => s.trim());
      if (partes.length === 2) { cidade = partes[0]; estado = partes[1]; }
    }
    cards.push({
      id, url: `${BASE}/lote/${id}`, titulo,
      valor_avaliacao: avalM ? num(avalM[1]) : 0,
      valor_minimo: lanceM ? num(lanceM[1]) : 0,
      cidade, estado,
      status: statusM ? statusM[1].trim() : null,
      modalidade: modM ? modM[1].trim() : null,
    });
  }
  return cards;
}

function montarImovel(c, base) {
  return {
    fonte: 'CRLEILOES',
    fonte_id: `crl_${c.id}`,
    titulo: (c.titulo || base.titulo || `Imóvel CRLEILOES ${c.id}`).slice(0, 180),
    tipo: inferirTipoImovel(c.titulo),
    modalidade: /judicial/i.test(c.modalidade || '') ? 'judicial' : 'extrajudicial',
    cidade: c.cidade || null,
    estado: c.estado || null,
    valor_avaliacao: c.valor_avaliacao || base.valor_avaliacao || 0,
    valor_minimo: c.valor_minimo || base.valor_minimo || 0,
    area_m2: 0,
    // A listagem trunca com "...", a página de detalhe (extrairGenerico) traz o corpo
    // completo — só cai pro título curto se o detalhe não achou nada melhor.
    descricao: base.descricao || c.titulo || null,
    link_edital: base.link_edital || c.url,
    url_lote: c.url,
    link_foto: base.link_foto || null,
    numero_matricula: base.numero_matricula || null,
    link_matricula: base.link_matricula || null,
    leiloeiro: 'Cláudio Reis Leiloeiro Oficial',
    data_leilao: base.data_leilao || null,
    forma_pagamento: 'a_vista',
    ativo: true,
    atualizado_em: new Date().toISOString(),
  };
}

const REGEX_ANO = /\b(19[5-9]\d|20[0-4]\d)\/(19[5-9]\d|20[0-4]\d)\b|\b(19[5-9]\d|20[0-4]\d)\b/;
const REGEX_PLACA = /\bplaca[s]?\s*[:\-]?\s*([A-Z]{3}[\s-]?\d[A-Z0-9]\d{2})\b/i;
const REGEX_MARCA = /\b(honda|yamaha|fiat|ford|volkswagen|vw|chevrolet|gm|renault|toyota|hyundai|nissan|peugeot|citroen|jeep|mitsubishi|suzuki|kawasaki|bmw|iveco|scania|volvo|mercedes)\b/i;

function montarVeiculo(c, base, textoDetalhe) {
  const anoM = textoDetalhe.match(REGEX_ANO);
  const placaM = textoDetalhe.match(REGEX_PLACA);
  const marcaM = c.titulo.match(REGEX_MARCA);
  return {
    fonte: 'CRLEILOES',
    fonte_id: `crl_${c.id}`,
    titulo: (c.titulo || `Veículo CRLEILOES ${c.id}`).slice(0, 180),
    descricao: (base.descricao || c.titulo || '').slice(0, 2000),
    marca: marcaM ? marcaM[1].toUpperCase() : null,
    modelo: null,
    ano_fabricacao: anoM ? Number(anoM[1] || anoM[3]) : null,
    ano_modelo: anoM ? Number(anoM[2] || anoM[1] || anoM[3]) : null,
    placa: placaM ? placaM[1].toUpperCase().replace(/\s+/g, '') : null,
    valor_avaliacao: c.valor_avaliacao || 0,
    valor_minimo: c.valor_minimo || 0,
    cidade: c.cidade || null,
    estado: c.estado || null,
    link_lote: c.url,
    fotos: base.link_foto ? [base.link_foto] : [],
    data_leilao: null,
    // Sem sinal de pátio na ficha do crleiloes (não é rede SUPORTE/SUPERBID, sem o texto
    // "em pátio"/"com o executado" padronizado) — honesto marcar indefinido a classificar
    // errado; o mesmo tratamento que outras fontes sem esse sinal já recebem.
    status_patio: 'indefinido',
    status_patio_motivo: 'sem sinal de pátio na ficha (crleiloes)',
    ativo: true,
    modalidade: /judicial/i.test(c.modalidade || '') ? 'judicial' : 'extrajudicial',
    forma_pagamento: 'a_vista',
    leiloeiro: 'Cláudio Reis Leiloeiro Oficial',
    atualizado_em: new Date().toISOString(),
  };
}

async function main() {
  if (!brightDataDisponivel()) {
    throw new FalhaDeAcesso('sem_config', 'BRIGHTDATA_API_TOKEN/ZONE ausentes — crleiloes é 100% Cloudflare (IP de datacenter), só acessível via Web Unlocker');
  }
  console.log(`CRLEILOES ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · max ${MAX_LOTES} lote(s)/run`);

  // 1) Enumeração: /bens/pesquisaAvancada/page:N. page:1 é obrigatória (sem ela não
  //    sabemos nada do acervo); da 2ª em diante uma falha interrompe mas marca INCOMPLETA.
  const mapa = new Map();
  let enumeracaoCompleta = true;
  let idsPagina1 = null;
  for (let p = 1; p <= MAX_PAGES; p++) {
    let html;
    try {
      html = await bd(`${BASE}/bens/pesquisaAvancada/page:${p}`, { timeoutMs: 60000 });
    } catch (e) {
      if (p === 1) throw e;
      enumeracaoCompleta = false;
      console.error(`  página ${p}: FALHA (${e.motivo || e.message}) — parando a paginação.`);
      break;
    }
    const cards = extrairCards(html);
    const idsAtuais = new Set(cards.map((c) => c.id));
    // page:N além do fim REDIRECIONA pra página 1 — mesmo conjunto de ids = fim da lista.
    if (idsPagina1 && p > 1 && cards.length && [...idsAtuais].every((id) => idsPagina1.has(id))) {
      console.log(`  página ${p}: repetiu a página 1 — fim da paginação.`);
      break;
    }
    for (const c of cards) if (!mapa.has(c.id)) mapa.set(c.id, c);
    console.log(`  página ${p}: ${cards.length} card(s) (total ${mapa.size})`);
    if (p === 1) idsPagina1 = idsAtuais;
    if (!cards.length) break;
    await sleep(300);
  }

  const todos = [...mapa.values()];
  if (!todos.length) {
    await registrarSaude(supabase, 'CRLEILOES', [], 'principal',
      { ok: false, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 }, motivo: 'listagem lida, zero lotes' });
    console.error('Listagem lida, mas sem nenhum card `.bem-card`. Estrutura do site pode ter mudado.');
    return { gravados: 0, vazioConfirmado: true };
  }
  const ativos = todos.filter((c) => !c.status || /aberto/i.test(c.status));
  console.log(`Enumerados ${todos.length} lote(s) · ${ativos.length} ABERTO(s)${enumeracaoCompleta ? '' : ' (ENUMERAÇÃO INCOMPLETA)'}.`);

  const classificados = ativos
    .map((c) => ({ ...c, categoria: classificar(c.titulo) }))
    .filter((c) => c.categoria);
  const nImov = classificados.filter((c) => c.categoria === 'imovel').length;
  const nVeic = classificados.filter((c) => c.categoria === 'veiculo').length;
  console.log(`Classificados: ${nImov} imóvel(is) · ${nVeic} veículo(s) (o resto é máquina/ambíguo — ignorado de propósito).`);

  const alvo = classificados.slice(0, MAX_LOTES);

  // 2) Detalhe de cada lote alvo — a listagem trunca a descrição com "...".
  const imoveisProntos = [];
  const veiculosProntos = [];
  let sem = 0, reprov = 0, recusaDeCota = null, cotaNegada = 0;
  const motivosFalha = new Map();
  for (let i = 0; i < alvo.length; i++) {
    const c = alvo[i];
    let html;
    try {
      html = await bd(c.url, { timeoutMs: 60000 });
    } catch (e) {
      sem++;
      const m = e.motivo || 'erro';
      motivosFalha.set(m, (motivosFalha.get(m) || 0) + 1);
      console.error(`  ${c.id} · SEM DETALHE (${m})`);
      if (e.semCota) {
        recusaDeCota = m;
        cotaNegada = alvo.length - i;
        console.log(`  ⛔ PAROU POR COTA (${m}): ${cotaNegada} lote(s) ficaram pra próxima rodada.`);
        break;
      }
      continue;
    }
    const base = extrairGenerico(html, c.url) || {};
    if (c.categoria === 'imovel') {
      const row = montarImovel(c, base);
      const q = checarQualidade(row, { estrito: false });
      console.log(`  ${c.id} [imóvel] aval R$${row.valor_avaliacao} · min R$${row.valor_minimo} · foto ${row.link_foto ? 'sim' : 'NÃO'}${q.descartar ? ' · DESCARTADO(' + q.faltando.join(',') + ')' : (q.faltando.length ? ' · faltando ' + q.faltando.join(',') : ' · OK')}`);
      if (q.descartar) reprov++; else imoveisProntos.push(row);
    } else {
      const txt = decodificarEntidades(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
      const row = montarVeiculo(c, base, txt);
      if (!row.valor_minimo) { reprov++; console.log(`  ${c.id} [veículo] DESCARTADO (sem valor)`); }
      else { veiculosProntos.push(row); console.log(`  ${c.id} [veículo] ${row.marca || '?'} · min R$${row.valor_minimo}`); }
    }
    await sleep(400);
  }
  const resumoFalhas = [...motivosFalha].map(([m, n]) => `${m}×${n}`).join(', ');
  console.log(`\nResumo: ${imoveisProntos.length} imóvel(is) + ${veiculosProntos.length} veículo(s) prontos · ${reprov} descartados · ${sem} sem detalhe${resumoFalhas ? ` (${resumoFalhas})` : ''}.`);

  const prontos = imoveisProntos.length + veiculosProntos.length;
  if (!prontos && sem > 0) {
    throw new FalhaDeAcesso(recusaDeCota || 'detalhes_inacessiveis', `${sem} lote(s) sem detalhe (${resumoFalhas})`, !!recusaDeCota);
  }
  if (!prontos) {
    await registrarSaude(supabase, 'CRLEILOES', [], 'principal',
      { ok: false, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 }, motivo: `todos reprovados na qualidade (${reprov})` });
    console.error(`Nada a gravar: ${reprov} lote(s) reprovados.`);
    return { gravados: 0, reprovados: reprov };
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify({ imoveis: imoveisProntos.slice(0, 2), veiculos: veiculosProntos.slice(0, 2) }, null, 2));
    console.log('\nPara gravar, rode com CRLEILOES_DRYRUN=0.');
    return { gravados: 0, dryrun: true, imoveis: imoveisProntos.length, veiculos: veiculosProntos.length };
  }

  if (imoveisProntos.length) {
    const { error } = await supabase.from('imoveis_leilao').upsert(imoveisProntos, { onConflict: 'fonte_id', ignoreDuplicates: false });
    if (error) throw new FalhaDeAcesso('supabase', `upsert imoveis: ${error.message}`);
    console.log(`✅ ${imoveisProntos.length} imóveis CRLEILOES gravados/atualizados.`);
  }
  if (veiculosProntos.length) {
    const { error } = await supabase.from('veiculos_leilao').upsert(veiculosProntos, { onConflict: 'fonte,fonte_id' });
    if (error) throw new FalhaDeAcesso('supabase', `upsert veiculos: ${error.message}`);
    console.log(`✅ ${veiculosProntos.length} veículos CRLEILOES gravados/atualizados.`);
  }

  // Saúde da fonte (imóveis, que é a tabela que o monitor de regressão acompanha por
  // padrão) — sem isto a fonte nasce invisível ao bug bounty de leiloeiros.
  await registrarSaude(supabase, 'CRLEILOES', imoveisProntos, 'principal',
    (enumeracaoCompleta && !cotaNegada)
      ? undefined
      : { ok: enumeracaoCompleta, cotaNegada, motivo: enumeracaoCompleta ? '' : 'enumeração incompleta (paginação interrompida)' });

  return { gravados: prontos, imoveis: imoveisProntos.length, veiculos: veiculosProntos.length, enumeracaoCompleta };
}

main()
  .then((r) => { console.log(`[crleiloes] fim → ${JSON.stringify(r)}`); process.exit(0); })
  .catch(async (e) => {
    const motivo = e?.motivo || 'erro';
    const semCota = e?.semCota === true;
    console.error(`[crleiloes] ${semCota ? 'SEM COTA' : 'FALHA'} (${motivo}): ${e?.message || e}`);
    if (!(e instanceof FalhaDeAcesso)) console.error(e);
    try {
      await registrarSaude(supabase, 'CRLEILOES', [], 'principal',
        { ok: false, semCota, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
          motivo: semCota
            ? `SEM COTA Bright Data (${motivo}) — coleta não tentada (decisão de orçamento, não regressão da fonte)`
            : `falha de acesso: ${motivo}` });
    } catch { /* já estamos no caminho de erro */ }
    process.exit(1);
  });
