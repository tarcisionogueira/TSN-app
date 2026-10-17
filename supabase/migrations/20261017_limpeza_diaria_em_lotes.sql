-- ─────────────────────────────────────────────────────────────────────────────────────────
-- LIMPEZA DIÁRIA EM LOTES — 17/10/2026
--
-- `desativar_imoveis_cef_vencidos` morria em statement timeout (8 s do authenticator) TODO DIA
-- desde pelo menos 15/10: o backlog de imóveis que a Caixa tirou da lista passou de ~1.000, e
-- cada linha atualizada atravessa ~30 triggers BEFORE UPDATE de imoveis_leilao. Um UPDATE só
-- não cabe em 8 s; como ele nunca termina, o backlog nunca diminui — e a vitrine segue mostrando
-- imóvel vendido ("imóvel não disponível" ao clicar). O mesmo vale para o pino genérico
-- (`pino_generico_como_rua` 63 → 177 no mesmo dia).
--
-- CONSERTO: versões `_lote` que tocam no máximo N linhas por chamada; o cron chama em laço até
-- devolver menos que N (ou acabar o orçamento de tempo). As originais ficam (sem DROP — ver
-- CLAUDE.md), mas o cron não as chama mais.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.desativar_imoveis_cef_vencidos_lote(margem interval default '1 day'::interval, lote integer default 200)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  with mx as (
    select estado, max(atualizado_em) m
      from imoveis_leilao where fonte = 'CEF' group by estado
  ), alvo as (
    select t.id from imoveis_leilao t join mx on mx.estado = t.estado
     where t.fonte = 'CEF' and t.ativo = true and t.atualizado_em < mx.m - margem
     order by t.atualizado_em
     limit greatest(1, least(lote, 1000))
  )
  update imoveis_leilao t set ativo = false, suprimido_motivo = 'sumiu_da_fonte'
    from alvo where t.id = alvo.id;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.desativar_imoveis_cef_vencidos_lote(interval, integer) is
  'Mesma regra de desativar_imoveis_cef_vencidos (por estado, margem sobre a ultima coleta da UF), limitada a N linhas por chamada para caber no statement_timeout. O cron limpar-imoveis-stale chama em laco.';

-- A seleção original (EXISTS com via_normalizada dos dois lados) não cabe em 8 s nem com LIMIT:
-- o EXISTS reavalia a regex por par. Agrupar por coordenada primeiro dá a MESMA regra (a linha tem
-- via e o grupo tem 2+ vias distintas) em ~1,5 s — medido 17/10: 176 nos dois jeitos.
create or replace function public.demover_pinos_genericos_lote(lote integer default 200)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  with g as materialized (
    select latitude, longitude from public.imoveis_leilao
     where ativo and latitude is not null and longitude is not null
     group by 1, 2 having count(*) > 1
  ), v as materialized (
    select i.id, i.latitude, i.longitude, i.geocod_nivel, public.via_normalizada(i.endereco) via
      from public.imoveis_leilao i join g using (latitude, longitude) where i.ativo
  ), c as materialized (
    select latitude, longitude from v where via is not null
     group by 1, 2 having count(distinct via) > 1
  ), alvo as (
    select v.id from v join c using (latitude, longitude)
     where v.geocod_nivel in ('rua','endereco') and v.via is not null
     limit greatest(1, least(lote, 1000))
  )
  update public.imoveis_leilao a set geocod_nivel = 'cidade' from alvo where a.id = alvo.id;
  get diagnostics n = row_count;
  return n;
end $$;

comment on function public.demover_pinos_genericos_lote(integer) is
  'Mesma regra de demover_pinos_genericos, limitada a N linhas por chamada (statement_timeout de 8 s). Chamada em laco pelo cron limpar-imoveis-stale.';

revoke all on function public.desativar_imoveis_cef_vencidos_lote(interval, integer) from public, anon, authenticated;
revoke all on function public.demover_pinos_genericos_lote(integer) from public, anon, authenticated;
grant execute on function public.desativar_imoveis_cef_vencidos_lote(interval, integer) to service_role;
grant execute on function public.demover_pinos_genericos_lote(integer) to service_role;
