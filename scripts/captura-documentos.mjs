/**
 * Captura GENÉRICA de documentos com MÚLTIPLOS CAMINHOS por leiloeiro (qualquer
 * fonte que não a Caixa — essa tem o script próprio captura-matricula-cef.mjs).
 * Lê `documentos_fila` (status=pendente) e, para cada imóvel, tenta em CASCATA por
 * custo (para no 1º caminho que traz documento — economia pelo resultado):
 *   CAMINHO 1 — fetch DIRETO dos links já conhecidos (link_matricula/edital/regras
 *               e anexos[].url). Grátis, sem navegador; resolve quem já tem o PDF.
 *   CAMINHO 2 — Puppeteer (navegador real): renderiza JS, abre abas/acordeões,
 *               intercepta PDFs de rede e varre <a href> rotulados como documento.
 *   CAMINHO 3 — Bright Data Web Unlocker: SÓ quando o navegador é BLOQUEADO
 *               (Cloudflare/403, ex.: PECINI). Respeita o teto semanal de custo
 *               (proposito 'docs') → nunca estoura o orçamento.
 * Guarda no Storage (bucket 'documentos') e registra em `imovel_anexos` (com
 * storage_path) — que a análise documental já lê PRIMEIRO. Roda no GitHub Actions.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';
import { Buffer } from 'buffer';
import { createHash } from 'node:crypto';
import { fetchViaBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { carregarPDFParse } from '../api/_pdf-safe.js';
import { extrairMatriculaTexto, extrairPagamentoTexto, extrairCustosTexto, extrairIdentidadeTexto } from '../api/_doc-extracao.js';

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const BUCKET = 'documentos';
const LOTE = Number(process.env.DOCS_LOTE || 40);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ehUrl = v => typeof v === 'string' && /^https?:\/\//i.test(v);
// Limpa o "nome" do doc: tira URLs/paths e ruído, deixa só texto humano curto
// (senão o nome no banco virava a URL crua repetida — feio na tela).
function limparNome(n) {
  const s = (n || '')
    .replace(/https?:\/\/\S+/gi, ' ')          // URLs absolutas
    .replace(/[\w.-]+\/[\w./-]+\.pdf/gi, ' ')  // paths tipo imovel.ai/.../x.pdf
    .replace(/\s+/g, ' ').trim();
  // Deduplica palavras repetidas em sequência (o ctx às vezes repete o rótulo).
  const uniq = [...new Set(s.split(' '))].join(' ');
  return uniq.slice(0, 60);
}
// Classifica o documento pelo nome/URL para gravar o tipo certo.
function classificar(url, nome = '', fonte = '') {
  const s = `${url} ${nome}`.toLowerCase();
  if (/matric/.test(s)) return 'matricula';
  if (/edital/.test(s)) return 'edital';
  if (/laudo|avalia/.test(s)) return 'laudo';
  if (/regras|condi|como.?comprar/.test(s)) return 'regras_venda';
  // REGRA APRENDIDA (auditoria de docs 15/07/2026): BIASI publica 1 doc por-lote em
  // /file/loteanexo/ e ESSE doc É a matrícula — mas vem com nome numérico, que não bate
  // em /matric/ e caía como 'outro' (só 42% tinham matrícula). Rotula como matrícula p/
  // não regredir os 96,5% do backfill. (Extras de lotes multi-doc voltam a 'outro' no
  // chamador, então nenhum documento é descartado.)
  if (fonte === 'BIASI' && /loteanexo/i.test(url)) return 'matricula';
  return 'outro';
}

/**
 * ENRIQUECE A FICHA NO MOMENTO DA CAPTURA (pedido do dono, 06/08: "ao extrair a
 * documentação, poder informar esses detalhes na tela do imóvel").
 *
 * O PDF já está em memória aqui — ler o texto e aplicar os mesmos extratores do
 * relatório custa milissegundos e ZERO em API. Sem isto, os fatos do documento só
 * apareceriam no lote de quem gerou relatório; com isto, todo lote que passa pela
 * captura ganha a ficha enriquecida sozinho. PDF escaneado (sem camada de texto)
 * não rende nada e fica para a leitura por visão do documental — como antes.
 * Best-effort absoluto: qualquer falha aqui não pode derrubar a captura.
 */
