import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, BarChart3, ShieldCheck, FileText, TrendingUp, Zap,
  ChevronRight, CheckCircle2, Star, Gavel, Users, Lock, Clock,
  MapPin, ArrowRight, ChevronDown, ChevronUp, Sparkles, BadgeCheck, HelpCircle,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

const STATS = [
  { v: 'R$ 70M+', l: 'em arrematações assessoradas' },
  { v: '11',      l: 'estados com operações realizadas' },
  { v: '8 anos',  l: 'de experiência no mercado' },
  { v: '< 5 min', l: 'para gerar análise completa' },
];

// As 5 perguntas que travam todo mundo (insight de posicionamento) — e como a Bid Pro responde.
const PERGUNTAS = [
  { q: 'Esse imóvel é seguro?',            r: 'A análise jurídica e o Bid Score mapeiam ônus, processos e sanções do executado antes do lance.', icon: ShieldCheck },
  { q: 'Tem alguma bomba escondida?',      r: 'A IA lê o edital e a matrícula e destaca penhoras, usufruto, indisponibilidade e risco de perda do imóvel.', icon: FileText },
  { q: 'Quanto realmente vale?',           r: 'Comparativos de mercado e a viabilidade calculam o valor real e o desconto efetivo da oportunidade.', icon: BarChart3 },
  { q: 'Quanto vou gastar depois?',        r: 'O relatório lista débitos, IPTU, condomínio e custos de regularização a confirmar antes de arrematar.', icon: TrendingUp },
  { q: 'Vale a pena entrar nesse leilão?', r: 'O Bid Score traduz tudo numa nota de 0 a 100 e numa recomendação clara: arrematar ou passar.', icon: Gavel },
];

// Exemplos de Bid Score (assinatura visual da marca — estilo "Serasa dos leilões").
const BID_EXEMPLOS = [
  { nota: 94, cor: '#10b981', bg: '#f0fdf4', emoji: '🟢', t: 'Excelente oportunidade', d: 'Sem ônus relevantes na matrícula. Desconto de 38% sobre o mercado.' },
  { nota: 73, cor: '#f59e0b', bg: '#fffbeb', emoji: '🟡', t: 'Boa oportunidade',        d: 'Imóvel ocupado — prever custo e prazo de desocupação.' },
  { nota: 31, cor: '#ef4444', bg: '#fef2f2', emoji: '🔴', t: 'Risco elevado',           d: 'Três processos pendentes e penhora ativa. Recomendação: passar.' },
];

const PASSOS = [
  { n: '01', icon: Search,    cor: '#0D63DB', titulo: 'Encontre o imóvel',     desc: 'Busque em todos os leiloeiros credenciados do Brasil. Filtre por tipo, cidade, valor e data do leilão.' },
  { n: '02', icon: FileText,  cor: '#8b5cf6', titulo: 'Analise a viabilidade', desc: 'Carregue o edital e a matrícula. A IA extrai dados e gera análise financeira, jurídica e mercadológica em minutos.' },
  { n: '03', icon: ShieldCheck,cor:'#10b981', titulo: 'Identifique os riscos',  desc: 'Penhoras, usufruto, hipotecas, ações judiciais e outros ônus que podem inviabilizar a posse — tudo mapeado antes do lance.' },
  { n: '04', icon: Gavel,     cor: '#f59e0b', titulo: 'Arremate com segurança', desc: 'Com a nossa equipe do seu lado — da estratégia de lance à documentação e ao registro do imóvel.' },
];

