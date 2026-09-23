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

// Link de documento embrulhado em LOGIN (`/login?redirect=_admin_%2Fupload%2Fx.pdf`, LEILOFY,
// 23/09): o site manda o visitante anônimo para a tela de login, mas o arquivo em si fica na
// mesma pasta pública de onde o espelho já copia laudo e edital (`/_admin_/upload/*.pdf`,
// status `copiado`). Devolve o endereço direto do arquivo; só MESMO host e só extensão de
// documento — nunca vira redirecionador aberto. Sem padrão reconhecível, devolve como veio.
export function urlDiretaDoDocumento(url) {
  const s = String(url || '');
  if (!/[?&](redirect|returnUrl|next)=/i.test(s)) return s;
  let u;
  try { u = new URL(s); } catch { return s; } // não é URL absoluta: não há o que desembrulhar
  const alvo = u.searchParams.get('redirect') || u.searchParams.get('returnUrl') || u.searchParams.get('next');
  if (!alvo || !/\.(pdf|jpe?g|png|docx?)$/i.test(alvo.split(/[?#]/)[0])) return s;
  let d;
  try { d = new URL(/^https?:/i.test(alvo) || alvo.startsWith('/') ? alvo : `/${alvo}`, u.origin); } catch { return s; }
  return d.origin === u.origin ? d.toString() : s;
}
