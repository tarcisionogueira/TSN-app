-- Geocode: pinos "exatos" que na verdade eram o CENTRO da cidade.
-- Quando o Nominatim não achava o endereço "sujo" (Lt/Qd/Apto) de uma cidade pequena,
-- devolvia o centróide do município; o resultado era rotulado 'endereco'/'rua' só
-- porque o INPUT tinha número → pino preciso a km do imóvel real (queixa do dono:
-- "imóveis no mapa com localização muito errada").
--
-- Assinatura de centróide: >= 3 RUAS distintas colapsadas na MESMA coordenada EXATA
-- (prédio real = 1 rua com vários números → NÃO entra). Rebaixa para 'cidade'
-- (aproximado); o mapa passa a mostrar como região (pino esmaecido + aviso), não pino
-- exato. Correção na ORIGEM em api/_geo.js (função nivelReal) evita novos casos.
-- Aplicado em produção em 25/07/2026 (~2.025 imóveis).
with grp as (
  select latitude la, longitude ln
  from public.imoveis_leilao
  where ativo and geocod_nivel in ('endereco','rua')
    and latitude is not null and latitude <> 0
  group by latitude, longitude
  having count(distinct lower(btrim(split_part(coalesce(endereco,''), ',', 1)))) >= 3
)
update public.imoveis_leilao i
set geocod_nivel = 'cidade'
from grp
where i.ativo and i.geocod_nivel in ('endereco','rua')
  and i.latitude = grp.la and i.longitude = grp.ln;