const RECURSOS = [
  { icon: Zap,         titulo: 'IA que lê editais',          desc: 'Extração automática de dados do edital e da matrícula. Sem digitar nada manualmente.' },
  { icon: TrendingUp,  titulo: 'Projeções financeiras',       desc: 'Cenários SAC e Price, rentabilidade do aluguel, ROI esperado e teto máximo de lance calculados na hora.' },
  { icon: ShieldCheck, titulo: 'Análise jurídica completa',   desc: 'Gravames, ônus reais, processos judiciais e risco de perda do imóvel identificados antes da arrematação.' },
  { icon: BarChart3,   titulo: 'Comparativos de mercado',     desc: 'Imóveis similares na mesma rua ou condomínio para defender o valor da oferta com dados reais.' },
  { icon: FileText,    titulo: 'Relatório executivo PDF',     desc: 'Documento profissional para apresentar ao cliente, ao sócio ou à família antes de arrematar.' },
  { icon: MapPin,      titulo: 'Atuação em todo o Brasil',    desc: 'O leilão segue a legislação federal — você pode arrematar em qualquer estado. Já temos operações realizadas em 11 estados e crescendo.' },
];

const PARA_QUEM = [
  {
    emoji: '🏠',
    titulo: 'Quero comprar meu imóvel',
    desc: 'Economize de 20% a 50% em relação ao mercado. Nossa plataforma mostra todos os riscos antes do lance — você decide com segurança.',
    items: ['Busca por cidade e tipo', 'Análise de viabilidade', 'Acompanhamento da documentação', 'Sem surpresa na posse'],
  },
  {
    emoji: '📈',
    titulo: 'Quero investir em leilões',
    desc: 'Monte um portfólio estruturado com análise de ROI, rentabilidade do aluguel e comparativos de mercado. Escale com método, não com sorte.',
    items: ['Relatório de viabilidade com IA', 'Projeções SAC e Price', 'Rentabilidade do aluguel (mensal/anual)', 'Cota mensal de análises por IA'],
    destaque: true,
  },
  {
    emoji: '🤝',
    titulo: 'Sou consultor ou advogado',
    desc: 'Entregue análises profissionais em minutos, não dias. Relatórios em PDF prontos para o cliente final, com sua marca.',
    items: ['Relatório PDF personalizável', 'Consulta processual integrada', 'Análise jurídica em segundos', 'Suporte especializado Bid Pro'],
  },
];

const FAQS = [
  { q: 'O que é o Bid Score?', r: 'É uma nota de 0 a 100 (🟢🟡🔴) que resume o risco e a oportunidade de cada imóvel — juntando análise jurídica, viabilidade financeira, ocupação e documentação. O relatório Mercadológico + Financeiro (grátis) gera a nota parcial; o relatório Documental + Jurídico (Investidor Pro) completa o Bid Score da operação.' },
  { q: 'Preciso ter experiência em leilões para usar a plataforma?', r: 'Não. A plataforma foi criada para guiar tanto iniciantes quanto investidores experientes. O plano Explorador é gratuito e inclui cursos de formação.' },
  { q: 'A análise da IA substitui um advogado?', r: 'Não substitui. A IA é o primeiro filtro — identifica riscos em segundos e mostra o que merece um estudo mais profundo. A decisão de arrematar deve sempre contar com a validação de um especialista: nos planos com assessoria, a análise jurídica é conduzida pela nossa equipe.' },
  { q: 'As análises por IA são ilimitadas?', r: 'Não. Cada análise consome dados pagos de fontes externas, por isso cada plano inclui uma quantidade definida de relatórios. Se uma fonte estiver instável no momento da solicitação, avisamos e liberamos o relatório assim que possível (em até 24–48h), continuando as tentativas.' },
  { q: 'Posso cancelar a assinatura quando quiser?', r: 'Sim. O plano Investidor Pro é mensal sem fidelidade. Cancele quando quiser, sem multa.' },
  { q: 'Como funciona a assessoria?', r: 'No plano Assessoria, a equipe acompanha você do estudo do imóvel ao registro final — estratégia de lance, documentação, regularização e imissão de posse.' },
  { q: 'Em quais lugares posso arrematar?', r: 'Em todo o Brasil. O leilão segue a legislação federal, igual para todos os estados. Já realizamos operações em 11 estados e seguimos crescendo.' },
];

