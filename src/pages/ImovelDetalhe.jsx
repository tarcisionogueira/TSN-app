import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Calendar, Tag, Building2, FileText, ExternalLink, BarChart2, AlertTriangle, CheckCircle, Clock, Home, Banknote, Paperclip, Upload, Trash2, ChevronDown, ChevronUp, UserCheck, ScrollText } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import ScoreRisco from '../components/ScoreRisco';
import { fmtBRL, fmtData, MODAL_LABEL } from '../utils/format';
import { caixaMatriculaUrl } from '../utils/caixa';

// Botões de documento só aparecem quando o valor é uma URL real — o scraper da
// Caixa às vezes grava rótulos ("Venda Direta Online", "Leilão SFI - Edital Único").
const ehUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim());
const ehMatriculaValida = (v) => ehUrl(v) && !/matricula\.asp/i.test(v);
// "Regras de venda" só é um DOCUMENTO de verdade quando não é a própria página do
// anúncio no portal (detalhe-imovel.asp da Caixa = mesmo destino do url_lote, já
// coberto pelo botão "Ver no portal"). Senão o botão abre o site, não um arquivo.
const ehRegrasDoc = (v, urlLote) => ehUrl(v) && !/detalhe-imovel\.asp/i.test(v) && v.trim() !== (urlLote || '').trim();

const TIPO_LABEL = { casa:'Casa', apartamento:'Apartamento', terreno:'Terreno/Lote', comercial:'Comercial', rural:'Rural', galpao:'Galpão', sala:'Sala Comercial', vaga:'Vaga de Garagem', imovel:'Imóvel' };

const TIPO_ANEXO_LABEL = {
  edital: 'Edital', auto_arrematacao: 'Auto de Arrematação', carta_arrematacao: 'Carta de Arrematação',
  matricula: 'Matrícula', contrato: 'Contrato', procuracao: 'Procuração', outro: 'Outro',
};
const TIPO_DOC_LABEL = {
  identidade: 'Identidade/CPF', comprovante_pagamento: 'Comprovante de Pagamento',
  procuracao: 'Procuração', cnd: 'CND/Certidão', outro: 'Outro',
};
const TIPO_DOC_IMOVEL = { matricula: 'Matrícula', edital: 'Edital', regras_venda: 'Regras de venda online' };
const STATUS_ARR = {
  em_processo: { label: 'Em Processo', bg: '#fef9c3', color: '#92400e' },
  finalizado:  { label: 'Finalizado',  bg: '#dcfce7', color: '#166534' },
  cancelado:   { label: 'Cancelado',   bg: '#fee2e2', color: '#991b1b' },
};

// Categorias de pontos próximos (legenda + cor dos pins). Chaves = as do cron.
const CATS_PROX = {
  praia:      { label: 'Praia',      emoji: '🏖️', cor: '#0891b2' },
  transporte: { label: 'Transporte', emoji: '🚌', cor: '#7c3aed' },
  mercado:    { label: 'Mercado',    emoji: '🛒', cor: '#16a34a' },
  farmacia:   { label: 'Farmácia',   emoji: '💊', cor: '#dc2626' },
  saude:      { label: 'Saúde',      emoji: '🏥', cor: '#ef4444' },
  escola:     { label: 'Escola',     emoji: '🏫', cor: '#f59e0b' },
  shopping:   { label: 'Shopping',   emoji: '🛍️', cor: '#db2777' },
};
const fmtDist = m => m >= 1000 ? `${(m / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km` : `${m} m`;

// Mapa embutido (Leaflet/OpenStreetMap) com o imóvel + pontos de interesse próximos.
function MiniMapa({ lat, lng, pontos }) {
  const ref = useRef(null);
  const mapRef = useRef(null);
  useEffect(() => {
    let cancel = false;
    import('leaflet').then(({ default: L }) => {
      if (cancel || !ref.current || mapRef.current) return;
      const map = L.map(ref.current, { scrollWheelZoom: false, attributionControl: false }).setView([lat, lng], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
      // Imóvel (marcador principal)
      L.circleMarker([lat, lng], { radius: 10, color: '#fff', weight: 3, fillColor: '#0D63DB', fillOpacity: 1 }).addTo(map).bindTooltip('Imóvel');
      // Pontos próximos
      const grupo = [[lat, lng]];
      for (const [key, p] of Object.entries(pontos || {})) {
        if (!p?.lat || !p?.lng) continue;
        const c = CATS_PROX[key]; if (!c) continue;
        L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 2, fillColor: c.cor, fillOpacity: 0.95 })
          .addTo(map).bindTooltip(`${c.emoji} ${c.label}${p.nome ? ' · ' + p.nome : ''} (${fmtDist(p.dist_m)})`);
        grupo.push([p.lat, p.lng]);
      }
      if (grupo.length > 1) { try { map.fitBounds(grupo, { padding: [30, 30], maxZoom: 16 }); } catch (_) {} }
      mapRef.current = map;
      setTimeout(() => map.invalidateSize(), 120);
    });
    return () => { cancel = true; if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; } };
  }, [lat, lng]);
  return <div ref={ref} style={{ height: 260, borderRadius: 12, overflow: 'hidden', border: '1px solid #e2e8f0' }} />;
}

