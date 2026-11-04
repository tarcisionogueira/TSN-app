/**
 * scripts/testes/motor-orcamento-nao-descarta-lote-gratis.mjs
 *
 * POR QUE EXISTE (04/11, LEJE). Desde 30/10 o LEJE gravava 0 lotes por rodada: o teto de 40 páginas do
 * Firecrawl acabava na LISTAGEM (1 página por evento) e o primeiro lote que pedia página paga devolvia
 * `semCota` — o laço dava `break` e jogava fora também os ~35 lotes de evento único que já tinham saído
 * PRONTOS da listagem (`detCatalogo`, custo zero). Tranca: (a) lote pronto vem primeiro na fila; (b) depois
 * de um `semCota`, o pronto continua sendo gravado e o pago conta como `cotaNegada` sem nova busca.
 */
import { coletarTenant } from '../lib/motor/runner.mjs';

let falhas = 0;
const ok = (c, o, x = '') => { if (c) console.log(`  ✓ ${o}`); else { falhas++; console.log(`  ✗ ${o}${x ? ` — ${x}` : ''}`); } };

// Supabase de mentira: toda consulta devolve vazio (nenhum lote no banco, nenhuma recusa).
const q = { select: () => q, in: () => q, gt: () => q, eq: () => q, then: (r) => r({ data: [], error: null }) };
const supabase = { from: () => q };

const pago = (n) => `https://x.test/ev?cod=${n}&lote=${n}`;
const gratis = (n) => `https://x.test/ev?cod=${n}`;
const det = (u) => ({ titulo: `Casa ${u}`, cidade: 'Campinas', estado: 'SP', tipo: 'casa', valor: 100000, link_foto: 'f.jpg', descricao: 'x'.repeat(200) });
const cfg = {
  catalogo: '/', paginaParam: 'page', maxPages: 1,
  parse: {
    extrairUrlsDeLote: (html) => new Map(html === 'home' ? [[ '1', pago(1) ], [ '2', pago(2) ], [ 'e3', gratis(3) ], [ 'e4', gratis(4) ]] : []),
    detalhesDoCatalogo: (html) => new Map(html === 'home' ? [[gratis(3), det(3)], [gratis(4), det(4)]] : []),
    idDaUrl: (u) => new URL(u).searchParams.get('lote') || `e${new URL(u).searchParams.get('cod')}`,
    parseDetalhe: (html, u) => det(u),
    montarRow: (d, u, t) => ({ fonte: t.fonte, fonte_id: u, titulo: d.titulo, cidade: d.cidade, estado: d.estado, tipo: d.tipo, link_foto: d.link_foto, descricao: d.descricao }),
    checarQualidade: () => ({ descartar: false }),
  },
};
const tenant = { fonte: 'TESTE', base: 'https://x.test' };

console.log('\ncoletarTenant() — orçamento esgotado não descarta o lote já lido na listagem');
{
  const buscados = [];
  const fetchFonte = async (url) => {
    if (url === 'https://x.test/') return { html: 'home', via: 'firecrawl' };
    buscados.push(url);
    return { html: null, semCota: true, via: 'firecrawl-orcamento' };
  };
  const r = await coletarTenant(supabase, fetchFonte, tenant, cfg, { maxLotes: 40, debug: false, semBD: false, dryrun: true });
  ok(r.prontos.length === 2, `os 2 lotes de evento único foram gravados (veio ${r.prontos.length})`);
  ok(r.cotaNegada === 2, `os 2 que pedem página ficaram como sem cota (veio ${r.cotaNegada})`);
  ok(buscados.length === 1, `depois da 1ª recusa nenhuma página paga é pedida de novo (pedidas ${buscados.length})`);
}

console.log(falhas ? `\n✗ ${falhas} falha(s)` : '\n✓ todos os casos passaram');
process.exit(falhas ? 1 : 0);
