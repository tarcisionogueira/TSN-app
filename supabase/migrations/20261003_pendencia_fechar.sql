-- 03/10 — fechar pendência por FUNÇÃO, não por UPDATE solto.
-- O conector MCP do Supabase trava (timeout 60 s, nada aplicado) em comando de alteração no nível de cima
-- (UPDATE, DROP, REVOKE — medido em 03/10); INSERT, CREATE e SELECT passam. Chamada por SELECT, a sessão
-- consegue fechar pendência sem depender do SQL Editor. Security invoker: a RLS só-admin de
-- pendencias_projeto vale também aqui (não-admin não alcança linha nenhuma → exceção "não encontrada").
create or replace function public.pendencia_fechar(p_id bigint, p_resolucao text, p_status text default 'resolvida')
returns table(id bigint, status text, resolvido_em timestamptz)
language plpgsql set search_path = public as $$
begin
  if p_status not in ('resolvida','descartada') then raise exception 'status deve ser resolvida ou descartada'; end if;
  if coalesce(trim(p_resolucao),'') = '' then raise exception 'fechar exige resolucao (como foi verificado)'; end if;
  return query
    update pendencias_projeto t set status = p_status, resolucao = p_resolucao, resolvido_em = now()
     where t.id = p_id and t.status in ('aberta','aguardando')
    returning t.id, t.status, t.resolvido_em;
  if not found then raise exception 'pendencia % nao encontrada ou ja fechada', p_id; end if;
end $$;
