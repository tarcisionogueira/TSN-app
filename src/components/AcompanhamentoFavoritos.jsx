import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Loader2, XCircle, Car, Building2, TrendingUp, Minus, Flag, HelpCircle, Gavel } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { fmtBRL } from '../utils/format';
import { reportarErroCliente } from '../utils/reportarErro';
import { lerComRenovacao } from '../lib/sessao-expirada';
import FavoritoBotao from './FavoritoBotao';

// ACOMPANHAMENTO (01/10, pedido do dono): imóveis e veículos marcados com a estrela, com acesso
// direto à tela do lote e o estado da disputa. O lance vem de `favorito_lance` (gatilho do scraper
// Superbid para veículos; api/favoritos-lance-cron.js para o resto), resumido por `meus_favoritos()`.
// "Não medido" é estado PRÓPRIO e diz o motivo — nunca aparece como "sem lance".
const STATUS = {
  disputa:    { t: 'Disputa evoluindo', Icon: TrendingUp, bg: '#fee2e2', c: '#b91c1c' },
  com_lance:  { t: 'Com lance',         Icon: Gavel,      bg: '#fef3c7', c: '#92400e' },
  sem_lance:  { t: 'Sem lance',         Icon: Minus,      bg: '#dcfce7', c: '#15803d' },
  encerrado:  { t: 'Leilão encerrado',  Icon: Flag,       bg: '#f1f5f9', c: '#475569' },
  nao_medido: { t: 'Lance não medido',  Icon: HelpCircle, bg: '#f1f5f9', c: '#64748b' },
};

const quando = (d) => {
  const t = Date.parse(d || '');
  if (!Number.isFinite(t)) return null;
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 60) return `há ${Math.max(min, 1)} min`;
  if (min < 48 * 60) return `há ${Math.round(min / 60)} h`;
  return new Date(t).toLocaleDateString('pt-BR');
};

export default function AcompanhamentoFavoritos() {
  const nav = useNavigate();
  const [lista, setLista] = React.useState(null);
  const [erro, setErro] = React.useState(null);

  const carregar = React.useCallback(async () => {
    const { data, error } = await lerComRenovacao(supabase, () => supabase.rpc('meus_favoritos'));
    if (error) {
      setErro(error.message || 'falha de leitura');
      reportarErroCliente({ msg: `meus_favoritos: ${error.message || 'erro'}` });
      return;
    }
    setErro(null);
    setLista(Array.isArray(data) ? data : []);
  }, []);
  React.useEffect(() => { carregar(); }, [carregar]);

  const abrir = (f) => nav(f.tipo === 'veiculo' ? `/admin/veiculos-leilao/${f.itemId}` : `/imovel/${f.itemId}`);

  return (
    <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 900, color: '#111' }}>
        <Star size={17} color="#eab308" fill="#eab308" /> Acompanhamento
        {Array.isArray(lista) && lista.length > 0 && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 700 }}>({lista.length})</span>}
      </div>

      {erro ? (
        <div style={{ fontSize: 13, color: '#b91c1c', marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <XCircle size={15} /> Não foi possível carregar o acompanhamento ({erro}).
          <button onClick={carregar} style={{ padding: '5px 12px', background: '#b91c1c', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Tentar de novo</button>
        </div>
      ) : lista === null ? (
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Carregando…
        </div>
      ) : lista.length === 0 ? (
        <div style={{ fontSize: 13, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
          Marque a <Star size={12} style={{ verticalAlign: -1 }} /> em um imóvel ou veículo para acompanhá-lo aqui, com o lance atualizado a cada coleta.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {lista.map((f) => {
            const st = STATUS[f.status] || STATUS.nao_medido;
            const m = f.ultimaMedicao || null;
            const Tipo = f.tipo === 'veiculo' ? Car : Building2;
            const dataL = f.dataLeilao ? new Date(f.dataLeilao) : null;
            return (
              <div key={`${f.tipo}-${f.itemId}`} onClick={() => abrir(f)}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid #f1f5f9', borderRadius: 12, cursor: 'pointer', background: '#fcfcfd' }}>
                <div style={{ width: 52, height: 52, borderRadius: 9, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {f.foto ? <img src={f.foto} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none'; }} /> : <Tipo size={20} color="#94a3b8" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.titulo || (f.tipo === 'veiculo' ? 'Veículo' : 'Imóvel')}</div>
                  <div style={{ fontSize: 12, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {[f.cidade, f.uf].filter(Boolean).join(', ')}
                    {dataL && !Number.isNaN(dataL.getTime()) && ` · Leilão ${dataL.toLocaleDateString('pt-BR')}`}
                  </div>
                  <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap', color: '#475569' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 20, background: st.bg, color: st.c }}>
                      <st.Icon size={11} /> {st.t}
                    </span>
                    {f.valorMinimo != null && <span>Mínimo {fmtBRL(f.valorMinimo)}</span>}
                    {f.status === 'encerrado' && f.lanceVencedor != null && <strong>Arrematado por {fmtBRL(f.lanceVencedor)}</strong>}
                    {f.status !== 'encerrado' && m?.estado === 'com_lance' && (
                      <strong style={{ color: '#111' }}>
                        Lance atual {m.valor != null ? fmtBRL(m.valor) : '(valor não exibido)'}
                        {m.qtd_lances ? ` · ${m.qtd_lances} lance${m.qtd_lances > 1 ? 's' : ''}` : ''}
                        {f.status === 'disputa' && f.lanceAnterior != null && <span style={{ color: '#b91c1c' }}> (antes {fmtBRL(f.lanceAnterior)})</span>}
                      </strong>
                    )}
                    {f.status !== 'encerrado' && m?.estado === 'nao_medido' && m.motivo && <span style={{ color: '#94a3b8' }}>{m.motivo}</span>}
                    {f.status === 'nao_medido' && !m && <span style={{ color: '#94a3b8' }}>aguardando a primeira medição</span>}
                    {m?.medido_em && f.status !== 'encerrado' && <span style={{ color: '#94a3b8' }}>· medido {quando(m.medido_em)}</span>}
                  </div>
                </div>
                <FavoritoBotao tipo={f.tipo} itemId={f.itemId} compacto onChange={(on) => { if (!on) setLista((p) => (p || []).filter((x) => !(x.tipo === f.tipo && x.itemId === f.itemId))); }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
