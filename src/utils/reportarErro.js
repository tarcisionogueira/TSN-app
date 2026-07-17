// Reporta erros de runtime do cliente para a saúde do sistema.
//
// Usado tanto pelo RootErrorBoundary (erros de RENDER) quanto pelos handlers
// globais (erros ASSÍNCRONOS: window.onerror / unhandledrejection). O endpoint
// /api/log-erro-cliente persiste em erros_cliente (dedup por fingerprint) e a
// verificação de saúde passa a enxergar QUALQUER erro que atinja o usuário —
// não só o caso de RLS. Economia: dedup por sessão + teto + filtro de ruído,
// tudo fire-and-forget (nunca bloqueia nem quebra o app).

import { supabase } from './supabase.js';

const enviados = new Set(); // dedupe dentro da sessão do navegador
let contador = 0; // teto por sessão (anti-flood + economia)
const TETO = 20;

// Ruído conhecido que não é bug acionável (extensões, cross-origin, abort de navegação).
const RUIDO = [
  'resizeobserver loop',
  'script error.',
  'load failed',
  'networkerror when attempting to fetch',
  'the operation was aborted',
];

function ehRuido(msg = '') {
  const m = String(msg).toLowerCase();
  return !m.trim() || RUIDO.some((r) => m.includes(r));
}

export async function reportarErroCliente({ msg, stack = '', url } = {}) {
  try {
    if (contador >= TETO || ehRuido(msg)) return;
    const href = url || (typeof location !== 'undefined' ? location.href : '');
    const rota = (href.split('#')[1] || (typeof location !== 'undefined' ? location.pathname : '')).split('?')[0];
    // chave de dedup: mensagem + rota, com números/ids neutralizados
    const chave = `${String(msg).slice(0, 120)}|${rota}`.replace(/\d+/g, '#');
    if (enviados.has(chave)) return;
    enviados.add(chave);
    contador++;

    let token;
    try { token = (await supabase.auth.getSession())?.data?.session?.access_token; } catch { /* anônimo */ }

    await fetch('/api/log-erro-cliente', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        msg: String(msg || '').slice(0, 300),
        stack: String(stack || '').slice(0, 4000),
        url: String(href).slice(0, 300),
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* nunca quebra o app por causa do log de erro */ }
}

// Registra os handlers globais UMA vez (erros assíncronos que o ErrorBoundary não pega).
export function instalarCapturaErros() {
  if (typeof window === 'undefined' || window.__capturaErrosOn) return;
  window.__capturaErrosOn = true;
  window.addEventListener('error', (e) => {
    // Erros de recurso (img/script 404) não têm message — ignora.
    if (e?.message) reportarErroCliente({ msg: e.message, stack: e.error?.stack, url: location.href });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    reportarErroCliente({ msg: r?.message || String(r), stack: r?.stack, url: location.href });
  });
}
