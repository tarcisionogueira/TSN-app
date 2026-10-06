/**
 * POST /api/lote-manual — o LOTE INCLUÍDO À MÃO vira um lote de verdade (06/10, pedido do dono: "se eu anexei o
 * edital, matrícula e url do lote então armazene e deixe disponível para acessar posteriormente"; e "permitir a
 * mim e equipe enviar ao jurídico").
 *
 * Por quê: o lote manual vivia só com um id local (`tsn_…`). Tudo o que guarda documento e tudo o que o jurídico
 * lê (`imovel_anexos`, com FK para `imoveis_leilao`; upload-anexo; o painel "Documentos do leiloeiro"; o envio ao
 * jurídico) exige um imóvel da base. Em vez de duplicar essa máquina para um id que não existe, o lote passa a
 * EXISTIR: linha em `imoveis_leilao` com `fonte = 'MANUAL'` e `ativo = false` — fora da busca, fora dos monitores
 * de captura (todos filtram `ativo`), e protegido das duas limpezas de lotes inativos (elas poupam lote com análise).
 *
 * Body: { lote: { titulo, tipo, endereco, cidade, estado, valorMinimo, valorAvaliacao, areaM2, dataLeilao,
 *                 leiloeiro, modalidade, urlLote }, de_tsn?: 'tsn_…' }
 *  → cria o lote e, com `de_tsn`, MOVE as análises daquele id local (do próprio usuário) para o novo id.
 * Resposta: { ok, id }
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { dataBrParaIso } from './_data-br.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Teto por usuário: cada inclusão é uma linha no acervo. Generoso para uso real, barra script em laço.
const MAX_LOTES_POR_USUARIO = 300;

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
const txt = (v, n) => (v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, n) || null);
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
const TIPOS = ['casa', 'apartamento', 'terreno', 'comercial', 'rural', 'galpao', 'sala', 'loja'];

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const l = body?.lote || {};

  const titulo = txt(l.titulo, 180) || txt(l.endereco, 180);
  const cidade = txt(l.cidade, 80);
  if (!titulo || !cidade) return json({ error: 'Lote manual precisa de título/endereço e cidade.' }, 400);
  let urlLote = txt(l.urlLote, 500);
  if (urlLote && !/^https:\/\//i.test(urlLote)) urlLote = null;

  const prefixo = `manual_${user.id}_`;
  const rConta = await sb(`imoveis_leilao?fonte=eq.MANUAL&fonte_id=like.${encodeURIComponent(prefixo)}*&select=id&limit=${MAX_LOTES_POR_USUARIO + 1}`);
  if (!rConta.ok) return json({ error: `Não consegui verificar seus lotes (HTTP ${rConta.status}).` }, 502);
  if ((await rConta.json()).length > MAX_LOTES_POR_USUARIO) return json({ error: 'Limite de lotes manuais atingido. Fale com a equipe.' }, 429);

  const data = dataBrParaIso(l.dataLeilao);
  const row = {
    fonte: 'MANUAL', fonte_id: `${prefixo}${Date.now()}`, ativo: false,
    // A descrição diz o que o imóvel É: sem "casa"/"área construída" nela, o gatilho
    // `trg_tipo_lote_sem_construcao` rebaixa um título "Lote 06 - …" para TERRENO — e o mercado volta a
    // avaliar um lote vazio (medido em rollback, 06/10).
    titulo, descricao: txt([
      l.tipo && num(l.areaM2) && String(l.tipo).toLowerCase() !== 'terreno'
        ? `${String(l.tipo).charAt(0).toUpperCase()}${String(l.tipo).slice(1).toLowerCase()} com ${num(l.areaM2)} m² de área construída`
          + (num(l.areaTerrenoM2) ? ` em terreno de ${num(l.areaTerrenoM2)} m²` : '') + '.'
        : null,
      l.endereco,
    ].filter(Boolean).join(' '), 1000),
    tipo: TIPOS.includes(String(l.tipo || '').toLowerCase()) ? String(l.tipo).toLowerCase() : null,
    endereco: txt(l.endereco, 300), cidade, estado: txt(l.estado, 2)?.toUpperCase() || null,
    valor_minimo: num(l.valorMinimo), valor_avaliacao: num(l.valorAvaliacao), area_m2: num(l.areaM2),
    data_leilao: /^\d{4}-\d{2}-\d{2}$/.test(data || '') ? data : null,
    leiloeiro: txt(l.leiloeiro, 160),
    modalidade: ['judicial', 'extrajudicial'].includes(l.modalidade) ? l.modalidade : null,
    url_lote: urlLote,
  };
  const rIns = await sb('imoveis_leilao', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(row) });
  const [criado] = rIns.ok ? await rIns.json().catch(() => []) : [];
  if (!criado?.id) {
    const det = rIns.ok ? 'sem linha devolvida' : `HTTP ${rIns.status} ${(await rIns.text().catch(() => '')).slice(0, 160)}`;
    console.error('[lote-manual] insert', det);
    return json({ error: 'Não consegui registrar o lote.' }, 502);
  }

  // Análises feitas antes com o id local passam para o lote novo — só as DO PRÓPRIO usuário.
  const movidas = {};
  const deTsn = String(body?.de_tsn || '');
  if (/^tsn_[a-z0-9_]{4,60}$/i.test(deTsn)) {
    for (const t of ['analises_mercado', 'analises_documental', 'analises_laudo']) {
      const r = await sb(`${t}?user_id=eq.${user.id}&imovel_id=eq.${encodeURIComponent(deTsn)}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ imovel_id: criado.id }),
      });
      // `.select()` prova o que mudou (RLS/filtro que não alcança nada devolve 200 vazio).
      movidas[t] = r.ok ? (await r.json().catch(() => [])).length : `HTTP ${r.status}`;
      if (!r.ok) console.error('[lote-manual] mover', t, r.status);
    }
  }
  return json({ ok: true, id: criado.id, movidas });
}
