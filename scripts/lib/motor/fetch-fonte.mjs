/**
 * MOTOR DE FETCH (Passo 0 do redesenho fetch × parse) — extraído SEM MUDANÇA de comportamento
 * dos scrapers scraper-leilaopro.mjs e scraper-emiliomatos.mjs, que traziam este mesmo código
 * copiado (fetchLP / fetchEM). Estratégia única: tenta a via GRÁTIS (fetch direto do runner) e,
 * se vier vazio/challenge/erro, cai para BRIGHT DATA respeitando a cota (proposito por fonte).
 *
 * É esta função que a matriz do desenho chama de "gratis" e "bd" ao mesmo tempo: quem trabalha
 * na via grátis (leffa) nunca chega ao BD; quem é Cloudflare (leilaobrasil) sempre cai nele. A
 * NATUREZA da fonte decide o caminho — o motor é o mesmo. `semBD:true` força só a via grátis.
 */
import { buscarViaBrightData, ErroBrightData } from '../../../api/_brightdata.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ehChallenge = h => !h || /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required/i.test(h.slice(0, 4000));

// Cria um motor de fetch ligado a um `proposito` (a chave de cota do Bright Data). Devolve a
// função de busca + um `estado` observável (semCota) que o runner lê para a saúde da fonte.
export function criarMotorFetch(proposito) {
  const estado = { semCota: false };

  async function fetchFonte(url, { timeoutMs = 45000, semBD = false } = {}) {
    // 1) VIA GRÁTIS — fetch direto do runner (custo zero). Só aceita HTML que não seja challenge.
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 20000);
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,application/xhtml+xml' } });
      clearTimeout(t);
      if (r.ok) {
        const html = await r.text().catch(() => '');
        if (html && !ehChallenge(html)) return { html, via: 'gratis' };
      }
    } catch { /* cai p/ Bright Data */ }

    if (semBD) return { html: null, via: 'sem-bd' };

    // 2) VIA BRIGHT DATA — passa Cloudflare, cobrado por chamada, respeita a cota do proposito.
    try {
      const bd = await buscarViaBrightData(url, { proposito, timeoutMs, exigirOk: false });
      if (!bd.ok) return { html: null, via: 'bloqueado' };
      return { html: await bd.text().catch(() => null), via: 'brightdata' };
    } catch (e) {
      if (e instanceof ErroBrightData) {
        if (e.semCota) estado.semCota = true;
        return { html: null, via: e.semCota ? 'sem-cota' : 'bloqueado', semCota: !!e.semCota };
      }
      throw e;
    }
  }

  return { fetchFonte, estado };
}
