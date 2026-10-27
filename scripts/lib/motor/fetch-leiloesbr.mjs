/**
 * MOTOR `leiloesbr` (27/10) — transporte da plataforma LeilõesBR (lib/leiloesbr-parse.mjs). Fetch puro do runner do
 * GitHub: nunca Bright Data, nunca Firecrawl.
 *   • O IIS da plataforma devolve 400 a cabeçalho de navegador e 200 "pelado" (medido pelo banco em 27/10, igual ao
 *     que a triagem anotou como `via=pelada`): tenta sem cabeçalho e só então com User-Agent de navegador.
 *   • Catálogo do molde V8 não traz os números no HTML — vêm por AJAX (catalogo-tiposload.asp e
 *     catalogocontentload.asp?iscalc=1). O motor busca os dois e anexa `<!--LBR-NUMEROS {...}-->` ao HTML do catálogo;
 *     se um deles falhar, NÃO anexa nada e o parser devolve "não é catálogo" (nunca um zero inventado).
 */
import { decodificarHtml } from './fetch-fonte.mjs';
import { marcarTenant, dadosListaV8 } from '../leiloesbr-parse.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buscar(url) {
  let ultimo = 'sem resposta';
  for (const headers of [{}, { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }]) {
    try {
      const r = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      const corpo = decodificarHtml(await r.arrayBuffer(), r.headers.get('content-type') || '');
      if (r.ok && corpo) return { corpo };
      ultimo = `HTTP ${r.status}`;
      if (r.status === 404) break;
    } catch (e) {
      ultimo = `rede: ${String(e?.name === 'TimeoutError' ? 'timeout 30s' : e?.cause?.code || e?.message || e).slice(0, 60)}`;
    }
    await sleep(800);
  }
  return { corpo: null, motivo: ultimo };
}

export async function numerosV8(origem, num, buscarFn = buscar) {
  const rt = await buscarFn(`${origem}/templates/catalogo/asp/catalogo-tiposload.asp?leilao=${num}&tipos=`);
  if (!rt.corpo) return { erro: `tipos: ${rt.motivo}` };
  const rc = await buscarFn(`${origem}/templates/catalogo/asp/catalogocontentload.asp?pesquisa=&remote=0&iscalc=1&leilao=${num}&status=`);
  if (!rc.corpo) return { erro: `total: ${rc.motivo}` };
  let tipos, total;
  try {
    const jt = JSON.parse(rt.corpo);
    // {"TEM_ERRO":true,"tipos":[{"MENSAGEM_ERRO":"Nenhum tipo foi encontrado para esse leilão"}]} = catálogo sem peça tipada.
    tipos = (jt.tipos || []).filter((x) => x && x.TIPO);
    total = Number(JSON.parse(rc.corpo).TOTAL);
  } catch { return { erro: 'resposta do catálogo V8 não é JSON' }; }
  if (!Number.isFinite(total)) return { erro: 'catálogo V8 sem TOTAL' };
  return { leilao: String(num), total, tipos };
}

export function criarMotorLeiloesBr() {
  const estado = { semCota: false };
  async function fetchFonte(url) {
    const r = await buscar(url);
    if (/\/listacatalogo\.asp$/i.test(url)) {
      // Lista que não é de nenhum dos dois moldes (ou JSON V8 quebrado) não pode virar "nenhum catálogo ativo".
      const v8 = r.corpo && dadosListaV8(r.corpo);
      const motivo = !r.corpo ? r.motivo
        : v8?.erroParse ? 'lista V8 com JSON ilegível'
        : !v8 && !/<h2>\s*Leil(?:õ|&#245;|o)es\s+(?:finalizados|em\s+andamento|em\s+capta)/i.test(r.corpo) ? 'lista sem molde conhecido (nem V7 nem V8)'
        : null;
      marcarTenant(new URL(url).host, motivo || 'ok');
      if (motivo) return { html: null, via: motivo };
    }
    if (!r.corpo) return { html: null, via: r.motivo };
    const m = url.match(/^(https?:\/\/[^/]+)\/catalogo\.asp\?Num=(\d+)/i);
    if (m && !/class=["']find-numb["']/i.test(r.corpo)) {
      // Catálogo V8: sem `find-numb` no HTML, os números estão no AJAX. Catálogo cujo número não se lê volta como
      // "não abriu" — o runner marca a lista como cortada em vez de contar o catálogo como zero.
      if (!/catalogo-tiposload|carregaTipos/i.test(r.corpo)) return { html: null, via: 'catálogo sem contagem de peças (molde desconhecido)' };
      const n = await numerosV8(m[1], m[2]);
      if (n.erro) return { html: null, via: `catálogo V8 sem números: ${n.erro}` };
      return { html: `${r.corpo}\n<!--LBR-NUMEROS ${JSON.stringify(n)}-->`, via: 'direto' };
    }
    return { html: r.corpo, via: 'direto' };
  }
  return { fetchFonte, estado };
}
