import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { lerMarketing, metaTrack, openaiTrack } from '../utils/marketing';
import { lerRef } from '../utils/ref';
import ConvideAmigo from '../components/ConvideAmigo';
import { validarNome } from '../lib/nome';
import { validarTelefone, limparTelefone, formatarTelefone } from '../lib/telefone';
import CidadeAutocomplete from '../components/CidadeAutocomplete';
import { NAVY, LATAO, AZUL } from '../utils/marca';

// Sora: display com caráter, sem cair no Inter/Space Grotesk que toda landing usa.
const FONTE = "'Sora', system-ui, -apple-system, sans-serif";

// PADRÃO, não fonte única. O número que vale é o do evento (eventos_live.whatsapp_direto),
// devolvido pela inscrição: variável VITE_ é compilada no bundle, então trocar o número
// exigiria um deploy novo — numa página de campanha isso é número errado no ar. A env var
// segue valendo para eventos sem número próprio (e é a mesma que o chat de suporte usa).
const WHATSAPP_PADRAO = String(import.meta.env.VITE_WHATSAPP_NUMERO || '').replace(/\D/g, '');

// Cookie `_fbp`, escrito pelo próprio Meta Pixel. Vai junto da inscrição para o Lead do
// servidor poder casar o mesmo navegador — sem ele o evento chega, mas casa com menos gente.
function lerFbp() {
  try {
    if (typeof document === 'undefined') return null;
    const m = document.cookie.match(/(?:^|;\s*)_fbp=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

/**
 * /live/:slug — landing de inscrição da aula ao vivo.
 *
 * Página PÚBLICA e de campanha: o único trabalho dela é transformar visita em inscrito.
 * Por isso o formulário fica acima da dobra, pede três campos e nada mais, e não há menu
 * nem link para sair — cada saída daqui é um inscrito a menos.
 *
 * A confirmação acontece NESTA tela (não redireciona): é ali que entra o grupo de
 * WhatsApp, que é onde o lançamento realmente acontece.
 */

function useContagem(alvo) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    // Um tique por segundo. `alvo` no passado para o relógio: evento que já começou não
    // precisa de contagem, e deixar o intervalo rodando à toa gasta bateria no celular.
    const t = alvo ? new Date(alvo).getTime() : 0;
    if (!t || t <= Date.now()) return undefined;
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [alvo]);
  return useMemo(() => {
    const t = alvo ? new Date(alvo).getTime() : 0;
    const resta = t - agora;
    if (!t) return null;
    if (resta <= 0) return { comecou: true };
    const s = Math.floor(resta / 1000);
    return {
      comecou: false,
      dias: Math.floor(s / 86400),
      horas: Math.floor((s % 86400) / 3600),
      min: Math.floor((s % 3600) / 60),
      seg: s % 60,
    };
  }, [alvo, agora]);
}



export default function LiveInscricao() {
  const { slug } = useParams();
  const [evento, setEvento] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState(false);
  const [inscritos, setInscritos] = useState(null);
  const [form, setForm] = useState({ nome: '', email: '', whatsapp: '', cidade: '', uf: '' });
  // null = ainda carregando a base do IBGE; 0 = a base NÃO veio. Só no segundo caso o
  // campo de UF reaparece — sem ele, quem se inscreve com o IBGE fora ficaria sem estado
  // e cairia fora de todos os filtros de proximidade, calado.
  const [cidadesCarregadas, setCidadesCarregadas] = useState(null);
  const [numeros, setNumeros] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      // O `error` é checado: numa página de campanha, "evento não encontrado" impresso por
      // causa de falha de rede manda embora quem clicou no anúncio — e o clique já foi pago.
      // `live_proxima` em vez da tabela: ela resolve a recorrência e devolve a data da
      // PRÓXIMA aula. Assim o link da campanha (bio, anúncio, ManyChat) nunca precisa mudar
      // — e link que muda é link que uma hora aponta para página morta com anúncio pago rodando.
      const { data, error } = await supabase.rpc('live_proxima', { p_slug: slug });
      if (cancelado) return;
      if (error) setErroCarga(true);
      setEvento(data || null);
      setCarregando(false);
      if (data) {
        const { data: n } = await supabase.rpc('live_inscritos', { p_slug: slug }); // padrao-ok: prova social opcional — sem o número a página funciona igual
        if (!cancelado) setInscritos(typeof n === 'number' ? n : null);
        // Números do acervo, vivos. Se não vierem, a faixa some — número de credencial
        // é o tipo de coisa que não pode aparecer errado nem por um dia.
        const { data: num } = await supabase.rpc('live_plataforma_numeros'); // padrao-ok: faixa de credencial opcional — sem os números a página funciona igual
        if (!cancelado) setNumeros(num && num.lotes ? num : null);
      }
    })();
    return () => { cancelado = true; };
  }, [slug]);

  const contagem = useContagem(evento?.data_hora);

  async function inscrever(e) {
    e.preventDefault();
    setErro('');
    // MESMA RÉGUA DO CADASTRO, e de propósito (27/08). Aqui não é rigor por rigor: o nome
    // vai para o contrato e para a conta que nasce nesta inscrição, e o WhatsApp é por onde
    // sai o link da sala. `validarNome` já exige nome + sobrenome; `validarTelefone` já
    // recusa dígito a menos ou a mais. Reusar as duas em vez de escrever régua nova é o que
    // impede a landing de virar a porta dos fundos por onde entra o dado que o resto do
    // sistema recusa — foi assim que a inscrição de teste do dono gravou "tarcisio" sozinho.
    const vn = validarNome(form.nome);
    if (!vn.ok) return setErro(vn.erro);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setErro('Informe um e-mail válido.');
    if (!limparTelefone(form.whatsapp)) return setErro('Informe o seu WhatsApp com DDD.');
    const vt = validarTelefone(form.whatsapp);
    if (!vt.ok) return setErro(vt.erro);
    if (form.cidade.trim().length < 2) return setErro('Informe a sua cidade.');
    setEnviando(true);
    try {
      const mkt = lerMarketing() || {};
      const r = await fetch('/api/live-inscrever', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // `_fbp` só existe no navegador (é cookie que o próprio Pixel escreve) e é um dos
        // campos que mais levantam a correspondência do Lead no Meta. O servidor não tem como
        // obtê-lo sozinho, então ele viaja junto da inscrição.
        // `ref`: o código do parceiro que divulgou a aula. Vem do localStorage (janela de 30
        // dias, gravada pelo AuthContext em qualquer ponto de entrada), e não da URL — assim
        // vale mesmo se a pessoa abriu o link do parceiro, saiu e voltou depois para se
        // inscrever. Quem resolve o código e grava o vínculo é o servidor, na criação da conta.
        body: JSON.stringify({ slug, ...form, utm: mkt, fbp: lerFbp(), ref: lerRef() || null }),
      });
      const j = await r.json().catch(() => ({}));
      // `.ok` checado ANTES de comemorar: dizer "inscrito" sobre uma resposta de erro é
      // prometer uma vaga que não existe, e isso só aparece no dia da aula.
      if (!r.ok || j?.error) throw new Error(j?.error || 'Não foi possível concluir a inscrição.');
      setPronto(j);
      setInscritos(n => (typeof n === 'number' ? n + 1 : n));
      // ── Meta: Lead do NAVEGADOR ────────────────────────────────────────────
      // Só DEPOIS do `.ok` — o evento descreve uma inscrição que existe, não uma tentativa.
      // O `event_id` vem do SERVIDOR (`lead_event_id`): os dois lados mandam o mesmo id e o
      // Meta conta UMA conversão. É o par do envio via Conversions API, que é o que continua
      // chegando quando bloqueador de anúncio, iOS ou aba fechada matam este beacon.
      // `metaTrack` é no-op enquanto o pixel não estiver ligado, e o try/catch garante que
      // marketing jamais derrube a confirmação de vaga que a pessoa está vendo na tela.
      try {
        metaTrack('Lead', { content_name: slug, content_category: 'aula_ao_vivo', currency: 'BRL', value: 0 }, j?.lead_event_id);
        // OpenAI Ads (ChatGPT Ads): a MESMA inscrição, no mesmo instante e sob a mesma
        // condição do `.ok`. É este evento que permite sair do CPC e usar oCPC — sem ele o
        // leilão do canal só sabe otimizar por clique, que é comprar curioso.
        openaiTrack('lead_created', { type: 'customer_action' });
      } catch { /* nunca quebra a inscrição */ }
    } catch (err) {
      setErro(err?.message || 'Não foi possível concluir a inscrição.');
    }
    setEnviando(false);
  }

  if (carregando) {
    return <div style={{ minHeight: '100vh', background: NAVY, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 14 }}>Carregando…</div>;
  }

  if (!evento) {
    return (
      <div style={{ minHeight: '100vh', background: NAVY, color: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 42, marginBottom: 14 }}>{erroCarga ? '⚠️' : '📅'}</div>
          <h1 style={{ fontSize: 22, margin: '0 0 10px' }}>
            {erroCarga ? 'Não conseguimos carregar esta página' : 'Esta aula não está com inscrições abertas'}
          </h1>
          <p style={{ fontSize: 14.5, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 20px' }}>
            {erroCarga
              ? 'Foi uma falha momentânea de conexão nossa — a aula continua de pé.'
              : 'Acompanhe o Instagram da BidPro Brasil para saber da próxima.'}
          </p>
          {erroCarga && (
            <button onClick={() => window.location.reload()}
              style={{ padding: '12px 24px', background: LATAO, color: NAVY, border: 'none', borderRadius: 10, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
              Tentar de novo
            </button>
          )}
        </div>
      </div>
    );
  }

  // Acento da marca, não do cadastro do evento — mesma decisão de 26/08.
  const cor = LATAO;
  const quando = new Date(evento.data_hora).toLocaleString('pt-BR', {
    timeZone: 'America/Bahia', weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
  });

  // "até quarta" em vez de "até dia 2": quem se inscreve pensa no dia da semana, e é
  // assim que a aula vai ser lembrada.
  const diaSemanaCurto = new Date(evento.data_hora)
    .toLocaleDateString('pt-BR', { timeZone: 'America/Bahia', weekday: 'long' })
    .replace('-feira', '');

  // O número do evento manda; a env var é só o padrão. Sem nenhum dos dois o botão não
  // aparece — melhor não ter o botão do que ter um wa.me/ para lugar nenhum.
  const whatsappDireto = pronto?.whatsapp_direto || WHATSAPP_PADRAO || '';

  const Bloco = ({ v, l }) => (
    <div style={{ textAlign: 'center', minWidth: 62 }}>
      <div style={{ fontSize: 30, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {String(v).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 10, color: '#8FA4BF', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 6, fontWeight: 700 }}>{l}</div>
    </div>
  );

  // Passos do que vai acontecer na aula. Numerados porque é SEQUÊNCIA de verdade — uma
  // coisa depende da anterior —, não decoração.
  const PASSOS = [
    { t: 'Judicial x extrajudicial', d: 'As duas modalidades, o que muda no risco e qual serve para quem está começando.' },
    { t: 'Busca ao vivo', d: 'Abro a plataforma e procuro na sua frente, com os filtros que eu uso de verdade.' },
    { t: 'Laudo gerado na hora', d: 'Escolhemos um imóvel e a IA monta o relatório de viabilidade ali, do zero.' },
    { t: 'O lance máximo', d: 'Como calcular o teto que preserva a sua margem — e por que quase todo mundo erra aqui.' },
  ];

  return (
    <div style={{ minHeight: '100vh', background: NAVY, color: '#EAF0F8', fontFamily: FONTE }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&display=swap');`}</style>

      {/* ── HERO, centralizado ────────────────────────────────────────────────
          Centralizado de propósito: numa página de campanha o olho entra pelo meio,
          e texto alinhado à esquerda com o formulário ao lado divide a atenção logo
          no momento em que ela precisa estar inteira na promessa. */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '56px 22px 0', textAlign: 'center' }}>
        <div style={{ display: 'inline-block', background: `${cor}1F`, border: `1px solid ${cor}55`, color: cor, fontSize: 11.5, fontWeight: 700, letterSpacing: 1.5, textTransform: 'uppercase', padding: '7px 15px', borderRadius: 30, marginBottom: 22 }}>
          Aula ao vivo · gratuita{evento.recorrencia === 'semanal' ? ' · toda quarta' : ''}
        </div>
        <h1 style={{ fontSize: 'clamp(30px,5.4vw,50px)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.025em', margin: '0 0 18px', color: '#fff', textWrap: 'balance' }}>
          {evento.titulo}
        </h1>
        {evento.subtitulo && (
          <p style={{ fontSize: 'clamp(16px,2.1vw,19.5px)', color: '#B9C8DC', lineHeight: 1.6, margin: '0 auto 26px', maxWidth: '54ch' }}>
            {evento.subtitulo}
          </p>
        )}
        <div style={{ fontSize: 15.5, color: '#fff', fontWeight: 600, marginBottom: 4, textTransform: 'capitalize' }}>{quando}</div>
        <div style={{ fontSize: 13, color: '#8FA4BF' }}>
          Horário de Brasília · {evento.duracao_min || 90} minutos
          {typeof inscritos === 'number' && inscritos >= 5 && ` · ${inscritos} inscritos`}
        </div>

        {contagem && !contagem.comecou && (
          <div style={{ display: 'flex', gap: 14, marginTop: 28, padding: '18px 22px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Bloco v={contagem.dias} l="dias" /><Bloco v={contagem.horas} l="horas" />
            <Bloco v={contagem.min} l="min" /><Bloco v={contagem.seg} l="seg" />
          </div>
        )}
        {contagem?.comecou && (
          <div style={{ marginTop: 26, padding: '15px 20px', background: '#166534', borderRadius: 12, fontWeight: 700, fontSize: 15.5 }}>
            🔴 A aula está começando — inscreva-se para receber o link
          </div>
        )}
      </div>

      {/* ── FORMULÁRIO, centralizado logo abaixo da promessa ─────────────────── */}
      <div style={{ maxWidth: 470, margin: '32px auto 0', padding: '0 22px' }}>
        <div style={{ background: '#fff', color: '#0f172a', borderRadius: 18, padding: '28px 26px', boxShadow: '0 14px 50px rgba(0,0,0,0.35)' }}>
          {pronto ? (
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 42, marginBottom: 10 }}>✅</div>
              <h2 style={{ fontSize: 22, fontWeight: 800, margin: '0 0 8px' }}>Vaga garantida!</h2>
              <p style={{ fontSize: 14.5, color: '#475569', lineHeight: 1.6, margin: '0 0 18px' }}>
                Enviamos a confirmação para <strong>{form.email}</strong>.
                {pronto.contaNova && ' Criamos também o seu acesso à plataforma — o e-mail traz o link para definir a senha.'}
              </p>
              {pronto.link_grupo && (
                <>
                  <p style={{ fontSize: 14.5, color: '#0f172a', fontWeight: 600, margin: '0 0 12px' }}>
                    Falta um passo: entre no grupo do WhatsApp para receber o link da sala e o lembrete.
                  </p>
                  <a href={pronto.link_grupo} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', textAlign: 'center', background: '#16a34a', color: '#fff', textDecoration: 'none', padding: '15px', borderRadius: 12, fontWeight: 800, fontSize: 15.5 }}>
                    Entrar no grupo do WhatsApp →
                  </a>
                </>
              )}

              {/* ── ABRIR CONVERSA DIRETA ────────────────────────────────────
                  Botão que faz a PESSOA mandar mensagem, e não o contrário. É essa direção
                  que abre a janela de conversa do WhatsApp: quem escreve primeiro é ela, e a
                  partir daí dá para responder sem depender de modelo aprovado.
                  Complementa o grupo em vez de substituí-lo — o grupo aquece o conjunto, a
                  conversa individual é onde uma venda de ticket alto se fecha. */}
              {whatsappDireto && (
                <div style={{ marginTop: 16 }}>
                  <a href={`https://wa.me/${whatsappDireto}?text=${encodeURIComponent(
                        `Oi! Acabei de me inscrever na aula de ${diaSemanaCurto} sobre leilão.` +
                        `${form.cidade ? ` Sou de ${form.cidade}.` : ''} Pode me avisar por aqui quando começar?`)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', textAlign: 'center', background: '#fff', color: '#166534', border: '2px solid #16a34a', textDecoration: 'none', padding: '13px', borderRadius: 12, fontWeight: 800, fontSize: 14.5 }}>
                    Falar comigo no WhatsApp →
                  </a>
                  <p style={{ fontSize: 12, color: '#94a3b8', textAlign: 'center', margin: '8px 0 0', lineHeight: 1.5 }}>
                    Prefere falar direto comigo em vez do grupo? É por aqui.
                  </p>
                </div>
              )}

              {/* ── ENQUANTO A AULA NÃO CHEGA ────────────────────────────────
                  A conta já foi criada na inscrição — só falta a pessoa saber disso e usar.
                  Uma semana de espera sem nada para fazer é uma semana esfriando; quem entra
                  e mexe na plataforma chega na aula entendendo do que eu vou falar.
                  Fica DEPOIS do grupo de propósito: o grupo é o passo que não pode ser
                  perdido, e dois botões de mesmo peso dividiriam o clique. */}
              <div style={{ marginTop: 22, paddingTop: 20, borderTop: '1px solid #e5e7eb', textAlign: 'left' }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>
                  Quer ir se familiarizando até {diaSemanaCurto}?
                </div>
                <p style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.6, margin: '0 0 14px' }}>
                  Seu acesso à BidPro Brasil já está criado. É a ferramenta que eu vou usar ao vivo
                  para localizar e avaliar leilões no país inteiro — entre e procure
                  {form.cidade ? <> em <strong>{form.cidade}</strong></> : ' na sua cidade'}.
                </p>
                <a href="/#/redefinir-senha"
                  style={{ display: 'block', textAlign: 'center', background: '#fff', color: AZUL, border: `2px solid ${AZUL}`, textDecoration: 'none', padding: '13px', borderRadius: 12, fontWeight: 800, fontSize: 15 }}>
                  Definir minha senha e explorar →
                </a>
              </div>

              {/* CONVIDE UM AMIGO — aqui, e não noutro lugar, porque este é o instante de maior
                  disposição para compartilhar: a pessoa acabou de garantir a vaga e ainda está
                  com o WhatsApp na mão. Fica por ÚLTIMO de propósito: o grupo do WhatsApp é o
                  passo que não pode ser perdido, e um botão verde de igual peso acima dele
                  dividiria o clique que mais importa. */}
              <ConvideAmigo codigo={pronto.codigo_indicacao} aula={{ slug, data_hora: evento.data_hora }} alinhamento="center" />
            </div>
          ) : (
            <form onSubmit={inscrever}>
              <h2 style={{ fontSize: 20, fontWeight: 800, margin: '0 0 4px', textAlign: 'center' }}>Garanta a sua vaga</h2>
              <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 20px', textAlign: 'center' }}>
                É gratuito. Leva 20 segundos.<br />
                {/* Dizer POR QUE pedimos a cidade: campo sem motivo aparente é o que faz a
                    pessoa desistir no meio do formulário. */}
                <span style={{ fontSize: 12.5 }}>A cidade é para eu buscar imóveis perto de você, ao vivo.</span>
              </p>
              {[
                { k: 'nome', ph: 'Nome e sobrenome', type: 'text', mode: undefined, ac: 'name', max: 80 },
                { k: 'email', ph: 'Seu melhor e-mail', type: 'email', mode: 'email', ac: 'email', max: 160 },
                // `max: 15` é o tamanho de "(11) 91234-5678" JÁ formatado, e `formatarTelefone`
                // (a MESMA função de src/lib/telefone.js, não uma cópia) corta em 11 dígitos:
                // o campo para de aceitar dígito sobrando na origem, em vez de só reclamar
                // depois que a pessoa terminou de digitar. Ela também tira o "+55" que o
                // autopreenchimento do celular insere — sem isso o número vira outro, calado.
                { k: 'whatsapp', ph: 'WhatsApp com DDD', type: 'tel', mode: 'tel', ac: 'tel', max: 15, mascara: formatarTelefone },
              ].map(f => (
                <input key={f.k} type={f.type} inputMode={f.mode} autoComplete={f.ac} placeholder={f.ph} maxLength={f.max}
                  value={form[f.k]}
                  onChange={e => setForm({ ...form, [f.k]: f.mascara ? f.mascara(e.target.value) : e.target.value })}
                  style={{ width: '100%', padding: '14px 16px', border: '1px solid #cbd5e1', borderRadius: 11, fontSize: 16, marginBottom: 10, boxSizing: 'border-box', color: '#0f172a', fontFamily: 'inherit' }} />
              ))}
              {/* UM campo só: a pessoa digita e escolhe "Cidade - UF" da base do IBGE, e a UF
                  vem junto. Dois campos separados produziam grafia livre e UF em branco — e
                  cidade sem estado não casa com nenhum filtro de proximidade da Busca, que é
                  exatamente o que eu prometo fazer ao vivo com o endereço dela. */}
              <CidadeAutocomplete
                value={form.cidade}
                placeholder="Sua cidade (comece a digitar)"
                onListaPronta={setCidadesCarregadas}
                onSelect={({ cidade, uf }) => setForm(f => ({ ...f, cidade, uf: uf || f.uf }))}
                style={{ marginBottom: 10 }}
                inputStyle={{ padding: '14px 16px', border: '1px solid #cbd5e1', borderRadius: 11, fontSize: 16, color: '#0f172a', fontFamily: 'inherit' }} />
              {/* A base do IBGE não respondeu: sem ela não há UF para resolver, então o campo
                  volta. Seguir sem estado seria gravar meio endereço e chamar de sucesso. */}
              {cidadesCarregadas === 0 && (
                <input type="text" autoComplete="address-level1" placeholder="UF (ex.: BA)" maxLength={2}
                  value={form.uf} onChange={e => setForm({ ...form, uf: e.target.value.toUpperCase().replace(/[^A-Z]/g, '') })}
                  style={{ width: '100%', padding: '14px 16px', border: '1px solid #cbd5e1', borderRadius: 11, fontSize: 16, marginBottom: 10, boxSizing: 'border-box', color: '#0f172a', fontFamily: 'inherit' }} />
              )}
              {erro && (
                <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>{erro}</div>
              )}
              <button type="submit" disabled={enviando}
                style={{ width: '100%', padding: '16px', background: enviando ? '#94a3b8' : AZUL, color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16.5, cursor: enviando ? 'default' : 'pointer', fontFamily: 'inherit' }}>
                {enviando ? 'Inscrevendo…' : 'Quero participar'}
              </button>
              <p style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5, margin: '12px 0 0', textAlign: 'center' }}>
                Ao se inscrever você concorda em receber comunicações sobre a aula. Seus dados não são compartilhados.
              </p>
            </form>
          )}
        </div>
      </div>

      {/* ── COMO VAI FUNCIONAR ────────────────────────────────────────────────
          A numeração aqui é informação, não enfeite: a aula acontece nesta ordem. */}
      <div style={{ maxWidth: 820, margin: '64px auto 0', padding: '0 22px' }}>
        <div style={{ textAlign: 'center', marginBottom: 30 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: cor, textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 10 }}>Como vai funcionar</div>
          <h2 style={{ fontSize: 'clamp(23px,3.4vw,31px)', fontWeight: 800, margin: 0, color: '#fff', letterSpacing: '-0.02em' }}>
            Sem slide. Com a plataforma aberta.
          </h2>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 18 }}>
          {PASSOS.map((p, i) => (
            <div key={p.t} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, padding: '22px 20px' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: cor, marginBottom: 10, letterSpacing: 1 }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div style={{ fontSize: 16.5, fontWeight: 700, color: '#fff', marginBottom: 7, lineHeight: 1.3 }}>{p.t}</div>
              <div style={{ fontSize: 14, color: '#A7B9CE', lineHeight: 1.6 }}>{p.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── TELAS DO SISTEMA ──────────────────────────────────────────────────
          Só aparece quando há imagens cadastradas. Uma seção "veja a plataforma" com
          espaços vazios seria pior que não ter seção nenhuma. */}
      {Array.isArray(evento.imagens) && evento.imagens.length > 0 && (
        <div style={{ maxWidth: 1000, margin: '64px auto 0', padding: '0 22px' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: cor, textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 10 }}>A plataforma</div>
            <h2 style={{ fontSize: 'clamp(23px,3.4vw,31px)', fontWeight: 800, margin: 0, color: '#fff', letterSpacing: '-0.02em' }}>
              É isto que você vai ver funcionando
            </h2>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: 18 }}>
            {evento.imagens.map((img, i) => (
              <figure key={i} style={{ margin: 0, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 14, overflow: 'hidden' }}>
                {/* A proporção fica no WRAPPER, não no <img>: o Safari usa a proporção do
                    ARQUIVO quando aspect-ratio está na própria imagem, e a tela do sistema
                    sairia deformada justamente no iPhone, que é onde o público vai abrir. */}
                <div style={{ position: 'relative', width: '100%', aspectRatio: '16/10', overflow: 'hidden' }}>
                  <img src={img.url} alt={img.legenda || ''} loading="lazy"
                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
                {img.legenda && (
                  <figcaption style={{ fontSize: 13.5, color: '#A7B9CE', padding: '13px 16px', lineHeight: 1.5 }}>{img.legenda}</figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}

      {/* ── O QUE MAIS ────────────────────────────────────────────────────────── */}
      {evento.descricao && (
        <div style={{ maxWidth: 660, margin: '58px auto 0', padding: '0 22px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: cor, textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 14, textAlign: 'center' }}>
            No detalhe
          </div>
          <div style={{ fontSize: 16, lineHeight: 1.85, color: '#C9D6E6', whiteSpace: 'pre-line' }}>
            {evento.descricao}
          </div>
        </div>
      )}

      {/* ── QUEM APRESENTA ─────────────────────────────────────────────────────
          Cartão, e não texto solto no fundo escuro: este bloco responde "por que eu
          deveria ouvir esse cara?", e é a única parte da página em que a resposta é a
          PESSOA. Solto, ele lia como rodapé.

          Foto à esquerda e texto à direita no desktop; empilhado no celular, onde a
          maioria vai abrir. A faixa de números fecha o bloco porque credencial aqui não
          é adjetivo — é o acervo que ele vai abrir ao vivo dali a poucos dias. */}
      {evento.apresentador && (
        <div style={{ maxWidth: 760, margin: '64px auto 0', padding: '0 22px' }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: cor, textTransform: 'uppercase', letterSpacing: 1.6, marginBottom: 14, textAlign: 'center' }}>
            Quem apresenta
          </div>
          <div style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.10)', borderRadius: 18, padding: '28px 26px' }}>
            <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {evento.apresentador_foto && (
                <img src={evento.apresentador_foto} alt={evento.apresentador}
                  style={{ width: 104, height: 104, borderRadius: 16, objectFit: 'cover', flexShrink: 0, border: `2px solid ${cor}55` }} />
              )}
              <div style={{ flex: '1 1 300px', minWidth: 0 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', letterSpacing: '-0.01em' }}>{evento.apresentador}</div>
                {evento.apresentador_cargo && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: LATAO, marginTop: 3, marginBottom: 12 }}>
                    {evento.apresentador_cargo}
                  </div>
                )}
                {evento.apresentador_bio && (
                  <p style={{ fontSize: 15, color: '#C9D6E6', lineHeight: 1.75, margin: 0, whiteSpace: 'pre-line' }}>
                    {evento.apresentador_bio}
                  </p>
                )}
              </div>
            </div>

            {numeros && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 14, marginTop: 24, paddingTop: 22, borderTop: '1px solid rgba(255,255,255,0.10)' }}>
                {/* "leiloeiros acompanhados" SAIU em 27/08, por decisão do dono: contagem de
                    FONTES é a única métrica aqui em que o número maior vence, e agregador que
                    só lista sempre vai ter mais. Exibir 30 ao lado dos "900+" que o concorrente
                    anuncia convida a comparação errada — como se o produto fosse quantidade de
                    fontes, e não o que se sabe sobre cada imóvel. No lugar entra o lote com
                    desconto real, que só quem cruza avaliação × lance consegue produzir. */}
                {[
                  { v: Number(numeros.lotes).toLocaleString('pt-BR'), l: 'lotes em leilão monitorados agora' },
                  { v: Number(numeros.com_desconto ?? 0).toLocaleString('pt-BR'), l: 'com 50% ou mais de desconto' },
                  { v: Number(numeros.cidades).toLocaleString('pt-BR'), l: 'cidades brasileiras com acervo' },
                ].filter(n => n.v && n.v !== '0').map(n => (
                  <div key={n.l}>
                    <div style={{ fontSize: 25, fontWeight: 800, color: '#fff', letterSpacing: '-0.02em' }}>{n.v}</div>
                    <div style={{ fontSize: 12.5, color: '#8FA5BE', lineHeight: 1.45, marginTop: 2 }}>{n.l}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CHAMADA FINAL ────────────────────────────────────────────────────── */}
      {!pronto && (
        <div style={{ maxWidth: 560, margin: '62px auto 0', padding: '0 22px 70px', textAlign: 'center' }}>
          <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            style={{ padding: '16px 34px', background: cor, color: NAVY, border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit' }}>
            Garantir minha vaga
          </button>
          <div style={{ fontSize: 13, color: '#8FA4BF', marginTop: 14 }}>
            {evento.recorrencia === 'semanal' ? 'Toda quarta, às 19h.' : 'Vaga gratuita.'}
          </div>
        </div>
      )}
    </div>
  );
}
