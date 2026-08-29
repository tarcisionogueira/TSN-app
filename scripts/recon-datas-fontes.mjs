/**
 * RECON: ONDE ESTÁ A DATA NAS 5 FONTES QUE NUNCA A TRAZEM (29/08). NÃO GRAVA NADA.
 *
 * POR QUE (medido): 1.106 lotes ativos do acervo estão sem `data_leilao`, e eles se concentram
 * em seis fontes — BIASI 1/347, GRUPOLANCE 5/355, GESTAOLEILOES 0/144, VIP 0/93, SUPORTE 4/92,
 * WEBLEILOES 18/93. As outras quinze fontes entregam 100% das datas na COLETA, sem ler um PDF.
 *
 * E a causa não é parser sutil: **cinco dos seis mapeadores escrevem `data_leilao: null`
 * literalmente**. Nunca procuraram. Foi essa descoberta que trocou o plano — consertar 6
 * parsers custa menos e acerta mais que ler 2.900 editais a 26% de aproveitamento, e a data da
 * listagem vem estruturada, que é o que dá assertividade.
 *
 * Sem data o estrago é duplo: o lote nunca expira por prazo (`desativar_leiloes_encerrados` é
 * cego em quem não tem data) e o gate de leilão encerrado FALHA ABERTO — o cliente gasta cota
 * gerando relatório de leilão que já aconteceu.
 *
 * Este script abre a listagem de cada fonte e despeja o HTML dos 2 primeiros cartões de lote
 * mais todo texto que se pareça com data. É para eu ver a marcação real antes de escrever o
 * seletor — escrever regex contra página que não se viu é como esta base ganhou parser que
 * "funciona" e traz o campo errado.
 */
import puppeteer from 'puppeteer';

// ALVOS DA 2ª RODADA (29/08), corrigidos pelo que a 1ª mediu:
//  · VIP saiu — resolvido: `.anc-date` + `.anc-hour`, parser já corrigido.
//  · GRUPOLANCE: `/busca?tipo=imoveis` deu 404 — era chute meu. Agora a home, para ler os
//    caminhos reais do menu antes de adivinhar de novo.
//  · SUPORTE: `liderleiloes` tem ZERO lotes ativos no acervo — eu escolhi o tenant errado para
//    procurar marcação. Trocado por `portoleiloes`, que trouxe 12 imóveis hoje.
//  · WEBLEILOES: a LISTAGEM não tem data mesmo ("Aberto para Lances · 1ª leilão", sem dia).
//    A data está na página do lote — daí o alvo virar uma oferta concreta.
//  · BIASI: o cartão que a heurística pegou era o `div.card-lot` interno, que só tem preço.
//    O scraper já busca `/sale/detail?id=`, então é ESSE retorno que precisa ser inspecionado.
// ALVOS DA 3ª RODADA (29/08) — URLs REAIS, tiradas do NOSSO acervo (`imoveis_leilao.url_lote`)
// em vez de adivinhadas. As duas rodadas anteriores perderam três alvos por chute meu:
// `/busca?tipo=imoveis` (404), `sale/detail?id=1` (id inexistente, redirecionou para a home) e
// `liderleiloes` (tenant com zero lotes). O acervo já sabia o endereço certo de cada um — usar
// o que se tem antes de supor é a mesma regra que fez o "documento primeiro" existir.
const ALVOS = [
  { fonte: 'BIASI',      url: 'https://www.biasileiloes.com.br/sale/detail?id=62174', espera: 'domcontentloaded' },
  { fonte: 'GRUPOLANCE', url: 'https://www.grupolance.com.br/imoveis/imoveis-comerciais/ba/salvador/sala-comercial-edificio-cosmopolitan-mix-salvador-ba-28321', espera: 'domcontentloaded' },
  { fonte: 'SUPORTE',    url: 'https://rodrigoleiloeiro.com.br/eventos/leilao/imovel-rural-12-85-68-ha-fazenda-imbutaia-bom-jd-de-minas-mg-possibilidade-de-parcelamento/lote/10532/imovel-rural-12-85-68-ha-fazenda-imbutaia-bom-jd-de-minas-mg-possibilidade-de-parcelamento', espera: 'domcontentloaded' },
];

const RE_DATA = /\b\d{1,2}\s*[\/.-]\s*\d{1,2}\s*[\/.-]\s*\d{2,4}\b|\b\d{1,2}\s+de\s+[a-zç]+\s+de\s+\d{4}\b/gi;

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

for (const a of ALVOS) {
  console.log(`\n${'='.repeat(70)}\n${a.fonte} — ${a.url}`);
  const page = await browser.newPage();
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36');
    const resp = await page.goto(a.url, { waitUntil: a.espera, timeout: 45000 });
    console.log(`  HTTP ${resp?.status()} · url final ${page.url()}`);
    await new Promise(r => setTimeout(r, 3500));   // SPA: deixa render

    const achado = await page.evaluate(() => {
      // Heurística de cartão: o menor elemento repetido que contém um preço em R$.
      const todos = [...document.querySelectorAll('article, li, .card, [class*="lote"], [class*="item"], [class*="card"]')];
      // Agora aceita elemento com PREÇO **ou** com DATA. A versão anterior exigia R$ e por isso
      // devolveu "0 cartões" em páginas onde a data mora num bloco separado do valor — e "0
      // cartões" parecia "a página não tem data", que é a forma nº 10 outra vez.
      const temDinheiro = (t) => /R\$\s?[\d.]{3,}/.test(t);
      const temData = (t) => /\b\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{2,4}\b/.test(t);
      const comPreco = todos.filter(el => {
        const t = el.textContent || '';
        return (temDinheiro(t) || temData(t)) && t.length < 3000;
      });
      // Mais interno primeiro: evita pegar o container da lista inteira.
      comPreco.sort((x, y) => (x.textContent || '').length - (y.textContent || '').length);
      return {
        totalCandidatos: comPreco.length,
        cartoes: comPreco.slice(0, 4).map(el => ({
          classe: el.className || '(sem classe)',
          texto: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 700),
          html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 1800),
        })),
      };
    });

    if (a.links) {
      const menu = await page.evaluate(() => [...document.querySelectorAll('a[href]')]
        .map(el => `${(el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)} → ${el.getAttribute('href')}`)
        .filter(t => /im[óo]ve|leil|busca|lote|agenda|catalog/i.test(t)).slice(0, 25));
      console.log(`  LINKS ÚTEIS:\n   ${menu.join('\n   ')}`);
    }
    console.log(`  cartões candidatos: ${achado.totalCandidatos}`);
    for (const [i, c] of achado.cartoes.entries()) {
      const datas = [...(c.texto.match(RE_DATA) || [])];
      console.log(`\n  --- cartão ${i + 1} · class="${String(c.classe).slice(0, 80)}"`);
      console.log(`  DATAS NO TEXTO: ${datas.length ? datas.join(' | ') : '(nenhuma)'}`);
      console.log(`  TEXTO: ${c.texto}`);
      console.log(`  HTML : ${c.html}`);
    }
  } catch (e) {
    // Motivo preservado: "não abriu" e "abriu e não tem data" levam a consertos diferentes.
    console.log(`  ERRO: ${String(e?.message || e).slice(0, 200)}`);
  } finally { await page.close().catch(() => {}); }
}
await browser.close();
