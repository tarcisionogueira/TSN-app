import { useState, useEffect, useCallback } from 'react';
import { BellRing, BellOff, Loader2 } from 'lucide-react';
import { supabase } from '../utils/supabase';

/**
 * "Cobrar posição" (17/10, pedido do dono): numa conversa cuja última mensagem é um envio NOSSO pela caixa
 * pessoal, liga uma cobrança automática — quem envia é o api/email-cobranca-cron.js. Para sozinha quando o
 * destinatário responde. Só cobra o que o dono ligar.
 * 12/11 (dono: "escolher a periodicidade"): intervalo de 2 a 30 dias e de 1 a 10 cobranças (antes 7/15/30 e 3 fixas),
 * e a cobrança ATIVA pode ter a frequência/limite trocados sem desligar e religar.
 */
const INTERVALOS = [2, 3, 5, 7, 10, 15, 30];
const LIMITES = [1, 3, 5, 10];
const dataBR = (s) => new Date(s).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
const MOTIVO = { respondido: 'parou: o destinatário respondeu', limite: 'parou: limite de cobranças sem resposta', parado: 'desligada por você', erro: 'parou: e-mail original não encontrado' };

export default function CobrarPosicao({ conversa, userId, onErro, onAviso }) {
  const ultima = conversa[conversa.length - 1];
  const elegivel = ultima && ultima.direcao === 'saida' && ultima.dono && ultima.dono === userId;
  const ids = conversa.map((m) => m.id);
  const chave = ids.join(',');
  const [cob, setCob] = useState(undefined); // undefined = carregando · null = nenhuma
  const [dias, setDias] = useState(7);
  const [maximo, setMaximo] = useState(3);
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  // 19/10 (forma 2): erro de leitura virava `null` = "nenhuma cobrança" e oferecia "Cobrar posição"
  // por cima de uma cobrança ATIVA (ligar de novo duplicaria). Erro agora tem estado próprio.
  const [erroLeitura, setErroLeitura] = useState('');

  const carregar = useCallback(async () => {
    if (!ids.length) { setCob(null); setErroLeitura(''); return; }
    const { data, error } = await supabase.from('email_cobranca').select('*').in('email_id', ids).order('criado_em', { ascending: false }).limit(1);
    if (error) { console.error('[CobrarPosicao] ler:', error.message); setErroLeitura(error.message); setCob(undefined); return; }
    setErroLeitura('');
    setCob(data?.[0] || null);
  }, [chave]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { carregar(); }, [carregar]);

  if (erroLeitura) return (
    <div style={{ fontSize: 12, color: '#b91c1c', margin: '0 0 10px' }}>
      Não consegui verificar a cobrança de posição desta conversa ({erroLeitura}).{' '}
      <button type="button" onClick={carregar} style={{ background: 'none', border: 'none', color: '#0D63DB', fontWeight: 700, cursor: 'pointer', padding: 0, fontSize: 12 }}>Tentar de novo</button>
    </div>
  );
  if (cob === undefined) return null;
  const ativa = cob?.ativo;
  if (!ativa && !elegivel) return cob ? <div style={{ fontSize: 12, color: '#64748b', margin: '0 0 10px' }}>Cobrança de posição {MOTIVO[cob.encerrado_motivo] || 'encerrada'}.</div> : null;

  const ligar = async () => {
    setOcupado(true);
    // 1ª cobrança: N dias depois do envio; se isso já passou, na próxima rodada (dia útil, ~9h30).
    const alvo = Math.max(Date.parse(ultima.criado_em) + dias * 864e5, Date.now() + 60e3);
    const { data, error } = await supabase.from('email_cobranca')
      .insert({ email_id: ultima.id, user_id: userId, intervalo_dias: dias, max_cobrancas: maximo, proxima_em: new Date(alvo).toISOString() }).select().single();
    setOcupado(false);
    if (error || !data) { onErro?.(`Não liguei a cobrança: ${error?.message || 'sem permissão'}`); return; }
    setCob(data);
    onAviso?.(`Cobrança ligada: a cada ${dias} dias, até ${maximo} ${maximo > 1 ? 'vezes' : 'vez'}. Primeira em ${dataBR(data.proxima_em)}.`);
  };
  // Troca frequência/limite da cobrança ATIVA. A próxima data é refeita a partir da última cobrança enviada
  // (ou do e-mail original, se nenhuma saiu ainda) — nunca no passado.
  const alterar = async () => {
    if (maximo < (cob.enviadas || 0) + 1) { onErro?.(`Já saíram ${cob.enviadas} cobranças — escolha um limite maior.`); return; }
    setOcupado(true);
    const base = Date.parse(cob.enviadas ? cob.atualizado_em : ultima.criado_em);
    const alvo = Math.max(base + dias * 864e5, Date.now() + 60e3);
    const { data, error } = await supabase.from('email_cobranca')
      .update({ intervalo_dias: dias, max_cobrancas: maximo, proxima_em: new Date(alvo).toISOString(), atualizado_em: new Date().toISOString() })
      .eq('id', cob.id).eq('ativo', true).select().single();
    setOcupado(false);
    if (error || !data) { onErro?.(`Não alterei: ${error?.message || 'a cobrança não está mais ativa'}`); carregar(); return; }
    setCob(data); setEditando(false);
    onAviso?.(`Cobrança alterada: a cada ${dias} dias, até ${maximo}. Próxima em ${dataBR(data.proxima_em)}.`);
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
  const selStyle = { fontSize: 12, padding: '5px 6px', borderRadius: 6, border: '1px solid #cbd5e1' };
  const btn = { display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 700, padding: '6px 10px', borderRadius: 8, cursor: 'pointer' };
  if (ativa) return (
    <div style={{ ...caixa, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e40af' }}>
      <BellRing size={14} /> Cobrando posição a cada {cob.intervalo_dias} dias · {cob.enviadas} de {cob.max_cobrancas} enviadas · próxima em {dataBR(cob.proxima_em)}
      {editando ? (
        <>
          <select value={dias} onChange={(e) => setDias(Number(e.target.value))} style={selStyle}>
            {INTERVALOS.map((d) => <option key={d} value={d}>a cada {d} dias</option>)}
          </select>
          <select value={maximo} onChange={(e) => setMaximo(Number(e.target.value))} style={selStyle}>
            {LIMITES.filter((n) => n > (cob.enviadas || 0)).map((n) => <option key={n} value={n}>até {n} {n > 1 ? 'vezes' : 'vez'}</option>)}
          </select>
          <button onClick={alterar} disabled={ocupado} style={{ ...btn, border: 'none', background: '#0D63DB', color: 'white' }}>{ocupado ? <Loader2 size={12} /> : null} Salvar</button>
          <button onClick={() => setEditando(false)} disabled={ocupado} style={{ ...btn, border: '1px solid #93c5fd', background: 'white', color: '#1e40af' }}>Cancelar</button>
        </>
      ) : (
        <button onClick={() => { setDias(cob.intervalo_dias); setMaximo(Math.max(cob.max_cobrancas, (cob.enviadas || 0) + 1)); setEditando(true); }} disabled={ocupado}
          style={{ ...btn, border: '1px solid #93c5fd', background: 'white', color: '#1e40af' }}>Alterar</button>
      )}
      <button onClick={parar} disabled={ocupado} style={{ ...btn, border: '1px solid #93c5fd', background: 'white', color: '#1e40af' }}>
        {ocupado ? <Loader2 size={12} /> : <BellOff size={12} />} Parar de cobrar
      </button>
    </div>
  );
  return (
    <div style={{ ...caixa, background: '#f8fafc', border: '1px solid #e2e8f0', color: '#334155' }}>
      <BellRing size={14} /> Sem resposta?
      <select value={dias} onChange={(e) => setDias(Number(e.target.value))} style={selStyle}>
        {INTERVALOS.map((d) => <option key={d} value={d}>a cada {d} dias</option>)}
      </select>
      <select value={maximo} onChange={(e) => setMaximo(Number(e.target.value))} style={selStyle}>
        {LIMITES.map((n) => <option key={n} value={n}>até {n} {n > 1 ? 'vezes' : 'vez'}</option>)}
      </select>
      <button onClick={ligar} disabled={ocupado} style={{ ...btn, border: 'none', background: '#0D63DB', color: 'white' }}>
        {ocupado ? <Loader2 size={12} /> : <BellRing size={12} />} Cobrar posição
      </button>
      {cob && <span style={{ color: '#64748b' }}>(última: {MOTIVO[cob.encerrado_motivo] || 'encerrada'})</span>}
    </div>
  );
}
