import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Briefcase, Search, LayoutDashboard, Home, Menu, X, ChevronRight, GraduationCap, User, LogOut, Tag, MessageSquare, FileText, Eye, Calculator, HelpCircle, Headphones, DollarSign, Download, MapPin, Network, Wallet, MessageCircle } from 'lucide-react';
import TourGuiado, { TOUR_KEY_EXPORT as TOUR_KEY } from './TourGuiado';
import AnalisesMenu from './AnalisesMenu';
import { useAuth } from '../contexts/AuthContext';
import { chatDisponivelPara } from '../utils/chatDisponivel';
import { usePlanos } from '../contexts/PlanosContext';
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
            <p style={{ fontWeight: 700, color: '#111111', marginTop: 12 }}>Feedback registrado!</p>
            <p style={{ fontSize: 13, color: '#64748b' }}>Obrigado. Nossa equipe vai analisar em breve.</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontWeight: 800, fontSize: 18, color: '#111111' }}>Enviar Feedback</h3>
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
                  <label key={op} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#374151', cursor: 'pointer', padding: '6px 8px', borderRadius: 8, border: `1px solid ${resolvido === op ? '#0D63DB' : '#e2e8f0'}`, background: resolvido === op ? '#eff6ff' : 'white', fontWeight: resolvido === op ? 700 : 400, textAlign: 'center' }}>
                    <input type="radio" name="resolvido" value={op} checked={resolvido === op} onChange={() => setResolvido(op)} style={{ display: 'none' }} />
                    {op}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 8 }}>SATISFAÇÃO GERAL (0 a 10)</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {Array.from({ length: 11 }, (_, i) => (
                  <button key={i} onClick={() => setNps(i)}
                    style={{ width: 34, height: 34, borderRadius: 8, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', background: nps === i ? (npsColors[i] || '#0D63DB') : '#f1f5f9', color: nps === i ? 'white' : '#64748b' }}>
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
              <button onClick={enviar} disabled={!queixa.trim() || enviando} style={{ flex: 2, padding: '10px', border: 'none', borderRadius: 8, background: '#111111', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', opacity: queixa.trim() && !enviando ? 1 : 0.5 }}>
                {enviando ? 'Enviando…' : 'Enviar Feedback →'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ROLE_LABELS_STATIC = {
  admin: 'Admin', explorador: 'Explorador',
  consultor: 'Consultor', afiliado: 'Afiliado', analista: 'Analista', advogado: 'Advogado',
};

export default function Header() {
  const nav = useNavigate();
  const loc = useLocation();
  const { user, role, effectiveRole, effectiveUserId, loading, impersonate, encerrarSuporte, roleSimulado, simularRole } = useAuth();
  // Contador de não lidas do chat, para o item de MENU do celular. Vem por EVENTO do
  // ChatSuporte, que já consulta `suporte_respostas_nao_lidas` — não é uma segunda consulta nem
  // uma segunda regra: é o mesmo número, exibido em outro lugar. Duas leituras independentes do
  // mesmo fato é como se criam os dois painéis que discordam.
  const [naoLidasChat, setNaoLidasChat] = React.useState(0);
  // NÃO OFERECER O QUE NÃO EXISTE (15/08). O item de menu nasceu gated só por "logado", mas o
  // ChatSuporte não se desenha para equipe nem em modo suporte — então o admin via "Assistente",
  // clicava e não acontecia nada. Agora as duas pontas perguntam à MESMA função.
  const temChat = chatDisponivelPara({ isLoggedIn: !!user, role: effectiveRole, impersonate });
  React.useEffect(() => {
    const h = (e) => setNaoLidasChat(Number(e?.detail || 0));
    window.addEventListener('tsn:chat-nao-lidas', h);
    return () => window.removeEventListener('tsn:chat-nao-lidas', h);
  }, []);
  const planosCtx = usePlanos();
  const [open, setOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [showTour, setShowTour] = useState(false);
  // "Instalar app" (PWA): só faz sentido quando ainda NÃO está instalado (standalone).
  const [podeInstalar, setPodeInstalar] = useState(false);
  React.useEffect(() => {
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches
      || window.navigator.standalone === true;
    setPodeInstalar(!standalone);
  }, []);
  // "Minha Rede" só aparece no menu depois que o usuário ACEITA ser parceiro (ou é admin).
  const [ehParceiro, setEhParceiro] = useState(false);
  // IMPORTANTE: usa effectiveUserId (a conta EFETIVA) — no MODO SUPORTE, reflete o CLIENTE que está
  // sendo visto, não o admin. Antes lia user.id (o admin, que é parceiro), então "Indicações"
  // aparecia para um cliente que NÃO aceitou a parceria enquanto o admin dava suporte.
  const alvoParceria = effectiveUserId || user?.id;
  React.useEffect(() => {
    if (!alvoParceria) { setEhParceiro(false); return; }
    const carregar = () => supabase.from('perfis').select('parceiro_aceite_em').eq('id', alvoParceria).maybeSingle()
      .then(({ data }) => setEhParceiro(!!data?.parceiro_aceite_em)).catch(() => {});
    carregar();
    // Re-lê ao ACEITAR a parceria (evento disparado por ConviteParceiro/HomeCliente) — mostra
    // "Indicações" NA HORA, sem depender de novo login.
    const h = () => carregar();
    window.addEventListener('tsn:parceiro-atualizado', h);
    return () => window.removeEventListener('tsn:parceiro-atualizado', h);
  }, [alvoParceria]);
  // "Indicações" só quando a conta EFETIVA aceitou a parceria (ou é admin de verdade, fora de suporte).
  const mostrarRede = ehParceiro || (effectiveRole === 'admin' && !impersonate);
  // Papel de EQUIPE: papel real do usuário — ou o simulado, quando o admin escolhe ver o app
  // como consultor/analista (o propósito da simulação). NÃO usa `effectiveRole`, que também
  // carrega a PERSONIFICAÇÃO de um cliente (iniciarSuporte / ficha do 360): enquanto o
  // atendente estava com a ficha de um cliente aberta, o botão "Atendimento" SUMIA do menu e a
  // fila de suporte ficava inalcançável pelo menu (a rota continuava valendo, porque o
  // PrivateRoute usa o papel real) — foi o que escondeu os 7 chamados abertos.
  // Ferramenta de equipe é do ATENDENTE; personificar cliente serve para ver o app como ele.
  const papelEquipe = (role === 'admin' && roleSimulado) ? roleSimulado : role;
  // "Comissões" (extrato operacional) só p/ a equipe; o parceiro-cliente vê os ganhos em Indicações.
  const ehEquipe = ['admin', 'consultor', 'analista', 'advogado'].includes(papelEquipe);
  const abrirInstalarApp = () => window.dispatchEvent(new Event('tsn:pwa-install'));

  const ROLES_CALC = ['explorador', 'top2', 'assessorado', 'clube', 'consultor', 'analista', 'advogado', 'admin'];
  const linksPublicos = [
    { path: '/', label: 'Home', icon: Home, tourId: 'home' },
    { path: '/calculadora', label: 'Calculadora', icon: Calculator, tourId: 'calculadora' },
    // Acervo aberto (sem login). `externo: true` porque /leiloes NÃO é rota do React —
    // é servida por /api/publico via rewrite do vercel.json. Navegar com o router daria
    // tela em branco: o SPA não tem esse caminho e não há fallback para 404 interno.
    { path: '/leiloes', label: 'Buscar Leilões', icon: Search, tourId: 'leiloes-publico', externo: true },
    { path: '/planos', label: 'Planos', icon: Tag, tourId: 'planos' },
  ];
  const linksPrivados = [
    { path: '/buscar', label: 'Leilões', icon: Search, tourId: 'leiloes' },
    { path: '/indice', label: 'Índice BidPro', icon: MapPin, tourId: 'indice' },
    { path: '/membros', label: 'Área de Membros', icon: GraduationCap, tourId: 'membros' },
    ...(mostrarRede ? [{ path: '/minha-rede', label: 'Indicações', icon: Briefcase, tourId: 'indicacoes' }] : []),
    ...(ROLES_CALC.includes(effectiveRole) ? [{ path: '/calculadora', label: 'Calculadora', icon: Calculator, tourId: 'calculadora' }] : []),
  ];
  // Enquanto o auth NÃO resolve, o header não afirma nada (15/08). Antes ele mostrava os
  // links de VISITANTE nesse intervalo — e como `loading` começa `true`, quem estava logado
  // via o menu público e o botão "Entrar" por um instante antes de tudo trocar. Era a metade
  // superior do mesmo pisca que a rota "/" produzia no login/F5: um header dizendo "Entrar"
  // para quem acabou de entrar é a leitura mais parecida com "o login não funcionou".
  // Mostrar o menu público não evitava flash, apenas escolhia qual flash mostrar.
  // Logado: mantém "Planos" no topo (pedido do dono) — a tela de planos mostra o plano
  // ATUAL + upgrade/downgrade contextual. A gestão de assinatura detalhada segue em
  // Meu Perfil › Assinatura.
  const links = loading
    ? []
    : (user
      ? [linksPublicos[0], { path: '/planos', label: 'Planos', icon: Tag, tourId: 'planos' }, ...linksPrivados]
      : linksPublicos);

  // Tour guiado de "primeiros passos" removido a pedido do dono — no lugar entrará
  // um vídeo. O componente TourGuiado e o gatilho manual (evento 'tsn:open-tour')
  // continuam disponíveis; só o auto-start após o cadastro foi desativado.

  const active = (p) => loc.pathname === p;

  // Link do menu: rota do SPA vai pelo router; página server-side (rewrite do vercel.json,
  // como /leiloes → /api/publico) precisa de navegação REAL do navegador.
  const irPara = (l) => { if (l.externo) window.location.assign(l.path); else nav(l.path); };

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

  // Fechar dropdown ao clicar fora
  React.useEffect(() => {
    if (!showUserMenu) return;
    const handler = (e) => { if (!e.target.closest('[data-usermenu]')) setShowUserMenu(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showUserMenu]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setShowUserMenu(false);
    nav('/');
  };

  // Modo suporte: a experiência é a do CLIENTE (nome, avatar e etiqueta de plano do
  // usuário visualizado — o banner laranja é quem lembra que é a equipe navegando).
  const nomeUsuario = impersonate?.nome || user?.user_metadata?.nome || user?.email?.split('@')[0] || 'Usuário';
  const roleEtiqueta = impersonate ? (impersonate.role || 'explorador') : role;

  return (
    <header style={{ position: 'sticky', top: 0, zIndex: 1100, background: '#111111', paddingTop: 'env(safe-area-inset-top)' }}>
      {/* Banner do modo suporte */}
      {impersonate && (
        <div style={{ background: '#d97706', color: 'white', padding: '7px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, fontSize: 13, fontWeight: 600, flexWrap: 'wrap' }}>
          <Eye size={15} /> Modo suporte, visualizando a conta de <strong>{impersonate.nome}</strong>
          <button onClick={encerrarSuporte}
            style={{ padding: '4px 12px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
            Sair do modo suporte
          </button>
        </div>
      )}
      {/* Banner de simulação de role (apenas admin).
          A frase vive DENTRO de um <span>. Em container flex, cada trecho de texto solto vira
          um item anônimo — então "🎭 Simulando como", o <strong> e ", a interface está sendo
          exibida…" quebravam em linhas separadas, com o `gap: 12` empurrando a vírgula para o
          começo da linha de baixo. Era o que aparecia no celular do dono. Um único filho de
          texto quebra como frase, não como três peças. */}
      {roleSimulado && (
        <div style={{ background: '#7c3aed', color: 'white', padding: '7px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, fontSize: 13, fontWeight: 600, flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-block', textAlign: 'center', lineHeight: 1.35 }}>
            🎭 Simulando <strong style={{ textTransform: 'capitalize' }}>{roleSimulado}</strong> em conta nova — só visualização
          </span>
          <button onClick={() => simularRole(null)}
            style={{ padding: '4px 12px', background: 'rgba(255,255,255,0.2)', color: 'white', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            Voltar ao Admin
          </button>
        </div>
      )}
      {/* O safe-area (env(safe-area-inset-top)) foi movido para o <header> externo acima, de
          modo que os banners de modo-suporte / simulação de role (com os botões "Sair do modo
          suporte" / "Voltar ao Admin") também desçam para baixo da status bar — antes eles
          ficavam POR BAIXO do relógio/bateria no iPhone. O fundo #111 do header preenche a
          faixa da status bar; fora de iPhone com notch o inset é 0 (sem efeito). */}
      <div style={{ background: '#111111', borderBottom: '1px solid #111111' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '8px 20px', minHeight: 62, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, boxSizing: 'border-box' }}>

        {/* Logo */}
        <button onClick={() => nav('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
          <img src="/logo.svg" alt="BidPro Brasil" style={{ height: 40 }} />
        </button>

        {/* Nav desktop */}
        <nav style={{ display: 'flex', gap: 4, rowGap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', minWidth: 0 }} className="hide-mobile">
          {links.map(l => (
            <button key={l.path} onClick={() => irPara(l)}
              data-tour={l.tourId}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active(l.path) ? '#084BA6' : 'transparent', color: active(l.path) ? 'white' : '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer', transition: 'all 0.15s' }}>
              <l.icon size={14} /> {l.label}
            </button>
          ))}

          {!loading && user && <AnalisesMenu />}

          {/* ASSISTENTE COMO TÓPICO DE MENU, também no DESKTOP (dono, 15/08: "fica melhor e
              muito profissional"). O botão flutuante redondo saiu de vez — no celular ele
              atrapalhava, e no desktop virava um elemento solto, fora da navegação, competindo
              com o conteúdo. Como tópico ele fica onde a pessoa procura o que fazer, e o número
              de não lidas continua visível ao lado. */}
          {!loading && temChat && (
            <button onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              <MessageCircle size={14} /> Assistente
              {naoLidasChat > 0 && (
                <span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: '#ef4444', color: 'white', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {naoLidasChat}
                </span>
              )}
            </button>
          )}

          {effectiveRole === 'leiloeiro' && (
            <button onClick={() => nav('/leiloeiro')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/leiloeiro') ? '#b45309' : '#b4530922', color: '#fcd34d', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              🏛️ Leiloeiro Parceiro
            </button>
          )}


          {effectiveRole === 'afiliado' && (
            <button onClick={() => nav('/afiliado')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/afiliado') ? '#db2777' : '#db277722', color: '#f9a8d4', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              📣 Afiliado
            </button>
          )}

          {effectiveRole === 'advogado' && (
            <button onClick={() => nav('/advogado')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/advogado') ? '#7c3aed' : '#7c3aed22', color: '#c4b5fd', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ⚖️ Advogado
            </button>
          )}

          {['analista','consultor','advogado','admin'].includes(papelEquipe) && (
            <button onClick={() => nav('/atendimento')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/atendimento') ? '#0891b2' : '#0891b222', color: '#67e8f9', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              <Headphones size={14} /> Atendimento
            </button>
          )}

          {['analista','admin'].includes(papelEquipe) && (
            <button onClick={() => nav('/cliente-360')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/cliente-360') ? '#0d9488' : '#0d948822', color: '#5eead4', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              👤 360º Cliente
            </button>
          )}

          {effectiveRole === 'admin' && (
            <button onClick={() => nav('/admin')}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', border: 'none', borderRadius: 8, background: active('/admin') ? '#7c3aed' : '#7c3aed22', color: '#c4b5fd', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              ⚙️ Admin
            </button>
          )}

          {/* Usuário. Enquanto `loading`, nem avatar nem "Entrar": ver a nota dos `links`. */}
          {loading ? null : user ? (
            <div data-usermenu="true" style={{ position: 'relative', marginLeft: 4 }}>
              <button onClick={() => setShowUserMenu(p => !p)}
                data-tour="conta"
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', border: '1px solid #334155', borderRadius: 8, background: 'transparent', color: 'white', cursor: 'pointer' }}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#0D63DB', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800 }}>
                  {nomeUsuario[0].toUpperCase()}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nomeUsuario}</span>
              </button>
              {showUserMenu && (
                <div data-usermenu="true" style={{ position: 'absolute', right: 0, top: '110%', background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', padding: '8px', minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 200 }}>
                  <div style={{ padding: '8px 12px', fontSize: 12, color: '#64748b', borderBottom: '1px solid #f1f5f9', marginBottom: 4 }}>
                    <div style={{ fontWeight: 700, color: '#111111' }}>{nomeUsuario}</div>
                    {!impersonate && <div style={{ fontSize: 11 }}>{user.email}</div>}
                    {!loading && roleEtiqueta && roleEtiqueta !== 'aluno' && (
                      <div style={{ fontSize: 10, background: '#f1f5f9', borderRadius: 4, padding: '2px 6px', marginTop: 4, display: 'inline-block', fontWeight: 700, textTransform: 'uppercase' }}>
                        {ROLE_LABELS_STATIC[roleEtiqueta] || planosCtx?.[roleEtiqueta]?.nome || roleEtiqueta}
                      </div>
                    )}
                  </div>
                  {[
                    // "Minha Assinatura" e "Minhas Comissões" saíram do menu — viraram
                    // sub-abas de Meu Perfil (Assinatura / Parceiros). O extrato completo
                    // de comissões fica a um clique dentro da aba Parceiros.
                    { path: '/perfil', label: 'Meu Perfil', icon: User },
                    { path: '/creditos', label: 'Meus Créditos', icon: Wallet },
                    ...(ehEquipe ? [{ path: '/comissoes', label: 'Comissões', icon: DollarSign }] : []),
                    { path: '/contratos', label: 'Meus Contratos', icon: FileText },
                  ].map(item => (
                    <button key={item.path} onClick={() => { nav(item.path); setShowUserMenu(false); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#334155', fontSize: 13, fontWeight: 600, borderRadius: 8, textAlign: 'left' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      {item.icon ? <item.icon size={14} /> : null} {item.label}
                    </button>
                  ))}
                  {podeInstalar && (
                    <button onClick={() => { abrirInstalarApp(); setShowUserMenu(false); }}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', color: '#0D63DB', fontSize: 13, fontWeight: 700, borderRadius: 8, textAlign: 'left' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}>
                      <Download size={14} /> Instalar app
                    </button>
                  )}
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

      {/* Mobile menu — ROLÁVEL e limitado à altura da tela (dvh) para que TODAS as opções fiquem
          acessíveis mesmo em telas menores / com muitos itens (admin). Sem isto, os itens de baixo
          (Admin, Sair) caíam abaixo da dobra e não havia como rolar até eles. paddingBottom com
          safe-area para o último item não ficar sob o indicador de home do iPhone. */}
      {open && (
        <div style={{ background: '#111111', borderTop: '1px solid #111111', padding: '12px 20px', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 'calc(100dvh - 56px - env(safe-area-inset-top, 0px))', overflowY: 'auto', WebkitOverflowScrolling: 'touch', paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))' }}>
          {links.map(l => (
            <button key={l.path} onClick={() => { irPara(l); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: active(l.path) ? '#084BA6' : 'transparent', color: active(l.path) ? 'white' : '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              <l.icon size={16} /> {l.label}
            </button>
          ))}
          {!loading && user && <AnalisesMenu mobile onNavegar={() => setOpen(false)} />}
          {/* FALAR COM O ASSISTENTE — entrada de MENU no celular (pedido do dono, 15/08).
              O botão flutuante redondo com o "B" não funciona bem no telefone: ele fica sobre o
              conteúdo, disputa espaço com a barra de ações do rodapé e, com o badge vermelho por
              cima, foi lido como enfeite quebrado. No desktop ele continua — lá sobra margem e o
              acesso de um clique tem valor. Aqui a mesma função vira uma linha do menu, que é
              onde a pessoa já procura o que fazer. O `naoLidasChat` mostra o mesmo número do
              badge, para o aviso não sumir junto com o botão. */}
          {!loading && temChat && (
            <button onClick={() => { window.dispatchEvent(new CustomEvent('tsn:open-chat')); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              <MessageCircle size={16} /> Falar com o assistente
              {naoLidasChat > 0 && (
                <span style={{ marginLeft: 'auto', minWidth: 20, height: 20, padding: '0 6px', borderRadius: 999, background: '#ef4444', color: 'white', fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                  {naoLidasChat}
                </span>
              )}
            </button>
          )}
          {effectiveRole === 'leiloeiro' && (
            <button onClick={() => { nav('/leiloeiro'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#fcd34d', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              🏛️ Leiloeiro Parceiro
            </button>
          )}
          {ehEquipe && (
            <button onClick={() => { nav('/comissoes'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#93c5fd', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              <DollarSign size={16} /> Comissões
            </button>
          )}
          {effectiveRole === 'afiliado' && (
            <button onClick={() => { nav('/afiliado'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#f9a8d4', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              📣 Afiliado
            </button>
          )}
          {effectiveRole === 'advogado' && (
            <button onClick={() => { nav('/advogado'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#c4b5fd', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              ⚖️ Advogado
            </button>
          )}
          {['analista','consultor','advogado','admin'].includes(papelEquipe) && (
            <button onClick={() => { nav('/atendimento'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#67e8f9', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              <Headphones size={16} /> Atendimento
            </button>
          )}
          {['analista','admin'].includes(papelEquipe) && (
            <button onClick={() => { nav('/cliente-360'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#5eead4', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              👤 360º Cliente
            </button>
          )}
          {effectiveRole === 'admin' && (
            <button onClick={() => { nav('/admin'); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#c4b5fd', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              ⚙️ Admin
            </button>
          )}
          {/* Itens da CONTA — antes só existiam no dropdown do avatar (desktop), então no celular
              não havia como chegar em Meu Perfil, Meus Créditos e Meus Contratos. */}
          {user && (<>
            <div style={{ height: 1, background: '#1e293b', margin: '6px 0' }} />
            {[
              { path: '/perfil', label: 'Meu Perfil', icon: User },
              { path: '/creditos', label: 'Meus Créditos', icon: Wallet },
              { path: '/contratos', label: 'Meus Contratos', icon: FileText },
            ].map(item => (
              <button key={item.path} onClick={() => { nav(item.path); setOpen(false); }}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: active(item.path) ? '#084BA6' : 'transparent', color: active(item.path) ? 'white' : '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
                <item.icon size={16} /> {item.label}
              </button>
            ))}
          </>)}
          {podeInstalar && (
            <button onClick={() => { abrirInstalarApp(); setOpen(false); }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#60a5fa', fontWeight: 700, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
              <Download size={16} /> Instalar app
            </button>
          )}
          {loading ? null : user
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
