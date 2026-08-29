/**
 * Scraper Puppeteer — Leiloeiros com proteção anti-bot
 * Fontes: Mega Leilões, Sold Leilões, Superbid, Banco do Brasil
 *
 * Estratégia: intercepta chamadas XHR/fetch do próprio site para capturar
 * as APIs internas JSON — mais robusto que scraping de HTML.
 */

import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { vasculharDocumentos, chaveDocCanonica } from '../api/_doc-scan.js';
import { ehFracaoIdeal, extrairAreaM2 } from './lib/scraper-core.mjs';
import MUNICIPIOS from '../api/_municipios.js';

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
      t.includes('kitnet') || t.includes('kitinete') || t.includes('studio') || t.includes('cobertura')) return 'apartamento';
  if (t.includes('casa') || t.includes('sobrado') || t.includes('resid')) return 'casa';
  // 'area' CRU sai de propósito (bate com api/_tipo.js): senão "Galpão com área…" cairia
  // em terreno (este ramo vem antes do comercial). Só "area/data de terra" indica terreno.
  if (t.includes('terreno') || t.includes('lote') || t.includes('gleba') ||
      t.includes('data de terra') || t.includes('area de terra')) return 'terreno';
  if (t.includes('comerc') || t.includes('sala') || t.includes('loja') || t.includes('galp') ||
      t.includes('barrac') || t.includes('industr') || t.includes('armazem') ||
      t.includes('deposito') || t.includes('predio') || t.includes('escritorio') ||
      t.includes('conjunto') || t.includes('ponto') || t.includes('hotel') ||
      t.includes('pousada') || t.includes('motel')) return 'comercial';
  return 'imovel';
}

