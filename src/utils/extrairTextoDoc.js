// Extração de TEXTO/IMAGEM de um arquivo anexado, no navegador.
//
// POR QUE EXISTE (04/08): a tela de criar contrato oferece "anexe documentos para a IA
// extrair as informações" — e nunca mandava o conteúdo para lugar nenhum. Os anexos só
// eram enviados no passo FINAL, como links para o signatário consultar; a chamada de
// geração levava apenas a descrição digitada. Resultado: o dono anexou o contrato
// anterior pedindo "mantenha contratante e contratado" e recebeu um contrato cheio de
// [NOME COMPLETO] / [CPF: XXX.XXX.XXX-XX], porque o modelo nunca viu o documento.
//
// A rota `api/gerar-contrato-ia` já aceitava o campo `documentos` (texto já extraído) —
// faltava alguém preencher.
//
// IMAGENS (21/09, pedido do dono, depois de ver "não consegui ler" pra fotos de CNH/
// WhatsApp): não é mais um limite sem saída — a própria Claude enxerga imagem nativamente
// (sem OCR separado). JPG/PNG/WebP viram base64 e vão para `imagens` (ver
// extrairImagemBase64); o servidor manda como bloco de imagem na mensagem.
//
// REVISÃO 01/10 (dono: "o contrato saiu com [NOME COMPLETO DO FIADOR]" com as CNHs anexadas).
// Medido no navegador, com arquivo real de cada tipo — cada linha abaixo era um anexo que
// entrava como "lido" (ou sumia) sem a IA ver o dado:
//  · PNG com fundo TRANSPARENTE virava retângulo preto: o JPEG não tem alfa e o canvas pinta o
//    transparente de preto — texto preto sobre "nada" saía preto sobre preto. Agora o fundo é
//    branco antes de desenhar (igual ao que já se fazia nas páginas de PDF).
//  · PDF LONGO com páginas ESCANEADAS no meio (contrato com a CNH/certidão digitalizada no fim)
//    entrava como "lido" pelo texto da 1ª página, e as páginas-imagem eram descartadas caladas.
//    Agora a página sem camada de texto vira imagem também (até 3 por arquivo) e o que passar
//    disso é DITO, com o número das páginas.
//  · PDF com SENHA dava "Falha ao ler: No password given" — inglês, sem dizer o que fazer.
//  · DOCX (o formato natural de "o contrato do ano passado") era recusado. O `mammoth` já é
//    dependência (editor de e-book, src/utils/parseDocx.js) e carrega sob demanda: zero lib
//    nova, zero peso no bundle de quem não anexa Word. `.doc` (binário antigo) segue sem.
//  · HEIC era recusado sem tentar — mas o Safari (macOS/iPhone) DECODIFICA HEIC nativamente.
//    Agora tenta; só quando o navegador não abre é que o motivo é dito.
//  · Arquivo sem extensão (comum vindo do WhatsApp Web) caía em "formato desconhecido" mesmo
//    com o tipo MIME certo — o MIME agora desempata.
import { getPdfjs } from './pdfjs';

// Teto por arquivo. Um contrato inteiro cabe folgado; o que passar disso é cauda que não
// muda a qualificação das partes (que fica no começo) e só encareceria o prompt.
const MAX_CHARS_ARQUIVO = 60000;

// Teto do texto SOMADO de todos os anexos — o MESMO número que o servidor aplica
// (DOCS_MAX em api/gerar-contrato-ia.js). Antes o navegador mandava até 10 × 60 mil e o
// servidor cortava o conjunto no 60.000º caractere: quem perdia era sempre o ÚLTIMO anexo
// da lista, inteiro — e era justamente a CNH do fiador, anexada depois do contrato-modelo.
// Aqui o corte é repartido (ver repartirTexto): o arquivo curto entra inteiro e só o longo é
// aparado, com aviso por nome. Também mantém o corpo da requisição longe dos 4,5 MB da Vercel.
export const MAX_CHARS_TOTAL = 60000;

