/**
 * /api/espelhar-docs-cron — copia matrícula e edital do SITE DO LEILOEIRO para o nosso bucket.
 *
 * REGRA DO DONO (08/08): "os leiloeiros em que volta e meia temos uma quebra, devemos passar a
 * armazenar esses documentos".
 *
 * O QUE ESTAVA EM RISCO, medido: dos lotes de leiloeiro com documento, quase nenhum tinha cópia
 * nossa — só ZUK (265) e GRUPOLANCE (212). Todo o resto era um link para o site do leiloeiro.
 * Quando o site cai, troca de endereço ou tira o lote do ar, o relatório documental perde a
 * matrícula e o edital que ele mesmo prometeu — e depois do leilão não há como recuperar.
 *
 * A FILA É AUTO-ORDENADA pela instabilidade REAL de cada fonte (`fonte_instabilidade()`, % de
 * execuções que não terminaram 'ok' nos últimos 60 dias). Quem quebra mais, espelha primeiro;
 * fonte nova instável entra sozinha; fonte que estabilizou sai. Ninguém mantém lista na mão.
 *
 * CUIDADOS DE CUSTO E EDUCAÇÃO: lote pequeno por execução, teto de tamanho por arquivo, e o
 * documento NÃO é rebaixado — o link original continua no acervo; a cópia entra como espelho.
 * Falhar aqui nunca altera o lote.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { hostExternoSeguro, fetchExternoSeguro } from './_allowed-hosts.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LOTE = Number(process.env.ESPELHO_LOTE || 25);
const MAX_BYTES = 25 * 1024 * 1024; // matrícula digitalizada passa de 10 MB; 25 é folga sensata
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function marcar(id, patch) {
  await sb(`documento_espelho?id=eq.${id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...patch, atualizado_em: new Date().toISOString() }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // Reabastece a fila antes de trabalhar: lotes novos entram na ordem da instabilidade da fonte.
  let enfileirados = 0;
  try {
    const r = await sb('rpc/enfileirar_espelho_documentos', { method: 'POST', body: JSON.stringify({ p_limite: 200 }) });
    if (r.ok) enfileirados = await r.json().catch(() => 0);
    else console.error('[espelhar-docs] enfileirar', r.status, (await r.text().catch(() => '')).slice(0, 200));
  } catch (e) { console.error('[espelhar-docs] enfileirar erro', e?.message); }

  const pend = await (await sb(`documento_espelho?status=eq.pendente&tentativas=lt.3&select=id,imovel_id,fonte,tipo,url_origem,tentativas&order=criado_em.asc&limit=${LOTE}`)).json().catch(() => []);
  if (!Array.isArray(pend) || !pend.length) {
    res.status(200).json({ ok: true, enfileirados, processados: 0, motivo: 'fila vazia' });
    return;
  }

  let copiados = 0, falhas = 0, ignorados = 0;
  for (const d of pend) {
    // Anti-SSRF: só host externo permitido — a URL veio do acervo, mas o acervo vem de scraper.
    if (!hostExternoSeguro(d.url_origem)) {
      await marcar(d.id, { status: 'ignorado', motivo: 'host não permitido' }); ignorados++; continue;
    }
    let bin = null, mime = 'application/pdf';
    try {
      const r = await fetchExternoSeguro(d.url_origem, {
        headers: { 'User-Agent': UA, Accept: 'application/pdf,*/*' },
        signal: AbortSignal.timeout(25000),
      });
      if (!r.ok) { await marcar(d.id, { status: 'pendente', tentativas: (d.tentativas || 0) + 1, motivo: `HTTP ${r.status}` }); falhas++; continue; }
      mime = (r.headers.get('content-type') || 'application/pdf').split(';')[0].trim();
      const buf = new Uint8Array(await r.arrayBuffer());
      // Página HTML de erro travestida de documento: não espelha lixo como se fosse matrícula.
      if (/text\/html/i.test(mime)) { await marcar(d.id, { status: 'ignorado', motivo: 'resposta HTML, não é documento' }); ignorados++; continue; }
      if (!buf.length || buf.length > MAX_BYTES) { await marcar(d.id, { status: 'ignorado', motivo: `tamanho ${buf.length}` }); ignorados++; continue; }
      bin = Buffer.from(buf);
    } catch (e) {
      await marcar(d.id, { status: 'pendente', tentativas: (d.tentativas || 0) + 1, motivo: String(e?.message || e).slice(0, 120) });
      falhas++; continue;
    }

    const ext = /pdf/i.test(mime) ? 'pdf' : /jpe?g/i.test(mime) ? 'jpg' : /png/i.test(mime) ? 'png' : 'bin';
    const path = `espelho/${d.fonte}/${d.imovel_id}/${d.tipo}.${ext}`;
    const up = await fetch(`${SUPABASE_URL}/storage/v1/object/documentos/${path}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': mime, 'x-upsert': 'true' },
      body: bin,
    });
    if (!up.ok) {
      await marcar(d.id, { status: 'pendente', tentativas: (d.tentativas || 0) + 1, motivo: `upload ${up.status}` });
      falhas++; continue;
    }
    await marcar(d.id, { status: 'copiado', storage_path: path, bytes: bin.length, motivo: null });
    copiados++;
  }

  // Log sempre, inclusive quando não houve baixa: silêncio não distingue "nada a fazer" de
  // "cron parou" — a lição do monitor de fontes.
  console.log('[espelhar-docs]', JSON.stringify({ enfileirados, processados: pend.length, copiados, falhas, ignorados }));
  res.status(200).json({ ok: true, enfileirados, processados: pend.length, copiados, falhas, ignorados });
}
