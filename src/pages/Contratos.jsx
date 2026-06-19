import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, CheckCircle2, Clock, ShieldCheck, X, Users, MapPin, Download } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import AssinaturaCanvas from '../components/AssinaturaCanvas';

async function sha256(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Tenta capturar geolocalização do navegador
function capturarGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => resolve(null),
      { timeout: 6000 }
    );
  });
}

const STATUS_INFO = {
  rascunho:              { label: 'Em preparação',             cor: '#64748b', bg: '#f1f5f9' },
  aguardando_assinatura: { label: 'Aguardando sua assinatura', cor: '#d97706', bg: '#fef3c7' },
  aguardando:            { label: 'Aguardando sua assinatura', cor: '#d97706', bg: '#fef3c7' },
  assinado:              { label: 'Assinado',                  cor: '#059669', bg: '#dcfce7' },
  cancelado:             { label: 'Cancelado',                 cor: '#dc2626', bg: '#fee2e2' },
};

const S = {
  input: { width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, color: '#0f172a', boxSizing: 'border-box', outline: 'none' },
  label: { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 },
  secao: { marginTop: 20, paddingTop: 16, borderTop: '1px solid #e2e8f0' },
};

export default function Contratos() {
  const nav = useNavigate();
  const { user, effectiveUserId, loading: authLoading } = useAuth();
  const [contratos, setContratos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [aberto, setAberto] = useState(null);

  // campos de assinatura
  const [assinatura, setAssinatura] = useState('');
  const [cpfAssinante, setCpfAssinante] = useState('');
  const [aceite, setAceite] = useState(false);
  const [geo, setGeo] = useState(null);
  const [geoStatus, setGeoStatus] = useState('idle'); // idle | buscando | ok | negado

  // testemunha
  const [usaTestemunha, setUsaTestemunha] = useState(false);
  const [nomeTest, setNomeTest] = useState('');
  const [cpfTest, setCpfTest] = useState('');
  const [assinaturaTest, setAssinaturaTest] = useState('');

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  const carregar = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('contratos_link')
      .select('*')
      .eq('assinante_email', user.email)
      .neq('status', 'cancelado')
      .order('criado_em', { ascending: false });
    setContratos(data || []);
    setLoading(false);
  }, [user]);

  useEffect(() => { carregar(); }, [carregar]);

  // pré-preenche CPF do perfil
  useEffect(() => {
    if (!user) return;
    supabase.from('perfis').select('cpf').eq('id', user.id).single()
      .then(({ data }) => { if (data?.cpf) setCpfAssinante(data.cpf); });
  }, [user]);

  const abrir = (c) => {
    setAberto(c);
    setAssinatura(''); setAceite(false);
    setUsaTestemunha(false);
    setNomeTest(''); setCpfTest(''); setAssinaturaTest('');
    setGeo(null); setGeoStatus('idle');
    setErro('');
  };

  const buscarGeo = async () => {
    setGeoStatus('buscando');
    const g = await capturarGeo();
    if (g) { setGeo(g); setGeoStatus('ok'); }
    else    { setGeoStatus('negado'); }
  };

  const assinar = async () => {
    setErro('');
    if (!assinatura) { setErro('Assine no campo indicado para continuar.'); return; }
    if (!aceite)     { setErro('Marque o aceite dos termos do contrato.'); return; }
    if (usaTestemunha) {
      if (!nomeTest.trim()) { setErro('Informe o nome da testemunha.'); return; }
      if (!cpfTest.trim())  { setErro('Informe o CPF da testemunha.'); return; }
      if (!assinaturaTest)  { setErro('A testemunha deve assinar no campo indicado.'); return; }
    }
    setSalvando(true);
    try {
      const carimbo = new Date().toISOString();
      const hash = await sha256(aberto.conteudo + '|' + assinatura + '|' + carimbo);
      const nome = user?.user_metadata?.nome || '';
      const payload = {
        status: 'assinado',
        assinatura_data:   assinatura,
        assinante_nome:    nome,
        assinante_cpf:     cpfAssinante.trim() || null,
        assinatura_hash:   hash,
        assinado_em:       carimbo,
        latitude:          geo?.lat   || null,
        longitude:         geo?.lng   || null,
      };
      if (usaTestemunha) {
        payload.nome_testemunha      = nomeTest.trim();
        payload.cpf_testemunha       = cpfTest.trim();
        payload.assinatura_testemunha = assinaturaTest;
        payload.testemunha_em        = carimbo;
      }
      const { error } = await supabase.from('contratos_link').update(payload).eq('id', aberto.id);
      if (error) throw error;
      setAberto(null);
      await carregar();
    } catch (e) {
      setErro('Não foi possível registrar a assinatura. ' + (e.message || ''));
    }
    setSalvando(false);
  };

  // Baixar comprovante de contrato assinado como texto
  const baixarComprovante = (c) => {
    const linhas = [
      `COMPROVANTE DE CONTRATO ASSINADO`,
      `Título: ${c.titulo}`,
      `Produto: ${c.produto || '—'}`,
      `Valor: ${c.valor > 0 ? 'R$ ' + Number(c.valor).toFixed(2) : '—'}`,
      ``,
      `──────────────────────────────────────`,
      c.conteudo,
      `──────────────────────────────────────`,
      ``,
      `DADOS DE ASSINATURA`,
      `Assinante: ${c.assinante_nome || '—'}`,
      `CPF: ${c.assinante_cpf || '—'}`,
      `Data/Hora: ${c.assinado_em ? new Date(c.assinado_em).toLocaleString('pt-BR') : '—'}`,
      `Geolocalização: ${c.latitude ? `${c.latitude}, ${c.longitude}` : 'Não capturada'}`,
      `Hash SHA-256: ${c.assinatura_hash || '—'}`,
    ];
    if (c.nome_testemunha) {
      linhas.push(``, `TESTEMUNHA`, `Nome: ${c.nome_testemunha}`, `CPF: ${c.cpf_testemunha || '—'}`);
    }
    const blob = new Blob([linhas.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `contrato-${c.id.slice(0,8)}.txt`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (authLoading || loading) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Carregando…</div>;

  if (!user) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <h2 style={{ color: '#0f172a' }}>Acesso restrito</h2>
        <p style={{ color: '#64748b' }}>Faça login para ver seus contratos.</p>
        <button onClick={() => nav('/login')} style={{ padding: '10px 20px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>Entrar</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 920, margin: '0 auto', padding: '28px 20px' }}>
      <h1 style={{ fontSize: 26, fontWeight: 900, color: '#0f172a', margin: '0 0 4px' }}>Meus Contratos</h1>
      <p style={{ color: '#64748b', margin: '0 0 24px', fontSize: 14 }}>Contratos de assessoria, clube de negócios e demais produtos.</p>

      {contratos.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', background: 'white', borderRadius: 16, border: '1px solid #e2e8f0' }}>
          <FileText size={40} color="#94a3b8" style={{ margin: '0 auto 14px' }} />
          <h3 style={{ color: '#334155', margin: '0 0 6px' }}>Nenhum contrato ainda</h3>
          <p style={{ color: '#94a3b8', fontSize: 13 }}>Quando um contrato for emitido para você, ele aparecerá aqui.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {contratos.map(c => {
            const si = STATUS_INFO[c.status] || STATUS_INFO.rascunho;
            const aguardando = c.status === 'aguardando';
            return (
              <div key={c.id} style={{ background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '18px 20px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, color: '#0f172a' }}>{c.titulo}</div>
                  <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                    {c.tipo_contrato && <span style={{ textTransform: 'capitalize' }}>{c.tipo_contrato}</span>}
                    {c.assinado_em && <span> · Assinado em {new Date(c.assinado_em).toLocaleDateString('pt-BR')}</span>}
                    {!c.assinado_em && c.criado_em && <span> · Enviado em {new Date(c.criado_em).toLocaleDateString('pt-BR')}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 20, background: si.bg, color: si.cor, display: 'flex', alignItems: 'center', gap: 5 }}>
                  {c.status === 'assinado' ? <CheckCircle2 size={13} /> : <Clock size={13} />}
                  {si.label}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => nav(`/c/${c.token}`)}
                    style={{ padding: '8px 16px', background: aguardando ? '#2563eb' : '#f1f5f9', color: aguardando ? 'white' : '#475569', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                    {aguardando ? 'Ler e assinar' : 'Visualizar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de leitura/assinatura/visualização */}
      {aberto && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
          onClick={e => e.target === e.currentTarget && setAberto(null)}>
          <div style={{ background: 'white', borderRadius: 18, width: '100%', maxWidth: 660, maxHeight: '94vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 60px rgba(0,0,0,0.3)' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid #f1f5f9', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a' }}>{aberto.titulo}</h3>
              <button onClick={() => setAberto(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={20} /></button>
            </div>

            {/* Corpo scrollável */}
            <div style={{ padding: '20px 22px', overflowY: 'auto', flex: 1 }}>

              {/* Conteúdo do contrato */}
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.7, color: '#334155', background: '#f8fafc', borderRadius: 10, padding: 16, border: '1px solid #f1f5f9' }}>
                {aberto.conteudo}
              </div>

              {/* ── Contrato já assinado ── */}
              {aberto.status === 'assinado' ? (
                <div style={{ marginTop: 18 }}>
                  <div style={{ padding: 16, background: '#dcfce7', borderRadius: 10, border: '1px solid #86efac' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#166534', marginBottom: 10 }}>
                      <ShieldCheck size={16} /> Contrato assinado eletronicamente
                    </div>
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#15803d', fontWeight: 700, marginBottom: 4 }}>ASSINATURA DO CONTRATANTE</div>
                        {aberto.assinatura_data && <img src={aberto.assinatura_data} alt="Assinatura" style={{ maxHeight: 80, background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', padding: 6 }} />}
                      </div>
                      {aberto.assinatura_testemunha && (
                        <div>
                          <div style={{ fontSize: 11, color: '#15803d', fontWeight: 700, marginBottom: 4 }}>ASSINATURA DA TESTEMUNHA</div>
                          <img src={aberto.assinatura_testemunha} alt="Assinatura testemunha" style={{ maxHeight: 80, background: 'white', borderRadius: 8, border: '1px solid #e2e8f0', padding: 6 }} />
                        </div>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#15803d', marginTop: 10, lineHeight: 1.8 }}>
                      <div><strong>Assinante:</strong> {aberto.assinante_nome || '—'} · CPF: {aberto.assinante_cpf || '—'}</div>
                      {aberto.nome_testemunha && <div><strong>Testemunha:</strong> {aberto.nome_testemunha} · CPF: {aberto.cpf_testemunha || '—'}</div>}
                      <div><strong>Data/Hora:</strong> {aberto.assinado_em ? new Date(aberto.assinado_em).toLocaleString('pt-BR') : '—'}</div>
                      {aberto.latitude && <div><strong>Geolocalização:</strong> {aberto.latitude.toFixed(5)}, {aberto.longitude.toFixed(5)}</div>}
                      <div style={{ wordBreak: 'break-all' }}><strong>Hash SHA-256:</strong> {aberto.assinatura_hash}</div>
                    </div>
                  </div>
                  <button onClick={() => baixarComprovante(aberto)}
                    style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#f1f5f9', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 13, color: '#475569', cursor: 'pointer' }}>
                    <Download size={14} /> Baixar comprovante
                  </button>
                </div>

              /* ── Aguardando assinatura ── */
              ) : aberto.requer_assinatura && aberto.status === 'aguardando_assinatura' ? (
                <div>
                  {/* CPF */}
                  <div style={S.secao}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 12 }}>Identificação do assinante</div>
                    <label style={S.label}>CPF</label>
                    <input style={S.input} value={cpfAssinante} onChange={e => setCpfAssinante(e.target.value)}
                      placeholder="000.000.000-00" maxLength={14} />
                  </div>

                  {/* Assinatura principal */}
                  <div style={S.secao}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Assinatura do contratante</div>
                    <AssinaturaCanvas onChange={setAssinatura} />
                  </div>

                  {/* Geolocalização */}
                  <div style={S.secao}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <MapPin size={14} color="#64748b" />
                      <span style={{ fontSize: 12, color: '#64748b' }}>
                        {geoStatus === 'idle' && 'Localização não capturada (opcional — aumenta a validade jurídica)'}
                        {geoStatus === 'buscando' && 'Buscando localização…'}
                        {geoStatus === 'ok' && `Localização: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}`}
                        {geoStatus === 'negado' && 'Permissão de localização negada (o navegador bloqueou).'}
                      </span>
                      {geoStatus === 'idle' && (
                        <button type="button" onClick={buscarGeo}
                          style={{ marginLeft: 'auto', padding: '5px 12px', background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                          Capturar localização
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Testemunha */}
                  <div style={S.secao}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                      <input type="checkbox" checked={usaTestemunha} onChange={e => setUsaTestemunha(e.target.checked)} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <Users size={14} /> Adicionar testemunha (opcional)
                      </span>
                    </label>
                    {usaTestemunha && (
                      <div style={{ marginTop: 14, padding: 14, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                          <div>
                            <label style={S.label}>Nome da testemunha</label>
                            <input style={S.input} value={nomeTest} onChange={e => setNomeTest(e.target.value)} placeholder="Nome completo" />
                          </div>
                          <div>
                            <label style={S.label}>CPF da testemunha</label>
                            <input style={S.input} value={cpfTest} onChange={e => setCpfTest(e.target.value)} placeholder="000.000.000-00" maxLength={14} />
                          </div>
                        </div>
                        <label style={S.label}>Assinatura da testemunha</label>
                        <AssinaturaCanvas onChange={setAssinaturaTest} altura={140} />
                      </div>
                    )}
                  </div>

                  {/* Aceite */}
                  <div style={{ marginTop: 16 }}>
                    <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#475569', cursor: 'pointer' }}>
                      <input type="checkbox" checked={aceite} onChange={e => setAceite(e.target.checked)} style={{ marginTop: 2 }} />
                      Li e concordo integralmente com os termos deste contrato, e reconheço esta assinatura eletrônica como juridicamente válida nos termos da MP 2.200-2/2001 e Lei 14.063/2020.
                    </label>
                  </div>

                  {erro && <div style={{ marginTop: 10, padding: '8px 12px', background: '#fee2e2', color: '#dc2626', borderRadius: 8, fontSize: 12, fontWeight: 600 }}>{erro}</div>}
                </div>
              ) : (
                <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>Este contrato não requer assinatura.</div>
              )}
            </div>

            {/* Footer com botão de assinar */}
            {aberto.status === 'aguardando_assinatura' && aberto.requer_assinatura && (
              <div style={{ padding: '14px 22px', borderTop: '1px solid #f1f5f9', display: 'flex', justifyContent: 'flex-end', gap: 10, flexShrink: 0 }}>
                <button onClick={() => setAberto(null)} style={{ padding: '10px 18px', background: 'white', border: '1px solid #e2e8f0', borderRadius: 8, fontWeight: 600, color: '#64748b', cursor: 'pointer' }}>Cancelar</button>
                <button onClick={assinar} disabled={salvando}
                  style={{ padding: '10px 22px', background: '#059669', color: 'white', border: 'none', borderRadius: 8, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: salvando ? 0.7 : 1 }}>
                  <ShieldCheck size={15} /> {salvando ? 'Registrando…' : 'Assinar contrato'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