// Lado maior da imagem, em pixels, depois de redimensionada. 1568 é a própria recomendação
// da Anthropic para entendimento de imagem — acima disso o modelo redimensiona do lado dele
// mesmo antes de "olhar", então mandar maior só engorda o payload sem ganhar precisão. Vale
// duas vezes mais aqui: mantém a chamada dentro do limite de corpo da função da Vercel
// (4,5 MB, teto de plataforma, não configurável) mesmo com várias fotos de celular anexadas.
const MAX_IMG_DIM = 1568;
// Piso ao ENCOLHER para caber no orçamento (ver extrairTextoDeVarios): abaixo disso o número
// da CNH começa a borrar, e é melhor dizer "ficou de fora" do que mandar ilegível.
const MIN_IMG_DIM = 1000;
const IMG_QUALIDADE = 0.82;

// Página de PDF com menos que isto de texto é tratada como ESCANEADA (rodapé "Página 3 de 5",
// carimbo e número de folha passam disso raramente; uma página de cláusulas passa de 1.000).
const MIN_CHARS_PAGINA_COM_TEXTO = 100;

function limparTexto(s) {
  // Tira caracteres de CONTROLE (o pdf.js às vezes emite NUL e afins em PDFs mal gerados),
  // preservando quebra de linha e tabulação. Sem regex de control-char, que o lint barra.
  const semControle = Array.from(String(s || ''))
    .filter((c) => c === '\n' || c === '\t' || (c.codePointAt(0) ?? 0) >= 32)
    .join('');
  return semControle
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Extensão pelo NOME; sem extensão reconhecível, pelo MIME (arquivo do WhatsApp Web chega
// como "WhatsApp Image 2026-09-30 at 10.12.33" sem ".jpeg", com type image/jpeg).
const EXT_POR_MIME = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/bmp': 'bmp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'text/plain': 'txt', 'text/markdown': 'md',
};
const EXTS_CONHECIDAS = new Set([...Object.values(EXT_POR_MIME), 'jpeg', 'heif']);
function extensaoDe(file) {
  const nome = file?.name || '';
  const ext = nome.includes('.') ? (nome.split('.').pop() || '').toLowerCase() : '';
  if (EXTS_CONHECIDAS.has(ext)) return ext;
  return EXT_POR_MIME[(file?.type || '').toLowerCase()] || ext;
}

async function abrirPdf(file) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  return pdfjs.getDocument({ data: buf }).promise;
}

// Desenha a fonte (página de PDF ou bitmap) num canvas com FUNDO BRANCO e devolve JPEG base64.
function canvasParaJpeg(canvas) {
  const base64 = (canvas.toDataURL('image/jpeg', IMG_QUALIDADE).split(',')[1]) || '';
  if (!base64) throw new Error('canvas não gerou dados');
  return base64;
}

// PDF DIGITALIZADO → IMAGEM (30/09, dono: "anexei 2 CNH e o sistema não reconheceu"). A CNH
// digital e a certidão escaneada são PDF só com imagem, sem camada de texto: a tela dizia "não
// consegui ler" e a IA gerava o contrato sem o fiador. O pdf.js já desenha a página em canvas —
// cada página vira um JPEG para a visão da Claude, como uma foto anexada. Até 3 páginas por
// arquivo (CNH e certidão cabem em 1-2; mais que isso estouraria o teto de corpo da Vercel).
const MAX_PAGINAS_IMAGEM = 3;
async function paginasComoImagem(pdf, numeros) {
  const imagens = [];
  for (const n of numeros) {
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const escala = MAX_IMG_DIM / Math.max(base.width, base.height);
    const vp = page.getViewport({ scale: escala });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    imagens.push({ base64: canvasParaJpeg(canvas), mediaType: 'image/jpeg', pagina: n });
  }
  return imagens;
}

// Texto de cada página + quanto texto cada uma tem (é o que separa página escaneada de página
// de cláusulas). `lidasAte` < numPages quando o teto de caracteres parou a leitura: o resto do
// arquivo NÃO foi lido, e quem chama precisa dizer isso.
async function textoDePdf(pdf) {
  const partes = [];
  const charsPorPagina = [];
  let total = 0;
  let lidasAte = 0;
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    // `str` vazio + `hasEOL` marca quebra de linha: preservar ajuda o modelo a enxergar
    // a estrutura de cláusulas em vez de um bloco corrido.
    const linha = tc.items.map((i) => (i.str || '') + (i.hasEOL ? '\n' : '')).join('');
    partes.push(linha);
    charsPorPagina.push(limparTexto(linha).length);
    total += linha.length;
    lidasAte = n;
    if (total > MAX_CHARS_ARQUIVO) break;
  }
  return { texto: limparTexto(partes.join('\n')), charsPorPagina, lidasAte };
}

