#!/usr/bin/env node
/**
 * Enriquecimento de DATAS da Caixa (CEF) — ROTA 2, no runner do GitHub (grátis).
 *
 * A data de licitação/leilão da Caixa é renderizada por JavaScript — um fetch cru
 * pega o HTML "vazio" (confirmado: 1000 páginas, 0 datas). Então visitamos cada
 * página NO NAVEGADOR (puppeteer) e lemos o texto RENDERIZADO — mesma técnica que
 * resolveu o ZUK (42 → 539). Venda direta é venda contínua (sem data) e é ignorada.
 *
 * Pool de páginas + deadline: processa um lote por execução (rotaciona por
 * enriquecido_em) para caber no timeout da Action; execuções seguintes cobrem o resto.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcional: CEF_DATAS_LIMITE, CEF_DATAS_CONC.
 */
import puppeteer from 'puppeteer';
import { createClient } from '@supabase/supabase-js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.CEF_DATAS_LIMITE || '4000', 10);
const CONC = parseInt(process.env.CEF_DATAS_CONC || '2', 10); // gentil = sustenta mais antes do bloqueio da Caixa
const DEADLINE = Date.now() + 75 * 60 * 1000; // para antes do timeout de 90 min
const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BROWSER_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1280,900'];

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB, KEY);

// A página da Caixa às vezes volta como erro de borda (504/CloudFront): um HTML
// minúsculo "Server Error / Status Code 504". networkidle2 "carrega" essa página
// sem falhar, mas ela NÃO tem data — se tratada como "sem data" e marcada como
// enriquecida, o imóvel nunca mais é tentado. Detectamos o erro para RE-tentar.
function paginaComErro(txt) {
  if (!txt || txt.length < 500) return true;
  if (/server error|status code\s*5\d\d|request id|erro inesperado|forbidden|access denied|indispon[íi]vel/i.test(txt)) return true;
  // A página válida de detalhe sempre traz "Número do imóvel".
  if (!/n[úu]mero do im[óo]vel/i.test(txt)) return true;
  return false;
}

// Extrai a data do TEXTO renderizado. A página de detalhe da Caixa traz a data
// INLINE, com rótulos específicos por modalidade (confirmado no diagnóstico):
//   Leilão SFI / extrajudicial → "Data do 1º Leilão - DD/MM/AAAA" (+ 2º Leilão)
//   Licitação Aberta          → "Data da Licitação Aberta - DD/MM/AAAA"
// Usamos a data mais próxima no futuro (para leilão único, o 1º leilão).
function extrairDataLeilao(txt) {
  if (!txt) return null;
  const ontem = Date.now() - 86400000;
  const limite = Date.now() + 400 * 86400000;
  const futuras = [];
  const push = (d, mo, y) => {
    const yy = y.length === 2 ? '20' + y : y;
    const t = Date.parse(`${yy}-${mo}-${d}`);
    if (!isNaN(t) && t >= ontem && t < limite) futuras.push(t);
  };
  // Rótulos específicos da Caixa (mais confiáveis).
  const alvos = /(?:data do 1[ºo°]?\s*leil[ãa]o|data do 2[ºo°]?\s*leil[ãa]o|data da licita[çc][ãa]o aberta|data do leil[ãa]o)\s*[-–:]?\s*(\d{2})\/(\d{2})\/(\d{2,4})/gi;
  let m;
  while ((m = alvos.exec(txt))) push(m[1], m[2], m[3]);
  // Fallback genérico (licitações/propostas com outros rótulos).
  if (!futuras.length) {
    const re = /(?:leil[ãa]o|pra[çc]a|encerra|licita[çc][ãa]o|proposta|recebimento|limite|abertura|data)[^0-9]{0,40}(\d{2})\/(\d{2})\/(\d{2,4})/gi;
    while ((m = re.exec(txt))) push(m[1], m[2], m[3]);
  }
  if (!futuras.length) return null;
  return new Date(Math.min(...futuras)).toISOString().slice(0, 10);
}

