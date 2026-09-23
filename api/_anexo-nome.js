// Nome de anexo SEM extensão ("MATRÍCULA") sai como application/octet-stream e o cliente de
// e-mail do destinatário não sabe abrir (23/09, 1º envio real ao leiloeiro). A extensão vem da
// URL (ignorando a query); sem pista, PDF — é o formato de edital/matrícula/laudo nesta base.
export function comExtensao(nome, url) {
  const base = String(nome || 'documento').trim() || 'documento';
  if (/\.[a-z0-9]{2,4}$/i.test(base)) return base;
  let caminho = String(url || '');
  try { caminho = decodeURIComponent(new URL(caminho).pathname); }
  catch { caminho = caminho.split(/[?#]/)[0]; } // path cru do bucket (docs pessoais) — usa como veio
  const m = caminho.match(/\.([a-z0-9]{2,4})$/i);
  let ext = m ? m[1].toLowerCase() : 'pdf';
  if (!/^(pdf|jpe?g|png|webp|docx?|xlsx?|zip)$/.test(ext)) ext = 'pdf';
  return `${base}.${ext}`;
}
