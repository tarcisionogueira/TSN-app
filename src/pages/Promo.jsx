import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Check, Zap, ShieldCheck, Users, TrendingUp, Clock, ArrowRight, AlertCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { PLANOS } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';
import { senhaForte, MSG_SENHA_FRACA } from '../lib/senha';

// Ícones decorativos por plano
const ICONE_PLANO = { top2: '⚖️', assessorado: '🤝', clube: '👑' };

function fmtPreco(v) {
  return Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function Promo() {
  const { codigo } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const [link, setLink] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  // Fluxo SDR do link promocional: perguntas (uma por vez) + contato → lead p/
  // consultor → depois segue para o checkout com o desconto.
  const [sdrAberto, setSdrAberto] = useState(false);
  const [passo, setPasso] = useState(0);
  const [respostas, setRespostas] = useState({});
  const [contato, setContato] = useState({ nome: '', whatsapp: '', email: '', senha: '' });
  const [enviandoSdr, setEnviandoSdr] = useState(false);
  const [erroSdr, setErroSdr] = useState('');
  const [concluido, setConcluido] = useState(false);
  const [acessoLiberado, setAcessoLiberado] = useState(false); // só true quando o servidor concedeu
  const [contaNova, setContaNova] = useState(true);  // false = o e-mail já tinha conta (servidor: jaExistia)

  const [tituloConteudo, setTituloConteudo] = useState('');

  useEffect(() => {
    if (!codigo) return;
    supabase
      .from('links_promo')
      .select('*')
      .eq('codigo', codigo.toUpperCase())
      .eq('ativo', true)
      .single()
      .then(async ({ data, error }) => {
        if (error || !data) { setErro('Link promocional não encontrado ou expirado.'); setLoading(false); return; }
        if (data.validade_ate && new Date(data.validade_ate) < new Date()) { setErro('Esta oferta expirou.'); setLoading(false); return; }
        // Curso/e-book: busca o título para exibir a oferta.
        if (data.produto_ref_id && (data.produto_tipo === 'curso' || data.produto_tipo === 'ebook')) {
          const tab = data.produto_tipo === 'curso' ? 'cursos_admin' : 'ebooks_admin';
          const { data: item } = await supabase.from(tab).select('titulo').eq('id', data.produto_ref_id).single();
          setTituloConteudo(item?.titulo || '');
        }
        setLink(data);
        setLoading(false);
      });
  }, [codigo]);

  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
      Carregando oferta…
    </div>
  );

  if (erro || !link) return (
    <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
      <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px' }} />
      <h2 style={{ color: '#111111', marginBottom: 8 }}>Oferta não encontrada</h2>
      <p style={{ color: '#64748b', marginBottom: 24 }}>{erro || 'Este link pode ter sido desativado ou expirado.'}</p>
      <button onClick={() => nav('/planos')} style={{ padding: '10px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
        Ver todos os planos
      </button>
    </div>
  );

  const ehPlano = !link.produto_tipo || link.produto_tipo === 'plano';
  const plano = ehPlano ? PLANOS[link.produto] : null;
  // 21/08: `return null` = TELA BRANCA quando o link é de um plano fora do estático (typo do
  // admin, ou plano à vista `assessorado_vista`/`clube_vista` que não vive em PLANOS). Visitante
  // vindo de anúncio/consultor caía em nada. Mostra o mesmo aviso amigável de "oferta não achada".
  if (ehPlano && !plano) return (
    <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
      <AlertCircle size={48} color="#dc2626" style={{ margin: '0 auto 16px' }} />
      <h2 style={{ color: '#111111', marginBottom: 8 }}>Oferta não encontrada</h2>
      <p style={{ color: '#64748b', marginBottom: 24 }}>Este link aponta para um plano que não está mais disponível.</p>
      <button onClick={() => nav('/planos')} style={{ padding: '10px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>
        Ver todos os planos
      </button>
    </div>
  );
  const cor = plano?.cor || '#0D63DB';

  // Desconto só vale se ainda estiver dentro da validade do desconto (pode ser
  // diferente da validade do link).
  const descontoValido = !link.desconto_validade_ate || new Date(link.desconto_validade_ate) >= new Date();
  const precoOriginal = plano?.preco || 0;
  let precoPromo = precoOriginal;
  if (descontoValido && link.desconto_pct > 0)   precoPromo = precoOriginal * (1 - link.desconto_pct / 100);
  if (descontoValido && link.desconto_valor > 0) precoPromo = Math.max(0, precoOriginal - link.desconto_valor);
  const temDesconto = precoPromo < precoOriginal;
  const pctDesconto = precoOriginal > 0 ? Math.round((1 - precoPromo / precoOriginal) * 100) : 0;

  const perguntas = Array.isArray(link.perguntas) ? link.perguntas.filter(p => p && String(p.texto || '').trim()) : [];
  // Gate: quando exige_perguntas, ninguém acessa sem responder (mesmo logado).
  const exigeGate = !!link.exige_perguntas && perguntas.length > 0;
  // ?ref= = código de indicação de quem COMPARTILHOU (consultor/afiliado) — para a
  // comissão ir para ele, não para quem criou a promoção.
  const refParam = (() => { try { return new URLSearchParams(window.location.hash.split('?')[1] || '').get('ref') || ''; } catch { return ''; } })();
  const refQS = refParam ? `&ref=${encodeURIComponent(refParam)}` : '';

  const seguirCheckout = () => {
    const dest = user
      ? `/checkout?plano=${link.produto}&promo=${link.codigo}${refQS}`
      : `/login?plano=${link.produto}&promo=${link.codigo}${refQS}`;
    nav(dest);
  };

  const irParaCheckout = () => {
    // Link com perguntas → qualifica antes (função SDR). Obrigatório quando exige_perguntas;
    // caso contrário só para tráfego novo (sem login).
    if (perguntas.length && (exigeGate || !user)) { setSdrAberto(true); setPasso(0); setErroSdr(''); return; }
    seguirCheckout();
  };

  const totalPassos = perguntas.length + 1; // perguntas + tela de contato
  const noContato = passo >= perguntas.length;
  const perguntaAtual = perguntas[passo];
  const respondida = (p) => p && String(respostas[p.id] ?? '').trim() !== '';

  const enviarSdr = async () => {
    if (!contato.nome.trim() || contato.whatsapp.replace(/\D/g, '').length < 10) {
      setErroSdr('Preencha nome e um WhatsApp válido (com DDD).'); return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contato.email.trim())) { setErroSdr('Informe um e-mail válido.'); return; }
    // 19/08: era `length < 6` — a cópia que não recebeu a régua de senha forte de 15/08,
    // num link público de aquisição que cria conta efetiva. Regra única de src/lib/senha.js.
    if (!senhaForte(contato.senha)) { setErroSdr(MSG_SENHA_FRACA); return; }
    setEnviandoSdr(true); setErroSdr('');
    try {
      const respArr = perguntas.map(p => ({ pergunta: p.texto, resposta: respostas[p.id] ?? '' }));
      const r = await fetch('/api/promo-capturar', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: link.codigo, nome: contato.nome, whatsapp: contato.whatsapp, email: contato.email, senha: contato.senha, respostas: respArr, ref: refParam }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok || !data.ok) throw new Error(data.error || 'Não foi possível enviar. Tente novamente.');
      // Login (prova de posse da conta — vale tanto p/ a conta recém-criada quanto p/ quem já tinha).
      const { error: erroLogin } = await supabase.auth.signInWithPassword({ email: contato.email.trim().toLowerCase(), password: contato.senha });
      // E-MAIL JÁ CADASTRADO: o servidor DIZ, e a tela ignorava (10/08). `promo-capturar`
      // responde `{ ok:true, jaExistia:true, userId:null }` e não cria nada — decisão correta
      // dele (não atribuir vendedor a conta existente, para não sequestrar comissão). Só que
      // `jaExistia` não era lido em lugar nenhum do front, e a senha NOVA que a pessoa acabou de
      // digitar não abre a conta ANTIGA: o `signInWithPassword` falha. Daí, no plano pago, o
      // `nav('/checkout')` rodava assim mesmo e a pessoa chegava DESLOGADA, vendo de novo o
      // formulário de criar conta, sem nunca ler que o e-mail já existe.
      if (data.jaExistia && erroLogin) {
        throw new Error('Este e-mail já tem conta na BidPro Brasil, e a senha informada não confere. Entre com a sua senha (ou recupere-a) e volte por este mesmo link para garantir a promoção.');
      }
      // Plano pago → checkout com o desconto (a conta já existe/logada). Só segue LOGADO: sem
      // sessão, o checkout não sabe quem é o cliente e o funil recomeça do zero.
      if (ehPlano) {
        if (erroLogin) throw new Error('Conta registrada, mas não conseguimos entrar automaticamente. Faça login e volte por este link para concluir com o desconto.');
        nav(`/checkout?plano=${link.produto}&promo=${link.codigo}${refQS}`); return;
      }
      // Curso/e-book: a CONCESSÃO acontece AQUI, no servidor, com o usuário autenticado. Antes a
      // tela dizia "Acesso liberado!" sem nada ter sido liberado — nenhuma linha em
      // compras_produtos, que é o que o Curso/E-book exigem — e o cliente batia no paywall.
      let liberado = false;
      if (!erroLogin) {
        const { data: res, error: erroConceder } = await supabase.rpc('conceder_acesso_promo', { p_codigo: link.codigo });
        if (erroConceder) console.error('[promo] conceder acesso:', erroConceder.message);
        liberado = !!res?.ok;
      }
      // `contaNova` separa "criamos sua conta" de "sua conta já existia": a tela dizia
      // "✅ Conta criada!" mesmo quando nada foi criado e o login tinha falhado.
      setContaNova(!data.jaExistia);
      setAcessoLiberado(liberado);
      setSdrAberto(false); setConcluido(true);
    } catch (e) { setErroSdr(e.message); setEnviandoSdr(false); }
  };

  const sdrOverlay = sdrAberto ? (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
          onClick={(e) => { if (e.target === e.currentTarget && !enviandoSdr) setSdrAberto(false); }}>
          <div style={{ background: 'white', borderRadius: 18, width: '100%', maxWidth: 460, padding: '26px 24px', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
            {/* Progresso */}
            <div style={{ display: 'flex', gap: 5, marginBottom: 18 }}>
              {Array.from({ length: totalPassos }).map((_, i) => (
                <div key={i} style={{ flex: 1, height: 5, borderRadius: 3, background: i <= passo ? cor : '#e2e8f0' }} />
              ))}
            </div>

            {!noContato ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>Pergunta {passo + 1} de {perguntas.length}</div>
                <div style={{ fontSize: 19, fontWeight: 800, color: '#111', marginBottom: 18, lineHeight: 1.3 }}>{perguntaAtual.texto}</div>

                {perguntaAtual.tipo === 'sim_nao' ? (
                  <div style={{ display: 'flex', gap: 10 }}>
                    {['Sim', 'Não'].map(op => (
                      <button key={op} onClick={() => setRespostas(r => ({ ...r, [perguntaAtual.id]: op }))}
                        style={{ flex: 1, padding: '14px', borderRadius: 12, border: `2px solid ${respostas[perguntaAtual.id] === op ? cor : '#e2e8f0'}`, background: respostas[perguntaAtual.id] === op ? `${cor}12` : 'white', color: '#111', fontWeight: 700, fontSize: 15, cursor: 'pointer' }}>{op}</button>
                    ))}
                  </div>
                ) : perguntaAtual.tipo === 'multipla' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {String(perguntaAtual.opcoes || '').split(',').map(o => o.trim()).filter(Boolean).map(op => (
                      <button key={op} onClick={() => setRespostas(r => ({ ...r, [perguntaAtual.id]: op }))}
                        style={{ textAlign: 'left', padding: '13px 16px', borderRadius: 12, border: `2px solid ${respostas[perguntaAtual.id] === op ? cor : '#e2e8f0'}`, background: respostas[perguntaAtual.id] === op ? `${cor}12` : 'white', color: '#111', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>{op}</button>
                    ))}
                  </div>
                ) : (
                  <input autoFocus value={respostas[perguntaAtual.id] || ''} onChange={e => setRespostas(r => ({ ...r, [perguntaAtual.id]: e.target.value }))}
                    placeholder="Sua resposta…" style={{ width: '100%', padding: '13px 16px', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 15, color: '#111', boxSizing: 'border-box' }} />
                )}
              </>
            ) : (
              <>
                <div style={{ fontSize: 19, fontWeight: 800, color: '#111', marginBottom: 4 }}>Crie seu acesso</div>
                <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18 }}>Sua conta é criada na hora e o acesso é liberado automaticamente.</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <input value={contato.nome} onChange={e => setContato(c => ({ ...c, nome: e.target.value }))} placeholder="Seu nome" style={{ width: '100%', padding: '13px 16px', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 15, color: '#111', boxSizing: 'border-box' }} />
                  <input value={contato.whatsapp} onChange={e => setContato(c => ({ ...c, whatsapp: e.target.value }))} placeholder="WhatsApp (com DDD)" inputMode="tel" style={{ width: '100%', padding: '13px 16px', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 15, color: '#111', boxSizing: 'border-box' }} />
                  <input value={contato.email} onChange={e => setContato(c => ({ ...c, email: e.target.value }))} placeholder="E-mail" inputMode="email" style={{ width: '100%', padding: '13px 16px', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 15, color: '#111', boxSizing: 'border-box' }} />
                  <input value={contato.senha} onChange={e => setContato(c => ({ ...c, senha: e.target.value }))} placeholder="Senha: mín. 8, com maiúscula, minúscula, número e símbolo" type="password" style={{ width: '100%', padding: '13px 16px', border: '1px solid #e2e8f0', borderRadius: 12, fontSize: 15, color: '#111', boxSizing: 'border-box' }} />
                </div>
              </>
            )}

            {erroSdr && <div style={{ marginTop: 12, padding: '9px 12px', background: '#fee2e2', color: '#dc2626', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>{erroSdr}</div>}

            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={() => { if (passo === 0) setSdrAberto(false); else setPasso(p => p - 1); }} disabled={enviandoSdr}
                style={{ padding: '12px 18px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {passo === 0 ? 'Cancelar' : 'Voltar'}
              </button>
              {!noContato ? (
                <button onClick={() => setPasso(p => p + 1)} disabled={perguntaAtual.tipo === 'texto' ? false : !respondida(perguntaAtual)}
                  style={{ flex: 1, padding: '12px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', opacity: (perguntaAtual.tipo !== 'texto' && !respondida(perguntaAtual)) ? 0.5 : 1 }}>
                  Próxima
                </button>
              ) : (
                <button onClick={enviarSdr} disabled={enviandoSdr}
                  style={{ flex: 1, padding: '12px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', opacity: enviandoSdr ? 0.6 : 1 }}>
                  {enviandoSdr ? 'Enviando…' : (ehPlano ? 'Continuar para o checkout →' : 'Liberar meu acesso →')}
                </button>
              )}
            </div>
          </div>
        </div>
  ) : null;

  // Confirmação (curso/e-book). A mensagem segue o que REALMENTE aconteceu: só diz "liberado"
  // quando a concessão voltou ok do servidor.
  if (concluido) return (
    <div style={{ minHeight: '100vh', background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ background: 'white', borderRadius: 20, maxWidth: 460, padding: '36px 30px', textAlign: 'center', boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>{acessoLiberado ? '🎉' : '✅'}</div>
        <h2 style={{ color: '#111', margin: '0 0 8px' }}>{acessoLiberado ? 'Acesso liberado!' : contaNova ? 'Conta criada!' : 'Tudo certo!'}</h2>
        <p style={{ color: '#64748b', lineHeight: 1.6, marginBottom: 22 }}>
          {acessoLiberado
            ? <>Pronto{contato.nome.trim() ? `, ${contato.nome.trim().split(' ')[0]}` : ''}! Sua conta foi criada e o seu acesso{tituloConteudo ? ` a "${tituloConteudo}"` : ''} já está liberado.</>
            : contaNova
              ? <>Sua conta foi criada{contato.nome.trim() ? `, ${contato.nome.trim().split(' ')[0]}` : ''}. Entre na plataforma para acessar{tituloConteudo ? ` "${tituloConteudo}"` : ' o conteúdo'} — se ele ainda não aparecer, fale com a gente que liberamos na hora.</>
              : <>Recebemos suas respostas{contato.nome.trim() ? `, ${contato.nome.trim().split(' ')[0]}` : ''}. Você já tinha conta aqui: entre com a sua senha para acessar{tituloConteudo ? ` "${tituloConteudo}"` : ' o conteúdo'} — se ele não aparecer, fale com a gente que liberamos na hora.</>}
        </p>
        <button onClick={() => nav('/membros')} style={{ padding: '12px 26px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, cursor: 'pointer' }}>Acessar agora</button>
      </div>
    </div>
  );

  // Página de CURSO / E-BOOK (conteúdo liberado por qualificação).
  if (!ehPlano) return (
    <div style={{ background: '#111', minHeight: '100vh', padding: '0 0 80px' }}>
      <div style={{ textAlign: 'center', padding: '70px 20px 0', maxWidth: 640, margin: '0 auto' }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>{link.produto_tipo === 'curso' ? '🎓' : '📘'}</div>
        <div style={{ display: 'inline-block', background: '#dcfce7', color: '#15803d', fontSize: 12, fontWeight: 800, padding: '5px 14px', borderRadius: 20, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>
          {link.produto_tipo === 'curso' ? 'Curso' : 'E-book'}{descontoValido && link.desconto_pct > 0 ? ` · ${Math.round(link.desconto_pct)}% off` : ''}
        </div>
        <h1 style={{ fontSize: 38, fontWeight: 900, color: 'white', margin: '0 0 14px', lineHeight: 1.15 }}>{tituloConteudo || 'Conteúdo exclusivo'}</h1>
        <p style={{ color: '#94a3b8', fontSize: 17, margin: '0 0 30px' }}>
          {exigeGate ? 'Responda algumas perguntas rápidas para liberar o seu acesso.' : 'Garanta o seu acesso agora.'}
        </p>
        <div style={{ background: 'white', borderRadius: 20, padding: '28px 30px', display: 'inline-block', minWidth: 300, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
          <button onClick={() => { if (perguntas.length) { setSdrAberto(true); setPasso(0); setErroSdr(''); } else nav(`/login?promo=${link.codigo}`); }}
            style={{ width: '100%', padding: '15px 28px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {exigeGate ? 'Responder e liberar acesso' : 'Quero acessar'} <ArrowRight size={18} />
          </button>
          {link.beneficio_validade_dias > 0 && <div style={{ marginTop: 12, fontSize: 12, color: '#64748b' }}>Benefício válido por {link.beneficio_validade_dias} dias.</div>}
        </div>
      </div>
      {sdrOverlay}
    </div>
  );

  return (
    <div style={{ background: 'linear-gradient(160deg, #111111 0%, #111111 40%, #111111 100%)', minHeight: '100vh', padding: '0 0 80px' }}>

      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '60px 20px 0', maxWidth: 720, margin: '0 auto' }}>
        {temDesconto && (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#dc2626', color: 'white', fontSize: 13, fontWeight: 800, padding: '6px 16px', borderRadius: 20, marginBottom: 20, textTransform: 'uppercase', letterSpacing: 1 }}>
            <Zap size={14} /> Oferta especial, {pctDesconto}% de desconto
          </div>
        )}
        <div style={{ fontSize: 52, marginBottom: 12 }}>{ICONE_PLANO[link.produto] || '🎯'}</div>
        <h1 style={{ fontSize: 42, fontWeight: 900, color: 'white', margin: '0 0 12px', lineHeight: 1.15 }}>
          Plano <span style={{ color: cor }}>{plano.nome}</span>
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 18, margin: '0 0 32px', lineHeight: 1.6 }}>
          {plano.descricao}
        </p>

        {/* Card de preço */}
        <div style={{ background: 'white', borderRadius: 20, padding: '32px 36px', display: 'inline-block', minWidth: 320, boxShadow: '0 24px 60px rgba(0,0,0,0.4)' }}>
          {temDesconto ? (
            <>
              <div style={{ fontSize: 13, color: '#94a3b8', textDecoration: 'line-through', fontWeight: 600, marginBottom: 4 }}>
                De R$ {fmtPreco(precoOriginal)}{plano.periodicidade}
              </div>
              <div style={{ fontSize: 48, fontWeight: 900, color: '#059669', lineHeight: 1 }}>
                R$ {fmtPreco(precoPromo)}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{plano.periodicidade}</div>
              {link.descricao_condicoes && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#fef9c3', borderRadius: 10, fontSize: 13, color: '#a16207', fontWeight: 600, textAlign: 'left' }}>
                  📋 {link.descricao_condicoes}
                </div>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 48, fontWeight: 900, color: '#111111', lineHeight: 1 }}>
                {plano.precoLabel}
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>{plano.periodicidade}</div>
              {link.descricao_condicoes && (
                <div style={{ marginTop: 14, padding: '10px 14px', background: '#fef9c3', borderRadius: 10, fontSize: 13, color: '#a16207', fontWeight: 600, textAlign: 'left' }}>
                  📋 {link.descricao_condicoes}
                </div>
              )}
            </>
          )}
          <button onClick={irParaCheckout}
            style={{ marginTop: 22, width: '100%', padding: '14px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            Quero assinar agora <ArrowRight size={18} />
          </button>
          <div style={{ marginTop: 12, fontSize: 11, color: '#94a3b8', textAlign: 'center' }}>
            <ShieldCheck size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Pagamento seguro · Cancele quando quiser
          </div>
          {(link.carencia_dias > 0 || link.beneficio_validade_dias > 0) && (
            <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {link.carencia_dias > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: 20 }}>🎁 {link.carencia_dias} dias de carência</span>}
              {link.beneficio_validade_dias > 0 && <span style={{ fontSize: 11, fontWeight: 700, background: '#eff6ff', color: '#084BA6', padding: '4px 10px', borderRadius: 20 }}>⏳ Benefício por {link.beneficio_validade_dias} dias</span>}
            </div>
          )}
        </div>
      </div>

      {/* Recursos do plano */}
      <div style={{ maxWidth: 680, margin: '52px auto 0', padding: '0 20px' }}>
        <h2 style={{ color: 'white', fontSize: 22, fontWeight: 800, textAlign: 'center', marginBottom: 24 }}>
          O que está incluído no {plano.nome}
        </h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="promo-recursos">
          {plano.recursos.map((r, i) => {
            const ativo = r.startsWith('✅');
            const texto = r.replace(/^[✅❌]\s*/, '');
            return (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', background: ativo ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.02)', borderRadius: 10, border: `1px solid ${ativo ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.04)'}` }}>
                <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{ativo ? '✅' : '❌'}</span>
                <span style={{ fontSize: 13, color: ativo ? '#e2e8f0' : '#475569', lineHeight: 1.45 }}>{texto}</span>
              </div>
            );
          })}
        </div>

        {typeof plano.honorarios === 'string' && plano.honorarios && (
          <div style={{ marginTop: 14, padding: '12px 16px', background: 'rgba(255,255,255,0.05)', borderRadius: 10, fontSize: 13, color: '#94a3b8', border: '1px solid rgba(255,255,255,0.08)' }}>
            ℹ️ {plano.honorarios}
          </div>
        )}
      </div>

      {/* Selos de confiança */}
      <div style={{ maxWidth: 680, margin: '40px auto 0', padding: '0 20px', display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap' }}>
        {[
          { icon: <ShieldCheck size={20} color="#10b981" />, texto: 'Pagamento 100% seguro' },
          { icon: <Users size={20} color="#60a5fa" />,       texto: 'Suporte via WhatsApp' },
          { icon: <TrendingUp size={20} color="#a78bfa" />,  texto: 'Resultados comprovados' },
          { icon: <Clock size={20} color="#fbbf24" />,       texto: 'Acesso imediato' },
        ].map(({ icon, texto }) => (
          <div key={texto} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#94a3b8' }}>
            {icon} {texto}
          </div>
        ))}
      </div>

      {/* CTA final */}
      <div style={{ textAlign: 'center', marginTop: 52, padding: '0 20px' }}>
        <button onClick={irParaCheckout}
          style={{ padding: '16px 40px', background: cor, color: 'white', border: 'none', borderRadius: 14, fontWeight: 900, fontSize: 18, cursor: 'pointer', boxShadow: `0 8px 30px ${cor}66`, display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          Assinar {plano.nome} agora <ArrowRight size={20} />
        </button>
        <div style={{ marginTop: 14, fontSize: 13, color: '#475569' }}>
          Já tem conta? <button onClick={() => nav(`/login?plano=${link.produto}&promo=${link.codigo}`)} style={{ background: 'none', border: 'none', color: '#60a5fa', fontWeight: 700, cursor: 'pointer' }}>Entrar e assinar</button>
        </div>
      </div>

      {sdrOverlay}

      <style>{`@media(max-width:600px){ .promo-recursos{ grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
