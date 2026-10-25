-- LANDING: + CIDADES NO RETRATO DIÁRIO (25/10, dono: "autoridade e diversidade", comparando com o Leilão Imóvel,
-- que mostra cidades com imóveis). Mesma função de 20261025_landing_vitrine.sql, só com a chave 'cidades':
-- cidades distintas (cidade_norm + UF) com lote ATIVO de imóvel OU veículo. Medido no dia: 2.467 (imóveis 2.310 + veículos).
-- A faixa da landing mostra "2.200+" (arredonda para baixo) e some a coluna se a chave não vier.
create or replace function public.landing_numeros_atualizar()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb; vit jsonb; ant jsonb;
begin
  select jsonb_build_object(
    'imoveis', (select count(*) from imoveis_leilao where ativo),
    'veiculos', (select count(*) from veiculos_leilao where ativo),
    'leiloeiros', (select count(distinct lower(trim(l))) from (
        select leiloeiro l from imoveis_leilao where ativo
        union all select leiloeiro from veiculos_leilao where ativo) x where l is not null and trim(l) <> ''),
    -- mesma normalização nos dois lados (sem acento/espaço): com cidade_norm de um lado e lower(cidade) do outro,
    -- "feiradesantana" e "feira de santana" contavam duas vezes (2.811 → 2.467 medido em 25/10).
    'cidades', (select count(*) from (
        select regexp_replace(lower(translate(cidade, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z]', '', 'g') c, upper(estado) u from imoveis_leilao
         where ativo and coalesce(cidade, '') <> '' and estado ~ '^[A-Za-z]{2}$'
        union
        select regexp_replace(lower(translate(cidade, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z]', '', 'g'), upper(estado) from veiculos_leilao
         where ativo and coalesce(cidade, '') <> '' and estado ~ '^[A-Za-z]{2}$') y where length(c) >= 3),
    'em', now())
    into v;

  -- VITRINE (25/10) — bloco isolado: falha aqui não derruba os números.
  begin
    with base as (
      select m.id, m.tipo, m.cidade, upper(m.estado) as uf, m.valor_minimo, m.valor_avaliacao,
             m.desconto_percentual, left(m.data_leilao, 10)::date as dl, m.link_foto,
             coalesce(m.fonte in ('CEF', 'caixa'), false) as caixa,
             (m.foto_espelhada_em is not null) as esp,
             coalesce(nullif(m.cidade_norm, ''), lower(m.cidade)) as ck
        from public.imoveis_leilao_mascarado m
       where m.ativo
         and coalesce(m.link_foto, '') <> ''
         and m.data_leilao ~ '^\d{4}-\d{2}-\d{2}($|[T ])'
         and left(m.data_leilao, 10)::date between current_date + 2 and current_date + 10
         and m.valor_minimo >= 30000
         and m.valor_avaliacao > m.valor_minimo
         and m.desconto_percentual between 20 and 75
         and m.tipo in ('apartamento', 'casa', 'terreno', 'comercial', 'rural')
         and coalesce(m.cidade, '') <> '' and coalesce(m.estado, '') <> ''
         and m.suprimido_motivo is null
    ), por_cidade as (
      select b.*, row_number() over (partition by ck, uf order by esp desc, desconto_percentual desc, id) as rc from base b
    ), por_caixa as (
      select c.*, row_number() over (partition by caixa order by esp desc, desconto_percentual desc, id) as rx
        from por_cidade c where rc = 1
    ), escolhidos as (
      select * from por_caixa where not caixa or rx <= 2
       order by esp desc, desconto_percentual desc, id limit 6
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', id, 'tipo', tipo, 'cidade', cidade, 'uf', uf,
             'lance_minimo', valor_minimo, 'avaliacao', valor_avaliacao,
             'desconto_pct', desconto_percentual, 'data_leilao', dl,
             'foto', public.foto_imovel_publica(id, link_foto, null))
             order by esp desc, desconto_percentual desc, id), '[]'::jsonb)
      into vit from escolhidos;
    v := v || jsonb_build_object('vitrine', vit, 'vitrine_em', now());
  exception when others then
    select value::jsonb into ant from app_config where key = 'landing_numeros';
    v := v || jsonb_build_object(
      'vitrine', coalesce(ant -> 'vitrine', '[]'::jsonb),
      'vitrine_em', ant -> 'vitrine_em',
      'vitrine_erro', left(sqlerrm, 200));
  end;

  insert into app_config (key, value, updated_at) values ('landing_numeros', v::text, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into app_config (key, value, updated_at)
  select 'acervo_cidades', coalesce(jsonb_agg(jsonb_build_object('k', cidade_norm, 'u', uf, 'c', cidade, 'n', n)), '[]'::jsonb)::text, now()
    from (select i.cidade_norm, upper(i.estado) as uf, i.cidade, count(*) as n
            from public.imoveis_leilao i where i.ativo group by 1, 2, 3) x
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v;
end $function$;
