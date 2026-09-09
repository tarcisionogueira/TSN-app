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
 * FOTO — ACHADO AO VIVO (09/09): teste de hotlink puro (sem Bright Data, sem Referer —
 * exatamente o que o <img> do nosso front faz) devolveu HTTP 403. O Cloudflare do Bayit
 * bloqueia o CDN de imagem, não só a navegação — o link cru do feed NÃO carrega pro
 * visitante. Decisão (dono: "resolva da forma mais eficiente e segura"): re-hospeda só a
 * CAPA (link_foto — é a única foto que qualquer tela hoje exibe) no bucket `imoveis-fotos`,
 * mesmo padrão já usado pra CEF (garantirFotoCapa). A GALERIA completa (`fotos`) continua
 * como link externo, sem re-hospedar — não existe UI de galeria ainda pra exibi-la, então
 * pagar Bright Data por foto que ninguém vê é gasto especulativo; a lista fica pronta pra
 * quando a galeria for construída (reusa garantirFotoCapa nela também).
 *
 * SEGURANÇA DE CUSTO: proposito 'bayit' tem sub-cota própria em brightdata_reserva (teto
 * 200/semana, subiu de 100 — o backfill de hoje sozinho consome ~80 só de detalhe +
 * ~80 de capa). Não compete pelo orçamento geral compartilhado com CALIL/VEGAS/GESTAO.
 *   - BAYIT_ENRICH_CAP (default 200): teto de páginas de detalhe visitadas/execução.
 *     Catálogo é pequeno (~84 <listing> em 09/09) — o default cobre o acervo inteiro numa
 *     rodada só. Numa cron recorrente futura, considerar baixar (só quem falta doc).
 *   - garantirFotoCapa() checa o bucket ANTES de gastar Bright Data — listing já
 *     re-hospedado (mesmo fonte_id) não paga de novo em rodadas futuras.
 *   - BAYIT_DRYRUN (default '1'): NÃO grava — parseia e loga o que inseriria (não
 *     re-hospeda foto em dry-run, mesmo motivo de não gastar cota à toa do scraper-gestao.mjs).
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
const BUCKET_FOTOS = 'imoveis-fotos';
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

