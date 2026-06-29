import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

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
        const { data: e } = await supabase.from('ebooks_admin').select('*').eq('id', id).single();
        setProduto(e);
      }
      setLoading(false);
    }
    load();
  }, [id, tipo]);

  if (loading) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Carregando…</div>;
  if (!produto) return <div style={{ textAlign: 'center', padding: 80, color: '#94a3b8' }}>Produto não encontrado.</div>;

  const temPlano = user && ['top1','top2','assessorado','clube','analista','advogado','admin'].includes(role);
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
      {/* Header */}
      <div style={{ borderBottom: '1px solid #111111', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ background: '#0D63DB', borderRadius: 10, padding: 8, fontSize: 18 }}>🏢</div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 14, color: 'white', letterSpacing: 1 }}>TSN ATIVOS</div>
          <div style={{ fontSize: 10, color: '#475569', letterSpacing: 2, textTransform: 'uppercase' }}>Leilão & Investimentos</div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 20px', display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: 32, alignItems: 'start' }} className="produto-grid">

        {/* Coluna esquerda — apresentação */}
        <div style={{ color: 'white' }}>
          {/* Capa */}
          {produto.capa_url && (
            <img src={produto.capa_url} alt={produto.titulo}
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
                Conteúdo do curso — {aulas.length} aulas
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

        {/* Coluna direita — CTA */}
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
                <button onClick={() => nav(`/login?modo=cadastro&produto=${tipo}:${id}${isPago ? '' : `&plano=top1`}${ref ? `&ref=${ref}` : ''}`)}
                  style={{ width: '100%', padding: '15px', background: cor, color: 'white', border: 'none', borderRadius: 12, fontWeight: 800, fontSize: 15, cursor: 'pointer', marginBottom: 10 }}>
                  {isPago ? 'Comprar agora →' : 'Criar conta e acessar →'}
                </button>
                <button onClick={() => nav(`/login?produto=${tipo}:${id}${isPago ? '' : `&plano=top1`}${ref ? `&ref=${ref}` : ''}`)}
                  style={{ width: '100%', padding: '12px', background: 'white', color: '#374151', border: '1px solid #e2e8f0', borderRadius: 12, fontWeight: 600, fontSize: 14, cursor: 'pointer', marginBottom: 16 }}>
                  Já tenho conta — Entrar
                </button>
                {!isPago && (
                  <div style={{ textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                    Incluído no plano <strong>Investidor Pro</strong> — R$ 49,90/mês
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
