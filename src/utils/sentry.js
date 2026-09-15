// Sentry (client-side) — DORMENTE até VITE_SENTRY_DSN existir. Complementa
// `reportarErroCliente` (que já persiste em `erros_cliente`): mesmo evento, mas com stack
// trace completo, breadcrumbs e agrupamento automático — o que a tabela não dá.
//
// Não reimplementa filtro de ruído/dedup/gate de produção: `capturarNoSentry` é chamada de
// DENTRO de `reportarErroCliente`, depois que ela já filtrou extensão/terceiro/preview — um
// evento só chega aqui se já foi considerado real o bastante para a fila de investigação.
import * as Sentry from '@sentry/react';

const DSN = (import.meta.env.VITE_SENTRY_DSN || '').trim();

export function initSentry() {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.PROD ? 'production' : 'development',
    // Sem tracing de performance por ora — o objetivo aqui é captura de erro, não APM;
    // manter a cota do plano gratuito (5k erros/mês) só para o que já era investigado.
    tracesSampleRate: 0,
  });
}

export function capturarNoSentry({ msg, stack, url } = {}) {
  if (!DSN) return;
  try {
    const erro = new Error(String(msg || 'erro sem mensagem'));
    if (stack) erro.stack = stack;
    Sentry.captureException(erro, { extra: { url } });
  } catch { /* nunca deixar o Sentry derrubar o app */ }
}
