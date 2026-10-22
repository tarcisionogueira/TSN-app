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
    // UM caminho só (22/10, #201). O SDK, por padrão, liga os PRÓPRIOS ouvintes de window.onerror /
    // unhandledrejection (GlobalHandlers) — e eles mandam tudo, sem o filtro de reportarErroCliente.
    // Com o filtro de entrada do Sentry desligado (13/10), 6 das 9 issues abertas eram "Failed to fetch"
    // do Analytics/PostHog dentro de uma extensão do Chrome (frame_ant.js). Os ouvintes do app
    // (utils/reportarErro.js) já capturam o mesmo erro e chamam capturarNoSentry depois de filtrar.
    integrations: (padrao) => padrao.filter((i) => i.name !== 'GlobalHandlers'),
    // Reforço: frame de extensão nunca é nosso.
    denyUrls: [/^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari(-web)?-extension:\/\//i],
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
