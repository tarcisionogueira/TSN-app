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
// extrairImagemBase64); o servidor manda como bloco de imagem na mensagem. HEIC continua
// sem suporte (decodificação inconsistente entre navegadores via canvas) — mesmo motivo de
// antes, mas agora é a exceção, não a regra.
//
// LIMITE HONESTO que sobra: DOC/DOCX e PDF digitalizado (imagem dentro de PDF, não teria
// como extrair a página como imagem solta aqui sem reescrever o parser de PDF) continuam
// sem leitura automática. Nesses casos devolvemos o MOTIVO, para a tela dizer ao usuário em
// vez de ignorar o arquivo em silêncio.
import { getPdfjs } from './pdfjs';

// Teto por arquivo. Um contrato inteiro cabe folgado; o que passar disso é cauda que não
// muda a qualificação das partes (que fica no começo) e só encareceria o prompt.
const MAX_CHARS_ARQUIVO = 60000;

// Lado maior da imagem, em pixels, depois de redimensionada. 1568 é a própria recomendação
// da Anthropic para entendimento de imagem — acima disso o modelo redimensiona do lado dele
// mesmo antes de "olhar", então mandar maior só engorda o payload sem ganhar precisão. Vale
// duas vezes mais aqui: mantém a chamada dentro do limite de corpo da função da Vercel
// (4,5 MB, teto de plataforma, não configurável) mesmo com várias fotos de celular anexadas.
const MAX_IMG_DIM = 1568;
const IMG_QUALIDADE = 0.82;

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

async function textoDePdf(file) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const partes = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const tc = await page.getTextContent();
    // `str` vazio + `hasEOL` marca quebra de linha: preservar ajuda o modelo a enxergar
    // a estrutura de cláusulas em vez de um bloco corrido.
    const linha = tc.items.map((i) => (i.str || '') + (i.hasEOL ? '\n' : '')).join('');
    partes.push(linha);
    if (partes.join('').length > MAX_CHARS_ARQUIVO) break;
  }
  return limparTexto(partes.join('\n'));
}

// Redimensiona e recodifica a imagem em JPEG, devolvendo o base64 CRU (sem o prefixo
// "data:image/jpeg;base64,") pronto pro bloco de imagem da API da Claude.
// `createImageBitmap` não decodifica HEIC de forma confiável entre navegadores — quem cair
// nesse formato lança e o chamador devolve o motivo honesto (mesma régua de sempre: falha
// vira mensagem, nunca silêncio).
async function extrairImagemBase64(file) {
  const bitmap = await createImageBitmap(file);
  try {
    let { width, height } = bitmap;
    const maior = Math.max(width, height);
    if (maior > MAX_IMG_DIM) {
      const escala = MAX_IMG_DIM / maior;
      width = Math.max(1, Math.round(width * escala));
      height = Math.max(1, Math.round(height * escala));
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = canvas.toDataURL('image/jpeg', IMG_QUALIDADE);
    const base64 = dataUrl.split(',')[1] || '';
    if (!base64) throw new Error('canvas não gerou dados');
    return { base64, mediaType: 'image/jpeg' };
  } finally {
    bitmap.close?.();
  }
}

/**
 * @returns {Promise<{ texto: string|null, imagem: {base64:string, mediaType:string}|null, motivo: string|null }>}
 *   texto  — conteúdo legível (ou null)
 *   imagem — base64 pronto para a API de visão da Claude (ou null)
 *   motivo — por que não deu nem texto nem imagem, em português, pronto para mostrar ao usuário
 */
export async function extrairTextoDoc(file) {
  const nome = file?.name || 'arquivo';
  const ext = (nome.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'pdf') {
      const texto = await textoDePdf(file);
      // PDF DIGITALIZADO: o arquivo abre, tem páginas, e a camada de texto vem vazia.
      // Sem isso o anexo passaria como "lido" contribuindo com nada — o mesmo silêncio
      // que originou este bug. (Diferente de foto solta: a página vem como PDF, não dá
      // pra virar imagem sem reescrever o parser — fica como limite documentado.)
      if (!texto || texto.length < 40) {
        return { texto: null, imagem: null, motivo: `"${nome}" parece ser um PDF digitalizado (imagem), sem texto que dê para ler automaticamente` };
      }
      return { texto: texto.slice(0, MAX_CHARS_ARQUIVO), imagem: null, motivo: null };
    }
    if (ext === 'txt' || ext === 'md' || (file.type || '').startsWith('text/')) {
      const texto = limparTexto(await file.text());
      if (!texto) return { texto: null, imagem: null, motivo: `"${nome}" está vazio` };
      return { texto: texto.slice(0, MAX_CHARS_ARQUIVO), imagem: null, motivo: null };
    }
    if (['doc', 'docx'].includes(ext)) {
      return { texto: null, imagem: null, motivo: `"${nome}" é Word — a leitura automática só funciona com PDF ou imagem. Salve como PDF e anexe de novo` };
    }
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      try {
        const imagem = await extrairImagemBase64(file);
        return { texto: null, imagem, motivo: null };
      } catch (e) {
        return { texto: null, imagem: null, motivo: `Não consegui processar a imagem "${nome}": ${String(e?.message || e).slice(0, 120)}` };
      }
    }
    if (ext === 'heic' || ext === 'heif') {
      return { texto: null, imagem: null, motivo: `"${nome}" é HEIC — formato de foto do iPhone que o navegador não consegue abrir aqui. Exporte como JPG e anexe de novo` };
    }
    return { texto: null, imagem: null, motivo: `Não sei ler "${nome}" automaticamente (formato ${ext || 'desconhecido'})` };
  } catch (e) {
    return { texto: null, imagem: null, motivo: `Falha ao ler "${nome}": ${String(e?.message || e).slice(0, 120)}` };
  }
}

/**
 * Extrai de vários arquivos: texto (PDF/txt) vira um bloco rotulado, imagem (JPG/PNG/WebP)
 * vira base64 pronto pro bloco de visão da Claude — os dois contam como "lido".
 * @returns {Promise<{ documentos: string, imagens: {nome:string, base64:string, mediaType:string}[], lidos: string[], ignorados: string[] }>}
 */
export async function extrairTextoDeVarios(files) {
  const blocos = [];
  const imagens = [];
  const lidos = [];
  const ignorados = [];
  for (const f of (files || [])) {
    const { texto, imagem, motivo } = await extrairTextoDoc(f);
    if (texto) {
      blocos.push(`=== DOCUMENTO ANEXADO: ${f.name} ===\n${texto}`);
      lidos.push(f.name);
    } else if (imagem) {
      imagens.push({ nome: f.name, ...imagem });
      lidos.push(f.name);
    } else if (motivo) {
      ignorados.push(motivo);
    }
  }
  return { documentos: blocos.join('\n\n'), imagens, lidos, ignorados };
}
