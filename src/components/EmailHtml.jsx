import React from 'react';

// ─── RENDER DE MENSAGEM DE E-MAIL (18/08) ─────────────────────────────────────────────
// O e-mail chega em duas formas: texto plano (fonte para IA/busca) e HTML (parágrafos,
// links, imagens). Renderizar o HTML CRU aqui seria entregar ao remetente — qualquer um
// da internet — execução no navegador do ADMIN, a sessão mais privilegiada do sistema.
// O iframe com `sandbox` SEM allow-scripts e SEM allow-same-origin resolve na raiz:
// nenhum script executa, nada enxerga a página-mãe; só sobra o layout. Links abrem em
// aba nova (allow-popups + <base target>). Custo conhecido e aceito: imagens remotas
// carregam, então o remetente pode saber que o e-mail foi aberto — igual a qualquer
// cliente de e-mail sem proxy de imagem.
// Endereço de e-mail clicado dentro da mensagem abre o "Escrever" do PRÓPRIO BidPro (24/09,
// pedido do dono), não o app de e-mail do aparelho. O iframe não roda script, então o caminho é
// reescrever o `mailto:` para a rota da caixa (`#/atendimento?escrever=…`) com target=_top —
// e o sandbox ganha `allow-top-navigation-by-user-activation` (só navega a página com CLIQUE).
// Para essa permissão não virar porta de phishing, TODO outro link perde o `target` que o
// remetente escreveu e cai no `<base target="_blank">` (aba nova); só os nossos vão ao topo.
export function hrefEscrever(mailto, base = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}${window.location.search}` : '') {
  const bruto = String(mailto || '').replace(/^mailto:/i, '');
  const [end, qs] = bruto.split('?');
  const para = decodeURIComponent(end || '').trim();
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(para.split(',')[0] || '')) return null;
  const assunto = new URLSearchParams(qs || '').get('subject');
  return `${base}#/atendimento?escrever=${encodeURIComponent(para)}${assunto ? `&assunto=${encodeURIComponent(assunto)}` : ''}`;
}

export function prepararHtml(html) {
  if (typeof DOMParser === 'undefined') return html;
  const doc = new DOMParser().parseFromString(`<body>${html || ''}</body>`, 'text/html');
  doc.querySelectorAll('a').forEach((a) => {
    a.removeAttribute('target');
    const href = a.getAttribute('href') || '';
    if (/^mailto:/i.test(href)) {
      const nosso = hrefEscrever(href);
      if (nosso) { a.setAttribute('href', nosso); a.setAttribute('target', '_top'); }
      else a.removeAttribute('href');
    }
  });
  return doc.body.innerHTML;
}

export default function EmailHtml({ html, altura = 320 }) {
  const corpo = React.useMemo(() => prepararHtml(html), [html]);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">`
    + `<style>body{margin:8px;font:13px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;word-break:break-word}img{max-width:100%;height:auto}</style>`
    + `</head><body>${corpo}</body></html>`;
  return (
    <iframe
      title="Mensagem de e-mail"
      sandbox="allow-popups allow-top-navigation-by-user-activation"
      srcDoc={doc}
      style={{ width: '100%', minHeight: 120, height: altura, border: 'none', borderRadius: 8, background: 'white' }}
    />
  );
}
