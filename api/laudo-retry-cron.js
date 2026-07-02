/**
 * /api/laudo-retry-cron — completa as seções do laudo que ficaram "em confirmação"
 * por instabilidade da fonte, dentro do prazo de 48h. Reprocessa cada pendência,
 * mescla o resultado no relatório do caso e remove a seção de "faltando".
 * Fora do prazo → marca 'expirada'. Roda a cada 2h (vercel.json). CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { consultarComunicaDJEN, consultarCNDT, consultarCNIB, consultarProtestos } from './_laudo-fontes.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

const CAMPO = { cndt: 'cndt_trabalhista', cnib: 'cnib_indisponibilidade', protestos: 'protestos', djen: 'djen_comunicacoes' };

async function rodarFonte(secao, alvo) {
  if (secao === 'djen') return consultarComunicaDJEN(alvo?.numero_processo);
  if (secao === 'cndt') return consultarCNDT(alvo?.doc);
  if (secao === 'cnib') return consultarCNIB(alvo?.doc);
  if (secao === 'protestos') return consultarProtestos(alvo?.doc);
  return { ok: false, instavel: false, erro: 'seção desconhecida' };
}

// Mescla a seção resolvida no relatório jurídico do caso e tira de secoes_faltando.
async function mesclarNoRelatorio(caso_id, secao, dados) {
  try {
    const [rel] = await (await sb(`analise_relatorios?caso_id=eq.${caso_id}&tipo=eq.juridica_preliminar&order=versao.desc&limit=1&select=id,conteudo_json,secoes_faltando`)).json();
    if (!rel) return;
    const cj = rel.conteudo_json || {};
    cj[CAMPO[secao] || secao] = dados;
    const faltando = (rel.secoes_faltando || []).filter(s => s !== secao);
    cj.secoes_em_confirmacao = (cj.secoes_em_confirmacao || []).filter(s => s !== secao);
    await sb(`analise_relatorios?id=eq.${rel.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ conteudo_json: cj, secoes_faltando: faltando, incompleto: faltando.length > 0 }),
    });
  } catch { /* não bloqueia */ }
}

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase ausente' }), { status: 500 });

  const agora = new Date().toISOString();
  const r = await sb(`analise_pendencias?status=eq.pendente&proxima_tentativa=lte.${agora}&order=proxima_tentativa.asc&limit=25&select=*`);
  if (!r.ok) return new Response(JSON.stringify({ error: 'query falhou' }), { status: 500 });
  const pend = await r.json();

  let concluidas = 0, expiradas = 0, retentadas = 0;
  for (const p of pend) {
    const expirou = new Date(p.prazo).getTime() < Date.now();
    let res = null;
    try { res = await rodarFonte(p.secao, p.alvo); } catch { res = { ok: false, instavel: true, erro: 'exceção' }; }

    if (res?.ok) {
      await mesclarNoRelatorio(p.caso_id, p.secao, res.dados);
      await sb(`analise_pendencias?id=eq.${p.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'concluida', resultado: res.dados, tentativas: p.tentativas + 1, atualizado_em: new Date().toISOString() }) });
      concluidas++;
    } else if (expirou) {
      await sb(`analise_pendencias?id=eq.${p.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'expirada', ultimo_erro: res?.erro || 'prazo 48h', tentativas: p.tentativas + 1, atualizado_em: new Date().toISOString() }) });
      expiradas++;
    } else {
      // Backoff: próxima tentativa em ~3h (dentro do prazo de 48h).
      const prox = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
      await sb(`analise_pendencias?id=eq.${p.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'pendente', ultimo_erro: res?.erro || null, tentativas: p.tentativas + 1, proxima_tentativa: prox, atualizado_em: new Date().toISOString() }) });
      retentadas++;
    }
  }
  return new Response(JSON.stringify({ ok: true, processadas: pend.length, concluidas, expiradas, retentadas }), { headers: { 'Content-Type': 'application/json' } });
}
