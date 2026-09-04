import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { docxParaBlocos, blocosParaCapitulos, agruparBlocos } from '../utils/parseDocx';

// Editor de e-book em formato ESTRUTURADO (docx → capítulos), estilo KDP: admin sobe um
// .docx, o sistema detecta capítulos pelos títulos do Word, o admin ajusta fronteiras
// manualmente se precisar, edita o texto de cada capítulo, e salva. MVP sem rich text
// (só texto) — ver docs/HANDOFF.md pra decisões de escopo. Aditivo: não mexe no fluxo
// de e-book PDF existente (EbooksTab/EbookPage/LeitorPaginado seguem intactos).

const ST = {
  page: { minHeight: '100vh', background: '#f1f5f9', fontFamily: "'Inter', sans-serif" },
  header: { background: '#111111', color: '#fff', padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  body: { padding: '24px 20px', maxWidth: 1000, margin: '0 auto' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16 },
  btn: (variant = 'primary') => ({
    padding: '8px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600,
    background: variant === 'primary' ? '#111111' : variant === 'danger' ? '#ef4444' : variant === 'outline' ? '#fff' : '#64748b',
    color: variant === 'outline' ? '#111111' : '#fff',
    border: variant === 'outline' ? '1px solid #cbd5e1' : 'none',
  }),
  input: { width: '100%', padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', outline: 'none' },
  label: { fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' },
};

function subirDocxOriginal(file, ebookId) {
  const path = `ebooks-docx/${ebookId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.docx`;
  return supabase.storage.from('documentos').upload(path, file, { upsert: false, contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    .then(({ error }) => {
      if (error) throw error;
      return path;
    })
    .catch((e) => {
      // Best-effort: falha aqui NÃO bloqueia a revisão de capítulos (o parse já rodou
      // em cima do File local). Só perde a conveniência de reprocessar sem novo upload.
      console.warn('[AdminEbookEditor] upload do .docx original falhou (best-effort):', e?.message || e);
      return null;
    });
}

export default function AdminEbookEditor() {
  const { id } = useParams();
  const nav = useNavigate();

  const [carregando, setCarregando] = useState(true);
  const [erroCarga, setErroCarga] = useState('');
  const [ebook, setEbook] = useState(null);
  const [modo, setModo] = useState('upload'); // upload | ajuste | editor

  const [enviandoArquivo, setEnviandoArquivo] = useState(false);
  const [blocos, setBlocos] = useState([]);
  const [avisosDocx, setAvisosDocx] = useState([]);
  const [expandido, setExpandido] = useState(null);
  const [docxPath, setDocxPath] = useState(null);

  const [capitulos, setCapitulos] = useState([]);
  const [capSelecionado, setCapSelecionado] = useState(0);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroCarga('');
    const [{ data: e, error: e1 }, { data: caps, error: e2 }] = await Promise.all([
      supabase.from('ebooks_admin').select('id,titulo,tipo_conteudo,docx_storage_path').eq('id', id).single(),
      supabase.from('ebook_capitulos').select('ordem,titulo,conteudo_texto').eq('ebook_id', id).order('ordem'),
    ]);
    if (e1) { setErroCarga('Erro ao carregar eBook: ' + e1.message); setCarregando(false); return; }
    if (e2) { setErroCarga('Erro ao carregar capítulos: ' + e2.message); setCarregando(false); return; }
    setEbook(e);
    setDocxPath(e?.docx_storage_path || null);
    if (Array.isArray(caps) && caps.length > 0) {
      setCapitulos(caps.map((c) => ({ ordem: c.ordem, titulo: c.titulo, conteudo_texto: c.conteudo_texto })));
      setModo('editor');
    } else {
      setModo('upload');
    }
    setCarregando(false);
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);

  async function aoEscolherArquivo(file) {
    if (!file) return;
    if (!/\.docx$/i.test(file.name)) {
      alert('Envie um arquivo .docx (Word 2007 ou mais recente). O formato .doc antigo não é suportado — salve como .docx no Word e tente de novo.');
      return;
    }
    setEnviandoArquivo(true);
    try {
      const { blocos: novosBlocos, avisos } = await docxParaBlocos(file);
      if (!novosBlocos.length) {
        alert('Não consegui extrair texto desse arquivo — ele está vazio ou o conteúdo é uma imagem escaneada (sem camada de texto)?');
        setEnviandoArquivo(false);
        return;
      }
      setBlocos(novosBlocos);
      setAvisosDocx(avisos);
      setExpandido(null);
      setModo('ajuste');
      subirDocxOriginal(file, id).then((path) => { if (path) setDocxPath(path); });
    } catch (e) {
      alert('Não consegui ler esse .docx: ' + (e?.message || 'arquivo corrompido ou em formato inesperado.'));
    }
    setEnviandoArquivo(false);
  }

  const grupos = useMemo(() => agruparBlocos(blocos), [blocos]);
  const porId = useMemo(() => new Map(blocos.map((b) => [b.id, b])), [blocos]);

  function renomearTitulo(blocoId, novoTexto) {
    setBlocos((prev) => prev.map((b) => (b.id === blocoId ? { ...b, texto: novoTexto } : b)));
  }
  function mesclarComAnterior(grupo) {
    if (grupo.tituloBlocoId == null) return;
    setBlocos((prev) => prev.map((b) => (b.id === grupo.tituloBlocoId ? { ...b, ehTitulo: false } : b)));
  }
  function dividirAqui(blocoId) {
    setBlocos((prev) => prev.map((b) => (b.id === blocoId ? { ...b, ehTitulo: true } : b)));
  }

  function confirmarCapitulos() {
    setCapitulos(blocosParaCapitulos(blocos));
    setCapSelecionado(0);
    setModo('editor');
  }

  function editarTituloCapitulo(idx, titulo) {
    setCapitulos((prev) => prev.map((c, i) => (i === idx ? { ...c, titulo } : c)));
  }
  function editarConteudoCapitulo(idx, conteudo_texto) {
    setCapitulos((prev) => prev.map((c, i) => (i === idx ? { ...c, conteudo_texto } : c)));
  }

  async function salvarTudo() {
    if (!capitulos.length) { alert('Não há capítulos pra salvar.'); return; }
    setSalvando(true);
    const payload = capitulos.map((c, i) => ({ ordem: i + 1, titulo: c.titulo, conteudo_texto: c.conteudo_texto }));
    const { error } = await supabase.rpc('salvar_capitulos_ebook', {
      p_ebook_id: id, p_capitulos: payload, p_docx_path: docxPath,
    });
    setSalvando(false);
    if (error) { alert('Erro ao salvar: ' + error.message); return; }
    alert('Capítulos salvos. Volte à aba eBooks para publicar (Ativar) quando estiver pronto.');
    nav('/admin');
  }

  if (carregando) {
    return <div style={ST.page}><div style={ST.body}><p style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>Carregando...</p></div></div>;
  }
  if (erroCarga) {
    return <div style={ST.page}><div style={ST.body}><div style={ST.card}><p style={{ color: '#dc2626' }}>{erroCarga}</p><button style={ST.btn('outline')} onClick={() => nav('/admin')}>← Voltar</button></div></div></div>;
  }

  return (
    <div style={ST.page}>
      <div style={ST.header}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Editor de capítulos</div>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{ebook?.titulo || 'eBook'}</div>
        </div>
        <button style={ST.btn('outline')} onClick={() => nav('/admin')}>← Voltar ao Admin</button>
      </div>

      <div style={ST.body}>
        {modo === 'upload' && (
          <div style={ST.card}>
            <h3 style={{ marginTop: 0 }}>Subir arquivo .docx</h3>
            <p style={{ color: '#64748b', fontSize: 13 }}>
              Suba o e-book já escrito em Word (.docx). O sistema detecta os capítulos
              automaticamente pelos títulos (Heading 1/2 do Word) — você ajusta manualmente
              na próxima tela se algo sair errado.
            </p>
            <input
              type="file" accept=".docx" disabled={enviandoArquivo}
              onChange={(e) => { aoEscolherArquivo(e.target.files?.[0]); e.target.value = ''; }}
            />
            {enviandoArquivo && <p style={{ color: '#0D63DB', fontSize: 13, marginTop: 8 }}>Lendo arquivo…</p>}
          </div>
        )}

        {modo === 'ajuste' && (
          <div>
            {avisosDocx.length > 0 && (
              <div style={{ ...ST.card, background: '#fffbeb', border: '1px solid #fde68a' }}>
                <strong style={{ fontSize: 13 }}>Avisos ao ler o arquivo:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: '#78350f' }}>
                  {avisosDocx.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}
            <div style={ST.card}>
              <h3 style={{ marginTop: 0 }}>Ajustar capítulos ({grupos.length} detectado{grupos.length === 1 ? '' : 's'})</h3>
              <p style={{ color: '#64748b', fontSize: 13, marginBottom: 16 }}>
                Renomeie, mescle um capítulo com o anterior, ou expanda pra dividir um capítulo
                no meio de um parágrafo específico.
              </p>
              {grupos.map((g, gi) => (
                <div key={gi} style={{ border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 10, padding: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {g.tituloBlocoId != null ? (
                      <input
                        style={{ ...ST.input, flex: 1, minWidth: 200, fontWeight: 700 }}
                        value={g.titulo}
                        onChange={(e) => renomearTitulo(g.tituloBlocoId, e.target.value)}
                      />
                    ) : (
                      <div style={{ flex: 1, fontWeight: 700, color: '#64748b', fontStyle: 'italic' }}>{g.titulo} (texto antes do 1º título)</div>
                    )}
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>{g.blocoIds.length} parágrafo{g.blocoIds.length === 1 ? '' : 's'}</span>
                    <button style={{ ...ST.btn('outline'), padding: '5px 10px', fontSize: 12 }} disabled={gi === 0 || g.tituloBlocoId == null} onClick={() => mesclarComAnterior(g)}>Mesclar com o anterior</button>
                    <button style={{ ...ST.btn('outline'), padding: '5px 10px', fontSize: 12 }} onClick={() => setExpandido(expandido === gi ? null : gi)}>{expandido === gi ? 'Recolher' : 'Expandir'}</button>
                  </div>
                  {expandido === gi && (
                    <div style={{ marginTop: 10, borderTop: '1px dashed #e2e8f0', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {g.blocoIds.length === 0 && <span style={{ fontSize: 12, color: '#94a3b8' }}>(sem parágrafos)</span>}
                      {g.blocoIds.map((bid) => (
                        <div key={bid} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
                          <button style={{ ...ST.btn('outline'), padding: '3px 8px', fontSize: 11, flexShrink: 0 }} onClick={() => dividirAqui(bid)}>Dividir aqui</button>
                          <span style={{ color: '#334155' }}>{porId.get(bid)?.texto}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button style={ST.btn('primary')} onClick={confirmarCapitulos}>Confirmar capítulos →</button>
              </div>
            </div>
          </div>
        )}

        {modo === 'editor' && (
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <div style={{ ...ST.card, width: 280, flexShrink: 0, maxHeight: '70vh', overflowY: 'auto' }}>
              <h4 style={{ marginTop: 0, fontSize: 14 }}>Capítulos ({capitulos.length})</h4>
              {capitulos.map((c, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <button
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 8px', borderRadius: 6, border: 'none', cursor: 'pointer', background: capSelecionado === i ? '#eff6ff' : 'transparent', color: capSelecionado === i ? '#0D63DB' : '#334155', fontSize: 12.5, fontWeight: capSelecionado === i ? 700 : 400 }}
                    onClick={() => setCapSelecionado(i)}
                  >
                    {i + 1}. {c.titulo || '(sem título)'}
                  </button>
                </div>
              ))}
            </div>
            <div style={{ ...ST.card, flex: 1 }}>
              {capitulos[capSelecionado] && (
                <>
                  <label style={ST.label}>Título do capítulo</label>
                  <input
                    style={{ ...ST.input, marginBottom: 12, fontWeight: 700 }}
                    value={capitulos[capSelecionado].titulo}
                    onChange={(e) => editarTituloCapitulo(capSelecionado, e.target.value)}
                  />
                  <label style={ST.label}>Texto</label>
                  <textarea
                    style={{ ...ST.input, height: '50vh', resize: 'vertical', lineHeight: 1.6, fontFamily: 'inherit' }}
                    value={capitulos[capSelecionado].conteudo_texto}
                    onChange={(e) => editarConteudoCapitulo(capSelecionado, e.target.value)}
                  />
                </>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                <button style={ST.btn('primary')} onClick={salvarTudo} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar capítulos'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