// Reforço CENTRAL de tipologia (choke point único p/ TODAS as fontes, aplicado no
// salvarImoveis). Quando o mapper da fonte NÃO classificou (tipo genérico 'imovel'),
// deriva o tipo: (a) da CATEGORIA embutida na URL do lote — autoritativa no Grupo Lance
// (/imoveis/<categoria>/…: terrenos-e-lotes→terreno, casas→casa, imoveis-rurais→rural,
// galpoes/imoveis-industriais→comercial…) — e, em seguida, (b) do TÍTULO do leiloeiro.
// Só faz UPGRADE do balde genérico: nunca sobrescreve um tipo específico que a fonte já
// entregou (regra do dono: o tipo espelha como veio do leiloeiro, não a nossa suposição).
// Corrige o vazamento de terrenos genéricos na intenção "Locação" (ex.: Bertioga).
function reforcarTipo(im) {
  if (im && im.tipo && im.tipo !== 'imovel') return im.tipo;
  const cat = (String((im && im.url_lote) || '').match(/\/imoveis\/([^/?#]+)/) || [])[1] || '';
  if (cat) { const tc = normalizarTipo(cat.replace(/-/g, ' ')); if (tc !== 'imovel') return tc; }
  return normalizarTipo((im && im.titulo) || '');
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

// Só imóveis do BRASIL (legislação) e sem valores placeholder. UFs válidas do país:
const UFS_BR = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
// UF vazia é tolerada (lote BR sem UF extraída — backfill à parte); UF preenchida tem de
// ser brasileira. Descarta estrangeiro (Peru/Paraguai/Argentina) e estado corrompido.
const ehBRouSemUF = (uf) => { const u = String(uf || '').trim().toUpperCase(); return u === '' || UFS_BR.has(u); };
// Reforço da regra "só Brasil" para o vazamento de estrangeiros com UF VAZIA: fontes da
// rede Superbid (SUPERBID/SBID9/SBID21/SOLD) têm inventário internacional (Paraguai/
// Argentina) que chega sem UF e escapa da tolerância acima. Se a UF está vazia e a CIDADE
// existe mas NÃO é município brasileiro (dataset IBGE), é estrangeiro → descarta. Mesma
// normalização de api/_geo.js (minúsculas, sem acento) para bater com as chaves "UF|cidade".
const normCidadeBR = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const CIDADES_BR = new Set(Object.keys(MUNICIPIOS).map(k => normCidadeBR(k.split('|')[1])));
const FONTES_INTERNACIONAIS = new Set(['SUPERBID', 'SBID9', 'SBID21', 'SOLD']);
const baseFonte = (f) => String(f || '').trim().toUpperCase().replace(/\s+\d.*$/, ''); // "SBID9 1-500" → "SBID9"
const ehEstrangeiroSemUF = (fonte, uf, cidade) => {
  if (String(uf || '').trim() !== '') return false;              // com UF: já coberto por ehBRouSemUF
  if (!FONTES_INTERNACIONAIS.has(baseFonte(fonte))) return false; // só as fontes com inventário internacional
  const c = normCidadeBR(cidade);
  return c.length >= 3 && !CIDADES_BR.has(c);                     // cidade preenchida e não é município BR ⇒ estrangeiro
};
// Sentinela de preço: placeholder que alguns scrapers gravam quando NÃO leram o valor.
// NUNCA armazenar — mostrar R$999.999.999 é falha crítica e perde confiabilidade. Anula
// (o lote fica "sem lance" até o valor ser confirmado no edital).
const SENTINELAS_VALOR = new Set([999999999, 99999999, 9999999999, 111111111, 123456789]);
const semSentinela = (v) => (SENTINELAS_VALOR.has(Number(v)) ? null : v);

async function salvarImoveis(imoveis, fonte) {
  if (!imoveis.length) return { salvos: 0, esperados: 0 };
  // Guarda 1: só BRASIL. Descarta estrangeiros / estado inválido ANTES de salvar.
  // Inclui o caso UF-vazia + cidade estrangeira (rede Superbid) via ehEstrangeiroSemUF.
  const totalBruto = imoveis.length;
  imoveis = imoveis.filter(im => ehBRouSemUF(im.estado) && !ehEstrangeiroSemUF(fonte, im.estado, im.cidade));
  if (imoveis.length < totalBruto) console.log(`  [${fonte}] ${totalBruto - imoveis.length} lote(s) descartado(s) — fora do Brasil / estado inválido.`);
  if (!imoveis.length) return;

  // MESCLAGEM de documentos (fix de raiz): o upsert por fonte_id sobrescreve a linha
  // inteira, então o scrape diário APAGAVA os anexos/matrícula capturados fora dele
  // (backfill em jsonb de MEGA/BIASI/Sodré era transitório). Aqui carregamos os docs
  // já existentes e fazemos UNIÃO — o scrape do dia é a fonte da verdade, mas os docs
  // de backfill que ele não traz são preservados. Links de coluna (matrícula/regras)
  // idem: só sobrescreve quando o scrape traz um valor novo.
  const fonteIds = imoveis.map(im => im.fonte_id).filter(Boolean);
  const existentes = new Map();
  for (let i = 0; i < fonteIds.length; i += 150) {
    try {
      const { data } = await supabase
        .from('imoveis_leilao')
        .select('fonte_id, anexos, link_matricula, link_regras_venda, link_edital, valor_avaliacao')
        .in('fonte_id', fonteIds.slice(i, i + 150));
      for (const r of data || []) existentes.set(r.fonte_id, r);
    } catch (e) { console.log(`  [${fonte}] merge-docs lookup erro: ${String(e.message).slice(0, 80)}`); }
  }

  // ANTI VALUE-BLEEDING (raiz do bug LEILOFY): a MESMA avaliação/área COM CENTAVOS em >=3 lotes
  // de >=2 cidades no MESMO scrape é quase certo um seletor GLOBAL vazando (bloco "destaque"/
  // "relacionados") para vários lotes → anula (melhor "a confirmar" que um número mentiroso).
  const bledSet = (campo) => {
    const m = new Map();
    for (const im of imoveis) {
      const v = Number(im[campo]) || 0;
      if (v > 0 && Math.round(v * 100) % 100 !== 0) {
        const e = m.get(v) || { n: 0, cid: new Set() };
        e.n++; e.cid.add(String(im.cidade || '')); m.set(v, e);
      }
    }
    return new Set([...m].filter(([, e]) => e.n >= 3 && e.cid.size >= 2).map(([v]) => v));
  };
  const avalBled = bledSet('valor_avaliacao');
  const areaBled = bledSet('area_m2');
  const minBled  = bledSet('valor_minimo'); // o preço HEADLINE (lance mín.) também precisa da trava

  const rows = imoveis.map(im => {
    // Guarda 2: anula valores sentinela (placeholder) — nunca vira preço exibido.
    let vMin = semSentinela(im.valor_minimo);
    let vAval = semSentinela(im.valor_avaliacao);
    // TRAVA DE CREDIBILIDADE: avaliação grudada (bleeding) OU que implique desconto >=88% (aval
    // > 8,3x o mínimo — quase sempre mis-read/valor de outro lote) NÃO pode virar "% OFF" falso
    // no card/relatório → vira AUSENTE. Espelha a trava do gerar-analise.js (defesa em 2 camadas).
    if (avalBled.has(Number(vAval))) vAval = 0;
    if (Number(vAval) > 0 && Number(vMin) > 0 && (1 - Number(vMin) / Number(vAval)) >= 0.88) vAval = 0;
    if (minBled.has(Number(vMin))) vMin = 0; // lance mín. grudado (seletor vazando) → melhor "—" que preço mentiroso
    let areaM2 = Number(im.area_m2) || 0;
    if (areaBled.has(areaM2)) areaM2 = 0; // área grudada → melhor 0 (a matrícula/edital corrige)
    // url_lote: sem ele o imóvel NUNCA entra na fila de captura de documentos (bug do MEGA, que
    // só preenchia link_edital). Deriva da página do lote (link_edital http) quando o mapper faltou.
    const urlLote = im.url_lote || (/^https?:\/\//i.test(im.link_edital || '') ? im.link_edital : null);
    // Desconto/viabilidade SÓ com os dois valores presentes (>0). Sem isto, mínimo nulo
    // com avaliação preenchida virava "100% de desconto" (falso).
    const temPar = Number(vAval) > 0 && Number(vMin) > 0;
    const row = {
      ...im,
      tipo: reforcarTipo(im), // choke point: upgrade do balde 'imovel' via categoria-URL/título
      valor_minimo: vMin,
      valor_avaliacao: vAval,
      area_m2: areaM2,
      url_lote: urlLote,
      ativo: true, // coletado agora ⇒ está ativo (reativa lotes que voltaram)
      viavel: temPar ? (1 - vMin / vAval) >= 0.3 : null,
      score_viabilidade: temPar ? Math.min(100, Math.round((1 - vMin / vAval) * 150)) : 30,
      desconto_percentual: temPar ? Math.round((1 - vMin / vAval) * 100) : null,
      atualizado_em: new Date().toISOString(),
    };
    const prev = im.fonte_id ? existentes.get(im.fonte_id) : null;
    if (prev) {
      // União de anexos por ARQUIVO — chave CANÔNICA, não URL completa (novos primeiro;
      // agrega os de backfill que faltaram). Cap 25. Era a raiz do "7x Edital": o CDN
      // do GL/ZUK muda a querystring (?v=/assinatura) a cada visita e a união por URL
      // completa acrescentava o MESMO edital a cada rodada diária. Com a chave canônica,
      // o scrape do dia SUBSTITUI a variante antiga (assinatura expirada = link morto).
      const novos = Array.isArray(im.anexos) ? im.anexos : [];
      const antigos = Array.isArray(prev.anexos) ? prev.anexos : [];
      if (antigos.length) {
        const kDe = (a) => chaveDocCanonica(a?.url) || a?.url || null;
        const vistos = new Set(novos.map(kDe).filter(Boolean));
        const merge = [...novos];
        for (const a of antigos) { const k = kDe(a); if (k && !vistos.has(k)) { vistos.add(k); merge.push(a); } }
        row.anexos = merge.slice(0, 25);
      }
      // Preserva links de documento do backfill quando o scrape do dia não os traz.
      if (prev.link_matricula && !im.link_matricula) row.link_matricula = prev.link_matricula;
      if (prev.link_regras_venda && !im.link_regras_venda) row.link_regras_venda = prev.link_regras_venda;
      // link_edital idem: o scrape do dia (listagem) muitas vezes NÃO traz o edital (ou traz só a
      // página do lote), enquanto a captura dedicada (ex.: matricula-cef grava o PDF do edital).
      // Sem preservar, o scrape diário zerava o edital capturado → o nº de docs "flutuava" entre
      // rodadas e re-baixava à toa. Agora só sobrescreve quando o dia traz um edital novo.
      if (prev.link_edital && !im.link_edital) row.link_edital = prev.link_edital;
      // AVALIAÇÃO recuperada FORA do scrape (garantirValores/on-demand leram o edital e
      // corrigiram o banco) não pode ser ZERADA pelo upsert diário: o card da listagem de
      // GL/LJUD/SODRE não traz avaliação (vem 0) e a linha inteira é sobrescrita. Preserva
      // o valor confirmado e mantém desconto/viabilidade coerentes com ele.
      const avalPrev = Number(prev.valor_avaliacao) || 0;
      if (!(Number(row.valor_avaliacao) > 0) && avalPrev > 0 && !SENTINELAS_VALOR.has(avalPrev)) {
        row.valor_avaliacao = avalPrev;
        const vm = Number(row.valor_minimo) || 0;
        if (vm > 0 && avalPrev >= vm) {
          row.desconto_percentual = Math.round((1 - vm / avalPrev) * 100);
          row.viavel = (1 - vm / avalPrev) >= 0.3;
          row.score_viabilidade = Math.min(100, Math.round((1 - vm / avalPrev) * 150));
        }
      }
    }
    return row;
  });

  // FRAÇÃO IDEAL FORA (decisão do dono, 17/08). Este coletor genérico serve a maioria das
  // fontes e NÃO passa por `checarQualidade` — foi por aqui que entraram 117 dos 120 lotes de
  // parte/fração ideal do acervo (LJUD 53, SUPERBID 21, LEILOFY 13, MEGA 10, GRUPOLANCE 8…).
  // O mesmo `ehFracaoIdeal` do portão compartilhado, para a regra ter UMA definição só: dois
  // regexes equivalentes em arquivos diferentes divergem no primeiro ajuste, e aí a fonte que
  // ficou para trás volta a admitir o que a outra barra.
  const limpos = rows.filter(r => !ehFracaoIdeal(r));
  const barrados = rows.length - limpos.length;
  if (barrados) console.log(`  ⛔ ${fonte}: ${barrados} lote(s) de parte/fração ideal barrados (fora do acervo por decisão de negócio)`);
  if (!limpos.length) { console.log(`  ${fonte}: nada a salvar após o filtro.`); return { salvos: 0, esperados: 0 }; }

  const { error } = await supabase
    .from('imoveis_leilao')
    .upsert(limpos, { onConflict: 'fonte_id', ignoreDuplicates: false });

  // O ERRO PRECISA SUBIR (18/08). Antes ele virava só um console.error e a função não devolvia
  // nada — quem chama seguia como se tivesse gravado, e o sweep logo abaixo desativava a fonte
  // inteira com base no que foi COLETADO. Ver salvarEFinalizar.
  if (error) { console.error(`  Erro ao salvar ${fonte}:`, error.message); return { salvos: 0, esperados: limpos.length }; }
  console.log(`  ✅ ${fonte}: ${limpos.length} imóveis salvos`);
  return { salvos: limpos.length, esperados: limpos.length };
}

// Salva em lotes de 500 e desativa os obsoletos da fonte (lotes que saíram do
// ar). Trava de segurança: só desativa se a coleta foi saudável (>50), para um
// erro de rede não zerar o acervo. Retorna a quantidade coletada.
async function salvarEFinalizar(imoveis, fonte) {
  const runStart = new Date().toISOString();
  let salvos = 0, esperados = 0;
  for (let i = 0; i < imoveis.length; i += 500) {
    const r = await salvarImoveis(imoveis.slice(i, i + 500), `${fonte} ${i + 1}-${Math.min(i + 500, imoveis.length)}`);
    salvos += r.salvos; esperados += r.esperados;
  }
  // O GATE OLHA O GRAVADO, NÃO O COLETADO (18/08). `imoveis.length > 50` mede o que o scrape
  // BAIXOU; o sweep abaixo desativa tudo que não foi tocado nesta rodada. Se os upserts
  // falharem, nada é tocado — e a condição, apoiada no número errado, mandava desativar o
  // acervo INTEIRO da fonte. Este coletor serve MEGA, SUPERBID, LJUD, GRUPOLANCE, ZUK, BIASI e
  // PESTANA: o grosso do acervo fora da CEF, em uma única chamada.
  //
  // `esperados` exclui de propósito os lotes barrados por fração ideal — esses NÃO foram
  // gravados por decisão de negócio, e é correto que o sweep os aposente.
  const gravouTudo = salvos === esperados;
  if (!gravouTudo) {
    console.error(`  🛑 ${fonte}: sweep PULADO — gravou ${salvos} de ${esperados}. Desativar aqui aposentaria lote por falha nossa.`);
  }
  if (salvos > 50 && gravouTudo) {
    const { error, count } = await supabase
      .from('imoveis_leilao')
      .update({ ativo: false }, { count: 'exact' })
      .eq('fonte', fonte)
      .eq('ativo', true)
      .lt('atualizado_em', runStart);
    if (error) console.error(`  Erro ao desativar ${fonte} obsoletos:`, error.message);
    else console.log(`  🔻 ${fonte}: ${count ?? 0} lotes obsoletos desativados`);
  } else if (gravouTudo) {
    console.log(`  ⚠️ ${fonte} gravou ${salvos} (≤50) — pulando desativação por segurança`);
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
  // Biasi: server-rendered; cidade/UF no título ("… - Cidade/UF"), valor e link fortes.
  BIASI:    { min: 30,  valor: 0.85, uf: 0.55, link: 0.9 },
  // Leilão VIP: server-rendered; cidade/UF vêm limpos do .anc-local, valor e link fortes.
  VIP:      { min: 20,  valor: 0.85, uf: 0.55, link: 0.9 },
  // Leilotech: plataforma white-label de vários leiloeiros (GraphQL). Cloudflare
  // intermitente → volume varia; min baixo para não marcar degradado à toa.
  LEILOTECH:{ min: 15,  valor: 0.70, uf: 0.45, link: 0.9 },
  // Suporte Leilões: plataforma white-label server-rendered (/buscador?categoria=2).
  SUPORTE:  { min: 10,  valor: 0.80, uf: 0.50, link: 0.9 },
  // Grupo Lance: server-rendered, catálogo grande; cidade/UF fortes (card-locality).
  GRUPOLANCE:{ min: 50, valor: 0.85, uf: 0.60, link: 0.9 },
  // Sub-portais da rede Superbid (inventário pequeno, leiloeiro real vem no campo
  // `store` de cada oferta). Portal 9 ~72, portal 21 ~39 imóveis abertos.
  SBID9:    { min: 5,   valor: 0.80, uf: 0.40, link: 0.9 },
  SBID21:   { min: 5,   valor: 0.80, uf: 0.40, link: 0.9 },
  // WebLeilões: inventário de imóveis pequeno (poucas dezenas); cidade/UF vêm do texto
  // do card e do slug — critérios brandos para não marcar "degradado" à toa.
  WEBLEILOES:{ min: 5,  valor: 0.60, uf: 0.45, link: 0.9 },
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
    // Auto-aprendizado (Passo 1b): refresca a qualidade na base de conhecimento —
    // upsert parcial preserva os campos ricos curados (plataforma/url_lote/etc.).
    try {
      const q = Number((((m.foto_pct || 0) + (m.valor_pct || 0) + (m.link_pct || 0)) / 3).toFixed(3));
      await supabase.from('leiloeiro_conhecimento').upsert(
        { fonte, qualidade: q, atualizado_em: new Date().toISOString() }, { onConflict: 'fonte' });
    } catch { /* base de conhecimento é opcional */ }
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

      // PRAÇAS EMPARELHADAS (1ª/2ª) — regra do dono: "quando há próxima praça, trazer as datas E
      // valores". Cada bloco .card-instance carrega título ("1ª Praça"), valor e data DA MESMA
      // praça. ADITIVO e DEFENSIVO: se a estrutura não existir, `pracas` fica [] e o mapeamento
      // segue o fluxo antigo (valores/dataLeilao) — zero regressão de captura.
      const pracas = Array.from(card.querySelectorAll('.card-instance')).map(ci => {
        const dEl = ci.querySelector('[class*="instance-date"]');
        return {
          titulo: norm(ci.querySelector('.card-instance-title')?.textContent) || '',
          valor: toNum(ci.querySelector('.card-instance-value')?.textContent),
          data: dEl ? parseData(dEl.textContent) : null,
        };
      }).filter(p => p.valor > 0);

      out.push({
        id: cont.getAttribute('data-key'),
        href,
        titulo: norm(card.querySelector('.card-title')?.textContent),
        numero: norm(card.querySelector('.card-number')?.textContent),
        localidade: card.querySelector('.card-locality')?.getAttribute('title')
          || norm(card.querySelector('.card-locality')?.textContent),
        instTitle: norm(card.querySelector('.card-instance-title')?.textContent),
        valores,
        pracas,
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

  // 2ª PRAÇA (ADITIVO): com as praças emparelhadas, guardamos a OUTRA praça (a que não é o
  // lance mínimo já em valor_minimo) + a data dela em valor_minimo_2/data_leilao_2, para o
  // detalhe do imóvel e o relatório exibirem/projetarem sobre as duas praças. NÃO mexemos em
  // valor_avaliacao/valor_minimo/data_leilao (min/max/próxima) → desconto e filtros do catálogo
  // ficam idênticos; o relatório escolhe a praça mais descontada lendo as duas colunas.
  let valorMinimo2 = null, dataLeilao2 = null;
  try {
    const ps = (c.pracas || []).filter(p => p && p.valor > 0);
    if (ps.length >= 2) {
      const ord = [...ps].sort((a, b) => a.valor - b.valor); // asc: [mais barata, ..., mais cara]
      const maisBarata = ord[0], outra = ord[ord.length - 1];
      if (outra.valor > maisBarata.valor) { valorMinimo2 = outra.valor; dataLeilao2 = outra.data || null; }
    }
  } catch { /* aditivo: nunca quebra a captura */ }

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
    valor_minimo_2: valorMinimo2,
    data_leilao_2: dataLeilao2,
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
          modalidade: (lot.titulo.toLowerCase().includes('judicial') && !/extra/i.test(lot.titulo || '')) ? 'judicial' : 'extrajudicial',
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
// `stores`: coleta por LOJA (white-label da rede — ex.: Total 16091, Crepaldi 16139, Round 35)
// em vez de portal; o filtro vira stores.id:<id> e o portalId sai da query (o site white-label
// consulta a MESMA offer-query assim — evidência no recon ofv35-total-xhr-list).
async function scraperSuperbidNet(browser, { portalId, stores, fonte, leiloeiro, prefix, baseSite, storeAsLeiloeiro = false }) {
  console.log(`  ${leiloeiro} — API offers (${stores ? `loja ${stores}` : `portal ${portalId}`}, somente abertos)...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  try {
    await page.goto(`${baseSite}/categorias/imoveis`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));

    const offers = await page.evaluate(async ([portal, lojas]) => {
      const FIELDS_BASE = 'id;linkURL;price;priceFormatted;endDate;endDateTime;offerStatus;store;product.shortDesc;product.location;product.productType;product.subCategory;product.thumbnailUrl;auction;offerDetail;offerDescription';
      // Campos de DOCUMENTO (edital/matrícula/laudo). Candidatos — a API ignora os
      // inexistentes; se por acaso REJEITAR o fieldList expandido (0 offers na 1ª página),
      // o fallback volta ao FIELDS_BASE → a coleta NUNCA quebra por causa disto.
      const FIELDS_DOCS = FIELDS_BASE + ';offerDocument;attachments;documents;offerAttachments;product.attachments;offerDetail.attachments;offerDetail.documents';
      const PS = lojas ? 30 : 100; // modo loja espelha o pageSize do próprio site white-label
      const apiUrl = (n, fields) => lojas
        // Modo LOJA: ESPELHO da URL que o site white-label usa (recon ofv35-total-xhr-list) —
        // portalId=[2,15] + requestOrigin=store são OBRIGATÓRIOS (sem eles a API devolve
        // vazio em silêncio; comprovado no 1º teste de 30/07). SEM filtro de productType
        // (a loja lista o catálogo inteiro) — imóveis são filtrados no mapeamento abaixo.
        ? `https://offer-query.superbid.net/offers/?filter=stores.id:${lojas}&locale=pt_BR&orderBy=endDate:asc&pageNumber=${n}&pageSize=${PS}&portalId=[2,15]&preOrderBy=orderByFirstOpenedOffers&requestOrigin=store&searchType=opened&timeZoneId=UTC${fields ? `&fieldList=${fields}` : ''}`
        : `https://offer-query.superbid.net/offers/?portalId=${portal}&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=product.productType.description:imoveis;&pageNumber=${n}&pageSize=${PS}&orderBy=endDate:asc&fieldList=${fields}`;
      const buscar = async (n, fields) => {
        try { const r = await fetch(apiUrl(n, fields), { headers: { Accept: 'application/json' } }); if (!r.ok) return null; const d = await r.json(); return d.offers || d.content || d.results || d.items || (Array.isArray(d) ? d : []); }
        catch { return null; }
      };
      let fields = FIELDS_DOCS;
      let first = await buscar(1, FIELDS_DOCS);
      if (!first || !first.length) { fields = FIELDS_BASE; first = await buscar(1, FIELDS_BASE); } // fallback seguro
      if ((!first || !first.length) && lojas) { fields = ''; first = await buscar(1, ''); } // loja: última carta — sem fieldList (payload cheio, como o site)
      const all = [...(first || [])];
      if (first && first.length >= PS) {
        for (let n = 2; n <= 100; n++) {
          const arr = await buscar(n, fields);
          if (!arr || !arr.length) break;
          all.push(...arr);
          if (arr.length < PS) break;
        }
      }
      return all;
    }, [portalId, stores || null]);

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

      // Modo LOJA: o catálogo vem INTEIRO (imóvel + veículo + equipamento + sucata) — o
      // filtro de imóvel é aqui, pelo productType da própria oferta.
      if (stores) { const pt = str(p.productType).toLowerCase(); if (!/im[oó]ve/.test(pt)) return null; }
      const titulo = str(p.shortDesc) || str(of.title);
      const estadoMatch = (locStr || '').match(/[-–]\s*([A-Z]{2})\s*$/);
      const valMin = parseFloat(det.initialBidValue || det.currentMinBid || of.price || 0);
      const valAval = parseFloat(det.referenceValue || det.directSaleValue || 0);
      if (!valMin) return null;

      const sub = str(p.subCategory);
      const tipoRaw = (sub && !/im[oó]ve/i.test(sub)) ? sub : titulo;
      const linkURL = str(of.linkURL);
      // DESCRIÇÃO (17/08): era `offerDescription || titulo`, e o resultado medido no acervo foi
      // **1.492 de 1.494 lotes SUPERBID com a descrição igual ao título** — ou seja,
      // `offerDescription` vem vazio em praticamente toda oferta e caíamos na manchete. Como o
      // corpo é onde mora a metragem, 377 lotes SUPERBID ficaram sem área (136 deles sem
      // matrícula nem edital, isto é, sem NENHUMA fonte de onde recuperá-la).
      //
      // A API já entrega outros campos no mesmo `fieldList` que pedimos e que estavam sendo
      // ignorados: `offerDetail` (detalhamento do lote) e `product.shortDesc` (descrição do
      // bem). Agora eles são CONCATENADOS — não escolhidos por prioridade — porque trazem
      // fatias diferentes (um costuma ter a condição, o outro a descrição física), e juntá-los
      // dá ao extrator de área mais chance de achar a metragem rotulada. Duplicatas saem.
      // O título só entra se, depois de tudo, não sobrar nada — aí é o que temos.
      const partesDesc = [str(of.offerDescription), str(of.offerDetail), str(p.shortDesc)]
        .map((x) => x.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
        .filter(Boolean);
      const vistosDesc = new Set();
      const descRica = partesDesc.filter((x) => {
        const k = x.toLowerCase();
        if (vistosDesc.has(k)) return false;
        vistosDesc.add(k); return true;
      }).join(' — ');
      const desc = descRica || titulo;
      // Área/ocupação vêm no texto (título+descrição) — confirmado nos dados.
      const ext = extrairDaDescricao(`${titulo} ${desc}`);
      // URL da página do lote (vem da API em linkURL). Serve tanto p/ link_edital
      // quanto p/ url_lote — este último destrava a captura de documentos
      // (enfileirar_docs_faltantes só enfileira quem tem url_lote http). Antes ficava
      // NULL nos ~1.431 SUPERBID + ~111 SBID, travando ~1,5k matrículas.
      const loteUrl = linkURL.startsWith('http') ? linkURL : (linkURL ? `${baseSite}${linkURL}` : `${baseSite}/oferta/${id}`);

      // DOCUMENTOS (edital/matrícula/laudo): a rede Superbid serve os anexos como PDFs em
      // s.superbid.net/attachment/… quando o fieldList os inclui. Varre as estruturas
      // prováveis + rede de segurança (qualquer .pdf solto no JSON da oferta) e classifica
      // pelo texto. Best-effort e ADITIVO: se não vier nada, `anexos` fica indefinido e o
      // enriquecerDocumentosLote (enrich) segue como estava — nunca piora.
      const anexos = (() => {
        try {
          const out = [], vis = new Set(), objSeen = new Set();
          // Classifica pelo ROTULO (objeto inteiro do anexo): a URL da rede Superbid é um
          // UUID opaco (s.superbid.net/attachment/…/uuid.pdf), mas o TIPO/nome-de-arquivo
          // vem em ALGUMA chave do objeto ("Edital", "Matrícula do imóvel"…). Por isso
          // classificamos pelo JSON inteiro do anexo, não por uma chave específica.
          const add = (url, label) => {
            if (!url || typeof url !== 'string') return;
            const u = url.startsWith('//') ? `https:${url}` : url;
            if (!/\.pdf(\?|#|$)/i.test(u) || vis.has(u)) return;
            vis.add(u);
            const t = `${label || ''} ${u}`.toLowerCase();
            const tipo = /matr[ií]cul/.test(t) ? 'matricula' : /(laudo|avalia)/.test(t) ? 'laudo'
                       : /(edital|regulament|condi[çc])/.test(t) ? 'edital' : 'outro';
            out.push({ nome: tipo.charAt(0).toUpperCase() + tipo.slice(1), url: u, tipo });
          };
          // Varre recursivamente o objeto da oferta: qualquer objeto com uma URL .pdf vira
          // anexo, rotulado pelo próprio objeto (pega o tipo em qualquer chave/aninhamento).
          const walk = (node, depth) => {
            if (!node || typeof node !== 'object' || depth > 5) return;
            if (Array.isArray(node)) { for (const it of node) walk(it, depth + 1); return; }
            const url = node.url || node.link || node.href || node.fileUrl || node.path || node.value || node.document || node.attachmentUrl;
            if (typeof url === 'string' && /\.pdf(\?|#|$)/i.test(url)) add(url, JSON.stringify(node));
            for (const k in node) { const v = node[k]; if (v && typeof v === 'object' && !objSeen.has(v)) { objSeen.add(v); walk(v, depth + 1); } }
          };
          walk(of, 0);
          // Rede final: qualquer .pdf solto no JSON (sem objeto) — entra como "outro".
          for (const m of (JSON.stringify(of).match(/https?:\\?\/\\?\/[^"'\s\\]*\.pdf/gi) || [])) add(m.replace(/\\\//g, '/'), '');
          return out.length ? out.slice(0, 12) : undefined;
        } catch { return undefined; }
      })();

      return {
        fonte,
        fonte_id: `${prefix}_${id}`,
        titulo: (titulo || `Imóvel ${leiloeiro}`).slice(0, 160),
        tipo: normalizarTipo(tipoRaw),
        modalidade: (of.auction?.subMarketplaces || []).some(s => /judicial/i.test(str(s)) && !/extra/i.test(str(s))) ? 'judicial' : 'extrajudicial',
        estado: (estadoMatch?.[1] || loc.state || loc.uf || '').toString().toUpperCase().slice(0, 2),
        cidade: toTitleCase((locStr || '').replace(/\s*[-–]\s*[A-Z]{2}\s*$/, '').trim()),
        bairro: toTitleCase(str(loc.neighborhood)),
        endereco: toTitleCase(str(loc.street)),
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        // `extrairDaDescricao` tem o regex antigo (exige `m²` literal). `extrairAreaM2` aceita
        // "m2"/"metros quadrados" e prefere área ROTULADA — entra como rede, nunca sobrescreve
        // o que o extrator específico já achou.
        area_m2: ext.area_m2 || extrairAreaM2(desc) || 0,
        ocupacao: ext.ocupacao || null,
        descricao: desc.replace(/<[^>]+>/g, '').slice(0, 500),
        link_edital: loteUrl,
        link_foto: p.thumbnailUrl || null,
        url_lote: loteUrl,
        ...(anexos ? { anexos } : {}),
        // Sub-portais: o leiloeiro real é a "loja" (store) de cada oferta; cai no
        // rótulo genérico da fonte se o campo vier vazio.
        leiloeiro: (storeAsLeiloeiro && str(of.store)) ? str(of.store).slice(0, 120) : leiloeiro,
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
  let ok = 0, edt = 0, feitos = 0;
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
      // ÁREA: o Zuk mostra "Metragem total" E "Metragem útil". Para preço/m² usar a
      // ÚTIL (privativa) — a total infla a área e SUBESTIMA o R$/m², o que fazia o
      // relatório de mercado SUPERESTIMAR o valor (usava a total). Cai p/ total, e só
      // então para a área genérica da descrição.
      const utilTxt  = (txt.match(/metragem\s*[úu]til[^\d]*([\d.,]+)\s*m/i) || [])[1];
      const totalTxt = (txt.match(/metragem\s*total[^\d]*([\d.,]+)\s*m/i) || [])[1];
      const areaZuk = utilTxt ? parseBRL(utilTxt) : (totalTxt ? parseBRL(totalTxt) : (ext.area_m2 || 0));
      if (areaZuk && !im.area_m2) im.area_m2 = areaZuk;
      if (ext.ocupacao && !im.ocupacao) im.ocupacao = ext.ocupacao;
      // EDITAL PDF real (recon 18/07): na ZUK o link_edital é a PÁGINA do lote, não o
      // PDF. O <a> "Edital de venda" aponta p/ o PDF em documentacaoleilao.portalzuk;
      // "Condições de venda" → PDF de regras. Gravamos em anexos (o relatório documental
      // passa a ler o PDF certo, não a página) e em link_regras_venda — SEM tocar em
      // link_edital, que segue sendo a página do lote usada NESTA re-visita (sobrescrever
      // quebraria a próxima visita e o botão "Acessar leiloeiro"). O filtro por PDF/host
      // ignora "Matrícula do Imóvel", cujo anchor aponta p/ a própria página do lote.
      const docsZuk = await page.evaluate(() => {
        const ehPdf = (u) => /\.pdf(?:[?#]|$)/i.test(u || '') || /documentacaoleilao\.portalzuk\.com\.br/i.test(u || '');
        const acha = (re) => {
          for (const el of document.querySelectorAll('a[href]')) {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (re.test(t) && ehPdf(el.href)) return el.href;
          }
          return null;
        };
        return { edital: acha(/edital/i), regras: acha(/condi[cç][õo]es\s*de\s*venda|regras/i) };
      });
      if (docsZuk.edital || docsZuk.regras) {
        if (!Array.isArray(im.anexos)) im.anexos = [];
        const jaTem = (u) => { const k = chaveDocCanonica(u) || u; return im.anexos.some(x => (chaveDocCanonica(x?.url) || x?.url) === k); };
        if (docsZuk.edital && !jaTem(docsZuk.edital)) { im.anexos.push({ nome: 'Edital de venda', url: docsZuk.edital, tipo: 'edital' }); edt++; }
        if (docsZuk.regras && !jaTem(docsZuk.regras)) im.anexos.push({ nome: 'Condições de venda', url: docsZuk.regras, tipo: 'regras' });
        if (docsZuk.regras && !im.link_regras_venda) im.link_regras_venda = docsZuk.regras;
      }
    } catch { /* best-effort */ }
    feitos++;
    if (feitos % 50 === 0) console.log(`    PortalZuk datas: ${feitos}/${imoveis.length} · ${ok} ok`);
  }
  try { await page.close(); } catch {}
  console.log(`    PortalZuk: datas preenchidas ${ok}/${imoveis.length} · editais PDF ${edt}`);
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
      const modalidade = (/judicial/i.test(c.title) && !/extra/i.test(c.title || '')) ? 'judicial' : 'extrajudicial';
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
      // Área ÚTIL (privativa) primeiro para o preço/m² não sair subestimado; cai para a
      // total quando não houver útil (ex.: terreno). Mesmo princípio do Zuk.
      const area = parseFloat(r.lot_useful_area || r.lot_total_area || 0) || 0;
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
        // Rota REAL do lote (recon 30/07): www.../imoveis/lote/{id} devolve 404 (Nuxt)
        // MESMO em lote ativo — a página viva é a do subdomínio de leilão (o padrão que o
        // captura-docs-sodre já usa). Sem isto, link_edital/url_lote nasciam mortos e a
        // captura de matrícula/edital regredia (63% vs base ≥82/85%).
        link_edital: r.auction_id
          ? `https://leilao.sodresantoro.com.br/leilao/${r.auction_id}/lote/${r.lot_id || r.id}/`
          : `https://www.sodresantoro.com.br/imoveis/lote/${r.lot_id || r.id}`,
        // Campo real de imagem = lot_pictures (confirmado no recon-sodre-searchlots).
        // Aceita array de strings ou de objetos; normaliza relativo → absoluto. A
        // foto também é backfillada por captura-docs-sodre.mjs (og:image do lote).
        link_foto: (() => {
          const pic = Array.isArray(r.lot_pictures) ? r.lot_pictures[0] : r.lot_pictures;
          const u = typeof pic === 'string' ? pic : (pic?.url || pic?.src || pic?.image || pic?.path || null);
          if (!u) return r.lot_image || r.image || null;
          return /^https?:\/\//.test(u) ? u : `https://www.sodresantoro.com.br${u.startsWith('/') ? '' : '/'}${u}`;
        })(),
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
  // Prefere a área PRIVATIVA/ÚTIL nomeada: a Sodré descreve "privativa de 244,99 m²,
  // comum 217,43 m², total 462,42 m²" e o 1º m² genérico podia pegar a comum/terreno
  // (recon 30/07: a API zerou lot_useful_area e a descrição virou a fonte da área).
  const ap = t.match(/(?:privativa|útil|util)\s*(?:de\s*)?[:\s]*([\d][\d.]*(?:,\d+)?)\s*m(?:²|2)(?![a-z0-9])/i);
  const am = ap || t.match(/([\d][\d.]*(?:,\d+)?)\s*m(?:²|2)(?![a-z0-9])/i);
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
        modalidade: (/judicial/i.test(c.titulo) && !/extra/i.test(c.titulo || '')) ? 'judicial' : 'extrajudicial',
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
// Normaliza nm_url_leiloeiro (o portal AGREGA centenas de leiloeiros oficiais) para uma
// URL https do SITE DE ORIGEM; devolve null quando não parece um domínio real (não vira
// destino do botão). É o alvo honesto do "Acessar leiloeiro".
function siteLeiloeiroLJUD(raw) {
  const s = String(raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!s || /\s/.test(s) || !/\.[a-z]{2,}/i.test(s)) return null;
  return `https://${s}`;
}
function mapLoteLJUD_pp(it) {
  const titulo = String(it.nm_titulo_lote || it.nm_titulo_leilao || '').replace(/\s+/g, ' ').trim();
  const cidade = String(it.nm_cidade || '').trim();
  const valMin = parseFloat(it.vl_lanceminimo || it.vl_ordenacao || 0) || 0;
  const foto = it.fotos?.[0]?.nm_path_completo ? it.fotos[0].nm_path_completo.replace('/196x146/', '/640x480/') : null;
  const loteId = it.lote_id || it.id;
  // O portal é AGREGADOR: cada lote vem de um leiloeiro oficial (nm_url_leiloeiro), e a página
  // /lote/{id} do agregador responde "Leilão não encontrado" para muitos lotes. Por isso o
  // destino era o SITE do leiloeiro — que resolvia o erro e criava outro: a HOME não mostra o
  // imóvel, e um dos domínios devolve literalmente "Leiloeiro não cadastrado!".
  //
  // RECON DE 28/08 (`scripts/recon-ljud-url.mjs`, rodado no Actions) testou as quatro formas
  // em 3 lotes abertos e a resposta foi limpa:
  //   /lote/{lote_id}            → 2 de 3 "Leilão não encontrado"
  //   /leilao/{leilao_id}        → 3 de 3 ABREM, e num deles o <title> é o próprio imóvel
  //                                ("Alto Parnaíba/MA - Fazenda São Bento c/ 16.040 hectares")
  //   /leilao/{id}/lote/{id}     → 500 nos 3
  //   domínio do leiloeiro       → home; num caso, "Leiloeiro não cadastrado!"
  // Então o destino passa a ser a PÁGINA DO LEILÃO no agregador, que é a que existe. O site do
  // leiloeiro vira o segundo degrau (quando o portal não informa `leilao_id`), e o /lote/ some
  // da escada: ele é o único que já sabemos que costuma falhar.
  //
  // url_lote é reescrito pelo scraper todo dia e o doc-scan (enriquecer-lote só grava
  // link_edital vazio) NUNCA o sobrescreve → a próxima coleta conserta os 1.358 lotes ativos.
  const siteLeiloeiro = siteLeiloeiroLJUD(it.nm_url_leiloeiro);
  const leilaoId = it.leilao_id;
  const loteUrlAgg = leilaoId ? `https://www.leiloesjudiciais.com.br/leilao/${leilaoId}` : null;
  const loteUrl = loteUrlAgg || siteLeiloeiro || 'https://www.leiloesjudiciais.com.br';
  // `anexos`: documentos REAIS do lote (edital, matrícula, laudo…) com URL S3 direta.
  const anexosArr = (Array.isArray(it.anexos) ? it.anexos : [])
    .filter(a => a && a.nm_path_completo)
    .map(a => ({ nome: String(a.nm || a.nm_path || 'Documento').slice(0, 120), url: String(a.nm_path_completo) }));
  const achaDoc = (re) => anexosArr.find(a => re.test(a.nome))?.url || null;
  const matricula = achaDoc(/matr[íi]cula/i);
  const editalDoc = achaDoc(/edital|regras|leil[ãa]o/i);
  return {
    fonte: 'LJUD', fonte_id: `ljud_${loteId}`,
    titulo: (titulo || `Imóvel ${loteId}`).slice(0, 180),
    tipo: normalizarTipo(it.nm_subcategoria || it.nm_categoria || titulo),
    modalidade: /extrajudicial/i.test(it.nm_titulo_leilao || it.nm_tipo_leilao || '') ? 'extrajudicial' : 'judicial',
    estado: String(it.nm_estado || '').toUpperCase().slice(0, 2), cidade: toTitleCase(cidade),
    bairro: '', endereco: '', valor_avaliacao: parseFloat(it.vl_avaliacao || 0) || 0, valor_minimo: valMin,
    area_m2: (() => { const m = (titulo.match(/([\d.,]+)\s*m²/) || [])[1]; return m ? parseBRL(m) : 0; })(),
    descricao: [titulo, it.nm_leiloeiro].filter(Boolean).join(' — ').slice(0, 500),
    // Documentos reais do lote (antes tudo apontava p/ a home do leiloeiro).
    link_edital: editalDoc || loteUrl,
    link_matricula: matricula,
    url_lote: loteUrl,
    anexos: anexosArr.length ? anexosArr : null,
    link_foto: foto, leiloeiro: String(it.nm_leiloeiro || 'Leilões Judiciais').slice(0, 120),
    data_leilao: parseDataLJUD(it.dt_fechamento), forma_pagamento: 'a_vista',
  };
}
// Coleta LJUD por um endpoint, fazendo o fetch DENTRO da página (TLS de Chrome).
async function scraperLJUD_navegador(browser, endpoint) {
  const LJUD_FOTO_MAX = Number(process.env.LJUD_FOTO_MAX || 60); // lotes/ run p/ backfill de foto
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
    // RECON (LJUD_DEBUG=1): dumpa a estrutura do 1º bem p/ achar a URL do LOTE no
    // portal (hoje só guardamos nm_url_leiloeiro = home do leiloeiro, sem lote/matrícula).
    if (process.env.LJUD_DEBUG === '1') {
      const real = [...bens.values()].find(b => Number(b.statuslote_id) === 1 && !/simula|teste/i.test(String(b.nm_titulo_lote || b.nm_titulo_leilao || '')));
      const b = real || bens.values().next().value;
      if (b) {
        console.log('    LJUD DEBUG titulo:', b.nm_titulo_lote, '| lote_id', b.lote_id, '| leilao_id', b.leilao_id, '| url_leiloeiro', b.nm_url_leiloeiro);
        console.log('    LJUD DEBUG parcelas: nu_parcelas=', b.nu_parcelas, 'vl_percentualentrada=', b.vl_percentualentrada);
        console.log('    LJUD DEBUG anexos:', JSON.stringify(b.anexos).slice(0, 1400));
      }
    }
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
  // BACKFILL DE FOTO (og:image) — APRENDIZADO 2026-07-18: o get-lotes devolve fotos:[]
  // p/ ~38% dos lotes (foto só na PÁGINA do lote). Visitamos os SEM foto (todos têm
  // url_lote) e lemos og:image (path S3 fotos/imoveis) — mesma tática comprovada do
  // SODRE. Bounded por run (LJUD_FOTO_MAX): ao longo dos scrapes diários cobre a cauda;
  // fonte_saude.foto_pct do LJUD confirma o ganho. Best-effort: nunca bloqueia o lote.
  const semFoto = imoveis.filter(i => !i.link_foto).slice(0, LJUD_FOTO_MAX);
  let fotoOk = 0;
  for (const im of semFoto) {
    let p2;
    // A foto (path S3 fotos/imoveis) está na PÁGINA DO LOTE do agregador, não no site do
    // leiloeiro. Como url_lote agora aponta p/ o leiloeiro real, reconstruímos a URL do lote
    // no agregador a partir do fonte_id (ljud_{lote_id}) só p/ este backfill best-effort.
    const loteId = String(im.fonte_id || '').replace(/^ljud_/, '');
    if (!loteId) continue;
    const aggUrl = `https://www.leiloesjudiciais.com.br/lote/${loteId}`;
    try {
      p2 = await browser.newPage();
      await p2.setUserAgent(USER_AGENT);
      await p2.goto(aggUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      const og = await p2.evaluate(() => {
        const meta = document.querySelector('meta[property="og:image"]')?.getAttribute('content');
        if (meta) return meta;
        const hit = document.documentElement.innerHTML.match(/https?:\/\/[^"'\s)]*fotos\/imoveis\/[^"'\s)]+/);
        return hit ? hit[0] : null;
      });
      // Só aceita a foto REAL do imóvel (path S3 fotos/imoveis) — rejeita logo/og genérico.
      if (og && /^https?:\/\/\S+fotos\/imoveis\//.test(og)) { im.link_foto = og.replace('/196x146/', '/640x480/'); fotoOk++; }
    } catch { /* segue: foto é best-effort */ }
    finally { try { if (p2) await p2.close(); } catch {} }
    await new Promise(r => setTimeout(r, 150));
  }
  if (semFoto.length) console.log(`    LJUD: foto backfill ${fotoOk}/${semFoto.length} via og:image`);
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

// Cidade/UF: primeiro dos campos do bem; senão extrai do texto. O Pestana usa
// tanto "Cidade/UF" (barra) quanto "… - Cidade - UF" (traço, UF no fim).
function cidadeUfPestana(bem, desc) {
  let cidade = String((bem && bem.cidade && bem.cidade.name) || '').trim();
  let uf = String((bem && bem.estado && bem.estado.name) || '').trim().toUpperCase().slice(0, 2);
  const temUf = () => /^[A-Z]{2}$/.test(uf);
  if (!cidade || !temUf()) {
    const t = String(desc || '').trim();
    let m = t.match(/([A-Za-zÀ-ÿ'.\- ]{2,40})\/([A-Z]{2})\b/); // "Cidade/UF"
    if (m) { cidade = cidade || m[1].trim(); if (!temUf()) uf = m[2]; }
    else {
      const parts = t.split(/\s+-\s+/); // "Tipo - Cidade - UF"
      const last = String(parts[parts.length - 1] || '').trim();
      if (/^[A-Z]{2}$/.test(last)) {
        if (!temUf()) uf = last;
        const c = String(parts[parts.length - 2] || '').trim().replace(/\s+e\s+.*/i, ''); // "A e B" → A
        if (!cidade && c) cidade = c;
      }
    }
  }
  return { cidade, uf: temUf() ? uf : '' };
}

function mapLotePestana(lote, leilao, leiloesPorId) {
  const bens = Array.isArray(lote.bens) ? lote.bens : [];
  const bem = bens.find(b => b && b.tipoBem && Number(b.tipoBem.id) === PESTANA_TIPOBEM_IMOVEL);
  if (!bem) return null; // não é imóvel (veículo/outros)
  // O LEILÃO DONO é `lote.leilao`, NÃO o leilão cuja LISTA trouxe o lote. A Pestana tem leilões
  // AGREGADORES (venda direta) que listam lotes de OUTROS leilões: o lote de Barueri/SP aparecia
  // na lista do #5872 "Venda Direta - Eldorado/RS" (data 26/10) mas pertence ao #6154 "Leilão de
  // Imóveis Santander" (data 25/08 11h — o pregão real). Usar o leilão da iteração dava a MESMA
  // data errada aos 1.031 lotes (e nome/UF/modalidade do agregador). Resolvido pelo dono; se o
  // dono não estiver no mapa, cai no leilão da lista (comportamento antigo, seguro).
  if (leiloesPorId && lote && lote.leilao != null) {
    const dono = leiloesPorId.get(Number(lote.leilao));
    if (dono) leilao = dono;
  }
  const valor = Number(lote.lanceMinimo || lote.valorInicial || lote.valorFiltro || 0) || 0;
  const desc = String(lote.descricao || bem.descricao || '').replace(/\s+/g, ' ').trim();
  const { cidade, uf } = cidadeUfPestana(bem, desc);
  // Área a partir das características ("893,46m²").
  let area = 0;
  for (const c of (bem.caracteristicas || [])) {
    const mm = String((c && c.valor) || '').match(/([\d.,]+)\s*m²/);
    if (mm) { area = parseBRL(mm[1]); break; }
  }
  // Foto: campo `media` do bem (imagemPrincipal ou 1ª de imagens) → GED redimensionado.
  // Terrenos costumam não ter foto (imagens vazio) — fica null, sem inventar.
  const imgs = Array.isArray(bem.imagens) ? bem.imagens : [];
  const capaMedia = (bem.imagemPrincipal && bem.imagemPrincipal.media)
    || ((imgs.find(i => i && i.destaque) || imgs[0] || {}).media)
    || null;
  const foto = capaMedia ? `${PESTANA_GED}${encodeURIComponent(capaMedia)}?ims=fit-in/640x0` : null;
  // MODALIDADE: `bem.origem` é a fonte preferida, mas vem VAZIA em boa parte do acervo da
  // PESTANA — e o fallback era 'extrajudicial', um palpite AFIRMATIVO sobre a natureza
  // jurídica do lote. Medido em 17/08: **1.021 lotes ativos** marcados extrajudicial cuja
  // descrição diz, com todas as letras, "Alienação Judicial Por Venda Direta". O dado estava
  // ali o tempo todo, em `leilao.nome`; o mapper só não olhava para lá.
  //
  // Não é rótulo cosmético: modalidade decide o risco jurídico que o cliente lê, a nota de
  // Perfil do BidScore e o texto do parecer. Dizer "extrajudicial" para uma alienação
  // JUDICIAL é afirmar ausência de processo onde há um.
  //
  // Ordem importa: 'extrajudicial' CONTÉM 'judicial'. O teste de extra vem primeiro, e o de
  // judicial usa limite de palavra — as duas defesas, porque foi exatamente essa colisão por
  // substring que errou a nota de Perfil de 9.589 lotes em src/utils/score.js.
  const origem = String(bem.origem || '').toLowerCase();
  const textoModal = `${origem} ${String(leilao.nome || '').toLowerCase()} ${desc.toLowerCase()}`;
  const modalidade = /extrajudicial/.test(textoModal) ? 'extrajudicial'
    : /\bjudicial\b/.test(textoModal) ? 'judicial'
    : 'extrajudicial';
  // DOCUMENTOS. O edital é do LEILÃO (um por leilão). Matrícula/laudo, quando
  // existem, são do LOTE/BEM (por-imóvel): NUNCA usar um doc de leilão como
  // matrícula, senão o mesmo arquivo grudaria em todos os lotes. Varremos os
  // arrays disponíveis (nomes de campo variam), classificamos por palavra-chave e
  // montamos os anexos para as IAs lerem e gerarem os relatórios.
  const linkDoc = (d) => (d && (d.link || d.url || d.arquivo || d.media || d.caminho)) || null;
  const classDoc = (nome) => {
    const t = String(nome || '');
    if (/matr[ií]cul/i.test(t)) return 'matricula';
    if (/edital/i.test(t)) return 'edital';
    if (/laudo|avalia[çc][ãa]o/i.test(t)) return 'laudo';
    if (/proposta/i.test(t)) return 'proposta';
    if (/regras|condi[cç][oõ]es/i.test(t)) return 'regras';
    return 'anexo';
  };
  const mkDocs = (arr) => (Array.isArray(arr) ? arr : [])
    .map(d => ({ nome: String((d && (d.nome || d.descricao)) || 'Documento').slice(0, 90), url: linkDoc(d), tipo: classDoc(d && (d.nome || d.descricao)) }))
    .filter(d => d.url);
  const docsLote = [...mkDocs(lote.documentos), ...mkDocs(bem.documentos), ...mkDocs(bem.anexos)]; // por-lote
  const docsLeilao = mkDocs(leilao.documentos); // por-leilão (edital)
  const anexos = [...docsLote, ...docsLeilao].filter((d, i, a) => a.findIndex(x => x.url === d.url) === i).slice(0, 25);
  const primeiroDoc = (tipo, lista) => (lista.find(d => d.tipo === tipo) || {}).url || null;
  const editalUrl = primeiroDoc('edital', anexos);
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
    link_edital: editalUrl || agenda,
    link_matricula: primeiroDoc('matricula', docsLote) || null, // só por-lote (nunca do leilão)
    link_regras_venda: primeiroDoc('regras', anexos) || null,
    anexos,
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

    // 1) Todos os leilões. COM RETENTATIVA (12/08): esta chamada é o gargalo de TODA a fonte —
    // se ela falhar uma vez, o scraper devolve [] e um acervo de ~1.000 lotes vira `total 0`,
    // `status falhou` e "REGRESSÃO: caiu de 1014 para 0" no monitor. Foi exatamente o que
    // aconteceu às 12:13 de 12/08: às 13:08, sem tocar em nada, voltou a 992. Uma falha
    // transitória de rede não pode se apresentar como leiloeiro quebrado.
    let leiloes = null;
    for (let tentativa = 1; tentativa <= 3 && !Array.isArray(leiloes); tentativa++) {
      if (tentativa > 1) await new Promise(r => setTimeout(r, 3000 * tentativa));
      leiloes = await page.evaluate(async () => {
        try { const r = await fetch('/api/v2/leilao', { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
        catch (e) { return null; }
      }).catch(() => null);
      if (!Array.isArray(leiloes)) console.log(`    Pestana: /api/v2/leilao sem lista (tentativa ${tentativa}/3)`);
    }
    if (!Array.isArray(leiloes)) { console.log('    Pestana: /api/v2/leilao não retornou lista após 3 tentativas'); return []; }

    // 2) Só leilões que contêm IMÓVEIS (subTipoBens com tipoBem 462).
    const imovLeiloes = leiloes.filter(l => Array.isArray(l.subTipoBens) && l.subTipoBens.some(s => Number(s.tipoBem) === PESTANA_TIPOBEM_IMOVEL));
    console.log(`    Pestana: ${imovLeiloes.length}/${leiloes.length} leilões com imóveis`);
    // Mapa de TODOS os leilões (não só os com imóveis) por id — para o mapper resolver o
    // `lote.leilao` (o leilão DONO real) em vez de usar o leilão-agregador da lista.
    const leiloesPorId = new Map(leiloes.filter(l => l && l.id != null).map(l => [Number(l.id), l]));

    // 3) Lotes por leilão (fetch same-origin dentro da página).
    for (const leilao of imovLeiloes) {
      const lotes = await page.evaluate(async (id) => {
        try { const r = await fetch(`/api/v2/lote?leilao=${id}&page=1&qtd=300`, { headers: { Accept: 'application/json' } }); return r.ok ? await r.json() : null; }
        catch (e) { return null; }
      }, leilao.id).catch(() => null);
      if (!Array.isArray(lotes)) continue;
      for (const lote of lotes) {
        if (lote && lote.situacaoId != null && Number(lote.situacaoId) !== 1) continue; // só Disponível
        const row = mapLotePestana(lote, leilao, leiloesPorId);
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

// ─── BIASI LEILÕES ────────────────────────────────────────────────────────────
// Server-rendered ASP.NET, SEM API JSON (todos os GetLotes dão 404).
// Estrutura do card (a mesma em toda listagem do site):
//   a.leilao-lote[data-id] href=/sale/detail?id=X · .card-title="Lote em … - Cidade/UF"
//   · .card-img-cover bg=cdn-biasi.blueintra.com/images/lot/… · "R$ …" (Valor Inicial)
// ESTRATÉGIA (2 camadas, após a regressão 369→173→26 de 07/2026):
//   1) PREFERIDA — listagem de imóveis paginada por URL (?pagina=N): determinística, sem
//      depender da vitrine ROTATIVA da home nem do clique-AJAX (os dois pontos frágeis que
//      regrediram). Reusa o MESMO card → qualidade idêntica; se a página não tiver o card,
//      volta VAZIA e caímos na camada 2 (nunca grava lote de baixa qualidade — safe-by-constr.).
//   2) FALLBACK — home (/leilao/{id}/…) → páginas do leilão por clique. Dedup POR LEILÃO
//      (a versão anterior usava um Set GLOBAL: um leilão travado abortava os demais) + nº de
//      páginas derivado de `total`/`limit`.
const BIASI_BASE = 'https://www.biasileiloes.com.br';

function mapLoteBiasi(l) {
  const title = String(l.title || '').replace(/\s+/g, ' ').trim();
  let cidade = '', uf = '';
  const m = title.match(/([A-Za-zÀ-ÿ'.\- ]{2,40})\/([A-Z]{2})\b/); // "… - Cidade/UF"
  if (m) { cidade = m[1].trim(); uf = m[2]; }
  const valor = parseBRL(l.price || '');
  const foto = l.img && /^https?:\/\//.test(l.img) ? l.img : null;
  const detalhe = `${BIASI_BASE}/sale/detail?id=${l.id}`;
  return {
    fonte: 'BIASI',
    fonte_id: `biasi_${l.id}`,
    titulo: (title || `Lote ${l.id}`).slice(0, 180),
    tipo: normalizarTipo(title),
    modalidade: 'extrajudicial',
    estado: /^[A-Z]{2}$/.test(uf) ? uf : '',
    cidade: cidade ? toTitleCase(cidade) : '',
    bairro: '',
    endereco: '',
    valor_avaliacao: 0,
    valor_minimo: valor,
    area_m2: 0,
    descricao: title.slice(0, 500),
    link_edital: detalhe,
    url_lote: detalhe,
    link_foto: foto,
    leiloeiro: 'Biasi Leilões',
    data_leilao: null,
    forma_pagamento: 'a_vista',
  };
}

// Extrai os cards de lote do DOM da página atual (leilão OU listagem agregada — o card
// `a.leilao-lote` é o mesmo em ambas; sem exigir o container #leilao-lista-lote, a mesma
// função serve as duas estratégias mantendo a MESMA qualidade de parse).
function biasiParsePagina(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('a.leilao-lote[data-id]').forEach((a) => {
      const id = a.getAttribute('data-id');
      if (!id) return;
      const title = (a.querySelector('.card-title')?.textContent || '').replace(/\s+/g, ' ').trim();
      const pm = (a.textContent || '').match(/R\$\s*([\d.]+,\d{2})/);
      const cover = a.querySelector('.card-img-cover');
      const bg = cover ? (cover.getAttribute('style') || '') : '';
      const img = (bg.match(/url\(([^)'"]+)/) || [])[1] || null;
      out.push({ id, title, price: pm ? pm[1] : null, img });
    });
    return out;
  }).catch(() => []);
}

async function scraperBiasi(browser) {
  console.log('  Biasi Leilões — listagem agregada (?pagina) + fallback home→leilões...');
  const page = await browser.newPage();
  const bens = new Map();
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

    // ── ESTRATÉGIA 1: listagem agregada /lotes/imoveis/pesquisa, paginada por CLIQUE ──
    // Recon 30/07 (Round 34, debug_fetch ofv34-biasi-*): o site IGNORA `?pagina=` (a
    // listagem pagina por clique AJAX em .nav-paging) e /lotes/imoveis é rota MORTA
    // (404 ASP.NET) — o loop antigo por URL colhia no máximo a página 1 (48 lotes) e a
    // fonte vivia do fallback rotativo da home (por isso a oscilação 26→96→206). Agora:
    // carrega a pesquisa 1x, lê total/limit de #leilao-lista-lote (206/48 no recon) e
    // pagina por clique — o MESMO mecanismo já validado no fallback abaixo.
    try {
      await page.goto(`${BIASI_BASE}/lotes/imoveis/pesquisa`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 1800));
      const meta = await page.evaluate(() => {
        const el = document.getElementById('leilao-lista-lote');
        return { total: Number((el && el.getAttribute('total')) || 0), limit: Number((el && el.getAttribute('limit')) || 48) };
      }).catch(() => ({ total: 0, limit: 48 }));
      const paginas = meta.total > 0 ? Math.min(40, Math.ceil(meta.total / (meta.limit || 48))) : 1;
      let ultimoPrimeiro = null, semAvanco = 0;
      for (let p = 1; p <= paginas; p++) {
        if (p > 1) {
          const clicked = await page.evaluate((idx) => {
            const byIdx = document.querySelector(`.nav-paging a[index="${idx}"]`);
            const next = byIdx || document.querySelector('.nav-paging a[rel="next"], .nav-paging a.next, .nav-paging li.next a');
            if (next) { next.click(); return true; }
            return false;
          }, p).catch(() => false);
          if (!clicked) break;
          await new Promise(r => setTimeout(r, 2500)); // espera o AJAX re-renderizar
        }
        const lotes = await biasiParsePagina(page);
        const primeiro = lotes[0]?.id || null;
        if (!lotes.length || (primeiro && primeiro === ultimoPrimeiro)) { if (++semAvanco >= 2) break; else continue; }
        semAvanco = 0; ultimoPrimeiro = primeiro;
        for (const l of lotes) { if (l.id && !bens.has(l.id)) bens.set(l.id, l); }
      }
    } catch (e) { console.log(`    Biasi listagem agregada: ${String(e.message).slice(0, 60)}`); }
    console.log(`    Biasi: ${bens.size} lotes via listagem agregada`);

    // ── ESTRATÉGIA 2 (fallback): home → leilões → páginas por clique ────────────────
    // Só se a agregada veio fraca. Dedup POR LEILÃO (corrige o abort global da versão
    // anterior) e nº de páginas por `total`/`limit`; para quando a página não avança.
    if (bens.size < 60) {
      let auctions = [];
      try {
        await page.goto(`${BIASI_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2500));
        auctions = await page.evaluate(() => {
          const map = new Map();
          document.querySelectorAll('a[href*="/leilao/"]').forEach((a) => {
            const h = a.getAttribute('href') || '';
            const mm = h.match(/\/leilao\/(\d+)\//);
            if (mm) map.set(mm[1], h.startsWith('http') ? h : `https://www.biasileiloes.com.br${h}`);
          });
          return [...map.values()];
        });
      } catch (e) { console.log(`    Biasi home: ${String(e.message).slice(0, 50)}`); }
      console.log(`    Biasi (fallback): ${auctions.length} leilões na home`);

      for (const url of auctions) {
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
          await new Promise(r => setTimeout(r, 1500));
          const meta = await page.evaluate(() => {
            const el = document.getElementById('leilao-lista-lote');
            return { total: Number((el && el.getAttribute('total')) || 0), limit: Number((el && el.getAttribute('limit')) || 48) };
          }).catch(() => ({ total: 0, limit: 48 }));
          const paginas = meta.total > 0 ? Math.min(25, Math.ceil(meta.total / (meta.limit || 48))) : 25;
          const seen = new Set();               // dedup POR LEILÃO (não global)
          let ultimoPrimeiro = null, semAvanco = 0;
          for (let p = 1; p <= paginas; p++) {
            if (p > 1) {
              const clicked = await page.evaluate((idx) => {
                const byIdx = document.querySelector(`.nav-paging a[index="${idx}"]`);
                const next = byIdx || document.querySelector('.nav-paging a[rel="next"], .nav-paging a.next, .nav-paging li.next a');
                if (next) { next.click(); return true; }
                return false;
              }, p).catch(() => false);
              if (!clicked) break;
              await new Promise(r => setTimeout(r, 2500)); // espera o AJAX re-renderizar
            }
            const lotes = await biasiParsePagina(page);
            const primeiro = lotes[0]?.id || null;
            // "não avançou" = página vazia OU o 1º lote repetiu (clique não paginou de fato).
            if (!lotes.length || (primeiro && primeiro === ultimoPrimeiro)) { if (++semAvanco >= 2) break; else continue; }
            semAvanco = 0; ultimoPrimeiro = primeiro;
            for (const l of lotes) { if (l.id && !seen.has(l.id)) { seen.add(l.id); bens.set(l.id, l); } }
          }
        } catch { /* leilão a leilão; nunca derruba o scrape */ }
        await new Promise(r => setTimeout(r, 150));
      }
    }
  } finally { await page.close().catch(() => {}); }

  const imoveis = [];
  for (const l of bens.values()) {
    const row = mapLoteBiasi(l);
    if (row && row.valor_minimo) imoveis.push(row);
  }
  console.log(`    Biasi: ${imoveis.length} imóveis mapeados (${bens.size} lotes colhidos)`);
  return imoveis;
}

// ─── WEBLEILÕES (webleiloes.com.br) ───────────────────────────────────────────
// Server-rendered. Listagens: /imoveis, /busca?categoria=imoveis, /leiloes (mix).
// Cada lote é um link /oferta/{leilao|venda-direta}/imoveis/{categoria}/{n}/id-{id}/{slug}.
// Extração robusta: a partir de cada link de lote, sobe ao card e lê texto/foto; o
// tipo/cidade/UF saem do texto e da URL. edital/matrícula na página de detalhe →
// enriquecerDocumentosLote vasculha.
const WEBLEILOES_BASE = 'https://www.webleiloes.com.br';

// Cidade/UF de "Cidade, UF" ou "Cidade/UF" — pega o ÚLTIMO par (o alt termina em
// "…, Cidade/UF") e ignora ruído antes. Retorna {cidade, uf} ou vazio.
function cidadeUfWL(txt) {
  const s = String(txt || '');
  let cidade = '', uf = '';
  const re = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]{1,38}?)\s*[,/]\s*([A-Z]{2})\b/g;
  let m, ult = null;
  while ((m = re.exec(s))) ult = m;
  if (ult) { cidade = ult[1].replace(/\s+/g, ' ').trim(); uf = ult[2]; }
  return { cidade, uf };
}

function mapLoteWebLeiloes(l) {
  const url = String(l.href || '').startsWith('http') ? l.href : `${WEBLEILOES_BASE}${l.href}`;
  // Preço: 1º R$ do texto COMPLETO do card (robusto p/ leilão "R$ X" e venda-direta
  // "Data Única R$ X"; o .r1 strong às vezes traz o título, não o valor).
  const pm = String(l.texto || '').match(/R\$\s*([\d.]+,\d{2})/);
  const valor = pm ? parseBRL(pm[1]) : 0;
  // Desconto vs avaliação: o card MOSTRA o percentual ("50% Lance mínimo"). Captura do
  // .r1 small (fallback no texto). Deriva a avaliação p/ o desconto ficar consistente.
  const dm = String(l.descPct || l.texto || '').match(/(\d{1,3})\s*%/);
  const desc = dm ? Math.min(99, Math.max(0, Number(dm[1]))) : 0;
  const avaliacao = (desc > 0 && desc < 100 && valor > 0) ? Math.round(valor / (1 - desc / 100)) : 0;
  // Cidade/UF: prioriza a <li> de localização; fallback no alt e no slug da URL.
  let { cidade, uf } = cidadeUfWL(l.local);
  if (!uf) ({ cidade, uf } = cidadeUfWL(l.alt));
  if (!uf) { const ms = url.match(/-([a-z\- ]+)-([a-z]{2})(?:$|[/?#])/i); if (ms) { cidade = toTitleCase(ms[1].replace(/-/g, ' ')); uf = ms[2].toUpperCase(); } }
  const catUrl = String(l.categoria || '').replace(/-/g, ' ');
  const tipo = normalizarTipo(`${catUrl} ${l.alt || ''}`);
  const modalidade = /venda-direta/.test(String(l.href)) ? 'venda_direta'
    : (/\bextrajudicial\b/i.test(l.texto || '') ? 'extrajudicial'
    : (/\bjudicial\b/i.test(l.texto || '') ? 'judicial' : 'extrajudicial'));
  const foto = l.img && /^https?:\/\//.test(l.img) ? l.img : null;
  const am = String(l.alt || '').match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*m²/);
  const area = am ? parseFloat(am[1].replace('.', '').replace(',', '.')) : 0;
  const titulo = (String(l.alt || '').replace(/\s+/g, ' ').trim() || `${toTitleCase(catUrl)}${cidade ? ' em ' + cidade : ''}`).slice(0, 180);
  return {
    fonte: 'WEBLEILOES', fonte_id: `webleiloes_${l.id}`,
    titulo, tipo, modalidade,
    estado: /^[A-Z]{2}$/.test(uf) ? uf : '',
    cidade: cidade ? toTitleCase(cidade) : '',
    bairro: '', endereco: '',
    // avaliação derivada do % do card → salvarImoveis calcula desconto_percentual consistente.
    valor_avaliacao: avaliacao, valor_minimo: valor, area_m2: area || 0,
    descricao: String(l.alt || l.texto || '').slice(0, 500),
    link_edital: url, url_lote: url, link_foto: foto,
    leiloeiro: 'WebLeilões', data_leilao: null, forma_pagamento: 'a_vista',
  };
}

async function scraperWebLeiloes(browser) {
  console.log('  WebLeilões — server-rendered (imóveis + leilões)...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const bens = new Map();
  try {
    for (const path of ['/imoveis', '/busca?categoria=imoveis', '/leiloes']) {
      try {
        await page.goto(`${WEBLEILOES_BASE}${path}`, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 2500));
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
        await new Promise(r => setTimeout(r, 1500));
        const lotes = await page.evaluate(() => {
          const out = []; const vistos = new Set();
          const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();
          document.querySelectorAll('a[href*="/oferta/"][href*="/imoveis/"]').forEach((a) => {
            const href = a.getAttribute('href') || '';
            const mid = href.match(/id-(\d+)/); const id = mid ? mid[1] : null;
            if (!id || vistos.has(id)) return; vistos.add(id);
            const mcat = href.match(/\/oferta\/(?:leilao|venda-direta)\/imoveis\/([^/]+)\//);
            const card = a.closest('article') || a.closest('li, [class*="card"]') || a.parentElement;
            const q = (sel) => card ? clean(card.querySelector(sel)?.textContent) : '';
            const imgEl = card ? card.querySelector('img') : null;
            out.push({
              href, id, categoria: mcat ? mcat[1] : '',
              descPct: q('.r1 small'),                                         // "50%" (desconto vs avaliação)
              local: q('.cont-infos ul li') || q('ul li'),                    // "Cidade, UF"
              alt: imgEl ? (imgEl.getAttribute('alt') || '') : '',            // "Tipo NNm²- Bairro, Cidade/UF"
              img: imgEl ? (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '') : '',
              texto: card ? clean(card.textContent).slice(0, 400) : '',       // contém "R$ ..." (lance) e "NN%"
            });
          });
          return out;
        }).catch(() => []);
        for (const l of lotes) if (l.id && !bens.has(l.id)) bens.set(l.id, l);
        console.log(`    WebLeilões ${path}: +${lotes.length} (total ${bens.size})`);
      } catch (e) { console.log(`    WebLeilões ${path}: ${String(e.message).slice(0, 60)}`); }
    }
  } finally { await page.close(); }
  const imoveis = [...bens.values()].map(mapLoteWebLeiloes).filter(im => im.valor_minimo > 0 || (im.cidade && im.estado));
  console.log(`  ✅ WebLeilões: ${imoveis.length} imóveis`);
  return imoveis;
}

// ─── LEILÃO VIP (VIP Leilões) ─────────────────────────────────────────────────
// Server-rendered (.NET). Modelo em 2 níveis, confirmado por captura real:
//   /agenda?segmento=Imóveis   → cards .card-evento com links /evento/detalhes/{id}
//   /evento/lotes/{id}         → TODOS os anúncios (imóveis) do evento numa página
//                                (cards .card-anuncio server-rendered).
// Cada .card-anuncio: link /evento/anuncio/{slug}-{id}, foto (blob Azure direto),
// .anc-local "Cidade - UF", .anc-type, .anc-title h1 (com área), .valor-atual (R$).
const VIP_BASE = 'https://www.leilaovip.com.br';

function mapAnuncioVIP(a) {
  const titulo = String(a.titulo || '').replace(/\s+/g, ' ').trim();
  const local = String(a.local || '').replace(/local:?/i, '').replace(/\s+/g, ' ').trim();
  const lm = local.match(/^(.*?)\s*[-–]\s*([A-Za-z]{2})\s*$/);
  const cidade = lm ? lm[1].trim() : local;
  const uf = lm ? lm[2].toUpperCase() : '';
  const ext = extrairDaDescricao(titulo);
  const detalhe = a.href ? (a.href.startsWith('http') ? a.href : `${VIP_BASE}${a.href}`) : `${VIP_BASE}/agenda`;
  return {
    fonte: 'VIP',
    fonte_id: `vip_${a.id}`,
    titulo: (titulo || `Imóvel Leilão VIP ${a.id}`).slice(0, 180),
    tipo: normalizarTipo(a.tipo || titulo),
    modalidade: 'extrajudicial',
    estado: /^[A-Z]{2}$/.test(uf) ? uf : '',
    cidade: cidade ? toTitleCase(cidade) : '',
    bairro: '',
    endereco: '',
    valor_avaliacao: 0,
    valor_minimo: parseBRL(a.valor || ''),
    area_m2: ext.area_m2 || 0,
    ocupacao: ext.ocupacao || null,
    descricao: titulo.slice(0, 500),
    link_edital: detalhe,
    url_lote: detalhe,
    link_foto: a.foto && /^https?:\/\//.test(a.foto) ? a.foto : null,
    leiloeiro: 'Leilão VIP',
    data_leilao: dataVIP(a.data),
    forma_pagamento: 'a_vista',
  };
}

/**
 * dd/mm/aaaa → aaaa-mm-dd, e SÓ isso. Sem `new Date(texto)`: em `03/09/2026` o parser do
 * JavaScript entende mês 03, dia 09 — a data sairia trocada em 11 de cada 12 casos e
 * PLAUSÍVEL em todos, que é a pior combinação possível (forma nº 10 do CLAUDE.md).
 * Fora do formato → null: melhor sem data que com data errada, porque data errada expira lote
 * vivo e mantém vivo lote encerrado.
 */
function dataVIP(txt) {
  const m = String(txt || '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!m) return null;
  const [, d, mes, ano] = m;
  const dd = Number(d), mm = Number(mes), aa = Number(ano);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  // Janela de plausibilidade: praça de 2 anos atrás ou de 3 anos à frente é erro de leitura,
  // não calendário de leilão.
  const agora = new Date().getFullYear();
  if (aa < agora - 2 || aa > agora + 3) return null;
  return `${ano}-${mes}-${d}`;
}

async function scraperVIP(browser) {
  console.log('  Leilão VIP — server-rendered (agenda → eventos → /evento/lotes)...');
  const page = await browser.newPage();
  const bens = new Map();
  const DEADLINE = Date.now() + 7 * 60 * 1000;
  try {
    await page.setUserAgent(USER_AGENT);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

    // 1) Eventos de imóveis na agenda (server-rendered): /evento/detalhes/{id}
    let eventos = [];
    try {
      await page.goto(`${VIP_BASE}/agenda?segmento=Im%C3%B3veis`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await new Promise(r => setTimeout(r, 2500));
      eventos = await page.evaluate(() => {
        const set = new Set();
        document.querySelectorAll('a[href*="/evento/detalhes/"]').forEach((a) => {
          const mm = (a.getAttribute('href') || '').match(/\/evento\/detalhes\/([^/?#]+)/);
          if (mm) set.add(mm[1]);
        });
        return [...set];
      });
    } catch (e) { console.log(`    VIP agenda: ${String(e.message).slice(0, 50)}`); }
    console.log(`    VIP: ${eventos.length} eventos de imóveis na agenda`);

    // 2) Cada evento: abre /evento/detalhes/{id} e ROLA para o JS renderizar os
    //    cards (Cloudflare Rocket Loader monta os anúncios no cliente — buscar o
    //    HTML cru só traz os ~8 primeiros já prontos). Parseia o DOM VIVO, onde o
    //    JS já preencheu link/título/valor/foto de todos os lotes carregados.
    for (const ev of eventos.slice(0, 80)) {
      if (Date.now() > DEADLINE) { console.log('    VIP: teto de tempo atingido'); break; }
      try {
        await page.goto(`${VIP_BASE}/evento/detalhes/${encodeURIComponent(ev)}`, { waitUntil: 'networkidle2', timeout: 45000 });
        await new Promise(r => setTimeout(r, 1500));
        // Scroll infinito: carrega os lotes restantes. Para quando estabiliza.
        let estavel = 0, prev = -1;
        for (let s = 0; s < 20 && estavel < 3; s++) {
          const n = await page.evaluate(() => document.querySelectorAll('.card-anuncio').length).catch(() => 0);
          estavel = n > prev ? 0 : estavel + 1;
          prev = n;
          try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch { /* */ }
          await new Promise(r => setTimeout(r, 900));
        }
        const anuncios = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('.card-anuncio').forEach((c) => {
            const a = c.querySelector('a[href*="/evento/anuncio/"]');
            const href = a ? (a.getAttribute('href') || '') : '';
            const mm = href.match(/-(\d+)(?:[/?#].*)?$/);
            const aid = mm ? mm[1] : '';
            if (!aid) return;
            const img = c.querySelector('img.card-img-top, img');
            out.push({
              id: aid, href,
              titulo: (c.querySelector('.anc-title h1, .anc-title')?.textContent || (img && img.getAttribute('alt')) || '').trim(),
              local: (c.querySelector('.anc-local')?.textContent || '').trim(),
              tipo: (c.querySelector('.anc-type')?.textContent || '').trim(),
              valor: (c.querySelector('.valor-atual')?.textContent || '').trim(),
              // DATA E HORA DO PREGÃO (29/08). O mapeador escrevia `data_leilao: null` fixo —
              // nunca procurou —, e por isso os 93 lotes ativos do VIP nunca expiravam por prazo
              // e o gate de leilão encerrado falhava aberto neles. O recon de 29/08 mostrou a
              // marcação: `<div class="anc-row-4"><span class="anc-date">03/09/2026</span>
              // <span class="anc-hour">14:30</span></div>`. Lote de VENDA DIRETA não tem o
              // bloco — e é correto que não tenha: lá a venda é contínua, sem praça.
              data: (c.querySelector('.anc-date')?.textContent || '').trim(),
              hora: (c.querySelector('.anc-hour')?.textContent || '').trim(),
              rotulo: (c.querySelector('.anc-left-txt')?.textContent || '').replace(/\s+/g, ' ').trim(),
              foto: img ? (img.getAttribute('src') || '') : '',
            });
          });
          return out;
        }).catch(() => []);
        for (const an of anuncios) { if (an.id && !bens.has(an.id)) bens.set(an.id, an); }
      } catch { /* evento a evento; nunca derruba o scrape */ }
      await new Promise(r => setTimeout(r, 120));
    }
  } finally { await page.close().catch(() => {}); }

  const seen = new Set();
  const imoveis = [];
  for (const a of bens.values()) {
    const row = mapAnuncioVIP(a);
    if (!row.valor_minimo || seen.has(row.fonte_id)) continue;
    seen.add(row.fonte_id);
    imoveis.push(row);
  }
  console.log(`    VIP: ${imoveis.length} imóveis mapeados (${bens.size} anúncios colhidos)`);
  return imoveis;
}

// ─── LEILOTECH (plataforma white-label GraphQL — vários leiloeiros) ───────────
// Leilotech é o "sistema operacional" de ~20 leiloeiros. Cada tenant é uma SPA V2
// que consulta {dominio}/go/graphql. A query HomeBootstrap devolve leiloesHome
// (leilões abertos, paginados) com primaryLote (imóvel: título, avaliação, lance,
// coverImageUrl, location{city,uf}). A API fica atrás de Cloudflare com desafio de
// bot: POST manual é barrado, mas as chamadas da PRÓPRIA SPA passam — então
// INTERCEPTAMOS as respostas GraphQL (mesmo método do VendasGov). fonte única
// 'LEILOTECH' com leiloeiro = nome do tenant (aparece no selo do card).
const LEILOTECH_TENANTS = [
  { domain: 'topoleiloes.com.br',        leiloeiro: 'Topo Leilões' },
  { domain: 'oleiloes.com.br',           leiloeiro: 'O Leilões' },
  { domain: 'spencerleiloes.com.br',     leiloeiro: 'Spencer Leilões' },
  { domain: 'vasconcelosleiloes.com.br', leiloeiro: 'Vasconcelos Leilões' },
  { domain: 'newtonleiloes.com.br',      leiloeiro: 'Newton Leilões' },
  { domain: 'bringelleiloes.com.br',     leiloeiro: 'Bringel Leilões' },
  { domain: 'alcanceleiloes.com.br',     leiloeiro: 'Alcance Leilões' },
  { domain: 'tulioleiloes.com.br',       leiloeiro: 'Túlio Leilões' },
  { domain: 'tesouroleiloes.com.br',     leiloeiro: 'Tesouro Leilões' },
  { domain: 'rdleiloes.com.br',          leiloeiro: 'RD Leilões' },
  { domain: 'vmleiloes.com.br',          leiloeiro: 'VM Leilões' },
  { domain: 'abrantesleiloes.com',       leiloeiro: 'Abrantes Leilões' },
  { domain: 'mariaclariceleiloes.com.br',leiloeiro: 'Maria Clarice Leilões' },
  { domain: 'ksleiloes.com.br',          leiloeiro: 'KS Leilões' },
  { domain: 'amleiloeiro.com.br',        leiloeiro: 'AM Leiloeiro' },
  { domain: 'mozarmirandaleiloes.com.br',leiloeiro: 'Mozar Miranda Leilões' },
  { domain: 'andredepaulaleiloes.com.br',leiloeiro: 'André de Paula Leilões' },
  { domain: 'ferleiloes.com.br',         leiloeiro: 'Fer Leilões' },
  { domain: 'alleiloes.com.br',          leiloeiro: 'AL Leilões' },
];

// Extrai um número de campos que podem vir número OU string BR OU objeto de valores.
function ltNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v > 0 ? v : 0;
  if (typeof v === 'string') return parseBRL(v);
  if (typeof v === 'object') {
    // valores costuma ser um objeto/array com o lance inicial/atual em algum campo.
    for (const k of ['lanceInicial', 'inicial', 'minimo', 'valor', 'atual', 'value']) {
      if (v[k] != null) { const n = ltNum(v[k]); if (n) return n; }
    }
    if (Array.isArray(v)) { for (const it of v) { const n = ltNum(it); if (n) return n; } }
  }
  return 0;
}

const LT_IMOVEL = /im[oó]vel|imob|apartament|\bcasa\b|terreno|\bl[oó]te\b|rural|urban|s[íi]tio|fazenda|ch[aá]cara|gale|sala comercial|comercial|pr[eé]dio|sobrado|cobertura|kitnet|flat|gleba|\bloja\b/i;

function mapLoteLeilotech(lote, leilao, tenant) {
  if (!lote) return null;
  const loc = lote.location || {};
  const titulo = String(lote.titulo || leilao.title || '').replace(/\s+/g, ' ').trim();
  const ext = extrairDaDescricao(titulo);
  const valorMin = ltNum(lote.lanceAtual) || ltNum(lote.valores) || ltNum(lote.avaliacao);
  const valAval = ltNum(lote.avaliacao);
  const foto = (lote.coverImageUrl && /^https?:\/\//.test(lote.coverImageUrl)) ? lote.coverImageUrl
             : (lote.primeiraFoto?.url && /^https?:\/\//.test(lote.primeiraFoto.url) ? lote.primeiraFoto.url : null);
  const tenantKey = tenant.domain.replace(/\..*/, '');
  const slug = lote.slug ? `/${lote.slug}` : '';
  const uf = String(loc.uf || '').toUpperCase().slice(0, 2);
  const isRural = /rural|s[íi]tio|fazenda|ch[aá]cara|gleba/i.test(`${leilao.title||''} ${titulo}`);
  return {
    fonte: 'LEILOTECH',
    fonte_id: `lt_${tenantKey}_${lote.id}`,
    titulo: (titulo || `Imóvel ${tenant.leiloeiro}`).slice(0, 180),
    tipo: normalizarTipo(isRural ? 'rural' : (lote.categoria?.nome || titulo)),
    modalidade: (/judicial/i.test(leilao.modalidade || leilao.tipo || '') && !/extra/i.test(leilao.modalidade || leilao.tipo || '')) ? 'judicial' : 'extrajudicial',
    estado: /^[A-Z]{2}$/.test(uf) ? uf : '',
    cidade: toTitleCase(loc.city || ''),
    bairro: '',
    endereco: '',
    valor_avaliacao: valAval,
    valor_minimo: valorMin,
    area_m2: ext.area_m2 || 0,
    ocupacao: ext.ocupacao || null,
    descricao: titulo.slice(0, 500),
    link_edital: `https://${tenant.domain}/lote/${lote.id}${slug}`,
    url_lote: `https://${tenant.domain}/lote/${lote.id}${slug}`,
    link_foto: foto,
    leiloeiro: tenant.leiloeiro,
    data_leilao: leilao.endsAt || leilao.startsAt || null,
    forma_pagamento: 'a_vista',
  };
}

// Coleta um tenant Leilotech interceptando as respostas GraphQL da própria SPA.
async function scraperLeilotechTenant(browser, tenant) {
  const base = `https://${tenant.domain}/`;
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const itens = new Map(); // leilaoId|loteId → { lote, leilao }
  let amostraLogada = false;
  page.on('response', async (resp) => {
    try {
      if (!/\/go\/graphql/.test(resp.url())) return;
      const t = await resp.text();
      if (t[0] !== '{') return;
      const j = JSON.parse(t);
      const lista = j?.data?.leiloesHome?.items;
      if (!Array.isArray(lista)) return;
      for (const leilao of lista) {
        const lote = leilao.primaryLote;
        if (!lote || !lote.id) continue;
        if (!amostraLogada) { console.log(`    [${tenant.domain}] amostra primaryLote: ${JSON.stringify(lote).slice(0, 400)}`); amostraLogada = true; }
        // só imóveis (título/categoria do leilão ou do lote)
        const rotulo = `${leilao.title || ''} ${leilao.categoriaMascara || ''} ${lote.categoria?.nome || ''} ${lote.titulo || ''}`;
        if (!LT_IMOVEL.test(rotulo)) continue;
        itens.set(`${leilao.id}|${lote.id}`, { lote, leilao });
      }
    } catch { /* resposta não-JSON/parcial */ }
  });

  try {
    // Cloudflare é intermitente: tenta carregar a home até a SPA disparar o GraphQL.
    let ok = false;
    for (let tentativa = 0; tentativa < 3 && !ok; tentativa++) {
      try { await page.goto(base, { waitUntil: 'networkidle2', timeout: 45000 }); } catch { /* */ }
      await new Promise(r => setTimeout(r, 4000));
      // rola para paginar (leiloesHome pagina no scroll)
      for (let s = 0; s < 12; s++) {
        try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch { /* */ }
        await new Promise(r => setTimeout(r, 1000));
      }
      if (itens.size > 0) ok = true;
    }
  } finally { await page.close().catch(() => {}); }

  const imoveis = [];
  const seen = new Set();
  for (const { lote, leilao } of itens.values()) {
    const row = mapLoteLeilotech(lote, leilao, tenant);
    if (!row || !row.valor_minimo || seen.has(row.fonte_id)) continue;
    seen.add(row.fonte_id);
    imoveis.push(row);
  }
  console.log(`    [${tenant.domain}] ${tenant.leiloeiro}: ${imoveis.length} imóveis (${itens.size} lotes de imóvel)`);
  return imoveis;
}

async function scraperLeilotech(browser) {
  console.log('  Leilotech — plataforma white-label (interceptando GraphQL de cada tenant)...');
  const todos = [];
  const vistos = new Set();
  for (const tenant of LEILOTECH_TENANTS) {
    try {
      const imoveis = await scraperLeilotechTenant(browser, tenant);
      for (const im of imoveis) { if (!vistos.has(im.fonte_id)) { vistos.add(im.fonte_id); todos.push(im); } }
    } catch (e) { console.log(`    [${tenant.domain}] erro: ${String(e.message).slice(0, 80)}`); }
  }
  console.log(`    Leilotech: ${todos.length} imóveis de ${LEILOTECH_TENANTS.length} leiloeiros`);
  return todos;
}

// ─── SUPORTE LEILÕES (plataforma white-label server-rendered) ─────────────────
// Outra "OS de leiloeiros". Cada tenant tem catálogo em /buscador?categoria=2
// (2 = Imóveis, padrão da plataforma), server-rendered, paginado. Cada lote é um
// <article class="lote-main bem-index-{id}"> com: .strong-cod (código), <h3> (tipo),
// <p> (descrição), .r2 span (Cidade - UF), .r4 strong.reset-colorGrid (lance),
// img.img-evento (foto no static.suporteleiloes.com.br), link /eventos/leilao/.../lote/{id}/...
// IMPORTANTE: pular tenants 100% PGFN (redirecionam p/ comprei.pgfn.gov.br — sem docs).
const SUPORTE_TENANTS = [
  { domain: 'liderleiloes.com.br', leiloeiro: 'Líder Leilões' },
  // Backlog TRT-15 (recon 23/07 confirmou white-label SUPORTE, com imóveis reais):
  { domain: 'valeroleiloes.com.br', leiloeiro: 'Valero Leilões' },
  { domain: 'gustavoreisleiloes.com.br', leiloeiro: 'Gustavo Reis Leilões' },
  // Backlog SUPORTE (recon-suporte 20/08, GRÁTIS via Puppeteer): confirmados /buscador?categoria=2
  // com imóveis reais e SEM redirect PGFN. leilaobrasil ficou de fora (voltou 0 lotes — mudou de
  // estrutura ou catálogo em outro lugar; precisa de recon próprio antes de entrar).
  { domain: 'vecchileiloes.com.br', leiloeiro: 'Vecchi Leilões' },
  { domain: 'saraivaleiloes.com.br', leiloeiro: 'Saraiva Leilões' },
  // ES/JUCEES (recon-leiloeiros-es + recon-suporte 21/08): white-label confirmada com 12 lotes
  // na 1ª página — único do lote JUCEES com atividade (21 leilões no histórico da junta).
  { domain: 'suedpeterleiloes.com.br', leiloeiro: 'Sued Peter Leilões' },

  // ─── JUCEMG (triagem 29/08) ────────────────────────────────────────────────────────────
  // O dono trouxe a lista oficial da Junta Comercial de MG (236 leiloeiros). A triagem
  // (`recon-triagem-jucemg.mjs`) achou 19 sites carregando de `static.suporteleiloes.com.br`
  // — e TRÊS deles já eram tenants nossos que coletam hoje (lider, saraiva, valero). Ou seja,
  // não é palpite de que "parece a mesma plataforma": é a MESMA, provada por quem já funciona.
  //
  // Por isso entram por configuração, sem código novo.
  //
  // RESULTADO DO 1º RUN (29/08): 7 dos 17 renderam — porto 12, marcoantonio 12, rodrigo 12,
  // rofrem 6, sandrasantos 3, serpa 2, stefanelli 1. Total SUPORTE: 81 → 92 lotes ativos, 23
  // deles em MG.
  //
  // OS 10 QUE VIERAM COM ZERO FICAM. Eu tinha escrito que sairiam, e reconsiderei olhando o
  // resultado: a plataforma é comprovadamente a mesma (o parser leu 7 tenants novos sem um
  // ajuste), então zero aqui não é "não sei ler" — é "hoje não há imóvel neste catálogo".
  // Leiloeiro que só tem veículo esta semana pode ter imóvel no mês que vem, e um tenant custa
  // ~2 s por rodada num job que tem 150 min de teto. Tirar economizaria 20 s e perderia a
  // captura automática. Ficam.
  //
  // ⚠️ Os cinco marcados PGFN têm link para `comprei.pgfn.gov.br` na home. Isso NÃO os torna
  // 100% PGFN — e o run confirmou: DOIS deles (marcoantonio, rodrigo) trouxeram 12 imóveis
  // cada. Barrá-los por suposição teria custado 24 lotes.
  { domain: 'anandaleiloes.com.br', leiloeiro: 'Ananda Leilões' },
  { domain: 'donizetteleiloes.com.br', leiloeiro: 'Donizette Leilões' },
  { domain: 'goldenlance.com.br', leiloeiro: 'Golden Lance Leilões' },
  { domain: 'lilianportugal.com.br', leiloeiro: 'Lilian Portugal Leilões' },
  { domain: 'marianoleiloes.com.br', leiloeiro: 'Mariano Leilões' },
  { domain: 'mjleiloes.com.br', leiloeiro: 'MJ Leilões' },
  { domain: 'pelesleiloes.com.br', leiloeiro: 'Peles Leilões' },
  { domain: 'portoleiloes.com.br', leiloeiro: 'Porto Leilões' },
  { domain: 'rofremleiloes.com.br', leiloeiro: 'Rofrem Leilões' },
  { domain: 'sandrasantosleiloes.com.br', leiloeiro: 'Sandra Santos Leilões' },
  { domain: 'serpaleiloes.com.br', leiloeiro: 'Serpa Leilões' },
  { domain: 'stefanellileiloes.com.br', leiloeiro: 'Stefanelli Leilões' },
  { domain: 'luizlobatoleiloeiro.com.br', leiloeiro: 'Luiz Lobato Leilões' },          // PGFN na home
  { domain: 'marcoantonioleiloeiro.com.br', leiloeiro: 'Marco Antônio Leilões' },      // PGFN na home
  { domain: 'rafaelleiloeiro.com.br', leiloeiro: 'Rafael Araújo Leilões' },            // PGFN na home
  { domain: 'rodrigoleiloeiro.com.br', leiloeiro: 'Rodrigo Collyer Leilões' },         // PGFN na home
  { domain: 'wermelingerleiloes.com.br', leiloeiro: 'Wermelinger Leilões' },           // PGFN na home
  // `donizetteleiloes.leilao.br` é o MESMO site do .com.br (mesmo `arrematante.` e mesmo
  // static). Fora de propósito: o `tenantKey` deriva do domínio antes do primeiro ponto, então
  // os dois gerariam o mesmo `fonte_id` e um sobrescreveria o outro sem nada aparecer.
];

// Lote de TESTE do próprio leiloeiro (SUEDPETER 21/08: "LEILÃO TESTE - LOTE 02" no evento
// /leilao-eletronico-somente-teste/). Não é imóvel — barrar por título/URL antes de gravar.
const RE_SUPORTE_TESTE = /\bleil[ãa]o[\s-]*(?:eletr[ôo]nico[\s-]*)?(?:somente[\s-]*)?teste\b|\bsomente[\s-]*teste\b|\b(?:lote|bem)[\s-]*(?:de[\s-]*)?teste\b|\bteste[\s-]*lote\b/i;

/**
 * DATAS DE PRAÇA DA FAMÍLIA SUPORTE LEILÕES (29/08) — serve SUPORTE **e** WEBLEILÕES, que rodam
 * a mesma plataforma (os dois carregam de `static.suporteleiloes.com.br`).
 *
 * POR QUE EXISTE: os dois mapeadores escreviam `data_leilao: null` fixo — nunca procuraram. São
 * 185 lotes ativos que, sem data, nunca expiram por prazo e deixam o gate de leilão encerrado
 * FALHAR ABERTO, com o cliente gastando cota num leilão que já aconteceu.
 *
 * A LISTAGEM NÃO TEM A DATA (o recon confirmou: só "Aberto para Lances · 1ª leilão"). Ela mora
 * na PÁGINA DO LOTE, em duas marcações irmãs que o recon mapeou:
 *   <li class="data-atual"><strong>1º Leilão<span>R$ …</span></strong> <small>31/08/2026 às 14h00</small></li>
 *   <li class="data-off"><div class="data-left"><strong>1º Leilão</strong> <span>26/08/2026 14:00</span></div>…
 * Daí a extração ser por TEXTO do bloco, e não por seletor de um layout só: as duas variantes
 * põem "1º/2º Leilão" e a data no mesmo `li`, e é essa vizinhança que identifica a praça.
 */
function datasPracaSuporte(html) {
  const out = { primeira: null, segunda: null };
  if (!html) return out;
  // Cada <li> que contenha "Nº Leilão" e uma data. `[^]` no lugar de `.` porque o HTML vem
  // com quebra de linha dentro do bloco.
  const blocos = String(html).match(/<li[^>]*>[^]*?<\/li>/gi) || [];
  for (const b of blocos) {
    const txt = b.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    const praca = txt.match(/\b([12])\s*[ºªo°]?\s*Leil[ãa]o\b/i);
    const data = txt.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
    if (!praca || !data) continue;
    const iso = dataBRparaISO(data[0]);
    if (!iso) continue;
    if (praca[1] === '1' && !out.primeira) out.primeira = iso;
    if (praca[1] === '2' && !out.segunda) out.segunda = iso;
  }
  return out;
}

/**
 * dd/mm/aaaa → aaaa-mm-dd. NUNCA `new Date(texto)`: "03/09/2026" seria lido como mês 03,
 * dia 09 — trocado em 11 de cada 12 casos e PLAUSÍVEL em todos, a forma nº 10 do CLAUDE.md.
 * Fora do formato ou fora da janela de plausibilidade → null: melhor sem data que com data
 * errada, porque data errada expira lote vivo e mantém vivo lote encerrado.
 */
function dataBRparaISO(txt) {
  const m = String(txt || '').match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!m) return null;
  const [, d, mes, ano] = m;
  const dd = Number(d), mm = Number(mes), aa = Number(ano);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const agora = new Date().getFullYear();
  if (aa < agora - 2 || aa > agora + 3) return null;
  return `${ano}-${mes}-${d}`;
}

function mapLoteSuporte(l, tenant, datas = null) {
  if (!l || !l.id) return null;
  const titulo = String(l.descricao || l.tipo || '').replace(/\s+/g, ' ').trim();
  const loc = String(l.local || '').replace(/\s+/g, ' ').trim();
  const lm = loc.match(/^(.*?)\s*[-–]\s*([A-Za-z]{2})\s*$/);
  let cidade = lm ? lm[1].trim() : '';
  let uf = lm ? lm[2].toUpperCase() : '';
  // FALLBACK cidade/UF da DESCRIÇÃO (recon-suporte 20/08): alguns tenants (vecchi) deixam o
  // campo `.r2`/local VAZIO e põem a cidade no texto — "GOIÂNIA/GO - UM APARTAMENTO…" (começo)
  // ou "…, BELO HORIZONTE/MG" (fim). Sem isto, o lote entrava SEM cidade/UF (geocode falha, o
  // relatório imprime "não informada"). Só age quando `local` não resolveu — não toca quem já tem.
  if (!cidade || !uf) {
    const dm = titulo.match(/^\s*([A-Za-zÀ-ÿ .'-]{2,40})\s*\/\s*([A-Z]{2})\b/)
      || [...String(titulo).matchAll(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .'-]{1,39})\s*\/\s*([A-Z]{2})\b/g)].pop();
    if (dm) { cidade = cidade || dm[1].trim(); uf = uf || dm[2].toUpperCase(); }
  }
  const ext = extrairDaDescricao(titulo);
  const tenantKey = tenant.domain.replace(/\..*/, '');
  const link = l.href ? (l.href.startsWith('http') ? l.href : `https://${tenant.domain}${l.href}`) : `https://${tenant.domain}/buscador?categoria=2`;
  return {
    fonte: 'SUPORTE',
    fonte_id: `sl_${tenantKey}_${l.id}`,
    titulo: (titulo || `Imóvel ${tenant.leiloeiro}`).slice(0, 180),
    tipo: normalizarTipo(l.tipo || titulo),
    modalidade: 'extrajudicial',
    estado: /^[A-Z]{2}$/.test(uf) ? uf : '',
    cidade: cidade ? toTitleCase(cidade) : '',
    bairro: '',
    endereco: '',
    valor_avaliacao: 0,
    valor_minimo: parseBRL(l.valor || ''),
    area_m2: ext.area_m2 || 0,
    ocupacao: ext.ocupacao || null,
    descricao: titulo.slice(0, 500),
    link_edital: link,
    url_lote: link,
    link_foto: (l.foto && /^https?:\/\//.test(l.foto)) ? l.foto : null,
    leiloeiro: tenant.leiloeiro,
    data_leilao: datas?.primeira || null,
    data_leilao_2: datas?.segunda || null,
    forma_pagamento: 'a_vista',
  };
}

function suporteParsePagina(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('article.lote-main, article[class*="lote-main"]').forEach((c) => {
      const cls = c.className || '';
      const mm = cls.match(/bem-index-(\d+)/);
      const id = mm ? mm[1] : (c.querySelector('.strong-cod')?.textContent || '').replace(/[^\d]/g, '');
      if (!id) return;
      const a = c.querySelector('a[href*="/lote/"]');
      const img = c.querySelector('img.img-evento, img');
      const valEl = c.querySelector('.r4 strong.reset-colorGrid, .end-typeCol strong');
      out.push({
        id,
        href: a ? (a.getAttribute('href') || '') : '',
        tipo: (c.querySelector('h3')?.textContent || '').trim(),
        descricao: (c.querySelector('.cont-infos p, p')?.textContent || '').trim(),
        local: (c.querySelector('.r2 span, [class*="location"] + span')?.textContent || '').trim(),
        valor: (valEl?.textContent || '').trim(),
        foto: img ? (img.getAttribute('src') || '') : '',
      });
    });
    return out;
  }).catch(() => []);
}

async function scraperSuporteTenant(browser, tenant) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const bens = new Map();
  const DEADLINE = Date.now() + 5 * 60 * 1000;
  try {
    for (let p = 1; p <= 40; p++) {
      if (Date.now() > DEADLINE) break;
      const antes = bens.size;
      try {
        await page.goto(`https://${tenant.domain}/buscador?categoria=2&pagina=${p}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(r => setTimeout(r, 1200));
      } catch { break; }
      const lotes = await suporteParsePagina(page);
      for (const l of lotes) { if (l.id && !bens.has(l.id)) bens.set(l.id, l); }
      if (bens.size === antes) break; // página sem novidade → acabou
    }
  } finally { await page.close().catch(() => {}); }

  const imoveis = [];
  const seen = new Set();
  // VISITA À PÁGINA DO LOTE PARA PEGAR AS PRAÇAS (29/08). A listagem não traz data — o recon
  // confirmou: só "Aberto para Lances · 1ª leilão". Só entra aqui quem tem `href` de lote real,
  // e o teto por rodada existe para a visita não virar o gargalo do job (que já roda ~87 min
  // com todas as fontes). É acesso GRÁTIS: mesma origem que a listagem, sem Bright Data.
  const MAX_DETALHE = Number(process.env.SUPORTE_MAX_DETALHE || 60);
  const paginaLote = await browser.newPage();
  await paginaLote.setUserAgent(USER_AGENT);
  let visitados = 0, comData = 0;
  const datasPorLote = new Map();
  try {
    for (const l of bens.values()) {
      if (visitados >= MAX_DETALHE) break;
      const href = l.href ? (l.href.startsWith('http') ? l.href : `https://${tenant.domain}${l.href}`) : '';
      if (!href || !/\/lote\//.test(href)) continue;
      try {
        await paginaLote.goto(href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const html = await paginaLote.content();
        const d = datasPracaSuporte(html);
        if (d.primeira || d.segunda) { datasPorLote.set(l.id, d); comData++; }
        visitados++;
        await new Promise(r => setTimeout(r, 250));
      } catch (e) {
        // Motivo preservado: "não abriu" e "abriu e não tem praça" pedem consertos diferentes.
        visitados++;
        console.log(`    [${tenant.domain}] lote ${l.id} sem detalhe: ${String(e?.message || e).slice(0, 60)}`);
      }
    }
  } finally { await paginaLote.close().catch(() => {}); }
  if (visitados) console.log(`    [${tenant.domain}] detalhe: ${comData}/${visitados} com praça`);

  for (const l of bens.values()) {
    if (RE_SUPORTE_TESTE.test(`${l.descricao || ''} ${l.tipo || ''} ${l.href || ''}`)) continue;
    const row = mapLoteSuporte(l, tenant, datasPorLote.get(l.id) || null);
    if (!row || !row.valor_minimo || seen.has(row.fonte_id)) continue;
    seen.add(row.fonte_id);
    imoveis.push(row);
  }
  console.log(`    [${tenant.domain}] ${tenant.leiloeiro}: ${imoveis.length} imóveis (${bens.size} lotes)`);
  return imoveis;
}

async function scraperSuporte(browser) {
  console.log('  Suporte Leilões — plataforma white-label (/buscador?categoria=2 por tenant)...');
  const todos = [];
  const vistos = new Set();
  for (const tenant of SUPORTE_TENANTS) {
    try {
      const imoveis = await scraperSuporteTenant(browser, tenant);
      for (const im of imoveis) { if (!vistos.has(im.fonte_id)) { vistos.add(im.fonte_id); todos.push(im); } }
    } catch (e) { console.log(`    [${tenant.domain}] erro: ${String(e.message).slice(0, 80)}`); }
  }
  console.log(`    Suporte Leilões: ${todos.length} imóveis de ${SUPORTE_TENANTS.length} leiloeiros`);
  return todos;
}

// ─── GRUPO LANCE ──────────────────────────────────────────────────────────────
// Leiloeiro grande (MG/nacional), server-rendered (Yii2, sem Cloudflare). Catálogo
// de imóveis em /imoveis?page=N. Cada card é .card-item[data-key={id}] com:
// a.card-title (título com área/endereço), .card-price (valor), a.card-locality
// (Cidade, UF), a[href*="/leiloes/"] (modalidade), foto no background da a.card-image
// (//cdn.grupolance.com.br/...). Detalhe server-rendered → docs via enriquecerDocumentosLote.
const GL_BASE = 'https://www.grupolance.com.br';

function mapLoteGrupoLance(l) {
  if (!l || !l.id) return null;
  // Limpa o glitch de scraping "sImóvel, 12.796,46m²…" (char extra colado ao início do
  // título): uma letra minúscula solta grudada numa Maiúscula no começo é artefato.
  const titulo = String(l.titulo || '').replace(/\s+/g, ' ').trim().replace(/^[a-zà-ÿ](?=[A-ZÀ-Þ])/, '');
  // "Cidade, UF" da card-locality; fallback: UF/cidade da URL /imoveis/{cat}/{uf}/{cidade}/...
  let cidade = '', uf = '';
  const lm = String(l.local || '').match(/^(.*?),\s*([A-Za-z]{2})\s*$/);
  if (lm) { cidade = lm[1].trim(); uf = lm[2].toUpperCase(); }
  const um = String(l.href || '').match(/\/imoveis\/[^/]+\/([a-z]{2})\/([^/]+)\//i);
  if (!uf && um) uf = um[1].toUpperCase();
  if (!cidade && um) cidade = toTitleCase(um[2].replace(/-/g, ' '));
  const ext = extrairDaDescricao(titulo);
  const foto = l.foto ? (l.foto.startsWith('//') ? `https:${l.foto}` : l.foto) : null;
  const href = l.href ? (l.href.startsWith('http') ? l.href : `${GL_BASE}${l.href}`) : `${GL_BASE}/imoveis`;
  return {
    fonte: 'GRUPOLANCE',
    fonte_id: `gl_${l.id}`,
    titulo: (titulo || `Imóvel Grupo Lance ${l.id}`).slice(0, 180),
    tipo: normalizarTipo(titulo),
    modalidade: (/judicial/i.test(l.modalidade || '') && !/extra/i.test(l.modalidade || '')) ? 'judicial' : 'extrajudicial',
    estado: /^[A-Z]{2}$/.test(uf) ? uf : '',
    cidade: cidade || '',
    bairro: '',
    endereco: '',
    valor_avaliacao: 0,
    valor_minimo: parseBRL(l.valor || ''),
    area_m2: ext.area_m2 || 0,
    ocupacao: ext.ocupacao || null,
    descricao: titulo.slice(0, 500),
    link_edital: href,
    url_lote: href,
    link_foto: (foto && /^https?:\/\//.test(foto)) ? foto : null,
    leiloeiro: 'Grupo Lance',
    data_leilao: null,
    forma_pagamento: 'a_vista',
  };
}

function grupoLanceParsePagina(page) {
  return page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.card-item[data-key]').forEach((c) => {
      const id = c.getAttribute('data-key');
      if (!id) return;
      const t = c.querySelector('a.card-title');
      const loc = c.querySelector('a.card-locality');
      const modal = c.querySelector('.card-info a[href*="/leiloes/"]');
      const img = c.querySelector('a.card-image');
      const bg = img ? (img.getAttribute('style') || '') : '';
      const foto = (bg.match(/url\(([^)'"]+)/) || [])[1] || null;
      out.push({
        id,
        href: t ? (t.getAttribute('href') || '') : '',
        titulo: (t?.getAttribute('title') || t?.textContent || '').trim(),
        valor: (c.querySelector('.card-price')?.textContent || '').trim(),
        local: (loc?.getAttribute('title') || loc?.textContent || '').trim(),
        modalidade: (modal?.textContent || '').trim(),
        foto,
      });
    });
    return out;
  }).catch(() => []);
}

async function scraperGrupoLance(browser) {
  console.log('  Grupo Lance — server-rendered (/imoveis, paginado)...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const bens = new Map();
  const DEADLINE = Date.now() + 7 * 60 * 1000;
  try {
    for (let p = 1; p <= 60; p++) {
      if (Date.now() > DEADLINE) { console.log('    Grupo Lance: teto de tempo atingido'); break; }
      const antes = bens.size;
      try {
        await page.goto(`${GL_BASE}/imoveis?pagina=${p}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await new Promise(r => setTimeout(r, 900));
      } catch { break; }
      const lotes = await grupoLanceParsePagina(page);
      for (const l of lotes) { if (l.id && !bens.has(l.id)) bens.set(l.id, l); }
      if (bens.size === antes) break; // página sem novidade → fim da paginação
    }
  } finally { await page.close().catch(() => {}); }

  const imoveis = [];
  const seen = new Set();
  for (const l of bens.values()) {
    const row = mapLoteGrupoLance(l);
    if (!row || !row.valor_minimo || seen.has(row.fonte_id)) continue;
    seen.add(row.fonte_id);
    imoveis.push(row);
  }
  console.log(`    Grupo Lance: ${imoveis.length} imóveis mapeados (${bens.size} lotes)`);
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

// Valor de AVALIAÇÃO ancorado na palavra "avaliação" no texto da página (espelho de
// api/enriquecer-lote.js:extrairAvaliacao — duplicado aqui para o script não arrastar
// as dependências de runtime da API). 1º valor plausível ganha.
function extrairAvaliacaoHtml(html) {
  if (!html) return null;
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const re = /avalia[cç][aã]?[o]?\w*[^R$\d]{0,18}R?\$?\s*(\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2})/gi;
  let m;
  while ((m = re.exec(txt))) {
    const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
    if (v && v >= 1000 && v < 100000000) return v;
  }
  return null;
}

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
  // MERGE do que o BANCO já tem ANTES de decidir quem visitar (P3 de 21/08). Sem isto,
  // dois defeitos da mesma classe da regressão de datas da CEF: (a) o upsert diário do
  // card regrava 0 por cima da avaliação/área que o enriquecimento conquistou ontem;
  // (b) faltaAval/faltaArea olhavam só a linha FRESCA (sempre 0 p/ BIASI/GL/SODRE/VIP),
  // então o cap revisitava os MESMOS primeiros lotes todo dia e a cauda nunca chegava.
  // Best-effort: erro de leitura → segue como antes (revisita; upsert idempotente).
  try {
    const ids = (imoveis || []).map(im => im.fonte_id).filter(Boolean);
    for (let i = 0; i < ids.length; i += 200) {
      // padrao-ok: leitura best-effort de merge; falha só faz revisitar lote conhecido, nunca corrompe
      const { data } = await supabase.from('imoveis_leilao')
        .select('fonte_id, area_m2, valor_avaliacao, link_matricula, link_regras_venda, anexos')
        .in('fonte_id', ids.slice(i, i + 200));
      for (const db of data || []) {
        const im = imoveis.find(x => x.fonte_id === db.fonte_id);
        if (!im) continue;
        if (!(Number(im.area_m2) > 0) && Number(db.area_m2) > 0) im.area_m2 = Number(db.area_m2);
        if (!(Number(im.valor_avaliacao) > 0) && Number(db.valor_avaliacao) > 0) im.valor_avaliacao = Number(db.valor_avaliacao);
        if (!im.link_matricula && db.link_matricula) im.link_matricula = db.link_matricula;
        if (!im.link_regras_venda && db.link_regras_venda) im.link_regras_venda = db.link_regras_venda;
        if (!(Array.isArray(im.anexos) && im.anexos.length) && Array.isArray(db.anexos) && db.anexos.length) im.anexos = db.anexos;
      }
    }
  } catch { /* merge é otimização — nunca derruba o enriquecimento */ }

  const alvos = (imoveis || []).filter(im => {
    const url = im.url_lote || im.link_edital;
    if (!url || !/^https?:\/\//.test(url)) return false;
    const jaTemDocs = im.link_matricula || (Array.isArray(im.anexos) && im.anexos.length);
    // Também visita lotes SEM avaliação (GL/SODRE/BIASI/VIP não trazem no card da
    // listagem, só no detalhe): o valor é extraído do MESMO HTML que já renderizamos
    // p/ os documentos — custo marginal zero. Bounded pelos mesmos cap + deadline.
    const faltaAval = !(Number(im.valor_avaliacao) > 0);
    // E lotes SEM ÁREA, pelo mesmo motivo (P3 de 21/08): o card do BIASI não traz m² e o
    // mapper gravava area_m2:0 fixo — a fonte inteira (324 ativos) ficou 0% de área e foi
    // ela quem empurrou o invariante lote_sem_area_nem_matricula de 404→558. A área mora
    // no MESMO detalhe renderizado dos docs/avaliação.
    const faltaArea = !(Number(im.area_m2) > 0);
    return !jaTemDocs || faltaAval || faltaArea;
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
        // AVALIAÇÃO do detalhe renderizado (o card da listagem não traz em GL/SODRE/
        // BIASI/VIP/SUPORTE): mesma regex ancorada em "avaliação" do on-demand
        // (api/enriquecer-lote.js). Guards anti mis-read: > mínimo e <= 10x o mínimo.
        if (!(Number(im.valor_avaliacao) > 0)) {
          const av = extrairAvaliacaoHtml(html);
          const vm = Number(im.valor_minimo) || 0;
          if (av && av > vm && (vm <= 0 || av <= vm * 10)) im.valor_avaliacao = av;
        }
        // ÁREA do detalhe renderizado (mesmo HTML, custo zero): extrairAreaM2 prioriza
        // "área construída/privativa/útil" e tem régua de plausibilidade (8–1M m²).
        if (!(Number(im.area_m2) > 0)) {
          const texto = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
          // Página INTEIRA → sem o regex solto: só área ANCORADA (construída/privativa/útil/
          // total/terreno). O fallback `NUM m²` sobre a página toda pegava metragem de banner/
          // rodapé/outro lote e o trigger de preservação a tornava permanente (caso BIASI).
          const a2 = extrairAreaM2(texto, { permitirSolta: false });
          if (a2 > 0) im.area_m2 = a2;
        }
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

// ─── RECON Leiloaria Smart (Leilofy) — mapeia a API/estrutura (SPA + Cloudflare) ──
// Roda só com SCRAPER_FONTES=LEILOFY_RECON. Carrega as páginas de listagem no
// navegador real, captura os endpoints JSON (XHR/fetch) e dá dump da estrutura para
// escrevermos o mapper. Não grava nada — é só descoberta.
async function reconLeilofy(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const apis = new Map();
  page.on('response', async (resp) => {
    try {
      const url = resp.url();
      if (/google|gtag|analytics|sentry|hotjar|clarity|facebook|recaptcha|cloudflare|cdn-cgi/i.test(url)) return;
      const ct = resp.headers()['content-type'] || '';
      if (!/json/i.test(ct)) return;
      const j = await resp.json().catch(() => null);
      if (!j || apis.has(url)) return;
      const keys = Array.isArray(j) ? `array[${j.length}] de {${j[0] && typeof j[0] === 'object' ? Object.keys(j[0]).join(',') : typeof j[0]}}` : `{${Object.keys(j).join(',')}}`;
      apis.set(url, { method: resp.request().method(), keys, sample: JSON.stringify(j).slice(0, 1500) });
    } catch { /* ignora */ }
  });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // 1) LISTAGEM: carrega /imoveis, faz scroll p/ carregar mais e dá dump do 1º card.
  try {
    console.log('\n[RECON] goto /imoveis');
    await page.goto('https://leiloariasmart.com.br/imoveis', { waitUntil: 'networkidle2', timeout: 45000 });
    await sleep(4000);
    for (let s = 0; s < 6; s++) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await sleep(1500); }
    const listing = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href^="/imovel/"]'));
      const ids = [...new Set(anchors.map(a => a.getAttribute('href')))];
      const a = anchors[0];
      let card = a; for (let k = 0; k < 5 && card && card.parentElement; k++) { card = card.parentElement; if ((card.className || '').toString().match(/card|item|imovel|lote|col/i)) break; }
      return { total: ids.length, ids: ids.slice(0, 12), cardHTML: card ? card.outerHTML.replace(/\s+/g, ' ').slice(0, 3500) : null };
    });
    console.log(`[RECON] listagem: ${listing.total} ids. amostra: ${JSON.stringify(listing.ids)}`);
    console.log(`[RECON] card HTML: ${listing.cardHTML}`);

    // 2) DETALHE: primeiro imóvel — innerText + links de documentos + imagens.
    const firstId = String(listing.ids[0] || '').replace('/imovel/', '');
    if (firstId) {
      console.log(`\n[RECON] goto /imovel/${firstId}`);
      await page.goto(`https://leiloariasmart.com.br/imovel/${firstId}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(4000);
      const det = await page.evaluate(() => {
        const text = (document.body?.innerText || '').replace(/\n{2,}/g, '\n').slice(0, 4000);
        const docs = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(h => h && /\.pdf|edital|matricula|matrícula|documento|laudo|anexo/i.test(h));
        const imgs = Array.from(document.querySelectorAll('img')).map(i => i.getAttribute('src') || i.getAttribute('data-src')).filter(Boolean).filter(s => !/logo|icon|avatar/i.test(s)).slice(0, 6);
        return { text, docs: [...new Set(docs)].slice(0, 20), imgs };
      });
      console.log(`[RECON] detalhe innerText:\n${det.text}`);
      console.log(`[RECON] detalhe docs: ${JSON.stringify(det.docs)}`);
      console.log(`[RECON] detalhe imgs: ${JSON.stringify(det.imgs)}`);
    }
  } catch (e) { console.log(`[RECON] falhou: ${String(e.message).slice(0, 120)}`); }
  console.log(`\n[RECON] ${apis.size} endpoint(s) JSON: ${[...apis.keys()].filter(u => !/jivosite|youtube/.test(u)).join(' | ') || '(nenhum relevante)'}`);
  console.log('\n[RECON] fim.');
  await page.close().catch(() => {});
  return [];
}

// ─── LEILOARIA SMART (Leilofy) — SPA server-rendered, DOM parsing ──────────────
// Listagem em /imoveis (links /imovel/{id}); cada detalhe tem endereço, avaliação,
// lance, matrícula, modalidade e os PDFs em /_admin_/upload/*.pdf (MATRÍCULA/EDITAL/
// LAUDO). Sem API JSON — parseia o texto da página do lote.
function mapLoteLeilofy(raw, id) {
  const text = String(raw?.text || '');
  const q = (re) => { const m = text.match(re); return m ? m[1].trim() : ''; };
  // Preço robusto: 1) tenta pelos rótulos (preciso quando a frase bate); 2) se algum
  // faltar, usa TODOS os "R$ x.xxx,xx" do texto — avaliação=maior, lance=menor —
  // filtrando valores pequenos (R$/m², taxas, comissão). Diagnóstico provou que a
  // página vem completa (avaliação e R$ no texto), mas a frase variou entre lotes e a
  // regex ancorada falhava → 0 mapeados. Este fallback não depende do fraseado.
  // O DETALHE do lote traz os valores na caixa "Primeira praça:" / "Segunda praça:", com o VALOR
  // logo após a data — VALIDADO no recon: "Primeira praça: 04/08/2026 às 10:25 R$ 18.000.000,00".
  // A SPA AINDA lista OUTROS lotes abaixo com o rótulo "Valor de Avaliação (1ª Praça)" — NÃO usar
  // (é de outro lote; foi o que fez a mansão de R$18M mostrar valor de outro imóvel). "Incremento"
  // (ex.: R$20.000) e "Último lance" (R$0,00) também aparecem — JAMAIS como piso (bug antigo: o
  // Math.min pegava o incremento). 1ª ocorrência de "Primeira/Segunda praça" = ESTE lote.
  let avaliacao = parseBRL(q(/Primeira\s+pra[çc]a[\s\S]{0,80}?R\$\s*([\d.]+,\d{2})/i));
  const praca2  = parseBRL(q(/Segunda\s+pra[çc]a[\s\S]{0,80}?R\$\s*([\d.]+,\d{2})/i));
  // Lance mínimo (piso) = 2ª praça (condicional); sem 2ª praça, cai na 1ª (avaliação). Sem os
  // rótulos do detalhe → 0 (honesto; a matrícula/edital preenche depois). NUNCA o Math.min global.
  let lance = praca2 || avaliacao;
  const localizacao = q(/Localiza[çc][ãa]o\s*\n\s*([^\n]+)/i);
  const tipoTxt = q(/Tipo:\s*([^\n]+)/i);
  const areaCon = q(/[ÁA]rea constru[íi]da:\s*([\d.,]+)/i);
  const titulo = String(raw?.titulo || '').replace(/\s+/g, ' ').trim() || q(/\n([^\n]{3,80}m²[^\n]*)\n/);
  const modalidade = /\bjudicial\b/i.test(text) && !/extrajudicial/i.test(text) ? 'judicial' : 'extrajudicial';
  // cidade/UF/bairro a partir de "Rua …, nº, Bairro, Cidade, UF, CEP"
  let cidade = '', uf = '', bairro = '';
  const parts = localizacao.split(',').map(s => s.trim()).filter(Boolean);
  const ufIdx = parts.findIndex(p => /^[A-Z]{2}$/.test(p));
  if (ufIdx > 0) { uf = parts[ufIdx]; cidade = parts[ufIdx - 1]; if (ufIdx >= 3) bairro = parts[ufIdx - 2]; }
  if (!uf && titulo) { const m = titulo.match(/([A-Za-zÀ-ÿ'.\- ]{2,40})\/([A-Z]{2})\b/); if (m) { cidade = m[1].trim(); uf = m[2]; } }
  const docs = (Array.isArray(raw?.docs) ? raw.docs : []).filter(d => d && d.url);
  const findDoc = (re) => (docs.find(d => re.test(d.label || '')) || {}).url || null;
  const anexos = docs.map(d => ({ tipo: /matr[íi]cula/i.test(d.label) ? 'matricula' : (/edital/i.test(d.label) ? 'edital' : (/laudo/i.test(d.label) ? 'laudo' : 'outro')), nome: (d.label || 'Documento').slice(0, 80), url: d.url }));
  const fotos = (Array.isArray(raw?.fotos) ? raw.fotos : []).filter(Boolean);
  // Fallback de foto (lotes sem imagem em /_admin_/upload/): og:image da página,
  // exceto se for logo/ícone/placeholder do site.
  const ogFoto = (raw?.ogImage && /^https?:\/\//i.test(raw.ogImage) && !/logo|icon|placeholder|default|favicon|sprite/i.test(raw.ogImage)) ? raw.ogImage : null;
  return {
    fonte: 'LEILOFY',
    fonte_id: `leilofy_${id}`,
    titulo: (titulo || `Imóvel ${id}`).slice(0, 180),
    tipo: normalizarTipo(tipoTxt || titulo),
    modalidade,
    estado: /^[A-Z]{2}$/.test(uf) ? uf : '',
    cidade: cidade ? toTitleCase(cidade) : '',
    bairro: bairro ? toTitleCase(bairro) : '',
    endereco: localizacao.slice(0, 200),
    valor_avaliacao: avaliacao || 0,
    valor_minimo: lance || 0,
    area_m2: Number(String(areaCon).replace(/\./g, '').replace(',', '.')) || 0,
    descricao: String(raw?.descricao || titulo || '').slice(0, 500),
    link_edital: findDoc(/edital/i),
    link_matricula: findDoc(/matr[íi]cula/i),
    url_lote: `https://leiloariasmart.com.br/imovel/${id}`,
    // Foto: prioriza as imagens do lote (/_admin_/upload/); se o lote não tiver
    // (4 de 21 na 1ª coleta), cai para o og:image da página — desde que não seja
    // logo/ícone/placeholder (senão gravaria a marca do site como foto do imóvel).
    link_foto: fotos[0] || ogFoto || null,
    anexos,
    leiloeiro: 'Leiloaria Smart',
    // Data do leilão: reusa o extrator ancorado (procura dd/mm/aaaa perto de
    // "leilão/praça/encerra/licitação/data"; só aceita datas de ontem a +400 dias,
    // senão null). Antes era hardcoded null → 0/21 imóveis tinham data.
    data_leilao: extrairDataLeilaoHTML(text),
    forma_pagamento: 'a_vista',
  };
}

async function scraperLeilofy(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const ids = new Set();
  try {
    for (const path of ['/imoveis', '/busca']) {
      await page.goto(`https://leiloariasmart.com.br${path}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
      await sleep(3000);
      for (let s = 0; s < 12; s++) { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {}); await sleep(1200); }
      const found = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('a[href^="/imovel/"]')).map(a => (a.getAttribute('href') || '').replace('/imovel/', '').split(/[#?]/)[0]))]).catch(() => []);
      found.forEach(id => { if (/^\d+$/.test(id)) ids.add(id); });
    }
  } catch (e) { console.log(`    Leilofy listagem: ${String(e.message).slice(0, 60)}`); }
  console.log(`    Leilofy: ${ids.size} imóveis na listagem`);
  const imoveis = [];
  let i = 0;
  for (const id of ids) {
    if (i++ >= 300) break;
    try {
      await page.goto(`https://leiloariasmart.com.br/imovel/${id}`, { waitUntil: 'networkidle2', timeout: 40000 });
      // O detalhe é um SPA: preço/descrição renderizam DEPOIS do networkidle. Espera por
      // MARCADORES ESPECÍFICOS do conteúdo real do lote — "valor de avaliação" / "lance
      // está fixado" / "Documentos do lote" (recon confirmou que só aparecem com a página
      // renderizada). Evita casar cedo demais num "R$" do shell e capturar texto sem o
      // preço (valor_minimo=0 → lote descartado → "0 mapeados"). Teto de 12s; adaptativo.
      await page.waitForFunction(
        () => /valor de avalia|lance est[áa] fixado|Documentos do lote/i.test(document.body?.innerText || ''),
        { timeout: 12000 }
      ).catch(() => {});
      await sleep(700);
      const det = await page.evaluate(() => {
        const text = (document.body?.innerText || '').slice(0, 9000);
        const titulo = (document.querySelector('h1,h2,.titulo,.title')?.innerText || '').trim();
        let descricao = '';
        const dm = text.match(/Descri[çc][ãa]o\s*([\s\S]{0,1500}?)\s*Detalhes do Im[óo]vel/i);
        if (dm) descricao = dm[1].replace(/\s+/g, ' ').trim();
        const docs = Array.from(document.querySelectorAll('a[href*="/_admin_/upload/"]')).filter(a => /\.pdf(\?|$)/i.test(a.href)).map(a => ({ url: a.href, label: (a.innerText || a.textContent || '').trim() }));
        const fotos = Array.from(document.querySelectorAll('img')).map(i2 => i2.src || i2.getAttribute('data-src')).filter(s => s && /_admin_\/upload/i.test(s) && /\.(png|jpe?g|webp)(\?|$)/i.test(s));
        const ogImage = document.querySelector('meta[property="og:image"]')?.content
          || document.querySelector('meta[name="og:image"]')?.content || null;
        return { text, titulo, descricao, docs, fotos: [...new Set(fotos)], ogImage };
      }).catch(() => null);
      if (!det) continue;
      const row = mapLoteLeilofy(det, id);
      if (row && row.valor_minimo) imoveis.push(row);
    } catch { /* lote a lote; nunca derruba o scrape */ }
    await sleep(300);
  }
  await page.close().catch(() => {});
  console.log(`    Leilofy: ${imoveis.length} imóveis mapeados`);
  return imoveis;
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

  // Modo descoberta da Leiloaria Smart (Leilofy): mapeia a API e encerra.
  if (rodar('LEILOFY_RECON')) {
    console.log('🔎 RECON Leiloaria Smart (Leilofy)...');
    try { await reconLeilofy(browser); } catch (e) { console.error('RECON falhou:', e?.message); }
    if (ONLY.length === 1) { await browser.close(); console.log('\n✅ RECON concluído.'); return; }
  }

  try {
    // 1. Mega Leilões — varre TODAS as páginas (todos os estados), somente ativos
    if (rodar('MEGA')) {
    console.log('📋 Mega Leilões...');
    {
      const imoveis = await scraperMegaLeiloes(browser);
      // Captura os documentos (edital/matrícula/laudo/proposta) da página de detalhe —
      // renderiza JS, então pega o que o on-demand (fetch simples) não vê. Bounded.
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 150 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos Mega falhou (segue sem): ${e.message.slice(0, 80)}`); }
      // USA `salvarEFinalizar` COMO AS OUTRAS 11 FONTES (18/08). Este bloco reimplementava a
      // função inteira — salvar em lotes de 500 + sweep — e por isso ficou para trás quando o
      // gate do sweep foi corrigido para olhar o GRAVADO em vez do COLETADO. Duas cópias da
      // mesma regra divergem no primeiro ajuste, e a que ficou para trás é a que apaga acervo.
      total += await salvarEFinalizar(imoveis, 'MEGA');
      await registrarSaude('MEGA', imoveis, 'principal', validarColeta(imoveis, 'MEGA'));
    }
    }

    // Coleta + salva + registra saúde de uma fonte (validação de qualidade).
    // opts.enrich: roda enriquecerDocumentosLote antes de salvar (captura edital/
    // matrícula/laudo da página do lote — para fontes cujo detalhe é server-rendered).
    const coletarFonte = async (fonte, fn, opts = {}) => {
      const imoveis = (await fn()) || [];
      if (opts.enrich) {
        try { await enriquecerDocumentosLote(browser, imoveis, { cap: opts.enrichCap || 120 }); }
        catch (e) { console.log(`  ⚠️ Enriquecimento de documentos ${fonte} falhou (segue sem): ${e.message.slice(0, 80)}`); }
      }
      total += await salvarEFinalizar(imoveis, fonte);
      await registrarSaude(fonte, imoveis, 'principal', validarColeta(imoveis, fonte));
    };

    // 2. Superbid (portal 2) — API offers, todas as páginas, somente abertos. O
    // detalhe da oferta (/oferta/{id}) é server-rendered com a seção "Documentação"
    // (edital/matrícula/laudo) → enriquecerDocumentosLote os captura (progressivo).
    console.log('\n📋 Superbid...');
    if (rodar('SUPERBID')) await coletarFonte('SUPERBID', () => scraperSuperbidNet(browser, { portalId: '[2]', fonte: 'SUPERBID', leiloeiro: 'Superbid', prefix: 'sbid', baseSite: 'https://www.superbid.net' }), { enrich: true, enrichCap: 150 });

    // 3. Sold (portal 15 — mesma rede Superbid) — API offers, somente abertos.
    console.log('\n📋 Sold Leilões...');
    if (rodar('SOLD')) await coletarFonte('SOLD', () => scraperSuperbidNet(browser, { portalId: '[15]', fonte: 'SOLD', leiloeiro: 'Sold Leilões', prefix: 'sold', baseSite: 'https://www.sold.com.br' }), { enrich: true, enrichCap: 120 });

    // 3b. Sub-portais da rede Superbid (mesma API, portalId diferente). Inventário
    // pequeno mas distinto do portal 2; leiloeiro real vem no campo `store`.
    console.log('\n📋 Rede Superbid — sub-portais 9 e 21...');
    if (rodar('SBID9'))  await coletarFonte('SBID9',  () => scraperSuperbidNet(browser, { portalId: '[9]',  fonte: 'SBID9',  leiloeiro: 'Rede Superbid', prefix: 'sbid9',  baseSite: 'https://www.superbid.net', storeAsLeiloeiro: true }));
    if (rodar('SBID21')) await coletarFonte('SBID21', () => scraperSuperbidNet(browser, { portalId: '[21]', fonte: 'SBID21', leiloeiro: 'Rede Superbid', prefix: 'sbid21', baseSite: 'https://www.superbid.net', storeAsLeiloeiro: true }));

    // 3c. White-labels da rede por LOJA (Round 35 do backlog TRT-15): mesma offer-query,
    // filtro stores.id — Total (65 ofertas no recon) e Crepaldi (0 hoje; fica armado).
    if (rodar('TOTALLEILOES')) await coletarFonte('TOTALLEILOES', () => scraperSuperbidNet(browser, { stores: '16091', fonte: 'TOTALLEILOES', leiloeiro: 'Total Leilões', prefix: 'totall', baseSite: 'https://www.totalleiloes.com.br' }));
    if (rodar('CREPALDI')) await coletarFonte('CREPALDI', () => scraperSuperbidNet(browser, { stores: '16139', fonte: 'CREPALDI', leiloeiro: 'Crepaldi Leilões', prefix: 'crep', baseSite: 'https://www.crepaldileiloes.com.br' }));

    // Leiloaria Smart (Leilofy) — imóveis não-CEF (securitizadoras etc.), DOM parsing.
    console.log('\n📋 Leiloaria Smart (Leilofy)...');
    if (rodar('LEILOFY')) await coletarFonte('LEILOFY', () => scraperLeilofy(browser));

    // 4. PortalZuk (Zukerman) — listagem com scroll infinito, somente ativos.
    // A página de detalhe do lote (link_edital) é server-rendered → enrich vasculha
    // edital/matrícula/laudo para as IAs lerem e para o mapa exato (endereço da matrícula).
    console.log('\n📋 PortalZuk (Zukerman)...');
    if (rodar('ZUK')) await coletarFonte('ZUK', () => scraperPortalZuk(browser), { enrich: true, enrichCap: 120 });

    // 5. Sodré Santoro — API search-lots interceptada, somente ativos. Detalhe do
    // lote (/imoveis/lote/{id}) server-rendered → enrich captura edital/matrícula/laudo.
    console.log('\n📋 Sodré Santoro...');
    if (rodar('SODRE')) await coletarFonte('SODRE', () => scraperSodre(browser), { enrich: true, enrichCap: 120 });

    // 6. Frazão Leilões — server-rendered, lotes por leilão de imóveis. Detalhe
    // server-rendered → enriquecerDocumentosLote captura edital/matrícula/laudo.
    console.log('\n📋 Frazão Leilões...');
    if (rodar('FRAZAO')) try {
      const imoveis = await scraperFrazao(browser);
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 120 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos Frazão falhou (segue sem): ${e.message.slice(0, 80)}`); }
      total += await salvarEFinalizar(imoveis, 'FRAZAO');
      await registrarSaude('FRAZAO', imoveis, 'principal', validarColeta(imoveis, 'FRAZAO'));
    } catch (e) {
      console.log(`  ⚠️ Frazão falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
    }

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

    // 10. Biasi Leilões — server-rendered (crawler HTML c/ paginação por clique).
    // Foto vem do card; edital/matrícula ficam na página /sale/detail (server-rendered)
    // → enriquecerDocumentosLote as vasculha. Blindado: nunca derruba o job.
    console.log('\n📋 Biasi Leilões...');
    if (rodar('BIASI')) try {
      const imoveis = await scraperBiasi(browser);
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 120 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos Biasi falhou (segue sem): ${e.message.slice(0, 80)}`); }
      total += await salvarEFinalizar(imoveis, 'BIASI');
      await registrarSaude('BIASI', imoveis, 'principal', validarColeta(imoveis, 'BIASI'));
    } catch (e) {
      console.log(`  ⚠️ Biasi falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
    }

    // 11. Leilão VIP — server-rendered (agenda → /evento/lotes/{id}). Foto direto do
    // blob Azure; edital/matrícula ficam na página do anúncio → enriquecerDocumentosLote
    // as vasculha. Blindado: nunca derruba o job.
    console.log('\n📋 Leilão VIP...');
    if (rodar('VIP')) try {
      const imoveis = await scraperVIP(browser);
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 120 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos VIP falhou (segue sem): ${e.message.slice(0, 80)}`); }
      total += await salvarEFinalizar(imoveis, 'VIP');
      await registrarSaude('VIP', imoveis, 'principal', validarColeta(imoveis, 'VIP'));
    } catch (e) {
      console.log(`  ⚠️ Leilão VIP falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
    }

    // 12. Leilotech — plataforma white-label (~20 leiloeiros, GraphQL interceptado).
    // Foto vem do coverImageUrl; edital/matrícula ficam na página do lote →
    // enriquecerDocumentosLote vasculha. Blindado: nunca derruba o job.
    console.log('\n📋 Leilotech (plataforma white-label)...');
    if (rodar('LEILOTECH')) try {
      const imoveis = await scraperLeilotech(browser);
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 120 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos Leilotech falhou (segue sem): ${e.message.slice(0, 80)}`); }
      total += await salvarEFinalizar(imoveis, 'LEILOTECH');
      await registrarSaude('LEILOTECH', imoveis, 'principal', validarColeta(imoveis, 'LEILOTECH'));
    } catch (e) {
      console.log(`  ⚠️ Leilotech falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
    }

    // 13. Suporte Leilões — plataforma white-label server-rendered (/buscador).
    // Foto do static.suporteleiloes; edital/matrícula na página do lote →
    // enriquecerDocumentosLote vasculha. Blindado: nunca derruba o job.
    console.log('\n📋 Suporte Leilões (plataforma white-label)...');
    if (rodar('SUPORTE')) try {
      const imoveis = await scraperSuporte(browser);
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 120 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos Suporte falhou (segue sem): ${e.message.slice(0, 80)}`); }
      total += await salvarEFinalizar(imoveis, 'SUPORTE');
      await registrarSaude('SUPORTE', imoveis, 'principal', validarColeta(imoveis, 'SUPORTE'));
    } catch (e) {
      console.log(`  ⚠️ Suporte Leilões falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
    }

    // 14. Grupo Lance — server-rendered (/imoveis). Foto do CDN; edital/matrícula/laudo
    // na página de detalhe (server-rendered) → enriquecerDocumentosLote vasculha.
    // Blindado: nunca derruba o job.
    console.log('\n📋 Grupo Lance...');
    if (rodar('GRUPOLANCE')) try {
      const imoveis = await scraperGrupoLance(browser);
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 150 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos Grupo Lance falhou (segue sem): ${e.message.slice(0, 80)}`); }
      total += await salvarEFinalizar(imoveis, 'GRUPOLANCE');
      await registrarSaude('GRUPOLANCE', imoveis, 'principal', validarColeta(imoveis, 'GRUPOLANCE'));
    } catch (e) {
      console.log(`  ⚠️ Grupo Lance falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
    }

    // 15. WebLeilões — server-rendered (/imoveis, /leiloes). Foto no card; edital/
    // matrícula na página do lote → enriquecerDocumentosLote vasculha. Blindado.
    console.log('\n📋 WebLeilões...');
    if (rodar('WEBLEILOES')) try {
      const imoveis = await scraperWebLeiloes(browser);
      try { await enriquecerDocumentosLote(browser, imoveis, { cap: 120 }); }
      catch (e) { console.log(`  ⚠️ Enriquecimento de documentos WebLeilões falhou (segue sem): ${e.message.slice(0, 80)}`); }
      total += await salvarEFinalizar(imoveis, 'WEBLEILOES');
      await registrarSaude('WEBLEILOES', imoveis, 'principal', validarColeta(imoveis, 'WEBLEILOES'));
    } catch (e) {
      console.log(`  ⚠️ WebLeilões falhou (segue sem derrubar o job): ${String(e.message).slice(0, 120)}`);
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
