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
