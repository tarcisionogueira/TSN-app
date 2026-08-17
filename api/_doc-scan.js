/**
 * Vasculhador GENÉRICO de documentos do lote — funciona para qualquer leiloeiro.
 *
 * Cada leiloeiro guarda matrícula/edital/laudo/etc. em lugares diferentes (link
 * direto, botão "Veja o Edital", bloco "Documentação", JSON do __NEXT_DATA__…).
 * Em vez de um seletor por site, varremos TODO o HTML/JSON da página do lote
 * atrás de URLs de documento e classificamos por palavra-chave no caminho, no
 * nome do arquivo e no texto da âncora. Assim novos leiloeiros já saem cobertos.
 *
 * Entrada: html bruto + a URL base (para resolver caminhos relativos).
 * Saída: { matricula, edital, regras, laudo, foto, anexos:[{nome,url,tipo}] }.
 */
import { decodificarEntidades } from './_texto-imovel.js';

// Hosts de ruído (analytics, consentimento, fontes, mapas, chat, CDN de biblioteca) —
// nunca são documento. Ampliado em 03/08 pelo achado do dono (ver RE_ASSET_*): o pixel do
// Bing (`bat.bing.com/action/0?...&tl=…abaixo%20da%20avaliação`) entrava como "Documento"
// só porque a URL de rastreio carregava o TÍTULO do lote com a palavra "avaliação".
const HOST_RUIDO = /(google-analytics|googletagmanager|gstatic|googleapis|cookielaw|onetrust|facebook|fbcdn|doubleclick|hotjar|cloudflareinsights|recaptcha|youtube|ytimg|gravatar|fontawesome|bat\.bing|clarity\.ms|lpsnmedia|lpcdn|segment\.(?:io|com)|mixpanel|newrelic|sentry|criteo|taboola|outbrain|rdstation|tiktok|licdn|jsdelivr|unpkg|bootstrapcdn|jquery)\./i;
// ── RUÍDO QUE VIRAVA "DOCUMENTO" (achado do dono 03/08, lote `vegas_7588`) ────────────
// Ele clicou num anexo e recebeu CÓDIGO na tela: era `jquery.min.js`/`global.css` do bucket
// do leiloeiro. Causa: para URL SEM extensão de documento aceitávamos o sinal genérico de
// host (`amazonaws|storage|blob.core|/file`) — e o tema do site inteiro mora nesse bucket.
// Nada aqui filtra .pdf/.doc (esses passam antes, pela extensão): isto só decide o que
// fazer com URL SEM extensão de documento.
const RE_ASSET_EXT  = /\.(m?js|cjs|css|s[ac]ss|less|map|json|xml|txt|ico|woff2?|ttf|eot|otf|svgz?|mp4|webm|m3u8|wasm)(?:[?#]|$)/i;
const RE_ASSET_PATH = /\/(assets?|static|dist|build|vendor|node_modules|bundles?|themes?|templates?|plugins?|components?|libs?|_next|wp-includes|wp-content\/(?:themes|plugins))\//i;
const RE_ASSET_MIN  = /\.min\.[a-z0-9]{2,5}(?:[?#]|$)/i;              // storage.secure.min.html (chat da SODRE)
// Página de CONTA/institucional do portal: "ENVIAR PROPOSTA" levava ao /licitante/login e
// "Leia atentamente o edital" ao /glossario — âncoras que citam o documento mas abrem o site.
const RE_PAGINA_CONTA = /\/(login|signin|sign-in|entrar|logout|sair|cadastr\w*|registrar|licitante|habilita\w*|authorization|authorize|oauth|minha-conta|meus-dados|carrinho|checkout|gloss[áa]rio|glossario|faq|contato|fale-conosco|quem-somos)(?:[/?#]|$)/i;
// Link de MARKETING (campanha/rastreio) — documento nenhum carrega utm_source/gclid.
const RE_PARAM_MKT = /[?&](utm_[a-z]+|gclid|fbclid|msclkid|mc_eid)=/i;
// URL com PREÇO no caminho é rótulo de anúncio virado link, não arquivo
// (ex.: /item/7588/Chácara…%20-%20Lance%20Inicial:%20R$2.266.000,00).
const RE_URL_ANUNCIO = /R\$|lance\s*inicial/i;
// Extensões de documento que nos interessam.
const RE_DOC_EXT = /\.(pdf|docx?|xlsx?|odt|rtf)(?:[?#]|$)/i;
const RE_IMG_EXT = /\.(jpe?g|png|webp|gif|avif|svg)(?:[?#]|$)/i;
// Documentos INSTITUCIONAIS/corporativos do site do leiloeiro que NÃO são do lote e
// aparecem em TODA página (rodapé/config global) — ex.: o "Relatório de Transparência e
// Igualdade Salarial" (Lei 14.611/2023) do SUPERBID vazava como anexo em centenas de
// lotes e poluía o laudo documental ("já lemos …"). Cirúrgico: só rótulos claramente
// corporativos — não pega edital/matrícula/laudo/proposta/regras do lote.
// + privacidade/cookies/termos de uso/segurança da informação (achado do dono 01/08:
// MEGA anexava "Política de Privacidade" ×2 em TODO lote — 6.698 entradas em 2.340
// imóveis; o PDF de consentimento de cookies vem de host "adopt…/disclaimer/").
const RE_DOC_INSTITUCIONAL = /igualdade.?salarial|transpar[êe]ncia.?(e.?)?(igualdade|salarial)|quem.?somos|trabalhe.?conosco|c[óo]digo.?de.?(conduta|[ée]tica)|governan[çc]a.?corporativa|rela[çc][õo]es.?com.?investidores|pol[ií]tica.?de.?privacidade|politica[_-]?de[_-]?privacidade|aviso.?de.?(privacidade|cookies?)|\bcookies?\b|termos?.?de.?uso|seguran[çc]a.?da.?informa[çc][ãa]o|seguranca[_-]?da[_-]?informacao|\/disclaimer\//i;
// Palavras-chave de documento no caminho/nome/âncora. laudo (avaliação) e proposta
// viraram tipos PRÓPRIOS: o laudo de avaliação traz o valor oficial e impacta o
// mercadológico; o modelo de proposta é o documento de venda parcelada.
// matrícula resiliente: pega a forma correta ("matrícula"/"matricula"), a
// ACENTUADA-QUEBRADA por charset (mojibake do scraper: UTF-8 lido como Latin-1 →
// "matrãâ­cula", com soft-hyphen U+00AD no meio), a SEM acento colada ("matrcula")
// e a ABREVIADA ("matr-15964", "matr 129"). Sem isso, o SUPERBID gravava a
// matrícula como anexo genérico e o laudo documental pedia "matrícula faltando".
const RE_MATRICULA = /matr[a-zà-ÿ­]{0,4}cula|\bmatr[\s._:­-]+\d{2,}/i;
const KW = {
  matricula: RE_MATRICULA,
  edital: /edital/i,
  laudo: /laudo|avalia[çc][ãa]o/i,
  proposta: /proposta|modelo\s*de\s*proposta/i,
  regras: /regras|condi[cç][oõ]es|como\s*comprar|comocomprar/i,
  anexo: /[oô]nus|certid|processo|anexo|documento|memorial|contrato|escritura|d[eé]bito|iptu|condom[ií]nio|leil[aã]o|pe[cç]a/i,
};

function classificar(texto) {
  if (KW.matricula.test(texto)) return 'matricula';
  if (KW.edital.test(texto)) return 'edital';
  if (KW.laudo.test(texto)) return 'laudo';
  if (KW.proposta.test(texto)) return 'proposta';
  if (KW.regras.test(texto)) return 'regras';
  return 'anexo';
}

// ── CHAVE CANÔNICA DE DOCUMENTO ───────────────────────────────────────────────
// Vários leiloeiros servem o MESMO arquivo com querystring VOLÁTIL: cache-buster
// (?v=<hex> no CDN do Grupo Lance, regenerado a cada render) ou assinatura com
// validade (?Expires=…&Signature=… na ZUK, nova a cada visita). Comparar pela URL
// completa fazia cada scrape "ver" um documento novo → o mesmo edital acumulava
// 7-8 entradas em `anexos` (311 lotes GL, 192 ZUK em 30/07). A chave canônica
// identifica o ARQUIVO: para path com extensão de documento, host+path (querystring
// toda fora); senão, remove só os parâmetros voláteis conhecidos (query significativa
// tipo /download?id=123 é preservada). Uso: DEDUP/comparação — nunca para abrir o
// link (a URL original, com a assinatura mais recente, é a que abre).
const RE_PARAM_VOLATIL = /^(v|ver|version|cb|cache|_|expires|signature|policy|key-pair-id|token|awsaccesskeyid|x-amz-[a-z0-9-]+|x-goog-[a-z0-9-]+)$/i;
export function chaveDocCanonica(url) {
  const s = String(url || '').replace(/&amp;/gi, '&').trim(); // &amp; não-decodificado (ZUK) quebrava o dedup E o link
  if (!/^https?:\/\//i.test(s)) return null; // javascript:/mailto:/relativo não é documento
  try {
    const u = new URL(s);
    if (/\.(pdf|docx?|xlsx?|odt|rtf)$/i.test(u.pathname)) return (u.origin + u.pathname).toLowerCase();
    const params = [...u.searchParams.entries()].filter(([k]) => !RE_PARAM_VOLATIL.test(k));
    params.sort((a, b) => a[0].localeCompare(b[0]) || String(a[1]).localeCompare(String(b[1])));
    const q = params.map(([k, v]) => `${k}=${v}`).join('&');
    return (u.origin + u.pathname).toLowerCase() + (q ? `?${q}` : '');
  } catch { return null; }
}

function nomeDeUrl(u) {
  try {
    const p = new URL(u);
    const base = decodeURIComponent((p.pathname.split('/').pop() || '').trim());
    if (base && base.length > 1) return base.replace(/\.[a-z0-9]{2,4}$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90);
  } catch { /* */ }
  return null;
}

function absolutizar(href, baseUrl) {
  try { return new URL(href, baseUrl).href; } catch { return null; }
}

// decodeURIComponent explode com '%' solto (comum em URL de anúncio); aqui o pior caso
// é comparar a URL crua, nunca derrubar a varredura.
function decodificar(u) {
  try { return decodeURIComponent(String(u)).replace(/\+/g, ' '); } catch { return String(u); }
}

// A própria página do lote (âncora "#tab-parcelamento") ou a HOME do leiloeiro — nunca
// são o documento, por mais que o texto da âncora diga "Proposta"/"Edital".
function ehPaginaDoSite(url, baseUrl) {
  try {
    const u = new URL(url);
    if (u.pathname === '/' || u.pathname === '') return true;
    if (baseUrl) {
      const b = new URL(baseUrl);
      if (u.origin === b.origin && u.pathname === b.pathname) return true;
    }
  } catch { /* URL inválida cai fora noutro filtro */ }
  return false;
}

// É um link que vale guardar como documento?
function ehDocumento(url, label, baseUrl) {
  if (!url || HOST_RUIDO.test(url)) return false;
  // Só http(s): âncora "Consulte o edital" com href javascript:_gt(... passava no
  // filtro por citar 'edital' e virava um anexo-lixo inabrível (visto na ZUK).
  if (!/^https?:\/\//i.test(url)) return false;
  if (RE_IMG_EXT.test(url)) return false;
  if (RE_DOC_INSTITUCIONAL.test(`${url} ${label || ''}`)) return false; // ruído corporativo do site, não do lote
  if (RE_DOC_EXT.test(url)) return true;                       // arquivo .pdf/.doc… → sempre
  // Daqui para baixo a URL NÃO tem extensão de documento e só entra por PALAVRA-CHAVE —
  // é exatamente aí que o tema do site (js/css), o pixel de rastreio, a página de login e
  // a âncora da própria página se disfarçavam de anexo e abriam CÓDIGO para o cliente.
  if (RE_ASSET_EXT.test(url) || RE_ASSET_PATH.test(url) || RE_ASSET_MIN.test(url)) return false;
  if (RE_PAGINA_CONTA.test(url) || RE_PARAM_MKT.test(url)) return false;
  if (RE_URL_ANUNCIO.test(decodificar(url))) return false;
  if (ehPaginaDoSite(url, baseUrl)) return false;
  const alvo = `${url} ${label || ''}`;
  // Sem extensão de arquivo: só aceita se a URL/âncora cita explicitamente um doc
  // E aponta para um recurso (evita capturar a própria página do anúncio).
  return RE_MATRICULA.test(alvo) || /edital|laudo|avalia|proposta|certid|\/docs?\/|\/documento|\/arquivo|\/anexo|\/download|blob\.core|amazonaws|storage|\/file/i.test(alvo);
}

/**
 * Varre o HTML do lote e devolve os documentos encontrados.
 * @param {string} html  conteúdo bruto da página do lote
 * @param {string} baseUrl  URL da página (para resolver relativos)
 * @param {string} fotoAtual  foto já conhecida (não sobrescreve se já houver)
 */
export function vasculharDocumentos(html, baseUrl, fotoAtual = null) {
  const out = { matricula: null, edital: null, regras: null, laudo: null, foto: fotoAtual || null, anexos: [] };
  if (!html) return out;

  // 1) Mapa href→texto-da-âncora (texto ajuda a classificar quando a URL é opaca).
  const ancoraTexto = new Map();
  const reA = /<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let a;
  while ((a = reA.exec(html)) !== null) {
    const href = a[1];
    // DECODIFICA ENTIDADES (17/08). O texto da âncora ia CRU para `classificar()`, então um
    // link rotulado "Matr&#xED;cula" nunca casava com RE_MATRICULA — depois de "Matr" vem
    // "&#xED;", não "í" — e o documento virava anexo genérico ou sumia. O cliente lia
    // "Matrícula: no site" com o arquivo publicado na página do leiloeiro.
    // Este classificador serve TODAS as fontes (via enriquecer-lote), não só a PECINI onde o
    // caso apareceu. Note que RE_MATRICULA já carregava um remendo para mojibake de charset
    // ("matrãâ­cula"): era o mesmo problema tratado no sintoma, alargando o regex em vez de
    // normalizar a entrada. Decodificar aqui ataca a causa dos dois.
    const texto = decodificarEntidades(a[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 120);
    if (href && !ancoraTexto.has(href)) ancoraTexto.set(href, texto);
  }

  // 2) Todas as URLs candidatas: atributos href/src + QUALQUER string entre aspas
  //    que pareça URL (pega o JSON do __NEXT_DATA__/estado embutido). Mais caminhos
  //    relativos de documento ("/editais/x.pdf").
  const urls = new Set();
  const push = (u) => { if (u) urls.add(String(u).replace(/&amp;/gi, '&')); }; // decodifica &amp; (URL assinada em atributo HTML)
  let m;
  const reAttr = /(?:href|data-href|src|data-src|data-url|content)\s*=\s*["']([^"']+)["']/gi;
  while ((m = reAttr.exec(html)) !== null) push(m[1]);
  const reQuoted = /["'](https?:\/\/[^"'\\\s]+|\/[A-Za-z0-9_\-./%]+\.(?:pdf|docx?|xlsx?))["']/gi;
  while ((m = reQuoted.exec(html)) !== null) push(m[1]);
  // URLs escapadas em JSON (\/ vira /, / etc.)
  const reEsc = /https?:(?:\\\/|\\u002[fF]|\/)[^"'\\\s]+\.(?:pdf|docx?|xlsx?)/gi;
  while ((m = reEsc.exec(html)) !== null) push(m[0].replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/'));

  const vistos = new Set();
  for (const raw of urls) {
    const abs = absolutizar(raw, baseUrl);
    if (!abs) continue;
    const label = ancoraTexto.get(raw) || '';
    // Foto: guarda a primeira imagem "de verdade" se ainda não temos foto.
    if (!out.foto && RE_IMG_EXT.test(abs) && !HOST_RUIDO.test(abs) && !/sprite|logo|icon|avatar|placeholder|banner/i.test(abs.split('/').pop() || '')) {
      // evita capturar ícones pequenos do tema; aceita só jpg/png/webp comuns
      if (/\.(jpe?g|png|webp)(?:[?#]|$)/i.test(abs)) out.foto = abs;
    }
    if (!ehDocumento(abs, label, baseUrl)) continue;
    // Dedup pelo ARQUIVO (chave canônica), não pela URL completa — a querystring
    // volátil (cache-buster/assinatura) fazia o mesmo PDF entrar N vezes.
    const chave = chaveDocCanonica(abs) || abs.split('#')[0];
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const tipo = classificar(`${label} ${abs}`);
    const nome = (label && label.length > 2 ? label : nomeDeUrl(abs)) || 'Documento';
    out.anexos.push({ nome, url: abs, tipo });
    // Primeiro de cada tipo principal vira o link "oficial".
    if (tipo === 'matricula' && !out.matricula) out.matricula = abs;
    if (tipo === 'edital' && !out.edital) out.edital = abs;
    if (tipo === 'regras' && !out.regras) out.regras = abs;
    if (tipo === 'laudo' && !out.laudo) out.laudo = abs;
  }

  // Ordena: matrícula, edital, laudo, regras, proposta, demais — e limita.
  const ordem = { matricula: 0, edital: 1, laudo: 2, regras: 3, proposta: 4, anexo: 5 };
  out.anexos.sort((x, y) => (ordem[x.tipo] - ordem[y.tipo]));
  // Cap POR TIPO nomeado (3): cobre o caso legítimo (edital 1ª/2ª praça + retificação)
  // sem deixar uma página que lista editais de vários leilões explodir a lista.
  const porTipo = {};
  out.anexos = out.anexos.filter((a) => {
    if (a.tipo === 'anexo') return true; // genéricos (certidões/ônus/…) só pelo cap global
    porTipo[a.tipo] = (porTipo[a.tipo] || 0) + 1;
    return porTipo[a.tipo] <= 3;
  });
  out.anexos = out.anexos.slice(0, 25);
  return out;
}
