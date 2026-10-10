import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, XCircle, Car } from 'lucide-react';
import { supabase } from '../utils/supabase';

// RELATÓRIOS DE VEÍCULOS em "Minhas análises" (10/10, pedido do dono: "armazenar os relatórios de
// veículos e separar dos de imóveis"). Os relatórios já ficavam guardados em `analises_veiculo`
// (um por usuário × veículo, api/gerar-analise-veiculo.js) mas só se achavam reabrindo o veículo.
// Aqui viram lista; o clique abre /analise-veiculo?veiculo=<id>, que lê o relatório guardado.
const brl = (v) => (Number(v) > 0 ? Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }) : '—');
const STATUS = { concluida: ['Pronto', '#059669', '#ecfdf5'], gerando: ['Gerando…', '#0d9488', '#f0fdfa'], erro: ['Falhou', '#b91c1c', '#fef2f2'] };

export default function MinhasAnalisesVeiculos({ userId }) {
  const nav = useNavigate();
  const [lista, setLista] = React.useState(null);
  const [erro, setErro] = React.useState('');

  React.useEffect(() => {
    if (!userId) return;
    let vivo = true;
    (async () => {
      // `error` conferido: lista vazia por erro de leitura não pode parecer "nenhum relatório".
      const { data, error } = await supabase.from('analises_veiculo')
        .select('veiculo_id, status, erro, updated_at, result, veiculos_leilao(titulo, fotos, valor_minimo, data_leilao, cidade, estado, ativo)')
        .eq('user_id', userId).order('updated_at', { ascending: false }).limit(200);
      if (!vivo) return;
      if (error) { setErro(error.message); setLista([]); return; }
      setLista(data || []);
    })();
    return () => { vivo = false; };
  }, [userId]);

  if (lista === null) return <div style={{ padding: 30, textAlign: 'center' }}><Loader2 size={20} color="#0D63DB" style={{ animation: 'spin 1s linear infinite' }} /></div>;
  if (erro) return (
    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 16, padding: '16px 18px', color: '#b91c1c', fontSize: 13, fontWeight: 700, display: 'flex', gap: 8, alignItems: 'center' }}>
      <XCircle size={16} /> Não foi possível carregar os relatórios de veículos: {erro}
    </div>
  );
  if (!lista.length) return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: 36, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
      Nenhum relatório de veículo ainda. Abra um veículo em /veiculos e gere o relatório — ele fica guardado aqui.
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {lista.map((a) => {
        const v = a.veiculos_leilao || {};
        const r = a.result || {};
        const [rot, cor, fundo] = STATUS[a.status] || [a.status, '#64748b', '#f8fafc'];
        const foto = Array.isArray(v.fotos) ? (typeof v.fotos[0] === 'string' ? v.fotos[0] : v.fotos[0]?.url) : null;
        return (
          <button key={a.veiculo_id} onClick={() => nav(`/analise-veiculo?veiculo=${a.veiculo_id}`)}
            style={{ display: 'flex', gap: 12, alignItems: 'center', textAlign: 'left', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: 12, cursor: 'pointer', width: '100%' }}>
            <div style={{ width: 72, height: 54, borderRadius: 10, background: '#f1f5f9', flexShrink: 0, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {foto ? <img src={foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Car size={22} color="#94a3b8" />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.titulo || 'Veículo'}</div>
              <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                Lance mín. {brl(v.valor_minimo)} · FIPE {brl(r.fipeValor)}{v.cidade ? ` · ${v.cidade}/${v.estado || ''}` : ''}
                {v.ativo === false ? ' · leilão encerrado' : ''}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>Atualizado em {new Date(a.updated_at).toLocaleDateString('pt-BR')}</div>
            </div>
            <span style={{ fontSize: 11, fontWeight: 800, color: cor, background: fundo, borderRadius: 999, padding: '4px 10px', flexShrink: 0 }}>{rot}</span>
          </button>
        );
      })}
    </div>
  );
}
