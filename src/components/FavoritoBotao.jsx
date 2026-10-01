import React from 'react';
import { Star } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { reportarErroCliente } from '../utils/reportarErro';

// Estrela de ACOMPANHAMENTO (01/10). Marca um imóvel ou veículo para a seção "Acompanhamento" de
// Minhas Análises, onde o lance corrente é medido a cada coleta. Grava na conta do usuário LOGADO
// (RLS: user_id = auth.uid()) — em modo suporte a estrela fica desligada, senão marcaria na conta
// do admin achando que marcou na do cliente.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function FavoritoBotao({ tipo, itemId, compacto = false, onChange }) {
  const { userReal: user, impersonate } = useAuth(); // id REAL: é o que a RLS (auth.uid()) compara
  const [marcado, setMarcado] = React.useState(null); // null = ainda não sei
  const [ocupado, setOcupado] = React.useState(false);
  const valido = !!user?.id && UUID.test(String(itemId || ''));

  React.useEffect(() => {
    if (!valido) return;
    let vivo = true;
    supabase.from('favoritos').select('id').eq('tipo', tipo).eq('item_id', itemId).eq('user_id', user.id).maybeSingle() // padrao-ok: favorito é da conta REAL (RLS = auth.uid()); escrita bloqueada em modo suporte
      .then(({ data, error }) => {
        if (!vivo) return;
        // Falha de leitura NÃO vira "não marcado" (forma nº 2): fica indeterminado e o clique não age.
        if (error) { reportarErroCliente({ msg: `favoritos (ler): ${error.message}` }); return; }
        setMarcado(!!data);
      });
    return () => { vivo = false; };
  }, [valido, tipo, itemId, user?.id]);

  if (!valido) return null;

  const alternar = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (impersonate) { window.alert('No modo suporte a conta é só para visualização.'); return; }
    if (marcado === null || ocupado) return;
    setOcupado(true);
    // `.select()` prova o que mudou (forma nº 3: RLS que filtra não devolve erro).
    const { data, error } = marcado
      ? await supabase.from('favoritos').delete().eq('tipo', tipo).eq('item_id', itemId).eq('user_id', user.id).select('id') // padrao-ok: idem — bloqueado acima em modo suporte
      : await supabase.from('favoritos').upsert({ user_id: user.id, tipo, item_id: itemId }, { onConflict: 'user_id,tipo,item_id' }).select('id'); // padrao-ok: idem — bloqueado acima em modo suporte
    setOcupado(false);
    if (error || !data?.length) {
      reportarErroCliente({ msg: `favoritos (${marcado ? 'remover' : 'marcar'}): ${error?.message || 'nenhuma linha alterada'}` });
      window.alert('Não foi possível atualizar o acompanhamento. Tente de novo.');
      return;
    }
    setMarcado(!marcado);
    onChange?.(!marcado);
  };

  const ativo = marcado === true;
  const titulo = ativo ? 'Em acompanhamento — clique para remover' : 'Acompanhar (lance atualizado em Minhas Análises)';
  return (
    <button onClick={alternar} disabled={ocupado || marcado === null} title={titulo} aria-label={titulo} aria-pressed={ativo}
      style={compacto
        ? { background: 'none', border: 'none', padding: 4, cursor: 'pointer', flexShrink: 0, display: 'flex' }
        : { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: ativo ? '#fefce8' : 'white', color: ativo ? '#a16207' : '#475569', border: `1px solid ${ativo ? '#fde68a' : '#e2e8f0'}`, borderRadius: 10, fontWeight: 700, fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <Star size={compacto ? 18 : 14} color={ativo ? '#eab308' : '#94a3b8'} fill={ativo ? '#eab308' : 'none'} />
      {!compacto && (ativo ? 'Acompanhando' : 'Acompanhar')}
    </button>
  );
}