async function publicarFatosDoPdf(imovelId, buffer, tipo) {
  try {
    const PDFParse = await carregarPDFParse();
    const parser = new PDFParse({ data: buffer });
    let txt = '';
    try { txt = String((await parser.getText())?.text || '').slice(0, 120000); }
    finally { await parser.destroy().catch(() => {}); }
    if (txt.length < 200) return;
    const fatos = { identidade: extrairIdentidadeTexto(txt) };
    if (tipo === 'matricula') fatos.matricula = extrairMatriculaTexto(txt);
    else { fatos.custos = extrairCustosTexto(txt); fatos.pagamento = extrairPagamentoTexto(txt); fatos.matricula = extrairMatriculaTexto(txt); }
    if (!Object.values(fatos).some(Boolean)) return;
    await supabase.rpc('registrar_doc_fatos', { p_imovel_id: imovelId, p_fatos: { ...fatos, em: new Date().toISOString() } });
  } catch { /* enriquecer a ficha nunca bloqueia a captura */ }
}

async function salvarAnexo(imovelId, buffer, tipo, nome, idx = 0) {
  // Caminho ENDEREÇADO POR CONTEÚDO (hash do PDF), NÃO por Date.now(). Assim uma
  // recaptura do MESMO documento reaproveita o mesmo objeto (upsert sobrescreve) em vez
  // de criar uma cópia nova a cada run — era a causa do inchaço do bucket (lotes de
  // "outro_auto" idênticos) e de objetos órfãos. Conteúdo diferente → hash diferente.
  const hash = createHash('md5').update(buffer).digest('hex').slice(0, 16);
  const path = `casos/${imovelId}/${tipo}_${hash}.pdf`;
  // Já existe um anexo apontando p/ esse conteúdo neste imóvel? (dedup determinístico)
  const { data: jaTem } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('storage_path', path).limit(1);
  const up = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: true });
  if (up.error) throw new Error('upload: ' + up.error.message);
  const signed = await supabase.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const url = signed.data?.signedUrl || null;
  const row = { imovel_id: imovelId, tipo, nome, url, storage_path: path, tamanho_kb: Math.round(buffer.length / 1024), role_criador: 'sistema' };
  // Lê o PDF que acabou de chegar e publica os fatos na ficha (nome do condomínio,
  // despesas mensais, custos do edital, área da matrícula). Antes do return de dedup:
  // documento já cadastrado continua valendo, e o merge da RPC é idempotente.
  await publicarFatosDoPdf(imovelId, buffer, tipo);
  // Mesmo conteúdo já cadastrado (qualquer tipo) → só atualiza a linha, não duplica.
  if (jaTem?.length) { await supabase.from('imovel_anexos').update(row).eq('id', jaTem[0].id); await sincronizarJsonbAnexos(imovelId, tipo, url); return; }
  // Classificados (edital/matrícula/laudo/regras): 1 por tipo → atualiza o existente.
  // 'outro' é GENÉRICO e pode haver VÁRIOS docs distintos do lote (edital+matrícula
  // que não classificaram) — insere os DISTINTOS (conteúdo diferente = path diferente),
  // sem sobrescrever, mas sem duplicar os idênticos (guard acima).
  if (tipo !== 'outro') {
    const { data: existente } = await supabase.from('imovel_anexos').select('id').eq('imovel_id', imovelId).eq('tipo', tipo).limit(1);
    if (existente?.length) { await supabase.from('imovel_anexos').update(row).eq('id', existente[0].id); await sincronizarJsonbAnexos(imovelId, tipo, url); return; }
  }
  await supabase.from('imovel_anexos').insert(row);
  await sincronizarJsonbAnexos(imovelId, tipo, url);
}

