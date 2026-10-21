import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Home, Car } from 'lucide-react';
import { rotaBuscaVeiculos } from '../utils/veiculosAcesso';

/**
 * IMÓVEIS | VEÍCULOS dentro da tela de busca, como o primeiro filtro (21/10, dono: "não era um dropdown nem
 * mais um botão no menu — dentro da tela onde estão os filtros, 2 botões imóveis ou veículos"). O menu tem um
 * "Leilões" só; trocar aqui leva à busca do outro acervo, cada uma com os filtros e a lista dela.
 * Imóveis do visitante é a página do servidor (/leiloes, rewrite do vercel.json) → navegação real.
 */
export default function SeletorAcervo({ ativo, logado, role }) {
  const nav = useNavigate();
  const ir = (alvo) => {
    if (alvo === ativo) return;
    if (alvo === 'veiculos') { nav(rotaBuscaVeiculos(role)); return; }
    if (logado) nav('/buscar'); else window.location.href = '/leiloes';
  };
  const botao = (alvo, Icone, rotulo) => {
    const sel = alvo === ativo;
    return (
      <button key={alvo} onClick={() => ir(alvo)} aria-pressed={sel}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '11px 14px', borderRadius: 10, border: 'none', cursor: sel ? 'default' : 'pointer', fontWeight: 800, fontSize: 14, background: sel ? '#084BA6' : 'transparent', color: sel ? 'white' : '#475569', transition: 'background 0.15s' }}>
        <Icone size={16} /> {rotulo}
      </button>
    );
  };
  return (
    <div role="group" aria-label="Tipo de leilão" style={{ display: 'flex', gap: 4, padding: 4, background: 'white', border: '1px solid #e2e8f0', borderRadius: 14, maxWidth: 420 }}>
      {botao('imoveis', Home, 'Imóveis')}
      {botao('veiculos', Car, 'Veículos')}
    </div>
  );
}
