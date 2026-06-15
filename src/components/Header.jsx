import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, Search, LayoutDashboard, Home, Menu, X, ChevronRight, GraduationCap, User, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

export default function Header() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, role } = useAuth();
  const [open, setOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const links = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/buscar', label: 'Leilões', icon: Search },
    { path: '/membros', label: 'Área de Membros', icon: GraduationCap },
    { path: '/painel', label: 'Meu Painel', icon: LayoutDashboard },
  ];

  const active = (p) => loc.pathname === p;

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowUserMenu(false);
    nav('/');
  };

  const nomeUsuario = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Usuário';

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

          {role === 'admin' && (
            <button onClick={() => nav('/admin')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/admin') ? '#7c3aed' : '#7c3aed22', color: '#c4b5fd', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ⚙️ Admin
            </button>
          )}

          <button onClick={() => nav('/analise')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, padding: '8px 16px', border: 'none', borderRadius: 8, background: '#2563eb', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
            Fazer Análise <ChevronRight size={14} />
          </button>

          {/* Usuário */}
          {user ? (
            <div style={{ position: 'relative', marginLeft: 4 }}>
              <button onClick={() => setShowUserMenu(p => !p)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: '1px solid #334155', borderRadius: 8, background: 'transparent', color: 'white', cursor: 'pointer' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                  {nomeUsuario[0].toUpperCase()}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeUsuario}</span>
              </button>
              {showUserMenu && (
                <div style={{ position: 'absolute', right: 0, top: '110%', background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '8px', minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 200 }}>
                  <div style={{ padding: '8px 12px', fontSize: 12, color: '#64748b', borderBottom: '1px solid #f1f5f9', marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, color: '#0f172a' }}>{nomeUsuario}</div>
                    <div style={{ fontSize: 11 }}>{user.email}</div>
                    <div style={{ fontSize: 10, background: '#f1f5f9', borderRadius: 4, padding: '2px 6px', marginTop: 4, display: 'inline-block', fontWeight: 700, textTransform: 'uppercase' }}>{role}</div>
                  </div>
                  <button onClick={handleLogout}
                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 13, fontWeight: 600, borderRadius: 8 }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fef2f2'}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                    <LogOut size={14} /> Sair
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => nav('/login')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4, padding: '7px 14px', border: '1px solid #334155', borderRadius: 8, background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              <User size={14} /> Entrar
            </button>
          )}
        </nav>

        {/* Mobile menu button */}
        <button onClick={() => setOpen(!open)} style={{ display: 'none', background: 'none', border: 'none', color: 'white', cursor: 'pointer' }} className="show-mobile">
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div style={{ background: '#0f172a', borderTop: '1px solid #1e293b', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {links.map(l => (
            <button key={l.path} onClick={() => { nav(l.path); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: active(l.path) ? '#1e40af' : 'transparent', color: active(l.path) ? 'white' : '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              <l.icon size={16} /> {l.label}
            </button>
          ))}
          {user
            ? <button onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#ef4444', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                <LogOut size={16} /> Sair
              </button>
            : <button onClick={() => { nav('/login'); setOpen(false); }} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
                <User size={16} /> Entrar / Cadastrar
              </button>
          }
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
