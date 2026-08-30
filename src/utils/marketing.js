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

// ── PIXEL DO OPENAI ADS (ChatGPT Ads) ────────────────────────────────────────
// O canal abriu no Brasil em 11/08/2026 e cobra por CPM, CPC e oCPC — e é o oCPC que muda o
// jogo: sem conversão declarada, o leilão só sabe otimizar por CLIQUE, que é comprar curioso.
// Mesmo padrão do Meta: DORMENTE até existir `VITE_OPENAI_PIXEL_ID`. Setar a env e
// redeployar liga o pixel sem tocar no código.
//
// ⚠️ O STUB É O DO FORNECEDOR, e a diferença não é estética (28/08). A primeira versão daqui
// evitava o stub por não querer adivinhar o formato da fila: carregava o script e só depois
// chamava `oaiq(...)`. O snippet oficial, lido na tela do Ads Manager, mostra o contrato —
// `!function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];w.oaiq=q…`
// — e ele diz que **o SDK DRENA uma fila que o site precisa ter criado**. Sem o stub, quem
// define `window.oaiq` é ninguém: as chamadas cairiam num `undefined` engolido pelo try/catch,
// que é o no-op silencioso que este arquivo existe para não ter. Agora usamos o stub verbatim.
const OPENAI_PIXEL_ID = String(import.meta.env.VITE_OPENAI_PIXEL_ID || '').trim();
const SDK_OPENAI = 'https://bzrcdn.openai.com/sdk/oaiq.min.js';
let oaiPronto = false;

export function initOpenAIPixel() {
  if (!OPENAI_PIXEL_ID || oaiPronto || typeof window === 'undefined') return;
  /* eslint-disable */
  !function (w, d, s, u) {
    if (w.oaiq) return;
    var q = function () { q.q.push(arguments); }; q.q = []; w.oaiq = q;
    var t = d.createElement(s); t.async = 1; t.src = u;
    var f = d.getElementsByTagName(s)[0]; f.parentNode.insertBefore(t, f);
  }(window, document, 'script', SDK_OPENAI);
  /* eslint-enable */
  window.oaiq('init', { pixelId: OPENAI_PIXEL_ID });
  // `page_viewed` é EXPLÍCITO: este pixel não rastreia página sozinho (dito na documentação).
  window.oaiq('measure', 'page_viewed', { type: 'customer_action' });
  oaiPronto = true;
}

/**
 * Conversão no OpenAI Ads. Eventos padrão: page_viewed, contents_viewed, items_added,
 * checkout_started, order_created, lead_created, registration_completed,
 * appointment_scheduled, subscription_created, trial_started.
 * ⚠️ VALOR EM UNIDADE MENOR E INTEIRA (ISO 4217): R$ 25,99 → 2599. Passar 25.99 aqui seria
 * declarar 26 centavos, e o leilão otimizaria por uma receita 100× menor que a real.
 */
export function openaiTrack(evento, props) {
  if (!OPENAI_PIXEL_ID || typeof window === 'undefined') return;
  try {
    // Chamar antes do `init` é seguro: a fila do fornecedor guarda e o SDK drena ao carregar.
    if (!oaiPronto) initOpenAIPixel();
    window.oaiq('measure', evento, { type: 'customer_action', ...(props || {}) });
  } catch { /* marketing nunca derruba a tela */ }
}

/** Reais → centavos inteiros, como o OpenAI Ads exige. `null` quando não há valor. */
export function valorMenor(reais) {
  const v = Number(reais);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) : null;
}

// ── ATRIBUIÇÃO (gclid/fbclid/utm) ─────────────────────────────────────────────
// Captura os parâmetros de anúncio da URL (antes ou depois do # do HashRouter) e persiste por 90
// dias (janela de atribuição). Consumido no cadastro/login (AuthContext → registrar_marketing).
const KEY = 'tsn_mkt';
const JANELA_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * A ROTA do hash, sem a query — e a diferença entre "sem a query" e "sem o hash" custou caro.
 *
 * O app é HashRouter: `/#/live/leilao-ao-vivo` é uma ROTA, não um fragmento decorativo. E o
 * redirecionamento de `/aula/<slug>` (api/og-share.js) ACRESCENTA as utm DEPOIS do "#", então
 * a URL que o visitante de campanha carrega é `/#/live/<slug>?utm_source=meta&...`.
 *
 * A primeira versão desta trava (30/08, manhã) descartava o hash INTEIRO quando ele continha
 * "=", para não gravar token de sessão num campo de marketing. Ela cumpria isso e, de quebra,
 * apagava exatamente a rota de quem vinha de anúncio — porque anúncio é justamente quem chega
 * com query. O resultado foi um `landing` igual a "/" para o tráfego pago, e eu li isso como
 * "a campanha manda todo mundo para a home". Não mandava: o instrumento é que não enxergava.
 * Diagnóstico errado a partir de número plausível é a forma #10 do CLAUDE.md.
 *
 * Agora corta a query e mantém a rota. O token do Supabase continua fora porque ele não vem
 * como rota: chega em `#access_token=…`, sem a barra, e a checagem de formato o rejeita.
 */
