import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { supabase } from './utils/supabase';
import { useAuth, AuthProvider } from './contexts/AuthContext';
import Header from './components/Header';
import Footer from './components/Footer';
import TourGuia from './components/TourGuia';
import ChatSuporte from './components/ChatSuporte';
import Landing from './pages/Landing';
import MeusChamados from './pages/MeusChamados';
import Atendimento from './pages/Atendimento';
import Termos from './pages/Termos';
import Privacidade from './pages/Privacidade';
import Busca from './pages/Busca';
import ImovelDetalhe from './pages/ImovelDetalhe';
import Analise from './pages/Analise';
import Painel from './pages/Painel';
import Consultor from './pages/Consultor';
import Contratos from './pages/Contratos';
import Calculadora from './pages/Calculadora';
import Membros from './pages/Membros';
import Curso from './pages/Curso';
import Planos from './pages/Planos';
import Login from './pages/Login';
import Checkout from './pages/Checkout';
import Admin from './pages/Admin';
import Promo from './pages/Promo';
import Convite from './pages/Convite';
import ConviteEquipe from './pages/ConviteEquipe';
import EbookPage from './pages/EbookPage';
import ContratoLink from './pages/ContratoLink';
import ProdutoLanding from './pages/ProdutoLanding';
import CancelarAlertas from './pages/CancelarAlertas';
import Perfil from './pages/Perfil';

function ContaInativa() {
  const { user } = useAuth();
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9', padding: 20 }}>
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ fontSize: 52, marginBottom: 16 }}>🔒</div>
        <h2 style={{ color: '#0f172a', marginBottom: 8, fontWeight: 900 }}>Conta inativa</h2>
        <p style={{ color: '#64748b', fontSize: 15, lineHeight: 1.6, marginBottom: 24 }}>
          Sua conta está temporariamente inativa. Entre em contato com o suporte para reativá-la.
        </p>
        <a href="https://wa.me/5571996502234" target="_blank" rel="noreferrer"
          style={{ display: 'inline-block', padding: '12px 28px', background: '#25d366', color: 'white', borderRadius: 10, fontWeight: 700, textDecoration: 'none', fontSize: 15 }}>
          Falar com suporte no WhatsApp
        </a>
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
        <h2 style={{ fontSize: 22, fontWeight: 900, color: '#0f172a', margin: '0 0 10px' }}>Bônus de boas-vindas!</h2>
        <p style={{ fontSize: 15, color: '#475569', lineHeight: 1.6, margin: '0 0 24px' }}>
          Você ganhou <strong style={{ color: '#2563eb' }}>5 análises gratuitas</strong> para explorar a plataforma e conhecer o potencial de imóveis em leilão.
        </p>
        <div style={{ background: '#eff6ff', borderRadius: 12, padding: '14px 20px', marginBottom: 24 }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: '#2563eb' }}>5</div>
          <div style={{ fontSize: 13, color: '#3b82f6', fontWeight: 600 }}>análises disponíveis</div>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 20px' }}>Faça upgrade para o plano Investidor Pro e ganhe 20 análises mensais com relatório jurídico completo.</p>
        <button onClick={fechar} style={{ width: '100%', padding: '13px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>
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
          <a href="https://wa.me/5571996502234" target="_blank" rel="noreferrer"
            style={{ display: 'inline-block', marginTop: 10, padding: '7px 16px', background: 'white', color: critico ? '#7f1d1d' : '#78350f', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
            Regularizar pagamento
          </a>
        </div>
        <button onClick={() => setFechado(true)} style={{ background: 'none', border: 'none', color: 'white', fontSize: 18, cursor: 'pointer', opacity: 0.7, padding: 0, flexShrink: 0 }}>✕</button>
      </div>
    </div>
  );
}

// Redireciona não-logados para /login preservando o destino
function PrivateRoute({ children, roles }) {
  const { isLoggedIn, role, loading } = useAuth();
  const loc = useLocation();
  if (loading) return null;
  if (!isLoggedIn) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (roles && !roles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

function MainLayout() {
  const { ativo, isLoggedIn, inadimplenteDias, role, loading, user } = useAuth();
  const loc = useLocation();
  const [showBonus, setShowBonus] = useState(false);

  useEffect(() => {
    if (!isLoggedIn || role !== 'explorador' || !user?.id) return;
    supabase.from('perfis').select('analises_bonus, bonus_exibido').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.analises_bonus > 0 && !data?.bonus_exibido) setShowBonus(true);
      });
  }, [isLoggedIn, role, user?.id]);

  if (isLoggedIn && !ativo) return <ContaInativa />;
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
      <ChatSuporte />
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/planos" element={<Planos />} />
          <Route path="/buscar" element={<PrivateRoute><Busca /></PrivateRoute>} />
          <Route path="/imovel/:id" element={<PrivateRoute><ImovelDetalhe /></PrivateRoute>} />
          <Route path="/analise" element={<PrivateRoute><Analise /></PrivateRoute>} />
          <Route path="/painel" element={<PrivateRoute><Painel /></PrivateRoute>} />
          <Route path="/consultor" element={<PrivateRoute roles={['consultor','admin']}><Consultor /></PrivateRoute>} />
          <Route path="/contratos" element={<PrivateRoute><Contratos /></PrivateRoute>} />
          <Route path="/calculadora" element={<Calculadora />} />
          <Route path="/membros" element={<PrivateRoute><Membros /></PrivateRoute>} />
          <Route path="/membros/curso/:id" element={<PrivateRoute><Curso /></PrivateRoute>} />
          <Route path="/membros/ebook/:id" element={<PrivateRoute><EbookPage /></PrivateRoute>} />
          <Route path="/chamados" element={<PrivateRoute><MeusChamados /></PrivateRoute>} />
          <Route path="/perfil" element={<PrivateRoute><Perfil /></PrivateRoute>} />
          <Route path="/atendimento" element={<PrivateRoute roles={['analista','consultor','admin','advogado']}><Atendimento /></PrivateRoute>} />
          <Route path="/termos" element={<Termos />} />
          <Route path="/privacidade" element={<Privacidade />} />
          <Route path="/cancelar-alertas" element={<CancelarAlertas />} />
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
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/promo/:codigo" element={<Promo />} />
          <Route path="/convite/:codigo" element={<Convite />} />
          <Route path="/convite-equipe/:token" element={<ConviteEquipe />} />
          <Route path="/c/:token" element={<ContratoLink />} />
          <Route path="/p/:tipo/:id" element={<ProdutoLanding />} />
          <Route path="*" element={<MainLayout />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
