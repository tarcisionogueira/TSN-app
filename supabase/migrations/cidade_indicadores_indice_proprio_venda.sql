-- Índice PRÓPRIO de mercado por cidade (tira a dependência de fonte externa).
-- v1: venda R$/m² = mediana de (valor_avaliacao / area_m2) do nosso acervo residencial.
-- aluguel_m2 fica p/ ser semeado/aprendido pelos relatórios (loop de validação).
-- fator_calibracao: avaliação de leilão roda abaixo do mercado; o fator (aprendido dos
-- relatórios/FipeZAP) converte o bruto em estimativa de mercado. Default 1.0 (bruto) até calibrar.
create table if not exists public.cidade_indicadores (
  cidade_norm       text not null,
  uf                text not null,
  tipo              text not null default 'residencial',
  venda_m2          numeric,            -- mediana avaliacao/m2 (bruto do acervo)
  venda_m2_mercado  numeric,            -- venda_m2 * fator_calibracao (estimativa de mercado)
  aluguel_m2        numeric,            -- referencia de locacao (semeada/aprendida) - null por enquanto
  n_amostras        integer default 0,
  fonte             text default 'acervo',
  fator_calibracao  numeric default 1.0,
  atualizado_em     timestamptz default now(),
  primary key (cidade_norm, uf, tipo)
);

-- Dado de referência de mercado, sem PII: leitura liberada (o Busca vai exibir), escrita só service_role.
alter table public.cidade_indicadores enable row level security;
drop policy if exists cidade_indicadores_read on public.cidade_indicadores;
create policy cidade_indicadores_read on public.cidade_indicadores for select using (true);
grant select on public.cidade_indicadores to anon, authenticated;

-- Recalcula o índice a partir do acervo. Preserva fator_calibracao por cidade se já ajustado.
create or replace function public.recalcular_cidade_indicadores()
returns integer
language plpgsql
security definer
set search_path to ''
as $fn$
declare n integer;
begin
  insert into public.cidade_indicadores (cidade_norm, uf, tipo, venda_m2, venda_m2_mercado, n_amostras, fonte, atualizado_em)
  select b.cidade_norm, b.uf, 'residencial',
         round(percentile_cont(0.5) within group (order by b.rm2)::numeric, 0),
         round(percentile_cont(0.5) within group (order by b.rm2)::numeric, 0),  -- fator 1.0 no insert inicial
         count(*), 'acervo', now()
  from (
    select cidade_norm, upper(estado) as uf, valor_avaliacao / nullif(area_m2, 0) as rm2
    from public.imoveis_leilao
    where ativo and valor_avaliacao > 0 and area_m2 between 20 and 500
      and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> ''
      and (tipo ilike '%apart%' or tipo ilike '%casa%' or tipo ilike '%sobrado%'
           or tipo ilike '%kitnet%' or tipo ilike '%imov%' or tipo is null)
  ) b
  group by b.cidade_norm, b.uf
  having count(*) >= 5
  on conflict (cidade_norm, uf, tipo) do update
    set venda_m2         = excluded.venda_m2,
        venda_m2_mercado = round(coalesce(public.cidade_indicadores.fator_calibracao, 1.0) * excluded.venda_m2, 0),
        n_amostras       = excluded.n_amostras,
        atualizado_em    = now();
  get diagnostics n = row_count;
  return n;
end;
$fn$;

-- Não expor a função definer a anon/authenticated (mantém auditoria_seguranca limpa);
-- o cron chama via service_role. IMPORTANTE: revogar de anon/authenticated também, não só
-- de public — o Supabase concede execute por padrão a esses roles.
revoke execute on function public.recalcular_cidade_indicadores() from public, anon, authenticated;
grant execute on function public.recalcular_cidade_indicadores() to service_role;
