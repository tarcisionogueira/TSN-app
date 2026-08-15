/**
 * CLASSIFICAÇÃO DE DOCUMENTO PELO CONTEÚDO — a peça que faz a leitura funcionar
 * independentemente do formato do arquivo (pedido do dono, 15/08).
 *
 * POR QUE EXISTE. Cada caminho de leitura decidia o tipo do arquivo por conta própria, e
 * todos decidiam pela URL. Isso quebra de duas formas, e as duas estão no acervo:
 *
 *   1. **URL sem extensão** — 10.263 documentos ativos, incluindo ~2.100 MATRÍCULAS
 *      (PESTANA, WEBLEILOES, CALIL) servidas por endpoint de API
 *      (`.../lotes/424396/matricula/6863598`). Quem pergunta "termina em .pdf?" não
 *      reconhece nenhuma delas.
 *   2. **Binário que não é PDF** — o caminho antigo caía num `buf.toString('utf8')` final,
 *      então um JPEG virava uma tira de caracteres aleatórios que passava adiante como
 *      "texto do documento". A IA recebia lixo e respondia sobre nada; o sistema registrava
 *      que tinha lido. É a forma nº 1 do CLAUDE.md — resposta vazia entregue como conteúdo.
 *
 * A REGRA AQUI: o tipo vem dos MAGIC BYTES, nunca da URL e nunca só do content-type (o
 * leiloeiro manda `application/octet-stream` para PDF o tempo todo). E o que não dá para
 * ler com segurança volta como `desconhecido` COM MOTIVO — nunca como texto vazio, que é
 * indistinguível de "o documento não diz nada".
 *
 * Formatos que a IA lê nativamente: PDF (inclusive escaneado, por visão) e imagem
 * JPEG/PNG/GIF/WebP. TIFF e BMP não são aceitos pela API e converter exigiria dependência
 * de imagem nova — voltam declarados, para o chamador dizer "não consegui ler" em vez de
 * fingir que leu.
 */

// Tipos de imagem que a API da Anthropic aceita como bloco `image`.
const IMAGEM_OK = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

/** Assinatura binária → media type. `null` quando não é um binário conhecido. */
function porMagicBytes(buf) {
  if (!buf || buf.length < 4) return null;
  const b = buf;
  const ascii = (ini, fim) => b.slice(ini, fim).toString('latin1');
  if (ascii(0, 5) === '%PDF-') return 'application/pdf';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(0, 8) === '\x89PNG\r\n\x1a\n') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  if (ascii(0, 4) === 'II*\0' || ascii(0, 4) === 'MM\0*') return 'image/tiff';
  if (ascii(0, 2) === 'BM') return 'image/bmp';
  if (ascii(0, 4) === 'PK\x03\x04') return 'application/zip'; // docx/xlsx/odt
  return null;
}

/**
 * Classifica o que veio no corpo da resposta.
 * → { kind: 'pdf' | 'imagem' | 'texto' | 'desconhecido', mediaType, base64?, texto?, motivo? }
 *
 * `kind: 'desconhecido'` SEMPRE traz `motivo`: é o que permite ao chamador registrar
 * "não consegui ler este documento" em vez de seguir como se ele fosse vazio.
 */
export function classificarDocumento(buf, { url = '', contentType = '', maxBytes = 6_000_000, semBase64 = false } = {}) {
  if (!buf || !buf.length) return { kind: 'desconhecido', motivo: 'corpo vazio' };
  const mt = porMagicBytes(buf);
  // `semBase64` para quem só precisa saber O QUE é (o extrator de texto, que vai passar o
  // Buffer direto ao pdf-parse): converter 12 MB para base64 e descartar em seguida é 16 MB
  // de pico de memória por documento, à toa, dentro de uma função serverless.
  const b64 = () => (semBase64 ? undefined : buf.toString('base64'));

  if (mt === 'application/pdf') {
    if (buf.length > maxBytes) return { kind: 'desconhecido', mediaType: mt, motivo: `PDF de ${Math.round(buf.length / 1e6)} MB acima do limite` };
    return { kind: 'pdf', mediaType: 'application/pdf', base64: b64() };
  }
  if (mt && mt.startsWith('image/')) {
    if (!IMAGEM_OK.has(mt)) return { kind: 'desconhecido', mediaType: mt, motivo: `imagem ${mt.replace('image/', '').toUpperCase()} não é aceita pela IA (precisaria conversão)` };
    if (buf.length > maxBytes) return { kind: 'desconhecido', mediaType: mt, motivo: `imagem de ${Math.round(buf.length / 1e6)} MB acima do limite` };
    return { kind: 'imagem', mediaType: mt, base64: b64() };
  }
  if (mt === 'application/zip') {
    return { kind: 'desconhecido', mediaType: mt, motivo: 'arquivo compactado (docx/xlsx/zip) — não extraímos este formato' };
  }

  // Não é binário conhecido: só vale como TEXTO se de fato parecer texto. Sem esta trava,
  // qualquer formato novo voltaria a virar uma tira de bytes com cara de documento lido.
  const amostra = buf.slice(0, 2048);
  let controle = 0;
  for (const c of amostra) { if (c === 0) { controle = Infinity; break; } if (c < 9 || (c > 13 && c < 32)) controle++; }
  if (controle > amostra.length * 0.05) {
    return { kind: 'desconhecido', mediaType: contentType || null, motivo: 'binário de formato não reconhecido' };
  }
  const texto = buf.toString('utf8')
    .replace(/<script[^]*?<\/script>/gi, ' ').replace(/<style[^]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
  if (texto.length < 80) return { kind: 'desconhecido', mediaType: contentType || null, motivo: 'texto curto demais para ser documento' };
  return { kind: 'texto', mediaType: 'text/plain', texto };
}

/**
 * Bloco pronto para a API da Anthropic — `document` para PDF, `image` para imagem. É o que
 * torna o formato do arquivo indiferente para quem monta o prompt.
 */
export function blocoParaIA(doc, titulo = 'documento') {
  if (doc?.kind === 'pdf') return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: doc.base64 }, title: titulo };
  if (doc?.kind === 'imagem') return { type: 'image', source: { type: 'base64', media_type: doc.mediaType, data: doc.base64 } };
  return null;
}

/**
 * O texto extraído de um PDF é APROVEITÁVEL? Um PDF escaneado devolve string vazia ou um
 * punhado de caracteres de cabeçalho, e "pouco texto" foi tratado como "documento sem a
 * informação" — o motivo de 28.355 matrículas disponíveis renderem 5 áreas lidas. Aqui a
 * diferença fica explícita: pouco texto significa PÁGINA EM IMAGEM, e o chamador deve
 * escalar para a visão em vez de desistir.
 */
export function temTextoUtil(texto, { minimo = 400 } = {}) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (t.length < minimo) return false;
  // Precisa ter palavras de verdade, não só ruído de extração.
  return (t.match(/[A-Za-zÀ-ú]{4,}/g) || []).length >= 40;
}
