import { useState, useEffect, useCallback } from 'react';
import { BellRing, BellOff, Loader2 } from 'lucide-react';
import { supabase } from '../utils/supabase';

/**
 * "Cobrar posição" (17/10, pedido do dono): numa conversa cuja última mensagem é um envio NOSSO pela caixa
 * pessoal, liga uma cobrança automática (7/15/30 dias, até 3 vezes) — quem envia é o api/email-cobranca-cron.js.
 * Para sozinha quando o destinatário responde. Só cobra o que o dono ligar.
 */
const dataBR = (s) => new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const MOTIVO = { respondido: 'parou: o destinatário respondeu', limite: 'parou: 3 cobranças sem resposta', parado: 'desligada por você', erro: 'parou: e-mail original não encontrado' };

export default function CobrarPosicao({ conversa, userId, onErro, onAviso }) {
  const ultima = conversa[conversa.length - 1];
  const elegivel = ultima && ultima.direcao === 'saida' && ultima.dono && ultima.dono === userId;
  const ids = conversa.map((m) => m.id);
  const chave = ids.join(',');
  const [cob, setCob] = useState(undefined); // undefined = carregando · null = nenhuma
  const [dias, setDias] = useState(7);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    if (!ids.length) { setCob(null); return; }
    const { data, error } = await supabase.from('email_cobranca').select('*').in('email_id', ids).order('criado_em', { ascending: false }).limit(1);
    if (error) { console.error('[CobrarPosicao] ler:', error.message); setCob(null); return; }
    setCob(data?.[0] || null);
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [carregar]);

  if (cob === undefined) return null;
  const ativa = cob?.ativo;
  if (!ativa && !elegivel) return cob ? <div style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>Cobrança de posição {MOTIVO[cob.encerrado_motivo] || 'encerrada'}.</div> : null;

  const ligar = async () => {
    setOcupado(true);
    // 1ª cobrança: N dias depois do envio; se isso já passou, na próxima rodada (dia útil, ~9h30).
    const alvo = Math.max(Date.parse(ultima.criado_em) + dias * 864e5, Date.now() + 60e3);
    const { data, error } = await supabase.from('email_cobranca')
      .insert({ email_id: ultima.id, user_id: userId, intervalo_dias: dias, proxima_em: new Date(alvo).toISOString() }).select().single();
    setOcupado(false);
    if (error || !data) { onErro?.(`Não liguei a cobrança: ${error?.message || 'sem permissão'}`); return; }
    setCob(data);
    onAviso?.(`Cobrança ligada: a cada ${dias} dias, até 3 vezes. Primeira em ${dataBR(data.proxima_em)}.`);
  };
  const parar = async () => {
    setOcupado(true);
    const { data, error } = await supabase.from('email_cobranca')
      .update({ ativo: false, encerrado_motivo: 'parado', encerrado_em: new Date().toISOString() }).eq('id', cob.id).select().single();
    setOcupado(false);
    if (error || !data) { onErro?.(`Não desliguei: ${error?.message || 'sem permissão'}`); return; }
    setCob(data);
    onAviso?.('Cobrança desligada.');
  };

  const caixa = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12.5, margin: '0 0 12px', padding: '8px 10px', borderRadius: 8 };
  const btn = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, cursor: 'pointer' };
  if (ativa) return (
    <div style={{ ...caixa, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
      <BellRing size={14} /> Cobrando posição a cada {cob.intervalo_dias} dias · {cob.enviadas} de {cob.max_cobrancas} enviadas · próxima em {dataBR(cob.proxima_em)}
      <button onClick={parar} disabled={ocupado} style={{ ...btn, border: '1px solid #93c5fd', background: 'white', color: '#1e40af' }}>
        {ocupado ? <Loader2 size={12} /> : <BellOff size={12} />} Parar de cobrar
      </button>
    </div>
  );
  return (
    <div style={{ ...caixa, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155' }}>
      <BellRing size={14} /> Sem resposta?
      <select value={dias} onChange={(e) => setDias(Number(e.target.value))} style={{ fontSize: 12, padding: '5px 6px', borderRadius: 6, border: '1px solid #cbd5e1' }}>
        <option value={7}>a cada 7 dias</option><option value={15}>a cada 15 dias</option><option value={30}>a cada 30 dias</option>
      </select>
      <button onClick={ligar} disabled={ocupado} style={{ ...btn, border: 'none', background: '#0D63DB', color: 'white' }}>
        {ocupado ? <Loader2 size={12} /> : <BellRing size={12} />} Cobrar posição
      </button>
      {cob && <span style={{ color: '#64748b' }}>(última: {MOTIVO[cob.encerrado_motivo] || 'encerrada'})</span>}
    </div>
  );
}
