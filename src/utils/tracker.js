// Rastreamento de atividade do cliente (navegação + cliques + falhas de API) para o Cliente 360.
// Objetivo: encontrar possíveis falhas (o que o usuário fez antes de um erro). Vale para
// clientes, parceiros e equipe. Economia: teto por sessão, batch, e só usuários logados.
import { supabase } from './supabase.js';

let fila = [];
let contador = 0;          // teto por sessão (anti-flood + economia)
const TETO = 200;
let timer = null;

// Nunca deixa TOKEN de auth virar "rota": no fluxo implícito do Supabase com HashRouter, a URL
// pós-login (magic link/OAuth/recuperação) vem como #access_token=...&refresh_token=... — isso é
// SEGREDO e não pode ir para o log (o pageview dispara antes do Supabase limpar o hash).
const RE_TOKEN_URL = /(access_token|refresh_token|provider_token|provider_refresh_token|id_token|[?&#]token=|[?&]code=)/i;
function rotaAtual() {
  try {
    if (RE_TOKEN_URL.test(location.hash) || RE_TOKEN_URL.test(location.search)) return '/(auth-redirect)';
    return ((location.hash.split('?')[0].replace(/^#/, '')) || location.pathname || '').slice(0, 200);
  } catch { return ''; }
}
function rotuloDe(el) {
  try {
    const t = el.getAttribute?.('aria-label') || el.innerText || el.textContent || el.value || el.getAttribute?.('title') || el.name || el.id || '';
    return String(t).replace(/\s+/g, ' ').trim().slice(0, 80);
  } catch { return ''; }
}

// Registra um evento (usado internamente e por quem quiser logar uma falha específica).
export function registrarEvento(tipo, { alvo = '', detalhe = '' } = {}) {
  if (contador >= TETO) return;
  contador++;
  fila.push({ tipo, rota: rotaAtual(), alvo: String(alvo).slice(0, 120), detalhe: String(detalhe).slice(0, 200) });
  if (fila.length >= 10) flush(); else agendar();
}

function agendar() { if (!timer) timer = setTimeout(flush, 5000); }

async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!fila.length) return;
  const lote = fila.splice(0, 30);
  let token;
  try { token = (await supabase.auth.getSession())?.data?.session?.access_token; } catch { /* sem sessão */ }
  if (!token) return; // só usuários logados
  try {
    await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ eventos: lote }), keepalive: true,
    });
  } catch { /* fire-and-forget */ }
}

export function instalarTracker() {
  if (typeof window === 'undefined' || window.__trackerOn) return;
  window.__trackerOn = true;

  // Pageview no load + em toda navegação SPA (patch de pushState/replaceState + popstate/hashchange).
  const pv = () => registrarEvento('pageview', { alvo: rotaAtual() });
  pv();
  try {
    const _ps = history.pushState; history.pushState = function (...a) { const r = _ps.apply(this, a); pv(); return r; };
    const _rs = history.replaceState; history.replaceState = function (...a) { const r = _rs.apply(this, a); pv(); return r; };
  } catch { /* history indisponível */ }
  window.addEventListener('popstate', pv);
  window.addEventListener('hashchange', pv);

  // Cliques em elementos interativos (captura o mais próximo botão/link/label).
  window.addEventListener('click', (e) => {
    try {
      const el = e.target?.closest?.('button, a, [role="button"], input[type="submit"], input[type="button"], label, [data-track]');
      if (!el) return;
      registrarEvento('click', { alvo: rotuloDe(el) || el.tagName?.toLowerCase() || 'elemento' });
    } catch { /* ignora */ }
  }, { capture: true });

  // Envia o que estiver na fila ao sair / trocar de aba.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}
