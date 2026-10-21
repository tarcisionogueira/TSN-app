import React from 'react';
import { Check, Home, Car } from 'lucide-react';

/**
 * OFERTA DO COMBO ao abrir o link de qualquer plano (21/10, dono: "ao abrir o link de qualquer um deles,
 * oferecer o combo para ter acesso a imóveis e veículos destacando os benefícios"). Mora no Checkout porque é
 * ali que o link de cada plano abre — vale para quem vem de /planos e para o link compartilhado.
 * Preços sempre do `planos_config` (PLANOS ao vivo): a economia é calculada, nunca escrita à mão.
 * Não aparece para Clube/Assessoria (o Combo não substitui esses planos — ver Checkout) nem com o Combo desligado.
 */
const BENEFICIOS = [
  [Home, 'Imóveis: tudo do Investidor Pro — viabilidade por IA, análise de edital, matrícula e processo (10 + 10 relatórios/mês)'],
  [Car, 'Veículos: o leiloeiro de cada carro desbloqueado, com link do lote, documentos e endereço do pátio'],
  [Car, '10 relatórios por IA de veículos/mês: condição, FIPE e teto de lance'],
  [Check, 'Uma assinatura, uma cobrança — cancele quando quiser'],
];

export const podeOferecerCombo = (planoKey, role, PLANOS) =>
  ['explorador', 'top2', 'veiculos'].includes(planoKey)
  && PLANOS?.combo?.ativo !== false
  && !/^(clube|assessorado)/.test(role || '');

export default function OfertaCombo({ planoKey, PLANOS, onEscolher, escuro = false }) {
  const num = (k) => Number(PLANOS?.[k]?.preco) || 0;
  const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const separado = num('top2') + num('veiculos');
  const combo = num('combo');
  const economia = separado > combo && combo > 0 ? separado - combo : 0;
  const titulo = planoKey === 'veiculos' ? 'Leve também os imóveis'
    : planoKey === 'top2' ? 'Leve também os veículos'
      : 'Quer imóveis e veículos?';
  return (
    <div style={{ background: 'linear-gradient(145deg,#4c1d95 0%,#6d28d9 100%)', border: '2px solid #8b5cf6', borderRadius: 16, padding: '16px 18px', color: '#ede9fe', boxShadow: escuro ? 'none' : '0 8px 24px rgba(109,40,217,0.25)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: 1 }}>Combo Imóveis + Veículos</div>
          <div style={{ fontSize: 16, fontWeight: 900, color: 'white', marginTop: 2 }}>{titulo}</div>
        </div>
        {combo > 0 && <div style={{ fontSize: 15, fontWeight: 900, color: 'white', whiteSpace: 'nowrap' }}>{fmt(combo)}<span style={{ fontSize: 12, fontWeight: 600, color: '#ddd6fe' }}>/mês</span></div>}
      </div>
      {economia > 0 && (
        <div style={{ fontSize: 12.5, color: '#ddd6fe', marginTop: 4 }}>
          Separados sairiam {fmt(separado)}/mês — <strong style={{ color: '#86efac' }}>economize {fmt(economia)} todo mês</strong>.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7, margin: '12px 0 14px' }}>
        {BENEFICIOS.map(([Icone, t]) => (
          <div key={t} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.5 }}>
            <Icone size={14} color="#c4b5fd" style={{ flexShrink: 0, marginTop: 2 }} /> <span style={{ minWidth: 0 }}>{t}</span>
          </div>
        ))}
      </div>
      <button onClick={onEscolher}
        style={{ width: '100%', padding: '12px', border: 'none', borderRadius: 10, background: 'white', color: '#5b21b6', fontWeight: 900, fontSize: 14, cursor: 'pointer' }}>
        Quero o Combo →
      </button>
    </div>
  );
}
