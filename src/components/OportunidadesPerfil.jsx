import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../utils/apiCall';

// OPORTUNIDADES PELO PERFIL (02/10, pedido do dono): para quem contratou e ainda não arrematou,
// lotes que cabem na triagem dele (intenção, faixa de capital, pagamento, cidades), na mesma
// régua do e-mail de oportunidades. Objetivo: direcionar o cliente o quanto antes.
// Vazio nunca é mudo: o servidor devolve `aviso` (sem triagem / cidade não localizada / nada
// cabe) e os critérios usados, mostrados aqui para a equipe ajustar com o cliente.
const brl = (v) => (v ? 'R$ ' + Math.round(v).toLocaleString('pt-BR') : '—');
export default function OportunidadesPerfil({ cliente }) {
  const nav = useNavigate();
  const [res, setRes] = useState(null);
  const [erro, setErro] = useState(null);
  const [selecionando, setSelecionando] = useState(null); // imovel_id com o formulário aberto
  const [motivo, setMotivo] = useState('');
  const [prazoPendente, setPrazoPendente] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [erroSel, setErroSel] = useState(null);
  const [recarga, setRecarga] = useState(0);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const r = await apiCall(`/api/oportunidades-cliente?cliente_id=${encodeURIComponent(cliente.id)}`);
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data.error || `Erro ${r.status}`);
        if (vivo) setRes(data);
      } catch (e) { if (vivo) setErro(e.message); }
    })();
    return () => { vivo = false; };
  }, [cliente.id, recarga]);

  // Selecionar é ação própria, ao lado do link: abrir o lote só registra que a equipe olhou.
  async function enviarSelecao(imovelId, confirmarPrazo = false) {
    setOcupado(true); setErroSel(null);
    try {
      const r = await apiCall('/api/oportunidades-cliente', { method: 'POST', body: JSON.stringify({ acao: 'selecionar', cliente_id: cliente.id, imovel_id: imovelId, motivo, confirmar_prazo: confirmarPrazo }) });
      const j = await r.json().catch(() => ({}));
      if (j.precisa_confirmar) { setPrazoPendente(j.error); setOcupado(false); return; }
      if (!r.ok || !j.ok) throw new Error(j.error || `Erro ${r.status}`);
      setSelecionando(null); setMotivo(''); setPrazoPendente(null);
      if (!j.aviso_ok) setErroSel('Selecionada e visível ao cliente, mas o e-mail de aviso não saiu. Avise por outro canal.');
      setRecarga((n) => n + 1);
    } catch (e) { setErroSel(e.message); }
    setOcupado(false);
  }

  async function retirar(id) {
    const m = window.prompt('Motivo da retirada (fica registrado):');
    if (!m) return;
    setErroSel(null);
    try {
      const r = await apiCall('/api/oportunidades-cliente', { method: 'POST', body: JSON.stringify({ acao: 'retirar', cliente_id: cliente.id, id, motivo: m }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `Erro ${r.status}`);
      setRecarga((n) => n + 1);
    } catch (e) { setErroSel(e.message); }
  }

  const caixa = { padding: '14px 16px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 14 };
  if (erro) return <div style={{ ...caixa, color: '#b91c1c', fontSize: 13 }}>{erro}</div>;
  if (!res) return <div style={{ ...caixa, color: '#94a3b8', fontSize: 13 }}>Buscando oportunidades no perfil de {cliente.nome}...</div>;
  const c = res.criterios || {};
  const selecionadas = res.selecionadas || [];
  const vivas = new Set(selecionadas.filter((s) => ['selecionada', 'aprovada'].includes(s.status)).map((s) => s.imovel_id));
  const ROTULO = { aguardando: 'Aguardando o cliente', equipe_confere: 'Lote saiu do acervo: conferir', expirada: 'Expirada sem resposta', aprovada: 'Aprovada para reunião', recusada: 'Recusada', retirada: 'Retirada' };
  const linhaCriterios = [c.perfil, c.faixa, c.pagamento === 'financiado' ? 'financiado' : c.pagamento === 'a_vista' ? 'à vista' : null,
    c.descontoMin ? `desconto ≥ ${c.descontoMin}%` : null, c.centros?.length ? `perto de ${c.centros.join(', ')}` : null,
    c.raioKm ? `até ${c.raioKm} km` : null].filter(Boolean).join(' · ');
  return (
    <div style={caixa}>
      <div style={{ fontSize: 12, color: '#6b21a8', marginBottom: 8 }}>
        <b>Perfil:</b> {linhaCriterios || 'sem triagem'}
      </div>
      {res.aviso && <div style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>{res.aviso}</div>}
      {erroSel && <div role="alert" style={{ fontSize: 13, color: '#b91c1c', fontWeight: 600, marginBottom: 8 }}>{erroSel}</div>}
      {selecionadas.length > 0 && (
        <div style={{ background: 'white', border: '1px solid #e9d5ff', borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: '#6b21a8', marginBottom: 4 }}>Enviadas ao cliente</div>
          {selecionadas.map((s) => (
            <div key={s.id} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', fontSize: 12.5, color: '#334155', padding: '5px 0', borderTop: '1px solid #f3e8ff' }}>
              <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><b>{s.titulo}</b> · {ROTULO[s.estado] || s.estado}{s.visto_em ? ' · visto' : ''}{s.aviso_status && s.aviso_status !== 'aceito' ? ` · aviso ${s.aviso_status}` : ''}{s.motivo_recusa ? ` · motivo: ${s.motivo_recusa}` : ''}</span>
              {['selecionada', 'aprovada'].includes(s.status) && <button onClick={() => retirar(s.id)} style={{ background: 'none', border: 'none', padding: 0, color: '#b91c1c', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Retirar</button>}
            </div>
          ))}
        </div>
      )}
      {(res.oportunidades || []).map((o) => (<div key={o.id} style={{ marginBottom: 6 }}>
        // Mesma aba, pela navegação do app (02/10): `target="_blank"` no app instalado do iPhone abre
        // FORA do app, sem a sessão — o dono clicou e caiu na tela inicial. `href` fica para o
        // clique do meio/Ctrl no computador; o clique normal navega por dentro e "Voltar" retorna.
        <a href={`#/imovel/${o.id}`} onClick={(e) => { if (e.ctrlKey || e.metaKey || e.button === 1) return; e.preventDefault();
          // Registro no Cliente 360 do cliente (best-effort: falha aqui nunca impede abrir o lote).
          apiCall('/api/oportunidades-cliente', { method: 'POST', body: JSON.stringify({ cliente_id: cliente.id, imovel_id: o.id, titulo: o.titulo }) })
            .then((r) => { if (!r.ok) console.warn('[oportunidades] abertura não registrada no 360', r.status); })
            .catch((err) => console.warn('[oportunidades] abertura não registrada no 360', err?.message));
          nav(`/imovel/${o.id}`); }} style={{
          display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', color: 'inherit',
          background: 'white', border: '1px solid #e9d5ff', borderRadius: 10, padding: 8, marginBottom: 4,
        }}>
          {o.foto
            ? <img referrerPolicy="no-referrer" src={o.foto} alt="" loading="lazy" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            : <div style={{ width: 56, height: 56, borderRadius: 8, background: '#f1f5f9', flexShrink: 0 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.titulo || o.tipo}</div>
            <div style={{ fontSize: 12, color: '#475569' }}>
              {o.cidade}/{o.estado}{o.distanciaKm != null ? ` · ${o.distanciaKm} km` : ''} · <b>{brl(o.valor)}</b>{o.desconto ? ` · ${Math.round(o.desconto)}% abaixo` : ''}
              {o.dataLeilao ? ` · ${o.praca ? `${o.praca} ` : ''}${new Date(o.dataLeilao).toLocaleDateString('pt-BR')}` : ''}
            </div>
            {o.motivos?.length > 0 && <div style={{ fontSize: 11.5, color: '#7c3aed', marginTop: 1 }}>{o.motivos.join(' · ')}</div>}
          </div>
        </a>
        {vivas.has(o.id)
          ? <div style={{ fontSize: 12, color: '#6b21a8', fontWeight: 700 }}>Já enviada ao cliente</div>
          : selecionando === o.id
            ? (
              <div style={{ background: 'white', border: '1px solid #e9d5ff', borderRadius: 10, padding: 8, display: 'grid', gap: 6 }}>
                <label htmlFor={`motivo-${o.id}`} style={{ fontSize: 12.5, fontWeight: 700, color: '#334155' }}>Por que este lote serve para {cliente.nome}? O cliente lê esta frase.</label>
                <textarea id={`motivo-${o.id}`} rows={2} maxLength={500} value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 8 }} />
                {prazoPendente && <div style={{ fontSize: 12.5, color: '#92400e' }}>{prazoPendente}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button disabled={ocupado || motivo.trim().length < 10} onClick={() => enviarSelecao(o.id, !!prazoPendente)} style={{ padding: '7px 12px', borderRadius: 8, border: 'none', background: motivo.trim().length < 10 ? '#94a3b8' : '#7c3aed', color: 'white', fontWeight: 800, fontSize: 12.5, cursor: 'pointer' }}>{ocupado ? 'Enviando…' : prazoPendente ? 'Confirmar prazo e enviar' : 'Enviar ao cliente'}</button>
                  <button disabled={ocupado} onClick={() => { setSelecionando(null); setPrazoPendente(null); setMotivo(''); }} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid #cbd5e1', background: 'white', fontSize: 12.5, cursor: 'pointer' }}>Cancelar</button>
                </div>
              </div>
            )
            : <button onClick={() => { setSelecionando(o.id); setMotivo(''); setPrazoPendente(null); setErroSel(null); }} style={{ background: 'none', border: 'none', padding: '2px 0', color: '#7c3aed', fontSize: 12.5, fontWeight: 800, cursor: 'pointer' }}>Selecionar para o cliente</button>}
      </div>))}
      {res.oportunidades?.length > 0 && (
        <div style={{ fontSize: 11, color: '#94a3b8' }}>{res.oportunidades.length} lote(s) que cabem no perfil, do maior para o menor encaixe</div>
      )}
    </div>
  );
}
