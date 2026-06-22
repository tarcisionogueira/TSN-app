/**
 * pagamento.js — fonte única da verdade para forma_pagamento
 *
 * Valores canônicos gravados no banco: 'a_vista' | 'financiado' | 'hipotecado'
 * (parcelado é alias de financiado — ambos significam pagamento parcelado)
 *
 * Ao integrar novo leiloeiro, use normalizarFormaPagamento(rawString) antes de gravar.
 */

// ─── Rótulos para exibição ────────────────────────────────────────────────────
export const PAGAMENTO_LABEL = {
  a_vista:    'À Vista',
  financiado: 'Financiado / FGTS',
  hipotecado: 'Hipotecado',
};

// ─── Checkboxes do filtro de busca → valores canônicos no banco ───────────────
// Ao adicionar novo leiloeiro: garanta que normalizarFormaPagamento() mapeia
// as strings dele para um dos valores canônicos abaixo.
export const PAGAMENTO_FILTRO_DB = {
  aVista: [
    'a_vista', 'avista', 'à vista', 'a vista',
    'recursos proprios', 'recursos próprios', 'dinheiro',
  ],
  financiado: [
    'financiado', 'financiamento', 'fgts',
    'parcelado', 'parcelamento',             // variantes legadas
    'carta de credito', 'carta de crédito',
    'consorcio', 'consórcio',
  ],
  hipotecado: [
    'hipotecado', 'hipoteca',
    'com onus', 'com ônus', 'com gravame',
  ],
};

// ─── Normalização: raw string → valor canônico ────────────────────────────────
// Use em TODOS os scrapers/importadores antes de gravar no banco.
//
// Guia por leiloeiro (atualizar conforme integração):
//   Caixa (CEF)        → inferido da modalidade (ver scraper-caixa.js)
//   Superbid           → a_vista por padrão (hardcoded até integração real)
//   eLeilões           → a_vista por padrão (hardcoded até integração real)
//   Mega Leilões       → a_vista por padrão (hardcoded até integração real)
//   Zukerman           → a_vista por padrão (hardcoded até integração real)
//   [futuro leiloeiro] → mapear aqui ao integrar
//
export function normalizarFormaPagamento(raw) {
  if (!raw) return 'a_vista';
  const s = String(raw)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Hipotecado tem precedência (risco específico diferente de financiamento)
  if (s.includes('hipotec') || s.includes('com onus') || s.includes('gravame')) {
    return 'hipotecado';
  }

  // Financiado: banco, FGTS, parcelamento, consórcio
  if (
    s.includes('financ') || s.includes('fgts') ||
    s.includes('parcel') || s.includes('consorcio') ||
    s.includes('carta de credito')
  ) {
    return 'financiado';
  }

  // À vista: dinheiro, recursos próprios, etc.
  return 'a_vista';
}

// ─── Display badge ─────────────────────────────────────────────────────────────
export function pagamentoBadge(valor) {
  if (!valor) return null;
  const v = String(valor).toLowerCase();
  if (v === 'a_vista' || v === 'avista' || v.includes('vista') || v.includes('recurso')) {
    return { label: 'À Vista', bg: '#f1f5f9', color: '#475569' };
  }
  if (v === 'hipotecado' || v.includes('hipotec') || v.includes('onus') || v.includes('gravame')) {
    return { label: 'Hipotecado', bg: '#fef3c7', color: '#92400e' };
  }
  // financiado, parcelado, fgts, etc.
  return { label: 'Financiado / FGTS', bg: '#dcfce7', color: '#166534' };
}
