import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, Sun, Moon, Minus, Plus, Download } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function EbookPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { user, role } = useAuth();

  const [ebook, setEbook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dark, setDark] = useState(false);
  const [fontSize, setFontSize] = useState(17);

  useEffect(() => {
    if (!id) return;
    supabase.from('ebooks_admin').select('*').eq('id', id).single()
      .then(({ data }) => { setEbook(data); setLoading(false); });
  }, [id]);

  const podeAcessar = user && (
    ['top1','top2','assessorado','clube','consultor','analista','advogado','admin'].includes(role)
    || (ebook && (!ebook.preco || Number(ebook.preco) === 0))
  );

  if (loading) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f172a', color:'#94a3b8' }}>
      Carregando…
    </div>
  );

  if (!ebook) return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f172a', color:'#94a3b8' }}>
      eBook não encontrado.
    </div>
  );

  const bg     = dark ? '#1a1a1a' : '#f5f0e8';
  const paper  = dark ? '#242424' : '#fffdf7';
  const texto  = dark ? '#e8e0d0' : '#2d2416';
  const sutil  = dark ? '#888' : '#9c8c6e';

  return (
    <div style={{ minHeight:'100vh', background: bg, fontFamily:"'Georgia', 'Times New Roman', serif", transition:'background 0.3s' }}>

      {/* Barra superior — Kindle style */}
      <div style={{ position:'sticky', top:0, zIndex:100, background: dark ? '#111' : '#f0e8d0', borderBottom:`1px solid ${dark?'#333':'#d4c49a'}`, padding:'10px 20px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <button onClick={() => nav(-1)} style={{ background:'none', border:'none', cursor:'pointer', color: sutil, display:'flex', alignItems:'center', gap:6, fontSize:14, fontFamily:'inherit' }}>
          <ChevronLeft size={18} /> Voltar
        </button>

        <span style={{ fontSize:13, color: sutil, fontStyle:'italic' }}>{ebook.titulo}</span>

        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          {/* Tamanho da fonte */}
          <button onClick={() => setFontSize(f => Math.max(13, f-1))} style={{ background:'none', border:'none', cursor:'pointer', color: sutil }}>
            <Minus size={14} />
          </button>
          <span style={{ fontSize:12, color: sutil, minWidth:20, textAlign:'center' }}>{fontSize}</span>
          <button onClick={() => setFontSize(f => Math.min(26, f+1))} style={{ background:'none', border:'none', cursor:'pointer', color: sutil }}>
            <Plus size={14} />
          </button>

          {/* Modo claro/escuro */}
          <button onClick={() => setDark(d => !d)} style={{ background:'none', border:'none', cursor:'pointer', color: sutil }}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Download (se tiver arquivo) */}
          {ebook.arquivo_url && (
            <a href={ebook.arquivo_url} download target="_blank" rel="noreferrer"
              style={{ color: sutil, display:'flex', alignItems:'center' }}>
              <Download size={16} />
            </a>
          )}
        </div>
      </div>

      {/* Corpo — colunas como livro */}
      <div style={{ maxWidth:720, margin:'0 auto', padding:'48px 24px 80px' }}>

        {/* Capa do livro */}
        <div style={{ textAlign:'center', marginBottom:52 }}>
          {ebook.capa_url && (
            <img src={ebook.capa_url} alt={ebook.titulo}
              style={{ maxHeight:340, maxWidth:240, borderRadius:8, boxShadow:`0 12px 40px rgba(0,0,0,${dark?0.6:0.25})`, marginBottom:28, display:'block', margin:'0 auto 28px' }} />
          )}
          <h1 style={{ fontSize:28, fontWeight:700, color: texto, margin:'0 0 8px', letterSpacing:'-0.5px', lineHeight:1.3 }}>{ebook.titulo}</h1>
          {ebook.descricao && <p style={{ fontSize:14, color: sutil, fontStyle:'italic', margin:'8px 0 0' }}>{ebook.descricao}</p>}
          <div style={{ margin:'24px auto', width:60, height:2, background: dark?'#444':'#c4b07a' }} />
        </div>

        {/* Conteúdo: PDF embed ou texto */}
        {ebook.arquivo_url && ebook.arquivo_url.toLowerCase().endsWith('.pdf') ? (
          podeAcessar ? (
            <iframe
              src={ebook.arquivo_url}
              title={ebook.titulo}
              style={{ width:'100%', height:'75vh', border:'none', borderRadius:4, background: paper }}
            />
          ) : (
            <AcessoBloqueado nav={nav} ebook={ebook} />
          )
        ) : ebook.arquivo_url ? (
          podeAcessar ? (
            <div style={{ background: paper, borderRadius:8, padding:'40px 48px', boxShadow:`0 4px 24px rgba(0,0,0,${dark?0.4:0.08})` }}>
              <p style={{ fontSize: fontSize, color: texto, lineHeight:1.85, margin:0 }}>
                Este material está disponível para download.{' '}
                <a href={ebook.arquivo_url} target="_blank" rel="noreferrer" style={{ color:'#2563eb' }}>Clique aqui para acessar</a>.
              </p>
            </div>
          ) : (
            <AcessoBloqueado nav={nav} ebook={ebook} />
          )
        ) : (
          // Conteúdo texto (conteudo ou descricao longa)
          podeAcessar ? (
            <div style={{ background: paper, borderRadius:8, padding:'48px', boxShadow:`0 4px 24px rgba(0,0,0,${dark?0.4:0.08})` }}>
              <div style={{ fontSize: fontSize, color: texto, lineHeight:1.85, whiteSpace:'pre-wrap', fontFamily:"'Georgia', serif" }}>
                {ebook.descricao || 'Conteúdo em breve.'}
              </div>
            </div>
          ) : (
            <AcessoBloqueado nav={nav} ebook={ebook} />
          )
        )}
      </div>
    </div>
  );
}

function AcessoBloqueado({ nav, ebook }) {
  const gratis = !ebook.preco || Number(ebook.preco) === 0;
  return (
    <div style={{ textAlign:'center', padding:'60px 20px' }}>
      <div style={{ fontSize:48, marginBottom:16 }}>🔒</div>
      <h3 style={{ color:'#0f172a', marginBottom:8 }}>Acesso restrito</h3>
      <p style={{ color:'#64748b', marginBottom:24, maxWidth:360, margin:'0 auto 24px' }}>
        {gratis ? 'Faça login para acessar este material.' : `Este eBook requer um plano pago (R$ ${Number(ebook.preco).toFixed(2)}).`}
      </p>
      <button onClick={() => nav('/login')} style={{ padding:'11px 28px', background:'#2563eb', color:'white', border:'none', borderRadius:10, fontWeight:700, cursor:'pointer' }}>
        {gratis ? 'Fazer login' : 'Ver planos'}
      </button>
    </div>
  );
}
