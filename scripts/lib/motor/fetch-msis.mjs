/**
 * MOTOR `msis` (26/10) — transporte da plataforma MSIS (lib/msis-parse.mjs). Duas coisas que o motor padrão não faz:
 *
 *  1. O CATÁLOGO INTEIRO SÓ VEM POR POST DE FORMULÁRIO. `Principal.asp` por GET traz a 1ª página dos destaques;
 *     `acaoDest=N&pag=<n>` (POST) traz todos os leilões, 12 por página. Este motor busca TODAS as páginas na 1ª
 *     chamada e devolve o HTML concatenado — o laço de páginas do runner recebe a mesma lista de novo na 2ª chamada
 *     e para (nenhum leilão novo). Página do LEILÃO com mais de uma página de lotes ("Total: N lotes / P páginas")
 *     idem: POST `pag` em `Leilao.asp?zz=`.
 *  2. PARTE DOS TENANTS DÁ DESAFIO DO CLOUDFLARE AO RUNNER DO GITHUB (BSP e Adriana Yuan, medido em 26/10) e abre
 *     pelo banco. A via banco é grátis: GET por `pagina_pedir_pelada`, POST por `pagina_postar_form` (fila do pg_net
 *     com corpo x-www-form-urlencoded). Host que recusou o direto vai direto ao banco no resto da rodada.
 *
 * Nunca Bright Data, nunca Firecrawl. Página que não abriu derruba a lista daquele tenant (nunca entrega metade como
 * se fosse tudo) e o motivo vai no `via` até `fonte_saude`.
 *
 * `COBERTURA` (exportado): por host, o que o SITE declara × o que foi lido — leilões no catálogo (todos/abertos) e
 * "Total: N lotes" de cada leilão aberto × blocos de lote lidos. O coletor imprime a tabela no fim (prova de
 * completude, lição FREITAS: rolagem infinita que lia 12 de 135).
 */
import { ultimaPagina, cardsDoCatalogo, totalDeclarado, RE_ENCERRADO } from '../msis-parse.mjs';
import { decodificarHtml } from './fetch-fonte.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ehChallenge = (h) => !h || /just a moment|challenge-platform\/h\/|cf-chl|attention required/i.test(String(h).slice(0, 4000));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX_PAGINAS = 40;

export const COBERTURA = new Map();
const cob = (host) => {
  if (!COBERTURA.has(host)) COBERTURA.set(host, { paginas: 0, leiloes: 0, abertos: 0, declarados: 0, lidos: 0, leiloesLidos: 0, via: new Set(), falhas: [] });
  return COBERTURA.get(host);
};

