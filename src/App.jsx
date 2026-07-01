import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { trackPageView } from './utils/gtag';
import { supabase } from './utils/supabase';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import { PlanosProvider } from './contexts/PlanosContext';
import { AnalisesProvider } from './contexts/AnalisesContext';
import Header from './components/Header';
import Footer from './components/Footer';
import TourGuia from './components/TourGuia';
import ContratoObrigatorio from './components/ContratoObrigatorio';
import ChatSuporte from './components/ChatSuporte';
import Landing from './pages/Landing';
import MeusChamados from './pages/MeusChamados';
import Atendimento from './pages/Atendimento';
import Termos from './pages/Termos';
import Privacidade from './pages/Privacidade';
import Busca from './pages/Busca';
import ImovelDetalhe from './pages/ImovelDetalhe';
import Analise from './pages/Analise';
import MinhasAnalises from './pages/MinhasAnalises';
import Painel from './pages/Painel';
import Consultor from './pages/Consultor';
import Contratos from './pages/Contratos';
import Calculadora from './pages/Calculadora';
import Membros from './pages/Membros';
import Curso from './pages/Curso';
import Planos from './pages/Planos';
import AdminChargebacks from './pages/AdminChargebacks';
import Login from './pages/Login';
import CompletarCadastro from './pages/CompletarCadastro';
import RedefinirSenha from './pages/RedefinirSenha';
import Checkout from './pages/Checkout';
import Admin from './pages/Admin';
import AdminFinanceiro from './pages/AdminFinanceiro';
import MapaImoveis from './pages/MapaImoveis';
import Promo from './pages/Promo';
import Convite from './pages/Convite';
import ConviteEquipe from './pages/ConviteEquipe';
import AdvogadoPortal from './pages/AdvogadoPortal';
import ConviteLeiloeiro from './pages/ConviteLeiloeiro';
import LeiloeiroPortal from './pages/LeiloeiroPortal';
import EbookPage from './pages/EbookPage';
import ContratoLink from './pages/ContratoLink';
import ProdutoLanding from './pages/ProdutoLanding';
import ProdutoPublico from './pages/ProdutoPublico';
import CancelarAlertas from './pages/CancelarAlertas';
import Perfil from './pages/Perfil';
import Comissoes from './pages/Comissoes';
import Caso from './pages/Caso';
import CriarContrato from './pages/CriarContrato';
import ContratosTemplates from './pages/ContratosTemplates';
import OnrRegistro from './pages/OnrRegistro';
import Festa from './pages/Festa';

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

