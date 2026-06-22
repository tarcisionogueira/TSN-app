const AW_ID = 'AW-16850175262';

function gtag(...args) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}

export function trackPageView(path) {
  gtag('event', 'page_view', { page_path: path, send_to: AW_ID });
}

export function trackCadastro(email) {
  gtag('event', 'sign_up', { method: 'email', send_to: AW_ID });
  gtag('event', 'conversion', { send_to: `${AW_ID}/cadastro`, email });
}

export function trackCheckoutIniciado(plano, valor) {
  gtag('event', 'begin_checkout', { currency: 'BRL', value: valor, items: [{ item_name: plano }], send_to: AW_ID });
}

export function trackPlanContratado(plano, valor) {
  gtag('event', 'purchase', { currency: 'BRL', value: valor, transaction_id: Date.now(), items: [{ item_name: plano }], send_to: AW_ID });
  gtag('event', 'conversion', { send_to: `${AW_ID}/plano_contratado`, value: valor, currency: 'BRL' });
}

export function trackAlertaCriado() {
  gtag('event', 'generate_lead', { send_to: AW_ID });
}

export function trackImovelVisualizado(imovelId, tipo, valor) {
  gtag('event', 'view_item', { currency: 'BRL', value: valor, items: [{ item_id: imovelId, item_category: tipo }], send_to: AW_ID });
}

export function trackBuscaRealizada(filtros) {
  gtag('event', 'search', { search_term: JSON.stringify(filtros), send_to: AW_ID });
}
