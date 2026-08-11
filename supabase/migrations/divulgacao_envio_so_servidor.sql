-- `divulgacao_envio` é escrita SÓ pelo cron (api/divulgacao-cron.js, service_role) — é o
-- ledger de "já divulguei este produto para esta pessoa", com UNIQUE que impede repetir.
-- Ela tinha RLS ligada e NENHUMA policy (ou seja, ninguém lê nem escreve via PostgREST),
-- mas continuava com os GRANTs padrão do Supabase: anon e authenticated com INSERT,
-- UPDATE, DELETE e TRUNCATE.
--
-- Hoje isso não é explorável — sem policy, a RLS barra tudo. Mas o privilégio sobrando é
-- o que a `auditoria_uso` acusa, e ela está certa em acusar: uma linha de policy criada
-- por engano no futuro passaria a valer sobre um GRANT que ninguém lembrava que existia.
--
-- O check oferecia duas saídas: allowlist ou política de escrita. Nenhuma das duas serve
-- aqui — a tabela não é do usuário. Tirar o privilégio é a terceira, e é a correta:
-- resolve o alerta E reduz superfície, em vez de só calar o alarme.
revoke all on public.divulgacao_envio from anon, authenticated;

comment on table public.divulgacao_envio is
  'Ledger de divulgacao por (user_id, tipo, produto_id). SO-SERVIDOR: escrito pelo '
  'divulgacao-cron com service_role. anon/authenticated sem privilegio algum (11/08).';
