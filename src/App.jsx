import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { AuthProvider } from './contexts/AuthContext';
import Header from './components/Header';
import Footer from './components/Footer';
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
        <a href="https://wa.me/5511999999999" target="_blank" rel="noreferrer"
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

function MainLayout() {
  const { ativo, isLoggedIn } = useAuth();
  if (isLoggedIn && !ativo) return <ContaInativa />;
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif", display: 'flex', flexDirection: 'column' }}>
      <Header />
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
          <Route path="*" element={<MainLayout />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