// Espelho JSONB (imoveis_leilao.anexos) acompanha o path canônico quando a recaptura
// troca o objeto (path por hash de conteúdo): sem isto, o JSONB ficava apontando p/ o
// objeto ANTIGO, a limpeza o apagava (órfão em imovel_anexos) e o clique do cliente
// abria {"code":"NoSuchKey"} — as 14 matrículas GRUPOLANCE mortas de 05/08. Só toca
// entradas do MESMO tipo que apontam para o NOSSO storage com URL diferente; URLs de
// CDN do leiloeiro ficam como estão.
async function sincronizarJsonbAnexos(imovelId, tipo, urlNova) {
  if (!urlNova || tipo === 'outro') return;
  try {
    const { data } = await supabase.from('imoveis_leilao').select('anexos').eq('id', imovelId).single();
    const lista = Array.isArray(data?.anexos) ? data.anexos : null;
    if (!lista || !lista.length) return;
    let mudou = false;
    const novo = lista.map((a) => {
      if (a?.tipo === tipo && /\/storage\/v1\/object/.test(a?.url || '') && a.url !== urlNova) { mudou = true; return { ...a, url: urlNova }; }
      return a;
    });
    if (mudou) await supabase.from('imoveis_leilao').update({ anexos: novo }).eq('id', imovelId);
  } catch (e) { console.log(`  sync jsonb anexos ${imovelId}: ${e.message}`); }
}

const ehPdfBuf = (buf, ct) => buf && buf.length > 1500 && ((ct || '').includes('pdf') || buf.slice(0, 5).toString('latin1') === '%PDF-');

// Download DIRETO (Node fetch, sem navegador). Base do CAMINHO 1 e primeira tentativa
// do baixarPdf. Funciona cross-origin (essencial p/ PDFs em CDN, ex.: megaleiloes),
// onde o fetch da página é bloqueado por CORS. Só retorna se for REALMENTE PDF.
async function baixarPdfDireto(url, referer) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*', ...(referer ? { Referer: referer } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(25000) });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      if (ehPdfBuf(buf, r.headers.get('content-type'))) return buf;
    }
  } catch { /* chamador tenta outro caminho */ }
  return null;
}

// Download via Bright Data (CAMINHO 3): para PDFs cujo host também barra o fetch
// direto (Cloudflare no CDN do leiloeiro). Respeita o teto semanal (proposito 'docs').
async function baixarPdfBD(url, referer) {
  if (!brightDataDisponivel()) return null;
  const resp = await fetchViaBrightData(url, { proposito: 'docs', timeoutMs: 45000, headers: referer ? { Referer: referer } : null });
  if (!resp || !resp.ok) return null;
  try {
    const buf = Buffer.from(await resp.arrayBuffer());
    return ehPdfBuf(buf, resp.headers.get('content-type')) ? buf : null;
  } catch { return null; }
}

// Extrai links de documentos (edital/matrícula/laudo/anexos) de um HTML CRU — usado
// no CAMINHO 3, onde não há DOM/navegador. Espelha o filtro do scan por Puppeteer:
// pega .pdf OU âncora rotulada como documento; ignora material institucional.
function linksDocDeHtml(html, base) {
  if (!html) return [];
  const out = [];
  const vistos = new Set();
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href = m[1];
    try { href = new URL(href, base).href; } catch { continue; }
    if (vistos.has(href)) continue;
    const txt = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    const alvo = `${txt} ${href}`;
    const ehPdf = /\.pdf(\?|#|$)/i.test(href);
    const ehDoc = /edital|matr[ií]cula|laudo|documento|anexo|processo|arquivo|download/i.test(alvo);
    const ehGenerico = /modelo|proposta|como.?comprar|termos|pol[ií]tica|privacidade|cadastr|manual|passo.?a.?passo|transpar[êe]ncia|igualdade.?salarial|quem.?somos|imprensa|investidor|carreira|institucional|c[óo]digo.?de.?[ée]tica|governan[çc]a/i.test(alvo);
    if ((!ehPdf && !ehDoc) || ehGenerico) continue;
    vistos.add(href);
    out.push({ href, txt });
  }
  return out;
}

async function baixarPdf(page, url, referer) {
  // 1) Node fetch direto (SEM CORS) — cobre a maioria dos PDFs cross-origin.
  const direto = await baixarPdfDireto(url, referer);
  if (direto) return direto;
  // 2) Fetch DENTRO da página (usa a sessão validada) — cobre PDFs same-origin que a
  //    origem só serve com cookie/sessão.
  try {
    const res = await page.evaluate(async (u) => {
      try {
        const r = await fetch(u, { credentials: 'include' });
        if (!r.ok) return null;
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const bytes = new Uint8Array(await r.arrayBuffer());
        let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return { ct, b64: btoa(bin), len: bytes.length };
      } catch { return null; }
    }, url);
    if (res && res.len >= 1500) { const buf = Buffer.from(res.b64, 'base64'); if (ehPdfBuf(buf, res.ct)) return buf; }
  } catch { /* */ }
  return null;
}

