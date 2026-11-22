/**
 * /api/admin-ig-gatilhos — a tela /admin/instagram cadastra os gatilhos de palavra-chave.
 * GET  → { gatilhos, disparos (últimos 30), posts (últimos 24 do perfil), conta: {ok, motivo} }
 *        `conta.ok` é a PROVA de que o token de envio ainda vale (ele expira em ~60 dias): sem ele,
 *        o gatilho casa e o direct é recusado — melhor a tela avisar antes do primeiro comentário.
 * POST { acao: 'salvar', gatilho: {...} }  → cria (sem id) ou atualiza (com id)
 * POST { acao: 'ativar', id, ativo }       → liga/desliga (não apagamos: o log de disparos fica)
 * Só admin.
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };

import { getUser } from './_auth.js';
import { GRAPH_VERSION } from './_instagram-envio.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

async function postsRecentes() {
  const id = process.env.IG_USER_ID;
  const token = process.env.IG_PAGE_TOKEN;
  if (!id || !token) return { ok: false, motivo: 'IG_USER_ID/IG_PAGE_TOKEN ausentes na Vercel', posts: [] };
  try {
    const url = `https://graph.instagram.com/${GRAPH_VERSION}/${id}/media?fields=id,caption,permalink,timestamp,media_type,thumbnail_url,media_url&limit=24`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    const j = await r.json().catch(() => null);
    if (!r.ok) return { ok: false, motivo: `Meta recusou o token (${r.status}): ${j?.error?.message || 'sem detalhe'}`, posts: [] };
    if (!Array.isArray(j?.data)) return { ok: false, motivo: 'resposta da Meta sem lista de posts', posts: [] };
    return {
      ok: true, motivo: null,
      posts: j.data.map((p) => ({
        id: p.id, legenda: String(p.caption || '').slice(0, 140), link: p.permalink, quando: p.timestamp,
        capa: p.media_type === 'VIDEO' ? p.thumbnail_url : p.media_url,
      })),
    };
  } catch (e) {
    return { ok: false, motivo: `não consegui falar com a Meta: ${e?.message || e}`, posts: [] };
  }
}

export function validarGatilho(g) {
  const palavra = String(g?.palavra || '').trim();
  const mensagem = String(g?.mensagem_dm || '').trim();
  if (palavra.length < 2 || palavra.length > 40) return 'A palavra precisa ter de 2 a 40 letras.';
  if (mensagem.length < 5) return 'Escreva a mensagem que vai no direct.';
  if (mensagem.length > 900) return 'A mensagem do direct passou de 900 caracteres.';
  const link = String(g?.link || '').trim();
  if (link && !/^https?:\/\/\S+$/i.test(link)) return 'O link precisa começar com http:// ou https://';
  return null;
}

export default async function handler(req, res) {
  if (!SB || !SVC) return res.status(500).json({ error: 'Supabase não configurado' });
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  try {
    const [perfil] = (await sb('GET', `perfis?id=eq.${user.id}&select=role`)) || [];
    if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });

    if (req.method === 'GET') {
      const [gatilhos, disparos, conta] = await Promise.all([
        sb('GET', 'ig_gatilhos?select=*&order=ativo.desc,criado_em.desc'),
        sb('GET', 'ig_gatilho_disparos?select=id,gatilho_id,status,erro,criado_em,ig_user_id&order=criado_em.desc&limit=30'),
        postsRecentes(),
      ]);
      return res.status(200).json({ gatilhos: gatilhos || [], disparos: disparos || [], posts: conta.posts, conta: { ok: conta.ok, motivo: conta.motivo } });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
    const { acao } = req.body || {};

    if (acao === 'ativar') {
      const id = Number(req.body.id);
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'id inválido' });
      const r = await sb('PATCH', `ig_gatilhos?id=eq.${id}`, { ativo: !!req.body.ativo, atualizado_em: new Date().toISOString() }, 'return=representation');
      if (!r?.length) return res.status(404).json({ error: 'Gatilho não encontrado' });
      return res.status(200).json({ ok: true, gatilho: r[0] });
    }

    if (acao === 'salvar') {
      const g = req.body.gatilho || {};
      const erro = validarGatilho(g);
      if (erro) return res.status(400).json({ error: erro });
      const publicas = (Array.isArray(g.respostas_publicas) ? g.respostas_publicas : String(g.respostas_publicas || '').split('\n'))
        .map((s) => String(s).trim()).filter(Boolean).slice(0, 12);
      const linha = {
        palavra: String(g.palavra).trim(),
        media_id: g.media_id ? String(g.media_id) : null,
        media_legenda: g.media_id ? String(g.media_legenda || '').slice(0, 140) : null,
        mensagem_dm: String(g.mensagem_dm).trim(),
        link: String(g.link || '').trim() || null,
        valido_ate: g.valido_ate || null,
        atualizado_em: new Date().toISOString(),
        ...(publicas.length ? { respostas_publicas: publicas } : {}),
      };
      const r = g.id
        ? await sb('PATCH', `ig_gatilhos?id=eq.${Number(g.id)}`, linha, 'return=representation')
        : await sb('POST', 'ig_gatilhos', linha, 'return=representation');
      if (!r?.length) return res.status(404).json({ error: 'Gatilho não encontrado' });
      return res.status(200).json({ ok: true, gatilho: r[0] });
    }
    return res.status(400).json({ error: 'acao desconhecida' });
  } catch (e) {
    console.error('[admin-ig-gatilhos]', e?.message || e);
    return res.status(500).json({ error: String(e?.message || e).slice(0, 200) });
  }
}
