/**
 * Converte a "URL do vídeo" da aula no player certo. Recomendado: URL de EMBED (iframe) da
 * Bunny Stream — o player da Bunny já cuida de HLS adaptativo, token e tela cheia em qualquer
 * navegador. Também aceita YouTube, Vimeo, Panda e MP4 direto.
 *
 * ⚠️ AO ADICIONAR PROVEDOR NOVO: o host precisa entrar no `frame-src` da CSP, em `vercel.json`.
 * Foi exatamente isto que quebrou o primeiro vídeo do dono (11/08): o embed do YouTube estava
 * certo, o link abria no navegador, e dentro do app o iframe era BLOQUEADO pela política — a
 * tela mostrava um retângulo cinza com ícone de arquivo quebrado, sem erro visível em lugar
 * nenhum. Código certo, entrega errada.
 *
 * Vive em utils porque é usado pela tela do curso E pelo pop-up de boas-vindas; duplicado,
 * um dos dois ficaria para trás no dia em que entrar um provedor novo.
 */
export function videoEmbed(url) {
  const u = String(url || '').trim();
  if (!u) return null;
  let m = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i);
  if (m) {
    // youtube-nocookie: não grava cookie de rastreio antes do play (LGPD) e é idêntico no resto.
    // rel=0 mantém as sugestões do fim no nosso canal; modestbranding tira a marca d'água.
    // enablejsapi=1 faz o player AVISAR quando o vídeo termina (via postMessage) — é o que
    // permite marcar a aula como assistida sozinha, sem cronômetro e sem script de terceiro.
    // Ver src/components/PlayerVideo.jsx. `origin` é exigido pelo player quando a API está on.
    const origem = typeof window !== 'undefined' && window.location?.origin ? `&origin=${encodeURIComponent(window.location.origin)}` : '';
    return { tipo: 'iframe', src: `https://www.youtube-nocookie.com/embed/${m[1]}?rel=0&modestbranding=1&playsinline=1&enablejsapi=1${origem}` };
  }
  m = u.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (m) return { tipo: 'iframe', src: `https://player.vimeo.com/video/${m[1]}` };
  // Arquivo de vídeo progressivo (MP4/WebM/OGG) → tag <video> nativa.
  if (/\.(mp4|webm|ogg)(\?|$)/i.test(u)) return { tipo: 'video', src: u };
  // Bunny Stream / Panda / qualquer URL de embed → iframe (o player do provedor cuida do HLS).
  return { tipo: 'iframe', src: u };
}
