/**
 * Teste DESCARTÁVEL (19/09) — stealth grátis não passou do desafio Cloudflare em
 * crleiloes.com.br/leiloesuberlandia.com.br (rede "Plataforma Leiloar") nem em
 * lucasleiloeiro.com.br (decisão do dono: "tenta a B primeiro, se não rolar usa Bright Data").
 *
 * O fetch ESTÁTICO (sem JS, via pg_net) já passa pelo Cloudflare nesses domínios sem custo —
 * então o bloqueio é no FINGERPRINT do navegador automatizado, não no IP/reputação. Mas a
 * listagem completa de lotes não é server-rendered (todas as rotas guessed devolvem o mesmo
 * shell de ~19 destaques); o catálogo real carrega via AJAX depois do JS rodar.
 *
 * Este teste faz UMA chamada por domínio via Bright Data Web Unlocker (que renderiza JS e
 * resolve o desafio) pra confirmar se o HTML devolvido já vem com a listagem real — só então
 * vale construir o scraper de produção em cima disso. Usa o ledger oficial (`_brightdata.js`,
 * `proposito: 'teste-leiloar'`), então o gasto fica registrado e sob o teto normal.
 */
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';

async function testar(nome, url) {
  console.log(`\n=== ${nome} (${url}) ===`);
  try {
    const resp = await buscarViaBrightData(url, { proposito: 'teste-leiloar', timeoutMs: 60000 });
    const html = await resp.text();
    const qtdLote = (html.match(/\/lote\/\d+/g) || []).length;
    const qtdLeilao = (html.match(/\/leilao\/\d+/g) || []).length;
    const temDesafio = /just a moment|verifying you are human|checking your browser/i.test(html);
    console.log(`  HTTP ${resp.status} · tamanho=${html.length} · desafio Cloudflare ainda presente: ${temDesafio}`);
    console.log(`  links /lote/N: ${qtdLote} (distintos: ${new Set((html.match(/\/lote\/\d+/g) || [])).size}) · links /leilao/N: ${qtdLeilao}`);
  } catch (e) {
    if (e instanceof ErroBrightData) {
      console.log(`  ErroBrightData: motivo=${e.motivo} semCota=${e.semCota} detalhe=${e.detalhe}`);
    } else {
      console.log(`  ERRO inesperado: ${String(e.message || e).slice(0, 200)}`);
    }
  }
}

await testar('crleiloes.com.br', 'https://www.crleiloes.com.br/leiloes');
await testar('leiloesuberlandia.com.br', 'https://www.leiloesuberlandia.com.br/leiloes');
await testar('lucasleiloeiro.com.br', 'https://www.lucasleiloeiro.com.br/busca/#Engine=Start&Pagina=1&Busca=&Mapa=&ID_Categoria=88');
