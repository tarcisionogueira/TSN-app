/**
 * Scraper Puppeteer — Leiloeiros com proteção anti-bot
 * Fontes: Mega Leilões, Sold Leilões, Superbid, Banco do Brasil
 *
 * Estratégia: intercepta chamadas XHR/fetch do próprio site para capturar
 * as APIs internas JSON — mais robusto que scraping de HTML.
 */

import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { vasculharDocumentos } from '../api/_doc-scan.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,900',
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── UTILS ───────────────────────────────────────────────────────────────────

// Mesma regra canônica de api/_tipo.js (inline: roda em GitHub Actions). Inclui
// 'rural' (fazenda/sítio/chácara) e industrial→'comercial', senão essas
// tipologias caem em 'imovel' e o filtro de tipo da Busca não as isola.
function normalizarTipo(tipo) {
  if (!tipo) return 'imovel';
  const t = String(tipo).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (t.includes('rural') || t.includes('fazenda') || t.includes('sitio') ||
      t.includes('chacara') || t.includes('agricol') || t.includes('agropecu') ||
      t.includes('pecuari') || t.includes('haras') || t.includes('lavoura')) return 'rural';
  if (t.includes('apart') || t.includes('apto') || t.includes('flat') ||
      t.includes('kitnet') || t.includes('studio') || t.includes('cobertura')) return 'apartamento';
  if (t.includes('casa') || t.includes('sobrado') || t.includes('resid')) return 'casa';
  if (t.includes('terreno') || t.includes('lote') || t.includes('gleba') || t.includes('area')) return 'terreno';
  if (t.includes('comerc') || t.includes('sala') || t.includes('loja') || t.includes('galp') ||
      t.includes('barrac') || t.includes('industr') || t.includes('armazem') ||
      t.includes('deposito') || t.includes('predio') || t.includes('escritorio') ||
      t.includes('conjunto') || t.includes('ponto') || t.includes('hotel') || t.includes('pousada')) return 'comercial';
  return 'imovel';
}

function toTitleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/(?:^|\s|-)(\S)/g, c => c.toUpperCase());
}

function parseBRL(str) {
  if (!str) return 0;
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim()) || 0;
}

