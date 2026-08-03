-- MINIMIZAÇÃO NA CÓPIA OFF-REGION (LGPD Art. 6º, III — necessidade).
--
-- O snapshot do backup fazia `select=*`, o que levava para fora do país a chave PIX e o CPF
-- em texto claro. A cópia existe para RESTAURAR um desastre, e para isso nenhum dos dois é
-- indispensável: o PIX o parceiro recadastra no próximo saque, e o CPF continua na cópia em
-- `cpf_enc` (AES-GCM) + `cpf_hash` (HMAC), inúteis sem a CPF_ENC_KEY — que não vai no backup.
--
-- Para montar um `select=` explícito, o cron precisa saber quais colunas a tabela tem HOJE.
-- Ler isso do banco (e não de uma lista fixa no código) é o que impede o defeito clássico:
-- alguém adiciona uma coluna nova, ninguém lembra de atualizar o backup, e a coluna some da
-- cópia em silêncio. Aqui, coluna nova entra automaticamente; só fica de fora o que o código
-- listar explicitamente em COLUNAS_FORA.
--
-- Escopo fechado: só responde para as tabelas que o backup realmente copia, e só ao
-- service_role. Não é um introspector genérico exposto ao cliente.

create or replace function public.backup_colunas_da_tabela(p_tabela text)
returns text[]
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select array_agg(c.column_name::text order by c.ordinal_position)
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = p_tabela
     and p_tabela in (
       'perfis', 'arrematacoes', 'arrematados', 'planos_config',
       'indice_amostra', 'cidade_indicadores', 'leiloeiro_conhecimento'
     );
$$;

comment on function public.backup_colunas_da_tabela(text) is
  'Colunas atuais de uma tabela do backup off-region, para o cron montar select= explicito e deixar de fora chave PIX/CPF em claro (LGPD Art. 6, III). Restrita as tabelas do backup e ao service_role.';

-- Só o backend. anon/authenticated não têm o que fazer com isto.
revoke all on function public.backup_colunas_da_tabela(text) from public, anon, authenticated;
grant execute on function public.backup_colunas_da_tabela(text) to service_role;
