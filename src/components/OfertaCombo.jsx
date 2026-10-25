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

/**
 * COMBO COMO CHECKBOX no checkout (21/10, dono: "coloque o combo como um checkbox — apenas atualizando o valor e
 * permissões do sistema"). Marcar troca o plano da tela para `combo` (preço, termo e cobrança do Combo — e com ele
 * as permissões: o webhook ativa Pro + acesso a veículos); desmarcar volta ao plano de origem (`base`).
 */
export function ComboCheckbox({ marcado, base, PLANOS, onChange, anual = false }) {
  // No ciclo ANUAL (21/10) a conta é com os preços anuais — mesmo desconto em todos os planos.
  const num = (k) => Number(anual ? PLANOS?.[k]?.precoAnual : PLANOS?.[k]?.preco) || 0;
  const per = anual ? '/ano' : '/mês';
  const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const combo = num('combo');
  const diferenca = combo - num(base);
  const economia = num('top2') + num('veiculos') - combo;
  const inclui = base === 'veiculos' ? 'os imóveis (Investidor Pro)' : 'os veículos (Leilão de Veículos)';
  return (
    <label style={{ display: 'flex', gap: 12, alignItems: 'flex-start', cursor: 'pointer', background: marcado ? '#f5f3ff' : '#faf5ff', border: `2px solid ${marcado ? '#7c3aed' : '#ddd6fe'}`, borderRadius: 14, padding: '14px 16px', marginBottom: 16, transition: 'border-color .15s, background .15s' }}>
      <input type="checkbox" checked={marcado} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 20, height: 20, marginTop: 1, flexShrink: 0, accentColor: '#7c3aed', cursor: 'pointer' }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 14, fontWeight: 800, color: '#4c1d95' }}>
          Incluir {inclui} — Combo {combo > 0 ? fmt(combo) : ''}{per}
        </span>
        <span style={{ display: 'block', fontSize: 12.5, color: '#5b21b6', marginTop: 3, lineHeight: 1.5 }}>
          {diferenca > 0 ? `Só +${fmt(diferenca)}${per}` : 'Imóveis e veículos'}{economia > 0 ? ` · economize ${fmt(economia)}${per} em relação aos dois separados` : ''}.
        </span>
        <span style={{ display: 'block', fontSize: 12, color: '#6b21a8', marginTop: 6, lineHeight: 1.55 }}>
          {base === 'veiculos'
            ? 'Relatórios de viabilidade e análise de edital, matrícula e processo dos imóveis (10 + 10/mês), além de tudo de veículos.'
            : 'O leiloeiro de cada carro desbloqueado, com link, documentos e pátio, e 10 relatórios por IA de veículos/mês.'}
        </span>
      </span>
    </label>
  );
}

/**
 * PRO → COMBO SEM COBRANÇA DUPLA (25/10, arena — passo 10). Quem já paga o Investidor Pro mensal teme pagar os dois.
 * Não paga: quando a recorrência do Combo é confirmada, o webhook cancela as outras recorrências que o Combo
 * substitui (api/_recorrencia-unica.js → cancelarOutrasRecorrencias com `alcancaTrilha`: o Combo alcança top2,
 * veículos e outro Combo — MP em mp-webhook.js na autorização do mandato, Asaas em asaas-webhook.js no 1º
 * pagamento confirmado). Não há pró-rata: o que faltava era DIZER isso. Diferença sempre de `PLANOS` ao vivo.
 */
export function AvisoProParaCombo({ PLANOS, anual = false }) {
  const num = (k) => Number(anual ? PLANOS?.[k]?.precoAnual : PLANOS?.[k]?.preco) || 0;
  const fmt = (v) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const diferenca = num('combo') - num('top2');
  return (
    <div style={{ background: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: 12, padding: '12px 14px', marginBottom: 16, fontSize: 12.5, color: '#4c1d95', lineHeight: 1.6 }}>
      {diferenca > 0 && <strong style={{ display: 'block', fontSize: 13.5 }}>Veículos por +{fmt(diferenca)}{anual ? '/ano' : '/mês'} em relação ao seu Pro.</strong>}
      Seu Pro atual é encerrado automaticamente após o 1º pagamento do Combo: uma cobrança só.
    </div>
  );
}
