-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CIDADES DO ACERVO EM CACHE — 21/10 (diagnóstico de abertura)
--
-- `acervo_cidades_top` (/api/publico, vitrine pública) e `acervo_cidades_todas` (sitemap) deram
-- `57014 statement timeout` em 21/10 (07:30 e 21:14 UTC). O índice de 18/10
-- (idx_imoveis_ativo_uf_cidade) existe, mas não salva: o plano lê os ~30 mil ativos pela heap
-- (21.842 buffers) de qualquer jeito. Medido: 114 ms com o banco calmo, 3,9 s no mesmo plano com
-- o banco sob carga — e o teto do anon é 8 s. O número não precisa ser vivo.
--
-- Mesmo remédio de `plataforma_numeros_cache` (29/08): quem recalcula é a varredura HORÁRIA que
-- liga/desliga `ativo` (desativar-encerrados-cron → live_plataforma_numeros_atualizar). Atualizar
-- DENTRO da mesma função é de propósito: o invariante `live_numeros_congelados` já grita se ela
-- parar, então o cache novo não envelhece calado. As funções públicas leem 1 linha; sem cache
-- (banco recriado do zero), calculam na hora como antes.
--
-- Corpo de live_plataforma_numeros_atualizar = o de PRODUÇÃO em 21/10 (filtro `where ativo`
-- fora dos agregados, diferente da migração de 29/08 — forma nº 7b) + o bloco das cidades.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create table if not exists public.acervo_cidades_cache (
  id            boolean primary key default true check (id),
  top           jsonb       not null,   -- até 300 cidades, por total desc (o teto da função)
  todas         jsonb       not null,
  atualizado_em timestamptz not null default now()
);
alter table public.acervo_cidades_cache enable row level security;
-- Dado PÚBLICO (é a vitrine: UF, cidade e contagem). Leitura liberada por policy para que
-- acervo_cidades_top siga INVOKER — definer exposto a anon é achado do auditor de segurança.
-- Escrita: só a função definer do cron (nenhuma policy de escrita).
create policy acervo_cidades_cache_leitura on public.acervo_cidades_cache for select to anon, authenticated using (true);
grant select on public.acervo_cidades_cache to anon, authenticated;

create or replace function public._acervo_cidades_calcular(p_limite integer)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'uf', uf, 'cidade', cidade, 'cidade_norm', cidade_norm, 'total', total)
         order by total desc, cidade), '[]'::jsonb)
  from (
    select upper(estado) as uf, min(cidade) as cidade, cidade_norm, count(*)::int as total
      from public.imoveis_leilao
     where ativo and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> ''
     group by upper(estado), cidade_norm
     order by count(*) desc
     limit least(greatest(coalesce(p_limite, 60), 1), 300)
  ) t;
$$;
-- Sem retirar permissão de propósito (o conector MCP trava nesse comando): função NÃO definer, só lê o que quem chama
-- já pode ler, e é o mesmo cálculo que acervo_cidades_top sempre expôs ao anon.

create or replace function public.live_plataforma_numeros_atualizar()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'lotes',        count(*),
    'leiloeiros',   count(distinct fonte),
    'cidades',      count(distinct cidade),
    'com_desconto', count(*) filter (where desconto_percentual between 50 and 95)
  ) into v from public.imoveis_leilao where ativo;

  insert into public.plataforma_numeros_cache (id, dados, atualizado_em)
  values (true, v, now())
  on conflict (id) do update set dados = excluded.dados, atualizado_em = excluded.atualizado_em;

  -- Cidades da vitrine e do sitemap (21/10): mesma varredura, mesmo relógio.
  insert into public.acervo_cidades_cache (id, top, todas, atualizado_em)
  values (true,
          public._acervo_cidades_calcular(300),
          (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'cidade_norm', cidade_norm)), '[]'::jsonb)
             from (select distinct upper(estado) as uf, cidade_norm
                     from public.imoveis_leilao
                    where ativo and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> '') t),
          now())
  on conflict (id) do update set top = excluded.top, todas = excluded.todas, atualizado_em = excluded.atualizado_em;

  return v || jsonb_build_object('atualizado_em', now());
end;
$function$;
-- `create or replace` mantém as permissões que já existem (execute só para service_role/postgres).

create or replace function public.acervo_cidades_top(p_limite integer default 60)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select jsonb_agg(e order by o)
       from public.acervo_cidades_cache c,
            jsonb_array_elements(c.top) with ordinality as x(e, o)
      where c.id and o <= least(greatest(coalesce(p_limite, 60), 1), 300)),
    public._acervo_cidades_calcular(p_limite));
$$;
grant execute on function public.acervo_cidades_top(integer) to anon, authenticated, service_role;

create or replace function public.acervo_cidades_todas()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select c.todas from public.acervo_cidades_cache c where c.id),
    (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'cidade_norm', cidade_norm)), '[]'::jsonb)
       from (select distinct upper(estado) as uf, cidade_norm
               from public.imoveis_leilao
              where ativo and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> '') t));
$$;
-- Permissões preservadas pelo `create or replace` (só service_role, como em acervo_publico_agregados.sql).

-- Semeia agora: a vitrine não espera o próximo cron.
select public.live_plataforma_numeros_atualizar();
