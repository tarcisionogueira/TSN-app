import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, BookOpen, Gift, Sparkles } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { driveImage } from '../utils/driveUrl';
import { AZUL, NAVY, LATAO, VERDE, corSuave } from '../utils/marca';

// Placeholder de capa (mesmo espírito de EbookCover em Membros.jsx) para quem ainda não
// tem capa_url ou cuja imagem falhar — nunca deixa caixa branca. Tons dentro da PALETA DA
// MARCA (marca.js) — antes eram cores arco-íris genéricas, sem relação com a identidade.
function Capa({ url, titulo, emoji }) {
  const [erro, setErro] = useState(false);
  const tons = [[NAVY, AZUL], [AZUL, '#083A80'], ['#0a1f3d', AZUL]];
  const [c1, c2] = tons[titulo ? titulo.charCodeAt(0) % tons.length : 0];
  if (!url || erro) {
    return (
      <div style={{ width: '100%', aspectRatio: '2/3', background: `linear-gradient(135deg,${c1},${c2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>
        {emoji || '📘'}
      </div>
    );
  }
  // aspectRatio vai no CONTAINER, não na <img> (Safari usa a proporção do arquivo, não a
  // CSS, quando aplicada direto na imagem — padrão banido por verificar:padroes).
  // 2/3 (não 3/4): é a proporção REAL das capas de ebook/curso usada em toda a plataforma
  // (Membros.jsx, EbookCover). Com 3/4 (mais baixa) o object-fit:cover cortava topo/base da
  // imagem 2/3 para caber na caixa — achado do dono, 12/09 (capas de ebook cortadas na vitrine).
  return (
    <div style={{ width: '100%', aspectRatio: '2/3', overflow: 'hidden', background: '#f1f5f9' }}>
      <img src={driveImage(url)} alt={titulo}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        onError={() => setErro(true)}
        onLoad={(e) => { if (!e.currentTarget.naturalWidth) setErro(true); }} />
    </div>
  );
}

// Preço a exibir: dentro da janela de oferta mostra o promocional riscado sobre o cheio;
// fora da janela, só o cheio. A cobrança REAL é sempre conferida no servidor
// (produto_preco_vigente) na hora da compra — isto aqui é só a vitrine.
function precoVigente(p) {
  const preco = Number(p.preco) || 0;
  const oferta = p.oferta_preco != null ? Number(p.oferta_preco) : null;
  if (oferta == null) return { cheio: preco, promo: null };
  const agora = Date.now();
  const abre = p.oferta_abre_em ? new Date(p.oferta_abre_em).getTime() : null;
  const fecha = p.oferta_fecha_em ? new Date(p.oferta_fecha_em).getTime() : null;
  const emJanela = fecha && agora <= fecha && (!abre || agora >= abre);
  return emJanela ? { cheio: preco, promo: oferta } : { cheio: preco, promo: null };
}

const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Área de Educação ABERTA (sem login) — pedido do dono (12/09): mesmo espírito do Acervo
// Aberto de imóveis, só que para eBooks/cursos PAGOS (o curso de boas-vindas, gratuito, é
// onboarding do cliente já assinante — não é vitrine de venda, por isso fica de fora).
// A compra em si continua na tela de sempre (/#/p/ebook|curso/:id, ProdutoPublico.jsx),
// que já trata visitante deslogado e cliente logado — esta tela é só a vitrine de entrada.
// Paleta 100% de src/utils/marca.js (pedido do dono, 12/09: "de acordo com as cores da marca").
export default function EducacaoPublico() {
  const nav = useNavigate();
  const [itens, setItens] = useState(null); // null = carregando
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: cursos, error: eC }, { data: ebooks, error: eE }] = await Promise.all([
        supabase.from('cursos_admin')
          .select('id,titulo,subtitulo,descricao,capa_url,preco,gratuito,oferta_preco,oferta_abre_em,oferta_fecha_em,concede_plano,concede_meses,requer_cartao_bonus,emoji')
          .eq('ativo', true).order('destaque', { ascending: false }).order('titulo'),
        supabase.from('ebooks_admin')
          .select('id,titulo,descricao,capa_url,preco,gratuito,oferta_preco,oferta_abre_em,oferta_fecha_em,concede_plano,concede_meses,requer_cartao_bonus')
          .eq('ativo', true).order('destaque', { ascending: false }).order('titulo'),
      ]);
      if (!vivo) return;
      // Falha de leitura não pode virar "não há nada" — a tela some por engano é pior
      // do que uma mensagem de "não consegui carregar agora".
      if (eC || eE) { setErro('Não foi possível carregar o catálogo agora. Atualize a página.'); setItens([]); return; }
      // SÓ PRODUTOS PAGOS (pedido do dono, 12/09): "Comece aqui" e afins são onboarding
      // gratuito do cliente já dentro da plataforma, não fazem parte da vitrine de venda.
      const paisagem = (p) => !p.gratuito && Number(p.preco) > 0;
      const lista = [
        ...(cursos || []).filter(paisagem).map((c) => ({ ...c, tipo: 'curso' })),
        ...(ebooks || []).filter(paisagem).map((e) => ({ ...e, tipo: 'ebook' })),
      ];
      setItens(lista);
    })();
    return () => { vivo = false; };
  }, []);

  return (
    <div>
      {/* Hero navy, mesmo tratamento da Landing — antes esta seção era fundo claro genérico,
          sem relação com a identidade visual do resto do site. */}
      <div style={{ background: 'linear-gradient(135deg, #080f1a 0%, #0a1f3d 60%, #0d2a50 100%)', padding: '52px 20px 44px', textAlign: 'center' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(255,255,255,0.08)', border: `1px solid ${LATAO}55`, color: LATAO, fontWeight: 700, fontSize: 13, padding: '6px 14px', borderRadius: 20, marginBottom: 16 }}>
          <GraduationCap size={16} /> Educação BidPro
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 900, color: '#fff', margin: '0 0 10px', maxWidth: 620, marginLeft: 'auto', marginRight: 'auto' }}>
          Aprenda a arrematar com segurança
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.55, color: '#a8b8d0', maxWidth: 540, margin: '0 auto' }}>
          eBooks e cursos para quem quer entender leilões de imóveis antes de investir. Compre
          livremente: o acesso é imediato e não depende de assinatura.
        </p>
      </div>

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px 60px' }}>
        {/* Vitrine da campanha mensal — pedido do dono (13/09): todo mês há uma campanha de
            conscientização sobre o mercado de leilões, com algum produto sempre em promoção
            para quem quer aprender e começar a investir. Isto é a "descrição atrativa" que
            comunica o RITMO da vitrine (sempre tem algo novo em oferta), não uma promoção
            específica — a oferta em si já aparece riscada no card do produto (precoVigente). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: corSuave(LATAO, '14'), border: `1px solid ${corSuave(LATAO, '45')}`, borderRadius: 14, padding: '16px 20px', marginBottom: 28 }}>
          <div style={{ flexShrink: 0, width: 38, height: 38, borderRadius: 10, background: corSuave(LATAO, '28'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sparkles size={19} color={LATAO} />
          </div>
          <p style={{ margin: 0, fontSize: 15, color: '#374151', lineHeight: 1.6 }}>
            <strong style={{ color: '#111' }}>Todo mês tem campanha nova por aqui.</strong> Lançamos
            uma campanha de conscientização sobre o mercado de leilões e colocamos sempre algum
            eBook ou curso em promoção, para quem está disposto a aprender e dar o primeiro passo
            para investir com segurança.
          </p>
        </div>

        {itens === null && <p style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Carregando...</p>}
        {erro && <p style={{ textAlign: 'center', color: '#dc2626', padding: 20 }}>{erro}</p>}
        {itens && itens.length === 0 && !erro && (
          <p style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>Nenhum material disponível no momento.</p>
        )}

        {itens && itens.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 18 }}>
            {itens.map((it) => {
              const { cheio, promo } = precoVigente(it);
              const temBonus = it.requer_cartao_bonus && it.concede_plano === 'top2';
              return (
                <div key={`${it.tipo}-${it.id}`}
                  onClick={() => nav(`/p/${it.tipo}/${it.id}`)}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = `0 8px 24px ${corSuave(AZUL, '30')}`; e.currentTarget.style.borderColor = AZUL; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
                  style={{ cursor: 'pointer', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', transition: 'box-shadow 0.15s, border-color 0.15s' }}>
                  <Capa url={it.capa_url} titulo={it.titulo} emoji={it.tipo === 'curso' ? '🎓' : '📘'} />
                  <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', flex: 1, gap: 6 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, color: AZUL, textTransform: 'uppercase', letterSpacing: 1 }}>
                      {it.tipo === 'curso' ? 'Curso' : 'eBook'}
                    </div>
                    <div style={{ fontSize: 15.5, fontWeight: 700, color: '#111', lineHeight: 1.35 }}>{it.titulo}</div>
                    {temBonus && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#7a5a13', background: corSuave(LATAO, '1f'), border: `1px solid ${corSuave(LATAO, '55')}`, borderRadius: 8, padding: '4px 8px', width: 'fit-content' }}>
                        <Gift size={11} /> +{it.concede_meses || 1} {(it.concede_meses || 1) > 1 ? 'meses' : 'mês'} Investidor Pro
                      </div>
                    )}
                    <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      {promo != null ? (
                        <>
                          <span style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'line-through' }}>{brl(cheio)}</span>
                          <span style={{ fontSize: 17, fontWeight: 900, color: VERDE }}>{brl(promo)}</span>
                        </>
                      ) : (
                        <span style={{ fontSize: 17, fontWeight: 900, color: '#111' }}>{brl(cheio)}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 40, textAlign: 'center', fontSize: 13.5, color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <BookOpen size={14} /> Já é assinante? Acesse pela <a href="#/membros" style={{ color: AZUL, fontWeight: 700 }}>Área de Membros</a>.
        </div>
      </div>
    </div>
  );
}
