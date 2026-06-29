import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Check, ArrowRight, ArrowLeft, ShieldCheck, Star } from 'lucide-react';
import { PLANOS as PLANOS_STATIC } from '../data/cursos';
import { useAuth } from '../contexts/AuthContext';
import { fetchPlanosComConfig } from '../utils/planosConfig';

// Conteúdo de venda por plano (apresentação + benefícios). Preços vêm do config.
const CONTEUDO = {
  explorador: {
    nome: 'Explorador',
    cor: '#0D63DB',
    chamada: 'Comece a explorar leilões sem pagar nada',
    porque: 'É o ponto de partida ideal: veja todos os leilões do Brasil, calcule a viabilidade da arrematação e aprenda com os cursos — tudo gratuito, sem cartão. Quando quiser uma análise mais profunda (documental e jurídica) e o Bid Score completo, você faz o upgrade.',
    beneficios: [
      'Busca de leilões em todo o Brasil',
      'Relatório Mercadológico + Viabilidade Financeira',
      'Calculadora de Arrematação',
      'Cursos e materiais gratuitos',
      'Acesso ao site do leiloeiro',
    ],
  },
  top2: {
    nome: 'Investidor Pro',
    cor: '#0D63DB',
    destaque: true,
    chamada: 'Transforme análise em decisão segura',
    porque: 'O plano para quem leva leilão a sério. A IA lê edital e matrícula, mapeia riscos jurídicos, calcula a viabilidade e entrega o Bid Score da operação — para você dar o lance certo, no valor certo, sem surpresas depois. Em minutos você tem o que levaria dias para reunir manualmente.',
    beneficios: [
      'Tudo do Explorador',
      'Relatório Documental e Jurídico por IA',
      'Bid Score completo da operação',
      'Análise de edital, matrícula e processo',
      'Comparativos de mercado (condomínio/rua)',
      'Projeções financeiras SAC e Price',
      'Yield de locação mensal e anual',
      'Alertas de risco (penhora, ônus reais)',
    ],
  },
};

