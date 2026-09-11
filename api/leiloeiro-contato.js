/**
 * /api/leiloeiro-contato  (admin/analista)
 * CRUD do e-mail de contato por leiloeiro (fonte -> email), usado para disparar o pedido de
 * documentos (api/pedir-documento-leiloeiro.js). A maior parte das linhas nasce sozinha via
 * captura automática no scraper (scripts/_contato-leiloeiro.mjs, origem='auto'); esta tela é
 * SÓ para corrigir quando o e-mail capturado vier errado — qualquer edição aqui grava
 * origem='manual', e a captura automática nunca mais sobrescreve depois disso.
 *  GET    -> lista (fontes conhecidas cruzadas com o contato, quando existir)
 *  POST   -> upsert { fonte, email }  (sempre origem='manual')
 *  DELETE -> { fonte }  (volta a fonte para "sem contato" — a próxima coleta pode recapturar)
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ROLES = ['admin', 'analista'];

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

export default async function handler(req) {
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const rPerfil = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!rPerfil.ok) return json({ error: 'Falha ao verificar permissão' }, 502);
  const [perfil] = await rPerfil.json();
  if (!perfil || !ROLES.includes(perfil.role)) return json({ error: 'Apenas admin/analista' }, 403);

  if (req.method === 'GET') {
    const [rContatos, rFontes] = await Promise.all([
      sb('leiloeiro_contato?select=*&order=fonte.asc'),
      // Cruza com as fontes CONHECIDAS (mesmo cadastro que já existe hoje) para a tela mostrar
      // também quem ainda não tem contato nenhum — sem isso, "sem contato" seria invisível.
      sb('leiloeiro_conhecimento?select=fonte,plataforma&order=fonte.asc'),
    ]);
    if (!rContatos.ok || !rFontes.ok) return json({ error: 'Falha ao ler contatos' }, 502);
    const [contatos, fontes] = await Promise.all([rContatos.json(), rFontes.json()]);
    const porFonte = new Map((Array.isArray(contatos) ? contatos : []).map(c => [c.fonte, c]));
    const lista = (Array.isArray(fontes) ? fontes : []).map(f => ({
      fonte: f.fonte, plataforma: f.plataforma || null,
      email: porFonte.get(f.fonte)?.email || null,
      origem: porFonte.get(f.fonte)?.origem || null,
      observacao: porFonte.get(f.fonte)?.observacao || null,
      atualizado_em: porFonte.get(f.fonte)?.atualizado_em || null,
    }));
    // Fontes com contato mas que não estão em leiloeiro_conhecimento (não deveria acontecer,
    // mas não pode desaparecer da tela se acontecer).
    for (const c of (Array.isArray(contatos) ? contatos : [])) {
      if (!lista.some(l => l.fonte === c.fonte)) lista.push({ fonte: c.fonte, plataforma: null, email: c.email, origem: c.origem, observacao: c.observacao, atualizado_em: c.atualizado_em });
    }
    lista.sort((a, b) => a.fonte.localeCompare(b.fonte));
    return json({ contatos: lista });
  }

  if (req.method === 'POST') {
    let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const fonte = String(b?.fonte || '').trim().toUpperCase();
    const email = String(b?.email || '').trim().toLowerCase();
    if (!fonte) return json({ error: 'fonte obrigatória' }, 400);
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'E-mail inválido' }, 400);
    const r = await sb('leiloeiro_contato?on_conflict=fonte', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
      body: { fonte, email, origem: 'manual', observacao: `ajustado manualmente por ${perfil.role} em ${new Date().toISOString().slice(0, 10)}`, atualizado_em: new Date().toISOString() },
    });
    if (!r.ok) return json({ error: 'Falha ao salvar' }, 502);
    return json({ ok: true });
  }

  if (req.method === 'DELETE') {
    let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
    const fonte = String(b?.fonte || '').trim().toUpperCase();
    if (!fonte) return json({ error: 'fonte obrigatória' }, 400);
    await sb(`leiloeiro_contato?fonte=eq.${encodeURIComponent(fonte)}`, { method: 'DELETE', prefer: 'return=minimal' });
    return json({ ok: true });
  }

  return new Response('Method Not Allowed', { status: 405 });
}