// Imóveis semelhantes e próximos (mesma cidade/tipo, prioriza o mesmo bairro).
function ImoveisSimilares({ imovel, nav }) {
  const [itens, setItens] = useState([]);
  useEffect(() => {
    if (!imovel?.cidade) return;
    (async () => {
      let q = supabase.from('imoveis_leilao')
        .select('id,titulo,bairro,cidade,estado,valor_minimo,valor_avaliacao,link_foto,tipo,area_m2')
        .eq('ativo', true).eq('cidade', imovel.cidade).neq('id', imovel.id).limit(12);
      if (imovel.tipo) q = q.eq('tipo', imovel.tipo);
      const { data } = await q;
      let lista = data || [];
      // mesmo bairro primeiro
      lista.sort((a, b) => (b.bairro === imovel.bairro) - (a.bairro === imovel.bairro));
      setItens(lista.slice(0, 6));
    })();
  }, [imovel?.id, imovel?.cidade]);

  if (!itens.length) return null;
  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px', marginTop: 20 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <Home size={18} color="#0D63DB" /> Imóveis semelhantes e próximos
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 14 }}>
        {itens.map(it => {
          const desc = it.valor_avaliacao > 0 && it.valor_minimo ? Math.round((1 - it.valor_minimo / it.valor_avaliacao) * 100) : null;
          return (
            <button key={it.id} onClick={() => { nav('/imovel/' + it.id); window.scrollTo(0, 0); }}
              style={{ textAlign: 'left', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', background: 'white', cursor: 'pointer', padding: 0 }}>
              <div style={{ height: 110, background: '#f1f5f9', backgroundImage: it.link_foto ? `url(${it.link_foto})` : 'none', backgroundSize: 'cover', backgroundPosition: 'center', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {!it.link_foto && <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Sem foto</span>}
                {desc > 0 && <span style={{ position: 'absolute', top: 8, right: 8, background: '#16a34a', color: 'white', fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 8 }}>-{desc}%</span>}
              </div>
              <div style={{ padding: '10px 12px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#111', lineHeight: 1.3, height: 32, overflow: 'hidden' }}>{it.bairro || it.titulo}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 6px' }}>{it.cidade}/{it.estado}{it.area_m2 ? ` · ${it.area_m2} m²` : ''}</div>
                <div style={{ fontSize: 16, fontWeight: 900, color: '#0D63DB' }}>{fmtBRL(it.valor_minimo)}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SecaoArrematacao({ imovelId, imovelTitulo }) {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const [dados, setDados] = useState(null); // { arrematacao, anexos, docs }
  const [fluxoOk, setFluxoOk] = useState(false); // pipeline completo (até parecer jurídico)
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState({ processo: true, pessoal: true });
  const [modalAberto, setModalAberto] = useState(false);
  const [form, setForm] = useState({ arrematante_email: '', valor_arrematado: '', data_leilao: '', leiloeiro: '', numero_processo: '', observacoes: '' });
  const [salvando, setSalvando] = useState(false);
  const [uploadando, setUploadando] = useState({});
  const inputProcessoRef = useRef();
  const inputPessoalRef = useRef();

  const ROLES_ESCRITA = ['admin', 'analista'];
  const ROLES_LEITURA = ['admin', 'analista', 'advogado', 'consultor'];
  const podeVer = ROLES_LEITURA.includes(role) || dados?.arrematacao?.arrematante_id === user?.id;
  const podeEscrever = ROLES_ESCRITA.includes(role);
  const podeAnexo = podeEscrever || role === 'advogado';

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token;

  const carregar = async () => {
    setLoading(true);
    try {
      const t = await token();
      const r = await fetch(`/api/arrematacoes?imovel_id=${imovelId}`, { headers: { Authorization: `Bearer ${t}` } });
      if (r.ok) setDados(await r.json());
      // Só libera "Registrar Arrematação" após o fluxo: análise + relatórios +
      // reunião + devolutiva jurídica (status_etapa >= juridico_concluido).
      const ETAPAS_PRONTO = ['juridico_concluido', 'segunda_reuniao', 'arrematado', 'honorarios_pagos', 'procuracao_assinada', 'pos_arrematacao'];
      const { data: cs } = await supabase.from('casos').select('status_etapa').eq('imovel_id', imovelId);
      setFluxoOk((cs || []).some(c => ETAPAS_PRONTO.includes(c.status_etapa)));
    } finally { setLoading(false); }
  };

  useEffect(() => { if (user && (ROLES_LEITURA.includes(role) || role === 'assessorado' || role === 'explorador')) carregar(); else setLoading(false); }, [user, role]); // eslint-disable-line

  const registrar = async () => {
    setSalvando(true);
    try {
      // Busca arrematante pelo email
      const { data: perfis } = await supabase.from('perfis').select('id,nome').ilike('email', form.arrematante_email.trim()).limit(1);
      if (!perfis?.length) { alert('Usuário não encontrado com esse email'); setSalvando(false); return; }
      const arrematante_id = perfis[0].id;
      const t = await token();
      const r = await fetch('/api/arrematacoes', {
        method: 'POST',
        headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ imovel_id: imovelId, arrematante_id, valor_arrematado: parseFloat(form.valor_arrematado) || null, data_leilao: form.data_leilao || null, leiloeiro: form.leiloeiro, numero_processo: form.numero_processo, observacoes: form.observacoes }),
      });
      if (r.ok) { setModalAberto(false); carregar(); }
      else { const e = await r.json(); alert(e.error || 'Erro ao registrar'); }
    } finally { setSalvando(false); }
  };

  const atualizarStatus = async (status) => {
    const t = await token();
    await fetch(`/api/arrematacoes?id=${dados.arrematacao.id}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    carregar();
  };

  const uploadAnexo = async (file, tabela) => {
    if (!file) return;
    const key = `${tabela}_${file.name}`;
    setUploadando(u => ({ ...u, [key]: true }));
    try {
      const t = await token();
      const arrId = dados?.arrematacao?.id || 'geral';
      const tipo = tabela === 'imovel' ? 'outro' : 'outro';
      const nomeArq = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      // Pega URL assinada
      const signR = await fetch(`/api/arrematacoes?signed_url=1&arrematacao_id=${arrId}&tipo=${tipo}&nome=${nomeArq}&tabela=${tabela}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!signR.ok) { alert('Erro ao preparar upload'); return; }
      const { signedURL, publicUrl } = await signR.json();

      // Upload direto para Storage
      const upR = await fetch(signedURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      if (!upR.ok) { alert('Erro no upload'); return; }

      // Salva registro
      if (tabela === 'imovel') {
        const r = await fetch(`/api/arrematacoes?anexo=1`, {
          method: 'POST', headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ arrematacao_id: arrId, imovel_id: imovelId, tipo, nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) }),
        });
        if (!r.ok) alert('Erro ao registrar anexo');
      } else {
        await supabase.from('usuario_docs').insert({ user_id: user.id, arrematacao_id: arrId, tipo, nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) });
      }
      carregar();
    } finally { setUploadando(u => ({ ...u, [key]: false })); }
  };

  const deletarAnexo = async (id, tabela) => {
    if (!confirm('Remover documento?')) return;
    const t = await token();
    await fetch(`/api/arrematacoes?id=${id}&tabela=${tabela}`, { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } });
    carregar();
  };

  const deletarDocPessoal = async (id) => {
    if (!confirm('Remover documento?')) return;
    await supabase.from('usuario_docs').delete().eq('id', id).eq('user_id', user.id);
    carregar();
  };

  if (!user || loading) return null;
  if (!podeVer && !podeEscrever) return null;

  const arr = dados?.arrematacao;
  const statusInfo = arr ? (STATUS_ARR[arr.status] || STATUS_ARR.em_processo) : null;

  return (
    <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: 24, marginTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: arr ? 16 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <UserCheck size={18} color="#7c3aed" />
          <span style={{ fontWeight: 800, fontSize: 15, color: '#111' }}>Arrematação</span>
          {arr && <span style={{ fontSize: 12, fontWeight: 700, padding: '2px 10px', borderRadius: 999, background: statusInfo.bg, color: statusInfo.color }}>{statusInfo.label}</span>}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {arr && (podeEscrever || role === 'advogado') && (
            <button
              onClick={() => nav('/contratos/novo', { state: { tipo: 'procuracao', contexto: `Procuração para arrematação do imóvel: ${imovelTitulo}. Processo nº ${arr.numero_processo || 'não informado'}. Arrematante: ${arr.arrematante_nome || arr.arrematante_id}.` } })}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, border: 'none', background: '#eff6ff', color: '#1d4ed8', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              <ScrollText size={12} /> Gerar Procuração
            </button>
          )}
          {arr && podeEscrever && arr.status === 'em_processo' && (
            <button onClick={() => atualizarStatus('finalizado')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#dcfce7', color: '#166534', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>✓ Finalizar</button>
          )}
          {arr && podeEscrever && arr.status !== 'cancelado' && (
            <button onClick={() => atualizarStatus('cancelado')} style={{ padding: '5px 12px', borderRadius: 8, border: 'none', background: '#fee2e2', color: '#991b1b', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>✕ Cancelar</button>
          )}
          {!arr && podeEscrever && fluxoOk && (
            <button onClick={() => setModalAberto(true)} style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#7c3aed', color: 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Registrar Arrematação</button>
          )}
          {!arr && podeEscrever && !fluxoOk && (
            <span style={{ fontSize: 12, color: '#94a3b8', fontStyle: 'italic', maxWidth: 320, textAlign: 'right' }}>
              Disponível após concluir análise, relatórios, reunião e o parecer jurídico.
            </span>
          )}
        </div>
      </div>

      {arr && (
        <>
          {/* Info da arrematação */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 20, background: '#f8fafc', borderRadius: 10, padding: 14 }}>
            {arr.arrematante_nome && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>ARREMATANTE</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.arrematante_nome}</div></div>}
            {arr.valor_arrematado && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>VALOR ARREMATADO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#059669' }}>R$ {Number(arr.valor_arrematado).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div></div>}
            {arr.data_leilao && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>DATA DO LEILÃO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{new Date(arr.data_leilao + 'T12:00:00').toLocaleDateString('pt-BR')}</div></div>}
            {arr.leiloeiro && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>LEILOEIRO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.leiloeiro}</div></div>}
            {arr.numero_processo && <div><div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Nº PROCESSO</div><div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{arr.numero_processo}</div></div>}
          </div>
          {arr.observacoes && <div style={{ fontSize: 13, color: '#475569', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', marginBottom: 16 }}>{arr.observacoes}</div>}

          {/* Documentos do processo */}
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, marginBottom: 12 }}>
            <button onClick={() => setAberto(a => ({ ...a, processo: !a.processo }))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#111' }}>
                <Paperclip size={14} color="#7c3aed" /> Documentos do Processo
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>({(dados.anexos || []).length})</span>
              </div>
              {aberto.processo ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
            </button>
            {aberto.processo && (
              <div style={{ padding: '0 16px 14px' }}>
                {(dados.anexos || []).length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>Nenhum documento adicionado.</div>}
                {(dados.anexos || []).map(a => (
                  <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <FileText size={14} color="#7c3aed" />
                      <a href={a.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0D63DB', fontWeight: 600, textDecoration: 'none' }}>{a.nome}</a>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>{TIPO_ANEXO_LABEL[a.tipo] || a.tipo}</span>
                    </div>
                    {podeEscrever && <button onClick={() => deletarAnexo(a.id, 'imovel_anexos')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={13} /></button>}
                  </div>
                ))}
                {podeAnexo && (
                  <div style={{ marginTop: 10 }}>
                    <input ref={inputProcessoRef} type="file" style={{ display: 'none' }} onChange={e => { uploadAnexo(e.target.files[0], 'imovel'); e.target.value = ''; }} />
                    <button onClick={() => inputProcessoRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px dashed #c4b5fd', background: '#faf5ff', color: '#7c3aed', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      <Upload size={13} /> Adicionar documento
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Documentos pessoais (só o arrematante e admin/analista) */}
          {(arr.arrematante_id === user?.id || podeEscrever) && (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10 }}>
              <button onClick={() => setAberto(a => ({ ...a, pessoal: !a.pessoal }))} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'none', border: 'none', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13, color: '#111' }}>
                  👤 Meus Documentos
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>({(dados.docs || []).length}) · privado</span>
                </div>
                {aberto.pessoal ? <ChevronUp size={15} color="#94a3b8" /> : <ChevronDown size={15} color="#94a3b8" />}
              </button>
              {aberto.pessoal && (
                <div style={{ padding: '0 16px 14px' }}>
                  {(dados.docs || []).length === 0 && <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 10 }}>Nenhum documento pessoal adicionado.</div>}
                  {(dados.docs || []).map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <FileText size={14} color="#0891b2" />
                        <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: '#0D63DB', fontWeight: 600, textDecoration: 'none' }}>{d.nome}</a>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>{TIPO_DOC_LABEL[d.tipo] || d.tipo}</span>
                      </div>
                      <button onClick={() => deletarDocPessoal(d.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444' }}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <div style={{ marginTop: 10 }}>
                    <input ref={inputPessoalRef} type="file" style={{ display: 'none' }} onChange={async e => {
                      const file = e.target.files[0]; if (!file) return;
                      const key = `pessoal_${file.name}`; setUploadando(u => ({ ...u, [key]: true }));
                      try {
                        const t = await token();
                        const arrId = dados?.arrematacao?.id || 'geral';
                        const nomeArq = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                        const signR = await fetch(`/api/arrematacoes?signed_url=1&arrematacao_id=${arrId}&tipo=outro&nome=${nomeArq}&tabela=usuario`, { headers: { Authorization: `Bearer ${t}` } });
                        if (!signR.ok) { alert('Erro ao preparar upload'); return; }
                        const { signedURL, publicUrl } = await signR.json();
                        const upR = await fetch(signedURL, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
                        if (!upR.ok) { alert('Erro no upload'); return; }
                        await supabase.from('usuario_docs').insert({ user_id: user.id, arrematacao_id: arrId, tipo: 'outro', nome: file.name, url: publicUrl, tamanho_kb: Math.round(file.size / 1024) });
                        carregar();
                      } finally { setUploadando(u => ({ ...u, [key]: false })); e.target.value = ''; }
                    }} />
                    <button onClick={() => inputPessoalRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7, border: '1px dashed #bae6fd', background: '#f0f9ff', color: '#0891b2', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>
                      <Upload size={13} /> Adicionar meu documento
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Modal registrar arrematação */}
      {modalAberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={e => { if (e.target === e.currentTarget) setModalAberto(false); }}>
          <div style={{ background: 'white', borderRadius: 14, padding: 28, width: '100%', maxWidth: 520, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Registrar Arrematação</div>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 20 }}>{imovelTitulo}</div>
            {[
              { label: 'E-mail do arrematante *', key: 'arrematante_email', type: 'email', placeholder: 'usuario@email.com' },
              { label: 'Valor arrematado (R$)', key: 'valor_arrematado', type: 'number', placeholder: '0,00' },
              { label: 'Data do leilão', key: 'data_leilao', type: 'date' },
              { label: 'Leiloeiro', key: 'leiloeiro', type: 'text', placeholder: 'Nome do leiloeiro' },
              { label: 'Nº do Processo', key: 'numero_processo', type: 'text', placeholder: '0000000-00.0000.0.00.0000' },
            ].map(({ label, key, type, placeholder }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>{label}</label>
                <input type={type} value={form[key]} onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} placeholder={placeholder}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', outline: 'none' }} />
              </div>
            ))}
            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Observações</label>
              <textarea value={form.observacoes} onChange={e => setForm(f => ({ ...f, observacoes: e.target.value }))} rows={3} placeholder="Informações adicionais..."
                style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, boxSizing: 'border-box', resize: 'vertical', outline: 'none' }} />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setModalAberto(false)} style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #e2e8f0', background: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer', color: '#475569' }}>Cancelar</button>
              <button onClick={registrar} disabled={salvando || !form.arrematante_email} style={{ flex: 2, padding: 10, borderRadius: 8, border: 'none', background: salvando ? '#c4b5fd' : '#7c3aed', color: 'white', fontWeight: 700, fontSize: 13, cursor: salvando ? 'default' : 'pointer' }}>{salvando ? 'Salvando...' : 'Registrar Arrematação'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


export default function ImovelDetalhe() {
  const nav = useNavigate();
  const loc = useLocation();
  const { id: paramId } = useParams();
  const { user, role } = useAuth();
  const [imovel, setImovel] = useState(loc.state?.imovel || null);
  const [anexosDocs, setAnexosDocs] = useState([]);
  const [buscandoDocs, setBuscandoDocs] = useState('');
  const [filaDocs, setFilaDocs] = useState(null); // status da fila de captura CEF (persiste no F5)
  const [loading, setLoading] = useState(!loc.state?.imovel);
  const [imgIdx, setImgIdx] = useState(0); // índice do candidato de foto atual (fallback em cascata)

  const id = loc.state?.imovel?.id || paramId;

  useEffect(() => {
    // A busca por raio passa o imóvel no state SEM edital/matrícula/descrição.
    // Se esses documentos faltam, busca o registro completo no banco (o state
    // serve só para o paint imediato, sem spinner).
    // Já temos ESTE imóvel com documentos? então não precisa buscar.
    const jaCarregado = imovel && imovel.id === id && (imovel.linkEdital || imovel.linkMatricula || imovel.descricao);
    if (jaCarregado) return;
    if (!id) { nav('/buscar'); return; }
    // Navegou para outro imóvel (ex.: card de similares) → recarrega do zero.
    if (!imovel || imovel.id !== id) { setLoading(true); setImgIdx(0); setAnexosDocs([]); }
    supabase.from('imoveis_leilao').select('*').eq('id', id).single()
      .then(({ data }) => {
        if (!data) { if (!imovel) nav('/buscar'); return; }
        setImovel({
          id: data.id, titulo: data.titulo, tipo: data.tipo, modalidade: data.modalidade,
          estado: data.estado, cidade: data.cidade, bairro: data.bairro, endereco: data.endereco,
          valorAvaliacao: data.valor_avaliacao, valorMinimo: data.valor_minimo,
          descontoPercentual: data.desconto_percentual, areaM2: data.area_m2, descricao: data.descricao,
          urlLote: data.url_lote || data.link_edital || data.link_regras_venda, linkEdital: data.link_edital, linkMatricula: data.link_matricula, linkRegrasVenda: data.link_regras_venda,
          foto: data.link_foto, leiloeiro: data.leiloeiro, dataLeilao: data.data_leilao,
          pagamento: [data.forma_pagamento], fonte: data.fonte, fonteId: data.fonte_id,
          numeroEdital: data.numero_edital, numeroMatricula: data.numero_matricula,
          numeroProcesso: data.numero_processo,
          latitude: data.latitude, longitude: data.longitude, pontosProximos: data.pontos_proximos,
          scoreFinanceiro: data.score_financeiro ?? null,
          scoreJuridico: data.score_juridico ?? null,
        });
      })
      .finally(() => setLoading(false));
  }, [id]);

  // On-demand: se o imóvel tem coordenada mas ainda não tem pontos próximos,
  // calcula na hora (não espera o cron) — útil para imóveis recém-abertos.
  useEffect(() => {
    const la = imovel?.latitude ?? imovel?.lat, lo = imovel?.longitude ?? imovel?.lng;
    const temC = la != null && lo != null && !(Number(la) === 0 && Number(lo) === 0);
    if (!imovel?.id || !temC || imovel.pontosProximos) return;
    let cancel = false;
    apiCall(`/api/proximidades-imovel?imovel_id=${imovel.id}`).then(r => r.json()).then(d => {
      if (!cancel && d?.pontos && Object.keys(d.pontos).length) {
        setImovel(prev => prev ? { ...prev, pontosProximos: d.pontos } : prev);
      }
    }).catch(() => {});
    return () => { cancel = true; };
  }, [imovel?.id, imovel?.pontosProximos]);

  // Documentos do imóvel (matrícula/edital/regra) capturados/anexados — clientes
  // logados podem ver e baixar (RLS libera esses tipos).
  useEffect(() => {
    if (!imovel?.id) return;
    let cancel = false;
    supabase.from('imovel_anexos').select('tipo,nome,url').eq('imovel_id', imovel.id)
      .in('tipo', ['matricula', 'edital', 'regras_venda']).not('storage_path', 'is', null)
      .then(({ data }) => { if (!cancel) setAnexosDocs(data || []); });
    return () => { cancel = true; };
  }, [imovel?.id]);

  // Status da fila de captura CEF (staff) — persiste entre F5 para não parecer
  // que "nada aconteceu" enquanto o lote (cron ~10min) ainda não rodou.
  useEffect(() => {
    if (!imovel?.id || !['admin', 'analista'].includes(role) || !/caixa|cef/i.test(imovel.fonte || '')) return;
    let cancel = false;
    supabase.from('cef_matricula_fila').select('status,criado_em,processado_em,erro').eq('imovel_id', imovel.id).maybeSingle()
      .then(({ data }) => { if (!cancel) setFilaDocs(data || null); });
    return () => { cancel = true; };
  }, [imovel?.id, role, imovel?.fonte]);

  const buscarDocsCaixa = async () => {
    setBuscandoDocs('loading');
    try {
      const r = await apiCall('/api/capturar-matricula-cef', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imovel_id: imovel.id }) });
      if (r.ok) { setBuscandoDocs('ok'); setFilaDocs({ status: 'pendente', criado_em: new Date().toISOString() }); }
      else setBuscandoDocs('erro');
    } catch { setBuscandoDocs('erro'); }
  };

  // Enquanto a captura CEF está na fila, busca os anexos periodicamente e os exibe
  // assim que ficarem prontos — sem o usuário precisar atualizar a página. Para
  // quando os documentos chegam ou quando a fila marca erro (captura indisponível).
  useEffect(() => {
    if (!imovel?.id) return;
    const ativo = buscandoDocs === 'ok' || ['pendente', 'processando'].includes(filaDocs?.status);
    if (!ativo || anexosDocs.length > 0) return;
    let cancel = false, n = 0, timer;
    const tick = async () => {
      if (cancel) return;
      n++;
      const { data } = await supabase.from('imovel_anexos').select('tipo,nome,url')
        .eq('imovel_id', imovel.id).in('tipo', ['matricula', 'edital', 'regras_venda']).not('storage_path', 'is', null);
      if (cancel) return;
      if (data && data.length) { setAnexosDocs(data); setBuscandoDocs(''); return; }
      const { data: f } = await supabase.from('cef_matricula_fila').select('status,erro').eq('imovel_id', imovel.id).maybeSingle();
      if (cancel) return;
      if (f) setFilaDocs(prev => ({ ...prev, ...f }));
      if (f?.status === 'erro') return; // captura falhou — não fica pollando à toa
      if (n < 45) timer = setTimeout(tick, 20000); // ~15 min
    };
    timer = setTimeout(tick, 20000);
    return () => { cancel = true; clearTimeout(timer); };
  }, [imovel?.id, buscandoDocs, filaDocs?.status, anexosDocs.length]);

  if (loading) return (
    <div style={{ minHeight: '80vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', color: '#64748b' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
        <div style={{ fontWeight: 600 }}>Carregando imóvel…</div>
      </div>
    </div>
  );

  if (!imovel) return null;

  const desc = imovel.descontoPercentual || 0;
  const descLabel = Number(desc).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const descColor = desc >= 40 ? '#15803d' : desc >= 20 ? '#92400e' : '#dc2626';
  const descBg    = desc >= 40 ? '#dcfce7' : desc >= 20 ? '#fef9c3' : '#fee2e2';

  // Foto da Caixa: hotlink DIRETO (navegador do usuário; o IP da Vercel é bloqueado
  // pela Caixa). Padrão F{numero}21.jpg. onError no <img> cai no placeholder.
  const caixaFotoUrl = () => {
    const id = (imovel.fonteId || '').replace(/^(caixa_|cef_)/, '');
    return id ? `https://venda-imoveis.caixa.gov.br/fotos/F${id}21.jpg` : null;
  };
  // Candidatos de foto, em ordem de preferência. O <img> tenta o primeiro e,
  // no onError, avança para o próximo (imgIdx). A LISTA de similares carrega a
  // foto por hotlink DIRETO e funciona — então no detalhe priorizamos o mesmo
  // hotlink direto e só caímos no proxy/padrão-Caixa se ele falhar.
  const getImgCandidates = () => {
    const foto = imovel.foto;
    const isCef = imovel.fonte === 'CEF' || imovel.fonte === 'caixa';
    // Já hospedado por nós (supabase) ou caminho local: usa direto.
    if (foto && (foto.includes('supabase.co') || foto.startsWith('/'))) return [foto];
    const cands = [];
    if (foto && /^https?:\/\//.test(foto)) cands.push(foto);                 // 1) hotlink direto (igual à lista)
    if (isCef) { const c = caixaFotoUrl(); if (c) cands.push(c); }           // 2) padrão de foto da Caixa por id
    else if (foto && /^https?:\/\//.test(foto)) cands.push(`/api/img-proxy?url=${encodeURIComponent(foto)}`); // 3) proxy (fontes que bloqueiam hotlink por referer)
    return cands;
  };
  const imgCandidates = getImgCandidates();
  const imgDetalheSrc = imgCandidates[imgIdx] || null;
  const PLANOS_ANALISE = ['admin', 'analista', 'assessorado'];
  const podeFazerAnalise = PLANOS_ANALISE.includes(role);
  const economia = imovel.valorAvaliacao && imovel.valorMinimo ? imovel.valorAvaliacao - imovel.valorMinimo : null;
  const precoM2 = imovel.areaM2 > 0 && imovel.valorMinimo ? imovel.valorMinimo / imovel.areaM2 : null;

  // Documentos: só conta o que é arquivo/link de verdade (não a página do portal).
  const temEditalDoc = ehUrl(imovel.linkEdital);
  // Matrícula CEF: PDF estático em /editais/matricula/<UF>/<num>.pdf (o matricula.asp
  // dá 404). Hotlink direto funciona no navegador do usuário.
  const matriculaUrl = caixaMatriculaUrl({ fonte: imovel.fonte, estado: imovel.estado, fonteId: imovel.fonteId })
    || (ehMatriculaValida(imovel.linkMatricula) ? imovel.linkMatricula : null);
  const temMatriculaDoc = !!matriculaUrl;
  const temRegrasDoc = ehRegrasDoc(imovel.linkRegrasVenda, imovel.urlLote);
  const temNumerosRef = !!(imovel.numeroEdital || imovel.numeroMatricula || imovel.numeroProcesso);
  const podeBuscarDocsCaixa = ['admin', 'analista'].includes(role) && /caixa|cef/i.test(imovel.fonte || '') && !anexosDocs.some(a => a.tipo === 'matricula');
  const temCardDocumentos = anexosDocs.length > 0 || temNumerosRef || temEditalDoc || temMatriculaDoc || temRegrasDoc || podeBuscarDocsCaixa;

  // Localização no Google: Street View por coordenadas (quando geocodificado) ou
  // busca pelo endereço. Sem chave de API — usa as URLs públicas do Google Maps.
  const _lat = imovel.latitude ?? imovel.lat;
  const _lng = imovel.longitude ?? imovel.lng;
  const temCoord = _lat != null && _lng != null && !(Number(_lat) === 0 && Number(_lng) === 0);
  const enderecoCompleto = [imovel.endereco, imovel.bairro, imovel.cidade, imovel.estado, 'Brasil'].filter(Boolean).join(', ');
  const temLocal = temCoord || !!(imovel.endereco || imovel.cidade);
  // Endereço completo (rua + número) é mais preciso que a coordenada geocodificada
  // (que costuma cair no centro do bairro/cidade). Quando há endereço, priorizamos.
  const temEnderecoPreciso = !!(imovel.endereco && /\d/.test(imovel.endereco));
  const qEndereco = encodeURIComponent(enderecoCompleto);
  const streetViewUrl = temEnderecoPreciso
    ? `https://www.google.com/maps/search/?api=1&query=${qEndereco}`
    : temCoord
      ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${_lat},${_lng}`
      : `https://www.google.com/maps/search/?api=1&query=${qEndereco}`;
  const mapaUrl = temEnderecoPreciso
    ? `https://www.google.com/maps/search/?api=1&query=${qEndereco}`
    : temCoord
      ? `https://www.google.com/maps/search/?api=1&query=${_lat},${_lng}`
      : `https://www.google.com/maps/search/?api=1&query=${qEndereco}`;

  return (
    <div style={{ background: '#f8fafc', minHeight: '100vh', paddingBottom: 80 }}>

      {/* Breadcrumb */}
      <div style={{ background: '#111111', padding: '12px 20px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 600, padding: 0 }}>
            <ArrowLeft size={15} /> Voltar à busca
          </button>
          <span style={{ color: '#334155', fontSize: 13 }}>/</span>
          <span style={{ color: '#64748b', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{imovel.titulo || 'Imóvel'}</span>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 20px 0' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }} className="detalhe-grid">

          {/* Coluna esquerda */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Foto + badges */}
            <div style={{ borderRadius: 16, overflow: 'hidden', position: 'relative', background: '#111111', minHeight: 260 }}>
              {imgDetalheSrc ? (
                <img src={imgDetalheSrc} alt={imovel.titulo} onError={() => setImgIdx(i => i + 1)}
                  style={{ width: '100%', height: 320, objectFit: 'cover', display: 'block' }} />
              ) : (
                <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8, color: '#475569' }}>
                  <Home size={48} color="#334155" />
                  <span style={{ fontSize: 13 }}>Sem foto disponível</span>
                </div>
              )}
              <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {imovel.tipo && <span style={{ background: '#111111', color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{TIPO_LABEL[imovel.tipo] || imovel.tipo}</span>}
                {imovel.modalidade && <span style={{ background: '#084BA6', color: 'white', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 20 }}>{MODAL_LABEL[imovel.modalidade] || imovel.modalidade}</span>}
              </div>
              {desc > 0 && (
                <div style={{ position: 'absolute', top: 16, right: 16, background: descBg, color: descColor, fontWeight: 900, fontSize: 18, padding: '6px 12px', borderRadius: 10, lineHeight: 1 }}>
                  -{descLabel}%
                </div>
              )}
            </div>

            {/* Título e localização */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h1 style={{ fontSize: 'clamp(16px, 3vw, 22px)', fontWeight: 800, color: '#111111', margin: '0 0 12px', lineHeight: 1.3 }}>
                {imovel.titulo || 'Imóvel em leilão'}
              </h1>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, color: '#64748b', fontSize: 14 }}>
                {(imovel.endereco || imovel.cidade) && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <MapPin size={14} color="#0D63DB" />
                    {[imovel.endereco, imovel.bairro, imovel.cidade, imovel.estado].filter(Boolean).join(', ')}
                  </span>
                )}
                {imovel.areaM2 > 0 && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Building2 size={14} color="#8b5cf6" /> {imovel.areaM2} m²
                  </span>
                )}
                {imovel.leiloeiro && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tag size={14} color="#0891b2" /> {imovel.leiloeiro}
                  </span>
                )}
              </div>
              {/* Localização: mapa embutido + botões para abrir no Google */}
              {temLocal && (
                <div style={{ marginTop: 16 }}>
                  {temCoord && <MiniMapa key={imovel.pontosProximos ? 'm-com-pontos' : 'm-so-imovel'} lat={Number(_lat)} lng={Number(_lng)} pontos={imovel.pontosProximos} />}
                  {/* Legenda dos pontos próximos (atratividade) */}
                  {temCoord && imovel.pontosProximos && Object.keys(imovel.pontosProximos).length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                      {Object.entries(CATS_PROX).filter(([k]) => imovel.pontosProximos[k]).map(([k]) => {
                        const p = imovel.pontosProximos[k], c = CATS_PROX[k];
                        return (
                          <span key={k} title={p.nome || c.label}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#334155', background: '#f8fafc', border: `1px solid ${c.cor}33`, borderLeft: `3px solid ${c.cor}`, borderRadius: 8, padding: '4px 10px' }}>
                            {c.emoji} {c.label} <strong style={{ color: c.cor }}>{fmtDist(p.dist_m)}</strong>
                          </span>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
                    <a href={streetViewUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#eef2ff', border: '1px solid #c7d2fe', borderRadius: 10, color: '#4338ca', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      👁️ Street View
                    </a>
                    <a href={mapaUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#ecfeff', border: '1px solid #a5f3fc', borderRadius: 10, color: '#0e7490', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                      <MapPin size={14} /> Abrir no Google Maps
                    </a>
                    {!temCoord && (
                      <span style={{ fontSize: 11, color: '#94a3b8', alignSelf: 'center' }}>
                        Localização aproximada pelo endereço
                      </span>
                    )}
                  </div>
                </div>
              )}
              {(imovel.scoreFinanceiro !== null || imovel.scoreJuridico !== null) && (
                <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                  <ScoreRisco scoreFinanceiro={imovel.scoreFinanceiro} scoreJuridico={imovel.scoreJuridico} size="md" />
                </div>
              )}
            </div>

            {/* Valores */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Banknote size={18} color="#0D63DB" /> Valores
              </h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16 }}>
                <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Lance mínimo</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: '#111111' }}>{fmtBRL(imovel.valorMinimo)}</div>
                </div>
                {imovel.valorAvaliacao && (
                  <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Avaliação</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#64748b' }}>{fmtBRL(imovel.valorAvaliacao)}</div>
                  </div>
                )}
                {economia && (
                  <div style={{ background: '#dcfce7', borderRadius: 12, padding: '16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#15803d', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Economia potencial</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#15803d' }}>{fmtBRL(economia)}</div>
                  </div>
                )}
                {precoM2 && (
                  <div style={{ background: '#f8fafc', borderRadius: 12, padding: '16px' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Preço por m²</div>
                    <div style={{ fontSize: 22, fontWeight: 900, color: '#111111' }}>{fmtBRL(precoM2)}</div>
                  </div>
                )}
              </div>
              {imovel.pagamento?.filter(Boolean).length > 0 && (
                <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>Pagamento:</span>
                  {imovel.pagamento.filter(Boolean).map(p => (
                    <span key={p} style={{ fontSize: 12, background: '#f1f5f9', color: '#475569', padding: '3px 10px', borderRadius: 20, fontWeight: 600 }}>{p}</span>
                  ))}
                </div>
              )}
            </div>

            {/* Simulação rápida — estimativa pela avaliação do leilão (NÃO é a mercadológica) */}
            {imovel.valorMinimo > 0 && imovel.valorAvaliacao > 0 && (() => {
              const lance = imovel.valorMinimo;
              const custosAquisicao = lance * 0.095; // ITBI ~3% + registro ~1,5% + comissão leiloeiro 5%
              const revendaRef = imovel.valorAvaliacao;
              const comissaoVenda = revendaRef * 0.05;
              const lucro = revendaRef - lance - custosAquisicao - comissaoVenda;
              const margem = (lance + custosAquisicao) > 0 ? (lucro / (lance + custosAquisicao)) * 100 : 0;
              const linha = (rot, val, cor) => (
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, borderBottom: '1px dashed #f1f5f9' }}>
                  <span style={{ color: '#64748b' }}>{rot}</span><span style={{ fontWeight: 700, color: cor || '#111' }}>{val}</span>
                </div>
              );
              return (
                <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
                  <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 6px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <BarChart2 size={18} color="#0D63DB" /> Simulação rápida
                  </h2>
                  <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 14px', lineHeight: 1.5 }}>
                    Estimativa com base no <strong>valor de avaliação do leilão</strong> e custos médios. A <strong>avaliação mercadológica real</strong> e a viabilidade financeira completa são feitas no <strong>relatório</strong>.
                  </p>
                  {linha('Lance mínimo', fmtBRL(lance))}
                  {linha('Custos de aquisição (est. ~9,5%)', '− ' + fmtBRL(custosAquisicao), '#b45309')}
                  {linha('Revenda de referência (avaliação)', fmtBRL(revendaRef))}
                  {linha('Comissão de venda (5%)', '− ' + fmtBRL(comissaoVenda), '#b45309')}
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0', fontSize: 15 }}>
                    <span style={{ fontWeight: 800, color: '#111' }}>Lucro estimado</span>
                    <span style={{ fontWeight: 900, color: lucro >= 0 ? '#15803d' : '#dc2626' }}>{fmtBRL(lucro)} <span style={{ fontSize: 12, fontWeight: 700 }}>({margem.toFixed(2)}%)</span></span>
                  </div>
                  <button onClick={() => nav('/calculadora', { state: { imovel } })}
                    style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#eff6ff', color: '#0D63DB', border: '1px solid #bfdbfe', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    <BarChart2 size={14} /> Simular na Calculadora
                  </button>
                </div>
              );
            })()}

            {/* Data do leilão */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={18} color="#0D63DB" /> Data do leilão
              </h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Clock size={16} color="#64748b" />
                <span style={{ fontSize: 15, fontWeight: 600, color: '#334155' }}>{fmtData(imovel.dataLeilao, imovel.modalidade)}</span>
              </div>
            </div>

            {/* Descrição */}
            {imovel.descricao && (
              <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} color="#0D63DB" /> Descrição
                </h2>
                <p style={{ fontSize: 14, color: '#475569', lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {(imovel.descricao || '')
                    .replace(/0[.,]00\s+de\s+área\s+(total|do\s+terreno)[,;]?\s*/gi, '')
                    .replace(/,\s*,/g, ',').replace(/\s+,/g, ',').replace(/,\s*\./g, '.').replace(/\s{2,}/g, ' ').trim()}
                </p>
              </div>
            )}

            {/* Documentos */}
            {temCardDocumentos && (
              <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '24px' }}>
                <h2 style={{ fontSize: 16, fontWeight: 800, color: '#111111', margin: '0 0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={18} color="#0D63DB" /> Documentos
                </h2>

                {/* Staff: capturar documentos na Caixa (enfileira captura automática).
                    O status da fila persiste no F5 — a captura roda em lote (cron). */}
                {podeBuscarDocsCaixa && (() => {
                  const emFila = buscandoDocs === 'ok' || ['pendente', 'processando'].includes(filaDocs?.status);
                  return (
                    <div style={{ marginBottom: 14 }}>
                      {emFila ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: '#fffbeb', color: '#92400e', border: '1px solid #fde68a', borderRadius: 10, fontWeight: 700, fontSize: 13 }}>
                          <Clock size={15} /> Documentos solicitados — captura em lote (~10–15 min). Aparecem aqui automaticamente quando prontos.
                        </div>
                      ) : (
                        <button onClick={buscarDocsCaixa} disabled={buscandoDocs === 'loading'}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 16px', background: '#eef2ff', color: '#4338ca', border: '1px solid #c7d2fe', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: buscandoDocs === 'loading' ? 'default' : 'pointer' }}>
                          {buscandoDocs === 'loading' ? 'Solicitando…'
                            : buscandoDocs === 'erro' ? 'Erro — tentar de novo'
                            : filaDocs?.status === 'erro' ? '↻ Tentar capturar de novo'
                            : '🔎 Capturar matrícula/edital da Caixa'}
                        </button>
                      )}
                    </div>
                  );
                })()}

                {/* Documentos disponíveis para download (capturados/anexados) */}
                {anexosDocs.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                    {anexosDocs.filter(a => ehUrl(a.url)).map((a, i) => {
                      const lbl = TIPO_DOC_IMOVEL[a.tipo] || a.nome || 'Documento';
                      return (
                        <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#15803d', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                          📄 {lbl}
                        </a>
                      );
                    })}
                  </div>
                )}

                {/* Números de referência */}
                {(imovel.numeroEdital || imovel.numeroMatricula || imovel.numeroProcesso) && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {imovel.numeroEdital && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: '#94a3b8', minWidth: 110 }}>Nº Edital:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#eff6ff', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroEdital}</span>
                      </div>
                    )}
                    {imovel.numeroMatricula && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: '#94a3b8', minWidth: 110 }}>Nº Matrícula:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#f0fdf4', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroMatricula}</span>
                      </div>
                    )}
                    {imovel.numeroProcesso && (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                        <span style={{ color: '#94a3b8', minWidth: 110 }}>Nº Processo:</span>
                        <span style={{ fontWeight: 700, color: '#334155', background: '#faf5ff', padding: '2px 8px', borderRadius: 6 }}>{imovel.numeroProcesso}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Botões de documento (apenas arquivos/links reais — a página do
                    portal já está no botão "Ver no portal" da barra lateral) */}
                {(temEditalDoc || temMatriculaDoc || temRegrasDoc) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {temEditalDoc && (
                      <a href={imovel.linkEdital} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, color: '#084BA6', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                        <FileText size={15} /> Edital
                      </a>
                    )}
                    {temRegrasDoc && (
                      <a href={imovel.linkRegrasVenda} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 10, color: '#c2410c', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                        <ScrollText size={15} /> Regras de venda
                      </a>
                    )}
                    {temMatriculaDoc && (
                      <a href={matriculaUrl} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, color: '#15803d', fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                        <FileText size={15} /> Matrícula
                      </a>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Aviso de risco */}
            <div style={{ background: '#fffbeb', borderRadius: 16, border: '1px solid #fbbf24', padding: '16px 20px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              <AlertTriangle size={18} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
              <p style={{ fontSize: 13, color: '#92400e', margin: 0, lineHeight: 1.6 }}>
                <strong>Atenção:</strong> Antes de arrematar, verifique o edital, a matrícula do imóvel e possíveis ônus ou ocupantes. Recomendamos solicitar uma análise completa com nossa equipe.
              </p>
            </div>

            {/* Imóveis semelhantes e próximos */}
            <ImoveisSimilares imovel={imovel} nav={nav} />

          </div>

          {/* Sidebar direita */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 80 }} className="detalhe-sidebar">

            {/* Card de ação */}
            <div style={{ background: 'white', borderRadius: 16, border: '2px solid #e2e8f0', padding: '24px', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>Lance mínimo</div>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#111111', marginBottom: 4 }}>{fmtBRL(imovel.valorMinimo)}</div>
              {desc > 0 && (
                <div style={{ display: 'inline-block', background: descBg, color: descColor, fontWeight: 800, fontSize: 13, padding: '3px 10px', borderRadius: 8, marginBottom: 16 }}>
                  {descLabel}% abaixo da avaliação
                </div>
              )}

              {/* Ir ao leiloeiro */}
              {imovel.urlLote && (
                <div style={{ marginBottom: 10 }}>
                  <a href={imovel.urlLote} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#111111', color: 'white', borderRadius: 12, fontWeight: 700, fontSize: 14, textDecoration: 'none', boxSizing: 'border-box' }}>
                    <ExternalLink size={15} /> {/caixa|cef/i.test(imovel.fonte || '') ? 'Ver no portal da Caixa (matrícula e edital)' : 'Ir ao leiloeiro (matrícula e edital)'}
                  </a>
                  <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', marginTop: 6 }}>
                    ⚠️ Se o link estiver expirado, o imóvel pode ter sido vendido.{' '}
                    {imovel.fonte === 'caixa' && (
                      <a href="https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp" target="_blank" rel="noopener noreferrer"
                        style={{ color: '#0D63DB', fontWeight: 600 }}>
                        Buscar na CEF →
                      </a>
                    )}
                  </div>
                </div>
              )}

              {/* Solicitar análise */}
              {user ? (
                podeFazerAnalise ? (
                  <button onClick={() => nav('/analise', { state: { imovel } })}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    <BarChart2 size={15} /> Solicitar Análise
                  </button>
                ) : (
                  <button onClick={() => nav('/planos')}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#f59e0b', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                    <BarChart2 size={15} /> Fazer upgrade para analisar
                  </button>
                )
              ) : (
                <button onClick={() => nav('/login')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, width: '100%', padding: '13px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 12, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                  <BarChart2 size={15} /> Entrar para analisar
                </button>
              )}

              <div style={{ marginTop: 16, padding: '12px', background: '#f8fafc', borderRadius: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  <CheckCircle size={13} color="#22c55e" /> Análise gerada em minutos
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b', marginBottom: 4 }}>
                  <CheckCircle size={13} color="#22c55e" /> Laudo mercadológico e jurídico
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
                  <CheckCircle size={13} color="#22c55e" /> Projeção de rentabilidade
                </div>
              </div>
            </div>

            {/* Info rápida */}
            <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e2e8f0', padding: '20px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#64748b', marginBottom: 14, textTransform: 'uppercase', letterSpacing: 1 }}>Resumo</div>
              {[
                { label: 'Tipo', value: TIPO_LABEL[imovel.tipo] || imovel.tipo },
                { label: 'Modalidade', value: MODAL_LABEL[imovel.modalidade] || imovel.modalidade },
                { label: 'Cidade/UF', value: imovel.cidade ? `${imovel.cidade}/${imovel.estado}` : imovel.estado },
                { label: 'Área', value: imovel.areaM2 ? `${imovel.areaM2} m²` : null },
                { label: 'Fonte', value: imovel.fonte },
                { label: 'Leiloeiro', value: imovel.leiloeiro },
              ].filter(({ value }) => value).map(({ label, value }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: 13 }}>
                  <span style={{ color: '#94a3b8' }}>{label}</span>
                  <span style={{ fontWeight: 600, color: '#334155', textAlign: 'right', maxWidth: 160 }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Seção Arrematação removida desta tela — a arrematação é registrada no Caso. */}

      <style>{`
        @media (max-width: 900px) {
          .detalhe-grid { grid-template-columns: 1fr !important; }
          .detalhe-sidebar { position: static !important; }
        }
      `}</style>
    </div>
  );
}
