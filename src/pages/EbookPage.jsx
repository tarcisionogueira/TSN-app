import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Sun, Moon, Minus, Plus, Download, BookOpen } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { driveImage, driveId, drivePreview, driveDownload } from '../utils/driveUrl';

export default function EbookPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, role } = useAuth();

  const [ebook, setEbook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reading, setReading] = useState(false);
  const [dark, setDark] = useState(false);
  const [fontSize, setFontSize] = useState(17);
  const [comprouAvulso, setComprouAvulso] = useState(false);
  const [arquivoUrl, setArquivoUrl] = useState(null);

  useEffect(() => {
    if (!id) return;
    // Metadados só — NUNCA arquivo_url (vem por RPC de entitlement abaixo).
    supabase.from('ebooks_admin').select('id, titulo, descricao, capa_url, gratuito, ativo, preco, comissao_pct, assinatura, planos_gratis, criado_em').eq('id', id).single()
      .then(({ data }) => { setEbook(data); setLoading(false); });
  }, [id]);

  // A URL do arquivo vem SÓ da RPC de entitlement server-side (obter_arquivo_ebook):
  // devolve a URL apenas se grátis / plano / compra ativa. Fecha o vazamento de
  // arquivo_url do ebook pago pela leitura pública de ebooks_admin.
  useEffect(() => {
    if (!id || !ebook) return;
    supabase.rpc('obter_arquivo_ebook', { p_id: id }).then(({ data }) => setArquivoUrl(data || null));
  }, [id, ebook, user, comprouAvulso]);

  // Verifica compra avulsa para ebooks pagos
  useEffect(() => {
    if (!user || !id || !ebook || Number(ebook.preco || 0) === 0) return;
    supabase.from('compras_produtos')
      .select('id').eq('user_id', user.id).eq('produto_tipo', 'ebook').eq('produto_id', id).eq('status', 'ativo')
      .then(({ data }) => { if (data?.length > 0) setComprouAvulso(true); });
  }, [user, id, ebook]);

  const temPlano = user && ['top2','assessorado','clube','consultor','analista','advogado','admin'].includes(role);
  const ehGratuito = ebook && Number(ebook.preco || 0) === 0;
  const podeAcessar = user && (temPlano || ehGratuito || comprouAvulso);

  // A URL do arquivo vem da RPC de entitlement (não do registro público).
  const pdfUrl = arquivoUrl;
  // Arquivos do Google Drive vêm como link de COMPARTILHAMENTO (não .pdf) — tratamos como
  // PDF embutível (iframe /preview) para o leitor funcionar; download direto via /uc.
  const isDrive = !!driveId(pdfUrl);
  const isPdf = pdfUrl ? (pdfUrl.toLowerCase().endsWith('.pdf') || isDrive) : false;
  const embedUrl = isDrive ? drivePreview(pdfUrl) : pdfUrl;
  const baixarUrl = isDrive ? driveDownload(pdfUrl) : pdfUrl;

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#111111', color:'#94a3b8' }}>
      Carregando…
    </div>
  );

  if (!ebook) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#111111', color:'#94a3b8' }}>
      eBook não encontrado.
    </div>
  );

  // ── Tela de detalhe (capa + botões) ─────────────────────────────────────────
  if (!reading) {
    return (
      <div style={{ minHeight:'100vh', background:'#f8fafc' }}>
        <div style={{ maxWidth:700, margin:'0 auto', padding:'32px 20px' }}>

          {/* Breadcrumb */}
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:13, color:'#94a3b8', marginBottom:24 }}>
            <span style={{ cursor:'pointer', color:'#0D63DB', fontWeight:600 }} onClick={() => nav('/membros')}>Membros</span>
            <ChevronRight size={13}/>
            <span style={{ cursor:'pointer', color:'#0D63DB', fontWeight:600 }} onClick={() => nav('/membros')}>Ebooks</span>
            <ChevronRight size={13}/>
            <span style={{ color:'#64748b' }}>{ebook.titulo}</span>
          </div>

          {/* Card principal */}
          <div style={{ background:'white', borderRadius:20, boxShadow:'0 4px 24px rgba(0,0,0,0.08)', overflow:'hidden' }}>
            {/* Banner/capa */}
            <div style={{ background:'linear-gradient(135deg,#1e1b4b,#111111)', padding:'40px 24px', display:'flex', flexDirection:'column', alignItems:'center', gap:20 }}>
              {ebook.capa_url ? (
                <img src={driveImage(ebook.capa_url)} alt={ebook.titulo}
                  style={{ maxWidth:200, borderRadius:10, boxShadow:'0 16px 48px rgba(0,0,0,0.4)' }}/>
              ) : (
                <div style={{ width:160, height:220, borderRadius:10, background:'linear-gradient(135deg,#6366f1,#4f46e5)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, boxShadow:'0 16px 48px rgba(0,0,0,0.4)' }}>
                  <div style={{ fontSize:72, color:'white', fontWeight:900, lineHeight:1 }}>
                    {ebook.titulo?.[0]?.toUpperCase() || '📖'}
                  </div>
                  <div style={{ fontSize:11, color:'rgba(255,255,255,0.7)', fontWeight:600, textTransform:'uppercase', textAlign:'center', padding:'0 16px' }}>eBook</div>
                </div>
              )}
              <h1 style={{ fontSize:22, fontWeight:900, color:'white', margin:0, textAlign:'center', lineHeight:1.3 }}>{ebook.titulo}</h1>
            </div>

            {/* Corpo */}
            <div style={{ padding:'32px 36px' }}>
              {ebook.descricao && (
                <p style={{ fontSize:15, color:'#475569', lineHeight:1.8, margin:'0 0 28px' }}>{ebook.descricao}</p>
              )}

              {podeAcessar ? (
                <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
                  {(pdfUrl || ebook.descricao) && (
                    <button onClick={() => setReading(true)}
                      style={{ flex:1, minWidth:140, padding:'13px 24px', background:'#0D63DB', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                      <BookOpen size={18}/>
                      {isPdf ? 'Ler PDF no app' : 'Ler'}
                    </button>
                  )}
                  {pdfUrl && (
                    <a href={baixarUrl} download target="_blank" rel="noreferrer"
                      style={{ flex:1, minWidth:140, padding:'13px 24px', background:'white', color:'#111111', border:'1px solid #e2e8f0', borderRadius:10, fontWeight:700, fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, textDecoration:'none' }}>
                      <Download size={18}/> Baixar
                    </a>
                  )}
                </div>
              ) : (
                <AcessoBloqueado nav={nav} ebook={ebook}/>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Leitor ────────────────────────────────────────────────────────────────
  const bg    = dark ? '#1a1a1a' : '#f5f0e8';
  const paper = dark ? '#242424' : '#fffdf7';
  const texto = dark ? '#e8e0d0' : '#2d2416';
  const sutil = dark ? '#888' : '#9c8c6e';

  return (
    <div style={{ minHeight:'100vh', background: bg, fontFamily:"'Georgia', 'Times New Roman', serif", transition:'background 0.3s' }}>

      {/* Barra superior */}
      <div style={{ position:'sticky', top:0, zIndex:100, background: dark ? '#111' : '#f0e8d0', borderBottom:`1px solid ${dark?'#333':'#d4c49a'}`, padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <button onClick={() => setReading(false)} style={{ background:'none', border:'none', cursor:'pointer', color: sutil, display:'flex', alignItems:'center', gap:6, fontSize:14, fontFamily:'inherit' }}>
          <ChevronLeft size={18}/> Voltar
        </button>

        {/* Breadcrumb */}
        <span style={{ fontSize:12, color: sutil, display:'flex', alignItems:'center', gap:4 }}>
          <span style={{ cursor:'pointer' }} onClick={() => nav('/membros')}>Membros</span>
          <ChevronRight size={12}/>
          <span style={{ cursor:'pointer' }} onClick={() => setReading(false)}>Ebooks</span>
          <ChevronRight size={12}/>
          <span style={{ fontStyle:'italic' }}>{ebook.titulo}</span>
        </span>

        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {!isPdf && (
            <>
              <button onClick={() => setFontSize(f => Math.max(13, f-1))} style={{ background:'none', border:'none', cursor:'pointer', color: sutil }}>
                <Minus size={14}/>
              </button>
              <span style={{ fontSize:12, color: sutil, minWidth:20, textAlign:'center' }}>{fontSize}</span>
              <button onClick={() => setFontSize(f => Math.min(26, f+1))} style={{ background:'none', border:'none', cursor:'pointer', color: sutil }}>
                <Plus size={14}/>
              </button>
            </>
          )}
          <button onClick={() => setDark(d => !d)} style={{ background:'none', border:'none', cursor:'pointer', color: sutil }}>
            {dark ? <Sun size={16}/> : <Moon size={16}/>}
          </button>
          {pdfUrl && (
            <a href={baixarUrl} download target="_blank" rel="noreferrer"
              style={{ color: sutil, display:'flex', alignItems:'center' }}>
              <Download size={16}/>
            </a>
          )}
        </div>
      </div>

      {/* Corpo do leitor */}
      {isPdf ? (
        /* PDF — header compacto + iframe full-width */
        <div>
          <div style={{ background: dark ? '#111' : '#fffdf7', padding:'16px 24px', display:'flex', alignItems:'center', gap:16, borderBottom:`1px solid ${dark?'#333':'#e2e8f0'}` }}>
            {ebook.capa_url ? (
              <img src={driveImage(ebook.capa_url)} alt={ebook.titulo}
                style={{ height:56, borderRadius:6, boxShadow:'0 4px 12px rgba(0,0,0,0.2)', flexShrink:0 }}/>
            ) : (
              <div style={{ width:40, height:56, borderRadius:6, background:'linear-gradient(135deg,#6366f1,#4f46e5)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, color:'white', fontSize:20, fontWeight:900 }}>
                {ebook.titulo?.[0]?.toUpperCase() || '📖'}
              </div>
            )}
            <div style={{ flex:1 }}>
              <h2 style={{ margin:'0 0 4px', fontSize:16, fontWeight:800, color: dark ? '#e8e0d0' : '#111111' }}>{ebook.titulo}</h2>
              {ebook.descricao && <p style={{ margin:0, fontSize:12, color: sutil, lineHeight:1.4 }}>{ebook.descricao.slice(0,120)}{ebook.descricao.length>120?'…':''}</p>}
            </div>
            <a href={baixarUrl} download target="_blank" rel="noreferrer"
              style={{ padding:'9px 18px', background:'#0D63DB', color:'white', border:'none', borderRadius:8, fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6, textDecoration:'none', flexShrink:0 }}>
              <Download size={14}/> Baixar PDF
            </a>
          </div>
          <iframe src={embedUrl} title={ebook.titulo}
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
            style={{ width:'100%', minHeight:'70vh', height:'calc(100vh - 130px)', border:'none', display:'block', background: paper }}/>
        </div>
      ) : pdfUrl ? (
        /* Não é PDF — mostra preview e botão download */
        <div style={{ maxWidth:720, margin:'0 auto', padding:'48px 24px 80px', textAlign:'center' }}>
          {ebook.capa_url && (
            <img src={driveImage(ebook.capa_url)} alt={ebook.titulo}
              style={{ maxHeight:340, maxWidth:240, borderRadius:8, boxShadow:`0 12px 40px rgba(0,0,0,${dark?0.6:0.25})`, display:'block', margin:'0 auto 28px' }}/>
          )}
          <h2 style={{ fontSize:22, fontWeight:800, color: texto, margin:'0 0 16px' }}>{ebook.titulo}</h2>
          {ebook.descricao && <p style={{ fontSize:14, color: sutil, lineHeight:1.8, marginBottom:24 }}>{ebook.descricao}</p>}
          <a href={baixarUrl} download target="_blank" rel="noreferrer"
            style={{ padding:'13px 32px', background:'#0D63DB', color:'white', border:'none', borderRadius:10, fontWeight:700, fontSize:15, cursor:'pointer', display:'inline-flex', alignItems:'center', gap:8, textDecoration:'none' }}>
            <Download size={18}/> Baixar material
          </a>
        </div>
      ) : (
        /* Sem arquivo — exibe texto/descrição */
        <div style={{ maxWidth:720, margin:'0 auto', padding:'48px 24px 80px' }}>
          <div style={{ textAlign:'center', marginBottom:52 }}>
            {ebook.capa_url && (
              <img src={driveImage(ebook.capa_url)} alt={ebook.titulo}
                style={{ maxHeight:340, maxWidth:240, borderRadius:8, boxShadow:`0 12px 40px rgba(0,0,0,${dark?0.6:0.25})`, display:'block', margin:'0 auto 28px' }}/>
            )}
            <h1 style={{ fontSize:28, fontWeight:700, color: texto, margin:'0 0 8px', letterSpacing:'-0.5px', lineHeight:1.3 }}>{ebook.titulo}</h1>
            {ebook.descricao && <p style={{ fontSize:14, color: sutil, fontStyle:'italic', margin:'8px 0 0' }}>{ebook.descricao}</p>}
            <div style={{ margin:'24px auto', width:60, height:2, background: dark?'#444':'#c4b07a' }}/>
          </div>
          <div style={{ background: paper, borderRadius:8, padding:'48px', boxShadow:`0 4px 24px rgba(0,0,0,${dark?0.4:0.08})` }}>
            <div style={{ fontSize: fontSize, color: texto, lineHeight:1.85, whiteSpace:'pre-wrap', fontFamily:"'Georgia', serif" }}>
              {ebook.descricao || 'Conteúdo em breve.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AcessoBloqueado({ nav, ebook }) {
  const gratis = !ebook.preco || Number(ebook.preco) === 0;
  return (
    <div style={{ textAlign:'center', padding:'20px' }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🔒</div>
      <h3 style={{ color:'#111111', marginBottom:8 }}>Acesso restrito</h3>
      <p style={{ color:'#64748b', marginBottom:24, maxWidth:360, margin:'0 auto 24px' }}>
        {gratis ? 'Faça login para acessar este material.' : 'Este eBook requer um plano pago.'}
      </p>
      <button onClick={() => nav(gratis ? '/login' : '/planos')}
        style={{ padding:'11px 28px', background:'#0D63DB', color:'white', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer' }}>
        {gratis ? 'Fazer login' : 'Ver planos'}
      </button>
    </div>
  );
}
