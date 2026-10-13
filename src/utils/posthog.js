// PostHog — GRAVAÇÃO DE SESSÃO para ver ONDE o cliente trava (13/10, pedido do dono).
//
// POR QUE: os defeitos mais caros desta base foram tela que parecia funcionar e estava vazia por
// dentro — e quem descobria era o cliente, clicando (a Neuma clicou 14× em "Gerar" em 8 minutos,
// 10/09). `eventos_atividade` diz QUE clicou; a gravação mostra o que ele VIU. Complementa o
// tracker próprio (utils/tracker.js) e o `cliente_travou()`, não substitui.
//
// LGPD — o que NÃO vai para o PostHog:
//   • nada digitado: `maskAllInputs` (CPF, senha, telefone, valor de lance…);
//   • só grava as telas da LISTA (ROTAS_GRAVADAS: busca, imóvel, relatório, planos, checkout, login…).
//     Lista de PERMITIDAS, não de proibidas: tela nova nasce sem gravação até alguém incluí-la —
//     perfil, comissões, contratos, chamados, caso, links com token etc. nunca entram por esquecimento;
//   • a equipe (admin/analista/advogado/consultor) — não é cliente e pesaria na cota;
//   • identidade: só o UUID interno do perfil, nunca nome/e-mail.
// A chave `phc_…` é a chave PÚBLICA de ingestão (feita para ir no navegador), não é segredo.
//
// Carregamento PREGUIÇOSO (import dinâmico após o load): o SDK não entra no bundle inicial.
const CHAVE = 'phc_niJPXhBofJxdDo62V8r5DaPsutix2bdaPqD6yc3QDwah';
const HOST = 'https://us.i.posthog.com';

const ROTAS_GRAVADAS = ['/', '/buscar', '/imovel', '/mapa', '/indice', '/calculadora', '/alavancagem', '/analise', '/analise-veiculo',
  '/analises', '/planos', '/plano', '/checkout', '/creditos', '/login', '/educacao', '/membros', '/live', '/p'];
const ROLES_EQUIPE = ['admin', 'analista', 'advogado', 'consultor'];

let ph = null;          // instância (depois do import)
let carregando = null;  // promise do import
let equipe = false;     // sessão da equipe → nunca grava
let identidade = null;  // { id, role } chegada ANTES do SDK carregar — aplicada no init
let resolvido = false;  // só grava DEPOIS de saber quem é (o papel padrão 'explorador' antes do perfil carregar gravaria o admin)

const rotaAtual = () => {
  try { return (window.location.hash || '').replace(/^#/, '').split('?')[0] || window.location.pathname || '/'; } catch { return '/'; }
};
const rotaGravavel = (r) => ROTAS_GRAVADAS.some(p => r === p || (p !== '/' && r.startsWith(`${p}/`)));

function ajustarGravacao() {
  if (!ph) return;
  try {
    const gravar = resolvido && !equipe && rotaGravavel(rotaAtual());
    if (gravar && !ph.sessionRecordingStarted()) ph.startSessionRecording();
    else if (!gravar && ph.sessionRecordingStarted()) ph.stopSessionRecording();
  } catch (e) { console.warn('[posthog] ajuste da gravação falhou:', e?.message || e); }
}

export function initPostHog() {
  if (typeof window === 'undefined' || !import.meta.env.PROD || carregando) return;
  // Preview/branch da Vercel não grava (só o domínio de produção) — mesmo princípio do Sentry.
  if (!/(^|\.)bidprobrasil\.com\.br$/.test(window.location.hostname)) return;
  carregando = import('posthog-js').then(({ default: posthog }) => {
    posthog.init(CHAVE, {
      api_host: HOST,
      person_profiles: 'identified_only',
      capture_pageview: 'history_change', // HashRouter navega por pushState/popstate
      autocapture: true,                  // traz $rageclick/$dead_click, o sinal de "travou"
      disable_session_recording: true,    // começa desligada: ajustarGravacao() decide por rota
      session_recording: { maskAllInputs: true, maskInputOptions: { password: true } },
      persistence: 'localStorage+cookie',
      // Evento de clique automático roda em TODA tela (inclusive as não gravadas): sem texto nem
      // atributos do elemento, só o tipo/posição — o card do cliente não vaza nome/CPF por aqui.
      mask_all_text: true,
      mask_all_element_attributes: true,
    });
    ph = posthog;
    if (identidade?.id) { try { posthog.identify(String(identidade.id), { role: identidade.role || null }); } catch (e) { console.warn('[posthog] identify falhou:', e?.message || e); } }
    ajustarGravacao();
    window.addEventListener('hashchange', ajustarGravacao);
    window.addEventListener('popstate', ajustarGravacao);
    return posthog;
  }).catch((e) => { console.warn('[posthog] não carregou:', e?.message || e); return null; });
}

// Chamado pelo AuthContext quando o papel do usuário é conhecido. Só o UUID — nada de PII.
export function identificarPostHog(id, role) {
  equipe = ROLES_EQUIPE.includes(String(role || ''));
  resolvido = true;
  const saiu = !!identidade?.id && !id; // logout: só aí o reset (em visitante anônimo ele partiria a sessão)
  identidade = { id, role };
  if (!carregando) return; // o init aplica `identidade` quando o SDK carregar
  carregando.then((p) => {
    if (!p) return;
    try {
      if (id) p.identify(String(id), { role: role || null });
      else if (saiu) p.reset();
    } catch (e) { console.warn('[posthog] identify falhou:', e?.message || e); }
    ajustarGravacao();
  });
}
