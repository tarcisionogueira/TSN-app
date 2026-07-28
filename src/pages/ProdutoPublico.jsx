import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { driveImage } from '../utils/driveUrl';
import { apiCall } from '../utils/apiCall';

export default function ProdutoPublico({ tipo }) {
  const { id } = useParams();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const ref = params.get('ref') || '';
  const { user, role } = useAuth();
  const [produto, setProduto] = useState(null);
  const [aulas, setAulas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [comprouAvulso, setComprouAvulso] = useState(false);
  const [comprando, setComprando] = useState(false);
  const [aguardando, setAguardando] = useState(false);
  const [erroCompra, setErroCompra] = useState('');

  // Persiste código de referência do consultor
  useEffect(() => {
    if (ref) sessionStorage.setItem('tsn_ref_codigo', ref);
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
      const refCod = ref || sessionStorage.getItem('tsn_ref_codigo') || '';
      const nome = user.user_metadata?.nome || user.user_metadata?.full_name || '';
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
      if (link) { window.open(link, '_blank', 'noopener'); setAguardando(true); }
      else throw new Error('Não foi possível gerar o pagamento.');
    } catch (e) {
      setErroCompra(e?.message || 'Erro ao comprar');
    } finally { setComprando(false); }
  }

  useEffect(() => {
    async function load() {
      if (tipo === 'curso') {
        const { data: c } = await supabase.from('cursos_admin').select('*').eq('id', id).single();
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
          .eq('id', id).single();
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

  return (
    <div style={{ minHeight: '100vh', background: '#111111', padding: '0 0 60px' }}>
      {/* Header — paddingTop com env(safe-area-inset-top) (rota fora do MainLayout) p/ a
          marca não ficar sob a barra de status no PWA iOS. */}
      <div style={{ borderBottom: '1px solid #111111', padding: '16px 32px', paddingTop: 'calc(16px + env(safe-area-inset-top, 0px))', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ background: '#0D63DB', borderRadius: 10, padding: 8, fontSize: 18 }}>🏢</div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 14, color: 'white', letterSpacing: 1 }}>BIDPRO BRASIL</div>
          <div style={{ fontSize: 10, color: '#475569', letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 20px', display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 32, alignItems: 'start' }} className="produto-grid">

        {/* Coluna esquerda, apresentação */}
        <div style={{ color: 'white' }}>
          {/* Capa */}
          {produto.capa_url && (
            <img src={driveImage(produto.capa_url)} alt={produto.titulo}
              style={{ width: '100%', borderRadius: 16, marginBottom: 28, objectFit: 'cover', maxHeight: 280 }} />
          )}
          {!produto.capa_url && (
            <div style={{ width: '100%', height: 200, borderRadius: 16, marginBottom: 28, background: `linear-gradient(135deg, ${cor} 0%, ${cor}88 100%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 64 }}>
              {tipo === 'curso' ? produto.emoji || '🎓' : '📖'}
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: 2, marginBottom: 10 }}>
            {tipo === 'curso' ? 'Curso' : 'eBook'} · {isPago ? `R$ ${Number(produto.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Gratuito com assinatura'}
          </div>
          <h1 style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.2, margin: '0 0 14px' }}>{produto.titulo}</h1>
          {produto.subtitulo && <p style={{ color: '#60a5fa', fontSize: 15, fontWeight: 600, margin: '0 0 16px' }}>{produto.subtitulo}</p>}
          {produto.descricao && <p style={{ color: '#94a3b8', fontSize: 14, lineHeight: 1.8, margin: '0 0 28px' }}>{produto.descricao}</p>}

          {/* Conteúdo do curso */}
          {tipo === 'curso' && aulas.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                Conteúdo do curso, {aulas.length} aulas
              </div>
              {Object.entries(modulos).map(([mod, licoes]) => (
                <div key={mod} style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#475569', marginBottom: 6, padding: '6px 10px', background: '#111111', borderRadius: 6 }}>{mod}</div>
                  {licoes.map((l, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', fontSize: 13, color: '#94a3b8' }}>
                      <span style={{ fontSize: 11, color: l.gratis ? '#10b981' : '#475569' }}>{l.gratis ? '▶ Grátis' : '🔒'}</span>
                      <span>{l.titulo}</span>
                      {l.duracao && <span style={{ marginLeft: 'auto', fontSize: 11, color: '#475569' }}>{l.duracao}</span>}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Coluna direita, CTA */}
        <div style={{ position: 'sticky', top: 24 }}>
          <div style={{ background: 'white', borderRadius: 20, padding: '32px 28px' }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: '#111111', marginBottom: 4 }}>
              {isPago ? `R$ ${Number(produto.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : 'Gratuito'}
            </div>
            <div style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
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
                    {isPago ? (
                      /* Compra AVULSA do item (não precisa assinar) */
                      <button onClick={comprar} disabled={comprando || aguardando}
                        style={{ width: '100%', padding: '15px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: (comprando || aguardando) ? 'default' : 'pointer', marginBottom: 10, opacity: (comprando || aguardando) ? 0.7 : 1 }}>
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
