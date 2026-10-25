import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Check, Shield, Zap, Users, ChevronDown, ChevronUp, Star, ArrowRight, Share2 } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { PLANOS as PLANOS_STATIC } from '../data/cursos';
import { acessoAssessoria } from '../lib/assessoria-acesso';
import { useAuth } from '../contexts/AuthContext';
import { fetchPlanosComConfig } from '../utils/planosConfig';
import { usePlanos } from '../contexts/PlanosContext';
import { salvarRef } from '../utils/ref';
import { registrarEvento } from '../utils/tracker';

// FAQs montados com os valores reais do planos_config (evita valores fixos
// divergentes). Os labels de preço chegam já formatados.
// Clube e Assessoria só para quem tem conta (o visitante não vê esses planos — a pergunta ficaria sem
// contexto); o visitante recebe "Como contrato a assessoria?" (24/10, reorganização da tela).
const buildFAQS = ({ precoMesLabel, mesAnualLabel, anoLabel, economiaPctLabel, logado }) => [
  { q: 'Posso cancelar o plano a qualquer momento?', r: 'Sim. No plano mensal (sem fidelidade), cancele quando quiser, sem multa. No plano anual, você cancela a renovação automática a qualquer momento, sem novas cobranças e sem estorno do período já contratado, mantendo o acesso até o fim dos 12 meses.' },
  { q: 'O que o plano Leilão de Veículos libera?', r: 'A busca de veículos com FIPE é aberta. O plano mostra o leiloeiro de cada veículo, o link do lote, os documentos e o endereço do pátio, e inclui 10 relatórios por IA de veículos por mês (condição, FIPE e teto de lance).' },
  { q: 'Vale a pena o Combo?', r: 'Se você acompanha imóveis e veículos, sim: o Combo junta o Investidor Pro e o Leilão de Veículos numa assinatura só, por menos do que os dois separados.' },
  ...(logado ? [
    { q: 'O plano Assessoria cobre quantas arrematações?', r: 'Uma arrematação por contrato. O assessorado tem até 12 meses para realizar a arrematação, buscando oportunidades e também recebendo indicações da nossa equipe, com acompanhamento completo do início até a imissão de posse.' },
    // (FAQ de honorários removido da tela comercial — detalhes ficam no checkout/contrato)
    { q: 'O Leilão Club inclui arrematações ilimitadas?', r: 'Sim. Com o Clube você tem acesso a assessoria contínua para todas as arrematações durante a vigência do plano.' },
  ] : [
    { q: 'Como contrato a assessoria?', r: 'A assessoria é contratada por arrematação, dentro da plataforma: crie sua conta grátis para ver valores e condições. Enquanto ela estiver ativa, você tem tudo do Combo — Investidor Pro e Leilão de Veículos —, sem mensalidade.' },
  ]),
  { q: 'Posso pagar parcelado no cartão?', r: 'Sim. Aceitamos crédito, débito e PIX. Parcelamento em até 12× disponível, a partir da 4ª parcela os juros são assumidos pelo cliente conforme a operadora.' },
  { q: 'O que é o relatório de viabilidade?', r: 'Nossa IA analisa edital, matrícula e documentos do imóvel e gera um relatório completo com análise mercadológica, financeira e jurídica em menos de 5 minutos.' },
  // Só entra com os valores LIDOS do planos_config (25/10): sem eles, a pergunta sai da lista em vez de
  // responder com número inventado.
  ...(precoMesLabel && mesAnualLabel && anoLabel ? [
    { q: 'Qual a diferença entre pagar mensal e anual?', r: `No plano anual você economiza ${economiaPctLabel}, paga o equivalente a ${mesAnualLabel}/mês (${anoLabel} cobrados uma única vez) em vez de ${precoMesLabel}/mês no mensal.` },
  ] : []),
];

