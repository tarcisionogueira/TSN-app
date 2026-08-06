-- ─────────────────────────────────────────────────────────────────────────────
-- ÍNDICE — A AMOSTRA PASSA A GUARDAR ONDE O ANÚNCIO ESTÁ (06/08/2026)
--
-- Gatilho: o dono achou no ZAP vários aluguéis em Alphaville Industrial (69 m² R$ 4.500 =
-- R$ 65/m²; 84 m² R$ 7.700 = R$ 92/m²; 165 m² R$ 12.500 = R$ 76/m²) enquanto o Índice do
-- Cauaxi mostrava R$ 28/m²·mês ESTIMADO e "Localidade 0 · Bairro 0".
--
-- A pesquisa NÃO era o problema: as duas gerações de hoje (Brasília) trouxeram 60 locações
-- COM metragem (apto R$ 45–86/m²·mês, por bairro). O problema é que a amostra chegava ao
-- banco sem saber ONDE está — e por dois motivos que se somavam:
--
--   1. `montarAmostras` carimbava o lat/lng do endereço CONSULTADO em toda amostra: 85
--      anúncios de 4 bairros de Brasília gravados no MESMO ponto. O recorte de 250 m virava
--      ficção. (corrigido em api/_indice-core.js no mesmo commit)
--   2. Esta RPC RECEBIA cep/endereco/condominio de `montarAmostras` e NÃO OS GRAVAVA — não
--      estavam na lista de colunas do insert. Por isso 0 das 155 amostras de hoje têm
--      endereço, apesar de o prompt pedir e o modelo às vezes trazer.
--
-- Resultado combinado: o `indice-geocodificar-cron`, que existe para triangular a posição
-- real de cada anúncio, seleciona `lat is null and (cep|endereco|condominio) not null` —
-- e NUNCA via linha nenhuma. O pipeline de posição estava inteiro e desligado nas duas pontas.
--
-- Esta migração: (1) coluna `url` (link do anúncio — auditável e re-lível); (2) a RPC passa a
-- gravar a âncora; (3) limpa as coordenadas falsas já gravadas, pela MESMA regra do pino
-- genérico do acervo: uma coordenada exata reivindicada por bairros diferentes é do ponto de
-- consulta, não do anúncio.
-- Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Link do anúncio. Sem ele nenhuma amostra é conferível — e os 129 anúncios de locação
-- sem área que já temos não podem ser relidos, só recapturados.
alter table public.indice_amostras add column if not exists url text;

-- 2) Ingestão passa a persistir cep/endereco/condominio/url. O restante da função é idêntico
-- (dedup por (natureza, fonte_ref), régua indice_plausivel, distinct on).
create or replace function public.ingerir_amostras_indice(p_amostras jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n integer := 0;
begin
  if p_amostras is null or jsonb_typeof(p_amostras) <> 'array' then return 0; end if;
  insert into public.indice_amostras (cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza,
      valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref, cep, endereco, condominio, url)
  select cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza,
      valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref, cep, endereco, condominio, url
  from (
    select distinct on (lower(a->>'natureza'), nullif(a->>'fonte_ref',''))
      lower(a->>'cidade_norm') cidade_norm, upper(a->>'uf') uf, nullif(lower(a->>'bairro_norm'),'') bairro_norm,
      nullif(a->>'lat','')::double precision lat, nullif(a->>'lng','')::double precision lng,
      lower(a->>'tipo') tipo, lower(a->>'natureza') natureza,
      (a->>'valor_m2')::numeric valor_m2, nullif(a->>'area_m2','')::numeric area_m2,
      nullif(a->>'nivel','')::smallint nivel, nullif(a->>'data_anuncio','')::date data_anuncio,
      coalesce(a->>'origem','pesquisa_web') origem, nullif(a->>'fonte_ref','') fonte_ref,
      nullif(a->>'cep','') cep, nullif(a->>'endereco','') endereco,
      nullif(a->>'condominio','') condominio, nullif(a->>'url','') url
    from jsonb_array_elements(p_amostras) a
    where (a->>'valor_m2') ~ '^[0-9.]+$'
      and a->>'natureza' in ('venda','locacao') and coalesce(a->>'cidade_norm','') <> ''
      and public.indice_plausivel(lower(a->>'tipo'), lower(a->>'natureza'), (a->>'valor_m2')::numeric)
    order by lower(a->>'natureza'), nullif(a->>'fonte_ref',''), (a->>'data_anuncio') desc nulls last
  ) d
  on conflict (natureza, fonte_ref) where fonte_ref is not null do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end; $function$;

-- 3) Limpeza das coordenadas FALSAS já gravadas.
--
-- O discriminador é exato, não heurístico: `geocod_em` está NULO em 100% das 1.380 amostras —
-- nenhuma passou pelo geocodificador na história do sistema. Logo, toda coordenada presente foi
-- carimbada por `montarAmostras`, e é a do endereço consultado. A prova em números: 1.026
-- amostras com coordenada distribuídas em apenas 39 PONTOS distintos — as 39 consultas que
-- geraram índice. Zerar devolve essas amostras ao nível bairro/cidade (honesto, casando por
-- texto) e, quando tiverem âncora, à fila do indice-geocodificar-cron.
update public.indice_amostras
set lat = null, lng = null, geo_nivel = null
where lat is not null and geocod_em is null;

-- 4) Mesma limpeza na base do RELATÓRIO (indice_amostra, singular), com a régua conservadora do
-- pino genérico: lá a amostra herda a coordenada do IMÓVEL-ALVO, mas com teto de 2 km — então o
-- carimbo é grosseiro, não arbitrário, e serve de aproximação para consultas em OUTRO endereço.
-- Zera só o que é comprovadamente falso: a coordenada exata reivindicada por bairros diferentes
-- (249 amostras em 9 pontos). Daqui em diante, gerar-analise.js só carimba a coordenada do alvo
-- na amostra que a própria IA declarou estar dentro dos 250 m.
with falsas as (
  select lat, lng
  from public.indice_amostra
  where lat is not null and bairro_norm is not null
  group by lat, lng
  having count(distinct bairro_norm) > 1
)
update public.indice_amostra a
set lat = null, lng = null, geo_grid = ''
from falsas f
where a.lat = f.lat and a.lng = f.lng;
