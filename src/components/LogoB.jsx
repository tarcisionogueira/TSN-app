import React from 'react';

// Marca "B" da BidPro Brasil — versão geométrica limpa, alinhada ao código da
// marca (docs/MARCA.md): "B" branco, geométrico e em camadas, para viver DENTRO
// do quadrado azul arredondado. Os vazados (contra-formas) usam a cor do fundo
// (bg), então somem no quadrado e o "B" fica sólido e nítido em qualquer tamanho.
export default function LogoB({ size = 20, bg = '#0D63DB', style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" style={{ display: 'block', flexShrink: 0, ...style }} role="img" aria-label="BidPro Brasil">
      {/* Silhueta do B */}
      <path d="M12 8 H27 C33 8 37 11.6 37 16.5 C37 20.2 34.8 23 31.6 24 C35.2 24.8 37.6 27.9 37.6 32 C37.6 36.7 33.6 40 27.4 40 H12 Z" fill="#ffffff" />
      {/* Contra-forma superior */}
      <path d="M19 14 H26.5 C29.2 14 31 15.1 31 17 C31 18.9 29.2 20 26.5 20 H19 Z" fill={bg} />
      {/* Contra-forma inferior */}
      <path d="M19 28 H27 C30 28 32 29.4 32 31.8 C32 34.2 30 35.8 27 35.8 H19 Z" fill={bg} />
    </svg>
  );
}
