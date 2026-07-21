-- Pedido do dono (diagnóstico de qualidade): o monitor de fontes media só COBERTURA (campo
-- vazio %), não QUALIDADE/CORREÇÃO. Documento TROCADO (edital=matrícula, matrícula=página do
-- lote) e TIPOLOGIA fraca (% do balde genérico 'imovel') passavam batido — até INFLAVAM a
-- cobertura. Esta RPC entrega essas métricas por fonte para o monitor-fontes-cron alertar por
-- regressão/limite (Seção C2), separada da admin_docs_por_leiloeiro (que é admin-gated e o
-- monitor roda como service_role, sem auth.uid()).
--
-- security invoker (default) + search_path fixo + só service_role — NÃO aparece no auditor
-- (mesma postura da fonte_cobertura). Confusões medidas:
--   • ed_eq_matr   = link_edital == link_matricula (o bug "botão Edital abre a Matrícula").
--   • matr_eq_lote = link_matricula == url_lote (matrícula que é a PÁGINA do lote, não doc).
--   • imovel_pct   = % de lotes no balde genérico 'imovel' (tipologia não classificada).
create or replace function public.fonte_qualidade()
returns table(fonte text, ativos bigint, imovel_pct integer, ed_eq_matr integer, matr_eq_lote integer)
language sql
set search_path to 'public'
as $function$
  select
    fonte,
    count(*) as ativos,
    round(100.0*count(*) filter (where tipo = 'imovel')/count(*))::int as imovel_pct,
    count(*) filter (
      where link_edital is not null and link_edital <> '' and link_edital = link_matricula
    )::int as ed_eq_matr,
    count(*) filter (
      where link_matricula is not null and link_matricula <> '' and link_matricula = url_lote
    )::int as matr_eq_lote
  from imoveis_leilao
  where ativo = true
  group by fonte;
$function$;

revoke execute on function public.fonte_qualidade() from public, anon;
grant execute on function public.fonte_qualidade() to service_role;
