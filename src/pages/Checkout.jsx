import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Loader2, CheckCircle2, ExternalLink, Briefcase, ShieldCheck, TrendingUp, Headphones, ArrowUpRight, ArrowDownRight, AlertTriangle, RefreshCw } from 'lucide-react';
import { PLANOS } from '../data/cursos';
import { supabase } from '../utils/supabase';

const PLANOS_PAGOS = ['top1', 'top2', 'clube', 'assessorado'];

// Mapeia mensagens técnicas de erro do Asaas para orientações amigáveis
const MENSAGENS_RECUSA = [
  {
    detectar: ['INSUFFICIENT_FUNDS', 'saldo insuficiente', 'insufficient'],
    titulo: 'Saldo ou limite insuficiente',
    orientacao: 'Seu cartão não possui limite disponível para esta transação. Tente outro cartão, realize um pagamento via PIX, ou libere o limite com seu banco.',
    icone: '💳',
  },
  {
    detectar: ['EXPIRED_CARD', 'cartão vencido', 'expired'],
    titulo: 'Cartão vencido',
    orientacao: 'O cartão informado está expirado. Use um cartão com data de validade vigente ou escolha pagar via PIX ou boleto.',
    icone: '📅',
  },
  {
    detectar: ['INVALID_SECURITY_CODE', 'cvv', 'security code', 'código de segurança'],
    titulo: 'Código de segurança inválido',
    orientacao: 'O CVV digitado não corresponde ao cartão. Verifique os 3 dígitos no verso do cartão (ou 4 dígitos na frente, para Amex).',
    icone: '🔒',
  },
  {
    detectar: ['TRANSACTION_NOT_PERMITTED', 'não permitida', 'not permitted', 'bloqueado'],
    titulo: 'Transação não permitida pelo banco',
    orientacao: 'Seu banco bloqueou a transação. Acesse o app do seu banco, libere compras online ou entre em contato com a central de atendimento do cartão.',
    icone: '🏦',
  },
  {
    detectar: ['CREDIT_LIMIT_EXCEEDED', 'limite excedido', 'limit exceeded'],
    titulo: 'Limite do cartão excedido',
    orientacao: 'Você atingiu o limite de crédito disponível. Tente outro cartão ou escolha pagar via PIX para ativação imediata.',
    icone: '📊',
  },
  {
    detectar: ['INVALID_CARD_DATA', 'dados inválidos', 'invalid card'],
    titulo: 'Dados do cartão inválidos',
    orientacao: 'Os dados do cartão foram recusados. Confira o número, o nome impresso, a validade e o CVV. Tente novamente ou use outro meio de pagamento.',
    icone: '⚠️',
  },
];

function mapearErro(msg = '') {
  const lower = msg.toLowerCase();
  for (const m of MENSAGENS_RECUSA) {
    if (m.detectar.some(d => lower.includes(d.toLowerCase()))) return m;
  }
  return null;
}

