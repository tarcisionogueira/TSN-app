/**
 * RECON (só leitura, não grava) — por que o WEBLEILOES passou a coletar ZERO (pendência #148).
 *
 * Medido antes de escrever: nas rodadas de 06/10 18:10 e 07/10 19:00 a fonte registrou
 * `falhou · total 0`, e o log mostra as TRÊS rotas devolvendo vazio sem erro nenhum:
 * "/imoveis: +0", "/busca?categoria=imoveis: +0", "/leiloes: +0". Página abre, seletor não acha.
 * O acervo está congelado em 71 ativos desde 04/10. Duas rodadas iguais deixaram de ser
 * oscilação — é o critério escrito na própria pendência para virar recon.
 *
 * A premissa do coletor é UM seletor: `a[href*="/oferta/"][href*="/imoveis/"]` com id em "id-NNN".
 * Se o site trocou o padrão de URL, as três rotas zeram juntas — exatamente o que se vê. Este
 * recon não adivinha: conta os links por padrão e mostra uma amostra do que a página TEM hoje,
 * para o conserto partir da estrutura real e não de palpite.
 */
import puppeteer from 'puppeteer';

const BASE = 'https://www.webleiloes.com.br';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const ROTAS = (process.env.RECON_ROTAS || '/imoveis,/busca?categoria=imoveis,/leiloes').split(',');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
let abertas = 0;
try {
  for (const rota of ROTAS) {
    console.log(`\n═══ ${rota}`);
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
    try {
      const resp = await page.goto(`${BASE}${rota}`, { waitUntil: 'networkidle2', timeout: 45000 });
      await new Promise((r) => setTimeout(r, 2500));
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      console.log(`  HTTP ${resp ? resp.status() : '?'} · ${(await page.content()).length} caracteres`);
      abertas++;

      const d = await page.evaluate(() => {
        const hrefs = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') || '');
        const conta = (re) => hrefs.filter((h) => re.test(h)).length;
        // Agrupa os links por "forma" para a mudança de padrão aparecer sozinha, sem eu
        // precisar adivinhar o novo formato: /x/y/z vira /x/y/:n.
        const formas = {};
        for (const h of hrefs) {
          if (/^(https?:|mailto:|tel:|#)/i.test(h)) continue;
          const f = h.split('?')[0].split('/').slice(0, 4).map((p) => (/^\d|id-\d/.test(p) ? ':n' : p)).join('/');
          formas[f] = (formas[f] || 0) + 1;
        }
        return {
          titulo: document.title,
          totalLinks: hrefs.length,
          seletorDoColetor: document.querySelectorAll('a[href*="/oferta/"][href*="/imoveis/"]').length,
          comOferta: conta(/\/oferta\//),
          comImoveis: conta(/\/imoveis/),
          comIdNn: conta(/id-\d+/),
          cards: document.querySelectorAll('article, [class*="card"]').length,
          formas: Object.entries(formas).sort((a, b) => b[1] - a[1]).slice(0, 14),
          // Marcas de bloqueio/vazio: distinguem "o site mudou" de "o site me barrou" e de
          // "a busca não tem resultado" — três consertos diferentes.
          marcas: ['cloudflare', 'challenge', 'captcha', 'acesso negado', 'nenhum resultado',
            'nenhum imóvel', 'no momento não', 'manutenção', '403', '429']
            .filter((m) => document.body.innerText.toLowerCase().includes(m)),
          amostraTexto: (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 300),
        };
      });
      console.log(`  título: ${JSON.stringify(d.titulo)}`);
      console.log(`  SELETOR DO COLETOR a[href*="/oferta/"][href*="/imoveis/"]: ${d.seletorDoColetor}`);
      console.log(`  links: ${d.totalLinks} · com /oferta/: ${d.comOferta} · com /imoveis: ${d.comImoveis} · com id-NN: ${d.comIdNn} · cards: ${d.cards}`);
      if (d.marcas.length) console.log(`  ⚠️ marcas na página: ${d.marcas.join(', ')}`);
      console.log('  formas de link mais comuns:');
      for (const [f, n] of d.formas) console.log(`     ${String(n).padStart(4)} ${f}`);
      console.log(`  texto: ${JSON.stringify(d.amostraTexto)}`);
    } catch (e) {
      console.log(`  ✗ não abriu: ${String(e.message).slice(0, 120)}`);
    } finally { await page.close().catch(() => {}); }
  }
} finally { await browser.close().catch(() => {}); }

console.log(`\n${abertas}/${ROTAS.length} rotas abertas.`);
// "Não consegui medir" não pode sair como "medi e está tudo bem".
if (!abertas) { console.error('RECON INVÁLIDO: nenhuma rota abriu — nada foi medido.'); process.exit(2); }
