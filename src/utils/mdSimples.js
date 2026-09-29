// Markdown MÍNIMO e seguro para texto gerado por IA (## títulos, **negrito**, listas "- ").
// Escapa o HTML ANTES de transformar — o texto da IA nunca vira marcação arbitrária.
// Usado no parecer do relatório de veículo (tela e PDF): antes aparecia "## …" e "**…**" cru.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function mdSimplesParaHtml(md) {
  const linhas = esc(md).split(/\r?\n/);
  const out = [];
  let lista = false;
  const inline = (t) => t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  for (const l of linhas) {
    const item = l.match(/^\s*[-*•]\s+(.*)$/);
    if (item) { if (!lista) { out.push('<ul>'); lista = true; } out.push(`<li>${inline(item[1])}</li>`); continue; }
    if (lista) { out.push('</ul>'); lista = false; }
    const h = l.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) out.push(`<h4>${inline(h[1])}</h4>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  if (lista) out.push('</ul>');
  return out.join('');
}
