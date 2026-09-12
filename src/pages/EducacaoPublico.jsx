import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { GraduationCap, BookOpen, Gift } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { driveImage } from '../utils/driveUrl';

const AZUL = '#0D63DB';

// Placeholder de capa (mesmo espírito de EbookCover em Membros.jsx) para quem ainda não
// tem capa_url ou cuja imagem falhar — nunca deixa caixa branca.
function Capa({ url, titulo, emoji }) {
  const [erro, setErro] = useState(false);
  const colors = [['#6366f1', '#4f46e5'], ['#0ea5e9', '#0284c7'], ['#10b981', '#059669'], ['#f59e0b', '#d97706'], ['#ef4444', '#dc2626'], ['#8b5cf6', '#7c3aed']];
  const [c1, c2] = colors[titulo ? titulo.charCodeAt(0) % colors.length : 0];
  if (!url || erro) {
    return (
      <div style={{ width: '100%', aspectRatio: '3/4', background: `linear-gradient(135deg,${c1},${c2})`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>
        {emoji || '📘'}
      </div>
    );
  }
  // aspectRatio vai no CONTAINER, não na <img> (Safari usa a proporção do arquivo, não a
  // CSS, quando aplicada direto na imagem — padrão banido por verificar:padroes).
  return (
    <div style={{ width: '100%', aspectRatio: '3/4', overflow: 'hidden', background: '#f1f5f9' }}>
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
// Aberto de imóveis, só que para eBooks/cursos. Fica no menu público, ao lado de Planos.
// A compra em si continua na tela de sempre (/#/p/ebook|curso/:id, ProdutoPublico.jsx),
// que já trata visitante deslogado e cliente logado — esta tela é só a vitrine de entrada.
export default function EducacaoPublico() {
  const nav = useNavigate();
  const [itens, setItens] = useState(null); // null = carregando
  const [erro, setErro] = useState('');

  useEffect(() => {
    let vivo = true;
    (async () => {
      const [{ data: cursos, error: eC }, { data: ebooks, error: eE }] = await Promise.all([
        supabase.from('cursos_admin')
          .select('id,titulo,subtitulo,descricao,capa_url,preco,oferta_preco,oferta_abre_em,oferta_fecha_em,concede_plano,concede_meses,requer_cartao_bonus,emoji')
          .eq('ativo', true).order('destaque', { ascending: false }).order('titulo'),
        supabase.from('ebooks_admin')
          .select('id,titulo,descricao,capa_url,preco,oferta_preco,oferta_abre_em,oferta_fecha_em,concede_plano,concede_meses,requer_cartao_bonus')
          .eq('ativo', true).order('destaque', { ascending: false }).order('titulo'),
      ]);
      if (!vivo) return;
      // Falha de leitura não pode virar "não há nada" — a tela some por engano é pior
      // do que uma mensagem de "não consegui carregar agora".
      if (eC || eE) { setErro('Não foi possível carregar o catálogo agora. Atualize a página.'); setItens([]); return; }
      const lista = [
        ...(cursos || []).map((c) => ({ ...c, tipo: 'curso' })),
        ...(ebooks || []).map((e) => ({ ...e, tipo: 'ebook' })),
      ];
      setItens(lista);
    })();
    return () => { vivo = false; };
  }, []);

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 20px 60px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#eff6ff', color: AZUL, fontWeight: 700, fontSize: 13, padding: '6px 14px', borderRadius: 20, marginBottom: 14 }}>
          <GraduationCap size={16} /> Educação BidPro
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#111', margin: '0 0 8px' }}>Aprenda a arrematar com segurança</h1>
        <p style={{ fontSize: 14.5, color: '#64748b', maxWidth: 560, margin: '0 auto' }}>
          eBooks e cursos para quem quer entender leilões de imóveis antes de investir. Compre
          livremente — o acesso é imediato e não depende de assinatura.
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
                style={{ cursor: 'pointer', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <Capa url={it.capa_url} titulo={it.titulo} emoji={it.tipo === 'curso' ? '🎓' : '📘'} />
                <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', flex: 1, gap: 6 }}>
                  <div style={{ fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {it.tipo === 'curso' ? 'Curso' : 'eBook'}
                  </div>
                  <div style={{ fontSize: 14.5, fontWeight: 700, color: '#111', lineHeight: 1.3 }}>{it.titulo}</div>
                  {temBonus && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '4px 8px', width: 'fit-content' }}>
                      <Gift size={11} /> +{it.concede_meses || 1} {(it.concede_meses || 1) > 1 ? 'meses' : 'mês'} Investidor Pro
                    </div>
                  )}
                  <div style={{ marginTop: 'auto', paddingTop: 6, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                    {promo != null ? (
                      <>
                        <span style={{ fontSize: 12, color: '#94a3b8', textDecoration: 'line-through' }}>{brl(cheio)}</span>
                        <span style={{ fontSize: 17, fontWeight: 900, color: '#dc2626' }}>{brl(promo)}</span>
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

      <div style={{ marginTop: 40, textAlign: 'center', fontSize: 12.5, color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
        <BookOpen size={14} /> Já é assinante? Acesse pela <a href="#/membros" style={{ color: AZUL, fontWeight: 700 }}>Área de Membros</a>.
      </div>
    </div>
  );
}
