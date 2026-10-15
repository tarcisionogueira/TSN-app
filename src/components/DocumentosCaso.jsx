import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, User, Gavel, FileQuestion, ExternalLink, Loader2, FileBarChart } from 'lucide-react';
import { apiCall } from '../utils/apiCall';
import { useAuth } from '../contexts/AuthContext';

/**
 * Documentos do caso, organizados pela IA (15/10, pedido do dono): "separando os documentos pessoais e os
 * documentos da arrematação". A lista vem de `caso_documentos` (caso-documentos-cron lê cada anexo dos
 * e-mails do caso). Abrir = link assinado de 30 min (api/caso-documentos.js). "Mover" corrige o grupo
 * quando a IA errar e fica registrado (grupo_ia + corrigido_por).
 */
const GRUPOS = [
  { id: 'pessoal', titulo: 'Documentos pessoais', icone: User, cor: '#7c3aed' },
  { id: 'arrematacao', titulo: 'Documentos da arrematação', icone: Gavel, cor: '#0D63DB' },
  { id: 'outro', titulo: 'Outros', icone: FileQuestion, cor: '#64748b' },
];
const TIPO_ROTULO = {
  rg: 'RG', cnh: 'CNH', cpf: 'CPF', comprovante_residencia: 'Comprovante de residência', certidao_casamento: 'Certidão de casamento',
  certidao_nascimento: 'Certidão de nascimento', procuracao: 'Procuração', edital: 'Edital', matricula: 'Matrícula',
  auto_arrematacao: 'Auto de arrematação', carta_arrematacao: 'Carta de arrematação', guia_deposito: 'Guia de depósito',
  itbi: 'ITBI', iptu: 'IPTU', decisao_judicial: 'Decisão judicial', exigencia_cartorio: 'Exigência do cartório',
  nota_devolucao: 'Nota de devolução', notificacao: 'Notificação', comprovante_pagamento: 'Comprovante de pagamento',
  parecer_juridico: 'Parecer jurídico', laudo: 'Laudo', contrato: 'Contrato', outro: 'Outro',
};
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : null);