export default function Landing() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [faqAberto, setFaqAberto] = useState(null);

  const ir = (destino) => nav(user ? destino : '/login');
  const cadastrar = () => nav('/login');

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", color: '#111111' }}>

      {/* ── HERO ─────────────────────────────────────────────────────── */}
      <section style={{ background: 'linear-gradient(135deg, #080f1a 0%, #0a1f3d 60%, #0d2a50 100%)', padding: '90px 20px 110px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 15% 85%, rgba(13,99,219,0.18) 0%, transparent 55%), radial-gradient(ellipse at 85% 15%, rgba(99,102,241,0.12) 0%, transparent 55%)' }} />
        <div style={{ maxWidth: 820, margin: '0 auto', position: 'relative' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(13,99,219,0.15)', border: '1px solid rgba(13,99,219,0.3)', borderRadius: 24, padding: '6px 18px', fontSize: 11, color: '#93c5fd', fontWeight: 800, marginBottom: 28, textTransform: 'uppercase', letterSpacing: 1.5 }}>
            <ShieldCheck size={12} /> A camada de confiança dos leilões do Brasil
          </div>
          <h1 style={{ fontSize: 'clamp(32px, 6vw, 60px)', fontWeight: 900, color: 'white', lineHeight: 1.08, margin: '0 0 22px', letterSpacing: '-1.5px' }}>
            Arremate imóveis com<br />
            <span style={{ background: 'linear-gradient(90deg, #60a5fa 0%, #34d399 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>segurança e inteligência.</span>
          </h1>
          <p style={{ fontSize: 'clamp(15px,2vw,18px)', color: '#94a3b8', maxWidth: 600, margin: '0 auto 40px', lineHeight: 1.75 }}>
            A <strong style={{ color: '#ffffff', fontWeight: 800 }}>Bid Pro Brasil</strong> lê o edital, <strong style={{ color: '#e2e8f0', fontWeight: 700 }}>mapeia os riscos jurídicos</strong> e calcula a <strong style={{ color: '#e2e8f0', fontWeight: 700 }}>viabilidade financeira</strong> de cada imóvel — e te dá uma resposta clara <span style={{ color: '#34d399', fontWeight: 700 }}>antes do primeiro lance</span>.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={cadastrar}
              style={{ padding: '15px 32px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9, boxShadow: '0 8px 28px rgba(13,99,219,0.45)' }}>
              Criar conta grátis <ArrowRight size={17} />
            </button>
            <button onClick={() => ir('/buscar')}
              style={{ padding: '15px 32px', background: 'rgba(255,255,255,0.07)', color: 'white', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 12, fontWeight: 700, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 9 }}>
              <Search size={16} /> Buscar imóveis
            </button>
          </div>
          <p style={{ color: '#475569', fontSize: 12, marginTop: 18 }}>Comece grátis · sem cartão de crédito</p>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 40, justifyContent: 'center', marginTop: 60, flexWrap: 'wrap', borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 48 }}>
            {STATS.map(({ v, l }) => (
              <div key={v} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 30, fontWeight: 900, color: 'white', letterSpacing: '-0.5px' }}>{v}</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 4, fontWeight: 500 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── AS 5 PERGUNTAS ───────────────────────────────────────────── */}
      <section style={{ padding: '80px 20px', background: 'white' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>O problema real</div>
            <h2 style={{ fontSize: 'clamp(24px,4vw,36px)', fontWeight: 900, color: '#111', margin: '0 0 12px' }}>Oportunidade nunca faltou. Resposta, sim.</h2>
            <p style={{ color: '#64748b', fontSize: 15, lineHeight: 1.7, maxWidth: 640, margin: '0 auto 8px' }}>
              Existem milhares de imóveis excelentes em leilão. O que faz 99% das pessoas desistirem é não conseguir responder a 5 perguntas. A Bid Pro responde todas — antes do lance.
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, marginTop: 36 }}>
            {PERGUNTAS.map(({ q, r, icon: Icon }) => (
              <div key={q} style={{ borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px 22px', background: '#f8fafc' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ background: '#eff6ff', borderRadius: 10, padding: 8, flexShrink: 0 }}><Icon size={17} color="#0D63DB" /></div>
                  <h3 style={{ fontSize: 15, fontWeight: 800, color: '#111', margin: 0, lineHeight: 1.3 }}>{q}</h3>
                </div>
                <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.65, margin: 0 }}>{r}</p>
              </div>
            ))}
            {/* 6º card — fecha o grid e converte */}
            <div style={{ borderRadius: 16, border: '1px solid #0D63DB', padding: '24px 22px', background: 'linear-gradient(135deg,#0a1f3d,#0d2a50)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <div style={{ background: 'rgba(52,211,153,0.15)', borderRadius: 10, padding: 8, flexShrink: 0 }}><Sparkles size={17} color="#34d399" /></div>
                <h3 style={{ fontSize: 15, fontWeight: 800, color: 'white', margin: 0, lineHeight: 1.3 }}>As 5 respostas em um número</h3>
              </div>
              <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.65, margin: '0 0 14px' }}>O Bid Score reúne tudo numa nota de 0 a 100. Veja o de cada imóvel antes de dar o lance.</p>
              <button onClick={() => ir('/buscar')} style={{ alignSelf: 'flex-start', padding: '10px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                Buscar imóveis <ArrowRight size={14} />
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── BID SCORE (assinatura) ───────────────────────────────────── */}
      <section style={{ padding: '80px 20px', background: 'linear-gradient(135deg, #080f1a 0%, #0a1f3d 60%, #0d2a50 100%)' }}>
        <div style={{ maxWidth: 1080, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56, alignItems: 'center' }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 20, padding: '6px 16px', fontSize: 11, color: '#34d399', fontWeight: 800, marginBottom: 18, textTransform: 'uppercase', letterSpacing: 1 }}>
                <Sparkles size={12} /> Bid Score
              </div>
              <h2 style={{ fontSize: 'clamp(24px,4vw,38px)', fontWeight: 900, color: 'white', margin: '0 0 16px', lineHeight: 1.15 }}>
                Uma nota que responde: <span style={{ background: 'linear-gradient(90deg,#60a5fa,#34d399)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>você compraria este imóvel?</span>
              </h2>
              <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.8, marginBottom: 22 }}>
                Em vez de 180 páginas de edital e matrícula, a Bid Pro traduz tudo em uma nota de 0 a 100 — risco jurídico, viabilidade financeira, ocupação e documentação num só lugar. Como o Serasa dos leilões.
              </p>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, padding: '16px 18px' }}>
                <BadgeCheck size={22} color="#34d399" style={{ flexShrink: 0, marginTop: 1 }} />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'white', marginBottom: 4 }}>IA + Especialistas certificados Bid Pro</div>
                  <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6 }}>A inteligência faz 95% da análise em minutos. Nossos especialistas validam os casos críticos — você não depende de uma máquina sozinha.</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {BID_EXEMPLOS.map(({ nota, cor, bg, emoji, t, d }) => (
                <div key={nota} style={{ background: 'white', borderRadius: 16, padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 18, boxShadow: '0 8px 28px rgba(0,0,0,0.25)' }}>
                  <div style={{ width: 70, height: 70, borderRadius: 16, background: bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `2px solid ${cor}` }}>
                    <div style={{ fontSize: 26, fontWeight: 900, color: cor, lineHeight: 1 }}>{nota}</div>
                    <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, marginTop: 2 }}>BID SCORE</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 3 }}>{emoji} {t}</div>
                    <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{d}</div>
                  </div>
                </div>
              ))}
              <p style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 4 }}>Exemplos ilustrativos. Cada imóvel recebe seu Bid Score após a análise.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PARA QUEM É ──────────────────────────────────────────────── */}
      <section style={{ padding: '80px 20px', background: 'white' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 52 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Para quem é a plataforma</div>
            <h2 style={{ fontSize: 'clamp(24px,4vw,36px)', fontWeight: 900, color: '#111', margin: 0 }}>Seja qual for o seu objetivo, temos o caminho certo</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 20 }}>
            {PARA_QUEM.map(({ emoji, titulo, desc, items, destaque }) => (
              <div key={titulo} style={{ borderRadius: 20, border: destaque ? '2px solid #0D63DB' : '1px solid #e2e8f0', padding: '32px 28px', background: destaque ? '#eff6ff' : 'white', position: 'relative', boxShadow: destaque ? '0 8px 32px rgba(13,99,219,0.12)' : '0 2px 8px rgba(0,0,0,0.04)' }}>
                {destaque && <div style={{ position: 'absolute', top: -12, left: 28, background: '#0D63DB', color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>Mais escolhido</div>}
                <div style={{ fontSize: 40, marginBottom: 16 }}>{emoji}</div>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#111', margin: '0 0 12px', lineHeight: 1.3 }}>{titulo}</h3>
                <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.7, margin: '0 0 20px' }}>{desc}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {items.map(item => (
                    <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <CheckCircle2 size={15} color={destaque ? '#0D63DB' : '#10b981'} style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: '#334155' }}>{item}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── COMO FUNCIONA ─────────────────────────────────────────────── */}
      <section style={{ padding: '80px 20px', background: '#f8fafc' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 56 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Processo em 4 etapas</div>
            <h2 style={{ fontSize: 'clamp(24px,4vw,36px)', fontWeight: 900, color: '#111', margin: '0 0 12px' }}>Do zero ao imóvel arrematado com segurança</h2>
            <p style={{ color: '#64748b', fontSize: 15, maxWidth: 520, margin: '0 auto' }}>Cada etapa guiada pela plataforma — você não precisa saber tudo para começar.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 20 }}>
            {PASSOS.map(({ n, icon: Icon, cor, titulo, desc }) => (
              <div key={n} style={{ background: 'white', borderRadius: 18, padding: '28px 24px', border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', position: 'relative' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
                  <div style={{ background: `${cor}15`, borderRadius: 12, padding: 10, flexShrink: 0 }}>
                    <Icon size={22} color={cor} />
                  </div>
                  <span style={{ fontSize: 40, fontWeight: 900, color: '#f1f5f9', lineHeight: 1 }}>{n}</span>
                </div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: '#111', margin: '0 0 10px' }}>{titulo}</h3>
                <p style={{ color: '#64748b', fontSize: 13, lineHeight: 1.7, margin: 0 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── RECURSOS ─────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 20px', background: 'white' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 64, alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>O que a plataforma faz</div>
              <h2 style={{ fontSize: 'clamp(24px,4vw,36px)', fontWeight: 900, color: '#111', margin: '0 0 18px', lineHeight: 1.2 }}>Análise completa em minutos, não em semanas</h2>
              <p style={{ color: '#64748b', fontSize: 15, lineHeight: 1.8, marginBottom: 32 }}>
                Nossa IA lê editais e matrículas, pesquisa processos judiciais, calcula a viabilidade financeira e identifica riscos jurídicos — tudo antes do seu lance.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {RECURSOS.map(({ icon: Icon, titulo, desc }) => (
                  <div key={titulo} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                    <div style={{ background: '#eff6ff', borderRadius: 10, padding: 9, flexShrink: 0 }}>
                      <Icon size={16} color="#0D63DB" />
                    </div>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 3 }}>{titulo}</div>
                      <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {/* Visual de exemplo */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ background: 'linear-gradient(135deg, #0a1f3d 0%, #0d2a50 100%)', borderRadius: 20, padding: '24px 24px 16px', color: 'white' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#60a5fa', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14 }}>Relatório de Viabilidade</div>
                {[
                  { l: 'Valor de arrematação', v: 'R$ 280.000', c: 'white' },
                  { l: 'Valor de mercado', v: 'R$ 450.000', c: '#34d399' },
                  { l: 'Desconto obtido', v: '37,8%', c: '#34d399' },
                  { l: 'Débitos assumidos', v: 'R$ 12.000', c: '#fbbf24' },
                  { l: 'Reforma estimada', v: 'R$ 20.000', c: '#fbbf24' },
                  { l: 'ROI projetado', v: '42%', c: '#86efac' },
                ].map(({ l, v, c }) => (
                  <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                    <span style={{ fontSize: 13, color: '#94a3b8' }}>{l}</span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: c }}>{v}</span>
                  </div>
                ))}
                <div style={{ marginTop: 14, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)', borderRadius: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: '#34d399', fontWeight: 800, fontSize: 13 }}>✅ Viabilidade aprovada</span>
                  <span style={{ color: '#34d399', fontWeight: 900, fontSize: 18 }}>Arrematar</span>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {[
                  { l: 'Riscos jurídicos', v: '0 identificados', c: '#10b981', bg: '#f0fdf4' },
                  { l: 'Ônus na matrícula', v: 'Penhora baixada', c: '#f59e0b', bg: '#fffbeb' },
                  { l: 'Tempo de análise', v: '4 min 12 seg', c: '#0D63DB', bg: '#eff6ff' },
                  { l: 'Rentab. aluguel', v: '0,8% a.m.', c: '#8b5cf6', bg: '#f5f3ff' },
                ].map(({ l, v, c, bg }) => (
                  <div key={l} style={{ background: bg, borderRadius: 14, padding: '16px 14px', border: `1px solid ${c}20` }}>
                    <div style={{ fontSize: 15, fontWeight: 900, color: c }}>{v}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4, fontWeight: 600 }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CALCULADORA CTA ──────────────────────────────────────────── */}
      <section style={{ padding: '64px 20px', background: 'linear-gradient(135deg, #080f1a 0%, #0d2a50 100%)' }}>
        <div style={{ maxWidth: 860, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', borderRadius: 20, padding: '6px 16px', fontSize: 11, color: '#34d399', fontWeight: 800, marginBottom: 20, textTransform: 'uppercase', letterSpacing: 1 }}>
            Ferramenta gratuita
          </div>
          <h2 style={{ fontSize: 'clamp(22px,4vw,36px)', fontWeight: 900, color: 'white', margin: '0 0 14px', lineHeight: 1.2 }}>
            Quanto você pode pagar no leilão — e ainda lucrar?
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 15, lineHeight: 1.8, margin: '0 auto 32px', maxWidth: 540 }}>
            Nossa Calculadora de Arrematação calcula o teto máximo de lance com base no valor de mercado, débitos, reforma e o ROI que você quer atingir.
          </p>
          <button onClick={() => ir('/calculadora')}
            style={{ padding: '14px 32px', background: '#10b981', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: '0 8px 28px rgba(16,185,129,0.35)' }}>
            🧮 Usar a Calculadora — é grátis
          </button>
        </div>
      </section>

      {/* ── EQUIPE ───────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 20px', background: '#f8fafc' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', textAlign: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 12 }}>Quem está do seu lado</div>
          <h2 style={{ fontSize: 'clamp(24px,4vw,34px)', fontWeight: 900, color: '#111', margin: '0 0 14px' }}>8 anos formando arrematadores no Brasil</h2>
          <p style={{ color: '#64748b', fontSize: 15, lineHeight: 1.8, maxWidth: 620, margin: '0 auto 48px' }}>
            A Bid Pro Brasil nasceu da experiência prática no mercado de leilões imobiliários. Nossa equipe inclui analistas, advogados especializados em pós-arrematação e o sócio fundador à frente da formação dos arrematadores.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(165px,1fr))', gap: 16, maxWidth: 820, margin: '0 auto' }}>
            {[
              { emoji: '⚖️', cargo: 'Jurídico',         desc: 'Advogados especializados em pós-arrematação, registro e regularização' },
              { emoji: '📊', cargo: 'Análise',           desc: 'Analistas que revisam cada imóvel antes do lance do cliente' },
              { emoji: '🏛️', cargo: 'Relações Cartoriais',desc: 'Equipe com acesso direto a cartórios para agilizar o registro' },
              { emoji: '👤', cargo: 'Sócio Fundador',    desc: 'Tarcísio conduz a parte educacional no Leilão Club — o clube de negócios da Bid Pro' },
            ].map(({ emoji, cargo, desc }) => (
              <div key={cargo} style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px 20px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                <div style={{ fontSize: 34, marginBottom: 12 }}>{emoji}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: '#111', marginBottom: 8 }}>{cargo}</div>
                <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PLANOS PREVIEW (sem preços — fonte de verdade é a tela /planos) ── */}
      <section style={{ padding: '80px 20px', background: 'white' }}>
        <div style={{ maxWidth: 960, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 48 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Planos</div>
            <h2 style={{ fontSize: 'clamp(24px,4vw,36px)', fontWeight: 900, color: '#111', margin: '0 0 12px' }}>Comece grátis. Evolua no seu ritmo.</h2>
            <p style={{ color: '#64748b', fontSize: 15 }}>Do plano gratuito à assessoria completa — veja preços e condições atualizados na página de planos.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 16 }}>
            {[
              { nome: 'Explorador', tag: 'Grátis', cor: '#64748b', items: ['Busca de leilões em todo o Brasil', 'Relatório Mercadológico + Viabilidade Financeira', 'Calculadora de Arrematação', 'Cursos gratuitos inclusos'], destaque: false },
              { nome: 'Investidor Pro', tag: 'Mais popular', cor: '#0D63DB', items: ['Tudo do Explorador', 'Relatório Documental e Jurídico por IA', 'Bid Score completo da operação', 'Comparativos de mercado', 'Cota mensal de análises'], destaque: true },
              { nome: 'Assessoria', tag: 'Por arrematação', cor: '#d97706', items: ['Tudo do Investidor Pro', 'Analista dedicado (valida o Bid Score)', 'Do lance à imissão de posse', 'Registro via plataforma (ONR)'], destaque: false },
            ].map(({ nome, tag, cor, items, destaque }) => (
              <div key={nome} style={{ background: destaque ? '#eff6ff' : 'white', borderRadius: 18, border: destaque ? `2px solid ${cor}` : '1px solid #e2e8f0', padding: '24px 20px', position: 'relative', boxShadow: destaque ? `0 8px 28px ${cor}20` : '0 2px 8px rgba(0,0,0,0.04)' }}>
                {destaque && <div style={{ position: 'absolute', top: -11, left: '50%', transform: 'translateX(-50%)', background: cor, color: 'white', fontSize: 9, fontWeight: 800, padding: '3px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1, whiteSpace: 'nowrap' }}>Mais popular</div>}
                <div style={{ fontSize: 12, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 6 }}>{nome}</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 16, fontWeight: 600 }}>{tag}</div>
                <div style={{ height: 1, background: '#f1f5f9', margin: '0 0 16px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {items.map(item => (
                    <div key={item} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <CheckCircle2 size={13} color={cor} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 12, color: '#334155', lineHeight: 1.4 }}>{item}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => nav('/planos')}
                  style={{ width: '100%', padding: '10px', border: destaque ? 'none' : `2px solid ${cor}`, borderRadius: 10, background: destaque ? cor : 'transparent', color: destaque ? 'white' : cor, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  Ver detalhes do plano
                </button>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <button onClick={() => nav('/planos')}
              style={{ padding: '14px 32px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 8px 28px rgba(13,99,219,0.35)' }}>
              Ver planos e preços <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 20px', background: '#f8fafc' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <h2 style={{ fontSize: 'clamp(22px,4vw,32px)', fontWeight: 900, color: '#111', textAlign: 'center', margin: '0 0 44px' }}>Perguntas frequentes</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQS.map((faq, i) => (
              <div key={i} style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <button onClick={() => setFaqAberto(faqAberto === i ? null : i)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px 22px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.4 }}>{faq.q}</span>
                  {faqAberto === i ? <ChevronUp size={17} color="#64748b" style={{ flexShrink: 0 }} /> : <ChevronDown size={17} color="#64748b" style={{ flexShrink: 0 }} />}
                </button>
                {faqAberto === i && <div style={{ padding: '0 22px 18px', fontSize: 14, color: '#64748b', lineHeight: 1.8 }}>{faq.r}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA FINAL ────────────────────────────────────────────────── */}
      <section style={{ padding: '80px 20px', background: 'linear-gradient(135deg, #080f1a 0%, #0d2a50 100%)', textAlign: 'center' }}>
        <div style={{ maxWidth: 620, margin: '0 auto' }}>
          <div style={{ fontSize: 48, marginBottom: 20 }}>🏠</div>
          <h2 style={{ fontSize: 'clamp(24px,5vw,42px)', fontWeight: 900, color: 'white', margin: '0 0 16px', lineHeight: 1.15 }}>
            Seu próximo imóvel pode estar no leilão de amanhã.
          </h2>
          <p style={{ color: '#94a3b8', fontSize: 16, lineHeight: 1.7, margin: '0 0 36px' }}>
            Crie sua conta gratuitamente e comece a explorar oportunidades em todo o Brasil — sem cartão, sem compromisso.
          </p>
          <button onClick={cadastrar}
            style={{ padding: '16px 40px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 900, fontSize: 17, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, boxShadow: '0 8px 32px rgba(13,99,219,0.5)' }}>
            Criar conta grátis <ArrowRight size={18} />
          </button>
          <p style={{ color: '#475569', fontSize: 12, marginTop: 16 }}>Comece grátis · sem cartão · cancele quando quiser</p>
        </div>
      </section>

      {/* ── FOOTER ───────────────────────────────────────────────────── */}
      <footer style={{ background: '#080f1a', padding: '48px 20px 32px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 32, marginBottom: 40 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'white', marginBottom: 8 }}>Bid Pro Brasil</div>
              <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.7 }}>Plataforma de aquisição em leilão imobiliário com inteligência e segurança jurídica.</div>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14 }}>Plataforma</div>
              {[['Buscar leilões', '/buscar'], ['Calculadora', '/calculadora'], ['Planos', '/planos'], ['Entrar', '/login']].map(([l, h]) => (
                <button key={l} onClick={() => nav(h)} style={{ display: 'block', background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', marginBottom: 10, padding: 0, textAlign: 'left', fontWeight: 500 }}>{l}</button>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14 }}>Legal</div>
              {[['Termos de Uso', '/termos'], ['Privacidade', '/privacidade']].map(([l, h]) => (
                <button key={l} onClick={() => nav(h)} style={{ display: 'block', background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', marginBottom: 10, padding: 0, textAlign: 'left', fontWeight: 500 }}>{l}</button>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 14 }}>Suporte</div>
              <button onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))}
                style={{ display: 'block', background: 'none', border: 'none', color: '#64748b', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'left', fontWeight: 500 }}>
                Falar com a equipe
              </button>
            </div>
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ fontSize: 11, color: '#334155' }}>© {new Date().getFullYear()} Bid Pro Brasil. Todos os direitos reservados.</div>
            <div style={{ fontSize: 11, color: '#334155' }}>suporte@bidprobrasil.com.br</div>
          </div>
        </div>
      </footer>

      <style>{`
        @media (max-width: 768px) {
          section > div > div[style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