function PopupBonusAnalises({ userId, onFechar }) {
  const [fechado, setFechado] = React.useState(false);
  if (fechado) return null;

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
        <h2 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: '0 0 10px' }}>Bem-vindo ao BidPro Brasil!</h2>
        <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, margin: '0 0 24px' }}>
          Seu plano <strong style={{ color: '#0D63DB' }}>Explorador</strong> inclui <strong style={{ color: '#0D63DB' }}>5 análises Mercadológicas + Viabilidade por mês</strong>, de graça, para você avaliar imóveis em leilão.
        </p>
        <div style={{ background: '#eff6ff', borderRadius: 12, padding: '14px 20px', marginBottom: 24 }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#0D63DB' }}>5</div>
          <div style={{ fontSize: 13, color: '#3b82f6', fontWeight: 600 }}>análises por mês</div>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 20px' }}>Faça upgrade para o plano Investidor Pro e ganhe 20 análises mensais com relatório jurídico completo.</p>
        <button onClick={fechar} style={{ width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
          Começar a explorar →
        </button>
      </div>
    </div>
  );
}

function PopupInadimplente({ dias }) {
  const [fechado, setFechado] = React.useState(false);
  if (fechado) return null;

  const diasRestantes = Math.max(0, 5 - dias);
  const critico = dias >= 5;

  return (
    <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9999, maxWidth: 480, width: 'calc(100% - 32px)' }}>
      <div style={{ background: critico ? '#7f1d1d' : '#78350f', color: 'white', borderRadius: 14, padding: '16px 20px', boxShadow: '0 12px 40px rgba(0,0,0,0.4)', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ fontSize: 28, flexShrink: 0 }}>{critico ? '🚫' : '⚠️'}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
            {critico ? 'Acesso reduzido por inadimplência' : `Pagamento em aberto — ${diasRestantes} dia${diasRestantes !== 1 ? 's' : ''} para regularizar`}
          </div>
          <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.5 }}>
            {critico
              ? 'Seu acesso foi reduzido ao plano gratuito. Regularize o pagamento para restaurar seu plano.'
              : 'Existe uma cobrança em aberto na sua conta. Regularize para manter acesso completo.'}
          </div>
          <a href="/#/planos"
            style={{ display: 'inline-block', marginTop: 10, padding: '7px 16px', background: 'white', color: critico ? '#7f1d1d' : '#78350f', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            Regularizar pagamento
          </a>
        </div>
        <button onClick={() => setFechado(true)} style={{ background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer', opacity: 0.7, padding: 0, flexShrink: 0 }}>✕</button>
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
  const { isLoggedIn, role, loading, ativo, cadastroIncompleto } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!isLoggedIn) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  // Bloqueio de conta inativa é GLOBAL (rotas fora do MainLayout: /admin, /leiloeiro...)
  if (!ativo) return <ContaInativa />;
  // Cadastro incompleto (ex.: login Google sem CPF/LGPD) → completar antes de usar o app
  if (cadastroIncompleto && loc.pathname !== '/completar-cadastro') return <Navigate to="/completar-cadastro" replace />;
  if (roles && !roles.includes(role)) return <Navigate to="/" replace />;
  return children;
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
  const { ativo, isLoggedIn, inadimplenteDias, role, loading, user } = useAuth();
  const loc = useLocation();
  const [showBonus, setShowBonus] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || role !== 'explorador' || !user?.id) return;
    supabase.from('perfis').select('bonus_mercado, bonus_exibido').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.bonus_mercado > 0 && !data?.bonus_exibido) setShowBonus(true);
      });
  }, [isLoggedIn, role, user?.id]);

  if (isLoggedIn && !loading && !ativo) return <ContaInativa />;
  if (isLoggedIn && !loading) {
    if (role === 'admin' && loc.pathname === '/') return <Navigate to="/admin" replace />;
    if (['analista','consultor','advogado'].includes(role) && loc.pathname === '/') return <Navigate to="/atendimento" replace />;
  }
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column' }}>
      <Header />
      {isLoggedIn && inadimplenteDias > 0 && <PopupInadimplente dias={inadimplenteDias} />}
      {showBonus && <PopupBonusAnalises userId={user.id} onFechar={() => setShowBonus(false)} />}
      {isLoggedIn && <TourGuia />}
      {user && <ContratoObrigatorio userId={user.id} />}
      <ChatSuporte />
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/planos" element={<Planos />} />
          <Route path="/plano/:key" element={<RedirectPlano />} />
          <Route path="/buscar" element={<PrivateRoute><Busca /></PrivateRoute>} />
          <Route path="/completar-cadastro" element={<PrivateRoute><CompletarCadastro /></PrivateRoute>} />
          <Route path="/imovel/:id" element={<PrivateRoute><ImovelDetalhe /></PrivateRoute>} />
          <Route path="/mapa" element={<PrivateRoute><MapaImoveis /></PrivateRoute>} />
          <Route path="/analise" element={<PrivateRoute><Analise /></PrivateRoute>} />
          <Route path="/analises" element={<PrivateRoute><MinhasAnalises /></PrivateRoute>} />
          <Route path="/caso" element={<PrivateRoute><Caso /></PrivateRoute>} />
          <Route path="/caso/:id" element={<PrivateRoute><Caso /></PrivateRoute>} />
          <Route path="/painel" element={<PrivateRoute><Painel /></PrivateRoute>} />
          <Route path="/consultor" element={<PrivateRoute roles={['consultor','admin']}><Consultor /></PrivateRoute>} />
          <Route path="/contratos" element={<PrivateRoute><Contratos /></PrivateRoute>} />
          <Route path="/contratos/novo" element={<PrivateRoute roles={['admin','consultor','analista','advogado']}><CriarContrato /></PrivateRoute>} />
          <Route path="/contratos/templates" element={<PrivateRoute roles={['admin']}><ContratosTemplates /></PrivateRoute>} />
          <Route path="/registro-imovel" element={<PrivateRoute roles={['admin','analista','advogado','consultor']}><OnrRegistro /></PrivateRoute>} />
          <Route path="/registro-imovel/:imovelId" element={<PrivateRoute roles={['admin','analista','advogado','consultor']}><OnrRegistro /></PrivateRoute>} />
          <Route path="/calculadora" element={<Calculadora />} />
          <Route path="/p/curso/:id" element={<ProdutoPublico tipo="curso" />} />
          <Route path="/p/ebook/:id" element={<ProdutoPublico tipo="ebook" />} />
          <Route path="/membros" element={<PrivateRoute><Membros /></PrivateRoute>} />
          <Route path="/membros/curso/:id" element={<PrivateRoute><Curso /></PrivateRoute>} />
          <Route path="/membros/ebook/:id" element={<PrivateRoute><EbookPage /></PrivateRoute>} />
          <Route path="/chamados" element={<PrivateRoute><MeusChamados /></PrivateRoute>} />
          <Route path="/perfil" element={<PrivateRoute><Perfil /></PrivateRoute>} />
          <Route path="/comissoes" element={<PrivateRoute roles={['admin','consultor','analista','advogado']}><Comissoes /></PrivateRoute>} />
          <Route path="/admin/chargebacks" element={<PrivateRoute roles={['admin']}><AdminChargebacks /></PrivateRoute>} />
          <Route path="/atendimento" element={<PrivateRoute roles={['analista','consultor','admin','advogado']}><Atendimento /></PrivateRoute>} />
          <Route path="/advogado" element={<PrivateRoute roles={['advogado','admin']}><AdvogadoPortal /></PrivateRoute>} />
          <Route path="/termos" element={<Termos />} />
          <Route path="/privacidade" element={<Privacidade />} />
          <Route path="/cancelar-alertas" element={<CancelarAlertas />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <RouteTracker />
        <PlanosProvider>
        <AnalisesProvider>
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
          <Route path="/p/:tipo/:id" element={<ProdutoLanding />} />
          <Route path="*" element={<MainLayout />} />
        </Routes>
        </AnalisesProvider>
        </PlanosProvider>
      </HashRouter>
    </AuthProvider>
  );
}
