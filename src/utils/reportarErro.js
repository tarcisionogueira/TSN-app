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

// Recarrega UMA vez quando um CHUNK de JS falha ao carregar. Após um deploy, o index.html
// em cache do usuário aponta para chunks com hash antigo que não existem mais → "Importing a
// module script failed" e o app fica quebrado até um refresh manual. Aqui recarregamos sozinho
// (pega o index.html novo). Guarda anti-loop: só recarrega se não recarregou nos últimos 10s
// (senão um erro de chunk persistente entraria em loop de reload).
export function ehErroDeChunk(msg = '') {
  const m = String(msg).toLowerCase();
  return m.includes('importing a module script failed')
    || m.includes('failed to fetch dynamically imported module')
    || m.includes('error loading dynamically imported module')
    || m.includes('module script failed')
    || m.includes("'text/html' is not a valid javascript mime type"); // chunk 404 devolveu HTML
}
// Recarrega UMA vez, com guarda anti-loop de 10s. Extraído para o ErrorBoundary poder
// forçar o reload nos ERROS DERIVADOS de um chunk velho (ver houveChunkRecente).
export function recarregarComGuarda() {
  try {
    const agora = Date.now();
    const ultimo = Number(sessionStorage.getItem('__chunk_reload_at') || 0);
    if (agora - ultimo < 10000) return false; // já recarregou há pouco — evita loop
    sessionStorage.setItem('__chunk_reload_at', String(agora));
  } catch { /* sessionStorage indisponível: 1 reload ainda é aceitável */ }
  location.reload();
  return true;
}
export function recarregarPorChunkStale(msg = '') {
  if (!ehErroDeChunk(msg)) return false;
  marcarChunkErro();
  return recarregarComGuarda();
}
// Quando um chunk velho falha, o React.lazy recebe um módulo UNDEFINED e os erros que
// vêm LOGO DEPOIS são derivados ("Cannot read properties of undefined (reading 'default')",
// "Cannot destructure property ... of undefined"). Marcamos o instante do erro de chunk;
// o ErrorBoundary trata qualquer erro dentro de ~10s como "chunk velho" (tela neutra +
// reload), em vez de "Algo deu errado" + log — assim não polui a saúde nem assusta o usuário.
export function marcarChunkErro() {
  try { sessionStorage.setItem('__chunk_erro_at', String(Date.now())); } catch { /* ignore */ }
}
export function houveChunkRecente() {
  try { return Date.now() - Number(sessionStorage.getItem('__chunk_erro_at') || 0) < 10000; } catch { return false; }
}

// Registra os handlers globais UMA vez (erros assíncronos que o ErrorBoundary não pega).
export function instalarCapturaErros() {
  if (typeof window === 'undefined' || window.__capturaErrosOn) return;
  window.__capturaErrosOn = true;
  // Evento nativo do Vite p/ falha de preload de chunk — o caminho mais confiável.
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault(); // não deixa virar erro não tratado
    marcarChunkErro(); // marca a janela p/ o boundary tratar os erros derivados como chunk
    // Chunk velho pós-deploy é AUTO-RECUPERÁVEL (recarrega e resolve) → NÃO logamos (não é bug
    // acionável e enchia a saúde de "erro" a cada deploy). Só logamos se a recarga foi BLOQUEADA
    // pelo anti-loop (recarregou há < 10s e ainda falha) = chunk genuinamente preso, aí sim avisa.
    if (!recarregarPorChunkStale('failed to fetch dynamically imported module')) {
      reportarErroCliente({ msg: 'vite:preloadError PRESO (recarga bloqueada pelo anti-loop)', url: location.href });
    }
  });
  window.addEventListener('error', (e) => {
    // Erros de recurso (img/script 404) não têm message — ignora.
    if (!e?.message) return;
    // Chunk velho → recarrega e não loga (só loga se preso). Demais erros → loga normal.
    if (ehErroDeChunk(e.message) || houveChunkRecente()) {
      marcarChunkErro();
      if (!recarregarComGuarda()) reportarErroCliente({ msg: e.message, stack: e.error?.stack, url: location.href });
      return;
    }
    reportarErroCliente({ msg: e.message, stack: e.error?.stack, url: location.href });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    const msg = r?.message || String(r);
    if (ehErroDeChunk(msg) || houveChunkRecente()) {
      marcarChunkErro();
      if (!recarregarComGuarda()) reportarErroCliente({ msg, stack: r?.stack, url: location.href });
      return;
    }
    reportarErroCliente({ msg, stack: r?.stack, url: location.href });
  });
}
