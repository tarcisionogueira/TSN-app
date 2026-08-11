import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Play, CheckCircle2, ArrowRight } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { videoEmbed } from '../utils/videoEmbed';

/**
 * POP-UP DE BOAS-VINDAS — o vídeo que recebe quem entra pela primeira vez.
 *
 * PEDIDO DO DONO (11/08): "a pessoa entrar pela primeira vez na plataforma, abrir esse vídeo
 * como um pop-up, e ao assistir passar para o vídeo de primeiros passos". Comportamento
 * escolhido por ele: pode fechar, e VOLTA nos próximos acessos até assistir — depois some
 * para sempre.
 *
 * DUAS DECISÕES QUE VALE ENTENDER
 *
 * 1. Qual curso é o de boas-vindas NÃO está chumbado aqui. Vem de `cursos_admin.onboarding`,
 *    um checkbox no cadastro. Chumbar um UUID no código significaria que trocar o vídeo de
 *    boas-vindas exige deploy — e a pessoa que decide isso não é quem faz deploy.
 *
 * 2. "Assistiu" é declarado, não detectado. O iframe do YouTube não avisa quando o vídeo
 *    termina (isso exigiria carregar a IFrame API e abrir mão do nocookie). Fingir que
 *    detectamos o fim — por tempo decorrido, digamos — marcaria como visto o vídeo de quem
 *    deixou a aba aberta e foi almoçar. Então o avanço é um botão. É honesto, e o progresso
 *    que ele grava é o MESMO `aula_progresso` da área de membros: assistir aqui conta lá.
 */

const ROLES_CLIENTE = ['explorador', 'top2', 'top2_anual', 'assessorado', 'clube'];
const DISPENSA_KEY = 'tsn_boasvindas_dispensado';   // por SESSÃO: volta no próximo acesso

