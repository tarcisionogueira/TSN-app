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
export default function EmailHtml({ html, altura = 320 }) {
  const doc = `<!doctype html><html><head><meta charset="utf-8"><base target="_blank">`
    + `<style>body{margin:8px;font:13px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;word-break:break-word}img{max-width:100%;height:auto}</style>`
    + `</head><body>${html}</body></html>`;
  return (
    <iframe
      title="Mensagem de e-mail"
      sandbox="allow-popups"
      srcDoc={doc}
      style={{ width: '100%', minHeight: 120, height: altura, border: 'none', borderRadius: 8, background: 'white' }}
    />
  );
}
