-- Classificação POR REGIÃO (bairro) de uma cidade no índice de mercado. Complementa
-- indice_regiao_ponderado (que dá 1 número ponderado p/ um ponto, com cascata 250m→1km→cidade):
-- aqui devolvemos o R$/m² ponderado de CADA bairro já mapeado, para "mapear a cidade" quando o
-- usuário informa só a cidade (sem rua/bairro). Alimentado pelas amostras que agora guardam o
-- BAIRRO de cada anúncio (api/indice-mercado.js), então UMA busca de cidade semeia vários bairros.
-- Onde um bairro tem poucos dados (<3), ele não aparece aqui e o ponto cai na média (nível 3) do
-- indice_regiao_ponderado — a mesma regra "tem dado suficiente usa; senão usa a média".
-- Service-only (o endpoint chama com SERVICE_KEY).
create or replace function public.indice_bairros_cidade(p_cidade_norm text, p_uf text, p_tipo text)
returns table (bairro_norm text, venda_m2 numeric, locacao_m2 numeric, n_venda int, n_locacao int)
language sql stable security definer set search_path to 'public'
as $function$
  with base as (
    select bairro_norm, natureza, valor_m2,
      -- mesmo peso por recência do indice_regiao_ponderado (anúncio mais novo pesa mais)
      1.0 / (1.0 + greatest(0, (current_date - coalesce(data_anuncio, current_date - 365)))::numeric / 365.0) as peso
    from public.indice_amostras
    where cidade_norm = lower(coalesce(p_cidade_norm,''))
      and uf = upper(coalesce(p_uf,''))
      and tipo = lower(coalesce(p_tipo,''))
      and bairro_norm is not null and bairro_norm <> ''
  )
  select bairro_norm,
    round(sum(valor_m2*peso) filter (where natureza='venda')   / nullif(sum(peso) filter (where natureza='venda'),0),   2) as venda_m2,
    round(sum(valor_m2*peso) filter (where natureza='locacao') / nullif(sum(peso) filter (where natureza='locacao'),0), 2) as locacao_m2,
    count(*) filter (where natureza='venda')::int   as n_venda,
    count(*) filter (where natureza='locacao')::int as n_locacao
  from base
  group by bairro_norm
  having count(*) >= 3           -- bairro com dados suficientes; abaixo disso, cai na média da cidade
  order by count(*) desc
  limit 60;
$function$;

revoke all on function public.indice_bairros_cidade(text,text,text) from public, anon, authenticated;
grant execute on function public.indice_bairros_cidade(text,text,text) to service_role;

comment on function public.indice_bairros_cidade(text,text,text) is
  'R$/m² ponderado por BAIRRO de uma cidade (índice por região). Bairro com <3 amostras não aparece (cai na média via indice_regiao_ponderado). Service-only.';
