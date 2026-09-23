-- ─────────────────────────────────────────────────────────────────────────────────────────
-- chamados_mensagens aceita autor_tipo = 'sistema' — 23/09/2026
--
-- `api/inbound-juridico.js` grava e-mail de remetente INTERNO (o dono testando, no-reply@,
-- notifications@ — `remetenteInterno()`) como autor_tipo='sistema', de propósito: as
-- métricas (`tempo_processo`, `cliente_travou`) contam só 'cliente' como "o cliente falou",
-- e notificação automática não pode inflar chamado-sem-resposta. A tela já sabe exibir
-- (`isSistema` em Atendimento.jsx). Mas a CHECK só aceitava cliente/atendente/ia: o insert
-- dava 23514, o chamado nascia VAZIO e o webhook devolvia 500 — o Resend reentregando a
-- mesma mensagem. Achado no 1º teste real da caixa de e-mail (23/09, 14:48): chamado
-- "[TESTE]…" com 0 mensagens e dois 500 no log.
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.chamados_mensagens drop constraint if exists chamados_mensagens_autor_tipo_check;
alter table public.chamados_mensagens add constraint chamados_mensagens_autor_tipo_check
  check (autor_tipo = any (array['cliente','atendente','ia','sistema']));
