/**
 * Script EXTERNO do redirecionamento usado por api/og-share.js.
 *
 * POR QUE ISTO EXISTE (achado do dono, 21/09 — no link de assinatura de contrato que acabara
 * de gerar, mesmo defeito já visto antes no link de live/aula): a CSP global (vercel.json,
 * `script-src`) só libera SEM hash os scripts EXTERNOS de `'self'` + uma lista de domínios; um
 * <script> INLINE só passa se o hash bater com um dos 3 fixos do index.html. O redirecionamento
 * de `og-share.js` era inline e o CONTEÚDO muda a cada request (token/slug diferentes) — nunca
 * bate hash nenhum, e o navegador BLOQUEIA a execução em silêncio. A pessoa ficava vendo
 * "Redirecionando…" parado, com o link manual "continuar" como único jeito de seguir — em TODO
 * link compartilhado (contrato, testemunha, imóvel, curso/ebook, aula ao vivo, indicação), não
 * só na live. Servido como ARQUIVO (Content-Type: application/javascript): 'self' já cobre,
 * sem precisar de hash — os parâmetros variáveis vão na query string, não no corpo do script.
 */
export const config = { runtime: 'edge' };

export default function handler(req) {
  const u = new URL(req.url);
  const publico = u.searchParams.get('publico') || '/';
  const app = u.searchParams.get('app') || '';
  // Só o caso /i/<id> (imóvel) decide entre app/público conforme sessão salva no navegador —
  // os demais tipos sempre têm um único destino. Mesma lógica que já existia inline em
  // og-share.js, só movida pra arquivo externo (comportamento idêntico).
  const js = app ? `(function () {
  var app = ${JSON.stringify(app)}, publico = ${JSON.stringify(publico)}, logado = false;
  try {
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || !/^sb-.+-auth-token$/.test(k)) continue;
      var s = JSON.parse(localStorage.getItem(k) || 'null');
      var exp = s && (s.expires_at || (s.currentSession && s.currentSession.expires_at));
      if (s && (!exp || Number(exp) * 1000 > Date.now())) { logado = true; break; }
    }
  } catch (e) { /* storage bloqueado (aba privada): trata como visitante */ }
  location.replace(logado ? app : publico);
})();` : `location.replace(${JSON.stringify(publico)});`;

  return new Response(js, {
    status: 200,
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=600' },
  });
}
