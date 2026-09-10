/**
 * scripts/testes/foto-e-descricao-nao-ficam-nulas-na-familia-dom.mjs
 *
 * POR QUE EXISTE (10/09, revisão geral pedida pelo dono: "garantir que temos os documentos,
 * anexos, fotos e informações que precisamos"). Os 8 parsers da família `dom` (leilaoindex →
 * RIGOLONLEILOES/GIORDANOLEILOES/THAISTEIXEIRA, + NORDESTE/ALBERTOMACEDOLEILOES/HASTA/
 * SIMONLEILOES/LEJE/ROCHALEILOES/ALFA — 10 fontes) nunca tentavam extrair foto: `link_foto`
 * saía SEMPRE null porque nenhum `parseDetalhe` preenchia o campo que `montarRowDom` lê.
 * Medido em produção: GIORDANOLEILOES 0% foto, 0% descrição. 7 dos 8 parsers também cravavam
 * `descricao: null` sem nunca tentar (só HASTA extrai de verdade, por rótulo próprio).
 *
 * Sem acesso de rede a estes sites neste sandbox (proxy recusa CONNECT para domínio de
 * leiloeiro — confirmado em 10/09), este teste valida a LÓGICA do filtro contra HTML
 * sintético representativo (logo + foto real, lazy-load, ícone com dimensão pequena, SVG,
 * data: URI) — a validação contra HTML real acontece no dry-run automático do
 * `scraper-dom.yml` (push nesta branch, Chromium de verdade, zero Bright Data).
 */
import { fotoDeHtml, anexosDeHtml, montarRowDom } from '../lib/dom-parse-util.mjs';
import { inferirTipo } from '../lib/leilaopro-parse.mjs';

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

const BASE = 'https://exemplo-leiloes.com.br/lote/123';

console.log('\nfotoDeHtml — acha a foto de capa e descarta chrome do site');
{
  ok(fotoDeHtml('<div>sem imagem nenhuma</div>', BASE) === null, 'HTML sem <img>: null, não inventa');

  ok(fotoDeHtml('<img src="/assets/logo-site.png" width="120" height="40">', BASE) === null,
    'só logo do site (nome + dimensão de topo): descartado, não vira foto do lote');

  const comLogoEFoto = '<header><img src="/img/logo.png" alt="Logo"></header><div class="galeria"><img src="/uploads/lote-123-a.jpg" width="800" height="600"></div>';
  ok(fotoDeHtml(comLogoEFoto, BASE) === 'https://exemplo-leiloes.com.br/uploads/lote-123-a.jpg',
    'pula o logo do header e acha a foto real da galeria (1ª que sobrevive ao filtro)');

  ok(fotoDeHtml('<img data-lazy-src="/fotos/imovel-99.webp" width="640" height="480">', BASE)
      === 'https://exemplo-leiloes.com.br/fotos/imovel-99.webp',
    'lazy-load via data-lazy-src: resolvido e absolutizado');

  ok(fotoDeHtml('<img src="https://cdn.outro.com/fotos/casa.jpeg">', BASE) === 'https://cdn.outro.com/fotos/casa.jpeg',
    'URL já absoluta (outro domínio/CDN): mantida como está');

  ok(fotoDeHtml('<img src="/icones/whatsapp-icon.svg">', BASE) === null,
    'ícone SVG de rodapé/contato: extensão não é foto, descartado');

  ok(fotoDeHtml('<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBTAA7">', BASE) === null,
    'pixel de tracking em data: URI: descartado (nunca vira URL de foto)');

  ok(fotoDeHtml('<img src="/banner-topo-promocional.jpg" width="1200" height="90">', BASE) === null,
    'banner de topo (nome bate no filtro de chrome): descartado mesmo sendo .jpg de verdade');

  ok(fotoDeHtml('<img src="/icones/favorito.png" width="16" height="16">', BASE) === null,
    'dimensão pequena explícita (16x16, cara de ícone): descartada mesmo sem nome suspeito');

  ok(fotoDeHtml('<img srcset="/fotos/lote-99-800w.jpg 800w, /fotos/lote-99-400w.jpg 400w" width="800" height="600">', BASE)
      === 'https://exemplo-leiloes.com.br/fotos/lote-99-800w.jpg',
    'sem src, só srcset (lazy-load responsivo — caso real de NORDESTE/SIMONLEILOES, 10/09): usa o 1º candidato');
  ok(fotoDeHtml('<img sizes="100vw" srcset="/imgs/capa.webp 1x, /imgs/capa@2x.webp 2x">', BASE)
      === 'https://exemplo-leiloes.com.br/imgs/capa.webp',
    'srcset com descritor de densidade (1x/2x): pega a URL, descarta o descritor');
}

console.log('\nanexosDeHtml — passa a devolver link_foto junto (mesma varredura de HTML, zero mudança nos 8 chamadores que já espalham o retorno)');
{
  const r = anexosDeHtml('<a href="/docs/edital.pdf">Edital</a><img src="/uploads/foto-real.jpg" width="800" height="600">', BASE);
  ok(r.link_foto === 'https://exemplo-leiloes.com.br/uploads/foto-real.jpg', 'link_foto vem junto de anexos/link_edital no mesmo retorno');
  ok(r.link_edital === 'https://exemplo-leiloes.com.br/docs/edital.pdf', 'não regrediu a extração de PDF ao ganhar a foto');
}

console.log('\nmontarRowDom — descrição sintética só entra quando o parser não achou parágrafo real, e só com dado já validado');
{
  const tenant = { fonte: 'TESTEDOM', leiloeiro: 'Teste Leilões', base: BASE };

  const comDescReal = montarRowDom(BASE, {
    titulo: 'Casa em Teste/SP', cidade: 'Teste', estado: 'SP', area_m2: 120,
    valor_avaliacao: 300000, valor_minimo: 200000, modalidade: 'extrajudicial',
    descricao: 'Descrição de verdade extraída do site.',
  }, tenant, '123', inferirTipo);
  ok(comDescReal.descricao === 'Descrição de verdade extraída do site.', 'descrição real do parser nunca é substituída pela sintética');

  const semDescComCampos = montarRowDom(BASE, {
    titulo: 'Casa em Teste/SP', cidade: 'Teste', estado: 'SP', area_m2: 120,
    valor_avaliacao: 300000, valor_minimo: 200000, modalidade: 'extrajudicial',
    descricao: null,
  }, tenant, '124', inferirTipo);
  ok(semDescComCampos.descricao !== null, 'sem descrição real: sintetiza em vez de deixar null');
  ok(semDescComCampos.descricao.includes('Teste/SP') && semDescComCampos.descricao.includes('120'),
    'sintética usa área + cidade/UF já validados pelo parser (SEM tipo — ver caso abaixo do porquê)', semDescComCampos.descricao);
  ok(semDescComCampos.descricao.includes('300.000') || semDescComCampos.descricao.includes('300000'),
    'sintética inclui a avaliação quando existe', semDescComCampos.descricao);

  const semNada = montarRowDom(BASE, {
    titulo: null, cidade: null, estado: null, area_m2: 0,
    valor_avaliacao: 0, valor_minimo: 0, modalidade: 'extrajudicial', descricao: null,
  }, tenant, '125', inferirTipo);
  ok(semNada.descricao === null, 'sem NENHUM campo aproveitável: fica null — nunca inventa texto vazio tipo "· avaliação R$ 0,00"');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
