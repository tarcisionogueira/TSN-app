-- CRÍTICO: os tokens de convite (equipe e vendedor) eram LEGÍVEIS por qualquer anônimo
-- (policy "público lê ... ativos") — dava para listar TODOS os tokens ativos e se
-- autoelevar a um papel de staff via usar_convite_equipe antes do convidado real. O
-- token deixava de ser secreto. Correção (padrão do get_contrato_por_token): remove a
-- leitura pública da tabela e valida o token por RPC de correspondência EXATA (sem
-- enumeração). A redenção (usar_convite_equipe) já é single-use e amarrada ao auth.uid().

create or replace function public.get_convite_equipe_info(p_token text)
returns jsonb language sql security definer set search_path = public, pg_catalog as $$
  select case when c.id is null then jsonb_build_object('valido', false)
              else jsonb_build_object('valido', true, 'roles', c.roles,
                     'descricao', c.descricao, 'expira_em', c.expira_em, 'criado_em', c.criado_em)
         end
  from (select 1) x
  left join public.convites_equipe c
    on c.token = p_token and c.ativo = true and c.usado_em is null
       and (c.expira_em is null or c.expira_em > now());
$$;
revoke execute on function public.get_convite_equipe_info(text) from public;
grant execute on function public.get_convite_equipe_info(text) to anon, authenticated;

create or replace function public.get_convite_vendedor_info(p_token text)
returns jsonb language sql security definer set search_path = public, pg_catalog as $$
  select case when c.id is null then jsonb_build_object('valido', false)
              else jsonb_build_object('valido', true, 'tipo', c.tipo,
                     'comissao_pct', c.comissao_pct, 'expira_em', c.expira_em)
         end
  from (select 1) x
  left join public.convites_vendedor c
    on c.token = p_token and c.ativo = true
       and (c.expira_em is null or c.expira_em > now());
$$;
revoke execute on function public.get_convite_vendedor_info(text) from public;
grant execute on function public.get_convite_vendedor_info(text) to anon, authenticated;

drop policy if exists "Público lê convites equipe ativos" on public.convites_equipe;
drop policy if exists "publico le convite ativo" on public.convites_vendedor;