export default function PlanoDetalhe() {
  const nav = useNavigate();
  const { key } = useParams();
  const { user } = useAuth();
  const [PLANOS, setPLANOS] = useState(PLANOS_STATIC);
  const [periodo, setPeriodo] = useState('mensal');
  const [aceito, setAceito] = useState(false);

  useEffect(() => { fetchPlanosComConfig().then(setPLANOS); }, []);
  useEffect(() => { setAceito(false); }, [periodo]);

  const info = CONTEUDO[key];
  const plano = PLANOS[key];
  const fmtR = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  if (!info) {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center', padding: 20 }}>
        <p style={{ color: '#64748b' }}>Plano não encontrado.</p>
        <button onClick={() => nav('/planos')} style={{ marginTop: 16, padding: '10px 20px', border: '1px solid #e2e8f0', borderRadius: 10, background: 'white', cursor: 'pointer' }}>Ver planos</button>
      </div>
    );
  }

  const gratis = plano?.preco === 0 || key === 'explorador';
  const precoMes = Number(plano?.preco) || 49.90;
  const precoAno = Number(plano?.precoAnual) || 449.90;
  const mesNoAnual = precoAno / 12;
  const economiaPct = precoMes ? (1 - precoAno / (precoMes * 12)) * 100 : 25;
  const economiaPctLabel = Number(economiaPct).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const temAnual = !gratis && precoAno > 0;
  const numRelatorios = 15;

  // Termo de aceite específico do plano (e do período, no Pro)
  let termo;
  if (gratis) {
    termo = 'Ao criar sua conta gratuita, você concorda com os Termos de Uso e a Política de Privacidade da Bid Pro Brasil. O plano Explorador é gratuito, sem cobrança e sem necessidade de cartão de crédito. Recursos pagos (relatório documental e jurídico, Bid Score completo) exigem a contratação de um plano pago.';
  } else if (periodo === 'anual') {
    termo = `Você está contratando o plano ${info.nome} (anual) por ${fmtR(precoAno)}, cobrado uma única vez (equivalente a ${fmtR(mesNoAnual)}/mês, ${economiaPctLabel}% de desconto), com acesso por 12 meses. A renovação é automática ao fim do período; você pode cancelá-la a qualquer momento — sem novas cobranças e sem estorno do período já contratado, mantendo o acesso até o fim dos 12 meses. Inclui até ${numRelatorios} relatórios de cada tipo por mês. Você concorda com os Termos de Uso e a Política de Privacidade.`;
  } else {
    termo = `Você está contratando o plano ${info.nome} (mensal) por ${fmtR(precoMes)}/mês, em assinatura recorrente sem fidelidade. Você pode cancelar quando quiser, sem multa; o acesso permanece até o fim do ciclo já pago. Inclui até ${numRelatorios} relatórios de cada tipo por mês. Você concorda com os Termos de Uso e a Política de Privacidade.`;
  }

  const assinar = () => {
    if (gratis) { nav(user ? '/membros' : '/login'); return; }
    if (!aceito) return;
    const aKey = periodo === 'anual' ? `${key}_anual` : key;
    nav(user ? `/checkout?plano=${aKey}` : `/login?next=${encodeURIComponent(`/checkout?plano=${aKey}`)}`);
  };

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', padding: '32px 20px 80px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <button onClick={() => nav('/planos')} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#64748b', fontSize: 14, cursor: 'pointer', marginBottom: 20, padding: 0 }}>
          <ArrowLeft size={16} /> Voltar aos planos
        </button>

        {/* Hero do plano */}
        <div style={{ background: info.destaque ? 'linear-gradient(145deg, #084BA6 0%, #0a3d8f 100%)' : 'white', borderRadius: 22, padding: '36px 32px', color: info.destaque ? 'white' : '#111', boxShadow: '0 8px 32px rgba(0,0,0,0.10)', position: 'relative', overflow: 'hidden' }}>
          {info.destaque && <div style={{ position: 'absolute', top: 20, right: 20, background: '#fbbf24', color: '#78350f', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}><Star size={9} fill="#78350f" /> Mais popular</div>}
          <div style={{ fontSize: 12, fontWeight: 800, color: info.destaque ? '#93c5fd' : info.cor, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>{info.nome}</div>
          <h1 style={{ fontSize: 'clamp(24px,4vw,34px)', fontWeight: 900, margin: '0 0 14px', lineHeight: 1.15 }}>{info.chamada}</h1>

          {/* Toggle mensal/anual (só Pro) */}
          {temAnual && (
            <div style={{ display: 'inline-flex', gap: 4, background: 'rgba(255,255,255,0.12)', borderRadius: 12, padding: 4, marginBottom: 18 }}>
              {[['mensal', 'Mensal', null], ['anual', 'Anual', `-${economiaPctLabel}%`]].map(([k, label, badge]) => (
                <button key={k} onClick={() => setPeriodo(k)}
                  style={{ padding: '8px 20px', borderRadius: 9, border: 'none', fontWeight: 700, fontSize: 13, cursor: 'pointer', background: periodo === k ? 'white' : 'transparent', color: periodo === k ? '#084BA6' : '#cbd5e1', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {label}
                  {badge && <span style={{ background: periodo === k ? '#dcfce7' : 'rgba(255,255,255,0.2)', color: periodo === k ? '#16a34a' : 'white', fontSize: 10, fontWeight: 800, padding: '2px 7px', borderRadius: 10 }}>{badge}</span>}
                </button>
              ))}
            </div>
          )}

          {/* Preço */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <div style={{ fontSize: 44, fontWeight: 900 }}>{gratis ? 'Grátis' : (periodo === 'anual' ? fmtR(mesNoAnual) : fmtR(precoMes))}</div>
            {!gratis && <div style={{ fontSize: 14, color: info.destaque ? '#93c5fd' : '#64748b' }}>/mês</div>}
          </div>
          {gratis
            ? <div style={{ fontSize: 13, color: info.destaque ? '#93c5fd' : '#94a3b8', marginTop: 4 }}>Sem cartão de crédito</div>
            : periodo === 'anual'
              ? <div style={{ fontSize: 13, color: '#86efac', fontWeight: 700, marginTop: 6 }}>{fmtR(precoAno)}/ano · economize {fmtR(precoMes * 12 - precoAno)}</div>
              : <div style={{ fontSize: 13, color: info.destaque ? '#7dd3fc' : '#64748b', marginTop: 6 }}>ou {fmtR(mesNoAnual)}/mês no plano anual (−{economiaPctLabel}%)</div>}
        </div>

        {/* Por que assinar */}
        <div style={{ background: 'white', borderRadius: 18, padding: '28px 28px', marginTop: 20, border: '1px solid #e2e8f0' }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#111', margin: '0 0 10px' }}>Por que escolher o {info.nome}?</h2>
          <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.8, margin: '0 0 22px' }}>{info.porque}</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 12 }}>
            {info.beneficios.map(b => (
              <div key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}><Check size={10} color="#16a34a" strokeWidth={3} /></div>
                <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.5 }}>{b}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Termo de aceite */}
        <div style={{ background: 'white', borderRadius: 18, padding: '24px 28px', marginTop: 20, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <ShieldCheck size={18} color={info.cor} />
            <h3 style={{ fontSize: 15, fontWeight: 800, color: '#111', margin: 0 }}>Termo de aceite</h3>
          </div>
          <p style={{ fontSize: 13, color: '#64748b', lineHeight: 1.75, margin: '0 0 16px', background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 12, padding: '14px 16px' }}>{termo}</p>
          {!gratis && (
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13, color: '#334155' }}>
              <input type="checkbox" checked={aceito} onChange={e => setAceito(e.target.checked)} style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer' }} />
              <span>Li e aceito o termo de aceite, os <a href="/#/termos" target="_blank" rel="noreferrer" style={{ color: info.cor, fontWeight: 600 }}>Termos de Uso</a> e a <a href="/#/privacidade" target="_blank" rel="noreferrer" style={{ color: info.cor, fontWeight: 600 }}>Política de Privacidade</a>.</span>
            </label>
          )}
        </div>

        {/* CTA */}
        <button onClick={assinar} disabled={!gratis && !aceito}
          style={{ width: '100%', marginTop: 22, padding: '16px', border: 'none', borderRadius: 14, background: (!gratis && !aceito) ? '#cbd5e1' : info.cor, color: 'white', fontWeight: 800, fontSize: 16, cursor: (!gratis && !aceito) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: (!gratis && !aceito) ? 'none' : '0 8px 28px rgba(13,99,219,0.35)' }}>
          {gratis ? 'Começar grátis' : `Assinar ${info.nome}${periodo === 'anual' ? ' (anual)' : ''}`} <ArrowRight size={18} />
        </button>
        {!gratis && !aceito && <p style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 10 }}>Aceite o termo para continuar.</p>}
      </div>
    </div>
  );
}
