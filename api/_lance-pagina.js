// LANCE CORRENTE A PARTIR DA PÁGINA DO LOTE (01/10, acompanhamento de favoritos).
// Imóveis não guardam lance corrente em fonte nenhuma (os scrapers gravam só o lance MÍNIMO), e
// boa parte dos veículos também não. Para os lotes FAVORITADOS — poucos por cliente — a página do
// lote é visitada e o lance é lido do texto. Sem IA, sem Bright Data (custo zero).
//
// Regra de honestidade (CLAUDE.md, forma nº 1/4): página que não EXPÕE o lance (carregado por
// script, login) é `nao_medido` com motivo — NUNCA "sem lance". "Sem lance" só quando a página diz
// isso com todas as letras ("nenhum lance", "0 lances", "seja o primeiro").
import { hostExternoSeguro } from './_allowed-hosts.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function fetchSeguro(url, opts = {}, maxHops = 3) {
  let atual = url;
  for (let i = 0; i <= maxHops; i++) {
    if (!hostExternoSeguro(atual)) return null;
    const resp = await fetch(atual, { ...opts, redirect: 'manual' });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get('location');
      if (!loc) return resp;
      try { atual = new URL(loc, atual).toString(); } catch { return null; }
      continue;
    }
    return resp;
  }
  return null;
}

const brl = (s) => {
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Texto visível de um HTML (sem script/style/tags). */
export function textoDoHtml(html) {
  return String(html || '')
    .replace(/<script[^]*?<\/script>/gi, ' ').replace(/<style[^]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ').trim();
}

/**
 * → { estado: 'com_lance'|'sem_lance'|'nao_medido', valor, qtdLances, motivo }
 */
export function extrairLance(texto) {
  const t = String(texto || '');
  if (t.length < 200) return { estado: 'nao_medido', valor: null, qtdLances: null, motivo: 'página sem conteúdo legível (carregada por script ou bloqueada)' };
  const semLance = /\b(nenhum lance|sem lances?( at[ée] o momento| registrados?)?|0 lances?|seja o primeiro a (dar|ofertar)|aguardando (o primeiro )?lance|n[ãa]o h[áa] lances?)\b/i.test(t);
  const mValor = t.match(/\b(lance atual|maior lance|[úu]ltimo lance|melhor lance|lance vencedor parcial|lance corrente|oferta atual|maior oferta)\b\s*[:\-–]?\s*(?:[^R\d]{0,25})R\$\s*([\d.]{1,15},\d{2})/i);
  // Contador de lances: número ISOLADO (não pode ser o fim de um valor — "R$ 300.000,00 Lance atual"
  // dava "00 Lance" = 0 lances) e não seguido de "atual/mínimo/inicial" (que é rótulo, não contagem).
  const mQtd = t.match(/(?<![\d.,])(\d{1,4})\s+lances?\b(?!\s*(atual|m[ií]nim|inicial|vencedor|corrente))/i)
    || t.match(/\blances?\s*(?:recebidos|dados|ofertados)?\s*[:\-]\s*(\d{1,4})\b/i);
  const valor = mValor ? brl(mValor[2]) : null;
  const qtd = mQtd ? Number(mQtd[1]) : null;
  if (valor && valor > 0 && qtd !== 0) return { estado: 'com_lance', valor, qtdLances: qtd, motivo: null };
  if (qtd && qtd > 0) return { estado: 'com_lance', valor: null, qtdLances: qtd, motivo: 'a página informa lances, mas não o valor' };
  if (semLance || qtd === 0) return { estado: 'sem_lance', valor: null, qtdLances: 0, motivo: null };
  return { estado: 'nao_medido', valor: null, qtdLances: null, motivo: 'a página do lote não expõe o lance corrente' };
}

/** Visita a página do lote e mede o lance. Nunca lança. */
export async function medirLanceDaPagina(url, timeoutMs = 12000) {
  if (!/^https?:\/\//i.test(String(url || ''))) return { estado: 'nao_medido', valor: null, qtdLances: null, motivo: 'lote sem link de página' };
  try {
    const r = await fetchSeguro(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(timeoutMs) });
    if (!r) return { estado: 'nao_medido', valor: null, qtdLances: null, motivo: 'endereço recusado (anti-SSRF) ou redirecionamentos demais' };
    if (!r.ok) return { estado: 'nao_medido', valor: null, qtdLances: null, motivo: `página respondeu HTTP ${r.status}` };
    return extrairLance(textoDoHtml(await r.text()));
  } catch (e) {
    return { estado: 'nao_medido', valor: null, qtdLances: null, motivo: `falha ao abrir a página: ${String(e?.name || e?.message || e).slice(0, 60)}` };
  }
}
