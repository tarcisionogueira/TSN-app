/**
 * O LINK DO ANÚNCIO EXISTE? (15/11, dono: "os anúncios não abrem na busca do Índice").
 *
 * A pesquisa do Índice é feita por IA com busca na web, e o link (e o número) de cada amostra é o que o modelo
 * ESCREVE. Medido em Capão da Canoa (17 amostras, 15/11): Zap/VivaReal com IDs SEQUENCIAIS em portais diferentes
 * (2503947476…80), 9 em 404, OLX redirecionando para a home, um "Rua Guaraci" de Capão apontando para Mathias Velho
 * (Canoas). Nenhuma confirmável — e o Índice da cidade era feito delas.
 *
 * Regra: só condena com PROVA. 404/410 = morto; redirecionado para a raiz do site (OLX, imobiliária) = morto. 403,
 * 429, 5xx, timeout, anti-robô = INCERTO (não é prova de nada — o portal pode só estar barrando o servidor). A amostra
 * com link morto não entra; a incerta entra como antes.
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/** Veredito puro de uma resposta: 'morto' | 'vivo' | 'incerto'. `final` = URL depois dos redirecionamentos. */
export function vereditoLink({ url, status, final }) {
  if (status === 404 || status === 410) return 'morto';
  if (status >= 200 && status < 300) {
    try {
      const a = new URL(url), b = new URL(final || url);
      const raiz = (p) => p.replace(/\/+$/, '') === '' || /^\/(imoveis|busca|home|index(\.\w+)?)?\/?$/i.test(p);
      // Pediu um anúncio (caminho com conteúdo) e caiu na raiz/listagem genérica do site: o anúncio não existe.
      if (!raiz(a.pathname) && raiz(b.pathname) && a.hostname.replace(/^www\./, '') === b.hostname.replace(/^www\./, '')) return 'morto';
    } catch (e) { return 'incerto'; }   // URL ilegível: sem prova para condenar
    return 'vivo';
  }
  return 'incerto';
}

/** Confere vários links em paralelo, com teto de tempo TOTAL. Devolve Map url → veredito. Nunca lança. */
export async function checarLinks(urls, { timeoutMs = 6000, concorrencia = 8, tetoTotalMs = 15000 } = {}) {
  const unicos = [...new Set((urls || []).filter((u) => /^https?:\/\//i.test(String(u || ''))))];
  const out = new Map();
  const fim = Date.now() + tetoTotalMs;
  let i = 0;
  async function trabalhador() {
    while (i < unicos.length) {
      const url = unicos[i++];
      if (Date.now() > fim) { out.set(url, 'incerto'); continue; }
      try {
        const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'pt-BR' },
          signal: AbortSignal.timeout(Math.min(timeoutMs, Math.max(1000, fim - Date.now()))) });
        out.set(url, vereditoLink({ url, status: r.status, final: r.url }));
        r.body?.cancel?.().catch(() => {});   // só o status importa: não baixa a página inteira
      } catch (e) {
        out.set(url, 'incerto');   // rede/timeout não é prova de link morto
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, unicos.length) }, trabalhador));
  return out;
}

/** Tira das amostras as que têm link PROVADAMENTE morto. Devolve { vivas, mortas, incertas }. */
export async function semLinksMortos(amostras, opts) {
  const lista = Array.isArray(amostras) ? amostras : [];
  const vered = await checarLinks(lista.map((a) => a?.url), opts);
  const mortas = lista.filter((a) => a?.url && vered.get(a.url) === 'morto');
  return { vivas: lista.filter((a) => !(a?.url && vered.get(a.url) === 'morto')), mortas: mortas.length,
    incertas: [...vered.values()].filter((v) => v === 'incerto').length };
}
