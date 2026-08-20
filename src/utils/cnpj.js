// CNPJ — normalização + validação por dígito verificador.
//
// POR QUE EXISTE (20/08): um parceiro (Zênite) teve um CNPJ VÁLIDO recusado como
// "CNPJ inválido — informe os 14 dígitos". A tela só checava `replace(/\D/g,'').length === 14`.
// O `\D` remove QUALQUER caractere que não seja 0-9 ASCII — inclusive DÍGITOS UNICODE
// "sósia" (largura total ０-９, árabe-índicos ٠-٩) que teclados de celular e a cópia do
// WhatsApp às vezes produzem. Um "３１.４０２..." colado vira <14 dígitos após o strip → recusa.
// Aqui: (1) NFKC + mapa explícito normaliza os sósia para ASCII antes de contar; (2) valida
// os DÍGITOS VERIFICADORES de verdade (antes só o tamanho — aceitava 14 dígitos quaisquer).
//
// FORMATO ALFANUMÉRICO (Receita, vigente a partir de 2026): os 12 primeiros caracteres podem
// ter LETRAS; os 2 DV continuam numéricos. O algoritmo oficial usa (ASCII do char − 48) como
// valor de cada posição — que para um CNPJ 100% numérico é idêntico ao cálculo clássico. Por
// isso a mesma função valida o CNPJ antigo (numérico) e o novo (alfanumérico).

// Dígitos Unicode comuns → ASCII (o NFKC cobre a largura-total; o mapa cobre os árabe-índicos,
// que o NFKC NÃO converte).
const SOSIA = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

// Deixa só [0-9A-Z], normalizando sósia Unicode. Serve para exibir e para validar.
export function limparCnpj(s) {
  return String(s || '')
    .normalize('NFKC')                      // largura-total → ASCII (１ → 1), etc.
    .replace(/[٠-٩۰-۹]/g, (d) => SOSIA[d] || d)  // árabe-índicos → ASCII
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');
}

// Valida CNPJ (numérico OU alfanumérico) pelos dígitos verificadores.
export function cnpjValido(entrada) {
  const c = limparCnpj(entrada);
  if (c.length !== 14) return false;
  if (/^(.)\1{13}$/.test(c)) return false;          // todos iguais (00000000000000 etc.)
  if (!/^\d{2}$/.test(c.slice(12))) return false;    // os 2 DV têm de ser numéricos
  const val = (ch) => ch.charCodeAt(0) - 48;         // '0'→0 … '9'→9 … 'A'→17 (algoritmo oficial)
  const dv = (len) => {
    let peso = len - 7, soma = 0;
    for (let i = 0; i < len; i++) { soma += val(c[i]) * peso; peso = peso === 2 ? 9 : peso - 1; }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(c[12]) && dv(13) === Number(c[13]);
}

// Formata para exibição: 00.000.000/0000-00 (só quando 100% numérico; alfanumérico fica cru).
export function formatarCnpj(entrada) {
  const c = limparCnpj(entrada);
  if (c.length !== 14 || !/^\d{14}$/.test(c)) return c;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
