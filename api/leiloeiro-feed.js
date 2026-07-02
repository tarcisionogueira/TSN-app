export const config = { runtime: 'edge' };

import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbFetch(path, opts = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const ip = getIP(req);
  const rlIp = checkRateLimit(`leiloeiro-feed:ip:${ip}`, 30, 60_000);
  if (!rlIp.ok) return rateLimitedResponse(rlIp.resetAt);

  // Valida token Bearer — formato estrito (evita injeção no filtro PostgREST).
  const auth = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!auth) return json({ error: 'Token de autenticação obrigatório no header Authorization: Bearer TOKEN' }, 401);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(auth)) return json({ error: 'Token inválido' }, 401);

  const pr = await sbFetch(`leiloeiros_parceiros?token=eq.${encodeURIComponent(auth)}&status=eq.ativo&select=id,nome&limit=1`);
  if (!pr.ok) return json({ error: 'Erro interno' }, 500);
  const lista = await pr.json();
  if (!lista.length) return json({ error: 'Token inválido ou parceiro inativo' }, 401);

  const parceiro = lista[0];

  const rlToken = checkRateLimit(`leiloeiro-feed:token:${parceiro.id}`, 60, 60_000);
  if (!rlToken.ok) return rateLimitedResponse(rlToken.resetAt);

  const fonte = `parceiro_${parceiro.id}`;

  let lotes;
  try { lotes = await req.json(); } catch { return json({ error: 'Corpo da requisição deve ser JSON válido' }, 400); }
  if (!Array.isArray(lotes)) lotes = [lotes];
  if (lotes.length === 0) return json({ error: 'Lista de lotes vazia' }, 400);
  if (lotes.length > 500) return json({ error: 'Máximo 500 lotes por requisição' }, 400);

  const agora = new Date().toISOString();
  // Mapeia para as colunas REAIS de imoveis_leilao (mesmo catálogo dos scrapers),
  // para o imóvel do parceiro aparecer na busca. Nomes de coluna conferidos no
  // schema: tipo, url_lote, link_foto, desconto_percentual (não tipo_imovel/fotos).
  const validos = lotes
    .filter(l => l.id || l.codigo)
    .map(l => {
      const fotos = Array.isArray(l.fotos) ? l.fotos.filter(Boolean) : [];
      return {
        fonte,
        fonte_id: `${fonte}_${l.id || l.codigo}`,
        leiloeiro: String(parceiro.nome || '').slice(0, 200),
        titulo: String(l.titulo || l.descricao || '').slice(0, 500),
        descricao: String(l.descricao || '').slice(0, 5000),
        tipo: String(l.tipo || l.tipo_imovel || '').slice(0, 100),
        endereco: String(l.endereco || '').slice(0, 500),
        bairro: String(l.bairro || '').slice(0, 200),
        cidade: String(l.cidade || l.municipio || '').slice(0, 100),
        estado: String(l.estado || l.uf || '').slice(0, 2).toUpperCase() || null,
        cep: String(l.cep || '').replace(/\D/g, '').slice(0, 8) || null,
        valor_avaliacao: Number(l.valor_avaliacao || l.avaliacao || 0) || null,
        valor_minimo: Number(l.valor_minimo || l.lance_minimo || 0) || null,
        desconto_percentual: Math.round(Number(l.desconto || 0)) || null,
        modalidade: String(l.modalidade || '').slice(0, 100),
        data_leilao: l.data_leilao ? String(l.data_leilao).slice(0, 40) : null,
        url_lote: String(l.link || l.url || '').slice(0, 1000),
        link_foto: fotos[0] ? String(fotos[0]).slice(0, 1000) : null,
        ativo: l.ativo !== false,
        atualizado_em: agora,
      };
    });

  if (!validos.length) return json({ error: 'Nenhum lote válido — campo "id" ou "codigo" obrigatório em cada item' }, 400);

  const ur = await sbFetch('imoveis_leilao?on_conflict=fonte,fonte_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(validos),
  });

  if (!ur.ok) {
    const err = await ur.text().catch(() => '');
    return json({ error: 'Erro ao salvar lotes', detalhe: err.slice(0, 300) }, 500);
  }

  return json({ ok: true, parceiro: parceiro.nome, recebidos: lotes.length, processados: validos.length });
}
