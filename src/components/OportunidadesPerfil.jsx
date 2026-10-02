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
  }, [cliente.id]);

  const caixa = { padding: '14px 16px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 14 };
  if (erro) return <div style={{ ...caixa, color: '#b91c1c', fontSize: 13 }}>{erro}</div>;
  if (!res) return <div style={{ ...caixa, color: '#94a3b8', fontSize: 13 }}>Buscando oportunidades no perfil de {cliente.nome}...</div>;
  const c = res.criterios || {};
  const linhaCriterios = [c.perfil, c.faixa, c.pagamento === 'financiado' ? 'financiado' : c.pagamento === 'a_vista' ? 'à vista' : null,
    c.descontoMin ? `desconto ≥ ${c.descontoMin}%` : null, c.centros?.length ? `perto de ${c.centros.join(', ')}` : null,
    c.raioKm ? `até ${c.raioKm} km` : null].filter(Boolean).join(' · ');
  return (
    <div style={caixa}>
      <div style={{ fontSize: 12, color: '#6b21a8', marginBottom: 8 }}>
        <b>Perfil:</b> {linhaCriterios || 'sem triagem'}
      </div>
      {res.aviso && <div style={{ fontSize: 13, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>{res.aviso}</div>}
      {(res.oportunidades || []).map((o) => (
        // Mesma aba, pela navegação do app (02/10): `target="_blank"` no app instalado do iPhone abre
        // FORA do app, sem a sessão — o dono clicou e caiu na tela inicial. `href` fica para o
        // clique do meio/Ctrl no computador; o clique normal navega por dentro e "Voltar" retorna.
        <a key={o.id} href={`#/imovel/${o.id}`} onClick={(e) => { if (e.ctrlKey || e.metaKey || e.button === 1) return; e.preventDefault();
          // Registro no Cliente 360 do cliente (best-effort: falha aqui nunca impede abrir o lote).
          apiCall('/api/oportunidades-cliente', { method: 'POST', body: JSON.stringify({ cliente_id: cliente.id, imovel_id: o.id, titulo: o.titulo }) })
            .then((r) => { if (!r.ok) console.warn('[oportunidades] abertura não registrada no 360', r.status); })
            .catch((err) => console.warn('[oportunidades] abertura não registrada no 360', err?.message));
          nav(`/imovel/${o.id}`); }} style={{
          display: 'flex', gap: 10, alignItems: 'center', textDecoration: 'none', color: 'inherit',
          background: 'white', border: '1px solid #e9d5ff', borderRadius: 10, padding: 8, marginBottom: 6,
        }}>
          {o.foto
            ? <img src={o.foto} alt="" loading="lazy" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 8, flexShrink: 0 }} onError={(e) => { e.currentTarget.style.display = 'none'; }} />
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
      ))}
      {res.oportunidades?.length > 0 && (
        <div style={{ fontSize: 11, color: '#94a3b8' }}>{res.oportunidades.length} melhores de {res.totalCandidatos} lote(s) que cabem no perfil</div>
      )}
    </div>
  );
}
