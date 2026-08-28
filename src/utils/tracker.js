// Rastreamento de atividade do cliente (navegação + cliques + falhas de API) para o Cliente 360.
// Objetivo: encontrar possíveis falhas (o que o usuário fez antes de um erro). Vale para
// clientes, parceiros e equipe. Economia: teto por sessão, batch, e só usuários logados.
import { supabase } from './supabase.js';

let fila = [];
let contador = 0;          // teto por sessão (anti-flood + economia)
// TETO DE 200 CORTAVA A SESSÃO NO MEIO, EM SILÊNCIO (medido 11/08). O objetivo declarado do
// dono é "registrar tudo o que o usuário fez". Com 200, uma sessão de trabalho de verdade
// parava de ser gravada e o 360 mostrava um dia que simplesmente ACABA no meio da tarde —
// sem nada dizendo que o coletor é que desistiu. Sessões reais medidas: 631, 506, 448, 413
// eventos por dia. O teto sobe para 3.000 e, ao ser atingido, o coletor grava UM evento
// dizendo que parou: silêncio inexplicado é pior que dado faltando com aviso.
const TETO = 3000;
let avisouTeto = false;
let timer = null;
// Último clique (rótulo + hora) — para CORRELACIONAR uma falha que aparece na tela logo depois.
// É o que faltava no caso do Fábio: o clique em "Cadastrar empresa" foi registrado 10×, mas nada
// dizia que CADA um FALHOU (CNPJ recusado no cliente, sem chamar API). Agora o desfecho entra junto.
let ultimoClique = { alvo: '', em: 0 };

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
// `ts` = hora da AÇÃO (o banco antes carimbava a hora da INGESTÃO — deriva de até 5s+).
export function registrarEvento(tipo, { alvo = '', detalhe = '' } = {}) {
  if (contador >= TETO) {
    // Um único aviso, e depois silêncio de verdade — sem isto, quem lê o 360 conclui que a
    // pessoa parou de usar a plataforma quando na verdade fomos nós que paramos de olhar.
    if (!avisouTeto) {
      avisouTeto = true;
      fila.push({ tipo: 'limite_sessao', rota: rotaAtual(), alvo: `teto de ${TETO} eventos atingido`,
        detalhe: 'os eventos seguintes desta sessão NÃO foram registrados', ts: Date.now() });
      flush();
    }
    return;
  }
  contador++;
  fila.push({ tipo, rota: rotaAtual(), alvo: String(alvo).slice(0, 120), detalhe: String(detalhe).slice(0, 200), ts: Date.now() });
  if (fila.length >= 10) flush(); else agendar();
}

function agendar() { if (!timer) timer = setTimeout(flush, 5000); }