// Binário (foto) — mesmo caminho pago do bd(), mas sem forçar .text() (corromperia o JPEG).
async function bdBinario(url, { timeoutMs = 45000 } = {}) {
  try {
    const r = await buscarViaBrightData(url, { proposito: 'bayit', timeoutMs, exigirOk: false });
    if (!r || !r.ok) return null;
    return { buffer: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') || null };
  } catch (e) {
    if (!(e instanceof ErroBrightData)) throw e;
    if (e.semCota) semCotaVisto = true;
    console.error(`  [bd-foto] ${url}: ${e.message}`);
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
    // <image><url>...</url></image> (foto) usa a MESMA tag <url> do lote — sem remover os
    // blocos de imagem antes, campo(bloco,'url') pega a 1ª ocorrência (a foto), não a
    // página do lote. Achado ao vivo: 84/84 listings zerados no filtro de categoria porque
    // "url" nunca batia com /lote/<cidade>-<uf>/<id>/ — era sempre um link de .jpg.
    const blocoSemFotos = bloco.replace(/<image>[\s\S]*?<\/image>/gi, '');
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
      url: campo(blocoSemFotos, 'url'),
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

function extensaoDaUrl(url) {
  const m = String(url || '').match(/\.(jpe?g|png|webp)(?:[?#]|$)/i);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
}

// Re-hospeda a CAPA no bucket imoveis-fotos (mesmo padrão de scripts/foto-cef.mjs) — o
// hotlink cru devolve 403 (Cloudflare protege o CDN de imagem do Bayit, não só a
// navegação; confirmado ao vivo em 09/09). `existentes` é o Set de paths já no bucket
// (listado 1x no início do run, de graça) — listing já re-hospedado não paga Bright Data
// de novo. Falha em qualquer etapa cai pro link externo original (best-effort: nunca some
// a foto por causa de um erro de upload; só fica sujeita ao mesmo 403 de antes).
async function garantirFotoCapa(fotoUrl, fonteId, existentes) {
  if (!fotoUrl) return fotoUrl;
  const path = `bayit/${fonteId}.${extensaoDaUrl(fotoUrl)}`;
  if (existentes.has(path)) {
    return supabase.storage.from(BUCKET_FOTOS).getPublicUrl(path).data.publicUrl;
  }
  const baixado = await bdBinario(fotoUrl);
  if (!baixado || baixado.buffer.length < 500) return fotoUrl;
  const { error } = await supabase.storage.from(BUCKET_FOTOS).upload(path, baixado.buffer, {
    contentType: baixado.contentType || `image/${extensaoDaUrl(fotoUrl) === 'jpg' ? 'jpeg' : extensaoDaUrl(fotoUrl)}`,
    upsert: true,
  });
  if (error) { console.error(`  [foto] upload ${path} falhou: ${error.message}`); return fotoUrl; }
  existentes.add(path);
  return supabase.storage.from(BUCKET_FOTOS).getPublicUrl(path).data.publicUrl;
}

// O site monta alguns links de "Baixar Boleto/Depósito Comissão" com template TrimPath
// client-side (${rowLancamento.ID_Financeiro_Lancamento}, {if ...}{else}...{/if}) — como só
// buscamos o HTML cru (sem executar o JS que resolve o template), esses "documentos" são
// URL/rótulo LITERAIS do template, nunca resolvidos: um clique bateria em ".../$%7BrowLanc
// amento.ID_Financeiro_Lancamento%7D", 404 garantido. Achado ao vivo no 1º dry-run real —
// aparecia em TODOS os lotes testados. Descarta antes de gravar (mesmo espírito do filtro
// de ruído institucional que RE_DOC_INSTITUCIONAL já aplica em api/_doc-scan.js, só que
// aqui o ruído é sintático — template não resolvido — não temático).
const RE_TEMPLATE_NAO_RESOLVIDO = /\{if\b|\{else\}?|\{\/if\}|\$\{|%7[Bb]/i;
function eDocumentoDeVerdade(a) {
  return !RE_TEMPLATE_NAO_RESOLVIDO.test(a.url || '') && !RE_TEMPLATE_NAO_RESOLVIDO.test(a.nome || '');
}

async function enriquecerDetalhe(urlLote, fotoAtual) {
  const html = await bd(urlLote);
  if (!html) return {};
  const docs = vasculharDocumentos(html, urlLote, fotoAtual);
  docs.anexos = docs.anexos.filter(eDocumentoDeVerdade);
  if (docs.matricula && RE_TEMPLATE_NAO_RESOLVIDO.test(docs.matricula)) docs.matricula = null;
  if (docs.edital && RE_TEMPLATE_NAO_RESOLVIDO.test(docs.edital)) docs.edital = null;
  if (docs.regras && RE_TEMPLATE_NAO_RESOLVIDO.test(docs.regras)) docs.regras = null;
  if (docs.laudo && RE_TEMPLATE_NAO_RESOLVIDO.test(docs.laudo)) docs.laudo = null;
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

  // Listagem do bucket é de graça (Storage, não Bright Data) — feita 1x aqui pra
  // garantirFotoCapa() não pagar de novo por capa já re-hospedada em rodada anterior.
  const fotosExistentes = new Set();
  if (!DRYRUN) {
    try {
      const { data, error } = await supabase.storage.from(BUCKET_FOTOS).list('bayit', { limit: 1000 });
      if (!error) for (const f of data || []) fotosExistentes.add(`bayit/${f.name}`);
    } catch { /* segue sem cache — pior caso é re-hospedar o que já existia */ }
  }

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

  // DIAGNÓSTICO (09/09, pedido do dono): a foto é link externo direto — carrega no NAVEGADOR
  // do cliente, não passa pelo Bright Data. Cloudflare bloqueia a NAVEGAÇÃO do site (HTML);
  // não sabíamos se também bloqueia o CDN de imagem. fetch() PURO (sem Bright Data, sem
  // Referer do próprio Bayit) simula exatamente o que o <img> do nosso front faz.
  const fotoTeste = itens.find((it) => it.fotos?.[0])?.fotos?.[0];
  if (fotoTeste) {
    try {
      const r = await fetch(fotoTeste, { method: 'GET', signal: AbortSignal.timeout(15000) });
      console.log(`🖼️  Teste de hotlink (sem Bright Data, sem Referer) em ${fotoTeste}: `
        + `HTTP ${r.status} · content-type ${r.headers.get('content-type') || '?'}`);
    } catch (e) {
      console.log(`🖼️  Teste de hotlink falhou: ${String(e.message).slice(0, 120)}`);
    }
  }

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
      // Galeria completa (não só a capa) — fica como link externo (não re-hospedada; só a
      // capa é, ver garantirFotoCapa abaixo). Sem UI de galeria ainda pra exibir mais de 1
      // foto — re-hospedar a galeria inteira hoje seria gasto especulativo. Pedido do
      // dono, 09/09.
      fotos: it.fotos.length ? it.fotos : null,
      leiloeiro: 'Portal Bayit',
      data_leilao: dataLeilao,
      forma_pagamento: 'a_vista',
      ativo: true,
      latitude: it.lat ? Number(it.lat) : null,
      longitude: it.lon ? Number(it.lon) : null,
      // cep é varchar(8) no banco (mesmo padrão dos outros coletores: só dígitos, sem
      // hífen) — o feed vem formatado "67110-470" (9 chars), que estourava a coluna e
      // derrubava o upsert inteiro (achado ao vivo: "value too long for type varchar(8)").
      cep: it.cep ? it.cep.replace(/\D/g, '').slice(0, 8) || null : null,
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
    // Re-hospeda a CAPA (não em DRY-RUN — ver cabeçalho do arquivo: não gasta Bright Data
    // com foto de uma linha que não vai nem ser gravada).
    if (!DRYRUN) row.link_foto = await garantirFotoCapa(row.link_foto, row.fonte_id, fotosExistentes);
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
