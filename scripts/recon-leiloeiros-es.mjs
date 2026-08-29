import { fetchUnlockerContado } from './lib/bd-ledger.mjs';
/**
 * RECON dos leiloeiros do ES (lista pública JUCEES, 21/08) — roda em PRODUÇÃO (tem Bright Data).
 *
 * POR QUE em produção: a rede do ambiente de dev bloqueia CONNECT a host externo (403 no proxy),
 * então a detecção de plataforma e a contagem de lotes só dá para fazer daqui, com Bright Data.
 *
 * O QUE RESPONDE, por site (as DUAS perguntas do dono):
 *   1. Roda uma PLATAFORMA que já suportamos? Se sim, o leiloeiro pode ser REGISTRADO já — quando
 *      ele listar imóvel, o scraper existente puxa sozinho (custo ~zero). O mapa plataforma→scraper
 *      está em `PLATAFORMAS` abaixo (espelha leiloeiro_conhecimento).
 *   2. "0 leilão" é AGORA ou NUNCA? Além das rotas de imóvel ATIVO, sonda rotas de
 *      ENCERRADOS/REALIZADOS. Ativo=0 mas encerrados>0 → TEM histórico: vale registrar (o dono:
 *      "quando houver imóveis o sistema puxa"). Ativo=0 e encerrados=0 → sem rastro, pular.
 *
 * NÃO grava nada — é leitura. Prioriza SUEDPETER (21 leilões no histórico JUCEES, o único
 * não-integrado com atividade). Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE.
 *
 * Uso:
 *   BRIGHTDATA_API_TOKEN=… BRIGHTDATA_ZONE=… node scripts/recon-leiloeiros-es.mjs
 *   PROBE_DOMS=suedpeterleiloes.com.br node scripts/recon-leiloeiros-es.mjs   # só um
 */
const TOKEN = process.env.BRIGHTDATA_API_TOKEN;
const ZONE = process.env.BRIGHTDATA_ZONE;
if (!TOKEN || !ZONE) { console.log('⚠️ BRIGHTDATA_API_TOKEN/ZONE ausentes — este recon roda em produção.'); process.exit(1); }

// Hostname COMPLETO (TLDs variam: .com.br, .lel.br, .leilao.br). Prioridade decrescente de
// atividade no histórico JUCEES: Sued Peter (21) primeiro; os demais têm 0 e a sonda de
// encerrados diz se é "0 agora" ou "0 mesmo".
const DOMS_PADRAO = [
  'suedpeterleiloes.com.br',      // Sued Peter — 21 leilões (PRIORIDADE)
  'vixleiloes.com.br',            // Gabriel Fardin Pereira
  'esleiloes.com.br',             // Sérgio de Paula Pereira
  'leilofacil.lel.br',            // Mauro Cesar Rocha / Flávia Rocha
  'colodeteleiloes.com.br',       // Mauro Colodete
  'emleilao.com.br',              // Ayrton de Souza Porto Filho
  'renannerisleiloeiro.com.br',   // Renan Neris
  'portoleiloes.com.br',          // Brenno de Figueiredo Porto
  'gbleiloes.com.br',             // Gustavo Bolzan
  'hoppeleiloes.com.br',          // Alex Willian Hoppe
  'maleiloesro.com.br',           // Marcus Allain (RO)
  'ruamgotardoleiloes.com.br',    // Ruam Gotardo
  'gustavomorettoleiloeiro.com.br',// Gustavo Moretto
  'danielgarcialeiloes.com.br',   // Daniel Garcia
  'lubreleiloes.leilao.br',       // Luiz Roberto Brenneken
];
const DOMS = (process.env.PROBE_DOMS || DOMS_PADRAO.join(',')).split(',').map(s => s.trim()).filter(Boolean);

// Rotas de imóvel ATIVO e de ENCERRADOS/REALIZADOS (a sonda de histórico).
const ROTAS_ATIVO = ['/', '/imoveis', '/leiloes', '/leiloes/imoveis', '/busca?tipo=imovel', '/categoria/imoveis', '/lotes', '/bens/imoveis'];
const ROTAS_HIST = ['/encerrados', '/leiloes/encerrados', '/leiloes-encerrados', '/realizados', '/leiloes?status=encerrado'];

