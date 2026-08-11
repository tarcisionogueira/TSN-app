/**
 * GET /api/clique — registra o clique num link de e-mail e redireciona para o destino.
 *
 * Contrato inegociável: **a pessoa chega no destino de qualquer jeito**. Registro é
 * best-effort; redirecionamento é obrigatório. Um erro de banco nosso não pode transformar
 * o e-mail de campanha num link quebrado na mão do cliente — por isso o `catch` engole a
 * falha de gravação e segue para o 302, e por isso o destino é montado ANTES de qualquer
 * escrita. Perder a medição de um clique é aceitável; perder o clique não é.
 *
 * Assinatura inválida também redireciona: quem clicou não tem culpa de um link truncado
 * pelo cliente de e-mail. Só não conta a métrica. (Ver `_link-email.js` para por que o
 * destino é sempre interno — não existe open redirect aqui.)
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

import { conferirClique, decodificarClique, BASE_EMAIL } from './_link-email.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const sb = (path, opts = {}) => fetch(`${SB_URL}/rest/v1/${path}`, {
  ...opts,
  headers: {
    apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json', ...(opts.headers || {}),
  },
  signal: AbortSignal.timeout(4000),
});

export default async function handler(req, res) {
  const { u, t, p, s } = req.query || {};
  const { userId, caminho } = decodificarClique(u, p);
  const tipo = String(t || '').slice(0, 40);

  // Caminho tem de ser INTERNO. '//evil.com' é URL absoluta disfarçada de caminho.
  const seguro = caminho.startsWith('/') && !caminho.startsWith('//');
  const destino = seguro ? `${BASE_EMAIL}${caminho}` : BASE_EMAIL;

  if (userId && seguro && conferirClique(userId, tipo, caminho, s)) {
    try {
      const agora = new Date().toISOString();
      await Promise.all([
        // 1. Carimba o e-mail mais recente deste tipo que ainda não tinha clique. É o que
        //    faz `emails_log.clicado_em` deixar de ser sempre nulo — a coluna existe desde
        //    sempre e nunca foi preenchida, porque só o webhook do Resend a alimentava.
        sb(`emails_log?user_id=eq.${encodeURIComponent(userId)}&tipo=eq.${encodeURIComponent(tipo)}` +
           `&clicado_em=is.null&order=enviado_em.desc&limit=1`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ clicado_em: agora }),
        }),
        // 2. E entra no Cliente 360, que é o ponto: o clique passa a viver ao lado do resto
        //    do que a pessoa fez, e não num painel separado de terceiro.
        sb('atividade_log', {
          method: 'POST',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({
            user_id: userId,
            evento: 'email_clique',
            detalhe: tipo,
            meta: { tipo, destino: caminho.slice(0, 300) },
          }),
        }),
      ]);
    } catch { /* medição é best-effort; o redirecionamento abaixo não é */ }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.redirect(302, destino);
}
