-- Backfill do índice permanente com os comparáveis de VENDA já pesquisados nos mercadológicos
-- históricos (nasce maduro, não do zero — responde "as pesquisas que já fiz são aproveitadas?").
-- Normalização de cidade por translate (unaccent não está instalado) para bater com a norm do
-- endpoint. Idempotente por (natureza, fonte_ref). Locação não entra (os comparáveis históricos
-- de locação não têm m² confiável; o endpoint passa a coletar locação daqui pra frente).
insert into public.indice_amostras (cidade_norm, uf, bairro_norm, lat, lng, tipo, natureza, valor_m2, area_m2, nivel, data_anuncio, origem, fonte_ref)
select
  trim(regexp_replace(translate(lower(am.cidade),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+',' ','g')) cidade_norm,
  upper(am.estado) uf,
  nullif(trim(regexp_replace(translate(lower(am.imovel->>'bairro'),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+',' ','g')),'') bairro_norm,
  nullif(am.imovel->>'latitude','')::double precision lat,
  nullif(am.imovel->>'longitude','')::double precision lng,
  lower(coalesce(am.imovel->>'tipo','apartamento')) tipo,
  'venda' natureza,
  (x.v->>'valorM2')::numeric valor_m2,
  nullif(x.v->>'m2','')::numeric area_m2,
  n.nivel::smallint,
  case when (x.v->>'data') ~ '^[0-9]{4}-[0-9]{2}' then to_date(left(x.v->>'data',7)||'-01','YYYY-MM-DD') else null end data_anuncio,
  'relatorio_mercado' origem,
  'hist_'||am.id||'_'||n.nivel||'_'||x.ord fonte_ref
from analises_mercado am
cross join lateral (values (1,'nivel1'),(2,'nivel2')) n(nivel,key)
cross join lateral jsonb_array_elements(coalesce(am.result->'mercado'->n.key->'vendas','[]'::jsonb)) with ordinality x(v,ord)
where am.status='concluida' and am.cidade is not null and am.estado is not null
  and (x.v->>'valorM2') ~ '^[0-9.]+$' and (x.v->>'valorM2')::numeric between 200 and 200000
on conflict (natureza, fonte_ref) where fonte_ref is not null do nothing;
