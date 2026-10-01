/**
 * /api/favoritos-lance-cron — lance corrente dos lotes FAVORITADOS (01/10, pedido do dono).
 *
 * "Veículos ou imóveis que estejam nessa classificação, a cada scraper realizado, caso o leilão não
 * tenha encerrado ainda, devem puxar o valor atual de lance para saber se está tendo disputa,
 * evoluindo disputa ou se permanece sem lance."
 *
 * Veículos da Superbid NÃO passam por aqui: o lance corrente chega em toda coleta e o gatilho
 * `favorito_lance_veiculo` grava no mesmo instante. Este cron cobre o resto — TODOS os imóveis (os
 * scrapers gravam só o lance mínimo) e os veículos de outras fontes — visitando SÓ as páginas dos
 * lotes favoritados e ainda abertos. Sem IA e sem Bright Data: custo zero. O que a página não expõe
 * vira `nao_medido` com motivo, nunca "sem lance".
 *
 * Roda de 3 em 3 h (vercel.json), na cadência dos scrapers de imóveis. Gate: CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { medirLanceDaPagina } from './_lance-pagina.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  signal: opts.signal || AbortSignal.timeout(20000),
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
const ler = async (path) => {
  const r = await sb(path);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${path.split('?')[0]}`);
  return r.json();
};

function encerrado(item) {
  if (!item) return true;
  if (item.ativo === false || item.resultado_leilao) return true;
  const datas = [item.data_leilao, item.data_leilao_2, item.praca2_fim, item.praca1_fim]
    .map((d) => (d ? Date.parse(d) : NaN)).filter(Number.isFinite);
  // Data do leilão já passou há mais de 1 dia → encerrado (o dia do leilão ainda é medido).
  return datas.length > 0 && Math.max(...datas) < Date.now() - 24 * 3600 * 1000;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'config ausente' }); return; }
  const deadline = Date.now() + 250000;
  const out = { favoritos: 0, medidos: 0, gravados: 0, encerrados: 0, cobertos_pelo_scraper: 0, nao_medidos: 0, erros: [] };

  let favs;
  try { favs = await ler('favoritos?select=tipo,item_id'); }
  catch (e) { res.status(502).json({ ok: false, motivo: `favoritos ilegíveis: ${e.message}` }); return; }
  const unicos = new Map();
  for (const f of favs || []) unicos.set(`${f.tipo}|${f.item_id}`, f);
  out.favoritos = unicos.size;
  if (!unicos.size) { res.status(200).json({ ok: true, ...out, nota: 'nenhum favorito' }); return; }

  const ids = (tipo) => [...unicos.values()].filter((f) => f.tipo === tipo).map((f) => f.item_id);
  const alvos = [];
  try {
    const im = ids('imovel');
    if (im.length) {
      const rows = await ler(`imoveis_leilao?id=in.(${im.join(',')})&select=id,url_lote,ativo,data_leilao,data_leilao_2,praca1_fim,praca2_fim,resultado_leilao`);
      for (const r of rows) {
        if (encerrado(r)) { out.encerrados++; continue; }
        alvos.push({ tipo: 'imovel', id: r.id, url: r.url_lote });
      }
    }
    const ve = ids('veiculo');
    if (ve.length) {
      const rows = await ler(`veiculos_leilao?id=in.(${ve.join(',')})&select=id,link_lote,ativo,data_leilao,resultado_leilao,lance_scraper:raw->offerDetail->>currentMaxBid`);
      for (const r of rows) {
        if (encerrado(r)) { out.encerrados++; continue; }
        if (r.lance_scraper != null) { out.cobertos_pelo_scraper++; continue; } // gatilho cuida
        alvos.push({ tipo: 'veiculo', id: r.id, url: r.link_lote });
      }
    }
  } catch (e) { res.status(502).json({ ok: false, motivo: `lotes ilegíveis: ${e.message}` }); return; }

  // Última medição de cada alvo, para gravar só o que mudou (ou a cada 6 h, prova de que mede).
  const ultimas = new Map();
  try {
    if (alvos.length) {
      const hist = await ler(`favorito_lance?item_id=in.(${alvos.map((a) => a.id).join(',')})&select=tipo,item_id,valor,estado,medido_em&order=medido_em.desc&limit=${alvos.length * 5}`);
      for (const h of hist) { const k = `${h.tipo}|${h.item_id}`; if (!ultimas.has(k)) ultimas.set(k, h); }
    }
  } catch (e) { out.erros.push(`histórico: ${e.message}`); }

  const novas = [];
  const fila = [...alvos];
  const trabalhar = async () => {
    while (fila.length && Date.now() < deadline - 15000) {
      const a = fila.shift();
      const m = await medirLanceDaPagina(a.url);
      out.medidos++;
      if (m.estado === 'nao_medido') out.nao_medidos++;
      const ult = ultimas.get(`${a.tipo}|${a.id}`);
      const mudou = !ult || ult.estado !== m.estado || Number(ult.valor ?? -1) !== Number(m.valor ?? -1)
        || Date.parse(ult.medido_em) < Date.now() - 6 * 3600 * 1000;
      if (mudou) novas.push({ tipo: a.tipo, item_id: a.id, valor: m.valor, qtd_lances: m.qtdLances, estado: m.estado, origem: 'pagina_lote', motivo: m.motivo });
    }
  };
  await Promise.all(Array.from({ length: 4 }, trabalhar));

  if (novas.length) {
    const r = await sb('favorito_lance', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(novas) });
    if (r.ok) out.gravados = novas.length;
    else out.erros.push(`gravação HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  }
  const ok = !out.erros.length;
  console.log('[favoritos-lance]', JSON.stringify(out));
  res.status(ok ? 200 : 502).json({ ok, ...out, pendentes_por_tempo: fila.length });
}