export default function Planos() {
  const nav = useNavigate();
  const { user, role, effectiveUserId } = useAuth();
  // 02/09 — POR QUE O PREÇO NÃO CHEGAVA AQUI DEPOIS DE MUDAR NO /admin.
  // Esta tela buscava o planos_config UMA vez, no mount (deps []). Quem deixa a página
  // aberta numa aba, muda o preço no admin em outra e volta, não remonta nada: a tela
  // segue exibindo o valor que leu na primeira vez, sem erro e sem sinal — só um F5
  // resolvia. O PlanosContext já sabe disso: ele re-busca a cada navegação de rota e
  // quando a aba volta a ficar visível, e o admin invalida o cache dele ao salvar.
  // O fetch local fica como REDE (primeiro paint e rota aberta direto), e o contexto
  // manda quando chega.
  const planosCtx = usePlanos();
  const [PLANOS, setPLANOS] = useState(PLANOS_STATIC);
  useEffect(() => { if (planosCtx) setPLANOS(planosCtx); }, [planosCtx]);
  const [faqAberto, setFaqAberto] = useState(null);
  const [periodo, setPeriodo] = useState('mensal');
  const [dv, setDv] = useState({ open: false, nome: '', email: user?.email || '', tel: '', msg: '', enviando: false, ok: false, erro: '' });
  const [searchParams] = useSearchParams();
  const [souParceiro, setSouParceiro] = useState(false);   // parceiro_aceite_em preenchido
  const [meuCodigo, setMeuCodigo] = useState('');           // codigo_indicacao curto p/ o link de venda
  const [copiadoKey, setCopiadoKey] = useState(null);       // feedback do "Compartilhar" por plano
  const [proAberto, setProAberto] = useState(false);        // "ver tudo o que inclui" do Investidor Pro
  // Página de venda: o banner "Instalar app" (PwaInstall) só aparece depois que a pessoa rola.
  useEffect(() => {
    window.__tsnLanding = true; window.dispatchEvent(new Event('tsn:landing'));
    return () => { window.__tsnLanding = false; window.dispatchEvent(new Event('tsn:landing')); };
  }, []);

  const enviarDuvida = async () => {
    setDv(d => ({ ...d, enviando: true, erro: '' }));
    try {
      const r = await fetch('/api/duvida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: dv.nome, email: dv.email, telefone: dv.tel, mensagem: dv.msg, origem: 'duvida_planos' }),
      });
      const d = await r.json().catch(() => ({}));  // 500 com corpo HTML não vira "Unexpected token <"
      if (!r.ok) throw new Error(d.error || 'Erro ao enviar');
      setDv(s => ({ ...s, enviando: false, ok: true }));
    } catch (e) {
      setDv(s => ({ ...s, enviando: false, erro: e.message }));
    }
  };

  useEffect(() => { fetchPlanosComConfig().then(setPLANOS); }, []);

  // Captura a INDICAÇÃO do link de venda do parceiro (?ref=CODE) e a persiste — antes
  // Planos NÃO capturava, então o ref se perdia ao ir p/ o checkout/cadastro e o parceiro
  // não recebia o crédito. O cadastro (AuthContext) consome tsn_ref_codigo no signup.
  useEffect(() => {
    const ref = searchParams.get('ref');
    if (ref) salvarRef(ref); // persiste com janela de 30 dias
  }, [searchParams]);

  // Deep-link do plano que o parceiro compartilhou (?plano=KEY): rola até o card.
  useEffect(() => {
    const alvo = searchParams.get('plano');
    if (!alvo) return;
    const t = setTimeout(() => {
      const el = document.getElementById(`plano-${alvo.replace('_anual', '')}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.style.transition = 'box-shadow .3s'; el.style.boxShadow = '0 0 0 3px #0D63DB';
        setTimeout(() => { el.style.boxShadow = ''; }, 2200);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [searchParams, PLANOS]);

  // Só parceiros (parceiro_aceite_em) veem o botão "Compartilhar"; carrega o código curto
  // do link de venda (gera se ainda não existir, como faz a tela Minha Rede).
  useEffect(() => {
    if (!user?.id) { setSouParceiro(false); return; }
    let vivo = true;
    (async () => {
      try {
        // Suporte: código de indicação do usuário VISTO; não gera código como admin.
        const alvoId = effectiveUserId || user.id;
        const suporte = alvoId !== user.id;
        const { data: p } = await supabase.from('perfis').select('parceiro_aceite_em, codigo_indicacao').eq('id', alvoId).maybeSingle();
        if (!vivo) return;
        setSouParceiro(!!p?.parceiro_aceite_em);
        let cod = p?.codigo_indicacao;
        if (!cod && p?.parceiro_aceite_em && !suporte) {
          try { await supabase.rpc('gerar_codigo_indicacao', { p_id: user.id }); const { data: p2 } = await supabase.from('perfis').select('codigo_indicacao').eq('id', user.id).maybeSingle(); cod = p2?.codigo_indicacao; } catch { /* fallback no uid */ }
        }
        if (vivo && cod) setMeuCodigo(cod);
      } catch { /* mantém não-parceiro */ }
    })();
    return () => { vivo = false; };
  }, [user?.id, effectiveUserId]);

  // Compartilha o link de venda do plano (leva a indicação do parceiro).
  // Aponta para a TELA ESPECÍFICA do plano (/checkout?plano=KEY) — igual aos ebooks/cursos,
  // que abrem a página do produto. Antes abria a LISTA de planos (/planos?plano=KEY), que só
  // rolava até o card; o cliente caía na tela genérica, não na do produto comercializado.
  // O /checkout é público: apresenta o plano e faz o cadastro/pagamento inline para quem
  // ainda não tem conta (visitante que recebeu o link do parceiro), preservando o ?ref=.
  const compartilharPlano = (key) => {
    const cod = meuCodigo || user?.id || '';
    const url = `${window.location.origin}/#/checkout?plano=${key}${cod ? `&ref=${cod}` : ''}`;
    // COPIA o link DIRETO (pedido do dono: sem abrir a folha de compartilhamento do sistema).
    (async () => {
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
        else { const ta = document.createElement('textarea'); ta.value = url; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); }
      } catch { window.prompt('Copie o link:', url); }
    })();
    setCopiadoKey(key); setTimeout(() => setCopiadoKey(k => (k === key ? null : k)), 2000);
  };

  // Formata um valor; usado para totais/economias derivados do planos_config.
  const fmtR = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Preço de um plano vindo do banco, com fallback ao label estático.
  const pLabel = (key, field, fallback) => PLANOS[key]?.[field] ?? fallback;
  const ativoPlano = (key) => PLANOS[key]?.ativo !== false; // mostra durante o load (undefined)

  // Valores reais do Investidor Pro (planos_config) para o FAQ
  // 25/10 (arena pré-login): os fallbacks `|| 49.90` e `|| 899` eram valores VELHOS — se o planos_config não
  // carregasse, o FAQ prometia R$ 49,90 e o checkout cobrava R$ 89,90. Valor não lido = nenhum preço.
  const _precoMes = Number(PLANOS.top2?.preco) > 0 ? Number(PLANOS.top2.preco) : null;
  const _precoAno = Number(PLANOS.top2?.precoAnual) > 0 ? Number(PLANOS.top2.precoAnual) : null;
  const _economiaPct = _precoMes && _precoAno ? (1 - _precoAno / (_precoMes * 12)) * 100 : 0;
  const FAQS = buildFAQS({
    precoMesLabel: _precoMes ? fmtR(_precoMes) : null,
    mesAnualLabel: _precoAno ? fmtR(_precoAno / 12) : null,
    anoLabel: _precoAno ? fmtR(_precoAno) : null,
    economiaPctLabel: `${Number(_economiaPct).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
    logado: !!user,
  });

  // 25/10 (arena pré-login, passo 1) — O CLIQUE DE COMPRA ABRIA A TELA ERRADA. O visitante sem conta ia para
  // `/login?next=/checkout?plano=X`, sem modo=cadastro e sem plano=: caía em "Entrar · Acesse sua conta", com
  // campo de senha e sem o aviso do plano escolhido. E o next levava só `plano=key` — o `ciclo=anual` ficava
  // em `params` e se perdia: quem escolheu R$ 74,92/mês no anual chegava ao checkout no mensal de R$ 89,90.
  // Agora o visitante vai ao CADASTRO com o plano e o next leva os MESMOS params do logado (ciclo incluso).
  // O lp_cta sai ANTES de navegar (a fila do tracker sobrevive à troca de rota — é SPA).
  const urlCompra = (params) => {
    const plano = params.get('plano');
    return user ? `/checkout?${params}`
      : `/login?modo=cadastro&plano=${encodeURIComponent(plano)}&next=${encodeURIComponent(`/checkout?${params}`)}`;
  };
  const ir = (key) => {
    const plano = PLANOS[key];
    if (!plano) return;
    registrarEvento('lp_cta', { alvo: `planos_${key}_${periodo}${user ? '' : '_anon'}` });
    if (plano.preco === 0) { nav(user ? '/membros' : '/login?modo=cadastro&plano=explorador'); return; }
    const params = new URLSearchParams({ plano: key });
    if (periodo === 'anual' && Number(plano.precoAnual) > 0) params.set('ciclo', 'anual'); // abre o checkout no anual
    nav(urlCompra(params));
  };

  const irAnual = (key) => {
    const aKey = `${key}_anual`;
    registrarEvento('lp_cta', { alvo: `planos_${aKey}${user ? '' : '_anon'}` });
    nav(urlCompra(new URLSearchParams({ plano: aKey })));
  };

  const atual = (key) => user && (key === role || `${key}_anual` === role);
  // Assessoria inclui o Combo (23/10, regra_negocio['assessoria.inclui_combo']): Veículos e Combo já são dele.
  const assessoriaIncluiCombo = !!user && /^assessorado/.test(String(role || ''));

  // Posição do plano na escada (p/ rotular a CTA como atual/upgrade/downgrade quando logado).
  const RANK = { explorador: 0, top2: 1, top2_anual: 1, assessorado: 2, assessorado_anual: 2, clube: 3, clube_anual: 3 };
  const meuRank = user ? (RANK[role] ?? -1) : -1; // -1 = visitante ou papel sem plano de cliente (equipe)
  // Retorna 'atual' | 'downgrade' | 'contratar' para o card `key`.
  const ctaTipo = (key) => {
    if (atual(key)) return 'atual';
    if (meuRank >= 0 && RANK[key] < meuRank) return 'downgrade';
    return 'contratar';
  };
  // Downgrade/cancelamento é gerido em Meu Perfil › Assinatura (não refaz cobrança aqui).
  const irDowngrade = () => nav('/perfil?aba=assinatura');

  const CheckItem = ({ txt, light, off }) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, opacity: off ? 0.65 : 1 }}>
      <div style={{ width: 18, height: 18, borderRadius: '50%', background: off ? '#f1f5f9' : light ? 'rgba(134,239,172,0.2)' : '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
        {off ? <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 800, lineHeight: 1 }}>×</span> : <Check size={10} color={light ? '#86efac' : '#16a34a'} strokeWidth={3} />}
      </div>
      <span style={{ fontSize: 13, color: off ? '#94a3b8' : light ? '#e0f2fe' : '#334155', lineHeight: 1.55 }}>{txt}</span>
    </div>
  );

  // Cabeçalho de grupo dentro do card do Investidor Pro — quebra o checklist único em blocos
  // temáticos (autoridade: cada bloco nomeia uma COMPETÊNCIA, não só empilha frase solta).
  const GroupLabel = ({ txt }) => (
    <div style={{ fontSize: 10.5, fontWeight: 800, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: 1, marginTop: 6 }}>{txt}</div>
  );

  // Cabeçalho dos 3 cards lado a lado (21/10, dono: "alinhamento, fontes"): MESMA altura e MESMO tamanho de
  // preço, sem quebrar linha — o card mais estreito partia "R$ 29,90" em duas e as listas começavam desalinhadas.
  // Desconto REAL do anual de cada plano (o texto dizia "-25%" fixo; 899 sobre 12 × 89,90 é 17%).
  const descAnual = (k) => { const p = PLANOS[k]; return p?.preco > 0 && p?.precoAnual > 0 ? Math.round((1 - p.precoAnual / (p.preco * 12)) * 100) : 0; };
  const mesesGratis = (k) => { const p = PLANOS[k]; return p?.preco > 0 && p?.precoAnual > 0 ? Math.round(12 - p.precoAnual / p.preco) : 0; };
  const PRECO_TOPO = { fontSize: 'clamp(34px, 3.4vw, 46px)', fontWeight: 900, lineHeight: 1.05, whiteSpace: 'nowrap', letterSpacing: '-0.5px' };
  const CABECALHO = { minHeight: 108, marginBottom: 12 };

  // Preço comercial: a PARCELA em DESTAQUE (visão de acessibilidade — mais
  // comercial) e o valor à vista com o % OFF em texto secundário. `mensal` mostra
  // a parcela como /mês (Leilão Club); senão como 12× (Assessoria). Sem juros até 3×.
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
    const parcela = fmtR(cheio / 12);
    const destaque = mensal ? parcela : `12× ${parcela}`;
    const linhaMeio = mensal
      ? `total ${cheioLabel} em 12× no cartão ou PIX`
      : `em até 12× no cartão · sem juros até 3×`;
    const linhaVista = `ou ${vistaLabel} à vista no PIX${economia ? ` · economize ${fmtR(economia)}` : ''}`;
    return (
      <div style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 42, fontWeight: 900, color: corPrim, lineHeight: 1.05 }}>{destaque}</div>
          {mensal && <div style={{ fontSize: 16, fontWeight: 800, color: corSec }}>/mês</div>}
          {desc > 0 && <span style={{ background: badgeBg, color: badgeFg, fontSize: 12, fontWeight: 800, padding: '3px 10px', borderRadius: 20 }}>{desc.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}% OFF à vista</span>}
        </div>
        <div style={{ fontSize: 13, color: corSec, marginTop: 5, fontWeight: 600 }}>{linhaMeio}</div>
        <div style={{ fontSize: 12, color: corDis, marginTop: 7 }}>{linhaVista}</div>
      </div>
    );
  };

  // Botão "Compartilhar este plano" — só aparece para PARCEIROS. Gera o link de venda
  // do plano com a indicação embutida (?ref=...&plano=...).
  const BotaoCompartilhar = ({ planoKey, dark }) => {
    if (!souParceiro) return null;
    const copiado = copiadoKey === planoKey;
    return (
      <button onClick={() => compartilharPlano(planoKey)}
        style={{ width: '100%', marginTop: 10, padding: '10px', border: dark ? '1px solid rgba(255,255,255,0.35)' : '1px solid #cbd5e1', borderRadius: 10, background: 'transparent', color: dark ? '#e0f2fe' : '#334155', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {copiado ? <><Check size={14} /> Link copiado</> : <><Share2 size={14} /> Compartilhar / Vender</>}
      </button>
    );
  };

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh' }}>

      {/* ── Hero ── */}
      {/* Topo COMPACTO (24/10): metade da altura de antes, com o Mensal/Anual dentro — os planos aparecem
          já na primeira tela. */}
      <div style={{ background: 'linear-gradient(135deg, #080f1a 0%, #0d2a50 100%)', padding: '48px 20px 40px', textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 20% 80%, rgba(13,99,219,0.2) 0%, transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(99,102,241,0.12) 0%, transparent 50%)' }} />
        <div style={{ position: 'relative' }}>
          <h1 style={{ fontSize: 'clamp(26px,4.2vw,42px)', fontWeight: 900, color: 'white', margin: '0 0 10px', lineHeight: 1.1, letterSpacing: '-1px' }}>
            Escolha o plano para <span style={{ color: '#60a5fa' }}>arrematar com segurança</span>
          </h1>
          <p style={{ color: '#94a3b8', fontSize: 'clamp(14px,1.8vw,16px)', maxWidth: 560, margin: '0 auto 18px', lineHeight: 1.6 }}>
            Comece grátis. Assine quando quiser os relatórios completos de imóveis, de veículos ou dos dois.
          </p>
          <div style={{ display: 'flex', gap: 22, justifyContent: 'center', flexWrap: 'wrap', marginBottom: PLANOS.top2?.precoAnual > 0 ? 22 : 0 }}>
            {[{ icon: Shield, txt: 'Análise jurídica incluída' }, { icon: Zap, txt: 'Relatório em menos de 5 min' }, { icon: Users, txt: '+8 anos no mercado' }].map(({ icon: Icon, txt }) => (
              <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#94a3b8', fontSize: 13 }}>
                <Icon size={14} color="#60a5fa" /> {txt}
              </div>
            ))}
          </div>
        {/* Mensal | Anual (21/10, dono: "o anual disponível para todos os planos com o mesmo % de desconto"). */}
          {PLANOS.top2?.precoAnual > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', margin: 0 }}>
              <div role="group" aria-label="Ciclo de cobrança" style={{ display: 'flex', gap: 4, padding: 4, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 14 }}>
                {[['mensal', 'Mensal'], ['anual', `Anual${mesesGratis('top2') > 0 ? ` · ${mesesGratis('top2')} meses grátis` : ''}`]].map(([k, rot]) => (
                  <button key={k} onClick={() => setPeriodo(k)} aria-pressed={periodo === k}
                    style={{ padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', fontWeight: 800, fontSize: 13.5, background: periodo === k ? 'white' : 'transparent', color: periodo === k ? '#084BA6' : '#cbd5e1' }}>
                    {rot}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px 80px' }}>

        {/* Gatilho de preço (passo 8): contagem regressiva quando há aumento AGENDADO do
            Investidor Pro. Converte antes da virada ("assine agora e trave o preço"). */}
        {(() => {
          const p = PLANOS.top2;
          const venc = p?.precoVigencia ? new Date(p.precoVigencia) : null;
          if (!p?.precoAgendado || !venc || isNaN(venc.getTime()) || venc <= new Date()) return null;
          const dataFmt = venc.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
          return (
            <div style={{ maxWidth: 920, margin: '0 auto 20px', background: 'linear-gradient(135deg,#fef3c7,#fde68a)', border: '1px solid #f59e0b', borderRadius: 14, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 22 }}>⏳</span>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 14.5, fontWeight: 800, color: '#92400e' }}>
                  O Investidor Pro passa de {fmtR(p.preco)} para {p.precoAgendadoLabel}/mês em {dataFmt}.
                </div>
                <div style={{ fontSize: 12.5, color: '#b45309', marginTop: 2 }}>
                  Assine agora e <strong>trave {fmtR(p.preco)}/mês</strong> enquanto sua assinatura ficar ativa. No plano anual, você garante o preço por 12 meses.
                </div>
              </div>
            </div>
          );
        })()}


        {/* ── 3 planos lado a lado (21/10, dono): Explorador · Investidor Pro · Leilão de Veículos. O Combo é
            oferecido ao abrir o link de qualquer um (components/OfertaCombo.jsx, no Checkout) e na faixa abaixo. ── */}
        <div className="grid-3 grid-planos" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1fr)', gap: 20, maxWidth: 1100, margin: '0 auto 28px', alignItems: 'stretch' }}>

          {/* Explorador */}
          <div id="plano-explorador" style={{ background: 'white', borderRadius: 20, border: atual('explorador') ? '2px solid #0D63DB' : '1px solid #e2e8f0', padding: '32px 28px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
            <div style={{ display: 'inline-block', alignSelf: 'flex-start', background: '#eef2ff', color: '#1e293b', fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, padding: '5px 12px', borderRadius: 8, marginBottom: 12 }}>Explorador</div>
            <div style={CABECALHO}>
              <div style={{ ...PRECO_TOPO, color: '#111', marginBottom: 6 }}>Grátis</div>
              <div style={{ fontSize: 12.5, color: '#94a3b8' }}>Sem cartão de crédito</div>
            </div>
            <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.7 }}>
              Explore leilões em todo o Brasil, acesse cursos e use a calculadora de arrematação sem pagar nada.
            </p>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
              {['Busca de leilões em todo o Brasil', '3 relatórios mercadológicos e viabilidade financeira de amostra (uso único, não renovam)', 'Calculadora de Arrematação', 'Cursos e materiais gratuitos'].map(t => <CheckItem key={t} txt={t} />)}
              <CheckItem txt="Quem é o leiloeiro e acesso ao lote (Investidor Pro)" off />
              <CheckItem txt="Análise Documental e Jurídica (Investidor Pro)" off />
            </div>
            <button onClick={() => ctaTipo('explorador') === 'downgrade' ? irDowngrade()
              : user ? nav('/checkout?plano=explorador')
              : (registrarEvento('lp_cta', { alvo: 'planos_explorador_anon' }), nav('/login?modo=cadastro&plano=explorador'))} disabled={atual('explorador')}
              style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('explorador') ? '#f1f5f9' : '#111', color: atual('explorador') ? '#94a3b8' : 'white', fontWeight: 800, fontSize: 15, cursor: atual('explorador') ? 'default' : 'pointer' }}>
              {atual('explorador') ? 'Seu plano atual' : ctaTipo('explorador') === 'downgrade' ? 'Fazer downgrade' : 'Começar grátis →'}
            </button>
            <BotaoCompartilhar planoKey="explorador" />
          </div>

          {/* Investidor Pro */}
          <div id="plano-top2" className="card-pro" style={{ background: 'linear-gradient(145deg, #084BA6 0%, #0a3d8f 100%)', borderRadius: 20, border: '2px solid #3b82f6', padding: '32px 28px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: '0 12px 40px rgba(37,99,235,0.35)' }}>
            <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
            <div style={{ position: 'absolute', top: 20, right: 20, background: '#fbbf24', color: '#78350f', fontSize: 10, fontWeight: 800, padding: '4px 14px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Star size={9} fill="#78350f" /> Mais popular
            </div>
            <div style={{ display: 'inline-block', alignSelf: 'flex-start', background: 'rgba(255,255,255,0.2)', color: '#ffffff', fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, padding: '5px 12px', borderRadius: 8, marginBottom: 12 }}>Investidor Pro</div>
            <div style={CABECALHO}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <div style={{ ...PRECO_TOPO, color: 'white' }}>
                {periodo === 'anual' ? pLabel('top2', 'precoMensalAnualLabel', '') : pLabel('top2', 'precoLabel', '')}
              </div>
              <div style={{ fontSize: 14, color: '#93c5fd' }}>/mês</div>
            </div>
            {periodo === 'anual'
              ? <div style={{ fontSize: 13, color: '#86efac', fontWeight: 700, marginBottom: 8 }}>{pLabel('top2', 'precoAnualLabel', 'R$ 899,00')}/ano{PLANOS.top2?.preco && PLANOS.top2?.precoAnual ? ` · economize ${fmtR(PLANOS.top2.preco * 12 - PLANOS.top2.precoAnual)}` : ''}</div>
              : <div style={{ fontSize: 12, color: '#7dd3fc', marginBottom: 8 }}>ou {pLabel('top2', 'precoMensalAnualLabel', 'R$ 37,49')}/mês no plano anual{descAnual('top2') ? ` (-${descAnual('top2')}%)` : ''}</div>}
            <div style={{ display: 'inline-block', background: 'rgba(134,239,172,0.15)', border: '1px solid rgba(134,239,172,0.3)', color: '#86efac', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, alignSelf: 'flex-start' }}>
              {periodo === 'anual' ? 'Cancele a renovação automática quando quiser' : 'Cancele quando quiser'}
            </div>
            </div>
            <p style={{ fontSize: 14, color: '#bfdbfe', marginBottom: 24, lineHeight: 1.7 }}>
              Viabilidade por IA + análise documental e jurídica de cada imóvel, antes do lance.
            </p>
            {/* Lista CURTA (24/10): os 5 que vendem; o resto em "ver tudo" — a lista de 20 itens deixava os
                outros dois cartões com um vão branco até o botão. */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
              <CheckItem txt="Tudo do Explorador" light />
              {[
                'Quem é o leiloeiro, link do lote, edital e matrícula',
                'Relatório de viabilidade e análise documental e jurídica',
                '10 relatórios mercadológicos + 10 documentais por mês',
                'Comparativos de mercado e rentabilidade do aluguel',
                'Todos os eBooks da plataforma inclusos',
              ].map(t => <CheckItem key={t} txt={t} light />)}
              <button onClick={() => setProAberto(v => !v)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#93c5fd', fontWeight: 800, fontSize: 13, cursor: 'pointer', padding: '4px 0', display: 'flex', alignItems: 'center', gap: 4 }}>
                {proAberto ? <>Ver menos <ChevronUp size={14} /></> : <>Ver tudo o que inclui <ChevronDown size={14} /></>}
              </button>
              {proAberto && <>

              <GroupLabel txt="📑 Análise & Relatórios com IA" />
              {[
                'Quem é o leiloeiro, link do lote, edital e matrícula',
                'Relatório de viabilidade com IA',
                'Análise de edital, matrícula e processo',
                'Análise processual do imóvel',
                'Alertas de risco (penhora, ônus reais)',
              ].map(t => <CheckItem key={t} txt={t} light />)}

              <GroupLabel txt="📈 Inteligência de mercado" />
              {[
                'Comparativos de mercado (condomínio/rua)',
                'Projeções financeiras SAC e Price',
                'Rentabilidade do aluguel (mensal e anual)',
                '3 gerações de Índice de mercado/mês',
              ].map(t => <CheckItem key={t} txt={t} light />)}

              <GroupLabel txt="⚡ Volume incluso todo mês" />
              {[
                '10 relatórios mercadológicos/mês',
                '10 relatórios documentais e jurídicos/mês',
                'Relatórios adicionais por crédito, sem limite',
              ].map(t => <CheckItem key={t} txt={t} light />)}

              {/* Educação em destaque (pedido do dono, 13/09): bônus real, não é rodapé de
                  lista — ganha caixa própria pra não se perder entre os outros itens. */}
              <div style={{ marginTop: 8, padding: '12px 14px', background: 'rgba(96,165,250,0.14)', border: '1px solid rgba(96,165,250,0.32)', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ fontSize: 10.5, fontWeight: 800, color: '#bfdbfe', textTransform: 'uppercase', letterSpacing: 1 }}>🎓 Educação — bônus exclusivo</div>
                {[
                  'Todos os eBooks da plataforma inclusos, sem custo extra',
                  'Cursos gratuitos de introdução ao método',
                  'Desconto exclusivo em cursos pagos premium',
                ].map(t => <CheckItem key={t} txt={t} light />)}
              </div>
              </>}
            </div>
            <button onClick={() => ctaTipo('top2') === 'downgrade' ? irDowngrade() : ir('top2')} disabled={atual('top2')}
              style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: atual('top2') ? 'rgba(255,255,255,0.15)' : 'white', color: atual('top2') ? '#93c5fd' : '#084BA6', fontWeight: 800, fontSize: 15, cursor: atual('top2') ? 'default' : 'pointer', boxShadow: atual('top2') ? 'none' : '0 4px 16px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {atual('top2') ? 'Seu plano atual' : ctaTipo('top2') === 'downgrade' ? 'Fazer downgrade' : <><span>Assinar Investidor Pro</span> <ArrowRight size={16} /></>}
            </button>
            <BotaoCompartilhar planoKey="top2" dark />
          </div>

          {/* Leilão de Veículos */}
          {ativoPlano('veiculos') && (
            <div id="plano-veiculos" style={{ background: 'white', borderRadius: 20, border: '1px solid #99f6e4', padding: '32px 28px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 20px rgba(0,0,0,0.06)' }}>
              <div style={{ display: 'inline-block', alignSelf: 'flex-start', background: '#ccfbf1', color: '#0f766e', fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, padding: '5px 12px', borderRadius: 8, marginBottom: 12 }}>Leilão de Veículos</div>
              <div style={CABECALHO}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                  <div style={{ ...PRECO_TOPO, color: '#111' }}>{periodo === 'anual' && PLANOS.veiculos?.precoAnual ? pLabel('veiculos', 'precoMensalAnualLabel', 'R$ 24,92') : pLabel('veiculos', 'precoLabel', 'R$ 29,90')}</div>
                  <div style={{ fontSize: 14, color: '#64748b' }}>/mês</div>
                </div>
                {periodo === 'anual' && PLANOS.veiculos?.precoAnual
                  ? <div style={{ fontSize: 13, color: '#15803d', fontWeight: 700 }}>{pLabel('veiculos', 'precoAnualLabel', 'R$ 299,00')}/ano · economize {fmtR(PLANOS.veiculos.preco * 12 - PLANOS.veiculos.precoAnual)}</div>
                  : <div style={{ fontSize: 12.5, color: '#94a3b8' }}>{PLANOS.veiculos?.precoAnual ? `ou ${pLabel('veiculos', 'precoMensalAnualLabel', '')}/mês no plano anual (-${descAnual('veiculos')}%) · ` : ''}Cancele quando quiser</div>}
              </div>
              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 24, lineHeight: 1.7 }}>
                Ache o carro de graça. Com o plano, veja quem é o leiloeiro, abra o lote e gere o relatório por IA antes de dar o lance.
              </p>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 32 }}>
                {['Busca de veículos com FIPE em todo o Brasil', 'Selo com o nome do leiloeiro em cada veículo', 'Link do lote, documentos e endereço do pátio', '10 relatórios por IA de veículos/mês (condição, FIPE e teto de lance)'].map(t => <CheckItem key={t} txt={t} />)}
              </div>
              <button onClick={() => { if (!assessoriaIncluiCombo) ir('veiculos'); }} disabled={assessoriaIncluiCombo}
                style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: assessoriaIncluiCombo ? '#f1f5f9' : '#0f766e', color: assessoriaIncluiCombo ? '#94a3b8' : 'white', fontWeight: 800, fontSize: 15, cursor: assessoriaIncluiCombo ? 'default' : 'pointer' }}>
                {assessoriaIncluiCombo ? 'Incluído na sua assessoria' : 'Desbloquear veículos →'}
              </button>
              <BotaoCompartilhar planoKey="veiculos" />
            </div>
          )}
        </div>

        {/* ── Combo Imóveis + Veículos (20/10; faixa desde 21/10) ── preço e economia do planos_config. */}
        {ativoPlano('combo') && (
          <div id="plano-combo" style={{ maxWidth: 1100, margin: '0 auto 22px', background: 'linear-gradient(135deg,#4c1d95 0%,#6d28d9 100%)', border: '2px solid #8b5cf6', borderRadius: 20, padding: '22px 26px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap', boxShadow: '0 12px 32px rgba(109,40,217,0.25)' }}>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, color: '#ddd6fe' }}>Combo Imóveis + Veículos</div>
              <div style={{ fontSize: 20, fontWeight: 900, color: 'white', margin: '4px 0' }}>
                Investidor Pro + Leilão de Veículos por {periodo === 'anual' && PLANOS.combo?.precoAnual ? `${pLabel('combo', 'precoAnualLabel', 'R$ 999,00')}/ano` : `${pLabel('combo', 'precoLabel', 'R$ 99,90')}/mês`}
              </div>
              <div style={{ fontSize: 13.5, color: '#ede9fe', lineHeight: 1.6 }}>
                Relatórios de imóveis e de veículos e o leiloeiro de cada carro desbloqueado, numa assinatura só
                {PLANOS.top2?.preco && PLANOS.veiculos?.preco && PLANOS.combo?.preco && PLANOS.top2.preco + PLANOS.veiculos.preco > PLANOS.combo.preco
                  ? <> — <strong style={{ color: '#86efac' }}>economize {fmtR(PLANOS.top2.preco + PLANOS.veiculos.preco - PLANOS.combo.preco)}/mês</strong></> : null}.
                {ativoPlano('assessorado') && <> Contratando a <strong style={{ color: 'white' }}>Assessoria</strong>, o Combo vem incluído, sem mensalidade.</>}
              </div>
            </div>
            <div style={{ flex: '0 1 240px', minWidth: 0, width: '100%' }}>
              <button onClick={() => { if (!assessoriaIncluiCombo) ir('combo'); }} disabled={assessoriaIncluiCombo}
                style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: assessoriaIncluiCombo ? 'rgba(255,255,255,0.18)' : 'white', color: assessoriaIncluiCombo ? '#ede9fe' : '#5b21b6', fontWeight: 900, fontSize: 15, cursor: assessoriaIncluiCombo ? 'default' : 'pointer' }}>
                {assessoriaIncluiCombo ? 'Incluído na sua assessoria' : 'Assinar o Combo →'}
              </button>
              <BotaoCompartilhar planoKey="combo" dark />
            </div>
          </div>
        )}

        {/* ── Garantias numa faixa fina (24/10; antes eram 3 cartões grandes depois da assessoria) ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '10px 28px', maxWidth: 1100, margin: '0 auto 56px', padding: '14px 18px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14 }}>
          {[['🔒', 'Pagamento seguro: crédito, débito e PIX'], ['✅', 'Mensal sem fidelidade · no anual, cancele a renovação'], ['🤝', 'Analistas, advogados e sócio do seu lado']].map(([ic, t]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#475569', fontWeight: 600 }}><span>{ic}</span>{t}</div>
          ))}
        </div>

        {/* ── Compare os planos (24/10): substitui a lista longa para quem quer comparar lado a lado.
            Texto, não preço — o preço vive nos cartões (planos_config). Combo = Pro + Veículos. ── */}
        <div style={{ maxWidth: 1000, margin: '0 auto 64px' }}>
          <h2 style={{ fontSize: 'clamp(22px,3.4vw,30px)', fontWeight: 900, color: '#111', textAlign: 'center', margin: '0 0 20px' }}>Compare os planos</h2>
          <div style={{ overflowX: 'auto', background: 'white', border: '1px solid #e2e8f0', borderRadius: 16 }}>
            <table style={{ width: '100%', minWidth: 620, borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ background: '#f8fafc' }}>
                  {['', 'Explorador', 'Investidor Pro', 'Veículos', 'Combo'].map((h, i) => (
                    <th key={h || 'rec'} style={{ textAlign: i ? 'center' : 'left', padding: '14px 14px', fontWeight: 900, color: i === 2 ? '#084BA6' : i === 3 ? '#0f766e' : i === 4 ? '#6d28d9' : '#111', borderBottom: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  ['Busca de leilões de imóveis em todo o Brasil', '✓', '✓', '✓', '✓'],
                  ['Busca de veículos com FIPE', '✓', '✓', '✓', '✓'],
                  ['Relatório de mercado + viabilidade', '3 de amostra', '10/mês', '3 de amostra', '10/mês'],
                  ['Relatório documental e jurídico', '—', '10/mês', '—', '10/mês'],
                  ['Leiloeiro, link do lote, edital e matrícula (imóveis)', '—', '✓', '—', '✓'],
                  ['Comparativos, SAC/Price e rentabilidade do aluguel', '—', '✓', '—', '✓'],
                  ['Leiloeiro, documentos e pátio de cada veículo', '—', '—', '✓', '✓'],
                  ['Relatórios de veículos por IA', '—', '—', '10/mês', '10/mês'],
                  ['Todos os eBooks da plataforma', '—', '✓', '—', '✓'],
                  ['Calculadora e cursos gratuitos', '✓', '✓', '✓', '✓'],
                ].map(([rec, ...cols], r) => (
                  <tr key={rec} style={{ background: r % 2 ? '#fcfdff' : 'white' }}>
                    <td style={{ padding: '12px 14px', color: '#334155', fontWeight: 600, borderBottom: '1px solid #f1f5f9' }}>{rec}</td>
                    {cols.map((c, i) => (
                      <td key={i} style={{ padding: '12px 10px', textAlign: 'center', borderBottom: '1px solid #f1f5f9', color: c === '—' ? '#cbd5e1' : c === '✓' ? '#16a34a' : '#0f172a', fontWeight: c === '✓' ? 900 : 700, whiteSpace: 'nowrap' }}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {ativoPlano('assessorado') && (
            <p style={{ fontSize: 13, color: '#64748b', textAlign: 'center', margin: '12px 0 0' }}>
              A <strong style={{ color: '#c2410c' }}>Assessoria</strong> inclui tudo da coluna Combo, sem mensalidade, enquanto estiver ativa.
            </p>
          )}
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
            Para quem quer resultado com segurança total, análise, estratégia, documentação e registro feitos por especialistas.
          </p>
        </div>

        {!user ? (
          <div style={{ background: 'white', borderRadius: 20, border: '1px solid #e2e8f0', padding: '36px 32px', textAlign: 'center', maxWidth: 600, margin: '0 auto', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>🤝</div>
            <h3 style={{ fontSize: 19, fontWeight: 800, color: '#111', marginBottom: 10 }}>Também oferecemos assessoria e mentoria em leilões</h3>
            <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.7, margin: '0 0 20px' }}>
              Acompanhamento completo da análise à imissão de posse, e mentoria contínua para escalar com método. Valores e contratação ficam dentro da plataforma, para clientes — e a assessoria já inclui tudo do Combo: Investidor Pro e Leilão de Veículos, sem mensalidade.
            </p>
            {/* Regra do dono (23/10): contratar exige CONTA (não exige o Pro). Visitante vai ao cadastro e volta
                direto ao card da assessoria, que logado mostra o preço. */}
            <button onClick={() => nav(`/login?modo=cadastro&next=${encodeURIComponent('/planos?plano=assessorado')}`)}
              style={{ padding: '13px 26px', border: 'none', borderRadius: 12, background: '#d97706', color: 'white', fontWeight: 800, fontSize: 14.5, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 14px rgba(217,119,6,0.3)' }}>
              Criar conta grátis para ver valores <ArrowRight size={16} />
            </button>
          </div>
        ) : (
          <div className="grid-2" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20, maxWidth: 880, margin: '0 auto' }}>

            {/* Assessoria */}
            {ativoPlano('assessorado') && (
            <div id="plano-assessorado" style={{ background: 'white', borderRadius: 20, border: atual('assessorado') ? '2px solid #d97706' : '1px solid #fed7aa', padding: '32px 28px', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 24px rgba(217,119,6,0.08)' }}>
              <div style={{ display: 'inline-block', alignSelf: 'flex-start', background: '#fff7ed', color: '#c2410c', fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, padding: '5px 12px', borderRadius: 8, marginBottom: 12 }}>Assessoria</div>
              {/* Desde 06/10 a assessoria NÃO exige o Investidor Pro (regra_negocio['assessoria.inclui_pro']):
                  todo cliente vê o preço e contrata direto — e desde 23/10 o Combo inteiro (Pro + Veículos) vem
                  incluído enquanto ela está ativa (regra_negocio['assessoria.inclui_combo']). */}
              <PrecoComercial planoKey="assessorado" />
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>1 arrematação · pagamento único</div>
              <p style={{ fontSize: 14, color: '#64748b', marginBottom: 20, lineHeight: 1.7 }}>
                Assessoria completa para 1 arrematação, da análise do imóvel até a imissão de posse. Acesso à plataforma por 12 meses, extensível até a conclusão.
              </p>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 28 }}>
                {['Tudo do Combo incluído: Investidor Pro + Leilão de Veículos (sem mensalidade)', 'Análise jurídica e estratégia de lance', 'Acompanhamento até a imissão de posse', 'Suporte com documentação pós-arrematação', 'Registro do imóvel via plataforma (ONR)', '12 meses de acesso · extensível até a posse'].map(t => <CheckItem key={t} txt={t} />)}
              </div>
              {/* Assessoria é POR ARREMATAÇÃO (regra do dono): quem já é assessorado pode
                  contratar a PRÓXIMA operação — o Checkout valida se a atual já teve o
                  arremate sinalizado. Leilão Club não contrata avulsa (já tem ilimitada). */}
              {(() => {
                const acesso = acessoAssessoria(role);
                const ehClube = acesso === 'incluido';
                const jaAssessorado = atual('assessorado');
                return (
                  <button onClick={() => { if (!ehClube) ir('assessorado'); }} disabled={ehClube}
                    style={{ width: '100%', padding: '14px', border: 'none', borderRadius: 12, background: ehClube ? '#f1f5f9' : '#d97706', color: ehClube ? '#94a3b8' : 'white', fontWeight: 800, fontSize: 15, cursor: ehClube ? 'default' : 'pointer', boxShadow: ehClube ? 'none' : '0 4px 14px rgba(217,119,6,0.35)' }}>
                    {ehClube ? 'Incluído no seu plano'
                      : jaAssessorado ? 'Contratar nova arrematação →' : 'Contratar assessoria →'}
                  </button>
                );
              })()}
              <BotaoCompartilhar planoKey="assessorado" />
            </div>
            )}

            {/* Leilão Club */}
            {ativoPlano('clube') && (
            <div id="plano-clube" style={{ background: 'linear-gradient(145deg, #0f172a 0%, #1e1b4b 100%)', borderRadius: 20, border: '2px solid #6366f1', padding: '32px 28px', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: '0 8px 40px rgba(99,102,241,0.3)' }}>
              <div style={{ position: 'absolute', top: -30, right: -30, width: 150, height: 150, borderRadius: '50%', background: 'rgba(99,102,241,0.08)' }} />
              <div style={{ position: 'absolute', top: 20, right: 20, background: '#4f46e5', color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Nível máximo
              </div>
              <div style={{ display: 'inline-block', alignSelf: 'flex-start', background: 'rgba(255,255,255,0.16)', color: '#ffffff', fontSize: 12.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1.2, padding: '5px 12px', borderRadius: 8, marginBottom: 12 }}>Leilão Club</div>
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
              <BotaoCompartilhar planoKey="clube" dark />
            </div>
            )}
          </div>
        )}

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
              </span>{' '}e respondemos por e-mail.
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
        /* 3 planos lado a lado só onde cabem (~300 px cada); abaixo disso, um por linha e centralizados. */
        @media (max-width: 980px) {
          .grid-planos { grid-template-columns: 1fr !important; max-width: 560px !important; }
          /* No celular o mais vendido vem primeiro (24/10). */
          .card-pro { order: -1; }
        }
      `}</style>
    </div>
  );
}
