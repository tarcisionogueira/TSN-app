/**
 * scripts/testes/nivel-2-nao-busca-o-catalogo-duas-vezes.mjs
 *
 * POR QUE EXISTE (10/09). Investigando por que HASTA ficou 11,8 dias sem nenhuma coleta
 * residencial bem-sucedida (`coleta_cliente.ultima_em` parado em 30/08), `fonte_saude` mostrava
 * `status='vazio'`, motivo `'respondeu 200 e enumerou 0 lote(s)'` — SEM o sufixo
 * `(N evento(s) no catálogo)` que o `eventosCount` (adicionado nesta mesma investigação) deveria
 * ter acrescentado. `fetchOk=true` prova que a página 1 do catálogo respondeu; ainda assim
 * `eventosCount` saía `null`.
 *
 * Causa: `enumerar()` buscava a URL do catálogo (sem `page`) DUAS VEZES — uma no laço de
 * nível 1 (`extrairUrlsDeLote`, p=1) e outra, idêntica, só para o nível 2
 * (`extrairUrlsDeEvento`). Num motor `dom` (Puppeteer, ~3,5 s de espera por página, e no caso da
 * HASTA a ÚLTIMA fonte da fila residencial, depois de 7+ outras já terem rodado), a 2ª busca
 * podia falhar sozinha sem o site ter mudado nada — e como só ELA alimentava `eventosCount`,
 * o diagnóstico que deveria separar "catálogo vazio de verdade" de "não consegui nem tentar"
 * ficava cego bem no caso que mais precisava dele.
 *
 * Fix: reaproveitar o HTML da página 1 (`htmlPagina1`) para o nível 2 — é sempre a MESMA url por
 * construção (`cfg.catalogo` sem `page`), então buscar de novo nunca acrescenta informação, só
 * risco. Este teste tranca duas coisas: (a) o catálogo é buscado no máximo 1x mesmo quando a
 * fonte usa nível 2, e (b) `eventosCount` continua sendo calculado corretamente a partir desse
 * único fetch — inclusive quando o laço de nível 1 passa por mais de uma página.
 */
import { enumerar } from '../lib/motor/runner.mjs';

let falhas = 0;
const ok = (cond, oque, extra = '') => {
  if (cond) console.log(`  ✓ ${oque}`);
  else { falhas++; console.log(`  ✗ ${oque}${extra ? ` — ${extra}` : ''}`); }
};

// Config no mesmo formato de hasta.mjs/nordeste.mjs: catálogo de EVENTOS, nível 2 ligado.
const cfgBase = {
  catalogo: '/leiloes',
  paginaParam: 'page',
  maxEventos: 12,
  maxPagesEvento: 3,
  parse: {
    // página do catálogo não tem link de LOTE direto (é vitrine de eventos) — sempre 0 aqui.
    extrairUrlsDeLote: (html) => {
      const m = new Map();
      if (html && html.startsWith('evento:')) {
        const id = html.slice(7);
        m.set(`lote-${id}`, `https://x.test/item/${id}`);
      }
      return m;
    },
    extrairUrlsDeEvento: (html) => {
      const m = new Map();
      if (html === 'pagina1-com-2-eventos') { m.set('ev1', 'https://x.test/leilao/1'); m.set('ev2', 'https://x.test/leilao/2'); }
      if (html === 'pagina1-com-9-eventos') for (let i = 0; i < 9; i++) m.set(`ev${i}`, `https://x.test/leilao/${i}`);
      return m;
    },
  },
};
const tenant = { fonte: 'TESTE', base: 'https://x.test' };

console.log('\nenumerar() — nível 2 reaproveita a página 1, nunca busca o catálogo 2x');
{
  const chamadas = [];
  const fetchFonte = async (url) => {
    chamadas.push(url);
    if (url === 'https://x.test/leiloes') return { html: 'pagina1-com-2-eventos', via: 'gratis' };
    if (url.startsWith('https://x.test/leilao/') && !url.includes('?')) return { html: `evento:${url.split('/').pop()}`, via: 'gratis' };
    return { html: null }; // página 2+ do evento: sem próxima página (evento cabe em 1 página)
  };
  const r = await enumerar(fetchFonte, tenant, cfgBase, { maxPages: 20, debug: false, semBD: false });
  const chamadasAoCatalogo = chamadas.filter(u => u === 'https://x.test/leiloes').length;
  ok(chamadasAoCatalogo === 1, `catálogo buscado exatamente 1x (foi ${chamadasAoCatalogo}x)`);
  ok(r.fetchOk === true, 'fetchOk true (a página respondeu)');
  ok(r.eventosCount === 2, `eventosCount reflete os 2 eventos da página 1 (veio ${r.eventosCount})`);
  ok(r.urls.length === 2, `lotes dos 2 eventos entraram (veio ${r.urls.length})`);
}

