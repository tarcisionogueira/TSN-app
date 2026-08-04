import React, { useState, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FileText, Sparkles, Upload, Camera, UserCheck, ChevronRight, X, CheckCircle2, Loader2, AlertTriangle, Eye } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../utils/supabase';
import { apiCall } from '../utils/apiCall';
import { extrairTextoDeVarios } from '../utils/extrairTextoDoc';
import { nomeArquivoSeguro } from '../utils/arquivo';
import { useIsMobile } from '../utils/useIsMobile';

const ROLES_OPERACIONAIS = ['admin', 'analista', 'advogado', 'consultor'];

const S = {
  card: { background: 'white', borderRadius: 14, border: '1px solid #e2e8f0', padding: '20px 22px', marginBottom: 16 },
  label: { fontSize: 12, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 5 },
  input: { width: '100%', padding: '10px 13px', border: '1px solid #e2e8f0', borderRadius: 9, fontSize: 13, color: '#111111', boxSizing: 'border-box', outline: 'none', resize: 'vertical' },
  btn: (cor = '#0D63DB') => ({ padding: '12px 22px', background: cor, color: 'white', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 7 }),
  secTitle: { fontSize: 15, fontWeight: 800, color: '#111111', margin: '0 0 14px' },
};

const VERIFICACOES = [
  { id: 'nenhuma',      label: 'Sem verificação de identidade', desc: 'Apenas assinatura eletrônica no canvas + dados do signatário' },
  { id: 'foto_doc',     label: 'Foto do documento (RG ou CNH)',  desc: 'Signatário captura/envia foto do documento de identidade' },
  { id: 'selfie',       label: 'Selfie',                         desc: 'Signatário captura foto do rosto via câmera' },
  { id: 'selfie_doc',   label: 'Selfie + Documento',             desc: 'Rosto e documento no mesmo enquadramento — maior segurança jurídica (padrão ZapSign)' },
];

const DOCS_EXTRAS = [
  { id: 'comprovante_residencia', label: 'Comprovante de residência' },
  { id: 'estado_civil',           label: 'Certidão de estado civil' },
  { id: 'procuracao',             label: 'Procuração / representação legal' },
];

const TIPOS_CONTRATO = [
  'Prestação de Serviços', 'Assessoria Jurídica', 'Consultoria Imobiliária',
  'Compra e Venda de Imóvel', 'Locação Residencial', 'Locação Comercial',
  'Parceria Comercial', 'Confidencialidade (NDA)', 'Honorários Advocatícios',
  'Contrato de Representação', 'Procuração / representação legal',
  'Termo de Compromisso', 'Outro',
];

