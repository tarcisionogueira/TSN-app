/**
 * Endereço da PESTANA pela OBSERVAÇÃO do bem (08/10, #88).
 *
 * A Pestana escreve a observação num formato fixo:
 *   "Gramado/RS. Bairro Várzea a Grande (in loco). Rodovia RS 115, sn (in loco). Terreno com …"
 *   "Porto Alegre/RS. Centro Histórico (in loco). Rua Demétrio Ribeiro, 990. Sala 302. …"
 * O extrator genérico (extrairEnderecoMatricula) procura "situado à …" e não casa nesse formato:
 * 81% dos lotes ativos ficavam sem endereço, com o logradouro escrito na descrição.
 *
 * Devolve { logradouro, bairro } ou null. Só aceita a frase que COMEÇA por tipo de via e tem
 * número ou "sn" logo depois da vírgula — o resto da observação (ônus, regularização) nunca casa.
 */
const VIA = '(?:Rua|R\\.|Avenida|Av\\.|Rodovia|Rod\\.|Estrada|Travessa|Alameda|Praça|Acesso|Via|Largo|Servidão|Linha|Ladeira|Beco)';
const RE_LOGRADOURO = new RegExp(`(?:^|\\.\\s+)(${VIA}\\s[^.]{1,80}?,\\s*(?:s\\/?n|\\d+[A-Za-z]?(?:\\s*-\\s*[A-Za-z0-9]+)?)\\b(?:\\s*\\((?!in loco)[^)]{1,40}\\))?)`, 'i');
const RE_CIDADE_UF = /^\s*[^./]{2,50}\s*\/\s*[A-Z]{2}\.\s*/;

export function enderecoObsPestana(obs) {
  const t = String(obs || '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const m = t.match(RE_LOGRADOURO);
  if (!m) return null;
  const logradouro = m[1].replace(/\s*\(in loco\)/gi, '').replace(/,\s*sn\b/i, ', s/n').trim().slice(0, 150);
  // Bairro = a frase entre "Cidade/UF." e a do logradouro, quando ela existe e não é o próprio logradouro.
  let bairro = '';
  const semCidade = t.replace(RE_CIDADE_UF, '');
  const antes = semCidade.slice(0, Math.max(0, semCidade.indexOf(m[1]))).replace(/\.\s*$/, '').trim();
  if (antes && !antes.includes('.') && antes.length <= 80) {
    bairro = antes.replace(/\s*\(in loco\)/gi, '').replace(/^Bairro\s+/i, '').trim();
  }
  return { logradouro, bairro };
}
