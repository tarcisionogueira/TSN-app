import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Car, Home, Search, BarChart3, ShieldCheck, FileText, TrendingUp, Gavel,
  CheckCircle2, ArrowRight, ChevronDown, ChevronUp, Sparkles, BadgeCheck,
  GraduationCap, Calculator, MapPin, Smartphone, Lock,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';
import { registrarEvento } from '../utils/tracker';
import { usePlanos } from '../contexts/PlanosContext';

// ─────────────────────────────────────────────────────────────────────────────────────────
// PÁGINA INICIAL (reescrita em 23/10, decisão do dono). O que mudou e por quê:
//  • A página VENDE três coisas — plataforma, assessoria e formação — para imóveis E veículos.
//    Não é vitrine de lotes: catálogo de imóveis faria a BidPro parecer imobiliária.
//  • Medido no PostHog (90 d, visitantes sem conta): rolagem mediana de 9% e só 4 de 19 passaram
//    da metade. Tudo o que decide (oferta, prova, os dois caminhos de compra) está nos 2 primeiros
//    blocos; o que antes vinha depois de 50% — depoimentos, assessoria, planos — subiu.
//  • De 13 seções para 8; Calculadora, Índice e App viraram uma faixa de "ferramentas grátis".
//  • Cada seção vista e cada botão clicado viram evento (`lp_secao` / `lp_cta`) para medir a ordem
//    com dado em vez de achismo.
//
// 25/10 (arena das páginas pré-login, decisão aprovada pelo dono) — A PÁGINA PASSA A VENDER O PAGO:
//  • PROVA (quem somos, 4 itens fixos) separada do ACERVO (o que existe agora, faixa própria). Antes o acervo
//    tomava o lugar do "< 5 min" com uma frase de ~55 caracteres que quebrava em 3-4 linhas.
//  • VITRINE com 6 lotes reais logo depois do topo — não é catálogo (6, não 33 mil): é o "33 mil+" virando
//    lote concreto. Vem do retrato diário de landing_numeros (view mascarada, sem leiloeiro/link/edital).
//  • Preço real (planos_config via usePlanos) no topo e nos cards; valor não lido = nenhum preço, nunca
//    um número escrito aqui.
//  • Página enxugada: "Antes do lance" fundido em "Como funciona", equipe atrás de flag, FAQ com 5.
//  • O REVOKE de 20261025_imoveis_leilao_fecha_colunas_anon.sql foi aplicado pelo dono em 25/10 (conferido: anon
//    sem SELECT em fonte/numero_matricula; busca por raio de visitante funcionando; auditoria 0/0) — a landing
//    passou a prometer "leiloeiro, edital e matrícula" como Investidor Pro.
// ─────────────────────────────────────────────────────────────────────────────────────────

// "Quem está do seu lado" fica fora até a #297 (fotos e nomes reais da equipe). Reversível: true volta.
const MOSTRAR_EQUIPE = false;

// DEPOIMENTOS — pendente (23/10): o dono sobe os vídeos no YouTube e envia os links com os casos
// (cidade, valor, desconto). Enquanto a lista estiver vazia, a seção NÃO aparece (seção vazia ou
// "em breve" na página de venda é pior que nenhuma). Formato:
//   { nome, cidade, youtubeId, titulo, numeros: [['Arremate', 'R$ 280 mil'], ['Desconto', '38%']] }
const DEPOIMENTOS = [];

// As perguntas que travam quem quer arrematar — e que o relatório responde antes do lance.
const PERGUNTAS = [
  { q: 'É seguro arrematar este bem?', icon: ShieldCheck },
  { q: 'Tem alguma bomba no edital ou na matrícula?', icon: FileText },
  { q: 'Quanto ele realmente vale?', icon: BarChart3 },
  { q: 'Quanto vou gastar depois do arremate?', icon: TrendingUp },
  { q: 'Até quanto posso dar de lance e ainda lucrar?', icon: Gavel },
];

const PASSOS = [
  { n: '01', icon: Search, cor: '#0D63DB', titulo: 'Encontre', desc: 'Imóveis e veículos de leiloeiros de todo o Brasil, com filtros por cidade, tipo, valor e data.' },
  { n: '02', icon: FileText, cor: '#8b5cf6', titulo: 'Analise', desc: 'A IA lê edital e matrícula e entrega viabilidade, riscos e o Bid Score em minutos.' },
  { n: '03', icon: ShieldCheck, cor: '#10b981', titulo: 'Decida', desc: 'Teto de lance, custos depois do arremate e os riscos que inviabilizam a posse — antes do lance.' },
  { n: '04', icon: Gavel, cor: '#f59e0b', titulo: 'Arremate', desc: 'Sozinho ou com a nossa equipe: estratégia de lance, documentação, registro e posse.' },
];

const EQUIPE = [
  { emoji: '⚖️', cargo: 'Jurídico', desc: 'Advogados em pós-arrematação, registro e regularização' },
  { emoji: '📊', cargo: 'Análise', desc: 'Analistas que revisam o bem antes do lance do cliente' },
  { emoji: '🏛️', cargo: 'Cartórios', desc: 'Relação direta com cartórios para agilizar o registro' },
  { emoji: '🎓', cargo: 'Formação', desc: 'Quem forma arrematadores há 8 anos e conduz o clube de negócios' },
];

// FAQ com 5 (25/10): as duas que decidem a compra no topo. Saíram (estão no git): Bid Score, veículos, cotas
// de IA e "em quais lugares" — a página repetia a mesma promessa em 4 seções.
const FAQS = [
  { q: 'Posso cancelar quando quiser?', r: 'Sim. No plano mensal não há fidelidade nem multa. No anual, você cancela a renovação a qualquer momento e mantém o acesso até o fim dos 12 meses.' },
  { q: 'O que o grátis não mostra?', r: 'O Explorador busca leilões em todo o Brasil e gera 3 relatórios de amostra (mercado e viabilidade financeira), sem cartão. O link de cada lote, o edital e a matrícula, além do relatório documental e jurídico que completa o Bid Score, ficam no Investidor Pro.' },
  { q: 'Preciso ter experiência em leilões?', r: 'Não. A plataforma guia iniciantes e investidores experientes, e a formação da BidPro ensina o caminho completo. O plano Explorador é gratuito.' },
  { q: 'A análise da IA substitui um advogado?', r: 'Não. A IA é o primeiro filtro: identifica riscos em minutos e mostra o que merece estudo mais profundo. Nos planos com assessoria, a análise jurídica é conduzida pela nossa equipe.' },
  { q: 'Como funciona a assessoria?', r: 'A equipe acompanha você do estudo do bem ao registro final: estratégia de lance, documentação, regularização e imissão de posse. É contratada por arrematação, dentro da plataforma: crie sua conta para ver valores e condições — e ter um especialista da equipe no seu caso.' },
];

