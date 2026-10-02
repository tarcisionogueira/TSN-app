-- 02/10 — "fonte já explicada": o ritual de abertura parava em LEJE/SBID21/JMFLEILOES toda sessão,
-- com o diagnóstico já escrito no HANDOFF. Reinvestigar o que já tem explicação é retrabalho pago.
--
-- Desenho (pedido do dono), com três travas para a marcação não virar ponto cego:
--   1. vale só para o MESMO motivo — se a fonte passar de `zerou` para `medicao_velha`, volta à lista;
--   2. vence sozinha — no máximo 30 dias (check), e depois disso a fonte reaparece;
--   3. o que está escondido vira UMA LINHA de resumo `(explicadas)`, nunca um vazio silencioso
--      (mesma regra de 29/08: "não consegui verificar" é linha, não silêncio).
-- `fonte_regressao_suspeita()` NÃO muda — continua sendo a verdade crua; esta é só a vista do ritual.

create table if not exists public.fonte_regressao_explicada (
  fonte          text primary key,
  motivo         text not null check (motivo in ('zerou','regressao','medicao_velha')),
  explicacao     text not null check (length(explicacao) >= 10),
  explicado_em   timestamptz not null default now(),
  explicado_ate  date not null,
  constraint explicada_vence_em_30_dias check (explicado_ate <= (explicado_em at time zone 'UTC')::date + 30)
);
alter table public.fonte_regressao_explicada enable row level security;
revoke all on public.fonte_regressao_explicada from anon, authenticated;

comment on table public.fonte_regressao_explicada is
  'Marcação de fonte cuja regressão já tem diagnóstico (HANDOFF). Some de fonte_regressao_pendente() só para o MESMO motivo e até explicado_ate (máx. 30 dias).';

create or replace function public.fonte_regressao_pendente()
returns table (fonte text, motivo text, total integer, ativos_piso integer, medido_em timestamptz, explicacao text)
language sql stable security definer set search_path to 'public'
as $$
  with s as (select * from public.fonte_regressao_suspeita()),
  j as (
    select s.*, e.explicacao as exp, e.explicado_ate
      from s left join public.fonte_regressao_explicada e
        on e.fonte = s.fonte and e.motivo = s.motivo and e.explicado_ate >= current_date
  )
  select j.fonte, j.motivo, j.total::int, j.ativos_piso::int, j.medido_em, null::text
    from j where j.exp is null
  union all
  select '(explicadas)', count(*)::text || ' oculta(s)', null, null, null,
         string_agg(j.fonte || ' ' || j.motivo || ' até ' || to_char(j.explicado_ate, 'DD/MM') || ': ' || j.exp, ' | ' order by j.fonte)
    from j where j.exp is not null
  having count(*) > 0
$$;

revoke all on function public.fonte_regressao_pendente() from public, anon;
grant execute on function public.fonte_regressao_pendente() to service_role, authenticated;

-- Marcações iniciais (02/10), diagnósticos do HANDOFF de 01/10.
insert into public.fonte_regressao_explicada (fonte, motivo, explicacao, explicado_ate) values
 ('LEJE','zerou','Cloudflare da LEJE barra robô (403) desde 24/09; aguarda liberação pedida pelo dono. Não evadir.', date '2026-10-16'),
 ('SBID21','regressao','Portal secundário da Superbid; os mesmos lotes estão ativos sob SUPERBID (1.358). Nada perdido.', date '2026-10-16'),
 ('JMFLEILOES','regressao','Leilão de 30/09 aconteceu; site lista só os 2 lotes futuros. Expiração legítima.', date '2026-10-09')
on conflict (fonte) do nothing;
