import React from 'react';

// Marca "B" da BidPro Brasil — versão geométrica limpa, alinhada ao código da
// marca (docs/MARCA.md): "B" branco, geométrico e em camadas, para viver DENTRO
// do quadrado azul arredondado. Os vazados (contra-formas) usam a cor do fundo
// (bg), então somem no quadrado e o "B" fica sólido e nítido em qualquer tamanho.
export default function LogoB({ size = 20, bg = '#0D63DB', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0, ...style }} role="img" aria-label="BidPro Brasil">
      {/* Silhueta do B (mais encorpada) */}
      <path d="M11 7 H27 C33.5 7 38 10.8 38 16 C38 19.8 35.6 22.6 32.2 23.6 C36.2 24.4 39 27.5 39 32 C39 37.3 34.8 41 28 41 H11 Z" fill="#ffffff" />
      {/* Contra-forma superior */}
      <path d="M19 14 H26 C28.4 14 30 15 30 16.8 C30 18.6 28.4 19.6 26 19.6 H19 Z" fill={bg} />
      {/* Contra-forma inferior */}
      <path d="M19 28.4 H26.5 C29.2 28.4 31 29.6 31 31.7 C31 33.8 29.2 34.8 26.5 34.8 H19 Z" fill={bg} />
    </svg>
  );
}