export default function DocumentosCaso({ casoId, podeMover = false, cardStyle }) {
  const [docs, setDocs] = useState(null);
  const [erro, setErro] = useState('');
  const [abrindo, setAbrindo] = useState(null);
  const [movendo, setMovendo] = useState(null);
  const [rel, setRel] = useState({ relatorios: [], imovel_id: null, cliente: null, imovel: null });
  const { iniciarSuporte, podeImpersonar } = useAuth();
  const nav = useNavigate();

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const r = await apiCall(`/api/caso-documentos?caso_id=${encodeURIComponent(casoId)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDocs(d.documentos || []);
      setRel({ relatorios: d.relatorios || [], imovel_id: d.imovel_id || null, cliente: d.cliente || null, imovel: d.imovel || null });
    } catch (e) { console.error("[DocumentosCaso] carregar:", e?.message); setErro(`Não foi possível carregar os documentos: ${e.message}`); setDocs([]); }
  }, [casoId]);
  useEffect(() => { if (casoId) carregar(); }, [casoId, carregar]);

  const abrir = async (doc) => {
    setAbrindo(doc.id);
    // Janela aberta no clique (antes do await): Safari/iPhone bloqueia window.open depois de uma espera.
    const janela = window.open('', '_blank');
    try {
      const r = await apiCall(`/api/caso-documentos?id=${encodeURIComponent(doc.id)}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || `HTTP ${r.status}`);
      if (janela) janela.location.href = d.url; else window.location.href = d.url;
    } catch (e) { console.error("[DocumentosCaso] abrir:", e?.message); if (janela) janela.close(); setErro(`Não foi possível abrir "${doc.titulo || doc.nome}": ${e.message}`); }
    finally { setAbrindo(null); }
  };

  const mover = async (doc, grupo) => {
    if (grupo === doc.grupo) return;
    setMovendo(doc.id);
    try {
      const r = await apiCall('/api/caso-documentos', { method: 'POST', body: JSON.stringify({ id: doc.id, grupo }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || `HTTP ${r.status}`);
      setDocs((lista) => lista.map((x) => (x.id === doc.id ? { ...x, grupo: d.grupo, corrigido_por: 'eu' } : x)));
    } catch (e) { console.error("[DocumentosCaso] mover:", e?.message); setErro(`Não foi possível mover: ${e.message}`); }
    finally { setMovendo(null); }
  };

  // Os relatórios são do CLIENTE: abrir (ou gerar em nome dele) é pelo modo suporte, o mesmo caminho do
  // Admin ao atribuir um arremate (prosseguirGerarRelatorios) — a tela /analise lê as análises de quem se vê.
  const abrirRelatorio = (gerar) => {
    if (!rel.cliente || !rel.imovel_id) return;
    iniciarSuporte({ id: rel.cliente.id, nome: rel.cliente.nome, role: rel.cliente.role });
    const imovel = rel.imovel ? { id: rel.imovel_id, ...rel.imovel } : undefined;
    nav(`/analise?imovel=${encodeURIComponent(rel.imovel_id)}`, { state: gerar
      ? { manual: true, autoGerar: true, paraUserId: rel.cliente.id, imovel }
      : (imovel ? { imovel } : {}) });
  };
  const faltaRelatorio = rel.relatorios.some((r) => r.status !== 'concluida');

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <FolderOpen size={18} color="#0D63DB" />
        <div style={{ fontSize: 15, fontWeight: 800, color: '#111111' }}>Documentos do caso</div>
        {docs && <span style={{ fontSize: 12, color: '#64748b' }}>{docs.length} documento(s)</span>}
      </div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        Organizados pela IA a partir dos anexos dos e-mails do caso. Chegou anexo novo por e-mail, ele entra aqui sozinho.
      </div>
      {erro && <div style={{ fontSize: 12.5, color: '#b91c1c', marginBottom: 10 }}>{erro}</div>}
      {rel.relatorios.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: '#0f766e', marginBottom: 8 }}>
            <FileBarChart size={15} /> Relatórios BidPro do imóvel
          </div>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
            {rel.relatorios.map((r) => (
              <div key={r.tipo} style={{ fontSize: 13, color: '#111111', padding: '3px 0' }}>
                {r.titulo}: {r.status === 'concluida'
                  ? <span style={{ color: '#0f766e', fontWeight: 700 }}>pronto{dataBR(r.updated_at) ? ` em ${dataBR(r.updated_at)}` : ''}</span>
                  : <span style={{ color: '#b45309', fontWeight: 700 }}>{r.status ? r.status.replace(/_/g, ' ') : 'não gerado'}</span>}
              </div>
            ))}
            {podeImpersonar ? (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {rel.relatorios.some((r) => r.status === 'concluida') && (
                  <button onClick={() => abrirRelatorio(false)} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, padding: '7px 12px', borderRadius: 8, border: 'none', background: '#0D63DB', color: 'white', cursor: 'pointer' }}>
                    <ExternalLink size={13} /> Abrir relatórios
                  </button>
                )}
                {faltaRelatorio && (
                  <button onClick={() => abrirRelatorio(true)} style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 12px', borderRadius: 8, border: '1px solid #0D63DB', background: 'white', color: '#0D63DB', cursor: 'pointer' }}>
                    Gerar os que faltam
                  </button>
                )}
              </div>
            ) : (
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 6 }}>Abrir e gerar relatórios do cliente é feito por admin ou analista (modo suporte).</div>
            )}
          </div>
        </div>
      )}
      {!rel.imovel_id && docs !== null && <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8 }}>Este caso não tem imóvel vinculado: os relatórios BidPro aparecem aqui quando houver.</div>}
      {docs === null && <div style={{ fontSize: 13, color: '#64748b' }}><Loader2 size={14} style={{ verticalAlign: -2 }} /> Carregando…</div>}
      {docs && docs.length === 0 && !erro && <div style={{ fontSize: 13, color: '#64748b' }}>Nenhum documento organizado ainda.</div>}
      {docs && docs.length > 0 && GRUPOS.map((g) => {
        const lista = docs.filter((d) => d.grupo === g.id);
        if (!lista.length && g.id === 'outro') return null;
        const Icone = g.icone;
        return (
          <div key={g.id} style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 800, color: g.cor, marginBottom: 8 }}>
              <Icone size={15} /> {g.titulo} <span style={{ color: '#94a3b8', fontWeight: 600 }}>({lista.length})</span>
            </div>
            {!lista.length && <div style={{ fontSize: 12.5, color: '#94a3b8', paddingLeft: 23 }}>Nenhum documento neste grupo.</div>}
            {lista.map((d) => (
              <div key={d.id} style={{ border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ flex: '1 1 260px', minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: '#111111' }}>{d.titulo || d.nome}</div>
                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 2 }}>
                      {TIPO_ROTULO[d.tipo] || d.tipo || 'Documento'}
                      {dataBR(d.data_documento) ? ` · ${dataBR(d.data_documento)}` : ''}
                      {d.pessoa ? ` · ${d.pessoa}` : ''}
                      {!d.lido ? ' · classificado só pelo nome' : ''}
                      {d.corrigido_por ? ' · grupo corrigido manualmente' : ''}
                    </div>
                    {d.resumo && <div style={{ fontSize: 12.5, color: '#334155', marginTop: 6, lineHeight: 1.45 }}>{d.resumo}</div>}
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                    {podeMover && (
                      <select value={d.grupo} disabled={movendo === d.id} onChange={(e) => mover(d, e.target.value)}
                        title="Mover para outro grupo" style={{ fontSize: 12, padding: '6px 6px', border: '1px solid #cbd5e1', borderRadius: 8, background: 'white' }}>
                        {GRUPOS.map((o) => <option key={o.id} value={o.id}>{o.id === 'arrematacao' ? 'Arrematação' : o.id === 'pessoal' ? 'Pessoal' : 'Outro'}</option>)}
                      </select>
                    )}
                    <button onClick={() => abrir(d)} disabled={abrindo === d.id}
                      style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, fontWeight: 700, padding: '7px 12px', borderRadius: 8, border: 'none', background: '#0D63DB', color: 'white', cursor: 'pointer' }}>
                      {abrindo === d.id ? <Loader2 size={13} /> : <ExternalLink size={13} />} Abrir
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
