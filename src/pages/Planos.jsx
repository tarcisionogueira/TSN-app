import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, X, Shield, Zap, Users, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { PLANOS } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';

const PLANOS_PAGOS = ['top1', 'top2', 'clube', 'assessorado'];

const FAQS = [
  { q: 'Posso cancelar a qualquer momento?', r: 'Sim. Planos mensais podem ser cancelados sem multa. Planos de assessoria têm contrato com prazo definido.' },
  { q: 'Como funciona o relatório de viabilidade?', r: 'Nossa IA analisa edital, matrícula e documentos do imóvel e gera um relatório completo com análise mercadológica, financeira e jurídica em minutos.' },
  { q: 'Os 10% de honorários são cobrados sobre o quê?', r: 'Sobre o valor da arrematação, somente em caso de sucesso. Se não arrematar, não cobra.' },
  { q: 'Posso usar em qualquer leilão do Brasil?', r: 'Sim. A plataforma agrega leilões judiciais e extrajudiciais de todo o Brasil, de múltiplos leiloeiros.' },
  { q: 'O plano Investidor tem análises ilimitadas?', r: 'Sim. No plano Investidor você pode gerar relatórios ilimitados por mês.' },
];

export default function Planos() {
  const nav = useNavigate();
  const { user, role } = useAuth();
  const planoAtualPreco = PLANOS[role]?.preco ?? -1;
  const [promosPublicas, setPromosPublicas] = useState({});
  const [faqAberto, setFaqAberto] = useState(null);

  useEffect(() => {
    supabase
      .from('links_promo')
      .select('produto, desconto_pct, desconto_valor, descricao_condicoes, validade_ate')
      .eq('ativo', true)
      .eq('publico', true)
      .then(({ data }) => {
        if (!data) return;
        const map = {};
        const hoje = new Date();
        data.forEach(p => {
          if (!(p.validade_ate && new Date(p.validade_ate) < hoje)) map[p.produto] = p;
        });
        setPromosPublicas(map);
      });
  }, []);

  const irParaCheckout = (key, plano) => {
    if (key === role && user) return;
    if (plano.preco === 0) { nav(user ? '/membros' : '/login'); return; }
    nav(user ? `/checkout?plano=${key}` : `/login?plano=${key}`);
  };

  const labelBotao = (key, plano) => {
    if (user && key === role) return 'Seu plano atual';
    if (plano.preco === 0) return 'Começar Grátis';
    if (user && PLANOS_PAGOS.includes(role) && key !== 'assessorado' && role !== 'assessorado') {
      return plano.preco > planoAtualPreco ? 'Fazer upgrade →' : 'Fazer downgrade →';
    }
    return 'Assinar Agora';
  };
  const ehPlanoAtual = (key) => user && key === role;

  const planosHome = Object.entries(PLANOS).filter(([, p]) => p.homepage);
  const planosPremium = Object.entries(PLANOS).filter(([, p]) => !p.homepage && p.id !== 'top1');

  const recursosExplorador = [
    { ok: true,  txt: 'Busca de leilões em todo o Brasil' },
    { ok: true,  txt: 'Acesso aos cursos gratuitos inclusos' },
    { ok: true,  txt: 'Direcionamento ao site do leiloeiro' },
    { ok: false, txt: 'Relatório de viabilidade' },
    { ok: false, txt: 'Análise de edital e matrícula' },
    { ok: false, txt: 'Calculadora de Arrematação' },
  ];

  const recursosInvestidor = [
    { ok: true, txt: 'Tudo do plano Explorador' },
    { ok: true, txt: 'Relatório mercadológico com valor real de mercado' },
    { ok: true, txt: 'Viabilidade financeira com projeções e fluxo de caixa' },
    { ok: true, txt: 'Análise de edital, matrícula e anexos do processo' },
    { ok: true, txt: 'Consulta processual integrada (Jusbrasil/CNJ)' },
    { ok: true, txt: 'Alertas de risco (usufruto, penhora, ônus reais)' },
    { ok: true, txt: 'Análises ilimitadas por mês' },
    { ok: true, txt: 'Calculadora de Arrematação' },
  ];

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>

      {/* Hero */}
      <div style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', padding: '64px 20px 80px', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', background: 'rgba(37,99,235,0.25)', border: '1px solid rgba(37,99,235,0.4)', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 700, color: '#93c5fd', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 20 }}>
          Planos & Preços
        </div>
        <h1 style={{ fontSize: 'clamp(28px, 5vw, 48px)', fontWeight: 900, color: 'white', margin: '0 0 16px', lineHeight: 1.1 }}>
          Invista com inteligência.<br />
          <span style={{ color: '#60a5fa' }}>Arremate com segurança.</span>
        </h1>
        <p style={{ color: '#94a3b8', fontSize: 'clamp(14px, 2vw, 18px)', maxWidth: 560, margin: '0 auto 32px', lineHeight: 1.6 }}>
          Da busca gratuita à assessoria completa — escolha o nível certo para o seu momento no mercado de leilões.
        </p>
        <div style={{ display: 'flex', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
          {[
            { icon: Shield, txt: 'Análise jurídica incluída' },
            { icon: Zap, txt: 'Relatório em minutos' },
            { icon: Users, txt: '+8 anos de experiência' },
          ].map(({ icon: Icon, txt }) => (
            <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
              <Icon size={15} color="#60a5fa" /> {txt}
            </div>
          ))}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 20px 80px' }}>

        {/* Cards principais — sobrepostos no hero */}
        <div style={{ marginTop: -40, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, maxWidth: 820, margin: '-40px auto 0' }} className="planos-grid-2">

          {/* Explorador */}
          {(() => {
            const [key, plano] = planosHome.find(([k]) => k === 'explorador') || [];
            if (!plano) return null;
            const atual = ehPlanoAtual(key);
            const promo = promosPublicas[key];
            return (
              <div style={{ background: 'white', borderRadius: 20, border: atual ? '2px solid #2563eb' : '1px solid #e2e8f0', padding: '32px 28px', boxShadow: '0 4px 20px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column' }}>
                {atual && <div style={{ background: '#dbeafe', color: '#1e40af', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16, display: 'inline-block', alignSelf: 'flex-start' }}>Seu plano</div>}
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>Explorador</div>
                <div style={{ fontSize: 42, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>Grátis</div>
                <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 20 }}>Para sempre</div>
                <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
                  Explore o mercado de leilões sem gastar nada. Ideal para quem está começando a pesquisar.
                </p>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
                  {recursosExplorador.map(({ ok, txt }) => (
                    <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      {ok
                        ? <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Check size={12} color="#16a34a" /></div>
                        : <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><X size={12} color="#dc2626" /></div>
                      }
                      <span style={{ fontSize: 13, color: ok ? '#334155' : '#94a3b8' }}>{txt}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => irParaCheckout(key, plano)} disabled={atual}
                  style={{ width: '100%', padding: '13px', border: atual ? '2px solid #cbd5e1' : '2px solid #e2e8f0', borderRadius: 12, background: atual ? '#f8fafc' : 'white', color: atual ? '#94a3b8' : '#0f172a', fontWeight: 700, fontSize: 14, cursor: atual ? 'default' : 'pointer', transition: 'all 0.15s' }}>
                  {labelBotao(key, plano)}
                </button>
              </div>
            );
          })()}

          {/* Investidor (top2) */}
          {(() => {
            const [key, plano] = planosHome.find(([k]) => k === 'top2') || [];
            if (!plano) return null;
            const atual = ehPlanoAtual(key);
            const promo = promosPublicas[key];
            return (
              <div style={{ background: 'linear-gradient(145deg, #1e40af 0%, #1d4ed8 100%)', borderRadius: 20, border: '2px solid #3b82f6', padding: '32px 28px', boxShadow: '0 8px 32px rgba(37,99,235,0.35)', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />
                <div style={{ position: 'absolute', top: 16, right: 16, background: '#fbbf24', color: '#78350f', fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>
                  ⭐ Mais popular
                </div>
                {atual && <div style={{ background: 'rgba(255,255,255,0.2)', color: 'white', fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16, display: 'inline-block', alignSelf: 'flex-start' }}>Seu plano</div>}
                <div style={{ fontSize: 11, fontWeight: 800, color: '#93c5fd', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>Investidor</div>

                {promo?.desconto_pct > 0 ? (
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <div style={{ fontSize: 42, fontWeight: 900, color: 'white' }}>{plano.precoLabel}</div>
                      <div style={{ fontSize: 16, color: '#93c5fd', textDecoration: 'line-through' }}>{plano.precoOriginalLabel || plano.precoLabel}</div>
                    </div>
                    <div style={{ fontSize: 11, color: '#86efac', fontWeight: 700, marginBottom: 4 }}>🎁 {promo.descricao_condicoes}</div>
                  </div>
                ) : plano.precoOriginal ? (
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <div style={{ fontSize: 42, fontWeight: 900, color: 'white' }}>{plano.precoLabel}</div>
                      <div style={{ fontSize: 16, color: '#93c5fd', textDecoration: 'line-through' }}>{plano.precoOriginalLabel}</div>
                    </div>
                    <div style={{ display: 'inline-block', background: 'rgba(134,239,172,0.2)', border: '1px solid #86efac', color: '#86efac', fontSize: 11, fontWeight: 800, padding: '2px 10px', borderRadius: 20, marginBottom: 4 }}>OFERTA DE LANÇAMENTO</div>
                  </div>
                ) : (
                  <div style={{ fontSize: 42, fontWeight: 900, color: 'white', marginBottom: 4 }}>{plano.precoLabel}</div>
                )}

                <div style={{ fontSize: 13, color: '#93c5fd', marginBottom: 20 }}>por mês · cancele quando quiser</div>
                <p style={{ fontSize: 14, color: '#bfdbfe', marginBottom: 24, lineHeight: 1.6 }}>
                  Relatório completo gerado por IA + análise jurídica documental. Tudo que você precisa para arrematar com segurança.
                </p>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
                  {recursosInvestidor.map(({ txt }) => (
                    <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(134,239,172,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Check size={12} color="#86efac" /></div>
                      <span style={{ fontSize: 13, color: '#e0f2fe' }}>{txt}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => irParaCheckout(key, plano)} disabled={atual}
                  style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual ? 'rgba(255,255,255,0.15)' : 'white', color: atual ? '#93c5fd' : '#1e40af', fontWeight: 800, fontSize: 15, cursor: atual ? 'default' : 'pointer', boxShadow: atual ? 'none' : '0 4px 14px rgba(0,0,0,0.2)', transition: 'all 0.15s' }}>
                  {labelBotao(key, plano)}
                </button>
              </div>
            );
          })()}
        </div>

        {/* Assessoria & Mentoria */}
        <div style={{ textAlign: 'center', margin: '64px 0 32px' }}>
          <div style={{ display: 'inline-block', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 20, padding: '6px 16px', fontSize: 12, fontWeight: 700, color: '#92400e', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 }}>
            Assessoria Personalizada
          </div>
          <h2 style={{ fontSize: 'clamp(22px, 4vw, 32px)', fontWeight: 900, color: '#0f172a', margin: '0 0 12px' }}>Quer a equipe TSN do seu lado?</h2>
          <p style={{ color: '#64748b', fontSize: 16, maxWidth: 500, margin: '0 auto' }}>
            Para quem quer resultados acompanhados por especialistas do início ao fim da arrematação.
          </p>
        </div>

        {!user ? (
          <div style={{ background: 'white', borderRadius: 20, border: '2px dashed #cbd5e1', padding: '48px 32px', textAlign: 'center', maxWidth: 560, margin: '0 auto' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔒</div>
            <h3 style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Faça login para ver os planos de assessoria</h3>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24, maxWidth: 380, margin: '0 auto 24px', lineHeight: 1.6 }}>
              Os planos Assessorado e Clube de Negócios são exclusivos para membros cadastrados.
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => nav('/login')} style={{ padding: '12px 28px', background: '#0f172a', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Entrar na minha conta
              </button>
              <button onClick={() => nav('/login')} style={{ padding: '12px 28px', background: 'transparent', color: '#0f172a', border: '2px solid #e2e8f0', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Criar conta grátis
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 20, maxWidth: 820, margin: '0 auto' }} className="planos-grid-2">
            {planosPremium.map(([key, plano]) => {
              const atual = ehPlanoAtual(key);
              return (
                <div key={key} style={{ background: 'white', borderRadius: 20, border: atual ? `2px solid ${plano.cor}` : `1px solid ${plano.cor}44`, padding: '32px 28px', boxShadow: `0 4px 24px ${plano.cor}18`, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  {plano.destaque && !atual && (
                    <div style={{ position: 'absolute', top: -12, right: 24, background: plano.cor, color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>Nível máximo</div>
                  )}
                  {atual && <div style={{ background: plano.bg, color: plano.cor, fontSize: 10, fontWeight: 800, padding: '3px 10px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 16, display: 'inline-block', alignSelf: 'flex-start' }}>Seu plano</div>}
                  <div style={{ fontSize: 11, fontWeight: 800, color: plano.cor, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 8 }}>{plano.nome}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
                    <div style={{ fontSize: 36, fontWeight: 900, color: '#0f172a' }}>{plano.precoLabel}</div>
                    <div style={{ fontSize: 13, color: '#94a3b8' }}>{key === 'assessorado' ? '× 12 parcelas' : '/mês'}</div>
                  </div>
                  {key === 'assessorado' && (
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>ou R$ 5.000 à vista</div>
                  )}
                  {key === 'clube' && (
                    <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>12 meses · ou R$ 48.000 à vista</div>
                  )}
                  <div style={{ display: 'inline-block', background: plano.bg, color: plano.cor, fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 8, marginBottom: 16 }}>
                    + 10% de honorários sobre a arrematação
                  </div>
                  <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.6 }}>{plano.descricao}</p>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
                    {plano.recursos.map(f => (
                      <div key={f} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: plano.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}><Check size={12} color={plano.cor} /></div>
                        <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.4 }}>{f.replace(/^✅\s*/, '')}</span>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => irParaCheckout(key, plano)} disabled={atual}
                    style={{ width: '100%', padding: '13px', border: 'none', borderRadius: 12, background: atual ? '#f1f5f9' : plano.cor, color: atual ? '#94a3b8' : 'white', fontWeight: 700, fontSize: 14, cursor: atual ? 'default' : 'pointer', boxShadow: atual ? 'none' : `0 4px 14px ${plano.cor}44` }}>
                    {atual ? 'Seu plano atual' : 'Quero esse plano →'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* Garantias */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, maxWidth: 820, margin: '48px auto 0' }} className="planos-grid-3">
          {[
            { icon: '🔒', titulo: 'Pagamento seguro', sub: 'Pix, cartão ou boleto com ambiente protegido' },
            { icon: '↩️', titulo: 'Cancele quando quiser', sub: 'Sem fidelidade nos planos mensais' },
            { icon: '🤝', titulo: 'Suporte especializado', sub: 'Equipe de analistas e advogados disponível' },
          ].map(({ icon, titulo, sub }) => (
            <div key={titulo} style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 4 }}>{titulo}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>{sub}</div>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div style={{ maxWidth: 720, margin: '64px auto 0' }}>
          <h3 style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', textAlign: 'center', marginBottom: 32 }}>Perguntas frequentes</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {FAQS.map((faq, i) => (
              <div key={i} style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <button onClick={() => setFaqAberto(faqAberto === i ? null : i)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{faq.q}</span>
                  {faqAberto === i ? <ChevronUp size={18} color="#64748b" /> : <ChevronDown size={18} color="#64748b" />}
                </button>
                {faqAberto === i && (
                  <div style={{ padding: '0 20px 16px', fontSize: 14, color: '#64748b', lineHeight: 1.7 }}>{faq.r}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        <p style={{ textAlign: 'center', marginTop: 48, fontSize: 13, color: '#94a3b8' }}>
          Dúvidas? Fale com nossa equipe pelo chat ·{' '}
          <span style={{ color: '#2563eb', cursor: 'pointer', fontWeight: 600 }}
            onClick={() => window.dispatchEvent(new CustomEvent('tsn:open-chat'))}>
            Abrir suporte
          </span>
        </p>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .planos-grid-2 { grid-template-columns: 1fr !important; }
          .planos-grid-3 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
