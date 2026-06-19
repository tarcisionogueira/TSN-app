import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, Search, LayoutDashboard, Home, Menu, X, ChevronRight, GraduationCap, User, LogOut, Tag, MessageSquare, FileText, Eye, Calculator } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

const FEEDBACK_KEY = 'tsn_feedback_email';
const DEFAULT_FEEDBACK_EMAIL = 'tarcisioaraujo@reimob.com.br';
function getEmailFeedback() { return localStorage.getItem(FEEDBACK_KEY) || DEFAULT_FEEDBACK_EMAIL; }

function ModalFeedback({ user, onClose }) {
  const [msg, setMsg] = React.useState('');
  const [enviado, setEnviado] = React.useState(false);
  const nome = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Visitante';
  const email = user?.email || '';

  function enviar() {
    if (!msg.trim()) return;
    const assunto = encodeURIComponent('[Feedback TSN Ativos]');
    const corpo = encodeURIComponent(msg + '\n\n---\nEnviado por: ' + nome + ' <' + email + '>');
    window.open('mailto:' + getEmailFeedback() + '?subject=' + assunto + '&body=' + corpo);
    setEnviado(true);
    setTimeout(onClose, 1500);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 16, padding: '28px 28px', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
        {enviado ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <p style={{ fontWeight: 700, color: '#0f172a', marginTop: 12 }}>Feedback enviado!</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Enviar Feedback</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            {user && (
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#64748b', marginBottom: 14 }}>
                <strong>{nome}</strong> · {email}
              </div>
            )}
            <textarea
              value={msg}
              onChange={e => setMsg(e.target.value)}
              placeholder="Descreva sua sugestão, problema ou elogio..."
              style={{ width: '100%', minHeight: 130, padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '10px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', color: '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={enviar} disabled={!msg.trim()} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: 8, background: '#0f172a', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: msg.trim() ? 1 : 0.5 }}>
                Enviar Feedback →
              </button>
            </div>
            <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 10 }}>
              Seu feedback será enviado para {getEmailFeedback()}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const ROLE_LABELS = {
  admin: 'Admin', explorador: 'Explorador', top1: 'Investidor',
  top2: 'Investidor Pro', assessorado: 'Assessorado',
  clube: 'Clube de Negócios', consultor: 'Consultor',
  analista: 'Analista', advogado: 'Advogado',
};

export default function Header() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, role, loading, impersonate, encerrarSuporte } = useAuth();
  const [open, setOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);

  const linksPublicos = [
    { path: '/', label: 'Home', icon: Home },
    { path: '/planos', label: 'Planos', icon: Tag },
  ];
  const ROLES_CALC = ['top1', 'top2', 'assessorado', 'clube', 'consultor', 'analista', 'advogado', 'admin'];
  const linksPrivados = [
    { path: '/buscar', label: 'Leilões', icon: Search },
    { path: '/membros', label: 'Área de Membros', icon: GraduationCap },
    ...(ROLES_CALC.includes(role) ? [{ path: '/calculadora', label: 'Calculadora', icon: Calculator }] : []),
  ];
  const links = user
    ? [linksPublicos[0], ...linksPrivados, linksPublicos[1]]
    : linksPublicos;

  const active = (p) => loc.pathname === p;

  const abrirFeedback = () => setShowFeedback(true);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowUserMenu(false);
    nav('/');
  };

  const nomeUsuario = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Usuário';

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 100 }}>
      {/* Banner do modo suporte (admin/analista visualizando a conta de um cliente) */}
      {impersonate && (
        <div style={{ background: '#d97706', color: 'white', padding: '7px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 13, fontWeight: 600, flexWrap: 'wrap' }}>
          <Eye size={15} /> Modo suporte — visualizando a conta de <strong>{impersonate.nome}</strong>
          <button onClick={encerrarSuporte}
            style={{ padding: '4px 12px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            Sair do modo suporte
          </button>
        </div>
      )}
      <div style={{ background: '#0f172a', borderBottom: '1px solid #1e293b' }}>
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

          {(role === 'consultor' || role === 'admin') && (
            <button onClick={() => nav('/consultor')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/consultor') ? '#059669' : '#05966922', color: '#6ee7b7', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              🤝 Consultor
            </button>
          )}

          {role === 'admin' && (
            <button onClick={() => nav('/admin')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/admin') ? '#7c3aed' : '#7c3aed22', color: '#c4b5fd', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ⚙️ Admin
            </button>
          )}

          <button onClick={abrirFeedback} title="Enviar feedback"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', border: 'none', borderRadius: 8, background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
            <MessageSquare size={14} /> Feedback
          </button>

          {user && (
            <button onClick={() => nav('/analise')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, padding: '8px 16px', border: 'none', borderRadius: 8, background: '#2563eb', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Fazer Análise <ChevronRight size={14} />
            </button>
          )}

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
                    {!loading && role && role !== 'aluno' && (
                      <div style={{ fontSize: 10, background: '#f1f5f9', borderRadius: 4, padding: '2px 6px', marginTop: 4, display: 'inline-block', fontWeight: 700, textTransform: 'uppercase' }}>
                        {ROLE_LABELS[role] || role}
                      </div>
                    )}
                  </div>
                  {[
                    { path: '/painel', label: 'Meu Painel', icon: LayoutDashboard },
                    { path: '/contratos', label: 'Meus Contratos', icon: FileText },
                    { path: '/planos', label: 'Minha Assinatura', icon: Tag },
                  ].map(item => (
                    <button key={item.path} onClick={() => { nav(item.path); setShowUserMenu(false); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#334155', fontSize: 13, fontWeight: 600, borderRadius: 8, textAlign: 'left' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <item.icon size={14} /> {item.label}
                    </button>
                  ))}
                  <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />
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
          {(role === 'consultor' || role === 'admin') && (
            <button onClick={() => { nav('/consultor'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#6ee7b7', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              🤝 Consultor
            </button>
          )}
          {role === 'admin' && (
            <button onClick={() => { nav('/admin'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#c4b5fd', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              ⚙️ Admin
            </button>
          )}
          <button onClick={() => { abrirFeedback(); setOpen(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
            <MessageSquare size={16} /> Feedback
          </button>
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

      {showFeedback && <ModalFeedback user={user} onClose={() => setShowFeedback(false)} />}

      <style>{`
        @media (max-width: 768px) {
          .hide-mobile { display: none !important; }
          .show-mobile { display: flex !important; }
        }
      `}</style>
    </header>
  );
}