export default function Checkout() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const { user, role } = useAuth();
  const planoKey = params.get('plano');
  const promoCode = params.get('promo')?.toUpperCase() || '';
  const plano = PLANOS[planoKey];

  const [loading, setLoading] = useState(false);
  const [promoInfo, setPromoInfo] = useState(null);
  const [linkPagamento, setLinkPagamento] = useState(null);
  const [resultadoMudanca, setResultadoMudanca] = useState(null);
  const [erro, setErro] = useState('');
  const [pago, setPago] = useState(false); // tela de aprovado
  const [modalidade, setModalidade] = useState('mensal'); // 'mensal' | 'vista'
  const [aceitouTermos, setAceitouTermos] = useState(false);
  const [asaasIds, setAsaasIds] = useState(null); // { subscriptionId, paymentId }
  const [verificando, setVerificando] = useState(false);
  const pollingRef = React.useRef(null);

  const temModalidade = planoKey === 'assessorado' || planoKey === 'clube';
  const planoApiKey = temModalidade && modalidade === 'vista' ? `${planoKey}_vista` : planoKey;

  useEffect(() => {
    if (!user && planoKey !== 'explorador') nav(`/login?plano=${planoKey}${promoCode ? '&promo=' + promoCode : ''}`);
  }, [user]);

  useEffect(() => {
    if (!promoCode) return;
    import('../utils/supabase').then(({ supabase }) => {
      supabase.from('links_promo').select('*').eq('codigo', promoCode).eq('ativo', true).single()
        .then(({ data }) => { if (data) setPromoInfo(data); });
    });
  }, [promoCode]);

  React.useEffect(() => {
    if (!plano && planoKey !== 'explorador') nav('/');
  }, [planoKey]);

  // Polling automático — verifica a cada 8s se o Asaas confirmou o pagamento
  useEffect(() => {
    if (!asaasIds || pago) return;
    setVerificando(true);
    const verificar = async () => {
      try {
        const res = await fetch('/api/verificar-pagamento', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(asaasIds),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (data.confirmado) {
          clearInterval(pollingRef.current);
          setVerificando(false);
          confirmarPagamento();
        }
      } catch (_) {}
    };
    verificar(); // primeira verificação imediata
    pollingRef.current = setInterval(verificar, 8000);
    return () => clearInterval(pollingRef.current);
  }, [asaasIds, pago]);

  if (!plano && planoKey !== 'explorador') return null;

  // Página de apresentação do plano Explorador (gratuito)
  if (planoKey === 'explorador') {
    const planoExp = PLANOS['explorador'];
    return (
      <div style={{ minHeight: '100vh', background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) minmax(280px, 420px)', gap: 24, maxWidth: 840, width: '100%', alignItems: 'stretch' }} className="checkout-grid">
          {/* Coluna esquerda — apresentação */}
          <div style={{ color: 'white' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 }}>
              <div style={{ background: '#2563eb', borderRadius: 12, padding: 10, fontSize: 20 }}>🏢</div>
              <div>
                <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 1 }}>TSN ATIVOS</div>
                <div style={{ fontSize: 11, color: '#64748b', letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#10b981', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>Plano Explorador — Gratuito</div>
            <h1 style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.2, margin: '0 0 16px' }}>Comece a explorar leilões imobiliários sem pagar nada.</h1>
            <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.8, marginBottom: 28 }}>
              Crie sua conta gratuitamente e tenha acesso à plataforma TSN Ativos — sem cartão de crédito, sem compromisso.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                'Acesso à plataforma TSN Ativos',
                'Calculadora de lances gratuita',
                'Visualização de leilões disponíveis',
                'Perfil de investidor ativo',
                'Suporte via chat da plataforma',
              ].map(r => (
                <div key={r} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: '#10b98122', border: '1px solid #10b98144', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ color: '#10b981', fontSize: 12 }}>✓</span>
                  </div>
                  <span style={{ fontSize: 13, color: '#cbd5e1' }}>{r}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Coluna direita — CTA */}
          <div style={{ background: 'white', borderRadius: 20, padding: '36px 32px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#0f172a', marginBottom: 4 }}>Grátis</div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>Sem cartão de crédito · Cancele quando quiser</div>
            <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '14px 16px', marginBottom: 24, fontSize: 13, color: '#166534', fontWeight: 600 }}>
              ✅ Acesso imediato após o cadastro
            </div>
            <button onClick={() => nav('/login?modo=cadastro')}
              style={{ width: '100%', padding: '15px', background: '#10b981', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', marginBottom: 12 }}>
              Criar conta grátis →
            </button>
            <button onClick={() => nav('/planos')}
              style={{ width: '100%', padding: '12px', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: 12, fontWeight: 600, fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
              Ver todos os planos
            </button>
            <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', margin: 0 }}>
              Já tem conta? <button onClick={() => nav('/login')} style={{ background: 'none', border: 'none', color: '#2563eb', fontWeight: 700, cursor: 'pointer', fontSize: 11 }}>Entrar</button>
            </p>
          </div>
        </div>
        <style>{`@media (max-width: 760px) { .checkout-grid { grid-template-columns: 1fr !important; } }`}</style>
      </div>
    );
  }

  const nomeUsuario = user?.user_metadata?.nome || user?.email?.split('@')[0] || '';
  const cpfUsuario = user?.user_metadata?.cpf || '';

  // Mudança de plano: já assina um plano pago e escolheu outro plano recorrente
  const planoAtual = PLANOS[role];
  const ehMudanca = PLANOS_PAGOS.includes(role) && role !== planoKey && planoKey !== 'assessorado' && role !== 'assessorado';
  const ehUpgrade = ehMudanca && plano.preco > (planoAtual?.preco || 0);

  // Log de aceite para proteção contra chargeback
  const logAceite = async (planoKey, valor, asaasData) => {
    if (!user) return;
    try {
      await supabase.from('aceites_plano').insert({
        user_id: user.id,
        user_email: user.email,
        plano_key: planoKey,
        valor: valor,
        asaas_payment_id: asaasData?.subscriptionId || asaasData?.customerId || null,
        asaas_subscription_id: asaasData?.subscriptionId || null,
        user_agent: navigator.userAgent,
        termos_versao: '1.0',
      });
    } catch (_) {}
  };

  const gerarLink = async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await fetch('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'criar_assinatura',
          nome: nomeUsuario,
          email: user.email,
          cpf: cpfUsuario,
          plano: planoApiKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao gerar cobrança');
      const link = data.linkPagamento;
      setLinkPagamento(link);
      // Log de aceite dos termos para proteção contra chargeback
      await logAceite(planoApiKey, plano.preco, data);
      // Abre o link do Asaas em nova aba automaticamente
      if (link) window.location.href = link;
      // Salva IDs para polling de verificação
      const ids = { subscriptionId: data.subscriptionId || null, paymentId: data.paymentId || null };
      setAsaasIds(ids);
      // Salva o ID do customer Asaas no perfil
      if (data.customerId && user?.id) {
        supabase.from('perfis').update({ asaas_id: data.customerId }).eq('id', user.id).then(() => {});
      }
    } catch (err) {
      setErro(err.message);
    }
    setLoading(false);
  };

  const mudarPlano = async () => {
    setLoading(true);
    setErro('');
    try {
      const res = await fetch('/api/asaas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'gerenciar_assinatura', email: user.email, plano: planoKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao alterar plano');
      setResultadoMudanca(data);
      if (data.linkPagamento) {
        setLinkPagamento(data.linkPagamento);
        window.location.href = data.linkPagamento;
      } else {
        // Mudança sem link (downgrade): mostra sucesso e redireciona
        setTimeout(() => nav('/'), 3000);
      }
    } catch (err) {
      setErro(err.message);
    }
    setLoading(false);
  };

  const confirmarPagamento = async () => {
    setPago(true);
    if (planoKey === 'assessorado' || planoKey === 'clube') {
      try {
        const res = await fetch('/api/auto-contrato', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: user?.id,
            planoKey,
            nomeUsuario,
            emailUsuario: user?.email,
          }),
        });
        const data = await res.json();
        if (data.token) {
          setTimeout(() => nav(`/c/${data.token}`), 2000);
          return;
        }
      } catch (_) {}
    }
    setTimeout(() => nav('/'), 3500);
  };

  // Tela de aprovado — cobre tudo, redireciona para home (ou contrato)
  const ehContratoPlano = planoKey === 'assessorado' || planoKey === 'clube';
  if (pago) return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #064e3b 0%, #065f46 100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center' }}>
      <div style={{ fontSize: 72, marginBottom: 24, animation: 'pop 0.4s ease' }}>✅</div>
      <h1 style={{ color: 'white', fontWeight: 900, fontSize: 32, margin: '0 0 12px' }}>Pagamento aprovado!</h1>
      <p style={{ color: '#a7f3d0', fontSize: 16, margin: '0 0 32px', lineHeight: 1.6 }}>
        {ehContratoPlano ? (
          <>Pagamento aprovado! Preparando seu contrato para assinatura…</>
        ) : (
          <>Seu plano <strong style={{ color: 'white' }}>{plano?.nome}</strong> está ativo.<br/>Redirecionando para o início em instantes…</>
        )}
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: '#6ee7b7', fontSize: 14 }}>
        <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Aguarde…
      </div>
      <style>{`@keyframes pop{0%{transform:scale(0.5);opacity:0}80%{transform:scale(1.1)}100%{transform:scale(1);opacity:1}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>

      {/* Popup de erro — overlay sobre o checkout */}
      {erro && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={() => setErro('')}>
          <div style={{ background: 'white', borderRadius: 20, padding: '32px 30px', maxWidth: 440, width: '100%', boxShadow: '0 24px 60px rgba(0,0,0,0.4)', textAlign: 'center' }}
            onClick={e => e.stopPropagation()}>
            {(() => {
              const m = mapearErro(erro);
              return m ? (
                <>
                  <div style={{ fontSize: 52, marginBottom: 12 }}>{m.icone}</div>
                  <h3 style={{ color: '#dc2626', margin: '0 0 10px', fontWeight: 900, fontSize: 20 }}>{m.titulo}</h3>
                  <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, margin: '0 0 24px' }}>{m.orientacao}</p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: 52, marginBottom: 12 }}>⚠️</div>
                  <h3 style={{ color: '#dc2626', margin: '0 0 10px', fontWeight: 900, fontSize: 20 }}>Pagamento não processado</h3>
                  <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, margin: '0 0 24px' }}>{erro}</p>
                </>
              );
            })()}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setErro('')}
                style={{ padding: '10px 20px', background: '#dc2626', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                <RefreshCw size={14} /> Tentar novamente
              </button>
              <a href="https://wa.me/5571996502234" target="_blank" rel="noreferrer"
                style={{ padding: '10px 20px', background: '#25d366', color: 'white', borderRadius: 10, fontWeight: 700, fontSize: 14, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
                💬 Falar com suporte
              </a>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 380px) minmax(280px, 460px)', gap: 24, maxWidth: 880, width: '100%', alignItems: 'stretch' }} className="checkout-grid">

        {/* Coluna esquerda — conteúdo TSN sobre o produto */}
        <div style={{ color: 'white', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '8px 4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
            <div style={{ background: '#2563eb', borderRadius: 10, padding: '8px 10px' }}>
              <Briefcase size={20} color="white" />
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>TSN ATIVOS</div>
              <div style={{ fontSize: 9, color: '#94a3b8', fontWeight: 700, letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
            </div>
          </div>
          <h2 style={{ fontSize: 26, fontWeight: 900, lineHeight: 1.25, margin: '0 0 14px' }}>
            Arremate imóveis com segurança e inteligência de dados.
          </h2>
          <p style={{ color: '#cbd5e1', fontSize: 14, lineHeight: 1.6, margin: '0 0 24px' }}>
            A TSN une análise mercadológica, viabilidade financeira e leitura jurídica para você investir em leilões com confiança — do primeiro lance à arrematação.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              [TrendingUp, 'Viabilidade real', 'Relatórios de mercado e fluxo de caixa antes de dar o lance.'],
              [ShieldCheck, 'Risco jurídico mapeado', 'Análise de edital, matrícula e processo para evitar surpresas.'],
              [Headphones, 'Suporte da equipe', 'Assessoria humana quando você precisar avançar na arrematação.'],
            ].map(([Icon, t, d]) => (
              <div key={t} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ background: 'rgba(37,99,235,0.2)', borderRadius: 9, padding: 8, flexShrink: 0 }}><Icon size={16} color="#60a5fa" /></div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{t}</div>
                  <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.5 }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coluna direita — card de checkout */}
        <div style={{ background: 'white', borderRadius: 20, padding: '36px 34px', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>

          {ehMudanca && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: ehUpgrade ? '#eff6ff' : '#fef3c7', color: ehUpgrade ? '#1d4ed8' : '#92400e', fontSize: 12, fontWeight: 800, padding: '5px 12px', borderRadius: 20, marginBottom: 16 }}>
              {ehUpgrade ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {ehUpgrade ? 'Upgrade de plano' : 'Downgrade de plano'}
            </div>
          )}

          <h2 style={{ margin: '0 0 4px', fontWeight: 900, fontSize: 22, color: '#0f172a' }}>
            Plano {plano.nome}
          </h2>

          {/* Seletor de modalidade — apenas para assessorado e clube */}
          {temModalidade && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 16, background: '#f1f5f9', borderRadius: 10, padding: 4 }}>
              {[
                { key: 'mensal', label: planoKey === 'assessorado' ? '12× R$ 500 (total R$ 6.000)' : '12× R$ 5.000 (total R$ 60.000)' },
                { key: 'vista',  label: planoKey === 'assessorado' ? 'À vista R$ 5.000 (20% off)' : 'À vista R$ 48.000 (20% off)' },
              ].map(({ key, label }) => (
                <button key={key} onClick={() => setModalidade(key)}
                  style={{ flex: 1, padding: '8px 4px', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer',
                    background: modalidade === key ? plano.cor : 'transparent',
                    color: modalidade === key ? 'white' : '#64748b' }}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {promoInfo ? (() => {
            const orig = temModalidade && modalidade === 'vista' ? (plano.precoVista || plano.preco) : plano.preco;
            const promo = promoInfo.desconto_pct > 0
              ? orig * (1 - promoInfo.desconto_pct / 100)
              : promoInfo.desconto_valor > 0 ? Math.max(0, orig - promoInfo.desconto_valor) : orig;
            const fmtR = v => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
            return (
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, color: '#94a3b8', textDecoration: 'line-through' }}>R$ {fmtR(orig)}</span>
                  <strong style={{ color: '#059669', fontSize: 28 }}>R$ {fmtR(promo)}</strong>
                  <span style={{ color: '#64748b', fontSize: 15 }}>{plano.periodicidade}</span>
                </div>
                <div style={{ marginTop: 8, padding: '8px 12px', background: '#fef9c3', borderRadius: 8, fontSize: 13, color: '#a16207', fontWeight: 700 }}>
                  🎁 Código <strong>{promoCode}</strong> aplicado
                  {promoInfo.descricao_condicoes && ` — ${promoInfo.descricao_condicoes}`}
                </div>
              </div>
            );
          })() : (
            <p style={{ margin: '0 0 20px', color: '#64748b', fontSize: 15 }}>
              {temModalidade && modalidade === 'vista' ? (
                <>
                  <strong style={{ color: '#0f172a', fontSize: 28 }}>{plano.precoVistaLabel}</strong>
                  {' '}à vista · sem renovação automática
                </>
              ) : (
                <>
                  <strong style={{ color: '#0f172a', fontSize: 28 }}>{plano.precoLabel}</strong> {plano.periodicidade}
                </>
              )}
            </p>
          )}
          {plano.honorarios && (
            <div style={{ background: plano.bg, color: plano.cor, fontSize: 13, fontWeight: 700, padding: '8px 12px', borderRadius: 8, marginBottom: 16 }}>
              {plano.honorarios}
            </div>
          )}

          <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px', marginBottom: 20 }}>
            {(plano.recursos || plano.features || []).map(f => (
              <div key={f} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                <CheckCircle2 size={14} color={plano.cor} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13, color: '#334155' }}>{f.replace(/^[✅❌]\s*/, '')}</span>
              </div>
            ))}
          </div>

          {ehMudanca && planoAtual && (
            <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#64748b' }}>
              Plano atual: <strong>{planoAtual.nome}</strong> ({planoAtual.precoLabel})
            </div>
          )}
          {/* Aviso LGPD — CPF e nome são enviados ao processador de pagamento */}
          <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '8px 12px', marginBottom: 20, fontSize: 11, color: '#0369a1', lineHeight: 1.5 }}>
            Seus dados (nome e CPF) serão compartilhados com o processador de pagamento para emissão da cobrança, conforme a <strong>Lei nº 13.709/2018 (LGPD)</strong>.
          </div>

          {/* Resultado de mudança de plano */}
          {resultadoMudanca ? (
            <div>
              <div style={{ background: '#d1fae5', border: '1px solid #6ee7b7', borderRadius: 10, padding: '14px', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#065f46', marginBottom: 6 }}>
                  <CheckCircle2 size={16} /> Plano alterado com sucesso!
                </div>
                {resultadoMudanca.tipo === 'upgrade' ? (
                  <p style={{ margin: 0, fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                    Geramos a cobrança da diferença de <strong>R$ {Number(resultadoMudanca.cobrancaDiferenca).toFixed(2)}</strong>. O vencimento da recorrência permanece em <strong>{resultadoMudanca.proximoVencimento}</strong>.
                  </p>
                ) : (
                  <p style={{ margin: 0, fontSize: 13, color: '#047857', lineHeight: 1.6 }}>
                    Você mantém os benefícios do plano atual até a próxima cobrança (<strong>{resultadoMudanca.proximoVencimento}</strong>), quando passará a pagar <strong>{plano.precoLabel}</strong>.
                  </p>
                )}
              </div>
              {linkPagamento && (
                <a href={linkPagamento} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '14px', background: '#10b981', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 15, textDecoration: 'none', boxSizing: 'border-box' }}>
                  <ExternalLink size={16} /> Pagar diferença agora
                </a>
              )}
            </div>
          ) : linkPagamento ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔗</div>
              <p style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8, fontSize: 16 }}>Página de pagamento aberta!</p>
              <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 20 }}>
                Complete o pagamento na aba que abrimos. Após confirmar o pagamento, clique no botão abaixo.
              </p>
              <a href={linkPagamento} target="_blank" rel="noopener noreferrer"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '12px', background: '#f1f5f9', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 10, fontWeight: 600, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box', marginBottom: 10 }}>
                <ExternalLink size={15} /> Reabrir página de pagamento
              </a>
              <div style={{ width: '100%', padding: '14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 12, textAlign: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#166534', fontWeight: 700, fontSize: 14, marginBottom: 4 }}>
                  <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />
                  Aguardando confirmação do pagamento…
                </div>
                <p style={{ fontSize: 12, color: '#4ade80', margin: 0 }}>Verificando automaticamente a cada 8 segundos</p>
              </div>
              <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10, textAlign: 'center' }}>
                Assim que seu pagamento for processado, seu plano será ativado automaticamente.
              </p>
            </div>
          ) : (
            <>
              {/* Aceite dos termos — prova de consentimento */}
              {!linkPagamento && (
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#475569', cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={aceitouTermos} onChange={e => setAceitouTermos(e.target.checked)} style={{ marginTop: 2, flexShrink: 0 }} />
                  <span>Li e aceito os <a href="#/termos" target="_blank" style={{ color: '#2563eb' }}>Termos de Uso</a> e autorizo a cobrança recorrente conforme o plano selecionado. Sei que posso cancelar a qualquer momento pela plataforma.</span>
                </label>
              )}
              <button onClick={ehMudanca ? mudarPlano : gerarLink} disabled={loading || !aceitouTermos}
                style={{ width: '100%', padding: '14px', background: plano.cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: (!aceitouTermos || loading) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (loading || !aceitouTermos) ? 0.6 : 1 }}>
                {loading
                  ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Processando...</>
                  : ehMudanca ? `Confirmar ${ehUpgrade ? 'upgrade' : 'downgrade'} →` : 'Ir para Pagamento →'}
              </button>
              <p style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 12 }}>
                Pague via PIX, boleto ou cartão de crédito · Cancele quando quiser
              </p>
            </>
          )}

          <button onClick={() => nav('/')} style={{ marginTop: 16, width: '100%', background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
            Voltar para o início
          </button>
        </div>

        <style>{`
          @keyframes spin { to { transform: rotate(360deg); } }
          @media (max-width: 760px) { .checkout-grid { grid-template-columns: 1fr !important; } }
        `}</style>
      </div>
    </div>
  );
}
