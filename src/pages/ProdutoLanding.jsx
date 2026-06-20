import React, { useState, useEffect } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

const PLANOS_INFO = {
  top1: {
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
      'Análises ilimitadas de imóveis',
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
      'Encontros presenciais mensais com a equipe TSN',
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

/* ── Lead Capture (captura tipo) ── */
function CapturaLanding({ id }) {
  const [produto, setProduto] = useState(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ nome: '', whatsapp: '', email: '' });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('sdr_produtos')
        .select('*')
        .eq('id', id)
        .single();
      setProduto(data || null);
      setLoading(false);
    }
    load();
  }, [id]);

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 16 }}>
      Carregando…
    </div>
  );

  if (!produto) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: '#94a3b8', gap: 16 }}>
      <div style={{ fontSize: 40 }}>❌</div>
      <div style={{ fontSize: 18, color: '#e2e8f0' }}>Produto não encontrado.</div>
      <a href="/" style={{ color: '#60a5fa', textDecoration: 'none', fontSize: 14 }}>← Voltar ao site</a>
    </div>
  );

  async function handleSubmit(e) {
    e.preventDefault();
    setErro('');
    const wa = form.whatsapp.replace(/\D/g, '');
    if (!form.nome.trim()) return setErro('Informe seu nome completo.');
    if (wa.length < 10) return setErro('Informe um WhatsApp válido.');
    setEnviando(true);
    const { error } = await supabase.from('sdr_leads').insert({
      produto_id: produto.id,
      nome: form.nome.trim(),
      whatsapp: wa,
      email: form.email.trim() || null,
      origem: window.location.href,
    });
    setEnviando(false);
    if (error) return setErro('Erro ao enviar. Tente novamente.');
    setSucesso(true);
  }

  if (sucesso) return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: "'Inter', sans-serif", color: '#e2e8f0' }}>
      <div style={{ borderBottom: '1px solid #1e293b', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: 'white', letterSpacing: 1 }}>TSN <span style={{ color: '#f59e0b' }}>ATIVOS</span></div>
      </div>
      <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🎉</div>
        <h2 style={{ fontSize: 28, fontWeight: 900, color: 'white', marginBottom: 12 }}>Acesso liberado!</h2>
        <p style={{ color: '#94a3b8', fontSize: 16, lineHeight: 1.6, marginBottom: 32 }}>
          Obrigado, <strong style={{ color: '#e2e8f0' }}>{form.nome.split(' ')[0]}</strong>! Seu acesso foi liberado. Clique abaixo para acessar o conteúdo.
        </p>
        {produto.conteudo_url ? (
          <a href={produto.conteudo_url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', padding: '14px 36px', background: '#059669', color: 'white', borderRadius: 12, fontWeight: 800, fontSize: 16, textDecoration: 'none' }}>
            Acessar conteúdo →
          </a>
        ) : (
          <p style={{ color: '#64748b', fontSize: 14 }}>Em breve você receberá o acesso via WhatsApp.</p>
        )}
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', fontFamily: "'Inter', sans-serif", color: '#e2e8f0' }}>
      {/* Header */}
      <div style={{ borderBottom: '1px solid #1e293b', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 900, fontSize: 18, color: 'white', letterSpacing: 1 }}>TSN <span style={{ color: '#f59e0b' }}>ATIVOS</span></div>
        <a href="/" style={{ fontSize: 13, color: '#94a3b8', textDecoration: 'none' }}>← Voltar ao site</a>
      </div>

      <div style={{ maxWidth: 560, margin: '0 auto', padding: '48px 24px 80px' }}>
        {/* Hero */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          {produto.imagem_url && (
            <img src={produto.imagem_url} alt={produto.nome}
              style={{ width: '100%', maxWidth: 400, borderRadius: 16, marginBottom: 24, objectFit: 'cover' }} />
          )}
          <div style={{ fontSize: 12, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>
            {produto.tipo === 'ebook' ? 'eBook Gratuito' : produto.tipo === 'minicurso' ? 'Mini-curso Gratuito' : produto.tipo === 'webinar' ? 'Webinar Gratuito' : 'Conteúdo Gratuito'}
          </div>
          <h1 style={{ margin: '0 0 12px', fontSize: 32, fontWeight: 900, color: 'white', lineHeight: 1.2 }}>{produto.nome}</h1>
          {produto.descricao && (
            <p style={{ margin: '0 0 8px', fontSize: 16, color: '#94a3b8', lineHeight: 1.6 }}>{produto.descricao}</p>
          )}
        </div>

        {/* Form */}
        <div style={{ background: '#1e293b', borderRadius: 16, padding: '32px', border: '1px solid #334155' }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 20 }}>
            Preencha para ter acesso gratuito
          </div>
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>Nome completo *</label>
              <input
                type="text"
                value={form.nome}
                onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Seu nome completo"
                required
                style={{ width: '100%', padding: '12px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>WhatsApp *</label>
              <input
                type="tel"
                value={form.whatsapp}
                onChange={e => setForm(f => ({ ...f, whatsapp: maskWA(e.target.value) }))}
                placeholder="(00) 00000-0000"
                required
                style={{ width: '100%', padding: '12px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>E-mail (opcional)</label>
              <input
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="seuemail@exemplo.com"
                style={{ width: '100%', padding: '12px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#e2e8f0', fontSize: 15, outline: 'none', boxSizing: 'border-box' }}
              />
            </div>
            {erro && <div style={{ background: '#450a0a', border: '1px solid #dc2626', borderRadius: 8, padding: '10px 14px', color: '#fca5a5', fontSize: 13 }}>{erro}</div>}
            <button type="submit" disabled={enviando}
              style={{ padding: '14px', background: enviando ? '#374151' : '#059669', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 16, cursor: enviando ? 'not-allowed' : 'pointer', marginTop: 4 }}>
              {enviando ? 'Enviando…' : 'Quero acesso gratuito →'}
            </button>
          </form>
        </div>
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
          let nome = id === 'top1' ? 'Investidor' : id === 'assessorado' ? 'Assessorado' : id === 'assessorado_vista' ? 'Assessorado (À Vista)' : id === 'clube' ? 'Clube de Negócios' : 'Clube de Negócios (À Vista)';
          if (data) {
            nome = data.nome || nome;
            if (data.preco) precoLabel = `R$ ${Number(data.preco).toFixed(2).replace('.',',')}`;
          }
          setProduto({ tipo: 'plano', key: id, nome, precoLabel, tagline: info.tagline, features: info.features });
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

  if (loading) return <div style={{ minHeight:'100vh', background:'#0f172a', display:'flex', alignItems:'center', justifyContent:'center', color:'#94a3b8', fontSize:16 }}>Carregando…</div>;

  if (!produto) return (
    <div style={{ minHeight:'100vh', background:'#0f172a', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', color:'#94a3b8', gap:16 }}>
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

  const accentColor = isPlano ? '#f59e0b' : (produto.cor || '#2563eb');
  const emoji = isPlano ? '📋' : (produto.emoji || '🎓');
  const preco = isPlano ? produto.precoLabel : (Number(produto.preco) > 0 ? `R$ ${Number(produto.preco).toFixed(2).replace('.',',')}` : 'Gratuito');

  return (
    <div style={{ minHeight:'100vh', background:'#0f172a', fontFamily:"'Inter', sans-serif", color:'#e2e8f0' }}>
      {/* Header */}
      <div style={{ borderBottom:'1px solid #1e293b', padding:'16px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ fontWeight:900, fontSize:18, color:'white', letterSpacing:1 }}>
          TSN <span style={{ color:'#f59e0b' }}>ATIVOS</span>
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
          <div style={{ background:'#1e293b', borderRadius:16, padding:'28px 32px', marginBottom:32 }}>
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
          <div style={{ background:'#1e293b', borderRadius:16, padding:'28px 32px', marginBottom:32 }}>
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
              Ao clicar em "{ctaLabel}" você contrata diretamente com TSN Ativos o {isPlano ? `plano ${produto.nome}` : `curso ${produto.titulo}`} conforme descrito acima.
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
