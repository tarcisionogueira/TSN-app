#!/usr/bin/env node
/**
 * PRECISA DE NAVEGADOR? — mede, para GESTAO, RJ e PECINI, se o Chromium ainda é necessário.
 *
 * ─── POR QUE ESTE SCRIPT EXISTE (30/08) ───────────────────────────────────────────────
 * Os três scrapers carregam, em comentário, a mesma justificativa: "o site está atrás de
 * Cloudflare, todo caminho responde 403 'Just a moment'". **Esses comentários foram escritos
 * quando os três rodavam de DATACENTER** (GitHub Actions / Vercel), e o Cloudflare decide
 * desafiar com base na reputação do IP: de um IP residencial ele frequentemente NÃO desafia.
 * Desde que o runner residencial existe, ninguém remediu — o navegador ficou por herança.
 *
 * O que custa manter o navegador quando ele não é preciso: launch do Chromium + 600–1800 ms de
 * jitter + 4 s de espera fixa POR PÁGINA (`fetch-residencial.mjs`). A PECINI sozinha visita
 * centenas de lotes por run. SOLEON e VLANCE já rodam de casa com fetch puro (`*_NO_BD=1`) —
 * a prova de que o IP de casa basta para ALGUMAS fontes está no próprio runner.
 *
 * ─── O QUE ELE MEDE, E POR QUE NÃO MEDE "HTTP 200" (forma #10 do CLAUDE.md) ────────────
 * "Respondeu 200" é o número mais fácil de coletar e mede outra coisa: o Cloudflare devolve o
 * desafio DENTRO de um 200, e o back-office do GESTAO devolve stub de 1,5 kB com 200. Então o
 * placar aqui é **quantos marcadores o PARSER DE VERDADE encontraria** — a mesma expressão
 * regular que cada scraper usa para enumerar:
 *   RJ      → /item/{id}/detalhes   na listagem de imóveis
 *   PECINI  → /lote/{slug}/{id}/    no sitemap.xml
 *   GESTAO  → leilao.php?idLeilao=N na home de cada domínio (+ decodificação windows-1252,
 *             que o navegador fazia de graça e o fetch puro tem de fazer na mão)
 *
 * E mede os DOIS caminhos no mesmo minuto, da mesma máquina: comparar o fetch de hoje com o
 * navegador de outro dia compararia duas coisas diferentes e chamaria isso de conclusão.
 *
 * ─── COMO RODAR (na MÁQUINA RESIDENCIAL — o resultado só vale de casa) ────────────────
 *   node scripts/testes/precisa-navegador.mjs            # os 3, fetch puro × navegador
 *   node scripts/testes/precisa-navegador.mjs rj pecini  # só as fontes citadas
 *   node scripts/testes/precisa-navegador.mjs --so-fetch # sem Chromium (mais rápido)
 *
 * NÃO grava nada: não toca no Supabase, não consome Bright Data, não altera acervo.
 * Rodar de datacenter mede a reputação do datacenter, não a fonte — o script avisa e o
 * veredito sai como `indeterminado`.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const CABECALHOS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Site': 'none', 'Sec-Fetch-User': '?1',
};
const ehDesafio = (h) => /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required|enable javascript and cookies/i
  .test(String(h || '').slice(0, 6000));

// Conta o que o parser da fonte contaria — sempre DISTINTOS, como o scraper faz (Set/Map).
const contar = (txt, re) => new Set([...String(txt).matchAll(re)].map(m => m[0].toLowerCase())).size;

/** As 3 fontes, com a MESMA URL e o MESMO marcador que o scraper de produção usa. */
const FONTES = {
  rj: {
    rotulo: 'RJ LEILÕES',
    scraper: 'scripts/scraper-rj.mjs (RJ_HEADLESS=1)',
    latin1: false,
    alvos: [{ nome: 'listagem p.1', url: 'https://www.rjleiloes.com.br/lotes/categoria/imoveis?page=1',
              marcador: /\/item\/\d+\/detalhes/gi, oQueE: 'URLs de lote' }],
    // O detalhe é descoberto a partir da listagem (não dá para fixar um id que expira).
    detalheDe: (txt) => (String(txt).match(/\/item\/\d+\/detalhes/i) || [])[0]
      && 'https://www.rjleiloes.com.br' + String(txt).match(/\/item\/\d+\/detalhes/i)[0],
    marcadorDetalhe: /R\$\s*[\d.]+,\d{2}/g, oQueEDetalhe: 'valores R$',
  },
  pecini: {
    rotulo: 'PECINI',
    scraper: 'scripts/scraper-pecini.mjs (PECINI_HEADLESS=1)',
    latin1: false,
    alvos: [{ nome: 'sitemap.xml', url: 'https://www.pecinileiloes.com.br/sitemap.xml',
              marcador: /\/lote\/[a-z0-9-]+\/\d+\/?/gi, oQueE: 'lotes enumerados' }],
    detalheDe: (txt) => (String(txt).match(/https?:\/\/[^"'<\s]*\/lote\/[a-z0-9-]+\/\d+\/?/i) || [])[0],
    marcadorDetalhe: /R\$\s*[\d.]+,\d{2}/g, oQueEDetalhe: 'valores R$',
  },
  gestao: {
    rotulo: 'GESTÃO DE LEILÕES',
    scraper: 'scripts/scraper-gestao.mjs (GESTAO_HEADLESS=1)',
    latin1: true,   // back-office PHP serve windows-1252; o navegador decodificava sozinho
    alvos: (process.env.GESTAO_DOMINIOS ||
      'granadoleiloes.com.br,lancenoleilao.com.br,extrajustleiloes.com.br,lancetotal.com.br,vincoleiloes.com.br')
      .split(',').map(s => s.trim()).filter(Boolean)
      .map(d => ({ nome: d, url: `https://${d}/`, marcador: /leilao\.php\?idLeilao=\d+/gi, oQueE: 'eventos' })),
    detalheDe: null,   // o evento já traz os lotes inline; a home é o portão
  },
};

/** Fetch puro. Devolve SEMPRE um desfecho nomeado — nunca `null` fazendo as vezes de "vazio". */
async function viaFetch(url, { latin1 = false, timeoutMs = 45000 } = {}) {
  const t0 = Date.now();
  let r;
  try {
    r = await fetch(url, { headers: CABECALHOS, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return { desfecho: 'rede', detalhe: String(e?.message || e).slice(0, 140), ms: Date.now() - t0 };
  }
  const buf = await r.arrayBuffer().catch(() => null);
  if (!buf) return { desfecho: 'rede', detalhe: 'corpo não pôde ser lido', status: r.status, ms: Date.now() - t0 };
  // O charset importa para o GESTAO: em utf-8 os acentos do latin1 viram mojibake e alguns
  // marcadores com acento somem — seria "o site mudou" no lugar de "eu decodifiquei errado".
  const html = new TextDecoder(latin1 ? 'windows-1252' : 'utf-8').decode(buf);
  const ms = Date.now() - t0;
  if (ehDesafio(html)) return { desfecho: 'desafio', status: r.status, bytes: html.length, html, ms };
  if (!r.ok) return { desfecho: `http_${r.status}`, status: r.status, bytes: html.length, html, ms };
  return { desfecho: 'ok', status: r.status, bytes: html.length, html, ms };
}

/** Mesmo alvo pelo Chromium do `fetch-residencial.mjs` — o caminho que roda hoje. */
async function viaNavegador(url, fetchHeadless) {
  const t0 = Date.now();
  const html = await fetchHeadless(url, { timeoutMs: 60000 });
  const ms = Date.now() - t0;
  if (!html) return { desfecho: 'navegador_nulo', ms };       // desafio não resolvido OU erro (o log do módulo diz qual)
  if (ehDesafio(html)) return { desfecho: 'desafio', bytes: html.length, html, ms };
  return { desfecho: 'ok', bytes: html.length, html, ms };
}

function linha(rotulo, r, marcador) {
  const n = r.html ? contar(r.html, marcador) : 0;
  const bytes = r.bytes ? `${(r.bytes / 1024).toFixed(0)} kB` : '—';
  const extra = r.detalhe ? ` (${r.detalhe})` : '';
  return { n, txt: `${rotulo.padEnd(12)} ${String(r.desfecho).padEnd(14)} ${String(n).padStart(4)} marcador(es) · ${bytes.padStart(8)} · ${String(r.ms).padStart(6)} ms${extra}` };
}

async function main() {
  const args = process.argv.slice(2);
  const soFetch = args.includes('--so-fetch');
  const pedidas = args.filter(a => !a.startsWith('--')).map(s => s.toLowerCase());
  const chaves = pedidas.length ? pedidas.filter(k => FONTES[k]) : Object.keys(FONTES);
  const invalidas = pedidas.filter(k => !FONTES[k]);
  if (invalidas.length) { console.error(`fonte desconhecida: ${invalidas.join(', ')} — use: ${Object.keys(FONTES).join(' ')}`); process.exit(2); }

  let fetchHeadless = null, fecharHeadless = null;
  if (!soFetch) {
    try { ({ fetchHeadless, fecharHeadless } = await import('../lib/fetch-residencial.mjs')); }
    catch (e) { console.error(`⚠️ não consegui carregar o caminho do navegador (${String(e?.message || e).slice(0, 90)}) — seguindo só com fetch puro.`); }
  }

  console.log('═══ PRECISA DE NAVEGADOR? ═══');
  console.log(`Rode isto da MÁQUINA RESIDENCIAL. De datacenter o resultado mede a reputação do IP, não a fonte.`);
  console.log(`Marcador = o que o parser de produção conta. "ok" com 0 marcadores NÃO é sucesso.\n`);

  const veredito = [];
  for (const chave of chaves) {
    const f = FONTES[chave];
    console.log(`\n▓▓ ${f.rotulo}  ·  hoje: ${f.scraper}`);
    let somaFetch = 0, somaNav = 0, msFetch = 0, msNav = 0, desafiosFetch = 0, amostraFetch = null;

    for (const alvo of f.alvos) {
      console.log(`  ── ${alvo.nome}  ${alvo.url}`);
      const rf = await viaFetch(alvo.url, { latin1: f.latin1 });
      const lf = linha('fetch puro', rf, alvo.marcador);
      console.log('     ' + lf.txt + `  [${alvo.oQueE}]`);
      somaFetch += lf.n; msFetch += rf.ms;
      if (rf.desfecho === 'desafio') desafiosFetch++;
      if (!amostraFetch && rf.html && lf.n) amostraFetch = rf.html;
      // Corpo curto sem marcador: mostra o começo, senão "0" fica sem explicação nenhuma.
      if (rf.desfecho === 'ok' && !lf.n) console.log('     ⚠️ 200 sem marcador — início do corpo: ' + String(rf.html).slice(0, 220).replace(/\s+/g, ' '));

      if (fetchHeadless) {
        const rn = await viaNavegador(alvo.url, fetchHeadless);
        const ln = linha('navegador', rn, alvo.marcador);
        console.log('     ' + ln.txt);
        somaNav += ln.n; msNav += rn.ms;
      }
    }

    // O detalhe é o segundo portão: há site que libera a listagem e desafia a página interna,
    // e é ela que o scraper abre centenas de vezes. Sem medir isto, "não precisa de navegador"
    // seria uma conclusão tirada do portão mais fácil.
    if (f.detalheDe && amostraFetch) {
      const url = f.detalheDe(amostraFetch);
      if (url) {
        console.log(`  ── detalhe (descoberto na listagem)  ${url}`);
        const rd = await viaFetch(url, { latin1: f.latin1 });
        const ld = linha('fetch puro', rd, f.marcadorDetalhe);
        console.log('     ' + ld.txt + `  [${f.oQueEDetalhe}]`);
        if (rd.desfecho === 'desafio') desafiosFetch++;
        if (rd.desfecho !== 'ok' || !ld.n) somaFetch = 0;   // detalhe barrado invalida o run inteiro
      }
    }

    // ─── VEREDITO — as três respostas possíveis, e "não sei" é uma delas ────────────────
    let v;
    if (desafiosFetch > 0) v = { cor: '🔴', txt: 'PRECISA do navegador — o fetch puro tomou desafio do Cloudflare' };
    else if (somaFetch > 0 && (!fetchHeadless || somaFetch >= somaNav * 0.9))
      v = { cor: '🟢', txt: `NÃO precisa do navegador — fetch puro enxergou ${somaFetch}${fetchHeadless ? ` contra ${somaNav} do navegador` : ''}` };
    else if (somaFetch > 0)
      v = { cor: '🟡', txt: `passa, mas enxerga MENOS (${somaFetch} × ${somaNav}) — investigar antes de trocar` };
    else if (fetchHeadless && somaNav > 0)
      v = { cor: '🔴', txt: `PRECISA do navegador — fetch puro 0, navegador ${somaNav}` };
    else
      v = { cor: '⚪', txt: 'INDETERMINADO — nenhum dos dois caminhos viu nada. Isto NÃO é "não precisa": ou a fonte mudou, ou este IP está bloqueado nos dois. Não conclua daqui.' };
    console.log(`  ${v.cor} ${v.txt}`);
    if (fetchHeadless && somaFetch > 0) console.log(`     tempo: fetch ${(msFetch / 1000).toFixed(1)}s × navegador ${(msNav / 1000).toFixed(1)}s`);
    veredito.push({ chave, rotulo: f.rotulo, ...v });
  }

  if (fecharHeadless) await fecharHeadless();
  console.log('\n═══ RESUMO ═══');
  for (const v of veredito) console.log(`  ${v.cor} ${v.rotulo.padEnd(20)} ${v.txt}`);
  console.log('\nTrocar um 🟢 = remover a env *_HEADLESS=1 da linha da fonte em scripts/runner-residencial.sh');
  console.log('e trocar `fetchHeadless(...)` por fetch puro no `bd()` do scraper (no GESTAO, mantendo o');
  console.log('TextDecoder windows-1252 — o navegador fazia essa decodificação de graça).');
}

main().catch(e => { console.error('falhou:', e); process.exit(1); });
