-- ============================================================================
-- BACKFILL: lead sem vínculo de conta e sem telefone (16/08)
--
-- Descoberto rastreando uma simulação de interesse feita pelo próprio dono na tela
-- de Alavancagem. O fluxo funcionou por fora — lead gravado, chamado aberto com
-- `user_id`, aviso entregue à equipe — e mesmo assim entregou um lead inutilizável:
--
--   • `whatsapp` NULL, com o telefone preenchido no perfil o tempo todo. A tela lê
--     `perfis.telefone` no navegador e reenvia no corpo; falhando essa leitura, o
--     estado vira `{}`, o botão continua habilitado e o lead nasce sem número. O
--     e-mail para a equipe saiu dizendo "WhatsApp: não informado" — e o contato em
--     UM clique, que é a razão de existir daquele e-mail, morreu em silêncio.
--   • `user_id` NULL. O CHAMADO já gravava o vínculo; o LEAD, não. A mesma pessoa
--     aparecia como cliente numa tela e como estranho na outra, e o Cliente 360 não
--     conseguia cruzar interesse com conta.
--
-- A correção de código está em `api/duvida.js`: com o token na mão o servidor busca
-- o telefone com a service key em vez de acreditar no cliente, e grava `user_id` no
-- lead como já fazia no chamado. Este arquivo conserta o que já estava gravado.
--
-- Casa por E-MAIL com uma conta existente — o mesmo critério que o endpoint usa para
-- deduplicar lead. Só preenche o que está vazio (`coalesce`), nunca sobrescreve dado
-- informado pelo interessado. Idempotente.
-- ============================================================================

update public.sdr_leads l
   set user_id  = u.id,
       whatsapp = coalesce(l.whatsapp, p.telefone)
  from auth.users u
  join public.perfis p on p.id = u.id
 where l.user_id is null
   and lower(u.email) = lower(l.email);
