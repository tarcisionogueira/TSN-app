import React, { useState, useEffect, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useParams, useNavigate } from 'react-router-dom';
import { trackPageView } from './utils/gtag';
import { supabase } from './utils/supabase';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { PlanosProvider } from './contexts/PlanosContext';
import { AnalisesProvider } from './contexts/AnalisesContext';
import Header from './components/Header';
import Footer from './components/Footer';
import TourGuia from './components/TourGuia';
import ContratoObrigatorio from './components/ContratoObrigatorio';
import CompletarCadastroModal from './components/CompletarCadastroModal';
import KycParceiroModal from './components/KycParceiroModal';
import TermosAtualizadosModal from './components/TermosAtualizadosModal';
import ToastRelatorioPronto from './components/ToastRelatorioPronto';
import ChatSuporte from './components/ChatSuporte';
import BoasVindasModal from './components/BoasVindasModal';
import { useVezDoModal } from './utils/filaModais';
import SugestaoImovel from './components/SugestaoImovel';
import PwaInstall from './components/PwaInstall.jsx';
// Páginas carregadas SOB DEMANDA (code-splitting): cada rota vira um chunk próprio,
// então o navegador baixa só a tela que o usuário abre — abertura mais rápida e menos
// processamento. Funciona igual em Chrome/Safari/Firefox/Edge (import() é padrão).
const Landing = lazy(() => import('./pages/Landing'));
const MeusChamados = lazy(() => import('./pages/MeusChamados'));
const Atendimento = lazy(() => import('./pages/Atendimento'));
const Termos = lazy(() => import('./pages/Termos'));
const Privacidade = lazy(() => import('./pages/Privacidade'));
const Busca = lazy(() => import('./pages/Busca'));
const ImovelDetalhe = lazy(() => import('./pages/ImovelDetalhe'));
const ImovelGate = lazy(() => import('./pages/ImovelGate'));
const Analise = lazy(() => import('./pages/Analise'));
const MinhasAnalises = lazy(() => import('./pages/MinhasAnalises'));
const Arrematados = lazy(() => import('./pages/Arrematados'));
const HomeCliente = lazy(() => import('./pages/HomeCliente'));
const Painel = lazy(() => import('./pages/Painel'));
const Consultor = lazy(() => import('./pages/Consultor'));
const MinhaRede = lazy(() => import('./pages/MinhaRede'));
const Comercial = lazy(() => import('./pages/Comercial'));
const NpsAlavancagem = lazy(() => import('./pages/NpsAlavancagem'));
const AtivarVendedor = lazy(() => import('./pages/AtivarVendedor'));
const Contratos = lazy(() => import('./pages/Contratos'));
const Calculadora = lazy(() => import('./pages/Calculadora'));
const IndiceConsulta = lazy(() => import('./pages/IndiceConsulta'));
const Membros = lazy(() => import('./pages/Membros'));
const Cliente360 = lazy(() => import('./pages/Cliente360'));
const Curso = lazy(() => import('./pages/Curso'));
const Planos = lazy(() => import('./pages/Planos'));
const Alavancagem = lazy(() => import('./pages/Alavancagem'));
const AdminChargebacks = lazy(() => import('./pages/AdminChargebacks'));
const Login = lazy(() => import('./pages/Login'));
const CompletarCadastro = lazy(() => import('./pages/CompletarCadastro'));
const RedefinirSenha = lazy(() => import('./pages/RedefinirSenha'));
const Checkout = lazy(() => import('./pages/Checkout'));
const Admin = lazy(() => import('./pages/Admin'));
const AdminFinanceiro = lazy(() => import('./pages/AdminFinanceiro'));
const MapaImoveis = lazy(() => import('./pages/MapaImoveis'));
const Promo = lazy(() => import('./pages/Promo'));
const Convite = lazy(() => import('./pages/Convite'));
const ConviteEquipe = lazy(() => import('./pages/ConviteEquipe'));
const AdvogadoPortal = lazy(() => import('./pages/AdvogadoPortal'));
const ConviteLeiloeiro = lazy(() => import('./pages/ConviteLeiloeiro'));
const LeiloeiroPortal = lazy(() => import('./pages/LeiloeiroPortal'));
const EbookPage = lazy(() => import('./pages/EbookPage'));
const ContratoLink = lazy(() => import('./pages/ContratoLink'));
const TestemunhaLink = lazy(() => import('./pages/TestemunhaLink'));
const ProdutoLanding = lazy(() => import('./pages/ProdutoLanding'));
const ProdutoPublico = lazy(() => import('./pages/ProdutoPublico'));
const LiveInscricao = lazy(() => import('./pages/LiveInscricao'));
const CancelarAlertas = lazy(() => import('./pages/CancelarAlertas'));
// Tela que abre NO CELULAR pelo QR code do desktop (envio de foto). Pública de propósito: o
// telefone não tem sessão — quem autoriza é o código de uso único do QR, validado no servidor.
const ContinuarCaptura = lazy(() => import('./pages/ContinuarCaptura'));
const Perfil = lazy(() => import('./pages/Perfil'));
const Creditos = lazy(() => import('./pages/Creditos'));
const Comissoes = lazy(() => import('./pages/Comissoes'));
const Caso = lazy(() => import('./pages/Caso'));
const CriarContrato = lazy(() => import('./pages/CriarContrato'));
const ContratosTemplates = lazy(() => import('./pages/ContratosTemplates'));
const OnrRegistro = lazy(() => import('./pages/OnrRegistro'));
const Festa = lazy(() => import('./pages/Festa'));

