/**
 * Resultado do leilão no LEILÃO ELETRÔNICO (leilaoeletronico.com.br) — leitor PRÓPRIO, pela API do site.
 *
 * Por que existe (30/10, dono: "a casa da Alameda Japão foi vendida? não aparece como sem lance"):
 * a página do lote é um MODELO jQuery (`<script type="text/x-jquery-tmpl">`) preenchido depois pelo
 * navegador. O HTML que o robô baixa não tem status nem lance — só o texto-modelo, que inclui a
 * frase "Sem lance" do ramo `{forelse}` da lista de lances. O leitor genérico lia essa frase em
 * TODO lote: dos 9 "sem lance" gravados para esta fonte até 30/10, 3 tinham sido ARREMATADOS
 * (lotes 2626, 2634, 2681 — R$ 768 mil, 384 mil, 262 mil). E 65 outros ficaram sem resultado.
 * Forma nº 10 do CLAUDE.md: o instrumento lia o modelo da página e reportava como resultado.
 *
 * A verdade vem de `POST /ApiEngine/GetRealTime` com `{ IDs_Leiloes_Lote: [...] }` — a mesma
 * chamada que a página faz. Aceita VÁRIOS lotes por chamada: um lote de apuração inteiro custa
 * uma requisição. Fica atrás da Cloudflare para servidor (403 "Just a moment" medido via pg_net),
 * então tenta direto (grátis) e cai no Bright Data só se precisar.
 */
import { buscarViaBrightData, ErroBrightData } from './_brightdata.js';

const API = 'https://www.leilaoeletronico.com.br/ApiEngine/GetRealTime';
const POR_CHAMADA = 100;

/** Nº do lote na URL `/lote/<slug>/<id>/` do Leilão Eletrônico, ou null se não for dessa fonte. */
export function idLoteLeilaoEletronico(url) {
  const m = String(url || '').match(/^https?:\/\/(?:www\.)?leilaoeletronico\.com\.br\/lote\/[^/]+\/(\d+)\/?(?:[?#].*)?$/i);
  return m ? Number(m[1]) : null;
}

async function chamar(ids, proposito) {
  const corpo = JSON.stringify({ IDs_Leiloes_Lote: ids, IsLances: false });
  const headers = { 'Content-Type': 'application/json; charset=utf-8', Accept: 'application/json' };
  // 1) Direto: grátis. Hoje a Cloudflare barra servidor, mas se um dia liberar, não gastamos cota.
  try {
    const r = await fetch(API, { method: 'POST', headers: { ...headers, 'User-Agent': 'Mozilla/5.0' }, body: corpo, signal: AbortSignal.timeout(15000) });
    if (r.ok && /json/i.test(r.headers.get('content-type') || '')) return await r.json();
    console.warn('[leilaoeletronico] direto recusado', r.status, '— tentando Bright Data');
  } catch (e) {
    console.warn('[leilaoeletronico] direto falhou:', String(e?.message || e).slice(0, 120));
  }
  // 2) Bright Data. LANÇA em falha (ErroBrightData, com `semCota` quando é o freio de custo) —
  //    o chamador separa "não consegui ler" de resultado; nunca vira "sem lance" por omissão.
  const r = await buscarViaBrightData(API, { method: 'POST', headers, proposito, extras: { body: corpo } });
  const txt = await r.text();
  try { return JSON.parse(txt); } catch { throw new Error(`resposta não-JSON da API (${txt.slice(0, 80)})`); }
}

/**
 * Lê o tempo real de vários lotes. Devolve Map<idLote, objeto GetLoteRealTime>.
 * LANÇA se a leitura falhar — lote ausente do Map significa "a API não falou dele", não "sem lance".
 */
export async function buscarRealTimeLeilaoEletronico(ids, { proposito = 'geral' } = {}) {
  const mapa = new Map();
  const unicos = [...new Set(ids.filter(Boolean))];
  for (let i = 0; i < unicos.length; i += POR_CHAMADA) {
    const resp = await chamar(unicos.slice(i, i + POR_CHAMADA), proposito);
    if (!Array.isArray(resp?.Lotes)) throw new Error('API sem a lista "Lotes"');
    for (const l of resp.Lotes) {
      const g = Array.isArray(l?.GetLoteRealTime) ? l.GetLoteRealTime[0] : null;
      if (g && l.ID_Leiloes_Lote) mapa.set(Number(l.ID_Leiloes_Lote), g);
    }
  }
  return mapa;
}

/**
 * Traduz o tempo real de UM lote para o formato de `apurarResultadoDoTexto`
 * (`{resultado, valor}` · `{resultado:null, aberto:true, novaData}` · `null` = indeterminado).
 * Valores vistos ao vivo em 30/10 (74 lotes): StatusLote "Arrematado" (com Vencedor.Valor),
 * "Encerrado", "Encerrado Segunda Praça". Encerrado COM lance mas SEM vencedor (lote 2331: lance
 * e proposta na 2ª praça) fica indeterminado — pode ser condicional, não afirmamos nada.
 */
export function achadoDoRealTimeLeilaoEletronico(g) {
  if (!g) return null;
  const status = `${g.StatusLote || ''} ${g.Lote_SubStatus || ''} ${g.StatusLeilao || ''}`.toLowerCase();
  const valorVencedor = Number(g.Vencedor?.Valor) || 0;
  const lanceAtual = Number(g.ValorLanceAtual) || 0;
  if (/arrematad|vendid/.test(status) || Number(g.ID_Leiloes_Lance_Vencedor) > 0 || valorVencedor > 0) {
    const valor = valorVencedor || lanceAtual;
    return { resultado: 'vendido', valor: valor >= 1000 ? valor : null };
  }
  if (/cancelad/.test(status)) return { resultado: 'cancelado', valor: null };
  if (/encerrad/.test(status)) {
    const temProposta = Number(g.ID_Leiloes_Proposta) > 0 || Number(g.ID_Leiloes_Lance_PropostaAtual) > 0;
    if (lanceAtual > 0 || temProposta) return null; // lance/proposta sem vencedor: condicional → indeterminado
    return { resultado: 'sem_lance', valor: null };
  }
  // Não encerrou: se o término está no futuro, é pregão aberto (grava o fim real da praça).
  const fim = String(g.DataTermino || '');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(fim) && new Date(`${fim.slice(0, 19)}-03:00`).getTime() > Date.now()) {
    return { resultado: null, aberto: true, novaData: { praca1_fim: `${fim.slice(0, 19)}-03:00` } };
  }
  return null;
}

export { ErroBrightData };
