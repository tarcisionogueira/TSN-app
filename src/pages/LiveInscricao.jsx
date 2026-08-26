import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { lerMarketing } from '../utils/marketing';
import { NAVY, LATAO } from '../utils/marca';

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
  const [form, setForm] = useState({ nome: '', email: '', whatsapp: '' });
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [pronto, setPronto] = useState(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      // O `error` é checado: numa página de campanha, "evento não encontrado" impresso por
      // causa de falha de rede manda embora quem clicou no anúncio — e o clique já foi pago.
      const { data, error } = await supabase.from('eventos_live')
        .select('id, slug, titulo, subtitulo, descricao, data_hora, duracao_min, capa_url, cor, vagas_max')
        .eq('slug', slug).eq('ativo', true).maybeSingle();
      if (cancelado) return;
      if (error) setErroCarga(true);
      setEvento(data || null);
      setCarregando(false);
      if (data) {
        const { data: n } = await supabase.rpc('live_inscritos', { p_slug: slug }); // padrao-ok: prova social opcional — sem o número a página funciona igual
        if (!cancelado) setInscritos(typeof n === 'number' ? n : null);
      }
    })();
    return () => { cancelado = true; };
  }, [slug]);

  const contagem = useContagem(evento?.data_hora);

  async function inscrever(e) {
    e.preventDefault();
    setErro('');
    if (!form.nome.trim() || form.nome.trim().length < 2) return setErro('Informe o seu nome.');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim())) return setErro('Informe um e-mail válido.');
    if (form.whatsapp.replace(/\D/g, '').length < 10) return setErro('Informe o WhatsApp com DDD.');
    setEnviando(true);
    try {
      const mkt = lerMarketing() || {};
      const r = await fetch('/api/live-inscrever', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug, ...form, utm: mkt }),
      });
      const j = await r.json().catch(() => ({}));
      // `.ok` checado ANTES de comemorar: dizer "inscrito" sobre uma resposta de erro é
      // prometer uma vaga que não existe, e isso só aparece no dia da aula.
      if (!r.ok || j?.error) throw new Error(j?.error || 'Não foi possível concluir a inscrição.');
      setPronto(j);
      setInscritos(n => (typeof n === 'number' ? n + 1 : n));
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

  const Bloco = ({ v, l }) => (
    <div style={{ textAlign: 'center', minWidth: 62 }}>
      <div style={{ fontSize: 30, fontWeight: 900, color: '#fff', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
        {String(v).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 10, color: '#8FA4BF', textTransform: 'uppercase', letterSpacing: 1.2, marginTop: 6, fontWeight: 700 }}>{l}</div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: NAVY, color: '#EAF0F8' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '40px 22px 60px' }}>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 30 }}>
          <div>
            <div style={{ display: 'inline-block', background: `${cor}22`, border: `1px solid ${cor}55`, color: cor, fontSize: 11.5, fontWeight: 800, letterSpacing: 1.4, textTransform: 'uppercase', padding: '6px 13px', borderRadius: 30, marginBottom: 18 }}>
              Aula ao vivo · gratuita
            </div>
            <h1 style={{ fontSize: 'clamp(28px,5vw,46px)', fontWeight: 900, lineHeight: 1.08, letterSpacing: '-0.02em', margin: '0 0 14px', color: '#fff', textWrap: 'balance' }}>
              {evento.titulo}
            </h1>
            {evento.subtitulo && (
              <p style={{ fontSize: 'clamp(15px,2vw,18.5px)', color: '#B9C8DC', lineHeight: 1.55, margin: '0 0 22px', maxWidth: '58ch' }}>
                {evento.subtitulo}
              </p>
            )}
            <div style={{ fontSize: 14.5, color: '#D6E1EF', marginBottom: 6, textTransform: 'capitalize' }}>📅 {quando}</div>
            <div style={{ fontSize: 13, color: '#8FA4BF' }}>
              Horário de Brasília · {evento.duracao_min || 90} minutos
              {typeof inscritos === 'number' && inscritos >= 5 && ` · ${inscritos} inscritos`}
            </div>

            {contagem && !contagem.comecou && (
              <div style={{ display: 'flex', gap: 16, marginTop: 26, padding: '18px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, width: 'fit-content', flexWrap: 'wrap' }}>
                <Bloco v={contagem.dias} l="dias" />
                <Bloco v={contagem.horas} l="horas" />
                <Bloco v={contagem.min} l="min" />
                <Bloco v={contagem.seg} l="seg" />
              </div>
            )}
            {contagem?.comecou && (
              <div style={{ marginTop: 24, padding: '14px 18px', background: '#166534', borderRadius: 12, fontWeight: 700, fontSize: 15 }}>
                🔴 A aula está começando — inscreva-se para receber o link
              </div>
            )}
          </div>

          {/* ── O FORMULÁRIO ─────────────────────────────────────────────────
              Três campos, e nenhum a mais. Senha não é pedida: a conta é criada e a
              pessoa define depois, pelo e-mail de confirmação. */}
          <div style={{ background: '#fff', color: '#0f172a', borderRadius: 16, padding: '26px 24px', boxShadow: '0 10px 40px rgba(0,0,0,0.3)', maxWidth: 460, width: '100%' }}>
            {pronto ? (
              <div>
                <div style={{ fontSize: 40, marginBottom: 10 }}>✅</div>
                <h2 style={{ fontSize: 21, fontWeight: 800, margin: '0 0 8px' }}>Vaga garantida!</h2>
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
                      style={{ display: 'block', textAlign: 'center', background: '#16a34a', color: '#fff', textDecoration: 'none', padding: '14px', borderRadius: 12, fontWeight: 800, fontSize: 15 }}>
                      Entrar no grupo do WhatsApp →
                    </a>
                  </>
                )}
              </div>
            ) : (
              <form onSubmit={inscrever}>
                <h2 style={{ fontSize: 19, fontWeight: 800, margin: '0 0 4px' }}>Garanta a sua vaga</h2>
                <p style={{ fontSize: 13.5, color: '#64748b', margin: '0 0 18px' }}>É gratuito. Leva 20 segundos.</p>

                {[
                  { k: 'nome', ph: 'Seu nome', type: 'text', mode: undefined, ac: 'name' },
                  { k: 'email', ph: 'Seu melhor e-mail', type: 'email', mode: 'email', ac: 'email' },
                  { k: 'whatsapp', ph: 'WhatsApp com DDD', type: 'tel', mode: 'tel', ac: 'tel' },
                ].map(f => (
                  <input key={f.k} type={f.type} inputMode={f.mode} autoComplete={f.ac} placeholder={f.ph}
                    value={form[f.k]} onChange={e => setForm({ ...form, [f.k]: e.target.value })}
                    style={{ width: '100%', padding: '13px 15px', border: '1px solid #cbd5e1', borderRadius: 11, fontSize: 16, marginBottom: 10, boxSizing: 'border-box', color: '#0f172a' }} />
                ))}

                {erro && (
                  <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', borderRadius: 9, padding: '10px 12px', fontSize: 13, marginBottom: 10 }}>
                    {erro}
                  </div>
                )}

                <button type="submit" disabled={enviando}
                  style={{ width: '100%', padding: '15px', background: enviando ? '#94a3b8' : '#0D63DB', color: '#fff', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 16, cursor: enviando ? 'default' : 'pointer' }}>
                  {enviando ? 'Inscrevendo…' : 'Quero participar'}
                </button>
                <p style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5, margin: '12px 0 0', textAlign: 'center' }}>
                  Ao se inscrever você concorda em receber comunicações sobre a aula.
                  Seus dados não são compartilhados com terceiros.
                </p>
              </form>
            )}
          </div>
        </div>

        {evento.descricao && (
          <div style={{ marginTop: 44, paddingTop: 30, borderTop: '1px solid rgba(255,255,255,0.1)', maxWidth: '68ch' }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: 1.3, marginBottom: 12 }}>
              O que você vai ver
            </div>
            <div style={{ fontSize: 15.5, lineHeight: 1.75, color: '#C9D6E6', whiteSpace: 'pre-line' }}>
              {evento.descricao}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
