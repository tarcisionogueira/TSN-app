/**
 * /api/superbid-sumidos-cron — a cada 2 h, confere POR ID os veículos Superbid que a coleta não toca há 36 h.
 *
 * Por que existe (24/10, dono: "veja como ter maior eficiência e autonomia nesse fluxo"): a Superbid retira
 * oferta antes do `endDate` e quem desligava esses lotes era só a varredura de sumidos do coletor, que roda no
 * runner residencial (PC do dono). Dias sem rodada ou enumeração incompleta = nada conferido: em 24/10 eram
 * 5.151 veículos de data futura sem atualização há 3+ dias, e o dono abriu dois (Porsche Macan 5025255, BMW
 * G310 R 5023784) com "Página não encontrada" no leiloeiro. Esta rotina não depende do PC nem da lista
 * completa: a API pública de ofertas responde por id, de graça.
 *
 * Nada é inferido da ausência (forma nº 4 do CLAUDE.md): só desliga quem a API diz que não existe
 * (`total: 0`) ou está `removed`. Erro de rede/HTTP/corpo sem `total` = não mexe e conta como falha; se a
 * maioria falhar, responde 500 (a API pode estar recusando o IP da Vercel) em vez de "nada a fazer".
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LOTE = 300;          // por rodada; 12 rodadas/dia = 3.600 conferências
const PARALELO = 20;       // mesmo ritmo da varredura do coletor (scripts/scraper-puppeteer.mjs)
const PARADO_H = 36;       // a coleta diária toca quem está aberto; 36 h sem toque = suspeito
const API = 'https://offer-query.superbid.net/offers/?portalId=[2,15]&locale=pt_BR&timeZoneId=America/Sao_Paulo&pageNumber=1&pageSize=5&fieldList=id;endDate;endDateTime;offerStatus&filter=id:';

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  signal: AbortSignal.timeout(10000),
});

// Mesma regra de scripts/scraper-puppeteer.mjs (dataFimSuperbid): epoch em ms vence; o texto vem em hora de Brasília.
function dataFim(of) {
  const ms = Number(of?.endDateTime);
  if (ms > 0) return new Date(ms).toISOString();
  const t = String(of?.endDate || '').trim();
  return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(t) ? `${t.replace(' ', 'T')}-03:00` : null;
}

async function consultar(oid) {
  try {
    const r = await fetch(API + oid, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { erro: `HTTP ${r.status}` };
    const d = await r.json();
    if (!Number.isFinite(Number(d?.total))) return { erro: 'resposta sem total' };
    return { total: Number(d.total), of: (d.offers || [])[0] || null };
  } catch (e) { return { erro: String(e?.message || e).slice(0, 80) }; }
}

// PATCH com prova (forma nº 3): só conta o que voltou na representação.
async function gravar(id, campos) {
  const r = await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(campos) });
  if (!r.ok) return false;
  return ((await r.json().catch(() => [])) || []).length > 0;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  const inicio = Date.now();
  const agora = new Date().toISOString();
  const corte = new Date(Date.now() - PARADO_H * 3600000).toISOString();
  const r = await sb(`veiculos_leilao?fonte=eq.SUPERBID&ativo=eq.true&data_leilao=gt.${agora}&atualizado_em=lt.${corte}&fonte_id=like.sbid_veic_*&select=id,fonte_id&order=atualizado_em.asc&limit=${LOTE}`);
  if (!r.ok) {
    const det = (await r.text().catch(() => '')).slice(0, 200);
    console.error('[superbid-sumidos] leitura', r.status, det);
    res.status(500).json({ error: 'falha ao ler candidatos', detalhe: det });
    return;
  }
  const candidatos = (await r.json().catch(() => [])).map((v) => ({ ...v, oid: String(v.fonte_id).replace('sbid_veic_', '') })).filter((v) => /^\d+$/.test(v.oid));
  const cont = { candidatos: candidatos.length, desativados: 0, redatados: 0, abertos: 0, falhas: 0, nao_gravou: 0, cortado: false };
  for (let i = 0; i < candidatos.length; i += PARALELO) {
    if (Date.now() - inicio > 48000) { cont.cortado = true; break; }
    const fatia = candidatos.slice(i, i + PARALELO);
    const resp = await Promise.all(fatia.map((c) => consultar(c.oid)));
    await Promise.all(resp.map(async (x, k) => {
      const c = fatia[k];
      if (x.erro) { cont.falhas++; return; }
      if (x.total === 0 || x.of?.offerStatus?.removed === true) {
        (await gravar(c.id, { ativo: false })) ? cont.desativados++ : cont.nao_gravou++;
        return;
      }
      const fim = dataFim(x.of || {});
      if (fim && new Date(fim) <= new Date()) {
        // encerrou: grava a data REAL — a desativação por data e a apuração seguem dali
        (await gravar(c.id, { data_leilao: fim, atualizado_em: agora })) ? cont.redatados++ : cont.nao_gravou++;
      } else {
        // ainda aberto: carimba a conferência, para a fila andar para os próximos
        (await gravar(c.id, { ...(fim ? { data_leilao: fim } : {}), atualizado_em: agora })) ? cont.abertos++ : cont.nao_gravou++;
      }
    }));
  }
  const conferidos = cont.desativados + cont.redatados + cont.abertos + cont.falhas + cont.nao_gravou;
  console.log('[superbid-sumidos]', JSON.stringify(cont));
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_heartbeat`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_chave: 'superbid_sumidos', p_detalhe: JSON.stringify(cont) }),
  }).catch((e) => console.error('[superbid-sumidos] heartbeat', e?.message || e));
  // Maioria falhando = a API não está respondendo para nós; isso não é "nada a fazer".
  if (conferidos > 0 && cont.falhas > conferidos / 2) { res.status(500).json({ error: 'API da Superbid falhou na maioria das consultas', ...cont }); return; }
  res.status(200).json({ ok: true, ...cont });
}
