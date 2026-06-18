import React, { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, X, RotateCcw } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { useAuth } from '../contexts/AuthContext';

const VERSAO_ATUAL = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
const MAX_EXIBICOES_MES = 3;

export default function TourGuia() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();

  const [etapas, setEtapas] = useState([]);
  const [versoes, setVersoes] = useState([]);
  const [versaoVendo, setVersaoVendo] = useState(VERSAO_ATUAL);
  const [indice, setIndice] = useState(0);
  const [visivel, setVisivel] = useState(false);
  const [mostrarMenu, setMostrarMenu] = useState(false);
  const [progresso, setProgresso] = useState(null);

  const carregarEtapas = useCallback(async (versao) => {
    const { data } = await supabase
      .from('tour_etapas')
      .select('*')
      .eq('versao', versao)
      .eq('ativo', true)
      .order('ordem');

    const filtradas = (data || []).filter(e =>
      e.roles.length === 0 || e.roles.includes(role)
    );
    setEtapas(filtradas);
    setIndice(0);
    return filtradas;
  }, [role]);

  useEffect(() => {
    if (!user) return;

    async function verificar() {
      // Carrega versões disponíveis (para o menu "ver anteriores")
      const { data: todasVersoes } = await supabase
        .from('tour_etapas')
        .select('versao')
        .eq('ativo', true)
        .order('versao', { ascending: false });
      const unicas = [...new Set((todasVersoes || []).map(e => e.versao))];
      setVersoes(unicas);

      // Verifica progresso do mês atual
      const { data: prog } = await supabase
        .from('tour_progresso')
        .select('*')
        .eq('user_id', user.id)
        .eq('versao', VERSAO_ATUAL)
        .maybeSingle();

      setProgresso(prog);

      // Exibe se ainda não atingiu o limite
      const views = prog?.visualizacoes || 0;
      if (views < MAX_EXIBICOES_MES) {
        const etapasList = await carregarEtapas(VERSAO_ATUAL);
        if (etapasList.length > 0) {
          setVersaoVendo(VERSAO_ATUAL);
          setVisivel(true);
          await registrarVisualizacao(prog, views);
        }
      }
    }

    verificar();
  }, [user]);

  async function registrarVisualizacao(prog, viewsAtuais) {
    if (!user) return;
    if (prog) {
      await supabase.from('tour_progresso')
        .update({ visualizacoes: viewsAtuais + 1, ultima_vez: new Date().toISOString() })
        .eq('id', prog.id);
    } else {
      await supabase.from('tour_progresso')
        .insert({ user_id: user.id, versao: VERSAO_ATUAL, visualizacoes: 1 });
    }
  }

  const fechar = async () => {
    setVisivel(false);
    // Marca como completo se chegou ao fim
    if (indice >= etapas.length - 1 && user) {
      await supabase.from('tour_progresso')
        .update({ completo: true })
        .eq('user_id', user.id)
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
    setMostrarMenu(false);
    const lista = await carregarEtapas(v);
    if (lista.length > 0) {
      nav(lista[0].rota);
      setVisivel(true);
    }
  };

  const verNovamente = async () => {
    const lista = await carregarEtapas(VERSAO_ATUAL);
    if (lista.length > 0) {
      nav(lista[0].rota);
      setVisivel(true);
    }
  };

  if (!visivel || etapas.length === 0) {
    // Botão flutuante para re-abrir o tour
    if (!user) return null;
    return (
      <button
        onClick={() => setMostrarMenu(m => !m)}
        title="Tour de funcionalidades"
        style={{ position: 'fixed', bottom: 80, right: 20, zIndex: 8000, background: '#2563eb', color: 'white', border: 'none', borderRadius: '50%', width: 44, height: 44, cursor: 'pointer', fontSize: 20, boxShadow: '0 4px 16px rgba(37,99,235,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        ?
        {mostrarMenu && (
          <div style={{ position: 'absolute', bottom: 52, right: 0, background: 'white', borderRadius: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.15)', padding: 12, minWidth: 220, textAlign: 'left' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8, padding: '0 4px' }}>Tour de Funcionalidades</div>
            <button onClick={verNovamente} style={{ width: '100%', padding: '8px 10px', background: '#eff6ff', border: 'none', borderRadius: 8, fontSize: 13, color: '#1d4ed8', fontWeight: 600, cursor: 'pointer', textAlign: 'left', marginBottom: 4 }}>
              ✨ Funcionalidades do mês
            </button>
            {versoes.filter(v => v !== VERSAO_ATUAL).map(v => (
              <button key={v} onClick={() => verVersao(v)} style={{ width: '100%', padding: '7px 10px', background: 'none', border: 'none', borderRadius: 8, fontSize: 13, color: '#374151', cursor: 'pointer', textAlign: 'left', display: 'block' }}>
                📅 {v}
              </button>
            ))}
          </div>
        )}
      </button>
    );
  }

  const etapa = etapas[indice];
  const total = etapas.length;
  const ehNovas = versaoVendo === VERSAO_ATUAL;

  return (
    <>
      {/* Overlay escuro */}
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 9000, backdropFilter: 'blur(2px)' }} onClick={fechar} />

      {/* Card central do tour */}
      <div style={{ position: 'fixed', bottom: 40, left: '50%', transform: 'translateX(-50%)', zIndex: 9001, width: 'calc(100% - 32px)', maxWidth: 520, background: 'white', borderRadius: 20, padding: '28px 28px 24px', boxShadow: '0 24px 60px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <div>
            {ehNovas && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: '#eff6ff', color: '#1d4ed8', fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                ✨ Novidade — {VERSAO_ATUAL}
              </div>
            )}
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#0f172a', lineHeight: 1.3 }}>{etapa.titulo}</h3>
          </div>
          <button onClick={fechar} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: 4, marginLeft: 12, flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        <p style={{ color: '#475569', fontSize: 14, lineHeight: 1.7, margin: '0 0 20px' }}>{etapa.descricao}</p>

        {/* Progresso */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
          {etapas.map((_, i) => (
            <div key={i} style={{ height: 3, flex: 1, borderRadius: 3, background: i <= indice ? '#2563eb' : '#e2e8f0', transition: 'background 0.3s' }} />
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
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: '#2563eb', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700, color: 'white', cursor: 'pointer' }}>
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
