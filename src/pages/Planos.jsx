import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Shield, Zap, Users, ChevronDown, ChevronUp, Star } from 'lucide-react';
import { PLANOS as PLANOS_STATIC } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { fetchPlanosComConfig } from '../utils/planosConfig';

const FAQS = [
  { q: 'Posso cancelar o plano mensal a qualquer momento?', r: 'Sim. Os planos Investidor e Investidor Pro são mensais sem fidelidade — cancele quando quiser, sem multa.' },
  { q: 'Como funcionam os 10% de honorários?', r: 'Os honorários incidem apenas sobre o valor da arrematação em caso de sucesso. Se não arrematar, não há cobrança.' },
  { q: 'O plano Assessoria cobre quantas arrematações?', r: 'Uma arrematação por contrato, com acompanhamento do início até a imissão de posse — que pode levar meses. O acesso ao sistema é extensível até a conclusão.' },
  { q: 'O Leilão Club inclui arrematações ilimitadas?', r: 'Sim. Com o Clube você tem acesso a assessoria contínua para todas as arrematações durante a vigência do plano.' },
  { q: 'Posso pagar parcelado no cartão?', r: 'Sim. Aceitamos crédito, débito e PIX. O parcelamento em até 12× está disponível — a partir da 4ª parcela os juros são assumidos pelo cliente conforme a operadora.' },
  { q: 'O que é o relatório de viabilidade?', r: 'Nossa IA analisa edital, matrícula e documentos do imóvel e gera um relatório completo com análise mercadológica, financeira e jurídica em minutos.' },
];