// Redimensiona e recodifica a imagem em JPEG, devolvendo o base64 CRU (sem o prefixo
// "data:image/jpeg;base64,") pronto pro bloco de imagem da API da Claude.
async function abrirBitmap(fonte) {
  // EXIF: foto de celular deitada traz a rotação só no EXIF. `from-image` é o padrão atual do
  // spec (e o Chromium já aplica — medido), mas navegador mais velho ignorava o EXIF sem a
  // opção explícita. Quem não conhece a opção lança TypeError: tenta de novo sem ela.
  try { return await createImageBitmap(fonte, { imageOrientation: 'from-image' }); }
  catch (e) {
    if (e?.name !== 'TypeError') throw e;
    return createImageBitmap(fonte);
  }
}

async function bitmapParaJpeg(fonte, maxDim) {
  const bitmap = await abrirBitmap(fonte);
  try {
    let { width, height } = bitmap;
    const maior = Math.max(width, height);
    if (maior > maxDim) {
      const escala = maxDim / maior;
      width = Math.max(1, Math.round(width * escala));
      height = Math.max(1, Math.round(height * escala));
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // FUNDO BRANCO antes de desenhar: JPEG não tem transparência e o canvas transparente vira
    // PRETO na conversão. PNG de print/documento com fundo transparente (texto preto) saía todo
    // preto — medido em 01/10 (pixel de fundo 0,0,0 sem esta linha, 255,255,255 com ela).
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return { base64: canvasParaJpeg(canvas), mediaType: 'image/jpeg' };
  } finally {
    bitmap.close?.();
  }
}

const extrairImagemBase64 = (file) => bitmapParaJpeg(file, MAX_IMG_DIM);

// Reencolhe um JPEG já gerado (para caber no orçamento de corpo da requisição).
async function encolherBase64(img, maxDim) {
  const bin = Uint8Array.from(atob(img.base64), (c) => c.charCodeAt(0));
  const r = await bitmapParaJpeg(new Blob([bin], { type: img.mediaType }), maxDim);
  return { ...img, ...r };
}

async function textoDeDocx(file) {
  // `mammoth` já está no projeto (editor de e-book) — import dinâmico, só desce quando alguém
  // anexa um Word. extractRawText devolve um parágrafo por linha.
  const mammoth = (await import('mammoth')).default;
  const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
  return limparTexto(value);
}

const resumoPaginas = (ns) => (ns.length > 6 ? `${ns.slice(0, 6).join(', ')}…` : ns.join(', '));

/**
 * @returns {Promise<{ texto: string|null, imagem: {base64:string, mediaType:string}|null, imagens?: object[], motivo: string|null, aviso?: string|null }>}
 *   texto  — conteúdo legível (ou null)
 *   imagem — base64 pronto para a API de visão da Claude (ou null)
 *   imagens — páginas de PDF desenhadas como imagem (escaneadas, ou documento curto)
 *   motivo — por que não deu nem texto nem imagem, em português, pronto para mostrar ao usuário
 *   aviso  — o arquivo ENTROU, mas não inteiro (o que ficou de fora, dito por extenso)
 *   complementar — as páginas-imagem repetem um texto já substancial (cedem primeiro no orçamento)
 */
export async function extrairTextoDoc(file) {
  const nome = file?.name || 'arquivo';
  const ext = extensaoDe(file);
  try {
    if (ext === 'pdf') {
      let pdf;
      try { pdf = await abrirPdf(file); }
      catch (e) {
        // pdf.js lança PasswordException (inglês, "No password given") — o operador precisa
        // saber O QUE fazer, não o nome da exceção.
        if (e?.name === 'PasswordException') {
          return { texto: null, imagem: null, motivo: `"${nome}" é um PDF protegido por senha — abra-o, salve/imprima como PDF sem senha (ou tire um print) e anexe de novo` };
        }
        throw e;
      }
      const { texto, charsPorPagina, lidasAte } = await textoDePdf(pdf);
      const avisos = [];
      if (lidasAte < pdf.numPages || texto.length > MAX_CHARS_ARQUIVO) {
        avisos.push(`"${nome}" é longo: li só o começo (${Math.min(lidasAte, pdf.numPages)} de ${pdf.numPages} páginas, até ${MAX_CHARS_ARQUIVO.toLocaleString('pt-BR')} caracteres)`);
      }
      // QUAIS PÁGINAS VÃO COMO IMAGEM:
      //  · PDF sem texto nenhum (digitalizado inteiro) → as primeiras páginas.
      //  · DOCUMENTO CURTO (01/10, dono: "leu o imóvel, mas não a CNH do fiador"): a CNH digital
      //    é PDF com texto SÓ nos rótulos ("NOME", "CPF", "DOC. IDENTIDADE"); os dados são
      //    desenho. Passava como "lido" com 200 caracteres de rótulo. PDF de até 3 páginas e
      //    pouco texto (identidade, certidão, IPTU) segue com o texto E as páginas.
      //  · PDF LONGO com páginas escaneadas no meio → só as páginas SEM camada de texto.
      const semTexto = !texto || texto.length < 40;
      const curto = pdf.numPages <= MAX_PAGINAS_IMAGEM && texto.length < 3000;
      let candidatas;
      if (semTexto || curto) candidatas = Array.from({ length: pdf.numPages }, (_, i) => i + 1);
      else candidatas = charsPorPagina.map((c, i) => (c < MIN_CHARS_PAGINA_COM_TEXTO ? i + 1 : 0)).filter(Boolean);
      const escolhidas = candidatas.slice(0, MAX_PAGINAS_IMAGEM);
      const deFora = candidatas.slice(MAX_PAGINAS_IMAGEM);
      // Páginas além do teto de leitura de texto nem foram examinadas: não dá para dizer se eram
      // escaneadas — o aviso de "li só o começo" acima já cobre.
      let imagens = [];
      if (escolhidas.length) {
        try { imagens = await paginasComoImagem(pdf, escolhidas); }
        catch (e) {
          if (semTexto) return { texto: null, imagem: null, motivo: `"${nome}" é um PDF digitalizado e não consegui convertê-lo em imagem: ${String(e?.message || e).slice(0, 120)}` };
          avisos.push(`"${nome}": li o texto, mas não consegui converter as páginas ${resumoPaginas(escolhidas)} em imagem (${String(e?.message || e).slice(0, 80)})`);
        }
      }
      if (deFora.length) {
        avisos.push(semTexto
          ? `"${nome}" é digitalizado: li as ${imagens.length} primeiras de ${pdf.numPages} páginas`
          : `"${nome}": a(s) página(s) escaneada(s) ${resumoPaginas(deFora)} ficou(aram) de fora (limite de ${MAX_PAGINAS_IMAGEM} páginas-imagem por arquivo) — anexe-as separadamente se tiverem dado das partes`);
      }
      const aviso = avisos.join(' · ') || null;
      if (semTexto) {
        if (imagens.length) return { texto: null, imagem: null, imagens, motivo: null, aviso };
        return { texto: null, imagem: null, motivo: `"${nome}" parece ser um PDF digitalizado (imagem), sem texto que dê para ler automaticamente` };
      }
      return { texto: texto.slice(0, MAX_CHARS_ARQUIVO), imagem: null, imagens, motivo: null, aviso, complementar: curto && texto.length >= 1500 };
    }
    if (ext === 'txt' || ext === 'md' || (file.type || '').startsWith('text/')) {
      const texto = limparTexto(await file.text());
      if (!texto) return { texto: null, imagem: null, motivo: `"${nome}" está vazio` };
      return { texto: texto.slice(0, MAX_CHARS_ARQUIVO), imagem: null, motivo: null, aviso: texto.length > MAX_CHARS_ARQUIVO ? `"${nome}" é longo: li só os primeiros ${MAX_CHARS_ARQUIVO.toLocaleString('pt-BR')} caracteres` : null };
    }
    if (ext === 'docx') {
      let texto;
      try { texto = await textoDeDocx(file); }
      catch (e) {
        return { texto: null, imagem: null, motivo: `Não consegui abrir o Word "${nome}" (${String(e?.message || e).slice(0, 80)}). Salve como PDF e anexe de novo` };
      }
      if (!texto) return { texto: null, imagem: null, motivo: `"${nome}" (Word) não tem texto — se for foto colada no Word, anexe a foto ou salve como PDF` };
      return { texto: texto.slice(0, MAX_CHARS_ARQUIVO), imagem: null, motivo: null, aviso: texto.length > MAX_CHARS_ARQUIVO ? `"${nome}" é longo: li só os primeiros ${MAX_CHARS_ARQUIVO.toLocaleString('pt-BR')} caracteres` : null };
    }
    if (ext === 'doc') {
      return { texto: null, imagem: null, motivo: `"${nome}" é Word no formato antigo (.doc) — salve como .docx ou PDF e anexe de novo` };
    }
    if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif'].includes(ext)) {
      try {
        const imagem = await extrairImagemBase64(file);
        return { texto: null, imagem, motivo: null };
      } catch (e) {
        if (ext === 'heic' || ext === 'heif') {
          return { texto: null, imagem: null, motivo: `"${nome}" é HEIC — formato de foto do iPhone que este navegador não abre (o Safari abre). Exporte como JPG ou tire um print e anexe de novo` };
        }
        return { texto: null, imagem: null, motivo: `Não consegui processar a imagem "${nome}": ${String(e?.message || e).slice(0, 120)}` };
      }
    }
    return { texto: null, imagem: null, motivo: `Não sei ler "${nome}" automaticamente (formato ${ext || 'desconhecido'})` };
  } catch (e) {
    return { texto: null, imagem: null, motivo: `Falha ao ler "${nome}": ${String(e?.message || e).slice(0, 120)}` };
  }
}

