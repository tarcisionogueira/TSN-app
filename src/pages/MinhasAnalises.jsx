import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Loader2, CheckCircle2, XCircle, Search, Building2, Plus, Home } from 'lucide-react';
import { useAnalises } from '../contexts/AnalisesContext';
import { useIsMobile } from '../utils/useIsMobile';

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

// Tela inicial das Análises: lista de imóveis analisados (mercado + documental por
// imóvel). Clicar num imóvel abre a análise específica dele (relatórios + agenda
// com o analista). Substitui o antigo popup do topo por uma página navegável.
export default function MinhasAnalises() {
  const { analises, documentais, emAndamento, remover } = useAnalises();
  const nav = useNavigate();
  const isMobile = useIsMobile();

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

  const abrir = (a) => nav('/analise', { state: { imovel: a.imovel || { id: a.imovelId, titulo: a.titulo, cidade: a.cidade, estado: a.estado } } });
  const statusInfo = (a) => {
    if (a.status === 'gerando') return { Icon: Loader2, cor: '#0d9488', txt: 'Gerando…', spin: true };
    if (a.status === 'erro') return { Icon: XCircle, cor: '#dc2626', txt: a.erro || 'Erro' };
    return { Icon: CheckCircle2, cor: '#16a34a', txt: 'Pronta' };
  };

  const acao = (label, Icon, cor, onClick) => (
    <button onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: 'white', color: cor, border: `1px solid ${cor}33`, borderRadius: 12, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
      <Icon size={16} /> {label}
    </button>
  );

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: isMobile ? '16px 12px' : '28px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>BidPro Brasil</div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: '#111', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 9 }}>
            <BarChart3 size={22} color="#0D63DB" /> Minhas Análises
          </h1>
        </div>
        {emAndamento > 0 && (
          <span style={{ fontSize: 12, fontWeight: 800, color: '#0d9488', background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 20, padding: '6px 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> {emAndamento} em andamento
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {acao('Buscar imóveis', Search, '#0D63DB', () => nav('/buscar'))}
        {acao('Incluir lote manual (URL/anexos)', Plus, '#7c3aed', () => nav('/analise', { state: { manual: true } }))}
        {acao('Meus arrematados', Home, '#059669', () => nav('/painel', { state: { aba: 'arrematacoes' } }))}
      </div>

      {itens.length === 0 ? (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 16, padding: '48px 24px', textAlign: 'center' }}>
          <BarChart3 size={40} color="#cbd5e1" />
          <div style={{ fontSize: 15, fontWeight: 800, color: '#334155', margin: '14px 0 6px' }}>Você ainda não tem análises</div>
          <div style={{ fontSize: 13, color: '#64748b', marginBottom: 18, lineHeight: 1.5 }}>Busque um imóvel e gere sua primeira análise de viabilidade.</div>
          <button onClick={() => nav('/buscar')} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 22px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 14, cursor: 'pointer' }}>
            <Search size={16} /> Buscar imóveis
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {itens.map(a => {
            const s = statusInfo(a);
            const foto = fotoImovel(a.imovel);
            const tags = Object.keys(a.partes || {});
            return (
              <div key={a.imovelId} onClick={() => abrir(a)}
                style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, cursor: 'pointer', transition: 'box-shadow .15s, border-color .15s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = '#cbd5e1'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e2e8f0'; }}>
                <div style={{ width: 64, height: 64, borderRadius: 10, overflow: 'hidden', flexShrink: 0, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {foto
                    ? <img src={foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.currentTarget.style.display = 'none'; }} />
                    : <Building2 size={22} color="#cbd5e1" />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 800, color: '#111', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.titulo || 'Imóvel'}</div>
                  <div style={{ fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[a.cidade, a.estado].filter(Boolean).join(' — ')}</div>
                  <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 7, marginTop: 3 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <s.Icon size={12} color={s.cor} style={s.spin ? { animation: 'spin 1s linear infinite' } : undefined} />
                      <span style={{ color: s.cor, fontWeight: 700 }}>{s.txt}</span>
                    </span>
                    {tags.length > 0 && <span style={{ color: '#94a3b8', fontWeight: 600 }}>· {tags.map(t => t === 'mercado' ? 'Mercado' : 'Documental').join(' + ')}</span>}
                  </div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); remover(a.imovelId); }} title="Remover" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4, flexShrink: 0 }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
