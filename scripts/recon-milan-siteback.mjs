/**
 * RECON (05/11): a API `siteback.milanleiloes.com.br` (mapeada pelo dono no navegador) abre SEM cookie do Cloudflare
 * a partir de um servidor? Só leitura, GET públicos que o próprio site usa; nunca grava, nunca toca /api/public (que
 * exige o cookie do desafio — contornar o desafio não é opção). Imprime status, tipo e um resumo de cada resposta.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const H = { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Origin: 'https://milanleiloes.com.br', Referer: 'https://milanleiloes.com.br/' };
async function ver(url, { json = true } = {}) {
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(30000) });
    const ct = r.headers.get('content-type') || '';
    const buf = Buffer.from(await r.arrayBuffer());
    let resumo = buf.subarray(0, 160).toString('utf8').replace(/\s+/g, ' ');
    let corpo = null;
    if (json && /json/.test(ct)) { try { corpo = JSON.parse(buf.toString('utf8')); } catch { /* corpo não-JSON: o resumo já mostra */ } }
    console.log(`${r.status} ${ct.split(';')[0]} ${buf.length}B  ${url}\n   ${resumo}`);
    return corpo;
  } catch (e) { console.log(`ERRO ${url}: ${e.message}`); return null; }
}
const agenda = await ver('https://siteback.milanleiloes.com.br/leiloes/agenda?tipoCat=8&limit=0');
const lista = Array.isArray(agenda) ? agenda : (agenda?.conteudo || agenda?.leiloes || agenda?.data || []);
console.log(`\nEVENTOS DE IMÓVEIS na agenda: ${lista.length}`);
for (const ev of lista.slice(0, 40)) console.log(`  ${ev.codLeilao} · tipo ${ev.tipoLeilao} · ${String(ev.tituloLeilao || '').slice(0, 70)} · 1ª ${ev.praca1Minimo ?? '-'} · 2ª ${ev.praca2Minimo ?? '-'} · fim ${ev.dataFim ?? ''}`);
const cods = lista.slice(0, 3).map((e) => e.codLeilao).filter(Boolean);
for (const c of cods) {
  const ev = await ver(`https://siteback.milanleiloes.com.br/leiloes/${c}`);
  if (ev) console.log('   chaves:', Object.keys(ev).join(', '), '\n   localFotos:', ev.localFotos, '· visitacao:', String(ev.visitacao || '').slice(0, 80));
  await ver(`https://siteback.milanleiloes.com.br/leiloes/${c}/leilao-lote`);
}
if (cods[0]) await ver(`https://adm.milanleiloes.com.br/images/FotosLeiloes/${cods[0]}.jpg`, { json: false });
// Controle: a rota protegida, só para registrar que ela barra o servidor (sem tentar contornar).
await ver('https://milanleiloes.com.br/api/public/leiloes/15666/lotes/lista');
