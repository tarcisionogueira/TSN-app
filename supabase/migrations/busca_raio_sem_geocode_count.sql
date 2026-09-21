-- Pedido do dono (21/09): "quanto a busca por raio, qual melhor forma de resolver?" — o
-- gap identificado era que `buscar_por_raio_v2` exige `latitude/longitude` preenchidas
-- (não dá pra calcular distância sem coordenada), então um imóvel que bate em todos os
-- outros filtros mas ainda não foi geocodificado SOME da lista sem nenhum aviso — diferente
-- do mapa, que já avisa quando os resultados visíveis não têm coordenada (`semCoordenadas`
-- em Busca.jsx).
--
-- Sem coordenada não dá pra saber a distância exata até o centro do raio, mas dá pra saber
-- se o imóvel é da MESMA CIDADE escolhida como centro (`cidade_norm`) — aproximação
-- deliberada (um raio de 100km pode pegar cidade vizinha sem geocode, e esses ficam de
-- fora da contagem; preferível a um falso "temos mais N" impreciso demais pra confiar).
--
-- Espelha TODOS os filtros de `buscar_por_raio_v2` exceto o geográfico (mesma regra do
-- comentário em Busca.jsx: "todo filtro da Busca deve valer em todos os caminhos" — este é
-- mais um caminho a manter em sincronia ao adicionar filtro novo, junto com
-- aplicarFiltrosImoveis, buscar_por_raio_v2 e api/busca-raio.js).
create or replace function public.buscar_por_raio_v2_sem_geocode_count(
  cidade_norm_filtro text,
  tipos_filtro text[] default '{}'::text[],
  estado_filtro text default '',
  modalidades_filtro text[] default '{}'::text[],
  pagamentos_filtro text[] default '{}'::text[],
  valor_min double precision default 0,
  valor_max double precision default 9999999999,
  desconto_min double precision default 0,
  data_de text default null,
  data_ate text default null,
  sem_data boolean default false
)
returns bigint
language sql
stable
set search_path to 'public'
as $function$
  select count(*)
  from imoveis_leilao i
  where
    i.ativo = true
    and (i.latitude is null or i.latitude = 0 or i.longitude is null or i.longitude = 0)
    and i.cidade_norm = cidade_norm_filtro
    and (cardinality(tipos_filtro) = 0 or i.tipo = any(tipos_filtro) or i.tipo = 'imovel')
    and (estado_filtro = '' or i.estado = estado_filtro)
    and (cardinality(modalidades_filtro) = 0 or i.modalidade = any(modalidades_filtro))
    and (
      cardinality(pagamentos_filtro) = 0
      or ((i.modalidade = 'judicial' or i.forma_pagamento = 'hipotecado') and 'hipotecado' = any(pagamentos_filtro))
      or (i.modalidade is distinct from 'judicial' and i.forma_pagamento = 'a_vista'   and 'a_vista'    = any(pagamentos_filtro))
      or (i.modalidade is distinct from 'judicial' and i.forma_pagamento = 'financiado' and 'financiado' = any(pagamentos_filtro))
    )
    and (valor_min <= 0 or (i.valor_minimo_ref is not null and i.valor_minimo_ref >= valor_min))
    and (valor_max >= 9999999999 or (i.valor_minimo_ref is not null and i.valor_minimo_ref <= valor_max))
    and (desconto_min <= 0 or (i.desconto_percentual is not null and i.desconto_percentual >= desconto_min))
    and (
      (sem_data and i.data_leilao is null)
      or (not sem_data
          and (data_de is null or (i.data_leilao is not null and i.data_leilao >= data_de))
          and (data_ate is null or (i.data_leilao is not null and i.data_leilao <= data_ate)))
    );
$function$;

-- Mesmo grant de buscar_por_raio_v2 (PUBLIC/anon/authenticated/service_role) — é leitura
-- de contagem sobre acervo já público, nenhum dado novo exposto.
grant execute on function public.buscar_por_raio_v2_sem_geocode_count(
  text, text[], text, text[], text[], double precision, double precision, double precision, text, text, boolean
) to anon, authenticated, service_role;
