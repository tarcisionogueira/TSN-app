/**
 * Diagnóstico (só leitura, #44): abre páginas de lote com o fetch que guarda cookie e mostra o
 * que o leitor de resultado concluiria. Env: PAGINAS_DIAG (URLs separadas por espaço).
 */
import { fetchComCookies } from './lib/fetch-com-cookies.mjs';
import { apurarResultadoDoTexto } from '../api/_resultado-leilao.js';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
for (const url of String(process.env.PAGINAS_DIAG || '').split(/\s+/).filter(Boolean)) {
  try {
    const { response: r, urlFinal, saltos } = await fetchComCookies(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,*/*;q=0.8' } });
    const html = await r.text();
    const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const trechos = [...txt.matchAll(/.{0,120}(encerrad|vendid|arrematad|sem licit|maior lance|lance atual|situa[çc][ãa]o|status).{0,160}/gi)].slice(0, 6).map((m) => m[0]);
    console.log(`\n===== ${url}\nHTTP ${r.status} · ${html.length} bytes · ${saltos} redirect(s) · final ${urlFinal}`);
    console.log('leitor:', JSON.stringify(apurarResultadoDoTexto(html, urlFinal)));
    for (const t of trechos) console.log('  …', t.trim());
  } catch (e) { console.log(`\n===== ${url}\nFALHOU: ${e.message}`); }
}
