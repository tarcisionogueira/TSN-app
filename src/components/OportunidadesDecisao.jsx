import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target } from 'lucide-react';
import { apiCall } from '../utils/apiCall';

// OPORTUNIDADE SELECIONADA PELA EQUIPE (07/11, termo de assessoria, cláusula 1.3): o cliente aprova para a reunião
// ou recusa. Aprovar NÃO é lance (1.5), e por isso o aviso vem ANTES dos botões, que têm o mesmo peso.
// Nada de atualização otimista: o cartão só muda depois que o servidor gravou. Quem decide é o JWT do cliente;
// em modo suporte (`clienteId` preenchido) o cartão é só leitura, e o servidor recusaria de qualquer forma.
const brl = (v) => (v ? 'R$ ' + Math.round(v).toLocaleString('pt-BR') : null);
const dataBr = (d) => { const t = Date.parse(d || ''); return Number.isFinite(t) ? new Date(t).toLocaleDateString('pt-BR') : null; };
const botao = { flex: '1 1 150px', minHeight: 46, padding: '11px 14px', borderRadius: 10, fontWeight: 800, fontSize: 14.5, cursor: 'pointer', background: 'white', color: '#0f172a', border: '2px solid #0D63DB' };

export default function OportunidadesDecisao({ clienteId = null, onPendentes }) {
  const nav = useNavigate();
  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [ocupado, setOcupado] = useState(null);
  const [recusando, setRecusando] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [recibos, setRecibos] = useState({});
  const [erroAcao, setErroAcao] = useState({});
  const vistos = useRef(new Set());

  const carregar = useCallback(async () => {
    try {
      const r = await apiCall(`/api/minhas-oportunidades${clienteId ? `?cliente_id=${encodeURIComponent(clienteId)}` : ''}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !Array.isArray(j.oportunidades)) throw new Error(j.error || `Erro ${r.status}`);
      setErro(null); setDados(j);
    } catch (e) { setErro(e.message); }
  }, [clienteId]);
  useEffect(() => { carregar(); }, [carregar]);

  const lista = dados?.oportunidades || [];
  const abertas = lista.filter((o) => o.estado === 'aguardando' || o.estado === 'equipe_confere');
  const temAberta = abertas.length > 0;
  useEffect(() => { onPendentes?.(temAberta); }, [temAberta, onPendentes]);

  // "Visto" só vale em sessão do próprio cliente. Falha aqui não atrapalha a decisão, mas fica no console.
  useEffect(() => {
    if (!dados || dados.somente_leitura) return;
    const ids = abertas.filter((o) => !o.visto_em && !vistos.current.has(o.id)).map((o) => o.id);
    if (!ids.length) return;
    ids.forEach((i) => vistos.current.add(i));
    apiCall('/api/minhas-oportunidades', { method: 'POST', body: JSON.stringify({ acao: 'visto', ids }) })
      .then((r) => { if (!r.ok) console.warn('[oportunidades] visto não registrado', r.status); })
      .catch((e) => console.warn('[oportunidades] visto não registrado', e?.message));
  }, [dados]); // eslint-disable-line react-hooks/exhaustive-deps

  async function decidir(o, decisao) {
    setOcupado(o.id); setErroAcao((x) => ({ ...x, [o.id]: null }));
    try {
      const r = await apiCall('/api/minhas-oportunidades', { method: 'POST', body: JSON.stringify({
        acao: 'decidir', id: o.id, decisao, versao: dados.textos?.versao, motivo_recusa: decisao === 'recusada' ? motivo : undefined,
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `Erro ${r.status}`);
      setRecibos((x) => ({ ...x, [o.id]: j.recibo }));
      setRecusando(null); setMotivo('');
      await carregar();
    } catch (e) { setErroAcao((x) => ({ ...x, [o.id]: e.message })); }
    setOcupado(null);
  }

  if (erro) {
    return (
      <div role="alert" style={{ fontSize: 13.5, color: '#9a3412', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, padding: '10px 12px' }}>
        Não conseguimos carregar as oportunidades da sua assessoria agora. Nada foi apagado. <button onClick={carregar} style={{ background: 'none', border: 'none', color: '#9a3412', fontWeight: 800, textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: 13.5 }}>Tentar de novo</button>
      </div>
    );
  }
  const respondidas = lista.filter((o) => ['aprovada', 'recusada'].includes(o.status)).slice(0, 5);
  if (!temAberta && !respondidas.length) return null;

  return (
    <section aria-label="Oportunidades selecionadas para você" style={{ display: 'grid', gap: 12 }}>
      {abertas.map((o) => (
        <article key={o.id} style={{ background: 'white', border: '2px solid #bfdbfe', borderRadius: 18, padding: '18px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 800, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: 0.8 }}>
            <Target size={15} aria-hidden="true" /> A equipe selecionou para você
          </div>
          <div style={{ display: 'flex', gap: 12, marginTop: 10 }}>
            {o.foto && <img referrerPolicy="no-referrer" src={o.foto} alt="" loading="lazy" style={{ width: 84, height: 84, objectFit: 'cover', borderRadius: 10, flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#111', margin: 0, lineHeight: 1.3, overflowWrap: 'anywhere' }}>{o.titulo}</h2>
              <div style={{ fontSize: 14, color: '#334155', marginTop: 4, lineHeight: 1.5 }}>
                {[o.cidade && `${o.cidade}${o.uf ? `/${o.uf}` : ''}`, brl(o.valor), o.desconto ? `${Math.round(o.desconto)}% abaixo da avaliação` : null].filter(Boolean).join(' · ')}
              </div>
              {dataBr(o.dataLeilao) && <div style={{ fontSize: 14, color: '#334155', fontWeight: 700 }}>{o.praca === 'encerra' ? 'Encerra' : `Próxima data${o.praca ? ` (${o.praca})` : ''}`}: {dataBr(o.dataLeilao)}</div>}
            </div>
          </div>
          {o.valor_atual && <div style={{ fontSize: 14, color: '#92400e', marginTop: 8 }}>O valor mudou desde a seleção: agora {brl(o.valor_atual)}. A equipe confere isso com você na reunião.</div>}
          <div style={{ fontSize: 14, color: '#334155', marginTop: 10, lineHeight: 1.55 }}><b>Por que a equipe escolheu:</b> {o.motivo_equipe}</div>
          <button onClick={() => nav(`/imovel/${o.imovel_id}`)} style={{ background: 'none', border: 'none', padding: '8px 0', color: '#0D63DB', fontWeight: 700, fontSize: 14, cursor: 'pointer', textDecoration: 'underline' }}>Ver o imóvel</button>

          {o.estado === 'equipe_confere' && <div style={{ fontSize: 14, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', marginTop: 4 }}>Este lote saiu da nossa lista. A equipe está conferindo e avisa você.</div>}

          <div style={{ fontSize: 14.5, fontWeight: 800, color: '#0f172a', marginTop: 8 }}>{dados.aviso_decisao}</div>
          <div style={{ fontSize: 14, color: '#475569', lineHeight: 1.5, marginTop: 2 }}>Aprovando, a equipe marca uma reunião para apresentar o imóvel. Lance só com a sua autorização, por escrito e com o valor máximo.</div>

          {dados.somente_leitura ? (
            <div style={{ fontSize: 13.5, color: '#64748b', marginTop: 10 }}>Modo suporte: só o cliente pode responder.</div>
          ) : recusando === o.id ? (
            <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
              <label htmlFor={`motivo-${o.id}`} style={{ fontSize: 14, color: '#334155' }}>Quer dizer o motivo? É opcional e ajuda a equipe a acertar nas próximas.</label>
              <textarea id={`motivo-${o.id}`} value={motivo} maxLength={500} rows={2} onChange={(e) => setMotivo(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 10, fontSize: 16, border: '1px solid #cbd5e1', borderRadius: 8 }} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button disabled={ocupado === o.id} onClick={() => decidir(o, 'recusada')} style={botao}>{ocupado === o.id ? 'Registrando…' : 'Recusar esta oportunidade'}</button>
                <button disabled={ocupado === o.id} onClick={() => { setRecusando(null); setMotivo(''); }} style={{ ...botao, border: '1px solid #cbd5e1', fontWeight: 700 }}>Voltar</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 12 }}>
              {o.estado === 'aguardando' && <button disabled={ocupado === o.id} onClick={() => decidir(o, 'aprovada')} style={botao}>{ocupado === o.id ? 'Registrando…' : 'Aprovar para reunião'}</button>}
              <button disabled={ocupado === o.id} onClick={() => setRecusando(o.id)} style={botao}>Recusar</button>
            </div>
          )}
          {erroAcao[o.id] && <div role="alert" style={{ fontSize: 14, color: '#b91c1c', fontWeight: 600, marginTop: 8 }}>{erroAcao[o.id]}</div>}
        </article>
      ))}

      {respondidas.map((o) => (
        <div key={o.id} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 14px', fontSize: 14, color: '#334155', lineHeight: 1.5 }}>
          <b style={{ overflowWrap: 'anywhere' }}>{o.titulo}</b>: {recibos[o.id] || (o.status === 'aprovada'
            ? (o.reuniao_em ? `aprovada para reunião. Reunião marcada para ${new Date(o.reuniao_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}.` : 'aprovada para reunião. A equipe vai propor a data. Nenhum lance foi autorizado.')
            : 'você recusou. Nenhum lance será dado neste imóvel.')}
        </div>
      ))}
    </section>
  );
}
