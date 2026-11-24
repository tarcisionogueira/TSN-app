// O chat de suporte mostra TEXTO PURO, mas a IA às vezes responde em Markdown — o cliente via
// "**Busca de Imóveis**" com os asteriscos (dono, 23/11). Usado no servidor (api/chat-suporte.js, antes de
// gravar) e nas telas (mensagens antigas que já estão no banco com os asteriscos).
// Conservador de propósito: só tira marcação; nunca mexe em número, valor ou link.
export function semMarkdown(texto) {
  return String(texto ?? '')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1: $2') // [texto](url) → texto: url
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')                            // # Título
    .replace(/^(\s*)[-*+]\s+/gm, '$1• ')                           // - item / * item
    .replace(/\*\*([^*\n]+?)\*\*/g, '$1')                          // **negrito**
    .replace(/__([^_\n]+?)__/g, '$1')                              // __negrito__
    .replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s.,;:!?)]|$)/gm, '$1$2') // *itálico*
    .replace(/\*\*/g, '')                                          // sobra de ** sem par
    .replace(/`([^`\n]+)`/g, '$1');                                // `código`
}
