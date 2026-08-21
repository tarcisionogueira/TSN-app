import { useEffect, useState, useCallback, useRef } from 'react';
import { useVezDoModal } from '../utils/filaModais';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import FotoImovel from './FotoImovel';

/**
 * Sugestão de imóvel — card discreto no canto inferior direito (não atrapalha a
 * operação). Mostra 1 imóvel por vez: "Ver imóvel" (interesse) ou "Não tenho
 * interesse". O feedback vai para feedback_imovel e VIRA APRENDIZADO.
 *
 * Regras:
 *  - Teto de 3 sugestões por JANELA DE 24h (persistente por navegador) — não fica
 *    reaparecendo várias vezes no mesmo acesso.
 *  - Não repete imóvel: exclui o que a pessoa já avaliou (feedback) E o que já tem
 *    relatório gerado (já está no monitoramento, na tela de análise).
 *  - MODO SUPORTE (admin/analista impersonando): pode aparecer, mas a seleção do
 *    suporte NÃO grava feedback — não pode influenciar o cliente.
 */
const LIMITE_24H = 3;
const HIST_KEY = 'bidpro_sugestao_hist';
const brl = v => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

// Timestamps das sugestões mostradas nas últimas 24h (persistente por navegador).
function lerHist() {
  try {
    const a = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
    const lim = Date.now() - 24 * 3600 * 1000;
    return (Array.isArray(a) ? a : []).filter(t => Number(t) > lim);
  } catch { return []; }
}
function registrarMostrado() {
  try { const h = lerHist(); h.push(Date.now()); localStorage.setItem(HIST_KEY, JSON.stringify(h)); } catch { /* */ }
}

