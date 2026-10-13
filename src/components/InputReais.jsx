import { useState } from 'react';

// Campo de valor em reais para FILTROS (14/10, dono: "números com pontos, cifrão e vírgula").
// Guarda o número PURO (string de dígitos, ex.: "20000") — quem usa o valor no filtro não muda.
// Digitando: "R$ 20.000". Fora do foco: "R$ 20.000,00". Centavos não entram: filtro de faixa não
// precisa deles, e a máscara de centavos (digitar 20000 e virar 200,00) confunde mais do que ajuda.
const fmt = (n, dec) => Number(n).toLocaleString('pt-BR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

export default function InputReais({ value, onChange, placeholder, style }) {
  const [foco, setFoco] = useState(false);
  const digitos = String(value ?? '').replace(/\D/g, '');
  const mostrado = digitos ? `R$ ${fmt(digitos, foco ? 0 : 2)}` : '';
  return (
    <input
      type="text"
      inputMode="numeric"
      style={style}
      placeholder={placeholder}
      value={mostrado}
      onFocus={() => setFoco(true)}
      onBlur={() => setFoco(false)}
      // Só a parte inteira: "R$ 20.000,00" editado vira "20000" (o que vem depois da vírgula é ignorado).
      onChange={(e) => onChange(e.target.value.split(',')[0].replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 10))}
    />
  );
}
