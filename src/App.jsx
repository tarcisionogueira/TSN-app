import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { AuthProvider } from './contexts/AuthContext';
import Header from './components/Header';
import Footer from './components/Footer';
import TourGuia from './components/TourGuia';
import Landing from './pages/Landing';
import Termos from './pages/Termos';
import Privacidade from './pages/Privacidade';
import Busca from './pages/Busca';
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
import EbookPage from './pages/EbookPage';
import ContratoLink from './pages/ContratoLink';
import ProdutoLanding from './pages/ProdutoLanding';

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

function MainLayout() {
  const { ativo, isLoggedIn, inadimplenteDias } = useAuth();
  if (isLoggedIn && !ativo) return <ContaInativa />;
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column' }}>
      <Header />
      {isLoggedIn && inadimplenteDias > 0 && <PopupInadimplente dias={inadimplenteDias} />}
      {isLoggedIn && <TourGuia />}
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/planos" element={<Planos />} />
          <Route path="/buscar" element={<Busca />} />
          <Route path="/analise" element={<Analise />} />
          <Route path="/painel" element={<Painel />} />
          <Route path="/consultor" element={<Consultor />} />
          <Route path="/contratos" element={<Contratos />} />
          <Route path="/calculadora" element={<Calculadora />} />
          <Route path="/membros" element={<Membros />} />
          <Route path="/membros/curso/:id" element={<Curso />} />
          <Route path="/membros/ebook/:id" element={<EbookPage />} />
          <Route path="/termos" element={<Termos />} />
          <Route path="/privacidade" element={<Privacidade />} />
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
          <Route path="/c/:token" element={<ContratoLink />} />
          <Route path="/p/:tipo/:id" element={<ProdutoLanding />} />
          <Route path="*" element={<MainLayout />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
