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

// Erro que aconteceu FORA do nosso código. Caso real (08/08): um "Failed to fetch" em
// /checkout ficou dois dias no topo da fila de investigação como suspeita de falha no
// PAGAMENTO — o stack mostrava que era uma extensão do Chrome do próprio usuário, que
// substitui o `window.fetch`, bloqueando um beacon do Google Tag Manager. Não é nosso bug,
// não temos como corrigir, e ocupava a vaga de um erro que importa.
// Regra conservadora: só descarta quando o stack é INTEIRAMENTE de terceiro — se algum
// quadro é do nosso bundle, o erro pode ser nosso e vai para a fila normalmente.
// 29/08: `iabjs://` entrou na lista pelo mesmo motivo das extensões, mas agora em ESCALA. É o
// script que o navegador embutido do Instagram/Facebook (in-app browser, Android) injeta na
// nossa página para medir a própria performance dele — `navigation_performance_logger_android`.
// Quando a pessoa sai da aba, o objeto Java do webview morre antes do JS e o logger da Meta
// grita "Java object is gone". Não é nosso código, não é nosso bug, e não há o que corrigir.
// Passou a importar porque a campanha paga manda o tráfego POR DENTRO desse navegador: 3 das 5
// linhas abertas em `erros_cliente` no dia 28/08 eram só isso, e a tendência é piorar com a
// verba subindo — ruído que ocupa a vaga de um erro real na fila de investigação.
const TERCEIROS = [
  'chrome-extension://', 'moz-extension://', 'safari-web-extension://',
  'googletagmanager.com', 'google-analytics.com', 'connect.facebook.net', 'clarity.ms',
  'iabjs://',
];
function ehStackDeTerceiro(stack = '') {
  const s = String(stack);
  if (!s.trim()) return false;
  if (!TERCEIROS.some((t) => s.includes(t))) return false;
  const origem = typeof location !== 'undefined' ? location.origin : '';
  return !(origem && s.includes(origem));
}

// ERRO DE PREVIEW NÃO É ERRO DE CLIENTE (30/08). `erros_cliente` existe para responder uma
// pergunta só: *um cliente bateu nisto?* Em 29/08 entrou ali um `column perfis.email does not
// exist` vindo de `tsn-app-git-claude-…vercel.app` — um deploy de PREVIEW, o dono testando uma
// branch. Ninguém de fora viu, e mesmo assim ele contou em `clientes_com_erro`, que o painel do
// Cliente 360 mostra como "clientes com erro". O número existia, era plausível, e media outra
// coisa: a forma #10 do CLAUDE.md, agora dentro do próprio medidor de saúde.
//
// Custou caro: a busca pela origem varreu o código atual, cinco commits anteriores e o
// histórico do arquivo antes de o campo `url` entregar a resposta em um segundo. Filtrar aqui
// impede que a pergunta se repita.
//
// Preview e localhost seguem mostrando o erro no console de quem testa — que é onde ele serve.
const HOSTS_PRODUCAO = new Set(['bidprobrasil.com.br', 'www.bidprobrasil.com.br']);
export function ehProducao(href) {   // exportada para scripts/testes/erro-so-de-producao.mjs
  try { return HOSTS_PRODUCAO.has(new URL(href).hostname); }
  catch { return false; }   // sem href confiável, não inventa erro de cliente
}

