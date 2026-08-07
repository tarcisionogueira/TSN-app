-- ÍNDICE: a pesquisa passa a alimentar TAMBÉM o corpus que o relatório lê.
--
-- Achado de 07/08 (gatilho do dono: Índice da Alameda Dourada, 71 — Morada dos Lagos/Barueri;
-- "disse que não encontrou anúncios de locação e classificou por região próxima").
--
-- Existem DOIS corpora e eles nunca conversaram:
--   • `indice_amostras` (PLURAL)  — onde o botão "Gerar índice" grava (ingerir_amostras_indice).
--   • `indice_amostra`  (SINGULAR)— de onde api/indice-consulta.js lê o recorte por raio e a
--     locação, e onde só o MERCADOLÓGICO (gerar-analise) depositava.
--
-- Resultado medido: a pesquisa achou 13 locações, 4 delas na PRÓPRIA Alameda Dourada (DUAS no
-- número 71, o endereço consultado, marcadas nível 1 pelo modelo), e o relatório disse ao
-- cliente que não encontrou anúncios de locação — porque leu a outra tabela. Não era falha de
-- coleta: era o leitor olhando para o lugar errado.
--
-- Correção: a ingestão espelha para o singular, virando um corpus único na prática.
-- Mapeamentos (os esquemas divergiram ao longo do tempo):
--   natureza → especie · fonte_ref → fonte · 'pesquisa_web' → 'portal' (o CHECK de `origem` do
--   singular só aceita relatorio|revenda|portal|imobiliaria|relatorio_regiao) · valor_total
--   derivado de valor_m2 × área · geo_grid do lat/lng quando houver (a coluna é NOT NULL).
-- Dedup por `url`: o singular não tem índice único, então a guarda é explícita — sem ela,
-- regerar o mesmo índice empilharia o anúncio e enviesaria a mediana.
--
-- BACKFILL executado junto (1.425 amostras que o Índice já tinha pesquisado e nunca chegaram ao
-- relatório): corpus da consulta 1.549 → 2.974, locação 149 → 279.

create or replace function public.ingerir_amostras_indice(p_amostras jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer := 0;
begin
  if p_amostras is null or jsonb_typeof(p_amostras) <> 'array' then return 0; end if;

  with novas as (
    select distinct on (lower(a->>'natureza'), nullif(a->>'fonte_ref',''))
      lower(a->>'cidade_norm') cidade_norm, upper(a->>'uf') uf,
      nullif(lower(a->>'bairro_norm'),'') bairro_norm,
      nullif(a->>'lat','')::double precision lat, nullif(a->>'lng','')::double precision lng,
      a->>'tipo' tipo, lower(a->>'natureza') natureza,
      nullif(a->>'valor_m2','')::numeric valor_m2, nullif(a->>'area_m2','')::numeric area_m2,
      nullif(a->>'nivel','')::int nivel, nullif(a->>'data_anuncio','')::date data_anuncio,
      a->>'origem' origem, nullif(a->>'fonte_ref','') fonte_ref,
      nullif(a->>'cep','') cep, nullif(a->>'endereco','') endereco,
      nullif(a->>'condominio','') condominio, nullif(a->>'url','') url
    from jsonb_array_elements(p_amostras) a
  ),
  ins_plural as (
    insert into public.indice_amostras (cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza,
        valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref, cep, endereco, condominio, url)
    select cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza, valor_m2, area_m2, nivel,
           data_anuncio, origem, fonte_ref, cep, endereco, condominio, url
    from novas
    where cidade_norm is not null and uf is not null and valor_m2 is not null and valor_m2 > 0
    returning 1
  ),
  ins_singular as (
    insert into public.indice_amostra (cidade_norm, uf, bairro_norm, geo_grid, tipo, especie,
        valor_m2, valor_total, area_m2, data_ref, fonte, origem, lat, lng, url, endereco, condominio)
    select n.cidade_norm, n.uf, coalesce(n.bairro_norm,''),
           case when n.lat is not null and n.lng is not null
                then round(n.lat::numeric,2)::text||','||round(n.lng::numeric,2)::text else '' end,
           n.tipo,
           case when n.natureza = 'locacao' then 'locacao' else 'venda' end,
           n.valor_m2,
           case when n.area_m2 > 0 then round(n.valor_m2 * n.area_m2, 2) else null end,
           n.area_m2,
           coalesce(n.data_anuncio, current_date),
           n.fonte_ref,
           'portal',
           n.lat, n.lng, n.url, n.endereco, n.condominio
    from novas n
    where n.cidade_norm is not null and n.uf is not null and n.valor_m2 is not null and n.valor_m2 > 0
      and n.natureza in ('venda','locacao')
      -- Dedup: o singular não tem índice único; sem esta guarda, regerar o mesmo índice
      -- empilharia o mesmo anúncio e enviesaria a mediana.
      and (n.url is null or not exists (select 1 from public.indice_amostra x where x.url = n.url))
    returning 1
  )
  select count(*) into v_n from ins_plural;

  return v_n;
end;
$function$;

-- BACKFILL (executado uma vez em 07/08): traz para o singular o que o Índice já pesquisou.
-- Idempotente pela mesma guarda de url — rodar de novo não duplica.
insert into public.indice_amostra (cidade_norm, uf, bairro_norm, geo_grid, tipo, especie,
  valor_m2, valor_total, area_m2, data_ref, fonte, origem, lat, lng, url, endereco, condominio)
select p.cidade_norm, p.uf, coalesce(p.bairro_norm,''),
       case when p.lat is not null and p.lng is not null
            then round(p.lat::numeric,2)::text||','||round(p.lng::numeric,2)::text else '' end,
       p.tipo,
       case when p.natureza='locacao' then 'locacao' else 'venda' end,
       p.valor_m2,
       case when p.area_m2 > 0 then round(p.valor_m2 * p.area_m2, 2) else null end,
       p.area_m2, coalesce(p.data_anuncio, p.criado_em::date),
       p.fonte_ref, 'portal', p.lat, p.lng, p.url, p.endereco, p.condominio
from public.indice_amostras p
where p.cidade_norm is not null and p.uf is not null and p.valor_m2 > 0
  and p.natureza in ('venda','locacao')
  and (p.url is null or not exists (select 1 from public.indice_amostra x where x.url = p.url));
