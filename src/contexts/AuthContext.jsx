import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase, marcarSimulacao } from '../utils/supabase';
import { ativarPushAutomatico } from '../utils/push';
import { salvarRef, lerRef, limparRef } from '../utils/ref';
import { lerMarketing } from '../utils/marketing';
import { salvarConvite, lerConvite, limparConvite, CHAVE_EQUIPE, CHAVE_CLIENTE, CHAVE_PLANO } from '../utils/convitePendente';

const AuthContext = createContext(null);

const IMPERSONATE_KEY  = 'tsn_impersonate';
const SIM_ROLE_KEY     = 'tsn_sim_role';
const LAST_ACTIVITY_KEY = 'tsn_last_activity';
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

// Atualiza o timestamp de atividade a cada interação.
// TRY/CATCH obrigatório (21/08): num Firefox com a cota de storage cheia/bloqueada, este
// setItem lançava QuotaExceededError A CADA interação — 4 rotas de um mesmo usuário em
// erros_cliente num minuto, e a exceção morria no meio de quem chamou. Storage indisponível
// não pode derrubar nada: sem o carimbo, a sessão simplesmente não expira por inatividade.
function updateActivity() {
  try { localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString()); } catch { /* storage cheio/bloqueado — segue sem carimbo */ }
}

function isSessionExpired() {
  try {
    const last = localStorage.getItem(LAST_ACTIVITY_KEY);
    if (!last) return false;
    return Date.now() - Number(last) > SESSION_TIMEOUT_MS;
  } catch { return false; } // storage bloqueado (Firefox sem cookies) → nunca expira à força
}

async function fetchPerfil(userId) {
  if (!userId) return { role: 'explorador', ativo: true, inadimplenteDias: 0, cadastroIncompleto: false, planoLegado: false };
  // FALHA DE LEITURA ≠ PERFIL VAZIO (10/08). O postgrest-js **não lança** em não-2xx: devolve
  // `{data:null,error}`. Desestruturando só `data`, um 500/503/401 transitório (timeout de
  // statement, pool esgotado, corrida no refresh do token) caía no MESMO ramo de "perfil não
  // existe" — e o ramo foi escrito para o segundo caso. Resultado: o assinante `clube` que
  // trocava de aba virava `explorador` na UI, com o popup de "Complete seu cadastro" por cima,
  // e o perfil FALSO era gravado no cache. 401/403/406 estão em STATUS_IGNORADOS do relator,
  // então nem rastro em `erros_cliente` sobrava.
  // `maybeSingle` em vez de `single`: com zero linhas devolve `{data:null,error:null}`, o que
  // separa de vez "não tem perfil" (dado) de "não consegui ler" (falha).
  const { data, error } = await supabase
    .from('perfis')
    .select('role, ativo, inadimplente_desde, cpf_hash, lgpd_aceito, nome, telefone, endereco_cidade, endereco_uf, plano_legado')
    .eq('id', userId)
    .maybeSingle();
  const falhouLeitura = !!error;

  // Cadastro-base obrigatório: nome, telefone/WhatsApp, cidade E estado, + aceite LGPD.
  // O CPF NÃO entra aqui — só é exigido na hora de PAGAR (checkout) e de SACAR. A cidade
  // é obrigatória porque alimenta o filtro por região e os alertas por e-mail.
  // Falta QUALQUER um → um popup pede para completar (um campo por vez) antes de usar o app.
  const cadastroFalta = !data?.nome || !String(data?.nome).trim()
    || !data?.telefone
    || !data?.endereco_cidade || !data?.endereco_uf
    || !data?.lgpd_aceito;

  let inadimplenteDias = 0;
  if (data?.inadimplente_desde) {
    const desde = new Date(data.inadimplente_desde);
    inadimplenteDias = Math.floor((Date.now() - desde.getTime()) / 86400000);
  }

  // Após 5 dias sem pagar, persiste o downgrade para explorador.
  // Roles operacionais (admin, analista, advogado, consultor) nunca são downgradeados.
  const ROLES_OPERACIONAIS = ['admin', 'analista', 'advogado', 'consultor'];
  if (inadimplenteDias > 5 && data?.role && data.role !== 'explorador' && !ROLES_OPERACIONAIS.includes(data.role)) {
    // 19/08: o resultado era descartado — se a RLS barrasse a escrita, a UI rebaixava e o
    // banco não, divergência sem rastro. A UI continua rebaixando (a regra dos 5 dias vale
    // de qualquer forma na sessão), mas a falha da persistência fica registrada.
    const { error: errDown } = await supabase.from('perfis').update({
      role_anterior: data.role,
      role: 'explorador',
    }).eq('id', userId);
    if (errDown) console.error('[auth] downgrade por inadimplência não persistiu:', errDown.message);
    return { role: 'explorador', ativo: data?.ativo !== false, inadimplenteDias, cadastroIncompleto: cadastroFalta, planoLegado: false, falhouLeitura };
  }

  // Normaliza o sufixo _anual: a modalidade anual é forma de PAGAMENTO, não um
  // papel distinto. O role efetivo é sempre o base (top2/assessorado/clube), para
  // que todas as listas de permissão funcionem sem precisar duplicar cada '_anual'.
  const roleFinal = (data?.role || 'explorador').replace(/_anual$/, '');
  const ehCliente = !ROLES_OPERACIONAIS.includes(roleFinal);
  return {
    // Sem perfil carregado → menor privilégio (explorador), nunca um role usável por engano
    role: roleFinal,
    ativo: data?.ativo !== false,
    inadimplenteDias,
    // Cliente sem nome/telefone/CPF/cidade/UF/LGPD precisa completar antes de usar o app.
    // Numa FALHA de leitura, nunca: trancar o app atrás de um popup por causa de um 500
    // transitório é o oposto do que o popup existe para fazer. O `role` segue fail-closed
    // (menor privilégio) porque permissão errada a MAIS é pior; já o popup só atrapalha.
    cadastroIncompleto: ehCliente && cadastroFalta && !falhouLeitura,
    nome: data?.nome || '',
    // Grandfather de cota (assinantes antigos mantêm 15+15+5). Só o flag; a cota real
    // vem de limite_ia_efetivo no banco — aqui é só para o espelho de UI não bloquear antes.
    planoLegado: !!data?.plano_legado,
    falhouLeitura,
  };
}

