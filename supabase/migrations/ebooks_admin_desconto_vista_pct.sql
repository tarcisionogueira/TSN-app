-- 02/09: a tela de Produtos do /admin manda `desconto_vista_pct` para as TRES tabelas
-- (planos_config, cursos_admin, ebooks_admin), mas so o ebook nao tinha a coluna. O
-- PostgREST devolvia 400 "Could not find the 'desconto_vista_pct' column of 'ebooks_admin'"
-- e o front NAO checava `error`: a linha era limpa do dirty e a tela dizia "Tudo salvo".
-- Rastro em erros_cliente (02/09 16:23 UTC, rota /admin) — nenhum ebook salvou, nunca.
-- Forma #7 do CLAUDE.md (migracao que nunca chegou ao banco) somada a forma #2 (erro do
-- postgrest-js engolido). A coluna nasce igual a das irmas: numeric, default 0, nao nula.
alter table public.ebooks_admin
  add column if not exists desconto_vista_pct numeric(5,2) not null default 0;

comment on column public.ebooks_admin.desconto_vista_pct is
  'Desconto % para pagamento a vista. Espelha planos_config/cursos_admin — a tela de Produtos do /admin grava as tres com o mesmo payload.';