export function criarMotorMsis() {
  const estado = { semCota: false };
  const soBanco = new Set();
  const catalogo = new Map();

  async function direto(url, form) {
    const opts = { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: 'text/html,application/xhtml+xml' }, signal: AbortSignal.timeout(25000) };
    if (form) { opts.method = 'POST'; opts.headers['Content-Type'] = 'application/x-www-form-urlencoded'; opts.body = new URLSearchParams(form).toString(); }
    try {
      let r = await fetch(url, opts);
      if (r.status === 400) r = await fetch(url, { method: opts.method, body: opts.body, headers: form ? { 'Content-Type': opts.headers['Content-Type'] } : {}, signal: AbortSignal.timeout(25000) });
      const html = decodificarHtml(await r.arrayBuffer(), r.headers.get('content-type') || '');
      if (r.ok && !ehChallenge(html)) return { html };
      return { html: null, motivo: r.ok ? 'challenge' : `HTTP ${r.status}${ehChallenge(html) ? ' (Cloudflare)' : ''}` };
    } catch (e) { return { html: null, motivo: `rede: ${String(e?.name === 'TimeoutError' ? 'timeout 25s' : e?.cause?.code || e?.message || e).slice(0, 60)}` }; }
  }

  async function banco(url, form) {
    const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SB || !KEY) return { html: null, motivo: 'banco: sem credencial' };
    const rpc = async (fn, body) => {
      const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, { method: 'POST', signal: AbortSignal.timeout(15000), headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`${fn} HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 80)}`);
      return r.json();
    };
    try {
      const id = form ? await rpc('pagina_postar_form', { p_url: url, p_campos: form }) : await rpc('pagina_pedir_pelada', { p_url: url });
      for (let i = 0; i < 40; i++) {
        await sleep(1000);
        const [row] = await rpc('pagina_ler', { p_id: id });
        if (!row?.pronto) continue;
        if (row.status >= 200 && row.status < 300 && row.conteudo && !ehChallenge(row.conteudo)) return { html: row.conteudo };
        return { html: null, motivo: `banco: ${row.erro ? String(row.erro).slice(0, 60) : `HTTP ${row.status}`}` };
      }
      return { html: null, motivo: 'banco: sem resposta em 40s' };
    } catch (e) { return { html: null, motivo: `banco: ${String(e?.message || e).slice(0, 80)}` }; }
  }

  // Direto primeiro (grátis, sem fila); recusado → banco, e o host fica no banco o resto da rodada.
  async function pedir(url, form) {
    const host = new URL(url).host;
    let porQue = null;
    if (!soBanco.has(host)) {
      const d = await direto(url, form);
      if (d.html) { cob(host).via.add('direto'); return d; }
      porQue = d.motivo;
      if (!/^rede/.test(d.motivo)) soBanco.add(host);
    }
    const b = await banco(url, form);
    if (b.html) { cob(host).via.add('banco'); return b; }
    return { html: null, motivo: `${porQue ? `direto: ${porQue} · ` : ''}${b.motivo}` };
  }
  // Uma 2ª tentativa por página: falha passageira não pode derrubar a lista inteira do tenant.
  const pedirComRetry = async (url, form) => { const r = await pedir(url, form); if (r.html) return r; await sleep(1500); return pedir(url, form); };

  async function lerCatalogo(base) {
    const host = new URL(base).host;
    const url = `${base}/Principal.asp`;
    const p1 = await pedirComRetry(url, { acaoDest: 'N', pag: '1' });
    if (!p1.html) return { html: null, via: `catálogo: ${p1.motivo}` };
    // O seletor pode mostrar só uma janela de páginas: o teto é recalculado a cada página lida.
    let ult = Math.min(ultimaPagina(p1.html), MAX_PAGINAS);
    const paginas = [p1.html];
    for (let p = 2; p <= ult; p++) {
      await sleep(500);
      const r = await pedirComRetry(url, { acaoDest: 'N', pag: String(p) });
      if (!r.html) { cob(host).falhas.push(`catálogo pág ${p}: ${r.motivo}`); return { html: null, via: `catálogo página ${p}/${ult} não abriu: ${r.motivo}` }; }
      paginas.push(r.html);
      ult = Math.min(Math.max(ult, ultimaPagina(r.html)), MAX_PAGINAS);
    }
    const html = paginas.join('\n<!-- msis: proxima pagina do catalogo -->\n');
    const c = cob(host);
    const cards = cardsDoCatalogo(html);
    c.paginas = paginas.length; c.leiloes = new Set(cards.map((x) => x.zz)).size;
    c.abertos = new Set(cards.filter((x) => !(x.status && RE_ENCERRADO.test(x.status))).map((x) => x.zz)).size;
    if (ultimaPagina(paginas[paginas.length - 1]) > paginas.length) c.falhas.push(`catálogo com mais de ${paginas.length} páginas — teto ${MAX_PAGINAS}`);
    return { html, via: [...c.via].join('+') || 'direto' };
  }

  async function lerLeilao(base, zz) {
    const host = new URL(base).host;
    const url = `${base}/Leilao.asp?zz=${zz}`;
    const p1 = await pedirComRetry(url, null);
    if (!p1.html) { cob(host).falhas.push(`leilão ${zz}: ${p1.motivo}`); return { html: null, via: `leilão: ${p1.motivo}` }; }
    const tot = totalDeclarado(p1.html);
    const paginas = [p1.html];
    for (let p = 2; p <= Math.min(tot?.paginas || 1, MAX_PAGINAS); p++) {
      await sleep(500);
      const r = await pedirComRetry(url, { pag: String(p), n: '', nl: '', na: '', naOld: '', nlo: '' });
      if (!r.html) { cob(host).falhas.push(`leilão ${zz} pág ${p}: ${r.motivo}`); return { html: null, via: `leilão página ${p}: ${r.motivo}` }; }
      paginas.push(r.html);
    }
    const html = paginas.join('\n<!-- msis: proxima pagina do leilao -->\n');
    const c = cob(host);
    c.leiloesLidos += 1;
    c.declarados += tot?.lotes ?? 0;
    c.lidos += new Set([...html.matchAll(/id=["']divLote(\d+)["']/gi)].map((m) => m[1])).size;
    return { html, via: [...c.via].join('+') || 'direto' };
  }

  async function fetchFonte(url) {
    let u; try { u = new URL(url); } catch { return { html: null, via: 'url inválida' }; }
    const base = `${u.protocol}//${u.host}`;
    if (/\/Principal\.asp$/i.test(u.pathname)) {
      if (!catalogo.has(base)) catalogo.set(base, await lerCatalogo(base));
      return catalogo.get(base);
    }
    if (/\/Leilao\.asp$/i.test(u.pathname) && u.searchParams.get('zz')) return lerLeilao(base, u.searchParams.get('zz'));
    const r = await pedirComRetry(url, null);
    return r.html ? { html: r.html, via: 'direto' } : { html: null, via: r.motivo };
  }

  return { fetchFonte, estado };
}

/** Tabela de completude: domínio | leilões no site (abertos) | lotes declarados | lidos | páginas | ok. */
export function tabelaCobertura() {
  const linhas = ['domínio | leilões site (abertos) | lotes declarados nos abertos | lotes lidos | páginas catálogo | via | ok'];
  for (const [host, c] of COBERTURA) {
    const pct = c.declarados ? Math.round((100 * c.lidos) / c.declarados) : (c.leiloesLidos || c.paginas ? 100 : 0);
    linhas.push(`${host} | ${c.leiloes} (${c.abertos}) | ${c.declarados} | ${c.lidos} | ${c.paginas} | ${[...c.via].join('+') || '-'} | ${pct >= 90 && !c.falhas.length ? 'ok' : `NÃO (${pct}%${c.falhas.length ? ` · ${c.falhas.slice(0, 2).join(' · ')}` : ''})`}`);
  }
  return linhas.join('\n');
}