async function salvarImoveis(imoveis, fonte) {
  if (!imoveis.length) return;

  const rows = imoveis.map(im => ({
    ...im,
    ativo: true, // coletado agora ⇒ está ativo (reativa lotes que voltaram)
    viavel: im.valor_avaliacao > 0 ? (1 - im.valor_minimo / im.valor_avaliacao) >= 0.3 : null,
    score_viabilidade: im.valor_avaliacao > 0
      ? Math.min(100, Math.round((1 - im.valor_minimo / im.valor_avaliacao) * 150))
      : 30,
    desconto_percentual: im.valor_avaliacao > 0
      ? Math.round((1 - im.valor_minimo / im.valor_avaliacao) * 100)
      : null,
    atualizado_em: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('imoveis_leilao')
    .upsert(rows, { onConflict: 'fonte_id', ignoreDuplicates: false });

  if (error) console.error(`  Erro ao salvar ${fonte}:`, error.message);
  else console.log(`  ✅ ${fonte}: ${rows.length} imóveis salvos`);
}

// Salva em lotes de 500 e desativa os obsoletos da fonte (lotes que saíram do
// ar). Trava de segurança: só desativa se a coleta foi saudável (>50), para um
// erro de rede não zerar o acervo. Retorna a quantidade coletada.
async function salvarEFinalizar(imoveis, fonte) {
  const runStart = new Date().toISOString();
  for (let i = 0; i < imoveis.length; i += 500) {
    await salvarImoveis(imoveis.slice(i, i + 500), `${fonte} ${i + 1}-${Math.min(i + 500, imoveis.length)}`);
  }
  if (imoveis.length > 50) {
    const { error, count } = await supabase
      .from('imoveis_leilao')
      .update({ ativo: false }, { count: 'exact' })
      .eq('fonte', fonte)
      .eq('ativo', true)
      .lt('atualizado_em', runStart);
    if (error) console.error(`  Erro ao desativar ${fonte} obsoletos:`, error.message);
    else console.log(`  🔻 ${fonte}: ${count ?? 0} lotes obsoletos desativados`);
  } else {
    console.log(`  ⚠️ ${fonte} coletou ${imoveis.length} (≤50) — pulando desativação por segurança`);
  }
  return imoveis.length;
}

// ─── ESTEIRA + VALIDAÇÃO + SAÚDE ──────────────────────────────────────────────
// Critérios mínimos de qualidade por fonte. A coleta só é considerada "válida"
// se atinge o volume mínimo E os percentuais de campos essenciais (valor, UF,
// link do edital). Serve tanto para a esteira (tentar próxima estratégia se a
// atual reprovar) quanto para o monitor de regressão.
const CRITERIOS = {
  MEGA:     { min: 80,  valor: 0.85, uf: 0.55, link: 0.9 },
  SUPERBID: { min: 300, valor: 0.80, uf: 0.45, link: 0.9 },
  SOLD:     { min: 20,  valor: 0.80, uf: 0.45, link: 0.9 },
  ZUK:      { min: 150, valor: 0.85, uf: 0.55, link: 0.9 },
  SODRE:    { min: 10,  valor: 0.80, uf: 0.40, link: 0.9 },
  FRAZAO:   { min: 40,  valor: 0.85, uf: 0.55, link: 0.9 },
  LJUD:     { min: 200, valor: 0.85, uf: 0.55, link: 0.9 },
  // Imóveis da União (SPU/SERPRO): inventário pequeno e sazonal por sala (o leilão
  // pode ter poucas dezenas); min baixo para não marcar "degradado" à toa.
  VENDASGOV:{ min: 3,   valor: 0.60, uf: 0.60, link: 0.9 },
  // Pestana: cidade/UF às vezes só no texto da descrição (uf mais frouxo).
  PESTANA:  { min: 15,  valor: 0.75, uf: 0.40, link: 0.85 },
  _default: { min: 10,  valor: 0.70, uf: 0.40, link: 0.8 },
};

function metricasColeta(imoveis) {
  const n = imoveis.length || 0;
  const p = (x) => (n ? Number((x / n).toFixed(3)) : 0);
  const uf    = imoveis.filter(i => /^[A-Z]{2}$/.test(i.estado || '')).length;
  const valor = imoveis.filter(i => Number(i.valor_minimo) > 0).length;
  const link  = imoveis.filter(i => /^https?:\/\//.test(i.link_edital || '')).length;
  const foto  = imoveis.filter(i => i.link_foto).length;
  return { n, uf_pct: p(uf), valor_pct: p(valor), link_pct: p(link), foto_pct: p(foto) };
}

// Portão de qualidade: confirma que a coleta dá acesso real aos lotes com os
// campos que importam (valor/UF/edital). Retorna {ok, metricas, motivo}.
function validarColeta(imoveis, fonte) {
  const c = CRITERIOS[fonte] || CRITERIOS._default;
  const m = metricasColeta(imoveis);
  const falhas = [];
  if (m.n < c.min)              falhas.push(`total ${m.n}<${c.min}`);
  if (m.valor_pct < c.valor)    falhas.push(`valor ${m.valor_pct}<${c.valor}`);
  if (m.uf_pct < c.uf)          falhas.push(`uf ${m.uf_pct}<${c.uf}`);
  if (m.link_pct < c.link)      falhas.push(`link ${m.link_pct}<${c.link}`);
  return { ok: falhas.length === 0, metricas: m, motivo: falhas.join('; ') };
}

// Esteira: tenta cada estratégia na ordem; a 1ª que PASSA na validação vence.
// Se nenhuma passar, retorna a de maior volume (melhor esforço, degradado).
async function coletarComEsteira(fonte, estrategias) {
  let melhor = { imoveis: [], estrategia: null, validacao: validarColeta([], fonte) };
  for (const { nome, fn } of estrategias) {
    let imoveis = [];
    try { imoveis = (await fn()) || []; }
    catch (e) { console.log(`  [${fonte}] estratégia "${nome}" erro: ${String(e.message).slice(0, 90)}`); }
    const validacao = validarColeta(imoveis, fonte);
    console.log(`  [${fonte}] "${nome}": ${imoveis.length} imóveis — ${validacao.ok ? 'VÁLIDO ✅' : 'reprovado (' + validacao.motivo + ')'}`);
    if (imoveis.length > melhor.imoveis.length) melhor = { imoveis, estrategia: nome, validacao };
    if (validacao.ok) return { imoveis, estrategia: nome, validacao };
  }
  return melhor;
}

// Registra a saúde da coleta (1 linha por fonte por execução) e compara com a
// execução anterior para detectar regressão (queda >50% ou zeragem). O alerta
// por e-mail é disparado pelo cron /api/monitor-fontes-cron, que lê esta tabela.
async function registrarSaude(fonte, imoveis, estrategia, validacao) {
  const m = validacao?.metricas || metricasColeta(imoveis);
  let status = 'ok', motivo = validacao?.motivo || '';
  if (!m.n) status = 'falhou';
  else if (!validacao?.ok) status = 'degradado';
  try {
    const { data: ant } = await supabase.from('fonte_saude')
      .select('total').eq('fonte', fonte).order('executado_em', { ascending: false }).limit(1).maybeSingle();
    if (ant && ant.total > 0 && m.n < ant.total * 0.5) {
      if (status === 'ok') status = 'degradado';
      motivo = [motivo, `queda vs anterior (${m.n}<${ant.total})`].filter(Boolean).join('; ');
      console.log(`  ⚠️ [${fonte}] REGRESSÃO: caiu de ${ant.total} para ${m.n}`);
    }
    await supabase.from('fonte_saude').insert({
      fonte, total: m.n, estrategia: estrategia || null,
      uf_pct: m.uf_pct, valor_pct: m.valor_pct, link_pct: m.link_pct, foto_pct: m.foto_pct,
      status, motivo: motivo || null,
    });
  } catch (e) { console.log(`  [${fonte}] registrarSaude erro: ${String(e.message).slice(0, 80)}`); }
  return { status, motivo, metricas: m };
}

// ─── INTERCEPTADOR DE REDE ────────────────────────────────────────────────────

async function capturarRespostasJSON(page, urlAlvo, { waitSelector, timeout = 20000 } = {}) {
  const respostas = [];

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('json')) return;
    // Ignora recursos pequenos (tracking, analytics)
    try {
      const text = await response.text();
      if (text.length < 100) return;
      const data = JSON.parse(text);
      respostas.push({ url, data });
    } catch {}
  });

  await page.goto(urlAlvo, { waitUntil: 'networkidle2', timeout });

  if (waitSelector) {
    try { await page.waitForSelector(waitSelector, { timeout: 8000 }); } catch {}
  }

  // Aguarda mais um pouco para requests tardios
  await new Promise(r => setTimeout(r, 3600));

  return respostas;
}

// ─── MEGA LEILÕES ─────────────────────────────────────────────────────────────
// Estrutura validada contra HTML real (debug_fetch): a listagem é renderizada no
// servidor. Cada card é <div data-key="ID"><div class="card open">...; "open" =
// ATIVO (lotes encerrados não têm a classe "open"). Paginação: ?pagina=N (sem
// filtro de estado = varre TODOS os imóveis). Campos: .card-title (título +
// "X m²"), .card-price (1ª praça ≈ avaliação), .card-instance-value (valor por
// praça → menor = piso/lance mínimo), .card-locality[title]="Cidade, UF",
// .card-instance-title (Judicial/Extrajudicial), .card-status, datas de praça,
// categoria no path do href → tipo.

const MEGA_CAT_TIPO = {
  'apartamentos': 'apartamento',
  'casas': 'casa',
  'terrenos-e-lotes': 'terreno',
  'comerciais': 'comercial',
  'salas-comerciais': 'comercial',
  'lojas': 'comercial',
  'galpoes': 'comercial',
  'predios': 'comercial',
  'conjuntos-comerciais': 'comercial',
  'vagas-de-garagem': 'comercial',
  'hoteis': 'comercial',
  'imoveis-rurais': 'rural',
  'fazendas': 'rural',
  'sitios-e-chacaras': 'rural',
};

// Extrai os cards ATIVOS de uma página da listagem (executado no contexto do navegador)
async function coletarMegaPagina(page) {
  return await page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const toNum = s => {
      const m = (s || '').match(/(\d[\d.]*,\d{2})/);
      return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : 0;
    };
    const parseData = txt => {
      const m = (txt || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:[^\d]*(\d{2}):(\d{2}))?/);
      if (!m) return null;
      return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`;
    };
    const out = [];
    document.querySelectorAll('div[data-key]').forEach(cont => {
      const card = cont.querySelector('.card');
      if (!card) return;
      // Somente ATIVOS: classe "open" e status sem "encerrad"
      if (!card.classList.contains('open')) return;
      const status = norm(card.querySelector('.card-status')?.textContent).toLowerCase();
      if (status.includes('encerrad') || status.includes('arrematad') || status.includes('vendido')) return;

      const a = card.querySelector('a.card-title') || card.querySelector('a.card-image') || card.querySelector('a[href]');
      const href = (a?.href || '').split('?')[0];
      if (!href) return;

      const valores = Array.from(card.querySelectorAll('.card-instance-value'))
        .map(el => toNum(el.textContent)).filter(v => v > 0);
      const cardPrice = toNum(card.querySelector('.card-price')?.textContent);
      if (cardPrice > 0) valores.push(cardPrice);

      // datas das praças → escolhe a próxima data futura (a que poderemos participar)
      const datas = Array.from(card.querySelectorAll('[class*="instance-date"]'))
        .map(el => parseData(el.textContent)).filter(Boolean).sort();
      const agora = new Date().toISOString();
      const dataLeilao = datas.find(d => d >= agora) || datas[0] || null;

      out.push({
        id: cont.getAttribute('data-key'),
        href,
        titulo: norm(card.querySelector('.card-title')?.textContent),
        numero: norm(card.querySelector('.card-number')?.textContent),
        localidade: card.querySelector('.card-locality')?.getAttribute('title')
          || norm(card.querySelector('.card-locality')?.textContent),
        instTitle: norm(card.querySelector('.card-instance-title')?.textContent),
        valores,
        dataLeilao,
        foto: card.querySelector('.card-image')?.getAttribute('data-bg')
          || card.querySelector('img')?.getAttribute('src') || null,
      });
    });
    return out;
  });
}

function mapearMega(c) {
  const valores = (c.valores || []).filter(v => v > 0);
  if (!valores.length) return null;
  const valAval = Math.max(...valores);   // 1ª praça ≈ avaliação
  const valMin = Math.min(...valores);    // última praça = piso/lance mínimo
  if (!valMin) return null;

  let cidade = '', estado = '';
  const loc = (c.localidade || '').match(/^(.*?),?\s*([A-Z]{2})\s*$/);
  if (loc) { cidade = loc[1].trim(); estado = loc[2]; }
  if (!estado) {
    const ufPath = (c.href.match(/\/imoveis\/[a-z-]+\/([a-z]{2})\//) || [])[1];
    if (ufPath) estado = ufPath.toUpperCase();
  }

  const categoria = (c.href.match(/\/imoveis\/([a-z-]+)\//) || [])[1] || '';
  const tipo = MEGA_CAT_TIPO[categoria] || normalizarTipo(c.titulo);
  const areaM = (c.titulo || '').match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
  const area = areaM ? parseFloat(areaM[1].replace('.', '').replace(',', '.')) : 0;
  const modalidade = /judicial/i.test(c.instTitle) && !/extra/i.test(c.instTitle)
    ? 'judicial' : (/extra/i.test(c.instTitle) ? 'extrajudicial'
    : (/judicial/i.test(c.titulo) ? 'judicial' : 'extrajudicial'));

  return {
    fonte: 'MEGA',
    fonte_id: `mega_${c.id}`,
    titulo: (c.titulo || `Imóvel Mega ${estado}`).slice(0, 160),
    tipo,
    modalidade,
    estado,
    cidade: toTitleCase(cidade),
    bairro: '',
    endereco: '',
    valor_avaliacao: valAval,
    valor_minimo: valMin,
    area_m2: area || 0,
    descricao: [c.titulo, c.numero, c.instTitle].filter(Boolean).join(' — ').slice(0, 500),
    link_edital: c.href,
    link_foto: c.foto,
    leiloeiro: 'Mega Leilões',
    data_leilao: c.dataLeilao,
    forma_pagamento: 'a_vista',
  };
}

// Varre TODAS as páginas da listagem de imóveis do Mega (somente ativos).
async function scraperMegaLeiloes(browser) {
  console.log('  Mega Leilões — varrendo todas as páginas...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  const imoveis = [];
  const seen = new Set();
  const MAX_PAGINAS = 300; // trava de segurança (não-silenciosa)
  try {
    let p = 1;
    for (; p <= MAX_PAGINAS; p++) {
      const url = `https://www.megaleiloes.com.br/imoveis?pagina=${p}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        try { await page.waitForSelector('div[data-key] .card', { timeout: 8000 }); } catch {}
      } catch (e) {
        console.log(`    Mega p${p}: erro de navegação (${e.message.slice(0, 50)}) — parando`);
        break;
      }
      const cards = await coletarMegaPagina(page);
      if (!cards.length) { console.log(`    Mega p${p}: 0 cards — fim da paginação`); break; }

      let novos = 0;
      for (const c of cards) {
        if (!c.id || seen.has(c.id)) continue;
        seen.add(c.id);
        const im = mapearMega(c);
        if (im) { imoveis.push(im); novos++; }
      }
      console.log(`    Mega p${p}: ${cards.length} ativos (${novos} novos, acumulado ${imoveis.length})`);
      if (novos === 0) { console.log('    Mega: página sem novos — fim da paginação'); break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (p > MAX_PAGINAS) console.log(`    ⚠️ Mega atingiu o limite de ${MAX_PAGINAS} páginas — pode haver mais imóveis`);
    console.log(`  Mega Leilões: ${imoveis.length} imóveis ativos coletados`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro Mega Leilões: ${err.message.slice(0, 100)}`);
    return imoveis;
  } finally {
    await page.close();
  }
}

// ─── SOLD LEILÕES ─────────────────────────────────────────────────────────────

async function scraperSold(browser, pageNum = 1) {
  console.log(`  Sold Leilões página ${pageNum}...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  try {
    const url = pageNum === 1
      ? 'https://www.sold.com.br/leiloes-de-imoveis'
      : `https://www.sold.com.br/leiloes-de-imoveis?page=${pageNum}`;

    const respostas = await capturarRespostasJSON(page, url, {
      waitSelector: '[class*="lot"], [class*="card"], [class*="product"], article',
    });

    let lotes = [];
    for (const { url: apiUrl, data } of respostas) {
      const candidato = data?.lots || data?.data?.lots || data?.items || data?.results
        || data?.products || (Array.isArray(data) ? data : null);
      if (candidato?.length >= 2) {
        console.log(`    Sold p${pageNum}: API em ${apiUrl.slice(0, 80)} (${candidato.length} itens)`);
        lotes = candidato;
        break;
      }
    }

    if (!lotes.length) {
      lotes = await page.evaluate(() => {
        const items = [];
        const cards = document.querySelectorAll(
          '[class*="lot-card"], [class*="auction-card"], [class*="product-card"], article, [data-lot-id], [data-id]'
        );
        cards.forEach(card => {
          const link = card.querySelector('a[href]');
          const titulo = card.querySelector('h1,h2,h3,h4,[class*="title"],[class*="name"]');
          const valorEl = card.querySelector('[class*="price"],[class*="value"],[class*="lance"],[class*="bid"]');
          const imgEl = card.querySelector('img');
          const estadoEl = card.querySelector('[class*="state"],[class*="uf"],[class*="location"]');
          const valor = valorEl?.textContent || card.textContent.match(/R\$\s*[\d.,]+/)?.[0] || '';
          if (!valor) return;
          items.push({
            _dom: true,
            href: link?.href || '',
            titulo: titulo?.textContent?.trim() || '',
            valor: valor.trim(),
            foto: imgEl?.src || imgEl?.dataset?.src || null,
            estado: estadoEl?.textContent?.trim() || '',
          });
        });
        return items;
      });
      if (lotes.length) console.log(`    Sold p${pageNum}: DOM fallback — ${lotes.length} cards`);
    }

    if (!lotes.length) {
      console.log(`    Sold p${pageNum}: 0 imóveis`);
      return [];
    }

    const imoveis = lotes.map((lot, idx) => {
      if (lot._dom) {
        const valor = parseBRL(lot.valor);
        if (!valor) return null;
        const id = lot.href.split('/').filter(Boolean).pop()?.split('?')[0] || `${pageNum}_${idx}`;
        return {
          fonte: 'SOLD',
          fonte_id: `sold_${id}`,
          titulo: lot.titulo.slice(0, 120) || `Imóvel Sold`,
          tipo: normalizarTipo(lot.titulo),
          modalidade: lot.titulo.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
          estado: lot.estado.replace(/.*[-–]\s*/, '').trim().slice(0, 2).toUpperCase() || '',
          cidade: '',
          bairro: '',
          endereco: '',
          valor_avaliacao: 0,
          valor_minimo: valor,
          area_m2: 0,
          descricao: '',
          link_edital: lot.href || 'https://www.sold.com.br',
          link_foto: lot.foto,
          leiloeiro: 'Sold Leilões',
          data_leilao: null,
          forma_pagamento: 'a_vista',
        };
      }

      const id = lot.id || lot.lot_id || idx;
      const titulo = lot.title || lot.name || lot.description || '';
      const loc = lot.location || lot.address || {};
      const valMin = parseBRL(lot.minimum_bid || lot.initial_bid || lot.min_bid || lot.price || 0);
      const valAval = parseBRL(lot.appraisal_value || lot.evaluation || lot.appraisal || 0);
      if (!valMin) return null;

      return {
        fonte: 'SOLD',
        fonte_id: `sold_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Sold ${id}`,
        tipo: normalizarTipo(lot.category || lot.type || titulo),
        modalidade: lot.judicial ? 'judicial' : 'extrajudicial',
        estado: loc.state || lot.state || lot.uf || '',
        cidade: toTitleCase(loc.city || lot.city || lot.cidade || ''),
        bairro: toTitleCase(loc.neighborhood || lot.neighborhood || ''),
        endereco: toTitleCase(loc.street || lot.address_street || ''),
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: parseFloat(lot.area || lot.useful_area || 0),
        descricao: (lot.description || titulo).replace(/<[^>]+>/g, '').slice(0, 500),
        link_edital: lot.url || lot.link || `https://www.sold.com.br/lote/${id}`,
        link_foto: lot.image || lot.thumbnail || lot.photo || null,
        leiloeiro: lot.auctioneer?.name || lot.company || 'Sold Leilões',
        data_leilao: lot.end_date || lot.auction_date || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);

    console.log(`    Sold p${pageNum}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Sold p${pageNum}: ${err.message.slice(0, 80)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── SUPERBID ─────────────────────────────────────────────────────────────────

// Rede Superbid: Superbid e Sold são a mesma infraestrutura (offer-query.
// superbid.net). portalId 2 = Superbid, 15 = Sold. Chama a API pública de
// offers direto do navegador: searchType=opened (só ativos), filtra imóveis,
// pagina de 100 em 100 até acabar. Genérico por portal/fonte.
async function scraperSuperbidNet(browser, { portalId, fonte, leiloeiro, prefix, baseSite }) {
  console.log(`  ${leiloeiro} — API offers (portal ${portalId}, somente abertos)...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  try {
    await page.goto(`${baseSite}/categorias/imoveis`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));

    const offers = await page.evaluate(async (portal) => {
      const FIELDS = 'id;linkURL;price;priceFormatted;endDate;endDateTime;offerStatus;store;product.shortDesc;product.location;product.productType;product.subCategory;product.thumbnailUrl;auction;offerDetail;offerDescription';
      const apiUrl = n => `https://offer-query.superbid.net/offers/?portalId=${portal}&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=product.productType.description:imoveis;&pageNumber=${n}&pageSize=100&orderBy=endDate:asc&fieldList=${FIELDS}`;
      const all = [];
      for (let n = 1; n <= 100; n++) {
        let data;
        try {
          const r = await fetch(apiUrl(n), { headers: { Accept: 'application/json' } });
          if (!r.ok) break;
          data = await r.json();
        } catch { break; }
        const arr = data.offers || data.content || data.results || data.items || (Array.isArray(data) ? data : []);
        if (!arr || !arr.length) break;
        all.push(...arr);
        if (arr.length < 100) break;
      }
      return all;
    }, portalId);

    console.log(`    ${leiloeiro}: ${offers.length} offers abertas coletadas`);
    const seen = new Set();
    const str = v => (typeof v === 'string' ? v : (v == null ? '' : String(v?.description ?? v?.name ?? '')));
    const imoveis = offers.map(of => {
      const p = of.product || {};
      const loc = (p.location && typeof p.location === 'object') ? p.location : {};
      const locStr = typeof p.location === 'string' ? p.location : (loc.city || '');
      const det = of.offerDetail || {};
      const id = of.id || of.offerId;
      if (!id || seen.has(id)) return null;
      seen.add(id);

      const titulo = str(p.shortDesc) || str(of.title);
      const estadoMatch = (locStr || '').match(/[-–]\s*([A-Z]{2})\s*$/);
      const valMin = parseFloat(det.initialBidValue || det.currentMinBid || of.price || 0);
      const valAval = parseFloat(det.referenceValue || det.directSaleValue || 0);
      if (!valMin) return null;

      const sub = str(p.subCategory);
      const tipoRaw = (sub && !/im[oó]ve/i.test(sub)) ? sub : titulo;
      const linkURL = str(of.linkURL);
      const desc = str(of.offerDescription) || titulo;
      // Área/ocupação vêm no texto (título+descrição) — confirmado nos dados.
      const ext = extrairDaDescricao(`${titulo} ${desc}`);

      return {
        fonte,
        fonte_id: `${prefix}_${id}`,
        titulo: (titulo || `Imóvel ${leiloeiro}`).slice(0, 160),
        tipo: normalizarTipo(tipoRaw),
        modalidade: (of.auction?.subMarketplaces || []).some(s => /judicial/i.test(str(s))) ? 'judicial' : 'extrajudicial',
        estado: (estadoMatch?.[1] || loc.state || loc.uf || '').toString().toUpperCase().slice(0, 2),
        cidade: toTitleCase((locStr || '').replace(/\s*[-–]\s*[A-Z]{2}\s*$/, '').trim()),
        bairro: toTitleCase(str(loc.neighborhood)),
        endereco: toTitleCase(str(loc.street)),
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: ext.area_m2 || 0,
        ocupacao: ext.ocupacao || null,
        descricao: desc.replace(/<[^>]+>/g, '').slice(0, 500),
        link_edital: linkURL.startsWith('http') ? linkURL : (linkURL ? `${baseSite}${linkURL}` : `${baseSite}/oferta/${id}`),
        link_foto: p.thumbnailUrl || null,
        leiloeiro,
        data_leilao: of.endDate || of.endDateTime || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);

    console.log(`    ${leiloeiro}: ${imoveis.length} imóveis mapeados`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro ${leiloeiro}: ${err.message.slice(0, 100)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── BANCO DO BRASIL ──────────────────────────────────────────────────────────

async function scraperBancoBrasil(browser, pageNum = 1) {
  console.log(`  Banco do Brasil página ${pageNum}...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Referer': 'https://www.bb.com.br/',
  });

  try {
    // Portal de venda de imóveis do BB (licitacoes-e-leiloes.bb.com.br mudou de domínio)
    const base = 'https://www43.bb.com.br/portalbb/leiloes';
    const url = pageNum === 1 ? base : `${base}?pagina=${pageNum}`;

    const respostas = await capturarRespostasJSON(page, url, {
      waitSelector: '[class*="card"], [class*="lote"], [class*="produto"], article',
      timeout: 25000,
    });

    let lotes = [];
    for (const { url: apiUrl, data } of respostas) {
      const candidato = data?.lotes || data?.imoveis || data?.items || data?.data
        || data?.results || data?.content || (Array.isArray(data) ? data : null);
      if (candidato?.length >= 2) {
        console.log(`    BB p${pageNum}: API em ${apiUrl.slice(0, 80)} (${candidato.length} itens)`);
        lotes = candidato;
        break;
      }
    }

    if (!lotes.length) {
      lotes = await page.evaluate(() => {
        const items = [];
        const cards = document.querySelectorAll(
          '[class*="card"], [class*="lote"], [class*="produto"], [class*="imovel"], article, [data-id]'
        );
        cards.forEach(card => {
          const link = card.querySelector('a[href]');
          const titulo = card.querySelector('h1,h2,h3,h4,[class*="title"],[class*="titulo"],[class*="nome"]');
          const valorEl = card.querySelector('[class*="price"],[class*="valor"],[class*="preco"],[class*="lance"]');
          const imgEl = card.querySelector('img');
          const locEl = card.querySelector('[class*="local"],[class*="cidade"],[class*="uf"]');
          const valor = valorEl?.textContent || card.textContent.match(/R\$\s*[\d.,]+/)?.[0] || '';
          if (!valor) return;
          items.push({
            _dom: true,
            href: link?.href || '',
            titulo: titulo?.textContent?.trim() || '',
            valor: valor.trim(),
            foto: imgEl?.src || imgEl?.dataset?.src || null,
            local: locEl?.textContent?.trim() || '',
          });
        });
        return items;
      });
      if (lotes.length) console.log(`    BB p${pageNum}: DOM fallback — ${lotes.length} cards`);
    }

    if (!lotes.length) {
      console.log(`    BB p${pageNum}: 0 imóveis`);
      return [];
    }

    const imoveis = lotes.map((lot, idx) => {
      if (lot._dom) {
        const valor = parseBRL(lot.valor);
        if (!valor) return null;
        const id = lot.href.split('/').filter(Boolean).pop()?.split('?')[0] || `${pageNum}_${idx}`;
        return {
          fonte: 'BB',
          fonte_id: `bb_${id}`,
          titulo: lot.titulo.slice(0, 120) || `Imóvel BB`,
          tipo: normalizarTipo(lot.titulo),
          modalidade: 'extrajudicial',
          estado: lot.local.slice(-2).toUpperCase() || '',
          cidade: lot.local.replace(/[/-]\s*[A-Z]{2}$/, '').trim(),
          bairro: '',
          endereco: '',
          valor_avaliacao: 0,
          valor_minimo: valor,
          area_m2: 0,
          descricao: '',
          link_edital: lot.href || 'https://licitacoes-e-leiloes.bb.com.br',
          link_foto: lot.foto,
          leiloeiro: 'Banco do Brasil',
          data_leilao: null,
          forma_pagamento: 'a_vista',
        };
      }

      const id = lot.id || lot.codImovel || lot.codigo || idx;
      const tipo = lot.tipoImovel || lot.tipo || lot.descTipo || '';
      const valMin = parseBRL(lot.precoVenda || lot.valorVenda || lot.vlrVenda || lot.preco || lot.lance_inicial || 0);
      const valAval = parseBRL(lot.valorAvaliacao || lot.vlrAvaliacao || lot.avaliacao || 0);
      if (!valMin) return null;

      return {
        fonte: 'BB',
        fonte_id: `bb_${id}`,
        titulo: `${tipo || 'Imóvel'} — ${toTitleCase(lot.cidade || lot.municipio || '')} ${lot.uf || lot.estado || ''}`.trim(),
        tipo: normalizarTipo(tipo),
        modalidade: (lot.modalidade || '').toLowerCase().includes('leil') ? 'judicial' : 'extrajudicial',
        estado: lot.uf || lot.estado || '',
        cidade: toTitleCase(lot.cidade || lot.municipio || ''),
        bairro: toTitleCase(lot.bairro || ''),
        endereco: toTitleCase(lot.logradouro || lot.endereco || ''),
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: parseFloat(lot.areaTotal || lot.area || 0),
        descricao: lot.descricao || lot.complemento || '',
        link_edital: lot.linkAcesso || lot.urlImovel || lot.link
          || `https://licitacoes-e-leiloes.bb.com.br/imovel/${id}`,
        link_foto: lot.foto || lot.urlFoto || lot.imagemPrincipal || null,
        leiloeiro: 'Banco do Brasil',
        data_leilao: lot.dataLeilao || lot.dtLeilao || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);

    console.log(`    BB p${pageNum}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro BB p${pageNum}: ${err.message.slice(0, 80)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── RELATÓRIO DE CAPTAÇÃO ────────────────────────────────────────────────────

// Extrai a data do próximo leilão do HTML da página do lote (mesma lógica do
// api/enriquecer-lote.js): ancora em leilão/praça/encerra/data e pega a próxima
// data futura. Retorna 'YYYY-MM-DD' ou null.
function extrairDataLeilaoHTML(html) {
  if (!html) return null;
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const re = /(?:leil[ãa]o|pra[çc]a|encerra|licita[çc][ãa]o|data)[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{2,4})/gi;
  const ontem = Date.now() - 86400000;
  const limite = Date.now() + 400 * 86400000;
  const futuras = [];
  let m;
  while ((m = re.exec(txt))) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const t = Date.parse(`${y}-${m[2]}-${m[1]}`);
    if (!isNaN(t) && t >= ontem && t < limite) futuras.push(t);
  }
  if (!futuras.length) return null;
  return new Date(Math.min(...futuras)).toISOString().slice(0, 10);
}

// Preenche data_leilao dos imóveis ZUK visitando a página de cada lote NO NAVEGADOR
// (a data do PortalZuk é renderizada por JavaScript — um fetch cru não a enxerga).
// Roda no runner do GitHub, grátis. Best-effort com teto de tempo p/ não estourar
// o timeout da Action (o scrape continua e salva mesmo se não der tempo de todos).
async function enriquecerDatasZuk(browser, imoveis) {
  const DEADLINE = Date.now() + 25 * 60 * 1000; // teto de 25 min
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  // Acelera: não baixa imagem/css/fonte — só precisamos do texto renderizado.
  try {
    await page.setRequestInterception(true);
    page.on('request', req => {
      const t = req.resourceType();
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet') req.abort();
      else req.continue();
    });
  } catch { /* segue sem interceptar */ }
  let ok = 0, feitos = 0;
  for (const im of imoveis) {
    if (Date.now() > DEADLINE) { console.log('    PortalZuk: teto de tempo das datas atingido'); break; }
    if (!im.link_edital) continue;
    try {
      await page.goto(im.link_edital, { waitUntil: 'networkidle2', timeout: 20000 });
      const txt = await page.evaluate(() => document.body?.innerText || '');
      const d = extrairDataLeilaoHTML(txt);
      if (d) { im.data_leilao = d; ok++; }
      // Mesma visita: captura área e ocupação do texto do lote (grátis) — o Zuk
      // não traz área na listagem, só na página interna.
      const ext = extrairDaDescricao(txt);
      if (ext.area_m2 && !im.area_m2) im.area_m2 = ext.area_m2;
      if (ext.ocupacao && !im.ocupacao) im.ocupacao = ext.ocupacao;
    } catch { /* best-effort */ }
    feitos++;
    if (feitos % 50 === 0) console.log(`    PortalZuk datas: ${feitos}/${imoveis.length} · ${ok} ok`);
  }
  try { await page.close(); } catch {}
  console.log(`    PortalZuk: datas preenchidas ${ok}/${imoveis.length}`);
  return imoveis;
}

// ─── PORTALZUK (ZUKERMAN) ─────────────────────────────────────────────────────
// Listagem server-rendered com SCROLL INFINITO (sem links de página). Card:
// .card-property → a[href*="/imovel/uf/cidade/..."] (title rico: tipo, endereço,
// cidade/UF, comitente), .card-property-price-lote (tipo), .card-property-address
// (cidade/UF), .card-property-news (ocupação), R$ no corpo (praças), img (foto).
async function scraperPortalZuk(browser) {
  console.log('  PortalZuk (Zukerman) — scroll infinito...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  try {
    await page.goto('https://www.portalzuk.com.br/leilao-de-imoveis', { waitUntil: 'networkidle2', timeout: 45000 });
    try { await page.waitForSelector('.card-property', { timeout: 10000 }); } catch {}

    // A listagem tem um botão "Carregar mais" (#btn_carregarMais) que dispara o
    // POST leilao-de-imoveis/mais (rota Ziggy carrega.mais) e faz o append dos
    // próximos cards. O scroll puro NÃO aciona o botão — por isso parávamos em 30.
    // Clicamos o botão repetidamente (com scroll como fallback) até parar de crescer.
    let prev = 0, estavel = 0;
    for (let i = 0; i < 400 && estavel < 3; i++) {
      const n = await page.evaluate(() => {
        const btn = document.querySelector('#btn_carregarMais');
        if (btn && btn.offsetParent !== null) { btn.scrollIntoView({ block: 'center' }); btn.click(); }
        else { window.scrollTo(0, document.body.scrollHeight); }
        return document.querySelectorAll('.card-property').length;
      });
      await new Promise(r => setTimeout(r, 1600));
      if (n <= prev) estavel++; else { estavel = 0; prev = n; }
    }

    const cards = await page.evaluate(() => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim();
      const out = [];
      document.querySelectorAll('.card-property').forEach(card => {
        const a = card.querySelector('a[href*="/imovel/"]');
        const href = (a?.href || '').split('?')[0];
        if (!href) return;
        const title = a?.getAttribute('title') || '';
        const tipo = norm(card.querySelector('.card-property-price-lote')?.textContent);
        const addr = norm(card.querySelector('.card-property-address')?.textContent);
        const ocup = norm(card.querySelector('.card-property-news')?.textContent);
        const img = card.querySelector('img')?.getAttribute('src') || null;
        const valores = (card.textContent.match(/R\$\s*[\d.]+,\d{2}/g) || []);
        out.push({ href, title, tipo, addr, ocup, img, valores });
      });
      return out;
    });

    console.log(`    PortalZuk: ${cards.length} cards`);
    const seen = new Set();
    const imoveis = cards.map(c => {
      const idm = c.href.match(/(\d+(?:-\d+)?)\/?$/);
      const id = idm ? idm[1] : c.href;
      if (seen.has(id)) return null;
      seen.add(id);
      const vals = c.valores.map(v => parseBRL(v)).filter(v => v > 0);
      const valAval = vals.length ? Math.max(...vals) : 0;
      const valMin = vals.length ? Math.min(...vals) : 0;
      if (!valMin) return null;
      const pm = c.href.match(/\/imovel\/([a-z]{2})\/([^/]+)\//i);
      const uf = (pm?.[1] || '').toUpperCase();
      const cidade = pm?.[2] ? toTitleCase(pm[2].replace(/-/g, ' ')) : '';
      const tipoRaw = c.tipo || c.title;
      const modalidade = /judicial/i.test(c.title) ? 'judicial' : 'extrajudicial';
      return {
        fonte: 'ZUK',
        fonte_id: `zuk_${id}`,
        titulo: (c.title || `Imóvel PortalZuk ${uf}`).slice(0, 180),
        tipo: normalizarTipo(tipoRaw),
        modalidade,
        estado: uf,
        cidade,
        bairro: '',
        endereco: '',
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: 0,
        ocupacao: extrairDaDescricao(`${c.title} ${c.ocup}`).ocupacao || null,
        descricao: [c.title, c.ocup].filter(Boolean).join(' · ').slice(0, 500),
        link_edital: c.href,
        link_foto: c.img,
        leiloeiro: 'Zukerman (PortalZuk)',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);
    console.log(`    PortalZuk: ${imoveis.length} imóveis mapeados`);
    return await enriquecerDatasZuk(browser, imoveis);
  } catch (err) {
    console.log(`  Erro PortalZuk: ${err.message.slice(0, 100)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── SODRÉ SANTORO ────────────────────────────────────────────────────────────
// Nuxt SPA. Os lotes vêm de POST /api/search-lots (results[] com campos ricos:
// lot_title, lot_category, lot_description, bid_initial, lot_city/state,
// auction_status, datas, lot_is_judicial). Como não temos o body do POST,
// interceptamos a própria chamada do site e rolamos para paginar.
async function scraperSodre(browser) {
  console.log('  Sodré Santoro — interceptando /api/search-lots...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const lotesMap = new Map();
  let reqInfo = null;
  page.on('request', req => {
    if (reqInfo) return;
    if (/\/api\/search-lots/.test(req.url()) && req.method() === 'POST') {
      reqInfo = { url: req.url(), body: req.postData() || '', headers: req.headers() };
    }
  });
  page.on('response', async (resp) => {
    if (!/\/api\/search-lots/.test(resp.url())) return;
    try {
      const j = await resp.json();
      (j?.results || []).forEach(r => {
        const id = String(r.lot_id || r.id || '');
        if (id) lotesMap.set(id, r);
      });
    } catch {}
  });
  try {
    // /imoveis/lotes = view flat de lotes (search-lots com corpo mais amplo).
    await page.goto('https://www.sodresantoro.com.br/imoveis/lotes', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3500));

    // A resposta do search-lots é { results:[], total, page, perPage }. Paginamos
    // por page/perPage EXPLICITAMENTE (o body interceptado nem sempre traz essas
    // chaves — eram defaults do servidor — por isso a versão anterior parava em 20).
    // Reaproveitamos o body interceptado (preserva filtros/segmento) e só
    // sobrescrevemos page/perPage; paramos ao atingir o total ou página vazia.
    if (reqInfo?.url) {
      let baseBody = {};
      try { baseBody = JSON.parse(reqInfo?.body || '{}') || {}; } catch {}
      const hdrs = { ...(reqInfo.headers || {}) };
      ['host', 'content-length', 'accept-encoding', 'connection'].forEach(h => delete hdrs[h]);
      hdrs['content-type'] = hdrs['content-type'] || 'application/json';
      const perPage = 100;
      for (let p = 1; p <= 60; p++) {
        const body = { ...baseBody, page: p, perPage };
        let res = null;
        try {
          res = await page.evaluate(async (url, headers, b) => {
            const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(b), credentials: 'include' });
            if (!r.ok) return null;
            return await r.json();
          }, reqInfo.url, hdrs, body);
        } catch { res = null; }
        const arr = res?.results || [];
        if (!arr.length) break;
        let novos = 0;
        arr.forEach(r => { const id = String(r.lot_id || r.id || ''); if (id && !lotesMap.has(id)) { lotesMap.set(id, r); novos++; } });
        const total = Number(res?.total || 0);
        if (novos === 0) break;
        if (total && lotesMap.size >= total) break;
        await new Promise(r => setTimeout(r, 350));
      }
    }

    // Aprofunda POR LEILÃO: o view global mostra ~25, mas cada leilão tem seus
    // próprios lotes (o search-lots é escopado ao leilão na página /leilao/{id}).
    // Iteramos os leilões de imóveis ativos e visitamos cada um — o listener de
    // resposta acima coleta automaticamente os lotes de cada leilão.
    try {
      const aucs = await page.evaluate(async () => {
        try {
          const r = await fetch('https://prd-api.sodresantoro.com.br/api/v1/auctions?segmentName=imoveis&limit=100&page=1', { headers: { Accept: 'application/json' } });
          if (!r.ok) return [];
          const j = await r.json();
          return (j?.data || []).filter(a => String(a.status || '').toUpperCase() === 'A').map(a => a.id).filter(Boolean);
        } catch { return []; }
      });
      console.log(`    Sodré: ${aucs.length} leilões de imóveis para aprofundar`);
      for (const aid of aucs.slice(0, 50)) {
        try {
          await page.goto(`https://www.sodresantoro.com.br/leilao/${aid}`, { waitUntil: 'networkidle2', timeout: 40000 });
          await new Promise(r => setTimeout(r, 1400));
        } catch { /* pula leilão que falhar */ }
      }
    } catch { /* segue com o que já coletou */ }

    const parseData = (s) => {
      const m = (s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00` : null;
    };
    const lotes = [...lotesMap.values()];
    console.log(`    Sodré: ${lotes.length} lotes capturados`);
    const imoveis = lotes.map(r => {
      if ((r.auction_status || '').toLowerCase() !== 'aberto') return null; // só ativos
      const valMin = parseFloat(r.bid_initial || r.bid_actual || 0);
      if (!valMin) return null;
      const titulo = r.lot_title || r.lot_description?.slice(0, 120) || 'Imóvel Sodré';
      const ufMatch = (titulo.match(/-\s*([A-Za-z]{2})\s*$/) || [])[1];
      const uf = (ufMatch || '').toUpperCase();
      const area = parseFloat(r.lot_total_area || r.lot_useful_area || 0) || 0;
      return {
        fonte: 'SODRE',
        fonte_id: `sodre_${r.lot_id || r.id}`,
        titulo: String(titulo).slice(0, 180),
        tipo: normalizarTipo(r.lot_category || titulo),
        modalidade: r.lot_is_judicial ? 'judicial' : 'extrajudicial',
        estado: uf,
        cidade: toTitleCase(r.lot_city || ''),
        bairro: toTitleCase(r.lot_neighborhood || ''),
        endereco: toTitleCase(r.lot_street || ''),
        valor_avaliacao: 0,
        valor_minimo: valMin,
        area_m2: area || extrairDaDescricao(`${titulo} ${r.lot_description || ''}`).area_m2 || 0,
        ocupacao: extrairDaDescricao(`${titulo} ${r.lot_description || ''}`).ocupacao || null,
        descricao: String(r.lot_description || titulo).replace(/\s+/g, ' ').slice(0, 500),
        link_edital: `https://www.sodresantoro.com.br/imoveis/lote/${r.lot_id || r.id}`,
        link_foto: r.lot_image || r.image || null,
        leiloeiro: 'Sodré Santoro',
        data_leilao: parseData(r.auction_date_init || r.auction_date_end),
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);
    console.log(`    Sodré: ${imoveis.length} imóveis mapeados`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro Sodré: ${err.message.slice(0, 100)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── FRAZÃO LEILÕES ───────────────────────────────────────────────────────────
// ASP.NET MVC server-rendered. Organiza por LEILÃO (/leilao/{id}/{slug}); cada
// leilão de imóveis lista os lotes. Card: a.visualizar_lote[data-lote-id]
// [data-tipo][data-addr] + img (cdn) + .lot-info (.lot-title-cap b[title="...,
// Cidade, UF"], .price-line "R$ x", .inf-leilao-calendar "Leilão: DD/MM/AAAA").
// (/imoveis dá 404 — não existe controller; os lotes vêm pelos leilões.)
// Extrai área (m²) e ocupação do TEXTO (título/descrição) que já coletamos — sem
// requisição extra. Ocupação só casa desocupad/ocupad (NÃO "livre", que costuma
// ser "livre de débitos", não posse). Confirmado nos dados: Superbid/Sold/Sodré
// trazem área na descrição; Superbid/Zuk trazem ocupação.
function extrairDaDescricao(txt) {
  const t = String(txt || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const out = {};
  const am = t.match(/([\d][\d.]*(?:,\d+)?)\s*m(?:²|2)(?![a-z0-9])/i);
  if (am) { const n = parseFloat(am[1].replace(/\./g, '').replace(',', '.')); if (n > 0 && n < 1e7) out.area_m2 = n; }
  const om = t.match(/\b(desocupad[ao]|ocupad[ao])\b/i);
  if (om) out.ocupacao = /desocupad/i.test(om[1]) ? 'Desocupado' : 'Ocupado';
  return out;
}

const UF_SIGLAS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
const NOME_UF = { 'acre':'AC','alagoas':'AL','amapa':'AP','amazonas':'AM','bahia':'BA','ceara':'CE','distrito federal':'DF','espirito santo':'ES','goias':'GO','maranhao':'MA','mato grosso do sul':'MS','mato grosso':'MT','minas gerais':'MG','para':'PA','paraiba':'PB','parana':'PR','pernambuco':'PE','piaui':'PI','rio de janeiro':'RJ','rio grande do norte':'RN','rio grande do sul':'RS','rondonia':'RO','roraima':'RR','santa catarina':'SC','sao paulo':'SP','sergipe':'SE','tocantins':'TO' };
// Extrai a UF do texto (título/endereço). Pega a sigla mais ao FIM (o estado
// costuma vir no fim do endereço); se não houver sigla, tenta o nome por extenso.
function extrairUFTexto(...textos) {
  const t = textos.filter(Boolean).join(' ');
  if (!t) return '';
  const siglas = [...t.matchAll(/[-,\/\s]([A-Za-z]{2})\b/g)].map(m => m[1].toUpperCase()).filter(s => UF_SIGLAS.has(s));
  if (siglas.length) return siglas[siglas.length - 1];
  const norm = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const [nome, uf] of Object.entries(NOME_UF)) if (new RegExp(`\\b${nome}\\b`).test(norm)) return uf;
  return '';
}
// Cidade = trecho imediatamente antes da UF no endereço (heurístico).
function extrairCidadeTexto(texto, uf) {
  if (!texto || !uf) return '';
  const segs = texto.split(/[,\-\/]/).map(s => s.trim()).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i].toUpperCase() === uf) return segs[i - 1] || '';
    const m = segs[i].match(/^(.*?)[\s\/-]([A-Za-z]{2})$/);
    if (m && m[2].toUpperCase() === uf) return m[1].trim();
  }
  return '';
}

// Lê a PÁGINA DE DETALHE de um lote do Frazão (mesma origem, HTML server-rendered)
// e extrai área, ocupação, matrícula e avaliação. O site não tem API; buscamos o
// HTML do lote e casamos os rótulos (cobertura ~100% confirmada no garimpo).
async function detalheFrazao(page, url) {
  try {
    return await page.evaluate(async (u) => {
      const r = await fetch(u, { credentials: 'same-origin' });
      if (!r.ok) return null;
      const html = await r.text();
      const t = (new DOMParser().parseFromString(html, 'text/html').body?.innerText || '').replace(/\s+/g, ' ');
      const g = (re) => { const m = t.match(re); return m ? (m[1] || m[0]).trim() : null; };
      return {
        areaTxt: g(/[áa]rea[^:]*:?\s*([\d.,]+)\s*m²/i) || g(/([\d.,]+)\s*m²/i),
        ocupacao: g(/\b(DESOCUPAD[AO]|OCUPAD[AO])\b/i),
        matriculaTxt: g(/matr[íi]cula[:\s]*n?[º°]?\s*([\d.\/-]{3,})/i),
        avaliacaoTxt: g(/avalia[çc][ãa]o[^R]{0,25}R\$\s*([\d.,]+)/i),
      };
    }, url);
  } catch { return null; }
}

async function scraperFrazao(browser) {
  console.log('  Frazão Leilões — coletando leilões de imóveis...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const imoveisMap = new Map();

  const parseCards = () => page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a.visualizar_lote[data-lote-id]').forEach(a => {
      const id = a.getAttribute('data-lote-id');
      if (!id) return;
      let card = a;
      for (let i = 0; i < 4 && card && !(card.querySelector && card.querySelector('.lot-info')); i++) card = card.parentElement;
      card = card || a.parentElement;
      const b = card.querySelector('.lot-title-cap b, .lot-title-cap');
      const titulo = ((b && (b.getAttribute('title') || b.textContent)) || '').replace(/\s+/g, ' ').trim();
      const priceLine = (card.querySelector('.price-line') || {}).textContent || '';
      const cal = (card.querySelector('.inf-leilao-calendar') || {}).textContent || '';
      out.push({
        id,
        tipo: a.getAttribute('data-tipo') || '',
        addr: a.getAttribute('data-addr') || '',
        titulo, priceLine, cal,
        href: (a.getAttribute('href') || '').split('?')[0],
        img: (a.querySelector('img') || {}).getAttribute ? a.querySelector('img').getAttribute('src') : '',
      });
    });
    return out;
  });

  try {
    await page.goto('https://www.frazaoleiloes.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
    // Links de leilão de imóveis (/leilao/{id}/...imoveis...)
    const auctions = await page.evaluate(() => {
      const set = new Set();
      document.querySelectorAll('a[href^="/leilao/"]').forEach(a => {
        const h = (a.getAttribute('href') || '').split('?')[0];
        if (/\/leilao\/\d+\//.test(h) && /imove/i.test(h)) set.add(h);
      });
      return [...set];
    });
    console.log(`    Frazão: ${auctions.length} leilões de imóveis`);

    // A home já traz lotes; visita cada leilão para pegar todos (cap de segurança).
    const urls = ['/', ...auctions].slice(0, 60);
    for (const u of urls) {
      try {
        if (u !== '/') await page.goto(`https://www.frazaoleiloes.com.br${u}`, { waitUntil: 'networkidle2', timeout: 45000 });
        const cards = await parseCards();
        for (const c of cards) if (c.id && !imoveisMap.has(c.id)) imoveisMap.set(c.id, c);
        await new Promise(r => setTimeout(r, 300));
      } catch { /* pula leilão que falhar */ }
    }

    const imoveis = [...imoveisMap.values()].map(c => {
      const valMin = parseBRL(c.priceLine);
      if (!valMin) return null;
      // título "Tipo na Bairro, Cidade, UF" → UF/cidade nos 2 últimos campos;
      // fallback no endereço (data-addr) e no nome do estado por extenso — antes
      // só ~25% traziam UF (título sem a sigla), reprovando a qualidade.
      const parts = c.titulo.split(',').map(s => s.trim()).filter(Boolean);
      const ufTitulo = parts.length && /^[A-Za-z]{2}$/.test(parts[parts.length - 1]) && UF_SIGLAS.has(parts[parts.length - 1].toUpperCase()) ? parts[parts.length - 1].toUpperCase() : '';
      // O slug da URL do lote termina em "...-cidade-uf" (ex.: ...-sao-paulo-sp),
      // fonte mais confiável de UF que o título — confirmado no garimpo do site.
      const hrefTxt = (c.href || '').replace(/[-\/]+/g, ' ');
      const uf = ufTitulo || extrairUFTexto(c.addr, c.titulo, hrefTxt);
      let cidade = ufTitulo && parts.length >= 2 ? parts[parts.length - 2] : '';
      if (!cidade) cidade = extrairCidadeTexto(c.addr, uf) || extrairCidadeTexto(c.titulo, uf);
      const dm = c.cal.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const data_leilao = dm ? `${dm[3]}-${dm[2]}-${dm[1]}T00:00:00-03:00` : null;
      const href = c.href.startsWith('http') ? c.href : `https://www.frazaoleiloes.com.br${c.href}`;
      return {
        fonte: 'FRAZAO',
        fonte_id: `frazao_${c.id}`,
        titulo: (c.titulo || `Imóvel Frazão ${c.id}`).slice(0, 180),
        tipo: normalizarTipo(c.tipo || c.titulo),
        modalidade: /judicial/i.test(c.titulo) ? 'judicial' : 'extrajudicial',
        estado: uf,
        cidade: toTitleCase(cidade),
        bairro: '',
        endereco: c.addr || '',
        valor_avaliacao: 0,
        valor_minimo: valMin,
        area_m2: 0,
        descricao: [c.titulo, c.addr].filter(Boolean).join(' · ').slice(0, 500),
        link_edital: href,
        link_foto: c.img || null,
        leiloeiro: 'Frazão Leilões',
        data_leilao,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);
    console.log(`    Frazão: ${imoveis.length} imóveis mapeados`);

    // Enriquece cada lote pela PÁGINA DE DETALHE: área real, ocupação e matrícula
    // (o CSV/listagem não traz). Cap de segurança + gentileza entre requisições.
    const brl2num = (s) => { const n = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.')); return isNaN(n) ? 0 : n; };
    let enr = 0;
    for (const im of imoveis.slice(0, 400)) {
      const d = await detalheFrazao(page, im.link_edital);
      if (d) {
        const area = brl2num(d.areaTxt);
        if (area > 0) im.area_m2 = area;
        if (d.matriculaTxt) { const mm = d.matriculaTxt.replace(/\D/g, ''); if (mm) im.numero_matricula = mm; }
        if (d.ocupacao) im.ocupacao = /desocupad/i.test(d.ocupacao) ? 'Desocupado' : 'Ocupado';
        const av = brl2num(d.avaliacaoTxt);
        if (av > 0) im.valor_avaliacao = av;
        enr++;
      }
      await new Promise(r => setTimeout(r, 180));
    }
    console.log(`    Frazão: ${enr}/${imoveis.length} enriquecidos (área/ocupação/matrícula)`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro Frazão: ${err.message.slice(0, 100)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── LEILÕES JUDICIAIS (portal nacional) ──────────────────────────────────────
// leiloesjudiciais.com.br é um PORTAL que agrega centenas de leiloeiros oficiais
// (cada lote traz nm_leiloeiro/nm_url_leiloeiro da origem). API pública Nuxt:
//   GET api.leiloesjudiciais.com.br/core/api/get-bens-por-estados?tipo=3&pg=N...
// Dá 405 em navegação direta e CORS no navegador; por isso usamos fetch do NODE
// (sem CORS) com Origin/Referer do site → 200. tipo=3 = Imóveis. Servidor força
// 12 itens/página → iteramos as páginas. Campos: lote_id, nm_titulo_lote, vl_lanceminimo,
// nm_cidade/nm_estado, nm_subcategoria, fotos[].nm_path_completo (196x146 →
// troca p/ 640x480), nm_url_leiloeiro (site de origem = edital/matrícula/anexos).
async function scraperLeiloesJudiciais(browser) {
  console.log('  Leilões Judiciais — portal nacional (cookie via navegador + Node fetch)...');
  const bensMap = new Map();
  const API = 'https://api.leiloesjudiciais.com.br/core/api/get-bens-por-estados';
  const qs = 'tipo=3&categoria=0&estado=&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=0&lote_id=0&ordenacao=null';
  // A API só devolve dados com o COOKIE de sessão — que o site seta via JS (o
  // fetch de Node não recebe). Solução: um NAVEGADOR real carrega a home (o JS
  // roda e seta o cookie), extraímos os cookies e paginamos com Node fetch (que
  // não tem CORS). Junta o melhor dos dois mundos.
  let cookie = '';
  const page = await browser.newPage();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.leiloesjudiciais.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const cookies = await page.cookies();
    cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
  } catch (e) { console.log(`    LJUD: home falhou: ${String(e.message).slice(0, 60)}`); }
  finally { try { await page.close(); } catch {} }
  console.log(`    LJUD: cookie ${cookie ? `obtido (${cookie.length} chars)` : 'NÃO obtido'}`);
  const headers = {
    'User-Agent': USER_AGENT,
    'Accept-Language': 'pt-BR,pt;q=0.9',
    Accept: '*/*',
    Origin: 'https://www.leiloesjudiciais.com.br',
    Referer: 'https://www.leiloesjudiciais.com.br/',
    ...(cookie ? { Cookie: cookie } : {}),
  };

  try {
    let totalPages = 100; // ajustado na 1ª resposta (servidor força 12/página)
    let vistos200 = 0;
    for (let pg = 1; pg <= totalPages; pg++) {
      let j = null, status = 0;
      try {
        const r = await fetch(`${API}?pg=${pg}&qtd_por_pagina=12&${qs}`, { headers });
        status = r.status;
        if (r.ok) { vistos200++; j = await r.json(); }
      } catch (e) { if (pg === 1) { console.log(`    LJUD: fetch falhou: ${String(e.message).slice(0, 80)}`); break; } }
      const items = j?.items || [];
      if (pg === 1) {
        console.log(`    LJUD diag p1: status=${status} cookie=${cookie ? 'sim' : 'não'} totalItems=${j?.totalItems ?? '?'} items=${items.length}`);
        if (!items.length) break;
        totalPages = Math.min(150, Number(j.totalPages) || 100);
        console.log(`    LJUD: ${j.totalItems} imóveis em ${totalPages} páginas`);
      }
      if (!items.length) break;
      for (const it of items) {
        const id = String(it.lote_id || it.imovel_id || '');
        if (id && !bensMap.has(id)) bensMap.set(id, it);
      }
      await new Promise(r => setTimeout(r, 150));
    }
    console.log(`    LJUD: ${bensMap.size} bens colhidos (${vistos200} páginas 200)`);

    const imoveis = [...bensMap.values()].map(it => {
      if (Number(it.statuslote_id) !== 1) return null; // só "Aberto para Lance"
      const titulo = String(it.nm_titulo_lote || it.nm_titulo_leilao || '').replace(/\s+/g, ' ').trim();
      const cidade = String(it.nm_cidade || '').trim();
      // descarta lotes de teste/simulação do portal
      if (/simula|teste/i.test(titulo) || /teste/i.test(cidade)) return null;
      const valMin = parseFloat(it.vl_lanceminimo || it.vl_ordenacao || 0) || 0;
      if (!valMin) return null;
      const uf = String(it.nm_estado || '').toUpperCase().slice(0, 2);
      const areaM = (titulo.match(/([\d.,]+)\s*m²/) || [])[1];
      const area = areaM ? parseBRL(areaM) : 0;
      const leiloeiroTit = String(it.nm_titulo_leilao || '');
      const foto = (it.fotos && it.fotos[0] && it.fotos[0].nm_path_completo)
        ? it.fotos[0].nm_path_completo.replace('/196x146/', '/640x480/')
        : null;
      const urlLeiloeiro = String(it.nm_url_leiloeiro || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
      return {
        fonte: 'LJUD',
        fonte_id: `ljud_${it.lote_id}`,
        titulo: (titulo || `Imóvel ${it.lote_id}`).slice(0, 180),
        tipo: normalizarTipo(it.nm_subcategoria || titulo),
        modalidade: /extrajudicial/i.test(leiloeiroTit) ? 'extrajudicial' : 'judicial',
        estado: uf,
        cidade: toTitleCase(cidade),
        bairro: '',
        endereco: '',
        valor_avaliacao: 0,
        valor_minimo: valMin,
        area_m2: area,
        descricao: [titulo, it.nm_leiloeiro].filter(Boolean).join(' — ').slice(0, 500),
        link_edital: urlLeiloeiro ? `https://${urlLeiloeiro}` : 'https://www.leiloesjudiciais.com.br',
        link_foto: foto,
        leiloeiro: String(it.nm_leiloeiro || 'Leilões Judiciais').slice(0, 120),
        data_leilao: null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);
    console.log(`    LJUD: ${imoveis.length} imóveis mapeados`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro Leilões Judiciais: ${err.message.slice(0, 100)}`);
    return [];
  }
}

// ─── LJUD via NAVEGADOR REAL (page.evaluate) — sem Bright Data ─────────────────
// A tentativa anterior (Node fetch + cookie) recebia 200 vazio: a API detecta o
// FINGERPRINT TLS do Node. A correção é fazer o fetch DENTRO da página (page.evaluate)
// → TLS de Chrome real → a API pública responde (confirmado: sem token). Usamos o
// endpoint get-lotes, que traz dt_fechamento (a DATA da praça). Isto vira a estratégia
// PRIMÁRIA (grátis); o Bright Data (api/scraper-leiloeiros.js) fica de BACKUP.
function parseDataLJUD(s) {
  if (!s || typeof s !== 'string') return null;
  const iso = s.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const ano = d.getUTCFullYear();
  if (ano < 2020 || ano > 2035) return null;
  return iso;
}
function mapLoteLJUD_pp(it) {
  const titulo = String(it.nm_titulo_lote || it.nm_titulo_leilao || '').replace(/\s+/g, ' ').trim();
  const cidade = String(it.nm_cidade || '').trim();
  const valMin = parseFloat(it.vl_lanceminimo || it.vl_ordenacao || 0) || 0;
  const foto = it.fotos?.[0]?.nm_path_completo ? it.fotos[0].nm_path_completo.replace('/196x146/', '/640x480/') : null;
  const urlLeiloeiro = String(it.nm_url_leiloeiro || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return {
    fonte: 'LJUD', fonte_id: `ljud_${it.lote_id || it.id}`,
    titulo: (titulo || `Imóvel ${it.lote_id || it.id}`).slice(0, 180),
    tipo: normalizarTipo(it.nm_subcategoria || it.nm_categoria || titulo),
    modalidade: /extrajudicial/i.test(it.nm_titulo_leilao || it.nm_tipo_leilao || '') ? 'extrajudicial' : 'judicial',
    estado: String(it.nm_estado || '').toUpperCase().slice(0, 2), cidade: toTitleCase(cidade),
    bairro: '', endereco: '', valor_avaliacao: parseFloat(it.vl_avaliacao || 0) || 0, valor_minimo: valMin,
    area_m2: (() => { const m = (titulo.match(/([\d.,]+)\s*m²/) || [])[1]; return m ? parseBRL(m) : 0; })(),
    descricao: [titulo, it.nm_leiloeiro].filter(Boolean).join(' — ').slice(0, 500),
    link_edital: urlLeiloeiro ? `https://${urlLeiloeiro}` : 'https://www.leiloesjudiciais.com.br',
    link_foto: foto, leiloeiro: String(it.nm_leiloeiro || 'Leilões Judiciais').slice(0, 120),
    data_leilao: parseDataLJUD(it.dt_fechamento), forma_pagamento: 'a_vista',
  };
}
// Coleta LJUD por um endpoint, fazendo o fetch DENTRO da página (TLS de Chrome).
async function scraperLJUD_navegador(browser, endpoint) {
  const page = await browser.newPage();
  const bens = new Map();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    await page.goto('https://www.leiloesjudiciais.com.br/', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));
    const base = `https://api.leiloesjudiciais.com.br/core/api/${endpoint}`;
    const commons = 'tipo=3&categoria=0&estado=0&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=0&lote_id=0&ordenacao=null';
    let totalPages = 100, vistos = 0;
    for (let pg = 1; pg <= totalPages; pg++) {
      const url = `${base}?pg=${pg}&qtd_por_pagina=48&${commons}`;
      // fetch NO CONTEXTO DA PÁGINA → usa o TLS/fingerprint do Chrome real.
      const data = await page.evaluate(async (u) => {
        try {
          const r = await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
          if (!r.ok) return { __status: r.status };
          return await r.json();
        } catch (e) { return { __err: String((e && e.message) || e) }; }
      }, url).catch(() => null);
      const items = (data && (data.items || data.data || (Array.isArray(data) ? data : []))) || [];
      if (pg === 1) {
        console.log(`    LJUD/${endpoint} p1: status=${data?.__status ?? 200} total=${data?.totalItems ?? '?'} items=${items.length}`);
        if (!items.length) break;
        totalPages = Math.min(160, Number(data.totalPages) || 100);
      }
      if (!items.length) break;
      vistos++;
      for (const it of items) { const id = String(it.lote_id || it.imovel_id || it.id || ''); if (id && !bens.has(id)) bens.set(id, it); }
      await new Promise(r => setTimeout(r, 120));
    }
    console.log(`    LJUD/${endpoint}: ${bens.size} bens em ${vistos} páginas`);
  } finally { try { await page.close(); } catch {} }
  const seen = new Set(); const imoveis = [];
  for (const it of bens.values()) {
    const ehImovel = Number(it.id_categoria) === 3 || it.imovel_id != null || /im[óo]ve/i.test(it.nm_categoria || '');
    if (!ehImovel) continue;
    if (it.statuslote_id != null && Number(it.statuslote_id) !== 1) continue;
    const t = String(it.nm_titulo_lote || it.nm_titulo_leilao || '').toLowerCase();
    if (/simula|teste/.test(t)) continue;
    const row = mapLoteLJUD_pp(it);
    if (!row.valor_minimo || seen.has(row.fonte_id)) continue;
    seen.add(row.fonte_id); imoveis.push(row);
  }
  console.log(`    LJUD/${endpoint}: ${imoveis.length} imóveis mapeados (com data: ${imoveis.filter(i => i.data_leilao).length})`);
  return imoveis;
}

// ─── VENDASGOV — Imóveis da União (SPU / SERPRO) ──────────────────────────────
// Portal público do governo federal (imoveis.vendasgov.serpro.gov.br) sobre uma
// API REST pública. Estrutura confirmada por captura real (debug_fetch): a lista é
//   GET /api/public/imoveis?size=&page=&sort=itens.edital.dtCertame,asc&sala={subtipo}
// (dá 500 SEM params). O WAF do SERPRO bloqueia fetch de datacenter (403), então o
// fetch roda DENTRO da página (TLS de Chrome real) — mesma tática do LJUD. Inventário
// EXCLUSIVO (imóveis públicos da União/INSS/fundos), não duplica os leiloeiros.
const VG_BASE = 'https://imoveis.vendasgov.serpro.gov.br';

function parseDataVG(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const ano = Number(m[1]);
  if (ano < 2020 || ano > 2035) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`; // sessão em BRT
}

function mapImovelVG(it) {
  const e = it.endereco || {};
  const uf = String(e.estado || '').toUpperCase().slice(0, 2);
  const cidade = toTitleCase(String(e.cidade || '').trim());
  const valor = Number(it.valor) || 0;
  // Foto de capa: o JSON traz src="/public/imoveis/{id}/fotos/{arquivo}"; a URL real
  // é host + /api + src (espaços no nome do arquivo → encodeURI).
  const fotos = Array.isArray(it.fotos) ? it.fotos : [];
  const capa = fotos.find(f => f && f.capa) || fotos[0] || null;
  const linkFoto = capa && capa.src ? `${VG_BASE}/api${encodeURI(capa.src)}` : null;
  const salaSub = it.sala && it.sala.subtipo ? it.sala.subtipo : '';
  // União: "leilao" = leilão administrativo (não judicial); demais = venda direta.
  const modalidade = salaSub === 'leilao' ? 'extrajudicial' : 'venda_direta';
  const orgao = (it.orgao && it.orgao.sigla) || (it.entidadeProprietaria && it.entidadeProprietaria.nome) || 'União';
  // Página pública de detalhe do imóvel — alvo da captura multi-rota de documentos
  // (edital/laudo/matrícula) feita pelo enriquecerDocumentosLote no navegador real.
  const detalhe = `${VG_BASE}/imovel/${it.id}/${it.idItemEdital}`;
  const endereco = String(e.completo || [e.logradouro, e.numero, e.bairro].filter(Boolean).join(', ')).slice(0, 500);
  return {
    fonte: 'VENDASGOV',
    fonte_id: `vendasgov_${it.id}`,
    titulo: [it.tipoImovel && it.tipoImovel.nome, cidade && uf ? `${cidade}/${uf}` : ''].filter(Boolean).join(' — ').slice(0, 180) || `Imóvel da União ${it.id}`,
    tipo: normalizarTipo((it.tipoImovel && it.tipoImovel.nome) || ''),
    modalidade,
    estado: uf,
    cidade,
    bairro: String(e.bairro || '').slice(0, 200),
    endereco,
    cep: String(e.cep || '').replace(/\D/g, '').slice(0, 8) || null,
    valor_avaliacao: 0, // a API não separa avaliação de valor de venda
    valor_minimo: valor,
    area_m2: 0,
    descricao: [it.tipoImovel && it.tipoImovel.nome, endereco, `Órgão: ${orgao}`, salaSub === 'leilao' ? 'Leilão da União' : 'Venda direta da União'].filter(Boolean).join(' — ').slice(0, 500),
    link_edital: detalhe,
    url_lote: detalhe,
    link_foto: linkFoto,
    leiloeiro: `Imóveis da União — ${orgao}`.slice(0, 120),
    data_leilao: parseDataVG(it.dataSessao),
    forma_pagamento: 'a_vista',
  };
}

// Rotas da SPA por sala (de /api/salas) — cada uma faz o site chamar
// /api/public/imoveis?...&sala=... que INTERCEPTAMOS.
const VG_ROTAS = [
  { sala: 'leilao', url: `${VG_BASE}/leilao` },
  { sala: 'concorrencia', url: `${VG_BASE}/concorrencia` },
  { sala: 'venda', url: `${VG_BASE}/venda` },
  { sala: 'pai', url: `${VG_BASE}/imoveispublicos` },
  { sala: 'fundo', url: `${VG_BASE}/fundos` },
];

async function scraperVendasGov(browser) {
  console.log('  Imóveis da União (VendasGov/SPU) — interceptando o XHR real do site...');
  const page = await browser.newPage();
  const bens = new Map();
  // INTERCEPTAÇÃO: a SPA chama /api/public/imoveis com a sessão que o WAF aceita.
  // Forçar o fetch por page.evaluate dava "Failed to fetch" (o WAF/sessão barra o
  // fetch "manual"); ler a resposta REAL do site é o caminho provado (debug harness).
  page.on('response', async (resp) => {
    try {
      if (!/\/api\/public\/imoveis(\?|$)/i.test(resp.url())) return;
      const ct = resp.headers()['content-type'] || '';
      if (!/json/i.test(ct)) return;
      const j = await resp.json().catch(() => null);
      const arr = j && Array.isArray(j.content) ? j.content : null;
      if (!arr) return;
      for (const it of arr) {
        const id = String(it && it.id != null ? it.id : '');
        if (id && !it.vendido && !bens.has(id)) bens.set(id, it);
      }
    } catch { /* ignore corpo indisponível */ }
  });

  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    for (const { sala, url } of VG_ROTAS) {
      const antes = bens.size;
      try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
      catch (e) { console.log(`    VendasGov/${sala}: goto (${String(e.message).slice(0, 35)})`); }
      await new Promise(r => setTimeout(r, 6000)); // SPA boota + carrega a 1ª página
      // Rola para disparar a paginação por scroll (novos XHR interceptados).
      // Para quando parar de crescer por 3 rolagens seguidas (teto 40).
      let estavel = 0;
      for (let s = 0; s < 40 && estavel < 3; s++) {
        const n0 = bens.size;
        try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch { /* */ }
        await new Promise(r => setTimeout(r, 1800));
        estavel = bens.size > n0 ? 0 : estavel + 1;
      }
      console.log(`    VendasGov/${sala}: +${bens.size - antes} (acumulado ${bens.size})`);
    }
  } finally { await page.close().catch(() => {}); }

  const seen = new Set();
  const imoveis = [];
  for (const it of bens.values()) {
    const row = mapImovelVG(it);
    if (!row.valor_minimo || !row.estado || seen.has(row.fonte_id)) continue;
    seen.add(row.fonte_id);
    imoveis.push(row);
  }
  console.log(`    VendasGov: ${imoveis.length} imóveis mapeados (${bens.size} colhidos)`);
  return imoveis;
}

// ─── PESTANA LEILÕES ──────────────────────────────────────────────────────────
// Grande leiloeiro (líder no Sul). API JSON same-origin (o page.evaluate fetch passa,
// sem WAF). Modelo em 2 níveis, confirmado por captura real (debug_fetch):
//   /api/v2/leilao                      → todos os leilões (com documentos[]=Edital,
//                                          subTipoBens, data, leiloeiro, lotes[])
//   /api/v2/lote?leilao={id}&page&qtd   → lotes do leilão (lanceMinimo, descricao,
//                                          situacaoId, bens[].tipoBem/subTipoBem/origem/
//                                          imagens/caracteristicas)
// Fotos: ged.pestanaleiloes.com.br/ged/{arquivo}. Filtramos SÓ imóveis (tipoBem 462)
// e lotes DISPONÍVEIS (situacaoId=1) — o portal mistura veículos e lotes encerrados.
const PESTANA_BASE = 'https://www.pestanaleiloes.com.br';
const PESTANA_GED = 'https://ged.pestanaleiloes.com.br/ged/';
const PESTANA_TIPOBEM_IMOVEL = 462;

function parseDataPestana(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const ano = Number(m[1]);
  if (ano < 2020 || ano > 2035) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00`;
}

// Cidade/UF: primeiro dos campos do bem; senão extrai do texto ("… Cidade/UF …").
function cidadeUfPestana(bem, desc) {
  let cidade = String((bem && bem.cidade && bem.cidade.name) || '').trim();
  let uf = String((bem && bem.estado && bem.estado.name) || '').trim().toUpperCase().slice(0, 2);
  if (!cidade || !/^[A-Z]{2}$/.test(uf)) {
    const m = String(desc || '').match(/([A-Za-zÀ-ÿ'.\- ]{2,40})\/([A-Z]{2})\b/);
    if (m) { cidade = cidade || m[1].trim(); if (!/^[A-Z]{2}$/.test(uf)) uf = m[2]; }
  }
  return { cidade, uf: /^[A-Z]{2}$/.test(uf) ? uf : '' };
}

function mapLotePestana(lote, leilao) {
  const bens = Array.isArray(lote.bens) ? lote.bens : [];
  const bem = bens.find(b => b && b.tipoBem && Number(b.tipoBem.id) === PESTANA_TIPOBEM_IMOVEL);
  if (!bem) return null; // não é imóvel (veículo/outros)
  const valor = Number(lote.lanceMinimo || lote.valorInicial || lote.valorFiltro || 0) || 0;
  const desc = String(lote.descricao || bem.descricao || '').replace(/\s+/g, ' ').trim();
  const { cidade, uf } = cidadeUfPestana(bem, desc);
  // Área a partir das características ("893,46m²").
  let area = 0;
  for (const c of (bem.caracteristicas || [])) {
    const mm = String((c && c.valor) || '').match(/([\d.,]+)\s*m²/);
    if (mm) { area = parseBRL(mm[1]); break; }
  }
  // Foto: 1ª imagem do bem (arquivo → GED). Terrenos costumam não ter foto.
  const img = Array.isArray(bem.imagens) && bem.imagens[0];
  const foto = img ? (img.arquivo ? `${PESTANA_GED}${encodeURIComponent(img.arquivo)}` : (img.link || null)) : null;
  const origem = String(bem.origem || '').toLowerCase();
  const modalidade = origem.includes('extra') ? 'extrajudicial' : origem.includes('judicial') ? 'judicial' : 'extrajudicial';
  const edital = (Array.isArray(leilao.documentos) ? leilao.documentos.find(d => d && /edital/i.test(d.nome || '')) : null);
  const agenda = `${PESTANA_BASE}/agenda-de-leiloes/${leilao.id}`;
  return {
    fonte: 'PESTANA',
    fonte_id: `pestana_${lote.id}`,
    titulo: (desc || `Lote ${lote.numero || lote.id}`).slice(0, 180),
    tipo: normalizarTipo((bem.subTipoBem && bem.subTipoBem.nome) || desc),
    modalidade,
    estado: uf,
    cidade: cidade ? toTitleCase(cidade) : '',
    bairro: '',
    endereco: '',
    valor_avaliacao: 0,
    valor_minimo: valor,
    area_m2: area,
    descricao: [desc, leilao.nome].filter(Boolean).join(' — ').slice(0, 500),
    link_edital: (edital && edital.link) || agenda,
    url_lote: agenda,
    link_foto: foto,
    leiloeiro: String(leilao.leiloeiro || 'Pestana Leilões').slice(0, 120),
    data_leilao: parseDataPestana(leilao.data),
    forma_pagamento: 'a_vista',
  };
}

async function scraperPestana(browser) {
  console.log('  Pestana Leilões — API /api/v2 same-origin (leilão → lotes)...');
  const page = await browser.newPage();
  const imoveis = [];
  const seen = new Set();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    try { await page.goto(`${PESTANA_BASE}/lotes/imoveis`, { waitUntil: 'domcontentloaded', timeout: 45000 }); }
    catch (e) { console.log(`    Pestana: goto (${String(e.message).slice(0, 35)})`); }
    await new Promise(r => setTimeout(r, 4000)); // boot

    // 1) Todos os leilões.
    const leiloes = await page.evaluate(async () => {
      try { const r = await fetch('/api/v2/leilao', { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
      catch (e) { return null; }
    }).catch(() => null);
    if (!Array.isArray(leiloes)) { console.log('    Pestana: /api/v2/leilao não retornou lista'); return []; }

    // 2) Só leilões que contêm IMÓVEIS (subTipoBens com tipoBem 462).
    const imovLeiloes = leiloes.filter(l => Array.isArray(l.subTipoBens) && l.subTipoBens.some(s => Number(s.tipoBem) === PESTANA_TIPOBEM_IMOVEL));
    console.log(`    Pestana: ${imovLeiloes.length}/${leiloes.length} leilões com imóveis`);

    // 3) Lotes por leilão (fetch same-origin dentro da página).
    for (const leilao of imovLeiloes) {
      const lotes = await page.evaluate(async (id) => {
        try { const r = await fetch(`/api/v2/lote?leilao=${id}&page=1&qtd=300`, { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
        catch (e) { return null; }
      }, leilao.id).catch(() => null);
      if (!Array.isArray(lotes)) continue;
      for (const lote of lotes) {
        if (lote && lote.situacaoId != null && Number(lote.situacaoId) !== 1) continue; // só Disponível
        const row = mapLotePestana(lote, leilao);
        if (!row || !row.valor_minimo || seen.has(row.fonte_id)) continue;
        seen.add(row.fonte_id);
        imoveis.push(row);
      }
      await new Promise(r => setTimeout(r, 120));
    }
  } finally { await page.close().catch(() => {}); }
  console.log(`    Pestana: ${imoveis.length} imóveis mapeados`);
  return imoveis;
}

async function relatorioCapitacao() {
  const { data } = await supabase
    .from('imoveis_leilao')
    .select('fonte')
    .eq('ativo', true);

  if (!data) return;

  const contagem = {};
  data.forEach(({ fonte }) => { contagem[fonte] = (contagem[fonte] || 0) + 1; });

  console.log('\n📊 Captação atual por leiloeiro:');
  Object.entries(contagem).sort((a, b) => b[1] - a[1]).forEach(([fonte, qtd]) => {
    console.log(`   ${fonte.padEnd(12)} ${qtd.toLocaleString('pt-BR')} imóveis`);
  });
  console.log();
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

// Enriquecimento GENÉRICO de documentos por lote (serve para QUALQUER leiloeiro).
// Roda no NAVEGADOR REAL (renderiza JS), então captura Edital / Matrícula / Laudo
// de Avaliação / Modelo de Proposta que o fetch simples do on-demand não enxerga
// (páginas de detalhe com documentos montados por JavaScript). Os links entram em
// `anexos` (jsonb) — NÃO mexemos em link_edital (que continua sendo a página do
// lote para o botão "Acessar leiloeiro"); só preenchemos link_matricula se vazio.
// Bounded por cap + deadline: preenche progressivamente entre as execuções diárias
// (mesmo ritmo do CEF). NUNCA lança — enriquece em memória; se um lote falhar, ele
// segue com o que já tinha e o scrape/salvamento continua normalmente.
async function enriquecerDocumentosLote(browser, imoveis, { cap = 150, deadlineMs = 8 * 60 * 1000 } = {}) {
  const alvos = (imoveis || []).filter(im => {
    const url = im.url_lote || im.link_edital;
    const jaTem = im.link_matricula || (Array.isArray(im.anexos) && im.anexos.length);
    return url && /^https?:\/\//.test(url) && !jaTem;
  }).slice(0, cap);
  if (!alvos.length) return 0;

  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const fim = Date.now() + deadlineMs;
  let enr = 0;
  try {
    for (const im of alvos) {
      if (Date.now() > fim) { console.log('    Documentos: deadline atingido — resto fica p/ a próxima execução'); break; }
      const url = im.url_lote || im.link_edital;
      try {
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        const html = await page.content(); // DOM RENDERIZADO (docs montados por JS aparecem aqui)
        const docs = vasculharDocumentos(html, url, im.link_foto || null);
        const achouAlgo = docs.matricula || docs.laudo || (Array.isArray(docs.anexos) && docs.anexos.length);
        if (achouAlgo) {
          if (!im.url_lote) im.url_lote = url;          // preserva a página do lote
          if (Array.isArray(docs.anexos) && docs.anexos.length) im.anexos = docs.anexos; // inclui edital/matrícula/laudo/proposta
          if (docs.matricula && !im.link_matricula) im.link_matricula = docs.matricula;
          if (docs.regras && !im.link_regras_venda) im.link_regras_venda = docs.regras;
          enr++;
        }
      } catch { /* lote a lote; nunca derruba o scrape */ }
    }
  } finally { await page.close().catch(() => {}); }
  console.log(`    📄 Documentos: ${enr}/${alvos.length} lotes enriquecidos (edital/matrícula/laudo/proposta).`);
  return enr;
}

async function main() {
  console.log(`\n🏠 Scraper Puppeteer — ${new Date().toISOString()}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: BROWSER_ARGS,
  });

  let total = 0;

  // Filtro opcional de fontes (env SCRAPER_FONTES="VENDASGOV" ou "MEGA,SOLD").
  // Vazio = roda todas. Útil para testar/reprocessar uma fonte isolada sem re-scrapear tudo.
  const ONLY = String(process.env.SCRAPER_FONTES || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean);
  const rodar = (f) => !ONLY.length || ONLY.includes(f);
  if (ONLY.length) console.log(`⚙️  SCRAPER_FONTES ativo — rodando apenas: ${ONLY.join(', ')}\n`);

  try {
    // 1. Mega Leilões — varre TODAS as páginas (todos os estados), somente ativos
    if (rodar('MEGA')) {
    console.log('📋 Mega Leilões...');
    {
      const runStart = new Date().toISOString();
      const imoveis = await scraperMegaLeiloes(browser);
      // Captura os documentos (edital/matrícula/laudo/proposta) da página de detalhe —
      // renderiza JS, então pega o que o on-demand (fetch simples) não vê. Bounded.
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 150 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos Mega falhou (segue sem): ${e.message.slice(0, 80)}`); }
      // salva em lotes de 500 para não estourar payload
      for (let i = 0; i < imoveis.length; i += 500) {
        await salvarImoveis(imoveis.slice(i, i + 500), `Mega ${i + 1}-${Math.min(i + 500, imoveis.length)}`);
      }
      total += imoveis.length;
      // Desativa lotes Mega que saíram do ar (encerrados) — só se a coleta foi
      // saudável (>50), para um erro de rede não zerar o acervo.
      if (imoveis.length > 50) {
        const { error, count } = await supabase
          .from('imoveis_leilao')
          .update({ ativo: false }, { count: 'exact' })
          .eq('fonte', 'MEGA')
          .eq('ativo', true)
          .lt('atualizado_em', runStart);
        if (error) console.error('  Erro ao desativar Mega encerrados:', error.message);
        else console.log(`  🔻 Mega: ${count ?? 0} lotes encerrados desativados`);
      } else {
        console.log('  ⚠️ Mega coletou ≤50 — pulando desativação por segurança');
      }
      await registrarSaude('MEGA', imoveis, 'principal', validarColeta(imoveis, 'MEGA'));
    }
    }

    // Coleta + salva + registra saúde de uma fonte (validação de qualidade).
    const coletarFonte = async (fonte, fn) => {
      const imoveis = (await fn()) || [];
      total += await salvarEFinalizar(imoveis, fonte);
      await registrarSaude(fonte, imoveis, 'principal', validarColeta(imoveis, fonte));
    };

    // 2. Superbid (portal 2) — API offers, todas as páginas, somente abertos
    console.log('\n📋 Superbid...');
    if (rodar('SUPERBID')) await coletarFonte('SUPERBID', () => scraperSuperbidNet(browser, { portalId: '[2]', fonte: 'SUPERBID', leiloeiro: 'Superbid', prefix: 'sbid', baseSite: 'https://www.superbid.net' }));

    // 3. Sold (portal 15 — mesma rede Superbid) — API offers, somente abertos
    console.log('\n📋 Sold Leilões...');
    if (rodar('SOLD')) await coletarFonte('SOLD', () => scraperSuperbidNet(browser, { portalId: '[15]', fonte: 'SOLD', leiloeiro: 'Sold Leilões', prefix: 'sold', baseSite: 'https://www.sold.com.br' }));

    // 4. PortalZuk (Zukerman) — listagem com scroll infinito, somente ativos
    console.log('\n📋 PortalZuk (Zukerman)...');
    if (rodar('ZUK')) await coletarFonte('ZUK', () => scraperPortalZuk(browser));

    // 5. Sodré Santoro — API search-lots interceptada, somente ativos
    console.log('\n📋 Sodré Santoro...');
    if (rodar('SODRE')) await coletarFonte('SODRE', () => scraperSodre(browser));

    // 6. Frazão Leilões — server-rendered, lotes por leilão de imóveis
    console.log('\n📋 Frazão Leilões...');
    if (rodar('FRAZAO')) await coletarFonte('FRAZAO', () => scraperFrazao(browser));

    // 7. Leilões Judiciais — REATIVADO via NAVEGADOR REAL (page.evaluate → TLS de
    // Chrome). Esteira multi-estratégia: tenta get-lotes (traz a DATA da praça) e,
    // se o site mudar, cai no get-bens-por-estados. A estratégia que passa é
    // registrada em fonte_saude (vira a principal). O Bright Data
    // (api/scraper-leiloeiros.js → coletarLJUD) fica de BACKUP, e é poupado quando
    // esta coleta mantém o LJUD fresco — controlando o custo.
    console.log('\n📋 Leilões Judiciais (portal nacional — navegador)...');
    if (rodar('LJUD')) {
      const { imoveis, estrategia, validacao } = await coletarComEsteira('LJUD', [
        { nome: 'navegador-getlotes', fn: () => scraperLJUD_navegador(browser, 'get-lotes') },
        { nome: 'navegador-getbens',  fn: () => scraperLJUD_navegador(browser, 'get-bens-por-estados') },
      ]);
      total += await salvarEFinalizar(imoveis, 'LJUD');
      await registrarSaude('LJUD', imoveis, estrategia, validacao);
    }

    // 8. Imóveis da União (VendasGov / SPU-SERPRO) — API pública, inventário
    // EXCLUSIVO (não duplica leiloeiros). Captura multi-rota de documentos: a foto
    // (capa) vem direto da API; edital/laudo/matrícula são vasculhados na página de
    // detalhe renderizada (enriquecerDocumentosLote), igual ao fluxo do Mega.
    console.log('\n📋 Imóveis da União (VendasGov)...');
    if (rodar('VENDASGOV')) try {
      const imoveis = await scraperVendasGov(browser);
      // A FOTO já vem da API (capa). NÃO usamos enriquecerDocumentosLote aqui: as
      // páginas de detalhe são SPA (Angular) e vasculharDocumentos não enxerga os PDFs
      // (montados via API) — só gastaria os 8 min do deadline à toa. Edital/laudo do
      // VendasGov virão por rota própria (API /api/public/editais) como follow-up.
      total += await salvarEFinalizar(imoveis, 'VENDASGOV');
      await registrarSaude('VENDASGOV', imoveis, 'principal', validarColeta(imoveis, 'VENDASGOV'));
    } catch (e) {
      // Fonte nova nunca pode derrubar o job (as demais já salvaram acima).
      console.log(`  ⚠️ VendasGov falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
    }

    // 9. Pestana Leilões — API /api/v2 (leilão → lotes), só imóveis disponíveis.
    // Foto direto do GED; edital direto do documentos[]. Doc-enrich não roda aqui
    // (o edital já vem no JSON). Blindado: nunca derruba o job.
    console.log('\n📋 Pestana Leilões...');
    if (rodar('PESTANA')) try {
      const imoveis = await scraperPestana(browser);
      total += await salvarEFinalizar(imoveis, 'PESTANA');
      await registrarSaude('PESTANA', imoveis, 'principal', validarColeta(imoveis, 'PESTANA'));
    } catch (e) {
      console.log(`  ⚠️ Pestana falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
    }

  } finally {
    await browser.close();
  }

  await relatorioCapitacao();
  console.log(`✅ Scraper Puppeteer concluído: ${total} imóveis processados\n`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