// "31.808" → "31 mil+": o número muda todo dia; arredondar para baixo nunca promete a mais.
const milMais = (n) => (n >= 1000 ? `${Math.floor(n / 1000)} mil+` : n > 0 ? `${n}` : null);
const centenaMais = (n) => (n >= 100 ? `${(Math.floor(n / 100) * 100).toLocaleString('pt-BR')}+` : n > 0 ? `${n}` : null);

// Idade do retrato de landing_numeros, em horas (null = sem carimbo legível). O acervo e a vitrine mudam
// todo dia; um retrato velho com cara de "agora" é exatamente o número plausível e errado da forma nº 10.
const horasDesde = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? (Date.now() - t) / 3600000 : null; };
const MAX_IDADE_H = 48;
const brl0 = (v) => 'R$ ' + Math.round(Number(v) || 0).toLocaleString('pt-BR');
const brl2 = (v) => 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TIPO_LABEL = { apartamento: 'Apartamento', casa: 'Casa', terreno: 'Terreno', comercial: 'Comercial', rural: 'Rural' };
// Dias até o leilão pelo calendário LOCAL (data ISO "AAAA-MM-DD" do retrato; texto inválido = null).
const diasAte = (d) => {
  const m = String(d || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const alvo = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / 86400000);
};

const AZUL = '#0D63DB';
const ESCURO = 'linear-gradient(135deg, #080f1a 0%, #0a1f3d 60%, #0d2a50 100%)';
const rotulo = (cor = AZUL) => ({ fontSize: 11, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 });
const h2 = (cor = '#0f172a') => ({ fontSize: 'clamp(26px,4vw,38px)', fontWeight: 900, color: cor, margin: '0 0 12px', lineHeight: 1.15, letterSpacing: '-0.5px' });

const appInstalado = () => typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true);

