/**
 * FaixaAula — a home passa a dizer que existe aula ao vivo.
 *
 * POR QUE EXISTE (30/08). A landing da aula (`/#/live/<slug>`) só era alcançada por quem
 * clicava no link exato da campanha. Quem chega à home por qualquer outro caminho — busca
 * orgânica, link da bio, indicação, o próprio anúncio de tráfego — não tinha como saber que
 * existe aula: a home não a mencionava em lugar nenhum. Medido no dia: dos 3 cadastros vindos
 * da campanha, os 2 que caíram em `/live/leilao-ao-vivo` se inscreveram na aula; o que caiu em
 * `/` criou conta e foi embora sem se inscrever.
 *
 * ⚠️ E o `landing` que mediu isso estava quebrado no mesmo dia — `visita_origem.landing`
 * gravava só o `pathname`, então TODA rota do app virava `/` (o app é HashRouter). Foi com
 * essa coluna que eu disse, errado, que a campanha mandava todo mundo para a home. Quem sabia
 * a verdade era `perfis.mkt_landing`. Esta faixa NÃO é conserto daquele diagnóstico — ele não
 * existia. Ela resolve o buraco que sobrou depois de corrigi-lo: a home continua muda para
 * todo mundo que não vem pelo link direto.
 *
 * TRÊS DECISÕES QUE VALEM ENTENDER ANTES DE MEXER:
 *
 * 1. QUAL aula vem do banco (`live_em_cartaz`), não do código. Fixar o slug aqui faria a faixa
 *    anunciar a aula errada no dia em que a próxima tiver outro slug — e anunciar calada.
 *
 * 2. O FUSO É `America/Bahia`, o mesmo de `LiveInscricao` e de `live_proxima`. Deixar o
 *    navegador formatar mostraria 22h para quem está fora do Brasil numa aula que começa 19h;
 *    duas réguas para a mesma hora é como não ter nenhuma.
 *
 * 3. FALHA NÃO VIRA FAIXA. Se a chamada erra, não renderiza nada — mostrar aula que não existe
 *    é pior que não mostrar aula nenhuma. Mas o motivo vai para o console: silêncio total
 *    transformaria "a RPC quebrou" em "não tem aula", que são diagnósticos opostos.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Radio, ArrowRight, X } from 'lucide-react';
import { supabase } from '../utils/supabase.js';

const LS_FECHADA = 'tsn_faixa_aula_fechada';

export default function FaixaAula() {
  const nav = useNavigate();
  const [aula, setAula] = useState(null);
  const [fechada, setFechada] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data, error } = await supabase.rpc('live_em_cartaz');
      // `{ data, error }` do postgrest-js NÃO lança em não-2xx: sem checar `error`, um 4xx/5xx
      // viraria `data` nulo e a faixa sumiria como se não houvesse aula. Forma #2 do CLAUDE.md.
      if (error) { console.warn('[faixa-aula] não consegui ler live_em_cartaz:', error.message || error); return; }
      if (!vivo || !data?.slug) return;   // null legítimo = nada em cartaz
      try {
        // Fechada por ESTA edição: chave carrega o slug + o horário, então a aula da semana
        // seguinte reaparece sozinha em vez de herdar o "não quero ver" da anterior.
        if (localStorage.getItem(LS_FECHADA) === `${data.slug}|${data.data_hora}`) setFechada(true);
      } catch { /* storage bloqueado (aba privada): trata como não-fechada, que é o padrão seguro */ }
      setAula(data);
    })();
    return () => { vivo = false; };
  }, []);

  if (!aula || fechada) return null;

  const quando = new Date(aula.data_hora).toLocaleString('pt-BR', {
    timeZone: 'America/Bahia', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).replace(/^(\w)/, (c) => c.toUpperCase());

  const ir = () => nav(`/live/${aula.slug}`);
  const fechar = (e) => {
    e.stopPropagation();
    setFechada(true);
    try { localStorage.setItem(LS_FECHADA, `${aula.slug}|${aula.data_hora}`); } catch { /* idem */ }
  };

  return (
    <div
      onClick={ir}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ir(); } }}
      style={{
        background: 'linear-gradient(90deg, #065f46 0%, #0d9488 55%, #0D63DB 100%)',
        color: 'white', padding: '11px 44px 11px 20px', cursor: 'pointer', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, flexWrap: 'wrap',
        fontSize: 14, lineHeight: 1.45,
      }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontWeight: 900, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', background: 'rgba(255,255,255,0.18)', borderRadius: 20, padding: '4px 11px', whiteSpace: 'nowrap' }}>
        <Radio size={12} /> Aula ao vivo · grátis
      </span>
      <span style={{ fontWeight: 700, textAlign: 'center' }}>
        {aula.titulo}
        <span style={{ opacity: 0.9, fontWeight: 500 }}> — {quando} (horário de Brasília)</span>
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 800, textDecoration: 'underline', whiteSpace: 'nowrap' }}>
        Garantir minha vaga <ArrowRight size={14} />
      </span>
      <button
        type="button" onClick={fechar} aria-label="Fechar aviso da aula"
        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'rgba(255,255,255,0.75)', cursor: 'pointer', padding: 4, display: 'flex' }}
      >
        <X size={16} />
      </button>
    </div>
  );
}