export function rotaDoHash(hash) {
  const bruto = String(hash || '');
  if (!bruto.startsWith('#/')) return '';        // `#access_token=…` morre aqui
  // `slice(1)` antes do split, porque o "#" inicial TAMBÉM é separador: sem isso o split
  // devolve string vazia no índice 0 e a função zera toda rota — pego rodando em seco.
  const rota = '#' + bruto.slice(1).split(/[?&#]/)[0];   // corta query e fragmento extra
  return /^#\/[A-Za-z0-9/_-]*$/.test(rota) ? rota : '';
}

export function capturarMarketing() {
  try {
    const qs = new URLSearchParams(window.location.search);
    const h = window.location.hash || ''; const iq = h.indexOf('?');
    const hq = iq >= 0 ? new URLSearchParams(h.slice(iq)) : new URLSearchParams();
    const get = (k) => (qs.get(k) || hq.get(k) || '').slice(0, 300);
    // `utm_content` e `utm_term` entraram em 27/08, e a falta deles era um buraco de MEDIÇÃO,
    // não de captura: `visita_origem` guardava os dois desde sempre (o tracker os lê), mas
    // aqui eles nunca eram capturados — então o CADASTRO só sabia a campanha, nunca a PEÇA.
    // Na prática: dava para ver que 140 visitas vieram da campanha do Instagram, e não dava
    // para dizer se o cadastro veio do reels ou do link da bio. Sem isso não há como comparar
    // criativo com criativo, que é a decisão que gasta verba.
    const dados = {
      // `oppref` é o identificador de clique do OpenAI Ads (o gclid deles). O próprio pixel o
      // guarda no cookie `__oppref`; capturamos aqui pelo MESMO motivo do gclid — para o
      // NOSSO banco saber a origem mesmo quando o pixel está bloqueado ou dormente.
      // `gbraid`/`wbraid` (30/08): o Google manda ESTES no lugar do `gclid` quando o clique
      // vem sem cookie de terceiro (iOS/ATT, app→web, consentimento negado). O tracker já os
      // gravava em `visita_origem` — 463 visitas em 30 dias, contra 968 com gclid, ou seja
      // quase 1/3 dos cliques pagos. Este objeto, que é o que alimenta a ATRIBUIÇÃO DO
      // CADASTRO, nunca os capturou: todo clique de iPhone chegava ao perfil sem origem.
      // É o mesmo defeito do `fbclid` corrigido em 28/08, na outra metade do sistema.
      gclid: get('gclid'), gbraid: get('gbraid'), wbraid: get('wbraid'),
      fbclid: get('fbclid'), oppref: get('oppref'),
      utm_source: get('utm_source'), utm_medium: get('utm_medium'), utm_campaign: get('utm_campaign'),
      utm_content: get('utm_content'), utm_term: get('utm_term'),
    };

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
    // ⚠️ O HASH PODE CARREGAR O TOKEN DE AUTENTICAÇÃO (30/08). O redirect de confirmação de
    // e-mail do Supabase volta como `/#access_token=eyJhbGciOi...` — e este campo gravava o JWT
    // (truncado em 200 chars) dentro de `perfis.mkt_landing`. Dois estragos: fragmento de
    // CREDENCIAL num campo de marketing, e 7 dos 53 cadastros de 30 dias com uma "landing"
    // única e ilegível que na verdade era `/` — a análise de por onde a pessoa entrou ficava
    // com 7 categorias de um só elemento.
    // O hash SÓ é preservado quando é rota do app (`#/algo`); qualquer hash com `=` (formato
    // de par chave-valor, que é como token e código de OAuth chegam) é descartado.
    const landing = String(window.location.pathname + rotaDoHash(window.location.hash)).slice(0, 200);

    // A PRECEDÊNCIA IMPORTA, e errar aqui custa a medição da campanha paga:
    //   • Chegou com anúncio → SOBRESCREVE sempre. É a atribuição que o Google Ads precisa
    //     para contar a conversão. Quem visitou organicamente ontem e clicou no anúncio hoje
    //     tem que ficar registrado como vindo do anúncio.
    //   • Chegou sem anúncio → só preenche o VAZIO. Nunca apaga uma atribuição paga já
    //     guardada; senão uma visita orgânica posterior derrubaria o gclid e a campanha
    //     apareceria sem converter.
    const temAnuncio = Object.values(dados).some(Boolean);
    // SEM BURACO NEGRO (20/08): antes, quando NÃO havia anúncio E o referrer vinha vazio
    // (navegação interna, digitação direta, ou in-app browser que zera o document.referrer —
    // o caso do Instagram), NADA era gravado → lerMarketing() nulo no cadastro → o perfil caía
    // em "(nada capturado)". Eram 18 dos 40 cadastros de 30 dias. Agora o first-touch SEMPRE
    // grava algo: 'direto' na falta de referrer externo. Assim todo cadastro tem origem, e a
    // bio do Instagram com ?utm_source=instagram entra como 'instagram' (é anúncio → sobrescreve).
    const ref2 = referrer || 'direto';
    const registro = JSON.stringify({ ...dados, referrer: ref2, landing, ts: Date.now() });
    if (temAnuncio) localStorage.setItem(KEY, registro);          // veio de anúncio/utm → sobrescreve sempre
    else if (!localStorage.getItem(KEY)) localStorage.setItem(KEY, registro); // first-touch: grava mesmo sem referrer
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
