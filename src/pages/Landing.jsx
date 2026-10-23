import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Car, Home, Search, BarChart3, ShieldCheck, FileText, TrendingUp, Gavel,
  CheckCircle2, ArrowRight, ChevronDown, ChevronUp, Sparkles, BadgeCheck,
  GraduationCap, Calculator, MapPin, Smartphone, Users,
} from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';
import { registrarEvento } from '../utils/tracker';

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
// ─────────────────────────────────────────────────────────────────────────────────────────

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

// Exemplos de Bid Score (assinatura visual da marca — o "Serasa dos leilões").
const BID_EXEMPLOS = [
  { nota: '9,4', cor: '#10b981', bg: '#f0fdf4', t: 'Excelente oportunidade', d: 'Sem ônus relevantes na matrícula. Desconto de 38% sobre o mercado.' },
  { nota: '6,4', cor: '#f59e0b', bg: '#fffbeb', t: 'Boa, com atenção', d: 'Imóvel ocupado: prever custo e prazo de desocupação.' },
  { nota: '3,1', cor: '#ef4444', bg: '#fef2f2', t: 'Risco elevado', d: 'Três processos pendentes e penhora ativa. Recomendação: passar.' },
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

const FAQS = [
  { q: 'O que é o Bid Score?', r: 'É uma nota de 0 a 10 (🟢🟡🔴) que resume risco e oportunidade de cada lote, juntando análise jurídica, viabilidade financeira, ocupação e documentação. O relatório Mercadológico + Financeiro (grátis) gera a nota parcial; o Documental + Jurídico (Investidor Pro) completa o Bid Score.' },
  { q: 'Preciso ter experiência em leilões?', r: 'Não. A plataforma guia iniciantes e investidores experientes, e a formação da BidPro ensina o caminho completo. O plano Explorador é gratuito.' },
  { q: 'Como funciona a assessoria?', r: 'A equipe acompanha você do estudo do bem ao registro final: estratégia de lance, documentação, regularização e imissão de posse. Fale com um especialista para entender o seu caso.' },
  { q: 'Como funciona o leilão de veículos?', r: 'O leiloeiro só apresenta veículos que já estão no pátio dele — você não precisa fazer a retomada. Arrematou e pagou, retira ou contrata o frete; por isso dá para comprar de qualquer estado. Cada lote mostra a FIPE ao lado do lance mínimo.' },
  { q: 'A análise da IA substitui um advogado?', r: 'Não. A IA é o primeiro filtro: identifica riscos em minutos e mostra o que merece estudo mais profundo. Nos planos com assessoria, a análise jurídica é conduzida pela nossa equipe.' },
  { q: 'As análises por IA são ilimitadas?', r: 'Não. Cada análise consome dados pagos de fontes externas, então cada plano inclui uma quantidade de relatórios. Se uma fonte estiver instável, avisamos e liberamos o relatório assim que possível (em até 24 a 48h).' },
  { q: 'Posso cancelar quando quiser?', r: 'Sim. Os planos mensais não têm fidelidade nem multa.' },
  { q: 'Em quais lugares posso arrematar?', r: 'Em todo o Brasil. O leilão segue a legislação federal, igual em todos os estados, e já temos operações realizadas em 11 estados.' },
];

// "31.808" → "31 mil+": o número muda todo dia; arredondar para baixo nunca promete a mais.
const milMais = (n) => (n >= 1000 ? `${Math.floor(n / 1000)} mil+` : n > 0 ? `${n}` : null);
const centenaMais = (n) => (n >= 100 ? `${Math.floor(n / 100) * 100}+` : n > 0 ? `${n}` : null);

const AZUL = '#0D63DB';
const ESCURO = 'linear-gradient(135deg, #080f1a 0%, #0a1f3d 60%, #0d2a50 100%)';
const rotulo = (cor = AZUL) => ({ fontSize: 11, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 });
const h2 = (cor = '#0f172a') => ({ fontSize: 'clamp(26px,4vw,38px)', fontWeight: 900, color: cor, margin: '0 0 12px', lineHeight: 1.15, letterSpacing: '-0.5px' });

export default function Landing() {
  const nav = useNavigate();
  const mobile = useIsMobile();
  const [faqAberto, setFaqAberto] = useState(null);
  const [num, setNum] = useState(null);

  // Números do acervo (calculados 1x/dia — landing_numeros). Falhou → a faixa mostra só o que é fixo.
  useEffect(() => {
    let vivo = true;
    supabase.rpc('landing_numeros').then(({ data, error }) => {
      if (error) console.warn('[landing] números do acervo indisponíveis:', error.message);
      if (vivo && data && data.imoveis) setNum(data);
    });
    return () => { vivo = false; };
  }, []);

  // Avisa o banner "Instalar app" (PwaInstall) para só aparecer depois que a pessoa rolar.
  useEffect(() => {
    window.__tsnLanding = true; window.dispatchEvent(new Event('tsn:landing'));
    return () => { window.__tsnLanding = false; window.dispatchEvent(new Event('tsn:landing')); };
  }, []);

  // Medição da ordem: cada seção que entra na tela vira UM evento por visita.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const vistas = new Set();
    const obs = new IntersectionObserver((ents) => {
      for (const e of ents) {
        const id = e.target.getAttribute('data-lp-secao');
        if (e.isIntersecting && !vistas.has(id)) { vistas.add(id); registrarEvento('lp_secao', { alvo: id }); }
      }
    }, { threshold: 0.35 });
    document.querySelectorAll('[data-lp-secao]').forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const cta = (alvo, fn) => () => { registrarEvento('lp_cta', { alvo }); fn(); };
  const cadastro = (alvo) => cta(alvo, () => nav('/login?modo=cadastro'));

  // Dúvida / especialista (sem login): nome/email/telefone/mensagem → /api/duvida, que abre um chamado
  // no Atendimento e cria o lead. "Falar com um especialista" é o mesmo formulário com outra origem,
  // para a equipe comercial saber que é interesse em ASSESSORIA.
  const VAZIO = { open: false, origem: 'duvida_landing', nome: '', email: '', tel: '', msg: '', enviando: false, ok: false, erro: '' };
  const [dv, setDv] = useState(VAZIO);
  const abrirDuvida = (origem) => cta(origem, () => setDv({ ...VAZIO, open: true, origem }));
  const especialista = origemEhAssessoria(dv.origem);
  const enviarDuvida = async () => {
    if (dv.msg.trim().length < 5) { setDv(d => ({ ...d, erro: especialista ? 'Conte em poucas palavras o que você procura.' : 'Escreva sua dúvida.' })); return; }
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

  const PROVA = [
    { v: 'R$ 70M+', l: 'em arrematações assessoradas' },
    { v: '11', l: 'estados com operações realizadas' },
    { v: '8 anos', l: 'formando arrematadores' },
    num && milMais(num.imoveis) && milMais(num.veiculos)
      ? { v: `${milMais(num.imoveis)}`, l: `imóveis e ${milMais(num.veiculos)} veículos monitorados${centenaMais(num.leiloeiros) ? ` em ${centenaMais(num.leiloeiros)} leiloeiros` : ''}` }
      : { v: '< 5 min', l: 'para a análise completa' },
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
              <button onClick={abrirDuvida('assessoria_landing_topo')} style={btnSec()}><Users size={16} /> Falar com um especialista</button>
            </div>
            <p style={{ color: '#64748b', fontSize: 12.5, marginTop: 14 }}>Comece grátis · sem cartão de crédito</p>
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
              <div style={{ fontSize: 10.5, color: '#94a3b8', marginTop: 8, textAlign: 'center' }}>Exemplo ilustrativo de relatório</div>
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
              <div style={{ fontSize: 12, color: '#7c8ba1', marginTop: 4, lineHeight: 1.4 }}>{l}</div>
            </div>
          ))}
        </div>
      </section>

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
                botao: 'Falar com um especialista', acao: abrirDuvida('assessoria_landing_formas') },
              { icon: GraduationCap, cor: '#7c3aed', tag: 'Formação', titulo: 'Aprenda a arrematar', desc: 'O método de quem forma arrematadores há 8 anos.',
                itens: ['Cursos e e-books práticos', 'Aulas ao vivo com especialistas', 'Clube de negócios e comunidade', 'Do primeiro leilão ao portfólio'],
                botao: 'Ver cursos', acao: cta('formas_cursos', () => nav('/educacao')) },
            ].map(({ icon: Icon, cor, tag, titulo, desc, itens, botao, acao, destaque }) => (
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

      {/* ── 3. O PRODUTO FUNCIONANDO: as perguntas que travam + o Bid Score ──────── */}
      <section data-lp-secao="produto" style={{ ...secao(ESCURO), position: 'relative' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: duasColunas, gap: mobile ? 36 : 60, alignItems: 'center' }}>
          <div>
            <div style={rotulo('#34d399')}>Antes do lance</div>
            <h2 style={h2('white')}>Oportunidade nunca faltou. <span style={{ color: '#60a5fa' }}>Resposta, sim.</span></h2>
            <p style={{ color: '#94a3b8', fontSize: 15.5, lineHeight: 1.75, margin: '0 0 22px' }}>Quem desiste do leilão desiste porque não consegue responder a estas perguntas. A BidPro responde todas — e resume tudo numa nota de 0 a 10, como o Serasa dos leilões.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {PERGUNTAS.map(({ q, icon: Icon }) => (
                <div key={q} style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '11px 14px' }}>
                  <Icon size={17} color="#60a5fa" style={{ flexShrink: 0 }} />
                  <span style={{ fontSize: 14, color: '#e2e8f0', fontWeight: 600 }}>{q}</span>
                  <CheckCircle2 size={16} color="#34d399" style={{ marginLeft: 'auto', flexShrink: 0 }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginTop: 18 }}>
              <BadgeCheck size={20} color="#34d399" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 13.5, color: '#94a3b8', lineHeight: 1.6 }}><strong style={{ color: 'white' }}>IA + especialistas.</strong> A inteligência faz a maior parte da análise em minutos; nossos especialistas validam os casos críticos.</div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {BID_EXEMPLOS.map(({ nota, cor, bg, t, d }) => (
              <div key={nota} style={{ background: 'white', borderRadius: 16, padding: '16px 18px', display: 'flex', alignItems: 'center', gap: 16, boxShadow: '0 10px 30px rgba(0,0,0,0.3)' }}>
                <div style={{ width: 66, height: 66, borderRadius: 15, background: bg, border: `2px solid ${cor}`, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <div style={{ fontSize: 24, fontWeight: 900, color: cor, lineHeight: 1 }}>{nota}</div>
                  <div style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 800, marginTop: 2 }}>BID SCORE</div>
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: '#0f172a', marginBottom: 2 }}>{t}</div>
                  <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.5 }}>{d}</div>
                </div>
              </div>
            ))}
            <p style={{ color: '#64748b', fontSize: 12, textAlign: 'center', margin: '4px 0 0' }}>Exemplos ilustrativos. Cada lote recebe o seu Bid Score após a análise.</p>
          </div>
        </div>
      </section>

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

          <div style={{ marginTop: 56, background: '#f8fafc', borderRadius: 22, padding: mobile ? '28px 20px' : '36px 36px', display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'minmax(0, 0.9fr) minmax(0, 1.4fr)', gap: 28, alignItems: 'center', border: '1px solid #eef2f7' }}>
            <div>
              <div style={rotulo()}>Quem está do seu lado</div>
              <h3 style={{ fontSize: 'clamp(22px,3vw,28px)', fontWeight: 900, margin: '0 0 10px', lineHeight: 1.2 }}>8 anos formando arrematadores no Brasil</h3>
              <p style={{ fontSize: 14.5, color: '#64748b', lineHeight: 1.7, margin: '0 0 18px' }}>A BidPro nasceu da prática no mercado de leilões. A equipe reúne analistas, advogados de pós-arrematação e especialistas em formação.</p>
              <button onClick={abrirDuvida('assessoria_landing_equipe')} style={btnSec(false)}><Users size={16} /> Falar com um especialista</button>
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
          </div>
        </div>
      </section>

      {/* ── 6. PLANOS (sem preço: a fonte de verdade é a tela /planos) ───────────── */}
      <section data-lp-secao="planos" style={secao('#f8fafc')}>
        <div style={{ maxWidth: 1140, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={rotulo()}>Planos</div>
            <h2 style={h2()}>Comece grátis. Evolua no seu ritmo.</h2>
            <p style={{ color: '#64748b', fontSize: 15 }}>Preços e condições sempre atualizados na página de planos.</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: mobile ? 'minmax(0, 1fr)' : 'repeat(4, minmax(0, 1fr))', gap: 16 }}>
            {[
              { nome: 'Explorador', tag: 'Grátis', cor: '#64748b', itens: ['Busca de leilões em todo o Brasil', 'Relatório de mercado + viabilidade', 'Calculadora de arrematação', 'Cursos gratuitos'] },
              { nome: 'Investidor Pro', tag: 'Mais popular', cor: AZUL, destaque: true, itens: ['Tudo do Explorador', 'Relatório documental e jurídico por IA', 'Bid Score completo', 'Alertas de oportunidade por e-mail'] },
              { nome: 'Leilão de Veículos', tag: 'Novo', cor: '#0f766e', itens: ['Busca com FIPE em todo o Brasil', 'Leiloeiro e documentos de cada lote', 'Relatórios de veículos por IA', 'Combo com o Investidor Pro'] },
              { nome: 'Assessoria', tag: 'Por arrematação', cor: '#d97706', itens: ['Tudo do Investidor Pro', 'Analista dedicado', 'Do lance à imissão na posse', 'Registro via plataforma'] },
            ].map(({ nome, tag, cor, itens, destaque }) => (
              <div key={nome} style={{ background: 'white', borderRadius: 18, border: destaque ? `2px solid ${cor}` : '1px solid #e2e8f0', padding: '22px 20px', position: 'relative', boxShadow: destaque ? `0 10px 30px ${cor}22` : 'none' }}>
                <div style={{ fontSize: 12.5, fontWeight: 900, color: cor, textTransform: 'uppercase', letterSpacing: 1.3 }}>{nome}</div>
                <div style={{ fontSize: 12.5, color: '#94a3b8', fontWeight: 700, margin: '4px 0 14px' }}>{tag}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {itens.map(it => (
                    <div key={it} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <CheckCircle2 size={14} color={cor} style={{ flexShrink: 0, marginTop: 2 }} />
                      <span style={{ fontSize: 13, color: '#334155', lineHeight: 1.45 }}>{it}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <button onClick={cta('planos_ver', () => nav('/planos'))} style={btnPrim}>Ver planos e preços <ArrowRight size={16} /></button>
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
              { icon: MapPin, cor: AZUL, titulo: 'Preço do m² na sua região', desc: 'Venda e locação por cidade e bairro.', acao: cadastro('ferramenta_indice') },
              { icon: Smartphone, cor: '#7c3aed', titulo: 'App BidPro', desc: 'Alertas de oportunidades no celular.', acao: cta('ferramenta_app', () => window.dispatchEvent(new Event('tsn:pwa-install'))) },
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
          <p style={{ color: '#94a3b8', fontSize: 16, lineHeight: 1.7, margin: '0 0 30px' }}>Crie sua conta grátis e analise suas primeiras oportunidades hoje — ou fale com a nossa equipe e arremate com quem já fez R$ 70 milhões em arrematações.</p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={cadastro('final_cadastro')} style={btnPrim}>Criar minha conta grátis <ArrowRight size={18} /></button>
            <button onClick={abrirDuvida('assessoria_landing_final')} style={btnSec()}><Users size={16} /> Falar com um especialista</button>
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
              ['Contato', [['Falar com um especialista', abrirDuvida('assessoria_landing_rodape')], ['Tirar uma dúvida', abrirDuvida('duvida_landing')]]],
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

      {/* ── MODAL: dúvida / falar com especialista (público) ── */}
      {dv.open && (
        <div onClick={() => setDv(d => ({ ...d, open: false }))}
          style={{ position: 'fixed', inset: 0, background: 'rgba(8,15,26,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, zIndex: 1000 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: 'white', borderRadius: 18, padding: '28px 26px', width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
            {dv.ok ? (
              <div style={{ textAlign: 'center', padding: '8px 0' }}>
                <div style={{ fontSize: 44, marginBottom: 10 }}>✅</div>
                <h3 style={{ fontSize: 19, fontWeight: 900, margin: '0 0 8px' }}>{especialista ? 'Recebemos seu contato!' : 'Dúvida recebida!'}</h3>
                <p style={{ fontSize: 14, color: '#64748b', lineHeight: 1.6, margin: '0 0 20px' }}>
                  {especialista ? 'Um especialista da nossa equipe vai falar com você' : 'Nossa equipe vai responder'} no e-mail <b>{dv.email}</b>{dv.tel && especialista ? ' ou pelo telefone informado' : ''}.
                </p>
                <button onClick={() => setDv(VAZIO)} style={{ padding: '11px 26px', background: AZUL, color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>Fechar</button>
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <h3 style={{ fontSize: 19, fontWeight: 900, margin: 0 }}>{especialista ? 'Falar com um especialista' : 'Tirar uma dúvida'}</h3>
                  <button onClick={() => setDv(d => ({ ...d, open: false }))} style={{ background: 'none', border: 'none', fontSize: 22, color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>×</button>
                </div>
                <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 18px', lineHeight: 1.5 }}>
                  {especialista ? 'Conte o que você procura — imóvel, veículo, assessoria ou cursos. Respondemos rápido, sem compromisso.' : 'Responderemos por e-mail. Sem compromisso.'}
                </p>
                {['nome', 'email', 'tel'].map(campo => (
                  <input key={campo}
                    type={campo === 'email' ? 'email' : campo === 'tel' ? 'tel' : 'text'}
                    placeholder={campo === 'nome' ? 'Seu nome' : campo === 'email' ? 'Seu e-mail' : 'Telefone / WhatsApp'}
                    value={dv[campo]} onChange={e => setDv(d => ({ ...d, [campo]: e.target.value, erro: '' }))}
                    style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, color: '#111', outline: 'none', marginBottom: 10, boxSizing: 'border-box' }} />
                ))}
                <textarea placeholder={especialista ? 'Ex.: quero arrematar um apartamento em Campinas até R$ 400 mil' : 'Escreva sua dúvida…'} rows={4}
                  value={dv.msg} onChange={e => setDv(d => ({ ...d, msg: e.target.value, erro: '' }))}
                  style={{ width: '100%', padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 10, fontSize: 14, color: '#111', outline: 'none', marginBottom: 10, boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }} />
                {dv.erro && <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 10, fontWeight: 600 }}>{dv.erro}</div>}
                <button onClick={enviarDuvida} disabled={dv.enviando}
                  style={{ width: '100%', padding: '13px', background: especialista ? '#d97706' : AZUL, color: 'white', border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 15, cursor: dv.enviando ? 'default' : 'pointer', opacity: dv.enviando ? 0.7 : 1 }}>
                  {dv.enviando ? 'Enviando…' : especialista ? 'Quero falar com um especialista' : 'Enviar dúvida'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function origemEhAssessoria(origem) { return String(origem || '').startsWith('assessoria_'); }