console.log('\nenumerar() — o mesmo mesmo quando o catálogo é o único suficiente para a 2ª busca falhar sozinha');
{
  // Sem o fix, uma 2ª busca à mesma URL poderia falhar por si só (rede/timeout do runner
  // residencial) mesmo com a 1ª tendo respondido. Simulamos isso: só a 1ª chamada teria sucesso.
  let chamadasAoCatalogo = 0;
  const fetchFonte = async (url) => {
    if (url === 'https://x.test/leiloes') {
      chamadasAoCatalogo++;
      return chamadasAoCatalogo === 1 ? { html: 'pagina1-com-2-eventos', via: 'gratis' } : { html: null };
    }
    if (url.startsWith('https://x.test/leilao/') && !url.includes('?')) return { html: `evento:${url.split('/').pop()}`, via: 'gratis' };
    return { html: null };
  };
  const r = await enumerar(fetchFonte, tenant, cfgBase, { maxPages: 20, debug: false, semBD: false });
  ok(r.eventosCount === 2, `mesmo se uma 2ª busca fosse tentada e falhasse, eventosCount não se perde (veio ${r.eventosCount})`);
  ok(chamadasAoCatalogo === 1, `e de fato só 1 tentativa aconteceu (foram ${chamadasAoCatalogo})`);
}

console.log('\nenumerar() — catálogo com várias páginas: nível 2 usa a página 1, não a última');
{
  const chamadas = [];
  const cfgPaginado = { ...cfgBase, maxEventos: 12 };
  const fetchFonte = async (url) => {
    chamadas.push(url);
    if (url === 'https://x.test/leiloes') return { html: 'pagina1-com-2-eventos', via: 'gratis' };
    // página 2 (?page=2): outro conteúdo, com MAIS lotes diretos (força o laço de nível 1 a continuar)
    if (url === 'https://x.test/leiloes?page=2') return { html: 'evento:pagina2fake', via: 'gratis' };
    if (url.startsWith('https://x.test/leilao/') && !url.includes('?')) return { html: `evento:${url.split('/').pop()}`, via: 'gratis' };
    return { html: null };
  };
  const r = await enumerar(fetchFonte, tenant, cfgPaginado, { maxPages: 2, debug: false, semBD: false });
  ok(r.eventosCount === 2, `eventosCount vem da página 1 mesmo com paginação de nível 1 (veio ${r.eventosCount})`);
  ok(chamadas.filter(u => u === 'https://x.test/leiloes').length === 1, 'catálogo (página 1) buscado só 1x mesmo com maxPages=2');
}

console.log('\nenumerar() — página 1 falha: eventosCount fica null, extrairUrlsDeEvento nem roda');
{
  let chamouExtrairEventos = false;
  const cfgComEspiao = {
    ...cfgBase,
    parse: {
      ...cfgBase.parse,
      extrairUrlsDeEvento: (html) => { chamouExtrairEventos = true; return cfgBase.parse.extrairUrlsDeEvento(html); },
    },
  };
  const fetchFonte = async () => ({ html: null });
  const r = await enumerar(fetchFonte, tenant, cfgComEspiao, { maxPages: 20, debug: false, semBD: false });
  ok(r.fetchOk === false, 'fetchOk false quando a página 1 não responde');
  ok(r.eventosCount === null, 'eventosCount continua null (não confunde com "0 eventos")');
  ok(chamouExtrairEventos === false, 'extrairUrlsDeEvento nem chega a ser chamado sem fetchOk');
}

console.log('\nenumerar() — fonte SEM nível 2 (extrairUrlsDeEvento ausente) não muda de comportamento');
{
  const cfgSemNivel2 = { catalogo: '/lotes', paginaParam: 'page', parse: { extrairUrlsDeLote: () => new Map([['a', 'https://x.test/a']]) } };
  const fetchFonte = async () => ({ html: 'qualquer coisa', via: 'gratis' });
  const r = await enumerar(fetchFonte, tenant, cfgSemNivel2, { maxPages: 1, debug: false, semBD: false });
  ok(r.eventosCount === null, 'sem extrairUrlsDeEvento, eventosCount fica null (comportamento antigo preservado)');
  ok(r.urls.length === 1, 'enumeração de nível 1 continua funcionando normalmente');
}

console.log(falhas ? `\n✗ ${falhas} falha(s)\n` : '\n✓ todos os casos passaram\n');
process.exit(falhas ? 1 : 0);
