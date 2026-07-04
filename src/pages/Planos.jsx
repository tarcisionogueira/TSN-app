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
  { q: 'O plano Assessoria cobre quantas arrematações?', r: 'Uma arrematação por contrato. O assessorado tem até 12 meses para realizar a arrematação — buscando oportunidades e também recebendo indicações da nossa equipe —, com acompanhamento completo do início até a imissão de posse.' },
  // (FAQ de honorários removido da tela comercial — detalhes ficam no checkout/contrato)
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
  const [dv, setDv] = useState({ open: false, nome: '', email: user?.email || '', tel: '', msg: '', enviando: false, ok: false, erro: '' });

  const enviarDuvida = async () => {
    setDv(d => ({ ...d, enviando: true, erro: '' }));
    try {
      const r = await fetch('/api/duvida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: dv.nome, email: dv.email, telefone: dv.tel, mensagem: dv.msg, origem: 'duvida_planos' }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Erro ao enviar');
      setDv(s => ({ ...s, enviando: false, ok: true }));
    } catch (e) {
      setDv(s => ({ ...s, enviando: false, erro: e.message }));
    }
  };

  useEffect(() => { fetchPlanosComConfig().then(setPLANOS); }, []);

  // Formata um valor; usado para totais/economias derivados do planos_config.
  const fmtR = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Preço de um plano vindo do banco, com fallback ao label estático.
  const pLabel = (key, field, fallback) => PLANOS[key]?.[field] ?? fallback;
  const ativoPlano = (key) => PLANOS[key]?.ativo !== false; // mostra durante o load (undefined)

  // Valores reais do Investidor Pro (planos_config) para o FAQ
  const _precoMes = Number(PLANOS.top2?.preco) || 49.90;
  const _precoAno = Number(PLANOS.top2?.precoAnual) || 449.90;
  const _economiaPct = _precoMes ? (1 - _precoAno / (_precoMes * 12)) * 100 : 25;
  const FAQS = buildFAQS({
    precoMesLabel: fmtR(_precoMes),
    mesAnualLabel: fmtR(_precoAno / 12),
    anoLabel: fmtR(_precoAno),
    economiaPctLabel: `${Number(_economiaPct).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
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

  const CheckItem = ({ txt, light, off }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, opacity: off ? 0.65 : 1 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: off ? '#f1f5f9' : light ? 'rgba(134,239,172,0.2)' : '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
        {off ? <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 800, lineHeight: 1 }}>×</span> : <Check size={10} color={light ? '#86efac' : '#16a34a'} strokeWidth={3} />}
      </div>
      <span style={{ fontSize: 13, color: off ? '#94a3b8' : light ? '#e0f2fe' : '#334155', lineHeight: 1.55 }}>{txt}</span>
    </div>
  );

  // Preço comercial: valor À VISTA (PIX/cartão 1×) em DESTAQUE com o % off, e o
  // valor cheio + parcelas em texto discreto. `mensal` mostra o cheio como /mês
  // (Leilão Club); senão como 12× (Assessoria). Regra de juros: sem juros até 3×.
  const PrecoComercial = ({ planoKey, dark, mensal }) => {
    const p = PLANOS[planoKey] || {};
    const vistaLabel = p.precoVistaLabel || p.precoLabel || '';
    const desc = Number(p.desconto_vista_pct) || 0;
    const cheio = Number(p.preco) || 0;
    const cheioLabel = p.precoLabel || '';
    const vistaNum = p.precoVista || cheio;
    const economia = desc > 0 && cheio && vistaNum ? cheio - vistaNum : 0;
    const corPrim = dark ? 'white' : '#111';
    const corSec = dark ? '#c7d2fe' : '#475569';
    const corDis = dark ? 'rgba(165,180,252,0.85)' : '#94a3b8';
    const badgeBg = dark ? 'rgba(134,239,172,0.16)' : '#dcfce7';
    const badgeFg = dark ? '#86efac' : '#15803d';
    const discreto = mensal
      ? `ou ${fmtR(cheio / 12)}/mês — total ${cheioLabel} em 12×`
      : `ou ${cheioLabel} em até 12× de ${fmtR(cheio / 12)}`;
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 42, fontWeight: 900, color: corPrim, lineHeight: 1.05 }}>{vistaLabel}</div>
          {desc > 0 && <span style={{ background: badgeBg, color: badgeFg, fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>{desc.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% OFF à vista</span>}
        </div>
        <div style={{ fontSize: 13, color: corSec, marginTop: 5, fontWeight: 600 }}>
          à vista no PIX ou cartão{economia ? ` · economize ${fmtR(economia)}` : ''}
        </div>
        <div style={{ fontSize: 12, color: corDis, marginTop: 7 }}>{discreto} · sem juros até 3×</div>
      </div>
    );
  };

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
              {['Busca de leilões em todo o Brasil', '5 relatórios Mercadológicos + Viabilidade/mês', 'Calculadora de Arrematação', 'Cursos e materiais gratuitos', 'Acesso ao site do leiloeiro'].map(t => <CheckItem key={t} txt={t} />)}
              <CheckItem txt="Análise Documental e Jurídica (Investidor Pro)" off />
            </div>
            <button onClick={() => nav('/checkout?plano=explorador')} disabled={atual('explorador')}
              style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('explorador') ? '#f1f5f9' : '#111', color: atual('explorador') ? '#94a3b8' : 'white', fontWeight: 800, fontSize: 15, cursor: atual('explorador') ? 'default' : 'pointer' }}>
              {atual('explorador') ? 'Seu plano atual' : 'Começar grátis →'}
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
                'Rentabilidade do aluguel (mensal e anual)',
                'Análise processual do imóvel',
                'Alertas de risco (penhora, ônus reais)',
                '15 relatórios mercadológicos/mês',
                '15 relatórios documentais e jurídicos/mês',
              ].map(t => <CheckItem key={t} txt={t} light />)}
            </div>
            <button onClick={() => nav('/checkout?plano=top2')} disabled={atual('top2')}
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
            A nossa equipe do seu lado, do lance à posse.
          </h2>
          <p style={{ color: '#64748b', fontSize: 15, maxWidth: 520, margin: '0 auto', lineHeight: 1.7 }}>
            Para quem quer resultado com segurança total — análise, estratégia, documentação e registro feitos por especialistas.
          </p>
        </div>

        {!user ? (
          <div style={{ background: 'white', borderRadius: 20, border: '1px solid #e2e8f0', padding: '36px 32px', textAlign: 'center', maxWidth: 600, margin: '0 auto', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🤝</div>
            <h3 style={{ fontSize: 19, fontWeight: 800, color: '#111', marginBottom: 10 }}>Também oferecemos assessoria e mentoria em leilões</h3>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              Para quem quer ir além: acompanhamento completo da análise à imissão de posse, e mentoria contínua para escalar com método. Conheça as opções de assessoria e mentoria dentro da plataforma.
            </p>
          </div>
        ) : (
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 880, margin: '0 auto' }}>

            {/* Assessoria */}
            {ativoPlano('assessorado') && (
            <div style={{ background: 'white', borderRadius: 20, border: atual('assessorado') ? '2px solid #d97706' : '1px solid #fed7aa', padding: '32px 28px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(217,119,6,0.08)' }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: '#d97706', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Assessoria</div>
              <PrecoComercial planoKey="assessorado" />
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>1 arrematação · pagamento único</div>
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
              <PrecoComercial planoKey="clube" dark mensal />
              <p style={{ fontSize: 14, color: '#c7d2fe', marginBottom: 20, lineHeight: 1.7 }}>
                Mentoria contínua com assessoria ilimitada para todas as suas arrematações. Acesso total à plataforma e à nossa equipe.
              </p>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
                {['Tudo dos planos anteriores', 'Arrematações ilimitadas com assessoria completa', 'Encontros regulares com nossos especialistas', 'Oportunidades exclusivas de leilões', 'Estratégia de portfólio personalizada', 'Suporte prioritário com analista dedicado', 'Após 12 meses: cancele a qualquer momento'].map(t => <CheckItem key={t} txt={t} light />)}
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

        {/* ── Tirar dúvida (vai por e-mail ao consultor) ── */}
        <div style={{ maxWidth: 560, margin: '52px auto 0', textAlign: 'center' }}>
          {!dv.open && !dv.ok && (
            <p style={{ fontSize: 14, color: '#64748b' }}>
              Ficou com alguma dúvida?{' '}
              <span style={{ color: '#0D63DB', cursor: 'pointer', fontWeight: 700 }} onClick={() => setDv(d => ({ ...d, open: true }))}>
                Envie sua pergunta
              </span>{' '}— respondemos por e-mail.
            </p>
          )}

          {dv.open && !dv.ok && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '22px 22px', textAlign: 'left', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: '#111', marginBottom: 12 }}>Tirar uma dúvida</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <input value={dv.nome} onChange={e => setDv(d => ({ ...d, nome: e.target.value }))} placeholder="Seu nome"
                  style={{ flex: 1, minWidth: 160, padding: '11px 13px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14 }} />
                <input value={dv.email} onChange={e => setDv(d => ({ ...d, email: e.target.value }))} placeholder="Seu e-mail (para a resposta)" type="email"
                  style={{ flex: 1, minWidth: 160, padding: '11px 13px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14 }} />
              </div>
              <input value={dv.tel} onChange={e => setDv(d => ({ ...d, tel: e.target.value }))} placeholder="Telefone / WhatsApp (opcional)" type="tel"
                style={{ width: '100%', padding: '11px 13px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, boxSizing: 'border-box', marginBottom: 10 }} />
              <textarea value={dv.msg} onChange={e => setDv(d => ({ ...d, msg: e.target.value }))} placeholder="Escreva sua dúvida…" rows={4}
                style={{ width: '100%', padding: '11px 13px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
              {dv.erro && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{dv.erro}</div>}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 12 }}>
                <button onClick={() => setDv(d => ({ ...d, open: false }))} style={{ padding: '10px 18px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', color: '#64748b', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
                <button onClick={enviarDuvida} disabled={dv.enviando}
                  style={{ padding: '10px 22px', border: 'none', borderRadius: 10, background: '#0D63DB', color: 'white', fontWeight: 700, fontSize: 13, cursor: dv.enviando ? 'default' : 'pointer', opacity: dv.enviando ? 0.7 : 1 }}>
                  {dv.enviando ? 'Enviando…' : 'Enviar dúvida'}
                </button>
              </div>
            </div>
          )}

          {dv.ok && (
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 16, padding: '22px', color: '#15803d', fontWeight: 600, fontSize: 14 }}>
              ✅ Dúvida enviada! Nossa equipe vai responder no seu e-mail em breve.
            </div>
          )}
        </div>
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
