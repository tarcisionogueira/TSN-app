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

// Hosts de ruído (analytics, consentimento, fontes, mapas) — nunca são documento.
const HOST_RUIDO = /(google-analytics|googletagmanager|gstatic|googleapis|cookielaw|onetrust|facebook|fbcdn|doubleclick|hotjar|cloudflareinsights|recaptcha|youtube|ytimg|gravatar|fontawesome)\./i;
// Extensões de documento que nos interessam.
const RE_DOC_EXT = /\.(pdf|docx?|xlsx?|odt|rtf)(?:[?#]|$)/i;
const RE_IMG_EXT = /\.(jpe?g|png|webp|gif|avif|svg)(?:[?#]|$)/i;
// Palavras-chave de documento no caminho/nome/âncora. laudo (avaliação) e proposta
// viraram tipos PRÓPRIOS: o laudo de avaliação traz o valor oficial e impacta o
// mercadológico; o modelo de proposta é o documento de venda parcelada.
const KW = {
  matricula: /matr[ií]cul/i,
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

// É um link que vale guardar como documento?
function ehDocumento(url, label) {
  if (!url || HOST_RUIDO.test(url)) return false;
  if (RE_IMG_EXT.test(url)) return false;
  if (RE_DOC_EXT.test(url)) return true;                       // arquivo .pdf/.doc… → sempre
  const alvo = `${url} ${label || ''}`;
  // Sem extensão de arquivo: só aceita se a URL/âncora cita explicitamente um doc
  // E aponta para um recurso (evita capturar a própria página do anúncio).
  return /matr[ií]cul|edital|laudo|avalia|proposta|certid|\/docs?\/|\/documento|\/arquivo|\/anexo|\/download|blob\.core|amazonaws|storage|\/file/i.test(alvo);
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
    const texto = a[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    if (href && !ancoraTexto.has(href)) ancoraTexto.set(href, texto);
  }

  // 2) Todas as URLs candidatas: atributos href/src + QUALQUER string entre aspas
  //    que pareça URL (pega o JSON do __NEXT_DATA__/estado embutido). Mais caminhos
  //    relativos de documento ("/editais/x.pdf").
  const urls = new Set();
  const push = (u) => { if (u) urls.add(u); };
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
    if (!ehDocumento(abs, label)) continue;
    const chave = abs.split('#')[0];
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
  out.anexos = out.anexos.slice(0, 25);
  return out;
}
