import { metaTrack } from './marketing';

const GA4_ID = 'G-5YNHQB5F81';
const AW_ID = 'AW-16850175262';
const CONV_PLANO = `${AW_ID}/7658576769`;
const CONV_CADASTRO = `${AW_ID}/7658576772`;

function gtag(...args) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

// Cada conversão é enviada em PARALELO ao Google (GA4 + Ads) e ao Meta Pixel (se ligado por
// VITE_META_PIXEL_ID). Assim os dois lados otimizam pelos MESMOS eventos, sem código duplicado.
export function trackPageView(path) {
  gtag('event', 'page_view', { page_path: path, send_to: GA4_ID });
  gtag('event', 'page_view', { page_path: path, send_to: AW_ID });
  metaTrack('PageView');
}

export function trackCadastro(email) {
  gtag('event', 'sign_up', { method: 'email', send_to: AW_ID });
  gtag('event', 'conversion', { send_to: CONV_CADASTRO });
  metaTrack('CompleteRegistration');
}

export function trackCheckoutIniciado(plano, valor) {
  gtag('event', 'begin_checkout', { currency: 'BRL', value: valor, items: [{ item_name: plano }], send_to: AW_ID });
  metaTrack('InitiateCheckout', { currency: 'BRL', value: valor, content_name: plano });
}

export function trackPlanContratado(plano, valor) {
  gtag('event', 'purchase', { currency: 'BRL', value: valor, transaction_id: Date.now(), items: [{ item_name: plano }], send_to: AW_ID });
  gtag('event', 'conversion', { send_to: CONV_PLANO, value: valor, currency: 'BRL' });
  metaTrack('Purchase', { currency: 'BRL', value: valor, content_name: plano });
}

export function trackAlertaCriado() {
  gtag('event', 'generate_lead', { send_to: AW_ID });
  metaTrack('Lead');
}

export function trackImovelVisualizado(imovelId, tipo, valor) {
  gtag('event', 'view_item', { currency: 'BRL', value: valor, items: [{ item_id: imovelId, item_category: tipo }], send_to: AW_ID });
  metaTrack('ViewContent', { currency: 'BRL', value: valor, content_ids: [imovelId], content_type: tipo });
}

export function trackBuscaRealizada(filtros) {
  gtag('event', 'search', { search_term: JSON.stringify(filtros), send_to: AW_ID });
  metaTrack('Search');
}
