-- 24/09 — GÊMEOS CAIXA × LEILOEIRO (achado do dono: "estamos trazendo lotes repetidos").
-- A mesma casa de Feira de Santana aparecia 2× na busca: pelo portal da CAIXA (fonte CEF) e
-- pela 3 Torres Leilões (TORRES3), que é a leiloeira da Caixa naquele leilão SFI. Medido no
-- banco: 167 pares CEF+TORRES3 1-para-1 com mesma cidade, lance mínimo, avaliação, data e área
-- (±2%) — mais 3 CEF+KLEILOES no mesmo critério.
--
-- Mesma decisão do dono para os gêmeos HASTA×CEF (21/08, opção (a)): fica o lote do LEILOEIRO
-- (é onde se dá o lance; tem matrícula e edital), sai o do portal CEF — via `ativo=false` +
-- `suprimido_motivo`, que o gatilho de gemeos_hasta_cef.sql já protege contra a ressurreição
-- pelo importador CEF. Antes de esconder, o gêmeo do leiloeiro HERDA o que só a Caixa tinha
-- (endereço, bairro, coordenadas) quando não tem — senão o pino no mapa piorava.
--
-- Guardas contra marcar imóveis DIFERENTES (condomínio com várias unidades do mesmo preço é
-- comum na CEF): só par 1-para-1 (cada lado casa com exatamente um do outro) E área dos dois
-- lados > 0 e batendo. Reativa o CEF quando o par desfaz (leiloeiro saiu do ar) e o lote CEF
-- ainda é vendável — mesma guarda A1 da reconciliação HASTA.
-- Roda todo dia no monitor-fontes-cron, logo depois da reconciliação HASTA. Idempotente.

create or replace function public.reconciliar_gemeos_leiloeiro_cef()
returns jsonb language sql volatile security definer set search_path = public, pg_temp as $$
  with base as materialized (
    select id, fonte, ativo, suprimido_motivo, estado, valor_minimo, valor_avaliacao, data_leilao, area_m2,
           endereco, bairro, latitude, longitude,
           lower(translate(coalesce(cidade,''), 'áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ', 'aaaaeeiooouc aaaaeeiooouc')) as cid
      from public.imoveis_leilao
     where tipo is distinct from 'veiculo' and coalesce(valor_minimo, 0) > 1000 and coalesce(area_m2, 0) > 0
  ),
  cef as (select * from base where fonte in ('CEF','caixa') and (ativo or suprimido_motivo = 'gemeo_leiloeiro')),
  outro as (select * from base where fonte not in ('CEF','caixa','HASTA','EDITAL_DJEN') and ativo),
  pares as materialized (
    select c.id as cid, o.id as oid
      from cef c join outro o
        on o.cid = c.cid and o.estado = c.estado and o.valor_minimo = c.valor_minimo
       and o.valor_avaliacao is not distinct from c.valor_avaliacao
       and o.data_leilao is not distinct from c.data_leilao
       and abs(o.area_m2 - c.area_m2) <= greatest(1, 0.02 * c.area_m2)
  ),
  um as materialized (
    select p.* from pares p
     where (select count(*) from pares q where q.cid = p.cid) = 1
       and (select count(*) from pares q where q.oid = p.oid) = 1
  ),
  enr as (
    update public.imoveis_leilao o
       set endereco  = coalesce(nullif(o.endereco, ''), c.endereco),
           bairro    = coalesce(nullif(o.bairro, ''), c.bairro),
           -- Endereço veio (ou é igual ao) da Caixa → a coordenada da Caixa é a do endereço; a
           -- do leiloeiro sem endereço era o centro da cidade (1ª rodada: pino a ~4 km).
           latitude  = case when coalesce(o.endereco, '') in ('', c.endereco) then coalesce(c.latitude, o.latitude)
                            else coalesce(nullif(o.latitude, 0), c.latitude) end,
           longitude = case when coalesce(o.endereco, '') in ('', c.endereco) then coalesce(c.longitude, o.longitude)
                            else coalesce(nullif(o.longitude, 0), c.longitude) end
      from um join cef c on c.id = um.cid
     where o.id = um.oid
       and ((coalesce(o.endereco, '') = '' and c.endereco is not null)
         or (coalesce(o.bairro, '') = '' and c.bairro is not null)
         or (coalesce(o.latitude, 0) = 0 and c.latitude is not null)
         or (o.endereco = c.endereco and c.latitude is not null and o.latitude is distinct from c.latitude))
    returning 1
  ),
  sup as (
    update public.imoveis_leilao c
       set ativo = false, suprimido_motivo = 'gemeo_leiloeiro'
     where c.id in (select cid from um) and c.ativo and c.suprimido_motivo is null
    returning 1
  ),
  rea as (
    update public.imoveis_leilao c
       set ativo = true, suprimido_motivo = null
     where c.fonte in ('CEF','caixa') and c.suprimido_motivo = 'gemeo_leiloeiro'
       and c.id not in (select cid from um)
       and coalesce(c.status, 'disponivel') = 'disponivel'
       and (c.data_leilao is null
            or c.data_leilao !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            or substring(c.data_leilao, 1, 10)::date >= current_date)
    returning 1
  )
  select jsonb_build_object(
    'pares',       (select count(*) from um),
    'suprimidos',  (select count(*) from sup),
    'reativados',  (select count(*) from rea),
    'enriquecidos',(select count(*) from enr),
    'ambiguos',    (select count(*) from pares) - (select count(*) from um),
    'em', now());
$$;
revoke all on function public.reconciliar_gemeos_leiloeiro_cef() from public, anon, authenticated;
