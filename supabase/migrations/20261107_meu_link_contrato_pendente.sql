-- 07/11 — Contrato vencido trancava a conta sem saída. ContratoObrigatorio cobre a tela com
-- "Ir para assinatura → /contratos", mas /contratos fica sob o mesmo bloqueio e é a tela da EQUIPE: o cliente
-- só assinava se ainda tivesse o link /c/<token> do e-mail. Em 07/11 havia 3 pendências vencidas desde 30/10,
-- de 2 assessorados. O cliente também não lê o token pela RLS de contratos_link (assinante_email vazio
-- nessas linhas). Esta função devolve SÓ o token do contrato pendente do próprio usuário logado.
create or replace function public.meu_link_contrato_pendente()
 returns text language sql stable security definer set search_path to 'public'
as $$
  select l.token
    from public.contratos_pendentes c
    join public.contratos_link l on l.id = c.contrato_link_id
   where c.user_id = auth.uid() and c.status = 'aguardando' and l.token is not null
     and coalesce(l.status, '') not in ('cancelado', 'assinado')
   order by c.expira_em nulls last
   limit 1;
$$;
revoke execute on function public.meu_link_contrato_pendente() from public, anon;
grant execute on function public.meu_link_contrato_pendente() to authenticated;
