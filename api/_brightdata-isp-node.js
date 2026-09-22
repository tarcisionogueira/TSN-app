/**
 * Proxy ISP do Bright Data — usa `undici` (`ProxyAgent`), que importa módulos nativos do
 * Node (`node:tls`, `node:net`, ...). SÓ pode ser importado por chamadores Node.js Runtime
 * (`enriquecer-lote.js`, `apurar-resultado-leilao-cron.js`) — NUNCA por `_brightdata.js`, que
 * também é importado por Edge Functions (ex. `api/baixar-doc.js`); o Edge Runtime não suporta
 * esses módulos e quebra o BUILD inteiro (não só a rota) se este código estiver no caminho de
 * import de uma Edge Function, mesmo atrás de um `import()` dinâmico (achado em 22/09: o
 * especificador literal `'undici'` é detectado estaticamente pelo bundler da Vercel).
 *
 * Produto SEPARADO do Web Unlocker (`_brightdata.js`) — custo fixo por IP+tráfego, não por
 * requisição, sem o freio de cota (`brightdata_uso`). Mesmas credenciais que
 * `scripts/lib/motor/proxy-isp.mjs` já usa pro Puppeteer (BRIGHTDATA_ISP_HOST/USER/PASS).
 */

let _agenteProxyIsp; // reaproveitado entre chamadas da mesma invocação — evita reabrir conexão
async function agenteProxyIsp() {
  if (_agenteProxyIsp !== undefined) return _agenteProxyIsp;
  const { proxyIspDisponivel, proxyIspServidor, proxyIspCredenciais } = await import('../scripts/lib/motor/proxy-isp.mjs');
  if (!proxyIspDisponivel()) { _agenteProxyIsp = null; return null; }
  try {
    const { ProxyAgent } = await import('undici');
    const { username, password } = proxyIspCredenciais();
    const u = new URL(proxyIspServidor());
    u.username = encodeURIComponent(username);
    u.password = encodeURIComponent(password);
    _agenteProxyIsp = new ProxyAgent(u.toString());
  } catch (e) {
    console.error('[brightdata-isp] agente indisponível:', String(e?.message || e).slice(0, 160));
    _agenteProxyIsp = null;
  }
  return _agenteProxyIsp;
}

/**
 * Busca via proxy ISP do Bright Data. NUNCA lança: proxy não configurado, erro de rede, timeout
 * ou resposta ruim devolvem null — o chamador cai pro caminho normal (mesma convenção de
 * `fetchViaBrightData`). Uso é OPT-IN: só chame quando o caminho de cota já recusou E o
 * custo fixo valer a pena pra este caso.
 */
export async function buscarViaProxyIsp(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const agente = await agenteProxyIsp();
  if (!agente) return null;
  try {
    return await fetch(url, { headers, dispatcher: agente, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    console.error('[brightdata-isp] falha:', String(e?.message || e).slice(0, 160));
    return null;
  }
}
