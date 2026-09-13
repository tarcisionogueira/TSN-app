-- Pedido do dono (13/09, noite): "registrar no Dashboard a quantidade de pessoas que já
-- leram os livros". `leitura_progresso` já existe (grava o progresso de leitura de cada
-- usuário em cada eBook — LeitorPaginado.jsx e LeitorEstruturado.jsx já escrevem nela), só
-- faltava um agregado admin. Mesmo padrão de admin_qa_invariantes: wrapper SECURITY DEFINER
-- gated por role='admin', a query real fica em função separada reutilizável.
create or replace function public.ebooks_leitura_resumo()
returns table (
  ebook_id uuid,
  titulo text,
  leitores integer,
  concluiram integer
)
language sql
security definer
set search_path to ''
as $fn$
  select
    e.id as ebook_id,
    e.titulo,
    count(lp.user_id)::int as leitores,
    count(lp.user_id) filter (where lp.concluido_em is not null)::int as concluiram
  from public.ebooks_admin e
  left join public.leitura_progresso lp
    on lp.item_tipo = 'ebook' and lp.item_id = e.id::text
  where e.ativo
  group by e.id, e.titulo
  order by leitores desc, e.titulo;
$fn$;
grant execute on function public.ebooks_leitura_resumo() to service_role;

-- Wrapper admin (definer, admin-gated) para a aba Dashboard.
create or replace function public.admin_ebooks_leitura()
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;
  return coalesce((select jsonb_agg(to_jsonb(t)) from public.ebooks_leitura_resumo() t), '[]'::jsonb);
end $fn$;
revoke execute on function public.admin_ebooks_leitura() from public, anon;
grant execute on function public.admin_ebooks_leitura() to authenticated;
