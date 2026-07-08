/**
 * POST /api/leiloeiro-webhook
 * Recebe lotes de leiloeiros parceiros via API key.
 *
 * Headers: X-Leiloeiro-Key: <chave gerada no portal>  (GET e POST)
 * Actions: upsert_lote, fechar_lote
 * GET    : listar_lotes (chave SEMPRE no header X-Leiloeiro-Key, nunca na URL)
 */

export const config = { runtime: 'edge' };

import { normalizarTipo } from './_tipo.js';
import { normalizarModalidade } from './_modalidade.js';

const SUPABASE  = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC_KEY   = process.env.SUPABASE_SERVICE_KEY;

async function sb(method, path, body) {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SVC_KEY,
      Authorization: `Bearer ${SVC_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation,resolution=merge-duplicates' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(t);
  }
  return res.status === 204 ? null : res.json();
}

async function resolverLeiloeiro(key) {
  const rows = await sb('GET', `perfis?leiloeiro_webhook_key=eq.${encodeURIComponent(key)}&role=eq.leiloeiro&select=id,nome,ativo&limit=1`);
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p || !p.ativo) return null;
  return p;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);

  // GET: listar lotes — chave SÓ no header (nunca ?key= na URL, que vaza em
  // logs/CDN/Referer). Parceiros que pollavam via ?key= devem migrar para o header.
  if (req.method === 'GET') {
    const key = req.headers.get('x-leiloeiro-key') || '';
    if (!key) return json({ error: 'Header X-Leiloeiro-Key obrigatório' }, 401);
    const leiloeiro = await resolverLeiloeiro(key);
    if (!leiloeiro) return json({ error: 'Chave inválida ou conta inativa' }, 401);
    // Lotes ficam no catálogo único imoveis_leilao (fonte=webhook_<id>) para
    // aparecerem na busca junto com as demais fontes.
    const fonte = `webhook_${leiloeiro.id}`;
    const lotes = await sb('GET', `imoveis_leilao?fonte=eq.${encodeURIComponent(fonte)}&ativo=eq.true&order=data_leilao.asc`);
    return json({ lotes: lotes || [] });
  }

  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const key = req.headers.get('x-leiloeiro-key') || '';
  if (!key) return json({ error: 'Header X-Leiloeiro-Key obrigatório' }, 401);

  const leiloeiro = await resolverLeiloeiro(key);
  if (!leiloeiro) return json({ error: 'Chave inválida ou conta inativa' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }

  const { action, lote } = body;

  if (!action || typeof action !== 'string') return json({ error: 'action obrigatório' }, 400);
  if (!['upsert_lote', 'fechar_lote'].includes(action)) return json({ error: `Action desconhecida: ${action}` }, 400);
  if (!lote || typeof lote !== 'object' || Array.isArray(lote)) return json({ error: 'lote deve ser um objeto' }, 400);

  try {
    const fonte = `webhook_${leiloeiro.id}`;

    if (action === 'upsert_lote') {
      if (!lote?.id_externo) return json({ error: 'id_externo obrigatório' }, 400);
      // Grava no catálogo único imoveis_leilao (mesmas colunas dos scrapers/feed),
      // com fonte=webhook_<id> — assim o lote do parceiro entra na busca pública.
      const av = lote.valor_avaliacao ? Number(lote.valor_avaliacao) : null;
      const mn = lote.valor_minimo ? Number(lote.valor_minimo) : null;
      // Desconto derivado (senão o lote afunda na ordenação por desconto_percentual da busca).
      const desconto = lote.desconto ? Math.round(Number(lote.desconto)) : ((av && mn && mn < av) ? Math.round((1 - mn / av) * 100) : null);
      const row = {
        fonte,
        fonte_id:        `${fonte}_${String(lote.id_externo).slice(0, 200)}`,
        leiloeiro:       leiloeiro.nome ? String(leiloeiro.nome).slice(0, 200) : null,
        titulo:          lote.titulo ? String(lote.titulo).slice(0, 500) : null,
        // Normaliza p/ o conjunto canônico — o parceiro pode mandar "Fazenda",
        // "Galpão Industrial", "APTO" etc., que sem normalizar sumiriam da busca.
        tipo:            normalizarTipo(lote.tipo),
        endereco:        lote.endereco ? String(lote.endereco).slice(0, 500) : null,
        cidade:          lote.cidade ? String(lote.cidade).slice(0, 100) : null,
        estado:          lote.estado ? String(lote.estado).slice(0, 2).toUpperCase() : null,
        valor_avaliacao: av,
        valor_minimo:    mn,
        desconto_percentual: desconto,
        area_m2:         lote.area_m2         ? Number(lote.area_m2)         : null,
        data_leilao:     lote.data_leilao ? String(lote.data_leilao).slice(0, 40) : null,
        // Normaliza ao conjunto canônico (venda_direta/licitacao_aberta/judicial/
        // extrajudicial) — parceiro pode mandar "Judicial"/"Leilão Extrajudicial" cru.
        modalidade:      normalizarModalidade(lote.modalidade),
        url_lote:        lote.url_lote ? String(lote.url_lote).slice(0, 1000) : null,
        descricao:       lote.descricao ? String(lote.descricao).slice(0, 5000) : null,
        ativo:           true,
        atualizado_em:   new Date().toISOString(),
      };
      const result = await sb('POST', 'imoveis_leilao?on_conflict=fonte,fonte_id', row);
      return json({ ok: true, id: Array.isArray(result) ? result[0]?.id : result?.id });
    }

    if (action === 'fechar_lote') {
      if (!lote?.id_externo) return json({ error: 'id_externo obrigatório' }, 400);
      // Fechar = tirar da busca (ativo=false) no catálogo único.
      const fonteId = `${fonte}_${String(lote.id_externo).slice(0, 200)}`;
      await fetch(`${SUPABASE}/rest/v1/imoveis_leilao?fonte=eq.${encodeURIComponent(fonte)}&fonte_id=eq.${encodeURIComponent(fonteId)}`, {
        method: 'PATCH',
        headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ ativo: false, atualizado_em: new Date().toISOString() }),
      });
      return json({ ok: true });
    }

    return json({ error: `Action desconhecida: ${action}` }, 400);
  } catch (err) {
    console.error('[leiloeiro-webhook]', err.message);
    return json({ error: err.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
