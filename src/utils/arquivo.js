// Conversão de arquivo → base64 para mandar ao extrator de documentos (IA).
//
// Existiam TRÊS implementações disso espalhadas pelo front, e uma delas derrubava a aba:
//   • Analise.jsx (upload de documento) — em blocos, correta;
//   • Analise.jsx (upload de MATRÍCULA) — `String.fromCharCode(...new Uint8Array(buf))`:
//     espalha CADA BYTE do PDF como argumento de função. Alguns MB = milhões de argumentos
//     na pilha → "Maximum call stack size exceeded" e a tela morre. Foi o crash registrado
//     em 30/07 na /analise, logo depois de anexar arquivo;
//   • Admin.jsx — laço byte a byte concatenando string: não quebra, mas num PDF de vários MB
//     são milhões de concatenações, o que congela a aba por segundos.
//
// Uma implementação só, em blocos: rápida e sem risco de pilha.
const BLOCO = 0x8000; // 32k argumentos por chamada — folga grande sobre o limite do motor JS

export function bytesParaBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += BLOCO) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + BLOCO));
  }
  return btoa(bin);
}

export async function arquivoParaBase64(file) {
  return bytesParaBase64(new Uint8Array(await file.arrayBuffer()));
}

// Nome de arquivo seguro para CHAVE do Supabase Storage.
//
// POR QUE EXISTE (04/08): o upload dos "documentos de referência" do contrato montava a
// chave com `${Date.now()}-${f.name}` CRU. O dono anexou
// "CONTRATO PRESTAÇÃO DE SERVIÇO DE ASSESSORIA.pdf" e o Storage respondeu
// `Invalid key: …` (400) — a chave não aceita acento/cedilha. Pior: o `error` do upload
// era DESCARTADO (`const { data: up } = await …`), então o contrato seguia para assinatura
// sem o anexo e ninguém era avisado. Só apareceu porque o logger global grava em
// `erros_cliente`.
//
// Mantém legível (o nome aparece na lista de documentos), sem acento e sem caractere que
// a chave rejeite. Preserva a extensão.
export function nomeArquivoSeguro(nome, maxBase = 70) {
  const bruto = String(nome || 'arquivo');
  const ponto = bruto.lastIndexOf('.');
  const temExt = ponto > 0 && ponto > bruto.length - 12;
  const base = temExt ? bruto.slice(0, ponto) : bruto;
  const ext = temExt ? bruto.slice(ponto + 1) : '';

  const limpar = (s) => s
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // tira acentos (PRESTAÇÃO → PRESTACAO)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')                 // espaço e símbolo → _
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  const baseLimpa = limpar(base).slice(0, maxBase) || 'arquivo';
  const extLimpa = limpar(ext).toLowerCase().slice(0, 10);
  return extLimpa ? `${baseLimpa}.${extLimpa}` : baseLimpa;
}
