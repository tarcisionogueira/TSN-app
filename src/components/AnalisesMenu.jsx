import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Loader2, CheckCircle2, XCircle, Search, Clock, Building2 } from 'lucide-react';
import { useAnalises } from '../contexts/AnalisesContext';

// Miniatura do imóvel (CEF tem hotlink direto; demais usam o proxy de imagem).
function fotoImovel(im) {
  if (!im) return null;
  const isCef = im.fonte === 'CEF' || im.fonte === 'caixa';
  const id = (im.fonteId || im.fonte_id || '').replace(/^(caixa_|cef_)/, '');
  if (isCef && id) return `https://venda-imoveis.caixa.gov.br/fotos/F${id}21.jpg`;
  const f = im.foto || im.link_foto;
  if (!f) return null;
  return (f.includes('supabase.co') || f.startsWith('/')) ? f : `/api/img-proxy?url=${encodeURIComponent(f)}`;
}

// Menu "Análises" do topo: mostra as análises em andamento/recentes (a geração
// roda em segundo plano no AnalisesProvider, então o usuário pode navegar livre).
// Vazio → CTA para buscar imóveis e fazer a primeira análise.
export default function AnalisesMenu({ mobile, onNavegar }) {
  const { analises, documentais, emAndamento, remover } = useAnalises();
  const nav = useNavigate();
  // Une mercadológica + documental por imóvel: uma linha por imóvel, com o status
  // mais "ativo" vencendo (gerando > erro > pronta) e rótulo do que cada uma tem.
  const itens = React.useMemo(() => {
    const rank = { gerando: 3, erro: 2, concluida: 1 };
    const by = {};
    const push = (a, tipo) => {
      if (!a?.imovelId) return;
      const cur = by[a.imovelId];
      const partes = { ...(cur?.partes || {}), [tipo]: a.status };
      const venc = !cur || (rank[a.status] || 0) > (rank[cur.status] || 0) ? a : cur;
      by[a.imovelId] = { ...venc, partes, updatedAt: Math.max(cur?.updatedAt || 0, a.updatedAt || 0) };
    };
    (analises || []).forEach(a => push(a, 'mercado'));
    (documentais || []).forEach(a => push(a, 'documental'));
    return Object.values(by).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  }, [analises, documentais]);
  const [aberto, setAberto] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e) => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [aberto]);

  const abrir = (a) => {
    setAberto(false);
    onNavegar?.();
    nav('/analise', { state: { imovel: a.imovel || { id: a.imovelId, titulo: a.titulo, cidade: a.cidade, estado: a.estado } } });
  };
  const irBuscar = () => { setAberto(false); onNavegar?.(); nav('/buscar'); };
  const irArrematados = () => { setAberto(false); onNavegar?.(); nav('/painel', { state: { aba: 'arrematacoes' } }); };
  const irManual = () => { setAberto(false); onNavegar?.(); nav('/analise', { state: { manual: true } }); };

  const statusInfo = (a) => {
    if (a.status === 'gerando') return { Icon: Loader2, cor: '#0d9488', txt: 'Gerando…', spin: true };
    if (a.status === 'erro') return { Icon: XCircle, cor: '#dc2626', txt: a.erro || 'Erro' };
    return { Icon: CheckCircle2, cor: '#16a34a', txt: 'Pronta' };
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setAberto(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 6, padding: mobile ? '10px 14px' : '7px 14px', border: 'none', borderRadius: 8, background: aberto ? '#084BA6' : (mobile ? 'transparent' : 'transparent'), color: aberto ? 'white' : '#94a3b8', fontWeight: 600, fontSize: mobile ? 14 : 13, cursor: 'pointer', width: mobile ? '100%' : 'auto', justifyContent: mobile ? 'flex-start' : 'center', position: 'relative' }}>
        <BarChart3 size={mobile ? 16 : 14} /> Análises
        {emAndamento > 0 && (
          <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 10, background: '#0d9488', color: 'white', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{emAndamento}</span>
        )}
      </button>

      {aberto && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: mobile ? 'auto' : 0, left: mobile ? 0 : 'auto', width: mobile ? '100%' : 340, maxHeight: 420, overflowY: 'auto', background: 'white', borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.22)', border: '1px solid #e2e8f0', zIndex: 3000, padding: 8 }}>
          <div style={{ padding: '8px 10px 10px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#111' }}>Minhas análises</span>
            {emAndamento > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#0d9488', display: 'flex', alignItems: 'center', gap: 4 }}><Clock size={12} /> {emAndamento} em andamento</span>}
          </div>

          {itens.length === 0 ? (
            <div style={{ padding: '22px 16px', textAlign: 'center' }}>
              <BarChart3 size={28} color="#cbd5e1" />
              <div style={{ fontSize: 13, color: '#64748b', margin: '8px 0 14px', lineHeight: 1.5 }}>Você ainda não tem análises.<br />Busque um imóvel para fazer a primeira.</div>
              <button onClick={irBuscar} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                <Search size={15} /> Buscar imóveis
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingTop: 6 }}>
              {itens.map(a => {
                const s = statusInfo(a);
                const foto = fotoImovel(a.imovel);
                const tags = Object.keys(a.partes || {});
                return (
                  <div key={a.imovelId} onClick={() => abrir(a)}
                    style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ width: 46, height: 46, borderRadius: 8, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {foto
                        ? <img src={foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                        : <Building2 size={18} color="#cbd5e1" />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 700, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.titulo || 'Imóvel'}</div>
                      <div style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[a.cidade, a.estado].filter(Boolean).join(' — ')}</div>
                      <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 6, marginTop: 1 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <s.Icon size={11} color={s.cor} style={s.spin ? { animation: 'spin 1s linear infinite' } : undefined} />
                          <span style={{ color: s.cor, fontWeight: 700 }}>{s.txt}</span>
                        </span>
                        {tags.length > 0 && <span style={{ color: '#94a3b8', fontWeight: 600 }}>· {tags.map(t => t === 'mercado' ? 'Mercado' : 'Documental').join(' + ')}</span>}
                      </div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); remover(a.imovelId); }} title="Remover" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: 2, flexShrink: 0 }}>×</button>
                  </div>
                );
              })}
              <button onClick={irBuscar} style={{ margin: '6px 4px 2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '9px', background: '#f1f5f9', color: '#334155', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12.5, cursor: 'pointer' }}>
                <Search size={14} /> Buscar mais imóveis
              </button>
            </div>
          )}
          <div style={{ borderTop: '1px solid #f1f5f9', marginTop: 6, paddingTop: 6 }}>
            <button onClick={irManual} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: 'none', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12.5, color: '#7c3aed', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              ➕ Incluir lote manual (URL/anexos)
            </button>
            <button onClick={irArrematados} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 10px', background: 'none', border: 'none', borderRadius: 9, fontWeight: 700, fontSize: 12.5, color: '#0D63DB', cursor: 'pointer' }}
              onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              🏠 Meus arrematados →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
