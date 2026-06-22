import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, BarChart3, ShieldCheck, FileText, TrendingUp, Zap, Users, ChevronRight, CheckCircle2, Star, Building2, Gavel, Globe } from 'lucide-react';
import { PLANOS } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';

export default function Landing() {
  const nav = useNavigate();
  const { user } = useAuth();

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* HERO */}
      <section style={{ background: 'linear-gradient(135deg, #111111 0%, #1e3a5f 100%)', padding: '80px 20px 100px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle at 20% 80%, #0D63DB22 0%, transparent 50%), radial-gradient(circle at 80% 20%, #10b98122 0%, transparent 50%)' }} />
        <div style={{ maxWidth: 800, margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#0D63DB22', border: '1px solid #0D63DB44', borderRadius: 20, padding: '6px 16px', fontSize: 12, color: '#93c5fd', fontWeight: 700, marginBottom: 28, textTransform: 'uppercase', letterSpacing: 1 }}>
            <Gavel size={12} /> Leilões Imobiliários com Inteligência
          </div>
          <h1 style={{ fontSize: 'clamp(32px, 6vw, 58px)', fontWeight: 900, color: 'white', lineHeight: 1.1, margin: '0 0 20px', letterSpacing: '-1px' }}>
            Arrematação Inteligente.<br />
            <span style={{ background: 'linear-gradient(90deg, #60a5fa, #34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Lucro Garantido.</span>
          </h1>
          <p style={{ fontSize: 18, color: '#94a3b8', maxWidth: 600, margin: '0 auto 40px', lineHeight: 1.7 }}>
            A TSN Ativos transforma leilões imobiliários em oportunidades estruturadas. Busca, análise financeira, avaliação jurídica e laudo de mercado — tudo em uma plataforma.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => nav(user ? '/buscar' : '/login')}
              style={{ padding: '14px 28px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Search size={16} /> Buscar Imóveis em Leilão
            </button>
            <button onClick={() => nav(user ? '/analise' : '/login')}
              style={{ padding: '14px 28px', background: 'white', color: '#111111', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart3 size={16} /> Analisar um Imóvel <ChevronRight size={14} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 32, justifyContent: 'center', marginTop: 52, flexWrap: 'wrap' }}>
            {[['R$ 70M+','em arrematações'], ['11','estados atendidos'], ['8 anos','de experiência'], ['40%+','retorno médio']].map(([v, l]) => (
              <div key={v} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: 'white' }}>{v}</div>
                <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NÚMEROS DA PLATAFORMA */}
      <section style={{ padding: '48px 20px', background: 'white', borderTop: '1px solid #f1f5f9' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>Plataforma em Números</div>
            <h2 style={{ fontSize: 28, fontWeight: 900, color: '#111111', margin: 0 }}>Resultados reais de quem usa o método TSN</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            {[
              { label: 'Volume arrematado', value: 'R$ 70M+', sub: 'em imóveis no portfólio TSN', color: '#0D63DB', bg: '#eff6ff', icon: '🏦' },
              { label: 'ROI médio realizado', value: '48%', sub: 'por operação concluída', color: '#10b981', bg: '#f0fdf4', icon: '📈' },
              { label: 'Imóveis analisados', value: '1.200+', sub: 'pela plataforma', color: '#8b5cf6', bg: '#f5f3ff', icon: '🔍' },
              { label: 'Estados atendidos', value: '11', sub: 'com leiloeiros credenciados', color: '#f59e0b', bg: '#fffbeb', icon: '📍' },
              { label: 'Economia média', value: '34%', sub: 'abaixo do valor de mercado', color: '#ef4444', bg: '#fff1f2', icon: '🏷️' },
              { label: 'Tempo de análise', value: '< 5 min', sub: 'com inteligência artificial', color: '#0891b2', bg: '#ecfeff', icon: '⚡' },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, borderRadius: 14, padding: '20px 18px', border: `1px solid ${s.color}20` }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{s.icon}</div>
                <div style={{ fontSize: 26, fontWeight: 900, color: s.color, lineHeight: 1 }}>{s.value}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: s.color, marginTop: 4 }}>{s.label}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3, lineHeight: 1.4 }}>{s.sub}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 24, background: 'linear-gradient(135deg, #111111 0%, #1e3a5f 100%)', borderRadius: 14, padding: '20px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 4 }}>Quer ver os números do seu portfólio aqui?</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'white' }}>Comece gratuitamente — sem cartão de crédito</div>
            </div>
            <button onClick={() => nav('/buscar')}
              style={{ padding: '12px 24px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              Buscar meu primeiro imóvel →
            </button>
          </div>
        </div>
      </section>

      {/* COMO FUNCIONA */}
      <section style={{ padding: '80px 20px', background: '#f8fafc' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <h2 style={{ fontSize: 34, fontWeight: 900, color: '#111111', margin: '0 0 12px' }}>Como Funciona</h2>
            <p style={{ color: '#64748b', fontSize: 16 }}>Três passos para uma arrematação estruturada e lucrativa</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 24 }}>
            {[
              { n: '01', icon: Search, color: '#0D63DB', title: 'Buscar o Imóvel', desc: 'Pesquise em todos os leiloeiros credenciados pelas Juntas Comerciais do país. Filtre por tipo, cidade, valor, modalidade e data.' },
              { n: '02', icon: BarChart3, color: '#10b981', title: 'Analisar a Viabilidade', desc: 'Carregue o edital e a matrícula. A IA extrai os dados e gera a análise financeira, mercadológica e jurídica automaticamente.' },
              { n: '03', icon: FileText, color: '#8b5cf6', title: 'Apresentar ao Cliente', desc: 'Gere o relatório executivo com defesa da arrematação, projeções financeiras SAC/Price, yield de locação e comparativos de mercado.' },
            ].map(s => (
              <div key={s.n} style={{ background: 'white', borderRadius: 16, padding: '28px 24px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ background: `${s.color}20`, borderRadius: 12, padding: 10 }}><s.icon size={22} color={s.color} /></div>
                  <span style={{ fontSize: 36, fontWeight: 900, color: '#e2e8f0' }}>{s.n}</span>
                </div>
                <h3 style={{ fontSize: 17, fontWeight: 800, color: '#111111', margin: '0 0 10px' }}>{s.title}</h3>
                <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.7, margin: 0 }}>{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CALCULADORA CTA */}
      <section style={{ padding: '64px 20px', background: 'linear-gradient(135deg,#111111 0%,#1e3a5f 100%)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 48, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#10b98122', border: '1px solid #10b98144', borderRadius: 20, padding: '6px 14px', fontSize: 11, color: '#34d399', fontWeight: 800, marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 }}>
              Ferramenta gratuita
            </div>
            <h2 style={{ fontSize: 30, fontWeight: 900, color: 'white', margin: '0 0 14px', lineHeight: 1.2 }}>
              Calcule o teto máximo de lance antes de arrematar
            </h2>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.8, margin: '0 0 24px' }}>
              Insira o valor do imóvel, débitos assumidos, reforma estimada e o ROI desejado. Nossa calculadora mostra quanto você pode pagar no leilão — e ainda lucrar.
            </p>
            <button onClick={() => nav('/calculadora')}
              style={{ padding: '13px 28px', background: '#10b981', color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              🧮 Usar a Calculadora de Lances
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 220, background: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: '24px 22px', border: '1px solid rgba(255,255,255,0.1)' }}>
            {[
              ['Valor de arrematação', 'R$ 280.000'],
              ['Débitos + reforma', 'R$ 32.000'],
              ['Valor de mercado', 'R$ 450.000'],
              ['ROI desejado', '30%'],
            ].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.07)', fontSize: 13 }}>
                <span style={{ color: '#94a3b8' }}>{l}</span>
                <span style={{ color: 'white', fontWeight: 700 }}>{v}</span>
              </div>
            ))}
            <div style={{ marginTop: 14, padding: '12px 14px', background: '#10b98122', borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#34d399', fontWeight: 800, fontSize: 13 }}>Teto máximo de lance</span>
              <span style={{ color: '#34d399', fontWeight: 900, fontSize: 20 }}>R$ 314.769</span>
            </div>
          </div>
        </div>
      </section>

      {/* RECURSOS */}
      <section style={{ padding: '80px 20px', background: 'white' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 60, alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: 34, fontWeight: 900, color: '#111111', margin: '0 0 20px', lineHeight: 1.2 }}>Análise completa em minutos, não semanas</h2>
              <p style={{ color: '#64748b', fontSize: 15, lineHeight: 1.8, marginBottom: 28 }}>
                Nossa plataforma usa Inteligência Artificial para extrair dados do edital e da matrícula, pesquisar comparativos de mercado no mesmo condomínio ou rua, calcular a viabilidade financeira e identificar riscos jurídicos que poderiam inviabilizar a posse.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {[
                  { icon: Zap, text: 'Auto-extração de dados do edital e matrícula com IA' },
                  { icon: TrendingUp, text: 'Projeções financeiras SAC e PRICE comparadas' },
                  { icon: Globe, text: 'Comparativos do mesmo condomínio e vizinhança' },
                  { icon: ShieldCheck, text: 'Identificação de usufruto, hipoteca e outros gravames' },
                  { icon: BarChart3, text: 'Yield de locação mensal e anual de referência' },
                  { icon: FileText, text: 'Relatório PDF profissional para apresentar ao cliente' },
                ].map(f => (
                  <div key={f.text} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ background: '#dbeafe', borderRadius: 8, padding: 7, flexShrink: 0 }}><f.icon size={15} color="#0D63DB" /></div>
                    <span style={{ fontSize: 14, color: '#334155', paddingTop: 5, lineHeight: 1.4 }}>{f.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'ROI Médio', value: '48%', sub: 'por operação', color: '#10b981', bg: '#d1fae5' },
                { label: 'Economia vs Mercado', value: '32%', sub: 'uso próprio', color: '#0D63DB', bg: '#dbeafe' },
                { label: 'Yield Locação', value: '0,8%', sub: 'ao mês (referência)', color: '#8b5cf6', bg: '#ede9fe' },
                { label: 'Análises', value: '< 5min', sub: 'com IA', color: '#f59e0b', bg: '#fef3c7' },
              ].map(k => (
                <div key={k.label} style={{ background: k.bg, borderRadius: 14, padding: '20px 18px', textAlign: 'center' }}>
                  <div style={{ fontSize: 32, fontWeight: 900, color: k.color }}>{k.value}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: k.color, marginTop: 4 }}>{k.label}</div>
                  <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{k.sub}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* PLANOS */}
      <section style={{ padding: '80px 20px', background: '#f8fafc' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <h2 style={{ fontSize: 34, fontWeight: 900, color: '#111111', margin: '0 0 12px' }}>Planos & Preços</h2>
            <p style={{ color: '#64748b', fontSize: 16 }}>Comece gratuitamente, evolua quando precisar</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20 }}>
            {Object.entries(PLANOS).filter(([, p]) => p.homepage).map(([key, plano]) => (
              <div key={key} style={{ background: 'white', borderRadius: 16, border: plano.destaque ? `2px solid ${plano.cor}` : '1px solid #e2e8f0', padding: '28px 24px', position: 'relative', boxShadow: plano.destaque ? '0 8px 24px rgba(37,99,235,0.15)' : '0 2px 8px rgba(0,0,0,0.05)' }}>
                {plano.destaque && <div style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: plano.cor, color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>Mais Popular</div>}
                <div style={{ fontSize: 14, fontWeight: 700, color: plano.cor, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>{plano.nome}</div>
                <div style={{ fontSize: 36, fontWeight: 900, color: '#111111', marginBottom: 4 }}>
                  {plano.precoLabel}
                </div>
                {plano.preco > 0 && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 24 }}>{plano.periodicidade}</div>}
                <div style={{ height: 1, background: '#e2e8f0', margin: '16px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
                  {(plano.recursos || plano.features || []).map(f => (
                    <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.4 }}>{f}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => {
                  if (plano.preco === 0) { nav('/login'); return; }
                  nav(user ? `/checkout?plano=${key}` : `/login?plano=${key}`);
                }}
                  style={{ width: '100%', padding: '11px', border: plano.destaque ? 'none' : `2px solid ${plano.cor}`, borderRadius: 10, background: plano.destaque ? plano.cor : 'transparent', color: plano.destaque ? 'white' : plano.cor, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  {plano.preco === 0 ? 'Começar Grátis' : 'Assinar Agora'}
                </button>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <button onClick={() => nav('/planos')}
              style={{ padding: '12px 28px', border: '2px solid #0D63DB', borderRadius: 10, background: 'transparent', color: '#0D63DB', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Ver todos os planos, incluindo Assessoria e Clube de Negócios →
            </button>
          </div>
          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 13, color: '#94a3b8' }}>Pagamento via boleto, Pix ou cartão de crédito · Cancele quando quiser</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ background: '#111111', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: 'white', marginBottom: 8 }}>TSN ATIVOS</div>
          <div style={{ fontSize: 12, color: '#475569', marginBottom: 20 }}>Aquisição em Leilão & Investimentos Estratégicos · Honorários Jurídicos 10%</div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap', marginBottom: 20 }}>
            {['Buscar Leilões', 'Fazer Análise', 'Meu Painel', 'Planos'].map(l => (
              <button key={l} onClick={() => nav(l === 'Buscar Leilões' ? '/buscar' : l === 'Fazer Análise' ? '/analise' : l === 'Meu Painel' ? '/painel' : '/')}
                style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', fontWeight: 500 }}>{l}</button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: '#334155' }}>© {new Date().getFullYear()} TSN Ativos. Todos os direitos reservados.</div>
        </div>
      </footer>
    </div>
  );
}
