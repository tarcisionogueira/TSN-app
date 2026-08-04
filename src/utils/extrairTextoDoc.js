// Extração de TEXTO de um arquivo anexado, no navegador.
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
// LIMITE HONESTO: dá para ler PDF com camada de texto e arquivos de texto puro. DOC/DOCX
// e imagens (e PDF digitalizado, que é imagem por dentro) NÃO são legíveis aqui — não há
// biblioteca de docx nem OCR no bundle. Nesses casos devolvemos o MOTIVO, para a tela
// dizer ao usuário em vez de ignorar o arquivo em silêncio, que é o defeito que estamos
// corrigindo.
import { getPdfjs } from './pdfjs';

// Teto por arquivo. Um contrato inteiro cabe folgado; o que passar disso é cauda que não
// muda a qualificação das partes (que fica no começo) e só encareceria o prompt.
const MAX_CHARS_ARQUIVO = 60000;

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

/**
 * @returns {Promise<{ texto: string|null, motivo: string|null }>}
 *   texto  — conteúdo legível (ou null)
 *   motivo — por que não deu, em português, pronto para mostrar ao usuário
 */
export async function extrairTextoDoc(file) {
  const nome = file?.name || 'arquivo';
  const ext = (nome.split('.').pop() || '').toLowerCase();
  try {
    if (ext === 'pdf') {
      const texto = await textoDePdf(file);
      // PDF DIGITALIZADO: o arquivo abre, tem páginas, e a camada de texto vem vazia.
      // Sem isso o anexo passaria como "lido" contribuindo com nada — o mesmo silêncio
      // que originou este bug.
      if (!texto || texto.length < 40) {
        return { texto: null, motivo: `"${nome}" parece ser um PDF digitalizado (imagem), sem texto que dê para ler automaticamente` };
      }
      return { texto: texto.slice(0, MAX_CHARS_ARQUIVO), motivo: null };
    }
    if (ext === 'txt' || ext === 'md' || (file.type || '').startsWith('text/')) {
      const texto = limparTexto(await file.text());
      if (!texto) return { texto: null, motivo: `"${nome}" está vazio` };
      return { texto: texto.slice(0, MAX_CHARS_ARQUIVO), motivo: null };
    }
    if (['doc', 'docx'].includes(ext)) {
      return { texto: null, motivo: `"${nome}" é Word — a leitura automática só funciona com PDF. Salve como PDF e anexe de novo` };
    }
    if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(ext)) {
      return { texto: null, motivo: `"${nome}" é imagem — a leitura automática só funciona com PDF` };
    }
    return { texto: null, motivo: `Não sei ler "${nome}" automaticamente (formato ${ext || 'desconhecido'})` };
  } catch (e) {
    return { texto: null, motivo: `Falha ao ler "${nome}": ${String(e?.message || e).slice(0, 120)}` };
  }
}

/**
 * Extrai de vários arquivos e monta UM bloco de texto rotulado por arquivo.
 * @returns {Promise<{ documentos: string, lidos: string[], ignorados: string[] }>}
 */
export async function extrairTextoDeVarios(files) {
  const blocos = [];
  const lidos = [];
  const ignorados = [];
  for (const f of (files || [])) {
    const { texto, motivo } = await extrairTextoDoc(f);
    if (texto) {
      blocos.push(`=== DOCUMENTO ANEXADO: ${f.name} ===\n${texto}`);
      lidos.push(f.name);
    } else if (motivo) {
      ignorados.push(motivo);
    }
  }
  return { documentos: blocos.join('\n\n'), lidos, ignorados };
}