export default function Landing() {
  const nav = useNavigate();
  const mobile = useIsMobile();
  const [faqAberto, setFaqAberto] = useState(null);
  const [num, setNum] = useState(null);
  // `carregou` separa "ainda não respondeu" de "respondeu sem vitrine": só o segundo vira evento de ausência.
  const [carregou, setCarregou] = useState(false);
  const planosCtx = usePlanos();

  // Números do acervo + vitrine (retrato 1x/dia — landing_numeros). Falhou → a prova fica completa e a faixa
  // do acervo e a vitrine somem; o sumiço vira evento (`lp_vitrine_ausente`) e o health-check acusa
  // (`landing_cache`), para "sumiu" nunca ser silêncio.
  useEffect(() => {
    let vivo = true;
    supabase.rpc('landing_numeros').then(({ data, error }) => {
      if (!vivo) return;
      if (error) console.warn('[landing] números do acervo indisponíveis:', error.message);
      setNum(error ? { _erro: error.message } : (data || {}));
      setCarregou(true);
    }, (e) => {
      if (!vivo) return;
      console.warn('[landing] números do acervo: falha de rede', e?.message || e);
      setNum({ _erro: String(e?.message || 'rede') });
      setCarregou(true);
    });
    return () => { vivo = false; };
  }, []);

  // ACERVO (faixa própria) — só com imóveis E veículos lidos; o retrato vale por 48 h.
  const idadeNum = horasDesde(num?.em);
  const numFresco = idadeNum != null && idadeNum <= MAX_IDADE_H;
  const acervo = numFresco && milMais(num?.imoveis) && milMais(num?.veiculos)
    // 25/10 (dono: "autoridade e diversidade", comparando com o Leilão Imóvel): + cidades. Tudo vem do retrato diário
    // de landing_numeros_atualizar(); coluna sem número lido some sozinha (nunca um valor fixo no código).
    ? [[milMais(num.imoveis), 'imóveis'], [milMais(num.veiculos), 'veículos'],
       ...(centenaMais(num.cidades) ? [[centenaMais(num.cidades), 'cidades']] : []),
       // 30/10 (dono): conta os leiloeiros CONECTADOS (com ou sem lote hoje) — por isso o rótulo diz "conectados".
       ...(centenaMais(num.leiloeiros) ? [[centenaMais(num.leiloeiros), 'leiloeiros conectados']] : [])]
    : null;
  const atualizadoLabel = numFresco
    ? (new Date(num.em).toDateString() === new Date().toDateString() ? 'atualizado hoje' : 'atualizado ontem')
    : null;

  // VITRINE — lista do retrato, com carimbo próprio de no máx. 48 h.
  const idadeVit = horasDesde(num?.vitrine_em);
  const vitrine = Array.isArray(num?.vitrine) && idadeVit != null && idadeVit <= MAX_IDADE_H
    ? num.vitrine.filter((l) => l && l.id) : [];
  const motivoSemVitrine = !carregou ? null
    : num?._erro ? 'rpc_erro'
    : !Array.isArray(num?.vitrine) ? 'sem_chave'
    : idadeVit == null || idadeVit > MAX_IDADE_H ? 'retrato_velho'
    : vitrine.length === 0 ? 'vazia' : null;
  useEffect(() => {
    if (motivoSemVitrine) {
      console.warn('[landing] vitrine fora do ar:', motivoSemVitrine, num?.vitrine_erro || '');
      registrarEvento('lp_vitrine_ausente', { alvo: motivoSemVitrine, detalhe: String(num?.vitrine_erro || '').slice(0, 120) });
    }
  }, [motivoSemVitrine]); // eslint-disable-line react-hooks/exhaustive-deps

  // PREÇO — só o que VEIO do planos_config (`doBanco`). O catálogo estático de cursos.js é o que o contexto
  // devolve quando a leitura falha, e exibir esse valor é o "R$ 49,90 na tela, R$ 89,90 no checkout".
  const precoDe = (key) => { const p = planosCtx?.[key]; return p?.doBanco && Number(p.preco) > 0 ? p : null; };
  const pro = precoDe('top2');
  const proMesAnual = pro && Number(pro.precoAnual) > 0 ? Number(pro.precoAnual) / 12 : null;
  const veic = precoDe('veiculos');

  // Avisa o banner "Instalar app" (PwaInstall) para só aparecer depois que a pessoa rolar.
  useEffect(() => {
    window.__tsnLanding = true; window.dispatchEvent(new Event('tsn:landing'));
    return () => { window.__tsnLanding = false; window.dispatchEvent(new Event('tsn:landing')); };
  }, []);

  // Medição da ordem: cada seção que entra na tela vira UM evento por visita.
  // Re-observa quando o RPC responde (25/10): acervo e vitrine só existem DEPOIS dele — observadas só no
  // mount, as duas seções novas nunca virariam `lp_secao` (zero que não seria medição). O Set fica num ref
  // para a segunda passada não repetir as seções já contadas.
  const vistasRef = React.useRef(new Set());
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const vistas = vistasRef.current;
    const obs = new IntersectionObserver((ents) => {
      for (const e of ents) {
        const id = e.target.getAttribute('data-lp-secao');
        if (e.isIntersecting && !vistas.has(id)) { vistas.add(id); registrarEvento('lp_secao', { alvo: id }); }
      }
    }, { threshold: 0.35 });
    document.querySelectorAll('[data-lp-secao]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [carregou]);

  const cta = (alvo, fn) => () => { registrarEvento('lp_cta', { alvo }); fn(); };
  // `next` = para onde o botão prometeu levar (sobrevive à confirmação de e-mail via CHAVE_DESTINO).
  const cadastro = (alvo, next) => cta(alvo, () => nav(`/login?modo=cadastro${next ? `&next=${encodeURIComponent(next)}` : ''}`));
  // Cadastro JÁ com o plano: o Login abre em cadastro, mostra "Plano X selecionado" e o next leva ao checkout.
  const cadastroPlano = (alvo, key) => cta(alvo, () => nav(key === 'explorador'
    ? '/login?modo=cadastro&plano=explorador'
    : `/login?modo=cadastro&plano=${key}&next=${encodeURIComponent(`/checkout?plano=${key}`)}`));

  // ASSESSORIA (23/10, dono): sem preço público e só para quem tem conta — o especialista é acesso de
  // quem CONTRATA. A página leva ao CADASTRO; valores e contratação ficam dentro da plataforma (a tela de
  // planos só mostra o card da assessoria logado). Nada de "fale com um especialista" nem link para /planos.

  // Dúvida (sem login): nome/email/telefone/mensagem → /api/duvida, que abre um chamado no Atendimento.
  const VAZIO = { open: false, origem: 'duvida_landing', nome: '', email: '', tel: '', msg: '', enviando: false, ok: false, erro: '' };
  const [dv, setDv] = useState(VAZIO);
  const abrirDuvida = (origem) => cta(origem, () => setDv({ ...VAZIO, open: true, origem }));
  const enviarDuvida = async () => {
    if (dv.msg.trim().length < 5) { setDv(d => ({ ...d, erro: 'Escreva sua dúvida.' })); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dv.email)) { setDv(d => ({ ...d, erro: 'Informe um e-mail válido para receber a resposta.' })); return; }
    setDv(d => ({ ...d, enviando: true, erro: '' }));
    try {
      const r = await fetch('/api/duvida', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: dv.nome, email: dv.email, telefone: dv.tel, mensagem: dv.msg, origem: dv.origem }),
      });
      const d = await r.json().catch(() => ({})); // 500 com corpo HTML não vira "Unexpected token <"
      if (!r.ok) throw new Error(d.error || 'Erro ao enviar');
      setDv(s => ({ ...s, enviando: false, ok: true }));
    } catch (e) { setDv(s => ({ ...s, enviando: false, erro: e.message })); }
  };

  // PROVA = quem somos. Quatro itens FIXOS, rótulo de uma linha; o "< 5 min" não some mais quando o banco
  // responde (o acervo tem faixa própria logo abaixo).
  const PROVA = [
    { v: 'R$ 70M+', l: 'arrematados com assessoria' },
    { v: '11', l: 'estados' },
    { v: '8 anos', l: 'formando arrematadores' },
    { v: '< 5 min', l: 'por análise' },
  ];

  const btnPrim = { padding: '15px 30px', background: AZUL, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 9, boxShadow: '0 8px 28px rgba(13,99,219,0.45)' };
  const btnSec = (escuro = true) => ({ padding: '15px 26px', background: 'transparent', color: escuro ? '#e2e8f0' : '#0f172a', border: `1px solid ${escuro ? 'rgba(255,255,255,0.25)' : '#cbd5e1'}`, borderRadius: 12, fontWeight: 700, fontSize: 15, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 });
  const secao = (bg, pad = '84px 20px') => ({ padding: mobile ? '56px 18px' : pad, background: bg });
  const duasColunas = mobile ? 'minmax(0, 1fr)' : 'minmax(0, 1.05fr) minmax(0, 1fr)';

  return (
    <div id="lp-raiz" style={{ fontFamily: "'Inter', sans-serif", color: '#0f172a' }}>

      {/* ── 1. TOPO: a oferta inteira + prova, na primeira tela ───────────────────── */}
      <section data-lp-secao="topo" style={{ background: ESCURO, padding: mobile ? '52px 18px 44px' : '84px 20px 64px', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(ellipse at 10% 90%, rgba(13,99,219,0.22) 0%, transparent 55%), radial-gradient(ellipse at 90% 10%, rgba(52,211,153,0.10) 0%, transparent 50%)' }} />
        <div style={{ maxWidth: 1140, margin: '0 auto', position: 'relative', display: 'grid', gridTemplateColumns: duasColunas, gap: mobile ? 36 : 56, alignItems: 'center' }}>
          <div style={{ textAlign: mobile ? 'center' : 'left' }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(13,99,219,0.16)', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 24, padding: '6px 16px', fontSize: 11.5, color: '#93c5fd', fontWeight: 800, marginBottom: 22, textTransform: 'uppercase', letterSpacing: 1.2 }}>
              <Sparkles size={13} /> Plataforma · Assessoria · Formação
            </div>
            <h1 style={{ fontSize: 'clamp(32px, 5.2vw, 56px)', fontWeight: 900, color: 'white', lineHeight: 1.06, margin: '0 0 20px', letterSpacing: '-1.5px' }}>
              Arremate imóveis e veículos em leilão{' '}
              <span style={{ background: 'linear-gradient(90deg, #60a5fa 0%, #34d399 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>com segurança e lucro.</span>
            </h1>
            <p style={{ fontSize: 'clamp(15px,1.8vw,18px)', color: '#a5b4c8', lineHeight: 1.7, margin: mobile ? '0 auto 30px' : '0 0 32px', maxWidth: 560 }}>
              A <strong style={{ color: '#fff' }}>IA da BidPro</strong> lê o edital e mapeia os riscos de cada lote. A <strong style={{ color: '#fff' }}>nossa equipe</strong> acompanha você do lance à posse. E a <strong style={{ color: '#fff' }}>formação</strong> te prepara para arrematar com método.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: mobile ? 'center' : 'flex-start' }}>
              <button onClick={cadastro('topo_cadastro')} style={btnPrim}>Criar conta grátis <ArrowRight size={17} /></button>
              <button onClick={cta('topo_planos', () => nav('/planos'))} style={btnSec()}>Ver planos e preços</button>
            </div>
            {/* Linha de preço (25/10): o valor vem do planos_config; sem ele, só a parte grátis — nunca um fallback. */}
            <p data-lp-preco={proMesAnual ? 'ok' : 'sem_preco'} style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, marginTop: 14, maxWidth: 560, marginLeft: mobile ? 'auto' : 0, marginRight: mobile ? 'auto' : 0 }}>
              <strong style={{ color: '#e2e8f0' }}>Grátis:</strong> 3 relatórios de amostra, sem cartão
              {proMesAnual && <> · <strong style={{ color: '#e2e8f0' }}>Investidor Pro</strong> a partir de {brl2(proMesAnual)}/mês: leiloeiro, edital e matrícula · cancele quando quiser</>}
            </p>
          </div>

          {/* Visual do PRODUTO (não de um lote à venda): é o relatório que o cliente recebe. */}
          <div style={{ position: 'relative', maxWidth: 470, width: '100%', margin: '0 auto' }}>
            <div style={{ background: 'white', borderRadius: 20, padding: '20px 20px 16px', boxShadow: '0 24px 60px rgba(0,0,0,0.45)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1.2 }}>Relatório BidPro</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#10b981', background: '#f0fdf4', borderRadius: 20, padding: '3px 10px' }}>Análise em 4 min</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                <div style={{ width: 74, height: 74, borderRadius: 16, background: '#f0fdf4', border: '2px solid #10b981', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 27, fontWeight: 900, color: '#10b981', lineHeight: 1 }}>9,4</div>
                  <div style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 800, marginTop: 3 }}>BID SCORE</div>
                </div>
                <div>
                  <div style={{ fontSize: 15.5, fontWeight: 800, color: '#0f172a' }}>🟢 Excelente oportunidade</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.5, marginTop: 2 }}>Apartamento · 2ª praça · desocupado</div>
                </div>
              </div>
              {[
                ['Lance mínimo', 'R$ 280.000', '#0f172a'],
                ['Valor de mercado', 'R$ 450.000', '#059669'],
                ['Teto de lance sugerido', 'R$ 336.000', AZUL],
                ['Riscos jurídicos', 'Nenhum relevante', '#059669'],
                ['ROI projetado', '42%', '#059669'],
              ].map(([l, v, c]) => (
                <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ color: '#64748b' }}>{l}</span><span style={{ fontWeight: 800, color: c }}>{v}</span>
                </div>
              ))}
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 8, textAlign: 'center' }}>Exemplo de relatório (ilustrativo)</div>
            </div>
            {!mobile && (
              <div style={{ position: 'absolute', left: -34, bottom: -22, background: '#0f172a', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 12px 30px rgba(0,0,0,0.4)' }}>
                <Car size={18} color="#34d399" />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'white' }}>Veículos no pátio</div>
                  <div style={{ fontSize: 11, color: '#94a3b8' }}>FIPE ao lado do lance</div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Faixa de prova */}
        <div style={{ maxWidth: 1140, margin: mobile ? '40px auto 0' : '64px auto 0', position: 'relative', display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'repeat(4, minmax(0, 1fr))', gap: mobile ? 18 : 24, borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: mobile ? 28 : 36 }}>
          {PROVA.map(({ v, l }) => (
            <div key={l} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: mobile ? 24 : 30, fontWeight: 900, color: 'white', letterSpacing: '-0.5px' }}>{v}</div>
              <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4, lineHeight: 1.35 }}>{l}</div>
            </div>
          ))}
        </div>

        {/* ACERVO — faixa própria (bloco_numeros do verdict): 3 colunas iguais de número + UMA palavra, também
            em 390px. Some inteira sem imóveis/veículos lidos ou com retrato de mais de 48 h. */}
        {acervo && (
          <div data-lp-secao="acervo" style={{ maxWidth: 1140, margin: mobile ? '28px auto 0' : '36px auto 0', position: 'relative', borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: mobile ? 22 : 28, textAlign: 'center' }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#7dd3fc', textTransform: 'uppercase', letterSpacing: 2, marginBottom: 14 }}>Em leilão agora</div>
            <a href={vitrine.length ? '#vitrine' : '/leiloes'}
              onClick={(e) => {
                registrarEvento('lp_cta', { alvo: 'acervo_faixa' });
                if (vitrine.length) { e.preventDefault(); document.getElementById('vitrine')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
              }}
              style={{ display: 'grid', gridTemplateColumns: `repeat(${mobile && acervo.length === 4 ? 2 : acervo.length}, minmax(0, 1fr))`, gap: mobile ? 14 : 24, maxWidth: 760, margin: '0 auto', textDecoration: 'none' }}>
              {acervo.map(([v, l]) => (
                <div key={l}>
                  <div style={{ fontSize: mobile ? 24 : 28, fontWeight: 900, color: 'white', letterSpacing: '-0.5px', lineHeight: 1.1 }}>{v}</div>
                  <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>{l}</div>
                </div>
              ))}
            </a>
            <div style={{ fontSize: 12, color: '#7c8ba1', marginTop: 14 }}>
              {atualizadoLabel} · <a href="/leiloes" onClick={() => registrarEvento('lp_cta', { alvo: 'acervo_ver_lotes' })} style={{ color: '#93c5fd', textDecoration: 'none', fontWeight: 700 }}>ver lotes →</a>
            </div>
          </div>
        )}
      </section>

      {/* ── 1b. VITRINE "EM LEILÃO AGORA": 6 lotes reais, cadeado no que é Pro ─────────── */}
      {vitrine.length > 0 && (
        <section id="vitrine" data-lp-secao="vitrine" style={{ ...secao('white', '64px 20px'), overflow: 'hidden' }}>
          <div style={{ maxWidth: 1140, margin: '0 auto' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
              <div>
                <div style={rotulo()}>Em leilão agora</div>
                <h2 style={{ ...h2(), margin: 0 }}>Lotes reais, nos próximos dias</h2>
              </div>
              {!mobile && <a href="/leiloes" onClick={() => registrarEvento('lp_cta', { alvo: 'vitrine_todos' })} style={{ color: AZUL, fontWeight: 800, fontSize: 14.5, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Ver todos os leilões abertos <ArrowRight size={15} /></a>}
            </div>
            <div style={mobile
              ? { display: 'flex', gap: 14, overflowX: 'auto', scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch', margin: '0 -18px', padding: '4px 18px 14px', scrollPaddingLeft: 18 }
              : { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 20 }}>
              {vitrine.map((l) => {
                const dias = diasAte(l.data_leilao);
                return (
                  <a key={l.id} href={`/leilao/${l.id}`} onClick={() => registrarEvento('lp_cta', { alvo: 'vitrine_card', detalhe: String(l.id) })}
                    style={{ flex: mobile ? '0 0 80%' : undefined, scrollSnapAlign: 'start', minWidth: 0, background: 'white', borderRadius: 18, border: '1px solid #e2e8f0', overflow: 'hidden', textDecoration: 'none', color: '#0f172a', display: 'flex', flexDirection: 'column', boxShadow: '0 4px 16px rgba(15,23,42,0.06)' }}>
                    <div style={{ position: 'relative', paddingTop: '62%', background: '#e2e8f0' }}>
                      {l.foto && (
                        <img src={l.foto} alt={`${TIPO_LABEL[l.tipo] || 'Imóvel'} em ${l.cidade}`} loading="lazy"
                          onError={(e) => { e.currentTarget.style.display = 'none'; }}
                          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      )}
                      {Number(l.desconto_pct) > 0 && (
                        <span style={{ position: 'absolute', top: 10, left: 10, background: '#059669', color: 'white', fontSize: 12, fontWeight: 900, padding: '4px 10px', borderRadius: 20 }}>-{Math.round(Number(l.desconto_pct))}%</span>
                      )}
                      {dias != null && dias >= 0 && (
                        <span style={{ position: 'absolute', top: 10, right: 10, background: 'rgba(15,23,42,0.82)', color: 'white', fontSize: 11.5, fontWeight: 800, padding: '4px 10px', borderRadius: 20 }}>
                          {dias === 0 ? 'leilão hoje' : dias === 1 ? 'leilão amanhã' : `leilão em ${dias} dias`}
                        </span>
                      )}
                    </div>
                    <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                      <div style={{ fontSize: 13, color: '#64748b', fontWeight: 700 }}>{TIPO_LABEL[l.tipo] || 'Imóvel'} · {l.cidade}/{l.uf}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>Lance mínimo</div>
                      <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: '-0.3px', marginTop: -4 }}>{brl0(l.lance_minimo)}</div>
                      {Number(l.avaliacao) > 0 && <div style={{ fontSize: 12.5, color: '#64748b' }}>Avaliação {brl0(l.avaliacao)}</div>}
                      <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: '#475569', lineHeight: 1.45 }}>
                        <Lock size={13} color={AZUL} style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>Leiloeiro, edital e matrícula: <strong style={{ color: AZUL }}>Investidor Pro</strong></span>
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
            {mobile && (
              <div style={{ textAlign: 'center', marginTop: 8 }}>
                <a href="/leiloes" onClick={() => registrarEvento('lp_cta', { alvo: 'vitrine_todos' })} style={{ color: AZUL, fontWeight: 800, fontSize: 14.5, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>Ver todos os leilões abertos <ArrowRight size={15} /></a>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── 2. AS TRÊS FORMAS DE ARREMATAR (o centro comercial) ──────────────────── */}
      <section data-lp-secao="tres_formas" style={secao('white')}>
        <div style={{ maxWidth: 1140, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 44 }}>
            <div style={rotulo()}>Como você quer arrematar?</div>
            <h2 style={h2()}>Três caminhos, do primeiro lance ao portfólio</h2>
            <p style={{ color: '#64748b', fontSize: 15.5, maxWidth: 620, margin: '0 auto', lineHeight: 1.7 }}>Analise sozinho com a nossa IA, arremate com a nossa equipe ao lado ou aprenda o método completo. Pode começar por um e somar os outros.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))', gap: 20 }}>
            {[
              { icon: BarChart3, cor: AZUL, tag: 'Plataforma', titulo: 'Analise com IA', desc: 'Relatórios que respondem, antes do lance, se o leilão vale a pena.',
                itens: ['Imóveis e veículos de todo o Brasil', 'Relatórios de mercado, viabilidade, documental e jurídico', 'Bid Score e teto de lance', 'Comece grátis no plano Explorador'],
                botao: 'Criar conta grátis', acao: cadastro('formas_plataforma') },
              { icon: ShieldCheck, cor: '#d97706', tag: 'Assessoria', titulo: 'Arremate com a nossa equipe', desc: 'Um time do seu lado do estudo do bem até a chave na mão.', destaque: true,
                itens: ['Analista dedicado que valida o Bid Score', 'Estratégia de lance', 'Documentação, registro e imissão na posse', 'Advogados especializados em pós-arrematação'],
                nota: 'Valores e contratação dentro da plataforma, para clientes.',
                botao: 'Criar conta e conhecer', acao: cadastro('formas_assessoria', '/planos?plano=assessorado') },
              { icon: GraduationCap, cor: '#7c3aed', tag: 'Formação', titulo: 'Aprenda a arrematar', desc: 'O método de quem forma arrematadores há 8 anos.',
                itens: ['Cursos e e-books práticos', 'Aulas ao vivo com especialistas', 'Clube de negócios e comunidade', 'Do primeiro leilão ao portfólio'],
                botao: 'Ver cursos', acao: cta('formas_cursos', () => nav('/educacao')) },
            ].map(({ icon: Icon, cor, tag, titulo, desc, itens, botao, acao, destaque, nota }) => (
              <div key={tag} style={{ borderRadius: 20, border: destaque ? `2px solid ${cor}` : '1px solid #e2e8f0', padding: '28px 26px', background: destaque ? '#fffbeb' : 'white', position: 'relative', display: 'flex', flexDirection: 'column', boxShadow: destaque ? '0 12px 36px rgba(217,119,6,0.14)' : '0 2px 10px rgba(15,23,42,0.05)' }}>
                {destaque && <div style={{ position: 'absolute', top: -12, left: 26, background: cor, color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>Mais completo</div>}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <div style={{ width: 46, height: 46, borderRadius: 13, background: cor, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 8px 18px ${cor}40` }}><Icon size={22} color="white" /></div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: 1.2 }}>{tag}</div>
                </div>
                <h3 style={{ fontSize: 21, fontWeight: 900, margin: '0 0 8px', color: '#0f172a' }}>{titulo}</h3>
                <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: '0 0 18px' }}>{desc}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, marginBottom: 24 }}>
                  {itens.map(it => (
                    <div key={it} style={{ display: 'flex', gap: 9, alignItems: 'flex-start' }}>
                      <CheckCircle2 size={16} color={cor} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.45 }}>{it}</span>
                    </div>
                  ))}
                </div>
                {nota && <div style={{ fontSize: 12.5, color: '#92400e', margin: '-10px 0 14px', lineHeight: 1.5 }}>{nota}</div>}
                <button onClick={acao} style={{ marginTop: 'auto', padding: '13px 18px', background: destaque ? cor : 'white', color: destaque ? 'white' : cor, border: `1.5px solid ${cor}`, borderRadius: 11, fontWeight: 800, fontSize: 14.5, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {botao} <ArrowRight size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 2b. CASOS E DEPOIMENTOS — só aparece quando houver (ver DEPOIMENTOS) ──── */}
      {DEPOIMENTOS.length > 0 && (
        <section id="casos" data-lp-secao="casos" style={secao('#f8fafc')}>
          <div style={{ maxWidth: 1140, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <div style={rotulo()}>Quem já arrematou com a BidPro</div>
              <h2 style={h2()}>Operações reais, contadas por quem fez</h2>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(auto-fit, minmax(300px, 1fr))', gap: 20 }}>
              {DEPOIMENTOS.map(dp => (
                <div key={dp.youtubeId} style={{ background: 'white', borderRadius: 18, overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                  <div style={{ position: 'relative', paddingTop: '56.25%', background: '#0f172a' }}>
                    <iframe title={dp.titulo} src={`https://www.youtube-nocookie.com/embed/${dp.youtubeId}`} loading="lazy" allowFullScreen
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }} />
                  </div>
                  <div style={{ padding: '16px 18px' }}>
                    <div style={{ fontSize: 15, fontWeight: 800 }}>{dp.titulo}</div>
                    <div style={{ fontSize: 12.5, color: '#64748b', margin: '2px 0 10px' }}>{dp.nome} · {dp.cidade}</div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                      {(dp.numeros || []).map(([l, v]) => <div key={l}><div style={{ fontSize: 16, fontWeight: 900, color: AZUL }}>{v}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{l}</div></div>)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── 4. IMÓVEIS E VEÍCULOS: as duas linhas de produto ─────────────────────── */}
      <section data-lp-secao="imoveis_veiculos" style={secao('#f8fafc')}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={rotulo()}>Imóveis e veículos</div>
            <h2 style={h2()}>A mesma segurança nos dois leilões</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 20 }}>
            {[
              { icon: Home, cor: AZUL, bg: 'white', titulo: 'Leilão de imóveis', desc: 'Casas, apartamentos, terrenos e comerciais com desconto de 20% a 50% sobre o mercado.',
                itens: ['Edital e matrícula lidos por IA', 'Penhoras, ocupação e ônus mapeados', 'Comparativos e preço do m² da região', 'Viabilidade, ROI e teto de lance'],
                botao: 'Ver imóveis por estado', href: '/leiloes', alvo: 'linha_imoveis' },
              { icon: Car, cor: '#0f766e', bg: 'white', titulo: 'Leilão de veículos no pátio', desc: 'O leiloeiro só apresenta veículos que já estão no pátio dele: sem retomada, operação simples e segura.', novo: true,
                itens: ['FIPE ao lado do lance mínimo', 'De qualquer estado — você paga só o frete', 'Carros, motos, caminhões e utilitários', 'Relatório por IA com teto de lance'],
                botao: 'Ver veículos em leilão', href: '/#/veiculos', alvo: 'linha_veiculos' },
            ].map(({ icon: Icon, cor, bg, titulo, desc, itens, botao, href, alvo, novo }) => (
              <div key={titulo} style={{ background: bg, borderRadius: 20, border: '1px solid #e2e8f0', padding: '28px 26px', display: 'flex', flexDirection: 'column', boxShadow: '0 2px 12px rgba(15,23,42,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: `${cor}14`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={22} color={cor} /></div>
                  <h3 style={{ fontSize: 20, fontWeight: 900, margin: 0 }}>{titulo}</h3>
                  {novo && <span style={{ fontSize: 10, fontWeight: 800, color: '#0f766e', background: '#ccfbf1', borderRadius: 6, padding: '3px 8px', textTransform: 'uppercase', letterSpacing: 1 }}>Novo</span>}
                </div>
                <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: '0 0 16px' }}>{desc}</p>
                <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(2, minmax(0, 1fr))', gap: 10, marginBottom: 22 }}>
                  {itens.map(it => (
                    <div key={it} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <CheckCircle2 size={15} color={cor} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.45 }}>{it}</span>
                    </div>
                  ))}
                </div>
                <a href={href} onClick={() => registrarEvento('lp_cta', { alvo })}
                  style={{ marginTop: 'auto', alignSelf: 'flex-start', color: cor, fontWeight: 800, fontSize: 14.5, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {botao} <ArrowRight size={15} />
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 5. COMO FUNCIONA + QUEM ESTÁ DO SEU LADO ─────────────────────────────── */}
      <section data-lp-secao="como_funciona" style={secao('white')}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={rotulo()}>Como funciona</div>
            <h2 style={h2()}>Do primeiro filtro ao bem arrematado</h2>
            {/* "Antes do lance" fundido aqui (25/10): as perguntas que travam viram uma linha, sem os 3 Bid Scores
                ilustrativos — a mesma promessa aparecia em 4 seções. */}
            <p style={{ color: '#64748b', fontSize: 15, maxWidth: 640, margin: '0 auto 16px', lineHeight: 1.7 }}>Quem desiste do leilão desiste porque não consegue responder a estas perguntas. A BidPro responde todas antes do lance, e resume tudo no Bid Score, uma nota de 0 a 10.</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', maxWidth: 820, margin: '0 auto' }}>
              {PERGUNTAS.map(({ q, icon: Icon }) => (
                <span key={q} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#f1f5f9', borderRadius: 20, padding: '7px 13px', fontSize: 13, color: '#334155', fontWeight: 600 }}>
                  <Icon size={14} color={AZUL} style={{ flexShrink: 0 }} /> {q}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            {PASSOS.map(({ n, icon: Icon, cor, titulo, desc }) => (
              <div key={n} style={{ borderRadius: 16, padding: '22px 20px', border: '1px solid #e2e8f0', background: '#fbfdff' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{ width: 40, height: 40, borderRadius: 11, background: cor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Icon size={19} color="white" /></div>
                  <span style={{ fontSize: 13, fontWeight: 900, color: cor }}>{n}</span>
                </div>
                <div style={{ fontSize: 16.5, fontWeight: 900, marginBottom: 6 }}>{titulo}</div>
                <div style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.6 }}>{desc}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, maxWidth: 760, margin: '22px auto 0' }}>
            <BadgeCheck size={19} color="#059669" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.6 }}><strong style={{ color: '#0f172a' }}>IA + especialistas.</strong> A inteligência faz a maior parte da análise em minutos; nossos especialistas validam os casos críticos.</div>
          </div>

          {MOSTRAR_EQUIPE && <div style={{ marginTop: 56, background: '#f8fafc', borderRadius: 22, padding: mobile ? '28px 20px' : '36px 36px', display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'minmax(0, 0.9fr) minmax(0, 1.4fr)', gap: 28, alignItems: 'center', border: '1px solid #eef2f7' }}>
            <div>
              <div style={rotulo()}>Quem está do seu lado</div>
              <h3 style={{ fontSize: 'clamp(22px,3vw,28px)', fontWeight: 900, margin: '0 0 10px', lineHeight: 1.2 }}>8 anos formando arrematadores no Brasil</h3>
              <p style={{ fontSize: 14.5, color: '#64748b', lineHeight: 1.7, margin: 0 }}>A BidPro nasceu da prática no mercado de leilões. A equipe reúne analistas, advogados de pós-arrematação e especialistas em formação.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {EQUIPE.map(({ emoji, cargo, desc }) => (
                <div key={cargo} style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '16px 16px' }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>{emoji}</div>
                  <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>{cargo}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>}
        </div>
      </section>

      {/* ── 6. PLANOS — preço REAL do planos_config (25/10); sem leitura, o card fica sem preço ──────── */}
      <section data-lp-secao="planos" style={secao('#f8fafc')}>
        <div style={{ maxWidth: 1140, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={rotulo()}>Planos</div>
            <h2 style={h2()}>Comece grátis. Evolua no seu ritmo.</h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            {[
              { key: 'explorador', nome: 'Explorador', tag: 'Para começar', cor: '#64748b', preco: 'Grátis', sub: 'sem cartão',
                itens: ['Busca de leilões em todo o Brasil', '3 relatórios de amostra: mercado + viabilidade', 'Calculadora de arrematação', 'Cursos gratuitos'],
                fora: ['Quem é o leiloeiro, edital e matrícula', 'Relatório documental e jurídico'],
                botao: 'Criar conta grátis' },
              { key: 'top2', nome: 'Investidor Pro', tag: 'Mais popular', cor: AZUL, destaque: true,
                preco: pro ? `${pro.precoLabel}/mês` : null,
                sub: pro && proMesAnual ? `${brl2(proMesAnual)}/mês no anual` : null,
                itens: ['Leiloeiro, link do lote, edital e matrícula liberados', 'Relatório documental e jurídico por IA', 'Bid Score completo', 'Alertas de oportunidade por e-mail'],
                botao: 'Assinar o Investidor Pro' },
              { key: 'veiculos', nome: 'Leilão de Veículos', tag: 'Novo', cor: '#0f766e',
                preco: veic ? `${veic.precoLabel}/mês` : null, sub: null,
                itens: ['Busca com FIPE em todo o Brasil', 'Leiloeiro e documentos de cada lote', 'Relatórios de veículos por IA', 'Combo com o Investidor Pro'],
                botao: 'Assinar Veículos' },
              { key: 'assessorado', nome: 'Assessoria', tag: 'Para clientes', cor: '#d97706', preco: 'Por arrematação', sub: 'valores dentro da plataforma',
                itens: ['Tudo do Combo: imóveis + veículos', 'Analista dedicado', 'Do lance à imissão na posse', 'Registro via plataforma'],
                botao: 'Criar conta e conhecer' },
            ].map(({ key, nome, tag, cor, preco, sub, itens, fora, destaque, botao }) => (
              <div key={nome} style={{ background: 'white', borderRadius: 18, border: destaque ? `2px solid ${cor}` : '1px solid #e2e8f0', padding: '22px 20px', position: 'relative', display: 'flex', flexDirection: 'column', boxShadow: destaque ? `0 10px 30px ${cor}22` : 'none' }}>
                {destaque && <div style={{ position: 'absolute', top: -12, left: 20, background: cor, color: 'white', fontSize: 10, fontWeight: 800, padding: '4px 12px', borderRadius: 20, textTransform: 'uppercase', letterSpacing: 1 }}>{tag}</div>}
                <div style={{ fontSize: 12.5, fontWeight: 900, color: cor, textTransform: 'uppercase', letterSpacing: 1.3 }}>{nome}</div>
                {!destaque && <div style={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 700, marginTop: 4 }}>{tag}</div>}
                <div style={{ minHeight: 58, margin: '10px 0 14px' }}>
                  {preco && <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.4px', lineHeight: 1.15 }}>{preco}</div>}
                  {sub && <div style={{ fontSize: 12.5, color: '#64748b', marginTop: 3 }}>{sub}</div>}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {itens.map(it => (
                    <div key={it} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <CheckCircle2 size={14} color={cor} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.45 }}>{it}</span>
                    </div>
                  ))}
                  {(fora || []).map(it => (
                    <div key={it} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <Lock size={13} color="#94a3b8" style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.45 }}>{it} <span style={{ fontWeight: 700 }}>(Investidor Pro)</span></span>
                    </div>
                  ))}
                </div>
                <button onClick={key === 'assessorado' ? cadastro('planos_card_assessorado', '/planos?plano=assessorado') : cadastroPlano(`planos_card_${key}`, key)}
                  style={{ marginTop: 'auto', padding: '12px 14px', background: destaque ? cor : 'white', color: destaque ? 'white' : cor, border: `1.5px solid ${cor}`, borderRadius: 11, fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7 }}>
                  {botao} <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <button onClick={cta('planos_ver', () => nav('/planos'))} style={btnSec(false)}>Comparar todos os planos <ArrowRight size={16} /></button>
          </div>
        </div>
      </section>

      {/* ── 7. FERRAMENTAS GRÁTIS (antes eram 2 seções inteiras) ──────────────────── */}
      <section data-lp-secao="ferramentas" style={secao('white', '64px 20px')}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          <div style={{ ...rotulo(), textAlign: 'center' }}>Ferramentas grátis</div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(3, minmax(0, 1fr))', gap: 16, marginTop: 14 }}>
            {[
              { icon: Calculator, cor: '#059669', titulo: 'Calculadora de arrematação', desc: 'Quanto você pode dar de lance e ainda lucrar.', acao: cta('ferramenta_calculadora', () => nav('/calculadora')) },
              { icon: MapPin, cor: AZUL, titulo: 'Preço do m² na sua região', desc: 'Venda e locação por cidade e bairro.', acao: cadastro('ferramenta_indice', '/indice') },
              // Já aberto como app instalado: o card não teria o que fazer (o Header esconde o mesmo item).
              ...(appInstalado() ? [] : [{ icon: Smartphone, cor: '#7c3aed', titulo: 'App BidPro', desc: 'Alertas de oportunidades no celular.', acao: cta('ferramenta_app', () => window.dispatchEvent(new Event('tsn:pwa-install'))) }]),
            ].map(({ icon: Icon, cor, titulo, desc, acao }) => (
              <button key={titulo} onClick={acao} style={{ textAlign: 'left', display: 'flex', alignItems: 'center', gap: 14, padding: '18px 18px', borderRadius: 16, border: '1px solid #e2e8f0', background: '#fbfdff', cursor: 'pointer' }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `${cor}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Icon size={21} color={cor} /></div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>{titulo}</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{desc}</div>
                </div>
                <ArrowRight size={16} color="#94a3b8" />
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ── 8. PERGUNTAS FREQUENTES + CHAMADO FINAL ──────────────────────────────── */}
      <section data-lp-secao="faq" style={secao('#f8fafc')}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>
          <h2 style={{ ...h2(), textAlign: 'center', marginBottom: 32 }}>Perguntas frequentes</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {FAQS.map((faq, i) => (
              <div key={faq.q} style={{ background: 'white', borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
                <button onClick={() => setFaqAberto(faqAberto === i ? null : i)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '17px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', gap: 12 }}>
                  <span style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a', lineHeight: 1.4 }}>{faq.q}</span>
                  {faqAberto === i ? <ChevronUp size={17} color="#64748b" style={{ flexShrink: 0 }} /> : <ChevronDown size={17} color="#64748b" style={{ flexShrink: 0 }} />}
                </button>
                {faqAberto === i && <div style={{ padding: '0 20px 18px', fontSize: 14, color: '#64748b', lineHeight: 1.75 }}>{faq.r}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section data-lp-secao="cta_final" style={{ ...secao(ESCURO), textAlign: 'center' }}>
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <h2 style={{ ...h2('white'), fontSize: 'clamp(28px,5vw,44px)' }}>Seu próximo arremate pode estar no leilão de amanhã.</h2>
          <p style={{ color: '#94a3b8', fontSize: 16, lineHeight: 1.7, margin: '0 0 30px' }}>Crie sua conta grátis e analise suas primeiras oportunidades hoje — e, quando quiser, conte com a assessoria de quem já fez R$ 70 milhões em arrematações.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={cadastro('final_cadastro')} style={btnPrim}>Criar minha conta grátis <ArrowRight size={18} /></button>
            <button onClick={cta('final_planos', () => nav('/planos'))} style={btnSec()}>Ver planos e preços</button>
          </div>
          <p style={{ color: '#64748b', fontSize: 12.5, marginTop: 16 }}>Comece grátis · sem cartão · cancele quando quiser</p>
        </div>
      </section>

      {/* ── RODAPÉ — também carrega os links do acervo público (busca por cidade/estado), que saíram do
          meio da página mas continuam importando para o Google (link interno). ── */}
      <footer style={{ background: '#080f1a', padding: '48px 20px 30px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ maxWidth: 1140, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0,1.4fr) repeat(4, minmax(0,1fr))', gap: 28, marginBottom: 36 }}>
            <div style={{ gridColumn: mobile ? '1 / -1' : 'auto' }}>
              <div style={{ fontSize: 18, fontWeight: 900, color: 'white', marginBottom: 8 }}>Bid Pro Brasil</div>
              <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.7, maxWidth: 300 }}>Plataforma, assessoria e formação para arrematar imóveis e veículos em leilão com segurança.</div>
            </div>
            {[
              ['Plataforma', [['Planos', () => nav('/planos')], ['Calculadora', () => nav('/calculadora')], ['Educação', () => nav('/educacao')]]],
              ['Leilões', [['Imóveis por estado', '/leiloes'], ['Buscar por cidade', '/leiloes/buscar'], ['Veículos', '/#/veiculos']]],
              ['Legal', [['Termos de Uso', () => nav('/termos')], ['Privacidade', () => nav('/privacidade')]]],
              ['Contato', [['Tirar uma dúvida', abrirDuvida('duvida_landing')]]],
            ].map(([titulo, links]) => (
              <div key={titulo}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#475569', textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 12 }}>{titulo}</div>
                {links.map(([l, alvo]) => typeof alvo === 'string'
                  ? <a key={l} href={alvo} style={{ display: 'block', color: '#7c8ba1', fontSize: 13, marginBottom: 9, textDecoration: 'none' }}>{l}</a>
                  : <button key={l} onClick={alvo} style={{ display: 'block', background: 'none', border: 'none', color: '#7c8ba1', fontSize: 13, cursor: 'pointer', marginBottom: 9, padding: 0, textAlign: 'left' }}>{l}</button>)}
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 20, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 11.5, color: '#475569' }}>© {new Date().getFullYear()} Bid Pro Brasil. Todos os direitos reservados.</div>
            <div style={{ fontSize: 11.5, color: '#475569' }}>suporte@bidprobrasil.com.br</div>
          </div>
        </div>
      </footer>

      {/* ── MODAL: tirar uma dúvida (público) ── */}
      {dv.open && (
        <div onClick={() => setDv(d => ({ ...d, open: false }))}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,15,26,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 18, padding: '28px 26px', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
            {dv.ok ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
                <h3 style={{ fontSize: 19, fontWeight: 900, margin: '0 0 8px' }}>Dúvida recebida!</h3>
                <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: '0 0 20px' }}>
                  Nossa equipe vai responder no e-mail <b>{dv.email}</b>.
                </p>
                <button onClick={() => setDv(VAZIO)} style={{ padding: '11px 26px', background: AZUL, color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Fechar</button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <h3 style={{ fontSize: 19, fontWeight: 900, margin: 0 }}>Tirar uma dúvida</h3>
                  <button onClick={() => setDv(d => ({ ...d, open: false }))} style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
                <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 18px', lineHeight: 1.5 }}>
                  Responderemos por e-mail. Sem compromisso.
                </p>
                {['nome', 'email', 'tel'].map(campo => (
                  <input key={campo}
                    type={campo === 'email' ? 'email' : campo === 'tel' ? 'tel' : 'text'}
                    placeholder={campo === 'nome' ? 'Seu nome' : campo === 'email' ? 'Seu e-mail' : 'Telefone / WhatsApp'}
                    value={dv[campo]} onChange={e => setDv(d => ({ ...d, [campo]: e.target.value, erro: '' }))}
                    style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, color: '#111', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
                ))}
                <textarea placeholder="Escreva sua dúvida…" rows={4}
                  value={dv.msg} onChange={e => setDv(d => ({ ...d, msg: e.target.value, erro: '' }))}
                  style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, color: '#111', outline: 'none', marginBottom: 10, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
                {dv.erro && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, fontWeight: 600 }}>{dv.erro}</div>}
                <button onClick={enviarDuvida} disabled={dv.enviando}
                  style={{ width: '100%', padding: '13px', background: AZUL, color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 15, cursor: dv.enviando ? 'default' : 'pointer', opacity: dv.enviando ? 0.7 : 1 }}>
                  {dv.enviando ? 'Enviando…' : 'Enviar dúvida'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
