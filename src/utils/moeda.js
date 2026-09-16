// Máscara de dinheiro "digitando por trás" (cada dígito novo entra nos centavos, como um
// caixa eletrônico): 54835515 digitado vira 548.355,15. Único formato aceito pelos parsers
// já existentes (`replace(/\./g,'').replace(',','.')`), então não muda nada além da tela.
export function maskMoedaDigitando(raw) {
  const digits = String(raw ?? '').replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 15);
  if (!digits) return '';
  const centavos = parseInt(digits, 10);
  return (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
