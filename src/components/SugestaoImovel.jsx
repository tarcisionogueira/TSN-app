import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * Sugestão de imóvel — card discreto no canto inferior direito (não atrapalha a
 * operação). Mostra 1 imóvel por vez: "Ver imóvel" (interesse) ou "Não tenho
 * interesse". O feedback vai para feedback_imovel e VIRA APRENDIZADO: o e-mail das
 * oportunidades exclui o que foi marcado "sem interesse". Some após 3 dispensas/sessão.
 */
const MAX_SESSAO = 3;
const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

export default function SugestaoImovel() {
  const { user, isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const [fila, setFila] = useState([]);   // candidatos ainda não mostrados
  const [atual, setAtual] = useState(null);
  const [dispensas, setDispensas] = useState(0);
  const [visivel, setVisivel] = useState(false);

  // Carrega candidatos: imóveis ativos atrativos que a pessoa AINDA não avaliou.
  useEffect(() => {
    if (!isLoggedIn || !user?.id) return;
    let vivo = true;
    (async () => {
      try {
        const { data: fb } = await supabase.from('feedback_imovel').select('imovel_id').eq('user_id', user.id);
        const vistos = new Set((fb || []).map(x => x.imovel_id));
        const { data } = await supabase
          .from('imoveis_leilao')
          .select('id,titulo,cidade,estado,valor_minimo,desconto_percentual,link_foto')
          .eq('ativo', true).gt('valor_minimo', 0).not('link_foto', 'is', null)
          .gte('desconto_percentual', 35)
          .order('desconto_percentual', { ascending: false }).limit(40);
        const cand = (data || []).filter(i => !vistos.has(i.id));
        // embaralha levemente p/ não repetir sempre os mesmos topos
        for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
        if (vivo && cand.length) { setFila(cand); setTimeout(() => vivo && setVisivel(true), 9000); }
      } catch { /* silencioso */ }
    })();
    return () => { vivo = false; };
  }, [isLoggedIn, user?.id]);

  // Puxa o próximo da fila quando fica visível ou após uma ação.
  useEffect(() => {
    if (visivel && !atual && fila.length) { setAtual(fila[0]); setFila(f => f.slice(1)); }
  }, [visivel, atual, fila]);

  const registrar = useCallback(async (imovelId, sinal) => {
    if (!user?.id) return;
    try {
      await supabase.from('feedback_imovel')
        .upsert({ user_id: user.id, imovel_id: imovelId, sinal, contexto: 'sugestao_widget' }, { onConflict: 'user_id,imovel_id,sinal' });
    } catch { /* silencioso */ }
  }, [user?.id]);

  const proximo = useCallback((sinal) => {
    if (atual) registrar(atual.id, sinal);
    const d = dispensas + 1; setDispensas(d);
    setAtual(null);
    if (d >= MAX_SESSAO || fila.length === 0) setVisivel(false);
  }, [atual, dispensas, fila.length, registrar]);

  if (!visivel || !atual) return null;

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 900, width: 300, maxWidth: 'calc(100vw - 32px)',
      background: '#fff', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.18)', border: '1px solid #e2e8f0', overflow: 'hidden', fontFamily: 'inherit' }}>
      <div style={{ position: 'relative', height: 130, background: '#f1f5f9' }}>
        {atual.link_foto && <img src={atual.link_foto} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />}
        <span style={{ position: 'absolute', top: 8, left: 8, background: '#16a34a', color: '#fff', fontSize: 12, fontWeight: 800, padding: '2px 8px', borderRadius: 20 }}>
          {atual.desconto_percentual ? `${atual.desconto_percentual}% OFF` : 'Oportunidade'}
        </span>
        <button onClick={() => proximo('visto')} aria-label="Fechar" style={{ position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, border: 'none', background: 'rgba(0,0,0,.45)', color: '#fff', cursor: 'pointer', fontSize: 14, lineHeight: '24px' }}>×</button>
      </div>
      <div style={{ padding: '10px 12px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#0D63DB', textTransform: 'uppercase', letterSpacing: .5 }}>💡 Sugestão para você</div>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a', margin: '2px 0', lineHeight: 1.3, maxHeight: 36, overflow: 'hidden' }}>{atual.titulo || 'Imóvel em leilão'}</div>
        <div style={{ fontSize: 12, color: '#64748b' }}>{[atual.cidade, atual.estado].filter(Boolean).join('/')} · {brl(atual.valor_minimo)}</div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <button onClick={() => { registrar(atual.id, 'interesse'); const id = atual.id; setAtual(null); setVisivel(false); navigate(`/imovel/${id}`); }}
            style={{ flex: 1, background: '#0D63DB', color: '#fff', border: 'none', borderRadius: 9, padding: '8px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Ver imóvel</button>
          <button onClick={() => proximo('sem_interesse')}
            style={{ background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 9, padding: '8px 10px', fontSize: 12.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>Não tenho interesse</button>
        </div>
      </div>
    </div>
  );
}
