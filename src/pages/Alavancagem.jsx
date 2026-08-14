import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Users, TrendingUp, Check, AlertTriangle, ArrowRight, X, Clock, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

/**
 * /alavancagem — tela ÚNICA apresentando Home Equity e Consórcio (pedido do dono, 14/08).
 *
 * O QUE ESTA TELA É: material explicativo + sinalização de interesse. **Não é ficha de
 * proposta, não aprova nada e não simula contratação.** Os dois botões abrem o mesmo
 * formulário curto, que grava o interesse e abre um chamado para a equipe entrar em contato
 * — reaproveitando `/api/duvida`, que já registra lead em `sdr_leads` + chamado no
 * Atendimento. Sem tabela nova, sem endpoint novo.
 *
 * POR QUE OS NÚMEROS SÃO ILUSTRATIVOS E ESTÃO MARCADOS COMO TAIS: taxa, prazo e percentual
 * de crédito variam por instituição e por análise. Publicar um número com cara de proposta
 * seria exatamente o defeito que este projeto cataloga — resposta plausível apresentada como
 * certa. Cada exemplo diz de onde saiu e que não é oferta.
 *
 * ENQUADRAMENTO: a BidPro NÃO é instituição financeira nem administradora de consórcio. A
 * operação é da instituição parceira; nós apresentamos e encaminhamos. Isso está escrito na
 * tela, não só aqui — é a regra de conduta do correspondente.
 */

const AZUL = '#0D63DB';
const AZUL_ESCURO = '#0B4BA6';

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const MODALIDADES = {
  home_equity: {
    id: 'home_equity',
    nome: 'Home Equity',
    subtitulo: 'Crédito com garantia de imóvel',
    icone: Home,
    resumo: 'Você usa um imóvel que já é seu e está quitado como garantia e recebe dinheiro em conta. Como a garantia é forte, o juro é um dos menores do mercado — bem abaixo de cartão, cheque especial e empréstimo pessoal.',
    passos: [
      'A instituição avalia o seu imóvel.',
      'Libera crédito de uma parte do valor avaliado (costuma ficar entre 50% e 60%).',
      'O imóvel é dado em garantia (alienação fiduciária) e registrado em cartório.',
      'O dinheiro cai na conta — normalmente entre 30 e 45 dias.',
      'Você continua morando nele ou alugando normalmente.',
    ],
    exemplo: {
      titulo: 'Exemplo ilustrativo',
      linhas: [
        ['Imóvel quitado avaliado em', brl(500000)],
        ['Crédito liberado (50%)', brl(250000)],
        ['Prazo', '180 meses'],
        ['Parcela inicial aproximada', `${brl(3300)}/mês`],
      ],
      nota: 'Cálculo com taxa de 1,15% a.m. mais correção — parâmetro de mercado usado só para dar ordem de grandeza. A taxa real depende da instituição e da análise.',
    },
    paraQuem: 'Quem já tem imóvel quitado e precisa de capital agora — para arrematar, reformar para revenda, ou trocar uma dívida cara por uma barata.',
    atencao: [
      'O imóvel fica em garantia: deixar de pagar pode levar à perda dele.',
      'Não é imediato — entre proposta e dinheiro em conta costumam ser 30 a 45 dias.',
      'Há custos de avaliação e de registro em cartório.',
    ],
    cta: 'Quero saber sobre Home Equity',
  },
  consorcio: {
    id: 'consorcio',
    nome: 'Consórcio',
    subtitulo: 'Compra programada, sem juros',
    icone: Users,
    resumo: 'Um grupo de pessoas se junta para comprar imóveis. Não há juros: o custo é a taxa de administração. A cada mês alguém é contemplado, por sorteio ou por lance, e recebe uma carta de crédito para comprar à vista.',
    passos: [
      'Você escolhe o valor da carta de crédito e o prazo.',
      'Paga as parcelas mensais junto com o grupo.',
      'É contemplado por sorteio ou antecipa dando um lance.',
      'Recebe a carta e compra o imóvel — para o vendedor, é pagamento à vista.',
      'Segue pagando as parcelas restantes.',
    ],
    exemplo: {
      titulo: 'Exemplo ilustrativo',
      linhas: [
        ['Carta de crédito', brl(300000)],
        ['Prazo', '200 meses'],
        ['Taxa de administração + fundo de reserva', '20% + 2%'],
        ['Parcela aproximada', `${brl(1830)}/mês`],
      ],
      nota: 'Taxa de administração é o custo do consórcio e varia bastante por administradora. Aqui usamos 20% + 2% só para mostrar como a conta funciona.',
    },
    paraQuem: 'Quem não precisa do dinheiro agora e quer se preparar para a próxima compra pagando parcela menor — ou quem quer poder de compra à vista no futuro.',
    atencao: [
      'Não existe data garantida de contemplação: pode vir cedo por lance ou demorar por sorteio.',
      'A taxa de administração é o custo — não há juros, mas não é de graça.',
      'Desistir no meio tem regras próprias e costuma devolver o dinheiro só ao fim do grupo.',
    ],
    cta: 'Quero saber sobre Consórcio',
  },
};

