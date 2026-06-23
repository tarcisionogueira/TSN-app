import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Sparkles, Upload, Camera, UserCheck, ChevronRight, X, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { useIsMobile } from '../utils/useIsMobile';
import AssinaturaCanvas from '../components/AssinaturaCanvas';

const S = {
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '20px 22px', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5 },
  input: { width: '100%', padding: '10px 13px', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 13, color: '#111111', boxSizing: 'border-box', outline: 'none', resize: 'vertical' },
  btn: (cor = '#0D63DB') => ({ padding: '12px 22px', background: cor, color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }),
  secTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 14px' },
};

const VERIFICACOES = [
  { id: 'nenhuma',      label: 'Sem verificação',         desc: 'Apenas assinatura eletrônica no canvas' },
  { id: 'foto_doc',     label: 'Foto do documento',       desc: 'Assinante tira foto do documento de identidade (RG/CNH)' },
  { id: 'selfie',       label: 'Selfie',                  desc: 'Assinante captura foto do rosto' },
  { id: 'selfie_doc',   label: 'Selfie + Documento',      desc: 'Rosto ao lado do documento (maior segurança jurídica)' },
];

const TIPOS_CONTRATO = [
  'Prestação de Serviços', 'Assessoria Jurídica', 'Consultoria Imobiliária',
  'Compra e Venda de Imóvel', 'Locação Residencial', 'Locação Comercial',
  'Parceria Comercial', 'Confidencialidade (NDA)', 'Honorários Advocatícios',
  'Contrato de Representação', 'Termo de Compromisso', 'Outro',
];

