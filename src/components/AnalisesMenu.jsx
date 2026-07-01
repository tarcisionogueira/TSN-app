import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart3 } from 'lucide-react';
import { useAnalises } from '../contexts/AnalisesContext';

// Item "Análises" do topo: navega para a TELA de Minhas Análises (lista de
// imóveis). O antigo popup de pré-visualização foi removido — clicar leva direto
// à página, e lá o usuário clica num imóvel para abrir a análise específica.
// Mantém só o contador de "em andamento" como badge.
export default function AnalisesMenu({ mobile, onNavegar }) {
  const { emAndamento } = useAnalises();
  const nav = useNavigate();
  const ir = () => { onNavegar?.(); nav('/analises'); };

  return (
    <button onClick={ir}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: mobile ? '10px 14px' : '7px 14px', border: 'none', borderRadius: 8, background: 'transparent', color: '#94a3b8', fontWeight: 600, fontSize: mobile ? 14 : 13, cursor: 'pointer', width: mobile ? '100%' : 'auto', justifyContent: mobile ? 'flex-start' : 'center', position: 'relative' }}>
      <BarChart3 size={mobile ? 16 : 14} /> Análises
      {emAndamento > 0 && (
        <span style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 10, background: '#0d9488', color: 'white', fontSize: 10, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{emAndamento}</span>
      )}
    </button>
  );
}
