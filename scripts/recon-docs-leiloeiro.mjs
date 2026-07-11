/**
 * RECON GENÉRICO de documentos por leiloeiro (sem credencial) — classifica se os
 * documentos (matrícula, edital, laudo, regras de venda) de uma fonte são PÚBLICOS
 * (link direto) ou LOGIN-GATED (endpoint dinâmico / parede de login), para planejar
 * a mesma correção do Grupo Lance/ZUK em todos.
 *
 * Abre N páginas de lote no navegador real (Puppeteer) e reporta, por lote:
 *   - status, se há parede de login, e o que vasculharDocumentos() captura
 *   - PDFs públicos diretos + tipos citados nos links (matrícula/edital/laudo/regras)
 *   - indícios de doc gated: <a data-url="base64">, botões "documento", href="#"/vazio
 * NÃO grava nada. Roda no GitHub Actions. Secrets: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 * Config: RECON_FONTE (ex.: MEGA), RECON_N (default 6).
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { vasculharDocumentos } from '../api/_doc-scan.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,900'];
const FONTE = (process.env.RECON_FONTE || '').toUpperCase();
const N = Number(process.env.RECON_N || 6);

const KW = { matricula: /matr[ií]cul/i, edital: /edital/i, laudo: /laudo|avalia[çc]/i, regras: /regras|condi[cç][oõ]es|como\s*comprar|leil[aã]o online/i };

async function main() {
  if (!FONTE) { console.error('Defina RECON_FONTE'); process.exit(1); }
  // usa url_lote; se vazio, cai para link_edital (algumas fontes guardam a página lá)
  const { data: lotes, error } = await supabase.from('imoveis_leilao')
    .select('id, fonte_id, url_lote, link_edital, link_foto')
    .eq('fonte', FONTE).eq('ativo', true).limit(200);
  if (error) { console.error(error.message); process.exit(1); }
  const alvos = (lotes || [])
    .map(l => ({ ...l, page: (l.url_lote && /^https?:/.test(l.url_lote)) ? l.url_lote : l.link_edital }))
    .filter(l => l.page && /^https?:/.test(l.page)).slice(0, N);
  if (!alvos.length) { console.log(`${FONTE}: nenhum lote com página navegável.`); return; }
  console.log(`\n🔎 Recon ${FONTE} — ${alvos.length} lote(s) no navegador real.\n`);

  const browser = await puppeteer.launch({ headless: true, args: ARGS });
  const resumo = { publicos: 0, gated: 0, login: 0, nada: 0, tipos: new Set() };
  try {
    for (const l of alvos) {
      console.log(`\n──── ${l.fonte_id}\n  ${l.page}`);
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
      try {
        const resp = await page.goto(l.page, { waitUntil: 'networkidle2', timeout: 40000 });
        await new Promise(r => setTimeout(r, 2000));
        const html = await page.content();
        const docs = vasculharDocumentos(html, l.page, l.link_foto || null);
        const pdfs = [...html.matchAll(/https?:(?:\\\/|\/)[^"'\\\s)]+\.pdf[^"'\\\s)]*/gi)].map(m => m[0]).slice(0, 8);
        const gatedLinks = [...html.matchAll(/data-url=["'][A-Za-z0-9+/=]{12,}["']/gi)].length
          + [...html.matchAll(/<a[^>]*href=["'](?:#|javascript:|)["'][^>]*(?:documento|matr[ií]cul|baixar)[^>]*>/gi)].length;
        const loginWall = /(fazer|efetuar)\s*login|acesse sua conta|para (ver|baixar).*(documento|matr[ií]cula).*(login|logar|conta)|entrar para ver/i.test(html);
        // tipos citados na página
        const tiposPagina = Object.entries(KW).filter(([, re]) => re.test(html)).map(([k]) => k);
        tiposPagina.forEach(t => resumo.tipos.add(t));

        console.log(`  status=${resp?.status()} htmlLen=${html.length} loginWall=${loginWall}`);
        console.log(`  vasculhador: anexos=${docs.anexos.length} matricula=${!!docs.matricula} edital=${!!docs.edital} laudo=${!!docs.laudo} regras=${!!docs.regras}`);
        console.log(`  PDFs diretos=${pdfs.length} | doc-links gated(indício)=${gatedLinks} | tipos citados=[${tiposPagina.join(', ')}]`);
        docs.anexos.slice(0, 6).forEach(a => console.log(`     [${a.tipo}] ${String(a.nome).slice(0, 40)} → ${String(a.url).slice(0, 90)}`));
        if (docs.anexos.length) resumo.publicos++;
        else if (gatedLinks > 0 || loginWall) resumo.gated++;
        else resumo.nada++;
        if (loginWall) resumo.login++;
      } catch (e) { console.log(`  ERRO ${e.message}`); }
      finally { await page.close().catch(() => {}); }
    }
  } finally { await browser.close().catch(() => {}); }

  console.log(`\n═══ RESUMO ${FONTE}: públicos(com doc)=${resumo.publicos} · gated/login=${resumo.gated} (login-wall=${resumo.login}) · sem-doc=${resumo.nada}`);
  console.log(`Tipos de documento citados nas páginas: [${[...resumo.tipos].join(', ') || 'nenhum'}]`);
  const veredito = resumo.publicos >= resumo.gated && resumo.publicos > 0
    ? '=> Docs parecem PÚBLICOS: ajustar seletor/enrich (sem credencial).'
    : (resumo.gated > 0 ? '=> Docs parecem LOGIN-GATED: precisa de credencial + molde ZUK/GL.'
      : '=> Página sem documentos visíveis: verificar estrutura/JS ou fonte sem docs.');
  console.log(veredito);
}

main().catch((e) => { console.error(e); process.exit(1); });