// PLATAFORMA → scraper que já temos (espelha leiloeiro_conhecimento). Assinatura no HTML cru.
const PLATAFORMAS = [
  { nome: 'SUPERBID/MBV', scraper: 'scraper-emiliomatos.mjs / scraper-puppeteer(SUPERBID)', re: /superbid|mbv-|mbvsystem|\/mbv\//i },
  { nome: 'SOLEON',       scraper: 'scraper-soleon.mjs', re: /soleon/i },
  { nome: 'ZUKERMAN',     scraper: 'scraper-puppeteer(ZUK)', re: /zukerman|portalzuk/i },
  { nome: 'LEILAOPRO',    scraper: 'scraper-leilaopro.mjs', re: /artisticweb|leilaopro|leilao-?pro|leilaodetran/i },
  { nome: 'SATO/QUASAR',  scraper: 'scraper-sato.mjs', re: /quasar|q-app|window\.__sato/i },
  { nome: 'GESTAOLEILOES',scraper: 'scraper-gestao.mjs', re: /gestaodeleiloes|lote\.php\?idlote/i },
  { nome: 'SODRE',        scraper: 'scraper-puppeteer(SODRE)', re: /sodresantoro|sodre-santoro|search-lots/i },
];
// Frameworks genéricos (não mapeiam scraper direto, mas dizem o custo de raspar).
const FRAMEWORKS = [
  ['Next.js', /__NEXT_DATA__|\/_next\//], ['WordPress', /wp-content|wp-json|wpcasa/],
  ['Nuxt', /__NUXT__|_nuxt\//], ['Laravel/Livewire', /livewire|csrf-token/],
  ['Vue', /data-v-|v-app/], ['Angular', /ng-version/], ['ASP.NET', /__VIEWSTATE|asp\.net/i],
];

async function bdFetch(url, timeoutMs = 45000) {
  try {
    const r = await fetchUnlockerContado({
      method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ zone: ZONE, url, format: 'raw' }), signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: r.status, body: await r.text().catch(() => '') };
  } catch (e) { return { status: 0, body: '', err: String(e.message || e) }; }
}
const reais = (h) => (h.match(/R\$\s?[\d.]+,\d{2}/g) || []).length;
const hrefLote = (h) => [...new Set([...h.matchAll(/href=["']([^"']*(?:lote|imovel|leilao\/[^"']*\/)[^"']*)["']/gi)].map(m => m[1]))].slice(0, 3);
function plataformaDe(h) {
  for (const p of PLATAFORMAS) if (p.re.test(h)) return p;
  const fw = FRAMEWORKS.filter(([, re]) => re.test(h)).map(([n]) => n);
  return { nome: fw.join(',') || 'genérico/SSR', scraper: null };
}

(async () => {
  const resumo = [];
  for (const dom of DOMS) {
    console.log(`\n╔══════ ${dom} ══════╗`);
    let ativo = null, plataforma = null, statusHome = null;
    for (const rota of ROTAS_ATIVO) {
      const url = `https://www.${dom}${rota}`.replace('://www.www.', '://www.');
      const r = await bdFetch(url);
      if (rota === '/') statusHome = r.status;
      if (r.status !== 200 || !r.body) { console.log(`  ${rota} → HTTP ${r.status}${r.err ? ' ' + r.err : ''}`); continue; }
      const rs = reais(r.body); const p = plataformaDe(r.body);
      if (!plataforma || p.scraper) plataforma = p; // prefere plataforma mapeada
      console.log(`  ${rota} → 200 · ${r.body.length}b · R$=${rs} · [${p.nome}]${hrefLote(r.body).length ? ' · ' + JSON.stringify(hrefLote(r.body)) : ''}`);
      if (!ativo || rs > ativo.reais) ativo = { rota, reais: rs };
    }
    // Sonda de HISTÓRICO só se o ativo veio fraco (economiza requisições Bright Data).
    let histReais = 0;
    if (!ativo || ativo.reais < 3) {
      for (const rota of ROTAS_HIST) {
        const r = await bdFetch(`https://www.${dom}${rota}`);
        if (r.status === 200 && r.body) { const rs = reais(r.body); histReais = Math.max(histReais, rs); if (rs > 0) { console.log(`  [hist] ${rota} → R$=${rs}`); break; } }
      }
    }
    const at = ativo?.reais || 0;
    const veredito =
      at >= 5 ? '✅ TEM imóvel agora — integrar'
      : plataforma?.scraper ? `🟢 plataforma SUPORTADA (${plataforma.scraper}) — registrar; puxa sozinho quando listar`
      : histReais > 0 ? '🟡 0 agora, MAS tem histórico (encerrados) — registrar como candidato'
      : statusHome === 200 ? '⚪ site no ar, sem lotes e sem histórico visível — aguardar'
      : '❌ inacessível/sem site';
    console.log(`  → PLATAFORMA=[${plataforma?.nome || '?'}] ativo(R$)=${at} hist(R$)=${histReais} ${veredito}`);
    resumo.push({ dom, plataforma: plataforma?.nome || '?', scraper: plataforma?.scraper || null, ativo: at, hist: histReais, veredito });
  }
  console.log('\n════════ RESUMO ════════');
  for (const r of resumo) console.log(`  ${r.dom.padEnd(34)} [${r.plataforma}] ativo=${r.ativo} hist=${r.hist}  ${r.veredito}`);
  console.log('\nRegra do dono: plataforma suportada OU histórico>0 → registrar (o sistema puxa quando houver imóvel). Sem nada → aguardar.');
})();
