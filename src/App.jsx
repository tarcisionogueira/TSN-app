import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
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

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/promo/:codigo" element={<Promo />} />
          <Route path="*" element={
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
          } />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
