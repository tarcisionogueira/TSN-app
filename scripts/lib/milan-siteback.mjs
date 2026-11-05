/**
 * MILAN — VIA GRÁTIS pela API pública `siteback.milanleiloes.com.br` (05/11; mapeada pelo dono no navegador e
 * conferida do runner: 200 JSON sem cookie). O site em si e `/api/public` ficam atrás do desafio do Cloudflare
 * (só o Bright Data passa — e não contornamos o desafio). A `siteback` dá a agenda inteira e o evento:
 *
 *   GET /leiloes/agenda?tipoCat=8&limit=0  → eventos de imóveis (codLeilao, tituloLeilao, tipoLeilao, praças, datas)
 *   GET /leiloes/{cod}                     → detalhe (localFotos, nProcesso, comissao, comitentes, praças)
 *
 * Evento de LOTE ÚNICO (tipoLeilao 2): o título do evento É o do imóvel, e as praças estão no evento. Falta só o
 * número do lote (e com ele a foto, a matrícula e a URL do lote): descoberto testando a foto no repositório
 * `adm.milanleiloes.com.br/Fotos/{localFotos}/{lote}_a.JPG` — servidor sem desafio. Evento de VÁRIOS LOTES
 * (tipoLeilao 7) segue pela página do evento via Bright Data (a lista de lotes só sai pela /api/public).
 */
const SITEBACK = 'https://siteback.milanleiloes.com.br';
const ADM = 'https://adm.milanleiloes.com.br';
const UA_SITE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const UA_ADM = 'BidPro-docs/1.0 (+https://bidpro.com.br)'; // o repositório dá 400 a alguns UAs de navegador (lib/milan-docs.mjs)

export class FalhaSiteback extends Error {
  constructor(url, detalhe) { super(`siteback ${url}: ${detalhe}`); this.url = url; }
}

// Leitura que falha LANÇA: "não consegui ler a agenda" não pode virar "a Milan não tem imóvel" (forma nº 2/4).
async function json(url, fetchImpl = fetch) {
  const r = await fetchImpl(url, { headers: { 'User-Agent': UA_SITE, Accept: 'application/json', Origin: 'https://milanleiloes.com.br', Referer: 'https://milanleiloes.com.br/' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new FalhaSiteback(url, `HTTP ${r.status}`);
  const ct = r.headers.get('content-type') || '';
  if (!/json/.test(ct)) throw new FalhaSiteback(url, `resposta não-JSON (${ct || 'sem tipo'})`);
  return r.json();
}

export async function agendaImoveis(fetchImpl = fetch) {
  const a = await json(`${SITEBACK}/leiloes/agenda?tipoCat=8&limit=0`, fetchImpl);
  if (!Array.isArray(a)) throw new FalhaSiteback('agenda', 'formato inesperado (não é lista)');
  return a.filter((e) => e && e.codLeilao && !e.suspenso);
}

export const eventoSiteback = (cod, fetchImpl = fetch) => json(`${SITEBACK}/leiloes/${encodeURIComponent(cod)}`, fetchImpl);

/** Lote único: acha o número do lote pela foto no repositório (001…015, _a/_A, JPG/jpg). null = não achou. */
export async function descobrirLote(localFotos, { fetchImpl = fetch, max = 15 } = {}) {
  if (!localFotos) return null;
  for (let n = 1; n <= max; n++) {
    const lote = String(n).padStart(3, '0');
    for (const arq of [`${lote}_a.JPG`, `${lote}_a.jpg`, `${lote}_A.JPG`, `${lote}_A.jpg`]) {
      const url = `${ADM}/Fotos/${localFotos}/${arq}`;
      try {
        const r = await fetchImpl(url, { method: 'HEAD', headers: { 'User-Agent': UA_ADM }, signal: AbortSignal.timeout(15000) });
        if (r.ok && /image/i.test(r.headers.get('content-type') || '')) return { lote, foto: `${url}?v=1` };
      } catch { /* padrao-ok: sondagem de candidato — rede instável num arquivo vira "tenta o próximo", e o "não achou" final é contado pelo chamador */ }
    }
  }
  return null;
}

const dia = (iso) => (iso ? String(iso).slice(0, 10) : null);

/**
 * Evento de lote único (detalhe da siteback) → "card" no formato que lib/milan-parse.mjs#montarRow já entende,
 * + praças. Praça vigente = a 1ª enquanto a data dela não passou; depois, a 2ª.
 */
export function cardDoEvento(ev, { lote, foto }, agora = new Date()) {
  const p1 = Number(ev.praca1Minimo) || 0, p2 = Number(ev.praca2Minimo) || 0;
  const d1 = ev.praca1Data || ev.dataInicio || null, d2 = ev.praca2Data || null;
  const passouP1 = d1 && d2 && new Date(d1) < agora;
  return {
    lote, foto, titulo: String(ev.tituloLeilao || '').trim(),
    url: `https://milanleiloes.com.br/leilao/${ev.codLeilao}/lote/${lote}`,
    minimo: passouP1 && p2 ? p2 : (p1 || p2),
    praca1: { valor: p1 || null, data: d1 }, praca2: { valor: p2 || null, data: d2 },
    processo: ev.nProcesso || null,
    data_leilao: dia(passouP1 ? d2 : d1), data_leilao_2: !passouP1 && d2 ? d2 : null,
  };
}