// Extrai a URL do "Baixar edital e anexos". O controle da Caixa NÃO é um <a href>
// simples (diagnóstico: âncoras com pdf/edital no href = []); vem via onclick (ex.:
// window.open('/editais/...pdf')) ou action de <form>. Esta função RODA NO NAVEGADOR
// (passada a page.evaluate) e inspeciona o DOM: onclick/href de botões e links com
// "edital"/"anexo", qualquer atributo que referencie /editais/ · .pdf · .asp?...edital,
// e o action de <form> próximo. Devolve a melhor URL absoluta (resolvida contra a
// origem) ou null, mais uma amostra do outerHTML do controle para diagnóstico.
function extrairLinkEdital() {
  try {
    const abs = (u) => { if (!u) return null; try { return new URL(u.trim(), location.href).href; } catch { return null; } };
    // parece link de edital/PDF de fato?
    const bom = (u) => !!u && /(\/editais?\/|\.pdf(\?|#|$)|edital[^/"']*\.(?:pdf|asp)|\.asp\?[^"'\s]*edital)/i.test(u);
    // extrai a 1ª URL de dentro de um trecho de JS (onclick), ex.: window.open('...').
    const urlDeJS = (s) => {
      if (!s) return null;
      const m = s.match(/(?:https?:\/\/[^'"\s)]+|\/[^'"\s)]+|[\w.\-/]+\.(?:pdf|asp)[^'"\s)]*)/i);
      return m ? m[0] : null;
    };
    let amostra = null;
    // 1) elementos explicitamente ligados a "edital"/"anexo".
    const ligados = Array.from(document.querySelectorAll('a,button,input,[onclick]')).filter((el) => {
      const t = [el.textContent, el.value, el.getAttribute('onclick'), el.getAttribute('href'),
        el.id, el.className, el.getAttribute('title')].join(' ');
      return /edital|anexo/i.test(t);
    });
    for (const el of ligados) {
      if (!amostra) amostra = (el.outerHTML || '').slice(0, 200);
      const cand = abs(el.getAttribute('href'))
        || abs(urlDeJS(el.getAttribute('onclick')))
        || abs(el.closest('form') && el.closest('form').getAttribute('action'));
      if (bom(cand)) return { url: cand, amostra };
    }
    // 2) varredura ampla: qualquer onclick/href/action na página que pareça edital.
    for (const el of Array.from(document.querySelectorAll('[onclick],[href],[action]'))) {
      const cand = abs(urlDeJS(el.getAttribute('onclick'))) || abs(el.getAttribute('href')) || abs(el.getAttribute('action'));
      if (bom(cand)) return { url: cand, amostra };
    }
    return { url: null, amostra };
  } catch { return { url: null, amostra: null }; }
}

async function novaPagina(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  try {
    await page.setRequestInterception(true);
    // A data/edital vêm SERVER-SIDE no HTML (confirmado: sem XHR). Então cortamos
    // TUDO que não é o documento: imagens/mídia/fontes/css e os scripts de
    // analytics/ads de terceiros (GA, GTM, DoubleClick, Clarity...). Página mínima
    // = muito mais rápida por imóvel = MAIS imóveis por run antes do bloqueio de IP.
    const BLOCK_HOST = /google-analytics|googletagmanager|doubleclick|googlesyndication|googleadservices|google\.com\/(ads|pagead)|clarity\.ms|facebook\.|connect\.facebook|hotjar|\/collect\b/i;
    page.on('request', req => {
      const t = req.resourceType();
      if (t === 'image' || t === 'media' || t === 'font' || t === 'stylesheet') return req.abort();
      if ((t === 'script' || t === 'xhr' || t === 'fetch' || t === 'other') && BLOCK_HOST.test(req.url())) return req.abort();
      req.continue();
    });
  } catch { /* segue sem interceptar */ }
  return page;
}

// O Supabase limita cada resposta a ~1000 linhas; paginamos com range() para
// juntar até LIMITE candidatos numa única execução (senão só cobria 1000/dia).
async function buscarCandidatos() {
  const PAG = 1000;
  const out = [];
  while (out.length < LIMITE) {
    const { data, error } = await supabase.from('imoveis_leilao')
      .select('id, link_edital, url_lote')
      .eq('fonte', 'CEF').eq('ativo', true).is('data_leilao', null)
      .not('modalidade', 'ilike', '%venda%direta%')
      .not('url_lote', 'is', null)
      .order('enriquecido_em', { ascending: true, nullsFirst: true })
      .range(out.length, out.length + PAG - 1);
    if (error) { console.error('query erro:', error.message); break; }
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAG) break;
  }
  return out.slice(0, LIMITE);
}

