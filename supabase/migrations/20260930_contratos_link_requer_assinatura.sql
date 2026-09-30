-- 30/09: api/auto-contrato.js (checkout da assessoria/clube) e api/_termo-assessoria.js gravam
-- `requer_assinatura` em contratos_link — a coluna nunca existiu no banco (existe só em `contratos`).
-- Todo insert caía em PGRST204: das 13 linhas de contratos_link, nenhuma veio do checkout.
-- Forma nº 7 do CLAUDE.md; o verificar:schema só confere tabelas e colunas de data.
alter table public.contratos_link add column if not exists requer_assinatura boolean not null default true;
notify pgrst, 'reload schema';
