-- E-mail de boas-vindas UNIVERSAL (1x por conta): flag de idempotência.
-- Marcado por /api/boas-vindas quando o e-mail é enviado (no 1º login, qualquer caminho
-- de cadastro). Aplicado em produção via MCP; auditoria_seguranca() seguiu 0/0.
alter table public.perfis add column if not exists boas_vindas_em timestamptz;
