import React from 'react';

// Marca "B" da BidPro Brasil (mesma da logo.svg/favicon) — para usar DENTRO do
// quadrado colorido da marca, no lugar do ícone de malinha antigo. O "B" é branco
// e os vazados usam a cor do fundo do quadrado (bg), então some no quadrado azul.
export default function LogoB({ size = 20, bg = '#0D63DB', style }) {
  return (
    <svg width={size} height={size} viewBox="6 9 32 32" style={{ display: 'block', flexShrink: 0, ...style }} role="img" aria-label="BidPro Brasil">
      <path d="M10 12h12c4 0 7 2.5 7 6s-3 5.5-3 5.5 4 1.5 4 6c0 4-3.5 6.5-8 6.5H10V12z" fill="#ffffff" />
      <path d="M15 17h6c1.5 0 3 1 3 2.5S22.5 22 21 22h-6v-5z" fill={bg} />
      <path d="M15 27h7c2 0 3.5 1 3.5 2.8S24 32.5 22 32.5h-7V27z" fill={bg} />
    </svg>
  );
}