export default function CriarContrato() {
  const nav = useNavigate();
  const loc = useLocation();
  const isMobile = useIsMobile();
  const { user, role } = useAuth();

  // Pré-preenchimento via navigation state (ex: vindo da tela de arrematação)
  const _preState = loc.state || {};
  const _tipoInicial = _preState.tipo === 'procuracao' ? 'Procuração / representação legal' : 'Prestação de Serviços';

  // Passo: 'modo' → 'detalhes' → 'identidade' → 'revisao' → 'enviado'
  const [passo, setPasso] = useState(_preState.tipo ? 'detalhes' : 'modo');
  const [modo, setModo] = useState(_preState.tipo ? 'gerar' : null); // 'assinar' | 'gerar'

  // Campos comuns
  const [titulo, setTitulo] = useState(_preState.titulo || '');
  // Um LINK POR ASSINANTE: cada parte recebe por e-mail e pode compartilhar o link.
  const [signatarios, setSignatarios] = useState([{ nome: _preState.clienteNome || '', email: _preState.emailAssinante || '' }]);
  const [tipoContrato, setTipoContrato] = useState(_tipoInicial);
  // DEFAULT do documento avulso (manual ou gerado por IA): exige FOTO + DOCUMENTO (selfie_doc —
  // rosto e documento no mesmo enquadramento), pedido do dono. Prova de autoria mais forte e casa
  // com o face match do KYC. Continua editável (o staff pode trocar por 'nenhuma' num caso pontual).
  const [verificacao, setVerificacao] = useState('selfie_doc');
  const [docsExtras, setDocsExtras] = useState([]); // ids dos docs extras exigidos
  const [requerTestemunha, setRequerTestemunha] = useState(false); // exige assinatura de testemunha
  // Atribuição a um plano/produto (opcional)
  const [produtos, setProdutos] = useState([]);   // [{ chave, tipo, id, nome }]
  const [produtoSel, setProdutoSel] = useState(''); // "tipo:chave"
  const [linksGerados, setLinksGerados] = useState([]); // resultado: [{nome,email,url}]
  const [copiadoIdx, setCopiadoIdx] = useState(null);   // feedback "Copiado!" por link

  const addSignatario = () => setSignatarios(s => s.length < 10 ? [...s, { nome: '', email: '' }] : s);
  const setSign = (i, campo, v) => setSignatarios(s => s.map((x, j) => j === i ? { ...x, [campo]: v } : x));
  const rmSignatario = (i) => setSignatarios(s => s.length > 1 ? s.filter((_, j) => j !== i) : s);

  // Carrega planos/cursos/ebooks ativos para o dropdown de atribuição.
  React.useEffect(() => {
    (async () => {
      try {
        const [{ data: pl }, { data: cs }, { data: eb }] = await Promise.all([
          supabase.from('planos_config').select('plano_key, nome').eq('ativo', true).eq('cobrar', true),
          supabase.from('cursos_admin').select('id, titulo').eq('ativo', true),
          supabase.from('ebooks_admin').select('id, titulo').eq('ativo', true),
        ]);
        const lista = [
          ...(pl || []).map(p => ({ tipo: 'plano', chave: p.plano_key, id: p.plano_key, nome: p.nome })),
          ...(cs || []).map(c => ({ tipo: 'curso', chave: String(c.id), id: String(c.id), nome: c.titulo })),
          ...(eb || []).map(e => ({ tipo: 'ebook', chave: String(e.id), id: String(e.id), nome: e.titulo })),
        ];
        setProdutos(lista);
      } catch { /* dropdown fica vazio */ }
    })();
  }, []);

  // Modo assinar: arquivo PDF/Word/imagem
  const [arquivoDoc, setArquivoDoc] = useState(null); // File
  const [arquivoUploading, setArquivoUploading] = useState(false);
  const [arquivoUrl, setArquivoUrl] = useState('');

  // Modo gerar
  const [descricaoIA, setDescricaoIA] = useState(_preState.contexto || '');
  const [partesInfo, setPartesInfo] = useState('');
  const [contratoGerado, setContratoGerado] = useState('');
  const [gerandoIA, setGerandoIA] = useState(false);
  const [lendoDocs, setLendoDocs] = useState(false);
  // Arquivo anexado que não deu para ler: vira aviso NA TELA. Não é erro (a geração segue
  // com o que sobrou), mas o usuário precisa saber que aquele anexo não entrou.
  const [avisoDocs, setAvisoDocs] = useState('');
  const [docsUsados, setDocsUsados] = useState([]);

  // Arquivos de referência adicionais
  const [arquivosRef, setArquivosRef] = useState([]);

  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');

  const fileDocRef = useRef();
  const fileRefRef = useRef();

  if (!user || !ROLES_OPERACIONAIS.includes(role)) {
    return (
      <div style={{ maxWidth: 520, margin: '80px auto', textAlign: 'center', padding: '0 20px' }}>
        <AlertTriangle size={36} color="#dc2626" style={{ margin: '0 auto 12px' }} />
        <h2 style={{ color: '#111111' }}>Acesso restrito</h2>
        <p style={{ color: '#64748b' }}>Apenas consultor, analista, advogado e admin podem criar contratos.</p>
      </div>
    );
  }

  // ── Upload do documento principal ──
  const handleDocUpload = async (file) => {
    if (!file) return;
    const maxSize = 20 * 1024 * 1024;
    if (file.size > maxSize) { setErro('Arquivo muito grande. Limite: 20 MB.'); return; }
    setArquivoDoc(file);
    setArquivoUrl('');
    setArquivoUploading(true);
    setErro('');
    try {
      const ext = file.name.split('.').pop().toLowerCase();
      const path = `contratos-docs/${user.id}/${Date.now()}.${ext}`;
      const { data, error } = await supabase.storage.from('documentos').upload(path, file, { upsert: false });
      if (error) throw error;
      // Bucket privado: signed URL de 1 ano
      const { data: signed } = await supabase.storage.from('documentos').createSignedUrl(data.path, 60 * 60 * 24 * 365);
      setArquivoUrl(signed?.signedUrl || '');
    } catch (e) {
      setErro('Erro ao enviar arquivo: ' + e.message);
      setArquivoDoc(null);
    }
    setArquivoUploading(false);
  };

  // ── Upload arquivos referência ──
  const handleArquivosRef = (e) => {
    const files = Array.from(e.target.files || []);
    setArquivosRef(prev => [...prev, ...files].slice(0, 5));
  };

  const toggleDocExtra = (id) => {
    setDocsExtras(p => p.includes(id) ? p.filter(d => d !== id) : [...p, id]);
  };

  // ── Gerar com IA ──
  const gerarComIA = async () => {
    if (descricaoIA.trim().length < 20) { setErro('Descreva o contrato com pelo menos 20 caracteres.'); return; }
    setGerandoIA(true); setErro(''); setAvisoDocs(''); setDocsUsados([]);
    try {
      // 🔴 OS ANEXOS PRECISAM CHEGAR NA IA (corrigido 04/08). A tela promete "anexe
      // documentos para a IA extrair as informações", mas os arquivos só eram enviados no
      // passo FINAL, como links para o signatário — a geração recebia SÓ a descrição
      // digitada. Foi por isso que o dono anexou o contrato anterior pedindo "mantenha
      // contratante e contratado" e recebeu [NOME COMPLETO] / [CPF: XXX.XXX.XXX-XX]: o
      // modelo nunca viu o documento. A rota já aceitava `documentos`; faltava preencher.
      let documentos = '';
      if (arquivosRef.length) {
        setLendoDocs(true);
        const r0 = await extrairTextoDeVarios(arquivosRef);
        setLendoDocs(false);
        documentos = r0.documentos;
        // Arquivo que não deu para ler é DITO, nunca descartado em silêncio — silêncio aqui
        // é exatamente o que fez o dono achar que o anexo tinha sido usado.
        if (r0.ignorados.length) setAvisoDocs(`Não consegui ler: ${r0.ignorados.join(' · ')}. O contrato foi gerado SEM o conteúdo desse(s) arquivo(s).`);
        // Confirmação POSITIVA do que entrou. O dono não tinha como saber se o anexo tinha
        // sido usado — e não estava sendo. Agora a tela de revisão diz, por nome.
        setDocsUsados(r0.lidos);
      }

      // /api/gerar-contrato-ia devolve { ok, contrato } (o /api/gerar-contrato
      // devolve { conteudo } — o modo IA lia o campo errado e vinha vazio).
      // Via apiCall: injeta o token E registra `api_erro` no Cliente 360 — este erro
      // aconteceu com o dono na tela e não deixou rastro nenhum no painel.
      // TETO DE ESPERA (3 min): sem ele o botão fica em "Gerando contrato…" para sempre se o
      // servidor não responder — foi o que o dono viu em 04/08 quando a função ficou pendurada
      // até o maxDuration. A geração real leva ~30-60s, então 3 min é folgado sem ser eterno.
      const r = await apiCall('/api/gerar-contrato-ia', {
        method: 'POST',
        body: JSON.stringify({ descricao: descricaoIA, tipo: tipoContrato, partes: partesInfo, documentos }),
        signal: AbortSignal.timeout(180000),
      });
      // NUNCA `.json()` direto: quando a Vercel mata a função (timeout de runtime) ou um
      // proxy responde, o corpo é TEXTO PURO — e o parse estourava um "Unexpected token 'A',
      // "An error o"... is not valid JSON" na cara do usuário, escondendo o erro de verdade.
      const bruto = await r.text();
      let data; try { data = JSON.parse(bruto); } catch { data = null; }
      if (!data) {
        throw new Error(r.ok
          ? 'A IA respondeu num formato inesperado. Tente de novo.'
          : `O servidor falhou ao gerar o contrato (HTTP ${r.status}). Tente de novo; se persistir, avise o suporte.`);
      }
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erro ao gerar');
      // Contrato cortado no limite de tokens PARECE completo na caixa de revisão. Avisa, senão
      // o operador manda assinar um documento que termina no meio de uma cláusula.
      if (data.truncado) {
        setAvisoDocs(av => `${av ? av + ' ' : ''}O texto atingiu o tamanho máximo e pode ter ficado incompleto no fim — role até o final e confira antes de enviar.`);
      }
      setContratoGerado(data.contrato || data.conteudo || '');
      setPasso('revisao');
    } catch (e) {
      // AbortSignal.timeout dispara TimeoutError — a mensagem nativa ("signal timed out")
      // não diz nada ao usuário. Traduz para o que ele precisa saber e fazer.
      setErro(e?.name === 'TimeoutError'
        ? 'A geração passou de 3 minutos sem resposta e foi interrompida. Tente de novo; se repetir, avise o suporte.'
        : e.message);
    }
    setLendoDocs(false);
    setGerandoIA(false);
  };

  // ── Enviar para assinatura ──
  const enviarContrato = async () => {
    setErro('');
    if (!titulo.trim()) { setErro('Informe o título do contrato.'); return; }
    const signValidos = signatarios.filter(s => /\S+@\S+\.\S+/.test(s.email.trim()));
    if (!signValidos.length) { setErro('Informe ao menos um assinante com e-mail válido.'); return; }
    if (modo === 'assinar' && !arquivoUrl) { setErro('Aguarde o upload do arquivo ou selecione um arquivo.'); return; }
    if (modo === 'gerar' && !contratoGerado) { setErro('Gere o contrato antes de enviar.'); return; }

    setEnviando(true);
    try {
      // Upload arquivos referência.
      // 🔴 A CHAVE PRECISA SER ASCII (corrigido 04/08): o nome do arquivo ia CRU para a chave
      // do Storage. "CONTRATO PRESTAÇÃO DE SERVIÇO DE ASSESSORIA.pdf" devolvia
      // `Invalid key` (400) — a chave não aceita acento/cedilha. E o `error` era DESCARTADO,
      // então o contrato seguia para assinatura SEM o anexo, calado. O `nome` guardado na
      // linha continua sendo o ORIGINAL: quem lê a lista vê o nome de verdade.
      const refs = [];
      const refsFalhas = [];
      for (const f of arquivosRef) {
        const path = `contratos-ref/${user.id}/${Date.now()}-${nomeArquivoSeguro(f.name)}`;
        const { data: up, error: upErr } = await supabase.storage.from('documentos').upload(path, f, { upsert: false });
        if (upErr || !up?.path) { refsFalhas.push(f.name); continue; }
        const { data: signed } = await supabase.storage.from('documentos').createSignedUrl(up.path, 60 * 60 * 24 * 365);
        refs.push({ nome: f.name, url: signed?.signedUrl || null });
      }
      // Anexo que não subiu PARA o envio: o operador decide se manda assim ou corrige. Antes
      // sumia sem aviso e o signatário recebia o contrato sem o documento de apoio.
      if (refsFalhas.length) {
        throw new Error(`Não consegui enviar o(s) anexo(s): ${refsFalhas.join(', ')}. Remova-o(s) da lista ou renomeie o arquivo e tente de novo — o contrato NÃO foi enviado.`);
      }

      const prod = produtos.find(p => `${p.tipo}:${p.chave}` === produtoSel) || null;
      const body = {
        titulo,
        tipo: tipoContrato,
        signatarios: signValidos.map(s => ({ nome: s.nome.trim(), email: s.email.trim() })),
        verificacaoIdentidade: verificacao,
        docsExtrasExigidos: docsExtras,
        arquivosReferencia: refs,
        geradoPorIA: modo === 'gerar',
        requerTestemunha,
        // Atribuição a um plano/produto (opcional)
        planoKey: prod?.tipo === 'plano' ? prod.chave : null,
        produtoTipo: prod?.tipo || null,
        produtoId: prod?.id || null,
        // Atribuição a uma ARREMATAÇÃO (quando o contrato é criado a partir de um arremate):
        // ao concluir, o documento assinado aparece nos documentos daquela arrematação.
        arremateImovelId: _preState.arremateImovelId || null,
        arremateUserId: _preState.arremateUserId || null,
        // Modo assinar: arquivo. Modo gerar: texto.
        arquivoUrl: modo === 'assinar' ? arquivoUrl : null,
        arquivoNome: modo === 'assinar' ? arquivoDoc?.name : null,
        conteudo: modo === 'gerar' ? contratoGerado : `Documento anexo: ${arquivoDoc?.name || 'contrato'}`,
      };

      // Mesma régua do gerarComIA: apiCall (token + rastro no Cliente 360) e parse defensivo.
      // Este é o passo que DISPARA os e-mails de assinatura — falhar aqui com um erro ilegível
      // é pior ainda, porque o staff não sabe se o contrato foi enviado ou não.
      const r = await apiCall('/api/gerar-contrato', { method: 'POST', body: JSON.stringify(body) });
      const bruto = await r.text();
      let data; try { data = JSON.parse(bruto); } catch { data = null; }
      if (!data) {
        throw new Error(r.ok
          ? 'O servidor respondeu num formato inesperado. Confira em Contratos se o envio foi concluído antes de tentar de novo.'
          : `Falha ao enviar o contrato (HTTP ${r.status}). Confira em Contratos se ele foi criado antes de tentar de novo.`);
      }
      if (!r.ok || !data.ok) throw new Error(data.error || 'Erro ao enviar');
      setLinksGerados(Array.isArray(data.links) ? data.links : []);
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
        <button onClick={() => { if (passo === 'modo') nav(-1); else setPasso(p => ({ identidade: 'detalhes', revisao: 'identidade', detalhes: 'modo' }[p] || 'modo')); }}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: 18, padding: '0 4px' }}>←</button>
        <h1 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: 0 }}>Novo Contrato</h1>
      </div>

      {/* Indicador de passos */}
      {passo !== 'enviado' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 24, alignItems: 'center' }}>
          {['modo', 'detalhes', 'identidade', 'revisao'].map((p, i) => (
            <React.Fragment key={p}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', background: ['modo','detalhes','identidade','revisao'].indexOf(passo) >= i ? '#0D63DB' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: ['modo','detalhes','identidade','revisao'].indexOf(passo) >= i ? 'white' : '#94a3b8' }}>
                {i + 1}
              </div>
              {i < 3 && <div style={{ flex: 1, height: 2, background: ['modo','detalhes','identidade','revisao'].indexOf(passo) > i ? '#0D63DB' : '#e2e8f0' }} />}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* ── PASSO 1: Modo ── */}
      {passo === 'modo' && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 14 }}>
          {[
            { id: 'assinar', icon: FileText, cor: '#0D63DB', titulo: 'Assinar documento pronto', desc: 'Já tem o documento? Envie o PDF/Word/imagem, informe as partes e envie para assinar (com ou sem foto).' },
            { id: 'gerar',   icon: Sparkles, cor: '#6366f1', titulo: 'Criar documento com IA', desc: 'A IA cria o contrato; você pode anexar documentos para ela extrair as informações (com ou sem foto).' },
          ].map(op => (
            <button key={op.id} onClick={() => { setModo(op.id); setPasso('detalhes'); }}
              style={{ padding: '24px 20px', background: 'white', border: `2px solid ${op.cor}20`, borderRadius: 14, cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = op.cor; e.currentTarget.style.transform = 'translateY(-2px)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = `${op.cor}20`; e.currentTarget.style.transform = 'none'; }}>
              <op.icon size={26} color={op.cor} style={{ marginBottom: 12 }} />
              <div style={{ fontWeight: 800, fontSize: 15, color: '#111111', marginBottom: 7 }}>{op.titulo}</div>
              <div style={{ fontSize: 12.5, color: '#64748b', lineHeight: 1.6 }}>{op.desc}</div>
            </button>
          ))}
        </div>
      )}

      {/* ── PASSO 2: Detalhes ── */}
      {passo === 'detalhes' && (
        <div>
          <div style={S.card}>
            <p style={S.secTitle}>{modo === 'gerar' ? 'Descreva o contrato para a IA' : 'Documento para assinatura'}</p>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={S.label}>Título do contrato *</label>
                <input style={S.input} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Contrato de Assessoria Imobiliária" />
              </div>
              <div>
                <label style={S.label}>Tipo</label>
                <select style={S.input} value={tipoContrato} onChange={e => setTipoContrato(e.target.value)}>
                  {TIPOS_CONTRATO.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Assinantes (partes) *</label>
              <p style={{ fontSize: 11.5, color: '#94a3b8', margin: '0 0 8px' }}>Cada assinante recebe o contrato por e-mail com o seu próprio link para assinar (e pode compartilhá-lo).</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {signatarios.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input style={{ ...S.input, flex: 1 }} value={s.nome} onChange={e => setSign(i, 'nome', e.target.value)} placeholder="Nome (opcional)" />
                    <input style={{ ...S.input, flex: 1.4 }} type="email" value={s.email} onChange={e => setSign(i, 'email', e.target.value)} placeholder="email@exemplo.com" />
                    {signatarios.length > 1 && <button onClick={() => rmSignatario(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4 }}><X size={16} /></button>}
                  </div>
                ))}
              </div>
              {signatarios.length < 10 && <button onClick={addSignatario} style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: '#0D63DB', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}><UserCheck size={13} /> Adicionar assinante</button>}
            </div>

            {/* Atribuir a um plano/produto (opcional) */}
            <div style={{ marginBottom: 16 }}>
              <label style={S.label}>Atribuir a um plano/produto (opcional)</label>
              <select style={S.input} value={produtoSel} onChange={e => setProdutoSel(e.target.value)}>
                <option value="">Não vincular a nenhum produto</option>
                {produtos.map(p => <option key={`${p.tipo}:${p.chave}`} value={`${p.tipo}:${p.chave}`}>{({ plano: 'Plano', curso: 'Curso', ebook: 'eBook' }[p.tipo] || p.tipo)} — {p.nome}</option>)}
              </select>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '6px 0 0' }}>Vinculado, aparece como "contrato atribuído" na tela de Produtos (Admin), para consulta.</p>
            </div>

            {/* Modo assinar: upload do arquivo */}
            {modo === 'assinar' && (
              <div>
                <label style={S.label}>Arquivo do documento (PDF, Word, JPG, PNG) *</label>
                <input ref={fileDocRef} type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }}
                  onChange={e => handleDocUpload(e.target.files[0])} />

                {!arquivoDoc ? (
                  <button onClick={() => fileDocRef.current?.click()}
                    style={{ width: '100%', padding: '28px 20px', border: '2px dashed #cbd5e1', borderRadius: 12, background: '#f8fafc', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <Upload size={28} color="#94a3b8" />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#475569' }}>Clique para selecionar o documento</span>
                    <span style={{ fontSize: 11.5, color: '#94a3b8' }}>PDF, Word, JPG ou PNG — até 20 MB</span>
                  </button>
                ) : (
                  <div style={{ padding: '14px 16px', background: arquivoUploading ? '#fef3c7' : arquivoUrl ? '#f0fdf4' : '#f8fafc', borderRadius: 10, border: `1px solid ${arquivoUploading ? '#fcd34d' : arquivoUrl ? '#86efac' : '#e2e8f0'}`, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FileText size={20} color={arquivoUrl ? '#059669' : '#64748b'} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#111111' }}>{arquivoDoc.name}</div>
                      <div style={{ fontSize: 11.5, color: '#64748b' }}>
                        {arquivoUploading ? 'Enviando…' : arquivoUrl ? 'Upload concluído ✓' : 'Aguardando…'}
                      </div>
                    </div>
                    {arquivoUrl && <a href={arquivoUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: '#0D63DB', fontWeight: 700 }}><Eye size={13} /> Ver</a>}
                    <button onClick={() => { setArquivoDoc(null); setArquivoUrl(''); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}><X size={16} /></button>
                  </div>
                )}
              </div>
            )}

            {/* Modo gerar: descrição para IA */}
            {modo === 'gerar' && (
              <>
                <div style={{ marginBottom: 14 }}>
                  <label style={S.label}>O que o contrato deve cobrir *</label>
                  <textarea style={{ ...S.input, minHeight: 130 }} value={descricaoIA} onChange={e => setDescricaoIA(e.target.value)}
                    placeholder="Ex: Contrato de assessoria para análise de 3 imóveis em leilão. Honorários de R$ 1.500,00 em 2 parcelas. Prazo 60 dias. O consultor entrega relatório técnico; o cliente decide sobre a arrematação." />
                </div>
                <div>
                  <label style={S.label}>Dados das partes (opcional)</label>
                  <textarea style={{ ...S.input, minHeight: 60 }} value={partesInfo} onChange={e => setPartesInfo(e.target.value)}
                    placeholder="Ex: Contratante: João Silva, CPF 123.456.789-00 / Contratada: BidPro Brasil LTDA, CNPJ 00.000.000/0001-00" />
                </div>
              </>
            )}
          </div>

          {/* Arquivos de referência adicionais */}
          <div style={S.card}>
            <p style={S.secTitle}>Documentos de referência adicionais (opcional)</p>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px', lineHeight: 1.5 }}>
              {modo === 'gerar' ? 'Anexe propostas, e-mails ou documentos de suporte para a IA.' : 'Documentos que o signatário pode consultar ao ler e assinar.'}
              {' '}Até 5 arquivos, 5 MB cada.
            </p>
            <input ref={fileRefRef} type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleArquivosRef} />
            <button onClick={() => fileRefRef.current?.click()}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 16px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: 9, fontSize: 13, color: '#475569', cursor: 'pointer', fontWeight: 600 }}>
              <Upload size={14} /> Adicionar arquivos de referência
            </button>
            {arquivosRef.length > 0 && (
              <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {arquivosRef.map((f, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', background: '#f1f5f9', borderRadius: 8, fontSize: 12 }}>
                    <FileText size={12} color="#64748b" />
                    <span style={{ color: '#334155', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                    <button onClick={() => setArquivosRef(p => p.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 0 }}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {erro && <div style={{ padding: '10px 14px', background: '#fee2e2', color: '#dc2626', borderRadius: 9, fontSize: 12.5, marginBottom: 14 }}>{erro}</div>}

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => { setPasso('modo'); setErro(''); }} style={{ ...S.btn('#f1f5f9'), color: '#475569' }}>Voltar</button>
            <button onClick={() => {
              setErro('');
              if (!titulo.trim()) { setErro('Informe o título.'); return; }
              if (!signatarios.some(s => /\S+@\S+\.\S+/.test(s.email.trim()))) { setErro('Informe ao menos um assinante com e-mail válido.'); return; }
              if (modo === 'assinar' && !arquivoDoc) { setErro('Selecione o arquivo do documento.'); return; }
              if (modo === 'assinar' && !arquivoUrl && !arquivoUploading) { setErro('Aguarde o upload concluir.'); return; }
              setPasso('identidade');
            }} disabled={arquivoUploading} style={S.btn(arquivoUploading ? '#94a3b8' : undefined)}>
              {arquivoUploading ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Enviando arquivo…</> : <>Próximo <ChevronRight size={14} /></>}
            </button>
          </div>
        </div>
      )}

      {/* ── PASSO 3: Verificação de identidade ── */}
      {passo === 'identidade' && (
        <div>
          <div style={S.card}>
            <p style={S.secTitle}>Verificação de identidade do signatário</p>
            <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 12px', lineHeight: 1.6 }}>
              Seguindo o padrão da MP 2.200-2/2001 e Lei 14.063/2020. O signatário realiza a captura no próprio navegador, sem app externo.
            </p>
            <div style={{ margin: '0 0 16px', padding: '10px 13px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, fontSize: 12, color: '#1e40af', lineHeight: 1.6 }}>
              Por padrão, todo documento avulso pede <strong>foto (selfie) + documento</strong> do signatário — a plataforma confere automaticamente se são a mesma pessoa. Você pode ajustar abaixo se este documento específico não precisar.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              {VERIFICACOES.map(v => (
                <label key={v.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '13px 15px', borderRadius: 11, border: `2px solid ${verificacao === v.id ? '#0D63DB' : '#e2e8f0'}`, background: verificacao === v.id ? '#eff6ff' : 'white', cursor: 'pointer' }}>
                  <input type="radio" name="verif" value={v.id} checked={verificacao === v.id} onChange={() => setVerificacao(v.id)} style={{ marginTop: 3 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#111111' }}>{v.label}</div>
                    <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{v.desc}</div>
                  </div>
                  {v.id !== 'nenhuma' && <Camera size={16} color="#0D63DB" style={{ flexShrink: 0, marginTop: 2 }} />}
                </label>
              ))}
            </div>

            {/* Documentos extras exigidos */}
            <p style={{ fontSize: 13, fontWeight: 800, color: '#111111', margin: '0 0 10px' }}>Documentos adicionais a exigir do signatário</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {DOCS_EXTRAS.map(d => (
                <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 14px', borderRadius: 9, border: `1px solid ${docsExtras.includes(d.id) ? '#0D63DB' : '#e2e8f0'}`, background: docsExtras.includes(d.id) ? '#eff6ff' : '#f8fafc' }}>
                  <input type="checkbox" checked={docsExtras.includes(d.id)} onChange={() => toggleDocExtra(d.id)} />
                  <span style={{ fontSize: 13, color: '#334155', fontWeight: docsExtras.includes(d.id) ? 700 : 400 }}>{d.label}</span>
                </label>
              ))}
            </div>

            {/* Testemunha */}
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', padding: '12px 14px', borderRadius: 10, border: `1px solid ${requerTestemunha ? '#0D63DB' : '#e2e8f0'}`, background: requerTestemunha ? '#eff6ff' : '#f8fafc', marginTop: 16 }}>
              <input type="checkbox" checked={requerTestemunha} onChange={e => setRequerTestemunha(e.target.checked)} style={{ marginTop: 2 }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111111' }}>Exigir assinatura de testemunha</div>
                <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>Ao final da assinatura da parte, o sistema disponibiliza um link para ela <strong>compartilhar com a sua testemunha</strong>, que preenche nome, CPF e assina. O contrato só fica completo quando os dois assinarem.</div>
              </div>
            </label>

            <p style={{ fontSize: 11, color: '#94a3b8', margin: '14px 0 0', lineHeight: 1.6 }}>
              Capturas e uploads são armazenados no Supabase Storage com acesso restrito. Nenhum dado biométrico é processado por terceiros.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => setPasso('detalhes')} style={{ ...S.btn('#f1f5f9'), color: '#475569' }}>Voltar</button>
            {modo === 'gerar' ? (
              <button onClick={gerarComIA} disabled={gerandoIA} style={S.btn('#6366f1')}>
                {lendoDocs
                  ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Lendo os documentos anexados…</>
                  : gerandoIA
                    ? <><Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> Gerando contrato…</>
                    : <><Sparkles size={15} /> Gerar contrato com IA</>}
              </button>
            ) : (
              <button onClick={() => setPasso('revisao')} style={S.btn()}>
                Revisar e enviar <ChevronRight size={14} />
              </button>
            )}
          </div>
          {erro && <div style={{ marginTop: 12, padding: '10px 14px', background: '#fee2e2', color: '#dc2626', borderRadius: 9, fontSize: 12.5 }}>{erro}</div>}
          {/* Anexo não lido é AVISO (âmbar), não erro: o contrato foi gerado, mas sem aquele
              arquivo. Some junto com o erro quando se gera de novo. */}
          {avisoDocs && <div style={{ marginTop: 12, padding: '10px 14px', background: '#fef3c7', color: '#92400e', borderRadius: 9, fontSize: 12.5, lineHeight: 1.5 }}>⚠️ {avisoDocs}</div>}
        </div>
      )}

      {/* ── PASSO 4: Revisão ── */}
      {passo === 'revisao' && (
        <div>
          <div style={S.card}>
            <p style={S.secTitle}>Revisar antes de enviar</p>

            {/* O que a IA REALMENTE leu. Sem isto não há como distinguir "o anexo foi usado"
                de "o anexo foi ignorado" — a dúvida que o dono teve em 04/08, com razão. */}
            {docsUsados.length > 0 && (
              <div style={{ marginBottom: 12, padding: '10px 14px', background: '#f0fdf4', color: '#166534', borderRadius: 9, fontSize: 12.5, lineHeight: 1.5, border: '1px solid #86efac' }}>
                ✓ A IA leu o conteúdo de: <strong>{docsUsados.join(', ')}</strong>
              </div>
            )}
            {avisoDocs && <div style={{ marginBottom: 12, padding: '10px 14px', background: '#fef3c7', color: '#92400e', borderRadius: 9, fontSize: 12.5, lineHeight: 1.5 }}>⚠️ {avisoDocs}</div>}

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#eff6ff', color: '#0D63DB', borderRadius: 20 }}>{tipoContrato}</span>
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#f0fdf4', color: '#059669', borderRadius: 20 }}>{signatarios.filter(s => s.email.trim()).length} assinante(s)</span>
              {requerTestemunha && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#eff6ff', color: '#0D63DB', borderRadius: 20 }}>Com testemunha</span>}
              {produtoSel && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#f3e8ff', color: '#6d28d9', borderRadius: 20 }}>Vinculado a produto</span>}
              <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#fef3c7', color: '#92400e', borderRadius: 20 }}>{VERIFICACOES.find(v => v.id === verificacao)?.label}</span>
              {docsExtras.length > 0 && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#f3e8ff', color: '#6d28d9', borderRadius: 20 }}>{docsExtras.length} doc(s) extra(s)</span>}
              {modo === 'gerar' && <span style={{ fontSize: 12, fontWeight: 700, padding: '4px 10px', background: '#f3e8ff', color: '#6d28d9', borderRadius: 20 }}>Gerado por IA</span>}
            </div>

            {modo === 'assinar' && arquivoUrl && (
              <div style={{ padding: '14px 16px', background: '#f0fdf4', borderRadius: 10, border: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <FileText size={20} color="#059669" />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111111' }}>{arquivoDoc?.name}</div>
                  <div style={{ fontSize: 11.5, color: '#059669' }}>Upload concluído ✓</div>
                </div>
                <a href={arquivoUrl} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#0D63DB', fontWeight: 700 }}><Eye size={13} /> Visualizar</a>
              </div>
            )}

            {modo === 'gerar' && contratoGerado && (
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.8, color: '#334155', background: '#f8fafc', borderRadius: 10, padding: 16, border: '1px solid #e2e8f0', maxHeight: 320, overflowY: 'auto' }}>
                {contratoGerado}
              </div>
            )}

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

      {/* ── Enviado ── */}
      {passo === 'enviado' && (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <CheckCircle2 size={52} color="#059669" style={{ margin: '0 auto 16px' }} />
          <h2 style={{ fontSize: 22, fontWeight: 900, color: '#111111', margin: '0 0 8px' }}>Contrato enviado!</h2>
          <p style={{ color: '#64748b', margin: '0 0 20px', fontSize: 14, lineHeight: 1.6 }}>
            Cada assinante recebeu o contrato por e-mail com o seu link. Você também pode copiar e compartilhar os links abaixo.
          </p>
          {linksGerados.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 520, margin: '0 auto 24px', textAlign: 'left' }}>
              {linksGerados.map((l, i) => {
                const Copiar = ({ url, k }) => (
                  <button onClick={() => { navigator.clipboard?.writeText(url); setCopiadoIdx(k); setTimeout(() => setCopiadoIdx(c => c === k ? null : c), 1800); }} style={{ padding: '7px 12px', background: copiadoIdx === k ? '#dcfce7' : '#eff6ff', color: copiadoIdx === k ? '#166534' : '#0D63DB', border: `1px solid ${copiadoIdx === k ? '#86efac' : '#bfdbfe'}`, borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', flexShrink: 0 }}>{copiadoIdx === k ? '✓ Copiado!' : 'Copiar link'}</button>
                );
                return (
                  <div key={i} style={{ padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>{l.nome || l.email}</div>
                        <div style={{ fontSize: 11.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.url}</div>
                      </div>
                      <Copiar url={l.url} k={i} />
                    </div>
                    {l.testemunhaUrl && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e2e8f0' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#0D63DB' }}>🔗 Link da testemunha desta parte</div>
                          <div style={{ fontSize: 11.5, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.testemunhaUrl}</div>
                        </div>
                        <Copiar url={l.testemunhaUrl} k={`t${i}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => { setPasso('modo'); setModo(null); setTitulo(''); setSignatarios([{ nome: '', email: '' }]); setArquivoDoc(null); setArquivoUrl(''); setDescricaoIA(''); setContratoGerado(''); setArquivosRef([]); setVerificacao('nenhuma'); setDocsExtras([]); setRequerTestemunha(false); setProdutoSel(''); setLinksGerados([]); setErro(''); }} style={S.btn()}>
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
