/**
 * pagamento.js — fonte única da verdade para forma_pagamento
 *
 * Valores canônicos no banco: 'a_vista' | 'financiado' | 'hipotecado' | null
 *
 * ⚠️ REGRA CRÍTICA: null = "não sabemos"
 * NUNCA inferir forma_pagamento a partir da modalidade (venda_direta, 2ª praça etc.)
 * pois isso é incorreto: há venda_direta à vista e 2ª praça financiada.
 * Só gravar um valor quando a fonte de dados o informa EXPLICITAMENTE.
 * Se não houver informação → gravar null.
 *
 * Impacto no filtro: propriedades com null são EXCLUÍDAS quando o filtro
 * de pagamento está ativo — melhor omitir do que mostrar dado errado.
 *
 * Ao integrar novo leiloeiro:
 * 1. Verificar se o leiloeiro fornece campo explícito de pagamento
 * 2. Se sim: usar normalizarFormaPagamento(rawString) e gravar o resultado
 * 3. Se não: gravar null — nunca inventar
 */

// ─── Rótulos para exibição ────────────────────────────────────────────────────
export const PAGAMENTO_LABEL = {
  a_vista:    'À Vista',
  financiado: 'Financiado',
  hipotecado: 'Hipotecado',
};

// ─── Checkbox do filtro → valor canônico ÚNICO no banco ───────────────────────
// O banco SEMPRE armazena o valor já normalizado (a_vista | financiado | hipotecado).
// Por isso o filtro usa igualdade exata (.in) em vez de ilike: é mais rápido,
// confiável e permite combinar várias opções sem quebrar a query (ex.: Financiado +
// Hipotecado retorna a união). Use este mapa em toda a aplicação.
export const PAGAMENTO_CANON = {
  aVista: 'a_vista',
  financiado: 'financiado',
  hipotecado: 'hipotecado',
};

// Converte as chaves selecionadas no filtro (aVista/financiado/hipotecado) nos
// valores canônicos do banco, removendo duplicatas e inválidos.
export function pagamentoParaCanon(chaves = []) {
  return [...new Set(chaves.map(k => PAGAMENTO_CANON[k]).filter(Boolean))];
}

// ─── Checkboxes do filtro de busca → valores canônicos no banco (LEGADO) ──────
// Mantido para compatibilidade (ilike). O filtro de busca agora usa PAGAMENTO_CANON
// com igualdade exata; este mapa permanece como referência de variantes históricas.
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

/**
 * O lote SÓ aceita pagamento à vista? (31/08)
 *
 * POR QUE EXISTE. `hipotecado` NÃO é um ônus nesta base — é uma FORMA DE PAGAMENTO, e ela é
 * parcelável. Quem grava é o gatilho `default_forma_pagamento_judicial`, que marca TODO lote
 * judicial como `hipotecado`; e o filtro da Busca descreve o valor por extenso: *"Parcelamento
 * no leilão judicial (art. 895 do CPC), com o imóvel hipotecado ao juízo até quitar"*.
 *
 * O DEFEITO que este helper fecha (achado do dono, no print de um apartamento no Itaim Bibi):
 * duas telas decidiam à vista com `!pagamento.includes('financiado')` — `Analise.jsx` (a
 * projeção) e `Busca.jsx` (o que ela passa para a análise). Nenhuma das duas conhecia
 * `hipotecado`, então **todo lote judicial era tratado como só-à-vista**: o cenário parcelado
 * ficava DESABILITADO na tela e capital necessário, custo mensal, ROI e teto de lance saíam
 * sobre a premissa errada. Medido em 31/08: **2.081 lotes ativos**, e os 2.081 são judiciais.
 *
 * O servidor já estava certo (`gerar-analise.js` só aceita o literal `'a_vista'`) e
 * `_auditoria-relatorio.js` até audita a contradição "parcelável × somenteAVista" — era só o
 * cliente que discordava.
 *
 * É a mesma família do achado de 15/08 (132 lotes com parcelamento no título gravados como
 * `a_vista`): o acervo dizia parcelável e a tela decidia à vista sozinha. Aqui a regra vive num
 * lugar só, porque regra duplicada é como o defeito sobrevive nos dois lados.
 *
 * `null`/desconhecido NÃO trava o cenário parcelado: "não sabemos" nunca pode virar restrição.
 *
 * @param {string[]|string|null} formas valor(es) de `forma_pagamento` do lote
 */
export function soAceitaAVista(formas) {
  const lista = (Array.isArray(formas) ? formas : [formas]).filter(Boolean).map((v) => String(v).toLowerCase());
  if (!lista.length) return false;                 // sem informação não restringe
  return !lista.some((v) => v === 'financiado' || v === 'hipotecado');
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
  return { label: 'Financiado', bg: '#dcfce7', color: '#166534' };
}
