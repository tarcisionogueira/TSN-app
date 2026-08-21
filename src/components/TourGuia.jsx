import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, X, RotateCcw } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useVezDoModal } from '../utils/filaModais';

/**
 * A versão do tour é a MAIS RECENTE PUBLICADA em `tour_etapas` — nunca o mês do relógio.
 *
 * POR QUE (09/08): esta linha era `new Date().toISOString().slice(0,7)`, ou seja, o tour só
 * aparecia se existisse uma versão com o rótulo do mês CORRENTE. A única versão cadastrada é
 * '2026-06'; a partir de 01/07 a consulta passou a devolver zero etapas e o tour de boas-vindas
 * simplesmente parou de existir — sem erro, sem log, sem nada na tela. Os 30 exploradores que se
 * cadastraram são TODOS de 03/07 em diante: `tour_progresso` tinha 0 linhas, nenhum deles viu o
 * onboarding. Ancorar na versão mais recente publicada faz o tour sobreviver à virada do mês e
 * ainda mantém o comportamento desejado: publicou versão nova, ela vira a atual sozinha.
 */
const CAP_VISUALIZACOES = 3; // não insistir para sempre com quem fecha sem concluir

export default function TourGuia() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  const [etapas, setEtapas] = useState([]);
  const [versoes, setVersoes] = useState([]);
  const [versaoAtual, setVersaoAtual] = useState(null);
  const [versaoVendo, setVersaoVendo] = useState(null);
  const [indice, setIndice] = useState(0);
  const [visivel, setVisivel] = useState(false);

  const carregarEtapas = useCallback(async (versao) => {
    const { data } = await supabase
      .from('tour_etapas')
      .select('*')
      .eq('versao', versao)
      .eq('ativo', true)
      .order('ordem');

    // `roles` vazio = etapa para todo mundo. Tolerante a null: uma etapa cadastrada sem roles
    // não pode derrubar o tour inteiro com TypeError dentro do efeito (falha invisível).
    const filtradas = (data || []).filter(e =>
      !e.roles || e.roles.length === 0 || e.roles.includes(role)
    );
    setEtapas(filtradas);
    setIndice(0);
    return filtradas;
  }, [role]);

  useEffect(() => {
    if (!user) return;

    async function verificar() {
      // Carrega versões disponíveis (a mais recente é a "atual"; as outras vão para "ver anteriores")
      const { data: todasVersoes } = await supabase
        .from('tour_etapas')
        .select('versao')
        .eq('ativo', true)
        .order('versao', { ascending: false });
      const unicas = [...new Set((todasVersoes || []).map(e => e.versao))];
      setVersoes(unicas);
      if (unicas.length === 0) return; // nenhuma versão publicada — nada a mostrar

      const atual = unicas[0];
      setVersaoAtual(atual);
      setVersaoVendo(atual);

      // Verifica progresso na versão atual
      const { data: prog } = await supabase
        .from('tour_progresso')
        .select('*')
        .eq('user_id', user.id) // padrao-ok: estado do tour é de quem NAVEGA (sob suporte o admin não deve consumir as visualizações do cliente)
        .eq('versao', atual)
        .maybeSingle();

      // Exibe apenas uma vez por sessão de login (sessionStorage é limpo ao fechar o browser/aba)
      const jaVisto = sessionStorage.getItem(`tsn_tour_${atual}`);
      const views = prog?.visualizacoes || 0;
      if (!jaVisto && !prog?.completo && views < CAP_VISUALIZACOES) {
        const etapasList = await carregarEtapas(atual);
        if (etapasList.length > 0) {
          setVisivel(true);
          sessionStorage.setItem(`tsn_tour_${atual}`, '1');
          await registrarVisualizacao(prog, views, atual);
        }
      }
    }

    verificar();
  }, [user]);

  async function registrarVisualizacao(prog, viewsAtuais, versao) {
    if (!user) return;
    if (prog) {
      await supabase.from('tour_progresso')
        .update({ visualizacoes: viewsAtuais + 1, ultima_vez: new Date().toISOString() })
        .eq('id', prog.id);
    } else {
      await supabase.from('tour_progresso')
        .insert({ user_id: user.id, versao, visualizacoes: 1 }); // padrao-ok: estado do tour é de quem NAVEGA
    }
  }

  const fechar = async () => {
    setVisivel(false);
    // Marca como completo se chegou ao fim
    if (indice >= etapas.length - 1 && user) {
      await supabase.from('tour_progresso')
        .update({ completo: true })
        .eq('user_id', user.id) // padrao-ok: estado do tour é de quem NAVEGA
        .eq('versao', versaoVendo);
    }
  };

  const avancar = () => {
    if (indice < etapas.length - 1) {
      const proxima = etapas[indice + 1];
      if (proxima.rota !== loc.pathname) nav(proxima.rota);
      setIndice(i => i + 1);
    } else {
      fechar();
    }
  };

  const voltar = () => {
    if (indice > 0) {
      const anterior = etapas[indice - 1];
      if (anterior.rota !== loc.pathname) nav(anterior.rota);
      setIndice(i => i - 1);
    }
  };

  const verVersao = async (v) => {
    setVersaoVendo(v);
    const lista = await carregarEtapas(v);
    if (lista.length > 0) {
      nav(lista[0].rota);
      setVisivel(true);
    }
  };


  // Botão flutuante "?" removido a pedido — o tour de boas-vindas ainda abre 1x por
  // login; dúvidas sobre a plataforma são respondidas pela IA do chat de suporte.
  // FILA DE MODAIS (15/08): o tour esperava atrás do vídeo de boas-vindas — explicar a tela
  // por cima de um vídeo não ensina nada. Ver src/utils/filaModais.js.
  const minhaVez = useVezDoModal('tour', !!(visivel && etapas.length));
  if (!minhaVez) return null;

  const etapa = etapas[indice];
  const total = etapas.length;
  // "Novidade" só quando a versão publicada é mesmo do mês corrente; fora disso é o tour de
  // boas-vindas — chamar de novidade um conteúdo de meses atrás confunde quem acabou de entrar.
  const ehNovas = versaoVendo === versaoAtual;
  const ehDoMes = versaoVendo === new Date().toISOString().slice(0, 7);

  return (
    <>
      {/* Véu LEVE e SEM blur (09/08, pedido do dono): o tour existe para mostrar a tela, e o
          overlay a 0,75 com blur escondia justamente aquilo que cada passo está descrevendo —
          a pessoa lia "Área de Membros" olhando para um borrão. Agora dá para ver o fundo e
          entender do que o texto está falando; o card continua legível por contraste próprio. */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.28)', zIndex: 9000 }} onClick={fechar} />

      {/* Card central do tour */}
      <div style={{ position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 9001, width: 'calc(100% - 32px)', maxWidth: 520, background: 'white', borderRadius: 20, padding: '28px 28px 24px', boxShadow: '0 24px 70px rgba(0,0,0,0.45), 0 0 0 1px rgba(15,23,42,0.08)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            {ehNovas && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#eff6ff', color: '#084BA6', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {ehDoMes ? `✨ Novidade, ${versaoVendo}` : '👋 Comece por aqui'}
              </div>
            )}
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#111111', lineHeight: 1.3 }}>{etapa.titulo}</h3>
          </div>
          <button onClick={fechar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, marginLeft: 12, flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, margin: '0 0 20px' }}>{etapa.descricao}</p>

        {/* Progresso */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {etapas.map((_, i) => (
            <div key={i} style={{ height: 3, flex: 1, borderRadius: 3, background: i <= indice ? '#0D63DB' : '#e2e8f0', transition: 'background 0.3s' }} />
          ))}
        </div>

        {/* Navegação */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={voltar} disabled={indice === 0}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'none', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 13, fontWeight: 600, color: '#374151', cursor: indice === 0 ? 'not-allowed' : 'pointer', opacity: indice === 0 ? 0.4 : 1 }}>
            <ChevronLeft size={15} /> Anterior
          </button>

          <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600 }}>{indice + 1} / {total}</span>

          <button onClick={avancar}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: '#0D63DB', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: 'white', cursor: 'pointer' }}>
            {indice === total - 1 ? 'Concluir' : 'Próximo'} <ChevronRight size={15} />
          </button>
        </div>

        {/* Ver versões anteriores */}
        {versoes.filter(v => v !== versaoVendo).length > 0 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #f1f5f9', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600 }}>Ver também:</span>
            {versoes.filter(v => v !== versaoVendo).map(v => (
              <button key={v} onClick={() => verVersao(v)}
                style={{ fontSize: 11, padding: '3px 10px', background: '#f1f5f9', border: 'none', borderRadius: 6, color: '#475569', cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                <RotateCcw size={10} /> {v}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
