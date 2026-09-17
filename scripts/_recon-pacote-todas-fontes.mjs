// TEMPORÁRIO — varredura em TODAS as fontes `dom` restantes (exceto ALBERTOMACEDOLEILOES, já
// corrigido, e HASTA/NORDESTE, que já têm nível 2) procurando o MESMO padrão: página de catálogo
// que na verdade é um PACOTE/grupo com vários imóveis, cada um numa sub-URL própria que o
// `extrairUrlsDeLote` atual não descobre. Pedido do dono (17/09) depois do achado do
// Albertomacedo: "é comum pacote ou grupo com vários lotes dentro".
//
// MÉTODO (sem gravar nada, sem Bright Data — semBD:true, custo zero):
//   1. `enumerar()` do motor (já usa o extrairUrlsDeLote/extrairUrlsDeEvento de CADA fonte,
//      sem mudança nenhuma) — pega até N URLs do catálogo real de cada tenant.
//   2. Busca o DETALHE de uma amostra (até AMOSTRA por tenant) e roda `parseDetalhe` +
//      `checarQualidade` de CADA fonte (o parser de verdade, não uma heurística solta).
//   3. Quando `checarQualidade` descarta por FALTA DE VALOR (o mesmo motivo que escondia o
//      pacote do Albertomacedo), procura no HTML links internos que pareçam sub-item (contêm
//      lote/item/imovel/oferta) e SÃO DIFERENTES da própria URL — 2+ desses é sinal forte de
//      pacote. Também conta ocorrências de "N lotes"/"N imóveis" no texto (o pacote do
//      Albertomacedo dizia literalmente "2 lotes encontrados").
import { enumerar } from './lib/motor/runner.mjs';
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { criarMotorFetch } from './lib/motor/fetch-fonte.mjs';

import cfgAlfa from './lib/motor/fontes/alfaleiloes.mjs';
import cfgEmiliomatos from './lib/motor/fontes/emiliomatos.mjs';
import cfgJeleiloes from './lib/motor/fontes/jeleiloes.mjs';
import cfgLeilaoindex from './lib/motor/fontes/leilaoindex.mjs';
import cfgLeilaopro from './lib/motor/fontes/leilaopro.mjs';
import cfgLeje from './lib/motor/fontes/leje.mjs';
import cfgRocha from './lib/motor/fontes/rocha.mjs';
import cfgSimon from './lib/motor/fontes/simon.mjs';
import cfgGlobo from './lib/motor/fontes/globo.mjs';

const AMOSTRA = Number(process.env.RECON_AMOSTRA || 8);
const FONTES = [cfgAlfa, cfgEmiliomatos, cfgJeleiloes, cfgLeilaoindex, cfgLeilaopro, cfgLeje, cfgRocha, cfgSimon, cfgGlobo];

const textoDe = (html) => String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function linksSuspeitos(html, url, base) {
  const out = new Set();
  for (const m of String(html || '').matchAll(/href=["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (!/lote|item\b|imovel|oferta/i.test(u.pathname)) continue;
      if (u.href === url) continue;
      out.add(u.pathname);
    } catch { /* skip */ }
  }
  return [...out];
}

async function reconFonte(cfg) {
  const motor = cfg.fetch === 'dom' ? criarMotorDom(cfg.dom) : criarMotorFetch(cfg.chave);
  const { fetchFonte } = motor;
  try {
    for (const tenant of cfg.tenants) {
      console.log(`\n### ${tenant.fonte} — ${tenant.base}${cfg.catalogo}`);
      let enumResult;
      try {
        enumResult = await enumerar(fetchFonte, tenant, cfg, { maxPages: cfg.maxPages || 2, debug: false, semBD: true });
      } catch (e) {
        console.log(`  ERRO ao enumerar: ${e.message}`);
        continue;
      }
      const { urls, fetchOk } = enumResult;
      console.log(`  enumerados: ${urls.length} (fetchOk=${fetchOk})`);
      if (!urls.length) continue;

      let rejeitadosSemValor = 0, suspeitaPacote = 0;
      const amostra = urls.slice(0, AMOSTRA);
      for (const url of amostra) {
        const r = await fetchFonte(url, { semBD: true });
        if (!r?.html) continue;
        let det, q;
        try {
          det = cfg.parse.parseDetalhe(r.html, url);
          q = cfg.parse.checarQualidade(det, { estrito: false });
        } catch (e) { console.log(`  [erro parseDetalhe/checarQualidade em ${url}] ${e.message}`); continue; }
        const semValor = !(Number(det?.valor_avaliacao) > 0) && !(Number(det?.valor_minimo) > 0);
        if (q?.descartar && semValor) {
          rejeitadosSemValor++;
          const cands = linksSuspeitos(r.html, url, tenant.base);
          const txt = textoDe(r.html);
          const menciona = /\b\d+\s*(lotes?|im[óo]veis)\b/i.test(txt);
          if (cands.length >= 2 || menciona) {
            suspeitaPacote++;
            console.log(`  ⚠️ SUSPEITA DE PACOTE em ${url}`);
            console.log(`     ${cands.length} link(s) candidato(s) a sub-item: ${cands.slice(0, 5).join(', ')}`);
            if (menciona) console.log(`     texto menciona contagem de lotes/imóveis (trecho): "${(txt.match(/.{0,40}\b\d+\s*(lotes?|im[óo]veis)\b.{0,40}/i) || [''])[0]}"`);
          }
        }
      }
      console.log(`  amostra ${amostra.length}: ${rejeitadosSemValor} descartado(s) sem valor, ${suspeitaPacote} com sinal de pacote`);
    }
  } finally {
    await motor.fechar?.();
  }
}

async function main() {
  for (const cfg of FONTES) {
    try { await reconFonte(cfg); }
    catch (e) { console.log(`\n### ${cfg.chave} — ERRO GERAL: ${e.message}`); }
  }
  console.log('\n═══ FIM DA VARREDURA');
}
main().catch(e => { console.error('ERRO FATAL:', e); process.exit(1); });
