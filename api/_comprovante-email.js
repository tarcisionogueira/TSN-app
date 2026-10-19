/**
 * Comprovante de posse de e-mail (19/10, pendência 251).
 *
 * api/codigo-email.js emite depois que a pessoa digita o código de 6 dígitos; as rotas que criam conta
 * JÁ CONFIRMADA (criar-conta-checkout, assinar-com-cadastro, promo-capturar, sdr-capturar) só aceitam
 * o e-mail que vier com um comprovante válido. Stateless (HMAC) e válido por 30 min, para que uma
 * nova tentativa depois de cartão recusado não peça outro código.
 */
import crypto from 'node:crypto';

const VALIDADE_MS = 30 * 60 * 1000;
const segredo = () => process.env.EMAIL_CODIGO_SECRET || process.env.SUPABASE_SERVICE_KEY || '';
const assinar = (txt) => crypto.createHmac('sha256', segredo()).update(txt).digest('base64url');

export function emitirComprovante(email) {
  const exp = Date.now() + VALIDADE_MS;
  const corpo = Buffer.from(`${String(email).trim().toLowerCase()}|${exp}`).toString('base64url');
  return `${corpo}.${assinar(corpo)}`;
}

export function comprovanteValido(comprovante, email) {
  if (!segredo() || typeof comprovante !== 'string' || !comprovante.includes('.')) return false;
  const [corpo, sig] = comprovante.split('.');
  const esperado = assinar(corpo);
  if (!sig || sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return false;
  const [em, exp] = Buffer.from(corpo, 'base64url').toString().split('|');
  return em === String(email).trim().toLowerCase() && Number(exp) > Date.now();
}

export const hashCodigo = (email, codigo) =>
  crypto.createHmac('sha256', segredo()).update(`${String(email).trim().toLowerCase()}|${codigo}`).digest('hex');

// Resposta padrão das rotas quando falta o comprovante: o front abre o modal do código.
export const ERRO_SEM_COMPROVANTE = { error: 'Confirme o seu e-mail com o código que enviamos para continuar.', codigo_necessario: true };
