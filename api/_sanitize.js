/**
 * Sanitização de inputs para evitar XSS, prompt injection e dados maliciosos.
 * Usado em APIs que recebem texto livre do usuário.
 */

/**
 * Sanitiza texto livre: limita tamanho, remove caracteres de controle
 * e neutraliza padrões de prompt injection para LLMs.
 */
export function sanitizeText(value, maxLen = 5000) {
  if (value == null) return '';
  return String(value)
    .slice(0, maxLen)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // controles ASCII
    .replace(/<<</g, '«')
    .replace(/>>>/g, '»')
    .replace(/\[INST\]/gi, '')
    .replace(/<\|.*?\|>/g, '')
    .trim();
}

/**
 * Sanitiza nome próprio: só letras, espaços, hífens, apóstrofos.
 */
export function sanitizeName(value, maxLen = 200) {
  if (value == null) return '';
  return String(value)
    .slice(0, maxLen)
    .replace(/[^a-zA-ZÀ-ÿ\s'\-\.]/g, '')
    .trim();
}

/**
 * Sanitiza CPF/CNPJ: só dígitos e formatação padrão.
 */
export function sanitizeCpfCnpj(value) {
  if (value == null) return '';
  return String(value).replace(/[^\d.\-\/]/g, '').slice(0, 18);
}

/**
 * Valida e sanitiza email.
 * @returns {string|null} email limpo ou null se inválido
 */
export function sanitizeEmail(value) {
  if (value == null) return null;
  const clean = String(value).toLowerCase().trim().slice(0, 254);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : null;
}

/**
 * Sanitiza número monetário: retorna float ou null.
 */
export function sanitizeNumber(value, min = 0, max = 1_000_000_000) {
  const n = parseFloat(String(value).replace(',', '.'));
  if (isNaN(n) || n < min || n > max) return null;
  return n;
}
