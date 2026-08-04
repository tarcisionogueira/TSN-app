import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { nomeArquivoSeguro } from '../utils/arquivo';
import { useAuth } from '../contexts/AuthContext';
import { ChevronLeft, FileText, CheckCircle2, Clock, AlertCircle, ExternalLink, Upload, Loader2, Info } from 'lucide-react';

// Documentos necessários para registro pós-arrematação
const DOCS_REGISTRO = [
  { key: 'auto_arrematacao',   label: 'Auto/Carta de Arrematação',        obrigatorio: true,  desc: 'Expedido pelo leiloeiro ou pelo juízo após arrematação.' },
  { key: 'itbi_pago',          label: 'Comprovante de ITBI pago',          obrigatorio: true,  desc: 'Guia ITBI quitada. Obtida na prefeitura do município do imóvel.' },
  { key: 'matricula_atual',    label: 'Certidão de Matrícula Atualizada',  obrigatorio: true,  desc: 'Certidão de matrícula do imóvel (menos de 30 dias).' },
  { key: 'cnd_federal',        label: 'CND Federal (Receita Federal)',      obrigatorio: false, desc: 'Certidão Negativa de Débitos Federais do arrematante.' },
  { key: 'cnd_trabalhista',    label: 'CND Trabalhista (TST)',              obrigatorio: false, desc: 'Certidão Negativa de Débitos Trabalhistas do arrematante.' },
  { key: 'doc_arrematante',    label: 'Documento de Identidade (RG/CNH)',   obrigatorio: true,  desc: 'Documento com foto do arrematante.' },
  { key: 'cpf_arrematante',    label: 'CPF do Arrematante',                obrigatorio: true,  desc: 'Cópia do CPF do arrematante.' },
  { key: 'comprovante_end',    label: 'Comprovante de Endereço',            obrigatorio: true,  desc: 'Conta de luz, água ou telefone (últimos 3 meses).' },
  { key: 'estado_civil',       label: 'Certidão de Estado Civil',           obrigatorio: true,  desc: 'Certidão de casamento, nascimento ou declaração de união estável.' },
  { key: 'procuracao',         label: 'Procuração (se representado)',        obrigatorio: false, desc: 'Se o arrematante for pessoa jurídica ou representado por terceiro.' },
];

const ETAPAS = ['imovel', 'documentos', 'protocolo', 'acompanhar'];
const LABEL_ETAPA = { imovel: 'Imóvel', documentos: 'Documentos', protocolo: 'Protocolar', acompanhar: 'Acompanhar' };

function calcItbi(valor, aliquota = 2) {
  return (valor * aliquota) / 100;
}

