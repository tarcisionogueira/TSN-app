import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock, MapPin, Loader2, Home } from 'lucide-react';
import { useIsMobile } from '../utils/useIsMobile';
import { supabase } from '../utils/supabase';
import { fotoCandidatos } from '../utils/foto';
import { fmtBRL } from '../utils/format';

/**
 * Porta de acesso do imóvel para VISITANTE (não logado). É o que abre quando alguém
 * recebe um link compartilhado (/#/imovel/:id) sem ter conta: mostra o imóvel com o
 * fundo EMBAÇADO e um cartão pedindo para criar conta ou entrar. Depois de autenticar,
 * o Login usa ?next=/imovel/:id e leva a pessoa direto de volta a ESTE imóvel.
 * A leitura pública de imoveis_leilao (RLS "Leitura pública") permite montar o teaser
 * sem sessão. Nenhum dado sensível (documento/análise) é exposto aqui.
 */
const TIPO_LABEL = { casa: 'Casa', apartamento: 'Apartamento', terreno: 'Terreno/Lote', comercial: 'Comercial', rural: 'Rural', galpao: 'Galpão', sala: 'Sala Comercial', vaga: 'Vaga de Garagem', imovel: 'Imóvel' };

export default function ImovelGate() {
  const nav = useNavigate();
  const { id } = useParams();
  const [im, setIm] = useState(null);      // null = carregando; {} = não encontrado
  const [imgIdx, setImgIdx] = useState(0);
  const [fotoAtiva, setFotoAtiva] = useState(0);
  const isMobile = useIsMobile();
  const next = `/imovel/${id}`;

  useEffect(() => {
    let vivo = true;
    // FICHA DE FATOS, não só o título (14/08, pedido do dono a partir do botão Compartilhar:
    // "abri o link e aparecem dados bem resumidos"). Os campos acrescentados — área, bairro,
    // tipo, data da praça, modalidade, 2ª praça, leiloeiro e descrição — são EXATAMENTE os que
    // a página pública `/leilao/:id/:slug` (api/publico.js) já serve ao Google e a qualquer
    // visitante desde 02/08. Ou seja: nenhuma exposição nova, custo marginal ZERO (uma única
    // leitura ao banco, sem IA e sem fornecedor pago) — só parou de esconder de quem recebe o
    // link o que já está aberto na página indexada do mesmo lote.
    // A DECISÃO DE 08/08 SEGUE DE PÉ: endereço exato, mapa, edital/matrícula e as análises
    // continuam atrás do cadastro. O público vê o FATO; a conta abre o que é NOSSO.
    supabase.from('imoveis_leilao')
      // 05/10 (dono): "apresentar mais informações" — galeria, ocupação, condomínio, pagamento e
      // data da 2ª praça entram; continuam FORA sem login: link do leiloeiro, anexos/documentos,
      // endereço exato/mapa e análise. Após login, a página completa (ImovelDetalhe) abre tudo.
      .select('id,titulo,cidade,estado,bairro,tipo,area_m2,valor_minimo,valor_minimo_2,valor_avaliacao,desconto_percentual,data_leilao,data_leilao_2,modalidade,leiloeiro,descricao,link_foto,fotos,fonte,fonte_id,ocupacao,forma_pagamento,nomecondominio')
      .eq('id', id).maybeSingle()
      // `{ data }` SEM `error` funde "não achei o imóvel" com "não consegui ler" — o
      // postgrest-js não lança em não-2xx. Numa rota PÚBLICA (as 33 mil páginas indexadas)
      // isso vira "imóvel não encontrado" para um lote que existe, e o visitante que veio do
      // Google conclui que o anúncio saiu do ar. `{} = não encontrado` continua valendo; a
      // falha de leitura agora tem o seu próprio estado. (13/08)
      .then(({ data, error }) => { if (vivo) setIm(error ? { _falhou: true } : (data || {})); })
      .catch(() => { if (vivo) setIm({ _falhou: true }); });
    return () => { vivo = false; };
  }, [id]);

  const irEntrar = () => nav(`/login?next=${encodeURIComponent(next)}`);
  const irCadastro = () => nav(`/login?modo=cadastro&next=${encodeURIComponent(next)}`);

  if (im === null) {
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 size={26} color="#0D63DB" style={{ animation: 'spin 1s linear infinite' }} />
      </div>
    );
  }

  const cands = im.id ? fotoCandidatos({ foto: im.link_foto, fonte: im.fonte, fonteId: im.fonte_id, largura: 800 }) : [];
  const foto = cands[imgIdx] || null;
  const desc = Number(im.desconto_percentual) || 0;
  const local = [im.cidade, im.estado].filter(Boolean).join('/');
  // Data da praça vem do scraper em formatos variados; só formata o que for ISO reconhecível,
  // e no que não for mostra o texto original — inventar formato é pior que repetir a fonte.
  const dataBR = (s) => {
    const t = String(s || '').trim();
    if (!t) return null;
    const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : t.slice(0, 40);
  };
  const MODALIDADE_LABEL = { judicial: 'Leilão judicial', extrajudicial: 'Leilão extrajudicial', licitacao_aberta: 'Licitação aberta', venda_direta: 'Venda direta', venda_online: 'Venda online', primeiro_leilao: '1ª praça', segundo_leilao: '2ª praça', praca_unica: 'Praça única' };
  const fichaFatos = [
    ['Tipo', TIPO_LABEL[String(im.tipo || '').toLowerCase()] || null],
    ['Área', Number(im.area_m2) > 0 ? `${Math.round(im.area_m2)} m²` : null],
    ['Bairro', im.bairro || null],
    ['Avaliação', Number(im.valor_avaliacao) > 0 ? fmtBRL(im.valor_avaliacao) : null],
    ['2ª praça', Number(im.valor_minimo_2) > 0 ? fmtBRL(im.valor_minimo_2) : null],
    ['Data do leilão', dataBR(im.data_leilao)],
    ['Data da 2ª praça', im.data_leilao_2 ? dataBR(im.data_leilao_2) : null],
    ['Ocupação', im.ocupacao ? String(im.ocupacao).replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : null],
    ['Condomínio', im.nomecondominio || null],
    ['Pagamento', im.forma_pagamento ? String(im.forma_pagamento).replace(/_/g, ' ').slice(0, 80) : null],
    ['Modalidade', MODALIDADE_LABEL[String(im.modalidade || '').toLowerCase()] || im.modalidade || null],
    ['Leiloeiro', im.leiloeiro || null],
  ].filter(([, v]) => v);

  // Galeria: `fotos` (quando a fonte traz várias) ou a foto principal com seus espelhos.
  const galeria = Array.isArray(im.fotos) ? im.fotos.filter((f) => typeof f === 'string' && /^https?:\/\//.test(f)) : [];
  const fotoPrincipal = galeria.length > 1 ? galeria[fotoAtiva] : foto;
  // Descrição sem links: sem login não há caminho para o leiloeiro (dono, 05/10).
  const descricao = im.descricao ? String(im.descricao).replace(/\b(?:https?:\/\/|www\.)\S+/gi, '').trim() : '';

  if (!im.id) {
    return (
      <div style={{ minHeight: '70vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, textAlign: 'center', color: '#64748b' }}>
        <div>
          <p style={{ margin: '0 0 14px' }}>{im._falhou ? 'Não foi possível carregar este imóvel agora. Tente de novo em instantes.' : 'Imóvel não encontrado.'}</p>
          <button onClick={irEntrar} style={{ background: '#0D63DB', color: '#fff', border: 'none', borderRadius: 11, padding: '11px 22px', fontWeight: 800, cursor: 'pointer' }}>Entrar</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: isMobile ? 12 : 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'minmax(0, 1fr)' : 'minmax(0, 1.1fr) minmax(0, 0.9fr)', gap: 20 }}>
        {/* Galeria — sem embaçar (05/10): foto é o que o lote já mostra na página pública. */}
        <div>
          <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 14, overflow: 'hidden', background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {fotoPrincipal
              ? <img src={fotoPrincipal} alt={im.titulo || ''} onError={() => (galeria.length > 1 ? null : setImgIdx((i) => i + 1))} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <Home size={48} color="#cbd5e1" />}
          </div>
          {galeria.length > 1 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto' }}>
              {galeria.map((f, i) => (
                <button key={i} onClick={() => setFotoAtiva(i)}
                  style={{ flexShrink: 0, width: 56, height: 56, borderRadius: 8, overflow: 'hidden', border: i === fotoAtiva ? '2px solid #0D63DB' : '1px solid #e2e8f0', padding: 0, cursor: 'pointer', background: 'none' }}>
                  <img src={f} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: isMobile ? 20 : 22, fontWeight: 900, color: '#111111', lineHeight: 1.3 }}>
            {im.titulo || TIPO_LABEL[im.tipo] || 'Imóvel em leilão'}
          </h1>
          {local && (
            <div style={{ fontSize: 13, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
              <MapPin size={13} /> {[im.bairro, local].filter(Boolean).join(' · ')}
            </div>
          )}
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 14 }}>
            <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Lance mínimo</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontSize: 24, fontWeight: 900, color: '#0D63DB' }}>{im.valor_minimo ? fmtBRL(im.valor_minimo) : 'Consultar'}</span>
              {desc > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: 20 }}>-{Math.round(desc)}%</span>}
            </div>
          </div>

          {/* Ficha de fatos — cada linha só aparece quando há dado (nada de "—" decorativo). */}
          {fichaFatos.length > 0 && (
            <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: '10px 14px' }}>
              {fichaFatos.map(([rot, val]) => (
                <div key={rot} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, padding: '4px 0' }}>
                  <span style={{ color: '#64748b' }}>{rot}</span>
                  <strong style={{ color: '#0f172a', textAlign: 'right' }}>{val}</strong>
                </div>
              ))}
            </div>
          )}

          {/* O que a conta abre: aqui ficam leiloeiro, documentos e análise (dono, 05/10). */}
          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 14, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: '#1e3a8a', fontSize: 14, marginBottom: 6 }}>
              <Lock size={16} /> Entre para ver o imóvel completo
            </div>
            <div style={{ fontSize: 12.5, color: '#334155', lineHeight: 1.5, marginBottom: 12 }}>
              Com sua conta <strong>gratuita</strong>: endereço e mapa, documentos (edital e matrícula),
              acesso à página do leiloeiro e a análise de viabilidade do investimento.
            </div>
            <button onClick={irCadastro}
              style={{ width: '100%', background: '#0D63DB', color: '#fff', border: 'none', borderRadius: 11, padding: '12px 0', fontSize: 14, fontWeight: 800, cursor: 'pointer', marginBottom: 8 }}>
              Criar conta grátis
            </button>
            <button onClick={irEntrar}
              style={{ width: '100%', background: '#fff', color: '#0D63DB', border: '1.5px solid #bfdbfe', borderRadius: 11, padding: '11px 0', fontSize: 13.5, fontWeight: 700, cursor: 'pointer' }}>
              Já tenho conta — Entrar
            </button>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, textAlign: 'center' }}>Você voltará para este imóvel assim que entrar.</div>
          </div>
        </div>
      </div>

      {descricao && (
        <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6 }}>Descrição</div>
          <div style={{ fontSize: 13.5, color: '#334155', lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{descricao}</div>
        </div>
      )}
    </div>
  );
}