async function processar(browser, item) {
  const { data: im } = await supabase.from('imoveis_leilao')
    .select('link_edital, link_matricula, link_regras_venda, anexos, fonte, url_lote').eq('id', item.imovel_id).single();
  if (!im) throw new Error('imovel_nao_encontrado');

  const page = await browser.newPage();
  await page.setUserAgent(UA);

  // 1) Interceptação: guarda qualquer PDF que a página carregar sozinha.
  const pdfsRede = [];
  page.on('response', async (resp) => {
    try {
      const ct = (resp.headers()['content-type'] || '').toLowerCase();
      if (ct.includes('pdf') && resp.status() < 400) {
        const buf = Buffer.from(await resp.buffer());
        if (buf.length > 1500) pdfsRede.push({ url: resp.url(), buf });
      }
    } catch { /* ignora */ }
  });

  const capturados = [];
  const salvos = new Set();     // tipos CLASSIFICADOS já salvos (1 por tipo)
  const urlsSalvas = new Set(); // evita baixar/salvar a MESMA URL duas vezes
  let nOutro = 0;               // índice p/ vários 'outro' (paths únicos)
  const salvar = async (buf, url, nome) => {
    if (urlsSalvas.has(url)) return;
    let tipo = classificar(url, nome, im.fonte);
    // BIASI: o 1º /loteanexo/ vira matrícula; se a matrícula já foi salva, os anexos
    // extras do mesmo lote voltam a 'outro' (salvos como linha própria, não descartados).
    // Não altera o comportamento das demais fontes.
    if (tipo === 'matricula' && im.fonte === 'BIASI' && salvos.has('matricula')) tipo = 'outro';
    // Classificados: 1 por tipo. 'outro' é genérico → pode haver vários (edital +
    // matrícula que não classificaram); cada um vira uma linha própria.
    if (tipo !== 'outro' && salvos.has(tipo)) return;
    await salvarAnexo(item.imovel_id, buf, tipo, nome || `${tipo}.pdf`, tipo === 'outro' ? ++nOutro : 0);
    urlsSalvas.add(url);
    if (tipo !== 'outro') salvos.add(tipo);
    capturados.push(tipo);
  };

  // Página do lote (referer + navegação): em muitas fontes o link_edital É a própria
  // página. Mas quando ele já é o PDF do edital (CEF depois do backfill, e agora
  // permanentemente — ver trg_preservar_link_edital), navegar para ele mandaria o
  // Puppeteer para um PDF em vez da página do lote: nenhum outro documento seria
  // encontrado e o Referer do caminho 1 ficaria errado. Aí a url_lote é que vale.
  const ehPdf = (u) => /\.pdf(\?|#|$)/i.test(u || '');
  const paginaLote = (ehUrl(im.link_edital) && !ehPdf(im.link_edital)) ? im.link_edital
    : (ehUrl(im.url_lote) ? im.url_lote : (ehUrl(im.link_regras_venda) ? im.link_regras_venda : null));

  // ─── CAMINHO 1 — fetch DIRETO dos links já conhecidos (grátis, sem navegador) ───
  // Resolve de imediato quem já tem o PDF (link_matricula real, anexos[].url). O
  // baixarPdfDireto só aceita application/pdf, então uma página HTML em link_edital
  // é ignorada de graça. Quem já tiver documento aqui nem aciona os caminhos 2/3.
  const conhecidos = [];
  if (ehUrl(im.link_matricula)) conhecidos.push({ url: im.link_matricula, nome: 'matricula' });
  if (ehUrl(im.link_edital) && /\.pdf(\?|#|$)/i.test(im.link_edital)) conhecidos.push({ url: im.link_edital, nome: 'edital' });
  if (ehUrl(im.link_regras_venda) && /\.pdf(\?|#|$)/i.test(im.link_regras_venda)) conhecidos.push({ url: im.link_regras_venda, nome: 'regras venda' });
  for (const a of (Array.isArray(im.anexos) ? im.anexos : [])) if (ehUrl(a?.url)) conhecidos.push({ url: a.url, nome: a?.nome || '' });
  for (const c of conhecidos) {
    if (capturados.length >= 8) break;
    if (urlsSalvas.has(c.url)) continue;
    const buf = await baixarPdfDireto(c.url, paginaLote);
    if (buf) { try { await salvar(buf, c.url, limparNome(c.nome)); } catch { /* */ } }
  }

  // ─── CAMINHO 2 — Puppeteer (renderiza JS, abre abas/acordeões, intercepta PDFs) ───
  let bloqueado = false; // vira true se o navegador for barrado (anti-bot) → escala p/ CAMINHO 3
  if (paginaLote) {
    try {
      await page.goto(paginaLote, { waitUntil: 'networkidle2', timeout: 45000 });
      // Anti-bot (Cloudflare "just a moment"): espera o desafio JS resolver e o
      // conteúdo real carregar, senão varremos a página de bloqueio (0 documentos).
      await page.waitForFunction(() => {
        const t = document.body?.innerText || '';
        if (/just a moment|um momento|verificando|attention required|checking your browser/i.test(t)) return false;
        return document.querySelectorAll('a[href]').length > 5;
      }, { timeout: 12000 }).catch(() => {});
      // O desafio anti-bot resolveu ou a página segue bloqueada? Se sim, o CAMINHO 3
      // (Bright Data) assume — o navegador direto não vence Cloudflare/403 (ex.: PECINI).
      try {
        bloqueado = await page.evaluate(() => {
          const t = document.body?.innerText || '';
          return /just a moment|um momento|verificando|attention required|checking your browser|acesso negado|forbidden/i.test(t)
            || document.querySelectorAll('a[href]').length <= 5;
        });
      } catch { bloqueado = true; }
      await new Promise(r => setTimeout(r, 1500));
      // CONTRAMEDIDA (docs atrás de aba/acordeão): muitos leiloeiros — SUPERBID em
      // especial — escondem edital/matrícula/anexos numa aba ("Documentos", "Edital
      // e Regulamento", "Habilitação") ou num acordeão que só renderiza os links ao
      // clicar. Aqui expandimos esses gatilhos (botões/abas/summary — NUNCA <a> que
      // navega para outra página) e rolamos a página para disparar carregamento lazy.
      try {
        await page.evaluate(async () => {
          // Só gatilhos claramente ligados a DOCUMENTOS DO LOTE. NÃO clicamos em
          // nav/menu/footer (levava a PDFs corporativos — "Transparência Salarial",
          // "Quem somos" — que não são do imóvel). Sem .nav-link / a[href=#].
          const rx = /documento|edital|anexo|regulamento|matr[ií]cula|habilita[çc]/i;
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const cliqueis = Array.from(document.querySelectorAll(
            'button, summary, [role="tab"], [aria-controls], .accordion-header, [data-toggle="collapse"]'
          ));
          let cliques = 0;
          for (const el of cliqueis) {
            if (cliques >= 8) break;
            // Ignora gatilhos dentro de nav/header/footer.
            if (el.closest('nav,header,footer,[role="navigation"]')) continue;
            const txt = (el.getAttribute('aria-label') || el.textContent || '').trim();
            if (!rx.test(txt) || txt.length > 48) continue;
            try { el.click(); cliques++; await sleep(400); } catch { /* */ }
          }
          // rola até o fim para carregar seções lazy
          for (let y = 0; y < 4; y++) { window.scrollTo(0, document.body.scrollHeight * (y + 1) / 4); await sleep(300); }
        });
        await new Promise(r => setTimeout(r, 1200));
      } catch { /* segue */ }
    } catch { bloqueado = true; /* goto falhou (timeout/403) → tenta o CAMINHO 3 */ }
  }

  // 2) Links de PDF/documento na página renderizada (rótulo OU extensão).
  //    Além do texto do <a>, colhemos o CONTEXTO em volta (aria-label, title, e o
  //    texto do bloco pai / cabeçalho anterior). CONTRAMEDIDA para leiloeiros que
  //    servem edital/matrícula por URL OPACA (hash) com o texto do link = nome do
  //    arquivo (ex.: SUPERBID): o rótulo "Edital"/"Matrícula" costuma estar na
  //    seção/linha em volta, não no href — assim classificamos certo mesmo assim.
  let linksPdf = [];
  try {
    linksPdf = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map(a => {
        // Sobe até ~3 níveis pegando texto curto do contêiner (rótulo da seção).
        let ctx = '';
        let el = a;
        for (let i = 0; i < 3 && el; i++) {
          el = el.parentElement;
          const t = (el?.getAttribute?.('aria-label') || el?.textContent || '').trim();
          if (t && t.length < 140) ctx += ' ' + t;
        }
        const head = a.closest('section,li,tr,div')?.querySelector?.('h1,h2,h3,h4,strong,th,legend,label');
        return {
          href: a.href,
          txt: (a.textContent || '').trim().slice(0, 80),
          ctx: (`${a.getAttribute('aria-label') || ''} ${a.getAttribute('title') || ''} ${head?.textContent || ''} ${ctx}`).trim().slice(0, 160),
          // Link dentro de nav/header/footer → institucional (não é doc do lote).
          nav: !!a.closest('nav,header,footer,[role="navigation"],[class*="footer"],[class*="menu"]'),
        };
      })
      .filter(x => !x.nav && (/\.pdf(\?|#|$)/i.test(x.href) || /edital|matr[ií]cula|laudo|documento|anexo|processo|arquivo|download/i.test(x.txt + ' ' + x.ctx + ' ' + x.href))));
  } catch { /* sem links */ }

  // DIAGNÓSTICO p/ calibrar leiloeiros anti-bot (aparece nos logs do GitHub Actions).
  try {
    const diag = await page.evaluate(() => ({ title: document.title.slice(0, 70), len: (document.body?.innerText || '').length }));
    console.log(`[docs] ${item.imovel_id} ${im.fonte || ''}: title="${diag.title}" bodyLen=${diag.len} candidatos=${linksPdf.length} rede=${pdfsRede.length}${linksPdf.length ? ' :: ' + linksPdf.slice(0, 6).map(l => `${l.txt}->${l.href}`).join(' | ').slice(0, 500) : ''}`);
  } catch { /* */ }

  // Guarda os PDFs que já vieram pela rede.
  for (const p of pdfsRede) { try { await salvar(p.buf, p.url, ''); } catch { /* */ } }
  // Baixa os candidatos: .pdf direto OU link ROTULADO como documento (mesmo sem a
  // extensão .pdf — muitos leiloeiros servem o edital/matrícula por uma rota).
  // baixarPdf só salva se a resposta for REALMENTE application/pdf (filtra HTML/rotas).
  for (const l of linksPdf) {
    if (capturados.length >= 8) break; // teto de segurança (não só 4 tipos — vários 'outro')
    const alvo = l.txt + ' ' + (l.ctx || '') + ' ' + l.href;
    const ehPdfHref = /\.pdf(\?|#|$)/i.test(l.href);
    const ehDocTxt = /edital|matr[ií]cula|laudo|documento|anexo|processo|arquivo|download/i.test(alvo);
    // Ignora documentos GENÉRICOS/INSTITUCIONAIS do site (não são do lote): modelo
    // de proposta, "como comprar", termos, cadastro, e material CORPORATIVO do
    // leiloeiro (relatório de transparência, igualdade salarial, quem somos,
    // imprensa, investidores, carreira) — evita salvar lixo como "edital"/"outro".
    const ehGenerico = /modelo|proposta|como.?comprar|termos|pol[ií]tica|privacidade|cadastr|manual|passo.?a.?passo|transpar[êe]ncia|igualdade.?salarial|quem.?somos|imprensa|investidor|carreira|institucional|c[óo]digo.?de.?[ée]tica|governan[çc]a/i.test(alvo);
    if ((!ehPdfHref && !ehDocTxt) || ehGenerico) continue;
    const buf = await baixarPdf(page, l.href, paginaLote);
    // Passa o CONTEXTO (rótulo da seção) além do texto do link para classificar
    // certo mesmo quando a URL é opaca (hash sem "edital"/"matric").
    if (buf) { try { await salvar(buf, l.href, limparNome(`${l.txt} ${l.ctx || ''}`)); } catch { /* */ } }
  }
  // Também os anexos que o scrape já registrou como URL (retenta pela SESSÃO da
  // página os que o fetch direto do CAMINHO 1 não pegou — ex.: PDF só servido com cookie).
  for (const a of (Array.isArray(im.anexos) ? im.anexos : [])) {
    if (capturados.length >= 8) break;
    if (!ehUrl(a?.url) || urlsSalvas.has(a.url)) continue;
    const buf = await baixarPdf(page, a.url, paginaLote);
    if (buf) { try { await salvar(buf, a.url, limparNome(a.nome || '')); } catch { /* */ } }
  }

  await page.close();

  // ─── CAMINHO 3 — Bright Data Web Unlocker (só quando o navegador foi BLOQUEADO) ───
  // Escala ao proxy pago APENAS se o caminho barato foi barrado E ainda não temos
  // documento — desbloqueia fontes como o PECINI (Cloudflare 403). Baixa o HTML do
  // lote, extrai os links de documento e busca cada PDF (direto → e, se o host também
  // barrar, via Bright Data). Respeita o teto semanal de custo (proposito 'docs').
  if (!capturados.length && bloqueado && paginaLote && brightDataDisponivel()) {
    const resp = await fetchViaBrightData(paginaLote, { proposito: 'docs', timeoutMs: 45000 });
    if (resp && resp.ok) {
      const html = await resp.text().catch(() => '');
      const cands = linksDocDeHtml(html, paginaLote);
      console.log(`[docs] ${item.imovel_id} ${im.fonte || ''}: CAMINHO 3 (Bright Data) — ${cands.length} candidato(s)`);
      for (const l of cands) {
        if (capturados.length >= 8) break;
        let buf = await baixarPdfDireto(l.href, paginaLote);
        if (!buf) buf = await baixarPdfBD(l.href, paginaLote);
        if (buf) { try { await salvar(buf, l.href, limparNome(l.txt)); } catch { /* */ } }
      }
    }
  }

  if (!capturados.length) throw new Error('nenhum_documento_encontrado');
  return capturados;
}

async function main() {
  // Processa PENDENTES e re-tenta ERROS transitórios (até 4 tentativas) — assim uma
  // falha momentânea (fonte instável) não deixa o lote sem documentos para sempre.
  const { data: fila } = await supabase.from('documentos_fila')
    .select('*')
    .or('status.eq.pendente,and(status.eq.erro,tentativas.lt.4)')
    .order('criado_em', { ascending: true }).limit(LOTE);
  if (!fila?.length) { console.log('Fila vazia.'); return; }
  console.log(`Processando ${fila.length} imóvel(is)...`);

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  let ok = 0, erros = 0;
  // Negative-cache: quando CHECAMOS o lote e a matrícula NÃO saiu (só edital, ou nada),
  // marca matricula_checada_em. Torna a lacuna CONHECIDA (não silenciosa) e faz o
  // enfileirador respeitar um cooldown de 30d em vez de re-capturar todo dia um lote
  // cuja matrícula não está na página pública. (ZUK/GRUPOLANCE não entram nesta fila —
  // são login-gated, resolvidos pelos pipelines próprios — então não há conflito.)
  const marcarChecadoSemMatricula = async (imovelId) => {
    try {
      await supabase.from('imoveis_leilao')
        .update({ matricula_checada_em: new Date().toISOString() })
        .eq('id', imovelId).is('link_matricula', null);
    } catch { /* best-effort */ }
  };
  for (const item of fila) {
    const tentativaAtual = (item.tentativas || 0) + 1;
    await supabase.from('documentos_fila').update({ status: 'processando', tentativas: tentativaAtual }).eq('imovel_id', item.imovel_id);
    try {
      const docs = await processar(browser, item);
      await supabase.from('documentos_fila').update({ status: 'ok', erro: null, processado_em: new Date().toISOString() }).eq('imovel_id', item.imovel_id);
      ok++; console.log(`✓ ${item.imovel_id}: ${docs.join(', ')}`);
      // Checado com sucesso, mas sem matrícula (pegou só edital/anexo) → negative-cache.
      if (!docs.includes('matricula')) await marcarChecadoSemMatricula(item.imovel_id);
    } catch (e) {
      await supabase.from('documentos_fila').update({ status: 'erro', erro: String(e.message).slice(0, 300), processado_em: new Date().toISOString() }).eq('imovel_id', item.imovel_id);
      erros++; console.log(`✗ ${item.imovel_id}: ${e.message}`);
      // Erro TERMINAL (esgotou as 4 tentativas) sem nunca achar a matrícula → negative-cache.
      if (tentativaAtual >= 4) await marcarChecadoSemMatricula(item.imovel_id);
    }
    await new Promise(r => setTimeout(r, 800));
  }
  await browser.close();
  console.log(`Concluído: ${ok} ok, ${erros} erro(s).`);
}

main().catch(e => { console.error(e); process.exit(1); });