const COMPARACAO = [
  ['Quando o dinheiro chega', 'Em 30 a 45 dias, com data previsível', 'Quando você for contemplado — por sorteio ou lance'],
  ['Qual é o custo', 'Juros mais correção monetária', 'Taxa de administração (não há juros)'],
  ['Exige imóvel quitado?', 'Sim — ele é a garantia', 'Não'],
  ['O que fica em garantia', 'O imóvel que você já tem', 'O imóvel que você vai comprar'],
  ['Serve melhor para', 'Uma oportunidade que está na sua frente agora', 'Planejar a próxima compra com parcela menor'],
];

export default function Alavancagem() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [aberto, setAberto] = useState(null); // id da modalidade no formulário

  return (
    <div style={{ background: '#f1f5f9', minHeight: '100dvh' }}>
      {/* ===== TOPO ===== */}
      <section style={{ background: `linear-gradient(135deg, ${AZUL} 0%, ${AZUL_ESCURO} 100%)`, color: 'white', padding: '48px 20px 56px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.14)', padding: '6px 14px', borderRadius: 999, fontSize: 12, fontWeight: 800, letterSpacing: 0.4, marginBottom: 18 }}>
            <TrendingUp size={14} /> ALAVANCAGEM PATRIMONIAL
          </div>
          <h1 style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 900, lineHeight: 1.1, margin: 0, letterSpacing: -0.5 }}>
            Use o imóvel que você já tem<br />para comprar o próximo
          </h1>
          <p style={{ fontSize: 'clamp(15px, 2.2vw, 18px)', lineHeight: 1.6, marginTop: 18, marginBottom: 0, color: '#dbeafe', maxWidth: 680 }}>
            Duas formas de destravar capital sem vender o seu patrimônio. Uma entrega o dinheiro
            em semanas; a outra prepara a compra com parcela menor. Nesta página você entende
            cada uma, vê um exemplo com números e escolhe qual quer conversar com a nossa equipe.
          </p>
        </div>
      </section>

      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 20px 56px' }}>
        {/* ===== OS DOIS CARDS ===== */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20, marginTop: -28 }}>
          {Object.values(MODALIDADES).map((m) => {
            const Icone = m.icone;
            return (
              <div key={m.id} style={{ background: 'white', borderRadius: 16, padding: 24, boxShadow: '0 6px 24px rgba(15,23,42,0.10)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: AZUL, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icone size={22} color="white" strokeWidth={2.2} />
                  </div>
                  <div>
                    <h2 style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 24, fontWeight: 900, margin: 0, color: '#111', lineHeight: 1.1 }}>{m.nome}</h2>
                    <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600, marginTop: 2 }}>{m.subtitulo}</div>
                  </div>
                </div>

                <p style={{ fontSize: 14.5, lineHeight: 1.65, color: '#334155', margin: '0 0 20px' }}>{m.resumo}</p>

                <div style={{ fontSize: 12, fontWeight: 800, color: '#94a3b8', letterSpacing: 0.6, marginBottom: 10 }}>COMO FUNCIONA</div>
                <ol style={{ margin: '0 0 20px', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9 }}>
                  {m.passos.map((p, i) => (
                    <li key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <span style={{ width: 20, height: 20, borderRadius: '50%', background: '#eff6ff', color: AZUL, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
                      <span style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.55 }}>{p}</span>
                    </li>
                  ))}
                </ol>

                {/* Exemplo com números — sempre rotulado como ilustrativo */}
                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: AZUL, letterSpacing: 0.5, marginBottom: 12 }}>{m.exemplo.titulo.toUpperCase()}</div>
                  {m.exemplo.linhas.map(([rot, val], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: i < m.exemplo.linhas.length - 1 ? '1px dashed #e2e8f0' : 'none' }}>
                      <span style={{ fontSize: 13, color: '#64748b' }}>{rot}</span>
                      <span style={{ fontSize: 13.5, color: '#111', fontWeight: 800, textAlign: 'right' }}>{val}</span>
                    </div>
                  ))}
                  <p style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5, margin: '12px 0 0' }}>{m.exemplo.nota}</p>
                </div>

                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
                  <Check size={16} color="#16a34a" strokeWidth={3} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.6 }}><strong>Para quem serve:</strong> {m.paraQuem}</span>
                </div>

                <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 14, marginBottom: 20 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <AlertTriangle size={14} color="#b45309" />
                    <span style={{ fontSize: 12, fontWeight: 800, color: '#b45309', letterSpacing: 0.3 }}>PONTOS DE ATENÇÃO</span>
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {m.atencao.map((a, i) => <li key={i} style={{ fontSize: 12.5, color: '#78350f', lineHeight: 1.55 }}>{a}</li>)}
                  </ul>
                </div>

                <button onClick={() => setAberto(m.id)}
                  style={{ marginTop: 'auto', width: '100%', padding: '14px 18px', border: 'none', borderRadius: 12, background: AZUL, color: 'white', fontSize: 15, fontWeight: 800, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  {m.cta} <ArrowRight size={17} />
                </button>
                <div style={{ fontSize: 11.5, color: '#94a3b8', textAlign: 'center', marginTop: 8 }}>
                  Sem compromisso — alguém da equipe entra em contato para explicar.
                </div>
              </div>
            );
          })}
        </div>

        {/* ===== COMPARAÇÃO ===== */}
        <section style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 24, marginTop: 28 }}>
          <h2 style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 24, fontWeight: 900, margin: '0 0 6px', color: '#111' }}>Qual dos dois serve para o seu caso</h2>
          <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 20px', lineHeight: 1.6 }}>
            Não são concorrentes — resolvem problemas diferentes. A pergunta que separa os dois é
            simples: <strong>você precisa do dinheiro agora ou está se preparando?</strong>
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 12, fontWeight: 800, color: '#94a3b8', letterSpacing: 0.4, borderBottom: '2px solid #e2e8f0' }}></th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 900, color: AZUL, borderBottom: `2px solid ${AZUL}` }}>Home Equity</th>
                  <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 900, color: '#111', borderBottom: '2px solid #e2e8f0' }}>Consórcio</th>
                </tr>
              </thead>
              <tbody>
                {COMPARACAO.map(([rot, he, cs], i) => (
                  <tr key={i}>
                    <td style={{ padding: '12px', fontSize: 13, fontWeight: 700, color: '#475569', borderBottom: '1px solid #f1f5f9' }}>{rot}</td>
                    <td style={{ padding: '12px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9', lineHeight: 1.5 }}>{he}</td>
                    <td style={{ padding: '12px', fontSize: 13, color: '#334155', borderBottom: '1px solid #f1f5f9', lineHeight: 1.5 }}>{cs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ===== ALAVANCAGEM EM LEILÃO ===== */}
        <section style={{ background: '#111', color: 'white', borderRadius: 16, padding: 28, marginTop: 28 }}>
          <h2 style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 24, fontWeight: 900, margin: '0 0 8px' }}>Como isso vira alavancagem em leilão</h2>
          <p style={{ fontSize: 14.5, color: '#cbd5e1', margin: '0 0 22px', lineHeight: 1.65, maxWidth: 720 }}>
            Leilão tem uma característica que muda tudo: <strong style={{ color: 'white' }}>o pagamento
            é à vista e o prazo é curto</strong>. Quem tem o dinheiro disponível na hora certa compra
            melhor. É exatamente esse o problema que as duas modalidades resolvem.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {[
              { icone: Clock, t: 'Capital pronto para o arremate', d: 'O Home Equity transforma um imóvel parado em dinheiro em conta. Com o crédito aprovado antes da praça, você disputa sabendo até onde pode ir.' },
              { icone: Users, t: 'Carta contemplada como pagamento à vista', d: 'A carta do consórcio é poder de compra à vista — que é justamente o que o leilão exige. Serve para quem está montando a próxima compra com parcela menor.' },
              { icone: TrendingUp, t: 'Girar o mesmo capital', d: 'Arrematar com deságio, revender ou alugar, quitar e repetir. É assim que um patrimônio parado vira uma operação que se paga.' },
            ].map((c, i) => {
              const Ic = c.icone;
              return (
                <div key={i} style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 12, padding: 18 }}>
                  <Ic size={20} color="#60a5fa" strokeWidth={2.2} />
                  <div style={{ fontSize: 15, fontWeight: 800, margin: '10px 0 7px' }}>{c.t}</div>
                  <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>{c.d}</div>
                </div>
              );
            })}
          </div>
          <div style={{ background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.30)', borderRadius: 10, padding: 16, marginTop: 20, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <AlertTriangle size={16} color="#fbbf24" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 13, color: '#fde68a', lineHeight: 1.6 }}>
              <strong>Alavancagem multiplica os dois lados.</strong> Se o imóvel não vender no prazo
              que você imaginou, a parcela continua chegando do mesmo jeito. Conte com um prazo de
              venda maior que o previsto e com um caixa que aguente esse tempo — é a diferença
              entre alavancar e se expor.
            </div>
          </div>
        </section>

        {/* ===== BOTÕES FINAIS ===== */}
        <section style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 28, marginTop: 28, textAlign: 'center' }}>
          <h2 style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 24, fontWeight: 900, margin: '0 0 8px', color: '#111' }}>Quer entender qual faz sentido no seu caso?</h2>
          <p style={{ fontSize: 14.5, color: '#64748b', margin: '0 auto 22px', lineHeight: 1.6, maxWidth: 560 }}>
            Sinalize seu interesse e alguém da equipe entra em contato para explicar, sem
            compromisso. Nada é contratado por aqui.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            {Object.values(MODALIDADES).map((m) => (
              <button key={m.id} onClick={() => setAberto(m.id)}
                style={{ padding: '14px 22px', border: m.id === 'consorcio' ? '2px solid #cbd5e1' : 'none', borderRadius: 12, background: m.id === 'consorcio' ? 'white' : AZUL, color: m.id === 'consorcio' ? '#111' : 'white', fontSize: 15, fontWeight: 800, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {m.cta} <ArrowRight size={17} />
              </button>
            ))}
          </div>
        </section>

        {/* ===== RODAPÉ LEGAL ===== */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 24, padding: '16px 18px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12 }}>
          <Shield size={16} color="#94a3b8" style={{ flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 12, color: '#64748b', lineHeight: 1.65, margin: 0 }}>
            A <strong>BidPro Brasil não é instituição financeira e não administra consórcio</strong>:
            não concede crédito, não aprova propostas e não emite cartas. As operações são
            realizadas por instituições parceiras autorizadas, e toda contratação depende de
            análise e aprovação delas. Os valores desta página são <strong>exemplos
            ilustrativos</strong> para explicar como cada modalidade funciona — não são oferta,
            proposta ou garantia de condição. Taxas, prazos e percentuais variam por instituição
            e por análise de cada caso.
          </p>
        </div>

        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button onClick={() => nav('/')} style={{ background: 'none', border: 'none', color: AZUL, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            ← Voltar para os leilões
          </button>
        </div>
      </div>

      {aberto && <FormularioInteresse modalidade={MODALIDADES[aberto]} emailPadrao={user?.email || ''} onFechar={() => setAberto(null)} />}
    </div>
  );
}

/**
 * Formulário de INTERESSE — não é proposta. Envia para `/api/duvida`, que registra o lead em
 * `sdr_leads` e abre um chamado no Atendimento, com a `origem` identificando a modalidade.
 */
function FormularioInteresse({ modalidade, emailPadrao, onFechar }) {
  const [f, setF] = useState({ nome: '', email: emailPadrao, tel: '', valor: '', obs: '' });
  const [estado, setEstado] = useState({ enviando: false, ok: false, erro: '' });

  const enviar = async () => {
    setEstado({ enviando: true, ok: false, erro: '' });
    const mensagem = [
      `Interesse em ${modalidade.nome} (${modalidade.subtitulo}).`,
      f.valor ? `Valor pretendido: ${f.valor}` : null,
      f.obs ? `Observação: ${f.obs}` : null,
      'Enviado pela tela de Alavancagem.',
    ].filter(Boolean).join('\n');
    try {
      const r = await fetch('/api/duvida', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: f.nome, email: f.email, telefone: f.tel, mensagem, origem: `alavancagem_${modalidade.id}` }),
      });
      // `.ok` conferido ANTES do corpo: 400/500 com JSON de erro viraria "enviado" silencioso.
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível enviar agora. Tente novamente.');
      setEstado({ enviando: false, ok: true, erro: '' });
    } catch (e) {
      setEstado({ enviando: false, ok: false, erro: e.message });
    }
  };

  const podeEnviar = f.nome.trim().length >= 2 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim()) && !estado.enviando;
  const campo = { width: '100%', padding: '12px 14px', borderRadius: 10, border: '1px solid #cbd5e1', fontSize: 15, fontFamily: 'inherit', color: '#111', background: 'white', boxSizing: 'border-box' };
  const rotulo = { fontSize: 12.5, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 6 };

  return (
    <div onClick={onFechar} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 16, padding: 24, width: '100%', maxWidth: 460, maxHeight: '92dvh', overflowY: 'auto', boxShadow: '0 20px 50px rgba(15,23,42,0.30)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 6 }}>
          <h3 style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 21, fontWeight: 900, margin: 0, color: '#111', lineHeight: 1.15 }}>
            {estado.ok ? 'Interesse registrado' : `Tenho interesse em ${modalidade.nome}`}
          </h3>
          <button onClick={onFechar} aria-label="Fechar" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0, lineHeight: 0, flexShrink: 0 }}>
            <X size={22} />
          </button>
        </div>

        {estado.ok ? (
          <>
            <p style={{ fontSize: 14.5, color: '#334155', lineHeight: 1.65, margin: '10px 0 20px' }}>
              Recebemos. Alguém da equipe vai entrar em contato para explicar como funciona e
              entender o seu caso. <strong>Nada foi contratado</strong> e não há compromisso.
            </p>
            <button onClick={onFechar} style={{ width: '100%', padding: '13px', border: 'none', borderRadius: 11, background: AZUL, color: 'white', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
              Fechar
            </button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13.5, color: '#64748b', lineHeight: 1.6, margin: '8px 0 20px' }}>
              Isto <strong>não é uma proposta</strong> e não inicia contratação: é só um aviso de
              que você quer conversar. Alguém da equipe entra em contato.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={rotulo}>Nome</label>
                <input style={campo} value={f.nome} onChange={(e) => setF({ ...f, nome: e.target.value })} placeholder="Seu nome completo" autoComplete="name" />
              </div>
              <div>
                <label style={rotulo}>E-mail</label>
                <input style={campo} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="voce@email.com" autoComplete="email" />
              </div>
              <div>
                <label style={rotulo}>WhatsApp <span style={{ color: '#94a3b8', fontWeight: 500 }}>(opcional)</span></label>
                <input style={campo} type="tel" value={f.tel} onChange={(e) => setF({ ...f, tel: e.target.value })} placeholder="(11) 90000-0000" autoComplete="tel" />
              </div>
              <div>
                <label style={rotulo}>Valor que você tem em mente <span style={{ color: '#94a3b8', fontWeight: 500 }}>(opcional)</span></label>
                <input style={campo} value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value })} placeholder="Ex.: R$ 250.000" />
              </div>
              <div>
                <label style={rotulo}>Quer contar alguma coisa? <span style={{ color: '#94a3b8', fontWeight: 500 }}>(opcional)</span></label>
                <textarea style={{ ...campo, minHeight: 76, resize: 'vertical' }} value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} placeholder="Ex.: tenho um imóvel quitado em Cotia e quero arrematar outro" />
              </div>
            </div>

            {estado.erro && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', borderRadius: 10, padding: 12, fontSize: 13, marginTop: 14, lineHeight: 1.5 }}>
                {estado.erro}
              </div>
            )}

            <button onClick={enviar} disabled={!podeEnviar}
              style={{ width: '100%', marginTop: 18, padding: '14px', border: 'none', borderRadius: 11, background: podeEnviar ? AZUL : '#cbd5e1', color: 'white', fontSize: 15, fontWeight: 800, cursor: podeEnviar ? 'pointer' : 'not-allowed' }}>
              {estado.enviando ? 'Enviando…' : 'Quero que entrem em contato'}
            </button>
            <p style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.55, margin: '12px 0 0', textAlign: 'center' }}>
              Usamos seus dados apenas para este contato. A operação, se houver, é feita por
              instituição parceira e depende de análise dela.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
