/**
 * _sentry.js — Sentry (server-side), DORMENTE até SENTRY_DSN existir.
 *
 * Plugado em `_error-alert.js`: todo `alertarErro()` (webhook de pagamento, crons de
 * contrato/preço/garantia) já manda e-mail pro dono — aqui manda o MESMO evento pro Sentry
 * também, com stack trace completo em vez de só a mensagem que cabe no corpo do e-mail.
 *
 * Cobertura: só os 9 arquivos que já chamam `alertarErro()` hoje (o núcleo de pagamento e
 * alguns crons). Os demais ~180 endpoints seguem só com o log próprio (`erros_cliente`,
 * console.error) — ampliar a cobertura é um passo à parte, não este.
 */
import * as Sentry from '@sentry/node';

const DSN = (process.env.SENTRY_DSN || '').trim();
let iniciado = false;

function garantirInit() {
  if (iniciado || !DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: process.env.VERCEL_ENV || 'development',
    tracesSampleRate: 0, // captura de erro, não APM — poupa a cota do plano gratuito
  });
  iniciado = true;
}

export function sentryAtivo() { return !!DSN; }

export function capturarErroServidor(erro, contexto) {
  if (!DSN) return;
  try {
    garantirInit();
    const e = erro instanceof Error ? erro : new Error(String(erro));
    Sentry.captureException(e, contexto ? { extra: contexto } : undefined);
  } catch { /* nunca deixar o Sentry derrubar a rota */ }
}
