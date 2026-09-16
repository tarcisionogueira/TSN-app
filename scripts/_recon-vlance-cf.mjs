// TEMPORÁRIO — testa se o endpoint de API da Vlance (/core/api/get-leiloes) responde JSON
// via Bright Data para os domínios FERNANDOLEILOEIRO e JONASLEILOEIRO, que foram fingerprinted
// como Vlance em 20/08 mas removidos de TENANTS_PADRAO por devolverem 0 lote (não-JSON) —
// nunca testados especificamente no endpoint de API via Bright Data (só a página HTML foi
// testada em 07/09/16-09). Teste único, proposito='recon' (barato), decide se vale prosseguir.
import './lib/env-runner.mjs';
import { buscarViaBrightData, ErroBrightData } from '../api/_brightdata.js';

const DOMINIOS = [
  { fonte: 'FERNANDOLEILOEIRO', base: 'https://www.fernandoleiloeiro.com.br' },
  { fonte: 'JONASLEILOEIRO', base: 'https://www.jonasleiloeiro.com.br' },
];

async function bd(url) {
  try {
    const r = await buscarViaBrightData(url, { proposito: 'recon', timeoutMs: 40000, exigirOk: false });
    if (!r) return { erro: 'sem resposta' };
    const buf = await r.arrayBuffer();
    const txt = new TextDecoder('utf-8').decode(buf);
    return { status: r.status, len: txt.length, amostra: txt.slice(0, 300) };
  } catch (e) {
    return { erro: e instanceof ErroBrightData ? e.message : String(e) };
  }
}

async function main() {
  for (const { fonte, base } of DOMINIOS) {
    console.log(`\n=== ${fonte} — ${base}/core/api/get-leiloes ===`);
    console.log(JSON.stringify(await bd(`${base}/core/api/get-leiloes`), null, 2));
  }
}
main();
