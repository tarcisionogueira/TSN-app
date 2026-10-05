/**
 * fetch que GUARDA COOKIE entre redirecionamentos (05/10, #44 — VIP).
 * leilaovip.com.br responde a página do lote com redirecionamento que GRAVA um cookie e manda
 * voltar para a mesma URL; o `fetch` padrão segue o redirect sem reenviar o cookie e entra em
 * laço até estourar ("redirect count exceeded"). Foram 83 de 93 páginas "não abriu" no runner
 * residencial de 05/10. Aqui o redirecionamento é seguido à mão, levando os cookies recebidos.
 */
export async function fetchComCookies(url, { headers = {}, maxSaltos = 8, timeoutMs = 20000 } = {}) {
  const jar = new Map();
  let atual = url;
  const fim = Date.now() + timeoutMs;
  for (let salto = 0; salto <= maxSaltos; salto++) {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(atual, {
      redirect: 'manual',
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(Math.max(1000, fim - Date.now())),
    });
    for (const sc of (typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [])) {
      const [par] = sc.split(';');
      const i = par.indexOf('=');
      if (i > 0) jar.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
    }
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      atual = new URL(r.headers.get('location'), atual).toString();
      continue;
    }
    return { response: r, urlFinal: atual, saltos: salto };
  }
  throw new Error(`redirecionamentos demais (${maxSaltos}) mesmo levando cookie`);
}