export default function CriarContrato() {
  const nav = useNavigate();
  const isMobile = useIsMobile();
  const { user, role } = useAuth();

  // Passo: 'modo' → 'detalhes' → 'identidade' → 'revisao' → 'enviado'
  const [passo, setPasso] = useState('modo');
  const [modo, setModo] = useState(null); // 'assinar' | 'gerar'

  // Campos comuns
  const [titulo, setTitulo] = useState('');
  const [emailAssinante, setEmailAssinante] = useState('');
  const [tipoContrato, setTipoContrato] = useState('Prestação de Serviços');
  const [verificacao, setVerificacao] = useState('nenhuma');
  const [arquivosRef, setArquivosRef] = useState([]); // File[]

  // Modo assinar: conteúdo do documento existente
  const [conteudoDoc, setConteudoDoc] = useState('');

  // Modo gerar: descrição para IA
  const [descricaoIA, setDescricaoIA] = useState('');
  const [partesInfo, setPartesInfo] = useState('');
  const [contratoGerado, setContratoGerado] = useState('');
  const [gerandoIA, setGerandoIA] = useState(false);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const fileRef = useRef();

  const staffRoles = ['admin', 'consultor', 'analista', 'advogado'];
  if (!user || !staffRoles.includes(role)) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <AlertTriangle size={36} color="#dc2626" style={{ margin: '0 auto 12px' }} />
        <h2 style={{ color: '#111111' }}>Acesso restrito</h2>
        <p style={{ color: '#64748b' }}>Apenas staff (consultor, analista, advogado, admin) pode criar contratos.</p>
      </div>
    );
  }

  // ── Gerar contrato com IA ──
  const gerarComIA = async () => {
    if (descricaoIA.trim().length < 20) { setErro('Descreva o contrato com pelo menos 20 caracteres.'); return; }
    setGerandoIA(true); setErro('');
    try {
      const r = await fetch('/api/gerar-contrato-ia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}` },
        body: JSON.stringify({ descricao: descricaoIA, tipoContrato, partesAdicionais: partesInfo }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erro ao gerar');
      setContratoGerado(data.contrato);
      setPasso('revisao');
    } catch (e) {
      setErro(e.message);
    }
    setGerandoIA(false);
  };

  // ── Upload de arquivos de referência ──
  const handleArquivos = (e) => {
    const files = Array.from(e.target.files || []);
    const maxSize = 5 * 1024 * 1024;
    const validos = files.filter(f => f.size <= maxSize);
    if (validos.length < files.length) setErro('Alguns arquivos foram ignorados (limite 5 MB por arquivo).');
    setArquivosRef(prev => [...prev, ...validos].slice(0, 5));
  };

  // ── Enviar contrato para assinatura ──
  const enviarContrato = async () => {
    const conteudo = modo === 'gerar' ? contratoGerado : conteudoDoc;
    if (!titulo.trim()) { setErro('Informe o título do contrato.'); return; }
    if (!emailAssinante.trim()) { setErro('Informe o e-mail do assinante.'); return; }
    if (!conteudo.trim()) { setErro(modo === 'gerar' ? 'Gere o contrato antes de enviar.' : 'Cole ou escreva o conteúdo do documento.'); return; }

    setEnviando(true); setErro('');
    try {
      const session = (await supabase.auth.getSession()).data.session;

      // Upload de arquivos de referência para Supabase Storage
      const arquivosUrls = [];
      for (const f of arquivosRef) {
        const path = `contratos-ref/${user.id}/${Date.now()}-${f.name}`;
        const { data: up, error: upErr } = await supabase.storage.from('documentos').upload(path, f, { upsert: false });
        if (!upErr && up?.path) {
          const { data: url } = supabase.storage.from('documentos').getPublicUrl(up.path);
          arquivosUrls.push({ nome: f.name, url: url.publicUrl });
        }
      }

      const r = await fetch('/api/gerar-contrato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          titulo,
          conteudo,
          emailAssinante: emailAssinante.trim(),
          tipoContrato,
          verificacaoIdentidade: verificacao,
          arquivosReferencia: arquivosUrls,
          geradoPorIA: modo === 'gerar',
        }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erro ao enviar');
      setPasso('enviado');
    } catch (e) {
      setErro(e.message);
    }
    setEnviando(false);
  };

  // ───────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 760, margin: '0 auto', padding: isMobile ? '16px 12px' : '28px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <button onClick={() => nav(-1)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 0 }}>←</button>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: 0 }}>Novo Contrato</h1>
      </div>

      {/* ── PASSO: Modo ── */}
      {passo === 'modo' && (
        <div>
          <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: 14 }}>Escolha como deseja criar o contrato:</p>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
            {[
              { id: 'assinar', icon: FileText, cor: '#0D63DB', titulo: 'Assinar documento', desc: 'Já tem o contrato pronto. Cole o texto ou envie o arquivo. O assinante assina eletronicamente.' },
              { id: 'gerar',   icon: Sparkles, cor: '#6366f1', titulo: 'Gerar com IA', desc: 'Descreva o que precisa. A IA gera o contrato com linguagem jurídica, LGPD e anticorrupção.' },
            ].map(op => (
              <button key={op.id} onClick={() => { setModo(op.id); setPasso('detalhes'); }}
                style={{ padding: '22px 20px', background: 'white', border: `2px solid ${op.cor}20`, borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.borderColor = op.cor}
                onMouseLeave={e => e.currentTarget.style.borderColor = `${op.cor}20`}>
                <op.icon size={24} color={op.cor} style={{ marginBottom: 10 }} />
                <div style={{ fontWeight: 800, fontSize: 15, color: '#111111', marginBottom: 6 }}>{op.titulo}</div>
                <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>{op.desc}</div>
                <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 700, color: op.cor }}>
                  Selecionar <ChevronRight size={13} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── PASSO: Detalhes ── */}
      {passo === 'detalhes' && (
        <div>
          <div style={S.card}>
            <p style={S.secTitle}>{modo === 'gerar' ? 'Descreva o contrato' : 'Documento a assinar'}</p>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={S.label}>Título do contrato *</label>
                <input style={S.input} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Contrato de Assessoria Imobiliária" />
              </div>
              <div>
                <label style={S.label}>Tipo</label>
                <select style={S.input} value={tipoContrato} onChange={e => setTipoContrato(e.target.value)}>
                  {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 14 }}>
              <label style={S.label}>E-mail do assinante *</label>
              <input style={S.input} type="email" value={emailAssinante} onChange={e => setEmailAssinante(e.target.value)} placeholder="email@exemplo.com" />
            </div>

            {modo === 'gerar' ? (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>Descreva o que o contrato deve cobrir *</label>
                  <textarea style={{ ...S.input, minHeight: 130 }} value={descricaoIA} onChange={e => setDescricaoIA(e.target.value)}
                    placeholder="Ex: Contrato de assessoria para avaliação de 3 imóveis em leilão. Honorários de R$ 1.500,00 pagos em 2 parcelas. Prazo de 60 dias. Consultor responde por relatório técnico; cliente responde pela decisão de arrematar." />
                </div>
                <div style={{ marginBottom: 4 }}>
                  <label style={S.label}>Dados das partes (opcional — melhora a personalização)</label>
                  <textarea style={{ ...S.input, minHeight: 70 }} value={partesInfo} onChange={e => setPartesInfo(e.target.value)}
                    placeholder="Ex: Contratante: João Silva, CPF 123.456.789-00 / Contratada: TSN BidPro LTDA, CNPJ 00.000.000/0001-00" />
                </div>
              </>
            ) : (
              <div>
                <label style={S.label}>Conteúdo do documento *</label>
                <textarea style={{ ...S.input, minHeight: 220 }} value={conteudoDoc} onChange={e => setConteudoDoc(e.target.value)}
                  placeholder="Cole aqui o texto completo do contrato..." />
              </div>
            )}
          </div>

          {/* Arquivos de referência */}
          <div style={S.card}>
            <p style={S.secTitle}>Arquivos de referência (opcional)</p>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
              {modo === 'gerar' ? 'Anexe documentos de apoio (propostas, e-mails, laudos). Até 5 arquivos, 5 MB cada.' : 'Anexe o documento original para consulta do assinante. Até 5 arquivos, 5 MB cada.'}
            </p>
            <input ref={fileRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleArquivos} />
            <button onClick={() => fileRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 9, fontSize: 13, color: '#475569', cursor: 'pointer', fontWeight: 600 }}>
              <Upload size={14} /> Selecionar arquivos
            </button>
            {arquivosRef.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {arquivosRef.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: '#f1f5f9', borderRadius: 8, fontSize: 12 }}>
                    <FileText size={12} color="#64748b" />
                    <span style={{ color: '#334155', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <button onClick={() => setArquivosRef(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {erro && <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#dc2626', borderRadius: 9, fontSize: 12.5, marginBottom: 14 }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPasso('modo')} style={{ ...S.btn('#f1f5f9'), color: '#475569' }}>Voltar</button>
            <button onClick={() => { setErro(''); setPasso('identidade'); }} style={S.btn()}>
              Próximo: verificação de identidade <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}

      {/* ── PASSO: Verificação de identidade ── */}
      {passo === 'identidade' && (
        <div>
          <div style={S.card}>
            <p style={S.secTitle}>Verificação de identidade do assinante</p>
            <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 16px', lineHeight: 1.6 }}>
              Seguindo o padrão MP 2.200-2/2001 e Lei 14.063/2020, a assinatura eletrônica com coleta biométrica aumenta a validade jurídica do documento. Escolha o nível de verificação:
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {VERIFICACOES.map(v => (
                <label key={v.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 15px', borderRadius: 11, border: `2px solid ${verificacao === v.id ? '#0D63DB' : '#e2e8f0'}`, background: verificacao === v.id ? '#eff6ff' : 'white', cursor: 'pointer', transition: 'border-color 0.15s' }}>
                  <input type="radio" name="verif" value={v.id} checked={verificacao === v.id} onChange={() => setVerificacao(v.id)} style={{ marginTop: 3 }} />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#111111' }}>{v.label}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{v.desc}</div>
                  </div>
                  {v.id !== 'nenhuma' && (
                    <div style={{ marginLeft: 'auto' }}>
                      {v.id === 'selfie_doc' ? <UserCheck size={18} color="#0D63DB" /> : <Camera size={18} color="#0D63DB" />}
                    </div>
                  )}
                </label>
              ))}
            </div>
            <p style={{ fontSize: 11, color: '#94a3b8', margin: '14px 0 0', lineHeight: 1.6 }}>
              A captura de imagem é realizada pelo próprio assinante no navegador, sem armazenamento em terceiros. Imagens são salvas no Supabase Storage com acesso restrito ao contratante.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPasso('detalhes')} style={{ ...S.btn('#f1f5f9'), color: '#475569' }}>Voltar</button>
            {modo === 'gerar' ? (
              <button onClick={gerarComIA} disabled={gerandoIA} style={S.btn('#6366f1')}>
                {gerandoIA ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Gerando contrato…</> : <><Sparkles size={15} /> Gerar contrato com IA</>}
              </button>
            ) : (
              <button onClick={() => setPasso('revisao')} style={S.btn()}>
                Revisar e enviar <ChevronRight size={15} />
              </button>
            )}
          </div>
          {erro && <div style={{ marginTop: 12, padding: '10px 14px', background: '#fee2e2', color: '#dc2626', borderRadius: 9, fontSize: 12.5 }}>{erro}</div>}
        </div>
      )}

      {/* ── PASSO: Revisão ── */}
      {passo === 'revisao' && (
        <div>
          <div style={S.card}>
            <p style={S.secTitle}>Revisar contrato</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#eff6ff', color: '#0D63DB', borderRadius: 20 }}>{tipoContrato}</span>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#f0fdf4', color: '#059669', borderRadius: 20 }}>Assinante: {emailAssinante}</span>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#fef3c7', color: '#92400e', borderRadius: 20 }}>Verificação: {VERIFICACOES.find(v => v.id === verificacao)?.label}</span>
              {modo === 'gerar' && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#f3e8ff', color: '#6d28d9', borderRadius: 20 }}>Gerado por IA</span>}
            </div>
            <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.8, color: '#334155', background: '#f8fafc', borderRadius: 10, padding: 16, border: '1px solid #e2e8f0', maxHeight: 400, overflowY: 'auto' }}>
              {(modo === 'gerar' ? contratoGerado : conteudoDoc) || '(sem conteúdo)'}
            </div>
            {modo === 'gerar' && (
              <button onClick={() => { setContratoGerado(''); setPasso('identidade'); }} style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>
                <Sparkles size={12} /> Regerar contrato
              </button>
            )}
          </div>

          {erro && <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#dc2626', borderRadius: 9, fontSize: 12.5, marginBottom: 12 }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPasso('identidade')} style={{ ...S.btn('#f1f5f9'), color: '#475569' }}>Voltar</button>
            <button onClick={enviarContrato} disabled={enviando} style={S.btn('#059669')}>
              {enviando ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Enviando…</> : <><CheckCircle2 size={15} /> Enviar para assinatura</>}
            </button>
          </div>
        </div>
      )}

      {/* ── PASSO: Enviado ── */}
      {passo === 'enviado' && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <CheckCircle2 size={48} color="#059669" style={{ margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: '0 0 8px' }}>Contrato enviado!</h2>
          <p style={{ color: '#64748b', margin: '0 0 24px', fontSize: 14 }}>
            O assinante receberá o link por e-mail para ler e assinar eletronicamente.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => { setPasso('modo'); setModo(null); setTitulo(''); setEmailAssinante(''); setConteudoDoc(''); setDescricaoIA(''); setContratoGerado(''); setArquivosRef([]); }} style={S.btn()}>
              Criar outro contrato
            </button>
            <button onClick={() => nav('/contratos')} style={{ ...S.btn('#f1f5f9'), color: '#475569' }}>Ver contratos</button>
          </div>
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}
