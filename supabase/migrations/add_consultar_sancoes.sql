-- Consulta sanções federais (CEIS/CNEP) por CPF/CNPJ do executado.
-- Normaliza o documento dos dois lados (só dígitos) para casar formatos diferentes.
-- Usada pelo módulo judicial da análise. Retorna jsonb (array) — type-safe.
create or replace function public.consultar_sancoes(p_doc text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(to_jsonb(s) - 'id' - 'fonte_id' - 'atualizado_em' order by s.data_inicio_sancao desc),
    '[]'::jsonb
  )
  from public.sancoes_federais s
  where regexp_replace(coalesce(s.cpf_cnpj, ''), '\D', '', 'g')
      = regexp_replace(coalesce(p_doc, ''), '\D', '', 'g')
    and regexp_replace(coalesce(p_doc, ''), '\D', '', 'g') <> ''
    and coalesce(s.ativo, true);
$$;

revoke all on function public.consultar_sancoes(text) from public;
grant execute on function public.consultar_sancoes(text) to authenticated, service_role;
