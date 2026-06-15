import React from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import Header from './components/Header';
import Landing from './pages/Landing';
import Busca from './pages/Busca';
import Analise from './pages/Analise';
import Painel from './pages/Painel';
import Membros from './pages/Membros';
import Curso from './pages/Curso';
import Login from './pages/Login';

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="*" element={
            <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif" }}>
              <Header />
              <main>
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/buscar" element={<Busca />} />
                  <Route path="/analise" element={<Analise />} />
                  <Route path="/painel" element={<Painel />} />
                  <Route path="/membros" element={<Membros />} />
                  <Route path="/membros/curso/:id" element={<Curso />} />
                </Routes>
              </main>
            </div>
          } />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
