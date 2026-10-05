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
// VIA BANCO (29/09): a página buscada pelo SERVIDOR DO BANCO (pg_net, AWS) — grátis. UBERLANDIALEILOES
// dá 403 ao runner do GitHub e ao PC do dono, e 200 ao banco (14 leilões na home, medido). Dois
// passos porque o pg_net só dispara depois do commit (supabase/migrations/20260929_pagina_pelo_banco.sql).
// Desliga com MOTOR_VIA_BANCO=0. Devolve { html } ou { html: null, motivo } — nunca lança.
export async function viaBanco(url) {
  const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  if (process.env.MOTOR_VIA_BANCO === '0') return { html: null, motivo: 'desligada' };
  if (!SB || !KEY) return { html: null, motivo: 'sem credencial do banco' };
  const rpc = async (fn, body) => {
    const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${fn} HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 80)}`);
    return r.json();
  };
  try {
    const id = await rpc('pagina_pedir', { p_url: url });
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const [row] = await rpc('pagina_ler', { p_id: id });
      if (!row?.pronto) continue;
      if (row.status >= 200 && row.status < 300 && row.conteudo && !ehChallenge(row.conteudo)) return { html: row.conteudo };
      return { html: null, motivo: row.erro ? String(row.erro).slice(0, 60) : (row.status >= 200 && row.status < 300 ? 'challenge' : `HTTP ${row.status}`) };
    }
    return { html: null, motivo: 'sem resposta em 30s' };
  } catch (e) { return { html: null, motivo: String(e?.message || e).slice(0, 80) }; }
}

// CHARSET (05/10, NAKAKOGUE: `<meta charset=iso-8859-1>` com os DADOS em UTF-8). `r.text()` decodifica
// sempre como UTF-8 — site Latin-1 de verdade viraria "Im�veis" em silêncio. Mas página MISTA existe:
// a 1ª versão redecodificava a página inteira ao ver UM U+FFFD e transformou "Imóveis" em "ImÃ³veis"
// (60 de 60 lotes recusados no dry-run). Decide pelo MENOR estrago: U+FFFD no UTF-8 × mojibake
// ("Ã³", "Ã§") no windows-1252. Fonte que já vinha certa (sem U+FFFD) não muda um byte.
export function decodificarHtml(buf, contentType = '') {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  const quebrasUtf8 = (utf8.match(/\uFFFD/g) || []).length;
  if (!quebrasUtf8) return utf8;
  const declarado = `${contentType} ${utf8.slice(0, 3000).match(/charset=["']?([\w-]+)/i)?.[1] || ''}`;
  if (!/iso-?8859-?1|latin-?1|windows-1252/i.test(declarado)) return utf8;
  const latin = new TextDecoder('windows-1252').decode(buf);
  const mojibake = (latin.match(/[ÃÂ][\u0080-\u00BF]/g) || []).length;
  return mojibake < quebrasUtf8 ? latin : utf8;
}
async function textoComCharset(r) {
  let buf;
  try { buf = await r.arrayBuffer(); } catch { return ''; } // padrao-ok: corpo ilegível = "corpo vazio", o chamador registra o motivo
  return decodificarHtml(buf, r.headers.get('content-type') || '');
}

export function criarMotorFetch(proposito) {
  const estado = { semCota: false };
  // DISJUNTOR POR HOST (revisão 29/09): sem memória, fonte que SEMPRE é Cloudflare (leilaobrasil,
  // emiliomatos) pagava ~20 s do direto + até 30 s do banco em CADA página antes do Bright Data —
  // risco de estourar o teto do job. Banco falhou 2× no host → pula o banco nele; banco funcionou e
  // o direto falhou → pula o direto nele. Vale só nesta execução (o próximo run reaprende).
  const hostDe = (u) => { try { return new URL(u).host; } catch { return ''; } };
  const bancoFalhas = new Map();
  const diretoInutil = new Set();

  async function fetchFonte(url, { timeoutMs = 45000, semBD = false } = {}) {
    const host = hostDe(url);
    // 1) VIA GRÁTIS — fetch direto do runner (custo zero). Só aceita HTML que não seja challenge.
    // `porQueGratis` (27/09): o motivo da recusa era engolido e a saúde dizia só "sem nenhum
    // lote pronto" — LEJE e FREITAS falharam do PC do dono sem ninguém saber se foi 403,
    // challenge ou rede. Agora o motivo segue no `via` até o registro de saúde.
    let porQueGratis = null;
    if (diretoInutil.has(host)) porQueGratis = 'direto pulado (banco serve este host)';
    else try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 20000);
      const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,application/xhtml+xml' } });
      clearTimeout(t);
      if (r.ok) {
        const html = await textoComCharset(r);
        if (html && !ehChallenge(html)) return { html, via: 'gratis' };
        porQueGratis = html ? 'challenge' : 'corpo vazio';
      } else porQueGratis = `HTTP ${r.status}`;
    } catch (e) { porQueGratis = `rede: ${String(e?.name === 'AbortError' ? 'timeout 20s' : e?.cause?.code || e?.message || e).slice(0, 60)}`; }

    // 1b) VIA BANCO — grátis, outro IP (AWS). Antes de gastar Bright Data.
    if ((bancoFalhas.get(host) || 0) >= 2) porQueGratis = `${porQueGratis} · banco: pulado (2 falhas neste host)`;
    else {
      const banco = await viaBanco(url);
      if (banco.html) { bancoFalhas.set(host, 0); diretoInutil.add(host); return { html: banco.html, via: 'banco' }; }
      bancoFalhas.set(host, (bancoFalhas.get(host) || 0) + 1);
      porQueGratis = `${porQueGratis} · banco: ${banco.motivo}`;
    }

    if (semBD) return { html: null, via: `sem-bd (grátis: ${porQueGratis})` };

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