export default function Planos() {
  const nav = useNavigate();
  const { user, role } = useAuth();
  const [PLANOS, setPLANOS] = useState(PLANOS_STATIC);
  const [faqAberto, setFaqAberto] = useState(null);

  useEffect(() => { fetchPlanosComConfig().then(setPLANOS); }, []);

  const ir = (key) => {
    const plano = PLANOS[key];
    if (!plano) return;
    if (plano.preco === 0) { nav(user ? '/membros' : '/login'); return; }
    const params = new URLSearchParams({ plano: key });
    nav(user ? `/checkout?${params}` : `/login?next=/checkout?plano=${key}`);
  };

  const atual = (key) => user && key === role;

  const BtnPrimario = ({ planoKey, label, dark }) => (
    <button
      onClick={() => ir(planoKey)}
      disabled={atual(planoKey)}
      style={{
        width: '100%', padding: '14px', border: 'none', borderRadius: 12,
        background: atual(planoKey) ? (dark ? 'rgba(255,255,255,0.15)' : '#f1f5f9') : (dark ? 'white' : '#111111'),
        color: atual(planoKey) ? (dark ? '#93c5fd' : '#94a3b8') : (dark ? '#084BA6' : 'white'),
        fontWeight: 800, fontSize: 15, cursor: atual(planoKey) ? 'default' : 'pointer',
        boxShadow: atual(planoKey) ? 'none' : '0 4px 14px rgba(0,0,0,0.15)',
        transition: 'all 0.15s',
      }}>
      {atual(planoKey) ? 'Seu plano atual' : label}
    </button>
  );

  const Item = ({ txt, cor }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ width: 20, height: 20, borderRadius: '50%', background: cor === 'blue' ? 'rgba(134,239,172,0.25)' : '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
        <Check size={11} color={cor === 'blue' ? '#86efac' : '#16a34a'} />
      </div>
      <span style={{ fontSize: 13, color: cor === 'blue' ? '#e0f2fe' : '#334155', lineHeight: 1.5 }}>{txt}</span>
    </div>
  );

  const Badge = ({ txt, bg, color }) => (
    <span style={{ display: 'inline-block', background: bg, color, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginRight: 6, marginBottom: 6 }}>{txt}</span>
  );

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <div style={{ background: 'linear-gradient(135deg, #0a0a0a 0%, #0f2a50 100%)', padding: '64px 20px 88px', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', background: 'rgba(37,99,235,0.2)', border: '1px solid rgba(37,99,235,0.35)', borderRadius: 20, padding: '5px 16px', fontSize: 11, fontWeight: 800, color: '#93c5fd', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 20 }}>
          Planos & Preços
        </div>
        <h1 style={{ fontSize: 'clamp(28px,5vw,50px)', fontWeight: 900, color: 'white', margin: '0 0 16px', lineHeight: 1.1 }}>
          Invista com inteligência.<br />
          <span style={{ color: '#60a5fa' }}>Arremate com segurança.</span>
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 'clamp(14px,2vw,17px)', maxWidth: 540, margin: '0 auto 36px', lineHeight: 1.7 }}>
          Da pesquisa gratuita à assessoria completa — escolha o suporte certo para o seu momento.
        </p>
        <div style={{ display: 'flex', gap: 28, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[{ icon: Shield, txt: 'Análise jurídica incluída' }, { icon: Zap, txt: 'Relatório em minutos' }, { icon: Users, txt: '+8 anos no mercado' }].map(({ icon: Icon, txt }) => (
            <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
              <Icon size={14} color="#60a5fa" /> {txt}
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '0 20px 80px' }}>

        {/* ── Cards Explorador + Investidor Pro ── */}
        <div className="grid-2" style={{ marginTop: -48, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 820, margin: '-48px auto 0' }}>

          {/* Explorador */}
          <div style={{ background: 'white', borderRadius: 20, border: atual('explorador') ? '2px solid #0D63DB' : '1px solid #e2e8f0', padding: '32px 28px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
            {atual('explorador') && <Badge txt="Seu plano" bg="#dbeafe" color="#084BA6" />}
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Explorador</div>
            <div style={{ fontSize: 44, fontWeight: 900, color: '#111', marginBottom: 2 }}>Grátis</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20 }}>Para sempre · sem cartão</div>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.7 }}>
              Explore leilões em todo o Brasil sem gastar nada. Ideal para quem está pesquisando o mercado.
            </p>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
              {['Busca de leilões em todo o Brasil', 'Cursos e materiais gratuitos inclusos', 'Calculadora de Arrematação', 'Acesso ao site do leiloeiro'].map(t => <Item key={t} txt={t} />)}
            </div>
            <BtnPrimario planoKey="explorador" label="Começar Grátis →" />
          </div>

          {/* Investidor Pro (top2) */}
          <div style={{ background: 'linear-gradient(145deg, #084BA6 0%, #0a3d8f 100%)', borderRadius: 20, border: '2px solid #3b82f6', padding: '32px 28px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: '0 8px 32px rgba(37,99,235,0.3)' }}>
            <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
            <div style={{ position: 'absolute', top: 16, right: 16, background: '#fbbf24', color: '#78350f', fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Star size={9} fill="#78350f" /> Mais popular
            </div>
            {atual('top2') && <Badge txt="Seu plano" bg="rgba(255,255,255,0.2)" color="white" />}
            <div style={{ fontSize: 11, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Investidor Pro</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
              <div style={{ fontSize: 44, fontWeight: 900, color: 'white' }}>R$ {Number(PLANOS.top2?.preco || 99.90).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
              <div style={{ fontSize: 14, color: '#93c5fd' }}>/mês</div>
            </div>
            <div style={{ fontSize: 12, color: '#7dd3fc', marginBottom: 8 }}>ou 12× R$ {Number(PLANOS.top2?.precoMensalAnual || 66.42).toLocaleString('pt-BR', { minimumFractionDigits: 2 })} no plano anual</div>
            <div style={{ display: 'inline-block', background: 'rgba(134,239,172,0.15)', border: '1px solid rgba(134,239,172,0.3)', color: '#86efac', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginBottom: 20, alignSelf: 'flex-start' }}>
              Cancele quando quiser
            </div>
            <p style={{ fontSize: 14, color: '#bfdbfe', marginBottom: 20, lineHeight: 1.7 }}>
              Relatório completo de viabilidade gerado por IA + análise jurídica documental. Analises ilimitadas.
            </p>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
              {['Tudo do Explorador', 'Relatório mercadológico com valor de mercado', 'Viabilidade financeira com projeções', 'Análise de edital, matrícula e processo', 'Consulta processual (Jusbrasil/CNJ)', 'Alertas de risco (penhora, ônus reais)', 'Análises ilimitadas por mês'].map(t => <Item key={t} txt={t} cor="blue" />)}
            </div>
            <BtnPrimario planoKey="top2" label="Assinar agora →" dark />
          </div>
        </div>

        {/* ── Assessoria Personalizada ── */}
        <div style={{ textAlign: 'center', margin: '72px 0 36px' }}>
          <div style={{ display: 'inline-block', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 20, padding: '5px 16px', fontSize: 11, fontWeight: 800, color: '#c2410c', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16 }}>
            Assessoria Personalizada
          </div>
          <h2 style={{ fontSize: 'clamp(22px,4vw,34px)', fontWeight: 900, color: '#111', margin: '0 0 14px' }}>
            A equipe TSN do seu lado, do lance à posse.
          </h2>
          <p style={{ color: '#64748b', fontSize: 15, maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
            Para quem quer resultado com segurança total — análise, estratégia, documentação e registro feitos por especialistas.
          </p>
        </div>

        {!user ? (
          <div style={{ background: 'white', borderRadius: 20, border: '2px dashed #cbd5e1', padding: '52px 32px', textAlign: 'center', maxWidth: 520, margin: '0 auto' }}>
            <div style={{ fontSize: 52, marginBottom: 14 }}>🔒</div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#111', marginBottom: 10 }}>Faça login para ver os planos de assessoria</h3>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 28, lineHeight: 1.7 }}>
              Os planos Assessoria e Leilão Club são exclusivos para membros cadastrados na plataforma.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => nav('/login')} style={{ padding: '12px 28px', background: '#111', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Entrar na minha conta</button>
              <button onClick={() => nav('/login')} style={{ padding: '12px 28px', background: 'transparent', color: '#111', border: '2px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Criar conta grátis</button>
            </div>
          </div>
        ) : (
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 860, margin: '0 auto' }}>

            {/* Assessoria (assessorado) */}
            <div style={{ background: 'white', borderRadius: 20, border: atual('assessorado') ? '2px solid #d97706' : '1px solid #fed7aa', padding: '32px 28px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(217,119,6,0.1)' }}>
              {atual('assessorado') && <Badge txt="Seu plano" bg="#fef3c7" color="#92400e" />}
              <div style={{ fontSize: 11, fontWeight: 800, color: '#d97706', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Assessoria</div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                <div style={{ fontSize: 40, fontWeight: 900, color: '#111' }}>R$ 5.000</div>
              </div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>por arrematação · pagamento único</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20 }}>Parcelável em até 12× — juros assumidos pelo cliente a partir da 4ª parcela</div>

              <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#713f12' }}>+ 10% de honorários sobre o valor arrematado</div>
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 3 }}>Cobrado apenas em caso de sucesso na arrematação</div>
              </div>

              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.7 }}>
                Assessoria completa para 1 arrematação — da análise do imóvel até a imissão de posse. Acesso à plataforma por 12 meses, extensível até a conclusão do processo.
              </p>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
                {[
                  'Tudo do plano Investidor Pro',
                  'Análise jurídica e estratégia de lance',
                  'Acompanhamento até a imissão de posse',
                  'Suporte com documentação pós-arrematação',
                  'Registro do imóvel via plataforma (ONR)',
                  '12 meses de acesso · extensível até a posse',
                ].map(t => <Item key={t} txt={t} />)}
              </div>

              <button onClick={() => ir('assessorado')} disabled={atual('assessorado')}
                style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('assessorado') ? '#f1f5f9' : '#d97706', color: atual('assessorado') ? '#94a3b8' : 'white', fontWeight: 800, fontSize: 15, cursor: atual('assessorado') ? 'default' : 'pointer', boxShadow: atual('assessorado') ? 'none' : '0 4px 14px rgba(217,119,6,0.35)' }}>
                {atual('assessorado') ? 'Seu plano atual' : 'Contratar assessoria →'}
              </button>
            </div>

            {/* Leilão Club */}
            <div style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1e1b4b 100%)', borderRadius: 20, border: '2px solid #6366f1', padding: '32px 28px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: '0 8px 40px rgba(99,102,241,0.3)' }}>
              <div style={{ position: 'absolute', top: -30, right: -30, width: 150, height: 150, borderRadius: '50%', background: 'rgba(99,102,241,0.1)' }} />
              <div style={{ position: 'absolute', top: 16, right: 16, background: '#4f46e5', color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Nível máximo
              </div>
              {atual('clube') && <Badge txt="Seu plano" bg="rgba(255,255,255,0.1)" color="white" />}
              <div style={{ fontSize: 11, fontWeight: 800, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Leilão Club</div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                <div style={{ fontSize: 40, fontWeight: 900, color: 'white' }}>R$ 5.000</div>
                <div style={{ fontSize: 15, color: '#a5b4fc', fontWeight: 600 }}>/mês</div>
              </div>
              <div style={{ fontSize: 13, color: '#818cf8', marginBottom: 6 }}>Total R$ 60.000 em 12 meses</div>
              <div style={{ fontSize: 12, color: '#6366f144', color: '#a5b4fc', marginBottom: 20, opacity: 0.8 }}>
                Ou 12× no cartão/PIX — juros a partir da 4ª parcela
              </div>

              <div style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#c7d2fe' }}>+ 10% de honorários sobre cada arrematação</div>
                <div style={{ fontSize: 11, color: '#a5b4fc', marginTop: 3 }}>Cobrado apenas em caso de sucesso</div>
              </div>

              <p style={{ fontSize: 14, color: '#c7d2fe', marginBottom: 20, lineHeight: 1.7 }}>
                Mentoria contínua com assessoria ilimitada para todas as suas arrematações. Acesso total à plataforma e à equipe TSN.
              </p>

              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
                {[
                  'Tudo dos planos anteriores',
                  'Arrematações ilimitadas com assessoria completa',
                  'Encontros regulares com Tarcísio (sócio TSN)',
                  'Oportunidades exclusivas de leilões',
                  'Estratégia de portfólio personalizada',
                  'Suporte prioritário com analista dedicado',
                  'Após 12 meses: cancele a qualquer momento',
                ].map(t => <Item key={t} txt={t} cor="blue" />)}
              </div>

              <button onClick={() => ir('clube')} disabled={atual('clube')}
                style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('clube') ? 'rgba(255,255,255,0.1)' : '#6366f1', color: atual('clube') ? '#a5b4fc' : 'white', fontWeight: 800, fontSize: 15, cursor: atual('clube') ? 'default' : 'pointer', boxShadow: atual('clube') ? 'none' : '0 4px 20px rgba(99,102,241,0.5)' }}>
                {atual('clube') ? 'Seu plano atual' : 'Entrar no Clube →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Garantias ── */}
        <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, maxWidth: 820, margin: '52px auto 0' }}>
          {[
            { icon: '🔒', titulo: 'Pagamento 100% seguro', sub: 'Crédito, débito e PIX com ambiente certificado' },
            { icon: '✅', titulo: 'Cancele quando quiser', sub: 'Planos mensais sem fidelidade e sem burocracia' },
            { icon: '🤝', titulo: 'Equipe especializada', sub: 'Analistas, advogados e sócio disponíveis para você' },
          ].map(({ icon, titulo, sub }) => (
            <div key={titulo} style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '22px 18px', textAlign: 'center' }}>
              <div style={{ fontSize: 30, marginBottom: 10 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 6 }}>{titulo}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── FAQ ── */}
        <div style={{ maxWidth: 720, margin: '72px auto 0' }}>
          <h3 style={{ fontSize: 26, fontWeight: 900, color: '#111', textAlign: 'center', marginBottom: 36 }}>Perguntas frequentes</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQS.map((faq, i) => (
              <div key={i} style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <button onClick={() => setFaqAberto(faqAberto === i ? null : i)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>{faq.q}</span>
                  {faqAberto === i ? <ChevronUp size={17} color="#64748b" /> : <ChevronDown size={17} color="#64748b" />}
                </button>
                {faqAberto === i && (
                  <div style={{ padding: '0 20px 18px', fontSize: 14, color: '#64748b', lineHeight: 1.8 }}>{faq.r}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 52, fontSize: 13, color: '#94a3b8' }}>
          Dúvidas?{' '}
          <span style={{ color: '#0D63DB', cursor: 'pointer', fontWeight: 600 }}
            onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))}>
            Fale com nossa equipe pelo chat
          </span>
        </p>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .grid-2 { grid-template-columns: 1fr !important; }
          .grid-3 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
