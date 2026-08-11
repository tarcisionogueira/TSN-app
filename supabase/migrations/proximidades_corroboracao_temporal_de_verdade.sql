-- PROXIMIDADES — a corroboração "temporal" de 10/08 não era temporal (11/08).
--
-- O QUE O INVARIANTE ACUSOU NA ABERTURA DE HOJE: `proximidades_vazio_falso` = 446 (limite
-- 300) — ou seja, a rede montada ontem para tornar o vazio falso VISÍVEL funcionou, e o que
-- ela mostrou é que o defeito voltou em menos de 24h, só que menor.
--
-- CAUSA: `PROX_VAZIOS_P_ACEITAR = 3` conta OBSERVAÇÕES, não TEMPO. E a fila do cron devolve
-- o mesmo lote ao lote seguinte: ela seleciona `proximidades_em is null` ordenado por
-- `atualizado_em desc`, e a gravação parcial do vazio NÃO mexe em `atualizado_em` (não há
-- trigger) — então o lote que deu vazio continua na mesma posição, no topo, e é reconsultado
-- na execução seguinte, 15 minutos depois. As três observações caem numa janela de ~30-45
-- min: dentro do MESMO episódio de rate-limit. Trocou-se "no mesmo instante" (o erro de
-- ontem de manhã) por "na mesma meia hora", que para uma instância pública sobrecarregada é
-- a mesma coisa. A lição de ontem — "só o TEMPO separa 'não há POI aqui' de 'os espelhos
-- estavam sobrecarregados'" — foi aplicada pela metade.
--
-- PROVA, sem precisar consultar o Overpass: na coordenada EXATA -23.5329,-46.6395 (centro de
-- São Paulo) há 24 imóveis ativos com pontos (até 6 categorias) e 15 gravados como "vazio
-- corroborado com 3 observações". Mesma coordenada, mesmo raio, mesma consulta, resultado
-- oposto. Generalizando: de 99 coordenadas distintas com vazio corroborado, 43 têm um
-- vizinho na MESMA coordenada com pontos — 43% provados falsos sem uma requisição sequer.
--
-- CORREÇÃO (código em api/enriquecer-proximidades.js e api/proximidades-imovel.js):
--   1. Intervalo MÍNIMO entre observações de vazio (`proximidades_vazio_em`): 6h. Três
--      observações passam a levar >= 12h e atravessam condições de carga diferentes.
--   2. Veto pelo vizinho de MESMA coordenada: se outro lote ativo na mesma coordenada tem
--      pontos, o vazio é falso por construção — nunca gravar `{}`; copiar os pontos dele.
--      A cópia é EXATA, não aproximada: `dist_m` é medido a partir da coordenada, e a
--      coordenada é a mesma. De quebra tira 2.263 lotes do backlog sem uma requisição.

-- 1) Carimbo da ÚLTIMA observação de vazio. Sem ele não há como exigir intervalo: o contador
--    `proximidades_vazios` diz QUANTAS vezes, nunca QUANDO.
alter table public.imoveis_leilao
  add column if not exists proximidades_vazio_em timestamptz;

comment on column public.imoveis_leilao.proximidades_vazio_em is
  'Quando o vazio foi observado pela última vez. Uma nova observação só CONTA (incrementa '
  'proximidades_vazios) se distar >= 6h desta — corroboração temporal de verdade, ver '
  'proximidades_corroboracao_temporal_de_verdade.sql.';

-- Índice parcial para a fila do cron: só interessam os lotes em cooldown de vazio.
create index if not exists imoveis_leilao_proximidades_vazio_em_idx
  on public.imoveis_leilao (proximidades_vazio_em)
  where proximidades_vazio_em is not null;

-- Índice para o veto/cópia por coordenada (lookup do vizinho que TEM pontos).
create index if not exists imoveis_leilao_coord_com_pontos_idx
  on public.imoveis_leilao (latitude, longitude)
  where ativo and pontos_proximos is not null and pontos_proximos <> '{}'::jsonb;

-- 2) REPARO A — o que dá para consertar de graça: copiar do vizinho de MESMA coordenada.
--    Vale para todo `{}`, corroborado ou legado. Exato pelo motivo do cabeçalho.
with vizinho as (
  select distinct on (v.latitude, v.longitude)
         v.latitude, v.longitude, v.pontos_proximos
    from public.imoveis_leilao v
   where v.ativo and v.pontos_proximos is not null and v.pontos_proximos <> '{}'::jsonb
     and v.latitude is not null and v.longitude is not null
   order by v.latitude, v.longitude, v.proximidades_em desc nulls last
)
update public.imoveis_leilao i
   set pontos_proximos = vz.pontos_proximos,
       proximidades_em = now(),
       proximidades_tentativas = 0,
       proximidades_vazios = 0,
       proximidades_vazio_em = null
  from vizinho vz
 where i.ativo
   and i.pontos_proximos = '{}'::jsonb
   and i.latitude = vz.latitude and i.longitude = vz.longitude;

-- 3) REPARO B — o vazio que sobrou em cidade JÁ MAPEADA volta para a fila. É a mesma
--    definição que o invariante usa: se algum lote ativo da mesma cidade/UF tem pontos, a
--    região está mapeada no OSM e o vazio do vizinho é falha de consulta. `pontos_proximos
--    = null` + `proximidades_em = null` é o estado "nunca calculado", que o cron já trata.
--    Enquanto não recalcula, a tela mostra "não foi possível carregar agora" + "Tentar
--    novamente" — que é a verdade — em vez de afirmar que não há nada por perto.
--    Gleba rural genuinamente vazia NÃO é tocada: lá nenhum vizinho tem pontos.
update public.imoveis_leilao i
   set pontos_proximos = null,
       proximidades_em = null,
       proximidades_tentativas = 0,
       proximidades_vazios = 0,
       proximidades_vazio_em = null
 where i.ativo
   and i.pontos_proximos = '{}'::jsonb
   and coalesce(i.cidade,'') <> ''
   and exists (select 1 from public.imoveis_leilao v
                where v.ativo and v.cidade = i.cidade and v.estado is not distinct from i.estado
                  and v.pontos_proximos is not null and v.pontos_proximos <> '{}'::jsonb);
