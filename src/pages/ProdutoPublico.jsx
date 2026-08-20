import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { driveImage } from '../utils/driveUrl';
import { apiCall } from '../utils/apiCall';
import { salvarRef, lerRef } from '../utils/ref';
import { termoDoProduto, versaoTermoProduto } from '../utils/termos';

export default function ProdutoPublico({ tipo }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const ref = params.get('ref') || '';
  const { user, role, nome: nomePerfil } = useAuth();
  const [produto, setProduto] = useState(null);
  const [aulas, setAulas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [comprouAvulso, setComprouAvulso] = useState(false);
  const [comprando, setComprando] = useState(false);
  const [aguardando, setAguardando] = useState(false);
  const [erroCompra, setErroCompra] = useState('');
  const [aceitouTermo, setAceitouTermo] = useState(false); // termo próprio de curso/ebook

  // Persiste código de referência do consultor
  useEffect(() => {
    if (ref) salvarRef(ref); // persiste com janela de 30 dias
  }, [ref]);

  // Verifica compra avulsa para produtos pagos
  useEffect(() => {
    if (!user || !id || !produto || Number(produto.preco || 0) === 0) return;
    supabase.from('compras_produtos')
      .select('id').eq('user_id', user.id).eq('produto_tipo', tipo).eq('produto_id', id).eq('status', 'ativo')
      .then(({ data }) => { if (data?.length > 0) setComprouAvulso(true); });
  }, [user, id, produto, tipo]);

  // Enquanto aguarda o pagamento (aba do Asaas aberta), faz polling da compra → libera sozinho.
  useEffect(() => {
    if (!aguardando || !user || !id) return;
    const t = setInterval(async () => {
      const { data } = await supabase.from('compras_produtos')
        .select('id').eq('user_id', user.id).eq('produto_tipo', tipo).eq('produto_id', id).eq('status', 'ativo').limit(1);
      if (data?.length) { setComprouAvulso(true); setAguardando(false); }
    }, 5000);
    return () => clearInterval(t);
  }, [aguardando, user, id, tipo]);

  // Compra AVULSA (com o parceiro do ?ref): tenta Mercado Pago primeiro (Checkout Pro),
  // com fallback ao Asaas — mesma preferência de gateway do checkout de assinatura.
  async function comprar() {
    if (!user) { nav(`/login?modo=cadastro&produto=${tipo}:${id}${ref ? `&ref=${ref}` : ''}`); return; }
    setErroCompra(''); setComprando(true);
    try {
      const refCod = ref || lerRef();
      const nome = nomePerfil || user.user_metadata?.nome || user.user_metadata?.full_name || '';
      const payload = { produto_tipo: tipo, produto_id: id, ref: refCod, nome, email: user.email };
      let link = null, jaTem = false;

      // 1) Mercado Pago (Checkout Pro hospedado)
      try {
        const r = await apiCall('/api/mp', { method: 'POST', body: JSON.stringify({ action: 'criar_preferencia_produto', ...payload }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok && !j?.error) {
          if (j.ja_tem) jaTem = true;
          else link = j.initPoint || j.sandboxPoint || null;
        }
      } catch { /* cai no Asaas */ }

      // 2) Asaas (fallback ou gateway único)
      if (!jaTem && !link) {
        const r = await apiCall('/api/asaas', { method: 'POST', body: JSON.stringify({ action: 'criar_cobranca_avulsa', ...payload }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j?.error) throw new Error(j?.error === 'gratuito' ? 'Este produto é gratuito para você.' : (j?.error || 'Falha ao iniciar a compra'));
        if (j.ja_tem) jaTem = true;
        else link = j.linkPagamento || null;
      }

      if (jaTem) { setComprouAvulso(true); return; }
      if (link) {
        // Registra o ACEITE do termo de curso/ebook (com IP no servidor + hash por trigger)
        // ANTES de abrir o pagamento — antes desta correção, compra de produto digital não
        // deixava nenhum registro de aceite. Best-effort: não bloqueia a compra.
        apiCall('/api/registrar-aceite', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            produto_ref: `${tipo}_${id}`,
            valor: Number(produto?.preco || 0),
            user_agent: navigator.userAgent,
            termos_versao: versaoTermoProduto(`${tipo}_${id}`),
          }),
        }).catch(() => {});
        window.open(link, '_blank', 'noopener'); setAguardando(true);
      }
      else throw new Error('Não foi possível gerar o pagamento.');
    } catch (e) {
      setErroCompra(e?.message || 'Erro ao comprar');
    } finally { setComprando(false); }
  }

  useEffect(() => {
    async function load() {
      // RASCUNHO não é público: só produtos ATIVOS abrem na página pública (o incompleto
      // fica de rascunho no painel admin, fora da loja/links).
      if (tipo === 'curso') {
        const { data: c } = await supabase.from('cursos_admin').select('*').eq('id', id).eq('ativo', true).single();
        if (c) {
          const { data: as } = await supabase.from('aulas_admin').select('titulo, modulo, duracao, gratis').eq('curso_id', id).order('ordem');
          setAulas(as || []);
          setProduto(c);
        }
      } else {
        // Página PÚBLICA: seleciona só metadados — NUNCA arquivo_url/pdf_url (link
        // do PDF pago). O arquivo é entregue só na leitura, para quem tem acesso.
        const { data: e } = await supabase.from('ebooks_admin')
          .select('id, titulo, descricao, capa_url, preco, gratuito, ativo')
          .eq('id', id).eq('ativo', true).single();
        setProduto(e);
      }
      setLoading(false);
    }
    load();
  }, [id, tipo]);

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Carregando…</div>;
  if (!produto) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Produto não encontrado.</div>;

  const temPlano = user && ['top2','assessorado','clube','analista','advogado','admin'].includes(role);
  const temAcesso = temPlano || comprouAvulso;
  const isPago = Number(produto.preco) > 0;
  const cor = produto.cor || '#0D63DB';
  const bgCor = cor + '20';
  const refParam = ref ? `?ref=${ref}` : '';

  const modulos = aulas.reduce((acc, a) => {
    const mod = a.modulo || 'Conteúdo';
    if (!acc[mod]) acc[mod] = [];
    acc[mod].push(a);
    return acc;
  }, {});

  const irInicio = () => nav('/'); // '/' resolve p/ HOME (logado) ou LANDING (deslogado)

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', color: '#111111' }}>
      {/* Header — logo CLICÁVEL (→ início) + botão de navegação de volta à plataforma. Antes a
          página não tinha nenhuma forma de voltar. paddingTop com safe-area (rota fora do MainLayout). */}
      <header style={{ background: '#0f172a', padding: '12px 20px', paddingTop: 'calc(12px + env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, position: 'sticky', top: 0, zIndex: 20 }}>
        <button onClick={irInicio} title="Ir para o início" style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <span style={{ background: '#0D63DB', color: '#fff', fontWeight: 900, fontSize: 18, width: 34, height: 34, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>B</span>
          <span style={{ textAlign: 'left' }}>
            <span style={{ display: 'block', fontWeight: 900, fontSize: 14, color: '#fff', letterSpacing: 0.5 }}>BidPro Brasil</span>
            <span style={{ display: 'block', fontSize: 9.5, color: '#94a3b8', letterSpacing: 1.5, textTransform: 'uppercase' }}>Leilão & Investimentos</span>
          </span>
        </button>
        <button onClick={irInicio} style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 9, padding: '8px 14px', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          {user ? '🏠 Ir para o início' : '← Voltar ao site'}
        </button>
      </header>

      <div style={{ maxWidth: 1040, margin: '0 auto', padding: '32px 20px 60px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 360px', gap: 36, alignItems: 'start', boxSizing: 'border-box' }} className="produto-grid">

        {/* Coluna esquerda, apresentação (estilo Amazon: capa inteira, título, autor, "sobre") */}
        <div>
          {/* Capa em card branco, INTEIRA (objectFit contain) — antes cortava o topo da imagem. */}
          <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: 20, display: 'flex', justifyContent: 'center', marginBottom: 24, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            {produto.capa_url
              ? <img src={driveImage(produto.capa_url)} alt={produto.titulo} style={{ maxWidth: '100%', maxHeight: 440, objectFit: 'contain', borderRadius: 8 }} />
              : <div style={{ width: '100%', height: 280, borderRadius: 8, background: `linear-gradient(135deg, ${cor} 0%, ${cor}88 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 72 }}>{tipo === 'curso' ? produto.emoji || '🎓' : '📖'}</div>}
          </div>

          <div style={{ fontSize: 11, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 8 }}>{tipo === 'curso' ? 'Curso' : 'eBook'}</div>
          <h1 style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.25, margin: '0 0 6px', color: '#111111' }}>{produto.titulo}</h1>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>por <strong style={{ color: '#0D63DB' }}>BidPro Brasil</strong></div>
          {produto.subtitulo && <p style={{ color: '#374151', fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>{produto.subtitulo}</p>}
          {produto.descricao && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#111111', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, borderBottom: '1px solid #e5e7eb', paddingBottom: 6 }}>Sobre este {tipo === 'curso' ? 'curso' : 'eBook'}</div>
              <p style={{ color: '#374151', fontSize: 14.5, lineHeight: 1.8, margin: 0, whiteSpace: 'pre-wrap' }}>{produto.descricao}</p>
            </div>
          )}

          {/* Conteúdo do curso */}
          {tipo === 'curso' && aulas.length > 0 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#111111', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12, borderBottom: '1px solid #e5e7eb', paddingBottom: 6 }}>
                Conteúdo do curso · {aulas.length} aulas
              </div>
              {Object.entries(modulos).map(([mod, licoes]) => (
                <div key={mod} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#374151', marginBottom: 4, padding: '7px 10px', background: '#eef2f7', borderRadius: 6 }}>{mod}</div>
                  {licoes.map((l, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', fontSize: 13, color: '#4b5563', borderBottom: '1px solid #f3f4f6' }}>
                      <span style={{ fontSize: 11, color: l.gratis ? '#059669' : '#9ca3af' }}>{l.gratis ? '▶ Grátis' : '🔒'}</span>
                      <span>{l.titulo}</span>
                      {l.duracao && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>{l.duracao}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coluna direita, CTA (buy box estilo Amazon) */}
        <div style={{ position: 'sticky', top: 88 }}>
          <div style={{ background: 'white', borderRadius: 16, border: '1px solid #e5e7eb', padding: '26px 24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#111111', marginBottom: 2 }}>
              {isPago ? `R$ ${Number(produto.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Gratuito'}
            </div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 22 }}>
              {isPago ? 'Pagamento único' : 'Incluído na assinatura Investidor Pro'}
            </div>

            {temAcesso ? (
              /* Já tem acesso */
              <>
                <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 13, color: '#166534', fontWeight: 600 }}>
                  ✅ Você já tem acesso a este conteúdo
                </div>
                <button onClick={() => nav(tipo === 'curso' ? `/membros/curso/${id}` : `/membros/ebook/${id}`)}
                  style={{ width: '100%', padding: '14px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>
                  {tipo === 'curso' ? 'Acessar curso →' : 'Ler eBook →'}
                </button>
              </>
            ) : (
              /* Não tem acesso */
              <>
                <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '12px 14px', marginBottom: 20, fontSize: 13, color: '#084BA6' }}>
                  {isPago
                    ? '📦 Adquira o acesso a este conteúdo'
                    : '⭐ Disponível para assinantes Investidor Pro'}
                </div>
                {user ? (
                  <>
                    {isPago && (
                      /* Termo PRÓPRIO de curso/ebook (conteúdo digital, acesso imediato, CDC art. 49) */
                      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: '#475569', cursor: 'pointer', marginBottom: 10 }}>
                        <input type="checkbox" checked={aceitouTermo} onChange={(e) => setAceitouTermo(e.target.checked)} style={{ marginTop: 2, flexShrink: 0 }} />
                        <span>
                          Li e aceito o termo de contratação deste conteúdo digital.
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ color: '#0D63DB', cursor: 'pointer', fontWeight: 600 }}>Ver termo (versão {versaoTermoProduto(`${tipo}_${id}`)})</summary>
                            <p style={{ margin: '6px 0 0', fontSize: 11.5, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 10px', whiteSpace: 'pre-wrap' }}>
                              {termoDoProduto(`${tipo}_${id}`, { nome: produto?.titulo, valorLabel: `R$ ${Number(produto?.preco || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` }).texto}
                            </p>
                          </details>
                        </span>
                      </label>
                    )}
                    {isPago ? (
                      /* Compra AVULSA do item (não precisa assinar) */
                      <button onClick={comprar} disabled={comprando || aguardando || !aceitouTermo}
                        title={!aceitouTermo ? 'Marque o aceite do termo para continuar' : undefined}
                        style={{ width: '100%', padding: '15px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: (comprando || aguardando || !aceitouTermo) ? 'default' : 'pointer', marginBottom: 10, opacity: (comprando || aguardando || !aceitouTermo) ? 0.7 : 1 }}>
                        {comprando ? 'Abrindo pagamento…' : aguardando ? 'Aguardando pagamento…' : `Comprar por R$ ${Number(produto.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </button>
                    ) : (
                      <button onClick={() => nav(`/checkout?plano=top2${ref ? `&ref=${ref}` : ''}`)}
                        style={{ width: '100%', padding: '15px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>
                        Assinar Investidor Pro →
                      </button>
                    )}
                    {isPago && (
                      <button onClick={() => nav(`/checkout?plano=top2${ref ? `&ref=${ref}` : ''}`)}
                        style={{ width: '100%', padding: '12px', background: 'white', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 12, fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 12 }}>
                        Ou assine e desbloqueie todo o acervo
                      </button>
                    )}
                    {aguardando && (
                      <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#92400e', marginBottom: 8 }}>
                        Finalize o pagamento na aba que abriu. Esta página libera o acesso sozinha assim que o Asaas confirmar.
                      </div>
                    )}
                    {erroCompra && (
                      <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 10, padding: '10px 12px', fontSize: 12.5, color: '#b91c1c', marginBottom: 8 }}>{erroCompra}</div>
                    )}
                  </>
                ) : (
                  <>
                    <button onClick={() => nav(`/login?modo=cadastro&produto=${tipo}:${id}${isPago ? '' : `&plano=top2`}${ref ? `&ref=${ref}` : ''}`)}
                      style={{ width: '100%', padding: '15px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>
                      {isPago ? 'Comprar agora →' : 'Criar conta e acessar →'}
                    </button>
                    <button onClick={() => nav(`/login?produto=${tipo}:${id}${isPago ? '' : `&plano=top2`}${ref ? `&ref=${ref}` : ''}`)}
                      style={{ width: '100%', padding: '12px', background: 'white', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 12, fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 16 }}>
                      Já tenho conta, Entrar
                    </button>
                  </>
                )}
                {!isPago && (
                  <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                    Incluído no plano <strong>Investidor Pro</strong>
                  </div>
                )}
              </>
            )}

            <button onClick={() => nav('/')} style={{ marginTop: 16, width: '100%', background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, cursor: 'pointer' }}>
              ← Voltar para o início
            </button>
          </div>
        </div>
      </div>

      <style>{`@media (max-width: 700px) { .produto-grid { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}
