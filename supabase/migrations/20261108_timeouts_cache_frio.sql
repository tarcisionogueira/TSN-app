-- 08/11 (#305): o que estourava os 8 s do service_role, medido nos logs e com EXPLAIN.
-- Causa comum: consultas que leem o heap do acervo inteiro (~23 mil páginas para achar poucas linhas).
-- Com o cache quente levam 0,2-4 s; com o cache frio passam de 8 s. Daí a falha "às vezes".
--
-- Efeito encadeado que derrubava a busca do público: landing_numeros_atualizar falhava desde 04/11, ela era quem
-- renovava `acervo_cidades`; com o cache acima de 3 dias, acervo_busca_cidade recontava o acervo e estourava.

-- Os índices foram criados com CONCURRENTLY pela sessão; o IF NOT EXISTS deixa esta migração recriar o banco.
-- 1 linha ativa em SBL_* hoje: 23 mil páginas lidas por hora para achar uma.
create index if not exists idx_imoveis_sbl_ativo on public.imoveis_leilao (fonte)
  where ativo and fonte like 'SBL\_%';
-- Fila de proximidades: 1.647 candidatas entre 41 mil ativas; 5,2 s medidos, 3 falhas em 08/11.
create index if not exists idx_imoveis_fila_proximidades on public.imoveis_leilao (proximidades_tentativas, atualizado_em desc)
  where ativo and proximidades_em is null and latitude is not null and latitude <> 0 and geocod_nivel in ('endereco','rua','bairro');
-- Fotos da Caixa ainda não hospedadas: 326 leituras e 1.360 s de banco para devolver poucas linhas.
create index if not exists idx_imoveis_cef_foto_na_caixa on public.imoveis_leilao (desconto_percentual desc nulls last)
  where fonte = 'CEF' and link_foto like '%venda-imoveis.caixa.gov.br%';

-- Busca: cache velho responde com a contagem de dias atrás; recontar na hora derruba a página. Quem vigia a idade é
-- o health-check. A recontagem fica só para quando o cache não existe.
create or replace function public.acervo_busca_cidade(p_q text)
returns table(cidade text, cidade_norm text, uf text, total bigint)
language sql stable security definer set search_path = public as $f$
  with q as (
    select lower(public.unaccent_simples(btrim(coalesce(p_q, '')))) as t
  ),
  cache as (
    select value::jsonb as v from public.app_config where key = 'acervo_cidades'
  ),
  cid as materialized (
    select r.k as cidade_norm, r.u as uf, r.c as cidade, r.n
      from cache, jsonb_to_recordset(cache.v) as r(k text, u text, c text, n bigint)
    union all
    select i.cidade_norm, upper(i.estado), i.cidade, count(*)
      from public.imoveis_leilao i
     where i.ativo and not exists (select 1 from cache)
     group by 1, 2, 3
  ),
  achados as (
    select c.* from cid c, q
     where length(q.t) >= 2
       and (c.cidade_norm like '%' || replace(q.t, ' ', '') || '%'
            or lower(public.unaccent_simples(c.cidade)) like '%' || q.t || '%')
  )
  select (array_agg(a.cidade order by a.n desc))[1] as cidade,
         a.cidade_norm, a.uf, sum(a.n)::bigint as total
    from achados a
   group by a.cidade_norm, a.uf
   order by sum(a.n) desc
   limit 40
$f$;

-- Página inicial: uma função só somava cidades + contagens + leiloeiros + vitrine num único limite de 8 s, e qualquer
-- estouro desfazia tudo. Agora são 4 chamadas, cada uma com os seus 8 s, e uma falha só deixa aquela parte com o
-- valor anterior. Cada parte grava o próprio carimbo: número velho não ganha cara de novo.
create or replace function public.landing_numeros_gravar(p jsonb)
returns void language sql security definer set search_path = public as $f$
  insert into public.app_config (key, value, updated_at) values ('landing_numeros', p::text, now())
  on conflict (key) do update
    set value = (public.app_config.value::jsonb || excluded.value::jsonb)::text, updated_at = now();
$f$;

create or replace function public.acervo_cidades_atualizar()
returns integer language plpgsql security definer set search_path = public as $f$
declare v_n integer;
begin
  insert into public.app_config (key, value, updated_at)
  select 'acervo_cidades', coalesce(jsonb_agg(jsonb_build_object('k', cidade_norm, 'u', uf, 'c', cidade, 'n', n)), '[]'::jsonb)::text, now()
    from (select i.cidade_norm, upper(i.estado) as uf, i.cidade, count(*) as n
            from public.imoveis_leilao i where i.ativo group by 1, 2, 3) x
  on conflict (key) do update set value = excluded.value, updated_at = now();
  select jsonb_array_length(value::jsonb) into v_n from public.app_config where key = 'acervo_cidades';
  return v_n;
end $f$;

create or replace function public.landing_contagens_atualizar()
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v jsonb;
begin
  select jsonb_build_object(
    'imoveis', (select count(*) from imoveis_leilao where ativo),
    'veiculos', (select count(*) from veiculos_leilao where ativo),
    'cidades', (select count(*) from (
        select regexp_replace(lower(translate(cidade, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z]', '', 'g') c, upper(estado) u from imoveis_leilao
         where ativo and coalesce(cidade, '') <> '' and estado ~ '^[A-Za-z]{2}$'
        union
        select regexp_replace(lower(translate(cidade, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')), '[^a-z]', '', 'g'), upper(estado) from veiculos_leilao
         where ativo and coalesce(cidade, '') <> '' and estado ~ '^[A-Za-z]{2}$') y where length(c) >= 3),
    'em', now())
    into v;
  perform public.landing_numeros_gravar(v);
  return v;
end $f$;

create or replace function public.landing_leiloeiros_atualizar()
returns jsonb language plpgsql security definer set search_path = public as $f$
declare v jsonb;
begin
  v := jsonb_build_object('leiloeiros', public.landing_leiloeiros_oficiais(), 'leiloeiros_em', now());
  perform public.landing_numeros_gravar(v);
  return v;
end $f$;

create or replace function public.landing_vitrine_atualizar()
returns jsonb language plpgsql security definer set search_path = public as $f$
declare vit jsonb; v jsonb;
begin
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
    v := jsonb_build_object('vitrine', vit, 'vitrine_em', now(), 'vitrine_erro', null);
  exception when others then
    -- Sem 'vitrine' no retalho: a vitrine e o carimbo anteriores continuam valendo, e o health-check lê o erro.
    v := jsonb_build_object('vitrine_erro', left(sqlerrm, 200));
  end;
  perform public.landing_numeros_gravar(v);
  return v;
end $f$;

-- O mesmo nome, para uso manual. O cron chama as partes, porque aqui elas voltam a dividir um só limite de tempo.
create or replace function public.landing_numeros_atualizar()
returns jsonb language plpgsql security definer set search_path = public as $f$
begin
  perform public.acervo_cidades_atualizar();
  perform public.landing_contagens_atualizar();
  perform public.landing_leiloeiros_atualizar();
  perform public.landing_vitrine_atualizar();
  return (select value::jsonb from public.app_config where key = 'landing_numeros');
end $f$;

revoke all on function public.landing_numeros_gravar(jsonb) from public, anon, authenticated;
revoke all on function public.acervo_cidades_atualizar() from public, anon, authenticated;
revoke all on function public.landing_contagens_atualizar() from public, anon, authenticated;
revoke all on function public.landing_leiloeiros_atualizar() from public, anon, authenticated;
revoke all on function public.landing_vitrine_atualizar() from public, anon, authenticated;
grant execute on function public.landing_numeros_gravar(jsonb) to service_role;
grant execute on function public.acervo_cidades_atualizar() to service_role;
grant execute on function public.landing_contagens_atualizar() to service_role;
grant execute on function public.landing_leiloeiros_atualizar() to service_role;
grant execute on function public.landing_vitrine_atualizar() to service_role;