export default function SugestaoImovel() {
  const { user, isLoggedIn, effectiveUserId, impersonate } = useAuth();
  const navigate = useNavigate();
  const suporte = !!impersonate; // modo suporte não influencia o cliente
  const [fila, setFila] = useState([]);
  const [atual, setAtual] = useState(null);
  const [visivel, setVisivel] = useState(false);
  const restantesRef = useRef(0); // quantas ainda podem aparecer nesta janela de 24h

  // Carrega candidatos: imóveis ativos atrativos que a pessoa AINDA não avaliou nem
  // analisou (relatórios). Usa effectiveUserId (o cliente, quando em suporte).
  useEffect(() => {
    if (!isLoggedIn || !effectiveUserId) return;
    const restantes = LIMITE_24H - lerHist().length;
    restantesRef.current = restantes;
    if (restantes <= 0) return; // já atingiu o teto de 3/24h
    let vivo = true;
    (async () => {
      try {
        const uid = effectiveUserId;
        // Exclusões (já avaliados / com relatório) + REGIÃO de referência do cliente.
        // A sugestão segue as MESMAS regras do e-mail de oportunidades: filtro salvo
        // mais recente → senão cidade/UF do cadastro. Antes a query não tinha recorte
        // geográfico nenhum e sugeria o maior desconto do Brasil inteiro — mostrava
        // imóvel de outro estado (ex.: RJ p/ cliente de SP). Agora NUNCA sai do estado.
        const [fb, rel, laudo, doc, merc, perfilRes, filtrosRes] = await Promise.all([
          supabase.from('feedback_imovel').select('imovel_id').eq('user_id', uid),
          supabase.from('relatorios').select('imovel_id').eq('user_id', uid),
          supabase.from('analises_laudo').select('imovel_id').eq('user_id', uid),
          supabase.from('analises_documental').select('imovel_id').eq('user_id', uid),
          supabase.from('analises_mercado').select('imovel_id').eq('user_id', uid),
          supabase.from('perfis').select('endereco_cidade,endereco_uf').eq('id', uid).maybeSingle(),
          supabase.from('filtros_salvos').select('filtros').eq('user_id', uid).order('criado_em', { ascending: false }).limit(1),
        ]);
        const excl = new Set();
        for (const arr of [fb.data, rel.data, laudo.data, doc.data, merc.data]) {
          for (const x of (arr || [])) if (x?.imovel_id) excl.add(String(x.imovel_id));
        }
        const filtro = filtrosRes.data?.[0]?.filtros || {};
        const perfil = perfilRes.data || {};
        const uf = filtro.estado || perfil.endereco_uf || '';
        const cidadesRef = (Array.isArray(filtro.cidades) && filtro.cidades.length ? filtro.cidades : [perfil.endereco_cidade]).filter(Boolean);
        const descMin = Math.max(35, Number(filtro.descontoMin) || 0);
        const tipos = Array.isArray(filtro.tipos) ? filtro.tipos.filter(Boolean) : [];
        // Sem NENHUM sinal de região (sem UF e sem filtro salvo): não sugere nada, para
        // não recair no acervo nacional e mostrar imóvel irrelevante. Melhor nada que ruim.
        if (!uf && !cidadesRef.length) return;
        const normCid = (c) => (c || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
        const base = () => {
          let q = supabase.from('imoveis_leilao')
            .select('id,titulo,cidade,estado,valor_minimo,desconto_percentual,link_foto,fonte,fonte_id')
            .eq('ativo', true).gt('valor_minimo', 0).not('link_foto', 'is', null)
            .gte('desconto_percentual', descMin);
          if (uf) q = q.eq('estado', uf);                       // trava geográfica: nunca sai do estado
          if (tipos.length) q = q.in('tipo', [...tipos, 'imovel']);
          return q;
        };
        // Prefere a(s) cidade(s) de referência; se render pouco, completa DENTRO do estado.
        let cand = [];
        if (cidadesRef.length) {
          const { data } = await base().in('cidade_norm', cidadesRef.map(normCid)).order('desconto_percentual', { ascending: false }).limit(60);
          cand = (data || []);
        }
        if (cand.length < 12 && uf) {
          const { data } = await base().order('desconto_percentual', { ascending: false }).limit(60);
          const jaTem = new Set(cand.map(c => String(c.id)));
          for (const im of (data || [])) if (!jaTem.has(String(im.id))) cand.push(im);
        }
        cand = cand.filter(i => !excl.has(String(i.id)));
        for (let i = cand.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cand[i], cand[j]] = [cand[j], cand[i]]; }
        if (vivo && cand.length) { setFila(cand); setTimeout(() => vivo && setVisivel(true), 9000); }
      } catch { /* silencioso */ }
    })();
    return () => { vivo = false; };
  }, [isLoggedIn, effectiveUserId]);

  // Puxa o próximo da fila quando fica visível ou após uma ação — respeitando o teto de 24h.
  useEffect(() => {
    if (visivel && !atual && fila.length && restantesRef.current > 0) {
      setAtual(fila[0]);
      setFila(f => f.slice(1));
      registrarMostrado();
      restantesRef.current -= 1;
    }
  }, [visivel, atual, fila]);

  const registrar = useCallback(async (imovelId, sinal) => {
    // Em modo SUPORTE não grava nada — a seleção do suporte não pode influenciar o cliente.
    if (suporte || !user?.id) return;
    try {
      await supabase.from('feedback_imovel')
        .upsert({ user_id: user.id, imovel_id: imovelId, sinal, contexto: 'sugestao_widget' }, { onConflict: 'user_id,imovel_id,sinal' }); // padrao-ok: guard `if (suporte…) return` logo acima — nunca roda sob suporte
    } catch { /* silencioso */ }
  }, [suporte, user?.id]);

  const proximo = useCallback((sinal) => {
    if (atual) registrar(atual.id, sinal);
    setAtual(null);
    if (restantesRef.current <= 0 || fila.length === 0) setVisivel(false);
  }, [atual, fila.length, registrar]);

  // FILA DE MODAIS (15/08): sugestão é o menor custo de ignorar, então espera todo o resto.
  const minhaVez = useVezDoModal('sugestao', !!(visivel && atual));
  if (!minhaVez) return null;

  return (
    <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 900, width: 300, maxWidth: 'calc(100vw - 32px)',
      background: '#fff', borderRadius: 14, boxShadow: '0 10px 30px rgba(0,0,0,.18)', border: '1px solid #e2e8f0', overflow: 'hidden', fontFamily: 'inherit' }}>
      <div style={{ position: 'relative', height: 130, background: '#f1f5f9' }}>
        <FotoImovel imovel={atual} iconSize={30} />
        <span style={{ position: 'absolute', top: 8, left: 8, background: '#16a34a', color: '#fff', fontSize: 12, fontWeight: 800, padding: '2px 8px', borderRadius: 20 }}>
          {atual.desconto_percentual ? `${atual.desconto_percentual}% OFF` : 'Oportunidade'}
        </span>
        {suporte && (
          <span style={{ position: 'absolute', bottom: 8, left: 8, background: 'rgba(15,23,42,.75)', color: '#fff', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 20 }}>
            modo suporte · não registra
          </span>
        )}
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
