import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Shield, Zap, Users, ChevronDown, ChevronUp, Star, ArrowRight } from 'lucide-react';
import { PLANOS as PLANOS_STATIC } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';
import { fetchPlanosComConfig } from '../utils/planosConfig';

// FAQs montados com os valores reais do planos_config (evita valores fixos
// divergentes). Os labels de preço chegam já formatados.
const buildFAQS = ({ precoMesLabel, mesAnualLabel, anoLabel, economiaPctLabel }) => [
  { q: 'Posso cancelar o plano a qualquer momento?', r: 'Sim. No plano mensal (sem fidelidade), cancele quando quiser, sem multa. No plano anual, você cancela a renovação automática a qualquer momento — sem novas cobranças e sem estorno do período já contratado, mantendo o acesso até o fim dos 12 meses.' },
  { q: 'Como funcionam os 10% de honorários?', r: 'Os honorários incidem apenas sobre o valor da arrematação em caso de sucesso. Se não arrematar, não há cobrança alguma.' },
  { q: 'O plano Assessoria cobre quantas arrematações?', r: 'Uma arrematação por contrato. O assessorado tem até 12 meses para realizar a arrematação — buscando oportunidades e também recebendo indicações da nossa equipe —, com acompanhamento completo do início até a imissão de posse.' },
  { q: 'O Leilão Club inclui arrematações ilimitadas?', r: 'Sim. Com o Clube você tem acesso a assessoria contínua para todas as arrematações durante a vigência do plano.' },
  { q: 'Posso pagar parcelado no cartão?', r: 'Sim. Aceitamos crédito, débito e PIX. Parcelamento em até 12× disponível — a partir da 4ª parcela os juros são assumidos pelo cliente conforme a operadora.' },
  { q: 'O que é o relatório de viabilidade?', r: 'Nossa IA analisa edital, matrícula e documentos do imóvel e gera um relatório completo com análise mercadológica, financeira e jurídica em menos de 5 minutos.' },
  { q: 'Qual a diferença entre pagar mensal e anual?', r: `No plano anual você economiza ${economiaPctLabel} — paga o equivalente a ${mesAnualLabel}/mês (${anoLabel} cobrados uma única vez) em vez de ${precoMesLabel}/mês no mensal.` },
];

