-- TRIAGEM DO SINAL DE LOCALIZAÇÃO (pedido do dono): anúncios dão ora o CONDOMÍNIO, ora a rua sem
-- número, ora o endereço completo. Guardamos o condomínio por amostra (âncora precisa: prédio
-- nomeado) e o NÍVEL de precisão que a triangulação alcançou (geo_nivel: endereco/rua/bairro/cidade)
-- para saber se a posição é EFETIVA (endereço/rua/condomínio) ou APROXIMADA (bairro/cidade).
alter table public.indice_amostras add column if not exists condominio text;
alter table public.indice_amostras add column if not exists geo_nivel text;

-- fila do cron passa a incluir quem tem condomínio (mais um sinal p/ posicionar).
create index if not exists idx_indice_amostras_geocod_fila2
  on public.indice_amostras (cidade_norm, uf)
  where lat is null and geocod_em is null and (cep is not null or endereco is not null or condominio is not null);

create or replace function public.ingerir_amostras_indice(p_amostras jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n integer := 0;
begin
  if p_amostras is null or jsonb_typeof(p_amostras) <> 'array' then return 0; end if;
  insert into public.indice_amostras (cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza, valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref, cep, endereco, condominio)
  select cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza, valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref, cep, endereco, condominio
  from (
    select distinct on (lower(a->>'natureza'), nullif(a->>'fonte_ref',''))
      lower(a->>'cidade_norm') cidade_norm, upper(a->>'uf') uf, nullif(lower(a->>'bairro_norm'),'') bairro_norm,
      nullif(a->>'lat','')::double precision lat, nullif(a->>'lng','')::double precision lng,
      lower(a->>'tipo') tipo, lower(a->>'natureza') natureza,
      (a->>'valor_m2')::numeric valor_m2, nullif(a->>'area_m2','')::numeric area_m2,
      nullif(a->>'nivel','')::smallint nivel, nullif(a->>'data_anuncio','')::date data_anuncio,
      coalesce(a->>'origem','pesquisa_web') origem, nullif(a->>'fonte_ref','') fonte_ref,
      nullif(regexp_replace(coalesce(a->>'cep',''), '\D', '', 'g'), '') cep,
      nullif(btrim(a->>'endereco'), '') endereco,
      nullif(btrim(a->>'condominio'), '') condominio
    from jsonb_array_elements(p_amostras) a
    where (a->>'valor_m2') ~ '^[0-9.]+$'
      and a->>'natureza' in ('venda','locacao') and coalesce(a->>'cidade_norm','') <> ''
      and ( (lower(a->>'natureza')='venda'   and (a->>'valor_m2')::numeric between 200 and 200000)
         or (lower(a->>'natureza')='locacao' and (a->>'valor_m2')::numeric between 1 and 500) )
    order by lower(a->>'natureza'), nullif(a->>'fonte_ref',''), (a->>'data_anuncio') desc nulls last
  ) d
  on conflict (natureza, fonte_ref) where fonte_ref is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end; $function$;
