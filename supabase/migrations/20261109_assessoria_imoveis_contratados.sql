-- 09/11 (dono): a Onx pagou "Assessoria para 2 imóveis" (cobrança avulsa, R$ 8.000) e a tela /assessorados
-- mostrava "Nenhuma arrematação registrada". A fase "contratada" saía só de CASOS abertos — e o contrato por
-- link avulso não abre caso: o imóvel ainda não está escolhido. Contratado ≠ caso aberto.
--
-- Esta função devolve, por cliente, quantos imóveis ele CONTRATOU em cobranças avulsas de assessoria pagas.
-- Ligação pelo e-mail do destinatário (o mesmo critério que ativou o plano em _cobranca-avulsa-efeitos.js).
-- Nº de imóveis: o número escrito no título do termo/descrição ("2 imóveis"); sem número, a `quantidade`.
create or replace function public.assessoria_imoveis_contratados(p_ids uuid[])
returns table (cliente_id uuid, imoveis int, cobrancas int)
language sql stable security definer set search_path = public, auth
as $$
  select u.id,
         sum(coalesce(
           nullif(substring(coalesce(c.termo_titulo, '') || ' ' || coalesce(c.descricao, '') from '(\d+)\s*im[oó]ve'), '')::int,
           greatest(c.quantidade, 1)
         ))::int,
         count(*)::int
    from cobrancas_avulsas c
    join auth.users u on lower(u.email) = lower(c.destinatario_email)
   where c.status = 'paga' and c.produto_key ~ '^assessorado' and u.id = any(p_ids)
   group by u.id
$$;
revoke all on function public.assessoria_imoveis_contratados(uuid[]) from public, anon, authenticated;
grant execute on function public.assessoria_imoveis_contratados(uuid[]) to service_role;
