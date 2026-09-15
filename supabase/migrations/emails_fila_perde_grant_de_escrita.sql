-- 15/09 — `emails_fila` (fila do orçamento diário do Resend, 20260913_emails_fila_orcamento_diario.sql)
-- tem RLS ligada e NENHUMA policy — só service_role acessa via api/_email.js e
-- api/drenar-fila-emails-cron.js — mas ficou com os GRANTs padrão do Supabase: anon e
-- authenticated com INSERT, UPDATE, DELETE e TRUNCATE. Sem policy a RLS já barra tudo, mas
-- o privilégio sobrando é o que `auditoria_uso()` acusa (health-check: "RLS de escrita do
-- usuário"), e está certa em acusar — mesmo padrão já resolvido em `divulgacao_envio` e nas
-- seis tabelas de `tabelas_so_do_servidor_perdem_o_grant_de_escrita.sql`: allowlist deixaria
-- o privilégio no lugar e só calaria o aviso; revogar resolve o alerta E reduz superfície.
-- Sem uso client-side algum (nenhuma referência a emails_fila em src/).
revoke all on public.emails_fila from anon, authenticated;

comment on table public.emails_fila is
  'Fila de e-mails represados pelo orçamento diário do Resend. SO-SERVIDOR: escrito/lido '
  'por api/_email.js e api/drenar-fila-emails-cron.js com service_role. anon/authenticated '
  'sem privilegio algum (15/09).';
