/**
 * Scraper Portal Bayit (portalbayit.com.br) — via Bright Data Web Unlocker.
 * ────────────────────────────────────────────────────────────────────────────
 * Recon (09/09, 3 rodadas — leiloeiro_conhecimento.fonte='BAYIT' tem o achado completo)
 * mostrou que a NAVEGAÇÃO do site (busca/AJAX com hash de rota) fica atrás de Cloudflare
 * e só monta a grade de lotes via JS (Ajax_Leiloes.js) — inútil pra fetch cru, mesmo via
 * Bright Data. Mas o site também publica um FEED XML completo em /sitemap.xml, no formato
 * Facebook/Google "Dynamic Ads for Real Estate" (<listings><listing>...), que dá a
 * enumeração INTEIRA sem precisar da navegação bloqueada — é essa a porta usada aqui.
 *
 * O feed NÃO tem matrícula/edital (schema de anúncio genérico, não de leilão). Pra isso,
 * visita a página do LOTE (campo <url> de cada <listing>, já pronta) via Bright Data e
 * usa o scanner compartilhado `vasculharDocumentos` (api/_doc-scan.js) — o mesmo que
 * `enriquecer-lote.js` usa sob demanda.
 *
 * FILTRO DE CATEGORIA (o feed mistura imóvel com outros bens — um veículo apareceu no
 * recon com property_type=other, igual a itens que SÃO imóvel). O sinal mais confiável
 * não é property_type (não discrimina), é a própria URL do lote: todo imóvel real visto
 * no recon tem a forma /lote/<cidade>-<uf>/<id>/ com UF brasileira válida; o veículo tinha
 * /lote/ford/647/ — sem esse padrão. Filtra ANTES de gastar Bright Data na página de detalhe.
 *
 * PLANO REGISTRADO (09/09, pedido do dono): esta 1ª versão é 100% Bright Data (pago). Para
 * amanhã: testar se o runner RESIDENCIAL (Chromium em IP de casa, grátis — mesmo padrão de
 * GESTAO_HEADLESS em scraper-gestao.mjs/fetch-residencial.mjs) também passa do Cloudflare
 * aqui. Se passar, migra pra lá e este arquivo para de gastar cota paga.
 *
 * SEGURANÇA DE CUSTO: proposito 'bayit' tem sub-cota própria em brightdata_reserva (teto
 * 100/semana) — não compete pelo orçamento geral compartilhado com CALIL/VEGAS/GESTAO.
 *   - BAYIT_ENRICH_CAP (default 200): teto de páginas de detalhe visitadas/execução.
 *     Catálogo é pequeno (~84 <listing> em 09/09) — o default cobre o acervo inteiro numa
 *     rodada só. Numa cron recorrente futura, considerar baixar (só quem falta doc).
 *   - BAYIT_DRYRUN (default '1'): NÃO grava — parseia e loga o que inseriria.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';
import { vasculharDocumentos } from '../api/_doc-scan.js';
import { decodificarEntidades, extrairAreaM2 } from '../api/_texto-imovel.js';
import { checarQualidade } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte fica INVISÍVEL ao bug bounty (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';

const BASE = 'https://www.portalbayit.com.br';
const DRYRUN = process.env.BAYIT_DRYRUN !== '0';
const ENRICH_CAP = Number(process.env.BAYIT_ENRICH_CAP || 200);
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

const UFS_BR = new Set(['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG',
  'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO']);

// O freio de custo agiu em ALGUM fetch desta execução? Mesmo padrão de scraper-gestao.mjs —
// separa "a fonte mudou" de "eu não fui olhar" na hora de gravar fonte_saude.
let semCotaVisto = false;

async function bd(url, { timeoutMs = 45000 } = {}) {
  try {
    const r = await buscarViaBrightData(url, { proposito: 'bayit', timeoutMs, exigirOk: false });
    if (!r || !r.ok) return null;
    return await r.text();
  } catch (e) {
    if (!(e instanceof ErroBrightData)) throw e; // erro de verdade não vira "página vazia"
    if (e.semCota) semCotaVisto = true;
    console.error(`  [bd] ${url}: ${e.message}`);
    return null;
  }
}

function campo(bloco, tag) {
  const m = bloco.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? decodificarEntidades(m[1]).trim() || null : null;
}
function componente(bloco, nome) {
  const m = bloco.match(new RegExp(`<component\\s+name=["']${nome}["'][^>]*>([\\s\\S]*?)<\\/component>`, 'i'));
  return m ? decodificarEntidades(m[1]).trim() || null : null;
}
// "326542,97 BRL" → 326542.97 (pt-BR: ponto de milhar, vírgula decimal).
function precoTexto(s) {
  if (!s) return 0;
  const n = String(s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return parseFloat(n) || 0;
}
// "rate" do feed vem como INTEIRO em centavos, sem separador: "32654297 BRL" = R$ 326.542,97.
function rateTexto(s) {
  if (!s) return 0;
  const n = parseInt(String(s).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n / 100 : 0;
}

function parseFeed(xml) {
  const blocos = xml.match(/<listing>[\s\S]*?<\/listing>/gi) || [];
  return blocos.map((bloco) => {
    const pracas = [...bloco.matchAll(/<available_dates_price_config>([\s\S]*?)<\/available_dates_price_config>/gi)]
      .map((m) => ({ startDate: campo(m[1], 'start_date'), rate: rateTexto(campo(m[1], 'rate')) }));
    const fotos = [...bloco.matchAll(/<image>\s*<url>([\s\S]*?)<\/url>\s*<\/image>/gi)]
      .map((m) => decodificarEntidades(m[1]).trim()).filter(Boolean);
    return {
      id: campo(bloco, 'home_listing_id'),
      nome: campo(bloco, 'name'),
      availability: campo(bloco, 'availability'),
      addr1: componente(bloco, 'addr1'),
      cep: componente(bloco, 'postal_code'),
      lat: campo(bloco, 'latitude'),
      lon: campo(bloco, 'longitude'),
      bairro: campo(bloco, 'neighborhood'),
      price: precoTexto(campo(bloco, 'price')),
      url: campo(bloco, 'url'),
      fotos,
      pracas,
    };
  });
}

// Ver cabeçalho do arquivo: é o filtro real de "isto é imóvel?" — mais confiável que
// property_type (que não discrimina veículo de imóvel no feed do Bayit).
function slugCidadeUf(url) {
  const m = String(url || '').match(/\/lote\/([a-z0-9]+(?:-[a-z0-9]+)*)-([a-z]{2})\/\d+\/?$/i);
  if (!m) return null;
  const uf = m[2].toUpperCase();
  if (!UFS_BR.has(uf)) return null;
  const cidade = m[1].split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { cidade, uf };
}

function inferirTipo(txt = '') {
  const t = txt.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio|unidade aut/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc|condom[íi]nio/.test(t)) return 'casa';
  if (/terreno|gleba|data de terra|v[áa]rzea|fazenda|s[íi]tio|ch[áa]cara|rural/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio|barrac/.test(t)) return 'comercial';
  return 'outros';
}

async function enriquecerDetalhe(urlLote, fotoAtual) {
  const html = await bd(urlLote);
  if (!html) return {};
  const docs = vasculharDocumentos(html, urlLote, fotoAtual);
  const txt = decodificarEntidades(
    html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ');
  // Modalidade: só a página de detalhe diz — o feed não tem esse campo. Mesmo fallback de
  // scraper-gestao.mjs (extrajudicial quando ambíguo).
  const modalidade = /venda\s*direta/i.test(txt) ? 'venda_direta'
    : /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : 'extrajudicial';
  const numeroMatricula = (txt.match(/matr[íi]cula[:\s]*n?[ºo°.]?\s*(\d[\d.\-\/]{2,})/i) || [])[1] || null;
  return {
    link_matricula: docs.matricula,
    link_edital: docs.edital,
    link_regras_venda: docs.regras,
    anexos: docs.anexos.length ? docs.anexos : null,
    link_foto: docs.foto || fotoAtual || null,
    modalidade,
    area_m2: extrairAreaM2(txt) || 0,
    numero_matricula: numeroMatricula,
  };
}

async function main() {
  console.log(`BAYIT ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · cap enriquecimento ${ENRICH_CAP}`);

  const feedXml = await bd(`${BASE}/sitemap.xml`);
  if (!feedXml) {
    await registrarSaude(supabase, 'BAYIT', [], 'feed_xml', {
      ok: false, semCota: semCotaVisto,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
      motivo: semCotaVisto ? 'SEM COTA Bright Data — feed não buscado' : 'feed /sitemap.xml não veio (rede/HTTP)',
    });
    console.error('feed não veio. Saindo com erro.');
    process.exitCode = 1;
    return;
  }

  const itens = parseFeed(feedXml);
  console.log(`Feed: ${itens.length} <listing> no total.`);

  const candidatos = itens.filter((it) => it.availability === 'for_sale' && !!slugCidadeUf(it.url));
  console.log(`${candidatos.length} candidato(s) a imóvel (for_sale + URL cidade-UF válida); `
    + `${itens.length - candidatos.length} descartado(s) na enumeração (não-imóvel ou indisponível).`);

  const rows = [];
  let enriquecidos = 0;
  for (const it of candidatos) {
    const su = slugCidadeUf(it.url);
    const ratesPositivos = it.pracas.map((p) => p.rate).filter((v) => v > 0);
    const valorAval = it.price || (ratesPositivos.length ? Math.max(...ratesPositivos) : 0);
    const valorMinimo = ratesPositivos.length ? Math.min(...ratesPositivos) : valorAval;
    const dataLeilao = it.pracas[0]?.startDate ? it.pracas[0].startDate.slice(0, 10) : null;
    const temDesconto = valorAval > 0 && valorMinimo > 0 && valorMinimo <= valorAval;

    let row = {
      fonte: 'BAYIT',
      fonte_id: `bayit_${it.id}`,
      titulo: (it.nome || `Imóvel Portal Bayit ${it.id}`).slice(0, 180),
      tipo: inferirTipo(it.nome || ''),
      modalidade: 'extrajudicial', // default; enriquecerDetalhe() ajusta com o texto real do lote
      estado: su.uf,
      cidade: su.cidade,
      bairro: it.bairro || null,
      endereco: it.addr1 || null,
      valor_avaliacao: valorAval,
      valor_minimo: valorMinimo,
      area_m2: 0,
      descricao: null,
      numero_matricula: null,
      link_edital: null,
      link_matricula: null,
      anexos: null,
      url_lote: it.url,
      link_foto: it.fotos[0] || null,
      leiloeiro: 'Portal Bayit',
      data_leilao: dataLeilao,
      forma_pagamento: 'a_vista',
      ativo: true,
      latitude: it.lat ? Number(it.lat) : null,
      longitude: it.lon ? Number(it.lon) : null,
      cep: it.cep || null,
      viavel: temDesconto ? (1 - valorMinimo / valorAval) >= 0.3 : null,
      score_viabilidade: temDesconto ? Math.min(100, Math.round((1 - valorMinimo / valorAval) * 150)) : 30,
      desconto_percentual: temDesconto ? Math.round((1 - valorMinimo / valorAval) * 100) : null,
      atualizado_em: new Date().toISOString(),
    };

    if (enriquecidos < ENRICH_CAP) {
      enriquecidos++;
      const det = await enriquecerDetalhe(it.url, row.link_foto);
      row = { ...row, ...Object.fromEntries(Object.entries(det).filter(([, v]) => v != null)) };
      await sleep(400);
    }
    rows.push(row);
  }

  const prontos = rows.filter((r) => !checarQualidade(r, { estrito: false }).descartar);
  console.log(`${rows.length} candidato(s) montado(s) · ${prontos.length} passam na qualidade · `
    + `${enriquecidos} página(s) de detalhe visitada(s).`);

  // Zero pronto não é "a fonte está vazia" — é coleta quebrada até prova em contrário
  // (mesmo princípio de todos os coletores do repo, ver scraper-gestao.mjs).
  if (!prontos.length) {
    await registrarSaude(supabase, 'BAYIT', [], 'feed_xml', {
      ok: false, semCota: semCotaVisto,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
      motivo: semCotaVisto ? 'SEM COTA Bright Data — enriquecimento não tentado' : `nada pronto (${rows.length} candidatos brutos)`,
    });
    console.error('nada a gravar. Saindo com erro para não carimbar coleta que não coletou.');
    process.exitCode = 1;
    return;
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log('\nPara gravar, rode com BAYIT_DRYRUN=0.');
    return;
  }

  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${prontos.length} imóveis do Portal Bayit gravados/atualizados.`);

  // SAÚDE DA FONTE: entra no monitor de regressão junto das demais desde o 1º dia.
  await registrarSaude(supabase, 'BAYIT', prontos, 'feed_xml', semCotaVisto ? { semCota: true } : undefined);
  await registrarConhecimento(supabase, {
    fonte: 'BAYIT',
    plataforma: 'Motor próprio (jQuery/AJAX, Cloudflare) + feed XML Dynamic-Ads-for-Real-Estate em /sitemap.xml',
    acesso: 'brightdata', custo: 'pago',
    anti_bot: 'cloudflare (navegação); feed XML acessível via Web Unlocker sem bloqueio real',
    enumeracao: '/sitemap.xml (feed XML)', url_lote: '<url> de cada <listing> do feed',
    scraper: 'scraper-bayit.mjs', qualidade: qualidadeColeta(prontos),
  });
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => { console.error(e); process.exit(1); });
