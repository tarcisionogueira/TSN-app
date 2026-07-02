import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

const PLANOS_INFO = {
  top2: {
    tagline: 'Acesse leilões, análises e cursos com o melhor custo-benefício',
    precoLabel: 'R$ 49,90/mês',
    features: [
      'Busca ilimitada de imóveis em leilão em todo o Brasil',
      'Acesso completo à biblioteca de cursos e videoaulas',
      'Calculadora de viabilidade e ROI',
      'Relatórios de análise de imóveis',
      'Alertas de novos leilões por estado e tipo',
      'Suporte via chat',
    ],
  },
  assessorado: {
    tagline: 'Assessoria personalizada por 12 meses para sua jornada nos leilões',
    precoLabel: '12× R$ 500/mês',
    features: [
      'Tudo do plano Investidor',
      'Assessoria individual com especialista por 12 meses',
      '15 análises de imóveis por mês (mercadológica + documental/jurídica)',
      'Participação em reuniões mensais ao vivo',
      'Revisão de editais e documentação',
      'Contrato digital de prestação de serviços',
      'Acesso ao grupo exclusivo de clientes assessorados',
    ],
  },
  assessorado_vista: {
    tagline: 'Assessoria completa 12 meses — pagamento único com desconto',
    precoLabel: 'R$ 5.000 à vista',
    features: [
      'Tudo do plano Assessorado',
      'Desconto especial no pagamento à vista',
      'Contrato digital de prestação de serviços',
    ],
  },
  clube: {
    tagline: 'Acesso premium com encontros presenciais e clube de negócios',
    precoLabel: 'R$ 5.000/mês',
    features: [
      'Tudo do plano Assessorado',
      'Encontros presenciais mensais com a equipe BidPro Brasil',
      'Clube exclusivo de deals e oportunidades',
      'Cocredenciamento em oportunidades selecionadas',
      'Acesso direto à carteira de parceiros (advogados, leiloeiros)',
      'Relatórios de inteligência de mercado',
    ],
  },
  clube_vista: {
    tagline: 'Clube de Negócios — pagamento único anual com máximo desconto',
    precoLabel: 'R$ 48.000 à vista',
    features: [
      'Tudo do Clube de Negócios mensal',
      '12 meses de acesso com valor diferenciado',
    ],
  },
};

