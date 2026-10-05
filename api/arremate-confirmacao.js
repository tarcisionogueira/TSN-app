/**
 * /api/arremate-confirmacao — fila da EQUIPE para confirmar ou recusar arremates (05/10, #34).
 *
 * Decisões do dono: o cliente DECLARA ("Arrematei"); a equipe (admin/analista) confirma quando há
 * COMPROVANTE anexado ao lote (auto de arrematação, carta de arrematação ou comprovante de
 * pagamento) ou recusa com motivo. Confirmado vira registro do negócio — o cliente não apaga mais
 * (política de delete em `arrematados`). Recusado: o cliente vê o motivo e pode remover o registro,
 * o que libera o lote (um arrematante por lote).
 *
 * GET  → declarados pendentes (+ comprovantes com link assinado de 10 min e o resultado apurado do
 *        leilão, para conferir o valor declarado).
 * POST { arrematado_id, acao: 'confirmar'|'recusar', motivo? }
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const ROLES_EQUIPE = ['admin', 'analista'];
const TIPOS_COMPROVANTE = ['auto_arrematacao', 'carta_arrematacao', 'comprovante_pagamento'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': APP_ORIGIN } });
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}
async function assinar(storagePath) {
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/documentos/${storagePath}`, {
      method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 600 }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.signedURL ? `${SUPABASE_URL}/storage/v1${j.signedURL}` : null;
  } catch { return null; } // padrao-ok: sem link o comprovante aparece listado pelo nome; a equipe reabre
}
async function comprovantesDe(imovelIds) {
  const ids = imovelIds.filter((i) => UUID_RE.test(i || ''));
  if (!ids.length) return [];
  return ler(`imovel_anexos?imovel_id=in.(${ids.join(',')})&tipo=in.(${TIPOS_COMPROVANTE.join(',')})&select=id,imovel_id,tipo,nome,storage_path,url,criado_em&order=criado_em.desc`);
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' } });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'Configuração ausente' }, 500);
  const user = await getUser(req);
  if (!user) return unauthorized();
  const rp = await sb(`perfis?id=eq.${user.id}&select=role&limit=1`);
  if (!rp.ok) return json({ error: 'Não foi possível verificar seu acesso agora.' }, 502);
  const [perfil] = await rp.json().catch(() => []);
  if (!ROLES_EQUIPE.includes(perfil?.role)) return json({ error: 'Exclusivo do administrador e da equipe de análise.' }, 403);

  try {
    if (req.method === 'GET') {
      const arr = await ler('arrematados?select=id,user_id,imovel_id,titulo,cidade,estado,valor_arrematacao,data_arrematacao,created_at&order=created_at.asc&limit=200');
      const conf = arr.length ? await ler(`arremate_confirmacao?arrematado_id=in.(${arr.map((a) => a.id).join(',')})&select=arrematado_id`) : [];
      const decididos = new Set(conf.map((c) => c.arrematado_id));
      const pend = arr.filter((a) => !decididos.has(a.id));
      if (!pend.length) return json({ ok: true, pendentes: [] });
      const userIds = [...new Set(pend.map((a) => a.user_id))];
      const imovIds = [...new Set(pend.map((a) => a.imovel_id).filter((i) => UUID_RE.test(i || '')))];
      const [perfis, imoveis, comps] = await Promise.all([
        ler(`perfis?id=in.(${userIds.join(',')})&select=id,nome`),
        imovIds.length ? ler(`imoveis_leilao?id=in.(${imovIds.join(',')})&select=id,resultado_leilao,valor_lance_vencedor,valor_minimo,fonte`) : [],
        comprovantesDe(imovIds),
      ]);
      const nome = Object.fromEntries(perfis.map((p) => [p.id, p.nome]));
      const imov = Object.fromEntries(imoveis.map((i) => [i.id, i]));
      const pendentes = [];
      for (const a of pend) {
        const cs = comps.filter((c) => c.imovel_id === a.imovel_id);
        const comprovantes = await Promise.all(cs.slice(0, 5).map(async (c) => ({ id: c.id, tipo: c.tipo, nome: c.nome, url: c.storage_path ? await assinar(c.storage_path) : c.url })));
        pendentes.push({ ...a, cliente: nome[a.user_id] || null, leilao: imov[a.imovel_id] || null, comprovantes });
      }
      return json({ ok: true, pendentes });
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const id = String(body?.arrematado_id || '');
    const acao = body?.acao;
    const motivo = String(body?.motivo || '').trim().slice(0, 500);
    if (!UUID_RE.test(id) || !['confirmar', 'recusar'].includes(acao)) return json({ error: 'arrematado_id e acao (confirmar|recusar) obrigatórios' }, 400);
    if (acao === 'recusar' && !motivo) return json({ error: 'Informe o motivo da recusa — o cliente vai ver.' }, 400);
    const [a] = await ler(`arrematados?id=eq.${id}&select=id,user_id,imovel_id,titulo,valor_arrematacao&limit=1`);
    if (!a) return json({ error: 'Arremate não encontrado' }, 404);

    if (acao === 'confirmar') {
      const [comp] = await comprovantesDe([a.imovel_id]);
      if (!comp) return json({ error: 'Sem comprovante anexado ao lote (auto, carta de arrematação ou comprovante de pagamento). Peça ao cliente para anexar em Meus Arrematados → Documentos.' }, 422);
      const r = await sb('arremate_confirmacao', { method: 'POST', headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify({ arrematado_id: id, status: 'confirmado', por: user.id, em: new Date().toISOString(), motivo: motivo || null, comprovante_anexo_id: comp.id }) });
      const [ok] = r.ok ? await r.json().catch(() => []) : [];
      if (!ok) return json({ error: `Não gravei a confirmação (HTTP ${r.status}).` }, 502);
    } else {
      // Recusa: fica registrada COM o motivo — o cliente vê em Meus Arrematados e pode remover o
      // registro (não confirmado = removível), o que libera o lote para quem de fato arrematou.
      const r = await sb('arremate_confirmacao', { method: 'POST', headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
        body: JSON.stringify({ arrematado_id: id, status: 'recusado', por: user.id, em: new Date().toISOString(), motivo }) });
      const [ok] = r.ok ? await r.json().catch(() => []) : [];
      if (!ok) return json({ error: `Não gravei a recusa (HTTP ${r.status}).` }, 502);
    }
    await sb('rpc/registrar_atividade', { method: 'POST', body: JSON.stringify({
      p_user_id: a.user_id, p_evento: acao === 'confirmar' ? 'arremate_confirmado' : 'arremate_recusado',
      p_detalhe: `${acao === 'confirmar' ? 'Arremate confirmado pela equipe' : `Arremate recusado pela equipe: ${motivo}`}${a.titulo ? ` · ${String(a.titulo).slice(0, 80)}` : ''}`,
      p_meta: { arrematado_id: id, imovel_id: a.imovel_id, por: user.id } }) }).catch((e) => console.error('[arremate-confirmacao] atividade:', e?.message));
    return json({ ok: true, acao });
  } catch (e) {
    console.error('[arremate-confirmacao]', String(e?.message || e).slice(0, 200));
    return json({ error: 'Falha ao processar: ' + String(e?.message || e).slice(0, 120) }, 500);
  }
}