export async function reportarErroCliente({ msg, stack = '', url } = {}) {
  try {
    if (contador >= TETO || ehRuido(msg) || ehStackDeTerceiro(stack)) return;
    const href = url || (typeof location !== 'undefined' ? location.href : '');
    if (!ehProducao(href)) return;   // preview/localhost: não é erro que um cliente viu
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
// Recarrega quando um chunk falha, com ORÇAMENTO em vez de trava seca (27/08).
//
// O que havia antes: um único reload por janela de 10s, e o segundo pedido dentro dessa
// janela era simplesmente recusado. Quem caía nisso ficava PRESO na tela "Atualizando…"
// para sempre — sem botão, sem mensagem, sem segunda tentativa. Aconteceu em 27/08 na
// `/live/leilao-ao-vivo`, que é a página que recebe a verba da campanha: dois deploys em
// sequência curta, e o visitante ficou olhando um spinner que não ia atualizar nada.
//
// Duas mudanças, e as duas importam:
//
//  (a) DUAS tentativas por rajada, não uma. A segunda vai com CACHE-BUSTING, porque o
//      motivo mais comum da primeira não resolver é o `index.html` voltar do cache (SW
//      ou borda de CDN) apontando para os MESMOS chunks que acabaram de sumir — recarregar
//      de novo sem forçar rede repete o erro por construção.
//  (b) O orçamento se RENOVA depois de um minuto calmo. `sessionStorage` sobrevive ao
//      reload, então um contador vitalício deixaria uma aba aberta o dia inteiro sem
//      auto-recuperação depois do segundo deploy do dia.
//
// O teto continua existindo — reload em loop é pior que tela parada. Mas quando o teto
// estoura, agora a pessoa é AVISADA (ver `mostrarAvisoPreso`), em vez de ficar sozinha
// com um spinner mentindo que algo está acontecendo.
const RAJADA_MS = 10000;   // "ainda falhando" = nova falha < 10s depois da última tentativa
const CALMARIA_MS = 60000; // um minuto sem incidente renova o orçamento da aba
const TENTATIVAS_POR_RAJADA = 2;

export function recarregarComGuarda() {
  let tentativa = 0;
  try {
    const agora = Date.now();
    const ultimo = Number(sessionStorage.getItem('__chunk_reload_at') || 0);
    const desde = agora - ultimo;
    tentativa = desde > CALMARIA_MS ? 0 : Number(sessionStorage.getItem('__chunk_reload_n') || 0);
    if (desde < RAJADA_MS && tentativa >= TENTATIVAS_POR_RAJADA) return false; // esgotou — quem chamou avisa
    sessionStorage.setItem('__chunk_reload_at', String(agora));
    sessionStorage.setItem('__chunk_reload_n', String(tentativa + 1));
  } catch { /* sessionStorage indisponível: 1 reload ainda é aceitável */ }

  // Segunda tentativa da rajada: força ida à rede. `location.replace` para não empilhar
  // histórico — quem clicar em "voltar" tem que sair da página, não revisitar a falha.
  if (tentativa >= 1) {
    try {
      const u = new URL(location.href);
      u.searchParams.set('_r', String(Date.now()));  // antes do #, então a rota do HashRouter fica intacta
      location.replace(u.toString());
      return true;
    } catch { /* URL indisponível: cai no reload simples abaixo */ }
  }
  location.reload();
  return true;
}

/**
 * Última linha de defesa: a recarga automática desistiu e a pessoa PRECISA saber.
 *
 * DOM cru, sem React, de propósito — quando isto roda, o módulo da tela pode nem ter
 * carregado, e um componente não teria como aparecer. Também não depende do
 * ErrorBoundary: o `vite:preloadError` chega pelo handler global, fora do ciclo de render.
 *
 * Idempotente: várias falhas em sequência mostram UM aviso só.
 */
export function mostrarAvisoPreso() {
  try {
    if (typeof document === 'undefined' || document.getElementById('bp-preso')) return;
    const cx = document.createElement('div');
    cx.id = 'bp-preso';
    cx.setAttribute('role', 'alert');
    cx.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;'
      + 'justify-content:center;padding:24px;background:#f1f5f9;font-family:system-ui,-apple-system,sans-serif';
    const cartao = document.createElement('div');
    cartao.style.cssText = 'background:#fff;border-radius:16px;padding:32px 28px;max-width:400px;width:100%;'
      + 'text-align:center;box-shadow:0 12px 40px rgba(0,0,0,.12)';
    const h = document.createElement('div');
    h.style.cssText = 'font-size:17px;font-weight:800;color:#0f172a;margin-bottom:8px';
    h.textContent = 'Não conseguimos terminar de carregar a página';
    const p = document.createElement('p');
    p.style.cssText = 'font-size:14px;color:#475569;line-height:1.6;margin:0 0 22px';
    // A causa NÃO é conhecida daqui — um chunk que não carrega tem as duas explicações, e
    // afirmar a errada é o mesmo defeito que este aviso existe para consertar. `onLine` é
    // o único sinal barato que separa as duas; na dúvida (undefined) fica a mais provável.
    p.textContent = (typeof navigator !== 'undefined' && navigator.onLine === false)
      ? 'Parece que a sua conexão caiu. Confira a internet e recarregue — você volta para esta mesma página.'
      : 'Costuma ser uma versão nova publicada enquanto você estava aqui. Recarregar resolve — você volta para esta mesma página.';
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'width:100%;padding:14px;background:#0D63DB;color:#fff;border:none;border-radius:11px;'
      + 'font-weight:800;font-size:15px;cursor:pointer;font-family:inherit';
    b.textContent = 'Recarregar a página';
    // Clique manual ignora o orçamento — é a pessoa pedindo, não o automático insistindo.
    b.onclick = () => {
      try { sessionStorage.removeItem('__chunk_reload_n'); sessionStorage.removeItem('__chunk_reload_at'); } catch { /* ignore */ }
      try {
        const u = new URL(location.href);
        u.searchParams.set('_r', String(Date.now()));
        location.replace(u.toString());
      } catch { location.reload(); }
    };
    cartao.append(h, p, b);
    cx.append(cartao);
    document.body.appendChild(cx);

    // SAI SOZINHO AO NAVEGAR, mesma regra que o RootErrorBoundary já usa. Este aviso cobre
    // a tela inteira com z-index máximo: se o app se recuperar por outro caminho (a pessoa
    // volta para uma rota cujo chunk já está carregado), um cartaz eterno estaria bloqueando
    // uma página que funciona — trocar um beco sem saída por outro.
    const sair = () => { try { cx.remove(); } catch { /* ignore */ } finally {
      window.removeEventListener('hashchange', sair); window.removeEventListener('popstate', sair);
    } };
    window.addEventListener('hashchange', sair);
    window.addEventListener('popstate', sair);
  } catch { /* nunca deixar o aviso derrubar a página */ }
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
      mostrarAvisoPreso(); // logar sem avisar deixava a pessoa sozinha com o spinner
    }
  });
  window.addEventListener('error', (e) => {
    // Erros de recurso (img/script 404) não têm message — ignora.
    if (!e?.message) return;
    // Chunk velho → recarrega e não loga (só loga se preso). Demais erros → loga normal.
    if (ehErroDeChunk(e.message) || houveChunkRecente()) {
      marcarChunkErro();
      if (!recarregarComGuarda()) {
        reportarErroCliente({ msg: e.message, stack: e.error?.stack, url: location.href });
        mostrarAvisoPreso();
      }
      return;
    }
    reportarErroCliente({ msg: e.message, stack: e.error?.stack, url: location.href });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e?.reason;
    const msg = r?.message || String(r);
    if (ehErroDeChunk(msg) || houveChunkRecente()) {
      marcarChunkErro();
      if (!recarregarComGuarda()) {
        reportarErroCliente({ msg, stack: r?.stack, url: location.href });
        mostrarAvisoPreso();
      }
      return;
    }
    reportarErroCliente({ msg, stack: r?.stack, url: location.href });
  });
}