// Identidade de um arquivo na lista (para deduplicar e para casar com o rótulo "de quem é").
export const chaveArquivo = (f) => `${f?.name}|${f?.size}|${f?.lastModified}`;

// Divide `total` entre os blocos de texto "por baixo": cada um recebe o que precisa até a cota
// justa; a sobra dos curtos vai para os longos. Uma CNH de 800 caracteres nunca é cortada por
// causa de um contrato-modelo de 58 mil anexado antes dela.
function repartirTexto(tamanhos, total) {
  const cota = new Array(tamanhos.length).fill(0);
  let restante = total;
  let pendentes = tamanhos.map((t, i) => i).sort((a, b) => tamanhos[a] - tamanhos[b]);
  while (pendentes.length) {
    const justa = Math.floor(restante / pendentes.length);
    const i = pendentes[0];
    if (tamanhos[i] <= justa) { cota[i] = tamanhos[i]; restante -= tamanhos[i]; pendentes = pendentes.slice(1); continue; }
    for (const j of pendentes) cota[j] = justa;
    break;
  }
  return cota;
}

// Orçamento de imagens por geração: o corpo da função da Vercel tem teto de 4,5 MB e o servidor
// aceita até 10 imagens (api/gerar-contrato-ia.js). Passou disso, a imagem fica de fora E é dita.
const MAX_IMAGENS = 10;
const MAX_BASE64_TOTAL = 3_600_000;

