import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, Search, LayoutDashboard, Home, Menu, X, ChevronRight } from 'lucide-react';

export default function Header() {
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);

  const links = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/buscar', label: 'Buscar Leilões', icon: Search },
    { path: '/painel', label: 'Meu Painel', icon: LayoutDashboard },
  ];

  const active = (p) => loc.pathname === p;

  return (
    <header style={{ background: '#0f172a', borderBottom: '1px solid #1e293b', position: 'sticky', top: 0, zIndex: 100 }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 20px', height: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {/* Logo */}
        <button onClick={() => nav('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ background: '#2563eb', borderRadius: 8, padding: '6px 8px', display: 'flex' }}>
            <Briefcase size={18} color="white" />
          </div>
          <div>
            <div style={{ color: 'white', fontWeight: 900, fontSize: 16, lineHeight: 1, letterSpacing: '-0.5px' }}>TSN ATIVOS</div>
            <div style={{ color: '#475569', fontSize: 8, fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
          </div>
        </button>

        {/* Nav desktop */}
        <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }} className="hide-mobile">
          {links.map(l => (
            <button key={l.path} onClick={() => nav(l.path)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active(l.path) ? '#1e40af' : 'transparent', color: active(l.path) ? 'white' : '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s' }}>
              <l.icon size={14} /> {l.label}
            </button>
          ))}
          <button onClick={() => nav('/analise')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, padding: '8px 16px', border: 'none', borderRadius: 8, background: '#2563eb', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Fazer Análise <ChevronRight size={14} />
          </button>
        </nav>

        {/* Mobile menu */}
        <button onClick={() => setOpen(!open)} style={{ display: 'none', background: 'none', border: 'none', color: 'white', cursor: 'pointer' }} className="show-mobile">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {open && (
        <div style={{ background: '#0f172a', borderTop: '1px solid #1e293b', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {links.map(l => (
            <button key={l.path} onClick={() => { nav(l.path); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: active(l.path) ? '#1e40af' : 'transparent', color: active(l.path) ? 'white' : '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              <l.icon size={16} /> {l.label}
            </button>
          ))}
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .hide-mobile { display: none !important; }
          .show-mobile { display: flex !important; }
        }
      `}</style>
    </header>
  );
}