export default function Planos() {
  const nav = useNavigate();
  const { user, role } = useAuth();
  const [PLANOS, setPLANOS] = useState(PLANOS_STATIC);
  const [faqAberto, setFaqAberto] = useState(null);
  const [periodo, setPeriodo] = useState('mensal');

  useEffect(() => { fetchPlanosComConfig().then(setPLANOS); }, []);

  // Formata um valor; usado para totais/economias derivados do planos_config.
  const fmtR = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Preço de um plano vindo do banco, com fallback ao label estático.
  const pLabel = (key, field, fallback) => PLANOS[key]?.[field] ?? fallback;
  const ativoPlano = (key) => PLANOS[key]?.ativo !== false; // mostra durante o load (undefined)

  // Valores reais do Investidor Pro (planos_config) para o FAQ
  const _precoMes = Number(PLANOS.top2?.preco) || 49.90;
  const _precoAno = Number(PLANOS.top2?.precoAnual) || 449.90;
  const _economiaPct = _precoMes ? Math.round((1 - _precoAno / (_precoMes * 12)) * 100) : 25;
  const FAQS = buildFAQS({
    precoMesLabel: fmtR(_precoMes),
    mesAnualLabel: fmtR(_precoAno / 12),
    anoLabel: fmtR(_precoAno),
    economiaPctLabel: `${_economiaPct}%`,
  });

  const ir = (key) => {
    const plano = PLANOS[key];
    if (!plano) return;
    if (plano.preco === 0) { nav(user ? '/membros' : '/login'); return; }
    const params = new URLSearchParams({ plano: key });
    nav(user ? `/checkout?${params}` : `/login?next=${encodeURIComponent(`/checkout?plano=${key}`)}`);
  };

  const irAnual = (key) => {
    const aKey = `${key}_anual`;
    const params = new URLSearchParams({ plano: aKey });
    nav(user ? `/checkout?${params}` : `/login?next=${encodeURIComponent(`/checkout?plano=${aKey}`)}`);
  };

  const atual = (key) => user && (key === role || `${key}_anual` === role);

  const CheckItem = ({ txt, light }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: light ? 'rgba(134,239,172,0.2)' : '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
        <Check size={10} color={light ? '#86efac' : '#16a34a'} strokeWidth={3} />
      </div>
      <span style={{ fontSize: 13, color: light ? '#e0f2fe' : '#334155', lineHeight: 1.55 }}>{txt}</span>
    </div>
  );

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      <div style={{ background: 'linear-gradient(135deg, #080f1a 0%, #0d2a50 100%)', padding: '72px 20px 100px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 80%, rgba(13,99,219,0.2) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(99,102,241,0.12) 0%, transparent 50%)' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'inline-block', background: 'rgba(37,99,235,0.18)', border: '1px solid rgba(37,99,235,0.3)', borderRadius: 24, padding: '6px 18px', fontSize: 11, fontWeight: 800, color: '#93c5fd', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 22 }}>
            Planos & Preços
          </div>
          <h1 style={{ fontSize: 'clamp(28px,5vw,52px)', fontWeight: 900, color: 'white', margin: '0 0 16px', lineHeight: 1.08, letterSpacing: '-1px' }}>
            Invista com inteligência.<br />
            <span style={{ color: '#60a5fa' }}>Arremate com segurança.</span>
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 'clamp(14px,2vw,17px)', maxWidth: 520, margin: '0 auto 36px', lineHeight: 1.75 }}>
            Da pesquisa gratuita à assessoria completa — escolha o suporte certo para o seu momento.
          </p>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[{ icon: Shield, txt: 'Análise jurídica incluída' }, { icon: Zap, txt: 'Relatório em menos de 5 min' }, { icon: Users, txt: '+8 anos no mercado' }].map(({ icon: Icon, txt }) => (
              <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
                <Icon size={14} color="#60a5fa" /> {txt}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 20px 80px' }}>


        {/* ── 2 Planos principais: Explorador + Investidor Pro ── */}
        <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 20, maxWidth: 920, margin: '0 auto 64px', alignItems: 'stretch' }}>

          {/* Explorador */}
          <div style={{ background: 'white', borderRadius: 20, border: atual('explorador') ? '2px solid #0D63DB' : '1px solid #e2e8f0', padding: '32px 28px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Explorador</div>
            <div style={{ fontSize: 48, fontWeight: 900, color: '#111', marginBottom: 2 }}>Grátis</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 28 }}>Sem cartão de crédito</div>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 28, lineHeight: 1.7 }}>
              Explore leilões em todo o Brasil, acesse cursos e use a calculadora de arrematação sem pagar nada.
            </p>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
              {['Busca de leilões em todo o Brasil', 'Calculadora de Arrematação', 'Cursos e materiais gratuitos', 'Acesso ao site do leiloeiro'].map(t => <CheckItem key={t} txt={t} />)}
            </div>
            <button onClick={() => nav('/plano/explorador')} disabled={atual('explorador')}
              style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('explorador') ? '#f1f5f9' : '#111', color: atual('explorador') ? '#94a3b8' : 'white', fontWeight: 800, fontSize: 15, cursor: atual('explorador') ? 'default' : 'pointer' }}>
              {atual('explorador') ? 'Seu plano atual' : 'Conhecer o plano →'}
            </button>
          </div>

          {/* Investidor Pro */}
          <div style={{ background: 'linear-gradient(145deg, #084BA6 0%, #0a3d8f 100%)', borderRadius: 20, border: '2px solid #3b82f6', padding: '32px 32px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: '0 12px 40px rgba(37,99,235,0.35)' }}>
            <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
            <div style={{ position: 'absolute', top: 20, right: 20, background: '#fbbf24', color: '#78350f', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Star size={9} fill="#78350f" /> Mais popular
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Investidor Pro</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <div style={{ fontSize: 48, fontWeight: 900, color: 'white' }}>
                {periodo === 'anual' ? pLabel('top2', 'precoMensalAnualLabel', 'R$ 37,49') : pLabel('top2', 'precoLabel', 'R$ 49,90')}
              </div>
              <div style={{ fontSize: 14, color: '#93c5fd' }}>/mês</div>
            </div>
            {periodo === 'anual'
              ? <div style={{ fontSize: 13, color: '#86efac', fontWeight: 700, marginBottom: 8 }}>{pLabel('top2', 'precoAnualLabel', 'R$ 449,90')}/ano{PLANOS.top2?.preco && PLANOS.top2?.precoAnual ? ` · economize ${fmtR(PLANOS.top2.preco * 12 - PLANOS.top2.precoAnual)}` : ''}</div>
              : <div style={{ fontSize: 12, color: '#7dd3fc', marginBottom: 8 }}>ou {pLabel('top2', 'precoMensalAnualLabel', 'R$ 37,49')}/mês no plano anual (-25%)</div>}
            <div style={{ display: 'inline-block', background: 'rgba(134,239,172,0.15)', border: '1px solid rgba(134,239,172,0.3)', color: '#86efac', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginBottom: 20, alignSelf: 'flex-start' }}>
              {periodo === 'anual' ? 'Cancele a renovação automática quando quiser' : 'Cancele quando quiser'}
            </div>
            <p style={{ fontSize: 14, color: '#bfdbfe', marginBottom: 20, lineHeight: 1.7 }}>
              Relatório completo de viabilidade por IA + análise documental e jurídica com base nos anexos do leilão. Até 15 relatórios de cada tipo por mês.
            </p>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
              {[
                'Tudo do Explorador',
                'Relatório de viabilidade com IA',
                'Análise de edital, matrícula e processo',
                'Comparativos de mercado (condomínio/rua)',
                'Projeções financeiras SAC e Price',
                'Yield de locação mensal e anual',
                'Análise processual do imóvel',
                'Alertas de risco (penhora, ônus reais)',
                '15 relatórios mercadológicos/mês',
                '15 relatórios documentais e jurídicos/mês',
              ].map(t => <CheckItem key={t} txt={t} light />)}
            </div>
            <button onClick={() => nav('/plano/top2')} disabled={atual('top2')}
              style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('top2') ? 'rgba(255,255,255,0.15)' : 'white', color: atual('top2') ? '#93c5fd' : '#084BA6', fontWeight: 800, fontSize: 15, cursor: atual('top2') ? 'default' : 'pointer', boxShadow: atual('top2') ? 'none' : '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {atual('top2') ? 'Seu plano atual' : <><span>Assinar Investidor Pro</span> <ArrowRight size={16} /></>}
            </button>
          </div>
        </div>

        {/* ── Assessoria Personalizada (só logado) ── */}
        <div style={{ textAlign: 'center', margin: '0 0 36px' }}>
          <div style={{ display: 'inline-block', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 20, padding: '5px 16px', fontSize: 11, fontWeight: 800, color: '#c2410c', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 16 }}>
            Assessoria Personalizada
          </div>
          <h2 style={{ fontSize: 'clamp(22px,4vw,34px)', fontWeight: 900, color: '#111', margin: '0 0 12px' }}>
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
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 880, margin: '0 auto' }}>

            {/* Assessoria */}
            {ativoPlano('assessorado') && (
            <div style={{ background: 'white', borderRadius: 20, border: atual('assessorado') ? '2px solid #d97706' : '1px solid #fed7aa', padding: '32px 28px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(217,119,6,0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#d97706', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Assessoria</div>
              <div style={{ fontSize: 42, fontWeight: 900, color: '#111', marginBottom: 4 }}>{pLabel('assessorado', 'precoLabel', 'R$ 5.000')}</div>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 6 }}>por arrematação · pagamento único</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 20 }}>Parcelável em até 12× — juros a partir da 4ª parcela</div>
              <div style={{ background: '#fef9c3', border: '1px solid #fde047', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#713f12' }}>+ 10% de honorários sobre o valor arrematado</div>
                <div style={{ fontSize: 11, color: '#92400e', marginTop: 3 }}>Cobrado apenas em caso de sucesso</div>
              </div>
              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.7 }}>
                Assessoria completa para 1 arrematação — da análise do imóvel até a imissão de posse. Acesso à plataforma por 12 meses, extensível até a conclusão.
              </p>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
                {['Tudo do Investidor Pro', 'Análise jurídica e estratégia de lance', 'Acompanhamento até a imissão de posse', 'Suporte com documentação pós-arrematação', 'Registro do imóvel via plataforma (ONR)', '12 meses de acesso · extensível até a posse'].map(t => <CheckItem key={t} txt={t} />)}
              </div>
              <button onClick={() => ir('assessorado')} disabled={atual('assessorado')}
                style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('assessorado') ? '#f1f5f9' : '#d97706', color: atual('assessorado') ? '#94a3b8' : 'white', fontWeight: 800, fontSize: 15, cursor: atual('assessorado') ? 'default' : 'pointer', boxShadow: atual('assessorado') ? 'none' : '0 4px 14px rgba(217,119,6,0.35)' }}>
                {atual('assessorado') ? 'Seu plano atual' : 'Contratar assessoria →'}
              </button>
            </div>
            )}

            {/* Leilão Club */}
            {ativoPlano('clube') && (
            <div style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1e1b4b 100%)', borderRadius: 20, border: '2px solid #6366f1', padding: '32px 28px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: '0 8px 40px rgba(99,102,241,0.3)' }}>
              <div style={{ position: 'absolute', top: -30, right: -30, width: 150, height: 150, borderRadius: '50%', background: 'rgba(99,102,241,0.08)' }} />
              <div style={{ position: 'absolute', top: 20, right: 20, background: '#4f46e5', color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Nível máximo
              </div>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Leilão Club</div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
                <div style={{ fontSize: 42, fontWeight: 900, color: 'white' }}>{PLANOS.clube?.preco ? fmtR(PLANOS.clube.preco / 12) : 'R$ 5.000'}</div>
                <div style={{ fontSize: 15, color: '#a5b4fc', fontWeight: 600 }}>/mês</div>
              </div>
              <div style={{ fontSize: 13, color: '#818cf8', marginBottom: 6 }}>Total {PLANOS.clube?.preco ? fmtR(PLANOS.clube.preco) : 'R$ 60.000'} em 12 meses</div>
              <div style={{ fontSize: 12, color: '#a5b4fc', marginBottom: 20, opacity: 0.8 }}>Ou 12× no cartão/PIX — juros a partir da 4ª parcela</div>
              <div style={{ background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.35)', borderRadius: 10, padding: '10px 14px', marginBottom: 20 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#c7d2fe' }}>+ 10% de honorários sobre cada arrematação</div>
                <div style={{ fontSize: 11, color: '#a5b4fc', marginTop: 3 }}>Cobrado apenas em caso de sucesso</div>
              </div>
              <p style={{ fontSize: 14, color: '#c7d2fe', marginBottom: 20, lineHeight: 1.7 }}>
                Mentoria contínua com assessoria ilimitada para todas as suas arrematações. Acesso total à plataforma e à equipe TSN.
              </p>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
                {['Tudo dos planos anteriores', 'Arrematações ilimitadas com assessoria completa', 'Encontros regulares com Tarcísio (sócio TSN)', 'Oportunidades exclusivas de leilões', 'Estratégia de portfólio personalizada', 'Suporte prioritário com analista dedicado', 'Após 12 meses: cancele a qualquer momento'].map(t => <CheckItem key={t} txt={t} light />)}
              </div>
              <button onClick={() => ir('clube')} disabled={atual('clube')}
                style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('clube') ? 'rgba(255,255,255,0.1)' : '#6366f1', color: atual('clube') ? '#a5b4fc' : 'white', fontWeight: 800, fontSize: 15, cursor: atual('clube') ? 'default' : 'pointer', boxShadow: atual('clube') ? 'none' : '0 4px 20px rgba(99,102,241,0.45)' }}>
                {atual('clube') ? 'Seu plano atual' : 'Entrar no Clube →'}
              </button>
            </div>
            )}
          </div>
        )}

        {/* ── Garantias ── */}
        <div className="grid-3" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16, maxWidth: 820, margin: '56px auto 0' }}>
          {[
            { icon: '🔒', titulo: 'Pagamento 100% seguro', sub: 'Crédito, débito e PIX com ambiente certificado' },
            { icon: '✅', titulo: 'Cancele quando quiser', sub: 'No mensal, sem fidelidade. No anual, cancele a renovação automática — sem estorno do período já contratado' },
            { icon: '🤝', titulo: 'Equipe especializada', sub: 'Analistas, advogados e sócio disponíveis para você' },
          ].map(({ icon, titulo, sub }) => (
            <div key={titulo} style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px 20px', textAlign: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#111', marginBottom: 6 }}>{titulo}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* ── FAQ ── */}
        <div style={{ maxWidth: 720, margin: '72px auto 0' }}>
          <h3 style={{ fontSize: 28, fontWeight: 900, color: '#111', textAlign: 'center', marginBottom: 36 }}>Perguntas frequentes</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQS.map((faq, i) => (
              <div key={i} style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <button onClick={() => setFaqAberto(faqAberto === i ? null : i)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '17px 22px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#111', lineHeight: 1.4 }}>{faq.q}</span>
                  {faqAberto === i ? <ChevronUp size={17} color="#64748b" style={{ flexShrink: 0 }} /> : <ChevronDown size={17} color="#64748b" style={{ flexShrink: 0 }} />}
                </button>
                {faqAberto === i && <div style={{ padding: '0 22px 18px', fontSize: 14, color: '#64748b', lineHeight: 1.8 }}>{faq.r}</div>}
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
