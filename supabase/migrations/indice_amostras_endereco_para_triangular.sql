-- TRIANGULAÇÃO DA POSIÇÃO (pedido do dono): para mapear a cidade a ~250m, cada amostra do índice
-- passa a guardar o ENDEREÇO/CEP que o anúncio expõe (logradouro+nº e CEP). Um cron gratuito
-- (api/indice-geocodificar-cron) roda esses campos pela cascata IBGE+Correios+Nominatim/BrasilAPI
-- (api/_geo.js, a MESMA do acervo) e preenche lat/lng+nível — assim a posição do imóvel é
-- triangulada sem custo e a resolução por 250m entra conforme as amostras são geocodificadas.
-- Aditivo e nulo p/ o legado (sem regressão). bairro_norm já resolve o nível 'mesmo bairro'.
alter table public.indice_amostras add column if not exists cep text;
alter table public.indice_amostras add column if not exists endereco text;
alter table public.indice_amostras add column if not exists geocod_em timestamptz;

-- fila do cron: amostras SEM coordenada e AINDA não tentadas (geocod_em null) que têm ao menos
-- um sinal de endereço p/ geocodificar. geocod_em é setado a cada tentativa → cada amostra 1x.
create index if not exists idx_indice_amostras_geocod_fila
  on public.indice_amostras (cidade_norm, uf)
  where lat is null and geocod_em is null and (cep is not null or endereco is not null or bairro_norm is not null);

-- Ingestão passa a aceitar cep/endereco por amostra (segue idempotente por natureza+fonte_ref).
create or replace function public.ingerir_amostras_indice(p_amostras jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_n integer := 0;
begin
  if p_amostras is null or jsonb_typeof(p_amostras) <> 'array' then return 0; end if;
  insert into public.indice_amostras (cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza, valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref, cep, endereco)
  select cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza, valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref, cep, endereco
  from (
    select distinct on (lower(a->>'natureza'), nullif(a->>'fonte_ref',''))
      lower(a->>'cidade_norm') cidade_norm, upper(a->>'uf') uf, nullif(lower(a->>'bairro_norm'),'') bairro_norm,
      nullif(a->>'lat','')::double precision lat, nullif(a->>'lng','')::double precision lng,
      lower(a->>'tipo') tipo, lower(a->>'natureza') natureza,
      (a->>'valor_m2')::numeric valor_m2, nullif(a->>'area_m2','')::numeric area_m2,
      nullif(a->>'nivel','')::smallint nivel, nullif(a->>'data_anuncio','')::date data_anuncio,
      coalesce(a->>'origem','pesquisa_web') origem, nullif(a->>'fonte_ref','') fonte_ref,
      nullif(regexp_replace(coalesce(a->>'cep',''), '\D', '', 'g'), '') cep,
      nullif(btrim(a->>'endereco'), '') endereco
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