// Cache é para acelerar a PRÓXIMA abertura com o último perfil CONHECIDO. Gravar o resultado
// de uma leitura que falhou envenena exatamente isso: a próxima abertura hidrataria com o
// perfil rebaixado antes de revalidar. Uma linha, e ela é o que impede o erro de durar mais
// que o segundo em que aconteceu.
function podeCachear(p) { return !!p && !p.falhouLeitura; }

function loadImpersonate() {
  try { return JSON.parse(sessionStorage.getItem(IMPERSONATE_KEY) || 'null'); }
  catch { return null; }
}

// Cache do perfil (role/nome/etc.) em localStorage → na volta do usuário, a tela aparece
// INSTANTÂNEA com o último perfil conhecido enquanto o valor fresco é revalidado em 2º plano
// (stale-while-revalidate). Antes, o app ficava em tela branca esperando a query do perfil.
const PERFIL_CACHE_KEY = 'tsn_perfil_cache';
function loadPerfilCache(uid) {
  try { const c = JSON.parse(localStorage.getItem(PERFIL_CACHE_KEY) || 'null'); return (c && c.uid === uid) ? c.p : null; }
  catch { return null; }
}
function savePerfilCache(uid, p) {
  if (!uid) return;
  try { localStorage.setItem(PERFIL_CACHE_KEY, JSON.stringify({ uid, p })); } catch { /* ok */ }
}