// Identidade ANÔNIMA persistente (localStorage): costura a jornada do visitante SEM conta
// (links de venda/páginas públicas) e, quando ele cadastra, liga o antes e o depois — o
// servidor grava anon_id junto do user_id.
function anonId() {
  try {
    let v = localStorage.getItem('bp_aid');
    if (!v) { v = (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`); localStorage.setItem('bp_aid', v); }
    return String(v).slice(0, 48);
  } catch { return null; }
}

// ORIGEM DO CLIQUE (gclid/UTM), capturada na PRIMEIRA visita e guardada no navegador.
// Precisa ser persistida porque o cadastro quase nunca acontece na página de chegada — sem
// isto, a campanha que trouxe a pessoa se perde no primeiro clique interno. O servidor grava
// uma vez só por anon_id (first touch), então reenviar a cada lote é inofensivo.
const LS_ORIGEM = 'bp_orig';
function origemPrimeiroToque() {
  try {
    const salvo = localStorage.getItem(LS_ORIGEM);
    if (salvo) return JSON.parse(salvo);
    const q = new URLSearchParams(window.location.search);
    // O hash-router guarda a query DEPOIS do #, então é preciso olhar os dois lugares.
    const hq = new URLSearchParams((window.location.hash.split('?')[1] || ''));
    const g = (k) => q.get(k) || hq.get(k) || null;
    const o = {
      // `fbclid` (28/08): a coluna existe em `visita_origem` desde sempre e o cliente já o
      // capturava em `marketing.js` (para `perfis.mkt_fbclid`) — mas ESTE objeto, que é o que
      // alimenta a tabela, nunca o incluiu, e `api/track.js` também não o gravava. Resultado
      // medido: 30 dias de Meta Ads pagando cliques e ZERO visita com fbclid registrada.
      // Sem fbclid não há `fbc`, e sem `fbc` o Lead do Conversions API casa com muito menos
      // gente — que é justamente o que o evento existe para fazer.
      gclid: g('gclid'), gbraid: g('gbraid'), wbraid: g('wbraid'), fbclid: g('fbclid'),
      utm_source: g('utm_source'), utm_medium: g('utm_medium'), utm_campaign: g('utm_campaign'),
      utm_term: g('utm_term'), utm_content: g('utm_content'),
      // Referrer do PRÓPRIO domínio não é origem — é navegação interna. Sem este filtro, quem
      // chega por `/leiloes` (página pública, fora do React) e clica para entrar no app grava
      // "bidprobrasil.com.br" como origem, apagando a campanha que trouxe a pessoa. Aconteceu
      // em 2 das 5 primeiras linhas gravadas em 12/08.
      referrer_host: (() => {
        try {
          if (!document.referrer) return null;
          const h = new URL(document.referrer).hostname;
          return h && h !== window.location.hostname ? h : null;
        } catch { return null; }
      })(),
      landing: window.location.pathname || '/',
    };
    if (!Object.entries(o).some(([k, v]) => k !== 'landing' && v)) return null; // nada a atribuir
    localStorage.setItem(LS_ORIGEM, JSON.stringify(o));
    return o;
  } catch { return null; }
}

async function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (!fila.length) return;
  const lote = fila.splice(0, 30);
  let token;
  try { token = (await supabase.auth.getSession())?.data?.session?.access_token; } catch { /* sem sessão */ }
  // SEM sessão o evento AINDA sobe (funil público): antes ficava retido e a jornada de quem
  // clicou num link de venda e nunca logou era invisível no Cliente 360 — "mandei links e
  // ninguém cadastrou" não tinha diagnóstico. O servidor aceita anônimo só em rota pública.
  try {
    await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ eventos: lote, anon_id: anonId(), origem: origemPrimeiroToque() }), keepalive: true,
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
  //
  // O SELETOR SOZINHO PERDIA 54 PONTOS DE CLIQUE (contados em 11/08): esta base usa muito
  // `<div onClick>` — card de imóvel, card de curso, linha de tabela. O React registra esses
  // handlers em JS, então não existe atributo para procurar: pelo seletor, o clique no card
  // inteiro simplesmente não existia. O segundo caminho é a PISTA VISUAL — se o navegador
  // desenha cursor de mão, aquilo é um botão para quem está usando, seja qual for a tag.
  const ehClicavelVisualmente = (el) => {
    try { return window.getComputedStyle(el).cursor === 'pointer'; } catch { return false; }
  };
  window.addEventListener('click', (e) => {
    try {
      let el = e.target?.closest?.('button, a, [role="button"], input[type="submit"], input[type="button"], label, [data-track]');
      if (!el) {
        // Sobe no máximo 4 níveis atrás do elemento clicável mais próximo. O limite evita
        // atribuir o clique a um container gigante só porque ele herdou cursor:pointer.
        let n = e.target, saltos = 0;
        while (n && n !== document.body && saltos < 4) {
          if (n.nodeType === 1 && ehClicavelVisualmente(n)) { el = n; break; }
          n = n.parentElement; saltos++;
        }
      }
      if (!el) return;
      const rot = rotuloDe(el) || el.tagName?.toLowerCase() || 'elemento';
      ultimoClique = { alvo: rot, em: Date.now() };
      registrarEvento('click', { alvo: rot });
    } catch { /* ignora */ }
  }, { capture: true });

  // Submits (inclui ENTER no formulário — que NÃO gera click no botão) e mudanças de
  // controles (select/ordenar/filtrar, escolha de arquivo, slider). Rótulo SEM value:
  // o conteúdo digitado num input pode ser PII/segredo e não deve ir para o log.
  const rotuloControle = (el) => {
    try {
      return String(el.getAttribute?.('aria-label') || el.name || el.id || el.type || el.tagName || '')
        .replace(/\s+/g, ' ').trim().slice(0, 80);
    } catch { return ''; }
  };
  window.addEventListener('submit', (e) => {
    try { registrarEvento('submit', { alvo: rotuloControle(e.target) || 'form' }); } catch { /* ignora */ }
  }, { capture: true });
  window.addEventListener('change', (e) => {
    try {
      const el = e.target;
      if (!el?.matches?.('select, input[type="file"], input[type="range"], input[type="checkbox"], input[type="radio"]')) return;
      const det = el.type === 'file' ? `${el.files?.length || 0} arquivo(s)` : (el.type === 'checkbox' || el.type === 'radio') ? String(!!el.checked) : String(el.value ?? '').slice(0, 40);
      registrarEvento('change', { alvo: rotuloControle(el), detalhe: det });
    } catch { /* ignora */ }
  }, { capture: true });

  // DESFECHO AUTOMÁTICO — "a função do botão performou?" (pedido do dono, 20/08). Muita FALHA é
  // client-side e NÃO chama API (validação, gate, no-op), então nem o `api_erro` nem um throw a
  // pegam: a tela só mostra uma mensagem vermelha ("CNPJ inválido") e o Cliente 360 via SÓ o
  // clique, sem o desfecho — foi o caso do Fábio (10× "Cadastrar empresa", zero registro de que
  // falhou). Aqui um MutationObserver ENXUTO detecta a mensagem de erro que aparece logo após um
  // clique e registra `erro_ui` com o rótulo do clique — assim o 360 mostra clique → falha.
  //
  // Guardas de performance (roda no navegador de todo usuário): o callback só EMPILHA nós (sem ler
  // layout), com teto de fila; a análise cara (texto/cor) roda em lote a cada 600ms; dedup + teto
  // próprio por sessão. `textContent` (barato) no lugar de `innerText` (força reflow).
  const RE_ERRO = /\b(inv[aá]lid|incorret|obrigat[oó]ri|n[aã]o foi poss[ií]vel|falh(?:ou|a|ada)|recusad|expirad|n[aã]o coincid|n[aã]o confere|preencha|no m[ií]nimo|tente novamente|erro)\b/i;
  const CORES_ERRO = new Set(['rgb(220, 38, 38)', 'rgb(185, 28, 28)', 'rgb(239, 68, 68)', 'rgb(153, 27, 27)', 'rgb(220, 38, 38)']);
  const errosVistos = new Set();   // dedup por texto normalizado
  let contErroUi = 0;              // teto próprio (além do TETO global): erro_ui é secundário
  let pend = [];
  let obsTimer = null;
  const processarPend = () => {
    obsTimer = null;
    const lote = pend.splice(0, 40); pend = [];
    if (contErroUi >= 60) return;
    for (const el of lote) {
      try {
        if (!el.isConnected) continue;
        const txt = String(el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!txt || txt.length > 160 || !RE_ERRO.test(txt)) continue;
        let cor = ''; try { cor = getComputedStyle(el).color; } catch { /* ok */ }
        // Confirma erro por COR vermelha OU por palavra inequívoca (evita falso positivo de texto
        // neutro que por acaso contém "erro" numa explicação).
        const ehErro = CORES_ERRO.has(cor) || /\b(inv[aá]lid|recusad|falh|incorret|obrigat)/i.test(txt);
        if (!ehErro) continue;
        const chave = txt.toLowerCase().replace(/\d+/g, '#').slice(0, 90);
        if (errosVistos.has(chave)) continue;
        errosVistos.add(chave);
        contErroUi++;
        const ctx = (Date.now() - ultimoClique.em < 6000) ? ultimoClique.alvo : '';
        registrarEvento('erro_ui', { alvo: ctx || 'tela', detalhe: txt.slice(0, 160) });
      } catch { /* ignora item */ }
    }
  };
  try {
    const obs = new MutationObserver((muts) => {
      if (pend.length > 200) return;   // sob rajada de re-render, não acumula sem limite
      for (const m of muts) {
        if (m.addedNodes && m.addedNodes.length) {
          for (const n of m.addedNodes) if (n.nodeType === 1) pend.push(n);
        } else if (m.type === 'characterData' && m.target?.parentElement) {
          pend.push(m.target.parentElement);
        }
      }
      if (pend.length && !obsTimer) obsTimer = setTimeout(processarPend, 600);
    });
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  } catch { /* MutationObserver indisponível: segue sem o desfecho automático */ }

  // Envia o que estiver na fila ao sair / trocar de aba.
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}
