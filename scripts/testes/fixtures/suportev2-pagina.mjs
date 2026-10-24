// Remonta a página de lote do Suporte v2 (Next.js App Router) a partir do `initialLote` REAL guardado em
// suportev2-lotes.json, no formato que o HTML de 24/10 tinha: fluxo RSC com uma linha de layout trazendo
// `"initialLote":null`, a descrição como linha de texto `2e:T<bytes em hex>,` SEM quebra de linha no fim, a linha do
// lote e mais uma depois; o fluxo picado em pedaços de ~4 KB (que cortam string no meio) e cada pedaço num
// `self.__next_f.push([1,"…"])` com `<` escapado como no Next.
export function paginaRsc(lote, textos = {}, { pedaco = 4000 } = {}) {
  let fluxo = '1:"$Sreact.fragment"\n1c:{"locale":"pt","id":"' + lote.id + '"}\n'
    + '2:["$","$L1b",null,{"params":"$@1c","initialLote":null}]\n';
  for (const [id, t] of Object.entries(textos)) fluxo += `${id}:T${Buffer.byteLength(t, 'utf8').toString(16)},${t}`;
  fluxo += `1d:["$","$L1b",null,{"params":"$@1c","initialLote":${JSON.stringify(lote)}}]\n`;
  fluxo += 'f:[["$","script",null,{"type":"application/ld+json"}]]\n';
  const scripts = [];
  for (let i = 0; i < fluxo.length; i += pedaco) {
    scripts.push(`<script>self.__next_f.push([1,${JSON.stringify(fluxo.slice(i, i + pedaco)).replace(/</g, '\\u003c')}])</script>`);
  }
  return `<!DOCTYPE html><html lang="pt-BR"><head><title>${String(lote.titulo || '').slice(0, 30)}… | Marco Antônio Leiloeiro</title></head>`
    + `<body><script>(self.__next_f=self.__next_f||[]).push([0])</script>${scripts.join('')}</body></html>`;
}