async function main() {
  const cands = await buscarCandidatos();
  if (!cands?.length) { console.log('CEF: sem candidatos sem data.'); return; }
  console.log(`CEF sem data (não venda direta): ${cands.length} candidatos · conc ${CONC} · limite ${LIMITE}`);

  const browser = await puppeteer.launch({ headless: true, args: BROWSER_ARGS });
  let idx = 0, ok = 0, semData = 0, falha = 0, feitos = 0;
  // Disjuntor: a Caixa bloqueia o IP do runner depois de ~3 min de requisições
  // (todas as páginas passam a dar erro). Sem isso, o job fica ~70 min re-tentando
  // à toa. Abortamos após muitos erros seguidos e deixamos o resto p/ a próxima run.
  const CORTE_ERROS = 40;
  let errosSeguidos = 0, bloqueado = false;
  let amostrasEdital = 0; // loga o outerHTML do controle "edital" p/ os primeiros casos sem URL

  // Carrega a página; o erro de borda da Caixa (504/CloudFront) é transitório,
  // então re-tenta poucas vezes com backoff curto (o bloqueio não passa in-run).
  async function carregar(page, url) {
    for (let tent = 0; tent < 2; tent++) {
      let txt = '';
      try {
        // 'domcontentloaded' (não 'networkidle2'): a data já está no HTML inicial
        // renderizado pelo servidor — não esperamos analytics/ads terminarem.
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        txt = await page.evaluate(() => document.body?.innerText || '');
      } catch { txt = ''; }
      if (!paginaComErro(txt)) return { txt, erro: false };
      await sleep(2000 * (tent + 1)); // 2s, 4s
    }
    return { txt: '', erro: true };
  }

  async function worker() {
    const page = await novaPagina(browser);
    while (idx < cands.length && Date.now() < DEADLINE && !bloqueado) {
      const im = cands[idx++];
      const url = im.url_lote || im.link_edital;
      const { txt, erro } = await carregar(page, url);
      if (erro) {
        // Erro persistente da Caixa: NÃO marca enriquecido_em, para voltar à
        // fila e ser re-tentado na próxima execução (não perde o imóvel).
        falha++;
        if (++errosSeguidos >= CORTE_ERROS) { bloqueado = true; break; }
      } else {
        errosSeguidos = 0;
        const patch = { enriquecido_em: new Date().toISOString() };
        const d = extrairDataLeilao(txt);
        if (d) { patch.data_leilao = d; ok++; } else semData++;
        // Best-effort ADICIONAL: captura o link do edital/anexos. Só grava quando
        // acha algo confiável E o registro ainda não tem link_edital — nunca
        // sobrescreve um valor bom com null. Não interfere na data nem no disjuntor.
        try {
          const ed = await page.evaluate(extrairLinkEdital);
          if (ed?.url && !im.link_edital) {
            patch.link_edital = ed.url;
          } else if (!ed?.url && amostrasEdital < 5) {
            amostrasEdital++;
            const amostra = (ed?.amostra || '(nenhum controle "edital" no DOM)').replace(/\s+/g, ' ').slice(0, 200);
            console.log(`  [edital ${amostrasEdital}] sem URL confiável · controle: ${amostra}`);
          }
        } catch { /* extração de edital é opcional; ignora falhas */ }
        await supabase.from('imoveis_leilao').update(patch).eq('id', im.id).then(() => {}, () => {});
      }
      feitos++;
      if (feitos % 100 === 0) console.log(`  ${feitos}/${cands.length} · datas ${ok} · sem-data ${semData} · falha(erro-caixa) ${falha}`);
      await sleep(500); // gentileza entre requisições
    }
    try { await page.close(); } catch {}
  }

  await Promise.all(Array.from({ length: CONC }, () => worker()));
  await browser.close();
  if (bloqueado) console.log(`ATENÇÃO: a Caixa bloqueou o runner após ${errosSeguidos} erros seguidos — abortado; o restante fica p/ a próxima execução.`);
  console.log(`FIM CEF datas: preenchidas ${ok} · sem-data-na-pagina ${semData} · falha ${falha} · processados ${feitos}`);
}

main().catch(e => { console.error(e); process.exit(1); });