export default function OnrRegistro() {
  const { imovelId } = useParams();
  const nav = useNavigate();
  const { user } = useAuth();

  const [etapa, setEtapa] = useState('imovel');
  const [imovel, setImovel] = useState(null);
  const [loadingImovel, setLoadingImovel] = useState(!!imovelId);

  // Dados do imóvel / protocolo
  const [form, setForm] = useState({
    cartorio_nome: '',
    cartorio_cidade: '',
    cartorio_uf: '',
    valor_arrematacao: '',
    aliquota_itbi: '2',
    nome_arrematante: '',
    cpf_arrematante: '',
    tipo_pessoa: 'pf',   // pf | pj
    razao_social: '',
    cnpj: '',
    uso_imovel: 'residencial',
    matricula_numero: '',
    notas: '',
  });

  const [docs, setDocs]     = useState({}); // { key: { nome, url, uploadado: bool } }
  const [uploads, setUploads] = useState({}); // { key: 'uploading' | 'done' | 'error' }

  const [protocoloNum, setProtocoloNum] = useState('');
  const [protocoloData, setProtocoloData] = useState('');
  const [registros, setRegistros] = useState([]); // histórico de protocolos deste imóvel
  const [loadingReg, setLoadingReg] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erros, setErros] = useState({});

  // Carrega imóvel se veio com imovelId
  useEffect(() => {
    if (!imovelId) return;
    supabase.from('imoveis').select('*').eq('id', imovelId).single()
      .then(({ data }) => {
        if (data) {
          setImovel(data);
          setForm(p => ({
            ...p,
            cartorio_cidade: data.cidade || '',
            cartorio_uf: data.estado || '',
            valor_arrematacao: data.valor_arrematacao || data.valor_avaliacao || '',
            matricula_numero: data.matricula || '',
          }));
        }
        setLoadingImovel(false);
      });
    // Carrega protocolos anteriores deste imóvel
    setLoadingReg(true);
    supabase.from('onr_protocolos')
      .select('*')
      .eq('imovel_id', imovelId)
      .order('criado_em', { ascending: false })
      .then(({ data }) => { setRegistros(data || []); setLoadingReg(false); });
  }, [imovelId]);

  // Preenche nome do arrematante com dados do usuário logado. O CPF vem cheio e
  // decifrado do backend (é o próprio titular; não fica mais em texto claro).
  useEffect(() => {
    if (!user) return;
    const nome = user.user_metadata?.nome || '';
    setForm(p => ({ ...p, nome_arrematante: p.nome_arrematante || nome }));
    apiCall('/api/cpf-revelar', { method: 'POST', body: JSON.stringify({ ids: [user.id], full: true }) })
      .then(r => r.json()).then(d => { const c = d?.cpfs?.[user.id]; if (c) setForm(p => ({ ...p, cpf_arrematante: p.cpf_arrematante || c })); })
      .catch(() => {});
  }, [user]);

  const setVal = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // Upload de documento para Supabase Storage
  const handleDocUpload = async (key, file) => {
    if (!file) return;
    setUploads(p => ({ ...p, [key]: 'uploading' }));
    // Nome SANITIZADO na chave: acento/cedilha/espaço fazem o Storage devolver
    // `Invalid key` (400) — mesmo defeito achado em 04/08 no anexo do contrato.
    const path = `onr/${imovelId || 'geral'}/${key}_${Date.now()}_${nomeArquivoSeguro(file.name)}`;
    const { data, error } = await supabase.storage.from('documentos').upload(path, file, { upsert: true });
    if (error) {
      setUploads(p => ({ ...p, [key]: 'error' }));
      return;
    }
    // Bucket privado: signed URL CURTA só p/ preview na sessão. NÃO persistimos
    // a URL — só o path; a leitura gera signed URL on-demand (evita guardar
    // credencial de longa duração no banco).
    const { data: signed } = await supabase.storage.from('documentos').createSignedUrl(data.path, 3600);
    setDocs(p => ({ ...p, [key]: { nome: file.name, url: signed?.signedUrl || null, path: data.path } }));
    setUploads(p => ({ ...p, [key]: 'done' }));
  };

  const validarEtapa = () => {
    const e = {};
    if (etapa === 'imovel') {
      if (!form.cartorio_cidade.trim()) e.cartorio_cidade = 'Informe a cidade do cartório';
      if (!form.cartorio_uf.trim()) e.cartorio_uf = 'Informe o estado';
      if (!form.valor_arrematacao) e.valor_arrematacao = 'Informe o valor arrematado';
      if (!form.nome_arrematante.trim()) e.nome_arrematante = 'Informe o nome do arrematante';
    }
    if (etapa === 'documentos') {
      DOCS_REGISTRO.filter(d => d.obrigatorio).forEach(d => {
        if (!docs[d.key]) e[d.key] = 'Documento obrigatório';
      });
    }
    setErros(e);
    return Object.keys(e).length === 0;
  };

  const avancar = () => {
    if (!validarEtapa()) return;
    const idx = ETAPAS.indexOf(etapa);
    if (idx < ETAPAS.length - 1) setEtapa(ETAPAS[idx + 1]);
  };

  const voltar = () => {
    const idx = ETAPAS.indexOf(etapa);
    if (idx > 0) setEtapa(ETAPAS[idx - 1]);
  };

  const salvarProtocolo = async () => {
    if (!protocoloNum.trim()) { setErros({ protocolo: 'Informe o número do protocolo' }); return; }
    setSalvando(true);
    try {
      const payload = {
        imovel_id:         imovelId || null,
        user_id:           user.id,
        numero_protocolo:  protocoloNum.trim(),
        data_protocolo:    protocoloData || new Date().toISOString().split('T')[0],
        cartorio_nome:     form.cartorio_nome.trim() || null,
        cartorio_cidade:   form.cartorio_cidade.trim(),
        cartorio_uf:       form.cartorio_uf.trim(),
        valor_arrematacao: Number(form.valor_arrematacao) || null,
        matricula:         form.matricula_numero.trim() || null,
        nome_arrematante:  form.nome_arrematante.trim(),
        cpf_cnpj_arrematante: form.tipo_pessoa === 'pj' ? form.cnpj : form.cpf_arrematante,
        docs_enviados:     Object.entries(docs).map(([k, v]) => ({ key: k, nome: v.nome, path: v.path })),
        status:            'protocolado',
        notas:             form.notas.trim() || null,
      };
      const { error } = await supabase.from('onr_protocolos').insert(payload);
      if (error) throw error;
      setEtapa('acompanhar');
      // Recarrega lista
      if (imovelId) {
        const { data } = await supabase.from('onr_protocolos').select('*').eq('imovel_id', imovelId).order('criado_em', { ascending: false });
        setRegistros(data || []);
      }
    } catch (e) {
      setErros({ protocolo: e.message });
    }
    setSalvando(false);
  };

  const itbi = form.valor_arrematacao
    ? calcItbi(Number(String(form.valor_arrematacao).replace(/\D/g, '')) || 0, Number(form.aliquota_itbi) || 2)
    : null;

  const fmtBRL = v => v ? `R$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  const etapaIdx = ETAPAS.indexOf(etapa);

  // ─── STATUS badge ────────────────────────────────────────────────────────────
  const STATUS_INFO = {
    protocolado:  { label: 'Protocolado',  cor: '#0D63DB', bg: '#dbeafe' },
    em_analise:   { label: 'Em análise',   cor: '#d97706', bg: '#fef3c7' },
    exigencias:   { label: 'Exigências',   cor: '#dc2626', bg: '#fee2e2' },
    registrado:   { label: 'Registrado!',  cor: '#059669', bg: '#dcfce7' },
    cancelado:    { label: 'Cancelado',    cor: '#64748b', bg: '#f1f5f9' },
  };

  if (loadingImovel) return (
    <div style={{ padding: 40, textAlign: 'center' }}>
      <Loader2 size={28} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} />
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', padding: '20px 16px' }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>

      <button onClick={() => nav(-1)} style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'none', border: 'none', color: '#475569', fontWeight: 600, fontSize: 13, cursor: 'pointer', marginBottom: 20 }}>
        <ChevronLeft size={15} /> Voltar
      </button>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <FileText size={22} color="#0D63DB" />
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: 0 }}>Registro de Imóvel, ONR Digital</h2>
        </div>
        {imovel && (
          <div style={{ fontSize: 13, color: '#64748b' }}>
            {imovel.endereco || imovel.titulo || imovel.id} · {imovel.cidade}/{imovel.estado}
          </div>
        )}
      </div>

      {/* Etapas */}
      <div style={{ display: 'flex', gap: 0, marginBottom: 28, borderBottom: '2px solid #e2e8f0' }}>
        {ETAPAS.map((e, i) => (
          <div key={e} style={{ flex: 1, textAlign: 'center', paddingBottom: 12, borderBottom: etapa === e ? '3px solid #0D63DB' : '3px solid transparent', cursor: i <= etapaIdx ? 'pointer' : 'default' }}
            onClick={() => i <= etapaIdx && setEtapa(e)}>
            <div style={{ fontSize: 12, fontWeight: etapa === e ? 800 : 500, color: etapa === e ? '#0D63DB' : i < etapaIdx ? '#059669' : '#94a3b8' }}>
              {i < etapaIdx ? '✓ ' : ''}{LABEL_ETAPA[e]}
            </div>
          </div>
        ))}
      </div>

      {/* ─── ETAPA 1: IMÓVEL ─────────────────────────────────────────────── */}
      {etapa === 'imovel' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <InfoBox>
            O registro pós-arrematação é feito no Cartório de Registro de Imóveis da circunscrição do imóvel.
            Após preencher os dados e enviar os documentos, você protocola presencialmente ou via <strong>SREI (registradores.org.br)</strong> se o cartório aceitar protocolo eletrônico.
          </InfoBox>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Campo label="Cidade do imóvel / cartório" erro={erros.cartorio_cidade} required>
              <input value={form.cartorio_cidade} onChange={e => setVal('cartorio_cidade', e.target.value)}
                placeholder="Ex: Feira de Santana" style={S.input} />
            </Campo>
            <Campo label="Estado (UF)" erro={erros.cartorio_uf} required>
              <select value={form.cartorio_uf} onChange={e => setVal('cartorio_uf', e.target.value)} style={S.input}>
                <option value="">Selecione...</option>
                {['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'].map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </Campo>
          </div>

          <Campo label="Nome do cartório (opcional)">
            <input value={form.cartorio_nome} onChange={e => setVal('cartorio_nome', e.target.value)}
              placeholder="Ex: 1° Cartório de Registro de Imóveis" style={S.input} />
          </Campo>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Campo label="Valor arrematado (R$)" erro={erros.valor_arrematacao} required>
              <input type="number" value={form.valor_arrematacao} onChange={e => setVal('valor_arrematacao', e.target.value)}
                placeholder="Ex: 150000" style={S.input} />
            </Campo>
            <Campo label="Alíquota ITBI (%), verifique na prefeitura">
              <input type="number" step="0.1" value={form.aliquota_itbi} onChange={e => setVal('aliquota_itbi', e.target.value)}
                style={S.input} />
              {itbi && <div style={{ fontSize: 11, color: '#059669', marginTop: 4, fontWeight: 600 }}>ITBI estimado: {fmtBRL(itbi)}</div>}
            </Campo>
          </div>

          <Campo label="Número de matrícula do imóvel">
            <input value={form.matricula_numero} onChange={e => setVal('matricula_numero', e.target.value)}
              placeholder="Ex: 12345" style={S.input} />
          </Campo>

          <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#111111', marginBottom: 12 }}>Dados do arrematante</div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
              {['pf', 'pj'].map(t => (
                <button key={t} onClick={() => setVal('tipo_pessoa', t)}
                  style={{ padding: '6px 18px', borderRadius: 8, border: `2px solid ${form.tipo_pessoa === t ? '#0D63DB' : '#e2e8f0'}`, background: form.tipo_pessoa === t ? '#eff6ff' : 'white', fontWeight: 700, fontSize: 13, cursor: 'pointer', color: form.tipo_pessoa === t ? '#1d4ed8' : '#64748b' }}>
                  {t === 'pf' ? 'Pessoa Física' : 'Pessoa Jurídica'}
                </button>
              ))}
            </div>

            {form.tipo_pessoa === 'pf' ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Campo label="Nome completo" erro={erros.nome_arrematante} required>
                  <input value={form.nome_arrematante} onChange={e => setVal('nome_arrematante', e.target.value)} style={S.input} />
                </Campo>
                <Campo label="CPF">
                  <input value={form.cpf_arrematante} onChange={e => setVal('cpf_arrematante', e.target.value)} placeholder="000.000.000-00" style={S.input} />
                </Campo>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <Campo label="Razão social" required>
                  <input value={form.razao_social} onChange={e => setVal('razao_social', e.target.value)} style={S.input} />
                </Campo>
                <Campo label="CNPJ">
                  <input value={form.cnpj} onChange={e => setVal('cnpj', e.target.value)} placeholder="00.000.000/0001-00" style={S.input} />
                </Campo>
                <Campo label="Representante legal" erro={erros.nome_arrematante} required>
                  <input value={form.nome_arrematante} onChange={e => setVal('nome_arrematante', e.target.value)} style={S.input} />
                </Campo>
                <Campo label="CPF do representante">
                  <input value={form.cpf_arrematante} onChange={e => setVal('cpf_arrematante', e.target.value)} placeholder="000.000.000-00" style={S.input} />
                </Campo>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── ETAPA 2: DOCUMENTOS ─────────────────────────────────────────── */}
      {etapa === 'documentos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <InfoBox>
            Digitalize e envie os documentos abaixo. Os obrigatórios (★) são exigidos por todos os cartórios.
            Os opcionais podem ser solicitados dependendo da situação do imóvel ou do arrematante.
          </InfoBox>
          {DOCS_REGISTRO.map(doc => {
            const uploadado = !!docs[doc.key];
            const status = uploads[doc.key];
            return (
              <div key={doc.key} style={{ background: uploadado ? '#f0fdf4' : '#f8fafc', border: `1px solid ${erros[doc.key] ? '#fca5a5' : uploadado ? '#86efac' : '#e2e8f0'}`, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: '#111111' }}>
                    {doc.obrigatorio && <span style={{ color: '#d97706', marginRight: 4 }}>★</span>}
                    {doc.label}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{doc.desc}</div>
                  {uploadado && <div style={{ fontSize: 11, color: '#059669', marginTop: 3, fontWeight: 600 }}>✓ {docs[doc.key].nome}</div>}
                  {erros[doc.key] && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>Obrigatório</div>}
                </div>
                <label style={{ cursor: 'pointer', flexShrink: 0 }}>
                  <div style={{ padding: '6px 14px', background: uploadado ? '#dcfce7' : '#0D63DB', color: uploadado ? '#15803d' : 'white', borderRadius: 8, fontWeight: 700, fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}>
                    {status === 'uploading' ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Upload size={13} />}
                    {uploadado ? 'Trocar' : 'Enviar'}
                  </div>
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" style={{ display: 'none' }}
                    onChange={e => handleDocUpload(doc.key, e.target.files[0])} />
                </label>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── ETAPA 3: PROTOCOLAR ─────────────────────────────────────────── */}
      {etapa === 'protocolo' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <InfoBox>
            Agora você tem duas opções para protocolar: <strong>(1) SREI, Protocolo Eletrônico</strong> (se o cartório aceitar) ou
            <strong> (2) Presencial</strong> no cartório. Após protocolar, registre o número do protocolo abaixo para acompanhar.
          </InfoBox>

          {/* Opção 1: SREI */}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#1d4ed8', marginBottom: 8 }}>Opção 1, Protocolo Eletrônico via SREI</div>
            <p style={{ fontSize: 13, color: '#334155', margin: '0 0 12px', lineHeight: 1.6 }}>
              O SREI (Sistema de Registro de Imóveis Eletrônico) permite protocolar documentos digitalmente.
              Você precisará de <strong>certificado digital e-CPF ou e-CNPJ (ICP-Brasil)</strong> para assinar os documentos eletronicamente.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <a href="https://srei.registradores.org.br" target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#1d4ed8', color: 'white', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                <ExternalLink size={14} /> Acessar SREI
              </a>
              <a href={`https://www.registradores.org.br/servicos/buscar-cartorio?cidade=${encodeURIComponent(form.cartorio_cidade)}&uf=${form.cartorio_uf}`}
                target="_blank" rel="noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: 'white', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 8, fontWeight: 700, fontSize: 13, textDecoration: 'none' }}>
                <ExternalLink size={14} /> Buscar cartório em {form.cartorio_cidade || 'sua cidade'}
              </a>
            </div>
          </div>

          {/* Opção 2: Presencial */}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#111111', marginBottom: 8 }}>Opção 2, Protocolo Presencial</div>
            <p style={{ fontSize: 13, color: '#475569', margin: '0 0 12px', lineHeight: 1.6 }}>
              Leve os documentos originais e cópias ao Cartório de Registro de Imóveis em {form.cartorio_cidade || 'sua cidade'}/{form.cartorio_uf}.
              Você receberá um número de protocolo que deverá ser registrado abaixo.
            </p>
            <div style={{ fontSize: 12, color: '#64748b', background: 'white', borderRadius: 8, padding: '10px 12px', border: '1px solid #e2e8f0' }}>
              <strong>Documentos para levar:</strong><br/>
              {DOCS_REGISTRO.filter(d => docs[d.key]).map(d => `✓ ${d.label}`).join(' · ') || 'Nenhum documento enviado ainda'}
            </div>
          </div>

          {/* Registro do protocolo */}
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 18px' }}>
            <div style={{ fontWeight: 800, fontSize: 14, color: '#111111', marginBottom: 14 }}>Registrar número do protocolo</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
              <Campo label="Número do protocolo" erro={erros.protocolo} required>
                <input value={protocoloNum} onChange={e => setProtocoloNum(e.target.value)}
                  placeholder="Ex: 2024-001234" style={S.input} />
              </Campo>
              <Campo label="Data do protocolo">
                <input type="date" value={protocoloData} onChange={e => setProtocoloData(e.target.value)} style={S.input} />
              </Campo>
            </div>
            <Campo label="Observações (opcional)">
              <textarea value={form.notas} onChange={e => setVal('notas', e.target.value)}
                rows={3} placeholder="Exigências, pendências, informações do cartório..." style={{ ...S.input, resize: 'vertical' }} />
            </Campo>
            <button onClick={salvarProtocolo} disabled={salvando}
              style={{ marginTop: 14, padding: '10px 24px', background: salvando ? '#94a3b8' : '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: salvando ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
              {salvando ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Salvando…</> : <><CheckCircle2 size={15} /> Registrar protocolo</>}
            </button>
          </div>
        </div>
      )}

      {/* ─── ETAPA 4: ACOMPANHAR ─────────────────────────────────────────── */}
      {etapa === 'acompanhar' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {loadingReg ? (
            <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={24} color="#94a3b8" style={{ animation: 'spin 1s linear infinite' }} /></div>
          ) : registros.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', padding: 40, fontSize: 14 }}>Nenhum protocolo registrado para este imóvel.</div>
          ) : (
            registros.map(r => {
              const si = STATUS_INFO[r.status] || STATUS_INFO.protocolado;
              return (
                <div key={r.id} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, padding: '16px 18px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
                    <div>
                      <div style={{ fontWeight: 800, fontSize: 15, color: '#111111' }}>Protocolo {r.numero_protocolo}</div>
                      <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
                        {r.cartorio_cidade}/{r.cartorio_uf} · {r.data_protocolo ? new Date(r.data_protocolo + 'T12:00:00').toLocaleDateString('pt-BR') : new Date(r.criado_em).toLocaleDateString('pt-BR')}
                      </div>
                    </div>
                    <StatusSelect registro={r} onAtualizar={(id, status) => {
                      setRegistros(prev => prev.map(x => x.id === id ? { ...x, status } : x));
                      supabase.from('onr_protocolos').update({ status, atualizado_em: new Date().toISOString() }).eq('id', id);
                    }} />
                  </div>
                  {r.valor_arrematacao && (
                    <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                      Valor arrematado: <strong>{fmtBRL(r.valor_arrematacao)}</strong> ·
                      ITBI estimado (2%): <strong>{fmtBRL(r.valor_arrematacao * 0.02)}</strong>
                    </div>
                  )}
                  {r.notas && <div style={{ fontSize: 12, color: '#64748b', background: '#f8fafc', borderRadius: 8, padding: '8px 10px', marginBottom: 8 }}>{r.notas}</div>}
                  {r.docs_enviados && r.docs_enviados.length > 0 && (
                    <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {r.docs_enviados.map(d => (
                        <button key={d.key} type="button"
                          onClick={async () => {
                            const alvo = d.path || null;
                            if (!alvo) return;
                            const { data } = await supabase.storage.from('documentos').createSignedUrl(alvo, 300);
                            if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener');
                          }}
                          style={{ fontSize: 11, padding: '3px 8px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 6, border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                          📄 {d.nome || d.key}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}

          <button onClick={() => { setEtapa('imovel'); setProtocoloNum(''); setProtocoloData(''); setDocs({}); setErros({}); }}
            style={{ padding: '10px 20px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', alignSelf: 'flex-start' }}>
            + Novo protocolo para este imóvel
          </button>
        </div>
      )}

      {/* ─── Navegação ───────────────────────────────────────────────────── */}
      {etapa !== 'acompanhar' && (
        <div style={{ display: 'flex', gap: 10, marginTop: 28, paddingTop: 20, borderTop: '1px solid #e2e8f0' }}>
          {etapa !== 'imovel' && (
            <button onClick={voltar}
              style={{ padding: '11px 24px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              ← Voltar
            </button>
          )}
          {etapa !== 'protocolo' && (
            <button onClick={avancar}
              style={{ padding: '11px 28px', background: '#0D63DB', color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Continuar →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function InfoBox({ children }) {
  return (
    <div style={{ background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 10, padding: '10px 14px', fontSize: 13, color: '#0369a1', lineHeight: 1.6, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <Info size={15} style={{ flexShrink: 0, marginTop: 2 }} />
      <span>{children}</span>
    </div>
  );
}

function Campo({ label, children, erro, required }) {
  return (
    <div>
      <label style={{ fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5 }}>
        {label}{required && <span style={{ color: '#d97706', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {erro && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 3 }}>{erro}</div>}
    </div>
  );
}

function StatusSelect({ registro, onAtualizar }) {
  const opcoes = [
    { value: 'protocolado', label: 'Protocolado',  cor: '#0D63DB', bg: '#dbeafe' },
    { value: 'em_analise',  label: 'Em análise',   cor: '#d97706', bg: '#fef3c7' },
    { value: 'exigencias',  label: 'Exigências',   cor: '#dc2626', bg: '#fee2e2' },
    { value: 'registrado',  label: 'Registrado! ✓', cor: '#059669', bg: '#dcfce7' },
    { value: 'cancelado',   label: 'Cancelado',    cor: '#64748b', bg: '#f1f5f9' },
  ];
  const atual = opcoes.find(o => o.value === registro.status) || opcoes[0];
  return (
    <select value={registro.status} onChange={e => onAtualizar(registro.id, e.target.value)}
      style={{ padding: '4px 10px', borderRadius: 20, border: `1px solid ${atual.cor}44`, background: atual.bg, color: atual.cor, fontWeight: 700, fontSize: 12, cursor: 'pointer', outline: 'none' }}>
      {opcoes.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

const S = {
  input: { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 14, color: '#111111', background: 'white', boxSizing: 'border-box', outline: 'none' },
};