/**
 * Extrai de vários arquivos: texto (PDF/txt/docx) vira um bloco rotulado, imagem vira base64
 * pronto pro bloco de visão da Claude — os dois contam como "lido".
 * @param {File[]} files
 * @param {Record<string,string>} [rotulos] chaveArquivo(f) → "de quem é / o que é" (ex.: "CNH do fiador")
 * @returns {Promise<{ documentos: string, imagens: {nome:string, base64:string, mediaType:string}[], lidos: string[], ignorados: string[], avisos: string[] }>}
 */
export async function extrairTextoDeVarios(files, rotulos = {}) {
  const lidos = [];
  const ignorados = [];
  const avisos = [];
  const textos = []; // { nome, texto }
  // prioridade 1 = a imagem É o conteúdo (foto, PDF escaneado, página escaneada);
  // prioridade 2 = página de PDF curto que também veio como TEXTO (há o que ler sem ela).
  const candidatas = []; // { arquivo, nome, img, prioridade, ordem }
  const lidoPorImagem = new Set();

  // Deduplica: o mesmo arquivo escolhido duas vezes gastava o orçamento de imagem duas vezes.
  const vistos = new Set();
  const unicos = (files || []).filter((f) => { const k = chaveArquivo(f); if (vistos.has(k)) return false; vistos.add(k); return true; });

  for (const f of unicos) {
    const papel = String(rotulos?.[chaveArquivo(f)] || '').trim().slice(0, 80);
    const rotulo = papel ? `${f.name} — ${papel}` : f.name;
    const { texto, imagem, imagens: paginas, motivo, aviso, complementar } = await extrairTextoDoc(f);
    if (aviso) avisos.push(aviso);
    if (texto) {
      textos.push({ nome: rotulo, texto, arquivo: f.name });
      lidos.push(f.name);
    }
    if (imagem) candidatas.push({ arquivo: f.name, nome: rotulo, img: imagem, prioridade: 1 });
    for (const p of (paginas || [])) {
      candidatas.push({
        arquivo: f.name,
        nome: paginas.length > 1 || p.pagina > 1 ? `${rotulo} (página ${p.pagina})` : rotulo,
        img: p,
        // Só é complementar a página de PDF curto cujo TEXTO já é substancial (IPTU, certidão
        // com camada de texto). A CNH digital traz ~200 caracteres de rótulo — ali a imagem é o
        // dado, prioridade 1. Página escaneada de PDF longo é o ÚNICO registro daquela página.
        prioridade: complementar ? 2 : 1,
      });
    }
    if (!texto && !imagem && !paginas?.length && motivo) ignorados.push(motivo);
  }

  // ORÇAMENTO DE IMAGEM: primeiro tenta caber ENCOLHENDO (até MIN_IMG_DIM), só depois descarta —
  // e descarta primeiro o complementar (prioridade 2), depois o fim da lista. Antes era
  // "quem chega primeiro leva": a CNH anexada por último ficava de fora por causa das páginas
  // de um IPTU anexado antes.
  candidatas.forEach((c, i) => { c.ordem = i; });
  const somar = (lista) => lista.reduce((s, c) => s + c.img.base64.length, 0);
  let escolhidas = [...candidatas].sort((a, b) => a.prioridade - b.prioridade || a.ordem - b.ordem);
  const foraDoLimite = escolhidas.slice(MAX_IMAGENS);
  escolhidas = escolhidas.slice(0, MAX_IMAGENS);
  if (somar(escolhidas) > MAX_BASE64_TOTAL) {
    const fator = Math.sqrt(MAX_BASE64_TOTAL / somar(escolhidas)) * 0.95;
    const dim = Math.max(MIN_IMG_DIM, Math.floor(MAX_IMG_DIM * fator));
    escolhidas = await Promise.all(escolhidas.map(async (c) => {
      try { return { ...c, img: await encolherBase64(c.img, dim) }; }
      catch (e) { console.warn('[extrairTextoDoc] não reencolheu', c.nome, e?.message || e); return c; }
    }));
  }
  while (escolhidas.length && somar(escolhidas) > MAX_BASE64_TOTAL) foraDoLimite.unshift(escolhidas.pop());
  escolhidas.sort((a, b) => a.ordem - b.ordem);

  const imagens = escolhidas.map((c) => ({ nome: c.nome, base64: c.img.base64, mediaType: c.img.mediaType }));
  for (const c of escolhidas) lidoPorImagem.add(c.arquivo);
  for (const nome of lidoPorImagem) if (!lidos.includes(nome)) lidos.push(nome);
  for (const c of foraDoLimite) {
    const msg = `"${c.nome}" (limite de ${MAX_IMAGENS} imagens / tamanho total por geração)`;
    // Arquivo que entrou por outro caminho (texto ou outra página) é leitura PARCIAL, não perda.
    if (lidos.includes(c.arquivo)) avisos.push(`${msg} — o resto do arquivo foi lido`);
    else ignorados.push(msg);
  }

  // TEXTO: reparte o teto total entre os arquivos (ver repartirTexto) e diz quem foi aparado.
  const cabecalho = (t) => `=== DOCUMENTO ANEXADO: ${t.nome} ===\n`;
  const cotas = repartirTexto(textos.map((t) => t.texto.length), Math.max(0, MAX_CHARS_TOTAL - textos.reduce((s, t) => s + cabecalho(t).length + 2, 0)));
  const blocos = textos.map((t, i) => {
    if (cotas[i] < t.texto.length) avisos.push(`"${t.arquivo}": entraram ${cotas[i].toLocaleString('pt-BR')} de ${t.texto.length.toLocaleString('pt-BR')} caracteres (os anexos juntos passam do que a IA lê de uma vez)`);
    return cabecalho(t) + t.texto.slice(0, cotas[i]);
  });

  return { documentos: blocos.join('\n\n'), imagens, lidos, ignorados, avisos };
}
