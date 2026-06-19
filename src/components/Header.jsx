import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, Search, LayoutDashboard, Home, Menu, X, ChevronRight, GraduationCap, User, LogOut, Tag, MessageSquare, FileText, Eye, Calculator, HelpCircle } from 'lucide-react';
import TourGuiado, { TOUR_KEY_EXPORT as TOUR_KEY } from './TourGuiado';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

const FEEDBACK_KEY = 'tsn_feedback_email';
const DEFAULT_FEEDBACK_EMAIL = 'tarcisioaraujo@reimob.com.br';
function getEmailFeedback() { return localStorage.getItem(FEEDBACK_KEY) || DEFAULT_FEEDBACK_EMAIL; }

function ModalFeedback({ user, onClose }) {
  const [queixa, setQueixa] = React.useState('');
  const [solucao, setSolucao] = React.useState('');
  const [resolvido, setResolvido] = React.useState('');
  const [nps, setNps] = React.useState(null);
  const [enviando, setEnviando] = React.useState(false);
  const [enviado, setEnviado] = React.useState(false);
  const [erro, setErro] = React.useState('');
  const nome = user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Visitante';
  const email = user?.email || '';

  async function enviar() {
    if (!queixa.trim()) return;
    setEnviando(true); setErro('');
    try {
      const { error } = await supabase.from('feedbacks').insert({
        user_id: user?.id || null,
        user_nome: nome,
        user_email: email,
        queixa: queixa.trim(),
        solucao: solucao.trim() || null,
        resolvido: resolvido || null,
        nps: nps,
        status: 'novo',
      });
      if (error) throw error;
      setEnviado(true);
      setTimeout(onClose, 2000);
    } catch (e) {
      setErro('Não foi possível enviar. Tente novamente.');
    }
    setEnviando(false);
  }

  const inputStyle = { width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, resize: 'vertical', boxSizing: 'border-box', outline: 'none', fontFamily: 'inherit' };
  const npsColors = { 0:'#dc2626',1:'#dc2626',2:'#ef4444',3:'#f97316',4:'#f97316',5:'#eab308',6:'#eab308',7:'#84cc16',8:'#22c55e',9:'#16a34a',10:'#059669' };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'white', borderRadius: 16, padding: '28px 28px', width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.25)', maxHeight: '90vh', overflowY: 'auto' }}>
        {enviado ? (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <p style={{ fontWeight: 700, color: '#0f172a', marginTop: 12 }}>Feedback registrado!</p>
            <p style={{ fontSize: 13, color: '#64748b' }}>Obrigado. Nossa equipe vai analisar em breve.</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18, color: '#0f172a' }}>Enviar Feedback</h3>
              <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, lineHeight: 1 }}>✕</button>
            </div>
            {user && (
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#64748b', marginBottom: 16 }}>
                <strong>{nome}</strong> · {email}
              </div>
            )}
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>PROBLEMA / SUGESTÃO *</label>
              <textarea
                value={queixa}
                onChange={e => setQueixa(e.target.value)}
                placeholder="Descreva o problema ou sugestão com detalhes..."
                style={{ ...inputStyle, minHeight: 90 }}
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 }}>SOLUÇÃO SUGERIDA</label>
              <textarea
                value={solucao}
                onChange={e => setSolucao(e.target.value)}
                placeholder="O que resolveria? (opcional)"
                style={{ ...inputStyle, minHeight: 70 }}
              />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 8 }}>FOI RESOLVIDO?</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['Sim', 'Não', 'Em andamento'].map(op => (
                  <label key={op} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#374151', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, border: `1px solid ${resolvido === op ? '#2563eb' : '#e2e8f0'}`, background: resolvido === op ? '#eff6ff' : 'white', fontWeight: resolvido === op ? 700 : 400, textAlign: 'center' }}>
                    <input type="radio" name="resolvido" value={op} checked={resolvido === op} onChange={() => setResolvido(op)} style={{ display: 'none' }} />
                    {op}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 8 }}>SATISFAÇÃO GERAL (0–10)</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {Array.from({ length: 11 }, (_, i) => (
                  <button key={i} onClick={() => setNps(i)}
                    style={{ width: 34, height: 34, borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', background: nps === i ? (npsColors[i] || '#2563eb') : '#f1f5f9', color: nps === i ? 'white' : '#64748b' }}>
                    {i}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
                <span>Péssimo</span><span>Excelente</span>
              </div>
            </div>
            {erro && <div style={{ padding: '8px 12px', background: '#fee2e2', color: '#dc2626', borderRadius: 8, fontSize: 12, fontWeight: 600, marginBottom: 12 }}>{erro}</div>}
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '10px', border: '1px solid #e2e8f0', borderRadius: 8, background: 'white', color: '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                Cancelar
              </button>
              <button onClick={enviar} disabled={!queixa.trim() || enviando} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: 8, background: '#0f172a', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: queixa.trim() && !enviando ? 1 : 0.5 }}>
                {enviando ? 'Enviando…' : 'Enviar Feedback →'}
              </button>
            </div>
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
  const [showTour, setShowTour] = useState(false);

  const ROLES_CALC = ['top1', 'top2', 'assessorado', 'clube', 'consultor', 'analista', 'advogado', 'admin'];
  const linksPublicos = [
    { path: '/', label: 'Home', icon: Home, tourId: 'home' },
    { path: '/planos', label: 'Planos', icon: Tag, tourId: 'planos' },
  ];
  const linksPrivados = [
    { path: '/buscar', label: 'Leilões', icon: Search, tourId: 'leiloes' },
    { path: '/membros', label: 'Área de Membros', icon: GraduationCap, tourId: 'membros' },
    ...(ROLES_CALC.includes(role) ? [{ path: '/calculadora', label: 'Calculadora', icon: Calculator, tourId: 'calculadora' }] : []),
  ];
  const links = user
    ? [linksPublicos[0], ...linksPrivados, linksPublicos[1]]
    : linksPublicos;

  // Auto-inicia tour para membros não-admin: até 3x por mês, cooldown de 24h
  React.useEffect(() => {
    if (!user || role === 'admin') return;
    const agora = Date.now();
    const mesAtual = new Date().toISOString().slice(0, 7);
    const tourMesKey  = 'tsn_tour_mes';
    const tourCountKey = 'tsn_tour_count';
    const tourLastKey  = 'tsn_tour_last';
    const savedMes   = localStorage.getItem(tourMesKey);
    const savedCount = parseInt(localStorage.getItem(tourCountKey) || '0', 10);
    const savedLast  = parseInt(localStorage.getItem(tourLastKey) || '0', 10);
    // Reinicia contador no início de cada mês
    const countAtual = savedMes === mesAtual ? savedCount : 0;
    if (savedMes !== mesAtual) localStorage.setItem(tourMesKey, mesAtual);
    const COOLDOWN = 24 * 60 * 60 * 1000;
    if (countAtual < 3 && (agora - savedLast) >= COOLDOWN) {
      const timer = setTimeout(() => {
        setShowTour(true);
        localStorage.setItem(tourCountKey, String(countAtual + 1));
        localStorage.setItem(tourLastKey, String(agora));
        localStorage.setItem(tourMesKey, mesAtual);
      }, 1400);
      return () => clearTimeout(timer);
    }
  }, [user, role]);

  const active = (p) => loc.pathname === p;

  const abrirFeedback = () => setShowFeedback(true);

  React.useEffect(() => {
    const handler = () => setShowFeedback(true);
    const tourHandler = () => { localStorage.removeItem(TOUR_KEY); setShowTour(true); };
    window.addEventListener('tsn:open-feedback', handler);
    window.addEventListener('tsn:open-tour', tourHandler);
    return () => {
      window.removeEventListener('tsn:open-feedback', handler);
      window.removeEventListener('tsn:open-tour', tourHandler);
    };
  }, []);

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
              data-tour={l.tourId}
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
              data-tour="analise"
              style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 8, padding: '8px 16px', border: 'none', borderRadius: 8, background: '#2563eb', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              Fazer Análise <ChevronRight size={14} />
            </button>
          )}

          {/* Botão Tour */}
          {user && (
            <button onClick={() => { localStorage.removeItem(TOUR_KEY); setShowTour(true); }}
              title="Ver guia rápido"
              style={{ display: 'flex', alignItems: 'center', padding: '7px 10px', border: 'none', borderRadius: 8, background: 'transparent', color: '#475569', cursor: 'pointer' }}>
              <HelpCircle size={15} />
            </button>
          )}

          {/* Usuário */}
          {user ? (
            <div style={{ position: 'relative', marginLeft: 4 }}>
              <button onClick={() => setShowUserMenu(p => !p)}
                data-tour="conta"
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
                    ...(role === 'admin' ? [{ path: '/admin', label: '⚙️ Admin', icon: null }] : []),
                  ].map(item => (
                    <button key={item.path} onClick={() => { nav(item.path); setShowUserMenu(false); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#334155', fontSize: 13, fontWeight: 600, borderRadius: 8, textAlign: 'left' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      {item.icon ? <item.icon size={14} /> : null} {item.label}
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
      {showTour && <TourGuiado onClose={() => setShowTour(false)} />}

      <style>{`
        @media (max-width: 768px) {
          .hide-mobile { display: none !important; }
          .show-mobile { display: flex !important; }
        }
      `}</style>
    </header>
  );
}
