import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Lock, MapPin, Loader2 } from 'lucide-react';
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
  const next = `/imovel/${id}`;

  useEffect(() => {
    let vivo = true;
    supabase.from('imoveis_leilao')
      .select('id,titulo,cidade,estado,tipo,valor_minimo,valor_avaliacao,desconto_percentual,link_foto,fonte,fonte_id')
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

  const cands = im.id ? fotoCandidatos({ foto: im.link_foto, fonte: im.fonte, fonteId: im.fonte_id }) : [];
  const foto = cands[imgIdx] || null;
  const desc = Number(im.desconto_percentual) || 0;
  const local = [im.cidade, im.estado].filter(Boolean).join('/');

  return (
    <div style={{ position: 'relative', minHeight: '78vh', overflow: 'hidden', background: 'linear-gradient(135deg,#0f172a 0%,#1e3a5f 100%)' }}>
      {/* Fundo do imóvel, EMBAÇADO */}
      <div aria-hidden style={{ position: 'absolute', inset: 0, filter: 'blur(9px)', transform: 'scale(1.08)' }}>
        {foto
          ? <img src={foto} alt="" onError={() => setImgIdx(i => i + 1)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
          : <div style={{ width: '100%', height: '100%', background: 'linear-gradient(135deg,#1e293b,#334155)' }} />}
      </div>
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'rgba(15,23,42,0.62)' }} />

      {/* Cartão central */}
      <div style={{ position: 'relative', minHeight: '78vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ background: '#fff', borderRadius: 20, width: '100%', maxWidth: 420, padding: '30px 26px', boxShadow: '0 24px 60px rgba(0,0,0,0.35)', textAlign: 'center' }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px' }}>
            <Lock size={24} color="#0D63DB" />
          </div>

          <h1 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 900, color: '#111111' }}>Veja este imóvel completo</h1>

          {im.id ? (
            <>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', lineHeight: 1.35, margin: '0 0 4px' }}>
                {im.titulo || TIPO_LABEL[im.tipo] || 'Imóvel em leilão'}
              </div>
              {local && (
                <div style={{ fontSize: 12.5, color: '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, marginBottom: 10 }}>
                  <MapPin size={13} /> {local}
                </div>
              )}
              <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '8px 14px', marginBottom: 16 }}>
                <span style={{ fontSize: 18, fontWeight: 900, color: '#0D63DB' }}>{im.valor_minimo ? fmtBRL(im.valor_minimo) : 'Consultar'}</span>
                {desc > 0 && <span style={{ fontSize: 12, fontWeight: 800, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: 20 }}>-{Math.round(desc)}%</span>}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: '#64748b', margin: '4px 0 16px' }}>
              Entre na sua conta para ver os imóveis em leilão.
            </div>
          )}

          <p style={{ fontSize: 13, color: '#475569', lineHeight: 1.5, margin: '0 0 20px' }}>
            Crie sua conta <strong>gratuita</strong> ou entre para ver fotos, documentos (edital e matrícula),
            localização e a análise de viabilidade do investimento.
          </p>

          <button onClick={irCadastro}
            style={{ width: '100%', background: '#0D63DB', color: '#fff', border: 'none', borderRadius: 11, padding: '13px 0', fontSize: 14.5, fontWeight: 800, cursor: 'pointer', marginBottom: 10 }}>
            Criar conta grátis
          </button>
          <button onClick={irEntrar}
            style={{ width: '100%', background: '#fff', color: '#0D63DB', border: '1.5px solid #bfdbfe', borderRadius: 11, padding: '12px 0', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
            Já tenho conta — Entrar
          </button>

          <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 14 }}>
            Você voltará para este imóvel assim que entrar.
          </div>
        </div>
      </div>
    </div>
  );
}
