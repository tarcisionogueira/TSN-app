#!/usr/bin/env node
/**
 * RECON — primeira leitura dos gaps novos do radar de editais (18/09, pedido do dono:
 * "siga integrando os leiloeiros que vieram pelo radar... faça todos sequencialmente").
 *
 * ZERO PARSER escrito às cegas: antes de qualquer scraper novo, este script só OLHA a
 * home de cada domínio via Bright Data Web Unlocker (mesma porta única, `api/_brightdata.js`
 * — nunca chamada crua fora dela, é o que `brightdata-fora-do-ledger` fiscaliza) e imprime:
 * status HTTP, se bate Cloudflare/challenge, tamanho do HTML, e se há sinal de listagem de
 * imóvel (link /lote, /imovel, preço em R$, JSON embutido). Decide qual dos 3 baldes cada
 * domínio cai: (a) HTML estático simples → scraper por regex/DOM, barato; (b) SPA/JS-only →
 * precisa recon de rede (grampo de fetch/XHR) antes de decidir; (c) Cloudflare bloqueando
 * mesmo via Bright Data → mesmo problema do fernandoleiloeiro/jonasleiloeiro (16/09).
 *
 * Roda no GitHub Actions. Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY,
 * BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 */
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';

const ALVOS = (process.env.RECON_DOMINIOS || 'hastapublica.com.br,joserodovalholeiloes.com.br,hdleiloes.com.br,dilsonmoreira.com.br,lucasleiloeiro.com.br')
  .split(',').map((s) => s.trim()).filter(Boolean);

const RE_CHALLENGE = /just a moment|cf-browser-verification|checking your browser|attention required|cf-chl/i;
const RE_LOTE = /\/(lote|imovel|leilao|imoveis)\//i;
const RE_PRECO = /R\$\s?[\d.,]+/;
const RE_JSON_EMBUTIDO = /<script[^>]*type=["']application\/json["']|__NEXT_DATA__|window\.__INITIAL_STATE__|__NUXT__/i;

async function reconDominio(dominio) {
  const url = `https://${dominio}/`;
  console.log(`\n=== ${dominio} ===`);
  let resp;
  try {
    resp = await buscarViaBrightData(url, { proposito: 'recon', timeoutMs: 45000, exigirOk: false });
  } catch (e) {
    if (e instanceof ErroBrightData) {
      console.log(`  FALHOU (${e.motivo}): ${e.detalhe || e.message}`);
      if (e.semCota) console.log('  ⚠️ sem cota — não é a fonte, é o freio de orçamento.');
      return { dominio, status: 'falhou', motivo: e.motivo };
    }
    console.log(`  erro inesperado: ${e.message}`);
    return { dominio, status: 'erro', motivo: e.message };
  }
  const status = resp.status;
  const html = await resp.text().catch(() => '');
  const tam = html.length;
  const challenge = RE_CHALLENGE.test(html);
  const temLote = RE_LOTE.test(html);
  const temPreco = RE_PRECO.test(html);
  const temJson = RE_JSON_EMBUTIDO.test(html);
  console.log(`  HTTP ${status} · ${tam} bytes · challenge=${challenge} · link_lote=${temLote} · preco=${temPreco} · json_embutido=${temJson}`);
  if (status >= 200 && status < 300 && !challenge && tam > 500) {
    const amostraLinks = [...html.matchAll(/href=["']([^"']*(?:lote|imovel|leilao)[^"']*)["']/gi)].slice(0, 5).map((m) => m[1]);
    if (amostraLinks.length) console.log(`  amostra de links: ${JSON.stringify(amostraLinks)}`);
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    if (titleMatch) console.log(`  title: ${titleMatch[1].slice(0, 120)}`);
  }
  let veredito = 'indefinido';
  if (challenge) veredito = 'cloudflare_bloqueado';
  else if (status >= 400) veredito = `http_${status}`;
  else if (temLote || temPreco) veredito = temJson ? 'spa_com_dados_embutidos' : 'html_estatico_com_listagem';
  else if (tam < 3000) veredito = 'suspeito_de_spa_vazio';
  else veredito = 'sem_sinal_de_listagem_na_home';
  console.log(`  VEREDITO: ${veredito}`);
  return { dominio, status, tam, challenge, temLote, temPreco, temJson, veredito };
}

(async () => {
  console.log('=== RECON RADAR GAPS — primeira leitura via Bright Data ===');
  const resultados = [];
  for (const d of ALVOS) {
    resultados.push(await reconDominio(d));
  }
  console.log('\n══════════════════ RESUMO ══════════════════');
  for (const r of resultados) console.log(`  ${r.dominio}: ${r.veredito || r.status}`);
  console.log('══════════════════════════════════════════');
})();