// Fallback enquanto o chunk da página carrega (rápido; só na 1ª visita de cada tela).
function PageLoading() {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 30, height: 30, border: '3px solid #e2e8f0', borderTopColor: '#0D63DB', borderRadius: '50%', animation: 'tsnspin 0.7s linear infinite' }} />
      <style>{'@keyframes tsnspin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

function ContaInativa() {
  const { user } = useAuth();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🔒</div>
        <h2 style={{ color: '#111111', marginBottom: 8, fontWeight: 900 }}>Conta inativa</h2>
        <p style={{ color: '#64748b', fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
          Sua conta está temporariamente inativa. Entre em contato com o suporte para reativá-la.
        </p>
        <button onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))}
          style={{ display: 'inline-block', padding: '12px 28px', background: '#0D63DB', color: 'white', borderRadius: 10, fontWeight: 700, fontSize: 15, border: 'none', cursor: 'pointer' }}>
          Falar com suporte
        </button>
        <div style={{ marginTop: 20, fontSize: 13, color: '#94a3b8' }}>
          Logado como: {user?.email}
        </div>
      </div>
    </div>
  );
}

/**
 * Popup de BÔNUS concedido. Recebe `bonus` (o valor real de perfis.bonus_mercado) — até 09/08
 * o texto era fixo e mentia duas vezes: dizia que o Explorador tem "3 análises por mês" (são 3
 * VITALÍCIAS, `amostra_mercado_usadas` não reseta) e estampava "5 análises por mês" numa caixa
 * grande, número que não vinha de lugar nenhum. Dois usuários com 1 bônus cada estavam a um
 * login de ver esse "5".
 */
