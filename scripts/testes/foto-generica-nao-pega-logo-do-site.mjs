/**
 * scripts/testes/foto-generica-nao-pega-logo-do-site.mjs
 *
 * POR QUE EXISTE (10/09, revisão geral de fotos/anexos/documentos pedida pelo dono).
 * `extrairGenerico` (scraper-core.mjs) atende RJLEILOES/SOLEON/PECINI/EMILIOMATOS/LEILAOPRO/
 * SATO. Medido: RJLEILOES tinha 4% de foto mesmo com 100% de documento/descrição — o resto da
 * ficha vem de rótulo no corpo (`extrairGenerico` mesmo), só a foto dependia inteiramente de
 * schema.org `image` ou `og:image`, sem nenhum fallback quando a página não publica nenhum
 * dos dois. Fix: cai para `fotoDeHtml` (mesmo filtro anti-chrome da família `dom`, ver
 * dom-parse-util.mjs) só quando os dois métodos primários não acham nada — nunca sobrescreve
 * um og:image/JSON-LD que já funcionava (não pode regredir RJ/SOLEON/PECINI, que já iam bem
 * nos outros campos).
 */
import { extrairGenerico } from '../lib/scraper-core.mjs';

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

const BASE = 'https://exemplo-leiloeiro.com.br/leilao/lote/456';

console.log('\nextrairGenerico — og:image/JSON-LD continuam mandando quando existem (fallback nunca sobrescreve o que já funciona)');
{
  const comOg = `<html><head><meta property="og:image" content="/og/foto-oficial.jpg"></head>
    <body><img src="/uploads/outra-foto.jpg" width="800" height="600"></body></html>`;
  const r = extrairGenerico(comOg, BASE);
  ok(r.link_foto === 'https://exemplo-leiloeiro.com.br/og/foto-oficial.jpg',
    'com og:image presente, usa og:image — não troca pela <img> do corpo', r.link_foto);

  const comJsonLd = `<html><head><script type="application/ld+json">{"image":"/schema/foto.png"}</script></head>
    <body><img src="/uploads/outra.jpg" width="800" height="600"></body></html>`;
  const r2 = extrairGenerico(comJsonLd, BASE);
  ok(r2.link_foto === 'https://exemplo-leiloeiro.com.br/schema/foto.png',
    'com JSON-LD image presente, usa JSON-LD — mesma prioridade de sempre', r2.link_foto);
}

console.log('\nextrairGenerico — sem og:image nem JSON-LD, cai no fallback de <img> em vez de ficar null');
{
  const semMeta = `<html><head></head>
    <body><header><img src="/logo-do-site.png" width="150" height="50"></header>
    <div class="detalhe-lote"><img src="/uploads/lote-456-foto1.jpg" width="900" height="700"></div>
    </body></html>`;
  const r = extrairGenerico(semMeta, BASE);
  ok(r.link_foto === 'https://exemplo-leiloeiro.com.br/uploads/lote-456-foto1.jpg',
    'sem meta tags: pula o logo do header e acha a foto real do lote (era o caso medido do RJLEILOES: 4% foto)', r.link_foto);
}

console.log('\nextrairGenerico — sem og:image, JSON-LD nem <img> aproveitável: continua null (nunca inventa)');
{
  const soChrome = `<html><head></head>
    <body><img src="/icones/menu.svg"><img src="/banner-topo.jpg" width="1200" height="90"></body></html>`;
  const r = extrairGenerico(soChrome, BASE);
  ok(r.link_foto === null, 'só chrome de site disponível: fica null, honesto — não é regressão nova, é o comportamento de sempre preservado');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