export default function BoasVindasModal() {
  const { user, role, impersonate } = useAuth();
  const nav = useNavigate();
  const [curso, setCurso] = useState(null);
  const [aulas, setAulas] = useState([]);
  const [idx, setIdx] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    // Equipe não recebe o onboarding do cliente (e em modo suporte o que vale é o que a
    // EQUIPE está fazendo, não a ficha de quem ela olha — abrir um pop-up de boas-vindas
    // no meio de um atendimento seria só atrapalhar).
    if (!user || impersonate || !ROLES_CLIENTE.includes(role)) return;
    if (sessionStorage.getItem(DISPENSA_KEY) === '1') return;

    let cancelado = false;
    (async () => {
      const { data: c, error: eC } = await supabase.from('cursos_admin')
        .select('id, titulo, subtitulo, cor')
        .eq('onboarding', true).eq('ativo', true)
        .order('ordem').limit(1).maybeSingle();
      // `error` checado: falha de leitura não é "não há curso de boas-vindas". Silenciar aqui
      // faria o pop-up sumir para todo mundo num soluço de rede, sem deixar rastro.
      if (eC || !c || cancelado) { if (eC) console.warn('[boas-vindas] curso:', eC.message); return; }

      const [{ data: as, error: eA }, { data: prog }] = await Promise.all([
        supabase.from('aulas_admin').select('id, titulo, video_url, modulo').eq('curso_id', c.id).order('ordem'),
        supabase.from('aula_progresso').select('aula_id, concluida').eq('user_id', user.id).eq('curso_id', c.id),
      ]);
      if (eA || cancelado) return;
      const lista = (as || []).filter((a) => String(a.video_url || '').trim());
      if (!lista.length) return;

      const feitas = new Set((prog || []).filter((p) => p.concluida).map((p) => p.aula_id));
      const primeiraPendente = lista.findIndex((a) => !feitas.has(a.id));
      if (primeiraPendente < 0) return;   // já assistiu tudo → nunca mais aparece

      setCurso(c); setAulas(lista); setIdx(primeiraPendente); setAberto(true);
    })();
    return () => { cancelado = true; };
  }, [user, role, impersonate]);

  const fechar = useCallback(() => {
    sessionStorage.setItem(DISPENSA_KEY, '1');   // volta só no próximo acesso
    setAberto(false);
  }, []);

  const concluirEAvancar = useCallback(async () => {
    if (salvando || !curso || !aulas[idx]) return;
    setSalvando(true);
    const aula = aulas[idx];
    try {
      // Mesmo registro da área de membros — o progresso daqui aparece lá.
      const { error } = await supabase.from('aula_progresso')
        .upsert({ user_id: user.id, curso_id: curso.id, aula_id: aula.id, concluida: true },
          { onConflict: 'user_id,aula_id' });
      if (error) console.warn('[boas-vindas] progresso:', error.message);
    } catch (e) { console.warn('[boas-vindas] progresso:', e?.message); }
    setSalvando(false);
    if (idx + 1 < aulas.length) setIdx(idx + 1);
    else { sessionStorage.setItem(DISPENSA_KEY, '1'); setAberto(false); }
  }, [salvando, curso, aulas, idx, user]);

  if (!aberto || !curso || !aulas.length) return null;

  const aula = aulas[idx];
  const emb = videoEmbed(aula.video_url);
  const ultima = idx + 1 >= aulas.length;
  // Quantos ainda faltam DEPOIS deste — é o número que a linha de contrato mostra.
  const restantes = aulas.length - (idx + 1);
  const cor = curso.cor || '#0D63DB';

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) fechar(); }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.75)', backdropFilter: 'blur(3px)', zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div style={{ background: 'white', borderRadius: 18, maxWidth: 780, width: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,0.35)' }}>
        {/* Cabeçalho */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '18px 20px 12px' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: cor, textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: 4 }}>
              {aula.modulo || 'Boas-vindas'} · vídeo {idx + 1} de {aulas.length}
            </div>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#0f172a', lineHeight: 1.3 }}>{aula.titulo}</div>
          </div>
          <button onClick={fechar} aria-label="Fechar"
            style={{ background: '#f1f5f9', border: 'none', borderRadius: 8, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <X size={16} color="#475569" />
          </button>
        </div>

        {/* Player */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000' }}>
          {emb?.tipo === 'iframe' ? (
            <iframe src={emb.src} title={aula.titulo}
              allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }} />
          ) : emb?.tipo === 'video' ? (
            <video src={emb.src} controls controlsList="nodownload" playsInline
              style={{ width: '100%', height: '100%', background: '#000', display: 'block' }} />
          ) : (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13 }}>
              <Play size={18} style={{ marginRight: 8 }} /> Vídeo indisponível
            </div>
          )}
        </div>

        {/* CONTRATO EXPLÍCITO COM QUEM ESTÁ VENDO (pedido do dono, 11/08): a pessoa precisa
            saber POR QUE isto reaparece e O QUE faz parar. Sem esta linha, um convite que
            volta a cada acesso vira incômodo sem explicação — e o reflexo é fechar mais
            rápido a cada vez, não assistir. */}
        <div style={{ margin: '14px 20px 0', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 12px', display: 'flex', gap: 9, alignItems: 'flex-start' }}>
          <CheckCircle2 size={15} color={cor} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, color: '#475569', lineHeight: 1.55 }}>
            {restantes > 0 ? (
              <>Assista e marque como concluído para este convite <strong>parar de aparecer</strong>.
              {' '}Faltam {restantes} {restantes === 1 ? 'vídeo' : 'vídeos'}.</>
            ) : (
              <>Este é o último. Ao marcar como concluído, o convite <strong>não aparece mais</strong>.</>
            )}
            {' '}Você também pode assistir depois na Área de Membros — o progresso é o mesmo.
          </div>
        </div>

        {/* Ações */}
        <div style={{ padding: '16px 20px 20px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
          <button onClick={fechar}
            title="Fecha agora; o convite volta no próximo acesso até você concluir os vídeos."
            style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: '8px 4px' }}>
            Ver depois
          </button>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => { fechar(); nav(`/membros/curso/${curso.id}`); }}
              style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 10, padding: '10px 14px', fontSize: 13, fontWeight: 700, color: '#334155', cursor: 'pointer' }}>
              Abrir na Área de Membros
            </button>
            <button onClick={concluirEAvancar} disabled={salvando}
              style={{ background: cor, color: 'white', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13.5, fontWeight: 800, cursor: salvando ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 7, opacity: salvando ? 0.7 : 1 }}>
              {ultima ? <><CheckCircle2 size={15} /> Assisti — concluir</> : <><ArrowRight size={15} /> Assisti — próximo vídeo</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
