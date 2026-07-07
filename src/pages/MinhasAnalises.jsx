import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Loader2, CheckCircle2, XCircle, Search, Building2, Plus, Home, Briefcase } from 'lucide-react';
import { useAnalises } from '../contexts/AnalisesContext';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';

// Etapa do acompanhamento assistido (caso) em rótulo curto para o cliente.
const ETAPA_CURTA = {
  analise_solicitada: 'Análise solicitada', analises_prontas: 'Análises prontas',
  reuniao_agendada: 'Reunião agendada', reuniao_realizada: 'Reunião realizada',
  juridico_solicitado: 'No jurídico', juridico_concluido: 'Parecer pronto',
  segunda_reuniao: '2ª reunião', arrematado: 'Arrematado', honorarios_pagos: 'Concluído',
  procuracao_assinada: 'Procuração assinada', pos_arrematacao: 'Pós-arrematação',
};

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
const CHIP = {
  verde:   { bg: '#dcfce7', c: '#15803d' },
  ambar:   { bg: '#fef3c7', c: '#92400e' },
  vermelho:{ bg: '#fee2e2', c: '#b91c1c' },
  neutro:  { bg: '#f1f5f9', c: '#475569' },
};

export default function MinhasAnalises() {
  const { analises, documentais, laudos, emAndamento, remover } = useAnalises();
  const { effectiveUserId } = useAuth();
  const nav = useNavigate();
  const isMobile = useIsMobile();

  // Acompanhamento assistido: se o imóvel analisado já virou um caso (fluxo /caso),
  // conectamos os dois no mesmo lugar — o cliente pula direto para o acompanhamento.
  const [casosPorImovel, setCasosPorImovel] = React.useState({});
  React.useEffect(() => {
    if (!effectiveUserId) return;
    supabase.from('casos').select('id, imovel_id, status_etapa').eq('cliente_id', effectiveUserId)
      .then(({ data }) => {
        const by = {};
        (data || []).forEach(c => { if (c.imovel_id) by[String(c.imovel_id)] = c; });
        setCasosPorImovel(by);
      });
  }, [effectiveUserId]);

  const itens = React.useMemo(() => {
    const by = {};
    const push = (a, tipo) => {
      if (!a?.imovelId) return;
      const it = by[a.imovelId] || (by[a.imovelId] = { imovelId: a.imovelId, titulo: a.titulo, cidade: a.cidade, estado: a.estado, imovel: a.imovel || null, updatedAt: 0, reports: {} });
      it.reports[tipo] = { status: a.status, result: a.result || null, erro: a.erro || null };
      it.updatedAt = Math.max(it.updatedAt, a.updatedAt || 0);
      if (!it.titulo && a.titulo) it.titulo = a.titulo;
      if (!it.imovel && a.imovel) it.imovel = a.imovel;
    };
    (analises || []).forEach(a => push(a, 'mercado'));
    (documentais || []).forEach(a => push(a, 'documental'));
    (laudos || []).forEach(a => push(a, 'laudo'));
    return Object.values(by).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0));
  }, [analises, documentais, laudos]);

  const abrir = (a) => nav('/analise', { state: { imovel: a.imovel || { id: a.imovelId, titulo: a.titulo, cidade: a.cidade, estado: a.estado } } });

  // Status GERAL do imóvel na lista. Um documental "concluida" mas com
  // result.precisaDocumentos ainda está capturando/preparando os documentos —
  // NÃO é "Pronta" (era o que fazia a lista dizer Pronta e a tela abrir "carregando").
  const statusGeral = (it) => {
    const rs = Object.values(it.reports);
    const anyGer = rs.some(r => r.status === 'gerando');
    const docPrep = it.reports.documental?.status === 'concluida' && it.reports.documental.result?.precisaDocumentos;
    if (anyGer) return { Icon: Loader2, cor: '#0d9488', txt: 'Gerando…', spin: true };
    if (docPrep) return { Icon: Loader2, cor: '#b45309', txt: 'Preparando documentos…', spin: true };
    const anyOk = rs.some(r => r.status === 'concluida');
    const anyErr = rs.some(r => r.status === 'erro');
    if (anyErr && !anyOk) return { Icon: XCircle, cor: '#dc2626', txt: 'Erro ao gerar' };
    return null; // pronto: os chips por relatório mostram o veredito
  };

  // Chips de veredito por relatório: dá pra ver na lista o que tem potencial de evoluir.
  const chipsDe = (it) => {
    const rs = it.reports, out = [];
    if (rs.mercado?.status === 'concluida') {
      const v = it.imovel?.analise_viavel;
      out.push(v === true ? { t: 'Mercado: viável', ...CHIP.verde } : v === false ? { t: 'Mercado: reprovado', ...CHIP.vermelho } : { t: 'Mercado ✓', ...CHIP.neutro });
    }
    if (rs.documental?.status === 'concluida' && !rs.documental.result?.precisaDocumentos) {
      const nr = rs.documental.result?.nivelRisco;
      out.push(nr === 'verde' ? { t: 'Jurídico: risco baixo', ...CHIP.verde } : nr === 'vermelho' ? { t: 'Jurídico: risco alto', ...CHIP.vermelho } : { t: 'Jurídico: risco médio', ...CHIP.ambar });
    }
    if (rs.laudo?.status === 'concluida' && rs.laudo.result?.veredito) {
      const v = rs.laudo.result.veredito;
      out.push(v === 'aprovado' ? { t: 'Laudo: aprovado', ...CHIP.verde } : v === 'reprovado' ? { t: 'Laudo: reprovado', ...CHIP.vermelho } : { t: 'Laudo: com ressalvas', ...CHIP.ambar });
    }
    return out;
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
            const s = statusGeral(a);
            const chips = chipsDe(a);
            const foto = fotoImovel(a.imovel);
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
                  <div style={{ fontSize: 12.5, color: '#64748b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[a.cidade, a.estado].filter(Boolean).join(', ')}</div>
                  <div style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {s && (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <s.Icon size={12} color={s.cor} style={s.spin ? { animation: 'spin 1s linear infinite' } : undefined} />
                        <span style={{ color: s.cor, fontWeight: 700 }}>{s.txt}</span>
                      </span>
                    )}
                    {chips.map((c, i) => (
                      <span key={i} style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: c.bg, color: c.c }}>{c.t}</span>
                    ))}
                  </div>
                </div>
                {casosPorImovel[String(a.imovelId)] && (
                  <button onClick={(e) => { e.stopPropagation(); nav('/caso/' + casosPorImovel[String(a.imovelId)].id); }}
                    title="Abrir acompanhamento com a equipe"
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 12px', background: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: 10, fontWeight: 700, fontSize: 12, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}>
                    <Briefcase size={13} /> {ETAPA_CURTA[casosPorImovel[String(a.imovelId)].status_etapa] || 'Acompanhamento'}
                  </button>
                )}
                <button onClick={(e) => { e.stopPropagation(); remover(a.imovelId); }} title="Remover" style={{ background: 'none', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 4, flexShrink: 0 }}>×</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
