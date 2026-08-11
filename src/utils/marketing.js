// Marketing / aquisição — Meta Pixel (client-side) + captura de atribuição (gclid/fbclid/utm).
// O Google (GA4 + Ads) já é carregado no index.html. Aqui adicionamos o Meta e a ATRIBUIÇÃO:
// guardamos de qual anúncio/campanha o visitante veio, para casar acesso → cadastro → contratação.
//
// O Meta Pixel é DORMENTE até existir a env VITE_META_PIXEL_ID (mesmo padrão do WhatsApp): setar a
// env e redeployar liga o pixel sem mexer no código. Assim nada quebra enquanto o ID não existe.
const META_ID = String(import.meta.env.VITE_META_PIXEL_ID || '').trim();
let pixelPronto = false;

export function initMetaPixel() {
  if (!META_ID || pixelPronto || typeof window === 'undefined' || window.fbq) return;
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('init', META_ID);
  window.fbq('track', 'PageView');
  pixelPronto = true;
}

// Dispara um evento no Meta Pixel (no-op se o pixel não estiver ligado). O 3º argumento
// eventID permite DEDUPLICAR contra o mesmo evento enviado pelo servidor (Conversions API):
// quando navegador e servidor mandam o MESMO eventID, o Meta conta UMA conversão só.
export function metaTrack(evento, params, eventID) {
  try {
    if (typeof window === 'undefined' || !window.fbq) return;
    if (eventID) window.fbq('track', evento, params || {}, { eventID });
    else window.fbq('track', evento, params || {});
  } catch { /* ignore */ }
}

// ── ATRIBUIÇÃO (gclid/fbclid/utm) ─────────────────────────────────────────────
// Captura os parâmetros de anúncio da URL (antes ou depois do # do HashRouter) e persiste por 90
// dias (janela de atribuição). Consumido no cadastro/login (AuthContext → registrar_marketing).
const KEY = 'tsn_mkt';
const JANELA_MS = 90 * 24 * 60 * 60 * 1000;

export function capturarMarketing() {
  try {
    const qs = new URLSearchParams(window.location.search);
    const h = window.location.hash || ''; const iq = h.indexOf('?');
    const hq = iq >= 0 ? new URLSearchParams(h.slice(iq)) : new URLSearchParams();
    const get = (k) => (qs.get(k) || hq.get(k) || '').slice(0, 300);
    const dados = { gclid: get('gclid'), fbclid: get('fbclid'), utm_source: get('utm_source'), utm_medium: get('utm_medium'), utm_campaign: get('utm_campaign') };

    // REFERRER E PÁGINA DE ENTRADA (11/08). Até aqui só gravávamos quem chegava com
    // gclid/fbclid/utm — ou seja, só quem veio de anúncio. Quem chega do Instagram, de um
    // grupo de WhatsApp, da busca orgânica ou digitando o endereço não deixava rastro
    // nenhum, e no painel isso aparecia como "indicado pelo dono" (o upline padrão),
    // que é uma resposta errada com cara de certa. Dos 17 cadastros dos últimos 14 dias,
    // 10 estavam assim.
    //
    // Guardamos só o HOST de origem, nunca a URL inteira: o caminho de onde a pessoa veio
    // pode carregar dado de terceiro (um grupo, um perfil, uma busca) e não acrescenta nada
    // à pergunta que queremos responder, que é "de que canal veio".
    let referrer = 'direto';
    try {
      const r = document.referrer || '';
      if (r) {
        const h = new URL(r).hostname.replace(/^www\./, '');
        // Navegação interna não é origem — só marcaria "veio da própria BidPro".
        if (h && h !== window.location.hostname.replace(/^www\./, '')) referrer = h.slice(0, 120);
        else referrer = '';
      }
    } catch { referrer = ''; }
    const landing = String(window.location.pathname + (window.location.hash || '')).slice(0, 200);

    // A PRECEDÊNCIA IMPORTA, e errar aqui custa a medição da campanha paga:
    //   • Chegou com anúncio → SOBRESCREVE sempre. É a atribuição que o Google Ads precisa
    //     para contar a conversão. Quem visitou organicamente ontem e clicou no anúncio hoje
    //     tem que ficar registrado como vindo do anúncio.
    //   • Chegou sem anúncio → só preenche o VAZIO. Nunca apaga uma atribuição paga já
    //     guardada; senão uma visita orgânica posterior derrubaria o gclid e a campanha
    //     apareceria sem converter.
    const temAnuncio = Object.values(dados).some(Boolean);
    const registro = JSON.stringify({ ...dados, referrer, landing, ts: Date.now() });
    if (temAnuncio) localStorage.setItem(KEY, registro);
    else if (referrer && !localStorage.getItem(KEY)) localStorage.setItem(KEY, registro);
  } catch { /* ignore */ }
}

export function lerMarketing() {
  try {
    const raw = localStorage.getItem(KEY); if (!raw) return null;
    const o = JSON.parse(raw);
    if (o?.ts && Date.now() - Number(o.ts) > JANELA_MS) { localStorage.removeItem(KEY); return null; }
    return o || null;
  } catch { return null; }
}
