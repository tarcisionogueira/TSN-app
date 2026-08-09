import { metaTrack } from './marketing';

const GA4_ID = 'G-5YNHQB5F81';
const AW_ID = 'AW-16850175262';
// Rótulos REAIS das ações de conversão criadas na conta Google Ads 475-979-5747
// (Metas → Conversões): "Compra de plano — BidPro" e "Cadastro — BidPro".
// Os rótulos numéricos antigos (7658576769/7658576772) eram de ações que não existem
// mais — as conversões disparavam sem serem contabilizadas.
const CONV_PLANO = `${AW_ID}/08veCOz06dgcEJ6K5eI-`;
const CONV_CADASTRO = `${AW_ID}/uwEKCO_06dgcEJ6K5eI-`;

// ⚠️ NÃO troque por `dataLayer.push([...])`. Esta função já foi assim e o efeito foi mudo:
// TODA conversão do app era descartada em silêncio (08/08).
//
// O gtag.js do Google varre a `dataLayer` e só reconhece como COMANDO os itens que são
// objetos `arguments` — exatamente o que o snippet oficial do index.html produz
// (`function gtag(){dataLayer.push(arguments);}`). Um Array comum, que é o que o rest
// parameter (`...args`) cria, é lido como evento no estilo GTM e o comando é ignorado.
// Nada quebra, nada aparece no console: o evento simplesmente não existe para o Google.
//
// Sintoma no painel: as ações "Cadastro — BidPro" e "Compra de plano" ficaram com status
// INATIVO e 0 conversões, enquanto o banco mostrava 5 cadastros vindos de clique pago com
// `gclid` gravado. As conversões aconteciam; o recado é que não chegava.
//
// Correção: usar o `window.gtag` do index.html, que é o oficial. O push de `arguments`
// fica só como reserva para o caso de o snippet não ter carregado.
function gtag() {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag === 'function') { window.gtag.apply(null, arguments); return; }
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(arguments); // `arguments`, nunca um Array
}

// Cada conversão é enviada em PARALELO ao Google (GA4 + Ads) e ao Meta Pixel (se ligado por
// VITE_META_PIXEL_ID). Assim os dois lados otimizam pelos MESMOS eventos, sem código duplicado.
export function trackPageView(path) {
  gtag('event', 'page_view', { page_path: path, send_to: GA4_ID });
  gtag('event', 'page_view', { page_path: path, send_to: AW_ID });
  metaTrack('PageView');
}

// ── Enhanced Conversions (Google Ads) ─────────────────────────────────────────
// Fornece dados primários (e-mail/telefone/nome/endereço) ao gtag para o Google
// CASAR a conversão com a conta do usuário — melhora a medição igual o CAPI fez no
// Meta, mas client-side (o gtag HASHEIA no navegador antes de enviar). Só tem efeito
// se "Conversões otimizadas" (método Tag do Google) estiver LIGADO na conta Google Ads;
// sem isso é ignorado — seguro deixar sempre. Chamado junto das conversões (cadastro/compra).
function setUserDataGoogle(ud) {
  if (!ud || !ud.email) return;
  const dados = { email: String(ud.email).trim().toLowerCase() };
  if (ud.phone) dados.phone_number = String(ud.phone).replace(/[^\d+]/g, '');
  const nome = String(ud.nome || '').trim();
  if (nome) {
    const partes = nome.split(/\s+/);
    dados.address = {
      first_name: partes[0] || '',
      last_name: partes.slice(1).join(' ') || '',
      country: 'BR',
    };
    if (ud.cidade) dados.address.city = String(ud.cidade).trim();
    if (ud.uf) dados.address.region = String(ud.uf).trim();
    if (ud.cep) dados.address.postal_code = String(ud.cep).replace(/\D/g, '');
  }
  gtag('set', 'user_data', dados);
}

export function trackCadastro(email, nome) {
  setUserDataGoogle({ email, nome });
  gtag('event', 'sign_up', { method: 'email', send_to: AW_ID });
  gtag('event', 'conversion', { send_to: CONV_CADASTRO });
  metaTrack('CompleteRegistration');
}

export function trackCheckoutIniciado(plano, valor) {
  gtag('event', 'begin_checkout', { currency: 'BRL', value: valor, items: [{ item_name: plano }], send_to: AW_ID });
  metaTrack('InitiateCheckout', { currency: 'BRL', value: valor, content_name: plano });
}

// eventID (opcional): id determinístico compartilhado com o servidor (Meta CAPI) para
// DEDUPLICAR a conversão — mesmo id no navegador e no webhook = 1 Purchase, não 2.
// userData (opcional): e-mail/nome/endereço p/ Enhanced Conversions do Google Ads.
export function trackPlanContratado(plano, valor, eventID, userData) {
  setUserDataGoogle(userData);
  gtag('event', 'purchase', { currency: 'BRL', value: valor, transaction_id: eventID || Date.now(), items: [{ item_name: plano }], send_to: AW_ID });
  // transaction_id: dedup no Google Ads (mesmo id → não conta a conversão duas vezes).
  gtag('event', 'conversion', { send_to: CONV_PLANO, value: valor, currency: 'BRL', transaction_id: eventID || '' });
  metaTrack('Purchase', { currency: 'BRL', value: valor, content_name: plano }, eventID);
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
