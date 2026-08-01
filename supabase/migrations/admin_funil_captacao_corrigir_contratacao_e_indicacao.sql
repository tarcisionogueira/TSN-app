-- Corrige 2 distorções no funil de captação do painel Admin → Marketing (sessão 22, 01/08):
--
-- 1) "Contrataram/Receita" contava QUALQUER linha de aceites_plano como venda. Desde os
--    Termos v3.0 (sessão 20) o re-aceite de termos também grava em aceites_plano com
--    valor null (nullable desde 0e0eae7) → 3 re-aceites apareceram como "contratações"
--    de R$ 0. Agora só conta aceite com valor > 0 (compra real).
--
-- 2) "Indicação (parceiro)" estava inflado pelo default: vincular_owner_default atribui
--    indicado_por = dono (admin) a todo cadastro sem ?ref= → 22/23 cadastros de 30d
--    caíam em "Indicação" e o Orgânico/Direto zerava. Indicação agora exige que o
--    indicador NÃO seja admin; default do dono conta como Orgânico / Direto.
--
-- CREATE OR REPLACE preserva a ACL existente; revoke idempotente reforça o hardening
-- da migração admin_funil_captacao_revogar_anon.sql.

create or replace function public.admin_funil_captacao(p_inicio timestamp with time zone, p_fim timestamp with time zone)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return (
    with canal_perfil as (
      select p.id, p.nome, p.created_at, p.indicado_por,
        case
          when p.mkt_gclid is not null then 'Google Ads'
          when p.mkt_fbclid is not null then 'Meta Ads'
          when p.mkt_utm_source is not null then 'UTM: ' || p.mkt_utm_source
          -- indicação REAL: o indicador não pode ser admin (o vincular_owner_default
          -- atribui o dono a todo cadastro sem ref — isso é Orgânico, não indicação)
          when p.indicado_por is not null and exists (
            select 1 from public.perfis ind
            where ind.id = p.indicado_por and ind.role is distinct from 'admin'
          ) then 'Indicação (parceiro)'
          else 'Orgânico / Direto'
        end as canal
      from public.perfis p
    ),
    cad as ( -- cadastros criados no período
      select * from canal_perfil where created_at >= p_inicio and created_at <= p_fim
    ),
    cad_agg as (
      select canal,
        count(*)::int as cadastros,
        count(*) filter (where exists (select 1 from public.imovel_visto v where v.user_id = cad.id))::int as engajados
      from cad group by canal
    ),
    contr as ( -- contratações PAGAS no período (valor > 0 exclui re-aceite de termos, que grava valor null)
      select a.user_id,
        min(a.aceito_em) as primeira,
        sum(a.valor)::numeric as receita,
        (array_agg(a.plano_key order by a.aceito_em desc))[1] as plano
      from public.aceites_plano a
      where a.aceito_em >= p_inicio and a.aceito_em <= p_fim
        and a.user_id is not null
        and a.valor > 0
      group by a.user_id
    ),
    con_canal as (
      select c.user_id, c.primeira, c.receita, c.plano,
        coalesce(cp.canal, 'Orgânico / Direto') as canal, cp.nome
      from contr c left join canal_perfil cp on cp.id = c.user_id
    ),
    con_agg as (
      select canal, count(*)::int as contratantes, sum(receita)::numeric as receita
      from con_canal group by canal
    ),
    canais as (
      select coalesce(ca.canal, co.canal) as canal,
        coalesce(ca.cadastros, 0) as cadastros,
        coalesce(ca.engajados, 0) as engajados,
        coalesce(co.contratantes, 0) as contratantes,
        coalesce(co.receita, 0) as receita
      from cad_agg ca full outer join con_agg co on co.canal = ca.canal
    )
    select jsonb_build_object(
      'canais', (select coalesce(jsonb_agg(to_jsonb(c) order by c.cadastros desc, c.receita desc), '[]'::jsonb) from canais c),
      'totais', jsonb_build_object(
        'cadastros', (select coalesce(sum(cadastros), 0) from canais),
        'engajados', (select coalesce(sum(engajados), 0) from canais),
        'contratantes', (select coalesce(sum(contratantes), 0) from canais),
        'receita', (select coalesce(sum(receita), 0) from canais)
      ),
      'recentes', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'nome', coalesce(nullif(trim(nome), ''), 'Sem nome'),
          'plano', plano, 'valor', receita, 'canal', canal, 'data', primeira
        ) order by primeira desc), '[]'::jsonb)
        from (select * from con_canal order by primeira desc limit 10) r
      )
    )
  );
end $function$;

revoke execute on function public.admin_funil_captacao(timestamptz, timestamptz) from public, anon;