export function AuthProvider({ children }) {
  const [user, setUser]             = useState(null);
  const [role, setRole]             = useState('explorador');
  const [ativo, setAtivo]           = useState(true);
  const [inadimplenteDias, setInad] = useState(0);
  const [cadastroIncompleto, setCadastroIncompleto] = useState(false);
  const [nome, setNome]             = useState(''); // nome do usuário (p/ cabeçalho de relatórios)
  const [planoLegado, setPlanoLegado] = useState(false); // assinante antigo (cota 15+15+5)
  const [loading, setLoading]       = useState(true);
  // Modo suporte: admin/analista visualizando a conta de um cliente
  const [impersonate, setImpersonate] = useState(loadImpersonate);
  // Simulação de role: admin testa a UI como outro tipo de usuário
  // try/catch no INICIALIZADOR (21/08): com cookies/site-data bloqueados o Firefox lança
  // SecurityError já no getItem — sem a guarda, o AuthProvider morria na montagem e o app
  // inteiro virava tela branca para esse navegador.
  const [roleSimulado, setRoleSimulado] = useState(() => { try { const r = sessionStorage.getItem(SIM_ROLE_KEY) || null; marcarSimulacao(r); return r; } catch { return null; } });

  useEffect(() => {
    // Captura GLOBAL da indicação do parceiro (?ref=), venha ANTES ou DEPOIS do # (HashRouter).
    // Antes cada página capturava por conta própria e a Landing/início NÃO capturava — então o
    // link GERAL do parceiro (que aponta p/ o início, para o visitante navegar e assinar) perdia
    // a indicação. Aqui persiste 1x, cedo, para QUALQUER ponto de entrada; o bloco SIGNED_IN
    // abaixo consome via vincular_upline no cadastro. O código é FIXO do parceiro → o MESMO link
    // vincula quantas pessoas clicarem (todas atribuídas a quem indicou).
    try {
      const pegaRef = (qs) => { try { return new URLSearchParams(qs).get('ref'); } catch { return null; } };
      const h = window.location.hash || '';
      const iq = h.indexOf('?');
      const ref = pegaRef(window.location.search) || (iq >= 0 ? pegaRef(h.slice(iq)) : null);
      if (ref) salvarRef(ref); // localStorage + janela de 30 dias (sobrevive a fechar a aba)
    } catch { /* ignore */ }
    // Verificar expiração de 24h na carga inicial
    const aplicarPerfil = (p) => {
      setRole(p.role); setAtivo(p.ativo); setInad(p.inadimplenteDias);
      setCadastroIncompleto(p.cadastroIncompleto ?? false); setNome(p.nome || '');
      setPlanoLegado(p.planoLegado ?? false);
    };
    // Link de recuperação de senha abre uma sessão de RECOVERY. Não aplicar a expiração de
    // 24h nesse contexto — senão o signOut derrubava a sessão de recovery e o RedefinirSenha
    // mostrava "link inválido/expirado" (atingindo justamente quem não acessava há tempos).
    const ehRecovery = typeof window !== 'undefined' && (
      /type=recovery/.test(window.location.href) || /redefinir-senha|recuperar|reset/i.test(window.location.hash)
    );
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      if (u && isSessionExpired() && !ehRecovery) {
        supabase.auth.signOut();
        try { localStorage.removeItem(LAST_ACTIVITY_KEY); localStorage.removeItem(PERFIL_CACHE_KEY); } catch { /* storage bloqueado */ }
        setLoading(false);
        return;
      }
      if (u) updateActivity();
      setUser(u);
      if (!u) { setLoading(false); return; }
      // Hidrata do cache NA HORA (se houver) e já libera a UI — sem esperar a rede.
      const cached = loadPerfilCache(u.id);
      if (cached) { aplicarPerfil(cached); setLoading(false); }
      // Revalida em 2º plano; só o 1º acesso (sem cache) espera a query.
      fetchPerfil(u.id).then((p) => { aplicarPerfil(p); if (podeCachear(p)) savePerfilCache(u.id, p); setLoading(false); })
        .catch(() => setLoading(false));
    });

    // Atualiza atividade em cliques e teclas
    const onActivity = () => updateActivity();
    window.addEventListener('click', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      // Recuperação de senha conta como atividade → não deixa a expiração de 24h derrubar
      // a sessão de recovery recém-criada pelo link do e-mail.
      if (event === 'PASSWORD_RECOVERY') updateActivity();
      // Limpeza do modo suporte no logout (não usa supabase → pode ser síncrono).
      if (event === 'SIGNED_OUT') {
        try {
          sessionStorage.removeItem(IMPERSONATE_KEY);
          localStorage.removeItem(LAST_ACTIVITY_KEY);
          localStorage.removeItem(PERFIL_CACHE_KEY);
        } catch { /* storage bloqueado — o estado React abaixo limpa o que importa */ }
        setImpersonate(null);
      }
      // IMPORTANTE: NÃO chamar funções async do supabase DENTRO do callback do
      // onAuthStateChange. Ele roda sob o lock interno do auth e a query de perfil
      // vinha com o contexto de sessão ainda não propagado, retornando role='explorador'
      // até o usuário dar refresh (o sistema "não reconhecia o role" no login). Deferindo
      // para FORA do lock (setTimeout 0), a query usa a sessão já estabelecida e o role
      // é reconhecido de primeira, sem precisar recarregar a tela.
      setTimeout(async () => {
        const p = await fetchPerfil(u?.id);
        setRole(p.role);
        setAtivo(p.ativo);
        setInad(p.inadimplenteDias);
        setCadastroIncompleto(p.cadastroIncompleto ?? false);
      setNome(p.nome || '');
        setPlanoLegado(p.planoLegado ?? false);
        if (u && podeCachear(p)) savePerfilCache(u.id, p);
        // Vincula o cliente ao consultor que o indicou (link de afiliado), inclusive no
        // login Google onde o trigger não recebe o código. Só no sign-in real.
        if (u && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
          // Log de uso — prova de acesso para proteção contra chargeback
          if (event === 'SIGNED_IN') {
            // O try/catch NÃO pega a rejeição do import() dinâmico: em chunk stale
            // pós-deploy o módulo vem undefined e o destructure quebrava (erro-cliente
            // "Cannot destructure property 'logUso' of 'undefined'" na /analise).
            // Optional chaining + .catch tornam o log de acesso à prova de falha.
            import('../utils/logUso').then(m => m?.logUso?.(u.id, 'login')).catch(() => {});
            // Boas-vindas UNIVERSAL: dispara 1x por conta (idempotente no servidor por
            // perfis.boas_vindas_em). Só no SIGNED_IN (login novo, inclui o 1º acesso após
            // qualquer cadastro: grátis, pago, normal, Google, convite) — não no
            // INITIAL_SESSION (reabertura). Best-effort, não bloqueia o login.
            fetch('/api/boas-vindas', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } }).catch(() => {});
          }
          // Push automático (só 1x por navegador).
          try { ativarPushAutomatico(() => session); } catch (_) {}
          // Coleta client-side (IP residencial do STAFF) — dispara no LOGIN, independente da
          // ROTA. Antes só rodava num useEffect do MainLayout, que NÃO monta em /admin (onde o
          // staff trabalha) → nunca disparava. Aqui roda em SIGNED_IN (login novo) e
          // INITIAL_SESSION (reabertura do app/PWA com sessão). Só staff; o gate 2x/semana +
          // a trava de sessão em coletaCliente cuidam da frequência. import() dinâmico p/ não
          // rodar para cliente comum nem inflar o chunk principal.
          if (['admin', 'analista', 'advogado'].includes(p.role)) {
            import('../utils/coletaCliente').then(m => m?.dispararColetaClienteStaff?.()).catch(() => {});
            // Coleta OPORTUNISTA das fontes PAGAS (SOLEON/GESTAO/RJ/PECINI, Bright Data): dispara o
            // scraper na NUVEM ao abrir o app, mas o servidor só dispara se já passou o espaçamento
            // (~20h, gate atômico) — quem acessa todo dia mantém as pagas frescas sem PC ligado e
            // sem gastar BD a cada abertura. Rede de 7 dias = cron semanal dessas fontes na CI.
            fetch('/api/coleta-oportunista', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } }).catch(() => {});
          }
          const ref = lerRef(); // localStorage c/ janela de 30 dias (+ compat sessionStorage antigo)
          let refPendente = false; // ref existe mas ainda NÃO foi resolvido (erro transitório)
          if (ref) {
            // vincular_upline: QUALQUER usuário pode ser o indicador (antes só consultor);
            // aceita o id do link (?ref=<id>) ou um código de indicação. Grava indicado_por.
            // (No cadastro por e-mail o trigger handle_new_user JÁ vinculou server-side via
            // ref_codigo na metadata; este RPC é o caminho do OAuth/Google — onde o trigger
            // não recebe o ?ref= — e um reforço idempotente.)
            // SÓ limpa o ref quando houve resposta DEFINITIVA (true=vinculou, false=código
            // inválido ou já tinha upline). Em ERRO de rede/propagação NÃO limpa — deixa
            // re-tentar num próximo SIGNED_IN/INITIAL_SESSION (antes, um erro transitório
            // apagava o ref e o owner-default abaixo "roubava" a indicação do parceiro).
            let vinc = null;
            try {
              const { data, error } = await supabase.rpc('vincular_upline', { p_ref: ref });
              vinc = error ? null : data; // erro (rede/RLS) → null: não limpa, re-tenta depois
            } catch (_) { vinc = null; }
            if (vinc === true || vinc === false) limparRef(); else refPendente = true;
          }
          // Sem link de parceiro → upline PADRÃO é o dono (pedido do dono: "todos que entraram e
          // não são pelo link dos parceiros são para o meu usuário"). Idempotente — só preenche se
          // indicado_por ainda for NULL, então nunca sobrepõe a indicação de parceiro gravada acima.
          // NÃO roda quando há um ref PENDENTE (upline não resolvido por erro transitório): senão o
          // dono "roubaria" o slot e o retry do parceiro já não teria como sobrepor.
          if (!refPendente) { try { await supabase.rpc('vincular_owner_default'); } catch (_) {} }
          // ATRIBUIÇÃO de marketing (gclid/fbclid/utm) capturada na chegada → grava 1x (first-touch)
          // para casar a captação com a origem paga (Google Ads / Meta).
          try { const mkt = lerMarketing(); if (mkt) await supabase.rpc('registrar_marketing', { p: mkt }); } catch (_) {}
          const convite = lerConvite(CHAVE_CLIENTE);
          if (convite) {
            try { await supabase.rpc('usar_convite', { p_codigo: convite }); } catch (_) {}
            limparConvite(CHAVE_CLIENTE);
          }
          // CONVITE DE EQUIPE — o token só é descartado quando o resgate teve DESFECHO
          // (05/08). Antes o removeItem era incondicional: falha de rede, RPC fora do ar ou
          // qualquer exceção apagava o token e o convite sumia sem rastro — a pessoa entrava
          // como explorador e nada indicava o porquê. Agora: sucesso OU recusa definitiva
          // (inválido/expirado/já usado) descartam; falha TRANSITÓRIA preserva o token para
          // a próxima sessão tentar de novo. Uso único e validade são garantidos no RPC.
          const conviteEq = lerConvite(CHAVE_EQUIPE);
          if (conviteEq) {
            try {
              const { data: rEq, error: eEq } = await supabase.rpc('usar_convite_equipe', { p_token: conviteEq, p_user_id: u.id });
              const definitivo = rEq?.ok === true || (rEq?.ok === false && !/não autorizado/i.test(String(rEq?.erro || '')));
              if (!eEq && definitivo) limparConvite(CHAVE_EQUIPE);
              if (rEq?.ok === false) console.warn('[convite-equipe] não resgatado:', rEq?.erro);
            } catch (e) { console.warn('[convite-equipe] resgate adiado:', e?.message || e); }
          }
          // Redirect pós-login social (Google) ao destino preservado antes do OAuth.
          let oauthDest = null;   // usado também no resgate do plano abaixo (só resgata sem redirect pendente)
          try {
            oauthDest = sessionStorage.getItem('tsn_oauth_redirect');
            if (oauthDest) {
              sessionStorage.removeItem('tsn_oauth_redirect');
              if (window.location.hash.replace(/^#/, '') !== oauthDest) window.location.hash = oauthDest;
            }
          } catch { /* storage bloqueado — sem redirect preservado, fica na rota atual */ }
          // PLANO ESCOLHIDO ANTES DO CADASTRO — resgatado aqui (10/08). `CHAVE_PLANO` era
          // GRAVADA em três lugares (Login, Checkout) e LIDA só dentro do Login.jsx, no
          // `handleLogin`/`handleGoogle`. Só que o caminho mais comum não passa por nenhum dos
          // dois: quem escolhe plano pago se cadastra, abre o e-mail (em geral no celular, outra
          // aba), clica em confirmar, e o Supabase estabelece a sessão por `detectSessionInUrl`
          // — que dispara ESTE bloco e joga a pessoa em `${origin}/`. Ela chegava na Home como
          // explorador, sem nenhuma menção ao plano, depois de a tela ter prometido "após o
          // login você será direcionado para o pagamento". A intenção de compra evaporava no
          // ponto final do funil. O resgate vive junto dos outros (convite de cliente, de
          // equipe, ref, marketing) porque é o único ponto por onde TODOS os logins passam.
          // Roda depois do oauthDest para não competir com ele, e o `limparConvite` garante
          // que aconteça no máximo uma vez.
          const planoPend = lerConvite(CHAVE_PLANO);
          if (planoPend && !oauthDest) {
            limparConvite(CHAVE_PLANO);
            // Já está no plano que pediu (webhook chegou antes, ou pagou por outro caminho):
            // não manda para o checkout cobrar de novo.
            const roleBase = String(p.role || '').replace(/_anual$/, '');
            if (roleBase !== String(planoPend) && !/^\/?checkout/.test(window.location.hash.replace(/^#/, ''))) {
              window.location.hash = `/checkout?plano=${encodeURIComponent(planoPend)}`;
            }
          }
          updateActivity();
        }
      }, 0);
    });

    // Reavalia o perfil (role/inadimplência/cadastro) quando a aba volta ao foco.
    // Antes mantínhamos 1 conexão Realtime por usuário (supabase.channel por uid),
    // o que estoura o teto de 200 conexões simultâneas do plano Free em escala.
    // O refetch no foco entrega o mesmo efeito (mudanças do webhook refletem ao
    // voltar à aba) sem custo de conexão persistente.
    const refetchPerfil = async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) return;
      const p = await fetchPerfil(uid);
      setRole(p.role);
      setAtivo(p.ativo);
      setInad(p.inadimplenteDias);
      setCadastroIncompleto(p.cadastroIncompleto ?? false);
      setNome(p.nome || '');
      setPlanoLegado(p.planoLegado ?? false);
      if (podeCachear(p)) savePerfilCache(uid, p);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refetchPerfil(); };
    window.addEventListener('focus', refetchPerfil);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', refetchPerfil);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, []);

  // Reavaliação manual do perfil (usado logo após um pagamento: o role já foi
  // ativado no servidor de forma síncrona, mas o contexto ainda tem o valor antigo
  // até um foco/reload — chamar isto libera o acesso na hora, sem re-login).
  // Devolve o perfil recém-lido além de atualizar o contexto: quem precisa DECIDIR na hora
  // (ex.: o Checkout, que só pode comemorar o pagamento depois de ver o plano ativo no
  // servidor) não consegue ler o `role` do contexto no mesmo tick — o state ainda é o antigo.
  const refreshPerfil = async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return null;
    const p = await fetchPerfil(uid);
    setRole(p.role);
    setAtivo(p.ativo);
    setInad(p.inadimplenteDias);
    setCadastroIncompleto(p.cadastroIncompleto ?? false);
    setNome(p.nome || '');
    setPlanoLegado(p.planoLegado ?? false);
    return p;
  };

  // Inicia o modo suporte. Os dados continuam protegidos por RLS: admin/analista
  // só conseguem ler o que as policies de equipe permitem.
  const iniciarSuporte = (alvo) => {
    try { sessionStorage.setItem(IMPERSONATE_KEY, JSON.stringify(alvo)); } catch { /* sem persistência entre reloads; o modo ainda funciona nesta aba */ }
    setImpersonate(alvo);
  };
  const encerrarSuporte = () => {
    try { sessionStorage.removeItem(IMPERSONATE_KEY); } catch { /* idem */ }
    setImpersonate(null);
  };

  // Ao ENTRAR na simulação, cai na TELA INICIAL; ao SAIR, volta ao painel de onde se veio
  // (pedido do dono, 15/08: "parar na tela inicial independente do nível de usuário").
  // Sem isto o admin ficava onde estava — em `/admin`, de onde a própria troca de papel o
  // expulsa —, e a simulação começava por um redirecionamento em vez de pela home.
  // `location.hash` porque o AuthProvider ENVOLVE o HashRouter: aqui não há `useNavigate`.
  const simularRole = (r) => {
    // A flag EM MEMÓRIA é marcada ANTES (e independente) do sessionStorage: é ela que faz a
    // trava de escrita da simulação (supabase.js) funcionar mesmo com storage bloqueado/cheio.
    marcarSimulacao(r || null);
    try { if (r) sessionStorage.setItem(SIM_ROLE_KEY, r); else sessionStorage.removeItem(SIM_ROLE_KEY); } catch { /* sem persistência: a flag de memória cobre */ }
    if (r) { setRoleSimulado(r); window.location.hash = '#/'; }
    else   { setRoleSimulado(null); window.location.hash = '#/admin'; }
  };

  // SIMULAÇÃO MOSTRA UMA CONTA RECÉM-CRIADA (15/08, pedido do dono: "vendo exatamente a tela
  // como se fosse aquele nível de usuário, como sendo recém criada a conta").
  //
  // Trocar o PAPEL não bastava. Na simulação de papel o usuário continua sendo o admin — e o
  // acervo lê identidade em dois lugares, com a mesma divisão que havia entre `role` e
  // `effectiveRole`: **151 leituras por `user.id` cru contra 57 por `effectiveUserId`**. Ou
  // seja, simular "explorador" ainda desenhava os CASOS, as ANÁLISES, a REDE e os CONTRATOS do
  // admin — a tela do explorador preenchida com a vida de outra pessoa, que é o oposto de
  // "conta nova".
  //
  // Mexer nos 20 arquivos teria a vida curta de sempre: o 21º nasceria lendo `user.id`. Então a
  // troca acontece na IDENTIDADE, num ponto só — durante a simulação, `user` passa a apontar
  // para uma conta que NÃO EXISTE. Toda consulta, crua ou efetiva, volta vazia, e vazio é
  // exatamente o estado de quem acabou de se cadastrar. Não é um mock: é o banco respondendo a
  // verdade sobre um id sem linhas.
  //
  // ⚠️ LIMITE QUE PRECISA FICAR CLARO: isto vale para o que a tela LÊ do banco. Chamada de API
  // viaja com o token REAL do admin, então um fluxo que grave pelo servidor age como admin, não
  // como o papel simulado. Por isso o banner diz "só visualização" — e por isso a saudação
  // proativa do chat já é bloqueada em simulação (ver ChatSuporte.jsx). Escrever direto no
  // banco, por sua vez, falha fechado: a RLS compara com `auth.uid()`, que nunca será este id.
  const SIM_USER_ID = '00000000-0000-0000-0000-000000000000';
  const usuarioVisivel = (roleSimulado && user)
    ? { ...user, id: SIM_USER_ID, email: `simulacao+${roleSimulado}@bidprobrasil.com.br` }
    : user;

  // Identidade/role efetivos: simulação > suporte > real
  const effectiveUserId = impersonate?.id || usuarioVisivel?.id || null;
  const effectiveRole   = (((role === 'admin' && roleSimulado) ? roleSimulado : (impersonate?.role || role)) || 'explorador').replace(/_anual$/, '');
  const podeImpersonar  = role === 'admin' || role === 'analista';

  // `role` EXPOSTO = o EFETIVO. Corrigido em 15/08, achado do dono: "coloquei para simular o
  // acesso de um explorador, mas ainda assim há vícios na exibição".
  //
  // A simulação só existia em `effectiveRole` — e o acervo estava dividido ao meio:
  // **29 componentes liam `role` (o real) contra 12 que liam `effectiveRole`**. Ou seja, no
  // modo simulação a maioria das telas continuava desenhando para o ADMIN, e as poucas
  // corrigidas desenhavam para o explorador. O resultado não era nem uma coisa nem outra: era
  // uma tela que não existe para usuário nenhum — inútil justamente para o fim de validar.
  //
  // Corrigir 29 arquivos um a um teria a mesma vida curta: o 30º componente nasceria lendo
  // `role`, como os 29 nasceram, e o vício voltaria. A regra passa a ser a segura por padrão:
  // **`role` é o que a pessoa VÊ**; quem precisa do papel de verdade pede `roleReal`, e a
  // exceção fica explícita no código de quem a usa (hoje: `podeImpersonar` e o controle de
  // simulação). `isAdmin` acompanha `role` — simular explorador tem de esconder o que é de
  // admin, senão a simulação não simula nada.
  //
  // A saída NÃO depende disto: o botão "Voltar ao Admin" vive no banner do Header, que é
  // desenhado a partir de `roleSimulado`, fora desta troca. Sem isso, simular explorador
  // trancaria o admin fora do /admin sem porta de volta.
  const roleVisivel = effectiveRole;

  return (
    <AuthContext.Provider value={{
      user: usuarioVisivel, userReal: user, role: roleVisivel, roleReal: role, nome, ativo, inadimplenteDias, loading, cadastroIncompleto, setCadastroIncompleto, planoLegado,
      isAdmin: roleVisivel === 'admin',
      isLoggedIn: !!user,
      impersonate, iniciarSuporte, encerrarSuporte, podeImpersonar,
      effectiveUserId, effectiveRole,
      roleSimulado, simularRole, refreshPerfil,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
