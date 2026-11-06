/**
 * RECON (06/11): o Hasta (hastaleiloes.com.br) abre a partir do runner, SEM proxy pago? O dono mapeou no navegador
 * (HTML renderizado no servidor, sem API/cookie): lista /lotes/imovel?tipo=imovel&page=N (30/página), detalhe
 * /item/<id>/detalhes, /leiloes/encerrados. A coleta atual usa Chromium + proxy ISP e zerou em 33 de 52 rodadas.
 * Só leitura, User-Agent identificado (o robots.txt veta robôs de IA, libera o acesso geral), pausa entre chamadas.
 */
const UA = 'BidProBrasil-Coletor/1.0 (+https://bidprobrasil.com.br; contato tarcisio@bidprobrasil.com.br)';
const UA_NAV = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ver(url, ua) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': ua, Accept: 'text/html' }, signal: AbortSignal.timeout(30000) });
    const h = await r.text();
    const desafio = /just a moment|cf-chl|challenge-platform|attention required/i.test(h.slice(0, 5000));
    const itens = new Set([...h.matchAll(/\/item\/(\d+)\/detalhes/g)].map((m) => m[1]));
    console.log(`${r.status} ${h.length}B desafio=${desafio} itens=${itens.size} server=${r.headers.get('server')} cf-ray=${r.headers.get('cf-ray') ? 'sim' : 'não'} [${ua === UA ? 'UA próprio' : 'UA navegador'}] ${url}`);
    return { h, itens };
  } catch (e) { console.log(`ERRO ${url}: ${e.message}`); return { h: '', itens: new Set() }; }
}
const B = 'https://www.hastaleiloes.com.br';
for (const ua of [UA, UA_NAV]) {
  await ver(`${B}/`, ua); await sleep(1500);
  const p1 = await ver(`${B}/lotes/imovel?tipo=imovel&page=1`, ua); await sleep(1500);
  await ver(`${B}/lotes/imovel?tipo=imovel&page=17`, ua); await sleep(1500);
  await ver(`${B}/lotes/imovel?tipo=imovel&page=18`, ua); await sleep(1500);
  const id = [...p1.itens][0] || '11752';
  const d = await ver(`${B}/item/${id}/detalhes`, ua); await sleep(1500);
  if (d.h) console.log(`   detalhe ${id}: h1="${(d.h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]?.replace(/<[^>]+>/g, '').trim().slice(0, 80)}" · status="${(d.h.match(/id="status_lote"[^>]*>([\s\S]*?)</i) || [])[1]?.trim()}" · cloudfront=${(d.h.match(/daaotz9z9advj\.cloudfront\.net/g) || []).length}`);
  await ver(`${B}/leiloes/encerrados`, ua); await sleep(1500);
}