function PopupBonusAnalises({ userId, bonus, onFechar }) {
  const [fechado, setFechado] = React.useState(false);
  // FILA DE MODAIS (15/08): tela inteira com fundo escuro, como o de boas-vindas. Sem a fila,
  // os dois se cobriam no primeiro acesso — o que o dono viu no celular.
  const minhaVez = useVezDoModal('bonus', !fechado);
  if (!minhaVez) return null;
  const n = Number(bonus || 0);

  function fechar() {
    setFechado(true);
    // Marca como exibido para não mostrar de novo
    import('./utils/supabase').then(({ supabase }) => {
      supabase.from('perfis').update({ bonus_exibido: true }).eq('id', userId);
    });
    if (onFechar) onFechar();
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9998, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: 'white', borderRadius: 20, padding: 36, maxWidth: 420, width: '100%', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)', position: 'relative' }}>
        <button onClick={fechar} style={{ position: 'absolute', top: 14, right: 16, background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        <div style={{ fontSize: 56, marginBottom: 12 }}>🎁</div>
        <h2 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: '0 0 10px' }}>Você ganhou análises extras!</h2>
        <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, margin: '0 0 24px' }}>
          Creditamos <strong style={{ color: '#0D63DB' }}>{n} {n === 1 ? 'análise' : 'análises'} de bônus</strong> na sua conta, além do que o seu plano já inclui.
        </p>
        <div style={{ background: '#eff6ff', borderRadius: 12, padding: '14px 20px', marginBottom: 24 }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#0D63DB' }}>{n}</div>
          <div style={{ fontSize: 13, color: '#3b82f6', fontWeight: 600 }}>{n === 1 ? 'análise de bônus' : 'análises de bônus'}</div>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 20px' }}>O bônus é usado depois que a cota do seu plano acaba, e não expira no fim do mês.</p>
        <button onClick={fechar} style={{ width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
          Começar a explorar →
        </button>
      </div>
    </div>
  );
}

// Popup de inadimplência: avisa que a cobrança falhou e pede regularização. Regra
// (decisão do dono): aparece UMA VEZ POR ACESSO e no máximo em 15 acessos — depois
// para de incomodar. O contador zera quando o usuário regulariza (ver MainLayout).
const INAD_AVISOS_KEY = 'bidpro_inad_avisos';   // total de acessos em que já avisamos
const INAD_SESSAO_KEY = 'bidpro_inad_sessao';   // já avisamos nesta sessão/acesso?
const INAD_MAX_AVISOS = 15;

function PopupInadimplente({ dias }) {
  const [mostrar, setMostrar] = React.useState(false);
  React.useEffect(() => {
    // Uma vez por acesso: se já mostramos nesta sessão, não repete ao navegar.
    let jaNestaSessao = false;
    try { jaNestaSessao = sessionStorage.getItem(INAD_SESSAO_KEY) === '1'; } catch {}
    if (jaNestaSessao) return;
    let contador = 0;
    try { contador = parseInt(localStorage.getItem(INAD_AVISOS_KEY) || '0', 10) || 0; } catch {}
    if (contador >= INAD_MAX_AVISOS) return; // já avisamos 15 acessos — não incomoda mais
    try { sessionStorage.setItem(INAD_SESSAO_KEY, '1'); } catch {}
    try { localStorage.setItem(INAD_AVISOS_KEY, String(contador + 1)); } catch {}
    setMostrar(true);
  }, []);

  if (!mostrar) return null;
  const critico = dias >= 5;

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => { if (e.target === e.currentTarget) setMostrar(false); }}>
      <div style={{ background: 'white', borderRadius: 18, padding: '28px 26px', width: '100%', maxWidth: 440, boxShadow: '0 24px 60px rgba(0,0,0,0.35)', textAlign: 'center' }}>
        <div style={{ fontSize: 44, marginBottom: 8 }}>{critico ? '🚫' : '⚠️'}</div>
        <div style={{ fontWeight: 900, fontSize: 19, color: '#111', marginBottom: 8 }}>Não conseguimos processar a cobrança</div>
        <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.6, marginBottom: 20 }}>
          A cobrança da sua assinatura não foi aprovada. Regularize o pagamento para manter seu acesso.
          {critico && <><br /><strong style={{ color: '#b91c1c' }}>Seu acesso foi reduzido ao plano gratuito até a regularização.</strong></>}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => setMostrar(false)} style={{ flex: 1, padding: '12px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', color: '#64748b', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Agora não</button>
          <a href="/#/planos" onClick={() => setMostrar(false)}
            style={{ flex: 2, padding: '12px', background: '#0D63DB', color: 'white', borderRadius: 10, fontWeight: 800, fontSize: 14, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Regularizar pagamento
          </a>
        </div>
      </div>
    </div>
  );
}

// A antiga página de detalhe do plano (/plano/:key) foi absorvida pelo Checkout,
// que já mostra apresentação, toggle de período, benefícios e o cadastro/pagamento.
// Mantemos a rota como redirect para não quebrar links antigos e preservar ?promo=.
function RedirectPlano() {
  const { key } = useParams();
  const { search } = useLocation();
  const extra = search && search.length > 1 ? '&' + search.slice(1) : '';
  return <Navigate to={`/checkout?plano=${key || 'top2'}${extra}`} replace />;
}

// Redireciona não-logados para /login preservando o destino
function PrivateRoute({ children, roles }) {
  const { isLoggedIn, role, loading, ativo } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!isLoggedIn) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  // Bloqueio de conta inativa é GLOBAL (rotas fora do MainLayout: /admin, /leiloeiro...)
  if (!ativo) return <ContaInativa />;
  // Cadastro incompleto NÃO redireciona mais: um popup (CompletarCadastroModal) pede os
  // dados que faltam UM POR VEZ, sobreposto ao app, sem tirar o usuário da tela.
  if (roles && !roles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

// Atendimento: equipe entra pelo ROLE; o parceiro comercial entra pela CAPACIDADE
// (perfis.vendedor_tipo='consultor' — o role do plano não muda, F4 de 21/08). A cerca
// de dados é a RLS (posse do lead); este gate só decide quem vê a tela.
function AtendimentoRota() {
  const { user, role } = useAuth();
  const [cap, setCap] = useState(undefined);   // undefined = sondando
  const ehEquipe = ['analista', 'consultor', 'admin', 'advogado'].includes(role);
  useEffect(() => {
    if (!user || ehEquipe) { setCap(null); return; }
    let vivo = true;
    supabase.from('perfis').select('vendedor_tipo').eq('id', user.id).maybeSingle()
      .then(({ data, error }) => { if (vivo) setCap(error ? null : (data?.vendedor_tipo || null)); })
      .catch(() => { if (vivo) setCap(null); });
    return () => { vivo = false; };
  }, [user, ehEquipe]);
  if (ehEquipe) return <Atendimento />;
  if (cap === undefined) return null;          // sondando — não decide ainda
  if (cap === 'consultor') return <Atendimento />;
  return <Navigate to="/" replace />;
}

// Imóvel: logado vê a página completa; VISITANTE (link compartilhado) vê o teaser
// embaçado com CTA de login/cadastro (ImovelGate), em vez de ser jogado direto no
// login. Depois de entrar, o ?next leva de volta a este mesmo imóvel.
function ImovelRota() {
  const { isLoggedIn, loading } = useAuth();
  if (loading) return null;
  if (!isLoggedIn) return <ImovelGate />;
  return <PrivateRoute><ImovelDetalhe /></PrivateRoute>;
}

function RouteTracker() {
  const loc = useLocation();
  useEffect(() => { trackPageView(loc.pathname); }, [loc.pathname]);
  // Toda troca de rota começa no TOPO da página. Sem isso, o React Router mantém a
  // rolagem da tela anterior e a nova página abre "no meio". Cobre TODAS as telas.
  useEffect(() => {
    window.scrollTo(0, 0);
    // alguns containers têm rolagem própria; garante o topo após o paint
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }, [loc.pathname, loc.search]);
  return null;
}

function MainLayout() {
  const { ativo, isLoggedIn, inadimplenteDias, role, loading, user, roleSimulado } = useAuth();
  const loc = useLocation();
  const [showBonus, setShowBonus] = useState(false);

  useEffect(() => {
    // LIMPAR no logout/troca de usuário, não só "não buscar": o `return` puro deixava o
    // showBonus do usuário anterior vivo no estado — deslogar com o popup pendente derrubava
    // o shell inteiro com `user.id` de null (o TypeError da home de 20/08 e do /imovel/:id de
    // 13/08, mesmo erro em builds diferentes), e o próximo login no mesmo mount herdaria um
    // bônus que não era dele.
    if (!isLoggedIn || role !== 'explorador' || !user?.id) { setShowBonus(false); return; }
    let vivo = true;
    supabase.from('perfis').select('bonus_mercado, bonus_exibido').eq('id', user.id).single()
      .then(({ data }) => {
        if (vivo && data?.bonus_mercado > 0 && !data?.bonus_exibido) setShowBonus(data.bonus_mercado);
      });
    return () => { vivo = false; };
  }, [isLoggedIn, role, user?.id]);

  // Regularizou (não está mais inadimplente): zera o contador de avisos, para uma
  // futura inadimplência recomeçar os 15 acessos do zero.
  useEffect(() => {
    if (isLoggedIn && inadimplenteDias === 0) {
      try { localStorage.removeItem('bidpro_inad_avisos'); sessionStorage.removeItem('bidpro_inad_sessao'); } catch {}
    }
  }, [isLoggedIn, inadimplenteDias]);

  // (A coleta client-side dos leiloeiros Vlance passou para o AuthContext: dispara no login
  // — SIGNED_IN/INITIAL_SESSION — independente da rota, cobrindo /admin e o PWA. Antes vivia
  // aqui num useEffect do MainLayout, que não monta em /admin, então não disparava.)

  if (isLoggedIn && !loading && !ativo) return <ContaInativa />;
  if (isLoggedIn && !loading) {
    // O admin/dono entra pela HOME normal (como um cliente) e acessa o painel pelo botão
    // "⚙️ Admin" do menu (→ /admin). Antes havia um redirect forçado de "/" → "/admin".
    // Em SIMULAÇÃO este desvio não vale: o pedido do dono é "parar na TELA INICIAL independente
    // do nível de usuário". Sem a exceção, escolher analista/consultor/advogado no simulador
    // jogava direto no Atendimento e a home daquele papel — que é o que se foi ver — nunca
    // aparecia. Para o profissional de verdade o desvio continua: ele entra para trabalhar.
    if (!roleSimulado && ['analista','consultor','advogado'].includes(role) && loc.pathname === '/') return <Navigate to="/atendimento" replace />;
  }
  return (
    <div style={{ minHeight: '100dvh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column' }}>
      <Header />
      {isLoggedIn && inadimplenteDias > 0 && <PopupInadimplente dias={inadimplenteDias} />}
      {/* `user &&` além do estado: o popup depende de user.id e o showBonus é assíncrono —
          sem o guard, a corrida logout×estado quebra o shell em QUALQUER rota. */}
      {showBonus && user && <PopupBonusAnalises userId={user.id} bonus={showBonus} onFechar={() => setShowBonus(false)} />}
      {isLoggedIn && <TourGuia />}
      {user && <ContratoObrigatorio userId={user.id} />}
      {user && <CompletarCadastroModal />}
      {user && <KycParceiroModal />}
      {user && <TermosAtualizadosModal />}
      {user && <ToastRelatorioPronto />}
      {/* Boas-vindas: entra por ULTIMO entre os modais para nunca cobrir uma pendência
          que trava a conta (contrato, cadastro, KYC, termos). Ele mesmo se cala quando a
          pessoa já assistiu — ver o componente. */}
      {user && <BoasVindasModal />}
      {isLoggedIn && <SugestaoImovel />}
      <ChatSuporte />
      <main style={{ flex: 1 }}>
        <Suspense fallback={<PageLoading />}>
        <Routes>
          {/* Visitante vê a Landing de marketing; cliente logado vê a Home por plano.
              ENQUANTO O AUTH NÃO RESOLVE, NÃO SE DECIDE (15/08). Esta era a única decisão de
              conteúdo do arquivo que olhava só `isLoggedIn` e ignorava `loading` — o
              PrivateRoute e o ImovelRota logo acima já esperavam. Como `loading` começa
              `true` e `getSession()` é assíncrono, `isLoggedIn` vale `false` no primeiro
              render: quem estava logado via a LANDING DE VISITANTE por um instante e a tela
              trocava sozinha — no login, no F5 e ao reabrir o PWA. Parecia bug porque, do
              lado de quem acabou de entrar, é exatamente o que um login falho pareceria.
              Custo do spinner para o visitante: nenhum na prática — sem sessão o
              AuthContext faz `setLoading(false)` sem ir à rede (lê o localStorage). */}
          <Route path="/" element={loading ? <PageLoading /> : (isLoggedIn ? <HomeCliente /> : <Landing />)} />
          <Route path="/planos" element={<Planos />} />
          {/* Alavancagem (Home Equity + Consórcio) — pública, e de propósito NÃO linkada em
              menu nenhum até o dono aprovar a página (pedido dele, 14/08). O botão na tela
              inicial entra depois da aprovação. */}
          <Route path="/alavancagem" element={<Alavancagem />} />
          <Route path="/plano/:key" element={<RedirectPlano />} />
          <Route path="/buscar" element={<PrivateRoute><Busca /></PrivateRoute>} />
          <Route path="/completar-cadastro" element={<PrivateRoute><CompletarCadastro /></PrivateRoute>} />
          <Route path="/imovel/:id" element={<ImovelRota />} />
          <Route path="/mapa" element={<PrivateRoute><MapaImoveis /></PrivateRoute>} />
          <Route path="/analise" element={<PrivateRoute><Analise /></PrivateRoute>} />
          <Route path="/analises" element={<PrivateRoute><MinhasAnalises /></PrivateRoute>} />
          <Route path="/arrematados" element={<PrivateRoute><Arrematados /></PrivateRoute>} />
          <Route path="/caso" element={<PrivateRoute><Caso /></PrivateRoute>} />
          <Route path="/caso/:id" element={<PrivateRoute><Caso /></PrivateRoute>} />
          <Route path="/painel" element={<PrivateRoute><Painel /></PrivateRoute>} />
          {/* Sem gate por papel: a capacidade de vender pode estar em qualquer papel
              (cliente pagante ou equipe). O componente autoriza por papel OU vendedor_tipo. */}
          {/* Consultor APOSENTADO (o MLM/Programa de Parceiros o substitui): a rota redireciona
              para Minha Rede. /afiliado segue ativo (papel profissional distinto). */}
          <Route path="/consultor" element={<Navigate to="/minha-rede" replace />} />
          <Route path="/afiliado" element={<Navigate to="/minha-rede" replace />} />
          <Route path="/minha-rede" element={<PrivateRoute><MinhaRede /></PrivateRoute>} />
          {/* Área do parceiro comercial (consórcio/home equity). SEM filtro de role aqui:
              o acesso é CAPACIDADE (perfis.vendedor_tipo='consultor'), não role — quem
              decide é a RPC comercial_gate no servidor; sem acesso, a tela explica. */}
          <Route path="/comercial" element={<PrivateRoute><Comercial /></PrivateRoute>} />
          <Route path="/ativar-vendedor/:token" element={<AtivarVendedor />} />
          <Route path="/contratos" element={<PrivateRoute><Contratos /></PrivateRoute>} />
          <Route path="/contratos/novo" element={<PrivateRoute roles={['admin','consultor','analista','advogado']}><CriarContrato /></PrivateRoute>} />
          <Route path="/contratos/templates" element={<PrivateRoute roles={['admin']}><ContratosTemplates /></PrivateRoute>} />
          <Route path="/registro-imovel" element={<PrivateRoute roles={['admin','analista','advogado','consultor']}><OnrRegistro /></PrivateRoute>} />
          <Route path="/registro-imovel/:imovelId" element={<PrivateRoute roles={['admin','analista','advogado','consultor']}><OnrRegistro /></PrivateRoute>} />
          <Route path="/calculadora" element={<Calculadora />} />
          <Route path="/indice" element={<PrivateRoute><IndiceConsulta /></PrivateRoute>} />
          <Route path="/p/curso/:id" element={<ProdutoPublico tipo="curso" />} />
          {/* Landing da aula ao vivo: pública, sem login, é a porta de entrada da campanha */}
          <Route path="/live/:slug" element={<LiveInscricao />} />
          <Route path="/p/ebook/:id" element={<ProdutoPublico tipo="ebook" />} />
          <Route path="/membros" element={<PrivateRoute><Membros /></PrivateRoute>} />
          <Route path="/cliente-360" element={<PrivateRoute roles={['admin','analista']}><Cliente360 /></PrivateRoute>} />
          <Route path="/membros/curso/:id" element={<PrivateRoute><Curso /></PrivateRoute>} />
          <Route path="/membros/ebook/:id" element={<PrivateRoute><EbookPage /></PrivateRoute>} />
          <Route path="/chamados" element={<PrivateRoute><MeusChamados /></PrivateRoute>} />
          <Route path="/perfil" element={<PrivateRoute><Perfil /></PrivateRoute>} />
          <Route path="/creditos" element={<PrivateRoute><Creditos /></PrivateRoute>} />
          {/* Comissões: qualquer usuário autenticado vê as PRÓPRIAS comissões/saldo/PIX (o
              MLM abrange clientes pagantes, não só equipe). A página é escopada ao user.id. */}
          <Route path="/comissoes" element={<PrivateRoute><Comissoes /></PrivateRoute>} />
          <Route path="/admin/chargebacks" element={<PrivateRoute roles={['admin']}><AdminChargebacks /></PrivateRoute>} />
          <Route path="/atendimento" element={<PrivateRoute><AtendimentoRota /></PrivateRoute>} />
          <Route path="/advogado" element={<PrivateRoute roles={['advogado','admin']}><AdvogadoPortal /></PrivateRoute>} />
          <Route path="/termos" element={<Termos />} />
          {/* Pesquisa de satisfação (NPS) do cliente de consórcio/home equity — PÚBLICA:
              a credencial é o token do e-mail, sem login (F5 do plano comercial). */}
          <Route path="/nps" element={<NpsAlavancagem />} />
          <Route path="/privacidade" element={<Privacidade />} />
          <Route path="/cancelar-alertas" element={<CancelarAlertas />} />
          <Route path="/continuar/:codigo" element={<ContinuarCaptura />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>
      {/* A Landing pré-login já tem rodapé PRÓPRIO (completo). Sem esta condição, o layout
          empilhava DOIS rodapés na home do visitante — o próprio + este global — com uma
          faixa clara entre eles ("excesso no fim da página"). Demais telas usam este. */}
      {!(loc.pathname === '/' && !isLoggedIn) && <Footer />}
    </div>
  );
}

// Botão VOLTAR global (pedido do dono): a navegação profunda (Admin → ficha do caso →
// análise → …) ganha um retorno de 1 toque sem depender do botão do navegador. Aparece
// só quando HÁ tela anterior DENTRO do app (history.state.idx > 0 — quem entra por link
// direto não vê) e fora da home/login. Canto inferior ESQUERDO (o chat de suporte ocupa
// o direito). History API padrão — funciona em qualquer navegador/dispositivo.
// TELAS QUE JÁ TÊM O SEU PRÓPRIO "voltar" no topo não ganham o flutuante (14/08, dono:
// "se na tela já tem um botão de voltar em cima não faz sentido nenhum botão de voltar embaixo
// de novo"). Duplicar o mesmo comando em dois cantos da tela não ajuda ninguém — e no celular
// o de baixo ainda tapava a barra de ações do imóvel.
const TEM_VOLTAR_PROPRIO = ['/imovel/', '/analise', '/caso'];

function BotaoVoltar() {
  const nav = useNavigate();
  const loc = useLocation();
  const idx = window.history.state?.idx ?? 0;
  if (idx <= 0 || ['/', '/login'].includes(loc.pathname)) return null;
  if (TEM_VOLTAR_PROPRIO.some((r) => loc.pathname.startsWith(r))) return null;
  return (
    <button onClick={() => nav(-1)} aria-label="Voltar à tela anterior"
      // `--barra-acoes-altura` é declarada pela tela que tem barra fixa embaixo (hoje o imóvel,
      // no celular). Sem ela a variável não existe e o fallback 0px mantém o botão onde estava.
      // Assim o flutuante SOBE em vez de tapar a barra, e qualquer tela futura com barra fixa
      // só precisa declarar a variável — nada aqui muda.
      style={{ position: 'fixed', bottom: 'calc(18px + var(--barra-acoes-altura, 0px))', left: 18, zIndex: 1200, display: 'flex', alignItems: 'center', gap: 6,
        padding: '10px 16px', borderRadius: 999, border: '1px solid #e2e8f0', background: 'rgba(255,255,255,0.96)',
        color: '#0D63DB', fontSize: 13, fontWeight: 800, cursor: 'pointer', boxShadow: '0 4px 14px rgba(15,23,42,0.18)' }}>
      ← Voltar
    </button>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <RouteTracker />
        <BotaoVoltar />
        <PwaInstall />
        <PlanosProvider>
        <AnalisesProvider>
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/redefinir-senha" element={<RedefinirSenha />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/admin" element={<PrivateRoute roles={['admin']}><Admin /></PrivateRoute>} />
          <Route path="/admin/financeiro" element={<PrivateRoute roles={['admin']}><AdminFinanceiro /></PrivateRoute>} />
          <Route path="/promo/:codigo" element={<Promo />} />
          <Route path="/convite/:codigo" element={<Convite />} />
          <Route path="/convite-equipe/:token" element={<ConviteEquipe />} />
          <Route path="/cadastro-parceiro/:token" element={<ConviteLeiloeiro />} />
          <Route path="/leiloeiro/:token" element={<ConviteLeiloeiro />} />
          <Route path="/leiloeiro" element={<PrivateRoute roles={['leiloeiro','admin']}><LeiloeiroPortal /></PrivateRoute>} />
          <Route path="/festa" element={<Festa />} />
          <Route path="/c/:token" element={<ContratoLink />} />
          <Route path="/t/:token" element={<TestemunhaLink />} />
          {/* Páginas PÚBLICAS de eBook/Curso (preço + aquisição). Precisam estar no router
              de TOPO senão o /p/:tipo/:id (ProdutoLanding, sem tratamento) as sombreava →
              "Produto não encontrado". A rota estática vence a dinâmica. */}
          <Route path="/p/ebook/:id" element={<ProdutoPublico tipo="ebook" />} />
          <Route path="/p/curso/:id" element={<ProdutoPublico tipo="curso" />} />
          <Route path="/p/:tipo/:id" element={<ProdutoLanding />} />
          <Route path="*" element={<MainLayout />} />
        </Routes>
        </Suspense>
        </AnalisesProvider>
        </PlanosProvider>
      </HashRouter>
    </AuthProvider>
  );
}