/* ── WhatsApp mask helper ── */
function maskWA(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0,2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`;
}

const TIPO_LABELS = { ebook: 'eBook', curso: 'Curso', calculadora: 'Calculadora', plataforma: 'Acesso à Plataforma', minicurso: 'Mini-curso', webinar: 'Webinar', outro: 'Conteúdo' };

const inputStyle = { width: '100%', padding: '12px 14px', background: '#111111', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 15, outline: 'none', boxSizing: 'border-box' };
const labelStyle = { display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 6 };

/* ── Lead Capture (captura tipo) — multi-step funnel ── */
function CapturaLanding({ id }) {
  const [produto, setProduto] = useState(null);
  const [loading, setLoading] = useState(true);
  // step: 'hero' | 'perguntas' | 'cadastro' | 'sucesso'
  const [step, setStep] = useState('hero');
  const [respostas, setRespostas] = useState({});
  const [form, setForm] = useState({ nome: '', email: '', whatsapp: '', senha: '' });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [verSenha, setVerSenha] = useState(false);
  const [qIdx, setQIdx] = useState(0);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.from('sdr_produtos').select('*').eq('id', id).single();
      setProduto(data || null);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 16 }}>Carregando…</div>
  );

  if (!produto) return (
    <div style={{ minHeight: '100vh', background: '#111111', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#94a3b8', gap: 16 }}>
      <div style={{ fontSize: 40 }}>❌</div>
      <div style={{ fontSize: 18, color: '#e2e8f0' }}>Produto não encontrado.</div>
      <a href="/" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: 14 }}>← Voltar ao site</a>
    </div>
  );

  const perguntas = Array.isArray(produto.perguntas) ? produto.perguntas : [];
  const temPerguntas = perguntas.length > 0;
  const tipoLabel = TIPO_LABELS[produto.tipo] || 'Conteúdo';

  const Header = () => (
    <div style={{ borderBottom: '1px solid #111111', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ fontWeight: 900, fontSize: 18, color: 'white', letterSpacing: 1 }}>BidPro <span style={{ color: '#f59e0b' }}>Brasil</span></div>
      <a href="/" style={{ fontSize: 13, color: '#94a3b8', textDecoration: 'none' }}>← Voltar ao site</a>
    </div>
  );

  /* ── Step: SUCESSO ── */
  if (step === 'sucesso') {
    const msg = produto.mensagem_boas_vindas || `Seu acesso foi liberado! Todo o conteúdo está disponível dentro da plataforma BidPro Brasil.`;
    return (
      <div style={{ minHeight: '100vh', background: '#111111', fontFamily: "'Inter', sans-serif", color: '#e2e8f0' }}>
        <Header />
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
          <h2 style={{ fontSize: 28, fontWeight: 900, color: 'white', marginBottom: 12 }}>Acesso liberado!</h2>
          <p style={{ color: '#94a3b8', fontSize: 16, lineHeight: 1.6, marginBottom: 32 }}>
            Olá, <strong style={{ color: '#e2e8f0' }}>{form.nome.split(' ')[0]}</strong>! {msg}
          </p>
          <a href="/#/buscar"
            style={{ display: 'inline-block', padding: '14px 36px', background: '#059669', color: 'white', borderRadius: 12, fontWeight: 800, fontSize: 16, textDecoration: 'none', marginBottom: 16 }}>
            Acessar a plataforma →
          </a>
          {produto.conteudo_url && (
            <div style={{ marginTop: 12 }}>
              <a href={produto.conteudo_url} target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-block', padding: '12px 28px', background: '#111111', color: '#60a5fa', borderRadius: 12, fontWeight: 700, fontSize: 14, textDecoration: 'none', border: '1px solid #334155' }}>
                Acessar {tipoLabel} diretamente →
              </a>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ── Step: HERO ── */
  if (step === 'hero') {
    return (
      <div style={{ minHeight: '100vh', background: '#111111', fontFamily: "'Inter', sans-serif", color: '#e2e8f0' }}>
        <Header />
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px 80px' }}>
          {produto.imagem_url && (
            <img src={produto.imagem_url} alt={produto.nome} style={{ width: '100%', maxWidth: 400, borderRadius: 16, marginBottom: 24, objectFit: 'cover', display: 'block', margin: '0 auto 24px' }} />
          )}
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>{tipoLabel} Gratuito</div>
            <h1 style={{ margin: '0 0 12px', fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.2 }}>{produto.nome}</h1>
            {produto.descricao && <p style={{ margin: '0 0 20px', fontSize: 16, color: '#94a3b8', lineHeight: 1.6 }}>{produto.descricao}</p>}
          </div>

          {/* Commercial message */}
          <div style={{ background: 'linear-gradient(135deg, #065f46 0%, #0f2032 100%)', border: '1px solid #059669', borderRadius: 14, padding: '20px 24px', marginBottom: 28, textAlign: 'center' }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>🎁</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#34d399', marginBottom: 6 }}>Seu acesso é 100% gratuito</div>
            <div style={{ fontSize: 14, color: '#a7f3d0', lineHeight: 1.6 }}>
              O {tipoLabel.toLowerCase()} fica disponível <strong>dentro da plataforma BidPro Brasil</strong> — sem custo, sem cartão de crédito. Basta criar sua conta gratuita em menos de 1 minuto.
            </div>
          </div>

          <button onClick={() => { setQIdx(0); setStep(temPerguntas ? 'perguntas' : 'cadastro'); }}
            style={{ width: '100%', padding: '16px', background: '#059669', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 17, cursor: 'pointer', letterSpacing: 0.3 }}>
            Quero acesso gratuito →
          </button>
          <div style={{ textAlign: 'center', marginTop: 10, fontSize: 12, color: '#475569' }}>Cadastro rápido · Sem spam · Cancele quando quiser</div>
        </div>
      </div>
    );
  }

  /* ── Step: PERGUNTAS ── */
  if (step === 'perguntas') {
    const p = perguntas[qIdx];
    const isLast = qIdx === perguntas.length - 1;
    const respondida = p ? (p.tipo === 'texto' ? (respostas[p.id] || '').trim().length > 0 : !!respostas[p.id]) : false;
    const handleNext = () => {
      if (isLast) {
        setStep('cadastro');
      } else {
        setQIdx(i => i + 1);
      }
    };
    const handleBack = () => {
      if (qIdx === 0) {
        setQIdx(0);
        setStep('hero');
      } else {
        setQIdx(i => i - 1);
      }
    };
    return (
      <div style={{ minHeight: '100vh', background: '#111111', fontFamily: "'Inter', sans-serif", color: '#e2e8f0' }}>
        <Header />
        <div style={{ maxWidth: 560, margin: '0 auto', padding: '40px 24px 80px' }}>
          <div style={{ marginBottom: 24 }}>
            <button onClick={handleBack} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 16 }}>← Voltar</button>
            <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>Quase lá!</div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 900, color: 'white' }}>Responda rapidinho</h2>
              <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>Pergunta {qIdx + 1} de {perguntas.length}</span>
            </div>
            <div style={{ background: '#111111', borderRadius: 99, height: 6, overflow: 'hidden' }}>
              <div style={{ width: `${((qIdx + 1) / perguntas.length) * 100}%`, background: '#059669', height: '100%', borderRadius: 99, transition: 'width 0.3s ease' }} />
            </div>
          </div>
          {p && (
            <div style={{ background: '#111111', borderRadius: 12, padding: '24px 20px', border: '1px solid #334155', marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 15, fontWeight: 700, color: '#e2e8f0', marginBottom: 16, textAlign: 'center' }}>{p.texto}</label>
              {p.tipo === 'texto' && (
                <textarea value={respostas[p.id] || ''} onChange={e => setRespostas(r => ({ ...r, [p.id]: e.target.value }))}
                  placeholder="Sua resposta…"
                  style={{ ...inputStyle, height: 72, resize: 'vertical', fontSize: 14 }} />
              )}
              {p.tipo === 'sim_nao' && (
                <div style={{ display: 'flex', gap: 10 }}>
                  {['Sim', 'Não'].map(opt => (
                    <button key={opt} onClick={() => setRespostas(r => ({ ...r, [p.id]: opt }))}
                      style={{ flex: 1, padding: '10px', borderRadius: 8, border: `2px solid ${respostas[p.id] === opt ? '#059669' : '#334155'}`, background: respostas[p.id] === opt ? '#065f46' : '#111111', color: respostas[p.id] === opt ? '#34d399' : '#94a3b8', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                      {opt}
                    </button>
                  ))}
                </div>
              )}
              {p.tipo === 'multipla' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {(p.opcoes || '').split(',').map(opt => opt.trim()).filter(Boolean).map(opt => (
                    <button key={opt} onClick={() => setRespostas(r => ({ ...r, [p.id]: opt }))}
                      style={{ padding: '10px 14px', borderRadius: 8, border: `2px solid ${respostas[p.id] === opt ? '#059669' : '#334155'}`, background: respostas[p.id] === opt ? '#065f46' : '#111111', color: respostas[p.id] === opt ? '#34d399' : '#94a3b8', fontWeight: 600, fontSize: 14, cursor: 'pointer', textAlign: 'left' }}>
                      {respostas[p.id] === opt ? '● ' : '○ '}{opt}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button onClick={handleNext} disabled={!respondida}
            style={{ width: '100%', padding: '14px', background: respondida ? '#059669' : '#111111', color: respondida ? 'white' : '#64748b', border: `1px solid ${respondida ? '#059669' : '#334155'}`, borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: respondida ? 'pointer' : 'not-allowed' }}>
            {isLast ? 'Continuar →' : 'Próxima →'}
          </button>
        </div>
      </div>
    );
  }

  /* ── Step: CADASTRO ── */
  async function handleCadastro(e) {
    e.preventDefault();
    setErro('');
    const wa = form.whatsapp.replace(/\D/g, '');
    if (!form.nome.trim()) return setErro('Informe seu nome completo.');
    if (!form.email.trim() || !/\S+@\S+\.\S+/.test(form.email)) return setErro('Informe um e-mail válido.');
    if (wa.length < 10) return setErro('Informe um WhatsApp válido.');
    if (form.senha.length < 6) return setErro('A senha deve ter pelo menos 6 caracteres.');
    setEnviando(true);
    try {
      // Create Supabase auth account
      const { data: authData, error: authErr } = await supabase.auth.signUp({
        email: form.email.trim(),
        password: form.senha,
        options: { data: { nome: form.nome.trim(), whatsapp: wa } },
      });
      if (authErr) {
        if (authErr.message?.includes('already registered')) {
          setErro('Esse e-mail já tem uma conta. Acesse a plataforma normalmente.');
        } else {
          setErro(authErr.message || 'Erro ao criar conta. Tente novamente.');
        }
        setEnviando(false);
        return;
      }
      const userId = authData?.user?.id;
      // Insert lead
      await supabase.from('sdr_leads').insert({
        produto_id: produto.id,
        nome: form.nome.trim(),
        whatsapp: wa,
        email: form.email.trim(),
        origem: window.location.href,
        respostas: respostas,
        user_id: userId || null,
      });
      setStep('sucesso');
    } catch (_) {
      setErro('Erro inesperado. Tente novamente.');
    }
    setEnviando(false);
  }

  return (
    <div style={{ minHeight: '100vh', background: '#111111', fontFamily: "'Inter', sans-serif", color: '#e2e8f0' }}>
      <Header />
      <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 24px 80px' }}>
        <button onClick={() => setStep(temPerguntas ? 'perguntas' : 'hero')} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 20 }}>← Voltar</button>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 6 }}>Último passo</div>
          <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 900, color: 'white' }}>Crie sua conta gratuita</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#64748b' }}>Seu {tipoLabel.toLowerCase()} estará disponível dentro da plataforma assim que você entrar.</p>
        </div>
        <form onSubmit={handleCadastro} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={labelStyle}>Nome completo *</label>
            <input type="text" value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))} placeholder="Seu nome completo" required style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>E-mail *</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="seuemail@exemplo.com" required style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>WhatsApp *</label>
            <input type="tel" value={form.whatsapp} onChange={e => setForm(f => ({ ...f, whatsapp: maskWA(e.target.value) }))} placeholder="(00) 00000-0000" required style={inputStyle} />
          </div>
          <div>
            <label style={labelStyle}>Senha *</label>
            <div style={{ position: 'relative' }}>
              <input type={verSenha ? 'text' : 'password'} value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))} placeholder="Mínimo 6 caracteres" required style={{ ...inputStyle, paddingRight: 48 }} />
              <button type="button" onClick={() => setVerSenha(v => !v)}
                style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 13 }}>
                {verSenha ? 'Ocultar' : 'Ver'}
              </button>
            </div>
          </div>
          {erro && <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>{erro}</div>}
          <button type="submit" disabled={enviando}
            style={{ padding: '14px', background: enviando ? '#374151' : '#059669', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 16, cursor: enviando ? 'not-allowed' : 'pointer', marginTop: 4 }}>
            {enviando ? 'Criando conta…' : 'Criar conta e liberar acesso →'}
          </button>
          <div style={{ textAlign: 'center', fontSize: 11, color: '#475569', lineHeight: 1.5 }}>
            Ao se cadastrar você concorda com os Termos de Uso da BidPro Brasil. Acesso gratuito, sem cobranças automáticas.
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProdutoLanding() {
  const { tipo, id } = useParams();
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const { user, isLoggedIn } = useAuth();

  // SDR lead capture flow
  if (tipo === 'captura') {
    return <CapturaLanding id={id} />;
  }


  const ref = searchParams.get('ref') || '';
  const [produto, setProduto] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      if (tipo === 'plano') {
        const info = PLANOS_INFO[id];
        if (info) {
          const { data } = await supabase.from('planos_config').select('plano_key,nome,preco,preco_vista,ativo').eq('plano_key', id).single();
          let precoLabel = info.precoLabel;
          let nome = id === 'top2' ? 'Investidor Pro' : id === 'assessorado' ? 'Assessorado' : id === 'assessorado_vista' ? 'Assessorado (À Vista)' : id === 'clube' ? 'Clube de Negócios' : 'Clube de Negócios (À Vista)';
          if (data) {
            nome = data.nome || nome;
            const fmtBRL = (v) => `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits:2, maximumFractionDigits:2 })}`;
            if (data.preco) {
              if (data.preco_vista) {
                precoLabel = `${fmtBRL(data.preco)} em 12× · ${fmtBRL(data.preco_vista)} à vista`;
              } else {
                precoLabel = `${fmtBRL(data.preco)} em 12×`;
              }
            }
          }
          setProduto({ tipo: 'plano', key: id, nome, precoLabel, precoVista: data?.preco_vista, tagline: info.tagline, features: info.features });
        }
      } else if (tipo === 'curso') {
        const { data } = await supabase.from('cursos_admin').select('id,titulo,subtitulo,descricao,preco,emoji,cor').eq('id', id).single();
        if (data) {
          setProduto({ tipo: 'curso', ...data });
        }
      }
      setLoading(false);
    }
    load();
  }, [tipo, id]);

  if (loading) return <div style={{ minHeight:'100vh', background:'#111111', display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:16 }}>Carregando…</div>;

  if (!produto) return (
    <div style={{ minHeight:'100vh', background:'#111111', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', color:'#94a3b8', gap:16 }}>
      <div style={{ fontSize:40 }}>❌</div>
      <div style={{ fontSize:18, color:'#e2e8f0' }}>Produto não encontrado.</div>
      <a href="/" style={{ color:'#60a5fa', textDecoration:'none', fontSize:14 }}>← Voltar ao site</a>
    </div>
  );

  const isPlano = produto.tipo === 'plano';
  const checkoutPath = isPlano
    ? `/#/checkout?plano=${produto.key}&ref=${ref}`
    : `/#/checkout?curso=${produto.id}&ref=${ref}`;
  const loginPath = isPlano
    ? `/login?plano=${produto.key}&ref=${ref}`
    : `/login?curso=${produto.id}&ref=${ref}`;

  const handleCTA = () => {
    if (isLoggedIn) {
      window.location.href = checkoutPath;
    } else {
      nav(loginPath);
    }
  };

  const ctaLabel = isLoggedIn
    ? (isPlano ? 'Assinar agora' : 'Adquirir curso')
    : (isPlano ? 'Criar conta e assinar' : 'Criar conta e adquirir');

  const accentColor = isPlano ? '#f59e0b' : (produto.cor || '#0D63DB');
  const emoji = isPlano ? '📋' : (produto.emoji || '🎓');
  const preco = isPlano ? produto.precoLabel : (Number(produto.preco) > 0 ? `R$ ${Number(produto.preco).toFixed(2).replace('.',',')}` : 'Gratuito');

  return (
    <div style={{ minHeight:'100vh', background:'#111111', fontFamily:"'Inter', sans-serif", color:'#e2e8f0' }}>
      {/* Header */}
      <div style={{ borderBottom:'1px solid #111111', padding:'16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontWeight:900, fontSize:18, color:'white', letterSpacing:1 }}>
          BidPro <span style={{ color:'#f59e0b' }}>Brasil</span>
        </div>
        <a href="/" style={{ fontSize:13, color:'#94a3b8', textDecoration:'none' }}>← Voltar ao site</a>
      </div>

      <div style={{ maxWidth:700, margin:'0 auto', padding:'48px 24px 80px' }}>
        {/* Hero */}
        <div style={{ textAlign:'center', marginBottom:48 }}>
          <div style={{ fontSize:64, marginBottom:16 }}>{emoji}</div>
          <div style={{ fontSize:12, fontWeight:800, color:accentColor, textTransform:'uppercase', letterSpacing:2, marginBottom:8 }}>
            {isPlano ? 'Plano' : 'Curso'}
          </div>
          <h1 style={{ margin:'0 0 12px', fontSize:36, fontWeight:900, color:'white', lineHeight:1.2 }}>
            {isPlano ? produto.nome : produto.titulo}
          </h1>
          <p style={{ margin:'0 0 24px', fontSize:17, color:'#94a3b8', lineHeight:1.6 }}>
            {isPlano ? produto.tagline : (produto.subtitulo || produto.tagline)}
          </p>
          <div style={{ fontSize:32, fontWeight:900, color:'#f8fafc', marginBottom:32 }}>{preco}</div>
          <button onClick={handleCTA}
            style={{ padding:'16px 40px', background:'#059669', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:17, cursor:'pointer', letterSpacing:0.5 }}>
            {ctaLabel}
          </button>
        </div>

        {/* Features / Descrição */}
        {isPlano ? (
          <div style={{ background:'#111111', borderRadius:16, padding:'28px 32px', marginBottom:32 }}>
            <div style={{ fontSize:14, fontWeight:800, color:accentColor, textTransform:'uppercase', letterSpacing:1, marginBottom:18 }}>O que está incluso</div>
            <ul style={{ listStyle:'none', margin:0, padding:0, display:'flex', flexDirection:'column', gap:12 }}>
              {produto.features.map((f, i) => (
                <li key={i} style={{ display:'flex', alignItems:'flex-start', gap:10, fontSize:15, color:'#cbd5e1', lineHeight:1.5 }}>
                  <span style={{ color:'#059669', fontWeight:900, flexShrink:0, marginTop:2 }}>✓</span>
                  {f}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div style={{ background:'#111111', borderRadius:16, padding:'28px 32px', marginBottom:32 }}>
            <div style={{ fontSize:14, fontWeight:800, color:accentColor, textTransform:'uppercase', letterSpacing:1, marginBottom:16 }}>Sobre o curso</div>
            {produto.descricao && (
              <p style={{ fontSize:15, color:'#cbd5e1', lineHeight:1.7, margin:0, whiteSpace:'pre-wrap' }}>{produto.descricao}</p>
            )}
          </div>
        )}

        {/* Transparência / Chargeback */}
        <div style={{ background:'#0f2032', border:'1px solid #1e3a5f', borderRadius:16, padding:'28px 32px', marginBottom:40 }}>
          <div style={{ fontSize:14, fontWeight:800, color:'#60a5fa', textTransform:'uppercase', letterSpacing:1, marginBottom:16 }}>O que você está contratando</div>
          <div style={{ display:'flex', flexDirection:'column', gap:12, fontSize:14, color:'#94a3b8', lineHeight:1.6 }}>
            <p style={{ margin:0 }}>
              Ao clicar em "{ctaLabel}" você contrata diretamente com BidPro Brasil o {isPlano ? `plano ${produto.nome}` : `curso ${produto.titulo}`} conforme descrito acima.
            </p>
            <p style={{ margin:0, color:'#cbd5e1' }}>
              <strong style={{ color:'white' }}>Cancelamento:</strong> a qualquer momento em Minha Conta → Cancelar plano. Sem multa.
            </p>
            <p style={{ margin:0, color:'#94a3b8', fontSize:12 }}>
              Esta contratação fica registrada com IP, data/hora e aceite eletrônico.
            </p>
          </div>
        </div>

        {/* CTA final */}
        <div style={{ textAlign:'center' }}>
          <button onClick={handleCTA}
            style={{ padding:'16px 48px', background:'#059669', color:'white', border:'none', borderRadius:12, fontWeight:800, fontSize:18, cursor:'pointer', letterSpacing:0.5 }}>
            {ctaLabel}
          </button>
          <div style={{ marginTop:12, fontSize:12, color:'#475569' }}>Sem fidelidade. Cancele quando quiser.</div>
        </div>
      </div>
    </div>
  );
}
